/**
 * IT 학습·처리이력 — 퍼스트전산 PC DB 구글 시트를 '설정 없이' 바로 읽는다(2026-10-03).
 *
 *  예전엔 시트 쪽 Apps Script(API 어댑터)를 배포하고 그 /exec 주소를 기기마다 넣어야 했다.
 *  시트가 '링크가 있는 모든 사용자 보기'로 공개돼 있어 CSV 내보내기 주소를 브라우저가 바로 읽을 수 있고(CORS 허용 확인),
 *  한 번 부르는 데 2~8초 걸리던 Apps Script보다 빠르다. 쓰기(AS 등록)만은 여전히 Apps Script 주소가 있어야 한다.
 *
 *  탭(gid)은 시트 구조가 바뀌면 여기만 고친다. 재고 탭은 시트에 없어 화면에서 뺐다.
 */
import type { ItRow, QuizQuestion } from "./itTechApi";

export const IT_SHEET_ID = "17ADPVDbfrfXQhUTAM4OPLnkaCqJ-gWnq3UcgRscfxT4";
export const IT_SHEET_URL = `https://docs.google.com/spreadsheets/d/${IT_SHEET_ID}/edit`;

export type ItTabKey = "knowledge" | "history" | "sales" | "links";
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

/**
 * IT기술력DB 줄(퀴즈문제·퀴즈답·난이도)로 4지선다를 만든다.
 *  보기 = 정답 + 다른 줄의 답 3개(같은 카테고리 우선, 중복 답 제외). 답이 모자라면 보기가 4개보다 적을 수 있다.
 */
export function buildQuiz(rows: SheetRow[], count: number, level: string = "전체", rand: () => number = Math.random): QuizQuestion[] {
  const pool = rows.filter((r) => (r.퀴즈문제 || "").trim() && (r.퀴즈답 || "").trim());
  const leveled = level === "전체" ? pool : pool.filter((r) => String(r.난이도 || "").trim() === level);
  const picked = shuffle(leveled, rand).slice(0, Math.max(1, count));
  return picked.map((r) => {
    const answer = r.퀴즈답.trim();
    const others = pool.filter((o) => o !== r && o.퀴즈답.trim() && o.퀴즈답.trim() !== answer);
    const same = shuffle(others.filter((o) => o.카테고리 === r.카테고리), rand);
    const rest = shuffle(others.filter((o) => o.카테고리 !== r.카테고리), rand);
    const choices: string[] = [];
    for (const o of [...same, ...rest]) {
      const a = o.퀴즈답.trim();
      if (!choices.includes(a)) choices.push(a);
      if (choices.length >= 3) break;
    }
    return {
      id: r.ID, 카테고리: r.카테고리 || "", 부품명: r["부품명/항목"] || "", 문제: r.퀴즈문제.trim(), 정답: answer,
      보기: shuffle([answer, ...choices], rand), 난이도: r.난이도 || "", 설명: r.설명 || "", 조치방법: r.조치방법 || "",
      AI해설: r.AI해설 || r.AI설명 || "", 소요시간: r.소요시간 || "", 주의사항: r.주의사항 || "",
    };
  });
}

// ── 읽기 + 캐시 ───────────────────────────────────────────────────────────
const mem = new Map<string, SheetRow[]>();
const LS_PREFIX = "it_sheet_v1:";
const readLs = (gid: string): SheetRow[] | null => {
  try { const raw = localStorage.getItem(LS_PREFIX + gid); return raw ? (JSON.parse(raw).rows as SheetRow[]) : null; } catch { return null; }
};
const writeLs = (gid: string, rows: SheetRow[]) => {
  try { const json = JSON.stringify({ t: Date.now(), rows }); if (json.length < 3_000_000) localStorage.setItem(LS_PREFIX + gid, json); } catch { /* 용량 초과 등 무시 */ }
};

async function fetchTab(key: ItTabKey): Promise<SheetRow[]> {
  const { gid, headers } = IT_TABS[key];
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${IT_SHEET_ID}/export?format=csv&gid=${gid}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`IT 시트를 읽지 못했습니다(${res.status}) — 시트 공유가 '링크가 있는 모든 사용자'인지 확인해 주세요`);
  const text = await res.text();
  if (/^\s*</.test(text)) throw new Error("IT 시트가 비공개로 바뀐 것 같습니다 — 공유를 '링크가 있는 모든 사용자(뷰어)'로 바꿔 주세요");
  const rows = rowsFromCsv(text, headers);
  mem.set(gid, rows); writeLs(gid, rows);
  return rows;
}

/**
 * 탭 전체 줄. 기기에 저장된 지난 결과가 있으면 그것을 바로 돌려주고 뒤에서 새로 받아 onUpdate로 알린다(화면이 0초에 뜬다).
 * 없으면 네트워크를 기다린다.
 */
export async function getTabRows(key: ItTabKey, onUpdate?: (rows: SheetRow[]) => void): Promise<{ rows: SheetRow[]; stale: boolean }> {
  const { gid } = IT_TABS[key];
  const cached = mem.get(gid) || readLs(gid);
  if (cached && cached.length) {
    mem.set(gid, cached);
    void fetchTab(key).then((rows) => onUpdate?.(rows)).catch(() => { /* 오프라인이면 지난 결과 유지 */ });
    return { rows: cached, stale: true };
  }
  return { rows: await fetchTab(key), stale: false };
}

export const asItRows = (rows: SheetRow[]): ItRow[] => rows as ItRow[];
