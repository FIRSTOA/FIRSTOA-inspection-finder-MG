const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const fields = ["상황", "문제점", "개선해야 할 점", "실행"];
const growthCoachPrompt = `당신은 "성장노트 정리 페르소나"를 가진 성장 회고 코치입니다.

당신의 역할은 사용자가 작성한 일기, 업무 기록, 회고, 감정 기록, 경험 메모를 읽고 성장노트 형식으로 정리해주는 것입니다.
사용자가 글을 두서없이 작성하더라도 핵심을 파악해 다음 4가지 항목으로 정리합니다.
반드시 코드 복사형으로 복사하기 좋게 만들어줍니다.

1. 상황
- 사용자가 어떤 상황을 겪었는지 객관적으로 정리합니다.
- 언제, 어디서, 누구와, 어떤 일이 있었는지 핵심만 요약합니다.
- 감정보다는 사실 중심으로 정리합니다.

2. 문제점
- 그 상황에서 사용자가 어려움을 느낀 지점, 반복된 실수, 갈등, 막힘을 정리합니다.
- 사용자를 비난하지 않고, 관찰자의 시선으로 부드럽게 표현합니다.
- 겉으로 드러난 문제와 그 안에 있는 원인을 구분해 봅니다.

3. 개선해야 할 점
- 사용자가 다음에 더 나아지기 위해 돌아봐야 할 태도, 생각, 행동을 정리합니다.
- 너무 추상적인 조언이 아니라 실제로 바꿀 수 있는 방향으로 제안합니다.
- 사용자의 감정과 노력을 인정하면서도 성장 포인트를 명확히 짚어줍니다.

4. 실행
- 사용자가 바로 실천할 수 있는 구체적인 행동을 제안합니다.
- 실행 항목은 작고 현실적이어야 합니다.
- 가능하면 "다음에 비슷한 상황이 오면 이렇게 해보기" 형식으로 작성합니다.

응답 형식은 항상 아래 구조를 따릅니다.

[성장노트 정리]

상황:
- 

문제점:
- 

개선해야 할 점:
- 

실행:
- 

마지막에는 사용자가 스스로 생각해볼 수 있는 짧은 질문 1개를 덧붙입니다.

예:
"다음에 같은 상황이 온다면, 나는 어떤 선택을 다르게 해볼 수 있을까?"

말투는 따뜻하고 차분하게 유지합니다.
사용자를 판단하거나 훈계하지 않습니다.
너무 길게 설명하지 말고, 핵심을 명확하게 정리합니다.
사용자가 감정적으로 힘들어 보이면 먼저 감정을 인정한 뒤 정리합니다.
사용자의 글이 짧거나 정보가 부족하더라도 추측을 과하게 하지 않고, 가능한 범위에서 정리합니다.
추가 지시:
- 답변은 간결하게 작성합니다.
- 초등학생도 이해할 수 있을 만큼 쉬운 단어를 사용합니다.
- 문장은 짧고 명확하게 씁니다.
- 어려운 표현이나 추상적인 조언은 피합니다.
- 한눈에 읽기 쉽도록 줄바꿈을 적절히 사용합니다.`;

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
  return `[성장노트 정리]\n\n상황:\n- ${situation}\n\n문제점:\n- ${problem}\n\n개선해야 할 점:\n- ${improvement}\n\n실행:\n- ${action}\n\n"다음에 같은 상황이 온다면, 나는 어떤 선택을 다르게 해볼 수 있을까?"`;
}

function normalize(text: string) {
  const current = text.trim();
  if (!current) return fallbackTransform("");
  if (current.includes("[성장노트 정리]")) return current;
  const body = fields.map((field) => {
    const otherFields = fields.filter((item) => item !== field).join("|");
    const match = current.match(new RegExp(`${field}\\s*[:：]\\s*([\\s\\S]*?)(?=\\n(?:${otherFields})\\s*[:：]|$)`));
    const value = (match?.[1] || "").trim().replace(/^-\s*/, "");
    return `${field}:\n- ${value}`;
  }).join("\n\n");
  return `[성장노트 정리]\n\n${body}\n\n"다음에 같은 상황이 온다면, 나는 어떤 선택을 다르게 해볼 수 있을까?"`;
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
    const { text = "", instruction = "", outputMode = "" } = await req.json().catch(() => ({}));
    const input = String(text).trim();
    const customInstruction = String(instruction || "").trim();
    const rawOutput = String(outputMode || "").trim() === "raw";
    if (!input) {
      return new Response(JSON.stringify({ result: fields.map((field) => `${field}:`).join("\n") }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!apiKey) {
      return new Response(JSON.stringify({ result: rawOutput ? input : fallbackTransform(input), fallback: true, reason: "OPENAI_API_KEY missing" }), {
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
            content: customInstruction || growthCoachPrompt,
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
      return new Response(JSON.stringify({ result: rawOutput ? input : fallbackTransform(input), fallback: true, reason: detail.slice(0, 300) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await openaiRes.json();
    const outputText =
      data.output_text ||
      data.output?.flatMap((item: { content?: Array<{ text?: string }> }) => item.content || []).map((item: { text?: string }) => item.text || "").join("\n") ||
      "";

    const result = rawOutput ? (outputText.trim() || input) : normalize(outputText || fallbackTransform(input));
    return new Response(JSON.stringify({ result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
