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
          <p className="eyebrow">安全版登录</p>
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
          当前版本使用 Supabase Auth。请在 Supabase Dashboard 里创建用户，并关闭公开注册或只邀请可信用户。
        </p>
      </section>

      <aside className="auth-aside">
        <PreviewCard title="Private Storage" text="论文 PDF 和实验文件进入 Supabase 私有 bucket，由 RLS 控制访问。" />
        <PreviewCard title="Backend AI API" text="OpenAI API key 只放在 Vercel 环境变量里，前端不会暴露密钥。" />
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

    const safeName = file.name.replace(/[^\w.\-\u4e00-\u9fa5]+/g, "_");
    const storagePath = `${user.id}/${Date.now()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from("research-files").upload(storagePath, file, {
      cacheControl: "3600",
      upsert: false,
    });

    if (uploadError) {
      setUploadState("error");
      setUploadMessage(`上传失败：${uploadError.message}`);
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
            项目总览
          </a>
          <a className="nav-item" href="#blueprint">
            研究蓝图
          </a>
          <a className="nav-item" href="#materials">
            图纸索引
          </a>
          <a className="nav-item" href="#files">
            私有论文库
          </a>
          <a className="nav-item" href="#ai">
            AI 研究助手
          </a>
          <a className="nav-item" href="#pipeline">
            分析流程
          </a>
        </nav>
        <div className="side-note">
          <span className="note-label">登录用户</span>
          <p>{user.email}</p>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">安全版 v0.2</p>
            <h1>真实数据准备区</h1>
          </div>
          <div className="top-actions">
            <span className="status-pill compact">Supabase Auth</span>
            <button className="secondary-button" onClick={signOut}>
              退出
            </button>
          </div>
        </header>

        <section className="view is-visible" id="overview">
          <div className="section-head">
            <div>
              <p className="eyebrow">Research workspace</p>
              <h2>VR 地铁逃生 + EEG 认知负荷论文工作台</h2>
            </div>
            <span className="status-pill">私有访问</span>
          </div>

          <div className="metric-grid">
            <Metric label="私有文件" value={documents.length} text="受 Supabase RLS 保护的论文、数据和笔记。" />
            <Metric label="存储模式" value="RLS" text="用户只能访问自己路径下的文件。" />
            <Metric label="AI 密钥" value="Server" text="OpenAI API key 只在后端环境变量中使用。" />
            <Metric label="部署目标" value="Vercel" text="Next.js API routes 需要服务端运行环境。" />
          </div>

          <div className="keyword-row">
            {thesisKeywords.map((keyword) => (
              <span key={keyword}>{keyword}</span>
            ))}
          </div>
        </section>

        <section className="view is-visible" id="blueprint">
          <ProjectBlueprint />
        </section>

        <section className="view is-visible" id="materials">
          <MaterialsPanel />
        </section>

        <section className="view is-visible" id="files">
          <div className="section-head">
            <div>
              <p className="eyebrow">Private storage</p>
              <h2>私有论文与数据文件</h2>
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
                <p className="muted">还没有文件。建议先上传 9 张 SVG 图纸、研究图注 md、Unity 日志样例和 EEG .xdf 文件。</p>
              )}
            </section>

            <section className="work-panel">
              <h3>{selectedDocument?.filename ?? "尚未选择文件"}</h3>
              <p className="muted">文件不会公开暴露。需要访问时会生成 5 分钟有效的临时签名链接。</p>
              <button
                className="secondary-button"
                disabled={!selectedDocument}
                onClick={() => selectedDocument && openSignedUrl(selectedDocument)}
              >
                打开临时链接
              </button>
            </section>
          </div>
        </section>

        <section className="view is-visible" id="ai">
          <div className="section-head">
            <div>
              <p className="eyebrow">Backend AI API</p>
              <h2>AI 研究助手</h2>
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
                这个请求会经过 Next.js API route，并验证 Supabase 登录 token。没有登录的人不能调用。
              </p>
              <pre>{aiState.output || "配置 OPENAI_API_KEY 后，这里会显示 AI 输出。"}</pre>
            </section>
          </div>
        </section>

        <section className="view is-visible" id="pipeline">
          <div className="section-head">
            <div>
              <p className="eyebrow">Analysis pipeline</p>
              <h2>下一步分析模块</h2>
            </div>
          </div>
          <div className="dashboard-grid">
            <PipelineCard title="PDF 解析" text="上传 PDF 后抽取摘要、方法、样本、指标、局限和引用信息。" />
            <PipelineCard title="EEG 数据" text="为 .edf/.set/.mat 文件生成 MNE-Python 与 EEGLAB 预处理脚本。" />
            <PipelineCard title="文献矩阵" text="把多篇论文抽取成双语矩阵，支撑 Introduction 和 Discussion。" />
            <PipelineCard title="论文写作" text="只根据上传文件和分析结果生成英文草稿，保留中文解释。" />
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
          <p className="eyebrow">Project design</p>
          <h2>Metro Rescue 研究蓝图</h2>
        </div>
        <span className="status-pill">{researchProject.design.totalConditions} 个实验组合</span>
      </div>

      <div className="metric-grid">
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
          <p className="eyebrow">Private research materials</p>
          <h2>图纸与图注索引</h2>
        </div>
        <span className="status-pill">不要提交到 public repo</span>
      </div>

      <div className="materials-grid">
        {researchProject.planFiles.map((item) => (
          <article className="material-card" key={item.file}>
            <span>
              {item.map} / {item.signature}
            </span>
            <strong>{item.file}</strong>
            <p>{item.signs} 个实验标识点。建议上传到 Supabase private Storage，并与图注记录绑定。</p>
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

function PipelineCard({ title, text }: { title: string; text: string }) {
  return (
    <article className="work-panel">
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
