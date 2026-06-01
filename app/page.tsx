"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient, hasSupabaseBrowserConfig, type ResearchDocument } from "@/lib/supabase";
import { metroAiPrompt, researchProject } from "@/lib/researchProject";

type UploadState = "idle" | "uploading" | "done" | "error";

type AiState = {
  status: "idle" | "loading" | "done" | "error";
  output: string;
};

const thesisKeywords = researchProject.keywords;

const workspaceModules = [
  {
    href: "#files",
    title: "研究资料库",
    text: "文献、实验配置、原始数据、分析脚本和写作材料。",
  },
  {
    href: "#blueprint",
    title: "实验设计",
    text: "3×3×2 条件、marker 逻辑、行为数据和 EEG 同步关系。",
  },
  {
    href: "#materials",
    title: "场景与标识配置",
    text: "L1 平面图、导向标识位置、可读范围和图注口径。",
  },
  {
    href: "#ai",
    title: "文献与写作助手",
    text: "文献摘要、双语矩阵、Methods 草稿和分析计划。",
  },
  {
    href: "#pipeline",
    title: "数据分析与论文写作",
    text: "XDF 质量检查、行为数据、EEG 预处理和英文论文段落。",
  },
];

const analysisModules = [
  { title: "XDF 质量检查", text: "检查 Mitsar EEG 与 MetroRescueMarkers，切分有效 session，并标注缺失开始/结束 marker 的文件。" },
  { title: "文献矩阵", text: "按 wayfinding、VR evacuation、EEG cognitive load 整理研究问题、方法和指标。" },
  { title: "行为数据", text: "整理 Unity 路径、停留、回退、决策点扫描和任务完成情况。" },
  { title: "EEG 预处理", text: "保留 MNE-Python 和 EEGLAB 的脚本入口，用于事件锁定和认知负荷分析。" },
  { title: "论文段落", text: "为 Introduction、Methods、Results 和 Discussion 保存中英双语草稿。" },
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
    label: "场景与标识材料",
    description: "VR 场景平面图、导向标识方案、图注和实验说明。",
    extensions: ["svg", "png", "jpg", "jpeg", "md"],
  },
  {
    id: "raw-data",
    label: "原始数据",
    description: "Unity 日志、LSL marker、EEG 文件和行为数据表。",
    extensions: ["xdf", "edf", "set", "mat", "csv", "xlsx", "jsonl", "json"],
  },
  {
    id: "analysis",
    label: "分析脚本与输出",
    description: "Python、MATLAB、notebook、统计表和中间结果。",
    extensions: ["py", "m", "ipynb", "tsv"],
  },
  {
    id: "notes",
    label: "研究笔记",
    description: "读书笔记、讨论记录、图表说明和写作备忘。",
    extensions: ["txt"],
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
      setError("登录失败。请确认邮箱、密码，或先在 Supabase 里创建这个用户。");
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
          <p>集中管理文献、场景与标识材料、行为数据、EEG 文件、分析脚本和论文写作材料。</p>
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
        <PreviewCard title="资料结构" text="按文献、场景材料、原始数据、分析产物和写作材料维护项目资料。" />
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

  useEffect(() => {
    void loadDocuments();
  }, []);

  const groupedDocuments = useMemo(
    () =>
      documentCategories.map((category) => ({
        ...category,
        documents: documents.filter((document) => getDocumentCategory(document).id === category.id),
      })),
    [documents],
  );
  const selectedCategory = selectedDocument ? getDocumentCategory(selectedDocument) : null;
  const totalStoredBytes = documents.reduce((total, document) => total + (document.size_bytes ?? 0), 0);

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

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadState("uploading");
    setUploadMessage("");

    const storagePath = buildStoragePath(user.id, file.name);
    const { error: uploadError } = await supabase.storage.from("research-files").upload(storagePath, file, {
      cacheControl: "3600",
      upsert: false,
    });

    if (uploadError) {
      setUploadState("error");
      setUploadMessage(`上传失败：${uploadError.message}`);
      event.target.value = "";
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
      setUploadMessage(`文件已上传，但元数据保存失败：${insertError.message}`);
      event.target.value = "";
      return;
    }

    setUploadState("done");
    setUploadMessage("文件已上传到私有存储。");
    event.target.value = "";
    await loadDocuments();
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
          <a className="nav-item" href="#materials">
            场景与标识配置
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
                按文献、实验设计、场景配置、数据文件、分析结果和写作材料分区管理，用于检索、分析和论文写作引用。
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
              <h2>文献、场景与标识材料、原始数据与分析产物</h2>
            </div>
            <label className="file-button">
              <input
                type="file"
                accept=".pdf,.doc,.docx,.csv,.tsv,.xlsx,.mat,.set,.edf,.txt,.md,.svg,.png,.jpg,.jpeg,.xdf,.json,.jsonl,.py,.m,.ipynb"
                onChange={handleUpload}
              />
              {uploadState === "uploading" ? "上传中..." : "上传文件"}
            </label>
          </div>

          {uploadMessage ? <p className={`notice ${uploadState}`}>{uploadMessage}</p> : null}

          <div className="library-summary">
            {groupedDocuments.map((group) => (
              <article className="library-card" key={group.id}>
                <span>{group.documents.length}</span>
                <strong>{group.label}</strong>
                <p>{group.description}</p>
              </article>
            ))}
          </div>

          <div className="library-layout">
            <section className="work-panel document-list structured-list">
              {documents.length ? (
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
                          <strong>{document.filename}</strong>
                          <span>
                            {formatDocumentKind(document)} · {formatBytes(document.size_bytes)} ·{" "}
                            {new Date(document.created_at).toLocaleDateString("zh-CN")}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null,
                )
              ) : (
                <p className="muted">
                  还没有文件。上传后会按文献、场景与标识材料、原始数据、分析脚本和研究笔记分区显示。
                </p>
              )}
            </section>

            <section className="work-panel document-detail">
              <p className="eyebrow">当前选中</p>
              <h3>{selectedDocument?.filename ?? "尚未选择文件"}</h3>
              {selectedCategory ? <span className="category-badge">{selectedCategory.label}</span> : null}
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
            </section>
          </div>
        </section>

        <section className="view is-visible" id="blueprint">
          <ProjectBlueprint />
        </section>

        <section className="view is-visible" id="materials">
          <MaterialsPanel />
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
        </section>

        <section className="view is-visible" id="pipeline">
          <div className="section-head">
            <div>
              <p className="eyebrow">数据分析与论文写作</p>
              <h2>分析产物与写作材料</h2>
            </div>
          </div>
          <div className="workflow-list">
            {analysisModules.map((module) => (
              <PipelineCard key={module.title} title={module.title} text={module.text} />
            ))}
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

function getDocumentCategory(document: Pick<ResearchDocument, "filename" | "mime_type">) {
  const filename = document.filename.toLowerCase();
  const extension = getDocumentExtension(document.filename);

  if (["xdf", "edf", "set", "mat", "csv", "xlsx", "json", "jsonl"].includes(extension)) {
    return documentCategories[2];
  }

  if (["py", "m", "ipynb", "tsv"].includes(extension)) {
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

function buildStoragePath(userId: string, filename: string) {
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

  return `${userId}/${uniquePrefix}-${base}${extension ? `.${extension}` : ""}`;
}
