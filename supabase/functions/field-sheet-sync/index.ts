const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

function enabled(value: unknown) {
  return String(value || "").toLowerCase() === "true";
}

const COPIER_HEADERS = [
  "등록자", "전략영업담당자", "상호", "업종", "매출액(억)", "인원수", "프로젝트주소", "미팅지역",
  "도로명주소", "세부주소", "키맨성함+직함", "키맨전화번호", "키맨 성향", "영업 접근 전략",
  "의사결정 파급력", "개인 히스토리", "프로젝트", "품목(원문)", "연계영업", "관심품목(세분화)",
  "수주 가능성(A/B/C)", "예상 발주금액(만원)", "예상 발주시기(YYYY-MM)", "현재 경쟁사/장비",
  "경쟁사 불만(PainPoint)", "계약 종료(예정)일", "진행상황(원문)", "최종결과(대기 등)",
  "영업진행상황", "첫등록내용", "특이사항", "거래처등급", "영업등급", "체크일",
  "[신규통합] 현재 관리등급", "[자동계산] 다음 체크 예정일", "[AI 자동완성 개입 여부]",
];

function textFromResponse(data: Record<string, unknown>) {
  if (typeof data.output_text === "string") return data.output_text;
  const output = Array.isArray(data.output) ? data.output : [];
  return output.flatMap((item: { content?: Array<{ text?: string }> }) => item.content || [])
    .map((item: { text?: string }) => item.text || "").join("\n");
}

function parseObject(text: string): Record<string, unknown> {
  const candidate = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const json = candidate.match(/\{[\s\S]*\}/)?.[0] || "{}";
  try {
    const value = JSON.parse(json);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

async function enrichCopierPayload(input: { sourceText: string; data: Record<string, unknown>; author: string; apiKey: string }) {
  if (!input.apiKey) return {};
  const prompt = [
    "너는 퍼스트전산 영업 확장성 DB의 데이터 정리 담당자다.",
    "아래 웹앱 입력을 사실에 근거해 스프레드시트 헤더별 값으로 정리한다.",
    "반드시 JSON 객체 하나만 출력한다. 키는 제공된 헤더명만 사용한다.",
    "입력에 없는 사실, 금액, 날짜, 담당자, 경쟁사를 만들지 않는다. 알 수 없는 값은 '미기재'로 둔다.",
    "입력에 있는 '업종 및 인원(매출)'은 업종/매출액(억)/인원수로 가능한 범위에서 분리한다.",
    "'첫등록내용'과 '특이사항'은 입력 사실을 빠뜨리지 않고 읽기 좋게 요약한다.",
    "'영업 접근 전략'은 입력된 프로젝트·품목·특이사항을 바탕으로 짧고 실행 가능하게 정리하되, 근거 없는 제안은 추가하지 않는다.",
    "'진행상황(원문)'에는 입력 원문을 보존하고, '영업진행상황'에는 현재 단계만 간결하게 정리한다.",
    "'[AI 자동완성 개입 여부]' 값은 'O (웹앱 AI 정리)'로 설정한다.",
    "",
    `[작성자] ${input.author}`,
    "[웹앱 구조화 입력]",
    JSON.stringify(input.data),
    "",
    "[작성 원문]",
    input.sourceText,
    "",
    "[반환할 헤더]",
    JSON.stringify(COPIER_HEADERS),
  ].join("\n");

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("FIELD_SHEET_AI_MODEL") || Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini",
        input: [{ role: "user", content: prompt }],
        temperature: 0.1,
      }),
    });
    if (!response.ok) return {};
    const raw = parseObject(textFromResponse(await response.json()));
    return Object.fromEntries(COPIER_HEADERS.map((header) => [
      header,
      header === "등록자" ? (raw[header] || input.author || "미기재") : (raw[header] || "미기재"),
    ]));
  } catch {
    return {};
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: jsonHeaders });

  try {
    const { jobId } = await req.json();
    if (!jobId) return Response.json({ error: "jobId가 필요합니다." }, { status: 400, headers: jsonHeaders });

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const webhookUrl = Deno.env.get("FIELD_SHEETS_WEBHOOK_URL") || "";
    const webhookSecret = Deno.env.get("FIELD_SHEETS_WEBHOOK_SECRET") || "";
    const openAiKey = Deno.env.get("OPENAI_API_KEY") || "";
    if (!supabaseUrl || !serviceKey) throw new Error("Supabase 서비스 키 설정이 없습니다.");

    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
    const rest = `${supabaseUrl}/rest/v1`;
    const jobRes = await fetch(`${rest}/field_sheet_sync_jobs?id=eq.${encodeURIComponent(jobId)}&select=*`, { headers });
    const jobs = await jobRes.json();
    const job = jobs[0];
    if (!job) return Response.json({ error: "동기화 작업을 찾지 못했습니다." }, { status: 404, headers: jsonHeaders });
    if (job.sheet_status === "synced") return Response.json({ ok: true, status: "already_synced", row: job.sheet_row }, { headers: jsonHeaders });

    const configRes = await fetch(`${rest}/app_config?select=key,value`, { headers });
    const configRows = await configRes.json();
    const config = Object.fromEntries((configRows || []).map((row: { key: string; value: string }) => [row.key, row.value]));
    if (!enabled(config.FIELD_SHEET_SYNC_ENABLED)) {
      return Response.json({ ok: true, status: "held" }, { headers: jsonHeaders });
    }
    if (!webhookUrl || !webhookSecret) throw new Error("시트 웹훅 Secret 설정이 없습니다.");

    const sourcePayload = job.payload && typeof job.payload === "object" ? job.payload : {};
    const sourceData = sourcePayload.data && typeof sourcePayload.data === "object" ? sourcePayload.data : {};
    const sheetValues = job.category === "expansion_copier"
      ? await enrichCopierPayload({ sourceText: job.source_text || "", data: sourceData, author: job.author || "", apiKey: openAiKey })
      : {};
    const payload = Object.keys(sheetValues).length
      ? { ...sourcePayload, data: { ...sourceData, _sheetValues: sheetValues } }
      : sourcePayload;

    const sheetRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "append_field_sheet_row",
        secret: webhookSecret,
        jobId: job.id,
        category: job.category,
        testMode: enabled(config.FIELD_SHEET_TEST_MODE),
        author: job.author,
        submittedAt: job.created_at,
        sourceText: job.source_text,
        payload,
      }),
    });
    const sheetData = await sheetRes.json().catch(() => ({}));
    if (!sheetRes.ok || !sheetData.ok) throw new Error(sheetData.error || `시트 응답 오류(${sheetRes.status})`);

    await fetch(`${rest}/field_sheet_sync_jobs?id=eq.${encodeURIComponent(job.id)}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ sheet_status: "synced", sheet_row: sheetData.row || null, synced_at: new Date().toISOString(), last_error: null, attempts: Number(job.attempts || 0) + 1 }),
    });
    return Response.json({ ok: true, status: "synced", row: sheetData.row || null, sheet: sheetData.sheet || "" }, { headers: jsonHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: jsonHeaders });
  }
});
