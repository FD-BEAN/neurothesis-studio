"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import {
  getSupabaseBrowserClient,
  hasSupabaseBrowserConfig,
  type ResearchAnalysisJob,
  type ResearchDocument,
} from "@/lib/supabase";
import { isLiteratureDocument, parseLiteratureCard, type LiteratureKnowledgeCard } from "@/lib/literature";
import { metroAiPrompt, researchProject } from "@/lib/researchProject";

type UploadState = "idle" | "uploading" | "done" | "error";

type AiState = {
  status: "idle" | "loading" | "done" | "error";
  output: string;
};

type AnalysisState = {
  status: "idle" | "loading" | "done" | "error";
  report: DataAnalysisReport | null;
  error: string;
};

type LiteratureKnowledgeEntry = {
  document: ResearchDocument;
  card: LiteratureKnowledgeCard | null;
};

type LibraryFilter = "all" | "literature" | "raw-data" | "analysis" | "notes";
type JobViewFilter = "all" | "active" | "completed" | "failed" | "stale";

type DataAnalysisReport = {
  title: string;
  kind: string;
  summary: string;
  metrics: Array<{ label: string; value: string; text?: string }>;
  charts: Array<
    | {
        type: "bar";
        title: string;
        xLabel: string;
        yLabel: string;
        data: Array<{ label: string; value: number }>;
      }
    | {
        type: "scatter";
        title: string;
        xLabel: string;
        yLabel: string;
        data: Array<{ label: string; x: number; y: number; group?: string }>;
      }
  >;
  tables: Array<{ title: string; columns: string[]; rows: string[][] }>;
  notes: string[];
};

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
    href: "#blueprint",
    title: "实验设计",
    text: "3×3×2 条件、marker 逻辑、行为数据和 EEG 同步关系。",
  },
  {
    href: "#ai",
    title: "文献与写作助手",
    text: "基于已入库论文知识卡片生成文献矩阵、Methods 草稿和分析计划。",
  },
  {
    href: "#pipeline",
    title: "数据分析与论文写作",
    text: "XDF 质量检查、行为数据、EEG 预处理和英文论文段落。",
  },
];

const analysisModules = [
  { title: "XDF 同步质控", text: "检查 Mitsar EEG 与 MetroRescueMarkers，确认 map_start 到 evacuation_complete 的覆盖关系。" },
  { title: "事件与行为指标", text: "基于 Unity marker 提取 sign_readable、decision_point_enter、停留、扫描、回退和完成时长。" },
  { title: "EEG 特征提取", text: "围绕 sign_readable 与 decision_point_enter 建立事件窗，提取 theta、alpha 和 theta/alpha 指标。" },
  { title: "统计建模", text: "汇总 trial_features 与 event_features，用 mixed-effects model 检验 Signature、Metro 与 Audio 条件。" },
  { title: "写作材料", text: "保存 Methods、Results、图表说明和中英双语论文草稿，所有结论回到真实分析输出。" },
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
          当前未连接 Supabase，因此只展示研究项目蓝图。配置 `.env.local` 后会启用登录、私有文件上传和后端 AI。
        </p>
      </section>

      <section className="view is-visible">
        <ProjectBlueprint />
      </section>

      <section className="view is-visible">
        <MaterialsPanel />
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
  const [analysisState, setAnalysisState] = useState<AnalysisState>({
    status: "idle",
    report: null,
    error: "",
  });
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

  useEffect(() => {
    void loadDocuments();
    void loadAnalysisJobs();
    void loadKnowledgeBase();
    const intervalId = window.setInterval(() => {
      void loadAnalysisJobs();
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    setAnalysisState({ status: "idle", report: null, error: "" });
  }, [selectedDocument?.id]);

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
  const selectedDocumentIsXdf = selectedDocument ? isXdfDocument(selectedDocument) : false;
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
  const selectedDocumentJobs = useMemo(
    () =>
      selectedDocument
        ? analysisJobs
            .filter((job) => getJobDocumentIds(job).includes(selectedDocument.id))
            .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
        : [],
    [analysisJobs, selectedDocument],
  );
  const xdfJobStats = useMemo(() => getXdfJobStats(analysisJobs), [analysisJobs]);
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

    const payload = (await response.json()) as { cards?: LiteratureKnowledgeEntry[] };
    setKnowledgeEntries(payload.cards ?? []);
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

  async function runDataAnalysis() {
    if (!selectedDocument) {
      setAnalysisState({ status: "error", report: null, error: "请先在研究资料库中选择一个文件。" });
      return;
    }

    setAnalysisState({ status: "loading", report: null, error: "" });

    const response = await fetch("/api/data/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        documentId: selectedDocument.id,
      }),
    });

    const payload = (await response.json()) as { report?: DataAnalysisReport; error?: string };

    if (!response.ok || !payload.report) {
      setAnalysisState({ status: "error", report: null, error: payload.error ?? "数据分析失败。" });
      return;
    }

    setAnalysisState({ status: "done", report: payload.report, error: "" });
  }

  async function runPrimaryDocumentAction() {
    if (selectedDocumentIsLiterature) {
      await buildLiteratureKnowledgeCard();
      return;
    }

    await runDataAnalysis();
  }

  async function runAdvancedAnalysis() {
    if (!selectedDocument) {
      setJobMessage("请先在研究资料库中选择一个文件。");
      return;
    }

    if (!selectedDocumentIsXdf) {
      setJobMessage("XDF 高级分析只处理 LabRecorder .xdf，也就是 EEG stream + Unity marker stream。PDF、CSV、SVG 和研究说明请使用即时摘要或 AI 助手。");
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
        documentId: selectedDocument.id,
        analysisType: "advanced_python",
      }),
    });

    const payload = (await response.json()) as { job?: ResearchAnalysisJob; error?: string; warning?: string };

    if (!response.ok && !payload.job) {
      setJobMessage(payload.error ?? "XDF 高级分析任务创建失败。");
      setJobLoading(false);
      return;
    }

    setJobMessage(payload.warning ?? "XDF 高级分析任务已提交。");
    await loadAnalysisJobs();
    setJobLoading(false);
  }

  async function runSubjectBatchAnalysis(documentIds = selectedBatchIds, subjectId = batchSubjectId) {
    const uniqueDocumentIds = Array.from(new Set(documentIds));
    if (uniqueDocumentIds.length < 2) {
      setJobMessage("被试批量分析至少需要选择 2 个 XDF；正式数据建议同一被试 3 个 run 一起提交。");
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

    setJobMessage(payload.warning ?? `已提交 ${uniqueDocumentIds.length} 个 XDF 的被试批量分析任务。`);
    await loadAnalysisJobs();
    setJobLoading(false);
  }

  async function queueAllXdfAnalyses() {
    if (!xdfDocuments.length) {
      setJobMessage("当前还没有 XDF 文件。请先批量上传 LabRecorder .xdf。");
      return;
    }

    setJobLoading(true);
    setJobMessage(`正在提交 ${xdfDocuments.length} 个 XDF 分析任务...`);

    let submitted = 0;
    for (const document of xdfDocuments) {
      const response = await fetch("/api/analysis/jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          documentId: document.id,
          analysisType: "advanced_python",
        }),
      });
      if (response.ok) submitted += 1;
    }

    setJobMessage(`已提交 ${submitted}/${xdfDocuments.length} 个 XDF 分析任务。`);
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
          <a className="nav-item" href="#blueprint">
            实验设计
          </a>
          <a className="nav-item" href="#ai">
            文献与写作助手
          </a>
          <a className="nav-item" href="#pipeline">
            数据分析与写作
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
                按文献知识库、实验设计、XDF 原始数据、分析结果和写作材料分区管理，用于检索、分析和论文写作引用。
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
                <div>
                  <dt>实验结构</dt>
                  <dd>{researchProject.design.totalConditions} 个条件</dd>
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
            <div className="segmented-control" aria-label="任务状态筛选">
              {jobViewFilters.map((filter) => (
                <button
                  className={jobViewFilter === filter.id ? "is-active" : ""}
                  key={filter.id}
                  onClick={() => setJobViewFilter(filter.id)}
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
              <button
                className="primary-button"
                disabled={!selectedDocument || (selectedDocumentIsLiterature ? knowledgeLoading : analysisState.status === "loading")}
                onClick={runPrimaryDocumentAction}
              >
                {selectedDocumentIsLiterature
                  ? knowledgeLoading
                    ? "生成知识卡片中..."
                    : "生成/更新知识卡片"
                  : analysisState.status === "loading"
                    ? "生成中..."
                    : selectedDocumentIsXdf
                      ? "查看即时 XDF 摘要"
                      : "生成摘要"}
              </button>
              {selectedDocumentIsXdf ? (
                <button className="secondary-button" disabled={jobLoading} onClick={runAdvancedAnalysis}>
                  {jobLoading ? "提交中..." : "运行 XDF 高级分析"}
                </button>
              ) : null}
              {knowledgeMessage ? <p className="muted">{knowledgeMessage}</p> : null}
              <SelectedDocumentJobs
                jobs={selectedDocumentJobs}
                selectedDocument={selectedDocument}
                onDownloadReport={downloadJobHtmlReport}
              />
            </section>
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
            onDeleteJobs={deleteAnalysisJobs}
            onDownloadReport={downloadJobHtmlReport}
          />
        </section>

        <section className="view is-visible" id="blueprint">
          <ProjectBlueprint />
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
            <label>
              给 AI 的任务
              <textarea value={researchNote} rows={8} onChange={(event) => setResearchNote(event.target.value)} />
            </label>
            <section className="work-panel ai-output">
              <h3>输出</h3>
              <p className="muted">
                适合让它整理文献矩阵、Methods 草稿、图注、marker 说明和分析计划。不要让它替真实结果下结论。
              </p>
              <pre>{aiState.output || "运行后，这里会显示整理结果。"}</pre>
            </section>
          </div>
          <LiteratureKnowledgePanel entries={knowledgeEntries} onRefresh={loadKnowledgeBase} />
        </section>

        <section className="view is-visible" id="pipeline">
          <div className="section-head">
            <div>
              <p className="eyebrow">数据分析与论文写作</p>
              <h2>分析产物与写作材料</h2>
            </div>
            <div className="top-actions">
              <button className="secondary-button" onClick={loadAnalysisJobs}>
                刷新任务
              </button>
              <button className="secondary-button" disabled={jobLoading} onClick={queueAllXdfAnalyses}>
                批量提交 XDF
              </button>
              <button className="secondary-button" disabled={!selectedDocumentIsXdf || jobLoading} onClick={runAdvancedAnalysis}>
                {jobLoading ? "提交中..." : "XDF 高级分析"}
              </button>
              <button className="primary-button" disabled={!selectedDocument || analysisState.status === "loading"} onClick={runDataAnalysis}>
                {analysisState.status === "loading" ? "分析中..." : "即时摘要"}
              </button>
            </div>
          </div>
          {jobMessage ? <p className="notice">{jobMessage}</p> : null}
          <div className="workflow-list">
            {analysisModules.map((module) => (
              <PipelineCard key={module.title} title={module.title} text={module.text} />
            ))}
          </div>
          <AnalysisJobsPanel
            jobs={analysisJobs}
            onDownloadReport={downloadJobHtmlReport}
          />
          <AnalysisResultPanel state={analysisState} selectedDocument={selectedDocument} />
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

function SelectedDocumentJobs({
  jobs,
  selectedDocument,
  onDownloadReport,
}: {
  jobs: ResearchAnalysisJob[];
  selectedDocument: ResearchDocument | null;
  onDownloadReport: (job: ResearchAnalysisJob) => void;
}) {
  if (!selectedDocument || !isXdfDocument(selectedDocument)) return null;

  return (
    <section className="selected-job-panel">
      <div className="panel-title-row">
        <div>
          <p className="eyebrow">当前文件任务</p>
          <h4>XDF 分析状态</h4>
        </div>
        <span className="status-pill compact">{jobs.length} 次提交</span>
      </div>
      {jobs.length ? (
        <div className="compact-job-list">
          {jobs.slice(0, 4).map((job) => {
            const reportArtifact = getJobHtmlReport(job);
            return (
              <article className="compact-job" key={job.id}>
                <div className="compact-job-head">
                  <span className={`state-chip ${getJobTone(job)}`}>{isStaleJob(job) ? "疑似卡住" : formatJobStatus(job.status)}</span>
                  <small>{new Date(job.created_at).toLocaleString("zh-CN")}</small>
                </div>
                <ProgressBar value={getJobProgress(job)} tone={getJobTone(job)} />
                <p>{getJobMessage(job)}</p>
                <div className="job-actions inline">
                  {job.github_run_url ? (
                    <a className="secondary-link" href={job.github_run_url} target="_blank" rel="noreferrer">
                      GitHub Run
                    </a>
                  ) : null}
                  <button className="secondary-button" disabled={!reportArtifact} onClick={() => onDownloadReport(job)}>
                    {reportArtifact ? "下载 HTML" : job.status === "completed" ? "需重新生成" : "等待报告"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="muted">这个 XDF 还没有提交高级分析。提交后会在这里显示排队、运行、完成或失败状态。</p>
      )}
    </section>
  );
}

function AnalysisQueueOverview({
  jobs,
  filter,
  onDeleteJobs,
  onDownloadReport,
}: {
  jobs: ResearchAnalysisJob[];
  filter: JobViewFilter;
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
  return (
    <section className="work-panel subject-batch-panel">
      <div className="analysis-head">
        <div>
          <p className="eyebrow">被试批量分析</p>
          <h3>同一被试的多个 XDF 一起分析</h3>
        </div>
        <span className="status-pill compact">{selectedIds.length} 个已选</span>
      </div>
      <p className="muted">
        正式实验建议每名被试 3 个 run 一起提交。系统会先逐 run 做 EEG + Unity marker QC，再汇总成被试内 run 表，供后续组内/组间 mixed-effects model 使用。
      </p>
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
                <small>{formatBytes(document.size_bytes)} · {inferSubjectIdFromFilename(document.filename)}</small>
              </span>
            </label>
          ))}
        </div>
        <div className="subject-group-list">
          <strong>按文件名推断的被试组</strong>
          {groups.length ? (
            groups.map((group) => (
              <article className="subject-group-card" key={group.subjectId}>
                <div>
                  <span className={group.documents.length === 3 ? "state-chip completed" : "state-chip warning"}>
                    {group.documents.length} 个 XDF
                  </span>
                  <h4>{group.subjectId}</h4>
                  <p>{group.documents.map((document) => inferRunLabelFromFilename(document.filename)).join(" / ")}</p>
                </div>
                <button className="secondary-button" disabled={jobLoading || group.documents.length < 2} onClick={() => onRunGroup(group)}>
                  分析此被试
                </button>
              </article>
            ))
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

function ProjectBlueprint() {
  return (
    <div className="blueprint-stack">
      <div className="section-head">
        <div>
          <p className="eyebrow">实验设计</p>
          <h2>Metro Rescue 的条件、marker 与同步关系</h2>
        </div>
      </div>

      <div className="condition-grid">
        <Metric label="地图布局" value={researchProject.design.maps.length} text={researchProject.design.maps.join(" / ")} />
        <Metric label="标识方案" value={researchProject.design.signatures.length} text={researchProject.design.signatures.join(" / ")} />
        <Metric label="音频条件" value={researchProject.design.audio.length} text={researchProject.design.audio.join(" / ")} />
        <Metric label="场景图" value={researchProject.planFiles.length} text="3 个地图布局 × 3 种标识方案，并标注导向标识可读范围。" />
      </div>

      <div className="dashboard-grid">
        {researchProject.markerGroups.map((group) => (
          <article className="work-panel" key={group.title}>
            <h3>{group.title}</h3>
            <p className="muted">{group.detail}</p>
            <div className="keyword-row compact">
              {group.items.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </article>
        ))}
      </div>

      <div className="alert-grid">
        {researchProject.qualityAlerts.map((alert) => (
          <article className="quality-alert" key={alert.title}>
            <strong>{alert.title}</strong>
            <p>{alert.detail}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function MaterialsPanel() {
  return (
    <div className="blueprint-stack">
      <div className="section-head">
        <div>
          <p className="eyebrow">场景与标识配置</p>
          <h2>场景平面图与导向标识配置</h2>
        </div>
        <span className="status-pill">可读范围 8 m / 12 m</span>
      </div>

      <div className="materials-grid">
        {researchProject.planFiles.map((item) => (
          <article className="material-card" key={item.file}>
            <span>
              {item.map} / {item.signature}
            </span>
            <strong>{item.file}</strong>
            <p>{item.signs} 个导向标识点；与条件表、图注和坐标表保持对应。</p>
          </article>
        ))}
      </div>

      <section className="work-panel">
        <h3>图表与图注建议</h3>
        <div className="figure-list">
          {researchProject.figures.map((figure) => (
            <article key={figure.id}>
              <span>{figure.id}</span>
              <strong>{figure.title}</strong>
              <p>{figure.use}</p>
              <p className="muted">{figure.caption}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, text }: { label: string; value: number | string; text: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{text}</p>
    </article>
  );
}

function PipelineCard({ title, text }: { title: string; text: string }) {
  return (
    <article className="work-panel">
      <h3>{title}</h3>
      <p className="muted">{text}</p>
    </article>
  );
}

function AnalysisResultPanel({
  state,
  selectedDocument,
}: {
  state: AnalysisState;
  selectedDocument: ResearchDocument | null;
}) {
  if (state.status === "idle") {
    return (
      <section className="work-panel analysis-panel">
        <p className="eyebrow">当前文件分析</p>
        <h3>{selectedDocument ? selectedDocument.filename : "尚未选择文件"}</h3>
        <p className="muted">
          即时摘要用于资料索引和快速检查；正式的实验数据分析请在资料库中选择 LabRecorder .xdf 文件，并运行 XDF 高级分析来对齐 EEG stream 与 Unity marker stream。
        </p>
      </section>
    );
  }

  if (state.status === "loading") {
    return (
      <section className="work-panel analysis-panel">
        <p className="eyebrow">当前文件分析</p>
        <h3>正在分析...</h3>
        <p className="muted">后台正在读取私有文件并生成摘要。</p>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="work-panel analysis-panel">
        <p className="eyebrow">当前文件分析</p>
        <h3>分析失败</h3>
        <p className="auth-error">{state.error}</p>
      </section>
    );
  }

  const report = state.report;
  if (!report) return null;

  return (
    <section className="work-panel analysis-panel">
      <div className="analysis-head">
        <div>
          <p className="eyebrow">{report.kind}</p>
          <h3>{report.title}</h3>
        </div>
        <span className="status-pill compact">后台分析结果</span>
      </div>
      <p className="summary-text compact-text">{report.summary}</p>

      <div className="analysis-metric-grid">
        {report.metrics.map((metric) => (
          <article className="analysis-metric" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            {metric.text ? <p>{metric.text}</p> : null}
          </article>
        ))}
      </div>

      {report.charts.length ? (
        <div className="analysis-chart-grid">
          {report.charts.map((chart, index) =>
            chart.type === "bar" ? <BarChart chart={chart} key={`${chart.title}-${index}`} /> : <ScatterChart chart={chart} key={`${chart.title}-${index}`} />,
          )}
        </div>
      ) : null}

      {report.tables.map((table) => (
        <AnalysisTable table={table} key={table.title} />
      ))}

      {report.notes.length ? (
        <div className="analysis-notes">
          <strong>分析说明</strong>
          {report.notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AnalysisJobsPanel({
  jobs,
  onDownloadReport,
}: {
  jobs: ResearchAnalysisJob[];
  onDownloadReport: (job: ResearchAnalysisJob) => void;
}) {
  const xdfJobs = jobs.filter(isXdfAnalysisJob);
  const hiddenLegacyJobs = jobs.length - xdfJobs.length;

  return (
    <section className="work-panel analysis-jobs-panel">
      <div className="analysis-head">
        <div>
          <p className="eyebrow">XDF 高级分析</p>
          <h3>后台任务</h3>
        </div>
        <span className="status-pill compact">{xdfJobs.length} 个任务</span>
      </div>
      {hiddenLegacyJobs ? (
        <p className="muted">
          已隐藏 {hiddenLegacyJobs} 个旧的非 XDF 后台任务。XDF 高级分析只显示 LabRecorder .xdf 的 EEG + Unity marker 分析任务。
        </p>
      ) : null}
      {xdfJobs.length ? (
        <div className="job-list">
          {xdfJobs.map((job) => {
            const reportArtifact = getJobHtmlReport(job);

            return (
              <article className="job-item" key={job.id}>
                <div>
                  <strong>{getJobDisplayTitle(job)}</strong>
                  <span>
                    {formatJobStatus(job.status)} · {new Date(job.created_at).toLocaleString("zh-CN")}
                  </span>
                  <p>{job.status_message || job.error_message || "等待 worker 更新任务状态。"}</p>
                </div>
                <div className="job-actions">
                  {job.github_run_url ? (
                    <a className="secondary-link" href={job.github_run_url} target="_blank" rel="noreferrer">
                      GitHub Run
                    </a>
                  ) : null}
                  <button className="secondary-button" disabled={!reportArtifact} onClick={() => onDownloadReport(job)}>
                    {reportArtifact ? "下载 HTML" : job.status === "completed" ? "需重新生成" : "等待报告"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="muted">还没有 XDF 高级分析任务。选择 LabRecorder .xdf 文件后，可以提交到 GitHub Actions Python worker。</p>
      )}
    </section>
  );
}

function LiteratureKnowledgePanel({
  entries,
  onRefresh,
}: {
  entries: LiteratureKnowledgeEntry[];
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
      {pending ? <p className="muted">{pending} 篇文献还没有知识卡片。请在资料库中选中文献后点击“生成/更新知识卡片”。</p> : null}
      {indexed.length ? (
        <div className="knowledge-grid">
          {indexed.map(({ document, card }) =>
            card ? (
              <article className="knowledge-card" key={document.id}>
                <span>{card.evidenceLevel || "文献证据"}</span>
                <h4>{card.title || document.filename}</h4>
                <p>{card.researchQuestion}</p>
                <div className="keyword-row compact quiet">
                  {card.keywords.slice(0, 6).map((keyword) => (
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
                </dl>
              </article>
            ) : null,
          )}
        </div>
      ) : (
        <p className="muted">还没有文献知识卡片。上传论文后，先在文献区生成知识卡片，再让写作助手基于知识库回答。</p>
      )}
    </section>
  );
}

function BarChart({
  chart,
}: {
  chart: Extract<DataAnalysisReport["charts"][number], { type: "bar" }>;
}) {
  const maxValue = Math.max(1, ...chart.data.map((item) => item.value));

  return (
    <article className="chart-card">
      <h4>{chart.title}</h4>
      <div className="bar-chart" aria-label={`${chart.xLabel} by ${chart.yLabel}`}>
        {chart.data.map((item) => (
          <div className="bar-row" key={item.label}>
            <span>{item.label}</span>
            <div>
              <i style={{ width: `${Math.max(3, (item.value / maxValue) * 100)}%` }} />
            </div>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </article>
  );
}

function ScatterChart({
  chart,
}: {
  chart: Extract<DataAnalysisReport["charts"][number], { type: "scatter" }>;
}) {
  const xValues = chart.data.map((item) => item.x);
  const yValues = chart.data.map((item) => item.y);
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);

  function normalize(value: number, min: number, max: number) {
    if (max === min) return 50;
    return ((value - min) / (max - min)) * 84 + 8;
  }

  return (
    <article className="chart-card">
      <h4>{chart.title}</h4>
      <div className="scatter-plot" aria-label={`${chart.xLabel} and ${chart.yLabel} scatter plot`}>
        {chart.data.map((item, index) => (
          <span
            className="scatter-dot"
            key={`${item.label}-${index}`}
            title={`${item.label}: ${chart.xLabel}=${item.x}, ${chart.yLabel}=${item.y}`}
            style={{
              left: `${normalize(item.x, minX, maxX)}%`,
              bottom: `${normalize(item.y, minY, maxY)}%`,
            }}
          />
        ))}
      </div>
      <p className="muted chart-caption">
        {chart.xLabel}: {formatCompactNumber(minX)} 到 {formatCompactNumber(maxX)}；{chart.yLabel}:{" "}
        {formatCompactNumber(minY)} 到 {formatCompactNumber(maxY)}
      </p>
    </article>
  );
}

function AnalysisTable({ table }: { table: DataAnalysisReport["tables"][number] }) {
  return (
    <div className="analysis-table-wrap">
      <h4>{table.title}</h4>
      <table className="analysis-table">
        <thead>
          <tr>
            {table.columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={`${table.title}-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <td key={`${table.title}-${rowIndex}-${cellIndex}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

function formatCompactNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function isDataAnalysisReport(value: unknown): value is DataAnalysisReport {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DataAnalysisReport>;
  return Boolean(candidate.title && candidate.kind && candidate.summary && Array.isArray(candidate.metrics));
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
        subjectId?: string;
        sourceDocumentIds?: string[];
      }
    | null
    | undefined;
  const batch = result?.batch;

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
      documents: groupDocuments.sort((a, b) => inferRunLabelFromFilename(a.filename).localeCompare(inferRunLabelFromFilename(b.filename))),
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
