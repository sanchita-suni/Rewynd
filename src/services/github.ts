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
  return Boolean(parseRepo(config.github.repo) && config.github.token);
}

export function getGithubMcp(): McpClient {
  if (!client) {
    client = new McpClient({ url: config.github.mcpUrl, token: config.github.token });
  }
  return client;
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
}): Promise<CreatedIssue> {
  const repo = parseRepo(config.github.repo);
  if (!repo) throw new Error('GITHUB_REPO is not set (owner/name)');
  if (!config.github.token) throw new Error('GITHUB_TOKEN is not set');

  const mcp = getGithubMcp();
  const text = await mcp.callToolText('create_issue', {
    owner: repo.owner,
    repo: repo.name,
    title: args.title,
    body: args.body,
    labels: args.labels ?? ['incident', 'rewynd'],
  });

  const parsed = tryJson(text);
  const issue = Array.isArray(parsed) ? parsed[0] : parsed;
  const number = Number(issue?.number);
  const url = issue?.html_url ?? issue?.url;
  if (!Number.isFinite(number) || !url) {
    throw new Error(`create_issue returned an unexpected shape: ${text.slice(0, 200)}`);
  }
  return { number, url };
}

function tryJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
