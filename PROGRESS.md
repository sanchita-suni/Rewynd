# EchoOps — Progress Log

A running log appended at the end of every layer. Newest layer at the bottom.

---

## Layer 1 — Skeleton + mock intelligence (2026-07-09)

**Goal:** a running app where posting a stack trace in `#incident-response`
triggers a fully-rendered Block Kit card, with all four intelligence layers
stubbed behind clean interfaces returning realistic hardcoded data. Demoable
on its own.

### Done

- **Scaffold.** Bolt-JS + TypeScript project: `package.json`, `tsconfig.json`,
  `.env.example` (SLACK_* / GITHUB_MCP_URL / GITHUB_TOKEN / MURF_API_KEY), `.gitignore`,
  `/src/{services,blocks,orchestrator,listeners,util}`, plus `CLAUDE.md` and this log.
- **Event listener.** `src/listeners/message.ts` resolves `INCIDENT_CHANNEL`
  (name or ID), ignores bot/edited messages, and runs a heuristic
  (`src/util/stackTrace.ts`: exception keywords, typed-exception names, `file:line`
  patterns, multi-line stack frames) to decide whether a post is a stack trace.
- **Four typed mock services** (`src/services/*`) behind interfaces in
  `src/services/types.ts`: MemoryService, CodeService, SynthesisService,
  VoiceService — each returning realistic hardcoded data. SynthesisService clamps
  the triage summary to ≤ 40 words.
- **Orchestrator** (`src/orchestrator/index.ts`) chains
  `memory → code → synthesis → voice`, then builds the card and posts it as a
  **threaded reply**.
- **Progressive-disclosure card** (`src/blocks/incidentCard.ts`), spec §2:
  (a) verdict banner, (b) audio block/placeholder for the spoken triage,
  (c) expandable detail (file:line + prior-thread link + diff) behind a
  Show/Hide toggle that re-renders in place, (d) "Open follow-up issue" button
  with a confirm dialog.
- **Confirm-button handler** (`src/listeners/actions.ts`, `ACTION_OPEN_ISSUE`):
  **stub** — logs and posts an ephemeral "would create issue #N" ack. Also
  handles the show/hide details toggle by re-running the (deterministic) chain
  from a compact signature payload carried in the button value.
- **Verification.** `tsc --noEmit` passes. A smoke test drove
  `heuristic → extractSignature → assembleModel → buildIncidentCard`:
  detection fired on a sample trace, signature = `TypeError @ src/auth/session.ts:42`,
  verdict `DRIFTED` with a prior incident, triage summary 24 words (≤40),
  collapsed card = 7 blocks / expanded = 11, action IDs
  `echoops_show_details` + `echoops_open_issue`; ordinary chatter was correctly
  not detected.

### ⚠️ Spec file missing

`EchoOps_v2_winning_spec.md` is **not in the repo**. Layer 1 was built from the
task brief (a faithful summary of the spec). **Action:** add the spec file so the
exact card wording/section order in "spec §2" and the three required-technology
positioning can be reconciled. No blocker for the demo, but do this before Layer 2
polish.

### Dependency check — Slack AI Search (CRITICAL PATH for Layer 3 RTS)

- **Script:** `scripts/checkAiSearch.ts` (`npm run check:ai-search`) calls
  `assistant.search.info` against the configured workspace.
- **Status (2026-07-09): UNCONFIRMED — not yet run against a real sandbox.**
  Run so far used the `.env.example` placeholder token and returned
  `invalid_auth` (expected). This does **not** confirm entitlement either way.
- **To confirm:** put a real sandbox `SLACK_BOT_TOKEN` (with `search:read`) in
  `.env` and re-run `npm run check:ai-search`. `ok=true` ⇒ RTS unblocked.
- **If missing (method returns unknown_method / not entitled), request a sandbox
  with Slack AI Search:**
  1. Join the Slack Developer Program: https://api.slack.com/developer-program
  2. Request a **paid** Sandbox (Slack AI Search requires Business+ / Enterprise
     Grid — a free sandbox will not expose `assistant.search.*`).
  3. Sandbox → Settings → Slack AI → enable Slack AI, then enable AI Search.
  4. Reinstall EchoOps; add OAuth scope `search:read` (+ any assistant search scopes).
  5. Re-run `npm run check:ai-search`.
  **>>> This is a critical-path blocker for Layer 3 semantic RTS. <<<**

### Mock / real boundary (current)

| Piece | State |
| --- | --- |
| Slack connection, message listening, card posting, button clicks | **REAL** |
| MemoryService (prior incident) | MOCK → becomes Slack AI Search / RTS |
| CodeService (grounding + drift) | MOCK → becomes GitHub MCP |
| SynthesisService (recommendation + triage) | MOCK → becomes Slack AI |
| VoiceService (audio) | MOCK → becomes Murf |
| "Open follow-up issue" write | STUB (ephemeral ack) → real GitHub issue in Layer 3 |

### Layer 2 starting point

1. **Add the missing `EchoOps_v2_winning_spec.md`** and reconcile card §2 wording.
2. **Stand up the real Slack sandbox:** create the app, enable Socket Mode, add
   scopes, invite the bot to `#incident-response`, fill `.env`, and confirm a
   live stack trace produces the threaded card end-to-end (Layer 1's DONE-WHEN
   against a real workspace).
3. **Run `npm run check:ai-search` against the real sandbox** and record the
   definitive AI Search verdict here; if missing, action the request steps above.
4. Pick the first real integration to swap in (recommended: **CodeService →
   GitHub MCP**, since it's independent of the AI-Search blocker) by replacing
   the exported singleton in `src/services/code.ts` — orchestrator/blocks untouched.
