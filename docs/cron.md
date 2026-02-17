# Cron Jobs

This project uses scheduled API routes to run background work (patching, memory summarization, schedule ticks).

## Vercel Cron

`vercel.json` defines cron schedules:

- `/api/cron/patch` every 2 minutes
- `/api/cron/memory` every 10 minutes
- `/api/cron/schedule` hourly
- `/api/cron/conversations` every 30 minutes

## Schedule Control Integration

`/api/cron/schedule` now reads per-conversation control state from `conversation_states`:

- `schedule_board.manual_control`
- `schedule_board.schedule_state` (`PLAY` / `PAUSE`)
- `schedule_board.lock_mode`
- `schedule_board.story_lock_until`

Behavior:

- If manual control is `PAUSE`, scheduled auto posts are skipped.
- If `lock_mode = story_lock` and lock is still active, scheduled auto posts are skipped.
- If story lock is expired, cron best-effort auto-clears lock and restores `PLAY`.
- `MOMENT_POST` defaults to strict hourly mode: max 1 post per UTC hour per conversation.
  - Can be switched to probabilistic mode with `MOMENT_POST_STRICT_HOURLY=false`.
  - In probabilistic mode, cadence is controlled by `MOMENT_POST_MINUTES` + `MOMENT_POST_PROB`.
- Idle detection for schedule generation now uses this anchor priority:
  - latest user message time
  - else latest message time
  - else conversation creation time
  This allows newly unlocked roles (with bootstrapped conversations) to start autonomous hourly ticks even before first user utterance.

Control writes are handled by:

- `POST /api/state/schedule` (`PLAY`, `PAUSE`, `LOCK`, `UNLOCK`)

All cron routes require `CRON_SECRET` and accept it via:

- Query parameter: `?secret=...`
- Header: `x-cron-secret: ...`
- Header: `Authorization: Bearer ...`

On Vercel, set `CRON_SECRET` in **Project Settings -> Environment Variables** (Production), then redeploy.

## Required Server Env

- `CRON_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY` (admin client for cron routes)
- `MINIMAX_API_KEY`, `MINIMAX_BASE_URL` (for memory/schedule generation)
- `CONVERSATION_BOOTSTRAP_SCAN_LIMIT` (optional; default `1200`)
- `CONVERSATION_BOOTSTRAP_CREATE_LIMIT` (optional; default `240`)

## Conversation Bootstrap Cron

`/api/cron/conversations` backfills one default conversation for unlocked roles that currently have none.

Purpose:

- ensure historical unlocked roles (created before conversation bootstrap logic) can enter autonomous schedule flow
- avoid requiring manual re-unlock or first user utterance for schedule startup

Behavior:

- scans recent characters, filters unlocked-from-square roles, checks existing `conversations`
- creates one conversation per missing role (best effort)
- supports `dryRun`, `scanLimit`, `createLimit` query params for controlled replay

## Patch Job Recovery Model

- `/api/chat` enqueues one `patch_jobs` row after each assistant turn.
- `/api/cron/patch` reads jobs with `status = pending | failed` and applies them.
- Every apply attempt:
  - reads latest `conversation_states` + `character_states` with `version`,
  - applies patch with idempotency check (`run_state.applied_patch_job_ids`),
  - writes state with optimistic version checks.
- On version conflict:
  - the job is marked `processing` with incremented `attempts`,
  - sleeps shortly (80ms exponential backoff) and retries up to 5 times.
- When attempts reach max and still failing:
  - status becomes `failed` and `last_error` is kept for diagnosis.
- This ensures async patching is eventually consistent and avoids overwriting newer state.

### Recommended Vercel configuration

Use the included defaults unless traffic is very high:

- `PATCH_CRON_PATH = /api/cron/patch`
- `VERCEL_CRON_SECRET =` your secret string passed as `CRON_SECRET` in env
- Keep patch cron at `*/2 * * * *` (every 2 minutes), and scale to `* * * * *` only if needed.
- Keep memory cron at `*/10 * * * *` for stable usage.
- Keep schedule cron at `0 * * * *` (hourly posts/diary hooks).
- Keep conversations bootstrap cron at `*/30 * * * *`.
- Keep `MOMENT_POST_STRICT_HOURLY=true` for "朋友圈每小时一条" behavior.

### Backlog catch-up playbook

When `patch_jobs` backlog grows (for example after deployment downtime), use this sequence:

1. Increase batch safely:
- set `PATCH_CRON_BATCH=30` (default is 10, max enforced in route is 50).
- keep cron at `*/2 * * * *` first; only move to `* * * * *` if backlog is still growing.

2. Watch job state distribution:
- `pending` should trend down.
- `failed` should stay low and stable.
- `processing` should not remain stuck for long windows.

3. Roll back to normal once recovered:
- reset `PATCH_CRON_BATCH=10`.
- keep `*/2 * * * *` schedule.

### Suggested monitoring queries

```sql
-- queue shape
select status, count(*) as n
from patch_jobs
group by status
order by status;

-- recent failures
select id, conversation_id, turn_seq, attempts, last_error, updated_at
from patch_jobs
where status = 'failed'
order by updated_at desc
limit 50;

-- old pending jobs (possible stuck signals)
select id, conversation_id, turn_seq, attempts, created_at, updated_at
from patch_jobs
where status in ('pending', 'processing')
  and created_at < now() - interval '30 minutes'
order by created_at asc
limit 100;
```

### Manual replay during incident

Use the patch cron endpoint directly (same auth as Vercel cron):

```powershell
$secret = (Select-String -Path .env.local -Pattern '^CRON_SECRET=' | Select-Object -First 1).Line.Split('=',2)[1].Trim()
Invoke-WebRequest -Method GET -Uri "http://localhost:3000/api/cron/patch" -Headers @{ Authorization = "Bearer $secret" } | Select-Object -Expand Content
```

Run it multiple times while observing `processed / ok_count / failed_count`.

## Local Manual Test

Use `Authorization: Bearer` to avoid putting secrets in URLs:

```powershell
$secret = (Select-String -Path .env.local -Pattern '^CRON_SECRET=' | Select-Object -First 1).Line.Split('=',2)[1].Trim()
Invoke-WebRequest -Method GET -Uri "http://localhost:3000/api/cron/memory" -Headers @{ Authorization = "Bearer $secret" } | Select-Object -Expand Content
```

## Health Check (optional)

`/api/cron/patch` returns `processed`, `ok_count`, `failed_count`, and can be monitored in logs.
Use it during rollout to confirm `status` transitions:

- `pending` -> `processing` -> `done`
- `pending/failed` with `attempts` growing when lock conflicts happen
