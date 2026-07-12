# Rewynd — Progress Log

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
  `rewynd_show_details` + `rewynd_open_issue`; ordinary chatter was correctly
  not detected.

### Spec reconciliation (2026-07-10) — RESOLVED

`EchoOps_v2_winning_spec.md` is now in the repo. Layer 1 (originally built from
the brief) was reconciled against spec §2 (the card) and §1 (the three techs):

- **Verdict banner rewritten to the spec §2.1 exemplar** — one rich line packing
  seen-before + resolver + month/year + current-code verdict, e.g.
  `✅ Seen before · fixed by @trish · Mar 2026 · current code MATCHES — the fix still applies`
  (was a generic two-part label with resolver/date buried in the detail).
- **Progressive disclosure tightened to §2's thesis** — glanceable layer is now
  banner → ~15s voice-triage *summary only* → (expand). The full recommendation /
  recommended patch moved *into* the expandable detail (§2.3), where all
  copy-pasteable text lives.
- **Mock narrative aligned to the canonical demo (§4)** — `@trish`,
  `src/checkout/payments.ts:42`, payment-gateway `ETIMEDOUT`, resolved Mar 2026,
  verdict **MATCH** ("fix still applies"), so the running app matches the demo
  script. The DRIFTED branch is still fully supported.
- **Framing corrected:** the *three required techs* are RTS + MCP + Slack AI
  (each load-bearing); **Murf/voice is the summary modality, not one of the
  three** (spec §0/§1). CLAUDE.md updated accordingly.
- Re-verified: `tsc` clean; smoke test on a canonical ETIMEDOUT trace →
  detected, verdict MATCH, resolver @trish, banner renders per exemplar, triage
  17 words (≤40), collapsed 5 blocks / expanded 10, detail carries file:line +
  thread deep-link + recommended fix + diff.

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
  4. Reinstall Rewynd; add OAuth scope `search:read` (+ any assistant search scopes).
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

Per the spec's build plan (§5, Day 2 = "make RTS + MCP real"):

1. **Stand up the real Slack sandbox:** create the app, enable Socket Mode, add
   scopes, invite the bot to `#incident-response`, fill `.env`, and confirm a
   live stack trace produces the threaded card end-to-end (Layer 1's DONE-WHEN
   against a real workspace). Set up the demo channel + a historical thread so
   RTS can actually return the match (mind public-vs-private scoping, §7).
2. **Run `npm run check:ai-search` against the real sandbox** and record the
   definitive AI Search verdict here; if missing, action the request steps above
   **today** — it's the highest lead-time risk (§7).
3. **Make RTS real (MemoryService → hero tech).** Build the *question-form*
   semantic query (§1.1: starts with what/where/how, ends with `?`) so retrieval
   is semantic not keyword. Cache within session (RTS rate limits). Swap the
   singleton in `src/services/memory.ts` — orchestrator/blocks untouched.
4. **Make MCP real (CodeService → GitHub MCP).** Real `file:line` + diff-vs-fix-era
   (MATCH/DRIFTED). Independent of the AI-Search blocker, so it can proceed in
   parallel. Swap the singleton in `src/services/code.ts`.
5. Keep SynthesisService + VoiceService mocked until Layer 3 (§5, Day 3).

---

## Layer 2 — RTS + MCP real (2026-07-10)

**Goal:** replace the MemoryService and CodeService mocks with real Real-Time
Search + GitHub MCP implementations. SynthesisService + VoiceService stay mocked.
Orchestrator and card unchanged.

### Done

- **MemoryService → real RTS** (`src/services/memory.ts`, `RealMemoryService`).
  - Builds a **natural-language QUESTION** query (`src/services/rts.ts`
    `buildQuestionQuery`) — e.g. *"How was the ETIMEDOUT error in payments
    resolved before?"* — so RTS runs semantic (not keyword) retrieval (§1.1).
    **Keyword fallback** (`buildKeywordQuery`) when the question finds nothing.
  - Calls `assistant.search.context` via `WebClient.apiCall` (not in the typed
    SDK). Parses the best resolution message → resolver (mention/phrase → name via
    `users.info`), resolvedAt (from ts), threadUrl (permalink), fixSummary, and a
    **fix-era ref** (PR/commit from the text) for CodeService.
  - **No-match renders cleanly** → banner "New signature · no prior incident".
  - **RTS rate limits respected:** results cached per incident in the session
    cache (`src/orchestrator/incidentContext.ts`).
- **CodeService → real GitHub MCP** (`src/services/code.ts`, `RealCodeService`).
  - Minimal dependency-free **Streamable-HTTP MCP client** (`src/services/mcp.ts`,
    `fetch`-based; handles JSON + SSE responses) — `initialize` → `tools/call`.
  - `get_file_contents` for the current `file:line`; resolves the **fix-era
    commit** from the cached PR/commit (`get_pull_request`) or the resolvedAt date
    (`list_commits`), fetches the file at that ref, and **diffs the implicated
    region** (`src/services/diff.ts`) → `MATCH`/`DRIFTED`. This verdict drives the
    banner.
- **memory→code bridge / interface constraint.** `groundError(errorSignature)`
  doesn't receive the prior, and the orchestrator must not change, so the fix-era
  ref is passed via the per-incident session cache (same store that satisfies the
  RTS rate-limit requirement). No orchestrator/card/interface changes.
- **Seed helper** (`scripts/seedHistory.ts`, `npm run seed`) plants ONE real
  historical thread — an ETIMEDOUT trace + a resolution crediting @trish with a
  PR link — into `SEED_CHANNEL`, so RTS has a genuine match to find. Posted by the
  bot, so the listener ignores it (no accidental trigger). Documents the
  public-channel scoping requirement (§7) and that the resolver is read from a
  "Resolved by @trish" phrase (author is the bot unless Trish posts herself).
- **Demo logs (scored artifact, §4)** at each real call, exact format:
  `[RTS] Semantic query → match found: thread from Mar 2026, resolved by @trish`,
  `[MCP] GitHub → current src/checkout/payments.ts:42 diffed vs fix-era → MATCH (fix still applies)`.
- **Config/env:** added `GITHUB_REPO`, `GITHUB_DEFAULT_BRANCH`, `RTS_ENABLED`,
  `RTS_RESULT_LIMIT`, `SEED_CHANNEL`, `USE_MOCKS` to `.env.example` + `config.ts`.

### Degrade policy (honest, not fabricated)

- RTS **disabled** (`RTS_ENABLED=false`) → mock memory. RTS **error** (bad
  `search:read` / no Slack AI Search) → logs `[RTS] ERROR …`, returns **no match**
  (never a fake prior).
- GitHub MCP **unconfigured** (no `GITHUB_REPO`/`GITHUB_TOKEN`) → mock grounding.
  MCP **call error** → "grounding unavailable"; if a prior exists, stays cautious
  (`DRIFTED`) rather than claiming the old fix still applies.
- `USE_MOCKS=true` forces the Layer 1 narrative for offline demos.

### Verification

- `tsc` clean; `dist` builds.
- **`npm run check:layer2`** (offline self-test, `scripts/checkLayer2.ts`): **all
  checks pass** — question query is well-formed & semantic, keyword fallback works,
  RTS parser extracts permalink/score, fix-era PR #482 + resolver @trish extracted,
  diff returns MATCH on unchanged region and DRIFTED on a changed one, snippet marks
  the implicated line.
- **Integration smoke** (bogus creds): forced-mock path renders the @trish MATCH
  banner; real path logs the semantic query, degrades gracefully on `invalid_auth`,
  MCP logs "not configured → mock", and the card still renders ("New signature").
- **Not exercised here (needs a live sandbox):** a *successful* real RTS match and
  real MCP diff. Those require sandbox creds + `npm run seed`; the code paths and
  exact log strings are in place. This is the remaining step to fully close the
  Layer 2 DONE-WHEN.

### Mock / real boundary (current)

| Piece | State |
| --- | --- |
| Slack connection, message listening, card posting, button clicks | **REAL** |
| MemoryService (prior incident) | **REAL — Real-Time Search** (mock fallback when disabled/unconfigured) |
| CodeService (grounding + drift) | **REAL — GitHub MCP** (mock fallback when unconfigured) |
| SynthesisService (recommendation + triage) | MOCK → becomes Slack AI (Layer 3) |
| VoiceService (audio) | MOCK → becomes Murf (Layer 3) |
| "Open follow-up issue" write | STUB (ephemeral ack) → real GitHub issue in Layer 3 |

### Layer 3 starting point

Per spec §5 (Day 3 = Slack AI + Murf + the real confirm action):

1. **Live end-to-end pass first.** With sandbox creds + `search:read` + Slack AI
   Search + `GITHUB_REPO`/`GITHUB_TOKEN` set: `npm run seed`, then post a fresh
   ETIMEDOUT trace and confirm the card's prior-thread link / resolver / diff come
   from real RTS + MCP with the three-log trace visible. (Closes Layer 2 DONE-WHEN.)
2. **SynthesisService → Slack AI** (`src/services/synthesis.ts`). Prompt Slack AI
   with `[prior fix] + [current code diff]` → current-code recommendation + the
   ≤40-word triage summary. Keep the interface identical.
3. **VoiceService → Murf** (`src/services/voice.ts`). Render the triage summary to
   a real ~15s audio clip via `MURF_API_KEY`; return the hosted URL.
4. **Confirm button → real write** (`src/listeners/actions.ts`, `ACTION_OPEN_ISSUE`).
   Use the GitHub MCP `create_issue` tool (reuse `src/services/mcp.ts`) to open the
   follow-up issue **and** annotate the incident thread (spec §1.2 "close the loop").
   The fix-era ref + signature are already in the session cache / button value.

---

## Layer 3 — Synthesis + Voice + real confirm write + submission (2026-07-10)

**Goal:** replace the last two mocks, make the confirm action a real write, and
produce every submission artifact. Project becomes submission-ready.

### Decision (asked the user — outward-facing / affects submission narrative)
- **Synthesis engine:** an **open-source / free-tier LLM** via an OpenAI-compatible
  client (Groq / OpenRouter / local Ollama). Rationale: **Slack AI has no callable
  text-completion API**, so "real Slack AI synthesis" isn't literal code.
- **Tech narrative:** claim **RTS + MCP as the two load-bearing required techs**
  (the "≥1" rule is satisfied with margin); describe synthesis honestly as the
  reasoning engine. README/DEMO/CLAUDE all state this plainly.

### Done
- **SynthesisService → real LLM** (`src/services/synthesis.ts`, `LlmSynthesisService`
  + `src/services/llm.ts`). Prompts an OpenAI-compatible endpoint to reconcile
  `[prior fix] + [current diff/verdict]` → a current-code recommendation (if
  DRIFTED, says the old fix needs adaptation and why) + **ONE** ≤40-word triage
  summary. `spokenize()` strips file paths / line numbers / URLs / code so the
  **same** summary is safe for both card text and audio. Falls back to a sharp
  `DeterministicSynthesisService` when no LLM is configured or on error.
- **VoiceService → real Murf** (`src/services/voice.ts`, `MurfVoiceService`). Renders
  the summary to a ~15s MP3, fetches the bytes, and the orchestrator uploads them as
  a **native Slack audio player** in the thread via `files.uploadV2`. Mock/no-audio
  fallback keeps the card rendering (text-only) on failure.
- **Card finalized** (`src/blocks/incidentCard.ts`) per spec §2: banner · ~15s audio
  summary · expandable detail (file:line + prior-thread deep link + diff + recommended
  patch) · confirm-gated button — which is **replaced by the issue link** once created.
- **Confirm button → REAL write** (`src/listeners/actions.ts`). On click (nothing
  writes before it): opens a GitHub issue via the shared MCP client
  (`src/services/github.ts` `create_issue`) with a body linking the prior incident +
  current occurrence + recommendation, **annotates the incident thread** (the
  re-capture), updates the card, and acks the clicker. If GitHub is unconfigured or
  the write errors → posts a ready-to-paste **draft** ephemerally; never fakes a link.
- **Perf/consistency:** the full assembled model is cached per incident
  (`incidentContext.ts`), so show/hide re-renders and the confirm write **never
  re-call the LLM/TTS**.
- **Robustness:** every layer degrades (no-prior, DRIFTED, RTS/MCP/LLM/Murf failure)
  to a text-only card; the `[RTS]`/`[MCP]`/`[LLM]`/`[Murf]` trace stays clean.
- **Submission artifacts:** `README.md` (institutional-memory thesis),
  `docs/architecture.svg` (+ `.mmd` source), `DEMO.md` (3-min shot list + VO cues +
  seed setup), `SUBMISSION_CHECKLIST.md` (judge access, tracks, deadline),
  `DEPLOY.md` (always-on host + laptop-off smoke test).

### Verification
- `tsc` clean; `dist` builds.
- `npm run check:layer2` **all pass**; `npm run check:layer3` **all pass** —
  spoken-summary sanitizer removes file:line/paths/urls, deterministic synthesis is
  ≤40 words with no locations across MATCH/DRIFTED/no-prior, LLM JSON extractor
  handles fenced/prose/garbage.
- **Integration smoke:** forced-mock renders @trish MATCH banner, clean summary,
  issue-created state removes the confirm button; real path with bogus creds logs
  the semantic query, degrades on every layer without crashing, card still renders.

### Mock / real boundary (FINAL)

| Piece | State |
| --- | --- |
| Slack connection, listener, card, buttons, audio upload | **REAL** |
| MemoryService (prior incident) | **REAL — Real-Time Search** (mock fallback) |
| CodeService (grounding + drift) | **REAL — GitHub MCP** (mock fallback) |
| SynthesisService (recommendation + triage) | **REAL — OpenAI-compatible LLM** (deterministic fallback) |
| VoiceService (audio) | **REAL — Murf TTS** (mock/no-audio fallback) |
| "Open follow-up issue" write | **REAL — GitHub MCP `create_issue` + thread annotation** (draft fallback) |

### Known gaps / not exercisable without a live sandbox
- A **successful live run** (real RTS match → real MCP diff → LLM synth → Murf audio
  → real issue write) needs sandbox creds + `search:read` + Slack AI Search +
  `GITHUB_REPO`/`GITHUB_TOKEN` (+ optional LLM/Murf keys). All code paths and exact
  log strings are in place; this is the final live dry-run before recording.
- **RTS response shape:** `assistant.search.context` isn't in the typed SDK; the
  parser is defensive across field-name variants — confirm the mapping on the real
  sandbox during the dry-run and adjust `parseRtsMessages` if needed.
- **Murf request/response fields** (`audioFile`, voiceId, Falcon/model params) are
  per current docs; verify against your Murf account and set `MURF_VOICE_ID`.
- **GitHub MCP tool names** (`get_file_contents`, `list_commits`, `get_pull_request`,
  `create_issue`) and arg casing follow the hosted GitHub MCP; confirm against the
  server build you point `GITHUB_MCP_URL` at.
- **Diagram:** shipped as a hand-authored SVG (reliable, no mermaid-cli/Chromium);
  `docs/architecture.mmd` is the regenerable source if you prefer mmdc output.

### Submission-ready checklist → see `SUBMISSION_CHECKLIST.md`
Deploy (DEPLOY.md) · seed · grant judge access (`slackhack@salesforce.com`,
`testing@devpost.com`) · record the 3-min demo (DEMO.md) · submit before
**13 Jul 5:00pm PDT**.
