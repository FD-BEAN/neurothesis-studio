export type DensityLevel = "low" | "medium" | "high";

export const densityLevels: DensityLevel[] = ["low", "medium", "high"];

export const densityLabels: Record<DensityLevel, string> = {
  low: "低密度",
  medium: "中密度",
  high: "高密度",
};

const tripletDensityByPosition: Record<number, DensityLevel> = {
  1: "low",
  2: "medium",
  3: "high",
};

function formatParticipantGroupId(index: number) {
  return `P${String(index).padStart(2, "0")}`;
}

export function inferXdfSequenceIndex(filename: string) {
  const bidsMatch = filename.match(/(?:^|[_-])sub-?p?0*(\d{1,4})(?=[^0-9]|$)/i) ?? filename.match(/^sub-?p?0*(\d{1,4})(?=[^0-9]|$)/i);
  if (bidsMatch?.[1]) {
    const value = Number(bidsMatch[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }

  const participantMatch = filename.match(/(?:subject|subj|participant|participant-id|p)[-_]?0*(\d{1,4})(?=[^0-9]|$)/i);
  if (participantMatch?.[1]) {
    const value = Number(participantMatch[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }

  return null;
}

export function inferXdfTripletSubjectIndex(filename: string) {
  const sequenceIndex = inferXdfSequenceIndex(filename);
  return sequenceIndex ? Math.ceil(sequenceIndex / 3) : null;
}

export function inferXdfRunPosition(filename: string) {
  const sequenceIndex = inferXdfSequenceIndex(filename);
  return sequenceIndex ? ((sequenceIndex - 1) % 3) + 1 : null;
}

export function inferXdfSubjectId(filename: string) {
  const tripletSubjectIndex = inferXdfTripletSubjectIndex(filename);
  if (tripletSubjectIndex) return formatParticipantGroupId(tripletSubjectIndex);

  const bidsMatch = filename.match(/sub-([A-Za-z0-9]+)/i);
  if (bidsMatch?.[1]) return `sub-${bidsMatch[1]}`;
  const subjectMatch = filename.match(/(?:^|[^a-z0-9])(?:subject|subj|participant)[-_]?([A-Za-z0-9]+)/i);
  if (subjectMatch?.[1]) return `sub-${subjectMatch[1]}`;
  const compactParticipantMatch = filename.match(/(?:^|[^a-z0-9])p[-_]?0*(\d{1,4})(?=[^0-9]|$)/i);
  if (compactParticipantMatch?.[1]) return formatParticipantGroupId(Number(compactParticipantMatch[1]));
  return "subject-unknown";
}

export function inferXdfRunLabel(filename: string) {
  const sequenceIndex = inferXdfSequenceIndex(filename);
  const runPosition = inferXdfRunPosition(filename);
  if (sequenceIndex && runPosition) {
    return `file-${String(sequenceIndex).padStart(3, "0")} / condition-${runPosition}`;
  }

  const runMatch = filename.match(/run-([A-Za-z0-9]+)/i);
  if (runMatch?.[1]) return `run-${runMatch[1]}`;
  const signatureMatch = filename.match(/signature[-_]?([A-Za-z0-9]+)/i);
  if (signatureMatch?.[1]) return `signature-${signatureMatch[1]}`;
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex >= 0 ? filename.slice(dotIndex + 1).toUpperCase() : "FILE";
}

export function inferXdfDensityLevel(filename: string): DensityLevel | null {
  const normalized = filename.toLowerCase().replace(/_/g, "-");

  if (/signature[-\s_]?2\b/.test(normalized)) return "medium";
  if (/signature[-\s_]?1\b/.test(normalized)) return "low";
  if (/signature[-\s_]?3\b/.test(normalized)) return "high";

  if (/中等?密度|中密度|medium[-\s_]?density|density[-\s_]?medium|density[-\s_]?mid|condition[-\s_]?medium|level[-\s_]?2/.test(normalized)) {
    return "medium";
  }
  if (/低密度|low[-\s_]?density|density[-\s_]?low|condition[-\s_]?low|level[-\s_]?1/.test(normalized)) {
    return "low";
  }
  if (/高密度|high[-\s_]?density|density[-\s_]?high|condition[-\s_]?high|level[-\s_]?3/.test(normalized)) {
    return "high";
  }

  const tokens = new Set(normalized.match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) ?? []);
  if (["medium", "mid", "med", "middle", "中", "中等"].some((token) => tokens.has(token))) return "medium";
  if (["low", "lo", "sparse", "light", "低"].some((token) => tokens.has(token))) return "low";
  if (["high", "hi", "dense", "heavy", "高"].some((token) => tokens.has(token))) return "high";

  const runPosition = inferXdfRunPosition(filename);
  return runPosition ? tripletDensityByPosition[runPosition] : null;
}

export function compareXdfConditionNames(a: string, b: string) {
  const densityA = inferXdfDensityLevel(a);
  const densityB = inferXdfDensityLevel(b);
  const densityIndexA = densityA ? densityLevels.indexOf(densityA) : densityLevels.length;
  const densityIndexB = densityB ? densityLevels.indexOf(densityB) : densityLevels.length;
  if (densityIndexA !== densityIndexB) return densityIndexA - densityIndexB;

  const sequenceA = inferXdfSequenceIndex(a) ?? Number.MAX_SAFE_INTEGER;
  const sequenceB = inferXdfSequenceIndex(b) ?? Number.MAX_SAFE_INTEGER;
  if (sequenceA !== sequenceB) return sequenceA - sequenceB;

  return inferXdfRunLabel(a).localeCompare(inferXdfRunLabel(b));
}
