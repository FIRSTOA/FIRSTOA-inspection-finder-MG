/**
 * 거래처 이름 → 이번 분기 워킨맵 점검·미수·재계약 상태 배치 조회.
 * 일정리스트 배지 · FIELD AS 변환 안내에서 워킨맵과 같은 기준으로 보여주기 위한 공용 헬퍼.
 * 쿼리는 입력 거래처 수와 무관하게 3회이며 5분간 캐시한다.
 */
import { selectAllRows } from "./supabase";
import { vendorMatchKey } from "./ids";
import { getAliasCodeMap, getWorkinCodeMap, translateVendor } from "./vendorCodes";

export type VendorWorkFlags = {
  // 이번 분기 워킨맵(점검) 등재 여부 — done=G5 완료, carried=G12 이관
  inspection: { quarter: number; label: string; done: boolean; carried: boolean } | null;
  // 미수 이력(미수팀 시트 출처) — cleared=완납(최신 기록 잔액 0), date=마지막 입력일, count=잔액>0 기록 누적 횟수(상습 여부).
  // 완납이어도 이력이 있으면 반환한다(처리됐다는 사실 자체가 체크 포인트).
  misu: { months: string; balance: string; date: string; cleared: boolean; count: number } | null;
  // 재계약 워킨맵 등재 — done=매칭 전건 G5, due "26년 9월". 다음 분기 배치(분기 말 등록)도 미리 잡는다.
  renewal: { quarter: number; done: boolean; due: string } | null;
  // 초과료(초과시트 최신 1건, 합계>0) — count12=최근 12개월 발생 횟수 (반복 초과 = 조정 영업 포인트)
  overage: { total: string; date: string; count12: number } | null;
  // 최근 90일 불만 — count90=그 기간 건수 (반복 불만 = 방문 전 대응 준비)
  bulman: { date: string; content: string; count90: number } | null;
  // 거래처 특이사항(vendor_notes) — 방문 규칙·출입·유무상 범위 등 "그 업체 고유"의 사항.
  // 점검 기록의 특이사항 칸(그날 기기 상태)과는 다른 층이라 별도로 싣는다.
  // ids: 이 업체에 실제로 매칭된 vendor_notes 행들 — 수정·삭제는 반드시 이 id로 한다
  //      (표기가 다른 별칭·부분일치로 잡힌 행을 새 행으로 덧쓰면 같은 내용이 계속 중복 누적된다)
  note: { text: string; grade: string; count: number; ids: string[]; workStart: string; lunchTime: string; author: string; updatedAt: string } | null;
};

type NoteEntry = { text: string; grade: string; count: number; ids: string[]; workStart: string; lunchTime: string; author: string; updatedAt: string };

type PlaceRow = { id: number; name: string; label: string; quarter: number; kind: string; memos?: unknown };

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

type MisuEntry = { months: string; balance: string; date: string; cleared: boolean; count: number };
type OverEntry = { total: string; date: string; count12: number };
type BulEntry = { date: string; content: string; count90: number };
type RenewEntry = { quarter: number; label: string; endMonth: number | null; endYear: number | null };
type Sources = {
  quarter: number;
  misu: Map<string, MisuEntry>;
  inspection: Map<string, { quarter: number; label: string }[]>;
  renewal: Map<string, RenewEntry[]>;
  overage: Map<string, OverEntry>;
  bulman: Map<string, BulEntry>;
  notes: Map<string, NoteEntry>;
  // 거래처 코드 계층 — 이름 키와 병행 구축, 조회 시 코드 일치를 먼저 본다
  alias: Map<string, string | null>;
  misuByCode: Map<string, MisuEntry>;
  inspectionByCode: Map<string, { quarter: number; label: string }[]>;
  renewalByCode: Map<string, RenewEntry[]>;
  overageByCode: Map<string, OverEntry>;
  bulmanByCode: Map<string, BulEntry>;
};

let cached: { at: number; promise: Promise<Sources> } | null = null;

/** 특이사항을 고친 직후처럼 즉시 반영이 필요할 때 — 다음 조회가 새로 읽는다 */
export function resetVendorFlagsCache() { cached = null; }

async function loadSources(): Promise<Sources> {
  const quarter = Math.floor(new Date().getMonth() / 3) + 1;
  const prevQuarter = quarter === 1 ? 4 : quarter - 1;
  const nextQuarter = quarter === 4 ? 1 : quarter + 1;
  const startMonth = (quarter - 1) * 3;
  const inspectionMonths = [startMonth + 1, startMonth + 2, startMonth + 3];
  // 재계약은 이번 분기 + 다음 분기 종료월까지 미리 보이게 (다음 분기 배치는 보통 분기 말에 등록된다)
  const nextStart = (nextQuarter - 1) * 3;
  const renewalMonths = [...inspectionMonths, nextStart + 1, nextStart + 2, nextStart + 3];
  const misuSelect = encodeURIComponent("_업체명,미수개월,미수잔액,실제 잔액,실제 개월수,입력일");
  const sourceCol = encodeURIComponent("_출처");
  const bulmanCutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const [misuRows, renewalRows, quarterRows, overageRows, bulmanRows, alias, placeCodes, noteRows] = await Promise.all([
    // 미수는 시트 출처만(카톡 유입은 과거 이력) — WalkingMap loadMisu와 동일 기준
    selectAllRows<Record<string, unknown>>("misu", `select=${misuSelect}&${sourceCol}=like.${encodeURIComponent("시트")}*&order=id.asc`),
    selectAllRows<PlaceRow>("workin_map_places", `select=id,name,label,quarter,kind,memos&kind=eq.renewal&quarter=in.(${quarter},${prevQuarter},${nextQuarter})`),
    selectAllRows<PlaceRow>("workin_map_places", `select=id,name,label,quarter,kind&kind=eq.quarter&quarter=eq.${quarter}`),
    selectAllRows<Record<string, unknown>>("overage", `select=${encodeURIComponent("_업체명,합계,날짜")}&order=id.asc`),
    selectAllRows<Record<string, unknown>>("bulman", `select=${encodeURIComponent("_업체명,방문일,날짜,불만내용,불편내용")}&order=id.desc&limit=600`),
    getAliasCodeMap().catch(() => new Map<string, string | null>()),
    getWorkinCodeMap().catch(() => new Map<number, string>()),
    selectAllRows<{ id: string; vendor: string; vendor_key: string; grade: string; note: string; work_start?: string; lunch_time?: string; author?: string; updated_at?: string }>("vendor_notes", "select=id,vendor,vendor_key,grade,note,work_start,lunch_time,author,updated_at&order=updated_at.desc").catch(() => []),
  ]);

  // 거래처 특이사항 — 한 업체에 여러 건이면 최신부터 이어 붙이고 건수를 남긴다
  const notes = new Map<string, NoteEntry>();
  for (const row of noteRows) {
    const key = row.vendor_key || vendorMatchKey(row.vendor);
    const text = String(row.note || "").trim();
    // 출근·점심시간만 적어둔 업체도 있다 — 본문이 비었다고 버리면 화면에 아무것도 안 뜬다(2026-08-19 버그)
    const hasHours = !!String(row.work_start || "").trim() || !!String(row.lunch_time || "").trim();
    if (!key || (!text && !hasHours)) continue;
    const prev = notes.get(key);
    if (prev) {
      notes.set(key, { ...prev, text: [prev.text, text].filter(Boolean).join("\n\n"), grade: prev.grade || row.grade || "", count: prev.count + 1, ids: [...prev.ids, row.id],
        workStart: prev.workStart || String(row.work_start || ""), lunchTime: prev.lunchTime || String(row.lunch_time || "") });
    } else {
      notes.set(key, { text, grade: row.grade || "", count: 1, ids: [row.id],
        workStart: String(row.work_start || ""), lunchTime: String(row.lunch_time || ""),
        author: String(row.author || ""), updatedAt: String(row.updated_at || "").slice(0, 10) });
    }
  }

  const misu = new Map<string, MisuEntry>();
  const misuByCode = new Map<string, MisuEntry>();
  for (const row of misuRows) {
    const key = vendorMatchKey(String(row["_업체명"] || ""));
    if (!key) continue;
    // 팀마다 컬럼이 달라 미수잔액 → '실제 잔액' 순으로 읽는다 (B팀 시트는 실제 잔액만 있음)
    const balanceText = String(row["미수잔액"] || "").trim() || String(row["실제 잔액"] || "").trim();
    const monthsText = String(row["미수개월"] || "").trim() || String(row["실제 개월수"] || "").trim();
    const digits = balanceText.replace(/[^\d]/g, "");
    const owed = !!digits && Number(digits) > 0; // 잔액 있는 기록 = 미수 발생 1회
    const date = normMisuDate(String(row["입력일"] || ""));
    const prev = misu.get(key);
    // 완납(잔액 0) 기록도 최신이면 유지 — "언제 완납됐다"를 보여줘야 이중 체크가 없다. 횟수는 계속 누적.
    const next = (!prev || date > prev.date)
      ? { months: monthsText, balance: balanceText, date, cleared: !owed, count: (prev?.count || 0) + (owed ? 1 : 0) }
      : { ...prev, count: prev.count + (owed ? 1 : 0) };
    misu.set(key, next);
    const code = translateVendor(alias, String(row["_업체명"] || ""));
    if (code) {
      const prevCode = misuByCode.get(code);
      const nextCode = (!prevCode || date > prevCode.date)
        ? { months: monthsText, balance: balanceText, date, cleared: !owed, count: (prevCode?.count || 0) + (owed ? 1 : 0) }
        : { ...prevCode, count: prevCode.count + (owed ? 1 : 0) };
      misuByCode.set(code, nextCode);
    }
  }

  const inspection = new Map<string, { quarter: number; label: string }[]>();
  const inspectionByCode = new Map<string, { quarter: number; label: string }[]>();
  for (const row of quarterRows) {
    const entry = { quarter: row.quarter, label: String(row.label || "") };
    const key = vendorMatchKey(row.name || "");
    if (key) inspection.set(key, [...(inspection.get(key) || []), entry]);
    const code = placeCodes.get(Number(row.id));
    if (code) inspectionByCode.set(code, [...(inspectionByCode.get(code) || []), entry]);
  }

  const renewal = new Map<string, RenewEntry[]>();
  const renewalByCode = new Map<string, RenewEntry[]>();
  for (const row of renewalRows) {
    const memos = Array.isArray(row.memos) ? (row.memos as unknown[]).map((m) => String(m)) : [];
    const end = contractEndMonth(row.name || "", memos);
    if (end && !renewalMonths.includes(end.month)) continue; // 이번 분기~다음 분기 종료월만 (그 밖은 아직 멀다)
    const entry = { quarter: row.quarter, label: String(row.label || ""), endMonth: end?.month ?? null, endYear: end?.year ?? null };
    const key = vendorMatchKey(row.name || "");
    if (key) renewal.set(key, [...(renewal.get(key) || []), entry]);
    const code = placeCodes.get(Number(row.id));
    if (code) renewalByCode.set(code, [...(renewalByCode.get(code) || []), entry]);
  }

  const overage = new Map<string, OverEntry>();
  const overageByCode = new Map<string, OverEntry>();
  const overageCutoff = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  for (const row of overageRows) {
    const key = vendorMatchKey(String(row["_업체명"] || ""));
    if (!key) continue;
    const total = String(row["합계"] || "").trim();
    const digits = total.replace(/[^\d]/g, "");
    if (!digits || Number(digits) === 0) continue;
    const date = String(row["날짜"] || "").trim();
    const recent = normMisuDate(date) >= overageCutoff ? 1 : 0; // 최근 12개월 발생만 반복 횟수로
    const prev = overage.get(key);
    overage.set(key, (!prev || date > prev.date)
      ? { total, date, count12: (prev?.count12 || 0) + recent }
      : { ...prev, count12: prev.count12 + recent });
    const code = translateVendor(alias, String(row["_업체명"] || ""));
    if (code) {
      const prevCode = overageByCode.get(code);
      overageByCode.set(code, (!prevCode || date > prevCode.date)
        ? { total, date, count12: (prevCode?.count12 || 0) + recent }
        : { ...prevCode, count12: prevCode.count12 + recent });
    }
  }

  const bulman = new Map<string, BulEntry>();
  const bulmanByCode = new Map<string, BulEntry>();
  for (const row of bulmanRows) {
    const key = vendorMatchKey(String(row["_업체명"] || ""));
    if (!key) continue;
    const date = normMisuDate(String(row["방문일"] || row["날짜"] || ""));
    if (!date || date < bulmanCutoff) continue;
    const content = String(row["불만내용"] || row["불편내용"] || "").slice(0, 60);
    const prev = bulman.get(key);
    bulman.set(key, (!prev || date > prev.date)
      ? { date, content, count90: (prev?.count90 || 0) + 1 }
      : { ...prev, count90: prev.count90 + 1 });
    const code = translateVendor(alias, String(row["_업체명"] || ""));
    if (code) {
      const prevCode = bulmanByCode.get(code);
      bulmanByCode.set(code, (!prevCode || date > prevCode.date)
        ? { date, content, count90: (prevCode?.count90 || 0) + 1 }
        : { ...prevCode, count90: prevCode.count90 + 1 });
    }
  }

  return { quarter, misu, inspection, renewal, overage, bulman, notes, alias, misuByCode, inspectionByCode, renewalByCode, overageByCode, bulmanByCode };
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
    // 거래처 코드로 번역되면 코드 일치를 먼저 본다 — 표기가 달라도 정확히 잡힌다
    const code = translateVendor(sources.alias, vendor);
    const insp = (code ? sources.inspectionByCode.get(code) : undefined) ?? lookup(sources.inspection, key);
    const misu = (code ? sources.misuByCode.get(code) : undefined) ?? lookup(sources.misu, key);
    const renew = (code ? sources.renewalByCode.get(code) : undefined) ?? lookup(sources.renewal, key);
    const over = (code ? sources.overageByCode.get(code) : undefined) ?? lookup(sources.overage, key);
    const bul = (code ? sources.bulmanByCode.get(code) : undefined) ?? lookup(sources.bulman, key);
    const flags: VendorWorkFlags = {
      inspection: insp?.length ? {
        quarter: insp[0].quarter,
        label: insp[0].label,
        done: insp.every((place) => place.label === "G5"),
        carried: insp.some((place) => place.label === "G12") && insp.every((place) => place.label === "G5" || place.label === "G12"),
      } : null,
      misu: misu ? { months: misu.months.replace(/개월/g, "").trim(), balance: misu.balance, date: misu.date, cleared: misu.cleared, count: misu.count } : null,
      renewal: renew?.length ? (() => {
        const best = [...renew].sort((a, b) => ((a.endYear || 0) * 100 + (a.endMonth || 99)) - ((b.endYear || 0) * 100 + (b.endMonth || 99)))[0];
        const yearLabel = best.endYear ? String(best.endYear).slice(2) : dueYear;
        return {
          quarter: best.quarter,
          done: renew.every((place) => place.label === "G5"),
          due: best.endMonth ? `${yearLabel}년 ${best.endMonth}월` : "",
        };
      })() : null,
      overage: over || null,
      bulman: bul || null,
      note: lookup(sources.notes, key) || null,
    };
    if (flags.inspection || flags.misu || flags.renewal || flags.overage || flags.bulman || flags.note) result.set(vendor, flags);
  }
  return result;
}
