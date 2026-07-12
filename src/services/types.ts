/**
 * Typed service contracts for Rewynd' four intelligence layers.
 *
 * Every layer is defined as an interface here and implemented with MOCK data in
 * this repository state. Each mock is a drop-in for a real integration that
 * arrives in a later layer:
 *
 *   MemoryService    -> Slack AI Search / Real-Time Search (RTS)
 *   CodeService      -> GitHub MCP
 *   SynthesisService -> Slack AI
 *   VoiceService     -> Murf
 *
 * The orchestrator only ever talks to these interfaces, so swapping a mock for a
 * real implementation never touches the orchestration or Block Kit code.
 */

/** A structured fingerprint of an error, derived from a raw stack trace. */
export interface ErrorSignature {
  /** Normalized single-line signature used for matching (e.g. the exception + top frame). */
  signature: string;
  /** The exception / error type if one was detected (e.g. "TypeError"). */
  errorType?: string;
  /** The top-of-stack file, if detected. */
  topFile?: string;
  /** The top-of-stack line number, if detected. */
  topLine?: number;
  /** The raw text that triggered the incident. */
  raw: string;
}

/** Result of looking up whether we've seen this error before. */
export interface PriorIncident {
  /** Permalink to the Slack thread where it was previously resolved. */
  threadUrl: string;
  /** Display name of whoever resolved it last time. */
  resolver: string;
  /** ISO-8601 timestamp of when it was resolved. */
  resolvedAt: string;
  /** One-line human summary of the fix that worked. */
  fixSummary: string;
}

/** Whether the code that threw still matches the code from the era of the known fix. */
export type CodeVerdict = 'MATCH' | 'DRIFTED';

/** Result of grounding a stack trace against live source code. */
export interface CodeGrounding {
  /** File the top meaningful frame points at. */
  file: string;
  /** Line number within that file. */
  line: number;
  /** The current source snippet around that line. */
  currentSnippet: string;
  /** A short unified-diff-style comparison between now and the known-fix era. */
  diffVsFixEra: string;
  /**
   * MATCH  -> the current code is materially the same as when the prior fix applied.
   * DRIFTED-> the code has changed since; the prior fix may not transfer cleanly.
   */
  verdict: CodeVerdict;
}

/** Synthesized triage recommendation combining memory + code grounding. */
export interface Synthesis {
  /** The actionable recommendation for the responder. */
  recommendation: string;
  /** A spoken-length triage summary, <= 40 words, suitable for TTS. */
  triageSummary: string;
}

/** Rendered voice output for the triage summary. */
export interface VoiceRendering {
  /** URL to a playable audio file of the triage summary (provider-hosted). */
  audioUrl: string;
  /** Raw audio bytes, when available, so we can upload a native Slack player. */
  audioData?: Buffer;
  /** MIME type of `audioData` (e.g. "audio/mpeg"). */
  contentType?: string;
  /** Clip length in seconds, if the provider reports it. */
  lengthSeconds?: number;
  /** True when this is the mock/placeholder rendering rather than real TTS. */
  isMock?: boolean;
}

/** A follow-up issue opened via the confirm button. */
export interface CreatedIssue {
  number: number;
  url: string;
}

export interface MemoryService {
  /** Find a prior incident matching this error, or null if we've never seen it. */
  findPriorIncident(errorSignature: ErrorSignature): Promise<PriorIncident | null>;
}

export interface CodeService {
  /** Ground the stack trace against live code and report whether it has drifted. */
  groundError(errorSignature: ErrorSignature): Promise<CodeGrounding>;
}

export interface SynthesisService {
  /** Combine prior-incident memory and code grounding into a recommendation + summary. */
  recommend(prior: PriorIncident | null, code: CodeGrounding): Promise<Synthesis>;
}

export interface VoiceService {
  /** Render the triage summary to an audio file and return its URL. */
  renderTriage(triageSummary: string): Promise<VoiceRendering>;
}
