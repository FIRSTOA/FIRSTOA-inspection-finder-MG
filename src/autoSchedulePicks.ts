/**
 * 자동 일정 "선택 스케줄"(등록 전 고른 곳) 보관 규칙 — 2026-10-24.
 * ① 고른 곳은 고를 때의 팀(pick.team)에 붙는다: 팀 칩을 바꾸면 그 팀 것만 보이고, 등록은 pick.team 으로 저장한다
 *    (전엔 날짜로만 묶고 등록 때 화면의 팀으로 저장해, D팀에서 고른 뒤 칩을 C 로 바꾸면 C팀 일정이 됐다).
 * ② 목록은 작성자별 localStorage 키에 둔다. 상태가 자기 주인(owner)을 들고 있어, 작성자가 바뀌면
 *    새 작성자 키에서 다시 읽고 저장도 owner 키로만 한다(전엔 처음 작성자 목록이 새 작성자 키로 덮였다).
 */
export type PickBase = { date: string; team: string };

/** 옛 저장분에 팀이 비어 있으면 지금 팀 것으로 본다 */
export function pickTeam<P extends PickBase>(pick: P, currentTeam: string): string {
  return pick.team || currentTeam;
}

/** 그 날짜·그 팀에서 고른 것만 */
export function picksFor<P extends PickBase>(saved: P[], date: string, team: string): P[] {
  return saved.filter((x) => x.date === date && pickTeam(x, team) === team);
}

/** 등록 뒤 남길 것 — 등록한 날짜·팀 것만 빼고 다른 팀·다른 날짜는 그대로 */
export function picksAfterRegister<P extends PickBase>(saved: P[], date: string, team: string): P[] {
  return saved.filter((x) => !(x.date === date && pickTeam(x, team) === team));
}

export const picksKey = (author: string) => `cs_autoplan_picks_${author}`;

export type OwnedPicks<P> = { owner: string; picks: P[] };

export function loadPicksFrom<P>(storage: Pick<Storage, "getItem"> | null | undefined, author: string): P[] {
  try {
    const raw = JSON.parse(storage?.getItem(picksKey(author)) || "[]");
    return Array.isArray(raw) ? (raw as P[]) : [];
  } catch { return []; }
}

/** 작성자가 바뀌었으면 새 작성자 목록으로 갈아끼운다(같으면 같은 객체 그대로 — 다시 그리기 없음) */
export function picksForAuthor<P>(state: OwnedPicks<P>, author: string, load: (author: string) => P[]): OwnedPicks<P> {
  return state.owner === author ? state : { owner: author, picks: load(author) };
}
