import type { App, BlockButtonAction } from '@slack/bolt';
import { ErrorSignature } from '../services/types';
import { assembleModel } from '../orchestrator';
import {
  ACTION_HIDE_DETAILS,
  ACTION_OPEN_ISSUE,
  ACTION_SHOW_DETAILS,
  buildIncidentCard,
} from '../blocks/incidentCard';

/** Rebuild an ErrorSignature from a toggle button's compact payload. */
function parseSignature(value: string | undefined): ErrorSignature {
  const parsed = value ? JSON.parse(value) : {};
  return {
    signature: parsed.signature ?? 'unknown',
    errorType: parsed.errorType,
    topFile: parsed.topFile,
    topLine: parsed.topLine,
    raw: parsed.raw ?? '',
  };
}

export function registerActionListeners(app: App): void {
  // (c) Progressive disclosure: re-render the message expanded/collapsed.
  const toggle = (expanded: boolean) =>
    async ({ ack, body, client, logger, action }: any) => {
      await ack();
      const b = body as BlockButtonAction;
      const signature = parseSignature((action as { value?: string }).value);
      const model = await assembleModel(signature);
      const blocks = buildIncidentCard(model, { expanded });

      if (b.channel?.id && b.message?.ts) {
        await client.chat.update({
          channel: b.channel.id,
          ts: b.message.ts,
          text: `EchoOps triage: ${model.synthesis.triageSummary}`,
          blocks,
        });
      }
      logger.info(`[action] toggled details expanded=${expanded}`);
    };

  app.action(ACTION_SHOW_DETAILS, toggle(true));
  app.action(ACTION_HIDE_DETAILS, toggle(false));

  // (d) Confirm button — STUB for this layer.
  // Real GitHub issue creation (via GITHUB_TOKEN / MCP) arrives in Layer 3.
  app.action(ACTION_OPEN_ISSUE, async ({ ack, body, client, logger, action }: any) => {
    await ack();
    const b = body as BlockButtonAction;
    let signature = 'unknown';
    let loc = 'unknown';
    try {
      const v = JSON.parse((action as { value?: string }).value ?? '{}');
      signature = v.signature ?? signature;
      loc = v.loc ?? loc;
    } catch {
      /* value was not JSON — fall back to defaults */
    }

    // Deterministic pretend issue number so the demo reads realistically.
    const fakeIssueNumber = 1000 + (Math.abs(hashCode(signature)) % 9000);
    logger.info(
      `[action] open-issue (STUB) signature="${signature}" loc=${loc} -> would create issue #${fakeIssueNumber}`,
    );

    if (b.channel?.id && b.user?.id) {
      await client.chat.postEphemeral({
        channel: b.channel.id,
        user: b.user.id,
        thread_ts: b.message?.thread_ts ?? b.message?.ts,
        text:
          `:memo: *(stub)* Would create GitHub issue #${fakeIssueNumber} for \`${signature}\` ` +
          `grounded at \`${loc}\`. Real issue creation lands in Layer 3.`,
      });
    }
  });
}

/** Small stable hash so the stub issue number is deterministic per signature. */
function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}
