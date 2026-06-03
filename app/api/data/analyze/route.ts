import { NextResponse } from "next/server";
import { getSupabaseServerClient, type ResearchDocument } from "@/lib/supabase";

type RequestBody = {
  documentId?: string;
};

type AnalysisMetric = {
  label: string;
  value: string;
  text?: string;
};

type AnalysisChart =
  | {
      type: "bar";
      title: string;
      xLabel: string;
      yLabel: string;
      data: Array<{ label: string; value: number }>;
    }
  | {
      type: "scatter";
      title: string;
      xLabel: string;
      yLabel: string;
      data: Array<{ label: string; x: number; y: number; group?: string }>;
    };

type AnalysisTable = {
  title: string;
  columns: string[];
  rows: string[][];
};

type AnalysisReport = {
  title: string;
  kind: string;
  summary: string;
  metrics: AnalysisMetric[];
  charts: AnalysisChart[];
  tables: AnalysisTable[];
  notes: string[];
};

type TabularData = {
  columns: string[];
  rows: Record<string, string>[];
};

const MAX_TEXT_ANALYSIS_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";

  if (!token) {
    return NextResponse.json({ error: "Missing Supabase access token." }, { status: 401 });
  }

  const supabase = getSupabaseServerClient(token);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return NextResponse.json({ error: "Invalid or expired Supabase session." }, { status: 401 });
  }

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
  if (researchDocument.user_id !== user.id) {
    return NextResponse.json({ error: "Document does not belong to current user." }, { status: 403 });
  }

  const extension = getExtension(researchDocument.filename);
  if (extension === "xdf") {
    return NextResponse.json({
      report: buildXdfReport(researchDocument),
    });
  }

  if (extension === "pdf" || researchDocument.mime_type?.includes("pdf")) {
    return NextResponse.json({
      report: buildLiteratureEntryReport(researchDocument),
    });
  }

  if ((researchDocument.size_bytes ?? 0) > MAX_TEXT_ANALYSIS_BYTES) {
    return NextResponse.json(
      {
        error: "当前在线分析入口只处理 5 MB 以内的文本型数据。较大的原始数据建议先离线预处理后上传摘要表。",
      },
      { status: 413 },
    );
  }

  const { data: fileBlob, error: downloadError } = await supabase.storage
    .from("research-files")
    .download(researchDocument.storage_path);

  if (downloadError || !fileBlob) {
    return NextResponse.json({ error: downloadError?.message ?? "Failed to download file." }, { status: 500 });
  }

  const text = await fileBlob.text();
  const report = analyzeTextLikeFile(researchDocument, extension, text);

  return NextResponse.json({ report });
}

function analyzeTextLikeFile(document: ResearchDocument, extension: string, text: string): AnalysisReport {
  if (["csv", "tsv"].includes(extension)) {
    const delimiter = extension === "tsv" ? "\t" : detectDelimiter(text);
    return analyzeTabular(document, parseDelimited(text, delimiter), extension.toUpperCase());
  }

  if (["json", "jsonl"].includes(extension)) {
    const tabular = parseJsonLike(text, extension);
    if (tabular.rows.length) {
      return analyzeTabular(document, tabular, extension.toUpperCase());
    }
  }

  if (extension === "svg") {
    return analyzeSvg(document, text);
  }

  return analyzePlainText(document, text, extension || "TEXT");
}

function analyzeTabular(document: ResearchDocument, table: TabularData, kind: string): AnalysisReport {
  const numericStats = getNumericStats(table);
  const categorical = getCategoricalSummaries(table);
  const signage = getSignageSummary(table);
  const charts: AnalysisChart[] = [];
  const tables: AnalysisTable[] = [];
  const notes: string[] = [];

  const primaryCategory = categorical[0];
  if (primaryCategory) {
    charts.push({
      type: "bar",
      title: `${primaryCategory.column} 分布`,
      xLabel: primaryCategory.column,
      yLabel: "记录数",
      data: primaryCategory.values.slice(0, 14),
    });
  }

  const scatter = getScatterData(table);
  if (scatter.length) {
    charts.push({
      type: "scatter",
      title: "平面坐标分布",
      xLabel: "x",
      yLabel: "z",
      data: scatter,
    });
  }

  if (numericStats.length) {
    tables.push({
      title: "数值变量摘要",
      columns: ["变量", "有效值", "最小值", "最大值", "均值"],
      rows: numericStats.slice(0, 12).map((item) => [
        item.column,
        String(item.count),
        formatNumber(item.min),
        formatNumber(item.max),
        formatNumber(item.mean),
      ]),
    });
  }

  if (categorical.length) {
    tables.push({
      title: "分类变量概览",
      columns: ["变量", "不同取值数", "最高频取值"],
      rows: categorical.slice(0, 8).map((item) => [
        item.column,
        String(item.uniqueCount),
        item.values
          .slice(0, 3)
          .map((value) => `${value.label} (${value.value})`)
          .join("；"),
      ]),
    });
  }

  if (signage) {
    notes.push(
      `识别为 Metro Rescue 标识坐标表：${signage.maps} 个地图、${signage.signatures} 套 Signature，共 ${table.rows.length} 行。`,
    );
    notes.push(
      `各地图标识数量为 ${signage.mapCounts.join("，")}。如果同一地图内不同 Signature 的坐标一致，论文中需要另用操控定义表说明信息设计差异。`,
    );
    if (signage.readability.length) {
      notes.push(`可读范围口径：${signage.readability.join("；")}。`);
    }
  } else if (table.columns.some((column) => column.toLowerCase().includes("event"))) {
    notes.push("表格中包含 event 字段，可以进一步做 marker/event count、trial 切分和行为指标提取。");
  }

  if (!charts.length) {
    notes.push("没有发现足够的分类或坐标字段，当前只生成表格摘要。");
  }

  return {
    title: `${document.filename} 分析摘要`,
    kind,
    summary: buildTabularSummary(table, numericStats.length, categorical.length),
    metrics: [
      { label: "记录数", value: String(table.rows.length) },
      { label: "字段数", value: String(table.columns.length) },
      { label: "数值字段", value: String(numericStats.length) },
      { label: "分类字段", value: String(categorical.length) },
    ],
    charts,
    tables,
    notes,
  };
}

function analyzeSvg(document: ResearchDocument, text: string): AnalysisReport {
  const circleCount = countMatches(text, /<circle\b/gi);
  const textCount = countMatches(text, /<text\b/gi);
  const titleCount = countMatches(text, /<title\b/gi);
  const hasReadabilityLegend = /0-8m|8-12m|blur\/fade|clear/i.test(text);

  return {
    title: `${document.filename} 分析摘要`,
    kind: "SVG",
    summary: "识别为场景平面图或实验材料 SVG。当前分析会检查图形元素数量和可读范围图例口径。",
    metrics: [
      { label: "圆形元素", value: String(circleCount), text: "通常对应标识可读范围圈。" },
      { label: "文字元素", value: String(textCount) },
      { label: "说明元素", value: String(titleCount) },
      { label: "可读范围图例", value: hasReadabilityLegend ? "已识别" : "未识别" },
    ],
    charts: [
      {
        type: "bar",
        title: "SVG 元素数量",
        xLabel: "元素",
        yLabel: "数量",
        data: [
          { label: "circle", value: circleCount },
          { label: "text", value: textCount },
          { label: "title", value: titleCount },
        ],
      },
    ],
    tables: [],
    notes: [
      hasReadabilityLegend
        ? "图例中包含 0-8m / 8-12m 或 clear / blur-fade 口径，可与 Methods 图注保持一致。"
        : "没有识别到明确的 0-8m / 8-12m 图例，建议人工核对图注。",
    ],
  };
}

function analyzePlainText(document: ResearchDocument, text: string, kind: string): AnalysisReport {
  const lines = text.split(/\r?\n/);
  const nonEmptyLines = lines.filter((line) => line.trim()).length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const keywordCounts = ["EEG", "VR", "Unity", "LSL", "marker", "Signature", "Metro", "cognitive load"].map((keyword) => ({
    label: keyword,
    value: countMatches(text, new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")),
  }));

  return {
    title: `${document.filename} 文本摘要`,
    kind,
    summary: "识别为文本型研究材料。当前分析会统计文本规模和 Metro Rescue 相关关键词。",
    metrics: [
      { label: "字符数", value: String(text.length) },
      { label: "行数", value: String(lines.length) },
      { label: "非空行", value: String(nonEmptyLines) },
      { label: "词段数", value: String(words) },
    ],
    charts: [
      {
        type: "bar",
        title: "关键词出现次数",
        xLabel: "关键词",
        yLabel: "次数",
        data: keywordCounts,
      },
    ],
    tables: [],
    notes: ["文本摘要不等于论文结论；正式写作仍需要引用原始材料和统计结果。"],
  };
}

function buildXdfReport(document: ResearchDocument): AnalysisReport {
  return {
    title: `${document.filename} XDF 质控入口`,
    kind: "XDF",
    summary:
      "识别为 LabRecorder XDF 原始文件。线上 Node 后端暂不直接解析 XDF 二进制；当前入口先给出质控路径，避免把大体量 EEG 原始数据误当作普通表格处理。",
    metrics: [
      { label: "文件类型", value: "LabRecorder .xdf" },
      { label: "文件大小", value: formatBytes(document.size_bytes) },
      { label: "建议处理", value: "先做 XDF QC" },
      { label: "线上解析", value: "待接入 Python worker" },
    ],
    charts: [],
    tables: [
      {
        title: "建议输出的质控指标",
        columns: ["层级", "检查项", "用途"],
        rows: [
          ["stream", "MetroRescueMarkers / Mitsar EEG 数量", "确认 marker 与 EEG 是否同时存在"],
          ["session", "subject / session / map / signature / audio", "切分有效 trial"],
          ["marker", "session_start / map_start / evacuation_complete", "判断任务是否完整"],
          ["EEG", "采样率、通道数、时长、重复 stream", "决定进入哪条预处理流水线"],
        ],
      },
    ],
    notes: [
      "本仓库已有 `scripts/xdf_qc.py`，可以在本地或后续 Python worker 中读取 XDF 并输出 JSON 报告。",
      "等接入 worker 后，界面可以展示 stream 表、event count、session 时间轴和 EEG 时长概览。",
    ],
  };
}

function buildLiteratureEntryReport(document: ResearchDocument): AnalysisReport {
  return {
    title: `${document.filename} 文献知识库入口`,
    kind: "LITERATURE",
    summary:
      "这是一篇文献 PDF。它不进入 XDF 高级分析。请在文献区生成知识卡片，系统会抽取论文目的、方法、EEG/行为指标、主要发现、局限和对 Metro Rescue 的可引用价值。",
    metrics: [
      { label: "文件类型", value: "PDF" },
      { label: "文件大小", value: formatBytes(document.size_bytes) },
      { label: "推荐操作", value: "建立知识卡片" },
      { label: "分析边界", value: "不作为实验原始数据" },
    ],
    charts: [],
    tables: [
      {
        title: "文献知识卡片字段",
        columns: ["字段", "用途"],
        rows: [
          ["研究问题", "写 Introduction 和研究假设时引用"],
          ["方法与任务", "对照 VR / wayfinding / EEG 研究设计"],
          ["EEG 或行为指标", "整理可比指标和分析窗口"],
          ["主要发现", "形成文献矩阵，不替代本研究结果"],
          ["局限与启发", "写 Discussion 和方法局限"],
        ],
      },
    ],
    notes: [
      "文献知识库会持久保存结构化卡片；AI 写作助手回答时会优先读取这些卡片，并按论文标题或文件名引用。",
      "如果 PDF 是扫描版，自动抽取可能不足，需要后续加 OCR 或上传可复制文本版本。",
    ],
  };
}

function parseDelimited(text: string, delimiter: string): TabularData {
  const rows = splitDelimitedRows(text, delimiter).filter((row) => row.some((cell) => cell.trim() !== ""));
  const headers = rows[0]?.map((cell, index) => cell.trim() || `column_${index + 1}`) ?? [];

  return {
    columns: headers,
    rows: rows.slice(1).map((row) =>
      Object.fromEntries(headers.map((header, index) => [header, row[index]?.trim() ?? ""])),
    ),
  };
}

function splitDelimitedRows(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

function parseJsonLike(text: string, extension: string): TabularData {
  const values =
    extension === "jsonl"
      ? text
          .split(/\r?\n/)
          .filter((line) => line.trim())
          .map((line) => JSON.parse(line) as unknown)
      : JSON.parse(text);
  const records = Array.isArray(values) ? values : [values];
  const objectRows = records.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
  const columns = Array.from(new Set(objectRows.flatMap((row) => Object.keys(row))));

  return {
    columns,
    rows: objectRows.map((row) =>
      Object.fromEntries(columns.map((column) => [column, stringifyCell(row[column])])),
    ),
  };
}

function getNumericStats(table: TabularData) {
  return table.columns
    .map((column) => {
      const values = table.rows.map((row) => Number(row[column])).filter((value) => Number.isFinite(value));
      if (!values.length || values.length < Math.max(3, table.rows.length * 0.3)) return null;
      const sum = values.reduce((total, value) => total + value, 0);
      return {
        column,
        count: values.length,
        min: Math.min(...values),
        max: Math.max(...values),
        mean: sum / values.length,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function getCategoricalSummaries(table: TabularData) {
  return table.columns
    .map((column) => {
      const values = table.rows.map((row) => row[column]).filter((value) => value !== "");
      const counts = countBy(values);
      const uniqueCount = counts.size;
      if (!uniqueCount || uniqueCount > Math.max(24, table.rows.length * 0.65)) return null;
      return {
        column,
        uniqueCount,
        values: Array.from(counts.entries())
          .map(([label, value]) => ({ label, value }))
          .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => b.values[0].value - a.values[0].value);
}

function getScatterData(table: TabularData) {
  const xColumn = findColumn(table.columns, ["x", "pos_x", "position_x"]);
  const zColumn = findColumn(table.columns, ["z", "pos_z", "position_z", "y"]);
  if (!xColumn || !zColumn) return [];

  const labelColumn = findColumn(table.columns, ["sign", "event", "id", "name"]) ?? table.columns[0];
  const groupColumn = findColumn(table.columns, ["map", "signature", "condition"]);

  return table.rows
    .map((row, index) => ({
      label: row[labelColumn] || `row ${index + 1}`,
      x: Number(row[xColumn]),
      y: Number(row[zColumn]),
      group: groupColumn ? row[groupColumn] : undefined,
    }))
    .filter((row) => Number.isFinite(row.x) && Number.isFinite(row.y))
    .slice(0, 160);
}

function getSignageSummary(table: TabularData) {
  const mapColumn = findColumn(table.columns, ["map"]);
  const signatureColumn = findColumn(table.columns, ["signature", "signage"]);
  if (!mapColumn || !signatureColumn) return null;

  const mapCounts = Array.from(countBy(table.rows.map((row) => row[mapColumn])).entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, value]) => `${label}: ${value}`);
  const readabilityColumns = ["clear_radius_m", "blur_end_radius_m", "far_mip", "far_fade"]
    .map((column) => findColumn(table.columns, [column]))
    .filter((column): column is string => Boolean(column));
  const readability = readabilityColumns.map((column) => {
    const values = Array.from(new Set(table.rows.map((row) => row[column]).filter(Boolean))).join(", ");
    return `${column} = ${values}`;
  });

  return {
    maps: countBy(table.rows.map((row) => row[mapColumn])).size,
    signatures: countBy(table.rows.map((row) => row[signatureColumn])).size,
    mapCounts,
    readability,
  };
}

function buildTabularSummary(table: TabularData, numericCount: number, categoricalCount: number) {
  return `识别为表格型研究数据，共 ${table.rows.length} 行、${table.columns.length} 个字段；其中 ${numericCount} 个字段可作为数值变量，${categoricalCount} 个字段适合做分组或条件变量。`;
}

function detectDelimiter(text: string) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const candidates = [",", "\t", ";"];
  return candidates
    .map((delimiter) => ({ delimiter, count: firstLine.split(delimiter).length }))
    .sort((a, b) => b.count - a.count)[0].delimiter;
}

function findColumn(columns: string[], candidates: string[]) {
  const normalized = columns.map((column) => ({ original: column, lower: column.toLowerCase() }));
  return normalized.find((column) => candidates.includes(column.lower))?.original;
}

function countBy(values: string[]) {
  const counts = new Map<string, number>();
  values.forEach((rawValue) => {
    const value = rawValue || "<empty>";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });
  return counts;
}

function countMatches(text: string, pattern: RegExp) {
  return text.match(pattern)?.length ?? 0;
}

function stringifyCell(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function getExtension(filename: string) {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex >= 0 ? filename.slice(dotIndex + 1).toLowerCase() : "";
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function formatBytes(size: number | null) {
  if (size === null) return "unknown";
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
