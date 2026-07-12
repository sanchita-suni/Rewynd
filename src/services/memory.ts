import { WebClient } from '@slack/web-api';
import { ErrorSignature, MemoryService, PriorIncident } from './types';
import { config } from '../config';
import {
  recallIncident,
  rememberIncident,
} from '../orchestrator/incidentContext';
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

  constructor(fallback: MemoryService) {
    this.client = new WebClient(config.slack.botToken);
    this.fallback = fallback;
  }

  async findPriorIncident(sig: ErrorSignature): Promise<PriorIncident | null> {
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

    try {
      // 2. Semantic (question-form) query.
      const question = buildQuestionQuery(sig);
      console.log(`[RTS] Semantic query: "${question}"`);
      let best = this.pickBest(await this.search(question));

      // 3. Keyword fallback if the semantic pass found nothing usable.
      if (!best) {
        const keyword = buildKeywordQuery(sig);
        console.log(`[RTS] No semantic match → keyword fallback: "${keyword}"`);
        best = this.pickBest(await this.search(keyword));
      }

      if (!best) {
        console.log('[RTS] → no prior incident found');
        rememberIncident(sig.signature, { prior: null, fetchedAt: Date.now() });
        return null;
      }

      const prior = await this.toPriorIncident(best);
      const fixEra = extractFixEra(best.text, prior.resolvedAt);
      rememberIncident(sig.signature, { prior, fixEra, fetchedAt: Date.now() });

      console.log(
        `[RTS] Semantic query → match found: thread from ${monthYear(
          prior.resolvedAt,
        )}, resolved by @${prior.resolver}`,
      );
      return prior;
    } catch (err) {
      // Honest degrade: don't fabricate a "real" match. Log loudly, return null
      // (card renders the "No prior incident found" banner).
      console.log(
        `[RTS] ERROR — ${(err as Error).message} → degrading to no-match (check search:read scope / Slack AI Search entitlement)`,
      );
      rememberIncident(sig.signature, { prior: null, fetchedAt: Date.now() });
      return null;
    }
  }

  /** Call the RTS search method and normalize its results. */
  private async search(query: string): Promise<RtsMessage[]> {
    // `assistant.search.context` is the RTS search method — not in the typed
    // WebClient surface, so call it by name.
    const raw: any = await (this.client as any).apiCall('assistant.search.context', {
      query,
      limit: config.rts.resultLimit,
    });
    return parseRtsMessages(raw);
  }

  /** Prefer resolution-flavored messages, then highest score, then first. */
  private pickBest(messages: RtsMessage[]): RtsMessage | undefined {
    if (messages.length === 0) return undefined;
    const scored = [...messages].sort((a, b) => {
      const ra = looksLikeResolution(a.text) ? 1 : 0;
      const rb = looksLikeResolution(b.text) ? 1 : 0;
      if (ra !== rb) return rb - ra;
      return (b.score ?? 0) - (a.score ?? 0);
    });
    return scored[0];
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
