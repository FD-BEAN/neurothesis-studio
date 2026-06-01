-- NeuroThesis Studio secure schema
-- Run this in Supabase Dashboard -> SQL Editor after creating your project.

create extension if not exists "pgcrypto";

create table if not exists public.research_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null,
  storage_path text not null unique,
  mime_type text,
  size_bytes bigint,
  notes text default '',
  created_at timestamptz not null default now()
);

alter table public.research_documents enable row level security;

drop policy if exists "Users can read own research documents" on public.research_documents;
create policy "Users can read own research documents"
on public.research_documents
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own research documents" on public.research_documents;
create policy "Users can insert own research documents"
on public.research_documents
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own research documents" on public.research_documents;
create policy "Users can update own research documents"
on public.research_documents
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own research documents" on public.research_documents;
create policy "Users can delete own research documents"
on public.research_documents
for delete
using (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit)
values ('research-files', 'research-files', false, 52428800)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists "Users can upload own research files" on storage.objects;
create policy "Users can upload own research files"
on storage.objects
for insert
with check (
  bucket_id = 'research-files'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "Users can read own research files" on storage.objects;
create policy "Users can read own research files"
on storage.objects
for select
using (
  bucket_id = 'research-files'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "Users can update own research files" on storage.objects;
create policy "Users can update own research files"
on storage.objects
for update
using (
  bucket_id = 'research-files'
  and auth.uid()::text = (storage.foldername(name))[1]
)
with check (
  bucket_id = 'research-files'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "Users can delete own research files" on storage.objects;
create policy "Users can delete own research files"
on storage.objects
for delete
using (
  bucket_id = 'research-files'
  and auth.uid()::text = (storage.foldername(name))[1]
);
