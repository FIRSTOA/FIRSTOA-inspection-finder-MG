/**
 * 거래처 이름 → 이번 분기 워킨맵 점검·미수·재계약 상태 배치 조회.
 * 일정리스트 배지 · FIELD AS 변환 안내에서 워킨맵과 같은 기준으로 보여주기 위한 공용 헬퍼.
 * 쿼리는 입력 거래처 수와 무관하게 3회이며 5분간 캐시한다.
 */
import { selectAllRows } from "./supabase";
import { vendorMatchKey } from "./ids";

export type VendorWorkFlags = {
  // 이번 분기 워킨맵(점검) 등재 여부 — done=G5 완료, carried=G12 이관
  inspection: { quarter: number; label: string; done: boolean; carried: boolean } | null;
  // 미수 이력(미수팀 시트 출처) — cleared=완납(최신 기록 잔액 0), date=마지막 입력일.
  // 완납이어도 이력이 있으면 반환한다(처리됐다는 사실 자체가 체크 포인트).
  misu: { months: string; balance: string; date: string; cleared: boolean } | null;
  // 재계약 워킨맵 등재 — done=매칭 전건 G5, due "26년 8월"
  renewal: { quarter: number; done: boolean; due: string } | null;
};

type PlaceRow = { name: string; label: string; quarter: number; kind: string; memos?: unknown };

// WalkingMap contractEnd와 같은 규칙(간이판): "계약종료 2608" / 이름 접두 "2608/" → 종료 연·월
function contractEndMonth(name: string, memos: string[]): { year: number; month: number } | null {
  const source = [name, ...memos].join(" ");
  const marked = source.match(/계약종료(?:년월)?\s*[-/:.]?\s*(\d{2,4})\s*[-년/.]?\s*(\d{1,2})?/);
  const leading = name.match(/^(\d{2})(\d{2})\//);
  let year = 0;
  let month = 0;
  if (marked) {
    const digits = marked[1];
    if (digits.length === 4 && !marked[2]) {
      year = 2000 + Number(digits.slice(0, 2));
      month = Number(digits.slice(2));
    } else {
      year = digits.length === 2 ? 2000 + Number(digits) : Number(digits);
      month = Number(marked[2] || 0);
    }
  } else if (leading) {
    year = 2000 + Number(leading[1]);
    month = Number(leading[2]);
  }
  if (!year || month < 1 || month > 12) return null;
  return { year, month };
}

function normMisuDate(value: string) {
  const match = String(value).match(/(\d{4})[.\-/]\s*(\d{1,2})(?:[.\-/]\s*(\d{1,2}))?/);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}-${(match[3] || "1").padStart(2, "0")}` : "";
}

type Sources = {
  quarter: number;
  misu: Map<string, { months: string; balance: string; date: string; cleared: boolean }>;
  inspection: Map<string, { quarter: number; label: string }[]>;
  renewal: Map<string, { quarter: number; label: string; endMonth: number | null }[]>;
};

let cached: { at: number; promise: Promise<Sources> } | null = null;

async function loadSources(): Promise<Sources> {
  const quarter = Math.floor(new Date().getMonth() / 3) + 1;
  const prevQuarter = quarter === 1 ? 4 : quarter - 1;
  const startMonth = (quarter - 1) * 3;
  const inspectionMonths = [startMonth + 1, startMonth + 2, startMonth + 3];
  const misuSelect = encodeURIComponent("_업체명,미수개월,미수잔액,실제 잔액,실제 개월수,입력일");
  const sourceCol = encodeURIComponent("_출처");
  const [misuRows, renewalRows, quarterRows] = await Promise.all([
    // 미수는 시트 출처만(카톡 유입은 과거 이력) — WalkingMap loadMisu와 동일 기준
    selectAllRows<Record<string, unknown>>("misu", `select=${misuSelect}&${sourceCol}=like.${encodeURIComponent("시트")}*&order=id.asc`),
    selectAllRows<PlaceRow>("workin_map_places", `select=name,label,quarter,kind,memos&kind=eq.renewal&quarter=in.(${quarter},${prevQuarter})`),
    selectAllRows<PlaceRow>("workin_map_places", `select=name,label,quarter,kind&kind=eq.quarter&quarter=eq.${quarter}`),
  ]);

  const misu = new Map<string, { months: string; balance: string; date: string; cleared: boolean }>();
  for (const row of misuRows) {
    const key = vendorMatchKey(String(row["_업체명"] || ""));
    if (!key) continue;
    // 팀마다 컬럼이 달라 미수잔액 → '실제 잔액' 순으로 읽는다 (B팀 시트는 실제 잔액만 있음)
    const balanceText = String(row["미수잔액"] || "").trim() || String(row["실제 잔액"] || "").trim();
    const monthsText = String(row["미수개월"] || "").trim() || String(row["실제 개월수"] || "").trim();
    const digits = balanceText.replace(/[^\d]/g, "");
    const date = normMisuDate(String(row["입력일"] || ""));
    const prev = misu.get(key);
    // 완납(잔액 0) 기록도 최신이면 유지 — "언제 완납됐다"를 보여줘야 이중 체크가 없다.
    if (!prev || date > prev.date) misu.set(key, { months: monthsText, balance: balanceText, date, cleared: !digits || Number(digits) === 0 });
  }

  const inspection = new Map<string, { quarter: number; label: string }[]>();
  for (const row of quarterRows) {
    const key = vendorMatchKey(row.name || "");
    if (!key) continue;
    const list = inspection.get(key) || [];
    list.push({ quarter: row.quarter, label: String(row.label || "") });
    inspection.set(key, list);
  }

  const renewal = new Map<string, { quarter: number; label: string; endMonth: number | null }[]>();
  for (const row of renewalRows) {
    const memos = Array.isArray(row.memos) ? (row.memos as unknown[]).map((m) => String(m)) : [];
    const end = contractEndMonth(row.name || "", memos);
    if (end && !inspectionMonths.includes(end.month)) continue; // 종료월이 이번 점검분기 밖이면 제외(워킨맵과 동일)
    const key = vendorMatchKey(row.name || "");
    if (!key) continue;
    const list = renewal.get(key) || [];
    list.push({ quarter: row.quarter, label: String(row.label || ""), endMonth: end?.month ?? null });
    renewal.set(key, list);
  }

  return { quarter, misu, inspection, renewal };
}

function getSources(): Promise<Sources> {
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.promise;
  const promise = loadSources();
  cached = { at: Date.now(), promise };
  promise.catch(() => { cached = null; }); // 실패한 응답은 캐시하지 않는다
  return promise;
}

function lookup<T>(map: Map<string, T>, key: string): T | undefined {
  if (!key) return undefined;
  const exact = map.get(key);
  if (exact) return exact;
  if (key.length < 5) return undefined;
  for (const [candidate, value] of map) {
    if (candidate.length >= 5 && (candidate.includes(key) || key.includes(candidate))) return value;
  }
  return undefined;
}

export async function getVendorFlagsBatch(vendors: string[]): Promise<Map<string, VendorWorkFlags>> {
  const result = new Map<string, VendorWorkFlags>();
  const unique = Array.from(new Set(vendors.map((v) => String(v || "").trim()).filter(Boolean)));
  if (!unique.length) return result;
  const sources = await getSources();
  const dueYear = String(new Date().getFullYear()).slice(2);
  for (const vendor of unique) {
    const key = vendorMatchKey(vendor);
    const insp = lookup(sources.inspection, key);
    const misu = lookup(sources.misu, key);
    const renew = lookup(sources.renewal, key);
    const flags: VendorWorkFlags = {
      inspection: insp?.length ? {
        quarter: insp[0].quarter,
        label: insp[0].label,
        done: insp.every((place) => place.label === "G5"),
        carried: insp.some((place) => place.label === "G12") && insp.every((place) => place.label === "G5" || place.label === "G12"),
      } : null,
      misu: misu ? { months: misu.months.replace(/개월/g, "").trim(), balance: misu.balance, date: misu.date, cleared: misu.cleared } : null,
      renewal: renew?.length ? (() => {
        const best = [...renew].sort((a, b) => (a.endMonth || 99) - (b.endMonth || 99))[0];
        return {
          quarter: best.quarter,
          done: renew.every((place) => place.label === "G5"),
          due: best.endMonth ? `${dueYear}년 ${best.endMonth}월` : "",
        };
      })() : null,
    };
    if (flags.inspection || flags.misu || flags.renewal) result.set(vendor, flags);
  }
  return result;
}
