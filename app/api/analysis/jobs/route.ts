import { NextResponse } from "next/server";
import { getSupabaseServerClient, type ResearchAnalysisJob, type ResearchDocument } from "@/lib/supabase";

type CreateJobBody = {
  documentId?: string;
  documentIds?: string[];
  subjectId?: string;
  analysisType?: string;
};

type DeleteJobsBody = {
  jobIds?: string[];
  mode?: "failed_or_stale" | "completed";
};

const DEFAULT_WORKFLOW = "analysis-worker.yml";
const DENSITY_ANALYSIS_DESIGN = {
  expectedSubjects: 90,
  runsPerSubject: 3,
  expectedTotalRuns: 270,
  withinSubjectFactor: "density",
  densityLevels: ["low", "medium", "high"],
  primaryHypothesis: "medium density has the highest cognitive load",
  primaryContrast: {
    name: "medium_minus_low_high_mean",
    weights: { low: -1, medium: 2, high: -1 },
  },
};

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
    .limit(500);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ jobs: normalizeJobs(data ?? []) });
}

export async function POST(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { supabase, userId } = auth;
  const { documentId, documentIds, subjectId, analysisType } = (await request.json()) as CreateJobBody;
  const requestedDocumentIds = uniqueStrings(documentIds?.length ? documentIds : documentId ? [documentId] : []);
  const isSubjectBatch = analysisType === "subject_batch" || requestedDocumentIds.length > 1;

  if (!requestedDocumentIds.length) {
    return NextResponse.json({ error: "documentId or documentIds is required." }, { status: 400 });
  }

  const { data: ownedDocuments, error: documentsError } = await supabase
    .from("research_documents")
    .select("*")
    .eq("user_id", userId)
    .in("id", requestedDocumentIds);

  if (documentsError) {
    return NextResponse.json({ error: documentsError.message }, { status: 500 });
  }

  const documents = ((ownedDocuments ?? []) as ResearchDocument[]).sort(
    (a, b) => requestedDocumentIds.indexOf(a.id) - requestedDocumentIds.indexOf(b.id),
  );

  if (documents.length !== requestedDocumentIds.length) {
    return NextResponse.json({ error: "Some documents were not found or do not belong to current user." }, { status: 404 });
  }

  const nonXdfDocument = documents.find((document) => getExtension(document.filename) !== "xdf");
  if (nonXdfDocument) {
    return NextResponse.json(
      { error: `XDF 高级分析只接受 .xdf 文件：${nonXdfDocument.filename} 不是 XDF。` },
      { status: 400 },
    );
  }

  if (isSubjectBatch && requestedDocumentIds.length < 2) {
    return NextResponse.json({ error: "被试批量分析至少需要 2 个 XDF；正式数据建议同一被试的低/中/高密度 3 个 run 一起提交。" }, { status: 400 });
  }

  const resolvedAnalysisType = isSubjectBatch ? "subject_batch" : analysisType || "advanced_python";
  const representativeDocument = documents[0];
  const batchPayload = isSubjectBatch
    ? {
        kind: "subject_batch",
        subjectId: subjectId?.trim() || inferSubjectId(representativeDocument.filename),
        documentIds: requestedDocumentIds,
        filenames: documents.map((document) => document.filename),
        design: DENSITY_ANALYSIS_DESIGN,
        conditions: documents.map((document) => ({
          documentId: document.id,
          filename: document.filename,
          density: inferDensityLevel(document.filename),
          runLabel: inferRunLabel(document.filename),
        })),
      }
    : null;

  const { data: insertedJob, error: insertError } = await supabase
    .from("research_analysis_jobs")
    .insert({
      user_id: userId,
      document_id: representativeDocument.id,
      analysis_type: resolvedAnalysisType,
      status: "pending",
      status_message: batchPayload
        ? `被试 ${batchPayload.subjectId} 的 ${documents.length} 个 XDF 批量分析任务已创建，等待 Python worker。`
        : "XDF 分析任务已创建，等待 Python worker。",
      result_json: batchPayload ? { batch: batchPayload } : null,
    })
    .select("*")
    .single();

  if (insertError || !insertedJob) {
    return NextResponse.json({ error: insertError?.message ?? "Failed to create analysis job." }, { status: 500 });
  }

  const job = insertedJob as ResearchAnalysisJob;
  const dispatchConfig = getDispatchConfig();

  if (!dispatchConfig.ready) {
    const message = `XDF Python worker 尚未配置：${dispatchConfig.missing.join(", ")}。请在 Vercel 环境变量和 GitHub Secrets 中完成配置。`;
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

  const dispatch = await dispatchGithubWorkflow(dispatchConfig, job.id, resolvedAnalysisType);

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
      status_message: batchPayload
        ? `已触发 GitHub Actions：被试 ${batchPayload.subjectId} 的 ${documents.length} 个 XDF 将按低/中/高密度一起分析。`
        : "已触发 GitHub Actions XDF Python worker。",
    })
    .eq("id", job.id)
    .select("*")
    .single();

  return NextResponse.json({ job: (queuedJob ?? job) as ResearchAnalysisJob });
}

export async function DELETE(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { supabase, userId } = auth;
  const { jobIds, mode } = (await request.json().catch(() => ({}))) as DeleteJobsBody;

  let query = supabase.from("research_analysis_jobs").delete().eq("user_id", userId);
  if (jobIds?.length) {
    query = query.in("id", uniqueStrings(jobIds));
  } else if (mode === "failed_or_stale") {
    query = query.in("status", ["failed", "configuration_required"]);
  } else if (mode === "completed") {
    query = query.eq("status", "completed");
  } else {
    return NextResponse.json({ error: "jobIds or cleanup mode is required." }, { status: 400 });
  }

  const { error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
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

function getExtension(filename: string) {
  const parts = filename.toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

function getDispatchConfig() {
  const token = process.env.GITHUB_ANALYSIS_TOKEN;
  const repo = process.env.GITHUB_ANALYSIS_REPO;
  const workflow = process.env.GITHUB_ANALYSIS_WORKFLOW || DEFAULT_WORKFLOW;
  const ref = process.env.GITHUB_ANALYSIS_REF || "main";
  const missing = [!token ? "GITHUB_ANALYSIS_TOKEN" : "", !repo ? "GITHUB_ANALYSIS_REPO" : ""].filter(Boolean);

  return {
    ready: missing.length === 0,
    missing,
    token: token ?? "",
    repo,
    workflow,
    ref,
  };
}

async function dispatchGithubWorkflow(
  config: ReturnType<typeof getDispatchConfig>,
  jobId: string,
  analysisType: string,
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
          analysis_type: analysisType,
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

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function inferSubjectId(filename: string) {
  const bidsMatch = filename.match(/sub-([A-Za-z0-9]+)/i);
  if (bidsMatch?.[1]) return `sub-${bidsMatch[1]}`;
  const subjectMatch = filename.match(/(?:subject|subj|participant|p)[-_]?([A-Za-z0-9]+)/i);
  if (subjectMatch?.[1]) return `sub-${subjectMatch[1]}`;
  return "subject-unknown";
}

function inferRunLabel(filename: string) {
  const runMatch = filename.match(/run-([A-Za-z0-9]+)/i);
  if (runMatch?.[1]) return `run-${runMatch[1]}`;
  const signatureMatch = filename.match(/signature[-_]?([A-Za-z0-9]+)/i);
  if (signatureMatch?.[1]) return `signature-${signatureMatch[1]}`;
  return getExtension(filename).toUpperCase() || "file";
}

function inferDensityLevel(filename: string) {
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
