/**
 * 서비스접수 › 경영·운영·영업 미니 업무공간 — 일정리스트 묶음(금일/익일/예정)과 배정 후보 이름. 순수 함수만.
 * 설계: docs/tasks/dept-mini-workspace.md 3절. 처리자 1명(Q2), 후보 = cs_members 중 그 부서 활성 인원 + 부서 기본 처리자(Q3).
 * 2026-10-25 밤 사용자 "일정리스트의 [미처리] 묶음은 빼 달라 — 미처리현황 탭과 중복": [미처리] 칩·묶음 제거.
 * 예정일이 지났거나 없는 접수는 일정리스트에 나오지 않고 [미처리현황] 탭에서 본다(같은 행을 두 곳에 두지 않는다).
 */
import { defaultHandler, type DeptType } from "./deptReception";
import { nextWeekday } from "./deptReceptionFlow";
import type { DeptCalEvent } from "./deptCalendarView";
import type { SheetListRow } from "./receptionSheetOpen";
import { hideLinkedLike, sheetPlanItems } from "./deptPlanSheet";

export type PlanBucket = "today" | "next" | "later";
export const PLAN_BUCKETS: PlanBucket[] = ["today", "next", "later"];
export const PLAN_BUCKET_LABEL: Record<PlanBucket, string> = { today: "금일", next: "익일", later: "예정" };

/** 일정 묶음에 들어가는 접수 행의 최소 모양(OpenReceptionRow 가 맞는다) */
export type PlanRow = {
  id: string; type: string; status?: string; receipt_date?: string; created_at?: string;
  remote_meta?: Record<string, string> | null; vendor?: string; completed_at?: string | null;
};
export type PlanItem<R extends PlanRow = PlanRow> =
  | { kind: "reception"; key: string; date: string; row: R; done?: boolean }
  | { kind: "event"; key: string; date: string; ev: DeptCalEvent }
  /** 시트에만 적힌 접수(2026-10-28) — 접수일 = 오늘만, done = 오늘 접수돼 완료된 줄 */
  | { kind: "sheet"; key: string; date: string; sheet: SheetListRow; done: boolean };

/** 선택 인자(2026-10-28) — 없으면 예전과 1:1 */
export type PlanExtra<R extends PlanRow = PlanRow> = {
  /** 이 부서 출처 시트 줄(fetchSheetListRows). 오늘 접수일만 [금일]에 들어간다 */
  sheet?: SheetListRow[];
  /** 오늘 완료된 이 부서 앱 접수(fetchDoneToday) — [금일] 맨 아래 회색 */
  done?: R[];
};

/** 끝난 항목(완료 앱 접수·완료 시트 줄·✅ 부서 일정) */
export const isPlanDone = (it: PlanItem): boolean => (it.kind === "event" ? it.ev.done : !!it.done);

const CLOSED = new Set(["완료", "취소"]);
const isYmd = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * rows: 그 부서의 열린 접수(DB). 완료·취소·다른 종류는 걸러 낸다(낙관 갱신 뒤 다시 불러도 같은 결과).
 * events: 그 부서 달력 일정 — 접수와 연결 안 된 것(receptionId 없음)만 날짜 묶음에 넣고, 오늘 전 날짜는 뺀다.
 * 익일 = 오늘 뒤 ~ 다음 영업일(금요일이면 토·일·월). 예정 = 그 뒤. 예정일 지남·없음은 어느 묶음에도 넣지 않는다(미처리현황 몫).
 */
export function deptPlanBuckets<R extends PlanRow>(dept: DeptType, rows: R[], events: DeptCalEvent[], today: string, extra: PlanExtra<R> = {}): Record<PlanBucket, PlanItem<R>[]> {
  const out: Record<PlanBucket, PlanItem<R>[]> = { today: [], next: [], later: [] };
  const next = nextWeekday(today);
  const place = (date: string): PlanBucket | null => (date === today ? "today" : date > today && date <= next ? "next" : date > next ? "later" : null);
  for (const row of rows) {
    if (row.type !== dept || CLOSED.has(String(row.status || ""))) continue;
    const date = String(row.remote_meta?.schedule_date || "").slice(0, 10);
    const b = isYmd(date) ? place(date) : null;
    if (b) out[b].push({ kind: "reception", key: `r:${row.id}`, date, row });
  }
  for (const ev of events) {
    if (ev.team !== dept || ev.receptionId) continue;
    const b = place(ev.date);
    if (b) out[b].push({ kind: "event", key: `e:${ev.id}`, date: ev.date, ev });
  }
  const byDate = (a: PlanItem<R>, b: PlanItem<R>) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  for (const k of PLAN_BUCKETS) out[k].sort(byDate);

  // 2026-10-28: [금일] = (위 정렬 그대로) → 오늘 접수 열린 시트 줄(접수시간 순) → 오늘 완료(앱 → 시트) 맨 아래
  const doneRows = (extra.done || []).filter((r) => r.type === dept && String(r.status || "") === "완료");
  if (extra.sheet?.length) {
    const appSeen = [...rows.filter((r) => r.type === dept), ...doneRows];
    const sheet = hideLinkedLike(extra.sheet.filter((s) => s.kind === dept), appSeen);
    const { open, done } = sheetPlanItems(sheet, today);
    const sheetItem = (s: SheetListRow, isDone: boolean): PlanItem<R> =>
      ({ kind: "sheet", key: `sh:${s.source}:${s.month || s.date.slice(0, 7)}:${s.seq || s.sheetRow}`, date: s.date, sheet: s, done: isDone });
    out.today.push(...open.map((s) => sheetItem(s, false)));
    out.today.push(...doneRows.map((row): PlanItem<R> => ({ kind: "reception", key: `d:${row.id}`, date: today, row, done: true })));
    out.today.push(...done.map((s) => sheetItem(s, true)));
  } else {
    out.today.push(...doneRows.map((row): PlanItem<R> => ({ kind: "reception", key: `d:${row.id}`, date: today, row, done: true })));
  }
  return out;
}

/** 묶음 칩 숫자 — open = 안 끝난 것, done = 끝난 것(칩에 "✓m" 작게) */
export function planChipCount(items: PlanItem[]): { open: number; done: number } {
  let done = 0;
  for (const it of items) if (isPlanDone(it)) done += 1;
  return { open: items.length - done, done };
}

/** 전환 막대 "일정리스트 n" = 오늘 손댈 것(금일 접수·일정·오늘 접수 열린 시트 줄 중 안 끝난 것). 미처리는 [미처리현황] 숫자로 따로 센다. */
export function planTodoCount(b: Record<PlanBucket, PlanItem[]>): number {
  return planChipCount(b.today).open;
}

// ── 배정 후보(Q3) ─────────────────────────────────────
/** cs_members.dept 값(관리 탭 조직도, authors.ts depts) */
const MEMBER_DEPT: Record<DeptType, string> = { 경영지원: "경영지원파트", 운영지원: "CSS/운영지원파트", 영업팀: "영업팀" };
const REGIONS = ["A", "B", "C", "D", ""];

/**
 * 부서 직원 이름 = 부서 기본 처리자(지역표) + cs_members 중 그 부서 활성 인원. 운영지원은 CSS(E지역 현장)를 뺀다.
 * 비어 있으면 [] — 화면이 자유 입력을 연다.
 */
export function deptMemberNames(dept: DeptType, members: Array<{ name: string; dept?: string; team?: string; active?: boolean }>): string[] {
  const out: string[] = [];
  const add = (n: string) => { const v = String(n || "").trim(); if (v && !out.includes(v)) out.push(v); };
  REGIONS.forEach((r) => add(defaultHandler(dept, r)));
  for (const m of members) {
    if (m.active === false || String(m.dept || "").trim() !== MEMBER_DEPT[dept]) continue;
    if (dept === "운영지원" && String(m.team || "").split(/[·/,]/).map((t) => t.trim()).includes("CSS")) continue;
    add(m.name);
  }
  return out;
}

/** 미처리현황의 시트 행 key("s:sales:123") → 시트 출처·행. DB 행이면 null. */
export function sheetKeyOf(key: string): { source: "sales" | "mgmt" | "remote"; row: number } | null {
  const m = /^s:(sales|mgmt|remote):(\d+)$/.exec(String(key || ""));
  return m ? { source: m[1] as "sales" | "mgmt" | "remote", row: Number(m[2]) } : null;
}

/** 부서 → 홈 미처리 탭 이름(rowsForTab 에 넘긴다) */
export const DEPT_UNHANDLED_TAB: Record<DeptType, "경영" | "운영" | "영업"> = { 경영지원: "경영", 운영지원: "운영", 영업팀: "영업" };
