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

## Local Manual Test

Use `Authorization: Bearer` to avoid putting secrets in URLs:

```powershell
$secret = (Select-String -Path .env.local -Pattern '^CRON_SECRET=' | Select-Object -First 1).Line.Split('=',2)[1].Trim()
Invoke-WebRequest -Method GET -Uri "http://localhost:3000/api/cron/memory" -Headers @{ Authorization = "Bearer $secret" } | Select-Object -Expand Content
```

