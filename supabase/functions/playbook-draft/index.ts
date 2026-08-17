/**
 * 족보 초안 생성 — 시리즈×증상 클러스터의 실제 처리 기록을 종합해 족보 카드 초안(JSON)을 만든다.
 * 요청: { brand, series, symptom, caseCount, cases: [{title, content}] (표본 ≤60건) }
 * 응답: { summary, causes: [{cause, share, steps[], parts[]}], tips, model }
 * 반검수 원칙: 이 함수는 초안만 만든다 — 게시는 사람이 웹앱에서 검토 후 누른다.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const INSTRUCTION = `당신은 복합기 A/S 20년차 팀장입니다. 아래는 특정 기종 시리즈 × 증상에 대한 우리 팀의 실제 현장 처리 기록 표본입니다.
이 기록만 근거로, 처음 나가는 신입도 그대로 따라 할 수 있는 "족보 카드"를 JSON으로 작성하세요.

형식:
{
  "summary": "이 증상의 한 줄 요약 (무엇이 문제고 보통 어떻게 끝나는지)",
  "causes": [
    { "cause": "원인/상황 이름 (짧게)", "share": "높음|보통|낮음", "steps": ["현장체 명령형 단계", ...], "parts": ["필요 부품/소모품", ...] }
  ],
  "tips": "기록에서 반복되는 실수·주의사항·꿀팁 (2~4줄, 줄바꿈 \\n)"
}

규칙:
- causes는 기록에서 실제로 많이 나온 순서로 3~6개. share는 대략적 빈도감.
- steps는 "확인→조치→검증" 흐름의 현장체 단문 (예: "급지롤러 상태 확인 — 마모·지분이면 교체").
- 기록에 없는 내용은 지어내지 말 것. 특정 모델에서만 해당하면 단계 안에 (3220 한정)처럼 명시.
- parts는 기록에 등장한 부품명만. 없으면 빈 배열.
- 전부 한국어, 존댓말 대신 간결한 현장체.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: jsonHeaders });
  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY") || "";
    if (!apiKey) return Response.json({ error: "OPENAI_API_KEY missing" }, { status: 500, headers: jsonHeaders });
    const body = await req.json().catch(() => ({}));
    const cases = Array.isArray(body.cases) ? body.cases.slice(0, 60) : [];
    if (!cases.length || !body.symptom) return Response.json({ error: "cases/symptom이 필요합니다" }, { status: 400, headers: jsonHeaders });
    const model = Deno.env.get("OPENAI_PLAYBOOK_MODEL") || "gpt-5.5";

    const source = {
      cluster: `${body.brand || ""} ${body.series || "(공통)"} × ${body.symptom}`,
      totalCases: Number(body.caseCount) || cases.length,
      sampleCases: cases.map((c: { title?: string; content?: string }) => ({
        title: String(c.title || "").slice(0, 120),
        content: String(c.content || "").slice(0, 600),
      })),
    };
    const openaiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        reasoning: { effort: "medium" },
        input: [
          { role: "system", content: INSTRUCTION },
          { role: "user", content: JSON.stringify(source) },
        ],
        text: { format: { type: "json_object" } },
      }),
    });
    if (!openaiRes.ok) {
      const detail = await openaiRes.text().catch(() => "");
      return Response.json({ error: detail.slice(0, 400), model }, { status: 502, headers: jsonHeaders });
    }
    const data = await openaiRes.json();
    const outputText = data.output_text
      || data.output?.flatMap((item: { content?: Array<{ text?: string }> }) => item.content || []).map((item: { text?: string }) => item.text || "").join("\n")
      || "";
    const parsed = JSON.parse(outputText || "{}");
    const causes = (Array.isArray(parsed.causes) ? parsed.causes : []).map((c: Record<string, unknown>) => ({
      cause: String(c.cause || "").slice(0, 120),
      share: ["높음", "보통", "낮음"].includes(String(c.share)) ? String(c.share) : "보통",
      steps: (Array.isArray(c.steps) ? c.steps : []).map((s: unknown) => String(s).slice(0, 300)).slice(0, 12),
      parts: (Array.isArray(c.parts) ? c.parts : []).map((p: unknown) => String(p).slice(0, 60)).slice(0, 8),
    })).slice(0, 6);
    return Response.json({
      summary: String(parsed.summary || "").slice(0, 300),
      causes,
      tips: String(parsed.tips || "").slice(0, 1000),
      model,
    }, { headers: jsonHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: jsonHeaders });
  }
});
