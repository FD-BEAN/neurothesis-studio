import OpenAI from "openai";
import { NextResponse } from "next/server";
import { getSeedKnowledgeReview, getSeedKnowledgeStats } from "@/lib/knowledgeBase";
import { encodeLiteratureCard, isLiteratureDocument, parseLiteratureCard, type LiteratureKnowledgeCard } from "@/lib/literature";
import { getSupabaseServerClient, type ResearchDocument } from "@/lib/supabase";

type RequestBody = {
  documentId?: string;
};

const MAX_EXTRACTED_CHARS = 120_000;
const DIRECT_CARD_CHARS = 42_000;
const CHUNK_CHARS = 18_000;
const CHUNK_OVERLAP = 1_500;
const MAX_DIGEST_CHUNKS = 8;

type LiteratureChunkDigest = {
  sectionGuess: string;
  methodsEvidence: string[];
  measuresEvidence: string[];
  findingsEvidence: string[];
  limitationsEvidence: string[];
  metroRescueRelevance: string[];
  quoteAnchors: string[];
};

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
    seedStats: getSeedKnowledgeStats(),
    seedReview: getSeedKnowledgeReview(),
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
    const { PDFParse } = (await import("pdf-parse")) as unknown as {
      PDFParse: new (options: { data: Buffer }) => {
        getText(options?: { first?: number; last?: number }): Promise<{ text?: string }>;
        destroy(): Promise<void>;
      };
    };
    const parser = new PDFParse({ data: buffer });
    try {
      const parsed = await parser.getText();
      return sanitizeExtractedText(parsed.text ?? "");
    } finally {
      await parser.destroy();
    }
  }

  if (["txt", "md"].includes(extension)) {
    return sanitizeExtractedText(await fileBlob.text());
  }

  return "";
}

async function buildKnowledgeCard(apiKey: string, document: ResearchDocument, extractedText: string): Promise<LiteratureKnowledgeCard> {
  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
  const normalizedText = extractedText.slice(0, MAX_EXTRACTED_CHARS);
  const chunkDigests = normalizedText.length > DIRECT_CARD_CHARS ? await buildChunkDigests(client, model, document, normalizedText) : [];
  const finalInput = buildFinalLiteratureInput(document, normalizedText, chunkDigests);

  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          "You build structured bilingual literature knowledge cards for a thesis knowledge base. Return only valid JSON. Do not invent bibliographic details, page numbers, results, effect sizes, or quotations that are missing from the text; use '未识别' when uncertain. Be conservative, separate literature evidence from project hypotheses, and include boundaries under doNotClaim.",
      },
      {
        role: "user",
        content: finalInput,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "literature_knowledge_card",
        schema: literatureCardSchema(),
      },
    },
  });

  const raw = JSON.parse(response.output_text) as Omit<LiteratureKnowledgeCard, "version" | "documentId" | "filename" | "createdAt" | "extractionMeta">;
  return {
    version: 3,
    documentId: document.id,
    filename: document.filename,
    createdAt: new Date().toISOString(),
    extractionMeta: {
      extractedChars: normalizedText.length,
      digestChunks: chunkDigests.length,
      warning: normalizedText ? (extractedText.length > MAX_EXTRACTED_CHARS ? "文本超过上限，已截取并分段摘要。" : "") : "未能提取正文；卡片主要基于文件名，不能作为证据使用。",
    },
    ...raw,
  };
}

async function buildChunkDigests(
  client: OpenAI,
  model: string,
  document: ResearchDocument,
  extractedText: string,
): Promise<LiteratureChunkDigest[]> {
  const chunks = sampleTextChunks(extractedText, CHUNK_CHARS, CHUNK_OVERLAP, MAX_DIGEST_CHUNKS);
  const digests: LiteratureChunkDigest[] = [];

  for (const [index, chunk] of chunks.entries()) {
    const response = await client.responses.create({
      model,
      input: [
        {
          role: "system",
          content:
            "You extract conservative evidence from one chunk of an academic paper for a thesis knowledge base. Return only valid JSON. Do not infer beyond this chunk; use empty arrays when evidence is absent.",
        },
        {
          role: "user",
          content: `Paper filename: ${document.filename}\nChunk ${index + 1}/${chunks.length}.\n\nProject lens: VR subway evacuation wayfinding, signage density, EEG cognitive load, Unity/LabRecorder markers, within-subject density contrast medium vs low/high.\n\nExtract evidence from this chunk only. Prefer Chinese summaries with English technical terms preserved.\n\nChunk text:\n${chunk}`,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "literature_chunk_digest",
          schema: {
            type: "object",
            additionalProperties: false,
            required: [
              "sectionGuess",
              "methodsEvidence",
              "measuresEvidence",
              "findingsEvidence",
              "limitationsEvidence",
              "metroRescueRelevance",
              "quoteAnchors",
            ],
            properties: {
              sectionGuess: { type: "string" },
              methodsEvidence: { type: "array", items: { type: "string" } },
              measuresEvidence: { type: "array", items: { type: "string" } },
              findingsEvidence: { type: "array", items: { type: "string" } },
              limitationsEvidence: { type: "array", items: { type: "string" } },
              metroRescueRelevance: { type: "array", items: { type: "string" } },
              quoteAnchors: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    });

    digests.push(JSON.parse(response.output_text) as LiteratureChunkDigest);
  }

  return digests;
}

function buildFinalLiteratureInput(document: ResearchDocument, extractedText: string, digests: LiteratureChunkDigest[]) {
  const directText = extractedText.slice(0, DIRECT_CARD_CHARS);
  const trailingText = extractedText.length > DIRECT_CARD_CHARS ? extractedText.slice(-10_000) : "";
  const digestBlock = digests.length ? JSON.stringify(digests, null, 2) : "[]";

  return `Create a Chinese-first, bilingual-friendly knowledge card for this paper, following the Metro Rescue source-card logic: extract what the paper can support, where it can be used, what must not be overclaimed, and which quote/page anchors need later verification.

Thesis project context:
- Topic: VR subway evacuation wayfinding, signage density/design, EEG cognitive load, Unity marker streams, LabRecorder .xdf synchronization.
- Current primary hypothesis: medium signage/scene density may create the highest cognitive load; formal contrast is medium - mean(low, high).
- Analysis route: within-subject density factor, subject-level contrasts, and later mixed-effects models with possible between-subject metadata.

Evidence rules:
- Do not turn this thesis hypothesis into a finding from the paper unless the paper directly tested it.
- Preserve English technical terms in parentheses where helpful.
- Use concise Chinese for dashboard display.
- If bibliographic details, sample size, measures, or results are unclear, write 未识别.
- candidateClaims must be claims that can be cautiously supported by this paper for the thesis, not invented conclusions.
- quoteAnchorsToVerify should be short source phrases or section/page targets that the human should verify before final citation.

Filename: ${document.filename}
MIME: ${document.mime_type ?? "unknown"}
Extracted chars used: ${extractedText.length}

Chunk-level evidence digest:
${digestBlock}

Primary extracted text excerpt:
${directText || "(No text could be extracted; use only filename and state limitations.)"}

Trailing excerpt, often references/discussion/limitations:
${trailingText || "(No trailing excerpt.)"}

Return JSON with exactly these keys: title, citation, paperType, oneSentenceTakeaway, abstractZh, abstractEn, researchQuestion, methods, participants, taskAndMaterials, eegOrMeasures, keyFindings, limitations, relevanceToMetroRescue, usableForSections, keywords, evidenceLevel, sourceGrade, themeTags, doNotClaim, candidateClaims, quoteAnchorsToVerify, theoryOrMechanism, variablesAndMeasures, densityHypothesisRelevance, methodsWritingUse, resultsDiscussionUse, qualityCaveats. Arrays must be arrays of short Chinese strings. sourceGrade should be A/B/C/未识别 based on relevance and evidence strength for this thesis, not journal prestige.`;
}

function literatureCardSchema() {
  const stringArray = { type: "array", items: { type: "string" } };
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "title",
      "citation",
      "paperType",
      "oneSentenceTakeaway",
      "abstractZh",
      "abstractEn",
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
      "sourceGrade",
      "themeTags",
      "doNotClaim",
      "candidateClaims",
      "quoteAnchorsToVerify",
      "theoryOrMechanism",
      "variablesAndMeasures",
      "densityHypothesisRelevance",
      "methodsWritingUse",
      "resultsDiscussionUse",
      "qualityCaveats",
    ],
    properties: {
      title: { type: "string" },
      citation: { type: "string" },
      paperType: { type: "string" },
      oneSentenceTakeaway: { type: "string" },
      abstractZh: { type: "string" },
      abstractEn: { type: "string" },
      researchQuestion: { type: "string" },
      methods: { type: "string" },
      participants: { type: "string" },
      taskAndMaterials: { type: "string" },
      eegOrMeasures: { type: "string" },
      keyFindings: stringArray,
      limitations: stringArray,
      relevanceToMetroRescue: stringArray,
      usableForSections: stringArray,
      keywords: stringArray,
      evidenceLevel: { type: "string" },
      sourceGrade: { type: "string" },
      themeTags: stringArray,
      doNotClaim: stringArray,
      candidateClaims: stringArray,
      quoteAnchorsToVerify: stringArray,
      theoryOrMechanism: stringArray,
      variablesAndMeasures: stringArray,
      densityHypothesisRelevance: stringArray,
      methodsWritingUse: stringArray,
      resultsDiscussionUse: stringArray,
      qualityCaveats: stringArray,
    },
  };
}

function sampleTextChunks(text: string, chunkSize: number, overlap: number, maxChunks: number) {
  if (text.length <= chunkSize) return [text];
  const chunks: string[] = [];
  const step = Math.max(1, chunkSize - overlap);
  for (let start = 0; start < text.length; start += step) {
    chunks.push(text.slice(start, start + chunkSize));
  }
  if (chunks.length <= maxChunks) return chunks;

  const selected = new Map<number, string>();
  selected.set(0, chunks[0]);
  selected.set(1, chunks[1] ?? chunks[0]);
  selected.set(chunks.length - 2, chunks[chunks.length - 2]);
  selected.set(chunks.length - 1, chunks[chunks.length - 1]);

  const remainingSlots = Math.max(0, maxChunks - selected.size);
  for (let i = 0; i < remainingSlots; i += 1) {
    const index = Math.round(((i + 1) * (chunks.length - 1)) / (remainingSlots + 1));
    selected.set(index, chunks[index]);
  }

  return Array.from(selected.entries())
    .sort((a, b) => a[0] - b[0])
    .map((entry) => entry[1]);
}

function sanitizeExtractedText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}
