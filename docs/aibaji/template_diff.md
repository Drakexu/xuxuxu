# Prompt Template Alignment (Aibaji -> This Repo)

Last updated: 2026-02-16

Source references:
- `docs/aibaji/prompt_os_template.txt`
- `docs/aibaji/memory_plan.txt`
- `docs/aibaji/relationship_ladder_designer.txt`

## Current Match
- Main chat remains prompt-only (no JSON in assistant text).
- INPUT_EVENT path is wired for:
  - `TALK_HOLD`
  - `FUNC_HOLD`
  - `TALK_DBL`
  - `FUNC_DBL`
  - `SCHEDULE_TICK`
  - `SCHEDULE_PLAY`
  - `SCHEDULE_PAUSE`
- Memory layering exists in runtime context:
  - memory A (recent raw messages)
  - memory B (bucket summaries)
  - daily + biweekly aggregate tables
- Fact ledger exists and is injected:
  - inventory
  - wardrobe
  - npc_database
  - event_log
  - relation_ledger
- Async PatchScribe pipeline exists:
  - queue table: `patch_jobs`
  - cron worker: `/api/cron/patch`
  - optimistic lock and retry in patch apply flow

## Newly Completed in This Checkpoint
- Files:
  - `app/api/chat/route.ts`
  - `app/api/state/schedule/route.ts`
  - `app/api/state/relationship/route.ts`
  - `app/api/cron/schedule/route.ts`
  - `app/chat/[characterId]/page.tsx`
  - `lib/presentation/cues.ts`
- Output guardrail hardening:
  - reject assistant output that impersonates user speech
  - enforce `FUNC_DBL` as non-dialogue mode
  - enforce `SCHEDULE_TICK` as single bracket snippet mode
  - enforce strict multi-cast role-line output when requested
- Multi-cast control hardening:
  - better strict mode detection (`isStrictMultiCast`)
  - better exit detection (`isExitMultiCast`)
  - stronger `present_characters` extraction from role lines and lists
- Reconcile trigger expansion:
  - Chinese + English trigger terms in `run.reconcile_hint`
- Dynamic context prompt assembly split:
  - moved assembly from `app/api/chat/route.ts` into `lib/prompt/dynamicContext.ts`
  - runtime behavior preserved; structure is now moduleized for further template slice alignment
- Prompt OS split:
  - moved `PROMPT_OS` out of `app/api/chat/route.ts` into `lib/prompt/promptOs.ts`
  - now structured in sections (identity/protocol/constraints/reconcile/stage/style/self-check)
- Prompt policy runtimeization:
  - `buildPromptOs` now supports runtime policy injection
  - `derivePromptOsPolicy` reads conversation state and generates policy per turn
  - added dedicated slices for:
    - `PLOT_GRANULARITY_POLICY`
    - `ENDING_ANTI_REPEAT_POLICY`
  - `/api/chat` now builds Prompt OS per turn instead of static constant-only injection
  - creator/runtime control path added:
    - `/api/state/prompt-policy` writes `plot_granularity` / `ending_mode` / repeat window into conversation state
    - chat execution console can adjust and persist these defaults to `characters.settings.prompt_policy`
    - character edit page can set role-level defaults for the same policy fields
- Patch quality gate is now evidence-aware:
  - `lib/patchValidation.ts` downgrades `confirmed=true` when turn text evidence is missing
  - applies to event/npc/relation add operations and wardrobe confirmation
  - multi-cast/NPC consistency gate:
    - auto-fallback `narration_mode` from `MULTI_CAST` to `DIALOG` when present roles are insufficient
    - prevent writing currently present speaking roles into `npc_database`
    - require evidence for unconfirmed NPC add/update records
- Schedule control loop is now closed:
  - added state API for `PLAY/PAUSE/LOCK/UNLOCK`
  - cron `schedule` route now honors manual pause + story lock
  - expired story lock is auto-cleared to `PLAY` best-effort
- Relationship execution control is now writable from UI:
  - added state API for `relationshipStage` and `romanceMode`
  - chat page can set stage (`S1..S7`) and romance mode (`ON/OFF`)
  - optional persistence to character settings is supported
- Presentation cue engine is now active in chat:
  - infer emotion/scene tags from assistant text
  - auto-pick best background candidate from character assets
  - manual background override remains available

## Intentional Difference
- Aibaji prompt-only template forbids main-thread state patch output.
- This repo keeps user-facing output prompt-only but still applies structured updates asynchronously via PatchScribe.

## Remaining Gaps (Priority)
1. Prompt module assembly (partial)
- Done:
  - dynamic context moduleized
  - prompt OS moduleized
- Remaining:
  - optional: surface per-role ending mix presets (`next_endings_prefer`) in creator UI

2. Prompt-to-template traceability
- Added `docs/aibaji/prompt_alignment_map.md`.
- Remaining:
  - optional machine-readable JSON mirror for regression tooling.

3. Patch quality gates (partial)
- Done:
  - schema and enum sanitization
  - confirmed-fact downgrade based on turn evidence
  - multi-cast/NPC consistency checks for turn-level patch input
- Remaining:
  - add contradiction checks across recent turns (cross-turn consistency)

4. UI parity and social-surface depth
- Emoji/expression visual layer and clothing composition are still basic.
- Feed/social interactions are still read-only (no like/comment/repost behaviors).
- Marketplace growth loop (copy/fork/rank/recommend) still needs product polish.

## Next Actions
1. Add creator-facing controls for plot granularity and ending mode persistence.
2. Add machine-readable template alignment checklist (JSON mirror).
3. Add cross-turn contradiction checks on patch output.
4. Expand visual layer: expression/outfit/background composed render states.

## Traceability Artifact
- New mapping doc: `docs/aibaji/prompt_alignment_map.md`
