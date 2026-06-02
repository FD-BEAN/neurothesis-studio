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
import {
  compareXdfConditionNames,
  densityLabels,
  densityLevels,
  inferXdfDensityLevel,
  inferXdfRunLabel,
  inferXdfSubjectId,
  type DensityLevel,
} from "@/lib/xdfNaming";

type UploadState = "idle" | "uploading" | "done" | "error";

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

const RESEARCH_FILE_ACCEPT = ".pdf,.doc,.docx,.csv,.tsv,.xlsx,.txt,.md,.svg,.png,.jpg,.jpeg,.json,.jsonl,.py,.m,.ipynb";
const XDF_FILE_ACCEPT = ".xdf";

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

const writingTaskModes = [
  {
    id: "section-draft",
    label: "写论文章节",
    description: "直接生成目标章节的连续正文，证据链放在正文之后核验。",
  },
  {
    id: "methods-analysis",
    label: "写方法与分析",
    description: "生成方法、分析计划的中文正文、模型说明和变量口径。",
  },
  {
    id: "evidence-map",
    label: "证据到段落",
    description: "先组织证据，再输出可进入论文的段落和引用边界。",
  },
  {
    id: "review-revision",
    label: "审稿式修改",
    description: "把已有段落按证据边界重写，并给出修改理由。",
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
  "中文段落要保守、连续、可直接放进论文草稿；英文只保留必要术语和文献原题。",
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
      "请直接起草“引言”的中文论文正文，形成一个完整小节而不是提纲：从公共空间应急疏散中的官方提醒与现场标识脱节、路径确认信息链、准确性-努力权衡，到本研究为什么用 VR 地铁撤离和 EEG 检验行动迟滞。正文后再给出证据说明、可引用文献和不能声称的边界。",
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
      "请写一份可放入论文或预注册说明的中文统计分析计划：90 名被试、每人 3 个路径确认支持 run；sub001/sub002/sub003 归为 P01，sub004/sub005/sub006 归为 P02；Signature1/2/3 分别映射为低/中/高路径确认支持；主检验为 medium - mean(low, high)。请说明组内模型、组间变量需要哪些 metadata、事件窗 EEG 指标、行动迟滞指标、路径判断准确率和多重比较策略。",
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
      "请整理 Discussion 的可讨论机制、替代解释、局限和不能过度声称的边界。重点检查中等路径确认支持最高行动迟滞/信息加工负荷这一假设是否有文献类比支持、哪些内容必须等真实 EEG/行为结果支持，以及 VR 生态效度、marker 同步、个体差异、保护性行动指令清晰度和组内/组间分析的风险。",
  },
  {
    label: "审稿式自查",
    mode: "review-revision",
    section: "discussion",
    output: "audit",
    prompt:
      "请像审稿人一样检查当前写作思路：研究问题是否清楚、文献证据是否足够、变量定义是否一致、route-confirmation support 与 Signature 命名是否混用、EEG 指标解释是否过度、行动迟滞和准确率是否被区分、统计模型是否匹配 90×3 的组内设计。请给出可执行修改清单。",
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
  const [jobsLastLoadedAt, setJobsLastLoadedAt] = useState<string | null>(null);
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([]);
  const [batchSubjectId, setBatchSubjectId] = useState("");
  const [subjectMetadataCsv, setSubjectMetadataCsv] = useState("participant_id,group\nP01,A\nP02,B");
  const [groupVariable, setGroupVariable] = useState("group");
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
    const nonXdfFiles = files.filter((file) => !isXdfUploadFile(file));

    if (nonXdfFiles.length) {
      setXdfUploadState("error");
      setXdfUploadMessage("XDF 上传入口只接收 LabRecorder .xdf 文件。文献、脚本和笔记请上传到研究资料库。");
      event.target.value = "";
      return;
    }

    setXdfUploadState("uploading");
    setXdfUploadMessage("");

    let uploaded = 0;
    for (const file of files) {
      try {
        await uploadDocumentFile(file, "xdf-raw");
      } catch (error) {
        setXdfUploadState("error");
        setXdfUploadMessage(`已上传 ${uploaded}/${files.length} 个 XDF；${error instanceof Error ? error.message : "上传失败"}`);
        event.target.value = "";
        await loadDocuments();
        return;
      }

      uploaded += 1;
    }

    setXdfUploadState("done");
    setXdfUploadMessage(`${uploaded} 个 XDF 已上传到实验数据区。系统会按 001/002/003 三连号推断被试，并按 Signature1/2/3 推断低/中/高路径确认支持。`);
    event.target.value = "";
    await loadDocuments();
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
      notes: "",
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
      setJobMessage("被试批量分析至少需要选择 2 个 XDF；正式数据建议同一被试的低/中/高路径确认支持 3 个 run 一起提交。");
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
    setJobMessage(`准备提交 ${runnableGroups.length} 个被试的组内分析任务。`);

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

    setJobMessage(lastWarning || `已提交 ${submitted} 个被试的组内分析任务。GitHub Actions 会逐个运行，完成后可再跑全样本/组间汇总。`);
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
      setJobMessage("subject metadata 目前请上传 CSV；Excel 可以先另存为 .csv。");
      event.target.value = "";
      return;
    }
    const text = await file.text();
    setSubjectMetadataCsv(text.trim());
    const header = text.split(/\r?\n/)[0] ?? "";
    const columns = header.split(",").map((column) => column.trim()).filter(Boolean);
    if (!columns.includes(groupVariable) && columns.includes("group")) {
      setGroupVariable("group");
    }
    setJobMessage(`已读取 metadata CSV：${file.name}。请确认分组列名后再提交全样本/组间汇总。`);
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
                  {knowledgeLoading ? "生成知识卡片中..." : "生成/更新知识卡片"}
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
          <SeedKnowledgeReviewPanel entries={knowledgeEntries} />
        </section>

        <section className="view is-visible" id="pipeline">
          <div className="section-head">
            <div>
              <p className="eyebrow">数据分析与论文写作</p>
              <h2>XDF 批量分析与报告</h2>
            </div>
            <div className="top-actions">
              <button
                className="secondary-button"
                disabled={jobLoading || !completedSubjectBatchCount || !xdfDocuments.length}
                onClick={runCohortDensitySummary}
              >
                汇总组内/组间
              </button>
              <button className="secondary-button" onClick={loadAnalysisJobs}>
                刷新任务
              </button>
              <label className="file-button">
                <input type="file" multiple accept={XDF_FILE_ACCEPT} onChange={handleXdfUpload} />
                {xdfUploadState === "uploading" ? "上传 XDF 中..." : "上传 XDF"}
              </label>
            </div>
          </div>
          {xdfUploadMessage ? <p className={`notice ${xdfUploadState}`}>{xdfUploadMessage}</p> : null}
          {jobMessage ? <p className="notice">{jobMessage}</p> : null}
          <div className="library-status-grid pipeline-status-grid">
            <StatusMetric label="XDF 文件" value={xdfDocuments.length} text="LabRecorder EEG + Unity marker" />
            <StatusMetric label="已选择" value={selectedBatchIds.length} text="准备提交批量分析" />
            <StatusMetric label="进行中" value={xdfJobStats.active} text="pending / queued / running" />
            <StatusMetric label="已完成" value={xdfJobStats.completed} text="可下载 HTML 报告" />
            <StatusMetric label="失败/需处理" value={xdfJobStats.failed + xdfJobStats.stale} text="失败或长时间未更新" tone="warn" />
          </div>
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
              <pre>{aiState.output || "生成后，这里会显示可直接审阅和继续修改的论文正文。"}</pre>
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
          <h3>同一被试的低 / 中 / 高路径确认支持 XDF 一起分析</h3>
        </div>
        <span className="status-pill compact">
          {selectedIds.length} 个已选{selectedIds.length ? ` · ${selectedCoverage.label}` : ""}
        </span>
      </div>
      <p className="muted">
        正式数据按 90 名被试 × 3 个路径确认支持条件组织。实验文件 sub001/sub002/sub003 归为 P01，sub004/sub005/sub006 归为 P02，以此类推；Signature1/2/3 分别对应低/中/高路径确认支持。报告会输出被试内条件表和主 planned contrast：中等支持 - 低/高支持平均。
      </p>
      <div className="design-strip" aria-label="分析设计">
        <span>90 被试</span>
        <span>3 路径确认支持条件</span>
        <span>270 个 XDF</span>
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
          <strong>按文件名推断的被试组</strong>
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
            <p className="muted">还没有 XDF 文件。上传后会按文件编号三连组推断被试，并按 Signature 或编号位置推断低/中/高路径确认支持条件。</p>
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
          <p className="eyebrow">全样本与组间分析</p>
          <h3>汇总已完成被试，并用 subject metadata 做组间比较</h3>
        </div>
        <span className="status-pill compact">{completedSubjectBatchCount} 个已完成被试报告</span>
      </div>
      <p className="muted">
        不填 metadata 时，报告只做总体组内 planned contrast；填写后，会按分组列比较每名被试的 subject-level contrast。2 个被试 × 3 个实验可以作为趋势检查，正式显著性需要每组更多被试。
      </p>
      <div className="metadata-grid">
        <label>
          分组列名
          <input value={groupVariable} placeholder="例如 group" onChange={(event) => onGroupVariableChange(event.target.value)} />
        </label>
        <label className="file-button compact-file-button">
          <input type="file" accept=".csv,text/csv" onChange={onMetadataFileUpload} />
          读取 CSV
        </label>
      </div>
      <label>
        Subject metadata CSV
        <textarea
          value={metadataCsv}
          rows={6}
          spellCheck={false}
          placeholder={"participant_id,group,sex,vr_experience,order\nP01,A,F,low,1\nP02,B,M,high,2"}
          onChange={(event) => onMetadataChange(event.target.value)}
        />
      </label>
      <div className="metadata-footer">
        <span className="muted">已识别 {metadataRows} 行 metadata；被试编号建议使用 P01、P02，也支持 1、2 或 sub001 这类写法。</span>
        <button className="primary-button" disabled={jobLoading || completedSubjectBatchCount < 1} onClick={onRun}>
          生成全样本/组间 HTML 报告
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
          <p>把文献证据映射到综述、假设、方法、讨论和中文段落。</p>
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
}): Pick<ArticleKnowledgeView, "dossier" | "thesisMap" | "verification"> {
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
): Pick<ArticleKnowledgeView, "dossier" | "thesisMap" | "verification"> {
  const card = entry.card;
  if (!card) {
    return {
      dossier: emptyArticleDossier(),
      thesisMap: emptyThesisMap(),
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
      draft: `围绕应急情境下的空间导向与疏散决策，${sourceLabel}提供了与本研究相邻的经验证据。其核心启发在于：${finding || "相关行为或认知指标需要结合具体任务情境解释"}。因此，该文献可用于说明地铁逃生中的路径确认并非单纯的空间移动问题，而是包含目标提示、环境线索识别和行动选择的连续过程。`,
    },
    {
      section: "方法与指标",
      purpose: "把文献方法转写为本研究的可复现分析口径。",
      draft: `${sourceLabel}采用的研究思路可为本研究的方法设计提供参考。结合本文的 LabRecorder XDF 数据，可进一步围绕 Unity marker 中的 sign_readable、decision_point_enter、方向选择、停留和回退事件建立 trial-level 指标，并与 EEG 事件窗特征同步。`,
    },
    {
      section: "讨论与边界",
      purpose: "避免把相邻文献误写成本研究结果。",
      draft: `需要说明的是，${sourceLabel}的作用主要在于${use || "提供理论、方法或背景参照"}。${boundary || "它不能替代本研究基于 90 名被试、270 个实验 run 的组内和组间统计检验。"} 因此，正式写作时应把文献证据、项目假设和真实实验结果分层陈述。`,
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

function isXdfUploadFile(file: File) {
  return getDocumentExtension(file.name) === "xdf";
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
