import { NextResponse } from "next/server";
import { getSupabaseServerClient, type ResearchAnalysisJob, type ResearchDocument } from "@/lib/supabase";

type CreateJobBody = {
  documentId?: string;
  analysisType?: string;
};

const DEFAULT_WORKFLOW = "analysis-worker.yml";

export async function GET(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { supabase, userId } = auth;
  const { data, error } = await supabase
    .from("research_analysis_jobs")
    .select(
      "id,user_id,document_id,analysis_type,status,status_message,result_json,error_message,github_run_url,created_at,updated_at,completed_at,research_documents(filename,storage_path,mime_type,size_bytes)",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ jobs: normalizeJobs(data ?? []) });
}

export async function POST(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { supabase, userId } = auth;
  const { documentId, analysisType } = (await request.json()) as CreateJobBody;

  if (!documentId) {
    return NextResponse.json({ error: "documentId is required." }, { status: 400 });
  }

  const { data: document, error: documentError } = await supabase
    .from("research_documents")
    .select("*")
    .eq("id", documentId)
    .single();

  if (documentError || !document) {
    return NextResponse.json({ error: documentError?.message ?? "Document not found." }, { status: 404 });
  }

  const researchDocument = document as ResearchDocument;
  if (researchDocument.user_id !== userId) {
    return NextResponse.json({ error: "Document does not belong to current user." }, { status: 403 });
  }

  const { data: insertedJob, error: insertError } = await supabase
    .from("research_analysis_jobs")
    .insert({
      user_id: userId,
      document_id: documentId,
      analysis_type: analysisType || "advanced_python",
      status: "pending",
      status_message: "分析任务已创建，等待 Python worker。",
    })
    .select("*")
    .single();

  if (insertError || !insertedJob) {
    return NextResponse.json({ error: insertError?.message ?? "Failed to create analysis job." }, { status: 500 });
  }

  const job = insertedJob as ResearchAnalysisJob;
  const dispatchConfig = getDispatchConfig();

  if (!dispatchConfig.ready) {
    const message = `高级 Python worker 尚未配置：${dispatchConfig.missing.join(", ")}。请在 Vercel 环境变量和 GitHub Secrets 中完成配置。`;
    const { data: updatedJob } = await supabase
      .from("research_analysis_jobs")
      .update({
        status: "configuration_required",
        status_message: message,
        error_message: message,
      })
      .eq("id", job.id)
      .select("*")
      .single();

    return NextResponse.json(
      {
        job: (updatedJob ?? job) as ResearchAnalysisJob,
        warning: message,
      },
      { status: 202 },
    );
  }

  const dispatch = await dispatchGithubWorkflow(dispatchConfig, job.id);

  if (!dispatch.ok) {
    const { data: failedJob } = await supabase
      .from("research_analysis_jobs")
      .update({
        status: "failed",
        status_message: "GitHub Actions 触发失败。",
        error_message: dispatch.error,
      })
      .eq("id", job.id)
      .select("*")
      .single();

    return NextResponse.json(
      {
        job: (failedJob ?? job) as ResearchAnalysisJob,
        error: dispatch.error,
      },
      { status: 502 },
    );
  }

  const { data: queuedJob } = await supabase
    .from("research_analysis_jobs")
    .update({
      status: "queued",
      status_message: "已触发 GitHub Actions Python worker。",
    })
    .eq("id", job.id)
    .select("*")
    .single();

  return NextResponse.json({ job: (queuedJob ?? job) as ResearchAnalysisJob });
}

async function authenticate(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";

  if (!token) {
    return { response: NextResponse.json({ error: "Missing Supabase access token." }, { status: 401 }) };
  }

  const supabase = getSupabaseServerClient(token);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    return { response: NextResponse.json({ error: "Invalid or expired Supabase session." }, { status: 401 }) };
  }

  return { supabase, userId: user.id };
}

function normalizeJobs(rows: unknown[]) {
  return rows.map((row) => {
    const job = row as ResearchAnalysisJob & {
      research_documents?: ResearchAnalysisJob["research_documents"] | ResearchAnalysisJob["research_documents"][];
    };
    const relatedDocument = Array.isArray(job.research_documents)
      ? job.research_documents[0] ?? null
      : job.research_documents ?? null;

    return {
      ...job,
      research_documents: relatedDocument,
    } satisfies ResearchAnalysisJob;
  });
}

function getDispatchConfig() {
  const token = process.env.GITHUB_ANALYSIS_TOKEN;
  const repo = process.env.GITHUB_ANALYSIS_REPO;
  const workflow = process.env.GITHUB_ANALYSIS_WORKFLOW || DEFAULT_WORKFLOW;
  const ref = process.env.GITHUB_ANALYSIS_REF || "main";
  const missing = [
    !token ? "GITHUB_ANALYSIS_TOKEN" : "",
    !repo ? "GITHUB_ANALYSIS_REPO" : "",
  ].filter(Boolean);

  return {
    ready: missing.length === 0,
    missing,
    token: token ?? "",
    repo: repo ?? "",
    workflow,
    ref,
  };
}

async function dispatchGithubWorkflow(
  config: ReturnType<typeof getDispatchConfig>,
  jobId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await fetch(
    `https://api.github.com/repos/${config.repo}/actions/workflows/${config.workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        ref: config.ref,
        inputs: {
          job_id: jobId,
          analysis_type: "advanced_python",
        },
      }),
    },
  );

  if (response.ok) {
    return { ok: true };
  }

  const text = await response.text();
  return {
    ok: false,
    error: `GitHub workflow dispatch failed (${response.status}): ${text.slice(0, 500)}`,
  };
}
