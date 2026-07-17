const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const defaultCategories = ["매출증대/안정", "효율성", "비용절감", "자기개발", "소통", "AI"];
const defaultQuestions = ["지난 기간 나의 성과", "타인의 성과에 내가 기여한 것", "성장을 위한 학습·발견한 지식", "다음 도전을 위한 지원 요청"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = await req.json().catch(() => ({}));
    const categories = Array.isArray(payload.categories) && payload.categories.length ? payload.categories : defaultCategories;
    const questions = Array.isArray(payload.questions) && payload.questions.length ? payload.questions : defaultQuestions;
    const model = Deno.env.get("OPENAI_GOLDEN_MODEL") || "gpt-5.1";

    const instruction = `너는 FIRSTOA CS 직원의 골든미팅카드를 작성하는 업무 코치다.
선택된 최신 분기 자료만 기준으로 작성한다.
반드시 아래 질문과 카테고리 구조를 그대로 지키고 JSON만 반환한다.
수치화와 진행률 %를 반드시 포함한다.
근거가 부족한 항목은 지어내지 말고 "기록 보완 필요"라고 적는다.
문장은 짧고 명확하게 쓰고, 평가자가 근거를 바로 확인할 수 있게 작성한다.

반환 JSON 형식:
{"answers":{"질문":{"카테고리":"내용"}}}

질문 목록: ${JSON.stringify(questions)}
카테고리 목록: ${JSON.stringify(categories)}`;

    const source = {
      year: payload.year,
      quarter: payload.quarter,
      author: payload.author,
      planText: payload.planText || "",
      missionText: payload.missionText || "",
      recordText: payload.recordText || "",
      currentAnswers: payload.currentAnswers || {},
    };

    const openaiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: instruction },
          { role: "user", content: JSON.stringify(source, null, 2) },
        ],
        text: { format: { type: "json_object" } },
      }),
    });

    if (!openaiRes.ok) {
      const detail = await openaiRes.text().catch(() => "");
      return new Response(JSON.stringify({ error: detail.slice(0, 500), model }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await openaiRes.json();
    const outputText =
      data.output_text ||
      data.output?.flatMap((item: { content?: Array<{ text?: string }> }) => item.content || []).map((item: { text?: string }) => item.text || "").join("\n") ||
      "";
    const parsed = JSON.parse(outputText || "{}");
    return new Response(JSON.stringify({ answers: parsed.answers || {}, model }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
