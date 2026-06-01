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

const deskTasks = [
  {
    title: "把文献先分成三类",
    text: "wayfinding / signage design、VR evacuation、EEG cognitive load。先建立能支撑 Introduction 的证据框架。",
  },
  {
    title: "核对图纸与图注",
    text: "优先统一标识可读范围文字，避免 Methods 里出现 0-5m、0-8m、8-12m 的口径冲突。",
  },
  {
    title: "整理 3×3×2 条件表",
    text: "把地图、标识方案、音频负荷、Unity marker 和 EEG 同步关系整理成可直接写入论文的表。",
  },
];

const workflowSteps = [
  { title: "读文献", text: "摘要、变量、任务范式、EEG 指标和局限先做成双语卡片。" },
  { title: "定材料", text: "图纸、图注、Unity 日志、LSL marker 和 .xdf 文件逐项对齐。" },
  { title: "跑分析", text: "先固定行为指标，再接 EEG 预处理和事件锁定分析。" },
  { title: "写论文", text: "Methods 先成型，再补 Introduction 和 Discussion 的证据链。" },
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
          <p className="eyebrow">私人工作台</p>
          <h1>进入私人论文研究空间</h1>
          <p>这里将用于真实论文 PDF、实验数据、EEG 分析笔记和 AI 研究助手。</p>
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
        <PreviewCard title="今日工作" text="先整理文献证据、图纸口径和实验条件表，再进入写作。" />
        <PreviewCard title="研究原则" text="所有结论都回到上传材料和真实分析结果，不替研究编造发现。" />
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
            今天
          </a>
          <a className="nav-item" href="#files">
            资料库
          </a>
          <a className="nav-item" href="#blueprint">
            实验设计
          </a>
          <a className="nav-item" href="#materials">
            图纸与刺激
          </a>
          <a className="nav-item" href="#ai">
            研究助理
          </a>
          <a className="nav-item" href="#pipeline">
            写作流程
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
            <p className="eyebrow">研究桌面</p>
            <h1>Metro Rescue 论文工作台</h1>
          </div>
          <div className="top-actions">
            <span className="status-pill compact">私人空间</span>
            <button className="secondary-button" onClick={signOut}>
              退出
            </button>
          </div>
        </header>

        <section className="view is-visible" id="overview">
          <div className="desk-layout">
            <section className="desk-panel desk-primary">
              <p className="eyebrow">今天先做什么</p>
              <h2>把材料整理成可以写进论文的证据</h2>
              <p className="desk-lead">
                这里不是展示系统功能的地方，而是每天打开后能立刻接着做研究的桌面。先把文献、图纸、实验条件和数据口径理顺，再进入分析与英文写作。
              </p>
              <div className="task-list">
                {deskTasks.map((task, index) => (
                  <article className="task-row" key={task.title}>
                    <span>{index + 1}</span>
                    <div>
                      <strong>{task.title}</strong>
                      <p>{task.text}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <aside className="desk-panel desk-side">
              <p className="eyebrow">资料状态</p>
              <dl className="status-list">
                <div>
                  <dt>已入库文件</dt>
                  <dd>{documents.length}</dd>
                </div>
                <div>
                  <dt>当前材料</dt>
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
              <p className="eyebrow">资料库</p>
              <h2>论文、图纸和实验数据</h2>
            </div>
            <label className="file-button">
              <input type="file" accept=".pdf,.csv,.xlsx,.mat,.set,.edf,.txt,.md,.svg,.xdf,.jsonl" onChange={handleUpload} />
              {uploadState === "uploading" ? "上传中..." : "上传文件"}
            </label>
          </div>

          {uploadMessage ? <p className={`notice ${uploadState}`}>{uploadMessage}</p> : null}

          <div className="document-grid">
            <section className="work-panel document-list">
              {documents.length ? (
                documents.map((document) => (
                  <button
                    className={`document-item ${selectedDocument?.id === document.id ? "is-active" : ""}`}
                    key={document.id}
                    onClick={() => setSelectedDocument(document)}
                  >
                    <strong>{document.filename}</strong>
                    <span>{formatBytes(document.size_bytes)} · {new Date(document.created_at).toLocaleDateString("zh-CN")}</span>
                  </button>
                ))
              ) : (
                <p className="muted">还没有文件。建议先放入核心文献 PDF、研究图注、9 张 SVG 图纸、Unity 日志样例和 EEG .xdf 文件。</p>
              )}
            </section>

            <section className="work-panel document-detail">
              <p className="eyebrow">当前选中</p>
              <h3>{selectedDocument?.filename ?? "尚未选择文件"}</h3>
              <p className="muted">材料保持私有。需要阅读原文件时，会生成一个短时间有效的临时链接。</p>
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
              <p className="eyebrow">研究助理</p>
              <h2>把材料变成笔记、表格和英文段落</h2>
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
              <p className="eyebrow">写作流程</p>
              <h2>从材料到论文草稿</h2>
            </div>
          </div>
          <div className="workflow-list">
            {workflowSteps.map((step, index) => (
              <PipelineCard key={step.title} index={index + 1} title={step.title} text={step.text} />
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
        <Metric label="平面图" value={researchProject.planFiles.length} text="3 地图 × 3 标识方案，每张图含标识可读范围。" />
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
          <p className="eyebrow">图纸与刺激材料</p>
          <h2>9 张平面图和论文图表线索</h2>
        </div>
        <span className="status-pill">待核对图例半径</span>
      </div>

      <div className="materials-grid">
        {researchProject.planFiles.map((item) => (
          <article className="material-card" key={item.file}>
            <span>
              {item.map} / {item.signature}
            </span>
            <strong>{item.file}</strong>
            <p>{item.signs} 个实验标识点。建议放入私人资料库，并与图注记录绑定。</p>
          </article>
        ))}
      </div>

      <section className="work-panel">
        <h3>论文图表组织建议</h3>
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

function PipelineCard({ index, title, text }: { index?: number; title: string; text: string }) {
  return (
    <article className="work-panel">
      {index ? <span className="step-number">{index}</span> : null}
      <h3>{title}</h3>
      <p className="muted">{text}</p>
    </article>
  );
}

function formatBytes(size: number | null) {
  if (!size) return "unknown size";
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
