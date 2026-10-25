// OKR 행의 주인(층) — 화면 쪽 판단(2026-10-25 저녁, docs/tasks/okr-rows-per-layer-2026-10-25.md 4·5절).
// 데이터 규칙(scope·goalsForView·goalAppliesTo·editsRowDirectly·replaceCommonGoals …)은 okr.ts, 여기는 "지금 보는 화면(view)"의 글·잠금만 다룬다.
// 2026-10-25 밤 사용자 정정: 모든 행은 모든 화면에 보인다(접힘 없음), 주인은 칩으로 표시만, 판정 칸만 대상이 아니면 잠근다.
//   view {}               = 통합집계(공통 행의 주인)
//   view { team }         = 파트 탭 › 파트 종합(그 파트 전용 행의 주인)
//   view { team, member } = 파트 탭 › 파트원 주차(그 사람 전용 행의 주인)
import { editsRowDirectly, goalAppliesTo, type OkrGoal, type OkrGoalLayer, type OkrGoalScope, type OkrTeam } from "./okr";

export type OkrView = { team?: OkrTeam; member?: string };

// 파트 탭의 member 값("" = 파트 종합, "__sum__" = 팀원 집계, 그 밖 = 사람 이름) → view
export function viewOf(team: OkrTeam | null, member = ""): OkrView {
  if (!team) return {};
  return member && member !== "__sum__" ? { team, member } : { team };
}
export const viewLayer = (view: OkrView): OkrGoalLayer => (view.team ? (view.member ? "member" : "team") : "common");
// 이 화면에서 [＋ 병목 추가]로 만드는 행의 scope(공통이면 undefined)
export function scopeForView(view: OkrView): OkrGoalScope | undefined {
  if (!view.team) return undefined;
  return view.member ? { team: view.team, member: view.member } : { team: view.team };
}
// 그 행의 주인 화면(접힘 [정리]·보관 되살리기를 그 층 ops 로 보낼 때)
export const ownerViewOf = (g: OkrGoal): OkrView => (g.scope ? viewOf(g.scope.team, g.scope.member || "") : {});
// 이 화면에서 행 자체를 고치고 × 로 지울 수 있는지(2026-10-25 밤) — 전용 행은 어디서든, 공통 행은 통합집계·분기에서만
export const canEditRow = (g: OkrGoal, view: OkrView): boolean => editsRowDirectly(g, view);
// 병목현상 칸 위 작은 칩 글(2026-10-25 밤 "주인 칩") — 공통 행은 빈 글(칩 없음) · 파트 전용 "A파트" · 개인 전용 "홍길동"
export function layerChipLabel(g: OkrGoal): string {
  const s = g.scope;
  if (!s) return "";
  return s.member ? s.member : `${s.team}파트`;
}
// [＋ 병목 추가] 옆 글
export function addNoteOf(view: OkrView, me = ""): string {
  if (!view.team) return "모든 파트 공통";
  if (!view.member) return `${view.team}파트 전용`;
  return view.member === me ? "내 전용" : `${view.member} 전용`;
}
// 판정·실제결과 칸 잠금 글(2026-10-25 밤) — 이 화면이 그 행의 판정 대상이 아니면 빗금 + 이 글, 대상이면 빈 글.
//   개인 전용 = 그 사람 주차 화면에서만 · 파트 전용 = 그 파트(파트 종합·파트원)만 · 공통 = 늘 열림.
export function judgmentLockOf(g: OkrGoal, view: OkrView): string {
  if (goalAppliesTo(g, view) || !g.scope) return "";
  return g.scope.member ? `${g.scope.member} 전용 — 본인이 판정` : `${g.scope.team}파트 전용 — ${g.scope.team}파트가 판정`;
}
// 팀원 집계 칸 — 그 사람(그 파트)의 판정 대상 행만 값, 아니면 빗금(해당 아님). 다른 파트 전용·다른 사람 전용 모두 빗금.
export const rowAppliesTo = (g: OkrGoal, team: OkrTeam, member: string): boolean => goalAppliesTo(g, { team, member });
