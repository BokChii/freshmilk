# Koyeb Free Deployment

Koyeb의 무료 Web Service를 사용해 Jarvis를 배포하는 절차입니다.

## Why Koyeb

- 무료 Web Service 1개를 사용할 수 있습니다.
- GitHub repository에서 Dockerfile 기반으로 배포할 수 있습니다.
- HTTPS public domain이 자동으로 제공됩니다.
- Slack slash command와 GitHub webhook을 받을 수 있는 long-running Node service에 적합합니다.

## 1. Create Service

1. Koyeb dashboard에 로그인합니다.
2. `Create Service`를 선택합니다.
3. Source는 GitHub를 선택합니다.
4. Repository는 `BokChii/freshmilk`를 선택합니다.
5. Branch는 `master`를 선택합니다.
6. Builder는 Dockerfile을 선택합니다.
7. Instance는 `Free`를 선택합니다.

## 2. Environment Variables

Koyeb Service 설정에서 아래 환경변수를 추가합니다.

```text
NODE_ENV=production
PORT=3131
STORAGE_ROOT=.
SLACK_SIGNING_SECRET=...
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.2
GITHUB_WEBHOOK_SECRET=...
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

주의:

- `SLACK_SIGNING_SECRET`은 Slack App의 `Basic Information > App Credentials > Signing Secret` 값입니다.
- `GITHUB_WEBHOOK_SECRET`은 GitHub webhook 설정의 Secret과 같아야 합니다.
- `SLACK_WEBHOOK_URL`은 Slack Incoming Webhook URL입니다.
- 비밀값은 GitHub에 커밋하지 말고 Koyeb 환경변수로만 넣습니다.

## 3. Health Check

배포 후 Koyeb public domain에서 아래 주소를 확인합니다.

```text
https://YOUR_KOYEB_DOMAIN/health
```

정상 응답:

```json
{"ok":true,"service":"freshmilk-jarvis"}
```

## 4. Update Slack URLs

Slack App의 slash command Request URL을 모두 Koyeb domain으로 바꿉니다.

```text
https://YOUR_KOYEB_DOMAIN/slack/commands
```

대상 명령어:

```text
/daily
/daily-summary
/record
/ask
```

## 5. Update GitHub Webhook

GitHub repository의 webhook Payload URL을 Koyeb domain으로 바꿉니다.

```text
https://YOUR_KOYEB_DOMAIN/github/webhook
```

Content type:

```text
application/json
```

Secret:

```text
same value as GITHUB_WEBHOOK_SECRET
```

## Current Limitation

무료 인스턴스의 파일 저장은 운영 중에는 동작하지만, 재배포/재시작 시 장기 보존을 보장하기 어렵습니다. 장기 운영 단계에서는 Postgres나 외부 저장소로 이전하는 것이 좋습니다.
