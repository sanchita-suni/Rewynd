import * as dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(
      `Missing required env var ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== '' ? v : fallback;
}

export const config = {
  slack: {
    botToken: required('SLACK_BOT_TOKEN'),
    appToken: required('SLACK_APP_TOKEN'),
    // Signing secret is only needed in HTTP mode; keep it optional for Socket Mode.
    signingSecret: optional('SLACK_SIGNING_SECRET', ''),
    socketMode: optional('SOCKET_MODE', 'true') === 'true',
    port: Number(optional('PORT', '3000')),
    // Channel name (without #) or channel ID Rewynd listens in.
    incidentChannel: optional('INCIDENT_CHANNEL', 'incident-response'),
    // Channel the seed script plants the historical incident into (defaults to
    // the incident channel; a public channel is required for RTS scoping, §7).
    seedChannel: optional('SEED_CHANNEL', optional('INCIDENT_CHANNEL', 'incident-response')),
  },
  // Real-Time Search (Layer 2 — MemoryService). Uses the Slack bot token +
  // `search:read`; requires Slack AI Search on the workspace for semantic mode.
  rts: {
    enabled: optional('RTS_ENABLED', 'true') === 'true',
    resultLimit: Number(optional('RTS_RESULT_LIMIT', '8')),
  },
  // GitHub MCP (Layer 2 — CodeService). mcpUrl + token connect to the server;
  // repo/defaultBranch tell it which repository the stack traces map to.
  github: {
    mcpUrl: optional('GITHUB_MCP_URL', 'https://api.githubcopilot.com/mcp/'),
    token: optional('GITHUB_TOKEN', ''),
    // "owner/name" of the repo the incident code lives in.
    repo: optional('GITHUB_REPO', ''),
    defaultBranch: optional('GITHUB_DEFAULT_BRANCH', 'main'),
  },
  // Synthesis LLM (Layer 3 — SynthesisService). Any OpenAI-compatible chat
  // endpoint: Groq (free tier), OpenRouter (free models), or a local Ollama.
  // Leave LLM_BASE_URL empty to use the deterministic (no-LLM) synthesizer.
  llm: {
    baseUrl: optional('LLM_BASE_URL', ''),
    apiKey: optional('LLM_API_KEY', ''),
    model: optional('LLM_MODEL', ''),
  },
  // Murf TTS (Layer 3 — VoiceService). Renders the triage summary to a ~15s clip.
  murf: {
    apiKey: optional('MURF_API_KEY', ''),
    voiceId: optional('MURF_VOICE_ID', 'en-US-natalie'),
    apiUrl: optional('MURF_API_URL', 'https://api.murf.ai/v1/speech/generate'),
  },
  // Force the Layer 1 mocks even when real integrations are configured. Handy for
  // offline demos. When false (default), each service uses its real impl and
  // degrades to the mock only if its own config is missing or a call fails.
  useMocks: optional('USE_MOCKS', 'false') === 'true',
  logLevel: optional('LOG_LEVEL', 'info'),
} as const;

export type Config = typeof config;
