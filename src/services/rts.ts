import { ErrorSignature } from './types';
import { FixEraRef } from '../orchestrator/incidentContext';

/**
 * Pure helpers for the Real-Time Search layer (spec §1.1). Kept free of I/O so
 * they can be unit-tested offline; the network call lives in RealMemoryService.
 */

/** A single message returned by RTS, normalized across possible field names. */
export interface RtsMessage {
  text: string;
  /** Slack ts of the message (also used as the resolvedAt anchor). */
  ts?: string;
  channelId?: string;
  userId?: string;
  permalink?: string;
  /** Relevance score if the API provides one (higher = better). */
  score?: number;
}

/** The bare filename (no dir, no extension) — a readable "module" name. */
export function moduleName(sig: ErrorSignature): string | undefined {
  if (!sig.topFile) return undefined;
  const base = sig.topFile.split('/').pop() ?? sig.topFile;
  return base.replace(/\.[a-z0-9]+$/i, '');
}

/**
 * Build a NATURAL-LANGUAGE QUESTION query so RTS runs *semantic* retrieval.
 * Semantic mode triggers only for question-form queries (start with how/what/
 * where, end with "?"). Example:
 *   "How was the ETIMEDOUT error in payments resolved before?"
 */
export function buildQuestionQuery(sig: ErrorSignature): string {
  const mod = moduleName(sig);
  const subject = sig.errorType ?? firstMeaningfulToken(sig) ?? 'this error';
  const where = mod ? ` in ${mod}` : '';
  return `How was the ${subject} error${where} resolved before?`;
}

/**
 * Keyword fallback query — used when the semantic (question) query returns no
 * usable match. Plain terms trigger RTS's keyword path.
 */
export function buildKeywordQuery(sig: ErrorSignature): string {
  const parts = [sig.errorType, moduleName(sig), firstMeaningfulToken(sig)]
    .filter((p): p is string => !!p && p.length > 1);
  const unique = Array.from(new Set(parts));
  return unique.join(' ') || sig.signature;
}

/** First distinctive token from the signature (e.g. an errno like ETIMEDOUT). */
function firstMeaningfulToken(sig: ErrorSignature): string | undefined {
  const m = sig.raw.match(/\b([A-Z]{4,}|[A-Z][a-zA-Z]{3,}(?:Error|Exception))\b/);
  return m?.[1];
}

/**
 * Normalize an RTS API response into a scored list of messages. Tolerant of the
 * exact response shape (the method is not in the typed SDK), checking the field
 * names the Slack search surfaces are known to use.
 */
export function parseRtsMessages(raw: any): RtsMessage[] {
  const buckets: any[] = [];
  if (Array.isArray(raw?.messages)) buckets.push(...raw.messages);
  if (Array.isArray(raw?.results?.messages)) buckets.push(...raw.results.messages);
  if (Array.isArray(raw?.results)) buckets.push(...raw.results);
  if (Array.isArray(raw?.messages?.matches)) buckets.push(...raw.messages.matches);

  return buckets
    .map((m): RtsMessage => {
      const msg = m?.message ?? m; // some shapes nest under `message`
      return {
        text: msg?.text ?? m?.text ?? '',
        ts: msg?.ts ?? m?.ts,
        channelId: msg?.channel?.id ?? msg?.channel_id ?? m?.channel?.id ?? m?.channel_id,
        userId: msg?.user ?? msg?.user_id ?? m?.user ?? m?.author_user_id,
        permalink: msg?.permalink ?? m?.permalink,
        score: numeric(m?.score ?? msg?.score),
      };
    })
    .filter((m) => m.text || m.permalink || m.ts);
}

function numeric(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Extract a fix-era reference (PR / commit) from resolution-thread text so
 * CodeService can diff the current code against the right commit era.
 */
export function extractFixEra(text: string, resolvedAt?: string): FixEraRef {
  const ref: FixEraRef = { resolvedAt };
  const pr = text.match(/github\.com\/[^\s/]+\/[^\s/]+\/pull\/(\d+)/i);
  if (pr) {
    ref.prNumber = Number(pr[1]);
    ref.url = pr[0];
  }
  const commit = text.match(/github\.com\/[^\s/]+\/[^\s/]+\/commit\/([0-9a-f]{7,40})/i);
  if (commit) {
    ref.commitSha = commit[1];
    ref.url = ref.url ?? commit[0];
  }
  const bareSha = text.match(/\b([0-9a-f]{40})\b/i);
  if (!ref.commitSha && bareSha) ref.commitSha = bareSha[1];
  return ref;
}

/**
 * Best-effort resolver handle from a resolution message. Prefers an explicit
 * "resolved/fixed by @name" phrase, then a Slack mention id, then any @handle.
 * Returns the mention id (e.g. "U123") or literal handle; the service resolves
 * ids to display names via users.info.
 */
export function pickResolver(text: string): string | undefined {
  const byPhrase = text.match(/(?:resolved|fixed|patched)\s+by\s+<@([A-Z0-9]+)>/i);
  if (byPhrase) return byPhrase[1];
  const byPhraseName = text.match(/(?:resolved|fixed|patched)\s+by\s+@?([a-z0-9._-]{2,})/i);
  if (byPhraseName) return byPhraseName[1];
  const mention = text.match(/<@([A-Z0-9]+)>/);
  if (mention) return mention[1];
  const handle = text.match(/(?:^|\s)@([a-z0-9._-]{2,})/i);
  return handle?.[1];
}

/** Does the raw text mention "resolved/fixed"? Used to prefer resolution messages. */
export function looksLikeResolution(text: string): boolean {
  return /\b(resolv|fixed|patch|root cause|mitigat|workaround)/i.test(text);
}
