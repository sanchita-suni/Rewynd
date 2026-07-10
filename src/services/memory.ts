import { ErrorSignature, MemoryService, PriorIncident } from './types';

/**
 * MOCK MemoryService.
 *
 * Real impl (later layer): Slack AI Search / Real-Time Search over the workspace
 * to semantically find the thread where this class of incident was last resolved.
 *
 * For now it returns a realistic hardcoded prior incident so the full card can be
 * demoed end-to-end. It returns null for signatures that clearly don't look like a
 * "known" error, so the "first time we've seen this" branch is also demoable.
 */
export class MockMemoryService implements MemoryService {
  async findPriorIncident(
    errorSignature: ErrorSignature,
  ): Promise<PriorIncident | null> {
    // Simulate a "never seen this" outcome for anything explicitly marked novel.
    if (/novel|unknown-signature/i.test(errorSignature.raw)) {
      return null;
    }

    return {
      threadUrl:
        'https://echoops-sandbox.slack.com/archives/C0INCID3NT/p1717426800000000',
      resolver: 'Priya Nair',
      resolvedAt: '2026-06-03T14:20:00Z',
      fixSummary:
        'Guarded the null `session` before `.user.id`; added a regression test in auth.test.ts.',
    };
  }
}

export const memoryService: MemoryService = new MockMemoryService();
