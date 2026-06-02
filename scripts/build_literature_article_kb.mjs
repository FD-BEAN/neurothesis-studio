import fs from "node:fs";
import path from "node:path";
import seedKnowledgeBase from "../lib/metro_rescue_seed_kb.json" with { type: "json" };

const projectRoot = path.resolve(import.meta.dirname, "..");
const outputPath = path.join(projectRoot, "lib", "literature_article_kb.json");
const defaultPdfBase = "C:/Users/Jingbin/Documents/xwechat_files/wangjingbin1996_11f7/msg/file/2026-06";

function main() {
  const pdfDirectory = findLargestPdfDirectory(defaultPdfBase);
  const pdfFilenames = pdfDirectory
    ? fs
        .readdirSync(pdfDirectory)
        .filter((filename) => filename.toLowerCase().endsWith(".pdf"))
        .sort((a, b) => a.localeCompare(b, "en"))
    : [];
  const pdfByKey = new Map(pdfFilenames.map((filename) => [normalizeLiteratureKey(filename), filename]));

  const articles = seedKnowledgeBase.sources.map((source) => {
    const linkedClaims = bySource(seedKnowledgeBase.claims, source.Source_ID, "Sources").map((claim) => ({
      id: claim.Claim_ID,
      type: claim.Type,
      text: claim.Claim,
      use: claim.How_to_use,
      section: claim.Thesis_Section,
    }));
    const linkedMechanisms = bySource(seedKnowledgeBase.mechanisms, source.Source_ID, "Sources").map((mechanism) => ({
      id: mechanism.Mechanism_ID,
      mechanism: mechanism.Mechanism,
      explanation: mechanism.Plain_Explanation,
      metroVariables: mechanism.Metro_Variables,
      analysisImplication: mechanism.Analysis_Implication,
    }));
    const linkedHypotheses = bySource(seedKnowledgeBase.hypotheses, source.Source_ID, "Sources").map((hypothesis) => ({
      id: hypothesis.Hypothesis_ID,
      hypothesis: hypothesis.Hypothesis,
      prediction: hypothesis.Prediction,
      model: hypothesis.Model_Formula,
      note: hypothesis.Note,
    }));
    const linkedRisks = bySource(seedKnowledgeBase.risks_and_fixes, source.Source_ID, "Sources").map((risk) => ({
      id: risk.Risk_ID,
      risk: risk.Risk,
      whyItMatters: risk.Why_it_matters,
      fix: risk.Fix,
    }));
    const linkedQa = bySource(seedKnowledgeBase.qa, source.Source_ID, "Sources").map((qa) => ({
      id: qa.Question_ID,
      question: qa.Question,
      answer: qa.Answer,
    }));
    const linkedQuoteAnchors = seedKnowledgeBase.quote_anchors
      .filter((anchor) => anchor.Source_ID === source.Source_ID)
      .map((anchor, index) => ({
        id: `${anchor.Source_ID}-${index + 1}`,
        anchor: anchor.Short_Original_Anchor,
        pageTarget: anchor.Page_Target,
        use: anchor.Use,
        verificationTask: anchor.Task,
      }));

    const keyFindings = uniqueCompact([
      source.Key_Takeaway_PDF_Free,
      ...linkedClaims.map((claim) => claim.text),
    ]);
    const metroRescueUse = uniqueCompact([
      source.How_to_use_in_Metro_Rescue,
      ...linkedMechanisms.map((mechanism) => mechanism.analysisImplication),
      ...linkedHypotheses.map((hypothesis) => hypothesis.hypothesis),
    ]);
    const boundaries = uniqueCompact([
      source.Do_not_claim,
      ...linkedRisks.map((risk) => `${risk.risk}: ${risk.fix}`),
    ]);
    const matchedPdfFilename = pdfByKey.get(normalizeLiteratureKey(source.Filename)) ?? source.Filename;

    return {
      id: source.Source_ID,
      title: source.Title,
      filename: source.Filename,
      matchedPdfFilename,
      grade: source.Grade,
      depth: source.Depth,
      thesisSection: source.Thesis_Section,
      themeTags: splitTags(source.Theme_Tags),
      articleRole: inferArticleRole(source),
      oneSentenceSummary: source.Key_Takeaway_PDF_Free,
      researchPosition: buildResearchPosition(source),
      methodAndData: source.Method_or_Evidence,
      keyFindings,
      metroRescueUse,
      writingUse: splitThesisSections(source.Thesis_Section),
      boundaries,
      linkedEvidence: {
        claims: linkedClaims,
        mechanisms: linkedMechanisms,
        hypotheses: linkedHypotheses,
        risks: linkedRisks,
        qa: linkedQa,
        quoteAnchors: linkedQuoteAnchors,
      },
    };
  });

  const output = {
    version: "literature-article-kb-v1",
    generatedBy: "Codex local consolidation; no website API call",
    generatedAt: "2026-06-01",
    source: "Uploaded related-literature PDFs matched to metro_rescue_seed_kb source cards",
    schema: [
      "文献身份",
      "研究问题与定位",
      "方法与数据",
      "主要发现",
      "对本研究的用途",
      "边界与不能声称",
      "关联证据单元",
      "引用线索",
    ],
    pdfDirectoryMatched: Boolean(pdfDirectory),
    pdfCount: pdfFilenames.length,
    articleCount: articles.length,
    articles,
  };

  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Wrote ${articles.length} article cards to ${outputPath}`);
  console.log(`Matched PDF directory: ${pdfDirectory ?? "not found"}`);
}

function findLargestPdfDirectory(baseDirectory) {
  if (!fs.existsSync(baseDirectory)) return "";
  const candidates = [];
  walkDirectories(baseDirectory, (directory) => {
    const pdfCount = fs.readdirSync(directory).filter((filename) => filename.toLowerCase().endsWith(".pdf")).length;
    if (pdfCount >= 20) candidates.push({ directory, pdfCount });
  });
  candidates.sort((a, b) => b.pdfCount - a.pdfCount);
  return candidates[0]?.directory ?? "";
}

function walkDirectories(directory, visit) {
  visit(directory);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) walkDirectories(path.join(directory, entry.name), visit);
  }
}

function bySource(items, sourceId, key) {
  return items.filter((item) => splitSourceIds(item[key]).includes(sourceId));
}

function splitSourceIds(value) {
  return Array.from(new Set(String(value ?? "").match(/S\d{3}/g) ?? []));
}

function splitTags(value) {
  return String(value ?? "")
    .split(/[;/,]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function splitThesisSections(value) {
  return String(value ?? "")
    .split(/[;/]/)
    .map((section) => section.trim())
    .filter(Boolean);
}

function uniqueCompact(values) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function normalizeLiteratureKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\.(pdf|docx?|txt|md)$/i, "")
    .replace(/\(\d+\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function inferArticleRole(source) {
  const text = [source.Title, source.Theme_Tags, source.Method_or_Evidence, source.Thesis_Section].join(" ").toLowerCase();
  if (text.includes("eeg") || text.includes("fnirs") || text.includes("brain") || text.includes("cognitive load")) {
    return "神经生理与认知负荷证据";
  }
  if (text.includes("sign") || text.includes("wayfinding") || text.includes("navigation") || text.includes("landmark")) {
    return "导向标识与空间导航证据";
  }
  if (text.includes("vr") || text.includes("virtual reality") || text.includes("immersive")) {
    return "VR 实验范式与生态效度证据";
  }
  if (text.includes("simulation") || text.includes("digital twin") || text.includes("agent")) {
    return "疏散建模与数字孪生背景";
  }
  return "背景与方法参考";
}

function buildResearchPosition(source) {
  const tags = splitTags(source.Theme_Tags).slice(0, 3).join(" / ");
  const use = source.How_to_use_in_Metro_Rescue;
  return `该文在本知识库中主要定位为“${inferArticleRole(source)}”。主题标签为 ${tags || "未标注"}；在 Metro Rescue 中的使用边界是：${use}`;
}

main();
