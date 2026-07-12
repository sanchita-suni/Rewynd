/**
 * Offline self-test for Layer 3's pure logic — no LLM/Murf/Slack credentials.
 * Verifies: the spoken-summary sanitizer (no file:line ever reaches the audio),
 * the deterministic synthesizer's branches, and the LLM JSON extractor.
 *
 *   npm run check:layer3
 */
process.env.SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || 'xoxb-test';
process.env.SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN || 'xapp-test';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (!cond) failures++;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

/** No file paths / line numbers may survive into a spoken summary. */
function hasNoCodeLocations(s: string): boolean {
  return !/\b[\w./-]+\.[a-z]{1,5}(:\d+)?\b/i.test(s) && !/:\s*\d+/.test(s);
}

async function main(): Promise<void> {
  const { spokenize, extractJson, DeterministicSynthesisService } = await import(
    '../src/services/synthesis'
  );

  console.log('spokenize (audio must carry no line numbers)');
  const dirty = 'Re-apply the guard at `src/checkout/payments.ts:42` per https://x.io/pr/1 now.';
  const clean = spokenize(dirty);
  check('strips file:line + path', hasNoCodeLocations(clean), clean);
  check('strips url', !/https?:\/\//.test(clean), clean);
  check('strips backticked code', !clean.includes('`'), clean);

  console.log('deterministic synthesis (DRIFTED, prior)');
  const svc = new DeterministicSynthesisService();
  const drift = await svc.recommend(
    { threadUrl: 'https://s/t', resolver: 'trish', resolvedAt: '2026-03-15T00:00:00Z', fixSummary: 'added retry' },
    { file: 'src/checkout/payments.ts', line: 42, currentSnippet: 'x', diffVsFixEra: 'y', verdict: 'DRIFTED' },
  );
  check('recommendation non-empty', drift.recommendation.length > 20);
  check('recommendation adapts old fix (mentions drift/adapt)', /drift|adapt|re-derive|changed/i.test(drift.recommendation));
  check('summary ≤ 40 words', drift.triageSummary.split(/\s+/).length <= 40, `${drift.triageSummary.split(/\s+/).length} words`);
  check('summary has NO file:line', hasNoCodeLocations(drift.triageSummary), drift.triageSummary);

  console.log('deterministic synthesis (MATCH, prior)');
  const match = await svc.recommend(
    { threadUrl: 'https://s/t', resolver: 'trish', resolvedAt: '2026-03-15T00:00:00Z', fixSummary: 'added retry' },
    { file: 'src/checkout/payments.ts', line: 42, currentSnippet: 'x', diffVsFixEra: 'y', verdict: 'MATCH' },
  );
  check('MATCH summary has NO file:line', hasNoCodeLocations(match.triageSummary), match.triageSummary);
  check('MATCH summary ≤ 40 words', match.triageSummary.split(/\s+/).length <= 40);

  console.log('deterministic synthesis (no prior)');
  const none = await svc.recommend(null, {
    file: 'src/x.ts', line: 9, currentSnippet: 'x', diffVsFixEra: 'y', verdict: 'MATCH',
  });
  check('no-prior recommendation mentions capturing the fix', /capture|record|first/i.test(none.recommendation));
  check('no-prior summary has NO file:line', hasNoCodeLocations(none.triageSummary), none.triageSummary);

  console.log('LLM JSON extraction');
  check('parses fenced json', extractJson('```json\n{"recommendation":"a","triageSummary":"b"}\n```')?.triageSummary === 'b');
  check('parses prose-wrapped json', extractJson('Sure!\n{"recommendation":"a","triageSummary":"b"} done')?.recommendation === 'a');
  check('returns undefined on garbage', extractJson('no json here') === undefined);

  console.log('');
  if (failures === 0) console.log('✅ Layer 3 offline self-test: ALL CHECKS PASSED');
  else {
    console.log(`❌ Layer 3 offline self-test: ${failures} check(s) FAILED`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('checkLayer3 error:', e);
  process.exitCode = 1;
});
