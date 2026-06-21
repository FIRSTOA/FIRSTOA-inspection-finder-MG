/**
 * GAS 백엔드(First-DATA-MG) 통신 — 거래처 검색 / 최근 점검양식 / 통합이력.
 *
 * 백엔드는 doGet 에서 callback 파라미터를 받으면 JSONP(callback(json))로 응답한다.
 * GitHub Pages 등 다른 도메인에서 호출하므로 CORS를 피하기 위해 JSONP(GET)를 쓴다.
 * 엔드포인트는 검색용과 동일 배포(URL 고정 — "기존 배포 편집→새 버전").
 */

import { buildRecords } from "./inspectParser";
import { insertRecord, getConfig, getRoomMap, enqueueOutbox, rpc, selectRows } from "./supabase";

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
};
export type SearchResp = { results: VendorHit[]; total: number; error?: string };

// 통합이력 상세: 카테고리별 레코드 배열 (백엔드 getVendorDetailFromIndex 출력)
export type DetailResp = { vendor: string; error?: string } & Record<
  string,
  Array<Record<string, unknown>> | string | undefined
>;

// ── 검색: GAS _idx_* 시트 → Supabase RPC 직접 조회로 이전 (통합시트 은퇴) ──

// 거래처 검색(접두) → Supabase search_vendors RPC → {results, total}
type RpcHit = { vendor: string; counts: Record<string, number>; meta: VendorMeta; total: number };
export async function searchVendors(q: string): Promise<SearchResp> {
  const query = String(q || "").trim();
  if (query.length < 1) return { results: [], total: 0 };
  try {
    const rows = await rpc<RpcHit[]>("search_vendors", { q: query });
    const results: VendorHit[] = rows.map((r) => ({
      vendor: r.vendor,
      counts: r.counts || {},
      meta: r.meta || {},
    }));
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
export type SaveResp = { ok?: boolean; message?: string; error?: string };
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

// 보낼 방 목록 결정. TEST_MODE면 무조건 테스트방. kind=자가/부품이면 단일 전용방.
async function resolveRoomsFor(kind: SendKind, region: string, hasAS: boolean): Promise<string[]> {
  const cfg = await getConfig();
  const testRoom = cfg.TEST_ROOM || "테스트 전용방";
  if (String(cfg.TEST_MODE || "true").toLowerCase() === "true") return [testRoom];

  const map = await getRoomMap();
  if (kind === "자가") return [map["자가|*"] || "여분토너요청방"];
  if (kind === "부품") return [map["부품|*"] || "부품요청"];

  // normal: 지역별 점검방(+AS방)
  const key = String(region || "").trim().toUpperCase();
  const inspectRoom = map["점검|" + key];
  if (!inspectRoom) return [testRoom];           // 미지원 지역(E·빈값 등)
  const rooms = [inspectRoom];                    // 점검방은 항상
  if (hasAS) {
    const asRoom = map["AS|" + key];
    if (asRoom) rooms.push(asRoom);               // AS방은 AS 포함 시
  }
  return rooms;
}

// 완성 양식 → Supabase 점검/AS 탭 직접 적재 + 발신큐(outbox) 적재 (GAS 미경유).
//  kind: normal=지역 점검/AS방, 자가=여분토너요청방, 부품=부품요청방.
//  자가/부품은 알림 목적이라 중복(이미 저장)이어도 해당 방으로는 항상 게시한다.
export async function sendForm(payload: SavePayload, kind: SendKind = "normal"): Promise<SaveResp> {
  try {
    const text = String(payload.text || "");
    if (!text.trim()) return { ok: false, error: "내용이 비어있습니다." };

    const built = buildRecords(text, toKstDate(payload.ts), payload.author || "", "");
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
    if (anyNew || isExtra) {   // 자가/부품은 중복이어도 알림 게시
      rooms = await resolveRoomsFor(kind, built.region, built.hasAS);
      for (const room of rooms) await enqueueOutbox(room, text);
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
