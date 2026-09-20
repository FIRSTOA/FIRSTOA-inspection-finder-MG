import { useEffect, useMemo, useState } from "react";
import { deleteRows, insertRow, selectRows, updateRows } from "./supabase";

// 작성자 명단 — 원본은 Supabase cs_members 테이블이다.
// 예전에는 브라우저 localStorage에 두어 신입·퇴사 반영이 그 PC에서만 보였다.
// 지금은 DB가 원본이고, localStorage는 첫 화면이 비어 보이지 않게 하는 거울(캐시)로만 쓴다.

export type AuthorTeam = "팀장" | "A" | "B" | "C" | "D" | "E" | "IT";

export const AUTHOR_TEAMS: AuthorTeam[] = ["팀장", "A", "B", "C", "D", "E", "IT"]; // E=지방(충청외) 2026-09-17 활성화 — 담당은 CSS팀 · IT=원격팀(서비스접수·원격 처리에서 자기 이름을 고를 수 있어야 한다)

/** 외부 이관 작성자 — AS를 제조사·타사로 넘길 때 작성자 칸에 사람 대신 쓴다(2026-09-18 요청). 명단(cs_members)에는 없는 고정 값 */
export const EXTERNAL_AUTHORS = ["삼성이관", "제록스이관", "신도이관"];

/** 팀 글자 → 화면 이름. E지역은 별도 E팀이 아니라 CSS팀이 맡는다(A~D 지원도 겸함) — 화면엔 "CSS팀"으로(2026-09-18 결정) */
export function teamLabel(team: string): string {
  const custom = groupsCache.labels[team]; // 등록부 표시명(사용자가 바꾼 이름) 우선
  if (custom) return custom;
  if (team === "E") return "CSS팀";
  if (team === "팀장" || team === "IT" || team === "기타" || team === "종일" || team === "전체" || !team) return team;
  return `${team}팀`;
}
export function teamShort(team: string): string { return team === "E" ? "CSS" : team; }

/** DB를 못 읽을 때 쓰는 최소 명단 (초기 시드와 동일) */
export const AUTHOR_BOOK: Record<AuthorTeam, string[]> = {
  "팀장": ["신정훈"],
  A: ["이권선", "심태현", "김정민", "정웅"],
  B: ["윤기준", "권태혁", "조윤"],
  C: ["이홍진", "이민구", "박영현", "한왕주"],
  D: ["김종희", "이호준", "양승원"],
  E: [], // 지방(E) — 인원은 관리 탭 인원 명단(cs_members)에서 팀 "E"로 등록
  IT: ["김광태", "김담우", "김정식", "문종주", "손영근", "신동원", "지경민"],
};

export type MemberRow = {
  id: string;
  name: string;
  team: string;            // CS: 팀장/A~D (작성자 명단용) · 타부서: 전략영업/IT/운영지원 등
  dept: string;            // 임원 / CS팀 / 영업팀 / CSS·운영지원
  title: string;           // 팀장/파트장/부파트장 — 빈값이면 호칭은 "프로"
  active: boolean;
  joined_on: string | null;
  left_on: string | null;
  note: string;
  sort: number;
  updated_at?: string | null; // 마지막 수정 시각 — 관리 탭 '수정일'
};

/** 호칭: 직책이 없으면 전부 "프로", 임원은 "임원" */
export function displayTitle(member: Pick<MemberRow, "title" | "dept">): string {
  return member.title || (member.dept === "임원" ? "임원" : "프로");
}

const MIRROR_KEY = "firstoa.memberBook.v2";
const CHANGE_EVENT = "firstoa-authors-change";

type Book = Record<AuthorTeam, string[]>;

function emptyBook(): Book {
  return { "팀장": [], A: [], B: [], C: [], D: [], E: [], IT: [] };
}

function bookOf(rows: MemberRow[]): Book {
  const next = emptyBook();
  for (const row of rows.filter((item) => item.active)) {
    // 겸직 표기("A·B")는 양쪽 팀 모두에 올린다 — 버리면 그 사람 배정 건이 어느 팀 보고에도 안 잡힌다
    for (const part of row.team.split(/[·/,]/).map((t) => t.trim())) {
      // CSS(운영지원) 인원 = E지역 담당 — E 명단에 올린다. 일정리스트 E 배정·A~D 지원 배정이 여기서 나온다(2026-09-18)
      const team = (part === "CSS" ? "E" : part) as AuthorTeam;
      if (!AUTHOR_TEAMS.includes(team)) continue;
      if (!next[team].includes(row.name)) next[team].push(row.name);
    }
  }
  return next;
}

function readMirror(): Book | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MIRROR_KEY) || "") as Book;
    return AUTHOR_TEAMS.every((team) => Array.isArray(parsed?.[team])) ? parsed : null;
  } catch { return null; }
}

// 화면 여러 곳에서 같은 훅을 쓰므로 모듈 단위로 한 번만 받아 공유한다.
let cache: Book | null = readMirror();
let rowsCache: MemberRow[] = [];
let inflight: Promise<MemberRow[]> | null = null;

export async function fetchMembers(): Promise<MemberRow[]> {
  const rows = await selectRows<MemberRow>("cs_members", "select=*&order=dept.asc,team.asc,sort.asc,name.asc");
  rowsCache = rows;
  cache = bookOf(rows);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(MIRROR_KEY, JSON.stringify(cache));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
  return rows;
}

function refresh() {
  if (!inflight) inflight = fetchMembers().finally(() => { inflight = null; });
  return inflight;
}

async function findMember(team: string, name: string) {
  const rows = await selectRows<MemberRow>("cs_members", `select=id,active&name=eq.${encodeURIComponent(name)}&team=eq.${encodeURIComponent(team)}`);
  return rows[0];
}

export async function addMember(team: string, name: string, joinedOn?: string, dept = "CS팀", title = "") {
  const clean = name.trim();
  if (!clean) return;
  const found = await findMember(team, clean);
  if (found) await updateRows("cs_members", `id=eq.${found.id}`, { active: true, left_on: null, dept, title, updated_at: new Date().toISOString() });
  else await insertRow("cs_members", { name: clean, team, dept, title, active: true, joined_on: joinedOn || new Date().toISOString().slice(0, 10), sort: 99 });
  await fetchMembers();
}

export async function updateMember(id: string, patch: Partial<Pick<MemberRow, "name" | "team" | "dept" | "title">>) {
  await updateRows("cs_members", `id=eq.${id}`, { ...patch, updated_at: new Date().toISOString() });
  await fetchMembers();
}

/** 지금 명단(DB에서 읽은 것, 못 읽었으면 시드) — 작성자 → 팀 판정은 반드시 이걸 쓴다(관리 탭 인원 명단 기준) */
export function currentBook(): Record<AuthorTeam, string[]> { return cache || AUTHOR_BOOK; }

/** 전 인원(회사 전체) 행 — 부서 요청 요청자 선택·프로필 표시용 */
export function useMembers(): MemberRow[] {
  const [rows, setRows] = useState<MemberRow[]>(rowsCache);
  useEffect(() => {
    let alive = true;
    const sync = () => { if (alive) setRows(rowsCache); };
    window.addEventListener(CHANGE_EVENT, sync);
    void refresh().then(sync).catch(() => {});
    return () => { alive = false; window.removeEventListener(CHANGE_EVENT, sync); };
  }, []);
  return rows;
}

/** 명단에서 삭제 — 행을 지운다(2026-09-20 결정: 퇴사 처리 대신 삭제로 관리). 과거 기록은 이름 문자열로 남아 있어 집계는 안 깨진다 */
export async function deleteMember(id: string) {
  await deleteRows("cs_members", `id=eq.${encodeURIComponent(id)}`);
  await fetchMembers();
}

/** (예전) 퇴사 처리 — 남아 있는 퇴사자 행 복구용으로만 유지 */
export async function retireMember(id: string, leftOn?: string) {
  await updateRows("cs_members", `id=eq.${id}`, { active: false, left_on: leftOn || new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() });
  await fetchMembers();
}

export async function restoreMember(id: string) {
  await updateRows("cs_members", `id=eq.${id}`, { active: true, left_on: null, updated_at: new Date().toISOString() });
  await fetchMembers();
}

export async function moveMemberTeam(id: string, team: string) {
  await updateRows("cs_members", `id=eq.${id}`, { team, updated_at: new Date().toISOString() });
  await fetchMembers();
}

export function useAuthorBook() {
  const [book, setBook] = useState<Book>(() => cache || AUTHOR_BOOK);

  useEffect(() => {
    let alive = true;
    const sync = () => { if (alive && cache) setBook(cache); };
    // storage 이벤트는 다른 탭의 쓰기에서 온다 — 이 탭의 cache를 미러에서 다시 읽어야 실제로 반영된다
    const onStorage = () => { const mirrored = readMirror(); if (mirrored) cache = mirrored; sync(); };
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", onStorage);
    void refresh().then(sync).catch(() => {});
    return () => {
      alive = false;
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const authors = useMemo(() => AUTHOR_TEAMS.flatMap((team) => book[team] || []), [book]);

  // 기존 API 유지 — 부르는 곳(양식 화면들)을 그대로 두기 위해 시그니처를 바꾸지 않는다.
  const addAuthor = (team: AuthorTeam, name: string) => { void addMember(team, name); };
  const removeAuthor = (team: AuthorTeam, name: string) => {
    void (async () => {
      const found = await findMember(team, name);
      if (found) await retireMember(found.id);
    })();
  };

  return { book, authors, addAuthor, removeAuthor };
}

// ───────────────────────── 그룹(부서) · 소그룹(팀) 등록부 ─────────────────────────
// 사용자 선택 창과 관리 탭 인원 명단이 같은 그룹 구조를 본다(2026-09-18 "관리탭 인원이랑도 동기화").
// 원본은 app_config TEAM_GROUPS(JSON). 인원(cs_members)의 dept/team 값과 짝을 이루며,
// 사람이 없는 그룹도 여기 있어야 화면에 남는다. CS 팀 글자(A~E)는 일정 시간대·카톡방 배정에 쓰이는 값이라
// 코드는 바꾸지 않고 표시명(labels)만 바꾼다 — E는 기본 표시명이 "CSS팀".
export type TeamGroups = {
  depts: string[];                       // 상위 그룹(부서) 순서
  teams: Record<string, string[]>;       // 부서별 소그룹(팀) — ""는 팀 미지정
  labels: Record<string, string>;        // CS 팀 글자 → 표시명 (예: E → CSS팀)
  hidden: string[];                      // 숨긴 소그룹 "부서|팀" (비어 있을 때만 숨길 수 있다)
};
export const CS_DEPT = "CS팀";
export const DEFAULT_TEAM_GROUPS: TeamGroups = {
  depts: ["임원", CS_DEPT, "영업팀", "CSS·운영지원"],
  teams: {
    "임원": [""],
    [CS_DEPT]: ["팀장", "A", "B", "C", "D", "E", "A·B"],
    "영업팀": ["", "전략영업", "IT"],
    "CSS·운영지원": ["", "운영지원", "CSS", "경영지원", "지원(비정규)"],
  },
  labels: { E: "CSS팀" },
  hidden: [],
};
const GROUPS_KEY = "TEAM_GROUPS";
const GROUPS_MIRROR = "firstoa.teamGroups.v1";

function normalizeGroups(raw: Partial<TeamGroups> | null | undefined): TeamGroups {
  const base = DEFAULT_TEAM_GROUPS;
  const depts = Array.from(new Set([...(raw?.depts?.length ? raw.depts : base.depts)].filter(Boolean)));
  const teams: Record<string, string[]> = {};
  for (const dept of depts) {
    const list = raw?.teams?.[dept] ?? base.teams[dept] ?? [""];
    teams[dept] = Array.from(new Set(list));
  }
  return { depts, teams, labels: { ...base.labels, ...(raw?.labels || {}) }, hidden: Array.from(new Set(raw?.hidden || [])) };
}

function readGroupsMirror(): TeamGroups | null {
  if (typeof window === "undefined") return null;
  try { const raw = window.localStorage.getItem(GROUPS_MIRROR); return raw ? normalizeGroups(JSON.parse(raw)) : null; } catch { return null; }
}

let groupsCache: TeamGroups = readGroupsMirror() || normalizeGroups(null);
let groupsLoaded = false;

function commitGroups(next: TeamGroups) {
  groupsCache = next;
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(GROUPS_MIRROR, JSON.stringify(next)); } catch { /* 미러 실패는 무해 */ }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}

/** 현재 그룹 등록부(동기) — 화면 렌더에서 바로 쓴다. 아직 못 읽었으면 기본값/미러 */
export function teamGroups(): TeamGroups { return groupsCache; }

export async function fetchTeamGroups(): Promise<TeamGroups> {
  const rows = await selectRows<{ key: string; value: string }>("app_config", `select=key,value&key=eq.${GROUPS_KEY}`).catch(() => [] as Array<{ key: string; value: string }>);
  let parsed: Partial<TeamGroups> | null = null;
  try { parsed = rows[0]?.value ? JSON.parse(rows[0].value) as Partial<TeamGroups> : null; } catch { parsed = null; }
  groupsLoaded = true;
  commitGroups(normalizeGroups(parsed));
  return groupsCache;
}

export async function saveTeamGroups(patch: Partial<TeamGroups>): Promise<TeamGroups> {
  const next = normalizeGroups({ ...groupsCache, ...patch });
  const value = JSON.stringify(next);
  const rows = await selectRows<{ key: string }>("app_config", `select=key&key=eq.${GROUPS_KEY}`).catch(() => [] as Array<{ key: string }>);
  if (rows.length) await updateRows("app_config", `key=eq.${GROUPS_KEY}`, { value });
  else await insertRow("app_config", { key: GROUPS_KEY, value });
  commitGroups(next);
  return next;
}

/** 소그룹 이름 바꾸기 — 그 부서·팀의 인원 team 값을 함께 바꾼다(CS 글자는 코드 유지·표시명만) */
export async function renameTeamGroup(dept: string, team: string, next: string): Promise<void> {
  const clean = next.trim();
  if (!clean || clean === team) return;
  if (dept === CS_DEPT && AUTHOR_TEAMS.includes(team as AuthorTeam)) {
    await saveTeamGroups({ labels: { ...groupsCache.labels, [team]: clean } });
    return;
  }
  await updateRows("cs_members", `dept=eq.${encodeURIComponent(dept)}&team=eq.${encodeURIComponent(team)}`, { team: clean, updated_at: new Date().toISOString() });
  const teams = { ...groupsCache.teams, [dept]: (groupsCache.teams[dept] || []).map((t) => (t === team ? clean : t)) };
  await saveTeamGroups({ teams });
  await fetchMembers();
}

/** 상위 그룹(부서) 이름 바꾸기 — 인원의 dept 값과 등록부를 함께 바꾼다 */
export async function renameDeptGroup(dept: string, next: string): Promise<void> {
  const clean = next.trim();
  if (!clean || clean === dept) return;
  await updateRows("cs_members", `dept=eq.${encodeURIComponent(dept)}`, { dept: clean, updated_at: new Date().toISOString() });
  const depts = groupsCache.depts.map((d) => (d === dept ? clean : d));
  const teams: Record<string, string[]> = {};
  for (const d of groupsCache.depts) teams[d === dept ? clean : d] = groupsCache.teams[d] || [""];
  await saveTeamGroups({ depts, teams });
  await fetchMembers();
}

/** 그룹 등록부를 구독하는 훅 — 처음 한 번 서버에서 읽고, 바뀌면 다시 그린다 */
export function useTeamGroups(): TeamGroups {
  const [groups, setGroups] = useState<TeamGroups>(groupsCache);
  useEffect(() => {
    let alive = true;
    const sync = () => { if (alive) setGroups(groupsCache); };
    window.addEventListener(CHANGE_EVENT, sync);
    if (!groupsLoaded) void fetchTeamGroups().then(sync).catch(() => {});
    return () => { alive = false; window.removeEventListener(CHANGE_EVENT, sync); };
  }, []);
  return groups;
}
