import { CodeGrounding, CodeService, ErrorSignature } from './types';

/**
 * MOCK CodeService.
 *
 * Real impl (later layer): GitHub MCP. Resolve the top stack frame to a real
 * file/line, pull the current source, and diff it against the code as it was at
 * the time of the prior known fix to decide MATCH vs DRIFTED.
 *
 * For now it returns realistic hardcoded grounding. If the signature carries a
 * detected file/line we echo those so the card feels connected to the input.
 */
export class MockCodeService implements CodeService {
  async groundError(errorSignature: ErrorSignature): Promise<CodeGrounding> {
    const file = errorSignature.topFile ?? 'src/auth/session.ts';
    const line = errorSignature.topLine ?? 42;

    return {
      file,
      line,
      currentSnippet: [
        `  40 | export function currentUserId(session: Session): string {`,
        `  41 |   // NOTE: refactored 2026-06-20 to accept a nullable session`,
        `> 42 |   return session.user.id;`,
        `  43 | }`,
      ].join('\n'),
      diffVsFixEra: [
        '--- a/' + file + ' (fix era: 2026-06-03)',
        '+++ b/' + file + ' (current)',
        '@@',
        '-  return session?.user?.id ?? throwUnauthenticated();',
        '+  return session.user.id;',
      ].join('\n'),
      // The prior fix added null-guarding that the current code no longer has.
      verdict: 'DRIFTED',
    };
  }
}

export const codeService: CodeService = new MockCodeService();
