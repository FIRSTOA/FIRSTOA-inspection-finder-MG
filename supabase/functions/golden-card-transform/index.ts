const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const defaultCategories = ["매출증대/안정", "효율성", "비용절감", "자기개발", "소통", "AI"];
const defaultQuestions = [
  "지난 기간 나의 성과",
  "타인의 성과에 내가 기여한 것",
  "성장을 위한 학습·발견한 지식",
  "다음 도전을 위한 지원 요청",
];

function buildInstruction(quarterLabel: string, categories: string[], questions: string[]) {
  return [
    "너는 퍼스트전산 분기 골든미팅카드 작성 담당자야.",
    `아래 현재 분기 결과표/미션표/성장기록을 분석해서 ${quarterLabel} 골든미팅카드를 작성해줘.`,
    "이전 분기 골든미팅카드 예시가 있으면 같은 형식과 문체를 참고하되, 내용과 수치는 반드시 현재 분기 자료만 기준으로 작성한다.",
    "",
    "[출력 구조 - 매우 중요]",
    "질문 4개 × 카테고리 6개 = 총 24칸을 JSON으로만 출력한다. 설명, 코드블록, 추가 문장은 금지한다.",
    `질문 키는 반드시 이 문자열만 사용한다: ${JSON.stringify(questions)}`,
    `카테고리 키는 반드시 이 문자열만 사용한다: ${JSON.stringify(categories)}`,
    '형식: {"answers":{"지난 기간 나의 성과":{"매출증대/안정":"...","효율성":"..."}}}',
    '해당 카테고리에 근거 자료가 없으면 빈 문자열("")로 둔다. 억지로 만들지 않는다.',
    "",
    "[작성 원칙]",
    "1. 결과표의 수치, 건수, 달성률, 완료 여부를 반드시 반영한다. 수치를 임의로 바꾸지 않는다.",
    '2. 미달성도 숨기지 말고 "10/12회, 83%"처럼 정확히 쓰고 개선 방향을 함께 적는다.',
    '3. 초과달성은 "52/12건, 433%"처럼 분모와 분자를 같이 보여준다.',
    '4. 문체는 "~했습니다/완료했습니다/기여했습니다/깨달았습니다/향상시켰습니다"처럼 성실하고 진정성 있게 쓴다.',
    '5. q1 성과는 항목 번호를 사용한다. q2 기여는 "[○○을 하며 기여한 점]" 대괄호 제목 뒤에 겸손하게 쓴다.',
    '6. q3 학습은 "✅[○○을 통해 배운점]" 형식과 성찰형 문장을 사용한다.',
    "7. q4 지원 요청은 짧고 부담 없이, 개인 성장과 회사 기여 관점으로 작성한다.",
    "8. AI/자동화는 반복업무 감소, 병목 제거, 표준화, 전사 확산 관점으로 작성한다.",
    "9. 소통은 분위기, 동기부여, 학습 분위기, 협업 관점으로 작성한다.",
  ].join("\n");
}

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
    const quarterLabel = `${payload.year || ""}년 ${payload.quarter || ""}분기`;
    const instruction = buildInstruction(quarterLabel, categories, questions);

    const source = {
      year: payload.year,
      quarter: payload.quarter,
      author: payload.author,
      planText: payload.planText || "",
      missionText: payload.missionText || "",
      recordText: payload.recordText || "",
      currentAnswers: payload.currentAnswers || {},
      previousGoldenCard: {
        quarter: payload.exampleQuarter || "",
        text: payload.exampleText || "",
        answers: payload.exampleAnswers || {},
      },
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
