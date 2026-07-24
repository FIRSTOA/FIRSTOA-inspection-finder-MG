/**
 * GAS 백엔드(First-DATA-MG) 통신 — 거래처 검색 / 최근 점검양식 / 통합이력.
 *
 * 백엔드는 doGet 에서 callback 파라미터를 받으면 JSONP(callback(json))로 응답한다.
 * GitHub Pages 등 다른 도메인에서 호출하므로 CORS를 피하기 위해 JSONP(GET)를 쓴다.
 * 엔드포인트는 검색용과 동일 배포(URL 고정 — "기존 배포 편집→새 버전").
 */

import { buildRecords } from "./inspectParser";
import { md5 } from "./md5";
import { enqueueFieldSheetSyncJob, enqueueOutbox, getConfig, getRoomMap, insertRecord, insertRow, invokeEdgeFunction, rpc, selectRows, type FieldSheetSyncCategory } from "./supabase";
import type { PcFormState } from "./PcForm";
import type { CopierExpansionFormState } from "./CopierExpansionForm";
import type { ContactChangeFormState } from "./contactChange";
import { CATEGORY_SCHEMAS } from "./categoryForms";
import { normRegion } from "./region";

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
  { table: "copier_expansion", category: "복합기확장성", dateField: "등록일", regionField: "실제미팅주소" },
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

export async function searchVendors(q: string): Promise<SearchResp> {
  const query = String(q || "").trim();
  if (query.length < 1) return { results: [], total: 0 };
  try {
    const [rows, machineHits] = await Promise.all([
      rpc<RpcHit[]>("search_vendors", { q: query }).catch(() => []),
      searchMachineIdentity(query),
    ]);
    const indexed: VendorHit[] = rows.map((r) => ({
      vendor: r.vendor,
      counts: r.counts || {},
      meta: r.meta || {},
    }));
    const results = mergeHistoryHits([...indexed, ...machineHits]);
    return { results, total: results.length };
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
  if (String(cfg.TEST_MODE || "true").toLowerCase() === "true") return [testRoom];

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
  if (String(cfg.TEST_MODE || "true").toLowerCase() === "true") return [testRoom];
  const map = await getRoomMap();
  const key = normRegion(region);
  const room = map[`${destination === "inspection" ? "점검" : "AS"}|${key}`];
  return [room || testRoom];
}

// 완성 양식 → Supabase 점검/AS 탭 직접 적재 + 발신큐(outbox) 적재 (GAS 미경유).
//  kind: normal=지역 점검방 또는 AS방 단일 전송, 자가=여분토너요청방, 부품=부품요청방.
//  자가/부품은 알림 목적이라 중복(이미 저장)이어도 해당 방으로는 항상 게시한다.
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
      if (r === "new") anyNew = true;
    }

    const isExtra = kind === "자가" || kind === "부품";
    let rooms: string[] = [];
    if (anyNew || isExtra || destination) {   // 강제 목적지/자가/부품은 중복이어도 알림 게시
      rooms = destination ? await resolveForcedRoom(destination, built.region) : await resolveRoomsFor(kind, built.region, built.hasAS);
      for (const room of rooms) await enqueueOutbox(room, sendText);
    }

    const dest = rooms.length ? `게시 대기: ${rooms.join(", ")}` : "";
    return {
      ok: true,
      message: isExtra
        ? `${kind} 요청 ${dest}`
        : anyNew ? `저장 완료 — ${dest}` : "이미 저장된 내용입니다(중복).",
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
    let room = testRoom;
    if (String(cfg.TEST_MODE || "true").toLowerCase() !== "true") {
      const map = await getRoomMap(); room = map["물류|*"] || map["납품|*"] || FIXED_ROOM.logistics;
    }
    // 사용자가 명시적으로 전송했으므로 중복 저장이어도 알림은 보낸다.
    await enqueueOutbox(room, text);
    return { ok: true, message: `${result === "new" ? "저장 완료" : "기존 기록 확인"} — 게시 대기: ${room}` };
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

    let rooms: string[] = [];
    const cfg = await getConfig();
    const r = schemaKey === "bulman" && isEnabled(cfg.FIELD_SHEET_TEST_MODE) ? "new" : await insertRow(s.table, row);
    const testRoom = cfg.TEST_ROOM || "테스트 전용방";
    if (String(cfg.TEST_MODE || "true").toLowerCase() === "true") rooms = [testRoom];
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
      if (isEnabled(cfg.FIELD_KAKAO_SEND_ENABLED)) for (const room of rooms) await enqueueOutbox(room, text);
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
    const r = isEnabled(cfg.FIELD_SHEET_TEST_MODE) ? "new" : await insertRow("pc_expansion", row);
    const testRoom = cfg.TEST_ROOM || "테스트 전용방";
    if (String(cfg.TEST_MODE || "true").toLowerCase() === "true") rooms = [testRoom];
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
    if (isEnabled(cfg.FIELD_KAKAO_SEND_ENABLED)) for (const room of rooms) await enqueueOutbox(room, text);
    return { ok: true, message: `${r === "new" ? "저장 완료" : "기존 기록 확인"} · ${automation.message}`, testMode: automation.testMode };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "네트워크 오류" };
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
}): Promise<{ message: string; testMode: boolean }> {
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
    return { message: "자동화 설정 전 · 카카오 전송 보류", testMode: false };
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
    const r = isEnabled(cfg.FIELD_SHEET_TEST_MODE) ? "new" : await insertRow("copier_expansion", row);
    const testRoom = cfg.TEST_ROOM || "테스트 전용방";
    if (String(cfg.TEST_MODE || "true").toLowerCase() === "true") rooms = [testRoom];
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
    if (isEnabled(cfg.FIELD_KAKAO_SEND_ENABLED)) for (const room of rooms) await enqueueOutbox(room, text);
    return { ok: true, message: `${r === "new" ? "저장 완료" : "기존 기록 확인"} · ${automation.message}`, testMode: automation.testMode };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "네트워크 오류" };
  }
}

export async function sendContactChangeForm(form: ContactChangeFormState, author: string, text: string, ts?: string): Promise<SaveResp> {
  try {
    const cfg = await getConfig();
    const testRoom = cfg.TEST_ROOM || "테스트 전용방";
    let room = testRoom;
    if (String(cfg.TEST_MODE || "true").toLowerCase() !== "true") {
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
      dupKey: md5(["contact_change", toKstDate(ts), author, form.company, form.category, form.reason, form.before, form.after].join("|")),
    });
    if (isEnabled(cfg.FIELD_KAKAO_SEND_ENABLED)) await enqueueOutbox(room, text);
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
