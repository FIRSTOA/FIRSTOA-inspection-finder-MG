/**
 * 가이드 문서 태깅 — 제목·본문을 읽어 기종·부품·증상·난이도·한 줄 요약을 뽑는다.
 *
 * 왜 필요한가: 노션에서 이관한 450건 중 대부분이 태그가 비어 있어 족보 카드의 "관련 가이드"
 * 매칭(기종·부품·증상 겹침 점수)이 절반만 작동했다. 규칙으로 잡히는 건 스크립트가 먼저 채우고,
 * 남은 문서(제목만으로 알 수 없는 것)와 요약이 URL뿐인 문서를 이 함수가 읽어서 채운다.
 *
 * 요청: { brand, title, content, currentSummary?, seriesHint?: string[] }
 * 응답: { models[], parts[], symptoms[], difficulty, summary }
 * 증상 어휘는 프론트 SYMPTOM_FILTERS와 같은 8종만 허용 — 족보와 같은 축이어야 연결된다.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const SYMPTOMS = ["급지·걸림", "줄·화질", "에러코드", "토너·드럼", "정착기·롤러", "스캔·팩스", "네트워크·드라이버", "소음"];

const INSTRUCTION = `복합기 A/S 팀의 기술 문서를 색인하는 작업입니다. 주어진 문서를 읽고 JSON으로만 답하세요.

{
  "models": ["문서가 다루는 기종·시리즈 (팀 관용명 또는 문서에 적힌 모델명). 특정 기종용이 아니면 빈 배열"],
  "parts": ["문서에 등장하는 부품·부위 (급지롤러·정착기·현상기·드럼·ADF·LSU·전사벨트 등). 없으면 빈 배열"],
  "symptoms": ["아래 목록에서만 고른 증상 분류 (해당 없으면 빈 배열)"],
  "difficulty": "쉬움 | 보통 | 어려움",
  "summary": "이 문서가 무엇을 알려주는지 한 문장(40자 내외, 현장체). 링크만 있는 문서는 링크가 무엇에 대한 것인지 쓴다"
}

증상 목록: ${SYMPTOMS.join(" / ")}

규칙:
- 문서에 없는 내용을 지어내지 말 것. 확실하지 않으면 빈 배열.
- models는 최대 6개, parts는 최대 8개, symptoms는 최대 3개.
- difficulty: 설정·확인·카운터류=쉬움 / 부품 교체·탈거=보통 / 분해 깊거나 기판·펌웨어 위험 작업=어려움.
- summary는 제목을 그대로 베끼지 말고 내용을 요약. URL·이모지 금지.
- 전부 한국어.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: jsonHeaders });
  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY") || "";
    if (!apiKey) return Response.json({ error: "OPENAI_API_KEY missing" }, { status: 500, headers: jsonHeaders });
    const body = await req.json().catch(() => ({}));
    const title = String(body.title || "").trim();
    if (!title) return Response.json({ error: "title이 필요합니다" }, { status: 400, headers: jsonHeaders });
    const model = Deno.env.get("OPENAI_GUIDE_TAG_MODEL") || "gpt-5.5";

    const source = {
      brand: String(body.brand || ""),
      title,
      content: String(body.content || "").replace(/https?:\/\/\S+/g, (u: string) => (u.length > 60 ? "(링크)" : u)).slice(0, 4000),
      currentSummary: String(body.currentSummary || ""),
      knownSeries: Array.isArray(body.seriesHint) ? body.seriesHint.slice(0, 20) : [],
    };
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        reasoning: { effort: "low" }, // 색인 작업 — 판단보다 추출이라 낮은 노력으로 충분하고 빠르다
        input: [
          { role: "system", content: INSTRUCTION },
          { role: "user", content: JSON.stringify(source) },
        ],
        text: { format: { type: "json_object" } },
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return Response.json({ error: detail.slice(0, 300), model }, { status: 502, headers: jsonHeaders });
    }
    const data = await res.json();
    const outputText = data.output_text
      || data.output?.flatMap((item: { content?: Array<{ text?: string }> }) => item.content || []).map((item: { text?: string }) => item.text || "").join("\n")
      || "";
    const parsed = JSON.parse(outputText || "{}");
    const list = (v: unknown, max: number, len: number) => (Array.isArray(v) ? v : []).map((x) => String(x).trim().slice(0, len)).filter(Boolean).slice(0, max);
    return Response.json({
      models: list(parsed.models, 6, 40),
      parts: list(parsed.parts, 8, 30),
      symptoms: list(parsed.symptoms, 3, 20).filter((s: string) => SYMPTOMS.includes(s)),
      difficulty: ["쉬움", "보통", "어려움"].includes(String(parsed.difficulty)) ? String(parsed.difficulty) : "",
      summary: String(parsed.summary || "").replace(/https?:\/\/\S+/g, "").trim().slice(0, 120),
      model,
    }, { headers: jsonHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: jsonHeaders });
  }
});
