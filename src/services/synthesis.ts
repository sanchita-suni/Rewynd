import {
  CodeGrounding,
  PriorIncident,
  Synthesis,
  SynthesisService,
} from './types';
import { config } from '../config';
import { LlmClient } from './llm';

const MAX_SUMMARY_WORDS = 40;

/** Trim a summary to at most MAX_SUMMARY_WORDS words. */
function clampWords(text: string, max = MAX_SUMMARY_WORDS): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return words.join(' ');
  return words.slice(0, max).join(' ') + '…';
}

/**
 * Make a string safe to SPEAK: strip file paths, `file:line`, bare `:line`,
 * backticked code, and URLs — the audio must never carry a line number
 * (spec §2.2). Applied to every triage summary, LLM or deterministic.
 */
export function spokenize(text: string): string {
  return text
    .replace(/`[^`]*`/g, '')                          // backticked code
    .replace(/\bhttps?:\/\/\S+/gi, '')                // urls
    .replace(/\b[\w./-]+\.[a-z]{1,5}:\d+(?::\d+)?/gi, '') // path/file.ext:line[:col]
    .replace(/\b[\w-]+\.[a-z]{1,5}\b/gi, '')          // bare file.ext
    .replace(/\s+:\s*\d+\b/g, '')                     // stray ":42"
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,!?])/g, '$1')
    .trim();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthYear(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * DETERMINISTIC SynthesisService — no LLM. Composes a current-code-specific
 * recommendation (which may cite file:line) plus a SPOKEN triage summary that
 * carries no line numbers. Used when no LLM is configured and as the fallback.
 */
export class DeterministicSynthesisService implements SynthesisService {
  async recommend(prior: PriorIncident | null, code: CodeGrounding): Promise<Synthesis> {
    const loc = `${code.file}:${code.line}`;
    const when = prior ? monthYear(prior.resolvedAt) : '';

    if (prior && code.verdict === 'DRIFTED') {
      return {
        recommendation:
          `Your team hit this class of error before (${when}: ${prior.fixSummary}). ` +
          `But the code at \`${loc}\` has since DRIFTED, so that fix does not transfer as-is — ` +
          `re-derive it against the current code shown in the diff, re-apply the missing guard, ` +
          `and restore the regression test before shipping.`,
        triageSummary: clampWords(spokenize(
          `Heads up — your team hit this before and ${prior.resolver} fixed it in ${when}, ` +
          `but the code has changed since, so that fix needs adapting before you apply it. ` +
          `See the drifted section in the card.`,
        )),
      };
    }

    if (prior && code.verdict === 'MATCH') {
      return {
        recommendation:
          `This matches a resolved incident (${when}: ${prior.fixSummary}). The code at \`${loc}\` ` +
          `is unchanged since that fix, so the same remediation applies directly — follow the prior ` +
          `thread's patch and confirm the regression test still guards it.`,
        triageSummary: clampWords(spokenize(
          `Good news — your team already solved this. ${prior.resolver} fixed it in ${when} and the ` +
          `relevant code is unchanged, so the same fix should apply directly. The original thread and ` +
          `patch are in the card.`,
        )),
      };
    }

    return {
      recommendation:
        `No prior incident on record for this signature. Current grounding points at \`${loc}\` ` +
        `(${code.verdict}). Triage from first principles, then capture the resolution in this thread ` +
        `so Rewynd can recall it next time.`,
      triageSummary: clampWords(spokenize(
        `This looks new — no past incident on record. Triage it fresh, and once you resolve it, ` +
        `capture the fix in the thread so Rewynd remembers it next time.`,
      )),
    };
  }
}

/**
 * REAL SynthesisService — reconciles [prior fix] + [current diff/verdict] via an
 * OpenAI-compatible LLM (Groq / OpenRouter / Ollama). Produces ONE triage
 * summary (≤40 words, spoken — no line numbers) that feeds BOTH the card detail
 * and the audio, plus a current-code-specific recommendation. Falls back to the
 * deterministic synthesizer on any error so the pipeline never stalls.
 */
export class LlmSynthesisService implements SynthesisService {
  private readonly llm: LlmClient;
  private readonly fallback: SynthesisService;

  constructor(fallback: SynthesisService) {
    this.llm = new LlmClient({
      baseUrl: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
      model: config.llm.model,
    });
    this.fallback = fallback;
  }

  async recommend(prior: PriorIncident | null, code: CodeGrounding): Promise<Synthesis> {
    console.log('[LLM] Synthesizing current-code recommendation…');
    try {
      const raw = await this.llm.complete(SYSTEM_PROMPT, buildUserPrompt(prior, code));
      const parsed = extractJson(raw);
      const recommendation = String(parsed?.recommendation ?? '').trim();
      let triageSummary = String(parsed?.triageSummary ?? '').trim();

      if (!recommendation || !triageSummary) {
        throw new Error('LLM response missing recommendation/triageSummary');
      }
      // Enforce the spoken-summary contract regardless of what the model returned.
      triageSummary = clampWords(spokenize(triageSummary));

      // If the model was too terse for a ~15s clip, use the fuller deterministic
      // summary instead (keeps the LLM's recommendation).
      const words = triageSummary.split(/\s+/).filter(Boolean).length;
      if (words < 28) {
        console.log(`[LLM] summary too short (${words}w) → using deterministic summary for audio`);
        triageSummary = (await this.fallback.recommend(prior, code)).triageSummary;
      }

      console.log(`[LLM] Triage summary ready (${triageSummary.split(/\s+/).filter(Boolean).length} words)`);
      return { recommendation, triageSummary };
    } catch (err) {
      console.log(`[LLM] ERROR — ${(err as Error).message} → deterministic synthesis`);
      return this.fallback.recommend(prior, code);
    }
  }
}

const SYSTEM_PROMPT =
  'You are Rewynd, an incident-triage synthesizer. You reconcile how a team ' +
  'previously fixed an error with how the current code looks now, and produce a ' +
  'concrete recommendation for THIS code plus one spoken triage summary. ' +
  'Rules: If the code has DRIFTED from the fix era, say the old fix needs adaptation ' +
  'and why. ' +
  'The triageSummary is read ALOUD as a ~15-second clip, so it must be 30–40 words ' +
  '(never fewer than 30) of natural spoken English that a tired on-call engineer can ' +
  'act on. It must briefly say: (1) what the error is in plain terms, (2) that the ' +
  'team has hit it before and roughly when/who resolved it, (3) whether the current ' +
  'code still matches that fix, and (4) what to do now. It must contain NO file paths, ' +
  'NO line numbers, and NO code. ' +
  'Reply with ONLY a JSON object: {"recommendation": string, "triageSummary": string}.';

function buildUserPrompt(prior: PriorIncident | null, code: CodeGrounding): string {
  const priorBlock = prior
    ? `PRIOR FIX (from workspace memory):\n- resolved: ${prior.resolvedAt}\n- by: @${prior.resolver}\n- summary: ${prior.fixSummary}\n- thread: ${prior.threadUrl}`
    : 'PRIOR FIX: none on record — this signature has not been seen before.';
  return [
    priorBlock,
    '',
    `CURRENT CODE GROUNDING (from GitHub):\n- location: ${code.file}:${code.line}\n- drift verdict: ${code.verdict}`,
    '',
    'CURRENT SNIPPET:',
    code.currentSnippet,
    '',
    'DIFF VS FIX ERA:',
    code.diffVsFixEra,
    '',
    'Produce the JSON now. Remember: triageSummary must be 30–40 spoken words (~15 seconds) ' +
      'that explain the error, the prior fix, whether it still applies, and the next step.',
  ].join('\n');
}

/** Pull the first JSON object out of an LLM reply (handles code fences/prose). */
export function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return undefined;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

// Selection: LLM synthesis when configured & not forced to mocks; else deterministic.
export const synthesisService: SynthesisService =
  !config.useMocks && LlmClient.isConfigured(config.llm.baseUrl, config.llm.model)
    ? new LlmSynthesisService(new DeterministicSynthesisService())
    : new DeterministicSynthesisService();

// Back-compat alias (older imports referenced MockSynthesisService).
export const MockSynthesisService = DeterministicSynthesisService;
