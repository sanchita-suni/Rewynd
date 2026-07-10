import type { KnownBlock } from '@slack/types';
import {
  CodeGrounding,
  ErrorSignature,
  PriorIncident,
  Synthesis,
  VoiceRendering,
} from '../services/types';

/** Everything the card needs, assembled by the orchestrator from the four layers. */
export interface IncidentCardModel {
  errorSignature: ErrorSignature;
  prior: PriorIncident | null;
  code: CodeGrounding;
  synthesis: Synthesis;
  voice: VoiceRendering;
}

/**
 * Compact payload embedded in the show/hide toggle button so the action handler
 * can re-run the (deterministic) service chain and re-render without extra API
 * calls. `raw` is truncated to stay well under Slack's button value limit.
 */
function toggleValue(sig: ErrorSignature): string {
  return JSON.stringify({
    signature: sig.signature,
    errorType: sig.errorType,
    topFile: sig.topFile,
    topLine: sig.topLine,
    raw: sig.raw.slice(0, 1200),
  });
}

/** Action IDs — referenced by the action handlers. */
export const ACTION_SHOW_DETAILS = 'echoops_show_details';
export const ACTION_HIDE_DETAILS = 'echoops_hide_details';
export const ACTION_OPEN_ISSUE = 'echoops_open_issue';

interface VerdictStyle {
  emoji: string;
  label: string;
}

function verdictStyle(model: IncidentCardModel): VerdictStyle {
  if (model.prior && model.code.verdict === 'DRIFTED') {
    return { emoji: '⚠️', label: 'KNOWN INCIDENT · CODE DRIFTED' };
  }
  if (model.prior && model.code.verdict === 'MATCH') {
    return { emoji: '✅', label: 'KNOWN INCIDENT · CODE UNCHANGED' };
  }
  return { emoji: '🆕', label: 'NEW SIGNATURE · NO PRIOR INCIDENT' };
}

/**
 * Build the progressive-disclosure incident card (spec §2).
 *
 *   (a) verdict banner line
 *   (b) audio block / placeholder
 *   (c) expandable detail: file:line + prior-thread link + diff
 *   (d) "Open follow-up issue" confirm button
 *
 * When `expanded` is false the detail (c) is hidden behind a "Show details"
 * button; the Show/Hide action re-renders the message with the other value.
 */
export function buildIncidentCard(
  model: IncidentCardModel,
  opts: { expanded: boolean } = { expanded: false },
): KnownBlock[] {
  const v = verdictStyle(model);
  const loc = `${model.code.file}:${model.code.line}`;
  const sigText = model.errorSignature.signature;
  const tv = toggleValue(model.errorSignature);

  const blocks: KnownBlock[] = [];

  // (a) Verdict banner line.
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `${v.emoji}  *${v.label}*`,
    },
  });
  blocks.push({
    type: 'context',
    elements: [
      { type: 'mrkdwn', text: `*Signature:* \`${sigText}\`` },
    ],
  });

  // Recommendation (always shown — the headline judgment).
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Recommendation*\n${model.synthesis.recommendation}`,
    },
  });

  // (b) Audio block / placeholder for the spoken triage summary.
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `🔊 *Voice triage* — <${model.voice.audioUrl}|play triage summary>`,
    },
  });
  blocks.push({
    type: 'context',
    elements: [
      { type: 'mrkdwn', text: `_“${model.synthesis.triageSummary}”_` },
    ],
  });

  blocks.push({ type: 'divider' });

  // (c) Expandable detail: file:line + prior-thread link + diff.
  if (opts.expanded) {
    const priorText = model.prior
      ? `*Prior incident:* <${model.prior.threadUrl}|resolved ${model.prior.resolvedAt.slice(
          0,
          10,
        )} by ${model.prior.resolver}>\n${model.prior.fixSummary}`
      : '*Prior incident:* none on record — this is the first sighting.';

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Grounded at* \`${loc}\`  ·  verdict *${model.code.verdict}*`,
      },
    });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: priorText },
    });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Current code*\n\`\`\`${model.code.currentSnippet}\`\`\``,
      },
    });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Diff vs fix era*\n\`\`\`${model.code.diffVsFixEra}\`\`\``,
      },
    });
  }

  // Action row: (c) show/hide toggle + (d) open follow-up issue confirm button.
  blocks.push({
    type: 'actions',
    block_id: 'echoops_actions',
    elements: [
      opts.expanded
        ? {
            type: 'button',
            action_id: ACTION_HIDE_DETAILS,
            text: { type: 'plain_text', text: 'Hide details' },
            value: tv,
          }
        : {
            type: 'button',
            action_id: ACTION_SHOW_DETAILS,
            text: { type: 'plain_text', text: 'Show details' },
            value: tv,
          },
      {
        type: 'button',
        action_id: ACTION_OPEN_ISSUE,
        style: 'primary',
        text: { type: 'plain_text', text: 'Open follow-up issue' },
        // Carry enough context to create the issue later without re-deriving it.
        value: JSON.stringify({ signature: sigText, loc }),
        confirm: {
          title: { type: 'plain_text', text: 'Open follow-up issue?' },
          text: {
            type: 'mrkdwn',
            text: `This will open a tracking issue for \`${sigText}\` grounded at \`${loc}\`.`,
          },
          confirm: { type: 'plain_text', text: 'Create issue' },
          deny: { type: 'plain_text', text: 'Cancel' },
        },
      },
    ],
  });

  return blocks;
}
