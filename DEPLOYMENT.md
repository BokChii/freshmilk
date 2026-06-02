# Vercel Deployment

Jarvis runs on Vercel Serverless Functions.

## Endpoints

Vercel rewrites these public paths to API functions:

```text
GET  /health
POST /slack/commands
POST /github/webhook
```

## Required Environment Variables

Set these in Vercel Project Settings.

```text
SLACK_SIGNING_SECRET=...
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.2
GITHUB_WEBHOOK_SECRET=...
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
GITHUB_TOKEN=...
GITHUB_OWNER=BokChii
GITHUB_REPO=freshmilk
GITHUB_BRANCH=master
```

## GitHub Token

Create a fine-grained GitHub token with access to `BokChii/freshmilk`.

Required repository permission:

```text
Contents: Read and write
```

Use this token as `GITHUB_TOKEN`.

## Slack Slash Commands

After deployment, update all Slack slash commands to:

```text
https://YOUR_VERCEL_DOMAIN/slack/commands
```

Commands:

```text
/daily
/daily-summary
/record
/ask
/action
```

## GitHub Webhook

Update the GitHub webhook Payload URL:

```text
https://YOUR_VERCEL_DOMAIN/github/webhook
```

Content type:

```text
application/json
```

Secret:

```text
same value as GITHUB_WEBHOOK_SECRET
```

Events:

```text
Pushes
Pull requests
```

`Pull requests`를 켜야 PR opened, updated, closed, merged 요약이 Slack에 올라옵니다.

## Storage

Vercel does not persist local files. Jarvis stores records by committing Markdown/JSONL files into the GitHub repository through the GitHub Contents API.

Jarvis-generated commits use this prefix:

```text
chore(jarvis):
```

The GitHub webhook ignores those commits to avoid recursive webhook loops.
