# Prompt Alignment Map (Aibaji -> Runtime)

Last updated: 2026-02-17

## Section Mapping

| Template Section | Runtime Source | Status | Notes |
|---|---|---|---|
| Identity / Role Engine | `lib/prompt/promptOs.ts` -> `buildPromptOs` | Aligned | Prompt-only in-character output enforced. |
| Output Constraints | `lib/prompt/promptOs.ts` | Aligned | JSON/meta leakage and user-impersonation blocked. |
| Channel Protocol | `lib/prompt/promptOs.ts` + `app/api/chat/route.ts` (`inputEvent`) | Aligned | TALK/FUNC/SCHEDULE behaviors are explicit. |
| Fact Reconcile | `lib/prompt/promptOs.ts` + `app/api/chat/route.ts` guardrails | Partial | Runtime reconcile hint exists; can still deepen reconcile templates. |
| Multi-cast Subject Control | `app/api/chat/route.ts` (`present_characters`, strict format checks) | Aligned | User-speech impersonation guard + strict multi-cast formatting. |
| Plot Granularity | `run_state.plot_granularity` -> `derivePromptOsPolicy` | Aligned | New dedicated policy slice: LINE / BEAT / SCENE. |
| Ending Anti-repeat | `style_guard` -> `derivePromptOsPolicy` | Aligned | New dedicated policy slice with anti-repeat window and ending mix. |
| Dynamic Context Assembly | `lib/prompt/dynamicContext.ts` | Aligned | Runtime state, memory, ledger, profile packed each turn. |
| Ledger Injection | `dynamicContext` FACT_LEDGER + patch validation | Aligned | NPC / inventory / wardrobe / relation / events included. |

## Machine-readable Mirror

- `docs/aibaji/prompt_alignment_map.json`
- Purpose: keep section-level runtime traceability consumable by tooling/regression checks.

## Gaps Remaining

1. Reconcile templates can be made more explicit for conflict-heavy turns.
2. Plot board and ending policy can be exposed in UI for creator tuning.
3. Add regression tests for prompt policy derivation from conversation state.
