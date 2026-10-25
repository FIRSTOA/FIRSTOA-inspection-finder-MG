// OKR 행의 주인(층) — 화면 쪽 판단(2026-10-25 저녁, docs/tasks/okr-rows-per-layer-2026-10-25.md 4·5절).
// 데이터 규칙(scope·goalsForView·ownsGoal·replaceCommonGoals …)은 okr.ts, 여기는 "지금 보는 화면(view)"의 글·접힘만 다룬다.
//   view {}               = 통합집계(공통 행의 주인)
//   view { team }         = 파트 탭 › 파트 종합(그 파트 전용 행의 주인)
//   view { team, member } = 파트 탭 › 파트원 주차(그 사람 전용 행의 주인)
import { ownsGoal, type OkrGoal, type OkrGoalLayer, type OkrGoalScope, type OkrTeam } from "./okr";

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
// 이 화면의 층이 그 행의 주인인지 — × 단추·"행 자체 고치기"는 주인일 때만(위 층 행은 덮어쓰기)
export const ownsRow = (g: OkrGoal, view: OkrView): boolean => ownsGoal(g, view);
// 병목현상 칸 위 작은 칩 글 — 공통 행은 빈 글(칩 없음)
export function layerChipLabel(g: OkrGoal, me = ""): string {
  const s = g.scope;
  if (!s) return "";
  if (!s.member) return `${s.team}파트 전용`;
  return s.member === me ? "내 전용" : `${s.member} 전용`;
}
// [＋ 병목 추가] 옆 글
export function addNoteOf(view: OkrView, me = ""): string {
  if (!view.team) return "모든 파트 공통";
  if (!view.member) return `${view.team}파트 전용`;
  return view.member === me ? "내 전용" : `${view.member} 전용`;
}

// 표 아래 접힘 "파트 전용 n행 · 개인 전용 m행" — 그 화면 표에 안 나오는 아래 층 행(보관 행 제외).
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
// 팀원 집계 칸 — 개인 전용 행은 그 사람 칸에만 값, 다른 사람 칸은 빗금(해당 아님)
export const rowAppliesTo = (g: OkrGoal, member: string): boolean => !g.scope?.member || g.scope.member === member;
