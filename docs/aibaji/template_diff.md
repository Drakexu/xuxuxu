# Prompt Template Alignment (Aibaji -> This Repo)

Source references:

- Aibaji Prompt OS template: `docs/aibaji/prompt_os_template.txt`
- Memory layering plan: `docs/aibaji/memory_plan.txt`
- Relationship ladder designer: `docs/aibaji/relationship_ladder_designer.txt`

## What We Match Today

- Prompt-only main chat output (no JSON/state patch in the assistant message).
- INPUT_EVENT modes:
  - `TALK_HOLD` (dialog)
  - `FUNC_HOLD` (director narration)
  - `TALK_DBL` (permit “you continue the story”)
  - `FUNC_DBL` (CG description only)
  - `SCHEDULE_TICK` (single bracket life snippet)
- Memory layering (no RAG in the critical path):
  - A: recent raw messages (windowed)
  - B: 10-minute buckets (`memory_b_episodes`)
  - Daily aggregates (`memory_daily`) + biweekly (`memory_biweekly`)
- Ledger / “facts not to hallucinate”:
  - `ledger.inventory`, `ledger.wardrobe`, `ledger.npc_database`, `ledger.event_log`, `ledger.relation_ledger`
  - `memory.highlights` is present and injected.
- Async patch pipeline (PatchScribe):
  - queue: `patch_jobs`
  - worker: `/api/cron/patch`
  - optimistic locking on `conversation_states`/`character_states`

## Key Intentional Differences

- The Aibaji “Prompt-only 内化运行版” explicitly avoids `STATE_PATCH` in the main model output.
  - In this repo, main chat output remains prompt-only, but we still run PatchScribe asynchronously to update state/ledger/memory.
  - This keeps the user-facing text clean, while still allowing structured state evolution over time.

## Gaps / Next Steps

- UI parity:
  - Aibaji-style “Moments / Diary / Wardrobe / Assets” need dedicated pages and stronger presentation.
  - Emoji/outfit/background switching is currently best-effort (assets exist, UI layering is minimal).
- Patch quality gates:
  - The template describes validation gates (confirmed facts, schema checks, etc.).
  - We should add stricter validation + downgrade/ignore invalid patches rather than applying them.
- Relationship ladder:
  - Ladder generation exists (`/api/ladder`), but we should actively inject and use it in `RUN_STATE.relationship_stage` and prompt context, not only store it.

