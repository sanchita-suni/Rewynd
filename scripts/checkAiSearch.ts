/**
 * Dependency check: confirm the sandbox has Slack AI Search enabled.
 *
 * Layer 3's MemoryService (Real-Time Search) will call `assistant.search.info`
 * to run semantic search over the workspace. That method only exists on
 * Enterprise / paid workspaces with Slack AI Search enabled. This script probes
 * it against the configured sandbox and prints a clear verdict.
 *
 *   npm run check:ai-search
 *
 * Requires SLACK_BOT_TOKEN in .env with the `search:read` scope (and Slack AI).
 */
import { WebClient } from '@slack/web-api';
import { config } from '../src/config';

const REQUEST_STEPS = `
Slack AI Search is NOT available on this sandbox. It is on the critical path for
Layer 3 (Real-Time Search / MemoryService). To get a sandbox that has it:

  1. Join the Slack Developer Program:  https://api.slack.com/developer-program
  2. In the Developer Program dashboard, request a Sandbox with a PAID plan
     (Slack AI / AI Search requires Business+ or Enterprise Grid — a free
     sandbox will NOT expose assistant.search.* methods).
  3. In the sandbox workspace: Settings → Slack AI → enable Slack AI, then
     enable AI Search.
  4. Reinstall the EchoOps app to the sandbox and add the OAuth scope
     'search:read' (plus any assistant scopes Slack lists for search).
  5. Re-run:  npm run check:ai-search

>>> FLAG: This is a CRITICAL-PATH BLOCKER for Layer 3 semantic RTS. <<<
`;

async function main(): Promise<void> {
  const client = new WebClient(config.slack.botToken);

  console.log('[check:ai-search] calling assistant.search.info ...');
  try {
    // Not in the typed WebClient surface across all versions — call by method name.
    const res: any = await (client as any).apiCall('assistant.search.info', {});
    if (res.ok) {
      console.log('[check:ai-search] ✅ AVAILABLE — assistant.search.info returned ok=true.');
      console.log('[check:ai-search] response:', JSON.stringify(res, null, 2));
      console.log('[check:ai-search] Slack AI Search is present. Layer 3 RTS is unblocked.');
      return;
    }
    console.log(`[check:ai-search] ⚠️  method returned ok=false: ${res.error}`);
    handleUnavailable(res.error);
  } catch (err: any) {
    const code = err?.data?.error ?? err?.message ?? String(err);
    console.log(`[check:ai-search] ⚠️  call failed: ${code}`);
    handleUnavailable(code);
  }
}

function handleUnavailable(error: string): void {
  // Distinguish "method not available on this plan" from ordinary auth errors.
  const notEntitled = /unknown_method|method_not_supported|not_allowed|feature|ai_search|paid|enterprise|invalid_scope|missing_scope/i.test(
    String(error),
  );
  if (notEntitled) {
    console.log(REQUEST_STEPS);
    process.exitCode = 2;
  } else {
    console.log(
      `[check:ai-search] Could not confirm due to: ${error}. ` +
        `Fix credentials/scopes and re-run. If it persists, follow the request steps:`,
    );
    console.log(REQUEST_STEPS);
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error('[check:ai-search] unexpected error:', e);
  process.exitCode = 1;
});
