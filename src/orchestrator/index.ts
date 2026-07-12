import type { WebClient } from '@slack/web-api';
import type { Logger } from '@slack/logger';
import { memoryService } from '../services/memory';
import { codeService } from '../services/code';
import { synthesisService } from '../services/synthesis';
import { voiceService } from '../services/voice';
import { ErrorSignature } from '../services/types';
import { extractSignature } from '../util/stackTrace';
import { buildIncidentCard, IncidentCardModel } from '../blocks/incidentCard';
import { mergeIncident, recallIncident } from './incidentContext';

/**
 * The orchestrator is the only place the four intelligence layers are chained:
 *
 *   memory (RTS) → code (GitHub MCP) → synthesis (LLM) → voice (Murf) → card
 *
 * The full assembled model is cached per incident, so re-renders (show/hide
 * details) and the confirm-write reuse the same synthesis + audio without
 * re-calling the LLM or TTS.
 */
export async function assembleModel(
  errorSignature: ErrorSignature,
  opts?: { actionToken?: string },
): Promise<IncidentCardModel> {
  // Reuse a fully-assembled model from the session cache when present.
  const cached = recallIncident(errorSignature.signature);
  if (cached?.errorSignature && cached.code && cached.synthesis && cached.voice) {
    return {
      errorSignature: cached.errorSignature,
      prior: cached.prior,
      code: cached.code,
      synthesis: cached.synthesis,
      voice: cached.voice,
    };
  }

  const prior = await memoryService.findPriorIncident(errorSignature, {
    actionToken: opts?.actionToken,
  }); // RTS
  const code = await codeService.groundError(errorSignature);            // GitHub MCP
  const synthesis = await synthesisService.recommend(prior, code);       // LLM
  const voice = await voiceService.renderTriage(synthesis.triageSummary); // Murf

  mergeIncident(errorSignature.signature, {
    prior,
    errorSignature,
    code,
    synthesis,
    voice,
  });

  return { errorSignature, prior, code, synthesis, voice };
}

export interface RunIncidentArgs {
  client: WebClient;
  channel: string;
  /** ts of the message that triggered the incident — the card is a threaded reply. */
  threadTs: string;
  text: string;
  logger: Logger;
  /** Slack action_token from the triggering event, for the RTS call. */
  actionToken?: string;
}

/** Full path: extract signature, run the chain, post the card + native audio player. */
export async function runIncident(args: RunIncidentArgs): Promise<void> {
  const { client, channel, threadTs, text, logger, actionToken } = args;

  const signature = extractSignature(text);
  logger.info(
    `[orchestrator] incident signature="${signature.signature}" ` +
      `type=${signature.errorType ?? 'n/a'} loc=${signature.topFile ?? 'n/a'}:${
        signature.topLine ?? 'n/a'
      }`,
  );

  const model = await assembleModel(signature, { actionToken });
  const blocks = buildIncidentCard(model, { expanded: false });

  await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: `Rewynd triage: ${model.synthesis.triageSummary}`, // notification fallback
    blocks,
  });

  // Upload the ~15s clip as a native Slack audio player in the thread (spec §2.2).
  await uploadAudio({ client, channel, threadTs, model, logger });

  logger.info(
    `[orchestrator] posted card verdict=${model.code.verdict} prior=${
      model.prior ? 'yes' : 'no'
    }`,
  );
}

/** Attach the triage audio as a playable file; degrade silently to text-only. */
async function uploadAudio(args: {
  client: WebClient;
  channel: string;
  threadTs: string;
  model: IncidentCardModel;
  logger: Logger;
}): Promise<void> {
  const { client, channel, threadTs, model, logger } = args;
  const { voice } = model;
  if (!voice.audioData || voice.isMock) return; // nothing real to upload
  try {
    await client.files.uploadV2({
      channel_id: channel,
      thread_ts: threadTs,
      file: voice.audioData,
      filename: 'rewynd-triage.mp3',
      title: '🔊 Rewynd ~15s voice triage',
    });
    logger.info('[orchestrator] uploaded native audio player to thread');
  } catch (err) {
    logger.warn(`[orchestrator] audio upload failed (card still renders): ${(err as Error).message}`);
  }
}
