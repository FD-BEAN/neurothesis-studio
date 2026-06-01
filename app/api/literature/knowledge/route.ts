import OpenAI from "openai";
import { NextResponse } from "next/server";
import { encodeLiteratureCard, isLiteratureDocument, parseLiteratureCard, type LiteratureKnowledgeCard } from "@/lib/literature";
import { getSupabaseServerClient, type ResearchDocument } from "@/lib/supabase";

type RequestBody = {
  documentId?: string;
};

const MAX_EXTRACTED_CHARS = 120_000;

export async function GET(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { supabase, userId } = auth;
  const { data, error } = await supabase
    .from("research_documents")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const documents = ((data ?? []) as ResearchDocument[]).filter(isLiteratureDocument);
  return NextResponse.json({
    cards: documents.map((document) => ({
      document,
      card: parseLiteratureCard(document.notes),
    })),
  });
}

export async function POST(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { supabase, userId } = auth;
  const { documentId } = (await request.json()) as RequestBody;

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

  if (!isLiteratureDocument(researchDocument)) {
    return NextResponse.json({ error: "Only literature documents can be indexed into the knowledge base." }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured." }, { status: 503 });
  }

  let card: LiteratureKnowledgeCard;
  try {
    const extracted = await extractDocumentText(supabase, researchDocument);
    card = await buildKnowledgeCard(apiKey, researchDocument, extracted);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to build literature knowledge card." },
      { status: 500 },
    );
  }

  const { error: updateError } = await supabase
    .from("research_documents")
    .update({ notes: encodeLiteratureCard(card) })
    .eq("id", researchDocument.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ card });
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

async function extractDocumentText(supabase: ReturnType<typeof getSupabaseServerClient>, document: ResearchDocument) {
  const dotIndex = document.filename.lastIndexOf(".");
  const extension = dotIndex >= 0 ? document.filename.slice(dotIndex + 1).toLowerCase() : "";
  const { data: fileBlob, error } = await supabase.storage.from("research-files").download(document.storage_path);

  if (error || !fileBlob) {
    throw new Error(error?.message ?? "Failed to download literature file.");
  }

  if (extension === "pdf" || document.mime_type?.includes("pdf")) {
    const buffer = Buffer.from(await fileBlob.arrayBuffer());
    const pdfParseModule = (await import("pdf-parse")) as unknown as { default?: (input: Buffer) => Promise<{ text?: string }> };
    const pdfParse = pdfParseModule.default ?? (pdfParseModule as unknown as (input: Buffer) => Promise<{ text?: string }>);
    const parsed = await pdfParse(buffer);
    return sanitizeExtractedText(parsed.text ?? "");
  }

  if (["txt", "md"].includes(extension)) {
    return sanitizeExtractedText(await fileBlob.text());
  }

  return "";
}

async function buildKnowledgeCard(apiKey: string, document: ResearchDocument, extractedText: string): Promise<LiteratureKnowledgeCard> {
  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
  const textForModel = extractedText.slice(0, MAX_EXTRACTED_CHARS);

  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          "You build structured bilingual literature knowledge cards for a thesis knowledge base. Return only valid JSON. Do not invent bibliographic details that are missing from the text; use '未识别' when uncertain.",
      },
      {
        role: "user",
        content: `Create a Chinese-first knowledge card for this paper. The thesis project is about VR subway evacuation wayfinding, EEG cognitive load, Unity marker streams, signage density/design, and mixed-effects analysis.\n\nFilename: ${document.filename}\nMIME: ${document.mime_type ?? "unknown"}\nExtracted text:\n${textForModel || "(No text could be extracted; use only filename and state limitations.)"}\n\nReturn JSON with exactly these keys: title, citation, researchQuestion, methods, participants, taskAndMaterials, eegOrMeasures, keyFindings, limitations, relevanceToMetroRescue, usableForSections, keywords, evidenceLevel. Arrays must be arrays of short Chinese strings.`,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "literature_knowledge_card",
        schema: {
          type: "object",
          additionalProperties: false,
          required: [
            "title",
            "citation",
            "researchQuestion",
            "methods",
            "participants",
            "taskAndMaterials",
            "eegOrMeasures",
            "keyFindings",
            "limitations",
            "relevanceToMetroRescue",
            "usableForSections",
            "keywords",
            "evidenceLevel",
          ],
          properties: {
            title: { type: "string" },
            citation: { type: "string" },
            researchQuestion: { type: "string" },
            methods: { type: "string" },
            participants: { type: "string" },
            taskAndMaterials: { type: "string" },
            eegOrMeasures: { type: "string" },
            keyFindings: { type: "array", items: { type: "string" } },
            limitations: { type: "array", items: { type: "string" } },
            relevanceToMetroRescue: { type: "array", items: { type: "string" } },
            usableForSections: { type: "array", items: { type: "string" } },
            keywords: { type: "array", items: { type: "string" } },
            evidenceLevel: { type: "string" },
          },
        },
      },
    },
  });

  const raw = JSON.parse(response.output_text) as Omit<LiteratureKnowledgeCard, "version" | "documentId" | "filename" | "createdAt">;
  return {
    version: 1,
    documentId: document.id,
    filename: document.filename,
    createdAt: new Date().toISOString(),
    ...raw,
  };
}

function sanitizeExtractedText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}
