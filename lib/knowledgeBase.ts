import seedKnowledgeBase from "@/lib/metro_rescue_seed_kb.json";
import { parseImportedPdfMetadata, type LiteratureKnowledgeCard } from "@/lib/literature";

type SeedKnowledgeBase = typeof seedKnowledgeBase;
type SeedSource = SeedKnowledgeBase["sources"][number];

export type SeedKnowledgeReviewItem = {
  id: string;
  title: string;
  subtitle?: string;
  body: string;
  tags: string[];
  meta: Array<{ label: string; value: string }>;
  boundary?: string;
};

export type SeedKnowledgeReviewSection = {
  id: string;
  label: string;
  description: string;
  items: SeedKnowledgeReviewItem[];
};

export type SeedKnowledgeReview = {
  version: string;
  generatedFrom: string;
  integrityNotes: string[];
  reviewNotes: string[];
  sections: SeedKnowledgeReviewSection[];
};

type ScoredItem<T> = {
  item: T;
  score: number;
};

type SeedMatchableDocument = {
  filename: string;
  storage_path?: string | null;
  notes?: string | null;
};

export type SeedLiteratureMatch = {
  sourceId: string;
  title: string;
  filename: string;
  grade: string;
  depth: string;
  keyTakeaway: string;
  methodOrEvidence: string;
  howToUse: string;
  doNotClaim: string;
  thesisSection: string;
  themeTags: string[];
  matchedKey: string;
  matchedBy: "document-title" | "import-title" | "import-filename" | "storage-path";
};

const SOURCE_ID_PATTERN = /S\d{3}/g;
const sourceTitleById = new Map(seedKnowledgeBase.sources.map((source) => [source.Source_ID, source.Title]));
const seedSourceByNormalizedKey = buildSeedSourceKeyMap();

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

export function findSeedLiteratureMatch(document: SeedMatchableDocument): SeedLiteratureMatch | null {
  const imported = parseImportedPdfMetadata(document.notes);
  const candidates: Array<{ value?: string | null; matchedBy: SeedLiteratureMatch["matchedBy"] }> = [
    { value: imported?.extractedTitle, matchedBy: "import-title" },
    { value: document.filename, matchedBy: "document-title" },
    { value: imported?.originalFilename, matchedBy: "import-filename" },
    { value: getStorageBasename(document.storage_path), matchedBy: "storage-path" },
  ];

  for (const candidate of candidates) {
    const key = normalizeLiteratureKey(candidate.value ?? "");
    if (!isUsefulLiteratureKey(key)) continue;
    const source = seedSourceByNormalizedKey.get(key);
    if (source) return toSeedLiteratureMatch(source, key, candidate.matchedBy);
  }

  return null;
}

export function getSeedKnowledgeReview(): SeedKnowledgeReview {
  return {
    version: seedKnowledgeBase.version,
    generatedFrom: seedKnowledgeBase.generated_from,
    integrityNotes: seedKnowledgeBase.integrity_notes,
    reviewNotes: [
      "这是一层结构化、可审阅的文献知识库，不是 PDF 全文库；正式引用前仍要回到原文核对页码、作者、年份和 DOI。",
      "KB 中部分历史字段仍使用 Signature1/2/3 命名；当前研究口径应统一映射为低/中/高密度条件，并在论文中使用 Density condition。",
      "Hypotheses、writing blocks 和 analysis models 是写作与建模辅助，不等于已经得到实验结果。",
    ],
    sections: [
      {
        id: "sources",
        label: "文献卡",
        description: "每篇文献的用途、证据类型、可用章节和不可过度声称的边界。",
        items: seedKnowledgeBase.sources.map((source) => ({
          id: source.Source_ID,
          title: source.Title,
          subtitle: `Grade ${source.Grade} · ${source.Depth} · ${source.Thesis_Section}`,
          body: source.Key_Takeaway_PDF_Free,
          tags: splitTags(source.Theme_Tags),
          meta: [
            { label: "证据/方法", value: source.Method_or_Evidence },
            { label: "用于本研究", value: source.How_to_use_in_Metro_Rescue },
            { label: "文件", value: source.Filename },
          ],
          boundary: source.Do_not_claim,
        })),
      },
      {
        id: "claims",
        label: "Claims",
        description: "可用于 Introduction、Theory、Methods 或 Discussion 的文献主张。",
        items: seedKnowledgeBase.claims.map((claim) => ({
          id: claim.Claim_ID,
          title: claim.Claim,
          subtitle: `${claim.Type} · ${claim.Thesis_Section}`,
          body: claim.How_to_use,
          tags: getSourceIds(claim.Sources),
          meta: [
            { label: "来源代码", value: claim.Sources },
            { label: "来源文献", value: formatSourceReferences(claim.Sources) },
          ],
        })),
      },
      {
        id: "mechanisms",
        label: "机制",
        description: "把标识、导航行为和 EEG 认知负荷连接起来的理论机制。",
        items: seedKnowledgeBase.mechanisms.map((mechanism) => ({
          id: mechanism.Mechanism_ID,
          title: mechanism.Mechanism,
          body: mechanism.Plain_Explanation,
          tags: getSourceIds(mechanism.Sources),
          meta: [
            { label: "Metro 变量", value: mechanism.Metro_Variables },
            { label: "分析含义", value: mechanism.Analysis_Implication },
            { label: "来源代码", value: mechanism.Sources },
            { label: "来源文献", value: formatSourceReferences(mechanism.Sources) },
          ],
        })),
      },
      {
        id: "hypotheses",
        label: "假设",
        description: "项目假设和 planned contrasts。这里是待检验假设，不是结果。",
        items: seedKnowledgeBase.hypotheses.map((hypothesis) => ({
          id: hypothesis.Hypothesis_ID,
          title: hypothesis.Hypothesis,
          subtitle: hypothesis.Prediction,
          body: hypothesis.Model_Formula,
          tags: getSourceIds(hypothesis.Sources),
          meta: [
            { label: "数据表", value: hypothesis.Data_Table },
            { label: "来源代码", value: hypothesis.Sources },
            { label: "来源文献", value: formatSourceReferences(hypothesis.Sources) },
            { label: "备注", value: hypothesis.Note },
          ],
          boundary: "假设必须用真实 XDF/行为数据检验；不能写成已经得到的发现。",
        })),
      },
      {
        id: "analysis_models",
        label: "分析模型",
        description: "用于把 XDF/行为特征转成统计检验的模型草案。",
        items: seedKnowledgeBase.analysis_models.map((model) => ({
          id: model.Model_ID,
          title: model.Purpose,
          body: model.Model_Formula,
          tags: [model.Data_Table],
          meta: [
            { label: "数据表", value: model.Data_Table },
            { label: "解释", value: model.Interpretation },
          ],
        })),
      },
      {
        id: "data_tables",
        label: "数据表",
        description: "正式分析与论文复现需要维护的数据结构。",
        items: seedKnowledgeBase.data_tables.map((table) => ({
          id: table.Table,
          title: table.Table,
          subtitle: table.Unit,
          body: table.Purpose,
          tags: [],
          meta: [{ label: "关键字段", value: table.Key_Fields }],
        })),
      },
      {
        id: "risks",
        label: "风险",
        description: "审稿、答辩和数据分析中容易被质疑的点，以及修正方案。",
        items: seedKnowledgeBase.risks_and_fixes.map((risk) => ({
          id: risk.Risk_ID,
          title: risk.Risk,
          body: risk.Why_it_matters,
          tags: getSourceIds(risk.Sources),
          meta: [
            { label: "修正", value: risk.Fix },
            { label: "来源代码", value: risk.Sources },
            { label: "来源文献", value: formatSourceReferences(risk.Sources) },
          ],
        })),
      },
      {
        id: "writing_blocks",
        label: "写作块",
        description: "可作为论文段落草稿的结构化素材，需要按最终结果再改写。",
        items: seedKnowledgeBase.writing_blocks.map((block) => ({
          id: block.Block_ID,
          title: block.Use,
          body: block.Draft_Text,
          tags: [],
          meta: [],
          boundary: "这是草稿，不是最终可直接提交文本；需要结合真实结果和最终参考文献格式修订。",
        })),
      },
      {
        id: "qa",
        label: "答辩问题",
        description: "可能被问到的问题与当前回答口径。",
        items: seedKnowledgeBase.qa.map((qa) => ({
          id: qa.Question_ID,
          title: qa.Question,
          body: qa.Answer,
          tags: getSourceIds(qa.Sources),
          meta: [
            { label: "来源代码", value: qa.Sources },
            { label: "来源文献", value: formatSourceReferences(qa.Sources) },
          ],
        })),
      },
      {
        id: "quote_anchors",
        label: "引用锚点",
        description: "可回到 PDF 核对的短锚点；正式提交前必须核对页码和原文。",
        items: seedKnowledgeBase.quote_anchors.map((anchor, index) => ({
          id: `${anchor.Source_ID}-${index + 1}`,
          title: anchor.Short_Original_Anchor,
          subtitle: `${anchor.Source_ID} · ${anchor.Page_Target}`,
          body: anchor.Use,
          tags: [anchor.Source_ID],
          meta: [
            { label: "来源文献", value: formatSourceReferences(anchor.Source_ID) },
            { label: "核对任务", value: anchor.Task },
          ],
          boundary: "只能作为回查线索；未核对原文前不要当作正式 quote。",
        })),
      },
    ],
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
      card.paperType ?? "",
      card.oneSentenceTakeaway ?? "",
      card.abstractZh ?? "",
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
      card.theoryOrMechanism?.join(" ") ?? "",
      card.variablesAndMeasures?.join(" ") ?? "",
      card.densityHypothesisRelevance?.join(" ") ?? "",
      card.methodsWritingUse?.join(" ") ?? "",
      card.resultsDiscussionUse?.join(" ") ?? "",
      card.qualityCaveats?.join(" ") ?? "",
    ].join(" "),
  )
    .slice(0, 12)
    .map(({ item: card }, index) =>
      [
        `[U${index + 1}] ${card.title || card.filename}`,
        `Filename: ${card.filename}`,
        `Citation: ${card.citation}`,
        `Takeaway: ${card.oneSentenceTakeaway ?? card.abstractZh ?? "未生成"}`,
        `Research question: ${card.researchQuestion}`,
        `Methods: ${card.methods}`,
        `Measures: ${card.eegOrMeasures}`,
        `Key findings: ${card.keyFindings.join("；")}`,
        `Limitations: ${card.limitations.join("；")}`,
        `Use for Metro Rescue: ${card.relevanceToMetroRescue.join("；")}`,
        `Density hypothesis relevance: ${card.densityHypothesisRelevance?.join("；") ?? "未生成"}`,
        `Variables/measures: ${card.variablesAndMeasures?.join("；") ?? "未生成"}`,
        `Methods writing use: ${card.methodsWritingUse?.join("；") ?? "未生成"}`,
        `Results/discussion use: ${card.resultsDiscussionUse?.join("；") ?? "未生成"}`,
        `Source grade: ${card.sourceGrade ?? card.evidenceLevel}`,
        `Theme tags: ${card.themeTags?.join("；") ?? card.keywords.join("；")}`,
        `Candidate claims: ${card.candidateClaims?.join("；") ?? "未生成"}`,
        `Do not claim: ${card.doNotClaim?.join("；") ?? "未生成"}`,
        `Quality caveats: ${card.qualityCaveats?.join("；") ?? "未生成"}`,
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

function formatSourceReferences(value: string) {
  const ids = Array.from(new Set(getSourceIds(value)));
  if (!ids.length) return value;

  return ids.map((id) => `${id} — ${sourceTitleById.get(id) ?? "未找到对应文献卡"}`).join("\n");
}

function buildSeedSourceKeyMap() {
  const map = new Map<string, SeedSource>();
  for (const source of seedKnowledgeBase.sources) {
    addSeedSourceKey(map, source.Title, source, true);
    addSeedSourceKey(map, source.Filename, source, false);
  }
  return map;
}

function addSeedSourceKey(map: Map<string, SeedSource>, value: string, source: SeedSource, allowShortKey: boolean) {
  const key = normalizeLiteratureKey(value);
  if (!key || (!allowShortKey && !isUsefulLiteratureKey(key))) return;
  if (!map.has(key)) map.set(key, source);
}

function toSeedLiteratureMatch(
  source: SeedSource,
  matchedKey: string,
  matchedBy: SeedLiteratureMatch["matchedBy"],
): SeedLiteratureMatch {
  return {
    sourceId: source.Source_ID,
    title: source.Title,
    filename: source.Filename,
    grade: source.Grade,
    depth: source.Depth,
    keyTakeaway: source.Key_Takeaway_PDF_Free,
    methodOrEvidence: source.Method_or_Evidence,
    howToUse: source.How_to_use_in_Metro_Rescue,
    doNotClaim: source.Do_not_claim,
    thesisSection: source.Thesis_Section,
    themeTags: splitTags(source.Theme_Tags),
    matchedKey,
    matchedBy,
  };
}

function normalizeLiteratureKey(value: string) {
  return getStorageBasename(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\.(pdf|docx?|md|txt)$/i, "")
    .replace(/\(\d+\)/g, "")
    .replace(/[（(]\s*科研通-ablesci\.com\s*[）)]/gi, "")
    .replace(/科研通-ablesci\.com/gi, "")
    .replace(/ablesci\.com/gi, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

function isUsefulLiteratureKey(key: string) {
  return key.length >= 8 || /[\u4e00-\u9fff]{4,}/.test(key);
}

function getStorageBasename(value: string | null | undefined) {
  return String(value ?? "").split(/[\\/]/).pop() ?? "";
}

function splitTags(value: string) {
  return value
    .split(/[;/]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}
