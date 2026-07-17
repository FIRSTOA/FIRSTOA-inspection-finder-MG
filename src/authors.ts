import { useEffect, useMemo, useState } from "react";

// 작성자 명단 — 기본 명단은 코드에 두고, 현장 추가/삭제는 브라우저에 저장합니다.

export type AuthorTeam = "팀장" | "A" | "B" | "C" | "D";

export const AUTHOR_TEAMS: AuthorTeam[] = ["팀장", "A", "B", "C", "D"];

export const AUTHOR_BOOK: Record<AuthorTeam, string[]> = {
  "팀장": ["신정훈"],
  A: ["김정민", "심태현", "정웅"],
  B: ["권태혁", "조윤", "윤기준"],
  C: ["이홍진", "박영현", "이민구", "한왕주"],
  D: ["양승원", "김종희", "이호준"],
};

const CUSTOM_KEY = "firstoa.customAuthors.v1";
const HIDDEN_KEY = "firstoa.hiddenAuthors.v1";

type CustomAuthors = Partial<Record<AuthorTeam, string[]>>;

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try { return JSON.parse(window.localStorage.getItem(key) || "") as T; } catch { return fallback; }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new Event("firstoa-authors-change"));
}

function uniqueNames(names: string[]) {
  return Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
}

export function useAuthorBook() {
  const [custom, setCustom] = useState<CustomAuthors>(() => readJson<CustomAuthors>(CUSTOM_KEY, {}));
  const [hidden, setHidden] = useState<string[]>(() => readJson<string[]>(HIDDEN_KEY, []));

  useEffect(() => {
    const reload = () => {
      setCustom(readJson<CustomAuthors>(CUSTOM_KEY, {}));
      setHidden(readJson<string[]>(HIDDEN_KEY, []));
    };
    window.addEventListener("firstoa-authors-change", reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener("firstoa-authors-change", reload);
      window.removeEventListener("storage", reload);
    };
  }, []);

  const book = useMemo(() => {
    const hiddenSet = new Set(hidden);
    const next = {} as Record<AuthorTeam, string[]>;
    for (const team of AUTHOR_TEAMS) next[team] = uniqueNames([...(AUTHOR_BOOK[team] || []), ...(custom[team] || [])]).filter((name) => !hiddenSet.has(`${team}|${name}`));
    return next;
  }, [custom, hidden]);

  const authors = useMemo(() => AUTHOR_TEAMS.flatMap((team) => book[team]), [book]);

  const addAuthor = (team: AuthorTeam, name: string) => {
    const clean = name.trim();
    if (!clean) return;
    const next = { ...custom, [team]: uniqueNames([...(custom[team] || []), clean]) };
    const nextHidden = hidden.filter((key) => key !== `${team}|${clean}`);
    setCustom(next);
    setHidden(nextHidden);
    writeJson(CUSTOM_KEY, next);
    writeJson(HIDDEN_KEY, nextHidden);
  };

  const removeAuthor = (team: AuthorTeam, name: string) => {
    const next = { ...custom, [team]: (custom[team] || []).filter((n) => n !== name) };
    const nextHidden = uniqueNames([...hidden, `${team}|${name}`]);
    setCustom(next);
    setHidden(nextHidden);
    writeJson(CUSTOM_KEY, next);
    writeJson(HIDDEN_KEY, nextHidden);
  };

  return { book, authors, addAuthor, removeAuthor };
}
