import type { App, BlockButtonAction } from '@slack/bolt';
import { ErrorSignature, CreatedIssue } from '../services/types';
import { assembleModel } from '../orchestrator';
import { mergeIncident, recallIncident } from '../orchestrator/incidentContext';
import { createFollowUpIssue, isGithubConfigured } from '../services/github';
import {
  ACTION_HIDE_DETAILS,
  ACTION_OPEN_ISSUE,
  ACTION_SHOW_DETAILS,
  buildIncidentCard,
} from '../blocks/incidentCard';

/** Rebuild an ErrorSignature from a toggle/confirm button's compact payload. */
function parseSignature(value: string | undefined): ErrorSignature {
  const parsed = value ? safeJson(value) : {};
  return {
    signature: parsed.signature ?? 'unknown',
    errorType: parsed.errorType,
    topFile: parsed.topFile,
    topLine: parsed.topLine,
    raw: parsed.raw ?? '',
  };
}

function safeJson(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export function registerActionListeners(app: App): void {
  // (c) Progressive disclosure: re-render expanded/collapsed. Cheap — assembleModel
  // reuses the cached synthesis/voice, so no LLM/TTS re-calls. Preserves the
  // "issue created" state if the write already happened.
  const toggle = (expanded: boolean) =>
    async ({ ack, body, client, logger, action }: any) => {
      await ack();
      const b = body as BlockButtonAction;
      const signature = parseSignature((action as { value?: string }).value);
      const model = await assembleModel(signature);
      const issue = recallIncident(signature.signature)?.issue;
      const blocks = buildIncidentCard(model, { expanded, issue });

      if (b.channel?.id && b.message?.ts) {
        await client.chat.update({
          channel: b.channel.id,
          ts: b.message.ts,
          text: `Rewynd triage: ${model.synthesis.triageSummary}`,
          blocks,
        });
      }
      logger.info(`[action] toggled details expanded=${expanded}`);
    };

  app.action(ACTION_SHOW_DETAILS, toggle(true));
  app.action(ACTION_HIDE_DETAILS, toggle(false));

  // (d) Confirm button — REAL, human-in-the-loop write. Nothing writes before
  // this click. Opens a GitHub follow-up issue via MCP AND annotates the thread.
  app.action(ACTION_OPEN_ISSUE, async ({ ack, body, client, logger, action }: any) => {
    await ack();
    const b = body as BlockButtonAction;
    const channel = b.channel?.id;
    const clicker = b.user?.id;
    const cardTs = b.message?.ts;
    const incidentTs = (b.message as any)?.thread_ts ?? b.message?.ts;
    if (!channel) return;

    const signature = parseSignature((action as { value?: string }).value);
    const model = await assembleModel(signature); // cached — no re-calls
    const { prior, code, synthesis } = model;
    const loc = `${code.file}:${code.line}`;

    // Deep link to the current occurrence (the stack-trace message).
    let currentUrl = '';
    try {
      const pl: any = await client.chat.getPermalink({ channel, message_ts: incidentTs });
      currentUrl = pl?.permalink ?? '';
    } catch {
      /* non-fatal */
    }

    const title = issueTitle(signature.signature, loc);
    const bodyMd = issueBody({ signature: signature.signature, loc, verdict: code.verdict, prior, recommendation: synthesis.recommendation, currentUrl });

    // If GitHub isn't wired up, degrade honestly: hand the user a ready-to-paste
    // draft rather than pretending we wrote anything.
    if (!isGithubConfigured()) {
      console.log('[MCP] open-issue requested but GitHub not configured → returning draft only');
      if (clicker) {
        await client.chat.postEphemeral({
          channel,
          user: clicker,
          thread_ts: incidentTs,
          text:
            `:warning: GitHub isn't configured (set \`GITHUB_REPO\` + \`GITHUB_TOKEN\`), so I didn't write anything.\n` +
            `Here's the ready-to-file issue:\n\n*${title}*\n\n${bodyMd}`,
        });
      }
      return;
    }

    try {
      console.log(`[MCP] Creating follow-up issue in ${process.env.GITHUB_REPO ?? 'repo'} …`);
      const issue: CreatedIssue = await createFollowUpIssue({ title, body: bodyMd });
      console.log(`[MCP] GitHub → follow-up issue created: #${issue.number} ${issue.url}`);

      // Remember it so re-renders keep the "created" state.
      mergeIncident(signature.signature, { issue });

      // Annotate the incident thread — this is the re-capture (spec §1.2 "close the loop").
      await client.chat.postMessage({
        channel,
        thread_ts: incidentTs,
        text:
          `:memo: *Rewynd re-captured this incident.* Follow-up issue <${issue.url}|#${issue.number}> opened` +
          `${clicker ? ` by <@${clicker}>` : ''}.\n> ${synthesis.triageSummary}` +
          `${prior ? `\n_Prior fix: <${prior.threadUrl}|resolved by @${prior.resolver}>_` : ''}`,
      });

      // Update the card: swap the confirm button for the issue link.
      if (cardTs) {
        const expanded = messageIsExpanded(b.message);
        await client.chat.update({
          channel,
          ts: cardTs,
          text: `Rewynd triage: ${synthesis.triageSummary}`,
          blocks: buildIncidentCard(model, { expanded, issue }),
        });
      }

      // Confirm privately to the clicker too.
      if (clicker) {
        await client.chat.postEphemeral({
          channel,
          user: clicker,
          thread_ts: incidentTs,
          text: `:white_check_mark: Opened follow-up issue <${issue.url}|#${issue.number}> and annotated the thread.`,
        });
      }
    } catch (err) {
      const msg = (err as Error).message;
      console.log(`[MCP] ERROR creating issue — ${msg}`);
      if (clicker) {
        await client.chat.postEphemeral({
          channel,
          user: clicker,
          thread_ts: incidentTs,
          text:
            `:x: Couldn't create the issue automatically (${msg}). Nothing was written.\n` +
            `Here's the draft to file manually:\n\n*${title}*\n\n${bodyMd}`,
        });
      }
    }
  });
}

function issueTitle(signature: string, loc: string): string {
  const base = `[Rewynd] ${signature}`;
  const withLoc = loc && !signature.includes(loc) ? `${base} @ ${loc}` : base;
  return withLoc.length > 120 ? withLoc.slice(0, 117) + '…' : withLoc;
}

function issueBody(args: {
  signature: string;
  loc: string;
  verdict: string;
  prior: { threadUrl: string; resolver: string; resolvedAt: string; fixSummary: string } | null;
  recommendation: string;
  currentUrl: string;
}): string {
  const { signature, loc, verdict, prior, recommendation, currentUrl } = args;
  const priorSection = prior
    ? `**Prior incident:** [resolved ${prior.resolvedAt.slice(0, 10)} by @${prior.resolver}](${prior.threadUrl})\n` +
      `> ${prior.fixSummary}`
    : `**Prior incident:** none on record — first sighting of this signature.`;
  return [
    `_Opened by Rewynd from an incident in Slack._`,
    ``,
    `**Signature:** \`${signature}\``,
    `**Grounded at:** \`${loc}\` · code verdict **${verdict}**`,
    currentUrl ? `**Current occurrence:** [Slack thread](${currentUrl})` : '',
    ``,
    priorSection,
    ``,
    `**Recommendation (current code):**`,
    recommendation,
    ``,
    `---`,
    `<sub>🤖 Filed via Rewynd · GitHub MCP write · human-confirmed.</sub>`,
  ]
    .filter((l) => l !== null && l !== undefined)
    .join('\n');
}

/** True if the card message currently shows the expanded detail (Hide button present). */
function messageIsExpanded(message: any): boolean {
  const blocks = message?.blocks ?? [];
  for (const block of blocks) {
    if (block?.type !== 'actions') continue;
    for (const el of block.elements ?? []) {
      if (el?.action_id === ACTION_HIDE_DETAILS) return true;
    }
  }
  return false;
}
