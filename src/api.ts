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
