import { waitUntil } from "@vercel/functions";
import {
  formatGitHubEvent,
  getConfig,
  postSlackWebhook,
  readRawBody,
  saveGitHubEventToGitHub,
  shouldIgnoreGitHubPush,
  verifyGitHubRequest
} from "../_lib/jarvis.js";

export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const rawBody = await readRawBody(req);
  const appConfig = getConfig();

  if (!verifyGitHubRequest(req.headers, rawBody, appConfig)) {
    res.status(401).json({ error: "invalid_github_signature" });
    return;
  }

  const eventName = String(req.headers["x-github-event"] || "unknown");
  const payload = JSON.parse(rawBody || "{}");

  if (eventName === "push" && shouldIgnoreGitHubPush(payload)) {
    res.status(200).json({ ok: true, ignored: true, reason: "jarvis_storage_commit" });
    return;
  }

  res.status(200).json({ ok: true, event: eventName });
  waitUntil(handleGitHubEvent(eventName, payload, appConfig));
}

async function handleGitHubEvent(eventName, payload, config) {
  try {
    const summaryText = formatGitHubEvent(eventName, payload);
    const markdownPath = await saveGitHubEventToGitHub(eventName, payload, summaryText, config);
    await postSlackWebhook([summaryText, "", `저장 위치: ${markdownPath}`].join("\n"), config);
  } catch (error) {
    console.error(error);
  }
}
