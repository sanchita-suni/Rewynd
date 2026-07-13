import { createServer } from 'node:http';
import { App, LogLevel } from '@slack/bolt';
import { config } from './config';
import { registerMessageListener } from './listeners/message';
import { registerActionListeners } from './listeners/actions';

function toLogLevel(level: string): LogLevel {
  switch (level.toLowerCase()) {
    case 'debug':
      return LogLevel.DEBUG;
    case 'warn':
      return LogLevel.WARN;
    case 'error':
      return LogLevel.ERROR;
    default:
      return LogLevel.INFO;
  }
}

const app = new App({
  token: config.slack.botToken,
  // Socket Mode keeps the demo self-contained — no public URL required.
  socketMode: config.slack.socketMode,
  appToken: config.slack.appToken,
  // Signing secret is only consulted in HTTP mode; harmless when empty in Socket Mode.
  signingSecret: config.slack.signingSecret || undefined,
  logLevel: toLogLevel(config.logLevel),
});

// Diagnostic: set DEBUG_EVENTS=true to print every event Slack delivers.
// Use this to confirm whether assistant_thread_started / message.im arrive at all.
if (process.env.DEBUG_EVENTS === 'true') {
  app.use(async ({ body, next }) => {
    const b = body as any;
    const type = b?.event?.type ?? b?.type ?? 'unknown';
    const subtype = b?.event?.subtype ?? '-';
    const channelType = b?.event?.channel_type ?? '-';
    const hasToken = b?.event?.action_token || b?.action_token ? 'yes' : 'no';
    console.log(
      `[event] type=${type} subtype=${subtype} channel_type=${channelType} action_token=${hasToken}`,
    );
    await next();
  });
}

registerMessageListener(app);
registerActionListeners(app);

// NOTE: we deliberately do NOT use Bolt's Assistant() wrapper. Slack delivers the
// agent DM as a plain `message` event with channel_type=im — and crucially it
// carries the `action_token` that semantic Real-Time Search needs. The message
// listener handles that surface directly (see listeners/message.ts).

/**
 * Socket Mode needs no inbound port, but PaaS free tiers (Render web services et
 * al.) require the process to bind $PORT and will idle it out otherwise. Expose a
 * tiny health endpoint so the app can be hosted anywhere and kept warm by a pinger.
 */
function startHealthServer(): void {
  const port = Number(process.env.PORT ?? config.slack.port);
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'rewynd', mode: 'socket' }));
  });

  // The health endpoint is a hosting convenience, not a dependency — Socket Mode
  // needs no inbound port. Never let it take the agent down (e.g. a stale process
  // still holding the port locally).
  server.on('error', (err: NodeJS.ErrnoException) => {
    const why = err.code === 'EADDRINUSE' ? `port ${port} already in use` : err.message;
    console.log(`   (health endpoint not started — ${why}; the agent is unaffected)`);
  });

  server.listen(port, () => {
    console.log(`   health endpoint listening on :${port}`);
  });
}

(async () => {
  if (config.slack.socketMode) {
    await app.start();
    startHealthServer();
  } else {
    await app.start(config.slack.port);
  }
  const mode = config.slack.socketMode ? 'Socket Mode' : `HTTP :${config.slack.port}`;
  // eslint-disable-next-line no-console
  console.log(
    `⚡️ Rewynd is running (${mode}). Listening in #${config.slack.incidentChannel} for stack traces.`,
  );
})();
