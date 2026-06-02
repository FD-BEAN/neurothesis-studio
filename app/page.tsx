"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import {
  getSupabaseBrowserClient,
  hasSupabaseBrowserConfig,
  type ResearchAnalysisJob,
  type ResearchDocument,
} from "@/lib/supabase";
import type { SeedKnowledgeReview } from "@/lib/knowledgeBase";
import { isLiteratureDocument, parseLiteratureCard, type LiteratureKnowledgeCard } from "@/lib/literature";
import { metroAiPrompt, researchProject } from "@/lib/researchProject";

type UploadState = "idle" | "uploading" | "done" | "error";

type AiState = {
  status: "idle" | "loading" | "done" | "error";
  output: string;
};

type LiteratureKnowledgeEntry = {
  document: ResearchDocument;
  card: LiteratureKnowledgeCard | null;
};

type SeedKnowledgeStats = {
  sources: number;
  claims: number;
  mechanisms: number;
  hypotheses: number;
  analysisModels: number;
  dataTables: number;
  risksAndFixes: number;
  writingBlocks: number;
  quoteAnchors: number;
};

type LibraryFilter = "all" | "literature" | "raw-data" | "analysis" | "notes";
type JobViewFilter = "all" | "active" | "completed" | "failed" | "stale";
type DensityLevel = "low" | "medium" | "high";

type HtmlReportArtifact = {
  storagePath: string;
  filename?: string;
  sizeBytes?: number;
  generatedAt?: string;
};

const thesisKeywords = researchProject.keywords;

const workspaceModules = [
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
    extensions: ["svg", "png", "jpg", "jpeg", "md"],
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
    extensions: ["txt"],
  },
];

const libraryFilters: Array<{ id: LibraryFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "literature", label: "文献" },
  { id: "raw-data", label: "XDF/原始数据" },
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

const densityLevels: DensityLevel[] = ["low", "medium", "high"];
const densityLabels: Record<DensityLevel, string> = {
  low: "低密度",
  medium: "中密度",
  high: "高密度",
};

const writingAssistantPresets = [
  {
    label: "文献综述矩阵",
    prompt:
      "请基于内置知识库和新增文献卡片，整理一份面向 Introduction 的文献综述矩阵：按 VR/地铁撤离、导向标识与 wayfinding、EEG/认知负荷、密度/信息复杂度、统计方法 五类组织。每类给出可写入论文的中文要点、英文句子草稿、证据来源、不能过度声称的边界。",
  },
  {
    label: "理论逻辑",
    prompt:
      "请把本研究的理论逻辑写清楚：为什么低密度可能信息不足、高密度可能冗余或搜索成本高、中密度反而可能认知负荷最高。请区分文献支持、项目假设和需要实验验证的部分，并给出可写入 Introduction 的英文段落。",
  },
  {
    label: "Methods 草稿",
    prompt:
      "请基于当前项目理解，起草英文 Methods 小节：Participants/Design, VR task and signage-density manipulation, Unity markers and behavioral measures, EEG recording and XDF synchronization, preprocessing and feature extraction。要保守，不编造设备参数或样本完成情况。",
  },
  {
    label: "统计分析计划",
    prompt:
      "请写一份 Analysis Plan：说明 90 名被试 × 低/中/高密度的组内设计、主 planned contrast medium - mean(low, high)、EEG 与行为指标、subject-level contrast、mixed-effects model、组间变量需要的 metadata，以及多指标报告策略。",
  },
  {
    label: "结果写作模板",
    prompt:
      "请基于已完成的 XDF/全样本分析报告摘要，生成 Results 写作模板。如果没有足够结果，请只写占位结构和需要填入的统计量，不要编造显著性。包括中文解释和英文论文段落框架。",
  },
  {
    label: "Discussion 风险",
    prompt:
      "请整理 Discussion 可以讨论的机制、贡献、局限和替代解释，特别关注 VR 生态效度、EEG 指标解释、标识密度操控、组内/组间统计、样本量与多重比较。请列出哪些结论必须等真实结果支持。",
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
  const [researchNote, setResearchNote] = useState(
    metroAiPrompt,
  );
  const [aiState, setAiState] = useState<AiState>({ status: "idle", output: "" });
  const [analysisJobs, setAnalysisJobs] = useState<ResearchAnalysisJob[]>([]);
  const [jobMessage, setJobMessage] = useState("");
  const [jobLoading, setJobLoading] = useState(false);
  const [knowledgeEntries, setKnowledgeEntries] = useState<LiteratureKnowledgeEntry[]>([]);
  const [seedKnowledgeStats, setSeedKnowledgeStats] = useState<SeedKnowledgeStats | null>(null);
  const [seedKnowledgeReview, setSeedKnowledgeReview] = useState<SeedKnowledgeReview | null>(null);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeMessage, setKnowledgeMessage] = useState("");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("all");
  const [jobViewFilter, setJobViewFilter] = useState<JobViewFilter>("all");
  const [jobsLastLoadedAt, setJobsLastLoadedAt] = useState<string | null>(null);
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([]);
  const [batchSubjectId, setBatchSubjectId] = useState("");

  useEffect(() => {
    void loadDocuments();
    void loadAnalysisJobs();
    void loadKnowledgeBase();
    const intervalId = window.setInterval(() => {
      void loadAnalysisJobs();
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, []);

  const groupedDocuments = useMemo(
    () => {
      const query = libraryQuery.trim().toLowerCase();
      return documentCategories
        .filter((category) => category.id !== "materials")
        .map((category) => ({
          ...category,
          documents: documents.filter((document) => {
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
    [documents, libraryFilter, libraryQuery],
  );
  const selectedCategory = selectedDocument ? getDocumentCategory(selectedDocument) : null;
  const selectedDocumentIsLiterature = selectedDocument ? isLiteratureDocument(selectedDocument) : false;
  const totalStoredBytes = documents.reduce((total, document) => total + (document.size_bytes ?? 0), 0);
  const filteredDocumentCount = groupedDocuments.reduce((total, group) => total + group.documents.length, 0);
  const xdfDocuments = useMemo(() => documents.filter(isXdfDocument), [documents]);
  const selectedBatchDocuments = useMemo(
    () => xdfDocuments.filter((document) => selectedBatchIds.includes(document.id)),
    [selectedBatchIds, xdfDocuments],
  );
  const inferredSubjectGroups = useMemo(() => groupXdfDocumentsBySubject(xdfDocuments), [xdfDocuments]);
  const latestJobByDocumentId = useMemo(() => buildLatestJobByDocumentId(analysisJobs), [analysisJobs]);
  const xdfJobStats = useMemo(() => getXdfJobStats(analysisJobs), [analysisJobs]);
  const completedSubjectBatchCount = useMemo(() => countCompletedSubjectBatchJobs(analysisJobs), [analysisJobs]);
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
    setSelectedDocument((current) => current ?? nextDocuments[0] ?? null);
  }

  async function loadAnalysisJobs() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? session.access_token;

    const response = await fetch("/api/analysis/jobs", {
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
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) return;

    const payload = (await response.json()) as {
      cards?: LiteratureKnowledgeEntry[];
      seedStats?: SeedKnowledgeStats;
      seedReview?: SeedKnowledgeReview;
    };
    setKnowledgeEntries(payload.cards ?? []);
    setSeedKnowledgeStats(payload.seedStats ?? null);
    setSeedKnowledgeReview(payload.seedReview ?? null);
  }

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;

    setUploadState("uploading");
    setUploadMessage("");

    let uploaded = 0;
    for (const file of files) {
      const storagePath = buildStoragePath(user.id, file.name, getUploadCollection(file.name, file.type));
      const { error: uploadError } = await supabase.storage.from("research-files").upload(storagePath, file, {
        cacheControl: "3600",
        upsert: false,
      });

      if (uploadError) {
        setUploadState("error");
        setUploadMessage(`已上传 ${uploaded}/${files.length} 个文件；${file.name} 上传失败：${uploadError.message}`);
        event.target.value = "";
        await loadDocuments();
        return;
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
        setUploadState("error");
        setUploadMessage(`已上传 ${uploaded}/${files.length} 个文件；${file.name} 元数据保存失败：${insertError.message}`);
        event.target.value = "";
        await loadDocuments();
        return;
      }

      uploaded += 1;
    }

    setUploadState("done");
    setUploadMessage(`${uploaded} 个文件已上传到私有存储。文献、XDF 原始数据和分析产物会按类型分区显示。`);
    event.target.value = "";
    await loadDocuments();
    await loadKnowledgeBase();
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

    const payload = (await response.json()) as { card?: LiteratureKnowledgeCard; error?: string };
    if (!response.ok || !payload.card) {
      setKnowledgeMessage(payload.error ?? "文献知识卡片生成失败。");
      setKnowledgeLoading(false);
      return;
    }

    setKnowledgeMessage("文献知识卡片已更新，写作助手会优先引用知识库。");
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
          <a className="nav-item" href="#files">
            研究资料库
          </a>
          <a className="nav-item" href="#knowledge">
            知识库审阅
          </a>
          <a className="nav-item" href="#pipeline">
            数据分析与写作
          </a>
          <a className="nav-item" href="#ai">
            文献与写作助手
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
                  <dt>存储容量</dt>
                  <dd>{formatBytes(totalStoredBytes)}</dd>
                </div>
                <div>
                  <dt>当前选中文件</dt>
                  <dd>{selectedDocument?.filename ?? "尚未选择"}</dd>
                </div>
              </dl>
              <div className="keyword-row compact quiet">
                {thesisKeywords.map((keyword) => (
                  <span key={keyword}>{keyword}</span>
                ))}
              </div>
            </aside>
          </div>
        </section>

        <section className="view is-visible" id="files">
          <div className="section-head">
            <div>
              <p className="eyebrow">研究资料库</p>
              <h2>文件、XDF 分析任务与结果状态</h2>
            </div>
            <div className="top-actions">
              <button className="secondary-button" onClick={loadAnalysisJobs}>
                刷新状态
              </button>
              <label className="file-button">
                <input
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.csv,.tsv,.xlsx,.mat,.set,.edf,.txt,.md,.svg,.png,.jpg,.jpeg,.xdf,.json,.jsonl,.py,.m,.ipynb"
                  onChange={handleUpload}
                />
                {uploadState === "uploading" ? "上传中..." : "批量上传文件"}
              </label>
            </div>
          </div>

          {uploadMessage ? <p className={`notice ${uploadState}`}>{uploadMessage}</p> : null}

          <div className="library-status-grid">
            <StatusMetric label="总文件" value={documents.length} text={formatBytes(totalStoredBytes)} />
            <StatusMetric label="XDF 文件" value={xdfDocuments.length} text="EEG + Unity marker 原始数据" />
            <StatusMetric label="进行中" value={xdfJobStats.active} text="pending / queued / running" />
            <StatusMetric label="已完成" value={xdfJobStats.completed} text="可下载 HTML 报告" />
            <StatusMetric label="失败/需处理" value={xdfJobStats.failed + xdfJobStats.stale} text="失败或长时间未更新" tone="warn" />
          </div>

          <div className="manager-toolbar">
            <label className="search-field">
              文件检索
              <input
                type="search"
                value={libraryQuery}
                placeholder="按文件名、subject、run、扩展名搜索"
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
                      {group.documents.map((document) => (
                        <button
                          className={`document-item ${selectedDocument?.id === document.id ? "is-active" : ""}`}
                          key={document.id}
                          onClick={() => setSelectedDocument(document)}
                        >
                          <div className="document-item-main">
                            <strong>{document.filename}</strong>
                            <span>
                              {formatDocumentKind(document)} · {formatBytes(document.size_bytes)} ·{" "}
                              {new Date(document.created_at).toLocaleDateString("zh-CN")}
                            </span>
                          </div>
                          <DocumentStatusBadge
                            document={document}
                            job={latestJobByDocumentId.get(document.id) ?? null}
                            knowledgeCard={knowledgeEntries.find((entry) => entry.document.id === document.id)?.card ?? null}
                          />
                        </button>
                      ))}
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
                  <h3>{selectedDocument?.filename ?? "尚未选择文件"}</h3>
                </div>
                {selectedCategory ? <span className="category-badge">{selectedCategory.label}</span> : null}
              </div>
              <dl className="file-meta">
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
              <h2>内置文献知识库与新增论文卡片</h2>
            </div>
            <button className="secondary-button" onClick={loadKnowledgeBase}>
              刷新知识库
            </button>
          </div>
          <SeedKnowledgeReviewPanel review={seedKnowledgeReview} />
          <LiteratureKnowledgePanel entries={knowledgeEntries} seedStats={seedKnowledgeStats} onRefresh={loadKnowledgeBase} />
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
            </div>
          </div>
          {jobMessage ? <p className="notice">{jobMessage}</p> : null}
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
              <h2>文献整理、方法撰写与分析计划</h2>
            </div>
            <button className="primary-button" onClick={runAiAssistant} disabled={aiState.status === "loading"}>
              {aiState.status === "loading" ? "分析中..." : "运行 AI"}
            </button>
          </div>

          <div className="ai-grid">
            <section className="work-panel assistant-task-panel">
              <h3>写作任务</h3>
              <div className="prompt-preset-grid">
                {writingAssistantPresets.map((preset) => (
                  <button className="secondary-button" key={preset.label} type="button" onClick={() => setResearchNote(preset.prompt)}>
                    {preset.label}
                  </button>
                ))}
              </div>
              <label>
                给 AI 的任务
                <textarea value={researchNote} rows={10} onChange={(event) => setResearchNote(event.target.value)} />
              </label>
            </section>
            <section className="work-panel ai-output">
              <h3>输出</h3>
              <p className="muted">
                回答会结合项目设计、内置知识库、新增文献卡片和已完成分析报告；显著性结论只来自真实报告或你明确提供的数据。
              </p>
              <pre>{aiState.output || "运行后，这里会显示整理结果。"}</pre>
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
}: {
  document: ResearchDocument;
  job: ResearchAnalysisJob | null;
  knowledgeCard: LiteratureKnowledgeCard | null;
}) {
  if (isXdfDocument(document)) {
    if (!job) return <span className="state-chip muted-state">未提交</span>;
    return <span className={`state-chip ${getJobTone(job)}`}>{isStaleJob(job) ? "疑似卡住" : formatJobStatus(job.status)}</span>;
  }

  if (isLiteratureDocument(document)) {
    return <span className={`state-chip ${knowledgeCard ? "completed" : "muted-state"}`}>{knowledgeCard ? "已入库" : "未入库"}</span>;
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
  const deletableJobs = jobs.filter((job) => job.status === "completed" || job.status === "failed" || job.status === "configuration_required" || isStaleJob(job));

  return (
    <section className="work-panel queue-overview">
      <div className="analysis-head">
        <div>
          <p className="eyebrow">XDF 队列</p>
          <h3>{jobViewFilters.find((item) => item.id === filter)?.label ?? "任务"} · {jobs.length}</h3>
        </div>
        <div className="top-actions">
          <p className="muted compact-note">疑似卡住表示任务超过 10 分钟没有状态回写，通常需要查看 GitHub Actions 或重新提交。</p>
          <button className="secondary-button" disabled={!deletableJobs.length} onClick={() => onDeleteJobs(deletableJobs.map((job) => job.id))}>
            清理当前列表
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
      {jobs.length ? (
        <div className="queue-table">
          {jobs.map((job) => {
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
          })}
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
        正式数据按 90 名被试 × 3 个密度条件组织。每个被试建议一次提交低密度、中密度、高密度 3 个 XDF；报告会输出被试内密度表和主 planned contrast：中密度 - 低/高密度平均。
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
            <p className="muted">还没有 XDF 文件。上传后会按文件名中的 sub- 编号推断分组。</p>
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

function SeedKnowledgeReviewPanel({ review }: { review: SeedKnowledgeReview | null }) {
  const [activeSectionId, setActiveSectionId] = useState("sources");
  const [query, setQuery] = useState("");

  const activeSection = review?.sections.find((section) => section.id === activeSectionId) ?? review?.sections[0] ?? null;
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

  if (!review) {
    return (
      <section className="work-panel seed-review-panel">
        <p className="muted">正在读取内置知识库审阅数据。</p>
      </section>
    );
  }

  const totalItems = review.sections.reduce((total, section) => total + section.items.length, 0);

  return (
    <section className="work-panel seed-review-panel">
      <div className="analysis-head">
        <div>
          <p className="eyebrow">Seed KB</p>
          <h3>Metro Rescue 初始知识层</h3>
        </div>
        <span className="status-pill compact">{totalItems} 个条目</span>
      </div>

      <div className="seed-review-summary">
        <div>
          <span>版本</span>
          <strong>{review.version.replace("metro-rescue-kb-", "v")}</strong>
          <p>{review.generatedFrom}</p>
        </div>
        <div>
          <span>分类</span>
          <strong>{review.sections.length}</strong>
          <p>文献卡、claims、机制、假设、模型等</p>
        </div>
        <div>
          <span>审阅重点</span>
          <strong>3</strong>
          <p>全文边界、命名统一、结果边界</p>
        </div>
      </div>

      <div className="review-note-list">
        {[...review.integrityNotes, ...review.reviewNotes].map((note) => (
          <p key={note}>{note}</p>
        ))}
        <p>文献代码可以在“文献卡”分类中检索；claims、机制、假设、风险和引用锚点会同时显示“来源代码”和“来源文献”。</p>
      </div>

      <div className="seed-review-layout">
        <aside className="seed-section-list" aria-label="知识库分类">
          {review.sections.map((section) => (
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
                      {item.meta
                        .filter((entry) => entry.value)
                        .map((entry) => (
                          <div key={`${item.id}-${entry.label}`}>
                            <dt>{entry.label}</dt>
                            <dd>{entry.value}</dd>
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

function LiteratureKnowledgePanel({
  entries,
  seedStats,
  onRefresh,
}: {
  entries: LiteratureKnowledgeEntry[];
  seedStats: SeedKnowledgeStats | null;
  onRefresh: () => void;
}) {
  const indexed = entries.filter((entry) => entry.card);
  const pending = entries.length - indexed.length;

  return (
    <section className="work-panel knowledge-panel">
      <div className="analysis-head">
        <div>
          <p className="eyebrow">文献知识库</p>
          <h3>可引用论文卡片</h3>
        </div>
        <div className="top-actions">
          <span className="status-pill compact">{indexed.length} 篇已入库</span>
          <button className="secondary-button" onClick={onRefresh}>
            刷新
          </button>
        </div>
      </div>
      {seedStats ? (
        <p className="muted">
          系统已接入 Metro Rescue 初始知识库：{seedStats.sources} 篇文献卡、{seedStats.claims} 条 claims、{seedStats.hypotheses} 个假设、
          {seedStats.analysisModels} 个分析模型。新上传论文生成知识卡片后，会作为增量文献加入写作助手。
        </p>
      ) : null}
      {pending ? <p className="muted">{pending} 篇文献还没有知识卡片。请在资料库中选中文献后点击“生成/更新知识卡片”。</p> : null}
      {indexed.length ? (
        <div className="knowledge-grid">
          {indexed.map(({ document, card }) =>
            card ? (
              <article className="knowledge-card" key={document.id}>
                <span>{card.sourceGrade ? `Grade ${card.sourceGrade}` : card.evidenceLevel || "文献证据"}</span>
                <h4>{card.title || document.filename}</h4>
                <p>{card.oneSentenceTakeaway || card.researchQuestion}</p>
                <div className="keyword-row compact quiet">
                  {(card.themeTags?.length ? card.themeTags : card.keywords).slice(0, 6).map((keyword) => (
                    <span key={`${document.id}-${keyword}`}>{keyword}</span>
                  ))}
                </div>
                <dl>
                  <div>
                    <dt>方法</dt>
                    <dd>{card.methods}</dd>
                  </div>
                  <div>
                    <dt>可用于</dt>
                    <dd>{card.usableForSections.join(" / ")}</dd>
                  </div>
                  {card.densityHypothesisRelevance?.length ? (
                    <div>
                      <dt>密度假设</dt>
                      <dd>{card.densityHypothesisRelevance.slice(0, 2).join("；")}</dd>
                    </div>
                  ) : null}
                  {card.keyFindings?.length ? (
                    <div>
                      <dt>主要发现</dt>
                      <dd>{card.keyFindings.slice(0, 2).join("；")}</dd>
                    </div>
                  ) : null}
                  {card.doNotClaim?.length ? (
                    <div>
                      <dt>边界</dt>
                      <dd>{card.doNotClaim.slice(0, 2).join("；")}</dd>
                    </div>
                  ) : null}
                </dl>
              </article>
            ) : null,
          )}
        </div>
      ) : (
        <p className="muted">还没有新增文献卡片。写作助手已经可以使用初始知识库；以后上传新论文后，再在文献区生成知识卡片作为增量补充。</p>
      )}
    </section>
  );
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

function getUploadCollection(filename: string, mimeType: string) {
  const extension = getDocumentExtension(filename);
  if (["pdf", "doc", "docx"].includes(extension) || mimeType.includes("pdf")) return "literature";
  if (["xdf", "edf", "set", "mat"].includes(extension)) return "xdf-raw";
  if (["py", "m", "ipynb", "csv", "tsv", "xlsx", "json", "jsonl"].includes(extension)) return "analysis-products";
  return "documents";
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
    return "超过 10 分钟没有状态回写。可能是 GitHub Actions 失败、Secret 不匹配，或 worker 启动前报错；建议查看 GitHub Actions 后重新提交。";
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
  const bidsMatch = filename.match(/sub-([A-Za-z0-9]+)/i);
  if (bidsMatch?.[1]) return `sub-${bidsMatch[1]}`;
  const subjectMatch = filename.match(/(?:subject|subj|participant|p)[-_]?([A-Za-z0-9]+)/i);
  if (subjectMatch?.[1]) return `sub-${subjectMatch[1]}`;
  return "subject-unknown";
}

function inferRunLabelFromFilename(filename: string) {
  const runMatch = filename.match(/run-([A-Za-z0-9]+)/i);
  if (runMatch?.[1]) return `run-${runMatch[1]}`;
  const signatureMatch = filename.match(/signature[-_]?([A-Za-z0-9]+)/i);
  if (signatureMatch?.[1]) return `signature-${signatureMatch[1]}`;
  return formatDocumentKind({ filename });
}

function inferDensityLevelFromFilename(filename: string): DensityLevel | null {
  const normalized = filename.toLowerCase().replace(/_/g, "-");
  if (/中等?密度|中密度|medium[-\s_]?density|density[-\s_]?medium|density[-\s_]?mid|condition[-\s_]?medium|level[-\s_]?2/.test(normalized)) {
    return "medium";
  }
  if (/低密度|low[-\s_]?density|density[-\s_]?low|condition[-\s_]?low|level[-\s_]?1/.test(normalized)) {
    return "low";
  }
  if (/高密度|high[-\s_]?density|density[-\s_]?high|condition[-\s_]?high|level[-\s_]?3/.test(normalized)) {
    return "high";
  }

  const tokens = new Set(normalized.match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) ?? []);
  if (["medium", "mid", "med", "middle", "中", "中等"].some((token) => tokens.has(token))) return "medium";
  if (["low", "lo", "sparse", "light", "低"].some((token) => tokens.has(token))) return "low";
  if (["high", "hi", "dense", "heavy", "高"].some((token) => tokens.has(token))) return "high";
  return null;
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
  const densityA = inferDensityLevelFromFilename(a);
  const densityB = inferDensityLevelFromFilename(b);
  const densityIndexA = densityA ? densityLevels.indexOf(densityA) : densityLevels.length;
  const densityIndexB = densityB ? densityLevels.indexOf(densityB) : densityLevels.length;
  if (densityIndexA !== densityIndexB) return densityIndexA - densityIndexB;
  return inferRunLabelFromFilename(a).localeCompare(inferRunLabelFromFilename(b));
}
