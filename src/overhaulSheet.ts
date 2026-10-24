import { parseCsv } from "./itSheet";
import { isYmd } from "./recontractSchedule";

/**
 * 오버홀 기록 시트(공개 구글 시트, 읽기 전용) — 한 행 = 오버홀·수리 1건. 블로그 시트(blogSheet.ts)와 같은 CSV 직접 읽기.
 * 열: 번호,날짜("23/10/27(금)" = yy/mm/dd(요일)),년,월,담당자,부서명(강북A/경기D/외부인력/퇴사자…),모델명,부품명,오버홀품목,수리품목,
 *     소요시간,오버홀포인트,수리포인트,주차별,수리가공,오버홀가공.
 * 탭 = app_config OVERHAUL_SHEET_TAB(없으면 "리스트(26년)") — 탭 이름으로 gviz CSV 를 읽는다(gid 0 은 25/08 까지 옛 데이터).
 * 실측(2026-10-24): 첫 줄이 머리글이 아닐 수 있고, 날짜는 "2026/1/2"·"26/10/01"·"23/10/27(금)" 섞임, 번호는 "2,308", 빈 줄은 "" 또는 0,0 만.
 * KPI K33 "오버홀 점" = 오버홀포인트 합. 수리포인트는 따로(보조 글자).
 */
export const OVERHAUL_SHEET_ID = "1lFZdrSZiKoPaRUar2txEtzRdPCoJ6oRd6Ox5kKUqNEg";
export const OVERHAUL_SHEET_TAB_KEY = "OVERHAUL_SHEET_TAB";
export const OVERHAUL_SHEET_DEFAULT_TAB = "리스트(26년)";
export const OVERHAUL_SHEET_URL = `https://docs.google.com/spreadsheets/d/${OVERHAUL_SHEET_ID}/edit`;
/** 탭 이름 → 공개 CSV 주소(gviz) */
export const overhaulCsvUrl = (tab: string = OVERHAUL_SHEET_DEFAULT_TAB) =>
  `https://docs.google.com/spreadsheets/d/${OVERHAUL_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;

export type OverhaulRow = {
  author: string;
  /** YYYY-MM-DD */
  date: string;
  /** 오버홀포인트 */
  points: number;
  /** 수리포인트 */
  repairPoints: number;
  /** 부서명 그대로(강북A·경기D·외부인력·퇴사자 …) */
  dept: string;
};

/** app_config 값 → 탭 이름(비었으면 기본 "리스트(26년)") */
export function overhaulTabFrom(config: Record<string, string | undefined> | null | undefined): string {
  return String(config?.[OVERHAUL_SHEET_TAB_KEY] ?? "").trim() || OVERHAUL_SHEET_DEFAULT_TAB;
}

/** "23/10/27(금)" · "26/10/01" · "2026/1/2" · "2023-10-27" · "2023. 10. 27" → YYYY-MM-DD(2자리 연도 = 20xx), 못 읽으면 "" */
export function parseOverhaulDate(value: unknown): string {
  const s = String(value ?? "").replace(/\([^)]*\)/g, "").trim();
  if (!s) return "";
  const m = s.match(/^(\d{2}|\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\.?$/);
  if (!m) return "";
  const y = m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
  const ymd = `${y}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[3])).padStart(2, "0")}`;
  return isYmd(ymd) ? ymd : "";
}

const num = (value: unknown): number => {
  const s = String(value ?? "").replace(/,/g, "").trim();
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

/**
 * CSV → 오버홀 행. 머리글 줄은 '담당자'·'오버홀포인트'가 있는 첫 줄(위에 빈 칸 섞인 줄이 있어도 찾는다).
 * 날짜를 못 읽거나 담당자가 빈 줄(합계·빈 줄·깨진 줄)은 건너뛴다. 포인트 칸이 숫자가 아니면 0.
 */
export function parseOverhaulCsv(text: string): OverhaulRow[] {
  const grid = parseCsv(text);
  const headAt = grid.findIndex((row) => {
    const h = row.map((c) => c.trim());
    return h.includes("담당자") && h.some((c) => c.startsWith("오버홀포인트"));
  });
  if (headAt < 0) throw new Error("오버홀 시트 머리글(담당자·오버홀포인트)을 찾지 못했습니다");
  const head = grid[headAt].map((c) => c.trim());
  const col = (name: string) => head.findIndex((h) => h === name || h.startsWith(name));
  const iDate = col("날짜");
  if (iDate < 0) throw new Error("오버홀 시트 머리글에 '날짜' 열이 없습니다");
  const iAuthor = col("담당자"), iDept = col("부서명"), iPoint = col("오버홀포인트"), iRepair = col("수리포인트");
  const out: OverhaulRow[] = [];
  for (const cells of grid.slice(headAt + 1)) {
    const date = parseOverhaulDate(cells[iDate]);
    const author = String(cells[iAuthor] ?? "").trim();
    if (!date || !author) continue;
    out.push({
      author, date,
      points: num(cells[iPoint]),
      repairPoints: iRepair >= 0 ? num(cells[iRepair]) : 0,
      dept: iDept >= 0 ? String(cells[iDept] ?? "").trim() : "",
    });
  }
  return out;
}

const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; rows: OverhaulRow[] }>();
const inflight = new Map<string, Promise<OverhaulRow[]>>();

/** 캐시 비우기(테스트·[다시] 단추용) */
export function clearOverhaulCache(): void { cache.clear(); inflight.clear(); }

/** 공개 CSV(gviz, 탭 이름) 읽기 — 같은 탭은 5분 동안 다시 받지 않는다(이 탭 세션 메모리). 실패는 던진다(삼키지 않음) */
export async function loadOverhaulRows(tab: string = OVERHAUL_SHEET_DEFAULT_TAB, opts: { force?: boolean } = {}): Promise<OverhaulRow[]> {
  const key = String(tab || "").trim() || OVERHAUL_SHEET_DEFAULT_TAB;
  const hit = cache.get(key);
  if (!opts.force && hit && Date.now() - hit.at < CACHE_MS) return hit.rows;
  const running = inflight.get(key);
  if (running) return running;
  const p = (async () => {
    const res = await fetch(overhaulCsvUrl(key), { cache: "no-store" });
    if (!res.ok) throw new Error(`오버홀 시트를 읽지 못했습니다(${res.status})`);
    const text = await res.text();
    if (/^\s*</.test(text)) throw new Error("오버홀 시트가 비공개로 바뀐 것 같습니다");
    const rows = parseOverhaulCsv(text);
    cache.set(key, { at: Date.now(), rows });
    return rows;
  })();
  inflight.set(key, p);
  try { return await p; } finally { inflight.delete(key); }
}

export type OverhaulPerson = { name: string; dept: string; count: number; points: number; repairPoints: number };
export type OverhaulCount = { count: number; points: number; repairPoints: number; byPerson: OverhaulPerson[] };

const round1 = (n: number) => Math.round(n * 10) / 10;

/** 기간(from~to, 양 끝 포함) 사람별 오버홀포인트·수리포인트 합(점수 많은 순) */
export function countOverhaul(rows: OverhaulRow[], from: string, to: string): OverhaulCount {
  const map = new Map<string, OverhaulPerson>();
  let count = 0, points = 0, repairPoints = 0;
  for (const r of rows) {
    if (r.date < from || r.date > to) continue;
    count++;
    points += r.points;
    repairPoints += r.repairPoints;
    const p = map.get(r.author) ?? { name: r.author, dept: r.dept, count: 0, points: 0, repairPoints: 0 };
    p.count++;
    p.points = round1(p.points + r.points);
    p.repairPoints = round1(p.repairPoints + r.repairPoints);
    map.set(r.author, p);
  }
  const byPerson = [...map.values()].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, "ko"));
  return { count, points: round1(points), repairPoints: round1(repairPoints), byPerson };
}

/** 부서명 → 팀(강북A → A, CSS → E). 외부인력·퇴사자·모르는 이름은 "" */
export function overhaulDeptTeam(dept: string): string {
  const d = String(dept || "").trim();
  if (!d || /외부|퇴사/.test(d)) return "";
  if (/CSS/i.test(d)) return "E";
  const m = d.match(/([A-E])$/i);
  return m ? m[1].toUpperCase() : "";
}
