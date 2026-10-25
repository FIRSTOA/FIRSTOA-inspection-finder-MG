// 서비스접수 오른쪽 기둥 보기 전환 — 저장 키·이벤트·탭 목록·숫자 합산.
// 2026-10-25 밤(사용자 "CS 접수·원격·IT 처럼 똑같이"): 6종 모두 [접수리스트][미처리 현황] 같은 뼈대, 경영·운영·영업만 [일정리스트][달력] 두 탭이 뒤에 더 붙는다.
import { RECEPTION_TYPES, type ReceptionType } from "./ReceptionTypePicker";
import { isDeptType } from "./deptReception";

/** list·board = 6종 공통, plan·cal = 부서(경영·운영·영업)만 */
export type ReceptionRightView = "list" | "board" | "plan" | "cal";
export const RECEPTION_RIGHT_KEY = "reception_right_v1";
/** 옛 부서 화면 기억 키(4탭 시절). 더 읽지 않는다 — 부서도 기본 보기 = 접수리스트. 남은 값은 무해. */
export const RECEPTION_RIGHT_DEPT_KEY = "reception_right_dept_v1";
/** 홈 카드에서 들어올 때 이미 떠 있는 서비스접수 화면에 "미처리 현황"으로 바꾸라는 신호 */
export const SHOW_BOARD_EVENT = "reception:show-board";

/** 저장값 → 보기. 옛 값 "list"/"board" 그대로 호환, 모르는 값은 접수리스트 */
export function parseRightView(v: string | null | undefined): ReceptionRightView {
  return v === "board" || v === "plan" || v === "cal" ? v : "list";
}

const BASE_TABS: ReadonlyArray<readonly [ReceptionRightView, string]> = [["list", "접수리스트"], ["board", "미처리 현황"]];
const DEPT_EXTRA_TABS: ReadonlyArray<readonly [ReceptionRightView, string]> = [["plan", "일정리스트"], ["cal", "달력"]];

/** 탭 줄 — 부서 화면이면 기본 2칸 뒤에 [일정리스트][달력] */
export function rightViewTabs(deptPage: boolean): ReadonlyArray<readonly [ReceptionRightView, string]> {
  return deptPage ? [...BASE_TABS, ...DEPT_EXTRA_TABS] : BASE_TABS;
}

/** 실제로 그릴 보기 — 부서 아닌 화면에서 일정리스트·달력이 기억돼 있으면 접수리스트 */
export function effectiveRightView(v: ReceptionRightView, deptPage: boolean): ReceptionRightView {
  return !deptPage && (v === "plan" || v === "cal") ? "list" : v;
}

/** 전환 칸 N = 접수 미처리(지원 3종은 켜져 있을 때만) + 일정 미처리 */
export function unhandledTotal(counts: Record<ReceptionType, number> | null, scheduleCount: number, deptEnabled: boolean): number {
  let n = 0;
  if (counts) for (const m of RECEPTION_TYPES) if (deptEnabled || !isDeptType(m.type)) n += counts[m.type] || 0;
  return n + (scheduleCount > 0 ? scheduleCount : 0);
}
