/**
 * 팀 고정 색 — 홈 3차 디자인(2026-10-25, docs/tasks/home-design-3-2026-10-24.md 원칙 3).
 * 상태색(달성 초록·순항 파랑·부족 빨강)과 겹치지 않는 5색. 팀 색은 "어느 팀 칸인지"에만 쓰고(머리줄 띠·글자 배지·탭 점),
 * 본문 숫자·막대 색은 계속 상태색 하나만 뜻한다(한 자리 한 뜻). 항상 팀 글자와 함께 나온다(색만으로 구별 금지).
 * E 팀은 화면 이름이 CSS(firstoa-teams-css-e).
 */
export type TeamKey = "A" | "B" | "C" | "D" | "E";

export type TeamColor = {
  key: TeamKey;
  label: string;        // 화면 이름 (E → CSS)
  hex: string;          // 띠·점 (Tailwind 400 계열)
  text: string;         // 어두운 바탕 위 글자 (200 계열, 대비 4.5:1 이상)
  soft: string;         // 옅은 배경 rgba
  band: string;         // 머리줄 위 띠 클래스
  badge: string;        // 글자 배지 클래스(배경+글자)
  dot: string;          // 탭·칩 점 클래스
  chipOn: string;       // 선택된 칩(팀 색 배경 + 어두운 글자)
};

const C = (key: TeamKey, label: string, hex: string, text: string, soft: string, tw: string, dark: string): TeamColor => ({
  key, label, hex, text, soft,
  band: `border-t-[3px] border-${tw}-400`,
  badge: `bg-${tw}-400/[0.18] text-${tw}-200`,
  dot: `bg-${tw}-400`,
  chipOn: `bg-${tw}-400 ${dark}`,
});

export const TEAM_COLORS: Record<TeamKey, TeamColor> = {
  A: C("A", "A", "#818cf8", "#c7d2fe", "rgba(129,140,248,0.18)", "indigo", "text-indigo-950"),
  B: C("B", "B", "#a3e635", "#d9f99d", "rgba(163,230,53,0.18)", "lime", "text-lime-950"),
  C: C("C", "C", "#e879f9", "#f5d0fe", "rgba(232,121,249,0.18)", "fuchsia", "text-fuchsia-950"),
  D: C("D", "D", "#fb923c", "#fed7aa", "rgba(251,146,60,0.18)", "orange", "text-orange-950"),
  E: C("E", "CSS", "#2dd4bf", "#99f6e4", "rgba(45,212,191,0.18)", "teal", "text-teal-950"),
};

export const TEAM_ORDER: TeamKey[] = ["A", "B", "C", "D", "E"];

/** 팀 키가 아니면(전체·미지정·빈 값) null — 호출 쪽이 회색으로 그린다. */
export function teamColor(team: string | null | undefined): TeamColor | null {
  if (!team) return null;
  const k = team === "CSS" ? "E" : team.toUpperCase();
  return (TEAM_ORDER as string[]).includes(k) ? TEAM_COLORS[k as TeamKey] : null;
}

/* Tailwind 가 클래스 이름을 정적으로 찾도록 전부 적어 둔다(동적 조합 금지):
   border-indigo-400 border-lime-400 border-fuchsia-400 border-orange-400 border-teal-400
   bg-indigo-400/[0.18] bg-lime-400/[0.18] bg-fuchsia-400/[0.18] bg-orange-400/[0.18] bg-teal-400/[0.18]
   text-indigo-200 text-lime-200 text-fuchsia-200 text-orange-200 text-teal-200
   bg-indigo-400 bg-lime-400 bg-fuchsia-400 bg-orange-400 bg-teal-400
   text-indigo-950 text-lime-950 text-fuchsia-950 text-orange-950 text-teal-950 */
