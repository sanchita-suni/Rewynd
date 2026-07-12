# Rewynd

An **institutional-memory incident responder** for the **Slack Agent Builder
Challenge** (New Slack Agent track). Positioning per
[EchoOps_v2_winning_spec.md](EchoOps_v2_winning_spec.md) §0 — *"The 2am incident
your team has already fixed — and forgotten."* Tagline: **"Your team already
fixed this. I'll find out how."**

When someone posts a stack trace in `#incident-response`, Rewynd replies
in-thread with a single progressive-disclosure card that: recovers **how your own
team fixed this exact error last time**, **validates that fix against your current
code** (does it still apply, or has the code drifted?), speaks a ~15s triage
summary, and offers a confirm-gated **"Open follow-up issue"** button that
re-captures the knowledge.

## The required technologies (spec §1) — what's load-bearing

The challenge requires **≥1** of three Slack technologies. Rewynd leans on **two,
both genuinely load-bearing**, plus a reasoning layer and a voice layer:

1. **Real-Time Search API** — the memory engine / hero. Semantic, *question-form*
   query over workspace history for the prior occurrence + the thread where it was
   resolved. → backs `MemoryService`. **Load-bearing.**
2. **MCP (external GitHub MCP server)** — code-grounding + action. Ground the
   current `file:line`, diff it vs the past-fix era (MATCH/DRIFTED), and on confirm
   open the follow-up issue. → backs `CodeService` + the confirm write. **Load-bearing.**
3. **Synthesis (LLM)** — reconciles `[past fix] + [current diff]` into the
   recommendation + one triage summary. Runs on any **OpenAI-compatible / open-source**
   endpoint (Groq/OpenRouter/Ollama). → backs `SynthesisService`.

**Why not "Slack AI"?** Slack AI is a set of product features, not a callable
text-completion API, so Rewynd can't literally "call Slack AI" for synthesis.
It uses an open-source LLM instead. The two Slack technologies it *does* use —
**RTS + MCP** — satisfy the requirement with margin. **Murf (voice)** is the
summary modality (spec §0/§2.2: audio is the glanceable summary, never the
detail), not a required tech. → backs `VoiceService`.

## Stack

- **Bolt for JavaScript** (TypeScript), started from Slack's AI Bolt-JS template shape.
- **Socket Mode** by default (no public URL needed for the demo). HTTP mode is
  available via `SOCKET_MODE=false`.
- Node ≥ 20. No Deno hosted-automations runtime (explicitly out of scope).

## The four intelligence layers

Rewynd chains four services, each a typed interface in
[src/services/types.ts](src/services/types.ts). As of **Layer 3 (final)**, all
four are real, each with an in-file fallback:

| Service            | Interface method                    | State                                       | File |
| ------------------ | ----------------------------------- | ------------------------------------------- | ---- |
| `MemoryService`    | `findPriorIncident(errorSignature)` | **REAL** — Real-Time Search (mock fallback) | [memory.ts](src/services/memory.ts) |
| `CodeService`      | `groundError(errorSignature)`       | **REAL** — GitHub MCP (mock fallback)       | [code.ts](src/services/code.ts) |
| `SynthesisService` | `recommend(prior, code)`            | **REAL** — OpenAI-compatible LLM (deterministic fallback) | [synthesis.ts](src/services/synthesis.ts) |
| `VoiceService`     | `renderTriage(triageSummary)`       | **REAL** — Murf TTS (mock fallback)         | [voice.ts](src/services/voice.ts) |

Each service keeps its fallback class in the same file and **selects** at the
bottom: `useMocks || unconfigured → fallback; else → Real(withFallback)`. So an
unconfigured checkout still renders end-to-end, and a real deploy uses the live
APIs. The confirm-button write lives in
[src/listeners/actions.ts](src/listeners/actions.ts) and uses the shared GitHub
MCP client ([src/services/github.ts](src/services/github.ts)).

> **Synthesis is an open-source / free-tier LLM, not "Slack AI."** Slack AI has no
> callable completion API, so synthesis runs on any OpenAI-compatible endpoint
> (Groq/OpenRouter/Ollama). The two Slack technologies Rewynd genuinely uses —
> **RTS + MCP** — are both load-bearing (satisfies the "≥1" rule with margin).

## The mock / real boundary  ← read this before touching an integration

- **Real:** Slack (listener + card + buttons + audio upload), MemoryService (RTS),
  CodeService (GitHub MCP), SynthesisService (LLM), VoiceService (Murf), and the
  confirm-button **write** (GitHub MCP `create_issue` + thread annotation).
- **Degrade policy (honest, never fabricated):**
  - RTS *disabled* → mock; RTS *error* (bad scope / no Slack AI Search) → logs
    `[RTS] ERROR …`, returns **no match** (banner: "New signature").
  - GitHub MCP *unconfigured* → mock grounding; MCP *call error* → "grounding
    unavailable" and, when a prior exists, stays cautious (`DRIFTED`).
  - LLM *unconfigured/error* → deterministic synthesizer (`[LLM] … → deterministic`).
  - Murf *unconfigured/error* → no audio; the card renders text-only (`[Murf] ERROR …`).
  - Confirm write when GitHub *unconfigured/errors* → posts a ready-to-paste issue
    **draft** ephemerally; nothing is written and no fake link is shown.
- **The seam:** the orchestrator ([src/orchestrator/index.ts](src/orchestrator/index.ts))
  and card ([src/blocks/incidentCard.ts](src/blocks/incidentCard.ts)) talk only to
  the interfaces. Because `groundError` doesn't receive the prior incident,
  memory→code state (the fix-era ref) rides a **per-incident session cache**
  ([src/orchestrator/incidentContext.ts](src/orchestrator/incidentContext.ts)),
  which also (a) caches RTS results for its rate limits and (b) caches the full
  assembled model so re-renders / the confirm write never re-call the LLM/TTS.
- **Audio player:** the ~15s Murf clip is uploaded to the thread via
  `files.uploadV2` (native Slack player); the card carries only the summary text.

## Demo log format (a scored artifact — spec §4)

Each real call prints a structured line to the terminal:

```
[RTS]  Semantic query: "How was the ETIMEDOUT error in payments resolved before?"
[RTS]  Semantic query → match found: thread from Mar 2026, resolved by @trish
[MCP]  Fetching current src/checkout/payments.ts from acme/checkout@main
[MCP]  GitHub → current src/checkout/payments.ts:42 diffed vs fix-era → MATCH (fix still applies)
[LLM]  Synthesizing current-code recommendation…
[Murf] ~15s triage rendered (28 KB)
       …then on Confirm:
[MCP]  GitHub → follow-up issue created: #123 https://github.com/acme/checkout/issues/123
```

(The synthesis log reads `[LLM]`, not `[Slack AI]` — synthesis runs on an
open-source model; RTS + MCP are the load-bearing Slack techs.)

## Architecture / flow

```
message in #incident-response
   └─ listeners/message.ts   heuristic: looks like a stack trace? (util/stackTrace.ts)
        └─ orchestrator/index.ts   extractSignature → memory → code → synthesis → voice
             │   memory (RTS): question-form semantic query → prior thread + resolver + fix era
             │        └─ stashes prior + fix-era ref in the session cache (incidentContext)
             │   code (GitHub MCP): current file:line + diff vs fix-era commit → MATCH/DRIFTED
             │        └─ reads the fix-era ref back from the session cache
             │   synthesis (LLM): reconcile prior × diff → recommendation + one ≤40-word summary
             │   voice (Murf): render the summary to a ~15s clip
             └─ blocks/incidentCard.ts   progressive-disclosure card (spec §2 a–d)
                  └─ posted as a threaded reply + native audio player uploaded to thread
   button clicks → listeners/actions.ts
        show/hide details (re-render from cache) · open-issue (REAL GitHub MCP write + annotate)
```

The card (spec §2): **(a)** verdict banner line, **(b)** ~15s spoken-triage summary
(native audio player uploaded separately), **(c)** expandable detail (file:line +
prior-thread link + diff + recommended patch), **(d)** an "Open follow-up issue"
confirm button — replaced by the issue link once the write happens.

## Run it

1. `npm install`
2. Create a Slack app (Socket Mode on). Bot scopes: `chat:write`,
   `channels:history`, `channels:read`, `groups:history`, `groups:read`,
   **`search:read`** (RTS), `users:read` (resolve resolver names). App-level token
   scope: `connections:write`. RTS semantic mode also needs **Slack AI Search**
   enabled on the workspace — verify with `npm run check:ai-search`.
3. Invite the bot to your `#incident-response` channel.
4. `cp .env.example .env` and fill in `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`,
   `INCIDENT_CHANNEL`; `GITHUB_TOKEN` + `GITHUB_REPO` (`owner/name`) for grounding +
   the issue write; optionally `LLM_BASE_URL`/`LLM_MODEL` (Groq/OpenRouter/Ollama)
   for synthesis and `MURF_API_KEY` for audio.
5. **Seed a historical incident so RTS has a real match:** `npm run seed`
   (plants an ETIMEDOUT trace + a resolution from @trish with a PR link into
   `SEED_CHANNEL`). Essential — the demo has nothing to recover without it.
6. `npm run dev` (watch) or `npm run build && npm start`.
7. Paste a **fresh** ETIMEDOUT-style stack trace into `#incident-response` →
   Rewynd replies with a card + audio whose prior-thread link, resolver, and
   diff/verdict come from real RTS + MCP; the `[RTS]`/`[MCP]`/`[LLM]`/`[Murf]` logs
   print in the terminal. Tap **Open follow-up issue** to create a real GitHub issue.

To demo without any live services, set `USE_MOCKS=true` — the card renders from the
hardcoded @trish / payments.ts MATCH narrative with the deterministic synthesizer.

> **Before judging (spec §3/§7):** deploy to an **always-on host** — see
> [DEPLOY.md](DEPLOY.md). `slack run` / laptop-bound Socket Mode dies when the
> machine sleeps. Also: [README.md](README.md), [DEMO.md](DEMO.md),
> [SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md).

### Checks

- `npm run check:ai-search` — probes `assistant.search.info` to confirm **Slack AI
  Search** is available (needed for semantic RTS). See PROGRESS.md for status.
- `npm run check:layer2` — offline self-test: RTS query/parse + diff/verdict.
- `npm run check:layer3` — offline self-test: spoken-summary sanitizer (no file:line
  in audio) + deterministic synthesis + LLM JSON extraction.

## Layout

```
src/
  app.ts                  Bolt app entry (Socket Mode)
  config.ts               env config + validation (RTS, GitHub MCP, USE_MOCKS)
  listeners/
    message.ts            #incident-response listener + heuristic gate
    actions.ts            show/hide details + open-issue (stub)
  orchestrator/
    index.ts              chains 4 layers, posts card, uploads audio; cache-aware assembleModel
    incidentContext.ts    per-incident session cache (RTS rate-limit + memory→code bridge + model cache)
  services/
    types.ts              the four typed interfaces + shared types (incl. CreatedIssue)
    memory.ts             REAL RTS (RealMemoryService) + MockMemoryService
    code.ts               REAL GitHub MCP (RealCodeService) + MockCodeService
    synthesis.ts          REAL LLM (LlmSynthesisService) + DeterministicSynthesisService + spokenize()
    voice.ts              REAL Murf (MurfVoiceService) + MockVoiceService
    github.ts             shared GitHub MCP client + createFollowUpIssue (confirm write)
    llm.ts                minimal OpenAI-compatible chat client (fetch-based)
    rts.ts                pure RTS helpers: question query builder + result parser
    mcp.ts                minimal Streamable-HTTP MCP client (fetch-based)
    diff.ts               pure diff/verdict (MATCH/DRIFTED) + snippet extraction
  blocks/
    incidentCard.ts       progressive-disclosure Block Kit card (+ issue-created state)
  util/
    stackTrace.ts         detection heuristic + signature extraction
scripts/
  checkAiSearch.ts        Slack AI Search dependency probe
  checkLayer2.ts          offline self-test: RTS query/parse + diff/verdict
  checkLayer3.ts          offline self-test: spoken-summary sanitizer + synthesis + JSON
  seedHistory.ts          plant a historical incident thread for RTS to find
docs/
  architecture.svg / .mmd architecture diagram (submission artifact)
README.md · DEMO.md · DEPLOY.md · SUBMISSION_CHECKLIST.md   submission artifacts
```
