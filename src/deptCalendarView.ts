/**
 * 캘린더 탭의 부서 달력(경영·운영·영업) 순수 로직 — team_calendar_events 를 읽기 전용으로 보여준다.
 * 현장 일정(as_tickets·네이버 미러)과는 섞지 않는다: 전체(ALL) 보기에는 넣지 않고, 부서 칸을 고를 때만 보인다.
 */
export const DEPT_CAL_TEAMS = ["경영지원", "운영지원", "영업팀"] as const;
export type DeptCalTeam = (typeof DEPT_CAL_TEAMS)[number];
export const DEPT_CAL_LABEL: Record<DeptCalTeam, string> = { 경영지원: "경영", 운영지원: "운영", 영업팀: "영업" };

export const isDeptCalTeam = (value: unknown): value is DeptCalTeam =>
  typeof value === "string" && (DEPT_CAL_TEAMS as readonly string[]).includes(value);

export type DeptCalEvent = {
  id: string; team: DeptCalTeam; date: string; time: string; title: string; memo: string; author: string;
  receptionId: string; // 서비스접수 id(없으면 "") — 처리는 접수 화면에서
  done: boolean;       // 접수 완료 시 제목 앞에 ✅ 가 붙는다(deptReceptionApi.completeDeptCalendar)
};

type RawRow = Partial<Record<"id" | "team" | "date" | "time" | "title" | "memo" | "author" | "reception_id", string | null>>;

/** DB 행 → 화면 행. 팀이 부서 3종이 아니거나 날짜가 yyyy-MM-dd 가 아니면 null(현장 팀 행이 섞여 들어오지 않게). */
export function toDeptCalEvent(row: RawRow): DeptCalEvent | null {
  const team = String(row.team ?? "");
  const date = String(row.date ?? "").slice(0, 10);
  if (!isDeptCalTeam(team) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !row.id) return null;
  const title = String(row.title ?? "").trim();
  return {
    id: String(row.id), team, date, time: String(row.time ?? "").slice(0, 5), title,
    memo: String(row.memo ?? ""), author: String(row.author ?? ""), receptionId: String(row.reception_id ?? ""),
    done: title.startsWith("✅"),
  };
}

/** PostgREST 조회문 — 한 부서·날짜 범위(달력 격자 첫 칸~끝 칸). */
export function deptCalQuery(team: DeptCalTeam, from: string, to: string): string {
  return `select=id,team,date,time,title,memo,author,reception_id&team=eq.${encodeURIComponent(team)}&date=gte.${from}&date=lte.${to}&order=date.asc,time.asc,created_at.asc`;
}

/** 날짜별 묶음(입력 순서 유지). */
export function groupDeptEventsByDate(events: DeptCalEvent[]): Map<string, DeptCalEvent[]> {
  const map = new Map<string, DeptCalEvent[]>();
  for (const ev of events) map.set(ev.date, [...(map.get(ev.date) || []), ev]);
  return map;
}

/** 팀 칩 클릭 해석 — 부서 칸이면 { dept }, 아니면 { dept: null, team } (현장 team 상태는 부서 칸에서 건드리지 않는다). */
export function splitTeamPick(value: string): { dept: DeptCalTeam; team: null } | { dept: null; team: string } {
  return isDeptCalTeam(value) ? { dept: value, team: null } : { dept: null, team: value };
}
