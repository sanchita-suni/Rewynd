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
    // Channel name (without #) or channel ID EchoOps listens in.
    incidentChannel: optional('INCIDENT_CHANNEL', 'incident-response'),
  },
  // These are read by the real service implementations in later layers. In this
  // (mock) layer they are read but never dereferenced against a live endpoint.
  github: {
    mcpUrl: optional('GITHUB_MCP_URL', ''),
    token: optional('GITHUB_TOKEN', ''),
  },
  murf: {
    apiKey: optional('MURF_API_KEY', ''),
  },
  logLevel: optional('LOG_LEVEL', 'info'),
} as const;

export type Config = typeof config;
