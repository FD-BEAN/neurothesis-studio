"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import {
  getSupabaseBrowserClient,
  hasSupabaseBrowserConfig,
  type ResearchAnalysisJob,
  type ResearchDocument,
} from "@/lib/supabase";
import type { SeedKnowledgeReview, SeedKnowledgeReviewItem, SeedLiteratureMatch } from "@/lib/knowledgeBase";
import { isLiteratureDocument, parseLiteratureCard, type LiteratureKnowledgeCard } from "@/lib/literature";
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
    text: "XDF 质量检查、行为数据、EEG 预处理和英文论文段落。",
  },
  {
    href: "#ai",
    title: "文献与写作助手",
    text: "基于已入库论文知识卡片生成文献矩阵、Methods 草稿和分析计划。",
  },
  {
    href: "#files",
    title: "研究资料库",
    text: "文献知识库、XDF 原始数据、分析脚本和写作材料。",
  },
  {
    href: "#knowledge",
    title: "知识库审阅",
    text: "查看内置文献卡、claims、机制、假设、模型和引用锚点。",
  },
];

const knowledgeReviewNotes = [
  "这里保存的是可审阅的文献卡、论点、机制、风险和引用线索，不替代 PDF 原文。",
  "正式写入论文前仍需回到原文核对页码、作者、年份、DOI 和原句语境。",
  "项目假设、写作块和分析模型只用于组织论文与建模，不等于已经得到实验结果。",
  "历史字段中的 Signature1/2/3 在当前研究中统一映射为低/中/高密度条件，论文正文使用 Density condition。",
  "S001 这类编号只是文献索引；需要标题时可在条目中的“来源文献”展开查看。",
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
    id: "evidence-map",
    label: "证据矩阵",
    description: "把论点拆成文献证据、项目假设和待验证结果。",
  },
  {
    id: "section-draft",
    label: "章节草稿",
    description: "生成可进入论文的连续段落，并保留引用边界。",
  },
  {
    id: "methods-analysis",
    label: "方法与分析",
    description: "围绕实验设计、XDF、EEG 指标和统计模型写作。",
  },
  {
    id: "review-revision",
    label: "审稿式修改",
    description: "检查逻辑、证据、措辞和过度声称风险。",
  },
] as const;

type WritingTaskModeId = (typeof writingTaskModes)[number]["id"];

const writingTargetSections = [
  { id: "introduction", label: "Introduction / Related Work" },
  { id: "methods", label: "Methods" },
  { id: "analysis-plan", label: "Analysis Plan" },
  { id: "results", label: "Results" },
  { id: "discussion", label: "Discussion" },
  { id: "abstract", label: "Abstract" },
] as const;

type WritingTargetSectionId = (typeof writingTargetSections)[number]["id"];

const writingOutputModes = [
  { id: "structured", label: "结构化提纲 + 写作要点" },
  { id: "manuscript", label: "中英双语论文段落" },
  { id: "audit", label: "证据审计与修改建议" },
] as const;

type WritingOutputModeId = (typeof writingOutputModes)[number]["id"];

const writingProtocolRules = [
  "引用必须来自文献知识库、已上传文献卡或真实分析报告。",
  "显著性、效应量、样本完成情况和页码不能编造。",
  "区分文献证据、项目假设、真实实验结果和需要补充的信息。",
  "英文段落要保守、连续、可直接放进论文草稿。",
];

const writingWorkflowPresets: Array<{
  label: string;
  mode: WritingTaskModeId;
  section: WritingTargetSectionId;
  output: WritingOutputModeId;
  prompt: string;
}> = [
  {
    label: "Introduction 证据链",
    mode: "evidence-map",
    section: "introduction",
    output: "structured",
    prompt:
      "请围绕本研究的 Introduction 建立证据链：从 VR/室内疏散导航、导向标识信息设计、EEG 认知负荷测量，到本研究的密度条件假设。请按“论点-文献依据-可写句子-不能声称”组织，并标出最适合引用的文献代码或文献标题。",
  },
  {
    label: "Methods 正文",
    mode: "methods-analysis",
    section: "methods",
    output: "manuscript",
    prompt:
      "请起草 Methods 相关英文正文，覆盖 participants/design、VR metro rescue task、low/medium/high density condition、Unity marker 与 LabRecorder XDF 同步、EEG 指标和行为指标。不要编造设备参数、实际样本完成数或尚未确认的排除标准。",
  },
  {
    label: "统计分析计划",
    mode: "methods-analysis",
    section: "analysis-plan",
    output: "structured",
    prompt:
      "请写一份可放入论文或预注册说明的 Analysis Plan：90 名被试、每人 3 个 density run；001/002/003 为同一被试，004/005/006 为下一被试；Signature1/2/3 分别映射为低/中/高密度；主检验为 medium - mean(low, high)。请说明组内模型、组间变量需要哪些 metadata、事件窗 EEG 指标、行为指标和多重比较策略。",
  },
  {
    label: "Results 模板",
    mode: "section-draft",
    section: "results",
    output: "manuscript",
    prompt:
      "请生成 Results 写作模板。只能使用已完成 XDF 或 cohort 报告中的真实统计结果；如果上下文没有真实结果，请用清晰占位符标记需要填入的统计量、置信区间、p 值和图表编号，不要写成已经显著。",
  },
  {
    label: "Discussion 边界",
    mode: "review-revision",
    section: "discussion",
    output: "audit",
    prompt:
      "请整理 Discussion 的可讨论机制、替代解释、局限和不能过度声称的边界。重点检查中等密度最高认知负荷这一假设是否有文献类比支持、哪些内容必须等真实 EEG/行为结果支持，以及 VR 生态效度、marker 同步、个体差异和组内/组间分析的风险。",
  },
  {
    label: "审稿式自查",
    mode: "review-revision",
    section: "discussion",
    output: "audit",
    prompt:
      "请像审稿人一样检查当前写作思路：研究问题是否清楚、文献证据是否足够、变量定义是否一致、Density condition 与 Signature 命名是否混用、EEG 指标解释是否过度、统计模型是否匹配 90×3 的组内设计。请给出可执行修改清单。",
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
  const [writingMode, setWritingMode] = useState<WritingTaskModeId>("evidence-map");
  const [writingSection, setWritingSection] = useState<WritingTargetSectionId>("introduction");
  const [writingOutputMode, setWritingOutputMode] = useState<WritingOutputModeId>("structured");
  const [researchNote, setResearchNote] = useState(writingWorkflowPresets[0].prompt);
  const [aiState, setAiState] = useState<AiState>({ status: "idle", output: "" });
  const [analysisJobs, setAnalysisJobs] = useState<ResearchAnalysisJob[]>([]);
  const [jobMessage, setJobMessage] = useState("");
  const [jobLoading, setJobLoading] = useState(false);
  const [knowledgeEntries, setKnowledgeEntries] = useState<LiteratureKnowledgeEntry[]>([]);
  const [seedKnowledgeReview, setSeedKnowledgeReview] = useState<SeedKnowledgeReview | null>(null);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeMessage, setKnowledgeMessage] = useState("");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("all");
  const [jobViewFilter, setJobViewFilter] = useState<JobViewFilter>("all");
  const [jobsLastLoadedAt, setJobsLastLoadedAt] = useState<string | null>(null);
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([]);
  const [batchSubjectId, setBatchSubjectId] = useState("");
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
      seedReview?: SeedKnowledgeReview;
    };
    setKnowledgeEntries(payload.cards ?? []);
    setSeedKnowledgeReview(payload.seedReview ?? null);
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
    setXdfUploadMessage(`${uploaded} 个 XDF 已上传到实验数据区。系统会按 001/002/003 三连号推断被试，并按 Signature1/2/3 推断低/中/高密度。`);
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
      setJobMessage("被试批量分析至少需要选择 2 个 XDF；正式数据建议同一被试的低/中/高密度 3 个 run 一起提交。");
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
        documentIds: uniqueDocumentIds,
        subjectId: subjectId.trim() || inferSubjectIdFromFilename(selectedBatchDocuments[0]?.filename ?? ""),
        analysisType: "subject_batch",
      }),
    });

    const payload = (await response.json()) as { job?: ResearchAnalysisJob; error?: string; warning?: string };
    if (!response.ok && !payload.job) {
      setJobMessage(payload.error ?? "被试批量 XDF 分析任务创建失败。");
      setJobLoading(false);
      return;
    }

    setJobMessage(payload.warning ?? `已提交 ${uniqueDocumentIds.length} 个 XDF 的被试密度条件批量分析任务。`);
    await loadAnalysisJobs();
    setJobLoading(false);
  }

  async function runCohortDensitySummary() {
    if (!xdfDocuments.length) {
      setJobMessage("还没有 XDF 文件，无法创建全样本汇总任务。");
      return;
    }
    if (!completedSubjectBatchCount) {
      setJobMessage("还没有已完成的被试批量报告。请先按被试提交低/中/高密度 XDF 分析。");
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
      }),
    });

    const payload = (await response.json()) as { job?: ResearchAnalysisJob; error?: string; warning?: string };
    if (!response.ok && !payload.job) {
      setJobMessage(payload.error ?? "全样本密度统计汇总任务创建失败。");
      setJobLoading(false);
      return;
    }

    setJobMessage(payload.warning ?? `已提交全样本密度统计汇总任务，将汇总 ${completedSubjectBatchCount} 个已完成被试报告。`);
    await loadAnalysisJobs();
    setJobLoading(false);
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
                  <p className="eyebrow">当前选中</p>
                  <h3>{selectedDocument ? selectedDisplayName : "尚未选择文件"}</h3>
                </div>
                {selectedCategory ? <span className="category-badge">{selectedCategory.label}</span> : null}
              </div>
              <dl className="file-meta">
                <div>
                  <dt>原始文件名</dt>
                  <dd>{selectedDocument ? selectedDocument.filename : "未选择"}</dd>
                </div>
                <div>
                  <dt>文件类型</dt>
                  <dd>{selectedDocument ? formatDocumentKind(selectedDocument) : "未选择"}</dd>
                </div>
                <div>
                  <dt>文件大小</dt>
                  <dd>{selectedDocument ? formatBytes(selectedDocument.size_bytes) : "未选择"}</dd>
                </div>
                <div>
                  <dt>入库日期</dt>
                  <dd>
                    {selectedDocument ? new Date(selectedDocument.created_at).toLocaleDateString("zh-CN") : "未选择"}
                  </dd>
                </div>
              </dl>
              <p className="muted">文件保持私有。需要阅读原文件时，会生成一个短时间有效的临时链接。</p>
              <button
                className="secondary-button"
                disabled={!selectedDocument}
                onClick={() => selectedDocument && openSignedUrl(selectedDocument)}
              >
                打开文件
              </button>
              {selectedDocumentIsLiterature ? (
                <p className="muted">
                  文献入库会抽取论文目的、方法、EEG/行为指标、主要发现、局限和可引用章节，生成结构化知识卡片供写作助手引用。
                </p>
              ) : null}
              {selectedDocumentIsLiterature && selectedSeedMatch ? (
                <p className="muted">
                  这篇文献已入库并可被写作助手引用。点击生成时会直接提示已存在，不会重复调用 OpenAI。
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
          <SeedKnowledgeReviewPanel entries={knowledgeEntries} review={seedKnowledgeReview} />
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
                汇总已完成被试
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
            onRunGroup={(group) => {
              setBatchSubjectId(group.subjectId);
              setSelectedBatchIds(group.documents.map((document) => document.id));
              void runSubjectBatchAnalysis(
                group.documents.map((document) => document.id),
                group.subjectId,
              );
            }}
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
              <h2>证据驱动写作工作台</h2>
            </div>
            <button className="primary-button" onClick={runAiAssistant} disabled={aiState.status === "loading"}>
              {aiState.status === "loading" ? "生成中..." : "生成写作结果"}
            </button>
          </div>

          <div className="ai-grid">
            <section className="work-panel assistant-task-panel">
              <h3>写作任务</h3>
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
              <h3>写作结果</h3>
              <p className="muted">
                当前任务：{selectedWritingMode.label} · {selectedWritingSection.label} · {selectedWritingOutput.label}
              </p>
              <pre>{aiState.output || "生成后，这里会显示可审阅、可追溯的写作结果。"}</pre>
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
  onRunGroup,
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
  onRunGroup: (group: { subjectId: string; documents: ResearchDocument[] }) => void;
}) {
  const selectedCoverage = summarizeDensityCoverage(documents.filter((document) => selectedIds.includes(document.id)));

  return (
    <section className="work-panel subject-batch-panel">
      <div className="analysis-head">
        <div>
          <p className="eyebrow">被试批量分析</p>
          <h3>同一被试的低 / 中 / 高密度 XDF 一起分析</h3>
        </div>
        <span className="status-pill compact">
          {selectedIds.length} 个已选{selectedIds.length ? ` · ${selectedCoverage.label}` : ""}
        </span>
      </div>
      <p className="muted">
        正式数据按 90 名被试 × 3 个密度条件组织。文件编号 001/002/003 归为第 1 名被试，004/005/006 归为第 2 名被试，以此类推；Signature1/2/3 分别对应低/中/高密度。报告会输出被试内密度表和主 planned contrast：中密度 - 低/高密度平均。
      </p>
      <div className="design-strip" aria-label="分析设计">
        <span>90 被试</span>
        <span>3 密度条件</span>
        <span>270 个 XDF</span>
        <span>组内因素：density</span>
        <span>主假设：中密度最高</span>
      </div>
      <div className="batch-controls">
        <label>
          被试编号
          <input
            value={subjectId}
            placeholder="例如 sub-P001"
            onChange={(event) => onSubjectIdChange(event.target.value)}
          />
        </label>
        <div className="top-actions">
          <button className="primary-button" disabled={jobLoading || selectedIds.length < 2} onClick={onRunSelected}>
            提交所选 XDF
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
                      {coverage.complete ? "密度完整" : `${group.documents.length}/3 XDF`}
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
            <p className="muted">还没有 XDF 文件。上传后会按文件编号三连组推断被试，并按 Signature 或编号位置推断低/中/高密度条件。</p>
          )}
        </div>
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

function mergeLiteratureEntriesIntoReview(review: SeedKnowledgeReview, entries: LiteratureKnowledgeEntry[]): SeedKnowledgeReview {
  const sourceSection = review.sections.find((section) => section.id === "sources");
  if (!sourceSection) return review;

  const seenTitles = new Set(sourceSection.items.map((item) => normalizeKnowledgeTitle(item.title)));
  const additionalItems: SeedKnowledgeReviewItem[] = [];
  for (const entry of entries) {
    const card = entry.card;
    if (!card || entry.seedMatch) continue;
    const title = card.title || stripLiteratureExtension(card.filename);
    const normalizedTitle = normalizeKnowledgeTitle(title);
    if (!normalizedTitle || seenTitles.has(normalizedTitle)) continue;
    seenTitles.add(normalizedTitle);
    const sourceCode = `S${String(sourceSection.items.length + additionalItems.length + 1).padStart(3, "0")}`;
    additionalItems.push({
      id: sourceCode,
      title,
      subtitle: card.citation || card.paperType || "文献卡",
      body: card.oneSentenceTakeaway || card.abstractZh || card.researchQuestion || "已生成结构化文献卡，可用于写作助手检索。",
      tags: (card.themeTags?.length ? card.themeTags : card.keywords).slice(0, 8),
      meta: [
        { label: "证据/方法", value: card.methods || card.eegOrMeasures || card.paperType || "-" },
        { label: "用于本研究", value: card.relevanceToMetroRescue.join("；") || card.usableForSections.join("；") },
        { label: "文件", value: card.filename },
      ],
      boundary: (card.doNotClaim?.length ? card.doNotClaim : card.limitations).join("；"),
    });
  }

  if (!additionalItems.length) return review;

  return {
    ...review,
    sections: review.sections.map((section) =>
      section.id === "sources"
        ? {
            ...section,
            items: [...section.items, ...additionalItems],
          }
        : section,
    ),
  };
}

function normalizeKnowledgeTitle(title: string) {
  return stripLiteratureExtension(title)
    .toLowerCase()
    .replace(/[_\-\s:：，,.;；。()（）[\]]+/g, " ")
    .trim();
}

function SeedKnowledgeReviewPanel({ entries, review }: { entries: LiteratureKnowledgeEntry[]; review: SeedKnowledgeReview | null }) {
  const [activeSectionId, setActiveSectionId] = useState("sources");
  const [query, setQuery] = useState("");
  const displayReview = useMemo(() => (review ? mergeLiteratureEntriesIntoReview(review, entries) : null), [entries, review]);

  const activeSection = displayReview?.sections.find((section) => section.id === activeSectionId) ?? displayReview?.sections[0] ?? null;
  const filteredItems = useMemo(() => {
    if (!activeSection) return [];

    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return activeSection.items;

    return activeSection.items.filter((item) =>
      [
        item.id,
        item.title,
        item.subtitle ?? "",
        item.body,
        item.boundary ?? "",
        item.tags.join(" "),
        item.meta.map((entry) => `${entry.label} ${entry.value}`).join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [activeSection, query]);

  if (!displayReview) {
    return (
      <section className="work-panel seed-review-panel">
        <p className="muted">正在读取文献知识库审阅数据。</p>
      </section>
    );
  }

  const totalItems = displayReview.sections.reduce((total, section) => total + section.items.length, 0);
  const sourceCount = displayReview.sections.find((section) => section.id === "sources")?.items.length ?? 0;
  const synthesisCount = Math.max(0, totalItems - sourceCount);
  const reviewFocusCount = knowledgeReviewNotes.length;

  return (
    <section className="work-panel seed-review-panel">
      <div className="analysis-head">
        <div>
          <p className="eyebrow">文献知识库</p>
          <h3>统一文献知识库</h3>
        </div>
        <span className="status-pill compact">{totalItems} 个条目</span>
      </div>

      <div className="seed-review-summary">
        <div>
          <span>文献卡</span>
          <strong>{sourceCount}</strong>
          <p>已整理成可检索、可审阅的文献入口。</p>
        </div>
        <div>
          <span>证据单元</span>
          <strong>{synthesisCount}</strong>
          <p>论点、机制、假设、风险、写作块和引用线索。</p>
        </div>
        <div>
          <span>审阅重点</span>
          <strong>{reviewFocusCount}</strong>
          <p>原文核对、命名统一、结果边界和证据来源。</p>
        </div>
      </div>

      <div className="review-note-list">
        {knowledgeReviewNotes.map((note) => (
          <p key={note}>{note}</p>
        ))}
      </div>

      <div className="seed-review-layout">
        <aside className="seed-section-list" aria-label="知识库分类">
          {displayReview.sections.map((section) => (
            <button
              className={`seed-section-button ${activeSection?.id === section.id ? "is-active" : ""}`}
              key={section.id}
              onClick={() => setActiveSectionId(section.id)}
              type="button"
            >
              <span>{section.label}</span>
              <strong>{section.items.length}</strong>
            </button>
          ))}
        </aside>

        <div className="seed-review-main">
          <div className="seed-review-controls">
            <div>
              <p className="eyebrow">{activeSection?.label}</p>
              <h3>{activeSection?.description}</h3>
            </div>
            <label className="search-field">
              检索当前分类
              <input
                type="search"
                value={query}
                placeholder="例如 EEG、density、S027、Methods"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>

          <div className="seed-review-list">
            {filteredItems.length ? (
              filteredItems.map((item) => (
                <article className="seed-review-item" key={`${activeSection?.id}-${item.id}`}>
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
                        <span key={`${item.id}-${tag}`}>{tag}</span>
                      ))}
                    </div>
                  ) : null}
                  {item.meta.length ? (
                    <dl className="seed-review-meta">
                      {getDisplaySeedMetaEntries(item.meta).map((entry) => (
                          <div key={`${item.id}-${entry.label}`}>
                            <dt>{entry.label}</dt>
                            <dd>
                              {entry.fullValue ? <SourceReferenceValue entry={entry} /> : entry.value}
                            </dd>
                          </div>
                        ))}
                    </dl>
                  ) : null}
                  {item.boundary ? <p className="seed-boundary">边界：{item.boundary}</p> : null}
                </article>
              ))
            ) : (
              <p className="muted">当前分类里没有匹配条目。</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
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
    return "全样本密度统计汇总";
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
  return level ? densityLabels[level] : "密度待标注";
}

function summarizeDensityCoverage(documents: ResearchDocument[]) {
  const levels = documents.map((document) => inferDensityLevelFromFilename(document.filename)).filter((level): level is DensityLevel => Boolean(level));
  const uniqueLevels = Array.from(new Set(levels)).sort((a, b) => densityLevels.indexOf(a) - densityLevels.indexOf(b));
  const label = uniqueLevels.length ? uniqueLevels.map((level) => densityLabels[level]).join(" / ") : "密度待标注";
  return {
    levels: uniqueLevels,
    label,
    complete: densityLevels.every((level) => uniqueLevels.includes(level)),
  };
}

function compareXdfConditionOrder(a: string, b: string) {
  return compareXdfConditionNames(a, b);
}
