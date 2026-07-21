export type ItRow = Record<string, unknown>;

export type QuizQuestion = {
  id?: string | number;
  카테고리: string;
  부품명: string;
  문제: string;
  정답: string;
  multiAnswer?: string[];
  isMulti?: boolean;
  보기: string[];
  난이도?: string | number;
  설명?: string;
  조치방법?: string;
  AI해설?: string;
  소요시간?: string;
  주의사항?: string;
};

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
  if (!endpoint) return Promise.reject(new Error("IT 기술 DB 연결 주소를 먼저 설정해 주세요."));
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
  knowledge: (query: string) => jsonp<ItRow[]>("knowledge", { query }),
  history: (query: string) => jsonp<ItRow[]>("history", { query }),
  inventory: (query: string) => jsonp<ItRow[]>("inventory", { query }),
  quiz: (count = 50) => jsonp<QuizQuestion[]>("quiz", { count }),
  addRecord: (form: ItRow) => jsonp<{ success: boolean; id?: number }>("addRecord", { payload: JSON.stringify(form) }),
  ping: () => jsonp<{ connected: boolean }>("ping"),
};

export function valueByPrefix(row: ItRow, ...prefixes: string[]) {
  const key = Object.keys(row).find((candidate) => prefixes.some((prefix) => candidate.startsWith(prefix)));
  return key ? String(row[key] ?? "").trim() : "";
}
