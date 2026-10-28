// 서비스접수 › 경영·영업 [일정리스트]·[달력]에 시트 접수 줄 + 오늘 완료 표시(2026-10-28).
// 설계: docs/tasks/dept-plan-sheet-rows-2026-10-28.md. 사용자 결정 Q1(지난 날짜 열린 시트 줄은 일정리스트에 안 넣음 — 미처리 현황 몫),
// Q2(달력은 완료 시트 줄도 회색 취소선), Q3(처리자 빈칸 = 빨간 "미배정").
// 추가(사용자 "일정리스트엔 완료 표시도 없다"): [금일]에 오늘 완료된 앱 접수·시트 줄도 맨 아래 회색·취소선으로.
// 읽기만 한다 — team_calendar_events·service_receptions 에 시트 줄을 넣지 않는다(가상 표시).
import { selectRows } from "./supabase";
import { normVendor, SHEET_LIST_START } from "./receptionSheetState";
import type { SheetListRow, SheetListSource } from "./receptionSheetOpen";
import type { DeptType } from "./deptReception";
import type { DeptCalEvent } from "./deptCalendarView";

/** 부서 → 시트 출처. 운영지원은 접수 시트가 없어 null(시트를 읽지 않는다) */
export function deptSheetSource(dept: DeptType | string): SheetListSource | null {
  return dept === "영업팀" ? "sales" : dept === "경영지원" ? "mgmt" : null;
}

const vendorKey = (v: unknown) => normVendor(v).slice(0, 6);

/**
 * 보조 막이(3-2 2번) — 같은 부서(시트 kind = 앱 type)·같은 접수일·상호 앞 6자가 같은 앱 접수가 있으면 시트 줄을 숨긴다.
 * 엣지가 이미 이어진 행을 빼지만, 앱 저장 직후 잇기 전 1~2분·잇기 실패 때 같은 접수가 두 번 보이는 틈을 막는다.
 */
export function hideLinkedLike<S extends Pick<SheetListRow, "kind" | "date" | "vendor">>(
  sheet: S[], appRows: Array<{ type?: string; receipt_date?: string; vendor?: string }>,
): S[] {
  const keys = new Set<string>();
  for (const r of appRows) {
    const v = vendorKey(r.vendor);
    if (v) keys.add(`${r.type}|${String(r.receipt_date || "").slice(0, 10)}|${v}`);
  }
  if (!keys.size) return sheet;
  return sheet.filter((s) => {
    const v = vendorKey(s.vendor);
    return !v || !keys.has(`${s.kind}|${s.date}|${v}`);
  });
}

/**
 * 달력 막이(3-2 3번) — 같은 날 접수에서 온 앱 일정(제목 "[영업] 상호 · 분야")에 상호 앞 6자가 들어 있으면 시트 칩을 숨긴다.
 */
export function hideLikeEvents<S extends Pick<SheetListRow, "date" | "vendor">>(sheet: S[], events: Array<Pick<DeptCalEvent, "date" | "title" | "receptionId">>): S[] {
  const byDate = new Map<string, string[]>();
  for (const ev of events) {
    if (!ev.receptionId) continue;
    byDate.set(ev.date, [...(byDate.get(ev.date) || []), normVendor(ev.title)]);
  }
  if (!byDate.size) return sheet;
  return sheet.filter((s) => {
    const v = vendorKey(s.vendor);
    return !v || !(byDate.get(s.date) || []).some((t) => t.includes(v));
  });
}

const timeKey = (r: Pick<SheetListRow, "time" | "sheetRow">) => `${r.time || "99:99"}|${String(r.sheetRow).padStart(6, "0")}`;
const byTime = (a: SheetListRow, b: SheetListRow) => (timeKey(a) < timeKey(b) ? -1 : timeKey(a) > timeKey(b) ? 1 : 0);

/**
 * 일정리스트 [금일]에 넣을 시트 줄 — 접수일 = 오늘(2026-10-01 이후)만.
 * open = 열린(open/hold) 줄, done = 오늘 접수돼 완료된 줄(맨 아래 회색). 지난 날짜(미처리 현황 몫, Q1)·미래 접수일(오타)·CS 기록 줄은 넣지 않는다.
 * 각각 접수시간 순(시각 없음은 그 뒤, 같은 시각은 시트 행 순).
 */
export function sheetPlanItems(rows: SheetListRow[], today: string): { open: SheetListRow[]; done: SheetListRow[] } {
  const open: SheetListRow[] = [];
  const done: SheetListRow[] = [];
  for (const r of rows) {
    if (r.date !== today || r.date < SHEET_LIST_START) continue;
    if (r.cls === "open" || r.cls === "hold") open.push(r);
    else if (r.cls === "done") done.push(r);
  }
  return { open: open.sort(byTime), done: done.sort(byTime) };
}

/** ISO 시각 → KST 날짜(YYYY-MM-DD), 못 읽으면 "" */
export function kstDayOf(iso: unknown): string {
  const t = Date.parse(String(iso ?? ""));
  return Number.isFinite(t) ? new Date(t + 9 * 3600_000).toISOString().slice(0, 10) : "";
}

/**
 * 오늘 완료된 이 부서 앱 접수 — 완료 시각(completed_at)이 오늘(KST)인 것.
 * 완료 시각이 비었으면(옛 완료·시트 동기화 완료) 예정일 또는 접수일이 오늘인 것만.
 */
export function appDoneToday<R extends { type?: string; status?: string; receipt_date?: string; completed_at?: string | null; remote_meta?: Record<string, string> | null }>(
  rows: R[], dept: string, today: string,
): R[] {
  return rows.filter((r) => {
    if (r.type !== dept || String(r.status || "") !== "완료") return false;
    const at = kstDayOf(r.completed_at);
    if (at) return at === today;
    return String(r.remote_meta?.schedule_date || "").slice(0, 10) === today || String(r.receipt_date || "").slice(0, 10) === today;
  });
}

/** 오늘 완료 접수 조회문 — 완료 시각이 오늘 0시(KST) 이후이거나 접수일이 오늘(완료 시각 빈 행 대비). 거르기는 appDoneToday 가 한 번 더 */
export function doneTodayQuery(dept: string, today: string): string {
  const since = new Date(Date.parse(`${today}T00:00:00+09:00`)).toISOString(); // "…Z" — '+' 가 쿼리에 들어가지 않게
  return `select=${DONE_COLS}&type=eq.${encodeURIComponent(dept)}&status=eq.${encodeURIComponent("완료")}&deleted=eq.false`
    + `&or=(completed_at.gte.${since},receipt_date.eq.${today})&order=completed_at.asc.nullslast,id.asc&limit=200`;
}
const DONE_COLS = "id,created_at,receipt_date,author,type,route,vendor,region,grade,lease_no,title,field,symptom,status,remote_meta,sheet_row,completed_at";

/** 오늘 완료된 이 부서 앱 접수 읽기. 실패는 throw(부르는 쪽이 빨간 줄) */
export async function fetchDoneToday<R extends { type?: string; status?: string; receipt_date?: string; completed_at?: string | null; remote_meta?: Record<string, string> | null }>(
  dept: string, today: string,
): Promise<R[]> {
  const rows = await selectRows<R>("service_receptions", doneTodayQuery(dept, today));
  return appDoneToday(rows, dept, today);
}

/** 달력 칸별 시트 줄(접수일). 2026-10-01 이전 칸은 비어 있다 */
export function groupSheetByDate(rows: SheetListRow[]): Map<string, SheetListRow[]> {
  const map = new Map<string, SheetListRow[]>();
  for (const r of [...rows].sort(byTime)) {
    if (r.date < SHEET_LIST_START || r.cls === "record") continue;
    map.set(r.date, [...(map.get(r.date) || []), r]);
  }
  return map;
}
