# Rewynd — Submission Checklist

**Challenge:** Slack Agent Builder Challenge · **Track:** New Slack Agent
**Deadline:** **Mon 13 Jul 2026, 5:00pm PDT** (≈ 5:30am IST, Tue 14 Jul) — submit
before this; you effectively lose the 14th.

## Prizes we're targeting
- 🏆 **Best New Slack Agent** ($8K)
- 🎨 **Best UX** ($2K) — progressive-disclosure card; audio-as-summary thesis; confirm-gated writes
- 🔧 **Best Technological Implementation** ($2K) — semantic-question RTS + MCP diff-validation + real MCP write

## Judge access (REQUIRED)
Grant sandbox / workspace access to **both**:
- [ ] `slackhack@salesforce.com`
- [ ] `testing@devpost.com`

Invite them to the workspace **and** to `#incident-response` so they can post a
stack trace and see Rewynd respond.

## Deliverables
- [ ] **Developer sandbox URL** with Rewynd installed and running:
      `__________________________________________` (fill in)
- [ ] **App deployed to an always-on host** (NOT `slack run` on a laptop) so the
      sandbox responds when judges test with your machine off — see [DEPLOY.md](DEPLOY.md).
- [ ] **Demo video (≤3 min)** — hook lands in first 30–60s; follows [DEMO.md](DEMO.md).
- [ ] **Architecture diagram** — [docs/architecture.svg](docs/architecture.svg)
      (source: [docs/architecture.mmd](docs/architecture.mmd)).
- [ ] **README** built around the institutional-memory thesis — [README.md](README.md).
- [ ] **Devpost submission** completed, prizes/track selected, before the deadline.

## Live-readiness (test with your laptop OFF)
- [ ] `npm run check:ai-search` → `ok=true` on the sandbox workspace.
- [ ] `npm run seed` has planted the historical `@trish` / `ETIMEDOUT` thread in a
      **public** channel visible to RTS.
- [ ] Post a fresh `ETIMEDOUT` trace in `#incident-response` → card returns with a
      **real** prior-thread link, resolver, and diff/verdict; `[RTS]`/`[MCP]`/`[LLM]`/`[Murf]`
      logs are clean.
- [ ] Tap **Open follow-up issue** → a **real** GitHub issue is created and the
      thread is annotated with the issue link.
- [ ] Bot invited to `#incident-response`; scopes present: `chat:write`,
      `channels:history`, `channels:read`, `groups:history`, `groups:read`,
      `search:read`, `users:read`, `files:write`; app token `connections:write`.

## Known gaps / honest notes (see PROGRESS.md)
- [ ] "Synthesis" runs on an **open-source / free-tier LLM**, not a Slack AI
      completion API (which does not exist). Required Slack techs claimed:
      **RTS + MCP**, both load-bearing. Say this plainly if asked.
- [ ] RTS `assistant.search.context` response shape is parsed defensively; confirm
      it maps correctly on the real sandbox during the live dry-run.

## Explicitly SKIP (Organizations-track only — not our track)
- [ ] ~~Marketplace submission~~ · ~~production deploy~~ · ~~5-workspace install~~ · ~~App ID~~
