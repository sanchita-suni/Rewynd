import {
  CodeGrounding,
  PriorIncident,
  Synthesis,
  SynthesisService,
} from './types';

const MAX_SUMMARY_WORDS = 40;

/** Trim a summary to at most MAX_SUMMARY_WORDS words (defensive; mocks stay under). */
function clampWords(text: string, max = MAX_SUMMARY_WORDS): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= max) return text.trim();
  return words.slice(0, max).join(' ') + '…';
}

/**
 * MOCK SynthesisService.
 *
 * Real impl (later layer): Slack AI. Prompt it with the prior incident + code
 * grounding and ask for an actionable recommendation plus a <=40-word triage
 * summary suitable for TTS.
 *
 * For now it composes a realistic recommendation deterministically from the
 * inputs so the demo reflects the actual memory/code branch taken.
 */
export class MockSynthesisService implements SynthesisService {
  async recommend(
    prior: PriorIncident | null,
    code: CodeGrounding,
  ): Promise<Synthesis> {
    const loc = `${code.file}:${code.line}`;

    if (prior && code.verdict === 'DRIFTED') {
      return {
        recommendation:
          `We fixed this exact class of error on ${prior.resolvedAt.slice(0, 10)} ` +
          `(${prior.fixSummary}), but the code at ${loc} has since DRIFTED — the ` +
          `null-guard from that fix was removed. Re-apply the guard and restore the ` +
          `regression test before shipping.`,
        triageSummary: clampWords(
          `Seen before and fixed by ${prior.resolver}, but ${loc} drifted since — ` +
            `the null guard was removed. Re-apply it and restore the regression test.`,
        ),
      };
    }

    if (prior && code.verdict === 'MATCH') {
      return {
        recommendation:
          `This matches a resolved incident (${prior.fixSummary}). The code at ${loc} ` +
          `is unchanged since that fix, so the same remediation should apply directly.`,
        triageSummary: clampWords(
          `Known incident, previously fixed by ${prior.resolver}. Code at ${loc} is ` +
            `unchanged, so the prior fix applies directly.`,
        ),
      };
    }

    // No prior incident on record.
    return {
      recommendation:
        `No prior incident on record for this signature. Grounding points at ${loc} ` +
        `(${code.verdict}). Triage from first principles and capture the resolution so ` +
        `EchoOps can recall it next time.`,
      triageSummary: clampWords(
        `First time seeing this. It grounds to ${loc}. Triage fresh and record the fix ` +
          `so it's remembered next time.`,
      ),
    };
  }
}

export const synthesisService: SynthesisService = new MockSynthesisService();
