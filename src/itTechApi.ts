/**
 * IT파트 PC DB Apps Script 호출 — IT 담당자가 소유·관리하는 시스템이다(2026-10-03 확인). FIELD는 손님.
 *  - 읽기(조회·퀴즈)는 공개 시트를 직접 읽으므로(itSheet.ts) 주소가 없어도 된다.
 *  - 쓰기(AS 등록)만 담당자의 Apps Script(/exec)로 보낸다. 담당자가 apps-script/it-tech-api-adapter.gs를 자기 스크립트에 붙이고
 *    배포 주소를 주면 기기에 저장(또는 빌드 설정 VITE_IT_TECH_API_URL)해서 쓴다. 우리 쪽 DB로 복사하지 않는다.
 */
import type { ItRow } from "./itSheet";

const URL_KEY = "firstoa_it_tech_api_url";

export function getItTechApiUrl() {
  return String(import.meta.env.VITE_IT_TECH_API_URL || localStorage.getItem(URL_KEY) || "").trim();
}

export function saveItTechApiUrl(url: string) {
  const normalized = url.trim();
  if (normalized) localStorage.setItem(URL_KEY, normalized);
  else localStorage.removeItem(URL_KEY);
  return normalized;
}

function jsonp<T>(action: string, params: Record<string, string | number> = {}): Promise<T> {
  const endpoint = getItTechApiUrl();
  if (!endpoint) return Promise.reject(new Error("IT 담당자의 Apps Script 주소를 먼저 넣어 주세요."));
  return new Promise((resolve, reject) => {
    const callback = `__firstoaItCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const timer = window.setTimeout(() => finish(new Error("IT 기술 DB 응답 시간이 초과되었습니다.")), 20000);
    const finish = (error?: Error, value?: T) => {
      window.clearTimeout(timer);
      script.remove();
      delete (window as unknown as Record<string, unknown>)[callback];
      if (error) reject(error);
      else resolve(value as T);
    };
    (window as unknown as Record<string, unknown>)[callback] = (payload: { ok?: boolean; data?: T; error?: string } | T) => {
      if (payload && typeof payload === "object" && "ok" in payload) {
        const wrapped = payload as { ok?: boolean; data?: T; error?: string };
        if (!wrapped.ok) finish(new Error(wrapped.error || "IT 기술 DB 요청에 실패했습니다."));
        else finish(undefined, wrapped.data);
      } else finish(undefined, payload as T);
    };
    const url = new URL(endpoint);
    url.searchParams.set("action", action);
    url.searchParams.set("callback", callback);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    script.onerror = () => finish(new Error("IT 기술 DB에 연결하지 못했습니다."));
    script.src = url.toString();
    document.head.appendChild(script);
  });
}

export const itTechApi = {
  ping: () => jsonp<{ connected: boolean }>("ping"),
  addRecord: (form: ItRow) => jsonp<{ success: boolean; id?: number }>("addRecord", { payload: JSON.stringify(form) }),
};
