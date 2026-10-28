/**
 * IT 학습·처리이력 — IT파트가 관리하는 PC DB 구글 시트 읽기(2026-10-03).
 *
 *  이 시트와 Apps Script는 IT 담당자 소유다. FIELD는 '보는 창'이라 공개 시트를 CSV로 그대로 읽기만 하고(설정 없음, CORS 허용 확인)
 *  우리 DB로 복사하지 않는다. 쓰기(AS 등록)는 담당자의 Apps Script(itTechApi.ts)로만 보낸다.
 *  시트는 '링크가 있는 모든 사용자 보기'여야 한다. 탭(gid)이 바뀌면 여기만 고친다. 재고 탭은 시트에 없다.
 */
// 2026-10-29: 순수 부분(탭·CSV 파서·검색·퀴즈)은 supabase/functions/_shared/ask/it-sheet.ts 로 — 통합검색 data-ask 의 it_sheet 도구와 같은 코드. 여기서 다시 내보낸다.
import { IT_TABS, itSheetCsvUrl, tabRowsFromCsvText, type ItTabKey, type SheetRow } from "../supabase/functions/_shared/ask/it-sheet.ts";
export * from "../supabase/functions/_shared/ask/it-sheet.ts";

// ── 읽기 + 캐시 ───────────────────────────────────────────────────────────
const mem = new Map<string, SheetRow[]>();
const LS_PREFIX = "it_sheet_v1:";
const readLs = (gid: string): SheetRow[] | null => {
  try { const raw = localStorage.getItem(LS_PREFIX + gid); return raw ? (JSON.parse(raw).rows as SheetRow[]) : null; } catch { return null; }
};
const writeLs = (gid: string, rows: SheetRow[]) => {
  try { const json = JSON.stringify({ t: Date.now(), rows }); if (json.length < 3_000_000) localStorage.setItem(LS_PREFIX + gid, json); } catch { /* 용량 초과 등 무시 */ }
};

/** 시트에서 새로 읽는다(캐시 안 봄). 가져오기와 임시 읽기가 함께 쓴다 */
export async function fetchTab(key: ItTabKey): Promise<SheetRow[]> {
  const { gid } = IT_TABS[key];
  const res = await fetch(itSheetCsvUrl(key), { cache: "no-store" });
  if (!res.ok) throw new Error(`IT 시트를 읽지 못했습니다(${res.status}) — 시트 공유가 '링크가 있는 모든 사용자'인지 확인해 주세요`);
  const rows = tabRowsFromCsvText(key, await res.text());
  mem.set(gid, rows); writeLs(gid, rows);
  return rows;
}

/**
 * 탭 전체 줄(임시 읽기용). 기기에 저장된 지난 결과가 있으면 바로 돌려주고 뒤에서 새로 받아 onUpdate로 알린다.
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
