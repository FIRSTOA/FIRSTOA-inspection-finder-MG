/**
 * 부품 신청·자가 신청(여분) 읽기 — 점검·AS 양식 글의 ※부품신청※ / ※자가신청※ 칸을 품목 단위 행으로 (2026-10-11)
 *
 * 왜: 그동안 이 칸은 보고 원문 속 글로만 저장돼 "이 기기 드럼 언제 갈았지", "여분 몇 개 신청했어"를 통합검색이 못 찾았다.
 *     양식이 고정이라 확실히 읽힌다. 앱(src)과 엣지 함수가 같이 쓰므로 순수 함수만(브라우저·Deno 공용).
 * 나중에 자가 반납·부품 반납·사용 후 부품 관리와 잇기 위해 행마다 returned_at·return_note 자리를 둔다(표 쪽).
 *
 * 양식 예(AS 보고 2026-10-08):
 *   ※부품신청※ / 보증기간 내 여부 : 무 / 교체 전 카운터 누적 사용매수 : 305091 / 사용 부품 예상 사용매수 : 305091 / ▶ 신청 부품 / 물품명: 드럼1,현상기1 / 수량: / 출고여부: 선출고완료
 *   ※자가신청※ / 물품: K2 / 수량: / 출고여부: 출고부탁드립니다
 */
export type SupplyKind = "부품" | "자가";
export type SupplyItem = {
  kind: SupplyKind;
  item: string;        // 품목(드럼, 현상기, 토너 K …)
  qty: string;         // 수량 — 품목 끝에 붙은 숫자("드럼1") 또는 수량 칸
  status: string;      // 출고여부
  warranty: string;    // 보증기간 내 여부(부품만)
  counter: string;     // 교체 전 카운터(부품만)
  expected: string;    // 사용 부품 예상 사용매수(부품만)
  raw: string;         // 그 칸 원문
};
export type DeviceRef = { model: string; serial: string; asset: string };

const clean = (s: string) => String(s || "").replace(/_x000d_|\r/g, "").trim();
const DIVIDER = /^[ㅡ―—=_-]{3,}\s*$/;

/** 글에서 "※부품신청※" 또는 "※자가신청※" 칸만 잘라낸다(다음 구분선·다음 ※칸·끝까지) */
export function sectionOf(text: string, head: "※부품신청※" | "※자가신청※"): string {
  const lines = clean(text).split("\n");
  const start = lines.findIndex((l) => l.trim().startsWith(head));
  if (start < 0) return "";
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const l = lines[i].trim();
    if (DIVIDER.test(l) || /^※.+※/.test(l) || /^도착 시간\s*:/.test(l)) break;
    out.push(lines[i]);
  }
  return out.join("\n");
}

const field = (section: string, label: RegExp): string => {
  for (const line of section.split("\n")) {
    const m = line.match(label);
    if (m) return clean(line.slice(m[0].length)).replace(/^[:：]\s*/, "");
  }
  return "";
};

/** "드럼1,현상기1" / "픽업롤러1,롤러2,부싱2,클러치1" / "K2" / "토너 K 2개, 폐토너통 1" → 품목·수량 */
export function splitItems(value: string): Array<{ item: string; qty: string }> {
  const raw = clean(value);
  if (!raw || /^(없음|무|x|-)$/i.test(raw)) return [];
  return raw.split(/[,，·/]+|\s{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => {
    // 끝의 숫자(+개/EA)가 수량 — "드럼1", "현상기 2개", "K2", "폐토너통1EA"
    const m = p.match(/^(.*?)[\s]*(\d+)\s*(개|ea|EA|장|통|본)?$/);
    if (m && m[1].trim()) return { item: m[1].trim(), qty: m[2] };
    return { item: p, qty: "" };
  });
}

/** 보고 글 하나 → 신청 행들. 물품이 비어 있으면(양식만 있는 것) 아무것도 돌려주지 않는다 */
export function parseSupplyRequests(text: string): SupplyItem[] {
  const out: SupplyItem[] = [];
  const parts = sectionOf(text, "※부품신청※");
  if (parts) {
    const items = splitItems(field(parts, /^\s*물품명\s*[:：]/));
    const qty = field(parts, /^\s*수량\s*[:：]/);
    const status = field(parts, /^\s*출고\s*여부\s*[:：]/);
    const warranty = field(parts, /^\s*보증기간\s*내\s*여부\s*[:：]?/);
    const counter = field(parts, /^\s*교체\s*전\s*카운터[^:：]*[:：]/);
    const expected = field(parts, /^\s*사용\s*부품\s*예상[^:：]*[:：]/);
    for (const it of items) out.push({ kind: "부품", item: it.item, qty: it.qty || qty, status, warranty, counter, expected, raw: parts.trim() });
  }
  const self = sectionOf(text, "※자가신청※");
  if (self) {
    const items = splitItems(field(self, /^\s*물품\s*[:：]/));
    const qty = field(self, /^\s*수량\s*[:：]/);
    const status = field(self, /^\s*출고\s*여부\s*[:：]/);
    for (const it of items) out.push({ kind: "자가", item: it.item, qty: it.qty || qty, status, warranty: "", counter: "", expected: "", raw: self.trim() });
  }
  return out;
}

/** 보고 글의 첫 기기(1. 모델명/시리얼넘버/자산기번) — 신청을 어느 기기에 붙일지 */
export function firstDeviceOf(text: string): DeviceRef {
  const t = clean(text);
  const pick = (re: RegExp) => { const m = t.match(re); return m ? clean(m[1]) : ""; };
  return {
    model: pick(/모델명\s*[:：]\s*([^\n]*)/),
    serial: pick(/시리얼\s*(?:넘버|번호)\s*[:：]\s*([^\n]*)/),
    asset: pick(/자산\s*기번\s*[:：]\s*([^\n]*)/),
  };
}

/** 같은 보고·같은 품목은 어느 길로 넣어도 한 번만 — 전송 때(앱)와 지난 기록 채우기(원문)가 같은 키를 쓴다 */
export function supplyDupSource(sourceTable: string, date: string, author: string, vendor: string, s: SupplyItem): string {
  return [sourceTable, date, author, clean(vendor), s.kind, s.item, s.qty].join("|");
}

// ── 표준화(2026-10-11): 재고 표의 품목 사전(별칭·쓰는 기종·색)으로 이름을 맞추고 "1세트"를 색별로 푼다 ──
export type CatalogItem = { id: string; kind: string; name: string; category: string; color: string; aliases: string[]; models: string[] };
export type NormalizedItem = SupplyItem & { itemStd: string; category: string; color: string; stockItemId: string; setLabel: string };

const squash = (s: string) => String(s || "").toLowerCase().replace(/[\s\-_/·.()[\]]/g, "");
const COLOR_WORDS: Array<[RegExp, string]> = [
  [/^(k|bk|b|black|검정|블랙|흑백|모노)$/i, "K"], [/^(c|cyan|시안|사이안|청색|파랑)$/i, "C"], [/^(m|magenta|마젠타|마젠다|빨강|적색)$/i, "M"], [/^(y|yellow|옐로우|옐로|노랑|황색)$/i, "Y"],
];
const colorOf = (word: string): string => {
  let w = String(word || "").replace(/토너/g, "").trim();
  const mm = w.match(/^\d{3,4}\s*([kcmy])$/i);          // "420K" = 420 기종의 K 토너
  if (mm) w = mm[1];
  for (const [re, c] of COLOR_WORDS) if (re.test(w)) return c;
  return "";
};
/**
 * 기본 품목 — 사전(재고 표)이 비어 있거나 못 맞출 때 쓴다. 2026-10-11 지난 기록 1,081행의 실제 표기에서 뽑은 별칭.
 * 색이 붙는 부품(드럼·현상기·현상제·드럼칩)은 "드럼 K"처럼 색을 뒤에 붙인 이름이 된다.
 */
export const BUILTIN: CatalogItem[] = [
  { id: "", kind: "자가", name: "토너 K", category: "토너", color: "K", aliases: ["K", "검정", "검정토너", "블랙", "BK"], models: [] },
  { id: "", kind: "자가", name: "토너 C", category: "토너", color: "C", aliases: ["C", "시안", "파랑"], models: [] },
  { id: "", kind: "자가", name: "토너 M", category: "토너", color: "M", aliases: ["M", "마젠타", "빨강"], models: [] },
  { id: "", kind: "자가", name: "토너 Y", category: "토너", color: "Y", aliases: ["Y", "옐로우", "노랑"], models: [] },
  { id: "", kind: "자가", name: "토너", category: "토너", color: "", aliases: ["토너", "카트리지", "토너카트리지"], models: [] },
  { id: "", kind: "자가", name: "폐토너통", category: "폐토너통", color: "", aliases: ["폐", "폐통", "폐토너", "폐토너박스", "폐토너통", "웨이스트토너", "WT"], models: [] },
  { id: "", kind: "부품", name: "드럼", category: "드럼", color: "", aliases: ["드럼", "드럼유닛", "DRUM", "이미징유닛", "감광드럼"], models: [] },
  { id: "", kind: "부품", name: "드럼칩", category: "드럼칩", color: "", aliases: ["드럼칩", "드럼 칩"], models: [] },
  { id: "", kind: "부품", name: "현상기", category: "현상기", color: "", aliases: ["현상기", "현상유닛", "DEV", "데브"], models: [] },
  { id: "", kind: "부품", name: "현상제", category: "현상제", color: "", aliases: ["현상제", "현상재", "디벨로퍼", "developer"], models: [] },
  { id: "", kind: "부품", name: "정착기", category: "정착기", color: "", aliases: ["정착기", "퓨저", "FUSER", "휴저", "정착유닛", "퓨저유닛", "정창기"], models: [] },
  { id: "", kind: "부품", name: "정착모터", category: "모터", color: "", aliases: ["정착모터", "정착 모터"], models: [] },
  { id: "", kind: "부품", name: "전사벨트", category: "전사벨트", color: "", aliases: ["전사벨트", "ITB", "전사유닛", "벨트", "밸트", "벨트 아쎄이", "2ndBTR", "2nd BTR", "BTR"], models: [] },
  { id: "", kind: "부품", name: "전사벨트 블레이드", category: "전사벨트", color: "", aliases: ["전사벨트블레이드", "전사벨트 블레이드", "벨트블레이드", "벨트 블레이드", "전사블레이드", "벨트브레이드", "벨트 브레이드", "전사밸트 블레이드", "전사밸트블레이드", "전사벨트 클리너", "벨트클리너"], models: [] },
  { id: "", kind: "부품", name: "블레이드", category: "블레이드", color: "", aliases: ["블레이드", "브레이드", "블레아드"], models: [] },
  { id: "", kind: "부품", name: "픽업롤러", category: "롤러", color: "", aliases: ["픽업롤러", "픽업 롤러", "픽업", "급지롤러", "급지 롤러", "피드롤러", "피드 롤러"], models: [] },
  { id: "", kind: "부품", name: "롤러", category: "롤러", color: "", aliases: ["롤러", "롤라"], models: [] },
  { id: "", kind: "부품", name: "하드", category: "하드", color: "", aliases: ["하드", "HDD", "하드디스크", "리퍼하드"], models: [] },
  { id: "", kind: "부품", name: "ADF", category: "ADF", color: "", aliases: ["ADF", "원고이송"], models: [] },
  { id: "", kind: "부품", name: "클러치", category: "기타", color: "", aliases: ["클러치"], models: [] },
  { id: "", kind: "부품", name: "부싱", category: "기타", color: "", aliases: ["부싱", "부쉬"], models: [] },
  { id: "", kind: "부품", name: "분리패드", category: "기타", color: "", aliases: ["분리패드", "급지패드", "리타드패드", "리타드 패드", "패드"], models: [] },
  { id: "", kind: "부품", name: "리타드커버", category: "기타", color: "", aliases: ["리타드커버", "리타드 커버"], models: [] },
  { id: "", kind: "부품", name: "코일", category: "기타", color: "", aliases: ["코일"], models: [] },
  { id: "", kind: "부품", name: "IH보드", category: "보드", color: "", aliases: ["IH보드", "IH 보드"], models: [] },
  { id: "", kind: "부품", name: "고압보드", category: "보드", color: "", aliases: ["고압보드", "고압 보드", "HVPS"], models: [] },
  { id: "", kind: "부품", name: "메인보드", category: "보드", color: "", aliases: ["메인보드", "메인 보드", "보드"], models: [] },
  { id: "", kind: "부품", name: "기어", category: "기타", color: "", aliases: ["기어", "리프팅기어", "리프팅 기어", "엑시트기어", "엑시트 기어"], models: [] },
  { id: "", kind: "부품", name: "센서", category: "기타", color: "", aliases: ["센서", "아웃풋센서", "아웃풋 센서", "인센서"], models: [] },
  { id: "", kind: "부품", name: "모터", category: "모터", color: "", aliases: ["모터", "디스팬스모터", "디스팬스 모터", "디스펜스모터", "디스펜스 모터"], models: [] },
  { id: "", kind: "부품", name: "LPH", category: "기타", color: "", aliases: ["LPH"], models: [] },
  { id: "", kind: "부품", name: "트레이", category: "기타", color: "", aliases: ["트레이", "1번트레이", "1번 트레이", "급지부", "1단급지부", "용지함"], models: [] },
  { id: "", kind: "부품", name: "배지부", category: "기타", color: "", aliases: ["배지부"], models: [] },
  { id: "", kind: "부품", name: "리저브", category: "기타", color: "", aliases: ["리저브", "리저브탱크"], models: [] },
];
/** 색이 붙는 품목 — "드럼 K"·"현상기 C"처럼 색을 뒤에 붙인 표준 이름이 된다 */
const COLORABLE = new Set(["토너", "드럼", "현상기", "현상제", "드럼칩"]);

/** 컬러기인지 — 사전의 기종표가 있으면 그걸로, 없으면 기종명으로 짐작(2026-10-11 실제 기종 목록 기준) */
export function isColorModel(model: string, catalog: CatalogItem[] = []): boolean {
  const key = squash(model);
  if (key) {
    const toners = catalog.filter((c) => c.category === "토너" && c.models.some((m) => squash(m) === key));
    if (toners.length) return toners.some((c) => c.color && c.color !== "K");
  }
  if (!key) return false;
  // 확실한 컬러 표기: cdn/cdw 꼬리, 교세라 M55xx·MA2100
  if (/cdn|cdw|^(?:ecosys-?)?m55\d\d|^(?:ecosys-?)?ma2\d{3}/.test(key)) return true;
  // 흑백: 삼성 SL-K·SL-M(K4250·M3870…), 브라더 L5xxx, 교세라 P 계열, bizhub 숫자만, 흑백 기종 숫자 약칭
  if (/^(?:samsung)?(?:sl-?)?[km]\d{4}|^(?:mfc-?)?l5\d{3}|^ecosys-?p|^bizhub-?\d|^(?:128|3870|4080|4250|4255|4305|5100|5700)(?:[a-z]|$)/.test(key)) return false;
  // 컬러: 삼성 SL-X·CLX·CLP, 신도 D3xx·D4xx, OKI ES5473, 제록스 Apeos/DocuCentre/DocuPrint C, HP PageWide, 브라더 L8900CDW …
  if (/^(?:samsung)?(?:sl-?)?x\d|clx|clp|^d[345]\d\d|^es\d|apeos|^ap(?:[iv]+)?-?c\d|^ac\d|docucentre|docuprint-?c|^c\d{4}|^hp|mfcl8|mfcl9|컬러/.test(key)) return true;
  // 숫자만 적은 기종(3220·4220·7400·2060·320·450…) — 이 회사 기기에서 숫자만 쓰는 것은 거의 컬러기
  if (/^(?:3220|3280|4220|4225|4300|7400|7500|7600|2060|2061|2263|2271|2273|2275|2276|2560|2567|3070|3373|3375|3376|4473|4570|5005|5570|5573|5575|5580|320|410|420|450|470|2100|2101|5473|5521|5526)(?:[a-z]+)?$/.test(key)) return true;
  return false;
}

/** 사전에서 이름 찾기 — 이름·별칭을 공백 없이 비교, 못 찾으면 글 안에 든 가장 긴 별칭 */
export function matchCatalog(raw: string, catalog: CatalogItem[], kind?: SupplyKind): CatalogItem | null {
  const key = squash(raw);
  if (!key) return null;
  const pool = [...catalog, ...BUILTIN].filter((c) => c.kind !== "기기" && (!kind || c.kind === kind || c.category === "토너" || c.category === "폐토너통"));
  for (const c of pool) if (squash(c.name) === key || c.aliases.some((a) => squash(a) === key)) return c;
  let best: { c: CatalogItem; len: number } | null = null;
  for (const c of pool) for (const a of [c.name, ...c.aliases]) { const ak = squash(a); if (ak.length >= 2 && key.includes(ak) && (!best || ak.length > best.len)) best = { c, len: ak.length }; }
  return best?.c || null;
}

const tonerStd = (color: string, catalog: CatalogItem[]): { name: string; id: string } => {
  const hit = [...catalog, ...BUILTIN].find((c) => c.category === "토너" && c.color === color);
  return { name: hit?.name || `토너 ${color}`, id: hit?.id || "" };
};

// ── 품목 글 하나를 조각(색 토너 · 폐토너통 · 부품[+색] · 세트)으로 나누기 (2026-10-11, 실제 표기 400여 종 기준) ──
type Piece = { kind: "toner" | "waste" | "part" | "set"; base: string; cat: CatalogItem | null; color: string; qty: string; setColors?: "all" | "cmy" };
const NOISE = /(마블|베니|보탄|세이토|헤라클래스|헤라|소라이|신도|삼성|제록스|교세라|후지|브라더|정품|리퍼|수리품|재생|유상수리|외관|상태좋은것)/g;
const MODEL_WORD = /^(?:[a-z]{0,3}\d{3,5}[a-z]{0,4}|mx\d)$/;          // 804 · x3220nr · d450 · ma2100 · k7500lx · mx7
const COLOR_TOKEN = /^(?:[kcmyb]\d*)+$/;
const COLOR_PREFIX = /^(kcmy|kcm|kcy|kmy|cmy|kc|km|ky|cm|cy|my|bk|k|c|m|y|컬러|컬|흑백|모노|블랙|black)(?=.)/;
const toColor = (ch: string) => (ch === "b" || ch === "bk" ? "K" : ch.toUpperCase());
const prefixColors = (p: string): string[] => (/^(컬러|컬)$/.test(p) ? ["컬러"] : /^(흑백|모노|블랙|black|bk)$/.test(p) ? ["K"] : p.split("").map(toColor));
const qtyList = (qty: string): number[] => {
  const s = String(qty || "").trim();
  if (/^1{2,}$/.test(s)) return s.split("").map(() => 1);                 // "1111" = 하나씩
  return s.split(/[,./]/).map((v) => parseInt(v.replace(/[^\d]/g, ""), 10)).filter((n) => Number.isFinite(n) && n > 0);
};

/** 사전·기본 품목의 별칭(공백 없는 소문자) → 품목. 긴 별칭이 먼저 */
function aliasTable(catalog: CatalogItem[]): Array<[string, CatalogItem]> {
  const out: Array<[string, CatalogItem]> = [];
  for (const c of [...catalog, ...BUILTIN]) {
    if (c.kind === "기기") continue;
    for (const a of [c.name, ...c.aliases]) { const k = squash(a); if (k.length >= 2 || /^[가-힣]$/.test(k)) out.push([k, c]); }
  }
  return out.sort((a, b) => b[0].length - a[0].length);
}

/** 한 낱말 안의 부품들 — "k현상제2c현상제" → 현상제 K 2 · 현상제 C, "컬러드럼1" → 드럼 컬러 1, "mx3정착기" → 정착기 */
function consumeParts(word: string, table: Array<[string, CatalogItem]>): Piece[] | null {
  const out: Piece[] = [];
  let rest = word;
  let guard = 0;
  while (rest && guard++ < 8) {
    let colors: string[] = [];
    let hit: [string, CatalogItem] | undefined;
    // 색 접두 + 색 붙는 부품("k현상제"·"블랙드럼"·"컬러드럼칩")이 통째 별칭("블랙"=토너 K)보다 먼저
    const cp = rest.match(COLOR_PREFIX);
    if (cp) { const after = rest.slice(cp[1].length); const h2 = table.find(([k]) => after.startsWith(k)); if (h2 && COLORABLE.has(h2[1].category) && h2[1].category !== "토너") { colors = prefixColors(cp[1]); rest = after; hit = h2; } }
    if (!hit) hit = table.find(([k]) => rest.startsWith(k));
    if (!hit && cp) {
      const after = rest.slice(cp[1].length); const h2 = table.find(([k]) => after.startsWith(k));
      if (h2) { colors = prefixColors(cp[1]); rest = after; hit = h2; }
    }
    if (!hit) {
      // 앞에 모르는 글자(기종 약칭 등)가 붙은 것 — 가장 앞에서 시작하는 별칭을 찾는다
      let best: { at: number; h: [string, CatalogItem] } | null = null;
      for (const h of table) { const at = rest.indexOf(h[0]); if (at > 0 && (!best || at < best.at || (at === best.at && h[0].length > best.h[0].length))) best = { at, h }; }
      if (!best) break;
      const head = rest.slice(0, best.at);
      const cp = head.match(/^(kcmy|kcm|kcy|kmy|cmy|kc|km|ky|cm|cy|my|bk|k|c|m|y|컬러|컬|흑백|모노|블랙)$/);
      if (cp) colors = prefixColors(cp[1]);
      rest = rest.slice(best.at); hit = best.h;
    }
    rest = rest.slice(hit[0].length);
    const qm = rest.match(/^(\d+)(?:개씩|개|ea|장|통|본|씩)?/);
    const qty = qm ? qm[1] : "";
    if (qm) rest = rest.slice(qm[0].length);
    rest = rest.replace(/^(개씩|개|ea|씩|각)/, "");
    const c = hit[1];
    if (c.category === "토너") { for (const col of colors.length ? colors : [c.color || ""]) out.push({ kind: "toner", base: "토너", cat: c, color: col, qty }); continue; }
    if (c.category === "폐토너통") { out.push({ kind: "waste", base: "폐토너통", cat: c, color: "", qty }); continue; }
    const canColor = COLORABLE.has(c.category);
    for (const col of canColor && colors.length ? colors : [""]) out.push({ kind: "part", base: c.name, cat: c, color: canColor ? col || c.color || "" : "", qty });
  }
  return out.length ? out : null;
}

/** 품목 글 → 조각들. null 이면 아무것도 못 읽음(미정의) */
function piecesOf(item: string, qty: string, model: string, catalog: CatalogItem[]): Piece[] | null {
  const table = aliasTable(catalog);
  let t = String(item || "").toLowerCase()
    .replace(/[*"'“”`]/g, " ")
    .replace(/(한|하나)\s*(세트|셋트|셋|set)/g, "1$2").replace(/두\s*(세트|셋트|셋|set)/g, "2$2").replace(/세\s*(세트|셋트|셋|set)/g, "3$2")
    .replace(NOISE, " ")
    .replace(/[().,/·\-_:;]+/g, " ")
    .replace(/토너/g, " 토너 ");
  // 띄어 쓴 별칭("리타드 패드"·"2nd btr"·"드럼 칩")은 붙여서 한 낱말로
  for (const [k, c] of table) {
    if (c.category === "토너" || c.category === "폐토너통") continue;   // "토너 C"는 이름이지 붙일 별칭이 아니다("토너 cmy"를 먹지 않게)
    for (const a of [c.name, ...c.aliases]) { const al = a.toLowerCase(); if (al.includes(" ") && t.includes(al)) t = t.split(al).join(k); }
  }
  const queue = t.split(/\s+/).filter(Boolean);
  const pieces: Piece[] = [];
  let pending: Piece[] = [];      // 아직 어디 붙을지 모르는 색 토큰(뒤에 색 붙는 부품이 오면 그 부품의 색, 아니면 토너)
  let open: Piece[] = [];         // 수량이 아직 없는 조각들 — 다음에 숫자가 오면 받는다
  let lastPart: Piece | null = null;
  let tonerMark = false, tonerQty = "", pendingNum = "";
  const flush = () => { for (const p of pending) pieces.push(p); pending = []; };
  const colorablePart = (p: Piece | null): p is Piece => !!p && p.kind === "part" && COLORABLE.has(p.cat?.category || "") && pieces[pieces.length - 1] === p;
  const pushColors = (units: Array<[string, string]>) => {
    // 색 토큰 — 바로 앞이 색 붙는 부품이면 그 부품을 색별로("드럼 K 1 C 1 M"), 아니면 토너(보류)
    if (colorablePart(lastPart)) {
      let cur = lastPart;
      for (const [c, q] of units) {
        if (!cur.color) { cur.color = c; if (q) { cur.qty = q; open = []; } else open = [cur]; continue; }
        const clone: Piece = { ...cur, color: c, qty: q };
        pieces.push(clone); cur = clone; lastPart = clone;
        if (!q) open.push(clone); else open = [];
      }
      return;
    }
    for (const [c, q] of units) { const p: Piece = { kind: "toner", base: "토너", cat: null, color: c, qty: q }; pending.push(p); if (!q) open.push(p); else open = []; }
  };
  const parseUnits = (tok: string): Array<[string, string]> => Array.from(tok.matchAll(/([kcmyb])(\d*)/g)).map((m) => [toColor(m[1]), m[2]] as [string, string]);
  while (queue.length) {
    let w = queue.shift() as string;
    if (/^(각|각각|씩|개|개씩|ea|장|통|본|x|×)$/.test(w)) continue;
    if (w === "토너") { tonerMark = true; continue; }
    w = w.replace(/^\d{3,5}(?=[가-힣])/, "");                           // "704폐통2" · "5575세이토"
    // 낱말 끝의 폐토너통("k1폐" · "1set폐" · "폐통2")
    const wm = w.match(/^(.*?)(폐토너통|폐토너박스|폐토너|폐통|폐)(\d*)$/);
    if (wm) {
      if (wm[1]) { queue.unshift(`${wm[2]}${wm[3]}`); w = wm[1]; }
      else { flush(); const p: Piece = { kind: "waste", base: "폐토너통", cat: null, color: "", qty: wm[3] }; pieces.push(p); open = wm[3] ? [] : [p]; lastPart = null; continue; }
    }
    const mc = w.match(/^\d{3,5}((?:[kcmyb]\d*)+)$/);                   // "806k1" · "808m" · "2271m" · "420k"
    if (mc) w = mc[1];
    if (MODEL_WORD.test(w)) continue;                                   // 기종 표기(x3220nr · d450 · 804 …)
    const num = w.match(/^(?:각|각각)?(\d+)(?:개씩|개|ea|장|통|본|씩)?$/);
    if (num) {
      if (open.length) { for (const p of open) p.qty = num[1]; open = []; }
      else if (tonerMark && !pieces.length && !pending.length) tonerQty = num[1];
      else pendingNum = num[1];
      continue;
    }
    let sm = w.match(/^(풀)?(\d*)(세트|셋트|셋|set)(\d*)$/);
    let cmyOnly = false;
    if (!sm) { const km = w.match(/^컬(?:러)?(\d*)(세트|셋트|셋)$/); if (km) { sm = ["", "", km[1], km[2], ""] as unknown as RegExpMatchArray; cmyOnly = true; } }
    if (sm) {
      const n = sm[2] || sm[4] || pendingNum || "";
      pendingNum = "";
      if (colorablePart(lastPart)) { lastPart.kind = "set"; lastPart.qty = n; lastPart.setColors = cmyOnly ? "cmy" : "all"; open = n ? [] : [lastPart]; continue; }
      flush();
      const p: Piece = { kind: "set", base: "토너", cat: null, color: "", qty: n, setColors: cmyOnly ? "cmy" : "all" };
      pieces.push(p); open = n ? [] : [p]; lastPart = null; continue;
    }
    const ct = w.match(/^((?:[kcmyb]\d*)+)(?:개씩|개|ea|씩)?$/);           // "cmy1개씩" · "k2"
    if (ct && COLOR_TOKEN.test(ct[1])) { pushColors(parseUnits(ct[1])); continue; }
    const cw = colorOf(w);
    if (cw) { pushColors([[cw, ""]]); continue; }
    if (/^(컬러|컬)$/.test(w)) { pending.push({ kind: "toner", base: "토너", cat: null, color: "컬러", qty: "" }); continue; }
    const parts = consumeParts(w, table);
    if (!parts) continue;                                               // 모르는 낱말(하단·아쎄이…)은 건너뛴다
    for (const p of parts) {
      if (p.kind === "part" && COLORABLE.has(p.cat?.category || "") && !p.color && pending.length && pending.every((x) => x.kind === "toner")) {
        // 앞에 둔 색 토큰이 이 부품의 색 — "C.M 현상기" → 현상기 C · 현상기 M, "흑백 드럼" → 드럼 K
        const cols = pending; pending = []; open = [];
        for (const c of cols) { const q = p.qty || c.qty; const piece: Piece = { ...p, color: c.color, qty: q }; pieces.push(piece); if (!q) open.push(piece); lastPart = piece; }
        continue;
      }
      flush();
      if (p.kind === "toner" && !p.color) { tonerMark = true; if (p.qty) tonerQty = p.qty; continue; }
      pieces.push(p); open = p.qty ? [] : [p]; lastPart = p.kind === "part" ? p : null;
    }
  }
  flush();
  // 색 없는 "토너"만 적힌 것("토너 3", "토너3 폐") — 흑백기면 K, 컬러기면 무슨 색인지 몰라 미정의
  if (tonerMark && !pieces.some((p) => p.kind === "toner" || p.kind === "set")) {
    if (!isColorModel(model, catalog)) pieces.unshift({ kind: "toner", base: "토너", cat: null, color: "K", qty: tonerQty });
    else if (!pieces.length) return null;
  }
  // "컬러"만 남은 보류는 버린다
  const real = pieces.filter((p) => !(p.kind === "toner" && p.color === "컬러"));
  if (!real.length) return null;
  // 수량 칸 — 조각이 하나면 그대로, 여럿이고 "1,1,1,2"처럼 조각 수와 같으면 차례로, 아니면 빈 것은 1
  const list = qtyList(qty);
  if (real.length === 1) { if (!real[0].qty) real[0].qty = String(list[0] || 1); }
  else if (list.length === real.length) real.forEach((p, i) => { if (!p.qty) p.qty = String(list[i]); });
  for (const p of real) if (!p.qty) p.qty = "1";
  return real;
}

/** 읽은 품목들을 표준화·세트 풀기 — 결과 행 수는 늘어날 수 있다(세트 → 색별, "K2 C1" → 2행, "KCMY 각1" → 4행, "k현상기 k현상제" → 2행) */
export function normalizeItems(items: SupplyItem[], catalog: CatalogItem[], model: string): NormalizedItem[] {
  const out: NormalizedItem[] = [];
  const base = (s: SupplyItem): NormalizedItem => ({ ...s, itemStd: "", category: "", color: "", stockItemId: "", setLabel: "" });
  const exact = (name: string): CatalogItem | undefined => { const k = squash(name); return catalog.find((c) => squash(c.name) === k); };
  for (const s of items) {
    const pieces = piecesOf(s.item, s.qty, model, catalog);
    if (!pieces) { out.push(base(s)); continue; }           // 미정의 품목 — 재고 탭에서 별칭을 지정하면 다음부터 맞는다
    const rows: NormalizedItem[] = [];
    for (const p of pieces) {
      if (p.kind === "set") {
        const isPart = !!p.cat && p.cat.category !== "토너";
        const colors = p.setColors === "cmy" ? ["C", "M", "Y"] : isColorModel(model, catalog) ? ["K", "C", "M", "Y"] : ["K"];
        for (const c of colors) {
          if (isPart) { const name = `${p.base} ${c}`; const hit = exact(name); rows.push({ ...base(s), item: name, qty: p.qty, itemStd: name, category: p.cat!.category, color: c, stockItemId: hit?.id || "", setLabel: s.item }); }
          else { const t = tonerStd(c, catalog); rows.push({ ...base(s), item: t.name, qty: p.qty, itemStd: t.name, category: "토너", color: c, stockItemId: t.id, setLabel: s.item }); }
        }
        continue;
      }
      if (p.kind === "toner") { const t = tonerStd(p.color, catalog); rows.push({ ...base(s), item: t.name, qty: p.qty, itemStd: t.name, category: "토너", color: p.color, stockItemId: t.id }); continue; }
      if (p.kind === "waste") { const w = matchCatalog("폐토너통", catalog, "자가"); rows.push({ ...base(s), item: w?.name || "폐토너통", qty: p.qty, itemStd: w?.name || "폐토너통", category: "폐토너통", color: "", stockItemId: w?.id || "" }); continue; }
      const name = p.color ? `${p.base} ${p.color}` : p.base;
      const hit = p.color ? exact(name) : p.cat;
      rows.push({ ...base(s), item: name, qty: p.qty, itemStd: name, category: p.cat?.category || "", color: p.color, stockItemId: hit?.id || "" });
    }
    // 조각이 하나면 원래 적은 글을 그대로 둔다(표준 이름은 itemStd). 여럿이면 행마다 표준 이름이 품목(중복키가 갈리도록)
    if (rows.length === 1 && !rows[0].setLabel) rows[0].item = s.item;
    out.push(...rows);
  }
  return out;
}

/**
 * 신청의 성격(2026-10-11 사용자 사례): 현장에서 차량 재고를 바로 줬으면 "차량재고"(그 업체에 이미 지급, 출고는 차량 보충),
 * 재고가 없어 다음에 가져다주면 "출고요청". 실제 쓰임(2026-10-11 사용자): 신청은 거의 "출고부탁드립니다"이고 "선출고완료"는 전날 신청해
 * 다음 날 준 것이라 역시 그냥 신청이다 → "차량재고"·"보충"이라고 분명히 적은 경우만 차량재고, 나머지는 전부 출고요청.
 */
export type SupplyMode = "차량재고" | "출고요청";
export function modeOf(status: string, section = ""): SupplyMode {
  const t = `${status || ""} ${section || ""}`.replace(/\s+/g, "");
  if (/차량재고|차량에서|보충/.test(t)) return "차량재고";
  return "출고요청";
}
