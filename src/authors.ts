import { useEffect, useMemo, useState } from "react";
import { insertRow, selectRows, updateRows } from "./supabase";

// 작성자 명단 — 원본은 Supabase cs_members 테이블이다.
// 예전에는 브라우저 localStorage에 두어 신입·퇴사 반영이 그 PC에서만 보였다.
// 지금은 DB가 원본이고, localStorage는 첫 화면이 비어 보이지 않게 하는 거울(캐시)로만 쓴다.

export type AuthorTeam = "팀장" | "A" | "B" | "C" | "D";

export const AUTHOR_TEAMS: AuthorTeam[] = ["팀장", "A", "B", "C", "D"];

/** DB를 못 읽을 때 쓰는 최소 명단 (초기 시드와 동일) */
export const AUTHOR_BOOK: Record<AuthorTeam, string[]> = {
  "팀장": ["신정훈"],
  A: ["김정민", "심태현", "정웅"],
  B: ["권태혁", "조윤", "윤기준"],
  C: ["이홍진", "박영현", "이민구", "한왕주"],
  D: ["양승원", "김종희", "이호준"],
};

export type MemberRow = {
  id: string;
  name: string;
  team: AuthorTeam;
  active: boolean;
  joined_on: string | null;
  left_on: string | null;
  note: string;
  sort: number;
};

const MIRROR_KEY = "firstoa.memberBook.v2";
const CHANGE_EVENT = "firstoa-authors-change";

type Book = Record<AuthorTeam, string[]>;

function emptyBook(): Book {
  return { "팀장": [], A: [], B: [], C: [], D: [] };
}

function bookOf(rows: MemberRow[]): Book {
  const next = emptyBook();
  for (const row of rows.filter((item) => item.active)) {
    if (!AUTHOR_TEAMS.includes(row.team)) continue;
    if (!next[row.team].includes(row.name)) next[row.team].push(row.name);
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
let inflight: Promise<MemberRow[]> | null = null;

export async function fetchMembers(): Promise<MemberRow[]> {
  const rows = await selectRows<MemberRow>("cs_members", "select=*&order=team.asc,sort.asc,name.asc");
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

async function findMember(team: AuthorTeam, name: string) {
  const rows = await selectRows<MemberRow>("cs_members", `select=id,active&name=eq.${encodeURIComponent(name)}&team=eq.${encodeURIComponent(team)}`);
  return rows[0];
}

export async function addMember(team: AuthorTeam, name: string, joinedOn?: string) {
  const clean = name.trim();
  if (!clean) return;
  const found = await findMember(team, clean);
  if (found) await updateRows("cs_members", `id=eq.${found.id}`, { active: true, left_on: null, updated_at: new Date().toISOString() });
  else await insertRow("cs_members", { name: clean, team, active: true, joined_on: joinedOn || new Date().toISOString().slice(0, 10), sort: 99 });
  await fetchMembers();
}

/** 퇴사 처리 — 행을 지우지 않는다 (과거 기록에 남은 작성자명이 살아 있어야 한다) */
export async function retireMember(id: string, leftOn?: string) {
  await updateRows("cs_members", `id=eq.${id}`, { active: false, left_on: leftOn || new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() });
  await fetchMembers();
}

export async function restoreMember(id: string) {
  await updateRows("cs_members", `id=eq.${id}`, { active: true, left_on: null, updated_at: new Date().toISOString() });
  await fetchMembers();
}

export async function moveMemberTeam(id: string, team: AuthorTeam) {
  await updateRows("cs_members", `id=eq.${id}`, { team, updated_at: new Date().toISOString() });
  await fetchMembers();
}

export function useAuthorBook() {
  const [book, setBook] = useState<Book>(() => cache || AUTHOR_BOOK);

  useEffect(() => {
    let alive = true;
    const sync = () => { if (alive && cache) setBook(cache); };
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    void refresh().then(sync).catch(() => {});
    return () => {
      alive = false;
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
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
