# SESSION HANDOFF (xuxuxu)

Last updated: 2026-02-16 (checkpoint: high-target execution v24 - home 3-column workspace revamp)
Repo: `d:/projects/xuxuxu`

## 1) Product Goal (current)
- Target: implement as much of AibaJi web experience as possible (except voice chat).
- Raised milestone target:
  - `Web Beta Milestone`: complete a publicly testable product loop with clear IA and sticky daily usage path.
  - IA must be obvious at first glance:
    - `首页` = unlocked/activated role life feed hub
    - `广场` = discovery + unlock + activate
    - `创建角色` = creator workbench and role management
  - Experience bar:
    - no developer-tool feeling on main pages
    - each primary page has clear hero, metrics, and action loops
    - mobile has dedicated primary navigation entry points
- Priority order requested by user: `2 -> 3 -> 1 -> 4 -> 5`
  - 2: prompt assembly closer to template + module diff alignment
  - 3: stronger subject control and multi-cast turn-taking guardrails
  - 1: strong-consistency PatchScribe apply (optimistic lock + retry)
  - 4: chat UX polish
  - 5: cron catch-up/docs

## 2) What is already done (from code + commit history)
- Async PatchScribe pipeline exists (`patch_jobs` queue + cron worker).
- Patch apply optimistic-lock + retry implemented.
- Patch output sanitization added before applying state.
- User-isolated queries tightened for characters/history.
- Prompt-only chat main flow is in `app/api/chat/route.ts`.
- Social/asset related pages exist:
  - `app/home/page.tsx`
  - `app/square/page.tsx`
  - `app/square/[characterId]/page.tsx`
  - `app/characters/*`
  - `app/chat/[characterId]/page.tsx`
- Cron endpoints and docs exist:
  - `app/api/cron/*`
  - `docs/cron.md`
  - `vercel.json`
- AibaJi reference docs already copied under `docs/aibaji/*`.

## 3) Current workspace status
- Working tree: local feature edits across chat/home/square/patch validation.
- Lint: passes (`npm run lint`).
- Typecheck: passes (`npx tsc --noEmit`).

### Patch consistency v10 checkpoint (latest)
- Files changed:
  - `lib/patchValidation.ts`
  - `app/api/chat/route.ts`
  - `app/api/cron/patch/route.ts`
- Completed:
  - Extended patch sanitization with cross-turn consistency controls:
    - inventory deltas clamped against current state (no negative post-merge counts)
    - dedupe for `event_log_add` / `relation_ledger_add` against existing state
    - relationship stage jump clamp (`Sx`) to avoid unrealistic one-turn leaps
    - state-aware sanitize option (`conversationState`) wired into sanitizer input
  - Upgraded async patch application paths to sanitize against latest loaded state on each apply attempt:
    - chat fire-and-forget patch apply (`/api/chat`)
    - cron patch replay worker (`/api/cron/patch`)
  - Cron path now includes turn evidence text (`turn.user_input + turn.assistant_text`) in sanitize quality gating.
- Validation:
  - `npm run -s lint` -> pass
  - `npx tsc --noEmit` -> pass
  - `npm run -s build` -> pass

### IA/UI alignment v11 checkpoint (latest)
- Files changed:
  - `app/_components/AppShell.tsx`
  - `app/page.tsx`
  - `app/square/page.tsx`
- Completed:
  - Rewrote shell navigation copy and brand blocks to clean CN-first text (removed mojibake-like labels in top-level entry points).
  - Reworked landing page copy to clearly reflect 3-page IA:
    - 首页 (life feed hub)
    - 广场 (discover + unlock + activate)
    - 创建角色 (workbench + assets + publish)
  - Added Square "channel" filtering aligned to AibaJi/Candy-like browsing flow:
    - `全部 / 男频 / 女频 / 青少年`
    - channel inference from role settings/profile metadata (teen mode and audience hints)
    - channel counts exposed in KPI and quick badges
    - channel badge rendered on role cards for faster scan
- Validation:
  - `npm run -s lint` -> pass
  - `npx tsc --noEmit` -> pass
  - `npm run -s build` -> pass

### Creator workbench v12 checkpoint (latest)
- File changed:
  - `app/characters/page.tsx`
- Completed:
  - Upgraded role workbench IA to separate creation vs unlocked management:
    - `我的创作` (default)
    - `已解锁角色`
    - `全部`
  - Added in-page search for role names and tab-aware empty states.
  - Clarified dashboard counts:
    - total
    - created-by-me
    - unlocked-from-square
    - activated
  - Localized fallback media copy to Chinese (`暂无图片`) for consistency.
- Validation:
  - `npm run -s lint` -> pass
  - `npx tsc --noEmit` -> pass
  - `npm run -s build` -> pass

### Square product loop v13 checkpoint (latest)
- Files changed:
  - `app/square/page.tsx`
  - `app/square/[characterId]/page.tsx`
- Completed:
  - Enabled guest browsing for Square list/detail pages (no forced login redirect for discovery).
  - Added guest-mode UX hints and explicit unlock funnel:
    - list cards show `登录后解锁` / `去登录` actions when not authenticated
    - detail page allows full preview and switches CTA to login-first unlock
  - Kept unlock/activate operations protected behind authenticated checks.
  - Removed stale lint suppression in square page effect block.
- Validation:
  - `npm run -s lint` -> pass
  - `npx tsc --noEmit` -> pass
  - `npm run -s build` -> pass

### Schedule quality v14 checkpoint (latest)
- File changed:
  - `app/api/cron/schedule/route.ts`
- Completed:
  - Added output normalization guards for autonomous role content:
    - `ensureScheduleSnippet`: enforces bracketed life-snippet format for `SCHEDULE_TICK`
    - `normalizeMomentPost`: strips accidental bracket wrappers and stabilizes social-post text
  - Applied normalization on cron generation path before `messages` insert.
  - Capped diary payload length on insert (`clip(..., 1800)`) and kept explicit `【日记 YYYY-MM-DD】` header.
- Validation:
  - `npm run -s lint` -> pass
  - `npx tsc --noEmit` -> pass
  - `npm run -s build` -> pass

### Auth flow v15 checkpoint (latest)
- Files changed:
  - `app/login/page.tsx`
  - `app/auth/callback/page.tsx`
- Completed:
  - Fixed incorrect login UX flow:
    - removed immediate redirect to `/auth/callback` right after sending magic-link email
    - login page now shows explicit “mail sent” status and waits for user to click email link
  - Hardened callback handling for Supabase auth link variants:
    - supports `code` exchange via `exchangeCodeForSession`
    - supports hash-based `access_token/refresh_token` session set
    - supports `token_hash + type` verify flow
  - Added robust error surfacing on callback page.
- Validation:
  - `npm run -s lint` -> pass
  - `npx tsc --noEmit` -> pass
  - `npm run -s build` -> pass

### Auth callback hardening v16 checkpoint (latest)
- File changed:
  - `app/auth/callback/page.tsx`
- Completed:
  - Expanded callback parser to accept both query and hash tickets:
    - `code`
    - `access_token + refresh_token`
    - `token_hash + type`
  - Added OTP type validation for verify path.
  - Added session establishment retry loop to absorb client-side timing races.
  - Improved error specificity:
    - code exchange failure
    - token session failure
    - OTP verify failure
    - missing callback ticket / ticket processed but no session.
- Validation:
  - `npm run -s lint` -> pass
  - `npx tsc --noEmit` -> pass
  - `npm run -s build` -> pass

### Login rate-limit guard v17 checkpoint (latest)
- File changed:
  - `app/login/page.tsx`
- Completed:
  - Added client-side cooldown for magic-link email send (65s) to avoid repeated rapid submissions.
  - Persisted last send timestamp in localStorage for refresh-safe cooldown behavior.
  - Added dedicated user-friendly error mapping for `email rate limit exceeded` / too-many-requests cases.
  - Updated submit button/hint to reflect cooldown state and remaining seconds.
- Validation:
  - `npm run -s lint` -> pass
  - `npx tsc --noEmit` -> pass
  - `npm run -s build` -> pass

### Login cooldown UX v18 checkpoint (latest)
- File changed:
  - `app/login/page.tsx`
- Completed:
  - Added explicit retry clock hint on login page:
    - cooldown message now includes `约 HH:MM:SS 可重发`
    - rate-limit error also includes absolute retry time
  - Added persistent `lastSentAt` state derived from localStorage for stable retry-time rendering.
- Validation:
  - `npm run -s lint` -> pass
  - `npx tsc --noEmit` -> pass
  - `npm run -s build` -> pass

### Identity-card bridge v19 checkpoint (latest)
- Files changed:
  - `app/api/chat/route.ts`
  - `app/characters/[characterId]/edit/page.tsx`
- Completed:
  - Added server-side identity-card fallback in chat pipeline:
    - when request body `userCard` is empty, `/api/chat` now reads `characters.settings.user_card`
    - effective card is injected into dynamic prompt context and PatchScribe `patch_input.turn.user_card`
  - Added persistent identity-card editor in character edit page:
    - new field `身份卡（注入 Prompt，0~300 字）`
    - saved into `characters.settings.user_card`
  - Result: identity card can now be maintained as role-level durable setting (not only browser local storage).
- Validation:
  - `npm run -s lint` -> pass
  - `npx tsc --noEmit` -> pass
  - `npm run -s build` -> pass

### Teen-mode safety lock v20 checkpoint (latest)
- Files changed:
  - `app/api/chat/route.ts`
  - `app/characters/new/page.tsx`
  - `app/square/page.tsx`
  - `app/square/[characterId]/page.tsx`
- Completed:
  - Enforced teen-mode romance-off behavior across creation, unlock, and runtime:
    - character creation now derives effective romance mode as:
      - teen => `ROMANCE_OFF`
      - adult => follows creator selection
    - creation form auto-disables romance selector while teen mode is active.
    - square unlock flow normalizes teen roles to `romance_mode=ROMANCE_OFF` in copied local role settings.
    - chat runtime state reflection and prompt policy sync now force `run_state.romance_mode='ROMANCE_OFF'` when `age_mode='teen'`.
  - Square cards/detail now render romance label as “恋爱关闭” under teen mode.
- Validation:
  - `npm run -s lint` -> pass
  - `npx tsc --noEmit` -> pass
  - `npm run -s build` -> pass

### Square conversion v21 checkpoint (latest)
- File changed:
  - `app/square/page.tsx`
- Completed:
  - Added one-click unlock on square cards for logged-in users:
    - no longer forced to open detail page before unlock
    - unlock action directly copies public role into local role queue and activates to home feed
  - Added per-card unlock loading state (`unlockingId`) and success/failure alerts.
  - Preserved detail entry for users who want to inspect first.
  - Unlock path now reuses teen safety normalization (`teen => romance off`) in card-level conversion too.
- Validation:
  - `npm run -s lint` -> pass
  - `npx tsc --noEmit` -> pass
  - `npm run -s build` -> pass

### Creator UX v22 checkpoint (latest)
- Files changed:
  - `app/characters/new/page.tsx`
  - `app/characters/[characterId]/edit/page.tsx`
- Completed:
  - Rewrote both pages to remove mojibake/corrupted copy and restore clean CN-first creator UX.
  - Preserved and clarified functional logic:
    - creation form -> prompt generation -> publish/save flow
    - teen mode romance lock (`teen => ROMANCE_OFF`, disabled romance selector)
    - edit page persists:
      - `settings.user_card`
      - `age_mode/teen_mode/romance_mode`
      - prompt policy (`plot_granularity/ending_mode/ending_repeat_window`)
  - Unified page shell and action affordances with app-wide AppShell style.
- Validation:
  - `npm run -s lint` -> pass
  - `npx tsc --noEmit` -> pass
  - `npm run -s build` -> pass

### Character Home runtime controls v23 checkpoint (latest)
- File changed:
  - `app/home/[characterId]/page.tsx`
- Completed:
  - Added a runtime control panel to single-character home page (`/home/:characterId`) to reduce context switching to chat page.
  - Home page now reads latest conversation run-state and reflects:
    - schedule state (`PLAY/PAUSE`)
    - lock mode + story lock ETA
    - relationship stage (`S1..S7`)
    - romance mode (`ROMANCE_ON/OFF`)
    - prompt policy (`plot_granularity`, `ending_mode`, `ending_repeat_window`)
  - Connected home controls to existing state APIs:
    - `POST /api/state/schedule`
    - `POST /api/state/relationship`
    - `POST /api/state/prompt-policy`
  - Added teen-mode guard on home runtime controls:
    - if character is teen-mode, romance remains hard-locked to off in UI interactions.
  - Character query on home page now reads `settings` for age-mode/teen-mode inference.
- Validation:
  - `npm run -s lint` -> pass
  - `npx tsc --noEmit` -> pass
  - `npm run -s build` -> pass

### Home workspace revamp v24 checkpoint (latest)
- Files changed:
  - `app/home/page.tsx`
  - `app/globals.css`
- Completed:
  - Rebuilt `/home` into a 3-column product workspace (Candy-style information architecture):
    - left: role queue rail (view mode switch + role selection)
    - center: feed stream (search + event tabs + card list)
    - right: quick-entry actions + activation queue management panel
  - Reworked role browsing interaction:
    - role rail supports active highlight and role-scoped feed filtering
    - role cards now show activation state (`已激活/未激活`)
  - Refactored activation queue operations in home page code:
    - extracted move/hide/deactivate helpers for consistent behavior
    - queue management panel supports up/down reordering and offlining from one place
  - Added responsive layout styles for the new workspace:
    - desktop 3-column
    - medium screens 2-column with right rail spanning full width
    - mobile 1-column fallback
- Validation:
  - `npm run -s lint` -> pass
  - `npx tsc --noEmit` -> pass
  - `npm run -s build` -> pass

### Recovery checkpoint details (latest)
- File fixed: `app/square/[characterId]/page.tsx`
- Root issue:
  - prior scripted replacement introduced broken quotes/JSX text and made file unparsable.
- Fix applied:
  - repaired all unterminated strings and malformed JSX fragments.
  - normalized multiple corrupted UI copy strings to safe English literals.
  - kept intended unlocked-state actions including the `/home/:characterId` entry button.
- Validation:
  - `npm run lint` -> pass
  - `npx tsc --noEmit` -> pass

### Prompt modularization checkpoint (latest)
- Files changed:
  - `app/api/chat/route.ts`
  - `lib/prompt/dynamicContext.ts` (new)
  - `docs/aibaji/template_diff.md`
- Completed:
  - Moved dynamic context text assembly out of chat route into `buildDynamicContextText`.
  - Preserved chat route behavior while creating a modular prompt assembly layer for future template slicing.
  - Fixed regex/parser breakages introduced during refactor; restored full compile/lint stability.
  - Updated template alignment doc to mark:
    - dynamic-context module split as complete
    - evidence-aware patch quality gate as complete (partial overall checkpoint)
- Validation:
  - `npm run lint` -> pass
  - `npx tsc --noEmit` -> pass

### UI + Prompt checkpoint (latest)
- Files changed:
  - `lib/prompt/promptOs.ts` (new)
  - `app/api/chat/route.ts`
  - `app/home/[characterId]/page.tsx` (rewritten UTF-8 clean version)
  - `docs/aibaji/template_diff.md`
- Completed:
  - moved inline `PROMPT_OS` out of chat route into `lib/prompt/promptOs.ts`.
  - chat route now imports both modular dynamic-context and modular prompt OS.
  - rewrote character home hub page to remove mojibake risk and keep features stable:
    - feed stream tabs (moment/diary/schedule)
    - ledger snapshot + asset preview
    - added explicit ledger completeness badges for:
      - wardrobe
      - inventory
      - NPC
      - highlights
      - event log
- Validation:
  - `npm run lint` -> pass
  - `npx tsc --noEmit` -> pass

### Frontend text cleanup checkpoint (latest)
- Files changed:
  - `app/chat/[characterId]/page.tsx`
  - `app/square/[characterId]/page.tsx`
- Completed:
  - cleaned mojibake/corrupted UI strings in chat page and square detail page.
  - fixed two hidden malformed template strings in chat page error messages:
    - `请求失败: ${resp.status}`
  - fixed JSX structure regressions introduced during text cleanup:
    - restored missing `</button>` in scroll-to-bottom button
    - restored missing `<textarea>` tag in user-card modal
  - normalized key labels/messages in chat page:
    - loading/empty-state/hints/buttons/user-card modal strings
    - inventory/NPC separators unified to `|`.
- Validation:
  - `npm run lint` -> pass
  - `npx tsc --noEmit` -> pass

### Chat details checkpoint (latest)
- File changed:
  - `app/chat/[characterId]/page.tsx`
- Completed:
  - added ledger completeness badges inside chat `Details` panel:
    - wardrobe
    - inventory
    - NPC
    - highlights
    - event log
  - status is rendered as `OK / MISSING` with visual color distinction.
- Validation:
  - `npm run lint` -> pass
  - `npx tsc --noEmit` -> pass

### Square UX checkpoint (latest)
- Files changed:
  - `app/square/page.tsx`
  - `app/chat/[characterId]/page.tsx` (small button-format cleanup)
- Completed:
  - closed square product loop on card actions for unlocked characters:
    - `对话` -> `/chat/:localId`
    - `动态中心` -> `/home/:localId`
    - `激活到首页` / `取消激活` toggle directly on card
  - added toggle busy state per local character (`togglingId`) and success/error alerts.
  - activation toggle updates local `unlockedInfoBySourceId` immediately after persistence.
- Validation:
  - `npm run lint` -> pass
  - `npx tsc --noEmit` -> pass

### Square copy checkpoint (latest)
- Files changed:
  - `app/square/page.tsx`
  - `app/square/[characterId]/page.tsx`
- Completed:
  - unified Square list/detail pages from mixed CN/EN copy to consistent Chinese UI language.
  - kept behavior unchanged while localizing:
    - public-role load and empty states
    - unlock/activate/deactivate feedback
    - detail page action labels and subtitles
    - media fallback labels.
- Validation:
  - `npm run lint` -> pass
  - `npx tsc --noEmit` -> pass

### Copy normalization checkpoint (latest)
- Files changed:
  - `app/chat/[characterId]/page.tsx`
  - `app/home/page.tsx`
  - `app/home/[characterId]/page.tsx`
  - `app/square/[characterId]/page.tsx`
- Completed:
  - normalized remaining EN labels to CN across chat/home/square flows.
  - fixed accidental duplicate `Details` label in chat action button (now `账本详情` only).
  - updated key labels:
    - `Outfit/Inventory/Highlights/Event Log` -> `当前穿搭/物品/高光事件/事件日志`
    - `No image/Preview/Tap to chat/FEED` -> `暂无图片/预览/点击进入对话/动态`
    - square detail mode badge `teen/adult` -> `未成年模式/成人模式`.
- Validation:
  - `npm run lint` -> pass
  - `npx tsc --noEmit` -> pass

### CN-first label checkpoint (latest)
- Files changed:
  - `app/square/page.tsx`
  - `app/square/[characterId]/page.tsx`
  - `app/home/page.tsx`
  - `app/home/[characterId]/page.tsx`
  - `app/chat/[characterId]/page.tsx`
- Completed:
  - normalized main page titles to CN-first:
    - `广场` / `首页` / `角色动态中心` / `对话`.
  - replaced residual EN status labels:
    - `OK/MISSING` -> `完整/缺失`.
  - replaced residual EN semantic labels:
    - `Outfit/Inventory/NPC:` style lines unified to Chinese punctuation and wording.
    - `PatchScribe` user-facing error text changed to generic `状态补丁错误`.
  - square detail romance badge now maps:
    - `ROMANCE_ON/OFF` -> `恋爱开启/恋爱关闭`.
  - square detail `System Prompt` label localized to `角色设定提示词`.
- Validation:
  - `npm run lint` -> pass
  - `npx tsc --noEmit` -> pass

### Batched UX checkpoint (latest)
- Files changed:
  - `app/_components/AppShell.tsx`
  - `app/square/page.tsx`
  - `app/home/page.tsx`
- Completed (multi-item in one batch):
  - AppShell nav localization:
    - sidebar nav labels switched to CN (`首页/广场/我的角色/创建角色`).
    - brand sub label and logout label localized.
  - Square list page functional upgrade:
    - added search input (name/occupation/organization/summary).
    - added status filters:
      - `全部`
      - `未解锁`
      - `已解锁`
      - `已激活`
    - added summary stats badges (`总计/未解锁/已解锁/已激活`).
    - empty state now reflects filter/search result (`没有匹配结果`).
  - Home page quick-entry block:
    - `去广场解锁`
    - `管理角色`
    - `创建新角色`
- Validation:
  - `npm run lint` -> pass
  - `npx tsc --noEmit` -> pass

### Batched UX v2 checkpoint (latest)
- Files changed:
  - `app/square/page.tsx`
  - `app/home/page.tsx`
  - `app/home/[characterId]/page.tsx`
- Completed:
  - Square page:
    - added sort selector:
      - `已解锁优先`
      - `已激活优先`
      - `最新发布`
      - `角色名`
    - added status badges on each card:
      - `公开`
      - `已解锁/未解锁`
      - `已激活` (if active)
  - Home global feed page:
    - added event-type color badges for feed cards:
      - 朋友圈（粉）
      - 日记（青）
      - 日程片段（蓝）
  - Character home feed page:
    - same event-type color badges for consistency with home feed.
- Validation:
  - `npm run lint` -> pass
  - `npx tsc --noEmit` -> pass

### Batched UX v3 checkpoint (latest)
- Files changed:
  - `app/home/page.tsx`
  - `app/square/page.tsx`
  - `app/square/[characterId]/page.tsx`
  - `app/chat/[characterId]/page.tsx`
- Completed:
  - Home page:
    - added role-view mode switch:
      - `仅看已激活`
      - `查看全部已解锁`
    - character cards + pills + feed visibility now follow selected mode.
    - fixed feed source filtering consistency by using load-time unlocked id set.
  - Square page:
    - card info density upgrade:
      - added `组织` to meta line when available.
      - added mode badges (`未成年模式/成人模式`, `恋爱开启/关闭`).
    - retained prior filters/sorts/actions.
  - Square detail page:
    - added sticky bottom action bar:
      - unlocked state: `聊天 / 动态中心 / 资产页`
      - locked state: `解锁到我的角色`
  - Chat page:
    - top action order optimized for high-frequency usage.
    - `账本详情` button now toggles label (`账本详情/收起账本`).
- Validation:
  - `npm run lint` -> pass
  - `npx tsc --noEmit` -> pass

### Batched UX v4 checkpoint (latest)
- Files changed:
  - `app/home/page.tsx`
  - `app/home/[characterId]/page.tsx`
  - `app/chat/[characterId]/page.tsx`
- Completed:
  - Home feed page:
    - added feed keyword search input (`搜索动态内容...`).
    - search applies after role visibility + tab filters.
  - Character home feed page:
    - added same feed keyword search for single-character stream.
    - filtering order unified with home feed page.
  - Chat page:
    - improved bottom-follow behavior after history load and message send.
    - floating button text changed from arrow icon to explicit `回到底部`.
    - hide floating button immediately after auto-scroll to bottom.
- Validation:
  - `npm run lint` -> pass
  - `npx tsc --noEmit` -> pass

### Latest checkpoint details (2026-02-16)
- File changed: `app/api/chat/route.ts`
- Completed:
  - Added assistant-output guard helpers:
    - `hasUserSpeechMarker`
    - `isDialogueLine`
    - `isBracketSnippet`
  - Hardened `shouldRewriteAssistantOutput`:
    - blocks user-speech impersonation
    - enforces `FUNC_DBL` as non-dialogue
    - enforces `SCHEDULE_TICK` as single bracket snippet
    - enforces strict multi-cast role-line format and blocks user-labeled lines
  - Improved event placeholders (`inputEventPlaceholder`) to stable ASCII tags.
  - Strengthened multi-cast intent detection:
    - `isStrictMultiCast`
    - `isExitMultiCast`
  - Expanded `extractPresentCharacters` for role-line and pair/list patterns.
  - Extended reconcile trigger detection (`run.reconcile_hint`) with EN terms.
- Validation:
  - `npm run lint` -> pass
  - `npx tsc --noEmit` -> pass

### Additional checkpoint details (same day)
- Files changed:
  - `lib/patchValidation.ts`
  - `app/api/chat/route.ts`
  - `docs/aibaji/template_diff.md`
- Completed:
  - Added optional evidence-aware sanitize options in patch validation.
  - Added confirmed-fact downgrade gate:
    - if `confirmed=true` but no evidence in current turn text, downgrade to `confirmed=false`.
    - applied for `event_log_add`, `npc_db_add_or_update`, `relation_ledger_add`.
    - wardrobe `confirmed=true` is downgraded when current outfit has no textual evidence.
  - Hooked evidence source in chat route:
    - `evidenceText = userMessageForModel + assistantMessage`.
  - Rewrote `docs/aibaji/template_diff.md` to clean UTF-8/alignment checklist format.
- Validation:
  - `npm run lint` -> pass
  - `npx tsc --noEmit` -> pass

### Frontend checkpoint details (same day)
- Files changed:
  - `app/home/[characterId]/page.tsx` (new)
  - `app/home/page.tsx`
- Completed:
  - Added Character Home Hub page:
    - route: `/home/:characterId`
    - modules in one page:
      - feed stream (moment/diary/schedule tabs)
      - quick stats cards
      - ledger snapshot (outfit/inventory/npc/highlights/events)
      - visual assets preview (cover/full_body/head)
      - quick actions to chat and full assets page
  - Added Home card entry button:
    - `动态中心` now opens `/home/:characterId`
    - available in both normal and manage modes
- Validation:
  - `npm run lint` -> pass
  - `npx tsc --noEmit` -> pass

### IA/UI architecture pass checkpoint (latest)
- Files changed:
  - `app/_components/AppShell.tsx`
  - `app/globals.css`
  - `app/page.tsx`
  - `app/characters/page.tsx`
- Completed:
  - Rebuilt app navigation IA around 3 primary product entries:
    - `首页` (activated role feed hub)
    - `广场` (public role discovery + unlock)
    - `创建角色` (creator studio/workbench)
  - Added secondary creation nav group (`新建角色` / `管理角色`) in sidebar.
  - Added mobile bottom dock for the same 3 primary entries.
  - Reworked global visual language to clearer candy-like product shell:
    - brighter glass panels, stronger contrast, new accent palette, refreshed card/button states
    - landing hero + feature grid styles
  - Replaced root landing page (`/`) with explicit product architecture entry page:
    - CTA to login / square
    - clear IA explanation cards for 首页/广场/创建角色
  - Converted `/characters` page framing from “My Characters” to creator workbench:
    - title/badge/subtitle aligned to studio intent
    - stats chips + quick links to square/home
- Validation:
  - `npm run lint` -> pass
  - `npx tsc --noEmit` -> pass

### High-target execution v1 checkpoint (latest)
- Files changed:
  - `app/home/page.tsx`
  - `app/square/page.tsx`
  - `app/globals.css`
- Completed:
  - Home page productization:
    - added clear Hero section with IA intent statement.
    - added role/feed KPI deck:
      - unlocked count
      - activated count
      - feed total
      - moments / diaries / schedules split
  - Square page productization:
    - added Hero + KPI deck for discover/unlock/activate loop.
    - split result area into:
      - `精选角色` (top 3 from active filters)
      - `全部结果` (remaining cards)
    - kept existing unlock/activate/chat action loop unchanged.
  - Added reusable design primitives in global styles:
    - `uiHero`, `uiHeroTitle`, `uiHeroSub`
    - `uiKpiGrid`, `uiKpi`
    - `uiSectionHead`
- Validation:
  - `npm run lint` -> pass
  - `npx tsc --noEmit` -> pass

### High-target execution v2 checkpoint (latest)
- Files changed:
  - `app/home/[characterId]/page.tsx`
  - `app/square/[characterId]/page.tsx`
  - `app/globals.css`
- Completed:
  - Character home detail page (`/home/:characterId`) upgraded to productized role dashboard:
    - added hero section + KPI deck
    - KPI includes:
      - total feed count
      - moment/diary/schedule split
      - ledger completeness ratio
      - previewable asset count
  - Square detail page (`/square/:characterId`) upgraded to discover->unlock->activate funnel view:
    - added hero section + KPI deck
    - KPI includes:
      - unlock status
      - activation status
      - asset preview count
      - age mode / romance mode
      - prompt length
    - media preview improved:
      - main visual + selectable thumbnail grid
    - localized `Author Note` section title to Chinese product copy.
  - Responsive improvements for detail pages:
    - added reusable responsive layout classes (`uiSplit`, `uiThumbGrid`)
    - auto-collapse two-column media layout on narrow screens.
- Validation:
  - `npm run lint` -> pass
  - `npx tsc --noEmit` -> pass

### High-target execution v3 checkpoint (latest)
- Files changed:
  - `app/characters/new/page.tsx`
- Completed:
  - Rebuilt the `新建角色` page from scratch (replaced mojibake-heavy version) as a usable creator workbench:
    - integrated with `AppShell`
    - added hero + KPI deck for creation readiness
    - grouped form fields into practical sections:
      - basics/profile
      - preference/ability/habits
      - world + user relation
      - dialogue style + safety constraints
      - creator note + editable system prompt
    - added one-click prompt generation from form values.
  - Preserved DB compatibility behavior:
    - v2 schema write (`visibility/profile/settings`) first
    - legacy fallback write (`user_id/name/system_prompt`) on missing-column errors
  - Post-create flow now returns to creator workbench (`/characters`) with inline status feedback.
- Validation:
  - `npm run lint` -> pass
  - `npx tsc --noEmit` -> pass

### High-target execution v4 checkpoint (latest)
- Files changed:
  - `app/chat/[characterId]/page.tsx`
  - `app/characters/[characterId]/assets/page.tsx`
- Completed:
  - Chat page (`/chat/:characterId`) productized without removing existing capabilities:
    - added hero + KPI deck (conversation count, message split, ledger completeness, background candidates)
    - normalized key action labels/copy to CN-first
    - improved send flow:
      - auto-scroll to bottom after assistant response
      - explicit `回到底部` floating CTA
    - expanded details panel readability:
      - ledger completeness badges
      - clearer labels for outfit/inventory/NPC/highlights/event log
      - kept wardrobe quick-apply + manual outfit writeback
  - Assets page (`/characters/:characterId/assets`) rebuilt as UTF-8 clean version:
    - removed mojibake-heavy content and replaced with clean Chinese UX copy
    - added hero + KPI deck and clearer sectioning
    - preserved wardrobe writeback and snapshot viewing
    - tightened conversation state query isolation by adding `user_id` filter when loading `conversation_states`
    - kept media preview loop (main preview + thumbnail switch)
- Validation:
  - `npm run lint` -> pass
  - `npx tsc --noEmit` -> pass

### High-target execution v5 checkpoint (latest)
- Files changed:
  - `app/api/cron/schedule/route.ts`
  - `app/api/state/schedule/route.ts` (new)
  - `app/api/state/relationship/route.ts` (new)
  - `app/chat/[characterId]/page.tsx`
  - `lib/presentation/cues.ts`
  - `docs/cron.md`
  - `docs/aibaji/template_diff.md`
- Completed:
  - Closed schedule control execution loop:
    - cron schedule now honors manual `PLAY/PAUSE` and story lock state.
    - story lock expiry is auto-cleared best-effort and restored to `PLAY`.
  - Added user-facing state control APIs:
    - `/api/state/schedule`: `PLAY/PAUSE/LOCK/UNLOCK` with optimistic locking.
    - `/api/state/relationship`: set `relationshipStage` + `romanceMode`, optional character settings persistence.
  - Wired controls into chat page:
    - added execution control panel in `/chat/:characterId`.
    - can adjust schedule run state, story lock, relationship stage (`S1..S7`), romance mode (`ON/OFF`) from UI.
    - chat page now parses and reflects control state from `conversation_states`.
  - Added lightweight presentation cue engine and linked it to chat background:
    - infer cue from assistant text (emotion + scene tags).
    - auto-pick best matching background from uploaded asset paths.
    - manual background selection still supported and can override auto mode.
  - Build stability fix:
    - repaired invalid non-UTF8 encoding in `app/_components/AppShell.tsx`.
    - production build now succeeds with Turbopack.
- Validation:
  - `npm run lint` -> pass
  - `npx tsc --noEmit` -> pass
  - `npm run build` -> pass

### High-target execution v6 checkpoint (latest)
- Files changed:
  - `lib/prompt/promptOs.ts`
  - `app/api/chat/route.ts`
  - `docs/aibaji/prompt_alignment_map.md` (new)
  - `docs/aibaji/template_diff.md`
- Completed:
  - Prompt OS is now runtime policy-driven:
    - added `derivePromptOsPolicy(conversationState, inputEvent)`
    - added `buildPromptOs(policy)` for per-turn assembly
  - Added dedicated template slices:
    - `PLOT_GRANULARITY_POLICY` (LINE / BEAT / SCENE)
    - `ENDING_ANTI_REPEAT_POLICY` (ending mode + anti-repeat window + ending mix)
  - `/api/chat` switched from static `PROMPT_OS` string use to per-turn prompt policy injection.
  - Added explicit prompt traceability map doc:
    - `docs/aibaji/prompt_alignment_map.md`
- Validation:
  - `npm run lint` -> pass
  - `npx tsc --noEmit` -> pass
  - `npm run build` -> pass

### High-target execution v7 checkpoint (latest)
- File changed:
  - `app/characters/[characterId]/assets/page.tsx` (rewritten)
- Completed:
  - Rebuilt assets page as clean UTF-8 implementation (removed mojibake-heavy copy/layout risk).
  - Preserved existing capabilities:
    - conversation snapshot switching
    - wardrobe/current_outfit writeback via `/api/state/wardrobe`
    - ledger snapshot (inventory/NPC/highlights/event log)
    - full asset gallery preview
  - Added visual-layer upgrade (static composition):
    - new `视觉组合预览` panel with layered render
    - background layer selection + role layer selection
    - role transform controls (scale + vertical offset + reset)
    - supports cover/full_body/head assets as composition sources
- Validation:
  - `npm run lint` -> pass
  - `npx tsc --noEmit` -> pass
  - `npm run build` -> pass

### High-target execution v8 checkpoint (latest)
- Files changed:
  - `lib/patchValidation.ts`
  - `docs/aibaji/template_diff.md`
- Completed:
  - Added turn-level multi-cast/NPC consistency gates in patch sanitization:
    - if `narration_mode=MULTI_CAST` but present non-user roles are insufficient, fallback to `DIALOG`
    - normalize `current_main_role` to in-scene roles
    - prevent writing currently present speaking roles into `npc_database`
    - require evidence for unconfirmed NPC add/update entries
  - Updated template diff doc to reflect this gate and shifted remaining gap to cross-turn contradiction checks.
- Validation:
  - `npm run lint` -> pass
  - `npx tsc --noEmit` -> pass
  - `npm run build` -> pass

### High-target execution v9 checkpoint (latest)
- Files changed:
  - `app/api/state/prompt-policy/route.ts` (new)
  - `app/api/chat/route.ts`
  - `app/chat/[characterId]/page.tsx`
  - `app/characters/[characterId]/edit/page.tsx`
  - `app/characters/new/page.tsx`
  - `docs/aibaji/template_diff.md`
- Completed:
  - Added prompt policy state API:
    - `POST /api/state/prompt-policy`
    - supports `plotGranularity`, `endingMode`, `endingRepeatWindow`, `nextEndingsPrefer`
    - optimistic-lock write to `conversation_states`
    - optional persistence to `characters.settings.prompt_policy`
  - Chat route now carries prompt policy defaults more robustly:
    - initializes new conversation state with policy defaults from character settings
    - mirrors character prompt policy into per-turn run/style context before Prompt OS build
  - Chat execution console now includes prompt policy controls:
    - plot granularity selector (`LINE/BEAT/SCENE`)
    - ending strategy selector (`MIXED/QUESTION/ACTION/CLIFF`)
    - anti-repeat window selector
    - save action persists to conversation + character defaults
  - Creator-side defaults:
    - character edit page now supports policy fields and saves into `settings/prompt_policy`
    - new-character flow writes default policy fields into settings at creation
- Validation:
  - `npm run lint` -> pass
  - `npx tsc --noEmit` -> pass
  - `npm run build` -> pass

## 4) Important risk/constraint notes
- `app/api/chat/route.ts` contains mojibake-like text display in terminal for some Chinese content.
- Avoid broad block replacement in that file.
- Use minimal, function-level edits only.
- Keep API response shape backward-compatible:
  - `conversationId`, `assistantMessage`, `patchOk`, `patchError`
- PatchScribe remains best-effort (chat must still return even if patch fails).

## 5) Next concrete implementation checklist
1. Prompt alignment hardening:
   - add dedicated slices for plot granularity + ending anti-repeat policy.
   - add explicit template-to-runtime mapping table (machine-readable preferred).
2. Social/product depth:
   - expand feed interactions (at least lightweight like/comment model).
   - add square discover growth loop (ranking/recommend/fork copy variants).
3. Visual rendering depth:
   - extend static layered render for expression/outfit/background combinations.
   - keep current fallback of asset-path cue switching.
4. State integrity:
   - add turn-level patch consistency checks for multi-cast/NPC relation writes.
5. Validation gate on every batch:
   - `npm run lint`
   - `npx tsc --noEmit`

## 6) Useful quick commands
- Dev: `npm run dev`
- Lint: `npm run lint`
- Typecheck: `npx tsc --noEmit`
- Recent commits: `git log --oneline -n 20`

## 7) Copy-paste text for next chat (use this when current chat breaks)

```text
请继续接力这个项目（仓库：d:/projects/xuxuxu），先读取 docs/SESSION_HANDOFF.md 作为唯一最新上下文基线。
目标不变：尽可能多复刻爱巴基（除语音），并按优先级顺序继续：2->3->1->4->5。
硬要求：
1) 先执行最小可验证改动，不要大块替换 app/api/chat/route.ts。
2) 每次改动后跑 npm run lint 和 npx tsc --noEmit。
3) 保持 chat API 返回结构兼容：conversationId/assistantMessage/patchOk/patchError。
4) PatchScribe 失败不能阻塞 chat 返回。
读完 handoff 后直接开干，不要先给长计划，先做第一个可提交增量并汇报结果。
```

## 8) Session note
- This file should be updated at every major checkpoint before long runs or before handoff.
