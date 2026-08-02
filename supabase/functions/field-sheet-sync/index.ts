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

// 불만 시트/AI 헤더 (bulman 레거시 AI 컬럼과 동일). _sheetValues 로 시트에 기입되고 DB에도 역기입한다.
const COMPLAINT_AI_HEADERS = ["고객감정상태", "AI_불만유형", "AI_불만항목", "사실확인", "대안제시", "재발방지"];

async function enrichComplaintPayload(input: { sourceText: string; data: Record<string, unknown>; author: string; apiKey: string }) {
  if (!input.apiKey) return {};
  const prompt = [
    "너는 퍼스트전산 CS팀의 고객 불만 분석 담당자다.",
    "아래 웹앱 불만 접수 입력을 사실에 근거해 분석하고, 지정된 헤더별 값으로 정리한다.",
    "반드시 JSON 객체 하나만 출력한다. 키는 제공된 헤더명만 사용한다.",
    "입력에 없는 사실·수치·약속·금액을 지어내지 않는다. 알 수 없으면 '미기재'로 둔다.",
    "'고객감정상태'는 고객의 감정·태도를 짧게 요약한다 (예: 불만 누적, 비용 부담 거부감).",
    "'AI_불만유형'은 불만의 큰 분류를, 'AI_불만항목'은 세부 항목을 쉼표로 정리한다.",
    "'사실확인'은 입력에서 확인되는 객관적 사실만 간결히 정리한다.",
    "'대안제시'는 입력에 언급된 제안·조치를 정리하고, 없으면 '미기재'로 둔다.",
    "'재발방지'는 동일 불만 재발을 막기 위한 실행 가능한 방안을 입력 근거 범위에서 제안한다.",
    "",
    `[작성자] ${input.author}`,
    "[웹앱 구조화 입력]",
    JSON.stringify(input.data),
    "",
    "[작성 원문]",
    input.sourceText,
    "",
    "[반환할 헤더]",
    JSON.stringify(COMPLAINT_AI_HEADERS),
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
    return Object.fromEntries(COMPLAINT_AI_HEADERS.map((header) => [header, raw[header] || "미기재"]));
  } catch {
    return {};
  }
}

const MAX_ATTEMPTS = 5; // 이 횟수 도달 시 sheet_status='failed' — "처리 중"과 "영구 실패"를 구분한다

type JobRow = Record<string, unknown> & { id: string; category: string; attempts?: number; source_text?: string; author?: string; _dupKey?: string };

function makeEnv() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) throw new Error("Supabase 서비스 키 설정이 없습니다.");
  return {
    rest: `${supabaseUrl}/rest/v1`,
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    webhookUrl: Deno.env.get("FIELD_SHEETS_WEBHOOK_URL") || "",
    webhookSecret: Deno.env.get("FIELD_SHEETS_WEBHOOK_SECRET") || "",
    openAiKey: Deno.env.get("OPENAI_API_KEY") || "",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: jsonHeaders });

  try {
    const { jobId, action } = await req.json().catch(() => ({}));

    // 배치 재시도 모드 (크론/관리자): 3분 이상 지난 pending 잡을 오래된 순으로 처리.
    // 3분 유예는 접수 직후의 직접 호출과 겹쳐 이중 기입되는 것을 막는다.
    if (!jobId && action === "retry_pending") {
      const env = makeEnv();
      const cutoff = new Date(Date.now() - 3 * 60 * 1000).toISOString();
      const listRes = await fetch(
        `${env.rest}/field_sheet_sync_jobs?sheet_status=eq.pending&attempts=lt.${MAX_ATTEMPTS}&created_at=lt.${encodeURIComponent(cutoff)}&order=created_at.asc&limit=10&select=*`,
        { headers: env.headers },
      );
      const pending: JobRow[] = await listRes.json().catch(() => []);
      const results: Array<{ id: string; status: string; error?: string }> = [];
      for (const job of pending) {
        // 클레임: attempts가 그대로일 때만 +1 — 동시에 도는 다른 배치·직접 호출이 잡으면 0행 갱신되어 건너뛴다
        const claimRes = await fetch(
          `${env.rest}/field_sheet_sync_jobs?id=eq.${encodeURIComponent(job.id)}&attempts=eq.${Number(job.attempts || 0)}&sheet_status=eq.pending`,
          { method: "PATCH", headers: { ...env.headers, Prefer: "return=representation" }, body: JSON.stringify({ attempts: Number(job.attempts || 0) + 1 }) },
        );
        const claimed = await claimRes.json().catch(() => []);
        if (!Array.isArray(claimed) || !claimed.length) { results.push({ id: job.id, status: "skipped_claimed" }); continue; }
        try {
          const outcome = await processJob_(claimed[0] as JobRow, env);
          results.push({ id: job.id, status: outcome.status });
        } catch (jobError) {
          results.push({ id: job.id, status: "failed", error: jobError instanceof Error ? jobError.message : String(jobError) });
        }
      }
      return Response.json({ ok: true, processed: results.length, results }, { headers: jsonHeaders });
    }

    if (!jobId) return Response.json({ error: "jobId가 필요합니다." }, { status: 400, headers: jsonHeaders });

    const env = makeEnv();
    const jobRes = await fetch(`${env.rest}/field_sheet_sync_jobs?id=eq.${encodeURIComponent(jobId)}&select=*`, { headers: env.headers });
    const jobs = await jobRes.json();
    const job = jobs[0];
    if (!job) return Response.json({ error: "동기화 작업을 찾지 못했습니다." }, { status: 404, headers: jsonHeaders });
    if (job.sheet_status === "synced") return Response.json({ ok: true, status: "already_synced", row: job.sheet_row }, { headers: jsonHeaders });

    const outcome = await processJob_(job, env);
    return Response.json({ ok: true, ...outcome }, { headers: jsonHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: jsonHeaders });
  }
});

// 단일 잡 처리 — 성공 시 synced 마킹, 실패 시 last_error/attempts 기록(+한도 도달 시 failed 마킹) 후 throw
async function processJob_(job: JobRow, env: ReturnType<typeof makeEnv>): Promise<{ status: string; row?: number | null; sheet?: string }> {
  const { rest, headers, webhookUrl, webhookSecret, openAiKey } = env;
  // 실패 시 last_error/attempts를 job에 남긴다 — 예전엔 실패가 어디에도 기록되지 않아 영구 pending으로 방치됐다.
  const recordFailure = async (message: string) => {
    const nextAttempts = Number(job.attempts || 0) + 1;
    await fetch(`${rest}/field_sheet_sync_jobs?id=eq.${encodeURIComponent(job.id)}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({
        last_error: message.slice(0, 500),
        attempts: nextAttempts,
        ...(nextAttempts >= MAX_ATTEMPTS ? { sheet_status: "failed" } : {}),
      }),
    }).catch(() => {});
  };

  try {

    const configRes = await fetch(`${rest}/app_config?select=key,value`, { headers });
    const configRows = await configRes.json();
    const config = Object.fromEntries((configRows || []).map((row: { key: string; value: string }) => [row.key, row.value]));
    if (!enabled(config.FIELD_SHEET_SYNC_ENABLED)) {
      return { status: "held" };
    }
    if (!webhookUrl || !webhookSecret) throw new Error("시트 웹훅 Secret 설정이 없습니다.");

    const sourcePayload = (job.payload && typeof job.payload === "object" ? job.payload : {}) as Record<string, unknown> & { data?: Record<string, unknown> };
    const sourceData = sourcePayload.data && typeof sourcePayload.data === "object" ? sourcePayload.data : {};
    const sheetValues = job.category === "expansion_copier"
      ? await enrichCopierPayload({ sourceText: job.source_text || "", data: sourceData, author: job.author || "", apiKey: openAiKey })
      : job.category === "complaint"
      ? await enrichComplaintPayload({ sourceText: job.source_text || "", data: sourceData, author: job.author || "", apiKey: openAiKey })
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

    // synced 마킹은 응답을 검증한다 — 실패하면 job이 pending인데 성공으로 응답하던 문제 방지.
    const markRes = await fetch(`${rest}/field_sheet_sync_jobs?id=eq.${encodeURIComponent(job.id)}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ sheet_status: "synced", sheet_row: sheetData.row || null, synced_at: new Date().toISOString(), last_error: null, attempts: Number(job.attempts || 0) + 1 }),
    });
    if (!markRes.ok) throw new Error(`synced 마킹 실패(${markRes.status}) — 시트에는 기록됨(행 ${sheetData.row || "?"})`);

    // 불만: AI 분석 결과를 bulman 원본 행에도 역기입한다(_dupKey 매칭). 사용자가 직접 쓴 재발방지는 보존.
    if (job.category === "complaint" && Object.keys(sheetValues).length && job._dupKey) {
      const dbPatch: Record<string, unknown> = { ...sheetValues };
      if (String(sourceData["재발방지"] || "").trim()) delete dbPatch["재발방지"];
      const backfillRes = await fetch(`${rest}/bulman?_dupKey=eq.${encodeURIComponent(String(job._dupKey))}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify(dbPatch),
      }).catch(() => null);
      if (backfillRes && !backfillRes.ok) console.error(`bulman AI 역기입 실패(${backfillRes.status}) job=${job.id}`);
    }
    return { status: "synced", row: sheetData.row || null, sheet: sheetData.sheet || "" };
  } catch (innerError) {
    const message = innerError instanceof Error ? innerError.message : String(innerError);
    await recordFailure(message);
    throw innerError;
  }
}
