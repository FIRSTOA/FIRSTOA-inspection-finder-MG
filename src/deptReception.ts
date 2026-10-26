/**
 * 부서 접수(경영지원·운영지원·영업팀) 공용 — 타입·상수·순수 함수만. 네트워크 호출은 deptReceptionApi.ts.
 * 설계: docs/tasks/reception-dept-types.md (3절 데이터, 4-2 폼, 5절 달력·카톡).
 *
 * 저장 위치는 service_receptions 한 표(type = 부서명). 부서 고유 값은 remote_meta 에 **평평한 문자열 키**로 둔다.
 * (merge_reception_handling 은 remote_meta || p_meta 얕은 병합이라, 중첩 객체로 두면 처리 저장 때 통째로 덮인다)
 */
import { md5 } from "./md5";
import { regionLetter } from "./region";
import { kstDate } from "./visits";
import { buildDeptKakaoText } from "./receptionKakaoCard";

export const DEPT_TYPES = ["경영지원", "운영지원", "영업팀"] as const;
export type DeptType = (typeof DEPT_TYPES)[number];
export const isDeptType = (t: unknown): t is DeptType => DEPT_TYPES.includes(String(t || "") as DeptType);

export const DEPT_LABEL: Record<DeptType, string> = { 경영지원: "경영지원", 운영지원: "운영지원", 영업팀: "전략영업" };
const DEPT_SHORT: Record<DeptType, string> = { 경영지원: "경영", 운영지원: "운영", 영업팀: "영업" };
export const deptShort = (t: string): string => (isDeptType(t) ? DEPT_SHORT[t] : t);
// 목록 배지 색 — 기존 blue(복합기)·cyan(IT)·violet(원격)과 겹치지 않게. 디자인실 값이 오면 여기만 바꾼다.
export const DEPT_TONE: Record<DeptType, string> = {
  경영지원: "bg-amber-50 text-amber-700",
  운영지원: "bg-emerald-50 text-emerald-700",
  영업팀: "bg-rose-50 text-rose-700",
};
export type DeptSheetCategory = "reception_sales" | "reception_mgmt";
export const DEPT_SHEET_CATEGORY: Record<DeptType, DeptSheetCategory | null> = {
  영업팀: "reception_sales",
  경영지원: "reception_mgmt",
  운영지원: null, // 시트 없음 — 잡을 만들지 않는다(sheet_state 'none')
};

// 접수유형 — '사내'는 요청자 이름(remote_meta.via)을 함께 받는다. route CHECK 는 SQL 로 이 4개까지 넓어진다.
export const DEPT_ROUTES = ["카카오", "전화", "메일", "사내"] as const;
export type DeptRoute = (typeof DEPT_ROUTES)[number];
export const DEPT_ROUTE_LABEL: Record<DeptRoute, string> = { 카카오: "카카오", 전화: "전화", 메일: "메일", 사내: "사내 요청" };
// 경영은 실데이터 대부분이 사내 요청자 이름이라 기본 선택이 사내(설계 4-2)
export const defaultRoute = (dept: DeptType): DeptRoute => (dept === "경영지원" ? "사내" : "카카오");

// 접수분야 칩(설계 4-2 표). 마지막 '기타' 뒤의 '직접 입력'은 화면이 붙인다.
export const DEPT_FIELD_CHIPS: Record<DeptType, readonly string[]> = {
  영업팀: [
    "신규/추가 렌탈", "렌탈문의", "현장/단기 렌탈", "현장/단기 철수", "해지문의", "해지/위약금", "반출문의",
    "계약문의", "재계약/연장", "기기교체/사양변경", "요금관련/초과료", "매수상향/조정", "견적문의", "기타",
  ],
  경영지원: [
    "청구관련", "계약서요청", "계약관련", "사업자변경", "수기계약서", "세금계산서", "보증금",
    "CMS출금", "사용량", "매수상향", "거래명세서", "용지주문", "정산", "기타",
  ],
  운영지원: ["소모품", "배송/택배", "설치", "기타"],
};
// 진행 메모 칩(영업 시트 '승인여부' 열 관행)
export const DEPT_PROGRESS_CHIPS = ["선행방올림", "안내완", "견적서 발송완", "부재중"] as const;
export const DEPT_CONTRACT_KINDS = ["전자", "수기"] as const;
export const DEPT_STATUSES = ["접수", "진행중", "보류", "완료", "취소"] as const;
export type DeptStatus = (typeof DEPT_STATUSES)[number];

/** remote_meta 규약(설계 3-1). 모두 문자열 — 병합 RPC·ServiceReceptionRow.remote_meta 가 Record<string,string> 이다. */
export type DeptMeta = {
  handler: string;        // 처리자
  via: string;            // 사내 요청자(route='사내')
  outside: string;        // "외근요청" | ""
  contract_kind: string;  // 경영: 전자/수기
  progress: string;       // 진행 메모(영업 H열)
  handled: string;        // 처리내용
  sheet_seq: string;      // 시트 A열 순번(엣지 함수 결과)
  sheet_state: string;    // queued/synced/failed/none
  schedule_date: string;  // 예정일 yyyy-MM-dd
  calendar_id: string;    // team_calendar_events.id
  kakao: string;          // sent/no_room/test/""
  vendor_code: string;    // vendor_master.code(있으면)
};

// ── 지역 ─────────────────────────────────────────────
export type DeptRegion = "A" | "B" | "C" | "D" | "E" | "지방" | "";
const PROVINCE = /(지방|강원|경상|경남|경북|전라|전남|전북|제주|충청|충남|충북|대전|대구|부산|울산|광주광역|세종)/;
/**
 * 시트·임대리스트 지역 표기 → A~E | 지방 | "".
 * 수도권A~E(대소문자·띄어쓰기 변형)·"C"·"C지역" → 글자, 도 이름(강원도·경상도·전라도·제주도·충청도) → 지방, 신규·미정·빈값 → "".
 */
export function normalizeRegion(value: string | null | undefined): DeptRegion {
  const v = String(value ?? "").replace(/\s+/g, "").trim();
  if (!v || /^(신규|미정|-)$/.test(v)) return "";
  const m = v.match(/^(?:수도권)?([A-Ea-e])(?:지역|팀)?$/);
  if (m) return m[1].toUpperCase() as DeptRegion;
  if (PROVINCE.test(v)) return "지방";
  const letter = regionLetter(v); // 구 이름(강남·마포…)·경기권 지명
  if (letter === "E") return "지방";
  return (letter as DeptRegion) || "";
}
/** 저장용 표기 — 기존 행과 같은 "수도권C"/"지방" */
export function regionLabelOf(region: DeptRegion): string {
  if (!region) return "";
  if (region === "지방" || region === "E") return "지방";
  return `수도권${region}`;
}

// ── 처리자 기본값(설계 Q4) ─────────────────────────────
const HANDLER_TABLE: Record<DeptType, { A: string; B: string; C: string; DE: string; none: string }> = {
  영업팀: { A: "이찬우", B: "박민", C: "이정현", DE: "김수인", none: "박진영" },
  경영지원: { A: "이윤아", B: "박수민", C: "", DE: "김슬기", none: "" },
  운영지원: { A: "", B: "", C: "", DE: "", none: "" },
};
export function defaultHandler(dept: DeptType, region: string): string {
  const t = HANDLER_TABLE[dept];
  const r = normalizeRegion(region);
  if (r === "A" || r === "B" || r === "C") return t[r];
  if (r === "D" || r === "E" || r === "지방") return t.DE;
  return t.none;
}

// ── 임대리스트 값 꺼내기(ServiceReception 내부 pick 과 같은 동작) ──
export function pickLease(lease: Record<string, unknown> | null | undefined, ...keys: string[]): string {
  if (!lease) return "";
  for (const key of keys) {
    const value = String(lease[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

// ── 접수 행 만들기 ──────────────────────────────────
export type DeptReceptionInput = {
  dept: DeptType;
  author: string;           // 접수자
  route: DeptRoute;
  via?: string;             // route='사내'일 때 요청자
  vendor: string;
  vendorCode?: string;
  leaseNo?: string;         // 순(신규면 빈값)
  grade?: string;
  region?: string;          // 어떤 표기든 — normalizeRegion 으로 정리
  assetNo?: string;
  serial?: string;
  model?: string;
  address?: string;
  field: string;            // 접수분야
  content: string;          // 접수내용
  notes?: string;           // 특이사항(DB만)
  receiverName?: string;
  receiverPhone?: string;
  handler?: string;         // 비우면 defaultHandler — 단 handlerExplicit 이면 빈값(미정) 그대로
  handlerExplicit?: boolean; // 사용자가 처리자 칸을 직접 골랐다(미정 포함) — 지역 기본값으로 덮지 않는다(2026-10-27 사용자 "미정으로 했는데 이정현으로 자꾸 뜸")
  outside?: boolean;        // 외근요청
  contractKind?: string;    // 경영만
  progress?: string;
  scheduleDate?: string;    // yyyy-MM-dd
  reportText?: string;      // 카톡·기록 양식(없으면 buildDeptKakaoText 로 만든다)
  lease?: Record<string, string> | null; // 고른 임대리스트 행(LeaseHit) — 카톡 카드의 임대리스트 칸. 신규면 null
};

/** 필수 점검 — 빈 항목 이름 목록(화면의 필수 칩 줄과 저장 차단에 같이 쓴다) */
export function deptMissing(input: Partial<DeptReceptionInput>): string[] {
  const out: string[] = [];
  if (!String(input.vendor || "").trim()) out.push("업체");
  if (!input.route) out.push("접수유형");
  else if (input.route === "사내" && !String(input.via || "").trim()) out.push("사내 요청자");
  if (!String(input.field || "").trim()) out.push("접수분야");
  if (!String(input.content || "").trim()) out.push("접수내용");
  if (!String(input.author || "").trim()) out.push("접수자");
  return out;
}

export function buildDeptTitle(field: string, content: string): string {
  const first = String(content || "").split(/\r?\n/).map((s) => s.trim()).find(Boolean) || "";
  return [String(field || "").trim(), first.slice(0, 30)].filter(Boolean).join(" · ");
}

export type DeptReceptionRow = {
  type: DeptType; author: string; route: DeptRoute; vendor: string; grade: string; region: string;
  lease_no: string; first_no: string; asset_no: string; serial: string; model: string; address: string;
  field: string; title: string; symptom: string; notes: string; receiver_name: string; receiver_phone: string;
  report_text: string; status: "접수"; remote_meta: DeptMeta;
};

/** service_receptions insert 객체. 필수값이 비면 throw(메시지에 빈 항목). */
export function buildDeptReceptionRow(input: DeptReceptionInput): DeptReceptionRow {
  if (!isDeptType(input.dept)) throw new Error(`부서 종류가 아닙니다: ${String(input.dept)}`);
  const missing = deptMissing(input);
  if (missing.length) throw new Error(`필수 항목 누락: ${missing.join(", ")}`);
  const t = (v: unknown) => String(v ?? "").trim();
  const region = normalizeRegion(input.region);
  const leaseNo = t(input.leaseNo);
  const meta: DeptMeta = {
    handler: input.handlerExplicit ? t(input.handler) : (t(input.handler) || defaultHandler(input.dept, region)),
    via: input.route === "사내" ? t(input.via) : "",
    outside: input.outside ? "외근요청" : "",
    contract_kind: input.dept === "경영지원" ? t(input.contractKind) : "",
    progress: t(input.progress),
    handled: "",
    sheet_seq: "",
    sheet_state: DEPT_SHEET_CATEGORY[input.dept] ? "queued" : "none",
    schedule_date: /^\d{4}-\d{2}-\d{2}$/.test(t(input.scheduleDate)) ? t(input.scheduleDate) : "",
    calendar_id: "",
    kakao: "",
    vendor_code: t(input.vendorCode),
  };
  const row: DeptReceptionRow = {
    type: input.dept,
    author: t(input.author),
    route: input.route,
    vendor: t(input.vendor),
    grade: t(input.grade),
    region: regionLabelOf(region),
    lease_no: leaseNo,
    first_no: leaseNo,
    asset_no: t(input.assetNo),
    serial: t(input.serial),
    model: t(input.model),
    address: t(input.address),
    field: t(input.field),
    title: buildDeptTitle(input.field, input.content),
    symptom: String(input.content || "").trim(),
    notes: String(input.notes || "").trim(),
    receiver_name: t(input.receiverName),
    receiver_phone: t(input.receiverPhone),
    report_text: "",
    status: "접수",
    remote_meta: meta,
  };
  row.report_text = t(input.reportText) || buildDeptKakaoText(row, input.lease ?? null); // 각 방 실물 양식(2026-10-27)
  return row;
}

/** 시트 '접수유형' 칸 값 — 사내 요청이면 이름(시트 관행) */
export function deptRouteLabel(route: string, via?: string): string {
  return route === "사내" ? (String(via || "").trim() || "사내") : route;
}

// ── 시트 잡 payload ───────────────────────────────
/** 시트 G열 문구 — 접수·진행중은 '진행중', 완료는 '처리완료' */
export function deptSheetStateLabel(status: string): string {
  if (status === "완료") return "처리완료";
  if (status === "보류" || status === "취소") return status;
  return "진행중";
}

function kstParts(iso?: string): { md: string; hm: string; ym: string; ymd: string } {
  const d = iso ? new Date(iso) : new Date();
  const base = Number.isNaN(d.getTime()) ? new Date() : d;
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(base).map((x) => [x.type, x.value]));
  const pad = (s: string) => s.padStart(2, "0");
  return {
    md: `${Number(p.month)}월 ${Number(p.day)}일`,
    hm: `${pad(p.hour)}:${pad(p.minute)}`,
    ym: `${String(p.year).slice(2)}${pad(p.month)}`,
    ymd: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
  };
}

export type DeptSheetRowSource = Pick<DeptReceptionRow, "type" | "author" | "route" | "vendor" | "grade" | "region" | "lease_no" | "field" | "symptom" | "notes" | "receiver_name" | "receiver_phone" | "address"> & {
  id?: string; created_at?: string; status?: string; remote_meta?: Partial<DeptMeta> | Record<string, string>;
};

/**
 * 시트 잡 payload.data — 엣지 함수(dept-sheets.ts, 구현서 A)가 읽는 키.
 * receiptDate 는 시트 B열 형식 'M월 d일', receiptTime 'HH:mm', receiptYm 'yyMM'(C열이 값 열일 때만 쓰임).
 */
export function buildDeptSheetPayload(row: DeptSheetRowSource): Record<string, string> {
  const meta = (row.remote_meta || {}) as Partial<DeptMeta>;
  const when = kstParts(row.created_at);
  return {
    receptionId: String(row.id || ""),
    dept: row.type,
    receiptDate: when.md,
    receiptTime: when.hm,
    receiptYm: when.ym,
    author: row.author,
    handler: meta.handler || "",
    state: deptSheetStateLabel(row.status || "접수"),
    progress: meta.progress || "",
    handled: meta.handled || "",
    leaseNo: row.lease_no || "",
    routeLabel: deptRouteLabel(row.route, meta.via),
    field: row.field,
    contactName: row.receiver_name || "",
    contactPhone: row.receiver_phone || "",
    content: row.symptom,
    notes: row.notes || "",
    contractKind: meta.contract_kind || "",
    outing: meta.outside || "",
    vendor: row.vendor,
    region: row.region || "",
    grade: row.grade || "",
    address: row.address || "",
    // 엣지 함수 dept-sheet-spec.ts(구현서 A) pickData 가 읽는 이름 — 위 키와 같은 값을 그쪽 이름으로도 싣는다
    route: row.route,
    via: meta.via || "",
    outside: meta.outside || "",
    receiverName: row.receiver_name || "",
    receiverPhone: row.receiver_phone || "",
    symptom: row.symptom,
    status: row.status || "접수",
    receiptAuthor: row.author,
    sheetSeq: meta.sheet_seq || "",
  };
}

/** 같은 날·업체·분야·내용 지문(md5) — 같은 접수를 두 번 저장했는지 볼 때. 시트 append 잡 dupKey 는 deptAppendDupKey(id). */
export function deptDupKey(row: { receipt_date?: string; created_at?: string; vendor: string; field: string; symptom: string }): string {
  const date = row.receipt_date || kstParts(row.created_at).ymd;
  return md5([date, String(row.vendor || "").trim(), String(row.field || "").trim(), String(row.symptom || "").trim()].join("|"));
}
export const deptAppendDupKey = (receptionId: string) => `dept:${receptionId}:append`;

// ── 목록·보드 ─────────────────────────────────────
export type DeptListState = "접수" | "진행중" | "완료";
/** 목록 상태 점: 보류→진행중, 취소→완료, 원격대기→접수 */
export function deptListState(row: { status?: string | null }): DeptListState {
  const s = String(row.status || "");
  if (s === "완료" || s === "취소" || s === "원격완료") return "완료";
  if (s === "진행중" || s === "보류") return "진행중";
  return "접수";
}

const ymdMs = (ymd: string) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
const isYmd = (s: unknown) => /^\d{4}-\d{2}-\d{2}/.test(String(s || ""));

/** 접수일로부터 지난 일수(오늘 접수 0). 날짜가 이상하면 0. */
export function ageDays(receiptDate: string, today: string = kstDate()): number {
  if (!isYmd(receiptDate) || !isYmd(today)) return 0;
  return Math.max(0, Math.round((ymdMs(today.slice(0, 10)) - ymdMs(receiptDate.slice(0, 10))) / 86_400_000));
}

/** 원격팀은 FIELD 처리 단추를 안 쓰고 자기 시트에서 끝낸다 — 접수일 7일이 지난 '원격대기'는 원격팀 처리(확인 안 됨)로 보고 미처리에서 뺀다. */
export function isStaleRemote(row: { type?: string | null; status?: string | null; receipt_date?: string | null; created_at?: string | null }, today: string = kstDate()): boolean {
  if (row.type !== "원격이관" || row.status !== "원격대기") return false;
  const d = String(row.receipt_date || row.created_at || "").slice(0, 10);
  return isYmd(d) && isYmd(today) && ageDays(d, today) > 7;
}

type BoardRow = { status?: string | null; receipt_date?: string; created_at?: string };
/** 미처리 보드 칸 나누기 — 칸 안은 오래된 순 */
export function boardBuckets<T extends BoardRow>(rows: T[]): Record<DeptListState, T[]> {
  const out: Record<DeptListState, T[]> = { 접수: [], 진행중: [], 완료: [] };
  for (const r of rows) out[deptListState(r)].push(r);
  const key = (r: T) => `${r.receipt_date || ""}|${r.created_at || ""}`;
  (Object.keys(out) as DeptListState[]).forEach((k) => out[k].sort((a, b) => key(a).localeCompare(key(b))));
  return out;
}

/** 이번 주(월~일, KST) 접수분 중 완료 비율. 취소는 완료로 센다(보드와 같은 기준). */
export function weekCompletionRate(rows: BoardRow[], today: string = kstDate()): { total: number; done: number; rate: number } {
  const t = ymdMs(today.slice(0, 10));
  const dow = new Date(t).getUTCDay() || 7;
  const start = t - (dow - 1) * 86_400_000;
  const end = start + 6 * 86_400_000;
  let total = 0, done = 0;
  for (const r of rows) {
    if (!isYmd(r.receipt_date)) continue;
    const d = ymdMs(String(r.receipt_date).slice(0, 10));
    if (d < start || d > end) continue;
    total += 1;
    if (deptListState(r) === "완료") done += 1;
  }
  return { total, done, rate: total ? done / total : 0 };
}

/** 예정일이 지났는데 아직 안 끝난 건 */
export function scheduledOverdue(row: { status?: string | null; remote_meta?: Record<string, string> | Partial<DeptMeta> | null }, today: string = kstDate()): boolean {
  const date = String(row.remote_meta?.schedule_date || "");
  if (!isYmd(date)) return false;
  return deptListState(row) !== "완료" && date.slice(0, 10) < today.slice(0, 10);
}

// ── 업체 단위 접수 ──────────────────────────────────
export type VendorInfoLite = Record<string, unknown> & { _raw?: Record<string, unknown> | null };
function mode(values: string[]): string {
  const count = new Map<string, number>();
  let best = "", bestN = 0;
  for (const v of values) {
    if (!v) continue;
    const n = (count.get(v) || 0) + 1;
    count.set(v, n);
    if (n > bestN) { best = v; bestN = n; } // 동률이면 먼저 나온 값
  }
  return best;
}
/**
 * vendor_info 행들 → 업체 요약. 지역은 '관리 담당자'(팀 배정 정답 열) → '담당지역' 순으로 읽어 정규화한 최빈값.
 * _hidden 행은 센다에서 뺀다.
 */
/**
 * 업체 행 묶음 요약. 숫자 기준(2026-10-19):
 * - leasingCount = 숨김 아닌 행 중 임대여부 '임대중' 행 수(지금 쓰는 기기)
 * - totalCount   = 숨김 아닌 계약 행 전체(종료 포함)
 */
export function aggregateVendor(rows: VendorInfoLite[]): { grade: string; region: DeptRegion; leasingCount: number; totalCount: number; address: string } {
  const live = rows.filter((r) => r && r._hidden !== true);
  const val = (r: VendorInfoLite, ...keys: string[]) => {
    for (const k of keys) {
      const v = String(r[k] ?? r._raw?.[k] ?? "").trim();
      if (v) return v;
    }
    return "";
  };
  return {
    grade: mode(live.map((r) => val(r, "등급"))),
    region: mode(live.map((r) => normalizeRegion(val(r, "관리 담당자", "담당지역", "region")))) as DeptRegion,
    leasingCount: live.filter((r) => val(r, "임대여부") === "임대중").length,
    totalCount: live.length,
    address: live.map((r) => val(r, "주소상세주소", "주소(실납품주소,도로명주소)", "주소")).find(Boolean) || "",
  };
}
