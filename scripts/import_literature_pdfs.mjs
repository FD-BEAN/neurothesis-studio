import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { PDFParse } from "pdf-parse";

const require = createRequire(import.meta.url);
const seedKnowledgeBase = require("../lib/metro_rescue_seed_kb.json");

const args = new Set(process.argv.slice(2));
const commit = args.has("--commit");
const sourceDir = getArgValue("--source") || process.env.PDF_SOURCE || "work/literature_pdf_import/extracted";
const planPath = getArgValue("--plan") || "work/literature_pdf_import/import_plan.json";

loadDotEnv(".env.local");

const seedTitleByFilename = new Map(
  seedKnowledgeBase.sources.map((source) => [normalizeFilename(source.Filename), source.Title]),
);

const pdfFiles = await listPdfFiles(sourceDir);
if (!pdfFiles.length) {
  throw new Error(`No PDF files found in ${sourceDir}`);
}

const plan = [];
for (const filePath of pdfFiles) {
  const buffer = await readFile(filePath);
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 16);
  const originalFilename = path.basename(filePath);
  const titleFromSeed = seedTitleByFilename.get(normalizeFilename(originalFilename));
  const inferred = titleFromSeed
    ? { title: titleFromSeed, source: "seed-kb" }
    : await inferPdfTitle(buffer, originalFilename);
  const displayTitle = cleanupTitle(inferred.title || originalFilename.replace(/\.pdf$/i, ""));

  plan.push({
    filePath,
    originalFilename,
    displayTitle,
    titleSource: inferred.source,
    sizeBytes: buffer.length,
    sha256: hash,
    documentFilename: `${sanitizeDisplayFilename(displayTitle)}.pdf`,
    storageSlug: `${hash}-${asciiSlug(displayTitle)}.pdf`,
  });
}

await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
console.log(`Prepared ${plan.length} PDF import rows.`);
console.log(`Plan written to ${planPath}.`);

if (!commit) {
  console.log("Dry run only. Re-run with --commit after configuring Supabase credentials.");
  printPreview(plan);
  process.exit(0);
}

const { client, userId } = await getSupabaseClientAndUser();
let uploaded = 0;
let skipped = 0;

for (const item of plan) {
  const storagePath = `${userId}/literature/${item.storageSlug}`;
  const { data: existing } = await client
    .from("research_documents")
    .select("id,filename,storage_path")
    .eq("storage_path", storagePath)
    .maybeSingle();

  if (existing) {
    skipped += 1;
    console.log(`skip existing: ${item.documentFilename}`);
    continue;
  }

  const buffer = await readFile(item.filePath);
  const { error: uploadError } = await client.storage.from("research-files").upload(storagePath, buffer, {
    contentType: "application/pdf",
    upsert: false,
  });

  if (uploadError && !/already exists/i.test(uploadError.message)) {
    throw new Error(`Upload failed for ${item.originalFilename}: ${uploadError.message}`);
  }

  const notes = `IMPORTED_PDF_V1::${JSON.stringify({
    originalFilename: item.originalFilename,
    extractedTitle: item.displayTitle,
    titleSource: item.titleSource,
    sha256: item.sha256,
    importedAt: new Date().toISOString(),
  })}`;

  const { error: insertError } = await client.from("research_documents").insert({
    user_id: userId,
    filename: item.documentFilename,
    storage_path: storagePath,
    mime_type: "application/pdf",
    size_bytes: item.sizeBytes,
    notes,
  });

  if (insertError) {
    throw new Error(`Metadata insert failed for ${item.originalFilename}: ${insertError.message}`);
  }

  uploaded += 1;
  console.log(`uploaded: ${item.documentFilename}`);
}

console.log(`Done. Uploaded ${uploaded}, skipped ${skipped}.`);

async function listPdfFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listPdfFiles(fullPath)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
      files.push(fullPath);
    }
  }
  return files.sort((a, b) => a.localeCompare(b, "zh-CN"));
}

async function inferPdfTitle(buffer, originalFilename) {
  const parser = new PDFParse({ data: buffer });
  try {
    const info = await parser.getInfo();
    const metaTitle = cleanupTitle(info?.info?.Title || "");
    if (isPlausibleTitle(metaTitle)) {
      return { title: metaTitle, source: "pdf-metadata" };
    }

    const firstPage = await parser.getText({ first: 1 });
    const title = inferTitleFromFirstPage(firstPage.text || "", originalFilename);
    return { title, source: "first-page" };
  } catch (error) {
    return {
      title: originalFilename.replace(/\.pdf$/i, ""),
      source: `filename-fallback:${error instanceof Error ? error.message : "unknown"}`,
    };
  } finally {
    await parser.destroy();
  }
}

function inferTitleFromFirstPage(text, originalFilename) {
  const lines = String(text)
    .split(/\n+/)
    .map(cleanupTitle)
    .filter(Boolean)
    .slice(0, 80);
  const candidates = [];

  for (let index = 0; index < Math.min(lines.length, 24); index += 1) {
    const one = lines[index];
    const two = cleanupTitle(`${lines[index]} ${lines[index + 1] || ""}`);
    const three = cleanupTitle(`${lines[index]} ${lines[index + 1] || ""} ${lines[index + 2] || ""}`);
    for (const candidate of [three, two, one]) {
      if (isPlausibleTitle(candidate)) candidates.push(candidate);
    }
  }

  candidates.sort((a, b) => scoreTitle(b) - scoreTitle(a));
  return candidates[0] || originalFilename.replace(/\.pdf$/i, "");
}

function cleanupTitle(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^\d{4}-\d{4}\/[^\s]+ Published by Elsevier Ltd\.\s*/i, "")
    .replace(/^©?\s*\d{4}\s+Published by .*?\.\s*/i, "")
    .replace(/^https?:\/\/\S+\s*/i, "")
    .replace(/^doi:\s*\S+\s*/i, "")
    .trim();
}

function isPlausibleTitle(value) {
  if (!value || value.length < 12 || value.length > 220) return false;
  if (/^(abstract|keywords|introduction|article|contents|references|available online|received|accepted|copyright)/i.test(value)) {
    return false;
  }
  if (/^(microsoft word|elsevier|sciencedirect|frontiers)$/i.test(value)) return false;
  if (/^\d+$/.test(value)) return false;
  return true;
}

function scoreTitle(value) {
  let score = 0;
  if (/[a-zA-Z]{4}/.test(value)) score += 10;
  if (/evacuation|wayfinding|signage|virtual|reality|eeg|navigation|emergency|fire|subway|indoor/i.test(value)) {
    score += 10;
  }
  if (value.length >= 35 && value.length <= 150) score += 8;
  if (/[.!?]$/.test(value)) score -= 2;
  if (/\b(abstract|keywords|journal|vol|pages)\b/i.test(value)) score -= 20;
  return score;
}

async function getSupabaseClientAndUser() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL.");

  if (serviceRoleKey) {
    const client = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const userId = process.env.IMPORT_USER_ID || (await findUserIdByEmail(client, process.env.IMPORT_USER_EMAIL));
    if (!userId) {
      throw new Error("With SUPABASE_SERVICE_ROLE_KEY, set IMPORT_USER_ID or IMPORT_USER_EMAIL.");
    }
    return { client, userId };
  }

  const email = process.env.IMPORT_EMAIL || process.env.SUPABASE_AUTH_EMAIL;
  const password = process.env.IMPORT_PASSWORD || process.env.SUPABASE_AUTH_PASSWORD;
  if (!publishableKey || !email || !password) {
    throw new Error(
      "Missing auth. Set SUPABASE_SERVICE_ROLE_KEY + IMPORT_USER_ID/IMPORT_USER_EMAIL, or IMPORT_EMAIL + IMPORT_PASSWORD.",
    );
  }

  const client = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    throw new Error(`Supabase sign-in failed: ${error?.message ?? "no user"}`);
  }
  return { client, userId: data.user.id };
}

async function findUserIdByEmail(client, email) {
  if (!email) return "";
  const { data, error } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`Could not list Supabase users: ${error.message}`);
  const user = data.users.find((item) => item.email?.toLowerCase() === email.toLowerCase());
  return user?.id || "";
}

function sanitizeDisplayFilename(value) {
  return cleanupTitle(value)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function asciiSlug(value) {
  const slug = String(value)
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 90);
  return slug || "paper";
}

function normalizeFilename(value) {
  return path
    .basename(String(value || ""))
    .toLowerCase()
    .replace(/\.pdf$/i, "")
    .replace(/\(\d+\)/g, "")
    .replace(/科研通-ablesci\.com/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "");
}

function loadDotEnv(file) {
  readEnvFile(file).forEach(([key, value]) => {
    if (!process.env[key]) process.env[key] = value;
  });
}

function readEnvFile(file) {
  try {
    const text = require("node:fs").readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
        return [key, value];
      });
  } catch {
    return [];
  }
}

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function printPreview(rows) {
  for (const row of rows.slice(0, 12)) {
    console.log(`- ${row.originalFilename}`);
    console.log(`  -> ${row.documentFilename} (${row.titleSource})`);
  }
  if (rows.length > 12) console.log(`... ${rows.length - 12} more`);
}
