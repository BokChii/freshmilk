# Freshmilk Jarvis

Slack 중심으로 동작하는 사내 AI agent MVP입니다.

## Features

- `/daily`: 데일리 스크럼 기록
- `/daily-summary`: 작업자별 스크럼과 AI 요약 생성
- `/record`: 회의/고객사/업무 메모 구조화 저장
- `/ask`: 저장된 기록에 질문
- `/action`: 저장된 기록에서 액션 아이템 추출(저장하지 않음)
- GitHub webhook: push/PR 이벤트 Slack 요약
- `/daily-summary`: 오늘의 GitHub 작업도 함께 표시
- GitHub-backed storage: 기록을 GitHub repo의 `data/`, `records/`에 저장

## Local Run

로컬 Node 서버는 개발용으로 유지합니다.

```powershell
Copy-Item .env.example .env
npm.cmd run dev
```

Health check:

```powershell
Invoke-RestMethod -Uri "http://localhost:3131/health"
```

## Vercel Serverless

Vercel 배포 후 공개 URL은 아래처럼 사용합니다.

```text
GET  https://YOUR_VERCEL_DOMAIN/health
POST https://YOUR_VERCEL_DOMAIN/slack/commands
POST https://YOUR_VERCEL_DOMAIN/github/webhook
```

## Environment

```text
SLACK_SIGNING_SECRET=replace_with_slack_signing_secret
OPENAI_API_KEY=replace_with_openai_api_key
OPENAI_MODEL=gpt-5.2
GITHUB_WEBHOOK_SECRET=replace_with_github_webhook_secret
SLACK_WEBHOOK_URL=replace_with_slack_incoming_webhook_url
GITHUB_SLACK_WEBHOOK_URL=replace_with_github_channel_slack_incoming_webhook_url
GITHUB_TOKEN=replace_with_github_token
GITHUB_OWNER=BokChii
GITHUB_REPO=freshmilk
GITHUB_BRANCH=master
```

`GITHUB_SLACK_WEBHOOK_URL`을 설정하면 GitHub push/PR 알림은 이 webhook으로 전송됩니다. 예를 들어 `#github` 채널용 Incoming Webhook URL을 넣으면 개발 이벤트만 `#github`에 올라갑니다. 값이 없으면 기존 `SLACK_WEBHOOK_URL`을 사용합니다.

## Slack Commands

All slash commands use the same Request URL:

```text
https://YOUR_DOMAIN/slack/commands
```

Commands:

```text
/daily
/daily-summary
/record
/ask
/action
```

Examples:

```text
/daily 어제: Slack agent 구현 / 오늘: GitHub 연동 / 막힌 것: 없음
```

```text
/record 고객사 A 미팅: 관리자 대시보드 문의. 결제 내역 CSV 다운로드를 MVP에 먼저 포함하기로 결정. 동신은 구현 범위 검토, 강산은 견적 정리.
```

```text
/ask 고객사 A 관련 액션 아이템 뭐야?
```

```text
/action 고객사 A
```

## GitHub Webhook

GitHub repository의 `Settings > Webhooks > Add webhook`에서 설정합니다.

```text
Payload URL: https://YOUR_DOMAIN/github/webhook
Content type: application/json
Secret: same value as GITHUB_WEBHOOK_SECRET
Events: Pushes, Pull requests
```

PR 요약을 사용하려면 GitHub webhook에서 `Pull requests` 이벤트가 켜져 있어야 합니다.

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md).
