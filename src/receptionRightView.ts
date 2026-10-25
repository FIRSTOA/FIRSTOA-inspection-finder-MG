// 서비스접수 오른쪽 기둥 보기 전환(접수리스트 ↔ 미처리 현황) — 저장 키·이벤트·숫자 합산.
import { RECEPTION_TYPES, type ReceptionType } from "./ReceptionTypePicker";
import { isDeptType } from "./deptReception";

export type ReceptionRightView = "list" | "board";
export const RECEPTION_RIGHT_KEY = "reception_right_v1";
/** 홈 카드에서 들어올 때 이미 떠 있는 서비스접수 화면에 "미처리 현황"으로 바꾸라는 신호 */
export const SHOW_BOARD_EVENT = "reception:show-board";

export function parseRightView(v: string | null | undefined): ReceptionRightView {
  return v === "board" ? "board" : "list";
}

/** 전환 칸 N = 접수 미처리(지원 3종은 켜져 있을 때만) + 일정 미처리 */
export function unhandledTotal(counts: Record<ReceptionType, number> | null, scheduleCount: number, deptEnabled: boolean): number {
  let n = 0;
  if (counts) for (const m of RECEPTION_TYPES) if (deptEnabled || !isDeptType(m.type)) n += counts[m.type] || 0;
  return n + (scheduleCount > 0 ? scheduleCount : 0);
}

/**
 * 부서 화면(경영·운영·영업) 오른쪽 4칸 — 일정리스트(기본) / 달력 / 접수리스트 / 미처리현황. 현장 3종과 기억 키를 따로 둔다.
 * 달력(2026-10-25): 일정·캘린더 탭의 부서 칩이 없어져(사용자 "서비스접수 탭에서 올인원") 부서 달력(추가·수정·삭제)을 여기서 연다.
 */
export type DeptRightView = "plan" | "cal" | "list" | "board";
export const DEPT_RIGHT_VIEWS: ReadonlyArray<readonly [DeptRightView, string]> = [["plan", "일정리스트"], ["cal", "달력"], ["list", "접수리스트"], ["board", "미처리현황"]];
export const RECEPTION_RIGHT_DEPT_KEY = "reception_right_dept_v1";
export function parseDeptRightView(v: string | null | undefined): DeptRightView {
  return v === "cal" || v === "list" || v === "board" ? v : "plan";
}
