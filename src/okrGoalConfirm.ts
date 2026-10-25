// OKR 행 추가·삭제 확인창(2026-10-25 사용자 "생성·삭제할 때 확인 문구 — 중요 내용이 있을 수 있으니").
// 통합집계·분기 표·파트 탭(파트 종합·개인 주차) 모두 OkrHub.freshGoalOps 가 이 두 함수를 거친다. 취소하면 null(아무 것도 바꾸지 않음).
import { askConfirm } from "./confirmModal";
import { addGoalRow, bottleneckText, goalRemoveKind, removeGoalRow, type GoalRemoveKind, type OkrGoal } from "./okr";

export const ADD_GOAL_MESSAGE = "새 병목 행을 추가할까요?\n모든 파트(A~D)·주차 화면에 같은 행이 생깁니다.";
// 분기 표에서 추가할 때 — 분기 행은 이미 팀장 월 OKR 이 있는 달(예: 10월)에는 자동으로 들어가지 않는다
export const ADD_QUARTER_GOAL_MESSAGE = "새 병목 행을 추가할까요?\n분기 표에 새 행이 생깁니다(이미 월 OKR이 있는 달엔 자동으로 들어가지 않음).";

export function removeGoalMessage(name: string, kind: GoalRemoveKind): { message: string; okLabel: string; danger: boolean } {
  if (kind === "archive") return { message: `${name} 행에 실제결과·판정 기록이 있어 지우지 않고 보관합니다.\n보관할까요? 지난 판정은 남고, 표 아래 [보관된 병목]에서 되살릴 수 있습니다.`, okLabel: "보관", danger: false };
  if (kind === "text") return { message: `${name} 행을 삭제할까요?\n글이 있습니다. 삭제하면 되돌릴 수 없습니다.\n(병목현상·목표·달성기준 글이 지워집니다. 실제결과·판정 기록은 없음)`, okLabel: "삭제", danger: true };
  return { message: `${name} 행을 삭제할까요?\n비어 있습니다.`, okLabel: "삭제", danger: true };
}

// 추가 — 늘 확인 뒤. 확인하면 addGoalRow 결과, 취소면 null
export async function confirmAddGoalRow(goals: OkrGoal[], pillar: string, otherNos: number[] = [], quarter = false): Promise<{ goals: OkrGoal[]; no: number } | null> {
  if (!(await askConfirm(quarter ? ADD_QUARTER_GOAL_MESSAGE : ADD_GOAL_MESSAGE, { okLabel: "추가" }))) return null;
  return addGoalRow(goals, pillar, otherNos);
}

// 삭제 — 빈 행이어도 늘 확인. 글 여부는 공통 행(goals 안 같은 번호) 기준(파트 화면의 덮어쓴 글이 아니라 실제로 지워지는 글)
export async function confirmRemoveGoalRow(goals: OkrGoal[], no: number, hasRecords: boolean, name: string): Promise<{ goals: OkrGoal[]; kind: GoalRemoveKind } | null> {
  const base = goals.find((g) => g.no === no);
  if (!base) return null;
  const kind = goalRemoveKind(base, hasRecords);
  const ask = removeGoalMessage(name, kind);
  if (!(await askConfirm(ask.message, { okLabel: ask.okLabel, danger: ask.danger }))) return null;
  return removeGoalRow(goals, no, hasRecords);
}

// 파트 탭(파트 종합·파트원 주차)에서 병목현상·목표 칸에 적을 때 어디에 저장할지(2026-10-25 팀장 결정).
//   common = 공통 행(통합집계 goals, 모든 파트·통합집계에 보임) · layer = 그 층(파트/개인 report.goals 덮어쓰기, 4차 설계).
//   공통 칸이 비어 있고 어느 층도 그 칸을 덮어쓰지 않았으면 common. sticky = 이번 화면에서 이미 common 으로 쓰기 시작한 칸
//   (RichCell 은 글자마다 onChange 라, 첫 글자로 공통이 차도 이어 치는 글이 층으로 새지 않게).
export function goalEditTarget(common: OkrGoal | undefined, field: "objective" | "bottleneck", layers: Array<OkrGoal[] | undefined>, sticky: boolean): "common" | "layer" {
  if (!common) return "layer";
  if (sticky) return "common";
  const flag = field === "objective" ? "objectiveSet" : "bottleneckSet";
  if (layers.some((l) => !!l?.find((x) => x.no === common.no)?.html?.[flag])) return "layer";
  const text = field === "bottleneck" ? bottleneckText(common.bottleneck) : common.objective;
  return text.trim() ? "layer" : "common";
}
