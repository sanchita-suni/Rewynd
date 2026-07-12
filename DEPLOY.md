# Rewynd — Deploy for judging (always-on)

**Why this matters (spec §3/§7):** "self-hosted" means *you* own uptime. `slack run`
and a laptop-bound Socket Mode connection **die when your machine sleeps** — which
would leave your sandbox dead exactly when a judge tests it. Deploy the Bolt app to
an **always-on host** so `#incident-response` responds 24/7 with your laptop off.

Rewynd runs in **Socket Mode**, so it needs **no public URL / inbound port** — the
host just keeps an outbound websocket open. Deploy it as a **worker / background
service** (not a web service). Any of Render, Railway, or Fly's free tier works.

## Build & start (all hosts)
```
Build:  npm install && npm run build
Start:  npm start          # runs node dist/app.js
Node:   >= 20
```

## Environment variables (set these on the host)
Copy every non-empty value from your `.env`:

| Var | Required | Notes |
|-----|:--:|------|
| `SLACK_BOT_TOKEN` | ✅ | `xoxb-…` |
| `SLACK_APP_TOKEN` | ✅ | `xapp-…`, scope `connections:write` (Socket Mode) |
| `INCIDENT_CHANNEL` | ✅ | channel name or ID Rewynd watches |
| `SEED_CHANNEL` | – | defaults to `INCIDENT_CHANNEL` |
| `GITHUB_TOKEN` / `GITHUB_REPO` | ✅* | needed for real grounding + issue write |
| `GITHUB_MCP_URL` | – | defaults to the hosted GitHub MCP |
| `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` | – | OpenAI-compatible synthesis LLM |
| `MURF_API_KEY` / `MURF_VOICE_ID` | – | Murf TTS |
| `USE_MOCKS` | – | `true` for an offline/deterministic fallback demo |

\* Without GitHub config, grounding + the confirm write degrade to mock/draft.
The **GitHub MCP server must be reachable from the host** (it is, for the hosted
`api.githubcopilot.com/mcp`).

## Render (recommended — Background Worker)
1. New → **Background Worker** → connect the repo.
2. Build command: `npm install && npm run build` · Start command: `npm start`.
3. Add all env vars above under **Environment**.
4. Deploy. Confirm the log shows: `⚡️ Rewynd is running (Socket Mode).`

`render.yaml` (optional, commit it):
```yaml
services:
  - type: worker
    name: rewynd
    env: node
    plan: free
    buildCommand: npm install && npm run build
    startCommand: npm start
    envVars:
      - key: SLACK_BOT_TOKEN
        sync: false
      - key: SLACK_APP_TOKEN
        sync: false
      # …add the rest (sync:false keeps secrets out of git)
```

## Railway
1. New Project → Deploy from repo.
2. Settings → Build: `npm install && npm run build`; Start: `npm start`.
3. Variables → add all env vars. Deploy.

## Fly.io
1. `fly launch --no-deploy` (accept a machine; no ports needed for Socket Mode).
2. `fly secrets set SLACK_BOT_TOKEN=… SLACK_APP_TOKEN=… GITHUB_TOKEN=… …`
3. In `fly.toml`, set the process to `npm start` and remove/ignore `[http_service]`
   (Socket Mode needs no inbound). `fly deploy`.

## Smoke test — prove it works with your laptop OFF
1. Deploy; confirm the host log prints `⚡️ Rewynd is running (Socket Mode).`
2. On the host (one-off shell) or locally once: `npm run seed` to plant the prior thread.
3. **Close your laptop / stop any local `npm run dev`.**
4. From your phone or another machine, post the fresh `ETIMEDOUT` trace in
   `#incident-response`.
5. Expect within a few seconds: the Rewynd card + the audio clip in-thread.
6. Check the **host** logs (Render/Railway/Fly dashboard) — you should see the
   `[RTS]`/`[MCP]`/`[LLM]`/`[Murf]` trace there, not on your laptop.
7. Tap **Open follow-up issue** → confirm a real GitHub issue is created and the
   thread is annotated.

If all seven pass, the sandbox is judge-ready.
