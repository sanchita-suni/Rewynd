import type { App } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import { config } from '../config';
import { looksLikeStackTrace } from '../util/stackTrace';
import { runIncident } from '../orchestrator';

/** Resolve a channel name (or ID) to a channel ID once and cache it. */
let resolvedIncidentChannelId: string | null = null;

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
  app.message(async ({ message, client, logger }) => {
    // Only handle plain user messages with text — ignore edits, joins, bot posts.
    const m = message as {
      subtype?: string;
      bot_id?: string;
      text?: string;
      channel?: string;
      ts?: string;
      thread_ts?: string;
    };
    if (m.subtype || m.bot_id) return;
    if (!m.text || !m.channel || !m.ts) return;

    const incidentChannelId = await resolveIncidentChannelId(client);
    if (!incidentChannelId) {
      logger.warn(
        `[message] could not resolve incident channel "${config.slack.incidentChannel}". ` +
          `Set INCIDENT_CHANNEL to a channel ID or invite the bot to the channel.`,
      );
      return;
    }
    if (m.channel !== incidentChannelId) return;

    const verdict = looksLikeStackTrace(m.text);
    if (!verdict.isStackTrace) {
      logger.debug(`[message] not a stack trace (signals: ${verdict.signals.join(',') || 'none'})`);
      return;
    }

    logger.info(`[message] stack trace detected (signals: ${verdict.signals.join(',')}) — triaging`);
    try {
      await runIncident({
        client,
        channel: m.channel,
        // Reply in-thread on the triggering message.
        threadTs: m.thread_ts ?? m.ts,
        text: m.text,
        logger,
      });
    } catch (err) {
      logger.error(`[message] orchestrator failed: ${(err as Error).message}`);
      await client.chat.postMessage({
        channel: m.channel,
        thread_ts: m.thread_ts ?? m.ts,
        text: `:warning: EchoOps hit an error while triaging this incident: ${(err as Error).message}`,
      });
    }
  });
}
