const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const compactCategories = ["매출", "효율", "비용", "자기", "소통", "AI"];
const compactQuestions = ["q1", "q2", "q3", "q4"];
const categoryMap: Record<string, string> = {
  "매출": "매출증대/안정",
  "효율": "효율성",
  "비용": "비용절감",
  "자기": "자기개발",
  "소통": "소통",
  "AI": "AI",
};
const questionMap: Record<string, string> = {
  q1: "지난 기간 나의 성과",
  q2: "타인의 성과에 내가 기여한 것",
  q3: "성장을 위한 학습·발견한 지식",
  q4: "다음 도전을 위한 지원 요청",
};

function buildInstruction(quarterLabel: string) {
  return [
    "너는 퍼스트전산 분기 골든미팅카드 작성 담당자야.",
    `아래 현재 분기 결과표/미션표를 분석해서, 참고용 기존 골든미팅카드와 같은 형식·문체로 ${quarterLabel} 골든미팅카드를 작성해줘.`,
    "참고용 기존 골든미팅카드는 문체와 구성만 참고한다. 성과, 수치, 달성률, 완료여부는 반드시 현재 분기 입력 자료만 근거로 사용한다.",
    "",
    "[출력 구조 - 절대 규칙]",
    "질문 4개 × 카테고리 6개 = 총 24칸을 JSON으로만 출력해줘. 설명·코드블록·마크다운·주석·추가 문장 금지.",
    '최상위 키는 반드시 "q1", "q2", "q3", "q4" 네 개만 사용한다.',
    '카테고리 키는 반드시 "매출", "효율", "비용", "자기", "소통", "AI" 여섯 개만 사용한다.',
    '형식은 반드시 아래와 같아야 한다.',
    '{"q1":{"매출":"","효율":"","비용":"","자기":"","소통":"","AI":""},"q2":{"매출":"","효율":"","비용":"","자기":"","소통":"","AI":""},"q3":{"매출":"","효율":"","비용":"","자기":"","소통":"","AI":""},"q4":{"매출":"","효율":"","비용":"","자기":"","소통":"","AI":""}}',
    '해당 칸에 근거 자료가 없으면 반드시 빈 문자열("")로 둔다. "기록 보완 필요" 같은 대체 문구도 쓰지 않는다.',
    "",
    "[질문 정의]",
    "q1 = 지난기간 나의 성과는?",
    "q2 = 타인의 성과에 내가 기여한 것은?",
    "q3 = 성장을 위한 학습 & 발견한 지식",
    "q4 = 다음 도전을 위한 지원 요청",
    "",
    "[작성 원칙 - 수치 고정]",
    "1. 결과표의 수치·건수·달성률·완료여부를 반드시 반영한다.",
    "2. 근거 없는 성과는 만들지 않는다. 수치 임의변경, 임의추정, 미기재 항목 보정 금지.",
    '3. 미달성은 숨기지 말고 "10/12회, 83%"처럼 정확히 쓰고 개선방향을 함께 쓴다.',
    '4. 초과달성은 "52/12건, 433%"처럼 분자/분모와 퍼센트를 함께 쓴다.',
    "5. 진행률 %, 수치화된 횟수, 건수, 완료 여부가 있는 항목은 문장 안에 반드시 포함한다.",
    "",
    "[문체 규칙]",
    '1. 문체는 "~했습니다/완료했습니다/기여했습니다/깨달았습니다/향상시켰습니다"를 기본으로 한다.',
    "2. 성실하고 진정성 있게 쓰되 과장하지 않는다.",
    "3. 평가자가 근거를 바로 확인할 수 있게 짧고 명확하게 쓴다.",
    '4. q1 성과: 항목 번호를 사용한다. 예: "1. ...했습니다."',
    '5. q2 기여: "[○○을 하며 기여한 점]" 대괄호 제목 + 겸손한 "~에 기여했습니다" 문장으로 쓴다.',
    '6. q3 학습: 각 항목은 "✅[○○을 통해 배운점]" 형식 + 성찰형 문장으로 쓴다.',
    "7. q4 지원 요청: 짧고 부담없이, 성장·회사기여 관점으로 쓴다.",
    "",
    "[카테고리 해석]",
    "매출 = 매출증대·안정, 거래처 유지, 홍보, 영업기회, 재계약, 고객 확대",
    "효율 = 업무 효율, 자동화, 처리속도, 표준화, 시간 단축",
    "비용 = 비용절감, 부품/소모품/재작업/불필요 방문 감소",
    "자기 = 자기개발, 기술학습, 레벨업, 교육, 장비 이해",
    "소통 = 팀 협업, 공유, 분위기, 동기부여, 학습 분위기",
    "AI = AI 활용, 자동화, 반복업무 감소, 병목제거, 전사확산",
    "",
    "[입력 자료 우선순위]",
    "1순위: 현재 분기 기본업무/목표/결과표",
    "2순위: 현재 분기 미션/상세 실행 결과표",
    "3순위: 참고용 기존 골든미팅카드 결과 예시",
    "성장기록 모아보기 자료는 사용하지 않는다. 계획표·분기결과표·미션결과표에 없는 내용은 골든미팅카드에 작성하지 않는다.",
    "참고용 기존 골든미팅카드는 문체 참고용일 뿐 현재 분기 성과의 근거가 될 수 없다.",
    "",
    `"[분기] ${quarterLabel}"`,
    "",
    "다시 강조: 순수 JSON 객체 하나만 출력해. 다른 텍스트 절대 금지.",
  ].join("\n");
}

function normalizeAnswers(raw: unknown): Record<string, Record<string, string>> {
  const source = raw && typeof raw === "object" && "answers" in raw ? (raw as { answers?: unknown }).answers : raw;
  const current = source && typeof source === "object" ? source as Record<string, unknown> : {};
  const normalized: Record<string, Record<string, string>> = {};

  for (const qKey of compactQuestions) {
    const appQuestion = questionMap[qKey];
    const compactRow = current[qKey] as Record<string, unknown> | undefined;
    const appRow = current[appQuestion] as Record<string, unknown> | undefined;
    normalized[appQuestion] = {};
    for (const cKey of compactCategories) {
      const appCategory = categoryMap[cKey];
      const value = compactRow?.[cKey] ?? appRow?.[appCategory] ?? appRow?.[cKey] ?? "";
      normalized[appQuestion][appCategory] = typeof value === "string" ? value : String(value || "");
    }
  }

  return normalized;
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
    const model = Deno.env.get("OPENAI_GOLDEN_MODEL") || "gpt-5.5";
    const quarterLabel = `${payload.year || ""}년 ${payload.quarter || ""}분기`;
    const instruction = buildInstruction(quarterLabel);
    const source = {
      quarter: quarterLabel,
      author: payload.author,
      categories: compactCategories,
      questions: {
        q1: "지난기간 나의 성과는?",
        q2: "타인의 성과에 내가 기여한 것은?",
        q3: "성장을 위한 학습 & 발견한 지식",
        q4: "다음 도전을 위한 지원 요청",
      },
      resultText: payload.planText || "",
      missionText: payload.missionText || "",
      currentAnswers: payload.currentAnswers || {},
      exampleGoldenCard: {
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
        reasoning: { effort: "high" },
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
    return new Response(JSON.stringify({ answers: normalizeAnswers(parsed), model }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
