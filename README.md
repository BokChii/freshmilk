# Freshmilk Jarvis

Slack에서 사용하는 사내 AI agent MVP입니다. 지금 단계에서는 `/daily` slash command를 받아 응답하는 최소 서버만 포함합니다.

## 로컬 실행

```powershell
Copy-Item .env.example .env
npm.cmd run dev
```

서버 확인:

```powershell
Invoke-RestMethod -Uri "http://localhost:3131/health"
```

로컬 slash command 테스트:

```powershell
Invoke-RestMethod `
  -Uri "http://localhost:3131/test/slack-command" `
  -Method Post `
  -ContentType "application/x-www-form-urlencoded; charset=utf-8" `
  -Body "command=/daily&user_name=bokchii&text=어제: Slack webhook 연결 / 오늘: slash command 연결 / 막힌 것: 없음"
```

## Slack 설정

Slack App의 `Slash Commands`에서 `/daily`를 만들고 Request URL에 아래 주소를 넣습니다.

```text
https://YOUR_TUNNEL_URL/slack/commands
```

같은 Request URL로 아래 명령어도 추가합니다.

```text
/daily-summary
/record
/ask
```

실제 Slack 요청을 받으려면 `.env`의 `SLACK_SIGNING_SECRET`에 Slack App의 `Basic Information > App Credentials > Signing Secret` 값을 넣어야 합니다.

AI 요약을 쓰려면 `.env`에 OpenAI API 키도 넣습니다.

```text
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.2
```

`OPENAI_API_KEY`가 없으면 `/daily-summary`는 AI 없이 기본 요약으로 동작합니다.

## 기록 입력 예시

```text
/record 고객사 A 미팅: 관리자 대시보드 문의. 결제 내역 CSV 다운로드를 MVP에 먼저 포함하기로 결정. 동신은 구현 범위 검토, 지훈은 견적 정리.
```

`/record`는 우선 텍스트 입력을 기준으로 동작합니다. 이후 Slack 파일 업로드, 회의 음성 전사, Google Docs 연동을 붙일 수 있습니다.

저장된 기록에 질문:

```text
/ask 고객사 A 관련 액션 아이템 뭐야?
```

## GitHub Webhook

GitHub repository의 `Settings > Webhooks > Add webhook`에서 아래처럼 설정합니다.

```text
Payload URL: https://YOUR_TUNNEL_URL/github/webhook
Content type: application/json
Secret: .env의 GITHUB_WEBHOOK_SECRET 값
Events: Just the push event 또는 Pull requests
```

GitHub 이벤트를 Slack에도 올리려면 `.env`에 `SLACK_WEBHOOK_URL`을 넣습니다.

```text
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

## 터널 실행

Slack은 로컬 PC의 `localhost`로 직접 요청할 수 없으므로, 개발 중에는 ngrok 또는 Cloudflare Tunnel 같은 HTTPS 터널이 필요합니다.

ngrok을 쓰는 경우:

```powershell
ngrok http 3131
```

ngrok이 보여주는 `https://...` 주소 뒤에 `/slack/commands`를 붙여 Slack의 Request URL에 입력합니다.
