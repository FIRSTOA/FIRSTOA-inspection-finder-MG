const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const fields = ["상황", "문제점", "개선해야 할 점", "실행"];

function fallbackTransform(text: string) {
  const current = text.trim();
  if (!current) return fields.map((field) => `${field}:`).join("\n");
  const clauses = current
    .replace(/([.!?。]|(?:했어야했다|해야했다|였다|이었다|했다|었다|됐다|되었다|늦었다|안됐다|못했다|다))\s+/g, "$1\n")
    .split(/\n|[.!?。]/)
    .map((line) => line.trim())
    .filter(Boolean);
  const pick = (patterns: RegExp[]) => clauses.filter((line) => patterns.some((pattern) => pattern.test(line))).join(" ");
  const situation = clauses[0] || current;
  const problem = pick([/문제|민폐|늦|실수|불편|안되|안 됨|못|지연|누락|부족/]) || clauses[1] || "";
  const improvement = pick([/해야|필요|개선|빠르게|먼저|보고|공유|확인|다음|일정|대응/]) || clauses[2] || "";
  const action = pick([/실행|진행|조치|처리|보고|공유|확인|완료|예정|하겠|하기/]) || clauses.at(-1) || "";
  return `상황: ${situation}\n문제점: ${problem}\n개선해야 할 점: ${improvement}\n실행: ${action}`;
}

function normalize(text: string) {
  const current = text.trim();
  if (!current) return fields.map((field) => `${field}:`).join("\n");
  return fields.map((field) => {
    const otherFields = fields.filter((item) => item !== field).join("|");
    const match = current.match(new RegExp(`${field}\\s*[:：]\\s*([\\s\\S]*?)(?=\\n(?:${otherFields})\\s*[:：]|$)`));
    return `${field}: ${(match?.[1] || "").trim()}`;
  }).join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    const { text = "" } = await req.json().catch(() => ({}));
    const input = String(text).trim();
    if (!input) {
      return new Response(JSON.stringify({ result: fields.map((field) => `${field}:`).join("\n") }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!apiKey) {
      return new Response(JSON.stringify({ result: fallbackTransform(input), fallback: true, reason: "OPENAI_API_KEY missing" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const openaiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content:
              "너는 CS 외근직의 성장노트를 정리한다. 사용자의 자연어 기록을 반드시 '상황:', '문제점:', '개선해야 할 점:', '실행:' 네 줄로만 정리한다. 없는 내용은 문맥에서 합리적으로 추론하되 과장하지 않는다.",
          },
          {
            role: "user",
            content: input,
          },
        ],
        temperature: 0.2,
      }),
    });

    if (!openaiRes.ok) {
      const detail = await openaiRes.text().catch(() => "");
      return new Response(JSON.stringify({ result: fallbackTransform(input), fallback: true, reason: detail.slice(0, 300) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await openaiRes.json();
    const outputText =
      data.output_text ||
      data.output?.flatMap((item: { content?: Array<{ text?: string }> }) => item.content || []).map((item: { text?: string }) => item.text || "").join("\n") ||
      "";

    return new Response(JSON.stringify({ result: normalize(outputText || fallbackTransform(input)) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
