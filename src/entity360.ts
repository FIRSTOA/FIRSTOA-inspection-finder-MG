/**
 * 통합 검색 360 — 자산기번·시리얼·업체명 어느 하나로 "회사에 있는 모든 기록"을 모아 온다 (2026-10-10).
 *
 * 구조(4층)
 *  1. 식별자: 검색어 → 거래처 코드. 기번·자산번호는 lease_ident_code, 이름은 vendor_match_alias·vendor_master, 임대리스트(vendor_info) 직접 조회로 후보를 뽑는다.
 *  2. 키 묶음: 코드 하나에 딸린 이름 변형·기번·자산번호를 전부 모은다(임대리스트 행 + 마스터 별칭) — 표마다 표기가 달라도 같은 업체로 이어진다.
 *  3. 수집: 아래 SOURCES 표마다 "이름 정확 일치 or 기기 번호 일치 or 원문에 기번 포함"으로 한 번씩 조회(병렬). 코드가 직접 들어 있는 표(as_tickets.vendor_code, misu.거래처코드, workin_vendor_code)는 코드로.
 *     이름이 "비슷한" 기록은 따로(loose) 모아 확인용으로 보여 준다 — 조용히 섞지 않는다.
 *  4. 현재 상태: 임대리스트·담당자 변경·미수·초과·재계약·불만·마지막 점검/AS·열린 접수·일정·워킨맵에서 "지금"을 뽑는다(deriveState).
 *
 * 화면은 Search360.tsx. 이 파일은 React 없이 순수 로직 — 테스트 가능(tests/entity360.test.ts).
 */
import { historyCoreName, vendorMatchKey } from "./ids";
import { ACTIVITY_LABELS } from "./operations";
import { selectRows } from "./supabase";

/**
 * 코드 체계가 둘이다(2026-10-10 실측):
 *  - 마스터 코드(10자리, 사업자번호 모양): vendor_master · vendor_match_alias · lease_ident_code · workin_vendor_code · as_tickets.vendor_code · misu.거래처코드
 *  - 임대 코드(5자리): vendor_info.코드 — 관리부 마감 목록 맨 앞 번호("21638 / SL-X7400…")도 이것
 * 둘은 이름으로 잇는다(vendor_master.aliases 가 임대리스트 표기 그대로라 _업체명 in(…) 으로 정확히 붙는다).
 */

export type Row = Record<string, unknown>;
export type Group = "기기·계약" | "현장 기록" | "영업·관리" | "고객 소통" | "기타";
export type SourceDef = {
  table: string; label: string; group: Group; tone: string;
  nameCols: string[];       // 업체명 정확 일치(in) 칸
  deviceCols: string[];     // 기번·자산번호 정확 일치(in) 칸
  phoneCols?: string[];     // 전화번호(숫자만) 정확 일치 칸 — 문자·해피콜처럼 업체명 없이 번호로만 남는 기록
  rawCols: string[];        // 원문 — 기번이 글 속에 있는 경우 ilike
  looseCols?: string[];     // 이름 "비슷한" 기록을 찾을 칸(ilike core) — 기본은 nameCols
  codeCol?: string;         // 거래처 코드가 직접 든 칸
  codeKind?: "master" | "lease"; // codeCol 의 코드 체계(기본 master)
  hidden?: string;          // 숨김·삭제 제외 조건
  dateKeys: string[]; titleKeys: string[]; snippetKeys: string[]; authorKeys: string[]; teamKeys: string[];
  modelKeys: string[]; serialKeys: string[]; assetKeys: string[];
  titleFn?: (row: Row) => string; // 제목을 칸 그대로가 아니라 바꿔 보여야 할 때(활동 종류 코드 → 한글)
  select?: string; limit?: number;
};

const T = {
  lease: "bg-emerald-50 text-emerald-800 border-emerald-200", jeom: "bg-blue-50 text-blue-800 border-blue-200", as: "bg-violet-50 text-violet-800 border-violet-200",
  recv: "bg-sky-50 text-sky-800 border-sky-200", ticket: "bg-indigo-50 text-indigo-800 border-indigo-200", visit: "bg-slate-100 text-slate-700 border-slate-200",
  contact: "bg-amber-50 text-amber-800 border-amber-200", logi: "bg-yellow-50 text-yellow-800 border-yellow-200", bulman: "bg-red-50 text-red-800 border-red-200",
  misu: "bg-orange-50 text-orange-800 border-orange-200", over: "bg-purple-50 text-purple-800 border-purple-200", recon: "bg-rose-50 text-rose-800 border-rose-200",
  exp: "bg-teal-50 text-teal-800 border-teal-200", msg: "bg-lime-50 text-lime-800 border-lime-200", photo: "bg-pink-50 text-pink-800 border-pink-200",
  map: "bg-cyan-50 text-cyan-800 border-cyan-200", note: "bg-stone-100 text-stone-700 border-stone-200",
};

export const SOURCES: SourceDef[] = [
  { table: "vendor_info", label: "임대리스트", group: "기기·계약", tone: T.lease, nameCols: ["_업체명"], deviceCols: ["자산번호", "기번", "시리얼번호(기번)"], rawCols: ["_원문"], codeCol: "코드", codeKind: "lease", hidden: "_hidden=not.is.true",
    dateKeys: ["계약일", "첫계약일"], titleKeys: ["모델명", "기종", "품목"], snippetKeys: ["임대여부", "주소상세주소"], authorKeys: [], teamKeys: [], modelKeys: ["모델명", "기종"], serialKeys: ["기번", "시리얼번호(기번)"], assetKeys: ["자산번호"] },
  { table: "lease_status", label: "납품·교체", group: "기기·계약", tone: T.lease, nameCols: ["_업체명"], deviceCols: [], rawCols: ["_원문"], hidden: "_hidden=not.is.true",
    dateKeys: ["납품일", "년월"], titleKeys: ["구분", "분류"], snippetKeys: ["기종", "품목", "납품여부", "교체전기종"], authorKeys: ["담당자", "납품담당"], teamKeys: ["지역"], modelKeys: ["기종"], serialKeys: [], assetKeys: [] },
  { table: "jeomgeom", label: "점검", group: "현장 기록", tone: T.jeom, nameCols: ["_업체명", "업체명"], deviceCols: ["자산기번", "시리얼넘버"], rawCols: ["_원문"], hidden: "_hidden=not.is.true",
    dateKeys: ["작성일"], titleKeys: ["처리내용", "내용"], snippetKeys: ["특이사항", "매수", "토너잔량"], authorKeys: ["작성자"], teamKeys: ["지역"], modelKeys: ["모델명"], serialKeys: ["시리얼넘버"], assetKeys: ["자산기번"] },
  { table: "as_records", label: "AS", group: "현장 기록", tone: T.as, nameCols: ["_업체명", "업체명"], deviceCols: ["자산기번", "시리얼넘버"], rawCols: ["_원문"], hidden: "_hidden=not.is.true",
    dateKeys: ["작성일"], titleKeys: ["내용", "처리내용"], snippetKeys: ["처리내용", "특이사항"], authorKeys: ["작성자"], teamKeys: ["지역"], modelKeys: ["모델명"], serialKeys: ["시리얼넘버"], assetKeys: ["자산기번"] },
  { table: "service_receptions", label: "접수", group: "현장 기록", tone: T.recv, nameCols: ["vendor"], deviceCols: ["asset_no", "serial"], rawCols: ["symptom", "report_text"], hidden: "deleted=is.false",
    dateKeys: ["receipt_date", "created_at"], titleKeys: ["title", "symptom"], snippetKeys: ["status", "type", "field"], authorKeys: ["author"], teamKeys: ["region"], modelKeys: ["model"], serialKeys: ["serial"], assetKeys: ["asset_no"] },
  // 일정의 note 에는 일정리스트 [완료]로 적은 처리내용(간단처리)이 들어 있다 — AS 보고 없이 여기서 끝난 건이 많다(2026-10-10 잡플러스 10/7)
  { table: "as_tickets", label: "일정", group: "현장 기록", tone: T.ticket, nameCols: ["vendor"], deviceCols: ["serial", "asset"], rawCols: ["issue"], codeCol: "vendor_code",
    dateKeys: ["date"], titleKeys: ["scheduleType"], snippetKeys: ["issue", "status", "assignee", "note"], authorKeys: ["assignee"], teamKeys: ["team"], modelKeys: ["model"], serialKeys: ["serial"], assetKeys: ["asset"],
    titleFn: (row) => `${str(row, "scheduleType") || "일정"}${/완료/.test(str(row, "status")) ? " 완료" : str(row, "status") ? ` · ${str(row, "status")}` : ""}` },
  { table: "visit_logs", label: "방문기록", group: "현장 기록", tone: T.visit, nameCols: ["vendor"], deviceCols: [], rawCols: ["source_text"], hidden: "status=neq.cancelled",
    dateKeys: ["work_date"], titleKeys: ["work_kinds"], snippetKeys: ["note", "machine_count"], authorKeys: ["author"], teamKeys: [], modelKeys: [], serialKeys: [], assetKeys: [] },
  { table: "activity_events", label: "활동", group: "현장 기록", tone: T.visit, nameCols: ["vendor"], deviceCols: [], rawCols: ["source_text"], hidden: "status=neq.cancelled",
    dateKeys: ["activity_date"], titleKeys: ["category"], snippetKeys: ["quantity", "machine_count"], authorKeys: ["author"], teamKeys: ["team"], modelKeys: [], serialKeys: [], assetKeys: [],
    titleFn: (row) => (ACTIVITY_LABELS as Record<string, string>)[str(row, "category")] || str(row, "category") },
  // 부품·자가 신청(2026-10-11) — 점검·AS 양식의 신청 칸을 품목 단위로 쌓은 표. "이 기기 드럼 언제 갈았지"가 바로 나온다
  { table: "supply_requests", label: "부품·자가 신청", group: "현장 기록", tone: T.visit, nameCols: ["vendor", "used_vendor"], deviceCols: ["serial", "asset"], rawCols: ["raw"],
    dateKeys: ["request_date"], titleKeys: ["kind"], snippetKeys: ["status", "warranty", "author"], authorKeys: ["author"], teamKeys: ["team"], modelKeys: ["model"], serialKeys: ["serial"], assetKeys: ["asset"],
    titleFn: (row) => `${str(row, "kind")} ${str(row, "stage") === "지급" ? "지급" : str(row, "stage") === "반납" ? "신청 후 반납" : str(row, "stage") === "불량" ? "불량" : "신청"} — ${str(row, "item_std") || str(row, "item")}${str(row, "qty") ? ` ×${str(row, "qty")}` : ""}${str(row, "used_vendor") && str(row, "used_vendor") !== str(row, "vendor") ? ` (${str(row, "used_vendor")}에 지급)` : ""}` },
  { table: "logistics_records", label: "물류", group: "현장 기록", tone: T.logi, nameCols: ["_업체명", "거래처명"], deviceCols: [], rawCols: ["_원문"], hidden: "_hidden=not.is.true",
    dateKeys: ["작성일"], titleKeys: ["구분"], snippetKeys: ["품목", "수량", "특이사항"], authorKeys: ["작성자"], teamKeys: [], modelKeys: ["품목"], serialKeys: [], assetKeys: [] },
  { table: "contact_changes", label: "담당자·주소 변경", group: "고객 소통", tone: T.contact, nameCols: ["company"], deviceCols: [], rawCols: ["source_text"], hidden: "_hidden=not.is.true",
    dateKeys: ["change_date", "created_at"], titleKeys: ["category"], snippetKeys: ["after_text", "reason"], authorKeys: ["author"], teamKeys: ["region"], modelKeys: [], serialKeys: [], assetKeys: [] },
  { table: "bulman", label: "불만", group: "영업·관리", tone: T.bulman, nameCols: ["_업체명", "업체명"], deviceCols: [], rawCols: ["_원문"], hidden: "_hidden=not.is.true",
    dateKeys: ["날짜", "방문일"], titleKeys: ["불만내용", "불편내용"], snippetKeys: ["조치내용", "최종상태", "불만정도"], authorKeys: ["작성자", "처리자"], teamKeys: ["지역"], modelKeys: ["기종"], serialKeys: [], assetKeys: [] },
  { table: "misu", label: "미수", group: "영업·관리", tone: T.misu, nameCols: ["_업체명", "업체명"], deviceCols: [], rawCols: ["_원문"], codeCol: "거래처코드", hidden: "_hidden=not.is.true",
    dateKeys: ["입력일"], titleKeys: ["미수개월"], snippetKeys: ["미수잔액", "방문내용", "입금약속일"], authorKeys: ["입력자", "작성자"], teamKeys: ["지역"], modelKeys: [], serialKeys: [], assetKeys: [] },
  { table: "overage", label: "초과료", group: "영업·관리", tone: T.over, nameCols: ["_업체명"], deviceCols: ["자산번호"], rawCols: ["_원문"], hidden: "_hidden=not.is.true",
    dateKeys: ["날짜"], titleKeys: ["접수내용"], snippetKeys: ["합계", "마감방식", "특이사항"], authorKeys: [], teamKeys: [], modelKeys: ["모델명"], serialKeys: [], assetKeys: ["자산번호"] },
  { table: "overage_adjust", label: "초과조정", group: "영업·관리", tone: T.over, nameCols: ["_업체명", "업체명"], deviceCols: [], rawCols: ["_원문", "원문"], hidden: "_hidden=not.is.true",
    dateKeys: ["방문일"], titleKeys: ["제안"], snippetKeys: ["진행상태", "현재조건", "고객반응"], authorKeys: ["작성자"], teamKeys: ["지역"], modelKeys: ["기종"], serialKeys: [], assetKeys: [] },
  { table: "recontract", label: "재계약", group: "영업·관리", tone: T.recon, nameCols: ["_업체명", "업체명"], deviceCols: [], rawCols: ["_원문", "원문"], hidden: "_hidden=not.is.true",
    dateKeys: ["날짜", "제안일자"], titleKeys: ["진행상황", "갱신상태"], snippetKeys: ["내용", "결과", "계약종료일"], authorKeys: ["작성자"], teamKeys: ["담당팀", "지역"], modelKeys: ["기종"], serialKeys: [], assetKeys: [] },
  { table: "pc_expansion", label: "PC 확장성", group: "영업·관리", tone: T.exp, nameCols: ["_업체명"], deviceCols: [], rawCols: ["_원문"], hidden: "_hidden=not.is.true",
    dateKeys: ["날짜"], titleKeys: ["렌탈or구매or유지보수", "세부사양"], snippetKeys: ["어필 OR 추가영업", "포인트"], authorKeys: ["작성자"], teamKeys: ["지역"], modelKeys: [], serialKeys: [], assetKeys: [] },
  { table: "mfp_expansion", label: "복합기 확장성", group: "영업·관리", tone: T.exp, nameCols: ["_업체명", "상호"], deviceCols: [], rawCols: ["_원문"], hidden: "_hidden=not.is.true",
    dateKeys: ["등록일", "체크일"], titleKeys: ["품목(원문)", "프로젝트"], snippetKeys: ["영업진행상황", "최종결과(대기 등)"], authorKeys: ["등록자", "전략영업담당자"], teamKeys: ["미팅지역"], modelKeys: [], serialKeys: [], assetKeys: [] },
  // churn_defense(해지방어)·mgmt_support(관리지원)는 아직 빈 표라 칸 이름을 모른다 — 데이터가 생기면 칸을 확인해 넣는다(2026-10-10)
  { table: "counter_sms_targets", label: "마감 문자", group: "고객 소통", tone: T.msg, nameCols: [], deviceCols: [], rawCols: [], looseCols: ["vendor"],
    dateKeys: ["done_at", "sent_at", "added_at"], titleKeys: ["vendor"], snippetKeys: ["team", "sent_by", "done_by"], authorKeys: ["done_by", "sent_by"], teamKeys: ["team"], modelKeys: [], serialKeys: [], assetKeys: [],
    // 한 행이 "목록에 오름 → 문자 보냄 → 완료"를 거친다 — 제목에 지금 단계를 적는다(카운터 사진으로 끝낸 것은 따로, 2026-10-10)
    titleFn: (row) => `${str(row, "vendor")} — ${str(row, "done_at") ? (/카운터 사진/.test(str(row, "done_by")) ? "카운터 사진 전송·완료" : "마감 완료") : str(row, "sent_at") ? "카운터 문자 보냄" : "마감 목록에 오름"}` },
  { table: "counter_sms_contact_rules", label: "연락처 규칙", group: "고객 소통", tone: T.msg, nameCols: ["vendor"], deviceCols: [], rawCols: [], looseCols: ["vendor"],
    dateKeys: ["updated_at", "created_at"], titleKeys: ["kind"], snippetKeys: ["name", "memo"], authorKeys: ["updated_by"], teamKeys: [], modelKeys: [], serialKeys: [], assetKeys: [],
    titleFn: (row) => (str(row, "kind") === "block" ? "🚫 보내지 말 것" : str(row, "kind") === "prefer" ? "⭐ 새 담당" : str(row, "kind")) },
  { table: "happycall_messages", label: "해피콜", group: "고객 소통", tone: T.msg, nameCols: [], deviceCols: [], rawCols: [], phoneCols: ["recipient"],
    dateKeys: ["sent_at", "scheduled_at", "created_at"], titleKeys: ["status"], snippetKeys: ["keyman", "message"], authorKeys: ["author"], teamKeys: [], modelKeys: [], serialKeys: [], assetKeys: [],
    titleFn: (row) => `해피콜 ${str(row, "status") || ""}`.trim() },
  { table: "message_jobs", label: "예약 문자", group: "고객 소통", tone: T.msg, nameCols: ["payload->>vendor"], deviceCols: [], rawCols: [], phoneCols: ["recipient"],
    dateKeys: ["sent_at", "scheduled_at", "created_at"], titleKeys: ["source_type"], snippetKeys: ["status", "channel", "message"], authorKeys: ["created_by"], teamKeys: [], modelKeys: [], serialKeys: [], assetKeys: [],
    titleFn: (row) => ({ happycall: "해피콜 문자", report: "리포트 문자", quarter: "분기 안내", promo: "홍보물" } as Record<string, string>)[str(row, "source_type")] || `문자 ${str(row, "source_type")}` },
  { table: "report_recipients", label: "리포트 수신자", group: "고객 소통", tone: T.msg, nameCols: ["vendor"], deviceCols: [], rawCols: [],
    dateKeys: ["created_at"], titleKeys: ["name"], snippetKeys: ["memo", "active"], authorKeys: [], teamKeys: [], modelKeys: [], serialKeys: [], assetKeys: [],
    titleFn: (row) => `수신자 ${str(row, "name") || "(이름 없음)"}${str(row, "active") === "false" ? " · 해제" : ""}` },
  { table: "report_send_log", label: "리포트 발송", group: "고객 소통", tone: T.msg, nameCols: ["vendor"], deviceCols: [], rawCols: [],
    dateKeys: ["created_at"], titleKeys: ["period"], snippetKeys: ["channel", "recipient_name", "status"], authorKeys: ["sender"], teamKeys: [], modelKeys: [], serialKeys: [], assetKeys: [] },
  // field_sheet_sync_jobs(시트 기입 큐)는 접수·점검 기록의 기술적 사본이라 뺐다 — 무암 한 곳에 2026-07~08 접수 큐가 186건 쌓여 있어 넣으면 기록 수를 왜곡한다(원인 확인 필요)
  { table: "plan_memos", label: "일정 메모", group: "현장 기록", tone: T.ticket, nameCols: [], deviceCols: [], rawCols: [],
    dateKeys: ["updated_at"], titleKeys: ["memo"], snippetKeys: [], authorKeys: ["author"], teamKeys: [], modelKeys: [], serialKeys: [], assetKeys: [] },
  { table: "photo_albums", label: "사진", group: "고객 소통", tone: T.photo, nameCols: ["vendor"], deviceCols: [], rawCols: [],
    dateKeys: ["created_at"], titleKeys: ["category", "source_type"], snippetKeys: [], authorKeys: ["author"], teamKeys: ["region"], modelKeys: [], serialKeys: [], assetKeys: [] },
  { table: "vendor_notes", label: "특이사항", group: "기타", tone: T.note, nameCols: ["vendor"], deviceCols: [], rawCols: [],
    dateKeys: ["updated_at", "created_at"], titleKeys: ["note"], snippetKeys: ["work_start", "lunch_time"], authorKeys: ["author"], teamKeys: [], modelKeys: [], serialKeys: [], assetKeys: [] },
  { table: "workin_map_places", label: "워킨맵", group: "기타", tone: T.map, nameCols: [], deviceCols: [], rawCols: [], looseCols: ["name"],
    dateKeys: ["updated_at"], titleKeys: ["kind"], snippetKeys: ["label", "address", "comment"], authorKeys: ["updated_by"], teamKeys: ["team"], modelKeys: [], serialKeys: [], assetKeys: [] },
  { table: "stock_items", label: "재고", group: "기타", tone: T.note, nameCols: [], deviceCols: [], rawCols: ["name", "note"], hidden: "_hidden=not.is.true",
    dateKeys: ["updated_at", "created_at"], titleKeys: ["name"], snippetKeys: ["kind", "condition", "qty", "note"], authorKeys: ["updated_by"], teamKeys: [], modelKeys: [], serialKeys: [], assetKeys: [] },
];

// ── 문자열·날짜 도우미 ─────────────────────────────────────────
export const str = (row: Row, key: string): string => String(row[key] ?? "").replace(/_x000d_|\r/g, "").trim();
export const firstOf = (row: Row, keys: string[]): string => { for (const k of keys) { const v = str(row, k); if (v && v !== "null") return v; } return ""; };
/** 기번·자산번호 비교 키 — lease_ident_code.ident 와 같은 규칙(소문자, 영숫자만) */
export const identKey = (s: string): string => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
/** 표마다 다른 날짜 형식을 yyyy-mm-dd 로 ("2026.9.3", "26-09-03", ISO 모두). 못 읽으면 "" */
export function dateOf(row: Row, keys: string[]): string {
  const raw = firstOf(row, keys) || str(row, "created_at");
  const m = raw.match(/(\d{4}|\d{2})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
  if (!m) return /^\d{4}-\d{2}/.test(raw) ? raw.slice(0, 10) : "";
  const y = m[1].length === 2 ? `20${m[1]}` : m[1];
  return `${y}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}
export const daysSince = (ymd: string, today = new Date()): number | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const d = new Date(`${ymd}T12:00:00+09:00`).getTime();
  return Number.isFinite(d) ? Math.max(0, Math.floor((today.getTime() - d) / 86_400_000)) : null;
};

// ── PostgREST 조건 조립 ───────────────────────────────────────
// 칸 이름: 한글·괄호는 따옴표로 감싸고, JSON 경로(payload->>vendor)는 그대로 둔다
const col = (c: string) => (c.includes("->") ? c.replace(/[^A-Za-z0-9_>-]/g, "") : encodeURIComponent(/[^A-Za-z0-9_]/.test(c) ? `"${c}"` : c));
export const digitsOnly = (s: string) => String(s || "").replace(/\D/g, "");
/** 글 속 전화번호(휴대폰·일반) → 숫자만. "010-4481-6440 현해리대표님 / 02-123-4567" → ["01044816440","021234567"] */
export const phonesIn = (s: string): string[] => Array.from(new Set((String(s || "").match(/0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/g) || []).map(digitsOnly).filter((d) => d.length >= 9 && d.length <= 11)));
const enc = (v: string) => encodeURIComponent(v);
/** in.("a","b") — 값에 쉼표·괄호·공백이 있어도 안전하게 */
export const inList = (values: string[]) => `in.(${values.map((v) => `"${enc(v.replace(/"/g, ""))}"`).join(",")})`;
const uniq = (xs: string[]) => Array.from(new Set(xs.map((x) => x.trim()).filter((x) => x && x !== "null")));
/** 가장 많이 나온 값(빈 값 제외) */
const mode = (xs: string[]) => { const m = new Map<string, number>(); xs.filter(Boolean).forEach((x) => m.set(x, (m.get(x) || 0) + 1)); return Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || ""; };

// ── 1층: 검색어 → 거래처 코드 후보 ──────────────────────────────
/** code = 마스터 코드(없으면 ""), leaseCode = 임대리스트 코드(없으면 "") — 둘 중 하나는 있다 */
export type Candidate = { code: string; leaseCode: string; name: string; deviceCount: number; how: string };
type MasterRow = { code: string; name: string; aliases?: string[] | null; device_count?: number | null };

export const looksLikeDevice = (q: string) => /^[A-Za-z0-9\-/.#]+$/.test(q) && /\d/.test(q) && q.length >= 3;
/** 느슨 검색용 핵심 이름 — 법인 표기·지점·일반어를 뺀 첫 토큰. "세무법인 건영 논현지점" → "건영" (historyCoreName 은 "세무법인"을 돌려줘 엉뚱한 기록을 끌어왔다) */
const CORE_SKIP = new Set(["주식회사", "유한회사", "유한책임회사", "세무법인", "법무법인", "회계법인", "의료법인", "학교법인", "재단법인", "사단법인", "농업회사법인", "본사", "지점", "지사", "본점", "사무실", "현장", "공장", "센터", "병원", "의원", "학원", "협동조합", "주", "유"]);
export function coreNameOf(name: string): string {
  const tokens = String(name || "").replace(/\([^)]*\)?/g, " ").replace(/㈜|\(주\)|\(유\)/g, " ").split(/[\s/·,\-–—]+/).map((t) => t.replace(/[^0-9a-zA-Z가-힣]/g, "")).filter(Boolean);
  const pick = tokens.find((t) => t.length >= 2 && !CORE_SKIP.has(t) && !/^\d+[a-zA-Z]*$/.test(t)) || tokens.find((t) => t.length >= 2) || "";
  return pick.length >= 2 ? pick.slice(0, 10) : (historyCoreName(name) || "");
}

export async function resolveCandidates(query: string): Promise<Candidate[]> {
  const raw = query.trim();
  if (!raw) return [];
  const ik = identKey(raw);
  const mk = vendorMatchKey(raw);
  const device = looksLikeDevice(raw);
  const safe = <X,>(p: Promise<X[]>) => p.catch(() => [] as X[]);
  const [byIdent, byAlias, byAliasLike, byMaster, byInfo] = await Promise.all([
    device ? safe(selectRows<{ ident: string; code: string }>("lease_ident_code", `select=ident,code&ident=eq.${enc(ik)}&limit=10`)) : Promise.resolve([]),
    mk.length >= 2 ? safe(selectRows<{ akey: string; code: string }>("vendor_match_alias", `select=akey,code&akey=eq.${enc(mk)}&limit=20`)) : Promise.resolve([]),
    mk.length >= 2 ? safe(selectRows<{ akey: string; code: string }>("vendor_match_alias", `select=akey,code&akey=ilike.*${enc(mk)}*&limit=60`)) : Promise.resolve([]),
    raw.length >= 2 ? safe(selectRows<MasterRow>("vendor_master", `select=code,name,aliases,device_count&name=ilike.*${enc(raw)}*&limit=40`)) : Promise.resolve([]),
    // 임대리스트 직접 — ident 표가 아직 없는 새 기기·자산번호 변형 대비
    device ? safe(selectRows<Row>("vendor_info", `select=${enc("코드,_업체명")}&or=(${["자산번호", "기번", "시리얼번호(기번)"].map((c) => `${col(c)}.ilike.*${enc(raw)}*`).join(",")})&_hidden=not.is.true&limit=20`)) : Promise.resolve([]),
  ]);
  const how = new Map<string, string>();           // 마스터 코드 → 근거
  const put = (code: string, reason: string) => { const c = String(code || "").trim(); if (c && !how.has(c)) how.set(c, reason); };
  byIdent.forEach((r) => put(r.code, "기번·자산번호 일치"));
  byAlias.forEach((r) => put(r.code, "업체명 일치"));
  byMaster.forEach((r) => put(r.code, "업체명 포함"));
  byAliasLike.forEach((r) => put(r.code, "업체명 유사"));
  // 임대리스트 직접 일치는 임대 코드(5자리)라 마스터와 다르다 — 이름으로 마스터를 찾아 잇고, 못 찾으면 임대 코드만 가진 후보로 남긴다
  const leaseHits = new Map<string, string>();     // 임대 코드 → 이름
  byInfo.forEach((r) => { const c = str(r, "코드"); if (c && !leaseHits.has(c)) leaseHits.set(c, str(r, "_업체명")); });
  const leaseNames = uniq(Array.from(leaseHits.values()));
  const mastersByName = leaseNames.length ? await safe(selectRows<MasterRow>("vendor_master", `select=code,name,aliases,device_count&or=(name.${inList(leaseNames)},aliases.cs.${encodeURIComponent(JSON.stringify(leaseNames.slice(0, 1)))})&limit=20`)) : [];
  const masterOfName = new Map<string, MasterRow>();
  mastersByName.forEach((m) => { [m.name, ...(Array.isArray(m.aliases) ? m.aliases.map(String) : [])].forEach((n) => masterOfName.set(n, m)); });
  const leaseOnly: Candidate[] = [];
  const leaseCodeOfMaster = new Map<string, string>();
  leaseHits.forEach((name, leaseCode) => {
    const m = masterOfName.get(name);
    if (m) { put(m.code, "임대리스트 기기 번호 일치"); leaseCodeOfMaster.set(m.code, leaseCode); }
    else leaseOnly.push({ code: "", leaseCode, name: name || `임대 코드 ${leaseCode}`, deviceCount: 0, how: "임대리스트 기기 번호 일치" });
  });
  if (!how.size && !leaseOnly.length) return [];
  const codes = Array.from(how.keys()).slice(0, 40);
  const masters = codes.length ? await safe(selectRows<MasterRow>("vendor_master", `select=code,name,aliases,device_count&code=${inList(codes)}`)) : [];
  const byCode = new Map(masters.map((m) => [m.code, m]));
  const rank = (h: string) => ["기번·자산번호 일치", "임대리스트 기기 번호 일치", "업체명 일치", "업체명 포함", "업체명 유사"].indexOf(h);
  return [
    ...codes.map((code) => ({ code, leaseCode: leaseCodeOfMaster.get(code) || "", name: byCode.get(code)?.name || `코드 ${code}`, deviceCount: Number(byCode.get(code)?.device_count || 0), how: how.get(code) || "" })),
    ...leaseOnly,
  ].sort((a, b) => rank(a.how) - rank(b.how) || b.deviceCount - a.deviceCount);
}

/**
 * 질문에서 뽑은 낱말로 업체를 "확실히" 찾았다고 볼 조건(2026-10-10) — 기번·자산번호 일치, 임대리스트 기기 번호 일치, 업체명 비교키 일치,
 * 또는 3글자 이상 낱말이 마스터 업체명에 포함. "업체명 유사"(별칭 부분 일치)는 "출근시간"이 메모가 섞인 별칭에 걸리는 식으로 엉뚱한 업체를 집어 제외한다.
 * 사람이 검색창에 이름을 직접 쳤을 때는 느슨한 후보도 보여 주고, 질문 라우팅에서만 이 조건을 쓴다.
 */
export function isStrongCandidate(c: { how: string }, token: string): boolean {
  if (c.how === "기번·자산번호 일치" || c.how === "임대리스트 기기 번호 일치" || c.how === "업체명 일치") return true;
  if (c.how === "업체명 포함") return String(token || "").trim().length >= 3;
  return false;
}

// ── 2층: 코드 → 키 묶음(이름 변형·기번·자산번호) ──────────────────
export type Entity = {
  code: string; leaseCode: string; name: string; names: string[]; serials: string[]; assets: string[]; core: string; query: string; leaseRows: Row[];
  phones: string[];     // 임대리스트 일반전화·키맨 + 리포트 수신자 번호(숫자만) — 번호로만 남는 문자·해피콜 기록을 잇는다
  nameKeys: string[];   // names 의 vendorMatchKey — "무암"·"주식회사 무암"·"주식회사 무암 (Mooam)" 이 같은 키로 모인다(느슨 일치를 정확으로 승격하는 기준)
  deviceKeys: string[]; // serials+assets 의 identKey
};
export const withKeys = (e: Omit<Entity, "nameKeys" | "deviceKeys" | "phones"> & { phones?: string[] }): Entity => ({
  ...e,
  phones: uniq(e.phones || []),
  nameKeys: uniq([...e.names, e.name].map((n) => vendorMatchKey(n)).filter((k) => k.length >= 2)),
  deviceKeys: uniq([...e.serials, ...e.assets].map(identKey).filter((k) => k.length >= 3)),
});

const leaseQuery = (filter: string) => `select=*&${filter}&_hidden=not.is.true&limit=200`;

export async function buildEntity(candidate: Candidate | null, query: string): Promise<Entity> {
  const raw = query.trim();
  if (!candidate) {
    // 코드를 못 찾은 검색어 — 그래도 이름·번호 그대로 모든 표를 뒤진다(임대리스트에 없는 업체·옛 기기)
    const device = looksLikeDevice(raw);
    return withKeys({ code: "", leaseCode: "", name: raw, names: device ? [] : [raw], serials: device ? [raw] : [], assets: device ? [raw] : [], phones: phonesIn(raw), core: device ? "" : (coreNameOf(raw) || raw), query: raw, leaseRows: [] });
  }
  const safeRows = (p: Promise<Row[]>) => p.catch(() => [] as Row[]);
  const master = candidate.code ? (await selectRows<MasterRow>("vendor_master", `select=code,name,aliases&code=eq.${enc(candidate.code)}&limit=1`).catch(() => [] as MasterRow[]))[0] : undefined;
  const masterNames = uniq([master?.name || "", ...(Array.isArray(master?.aliases) ? master!.aliases!.map(String) : [])]);
  // 임대리스트 행: 임대 코드로, 그리고 마스터 이름·별칭(임대리스트 표기 그대로)으로 — 두 코드 체계를 여기서 잇는다
  const [byLeaseCode, byNames] = await Promise.all([
    candidate.leaseCode ? safeRows(selectRows<Row>("vendor_info", leaseQuery(`${col("코드")}=eq.${enc(candidate.leaseCode)}`))) : Promise.resolve([] as Row[]),
    masterNames.length ? safeRows(selectRows<Row>("vendor_info", leaseQuery(`${col("_업체명")}=${inList(masterNames.slice(0, 25))}`))) : Promise.resolve([] as Row[]),
  ]);
  const seen = new Set<string>();
  const leaseRows = [...byLeaseCode, ...byNames].filter((r) => { const k = String(r.id); if (seen.has(k)) return false; seen.add(k); return true; });
  const leaseCode = candidate.leaseCode || mode(leaseRows.map((r) => str(r, "코드")));
  // 마스터 코드가 없던 임대 전용 후보 — 이제 이름으로 한 번 더 찾아 본다(별칭 표에 같은 키가 있으면)
  let code = candidate.code;
  const firstName = master?.name || candidate.name || str(leaseRows[0] || {}, "_업체명");
  if (!code && firstName) {
    const hit = await selectRows<{ code: string }>("vendor_match_alias", `select=code&akey=eq.${enc(vendorMatchKey(firstName))}&limit=1`).catch(() => [] as { code: string }[]);
    code = hit[0]?.code || "";
  }
  const names = uniq([master?.name || candidate.name, ...masterNames, ...leaseRows.map((r) => str(r, "_업체명"))]).slice(0, 25);
  const serials = uniq(leaseRows.flatMap((r) => [str(r, "기번"), str(r, "시리얼번호(기번)")]).filter((v) => v.length >= 4 && !/^미부착|^없음|트레이/.test(v))).slice(0, 15);
  const assets = uniq(leaseRows.map((r) => str(r, "자산번호")).filter((v) => v.length >= 3 && !/^미부착|^없음/.test(v))).slice(0, 15);
  if (looksLikeDevice(raw) && !serials.some((s) => identKey(s) === identKey(raw)) && !assets.some((a) => identKey(a) === identKey(raw))) serials.push(raw);
  const name = master?.name || candidate.name || firstName;
  // 전화번호 — 임대리스트(일반전화·키맨 글) + 리포트 수신자. 번호로만 남는 해피콜·예약 문자를 이 업체에 붙이는 열쇠
  const recipients = names.length ? await safeRows(selectRows<Row>("report_recipients", `select=phone&vendor=${inList(names.slice(0, 25))}&limit=50`)) : [];
  const phones = uniq([...leaseRows.flatMap((r) => [...phonesIn(str(r, "일반전화")), ...phonesIn(str(r, "키맨"))]), ...recipients.map((r) => digitsOnly(str(r, "phone")))]).filter((p) => p.length >= 9).slice(0, 20);
  return withKeys({ code, leaseCode, name, names, serials, assets, phones, core: coreNameOf(name) || vendorMatchKey(name).slice(0, 6) || name, query: raw, leaseRows });
}

/** 질문 문장에서 업체·기기 번호로 보이는 말을 뽑는다 — "잡플러스 AS 몇 번 터졌어?" → ["잡플러스"]. 긴 말·기기 번호 우선 */
const QUESTION_STOP = new Set(["몇번", "언제", "어디", "무슨", "어떤", "얼마", "얼마나", "있어", "있었", "있나", "터졌", "알려", "정리", "요약", "임대", "점검", "미수", "초과료", "초과", "재계약", "불만", "접수", "일정", "기기", "복합기", "문제", "처리", "이력", "업체", "회사", "사용", "이동", "그전", "주로", "최근", "지금", "현재", "계약", "시작", "토너", "용지", "담당자", "키맨", "주소", "전화", "번호", "리포트", "해피콜", "방문", "횟수", "이번", "지난", "달에", "년에", "해줘", "줄래", "알아", "말해", "설명", "여긴", "여기", "거긴", "거기", "이곳", "그곳", "우리", "이건", "그건", "뭐야", "뭐지", "어때", "어떻게", "경우", "상태", "기록", "내용", "전체", "모두", "전부", "첫", "마지막", "정도",
  // 2026-10-10: "출근시간 9시~10시 사이인 곳들 어디야"가 "출근시간"으로 엉뚱한 업체(나인핏)에 붙었다 — 항목 이름·조건 말은 업체명이 아니다
  "출근", "출근시간", "점심", "점심시간", "특이사항", "메모", "시간", "곳들", "사이", "이상", "이하", "미만", "넘는", "조건", "기본", "컬러", "흑백", "매수", "등급", "지역", "분기", "리스트", "목록", "현황", "통계", "개수", "건수", "순위", "평균", "합계", "업체들", "회사들"]);
export function entityTokensFromQuestion(question: string): string[] {
  const q = String(question || "");
  const codes = (q.match(/[A-Za-z0-9][A-Za-z0-9\-/.]{2,}/g) || []).filter(looksLikeDevice);
  const words = (q.match(/[가-힣]{2,}/g) || [])
    // "사이인곳들"·"넘는곳"처럼 조건+곳이 붙은 말은 업체명이 아니다 — 곳/인곳/한곳 꼬리를 먼저 뗀다(2026-10-10)
    .map((w) => w.replace(/(인곳들|인곳|한곳들|한곳|인데들|곳들|곳)$/, ""))
    .map((w) => w.replace(/(에서는|에서|에게|한테|이랑|부터|까지|으로|께서|은|는|이|가|을|를|의|에|도|만|요|로)$/, ""))
    // 서술어("터졌어"·"있었나요"·"알려줘")는 업체명이 아니다 — 흔한 어미를 떼고 멈춤말 목록과 다시 비교
    .map((w) => w.replace(/(했었어요|했어요|했었어|했어|했나|했지|했니|됐어|됐나|되나|되지|였어|이었어|있었어|있어요|있나요|었어요|았어요|었어|았어|어요|나요|는지|던데|는데|습니까|습니다|세요|어|나|지|니|죠|네|죠)$/, ""))
    .filter((w) => w.length >= 2 && !QUESTION_STOP.has(w) && !/^(몇|언제|어디|무슨|어떤|얼마)/.test(w) && !/(터졌|있었|했|됐|알려|말해|보여|찾아|정리|요약|설명)$/.test(w));
  return uniq([...codes, ...words.sort((a, b) => b.length - a.length)]).slice(0, 6);
}

// ── 3층: 표마다 모으기 ────────────────────────────────────────
export type SourceResult = { source: SourceDef; exact: Row[]; loose: Row[]; ok: boolean; error?: string; rawSkipped?: boolean };

const tail = (src: SourceDef) => `${src.hidden ? `&${src.hidden}` : ""}&limit=${src.limit || 400}`;

/** 정확 조건: 코드 eq · 이름 in · 기기 번호 in — 전부 짧은 칸이라 빠르다(원문 검색은 buildRawQuery 로 따로) */
export function buildExactQuery(src: SourceDef, e: Entity): string | null {
  const parts: string[] = [];
  const codeValue = src.codeKind === "lease" ? e.leaseCode : e.code;
  if (src.codeCol && codeValue) parts.push(`${col(src.codeCol)}.eq.${enc(codeValue)}`);
  if (e.names.length) src.nameCols.forEach((c) => parts.push(`${col(c)}.${inList(e.names)}`));
  const devices = uniq([...e.serials, ...e.assets]);
  if (devices.length) src.deviceCols.forEach((c) => parts.push(`${col(c)}.${inList(devices)}`));
  if (e.phones.length && src.phoneCols) src.phoneCols.forEach((c) => parts.push(`${col(c)}.${inList(e.phones)}`));
  if (!parts.length) return null;
  return `select=${src.select || "*"}&or=(${parts.join(",")})${tail(src)}`;
}
/**
 * 원문 속 기번 검색 — 큰 글 칸을 ilike 로 훑어 느리다(2026-10-10: 잡플러스 기번 3개로 jeomgeom 이 statement timeout).
 * 그래서 따로 던지고 실패해도 정확 결과는 살린다. 길고 고유한 기번 2개만 쓴다. jeomgeom 은 기번 배열(_기번목록) 겹침 검색이 있어 그걸 쓴다.
 */
export function buildRawQuery(src: SourceDef, e: Entity): string | null {
  const devices = uniq([...e.serials, ...e.assets]);
  if (src.table === "jeomgeom" && devices.length) {
    return `select=${src.select || "*"}&${col("_기번목록")}=ov.{${devices.slice(0, 12).map((d) => `"${enc(d.replace(/"/g, ""))}"`).join(",")}}${tail(src)}`;
  }
  const longKeys = e.serials.filter((s) => s.length >= 7).slice(0, 2);
  if (!longKeys.length || !src.rawCols.length) return null;
  const parts = longKeys.flatMap((s) => src.rawCols.map((c) => `${col(c)}.ilike.*${enc(s)}*`));
  return `select=${src.select || "*"}&or=(${parts.join(",")})${src.hidden ? `&${src.hidden}` : ""}&limit=${Math.min(src.limit || 400, 200)}`;
}
/**
 * 느슨 일치를 정확으로 승격하는 기준 — 이름 키가 같거나(표기만 다름) 기기 번호가 같으면 같은 업체·기기다.
 * 이름 키가 "앞부분만 같은" 경우도 짧은 쪽이 5자 이상이면 같은 업체로 본다: "세무법인건영" ⊂ "세무법인건영논현지점"(2026-10-10 건영 특이사항이 안 보이던 사고).
 * 4자 이하("세무법인"·"주식회사")는 너무 흔해 안 쓴다.
 */
export const sameVendorKey = (a: string, b: string): boolean => {
  if (!a || !b) return false;
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= 5 && l.startsWith(s);
};
export function matchesEntity(src: SourceDef, row: Row, e: Entity): boolean {
  const nameCols = uniq([...src.nameCols, ...(src.looseCols || []), ...src.titleKeys.filter((k) => /vendor|업체|상호|company|name/.test(k))]);
  for (const c of nameCols) { const v = str(row, c); if (v && e.nameKeys.some((k) => sameVendorKey(k, vendorMatchKey(v)))) return true; }
  for (const c of [...src.serialKeys, ...src.assetKeys]) { const v = identKey(str(row, c)); if (v.length >= 3 && e.deviceKeys.includes(v)) return true; }
  const list = row["_기번목록"];
  if (Array.isArray(list) && list.some((v) => e.deviceKeys.includes(identKey(String(v))))) return true;
  return false;
}
export function buildLooseQuery(src: SourceDef, e: Entity): string | null {
  const cols = src.looseCols || src.nameCols;
  if (!e.core || e.core.length < 2 || !cols.length) return null;
  return `select=${src.select || "*"}&or=(${cols.map((c) => `${col(c)}.ilike.*${enc(e.core)}*`).join(",")})${src.hidden ? `&${src.hidden}` : ""}&limit=${src.limit || 200}`;
}

async function gatherWorkin(e: Entity): Promise<Row[]> {
  // 워킨맵은 코드 매칭표(workin_vendor_code)로 정확히 — 이름은 "30S업체명/메모" 표기라 정확 일치가 안 된다
  if (!e.code) return [];
  const links = await selectRows<{ place_id: number }>("workin_vendor_code", `select=place_id&code=eq.${enc(e.code)}&limit=50`).catch(() => [] as { place_id: number }[]);
  if (!links.length) return [];
  return selectRows<Row>("workin_map_places", `select=*&id=in.(${links.map((l) => l.place_id).join(",")})&limit=50`).catch(() => [] as Row[]);
}

export async function gather(e: Entity): Promise<SourceResult[]> {
  const results = await Promise.all(SOURCES.filter((s) => s.table !== "plan_memos").map(async (src): Promise<SourceResult> => {
    try {
      let exact: Row[] = src.table === "vendor_info" ? e.leaseRows : [];
      if (src.table === "workin_map_places") exact = await gatherWorkin(e);
      else if (src.table !== "vendor_info" || !e.leaseRows.length) {
        const q = buildExactQuery(src, e);
        if (q) exact = await selectRows<Row>(src.table, q);
      }
      const seen = new Set(exact.map((r) => String(r.id)));
      const add = (rows: Row[], into: Row[]) => rows.forEach((r) => { const k = String(r.id); if (!seen.has(k)) { seen.add(k); into.push(r); } });
      // 원문 속 기번 — 느릴 수 있어 따로. 실패해도 정확 결과는 그대로 둔다
      let rawSkipped = false;
      const rq = buildRawQuery(src, e);
      if (rq) {
        try { add(await selectRows<Row>(src.table, rq), exact); } catch { rawSkipped = true; }
      }
      // 이름이 비슷한 기록 — 표기만 다른 같은 업체(이름 키 일치)나 같은 기기(번호 일치)는 정확으로 올리고, 나머지만 "확인 필요"로
      const loose: Row[] = [];
      const lq = buildLooseQuery(src, e);
      if (lq) {
        const promoted: Row[] = [];
        for (const r of await selectRows<Row>(src.table, lq)) {
          if (seen.has(String(r.id))) continue;
          (matchesEntity(src, r, e) ? promoted : loose).push(r);
        }
        add(promoted, exact);
      }
      return { source: src, exact, loose, ok: true, rawSkipped };
    } catch (err) {
      return { source: src, exact: [], loose: [], ok: false, error: (err as Error).message.slice(0, 120) };
    }
  }));
  // 일정 메모는 일정(as_tickets) id 로만 이어진다 — 일정 결과가 나온 뒤 2차로
  const memoSrc = SOURCES.find((s) => s.table === "plan_memos")!;
  const ticketIds = (results.find((r) => r.source.table === "as_tickets")?.exact || []).map((r) => String(r.id)).filter(Boolean).slice(0, 100);
  let memos: SourceResult = { source: memoSrc, exact: [], loose: [], ok: true };
  if (ticketIds.length) {
    try {
      const rows = await selectRows<Row>("plan_memos", `select=*&ticket_id=${inList(ticketIds)}&limit=200`);
      memos = { source: memoSrc, exact: rows.filter((r) => str(r, "memo")).map((r) => ({ ...r, id: `${str(r, "ticket_id")}|${str(r, "author")}` })), loose: [], ok: true };
    } catch (err) { memos = { source: memoSrc, exact: [], loose: [], ok: false, error: (err as Error).message.slice(0, 120) }; }
  }
  return [...results, memos];
}

// ── 기종 참고 자료 — 이 업체 기기의 기종으로 처리이력·가이드·족보를 찾는다(업체 기록은 아니지만 현장에서 같이 본다) ──
export type ModelRef = { model: string; key: string; notes: { count: number; titles: string[] }; docs: { count: number; titles: string[] }; playbook: { count: number; titles: string[] } };
/** "SL-X3220NR" → "3220", "DOCUCENTRE-V C2263(마블)" → "2263", "MFC-L5700DN" → "5700" — 기종 표에 공통으로 들어가는 숫자 핵심 */
export const modelKey = (model: string): string => {
  const m = String(model || "").toUpperCase().match(/[A-Z]{0,2}(\d{3,4})[A-Z]{0,3}/g) || [];
  const core = m.map((x) => x.replace(/^[A-Z]*/, "").replace(/[A-Z]*$/, "")).find((d) => d.length >= 3 && d.length <= 4) || "";
  return core;
};
export async function gatherModelRefs(e: Entity): Promise<ModelRef[]> {
  const models = uniq(e.leaseRows.map((r) => str(r, "모델명") || str(r, "기종")));
  const keys = new Map<string, string>();
  models.forEach((m) => { const k = modelKey(m); if (k && !keys.has(k)) keys.set(k, m); });
  const safe = (p: Promise<Row[]>) => p.catch(() => [] as Row[]);
  return Promise.all(Array.from(keys.entries()).slice(0, 6).map(async ([key, model]) => {
    const [notes, docs, play] = await Promise.all([
      safe(selectRows<Row>("copier_notes", `select=id,title,model&model=ilike.*${enc(key)}*&order=created_at.desc&limit=60`)),
      safe(selectRows<Row>("knowledge_docs", `select=id,title&title=ilike.*${enc(key)}*&order=created_at.desc&limit=60`)),
      safe(selectRows<Row>("copier_playbook", `select=id,title,series&or=(series.ilike.*${enc(key)}*,title.ilike.*${enc(key)}*)&limit=60`)),
    ]);
    const pick = (rows: Row[]) => ({ count: rows.length, titles: rows.slice(0, 4).map((r) => str(r, "title")).filter(Boolean) });
    return { model, key, notes: pick(notes), docs: pick(docs), playbook: pick(play) };
  }));
}

// ── 첫 화면용: 표별 전체 건수(HEAD count) ─────────────────────
export async function countRows(table: string, hidden?: string): Promise<number | null> {
  const { SUPABASE_ANON, SUPABASE_URL } = await import("./supabase");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id${hidden ? `&${hidden}` : ""}&limit=1`, { method: "HEAD", headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, Prefer: "count=exact" } }).catch(() => null);
  if (!res || !res.ok) return null;
  const total = Number((res.headers.get("content-range") || "").split("/")[1]);
  return Number.isFinite(total) ? total : null;
}

// ── 사건(타임라인 한 줄) ───────────────────────────────────────
export type EventItem = { key: string; source: SourceDef; row: Row; date: string; title: string; snippet: string; author: string; team: string; model: string; serial: string; asset: string; vendor: string; loose: boolean };

export function toEvent(src: SourceDef, row: Row, loose: boolean): EventItem {
  const title = src.titleFn ? src.titleFn(row) : firstOf(row, src.titleKeys);
  const snippet = src.snippetKeys.map((k) => { const v = str(row, k); return v && v !== title ? v : ""; }).filter(Boolean).join(" · ");
  return {
    key: `${src.table}:${String(row.id ?? "")}`, source: src, row, loose,
    date: dateOf(row, src.dateKeys), title: title.slice(0, 160), snippet: snippet.slice(0, 220),
    author: firstOf(row, src.authorKeys), team: firstOf(row, src.teamKeys),
    model: firstOf(row, src.modelKeys), serial: firstOf(row, src.serialKeys), asset: firstOf(row, src.assetKeys),
    vendor: firstOf(row, [...src.nameCols, ...(src.looseCols || [])]),
  };
}
/** 이 기록의 업체가 검색한 업체와 다른가 — 같은 자산기번이 다른 업체에서 쓰이던 이력(이동 기기)을 표시할 때 */
export const isOtherVendor = (ev: EventItem, e: Entity): boolean => {
  if (!ev.vendor) return false;
  const k = vendorMatchKey(ev.vendor);
  return k.length >= 2 && !e.nameKeys.includes(k) && !e.nameKeys.some((nk) => nk.includes(k) || k.includes(nk));
};
export function toEvents(results: SourceResult[]): EventItem[] {
  const list: EventItem[] = [];
  for (const r of results) {
    r.exact.forEach((row) => list.push(toEvent(r.source, row, false)));
    r.loose.forEach((row) => list.push(toEvent(r.source, row, true)));
  }
  return list.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}
export const rawTextOf = (row: Row): string => str(row, "_원문") || str(row, "원문") || str(row, "source_text") || str(row, "report_text") || str(row, "symptom") || str(row, "content") || str(row, "note") || "";

// ── 4층: 현재 상태 ────────────────────────────────────────────
export type Device = { model: string; asset: string; serial: string; start: string; end: string; monthsLeft: string; fee: string; status: string; grade: string; lastInspect: string; lastAs: string };
export type State = {
  address: string; addressFrom: string; keyman: string; keymanFrom: string; tel: string; grade: string; leaseStatus: string;
  devices: Device[];
  misu: { months: string; amount: string; date: string } | null;
  overage: { amount: string; date: string } | null;
  recontract: { status: string; end: string; date: string } | null;
  bulman: { date: string; status: string; text: string } | null;
  lastInspect: string; lastAs: string; lastAsFrom: string; lastVisit: string;
  openReceptions: number; upcomingTickets: number; changes: number; photos: number;
  /** 워킨맵 등록 — (팀·분기·종류·라벨)별로 묶어 개수와 함께. 기기 1대=장소 1개라 웍스피어처럼 34개가 나란히 뜨던 것(2026-10-10) */
  workin: { team: string; quarter: string; kind: string; label: string; count: number }[];
  /** 부품·자가 신청 요약 — 종류별 건수와 최근 품목(2026-10-11) */
  supplies: { kind: string; count: number; items: string[]; last: string }[];
  /** 현장 메모 — 특이사항(출근·점심·주의), 워킨맵 메모 줄, 임대리스트 추가조건. 상태 카드에 바로 보인다(2026-10-10 "출근시간·특이사항 안 나오나") */
  notes: { kind: "연락금지" | "특이사항" | "워킨맵" | "임대조건"; text: string; from: string; pinned: boolean }[];
  counts: { label: string; group: Group; exact: number; loose: number; ok: boolean; rawSkipped: boolean }[];
  total: number; oldest: string; newest: string;
};

/** 부품·자가 신청 요약 — 종류별 건수, 최근 품목 6개("드럼 ×1"), 마지막 날짜 */
export function summarizeSupplies(rows: Row[]): { kind: string; count: number; items: string[]; last: string }[] {
  const by = new Map<string, Row[]>();
  for (const r of rows) { const k = str(r, "kind") || "부품"; by.set(k, [...(by.get(k) || []), r]); }
  return Array.from(by.entries()).map(([kind, list]) => {
    const sorted = [...list].sort((a, b) => str(b, "request_date").localeCompare(str(a, "request_date")));
    const items = uniq(sorted.map((r) => `${str(r, "item")}${str(r, "qty") ? ` ×${str(r, "qty")}` : ""}`)).slice(0, 6);
    return { kind, count: list.length, items, last: str(sorted[0], "request_date") };
  }).sort((a, b) => (a.kind === "부품" ? -1 : 1) - (b.kind === "부품" ? -1 : 1));
}

// ── 워킨맵 묶기 — 기기 1대 = 장소 1개라 그대로 보여 주면 웍스피어는 34줄이 된다(2026-10-10) ──
const KIND_KO: Record<string, string> = { quarter: "분기점검", monthly: "매월점검", renewal: "재계약" };
/** (팀·분기·종류·라벨)별 개수. 최신 분기가 앞 */
export function summarizeWorkin(rows: Row[]): { team: string; quarter: string; kind: string; label: string; count: number }[] {
  const m = new Map<string, { team: string; quarter: string; kind: string; label: string; count: number }>();
  for (const r of rows) {
    const team = str(r, "team"), quarter = str(r, "quarter"), kind = KIND_KO[str(r, "kind")] || str(r, "kind"), label = str(r, "label");
    const k = `${team}|${quarter}|${kind}|${label}`;
    const cur = m.get(k) || { team, quarter, kind, label, count: 0 }; cur.count += 1; m.set(k, cur);
  }
  return Array.from(m.values()).sort((a, b) => Number(b.quarter) - Number(a.quarter) || b.count - a.count);
}
/**
 * 워킨맵 메모 → 현장 메모 줄. 임대리스트에서 온 꼬리표(방문주기·계약종료·미수·한조/틴텍·연평균·임대료·납품교체일…)는 **최신 분기의 장소들을 모아 한 줄로**,
 * 사람이 쓴 글(엘베 없음·몇 층…)만 따로 한 줄씩(중복 제거). 기기 줄(comment: 모델/기번/IP)은 ② 기기 카드가 있으니 여기선 뺀다.
 */
export function workinNotes(rows: Row[], e: Entity): { kind: "워킨맵"; text: string; from: string; pinned: boolean }[] {
  if (!rows.length) return [];
  const latestQ = Math.max(...rows.map((r) => Number(str(r, "quarter")) || 0));
  const latestRows = rows.filter((r) => (Number(str(r, "quarter")) || 0) === latestQ);
  const team = str(latestRows[0], "team");
  const tags = new Map<string, Set<string>>();
  const free = new Set<string>();
  const put = (k: string, v: string) => { const s = (v || "").trim(); if (!s) return; if (!tags.has(k)) tags.set(k, new Set()); tags.get(k)!.add(s.replace(/(\d+)\.\d{3,}/g, "$1")); };
  const skip = (m: string) => /^(N|NN|S|SS|V|일반|임대중|임대종료|소송|매월|분기|재계약|복합기확장성|IT확장성|\/IT확장성|복합기확장성\/IT확장성|\d{1,6}|\/)$/.test(m)
    || /^(서울|경기|인천|부산|대구|대전|광주|울산|세종|강원|충북|충남|전북|전남|경북|경남|제주)/.test(m)
    || /^(강남|강서|경기|지방|CSS)$/.test(m)
    || e.nameKeys.includes(vendorMatchKey(m));
  for (const r of latestRows) {
    const memos = Array.isArray(r.memos) ? (r.memos as unknown[]).map(String).map((x) => x.trim()).filter(Boolean) : [];
    for (const m of memos) {
      if (skip(m)) continue;
      let hit: RegExpMatchArray | null;
      if ((hit = m.match(/^방문주기\s*(.+)$/))) put("방문주기", hit[1]);
      else if ((hit = m.match(/^계약종료년월\s*\/?\s*(\S+)/))) put("계약종료", hit[1]);
      else if ((hit = m.match(/^미수금\s*(\S+?)\s*\/\s*(\S+)/))) put("미수", `${hit[1]} / ${hit[2]}`);
      else if ((hit = m.match(/^한조\s*(\S+?)\s*\/?\s*틴텍\s*(\S+)/))) { put("한조", hit[1]); put("틴텍", hit[2]); }
      else if ((hit = m.match(/^연평균(\S+?)거래처$/))) put("연평균", hit[1].replace(/(만원)(이상|이하)/, "$1 $2"));
      else if ((hit = m.match(/^기본임대료\s*(\S+?)\s*\/\s*연평균임대료\s*(\S+?)\s*\/\s*컬러기본\s*(\S+?)\s*\/\s*흑백기본\s*(\S+)/))) { put("기본", hit[1]); put("컬러기본", hit[3]); put("흑백기본", hit[4]); }
      else if ((hit = m.match(/^납품교체일\s*[:：]\s*(.+)/))) put("납품교체일", hit[1]);
      else if ((hit = m.match(/^유지보수업체\s*[:：]\s*(.+)/))) put("유지보수", hit[1]);
      else if ((hit = m.match(/^장비소유주\s*[:：]\s*(.+)/))) put("소유주", hit[1]);
      else free.add(m.replace(/\s+/g, " ").slice(0, 120));
    }
  }
  const order = ["방문주기", "계약종료", "미수", "한조", "틴텍", "연평균", "기본", "컬러기본", "흑백기본", "납품교체일", "유지보수", "소유주"];
  const summary = order.filter((k) => tags.has(k)).map((k) => { const vs = Array.from(tags.get(k)!); return `${k} ${vs.slice(0, 3).join("/")}${vs.length > 3 ? " 외" : ""}`; }).join(" · ");
  const from = `${team}팀 ${latestQ}Q · ${latestRows.length}곳${rows.length > latestRows.length ? ` (이전 분기 ${rows.length - latestRows.length}곳 생략)` : ""}`;
  return [
    ...(summary ? [{ kind: "워킨맵" as const, pinned: false, from, text: summary }] : []),
    ...Array.from(free).slice(0, 8).map((text) => ({ kind: "워킨맵" as const, pinned: false, from: `${team}팀 ${latestQ}Q`, text })),
  ];
}

const latest = (events: EventItem[], table: string) => events.filter((ev) => !ev.loose && ev.source.table === table && ev.date).sort((a, b) => b.date.localeCompare(a.date))[0] || null;

export function deriveState(e: Entity, results: SourceResult[], today = new Date()): State {
  const events = toEvents(results);
  const exact = events.filter((ev) => !ev.loose);
  const lease = e.leaseRows.length ? e.leaseRows : (results.find((r) => r.source.table === "vendor_info")?.exact || []);
  const devices: Device[] = lease.map((r) => {
    const serial = str(r, "기번") || str(r, "시리얼번호(기번)"); const asset = str(r, "자산번호");
    const mine = (ev: EventItem) => (serial && identKey(ev.serial) === identKey(serial)) || (asset && identKey(ev.asset) === identKey(asset));
    const li = exact.filter((ev) => ev.source.table === "jeomgeom" && mine(ev))[0]; const la = exact.filter((ev) => ev.source.table === "as_records" && mine(ev))[0];
    return { model: str(r, "모델명") || str(r, "기종"), asset, serial, start: dateOf(r, ["계약일", "첫계약일"]), end: dateOf(r, ["종료일"]), monthsLeft: str(r, "남은개월"), fee: str(r, "기본금액"), status: str(r, "임대여부"), grade: str(r, "등급"), lastInspect: li?.date || "", lastAs: la?.date || "" };
  });
  // 담당자·주소 변경은 종류 글이 자유 입력("주소이전"·"결제 담당자 변경"·"키맨 추가"…) — 주소 계열과 사람 계열로 나눠 각각 최신 것을 본다
  const changes = exact.filter((ev) => ev.source.table === "contact_changes" && ev.date).sort((a, b) => b.date.localeCompare(a.date));
  const addrChange = changes.find((ev) => /주소|이전/.test(str(ev.row, "category")) || /^주소/.test(str(ev.row, "after_text")));
  const keymanChange = changes.find((ev) => /담당|키맨|결제|대표|총괄|번호|직급|계약|신규|카운터/.test(str(ev.row, "category")) && !/주소/.test(str(ev.row, "category")));
  // 임대리스트의 주소 칸(주소상세주소)은 비어 있는 곳이 많다 → 일정·접수·워킨맵·미수·확장성에 적힌 최신 주소로 메운다(출처를 같이 보여 준다)
  const leaseAddr = mode(lease.map((r) => str(r, "주소상세주소")));
  const addrFrom = (table: string, keys: string[], label: string): [string, string] => { const ev = exact.filter((x) => x.source.table === table && firstOf(x.row, keys)).sort((a, b) => b.date.localeCompare(a.date))[0]; return ev ? [firstOf(ev.row, keys), `${label}${ev.date ? ` ${ev.date}` : ""}`] : ["", ""]; };
  const addrCandidates: [string, string][] = [
    [addrChange ? str(addrChange.row, "after_text") : "", addrChange ? `담당자·주소 변경 ${addrChange.date}` : ""],
    [leaseAddr, "임대리스트"],
    addrFrom("as_tickets", ["address"], "일정"), addrFrom("service_receptions", ["address"], "접수"), addrFrom("workin_map_places", ["address"], "워킨맵"),
    addrFrom("misu", ["주소"], "미수"), addrFrom("mfp_expansion", ["도로명주소", "프로젝트주소"], "확장성"),
  ];
  const [address, addressFrom] = addrCandidates.find(([v]) => v) || ["", ""];
  const leaseKeyman = mode(lease.map((r) => str(r, "키맨")));
  const keymanCandidates: [string, string][] = [
    [keymanChange ? str(keymanChange.row, "after_text") : "", keymanChange ? `담당자·주소 변경 ${keymanChange.date}` : ""],
    [leaseKeyman, "임대리스트"],
    addrFrom("service_receptions", ["keyman_info", "receiver_name"], "접수"), addrFrom("as_tickets", ["keyman", "contact"], "일정"),
  ];
  const [keyman, keymanFrom] = keymanCandidates.find(([v]) => v) || ["", ""];
  const misu = latest(events, "misu"); const over = latest(events, "overage"); const recon = latest(events, "recontract"); const bul = latest(events, "bulman");
  const counts = results.map((r) => ({ label: r.source.label, group: r.source.group, exact: r.exact.length, loose: r.loose.length, ok: r.ok, rawSkipped: !!r.rawSkipped }));
  const dated = exact.map((ev) => ev.date).filter(Boolean).sort();
  const todayYmd = today.toISOString().slice(0, 10);
  return {
    address, addressFrom, keyman, keymanFrom,
    tel: mode(lease.map((r) => str(r, "일반전화"))), grade: mode(lease.map((r) => str(r, "등급"))), leaseStatus: mode(lease.map((r) => str(r, "임대여부"))),
    devices,
    misu: misu ? { months: str(misu.row, "미수개월") || str(misu.row, "실제 개월수"), amount: str(misu.row, "미수잔액") || str(misu.row, "실제 잔액") || str(misu.row, "미수금액"), date: misu.date } : null,
    overage: over ? { amount: str(over.row, "합계"), date: over.date } : null,
    recontract: recon ? { status: str(recon.row, "진행상황") || str(recon.row, "갱신상태") || str(recon.row, "최종상태"), end: str(recon.row, "계약종료일"), date: recon.date } : null,
    bulman: bul ? { date: bul.date, status: str(bul.row, "최종상태"), text: (str(bul.row, "불만내용") || str(bul.row, "불편내용")).slice(0, 80) } : null,
    lastInspect: latest(events, "jeomgeom")?.date || "",
    // 마지막 AS = AS 보고(as_records)만 보면 늦다 — 접수(복합기 AS)·일정(AS·익일AS)·일정 완료(간단처리, note 에 처리내용)·방문기록(AS)도 AS다.
    // 가장 최근 것을 쓰고 출처를 붙인다(2026-10-10 잡플러스: 보고 1/20, 접수 10/6, 일정 완료 10/7)
    ...(() => {
      const newest = (list: EventItem[]) => list.filter((ev) => ev.date && ev.date <= todayYmd).sort((a, b) => b.date.localeCompare(a.date))[0]?.date || "";
      const asTickets = exact.filter((ev) => ev.source.table === "as_tickets" && /AS/i.test(str(ev.row, "scheduleType")));
      const doneTickets = asTickets.filter((ev) => /완료/.test(str(ev.row, "status"))).map((ev) => ({ ...ev, date: [dateOf(ev.row, ["updated_at"]), ev.date].filter(Boolean).sort().pop() || ev.date }));
      const cands: Array<[string, string]> = [
        [latest(events, "as_records")?.date || "", "AS 보고"],
        [newest(exact.filter((ev) => ev.source.table === "service_receptions" && /AS|에이에스/i.test(str(ev.row, "type")))), "접수"],
        [newest(doneTickets), "일정 완료(간단처리)"],
        [newest(asTickets.filter((ev) => !/완료/.test(str(ev.row, "status")))), "일정"],
        [newest(exact.filter((ev) => ev.source.table === "visit_logs" && Array.isArray(ev.row.work_kinds) && (ev.row.work_kinds as unknown[]).map(String).includes("as"))), "방문기록"],
      ].filter(([d]) => d) as Array<[string, string]>;
      // 같은 날이면 처리 사실이 담긴 쪽을 앞세운다: 일정 완료(처리내용) > 방문기록 > AS 보고 > 접수 > 일정(예정)
      const prio = (from: string) => ["일정 완료(간단처리)", "방문기록", "AS 보고", "접수", "일정"].indexOf(from);
      cands.sort((a, b) => b[0].localeCompare(a[0]) || prio(a[1]) - prio(b[1]));
      return { lastAs: cands[0]?.[0] || "", lastAsFrom: cands[0]?.[1] || "" };
    })(),
    lastVisit: latest(events, "visit_logs")?.date || "",
    openReceptions: exact.filter((ev) => ev.source.table === "service_receptions" && !/완료/.test(str(ev.row, "status"))).length,
    upcomingTickets: exact.filter((ev) => ev.source.table === "as_tickets" && ev.date >= todayYmd && !/완료|취소/.test(str(ev.row, "status"))).length,
    changes: changes.length,
    photos: exact.filter((ev) => ev.source.table === "photo_albums").reduce((n, ev) => n + (Array.isArray(ev.row.urls) ? (ev.row.urls as unknown[]).length : 0), 0),
    workin: summarizeWorkin(exact.filter((ev) => ev.source.table === "workin_map_places").map((ev) => ev.row)),
    supplies: summarizeSupplies(exact.filter((ev) => ev.source.table === "supply_requests").map((ev) => ev.row)),
    notes: [
      // 🚫 보내지 말 것(마감 문자 연락처 규칙) — 누구에게 연락하면 안 되는지는 가장 먼저 보여야 한다(2026-10-10)
      ...exact.filter((ev) => ev.source.table === "counter_sms_contact_rules" && str(ev.row, "kind") === "block").map((ev) => ({
        kind: "연락금지" as const, pinned: true, from: `${str(ev.row, "updated_by")}${ev.date ? ` ${ev.date}` : ""}`.trim(),
        text: `🚫 보내지 말 것${str(ev.row, "name") ? ` — ${str(ev.row, "name")}` : ""}${str(ev.row, "phone") ? ` ${str(ev.row, "phone")}` : ""}${str(ev.row, "memo") ? ` · ${str(ev.row, "memo")}` : ""}`,
      })),
      ...exact.filter((ev) => ev.source.table === "vendor_notes").sort((a, b) => Number(!!b.row.pinned) - Number(!!a.row.pinned) || b.date.localeCompare(a.date)).map((ev) => ({
        kind: "특이사항" as const, pinned: !!ev.row.pinned, from: `${str(ev.row, "author")}${ev.date ? ` ${ev.date}` : ""}`.trim(),
        text: [str(ev.row, "work_start") && `출근 ${str(ev.row, "work_start")}`, str(ev.row, "lunch_time") && `점심 ${str(ev.row, "lunch_time")}`, str(ev.row, "note")].filter(Boolean).join(" · "),
      })),
      ...workinNotes(exact.filter((ev) => ev.source.table === "workin_map_places").map((ev) => ev.row), e),
      ...lease.map((r) => str(r, "추가조건")).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).map((text) => ({ kind: "임대조건" as const, pinned: false, from: "임대리스트", text })),
    ].filter((n) => n.text),
    counts, total: exact.length, oldest: dated[0] || "", newest: dated[dated.length - 1] || "",
  };
}
