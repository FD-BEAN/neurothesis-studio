import seedKnowledgeBase from "@/lib/metro_rescue_seed_kb.json";
import literatureArticleKnowledgeBase from "@/lib/literature_article_kb.json";
import { parseImportedPdfMetadata, type LiteratureKnowledgeCard } from "@/lib/literature";

type SeedKnowledgeBase = typeof seedKnowledgeBase;
type SeedSource = SeedKnowledgeBase["sources"][number];
type CuratedArticleKnowledgeCard = (typeof literatureArticleKnowledgeBase)["articles"][number];
type CuratedPaperReadingNote = {
  tldr?: string;
  problem?: string;
  motivation?: string;
  methodSummary?: string;
  resultSummary?: string;
  transferableConcepts?: string[];
  strengths?: string[];
  weaknesses?: string[];
  writingAngles?: string[];
  followUpQuestions?: string[];
};
type CuratedArticleTaskLens = {
  frameworkRole?: string;
  constructSupport?: Array<{ construct?: string; use?: string; strength?: string }>;
  measurementUse?: string[];
  manuscriptUse?: string[];
  caveats?: string[];
};
type CuratedPaperDossier = {
  verdict?: string;
  problem?: string;
  motivation?: string;
  design?: {
    overview?: string;
    sample?: string;
    task?: string;
    variables?: string[];
    measures?: string[];
    analysis?: string;
  };
  findings?: string[];
  credibility?: string;
  thesisRelevance?: string;
};
type CuratedThesisWritingMap = {
  relationType?: string;
  frameworkRole?: string;
  constructs?: Array<{ construct?: string; support?: string; use?: string; caution?: string }>;
  chapterUses?: string[];
  writingBlocks?: Array<{ section?: string; purpose?: string; draft?: string }>;
  overclaimWarnings?: string[];
  verificationTasks?: string[];
};

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

const projectAnalysisDesignReviewItems: SeedKnowledgeReviewItem[] = [
  {
    id: "DESIGN-001",
    title: "被试与文件编号映射",
    body: "正式 XDF 数据按三连号归并被试：实验文件 sub001/sub002/sub003 属于 P01，sub004/sub005/sub006 属于 P02，sub007/sub008/sub009 属于 P03，以此类推。文件中的 sub007 这类编号代表实验文件序号，不应直接解释为第 7 名被试。",
    tags: ["XDF", "subject", "coding-rule"],
    meta: [
      { label: "组内单位", value: "同一被试的 3 个路径确认支持条件 run" },
      { label: "页面与 worker 规则", value: "按三连号自动生成 P01, P02, P03..." },
    ],
    boundary: "如果未来文件名改为真正的被试编号，需要同步更新命名规则，避免把 run 序号和 participant ID 混用。",
  },
  {
    id: "DESIGN-002",
    title: "Signature 到 Route-confirmation support level 的映射",
    body: "当前研究口径统一为 Route-confirmation support level：Signature1 = 低路径确认支持，Signature2 = 中路径确认支持，Signature3 = 高路径确认支持。论文正文优先使用 low / medium / high route-confirmation support；Signature 只作为实验素材或 Unity/文件命名的历史字段。",
    tags: ["route-confirmation", "signature", "methods"],
    meta: [
      { label: "低路径确认支持", value: "Signature1" },
      { label: "中路径确认支持", value: "Signature2" },
      { label: "高路径确认支持", value: "Signature3" },
    ],
    boundary: "如果 Signature 实际还包含颜色、图形或朝向等差异，Methods 需要单独列出操控定义，不能只写成单一数量差异。",
  },
  {
    id: "DESIGN-003",
    title: "组内主检验",
    body: "主假设检验中等路径确认支持是否最高，而非线性检验“支持越高负荷越高”。每名被试先形成 low、medium、high 三个 run-level 指标，再计算 planned contrast：medium - mean(low, high)，权重为 low:-1, medium:2, high:-1。",
    tags: ["within-subject", "planned-contrast", "hypothesis"],
    meta: [
      { label: "主指标候选", value: "EEG load proxy、theta/alpha、frontal theta、posterior alpha、completion time、behavior load proxy" },
      { label: "显著性层级", value: "先 subject-level contrast，再做全样本 one-sample test 或 mixed-effects contrast" },
    ],
    boundary: "单个被试报告只能给方向性结果；显著性结论必须来自全样本或明确提供的统计输出。",
  },
  {
    id: "DESIGN-004",
    title: "被试间分析",
    body: "被试间问题指不同被试之间的差异，应建立在被试元数据上，例如组别、年龄、性别、VR 经验、专业背景、实验顺序或 counterbalance。统计上关注 SupportLevel × 被试间变量；不同被试的单个 XDF 文件不能直接混在一起比较。",
    tags: ["between-subject", "metadata", "mixed-effects"],
    meta: [
      { label: "建议模型", value: "Load ~ SupportLevel * BetweenSubjectVariable + RunOrder + Map + (1 + SupportLevel | Subject)" },
      { label: "需要补充", value: "subject metadata / counterbalance / exclusion log" },
    ],
    boundary: "没有 subject-level metadata 时，只能报告总体组内路径确认支持效应，不能解释被试之间的差异来源。",
  },
  {
    id: "DESIGN-005",
    title: "事件窗优先于全程均值",
    body: "理论机制更可能发生在 sign_readable 与 decision_point_enter 附近，因此 EEG 与行为指标应同时保留 trial-level 和 event-window 两个层级。全程均值适合质控和主表，事件窗更适合解释导向标识如何影响认知负荷。",
    tags: ["event-window", "EEG", "Unity-marker"],
    meta: [
      { label: "核心事件", value: "sign_readable, decision_point_enter" },
      { label: "控制变量", value: "movement speed, head yaw, audio overlap, trial order, map" },
    ],
    boundary: "如果 marker 与 EEG 时间轴覆盖不足，事件窗结果必须标记为不可用或探索性。",
  },
];

export function buildResearchKnowledgeContext(prompt: string, userCards: LiteratureKnowledgeCard[]) {
  const seedContext = buildSeedContext(prompt);
  const articleContext = buildCuratedArticleContext(prompt);
  const userContext = buildUserLiteratureContext(userCards, prompt);

  return [
    "=== Metro Rescue literature knowledge base: synthesis, claims, mechanisms, and analysis rules ===",
    seedContext,
    "",
    "=== Metro Rescue literature knowledge base: per-paper reading notes ===",
    articleContext,
    "",
    "=== Metro Rescue literature knowledge base: uploaded source cards using the same evidence rules ===",
    userContext,
    "",
    "使用规则：区分文献证据、项目假设和用户自己的实验结果。项目假设和写作块只能作为起草材料，不能当成已经得到的发现。",
  ].join("\n");
}

export function getSeedKnowledgeStats() {
  return {
    sources: literatureArticleKnowledgeBase.articleCount || seedKnowledgeBase.sources.length,
    claims: seedKnowledgeBase.claims.length,
    mechanisms: seedKnowledgeBase.mechanisms.length,
    hypotheses: seedKnowledgeBase.hypotheses.length,
    analysisModels: seedKnowledgeBase.analysis_models.length,
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
      "KB 中部分历史字段仍使用 Signature1/2/3 命名；当前研究口径应统一映射为低/中/高路径确认支持条件，并在论文中使用 Route-confirmation support level。",
      "假设、写作块和分析模型是写作与建模材料，不等于已经得到的实验结果。",
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
        label: "论点",
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
          tags: [],
          meta: [{ label: "解释", value: model.Interpretation }],
        })),
      },
      {
        id: "analysis_design",
        label: "分析口径",
        description: "把当前实验的文件编码、路径确认支持条件、组内主检验和被试间建模边界固定下来。",
        items: projectAnalysisDesignReviewItems,
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
    `Literature KB: ${seedKnowledgeBase.sources.length} existing source cards, ${seedKnowledgeBase.claims.length} claims, ${seedKnowledgeBase.mechanisms.length} mechanisms, ${seedKnowledgeBase.hypotheses.length} hypotheses, ${seedKnowledgeBase.analysis_models.length} analysis models.`,
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
      (item) => `${item.Hypothesis_ID} ${item.Hypothesis}: ${item.Prediction}. Model: ${item.Model_Formula}. Sources: ${item.Sources}. Note: ${item.Note}`,
    ),
    formatSeedSection(
      "Analysis models",
      analysisModels,
      (item) => `${item.Model_ID} ${item.Purpose}: ${item.Model_Formula}. Interpretation: ${item.Interpretation}`,
    ),
    [
      "Project analysis design rules",
      ...projectAnalysisDesignReviewItems.map((item) => `- ${item.id} ${item.title}: ${item.body}`),
    ].join("\n"),
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

function buildCuratedArticleContext(prompt: string) {
  const articles = rankItems(literatureArticleKnowledgeBase.articles, prompt, (article) =>
    [
      article.id,
      article.title,
      article.extractedTitleCandidate ?? "",
      article.articleRole,
      article.evidenceType,
      article.qualityTier,
      article.oneSentenceSummary,
      article.researchQuestion,
      article.researchPosition,
      article.studyDesign,
      article.participantsAndSample,
      article.taskAndMaterials,
      article.variablesAndMeasures.join(" "),
      article.eegOrPhysioMeasures.join(" "),
      article.behavioralMeasures.join(" "),
      article.keyFindings.join(" "),
      article.metroRescueUse.join(" "),
      article.densityHypothesisRelevance.join(" "),
      article.methodTransfer.join(" "),
      article.limitations.join(" "),
      article.doNotClaim.join(" "),
      article.boundaries.join(" "),
      article.quoteAnchorsToVerify.join(" "),
      article.writingUse.join(" "),
      article.keywords.join(" "),
      article.themeTags.join(" "),
      JSON.stringify((article as CuratedArticleKnowledgeCard & { taskLens?: CuratedArticleTaskLens }).taskLens ?? {}),
      JSON.stringify((article as CuratedArticleKnowledgeCard & { paperDossier?: CuratedPaperDossier }).paperDossier ?? {}),
      JSON.stringify((article as CuratedArticleKnowledgeCard & { thesisWritingMap?: CuratedThesisWritingMap }).thesisWritingMap ?? {}),
    ].join(" "),
  ).slice(0, 16);

  if (!articles.length) {
    return "No curated per-paper reading notes are available yet.";
  }

  return [
    `Curated per-paper KB: ${literatureArticleKnowledgeBase.articleCount} article reading notes. Use these cards as structured reading memory; verify page numbers, author-year details, DOI, and exact wording in the PDFs before final submission.`,
    ...articles.map(({ item }) => formatCuratedArticleForWriting(item)),
  ].join("\n\n");
}

function formatCuratedArticleForWriting(article: CuratedArticleKnowledgeCard) {
  const readingNote = (article as CuratedArticleKnowledgeCard & { readingNote?: CuratedPaperReadingNote }).readingNote;
  const taskLens = (article as CuratedArticleKnowledgeCard & { taskLens?: CuratedArticleTaskLens }).taskLens;
  const dossier = (article as CuratedArticleKnowledgeCard & { paperDossier?: CuratedPaperDossier }).paperDossier;
  const writingMap = (article as CuratedArticleKnowledgeCard & { thesisWritingMap?: CuratedThesisWritingMap }).thesisWritingMap;

  return [
    `[${article.id}] ${article.title}`,
    article.extractedTitleCandidate ? `PDF title candidate: ${article.extractedTitleCandidate}` : "",
    `Role/type/grade: ${article.articleRole}; ${article.evidenceType}; ${article.qualityTier}`,
    `单篇论文档案-速读结论: ${dossier?.verdict || readingNote?.tldr || article.oneSentenceSummary}`,
    `单篇论文档案-研究问题: ${dossier?.problem || readingNote?.problem || article.researchQuestion}`,
    `单篇论文档案-研究动机: ${dossier?.motivation || readingNote?.motivation || article.researchPosition}`,
    `单篇论文档案-方法设计: ${dossier?.design?.overview || readingNote?.methodSummary || article.studyDesign}`,
    `单篇论文档案-样本任务指标: ${joinKnowledgeValues([dossier?.design?.sample, dossier?.design?.task, ...(dossier?.design?.variables ?? article.variablesAndMeasures), ...(dossier?.design?.measures ?? [...article.eegOrPhysioMeasures, ...article.behavioralMeasures])].filter(Boolean) as string[])}`,
    `单篇论文档案-核心发现: ${joinKnowledgeValues(dossier?.findings ?? article.keyFindings)}`,
    `单篇论文档案-可信度与边界: ${dossier?.credibility || joinKnowledgeValues(readingNote?.weaknesses ?? [...article.doNotClaim, ...article.limitations, ...article.boundaries])}`,
    `本论文关系: ${writingMap?.relationType || taskLens?.frameworkRole || article.researchPosition}`,
    `构念映射: ${joinKnowledgeValues((writingMap?.constructs ?? taskLens?.constructSupport ?? []).map((item) => `${item.construct}: ${"use" in item ? item.use : ""}`))}`,
    `可进入章节: ${joinKnowledgeValues(writingMap?.chapterUses ?? taskLens?.manuscriptUse ?? article.writingUse)}`,
    `可写入中文论文段落: ${joinKnowledgeValues((writingMap?.writingBlocks ?? []).map((block) => `${block.section}: ${block.draft}`))}`,
    `不能这样使用: ${joinKnowledgeValues(writingMap?.overclaimWarnings ?? readingNote?.weaknesses ?? [...article.doNotClaim, ...article.limitations, ...article.boundaries])}`,
    `回原文核对: ${joinKnowledgeValues(writingMap?.verificationTasks ?? article.quoteAnchorsToVerify)}`,
    `TL;DR: ${readingNote?.tldr || article.oneSentenceSummary}`,
    `Problem: ${readingNote?.problem || article.researchQuestion}`,
    `Motivation: ${readingNote?.motivation || article.researchPosition}`,
    `Method/data: ${readingNote?.methodSummary || article.studyDesign}`,
    `Measures: ${joinKnowledgeValues([...article.variablesAndMeasures, ...article.eegOrPhysioMeasures, ...article.behavioralMeasures])}`,
    `Findings: ${readingNote?.resultSummary || joinKnowledgeValues(article.keyFindings)}`,
    `Use for Metro Rescue thesis: ${joinKnowledgeValues(readingNote?.writingAngles ?? [...article.metroRescueUse, ...article.methodTransfer])}`,
    `Route-confirmation task lens: ${taskLens?.frameworkRole ?? "未生成"}`,
    `Construct support: ${joinKnowledgeValues((taskLens?.constructSupport ?? []).map((item) => `${item.construct}: ${item.use}`))}`,
    `Measurement use: ${joinKnowledgeValues(taskLens?.measurementUse)}`,
    `Route-confirmation support hypothesis relevance: ${joinKnowledgeValues(article.densityHypothesisRelevance)}`,
    `Transferable concepts: ${joinKnowledgeValues(readingNote?.transferableConcepts ?? article.keywords)}`,
    `Do not claim / limitations: ${joinKnowledgeValues(readingNote?.weaknesses ?? [...article.doNotClaim, ...article.limitations, ...article.boundaries])}`,
    `Quote anchors requiring verification: ${joinKnowledgeValues(article.quoteAnchorsToVerify)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function joinKnowledgeValues(values: string[] | undefined) {
  const joined = (values ?? []).filter(Boolean).join("；");
  return joined || "未生成";
}

function buildUserLiteratureContext(cards: LiteratureKnowledgeCard[], prompt: string) {
  if (!cards.length) {
    return "No additional uploaded-paper cards yet. Use the existing literature knowledge base, and ask the user to generate knowledge cards for newly uploaded papers before relying on those new papers.";
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
      JSON.stringify(card.paperDossier ?? {}),
      JSON.stringify(card.thesisWritingMap ?? {}),
    ].join(" "),
  )
    .slice(0, 24)
    .map(({ item: card }, index) =>
      [
        `[U${index + 1}] ${card.title || card.filename}`,
        `Filename: ${card.filename}`,
        `Citation: ${card.citation}`,
        `单篇论文档案: ${card.paperDossier ? JSON.stringify(card.paperDossier) : "未生成"}`,
        `论文写作映射: ${card.thesisWritingMap ? JSON.stringify(card.thesisWritingMap) : "未生成"}`,
        `Takeaway: ${card.oneSentenceTakeaway ?? card.abstractZh ?? "未生成"}`,
        `Research question: ${card.researchQuestion}`,
        `Methods: ${card.methods}`,
        `Measures: ${card.eegOrMeasures}`,
        `Key findings: ${card.keyFindings.join("；")}`,
        `Limitations: ${card.limitations.join("；")}`,
        `Use for Metro Rescue: ${card.relevanceToMetroRescue.join("；")}`,
        `Route-confirmation support hypothesis relevance: ${card.densityHypothesisRelevance?.join("；") ?? "未生成"}`,
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
