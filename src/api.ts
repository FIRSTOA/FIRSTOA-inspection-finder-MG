/**
 * GAS 백엔드(First-DATA-MG) 통신 — 거래처 검색 / 최근 점검양식 / 통합이력.
 *
 * 백엔드는 doGet 에서 callback 파라미터를 받으면 JSONP(callback(json))로 응답한다.
 * GitHub Pages 등 다른 도메인에서 호출하므로 CORS를 피하기 위해 JSONP(GET)를 쓴다.
 * 엔드포인트는 검색용과 동일 배포(URL 고정 — "기존 배포 편집→새 버전").
 */

import { buildRecords } from "./inspectParser";
import { md5 } from "./md5";
import { insertRecord, getConfig, getRoomMap, enqueueOutbox, rpc, selectRows, insertRow } from "./supabase";
import type { PcFormState } from "./PcForm";
import type { CopierExpansionFormState } from "./CopierExpansionForm";
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
export type SendDestination = "inspection" | "as";

const FIXED_ROOM = {
  logistics: "완료방(납품,철수,교체)",
  pcIt: "PC/IT/피씨/확장성고객등록및영업",
  copierExpansion: "영업확장성미션 : 퍼스트조국진대리, 퍼스트신정훈프로, 퍼스트홍대경프로",
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

    let built = buildRecords(text, toKstDate(payload.ts), payload.author || "", "");
    // 여분/마감/세팅처럼 구분에 점검·AS 문자가 없어도 사용자가 누른 방 기준으로 저장한다.
    if (!built.hasInspect && !built.hasAS && destination) {
      const forced = text.match(/^구분\s*[:：]/m)
        ? text.replace(/^구분\s*[:：]\s*(.*)$/m, `구분: ${destination === "inspection" ? "점검" : "AS"}, $1`)
        : `구분: ${destination === "inspection" ? "점검" : "AS"}\n${text}`;
      built = buildRecords(forced, toKstDate(payload.ts), payload.author || "", "");
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

    const r = await insertRow(s.table, row);

    let rooms: string[] = [];
    const cfg = await getConfig();
    const testRoom = cfg.TEST_ROOM || "테스트 전용방";
    if (String(cfg.TEST_MODE || "true").toLowerCase() === "true") rooms = [testRoom];
    else {
      const map = await getRoomMap();
      const fallback = map[s.roomKey] || testRoom;
      rooms = [regionRoom(schemaKey, String((regionKey && form[regionKey]) || ""), fallback)];
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
    const r = await insertRow("pc_expansion", row);

    let rooms: string[] = [];
    const cfg = await getConfig();
    const testRoom = cfg.TEST_ROOM || "테스트 전용방";
    if (String(cfg.TEST_MODE || "true").toLowerCase() === "true") rooms = [testRoom];
    else { const map = await getRoomMap(); rooms = [map["IT통합|*"] || map["PC확장성|*"] || FIXED_ROOM.pcIt]; }
    for (const room of rooms) await enqueueOutbox(room, text);
    return { ok: true, message: `${r === "new" ? "저장 완료" : "기존 기록 확인"} — 게시 대기: ${rooms.join(", ")}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "네트워크 오류" };
  }
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
    const r = await insertRow("copier_expansion", row);

    let rooms: string[] = [];
    const cfg = await getConfig();
    const testRoom = cfg.TEST_ROOM || "테스트 전용방";
    if (String(cfg.TEST_MODE || "true").toLowerCase() === "true") rooms = [testRoom];
    else {
      const map = await getRoomMap();
      rooms = [map["복합기확장성|*"] || FIXED_ROOM.copierExpansion];
    }
    for (const room of rooms) await enqueueOutbox(room, text);
    return { ok: true, message: `${r === "new" ? "저장 완료" : "기존 기록 확인"} — 게시 대기: ${rooms.join(", ")}` };
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
