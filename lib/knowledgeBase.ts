import seedKnowledgeBase from "@/lib/metro_rescue_seed_kb.json";
import type { LiteratureKnowledgeCard } from "@/lib/literature";

type SeedKnowledgeBase = typeof seedKnowledgeBase;
type SeedSource = SeedKnowledgeBase["sources"][number];

type ScoredItem<T> = {
  item: T;
  score: number;
};

const SOURCE_ID_PATTERN = /S\d{3}/g;

export function buildResearchKnowledgeContext(prompt: string, userCards: LiteratureKnowledgeCard[]) {
  const seedContext = buildSeedContext(prompt);
  const userContext = buildUserLiteratureContext(userCards, prompt);

  return [
    "=== Built-in Metro Rescue literature knowledge base ===",
    seedContext,
    "",
    "=== User-added literature cards ===",
    userContext,
    "",
    "Usage rule: distinguish seed literature evidence, user-added literature evidence, and the user's own experimental results. Treat project hypotheses and writing blocks as drafting aids, not proven findings.",
  ].join("\n");
}

export function getSeedKnowledgeStats() {
  return {
    sources: seedKnowledgeBase.sources.length,
    claims: seedKnowledgeBase.claims.length,
    mechanisms: seedKnowledgeBase.mechanisms.length,
    hypotheses: seedKnowledgeBase.hypotheses.length,
    analysisModels: seedKnowledgeBase.analysis_models.length,
    dataTables: seedKnowledgeBase.data_tables.length,
    risksAndFixes: seedKnowledgeBase.risks_and_fixes.length,
    writingBlocks: seedKnowledgeBase.writing_blocks.length,
    quoteAnchors: seedKnowledgeBase.quote_anchors.length,
  };
}

function buildSeedContext(prompt: string) {
  const claims = rankItems(seedKnowledgeBase.claims, prompt, (item) =>
    [item.Claim_ID, item.Type, item.Claim, item.Sources, item.Thesis_Section, item.How_to_use].join(" "),
  ).slice(0, 10);

  const mechanisms = rankItems(seedKnowledgeBase.mechanisms, prompt, (item) =>
    [item.Mechanism_ID, item.Mechanism, item.Plain_Explanation, item.Metro_Variables, item.Sources, item.Analysis_Implication].join(" "),
  ).slice(0, 5);

  const hypotheses = rankItems(seedKnowledgeBase.hypotheses, prompt, (item) =>
    [item.Hypothesis_ID, item.Hypothesis, item.Prediction, item.Data_Table, item.Model_Formula, item.Sources, item.Note].join(" "),
  ).slice(0, 5);

  const analysisModels = rankItems(seedKnowledgeBase.analysis_models, prompt, (item) =>
    [item.Model_ID, item.Purpose, item.Data_Table, item.Model_Formula, item.Interpretation].join(" "),
  ).slice(0, 5);

  const dataTables = rankItems(seedKnowledgeBase.data_tables, prompt, (item) =>
    [item.Table, item.Unit, item.Key_Fields, item.Purpose].join(" "),
  ).slice(0, 5);

  const risks = rankItems(seedKnowledgeBase.risks_and_fixes, prompt, (item) =>
    [item.Risk_ID, item.Risk, item.Why_it_matters, item.Fix, item.Sources].join(" "),
  ).slice(0, 4);

  const writingBlocks = rankItems(seedKnowledgeBase.writing_blocks, prompt, (item) =>
    [item.Block_ID, item.Use, item.Draft_Text].join(" "),
  ).slice(0, 4);

  const qa = rankItems(seedKnowledgeBase.qa, prompt, (item) =>
    [item.Question_ID, item.Question, item.Answer, item.Sources].join(" "),
  ).slice(0, 4);

  const sourceIds = new Set<string>();
  for (const scored of [...claims, ...mechanisms, ...hypotheses, ...qa]) {
    for (const sourceId of getSourceIds(JSON.stringify(scored.item))) {
      sourceIds.add(sourceId);
    }
  }

  const sourceCards = getRelevantSources(prompt, sourceIds).slice(0, 12);
  const quoteAnchors = seedKnowledgeBase.quote_anchors.filter((anchor) => sourceIds.has(anchor.Source_ID)).slice(0, 8);

  return [
    `Seed KB: ${seedKnowledgeBase.sources.length} source cards, ${seedKnowledgeBase.claims.length} claims, ${seedKnowledgeBase.mechanisms.length} mechanisms, ${seedKnowledgeBase.hypotheses.length} hypotheses, ${seedKnowledgeBase.analysis_models.length} analysis models.`,
    `Integrity notes: ${seedKnowledgeBase.integrity_notes.join(" ")}`,
    formatSeedSection(
      "Relevant claims",
      claims,
      (item) => `${item.Claim_ID} (${item.Thesis_Section}): ${item.Claim} Sources: ${item.Sources}. Use: ${item.How_to_use}`,
    ),
    formatSeedSection(
      "Mechanisms",
      mechanisms,
      (item) => `${item.Mechanism_ID} ${item.Mechanism}: ${item.Plain_Explanation} Variables: ${item.Metro_Variables}. Implication: ${item.Analysis_Implication}. Sources: ${item.Sources}`,
    ),
    formatSeedSection(
      "Hypotheses",
      hypotheses,
      (item) => `${item.Hypothesis_ID} ${item.Hypothesis}: ${item.Prediction} Table: ${item.Data_Table}. Model: ${item.Model_Formula}. Sources: ${item.Sources}. Note: ${item.Note}`,
    ),
    formatSeedSection(
      "Analysis models",
      analysisModels,
      (item) => `${item.Model_ID} ${item.Purpose}: ${item.Model_Formula}. Table: ${item.Data_Table}. Interpretation: ${item.Interpretation}`,
    ),
    formatSeedSection(
      "Required data tables",
      dataTables,
      (item) => `${item.Table}: unit=${item.Unit}; fields=${item.Key_Fields}; purpose=${item.Purpose}`,
    ),
    formatSeedSection(
      "Risks and fixes",
      risks,
      (item) => `${item.Risk_ID} ${item.Risk}: ${item.Why_it_matters} Fix: ${item.Fix}. Sources: ${item.Sources}`,
    ),
    formatSeedSection(
      "Writing blocks",
      writingBlocks,
      (item) => `${item.Block_ID} ${item.Use}: ${item.Draft_Text}`,
    ),
    formatSeedSection(
      "Defense QA",
      qa,
      (item) => `${item.Question_ID}: ${item.Question} Answer: ${item.Answer} Sources: ${item.Sources}`,
    ),
    sourceCards.length
      ? ["Source cards", ...sourceCards.map(formatSourceCard)].join("\n")
      : "Source cards\n- No source cards selected.",
    quoteAnchors.length
      ? ["Quote anchors requiring page verification", ...quoteAnchors.map((anchor) => `- ${anchor.Source_ID} ${anchor.Page_Target}: ${anchor.Short_Original_Anchor}. Use: ${anchor.Use}. Task: ${anchor.Task}`)].join("\n")
      : "Quote anchors requiring page verification\n- No quote anchors selected for this query.",
  ].join("\n\n");
}

function buildUserLiteratureContext(cards: LiteratureKnowledgeCard[], prompt: string) {
  if (!cards.length) {
    return "No user-added indexed literature cards yet. Use the built-in seed KB, and ask the user to generate knowledge cards for newly uploaded papers before relying on them.";
  }

  return rankItems(cards, prompt, (card) =>
    [
      card.title,
      card.filename,
      card.citation,
      card.researchQuestion,
      card.methods,
      card.eegOrMeasures,
      card.keyFindings.join(" "),
      card.limitations.join(" "),
      card.relevanceToMetroRescue.join(" "),
      card.usableForSections.join(" "),
      card.keywords.join(" "),
      card.sourceGrade ?? "",
      card.themeTags?.join(" ") ?? "",
      card.doNotClaim?.join(" ") ?? "",
      card.candidateClaims?.join(" ") ?? "",
      card.quoteAnchorsToVerify?.join(" ") ?? "",
    ].join(" "),
  )
    .slice(0, 12)
    .map(({ item: card }, index) =>
      [
        `[U${index + 1}] ${card.title || card.filename}`,
        `Filename: ${card.filename}`,
        `Citation: ${card.citation}`,
        `Research question: ${card.researchQuestion}`,
        `Methods: ${card.methods}`,
        `Measures: ${card.eegOrMeasures}`,
        `Key findings: ${card.keyFindings.join("；")}`,
        `Limitations: ${card.limitations.join("；")}`,
        `Use for Metro Rescue: ${card.relevanceToMetroRescue.join("；")}`,
        `Source grade: ${card.sourceGrade ?? card.evidenceLevel}`,
        `Theme tags: ${card.themeTags?.join("；") ?? card.keywords.join("；")}`,
        `Candidate claims: ${card.candidateClaims?.join("；") ?? "未生成"}`,
        `Do not claim: ${card.doNotClaim?.join("；") ?? "未生成"}`,
        `Quote anchors to verify: ${card.quoteAnchorsToVerify?.join("；") ?? "未生成"}`,
      ].join("\n"),
    )
    .join("\n\n");
}

function rankItems<T>(items: T[], prompt: string, toText: (item: T) => string): Array<ScoredItem<T>> {
  const queryTokens = tokenize(prompt);

  return items
    .map((item) => {
      const text = toText(item).toLowerCase();
      const score = queryTokens.reduce((total, token) => total + (text.includes(token) ? token.length : 0), 0);
      return { item, score };
    })
    .sort((a, b) => b.score - a.score);
}

function getRelevantSources(prompt: string, sourceIds: Set<string>) {
  const byId = new Map(seedKnowledgeBase.sources.map((source) => [source.Source_ID, source]));
  const citedSources = Array.from(sourceIds)
    .map((sourceId) => byId.get(sourceId))
    .filter((source): source is SeedSource => Boolean(source));
  const rankedSources = rankItems(seedKnowledgeBase.sources, prompt, (source) =>
    [
      source.Source_ID,
      source.Grade,
      source.Depth,
      source.Title,
      source.Theme_Tags,
      source.Key_Takeaway_PDF_Free,
      source.Method_or_Evidence,
      source.How_to_use_in_Metro_Rescue,
      source.Do_not_claim,
      source.Thesis_Section,
    ].join(" "),
  )
    .slice(0, 8)
    .map(({ item }) => item);

  const merged = new Map<string, SeedSource>();
  for (const source of [...citedSources, ...rankedSources]) {
    merged.set(source.Source_ID, source);
  }

  return Array.from(merged.values());
}

function formatSeedSection<T>(title: string, scoredItems: Array<ScoredItem<T>>, formatItem: (item: T) => string) {
  const selected = scoredItems.filter((entry) => entry.score > 0);
  const entries = (selected.length ? selected : scoredItems).slice(0, Math.min(5, scoredItems.length));
  return [title, ...entries.map(({ item }) => `- ${formatItem(item)}`)].join("\n");
}

function formatSourceCard(source: SeedSource) {
  return [
    `- ${source.Source_ID} [Grade ${source.Grade}, ${source.Depth}] ${source.Title}`,
    `  Tags: ${source.Theme_Tags}`,
    `  Takeaway: ${source.Key_Takeaway_PDF_Free}`,
    `  Evidence: ${source.Method_or_Evidence}`,
    `  Use: ${source.How_to_use_in_Metro_Rescue}`,
    `  Do not claim: ${source.Do_not_claim}`,
    `  File: ${source.Filename}`,
  ].join("\n");
}

function tokenize(value: string) {
  const lower = value.toLowerCase();
  const asciiTokens = lower.match(/[a-z0-9_+-]{2,}/g) ?? [];
  const chineseKeywords = [
    "导向",
    "标识",
    "地铁",
    "撤离",
    "逃生",
    "脑电",
    "认知",
    "负荷",
    "方法",
    "假设",
    "文献",
    "综述",
    "引言",
    "讨论",
    "局限",
    "模型",
    "统计",
    "被试",
    "数据",
    "风险",
    "答辩",
    "写作",
  ].filter((keyword) => lower.includes(keyword));

  return Array.from(new Set([...asciiTokens, ...chineseKeywords]));
}

function getSourceIds(value: string) {
  return value.match(SOURCE_ID_PATTERN) ?? [];
}
