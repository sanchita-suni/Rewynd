import type { Logger } from '@slack/logger';

/**
 * Minimal Model Context Protocol client over the Streamable-HTTP transport,
 * built on Node's global `fetch` — no MCP SDK dependency (avoids ESM/CJS
 * friction and keeps the client fully typecheckable).
 *
 * Implements just what CodeService needs: `initialize` handshake, the
 * `notifications/initialized` ack, and `tools/call`. Responses may come back as
 * a single JSON body or as an SSE (`text/event-stream`) frame; both are handled.
 *
 * Spec §1.2/§3: Rewynd calls an *external GitHub MCP server* as tools to ground
 * code. This is that connection.
 */

const PROTOCOL_VERSION = '2025-06-18';

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: any;
  error?: { code: number; message: string; data?: unknown };
}

/** A tool result's content item (text is the common case for GitHub MCP). */
export interface McpContentItem {
  type: string;
  text?: string;
  [k: string]: unknown;
}

export interface McpToolResult {
  content: McpContentItem[];
  isError?: boolean;
  /** Some servers also return a structured payload alongside the text content. */
  structuredContent?: unknown;
}

export interface McpClientOptions {
  url: string;
  token: string;
  logger?: Logger;
  clientName?: string;
  clientVersion?: string;
}

export class McpClient {
  private readonly url: string;
  private readonly token: string;
  private readonly logger?: Logger;
  private readonly clientName: string;
  private readonly clientVersion: string;
  private sessionId?: string;
  private nextId = 1;
  private initialized = false;

  constructor(opts: McpClientOptions) {
    this.url = opts.url;
    this.token = opts.token;
    this.logger = opts.logger;
    this.clientName = opts.clientName ?? 'rewynd';
    this.clientVersion = opts.clientVersion ?? '0.2.0';
  }

  /** Run the initialize handshake. Safe to call more than once (no-op after first). */
  async connect(): Promise<void> {
    if (this.initialized) return;
    const result = await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: this.clientName, version: this.clientVersion },
    });
    this.logger?.debug(
      `[mcp] initialized with ${JSON.stringify(result?.serverInfo ?? {})}`,
    );
    // Acknowledge per spec so the server marks the session live.
    await this.notify('notifications/initialized', {});
    this.initialized = true;
  }

  /** List the tools the server exposes (name + description). */
  async listTools(): Promise<Array<{ name: string; description?: string }>> {
    if (!this.initialized) await this.connect();
    const result = await this.request('tools/list', {});
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  /** Call a tool by name and return its (parsed) result. */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    if (!this.initialized) await this.connect();
    const result = await this.request('tools/call', { name, arguments: args });
    return {
      content: Array.isArray(result?.content) ? result.content : [],
      isError: Boolean(result?.isError),
      structuredContent: result?.structuredContent,
    };
  }

  /** Convenience: call a tool and return the concatenated text content. */
  async callToolText(name: string, args: Record<string, unknown>): Promise<string> {
    const res = await this.callTool(name, args);
    if (res.isError) {
      const msg = res.content.map((c) => c.text ?? '').join('\n');
      throw new Error(`MCP tool ${name} returned an error: ${msg || 'unknown'}`);
    }
    return res.content
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string)
      .join('\n');
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${this.token}`,
      'MCP-Protocol-Version': PROTOCOL_VERSION,
    };
    if (this.sessionId) h['Mcp-Session-Id'] = this.sessionId;
    return h;
  }

  /** Send a JSON-RPC request and return its `result` (throws on error). */
  private async request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++;
    const res = await fetch(this.url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });

    // Capture a server-assigned session id (present after initialize).
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;

    if (!res.ok) {
      const body = await safeText(res);
      throw new Error(`MCP ${method} HTTP ${res.status}: ${body.slice(0, 300)}`);
    }

    const message = await this.readRpc(res, id);
    if (message?.error) {
      throw new Error(`MCP ${method} error ${message.error.code}: ${message.error.message}`);
    }
    return message?.result;
  }

  /** Fire-and-forget JSON-RPC notification (no id, no result expected). */
  private async notify(method: string, params: unknown): Promise<void> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: '2.0', method, params }),
    });
    // 202 Accepted (or any 2xx) is success; body is irrelevant.
    if (!res.ok && res.status !== 202) {
      this.logger?.debug(`[mcp] notify ${method} returned HTTP ${res.status}`);
    }
  }

  /** Parse either a JSON body or an SSE frame and return the RPC msg for `id`. */
  private async readRpc(res: Response, id: number | string): Promise<JsonRpcResponse | undefined> {
    const contentType = res.headers.get('content-type') ?? '';
    const body = await res.text();

    if (contentType.includes('text/event-stream')) {
      const messages = parseSse(body);
      return messages.find((m) => m.id === id) ?? messages[messages.length - 1];
    }

    if (!body.trim()) return undefined;
    try {
      const parsed = JSON.parse(body);
      if (Array.isArray(parsed)) return parsed.find((m) => m.id === id);
      return parsed;
    } catch {
      // Fall back to SSE parsing in case the content-type was misreported.
      const messages = parseSse(body);
      return messages.find((m) => m.id === id) ?? messages[messages.length - 1];
    }
  }
}

/** Extract JSON-RPC messages from an SSE stream body (`data:` lines). */
function parseSse(body: string): JsonRpcResponse[] {
  const out: JsonRpcResponse[] = [];
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      out.push(JSON.parse(payload));
    } catch {
      /* skip non-JSON keepalive frames */
    }
  }
  return out;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
