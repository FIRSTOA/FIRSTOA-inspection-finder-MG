// 분기결과표 AI 수치 정리 (2026-09-24)
// 목표별로 대략 적어 둔 결과 내용을 받아, 원문 설명은 살리고 아래에 [성과] 블록을 붙여
// 수치·날짜·횟수·시간·달성률 중심으로 다시 쓴다. 근거 없는 숫자는 만들지 않는다.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const EXAMPLE = `[IT 확장성 파악]
방문 거래처 대상 PC·유지보수·소프트웨어 등 IT 홍보
고객 PC 사용환경 및 IT 확장 가능성 파악
업체별 IT 관련 정보 및 PC DB 지속 축적

[성과]
→ 일 1회 기준 월 목표 20건 / 분기 목표 60건
→ 실제 50개 업체 진행 / 달성률 약 83%
→ 등급별 : SS 6 / S 16 / N 16 / NN 9 / V 3
→ SS·S 22개 업체 (44%)로 주요 확장 가능 거래처 파악
→ IT 홍보 및 DB 축적을 통해 견적·유지보수 등 추가 매출 연결 기반 확보

[복합기 기술력]
삼성 10건 : 현상기·센서·광학부·메인보드 등 교체/수리 실습
제록스 21건 : 전사벨트·현상기·정착기·IH보드·ADF 등 분해/PM/교체 실습
신도 6건 : 현상기·정착기·전사벨트·무선랜 설정 실습
소형기 8건 : 교세라 현상기·LSU·ADF 등 수리/교체 실습

[성과]
→ 7~9월 기술교육·실습 총 45건 / 1,120분 (18시간 40분)
→ 7월 : 16건 / 305분 (5시간 5분)
→ 8월 : 19건 / 405분 (6시간 45분)
→ 9월 : 10건 / 410분 (6시간 50분)
→ 월 평균 약 15건 / 373분 (6시간 13분)
→ 주 평균 약 2.2회 / 112분 (1시간 52분)
→ 실습일 총 22일 / 일 평균 약 51분
→ 주요 기종 분해·PM·부품교체 등 레벨2 실전 대응 범위 확대`;

function instruction(quarterLabel: string, months: number[]): string {
  return [
    "너는 퍼스트전산 CS팀의 분기 결과표 정리 담당자야.",
    `입력은 ${quarterLabel}(${months.join("·")}월) 목표별 결과 메모다. 목표마다 아래 두 부분으로 다시 써라.`,
    "",
    "[출력 규칙]",
    '순수 JSON 하나만: {"goals":[{"n":1,"text":"..."}]}. n은 입력 항목 번호 그대로, 빠뜨리지 말 것. 설명·코드블록·마크다운 금지.',
    "각 text의 모양:",
    "  1) 첫 줄: 대괄호 제목 [목표 핵심어] — 입력 title의 핵심 낱말로 짧게(예: [IT 확장성 파악]).",
    "  2) 이어서 원문 설명 줄들 — 입력 text에 적힌 활동·항목·건수 설명을 문장 정리만 하고 내용은 보존한다(월별로 적혀 있으면 월별 줄을 유지).",
    "  3) 빈 줄 하나, 그리고 '[성과]' 한 줄, 그 아래 '→ '로 시작하는 줄 4~10개.",
    "",
    "[성과 줄 작성 규칙 — 수치화]",
    "- 목표 문구의 계획 빈도(일 1회·주 1회·주 3회·월 1회·월 2회·매번 등)를 분기 총량으로 환산해 첫 줄에 쓴다: 일 1회 → 월 20건/분기 60건, 주 1회 → 분기 12회, 주 2회 → 24회, 주 3회 → 36회, 월 1회 → 3회, 월 2회 → 6회.",
    "- 실제 건수/횟수/시간을 합산하고 달성률(%)을 낸다. 월별(7·8·9월 같은 분기 월)로 나뉘어 있으면 월별 줄과 총계, 월 평균·주 평균(분기≈13주)·일 평균을 함께 쓴다.",
    "- 시간은 '405분 (6시간 45분)'처럼 분과 시간 병기. 금액은 원 단위 천 단위 콤마. 등급·기종·업체별 구분이 있으면 'SS 6 / S 16 / N 16'처럼 한 줄로.",
    "- 입력 text와 weeklyRecordsText(주간 기록)에 있는 숫자만 쓴다. 없는 숫자는 만들지 말고, 필요한데 없으면 '(횟수 기록 없음)'처럼 표시한다.",
    "- 마지막 줄 1개는 성과의 의미(무엇이 가능해졌는지)를 한 문장으로.",
    "- 문장은 짧게, 명사형/개조식. '~했습니다' 대신 '진행 / 확보 / 확대' 같은 명사형 어미.",
    "",
    "[예시 — 이 모양을 따른다]",
    EXAMPLE,
    "",
    "다시 강조: JSON 객체 하나만 출력한다.",
  ].join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: jsonHeaders });
  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return new Response(JSON.stringify({ error: "OPENAI_API_KEY missing" }), { status: 500, headers: jsonHeaders });
    const body = await req.json().catch(() => ({}));
    const year = Number(body.year) || new Date().getFullYear();
    const quarter = Math.min(4, Math.max(1, Number(body.quarter) || 1));
    const months = [1, 2, 3].map((m) => (quarter - 1) * 3 + m);
    const goals = Array.isArray(body.goals) ? body.goals.map((g: { n?: unknown; title?: unknown; text?: unknown }) => ({ n: Number(g.n) || 0, title: String(g.title || ""), text: String(g.text || "") })).filter((g: { n: number }) => g.n > 0) : [];
    if (!goals.length) return new Response(JSON.stringify({ error: "goals가 비어 있습니다" }), { status: 400, headers: jsonHeaders });
    const model = Deno.env.get("OPENAI_RESULT_MODEL") || Deno.env.get("OPENAI_GOLDEN_MODEL") || "gpt-5.5";
    const source = { quarter: `${year}년 ${quarter}분기`, months, author: body.author || "", goals, weeklyRecordsText: String(body.weeklyRecordsText || "").slice(0, 12000) };
    const openaiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        reasoning: { effort: "medium" },
        input: [
          { role: "system", content: instruction(`${year}년 ${quarter}분기`, months) },
          { role: "user", content: JSON.stringify(source, null, 2) },
        ],
        text: { format: { type: "json_object" } },
      }),
    });
    if (!openaiRes.ok) {
      const detail = await openaiRes.text().catch(() => "");
      return new Response(JSON.stringify({ error: detail.slice(0, 500), model }), { status: 502, headers: jsonHeaders });
    }
    const data = await openaiRes.json();
    const outputText = data.output_text
      || data.output?.flatMap((item: { content?: Array<{ text?: string }> }) => item.content || []).map((item: { text?: string }) => item.text || "").join("\n")
      || "";
    const parsed = JSON.parse(outputText || "{}");
    const out = Array.isArray(parsed.goals) ? parsed.goals.map((g: { n?: unknown; text?: unknown }) => ({ n: Number(g.n) || 0, text: String(g.text || "").trim() })).filter((g: { n: number; text: string }) => g.n > 0 && g.text) : [];
    return new Response(JSON.stringify({ goals: out, model }), { headers: jsonHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), { status: 500, headers: jsonHeaders });
  }
});
