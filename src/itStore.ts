/**
 * IT 학습·처리이력 저장소 — Supabase it_rows가 본체, 표가 아직 없으면 공개 시트를 임시로 읽는다(2026-10-03).
 *
 *  - it_rows(tab, row_no, source, data jsonb, search, quiz): 시트 네 탭을 한 표에 — 줄 내용은 data(jsonb) 그대로라 시트 머리글이 바뀌어도 코드 수정 없이 들어온다.
 *  - 검색은 서버에서(search ilike, pg_trgm) 맞는 줄만 받는다 → 폰에서 1,027줄을 다 내려받지 않는다.
 *  - 쓰기(AS 등록·퀴즈 결과)는 Supabase에만 — Apps Script는 더 이상 쓰지 않는다.
 *  - 표 만들기: supabase/it_db.sql(1회) → 앱의 [시트에서 가져오기] 단추(누구나).
 */
import { asItRows, buildQuiz, fetchTab, getTabRows, IT_TAB_KEYS, IT_TABS, type ItRow, type ItTabKey, type QuizQuestion, searchRows, type SheetRow } from "./itSheet";
import { countRows, deleteRows, insertRow, selectRows, SUPABASE_ANON, SUPABASE_URL, upsertRows } from "./supabase";

export const IT_TABLE = "it_rows";
export const IT_RESULTS_TABLE = "it_quiz_results";
export type ItSource = "db" | "sheet";
export type ItStatus = { source: ItSource; tableReady: boolean; dbRows: number };

let statusPromise: Promise<ItStatus> | null = null;
/** 표가 있고 줄이 들어 있으면 db, 표가 없거나 비었으면 sheet(임시) */
export function itStatus(force = false): Promise<ItStatus> {
  if (!statusPromise || force) {
    statusPromise = (async () => {
      try {
        const n = await countRows(IT_TABLE, "tab=eq.knowledge");
        return { source: n > 0 ? "db" : "sheet", tableReady: true, dbRows: n } as ItStatus;
      } catch {
        return { source: "sheet", tableReady: false, dbRows: 0 } as ItStatus;
      }
    })();
  }
  return statusPromise;
}

/** 모든 칸을 소문자로 이어 붙인 검색용 글자(서버 ilike 대상) */
export const searchText = (data: Record<string, unknown>) => Object.entries(data)
  .filter(([k]) => !k.startsWith("_"))
  .map(([, v]) => String(v ?? "").trim()).filter(Boolean).join("\n").toLowerCase();

/** 검색어 → 서버 필터용 낱말(PostgREST 예약문자 제거, 최대 6개) */
export const searchTokens = (query: string) => query.replace(/[,()"\\*]/g, " ").trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);

const H = { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` };
export const LIST_LIMIT = 300;

export type ListResult = { rows: ItRow[]; total: number; truncated: boolean };

/** Supabase에서 탭 한 장 검색 — 맞는 줄만, 최대 LIST_LIMIT. 처리이력은 최신이 위(앱 등록분 포함) */
export async function dbSearch(tab: ItTabKey, query: string, limit = LIST_LIMIT): Promise<ListResult> {
  const p = new URLSearchParams();
  p.set("select", "id,row_no,source,data,created_at");
  p.set("tab", `eq.${tab}`);
  for (const t of searchTokens(query)) p.append("search", `ilike.*${t}*`);
  p.set("order", tab === "history" ? "created_at.desc,row_no.desc" : "row_no.asc");
  p.set("limit", String(limit));
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${IT_TABLE}?${p.toString()}`, { headers: { ...H, Prefer: "count=exact" } });
  if (!res.ok) throw new Error(`IT DB 조회 실패(${res.status})`);
  const total = Number((res.headers.get("content-range") || "").split("/")[1] || 0);
  const list = (await res.json()) as Array<{ id: number; row_no: number; source: string; data: Record<string, unknown>; created_at: string }>;
  const rows: ItRow[] = list.map((r) => ({ ...r.data, _id: r.id, _source: r.source, _created_at: r.created_at }));
  return { rows, total, truncated: total > rows.length };
}

/** 어느 저장소든 같은 모양으로 — db면 서버 검색, sheet면 임시 읽기 후 화면에서 거르기 */
export async function listRows(tab: ItTabKey, query: string, onUpdate?: (r: ListResult) => void): Promise<ListResult> {
  const status = await itStatus();
  if (status.source === "db") return dbSearch(tab, query);
  const { rows } = await getTabRows(tab, (fresh) => { const hit = asItRows(searchRows(fresh, query)); onUpdate?.({ rows: hit, total: hit.length, truncated: false }); });
  const hit = asItRows(searchRows(rows, query));
  return { rows: hit, total: hit.length, truncated: false };
}

let quizCache: Promise<SheetRow[]> | null = null;
const QUIZ_KEYS = ["카테고리", "부품명", "퀴즈문제", "퀴즈답", "난이도", "설명", "조치방법", "AI해설", "AI설명", "소요시간", "주의사항"];
/** 퀴즈용 줄 — DB면 필요한 칸만(data->>키) 받아 가볍게, 시트면 전체 */
export async function quizRows(): Promise<SheetRow[]> {
  const status = await itStatus();
  if (status.source !== "db") return (await getTabRows("knowledge")).rows;
  if (!quizCache) {
    const p = new URLSearchParams();
    p.set("select", QUIZ_KEYS.map((k) => `data->>${k}`).join(","));
    p.set("tab", "eq.knowledge"); p.set("quiz", "is.true"); p.set("limit", "3000");
    quizCache = selectRows<Record<string, string | null>>(IT_TABLE, p.toString()).then((rows) => rows.map((r) => {
      const o: SheetRow = {}; QUIZ_KEYS.forEach((k) => { o[k] = String(r[k] ?? ""); }); return o;
    })).catch((e) => { quizCache = null; throw e; });
  }
  return quizCache;
}
export async function makeQuiz(count: number, level: string): Promise<QuizQuestion[]> {
  return buildQuiz(await quizRows(), count, level);
}

/** 시트 네 탭 → Supabase(upsert). 누구나 누를 수 있다. 시트에서 지워진 뒤쪽 줄은 함께 지운다(앱 등록분은 그대로) */
export async function importSheetToDb(onProgress?: (text: string) => void): Promise<number> {
  const status = await itStatus(true);
  if (!status.tableReady) throw new Error("DB 표(it_rows)가 아직 없습니다 — 관리자가 supabase/it_db.sql을 한 번 실행해야 합니다");
  const now = new Date().toISOString();
  let total = 0;
  for (const key of IT_TAB_KEYS) {
    onProgress?.(`${IT_TABS[key].name} 읽는 중…`);
    const rows = await fetchTab(key);
    const records = rows.map((data, i) => ({
      tab: key, row_no: i + 1, source: "sheet", data, search: searchText(data),
      quiz: key === "knowledge" && Boolean((data.퀴즈문제 || "").trim() && (data.퀴즈답 || "").trim()), updated_at: now,
    }));
    for (let i = 0; i < records.length; i += 200) {
      await upsertRows(IT_TABLE, records.slice(i, i + 200), "tab,row_no");
      onProgress?.(`${IT_TABS[key].name} ${Math.min(i + 200, records.length)}/${records.length}`);
    }
    await deleteRows(IT_TABLE, `tab=eq.${key}&source=eq.sheet&row_no=gt.${rows.length}`);
    total += rows.length;
  }
  statusPromise = null; quizCache = null;
  return total;
}

const kstDate = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

/** AS 등록 폼 → PC DB 머리글과 같은 모양(옛 Apps Script 어댑터의 normalizeItRecord_와 동일 규칙). 빈 칸은 뺀다 */
export function normalizeHistory(form: Record<string, unknown>, author: string): Record<string, string> {
  const g = (k: string) => String(form[k] ?? "").trim();
  const company = g("업체명"), symptom = g("증상"), serial = g("시리얼번호");
  const out: Record<string, string> = {
    등록자: g("작성자") || author,
    업체명: company,
    자산번호: g("자산기번") || g("자산번호") || serial,
    레벨: g("레벨"),
    분류: g("구분") || g("분류") || "AS",
    제조사: g("제조사"),
    모델명: g("모델명"),
    부품: g("부품"),
    제목: g("제목") || [company, symptom].filter(Boolean).join(" - "),
    증상: symptom,
    중지코드: g("중지코드"),
    점검순서: g("점검순서"),
    원인: g("원인"),
    조치: g("처리내용") || g("조치"),
    결과: g("결과"),
    설정경로: g("설정경로"),
    고객응대: g("접수자") || g("고객응대"),
    히스토리: g("특이사항") || g("히스토리"),
    키워드: [g("지역"), g("부서명"), serial ? `시리얼 ${serial}` : "", g("등급"), g("도착시간") ? `도착 ${g("도착시간")}` : "", g("소요시간") ? `소요 ${g("소요시간")}` : ""].filter(Boolean).join(" / "),
    등록일: kstDate(),
  };
  Object.keys(out).forEach((k) => { if (!out[k]) delete out[k]; });
  return out;
}

export async function addHistory(form: Record<string, unknown>, author: string): Promise<void> {
  const data = normalizeHistory(form, author);
  const r = await insertRow(IT_TABLE, { tab: "history", row_no: -Date.now(), source: "app", author: data.등록자 || author, data, search: searchText(data), quiz: false });
  if (r !== "new") throw new Error("저장되지 않았습니다 — 다시 시도해 주세요");
}

export type QuizResult = { name: string; level: string; score: number; total: number; wrong: Array<{ 문제: string; 정답: string; 카테고리?: string }> };
export async function saveQuizResult(r: QuizResult): Promise<void> {
  await insertRow(IT_RESULTS_TABLE, { name: r.name, level: r.level, score: r.score, total: r.total, wrong: r.wrong });
}
export type QuizResultRow = { id: number; name: string; level: string; score: number; total: number; created_at: string };
export async function myQuizResults(name: string, limit = 5): Promise<QuizResultRow[]> {
  if (!name) return [];
  return selectRows<QuizResultRow>(IT_RESULTS_TABLE, `select=id,name,level,score,total,created_at&name=eq.${encodeURIComponent(name)}&order=created_at.desc&limit=${limit}`);
}
