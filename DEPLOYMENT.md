# Deployment

Jarvis is a long-running Node HTTP server. Deploy it as a web service, not as a serverless function, because Slack slash commands and follow-up responses depend on the process staying alive.

## Recommended Platform

Use Koyeb first if the goal is a free deployment.

Koyeb provides one free Web Service and can deploy this repository from GitHub using the included Dockerfile.

See [KOYEB.md](./KOYEB.md).

Render, Railway, and Fly.io are also possible, but their free/trial and billing conditions can be less suitable for a Slack webhook service.

Avoid Vercel serverless for this MVP because the current app performs follow-up work after the immediate Slack response.

## Required Environment Variables

```text
PORT=3131
STORAGE_ROOT=.
SLACK_SIGNING_SECRET=...
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.2
GITHUB_WEBHOOK_SECRET=...
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

For a deployed service, use a persistent disk and set `STORAGE_ROOT` to that mounted path.

Examples:

```text
STORAGE_ROOT=/data
```

## Health Check

```text
GET /health
```

Expected response:

```json
{"ok":true,"service":"freshmilk-jarvis"}
```

## Slack URLs

After deployment, update every Slack slash command Request URL:

```text
https://YOUR_DEPLOYED_DOMAIN/slack/commands
```

Commands:

```text
/daily
/daily-summary
/record
/ask
```

## GitHub Webhook URL

Update the GitHub repository webhook Payload URL:

```text
https://YOUR_DEPLOYED_DOMAIN/github/webhook
```

Content type:

```text
application/json
```

Secret:

```text
same value as GITHUB_WEBHOOK_SECRET
```
