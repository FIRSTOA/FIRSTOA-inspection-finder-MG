/**
 * GAS 백엔드(First-DATA-MG) 통신 — 거래처 검색 / 최근 점검양식 / 통합이력.
 *
 * 백엔드는 doGet 에서 callback 파라미터를 받으면 JSONP(callback(json))로 응답한다.
 * GitHub Pages 등 다른 도메인에서 호출하므로 CORS를 피하기 위해 JSONP(GET)를 쓴다.
 * 엔드포인트는 검색용과 동일 배포(URL 고정 — "기존 배포 편집→새 버전").
 */

import { buildRecords, type Row } from "./inspectParser";
import { md5 } from "./md5";
import { enqueueFieldSheetSyncJob, enqueueOutbox, getConfig, getRoomMap, insertRecord, insertRow, insertRowReturning, invokeEdgeFunction, isTestModeValue, rpc, selectRows, updateRows, type FieldSheetSyncCategory } from "./supabase";
import type { PcFormState } from "./PcForm";
import type { CopierExpansionFormState } from "./CopierExpansionForm";
import type { ContactChangeFormState } from "./contactChange";
import { CATEGORY_SCHEMAS } from "./categoryForms";
import { normRegion } from "./region";
import { normalizeId as normId } from "./ids";
import { inferBrand } from "./copierBrand";

export const GAS_GET_URL =
  "https://script.google.com/macros/s/AKfycbzoubwDNWFpiR7h9YTEfQBTM2wE69GeqXI4fjVJQ-wPdEsQ9thxASo2J4ydytaPXyoO/exec";

export type Gubun = "점검" | "점검+AS" | "AS";

export type InspForm = {
  gubun: Gubun;
  date: string;
  model?: string;
  serial?: string;
  asset?: string;
  content?: string;
  handled?: string;
  author?: string;
  region?: string;
  count?: number; // 기기 대수(_원문 모델명 라인 수)
  text: string; // 점검/점검+AS/AS의 _원문 (없으면 빈 문자열)
  source: string;
};

export type InspFormsResp = { vendor: string; forms: InspForm[]; error?: string };

export type VendorMetaEntry = { d: string; r: string; model?: string; author?: string; count?: number };
export type VendorMeta = Record<string, VendorMetaEntry>;
export type VendorHit = {
  vendor: string;
  counts: Record<string, number>;
  meta: VendorMeta;
  matchedBy?: string;
};
export type SearchResp = { results: VendorHit[]; total: number; error?: string };

type HistorySearchTable = {
  table: string;
  category: string;
  dateField: string;
  regionField: string;
};

const HISTORY_SEARCH_TABLES: HistorySearchTable[] = [
  { table: "jeomgeom", category: "점검", dateField: "작성일", regionField: "지역" },
  { table: "as_records", category: "AS", dateField: "작성일", regionField: "지역" },
  { table: "overage_adjust", category: "초과", dateField: "방문일", regionField: "지역" },
  { table: "misu", category: "미수", dateField: "입력일", regionField: "지역" },
  { table: "bulman", category: "불만", dateField: "방문일", regionField: "지역" },
  { table: "pc_expansion", category: "PC확장성", dateField: "날짜", regionField: "지역" },
  { table: "mfp_expansion", category: "복합기확장성", dateField: "등록일", regionField: "미팅지역" },
  { table: "recontract", category: "재계약", dateField: "계약종료일", regionField: "지역" },
];

type HistoryRows = { config: HistorySearchTable; rows: Array<Record<string, unknown>> };
const historySearchCache = new Map<string, { at: number; promise: Promise<HistoryRows[]> }>();

function historySearchTerm(value: string) {
  return value.trim()
    .replace(/\s*\d{1,2}일\s*(?:고정\s*)?마감.*$/g, "")
    .replace(/\s*(?:고정|매월|분기|월말|말일)\s*마감.*$/g, "")
    .replace(/(?:\(주\)|㈜|주식회사|유한회사)/g, " ")
    .replace(/\s*(?:의원|병원|클리닉)\s*$/g, "")
    .replace(/[,*%()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function historySearchTerms(value: string) {
  const query = value.trim();
  const normalized = historySearchTerm(query);
  const withoutAddress = normalized
    .replace(/\s+(?:서울(?:특별시)?|부산(?:광역시)?|대구(?:광역시)?|인천(?:광역시)?|광주(?:광역시)?|대전(?:광역시)?|울산(?:광역시)?|세종(?:특별자치시)?|경기(?:도)?|강원(?:특별자치도|도)?|충청[남북]도|전라[남북]도|경상[남북]도|제주(?:특별자치도|도)?)\s+.*$/u, "")
    .replace(/\s+[가-힣]+(?:시|군|구)\s+.*$/u, "")
    .replace(/\s+[가-힣0-9·._()-]+(?:로|길)\s*\d+(?:-\d+)?(?:\s.*)?$/u, "")
    .trim();
  return Array.from(new Set([query, normalized, withoutAddress].filter((term) => term.length >= 2)));
}

function mergeHistoryRows(groups: HistoryRows[][]): HistoryRows[] {
  return HISTORY_SEARCH_TABLES.map((config) => {
    const unique = new Map<string, Record<string, unknown>>();
    groups.forEach((group) => {
      const rows = group.find((result) => result.config.table === config.table)?.rows || [];
      rows.forEach((row) => unique.set(String(row._dupKey || row.id || JSON.stringify(row)), row));
    });
    return { config, rows: Array.from(unique.values()) };
  });
}

async function fetchHistoryRows(value: string): Promise<HistoryRows[]> {
  const term = historySearchTerm(value);
  if (term.length < 2) return [];
  const key = term.toLowerCase();
  const cached = historySearchCache.get(key);
  if (cached && Date.now() - cached.at < 15_000) return cached.promise;
  const filter = `${encodeURIComponent("_업체명")}=ilike.*${encodeURIComponent(term)}*&limit=500`;
  const promise = Promise.all(HISTORY_SEARCH_TABLES.map(async (config) => ({
    config,
    rows: await selectRows<Record<string, unknown>>(config.table, `select=*&${filter}`).catch(() => []),
  })));
  historySearchCache.set(key, { at: Date.now(), promise });
  return promise;
}

function mergeHistoryHits(hits: VendorHit[]) {
  const merged = new Map<string, VendorHit>();
  hits.forEach((hit) => {
    const key = hit.vendor.trim();
    if (!key) return;
    const current = merged.get(key) || { vendor: key, counts: {}, meta: {} };
    const counts = { ...current.counts };
    Object.entries(hit.counts || {}).forEach(([category, count]) => {
      counts[category] = Math.max(counts[category] || 0, Number(count || 0));
    });
    const meta = { ...current.meta };
    Object.entries(hit.meta || {}).forEach(([category, entry]) => {
      if (!meta[category] || String(entry?.d || "") > String(meta[category]?.d || "")) meta[category] = entry;
    });
    merged.set(key, { vendor: key, counts, meta, matchedBy: current.matchedBy || hit.matchedBy });
  });
  return Array.from(merged.values()).sort((left, right) => left.vendor.localeCompare(right.vendor, "ko"));
}

function hitsFromHistoryRows(results: HistoryRows[]): VendorHit[] {
  const hits = new Map<string, VendorHit>();
  results.forEach(({ config, rows }) => rows.forEach((row) => {
    const vendor = String(row._업체명 || row.업체명 || row.상호명 || "").trim();
    if (!vendor) return;
    const current = hits.get(vendor) || { vendor, counts: {}, meta: {} };
    current.counts[config.category] = (current.counts[config.category] || 0) + 1;
    const date = String(row[config.dateField] || row.created_at || "").slice(0, 10);
    const region = String(row[config.regionField] || "").trim();
    const previous = current.meta[config.category];
    if (!previous || date >= String(previous.d || "")) current.meta[config.category] = { d: date, r: region };
    hits.set(vendor, current);
  }));
  return Array.from(hits.values());
}

// 통합이력 상세: 카테고리별 레코드 배열 (백엔드 getVendorDetailFromIndex 출력)
export type DetailResp = { vendor: string; error?: string } & Record<
  string,
  Array<Record<string, unknown>> | string | undefined
>;

// ── 검색: GAS _idx_* 시트 → Supabase RPC 직접 조회로 이전 (통합시트 은퇴) ──

// 거래처 검색(접두) → Supabase search_vendors RPC → {results, total}
type RpcHit = { vendor: string; counts: Record<string, number>; meta: VendorMeta; total: number };

async function searchMachineIdentity(query: string): Promise<VendorHit[]> {
  const encoded = encodeURIComponent(query);
  const serial = encodeURIComponent("시리얼넘버");
  const asset = encodeURIComponent("자산기번");
  const filter = `select=*&or=(${serial}.ilike.*${encoded}*,${asset}.ilike.*${encoded}*)&limit=100`;
  const sources = await Promise.all([
    selectRows<Record<string, unknown>>("jeomgeom", filter).then((rows) => ({ category: "점검", rows })).catch(() => ({ category: "점검", rows: [] })),
    selectRows<Record<string, unknown>>("as_records", filter).then((rows) => ({ category: "AS", rows })).catch(() => ({ category: "AS", rows: [] })),
  ]);
  const hits = new Map<string, VendorHit>();
  sources.forEach(({ category, rows }) => rows.forEach((row) => {
    const vendor = String(row._업체명 || row.업체명 || row.상호명 || "").trim();
    if (!vendor) return;
    const current = hits.get(vendor) || { vendor, counts: {}, meta: {} };
    current.counts[category] = (current.counts[category] || 0) + 1;
    const date = String(row.작성일 || row.created_at || "").slice(0, 10);
    const previous = current.meta[category];
    if (!previous || date >= String(previous.d || "")) {
      current.meta[category] = {
        d: date,
        r: String(row.지역 || ""),
        model: String(row.모델명 || ""),
        author: String(row.작성자 || ""),
        count: 1,
      };
    }
    const serialValue = String(row.시리얼넘버 || "").toLowerCase();
    const assetValue = String(row.자산기번 || "").toLowerCase();
    const needle = query.toLowerCase();
    current.matchedBy = serialValue.includes(needle) ? "시리얼 일치" : assetValue.includes(needle) ? "자산기번 일치" : "기기번호 일치";
    hits.set(vendor, current);
  }));
  return Array.from(hits.values());
}

// 임대리스트(vendor_info) 검색 — 서비스접수 자동채움용. 업체명은 즉시, 자산번호/순번은 컬럼 승격 후 동작.
export type LeaseHit = Record<string, string>;
export async function searchLeaseList(q: string): Promise<LeaseHit[]> {
  const kw = String(q || "").trim();
  if (!kw) return [];
  const enc = encodeURIComponent;
  const vendorCol = enc("_업체명");
  const assetCol = enc("자산번호");
  const seqCol = enc("순번");
  const seen = new Set<string>();
  const out: LeaseHit[] = [];
  const push = (rows: Array<{ id?: number; _업체명?: string; _raw?: unknown }>) => {
    for (const r of rows) {
      const raw = (r._raw && typeof r._raw === "object" ? r._raw : {}) as Record<string, unknown>;
      const dedup = String(r.id ?? `${r._업체명}-${raw["순"]}`);
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      const normalized: LeaseHit = { _업체명: String(r._업체명 || "") };
      for (const [k, v] of Object.entries(raw)) normalized[k] = v == null ? "" : String(v);
      out.push(normalized);
    }
  };
  const run = async (query: string) => {
    try { return await selectRows<{ id?: number; _업체명?: string; _raw?: unknown }>("vendor_info", query); }
    catch { return []; }
  };
  const serialCol = enc("기번");
  push(await run(`select=id,${vendorCol},_raw&${vendorCol}=ilike.*${enc(kw)}*&limit=30`));
  if (out.length < 30) push(await run(`select=id,${vendorCol},_raw&${assetCol}=ilike.*${enc(kw)}*&limit=30`));
  if (kw.length >= 4 && out.length < 30) push(await run(`select=id,${vendorCol},_raw&${serialCol}=ilike.*${enc(kw)}*&limit=30`));
  if (/^\d+$/.test(kw) && out.length < 30) push(await run(`select=id,${vendorCol},_raw&${seqCol}=eq.${enc(kw)}&limit=30`));
  return out.slice(0, 30);
}

// 검색 후보 업체들의 최신 기번/자산기번 일괄 조회 — 거래처검색 드롭다운 표시용.
export type VendorIdent = { serial: string; asset: string; deviceMore: number };
export async function getVendorIdentifiers(vendors: string[]): Promise<Record<string, VendorIdent>> {
  const list = Array.from(new Set(vendors.map((v) => v.trim()).filter(Boolean))).slice(0, 30);
  if (!list.length) return {};
  const quoted = `(${list.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(",")})`;
  const filter = `${encodeURIComponent("_업체명")}=in.${encodeURIComponent(quoted)}`;
  const sel = encodeURIComponent("_업체명,시리얼넘버,자산기번,작성일");
  const run = async (table: string) => {
    try { return await selectRows<Record<string, unknown>>(table, `select=${sel}&${filter}&order=${encodeURIComponent("작성일")}.desc&limit=300`); }
    catch { return [] as Record<string, unknown>[]; }
  };
  const rows = [...await run("jeomgeom"), ...await run("as_records")]
    .sort((a, b) => String(b["작성일"] || "").localeCompare(String(a["작성일"] || "")));
  const out: Record<string, VendorIdent> = {};
  const serialSets = new Map<string, Set<string>>();
  for (const r of rows) {
    const v = String(r["_업체명"] || "").trim();
    if (!v) continue;
    const serial = String(r["시리얼넘버"] || "").trim();
    const asset = String(r["자산기번"] || "").trim();
    const cur = out[v] || { serial: "", asset: "", deviceMore: 0 };
    if (!cur.serial && serial) cur.serial = serial;
    if (!cur.asset && asset) cur.asset = asset;
    out[v] = cur;
    if (serial) {
      const set = serialSets.get(v) || new Set<string>();
      set.add(serial.toLowerCase());
      serialSets.set(v, set);
    }
  }
  for (const [v, set] of serialSets) if (out[v]) out[v].deviceMore = Math.max(0, set.size - 1);
  return out;
}

// 같은 업체의 임대중 기기 요약 — 임대종료/소송 행은 제외하고 품목별로 나눠 오선택을 막는다.
export type LeaseDeviceSummary = { active: number; items: Array<[string, number]> };
export async function getLeaseDeviceSummary(vendor: string): Promise<LeaseDeviceSummary> {
  const v = String(vendor || "").trim();
  if (!v) return { active: 0, items: [] };
  try {
    const rows = await selectRows<{ 임대여부?: string; _raw?: Record<string, unknown> }>(
      "vendor_info",
      `select=${encodeURIComponent("임대여부,_raw")}&${encodeURIComponent("_업체명")}=eq.${encodeURIComponent(v)}&limit=100`,
    );
    const active = rows.filter((r) => String(r["임대여부"] || "").trim() === "임대중");
    const counts = new Map<string, number>();
    for (const r of active) {
      const raw = (r._raw && typeof r._raw === "object" ? r._raw : {}) as Record<string, unknown>;
      const item = String(raw["품목"] || raw["기종"] || "기타").trim() || "기타";
      counts.set(item, (counts.get(item) || 0) + 1);
    }
    return { active: active.length, items: Array.from(counts.entries()).sort((a, b) => b[1] - a[1]) };
  } catch {
    return { active: 0, items: [] };
  }
}

// 워킨맵 이름 조회 — 카톡 보고용 업체명(예: "17N주식회사 무암 (Mooam)-분기마감")을 그대로 쓰기 위함.
function coreVendorKey(name: string) {
  return String(name || "").replace(/\(.*?\)/g, "").replace(/㈜|주식회사|유한회사|\(주\)/g, "").replace(/[^0-9a-z가-힣]/gi, "").toLowerCase();
}
export async function findWorkinMapName(vendor: string): Promise<string> {
  const core = coreVendorKey(vendor);
  if (core.length < 2) return "";
  const nameCol = encodeURIComponent("name");
  const probe = core.slice(0, 4);
  try {
    const rows = await selectRows<{ name?: string }>("workin_map_places", `select=name&${nameCol}=ilike.*${encodeURIComponent(probe)}*&limit=30`);
    const hit = rows.find((r) => {
      const k = coreVendorKey(r.name || "");
      return k.includes(core) || core.includes(k);
    });
    return hit?.name || "";
  } catch {
    return "";
  }
}

// 서비스접수 기록 (service_receptions) — 리스트·통계·날짜별 조회의 원본.
export type ServiceReceptionRow = {
  id: string; created_at: string; receipt_date: string; author: string;
  route: string; type: string; vendor: string; asset_no: string; serial: string;
  model: string; region: string; title: string; symptom: string; paid: string;
  notes: string; report_text: string; status: string; sent_room: string;
  grade: string; receiver_name: string; receiver_phone: string; keyman_info: string;
  lease_no: string; address: string; deleted?: boolean; photos?: string[] | null; address_changed?: boolean;
  address_resolved_at?: string | null; address_resolved_by?: string;
  field?: string; first_no?: string; cust_kind?: string; remote_meta?: Record<string, string>; sheet_row?: number | null;
  completed_at?: string | null;
  completed_by?: string;
};
export async function saveServiceReception(row: Omit<ServiceReceptionRow, "id" | "created_at" | "receipt_date">): Promise<string> {
  const saved = await insertRowReturning<{ id: string }>("service_receptions", row);
  return saved?.id || "";
}
export async function getServiceReceptions(start: string, end: string): Promise<ServiceReceptionRow[]> {
  const base = `select=*&receipt_date=gte.${start}&receipt_date=lte.${end}&order=created_at.desc,id.desc`;
  try {
    return await selectRows<ServiceReceptionRow>("service_receptions", `${base}&deleted=eq.false`);
  } catch {
    return selectRows<ServiceReceptionRow>("service_receptions", base); // deleted 컬럼 SQL 실행 전 호환
  }
}
export async function getServiceReceptionById(id: string): Promise<ServiceReceptionRow | null> {
  const rows = await selectRows<ServiceReceptionRow>("service_receptions", `id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
  return rows[0] || null;
}

export async function setServiceReceptionStatus(id: string, status: string, done?: { at: string | null; by: string }): Promise<void> {
  await updateRows("service_receptions", `id=eq.${encodeURIComponent(id)}`, { status, ...(done ? { completed_at: done.at, completed_by: done.by } : {}) });
}
export async function updateServiceReception(id: string, patch: Partial<Pick<ServiceReceptionRow, "status" | "sent_room" | "deleted" | "address_changed" | "address_resolved_at" | "address_resolved_by" | "type" | "remote_meta" | "sheet_row">>): Promise<void> {
  await updateRows("service_receptions", `id=eq.${encodeURIComponent(id)}`, patch);
}

// 서비스접수 보고 양식 → 카톡 전송. IT AS는 PC/IT방, 복합기 AS는 지역 AS방. TEST_MODE면 테스트방.
export async function sendServiceReception(kind: "IT" | "AS", region: string, text: string): Promise<SaveResp> {
  try {
    if (!text.trim()) return { ok: false, error: "전송할 양식이 없습니다." };
    const cfg = await getConfig();
    const testRoom = cfg.TEST_ROOM || "테스트 전용방";
    const testMode = isTestModeValue(cfg.TEST_MODE);
    let room = testRoom;
    if (!testMode) {
      const map = await getRoomMap();
      if (kind === "IT") {
        room = map["IT통합|*"] || map["PC확장성|*"] || FIXED_ROOM.pcIt;
      } else {
        const mapped = map[`AS|${normRegion(region)}`];
        // 방 매핑이 없는 지역(지방 등)을 테스트방으로 조용히 보내고 '전송완료'로 남기면 접수가 누락된다 — 차단.
        if (!mapped) return { ok: false, error: `지역(${region || "미지정"})의 AS방 매핑이 없어 전송할 수 없습니다. 복사해서 직접 게시해 주세요.` };
        room = mapped;
      }
    }
    await enqueueOutbox(room, text);
    return { ok: true, message: `게시 대기: ${room}`, testMode };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "네트워크 오류" };
  }
}

// AS 접수이력. 시리얼/자산기번 일치(serialMatch)를 우선 판별하고, 업체명은 법인표기·부서명 변형에
// 대응하도록 핵심어(coreVendorKey)로 넓게 찾은 뒤 클라이언트에서 거른다.
export type AsHistoryEntry = { date: string; content: string; serialMatch: boolean; serial: string; asset: string; model: string };

export async function getAsHistory(vendor: string, serial: string, assetNo = ""): Promise<AsHistoryEntry[]> {
  const dateCol = encodeURIComponent("작성일");
  const run = async (col: string, val: string) => {
    if (!val.trim()) return [] as Record<string, unknown>[];
    try {
      return await selectRows<Record<string, unknown>>("as_records", `select=*&${encodeURIComponent(col)}=ilike.*${encodeURIComponent(val.trim())}*&order=${dateCol}.desc&limit=60`);
    } catch {
      return [] as Record<string, unknown>[];
    }
  };
  const core = coreVendorKey(vendor);
  const probe = core.slice(0, 4);
  const vendorRows = probe.length >= 2
    ? (await run("_업체명", probe)).filter((r) => {
        const key = coreVendorKey(String(r["_업체명"] || r["업체명"] || ""));
        return key.includes(core) || core.includes(key);
      })
    : [];
  const idRows = [
    ...await run("시리얼넘버", serial), ...await run("자산기번", serial),
    ...await run("시리얼넘버", assetNo), ...await run("자산기번", assetNo),
  ];
  const leaseIds = [normId(serial), normId(assetNo)].filter((v) => v.length >= 3);
  const seen = new Set<string>();
  const out: AsHistoryEntry[] = [];
  for (const r of [...idRows, ...vendorRows]) {
    const content = String(r["내용"] || "").trim();
    if (!content) continue;
    const date = String(r["작성일"] || "").slice(0, 10);
    const key = `${date}|${content.slice(0, 24)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rowIds = [normId(String(r["시리얼넘버"] || "")), normId(String(r["자산기번"] || ""))].filter((v) => v.length >= 3);
    const serialMatch = leaseIds.some((a) => rowIds.some((b) => a === b || a.includes(b) || b.includes(a)));
    out.push({
      date, content, serialMatch,
      serial: String(r["시리얼넘버"] || "").trim(),
      asset: String(r["자산기번"] || "").trim(),
      model: String(r["모델명"] || "").trim(),
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);
}

// 자가사용내역 대체: 최근 점검 2회(전방문·전전방문). 선택한 기기(시리얼/자산기번) 기록을 우선하고,
// 없으면 업체 기록으로 폴백(deviceMatch=false → 다른 기기 기록일 수 있음을 표기).
export type InspectionSnapshot = { date: string; counts: string; toner: string; spare: string; waste: string; serial: string; model: string; asset: string };
export type RecentInspections = { snapshots: InspectionSnapshot[]; deviceMatch: boolean };
export async function getRecentInspections(vendor: string, serial = "", assetNo = ""): Promise<RecentInspections> {
  const core = coreVendorKey(vendor);
  const probe = core.slice(0, 4);
  if (probe.length < 2) return { snapshots: [], deviceMatch: false };
  const dateCol = encodeURIComponent("작성일");
  try {
    const rows = await selectRows<Record<string, unknown>>("jeomgeom", `select=${encodeURIComponent("작성일,_업체명,업체명,매수,토너잔량,여분,폐통,시리얼넘버,자산기번,모델명")}&${encodeURIComponent("_업체명")}=ilike.*${encodeURIComponent(probe)}*&order=${dateCol}.desc&limit=60`);
    const vendorRows = rows.filter((r) => {
      const key = coreVendorKey(String(r["_업체명"] || r["업체명"] || ""));
      return key.includes(core) || core.includes(key);
    });
    const leaseIds = [normId(serial), normId(assetNo)].filter((v) => v.length >= 3);
    const deviceRows = leaseIds.length ? vendorRows.filter((r) => {
      const ids = [normId(String(r["시리얼넘버"] || "")), normId(String(r["자산기번"] || ""))].filter((v) => v.length >= 3);
      return leaseIds.some((a) => ids.some((b) => a === b || a.includes(b) || b.includes(a)));
    }) : [];
    const chosen = deviceRows.length ? deviceRows : vendorRows;
    const snapshots = chosen
      .map((r) => ({
        date: String(r["작성일"] || "").slice(0, 10),
        counts: String(r["매수"] || "").trim(),
        toner: String(r["토너잔량"] || "").trim(),
        spare: String(r["여분"] || "").trim(),
        waste: String(r["폐통"] || "").trim(),
        serial: String(r["시리얼넘버"] || "").trim(),
        model: String(r["모델명"] || "").trim(),
        asset: String(r["자산기번"] || "").trim(),
      }))
      .filter((s) => s.date)
      .slice(0, 2);
    return { snapshots, deviceMatch: deviceRows.length > 0 };
  } catch {
    return { snapshots: [], deviceMatch: false };
  }
}

export async function searchVendors(q: string): Promise<SearchResp> {
  const query = String(q || "").trim();
  if (query.length < 1) return { results: [], total: 0 };
  try {
    // RPC가 일시적으로 실패한 것을 "기록 없음"으로 착각하지 않도록 오류를 따로 전달한다
    let rpcError = "";
    const [rows, machineHits] = await Promise.all([
      rpc<RpcHit[]>("search_vendors", { q: query }).catch((e) => { rpcError = (e as Error).message || "검색 연결 실패"; return [] as RpcHit[]; }),
      searchMachineIdentity(query),
    ]);
    const indexed: VendorHit[] = rows.map((r) => ({
      vendor: r.vendor,
      counts: r.counts || {},
      meta: r.meta || {},
    }));
    const results = mergeHistoryHits([...indexed, ...machineHits]);
    return { results, total: results.length, error: rpcError || undefined };
  } catch (e) {
    return { results: [], total: 0, error: (e as Error).message };
  }
}

// 거래처 상세(전 카테고리) → Supabase vendor_detail RPC → {vendor, [카테고리]: 레코드[]}
type RpcDetailRow = { tab: string; rows: Array<Record<string, unknown>> };
export async function getVendorDetail(vendor: string): Promise<DetailResp> {
  const v = String(vendor || "").trim();
  if (!v) return { vendor: "" };
  try {
    const rows = await rpc<RpcDetailRow[]>("vendor_detail", { v });
    const out: DetailResp = { vendor: v };
    for (const r of rows) (out as Record<string, unknown>)[r.tab] = r.rows || [];
    return out;
  } catch (e) {
    return { vendor: v, error: (e as Error).message };
  }
}

// 통합이력 전용 포함 검색. RPC 인덱스가 누락돼도 원본 이력 테이블에서 후보를 복구한다.
export async function searchVendorHistoryCandidates(q: string): Promise<SearchResp> {
  const query = String(q || "").trim();
  if (query.length < 2) return { results: [], total: 0 };
  const terms = historySearchTerms(query);
  const [indexed, sourceGroups] = await Promise.all([Promise.all(terms.map(searchVendors)), Promise.all(terms.map(fetchHistoryRows))]);
  const sourceRows = mergeHistoryRows(sourceGroups);
  const results = mergeHistoryHits([...indexed.flatMap((result) => result.results || []), ...hitsFromHistoryRows(sourceRows)]);
  return { results, total: results.length, error: indexed.find((result) => result.error)?.error };
}

export async function getVendorHistoryDetail(q: string): Promise<{ detail: DetailResp; candidates: VendorHit[] }> {
  const query = String(q || "").trim();
  if (!query) return { detail: { vendor: "" }, candidates: [] };
  const terms = historySearchTerms(query);
  const [indexed, sourceGroups] = await Promise.all([
    Promise.all(terms.map(searchVendors)),
    Promise.all(terms.map(fetchHistoryRows)),
  ]);
  const sourceRows = mergeHistoryRows(sourceGroups);
  const allCandidates = mergeHistoryHits([...indexed.flatMap((result) => result.results || []), ...hitsFromHistoryRows(sourceRows)]);
  const candidates = allCandidates.filter((candidate) => Object.entries(candidate.counts || {})
    .some(([category, count]) => category !== "임대현황표" && Number(count || 0) > 0));
  const exactVendors = candidates.length ? candidates.map((candidate) => candidate.vendor) : terms;
  const indexedDetails = await Promise.all(Array.from(new Set(exactVendors)).map(getVendorDetail));
  const detail: DetailResp = { vendor: query };
  HISTORY_SEARCH_TABLES.forEach((config) => {
    const directRows = sourceRows.find((result) => result.config.table === config.table)?.rows || [];
    const indexedRows = indexedDetails.flatMap((indexedDetail) => Array.isArray(indexedDetail[config.category])
      ? indexedDetail[config.category] as Array<Record<string, unknown>>
      : []);
    const unique = new Map<string, Record<string, unknown>>();
    // 원본 테이블 조회가 가능하면 그 결과를 기준으로 삼아 RPC 상세와의 이중 집계를 막는다.
    (directRows.length ? directRows : indexedRows).forEach((row) => {
      const key = String(row._dupKey || row.id || JSON.stringify(row));
      unique.set(key, row);
    });
    detail[config.category] = Array.from(unique.values());
  });
  // 원본 테이블을 모르는 업체정보 등은 기존 상세 RPC 결과를 그대로 보존한다.
  indexedDetails.forEach((indexedDetail) => Object.entries(indexedDetail).forEach(([category, rows]) => {
    if (category === "vendor" || category === "error" || !Array.isArray(rows)) return;
    if (HISTORY_SEARCH_TABLES.some((config) => config.category === category)) return;
    const existing = Array.isArray(detail[category]) ? detail[category] as Array<Record<string, unknown>> : [];
    const unique = new Map<string, Record<string, unknown>>();
    [...existing, ...rows].forEach((row) => unique.set(String(row._dupKey || row.id || JSON.stringify(row)), row));
    detail[category] = Array.from(unique.values());
  }));
  return { detail, candidates };
}

// 점검/AS 최근 양식(원문 재사용) → jeomgeom/as_records 직접 조회
const VKEY = encodeURIComponent("_업체명");
function vendorEq(v: string): string {
  return `${VKEY}=eq.${encodeURIComponent(v)}`;
}
function modelLineCount(text: string): number {
  const m = text.match(/모델명/g);
  return m ? m.length : 1;
}
function toForm(r: Record<string, unknown>, gubun: Gubun): InspForm {
  const text = String(r["_원문"] ?? "");
  return {
    gubun,
    date: String(r["작성일"] ?? ""),
    model: String(r["모델명"] ?? ""),
    serial: String(r["시리얼넘버"] ?? "").trim(),
    asset: String(r["자산기번"] ?? "").trim(),
    content: String(r["내용"] ?? "").trim(),
    handled: String(r["처리내용"] ?? "").trim(),
    author: String(r["작성자"] ?? ""),
    region: String(r["지역"] ?? ""),
    count: text ? modelLineCount(text) : 1,
    text,
    source: gubun,
  };
}
// ── 청정기 거래처검색: 모델명이 청정기 브랜드(블루스카이/샤오미/Xiaomi/mi-air)인 점검기록만 ──
export type AirHit = { vendor: string; model: string; date: string; region: string; author: string; n: number };
export async function searchAircleaner(q: string): Promise<AirHit[]> {
  const query = String(q || "").trim();
  if (query.length < 1) return [];
  const rows = await rpc<Array<{ vendor: string; model: string; dt: string; region: string; author: string; n: number }>>(
    "search_aircleaner", { q: query }
  );
  return rows.map((r) => ({ vendor: r.vendor, model: r.model || "", date: r.dt || "", region: r.region || "", author: r.author || "", n: r.n || 0 }));
}

const AIR_RX = /블루스카이|샤오미|xiaomi|mi[\s-]?air|blue\s?sky/i;
export type AirForm = { date: string; model: string; region: string; author: string; text: string };
export async function getAirForms(vendor: string): Promise<AirForm[]> {
  const v = String(vendor || "").trim();
  if (!v) return [];
  const rows = await selectRows<Record<string, unknown>>("jeomgeom", `select=*&${vendorEq(v)}&order=id.desc&limit=30`);
  return rows
    .filter((r) => AIR_RX.test(String(r["모델명"] ?? "")) || AIR_RX.test(String(r["_원문"] ?? "")))
    .slice(0, 6)
    .map((r) => ({
      date: String(r["작성일"] ?? ""), model: String(r["모델명"] ?? ""),
      region: String(r["지역"] ?? ""), author: String(r["작성자"] ?? ""), text: String(r["_원문"] ?? ""),
    }));
}

export async function getInspForms(vendor: string): Promise<InspFormsResp> {
  const v = String(vendor || "").trim();
  if (!v) return { vendor: "", forms: [] };
  try {
    const [insp, as] = await Promise.all([
      selectRows<Record<string, unknown>>("jeomgeom", `select=*&${vendorEq(v)}&order=id.desc&limit=6`),
      selectRows<Record<string, unknown>>("as_records", `select=*&${vendorEq(v)}&order=id.desc&limit=4`),
    ]);
    const forms: InspForm[] = [
      ...insp.map((r) => toForm(r, "점검")),
      ...as.map((r) => toForm(r, "AS")),
    ];
    return { vendor: v, forms };
  } catch (e) {
    return { vendor: v, forms: [], error: (e as Error).message };
  }
}

// 완성 양식 → 시트 저장 + 카톡 알림 큐 적재 (POST).
// 단순요청(text/plain)이라 프리플라이트 없이 GAS doPost(action=save) 호출.
export type SaveResp = { ok?: boolean; message?: string; error?: string; testMode?: boolean };
export type SavePayload = {
  text: string;            // 완성된 양식 전체 텍스트 (카톡에 게시될 내용)
  vendor?: string;         // 거래처명
  mode?: string;           // 점검/미양식/청정기/삼성노트
  author?: string;         // 작성자
  ts?: string;             // 클라이언트 작성 시각
};
// 작성 시각(ISO) → KST yyyy-MM-dd (작성일 컬럼/ _dupKey 용)
function toKstDate(ts?: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}

export type SendKind = "normal" | "자가" | "부품";
export type SendDestination = "inspection" | "as";

const FIXED_ROOM = {
  logistics: "완료방(납품,철수,교체)",
  pcIt: "PC/IT/피씨/확장성고객등록및영업",
  copierExpansion: "영업확장성미션 : 퍼스트조국진대리, 퍼스트신정훈프로, 퍼스트홍대경프로",
  contactChange: "신)담당자/명의/주소변경등 특이사항",
} as const;

const REGION_ROOMS: Record<string, Record<string, string>> = {
  bulman: {
    A: "신)AB불만고객",
    B: "신)AB불만고객",
    C: "신)CD불만고객방",
    D: "신)CD불만고객방",
  },
  misu: {
    A: "강북A 미수 보증금미입금 보고방",
    B: "강서B 미수 보증금미입금 보고방",
    C: "강남C 미수 보증금 보고방",
    D: "경기D 미수 보증금 미입금보고방",
  },
  "overage-adjust": {
    A: "강북A/초과사용 계약종료체크",
    B: "강서B/초과사용 계약종료체크",
    C: "강남C/초과사용 계약종료체크",
    D: "경기D/초과사용 계약종료체크",
  },
  recontract: {
    A: "강북A/초과사용 계약종료체크",
    B: "강서B/초과사용 계약종료체크",
    C: "강남C/초과사용 계약종료체크",
    D: "경기D/초과사용 계약종료체크",
  },
};

function regionRoom(schemaKey: string, region: string, fallback: string): string {
  const key = normRegion(region);
  return REGION_ROOMS[schemaKey]?.[key] || fallback;
}

// 보낼 방 목록 결정. TEST_MODE면 무조건 테스트방. 자가/부품/AS/점검 모두 단일 방으로 보낸다.
async function resolveRoomsFor(kind: SendKind, region: string, hasAS: boolean): Promise<string[]> {
  const cfg = await getConfig();
  const testRoom = cfg.TEST_ROOM || "테스트 전용방";
  if (isTestModeValue(cfg.TEST_MODE)) return [testRoom];

  const map = await getRoomMap();
  if (kind === "자가") return [map["자가|*"] || "자가(토너 폐통) 여분토너요청방"];
  if (kind === "부품") return [map["부품|*"] || "부품요청"];

  // normal: AS는 AS방만, 그 외는 점검방만.
  const key = normRegion(region);
  const room = map[`${hasAS ? "AS" : "점검"}|${key}`];
  return [room || testRoom];                      // 미지원 지역(E·빈값 등)
}

async function resolveForcedRoom(destination: SendDestination, region: string): Promise<string[]> {
  const cfg = await getConfig();
  const testRoom = cfg.TEST_ROOM || "테스트 전용방";
  if (isTestModeValue(cfg.TEST_MODE)) return [testRoom];
  const map = await getRoomMap();
  const key = normRegion(region);
  const room = map[`${destination === "inspection" ? "점검" : "AS"}|${key}`];
  return [room || testRoom];
}

// 완성 양식 → Supabase 점검/AS 탭 직접 적재 + 발신큐(outbox) 적재 (GAS 미경유).
//  kind: normal=지역 점검방 또는 AS방 단일 전송, 자가=여분토너요청방, 부품=부품요청방.
//  자가/부품은 알림 목적이라 중복(이미 저장)이어도 해당 방으로는 항상 게시한다.
// AS 저장 시 복합기 학습·처리이력(copier_notes)에도 자동 적재 — 실패해도 전송에는 영향 없음.
// source(unique)로 중복 적재를 막는다. 공청기·세단기는 제외.
async function addCopierNoteFromAs(row: Row) {
  try {
    const model = String(row["모델명"] || "").trim();
    const symptom = String(row["내용"] || "").trim();
    const solution = String(row["처리내용"] || "").trim();
    if (!model || solution.length < 4) return;
    if (/샤오미|블루스카이|공기청정|공청|세단기|세절기/.test(model)) return;
    await insertRow("copier_notes", {
      author: String(row["작성자"] || ""),
      brand: inferBrand(model),
      model,
      kind: "처리이력",
      title: (symptom || model).slice(0, 80),
      content: [
        symptom && `증상: ${symptom}`,
        `처리: ${solution}`,
        row["지역"] && `지역: ${row["지역"]}`,
        row["레벨"] && `레벨: ${row["레벨"]}`,
        row["업체명"] && `업체: ${row["업체명"]}`,
      ].filter(Boolean).join("\n"),
      source: `field:${String(row["_dupKey"] || "")}`,
    });
  } catch {
    // 학습 적재 실패는 무시(다음 AS에서 다시 쌓임)
  }
}

export async function sendForm(payload: SavePayload, kind: SendKind = "normal", destination?: SendDestination): Promise<SaveResp> {
  try {
    const text = String(payload.text || "");
    if (!text.trim()) return { ok: false, error: "내용이 비어있습니다." };

    // 목적지 버튼은 카톡방만 고른다. 사용자가 작성한 구분은 그대로 전송한다.
    const sendText = text;
    let built = buildRecords(sendText, toKstDate(payload.ts), payload.author || "", "");
    // 여분/마감/세팅처럼 구분에 점검·AS 문자가 없어도 사용자가 누른 방 기준으로 저장한다.
    if (!built.hasInspect && !built.hasAS && destination) {
      const storageText = sendText.match(/^구분\s*[:：]/m)
        ? sendText.replace(/^구분\s*[:：]\s*(.*)$/m, `구분: ${destination === "inspection" ? "점검" : "AS"}, $1`)
        : `구분: ${destination === "inspection" ? "점검" : "AS"}\n${sendText}`;
      built = buildRecords(storageText, toKstDate(payload.ts), payload.author || "", "");
    }
    if (!built.hasInspect && !built.hasAS) {
      return { ok: false, error: `구분에 점검/AS가 없어 저장 대상이 아닙니다. (mode=${payload.mode || "?"})` };
    }
    if (!built.inspect && !built.as) return { ok: false, error: "업체명을 찾지 못했습니다." };

    let anyNew = false;
    if (built.inspect) {
      const r = await insertRecord("jeomgeom", built.inspect);
      if (r === "new") anyNew = true;
    }
    if (built.as) {
      const r = await insertRecord("as_records", built.as);
      if (r === "new") { anyNew = true; void addCopierNoteFromAs(built.as); }
    }

    const isExtra = kind === "자가" || kind === "부품";
    // 중복(재전송)이어도 카톡은 항상 게시한다 — 1차 시도가 저장 후 카톡 적재에서 실패하면
    // 재전송이 유일한 복구 수단인데, 예전엔 dup이면 건너뛰어 카톡이 영구 누락됐다.
    // (전송 버튼은 sending 가드로 이중클릭이 막혀 있어 의도적 재전송만 이 경로를 탄다.)
    const rooms = destination ? await resolveForcedRoom(destination, built.region) : await resolveRoomsFor(kind, built.region, built.hasAS);
    for (const room of rooms) await enqueueOutbox(room, sendText);

    const dest = rooms.length ? `게시 대기: ${rooms.join(", ")}` : "";
    return {
      ok: true,
      message: isExtra
        ? `${kind} 요청 ${dest}`
        : anyNew ? `저장 완료 — ${dest}` : `이미 저장된 내용(중복) — ${dest}`,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "네트워크 오류" };
  }
}

export type LogisticsFormState = {
  category: string; categoryOther: string; vendor: string; item: string; quantity: string;
  consumableBilling: string; setup: string; emailCounter: string; hanjo: string;
  condition: string; spareToner: string; notes: string;
};

export async function sendLogisticsForm(form: LogisticsFormState, author: string, text: string, ts?: string): Promise<SaveResp> {
  try {
    const vendor = form.vendor.trim();
    if (!vendor) return { ok: false, error: "거래처명을 입력하세요." };
    const date = toKstDate(ts);
    const category = form.category === "기타" ? form.categoryOther.trim() : form.category;
    const row: Record<string, unknown> = {
      "작성일": date, "작성자": author, "구분": category, "거래처명": vendor, "품목": form.item,
      "수량": form.quantity, "소모품(납품/청구여부)": form.consumableBilling, "셋팅여부": form.setup,
      "이메일카운터셋팅완료": form.emailCounter, "한조셋팅완료": form.hanjo,
      "상태체크(내부/외부)": form.condition, "여분토너체크(철수 시)": form.spareToner,
      "특이사항": form.notes, "_업체명": vendor, "_원문": text, "_출처": "웹앱:물류",
      "_dupKey": md5([date, author, category, vendor, form.item, form.quantity, form.notes].join("|")),
    };
    const result = await insertRow("logistics_records", row);
    const cfg = await getConfig();
    const testRoom = cfg.TEST_ROOM || "테스트 전용방";
    const testMode = isTestModeValue(cfg.TEST_MODE);
    let room = testRoom;
    if (!testMode) {
      const map = await getRoomMap(); room = map["물류|*"] || map["납품|*"] || FIXED_ROOM.logistics;
    }
    // 사용자가 명시적으로 전송했으므로 중복 저장이어도 알림은 보낸다.
    await enqueueOutbox(room, text);
    // testMode를 반환해야 호출부(App)의 "!res.testMode" 방문집계 게이트가 동작한다(예전엔 undefined라 항상 통과).
    return { ok: true, message: `${result === "new" ? "저장 완료" : "기존 기록 확인"} — 게시 대기: ${room}`, testMode };
  } catch (e) { return { ok: false, error: (e as Error).message || "네트워크 오류" }; }
}

// 카테고리 폼(불만/재계약/초과조정) → 테이블 저장 + 방 전송. (스키마 기반)
export async function sendCategoryForm(schemaKey: string, form: Record<string, string>, author: string, text: string, ts?: string): Promise<SaveResp> {
  try {
    const s = CATEGORY_SCHEMAS[schemaKey];
    if (!s) return { ok: false, error: "알 수 없는 양식: " + schemaKey };
    const fields = s.sections.flatMap((sec) => sec.fields);
    const companyKey = fields.find((f) => f.fill === "company")?.key;
    const regionKey = fields.find((f) => f.fill === "region")?.key;
    const vendor = String((companyKey && form[companyKey]) || "").trim();
    if (!vendor) return { ok: false, error: "업체명을 입력하세요." };

    const row: Record<string, unknown> = {};
    for (const f of fields) row[f.key] = f.fill === "author" ? author : (form[f.key] || "");
    row["_업체명"] = vendor;
    row["_출처"] = "웹앱:" + s.category;
    row["_원문"] = text;
    row["_dupKey"] = md5([s.category, vendor, author, toKstDate(ts), ...fields.map((f) => form[f.key] || "")].join("|"));

    // 불만: 정식(레거시) 컬럼·날짜도 함께 채워 시트·AI·통합이력 정합성을 맞춘다.
    // (담당자 필드는 "이름 010-0000-0000" 형태라 이름/연락처로 분리한다.)
    if (schemaKey === "bulman") {
      const contact = String(form["담당자"] || "").trim();
      const phone = contact.match(/01[016-9][-\s.]?\d{3,4}[-\s.]?\d{4}/)?.[0] || "";
      const name = contact.replace(phone, "").trim();
      row["날짜"] = toKstDate(ts);
      row["접수/처리"] = form["최종상태"] || "접수";
      row["거래처담당자"] = name || contact;
      row["거래처연락처"] = phone;
      row["불만내용"] = form["불편내용"] || "";
      row["불만항목"] = form["불만정도"] || "";
    }

    let rooms: string[] = [];
    const cfg = await getConfig();
    // 시트 테스트 모드는 외부 시트의 대상만 바꾼다. 웹앱 원본 DB는 항상 저장한다.
    const r = await insertRow(s.table, row);
    const testRoom = cfg.TEST_ROOM || "테스트 전용방";
    if (isTestModeValue(cfg.TEST_MODE)) rooms = [testRoom];
    else {
      const map = await getRoomMap();
      const fallback = map[s.roomKey] || testRoom;
      rooms = [regionRoom(schemaKey, String((regionKey && form[regionKey]) || ""), fallback)];
    }
    if (schemaKey === "bulman") {
      const automation = await queueFieldAutomation({
        category: "complaint",
        author,
        vendor,
        region: String((regionKey && form[regionKey]) || ""),
        room: rooms[0] || "",
        text,
        data: form,
        dupKey: String(row["_dupKey"]),
      });
      if (!automation.holdKakao && isEnabled(cfg.FIELD_KAKAO_SEND_ENABLED)) for (const room of rooms) await enqueueOutbox(room, text);
      return { ok: true, message: `${r === "new" ? "저장 완료" : "기존 기록 확인"} · ${automation.message}`, testMode: automation.testMode };
    }
    for (const room of rooms) await enqueueOutbox(room, text);
    return { ok: true, message: `${r === "new" ? "저장 완료" : "기존 기록 확인"} — 게시 대기: ${rooms.join(", ")}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "네트워크 오류" };
  }
}

// IT통합(PC) 폼 → pc_expansion 저장 + PC방 전송.
export async function sendPcForm(form: PcFormState, author: string, text: string, ts?: string): Promise<SaveResp> {
  try {
    const vendor = String(form.company || "").trim();
    if (!vendor) return { ok: false, error: "업체명을 입력하세요." };
    const date = toKstDate(ts);
    const row: Record<string, unknown> = {
      "날짜": date, "작성자": author, "등급": form.grade,
      "사무/설계/디자인/개발": form.purpose, "세부사양": form.spec, "지역": form.region,
      "업체담당자": form.vendorContact, "연락처": form.contact, "IT담당자": form.itContact,
      "렌탈or구매or유지보수": form.rentalBuyMaint, "지정업체": form.designatedVendor, "지정업체만족도": form.designatedSat,
      "총 인원": form.totalPeople, "인원 추가 설명": form.peopleNote,
      "수량": form.qty, "금액": form.amount, "시기": form.timing, "시기 추가 설명": form.timingNote,
      "어필 OR 추가영업": form.appeal,
      "_업체명": vendor, "_출처": "웹앱:IT통합", "_원문": text,
      "_dupKey": md5([vendor, date, form.spec, form.qty, form.amount, form.timing, form.appeal].join("|")),
    };
    let rooms: string[] = [];
    const cfg = await getConfig();
    // 시트 테스트 중에도 확장성 IT 원본은 Supabase에 남겨야 통합이력·집계가 맞다.
    const r = await insertRow("pc_expansion", row);
    const testRoom = cfg.TEST_ROOM || "테스트 전용방";
    if (isTestModeValue(cfg.TEST_MODE)) rooms = [testRoom];
    else { const map = await getRoomMap(); rooms = [map["IT통합|*"] || map["PC확장성|*"] || FIXED_ROOM.pcIt]; }
    const automation = await queueFieldAutomation({
      category: "expansion_it",
      author,
      vendor,
      region: form.region,
      room: rooms[0] || "",
      text,
      data: form,
      dupKey: String(row["_dupKey"]),
    });
    if (!automation.holdKakao && isEnabled(cfg.FIELD_KAKAO_SEND_ENABLED)) for (const room of rooms) await enqueueOutbox(room, text);
    return { ok: true, message: `${r === "new" ? "저장 완료" : "기존 기록 확인"} · ${automation.message}`, testMode: automation.testMode };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "네트워크 오류" };
  }
}

// 칭찬 접수 → DB통합시트 '칭찬' 탭 자동 기입 (field_sheet_sync_jobs 경유, 카톡 전송 없음)
export type PraiseFormState = { date: string; grade: string; company: string; manager: string; contact: string; phone: string; reason: string; short: string };

export async function sendPraiseForm(form: PraiseFormState, author: string): Promise<SaveResp> {
  try {
    const vendor = String(form.company || "").trim();
    if (!author.trim()) return { ok: false, error: "작성자를 먼저 선택하세요." };
    if (!vendor) return { ok: false, error: "거래처명을 입력하세요." };
    const reason = String(form.reason || "").trim();
    if (!reason) return { ok: false, error: "칭찬이유를 선택하거나 입력하세요." };
    const data = {
      date: form.date, grade: form.grade, company: vendor, manager: form.manager.trim(),
      contact: form.contact.trim(), phone: form.phone.trim(), reason, short: String(form.short || reason).trim(),
    };
    const sourceText = [`[칭찬] ${vendor}`, `날짜: ${form.date}`, `직원: ${author}`, data.manager && `담당자: ${data.manager}`, `칭찬이유: ${reason}`].filter(Boolean).join("\n");
    const id = crypto.randomUUID();
    const inserted = await enqueueFieldSheetSyncJob({
      id, category: "praise", author: author.trim(), vendor, sourceText,
      payload: { data },
      dupKey: md5(["praise", form.date, author, vendor, reason].join("|")),
    });
    if (inserted === "dup") return { ok: true, message: "같은 내용의 칭찬이 이미 접수돼 있어요." };
    const cfg = await getConfig().catch(() => ({} as Record<string, string>));
    if (!isEnabled(cfg.FIELD_SHEET_SYNC_ENABLED)) return { ok: true, message: "접수 완료 · 시트 동기화 설정이 꺼져 있어 대기 중입니다." };
    try {
      const result = await invokeEdgeFunction<{ status?: string; row?: number }>("field-sheet-sync", { jobId: id });
      return { ok: true, message: result.status === "synced" ? `칭찬 시트 ${result.row ? `${result.row}행 ` : ""}기록 완료` : "접수 완료 · 시트 반영 대기" };
    } catch {
      return { ok: true, message: "접수 완료 · 시트 반영은 잠시 후 다시 시도해 주세요." };
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// 서비스접수(복합기·기존 거래처) → 접수 시트 자동 기입.
// 퍼스트순(F열)만 정확하면 시트 함수가 업체명·임대정보 등을 자동으로 채운다.
export type ReceptionSheetInput = {
  author: string; vendor: string; firstNo: string; route: string; field: string;
  paid: string; receiverName: string; receiverPhone: string; title: string; symptom: string;
  leaseFix?: string;   // 임대리스트 헤더명→값 JSON — 자동 입력값(수정 포함)을 시트에 값으로 기입
};

export async function sendReceptionCopierSheetJob(input: ReceptionSheetInput, extra?: Record<string, string>): Promise<{ message: string; row: number | null }> {
  const id = crypto.randomUUID();
  await enqueueFieldSheetSyncJob({
    id, category: extra ? "reception_copier_new" : "reception_copier", author: input.author.trim(), vendor: input.vendor.trim(),
    sourceText: "", payload: { data: { ...input, ...(extra || {}) } }, dupKey: id,
  });
  const cfg = await getConfig().catch(() => ({} as Record<string, string>));
  if (!isEnabled(cfg.FIELD_SHEET_SYNC_ENABLED)) return { message: "시트 동기화 설정 꺼짐", row: null };
  try {
    const result = await invokeEdgeFunction<{ status?: string; row?: number }>("field-sheet-sync", { jobId: id });
    if (result.status !== "synced") return { message: "접수시트 반영 대기", row: null };
    return { message: `접수시트 ${result.row ? `${result.row}행 ` : ""}기입`, row: result.row ?? null };
  } catch {
    return { message: "접수시트 반영 재시도 대기", row: null };
  }
}

// 복합기 AS 완료 → 접수 시트 BD열(처리완료)에 행 갱신으로 기입. 퍼스트순으로 행 검증.
/** 처리값 원자 병합 — 동시 저장 시 상대 필드를 지우지 않는다 (reception-handling-merge.sql) */
export async function mergeReceptionHandling(id: string, meta: Record<string, string>, status?: string): Promise<void> {
  await rpc<null>("merge_reception_handling", { p_id: id, p_meta: meta, ...(status ? { p_status: status } : {}) });
}

export async function sendReceptionCopierCompleteJob(input: { author: string; vendor: string; firstNo: string; sheetRow: number | null; doneText: string }): Promise<void> {
  const id = crypto.randomUUID();
  if (!input.sheetRow && !input.firstNo.trim()) return; // 갱신 대상 특정 불가 — 잡을 만들어봤자 실패만 쌓인다
  // 갱신 전용: 행번호 검증이 실패하면 퍼스트순으로 아래→위 검색해 갱신하고,
  // 그래도 못 찾으면 실패로 끝낸다 — 어떤 경우에도 새 행(유령 행)을 만들지 않는다
  const target = {
    ...(input.sheetRow ? { _updateRow: String(input.sheetRow), _updateKeyHeader: "퍼스트순", _updateKeyValue: input.firstNo } : {}),
    _updateOnly: "1",
    ...(input.firstNo.trim() ? { _findKeyHeader: "퍼스트순", _findKeyValue: input.firstNo } : {}),
  };
  await enqueueFieldSheetSyncJob({
    id, category: "reception_copier", author: input.author.trim(), vendor: input.vendor.trim(), sourceText: "",
    payload: { data: { firstNo: input.firstNo, complete: input.doneText, ...target } },
    dupKey: id,
  });
  const cfg = await getConfig().catch(() => ({} as Record<string, string>));
  if (!isEnabled(cfg.FIELD_SHEET_SYNC_ENABLED)) return;
  await invokeEdgeFunction("field-sheet-sync", { jobId: id }).catch(() => { /* 워커가 재시도 */ });
}

// 서비스접수(원격·IT) → 접수 시트 '원격' 탭 기입. 순(M)만 정확하면 N~T 등은 시트 함수가 채운다.
export type RemoteReceptionSheetInput = {
  author: string; vendor: string; leaseNo: string; route: string; start: string; end: string;
  result: string; handler: string; hanjo: string; contact: string; symptom: string;
  extraCount: string; handled: string; linked: string;
  receiptDate?: string; receiptTime?: string; receiptAuthor?: string;  // 접수 당시 값 (처리 단계 갱신 때도 유지)
  // 신규 거래처(순번 없음) 직접 기입분 — 기존 접수는 보내지 않아 시트 수식이 유지된다
  company?: string; grade?: string; misuMonths?: string; notes?: string; region?: string;
  dueDate?: string; series?: string; brand?: string; assetNo?: string; serialNo?: string;
};

// updateRow를 주면 접수 때 만든 그 행을 갱신한다 (처리 결과 보완). 없으면 새 행 추가.
export async function sendReceptionRemoteSheetJob(input: RemoteReceptionSheetInput, updateRow?: number | null, opts?: { updateOnly?: boolean }): Promise<{ message: string; row: number | null }> {
  const id = crypto.randomUUID();
  const data: Record<string, string> = { ...input };
  if (updateRow) {
    data["_updateRow"] = String(updateRow);
    if (input.leaseNo) {
      data["_updateKeyHeader"] = "순";          // 행이 밀렸는지 검증할 키 열
      data["_updateKeyColumn"] = "13";         // 원격 탭은 "순" 헤더가 A·M열에 중복 — M열로 고정
      data["_updateKeyValue"] = input.leaseNo;
    } else {
      data["_updateKeyHeader"] = "상호";        // 신규(순번 없음)는 상호로 검증
      data["_updateKeyValue"] = input.vendor;
    }
  }
  if (opts?.updateOnly) {
    // 처리 갱신: 행번호가 없거나 검증에 실패해도 절대 새 행을 만들지 않는다.
    // 순번(없으면 상호)으로 아래→위 검색해 가장 최근 행을 갱신 — 못 찾으면 실패(재시도 대기).
    data["_updateOnly"] = "1";
    if (input.leaseNo) { data["_findKeyHeader"] = "순"; data["_findKeyColumn"] = "13"; data["_findKeyValue"] = input.leaseNo; }
    else { data["_findKeyHeader"] = "상호"; data["_findKeyValue"] = input.vendor; }
  }
  await enqueueFieldSheetSyncJob({
    id, category: "reception_remote", author: input.author.trim(), vendor: input.vendor.trim(),
    sourceText: "", payload: { data }, dupKey: id,
  });
  const cfg = await getConfig().catch(() => ({} as Record<string, string>));
  if (!isEnabled(cfg.FIELD_SHEET_SYNC_ENABLED)) return { message: "시트 동기화 설정 꺼짐", row: null };
  try {
    const result = await invokeEdgeFunction<{ status?: string; row?: number }>("field-sheet-sync", { jobId: id });
    if (result.status !== "synced") return { message: "원격시트 반영 대기", row: null };
    return { message: `원격시트 ${result.row ? `${result.row}행 ` : ""}${updateRow ? "갱신" : "기입"}`, row: result.row ?? null };
  } catch {
    return { message: "원격시트 반영 재시도 대기", row: null };
  }
}

function isEnabled(value: unknown): boolean {
  return String(value || "").toLowerCase() === "true";
}

async function queueFieldAutomation(input: {
  category: FieldSheetSyncCategory;
  author: string;
  vendor: string;
  region?: string;
  room: string;
  text: string;
  data: Record<string, unknown>;
  dupKey: string;
}): Promise<{ message: string; testMode: boolean; holdKakao?: boolean }> {
  const id = crypto.randomUUID();
  let job: "new" | "dup";
  try {
    job = await enqueueFieldSheetSyncJob({
      id,
      category: input.category,
      author: input.author,
      vendor: input.vendor,
      region: input.region,
      room: input.room,
      sourceText: input.text,
      payload: { data: input.data },
      dupKey: input.dupKey,
    });
  } catch {
    // SQL 배포 전에도 야간 카카오 오발송이 일어나지 않도록 전송은 보류한다.
    // holdKakao를 반환해 호출부가 실제로 enqueueOutbox를 건너뛰게 한다(문구만 보류이던 버그 수정).
    return { message: "자동화 설정 전 · 카카오 전송 보류", testMode: false, holdKakao: true };
  }
  const cfg = await getConfig();
  const testMode = isEnabled(cfg.FIELD_SHEET_TEST_MODE);
  if (job === "dup") return { message: "기존 자동화 기록 확인", testMode };

  let sheetMessage = "시트 동기화 대기";
  if (isEnabled(cfg.FIELD_SHEET_SYNC_ENABLED)) {
    try {
      const result = await invokeEdgeFunction<{ status?: string; row?: number }>("field-sheet-sync", { jobId: id });
      sheetMessage = result.status === "synced" ? `시트 ${result.row ? `${result.row}행` : "저장"} 완료` : "시트 동기화 보류";
    } catch {
      sheetMessage = "시트 재시도 대기";
    }
  }
  return { message: `${sheetMessage} · ${isEnabled(cfg.FIELD_KAKAO_SEND_ENABLED) ? "카카오 전송 설정됨" : "카카오 전송 보류"}`, testMode };
}

// 복합기(기타) 확장성 폼 → 복합기 확장성 저장 + 확장성 방 전송.
export async function sendCopierExpansionForm(form: CopierExpansionFormState, author: string, text: string, ts?: string): Promise<SaveResp> {
  try {
    const vendor = String(form.company || "").trim();
    if (!vendor) return { ok: false, error: "상호명을 입력하세요." };
    const date = toKstDate(ts);
    const row: Record<string, unknown> = {
      "등록일": date,
      "등록자": form.registrant || author,
      "전략영업담당자": form.salesOwner,
      "상호명": form.company,
      "업종및인원매출": form.industryPeopleRevenue,
      "실제미팅주소": form.meetingAddress,
      "프로젝트진행상황": form.projectStatus,
      "성함및직함": form.keymanNameTitle,
      "연락처": form.contact,
      "의사결정파급력": form.decisionPower,
      "개인히스토리": form.personalHistory,
      "품목원문": form.itemRaw,
      "예상발주금액만원": form.expectedAmount,
      "예상발주시기": form.expectedOrderMonth,
      "계약종료예정일": form.contractEndDate,
      "특이사항미팅내용": form.notes,
      "관리등급": form.grade,
      "_업체명": vendor,
      "_출처": "웹앱:복합기확장성",
      "_원문": text,
      "_dupKey": md5([vendor, date, form.itemRaw, form.expectedAmount, form.expectedOrderMonth, form.notes].join("|")),
    };
    let rooms: string[] = [];
    const cfg = await getConfig();
    // 시트 테스트 중에도 확장성 복합기 원본은 Supabase에 남겨야 통합이력·집계가 맞다.
    const r = await insertRow("mfp_expansion", {
      "등록일": row["등록일"],
      "등록자": row["등록자"],
      "전략영업담당자": row["전략영업담당자"],
      "상호": row["상호명"],
      "업종": row["업종및인원매출"],
      "매출액(억)": "미기재",
      "인원수": "미기재",
      "프로젝트주소": row["실제미팅주소"],
      "미팅지역": "미기재",
      "도로명주소": row["실제미팅주소"],
      "세부주소": "미기재",
      "키맨성함+직함": row["성함및직함"],
      "키맨전화번호": row["연락처"],
      "키맨 성향": "미기재",
      "영업 접근 전략": "미기재",
      "의사결정 파급력": row["의사결정파급력"],
      "개인 히스토리": row["개인히스토리"],
      "프로젝트": row["프로젝트진행상황"],
      "품목(원문)": row["품목원문"],
      "연계영업": "미기재",
      "관심품목(세분화)": "미기재",
      "수주 가능성(A/B/C)": "미기재",
      "예상 발주금액(만원)": row["예상발주금액만원"],
      "예상 발주시기(YYYY-MM)": row["예상발주시기"],
      "현재 경쟁사/장비": "미기재",
      "경쟁사 불만(PainPoint)": "미기재",
      "계약 종료(예정)일": row["계약종료예정일"],
      "진행상황(원문)": row["프로젝트진행상황"],
      "최종결과(대기 등)": "대기",
      "영업진행상황": row["프로젝트진행상황"],
      "첫등록내용": row["특이사항미팅내용"],
      "특이사항": row["특이사항미팅내용"],
      "거래처등급": row["관리등급"],
      "영업등급": "미기재",
      "체크일": "미기재",
      "[신규통합] 현재 관리등급": row["관리등급"],
      "[AI 자동완성 개입 여부": "웹앱 직접입력",
      "_업체명": vendor,
      "_출처": "웹앱:복합기확장성",
      "_원문": text,
      "_dupKey": row["_dupKey"],
      "_raw": form,
    });
    const testRoom = cfg.TEST_ROOM || "테스트 전용방";
    if (isTestModeValue(cfg.TEST_MODE)) rooms = [testRoom];
    else {
      const map = await getRoomMap();
      rooms = [map["복합기확장성|*"] || FIXED_ROOM.copierExpansion];
    }
    const automation = await queueFieldAutomation({
      category: "expansion_copier",
      author,
      vendor,
      room: rooms[0] || "",
      text,
      data: form,
      dupKey: String(row["_dupKey"]),
    });
    if (!automation.holdKakao && isEnabled(cfg.FIELD_KAKAO_SEND_ENABLED)) for (const room of rooms) await enqueueOutbox(room, text);
    return { ok: true, message: `${r === "new" ? "저장 완료" : "기존 기록 확인"} · ${automation.message}`, testMode: automation.testMode };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "네트워크 오류" };
  }
}

export async function sendContactChangeForm(form: ContactChangeFormState, author: string, text: string, ts?: string): Promise<SaveResp> {
  try {
    const cfg = await getConfig();
    const changeDate = toKstDate(ts);
    const dupKey = md5(["contact_change", changeDate, author, form.company, form.category, form.reason, form.before, form.after].join("|"));
    const photoLink = text.match(/https?:\/\/\S+\?album=[a-z0-9-]+/i)?.[0] || "";
    await insertRow("contact_changes", {
      change_date: changeDate,
      author,
      company: form.company,
      region: form.region,
      category: form.category,
      reason: form.reason,
      grade: form.grade,
      before_text: form.before,
      after_text: form.after,
      notes: form.notes,
      source_text: text,
      photo_link: photoLink,
      "_dupKey": dupKey,
    });
    const testRoom = cfg.TEST_ROOM || "테스트 전용방";
    let room = testRoom;
    if (!isTestModeValue(cfg.TEST_MODE)) {
      const map = await getRoomMap();
      room = map["담당자변경|*"] || map["담당자/주소변경|*"] || FIXED_ROOM.contactChange;
    }
    const automation = await queueFieldAutomation({
      category: "contact_change",
      author,
      vendor: form.company,
      region: form.region,
      room,
      text,
      data: form,
      dupKey,
    });
    if (!automation.holdKakao && isEnabled(cfg.FIELD_KAKAO_SEND_ENABLED)) await enqueueOutbox(room, text);
    return { ok: true, message: automation.message, testMode: automation.testMode };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "네트워크 오류" };
  }
}

// 사진 → 양식 변환 (POST). 단순요청(text/plain)이라 프리플라이트 없이 GAS doPost 호출.
export type VisionResp = { ok?: boolean; text?: string; error?: string };
export function visionForm(dataUrl: string, kind: "inspection" | "air"): Promise<VisionResp> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 70000);
  return fetch(GAS_GET_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "vision", image: dataUrl, kind }),
    signal: ctrl.signal,
  })
    .then((r) => r.json() as Promise<VisionResp>)
    .catch((e) => ({ ok: false, error: e.name === "AbortError" ? "시간 초과" : (e.message || "네트워크 오류") }))
    .finally(() => window.clearTimeout(timer));
}
