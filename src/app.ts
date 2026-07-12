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

registerMessageListener(app);
registerActionListeners(app);

(async () => {
  if (config.slack.socketMode) {
    await app.start();
  } else {
    await app.start(config.slack.port);
  }
  const mode = config.slack.socketMode ? 'Socket Mode' : `HTTP :${config.slack.port}`;
  // eslint-disable-next-line no-console
  console.log(
    `⚡️ Rewynd is running (${mode}). Listening in #${config.slack.incidentChannel} for stack traces.`,
  );
})();
