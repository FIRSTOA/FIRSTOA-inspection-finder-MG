/**
 * GAS 백엔드(First-DATA-MG) 통신 — 거래처 검색 / 최근 점검양식 / 통합이력.
 *
 * 백엔드는 doGet 에서 callback 파라미터를 받으면 JSONP(callback(json))로 응답한다.
 * GitHub Pages 등 다른 도메인에서 호출하므로 CORS를 피하기 위해 JSONP(GET)를 쓴다.
 * 엔드포인트는 검색용과 동일 배포(URL 고정 — "기존 배포 편집→새 버전").
 */

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

let jsonpSeq = 0;

function jsonp<T>(params: Record<string, string>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cb = `__gas_cb_${Date.now()}_${jsonpSeq++}`;
    const script = document.createElement("script");

    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("요청 시간 초과"));
    }, 30000);

    function cleanup() {
      window.clearTimeout(timeout);
      delete (window as unknown as Record<string, unknown>)[cb];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    (window as unknown as Record<string, unknown>)[cb] = (data: T) => {
      cleanup();
      resolve(data);
    };

    const qs = new URLSearchParams({ ...params, callback: cb }).toString();
    script.src = `${GAS_GET_URL}?${qs}`;
    script.onerror = () => {
      cleanup();
      reject(new Error("네트워크 오류 — 인터넷/배포 상태를 확인하세요"));
    };
    document.body.appendChild(script);
  });
}

export function searchVendors(q: string): Promise<SearchResp> {
  return jsonp<SearchResp>({ action: "search", q });
}

export function getInspForms(vendor: string): Promise<InspFormsResp> {
  return jsonp<InspFormsResp>({ action: "inspforms", q: vendor });
}

export function getVendorDetail(vendor: string): Promise<DetailResp> {
  return jsonp<DetailResp>({ action: "detail", q: vendor });
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
export function sendForm(payload: SavePayload): Promise<SaveResp> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 30000);
  return fetch(GAS_GET_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "save", ...payload }),
    signal: ctrl.signal,
  })
    .then((r) => r.json() as Promise<SaveResp>)
    .catch((e) => ({ ok: false, error: e.name === "AbortError" ? "시간 초과" : (e.message || "네트워크 오류") }))
    .finally(() => window.clearTimeout(timer));
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
