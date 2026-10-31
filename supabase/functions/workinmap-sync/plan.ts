/**
 * workinmap-sync 순수 규칙 — 워킨맵(workinmap.com, api.solgit.co) → 웹앱 workin_map_places 가져오기(P1) · 2026-10-31
 * 설계: docs/tasks/workinmap-sync-2026-10-31.md v2(A3 이름 규칙 · B2 짝짓기 · B3 새 장소 · B4 사라진 장소 · B5·B6 칸 규칙)
 *       + 2026-10-31 사용자 결정: "싹 다 가져온다"(이름·주소·전화·좌표·코멘트도 워킨맵 값), 메모는 합집합("1,2,3 vs 1,2,3,4 면 4만 추가"),
 *         확인 큐는 완료(G5·G12)가 내려가는 경우만.
 * Deno 엣지와 vitest 가 같이 쓴다 — Deno 전용 API·네트워크 없음. 테스트: tests/workinmapSync.test.ts
 *
 * 워킨맵 응답(공개 work2.js·work2 HTML 템플릿에서 읽은 모양 — 실제 응답은 계정이 생긴 뒤 dry 로 검증):
 *   GET /api/v2/works/<id> → { _id, name, places: [{ _id, name, comment, number(=전화), address:{address, detail_addr},
 *     position:{latitude, longitude}(추정), label_color 0~11, hide, memo(옛, ":::" 연결), memo2:[{_id, content, last_update, edited}],
 *     last_update, resource_images }] }
 *   실패: { error_code: 109(토큰), message, status: 401 } — HTTP 200 으로 올 때도 있다(실측).
 *   서버 문자열은 화면이 escapeHTML 해서 저장한 값이라 &amp; 등이 섞여 있다 → 비교·저장 전에 풀어 쓴다.
 */
import { vendorMatchKey } from "../_shared/counter-sms/vendorKey.ts";
import { historyCoreName } from "../_shared/vendor-core.ts";

export type Team = "A" | "B" | "C" | "D" | "E";
/** T = 동기화 테스트 워크(app_config.WORKINMAP_TEST_WORK). workin-sync-20261031.sql 이 workin_map_places.team check 에 'T' 를 더한다 */
export type WorkTeam = Team | "T";
export type WorkKind = "quarter" | "monthly" | "renewal";
export type Quarter = 1 | 2 | 3 | 4;
export type WorkParse = { team: WorkTeam; year: number; quarter: Quarter; kind: WorkKind; test?: true };
export type WorkStatus = "target" | "excluded" | "unparsed" | "duplicate";

/** 동기화가 쓴 행 표시 — 되밀기 트리거(P2)·충돌 판정이 이 값으로 "앱 변경이 아님"을 안다 */
export const SYNC_ACTOR = "워킨맵 동기화";
export const DEFAULT_EXCLUDE_WORKS = ["영업확장성리스트_박P_워킨맵표현"];
/** 한 워크 한 회차 새 장소 상한 — 넘으면 그 워크는 이번 회차에 아무것도 쓰지 않는다(워크 복사·엉뚱한 워크 방어) */
export const NEW_PLACE_LIMIT = 50;
/** 평소 장소 수의 이 비율 미만으로 응답하면 형식 이상으로 보고 중단 */
export const SHRINK_RATIO = 0.5;

// ── 워크 이름 해석(v2-A3) ─────────────────────────────────────────

const clean = (s: unknown) => String(s ?? "").normalize("NFC").replace(/\s+/g, " ").trim();

/**
 * 워크 이름 → { team, year, quarter, kind } | null.
 * 제외 목록(이름)에 있거나 규칙에 맞지 않으면 null. opts.testWork 와 이름이 같으면 팀 T(날짜 "26.10.31" → 2026년 4분기).
 * 순서: 제외 → 테스트 워크 → 팀 `(수도권|계약종료|재계약)[A-E]` + 경계 → `yy년 n분기` → 업무(계약종료·재계약 > 매월 > 점검).
 */
export function parseWorkName(name: string, opts: { exclude?: string[]; testWork?: string; now?: Date } = {}): WorkParse | null {
  const n = clean(name);
  if (!n) return null;
  const exclude = (opts.exclude ?? DEFAULT_EXCLUDE_WORKS).map(clean);
  if (exclude.includes(n)) return null;

  const test = clean(opts.testWork);
  if (test && n === test) {
    const d = /(\d{2})\.(\d{1,2})\.(\d{1,2})/.exec(n);
    const now = opts.now ?? new Date();
    const year = d ? 2000 + Number(d[1]) : kstParts(now).year;
    const month = d ? Number(d[2]) : kstParts(now).month;
    if (month < 1 || month > 12) return null;
    return { team: "T", year, quarter: Math.ceil(month / 3) as Quarter, kind: "quarter", test: true };
  }

  const team = /(수도권|계약종료|재계약)\s*([A-E])(?=[_\s(]|$)/.exec(n);
  if (!team) return null;
  const yq = /(\d{2})\s*년\s*([1-4])\s*분기/.exec(n);
  if (!yq) return null;
  let kind: WorkKind | null = null;
  if (/계약종료|재계약/.test(n)) kind = "renewal";
  else if (/매월/.test(n)) kind = "monthly";
  else if (/점검/.test(n)) kind = "quarter";
  if (!kind) return null;
  return { team: team[2] as Team, year: 2000 + Number(yq[1]), quarter: Number(yq[2]) as Quarter, kind };
}

/** 워크 하나 → 상태. 제외는 이름 또는 워크 id 로 */
export function classifyWork(work: { id: string; name: string }, opts: { exclude?: string[]; testWork?: string; now?: Date } = {}): { status: WorkStatus; parse: WorkParse | null } {
  const exclude = (opts.exclude ?? DEFAULT_EXCLUDE_WORKS).map(clean);
  if (exclude.includes(clean(work.name)) || exclude.includes(clean(work.id))) return { status: "excluded", parse: null };
  // 테스트 워크는 이름 또는 워크 id 로 지정할 수 있다(app_config.WORKINMAP_TEST_WORK)
  const testWork = opts.testWork && clean(opts.testWork) === clean(work.id) ? work.name : opts.testWork;
  const parse = parseWorkName(work.name, { ...opts, exclude, testWork });
  return parse ? { status: "target", parse } : { status: "unparsed", parse: null };
}

// ── 색 ───────────────────────────────────────────────────────────

/** 워킨맵 label_color 0~11 → 앱 G1~G12 (v2-1 색 순서 실측: Gn = n-1). 범위 밖·숫자 아님 → null */
export function labelOf(color: unknown): string | null {
  if (color === null || color === undefined || color === "") return null;
  const n = Number(color);
  if (!Number.isInteger(n) || n < 0 || n > 11) return null;
  return `G${n + 1}`;
}

/** 앱 G1~G12 → 워킨맵 label_color 0~11 (P2 되밀기용 역변환) */
export function colorOf(label: unknown): number | null {
  const m = /^G(\d{1,2})$/.exec(String(label ?? "").trim().toUpperCase());
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 12 ? n - 1 : null;
}

const isDone = (label: unknown) => label === "G5" || label === "G12";

// ── 응답 정리 ─────────────────────────────────────────────────────

/** 워킨맵 화면 escapeHTML 되돌리기(&amp; &lt; &gt; &quot; &#39; &#x2F; &#96; &#61; …) */
export function decodeHtml(value: unknown): string {
  const s = String(value ?? "");
  if (!s.includes("&")) return s;
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => safeChar(Number(d)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}
const safeChar = (code: number) => (Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "");

export type RemotePlace = {
  extId: string;
  /** 응답 안 순서(1부터) — 워킨맵 엑셀 내려받기의 "번호"와 같은 순서라고 본다(가정, dry 로 확인). 워킨맵 number 는 전화번호다 */
  seq: number;
  /** null = 응답에 그 칸이 없음(그 칸은 건드리지 않는다). "" = 비어 있음 */
  name: string;
  comment: string | null;
  phone: string | null;
  address: string | null;
  addressDetail: string | null;
  latitude: number | null;
  longitude: number | null;
  label: string | null;
  visible: boolean | null;
  memos: string[];
  /** ISO 문자열(파싱 실패 시 null) */
  lastUpdate: string | null;
  /** 원본 label_color — 색 검증 분포용 */
  labelColor: number | null;
};

export type RemoteWork = { workId: string; name: string; places: RemotePlace[] };

/** 숫자(ms·초)·ISO 문자열 → ISO. 못 읽으면 null */
export function toIso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  let ms: number;
  if (typeof value === "number") ms = value < 1e12 ? value * 1000 : value;
  else if (/^\d+$/.test(String(value))) { const n = Number(value); ms = n < 1e12 ? n * 1000 : n; }
  else ms = Date.parse(String(value));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * 텍스트 칸 정규화(2026-10-31 첫 dry 실측: 전화 칸 앱 "A\n\nB" vs 워킨맵 "A\r\nB" 로 100건 가까이 가짜 변경).
 * CRLF·CR·엑셀 잔재 _x000d_ → LF, 줄 끝 공백 제거, 빈 줄(공백뿐인 줄 포함)은 없앤다 — 앱 엑셀 불러오기가 \r 을 줄로 바꿔
 * 생긴 빈 줄과 워킨맵 원래 값이 같게 보이도록. 앞뒤 공백 제거. 비교·저장 모두 이 값(LF)으로.
 */
export function normText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/_x000d_/gi, "\n")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+$/, ""))
    .filter((line) => line.trim() !== "")
    .join("\n")
    .trim();
}

const optText = (v: unknown): string | null => (v === undefined || v === null ? null : normText(decodeHtml(v)));
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function coordsOf(p: Record<string, unknown>): { latitude: number | null; longitude: number | null } {
  const pos = (p.position && typeof p.position === "object" ? p.position : {}) as Record<string, unknown>;
  if (Array.isArray(pos.coordinates) && pos.coordinates.length >= 2) {
    return { latitude: num(pos.coordinates[1]), longitude: num(pos.coordinates[0]) };
  }
  return {
    latitude: num(pos.latitude ?? pos.lat ?? p.latitude ?? p.lat),
    longitude: num(pos.longitude ?? pos.lng ?? pos.lon ?? p.longitude ?? p.lng),
  };
}

function memosOf(p: Record<string, unknown>): string[] {
  if (Array.isArray(p.memo2) && p.memo2.length) {
    return p.memo2.map((m) => {
      if (m && typeof m === "object") {
        const o = m as Record<string, unknown>;
        return normText(decodeHtml(o.content ?? o.text ?? ""));
      }
      return normText(decodeHtml(m));
    });
  }
  if (typeof p.memo === "string" && p.memo) return p.memo.split(":::").map((x) => normText(decodeHtml(x)));
  return [];
}

/**
 * GET /api/v2/works/<id> 응답 검사·정리. 형식이 어긋나면 { ok:false } — 그 워크는 이번 회차에 쓰지 않는다(v2-D 비공식 API 대응).
 * 필수: 객체, places 배열, 장소마다 _id 문자열.
 */
export function normalizeRemoteWork(raw: unknown, expectWorkId?: string): { ok: true; work: RemoteWork } | { ok: false; error: string; code?: number } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "응답이 객체가 아님" };
  const o = raw as Record<string, unknown>;
  if (o.error_code !== undefined && o.error_code !== null) {
    const code = Number(o.error_code);
    return { ok: false, error: `워킨맵 오류 ${code}`, code: Number.isFinite(code) ? code : undefined };
  }
  const body = (o.work && typeof o.work === "object" ? o.work : o) as Record<string, unknown>;
  if (!Array.isArray(body.places)) return { ok: false, error: "places 배열 없음(형식 변경?)" };
  const workId = String(body._id ?? expectWorkId ?? "");
  if (expectWorkId && body._id !== undefined && String(body._id) !== expectWorkId) return { ok: false, error: "요청한 워크와 다른 워크가 옴" };
  const places: RemotePlace[] = [];
  for (let i = 0; i < body.places.length; i += 1) {
    const p = body.places[i] as Record<string, unknown>;
    if (!p || typeof p !== "object" || typeof p._id !== "string" || !p._id) return { ok: false, error: `장소 ${i + 1}번째에 _id 없음(형식 변경?)` };
    const addr = (p.address && typeof p.address === "object" ? p.address : null) as Record<string, unknown> | null;
    const { latitude, longitude } = coordsOf(p);
    const colorNum = num(p.label_color);
    places.push({
      extId: p._id,
      seq: i + 1,
      name: normText(decodeHtml(p.name)),
      comment: optText(p.comment),
      phone: optText(p.number),
      address: addr ? optText(addr.address) : typeof p.address === "string" ? optText(p.address) : null,
      addressDetail: addr ? optText(addr.detail_addr) : null,
      latitude,
      longitude,
      label: labelOf(p.label_color),
      visible: typeof p.hide === "boolean" ? !p.hide : p.hide === undefined || p.hide === null ? null : !p.hide,
      memos: memosOf(p),
      lastUpdate: toIso(p.last_update),
      labelColor: colorNum !== null && Number.isInteger(colorNum) ? colorNum : null,
    });
  }
  return { ok: true, work: { workId, name: decodeHtml(body.name).trim(), places } };
}

// ── 앱 행 ─────────────────────────────────────────────────────────

/** workin_map_places 행(필요한 칸만). ext_* 는 supabase/workin-sync-20261031.sql(표다빈) — 칸 이름 그대로 */
export type LocalPlace = {
  id: number;
  number: number;
  team: string;
  quarter: number;
  kind: string;
  label: string;
  visible: boolean;
  name: string;
  comment: string;
  phone: string;
  address: string;
  address_detail: string;
  latitude: number;
  longitude: number;
  memos: string[];
  updated_at?: string | null;
  updated_by?: string | null;
  ext_id?: string | null;
  ext_work_id?: string | null;
  ext_account_no?: number | null;
  ext_year?: number | null;
  ext_last_update?: string | null;
  ext_synced_at?: string | null;
  ext_missing_at?: string | null;
};

// 2차 실측: 앱 이름에 엑셀 잔재 "_x000d_\n" 이 있으면 vendorMatchKey 가 밑줄만 지워 "x000d" 가 키에 남았다 → normText 먼저
const nameKey = (name: string) => { const n = normText(name); return vendorMatchKey(n) || n.replace(/\s+/g, "").toLowerCase(); };
/** 전체 이름 완전 일치 키 — normText(_x000d_·CR/LF·빈 줄) 뒤 모든 공백을 한 칸으로. 등급 접두·층·부서는 그대로 */
export const exactNameKey = (name: string) => normText(name).replace(/\s+/g, " ").trim();
/** src/workinPlaces.ts addressGroupKey 와 같은 규칙(엣지에서 src 를 import 하지 않으려고 복사) */
export const addressKey = (address: string | null | undefined) => String(address || "").replace(/\s+/g, "").replace(/[^0-9a-z가-힣]/gi, "").toLowerCase();

/** 이름 느슨한 키 — 통합이력 검색어 규칙(historyCoreName: 등급 접두·㈜/(주)/주식회사·지점 꼬리 제거)으로 뽑은 핵심 이름. 2글자 미만이면 "" */
export const looseNameKey = (name: string): string => {
  const k = String(historyCoreName(String(name || "")) || "")
    .replace(/㈜|\(주\)/g, "")
    .replace(/[^0-9a-z가-힣]/gi, "")
    .toLowerCase()
    .replace(/(주식회사|유한회사|유한책임회사|재단법인|사단법인|농업회사법인|의료법인|학교법인)/g, "");
  return k.length >= 2 ? k : "";
};
const PROVINCE_TOKEN = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|제주|충북|충남|전북|전남|경북|경남|충청북|충청남|전라북|전라남|경상북|경상남)(특별시|광역시|특별자치시|특별자치도|시|도)?$/;
/**
 * 주소 앞부분 키 — 맨 앞 시·도 토큰을 떼고(서울특별시·서울·경기도 표기 차이 흡수) 첫 번지 토큰(숫자로 시작)의 번호까지만.
 * "서울특별시 강남구 테헤란로 1, 3층" 과 "서울 강남구 테헤란로 1 (역삼동)" → 같은 키. 번지가 없으면 시·도 뗀 전체. 6글자 미만이면 ""
 */
export function addressHeadKey(address: string | null | undefined): string {
  const tokens = normText(address).replace(/\n/g, " ").split(/\s+/).filter(Boolean);
  if (tokens.length && PROVINCE_TOKEN.test(tokens[0].replace(/[,.]$/, ""))) tokens.shift();
  const out: string[] = [];
  for (const t of tokens) {
    const n = /^산?\d+(?:-\d+)?/.exec(t);
    if (n) { out.push(n[0]); break; }
    out.push(t);
  }
  const k = out.join("").replace(/[^0-9a-z가-힣-]/gi, "").toLowerCase();
  return k.length >= 6 ? k : "";
}

// ── 짝짓기(v2-B2) ────────────────────────────────────────────────

export type MatchBy = "ext_id" | "exact_name" | "number_name" | "name_address";
export type MatchResult = {
  pairs: Array<{ remote: RemotePlace; local: LocalPlace; by: MatchBy }>;
  /** 후보 0 — 새 장소 */
  fresh: RemotePlace[];
  /** 후보 2개 이상(또는 같은 키 워킨맵 장소가 둘 이상) — 확인 큐 unmatched */
  ambiguous: Array<{ remote: RemotePlace; candidates: number[] }>;
  /** 이 워크에 붙어 있던 앱 행인데 이번 응답에 없음 — 확인 큐 missing(지우지 않는다) */
  missing: LocalPlace[];
  /** ext_id 빈 앱 행 중 이번에 짝 안 된 행(ambiguous 후보 포함) — dry 표본용 */
  unmatchedLocal: LocalPlace[];
};

/**
 * ① ext_id 같음 → ①-2(2차 실측 뒤) 정규화한 전체 이름 완전 일치, 워킨맵·앱 양쪽 다 1개 → ② (ext_id 빈 행 중) 번호 = 응답 순서 + 이름 키 같음,
 *   후보 1개 → ③ 이름 + 주소, 후보 1개.
 * ③(2026-10-31 첫 dry 실측 뒤 강화): 이름은 비교키(vendorMatchKey) 또는 느슨한 키(looseNameKey) 중 하나라도 같고,
 *   주소는 전체 키(addressKey) 또는 앞부분 키(addressHeadKey: 시·도 표기 무시, 번지까지) 중 하나라도 같으면 후보.
 * ③에서 후보 2개 이상이면 ambiguous(②의 후보 여럿은 ③으로 넘긴다). ③에서 한 앱 행을 워킨맵 장소 둘 이상이 후보로 잡으면 그 장소들 모두 ambiguous(같은 건물 2지점).
 * local 은 "ext_id 가 이 워크 장소인 행 + 같은 범위(팀·분기·업무)의 ext_id 빈 행"을 넘긴다. opts.workId 가 있으면 사라진 장소를 고른다.
 */
export function matchPlaces(remote: RemotePlace[], local: LocalPlace[], opts: { workId?: string } = {}): MatchResult {
  const byExt = new Map<string, LocalPlace>();
  for (const l of local) if (l.ext_id) byExt.set(l.ext_id, l);
  const used = new Set<number>();
  const pairs: MatchResult["pairs"] = [];
  const ambiguous: MatchResult["ambiguous"] = [];
  const fresh: RemotePlace[] = [];

  let rest: RemotePlace[] = [];
  for (const r of remote) {
    const l = byExt.get(r.extId);
    if (l && !used.has(l.id)) { pairs.push({ remote: r, local: l, by: "ext_id" }); used.add(l.id); } else rest.push(r);
  }

  const unlinked = local.filter((l) => !l.ext_id);
  // ①-2 정규화한 전체 이름 완전 일치(등급 접두·층·부서 포함 그대로), 양쪽 다 1개일 때만 — 같은 업체·같은 주소 기기 여러 대
  const exactCount = (list: Array<{ name: string }>) => {
    const c = new Map<string, number>();
    for (const x of list) { const k = exactNameKey(x.name); if (k) c.set(k, (c.get(k) || 0) + 1); }
    return c;
  };
  const remoteExact = exactCount(rest);
  const localExact = exactCount(unlinked.filter((l) => !used.has(l.id)));
  const afterExact: RemotePlace[] = [];
  for (const r of rest) {
    const k = exactNameKey(r.name);
    if (k && remoteExact.get(k) === 1 && localExact.get(k) === 1) {
      const l = unlinked.find((x) => !used.has(x.id) && exactNameKey(x.name) === k);
      if (l) { pairs.push({ remote: r, local: l, by: "exact_name" }); used.add(l.id); continue; }
    }
    afterExact.push(r);
  }
  rest = afterExact;

  // ② 번호 + 이름(후보 여럿이면 ③ 으로 넘김 — ambiguous 는 ③ 에서만)
  const afterStep2: RemotePlace[] = [];
  for (const r of rest) {
    const key = nameKey(r.name);
    const cands = key ? unlinked.filter((l) => !used.has(l.id) && Number(l.number) === r.seq && nameKey(l.name) === key) : [];
    if (cands.length === 1) { pairs.push({ remote: r, local: cands[0], by: "number_name" }); used.add(cands[0].id); }
    else afterStep2.push(r);
  }
  rest = afterStep2;

  // ③ 이름 + 주소
  type Keys = { names: string[]; addrs: string[] };
  const keysOf = (name: string, address: string | null | undefined): Keys => {
    const full = addressKey(address), head = addressHeadKey(address);
    return { names: [nameKey(name), looseNameKey(name)].filter(Boolean), addrs: [full ? `f:${full}` : "", head ? `h:${head}` : ""].filter(Boolean) };
  };
  const overlap = (a: string[], b: string[]) => a.some((x) => b.includes(x));
  const same = (a: Keys, b: Keys) => overlap(a.names, b.names) && overlap(a.addrs, b.addrs);
  const localKeys = new Map<number, Keys>();
  for (const l of unlinked) if (!used.has(l.id)) localKeys.set(l.id, keysOf(l.name, l.address));
  const candOf = new Map<string, LocalPlace[]>();
  const claims = new Map<number, number>();
  for (const r of rest) {
    const rk = keysOf(r.name, r.address);
    const cands = unlinked.filter((l) => localKeys.has(l.id) && same(rk, localKeys.get(l.id) as Keys));
    candOf.set(r.extId, cands);
    for (const c of cands) claims.set(c.id, (claims.get(c.id) || 0) + 1);
  }
  for (const r of rest) {
    const cands = candOf.get(r.extId) || [];
    if (cands.length === 0) { fresh.push(r); continue; }
    if (cands.length === 1 && (claims.get(cands[0].id) || 0) === 1) { pairs.push({ remote: r, local: cands[0], by: "name_address" }); used.add(cands[0].id); continue; }
    ambiguous.push({ remote: r, candidates: cands.map((c) => c.id) });
  }

  const remoteIds = new Set(remote.map((r) => r.extId));
  const missing = opts.workId ? local.filter((l) => l.ext_id && l.ext_work_id === opts.workId && !remoteIds.has(l.ext_id)) : [];
  const unmatchedLocal = unlinked.filter((l) => !used.has(l.id));
  return { pairs, fresh, ambiguous, missing, unmatchedLocal };
}

// ── 메모 합치기 ──────────────────────────────────────────────────

/** 가림 표식(src/workinPrivacy.ts hasMaskMark 와 같은 꼴) — 가린 주민번호가 원본을 덮거나 새 줄로 붙지 않게 */
export const hasMaskMark = (s: string): boolean => /\d{6}(?:\d{2})?-\d\*{6}/.test(String(s || ""));
const memoKey = (s: string) => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * 합집합 — 앱 줄은 그대로(순서·내용) 두고, 워킨맵 줄 중 앱에 없는 것만 워킨맵 순서대로 뒤에 붙인다.
 * 지우기·덮어쓰기 없음. 빈 줄·워킨맵 안 중복·가린 줄(******)은 붙이지 않는다. 비교는 공백 정리 후.
 */
export function mergeMemos(remoteLines: string[], localLines: string[]): { merged: string[]; added: string[] } {
  const local = Array.isArray(localLines) ? localLines.map((x) => String(x ?? "")) : [];
  const seen = new Set(local.map(memoKey));
  const added: string[] = [];
  for (const raw of Array.isArray(remoteLines) ? remoteLines : []) {
    const line = normText(raw);
    const key = memoKey(line);
    if (!key || seen.has(key) || hasMaskMark(line)) continue;
    seen.add(key);
    added.push(line);
  }
  return { merged: [...local, ...added], added };
}

// ── 차이 ─────────────────────────────────────────────────────────

export type Field = "label" | "visible" | "name" | "comment" | "phone" | "address" | "address_detail" | "coords" | "memos";
export type Change = { field: Field; before: unknown; after: unknown };

const sameText = (a: unknown, b: unknown) => normText(a) === normText(b);
const COORD_EPS = 1e-6;

/**
 * 짝지은 두 장소의 바뀐 칸. 응답에 없는 칸(null)·빈 이름·(0,0) 좌표·가린 코멘트는 바꾸지 않는다. 메모는 붙일 줄이 있을 때만.
 * 텍스트 칸은 normText 로 비교(줄바꿈 CRLF/LF·빈 줄·앞뒤 공백 차이만이면 변경 아님)하고, 바꿀 값(after)도 정규화한 LF 값이다.
 */
export function diffPlace(remote: RemotePlace, local: LocalPlace): Change[] {
  const out: Change[] = [];
  if (remote.label && remote.label !== local.label) out.push({ field: "label", before: local.label, after: remote.label });
  if (remote.visible !== null && remote.visible !== (local.visible !== false)) out.push({ field: "visible", before: local.visible, after: remote.visible });
  const text = (field: "name" | "comment" | "phone" | "address" | "address_detail", value: string | null, before: unknown) => {
    if (value === null || sameText(value, before)) return;
    out.push({ field, before, after: normText(value) });
  };
  if (normText(remote.name)) text("name", remote.name, local.name);
  if (remote.comment !== null && !hasMaskMark(remote.comment)) text("comment", remote.comment, local.comment);
  text("phone", remote.phone, local.phone);
  text("address", remote.address, local.address);
  text("address_detail", remote.addressDetail, local.address_detail);
  const lat = remote.latitude, lng = remote.longitude;
  if (lat !== null && lng !== null && !(lat === 0 && lng === 0)) {
    if (Math.abs(lat - Number(local.latitude || 0)) > COORD_EPS || Math.abs(lng - Number(local.longitude || 0)) > COORD_EPS) {
      out.push({ field: "coords", before: { latitude: local.latitude, longitude: local.longitude }, after: { latitude: lat, longitude: lng } });
    }
  }
  const memo = mergeMemos(remote.memos, local.memos || []);
  if (memo.added.length) out.push({ field: "memos", before: local.memos || [], after: memo.merged });
  return out;
}

// ── 충돌 규칙(v2-B6 + 사용자 "싹 다 가져온다") ──────────────────────

export type RuleContext = {
  /** 앱 행 updated_at */
  localUpdatedAt?: string | null;
  localUpdatedBy?: string | null;
  /** 앱 행 ext_synced_at / ext_last_update(지난 동기화 때의 워킨맵 last_update) */
  extSyncedAt?: string | null;
  extLastUpdate?: string | null;
  /** 이번 응답의 워킨맵 last_update */
  remoteLastUpdate?: string | null;
  /** 워크 업무(quarter·monthly·renewal) — monthly 는 G1~G4 가 진행 단계라 하강을 알림 대상으로 */
  kind?: string | null;
};
export type RuleResult = {
  apply: Change[];
  /**
   * 알림용 확인 큐(downgrade) — 2026-10-31 사용자 "지금은 기존 워킨맵이 주": 색은 이미 apply 에 들어가 반영되고,
   * 여기는 "이미 반영됨, 참고" 표시만(되돌리기는 workin_sync_log before/after). completion_down = G5·G12 → 그 밖, progress_down = 매월 G1~G4 단계 하강
   */
  review: Array<Change & { reason: "completion_down" | "progress_down" }>;
  /** 이번에 손대지 않음 */
  kept: Array<Change & { reason: "remote_unchanged" | "local_newer" }>;
};

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
/** 매월점검 진행 단계 G1(시작 전)·G2(1개월)·G3(2개월)·G4 → 1~4. 그 밖 색은 Infinity(하강 판정은 앞뒤 둘 다 G1~G4 일 때만) */
const progressRank = (label: unknown): number => {
  const m = /^G([1-4])$/.exec(String(label ?? ""));
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
};

/**
 * - 워킨맵이 지난 동기화 뒤로 안 바뀜(last_update ≤ ext_last_update) → 손대지 않음(앱에서 바꾼 값은 P2 되밀기 몫).
 * - 색은 매월·분기 가리지 않고 워킨맵 값을 반영한다(G2→G1, G5→G1 포함). 단 G5·G12 가 낮아지거나 매월 G1~G4 단계가 내려가면
 *   반영하면서 review 에도 남긴다(알림용, planPull 이 detail.applied=true 로 넣음).
 * - 지난 동기화 뒤 앱(동기화 아닌 사람)도 고쳤고 앱 쪽이 더 늦음 → 그 행은 앱 값 유지(메모 합치기는 예외 — 지우는 게 없어서).
 * - 나머지 전부 워킨맵 값(첫 동기화 포함).
 */
export function applyRules(diff: Change[], ctx: RuleContext): RuleResult {
  const res: RuleResult = { apply: [], review: [], kept: [] };
  const remoteMs = ms(ctx.remoteLastUpdate), extMs = ms(ctx.extLastUpdate);
  const remoteChanged = !Number.isFinite(extMs) || !Number.isFinite(remoteMs) || remoteMs > extMs;
  const localMs = ms(ctx.localUpdatedAt), syncedMs = ms(ctx.extSyncedAt);
  const localChanged = Number.isFinite(syncedMs) && Number.isFinite(localMs) && localMs > syncedMs && (ctx.localUpdatedBy || "") !== SYNC_ACTOR;
  const localNewer = localChanged && (!Number.isFinite(remoteMs) || localMs > remoteMs);
  for (const c of diff) {
    if (!remoteChanged) { res.kept.push({ ...c, reason: "remote_unchanged" }); continue; }
    if (c.field === "memos") { res.apply.push(c); continue; }
    if (localNewer) { res.kept.push({ ...c, reason: "local_newer" }); continue; }
    res.apply.push(c);
    if (c.field === "label") {
      if (isDone(c.before) && !isDone(c.after)) res.review.push({ ...c, reason: "completion_down" });
      else if (ctx.kind === "monthly" && progressRank(c.before) <= 4 && progressRank(c.after) < progressRank(c.before)) res.review.push({ ...c, reason: "progress_down" });
    }
  }
  return res;
}

// ── 가드 ─────────────────────────────────────────────────────────

/** 응답 장소 수 검사. 0곳 또는 평소(previousCount)의 50% 미만이면 중단 사유 */
export function workGuard(remoteCount: number, previousCount: number | null | undefined): "empty" | "shrunk" | null {
  if (!remoteCount) return "empty";
  const prev = Number(previousCount || 0);
  if (prev > 0 && remoteCount < prev * SHRINK_RATIO) return "shrunk";
  return null;
}

/** 새 장소: 그 워크의 첫 회차는 넣지 않고 확인 큐로, 한 회차 50곳 초과면 중단 */
export function newPlaceGuard(newCount: number, firstPull: boolean): "first_pull" | "too_many" | "ok" {
  if (newCount > NEW_PLACE_LIMIT) return "too_many";
  if (firstPull && newCount > 0) return "first_pull";
  return "ok";
}

// ── 날짜 ─────────────────────────────────────────────────────────

/** KST 날짜 YYYY-MM-DD (src/visits.ts kstDate 와 같은 결과, Intl 없이) */
export function kstYmdOf(iso: string | null | undefined, fallback: Date = new Date()): string {
  const t = iso ? Date.parse(iso) : NaN;
  const base = Number.isFinite(t) ? t : fallback.getTime();
  return new Date(base + 9 * 3600_000).toISOString().slice(0, 10);
}
export function kstParts(d: Date): { year: number; month: number; quarter: Quarter } {
  const k = new Date(d.getTime() + 9 * 3600_000);
  const month = k.getUTCMonth() + 1;
  return { year: k.getUTCFullYear(), month, quarter: Math.ceil(month / 3) as Quarter };
}

/** 앱 withLabelHistory 와 같은 머리 + " (워킨맵)" — completionDate 정규식(^\[(G5 완료|G12 이관)\]\s*날짜)이 그대로 읽는다 */
export function completionMemo(label: string, ymd: string): string | null {
  if (label === "G5") return `[G5 완료] ${ymd} (워킨맵)`;
  if (label === "G12") return `[G12 이관] ${ymd} (워킨맵)`;
  return null;
}

// ── 한 워크 계획 ──────────────────────────────────────────────────

/** workin_sync_review.kind (SQL check 와 같은 값) */
export type ReviewKind = "unmatched" | "ambiguous" | "new" | "missing" | "downgrade" | "conflict" | "field_diff" | "loop" | "format";
export type PlannedReview = { kind: ReviewKind; field: string; place_id: number | null; ext_id: string | null; work_id: string; account_no: number; detail: Record<string, unknown> };
/** workin_sync_log.field (SQL check 와 같은 값) */
export type LogField = "label" | "visible" | "memo" | "name" | "comment" | "phone" | "address" | "address_detail" | "latitude" | "longitude" | "number"
  | "_insert" | "_missing" | "_unmissing" | "_link" | "_unlink";
export type PlannedLog = { field: LogField; before_value: unknown; after_value: unknown };
export type PlannedPatch = { id: number; ext_id: string; set: Record<string, unknown>; fields: Field[]; by: MatchBy | "missing"; logs: PlannedLog[] };
export type PlannedInsert = { row: Record<string, unknown> & { id: number; ext_id: string }; log: PlannedLog };

export type PullInput = {
  workId: string;
  accountNo: number;
  parse: WorkParse;
  remote: RemotePlace[];
  local: LocalPlace[];
  /** 그 워크를 처음 가져오는가(workin_sync_works.first_pulled_at 없음) */
  firstPull: boolean;
  /** 평소 장소 수(지난 place_count 와 이 워크에 붙은 앱 행 수 중 큰 값) */
  previousCount: number | null;
  nowIso: string;
  /** 아직 처리 안 된 확인 큐 키(reviewKey) — 같은 건 다시 넣지 않는다 */
  openReviewKeys?: Set<string>;
  /** 새 행 id 시작값(앱과 같은 Date.now() 방식) · 이미 쓰는 id(충돌 피함) */
  idBase: number;
  takenIds?: Set<number>;
  /** 범위(팀·분기·업무) 안 최대 번호 — 새 장소는 그 뒤로 */
  scopeMaxNumber: number;
};

export type PullPlan = {
  stop: null | { reason: "empty" | "shrunk" | "too_many_new"; detail: string };
  patches: PlannedPatch[];
  inserts: PlannedInsert[];
  reviews: PlannedReview[];
  stats: {
    remote: number; matched: number; byExtId: number; byExactName: number; byNumberName: number; byNameAddress: number;
    changed: number; labelChanges: number; memoAdds: number; fresh: number; inserted: number;
    ambiguous: number; missing: number; downgrades: number; keptLocalNewer: number; linkedOnly: number;
  };
  /** 색 검증(v2 P1-3): label_color 분포와 처음 짝지은 곳의 앱 색 일치 수 */
  colorCheck: { histogram: Record<string, number>; firstMatchSame: number; firstMatchDiff: number };
  /** dry 판단용 표본(2026-10-31 첫 실측 뒤) — "이름 차이인지 진짜 새 장소인지"·"label_color→G 대응이 맞는지" 사람이 눈으로 보게 */
  samples: PullSamples;
};
export const SAMPLE_FRESH = 20;
export const SAMPLE_UNMATCHED = 20;
export const SAMPLE_COLOR_DIFF = 10;
export type PullSamples = {
  /** 새 장소(짝 없음) 앞 20곳 — 워킨맵 순서·이름·주소·label_color */
  fresh: Array<{ extId: string; seq: number; name: string; address: string | null; labelColor: number | null }>;
  /** 범위(팀·분기·업무) 안 ext_id 빈 앱 행 중 짝 안 된 행 앞 20곳 + 전체 수 */
  unmatchedLocal: Array<{ id: number; number: number; name: string; address: string }>;
  unmatchedLocalTotal: number;
  /** 처음 짝지은 곳 중 색이 다른 곳 앞 10곳 — 앱 G · 워킨맵 label_color · 그 번호를 G 로 바꾼 값 */
  colorDiff: Array<{ id: number; name: string; appLabel: string; workinmapColor: number | null; workinmapLabel: string | null }>;
};

/** 확인 큐 중복 키 — SQL workin_sync_review_open_uq(kind, field, work_id, ext_id, place_id)와 같은 칸 */
export const reviewKey = (r: { kind: string; field?: string | null; work_id?: string | null; ext_id?: string | null; place_id?: number | null }) =>
  `${r.kind}|${r.field ?? ""}|${r.work_id ?? ""}|${r.ext_id ?? ""}|${r.place_id ?? 0}`;

const FIELD_LOG: Record<Exclude<Field, "coords" | "memos">, LogField> = {
  label: "label", visible: "visible", name: "name", comment: "comment", phone: "phone", address: "address", address_detail: "address_detail",
};

/**
 * 기존 행 쓰기 묶음 — size 행씩, 행 = { id, ...바뀐 칸, updated_by }. 허용 칸 밖 키를 넣지 않는다(rpc 가 묶음 전체 예외).
 * rpc workin_sync_update_places(p_rows jsonb) 가 JSON 에 키가 있는 칸만 update 하고 없는 id 는 건너뛴다
 * (upsert 를 쓰지 않는 이유: 읽은 뒤 앱에서 지운 행이 기본값 빈 행으로 되살아나는 것을 막으려고).
 */
export function chunkPatchRows(patches: PlannedPatch[], size = 200): Array<{ rows: Array<Record<string, unknown>>; patches: PlannedPatch[] }> {
  const out: Array<{ rows: Array<Record<string, unknown>>; patches: PlannedPatch[] }> = [];
  for (let i = 0; i < patches.length; i += size) {
    const chunk = patches.slice(i, i + size);
    // updated_by 는 원소마다 꼭 — 헤더가 빠져도 되밀기 트리거가 동기화 쓰기로 보고 건너뛰게(SQL 규칙)
    out.push({ patches: chunk, rows: chunk.map((p) => ({ id: p.id, ...p.set, updated_by: SYNC_ACTOR })) });
  }
  return out;
}

// ── 일정(2026-10-31 사용자 결정: 가져오기 크론 하루 4회 KST 09·12·15·18시) ──
export const PULL_HOURS_KST = [9, 12, 15, 18] as const;
/** workin_sync_works.last_error 머리 — 시간 예산 초과로 다음 회차로 넘긴 워크(status "미완료 워크") */
export const DEFERRED_PREFIX = "미완료:";

/** 지금 뒤 첫 예정 시각(ISO). 18시가 지났으면 다음 날 09시 */
export function nextScheduledRun(nowMs: number): string {
  const k = new Date(nowMs + 9 * 3600_000);
  const dayStartUtc = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - 9 * 3600_000; // KST 자정
  for (let d = 0; d < 2; d += 1) {
    for (const h of PULL_HOURS_KST) {
      const t = dayStartUtc + d * 86_400_000 + h * 3600_000;
      if (t > nowMs) return new Date(t).toISOString();
    }
  }
  return new Date(dayStartUtc + 86_400_000 + PULL_HOURS_KST[0] * 3600_000).toISOString();
}

/** 한 워크의 가져오기 계획(쓰기 없음). 멈춤 사유가 있으면 patches·inserts·reviews 는 비어 있다 */
export function planPull(input: PullInput): PullPlan {
  const { workId, accountNo, parse, remote, nowIso } = input;
  const stats: PullPlan["stats"] = {
    remote: remote.length, matched: 0, byExtId: 0, byExactName: 0, byNumberName: 0, byNameAddress: 0, changed: 0, labelChanges: 0, memoAdds: 0,
    fresh: 0, inserted: 0, ambiguous: 0, missing: 0, downgrades: 0, keptLocalNewer: 0, linkedOnly: 0,
  };
  const histogram: Record<string, number> = {};
  for (const r of remote) { const k = r.labelColor === null ? "없음" : String(r.labelColor); histogram[k] = (histogram[k] || 0) + 1; }
  const colorCheck = { histogram, firstMatchSame: 0, firstMatchDiff: 0 };
  const samples: PullSamples = { fresh: [], unmatchedLocal: [], unmatchedLocalTotal: 0, colorDiff: [] };
  const stopped = (reason: "empty" | "shrunk" | "too_many_new", detail: string): PullPlan => ({ stop: { reason, detail }, patches: [], inserts: [], reviews: [], stats, colorCheck, samples });

  const guard = workGuard(remote.length, input.previousCount);
  if (guard) return stopped(guard, guard === "empty" ? "응답 0곳 — 전부 삭제로 보지 않고 중단" : `응답 ${remote.length}곳 < 평소 ${input.previousCount}곳의 절반`);

  const m = matchPlaces(remote, input.local, { workId });
  stats.fresh = m.fresh.length;
  stats.ambiguous = m.ambiguous.length;
  stats.missing = m.missing.length;
  samples.fresh = m.fresh.slice(0, SAMPLE_FRESH).map((r) => ({ extId: r.extId, seq: r.seq, name: r.name, address: r.address, labelColor: r.labelColor }));
  samples.unmatchedLocal = m.unmatchedLocal.slice(0, SAMPLE_UNMATCHED).map((l) => ({ id: l.id, number: l.number, name: l.name, address: l.address }));
  samples.unmatchedLocalTotal = m.unmatchedLocal.length;
  const freshGuard = newPlaceGuard(m.fresh.length, input.firstPull);
  if (freshGuard === "too_many") return stopped("too_many_new", `새 장소 ${m.fresh.length}곳 > ${NEW_PLACE_LIMIT}곳`);

  const open = input.openReviewKeys ?? new Set<string>();
  const reviews: PlannedReview[] = [];
  const pushReview = (r: Omit<PlannedReview, "work_id" | "account_no">) => {
    const full: PlannedReview = { ...r, work_id: workId, account_no: accountNo };
    const key = reviewKey(full);
    if (open.has(key)) return;
    open.add(key);
    reviews.push(full);
  };

  const patches: PlannedPatch[] = [];
  const linkCols = (r: RemotePlace) => ({
    ext_id: r.extId, ext_work_id: workId, ext_account_no: accountNo, ext_year: parse.year,
    ext_last_update: r.lastUpdate, ext_synced_at: nowIso, updated_by: SYNC_ACTOR,
  });
  const dayOf = (r: RemotePlace) => kstYmdOf(r.lastUpdate, new Date(nowIso));

  for (const { remote: r, local: l, by } of m.pairs) {
    stats.matched += 1;
    if (by === "ext_id") stats.byExtId += 1; else if (by === "exact_name") stats.byExactName += 1; else if (by === "number_name") stats.byNumberName += 1; else stats.byNameAddress += 1;
    if (by !== "ext_id" && r.label) {
      if (r.label === l.label) colorCheck.firstMatchSame += 1;
      else {
        colorCheck.firstMatchDiff += 1;
        if (samples.colorDiff.length < SAMPLE_COLOR_DIFF) samples.colorDiff.push({ id: l.id, name: l.name, appLabel: l.label, workinmapColor: r.labelColor, workinmapLabel: r.label });
      }
    }

    const rules = applyRules(diffPlace(r, l), {
      localUpdatedAt: l.updated_at, localUpdatedBy: l.updated_by, extSyncedAt: l.ext_synced_at, extLastUpdate: l.ext_last_update, remoteLastUpdate: r.lastUpdate, kind: parse.kind,
    });
    if (rules.kept.some((k) => k.reason === "local_newer")) stats.keptLocalNewer += 1;
    for (const c of rules.review) {
      stats.downgrades += 1;
      pushReview({ kind: "downgrade", field: c.field, place_id: l.id, ext_id: r.extId, detail: { applied: true, from: c.before, to: c.after, reason: c.reason, note: "이미 반영됨, 참고(되돌리기는 동기화 기록 before)", name: l.name, workinmap_last_update: r.lastUpdate } });
    }

    const set: Record<string, unknown> = {};
    const logs: PlannedLog[] = [];
    const fields: Field[] = [];
    const oldMemos = Array.isArray(l.memos) ? l.memos : [];
    let memos: string[] | null = null;
    for (const c of rules.apply) {
      fields.push(c.field);
      if (c.field === "coords") {
        const a = c.after as { latitude: number; longitude: number };
        set.latitude = a.latitude; set.longitude = a.longitude;
        if (a.latitude !== l.latitude) logs.push({ field: "latitude", before_value: l.latitude, after_value: a.latitude });
        if (a.longitude !== l.longitude) logs.push({ field: "longitude", before_value: l.longitude, after_value: a.longitude });
      } else if (c.field === "memos") {
        memos = c.after as string[];
      } else {
        set[c.field] = c.after;
        logs.push({ field: FIELD_LOG[c.field], before_value: c.before ?? null, after_value: c.after });
      }
    }
    // 완료로 바뀌면 이력 메모(주차분석 completionDate 가 읽는다) — 날짜는 워킨맵 last_update 의 KST 날짜
    if (typeof set.label === "string") {
      stats.labelChanges += 1;
      const entry = completionMemo(set.label, dayOf(r));
      const base = memos ?? oldMemos;
      const head = entry ? memoKey(entry).replace(/ \(워킨맵\)$/, "") : "";
      if (entry && !base.some((x) => memoKey(x).startsWith(head))) {
        memos = [...base, entry];
        if (!fields.includes("memos")) fields.push("memos");
      }
    }
    if (memos) {
      set.memos = memos;
      // 메모는 추가 항목마다 로그 1행(before null) — SQL 머리 "엣지 규칙"
      for (const item of memos.slice(oldMemos.length)) logs.push({ field: "memo", before_value: null, after_value: item });
      if (rules.apply.some((c) => c.field === "memos")) stats.memoAdds += 1;
    }

    const needsLink = l.ext_id !== r.extId || l.ext_work_id !== workId || Number(l.ext_account_no ?? NaN) !== accountNo || Number(l.ext_year ?? NaN) !== parse.year;
    const unmissing = Boolean(l.ext_missing_at);
    if (!fields.length && !needsLink && !unmissing) continue;
    if (fields.length) stats.changed += 1; else stats.linkedOnly += 1;
    if (l.ext_id !== r.extId) logs.push({ field: "_link", before_value: l.ext_id ?? null, after_value: { ext_id: r.extId, work_id: workId, account_no: accountNo, by } });
    if (unmissing) { set.ext_missing_at = null; logs.push({ field: "_unmissing", before_value: l.ext_missing_at, after_value: null }); }
    patches.push({ id: l.id, ext_id: r.extId, set: { ...set, ...linkCols(r) }, fields, by, logs });
  }

  for (const a of m.ambiguous) {
    pushReview({ kind: "ambiguous", field: "", place_id: null, ext_id: a.remote.extId, detail: { name: a.remote.name, address: a.remote.address, label: a.remote.label, candidates: a.candidates } });
  }
  // 사라진 장소: 지우지 않는다. 처음 본 때만 ext_missing_at 기록 + 로그 + 확인 큐
  for (const l of m.missing) {
    if (l.ext_missing_at) continue;
    patches.push({
      id: l.id, ext_id: l.ext_id || "", set: { ext_missing_at: nowIso, updated_by: SYNC_ACTOR }, fields: [], by: "missing",
      logs: [{ field: "_missing", before_value: null, after_value: nowIso }],
    });
    pushReview({ kind: "missing", field: "", place_id: l.id, ext_id: l.ext_id ?? null, detail: { name: l.name, address: l.address, label: l.label } });
  }

  const inserts: PlannedInsert[] = [];
  if (freshGuard === "first_pull") {
    for (const r of m.fresh) pushReview({ kind: "new", field: "", place_id: null, ext_id: r.extId, detail: { name: r.name, address: r.address, label: r.label, first_pull: true } });
  } else {
    const taken = input.takenIds ?? new Set<number>();
    let nextId = input.idBase;
    let nextNumber = Math.max(0, Number(input.scopeMaxNumber) || 0);
    for (const r of m.fresh) {
      while (taken.has(nextId)) nextId += 1;
      taken.add(nextId);
      nextNumber += 1;
      const label = r.label || "G12";
      const memos = mergeMemos(r.memos, []).merged;
      const entry = completionMemo(label, dayOf(r));
      if (entry) memos.push(entry);
      // 행 모양 = src/WalkingMap.tsx handleExcelImport → toDbPlace 와 같은 칸(updated_at 은 서버 트리거가 채움) + ext_*
      const row = {
        id: nextId, number: nextNumber, team: parse.team, quarter: parse.quarter, kind: parse.kind,
        label, visible: r.visible ?? true, name: r.name, comment: r.comment ?? "", phone: r.phone ?? "",
        address: r.address ?? "", address_detail: r.addressDetail ?? "",
        latitude: r.latitude ?? 0, longitude: r.longitude ?? 0, memos,
        ...linkCols(r),
      };
      inserts.push({ row, log: { field: "_insert", before_value: null, after_value: row } });
      nextId += 1;
    }
    stats.inserted = inserts.length;
  }

  return { stop: null, patches, inserts, reviews, stats, colorCheck, samples };
}

// ── 요청·인증 ─────────────────────────────────────────────────────

export type SyncRequest =
  | { action: "works" }
  | { action: "pull"; scope: "current" | "old" | { workId: string }; dryRun: boolean; manual?: boolean }
  | { action: "status" }
  | { action: "login_test"; account: number }
  | { action: "push" };

export function parseRequest(body: unknown): SyncRequest | { error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const action = String(b.action ?? "");
  if (action === "works" || action === "status" || action === "push") return { action };
  if (action === "login_test") {
    const n = Number(b.account ?? b.n);
    if (!Number.isInteger(n) || n < 1 || n > 9) return { error: "account 는 1~9" };
    return { action, account: n };
  }
  if (action === "pull") {
    const raw = String(b.scope ?? "current").trim();
    const scope = raw === "current" || raw === "old" ? raw : /^[0-9a-f]{24}$/i.test(raw) ? { workId: raw } : null;
    if (!scope) return { error: "scope 는 current | old | 워크 id(24자리)" };
    // manual: 관리 탭에서 누른 호출 — 일부 실패여도 200(ok:false)으로 결과 표를 돌려준다. 크론(manual 없음)은 500 → edge_call_health 가 잡는다
    return { action, scope, dryRun: b.dryRun === true, manual: b.manual === true };
  }
  return { error: "action 은 works | pull | status | login_test | push" };
}

/** schedule-report/logic.ts 와 같은 규칙 — 이 프로젝트 ref · role anon|service_role · 만료 전, 또는 service role 키 글자 일치 */
export function jwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
export function isAuthorized(authorization: string | null, ctx: { projectRef: string; serviceKey?: string; nowMs: number }): boolean {
  const bearer = (authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return false;
  if (ctx.serviceKey && bearer === ctx.serviceKey) return true;
  const p = jwtPayload(bearer);
  if (!p) return false;
  const roleOk = p.role === "anon" || p.role === "service_role";
  const refOk = Boolean(ctx.projectRef) && p.ref === ctx.projectRef;
  const expOk = typeof p.exp !== "number" || p.exp * 1000 > ctx.nowMs;
  return roleOk && refOk && expOk;
}
export function projectRefOf(url: string): string {
  const m = /^https?:\/\/([a-z0-9]+)\./i.exec(url || "");
  return m ? m[1] : "";
}

/** app_config 값 → 켜짐(정확히 "true" 만) */
export const switchOn = (v: unknown) => String(v ?? "").trim().toLowerCase() === "true";

/** app_config JSON 배열 또는 줄·쉼표 목록 → 문자열 배열. 비면 fallback */
export function listConfig(v: unknown, fallback: string[]): string[] {
  const s = String(v ?? "").trim();
  if (!s) return fallback;
  try {
    const j = JSON.parse(s);
    if (Array.isArray(j)) return j.map((x) => String(x));
  } catch { /* 줄 목록으로 */ }
  return s.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
}
