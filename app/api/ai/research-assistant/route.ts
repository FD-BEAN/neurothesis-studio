import OpenAI from "openai";
import { NextResponse } from "next/server";
import { buildResearchKnowledgeContext, getSeedKnowledgeStats } from "@/lib/knowledgeBase";
import { isLiteratureDocument, parseLiteratureCard } from "@/lib/literature";
import { getSupabaseServerClient } from "@/lib/supabase";
import { projectWritingContext } from "@/lib/researchProject";

type RequestBody = {
  prompt?: string;
  taskMode?: string;
  targetSection?: string;
  outputMode?: string;
};

const writingWorkflowProtocol = [
  "Manuscript first: when the user requests writing, start with the exact paper section text, not advice, brainstorming, or a checklist.",
  "Evidence trace second: after the manuscript text, explain which literature cards, project hypotheses, analysis reports, or missing data support each claim.",
  "Quality gate third: audit unsupported claims, page-number verification needs, missing metadata, and whether the requested section is allowed to state actual results.",
  "Methods and results must be reproducible: name the XDF streams, Unity marker families, EEG windows/features, density-condition mapping, planned contrasts, and required subject-level metadata when relevant.",
  "Do not smooth over uncertainty. If the literature only gives an analogy, say it is an analogy; if the analysis has not run on the full cohort, say it is a plan or preliminary output.",
].join("\n- ");

function buildAnswerStructure(outputMode?: string) {
  const normalizedMode = outputMode?.toLowerCase() ?? "";
  const wantsManuscript = outputMode?.includes("论文") || normalizedMode.includes("manuscript");
  const wantsAudit = outputMode?.includes("审稿") || outputMode?.includes("审计") || normalizedMode.includes("audit");

  if (wantsManuscript) {
    return [
      "1. 论文正文（English manuscript text）：直接给出可进入草稿的连续英文段落或小节；句末用括号标注可追溯的文献代码、文献标题、文件名或分析报告线索。",
      "2. 中文写作说明：解释段落逻辑、变量口径、组内/组间分析边界，以及哪些句子只是研究假设。",
      "3. 证据链与引用线索：列出使用到的文献代码、文献标题、文件名、知识卡字段或分析报告标题。",
      "4. 不能声称/待补数据：列出缺少真实结果、缺少页码核验、缺少 subject metadata、缺少统计量或模型输出的内容。",
      "5. 可继续扩写的位置：说明下一步可以扩展成哪个小节、表格、图注或 Results 段落。",
    ].join("\n");
  }

  if (wantsAudit) {
    return [
      "1. 改写后正文：先给出可以替换原文的英文段落或中文段落。",
      "2. 主要修改理由：说明逻辑、证据、措辞和结论边界如何被收紧。",
      "3. 证据链与引用线索：列出使用到的文献代码、文献标题、文件名或分析报告标题。",
      "4. 不能声称/待补数据：列出仍需核验或等待真实分析结果的部分。",
      "5. 下一版修改建议：只列真正影响论文质量的修改点。",
    ].join("\n");
  }

  return [
    "1. 章节结构：给出该节可采用的小节顺序和段落功能。",
    "2. 正文草稿：为每个关键段落写出可进入论文的连续文本，不只给 bullet points。",
    "3. 证据矩阵：按“论点 / 文献依据 / 项目假设 / 真实结果或缺口 / 可写位置”组织。",
    "4. 不能声称：列出缺少真实数据、缺少页码核验或证据不足的内容。",
    "5. 下一步材料：列出需要补充的 metadata、统计输出、原文核验点或图表。",
  ].join("\n");
}

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

  const { prompt, taskMode, targetSection, outputMode } = (await request.json()) as RequestBody;

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
          "You are a bilingual thesis manuscript writer for the Metro Rescue project. Your default job is to draft the requested paper section itself, not merely advise the user. Start with polished, conservative academic prose when the task asks for manuscript writing; put planning, evidence tracing, and caveats after the draft. Use the project snapshot, literature knowledge base, uploaded-paper cards, and completed analysis-report summaries together. Cite source IDs, paper titles, filenames, or report titles when you rely on them. Distinguish four layers: literature evidence, project-specific hypothesis, actual experimental result, and missing information. Do not invent findings, p-values, effect sizes, sample completion numbers, page numbers, bibliographic details, or causal conclusions. If a quote anchor requires verification, say it needs page verification before final submission. Chinese should be the default for explanations and audit notes; polished English should be the default for manuscript-ready text.",
      },
      {
        role: "user",
        content: `Project snapshot:\n${projectWritingContext}\n\nWriting task profile:\n- Task mode: ${taskMode || "未指定"}\n- Target section: ${targetSection || "未指定"}\n- Output mode: ${outputMode || "未指定"}\n\nWriting workflow protocol:\n- ${writingWorkflowProtocol}\n\nKnowledge base inventory: ${seedStats.sources + userCards.length} literature source cards, ${seedStats.claims} claims, ${seedStats.mechanisms} mechanisms, ${seedStats.hypotheses} hypotheses, ${seedStats.analysisModels} analysis models.\n\nLiterature knowledge base:\n${knowledgeContext}\n\nCompleted analysis context:\n${analysisContext}\n\nRequired answer structure:\n${buildAnswerStructure(outputMode)}\n\nTask:\n${prompt}`,
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
