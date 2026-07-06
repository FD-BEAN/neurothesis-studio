"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import {
  getSupabaseBrowserClient,
  hasSupabaseBrowserConfig,
  type ResearchAnalysisJob,
  type ResearchDocument,
} from "@/lib/supabase";
import type { SeedKnowledgeReviewItem, SeedLiteratureMatch } from "@/lib/knowledgeBase";
import { isLiteratureDocument, parseLiteratureCard, type LiteratureKnowledgeCard } from "@/lib/literature";
import literatureArticleKnowledgeBase from "@/lib/literature_article_kb.json";
import { researchProject } from "@/lib/researchProject";
import { analysisPipelineStages, unityMarkerDictionary, unityMarkerFamilyLabels } from "@/lib/unityMarkerDictionary";
import {
  compareXdfConditionNames,
  densityLabels,
  densityLevels,
  inferXdfDensityLevel,
  inferXdfRunLabel,
  inferXdfSubjectId,
  type DensityLevel,
} from "@/lib/xdfNaming";

type UploadState = "idle" | "uploading" | "done" | "warning" | "error";

type AiState = {
  status: "idle" | "loading" | "done" | "error";
  output: string;
};

type LiteratureKnowledgeEntry = {
  document: ResearchDocument;
  card: LiteratureKnowledgeCard | null;
  seedMatch: SeedLiteratureMatch | null;
};

type LibraryFilter = "all" | "literature" | "analysis" | "notes";
type JobViewFilter = "all" | "active" | "completed" | "failed" | "stale";
type SubjectMatrixFilter = "all" | "ready" | "missing" | "completed" | "active" | "failed";

const RESEARCH_FILE_ACCEPT = ".pdf,.doc,.docx,.csv,.tsv,.xlsx,.txt,.md,.svg,.png,.jpg,.jpeg,.json,.jsonl,.py,.m,.ipynb";
const XDF_FILE_ACCEPT = ".xdf";
const EXPECTED_SUBJECT_COUNT = 100;
const EXPECTED_RUNS_PER_SUBJECT = 3;
const EXPECTED_XDF_COUNT = EXPECTED_SUBJECT_COUNT * EXPECTED_RUNS_PER_SUBJECT;
const EXPECTED_SUBJECT_RANGE_LABEL = `P01-P${String(EXPECTED_SUBJECT_COUNT).padStart(2, "0")}`;
const XDF_BULK_UPLOAD_CONCURRENCY = 4;
const xdfUploadRelativePaths = new WeakMap<File, string>();

type UploadProgress = {
  total: number;
  completed: number;
  uploaded: number;
  failed: number;
  skipped: number;
  currentFile?: string;
} | null;

type UploadBatchFailure = {
  filename: string;
  message: string;
};

type UploadBatchSnapshot = {
  total: number;
  completed: number;
  uploaded: number;
  failed: number;
  currentFile?: string;
};

type XdfUploadFile = File & {
  uploadRelativePath?: string;
  webkitRelativePath?: string;
};

type BrowserFileSystemFileHandle = {
  kind: "file";
  name: string;
  getFile: () => Promise<File>;
};

type BrowserFileSystemDirectoryHandle = {
  kind: "directory";
  name: string;
  values: () => AsyncIterable<BrowserFileSystemHandle>;
};

type BrowserFileSystemHandle = BrowserFileSystemFileHandle | BrowserFileSystemDirectoryHandle;

type WindowWithDirectoryPicker = Window & {
  showDirectoryPicker?: (options?: { id?: string; mode?: "read" }) => Promise<BrowserFileSystemDirectoryHandle>;
};

type XdfDirectoryScanResult = {
  files: XdfUploadFile[];
  inspectedFiles: number;
  visitedDirectories: number;
};

type AnalysisGuideItem = {
  field: string;
  meaning: string;
  method: string;
  caveat: string;
};

type AnalysisGuideSection = {
  title: string;
  note: string;
  items: AnalysisGuideItem[];
};

type H1ConditionMean = {
  level: DensityLevel;
  value: number;
};

type H1EvidenceCard = {
  label: string;
  value: string;
  detail: string;
  tone: "primary" | "support" | "caution";
};

type H1SensitivityRow = {
  label: string;
  n: number;
  contrast: string;
  p: string;
  status: string;
};

const h1ConditionMeans: H1ConditionMean[] = [
  { level: "low", value: 7.401 },
  { level: "medium", value: 12.721 },
  { level: "high", value: 3.033 },
];

const h1EvidenceCards: H1EvidenceCard[] = [
  {
    label: "H1 主 planned contrast",
    value: "7.504s",
    detail: "95% CI [4.130, 10.878]；双侧 p<.001；sign-flip p<.001；Wilcoxon p=.004。",
    tone: "primary",
  },
  {
    label: "个体峰值诊断",
    value: "45/98",
    detail: "中等支持为个体三条件最高，binomial p=.006；medium > high 为 74/98，p<.001。",
    tone: "support",
  },
  {
    label: "地图校正模型",
    value: "p<.001",
    detail: "subject FE + map FE：coef=2.541，SE=.344，n=294 runs/98 subjects；说明主效应不是单纯地图差异。",
    tone: "support",
  },
  {
    label: "主指标冻结",
    value: "固定",
    detail: "Y = prompt_to_first_confirmation_s；复合迟滞指数和旧版广义效率指标只做敏感性。",
    tone: "caution",
  },
];

const h1ComponentSensitivityRows: H1SensitivityRow[] = [
  { label: "删除 prompt_to_first_confirmation_s", n: 98, contrast: "-0.064", p: ".379", status: "转为不显著，说明 prompt 是核心成分" },
  { label: "删除 time_to_first_sign_readable_s", n: 98, contrast: "0.167", p: ".029", status: "正向且 p<.05" },
  { label: "删除 decision_total_look_count", n: 98, contrast: "0.106", p: ".196", status: "正向但不显著" },
  { label: "删除 decision_scan_both_count", n: 98, contrast: "0.091", p: ".281", status: "正向但不显著" },
];

const h1QcSensitivityRows: H1SensitivityRow[] = [
  { label: "完整三条件", n: 98, contrast: "7.504s", p: "<.001", status: "正向且 p<.05" },
  { label: "严格 trial start", n: 93, contrast: "7.054s", p: "<.001", status: "正向且 p<.05" },
  { label: "低重复 marker 比例", n: 96, contrast: "7.728s", p: "<.001", status: "正向且 p<.05" },
  { label: "EEG epochs >= 20", n: 90, contrast: "6.075s", p: "<.001", status: "正向且 p<.05" },
];

const analysisGuideSections: AnalysisGuideSection[] = [
  {
    title: "页面上的数字",
    note: "这些数字只是当前账号里已经上传和已经创建的任务状态，不等于论文样本量。",
    items: [
      {
        field: "XDF 文件",
        meaning: "当前私有存储里识别为 .xdf 的文件数。",
        method: "从 research_documents 文件表筛出扩展名为 .xdf 的记录。",
        caveat: "这里可能有重复文件、旧文件或缺 marker 的文件；正式分析只用 canonical run。",
      },
      {
        field: "已选择",
        meaning: "你在被试批量分析列表里勾选的 XDF 数量。",
        method: "前端按 selectedBatchIds 计数。",
        caveat: "只是待提交清单，不代表已经分析。",
      },
      {
        field: "进行中",
        meaning: "还在 pending、queued 或 running 的 XDF 分析任务。",
        method: "从 research_analysis_jobs 里按任务状态统计；超过 10 分钟没更新会被标成疑似卡住。",
        caveat: "GitHub Actions 或 worker 没配置好时，任务可能停在需要配置。",
      },
      {
        field: "已完成",
        meaning: "worker 已经写回 completed 的 XDF 任务。",
        method: "按任务状态统计。能不能下载 HTML，要看 result_json 里有没有 htmlReport。",
        caveat: "旧任务可能完成了但没有 HTML，需要重新跑一次。",
      },
      {
        field: "失败/需处理",
        meaning: "失败、需要配置，或长时间没有更新的任务。",
        method: "failed、configuration_required 和 stale 三类合并显示。",
        caveat: "这不是数据质量结论，只是任务执行状态。",
      },
    ],
  },
  {
    title: "XDF 文件和被试矩阵",
    note: "这一块只解决文件组织问题：哪个文件属于哪个被试、哪个条件、能不能提交分析。",
    items: [
      {
        field: EXPECTED_SUBJECT_RANGE_LABEL,
        meaning: "分析层面的被试编号。",
        method: "sub001/sub002/sub003 归为 P01，sub004/sub005/sub006 归为 P02，以此类推。",
        caveat: "sub001 是文件序号，不是被试编号。",
      },
      {
        field: "低 / 中 / 高",
        meaning: "同一被试的三个路径确认支持条件。",
        method: "优先读 Signature1/2/3；读不到时按三连号位置推断。Signature1=低，Signature2=中，Signature3=高。",
        caveat: "如果后续有正式条件表，正式条件表优先。",
      },
      {
        field: "条件完整",
        meaning: "该被试低、中、高三个 XDF 都在。",
        method: "每个 Pxx 行分别检查 low、medium、high 是否有文件。",
        caveat: "完整不代表质量合格；还要看 marker、trial window 和 EEG 覆盖。",
      },
      {
        field: "可提交",
        meaning: "三条件完整，而且没有正在跑或已经完成的同被试批量任务。",
        method: "前端用文件矩阵和任务表一起判断。",
        caveat: "重复上传同一 run 时，worker 仍会按 canonical 规则选一个主 run。",
      },
      {
        field: "下载矩阵 CSV",
        meaning: `导出 ${EXPECTED_SUBJECT_RANGE_LABEL} 的文件、缺失条件、任务状态和报告可用性。`,
        method: "前端把当前筛选后的矩阵转成 CSV。",
        caveat: "这个 CSV 是管理清单，不是统计结果表。",
      },
    ],
  },
  {
    title: "H1 主结果数字",
    note: "H1 只回答一个问题：中等路径确认支持下，官方提示到首次现场路径确认是否慢于低/高支持平均。",
    items: [
      {
        field: "prompt_to_first_confirmation_s",
        meaning: "正式 H1 行为主原始指标，中文可写作官方提示到首次现场路径确认延迟。",
        method: "从 audio/prompt 类 marker 到第一个确认线索 marker 的时间差，单位为秒。",
        caveat: "它不是总完成时间，也不等于问卷里的感知可靠性。",
      },
      {
        field: "planned contrast = 7.504s",
        meaning: "中等支持相对低/高支持平均的差值。",
        method: "每名被试先算 medium - mean(low, high)，再对被试 contrast 求均值。",
        caveat: "这是主结果。机制指标、EEG 和正确率都放在它后面解释。",
      },
      {
        field: "95% CI [4.130, 10.878]",
        meaning: "当前样本下主 contrast 的 95% 置信区间。",
        method: "基于 subject-level contrast 的均值和标准误计算，并另做 bootstrap 检查。",
        caveat: "置信区间不等于个体范围。",
      },
      {
        field: "p<.001",
        meaning: "主 contrast 大于 0 的证据强度，当前双侧检验达到常用 .001 阈值。",
        method: "对 98 名完整被试的 subject-level contrast 做单样本检验。",
        caveat: "不要只看 p 值；还要看方向、CI、非参数检验和敏感性。",
      },
      {
        field: "45/98 个体峰值",
        meaning: "98 名完整被试中，有 45 名在中等支持条件下提示到确认延迟最高。",
        method: "逐个被试看 low、medium、high 三个值哪个最大。",
        caveat: "这是形状诊断，不替代 planned contrast。",
      },
    ],
  },
  {
    title: "行为、正确率和 EEG 字段",
    note: "这些字段帮助解释 H1，但各自有边界。不要把它们互相替代。",
    items: [
      {
        field: "prompt_to_first_confirmation_s",
        meaning: "官方提示到首次现场确认线索之间的时间，也是当前 H1 主原始指标。",
        method: "从 audio/prompt 类 marker 到第一个确认线索 marker 的时间差。",
        caveat: "它能说明行动迟滞，但不能当成 M1 感知可靠性问卷。",
      },
      {
        field: "time_to_first_sign_readable_s",
        meaning: "trial 开始后多久第一次读到路径线索。",
        method: "map_start 到第一个 sign_readable 的时间差。",
        caveat: "如果 start marker 不完整，要进入 QC 敏感性分析。",
      },
      {
        field: "decision_total_look_count",
        meaning: "关键决策点左右查看的总次数。",
        method: "统计 decision_look_left 和 decision_look_right 一类 marker。",
        caveat: "重复查看本身可能是行为证据，不能因为次数多就随便删。",
      },
      {
        field: "decision_scan_both_count",
        meaning: "在决策点出现双侧扫描的次数。",
        method: "统计 decision_scan_both_sides 或 worker 适配出的等价 marker。",
        caveat: "它只表示扫描行为，不直接等同于犹豫的心理状态。",
      },
      {
        field: "exit_label == A3",
        meaning: "最终出口是否为 A3。当前实验里 A3 是唯一正确出口。",
        method: "如果没有更细的 choice_correct，就用最终出口标签推断 final_arrival_correct。",
        caveat: "这是最终正确性，不是每个分岔点的选择正确率。",
      },
      {
        field: "decision_point_enter_frontal_theta_delta",
        meaning: "进入关键决策点附近的额区 theta 变化，用作 M2 过程证据。",
        method: "EEG 预处理后，在 decision_point_enter 事件窗提取频带变化。",
        caveat: "这是神经工程过程证据，不写成医学或生物诊断结论。",
      },
    ],
  },
  {
    title: "统计方法和报告顺序",
    note: "报告顺序要固定，避免看哪个指标更显著就把哪个放前面。",
    items: [
      {
        field: "单 run QC",
        meaning: "先判断一个 XDF 能不能进入正式分析。",
        method: "检查 EEG stream、Unity marker、trial window、完成 marker、事件窗数量和重复 marker。",
        caveat: "QC 规则不能按显著性结果事后改。",
      },
      {
        field: "被试内三条件表",
        meaning: "同一名被试的 low、medium、high 放在一行。",
        method: "先在被试内标准化，再算每个指标的 condition 值和 planned contrast。",
        caveat: "单个被试只看方向，不报告显著性。",
      },
      {
        field: "全样本 planned contrast",
        meaning: "正式检验 H1 的主统计单位。",
        method: "每名完整被试贡献一个 medium - mean(low, high)，再做 t、Wilcoxon、sign-flip、bootstrap 和 leave-one-subject-out。",
        caveat: "正式论文先报告这个，再写机制。",
      },
      {
        field: "组件敏感性",
        meaning: "检查 H1 是否被某一个成分单独撑起来。",
        method: "每次拿掉一个组成成分，重算 composite 和 planned contrast。",
        caveat: "敏感性不是新主指标。",
      },
      {
        field: "QC 敏感性",
        meaning: "检查结果是否依赖某一个清洗阈值。",
        method: "在更严格的 start marker、重复 marker、EEG epochs 等过滤规则下重算 H1。",
        caveat: "如果某个严格方案变弱，先解释数据质量和样本量，不要直接换指标。",
      },
      {
        field: "M1 / W 问卷",
        meaning: "M1 是感知可靠性，W 是保护性行动指令清晰度。",
        method: "问卷接入后，用 perceived_reliability_score 和 protective_action_instruction_clarity_score 做分段中介与调节。",
        caveat: "当前不能把行为指标冒充问卷中介。",
      },
    ],
  },
];

type HtmlReportArtifact = {
  storagePath: string;
  filename?: string;
  sizeBytes?: number;
  generatedAt?: string;
};

const workspaceModules = [
  {
    href: "#pipeline",
    title: "数据分析与论文写作",
    text: "XDF 质量检查、行为数据、EEG 预处理和中文论文正文。",
  },
  {
    href: "#ai",
    title: "文献与写作助手",
    text: "基于已入库论文知识卡片生成文献综述、方法正文、结果模板和分析计划。",
  },
  {
    href: "#files",
    title: "研究资料库",
    text: "文献知识库、XDF 原始数据、分析脚本和写作材料。",
  },
  {
    href: "#knowledge",
    title: "知识库审阅",
    text: "逐篇查看文献的研究问题、方法、发现、用途、边界和引用线索。",
  },
];

const knowledgeReviewNotes = [
  "这里保存的是逐篇论文档案：每篇文献都有自己的研究问题、设计、发现、可信度、写作用途和边界。",
  "正式写入论文前仍需回到 PDF 原文核对作者、年份、DOI、页码和原句语境。",
  "路径确认支持水平统一写作口径为 low / medium / high route-confirmation support；历史 Signature1/2/3 只作为素材命名线索。",
  "文献只能支持理论、方法和解释机制；中等支持条件是否产生最高认知负荷，必须由真实 XDF/EEG 与行为数据检验。",
  "S001 这类编号只是站内文献索引；展开单篇档案时可以看到完整题名和可写入论文的位置。",
];

const literatureCardBlueprint = [
  { label: "文献身份", text: "题名、文件、文献编号、入库时间、研究类型和证据等级。" },
  { label: "研究问题", text: "该文解决什么问题，和应急寻路、标识、VR、EEG 或认知负荷的关系。" },
  { label: "方法拆解", text: "样本、任务材料、自变量、因变量、行为/生理指标和统计方法。" },
  { label: "主要发现", text: "只记录该文真正支持的发现，不把本项目假设写成文献结论。" },
  { label: "写作用途", text: "可用于引言、综述、方法、变量定义、讨论或局限的具体位置。" },
  { label: "过度推断边界", text: "明确哪些句子不能直接引用，哪些需要回 PDF 核对页码和语境。" },
];

const documentCategories = [
  {
    id: "literature",
    label: "文献与论文",
    description: "已发表文献、综述、开题材料和论文草稿。",
    extensions: ["pdf", "doc", "docx"],
  },
  {
    id: "materials",
    label: "辅助材料",
    description: "暂存的非主线研究资料；当前不在主界面展示。",
    extensions: ["svg", "png", "jpg", "jpeg"],
  },
  {
    id: "raw-data",
    label: "原始数据",
    description: "LabRecorder XDF、EEG 原始文件和待进入分析队列的实验数据。",
    extensions: ["xdf", "edf", "set", "mat"],
  },
  {
    id: "analysis",
    label: "分析脚本与输出",
    description: "Python、MATLAB、notebook、统计表、中间特征表和写作产物。",
    extensions: ["py", "m", "ipynb", "csv", "tsv", "xlsx", "jsonl", "json"],
  },
  {
    id: "notes",
    label: "研究笔记",
    description: "读书笔记、讨论记录、图表说明和写作备忘。",
    extensions: ["txt", "md"],
  },
];

const libraryFilters: Array<{ id: LibraryFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "literature", label: "文献" },
  { id: "analysis", label: "分析产物" },
  { id: "notes", label: "笔记" },
];

const jobViewFilters: Array<{ id: JobViewFilter; label: string }> = [
  { id: "all", label: "全部任务" },
  { id: "active", label: "进行中" },
  { id: "completed", label: "已完成" },
  { id: "failed", label: "失败" },
  { id: "stale", label: "疑似卡住" },
];

const subjectMatrixFilters: Array<{ id: SubjectMatrixFilter; label: string }> = [
  { id: "all", label: "全部被试" },
  { id: "ready", label: "可提交" },
  { id: "missing", label: "缺文件" },
  { id: "active", label: "分析中" },
  { id: "completed", label: "已完成" },
  { id: "failed", label: "需处理" },
];

const writingTaskModes = [
  {
    id: "section-draft",
    label: "写论文章节",
    description: "先写目标章节正文，正文后列证据和待核对点。",
  },
  {
    id: "methods-analysis",
    label: "写方法与分析",
    description: "写方法、分析计划、模型和变量口径。",
  },
  {
    id: "evidence-map",
    label: "证据到段落",
    description: "把文献和报告整理成可放进论文的段落。",
  },
  {
    id: "review-revision",
    label: "审稿式修改",
    description: "按证据边界重写已有段落，保留修改理由。",
  },
] as const;

type WritingTaskModeId = (typeof writingTaskModes)[number]["id"];

const writingTargetSections = [
  { id: "introduction", label: "引言 / 相关研究" },
  { id: "literature-review", label: "文献综述" },
  { id: "theory-hypotheses", label: "理论模型与研究假设" },
  { id: "variables-measures", label: "变量与测量" },
  { id: "methods", label: "研究方法" },
  { id: "analysis-plan", label: "统计分析计划" },
  { id: "results", label: "结果" },
  { id: "discussion", label: "讨论" },
  { id: "abstract", label: "摘要" },
] as const;

type WritingTargetSectionId = (typeof writingTargetSections)[number]["id"];

const writingOutputModes = [
  { id: "manuscript", label: "完整论文正文" },
  { id: "structured", label: "章节结构 + 正文草稿" },
  { id: "audit", label: "审稿式改写与证据审计" },
] as const;

type WritingOutputModeId = (typeof writingOutputModes)[number]["id"];

const writingProtocolRules = [
  "引用必须来自文献知识库、已上传文献卡或真实分析报告。",
  "显著性、效应量、样本完成情况和页码不能编造。",
  "区分文献证据、项目假设、真实实验结果和需要补充的信息。",
  "中文段落要能直接进草稿；英文只留必要术语和文献原题。",
  "少用模板化转折，尤其少用“不是……而是……”。",
];

const thesisWritingBlueprint = [
  {
    section: "引言",
    task: "写清地铁应急疏散中目标提醒、现场标识和路径确认之间的研究问题。",
    evidence: "公共空间应急寻路、风险沟通、保护性行动指令、VR 疏散研究。",
  },
  {
    section: "文献综述",
    task: "按理论链条整合文献，避免按论文逐篇罗列。",
    evidence: "应急寻路、标识设计、路径确认、认知负荷、EEG/VR 方法。",
  },
  {
    section: "理论模型与假设",
    task: "定义路径确认支持、行动迟滞、信息可靠性、EEG 信息加工负荷和准确率。",
    evidence: "文献机制 + 本项目中等支持最高负荷假设。",
  },
  {
    section: "方法",
    task: "写清 VR 场景、三种路径确认支持条件、XDF/EEG/Unity marker 同步和排除规则。",
    evidence: "实验设计文档、Unity marker 字典、XDF 报告审计记录。",
  },
  {
    section: "结果",
    task: "只写真实分析产物中的统计量、图表和方向；缺结果时保留占位符。",
    evidence: "单被试 HTML、全样本 HTML、被试信息表与协变量报告。",
  },
  {
    section: "讨论",
    task: "解释行为和 EEG 是否一致，讨论替代解释、生态效度、marker 质量和样本边界。",
    evidence: "文献知识卡、真实统计结果、质控说明。",
  },
];

const writingWorkflowPresets: Array<{
  label: string;
  mode: WritingTaskModeId;
  section: WritingTargetSectionId;
  output: WritingOutputModeId;
  prompt: string;
}> = [
  {
    label: "引言正文",
    mode: "section-draft",
    section: "introduction",
    output: "manuscript",
    prompt:
      "请直接起草“引言”的中文论文正文，形成一个完整小节，避免输出提纲：从公共空间应急疏散中的官方提醒与现场标识脱节、路径确认信息链、准确性-努力权衡，到本研究为什么用 VR 地铁撤离和 EEG 检验行动迟滞。正文后再给出证据说明、可引用文献和不能声称的边界。",
  },
  {
    label: "文献综述整节",
    mode: "section-draft",
    section: "literature-review",
    output: "manuscript",
    prompt:
      "请写“文献综述”的完整中文小节，主题是应急导向中的路径确认信息链。需要整合应急寻路、标识/路径确认、预警与保护性行动指令、VR 疏散实验、EEG 认知负荷五类文献。不要只列文献，要写成有逻辑推进的论文段落，并在段落后给出证据链和研究缺口。",
  },
  {
    label: "理论模型与假设",
    mode: "section-draft",
    section: "theory-hypotheses",
    output: "manuscript",
    prompt:
      "请写“理论模型与研究假设”的完整中文部分。核心模型为：X=路径确认支持水平，Y=行动迟滞，M1=感知信息可靠性，M2=EEG 表征的信息加工负荷，W=保护性行动指令清晰度，辅助因变量=路径判断准确率。请逐步写出 H1-H5 的理论推导，尤其解释为什么中等支持是“可靠但未闭合”的状态，会导致最高迟滞和最高信息加工负荷。",
  },
  {
    label: "变量与测量",
    mode: "methods-analysis",
    section: "variables-measures",
    output: "manuscript",
    prompt:
      "请写“变量与测量”的中文论文正文，覆盖：路径确认支持水平的四个操纵维度（首次确认线索接近性、确认链连续性、关键决策点覆盖、平均线索间距）；行动迟滞的客观指标；路径判断准确率；感知信息可靠性的问卷项；信息加工负荷的 EEG/事件窗指标；保护性行动指令清晰度的操纵。不要编造尚未确认的设备参数、样本完成数或统计结果。",
  },
  {
    label: "研究方法正文",
    mode: "methods-analysis",
    section: "methods",
    output: "manuscript",
    prompt:
      "请起草“研究方法”的中文论文正文，覆盖被试与设计、VR 地铁撤离任务、低/中/高路径确认支持条件、保护性行动指令清晰度、Unity marker 与 LabRecorder XDF 同步、EEG 指标和行为指标。不要编造设备参数、实际样本完成数或尚未确认的排除标准。",
  },
  {
    label: "统计分析计划",
    mode: "methods-analysis",
    section: "analysis-plan",
    output: "structured",
    prompt:
      `请写一份可放入论文或预注册说明的中文统计分析计划：${EXPECTED_SUBJECT_COUNT} 名被试、每人 ${EXPECTED_RUNS_PER_SUBJECT} 个路径确认支持 run；sub001/sub002/sub003 归为 P01，sub004/sub005/sub006 归为 P02；Signature1/2/3 分别映射为低/中/高路径确认支持；主检验为 medium - mean(low, high)。请说明组内模型、可选被试协变量需要哪些字段、事件窗 EEG 指标、行动迟滞指标、路径判断准确率和多重比较策略。`,
  },
  {
    label: "结果模板",
    mode: "section-draft",
    section: "results",
    output: "manuscript",
    prompt:
      "请生成 Results 写作模板。只能使用已完成 XDF 或 cohort 报告中的真实统计结果；如果上下文没有真实结果，请用清晰占位符标记需要填入的统计量、置信区间、p 值和图表编号，不要写成已经显著。",
  },
  {
    label: "讨论边界",
    mode: "review-revision",
    section: "discussion",
    output: "audit",
    prompt:
      "请整理 Discussion 的可讨论机制、替代解释、局限和不能过度声称的边界。重点检查中等路径确认支持最高行动迟滞/信息加工负荷这一假设是否有文献类比支持、哪些内容必须等真实 EEG/行为结果支持，以及 VR 生态效度、marker 同步、个体差异、保护性行动指令清晰度和全样本统计的风险。",
  },
  {
    label: "审稿式自查",
    mode: "review-revision",
    section: "discussion",
    output: "audit",
    prompt:
      `请像审稿人一样检查当前写作思路：研究问题是否清楚、文献证据是否足够、变量定义是否一致、route-confirmation support 与 Signature 命名是否混用、EEG 指标解释是否过度、行动迟滞和准确率是否被区分、统计模型是否匹配 ${EXPECTED_SUBJECT_COUNT}×${EXPECTED_RUNS_PER_SUBJECT} 的组内设计。请给出可执行修改清单。`,
  },
];

export default function HomePage() {
  const hasConfig = hasSupabaseBrowserConfig();
  const supabase = useMemo(() => (hasConfig ? getSupabaseBrowserClient() : null), [hasConfig]);
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  if (!supabase) {
    return <LocalPreview />;
  }

  if (authLoading) {
    return <LoadingScreen />;
  }

  if (!session) {
    return <LoginScreen supabase={supabase} />;
  }

  return <Workspace supabase={supabase} session={session} user={session.user} />;
}

function LocalPreview() {
  return (
    <main className="preview-shell">
      <section className="preview-hero">
        <Brand />
        <div>
          <p className="eyebrow">本地预览模式</p>
          <h1>{researchProject.name}</h1>
          <p>{researchProject.subtitle}</p>
        </div>
        <p className="auth-warning">
          当前未连接 Supabase。配置 `.env.local` 后会启用登录、私有文件上传和后端 AI。
        </p>
      </section>
    </main>
  );
}

function LoadingScreen() {
  return (
    <main className="auth-screen compact-auth">
      <section className="auth-panel">
        <Brand />
        <p className="muted">正在检查登录状态...</p>
      </section>
    </main>
  );
}

function LoginScreen({ supabase }: { supabase: SupabaseClient }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError(getAuthErrorMessage(signInError.message));
    }

    setLoading(false);
  }

  return (
    <main className="auth-screen">
      <section className="auth-panel">
        <Brand />
        <div className="auth-copy">
          <p className="eyebrow">研究工作台</p>
          <h1>进入私人论文研究空间</h1>
          <p>集中管理文献知识库、XDF 原始数据、分析脚本、统计结果和论文写作材料。</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <label>
            登录邮箱
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="例如：you@example.com"
              autoComplete="email"
              required
            />
          </label>
          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error ? <p className="auth-error">{error}</p> : null}
          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? "登录中..." : "进入工作台"}
          </button>
        </form>

        <p className="auth-warning">
          这里只允许已创建账号的用户进入。真实论文、实验数据和分析笔记都应该留在私人空间里。
        </p>
      </section>

      <aside className="auth-aside">
        <PreviewCard title="资料结构" text="按文献知识库、XDF 原始数据、分析产物和写作材料维护项目资料。" />
        <PreviewCard title="写作原则" text="所有结论回到上传材料和真实分析结果，不替研究编造发现。" />
      </aside>
    </main>
  );
}

function Workspace({
  supabase,
  session,
  user,
}: {
  supabase: SupabaseClient;
  session: Session;
  user: User;
}) {
  const [documents, setDocuments] = useState<ResearchDocument[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<ResearchDocument | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadMessage, setUploadMessage] = useState("");
  const [xdfUploadState, setXdfUploadState] = useState<UploadState>("idle");
  const [xdfUploadMessage, setXdfUploadMessage] = useState("");
  const [xdfUploadProgress, setXdfUploadProgress] = useState<UploadProgress>(null);
  const [showAnalysisGuide, setShowAnalysisGuide] = useState(false);
  const [writingMode, setWritingMode] = useState<WritingTaskModeId>("section-draft");
  const [writingSection, setWritingSection] = useState<WritingTargetSectionId>("introduction");
  const [writingOutputMode, setWritingOutputMode] = useState<WritingOutputModeId>("manuscript");
  const [researchNote, setResearchNote] = useState(writingWorkflowPresets[0].prompt);
  const [aiState, setAiState] = useState<AiState>({ status: "idle", output: "" });
  const [analysisJobs, setAnalysisJobs] = useState<ResearchAnalysisJob[]>([]);
  const [jobMessage, setJobMessage] = useState("");
  const [jobLoading, setJobLoading] = useState(false);
  const [knowledgeEntries, setKnowledgeEntries] = useState<LiteratureKnowledgeEntry[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeMessage, setKnowledgeMessage] = useState("");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("all");
  const [jobViewFilter, setJobViewFilter] = useState<JobViewFilter>("all");
  const [subjectMatrixFilter, setSubjectMatrixFilter] = useState<SubjectMatrixFilter>("all");
  const [jobsLastLoadedAt, setJobsLastLoadedAt] = useState<string | null>(null);
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([]);
  const [batchSubjectId, setBatchSubjectId] = useState("");
  const [subjectMetadataCsv, setSubjectMetadataCsv] = useState("participant_id,vr_experience,route_familiarity,run_order\nP01,low,unfamiliar,1\nP02,high,unfamiliar,2");
  const [groupVariable, setGroupVariable] = useState("vr_experience");
  const selectedWritingMode = writingTaskModes.find((mode) => mode.id === writingMode) ?? writingTaskModes[0];
  const selectedWritingSection =
    writingTargetSections.find((section) => section.id === writingSection) ?? writingTargetSections[0];
  const selectedWritingOutput =
    writingOutputModes.find((outputMode) => outputMode.id === writingOutputMode) ?? writingOutputModes[0];

  useEffect(() => {
    void loadDocuments();
    void loadAnalysisJobs();
    void loadKnowledgeBase();
    const intervalId = window.setInterval(() => {
      void loadAnalysisJobs();
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, []);

  const researchDocuments = useMemo(() => documents.filter((document) => !isXdfDocument(document)), [documents]);
  const groupedDocuments = useMemo(
    () => {
      const query = libraryQuery.trim().toLowerCase();
      return documentCategories
        .filter((category) => category.id !== "materials" && category.id !== "raw-data")
        .map((category) => ({
          ...category,
          documents: researchDocuments.filter((document) => {
            const documentCategory = getDocumentCategory(document);
            const matchesCategory = libraryFilter === "all" || documentCategory.id === libraryFilter;
            const matchesQuery =
              !query ||
              document.filename.toLowerCase().includes(query) ||
              document.storage_path.toLowerCase().includes(query);
            return documentCategory.id === category.id && matchesCategory && matchesQuery;
          }),
        }));
    },
    [researchDocuments, libraryFilter, libraryQuery],
  );
  const selectedCategory = selectedDocument ? getDocumentCategory(selectedDocument) : null;
  const selectedDocumentIsLiterature = selectedDocument ? isLiteratureDocument(selectedDocument) : false;
  const totalStoredBytes = documents.reduce((total, document) => total + (document.size_bytes ?? 0), 0);
  const researchStoredBytes = researchDocuments.reduce((total, document) => total + (document.size_bytes ?? 0), 0);
  const filteredDocumentCount = groupedDocuments.reduce((total, group) => total + group.documents.length, 0);
  const literatureDocuments = useMemo(() => researchDocuments.filter(isLiteratureDocument), [researchDocuments]);
  const analysisProductDocuments = useMemo(
    () => researchDocuments.filter((document) => getDocumentCategory(document).id === "analysis"),
    [researchDocuments],
  );
  const noteDocuments = useMemo(() => researchDocuments.filter((document) => getDocumentCategory(document).id === "notes"), [researchDocuments]);
  const xdfDocuments = useMemo(() => documents.filter(isXdfDocument), [documents]);
  const selectedBatchDocuments = useMemo(
    () => xdfDocuments.filter((document) => selectedBatchIds.includes(document.id)),
    [selectedBatchIds, xdfDocuments],
  );
  const inferredSubjectGroups = useMemo(() => groupXdfDocumentsBySubject(xdfDocuments), [xdfDocuments]);
  const latestJobByDocumentId = useMemo(() => buildLatestJobByDocumentId(analysisJobs), [analysisJobs]);
  const knowledgeCardByDocumentId = useMemo(
    () => new Map(knowledgeEntries.map((entry) => [entry.document.id, entry.card])),
    [knowledgeEntries],
  );
  const seedMatchByDocumentId = useMemo(
    () => new Map(knowledgeEntries.map((entry) => [entry.document.id, entry.seedMatch])),
    [knowledgeEntries],
  );
  const xdfJobStats = useMemo(() => getXdfJobStats(analysisJobs), [analysisJobs]);
  const completedSubjectBatchCount = useMemo(() => countCompletedSubjectBatchJobs(analysisJobs), [analysisJobs]);
  const subjectMatrixRows = useMemo(() => buildSubjectMatrixRows(xdfDocuments, analysisJobs), [xdfDocuments, analysisJobs]);
  const subjectMatrixStats = useMemo(() => summarizeSubjectMatrix(subjectMatrixRows), [subjectMatrixRows]);
  const filteredSubjectMatrixRows = useMemo(
    () => subjectMatrixRows.filter((row) => filterSubjectMatrixRow(row, subjectMatrixFilter)),
    [subjectMatrixRows, subjectMatrixFilter],
  );
  const runnableSubjectGroupCount = useMemo(
    () => inferredSubjectGroups.filter((group) => isRunnableSubjectGroup(group, analysisJobs)).length,
    [inferredSubjectGroups, analysisJobs],
  );
  const selectedKnowledgeCard = selectedDocument ? knowledgeCardByDocumentId.get(selectedDocument.id) ?? null : null;
  const selectedSeedMatch = selectedDocument ? seedMatchByDocumentId.get(selectedDocument.id) ?? null : null;
  const selectedDisplayName = selectedDocument ? getDocumentDisplayName(selectedDocument, selectedKnowledgeCard, selectedSeedMatch) : "";
  const filteredXdfJobs = useMemo(
    () =>
      analysisJobs
        .filter(isXdfAnalysisJob)
        .filter((job) => filterJobForView(job, jobViewFilter))
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    [analysisJobs, jobViewFilter],
  );
  const xdfUploadDisabled = xdfUploadState === "uploading";
  const xdfFolderInputProps = {
    type: "file",
    multiple: true,
    onChange: handleXdfUpload,
    disabled: xdfUploadDisabled,
    webkitdirectory: "",
    directory: "",
  } as React.InputHTMLAttributes<HTMLInputElement> & { webkitdirectory: string; directory: string };

  async function loadDocuments() {
    const { data, error } = await supabase
      .from("research_documents")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setUploadMessage(`读取文件列表失败：${error.message}`);
      return;
    }

    const nextDocuments = (data ?? []) as ResearchDocument[];
    setDocuments(nextDocuments);
    setSelectedDocument((current) => {
      const currentStillVisible = current ? nextDocuments.some((document) => document.id === current.id) && !isXdfDocument(current) : false;
      return currentStillVisible ? current : nextDocuments.find((document) => !isXdfDocument(document)) ?? null;
    });
  }

  async function loadAnalysisJobs() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? session.access_token;

    const response = await fetch("/api/analysis/jobs", {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) return;

    const payload = (await response.json()) as { jobs?: ResearchAnalysisJob[] };
    setAnalysisJobs(payload.jobs ?? []);
    setJobsLastLoadedAt(new Date().toISOString());
  }

  async function loadKnowledgeBase() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? session.access_token;

    const response = await fetch("/api/literature/knowledge", {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) return;

    const payload = (await response.json()) as {
      cards?: LiteratureKnowledgeEntry[];
    };
    setKnowledgeEntries(payload.cards ?? []);
  }

  async function handleResearchUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    const xdfFiles = files.filter((file) => isXdfUploadFile(file));

    if (xdfFiles.length) {
      setUploadState("error");
      setUploadMessage("研究资料库不接收 XDF。请到“数据分析与写作”里的 XDF 上传入口上传实验数据。");
      event.target.value = "";
      return;
    }

    setUploadState("uploading");
    setUploadMessage("");

    let uploaded = 0;
    for (const file of files) {
      try {
        await uploadDocumentFile(file, getResearchUploadCollection(file.name, file.type));
      } catch (error) {
        setUploadState("error");
        setUploadMessage(`已上传 ${uploaded}/${files.length} 个研究资料；${error instanceof Error ? error.message : "上传失败"}`);
        event.target.value = "";
        await loadDocuments();
        return;
      }

      uploaded += 1;
    }

    setUploadState("done");
    setUploadMessage(`${uploaded} 个研究资料已上传到私有存储。文献、笔记、脚本和分析产物会在研究资料库中分区显示。`);
    event.target.value = "";
    await loadDocuments();
    await loadKnowledgeBase();
  }

  async function handleXdfUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    await uploadXdfFiles(files);
    event.target.value = "";
  }

  async function handleXdfDirectoryPickerUpload() {
    const showDirectoryPicker = (window as WindowWithDirectoryPicker).showDirectoryPicker;
    if (!showDirectoryPicker) {
      setXdfUploadState("warning");
      setXdfUploadProgress(null);
      setXdfUploadMessage("当前浏览器不支持递归目录扫描。可以先用“上传 XDF 文件夹”；Chrome 和 Edge 通常支持自动扫描多层子文件夹。");
      return;
    }

    try {
      const rootDirectory = await showDirectoryPicker({ id: "xdf-recursive-root", mode: "read" });
      setXdfUploadState("uploading");
      setXdfUploadProgress(null);
      setXdfUploadMessage(`正在扫描“${rootDirectory.name}”及其所有子文件夹，自动寻找 .xdf 文件。`);

      const scanResult = await collectXdfFilesFromDirectory(rootDirectory);
      const skippedCount = scanResult.inspectedFiles - scanResult.files.length;
      if (!scanResult.files.length) {
        setXdfUploadState("error");
        setXdfUploadProgress(null);
        setXdfUploadMessage(
          `已扫描 ${scanResult.visitedDirectories} 个文件夹、${scanResult.inspectedFiles} 个文件，但没有找到 .xdf 文件。`,
        );
        return;
      }

      setXdfUploadMessage(
        `已扫描 ${scanResult.visitedDirectories} 个文件夹、${scanResult.inspectedFiles} 个文件，找到 ${scanResult.files.length} 个 XDF，开始上传。`,
      );
      await uploadXdfFiles(scanResult.files, skippedCount);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setXdfUploadState("idle");
        setXdfUploadProgress(null);
        setXdfUploadMessage("");
        return;
      }
      setXdfUploadState("error");
      setXdfUploadProgress(null);
      setXdfUploadMessage(error instanceof Error ? `扫描文件夹失败：${error.message}` : "扫描文件夹失败。");
    }
  }

  async function uploadXdfFiles(files: File[], precomputedSkippedCount = 0) {
    const xdfFiles = files.filter(isXdfUploadFile).sort(compareXdfUploadFiles);
    const skippedCount = precomputedSkippedCount + files.length - xdfFiles.length;

    if (!xdfFiles.length) {
      setXdfUploadState("error");
      setXdfUploadProgress(null);
      setXdfUploadMessage("没有识别到 .xdf 文件。可以一次选择多个 XDF，或直接选择包含 XDF 的文件夹。");
      return;
    }

    setXdfUploadState("uploading");
    setXdfUploadProgress({
      total: xdfFiles.length,
      completed: 0,
      uploaded: 0,
      failed: 0,
      skipped: skippedCount,
    });
    setXdfUploadMessage(formatXdfBulkUploadMessage({ total: xdfFiles.length, completed: 0, uploaded: 0, failed: 0 }, skippedCount));

    const result = await uploadFilesConcurrently(
      xdfFiles,
      "xdf-raw",
      XDF_BULK_UPLOAD_CONCURRENCY,
      (snapshot) => {
        setXdfUploadProgress({ ...snapshot, skipped: skippedCount });
        setXdfUploadMessage(formatXdfBulkUploadMessage(snapshot, skippedCount));
      },
    );

    const failureText = formatUploadFailureSummary(result.failures);
    if (result.failures.length) {
      setXdfUploadState(result.uploaded ? "warning" : "error");
      setXdfUploadMessage(
        `${result.uploaded}/${xdfFiles.length} 个 XDF 已上传，${result.failures.length} 个失败。${skippedCount ? `已忽略 ${skippedCount} 个非 XDF 文件。` : ""}${failureText}`,
      );
    } else {
      setXdfUploadState("done");
      setXdfUploadMessage(
        `${result.uploaded} 个 XDF 已批量上传到实验数据区。${skippedCount ? `已忽略 ${skippedCount} 个非 XDF 文件。` : ""}系统会按 001/002/003 三连号推断被试，并按 Signature1/2/3 推断低/中/高路径确认支持。`,
      );
    }

    await loadDocuments();
  }

  async function uploadFilesConcurrently(
    files: File[],
    collection: string,
    concurrency: number,
    onProgress: (snapshot: UploadBatchSnapshot) => void,
  ) {
    let nextIndex = 0;
    let uploaded = 0;
    const failures: UploadBatchFailure[] = [];
    const workerCount = Math.max(1, Math.min(concurrency, files.length));

    async function worker() {
      while (nextIndex < files.length) {
        const file = files[nextIndex];
        nextIndex += 1;
        try {
          await uploadDocumentFile(file, collection);
          uploaded += 1;
        } catch (error) {
          failures.push({
            filename: getUploadFileDisplayName(file),
            message: error instanceof Error ? error.message : "上传失败",
          });
        } finally {
          onProgress({
            total: files.length,
            completed: uploaded + failures.length,
            uploaded,
            failed: failures.length,
            currentFile: getUploadFileDisplayName(file),
          });
        }
      }
    }

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return { uploaded, failures };
  }

  async function uploadDocumentFile(file: File, collection: string) {
    const storagePath = buildStoragePath(user.id, file.name, collection);
    const { error: uploadError } = await supabase.storage.from("research-files").upload(storagePath, file, {
      cacheControl: "3600",
      upsert: false,
    });

    if (uploadError) {
      throw new Error(`${file.name} 上传失败：${uploadError.message}`);
    }

    const { error: insertError } = await supabase.from("research_documents").insert({
      user_id: user.id,
      filename: file.name,
      storage_path: storagePath,
      mime_type: file.type || null,
      size_bytes: file.size,
      notes: buildUploadNotes(file),
    });

    if (insertError) {
      throw new Error(`${file.name} 元数据保存失败：${insertError.message}`);
    }
  }

  async function openSignedUrl(document: ResearchDocument) {
    const { data, error } = await supabase.storage
      .from("research-files")
      .createSignedUrl(document.storage_path, 60 * 5);

    if (error || !data?.signedUrl) {
      setUploadMessage(`生成临时访问链接失败：${error?.message ?? "未知错误"}`);
      return;
    }

    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function downloadJobHtmlReport(job: ResearchAnalysisJob) {
    const artifact = getJobHtmlReport(job);
    if (!artifact) {
      setJobMessage("这个任务还没有 HTML 报告文件。旧任务需要重新运行一次 XDF 高级分析，新的 worker 才会生成可下载 HTML。");
      return;
    }

    const { data, error } = await supabase.storage
      .from("research-files")
      .createSignedUrl(artifact.storagePath, 60 * 10, {
        download: artifact.filename ?? "xdf-analysis-report.html",
      });

    if (error || !data?.signedUrl) {
      setJobMessage(`生成 HTML 报告下载链接失败：${error?.message ?? "未知错误"}`);
      return;
    }

    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  function downloadSubjectMatrixCsv(rows = subjectMatrixRows) {
    const csv = buildSubjectMatrixCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `metro-rescue-xdf-matrix-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setJobMessage(`已导出 ${rows.length} 行被试 XDF 管理矩阵。`);
  }

  async function runAiAssistant() {
    setAiState({ status: "loading", output: "" });
    const accessToken = session.access_token;
    const context = selectedDocument
      ? `文件名：${selectedDocument.filename}\nMIME：${selectedDocument.mime_type ?? "unknown"}\n备注：${selectedDocument.notes ?? ""}`
      : "当前还没有选择文件。";

    const response = await fetch("/api/ai/research-assistant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        prompt: researchNote,
        context,
        taskMode: selectedWritingMode.label,
        targetSection: selectedWritingSection.label,
        outputMode: selectedWritingOutput.label,
      }),
    });

    const payload = (await response.json()) as { output?: string; error?: string };

    if (!response.ok) {
      setAiState({ status: "error", output: payload.error ?? "AI 请求失败。" });
      return;
    }

    setAiState({ status: "done", output: payload.output ?? "" });
  }

  async function runSubjectBatchAnalysis(documentIds = selectedBatchIds, subjectId = batchSubjectId) {
    const uniqueDocumentIds = Array.from(new Set(documentIds));
    if (uniqueDocumentIds.length < 2) {
      setJobMessage("至少选择 2 个 XDF。正式数据最好按同一被试的低/中/高 3 个 run 一起提交。");
      return;
    }

    setJobLoading(true);
    setJobMessage("");

    const payload = await createSubjectBatchJob(
      uniqueDocumentIds,
      subjectId.trim() || inferSubjectIdFromFilename(selectedBatchDocuments[0]?.filename ?? ""),
    );
    if (payload.error && !payload.job) {
      setJobMessage(payload.error ?? "被试批量 XDF 分析任务创建失败。");
      setJobLoading(false);
      return;
    }

    setJobMessage(payload.warning ?? `已提交 ${uniqueDocumentIds.length} 个 XDF 的被试路径确认支持条件批量分析任务。`);
    await loadAnalysisJobs();
    setJobLoading(false);
  }

  async function createSubjectBatchJob(uniqueDocumentIds: string[], subjectId: string) {
    const response = await fetch("/api/analysis/jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        documentIds: uniqueDocumentIds,
        subjectId,
        analysisType: "subject_batch",
      }),
    });

    return (await response.json()) as { job?: ResearchAnalysisJob; error?: string; warning?: string };
  }

  async function runAllCompleteSubjectBatches() {
    const runnableGroups = inferredSubjectGroups.filter((group) => isRunnableSubjectGroup(group, analysisJobs));
    if (!runnableGroups.length) {
      setJobMessage("没有可批量提交的完整被试组。请确认每名被试已有低/中/高 3 个 XDF，且没有正在运行或已完成的同被试批量任务。");
      return;
    }

    setJobLoading(true);
    setJobMessage(`正在提交 ${runnableGroups.length} 个被试的组内分析任务。`);

    let submitted = 0;
    let lastWarning = "";
    for (const group of runnableGroups) {
      const payload = await createSubjectBatchJob(
        group.documents.map((document) => document.id),
        group.subjectId,
      );
      if (payload.error && !payload.job) {
        setJobMessage(`已提交 ${submitted}/${runnableGroups.length} 个被试；${group.subjectId} 提交失败：${payload.error}`);
        setJobLoading(false);
        await loadAnalysisJobs();
        return;
      }
      if (payload.warning) lastWarning = payload.warning;
      submitted += 1;
      setJobMessage(`已提交 ${submitted}/${runnableGroups.length} 个被试的组内分析任务。`);
    }

    setJobMessage(lastWarning || `已提交 ${submitted} 个被试的组内分析任务。GitHub Actions 会逐个运行，完成后可再生成全样本汇总报告。`);
    await loadAnalysisJobs();
    setJobLoading(false);
  }

  async function runCohortDensitySummary() {
    if (!xdfDocuments.length) {
      setJobMessage("还没有 XDF 文件，无法创建全样本汇总任务。");
      return;
    }
    if (!completedSubjectBatchCount) {
      setJobMessage("还没有已完成的被试批量报告。请先按被试提交低/中/高路径确认支持 XDF 分析。");
      return;
    }

    setJobLoading(true);
    setJobMessage("");

    const response = await fetch("/api/analysis/jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        documentId: xdfDocuments[0].id,
        analysisType: "cohort_density_summary",
        subjectMetadataCsv,
        groupVariable,
      }),
    });

    const payload = (await response.json()) as { job?: ResearchAnalysisJob; error?: string; warning?: string };
    if (!response.ok && !payload.job) {
      setJobMessage(payload.error ?? "全样本路径确认支持统计汇总任务创建失败。");
      setJobLoading(false);
      return;
    }

    setJobMessage(payload.warning ?? `已提交全样本路径确认支持统计汇总任务，将汇总 ${completedSubjectBatchCount} 个已完成被试报告。`);
    await loadAnalysisJobs();
    setJobLoading(false);
  }

  async function handleMetadataFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setJobMessage("被试信息表目前请上传 CSV；Excel 可以先另存为 .csv。");
      event.target.value = "";
      return;
    }
    const text = await file.text();
    setSubjectMetadataCsv(text.trim());
    const header = text.split(/\r?\n/)[0] ?? "";
    const columns = header.split(",").map((column) => column.trim()).filter(Boolean);
    if (!columns.includes(groupVariable)) {
      const nextVariable = columns.find((column) => !["participant_id", "participant", "subject_id", "subject", "id", "被试编号", "被试"].includes(column));
      if (nextVariable) setGroupVariable(nextVariable);
    }
    setJobMessage(`已读取被试信息 CSV：${file.name}。如需解释个体差异，请确认协变量列名；不需要协变量时也可以直接生成全样本报告。`);
    event.target.value = "";
  }

  async function deleteAnalysisJobs(jobIds: string[]) {
    const uniqueJobIds = Array.from(new Set(jobIds));
    if (!uniqueJobIds.length) {
      setJobMessage("当前没有可清理的任务。");
      return;
    }

    setJobLoading(true);
    const response = await fetch("/api/analysis/jobs", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ jobIds: uniqueJobIds }),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setJobMessage(payload.error ?? "删除任务失败。");
      setJobLoading(false);
      return;
    }

    setJobMessage(`已删除 ${uniqueJobIds.length} 个任务。`);
    await loadAnalysisJobs();
    setJobLoading(false);
  }

  function toggleBatchDocument(documentId: string) {
    setSelectedBatchIds((current) =>
      current.includes(documentId) ? current.filter((id) => id !== documentId) : [...current, documentId],
    );
  }

  async function buildLiteratureKnowledgeCard() {
    if (!selectedDocument || !selectedDocumentIsLiterature) {
      setKnowledgeMessage("请先选择一篇文献 PDF、Markdown 或 TXT。");
      return;
    }

    setKnowledgeLoading(true);
    setKnowledgeMessage("");

    const response = await fetch("/api/literature/knowledge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        documentId: selectedDocument.id,
      }),
    });

    const payload = (await response.json()) as {
      card?: LiteratureKnowledgeCard;
      seedMatch?: SeedLiteratureMatch;
      status?: "created-card" | "existing-card" | "seed-existing";
      message?: string;
      error?: string;
    };
    if (!response.ok || (!payload.card && !payload.seedMatch)) {
      setKnowledgeMessage(payload.error ?? "文献知识卡片生成失败。");
      setKnowledgeLoading(false);
      return;
    }

    setKnowledgeMessage(
      payload.message ??
        (payload.seedMatch
          ? `这篇文献已入库（${payload.seedMatch.sourceId}：${payload.seedMatch.title}），不会重复调用 OpenAI。`
          : "文献知识卡片已更新，写作助手会优先引用知识库。"),
    );
    await loadDocuments();
    await loadKnowledgeBase();
    setKnowledgeLoading(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <Brand />
        <nav className="nav-list" aria-label="Workspace navigation">
          <a className="nav-item is-active" href="#overview">
            项目概览
          </a>
          <a className="nav-item" href="#pipeline">
            数据分析与写作
          </a>
          <a className="nav-item" href="#ai">
            文献与写作助手
          </a>
          <a className="nav-item" href="#files">
            研究资料库
          </a>
          <a className="nav-item" href="#knowledge">
            知识库审阅
          </a>
        </nav>
        <div className="side-note">
          <span className="note-label">当前账号</span>
          <p>{user.email}</p>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">项目空间</p>
            <h1>Metro Rescue</h1>
          </div>
          <div className="top-actions">
            <span className="status-pill compact">私人空间</span>
            <button className="secondary-button" onClick={signOut}>
              退出
            </button>
          </div>
        </header>

        <section className="view is-visible" id="overview">
          <div className="module-overview">
            <section className="project-summary">
              <p className="eyebrow">项目概览</p>
              <h2>VR 地铁撤离中的导向标识与 EEG 认知负荷研究</h2>
              <p className="summary-text">
                按文献知识库、XDF 原始数据、分析结果和写作材料分区管理，用于检索、分析和论文写作引用。
              </p>
              <div className="module-grid">
                {workspaceModules.map((module) => (
                  <a className="module-card" href={module.href} key={module.title}>
                    <strong>{module.title}</strong>
                    <p>{module.text}</p>
                  </a>
                ))}
              </div>
            </section>

            <aside className="project-summary compact-summary">
              <p className="eyebrow">资料摘要</p>
              <dl className="status-list">
                <div>
                  <dt>已入库文件</dt>
                  <dd>{documents.length}</dd>
                </div>
                <div>
                  <dt>文献文件</dt>
                  <dd>{literatureDocuments.length}</dd>
                </div>
                <div>
                  <dt>存储容量</dt>
                  <dd>{formatBytes(totalStoredBytes)}</dd>
                </div>
              </dl>
            </aside>
          </div>
        </section>

        <section className="view is-visible" id="files">
          <div className="section-head">
            <div>
              <p className="eyebrow">研究资料库</p>
              <h2>文献、笔记、脚本与写作材料</h2>
            </div>
            <div className="top-actions">
              <button
                className="secondary-button"
                onClick={() => {
                  void loadDocuments();
                  void loadKnowledgeBase();
                }}
              >
                刷新资料
              </button>
              <label className="file-button">
                <input
                  type="file"
                  multiple
                  accept={RESEARCH_FILE_ACCEPT}
                  onChange={handleResearchUpload}
                />
                {uploadState === "uploading" ? "上传资料中..." : "上传研究资料"}
              </label>
            </div>
          </div>

          {uploadMessage ? <p className={`notice ${uploadState}`}>{uploadMessage}</p> : null}

          <div className="library-status-grid">
            <StatusMetric label="资料文件" value={researchDocuments.length} text={formatBytes(researchStoredBytes)} />
            <StatusMetric label="文献文件" value={literatureDocuments.length} text="PDF / DOC / TXT / MD" />
            <StatusMetric label="分析产物" value={analysisProductDocuments.length} text="脚本、表格与中间结果" />
            <StatusMetric label="研究笔记" value={noteDocuments.length} text="TXT / MD" />
          </div>

          <div className="manager-toolbar">
            <label className="search-field">
              文件检索
              <input
                type="search"
                value={libraryQuery}
                placeholder="按标题、文件名、扩展名搜索"
                onChange={(event) => setLibraryQuery(event.target.value)}
              />
            </label>
            <div className="segmented-control" aria-label="资料类型筛选">
              {libraryFilters.map((filter) => (
                <button
                  className={libraryFilter === filter.id ? "is-active" : ""}
                  key={filter.id}
                  onClick={() => setLibraryFilter(filter.id)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          <div className="library-layout manager-layout">
            <section className="work-panel document-list structured-list file-browser">
              <div className="panel-title-row">
                <div>
                  <p className="eyebrow">资料列表</p>
                  <h3>{filteredDocumentCount} 个匹配文件</h3>
                </div>
                <span className="status-pill compact">最近刷新 {jobsLastLoadedAt ? new Date(jobsLastLoadedAt).toLocaleTimeString("zh-CN") : "-"}</span>
              </div>
              {filteredDocumentCount ? (
                groupedDocuments.map((group) =>
                  group.documents.length ? (
                    <div className="document-group" key={group.id}>
                      <div className="document-group-head">
                        <strong>{group.label}</strong>
                        <span>{group.documents.length} 个文件</span>
                      </div>
                      {group.documents.map((document) => {
                        const knowledgeCard = knowledgeCardByDocumentId.get(document.id) ?? null;
                        const seedMatch = seedMatchByDocumentId.get(document.id) ?? null;
                        const displayName = getDocumentListTitle(document, knowledgeCard, seedMatch);

                        return (
                          <button
                            className={`document-item ${selectedDocument?.id === document.id ? "is-active" : ""}`}
                            key={document.id}
                            onClick={() => setSelectedDocument(document)}
                          >
                            <div className="document-item-main">
                              <strong>{displayName}</strong>
                              <span>{formatDocumentListMeta(document)}</span>
                            </div>
                            <DocumentStatusBadge
                              document={document}
                              job={latestJobByDocumentId.get(document.id) ?? null}
                              knowledgeCard={knowledgeCard}
                              seedMatch={seedMatch}
                            />
                          </button>
                        );
                      })}
                    </div>
                  ) : null,
                )
              ) : (
                <p className="muted">
                  {documents.length
                    ? "没有符合当前搜索或筛选条件的文件。可以换一个关键词，或切回“全部”。"
                    : "还没有文件。上传后会按文献知识库、XDF 原始数据、分析脚本与输出、研究笔记分区显示。"}
                </p>
              )}
            </section>

            <section className="work-panel document-detail inspector-panel">
              <div className="analysis-head">
                <div>
                  <p className="eyebrow">资料操作</p>
                  <h3>{selectedDocument ? selectedDisplayName : "选择左侧文件后操作"}</h3>
                </div>
                {selectedCategory ? <span className="category-badge">{selectedCategory.label}</span> : null}
              </div>
              <p className="muted">
                {selectedDocument
                  ? `入库信息：${formatDocumentListMeta(selectedDocument)}。文件保持私有，打开时会生成短时间有效的临时链接。`
                  : "左侧资料只显示标题和入库信息；这里保留必要操作。"}
              </p>
              <div className="top-actions">
                <button
                  className="secondary-button"
                  disabled={!selectedDocument}
                  onClick={() => selectedDocument && openSignedUrl(selectedDocument)}
                >
                  打开文件
                </button>
              </div>
              {selectedDocumentIsLiterature ? (
                <p className="muted">
                  文献入库会检查是否已有知识卡；新文献才会生成单篇结构化卡片，供写作助手引用。
                </p>
              ) : null}
              {selectedDocumentIsLiterature && selectedSeedMatch ? (
                <p className="muted">
                  这篇文献已在知识库中。点击生成时会直接提示已存在，不会重复调用外部模型。
                </p>
              ) : null}
              {selectedDocumentIsLiterature ? (
                <button className="primary-button" disabled={!selectedDocument || knowledgeLoading} onClick={buildLiteratureKnowledgeCard}>
                  {knowledgeLoading ? "正在生成知识卡片..." : "生成知识卡片"}
                </button>
              ) : null}
              {knowledgeMessage ? <p className="muted">{knowledgeMessage}</p> : null}
            </section>
          </div>
        </section>

        <section className="view is-visible" id="knowledge">
          <div className="section-head">
            <div>
              <p className="eyebrow">知识库审阅</p>
              <h2>文献知识库</h2>
            </div>
            <button className="secondary-button" onClick={loadKnowledgeBase}>
              刷新知识库
            </button>
          </div>
          <LiteratureCardBlueprintPanel />
          <SeedKnowledgeReviewPanel entries={knowledgeEntries} />
        </section>

        <section className="view is-visible" id="pipeline">
          <div className="section-head">
            <div>
              <p className="eyebrow">数据分析与论文写作</p>
              <h2>XDF 批量分析与报告</h2>
            </div>
            <div className="top-actions">
              <button className="secondary-button" type="button" onClick={() => setShowAnalysisGuide((current) => !current)}>
                {showAnalysisGuide ? "收起解释" : "解释字段和方法"}
              </button>
              <button
                className="secondary-button"
                disabled={jobLoading || !completedSubjectBatchCount || !xdfDocuments.length}
                onClick={runCohortDensitySummary}
              >
                生成全样本报告
              </button>
              <button className="secondary-button" onClick={loadAnalysisJobs}>
                刷新任务
              </button>
              <label className={`file-button ${xdfUploadDisabled ? "is-disabled" : ""}`}>
                <input type="file" multiple accept={XDF_FILE_ACCEPT} disabled={xdfUploadDisabled} onChange={handleXdfUpload} />
                {xdfUploadDisabled ? "正在批量上传..." : "选择 XDF 文件"}
              </label>
              <label className={`file-button ${xdfUploadDisabled ? "is-disabled" : ""}`}>
                <input {...xdfFolderInputProps} />
                上传 XDF 文件夹
              </label>
              <button className="secondary-button" type="button" disabled={xdfUploadDisabled} onClick={handleXdfDirectoryPickerUpload}>
                递归扫描大文件夹
              </button>
            </div>
          </div>
          {xdfUploadMessage ? <p className={`notice ${xdfUploadState}`}>{xdfUploadMessage}</p> : null}
          <UploadProgressPanel progress={xdfUploadProgress} state={xdfUploadState} />
          {jobMessage ? <p className="notice">{jobMessage}</p> : null}
          {showAnalysisGuide ? <AnalysisMethodologyGuidePanel onClose={() => setShowAnalysisGuide(false)} /> : null}
          <div className="library-status-grid pipeline-status-grid">
            <StatusMetric label="XDF 文件" value={xdfDocuments.length} text="LabRecorder EEG + Unity marker" />
            <StatusMetric label="已选择" value={selectedBatchIds.length} text="待提交" />
            <StatusMetric label="进行中" value={xdfJobStats.active} text="pending / queued / running" />
            <StatusMetric label="已完成" value={xdfJobStats.completed} text="可下载 HTML 报告" />
            <StatusMetric label="失败/需处理" value={xdfJobStats.failed + xdfJobStats.stale} text="失败或太久没更新" tone="warn" />
          </div>
          <H1EvidencePanel />
          <XdfSubjectMatrixPanel
            rows={filteredSubjectMatrixRows}
            stats={subjectMatrixStats}
            filter={subjectMatrixFilter}
            jobLoading={jobLoading}
            onFilterChange={setSubjectMatrixFilter}
            onRunAllComplete={runAllCompleteSubjectBatches}
            onDownloadCsv={() => downloadSubjectMatrixCsv(filteredSubjectMatrixRows)}
            onRunSubject={(row) => {
              const documentsForRun = densityLevels
                .map((level) => row.documentsByDensity[level])
                .filter((document): document is ResearchDocument => Boolean(document));
              setBatchSubjectId(row.subjectId);
              setSelectedBatchIds(documentsForRun.map((document) => document.id));
              void runSubjectBatchAnalysis(
                documentsForRun.map((document) => document.id),
                row.subjectId,
              );
            }}
            onDownloadReport={downloadJobHtmlReport}
            onDeleteJob={(job) => deleteAnalysisJobs([job.id])}
          />
          <AnalysisPipelinePanel />
          <UnityMarkerDictionaryPanel />
          <SubjectBatchPanel
            documents={xdfDocuments}
            groups={inferredSubjectGroups}
            selectedIds={selectedBatchIds}
            subjectId={batchSubjectId}
            jobLoading={jobLoading}
            onSubjectIdChange={setBatchSubjectId}
            onToggleDocument={toggleBatchDocument}
            onClear={() => setSelectedBatchIds([])}
            onRunSelected={() => runSubjectBatchAnalysis()}
            onRunAllComplete={runAllCompleteSubjectBatches}
            onRunGroup={(group) => {
              setBatchSubjectId(group.subjectId);
              setSelectedBatchIds(group.documents.map((document) => document.id));
              void runSubjectBatchAnalysis(
                group.documents.map((document) => document.id),
                group.subjectId,
              );
            }}
            runnableGroupCount={runnableSubjectGroupCount}
          />
          <CohortMetadataPanel
            completedSubjectBatchCount={completedSubjectBatchCount}
            metadataCsv={subjectMetadataCsv}
            groupVariable={groupVariable}
            jobLoading={jobLoading}
            onMetadataChange={setSubjectMetadataCsv}
            onGroupVariableChange={setGroupVariable}
            onMetadataFileUpload={handleMetadataFileUpload}
            onRun={runCohortDensitySummary}
          />
          <AnalysisQueueOverview
            jobs={filteredXdfJobs}
            filter={jobViewFilter}
            onFilterChange={setJobViewFilter}
            onDeleteJobs={deleteAnalysisJobs}
            onDownloadReport={downloadJobHtmlReport}
          />
        </section>

        <section className="view is-visible" id="ai">
          <div className="section-head">
            <div>
              <p className="eyebrow">文献与写作助手</p>
              <h2>论文写作工作台</h2>
            </div>
            <button className="primary-button" onClick={runAiAssistant} disabled={aiState.status === "loading"}>
              {aiState.status === "loading" ? "生成中..." : "生成论文章节"}
            </button>
          </div>

          <div className="ai-grid">
            <section className="work-panel assistant-task-panel">
              <h3>写作目标</h3>
              <div className="writing-mode-grid">
                {writingTaskModes.map((mode) => (
                  <button
                    className={`writing-mode-button ${writingMode === mode.id ? "is-active" : ""}`}
                    key={mode.id}
                    type="button"
                    onClick={() => setWritingMode(mode.id)}
                  >
                    <strong>{mode.label}</strong>
                    <span>{mode.description}</span>
                  </button>
                ))}
              </div>
              <div className="writing-control-grid">
                <label>
                  目标章节
                  <select value={writingSection} onChange={(event) => setWritingSection(event.target.value as WritingTargetSectionId)}>
                    {writingTargetSections.map((section) => (
                      <option key={section.id} value={section.id}>
                        {section.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  输出形式
                  <select
                    value={writingOutputMode}
                    onChange={(event) => setWritingOutputMode(event.target.value as WritingOutputModeId)}
                  >
                    {writingOutputModes.map((outputMode) => (
                      <option key={outputMode.id} value={outputMode.id}>
                        {outputMode.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="prompt-preset-grid">
                {writingWorkflowPresets.map((preset) => (
                  <button
                    className="secondary-button"
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      setWritingMode(preset.mode);
                      setWritingSection(preset.section);
                      setWritingOutputMode(preset.output);
                      setResearchNote(preset.prompt);
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="writing-protocol" aria-label="写作约束">
                {writingProtocolRules.map((rule) => (
                  <span key={rule}>{rule}</span>
                ))}
              </div>
              <ThesisWritingBlueprintPanel />
              <label>
                具体写作要求
                <textarea value={researchNote} rows={9} onChange={(event) => setResearchNote(event.target.value)} />
              </label>
            </section>
            <section className="work-panel ai-output">
              <h3>论文草稿</h3>
              <p className="muted">
                当前任务：{selectedWritingMode.label} · {selectedWritingSection.label} · {selectedWritingOutput.label}
              </p>
              <pre>{aiState.output || "生成后，这里会显示论文正文和需要核对的证据边界。"}</pre>
            </section>
          </div>
        </section>
      </section>
    </main>
  );
}

function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark" aria-hidden="true">
        NS
      </div>
      <div>
        <p className="eyebrow">脑电 + VR 论文</p>
        <strong>NeuroThesis Studio</strong>
      </div>
    </div>
  );
}

function PreviewCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="auth-preview-card">
      <span>{title}</span>
      <strong>{text}</strong>
    </div>
  );
}

function StatusMetric({
  label,
  value,
  text,
  tone = "default",
}: {
  label: string;
  value: number | string;
  text: string;
  tone?: "default" | "warn";
}) {
  return (
    <article className={`status-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{text}</p>
    </article>
  );
}

function UploadProgressPanel({ progress, state }: { progress: UploadProgress; state: UploadState }) {
  if (!progress) return null;
  const percent = progress.total ? Math.round((progress.completed / progress.total) * 100) : 0;
  const tone = state === "error" ? "failed" : state === "warning" ? "warning" : state === "done" ? "completed" : "running";

  return (
    <div className="upload-progress-panel" aria-label="XDF 批量上传进度">
      <div className="upload-progress-head">
        <strong>{percent}%</strong>
        <span>
          已处理 {progress.completed}/{progress.total}，成功 {progress.uploaded}，失败 {progress.failed}
          {progress.skipped ? `，忽略 ${progress.skipped}` : ""}
        </span>
      </div>
      <ProgressBar value={percent} tone={tone} />
      {state === "uploading" && progress.currentFile ? <p>最近完成：{progress.currentFile}</p> : null}
    </div>
  );
}

function AnalysisMethodologyGuidePanel({ onClose }: { onClose: () => void }) {
  return (
    <section className="work-panel analysis-guide-panel" aria-label="数据分析字段和方法说明">
      <div className="analysis-head">
        <div>
          <p className="eyebrow">字段和方法说明</p>
          <h3>这些数字从哪里来，能说明什么</h3>
        </div>
        <button className="secondary-button" type="button" onClick={onClose}>
          收起
        </button>
      </div>
      <p className="muted analysis-guide-intro">
        这里把页面上的数、XDF 字段和统计口径拆开写。读报告时先看 H1 主指标，再看正确率、EEG 和问卷机制。这样写是为了少一点口号，多一点可复核的解释。
      </p>
      <div className="analysis-guide-grid">
        {analysisGuideSections.map((section) => (
          <article className="analysis-guide-section" key={section.title}>
            <div>
              <strong>{section.title}</strong>
              <p>{section.note}</p>
            </div>
            <div className="analysis-guide-table-wrap">
              <table className="analysis-guide-table">
                <thead>
                  <tr>
                    <th>字段 / 数字</th>
                    <th>它表示什么</th>
                    <th>怎么算</th>
                    <th>别这样读</th>
                  </tr>
                </thead>
                <tbody>
                  {section.items.map((item) => (
                    <tr key={`${section.title}-${item.field}`}>
                      <td>
                        <code>{item.field}</code>
                      </td>
                      <td>{item.meaning}</td>
                      <td>{item.method}</td>
                      <td>{item.caveat}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function H1EvidencePanel() {
  return (
    <section className="work-panel h1-evidence-panel" aria-label="H1 主效应证据包">
      <div className="analysis-head">
        <div>
          <p className="eyebrow">H1 主效应证据包</p>
          <h3>路径确认支持水平对行动迟滞的倒 U 型影响</h3>
        </div>
        <span className="status-pill compact">n=32 完整被试</span>
      </div>
      <div className="h1-evidence-summary">
        {h1EvidenceCards.map((item) => (
          <article className={`h1-evidence-card ${item.tone}`} key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <p>{item.detail}</p>
          </article>
        ))}
      </div>
      <div className="h1-evidence-layout">
        <article className="h1-chart-block">
          <div>
            <strong>三条件均值</strong>
            <p>中等支持的提示到首次确认延迟最高；正式主指标固定为官方提示到首次现场路径确认延迟。</p>
          </div>
          <H1ConditionMeanChart means={h1ConditionMeans} />
        </article>
        <article className="h1-stage-block">
          <strong>相邻阶段解释</strong>
          <dl>
            <div>
              <dt>低到中</dt>
              <dd>medium - low = 5.320s，双侧 p=.009。解释为可靠性上升后继续确认变得值得，迟滞上升。</dd>
            </div>
            <div>
              <dt>中到高</dt>
              <dd>medium - high = 9.688s，双侧 p&lt;.001，Wilcoxon p&lt;.001。解释为确认链闭合后负荷下降，迟滞减少。</dd>
            </div>
            <div>
              <dt>高 vs 低</dt>
              <dd>high - low = -4.368s，p&lt;.001。高支持比低支持更快，说明高支持已经形成更容易闭合的确认链。</dd>
            </div>
          </dl>
        </article>
      </div>
      <div className="h1-sensitivity-layout">
        <H1SensitivityTable title="组件敏感性" rows={h1ComponentSensitivityRows} />
        <H1SensitivityTable title="QC 敏感性" rows={h1QcSensitivityRows} />
      </div>
      <p className="muted compact-note h1-note">
        论文写作顺序固定为：H1 主 planned contrast、三条件形状、个体峰值诊断、地图校正模型、相邻阶段、组件与 QC 敏感性。问卷 M1 和 EEG M2 用于解释机制，不替换 H1 主指标。
      </p>
    </section>
  );
}

function H1ConditionMeanChart({ means }: { means: H1ConditionMean[] }) {
  const min = Math.min(...means.map((item) => item.value), -0.1);
  const max = Math.max(...means.map((item) => item.value), 0.18);
  const span = max - min || 1;

  return (
    <div className="h1-mean-chart" aria-label="H1 三条件均值">
      {means.map((item) => {
        const zero = ((0 - min) / span) * 100;
        const position = ((item.value - min) / span) * 100;
        return (
          <div className={`h1-mean-row ${item.level}`} key={item.level}>
            <span>{densityLabels[item.level]}</span>
            <div className="h1-mean-track">
              <i className="zero-line" style={{ left: `${zero}%` }} />
              <b style={{ left: `${position}%` }} />
            </div>
            <strong>{item.value.toFixed(3)}</strong>
          </div>
        );
      })}
    </div>
  );
}

function H1SensitivityTable({ title, rows }: { title: string; rows: H1SensitivityRow[] }) {
  return (
    <div className="h1-sensitivity-table">
      <strong>{title}</strong>
      <table>
        <thead>
          <tr>
            <th>方案</th>
            <th>n</th>
            <th>contrast</th>
            <th>p</th>
            <th>结论</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>{row.n}</td>
              <td>{row.contrast}</td>
              <td>{row.p}</td>
              <td>{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ThesisWritingBlueprintPanel() {
  return (
    <details className="writing-blueprint" open>
      <summary>论文写作蓝图</summary>
      <div className="writing-blueprint-list">
        {thesisWritingBlueprint.map((item) => (
          <article key={item.section}>
            <strong>{item.section}</strong>
            <p>{item.task}</p>
            <small>{item.evidence}</small>
          </article>
        ))}
      </div>
    </details>
  );
}

function LiteratureCardBlueprintPanel() {
  return (
    <details className="work-panel literature-card-blueprint" open>
      <summary>
        <span>
          <strong>单篇论文档案格式</strong>
          <small>新增文献和已有文献都按这一套结构进入知识库</small>
        </span>
      </summary>
      <div className="literature-card-blueprint-grid">
        {literatureCardBlueprint.map((item) => (
          <article key={item.label}>
            <strong>{item.label}</strong>
            <p>{item.text}</p>
          </article>
        ))}
      </div>
    </details>
  );
}

function DocumentStatusBadge({
  document,
  job,
  knowledgeCard,
  seedMatch,
}: {
  document: ResearchDocument;
  job: ResearchAnalysisJob | null;
  knowledgeCard: LiteratureKnowledgeCard | null;
  seedMatch: SeedLiteratureMatch | null;
}) {
  if (isXdfDocument(document)) {
    if (!job) return <span className="state-chip muted-state">未提交</span>;
    return <span className={`state-chip ${getJobTone(job)}`}>{isStaleJob(job) ? "疑似卡住" : formatJobStatus(job.status)}</span>;
  }

  if (isLiteratureDocument(document)) {
    const isCovered = Boolean(knowledgeCard || seedMatch);
    const label = isCovered ? "已入库" : "未入库";
    return <span className={`state-chip ${isCovered ? "completed" : "muted-state"}`}>{label}</span>;
  }

  return <span className="state-chip muted-state">资料</span>;
}

function AnalysisQueueOverview({
  jobs,
  filter,
  onFilterChange,
  onDeleteJobs,
  onDownloadReport,
}: {
  jobs: ResearchAnalysisJob[];
  filter: JobViewFilter;
  onFilterChange: (filter: JobViewFilter) => void;
  onDeleteJobs: (jobIds: string[]) => void;
  onDownloadReport: (job: ResearchAnalysisJob) => void;
}) {
  const recentJobs = jobs.slice(0, 3);
  const latestJob = recentJobs[0] ?? null;
  const historyJobs = recentJobs.slice(1);
  const deletableJobs = recentJobs.filter((job) => job.status === "completed" || job.status === "failed" || job.status === "configuration_required" || isStaleJob(job));
  const allDeletableJobs = jobs.filter((job) =>
    filter === "completed"
      ? job.status === "completed"
      : job.status === "failed" || job.status === "configuration_required" || isStaleJob(job),
  );

  const renderJobRow = (job: ResearchAnalysisJob) => {
    const reportArtifact = getJobHtmlReport(job);
    return (
      <article className="queue-row" key={job.id}>
        <div>
          <strong>{getJobDisplayTitle(job)}</strong>
          <span>{new Date(job.created_at).toLocaleString("zh-CN")}</span>
        </div>
        <span className={`state-chip ${getJobTone(job)}`}>{isStaleJob(job) ? "疑似卡住" : formatJobStatus(job.status)}</span>
        <ProgressBar value={getJobProgress(job)} tone={getJobTone(job)} />
        <div className="job-actions">
          {job.github_run_url ? (
            <a className="secondary-link" href={job.github_run_url} target="_blank" rel="noreferrer">
              GitHub
            </a>
          ) : null}
          <button className="secondary-button" disabled={!reportArtifact} onClick={() => onDownloadReport(job)}>
            {reportArtifact ? "下载 HTML" : job.status === "completed" ? "需重新生成" : "等待报告"}
          </button>
          <button className="secondary-button" onClick={() => onDeleteJobs([job.id])}>
            删除
          </button>
        </div>
        <p>{getJobMessage(job)}</p>
      </article>
    );
  };

  return (
    <section className="work-panel queue-overview">
      <div className="analysis-head">
        <div>
          <p className="eyebrow">XDF 队列</p>
          <h3>{jobViewFilters.find((item) => item.id === filter)?.label ?? "任务"} · 最近 {recentJobs.length}/3</h3>
        </div>
        <div className="top-actions">
          <button className="secondary-button" disabled={!deletableJobs.length} onClick={() => onDeleteJobs(deletableJobs.map((job) => job.id))}>
            清理最近列表
          </button>
          <button className="secondary-button" disabled={!allDeletableJobs.length} onClick={() => onDeleteJobs(allDeletableJobs.map((job) => job.id))}>
            清理当前筛选
          </button>
        </div>
      </div>
      <div className="segmented-control" aria-label="任务状态筛选">
        {jobViewFilters.map((item) => (
          <button
            className={filter === item.id ? "is-active" : ""}
            key={item.id}
            onClick={() => onFilterChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {latestJob ? (
        <div className="queue-table">
          {renderJobRow(latestJob)}
          {historyJobs.length ? (
            <details className="queue-history">
              <summary>展开最近 {historyJobs.length} 个历史任务</summary>
              <div className="queue-table compact-history">{historyJobs.map(renderJobRow)}</div>
            </details>
          ) : null}
        </div>
      ) : (
        <p className="muted">当前筛选下没有 XDF 分析任务。</p>
      )}
    </section>
  );
}

type XdfSubjectMatrixRow = {
  subjectId: string;
  subjectIndex: number;
  expectedSequences: Record<DensityLevel, number>;
  documents: ResearchDocument[];
  documentsByDensity: Partial<Record<DensityLevel, ResearchDocument>>;
  missingLevels: DensityLevel[];
  latestJob: ResearchAnalysisJob | null;
  completedJob: ResearchAnalysisJob | null;
  activeJob: ResearchAnalysisJob | null;
  failedJob: ResearchAnalysisJob | null;
  complete: boolean;
  runnable: boolean;
};

type XdfSubjectMatrixStats = {
  uploadedRuns: number;
  completeSubjects: number;
  runnableSubjects: number;
  activeSubjects: number;
  completedSubjects: number;
  failedSubjects: number;
};

function XdfSubjectMatrixPanel({
  rows,
  stats,
  filter,
  jobLoading,
  onFilterChange,
  onRunAllComplete,
  onDownloadCsv,
  onRunSubject,
  onDownloadReport,
  onDeleteJob,
}: {
  rows: XdfSubjectMatrixRow[];
  stats: XdfSubjectMatrixStats;
  filter: SubjectMatrixFilter;
  jobLoading: boolean;
  onFilterChange: (filter: SubjectMatrixFilter) => void;
  onRunAllComplete: () => void;
  onDownloadCsv: () => void;
  onRunSubject: (row: XdfSubjectMatrixRow) => void;
  onDownloadReport: (job: ResearchAnalysisJob) => void;
  onDeleteJob: (job: ResearchAnalysisJob) => void;
}) {
  return (
    <section className="work-panel subject-matrix-panel">
      <div className="analysis-head">
        <div>
          <p className="eyebrow">{EXPECTED_XDF_COUNT} 个 XDF 管理矩阵</p>
          <h3>{EXPECTED_SUBJECT_RANGE_LABEL} 被试 × 低/中/高路径确认支持</h3>
        </div>
        <div className="top-actions">
          <button className="secondary-button" disabled={!rows.length} onClick={onDownloadCsv}>
            下载矩阵 CSV
          </button>
          <button className="primary-button" disabled={jobLoading || stats.runnableSubjects < 1} onClick={onRunAllComplete}>
            批量提交可分析被试（{stats.runnableSubjects}）
          </button>
        </div>
      </div>
      <div className="matrix-metrics" aria-label="XDF 数据矩阵摘要">
        <span>文件 {stats.uploadedRuns}/{EXPECTED_XDF_COUNT}</span>
        <span>三条件完整 {stats.completeSubjects}/{EXPECTED_SUBJECT_COUNT}</span>
        <span>分析中 {stats.activeSubjects}</span>
        <span>已完成 {stats.completedSubjects}</span>
        <span>需处理 {stats.failedSubjects}</span>
      </div>
      <div className="segmented-control" aria-label="被试矩阵筛选">
        {subjectMatrixFilters.map((item) => (
          <button className={filter === item.id ? "is-active" : ""} key={item.id} onClick={() => onFilterChange(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="subject-matrix-scroll">
        <table className="subject-matrix-table">
          <thead>
            <tr>
              <th>被试</th>
              <th>低</th>
              <th>中</th>
              <th>高</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.subjectId}>
                <th scope="row">
                  <strong>{row.subjectId}</strong>
                  <small>
                    sub{String(row.expectedSequences.low).padStart(3, "0")}-sub{String(row.expectedSequences.high).padStart(3, "0")}
                  </small>
                </th>
                {densityLevels.map((level) => (
                  <td key={`${row.subjectId}-${level}`}>
                    <XdfConditionCell document={row.documentsByDensity[level] ?? null} level={level} expectedSequence={row.expectedSequences[level]} />
                  </td>
                ))}
                <td>
                  <span className={`state-chip ${getSubjectMatrixTone(row)}`}>{getSubjectMatrixStatus(row)}</span>
                  {row.latestJob ? <small className="matrix-job-time">{new Date(row.latestJob.updated_at).toLocaleString("zh-CN")}</small> : null}
                </td>
                <td>
                  <div className="matrix-actions">
                    {row.completedJob ? (
                      <button className="secondary-button" disabled={!getJobHtmlReport(row.completedJob)} onClick={() => onDownloadReport(row.completedJob!)}>
                        下载报告
                      </button>
                    ) : (
                      <button className="secondary-button" disabled={jobLoading || !row.runnable} onClick={() => onRunSubject(row)}>
                        分析此被试
                      </button>
                    )}
                    {row.failedJob && !row.activeJob && !row.completedJob ? (
                      <button className="secondary-button" disabled={jobLoading} onClick={() => onDeleteJob(row.failedJob!)}>
                        清理记录
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted compact-note">
        文件编号按三连号归入被试：001-003 为 P01，004-006 为 P02。Signature1/2/3 或三连号位置会映射为低/中/高路径确认支持。
      </p>
    </section>
  );
}

function XdfConditionCell({
  document,
  level,
  expectedSequence,
}: {
  document: ResearchDocument | null;
  level: DensityLevel;
  expectedSequence: number;
}) {
  return (
    <div className={`condition-cell ${document ? "has-file" : "missing-file"}`}>
      <span>{densityLabels[level]}</span>
      {document ? <strong title={document.filename}>{document.filename}</strong> : <strong>等待 sub{String(expectedSequence).padStart(3, "0")}</strong>}
      {document ? <small>{formatBytes(document.size_bytes)}</small> : <small>未上传</small>}
    </div>
  );
}

function AnalysisPipelinePanel() {
  return (
    <details className="work-panel analysis-pipeline-panel collapsible-info-panel">
      <summary>
        <div>
          <strong>正式分析管线</strong>
          <small>从单个 XDF 到全样本 planned contrast，再到论文结果段落。</small>
        </div>
        <span className="status-pill compact">全样本主检验</span>
      </summary>
      <div className="pipeline-stage-grid">
        {analysisPipelineStages.map((stage, index) => (
          <article className="pipeline-stage-card" key={stage.title}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{stage.title}</strong>
            <p>{stage.detail}</p>
          </article>
        ))}
      </div>
      <p className="muted compact-note">
        两名被试、六个 XDF 可以跑完整流程，但只能看 pilot 趋势。正式论文先报告全样本主 contrast；年龄、性别、VR 经验、空间能力、实验顺序等被试信息只用于解释个体差异或做调节分析。
      </p>
    </details>
  );
}

function UnityMarkerDictionaryPanel() {
  return (
    <details className="work-panel marker-dictionary-panel collapsible-info-panel">
      <summary>
        <span>
          <strong>Unity marker 事件字典</strong>
          <small>已按现有 MetroRescueMarkers 适配；报告会区分真实 marker、代理指标和待补元数据。</small>
        </span>
        <span className="status-pill compact">{unityMarkerDictionary.length} 个事件</span>
      </summary>
      <div className="marker-dictionary-grid">
        {unityMarkerDictionary.map((marker) => (
          <article className="marker-card" key={marker.event}>
            <div>
              <span>{unityMarkerFamilyLabels[marker.family]}</span>
              <strong>{marker.event}</strong>
            </div>
            <p>{marker.label}：{marker.purpose}</p>
            {marker.payload ? <small>建议字段：{marker.payload}</small> : null}
            <em className={`marker-required ${marker.required}`}>{formatMarkerRequirement(marker.required)}</em>
          </article>
        ))}
      </div>
    </details>
  );
}

function SubjectBatchPanel({
  documents,
  groups,
  selectedIds,
  subjectId,
  jobLoading,
  onSubjectIdChange,
  onToggleDocument,
  onClear,
  onRunSelected,
  onRunAllComplete,
  onRunGroup,
  runnableGroupCount,
}: {
  documents: ResearchDocument[];
  groups: Array<{ subjectId: string; documents: ResearchDocument[] }>;
  selectedIds: string[];
  subjectId: string;
  jobLoading: boolean;
  onSubjectIdChange: (value: string) => void;
  onToggleDocument: (documentId: string) => void;
  onClear: () => void;
  onRunSelected: () => void;
  onRunAllComplete: () => void;
  onRunGroup: (group: { subjectId: string; documents: ResearchDocument[] }) => void;
  runnableGroupCount: number;
}) {
  const selectedCoverage = summarizeDensityCoverage(documents.filter((document) => selectedIds.includes(document.id)));

  return (
    <section className="work-panel subject-batch-panel">
      <div className="analysis-head">
        <div>
          <p className="eyebrow">被试批量分析</p>
          <h3>按被试合并低 / 中 / 高 XDF</h3>
        </div>
        <span className="status-pill compact">
          {selectedIds.length} 个已选{selectedIds.length ? ` · ${selectedCoverage.label}` : ""}
        </span>
      </div>
      <p className="muted">
        正式数据按 {EXPECTED_SUBJECT_COUNT} 名被试 × {EXPECTED_RUNS_PER_SUBJECT} 个路径确认支持条件组织。sub001/sub002/sub003 归为 P01，sub004/sub005/sub006 归为 P02，以此类推；Signature1/2/3 分别对应低/中/高路径确认支持。报告包含被试内条件表和主 planned contrast：中等支持 - 低/高支持平均。
      </p>
      <div className="design-strip" aria-label="分析设计">
        <span>{EXPECTED_SUBJECT_COUNT} 被试</span>
        <span>3 路径确认支持条件</span>
        <span>{EXPECTED_XDF_COUNT} 个 XDF</span>
        <span>组内因素：support level</span>
        <span>主假设：中等支持迟滞最高</span>
      </div>
      <div className="batch-controls">
        <label>
          被试编号
          <input
            value={subjectId}
            placeholder="例如 P01"
            onChange={(event) => onSubjectIdChange(event.target.value)}
          />
        </label>
        <div className="top-actions">
          <button className="primary-button" disabled={jobLoading || selectedIds.length < 2} onClick={onRunSelected}>
            提交所选 XDF
          </button>
          <button className="secondary-button" disabled={jobLoading || runnableGroupCount < 1} onClick={onRunAllComplete}>
            批量提交完整被试（{runnableGroupCount}）
          </button>
          <button className="secondary-button" disabled={!selectedIds.length} onClick={onClear}>
            清空选择
          </button>
        </div>
      </div>
      <div className="batch-layout">
        <div className="batch-file-list">
          {documents.map((document) => (
            <label className="batch-file-row" key={document.id}>
              <input
                type="checkbox"
                checked={selectedIds.includes(document.id)}
                onChange={() => onToggleDocument(document.id)}
              />
              <span>
                <strong>{document.filename}</strong>
                <small>
                  {formatBytes(document.size_bytes)} · {inferSubjectIdFromFilename(document.filename)} · {formatDensityLabel(inferDensityLevelFromFilename(document.filename))}
                </small>
              </span>
            </label>
          ))}
        </div>
        <div className="subject-group-list">
          <strong>按文件名分组</strong>
          {groups.length ? (
            groups.map((group) => {
              const coverage = summarizeDensityCoverage(group.documents);
              return (
                <article className="subject-group-card" key={group.subjectId}>
                  <div>
                    <span className={coverage.complete && group.documents.length === 3 ? "state-chip completed" : "state-chip warning"}>
                      {coverage.complete ? "条件完整" : `${group.documents.length}/3 XDF`}
                    </span>
                    <h4>{group.subjectId}</h4>
                    <p>条件：{coverage.label}</p>
                    <p>{group.documents.map((document) => inferRunLabelFromFilename(document.filename)).join(" / ")}</p>
                  </div>
                  <button className="secondary-button" disabled={jobLoading || group.documents.length < 2} onClick={() => onRunGroup(group)}>
                    提交此被试
                  </button>
                </article>
              );
            })
          ) : (
            <p className="muted">还没有 XDF 文件。上传后会按文件编号三连组推断被试，再按 Signature 或编号位置推断低/中/高条件。</p>
          )}
        </div>
      </div>
    </section>
  );
}

function CohortMetadataPanel({
  completedSubjectBatchCount,
  metadataCsv,
  groupVariable,
  jobLoading,
  onMetadataChange,
  onGroupVariableChange,
  onMetadataFileUpload,
  onRun,
}: {
  completedSubjectBatchCount: number;
  metadataCsv: string;
  groupVariable: string;
  jobLoading: boolean;
  onMetadataChange: (value: string) => void;
  onGroupVariableChange: (value: string) => void;
  onMetadataFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onRun: () => void;
}) {
  const metadataRows = countCsvDataRows(metadataCsv);

  return (
    <section className="work-panel cohort-metadata-panel">
      <div className="analysis-head">
        <div>
          <p className="eyebrow">全样本统计</p>
          <h3>汇总每名被试的三条件结果</h3>
        </div>
        <span className="status-pill compact">{completedSubjectBatchCount} 个已完成被试报告</span>
      </div>
      <p className="muted">
        这个报告的主任务是汇总每名被试的 low / medium / high 三个 run，并检验 medium - mean(low, high)。CSV 不是必填；只有当你有年龄、性别、VR 经验、空间能力、实验顺序等被试信息时，才用其中一列解释个体差异。2 名被试 × 3 个实验只能看流程和趋势，不能写成显著性结论。
      </p>
      <div className="metadata-grid">
        <label>
          协变量列名（可选）
          <input value={groupVariable} placeholder="例如 vr_experience / sex / age / spatial_ability / run_order" onChange={(event) => onGroupVariableChange(event.target.value)} />
        </label>
        <label className="file-button compact-file-button">
          <input type="file" accept=".csv,text/csv" onChange={onMetadataFileUpload} />
          读取 CSV
        </label>
      </div>
      <label>
        被试信息 CSV（可选）
        <textarea
          value={metadataCsv}
          rows={6}
          spellCheck={false}
          placeholder={"participant_id,vr_experience,spatial_ability,run_order\nP01,low,high,1\nP02,high,medium,2"}
          onChange={(event) => onMetadataChange(event.target.value)}
        />
      </label>
      <div className="metadata-footer">
        <span className="muted">已识别 {metadataRows} 行被试信息。被试编号建议用 P01、P02，也支持 1、2 或 sub001。</span>
        <button className="primary-button" disabled={jobLoading || completedSubjectBatchCount < 1} onClick={onRun}>
          生成全样本 HTML 报告
        </button>
      </div>
    </section>
  );
}

function ProgressBar({ value, tone }: { value: number; tone: string }) {
  return (
    <div className={`progress-bar ${tone}`} aria-label={`分析进度 ${value}%`}>
      <i style={{ width: `${value}%` }} />
    </div>
  );
}

function getAuthErrorMessage(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("email not confirmed")) {
    return "这个邮箱还没有确认。请在 Supabase Auth 用户列表里确认邮箱，或重新创建用户时勾选 Auto Confirm User。";
  }

  if (normalized.includes("invalid login credentials")) {
    return "邮箱或密码不正确。请确认登录时使用的是邮箱地址，不是用户名。";
  }

  if (normalized.includes("user not found")) {
    return "没有找到这个用户。请先在 Supabase Authentication 里创建 email/password 用户。";
  }

  if (normalized.includes("email")) {
    return `登录失败：${message}`;
  }

  return `登录失败：${message}`;
}

function normalizeKnowledgeTitle(title: string) {
  return stripLiteratureExtension(title)
    .toLowerCase()
    .replace(/[_\-\s:：，,.;；。()（）[\]]+/g, " ")
    .trim();
}

function SeedKnowledgeReviewPanel({ entries }: { entries: LiteratureKnowledgeEntry[] }) {
  const [activeArticleId, setActiveArticleId] = useState("");
  const [query, setQuery] = useState("");
  const articleViews = useMemo(() => buildArticleKnowledgeViews(entries), [entries]);

  useEffect(() => {
    if (!articleViews.length) {
      setActiveArticleId("");
      return;
    }

    if (!articleViews.some((article) => article.id === activeArticleId)) {
      setActiveArticleId(articleViews[0].id);
    }
  }, [activeArticleId, articleViews]);

  const filteredArticles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return articleViews;

    return articleViews.filter((article) =>
      [
        article.id,
        article.title,
        article.subtitle,
        article.tags.join(" "),
        JSON.stringify(article.dossier),
        JSON.stringify(article.thesisMap),
        article.sections
          .map((section) =>
            [section.title, section.body ?? "", section.points.join(" "), section.rows.map((row) => `${row.label} ${row.value}`).join(" ")]
              .join(" ")
              .trim(),
          )
          .join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [articleViews, query]);
  const activeArticle =
    filteredArticles.find((article) => article.id === activeArticleId) ??
    articleViews.find((article) => article.id === activeArticleId) ??
    filteredArticles[0] ??
    articleViews[0] ??
    null;

  const sourceCount = articleViews.length;
  const schemaCount = literatureArticleKnowledgeBase.schema.length;
  const reviewFocusCount = knowledgeReviewNotes.length;

  return (
    <section className="work-panel seed-review-panel">
      <div className="analysis-head">
        <div>
          <p className="eyebrow">文献知识库</p>
          <h3>逐篇论文档案</h3>
        </div>
        <span className="status-pill compact">{sourceCount} 篇文献</span>
      </div>

      <div className="seed-review-summary">
        <div>
          <span>论文档案</span>
          <strong>{sourceCount}</strong>
          <p>每篇文章保留自己的研究问题、方法、发现和边界。</p>
        </div>
        <div>
          <span>写作映射</span>
          <strong>{schemaCount}</strong>
          <p>把文献证据整理到综述、假设、方法和讨论里。</p>
        </div>
        <div>
          <span>核对提醒</span>
          <strong>{reviewFocusCount}</strong>
          <p>正式引用前回 PDF 核对页码、作者、年份、DOI 和语境。</p>
        </div>
      </div>

      <div className="review-note-list">
        {knowledgeReviewNotes.map((note) => (
          <p key={note}>{note}</p>
        ))}
      </div>

      <ArticleKnowledgeStructure
        articles={filteredArticles}
        activeArticle={activeArticle}
        query={query}
        onQueryChange={setQuery}
        onArticleChange={setActiveArticleId}
      />
    </section>
  );
}

function KnowledgeReviewItemCard({ item, sectionId }: { item: SeedKnowledgeReviewItem; sectionId: string }) {
  return (
    <article className="seed-review-item">
      <div className="seed-item-head">
        <span>{item.id}</span>
        <div>
          <h4>{item.title}</h4>
          {item.subtitle ? <p>{item.subtitle}</p> : null}
        </div>
      </div>
      <p>{item.body}</p>
      {item.tags.length ? (
        <div className="keyword-row compact quiet">
          {item.tags.slice(0, 8).map((tag) => (
            <span key={`${sectionId}-${item.id}-${tag}`}>{tag}</span>
          ))}
        </div>
      ) : null}
      {item.meta.length ? (
        <dl className="seed-review-meta">
          {getDisplaySeedMetaEntries(item.meta).map((entry) => (
            <div key={`${sectionId}-${item.id}-${entry.label}`}>
              <dt>{entry.label}</dt>
              <dd>{entry.fullValue ? <SourceReferenceValue entry={entry} /> : entry.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {item.boundary ? <p className="seed-boundary">边界：{item.boundary}</p> : null}
    </article>
  );
}

type ArticleKnowledgeRow = {
  label: string;
  value: string;
};

type ArticleKnowledgeSection = {
  id: string;
  title: string;
  body?: string;
  rows: ArticleKnowledgeRow[];
  points: string[];
  linkedItems: SeedKnowledgeReviewItem[];
};

type ArticleDossier = {
  verdict: string;
  problem: string;
  motivation: string;
  design: {
    overview: string;
    sample: string;
    task: string;
    variables: string[];
    measures: string[];
    analysis: string;
  };
  findings: string[];
  credibility: string;
  thesisRelevance: string;
};

type ArticleConstructUse = {
  construct: string;
  support: string;
  use: string;
  caution: string;
};

type ArticleWritingBlock = {
  section: string;
  purpose: string;
  draft: string;
};

type ArticleThesisWritingMap = {
  relationType: string;
  frameworkRole: string;
  constructs: ArticleConstructUse[];
  chapterUses: string[];
  writingBlocks: ArticleWritingBlock[];
  overclaimWarnings: string[];
  verificationTasks: string[];
};

type ArticleKnowledgeSystem = {
  coreContribution: string;
  constructLinks: Array<{
    construct: string;
    evidence: string;
    thesisUse: string;
    caution: string;
  }>;
  evidenceUnits: Array<{
    topic: string;
    evidence: string;
    paperLocation: string;
    thesisUse: string;
    limitation: string;
  }>;
  thesisClaims: Array<{
    claim: string;
    supportLevel: string;
    useInSection: string;
    mustVerify: string;
  }>;
  verificationChecklist: string[];
  openQuestions: string[];
};

type ArticleVerification = {
  sourceCode: string;
  sourceTitle: string;
  filename: string;
  libraryMeta: string;
  quoteAnchors: string[];
  evidenceSnippets: Array<{ label: string; value: string }>;
  linkedItems: SeedKnowledgeReviewItem[];
};

type ArticleKnowledgeView = {
  id: string;
  title: string;
  subtitle: string;
  libraryMeta: string;
  tags: string[];
  grade: string;
  articleRole: string;
  dossier: ArticleDossier;
  thesisMap: ArticleThesisWritingMap;
  knowledgeSystem: ArticleKnowledgeSystem;
  verification: ArticleVerification;
  sections: ArticleKnowledgeSection[];
};

function ArticleKnowledgeStructure({
  articles,
  activeArticle,
  query,
  onQueryChange,
  onArticleChange,
}: {
  articles: ArticleKnowledgeView[];
  activeArticle: ArticleKnowledgeView | null;
  query: string;
  onQueryChange: (query: string) => void;
  onArticleChange: (articleId: string) => void;
}) {
  return (
    <div className="article-knowledge-layout">
      <aside className="article-knowledge-list" aria-label="单篇文献列表">
        <label className="search-field">
          检索文献
          <input
            type="search"
            value={query}
            placeholder="按标题、编号、方法或关键词检索"
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </label>
        <div className="article-list-scroll">
          {articles.length ? (
            articles.map((article) => (
              <button
                className={`article-knowledge-button ${activeArticle?.id === article.id ? "is-active" : ""}`}
                key={article.id}
                type="button"
                onClick={() => onArticleChange(article.id)}
              >
                <strong>{article.title}</strong>
                {article.libraryMeta ? <small>{article.libraryMeta}</small> : null}
              </button>
            ))
          ) : (
            <p className="muted">没有匹配的文献。</p>
          )}
        </div>
      </aside>

      <div className="article-knowledge-detail">
        {activeArticle ? (
          <>
            <div className="article-knowledge-head">
              <div className="article-head-kicker">
                <span>{activeArticle.id}</span>
                {activeArticle.grade ? <span>{activeArticle.grade}</span> : null}
                {activeArticle.articleRole ? <span>{activeArticle.articleRole}</span> : null}
              </div>
              <h3>{activeArticle.title}</h3>
              {activeArticle.dossier.verdict ? <p>{activeArticle.dossier.verdict}</p> : null}
              {activeArticle.tags.length ? (
                <div className="keyword-row compact quiet">
                  {activeArticle.tags.slice(0, 8).map((tag) => (
                    <span key={`${activeArticle.id}-${tag}`}>{tag}</span>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="article-dossier-sections">
              <section className="article-dossier-section article-dossier-hero">
                <span>速读结论</span>
                <h4>这篇论文在本研究中的作用</h4>
                <p>{activeArticle.dossier.problem}</p>
                <p>{activeArticle.dossier.motivation}</p>
                <p>{activeArticle.dossier.thesisRelevance}</p>
              </section>

              <section className="article-dossier-section">
                <span>研究设计拆解</span>
                <h4>方法、任务与指标</h4>
                <dl className="dossier-definition-list">
                  <div>
                    <dt>设计概括</dt>
                    <dd>{activeArticle.dossier.design.overview}</dd>
                  </div>
                  <div>
                    <dt>样本/被试</dt>
                    <dd>{activeArticle.dossier.design.sample}</dd>
                  </div>
                  <div>
                    <dt>任务材料</dt>
                    <dd>{activeArticle.dossier.design.task}</dd>
                  </div>
                  <div>
                    <dt>分析启发</dt>
                    <dd>{activeArticle.dossier.design.analysis}</dd>
                  </div>
                </dl>
                <KeywordList values={[...activeArticle.dossier.design.variables, ...activeArticle.dossier.design.measures]} />
              </section>

              <section className="article-dossier-section">
                <span>核心发现与可信度</span>
                <h4>能支持什么</h4>
                <ul>
                  {activeArticle.dossier.findings.map((finding) => (
                    <li key={finding}>{finding}</li>
                  ))}
                </ul>
                <p className="dossier-boundary">{activeArticle.dossier.credibility}</p>
              </section>

              <section className="article-dossier-section wide">
                <span>与本论文的关系</span>
                <h4>{activeArticle.thesisMap.relationType}</h4>
                <p>{activeArticle.thesisMap.frameworkRole}</p>
                <div className="construct-map-grid">
                  {activeArticle.thesisMap.constructs.map((item) => (
                    <article className="construct-map-item" key={`${activeArticle.id}-${item.construct}`}>
                      <span>{item.support}</span>
                      <h5>{item.construct}</h5>
                      <p>{item.use}</p>
                      <small>{item.caution}</small>
                    </article>
                  ))}
                </div>
              </section>

              <section className="article-dossier-section wide">
                <span>单篇知识体系</span>
                <h4>构念、证据单元和可写 claims</h4>
                <p>{activeArticle.knowledgeSystem.coreContribution}</p>
                {activeArticle.knowledgeSystem.constructLinks.length ? (
                  <div className="construct-map-grid">
                    {activeArticle.knowledgeSystem.constructLinks.map((item) => (
                      <article className="construct-map-item" key={`${activeArticle.id}-ks-${item.construct}-${item.thesisUse.slice(0, 16)}`}>
                        <span>{item.evidence}</span>
                        <h5>{item.construct}</h5>
                        <p>{item.thesisUse}</p>
                        <small>{item.caution}</small>
                      </article>
                    ))}
                  </div>
                ) : null}
                {activeArticle.knowledgeSystem.evidenceUnits.length ? (
                  <dl className="dossier-definition-list compact">
                    {activeArticle.knowledgeSystem.evidenceUnits.slice(0, 6).map((unit) => (
                      <div key={`${activeArticle.id}-evidence-${unit.topic}`}>
                        <dt>{unit.topic}</dt>
                        <dd>
                          {unit.evidence}
                          <br />
                          用法：{unit.thesisUse}
                          <br />
                          核对：{unit.paperLocation}；边界：{unit.limitation}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {activeArticle.knowledgeSystem.thesisClaims.length ? (
                  <ul>
                    {activeArticle.knowledgeSystem.thesisClaims.slice(0, 6).map((claim) => (
                      <li key={`${activeArticle.id}-claim-${claim.claim}`}>
                        {claim.claim}（{claim.supportLevel}；用于：{claim.useInSection}；核对：{claim.mustVerify}）
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>

              <section className="article-dossier-section wide">
                <span>可直接写进中文论文</span>
                <h4>段落草稿</h4>
                <div className="writing-block-list">
                  {activeArticle.thesisMap.writingBlocks.map((block) => (
                    <article className="writing-block" key={`${activeArticle.id}-${block.section}-${block.draft.slice(0, 24)}`}>
                      <div>
                        <strong>{block.section}</strong>
                        <small>{block.purpose}</small>
                      </div>
                      <p>{block.draft}</p>
                    </article>
                  ))}
                </div>
              </section>

              <section className="article-dossier-section">
                <span>不能这样使用</span>
                <h4>过度推断边界</h4>
                <ul>
                  {activeArticle.thesisMap.overclaimWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </section>

              <section className="article-dossier-section">
                <span>回原文核对</span>
                <h4>正式引用前要查什么</h4>
                <dl className="dossier-definition-list">
                  <div>
                    <dt>来源文献</dt>
                    <dd>{activeArticle.verification.sourceCode} — {activeArticle.verification.sourceTitle}</dd>
                  </div>
                  {activeArticle.verification.filename ? (
                    <div>
                      <dt>文件</dt>
                      <dd>{activeArticle.verification.filename}</dd>
                    </div>
                  ) : null}
                  {activeArticle.verification.libraryMeta ? (
                    <div>
                      <dt>入库信息</dt>
                      <dd>{activeArticle.verification.libraryMeta}</dd>
                    </div>
                  ) : null}
                </dl>
                <ul>
                  {activeArticle.thesisMap.verificationTasks.map((task) => (
                    <li key={task}>{task}</li>
                  ))}
                </ul>
                {activeArticle.verification.quoteAnchors.length || activeArticle.verification.evidenceSnippets.length ? (
                  <details className="verification-details">
                    <summary>查看原文核对线索</summary>
                    {activeArticle.verification.quoteAnchors.length ? (
                      <ul>
                        {activeArticle.verification.quoteAnchors.map((anchor) => (
                          <li key={anchor}>{anchor}</li>
                        ))}
                      </ul>
                    ) : null}
                    {activeArticle.verification.evidenceSnippets.length ? (
                      <dl className="dossier-definition-list compact">
                        {activeArticle.verification.evidenceSnippets.map((snippet) => (
                          <div key={`${activeArticle.id}-${snippet.label}`}>
                            <dt>{snippet.label}</dt>
                            <dd>{snippet.value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                  </details>
                ) : null}
              </section>
            </div>
          </>
        ) : (
          <p className="muted">请选择一篇文献查看结构化知识。</p>
        )}
      </div>
    </div>
  );
}

function KeywordList({ values }: { values: string[] }) {
  const items = compactStrings(values).slice(0, 10);
  if (!items.length) return null;

  return (
    <div className="keyword-row compact quiet">
      {items.map((item) => (
        <span key={item}>{item}</span>
      ))}
    </div>
  );
}

type LocalArticleKnowledgeCard = (typeof literatureArticleKnowledgeBase)["articles"][number];
type LocalArticleReadingNote = {
  tldr?: string;
  problem?: string;
  motivation?: string;
  methodSummary?: string;
  resultSummary?: string;
  transferableConcepts?: string[];
  strengths?: string[];
  weaknesses?: string[];
  writingAngles?: string[];
  followUpQuestions?: string[];
};
type LocalArticleTaskLens = {
  frameworkRole?: string;
  constructSupport?: Array<{ construct?: string; use?: string; strength?: string }>;
  measurementUse?: string[];
  manuscriptUse?: string[];
  caveats?: string[];
};
type LocalArticlePaperDossier = ArticleDossier;
type LocalArticleThesisWritingMap = ArticleThesisWritingMap;

function buildArticleKnowledgeViews(entries: LiteratureKnowledgeEntry[]): ArticleKnowledgeView[] {
  const entryBySourceId = new Map<string, LiteratureKnowledgeEntry>();
  const entryByTitle = new Map<string, LiteratureKnowledgeEntry>();

  for (const entry of entries) {
    if (entry.seedMatch?.sourceId) {
      entryBySourceId.set(entry.seedMatch.sourceId, entry);
    }

    const titleCandidates = [
      entry.card?.title,
      entry.seedMatch?.title,
      getDocumentListTitle(entry.document, entry.card, entry.seedMatch),
      entry.document.filename,
    ];

    for (const candidate of titleCandidates) {
      const normalizedTitle = normalizeKnowledgeTitle(candidate ?? "");
      if (normalizedTitle && !entryByTitle.has(normalizedTitle)) {
        entryByTitle.set(normalizedTitle, entry);
      }
    }
  }

  const baseArticles = literatureArticleKnowledgeBase.articles.map((article) => {
    const entry = entryBySourceId.get(article.id) ?? entryByTitle.get(normalizeKnowledgeTitle(article.title)) ?? null;
    const evidenceItems = buildLinkedEvidenceItems(article);
    const quoteItems = buildQuoteAnchorItems(article);
    const sourceFile = article.matchedPdfFilename || article.filename || entry?.document.filename || "";
    const libraryMeta = entry?.document ? formatDocumentListMeta(entry.document) : sourceFile ? `文件：${sourceFile}` : "";
    const evidenceSnippets = article.evidenceSnippets ?? {};
    const readingNote = (article as LocalArticleKnowledgeCard & { readingNote?: LocalArticleReadingNote }).readingNote;
    const taskLens = (article as LocalArticleKnowledgeCard & { taskLens?: LocalArticleTaskLens }).taskLens;
    const dossierView = buildLocalArticleDossierView({
      article,
      sourceFile,
      libraryMeta,
      evidenceItems,
      quoteItems,
      readingNote,
      taskLens,
      evidenceSnippets,
    });

    return {
      id: article.id,
      title: article.title,
      subtitle: `${article.articleRole} · ${article.evidenceType} · Grade ${article.grade}`,
      libraryMeta,
      tags: article.themeTags,
      grade: `Grade ${article.grade}`,
      articleRole: article.articleRole,
      ...dossierView,
      sections: [
        {
          id: "identity",
          title: "文献身份",
          rows: compactRows([
            { label: "文献编号", value: article.id },
            { label: "知识角色", value: article.articleRole },
            { label: "研究类型", value: article.evidenceType },
            { label: "审阅等级", value: article.qualityTier },
            { label: "论文位置", value: article.thesisSection },
            { label: "文件", value: sourceFile },
            { label: "入库信息", value: entry?.document ? formatDocumentListMeta(entry.document) : "" },
          ]),
          points: [],
          linkedItems: [],
        },
        {
          id: "task-lens",
          title: "研究任务映射",
          body: taskLens?.frameworkRole,
          rows: compactRows([
            { label: "论文正文用途", value: joinArticleValues(taskLens?.manuscriptUse ?? []) },
            { label: "测量与指标用途", value: joinArticleValues(taskLens?.measurementUse ?? []) },
          ]),
          points: compactStrings([
            ...(taskLens?.constructSupport ?? []).map((item) =>
              `${item.construct ?? "相关构念"}：${item.use ?? ""}${item.strength ? `（相关强度：${item.strength}）` : ""}`,
            ),
            ...(taskLens?.caveats ?? []).map((item) => `边界：${item}`),
          ]),
          linkedItems: [],
        },
        {
          id: "question",
          title: "研究问题与定位",
          body: readingNote?.problem || article.researchQuestion,
          rows: [],
          points: compactStrings([readingNote?.tldr || article.oneSentenceSummary, readingNote?.motivation || article.researchPosition]),
          linkedItems: [],
        },
        {
          id: "paper-note",
          title: "单篇读论文笔记",
          rows: compactRows([
            { label: "一句话贡献", value: readingNote?.tldr || article.oneSentenceSummary },
            { label: "研究动机", value: readingNote?.motivation },
            { label: "方法概括", value: readingNote?.methodSummary || article.studyDesign },
            { label: "结果概括", value: readingNote?.resultSummary || joinArticleValues(article.keyFindings) },
            { label: "可迁移概念/指标", value: joinArticleValues(readingNote?.transferableConcepts ?? []) },
          ]),
          points: compactStrings([
            ...(readingNote?.strengths ?? []),
            ...(readingNote?.weaknesses ?? []).map((item) => `边界：${item}`),
            ...(readingNote?.followUpQuestions ?? []).map((item) => `需核验：${item}`),
          ]),
          linkedItems: [],
        },
        {
          id: "methods",
          title: "方法与数据",
          rows: compactRows([
            { label: "方法/证据", value: article.studyDesign },
            { label: "被试/样本", value: article.participantsAndSample },
            { label: "任务与材料", value: article.taskAndMaterials },
            { label: "变量/条件", value: joinArticleValues(article.variablesAndMeasures) },
            { label: "神经/生理指标", value: joinArticleValues(article.eegOrPhysioMeasures) },
            { label: "行为指标", value: joinArticleValues(article.behavioralMeasures) },
          ]),
          points: [],
          linkedItems: [],
        },
        {
          id: "findings",
          title: "主要发现",
          rows: [],
          points: compactStrings(article.keyFindings),
          linkedItems: [],
        },
        {
          id: "metro-use",
          title: "对本研究的用途",
          rows: compactRows([
            { label: "写作用途", value: joinArticleValues(article.writingUse) },
            { label: "路径确认支持假设关联", value: joinArticleValues(article.densityHypothesisRelevance) },
          ]),
          points: compactStrings([
            ...article.metroRescueUse,
            ...article.methodTransfer,
          ]),
          linkedItems: [],
        },
        {
          id: "boundaries",
          title: "边界与不能声称",
          rows: [],
          points: compactStrings([...article.boundaries, ...article.limitations, ...article.needsVerification]),
          linkedItems: [],
        },
        {
          id: "linked-evidence",
          title: "关联证据单元",
          rows: [],
          points: [],
          linkedItems: evidenceItems.slice(0, 10),
        },
        {
          id: "evidence-snippets",
          title: "原文证据摘录",
          rows: compactRows([
            { label: "摘要摘录", value: evidenceSnippets.abstract },
            { label: "方法摘录", value: evidenceSnippets.methods },
            { label: "结果/讨论摘录", value: evidenceSnippets.resultsDiscussion },
          ]),
          points: [],
          linkedItems: [],
        },
        {
          id: "quote-anchors",
          title: "引用线索",
          rows: [],
          points: compactStrings(article.quoteAnchorsToVerify),
          linkedItems: quoteItems.slice(0, 8),
        },
      ],
    };
  });

  const seen = new Set(baseArticles.flatMap((article) => [article.id, normalizeKnowledgeTitle(article.title)]));
  const dynamicArticles = entries
    .filter((entry) => entry.card && !entry.seedMatch)
    .map((entry, index) => {
      const card = entry.card;
      if (!card) return null;
      const normalizedTitle = normalizeKnowledgeTitle(card.title || entry.document.filename);
      if (seen.has(normalizedTitle)) return null;
      seen.add(normalizedTitle);
      return buildDynamicArticleView(entry, `U${String(index + 1).padStart(3, "0")}`);
    })
    .filter((article): article is ArticleKnowledgeView => Boolean(article));

  return [...baseArticles, ...dynamicArticles];
}

function buildDynamicArticleView(entry: LiteratureKnowledgeEntry, id: string): ArticleKnowledgeView | null {
  const card = entry.card;
  if (!card) return null;
  const title = card.title || stripLiteratureExtension(entry.document.filename);
  const taskLens = buildDynamicTaskLens(card);
  const dossierView = buildDynamicArticleDossierView(entry, id, taskLens);
  return {
    id,
    title,
    subtitle: card.paperType || card.citation || "新增文献知识卡",
    libraryMeta: formatDocumentListMeta(entry.document),
    tags: (card.themeTags?.length ? card.themeTags : card.keywords).slice(0, 8),
    grade: card.sourceGrade ? `Grade ${card.sourceGrade}` : card.evidenceLevel || "新增文献",
    articleRole: card.paperType || "新增文献",
    ...dossierView,
    sections: [
      {
        id: "identity",
        title: "文献身份",
        rows: compactRows([
          { label: "文献编号", value: id },
          { label: "引用信息", value: card.citation },
          { label: "文件", value: entry.document.filename },
          { label: "入库信息", value: formatDocumentListMeta(entry.document) },
        ]),
        points: [],
        linkedItems: [],
      },
      {
        id: "task-lens",
        title: "研究任务映射",
        body: taskLens.frameworkRole,
        rows: compactRows([
          { label: "论文正文用途", value: joinArticleValues(taskLens.manuscriptUse) },
          { label: "测量与指标用途", value: joinArticleValues(taskLens.measurementUse) },
        ]),
        points: compactStrings([
          ...taskLens.constructSupport.map((item) => `${item.construct}：${item.use}${item.strength ? `（相关强度：${item.strength}）` : ""}`),
          ...taskLens.caveats.map((item) => `边界：${item}`),
        ]),
        linkedItems: [],
      },
      {
        id: "question",
        title: "研究问题与定位",
        body: card.researchQuestion || card.oneSentenceTakeaway || card.abstractZh,
        rows: [],
        points: compactStrings([card.oneSentenceTakeaway, card.abstractZh]),
        linkedItems: [],
      },
      {
        id: "methods",
        title: "方法与数据",
        rows: compactRows([
          { label: "方法/证据", value: card.methods },
          { label: "被试/样本", value: card.participants },
          { label: "任务与材料", value: card.taskAndMaterials },
          { label: "EEG/行为指标", value: card.eegOrMeasures || card.variablesAndMeasures?.join("；") },
        ]),
        points: compactStrings([...(card.methodsWritingUse ?? [])]),
        linkedItems: [],
      },
      {
        id: "findings",
        title: "主要发现",
        rows: [],
        points: compactStrings(card.keyFindings),
        linkedItems: [],
      },
      {
        id: "metro-use",
        title: "对本研究的用途",
        rows: compactRows([
          { label: "可用于", value: card.usableForSections.join("；") },
          { label: "证据等级", value: card.evidenceLevel || card.sourceGrade },
        ]),
        points: compactStrings([...(card.relevanceToMetroRescue ?? []), ...(card.densityHypothesisRelevance ?? []), ...(card.resultsDiscussionUse ?? [])]),
        linkedItems: [],
      },
      {
        id: "boundaries",
        title: "边界与不能声称",
        rows: [],
        points: compactStrings([...(card.doNotClaim ?? []), ...(card.limitations ?? []), ...(card.qualityCaveats ?? [])]),
        linkedItems: [],
      },
      {
        id: "linked-evidence",
        title: "关联证据单元",
        rows: [],
        points: compactStrings([...(card.candidateClaims ?? []), ...(card.theoryOrMechanism ?? [])]),
        linkedItems: [],
      },
      {
        id: "quote-anchors",
        title: "引用线索",
        rows: [],
        points: compactStrings([...(card.quoteAnchorsToVerify ?? [])]),
        linkedItems: [],
      },
    ],
  };
}

function buildLocalArticleDossierView({
  article,
  sourceFile,
  libraryMeta,
  evidenceItems,
  quoteItems,
  readingNote,
  taskLens,
  evidenceSnippets,
}: {
  article: LocalArticleKnowledgeCard;
  sourceFile: string;
  libraryMeta: string;
  evidenceItems: SeedKnowledgeReviewItem[];
  quoteItems: SeedKnowledgeReviewItem[];
  readingNote?: LocalArticleReadingNote;
  taskLens?: LocalArticleTaskLens;
  evidenceSnippets: Record<string, string | undefined>;
}): Pick<ArticleKnowledgeView, "dossier" | "thesisMap" | "knowledgeSystem" | "verification"> {
  const extended = article as LocalArticleKnowledgeCard & {
    paperDossier?: LocalArticlePaperDossier;
    thesisWritingMap?: LocalArticleThesisWritingMap;
  };
  const fallbackDossier: ArticleDossier = {
    verdict: readingNote?.tldr || article.oneSentenceSummary,
    problem: readingNote?.problem || article.researchQuestion,
    motivation: readingNote?.motivation || article.researchPosition,
    design: {
      overview: readingNote?.methodSummary || article.studyDesign,
      sample: article.participantsAndSample,
      task: article.taskAndMaterials,
      variables: compactStrings(article.variablesAndMeasures),
      measures: compactStrings([...article.eegOrPhysioMeasures, ...article.behavioralMeasures]),
      analysis: inferArticleAnalysisUse(article.title, article.studyDesign, article.keyFindings.join(" ")),
    },
    findings: compactStrings(article.keyFindings).slice(0, 6),
    credibility: article.qualityTier,
    thesisRelevance: compactStrings([
      taskLens?.frameworkRole,
      article.metroRescueUse[0],
      article.densityHypothesisRelevance[0],
    ]).join(" "),
  };
  const fallbackThesisMap: ArticleThesisWritingMap = {
    relationType: inferArticleRelationType(article.grade, article.title, article.articleRole),
    frameworkRole: taskLens?.frameworkRole || article.researchPosition,
    constructs: buildConstructViews(taskLens?.constructSupport ?? []),
    chapterUses: compactStrings([...(taskLens?.manuscriptUse ?? []), ...article.writingUse]).slice(0, 8),
    writingBlocks: buildFallbackWritingBlocks({
      id: article.id,
      title: article.title,
      finding: article.keyFindings[0] || article.oneSentenceSummary,
      method: article.studyDesign,
      use: article.metroRescueUse[0] || article.researchPosition,
      boundary: article.boundaries[0] || article.doNotClaim[0],
    }),
    overclaimWarnings: compactStrings([...(taskLens?.caveats ?? []), ...article.doNotClaim, ...article.boundaries]).slice(0, 8),
    verificationTasks: compactStrings([...article.needsVerification, ...article.quoteAnchorsToVerify]).slice(0, 10),
  };

  return {
    dossier: normalizeDossier(extended.paperDossier, fallbackDossier),
    thesisMap: normalizeThesisMap(extended.thesisWritingMap, fallbackThesisMap),
    knowledgeSystem: buildFallbackKnowledgeSystem({
      coreContribution: readingNote?.tldr || article.oneSentenceSummary,
      constructs: fallbackThesisMap.constructs,
      findings: article.keyFindings,
      claims: article.metroRescueUse,
      verificationTasks: fallbackThesisMap.verificationTasks,
      openQuestions: readingNote?.followUpQuestions ?? [],
    }),
    verification: {
      sourceCode: article.id,
      sourceTitle: article.title,
      filename: sourceFile,
      libraryMeta,
      quoteAnchors: compactStrings([
        ...article.quoteAnchorsToVerify,
        ...quoteItems.map((item) => `${item.subtitle ?? "核对线索"}：${item.title}`),
      ]).slice(0, 12),
      evidenceSnippets: compactRows([
        { label: "摘要线索", value: evidenceSnippets.abstract },
        { label: "方法线索", value: evidenceSnippets.methods },
        { label: "结果/讨论线索", value: evidenceSnippets.resultsDiscussion },
      ]),
      linkedItems: evidenceItems.slice(0, 10),
    },
  };
}

function buildDynamicArticleDossierView(
  entry: LiteratureKnowledgeEntry,
  id: string,
  taskLens: Required<LocalArticleTaskLens>,
): Pick<ArticleKnowledgeView, "dossier" | "thesisMap" | "knowledgeSystem" | "verification"> {
  const card = entry.card;
  if (!card) {
    return {
      dossier: emptyArticleDossier(),
      thesisMap: emptyThesisMap(),
      knowledgeSystem: emptyKnowledgeSystem(),
      verification: emptyVerification(id),
    };
  }
  const fallbackDossier: ArticleDossier = {
    verdict: card.oneSentenceTakeaway || card.abstractZh || "这篇新增文献尚未形成完整摘要。",
    problem: card.researchQuestion || card.abstractZh || "研究问题尚未识别。",
    motivation: card.abstractZh || card.oneSentenceTakeaway || "请生成知识卡后再查看完整动机。",
    design: {
      overview: card.methods || "方法尚未识别。",
      sample: card.participants || "样本信息尚未识别。",
      task: card.taskAndMaterials || "任务材料尚未识别。",
      variables: compactStrings(card.variablesAndMeasures ?? []),
      measures: compactStrings([card.eegOrMeasures, ...(card.variablesAndMeasures ?? [])]),
      analysis: inferArticleAnalysisUse(card.title, card.methods, card.keyFindings.join(" ")),
    },
    findings: compactStrings(card.keyFindings).slice(0, 6),
    credibility: card.evidenceLevel || card.sourceGrade || "新增文献，证据等级待复核。",
    thesisRelevance: compactStrings([taskLens.frameworkRole, ...(card.relevanceToMetroRescue ?? []), ...(card.densityHypothesisRelevance ?? [])]).join(" "),
  };
  const fallbackThesisMap: ArticleThesisWritingMap = {
    relationType: inferArticleRelationType(card.sourceGrade, card.title, card.paperType),
    frameworkRole: taskLens.frameworkRole,
    constructs: buildConstructViews(taskLens.constructSupport),
    chapterUses: compactStrings([...taskLens.manuscriptUse, ...card.usableForSections]).slice(0, 8),
    writingBlocks: buildFallbackWritingBlocks({
      id,
      title: card.title,
      finding: card.keyFindings[0] || card.oneSentenceTakeaway || card.abstractZh,
      method: card.methods,
      use: card.relevanceToMetroRescue[0] || card.oneSentenceTakeaway || "",
      boundary: card.doNotClaim?.[0] || card.limitations[0] || "",
    }),
    overclaimWarnings: compactStrings([...taskLens.caveats, ...(card.doNotClaim ?? []), ...(card.qualityCaveats ?? [])]).slice(0, 8),
    verificationTasks: compactStrings([
      ...(card.quoteAnchorsToVerify ?? []),
      "正式引用前核对作者、年份、期刊、DOI、页码和原文语境。",
    ]).slice(0, 10),
  };

  return {
    dossier: normalizeDossier(card.paperDossier, fallbackDossier),
    thesisMap: normalizeThesisMap(card.thesisWritingMap, fallbackThesisMap),
    knowledgeSystem: normalizeKnowledgeSystem(
      card.singlePaperKnowledgeSystem,
      buildFallbackKnowledgeSystem({
        coreContribution: card.oneSentenceTakeaway || card.abstractZh || card.researchQuestion,
        constructs: fallbackThesisMap.constructs,
        findings: card.keyFindings,
        claims: card.candidateClaims ?? card.relevanceToMetroRescue,
        verificationTasks: fallbackThesisMap.verificationTasks,
        openQuestions: card.qualityCaveats ?? [],
      }),
    ),
    verification: {
      sourceCode: id,
      sourceTitle: card.title,
      filename: entry.document.filename,
      libraryMeta: formatDocumentListMeta(entry.document),
      quoteAnchors: compactStrings(card.quoteAnchorsToVerify ?? []).slice(0, 12),
      evidenceSnippets: [],
      linkedItems: [],
    },
  };
}

function normalizeDossier(input: LocalArticlePaperDossier | undefined, fallback: ArticleDossier): ArticleDossier {
  if (!input) return fallback;
  return {
    verdict: input.verdict || fallback.verdict,
    problem: input.problem || fallback.problem,
    motivation: input.motivation || fallback.motivation,
    design: {
      overview: input.design?.overview || fallback.design.overview,
      sample: input.design?.sample || fallback.design.sample,
      task: input.design?.task || fallback.design.task,
      variables: compactStrings(input.design?.variables ?? fallback.design.variables),
      measures: compactStrings(input.design?.measures ?? fallback.design.measures),
      analysis: input.design?.analysis || fallback.design.analysis,
    },
    findings: compactStrings(input.findings?.length ? input.findings : fallback.findings),
    credibility: input.credibility || fallback.credibility,
    thesisRelevance: input.thesisRelevance || fallback.thesisRelevance,
  };
}

function normalizeThesisMap(input: LocalArticleThesisWritingMap | undefined, fallback: ArticleThesisWritingMap): ArticleThesisWritingMap {
  if (!input) return fallback;
  return {
    relationType: input.relationType || fallback.relationType,
    frameworkRole: input.frameworkRole || fallback.frameworkRole,
    constructs: input.constructs?.length ? input.constructs : fallback.constructs,
    chapterUses: compactStrings(input.chapterUses?.length ? input.chapterUses : fallback.chapterUses),
    writingBlocks: input.writingBlocks?.length ? input.writingBlocks : fallback.writingBlocks,
    overclaimWarnings: compactStrings(input.overclaimWarnings?.length ? input.overclaimWarnings : fallback.overclaimWarnings),
    verificationTasks: compactStrings(input.verificationTasks?.length ? input.verificationTasks : fallback.verificationTasks),
  };
}

function normalizeKnowledgeSystem(input: LiteratureKnowledgeCard["singlePaperKnowledgeSystem"] | undefined, fallback: ArticleKnowledgeSystem): ArticleKnowledgeSystem {
  if (!input) return fallback;
  return {
    coreContribution: input.coreContribution || fallback.coreContribution,
    constructLinks: input.constructLinks?.length ? input.constructLinks : fallback.constructLinks,
    evidenceUnits: input.evidenceUnits?.length ? input.evidenceUnits : fallback.evidenceUnits,
    thesisClaims: input.thesisClaims?.length ? input.thesisClaims : fallback.thesisClaims,
    verificationChecklist: input.verificationChecklist?.length ? input.verificationChecklist : fallback.verificationChecklist,
    openQuestions: input.openQuestions?.length ? input.openQuestions : fallback.openQuestions,
  };
}

function buildConstructViews(items: Array<{ construct?: string; use?: string; strength?: string }>): ArticleConstructUse[] {
  const constructs = items.map((item) => ({
    construct: item.construct || "相关构念",
    support: item.strength === "high" ? "直接相关" : item.strength === "medium" ? "中等相关" : "背景相关",
    use: item.use || "作为背景或方法线索使用。",
    caution:
      item.strength === "high"
        ? "仍需用本研究数据检验，不能把文献发现写成本研究结果。"
        : "更适合作为类比或背景，不宜单独支撑核心结论。",
  }));

  return constructs.length
    ? constructs.slice(0, 6)
    : [
        {
          construct: "背景/方法边界",
          support: "背景相关",
          use: "用于补充研究语境或方法边界。",
          caution: "不能写成已验证本研究主假设。",
        },
      ];
}

function buildFallbackKnowledgeSystem({
  coreContribution,
  constructs,
  findings,
  claims,
  verificationTasks,
  openQuestions,
}: {
  coreContribution?: string | null;
  constructs: ArticleConstructUse[];
  findings: string[];
  claims: string[];
  verificationTasks: string[];
  openQuestions: string[];
}): ArticleKnowledgeSystem {
  return {
    coreContribution: coreContribution || "该文献的核心贡献需要结合原文进一步核对。",
    constructLinks: constructs.length
      ? constructs.map((item) => ({
          construct: item.construct,
          evidence: item.support,
          thesisUse: item.use,
          caution: item.caution,
        }))
      : [
          {
            construct: "与本研究相关构念",
            evidence: "尚未形成明确构念映射。",
            thesisUse: "可作为背景或边界材料，正式写作前需回到原文核对。",
            caution: "不能把相邻文献写成本研究结果。",
          },
        ],
    evidenceUnits: compactStrings(findings).slice(0, 6).map((finding, index) => ({
      topic: `证据单元 ${index + 1}`,
      evidence: finding,
      paperLocation: "待回原文核对页码/章节",
      thesisUse: "用于文献综述、方法依据或讨论边界。",
      limitation: "不能替代本研究 XDF/行为/EEG 统计结果。",
    })),
    thesisClaims: compactStrings(claims).slice(0, 6).map((claim) => ({
      claim,
      supportLevel: "文献支持/类比支持，需人工复核",
      useInSection: "引言、文献综述、理论假设或讨论",
      mustVerify: "核对作者、年份、页码、变量定义和原文语境。",
    })),
    verificationChecklist: compactStrings(verificationTasks).length
      ? compactStrings(verificationTasks)
      : ["正式引用前核对作者、年份、DOI、页码和原文语境。"],
    openQuestions: compactStrings(openQuestions).slice(0, 6),
  };
}

function buildFallbackWritingBlocks({
  id,
  title,
  finding,
  method,
  use,
  boundary,
}: {
  id: string;
  title: string;
  finding?: string | null;
  method?: string | null;
  use?: string | null;
  boundary?: string | null;
}): ArticleWritingBlock[] {
  const sourceLabel = `${id}《${title}》`;
  return [
    {
      section: "文献综述",
      purpose: "把这篇文章接入研究背景与理论链条。",
      draft: `围绕应急情境下的空间导向与疏散决策，${sourceLabel}提供了与本研究相邻的经验证据。其核心启发在于：${finding || "相关行为或认知指标需要结合具体任务情境解释"}。据此，地铁逃生中的路径确认可以被写成一个连续过程：个体先接收目标提示，再识别环境线索，最后完成行动选择。`,
    },
    {
      section: "方法与指标",
      purpose: "把文献方法转写为本研究的可复现分析口径。",
      draft: `${sourceLabel}采用的研究思路可为本研究的方法设计提供参考。结合本文的 LabRecorder XDF 数据，可进一步围绕 Unity marker 中的 sign_readable、decision_point_enter、方向选择、停留和回退事件建立 trial-level 指标，并与 EEG 事件窗特征同步。`,
    },
    {
      section: "讨论与边界",
      purpose: "避免把相邻文献误写成本研究结果。",
      draft: `需要说明的是，${sourceLabel}的作用主要在于${use || "提供理论、方法或背景参照"}。${boundary || `它不能替代本研究基于 ${EXPECTED_SUBJECT_COUNT} 名被试、${EXPECTED_XDF_COUNT} 个实验 run 的全样本 planned contrast 和协变量分析。`} 因此，正式写作时应把文献证据、项目假设和真实实验结果分层陈述。`,
    },
  ];
}

function inferArticleRelationType(grade: string | undefined, title: string, role: string | undefined) {
  const text = [title, role].join(" ").toLowerCase();
  if (grade === "A" && /(eeg|sign|signage|wayfinding|vr|virtual)/.test(text)) {
    return "主证据：可用于理论框架、变量定义或方法依据";
  }
  if (/(eeg|sign|signage|wayfinding|vr|virtual|route|navigation)/.test(text)) {
    return "相邻证据：可用于方法类比、指标定义或结果讨论";
  }
  if (/(review|framework|meta)/.test(text)) {
    return "框架证据：可用于文献综述和假设形成";
  }
  return "背景证据：用于补充研究语境、局限或未来工作";
}

function inferArticleAnalysisUse(title: string, method: string, findings: string) {
  const text = [title, method, findings].join(" ").toLowerCase();
  if (/(mixed|within-subject|repeated|anova|regression|model)/.test(text)) {
    return "可借鉴其统计建模思路；本研究应以被试为单位，检验 low / medium / high route-confirmation support 的组内差异。";
  }
  if (/(eeg|theta|alpha|erp|frequency|classification)/.test(text)) {
    return "可借鉴其 EEG 特征提取或分类思路；本研究应围绕 Unity marker 事件窗提取 theta、alpha 和 theta/alpha 等负荷指标。";
  }
  if (/(eye|gaze|attention|fixation|search)/.test(text)) {
    return "可转化为视觉搜索、回看、停留、扫描和路径确认成本等行为指标。";
  }
  if (/(vr|virtual|evacuation|wayfinding)/.test(text)) {
    return "可用于支持 VR 疏散任务的实验设计和生态效度讨论。";
  }
  return "主要作为背景或边界材料；是否进入主模型需看与本研究变量的贴近程度。";
}

function emptyArticleDossier(): ArticleDossier {
  return {
    verdict: "尚未生成论文档案。",
    problem: "尚未识别研究问题。",
    motivation: "尚未识别研究动机。",
    design: {
      overview: "尚未识别方法。",
      sample: "尚未识别样本。",
      task: "尚未识别任务材料。",
      variables: [],
      measures: [],
      analysis: "尚未识别可迁移的分析思路。",
    },
    findings: ["尚未生成主要发现。"],
    credibility: "证据等级待复核。",
    thesisRelevance: "尚未映射到本论文。",
  };
}

function emptyThesisMap(): ArticleThesisWritingMap {
  return {
    relationType: "待判断",
    frameworkRole: "尚未生成写作映射。",
    constructs: [],
    chapterUses: [],
    writingBlocks: [],
    overclaimWarnings: [],
    verificationTasks: [],
  };
}

function emptyKnowledgeSystem(): ArticleKnowledgeSystem {
  return {
    coreContribution: "尚未生成单篇知识体系。",
    constructLinks: [],
    evidenceUnits: [],
    thesisClaims: [],
    verificationChecklist: [],
    openQuestions: [],
  };
}

function emptyVerification(id: string): ArticleVerification {
  return {
    sourceCode: id,
    sourceTitle: "",
    filename: "",
    libraryMeta: "",
    quoteAnchors: [],
    evidenceSnippets: [],
    linkedItems: [],
  };
}

function buildDynamicTaskLens(card: LiteratureKnowledgeCard): Required<LocalArticleTaskLens> {
  const text = [
    card.title,
    card.paperType,
    card.oneSentenceTakeaway,
    card.researchQuestion,
    card.methods,
    card.eegOrMeasures,
    card.keyFindings.join(" "),
    card.relevanceToMetroRescue.join(" "),
    card.candidateClaims?.join(" ") ?? "",
    card.themeTags?.join(" ") ?? "",
    card.keywords.join(" "),
  ]
    .join(" ")
    .toLowerCase();

  const constructSupport: Required<LocalArticleTaskLens>["constructSupport"] = [];
  if (/(sign|signage|wayfinding|route|landmark|direction|guidance|visibility|decision)/.test(text)) {
    constructSupport.push({
      construct: "X 路径确认支持水平",
      use: "可用于定义现场官方线索、路径确认链、关键决策点覆盖或路线选择机制。",
      strength: "medium",
    });
  }
  if (/(hesitation|delay|dwell|pause|stop|response|pre-evacuation|decision|choice)/.test(text)) {
    constructSupport.push({
      construct: "Y 行动迟滞",
      use: "可用于定义行动启动延迟、停留、犹豫、核对或选择迟滞。",
      strength: "medium",
    });
  }
  if (/(reliability|trust|confidence|consistent|dependable|validity)/.test(text)) {
    constructSupport.push({
      construct: "M1 感知信息可靠性",
      use: "可用于解释个体为什么继续依赖官方路径确认线索。",
      strength: "medium",
    });
  }
  if (/(eeg|fnirs|cognitive load|workload|uncertainty|theta|alpha|attention)/.test(text)) {
    constructSupport.push({
      construct: "M2 信息加工负荷",
      use: "可用于解释目标-线索-方向匹配负担及 EEG/生理指标。",
      strength: text.includes("eeg") ? "high" : "medium",
    });
  }
  if (/(warning|protective|broadcast|message|audio|modality|mobile|text)/.test(text)) {
    constructSupport.push({
      construct: "W 保护性行动指令清晰度",
      use: "可用于解释官方提醒通道和行动指令清晰度如何影响路径确认。",
      strength: "medium",
    });
  }
  if (!constructSupport.length) {
    constructSupport.push({
      construct: "背景/边界",
      use: card.relevanceToMetroRescue[0] || card.oneSentenceTakeaway || "仅作为补充背景。",
      strength: "low",
    });
  }

  const measurementUse = compactStrings([
    text.match(/sign|signage|wayfinding|route|decision/) ? "Unity marker：sign_readable、decision_point_enter、route choice、confirmation event。" : "",
    text.match(/hesitation|delay|dwell|pause|stop|decision/) ? "行动迟滞：启动时间、决策点停顿、重复核对、扫描、掉头和回退。" : "",
    text.match(/eeg|theta|alpha|fnirs|cognitive load|attention/) ? "EEG/生理：事件窗 theta、alpha、theta/alpha 或信息加工负荷代理指标。" : "",
    text.match(/accuracy|correct|exit|choice|compliance/) ? "准确率：首次方向选择、决策点正确率和最终到达目标。" : "",
  ]);

  return {
    frameworkRole: constructSupport[0]?.construct
      ? `该文主要支持 ${constructSupport[0].construct} 相关写作。`
      : "该文主要作为背景或边界材料。",
    constructSupport,
    measurementUse,
    manuscriptUse: compactStrings([
      ...card.usableForSections.map((section) => `适合章节：${section}`),
      ...(card.methodsWritingUse ?? []),
      ...(card.resultsDiscussionUse ?? []),
    ]).slice(0, 6),
    caveats: compactStrings([...(card.doNotClaim ?? []), ...(card.qualityCaveats ?? [])]).slice(0, 5),
  };
}

function buildLinkedEvidenceItems(article: LocalArticleKnowledgeCard): SeedKnowledgeReviewItem[] {
  const claims = article.linkedEvidence.claims.map((claim) => ({
    id: claim.id,
    title: claim.text,
    subtitle: `论点 · ${claim.type}`,
    body: claim.use,
    tags: [article.id],
    meta: compactRows([
      { label: "论文位置", value: claim.section },
    ]),
  }));
  const mechanisms = article.linkedEvidence.mechanisms.map((mechanism) => ({
    id: mechanism.id,
    title: mechanism.mechanism,
    subtitle: "机制",
    body: mechanism.explanation,
    tags: [article.id],
    meta: compactRows([
      { label: "Metro 变量", value: mechanism.metroVariables },
      { label: "分析含义", value: mechanism.analysisImplication },
    ]),
  }));
  const hypotheses = article.linkedEvidence.hypotheses.map((hypothesis) => ({
    id: hypothesis.id,
    title: hypothesis.hypothesis,
    subtitle: "假设",
    body: hypothesis.model,
    tags: [article.id],
    meta: compactRows([
      { label: "预测", value: hypothesis.prediction },
      { label: "备注", value: hypothesis.note },
    ]),
    boundary: "假设必须用真实 XDF/行为数据检验，不能写成已经得到的结果。",
  }));
  const risks = article.linkedEvidence.risks.map((risk) => ({
    id: risk.id,
    title: risk.risk,
    subtitle: "风险",
    body: risk.whyItMatters,
    tags: [article.id],
    meta: compactRows([{ label: "修正", value: risk.fix }]),
  }));
  const qa = article.linkedEvidence.qa.map((item) => ({
    id: item.id,
    title: item.question,
    subtitle: "答辩问题",
    body: item.answer,
    tags: [article.id],
    meta: [],
  }));
  return [...claims, ...mechanisms, ...hypotheses, ...risks, ...qa];
}

function buildQuoteAnchorItems(article: LocalArticleKnowledgeCard): SeedKnowledgeReviewItem[] {
  return article.linkedEvidence.quoteAnchors.map((anchor) => ({
    id: anchor.id,
    title: anchor.anchor,
    subtitle: `引用线索 · ${anchor.pageTarget}`,
    body: anchor.use,
    tags: [article.id],
    meta: compactRows([{ label: "核对任务", value: anchor.verificationTask }]),
    boundary: "只能作为回查线索；未核对原文前不要当作正式 quote。",
  }));
}

function compactRows(rows: Array<{ label: string; value?: string | null }>): ArticleKnowledgeRow[] {
  return rows
    .map((row) => ({ label: row.label, value: String(row.value ?? "").trim() }))
    .filter((row) => row.value);
}

function compactStrings(values: Array<string | null | undefined>) {
  return values.map((value) => String(value ?? "").trim()).filter(Boolean);
}

function joinArticleValues(values: Array<string | null | undefined> | null | undefined) {
  return compactStrings(values ?? []).join("；");
}

type DisplaySeedMetaEntry = {
  label: string;
  value: string;
  fullValue?: string;
};

const SOURCE_REFERENCE_PATTERN = /S\d{3}/g;

function getDisplaySeedMetaEntries(meta: SeedKnowledgeReviewItem["meta"]): DisplaySeedMetaEntry[] {
  const fullSourceEntry = meta.find((entry) => entry.label === "来源文献" && entry.value);
  const hasSourceCodeEntry = meta.some((entry) => entry.label === "来源代码" && entry.value);

  return meta
    .filter((entry) => entry.value)
    .flatMap((entry) => {
      if (entry.label === "来源代码") {
        return [
          {
            label: "来源文献",
            value: entry.value,
            fullValue: fullSourceEntry?.value,
          },
        ];
      }

      if (entry.label === "来源文献") {
        if (hasSourceCodeEntry) return [];
        return [
          {
            label: "来源文献",
            value: extractSourceReferenceCodes(entry.value).join("; ") || entry.value,
            fullValue: entry.value,
          },
        ];
      }

      return [{ label: entry.label, value: entry.value }];
    });
}

function SourceReferenceValue({ entry }: { entry: DisplaySeedMetaEntry }) {
  const fullReferences = splitSourceReferences(entry.fullValue);

  return (
    <div className="source-reference-value">
      <span>{entry.value}</span>
      {fullReferences.length ? (
        <details>
          <summary>展开</summary>
          <ul>
            {fullReferences.map((reference) => (
              <li key={reference}>{reference}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function splitSourceReferences(value: string | undefined) {
  return String(value ?? "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function extractSourceReferenceCodes(value: string) {
  return Array.from(new Set(value.match(SOURCE_REFERENCE_PATTERN) ?? []));
}

function getDocumentCategory(document: Pick<ResearchDocument, "filename" | "mime_type">) {
  const filename = document.filename.toLowerCase();
  const extension = getDocumentExtension(document.filename);

  if (["xdf", "edf", "set", "mat"].includes(extension)) {
    return documentCategories[2];
  }

  if (["py", "m", "ipynb", "csv", "tsv", "xlsx", "json", "jsonl"].includes(extension)) {
    return documentCategories[3];
  }

  if (
    ["svg", "png", "jpg", "jpeg"].includes(extension) ||
    filename.includes("metro") ||
    filename.includes("signature") ||
    filename.includes("plan") ||
    filename.includes("图注") ||
    filename.includes("场景") ||
    filename.includes("标识")
  ) {
    return documentCategories[1];
  }

  if (["pdf", "doc", "docx"].includes(extension) || document.mime_type?.includes("pdf")) {
    return documentCategories[0];
  }

  return documentCategories[4];
}

function getDocumentDisplayName(
  document: ResearchDocument,
  knowledgeCard: LiteratureKnowledgeCard | null,
  seedMatch?: SeedLiteratureMatch | null,
) {
  if (isLiteratureDocument(document)) {
    const title = knowledgeCard?.title?.trim();
    if (title && title !== "未识别") return title;
    if (seedMatch?.title) return seedMatch.title;
  }

  return document.filename;
}

function getDocumentListTitle(
  document: ResearchDocument,
  knowledgeCard: LiteratureKnowledgeCard | null,
  seedMatch?: SeedLiteratureMatch | null,
) {
  const displayName = getDocumentDisplayName(document, knowledgeCard, seedMatch).trim();

  if (!isLiteratureDocument(document)) return displayName || document.filename;

  return stripLiteratureExtension(displayName || document.filename).replace(/[_-]+/g, " ").trim() || document.filename;
}

function stripLiteratureExtension(title: string) {
  return title.replace(/\.(pdf|docx?|txt|md)$/i, "");
}

function getDocumentExtension(filename: string) {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex >= 0 ? filename.slice(dotIndex + 1).toLowerCase() : "";
}

function isXdfDocument(document: Pick<ResearchDocument, "filename">) {
  return getDocumentExtension(document.filename) === "xdf";
}

function isXdfAnalysisJob(job: ResearchAnalysisJob) {
  const filename = job.research_documents?.filename ?? "";
  return getDocumentExtension(filename) === "xdf";
}

function formatDocumentKind(document: Pick<ResearchDocument, "filename">) {
  const extension = getDocumentExtension(document.filename);
  return extension ? extension.toUpperCase() : "FILE";
}

function formatDocumentListMeta(document: ResearchDocument) {
  return `入库：${new Date(document.created_at).toLocaleDateString("zh-CN")} · ${formatDocumentKind(document)} · ${formatBytes(document.size_bytes)}`;
}

function formatBytes(size: number | null) {
  if (size === null) return "unknown size";
  if (size === 0) return "0 KB";
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatXdfBulkUploadMessage(snapshot: UploadBatchSnapshot, skippedCount: number) {
  const skippedText = skippedCount ? `，已忽略 ${skippedCount} 个非 XDF 文件` : "";
  if (snapshot.completed === 0) {
    return `准备批量上传 ${snapshot.total} 个 XDF${skippedText}。`;
  }
  return `正在批量上传 XDF：已处理 ${snapshot.completed}/${snapshot.total}，成功 ${snapshot.uploaded}，失败 ${snapshot.failed}${skippedText}。`;
}

function formatUploadFailureSummary(failures: UploadBatchFailure[]) {
  if (!failures.length) return "";
  const preview = failures
    .slice(0, 4)
    .map((failure) => `${failure.filename}: ${failure.message}`)
    .join("；");
  const remaining = failures.length > 4 ? `；另有 ${failures.length - 4} 个失败未展开` : "";
  return `失败摘要：${preview}${remaining}`;
}

function buildStoragePath(userId: string, filename: string, collection = "documents") {
  const dotIndex = filename.lastIndexOf(".");
  const rawBase = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  const rawExtension = dotIndex > 0 ? filename.slice(dotIndex + 1) : "";
  const base =
    rawBase
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 90)
      .replace(/-+$/g, "") || "document";
  const extension = rawExtension.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  const uniquePrefix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const safeCollection = collection.toLowerCase().replace(/[^a-z0-9-]/g, "") || "documents";

  return `${userId}/${safeCollection}/${uniquePrefix}-${base}${extension ? `.${extension}` : ""}`;
}

function getResearchUploadCollection(filename: string, mimeType: string) {
  const extension = getDocumentExtension(filename);
  if (["pdf", "doc", "docx"].includes(extension) || mimeType.includes("pdf")) return "literature";
  if (["py", "m", "ipynb", "csv", "tsv", "xlsx", "json", "jsonl"].includes(extension)) return "analysis-products";
  return "documents";
}

async function collectXdfFilesFromDirectory(rootDirectory: BrowserFileSystemDirectoryHandle): Promise<XdfDirectoryScanResult> {
  const files: XdfUploadFile[] = [];
  let inspectedFiles = 0;
  let visitedDirectories = 0;
  const pendingDirectories: Array<{ handle: BrowserFileSystemDirectoryHandle; path: string }> = [
    { handle: rootDirectory, path: rootDirectory.name },
  ];

  while (pendingDirectories.length) {
    const directory = pendingDirectories.pop();
    if (!directory) break;
    visitedDirectories += 1;

    for await (const entry of directory.handle.values()) {
      const entryPath = `${directory.path}/${entry.name}`;
      if (entry.kind === "directory") {
        pendingDirectories.push({ handle: entry, path: entryPath });
        continue;
      }

      inspectedFiles += 1;
      if (!isXdfFilename(entry.name)) continue;

      const file = (await entry.getFile()) as XdfUploadFile;
      xdfUploadRelativePaths.set(file, entryPath);
      files.push(file);
    }
  }

  return { files, inspectedFiles, visitedDirectories };
}

function isXdfUploadFile(file: File) {
  return isXdfFilename(file.name);
}

function isXdfFilename(filename: string) {
  return getDocumentExtension(filename) === "xdf";
}

function compareXdfUploadFiles(a: File, b: File) {
  const sequenceA = inferXdfSequenceIndexFromUploadName(a);
  const sequenceB = inferXdfSequenceIndexFromUploadName(b);
  if (sequenceA !== sequenceB) return sequenceA - sequenceB;
  return getUploadFileDisplayName(a).localeCompare(getUploadFileDisplayName(b), "zh-CN", { numeric: true });
}

function inferXdfSequenceIndexFromUploadName(file: File) {
  const displayName = getUploadFileDisplayName(file);
  const sequenceMatch = displayName.match(/(?:^|[^0-9])(?:sub|file)[-_]?0*(\d{1,4})(?=[^0-9]|$)/i);
  if (sequenceMatch?.[1]) return Number(sequenceMatch[1]);
  return Number.MAX_SAFE_INTEGER;
}

function getUploadFileDisplayName(file: File) {
  const xdfFile = file as XdfUploadFile;
  return xdfUploadRelativePaths.get(file) || xdfFile.uploadRelativePath || xdfFile.webkitRelativePath || file.name;
}

function buildUploadNotes(file: File) {
  const displayName = getUploadFileDisplayName(file);
  return displayName && displayName !== file.name ? `source_relative_path: ${displayName}` : "";
}

function buildLatestJobByDocumentId(jobs: ResearchAnalysisJob[]) {
  const map = new Map<string, ResearchAnalysisJob>();
  for (const job of jobs) {
    for (const documentId of getJobDocumentIds(job)) {
      const current = map.get(documentId);
      if (!current || Date.parse(job.created_at) > Date.parse(current.created_at)) {
        map.set(documentId, job);
      }
    }
  }
  return map;
}

function getJobDisplayTitle(job: ResearchAnalysisJob) {
  const result = job.result_json as
    | {
        batch?: { subjectId?: string; documentIds?: string[] };
        cohort?: { kind?: string };
        subjectId?: string;
        sourceDocumentIds?: string[];
      }
    | null
    | undefined;
  const batch = result?.batch;

  if (job.analysis_type === "cohort_density_summary" || result?.cohort?.kind === "cohort_density_summary") {
    return "全样本路径确认支持统计汇总";
  }

  if (job.analysis_type === "subject_batch" || batch || result?.sourceDocumentIds?.length) {
    const subjectId = batch?.subjectId ?? result?.subjectId ?? inferSubjectIdFromFilename(job.research_documents?.filename ?? "");
    const count = batch?.documentIds?.length ?? result?.sourceDocumentIds?.length ?? 1;
    return `${subjectId} · ${count} 个 XDF`;
  }

  return job.research_documents?.filename ?? job.document_id;
}

function getJobHtmlReport(job: ResearchAnalysisJob): HtmlReportArtifact | null {
  const result = job.result_json as { htmlReport?: Partial<HtmlReportArtifact> } | null | undefined;
  const artifact = result?.htmlReport;
  if (!artifact?.storagePath || typeof artifact.storagePath !== "string") return null;
  return {
    storagePath: artifact.storagePath,
    filename: typeof artifact.filename === "string" ? artifact.filename : "xdf-analysis-report.html",
    sizeBytes: typeof artifact.sizeBytes === "number" ? artifact.sizeBytes : undefined,
    generatedAt: typeof artifact.generatedAt === "string" ? artifact.generatedAt : undefined,
  };
}

function getJobDocumentIds(job: ResearchAnalysisJob) {
  const result = job.result_json as
    | { batch?: { documentIds?: string[] }; sourceDocumentIds?: string[] }
    | null
    | undefined;
  const ids = result?.batch?.documentIds ?? result?.sourceDocumentIds ?? [job.document_id];
  return Array.from(new Set(ids.filter(Boolean)));
}

function getXdfJobStats(jobs: ResearchAnalysisJob[]) {
  const xdfJobs = jobs.filter(isXdfAnalysisJob);
  return {
    active: xdfJobs.filter((job) => isActiveJob(job) && !isStaleJob(job)).length,
    completed: xdfJobs.filter((job) => job.status === "completed").length,
    failed: xdfJobs.filter((job) => job.status === "failed" || job.status === "configuration_required").length,
    stale: xdfJobs.filter(isStaleJob).length,
  };
}

function countCompletedSubjectBatchJobs(jobs: ResearchAnalysisJob[]) {
  return jobs.filter((job) => {
    const result = job.result_json as { batch?: unknown; densityContrasts?: unknown } | null | undefined;
    return (
      job.status === "completed" &&
      (job.analysis_type === "subject_batch" || Boolean(result?.batch)) &&
      Array.isArray(result?.densityContrasts)
    );
  }).length;
}

function buildSubjectMatrixRows(documents: ResearchDocument[], jobs: ResearchAnalysisJob[]): XdfSubjectMatrixRow[] {
  const groupedDocuments = new Map<string, ResearchDocument[]>();
  for (const document of documents) {
    const subjectId = inferSubjectIdFromFilename(document.filename);
    groupedDocuments.set(subjectId, [...(groupedDocuments.get(subjectId) ?? []), document]);
  }

  return Array.from({ length: EXPECTED_SUBJECT_COUNT }, (_, index) => {
    const subjectIndex = index + 1;
    const subjectId = `P${String(subjectIndex).padStart(2, "0")}`;
    const expectedSequences = getExpectedSequencesForSubject(subjectIndex);
    const subjectDocuments = (groupedDocuments.get(subjectId) ?? []).sort((a, b) => compareXdfConditionOrder(a.filename, b.filename));
    const documentsByDensity: Partial<Record<DensityLevel, ResearchDocument>> = {};
    for (const level of densityLevels) {
      documentsByDensity[level] = chooseDocumentForDensity(subjectDocuments, level, expectedSequences[level]);
    }
    const missingLevels = densityLevels.filter((level) => !documentsByDensity[level]);
    const subjectJobs = jobs
      .filter((job) => isSubjectBatchJobForSubject(job, subjectId))
      .sort((a, b) => Date.parse(b.updated_at || b.created_at) - Date.parse(a.updated_at || a.created_at));
    const latestJob = subjectJobs[0] ?? null;
    const completedJob = subjectJobs.find((job) => job.status === "completed" && getJobHtmlReport(job)) ?? subjectJobs.find((job) => job.status === "completed") ?? null;
    const activeJob = subjectJobs.find((job) => isActiveJob(job) && !isStaleJob(job)) ?? null;
    const failedJob = subjectJobs.find((job) => job.status === "failed" || job.status === "configuration_required" || isStaleJob(job)) ?? null;
    const complete = missingLevels.length === 0;
    const runnable = complete && !activeJob && !completedJob;
    return {
      subjectId,
      subjectIndex,
      expectedSequences,
      documents: subjectDocuments,
      documentsByDensity,
      missingLevels,
      latestJob,
      completedJob,
      activeJob,
      failedJob,
      complete,
      runnable,
    };
  });
}

function summarizeSubjectMatrix(rows: XdfSubjectMatrixRow[]): XdfSubjectMatrixStats {
  return {
    uploadedRuns: rows.reduce((sum, row) => sum + row.documents.length, 0),
    completeSubjects: rows.filter((row) => row.complete).length,
    runnableSubjects: rows.filter((row) => row.runnable).length,
    activeSubjects: rows.filter((row) => row.activeJob).length,
    completedSubjects: rows.filter((row) => row.completedJob).length,
    failedSubjects: rows.filter((row) => row.failedJob && !row.activeJob && !row.completedJob).length,
  };
}

function buildSubjectMatrixCsv(rows: XdfSubjectMatrixRow[]) {
  const headers = [
    "participant_id",
    "subject_index",
    "expected_low_sequence",
    "expected_medium_sequence",
    "expected_high_sequence",
    "low_filename",
    "medium_filename",
    "high_filename",
    "uploaded_run_count",
    "missing_levels",
    "matrix_status",
    "latest_job_status",
    "latest_job_updated_at",
    "completed_report_available",
  ];
  const body = rows.map((row) => {
    const values = [
      row.subjectId,
      row.subjectIndex,
      row.expectedSequences.low,
      row.expectedSequences.medium,
      row.expectedSequences.high,
      row.documentsByDensity.low?.filename ?? "",
      row.documentsByDensity.medium?.filename ?? "",
      row.documentsByDensity.high?.filename ?? "",
      row.documents.length,
      row.missingLevels.map((level) => densityLabels[level]).join(" / "),
      getSubjectMatrixStatus(row),
      row.latestJob?.status ?? "",
      row.latestJob?.updated_at ?? "",
      row.completedJob && getJobHtmlReport(row.completedJob) ? "yes" : "no",
    ];
    return values.map(csvCell).join(",");
  });
  return `\uFEFF${[headers.map(csvCell).join(","), ...body].join("\r\n")}\r\n`;
}

function csvCell(value: string | number | boolean | null | undefined) {
  const text = String(value ?? "");
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function filterSubjectMatrixRow(row: XdfSubjectMatrixRow, filter: SubjectMatrixFilter) {
  if (filter === "all") return true;
  if (filter === "ready") return row.runnable;
  if (filter === "missing") return !row.complete;
  if (filter === "active") return Boolean(row.activeJob);
  if (filter === "completed") return Boolean(row.completedJob);
  if (filter === "failed") return Boolean(row.failedJob && !row.activeJob && !row.completedJob);
  return true;
}

function getExpectedSequencesForSubject(subjectIndex: number): Record<DensityLevel, number> {
  const base = (subjectIndex - 1) * EXPECTED_RUNS_PER_SUBJECT;
  return {
    low: base + 1,
    medium: base + 2,
    high: base + 3,
  };
}

function chooseDocumentForDensity(documents: ResearchDocument[], level: DensityLevel, expectedSequence: number) {
  return (
    documents.find((document) => inferDensityLevelFromFilename(document.filename) === level) ??
    documents.find((document) => filenameHasSequence(document.filename, expectedSequence))
  );
}

function filenameHasSequence(filename: string, expectedSequence: number) {
  const padded = String(expectedSequence).padStart(3, "0");
  const normalized = filename.toLowerCase();
  return normalized.includes(`sub-${padded}`) || normalized.includes(`sub${padded}`) || normalized.includes(`_${padded}_`);
}

function isSubjectBatchJobForSubject(job: ResearchAnalysisJob, subjectId: string) {
  if (job.analysis_type !== "subject_batch") return false;
  return getSubjectIdFromAnalysisJob(job) === subjectId;
}

function getSubjectIdFromAnalysisJob(job: ResearchAnalysisJob) {
  const result = job.result_json as { batch?: { subjectId?: string }; subjectId?: string } | string | null | undefined;
  if (!result) return "";
  if (typeof result === "string") {
    try {
      const parsed = JSON.parse(result) as { batch?: { subjectId?: string }; subjectId?: string };
      return parsed.batch?.subjectId ?? parsed.subjectId ?? "";
    } catch {
      return "";
    }
  }
  return result.batch?.subjectId ?? result.subjectId ?? "";
}

function getSubjectMatrixStatus(row: XdfSubjectMatrixRow) {
  if (row.completedJob) return "已完成";
  if (row.activeJob) return formatJobStatus(row.activeJob.status);
  if (row.failedJob) return isStaleJob(row.failedJob) ? "需检查" : formatJobStatus(row.failedJob.status);
  if (row.runnable) return "可提交";
  if (!row.complete) return `缺 ${row.missingLevels.map((level) => densityLabels[level]).join(" / ")}`;
  return "待提交";
}

function getSubjectMatrixTone(row: XdfSubjectMatrixRow) {
  if (row.completedJob) return "completed";
  if (row.activeJob) return getJobTone(row.activeJob);
  if (row.failedJob) return "warning";
  if (row.runnable) return "queued";
  return "muted-state";
}

function formatMarkerRequirement(required: "required" | "recommended" | "optional") {
  if (required === "required") return "必需";
  if (required === "recommended") return "建议";
  return "可选";
}

function isRunnableSubjectGroup(group: { subjectId: string; documents: ResearchDocument[] }, jobs: ResearchAnalysisJob[]) {
  const coverage = summarizeDensityCoverage(group.documents);
  if (!coverage.complete || group.documents.length < 3) return false;
  return !jobs.some((job) => {
    const result = job.result_json as { batch?: { subjectId?: string }; subjectId?: string } | null | undefined;
    const jobSubjectId = result?.batch?.subjectId ?? result?.subjectId ?? "";
    const isSameSubject = jobSubjectId === group.subjectId;
    const isReusableStatus = job.status === "pending" || job.status === "queued" || job.status === "running" || job.status === "completed";
    return (job.analysis_type === "subject_batch" || Boolean(result?.batch)) && isSameSubject && isReusableStatus;
  });
}

function filterJobForView(job: ResearchAnalysisJob, filter: JobViewFilter) {
  if (filter === "all") return true;
  if (filter === "active") return isActiveJob(job) && !isStaleJob(job);
  if (filter === "completed") return job.status === "completed";
  if (filter === "failed") return job.status === "failed" || job.status === "configuration_required";
  if (filter === "stale") return isStaleJob(job);
  return true;
}

function isActiveJob(job: ResearchAnalysisJob) {
  return job.status === "pending" || job.status === "queued" || job.status === "running";
}

function isStaleJob(job: ResearchAnalysisJob) {
  if (!isActiveJob(job)) return false;
  const reference = Date.parse(job.updated_at || job.created_at);
  return Number.isFinite(reference) && Date.now() - reference > 10 * 60 * 1000;
}

function getJobTone(job: ResearchAnalysisJob) {
  if (isStaleJob(job)) return "stale";
  if (job.status === "completed") return "completed";
  if (job.status === "failed") return "failed";
  if (job.status === "configuration_required") return "warning";
  if (job.status === "running") return "running";
  if (job.status === "queued" || job.status === "pending") return "queued";
  return "muted-state";
}

function getJobProgress(job: ResearchAnalysisJob) {
  if (job.status === "completed") return 100;
  if (job.status === "failed" || job.status === "configuration_required" || isStaleJob(job)) return 100;
  const batchProgress = getBatchProgressFromMessage(job.status_message);
  if (batchProgress !== null) return batchProgress;
  if (job.status === "running") return 72;
  if (job.status === "queued") return 42;
  if (job.status === "pending") return 18;
  return 0;
}

function getBatchProgressFromMessage(message: string | null) {
  if (!message) return null;
  const match = message.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return null;
  const current = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return null;
  return Math.min(95, Math.max(18, Math.round((current / total) * 88)));
}

function getJobMessage(job: ResearchAnalysisJob) {
  if (isStaleJob(job)) {
    return job.status_message || job.error_message || "任务长时间未更新。";
  }
  return job.status_message || job.error_message || "等待 worker 更新任务状态。";
}

function formatJobStatus(status: ResearchAnalysisJob["status"]) {
  const labels: Record<ResearchAnalysisJob["status"], string> = {
    pending: "等待中",
    queued: "已排队",
    running: "运行中",
    completed: "已完成",
    failed: "失败",
    configuration_required: "需要配置",
  };

  return labels[status] ?? status;
}

function groupXdfDocumentsBySubject(documents: ResearchDocument[]) {
  const grouped = new Map<string, ResearchDocument[]>();
  for (const document of documents) {
    const subjectId = inferSubjectIdFromFilename(document.filename);
    grouped.set(subjectId, [...(grouped.get(subjectId) ?? []), document]);
  }
  return Array.from(grouped.entries())
    .map(([subjectId, groupDocuments]) => ({
      subjectId,
      documents: groupDocuments.sort((a, b) => compareXdfConditionOrder(a.filename, b.filename)),
    }))
    .sort((a, b) => a.subjectId.localeCompare(b.subjectId));
}

function inferSubjectIdFromFilename(filename: string) {
  return inferXdfSubjectId(filename);
}

function inferRunLabelFromFilename(filename: string) {
  return inferXdfRunLabel(filename);
}

function inferDensityLevelFromFilename(filename: string): DensityLevel | null {
  return inferXdfDensityLevel(filename);
}

function formatDensityLabel(level: DensityLevel | null) {
  return level ? densityLabels[level] : "条件待标注";
}

function summarizeDensityCoverage(documents: ResearchDocument[]) {
  const levels = documents.map((document) => inferDensityLevelFromFilename(document.filename)).filter((level): level is DensityLevel => Boolean(level));
  const uniqueLevels = Array.from(new Set(levels)).sort((a, b) => densityLevels.indexOf(a) - densityLevels.indexOf(b));
  const label = uniqueLevels.length ? uniqueLevels.map((level) => densityLabels[level]).join(" / ") : "条件待标注";
  return {
    levels: uniqueLevels,
    label,
    complete: densityLevels.every((level) => uniqueLevels.includes(level)),
  };
}

function compareXdfConditionOrder(a: string, b: string) {
  return compareXdfConditionNames(a, b);
}

function countCsvDataRows(csvText: string) {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return Math.max(0, lines.length - 1);
}
