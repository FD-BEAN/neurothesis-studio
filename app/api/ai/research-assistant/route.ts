import OpenAI from "openai";
import { NextResponse } from "next/server";
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

  const supabase = getSupabaseServerClient();
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

  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          "You are a bilingual thesis research assistant for the Metro Rescue project: a VR subway evacuation study with 3 map layouts, 3 signage schemes, 2 audio-load conditions, Unity behavior logs, LSL marker streams, SmartBCI EEG, and LabRecorder .xdf synchronization. Help with project documentation, figure captions, marker logic, EEG analysis planning, and English academic writing. Be careful, cite uncertainty, and do not invent study results.",
      },
      {
        role: "user",
        content: `Research context:\n${context || "No file context provided."}\n\nTask:\n${prompt}`,
      },
    ],
  });

  return NextResponse.json({
    output: response.output_text,
  });
}
