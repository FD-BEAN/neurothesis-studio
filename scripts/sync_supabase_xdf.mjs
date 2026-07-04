import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const BUCKET = "research-files";

const args = parseArgs(process.argv.slice(2));
loadEnv(args.env);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const targetUserId = args.userId || process.env.IMPORT_USER_ID;
const targetEmail = args.userEmail || process.env.IMPORT_USER_EMAIL || process.env.IMPORT_EMAIL || process.env.SUPABASE_AUTH_EMAIL;

if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL.");

const { client, userId } = await getSupabaseClientAndUser();
const documents = await listXdfDocuments(client, userId);

fs.mkdirSync(args.rawDir, { recursive: true });
fs.mkdirSync(path.dirname(args.manifest), { recursive: true });

const manifest = [];
let downloaded = 0;
let reused = 0;

for (const [index, document] of documents.entries()) {
  const localPath = path.join(args.rawDir, buildLocalFilename(document, index + 1));
  const existingSize = fs.existsSync(localPath) ? fs.statSync(localPath).size : -1;
  if (!args.refresh && existingSize === Number(document.size_bytes || -1)) {
    reused += 1;
  } else {
    const { data, error } = await client.storage.from(BUCKET).download(document.storage_path);
    if (error || !data) {
      throw new Error(`Failed to download ${document.filename}: ${error?.message || "no data"}`);
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    fs.writeFileSync(localPath, buffer);
    downloaded += 1;
  }

  manifest.push({
    id: document.id,
    user_id: document.user_id,
    filename: document.filename,
    storage_path: document.storage_path,
    size_bytes: document.size_bytes,
    created_at: document.created_at,
    notes: document.notes || "",
    local_path: localPath.replaceAll("\\", "/"),
  });

  if ((index + 1) % 25 === 0 || index + 1 === documents.length) {
    console.log(`Synced ${index + 1}/${documents.length} XDF files...`);
  }
}

fs.writeFileSync(args.manifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const sequences = documents.map((document) => inferSequenceIndex(document.filename)).filter(Boolean);
const uniqueSequences = new Set(sequences);
const completeSubjects = countCompleteSubjects(documents);

console.log(
  JSON.stringify(
    {
      xdfDocuments: documents.length,
      downloaded,
      reused,
      manifest: args.manifest,
      rawDir: args.rawDir,
      uniqueSequences: uniqueSequences.size,
      minSequence: Math.min(...sequences),
      maxSequence: Math.max(...sequences),
      completeSubjects,
    },
    null,
    2,
  ),
);

function parseArgs(argv) {
  const out = {
    env: ".env.local",
    rawDir: "work/xdf_supabase_raw",
    manifest: "work/xdf_supabase_manifest.json",
    refresh: false,
    userId: "",
    userEmail: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--env") out.env = argv[++index];
    else if (arg === "--raw-dir") out.rawDir = argv[++index];
    else if (arg === "--manifest") out.manifest = argv[++index];
    else if (arg === "--user-id") out.userId = argv[++index];
    else if (arg === "--user-email") out.userEmail = argv[++index];
    else if (arg === "--refresh") out.refresh = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8").replace(/^\uFEFF/, "");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const splitAt = trimmed.indexOf("=");
    const key = trimmed.slice(0, splitAt).replace(/^\uFEFF/, "").trim();
    let value = trimmed.slice(splitAt + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function getSupabaseClientAndUser() {
  if (serviceRoleKey) {
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const resolvedUserId = targetUserId || (await findUserIdByEmail(serviceClient, targetEmail));
    if (!resolvedUserId) throw new Error("Set IMPORT_USER_ID or IMPORT_USER_EMAIL for service-role sync.");
    return { client: serviceClient, userId: resolvedUserId };
  }

  const email = process.env.IMPORT_EMAIL || process.env.SUPABASE_AUTH_EMAIL;
  const password = process.env.IMPORT_PASSWORD || process.env.SUPABASE_AUTH_PASSWORD;
  if (!publishableKey || !email || !password) {
    throw new Error("Missing Supabase auth. Use SUPABASE_SERVICE_ROLE_KEY or IMPORT_EMAIL/IMPORT_PASSWORD.");
  }

  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await authClient.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`Supabase sign-in failed: ${error?.message || "no user"}`);
  return { client: authClient, userId: data.user.id };
}

async function findUserIdByEmail(client, email) {
  if (!email) return "";
  const { data, error } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`Could not list Supabase users: ${error.message}`);
  const user = data.users.find((item) => item.email?.toLowerCase() === email.toLowerCase());
  return user?.id || "";
}

async function listXdfDocuments(client, userId) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from("research_documents")
      .select("id,user_id,filename,storage_path,size_bytes,created_at,notes")
      .eq("user_id", userId)
      .ilike("filename", "%.xdf")
      .order("created_at", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

function buildLocalFilename(document, ordinal) {
  const sequence = inferSequenceIndex(document.filename);
  const sequencePrefix = sequence ? `sub-${String(sequence).padStart(3, "0")}` : `xdf-${String(ordinal).padStart(4, "0")}`;
  const created = String(document.created_at || "").replace(/[^0-9T]/g, "").slice(0, 15) || "no-date";
  const id = String(document.id || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || String(ordinal).padStart(4, "0");
  return `${sequencePrefix}__${created}__${id}__${sanitizeFilename(document.filename)}`;
}

function sanitizeFilename(value) {
  return path
    .basename(String(value || "input.xdf"))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 180);
}

function inferSequenceIndex(filename) {
  const match =
    filename.match(/(?:^|[_-])sub-?p?0*(\d{1,4})(?=[^0-9]|$)/i) ||
    filename.match(/^sub-?p?0*(\d{1,4})(?=[^0-9]|$)/i);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function countCompleteSubjects(documents) {
  const bySubject = new Map();
  for (const document of documents) {
    const sequence = inferSequenceIndex(document.filename);
    if (!sequence) continue;
    const subject = Math.ceil(sequence / 3);
    const position = ((sequence - 1) % 3) + 1;
    if (!bySubject.has(subject)) bySubject.set(subject, new Set());
    bySubject.get(subject).add(position);
  }
  let count = 0;
  for (const positions of bySubject.values()) {
    if ([1, 2, 3].every((position) => positions.has(position))) count += 1;
  }
  return count;
}
