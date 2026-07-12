import {
  CodeGrounding,
  CreatedIssue,
  ErrorSignature,
  PriorIncident,
  Synthesis,
  VoiceRendering,
} from '../services/types';

/**
 * Per-incident session cache.
 *
 * Two jobs, one store:
 *   1. **RTS rate-limit protection (spec §1.1).** MemoryService caches its RTS
 *      result per incident (keyed by error signature) so re-renders / retries in
 *      the same session never hit RTS again.
 *   2. **memory → code bridge.** The `CodeService.groundError` interface only
 *      receives the error signature — not the prior incident — and the
 *      orchestrator must not change. So MemoryService stashes the fix-era
 *      reference (PR/commit/timestamp) here under the same signature key, and
 *      CodeService reads it back to diff against the right era.
 *
 * In-memory and process-local by design: it is a session cache, not durable
 * storage. Cleared when the process restarts.
 */

/** A reference to the code era of the prior fix, best-effort. */
export interface FixEraRef {
  /** Merged PR number extracted from the resolution thread, if any. */
  prNumber?: number;
  /** Commit SHA extracted from the resolution thread, if any. */
  commitSha?: string;
  /** The raw PR/commit URL, for display/logging. */
  url?: string;
  /** Fallback: the resolution timestamp (ISO) to pick a commit era by date. */
  resolvedAt?: string;
}

export interface IncidentMemo {
  prior: PriorIncident | null;
  fixEra?: FixEraRef;
  /** The rest of the assembled model, cached so re-renders and the confirm
   *  write reuse the same synthesis/voice without re-calling the LLM/TTS. */
  errorSignature?: ErrorSignature;
  code?: CodeGrounding;
  synthesis?: Synthesis;
  voice?: VoiceRendering;
  /** Set once the confirm button opens the follow-up issue. */
  issue?: CreatedIssue;
  fetchedAt: number;
}

/** Merge fields into an existing memo (or create one) under the same key. */
export function mergeIncident(signature: string, patch: Partial<IncidentMemo>): void {
  const existing = recallIncident(signature);
  store.set(incidentKey(signature), {
    prior: existing?.prior ?? null,
    fetchedAt: Date.now(),
    ...existing,
    ...patch,
  });
}

const store = new Map<string, IncidentMemo>();

/** Cache key for an incident — the normalized error signature. */
export function incidentKey(signature: string): string {
  return signature.trim().toLowerCase();
}

export function rememberIncident(signature: string, memo: IncidentMemo): void {
  store.set(incidentKey(signature), memo);
}

export function recallIncident(signature: string): IncidentMemo | undefined {
  return store.get(incidentKey(signature));
}

/** Test/util: wipe the cache. */
export function clearIncidentCache(): void {
  store.clear();
}
