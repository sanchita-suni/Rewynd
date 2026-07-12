import { CodeVerdict } from './types';

/**
 * Pure code-grounding helpers for CodeService (spec §1.2). No I/O, so they are
 * unit-tested offline. The MCP fetch lives in RealCodeService.
 */

const DEFAULT_RADIUS = 3;

/** Split file content into lines without a trailing empty element. */
function toLines(content: string): string[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Render a code snippet around `line` (1-indexed) with line numbers and a `>`
 * marker on the implicated line — the format shown in the card detail.
 */
export function extractSnippet(content: string, line: number, radius = DEFAULT_RADIUS): string {
  const lines = toLines(content);
  const start = Math.max(1, line - radius);
  const end = Math.min(lines.length, line + radius);
  const width = String(end).length;
  const out: string[] = [];
  for (let n = start; n <= end; n++) {
    const marker = n === line ? '>' : ' ';
    out.push(`${marker} ${String(n).padStart(width)} | ${lines[n - 1] ?? ''}`);
  }
  return out.join('\n');
}

/** The trimmed window of lines around `line`, used for equality comparison. */
function window(content: string, line: number, radius: number): string[] {
  const lines = toLines(content);
  const start = Math.max(1, line - radius);
  const end = Math.min(lines.length, line + radius);
  const out: string[] = [];
  for (let n = start; n <= end; n++) out.push((lines[n - 1] ?? '').trim());
  return out;
}

export interface DriftResult {
  verdict: CodeVerdict;
  diffText: string;
}

/**
 * Decide MATCH vs DRIFTED by comparing the region around the implicated line in
 * the current code against the same region at the fix era. MATCH only when the
 * region is unchanged in place; any change (or shift) reads as DRIFTED — this is
 * the killer signal (spec §1.2): *does the old fix still apply to today's code?*
 */
export function computeDrift(
  currentContent: string,
  fixEraContent: string,
  line: number,
  filePathForHeader = 'file',
  radius = DEFAULT_RADIUS,
): DriftResult {
  const cur = window(currentContent, line, radius);
  const old = window(fixEraContent, line, radius);
  const unchanged = cur.length === old.length && cur.every((l, i) => l === old[i]);

  if (unchanged) {
    return {
      verdict: 'MATCH',
      diffText: [
        `--- a/${filePathForHeader} (fix era)`,
        `+++ b/${filePathForHeader} (current)`,
        `@@ around line ${line} — no material change; the fixed region is intact @@`,
        ...cur.map((l) => `  ${l}`),
      ].join('\n'),
    };
  }

  return {
    verdict: 'DRIFTED',
    diffText: [
      `--- a/${filePathForHeader} (fix era)`,
      `+++ b/${filePathForHeader} (current)`,
      `@@ around line ${line} — region changed since the fix; old patch may not apply @@`,
      ...old.map((l) => `- ${l}`),
      ...cur.map((l) => `+ ${l}`),
    ].join('\n'),
  };
}
