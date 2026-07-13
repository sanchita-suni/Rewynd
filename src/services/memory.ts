import { WebClient } from '@slack/web-api';
import {
  ErrorSignature,
  MemoryLookupOptions,
  MemoryService,
  PriorIncident,
} from './types';
import { config } from '../config';
import {
  recallIncident,
  rememberIncident,
} from '../orchestrator/incidentContext';
import { looksLikeStackTrace } from '../util/stackTrace';
import {
  RtsMessage,
  buildKeywordQuery,
  buildQuestionQuery,
  extractFixEra,
  looksLikeResolution,
  parseRtsMessages,
  pickResolver,
} from './rts';

/**
 * MOCK MemoryService — realistic hardcoded prior incident. Used when
 * USE_MOCKS=true or RTS is disabled, and as a labelled fallback for offline demos.
 */
export class MockMemoryService implements MemoryService {
  async findPriorIncident(
    errorSignature: ErrorSignature,
    _opts?: MemoryLookupOptions,
  ): Promise<PriorIncident | null> {
    if (/novel|unknown-signature/i.test(errorSignature.raw)) return null;

    const prior: PriorIncident = {
      threadUrl:
        'https://rewynd-sandbox.slack.com/archives/C0INCID3NT/p1710500400000000',
      resolver: 'trish',
      resolvedAt: '2026-03-15T14:20:00Z',
      fixSummary:
        'Wrapped the gateway call in an exponential-backoff retry (3 attempts) and raised the socket timeout to 15s; added a checkout timeout regression test.',
    };
    // Populate the session cache so CodeService (mock or real) has a fix era.
    rememberIncident(errorSignature.signature, {
      prior,
      fixEra: { resolvedAt: prior.resolvedAt },
      fetchedAt: Date.now(),
    });
    return prior;
  }
}

/**
 * REAL MemoryService — Slack Real-Time Search (spec §1.1, the hero tech).
 *
 * Flow: build a NATURAL-LANGUAGE QUESTION query (semantic retrieval), call RTS,
 * pick the best resolution message, and return the typed prior incident. Falls
 * back to a keyword query when the question yields nothing. Caches per incident
 * to respect RTS rate limits and to hand the fix-era ref to CodeService.
 */
export class RealMemoryService implements MemoryService {
  private readonly client: WebClient;
  private readonly fallback: MemoryService;
  private readonly userNameCache = new Map<string, string>();
  private channelIdCache: string | null = null;

  constructor(fallback: MemoryService) {
    this.client = new WebClient(config.slack.botToken);
    this.fallback = fallback;
  }

  async findPriorIncident(
    sig: ErrorSignature,
    opts?: MemoryLookupOptions,
  ): Promise<PriorIncident | null> {
    // 1. Session cache first — RTS rate-limit protection (spec §1.1).
    const cached = recallIncident(sig.signature);
    if (cached) {
      console.log('[RTS] Cache hit → reusing prior-incident result for this session');
      return cached.prior;
    }

    if (!config.rts.enabled) {
      console.log('[RTS] Disabled (RTS_ENABLED=false) → using mock memory fallback');
      return this.fallback.findPriorIncident(sig);
    }

    const actionToken = opts?.actionToken;
    console.log(`[RTS] action_token from event: ${actionToken ? 'present' : 'MISSING'}`);

    let best: RtsMessage | undefined;
    let via = '';

    // 1. Semantic RTS (assistant.search.context) — needs Slack AI Search + token.
    try {
      const question = buildQuestionQuery(sig);
      console.log(`[RTS] Semantic query: "${question}"`);
      best = this.pickBest(await this.search(question, actionToken));

      if (!best) {
        const keyword = buildKeywordQuery(sig);
        console.log(`[RTS] No semantic match → keyword fallback: "${keyword}"`);
        best = this.pickBest(await this.search(keyword, actionToken));
      }
      if (best) via = 'semantic RTS';
    } catch (err) {
      console.log(
        `[RTS] semantic search unavailable — ${(err as Error).message} → trying channel-history fallback`,
      );
    }

    // 2. Channel-history fallback — works on any workspace, no Slack AI needed.
    if (!best) {
      try {
        console.log('[RTS] Channel-history fallback: scanning incident channel…');
        best = this.pickBest(await this.searchChannelHistory(sig));
        if (best) via = 'channel-history fallback';
      } catch (err) {
        console.log(`[RTS] channel-history fallback error — ${(err as Error).message}`);
      }
    }

    if (!best) {
      console.log('[RTS] → no prior incident found (semantic + history)');
      rememberIncident(sig.signature, { prior: null, fetchedAt: Date.now() });
      return null;
    }

    const prior = await this.toPriorIncident(best);
    const fixEra = extractFixEra(best.text, prior.resolvedAt);
    rememberIncident(sig.signature, { prior, fixEra, fetchedAt: Date.now() });

    console.log(
      `[RTS] match found via ${via}: thread from ${monthYear(prior.resolvedAt)}, resolved by @${prior.resolver}`,
    );
    return prior;
  }

  /**
   * Fallback memory: scan the incident channel's history for a prior occurrence
   * of this error whose thread contains a resolution. Uses conversations.history
   * + conversations.replies (scopes we already hold) — no Slack AI required.
   */
  private async searchChannelHistory(sig: ErrorSignature): Promise<RtsMessage[]> {
    const channelId = await this.resolveChannelId(config.slack.seedChannel);
    if (!channelId) return [];

    const tokens = buildKeywordQuery(sig)
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);
    if (tokens.length === 0) return [];

    const hist: any = await this.client.conversations.history({ channel: channelId, limit: 100 });
    const roots: any[] = hist?.messages ?? [];
    const out: RtsMessage[] = [];

    for (const root of roots) {
      const rootText = String(root?.text ?? '').toLowerCase();
      if (!tokens.some((t) => rootText.includes(t))) continue;

      // Prefer a resolution reply in the thread (that's the "how we fixed it").
      let picked: RtsMessage = { text: String(root?.text ?? ''), ts: root?.ts, userId: root?.user, channelId };
      if (root?.thread_ts && Number(root?.reply_count ?? 0) > 0) {
        const replies: any = await this.client.conversations.replies({
          channel: channelId,
          ts: root.thread_ts,
        });
        const resolution = (replies?.messages ?? []).find((r: any) =>
          looksLikeResolution(String(r?.text ?? '')),
        );
        if (resolution) {
          picked = {
            text: String(resolution.text ?? ''),
            ts: resolution.ts,
            userId: resolution.user,
            channelId,
            score: 1, // has a real resolution → rank first
          };
        }
      }
      out.push(picked);
    }
    return out;
  }

  /** Resolve a channel name (or ID) to an ID, cached. */
  private async resolveChannelId(nameOrId: string): Promise<string | null> {
    const configured = nameOrId.replace(/^#/, '');
    if (/^[CGD][A-Z0-9]{6,}$/.test(configured)) return configured;
    if (this.channelIdCache) return this.channelIdCache;
    let cursor: string | undefined;
    do {
      const res: any = await this.client.conversations.list({
        types: 'public_channel,private_channel',
        limit: 200,
        cursor,
      });
      const match = (res.channels ?? []).find((c: any) => c.name === configured);
      if (match?.id) {
        this.channelIdCache = match.id;
        return match.id;
      }
      cursor = res.response_metadata?.next_cursor || undefined;
    } while (cursor);
    return null;
  }

  /** Call the RTS search method and normalize its results. */
  private async search(query: string, actionToken?: string): Promise<RtsMessage[]> {
    // `assistant.search.context` is the RTS search method — not in the typed
    // WebClient surface, so call it by name. `action_token` (from the triggering
    // event) is required for AI apps.
    const params: Record<string, unknown> = { query, limit: config.rts.resultLimit };
    if (actionToken) params.action_token = actionToken;
    const raw: any = await (this.client as any).apiCall('assistant.search.context', params);
    return parseRtsMessages(raw);
  }

  /**
   * Pick the message that actually explains HOW it was fixed.
   *
   * Semantic search happily returns other *occurrences* of the same stack trace —
   * they're the closest match, but they're incident reports, not resolutions.
   * So drop raw stack-trace posts and rank anything that reads like a fix
   * (a "resolved/fixed by" phrase, a PR/commit link) above everything else.
   */
  private pickBest(messages: RtsMessage[]): RtsMessage | undefined {
    if (messages.length === 0) return undefined;

    const rank = (m: RtsMessage): number => {
      let s = m.score ?? 0;
      if (looksLikeResolution(m.text)) s += 10;
      if (/\b(resolved|fixed|patched)\s+by\b/i.test(m.text)) s += 5;
      if (/github\.com\/[^\s]+\/(pull|commit)\//i.test(m.text)) s += 5;
      return s;
    };

    // Incident reports (raw traces) are never the answer — exclude them first.
    const resolutions = messages.filter((m) => !looksLikeStackTrace(m.text).isStackTrace);
    const pool = resolutions.length > 0 ? resolutions : messages;

    return [...pool].sort((a, b) => rank(b) - rank(a))[0];
  }

  private async toPriorIncident(m: RtsMessage): Promise<PriorIncident> {
    const resolvedAt = m.ts
      ? new Date(Number(m.ts) * 1000).toISOString()
      : new Date().toISOString();

    const resolverRaw = pickResolver(m.text) ?? m.userId ?? 'unknown';
    const resolver = await this.resolveUserName(resolverRaw);

    const threadUrl = m.permalink ?? (await this.permalink(m));

    return {
      threadUrl,
      resolver,
      resolvedAt,
      fixSummary: condense(m.text),
    };
  }

  /** Resolve a Slack user id to a handle; pass through non-ids unchanged. */
  private async resolveUserName(idOrName: string): Promise<string> {
    if (!/^[UW][A-Z0-9]{6,}$/.test(idOrName)) return idOrName.replace(/^@/, '');
    if (this.userNameCache.has(idOrName)) return this.userNameCache.get(idOrName)!;
    try {
      const res: any = await this.client.users.info({ user: idOrName });
      const name =
        res?.user?.profile?.display_name ||
        res?.user?.name ||
        res?.user?.real_name ||
        idOrName;
      this.userNameCache.set(idOrName, name);
      return name;
    } catch {
      return idOrName;
    }
  }

  private async permalink(m: RtsMessage): Promise<string> {
    if (!m.channelId || !m.ts) return '';
    try {
      const res: any = await this.client.chat.getPermalink({
        channel: m.channelId,
        message_ts: m.ts,
      });
      return res?.permalink ?? '';
    } catch {
      return '';
    }
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthYear(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 7);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Trim a resolution message into a one-line fix summary. */
function condense(text: string): string {
  const cleaned = text
    .replace(/<@[A-Z0-9]+>/g, (m) => m) // keep mentions readable
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 240 ? cleaned.slice(0, 237) + '…' : cleaned;
}

// Selection: real RTS unless explicitly forced to mocks.
export const memoryService: MemoryService = config.useMocks
  ? new MockMemoryService()
  : new RealMemoryService(new MockMemoryService());
