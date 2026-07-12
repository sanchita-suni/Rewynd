# Rewynd — Devpost submission

Paste these fields into the Devpost form. Track: **New Slack Agent**.
Prizes: **Best New Slack Agent · Best UX · Best Technological Implementation**.

---

## Tagline
**Your team already fixed this. I'll find out how.**

## Elevator pitch (≤ 200 chars)
Rewynd is an institutional-memory incident responder for Slack: it recovers how your team fixed this error last time, checks the fix against your current code, and re-captures the knowledge.

## Inspiration
Every engineering org has already solved most of its incidents. The fix is buried
in a Slack thread from eight months ago, and the person who wrote it is asleep — so
at 2am the on-call engineer re-solves it from scratch. That's knowledge decay, and
it's the highest-pain, most-repeated moment in on-call work. Slack's Real-Time
Search pitch is *"unlock institutional knowledge trapped in conversations."* Rewynd
is the sharpest instance of exactly that thesis, pointed at the incident channel.

## What it does
When a stack trace lands in `#incident-response`, Rewynd:
1. **Remembers** — a *natural-language question* query to Real-Time Search recovers
   the prior thread, **who** fixed it, **when**, and the linked PR.
2. **Grounds** — pulls the current `file:line` via the GitHub MCP server and diffs
   it against the fix-era commit: does the old fix still apply (**MATCH**) or has the
   code drifted (**DRIFTED**)?
3. **Synthesizes** — reconciles *[past fix] × [current code]* into a
   current-code-specific recommendation and one ≤40-word triage summary.
4. **Speaks** — renders that summary to a ~15s voice clip (native audio player).
5. **Re-captures** — a confirm-gated button opens a GitHub follow-up issue (linking
   the prior incident + current occurrence + recommendation) and annotates the
   thread. Nothing writes before the human click.

It all arrives as **one progressive-disclosure Block Kit card**: a verdict banner
(the glance), the spoken summary (hands-busy/2am), and expandable text carrying
every line number, deep link, diff, and patch. *Audio is the summary; text is the
detail carrier.*

## How we built it
Bolt for JavaScript (TypeScript), Socket Mode. Four intelligence layers behind
typed interfaces, chained by one orchestrator:
- **Real-Time Search** (`assistant.search.context`) — question-form semantic query,
  session-cached for rate limits.
- **GitHub MCP** — a dependency-free Streamable-HTTP MCP client calls
  `get_file_contents` / `list_commits` to ground + diff, and `create_issue` to close
  the loop.
- **Synthesis** — an OpenAI-compatible LLM (Groq/OpenRouter/Ollama) with a
  deterministic fallback.
- **Voice** — Murf TTS, uploaded to the thread as a native player.
Every layer degrades honestly instead of crashing.

## The required Slack technologies (used, load-bearing)
- **Real-Time Search API** — the memory engine. Remove it and there's no "your team
  already fixed this." *(hero)*
- **MCP (GitHub MCP server)** — code grounding, drift validation, and the real issue
  write. Remove it and the agent can't tell if the old fix still applies.

*Honest note:* synthesis runs on an open-source LLM, not a Slack AI completion API
(Slack AI is a set of product features, not a callable endpoint). The two Slack
technologies Rewynd genuinely uses — RTS + MCP — are both load-bearing, satisfying
the "≥1" requirement with margin.

## Challenges we ran into
- **Slack AI Search entitlement** is a hard dependency for semantic RTS — a
  lead-time risk we de-risked on day one.
- **The killer objection** to every incident bot — *does the old fix still apply?* —
  which we answered with the MCP fix-era diff (MATCH/DRIFTED).
- **Keeping audio honest** — the spoken summary must never carry a line number, so
  we sanitize it and let text own the detail.

## Accomplishments we're proud of
A complete end-to-end loop that doesn't just *find* the fix but **re-captures** it —
turning a chatbot into a story about organizational learning — plus a UX thesis
(progressive disclosure, right modality per layer) that's defensible under scrutiny.

## What we learned
Aligning with the sponsor's own narrative beats chasing novelty; and a
complete-but-rough end-to-end flow beats a slick partial one.

## What's next
Auto-capture resolutions (not just issues), multi-repo grounding, Jira/Linear via
MCP, and confidence scoring on the MATCH/DRIFTED verdict.

## Built with
`slack` · `bolt-js` · `typescript` · `real-time-search` · `mcp` · `github` ·
`node` · `block-kit` · `murf` · `llm`

## Try it (for judges)
Sandbox access granted to `slackhack@salesforce.com` and `testing@devpost.com`.
Post a stack trace in `#incident-response` and watch the card + the
`[RTS]`/`[MCP]`/`[LLM]`/`[Murf]` log trace; tap **Open follow-up issue** to see the
real GitHub write. Repo README + architecture diagram included.
