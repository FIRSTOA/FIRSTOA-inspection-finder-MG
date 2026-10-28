/**
 * 통합검색 분석 도구(구현 B) 공용 — 도구 문맥 타입·기간 풀이·명단·이름 비교 (2026-10-29, 설계 docs/tasks/search-ask-everything-2026-10-29.md 5-3)
 * 도구 시그니처 = (args, ctx) => Promise<object>. ctx.rest(rest.ts AskRest)로만 Supabase 를 읽는다(읽기 전용).
 * 브라우저·Deno·Node 공용 — 순수 함수는 tests/askTools*.test.ts.
 */
import type { AskRest } from "./rest.ts";
import { vendorMatchKey } from "../counter-sms/vendorKey.ts";
import { isLeadAsker, sameDept, type Asker } from "./catalog.ts";
import { monthCycleId, monthsOfQuarter, okrWorkWeek, parseQuarterId, quarterCycleId, quarterOf, weeksOfMonth } from "./okr-rules.ts";

export type AskMode = "data" | "analysis";
/** 도구 문맥 — data-ask/index.ts(구현 A)가 만든다 */
export type AskToolCtx = {
  rest: AskRest;
  /** askMask(값, 칸 이름) — 모델에게 가는 결과 전부에 */
  mask: <T>(value: T, key?: string) => T;
  /** KST 'YYYY-MM-DD' */
  today: string;
  asker: Asker;
  mode: AskMode;
};
export type AskToolArgs = Record<string, unknown>;
export type AskTool = (args: AskToolArgs, ctx: AskToolCtx) => Promise<Record<string, unknown>>;
/** 모델에게 주는 도구 정의(OpenAI Responses function 꼴) */
export type AskToolDef = { name: string; description: string; parameters: Record<string, unknown>; run: AskTool; label: string };

export const str = (v: unknown) => (v == null ? "" : String(v)).trim();
export const num = (v: unknown, d: number) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
export const clip = (v: unknown, n = 300) => { const s = typeof v === "string" ? v : v == null ? "" : JSON.stringify(v); const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
/** PostgREST 값 하나 */
export const enc = (v: string) => encodeURIComponent(v);
/** 칸 이름(한글·괄호는 큰따옴표) + 인코딩 */
export const qc = (c: string) => encodeURIComponent(/[^A-Za-z0-9_]/.test(c) ? `"${c}"` : c);
/** in.("a","b") — 값마다 인코딩 */
export const inList = (vals: string[]) => `in.(${vals.map((v) => `"${encodeURIComponent(String(v).replace(/"/g, ""))}"`).join(",")})`;

const DAY = 86_400_000;
const utc = (ymd: string) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
export const addDays = (ymd: string, days: number) => new Date(utc(ymd) + days * DAY).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / DAY);
export const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

const MONTHS: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const ymdParts = (y: number, mo: number, d: number) => (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(mo)}-${pad(d)}` : "");

/**
 * 날짜 글 → KST 'YYYY-MM-DD'. 시트에서 온 글자 날짜 칸(misu.입력일·bulman.날짜 등)은 형식이 섞여 있다(2026-10-29 실측):
 * '2026-06-22 00:00:00'·'2026.9.8'·'2026. 3. 10.'·'2025. 12 .11'·'2026년 6월 10일'·'Fri Mar 20 2026 00:00:00 GMT+0900'·ISO 시각. 못 읽으면 "".
 */
export function ymdOf(value: unknown): string {
  const s = str(value);
  if (!s) return "";
  if (/T\d{2}:\d{2}/.test(s) && /(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const t = Date.parse(s);
    if (Number.isFinite(t)) return new Date(t + 9 * 3600_000).toISOString().slice(0, 10);
  }
  const m = s.match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})(?!\d)/);
  if (m) return ymdParts(Number(m[1]), Number(m[2]), Number(m[3]));
  // JS Date.toString() 꼴(GAS 가 그대로 적은 값) — 날짜 부분은 적은 쪽 현지(KST) 날짜
  const js = s.match(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}) (\d{4})(?!\d)/);
  return js ? ymdParts(Number(js[3]), MONTHS[js[1]], Number(js[2])) : "";
}

/** ymdOf 가 읽혀야 하고 from~to(포함) 안 */
export const inYmd = (value: unknown, from: string, to: string) => { const d = ymdOf(value); return !!d && d >= from && d <= to; };

/**
 * 글자 날짜 칸의 서버 쪽 넉넉한 거름. 형식이 섞인 칸에 `칸=gte.YYYY-MM-DD` 를 걸면 글자 비교라
 * '2026.1.7'('.' > '-')이 창에 새어 들고 'Fri Mar 20 2026…'은 늘 들어오거나 늘 빠진다.
 * → 연도 접두(from 의 해 ≤ 값 < to 의 해+1) + 숫자로 시작하지 않는 줄(≥ 'A')을 가져오고, 정확한 자르기는 inYmd 로 한다.
 */
export const textDateLoose = (col: string, from: string, to: string) => {
  const c = qc(col);
  // 위 끝이 없으면(9999) 아래만 — '10000' 은 글자로 '2026' 보다 작아 다 빠진다. 'YYYY' 이상이면 영문·한글 시작 줄도 들어온다
  if (Number(to.slice(0, 4)) >= 9999) return `${c}=gte.${from.slice(0, 4)}`;
  return `or=(and(${c}.gte.${from.slice(0, 4)},${c}.lt.${Number(to.slice(0, 4)) + 1}),${c}.gte.A)`;
};

/** from~to(포함). 비면 이번 달 1일~오늘. 'YYYY-MM' 한 달도 받는다 */
export function dateRange(fromArg: unknown, toArg: unknown, today: string): { from: string; to: string } {
  const f = str(fromArg); const t = str(toArg);
  const month = (s: string) => /^\d{4}-\d{2}$/.test(s);
  let from = isYmd(f) ? f : month(f) ? `${f}-01` : `${today.slice(0, 7)}-01`;
  let to = isYmd(t) ? t : month(t) ? `${t}-${pad(lastDay(Number(t.slice(0, 4)), Number(t.slice(5, 7))))}` : month(f) && !t ? `${f}-${pad(lastDay(Number(f.slice(0, 4)), Number(f.slice(5, 7))))}` : today;
  if (to < from) [from, to] = [to, from];
  return { from, to };
}

/**
 * OKR 기간 풀이 — '2026-10'(달) · '2026-10-W3'(주차) · '2026-Q4'(분기) · '이번 주'·'지난주'·'이번 달'·'지난달'·'이번 분기'. 비면 이번 달.
 * weeks = 그 기간 주차(월요일이 든 달 기준, okr-rules.weeksOfMonth), future = 오늘보다 늦게 시작하는 주(미작성으로 세지 않음)
 */
export type OkrPeriod = {
  kind: "week" | "month" | "quarter";
  id: string;
  label: string;
  quarterId: string;
  months: string[];
  weeks: Array<{ id: string; monthId: string; weekNo: number; start: string; end: string; label: string; future: boolean }>;
};
export function parseOkrPeriod(raw: unknown, today: string): OkrPeriod {
  const p = str(raw).replace(/\s+/g, "");
  const now = okrWorkWeek(today).start;
  const ty = Number(now.slice(0, 4)); const tm = Number(now.slice(5, 7));
  const weeksOf = (y: number, m: number) => weeksOfMonth(y, m).map((w) => ({ id: w.id, monthId: monthCycleId(y, m), weekNo: w.weekNo, start: w.start, end: w.end, label: w.label, future: w.start > today }));
  const monthP = (y: number, m: number): OkrPeriod => ({ kind: "month", id: monthCycleId(y, m), label: `${y}년 ${m}월`, quarterId: quarterCycleId(y, quarterOf(m)), months: [monthCycleId(y, m)], weeks: weeksOf(y, m) });
  const weekAt = (date: string): OkrPeriod | null => {
    const start = okrWorkWeek(date).start; const y = Number(start.slice(0, 4)); const m = Number(start.slice(5, 7));
    const w = weeksOf(y, m).find((x) => x.start === start);
    return w ? { kind: "week", id: w.id, label: `${y}년 ${m}월 ${w.weekNo}주차`, quarterId: quarterCycleId(y, quarterOf(m)), months: [w.monthId], weeks: [w] } : null;
  };
  let m = p.match(/^(\d{4})-(\d{1,2})-W(\d)$/i);
  if (m) {
    const y = Number(m[1]); const mo = Number(m[2]);
    const w = weeksOf(y, mo).find((x) => x.weekNo === Number(m![3]));
    if (w) return { kind: "week", id: w.id, label: `${y}년 ${mo}월 ${w.weekNo}주차`, quarterId: quarterCycleId(y, quarterOf(mo)), months: [w.monthId], weeks: [w] };
  }
  const q = parseQuarterId(p.toUpperCase());
  if (q || /이번분기/.test(p)) {
    const y = q?.year ?? ty; const qq = q?.quarter ?? quarterOf(tm);
    const ms = monthsOfQuarter(y, qq);
    return { kind: "quarter", id: quarterCycleId(y, qq), label: `${y}년 ${qq}분기`, quarterId: quarterCycleId(y, qq), months: ms.map((x) => x.id), weeks: ms.flatMap((x) => weeksOf(x.year, x.month)) };
  }
  m = p.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return monthP(Number(m[1]), Number(m[2]));
  if (/이번주|금주/.test(p)) return weekAt(today) || monthP(ty, tm);
  if (/지난주|저번주/.test(p)) return weekAt(addDays(today, -7)) || monthP(ty, tm);
  if (/지난달|저번달/.test(p)) { const y = tm === 1 ? ty - 1 : ty; return monthP(y, tm === 1 ? 12 : tm - 1); }
  const onlyMonth = p.match(/^(\d{1,2})월$/);
  if (onlyMonth) return monthP(ty, Number(onlyMonth[1]));
  return monthP(ty, tm);
}

/** cs_members 한 사람 — team 은 A~E(CSS = E) 또는 부서 글 그대로 */
export type RosterRow = { name: string; team: string; title: string; dept: string };
export const teamLetter = (v: unknown): string => { const s = str(v); if (/^CSS$|지방/i.test(s)) return "E"; const m = s.match(/^(?:수도권)?\s*([A-E])(?:팀|파트)?$/i); return m ? m[1].toUpperCase() : s; };

/** 활성 명단(이름·팀·직함·부서). 실패하면 throw — 도구가 error 로 돌려준다 */
export async function loadRoster(ctx: AskToolCtx): Promise<RosterRow[]> {
  const rows = await ctx.rest.get<{ name?: string; team?: string; title?: string; dept?: string }>("cs_members?select=name,team,title,dept&active=is.true&order=team.asc,sort.asc&limit=300");
  return rows.filter((r) => str(r.name)).map((r) => ({ name: str(r.name), team: rosterTeam(r.team), title: str(r.title), dept: str(r.dept) }));
}

/** 명단 팀 칸 → 팀 하나. 겸직 'A·B'·'B/C'·'A,B' 는 앱 rosterFromMembers(src/kpi/kpiCompute.ts)와 같이 나눠 첫 A~E(CSS = E). 팀 글자가 없으면 teamLetter 그대로(부서 글) */
export function rosterTeam(v: unknown): string {
  const hit = str(v).split(/[·/,]/).map((t) => teamLetter(t)).find((t) => /^[A-E]$/.test(t));
  return hit || teamLetter(v);
}

/** 이름 비교 — 공백 무시. 명단에서 정확히 → 앞부분 일치 순 */
export const nameKey = (s: string) => str(s).replace(/\s+/g, "");
export function findPerson(roster: RosterRow[], name: string): RosterRow | null {
  const k = nameKey(name);
  if (!k) return null;
  return roster.find((r) => nameKey(r.name) === k) || roster.find((r) => nameKey(r.name).startsWith(k) || k.startsWith(nameKey(r.name))) || null;
}

/**
 * 설계 Q1(2026-10-29 결정): 주간 회고·골든카드·분기 계획·팀 캘린더는 묻는 사람 본인 또는 같은 팀만.
 * 팀장·임원(catalog.isLeadAsker)은 전부. 묻는 사람이 명단에 없으면 본인 것만. OKR·업무 기록은 누구나(이 함수를 쓰지 않는다).
 */
export function askerMaySee(asker: Asker, owner: { name?: string; team?: string }): boolean {
  if (isLeadAsker(asker)) return true;
  if (owner.name && asker.name && nameKey(owner.name) === nameKey(asker.name)) return true;
  const mine = [teamLetter(asker.team), asker.dept].filter(Boolean);
  const theirs = str(owner.team);
  if (!theirs || !mine.length) return false;
  return mine.some((m) => m === teamLetter(theirs) || sameDept(m, theirs));
}

/** 업체 이름 비교 키 — 앱·엣지 공용 vendorMatchKey(워킨맵 지명 접두 번호·등급·꼬리말·법인표기 제거, SQL vendor_key_ 와 거울) */
export const vendorKey = (v: unknown) => vendorMatchKey(str(v));

/** 개수 세기 → 많은 순 상위 n */
export function topCounts(values: string[], n = 10): Array<{ key: string; count: number }> {
  const m = new Map<string, number>();
  for (const v of values) { const k = str(v); if (k) m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko")).slice(0, n).map(([key, count]) => ({ key, count }));
}

/** 도구 실패를 모델에게 — 성공처럼 넘기지 않는다 */
export const toolError = (e: unknown, hint = "") => ({ error: `${e instanceof Error ? e.message : String(e)}${hint ? ` — ${hint}` : ""}` });
