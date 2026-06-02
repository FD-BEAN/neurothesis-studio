import OpenAI from "openai";
import { NextResponse } from "next/server";
import { buildResearchKnowledgeContext, getSeedKnowledgeStats } from "@/lib/knowledgeBase";
import { isLiteratureDocument, parseLiteratureCard } from "@/lib/literature";
import { getSupabaseServerClient } from "@/lib/supabase";
import { projectWritingContext } from "@/lib/researchProject";

type RequestBody = {
  prompt?: string;
  context?: string;
  taskMode?: string;
  targetSection?: string;
  outputMode?: string;
};

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";

  if (!token) {
    return NextResponse.json({ error: "Missing Supabase access token." }, { status: 401 });
  }

  const supabase = getSupabaseServerClient(token);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return NextResponse.json({ error: "Invalid or expired Supabase session." }, { status: 401 });
  }

  const { prompt, context, taskMode, targetSection, outputMode } = (await request.json()) as RequestBody;

  if (!prompt?.trim()) {
    return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "OPENAI_API_KEY is not configured. Add it in Vercel Environment Variables before using AI features.",
      },
      { status: 503 },
    );
  }

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
  const userCards = await loadLiteratureKnowledgeCards(supabase, user.id);
  const analysisContext = await loadAnalysisContext(supabase, user.id);
  const knowledgeContext = buildResearchKnowledgeContext(prompt, userCards);
  const seedStats = getSeedKnowledgeStats();

  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          "You are a bilingual thesis writing collaborator for the Metro Rescue project. Work like an evidence-driven academic writing workflow, not a generic chatbot: clarify the task, use traceable evidence, draft conservatively, and audit the boundary of every claim. Use the project snapshot, literature knowledge base, uploaded-paper cards, and completed analysis-report summaries together. Cite source IDs, paper titles, filenames, or report titles when you rely on them. Distinguish four layers: literature evidence, project-specific hypothesis, actual experimental result, and missing information. Do not invent findings, p-values, effect sizes, sample completion numbers, page numbers, bibliographic details, or causal conclusions. If a quote anchor requires verification, say it needs page verification before final submission. Chinese should be the default for planning and explanation; produce polished English only for manuscript-ready text when asked.",
      },
      {
        role: "user",
        content: `Project snapshot:\n${projectWritingContext}\n\nWriting task profile:\n- Task mode: ${taskMode || "未指定"}\n- Target section: ${targetSection || "未指定"}\n- Output mode: ${outputMode || "未指定"}\n\nKnowledge base inventory: ${seedStats.sources + userCards.length} literature source cards, ${seedStats.claims} claims, ${seedStats.mechanisms} mechanisms, ${seedStats.hypotheses} hypotheses, ${seedStats.analysisModels} analysis models.\n\nLiterature knowledge base:\n${knowledgeContext}\n\nCompleted analysis context:\n${analysisContext}\n\nCurrent selected-file context:\n${context || "No file context provided."}\n\nRequired answer structure:\n1. 任务理解：只写与当前写作任务直接相关的范围。\n2. 可用于论文的内容：如果是正文草稿，用连续段落；如果是计划或审计，用紧凑结构。\n3. 证据依据：列出使用到的文献代码、文献标题、文件名或分析报告标题。\n4. 不能声称：列出缺少真实数据、缺少页码核验或证据不足的内容。\n5. 需要补充：列出用户下一步应补充的材料、metadata、统计输出或原文核验点。\n6. 英文论文段落：仅在 output mode 要求论文段落时提供，保持保守并在句末用括号标注来源线索。\n\nTask:\n${prompt}`,
      },
    ],
  });

  return NextResponse.json({
    output: response.output_text,
  });
}

async function loadLiteratureKnowledgeCards(supabase: ReturnType<typeof getSupabaseServerClient>, userId: string) {
  const { data } = await supabase
    .from("research_documents")
    .select("id,filename,mime_type,notes")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(120);

  const cards = (data ?? [])
    .filter(isLiteratureDocument)
    .map((document) => parseLiteratureCard(document.notes))
    .filter((card): card is NonNullable<typeof card> => Boolean(card));
  return cards;
}

async function loadAnalysisContext(supabase: ReturnType<typeof getSupabaseServerClient>, userId: string) {
  const { data } = await supabase
    .from("research_analysis_jobs")
    .select("id,analysis_type,status,result_json,created_at,completed_at")
    .eq("user_id", userId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(12);

  const rows = (data ?? [])
    .map((job) => summarizeAnalysisJob(job as AnalysisJobRow))
    .filter(Boolean);

  if (!rows.length) {
    return "No completed XDF or cohort analysis reports yet. Treat statistical conclusions as planned analysis only.";
  }

  return rows.join("\n\n");
}

type AnalysisJobRow = {
  id: string;
  analysis_type: string;
  status: string;
  result_json: unknown;
  created_at: string;
  completed_at: string | null;
};

function summarizeAnalysisJob(job: AnalysisJobRow) {
  const result = normalizeResultJson(job.result_json);
  if (!result) return "";

  const title = asText(result.title) || (job.analysis_type === "cohort_density_summary" ? "全样本密度统计汇总" : job.id);
  const summary = asText(result.summary);
  const metrics = Array.isArray(result.metrics)
    ? result.metrics
        .slice(0, 8)
        .map((metric) => {
          if (!metric || typeof metric !== "object") return "";
          const item = metric as { label?: unknown; value?: unknown; text?: unknown };
          return `${asText(item.label)}=${asText(item.value)}${item.text ? ` (${asText(item.text)})` : ""}`;
        })
        .filter(Boolean)
        .join("; ")
    : "";
  const contrasts = Array.isArray(result.densityContrasts)
    ? result.densityContrasts
        .slice(0, 6)
        .map((contrast) => {
          if (!contrast || typeof contrast !== "object") return "";
          const item = contrast as { metricLabel?: unknown; estimate?: unknown; direction?: unknown };
          return `${asText(item.metricLabel)} contrast=${asText(item.estimate)} ${asText(item.direction)}`;
        })
        .filter(Boolean)
        .join("; ")
    : "";
  const notes = Array.isArray(result.notes) ? result.notes.slice(0, 4).map(asText).join("；") : "";

  return [
    `[Analysis ${job.analysis_type}] ${title}`,
    summary ? `Summary: ${summary}` : "",
    metrics ? `Metrics: ${metrics}` : "",
    contrasts ? `Density contrasts: ${contrasts}` : "",
    notes ? `Notes: ${notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeResultJson(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asText(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : "";
  if (typeof value === "string") return value;
  return "";
}
