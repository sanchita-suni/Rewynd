# Rewynd

### Your team already fixed this. I'll tell you whether that fix still works.

A Slack agent for the 2am incident your team has already solved — and forgotten.

---

## The problem with "we've seen this before"

Every engineering org has already solved most of its incidents. The fix is buried in
a Slack thread from eight months ago, and the person who wrote it is asleep. So the
on-call engineer re-solves it from scratch.

Plenty of tools will resurface that old thread. **That's the easy half, and on its
own it's dangerous** — because the code has moved on. The fix that worked in March
may have been refactored away in June. Handing someone a stale patch with confidence
is worse than handing them nothing.

**So Rewynd doesn't stop at remembering. It checks whether the old fix survived.**

When a stack trace lands, Rewynd finds the thread where you fixed it before, then
pulls the **commit from the era of that fix** and diffs it against the code running
today:

```
✅ Seen before · fixed by @trish · Jul 2026 · current code MATCHES — the fix still applies
⚠️ Seen before · fixed by @trish · Jul 2026 · code has since DRIFTED — the old fix may not apply
```

That second line is the whole product. It's the difference between institutional
memory and institutional *judgment*.

---

## What it does

1. **Notices** a stack trace — in `#incident-response`, or DM'd to the agent.
2. **Remembers** — recovers the prior thread, who resolved it, when, and the linked fix.
3. **Grounds it** — via the GitHub MCP server: fetches the current `file:line`, resolves
   the fix-era commit from the resolution thread, diffs the implicated region →
   **MATCH** or **DRIFTED**.
4. **Reconciles** — an LLM turns *[past fix] × [current code]* into a recommendation for
   the code as it exists *now*. If it drifted, it says so and explains why the old patch
   won't transfer.
5. **Speaks** — a ~15s spoken triage summary.
6. **Re-captures** — one confirm-gated click opens a GitHub issue linking the old
   incident, the new one, and the recommendation, and annotates the thread.

One progressive-disclosure Block Kit card carries all of it: verdict banner → voice
summary → expandable detail (file:line, thread deep-link, diff, patch) → confirm button.

## Two front doors, and the reason why

`assistant.search.context` — Slack's Real-Time Search — requires an **`action_token`**.
Slack only attaches that token to **agent-surface** events. It is *never* present on a
plain channel message. A channel-only agent therefore **cannot** run semantic search,
no matter what scopes it holds.

So Rewynd runs on both surfaces, with the same orchestrator:

| Surface | Memory |
|---|---|
| **Agent DM** | `action_token` present → **Real-Time Search**, as a natural-language question query (semantic retrieval) |
| **`#incident-response`** | no token → workspace conversation-history search |

The logs always name the path that actually ran (`via semantic RTS` / `via
channel-history fallback`). Rewynd never claims a capability it didn't use.

## Technologies

The challenge requires at least one of *Slack AI capabilities · MCP server integration ·
Real-Time Search API*. Rewynd uses two, both load-bearing:

**MCP server integration** — a from-scratch MCP client (Streamable HTTP: `initialize` →
`tools/list` → `tools/call`, handling both JSON and SSE responses) driving the GitHub MCP
server. It calls `get_file_contents` and `list_commits` to ground the error and pin the
fix era, and `issue_write` to file the follow-up issue. Remove MCP and Rewynd can't tell
you whether the fix still applies, nor close the loop.

**Real-Time Search API** — `assistant.search.context` with question-form queries
(*"How was the ETIMEDOUT error in payments resolved before?"*), which is what triggers
semantic rather than keyword retrieval.

Synthesis runs on any OpenAI-compatible endpoint (Groq / OpenRouter / local Ollama) —
Slack AI is a set of product features, not a callable completion API, so Rewynd doesn't
pretend to "call Slack AI." Voice is Murf.

## Design notes

**Nothing writes before a human clicks.** The GitHub issue is created only on confirm,
behind a dialog. This is also why the trigger can afford to be a cheap heuristic
(exception keywords, `file:line`, multi-line frames): the cost of a false positive is a
collapsed card someone ignores, not a spurious write to your repo.

**Audio is the summary layer; text is the detail carrier.** The spoken clip is for the
responder who is heads-down in a terminal or on their phone at 2am — it carries the
verdict and the gist, and it is explicitly sanitised so no file path or line number ever
reaches the audio. Every copy-pasteable thing lives in text.

**Everything degrades honestly.** RTS unavailable → history search. MCP unreachable →
grounding marked unavailable, and if a prior fix exists Rewynd stays cautious rather than
claiming it still applies. No LLM configured → deterministic synthesis. No Murf → a
text-only card. It never fabricates a match.

## Architecture

![Rewynd architecture](docs/architecture.svg)

```
message → heuristic gate
        → memory (RTS | history) → code (GitHub MCP: file:line + fix-era diff)
        → synthesis (LLM) → voice (Murf)
        → progressive-disclosure card
   confirm → GitHub MCP issue_write + thread annotation
```

Each layer sits behind a typed interface (`src/services/types.ts`); the orchestrator and
the card only ever talk to interfaces, so any integration can be swapped without touching
the flow.

## Running it

```bash
npm install
cp .env.example .env        # Slack tokens, GITHUB_TOKEN/GITHUB_REPO, optional LLM + Murf
npm run seed                # plant a historical incident for Rewynd to find
npm run dev
```

Then paste a stack trace into `#incident-response`, or DM the agent.

**Slack app:** create it from [`slack-app-manifest.json`](slack-app-manifest.json)
(Socket Mode, Agents & AI Apps enabled, and *App Home → allow users to send messages*).

**Checks:** `npm run check:ai-search` (is Slack AI Search on?) ·
`npm run check:layer2` / `check:layer3` (offline self-tests of the search/diff/synthesis
logic — no credentials needed).

`USE_MOCKS=true` runs the whole thing offline from fixtures.

## Layout

```
src/
  listeners/message.ts     heuristic gate · both surfaces · action_token · dedupe
  listeners/actions.ts     detail toggle · confirm-gated issue write
  orchestrator/            memory → code → synthesis → voice; per-incident cache
  services/
    memory.ts              Real-Time Search + conversation-history fallback
    code.ts                GitHub MCP grounding + fix-era diff (MATCH/DRIFTED)
    mcp.ts                 MCP client, written from scratch
    github.ts  llm.ts  rts.ts  diff.ts  synthesis.ts  voice.ts
  blocks/incidentCard.ts   the card
  util/stackTrace.ts       detection + signature extraction
```
