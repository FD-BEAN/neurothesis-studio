# Deployment Notes

## Secure App

The secure app is a Next.js project and should be deployed on Vercel, not GitHub Pages.

Recommended production branch:

```text
next-supabase-secure
```

## Required Environment Variables

Add these in Vercel Project Settings -> Environment Variables:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
OPENAI_API_KEY
OPENAI_MODEL
```

Older Supabase projects may show `NEXT_PUBLIC_SUPABASE_ANON_KEY` instead. The app accepts either variable name.

`OPENAI_API_KEY` must never be committed to git.

## Supabase

Run:

```powershell
supabase/schema.sql
```

in Supabase SQL Editor.

## Local Development

```powershell
npm install
copy .env.example .env.local
npm run dev
```

## Legacy Static Site

The previous GitHub Pages prototype is preserved in:

```text
legacy-static/
```
