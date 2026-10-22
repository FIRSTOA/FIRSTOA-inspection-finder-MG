import { addUsage, emptyUsage, loadPrices, logUsage, priceUsage } from "../_shared/ai-usage.ts";
import GUIDE_PAGES from "../_shared/app-guide.json" with { type: "json" };
import { APP_GUIDE_EXTRA } from "../_shared/app-guide-extra.ts";
import { maskDeep, maskRrn } from "../_shared/privacy.ts";
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
type Cat = { desc: string; cols: string[]; hidden?: string; date?: string; team?: string; grade?: string; vendor: string; long?: boolean };
const CATALOG: Record<string, Cat> = {
  // ── 지식(복합기 기술) — 2026-10-12: "X3220 세로줄 원인", "묻어남 어떻게 처리" 같은 질문의 근거 ──
  knowledge_docs: { desc: "복합기 가이드(기술 문서 450편 — 교체법·체크 순서·설정법·에러 해결, 노션에서 옮긴 것과 웹앱에서 쓴 것). category(실무/시스템 설정 에러…), brand(삼성/제록스/신도/교세라…), title '[브랜드]제목', content 본문(마크다운·순서 글), summary 한 줄, models(쓰는 기종 약칭 글, 예 \"['MX3','MX4']\"), parts(부품 글), symptoms(증상 분류 글), difficulty 쉬움/보통/어려움, author 작성자, updated_at. models·parts·symptoms 는 JSON 이라 조건(ilike)에 못 쓴다 — 조건은 title·content·brand·category 로만. '교체 방법'·'교체법'·'체크 순서'·'셋팅'·'설정'·'어떻게 하나' 질문은 이 표를 가장 먼저 — title 과 content 를 ilike(예: title=ilike.*ACR*, content=ilike.*CTD*)로 찾아 본문 순서를 그대로 근거로 답하고 제목·작성자를 밝힌다. 없을 때만 플레이북·처리이력으로.", vendor: "title", date: "updated_at", long: true,
    cols: ["id", "category", "brand", "title", "summary", "content", "models", "parts", "symptoms", "difficulty", "author", "updated_at"] },
  copier_playbook: { desc: "복합기 증상별 원인·점검 순서·부품 플레이북(브랜드·시리즈·증상 단위 145편, 처리이력에서 뽑은 초안). series 값은 기종이 아니라 계열 약칭이다 — 삼성: MX3(SL-X3220·X3280 계열), MX4(X4220·X4250·X4300), MX7(X7400·X7500·X7600), 9201(CLX-9201·9251), 흑백기(SL-K·SL-M) / 신도: 320·410·420·450·600·N501·bizhub / 제록스: 305·5005·APEOS·마블(DocuCentre-V C2263)·베니(ApeosPort-VI C2271)·보탄(ApeosPort-VII C2273·C3373·C4473·C5573)·세이토(ApeosPort-V C2275·C3375·C5575)·키슈·헤라(ApeosPort-IV C5580) / 교세라: 2100·5521·5526 / 오키: 5473 / HP: 8710·8730·9010 / 브라더: 5700. symptom 값은 '토너·드럼'·'급지·걸림'·'줄·화질'·'에러코드'·'스캔·팩스'·'정착기·롤러'·'네트워크·드라이버'·'소음' 8가지뿐이다(세로줄·묻어남은 '줄·화질' 또는 '토너·드럼'). title '시리즈 · 증상', summary 한 줄 결론, causes JSON[{cause, parts, share(높음/중간/낮음), steps[]}], tips, case_count 근거 사례 수, status 초안/확정. 기종을 series 로 바꿔 series=eq.MX3 처럼 찾고 symptom 은 위 8가지로.", vendor: "title", date: "updated_at", long: true,
    cols: ["id", "brand", "series", "symptom", "title", "summary", "causes", "tips", "case_count", "status", "updated_at"] },
  copier_notes: { desc: "복합기 처리이력·학습 노트(기종별 실제 처리 사례 13,000건). 칸은 brand, model 기종(ilike), kind '처리이력'|'학습', title 증상 한 줄, content '증상/처리/지역/레벨/업체' 글, author 처리자, created_at 처리 날짜 — 이 이름 그대로 쓴다(date·handler 같은 칸은 없다; 날짜는 created_at, 처리자는 author). 증상 낱말로 title·content 를 ilike(예: content=ilike.*세로줄*), 기종으로 model=ilike.*3220*. 최신순 20~40건만 읽고 공통 처리법을 뽑고, 사례에는 created_at 날짜와 author 를 적는다.", vendor: "model", date: "created_at", long: true,
    cols: ["id", "brand", "model", "kind", "title", "content", "author", "created_at"] },
  vendor_notes: { desc: "업체 특이사항(현장 메모). work_start 출근시간은 '9시'·'9시반'·'11시 이후' 같은 글, lunch_time 점심시간도 글('12~1시'), note 는 주차·방문 요령 메모. 글이라 ilike 로 찾고(예: 9시대는 work_start=ilike.*9시* 뒤 사람이 읽어 거른다), 팀은 vendor_team 으로. '출근 시간이 X인 곳'·'점심시간'·'특이사항' 질문은 이 표.", vendor: "vendor", date: "updated_at",
    cols: ["id", "vendor", "work_start", "lunch_time", "note", "author", "pinned", "created_at", "updated_at"] },
  supply_requests: { desc: "부품 신청·자가(여분) 신청 — 점검·AS 양식의 신청 칸을 품목 단위로. kind '부품'|'자가', item 적은 그대로, item_std 표준 품목(토너 K·폐토너통·드럼 K·현상제 C…), qty 수량, stage 신청/지급/반납/불량, issued_at 출고 시각(운영지원), status 출고여부 글, model/serial/asset 기기, team A~E, author 작성자, request_date 'YYYY-MM-DD'. '여분 몇 개'·'부품 뭐 신청'·'드럼 자주 들어간 기기'·'출고 안 된 것' 질문은 이 표. 취소된 행은 빠져 있다.", vendor: "vendor", date: "request_date", team: "team", hidden: "stage=neq.%EC%B7%A8%EC%86%8C",
    cols: ["id", "request_date", "kind", "vendor", "team", "author", "model", "serial", "asset", "item", "item_std", "qty", "stage", "issued_at", "issued_by", "status", "warranty", "counter", "expected", "returned_at", "return_note"] },
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
  pc_expansion: { desc: "PC 확장성(영업 기회, 직원이 올린 건). 날짜는 ISO 타임스탬프('2026-10-08T06:23…') — gte/lt 'YYYY-MM-DD' 로 자르면 된다. 지역 A~E = 팀, 작성자 = 올린 직원. 사람별 건수는 작성자로 센다.", vendor: "_업체명", date: "날짜", team: "지역", grade: "등급", hidden: "_hidden=not.is.true",
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
const KST = 9 * 3600_000;
const kstToday = () => new Date(Date.now() + KST).toISOString().slice(0, 10);
/** 이번 주 월요일~일요일(KST) */
function weekRange() {
  const now = new Date(Date.now() + KST); const dow = (now.getUTCDay() + 6) % 7; // 월=0
  const mon = new Date(now.getTime() - dow * 86_400_000); const sun = new Date(mon.getTime() + 6 * 86_400_000);
  return `${mon.toISOString().slice(0, 10)} ~ ${sun.toISOString().slice(0, 10)} (다음 주 월요일 ${new Date(sun.getTime() + 86_400_000).toISOString().slice(0, 10)} 미만)`;
}
async function rest(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
  return await res.json();
}
const trimTo = (v: unknown, cap: number) => { const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); return s.length > cap ? s.slice(0, cap) + "…" : s; };
const trim = (v: unknown) => trimTo(v, 140);

async function queryRows(args: Record<string, unknown>) {
  const table = String(args.table || "");
  const cat = CATALOG[table];
  if (!cat) return { error: `허용되지 않은 표: ${table}. 가능한 표: ${Object.keys(CATALOG).join(", ")}` };
  const want = Array.isArray(args.select) ? (args.select as string[]).filter((c) => cat.cols.includes(c)) : [];
  // 지식 표는 날짜·처리자를 늘 같이 — 모델이 없는 칸 이름(date·handler)을 골라 사례에 날짜가 빠지던 것(2026-10-12)
  if (cat.long) for (const extra of [cat.date || "", "author"]) if (extra && cat.cols.includes(extra) && want.length && !want.includes(extra)) want.push(extra);
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
  // 지식 표(플레이북·처리이력)는 글이 길어 행은 적게, 글은 길게 돌려준다
  const limit = Math.min(cat.long ? 40 : 300, Math.max(1, Number(args.limit) || (cat.long ? 20 : 200)));
  parts.push(`limit=${limit}`);
  try {
    const rows = await rest(`${table}?${parts.join("&")}`) as Record<string, unknown>[];
    const cap = cat.long ? 1600 : 140;
    // 주민번호 가림(2026-10-22) — 모델이 보는 행과 앱에 돌려주는 행 모두. 조건(filters)은 원본 값으로 걸린다
    return { table, count: rows.length, truncated: rows.length >= limit, rows: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, trimTo(maskDeep(v, k), cap)]))) };
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

/** 팀 인원 명단(cs_members) — 사람별 집계 때 0건인 사람도 빠지지 않게 */
async function teamMembers(args: Record<string, unknown>) {
  const team = String(args.team || "").trim().toUpperCase();
  try {
    const rows = await rest(`cs_members?select=name,team,title,active&active=is.true&order=team.asc,sort.asc&limit=200`) as Array<{ name: string; team: string; title?: string }>;
    const norm = (t: string) => (/^CSS$/i.test(t) ? "E" : String(t || "").toUpperCase());
    const list = rows.filter((r) => !team || norm(r.team) === team || norm(r.team) === (team === "E" ? "CSS" : team)).map((r) => ({ name: r.name, team: norm(r.team), title: r.title || "" }));
    return { team: team || "전체", members: list };
  } catch (e) { return { error: String((e as Error).message) }; }
}

/** 앱 사용설명서(public/guide 21편 + 2026-10 변경분) — topic 낱말로 맞는 편 최대 3개 */
type GuidePage = { key: string; title: string; text: string };
function appGuide(args: Record<string, unknown>) {
  const topic = String(args.topic || "").trim();
  const pages: GuidePage[] = [...(GUIDE_PAGES as GuidePage[]), { key: "recent", title: "2026년 10월 추가·변경(최신)", text: APP_GUIDE_EXTRA }];
  const words = topic.split(/[\s,·/?？]+/).map((w) => w.replace(/(은|는|이|가|을|를|에서|으로|로|의|도)$/, "")).filter((w) => w.length >= 2);
  const score = (p: GuidePage) => words.reduce((n, w) => n + (p.title.includes(w) ? 8 : 0) + Math.min(20, p.text.split(w).length - 1), 0);
  const picked = words.length ? pages.map((p) => ({ p, s: score(p) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 3).map((x) => x.p) : [];
  const list = pages.map((p) => `${p.key}: ${p.title}`).join("\n");
  if (!picked.length) return { pages: list, note: "topic 에 핵심 낱말(예: '자가 반납', '마감 문자', '워킨맵 라벨')을 주면 그 설명서 본문을 돌려줍니다. 최신 변경은 key 'recent'.", recent: APP_GUIDE_EXTRA.slice(0, 7000) };
  return { pages: picked.map((p) => ({ key: p.key, title: p.title, text: p.text.slice(0, 9000) })), all: list };
}

const TOOLS = [
  { type: "function", name: "app_guide", description: "FIELD 앱(이 프로젝트)의 사용설명서 21편과 2026년 10월 변경분. '앱에서 어떻게 해', '어느 탭에서', '자가 반납 절차', '마감 문자 자동 수집', '재고 기종', '워킨맵 라벨' 같은 사용법·절차·구조 질문이면 먼저 부른다. topic 에 핵심 낱말을 띄어쓰기로.",
    parameters: { type: "object", properties: { topic: { type: "string", description: "관심 주제 낱말(예: '자가 반납 사진')" } } } },
  { type: "function", name: "team_members", description: "팀(A~E, E=CSS·지방)의 현재 인원 명단. '팀원별로 몇 건씩' 같은 사람별 집계를 할 때 먼저 불러 0건인 사람도 넣는다. team 을 비우면 전체.",
    parameters: { type: "object", properties: { team: { type: "string" } } } },
  { type: "function", name: "query_rows", description: "허용된 표에서 조건으로 행을 읽는다(읽기 전용). 날짜 칸은 텍스트라 gte/lt 로 'YYYY-MM-01' ~ 다음 달 1일로 자른다. ilike 는 부분 일치.",
    parameters: { type: "object", properties: {
      table: { type: "string", enum: Object.keys(CATALOG) },
      select: { type: "array", items: { type: "string" }, description: "받을 칸(생략하면 기본 칸)" },
      filters: { type: "array", items: { type: "object", properties: { col: { type: "string" }, op: { type: "string", enum: Array.from(OPS) }, value: { type: "string", description: "in 은 쉼표로 여러 값" } }, required: ["col", "op", "value"] } },
      order: { type: "string", description: "칸.asc 또는 칸.desc" }, limit: { type: "number" } }, required: ["table"] } },
  { type: "function", name: "vendor_team", description: "업체명 목록의 담당 팀(A~E)을 일정·접수·점검·워킨맵 기록으로 찾는다. 팀 칸이 없거나 비어 있는 표(미수·초과료·임대리스트·재계약)에서 '팀별'로 추릴 때 쓴다.",
    parameters: { type: "object", properties: { vendors: { type: "array", items: { type: "string" } } }, required: ["vendors"] } },
];

// 표 설명을 모델에게 — desc 가 코드에만 있고 모델에는 안 가고 있었다(2026-10-12). 칸 이름·값 형식·시리즈 약칭이 여기서 전달된다
const CATALOG_TEXT = Object.entries(CATALOG).map(([t, c]) => `- ${t}: ${c.desc}\n  칸: ${c.cols.join(", ")}`).join("\n");
const INSTRUCTION = `너는 복합기 렌탈·IT 유지보수 회사 "퍼스트전산"의 사내 데이터 비서다. 직원이 표 전체를 조건으로 추리는 질문을 한다(예: "C팀 미수 중 CS가 체크할 곳", "10월 초과 업체 중 N등급만").
도구로 직접 조회해서 답한다. 지어내지 않는다. 조회 결과에 없으면 없다고 말한다.
요령:
- 팀(A~E): as_tickets.team / service_receptions.region('수도권C'→C, '지방'→E) / jeomgeom.지역 은 믿을 만하다. misu.지역·overage(팀 없음)·vendor_info·recontract 는 팀이 없거나 비어 있으니 먼저 조건(달·등급 등)으로 추린 뒤 vendor_team 으로 팀을 붙여 걸러라.
- 달: 날짜 칸 gte 'YYYY-MM-01' 과 lt '다음달-01'. 올해는 ${new Date().getFullYear()}년, 오늘(KST)은 ${kstToday()}, 이번 주는 ${weekRange()} (월~일). "이번 주"는 그 범위, "지난주"는 그 전 7일.
- 사람별 집계("팀원별 몇 건씩"): team_members 로 명단을 받고, 표의 작성자/author/등록자/입력자/assignee 칸으로 세어 명단의 모든 사람을 0건까지 적는다. 명단에 없는 작성자가 있으면 "그 외"로 따로 적는다.
- 조회 결과가 limit 에 걸려 잘렸으면(truncated) 조건을 더 좁혀 다시 조회한다(사람별·달별로 나눠서). 잘린 채로 세지 않는다.
- "CS가 체크할 곳" 같은 말은 미수 개월·금액이 크거나 약속일이 지난 곳, 최종상태가 비어 있거나 미완료인 곳으로 해석하고, 해석 기준을 답에 적어라.
- 같은 업체가 여러 행이면 업체 단위로 묶어 최신 행 기준으로 말한다.
- 답 형식: 첫 줄 결론(몇 곳, 기준). 그 아래 목록을 "· 업체명 — 핵심 숫자/상태 [출처 날짜]"로 최대 40줄. 마지막에 기준과 빠졌을 수 있는 것 한 줄. 존댓말. 전화번호는 질문이 연락처를 물을 때만.
- 안내 문구·문자 초안을 요청하면 목록 아래에 바로 쓸 수 있는 문구를 한 벌 적는다(업체명 자리는 {업체명}).
- 복합기 기술 질문은 세 표를 순서대로 쓴다. ① 교체법·절차·설정·체크 순서("ACR 센서 교체법", "토너 공급에러 체크 순서", "9100 포트 설정")는 knowledge_docs(가이드 450편 — title/content ilike, 부품·에러 낱말로 두세 번 다르게 찾아본다)를 먼저 읽고 본문 순서를 그대로 옮겨 답한다. ② 증상 원인("X3220 세로줄 원인", "묻어남")은 copier_playbook(증상별 원인·점검 순서·부품 — series/symptom/title/summary ilike)을 보고 ③ copier_notes(실제 처리이력 — model/title/content ilike, 최신순 20~40건)로 뒷받침한다. 가이드가 있으면 가이드를 답의 뼈대로 쓰고 처리이력은 사례로만 덧붙인다. 답은 "가능한 원인(많은 순) → 현장 점검 순서 → 교체 부품 → 실제 사례 n건(날짜·처리자·한 줄)" 꼴로, 사례가 없으면 플레이북 초안임을 밝힌다. 안전·전원 관련 작업은 전원 차단을 먼저 적는다.
- 이 앱(FIELD)·업무 절차·"어느 탭에서", "어떻게 해" 질문은 app_guide 도구(topic 에 핵심 낱말)로 설명서를 읽고 그대로 답한다. 설명서에 없는 기능은 없다고 말한다. 2026년 10월에 바뀐 것(자가·부품 신청, 마감 목록 자동 수집, 기록 조회 묶음, 재고 기종, 팀 일정 지도)은 key 'recent' 에 있다.
- 회사·팀·사람 질문은 team_members 와 표에서 확인한 것만. 모르는 것은 모른다고 한다.
- 그림(카드·리포트·포스터·안내문)을 "이미지로" 만들어 달라고 하면: 마크다운 코드블록 \`\`\`svg 안에 자체 완결 SVG 하나를 쓴다 — width="1080" height="1350"(세로) 또는 1080×1080, 같은 viewBox, 외부 폰트·이미지·스크립트·링크 없음, font-family="Pretendard, Apple SD Gothic Neo, Malgun Gothic, Noto Sans KR, sans-serif", 글자 크기 22 이상, 한 줄 28자 이내로 상자 밖으로 안 나가게, 긴 주소는 두 줄로. 회사명은 "퍼스트전산"(영문 쓰지 않음). 내용(업체명·기기·주소·증상·날짜)은 기록에 있는 것만. 코드블록 아래에 함께 보낼 문자 문구를 3줄 이내로 한 문단 쓴다. 앱이 그 SVG 를 그림으로 바꿔 저장·복사·문자(MMS) 전송 단추를 보여 주므로 "저장하세요" 같은 설명은 쓰지 않는다.

쓸 수 있는 표와 칸(칸 이름은 이 그대로만 — 없는 칸을 고르면 빠진다):
${CATALOG_TEXT}`;

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
    const t0 = Date.now(); let usage = emptyUsage();   // 왕복마다 누적(2026-10-10)
    for (let round = 0; round < 9; round += 1) {
      const res = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers, body: JSON.stringify({ model, reasoning: { effort: "medium" }, tools: TOOLS, input, ...(previous ? { previous_response_id: previous } : {}) }) });
      if (!res.ok) return Response.json({ error: (await res.text()).slice(0, 300), model }, { status: 502, headers: jsonHeaders });
      const data = await res.json();
      previous = data.id;
      usage = addUsage(usage, data.usage);
      const fnCalls = (data.output || []).filter((o: { type: string }) => o.type === "function_call");
      if (!fnCalls.length) {
        const answer = data.output_text || (data.output || []).flatMap((o: { content?: Array<{ text?: string }> }) => o.content || []).map((c: { text?: string }) => c.text || "").join("\n") || "";
        const sbUrl = Deno.env.get("SUPABASE_URL") || ""; const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
        const sbHeaders = { apikey: sbKey, Authorization: `Bearer ${sbKey}`, "Content-Type": "application/json" };
        const prices = await loadPrices(sbUrl, sbHeaders, (k) => Deno.env.get(k), model);
        const usd = priceUsage(usage, prices);
        await logUsage(sbUrl, sbHeaders, { fn: "data-ask", model, question, author: String(body.author || ""), usage, usd, ms: Date.now() - t0 });
        return Response.json({ answer: maskRrn(String(answer).trim()).slice(0, 6000), rows: maskDeep(lastRows.slice(0, 120)), table: lastTable, calls, model, usage, cost: { usd, priced: prices.known, model } }, { headers: jsonHeaders });
      }
      input = [];
      for (const call of fnCalls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(call.arguments || "{}"); } catch { /* 빈 인자 */ }
        const result = call.name === "query_rows" ? await queryRows(args) : call.name === "vendor_team" ? await vendorTeam(args) : call.name === "team_members" ? await teamMembers(args) : call.name === "app_guide" ? appGuide(args) : { error: "모르는 도구" };
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
