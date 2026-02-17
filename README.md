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
- Run `supabase/schema_feed_comments.sql` (enables feed comment persistence)
- Run `supabase/schema_square_unlocks.sql` (enables wallet + paid unlock + idempotent unlock receipts)
- Run `supabase/schema_square_social.sql` (enables direct square like/save/comment persistence)

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
- `/wallet`: wallet center (coins, unlock receipts, transaction history)
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

## Feed Comments

- API:
  - `GET /api/feed/comments?messageIds=...&limitPerMessage=...`
  - `POST /api/feed/comments`
  - `DELETE /api/feed/comments`
- Frontend behavior:
  - If `feed_comments` table exists: comments are persisted per user and shown on Home / Character Home feeds
  - If table does not exist: comments UI degrades gracefully with setup hint

## Square Wallet + Unlock

- APIs:
  - `GET /api/wallet/summary`
  - `GET /api/wallet/history`
  - `GET /api/wallet/creator-metrics`
  - `GET /api/square/metrics?ids=...`
  - `GET/POST /api/square/social/reactions`
  - `GET/POST/DELETE /api/square/social/comments`
  - `POST /api/square/unlock`
- Behavior:
  - Unlock now uses server-side idempotent flow (same user/source will not double charge).
  - Supports optional paid unlock via `settings.unlock_price_coins` (or `settings.creation_form.publish.unlock_price_coins`).
  - Supports creator revenue split via `settings.unlock_creator_share_bp` (or `settings.creation_form.publish.unlock_creator_share_bp`), default `7000` (=70%).
  - Square metrics API returns growth signals per source role:
    - `unlocked`, `active`, `likes`, `saves`, `reactions`, `comments`, `sales`, `revenue`, `hot`
  - Optional square social schema (`supabase/schema_square_social.sql`) enables direct social actions on square:
    - role-level like/save (`square_reactions`)
    - role-level comments (`square_comments`)
  - Creator metrics API returns both `topRoles` and full `roleMetrics` for studio ranking/filtering.
  - If wallet schema is missing, unlock API gracefully falls back to legacy free unlock path.
