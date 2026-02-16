# Cron Jobs

This project uses scheduled API routes to run background work (patching, memory summarization, schedule ticks).

## Vercel Cron

`vercel.json` defines cron schedules:

- `/api/cron/patch` every 2 minutes
- `/api/cron/memory` every 10 minutes
- `/api/cron/schedule` hourly

All cron routes require `CRON_SECRET` and accept it via:

- Query parameter: `?secret=...`
- Header: `x-cron-secret: ...`
- Header: `Authorization: Bearer ...`

On Vercel, set `CRON_SECRET` in **Project Settings -> Environment Variables** (Production), then redeploy.

## Required Server Env

- `CRON_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY` (admin client for cron routes)
- `MINIMAX_API_KEY`, `MINIMAX_BASE_URL` (for memory/schedule generation)

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
