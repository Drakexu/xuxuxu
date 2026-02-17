# xuxuxu

Web implementation of the Aibaji-style character experience (voice excluded), built with Next.js App Router + Supabase.

## Stack

- Next.js 16 (App Router, TypeScript)
- Supabase (Auth + Postgres + Storage)
- MiniMax chat backend integration (`app/api/chat/route.ts`)

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Configure env:

- Copy `.env.example` to `.env.local`
- Fill required values:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_EMAIL_REDIRECT_URL`
  - `MINIMAX_API_KEY`
  - `MINIMAX_BASE_URL`

3. Apply Supabase SQL:

- Run `supabase/schema_v1.sql`
- Run `supabase/schema_feed_reactions.sql` (enables cross-device persistence for feed like/save)

4. Start dev server:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Core Commands

```bash
npm run dev
npm run lint
npx tsc --noEmit
npm run build
npm run start
```

## Key App Surfaces

- `/home`: unlocked/activated character feed (moment/diary/schedule)
- `/square`: public character discovery + unlock/activate
- `/characters`: creator studio + role management
- `/chat/[characterId]`: conversation runtime with state controls

## API Notes

- Chat API response shape is intentionally stable:
  - `conversationId`
  - `assistantMessage`
  - `patchOk`
  - `patchError`
- PatchScribe remains best-effort. Patch failure must not break chat response.

## Feed Reactions

- API:
  - `GET /api/feed/reactions?messageIds=...`
  - `POST /api/feed/reactions`
- Frontend behavior:
  - If `feed_reactions` table exists: sync with backend (cross-device)
  - If table does not exist: graceful fallback to localStorage cache
