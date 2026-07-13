import { ErrorSignature } from '../services/types';

/**
 * Heuristics for deciding whether a Slack message looks like a stack trace / error,
 * and for distilling it into an ErrorSignature the services can match on.
 *
 * Intentionally simple and dependency-free — this is a triage gate, not a parser.
 * Real signature extraction can get smarter in a later layer without changing the
 * orchestrator contract.
 */

// Common exception / error tokens across ecosystems.
const EXCEPTION_KEYWORDS =
  /\b(error|exception|traceback|panic|fatal|uncaught|unhandled|segfault|stack ?trace|errno)\b/i;

// Typed-exception names like TypeError, NullPointerException, KeyError, IOException.
const EXCEPTION_TYPE = /\b([A-Z][a-zA-Z0-9]*(?:Error|Exception))\b/;

// Errno-style codes like ETIMEDOUT, ECONNRESET, ENOTFOUND, EACCES.
// (Negative lookahead keeps a shouty "ERROR"/"EXCEPTION" from matching.)
const ERRNO_CODE = /\b(E(?!RROR\b|XCEPTION\b)[A-Z]{2,15})\b/;

// file:line references: "src/auth/session.ts:42", "app.py, line 88", "at foo (x.js:12:5)".
const FILE_LINE =
  /([\w./\\-]+\.(?:ts|tsx|js|jsx|py|rb|go|java|kt|rs|c|cc|cpp|cs|php|scala|swift)):(\d+)/i;
const PY_FILE_LINE = /File "([^"]+)", line (\d+)/;

// Stack-frame markers: "at ...", "  at ...", python "  File ...".
const FRAME_LINE = /^\s*(at\s+.+|File "?.+"?,?\s*line\s+\d+|\w+\.\w+\(.*\))/;

export interface StackTraceMatch {
  isStackTrace: boolean;
  /** Which signals fired — useful for logging/debug. */
  signals: string[];
}

/** Decide whether `text` looks like a stack trace / error worth triaging. */
export function looksLikeStackTrace(text: string): StackTraceMatch {
  const signals: string[] = [];
  if (!text || text.trim().length === 0) {
    return { isStackTrace: false, signals };
  }

  if (EXCEPTION_KEYWORDS.test(text)) signals.push('exception-keyword');
  if (EXCEPTION_TYPE.test(text)) signals.push('exception-type');
  if (FILE_LINE.test(text) || PY_FILE_LINE.test(text)) signals.push('file:line');

  const lines = text.split(/\r?\n/);
  const frameLines = lines.filter((l) => FRAME_LINE.test(l)).length;
  if (frameLines >= 1) signals.push('stack-frame');
  if (lines.length >= 3 && frameLines >= 1) signals.push('multiline-trace');

  // Fire if we have a typed exception, OR a keyword paired with a code location,
  // OR a multi-line trace with stack frames. This keeps ordinary chatter out.
  const isStackTrace =
    signals.includes('exception-type') ||
    (signals.includes('exception-keyword') &&
      (signals.includes('file:line') || signals.includes('stack-frame'))) ||
    signals.includes('multiline-trace');

  return { isStackTrace, signals };
}

/** Distill raw error text into an ErrorSignature for the services to match on. */
export function extractSignature(raw: string): ErrorSignature {
  // Prefer a typed exception (TypeError); fall back to an errno code (ETIMEDOUT).
  const typeMatch = raw.match(EXCEPTION_TYPE);
  const errnoMatch = raw.match(ERRNO_CODE);
  const errorType = typeMatch?.[1] ?? errnoMatch?.[1];

  let topFile: string | undefined;
  let topLine: number | undefined;

  const py = raw.match(PY_FILE_LINE);
  const generic = raw.match(FILE_LINE);
  if (py) {
    topFile = normalizePath(py[1]);
    topLine = Number(py[2]);
  } else if (generic) {
    topFile = normalizePath(generic[1]);
    topLine = Number(generic[2]);
  }

  // Build a normalized single-line signature: "<Type> @ <file>:<line>" when possible,
  // otherwise the first non-empty line of the message.
  const firstLine =
    raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? raw.trim();

  const parts: string[] = [];
  if (errorType) parts.push(errorType);
  if (topFile) parts.push(`@ ${topFile}${topLine ? ':' + topLine : ''}`);
  const signature = parts.length > 0 ? parts.join(' ') : firstLine.slice(0, 160);

  return { signature, errorType, topFile, topLine, raw };
}

/** Normalize Windows-style backslashes and strip a leading ./ for stable matching. */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}
