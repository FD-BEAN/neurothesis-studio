import type { ResearchDocument } from "@/lib/supabase";

export const LITERATURE_CARD_PREFIX = "NT_KB_V1::";

export type LiteratureKnowledgeCard = {
  version: 1 | 2;
  documentId: string;
  filename: string;
  title: string;
  citation: string;
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
  createdAt: string;
};

export function encodeLiteratureCard(card: LiteratureKnowledgeCard) {
  return `${LITERATURE_CARD_PREFIX}${JSON.stringify(card)}`;
}

export function parseLiteratureCard(notes: string | null | undefined): LiteratureKnowledgeCard | null {
  if (!notes?.startsWith(LITERATURE_CARD_PREFIX)) return null;
  try {
    const parsed = JSON.parse(notes.slice(LITERATURE_CARD_PREFIX.length)) as LiteratureKnowledgeCard;
    return parsed?.version === 1 || parsed?.version === 2 ? parsed : null;
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
