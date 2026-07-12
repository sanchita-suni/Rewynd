# Rewynd — 3-minute demo script

Judges spend ~5–7 minutes per project and **the first 60 seconds are decisive**.
Lead with the pain and the reveal; save the plumbing for the middle. The thesis
to land: *your team already fixed this — Rewynd finds out how, and re-captures it.*

---

## Pre-flight (do this BEFORE recording)

1. **Deploy the app to an always-on host** (see [DEPLOY.md](DEPLOY.md)). Do **not**
   run it on your laptop during judging — the sandbox must respond with your
   machine off.
2. **Verify Slack AI Search:** `npm run check:ai-search` → expect `ok=true`.
3. **Seed the historical incident** so RTS has a real match:
   ```bash
   npm run seed
   ```
   This plants, into `SEED_CHANNEL`, an old `ETIMEDOUT` payment-gateway trace + a
   resolution crediting **@trish** with a PR link. Confirm it posted (the script
   prints the thread permalink).
   - `SEED_CHANNEL` **must be a public channel** if `#incident-response` is public
     — from a public channel RTS only returns public results.
   - For maximum realism, have the real "Trish" post the resolution herself (or
     seed with a user token); otherwise the resolver is read from the
     "Resolved by @trish" phrase in the seeded message.
4. **Have your split-screen ready:** Slack `#incident-response` on one side, the
   app's terminal logs on the other.
5. **Copy a fresh trigger trace** to paste (a NEW occurrence of the same class):
   ```
   Error: connect ETIMEDOUT 10.0.3.14:443
       at PaymentGateway.charge (src/checkout/payments.ts:42:15)
       at Checkout.process (src/checkout/index.ts:120:9)
   ```

---

## Shot list & voice-over

### 0:00–0:25 — The pain, reframed
> **VO:** "Every engineering org has already solved most of its incidents. The fix
> is buried in a Slack thread from eight months ago, and the person who wrote it is
> asleep. So the team re-solves it from scratch. Rewynd ends that."

*Shot:* title card or a quiet `#incident-response` channel.

### 0:25–0:55 — Trigger
> **VO:** "It's 2am. Trish drops the stack trace into #incident-response."

*Shot:* paste the fresh `ETIMEDOUT` trace. Cut to the terminal catching the event.

### 0:55–2:00 — The three logs (this is the Technological Implementation score, on screen)
*Shot:* the terminal. Point at each line as it appears:
```
[RTS]  Semantic query → match found: thread from Mar 2026, resolved by @trish
[MCP]  GitHub → current src/checkout/payments.ts:42 diffed vs fix-era → MATCH (fix still applies)
[LLM]  Synthesizing current-code recommendation…
[Murf] ~15s triage rendered
```
> **VO:** "Real-Time Search finds *the thread where we fixed this before*. The
> GitHub MCP server pulls the current code and diffs it against the fix era — so we
> know the old fix still applies. Then it synthesizes a recommendation and renders
> a 15-second spoken triage."

> **Note:** the synthesis log reads `[LLM]`, not `[Slack AI]` — Rewynd synthesizes
> on an open-source model. The two Slack technologies it leans on, **RTS + MCP**,
> are the load-bearing ones. Say this plainly if a judge asks.

### 2:00–2:40 — The reveal
*Shot:* the Block Kit card in the thread.
1. Read the **verdict banner**: `✅ Seen before · fixed by @trish · Mar 2026 · current code MATCHES`.
2. **Play the ~15s audio** (native player under the card).
3. Tap **Show details** → the prior-thread deep link, the diff, the recommended patch.
> **VO:** "One line tells the on-call engineer everything: we've seen this, who
> fixed it, and whether the fix still applies. Audio is the glance-able summary —
> every line number lives in text you can copy."

### 2:40–3:00 — The bow (this is real — show it working)
*Shot:* tap **Open follow-up issue** → confirm dialog → the created GitHub issue →
back in Slack, the thread annotation with the issue link, and the card updates to
`✅ Follow-up issue created: #123`.
> **VO:** "Rewynd didn't just recover the fix. It re-captured it — a tracked issue
> linking the old incident, the new one, and the recommendation — so the next
> on-call engineer never loses it again."

---

## If something fails live (graceful, on purpose)
Rewynd degrades instead of crashing — useful if a service hiccups on stage:
- **No prior match** → banner reads *"New signature · no prior incident."*
- **Code drifted** → banner reads *"code has since DRIFTED — the old fix may not apply."*
- **RTS / MCP / Murf error** → the card still renders (text-only if audio fails);
  logs show a clear `ERROR → degrading` line.
- **Worst case:** run with `USE_MOCKS=true` for a fully offline, deterministic
  walkthrough of the exact same card.
