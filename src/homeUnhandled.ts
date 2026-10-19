/**
 * 홈 "미처리 일정" 칸의 순수 로직 — 접수(6종) 미처리 + 일정(as_tickets) 미처리를 한 목록으로 (2026-10-19).
 * 중복 규칙: AS 일정 중 receptionId 가 열린 접수에 이미 있으면 접수 행으로만 센다. 물류 일정은 전부 넣는다.
 */
import { isStaleRemote, normalizeRegion } from "./deptReception";
import { overdueKind } from "./overdueLogic";

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

export function mergeUnhandled(receptions: ReceptionInput[], tickets: TicketInput[], today: string): UnhandledRow[] {
  const out: UnhandledRow[] = [];
  const openIds = new Set<string>();
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
    const logistics = overdueKind(t.scheduleType) === "물류";
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

export type UnhandledTab = "전체" | "A" | "B" | "C" | "D" | "E" | "경영" | "운영" | "영업" | "물류";
export const UNHANDLED_TABS: UnhandledTab[] = ["전체", "A", "B", "C", "D", "E", "경영", "운영", "영업", "물류"];

/** 탭 → 필터 인자 */
export function tabFilter(tab: UnhandledTab): [UnhandledTeam | null, UnhandledKind | null] {
  if (tab === "전체") return [null, null];
  if (tab === "물류") return [null, "물류"];
  return [tab, null];
}

export function rowsForTab(rows: UnhandledRow[], tab: UnhandledTab): UnhandledRow[] {
  const [team, kind] = tabFilter(tab);
  // 탭은 서로 겹치지 않게: 팀 탭(A~E)은 물류를 빼고, 물류 탭만 물류를 모은다 → A+B+C+D+E+경영+운영+영업+물류 = 전체 (2026-10-20 사용자 지적)
  return filterUnhandled(rows, team, kind).filter((r) => tab === "전체" || tab === "물류" || r.kind !== "물류");
}

/** 탭별 건수 */
export function countUnhandledTabs(rows: UnhandledRow[]): Record<UnhandledTab, number> {
  const out = Object.fromEntries(UNHANDLED_TABS.map((t) => [t, 0])) as Record<UnhandledTab, number>;
  for (const t of UNHANDLED_TABS) out[t] = rowsForTab(rows, t).length;
  return out;
}

/** 행 배지 글자 */
export const UNHANDLED_BADGE: Record<UnhandledKind, string> = {
  "복합기 AS": "복합기", 원격이관: "원격", IT: "IT", 경영지원: "경영", 운영지원: "운영", 영업팀: "영업", AS일정: "AS", 물류: "납품·물류",
};
