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
  return raw.split(/[,，·\/]+|\s{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => {
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

const squash = (s: string) => String(s || "").toLowerCase().replace(/[\s\-_/·.()\[\]]/g, "");
const COLOR_WORDS: Array<[RegExp, string]> = [
  [/^(k|bk|black|검정|블랙|흑백)$/i, "K"], [/^(c|cyan|시안|사이안|청색|파랑)$/i, "C"], [/^(m|magenta|마젠타|마젠다|빨강|적색)$/i, "M"], [/^(y|yellow|옐로우|옐로|노랑|황색)$/i, "Y"],
];
const colorOf = (word: string): string => { const w = String(word || "").replace(/토너/g, "").trim(); for (const [re, c] of COLOR_WORDS) if (re.test(w)) return c; return ""; };

/** 컬러기인지 — 사전의 기종표가 있으면 그걸로, 없으면 기종명으로 짐작(컬러 계열: CLX·X7·C22xx·C25xx·Apeos C·MFC-L8900CDW·CLP…) */
export function isColorModel(model: string, catalog: CatalogItem[] = []): boolean {
  const key = squash(model);
  if (key) {
    const toners = catalog.filter((c) => c.category === "토너" && c.models.some((m) => squash(m) === key));
    if (toners.length) return toners.some((c) => c.color && c.color !== "K");
  }
  return /clx|clp|x7|x4|c2[0-9]{3}|c3[0-9]{3}|c4[0-9]{3}|apeosc|docucentrevc|cdw|cdn|mfcl8|mfcl9|컬러/i.test(key);
}

/** 사전에서 이름 찾기 — 이름·별칭을 공백 없이 비교, 못 찾으면 글 안에 든 가장 긴 별칭 */
export function matchCatalog(raw: string, catalog: CatalogItem[], kind?: SupplyKind): CatalogItem | null {
  const key = squash(raw);
  if (!key) return null;
  const pool = catalog.filter((c) => c.kind !== "기기" && (!kind || c.kind === kind || c.category === "토너" || c.category === "폐토너통"));
  for (const c of pool) if (squash(c.name) === key || c.aliases.some((a) => squash(a) === key)) return c;
  let best: { c: CatalogItem; len: number } | null = null;
  for (const c of pool) for (const a of [c.name, ...c.aliases]) { const ak = squash(a); if (ak.length >= 2 && key.includes(ak) && (!best || ak.length > best.len)) best = { c, len: ak.length }; }
  return best?.c || null;
}

const tonerStd = (color: string, catalog: CatalogItem[]): { name: string; id: string } => {
  const hit = catalog.find((c) => c.category === "토너" && c.color === color);
  return { name: hit?.name || `토너 ${color}`, id: hit?.id || "" };
};

/** 읽은 품목들을 표준화·세트 풀기 — 결과 행 수는 늘어날 수 있다(세트 → 색별, "K2 C1" → 2행, "KCMY 각1" → 4행) */
export function normalizeItems(items: SupplyItem[], catalog: CatalogItem[], model: string): NormalizedItem[] {
  const out: NormalizedItem[] = [];
  const base = (s: SupplyItem): NormalizedItem => ({ ...s, itemStd: "", category: "", color: "", stockItemId: "", setLabel: "" });
  for (const s of items) {
    const text = `${s.item}${s.qty ? ` ${s.qty}` : ""}`.trim();
    // "1세트" / "세트 1" / "1set" / "풀세트" / "토너 1세트"
    const setM = text.match(/(?:^|\s)(?:토너\s*)?(?:(\d+)\s*)?(세트|셋트|set)(?:\s*(\d+))?(?:\s|$)/i) || (/풀\s*세트/i.test(text) ? ["", "1", "세트", ""] as unknown as RegExpMatchArray : null);
    if (setM && s.kind === "자가") {
      const n = String(setM[1] || setM[3] || "1");
      const colors = isColorModel(model, catalog) ? ["K", "C", "M", "Y"] : ["K"];
      for (const c of colors) { const t = tonerStd(c, catalog); out.push({ ...base(s), item: t.name, qty: n, itemStd: t.name, category: "토너", color: c, stockItemId: t.id, setLabel: text }); }
      continue;
    }
    // "KCMY 각1" / "kcmy 1개씩"
    const eachM = text.match(/^\s*(?:토너\s*)?([kcmy]{2,4})\s*(?:각|각각|씩)?\s*(\d+)?\s*(?:개|씩|개씩)?\s*$/i);
    if (eachM && s.kind === "자가") {
      for (const ch of eachM[1].toUpperCase().split("")) { const t = tonerStd(ch, catalog); out.push({ ...base(s), item: t.name, qty: eachM[2] || "1", itemStd: t.name, category: "토너", color: ch, stockItemId: t.id }); }
      continue;
    }
    // "K2 C1 M1" 처럼 색+숫자 토큰이 여럿
    const tokens = text.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2 && tokens.every((tk) => /^[kcmy]\d*$/i.test(tk))) {
      for (const tk of tokens) { const c = tk[0].toUpperCase(); const t = tonerStd(c, catalog); out.push({ ...base(s), item: t.name, qty: tk.slice(1) || "1", itemStd: t.name, category: "토너", color: c, stockItemId: t.id }); }
      continue;
    }
    // 색 낱말 하나("K", "검정토너", "토너 Y")
    const c1 = colorOf(s.item);
    if (c1) { const t = tonerStd(c1, catalog); out.push({ ...base(s), item: t.name, qty: s.qty || "1", itemStd: t.name, category: "토너", color: c1, stockItemId: t.id }); continue; }
    // 사전
    const hit = matchCatalog(s.item, catalog, s.kind);
    if (hit) { out.push({ ...base(s), itemStd: hit.name, category: hit.category, color: hit.color, stockItemId: hit.id }); continue; }
    out.push(base(s));   // 미정의 품목 — 관리 탭에서 별칭을 지정하면 다음부터 맞는다
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
