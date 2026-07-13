/**
 * Seed a realistic HISTORICAL incident thread into the sandbox so Real-Time
 * Search has a genuine prior thread to find during the demo. THE DEMO DIES
 * WITHOUT THIS — RTS can only return a match that actually exists in history.
 *
 *   npm run seed
 *
 * What it plants (spec §4 canonical narrative), into SEED_CHANNEL:
 *   1. An old payment-gateway ETIMEDOUT stack trace (the "prior occurrence").
 *   2. A threaded resolution message crediting @trish, with a PR link, so the
 *      RTS parser can extract resolver + fix-era commit.
 *
 * The messages are posted by the bot, so the #incident-response listener ignores
 * them (it skips bot messages) — seeding never triggers a live triage.
 *
 * NOTE on realism: because the bot authors the resolution, the *author* is the
 * bot, not Trish. Rewynd therefore reads the resolver from an explicit
 * "Resolved by @trish" phrase in the text. For a fully authentic demo, have the
 * real Trish post the resolution herself (or seed with a user token).
 *
 * SCOPING (spec §7): SEED_CHANNEL must be PUBLIC if #incident-response is public
 * — from a public channel RTS only returns public results.
 */
import { WebClient } from '@slack/web-api';
import { config } from '../src/config';

const REPO = config.github.repo && /\//.test(config.github.repo)
  ? config.github.repo
  : 'your-org/checkout-service';

const HISTORICAL_TRACE = `:rotating_light: P1 — checkout failing for ~30% of orders

Error: connect ETIMEDOUT 10.0.3.14:443
    at PaymentGateway.charge (src/checkout/payments.ts:42:15)
    at Checkout.process (src/checkout/index.ts:120:9)
    at async OrderService.submit (src/orders/service.ts:88:5)`;

/**
 * Link the REAL fix commit so Rewynd can pin the fix era exactly — this is what a
 * genuine resolution message looks like, and it's what lets the MCP layer diff
 * today's code against the code as it was when the fix landed.
 *
 *   SEED_FIX_COMMIT=<sha>   (from the checkout-service repo — @trish's fix commit)
 *
 * Without it we fall back to a PR link, and the fix era is resolved by date.
 */
const FIX_COMMIT = process.env.SEED_FIX_COMMIT?.trim();
const FIX_REF = FIX_COMMIT
  ? `https://github.com/${REPO}/commit/${FIX_COMMIT}`
  : `https://github.com/${REPO}/pull/482`;

const RESOLUTION = `:white_check_mark: Root cause: the payment gateway was dropping connections under load and we had no retry, so checkout threw \`ETIMEDOUT\`.

Resolved by @trish in ${FIX_REF} — wrapped the gateway call in an exponential-backoff retry (3 attempts) and raised the socket timeout to 15s; added a checkout-timeout regression test.`;

function looksLikeId(v: string): boolean {
  return /^[CGD][A-Z0-9]{6,}$/.test(v);
}

async function resolveChannelId(client: WebClient, nameOrId: string): Promise<string> {
  const configured = nameOrId.replace(/^#/, '');
  if (looksLikeId(configured)) return configured;
  let cursor: string | undefined;
  do {
    const res = await client.conversations.list({
      types: 'public_channel,private_channel',
      limit: 200,
      cursor,
    });
    const match = res.channels?.find((c) => c.name === configured);
    if (match?.id) return match.id;
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);
  throw new Error(
    `Could not find channel "${nameOrId}". Invite the bot to it, or set SEED_CHANNEL to a channel ID.`,
  );
}

async function main(): Promise<void> {
  const client = new WebClient(config.slack.botToken);
  const channelName = config.slack.seedChannel;
  const channel = await resolveChannelId(client, channelName);

  console.log(`[seed] Planting historical incident into #${channelName} (${channel}) …`);

  const trace = await client.chat.postMessage({ channel, text: HISTORICAL_TRACE });
  const traceTs = trace.ts as string;

  await client.chat.postMessage({ channel, thread_ts: traceTs, text: RESOLUTION });

  let permalink = '';
  try {
    const pl = await client.chat.getPermalink({ channel, message_ts: traceTs });
    permalink = pl.permalink ?? '';
  } catch {
    /* non-fatal */
  }

  console.log('[seed] ✅ Historical incident planted.');
  console.log(`[seed] Thread ts: ${traceTs}`);
  if (permalink) console.log(`[seed] Permalink: ${permalink}`);
  console.log(
    '[seed] Now post a FRESH ETIMEDOUT trace in #' +
      config.slack.incidentChannel +
      ' — RTS should recover this thread (resolved by @trish, PR #482).',
  );
  console.log(
    '[seed] Repo used for the PR link: ' +
      REPO +
      (config.github.repo ? '' : '  (set GITHUB_REPO to make the PR link real)'),
  );
}

main().catch((e) => {
  console.error('[seed] failed:', e?.data?.error ?? e?.message ?? e);
  process.exitCode = 1;
});
