import type { WebClient } from '@slack/web-api';
import type { Logger } from '@slack/logger';
import { memoryService } from '../services/memory';
import { codeService } from '../services/code';
import { synthesisService } from '../services/synthesis';
import { voiceService } from '../services/voice';
import { ErrorSignature } from '../services/types';
import { extractSignature } from '../util/stackTrace';
import { buildIncidentCard, IncidentCardModel } from '../blocks/incidentCard';

/**
 * The orchestrator is the only place the four intelligence layers are chained.
 * It talks exclusively to the service interfaces, so replacing any mock with a
 * real integration (RTS, GitHub MCP, Slack AI, Murf) never touches this control
 * flow or the Block Kit rendering.
 *
 *   memory -> code -> synthesis -> voice -> card
 */
export async function assembleModel(
  errorSignature: ErrorSignature,
): Promise<IncidentCardModel> {
  // 1. Memory: have we seen this before? (RTS later)
  const prior = await memoryService.findPriorIncident(errorSignature);

  // 2. Code: ground it against live source and check for drift. (GitHub MCP later)
  const code = await codeService.groundError(errorSignature);

  // 3. Synthesis: combine memory + code into a recommendation + triage summary. (Slack AI later)
  const synthesis = await synthesisService.recommend(prior, code);

  // 4. Voice: render the triage summary to audio. (Murf later)
  const voice = await voiceService.renderTriage(synthesis.triageSummary);

  return { errorSignature, prior, code, synthesis, voice };
}

export interface RunIncidentArgs {
  client: WebClient;
  channel: string;
  /** ts of the message that triggered the incident — the card is a threaded reply. */
  threadTs: string;
  text: string;
  logger: Logger;
}

/** Full path: extract signature, run the chain, and post the card as a threaded reply. */
export async function runIncident(args: RunIncidentArgs): Promise<void> {
  const { client, channel, threadTs, text, logger } = args;

  const signature = extractSignature(text);
  logger.info(
    `[orchestrator] incident signature="${signature.signature}" ` +
      `type=${signature.errorType ?? 'n/a'} loc=${signature.topFile ?? 'n/a'}:${
        signature.topLine ?? 'n/a'
      }`,
  );

  const model = await assembleModel(signature);
  const blocks = buildIncidentCard(model, { expanded: false });

  await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: `EchoOps triage: ${model.synthesis.triageSummary}`, // notification fallback
    blocks,
  });

  logger.info(
    `[orchestrator] posted card verdict=${model.code.verdict} prior=${
      model.prior ? 'yes' : 'no'
    }`,
  );
}
