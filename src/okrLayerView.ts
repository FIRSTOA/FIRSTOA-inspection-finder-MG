// OKR 행의 주인(층) — 화면 쪽 판단(2026-10-25 저녁, docs/tasks/okr-rows-per-layer-2026-10-25.md 4·5절).
// 데이터 규칙(scope·goalsForView·goalAppliesTo·editsRowDirectly·replaceCommonGoals …)은 okr.ts, 여기는 "지금 보는 화면(view)"의 글·잠금만 다룬다.
// 2026-10-25 밤 재정정: 보임은 저녁 규칙(내 행은 내 탭에만 — 통합집계 = 공통 + 접힘, 파트 종합 = 공통 + 그 파트 전용, 파트원 탭 = + 그 사람 전용),
//   수정은 그 탭을 연 누구나(전용 행 = 행 자체를 고치고·판정하고·삭제, 확인창에 주인). 판정 잠금(judgmentLockOf)은 보이는 행엔 늘 빈 글 — 안전장치로 둔다.
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

// 표 아래 접힘 "파트 전용 n행 · 개인 전용 m행" — 그 화면 표에 안 나오는 아래 층 행(보관 행 제외). 2026-10-25 밤 재정정으로 되살림.
//   통합집계(view {}) = 모든 파트 전용 + 모든 개인 전용 · 파트 종합(view {team}) = 그 파트 사람들의 개인 전용 · 파트원 = 없음.
//   orphan = 개인 전용인데 명단(roster)에 없는 이름(R3) — rosterOf 를 안 넘기면 판단하지 않는다.
export type LayerFoldGroup = { team: OkrTeam; member?: string; goals: OkrGoal[]; orphan: boolean };
export type LayerFold = { teamRows: number; memberRows: number; groups: LayerFoldGroup[] };
export function layerFoldOf(goals: OkrGoal[], view: OkrView, rosterOf?: (team: OkrTeam) => string[]): LayerFold {
  const out: LayerFold = { teamRows: 0, memberRows: 0, groups: [] };
  if (view.member) return out;
  for (const g of goals) {
    const s = g.scope;
    if (!s || g.hidden) continue;
    if (view.team && (s.team !== view.team || !s.member)) continue;
    if (s.member) out.memberRows += 1; else out.teamRows += 1;
    let grp = out.groups.find((x) => x.team === s.team && (x.member || "") === (s.member || ""));
    if (!grp) {
      grp = { team: s.team, ...(s.member ? { member: s.member } : {}), goals: [], orphan: !!s.member && !!rosterOf && !rosterOf(s.team).includes(s.member) };
      out.groups.push(grp);
    }
    grp.goals.push(g);
  }
  // 파트 순(A~), 같은 파트 안에서는 파트 전용 먼저·이름 순
  out.groups.sort((a, b) => (a.team === b.team ? (a.member || "").localeCompare(b.member || "", "ko") : a.team.localeCompare(b.team)));
  return out;
}
