import OpenAI from "openai";
import { NextResponse } from "next/server";
import { findSeedLiteratureMatch, getSeedKnowledgeReview } from "@/lib/knowledgeBase";
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

type PdfJsTextItem = {
  str?: string;
  hasEOL?: boolean;
};

type PdfJsDocument = {
  numPages: number;
  getPage(pageNumber: number): Promise<{
    getTextContent(options?: { includeMarkedContent?: boolean; disableNormalization?: boolean }): Promise<{ items: PdfJsTextItem[] }>;
    cleanup(): void;
  }>;
  destroy(): Promise<void>;
};

type PdfJsModule = {
  getDocument(options: {
    data: Uint8Array;
    isEvalSupported: false;
    useWorkerFetch: false;
  }): { promise: Promise<PdfJsDocument> };
};

type PdfJsWorkerModule = {
  WorkerMessageHandler: unknown;
};

class PdfDomMatrixPolyfill {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  is2D = true;

  constructor(init?: string | number[]) {
    if (Array.isArray(init)) {
      this.a = Number(init[0] ?? 1);
      this.b = Number(init[1] ?? 0);
      this.c = Number(init[2] ?? 0);
      this.d = Number(init[3] ?? 1);
      this.e = Number(init[4] ?? 0);
      this.f = Number(init[5] ?? 0);
    }
  }

  static fromFloat32Array(array32: Float32Array) {
    return new PdfDomMatrixPolyfill(Array.from(array32));
  }

  static fromFloat64Array(array64: Float64Array) {
    return new PdfDomMatrixPolyfill(Array.from(array64));
  }

  static fromMatrix(other?: { a?: number; b?: number; c?: number; d?: number; e?: number; f?: number }) {
    return new PdfDomMatrixPolyfill([other?.a ?? 1, other?.b ?? 0, other?.c ?? 0, other?.d ?? 1, other?.e ?? 0, other?.f ?? 0]);
  }

  get isIdentity() {
    return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0;
  }

  multiplySelf(other?: PdfDomMatrixPolyfill) {
    if (!other) return this;
    const a = this.a * other.a + this.c * other.b;
    const b = this.b * other.a + this.d * other.b;
    const c = this.a * other.c + this.c * other.d;
    const d = this.b * other.c + this.d * other.d;
    const e = this.a * other.e + this.c * other.f + this.e;
    const f = this.b * other.e + this.d * other.f + this.f;
    Object.assign(this, { a, b, c, d, e, f });
    return this;
  }

  preMultiplySelf(other?: PdfDomMatrixPolyfill) {
    return other ? Object.assign(this, new PdfDomMatrixPolyfill([other.a, other.b, other.c, other.d, other.e, other.f]).multiplySelf(this)) : this;
  }

  translateSelf(tx = 0, ty = 0) {
    this.e += tx;
    this.f += ty;
    return this;
  }

  scaleSelf(scaleX = 1, scaleY = scaleX) {
    this.a *= scaleX;
    this.d *= scaleY;
    return this;
  }

  rotateSelf() {
    return this;
  }

  invertSelf() {
    const determinant = this.a * this.d - this.b * this.c;
    if (!determinant) return this;
    const a = this.d / determinant;
    const b = -this.b / determinant;
    const c = -this.c / determinant;
    const d = this.a / determinant;
    const e = (this.c * this.f - this.d * this.e) / determinant;
    const f = (this.b * this.e - this.a * this.f) / determinant;
    Object.assign(this, { a, b, c, d, e, f });
    return this;
  }

  transformPoint(point: { x?: number; y?: number }) {
    const x = Number(point.x ?? 0);
    const y = Number(point.y ?? 0);
    return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f, z: 0, w: 1 };
  }

  toFloat32Array() {
    return Float32Array.from([this.a, this.b, 0, 0, this.c, this.d, 0, 0, 0, 0, 1, 0, this.e, this.f, 0, 1]);
  }

  toFloat64Array() {
    return Float64Array.from(this.toFloat32Array());
  }
}

class PdfImageDataPolyfill {
  colorSpace = "srgb";

  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}

class PdfPath2DPolyfill {}

function installPdfNodePolyfills() {
  const scope = globalThis as unknown as {
    DOMMatrix?: unknown;
    ImageData?: unknown;
    Path2D?: unknown;
  };

  scope.DOMMatrix ??= PdfDomMatrixPolyfill;
  scope.ImageData ??= PdfImageDataPolyfill;
  scope.Path2D ??= PdfPath2DPolyfill;
}

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
  return NextResponse.json(
    {
      seedReview: getSeedKnowledgeReview(),
      cards: documents.map((document) => ({
        document,
        card: parseLiteratureCard(document.notes),
        seedMatch: findSeedLiteratureMatch(document),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
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

  const existingCard = parseLiteratureCard(researchDocument.notes);
  if (existingCard) {
    return NextResponse.json({
      card: existingCard,
      status: "existing-card",
      message: "这篇文献已经有知识卡片，不会重复调用 OpenAI。",
    });
  }

  const seedMatch = findSeedLiteratureMatch(researchDocument);
  if (seedMatch) {
    return NextResponse.json({
      seedMatch,
      status: "seed-existing",
      message: `这篇文献已入库（${seedMatch.sourceId}：${seedMatch.title}），不会重复调用 OpenAI。`,
    });
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

  return NextResponse.json({
    card,
    status: "created-card",
    message: "文献知识卡片已更新，写作助手会优先引用知识库。",
  });
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
    return sanitizeExtractedText(await extractPdfTextWithoutWorker(buffer));
  }

  if (["txt", "md"].includes(extension)) {
    return sanitizeExtractedText(await fileBlob.text());
  }

  return "";
}

async function extractPdfTextWithoutWorker(buffer: Buffer) {
  installPdfNodePolyfills();
  const [pdfjs, pdfWorker] = (await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.mjs"),
  ])) as unknown as [PdfJsModule, PdfJsWorkerModule];
  const scope = globalThis as unknown as { pdfjsWorker?: { WorkerMessageHandler?: unknown } };
  scope.pdfjsWorker = { WorkerMessageHandler: pdfWorker.WorkerMessageHandler };

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useWorkerFetch: false,
  });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      try {
        const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
        const parts: string[] = [];
        for (const item of content.items) {
          if (!item.str) continue;
          parts.push(item.str);
          parts.push(item.hasEOL ? "\n" : " ");
        }
        pages.push(parts.join(""));
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await pdf.destroy();
  }

  return pages.join("\n\n");
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
