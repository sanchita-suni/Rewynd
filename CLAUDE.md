# EchoOps

A Slack incident-response agent for the **Slack Agent Builder Challenge**. When
someone posts a stack trace in `#incident-response`, EchoOps replies in-thread
with a single progressive-disclosure card that says: *have we seen this before,
does the live code still match the era of that fix, what should we do, and here
it is spoken aloud* — plus a one-click "open follow-up issue" button.

> ⚠️ **Spec note:** `EchoOps_v2_winning_spec.md` (the intended source of truth for
> positioning, the three required technologies, and the exact card design in
> "spec §2") is **not present in the repo**. This layer was built from the
> detailed task brief, which mirrors the spec. Drop the spec file into the repo
> root so the card wording/section order can be reconciled precisely.

## Stack

- **Bolt for JavaScript** (TypeScript), started from Slack's AI Bolt-JS template shape.
- **Socket Mode** by default (no public URL needed for the demo). HTTP mode is
  available via `SOCKET_MODE=false`.
- Node ≥ 20. No Deno hosted-automations runtime (explicitly out of scope).

## The four intelligence layers

EchoOps chains four services. Each is defined as a typed interface in
[src/services/types.ts](src/services/types.ts) and currently backed by a **mock**
returning realistic hardcoded data. Each mock is a drop-in for a real integration
arriving in a later layer:

| Service            | Interface method                       | Mock file                                   | Becomes (later layer)        |
| ------------------ | -------------------------------------- | ------------------------------------------- | ---------------------------- |
| `MemoryService`    | `findPriorIncident(errorSignature)`    | [src/services/memory.ts](src/services/memory.ts) | Slack AI Search / RTS   |
| `CodeService`      | `groundError(errorSignature)`          | [src/services/code.ts](src/services/code.ts)     | GitHub MCP              |
| `SynthesisService` | `recommend(prior, code)`               | [src/services/synthesis.ts](src/services/synthesis.ts) | Slack AI          |
| `VoiceService`     | `renderTriage(triageSummary)`          | [src/services/voice.ts](src/services/voice.ts)   | Murf                    |

## The mock / real boundary  ← read this before adding a real integration

- **Mock today, everything below the interfaces.** The four files above return
  hardcoded data. Nothing in this repo makes a network call to GitHub, Murf, or
  Slack AI yet. `GITHUB_MCP_URL`, `GITHUB_TOKEN`, and `MURF_API_KEY` are read by
  [src/config.ts](src/config.ts) but never dereferenced against a live endpoint.
- **Real today.** Slack itself is real: the app connects to a workspace, listens
  for messages, posts the card, and handles button clicks.
- **The seam.** The orchestrator ([src/orchestrator/index.ts](src/orchestrator/index.ts))
  and the card builder ([src/blocks/incidentCard.ts](src/blocks/incidentCard.ts))
  talk *only* to the interfaces in `types.ts`. To go real, swap a mock's
  implementation (or the exported singleton at the bottom of each service file)
  for one that calls the real API — **do not** touch the orchestrator or blocks.
- **The confirm button is a stub.** "Open follow-up issue" logs and posts an
  ephemeral "would create issue #N" ack. Real GitHub issue creation lands in
  Layer 3 ([src/listeners/actions.ts](src/listeners/actions.ts), `ACTION_OPEN_ISSUE`).

## Architecture / flow

```
message in #incident-response
   └─ listeners/message.ts   heuristic: looks like a stack trace? (util/stackTrace.ts)
        └─ orchestrator/index.ts   extractSignature → memory → code → synthesis → voice
             └─ blocks/incidentCard.ts   progressive-disclosure card (spec §2 a–d)
                  └─ posted as a threaded reply
   button clicks → listeners/actions.ts   show/hide details (re-render) · open-issue (stub)
```

The card (spec §2): **(a)** verdict banner line, **(b)** audio block / placeholder
for the spoken triage, **(c)** expandable detail (file:line + prior-thread link +
diff), **(d)** an "Open follow-up issue" confirm button (with a confirm dialog).

## Run it

1. `npm install`
2. Create a Slack app (Socket Mode on). Bot scopes: `chat:write`,
   `channels:history`, `channels:read`, `groups:history`, `groups:read`
   (add `search:read` later for RTS). App-level token scope: `connections:write`.
3. Invite the bot to your `#incident-response` channel.
4. `cp .env.example .env` and fill in `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, and
   `INCIDENT_CHANNEL` (channel name or ID).
5. `npm run dev` (watch) or `npm run build && npm start`.
6. Paste a stack trace into `#incident-response` → EchoOps replies with the card.

### Dependency check (critical path for Layer 3)

`npm run check:ai-search` probes `assistant.search.info` on the configured
sandbox to confirm **Slack AI Search** is available (needed for semantic RTS).
See PROGRESS.md for the current status and the sandbox-request steps if missing.

## Layout

```
src/
  app.ts                  Bolt app entry (Socket Mode)
  config.ts               env config + validation
  listeners/
    message.ts            #incident-response listener + heuristic gate
    actions.ts            show/hide details + open-issue (stub)
  orchestrator/
    index.ts              chains the four layers, builds & posts the card
  services/
    types.ts              the four typed interfaces + shared types
    memory.ts code.ts synthesis.ts voice.ts   mock implementations
  blocks/
    incidentCard.ts       progressive-disclosure Block Kit card
  util/
    stackTrace.ts         detection heuristic + signature extraction
scripts/
  checkAiSearch.ts        Slack AI Search dependency probe
```
