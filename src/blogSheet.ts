import { parseCsv } from "./itSheet";

/** 블로그 댓글 기록 시트(공개 구글 시트, 읽기 전용) — 한 행 = 댓글 1개. IT 시트와 같은 CSV 직접 읽기 방식 */
export const BLOG_SHEET_ID = "1H15RFS7h-euPJM1pfPIQl_FQNzxk6OrjkSmZZGsqWKQ";
export const BLOG_SHEET_GID = "1665859459";
export const BLOG_SHEET_URL = `https://docs.google.com/spreadsheets/d/${BLOG_SHEET_ID}/edit#gid=${BLOG_SHEET_GID}`;
export const BLOG_BASIS_TEXT = "블로그 기록 시트 기준, 한 행 = 1건";

export type BlogRow = {
  seq: string;
  date: string;   // YYYY-MM-DD (등록일)
  name: string;
  dept: string;
  points: number;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** CSV → 댓글 행. 순번이 숫자인 행만(맨 위 "예시" 행 제외), 등록일이 날짜 모양이 아닌 줄은 버린다. 주차(#REF!)는 쓰지 않는다 */
export function parseBlogCsv(text: string): BlogRow[] {
  const grid = parseCsv(text);
  if (!grid.length) return [];
  const head = grid[0].map((h) => h.trim());
  const col = (prefix: string) => head.findIndex((h) => h.startsWith(prefix));
  const iSeq = col("순번"), iDate = col("등록일"), iName = col("참여자성함"), iDept = col("부서명"), iPoint = col("포인트");
  if (iSeq < 0 || iDate < 0 || iName < 0) throw new Error("블로그 시트 머리글(순번·등록일·참여자성함)을 찾지 못했습니다");
  const out: BlogRow[] = [];
  for (const cells of grid.slice(1)) {
    const seq = (cells[iSeq] ?? "").trim();
    if (!/^\d+$/.test(seq)) continue;
    const date = (cells[iDate] ?? "").trim();
    const name = (cells[iName] ?? "").trim();
    if (!DATE_RE.test(date) || !name) continue;
    const points = Number((cells[iPoint] ?? "").trim());
    out.push({ seq, date, name, dept: iDept >= 0 ? (cells[iDept] ?? "").trim() : "", points: Number.isFinite(points) ? points : 0 });
  }
  return out;
}

export async function fetchBlogRows(): Promise<BlogRow[]> {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${BLOG_SHEET_ID}/export?format=csv&gid=${BLOG_SHEET_GID}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`블로그 시트를 읽지 못했습니다(${res.status})`);
  const text = await res.text();
  if (/^\s*</.test(text)) throw new Error("블로그 시트가 비공개로 바뀐 것 같습니다");
  return parseBlogCsv(text);
}

export type BlogFilter = { from: string; to: string; person?: string; dept?: string };
export type BlogPerson = { name: string; dept: string; count: number; points: number };
export type BlogCount = { count: number; points: number; people: number; byPerson: BlogPerson[] };

/** 기간(from~to, 양 끝 포함)·사람·부서로 거른 댓글 수·포인트 합·참여 인원, 사람별 목록(많은 순) */
export function countBlog(rows: BlogRow[], f: BlogFilter): BlogCount {
  const map = new Map<string, BlogPerson>();
  let count = 0;
  let points = 0;
  for (const r of rows) {
    if (r.date < f.from || r.date > f.to) continue;
    if (f.person && r.name !== f.person) continue;
    if (f.dept && r.dept !== f.dept) continue;
    count++;
    points += r.points;
    const p = map.get(r.name) ?? { name: r.name, dept: r.dept, count: 0, points: 0 };
    p.count++;
    p.points += r.points;
    map.set(r.name, p);
  }
  const byPerson = [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"));
  return { count, points: Math.round(points * 10) / 10, people: map.size, byPerson };
}

/** 오늘(KST 날짜 문자열) 기준 이번 주(월~일)·이번 달 범위 */
export function blogPeriods(today: string): { week: { from: string; to: string }; month: { from: string; to: string } } {
  const [y, m, d] = today.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  const day = base.getUTCDay() || 7;
  const iso = (t: Date) => t.toISOString().slice(0, 10);
  const mon = new Date(base.getTime() - (day - 1) * 86400000);
  const sun = new Date(mon.getTime() + 6 * 86400000);
  const mm = String(m).padStart(2, "0");
  return {
    week: { from: iso(mon), to: iso(sun) },
    month: { from: `${y}-${mm}-01`, to: iso(new Date(Date.UTC(y, m, 0))) },
  };
}

/** 팀 표기 — 부서명이 CS·CS_S 계열이면 인원 명단(cs_members) 팀으로, 명단에 없으면 부서명 그대로 */
export function blogTeamOf(person: BlogPerson, memberTeam: Map<string, string>): string {
  const team = memberTeam.get(person.name);
  if (/^CS/i.test(person.dept) && team) return team;
  return person.dept || team || "미지정";
}
