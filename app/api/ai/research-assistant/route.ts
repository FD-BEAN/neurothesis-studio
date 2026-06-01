import OpenAI from "openai";
import { NextResponse } from "next/server";
import { buildResearchKnowledgeContext, getSeedKnowledgeStats } from "@/lib/knowledgeBase";
import { isLiteratureDocument, parseLiteratureCard } from "@/lib/literature";
import { getSupabaseServerClient } from "@/lib/supabase";

type RequestBody = {
  prompt?: string;
  context?: string;
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

  const { prompt, context } = (await request.json()) as RequestBody;

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
  const knowledgeContext = buildResearchKnowledgeContext(prompt, userCards);
  const seedStats = getSeedKnowledgeStats();

  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          "You are a bilingual thesis research assistant for the Metro Rescue project: a VR subway evacuation study with 3 map layouts, 3 signage schemes, 2 audio-load conditions, Unity behavior logs, LSL marker streams, SmartBCI EEG, and LabRecorder .xdf synchronization. Use the supplied built-in seed knowledge base and user-added literature cards first. Cite source IDs, paper titles, or filenames when you rely on them. Distinguish literature evidence, project-specific hypotheses, and the user's own experimental results. Do not invent findings, page numbers, or bibliographic details. If a quote anchor says it requires verification, say it needs page verification before final submission.",
      },
      {
        role: "user",
        content: `Knowledge base inventory: ${seedStats.sources} seed source cards, ${seedStats.claims} claims, ${seedStats.mechanisms} mechanisms, ${seedStats.hypotheses} hypotheses, ${seedStats.analysisModels} analysis models, plus ${userCards.length} user-added literature cards.\n\nLiterature knowledge base:\n${knowledgeContext}\n\nCurrent file context:\n${context || "No file context provided."}\n\nTask:\n${prompt}`,
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
    .limit(40);

  const cards = (data ?? [])
    .filter(isLiteratureDocument)
    .map((document) => parseLiteratureCard(document.notes))
    .filter((card): card is NonNullable<typeof card> => Boolean(card));
  return cards;
}
