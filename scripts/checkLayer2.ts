/**
 * Offline self-test for Layer 2's pure logic — no Slack/MCP credentials needed.
 * Verifies the parts that can be checked without live services: the RTS query
 * builder + result parser, fix-era/resolver extraction, and the diff/verdict.
 *
 *   npm run check:layer2
 *
 * The network paths (real RTS call, real MCP tools) require a live sandbox and
 * are exercised end-to-end via `npm run dev` + `npm run seed`.
 */
import { ErrorSignature } from '../src/services/types';
import {
  buildKeywordQuery,
  buildQuestionQuery,
  extractFixEra,
  parseRtsMessages,
  pickResolver,
} from '../src/services/rts';
import { computeDrift, extractSnippet } from '../src/services/diff';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  const status = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`  [${status}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const sig: ErrorSignature = {
  signature: 'ETIMEDOUT @ src/checkout/payments.ts:42',
  errorType: undefined,
  topFile: 'src/checkout/payments.ts',
  topLine: 42,
  raw: 'Error: connect ETIMEDOUT 10.0.3.14:443\n    at PaymentGateway.charge (src/checkout/payments.ts:42:15)',
};

console.log('RTS query builder');
const q = buildQuestionQuery(sig);
check('question starts with How/What/Where', /^(how|what|where)\b/i.test(q), q);
check('question ends with "?"', q.trim().endsWith('?'), q);
check('question mentions module "payments"', /payments/.test(q), q);
const kq = buildKeywordQuery(sig);
check('keyword query is non-empty & references payments/ETIMEDOUT', /payments|ETIMEDOUT/i.test(kq), kq);

console.log('RTS result parser');
const rawResp = {
  messages: [
    {
      text: 'Resolved by @trish in https://github.com/acme/checkout/pull/482 — added backoff retry',
      ts: '1710500400.000200',
      channel_id: 'C0INCID3NT',
      user: 'U0TRISH',
      permalink: 'https://acme.slack.com/archives/C0INCID3NT/p1710500400000200',
      score: 0.91,
    },
    { text: 'thanks!', ts: '1710500500.000000', score: 0.1 },
  ],
};
const parsed = parseRtsMessages(rawResp);
check('parses 2 messages', parsed.length === 2, `got ${parsed.length}`);
check('extracts permalink', !!parsed[0].permalink, parsed[0].permalink);
check('extracts score', parsed[0].score === 0.91, String(parsed[0].score));

console.log('Fix-era + resolver extraction');
const fixEra = extractFixEra(rawResp.messages[0].text, '2026-03-15T14:20:00Z');
check('extracts PR number 482', fixEra.prNumber === 482, String(fixEra.prNumber));
check('carries resolvedAt', fixEra.resolvedAt === '2026-03-15T14:20:00Z');
check('picks resolver "trish"', pickResolver(rawResp.messages[0].text) === 'trish', pickResolver(rawResp.messages[0].text) ?? '');
check('picks resolver from <@id> mention', pickResolver('fixed by <@U0TRISH>') === 'U0TRISH');

console.log('Diff / verdict (MATCH)');
const fixEraCode = [
  'async charge(order) {',
  '  // retry with backoff',
  '  return await withRetry(() => this.gateway.charge(order), { attempts: 3 });',
  '}',
].join('\n');
const currentSame = fixEraCode;
const matchRes = computeDrift(currentSame, fixEraCode, 3, 'payments.ts');
check('unchanged region → MATCH', matchRes.verdict === 'MATCH', matchRes.verdict);
check('MATCH diff notes "no material change"', /no material change/.test(matchRes.diffText));

console.log('Diff / verdict (DRIFTED)');
const currentChanged = [
  'async charge(order) {',
  '  // retry removed in refactor',
  '  return await this.gateway.charge(order);',
  '}',
].join('\n');
const driftRes = computeDrift(currentChanged, fixEraCode, 3, 'payments.ts');
check('changed region → DRIFTED', driftRes.verdict === 'DRIFTED', driftRes.verdict);
check('DRIFTED diff shows -/+ lines', /^- /m.test(driftRes.diffText) && /^\+ /m.test(driftRes.diffText));

console.log('Snippet extraction');
const snippet = extractSnippet(fixEraCode, 3);
check('marks implicated line with ">"', /^>\s*3 \|/m.test(snippet), snippet.split('\n').find((l) => l.startsWith('>')) ?? '');

console.log('');
if (failures === 0) {
  console.log('✅ Layer 2 offline self-test: ALL CHECKS PASSED');
} else {
  console.log(`❌ Layer 2 offline self-test: ${failures} check(s) FAILED`);
  process.exitCode = 1;
}
