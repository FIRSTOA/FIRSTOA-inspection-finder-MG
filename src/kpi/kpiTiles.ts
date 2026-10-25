/**
 * 홈 3차(2026-10-25 "팀 보드") 달성표 상태 타일 · 팀 필터 · OKR 칩 — 표시용 순수 함수(KpiWidgets.view.tsx 가 쓴다).
 * 컴포넌트 파일에서 함수를 내보내면 fast refresh 규칙(react-refresh/only-export-components)에 걸려 여기로 뺐다.
 * 설계: docs/tasks/home-design-3-2026-10-24.md 3절 (나) · docs/tasks/home-design-3-impl-2026-10-25.md. 테스트: tests/homeKpiBoard.test.tsx
 */
import type { KpiOkrScope, KpiScope, KpiStatus, KpiTheme, KpiTone } from "./KpiWidgets.view";
import type { TeamKey } from "./teamColors";

/** 팀 칸 타일 배경(상태색 옅게). 팀 색은 여기 쓰지 않는다(머리줄 띠·배지에만) */
const STATUS_TILE: Record<KpiTheme, Record<KpiStatus, string>> = {
  deck: { done: "bg-emerald-500/15", onTrack: "bg-sky-500/12", behind: "bg-rose-500/18", none: "bg-white/[0.04]", pending: "border border-dashed border-slate-500/60" },
  light: { done: "bg-emerald-50", onTrack: "bg-sky-50", behind: "bg-rose-50", none: "bg-slate-50", pending: "border border-dashed border-slate-300" },
};

/** 타일 배경 클래스 — 목표 없는 칸(hasTarget=false)은 상태와 상관없이 회색, 준비 중은 점선 */
export function statusTileClass(status: KpiStatus, hasTarget: boolean, theme: KpiTheme = "deck"): string {
  return STATUS_TILE[theme][hasTarget || status === "pending" ? status : "none"];
}

/** 팀 필터(홈 3차 팀 카드)가 있을 때 흐리게 할 칸인가 — CS 전체·고른 팀은 그대로, 다른 팀만 */
export function teamCellDimmed(scope: KpiScope, filter?: TeamKey | null): boolean {
  return Boolean(filter) && scope !== "CS" && scope !== filter;
}

/** OKR 달성률 톤(링·막대 공용, 기존 규칙 그대로): 80 이상 초록 · 50 이상 노랑 · 그 아래 빨강 · 기록 없음 회색 */
export function okrTone(pct: number | null): KpiTone {
  return pct === null ? "idle" : pct >= 80 ? "ok" : pct >= 50 ? "warn" : "bad";
}

/** 팀 카드 필터 → OKR 범위 칩. CSS(E)는 OKR 대상이 아니라 전체, 없음도 전체 */
export function okrTeamFromFilter(f: TeamKey | null | undefined): KpiOkrScope["team"] {
  return f === "A" || f === "B" || f === "C" || f === "D" ? f : "ALL";
}
