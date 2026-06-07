import type { ResearchDocument } from "@/lib/supabase";

export const LITERATURE_CARD_PREFIX = "NT_KB_V1::";
export const IMPORTED_PDF_PREFIX = "IMPORTED_PDF_V1::";

export type ImportedPdfMetadata = {
  originalFilename?: string;
  extractedTitle?: string;
  titleSource?: string;
  sha256?: string;
  importedAt?: string;
};

export type LiteraturePaperDossier = {
  verdict: string;
  problem: string;
  motivation: string;
  design: {
    overview: string;
    sample: string;
    task: string;
    variables: string[];
    measures: string[];
    analysis: string;
  };
  findings: string[];
  credibility: string;
  thesisRelevance: string;
};

export type LiteratureThesisWritingMap = {
  relationType: string;
  frameworkRole: string;
  constructs: Array<{
    construct: string;
    support: string;
    use: string;
    caution: string;
  }>;
  chapterUses: string[];
  writingBlocks: Array<{
    section: string;
    purpose: string;
    draft: string;
  }>;
  overclaimWarnings: string[];
  verificationTasks: string[];
};

export type LiteratureSinglePaperKnowledgeSystem = {
  coreContribution: string;
  constructLinks: Array<{
    construct: string;
    evidence: string;
    thesisUse: string;
    caution: string;
  }>;
  evidenceUnits: Array<{
    topic: string;
    evidence: string;
    paperLocation: string;
    thesisUse: string;
    limitation: string;
  }>;
  thesisClaims: Array<{
    claim: string;
    supportLevel: string;
    useInSection: string;
    mustVerify: string;
  }>;
  verificationChecklist: string[];
  openQuestions: string[];
};

export type LiteratureKnowledgeCard = {
  version: 1 | 2 | 3 | 4;
  documentId: string;
  filename: string;
  title: string;
  citation: string;
  paperType?: string;
  oneSentenceTakeaway?: string;
  abstractZh?: string;
  abstractEn?: string;
  researchQuestion: string;
  methods: string;
  participants: string;
  taskAndMaterials: string;
  eegOrMeasures: string;
  keyFindings: string[];
  limitations: string[];
  relevanceToMetroRescue: string[];
  usableForSections: string[];
  keywords: string[];
  evidenceLevel: string;
  sourceGrade?: string;
  themeTags?: string[];
  doNotClaim?: string[];
  candidateClaims?: string[];
  quoteAnchorsToVerify?: string[];
  theoryOrMechanism?: string[];
  variablesAndMeasures?: string[];
  densityHypothesisRelevance?: string[];
  methodsWritingUse?: string[];
  resultsDiscussionUse?: string[];
  qualityCaveats?: string[];
  paperDossier?: LiteraturePaperDossier;
  thesisWritingMap?: LiteratureThesisWritingMap;
  singlePaperKnowledgeSystem?: LiteratureSinglePaperKnowledgeSystem;
  extractionMeta?: {
    extractedChars: number;
    digestChunks: number;
    warning: string;
  };
  createdAt: string;
};

export function encodeLiteratureCard(card: LiteratureKnowledgeCard) {
  return `${LITERATURE_CARD_PREFIX}${JSON.stringify(card)}`;
}

export function parseLiteratureCard(notes: string | null | undefined): LiteratureKnowledgeCard | null {
  if (!notes?.startsWith(LITERATURE_CARD_PREFIX)) return null;
  try {
    const parsed = JSON.parse(notes.slice(LITERATURE_CARD_PREFIX.length)) as LiteratureKnowledgeCard;
    return parsed?.version === 1 || parsed?.version === 2 || parsed?.version === 3 || parsed?.version === 4 ? parsed : null;
  } catch {
    return null;
  }
}

export function parseImportedPdfMetadata(notes: string | null | undefined): ImportedPdfMetadata | null {
  if (!notes?.startsWith(IMPORTED_PDF_PREFIX)) return null;
  try {
    const parsed = JSON.parse(notes.slice(IMPORTED_PDF_PREFIX.length)) as Record<string, unknown>;
    return {
      originalFilename: typeof parsed.originalFilename === "string" ? parsed.originalFilename : undefined,
      extractedTitle: typeof parsed.extractedTitle === "string" ? parsed.extractedTitle : undefined,
      titleSource: typeof parsed.titleSource === "string" ? parsed.titleSource : undefined,
      sha256: typeof parsed.sha256 === "string" ? parsed.sha256 : undefined,
      importedAt: typeof parsed.importedAt === "string" ? parsed.importedAt : undefined,
    };
  } catch {
    return null;
  }
}

export function isLiteratureDocument(document: Pick<ResearchDocument, "filename" | "mime_type">) {
  const extension = getDocumentExtension(document.filename);
  return ["pdf", "doc", "docx", "md", "txt"].includes(extension) || Boolean(document.mime_type?.includes("pdf"));
}

export function getDocumentExtension(filename: string) {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex >= 0 ? filename.slice(dotIndex + 1).toLowerCase() : "";
}
