# Rewynd — Submission answer sheet

**Track: Slack Agent for Good** (sandbox + judge access; no Marketplace).
_(Not "Slack Agents for Organizations" — that requires a Slack App ID from a
Marketplace submission during the hackathon window, which isn't feasible here.)_

---

## Text description (features / functionality) — paste-ready

**Rewynd — "Your team already fixed this. I'll find out how."**

Rewynd is an institutional-memory incident-response agent for Slack. When an
engineer posts a stack trace in `#incident-response`, Rewynd automatically:

1. **Remembers** — searches the workspace's own history to recover the prior time
   this error was resolved: the thread, **who** fixed it, **when**, and the linked PR.
2. **Grounds against live code** — via the GitHub MCP server it fetches the current
   `file:line` that threw and **diffs it against the code from the era of that past
   fix**, deciding whether the old fix still applies (**MATCH**) or the code has
   since **DRIFTED**.
3. **Synthesizes** — reconciles the past fix with the current code into a concrete,
   current-code-specific recommendation and one ≤40-word triage summary.
4. **Speaks it** — renders that summary to a ~15-second voice clip for the
   hands-busy, 2am, on-mobile responder (summary only — never line numbers).
5. **Re-captures the knowledge** — one confirm-gated click opens a GitHub follow-up
   issue (linking the past incident, the current one, and the recommendation) and
   annotates the thread, so the fix is never lost again. Nothing is written before
   the human clicks.

It all arrives as a single progressive-disclosure Block Kit card: a one-line
verdict banner, the voice summary, expandable copy-pasteable detail (file:line,
the historical thread link, the diff, the recommended patch), and the confirm
button. Built on Bolt for JavaScript; uses the **GitHub MCP** server for code
grounding and the confirm-write, Slack **Real-Time / workspace search** for
memory, an open-source LLM for synthesis, and Murf for the voice clip.

---

## Impact (why this is an "Agent for Good") — paste-ready

On-call engineering is one of the most burnout-prone roles in technology. People
are woken at 2am to fix problems their organization has often **already solved and
forgotten** — so they re-derive a known fix, alone and exhausted, under pressure.
That knowledge decay has a real human cost (stress, burnout, attrition) and a
societal one: the digital services people depend on — payments, healthcare
portals, transit, communications — stay broken longer while someone re-solves a
problem the team already cracked months ago.

Rewynd attacks that at the root:

- **Reduces the human toll of on-call.** It hands the exhausted responder the
  answer their own team already found — cutting time-to-recovery and the stress of
  solving from scratch at 2am.
- **Knowledge equity.** The newest, most junior, remote, or underrepresented
  engineer instantly gets the wisdom of whoever solved it before — without needing
  an informal "who-do-I-ask" network. It democratizes tribal knowledge.
- **More resilient services.** Faster, more reliable incident resolution means the
  services communities rely on recover sooner and break less often — and the
  re-capture loop compounds, so the organization keeps getting better.
- **Preserves institutional memory.** Knowledge isn't lost when people leave;
  it echoes forward to whoever is on call next.

In short: Rewynd turns every past incident into help for the next person in the
chair — less burnout, faster recovery, and a fairer distribution of hard-won
knowledge.

---

## Required deliverables — checklist

- [x] **Text description** (above)
- [x] **Impact statement** (above)
- [x] **Architecture diagram** — [docs/architecture.svg](docs/architecture.svg)
- [ ] **~3-minute demo video** showing the working project — script in [DEMO.md](DEMO.md)
- [ ] **Slack developer sandbox URL** — `__________________________` (fill in)
- [ ] **Judge access granted** to `slackhack@salesforce.com` **and** `testing@devpost.com`
      (invite them to the sandbox workspace **and** to `#incident-response`)

_Deadline: tomorrow night. Lock the working sandbox demo first, then record._
