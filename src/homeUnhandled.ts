/**
 * 홈 "미처리" 칸의 순수 로직 — 접수(6종) 미처리 + 일정(as_tickets) 미처리를 한 목록으로 (2026-10-19).
 * 중복 규칙: AS 일정 중 receptionId 가 열린 접수에 이미 있으면 접수 행으로만 센다. 물류 일정은 전부 넣는다.
 * 2026-10-24: 홈의 모든 미처리 숫자(머리 합계·팀 탭·종류 칸·물류·가장 오래된 건)는 이 파일의 mergeUnhandled 결과 한 벌에서만 센다.
 *  · 물류 = overdueLogic.isLogisticsSchedule(현황판 물류 칸과 같은 정의). 익일AS 는 AS일정.
 *  · 팀이 없는 일정(일정 팀 "기타" 등)은 "기타" 탭 — 탭 합 = 전체.
 */
import { isStaleRemote, normalizeRegion } from "./deptReception";
import { isLogisticsSchedule } from "./overdueLogic";
import type { SheetOpenRow } from "./receptionSheetOpen";

export type UnhandledKind = "복합기 AS" | "원격이관" | "IT" | "경영지원" | "운영지원" | "영업팀" | "AS일정" | "물류";
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
};

/** fetchOpenReceptions 행 중 쓰는 칸만 */
export type ReceptionInput = {
  id: string; receipt_date: string; created_at?: string; type: string; vendor: string; region: string;
  title?: string; symptom?: string; status: string; remote_meta?: Record<string, string> | null;
};
/** as_tickets 지난 날짜·미완료 행 */
export type TicketInput = {
  id: string; team: string; date: string; vendor: string; assignee: string; status: string; scheduleType: string;
  receptionId?: string | null; issue?: string;
};

const FIELD_TYPES = new Set(["복합기 AS", "원격이관", "IT"]);
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
export type SheetUnhandledInput = Pick<SheetOpenRow, "source" | "kind" | "sheetRow" | "date" | "vendor" | "field" | "summary" | "handler" | "state" | "region" | "receptionId">;

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
    });
  }
  for (const r of receptions) {
    if (isStaleRemote(r, today)) continue; // 7일 지난 원격대기 = 원격팀 처리로 봄
    openIds.add(String(r.id));
    const kind = (FIELD_TYPES.has(r.type) || DEPT_TEAM[r.type] ? r.type : "복합기 AS") as UnhandledKind;
    const date = String(r.receipt_date || r.created_at || "").slice(0, 10);
    out.push({
      key: `r:${r.id}`, source: "reception", kind, team: receptionTeam(r.type, r.region), date,
      vendor: String(r.vendor || ""), title: String(r.title || r.symptom || ""),
      assignee: String(r.remote_meta?.handler || ""), status: String(r.status || ""),
      ageDays: ageDaysOf(date, today), receptionId: String(r.id),
    });
  }
  for (const t of tickets) {
    const logistics = isLogisticsSchedule(t.scheduleType);
    const rid = String(t.receptionId || "");
    if (!logistics && rid && openIds.has(rid)) continue; // 접수 행과 중복
    const date = String(t.date || "").slice(0, 10);
    out.push({
      key: `t:${t.id}`, source: "ticket", kind: logistics ? "물류" : "AS일정", team: ticketTeam(t.team), date,
      vendor: String(t.vendor || ""), title: String(t.issue || ""), assignee: String(t.assignee || ""),
      status: String(t.status || ""), ageDays: ageDaysOf(date, today), ...(rid ? { receptionId: rid } : {}),
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

/** 종류 칸 순서(홈 미처리 칸) — 이 8칸의 합 = 전체 */
export const UNHANDLED_KINDS: UnhandledKind[] = ["복합기 AS", "원격이관", "IT", "경영지원", "운영지원", "영업팀", "AS일정", "물류"];
export const UNHANDLED_KIND_LABEL: Record<UnhandledKind, string> = {
  "복합기 AS": "복합기 AS", 원격이관: "원격", IT: "IT", 경영지원: "경영", 운영지원: "운영", 영업팀: "영업", AS일정: "AS 일정", 물류: "물류",
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
  "복합기 AS": "복합기", 원격이관: "원격", IT: "IT", 경영지원: "경영", 운영지원: "운영", 영업팀: "영업", AS일정: "AS", 물류: "납품·물류",
};
