import type { KnownBlock } from '@slack/types';
import {
  CodeGrounding,
  CreatedIssue,
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
export const ACTION_SHOW_DETAILS = 'rewynd_show_details';
export const ACTION_HIDE_DETAILS = 'rewynd_hide_details';
export const ACTION_OPEN_ISSUE = 'rewynd_open_issue';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Format an ISO timestamp as e.g. "Mar 2026" for the verdict banner. */
function monthYear(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 7);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * The verdict banner (spec §2.1) — one line, the highest-value signal. "This
 * alone is the product." Packs seen-before + resolver + when + current-code
 * verdict into a single glanceable line.
 */
function verdictBanner(model: IncidentCardModel): string {
  const { prior, code } = model;
  if (!prior) {
    return `🆕  *New signature · no prior incident on record · triage from scratch*`;
  }
  const who = `@${prior.resolver}`;
  const when = monthYear(prior.resolvedAt);
  if (code.verdict === 'MATCH') {
    return `✅  *Seen before · fixed by ${who} · ${when} · current code MATCHES — the fix still applies*`;
  }
  return `⚠️  *Seen before · fixed by ${who} · ${when} · code has since DRIFTED — the old fix may not apply*`;
}

export interface CardOptions {
  /** Whether the copy-pasteable detail (c) is expanded. */
  expanded: boolean;
  /** When set, the confirm button (d) is replaced by an "issue created" note. */
  issue?: CreatedIssue;
}

/**
 * Build the progressive-disclosure incident card (spec §2).
 *
 *   (a) verdict banner line
 *   (b) ~15s spoken-triage summary (native audio player is uploaded separately)
 *   (c) expandable detail: file:line + prior-thread link + diff + recommended patch
 *   (d) "Open follow-up issue" confirm button — or, once created, the issue link
 *
 * When `expanded` is false the detail (c) is hidden behind a "Show details"
 * button; the Show/Hide action re-renders the message with the other value.
 */
export function buildIncidentCard(
  model: IncidentCardModel,
  opts: CardOptions = { expanded: false },
): KnownBlock[] {
  const loc = `${model.code.file}:${model.code.line}`;
  const sigText = model.errorSignature.signature;
  const tv = toggleValue(model.errorSignature);

  const blocks: KnownBlock[] = [];

  // (a) Verdict banner — one line, the highest-value signal (spec §2.1).
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: verdictBanner(model) },
  });
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `*Signature:* \`${sigText}\`` }],
  });

  // (b) ~15s spoken triage (spec §2.2) — SUMMARY ONLY, never detail. This is the
  // glanceable/hands-busy layer; the audio and this card text share ONE summary.
  // When the audio is real, a native player is uploaded to the thread; otherwise
  // we link the hosted URL.
  const audioLine = model.voice.isMock
    ? `🔊 *~15s voice triage* — <${model.voice.audioUrl}|play summary>`
    : `🔊 *~15s voice triage* — ▶️ playable clip posted in this thread`;
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `${audioLine}\n_“${model.synthesis.triageSummary}”_`,
    },
  });

  blocks.push({ type: 'divider' });

  // (c) Expandable detail (spec §2.3) — everything copy-pasteable: file:line,
  // deep link to the historical thread, the diff, and the recommended patch.
  // Audio never has to carry a line number; it all lives here in text.
  if (opts.expanded) {
    const priorText = model.prior
      ? `*Prior incident:* <${model.prior.threadUrl}|resolved ${monthYear(
          model.prior.resolvedAt,
        )} by @${model.prior.resolver}>\n${model.prior.fixSummary}`
      : '*Prior incident:* none on record — this is the first sighting.';

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Grounded at* \`${loc}\`  ·  code verdict *${model.code.verdict}*`,
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
        text: `*Recommended fix*\n${model.synthesis.recommendation}`,
      },
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

  // Toggle button (c): show/hide the copy-pasteable detail.
  const toggleButton = opts.expanded
    ? {
        type: 'button' as const,
        action_id: ACTION_HIDE_DETAILS,
        text: { type: 'plain_text' as const, text: 'Hide details' },
        value: tv,
      }
    : {
        type: 'button' as const,
        action_id: ACTION_SHOW_DETAILS,
        text: { type: 'plain_text' as const, text: 'Show details' },
        value: tv,
      };

  if (opts.issue) {
    // Post-confirm state: the write happened — show the issue link, no button.
    blocks.push({
      type: 'actions',
      block_id: 'rewynd_actions',
      elements: [toggleButton],
    });
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `✅ Follow-up issue created: <${opts.issue.url}|#${opts.issue.number}> — knowledge re-captured.`,
        },
      ],
    });
    return blocks;
  }

  // (d) Confirm-gated action — human-in-the-loop before any write (spec §2.4).
  blocks.push({
    type: 'actions',
    block_id: 'rewynd_actions',
    elements: [
      toggleButton,
      {
        type: 'button',
        action_id: ACTION_OPEN_ISSUE,
        style: 'primary',
        text: { type: 'plain_text', text: 'Open follow-up issue' },
        // Signature is enough — the handler recalls the full model from the cache.
        value: JSON.stringify({ signature: sigText, loc }),
        confirm: {
          title: { type: 'plain_text', text: 'Open follow-up issue?' },
          text: {
            type: 'mrkdwn',
            text: `This will open a GitHub tracking issue for \`${sigText}\` (grounded at \`${loc}\`) and annotate this thread.`,
          },
          confirm: { type: 'plain_text', text: 'Create issue' },
          deny: { type: 'plain_text', text: 'Cancel' },
        },
      },
    ],
  });

  return blocks;
}
