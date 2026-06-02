# Freshmilk Jarvis

Slack 중심으로 동작하는 사내 AI agent MVP입니다.

## Features

- `/daily`: 데일리 스크럼 기록
- `/daily-summary`: 작업자별 스크럼과 AI 요약 생성
- `/record`: 회의/고객사/업무 메모 구조화 저장
- `/ask`: 저장된 기록에 질문
- GitHub webhook: push/PR 이벤트 Slack 요약
- Markdown export: `records/` 아래에 daily, meetings, github 기록 저장

## Local Run

```powershell
Copy-Item .env.example .env
npm.cmd run dev
```

Health check:

```powershell
Invoke-RestMethod -Uri "http://localhost:3131/health"
```

## Environment

```text
PORT=3131
STORAGE_ROOT=.
SLACK_SIGNING_SECRET=replace_with_slack_signing_secret
OPENAI_API_KEY=replace_with_openai_api_key
OPENAI_MODEL=gpt-5.2
GITHUB_WEBHOOK_SECRET=replace_with_github_webhook_secret
SLACK_WEBHOOK_URL=replace_with_slack_incoming_webhook_url
```

`STORAGE_ROOT` controls where `data/` and `records/` are written. For local development, keep it as `.`. For deployment with a persistent disk, set it to the mounted path such as `/data`.

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

## GitHub Webhook

GitHub repository의 `Settings > Webhooks > Add webhook`에서 설정합니다.

```text
Payload URL: https://YOUR_DOMAIN/github/webhook
Content type: application/json
Secret: same value as GITHUB_WEBHOOK_SECRET
Events: Pushes, Pull requests
```

GitHub 이벤트를 Slack에 올리려면 `SLACK_WEBHOOK_URL`을 설정합니다.

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md).
