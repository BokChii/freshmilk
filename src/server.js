import { createHmac, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

function loadEnvFile() {
  if (!existsSync(".env")) {
    return;
  }

  const lines = readFileSync(".env", "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const [key, ...valueParts] = trimmed.split("=");
    process.env[key] ||= valueParts.join("=");
  }
}

loadEnvFile();

const PORT = Number(process.env.PORT || 3131);
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.2";
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || "";
const STORAGE_ROOT = process.env.STORAGE_ROOT || ".";
const DATA_DIR = path.join(STORAGE_ROOT, "data");
const RECORDS_DIR = path.join(STORAGE_ROOT, "records");

function hasOpenAiApiKey() {
  return Boolean(
    OPENAI_API_KEY &&
    !OPENAI_API_KEY.includes("replace_with") &&
    OPENAI_API_KEY.startsWith("sk-")
  );
}

function hasConfiguredSecret(value) {
  return Boolean(value && !value.includes("replace_with"));
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);

  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function postSlackResponse(responseUrl, payload) {
  if (!responseUrl) {
    return;
  }

  const response = await fetch(responseUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Slack response_url error ${response.status}: ${errorText}`);
  }
}

async function postSlackWebhook(text) {
  if (!hasConfiguredSecret(SLACK_WEBHOOK_URL)) {
    return false;
  }

  const response = await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({ text })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Slack webhook error ${response.status}: ${errorText}`);
  }

  return true;
}

function sendText(res, statusCode, body) {
  res.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseFormBody(body) {
  const params = new URLSearchParams(body);
  return Object.fromEntries(params.entries());
}

function verifySlackRequest(req, rawBody) {
  if (
    !SLACK_SIGNING_SECRET ||
    SLACK_SIGNING_SECRET.includes("replace_with")
  ) {
    return process.env.NODE_ENV !== "production";
  }

  const timestamp = req.headers["x-slack-request-timestamp"];
  const slackSignature = req.headers["x-slack-signature"];

  if (!timestamp || !slackSignature) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 60 * 5) {
    return false;
  }

  const base = `v0:${timestamp}:${rawBody}`;
  const digest = createHmac("sha256", SLACK_SIGNING_SECRET)
    .update(base)
    .digest("hex");
  const expectedSignature = `v0=${digest}`;

  const expected = Buffer.from(expectedSignature);
  const actual = Buffer.from(String(slackSignature));

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function verifyGitHubRequest(req, rawBody) {
  if (!hasConfiguredSecret(GITHUB_WEBHOOK_SECRET)) {
    return process.env.NODE_ENV !== "production";
  }

  const signature = req.headers["x-hub-signature-256"];

  if (!signature) {
    return false;
  }

  const expected = `sha256=${createHmac("sha256", GITHUB_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(String(signature));

  return expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer);
}

function formatDailyResponse(text, userName) {
  const trimmed = text.trim();

  if (!trimmed) {
    return [
      "데일리 스크럼 내용을 같이 적어주세요.",
      "",
      "예시:",
      "/daily 어제: Slack 연동 / 오늘: GitHub 연동 / 막힌 것: 없음"
    ].join("\n");
  }

  return [
    `데일리 스크럼 기록 완료${userName ? `: ${userName}` : ""}`,
    "",
    trimmed
  ].join("\n");
}

function parseDailyText(text) {
  const normalized = text.replace(/\s*\/\s*/g, "\n");
  const fields = {
    yesterday: "",
    today: "",
    blockers: ""
  };

  const patterns = [
    ["yesterday", /(?:^|\n)\s*어제\s*:\s*([\s\S]*?)(?=\n\s*(?:오늘|막힌\s*것|블로커|blocker|blockers)\s*:|$)/i],
    ["today", /(?:^|\n)\s*오늘\s*:\s*([\s\S]*?)(?=\n\s*(?:어제|막힌\s*것|블로커|blocker|blockers)\s*:|$)/i],
    ["blockers", /(?:^|\n)\s*(?:막힌\s*것|블로커|blocker|blockers)\s*:\s*([\s\S]*?)(?=\n\s*(?:어제|오늘)\s*:|$)/i]
  ];

  for (const [key, pattern] of patterns) {
    const match = normalized.match(pattern);
    fields[key] = match?.[1]?.trim() || "";
  }

  return fields;
}

function normalizeEmptyField(value) {
  return value && value.trim() ? value.trim() : "미기재";
}

function todayKstDateString() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(new Date());
}

function slugifyTitle(title) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "record";
}

function splitRecordTitleAndBody(text) {
  const trimmed = text.trim();
  const lines = trimmed.split(/\r?\n/);
  const firstLine = lines[0] || "";

  if (firstLine.includes(":")) {
    const [prefix, ...rest] = firstLine.split(":");

    if (prefix.trim().length <= 40 && rest.join(":").trim()) {
      return {
        title: prefix.trim(),
        body: [rest.join(":").trim(), ...lines.slice(1)].join("\n").trim()
      };
    }
  }

  return {
    title: firstLine.slice(0, 40) || "회의 기록",
    body: trimmed
  };
}

function saveDailyScrum(payload) {
  mkdirSync(DATA_DIR, { recursive: true });

  const record = {
    type: "daily_scrum",
    created_at: new Date().toISOString(),
    team_id: payload.team_id || null,
    team_domain: payload.team_domain || null,
    channel_id: payload.channel_id || null,
    channel_name: payload.channel_name || null,
    user_id: payload.user_id || null,
    user_name: payload.user_name || null,
    text: payload.text || ""
  };

  appendFileSync(
    `${DATA_DIR}/daily-scrums.jsonl`,
    `${JSON.stringify(record)}\n`,
    "utf8"
  );
}

function saveRecord(payload, structuredText) {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(`${RECORDS_DIR}/meetings`, { recursive: true });

  const { title, body } = splitRecordTitleAndBody(payload.text || "");
  const date = todayKstDateString();
  const slug = slugifyTitle(title);
  const markdownPath = `${RECORDS_DIR}/meetings/${date}-${slug}.md`;

  const record = {
    type: "record",
    created_at: new Date().toISOString(),
    team_id: payload.team_id || null,
    team_domain: payload.team_domain || null,
    channel_id: payload.channel_id || null,
    channel_name: payload.channel_name || null,
    user_id: payload.user_id || null,
    user_name: payload.user_name || null,
    title,
    text: body,
    markdown_path: markdownPath
  };

  appendFileSync(
    `${DATA_DIR}/records.jsonl`,
    `${JSON.stringify(record)}\n`,
    "utf8"
  );

  const markdown = [
    `# ${title}`,
    "",
    `- Date: ${date}`,
    `- Author: ${payload.user_name || payload.user_id || "unknown"}`,
    `- Channel: ${payload.channel_name || payload.channel_id || "unknown"}`,
    "",
    "## Structured Record",
    "",
    structuredText,
    "",
    "## Raw Notes",
    "",
    body
  ].join("\n");

  writeFileSync(markdownPath, `${markdown}\n`, "utf8");

  return { title, markdownPath };
}

function saveDailySummaryMarkdown(records, summaryText) {
  mkdirSync(`${RECORDS_DIR}/daily`, { recursive: true });

  const date = todayKstDateString();
  const markdownPath = `${RECORDS_DIR}/daily/${date}.md`;
  const rawLogs = records
    .map((record) => {
      const user = record.user_name || record.user_id || "unknown";
      return `- ${user}: ${record.text}`;
    })
    .join("\n");

  const markdown = [
    `# Daily Scrum - ${date}`,
    "",
    "## Summary",
    "",
    summaryText,
    "",
    "## Raw Logs",
    "",
    rawLogs || "No records"
  ].join("\n");

  writeFileSync(markdownPath, `${markdown}\n`, "utf8");

  return markdownPath;
}

function formatGitHubPush(payload) {
  const repo = payload.repository?.full_name || payload.repository?.name || "unknown-repo";
  const branch = String(payload.ref || "").replace("refs/heads/", "") || "unknown-branch";
  const commits = payload.commits || [];
  const lines = [
    "*GitHub push 요약*",
    `• Repo: ${repo}`,
    `• Branch: ${branch}`,
    `• Commits: ${commits.length}`
  ];

  for (const commit of commits.slice(0, 5)) {
    const message = String(commit.message || "").split("\n")[0];
    const author = commit.author?.name || "unknown";
    lines.push(`• ${author}: ${message}`);
  }

  if (commits.length > 5) {
    lines.push(`• 외 ${commits.length - 5}개 커밋`);
  }

  return lines.join("\n");
}

function formatGitHubPullRequest(payload) {
  const action = payload.action || "unknown";
  const repo = payload.repository?.full_name || payload.repository?.name || "unknown-repo";
  const pr = payload.pull_request || {};
  const title = pr.title || "Untitled PR";
  const user = pr.user?.login || "unknown";
  const url = pr.html_url || "";

  return [
    "*GitHub PR 요약*",
    `• Action: ${action}`,
    `• Repo: ${repo}`,
    `• PR: #${pr.number || payload.number || "?"} ${title}`,
    `• Author: ${user}`,
    url ? `• URL: ${url}` : null
  ].filter(Boolean).join("\n");
}

function formatGitHubEvent(eventName, payload) {
  if (eventName === "push") {
    return formatGitHubPush(payload);
  }

  if (eventName === "pull_request") {
    return formatGitHubPullRequest(payload);
  }

  return [
    "*GitHub 이벤트 수신*",
    `• Event: ${eventName}`,
    `• Repo: ${payload.repository?.full_name || payload.repository?.name || "unknown-repo"}`
  ].join("\n");
}

function saveGitHubEvent(eventName, payload, summaryText) {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(`${RECORDS_DIR}/github`, { recursive: true });

  const repo = payload.repository?.full_name || payload.repository?.name || "unknown-repo";
  const date = todayKstDateString();
  const slug = slugifyTitle(`${eventName}-${repo}`);
  const markdownPath = `${RECORDS_DIR}/github/${date}-${slug}.md`;
  const record = {
    type: "github_event",
    created_at: new Date().toISOString(),
    event: eventName,
    repo,
    summary: summaryText,
    markdown_path: markdownPath
  };

  appendFileSync(
    `${DATA_DIR}/github-events.jsonl`,
    `${JSON.stringify(record)}\n`,
    "utf8"
  );

  const markdown = [
    `# GitHub ${eventName} - ${repo}`,
    "",
    `- Date: ${date}`,
    `- Event: ${eventName}`,
    `- Repo: ${repo}`,
    "",
    "## Summary",
    "",
    summaryText
  ].join("\n");

  writeFileSync(markdownPath, `${markdown}\n`, "utf8");

  return markdownPath;
}

function listMarkdownFiles(dir) {
  if (!existsSync(dir)) {
    return [];
  }

  const files = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = `${dir}/${entry.name}`;

    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

function readKnowledgeRecords() {
  const markdownRecords = listMarkdownFiles(RECORDS_DIR)
    .map((filePath) => ({
      filePath,
      updatedAt: statSync(filePath).mtimeMs,
      content: readFileSync(filePath, "utf8")
    }));
  const jsonlRecords = readJsonlKnowledgeRecords();

  return [...markdownRecords, ...jsonlRecords].sort((a, b) => b.updatedAt - a.updatedAt);
}

function readJsonlKnowledgeRecords() {
  const records = [];
  const files = [
    `${DATA_DIR}/records.jsonl`,
    `${DATA_DIR}/daily-scrums.jsonl`,
    `${DATA_DIR}/github-events.jsonl`
  ];

  for (const filePath of files) {
    if (!existsSync(filePath)) {
      continue;
    }

    const updatedAt = statSync(filePath).mtimeMs;
    const lines = readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);

    for (const [index, line] of lines.entries()) {
      try {
        const record = JSON.parse(line);
        records.push({
          filePath: `${filePath}#${index + 1}`,
          updatedAt,
          content: JSON.stringify(record, null, 2)
        });
      } catch {
        records.push({
          filePath: `${filePath}#${index + 1}`,
          updatedAt,
          content: line
        });
      }
    }
  }

  return records;
}

function scoreKnowledgeRecord(record, query) {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  const haystack = `${record.filePath}\n${record.content}`.toLowerCase();

  return terms.reduce((score, term) => {
    return score + (haystack.includes(term) ? 1 : 0);
  }, 0);
}

function findRelevantKnowledge(query, limit = 5) {
  const records = readKnowledgeRecords();
  const scored = records
    .map((record) => ({
      ...record,
      score: scoreKnowledgeRecord(record, query)
    }))
    .filter((record) => record.score > 0)
    .sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt);

  return (scored.length ? scored : records).slice(0, limit);
}

async function answerAskWithAi(query, contextRecords) {
  if (!hasOpenAiApiKey()) {
    return null;
  }

  const context = contextRecords
    .map((record) => [
      `FILE: ${record.filePath}`,
      record.content.slice(0, 4000)
    ].join("\n"))
    .join("\n\n---\n\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: [
        "You are Jarvis, an internal company knowledge assistant.",
        "Answer in Korean using only the provided company records.",
        "If the records do not contain enough information, say what is missing.",
        "Use Slack mrkdwn with short bullets."
      ].join("\n"),
      input: [
        `질문: ${query}`,
        "",
        "회사 기록:",
        context || "No records"
      ].join("\n"),
      max_output_tokens: 900
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return extractOpenAiText(data);
}

async function formatAskResponse(payload) {
  const query = (payload.text || "").trim();

  if (!query) {
    return {
      responseType: "ephemeral",
      text: [
        "질문을 같이 입력해주세요.",
        "",
        "예시:",
        "/ask 고객사 A 관련 액션 아이템 뭐야?"
      ].join("\n")
    };
  }

  const contextRecords = findRelevantKnowledge(query);

  if (!contextRecords.length) {
    return {
      responseType: "ephemeral",
      text: "아직 검색할 기록이 없습니다. 먼저 /daily-summary 또는 /record로 기록을 저장해주세요."
    };
  }

  try {
    const aiAnswer = await answerAskWithAi(query, contextRecords);

    if (aiAnswer) {
      return {
        responseType: "in_channel",
        text: [
          `*질문:* ${query}`,
          "",
          aiAnswer,
          "",
          "*참고 기록*",
          ...contextRecords.map((record) => `• ${record.filePath}`)
        ].join("\n")
      };
    }
  } catch (error) {
    console.error(error);
  }

  return {
    responseType: "in_channel",
    text: [
      "AI 답변 생성에 실패해서 관련 기록만 표시합니다.",
      "",
      "*참고 기록*",
      ...contextRecords.map((record) => `• ${record.filePath}`)
    ].join("\n")
  };
}

function readDailyScrums() {
  const filePath = `${DATA_DIR}/daily-scrums.jsonl`;

  if (!existsSync(filePath)) {
    return [];
  }

  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function isSameLocalDate(isoDate, reference = new Date()) {
  const date = new Date(isoDate);

  return date.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }) ===
    reference.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
}

function formatDailySummary(records) {
  if (!records.length) {
    return "오늘 기록된 데일리 스크럼이 아직 없습니다.";
  }

  const recordsByUser = new Map();

  for (const record of records) {
    const user = record.user_name || record.user_id || "unknown";
    const userRecords = recordsByUser.get(user) || [];
    userRecords.push(record);
    recordsByUser.set(user, userRecords);
  }

  const lines = [
    `*오늘의 데일리 스크럼 요약* (${records.length}건, ${recordsByUser.size}명)`,
    ""
  ];

  for (const [user, userRecords] of recordsByUser) {
    lines.push(`*${user}*`);

    for (const record of userRecords) {
      const parsed = parseDailyText(record.text);

      if (parsed.yesterday || parsed.today || parsed.blockers) {
        lines.push(`• 어제: ${normalizeEmptyField(parsed.yesterday)}`);
        lines.push(`• 오늘: ${normalizeEmptyField(parsed.today)}`);
        lines.push(`• 막힌 것: ${normalizeEmptyField(parsed.blockers)}`);
      } else {
        lines.push(`• ${record.text}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n").trim();
}

function formatDailyMemberUpdates(records) {
  if (!records.length) {
    return "";
  }

  const recordsByUser = new Map();

  for (const record of records) {
    const user = record.user_name || record.user_id || "unknown";
    const userRecords = recordsByUser.get(user) || [];
    userRecords.push(record);
    recordsByUser.set(user, userRecords);
  }

  const lines = ["*작업자별 스크럼*"];

  for (const [user, userRecords] of recordsByUser) {
    lines.push("");
    lines.push(`*${user}*`);

    for (const record of userRecords) {
      const parsed = parseDailyText(record.text);

      if (parsed.yesterday || parsed.today || parsed.blockers) {
        lines.push(`• 어제: ${normalizeEmptyField(parsed.yesterday)}`);
        lines.push(`• 오늘: ${normalizeEmptyField(parsed.today)}`);
        lines.push(`• 막힌 것: ${normalizeEmptyField(parsed.blockers)}`);
      } else {
        lines.push(`• ${record.text}`);
      }
    }
  }

  return lines.join("\n");
}

function formatDailyRecordsForAi(records) {
  return records
    .map((record) => {
      const user = record.user_name || record.user_id || "unknown";
      return `- ${user}: ${record.text}`;
    })
    .join("\n");
}

function extractOpenAiText(response) {
  if (response.output_text) {
    return response.output_text;
  }

  const chunks = [];

  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("\n").trim();
}

async function summarizeDailyScrumsWithAi(records) {
  if (!hasOpenAiApiKey() || !records.length) {
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: [
        "You are Jarvis, an internal company operations assistant.",
        "Summarize Korean daily scrum updates for a Slack channel.",
        "Be concise, factual, and action-oriented.",
        "Do not invent facts that are not in the records."
      ].join("\n"),
      input: [
        "아래 데일리 스크럼 기록을 한국어로 정리해줘.",
        "Slack mrkdwn 형식으로 출력해줘.",
        "제목과 섹션명은 *굵게* 표시하고, 각 항목은 • bullet로 작성해줘.",
        "한 bullet은 1줄로 짧게 작성해줘.",
        "가능하면 담당자 이름을 항목 앞에 붙여줘.",
        "작업자별 원문 스크럼은 이미 위에 별도로 표시되므로 반복하지 마.",
        "중복 기록은 하나로 합쳐서 요약해줘.",
        "",
        "출력 형식:",
        "*AI 요약*",
        "",
        "*오늘 할 일*",
        "• 담당자: ...",
        "",
        "*막힌 것*",
        "• 없으면 '없음'",
        "",
        "*확인할 액션*",
        "• 담당자: ...",
        "",
        "기록:",
        formatDailyRecordsForAi(records)
      ].join("\n"),
      max_output_tokens: 700
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return extractOpenAiText(data);
}

async function structureRecordWithAi(title, body) {
  if (!hasOpenAiApiKey()) {
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: [
        "You are Jarvis, an internal company operations assistant.",
        "Convert Korean meeting or work notes into a concise structured record.",
        "Use Slack mrkdwn.",
        "Do not invent facts."
      ].join("\n"),
      input: [
        `제목: ${title}`,
        "",
        "아래 메모를 한국어로 구조화해줘.",
        "",
        "출력 형식:",
        `*${title}*`,
        "",
        "*요약*",
        "• ...",
        "",
        "*결정사항*",
        "• 없으면 '없음'",
        "",
        "*액션 아이템*",
        "• 담당자: 할 일",
        "",
        "*리스크 / 확인 필요*",
        "• 없으면 '없음'",
        "",
        "메모:",
        body
      ].join("\n"),
      max_output_tokens: 900
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return extractOpenAiText(data);
}

async function formatRecordResponse(payload) {
  const text = (payload.text || "").trim();

  if (!text) {
    return {
      responseType: "ephemeral",
      text: [
        "기록할 내용을 같이 입력해주세요.",
        "",
        "예시:",
        "/record 고객사 A 미팅: 결제 내역 CSV 다운로드 요청. MVP에는 CSV부터 포함하기로 결정. 동신은 구현 범위 검토."
      ].join("\n")
    };
  }

  const { title, body } = splitRecordTitleAndBody(text);
  let structuredText;

  try {
    structuredText = await structureRecordWithAi(title, body);
  } catch (error) {
    console.error(error);
  }

  if (!structuredText) {
    structuredText = [
      `*${title}*`,
      "",
      "*요약*",
      `• ${body}`,
      "",
      "*결정사항*",
      "• 미기재",
      "",
      "*액션 아이템*",
      "• 미기재",
      "",
      "*리스크 / 확인 필요*",
      "• 미기재"
    ].join("\n");
  }

  const saved = saveRecord(payload, structuredText);

  return {
    responseType: "in_channel",
    text: [
      "기록 저장 완료",
      `파일: ${saved.markdownPath}`,
      "",
      structuredText
    ].join("\n")
  };
}

async function formatDailySummaryResponse(records) {
  if (!records.length) {
    return "오늘 기록된 데일리 스크럼이 아직 없습니다.";
  }

  try {
    const aiSummary = await summarizeDailyScrumsWithAi(records);

    if (aiSummary) {
      const text = [
        formatDailyMemberUpdates(records),
        "",
        aiSummary
      ].join("\n").trim();
      const markdownPath = saveDailySummaryMarkdown(records, text);

      return [
        text,
        "",
        `저장 위치: ${markdownPath}`
      ].join("\n");
    }
  } catch (error) {
    console.error(error);
    const text = [
      "AI 요약 생성에 실패해서 기본 요약으로 표시합니다.",
      "",
      formatDailySummary(records)
    ].join("\n");
    const markdownPath = saveDailySummaryMarkdown(records, text);

    return [
      text,
      "",
      `저장 위치: ${markdownPath}`
    ].join("\n");
  }

  const text = [
    "OPENAI_API_KEY가 설정되지 않아 기본 요약으로 표시합니다.",
    "",
    formatDailySummary(records)
  ].join("\n");
  const markdownPath = saveDailySummaryMarkdown(records, text);

  return [
    text,
    "",
    `저장 위치: ${markdownPath}`
  ].join("\n");
}

async function handleSlackCommand(req, res) {
  const rawBody = await readBody(req);

  if (!verifySlackRequest(req, rawBody)) {
    sendJson(res, 401, { error: "invalid_slack_signature" });
    return;
  }

  const payload = parseFormBody(rawBody);

  if (payload.command === "/daily-summary") {
    sendJson(res, 200, {
      response_type: "ephemeral",
      text: "오늘의 데일리 스크럼을 정리하고 있습니다. 완료되면 채널에 공개로 올릴게요."
    });

    queueMicrotask(async () => {
      try {
        const todayRecords = readDailyScrums().filter((record) =>
          isSameLocalDate(record.created_at)
        );
        const text = await formatDailySummaryResponse(todayRecords);

        await postSlackResponse(payload.response_url, {
          response_type: "in_channel",
          text
        });
      } catch (error) {
        console.error(error);
        await postSlackResponse(payload.response_url, {
          response_type: "ephemeral",
          text: "데일리 스크럼 요약 중 오류가 발생했습니다. 서버 로그를 확인해주세요."
        });
      }
    });
    return;
  }

  if (payload.command === "/record") {
    sendJson(res, 200, {
      response_type: "ephemeral",
      text: "기록을 정리하고 있습니다. 완료되면 채널에 공개로 올릴게요."
    });

    queueMicrotask(async () => {
      try {
        const result = await formatRecordResponse(payload);

        await postSlackResponse(payload.response_url, {
          response_type: result.responseType,
          text: result.text
        });
      } catch (error) {
        console.error(error);
        await postSlackResponse(payload.response_url, {
          response_type: "ephemeral",
          text: "기록 저장 중 오류가 발생했습니다. 서버 로그를 확인해주세요."
        });
      }
    });
    return;
  }

  if (payload.command === "/ask") {
    sendJson(res, 200, {
      response_type: "ephemeral",
      text: "저장된 기록을 검색하고 있습니다. 완료되면 채널에 공개로 올릴게요."
    });

    queueMicrotask(async () => {
      try {
        const result = await formatAskResponse(payload);

        await postSlackResponse(payload.response_url, {
          response_type: result.responseType,
          text: result.text
        });
      } catch (error) {
        console.error(error);
        await postSlackResponse(payload.response_url, {
          response_type: "ephemeral",
          text: "기록 검색 중 오류가 발생했습니다. 서버 로그를 확인해주세요."
        });
      }
    });
    return;
  }

  if (payload.command !== "/daily") {
    sendJson(res, 200, {
      response_type: "ephemeral",
      text: `아직 지원하지 않는 명령어입니다: ${payload.command || "unknown"}`
    });
    return;
  }

  if ((payload.text || "").trim()) {
    saveDailyScrum(payload);
  }

  sendJson(res, 200, {
    response_type: (payload.text || "").trim() ? "in_channel" : "ephemeral",
    text: formatDailyResponse(payload.text || "", payload.user_name || "")
  });
}

async function handleLocalSlackCommandTest(req, res) {
  const rawBody = await readBody(req);
  const payload = parseFormBody(rawBody);

  if (payload.command === "/daily-summary") {
    const todayRecords = readDailyScrums().filter((record) =>
      isSameLocalDate(record.created_at)
    );

    sendJson(res, 200, {
      response_type: "in_channel",
      text: await formatDailySummaryResponse(todayRecords)
    });
    return;
  }

  if (payload.command === "/record") {
    const result = await formatRecordResponse(payload);

    sendJson(res, 200, {
      response_type: result.responseType,
      text: result.text
    });
    return;
  }

  if (payload.command === "/ask") {
    const result = await formatAskResponse(payload);

    sendJson(res, 200, {
      response_type: result.responseType,
      text: result.text
    });
    return;
  }

  const hasText = Boolean((payload.text || "").trim());

  if (hasText) {
    saveDailyScrum(payload);
  }

  sendJson(res, 200, {
    response_type: hasText ? "in_channel" : "ephemeral",
    text: formatDailyResponse(payload.text || "", payload.user_name || "local-test")
  });
}

async function handleGitHubWebhook(req, res) {
  const rawBody = await readBody(req);

  if (!verifyGitHubRequest(req, rawBody)) {
    sendJson(res, 401, { error: "invalid_github_signature" });
    return;
  }

  const eventName = String(req.headers["x-github-event"] || "unknown");
  const payload = JSON.parse(rawBody || "{}");
  const summaryText = formatGitHubEvent(eventName, payload);
  const markdownPath = saveGitHubEvent(eventName, payload, summaryText);
  const posted = await postSlackWebhook([
    summaryText,
    "",
    `저장 위치: ${markdownPath}`
  ].join("\n"));

  sendJson(res, 200, {
    ok: true,
    event: eventName,
    posted_to_slack: posted,
    markdown_path: markdownPath
  });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true, service: "freshmilk-jarvis" });
      return;
    }

    if (req.method === "POST" && url.pathname === "/slack/commands") {
      await handleSlackCommand(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/test/slack-command") {
      await handleLocalSlackCommandTest(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/github/webhook") {
      await handleGitHubWebhook(req, res);
      return;
    }

    sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "internal_server_error" });
  }
});

server.listen(PORT, () => {
  console.log(`Jarvis server listening on http://localhost:${PORT}`);
});
