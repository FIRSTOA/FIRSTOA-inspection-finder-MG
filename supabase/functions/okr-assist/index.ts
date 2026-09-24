// OKR AI 보조 (2026-09-24)
// 세 가지 일을 한다. 근거 없는 숫자는 절대 만들지 않는다(없으면 "(수치 없음)"으로 표시).
//  - format  : 팀원이 대충 적은 실제결과 메모 → 작성가이드 양식 "항목 : n건 중 m건 (x%, 등급)" 줄 + 종합판정(가장 나쁜 등급) + 사유·개선계획·근거자료 초안
//  - merge   : 팀원 여러 명의 기록 → 파트 종합 한 칸(건수 합산, 이름은 근거자료에)
//  - feedback: 목표 하나에 대한 파트별 결과 → 팀장 피드백("1. 대상 / 2. 피드백 / 3. 다음 달 개선 방향")
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const GUIDE = [
  "[작성가이드 — 퍼스트전산 CS팀 OKR 실행결과]",
  "실제결과는 달성기준 항목마다 한 줄: '항목 이름 : n건 중 m건 (x%, 등급)'. 달성률 = 실제로 한 것 ÷ 해야 했던 것 × 100(소수 첫째 자리까지).",
  "[건수형] 기준은 했으면 100%, 안 했으면 0% — 중간이 없다. '완료' 같은 상태형 기준은 '완료 (100%, 완료)' 또는 '미완료 (0%, 미착수)'.",
  "등급 표: 완료=100% / 부분달성=80~99% / 미흡=1~79% / 미착수=0%(시작도 못 함) / 해당없음=대상이 처음부터 0건.",
  "종합판정 = 그 목표의 등급들 중 가장 나쁜 것 하나. 해당없음만 있으면 해당없음.",
  "종합판정이 완료·해당없음이 아니면 사유와 개선계획을 둘 다 쓴다.",
  "사유: 사람 탓이 아니라 방법 탓으로, 숫자를 넣어 '○○○ 때문에 ○건을 못 했습니다' 틀. 개선계획: '다음 달부터 ○○○ 하겠습니다' — 무엇을 바꿀지가 있어야 한다.",
  "근거자료: 실제결과에 적은 항목 이름을 그대로 쓰고 뒤에 실제 내용(업체명·건명·파일이 아닌 내용). '항목 이름 : 실제 내용' 줄. 해당없음이면 '대상 0건'.",
  "입력에 없는 숫자·업체명·날짜는 만들지 않는다. 필요한데 없으면 '(수치 없음)'이라고 쓴다. 문장은 짧게, 개조식(명사형 어미).",
].join("\n");

function instruction(mode: string): string {
  if (mode === "merge") return [
    "너는 CS팀 파트장이다. 팀원 여러 명이 같은 목표에 대해 각자 적은 실제결과·종합판정·사유·개선계획·근거자료를 받아 '파트 종합' 한 칸으로 합친다.",
    GUIDE,
    "[합치는 규칙] 같은 항목의 건수는 더한다(예: 3명이 2건·1건·0건 → '3건'). 분모도 더한다. 달성률은 합산값으로 다시 계산. 등급은 합산 달성률로 다시 매기고 종합판정은 그중 가장 나쁜 것.",
    "사유·개선계획은 팀원들이 쓴 것을 중복 없이 합쳐 2~5줄로. 근거자료에는 '항목 : 내용 (이름)'처럼 누구 건인지 이름을 괄호로 붙인다.",
    '출력: 순수 JSON 하나 {"actual":"...","judgment":"완료|부분달성|미흡|미착수|해당없음","reason":"...","plan":"...","evidence":"..."}. 설명·마크다운 금지.',
  ].join("\n");
  if (mode === "feedback") return [
    "너는 CS팀 팀장이다. 목표 하나에 대해 A~D 파트가 낸 실제결과·종합판정·사유·개선계획을 읽고 통합집계의 '미흡항목 피드백 & 다음 달 개선 방향' 칸을 쓴다.",
    GUIDE,
    "[피드백 규칙] 형식은 세 줄 묶음: '1. 대상: ○파트 미흡 / ○파트 미착수' → '2. 피드백:' 파트별로 무엇이 얼마나 부족했는지 숫자로(• 파트: …) → '3. 다음 달 개선 방향:' 파트들이 낸 개선계획을 바탕으로 팀 공통 실행 1~3개(• 로 시작).",
    "완료·해당없음만 있는 목표면 '1. 대상: 없음 — 전 파트 완료' 한 줄과 잘한 점 한 줄만. 책임 추궁 어투 금지, 방법 개선 어투.",
    '출력: 순수 JSON 하나 {"memo":"..."}. 설명·마크다운 금지.',
  ].join("\n");
  return [
    "너는 CS팀 팀원의 OKR 실행결과 작성을 도와주는 정리 담당자다. 목표·달성기준과 팀원이 대충 적은 메모를 받아 작성가이드 양식으로 다시 쓴다.",
    GUIDE,
    "[정리 규칙] 달성기준의 각 항목(• 줄) 순서대로 실제결과 한 줄씩. 메모에 그 항목 숫자가 없으면 '항목 : (수치 없음)'으로 남겨 사람이 채우게 한다. 메모에 있는 내용은 빠뜨리지 않는다.",
    "종합판정은 줄들의 등급 중 가장 나쁜 것((수치 없음) 줄은 판정에서 뺀다). 완료·해당없음이 아니면 사유·개선계획 초안을 메모 내용으로 쓴다(메모에 이유가 없으면 '(사유 입력 필요: 무엇 때문에 몇 건을 못 했는지)').",
    "근거자료는 메모에 있는 업체명·건명·수치를 '항목 : 내용' 줄로. 기존에 적힌 사유·개선계획·근거자료(reason/plan/evidence)가 있으면 그것을 다듬어 유지한다.",
    '출력: 순수 JSON 하나 {"actual":"...","judgment":"완료|부분달성|미흡|미착수|해당없음|","reason":"...","plan":"...","evidence":"..."}. 설명·마크다운 금지.',
  ].join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: jsonHeaders });
  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return new Response(JSON.stringify({ error: "OPENAI_API_KEY missing" }), { status: 500, headers: jsonHeaders });
    const body = await req.json().catch(() => ({}));
    const mode = ["format", "merge", "feedback"].includes(body.mode) ? String(body.mode) : "format";
    const goal = body.goal && typeof body.goal === "object" ? body.goal : {};
    const source: Record<string, unknown> = {
      month: String(body.month || ""),
      goal: { no: goal.no, pillar: String(goal.pillar || ""), objective: String(goal.objective || ""), criteria: String(goal.criteria || "") },
    };
    if (mode === "format") {
      source.memo = String(body.text || "").slice(0, 6000);
      source.existing = { reason: String(body.reason || ""), plan: String(body.plan || ""), evidence: String(body.evidence || "") };
      if (!String(body.text || "").trim()) return new Response(JSON.stringify({ error: "정리할 메모가 비어 있습니다" }), { status: 400, headers: jsonHeaders });
    } else if (mode === "merge") {
      source.members = Array.isArray(body.members) ? body.members.slice(0, 20) : [];
      if (!(source.members as unknown[]).length) return new Response(JSON.stringify({ error: "팀원 기록이 없습니다" }), { status: 400, headers: jsonHeaders });
    } else {
      source.teams = Array.isArray(body.teams) ? body.teams.slice(0, 8) : [];
      if (!(source.teams as unknown[]).length) return new Response(JSON.stringify({ error: "파트 결과가 없습니다" }), { status: 400, headers: jsonHeaders });
    }
    const model = Deno.env.get("OPENAI_OKR_MODEL") || Deno.env.get("OPENAI_RESULT_MODEL") || Deno.env.get("OPENAI_GOLDEN_MODEL") || "gpt-5.5";
    const openaiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        reasoning: { effort: "medium" },
        input: [
          { role: "system", content: instruction(mode) },
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
    const pick = (k: string) => (typeof parsed[k] === "string" ? parsed[k].trim() : "");
    const out = mode === "feedback"
      ? { memo: pick("memo"), model }
      : { actual: pick("actual"), judgment: pick("judgment"), reason: pick("reason"), plan: pick("plan"), evidence: pick("evidence"), model };
    return new Response(JSON.stringify(out), { headers: jsonHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), { status: 500, headers: jsonHeaders });
  }
});
