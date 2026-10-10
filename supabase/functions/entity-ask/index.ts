/**
 * 통합 검색 360 — "이 업체에 대해 물어보기" (2026-10-10)
 *
 * 프론트(Search360)가 모은 기록(현재 상태 + 사건 목록, 정확 일치만)과 질문을 보내면, 그 기록만 근거로 한국어로 답한다.
 * 요청: { question, author, entity:{name,code,leaseCode,names,serials,assets}, state:{...}, events:[{d,s,t,x,a,tm,m,sn,as,other?}] }
 * 응답: { answer, model }
 * 원칙: 기록에 없는 것은 "기록에 없다"고 답한다. 숫자는 세어서 말하고 날짜·출처를 붙인다. 지어내지 않는다.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const INSTRUCTION = `너는 복합기 렌탈·IT 유지보수 회사 "퍼스트전산"의 사내 기록 비서다. 직원이 한 업체(또는 기기)에 대해 묻는다.
너에게는 그 업체에 대해 회사 시스템이 모은 기록만 주어진다: state(현재 상태 요약·기기 목록·표별 건수)와 events(사건 목록: d=날짜, s=출처 표, t=제목, x=요약, a=작성자, tm=팀, m=기종, sn=기번, as=자산번호, other=다른 업체명이면 그 이름).

답하는 법:
- 반드시 주어진 기록만 근거로 답한다. 기록에 없으면 "기록에 없습니다"라고 말하고, 어디를 더 봐야 하는지(예: 이카운트·카톡방 원문)를 한 줄로 덧붙인다. 추측·일반 상식으로 채우지 않는다.
- 세는 질문("몇 번", "얼마나")은 events 를 실제로 세어 숫자로 답하고, 기간(가장 오래된~최근 날짜)을 같이 적는다.
  AS 횟수는 ① s="AS"(AS 보고) ② s="일정" 중 제목에 "AS … 완료"가 있고 x(요약)에 처리내용이 든 것(일정리스트에서 간단처리한 건 — 보고가 따로 없다) ③ s="방문기록" 중 x 에 'as' 가 든 것을 합치되, 같은 날 같은 업체 건은 하나로 센다. 접수(s="접수")는 "접수 N건"으로 따로 말한다.
- 임대 시작은 state.devices 의 계약일(start)과 s="임대리스트"/"납품·교체" 사건으로 답한다. 기기 교체·이동은 "납품·교체" 사건과 자산번호·기번 변화로 설명한다.
- other 가 붙은 사건은 같은 자산번호·기번이 다른 업체 기록에 있다는 뜻이다 — "이 기기는 그 전에 ○○에서 쓰던 기기(이동)"처럼 해석하되, 날짜 순서로 확인한 뒤에만 말한다.
- 초과료·미수·재계약·불만은 해당 출처 사건을 날짜순으로 요약하고 금액·개월·상태를 숫자 그대로 쓴다.
- 형식: 첫 줄에 결론 한 문장. 그 아래 근거를 "· " 글머리 3~8줄로, 각 줄 끝에 [출처 날짜] 를 붙인다(예: [AS 2026-07-27]). 마지막에 빠졌을 수 있는 것(원문 미확인·기록 없음)을 한 줄. 전체 12줄 이내. 존댓말, 과장 없이.
- 개인정보(전화번호)는 질문이 연락처를 물을 때만 적는다.
- 그림(카드·리포트·포스터·안내문)을 "이미지로" 만들어 달라고 하면: 마크다운 코드블록 \`\`\`svg 안에 자체 완결 SVG 하나를 쓴다 — width="1080" height="1350"(세로) 또는 1080×1080, 같은 viewBox, 외부 폰트·이미지·스크립트·링크 없음, font-family="Pretendard, Apple SD Gothic Neo, Malgun Gothic, Noto Sans KR, sans-serif", 글자 크기 22 이상, 한 줄 28자 이내로 상자 밖으로 안 나가게, 긴 주소는 두 줄로. 회사명은 "퍼스트전산"(영문 쓰지 않음). 내용(업체명·기기·주소·증상·날짜)은 기록에 있는 것만. 코드블록 아래에 함께 보낼 문자 문구를 3줄 이내로 한 문단 쓴다. 앱이 그 SVG 를 그림으로 바꿔 저장·복사·문자(MMS) 전송 단추를 보여 주므로 "저장하세요" 같은 설명은 쓰지 않는다.
- 오늘(KST)은 ${kstToday()} 이다. "내일"·"이번 주" 같은 말은 여기서 계산한다.`;
function kstToday(): string { return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).format(new Date()); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY") || "";
    if (!apiKey) return Response.json({ error: "OPENAI_API_KEY missing" }, { status: 500, headers: jsonHeaders });
    const body = await req.json().catch(() => ({}));
    const question = String(body.question || "").trim().slice(0, 500);
    if (!question) return Response.json({ error: "question 이 필요합니다" }, { status: 400, headers: jsonHeaders });
    const events = Array.isArray(body.events) ? body.events.slice(0, 400) : [];
    const payload = {
      question,
      entity: body.entity || {},
      state: body.state || {},
      events: events.map((ev: Record<string, unknown>) => ({
        d: String(ev.d || "").slice(0, 10), s: String(ev.s || "").slice(0, 20), t: String(ev.t || "").slice(0, 90), x: String(ev.x || "").slice(0, 120),
        a: String(ev.a || "").slice(0, 20), tm: String(ev.tm || "").slice(0, 10), m: String(ev.m || "").slice(0, 30), sn: String(ev.sn || "").slice(0, 30), as: String(ev.as || "").slice(0, 20),
        ...(ev.other ? { other: String(ev.other).slice(0, 40) } : {}),
      })),
    };
    const model = Deno.env.get("OPENAI_ASK_MODEL") || Deno.env.get("OPENAI_REPORT_MODEL") || "gpt-5.5";
    const openaiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        reasoning: { effort: "medium" },
        input: [
          { role: "system", content: INSTRUCTION },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }),
    });
    if (!openaiRes.ok) {
      const detail = await openaiRes.text().catch(() => "");
      return Response.json({ error: detail.slice(0, 300), model }, { status: 502, headers: jsonHeaders });
    }
    const data = await openaiRes.json();
    const answer = data.output_text
      || data.output?.flatMap((item: { content?: Array<{ text?: string }> }) => item.content || []).map((item: { text?: string }) => item.text || "").join("\n")
      || "";
    if (!String(answer).trim()) return Response.json({ error: "빈 응답", model }, { status: 502, headers: jsonHeaders });
    return Response.json({ answer: String(answer).trim().slice(0, 4000), model, used: payload.events.length }, { headers: jsonHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: jsonHeaders });
  }
});
