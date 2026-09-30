// 점검 리포트 재료(reportForm) — 점검·AS 양식 원문(jeomgeom/as_records._원문)을 고객에게 보여 줄 값으로 바꾼다(2026-09-30).
// 양식은 FIELD 점검 탭이 만든 고정 형식이라 라벨 줄을 그대로 읽는다. 내부용 항목(레벨·등급·한틴이카·주차비·부품/자가신청)은 읽지 않는다.
export type TonerKey = "K" | "C" | "M" | "Y";
export type ReportDevice = {
  index: number;
  model: string;
  serial: string;
  asset: string;
  mono: number | null;   // 흑백 누적
  color: number | null;  // 컬러 누적
  total: number | null;
  toner: Record<TonerKey, number | null>; // 잔량 %
  waste: number | null;  // 폐토너통 남은 여유 %(양식의 '폐통' 값)
  spare: Record<TonerKey | "W", number | null>; // 사무실 보관 여분(W=폐토너통)
  spareNote: string;     // 여분 보관 위치 등 덧붙인 줄
  content: string;       // 내용(AS 접수 내용)
  work: string;          // 처리내용
  note: string;          // 특이사항
};
export type ReportData = {
  vendor: string;
  author: string;
  keymanName: string;
  keymanPhone: string;
  devices: ReportDevice[];
  album: string;
  albumCount: number;
  arrival: string;
};

// 기준(2026-09-30 CS팀): 토너 잔량 25% 이하면 교체, 폐토너통도 여유 25% 이하면 교체 예정(양식의 폐통 %는 남은 여유)
export const TONER_LOW = 25;
export const WASTE_LOW = 25;

const DIVIDER = /^[ \t]*[ㅡ\-=─_]{5,}[ \t]*$/;
const LABELS = ["작성자", "구분", "레벨", "등급", "업체명", "부서명", "지역", "키맨/접수자", "모델명", "시리얼넘버", "자산기번", "내용", "처리내용", "매수", "토너잔량", "폐통", "여분", "한틴이카유무", "주차비지원유무", "특이사항", "도착 시간", "소요 시간"];
const LABEL_RE = new RegExp("^[ \\t]*(" + LABELS.map((l) => l.replace(/[/ ]/g, (c) => (c === "/" ? "\\/" : "\\s*"))).join("|") + ")[ \\t]*[:：]");

const num = (v: string | undefined): number | null => { const m = String(v || "").replace(/,/g, "").match(/\d+/); return m ? Number(m[0]) : null; };
const PHONE_RE = /01\d[- ]?\d{3,4}[- ]?\d{4}|0\d{1,2}[- ]?\d{3,4}[- ]?\d{4}/;

// 라벨 값(같은 줄) + 라벨 없는 다음 줄들(다른 라벨·구분선 전까지)
function field(lines: string[], label: string, multiline = false): string {
  const re = new RegExp("^[ \\t]*" + label.replace("/", "\\/").replace(" ", "\\s*") + "[ \\t]*[:：][ \\t]*(.*)$");
  const at = lines.findIndex((l) => re.test(l));
  if (at < 0) return "";
  const first = (lines[at].match(re) || [])[1] || "";
  if (!multiline) return first.trim();
  const rest: string[] = [];
  for (let i = at + 1; i < lines.length; i++) { const l = lines[i]; if (LABEL_RE.test(l) || DIVIDER.test(l) || /^[ \t]*※/.test(l)) break; if (l.trim()) rest.push(l.trim()); }
  return [first.trim(), ...rest].filter(Boolean).join("\n");
}

function parseDevice(block: string[], index: number): ReportDevice | null {
  const model = field(block, "모델명");
  const serial = field(block, "시리얼넘버");
  const asset = field(block, "자산기번");
  if (!model && !serial && !asset) return null;
  const count = field(block, "매수");
  const mono = num((count.match(/흑\s*([\d,]+)/) || [])[1]);
  const color = num((count.match(/컬\s*([\d,]+)/) || [])[1]);
  const total = num((count.match(/합\s*([\d,]+)/) || [])[1]);
  const tonerText = field(block, "토너잔량");
  const toner = { K: null, C: null, M: null, Y: null } as Record<TonerKey, number | null>;
  for (const k of ["K", "C", "M", "Y"] as TonerKey[]) { const m = tonerText.match(new RegExp("(?:^|[\\s,/])" + k + "\\s*[-:=]?\\s*(\\d+)", "i")); if (m) toner[k] = Math.min(100, Number(m[1])); }
  const waste = num(field(block, "폐통"));
  const spareAll = field(block, "여분", true);
  const spareLines = spareAll.split("\n");
  const spareText = spareLines[0] || "";
  const spare = { K: null, C: null, M: null, Y: null, W: null } as Record<TonerKey | "W", number | null>;
  for (const k of ["K", "C", "M", "Y"] as TonerKey[]) { const m = spareText.match(new RegExp("(?:^|[\\s,/])" + k + "\\s*[-:=]?\\s*(\\d+)", "i")); if (m) spare[k] = Number(m[1]); }
  // "토너 2set 폐-2" / "2세트" / "각 2개" — 색별 숫자가 없으면 세트 수를 네 색에 똑같이(2026-09-30 제이앤노무법인)
  if (["K", "C", "M", "Y"].every((k) => spare[k as TonerKey] == null)) {
    const set = spareText.match(/(\d+)\s*(?:set|세트|셋트|셋|조)(?![a-z가-힣])/i) || spareText.match(/각\s*(\d+)/); // \b는 한글 뒤에서 안 잡힌다(JS 정규식은 한글을 단어 문자로 안 본다)
    if (set) for (const k of ["K", "C", "M", "Y"] as TonerKey[]) spare[k] = Number(set[1]);
  }
  const w = spareText.match(/폐\s*(?:통|토너)?\s*[-:=]?\s*(\d+)/); if (w) spare.W = Number(w[1]);
  return { index, model, serial, asset, mono, color, total, toner, waste, spare, spareNote: spareLines.slice(1).join(" ").trim(), content: field(block, "내용", true), work: field(block, "처리내용", true), note: field(block, "특이사항", true) };
}

// 키맨 칸은 자유 서식이다: "010-… 위지혜 팀장", "이은선 차장님 5층에 계심", "김수경차장님 본사총괄 02-561-6512 임미애 담당자님 010-5245-4254".
// 리포트(MMS)는 휴대폰으로만 가므로 ① 첫 휴대폰(01X) 번호를 받는 번호로 ② 그 번호 바로 옆에 적힌 사람을 키맨 이름으로(직함까지만, 위치 메모 제외).
const MOBILE_RE = /01\d[- .]?\d{3,4}[- .]?\d{4}/;
const ROLE_WORD = "(?:팀장|차장|부장|과장|대리|사원|실장|소장|원장|이사|대표|사장|주임|매니저|선생님|간호사|총무|담당자|교수|박사|프로|기사)";
const PURE_ROLE = new RegExp(`^${ROLE_WORD}(?:님)?$`);
const ENDS_ROLE = new RegExp(`(?:${ROLE_WORD}(?:님)?|님)$`);
const tokensOf = (segment: string) => segment.replace(/[()/,·]/g, " ").split(/\s+/).filter((t) => t && !/^\d[\d-]*$/.test(t) && !/^T:?$/i.test(t));
// 직함이 붙은 사람("위지혜 팀장", "김수경차장님")만 — 없으면 빈 값(호출부가 다른 조각으로 넘어간다)
function personIn(segment: string, nearEnd: boolean): string {
  const tokens = tokensOf(segment);
  const hits = tokens.map((t, i) => (ENDS_ROLE.test(t) ? i : -1)).filter((i) => i >= 0);
  if (!hits.length) return "";
  const i = nearEnd ? hits[hits.length - 1] : hits[0];
  const group = PURE_ROLE.test(tokens[i]) && i > 0 ? [tokens[i - 1], tokens[i]] : [tokens[i]];
  return group.join(" ");
}
const firstWords = (segment: string) => tokensOf(segment).slice(0, 2).join(" ");
export function keymanMobile(raw: string): string {
  return (String(raw || "").match(MOBILE_RE) || [""])[0].replace(/[^\d]/g, "");
}
export function keymanDisplayName(raw: string): string {
  const text = String(raw || "").replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  const m = text.match(MOBILE_RE);
  let name = "";
  if (m && m.index != null) {
    const after = text.slice(m.index + m[0].length).split(PHONE_RE)[0]; // 번호 뒤 ~ 다음 번호 전
    const before = text.slice(0, m.index).split(PHONE_RE).pop() || "";    // 직전 번호 뒤 ~ 이 번호 전
    // 직함 있는 사람 우선(번호 뒤 → 번호 앞), 없으면 번호 앞 낱말("김담당 010-…") → 번호 뒤 낱말
    name = personIn(after, false) || personIn(before, true) || firstWords(before) || firstWords(after);
  } else {
    const plain = text.replace(PHONE_RE, " ");
    name = personIn(plain, false) || firstWords(plain);
  }
  return name.replace(/님$/, "").trim();
}

export function parseInspectionForm(raw: string): ReportData {
  const text = String(raw || "").replace(/\r/g, "");
  const lines = text.split("\n");
  const firstDivider = lines.findIndex((l) => DIVIDER.test(l));
  const header = firstDivider >= 0 ? lines.slice(0, firstDivider) : lines;
  const keyman = field(header, "키맨/접수자", true).replace(/\n/g, " ");
  const phone = keymanMobile(keyman);
  const keymanName = keymanDisplayName(keyman);
  // 기기 블록: 첫 구분선 ~ ※부품신청※ 사이를 구분선으로 나눈다
  const partsAt = lines.findIndex((l) => /※\s*부품신청\s*※/.test(l));
  const body = firstDivider >= 0 ? lines.slice(firstDivider + 1, partsAt > firstDivider ? partsAt : undefined) : [];
  const blocks: string[][] = [];
  let cur: string[] = [];
  for (const l of body) { if (DIVIDER.test(l)) { if (cur.length) blocks.push(cur); cur = []; } else cur.push(l); }
  if (cur.length) blocks.push(cur);
  const devices = blocks.map((b, i) => parseDevice(b, i + 1)).filter((d): d is ReportDevice => !!d);
  const album = (text.match(/https?:\/\/\S+\?album=[\w-]+/) || [""])[0];
  const albumCount = num((text.match(/현장사진\s*(\d+)\s*장/) || [])[1]) || 0;
  return { vendor: field(header, "업체명", true).split("\n")[0].trim(), author: field(header, "작성자"), keymanName, keymanPhone: phone, devices, album, albumCount, arrival: field(lines, "도착 시간") };
}

// 지난 점검과 같은 기기 짝짓기(자산기번 → 시리얼 → 순서) — 사용량 증가분 계산용
export function matchPrevious(device: ReportDevice, prev: ReportData | null): ReportDevice | null {
  if (!prev) return null;
  const byAsset = device.asset && prev.devices.find((d) => d.asset && d.asset === device.asset);
  const bySerial = device.serial && prev.devices.find((d) => d.serial && d.serial === device.serial);
  return byAsset || bySerial || prev.devices[device.index - 1] || null;
}
export const delta = (now: number | null, before: number | null): number | null => (now == null || before == null || now < before ? null : now - before);
export const fmt = (n: number | null) => (n == null ? "-" : n.toLocaleString("ko-KR"));
export const tonerLow = (v: number | null) => v != null && v <= TONER_LOW;
export const wasteLow = (v: number | null) => v != null && v <= WASTE_LOW;
