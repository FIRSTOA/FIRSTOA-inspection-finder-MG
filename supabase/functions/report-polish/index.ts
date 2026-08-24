/**
 * 중간보고 다듬기 — 일정 원문(업체·기종·내용)을 사람이 쓰던 보고 줄로 압축한다.
 *
 * 규칙 기반 축약의 한계(제목 "A/S…"에서 업체가 "A"로 잘리는 류)를 LLM으로 넘는다.
 * 요청: { lines: [{ name, vendor, model, issue, kind }] }  (kind: "as" | "물류")
 * 응답: { lines: ["쇼군웨이크스노우보드 3220 소음", ...] }  — 입력과 같은 순서·개수
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const INSTRUCTION = `복합기 CS팀의 카톡 중간보고 한 줄 요약기다. 각 일정을 "업체명 기종 핵심내용" 한 줄로 압축한다.

입력 필드: vendor(담당자 이름을 뗀 제목), title(캘린더 원제목), note(접수 메모·양식 원문), model, issue, category(접수 구분), kind.
model·issue가 비어 있으면 title·note의 접수양식 원문에서 업체·기종·내용을 찾는다.
단, note가 접수양식이 아니라 손으로 쓴 협상·개인 메모로 보이면 무시한다(보고에 새면 안 된다).

규칙:
- 업체명: 법인표기((주)·㈜·주식회사), 등급 접두("7N"·"15V"·"30S" 같은 숫자+등급), 층·부서·위치 메모, "전 ○○"·"이전됨 >" 옛 상호, 마감 꼬리표를 전부 버리고 핵심 상호만. 예: "7N김경식세무회계사무소-분기마감" → "김경식세무회계사무소", "주식회사 알스퀘어디자인4층 설계팀(가산빌딩)" → "알스퀘어디자인"
- 기종: 짧은 관용 표기. "SL-X3220NR"→"3220", "HP-9010"→"9010", 괄호 별명이 있으면 별명("헤라클래스"→"헤라"). 기종을 모르면 생략.
- 내용: 증상·작업을 2~6단어로. "용지제거했는데 엄청 큰 갈리는소음이난다고함"→"용지제거 후 소음", "원격확인시 평판으로는 스캔이상없으나 ADF급지에서 스캔시 검정으로 스캔"→"ADF 스캔시 검정".
- 납품·교체(kind=물류): "업체 품목 수량 구분" 형태. 예: "뉴트리원 갤북5 노트북 2대 납품", "디아트치과 9010→8730 교체".
- 접수 제목이 양식 원문("A/S⇥등급⇥모델⇥…")이면 그 안의 실제 업체명을 찾아 쓴다. "종료일·지역·접수일·기번·자산번호·시리얼" 꼬리 필드는 전부 무시한다.
- category(미수방문·여분요청·토너납품·CMS작성 등)가 있으면 방문 목적이므로 내용에 반드시 넣는다. issue가 함께 있으면 구분을 앞에: "미수방문 — 8월 내내 부재중". 지어내지 말고 입력의 category만 쓴다.
- 마감 표기(분기마감·매월마감·단순마감)는 계약 구분일 뿐 방문 내용이 아니다 — 업체명에서 떼고 내용으로도 쓰지 않는다. issue가 있으면 그게 내용이다. 증상·작업이 정말 없으면 구분만 쓴다(A/S→"점검", 기기교체/사양변경→"기기교체").
- 제목이 "이름 - 내용 / 등급 / 업체 / …"꼴이면 업체와 내용을 찾아 "업체 내용"으로. 예: "신정훈 - 전자계약서 작성 확인 / SS / 포바이포 / 김준탁…" → "포바이포 전자계약서 작성 확인"
- 지어내지 않는다: 입력에 없는 부품명·원인을 추가하지 않는다. 확실치 않으면 원문 표현을 짧게 줄이는 데서 멈춘다.
- 한 줄 25자 이내 목표. 머리의 "•"는 붙이지 않는다.

출력은 JSON: {"lines": ["...", ...]} — 입력 배열과 같은 순서·같은 개수.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY") || "";
    if (!apiKey) return Response.json({ error: "OPENAI_API_KEY missing" }, { status: 500, headers: jsonHeaders });
    const body = await req.json().catch(() => ({}));
    const lines = Array.isArray(body.lines) ? body.lines.slice(0, 40) : [];
    if (!lines.length) return Response.json({ error: "lines가 필요합니다" }, { status: 400, headers: jsonHeaders });
    const model = Deno.env.get("OPENAI_REPORT_MODEL") || "gpt-5.5";

    const source = lines.map((line: Record<string, unknown>) => ({
      vendor: String(line.vendor || "").slice(0, 200),
      title: String(line.title || "").slice(0, 200),
      note: String(line.note || "").slice(0, 240),
      model: String(line.model || "").slice(0, 60),
      issue: String(line.issue || "").slice(0, 300),
      category: String(line.category || "").slice(0, 20),
      kind: line.kind === "물류" ? "물류" : "as",
    }));
    const openaiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        reasoning: { effort: "low" },
        input: [
          { role: "system", content: INSTRUCTION },
          { role: "user", content: JSON.stringify(source) },
        ],
        text: { format: { type: "json_object" } },
      }),
    });
    if (!openaiRes.ok) {
      const detail = await openaiRes.text().catch(() => "");
      return Response.json({ error: detail.slice(0, 300), model }, { status: 502, headers: jsonHeaders });
    }
    const data = await openaiRes.json();
    const outputText = data.output_text
      || data.output?.flatMap((item: { content?: Array<{ text?: string }> }) => item.content || []).map((item: { text?: string }) => item.text || "").join("\n")
      || "";
    const parsed = JSON.parse(outputText || "{}");
    const out = (Array.isArray(parsed.lines) ? parsed.lines : []).map((line: unknown) => String(line).replace(/^[•\-\s]+/, "").slice(0, 60));
    // 개수가 어긋나면 통째로 실패 취급 — 프론트가 규칙 기반으로 폴백한다
    if (out.length !== source.length) return Response.json({ error: "개수 불일치", model }, { status: 502, headers: jsonHeaders });
    return Response.json({ lines: out, model }, { headers: jsonHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: jsonHeaders });
  }
});
