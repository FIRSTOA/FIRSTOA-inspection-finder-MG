/**
 * 중간보고 명단·순서 — 웹앱(authors.ts bookOf · CsAsWorkspace 팀 명단/보고 순서)과 엣지 함수(schedule-report)가 같은 규칙을 쓴다(2026-10-31 이사).
 * 원본: 관리 탭 인원(cs_members). Deno·Vite 둘 다 읽으므로 외부 import 없이 순수 함수만 둔다.
 */

/** 명단 칸 — src/authors.ts AUTHOR_TEAMS 와 같아야 한다(tests/midReportShared.test.ts 가 지킨다) */
export const BOOK_TEAMS = ["팀장", "A", "B", "C", "D", "E", "IT"] as const;
export type BookTeam = typeof BOOK_TEAMS[number];
export type MemberBook = Record<BookTeam, string[]>;
export type MemberLike = { name: string; team: string; dept: string; active: boolean };

/** 보고·배정 팀(일정리스트의 Team 과 같은 칸) */
export type ReportTeam = "A" | "B" | "C" | "D" | "E" | "기타";
export type TeamAssignees = Record<ReportTeam, string[]>;

/** 팀장 명단이 비면 예전 기본값(신정훈) — 화면과 같은 폴백 */
export const DEFAULT_LEADERS = ["신정훈"];

/** cs_members 행 → 팀별 이름 명단(활성 인원만) — 예전 authors.ts bookOf 본문 그대로 */
export function bookFromMembers(rows: MemberLike[]): MemberBook {
  const next: MemberBook = { "팀장": [], A: [], B: [], C: [], D: [], E: [], IT: [] };
  for (const row of rows.filter((item) => item.active)) {
    // 겸직 표기("A·B")는 양쪽 팀 모두에 올린다 — 버리면 그 사람 배정 건이 어느 팀 보고에도 안 잡힌다
    // IT파트는 부서 자체가 IT — 팀 칸이 비어도 IT 명단(서비스접수 원격 처리자)에 올린다(2026-09-20 조직도)
    const parts = row.team.split(/[·/,]/).map((t) => t.trim());
    if (row.dept === "IT파트" && !parts.includes("IT")) parts.push("IT");
    for (const part of parts) {
      // CSS(운영지원) 인원 = E지역 담당 — E 명단에 올린다. 일정리스트 E 배정·A~D 지원 배정이 여기서 나온다(2026-09-18)
      const team = (part === "CSS" ? "E" : part) as BookTeam;
      if (!(BOOK_TEAMS as readonly string[]).includes(team)) continue;
      if (!next[team].includes(row.name)) next[team].push(row.name);
    }
  }
  return next;
}

/** 팀장 명단(비면 기본값) */
export function leadersOf(book: Partial<Record<string, string[]>>): string[] {
  return book["팀장"]?.length ? book["팀장"] : DEFAULT_LEADERS;
}

/** 팀별 배정·보고 명단 — 예전 CsAsWorkspace teamAssignees(useMemo) 본문 그대로 */
export function teamAssigneesOf(memberBook: Partial<Record<string, string[]>>): TeamAssignees {
  const lead = memberBook["팀장"]?.length ? memberBook["팀장"] : DEFAULT_LEADERS;
  const css = (memberBook.E || []).filter((n) => !lead.includes(n)); // CSS팀 = E지역 담당이면서 A~D 지원도 나간다(2026-09-18)
  const of = (t: "A" | "B" | "C" | "D" | "E") => {
    const names = memberBook[t] || []; // DB를 못 읽어도 authors.ts의 시드(AUTHOR_BOOK)가 채워준다 — 예비 명단을 두 벌 두면 서로 어긋난다
    const own = names.filter((n) => !lead.includes(n));
    const helpers = t === "E" ? [] : css.filter((n) => !own.includes(n)); // 자기 팀 뒤에 CSS 지원 인원, 마지막에 팀장
    return [...own, ...helpers, ...lead]; // 팀장은 어느 팀 화면에서든 선택 가능
  };
  return { A: of("A"), B: of("B"), C: of("C"), D: of("D"), E: of("E"), 기타: [] }; // E(지방)도 명단이 있으면 배정 가능
}

/** 보고 순서: 팀장 최상단 → 명단 순서(부파트장이 첫 번째) → 다른 팀으로 지원 나간 CS 인원 — 예전 CsAsWorkspace reportOrder 본문 그대로 */
export function reportOrderOf(reportTeam: ReportTeam, teamAssignees: TeamAssignees, csLeaders: string[]): string[] {
  const mine = teamAssignees[reportTeam].filter((n) => !csLeaders.includes(n));
  // 다른 지역으로 지원 나간 CS 인원의 건도 보고에 들어가야 한다 — 자기 팀 뒤에 나머지 CS 명단을 붙인다(건이 있을 때만 그룹이 생긴다)
  const others = (["A", "B", "C", "D", "E"] as ReportTeam[]).filter((t) => t !== reportTeam)
    .flatMap((t) => teamAssignees[t]).filter((n) => !csLeaders.includes(n) && !mine.includes(n));
  return [...csLeaders, ...mine, ...Array.from(new Set(others))];
}

/** 엣지용 한 번에 — cs_members 행 → 그 팀 보고 순서 */
export function reportOrderFromMembers(team: ReportTeam, rows: MemberLike[]): string[] {
  const book = bookFromMembers(rows);
  return reportOrderOf(team, teamAssigneesOf(book), leadersOf(book));
}
