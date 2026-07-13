import { config } from '../config';
import { CreatedIssue } from './types';
import { McpClient } from './mcp';

/**
 * Shared GitHub MCP access — one client for both code grounding (CodeService)
 * and the confirm-gated write (the follow-up issue). Spec §1.2: the same MCP
 * server that grounds code also closes the loop by opening the tracked issue.
 */

let client: McpClient | null = null;

export interface Repo {
  owner: string;
  name: string;
}

export function parseRepo(repo: string): Repo | null {
  const m = repo.trim().match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!m) return null;
  return { owner: m[1], name: m[2] };
}

export function isGithubConfigured(): boolean {
  return Boolean(config.github.token && (parseRepo(config.github.repo) || repoMapEntries().length > 0));
}

export function repoSlug(repo: Repo): string {
  return `${repo.owner}/${repo.name}`;
}

export function resolveRepoForPath(path?: string, explicitRepo?: string): Repo | null {
  if (explicitRepo) return parseRepo(explicitRepo);

  const normalized = normalizePath(path ?? '');
  const match = repoMapEntries()
    .filter((entry) => normalized === entry.prefix || normalized.startsWith(`${entry.prefix}/`))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  if (match) return match.repo;

  return parseRepo(config.github.repo);
}

function repoMapEntries(): Array<{ prefix: string; repo: Repo }> {
  return config.github.repoMap
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [prefixRaw, repoRaw] = entry.split('=').map((part) => part?.trim());
      const repo = parseRepo(repoRaw ?? '');
      if (!prefixRaw || !repo) return null;
      return { prefix: normalizePath(prefixRaw).replace(/\/+$/, ''), repo };
    })
    .filter((entry): entry is { prefix: string; repo: Repo } => Boolean(entry));
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

export function getGithubMcp(): McpClient {
  if (!client) {
    client = new McpClient({ url: config.github.mcpUrl, token: config.github.token });
  }
  return client;
}

let cachedIssueTool: string | null = null;

interface McpToolSummary {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/**
 * GitHub MCP servers name their issue-creation tool differently
 * (`create_issue`, `issues_create`, `add_issue`, …). Discover the real name
 * from the server's tool list once, and log what's available for diagnostics.
 */
async function resolveIssueTool(mcp: McpClient): Promise<string> {
  if (cachedIssueTool) return cachedIssueTool;
  const tools = await mcp.listTools().catch(() => []);
  const names = tools.map((t) => t.name);
  console.log(`[MCP] available tools: ${names.join(', ') || '(none returned)'}`);

  const creationCandidates = tools.filter(isIssueCreationCandidate).map((t) => t.name);
  const pick =
    names.find((n) => n === 'create_issue') ??
    names.find((n) => n === 'issue_write') ??
    names.find((n) => /(^|_)create[_-]?(an[_-]?)?issue$/i.test(n)) ??
    creationCandidates[0] ??
    null;

  if (!pick) {
    throw new Error(
      `no issue-creation tool found on the GitHub MCP server. Available: ${names.join(', ') || 'none'}`,
    );
  }
  cachedIssueTool = pick;
  console.log(`[MCP] using issue tool → ${pick}`);
  return pick;
}

function isIssueCreationCandidate(tool: McpToolSummary): boolean {
  const name = tool.name.toLowerCase();
  const description = (tool.description ?? '').toLowerCase();
  const haystack = `${name} ${description}`;

  if (!haystack.includes('issue')) return false;
  if (
    /\b(comment|reply|pull_request|pull-request|review|read|list|field|type|sub_issue|sub-issue|update)\b/.test(
      haystack,
    )
  ) {
    return false;
  }
  return /\b(create|open|new|write)\b/.test(haystack);
}

/**
 * Open a follow-up issue via the GitHub MCP `create_issue` tool. Only ever
 * called from the confirm-button handler (human-in-the-loop — nothing writes
 * before the click).
 */
export async function createFollowUpIssue(args: {
  title: string;
  body: string;
  labels?: string[];
  repoSlug?: string;
}): Promise<CreatedIssue> {
  const repo = resolveRepoForPath(undefined, args.repoSlug);
  if (!repo) throw new Error('GITHUB_REPO or GITHUB_REPO_MAP is not set');
  if (!config.github.token) throw new Error('GITHUB_TOKEN is not set');

  const mcp = getGithubMcp();
  const tool = await resolveIssueTool(mcp);
  const text = await mcp.callToolText(tool, issueCreateArgs(tool, {
    owner: repo.owner,
    repo: repo.name,
    title: args.title,
    body: args.body,
    labels: args.labels ?? ['incident', 'rewynd'],
  }));

  const parsed = tryJson(text);
  const issue = Array.isArray(parsed) ? parsed[0] : parsed;
  const url = issue?.html_url ?? issue?.url;
  const number = issueNumber(issue, url);
  if (!Number.isFinite(number) || !url) {
    throw new Error(`create_issue returned an unexpected shape: ${text.slice(0, 200)}`);
  }
  return { number, url };
}

function issueNumber(issue: any, url: string | undefined): number {
  const direct = Number(issue?.number);
  if (Number.isFinite(direct)) return direct;

  const fromUrl = url?.match(/\/issues\/(\d+)(?:[/?#]|$)/i);
  if (fromUrl) return Number(fromUrl[1]);

  return Number.NaN;
}

function issueCreateArgs(
  tool: string,
  args: {
    owner: string;
    repo: string;
    title: string;
    body: string;
    labels: string[];
  },
): Record<string, unknown> {
  if (tool === 'issue_write') {
    return {
      method: 'create',
      ...args,
    };
  }
  return args;
}

function tryJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
