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
