/**
 * IT파트 PC DB 구글 시트 — 순수 부분(탭 gid·CSV 파서·검색·퀴즈 만들기). 앱(src/itSheet.ts 가 다시 내보냄)과
 * 엣지 함수(data-ask 의 it_sheet 도구)가 같은 코드로 읽는다(2026-10-29). 브라우저·Deno 공용 — import 없음.
 * 시트와 Apps Script 는 IT 담당자 소유 — FIELD 는 '보는 창'이라 공개 CSV 를 읽기만 하고 복사·저장하지 않는다.
 */
export type ItRow = Record<string, unknown>;

export type QuizQuestion = {
  id?: string | number;
  카테고리: string;
  부품명: string;
  문제: string;
  정답: string;
  multiAnswer?: string[];
  isMulti?: boolean;
  보기: string[];
  난이도?: string | number;
  설명?: string;
  조치방법?: string;
  AI해설?: string;
  소요시간?: string;
  주의사항?: string;
};

/** 앞글자가 맞는 첫 칸의 값("부품명/항목"처럼 머리글이 긴 칸을 짧은 이름으로 찾는다) */
export function valueByPrefix(row: ItRow, ...prefixes: string[]) {
  const key = Object.keys(row).find((candidate) => prefixes.some((prefix) => candidate.startsWith(prefix)));
  return key ? String(row[key] ?? "").trim() : "";
}

export const IT_SHEET_ID = "17ADPVDbfrfXQhUTAM4OPLnkaCqJ-gWnq3UcgRscfxT4";
export const IT_SHEET_URL = `https://docs.google.com/spreadsheets/d/${IT_SHEET_ID}/edit`;

export type ItTabKey = "knowledge" | "history" | "sales" | "links";
export const IT_TAB_KEYS: ItTabKey[] = ["knowledge", "history", "sales", "links"];
export const IT_TABS: Record<ItTabKey, { gid: string; name: string; headers?: string[] }> = {
  knowledge: { gid: "911433900", name: "IT기술력DB" },
  history: { gid: "1901723905", name: "PC DB" },
  sales: { gid: "1803405393", name: "영업상담DB" },
  links: { gid: "532178897", name: "교육자료링크", headers: ["분류", "링크", "제목", "갱신", "문항수"] }, // 머리글 줄이 없는 탭
};
export const sheetTabUrl = (key: ItTabKey) => `${IT_SHEET_URL}#gid=${IT_TABS[key].gid}`;

export type SheetRow = Record<string, string>;

/** RFC4180 CSV — 따옴표 안의 쉼표·줄바꿈·겹따옴표("")를 처리한다 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** CSV → 머리글 기준 객체 배열. 머리글이 빈 열은 버리고, 전부 빈 줄은 건너뛴다 */
export function rowsFromCsv(text: string, headers?: string[]): SheetRow[] {
  const grid = parseCsv(text);
  if (!grid.length) return [];
  const head = (headers || grid[0]).map((h) => h.trim());
  const body = headers ? grid : grid.slice(1);
  const keep = head.map((h, i) => [h, i] as const).filter(([h]) => h);
  const out: SheetRow[] = [];
  for (const cells of body) {
    if (!cells.some((c) => c.trim())) continue;
    const row: SheetRow = {};
    keep.forEach(([h, i]) => { row[h] = (cells[i] ?? "").trim(); });
    out.push(row);
  }
  return out;
}

/** 교육자료링크 — 같은 분류가 여러 줄이면 가장 최근 갱신 줄만(옛 줄은 권한이 걸린 드라이브 파일이라 열리지 않았다, 2026-10-03) */
export function dedupeLinks(rows: SheetRow[]): SheetRow[] {
  const best = new Map<string, SheetRow>();
  for (const r of rows) {
    const key = (r.분류 || r.제목 || r.링크 || "").trim();
    const prev = best.get(key);
    if (!prev || (r.갱신 || "") >= (prev.갱신 || "")) best.set(key, r);
  }
  return [...best.values()];
}

/** 띄어쓰기로 나눈 낱말이 모두 들어 있는 줄만(대소문자 무시) */
export function searchRows<T extends Record<string, unknown>>(rows: T[], query: string): T[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return rows;
  return rows.filter((row) => {
    const hay = Object.values(row).map((v) => String(v ?? "")).join("\n").toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}

function shuffle<T>(list: T[], rand: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const partOf = (r: SheetRow) => r["부품명/항목"] || r.부품명 || "";

/** 겹치는 낱말을 세기 위한 토막(2글자 이상, 한글·영문·숫자) */
const quizTokens = (r: SheetRow) => new Set(
  `${r.퀴즈문제 || ""} ${partOf(r)} ${r.카테고리 || ""} ${r.설명 || ""}`.toLowerCase().split(/[^0-9a-z가-힣]+/).filter((t) => t.length >= 2),
);

/**
 * IT기술력DB 줄(퀴즈문제·퀴즈답·난이도)로 4지선다를 만든다.
 *  보기 = 정답 + 다른 줄의 답 3개. 오답은 '문제와 낱말이 많이 겹치는 줄'(같은 주제)에서 먼저 고른다 — 카테고리가 비어 있는 줄이 211개라
 *  카테고리만으로 고르면 "공개키 암호화" 문제에 "흰주황" 같은 보기가 섞였다(2026-10-03). 같은 답·너무 길이가 다른 답은 뒤로 민다.
 */
export function buildQuiz(rows: SheetRow[], count: number, level: string = "전체", rand: () => number = Math.random): QuizQuestion[] {
  const pool = rows.filter((r) => (r.퀴즈문제 || "").trim() && (r.퀴즈답 || "").trim());
  const leveled = level === "전체" ? pool : pool.filter((r) => String(r.난이도 || "").trim() === level);
  const picked = shuffle(leveled, rand).slice(0, Math.max(1, count));
  const tokenCache = new Map<SheetRow, Set<string>>();
  const tokensOf = (r: SheetRow) => { let t = tokenCache.get(r); if (!t) { t = quizTokens(r); tokenCache.set(r, t); } return t; };
  return picked.map((r) => {
    const answer = r.퀴즈답.trim();
    const mine = tokensOf(r);
    const scored = shuffle(pool.filter((o) => o !== r && o.퀴즈답.trim() && o.퀴즈답.trim() !== answer), rand).map((o) => {
      let overlap = 0; tokensOf(o).forEach((t) => { if (mine.has(t)) overlap++; });
      const sameCat = r.카테고리 && o.카테고리 === r.카테고리 ? 1 : 0;
      const lenGap = Math.abs(o.퀴즈답.trim().length - answer.length);
      return { a: o.퀴즈답.trim(), score: overlap * 3 + sameCat * 2 - Math.min(3, lenGap / 8) };
    }).sort((x, y) => y.score - x.score);
    const choices: string[] = [];
    for (const { a } of scored) {
      if (!choices.includes(a)) choices.push(a);
      if (choices.length >= 3) break;
    }
    return {
      id: r.ID, 카테고리: r.카테고리 || partOf(r) || "IT", 부품명: partOf(r), 문제: r.퀴즈문제.trim(), 정답: answer,
      보기: shuffle([answer, ...choices], rand), 난이도: r.난이도 || "", 설명: r.설명 || "", 조치방법: r.조치방법 || "",
      AI해설: r.AI해설 || r.AI설명 || "", 소요시간: r.소요시간 || "", 주의사항: r.주의사항 || "",
    };
  });
}

/** 공개 CSV 내려받기 주소(탭 하나) — 앱 fetchTab 과 엣지 it_sheet 도구가 같은 주소를 쓴다 */
export const itSheetCsvUrl = (key: ItTabKey) => `https://docs.google.com/spreadsheets/d/${IT_SHEET_ID}/export?format=csv&gid=${IT_TABS[key].gid}`;

/** 받은 CSV 글 → 탭별 손질까지 끝난 줄(교육자료링크는 최근 줄만, 기술력DB 는 짧은 부품명 칸도). 비공개면(HTML 이 오면) 오류 */
export function tabRowsFromCsvText(key: ItTabKey, text: string): SheetRow[] {
  if (/^\s*</.test(text)) throw new Error("IT 시트가 비공개로 바뀐 것 같습니다 — 공유를 '링크가 있는 모든 사용자(뷰어)'로 바꿔 주세요");
  let rows = rowsFromCsv(text, IT_TABS[key].headers);
  if (key === "links") rows = dedupeLinks(rows);
  if (key === "knowledge") rows = rows.map((r) => (r["부품명/항목"] && !r.부품명 ? { ...r, 부품명: r["부품명/항목"] } : r)); // 짧은 이름도 함께(DB 조회용)
  return rows;
}

export const asItRows = (rows: SheetRow[]): ItRow[] => rows as ItRow[];
