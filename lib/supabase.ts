import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type ResearchDocument = {
  id: string;
  user_id: string;
  filename: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  notes: string | null;
  created_at: string;
};

export type ResearchAnalysisJob = {
  id: string;
  user_id: string;
  document_id: string;
  analysis_type: string;
  status: "pending" | "queued" | "running" | "completed" | "failed" | "configuration_required";
  status_message: string | null;
  result_json: unknown | null;
  error_message: string | null;
  github_run_url: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  research_documents?: Pick<ResearchDocument, "filename" | "storage_path" | "mime_type" | "size_bytes"> | null;
};

let browserClient: SupabaseClient | null = null;

export function hasSupabaseBrowserConfig() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && getSupabasePublishableKey());
}

export function getSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = getSupabasePublishableKey();

  if (!url || !publishableKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or Supabase publishable key.");
  }

  browserClient ??= createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });

  return browserClient;
}

export function getSupabaseServerClient(accessToken?: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = getSupabasePublishableKey();

  if (!url || !publishableKey) {
    throw new Error("Missing Supabase environment variables.");
  }

  return createClient(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: accessToken
      ? {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      : undefined,
  });
}

function getSupabasePublishableKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}
