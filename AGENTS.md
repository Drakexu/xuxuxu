# Agent Instructions (xuxuxu)

## Repo Overview
- Next.js App Router project (`app/`), TypeScript.
- Supabase is used for auth/data (`supabase/` for local assets/config).
- Chat endpoint: `app/api/chat/route.ts` (MiniMax chat + optional "PatchScribe" state patching).

## Commands
- Install: `npm install`
- Dev: `npm run dev`
- Lint: `npm run lint`
- Build/start: `npm run build`, `npm run start`

## Environment Variables
- Local env lives in `.env.local` (ignored by git). Use `.env.example` as the template.
- Required for chat:
  - `MINIMAX_API_KEY`
  - `MINIMAX_BASE_URL`
- Optional:
  - `MINIMAX_PATCH_MODEL`
    - If unset, the API will default to `MiniMax-M2.5` for PatchScribe (best-effort). You can override this env var to use a different patch model.
- Supabase public config:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_EMAIL_REDIRECT_URL`

## Coding Conventions
- Keep server-only secrets out of `NEXT_PUBLIC_*`.
- Prefer small, incremental changes with strong runtime checks in API routes (return structured JSON errors).
- Avoid dumping secrets into logs, API responses, or committed files.

## When Editing `app/api/chat/route.ts`
- Maintain backwards compatibility of the JSON response shape:
  - `conversationId`, `assistantMessage`, `patchOk`, `patchError`
- PatchScribe should remain best-effort: failures should not break chat responses.
