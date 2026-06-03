import { createHmac, timingSafeEqual } from "node:crypto";

const JARVIS_COMMIT_PREFIX = "chore(jarvis):";

export function getConfig() {
  return {
    slackSigningSecret: process.env.SLACK_SIGNING_SECRET || "",
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    openaiModel: process.env.OPENAI_MODEL || "gpt-5.2",
    githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET || "",
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL || "",
    githubToken: process.env.GITHUB_TOKEN || "",
    githubOwner: process.env.GITHUB_OWNER || "BokChii",
    githubRepo: process.env.GITHUB_REPO || "freshmilk",
    githubBranch: process.env.GITHUB_BRANCH || "master"
  };
}

export async function readRawBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

export function parseFormBody(body) {
  return Object.fromEntries(new URLSearchParams(body).entries());
}

export function hasConfiguredSecret(value) {
  return Boolean(value && !value.includes("replace_with"));
}

export function hasOpenAiApiKey(config = getConfig()) {
  return Boolean(
    config.openaiApiKey &&
    !config.openaiApiKey.includes("replace_with") &&
    config.openaiApiKey.startsWith("sk-")
  );
}

export function verifySlackRequest(headers, rawBody, config = getConfig()) {
  if (!hasConfiguredSecret(config.slackSigningSecret)) {
    return process.env.NODE_ENV !== "production";
  }

  const timestamp = headers["x-slack-request-timestamp"];
  const slackSignature = headers["x-slack-signature"];

  if (!timestamp || !slackSignature) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 60 * 5) {
    return false;
  }

  const base = `v0:${timestamp}:${rawBody}`;
  const expectedSignature = `v0=${createHmac("sha256", config.slackSigningSecret)
    .update(base)
    .digest("hex")}`;

  return timingSafeEqualString(expectedSignature, String(slackSignature));
}

export function verifyGitHubRequest(headers, rawBody, config = getConfig()) {
  if (!hasConfiguredSecret(config.githubWebhookSecret)) {
    return process.env.NODE_ENV !== "production";
  }

  const signature = headers["x-hub-signature-256"];

  if (!signature) {
    return false;
  }

  const expected = `sha256=${createHmac("sha256", config.githubWebhookSecret)
    .update(rawBody)
    .digest("hex")}`;

  return timingSafeEqualString(expected, String(signature));
}

function timingSafeEqualString(expected, actual) {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);

  return expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer);
}

export function todayKstDateString() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

export function slugifyTitle(title) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "record";
}

export function splitRecordTitleAndBody(text) {
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

export function parseDailyText(text) {
  const normalized = text.replace(/\s*\/\s*/g, "\n");
  const fields = { yesterday: "", today: "", blockers: "" };
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

function normalizeEmpty(value) {
  return value && value.trim() ? value.trim() : "미기재";
}

export function formatDailyResponse(text, userName) {
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

export function formatDailyMemberUpdates(records) {
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
    lines.push("", `*${user}*`);

    for (const record of userRecords) {
      const parsed = parseDailyText(record.text);

      if (parsed.yesterday || parsed.today || parsed.blockers) {
        lines.push(`• 어제: ${normalizeEmpty(parsed.yesterday)}`);
        lines.push(`• 오늘: ${normalizeEmpty(parsed.today)}`);
        lines.push(`• 막힌 것: ${normalizeEmpty(parsed.blockers)}`);
      } else {
        lines.push(`• ${record.text}`);
      }
    }
  }

  return lines.join("\n");
}

export function formatBasicDailySummary(records) {
  if (!records.length) {
    return "오늘 기록된 데일리 스크럼이 아직 없습니다.";
  }

  return [
    `*오늘의 데일리 스크럼 요약* (${records.length}건)`,
    "",
    formatDailyMemberUpdates(records)
  ].join("\n");
}

export function isSameKstDate(isoDate, reference = new Date()) {
  const date = new Date(isoDate);
  return date.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }) ===
    reference.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
}

export async function postSlackResponse(responseUrl, payload) {
  if (!responseUrl) {
    return;
  }

  const response = await fetch(responseUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Slack response_url error ${response.status}: ${await response.text()}`);
  }
}

export async function postSlackWebhook(text, config = getConfig()) {
  if (!hasConfiguredSecret(config.slackWebhookUrl)) {
    return false;
  }

  const response = await fetch(config.slackWebhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ text })
  });

  if (!response.ok) {
    throw new Error(`Slack webhook error ${response.status}: ${await response.text()}`);
  }

  return true;
}

async function githubRequest(path, options = {}, config = getConfig()) {
  if (!hasConfiguredSecret(config.githubToken)) {
    throw new Error("GITHUB_TOKEN is required for GitHub-backed storage.");
  }

  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      "accept": "application/vnd.github+json",
      "authorization": `Bearer ${config.githubToken}`,
      "content-type": "application/json",
      "user-agent": "freshmilk-jarvis",
      "x-github-api-version": "2022-11-28",
      ...(options.headers || {})
    }
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`GitHub API error ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

function repoPath(config = getConfig()) {
  return `/repos/${config.githubOwner}/${config.githubRepo}`;
}

export async function getGitHubFile(filePath, config = getConfig()) {
  const data = await githubRequest(
    `${repoPath(config)}/contents/${encodeURIComponentPath(filePath)}?ref=${encodeURIComponent(config.githubBranch)}`,
    {},
    config
  );

  if (!data) {
    return null;
  }

  return {
    sha: data.sha,
    content: Buffer.from(data.content || "", "base64").toString("utf8")
  };
}

export async function putGitHubFile(filePath, content, message, config = getConfig()) {
  const current = await getGitHubFile(filePath, config);

  await githubRequest(
    `${repoPath(config)}/contents/${encodeURIComponentPath(filePath)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        message: `${JARVIS_COMMIT_PREFIX} ${message}`,
        content: Buffer.from(content, "utf8").toString("base64"),
        branch: config.githubBranch,
        ...(current?.sha ? { sha: current.sha } : {})
      })
    },
    config
  );

  return filePath;
}

export async function appendGitHubJsonl(filePath, record, message, config = getConfig()) {
  const current = await getGitHubFile(filePath, config);
  const nextContent = `${current?.content || ""}${JSON.stringify(record)}\n`;
  await putGitHubFile(filePath, nextContent, message, config);
  return filePath;
}

export async function listGitHubKnowledgeFiles(config = getConfig()) {
  const tree = await githubRequest(
    `${repoPath(config)}/git/trees/${encodeURIComponent(config.githubBranch)}?recursive=1`,
    {},
    config
  );

  if (!tree?.tree) {
    return [];
  }

  return tree.tree
    .filter((item) => item.type === "blob")
    .map((item) => item.path)
    .filter((filePath) =>
      filePath.endsWith(".md") && filePath.startsWith("records/") ||
      filePath.endsWith(".jsonl") && filePath.startsWith("data/")
    );
}

export async function readGitHubKnowledge(query, limit = 5, config = getConfig()) {
  const paths = await listGitHubKnowledgeFiles(config);
  const records = [];

  for (const filePath of paths) {
    const file = await getGitHubFile(filePath, config);

    if (file?.content) {
      records.push({ filePath, content: file.content, score: scoreKnowledge(filePath, file.content, query) });
    }
  }

  const scored = records
    .filter((record) => record.score > 0)
    .sort((a, b) => b.score - a.score);

  return (scored.length ? scored : records).slice(0, limit);
}

function scoreKnowledge(filePath, content, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = `${filePath}\n${content}`.toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function encodeURIComponentPath(filePath) {
  return filePath.split("/").map(encodeURIComponent).join("/");
}

export async function readDailyScrumsFromGitHub(config = getConfig()) {
  const file = await getGitHubFile("data/daily-scrums.jsonl", config);

  if (!file?.content) {
    return [];
  }

  return file.content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function readGitHubEventsFromGitHub(config = getConfig()) {
  const file = await getGitHubFile("data/github-events.jsonl", config);

  if (!file?.content) {
    return [];
  }

  return file.content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function saveDailyScrumToGitHub(payload, config = getConfig()) {
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

  return appendGitHubJsonl("data/daily-scrums.jsonl", record, "append daily scrum", config);
}

export async function saveDailySummaryToGitHub(records, summaryText, config = getConfig()) {
  const date = todayKstDateString();
  const rawLogs = records
    .map((record) => `- ${record.user_name || record.user_id || "unknown"}: ${record.text}`)
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

  return putGitHubFile(`records/daily/${date}.md`, `${markdown}\n`, "write daily summary", config);
}

export async function saveRecordToGitHub(payload, structuredText, config = getConfig()) {
  const { title, body } = splitRecordTitleAndBody(payload.text || "");
  const date = todayKstDateString();
  const markdownPath = `records/meetings/${date}-${slugifyTitle(title)}.md`;
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

  await appendGitHubJsonl("data/records.jsonl", record, "append record", config);
  await putGitHubFile(markdownPath, `${markdown}\n`, "write meeting record", config);

  return { title, markdownPath };
}

export function shouldIgnoreGitHubPush(payload) {
  const message = payload.head_commit?.message || "";
  return message.startsWith(JARVIS_COMMIT_PREFIX);
}

export function formatGitHubEvent(eventName, payload) {
  if (eventName === "push") {
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
      lines.push(`• ${commit.author?.name || "unknown"}: ${String(commit.message || "").split("\n")[0]}`);
    }

    return lines.join("\n");
  }

  if (eventName === "pull_request") {
    const pr = payload.pull_request || {};
    const action = payload.action || "unknown";
    const repo = payload.repository?.full_name || payload.repository?.name || "unknown-repo";
    const stateLabel = pr.merged ? "merged" : action;
    const base = pr.base?.ref || "unknown-base";
    const head = pr.head?.ref || "unknown-head";
    const lines = [
      "*GitHub PR 요약*",
      `• Status: ${stateLabel}`,
      `• Repo: ${repo}`,
      `• PR: #${pr.number || payload.number || "?"} ${pr.title || "Untitled PR"}`,
      `• Author: ${pr.user?.login || "unknown"}`,
      `• Branch: ${head} -> ${base}`,
      `• Changed files: ${pr.changed_files ?? "unknown"}`,
      `• Additions/Deletions: +${pr.additions ?? 0} / -${pr.deletions ?? 0}`
    ];

    if (pr.html_url) {
      lines.push(`• URL: ${pr.html_url}`);
    }

    if (pr.body) {
      const bodyPreview = pr.body.replace(/\s+/g, " ").trim().slice(0, 180);

      if (bodyPreview) {
        lines.push(`• Description: ${bodyPreview}`);
      }
    }

    if (pr.merged) {
      lines.push(`• Merged by: ${pr.merged_by?.login || "unknown"}`);
    }

    return lines.join("\n");
  }

  return [
    "*GitHub 이벤트 수신*",
    `• Event: ${eventName}`,
    `• Repo: ${payload.repository?.full_name || payload.repository?.name || "unknown-repo"}`
  ].join("\n");
}

export function formatGitHubEventsForDaily(events) {
  const todayEvents = events.filter((event) => isSameKstDate(event.created_at));

  if (!todayEvents.length) {
    return "";
  }

  const lines = ["*오늘의 GitHub 작업*"];

  for (const event of todayEvents.slice(-10)) {
    if (event.event === "push") {
      lines.push(`• push: ${event.repo} (${event.commit_count ?? "?"} commits)`);
      continue;
    }

    if (event.event === "pull_request") {
      const prLabel = event.pr_number ? `#${event.pr_number}` : "PR";
      const status = event.pr_merged ? "merged" : event.action || "updated";
      lines.push(`• PR ${status}: ${event.repo} ${prLabel} ${event.pr_title || ""}`.trim());
      continue;
    }

    lines.push(`• ${event.event}: ${event.repo}`);
  }

  return lines.join("\n");
}

function getGitHubEventStorageSlug(eventName, payload) {
  const repo = payload.repository?.full_name || payload.repository?.name || "unknown-repo";

  if (eventName === "pull_request") {
    const pr = payload.pull_request || {};
    const action = pr.merged ? "merged" : payload.action || "updated";
    return slugifyTitle(`${eventName}-${action}-${repo}-${pr.number || payload.number || "unknown"}`);
  }

  if (eventName === "push") {
    const headSha = payload.head_commit?.id || payload.after || new Date().toISOString();
    return slugifyTitle(`${eventName}-${repo}-${String(headSha).slice(0, 8)}`);
  }

  return slugifyTitle(`${eventName}-${repo}-${Date.now()}`);
}

function getGitHubEventMetadata(eventName, payload) {
  if (eventName === "push") {
    return {
      action: "push",
      branch: String(payload.ref || "").replace("refs/heads/", "") || null,
      commit_count: payload.commits?.length || 0,
      head_commit_message: payload.head_commit?.message || null,
      head_commit_author: payload.head_commit?.author?.name || null
    };
  }

  if (eventName === "pull_request") {
    const pr = payload.pull_request || {};
    return [
      ["action", payload.action || null],
      ["pr_number", pr.number || payload.number || null],
      ["pr_title", pr.title || null],
      ["pr_author", pr.user?.login || null],
      ["pr_merged", Boolean(pr.merged)],
      ["pr_base", pr.base?.ref || null],
      ["pr_head", pr.head?.ref || null],
      ["changed_files", pr.changed_files ?? null],
      ["additions", pr.additions ?? null],
      ["deletions", pr.deletions ?? null],
      ["url", pr.html_url || null]
    ].reduce((metadata, [key, value]) => {
      metadata[key] = value;
      return metadata;
    }, {});
  }

  return {};
}

export async function saveGitHubEventToGitHub(eventName, payload, summaryText, config = getConfig()) {
  const repo = payload.repository?.full_name || payload.repository?.name || "unknown-repo";
  const date = todayKstDateString();
  const markdownPath = `records/github/${date}-${getGitHubEventStorageSlug(eventName, payload)}.md`;
  const record = {
    type: "github_event",
    created_at: new Date().toISOString(),
    event: eventName,
    repo,
    summary: summaryText,
    markdown_path: markdownPath,
    ...getGitHubEventMetadata(eventName, payload)
  };
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

  await appendGitHubJsonl("data/github-events.jsonl", record, "append github event", config);
  await putGitHubFile(markdownPath, `${markdown}\n`, "write github event", config);

  return markdownPath;
}

export async function callOpenAi(input, instructions, maxOutputTokens = 900, config = getConfig()) {
  if (!hasOpenAiApiKey(config)) {
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${config.openaiApiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: config.openaiModel,
      instructions,
      input,
      max_output_tokens: maxOutputTokens
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error ${response.status}: ${await response.text()}`);
  }

  return extractOpenAiText(await response.json());
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

export async function summarizeDailyWithAi(records, config = getConfig()) {
  const input = [
    "아래 데일리 스크럼 기록을 한국어 Slack mrkdwn 형식으로 정리해줘.",
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
    records.map((record) => `- ${record.user_name || record.user_id || "unknown"}: ${record.text}`).join("\n")
  ].join("\n");

  return callOpenAi(
    input,
    [
      "You are Jarvis, an internal company operations assistant.",
      "Summarize Korean daily scrum updates for a Slack channel.",
      "Be concise, factual, and action-oriented.",
      "Do not invent facts that are not in the records."
    ].join("\n"),
    700,
    config
  );
}

export async function structureRecordWithAi(title, body, config = getConfig()) {
  const input = [
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
  ].join("\n");

  return callOpenAi(
    input,
    [
      "You are Jarvis, an internal company operations assistant.",
      "Convert Korean meeting or work notes into a concise structured record.",
      "Use Slack mrkdwn.",
      "Do not invent facts."
    ].join("\n"),
    900,
    config
  );
}

export async function answerAskWithAi(query, contextRecords, config = getConfig()) {
  const context = contextRecords
    .map((record) => [`FILE: ${record.filePath}`, record.content.slice(0, 4000)].join("\n"))
    .join("\n\n---\n\n");

  return callOpenAi(
    [`질문: ${query}`, "", "회사 기록:", context || "No records"].join("\n"),
    [
      "You are Jarvis, an internal company knowledge assistant.",
      "Answer in Korean using only the provided company records.",
      "If the records do not contain enough information, say what is missing.",
      "Use Slack mrkdwn with short bullets."
    ].join("\n"),
    900,
    config
  );
}

export async function extractActionsWithAi(query, contextRecords, config = getConfig()) {
  const scope = query?.trim() || "전체 최신 기록";
  const context = contextRecords
    .map((record) => [`FILE: ${record.filePath}`, record.content.slice(0, 4000)].join("\n"))
    .join("\n\n---\n\n");

  return callOpenAi(
    [
      `범위: ${scope}`,
      "",
      "아래 회사 기록에서 실행해야 할 액션 아이템만 추출해줘.",
      "",
      "출력 형식:",
      "*액션 아이템*",
      "",
      "*담당자별*",
      "• 담당자: 할 일 (기한/출처가 있으면 포함)",
      "",
      "*막힌 것*",
      "• 없으면 '없음'",
      "",
      "*확인 필요*",
      "• 없으면 '없음'",
      "",
      "규칙:",
      "- 기록에 없는 담당자, 기한, 사실은 만들지 마.",
      "- 이미 완료된 일로 보이는 항목은 제외하거나 '완료 추정'으로 표시해.",
      "- Slack mrkdwn으로 짧고 선명하게 써.",
      "",
      "회사 기록:",
      context || "No records"
    ].join("\n"),
    [
      "You are Jarvis, an internal action-item tracking assistant.",
      "Extract only actionable work from Korean company records.",
      "Do not invent facts.",
      "Use concise Korean Slack mrkdwn."
    ].join("\n"),
    900,
    config
  );
}
