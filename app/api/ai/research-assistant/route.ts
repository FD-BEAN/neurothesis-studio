import OpenAI from "openai";
import { NextResponse } from "next/server";
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
  const knowledgeContext = await loadLiteratureKnowledgeContext(supabase, user.id);

  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          "You are a bilingual thesis research assistant for the Metro Rescue project: a VR subway evacuation study with 3 map layouts, 3 signage schemes, 2 audio-load conditions, Unity behavior logs, LSL marker streams, SmartBCI EEG, and LabRecorder .xdf synchronization. Use the supplied literature knowledge base first, cite paper filenames/titles when you rely on them, distinguish literature evidence from the user's own experimental results, and do not invent findings.",
      },
      {
        role: "user",
        content: `Literature knowledge base:\n${knowledgeContext}\n\nCurrent file context:\n${context || "No file context provided."}\n\nTask:\n${prompt}`,
      },
    ],
  });

  return NextResponse.json({
    output: response.output_text,
  });
}

async function loadLiteratureKnowledgeContext(supabase: ReturnType<typeof getSupabaseServerClient>, userId: string) {
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

  if (!cards.length) {
    return "No indexed literature cards yet. Ask the user to build literature knowledge cards before making literature-grounded claims.";
  }

  return cards
    .map(
      (card, index) => [
        `[${index + 1}] ${card.title || card.filename}`,
        `Filename: ${card.filename}`,
        `Citation: ${card.citation}`,
        `Research question: ${card.researchQuestion}`,
        `Methods: ${card.methods}`,
        `Measures: ${card.eegOrMeasures}`,
        `Key findings: ${card.keyFindings.join("；")}`,
        `Limitations: ${card.limitations.join("；")}`,
        `Use for Metro Rescue: ${card.relevanceToMetroRescue.join("；")}`,
      ].join("\n"),
    )
    .join("\n\n");
}
