import { CodeGrounding, CodeService, ErrorSignature } from './types';
import { config } from '../config';
import { recallIncident, FixEraRef } from '../orchestrator/incidentContext';
import { McpClient } from './mcp';
import { getGithubMcp, parseRepo } from './github';
import { computeDrift, extractSnippet } from './diff';

/**
 * MOCK CodeService — realistic hardcoded grounding (spec §4 payments.ts MATCH).
 * Used when USE_MOCKS=true or the GitHub MCP repo/token are unconfigured.
 */
export class MockCodeService implements CodeService {
  async groundError(errorSignature: ErrorSignature): Promise<CodeGrounding> {
    const file = errorSignature.topFile ?? 'src/checkout/payments.ts';
    const line = errorSignature.topLine ?? 42;
    return {
      file,
      line,
      currentSnippet: [
        `  40 | async charge(order: Order): Promise<Receipt> {`,
        `  41 |   // retry with backoff — added by the Mar-2026 fix, still present`,
        `> 42 |   return await withRetry(() => this.gateway.charge(order), { attempts: 3, timeoutMs: 15000 });`,
        `  43 | }`,
      ].join('\n'),
      diffVsFixEra: [
        '--- a/' + file + ' (fix era: 2026-03-15)',
        '+++ b/' + file + ' (current)',
        '@@  no material change — retry/backoff guard intact  @@',
        '   return await withRetry(() => this.gateway.charge(order), { attempts: 3, timeoutMs: 15000 });',
      ].join('\n'),
      verdict: 'MATCH',
    };
  }
}

/**
 * REAL CodeService — GitHub MCP grounding (spec §1.2).
 *
 * Fetches the current `file:line` from the configured repo via the GitHub MCP
 * server, resolves the fix-era commit (from the PR/commit the prior thread
 * linked, else the resolvedAt date carried in the session cache), fetches the
 * file at that era, and diffs the implicated region → MATCH / DRIFTED. This
 * verdict drives the card banner.
 */
export class RealCodeService implements CodeService {
  private readonly fallback: CodeService;
  private mcp?: McpClient;

  constructor(fallback: CodeService) {
    this.fallback = fallback;
  }

  async groundError(sig: ErrorSignature): Promise<CodeGrounding> {
    const repo = parseRepo(config.github.repo);
    if (!repo || !config.github.token) {
      console.log('[MCP] GitHub MCP not configured (GITHUB_REPO / GITHUB_TOKEN) → mock grounding');
      return this.fallback.groundError(sig);
    }
    if (!sig.topFile || !sig.topLine) {
      console.log('[MCP] No file:line in stack trace top frame → mock grounding');
      return this.fallback.groundError(sig);
    }

    const { owner, name } = repo;
    const file = sig.topFile;
    const line = sig.topLine;
    const branch = config.github.defaultBranch;

    try {
      const mcp = this.getClient();

      // 1. Current code.
      console.log(`[MCP] Fetching current ${file} from ${owner}/${name}@${branch}`);
      const currentContent = await this.getFile(mcp, owner, name, file, branch);
      const currentSnippet = extractSnippet(currentContent, line);

      // 2. Resolve the fix-era ref from the session cache (populated by MemoryService).
      const memo = recallIncident(sig.signature);
      const fixEra = memo?.fixEra;
      const hasPrior = Boolean(memo?.prior);

      if (!hasPrior || !fixEra) {
        // Nothing to diff against — real grounding, no drift verdict to make.
        console.log(
          `[MCP] GitHub → current ${file}:${line} grounded → no prior fix-era to compare`,
        );
        return {
          file,
          line,
          currentSnippet,
          diffVsFixEra: 'No prior incident on record — nothing to diff against.',
          verdict: 'MATCH',
        };
      }

      // 3. Fix-era code.
      const ref = await this.resolveFixEraRef(mcp, owner, name, file, fixEra);
      if (!ref) {
        // Have a prior but couldn't pin the fix era — be cautious, don't claim the fix applies.
        console.log(
          `[MCP] GitHub → current ${file}:${line} diffed vs fix-era → DRIFTED (fix era unverifiable)`,
        );
        return {
          file,
          line,
          currentSnippet,
          diffVsFixEra:
            'Could not resolve the fix-era commit from GitHub MCP; treating as unverified (the old fix may not apply).',
          verdict: 'DRIFTED',
        };
      }

      console.log(`[MCP] Fix-era ref resolved → ${ref}`);
      const fixEraContent = await this.getFile(mcp, owner, name, file, ref);

      // 4. Diff the implicated region.
      const { verdict, diffText } = computeDrift(currentContent, fixEraContent, line, file);
      const reason = verdict === 'MATCH' ? 'fix still applies' : 'region changed since fix';
      console.log(`[MCP] GitHub → current ${file}:${line} diffed vs fix-era → ${verdict} (${reason})`);

      return { file, line, currentSnippet, diffVsFixEra: diffText, verdict };
    } catch (err) {
      // Honest degrade: surface the grounding failure rather than fake a diff.
      console.log(`[MCP] ERROR — ${(err as Error).message} → grounding unavailable`);
      const hasPrior = Boolean(recallIncident(sig.signature)?.prior);
      return {
        file,
        line,
        currentSnippet: `⚠️ Could not fetch current code from GitHub MCP: ${(err as Error).message}`,
        diffVsFixEra: 'Grounding unavailable — GitHub MCP call failed.',
        // Cautious when a prior exists (don't claim the old fix still applies).
        verdict: hasPrior ? 'DRIFTED' : 'MATCH',
      };
    }
  }

  private getClient(): McpClient {
    if (!this.mcp) this.mcp = getGithubMcp();
    return this.mcp;
  }

  /** get_file_contents at a ref, decoded to plain text. */
  private async getFile(
    mcp: McpClient,
    owner: string,
    repo: string,
    path: string,
    ref: string,
  ): Promise<string> {
    const text = await mcp.callToolText('get_file_contents', { owner, repo, path, ref });
    return decodeFileContent(text);
  }

  /**
   * Resolve a git ref for the fix era. Prefer an explicit commit SHA, then the
   * PR's merge commit, then the newest commit on the file at/-before resolvedAt.
   */
  private async resolveFixEraRef(
    mcp: McpClient,
    owner: string,
    repo: string,
    path: string,
    fixEra: FixEraRef,
  ): Promise<string | undefined> {
    if (fixEra.commitSha) return fixEra.commitSha;

    if (fixEra.prNumber) {
      try {
        const prText = await mcp.callToolText('get_pull_request', {
          owner,
          repo,
          pullNumber: fixEra.prNumber,
        });
        const pr = tryJson(prText);
        const sha = pr?.merge_commit_sha ?? pr?.head?.sha;
        if (sha) return sha;
      } catch {
        /* fall through to date-based resolution */
      }
    }

    if (fixEra.resolvedAt) {
      try {
        const listText = await mcp.callToolText('list_commits', {
          owner,
          repo,
          path,
          perPage: 30,
        });
        const commits = asArray(tryJson(listText));
        const cutoff = new Date(fixEra.resolvedAt).getTime();
        // Newest commit whose date is at/-before the resolution → the fix-era state.
        const pick = commits
          .map((c: any) => ({
            sha: c?.sha,
            date: new Date(c?.commit?.author?.date ?? c?.commit?.committer?.date ?? 0).getTime(),
          }))
          .filter((c) => c.sha && c.date <= cutoff)
          .sort((a, b) => b.date - a.date)[0];
        if (pick?.sha) return pick.sha;
        // If everything is newer than the incident, fall back to the oldest we have.
        const oldest = commits[commits.length - 1]?.sha;
        return oldest;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

/** GitHub MCP may return raw text or a JSON contents object (base64). Handle both. */
function decodeFileContent(text: string): string {
  const parsed = tryJson(text);
  if (parsed && typeof parsed === 'object') {
    const obj: any = Array.isArray(parsed) ? parsed[0] : parsed;
    if (typeof obj?.content === 'string') {
      if ((obj.encoding ?? '').toLowerCase() === 'base64') {
        return Buffer.from(obj.content, 'base64').toString('utf8');
      }
      return obj.content;
    }
    if (typeof obj?.text === 'string') return obj.text;
  }
  return text;
}

function tryJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function asArray(v: any): any[] {
  if (Array.isArray(v)) return v;
  if (Array.isArray(v?.commits)) return v.commits;
  if (Array.isArray(v?.items)) return v.items;
  return [];
}

// Selection: real GitHub MCP unless explicitly forced to mocks.
export const codeService: CodeService = config.useMocks
  ? new MockCodeService()
  : new RealCodeService(new MockCodeService());
