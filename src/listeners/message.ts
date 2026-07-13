import type { App } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import { config } from '../config';
import { looksLikeStackTrace } from '../util/stackTrace';
import { runIncident } from '../orchestrator';

/** Resolve a channel name (or ID) to a channel ID once and cache it. */
let resolvedIncidentChannelId: string | null = null;

/**
 * De-dupe events. Slack can deliver the same event more than once (dual Socket
 * Mode connections, retries), which would otherwise post the card multiple times.
 */
const processedEvents = new Set<string>();
function alreadyProcessed(key: string): boolean {
  if (processedEvents.has(key)) return true;
  processedEvents.add(key);
  if (processedEvents.size > 1000) processedEvents.clear(); // simple bound
  return false;
}

function looksLikeId(value: string): boolean {
  return /^[CGD][A-Z0-9]{6,}$/.test(value);
}

async function resolveIncidentChannelId(client: WebClient): Promise<string | null> {
  if (resolvedIncidentChannelId) return resolvedIncidentChannelId;

  const configured = config.slack.incidentChannel.replace(/^#/, '');
  if (looksLikeId(configured)) {
    resolvedIncidentChannelId = configured;
    return resolvedIncidentChannelId;
  }

  // Look up the channel by name across public + private channels the bot can see.
  let cursor: string | undefined;
  do {
    const res = await client.conversations.list({
      types: 'public_channel,private_channel',
      limit: 200,
      cursor,
    });
    const match = res.channels?.find((c) => c.name === configured);
    if (match?.id) {
      resolvedIncidentChannelId = match.id;
      return resolvedIncidentChannelId;
    }
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return null;
}

export function registerMessageListener(app: App): void {
  app.message(async ({ message, body, payload, client, logger }) => {
    // Only handle plain user messages with text — ignore edits, joins, bot posts.
    const m = message as {
      subtype?: string;
      bot_id?: string;
      text?: string;
      channel?: string;
      channel_type?: string;
      ts?: string;
      thread_ts?: string;
    };
    if (m.subtype || m.bot_id) return;
    if (!m.text || !m.channel || !m.ts) return;

    // Skip duplicate deliveries of the same event.
    const eventKey = (body as any)?.event_id ?? `${m.channel}:${m.ts}`;
    if (alreadyProcessed(eventKey)) {
      logger.debug(`[message] duplicate event ${eventKey} — skipping`);
      return;
    }

    // `assistant.search.context` needs the action_token Slack delivers in the
    // event payload for AI apps. Check the spots it can appear.
    const actionToken =
      (payload as any)?.action_token ??
      (body as any)?.event?.action_token ??
      (body as any)?.action_token;

    // Two surfaces:
    //  • DM / agent pane  → Slack attaches an `action_token`, so semantic RTS runs.
    //  • #incident-response → no action_token; memory falls back to history search.
    const channelType =
      m.channel_type ??
      (payload as any)?.channel_type ??
      (body as any)?.event?.channel_type;
    const isDirectMessage = channelType === 'im';

    if (!isDirectMessage) {
      const incidentChannelId = await resolveIncidentChannelId(client);
      if (!incidentChannelId) {
        logger.warn(
          `[message] could not resolve incident channel "${config.slack.incidentChannel}". ` +
            `Set INCIDENT_CHANNEL to a channel ID or invite the bot to the channel.`,
        );
        return;
      }
      if (m.channel !== incidentChannelId) return;
    }

    const verdict = looksLikeStackTrace(m.text);
    if (!verdict.isStackTrace) {
      logger.debug(`[message] not a stack trace (signals: ${verdict.signals.join(',') || 'none'})`);
      return;
    }

    const surface = isDirectMessage ? 'agent DM' : '#' + config.slack.incidentChannel;
    logger.info(
      `[message] stack trace detected on ${surface} (signals: ${verdict.signals.join(',')}) — triaging`,
    );
    try {
      await runIncident({
        client,
        channel: m.channel,
        // Reply in-thread on the triggering message.
        threadTs: m.thread_ts ?? m.ts,
        text: m.text,
        logger,
        actionToken,
      });
    } catch (err) {
      logger.error(`[message] orchestrator failed: ${(err as Error).message}`);
      await client.chat.postMessage({
        channel: m.channel,
        thread_ts: m.thread_ts ?? m.ts,
        text: `:warning: Rewynd hit an error while triaging this incident: ${(err as Error).message}`,
      });
    }
  });
}
