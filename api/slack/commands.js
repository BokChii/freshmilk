import { waitUntil } from "@vercel/functions";
import {
  answerAskWithAi,
  extractActionsWithAi,
  formatBasicDailySummary,
  formatDailyMemberUpdates,
  formatGitHubEventsForDaily,
  formatDailyResponse,
  getConfig,
  isSameKstDate,
  parseFormBody,
  postSlackResponse,
  readDailyScrumsFromGitHub,
  readGitHubEventsFromGitHub,
  readGitHubKnowledge,
  readRawBody,
  saveDailyScrumToGitHub,
  saveDailySummaryToGitHub,
  saveRecordToGitHub,
  splitRecordTitleAndBody,
  structureRecordWithAi,
  summarizeDailyWithAi,
  verifySlackRequest
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

  if (!verifySlackRequest(req.headers, rawBody, appConfig)) {
    res.status(401).json({ error: "invalid_slack_signature" });
    return;
  }

  const payload = parseFormBody(rawBody);

  if (payload.command === "/daily") {
    const hasText = Boolean((payload.text || "").trim());

    if (hasText) {
      waitUntil(saveDailyScrumToGitHub(payload, appConfig));
    }

    res.status(200).json({
      response_type: hasText ? "in_channel" : "ephemeral",
      text: formatDailyResponse(payload.text || "", payload.user_name || "")
    });
    return;
  }

  if (payload.command === "/daily-summary") {
    res.status(200).json({
      response_type: "ephemeral",
      text: "오늘의 데일리 스크럼을 정리하고 있습니다. 완료되면 채널에 공개로 올릴게요."
    });
    waitUntil(handleDailySummary(payload, appConfig));
    return;
  }

  if (payload.command === "/record") {
    res.status(200).json({
      response_type: "ephemeral",
      text: "기록을 정리하고 있습니다. 완료되면 채널에 공개로 올릴게요."
    });
    waitUntil(handleRecord(payload, appConfig));
    return;
  }

  if (payload.command === "/ask") {
    res.status(200).json({
      response_type: "ephemeral",
      text: "저장된 기록을 검색하고 있습니다. 완료되면 채널에 공개로 올릴게요."
    });
    waitUntil(handleAsk(payload, appConfig));
    return;
  }

  if (payload.command === "/action") {
    res.status(200).json({
      response_type: "ephemeral",
      text: "저장된 기록에서 액션 아이템을 정리하고 있습니다. 완료되면 채널에 공개로 올릴게요."
    });
    waitUntil(handleAction(payload, appConfig));
    return;
  }

  res.status(200).json({
    response_type: "ephemeral",
    text: `아직 지원하지 않는 명령어입니다: ${payload.command || "unknown"}`
  });
}

async function handleDailySummary(payload, config) {
  try {
    const todayRecords = (await readDailyScrumsFromGitHub(config)).filter((record) =>
      isSameKstDate(record.created_at)
    );

    let text;

    if (!todayRecords.length) {
      text = "오늘 기록된 데일리 스크럼이 아직 없습니다.";
    } else {
      const todayGitHubEvents = await readGitHubEventsFromGitHub(config);
      const githubSection = formatGitHubEventsForDaily(todayGitHubEvents);
      const aiSummary = await summarizeDailyWithAi(todayRecords, config);
      text = aiSummary
        ? [formatDailyMemberUpdates(todayRecords), githubSection, aiSummary].filter(Boolean).join("\n\n").trim()
        : [formatBasicDailySummary(todayRecords), githubSection].filter(Boolean).join("\n\n").trim();
      const markdownPath = await saveDailySummaryToGitHub(todayRecords, text, config);
      text = [text, "", `저장 위치: ${markdownPath}`].join("\n");
    }

    await postSlackResponse(payload.response_url, {
      response_type: "in_channel",
      text
    });
  } catch (error) {
    console.error(error);
    await postSlackResponse(payload.response_url, {
      response_type: "ephemeral",
      text: "데일리 스크럼 요약 중 오류가 발생했습니다. Vercel 로그를 확인해주세요."
    });
  }
}

async function handleRecord(payload, config) {
  try {
    const text = (payload.text || "").trim();

    if (!text) {
      await postSlackResponse(payload.response_url, {
        response_type: "ephemeral",
        text: [
          "기록할 내용을 같이 입력해주세요.",
          "",
          "예시:",
          "/record 고객사 A 미팅: 결제 내역 CSV 다운로드 요청. 동신은 구현 범위 검토."
        ].join("\n")
      });
      return;
    }

    const { title, body } = splitRecordTitleAndBody(text);
    const structuredText = await structureRecordWithAi(title, body, config) || [
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
    const saved = await saveRecordToGitHub(payload, structuredText, config);

    await postSlackResponse(payload.response_url, {
      response_type: "in_channel",
      text: ["기록 저장 완료", `파일: ${saved.markdownPath}`, "", structuredText].join("\n")
    });
  } catch (error) {
    console.error(error);
    await postSlackResponse(payload.response_url, {
      response_type: "ephemeral",
      text: "기록 저장 중 오류가 발생했습니다. Vercel 로그를 확인해주세요."
    });
  }
}

async function handleAsk(payload, config) {
  try {
    const query = (payload.text || "").trim();

    if (!query) {
      await postSlackResponse(payload.response_url, {
        response_type: "ephemeral",
        text: ["질문을 같이 입력해주세요.", "", "예시:", "/ask 고객사 A 관련 액션 아이템 뭐야?"].join("\n")
      });
      return;
    }

    const contextRecords = await readGitHubKnowledge(query, 5, config);

    if (!contextRecords.length) {
      await postSlackResponse(payload.response_url, {
        response_type: "ephemeral",
        text: "아직 검색할 기록이 없습니다. 먼저 /daily-summary 또는 /record로 기록을 저장해주세요."
      });
      return;
    }

    const aiAnswer = await answerAskWithAi(query, contextRecords, config);
    const text = aiAnswer
      ? [`*질문:* ${query}`, "", aiAnswer, "", "*참고 기록*", ...contextRecords.map((record) => `• ${record.filePath}`)].join("\n")
      : ["AI 답변 생성에 실패해서 관련 기록만 표시합니다.", "", "*참고 기록*", ...contextRecords.map((record) => `• ${record.filePath}`)].join("\n");

    await postSlackResponse(payload.response_url, {
      response_type: "in_channel",
      text
    });
  } catch (error) {
    console.error(error);
    await postSlackResponse(payload.response_url, {
      response_type: "ephemeral",
      text: "기록 검색 중 오류가 발생했습니다. Vercel 로그를 확인해주세요."
    });
  }
}

async function handleAction(payload, config) {
  try {
    const query = (payload.text || "").trim();
    const contextRecords = await readGitHubKnowledge(query || "액션 할 일 막힌 것 확인 필요", 8, config);

    if (!contextRecords.length) {
      await postSlackResponse(payload.response_url, {
        response_type: "ephemeral",
        text: "아직 액션 아이템을 추출할 기록이 없습니다. 먼저 /daily-summary 또는 /record로 기록을 저장해주세요."
      });
      return;
    }

    const aiActions = await extractActionsWithAi(query, contextRecords, config);
    const actionText = aiActions || [
      "*액션 아이템*",
      "",
      "AI 액션 추출에 실패해서 관련 기록만 표시합니다.",
      "",
      "*참고 기록*",
      ...contextRecords.map((record) => `• ${record.filePath}`)
    ].join("\n");
    await postSlackResponse(payload.response_url, {
      response_type: "in_channel",
      text: [
        query ? `*범위:* ${query}` : "*범위:* 전체 최신 기록",
        "",
        actionText,
        "",
        "*참고 기록*",
        ...contextRecords.map((record) => `• ${record.filePath}`)
      ].join("\n")
    });
  } catch (error) {
    console.error(error);
    await postSlackResponse(payload.response_url, {
      response_type: "ephemeral",
      text: "액션 아이템 정리 중 오류가 발생했습니다. Vercel 로그를 확인해주세요."
    });
  }
}
