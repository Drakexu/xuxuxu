# AiBaJi Spec Sources (Local)

These files are copied from the local desktop into this repo so the project intent survives across sessions.

- `docs/aibaji/prompt-only-m2-her-template.txt`
- `docs/aibaji/memory-layering-plan.txt`
- `docs/aibaji/character-creation-form.txt`
- `docs/aibaji/aibaji-overview.txt`
- `docs/aibaji/relationship-ladder-designer.txt`

## Scheduled Memory Jobs

This repo supports scheduled, server-side memory aggregation:

- 10-minute episode summaries (B): stored in `memory_b_episodes`
- Daily aggregates (C0/C1/C2/C3): stored in `memory_daily`
- Biweekly aggregates (D): stored in `memory_biweekly`

Entry point:

- `GET /api/cron/memory?secret=...`

Required env (server-only):

- `SUPABASE_SERVICE_ROLE_KEY` (admin, bypasses RLS for background processing)
- `CRON_SECRET` (protects the cron endpoint)
- `MINIMAX_API_KEY`, `MINIMAX_BASE_URL`

Scheduling:

- Call `/api/cron/memory` every 10 minutes from a cron runner (Vercel Cron, GitHub Actions, a server cron, etc.).
  The handler will:
  - backfill a few missing 10-minute buckets per conversation
  - generate daily aggregates for missing days (bounded per run)
  - generate biweekly aggregates when a 14-day period completes
