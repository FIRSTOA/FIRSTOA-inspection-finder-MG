import { recordOpenAiUsage } from "../_shared/ai-usage-deno.ts";
/**
 * 매수·토너 사진 읽기(2026-10-14) — FIELD 점검 양식의 [📷 매수 분석]·[📷 잔량 분석](kind count|toner). 복합기 카운터 화면·소모품 화면 사진에서
 * 흑백·컬러·큰컬러·합계 매수와 K/C/M/Y 토너 잔량(%), 폐통(%)을 읽어 JSON 으로 돌려준다. 못 읽은 칸은 빈 글자.
 * 요청: { image: dataURL, model?: 기종, author? }  응답: { black, color, largeColor, total, tonerK, tonerC, tonerM, tonerY, waste, note }
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const INSTRUCTION = `복합기 화면(카운터/사용량 보고서/소모품 상태) 사진에서 숫자만 정확히 읽는다. 추측하지 않는다.
JSON 하나로만 답한다: {"black":"","color":"","largeColor":"","total":"","tonerK":"","tonerC":"","tonerM":"","tonerY":"","waste":"","note":""}
- black 흑백(모노·B/W·Black) 누적 매수, color 컬러(풀컬러) 누적 매수, largeColor 큰컬러(A3 컬러·대형 컬러)가 따로 있으면, total 합계(총 카운터).
- 숫자는 쉼표 없이 정수 글자("98083"). 화면에 없으면 "".
- 합계가 없고 흑백·컬러가 있으면 total 은 둘(셋)의 합으로 적는다. 흑백기면 color 는 "".
- tonerK/C/M/Y 는 잔량 %(숫자만, "75"). 막대만 있고 숫자가 없으면 눈금으로 10 단위 어림, 그래도 모르면 "". 폐토너통은 복합기 화면에 % 가 보통 나오지 않는다 — 숫자 % 가 분명히 보일 때만 waste, 아니면 "" (추측 금지).
- note 에는 읽기 애매했던 것을 한 줄(한국어)로.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY") || "";
    if (!apiKey) return Response.json({ error: "OPENAI_API_KEY missing" }, { status: 500, headers: jsonHeaders });
    const body = await req.json().catch(() => ({}));
    const image = String(body.image || "");
    if (!/^data:image\/(png|jpe?g|webp);base64,/.test(image)) return Response.json({ error: "image(dataURL)가 필요합니다" }, { status: 400, headers: jsonHeaders });
    if (image.length > 8_000_000) return Response.json({ error: "사진이 너무 큽니다" }, { status: 400, headers: jsonHeaders });
    const model = Deno.env.get("OPENAI_VISION_MODEL") || Deno.env.get("OPENAI_REPORT_MODEL") || "gpt-5.5";
    const t0 = Date.now();
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        reasoning: { effort: "low" },
        input: [
          { role: "system", content: INSTRUCTION },
          { role: "user", content: [
            { type: "input_text", text: `기종: ${String(body.model || "").slice(0, 60) || "모름"}
찾을 것: ${body.kind === "toner" ? "토너 잔량(K/C/M/Y %) — 매수·폐통 칸은 비워도 된다" : body.kind === "count" ? "누적 매수(흑백·컬러·큰컬러·합계) — 잔량 칸은 비워도 된다" : "매수와 잔량 모두"}` },
            { type: "input_image", image_url: image, detail: "high" },
          ] },
        ],
        text: { format: { type: "json_object" } },
      }),
    });
    if (!res.ok) return Response.json({ error: (await res.text()).slice(0, 300) }, { status: 502, headers: jsonHeaders });
    const data = await res.json();
    await recordOpenAiUsage("counter-ocr", model, data, { question: "매수 사진 분석", author: String(body.author || ""), t0 });
    const text = data.output_text || (data.output || []).flatMap((o: { content?: Array<{ text?: string }> }) => o.content || []).map((c: { text?: string }) => c.text || "").join("");
    let out: Record<string, string> = {};
    try { out = JSON.parse(text); } catch { return Response.json({ error: "결과를 읽지 못했습니다", raw: String(text).slice(0, 200) }, { status: 502, headers: jsonHeaders }); }
    const clean = (v: unknown) => String(v ?? "").replace(/[^\d]/g, "");
    const keys = ["black", "color", "largeColor", "total", "tonerK", "tonerC", "tonerM", "tonerY", "waste"];
    const result: Record<string, string> = Object.fromEntries(keys.map((k) => [k, clean(out[k])]));
    result.note = String(out.note || "").slice(0, 200);
    return Response.json(result, { headers: jsonHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: jsonHeaders });
  }
});
