/**
 * 전체 데이터에 물어보기 — "C팀 미수 중 CS가 체크할 곳", "10월 초과 업체 중 N등급" 같은 묶음 질문 (2026-10-10)
 *
 * 한 업체가 아니라 표 전체를 팀·달·등급 조건으로 추려야 하는 질문이다. 모델이 도구(query_rows·vendor_team)를 골라
 * 직접 조회하고(읽기 전용, 허용 표·칸만), 받은 행으로 답과 목록을 만든다. 최대 8번 조회.
 * 요청: { question, author }  응답: { answer, rows, columns, table, calls, model }
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://kkdiihazgzesbqxjytqv.supabase.co";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";

// 허용 표·칸 — 모델은 이 밖을 볼 수 없다. desc 는 모델에게 주는 설명(값 형식·주의)
type Cat = { desc: string; cols: string[]; hidden?: string; date?: string; team?: string; grade?: string; vendor: string };
const CATALOG: Record<string, Cat> = {
  misu: { desc: "미수(밀린 임대료). 입력일은 'YYYY-MM-DD 0:00' 텍스트. 지역 칸은 대부분 비어 있어 팀은 vendor_team 으로 찾는다. 등급 칸도 비거나 섞여 있다.", vendor: "_업체명", date: "입력일", team: "지역", grade: "등급", hidden: "_hidden=not.is.true",
    cols: ["id", "입력일", "_업체명", "등급", "지역", "미수개월", "미수잔액", "실제 개월수", "실제 잔액", "관리담당자", "업체담당자", "휴대폰번호", "입금약속일", "방문내용", "고객반응", "약속일", "후속담당자", "특이사항", "최종상태" ] },
  overage: { desc: "초과료(기본 매수 초과 청구). 날짜 'YYYY-MM-DD'. 팀 칸이 없다 → vendor_team. 등급 N/NN/S/SS/V. 마감방식 분기/매월/단순마감/반기/1년누적.", vendor: "_업체명", date: "날짜", grade: "등급", hidden: "_hidden=not.is.true",
    cols: ["id", "날짜", "_업체명", "등급", "접수내용", "컬러초과료", "흑백초과료", "합계", "마감방식", "자산번호", "모델명", "기본금액", "기본매수", "초과장당금액", "미수개월수", "미수금액", "특이사항"] },
  overage_adjust: { desc: "초과료 조정 협의. 방문일 'YYYY-MM-DD'. 지역 칸 A~E.", vendor: "_업체명", date: "방문일", team: "지역", hidden: "_hidden=not.is.true",
    cols: ["id", "방문일", "_업체명", "지역", "기종", "현재조건", "제안", "고객반응", "진행상태", "작성자"] },
  recontract: { desc: "재계약. 날짜 'YYYY-MM-DD'. 담당팀 칸은 'C'·'cs강서'·'영업팀' 등 섞임, 지역은 비어 있음 → vendor_team 권장. 계약종료일·갱신상태·갱신위험도·최종상태.", vendor: "_업체명", date: "날짜", team: "담당팀", grade: "등급", hidden: "_hidden=not.is.true",
    cols: ["id", "날짜", "_업체명", "담당팀", "등급", "기종", "계약종료일", "진행상황", "갱신상태", "갱신위험도", "내용", "결과", "제안일자", "제안조건", "후속담당자", "기한", "다음확인일", "최종상태"] },
  bulman: { desc: "불만. 날짜 'YYYY-MM-DD'. 지역 A~D(비어 있는 행 많음). 불만내용·조치내용·최종상태.", vendor: "_업체명", date: "날짜", team: "지역", grade: "등급", hidden: "_hidden=not.is.true",
    cols: ["id", "날짜", "_업체명", "지역", "등급", "불만내용", "불만유형", "불만정도", "조치내용", "처리자", "후속담당자", "다음확인일", "최종상태"] },
  jeomgeom: { desc: "점검 보고(기기 1대=1행). 작성일 'YYYY-MM-DD'. 지역은 A~E 글자. 매수·토너잔량·폐통·여분.", vendor: "_업체명", date: "작성일", team: "지역", grade: "등급", hidden: "_hidden=not.is.true",
    cols: ["id", "작성일", "작성자", "_업체명", "지역", "등급", "모델명", "자산기번", "시리얼넘버", "매수", "토너잔량", "폐통", "여분", "처리내용", "특이사항"] },
  as_records: { desc: "AS 보고. 작성일 'YYYY-MM-DD'. 지역 A~E.", vendor: "_업체명", date: "작성일", team: "지역", grade: "등급", hidden: "_hidden=not.is.true",
    cols: ["id", "작성일", "작성자", "_업체명", "지역", "등급", "모델명", "자산기번", "내용", "처리내용", "특이사항"] },
  service_receptions: { desc: "서비스 접수. receipt_date 'YYYY-MM-DD'. region 은 '수도권A'~'수도권D'·'지방'(= E). type 복합기 AS/IT/원격이관. status 접수/진행중/완료.", vendor: "vendor", date: "receipt_date", team: "region", grade: "grade", hidden: "deleted=is.false",
    cols: ["id", "receipt_date", "author", "vendor", "region", "type", "title", "symptom", "status", "assignee_note", "asset_no", "model", "address", "receiver_name", "field", "paid"] },
  as_tickets: { desc: "일정(방문 계획). date 'YYYY-MM-DD'. team A~E. scheduleType 매월점검/AS/납품철수교체휴가교육/익일AS. status 완료 등. assignee 담당자.", vendor: "vendor", date: "date", team: "team",
    cols: ["id", "date", "time", "team", "vendor", "scheduleType", "issue", "assignee", "status", "address", "model", "grade"] },
  visit_logs: { desc: "방문기록(직원 방문 일지). work_date 'YYYY-MM-DD'. work_kinds 배열(inspection·as·delivery…).", vendor: "vendor", date: "work_date", hidden: "status=neq.cancelled",
    cols: ["id", "work_date", "author", "vendor", "visited", "work_kinds", "machine_count", "note", "grade"] },
  contact_changes: { desc: "담당자·주소 변경. change_date 'YYYY-MM-DD'. region. category 자유 글(주소변경·담당자 변경…). greeting_done 인사 여부.", vendor: "company", date: "change_date", team: "region", hidden: "_hidden=not.is.true",
    cols: ["id", "change_date", "company", "region", "category", "before_text", "after_text", "reason", "author", "greeting_done"] },
  vendor_info: { desc: "임대리스트(기기 1대=1행). 등급 N/NN/S/SS/V, 임대여부 임대중/임대종료/소송, 계약일·종료일·기본금액·모델명·자산번호·기번·키맨·일반전화·시/구. 팀 칸 없음.", vendor: "_업체명", date: "계약일", grade: "등급", hidden: "_hidden=not.is.true",
    cols: ["id", "코드", "_업체명", "등급", "임대여부", "모델명", "자산번호", "기번", "계약일", "종료일", "남은개월", "기본금액", "연평균", "시/구", "주소상세주소", "키맨", "일반전화", "미수금액"] },
  lease_status: { desc: "납품·교체·철수 현황. 납품일·년월·구분·지역·기종·수량·담당자.", vendor: "_업체명", date: "납품일", team: "지역", hidden: "_hidden=not.is.true",
    cols: ["id", "납품일", "년월", "구분", "분류", "지역", "_업체명", "기종", "수량", "담당자", "납품여부", "교체전기종"] },
  pc_expansion: { desc: "PC 확장성(영업 기회). 날짜·지역·등급·세부사양·금액·시기.", vendor: "_업체명", date: "날짜", team: "지역", grade: "등급", hidden: "_hidden=not.is.true",
    cols: ["id", "날짜", "작성자", "_업체명", "지역", "등급", "세부사양", "렌탈or구매or유지보수", "수량", "금액", "시기", "어필 OR 추가영업"] },
  mfp_expansion: { desc: "복합기 확장성(영업 기회). 등록일·미팅지역·거래처등급·영업진행상황·예상 발주금액.", vendor: "_업체명", date: "등록일", team: "미팅지역", grade: "거래처등급", hidden: "_hidden=not.is.true",
    cols: ["id", "등록일", "등록자", "_업체명", "미팅지역", "거래처등급", "품목(원문)", "영업진행상황", "예상 발주금액(만원)", "예상 발주시기(YYYY-MM)", "최종결과(대기 등)", "체크일"] },
  counter_sms_targets: { desc: "마감(카운터) 문자 대상. team A~E. sent_at 보낸 시각, done_at 완료. list_kind '' 일반/'CMS'.", vendor: "vendor", date: "added_at", team: "team",
    cols: ["id", "team", "vendor", "grade_group", "sent_at", "sent_by", "done_at", "done_by", "list_kind", "cms_day"] },
  workin_map_places: { desc: "워킨맵(분기 점검 대상). team A~E, quarter 1~4, kind quarter/monthly/renewal, label G1~G12(G5 완료). name 은 '30S업체명…' 꼴.", vendor: "name", team: "team",
    cols: ["id", "team", "quarter", "kind", "label", "name", "address", "phone", "comment", "visible"] },
  logistics_records: { desc: "물류(납품·교체·철수·여분). 작성일 'YYYY-MM-DD'. 구분·품목·수량.", vendor: "_업체명", date: "작성일", hidden: "_hidden=not.is.true",
    cols: ["id", "작성일", "작성자", "구분", "_업체명", "품목", "수량", "특이사항"] },
};
const OPS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is", "cs"]);
const TEAM_LETTER = (v: string) => { const m = String(v || "").match(/[A-E]/i); return m ? m[0].toUpperCase() : (/지방|CSS/i.test(v) ? "E" : ""); };
const vendorKey = (v: string) => String(v || "").replace(/㈜|\(주\)|\(유\)/g, "").replace(/\([^)]*\)?/g, " ").replace(/^(?:\d{4}\/)?\d+[#/\-\s]*(?:SS|NN|S|N|V)?/i, "").replace(/(?:분기|매월|계약종료|재계약|점검|마감).*$/i, "").replace(/주식회사|유한회사|유한책임회사|재단법인|사단법인|농업회사법인/g, "").replace(/[^0-9a-z가-힣]/gi, "").toLowerCase().slice(0, 12);

const col = (c: string) => (/[^A-Za-z0-9_]/.test(c) ? `"${c}"` : c);
async function rest(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
  return await res.json();
}
const trim = (v: unknown) => { const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); return s.length > 140 ? s.slice(0, 140) + "…" : s; };

async function queryRows(args: Record<string, unknown>) {
  const table = String(args.table || "");
  const cat = CATALOG[table];
  if (!cat) return { error: `허용되지 않은 표: ${table}. 가능한 표: ${Object.keys(CATALOG).join(", ")}` };
  const want = Array.isArray(args.select) ? (args.select as string[]).filter((c) => cat.cols.includes(c)) : [];
  const select = (want.length ? want : cat.cols.slice(0, 14)).map(col).join(",");
  const parts: string[] = [`select=${encodeURIComponent(select)}`];
  const filters = Array.isArray(args.filters) ? (args.filters as Array<Record<string, unknown>>).slice(0, 8) : [];
  for (const f of filters) {
    const c = String(f.col || ""); const op = String(f.op || "eq"); const v = String(f.value ?? "");
    if (!cat.cols.includes(c) || !OPS.has(op)) return { error: `허용되지 않은 조건: ${c} ${op} (표 ${table} 의 칸: ${cat.cols.join(", ")})` };
    const val = op === "in" ? `(${v.split(",").map((x) => `"${encodeURIComponent(x.trim().replace(/"/g, ""))}"`).join(",")})` : op === "like" || op === "ilike" ? encodeURIComponent(v.includes("*") || v.includes("%") ? v : `*${v}*`) : encodeURIComponent(v);
    parts.push(`${encodeURIComponent(col(c))}=${op}.${val}`);
  }
  if (cat.hidden) parts.push(cat.hidden);
  const order = String(args.order || ""); const [oc, od] = order.split(".");
  if (oc && cat.cols.includes(oc)) parts.push(`order=${encodeURIComponent(col(oc))}.${od === "asc" ? "asc" : "desc"}`);
  else if (cat.date) parts.push(`order=${encodeURIComponent(col(cat.date))}.desc`);
  const limit = Math.min(300, Math.max(1, Number(args.limit) || 200));
  parts.push(`limit=${limit}`);
  try {
    const rows = await rest(`${table}?${parts.join("&")}`) as Record<string, unknown>[];
    return { table, count: rows.length, truncated: rows.length >= limit, rows: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, trim(v)]))) };
  } catch (e) { return { error: String((e as Error).message) }; }
}

/** 업체명 → 팀(A~E). 일정·접수·워킨맵·점검 순으로 최근 기록의 팀을 쓴다 */
async function vendorTeam(args: Record<string, unknown>) {
  const vendors = (Array.isArray(args.vendors) ? args.vendors : []).map(String).filter(Boolean).slice(0, 60);
  if (!vendors.length) return { error: "vendors 가 비었습니다" };
  const keyOf = new Map(vendors.map((v) => [vendorKey(v), v]));
  const out: Record<string, { team: string; from: string }> = {};
  const assign = (name: string, team: string, from: string) => { const k = vendorKey(name); const orig = keyOf.get(k); const t = TEAM_LETTER(team); if (orig && t && !out[orig]) out[orig] = { team: t, from }; };
  const inList = `in.(${vendors.map((v) => `"${encodeURIComponent(v.replace(/"/g, ""))}"`).join(",")})`;
  try { (await rest(`as_tickets?select=vendor,team,date&vendor=${inList}&order=date.desc&limit=400`) as Record<string, string>[]).forEach((r) => assign(r.vendor, r.team, "일정")); } catch { /* 무시 */ }
  try { (await rest(`service_receptions?select=vendor,region,receipt_date&vendor=${inList}&deleted=is.false&order=receipt_date.desc&limit=400`) as Record<string, string>[]).forEach((r) => assign(r.vendor, r.region, "접수")); } catch { /* 무시 */ }
  try { (await rest(`jeomgeom?select=${encodeURIComponent('"_업체명",지역,작성일')}&${encodeURIComponent('"_업체명"')}=${inList}&_hidden=not.is.true&order=${encodeURIComponent('"작성일"')}.desc&limit=400`) as Record<string, string>[]).forEach((r) => assign(r["_업체명"], r["지역"], "점검")); } catch { /* 무시 */ }
  const missing = vendors.filter((v) => !out[v]).slice(0, 30);
  for (const v of missing) {
    const core = vendorKey(v).slice(0, 6);
    if (core.length < 2) continue;
    try {
      const rows = await rest(`workin_map_places?select=name,team&name=ilike.*${encodeURIComponent(core)}*&limit=5`) as Record<string, string>[];
      const hit = rows.find((r) => vendorKey(r.name) === vendorKey(v)) || rows[0];
      if (hit) out[v] = { team: TEAM_LETTER(hit.team), from: "워킨맵" };
    } catch { /* 무시 */ }
  }
  return { teams: out, unresolved: vendors.filter((v) => !out[v]) };
}

const TOOLS = [
  { type: "function", name: "query_rows", description: "허용된 표에서 조건으로 행을 읽는다(읽기 전용). 날짜 칸은 텍스트라 gte/lt 로 'YYYY-MM-01' ~ 다음 달 1일로 자른다. ilike 는 부분 일치.",
    parameters: { type: "object", properties: {
      table: { type: "string", enum: Object.keys(CATALOG) },
      select: { type: "array", items: { type: "string" }, description: "받을 칸(생략하면 기본 칸)" },
      filters: { type: "array", items: { type: "object", properties: { col: { type: "string" }, op: { type: "string", enum: Array.from(OPS) }, value: { type: "string", description: "in 은 쉼표로 여러 값" } }, required: ["col", "op", "value"] } },
      order: { type: "string", description: "칸.asc 또는 칸.desc" }, limit: { type: "number" } }, required: ["table"] } },
  { type: "function", name: "vendor_team", description: "업체명 목록의 담당 팀(A~E)을 일정·접수·점검·워킨맵 기록으로 찾는다. 팀 칸이 없거나 비어 있는 표(미수·초과료·임대리스트·재계약)에서 '팀별'로 추릴 때 쓴다.",
    parameters: { type: "object", properties: { vendors: { type: "array", items: { type: "string" } } }, required: ["vendors"] } },
];

const INSTRUCTION = `너는 복합기 렌탈·IT 유지보수 회사 "퍼스트전산"의 사내 데이터 비서다. 직원이 표 전체를 조건으로 추리는 질문을 한다(예: "C팀 미수 중 CS가 체크할 곳", "10월 초과 업체 중 N등급만").
도구로 직접 조회해서 답한다. 지어내지 않는다. 조회 결과에 없으면 없다고 말한다.
요령:
- 팀(A~E): as_tickets.team / service_receptions.region('수도권C'→C, '지방'→E) / jeomgeom.지역 은 믿을 만하다. misu.지역·overage(팀 없음)·vendor_info·recontract 는 팀이 없거나 비어 있으니 먼저 조건(달·등급 등)으로 추린 뒤 vendor_team 으로 팀을 붙여 걸러라.
- 달: 날짜 칸 gte 'YYYY-MM-01' 과 lt '다음달-01'. 올해는 ${new Date().getFullYear()}년, 오늘은 ${new Date().toISOString().slice(0, 10)}.
- "CS가 체크할 곳" 같은 말은 미수 개월·금액이 크거나 약속일이 지난 곳, 최종상태가 비어 있거나 미완료인 곳으로 해석하고, 해석 기준을 답에 적어라.
- 같은 업체가 여러 행이면 업체 단위로 묶어 최신 행 기준으로 말한다.
- 답 형식: 첫 줄 결론(몇 곳, 기준). 그 아래 목록을 "· 업체명 — 핵심 숫자/상태 [출처 날짜]"로 최대 40줄. 마지막에 기준과 빠졌을 수 있는 것 한 줄. 존댓말. 전화번호는 질문이 연락처를 물을 때만.
- 안내 문구·문자 초안을 요청하면 목록 아래에 바로 쓸 수 있는 문구를 한 벌 적는다(업체명 자리는 {업체명}).`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY") || "";
    if (!apiKey) return Response.json({ error: "OPENAI_API_KEY missing" }, { status: 500, headers: jsonHeaders });
    const body = await req.json().catch(() => ({}));
    const question = String(body.question || "").trim().slice(0, 600);
    if (!question) return Response.json({ error: "question 이 필요합니다" }, { status: 400, headers: jsonHeaders });
    const model = Deno.env.get("OPENAI_ASK_MODEL") || Deno.env.get("OPENAI_REPORT_MODEL") || "gpt-5.5";
    const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
    let input: unknown[] = [{ role: "system", content: INSTRUCTION }, { role: "user", content: question }];
    let previous: string | undefined;
    let lastRows: Record<string, unknown>[] = []; let lastTable = ""; const calls: string[] = [];
    for (let round = 0; round < 9; round += 1) {
      const res = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers, body: JSON.stringify({ model, reasoning: { effort: "medium" }, tools: TOOLS, input, ...(previous ? { previous_response_id: previous } : {}) }) });
      if (!res.ok) return Response.json({ error: (await res.text()).slice(0, 300), model }, { status: 502, headers: jsonHeaders });
      const data = await res.json();
      previous = data.id;
      const fnCalls = (data.output || []).filter((o: { type: string }) => o.type === "function_call");
      if (!fnCalls.length) {
        const answer = data.output_text || (data.output || []).flatMap((o: { content?: Array<{ text?: string }> }) => o.content || []).map((c: { text?: string }) => c.text || "").join("\n") || "";
        return Response.json({ answer: String(answer).trim().slice(0, 6000), rows: lastRows.slice(0, 120), table: lastTable, calls, model }, { headers: jsonHeaders });
      }
      input = [];
      for (const call of fnCalls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(call.arguments || "{}"); } catch { /* 빈 인자 */ }
        const result = call.name === "query_rows" ? await queryRows(args) : call.name === "vendor_team" ? await vendorTeam(args) : { error: "모르는 도구" };
        calls.push(`${call.name}(${JSON.stringify(args).slice(0, 160)}) → ${"error" in result ? result.error : "count" in result ? `${result.count}행` : "ok"}`);
        if ("rows" in result && Array.isArray(result.rows) && result.rows.length) { lastRows = result.rows as Record<string, unknown>[]; lastTable = String(result.table || ""); }
        input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result).slice(0, 60000) });
      }
    }
    return Response.json({ error: "조회가 너무 많아 멈췄습니다 — 질문을 좁혀 주세요", calls, model }, { status: 502, headers: jsonHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: jsonHeaders });
  }
});
