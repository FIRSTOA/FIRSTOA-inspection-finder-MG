// OKR 행 추가·삭제 확인창(2026-10-25 사용자 "생성·삭제할 때 확인 문구 — 중요 내용이 있을 수 있으니").
// 통합집계·분기 표·파트 탭(파트 종합·개인 주차) 모두 OkrHub.freshGoalOps 가 이 두 함수를 거친다. 취소하면 null(아무 것도 바꾸지 않음).
// 2026-10-25 저녁: 행의 주인 층(공통·파트 전용·개인 전용) — 추가한 화면이 곧 주인. docs/tasks/okr-rows-per-layer-2026-10-25.md
import { askConfirm } from "./confirmModal";
import { addGoalRow, goalLayer, goalRemoveKind, ownsGoal, removeGoalRow, type GoalRemoveKind, type OkrGoal, type OkrGoalLayer, type OkrGoalScope, type OkrGoalView } from "./okr";

// 추가 확인 문구 — layer: 어느 층 행인지, who: 파트 글자("A") 또는 사람 이름, month: 개인 전용일 때 "10월 모든 주차"
export function addGoalMessage(layer: OkrGoalLayer, who = "", month?: number): string {
  if (layer === "team") return `${who}파트 전용 병목 행을 추가할까요?\n${who}파트 종합과 ${who}파트원 주차 화면에만 생깁니다. 다른 파트·통합집계 표에는 보이지 않습니다.`;
  if (layer === "member") return `${who} 님 전용 병목 행을 추가할까요?\n${who} 님의 ${month ? `${month}월` : "이번 달"} 모든 주차에만 생깁니다. 다른 사람 화면엔 없고, 파트 종합에는 접혀 보입니다.`;
  return "새 공통 병목 행을 추가할까요?\nA~D 모든 파트와 파트원 주차 화면에 같은 행이 생깁니다.";
}
export const ADD_GOAL_MESSAGE = addGoalMessage("common");
// 분기 표에서 추가할 때 — 분기 행은 이미 팀장 월 OKR 이 있는 달(예: 10월)에는 자동으로 들어가지 않는다
export const ADD_QUARTER_GOAL_MESSAGE = "새 병목 행을 추가할까요?\n분기 표에 새 행이 생깁니다(이미 월 OKR이 있는 달엔 자동으로 들어가지 않음).";

export function removeGoalMessage(name: string, kind: GoalRemoveKind): { message: string; okLabel: string; danger: boolean } {
  if (kind === "archive") return { message: `${name} 행에 실제결과·판정 기록이 있어 지우지 않고 보관합니다.\n보관할까요? 지난 판정은 남고, 표 아래 [보관된 병목]에서 되살릴 수 있습니다.`, okLabel: "보관", danger: false };
  if (kind === "text") return { message: `${name} 행을 삭제할까요?\n글이 있습니다. 삭제하면 되돌릴 수 없습니다.\n(병목현상·목표·달성기준 글이 지워집니다. 실제결과·판정 기록은 없음)`, okLabel: "삭제", danger: true };
  return { message: `${name} 행을 삭제할까요?\n비어 있습니다.`, okLabel: "삭제", danger: true };
}

// 추가 — 늘 확인 뒤. 확인하면 addGoalRow 결과, 취소면 null.
// scope 를 주면 그 층 전용 행(파트 종합 = {team}, 파트원 = {team, member}), month 는 개인 전용 문구의 "n월". quarter=true 면 분기 표 문구.
export async function confirmAddGoalRow(goals: OkrGoal[], pillar: string, otherNos: number[] = [], quarter = false, scope?: OkrGoalScope, month?: number): Promise<{ goals: OkrGoal[]; no: number } | null> {
  const message = quarter ? ADD_QUARTER_GOAL_MESSAGE : scope ? addGoalMessage(goalLayer({ scope }), scope.member || scope.team, month) : ADD_GOAL_MESSAGE;
  if (!(await askConfirm(message, { okLabel: "추가" }))) return null;
  return addGoalRow(goals, pillar, otherNos, scope);
}

// 삭제 — 빈 행이어도 늘 확인. 글 여부는 그 행 자체(goals 안 같은 번호) 기준(파트 화면의 덮어쓴 글이 아니라 실제로 지워지는 글).
// view 를 주면 그 화면 층이 주인인 행만(아니면 묻지도 않고 null).
export async function confirmRemoveGoalRow(goals: OkrGoal[], no: number, hasRecords: boolean, name: string, view?: OkrGoalView): Promise<{ goals: OkrGoal[]; kind: GoalRemoveKind } | null> {
  const base = goals.find((g) => g.no === no);
  if (!base) return null;
  if (view && !ownsGoal(base, view)) return null;
  const kind = goalRemoveKind(base, hasRecords);
  const ask = removeGoalMessage(name, kind);
  if (!(await askConfirm(ask.message, { okLabel: ask.okLabel, danger: ask.danger }))) return null;
  const done = removeGoalRow(goals, no, hasRecords, view);
  return { goals: done.goals, kind: done.kind };
}

// 파트 탭(파트 종합·파트원 주차)에서 병목현상·목표 칸에 적을 때 어디에 저장할지(2026-10-25 저녁, 7절).
//   own = 지금 화면 층이 그 행의 주인 → okr_cycles.goals 의 그 행을 직접 고친다(onGoal).
//   layer = 위 층 행(공통, 또는 파트원이 보는 파트 전용) → 그 층 report.goals 덮어쓰기(4차 그대로).
//   오후 규칙("공통 칸이 비면 공통 행에 저장")·sticky 는 폐기 — 파트 탭에서 공통 행 자체를 고치는 길은 없다.
export function goalEditTarget(goal: OkrGoal | undefined, view: OkrGoalView): "own" | "layer" {
  return goal && ownsGoal(goal, view) ? "own" : "layer";
}
