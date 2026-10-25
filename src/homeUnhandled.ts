/**
 * 홈 "미처리" 칸의 순수 로직 — 접수(6종) 미처리 + 일정(as_tickets) 미처리를 한 목록으로 (2026-10-19).
 * 중복 규칙: AS 일정 중 receptionId 가 열린 접수에 이미 있으면 접수 행으로만 센다. 물류 일정은 전부 넣는다.
 * 2026-10-24: 홈의 모든 미처리 숫자(머리 합계·팀 탭·종류 칸·물류·가장 오래된 건)는 이 파일의 mergeUnhandled 결과 한 벌에서만 센다.
 *  · 물류 = overdueLogic.isLogisticsSchedule(현황판 물류 칸과 같은 정의). 익일AS 는 CS접수(2026-10-25 전엔 AS일정).
 *  · 팀이 없는 일정(일정 팀 "기타" 등)은 "기타" 탭 — 탭 합 = 전체.
 * 2026-10-25(사용자 "복합기 AS 는 캘린더 기준"): CS접수 칸 = 일정(as_tickets) 미처리(overdueLogic.isOverdueTicket, 일정리스트 [미처리]와 같은 판정).
 *  · 복합기 AS 접수(service_receptions)는 미처리로 세지 않는다 — 일정 미등록·네이버에서만 완료한 접수가 영영 열린 채 남아
 *    "일정리스트엔 없는데 홈엔 있음"(실측 C팀 8건)이 됐다. 옛 "복합기 AS"·"AS일정" 칸은 "CS접수" 한 칸으로 합쳤다.
 *  · 원격·IT·경영·운영·영업 접수는 그대로 접수(시트/DB) 기준.
 */
import { isStaleRemote, normalizeRegion } from "./deptReception";
import { isLogisticsSchedule, isOverdueTicket } from "./overdueLogic";
import type { SheetOpenRow } from "./receptionSheetOpen";

/** CS접수 = 일정(as_tickets) 미처리 중 물류 아닌 것(2026-10-25, 옛 "복합기 AS" 접수 칸 + "AS일정" 칸을 합침 — 사용자 "우리한테 접수된 것들이니") */
export type UnhandledKind = "CS접수" | "원격이관" | "IT" | "경영지원" | "운영지원" | "영업팀" | "물류";
export type UnhandledTeam = "A" | "B" | "C" | "D" | "E" | "경영" | "운영" | "영업" | "";
export type UnhandledRow = {
  key: string;
  source: "reception" | "ticket";
  kind: UnhandledKind;
  team: UnhandledTeam;
  date: string;
  vendor: string;
  title: string;
  assignee: string;
  status: string;
  ageDays: number;
  receptionId?: string;
  /** 상세 팝업 내용 칸 — 일정은 요청 내용 + 네이버 메모(note) 전체(ticketContent). 제목·시각·주소는 fields(2026-10-25 밤) */
  detail?: string;
  /** 시트 출처 행의 확인 재료(2026-10-25 미처리 단추 — statusOnly 잡이 순번·상호로 행을 다시 확인한다) */
  sheet?: { source: "sales" | "mgmt" | "remote"; row: number; seq: string; author: string; vendor: string };
  /** 상세 팝업 정보 표에 더할 줄(일정: 제목·시각·주소, 2026-10-25 밤). 내용 칸 머리는 contentLabel */
  fields?: Array<{ label: string; value: string }>;
  contentLabel?: string;
  /** 시트에 짝 없는 앱(DB) 부서 접수 — receptionSheetOpen.markSheetMissing 이 채움(2026-10-25 밤). 줄에 회색 칩 "시트에 없음" */
  sheetMissing?: boolean;
};

/** fetchOpenReceptions 행 중 쓰는 칸만 */
export type ReceptionInput = {
  id: string; receipt_date: string; created_at?: string; type: string; vendor: string; region: string;
  title?: string; symptom?: string; status: string; remote_meta?: Record<string, string> | null;
};
/** as_tickets 지난 날짜·미완료 행 */
export type TicketInput = {
  id: string; team: string; date: string; vendor: string; assignee: string; status: string; scheduleType: string;
  receptionId?: string | null; issue?: string; calendarTitle?: string; note?: string; address?: string; time?: string;
};

/** 일정 행의 팝업 본문: 제목(calendarTitle) · 시각 · 주소 · 네이버 메모(note) 를 줄로 — 전부 평문, 없으면 "" */
export function ticketDetail(t: Pick<TicketInput, "issue" | "calendarTitle" | "note" | "address" | "time">): string {
  const lines: string[] = [];
  const title = String(t.calendarTitle || "").trim();
  const issue = String(t.issue || "").trim();
  if (title && title !== issue) lines.push(title);
  if (issue) lines.push(issue);
  if (String(t.time || "").trim()) lines.push(`시각 ${String(t.time).trim()}`);
  if (String(t.address || "").trim()) lines.push(`주소 ${String(t.address).trim()}`);
  const note = String(t.note || "").trim();
  if (note && note !== issue && note !== title) lines.push(note);
  return lines.join("\n");
}

/** 일정 팝업 정보 표 줄: 제목(네이버 전체 제목) · 시각 · 주소 — 빈 칸 생략, 자르지 않음 */
export function ticketFields(t: Pick<TicketInput, "issue" | "calendarTitle" | "address" | "time">): Array<{ label: string; value: string }> {
  const title = String(t.calendarTitle || "").trim() || String(t.issue || "").trim();
  return ([["제목", title], ["시각", String(t.time || "").trim()], ["주소", String(t.address || "").trim()]] as Array<[string, string]>)
    .filter(([, v]) => v).map(([label, value]) => ({ label, value }));
}

/** 일정 팝업 내용 칸: 요청 내용(issue, 제목과 다를 때) + 네이버 메모(note) 전체 — 줄바꿈 그대로 */
export function ticketContent(t: Pick<TicketInput, "issue" | "calendarTitle" | "note">): string {
  const title = String(t.calendarTitle || "").trim();
  const issue = String(t.issue || "").trim();
  const note = String(t.note || "").replace(/\r\n?/g, "\n").trim();
  const parts: string[] = [];
  if (issue && issue !== title) parts.push(issue);
  if (note && note !== issue && note !== title) parts.push(note);
  return parts.join("\n\n");
}

const FIELD_TYPES = new Set(["복합기 AS", "원격이관", "IT"]);
/** 홈 미처리에 접수 행으로 세는 종류 — 복합기 AS 는 빠짐(일정 기준, 2026-10-25) */
const RECEPTION_KINDS = new Set<string>(["원격이관", "IT", "경영지원", "운영지원", "영업팀"]);
const DEPT_TEAM: Record<string, UnhandledTeam> = { 경영지원: "경영", 운영지원: "운영", 영업팀: "영업" };
const LETTERS = new Set(["A", "B", "C", "D", "E"]);

/** 현장 3종은 지역 글자(지방은 E), 지원 3종은 부서, 그 외 "" */
export function receptionTeam(type: string, region: string): UnhandledTeam {
  if (DEPT_TEAM[type]) return DEPT_TEAM[type];
  if (!FIELD_TYPES.has(type)) return "";
  const r = normalizeRegion(region);
  if (r === "지방") return "E";
  return (r || "") as UnhandledTeam;
}

/** 날짜 차(일). today·date 는 YYYY-MM-DD, 음수는 0 */
export function ageDaysOf(date: string, today: string): number {
  const d = Date.parse(String(date || "").slice(0, 10));
  const t = Date.parse(today);
  if (!Number.isFinite(d) || !Number.isFinite(t)) return 0;
  return Math.max(0, Math.round((t - d) / 86400_000));
}

const ticketTeam = (team: string): UnhandledTeam => {
  const t = String(team || "").trim().toUpperCase();
  return (LETTERS.has(t) ? t : "") as UnhandledTeam;
};

/** 시트 미처리 행(C3 시트 기준) 중 쓰는 칸만 — 부르는 쪽이 mergeSheetAndDb 로 90일 안 행만 넘긴다 */
export type SheetUnhandledInput = Pick<SheetOpenRow, "source" | "kind" | "sheetRow" | "date" | "vendor" | "field" | "summary" | "handler" | "state" | "region" | "receptionId">
  & Partial<Pick<SheetOpenRow, "seq" | "author" | "content">>;

/**
 * sheetRows(기본 [])는 시트 기준 모드에서만 넘어온다. 팀은 영업→영업, 경영→경영, 원격·IT→지역 A~E(지방 E) — "팀 합 = 전체" 규칙 유지.
 * 시트 행에는 7일 원격 규칙(isStaleRemote)을 쓰지 않는다.
 */
export function mergeUnhandled(receptions: ReceptionInput[], tickets: TicketInput[], today: string, sheetRows: SheetUnhandledInput[] = []): UnhandledRow[] {
  const out: UnhandledRow[] = [];
  const openIds = new Set<string>();
  for (const s of sheetRows) {
    const date = String(s.date || "").slice(0, 10);
    const rid = String(s.receptionId || "");
    if (rid) openIds.add(rid);
    out.push({
      key: `s:${s.source}:${s.sheetRow}`, source: "reception", kind: s.kind, team: receptionTeam(s.kind, s.region), date,
      vendor: String(s.vendor || ""), title: String(s.summary || s.field || ""), assignee: String(s.handler || ""),
      status: String(s.state || ""), ageDays: date ? ageDaysOf(date, today) : 0, ...(rid ? { receptionId: rid } : {}),
      ...(s.content ? { detail: String(s.content) } : {}), // 팝업 내용 칸을 엣지 한 행 조회 전에 바로(목록 응답 600자)
      sheet: { source: s.source, row: s.sheetRow, seq: String(s.seq || ""), author: String(s.author || ""), vendor: String(s.vendor || "") },
    });
  }
  for (const r of receptions) {
    if (isStaleRemote(r, today)) continue; // 7일 지난 원격대기 = 원격팀 처리로 봄
    // 복합기 AS(와 종류 모르는 접수)는 일정(as_tickets) 기준 — 접수 행은 세지 않고, 연결 일정도 중복으로 빼지 않는다
    if (!RECEPTION_KINDS.has(r.type)) continue;
    const kind = r.type as UnhandledKind;
    openIds.add(String(r.id));
    const date = String(r.receipt_date || r.created_at || "").slice(0, 10);
    out.push({
      key: `r:${r.id}`, source: "reception", kind, team: receptionTeam(r.type, r.region), date,
      vendor: String(r.vendor || ""), title: String(r.title || r.symptom || ""),
      assignee: String(r.remote_meta?.handler || ""), status: String(r.status || ""),
      ageDays: ageDaysOf(date, today), receptionId: String(r.id),
    });
  }
  for (const t of tickets) {
    if (!isOverdueTicket(t, today)) continue; // 일정리스트 [미처리]와 같은 판정(부르는 쪽 조회 조건과 같지만 정의를 한 곳에)
    const logistics = isLogisticsSchedule(t.scheduleType);
    const rid = String(t.receptionId || "");
    if (!logistics && rid && openIds.has(rid)) continue; // 접수 행과 중복
    const date = String(t.date || "").slice(0, 10);
    out.push({
      key: `t:${t.id}`, source: "ticket", kind: logistics ? "물류" : "CS접수", team: ticketTeam(t.team), date,
      vendor: String(t.vendor || ""), title: String(t.issue || t.calendarTitle || ""), assignee: String(t.assignee || ""),
      status: String(t.status || ""), ageDays: ageDaysOf(date, today), ...(rid ? { receptionId: rid } : {}),
      ...(ticketContent(t) ? { detail: ticketContent(t) } : {}),
      ...(ticketFields(t).length ? { fields: ticketFields(t) } : {}), contentLabel: "메모",
    });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** team 은 A~E·경영·운영·영업(빈 문자열 포함 null 이면 전체), kind 는 행 종류(null 이면 전체) */
export function filterUnhandled(rows: UnhandledRow[], team: UnhandledTeam | null, kind: UnhandledKind | null): UnhandledRow[] {
  return rows.filter((r) => (team === null || r.team === team) && (kind === null || r.kind === kind));
}

export type UnhandledTab = "전체" | "A" | "B" | "C" | "D" | "E" | "경영" | "운영" | "영업" | "기타";
/** 기타 = 팀 없는 행(일정 팀 "기타"·빈 칸, 지역 모르는 IT 접수) — 없으면 화면이 탭을 숨긴다 */
export const UNHANDLED_TABS: UnhandledTab[] = ["전체", "A", "B", "C", "D", "E", "경영", "운영", "영업", "기타"];

/** 탭 → 팀 필터 (전체는 null, 기타는 팀 "") */
export function tabFilter(tab: UnhandledTab): [UnhandledTeam | null, UnhandledKind | null] {
  if (tab === "전체") return [null, null];
  if (tab === "기타") return ["", null];
  return [tab, null];
}

/** 팀 탭 건수 = 그 팀의 접수+AS+물류 전부 (팀 합 = 전체, 2026-10-20) */
export function rowsForTab(rows: UnhandledRow[], tab: UnhandledTab): UnhandledRow[] {
  const [team, kind] = tabFilter(tab);
  return filterUnhandled(rows, team, kind);
}

/** 목록을 접수·AS 묶음과 물류 묶음으로 가른다 */
export function splitByGroup(rows: UnhandledRow[]): { work: UnhandledRow[]; logistics: UnhandledRow[] } {
  return { work: rows.filter((r) => r.kind !== "물류"), logistics: rows.filter((r) => r.kind === "물류") };
}

/** 탭별 건수 */
export function countUnhandledTabs(rows: UnhandledRow[]): Record<UnhandledTab, number> {
  const out = Object.fromEntries(UNHANDLED_TABS.map((t) => [t, 0])) as Record<UnhandledTab, number>;
  for (const t of UNHANDLED_TABS) out[t] = rowsForTab(rows, t).length;
  return out;
}

/** 종류 칸 순서(홈 미처리 칸) — 이 7칸의 합 = 전체 */
export const UNHANDLED_KINDS: UnhandledKind[] = ["CS접수", "원격이관", "IT", "경영지원", "운영지원", "영업팀", "물류"];
export const UNHANDLED_KIND_LABEL: Record<UnhandledKind, string> = {
  CS접수: "CS 접수", 원격이관: "원격", IT: "IT", 경영지원: "경영", 운영지원: "운영", 영업팀: "영업", 물류: "물류",
};

/** 종류별 건수(UNHANDLED_KINDS 전부, 없으면 0) */
export function countUnhandledKinds(rows: UnhandledRow[]): Record<UnhandledKind, number> {
  const out = Object.fromEntries(UNHANDLED_KINDS.map((k) => [k, 0])) as Record<UnhandledKind, number>;
  for (const r of rows) out[r.kind] += 1;
  return out;
}

/** 가장 오래된 건(날짜 있는 행 중 가장 이른 것). 목록이 날짜순이라 첫 날짜 있는 행 */
export function oldestUnhandled(rows: UnhandledRow[]): UnhandledRow | null {
  let best: UnhandledRow | null = null;
  for (const r of rows) if (r.date && (!best || r.date < best.date)) best = r;
  return best;
}

/** 행 배지 글자 */
export const UNHANDLED_BADGE: Record<UnhandledKind, string> = {
  CS접수: "CS", 원격이관: "원격", IT: "IT", 경영지원: "경영", 운영지원: "운영", 영업팀: "영업", 물류: "납품·물류",
};

/** 미처리 목록 정렬(2026-10-25 밤, 사용자 "최근순·나중순") — 홈 미처리 칸·서비스접수 현황판·부서 미니 업무공간이 같이 쓴다 */
export type UnhandledSortOrder = "old" | "recent";
/** 선택 기억 키(localStorage, 세 곳 공유) */
export const UNHANDLED_SORT_KEY = "cs_unhandled_sort_v1";

/** 저장값 복원 — "recent" 만 최근 순, 그 밖(없음·깨진 값)은 기본 오래된 순 */
export function parseSortOrder(raw: string | null | undefined): UnhandledSortOrder {
  return raw === "recent" ? "recent" : "old";
}

/**
 * 날짜순 정렬(새 배열). old = 오래된 것 먼저, recent = 최근 것 먼저. 날짜 없는 행은 어느 방향이든 맨 아래.
 * 같은 날짜는 키 오름차순(안정). pick 을 안 주면 UnhandledRow 의 date·key.
 */
export function sortUnhandled(rows: UnhandledRow[], order: UnhandledSortOrder): UnhandledRow[];
export function sortUnhandled<T>(rows: T[], order: UnhandledSortOrder, pick: (r: T) => [date: string, key: string]): T[];
export function sortUnhandled<T>(rows: T[], order: UnhandledSortOrder, pick?: (r: T) => [string, string]): T[] {
  const get = pick ?? ((r: T) => [(r as unknown as UnhandledRow).date, (r as unknown as UnhandledRow).key] as [string, string]);
  const dir = order === "recent" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const [da, ka] = get(a);
    const [db, kb] = get(b);
    const ea = !String(da || ""), eb = !String(db || "");
    if (ea !== eb) return ea ? 1 : -1;
    const A = String(da || "").slice(0, 10), B = String(db || "").slice(0, 10);
    if (A !== B) return (A < B ? -1 : 1) * dir;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}
