/**
 * 점검/AS 양식 텍스트 → 26칸 레코드 파서 (기존 GAS Kakao.gs 로직의 충실한 포팅).
 *
 *  - isInspectForm / isASForm : 구분 값으로 점검/AS 판별
 *  - extractFields            : 라벨 기준 필드 추출 (extractInspectField_ 동일)
 *  - dupKey                   : MD5(업체명 + 21개 표시컬럼) — GAS dupKey_ 와 동일
 *  - buildRecords             : webappSaveInspection_ 의 추출 흐름과 동일
 *
 *  ※ 실제 데이터(_원문)로 파싱 결과·MD5 일치 검증 완료.
 */
import { md5 } from "./md5";

// 통합시트 점검/AS 탭의 21개 표시컬럼 (순서 고정 — dupKey 계산에 사용)
export const DISPLAY_COLS = [
  "작성일", "작성자", "구분", "레벨", "등급", "업체명", "부서명", "지역", "키맨/접수자",
  "모델명", "시리얼넘버", "자산기번", "내용", "처리내용",
  "매수", "토너잔량", "폐통", "여분", "한틴이카유무", "주차비지원유무", "특이사항",
];

const SINGLE_FIELDS = [
  "작성자", "구분", "레벨", "부서명", "지역", "키맨/접수자",
  "모델명", "시리얼넘버", "자산기번",
  "매수", "토너잔량", "폐통", "여분", "한틴이카유무", "주차비지원유무", "특이사항",
];

const EMPTY_LABEL_RE = /^(작성자|구분|레벨|등급|업체명|부서명|지역|키맨\/접수자|모델명|시리얼넘버|자산기번|내용|처리내용|매수|토너잔량|폐통|여분|한틴이카유무|주차비지원유무|특이사항)\s*[:：]?\s*$/;
const FIELD_LABEL_PATTERN = "작성자|구분|레벨|등급|업체명|부서명|지역|키맨\\/접수자|모델명|시리얼넘버|자산기번|내용|처리내용|매수|토너잔량|폐통|여분|한틴이카유무|주차비지원유무|특이사항";

export type Row = Record<string, string>;
export type BuiltRecords = {
  hasInspect: boolean;
  hasAS: boolean;
  inspect?: Row;
  as?: Row;
  region: string;
};

export function isInspectForm(content: string): boolean {
  const m = String(content).match(/구분\s*[:：]\s*([^\n\r]{0,60})/);
  if (!m) return false;
  return /점\s*검/.test(m[1]);
}

export function isASForm(content: string): boolean {
  const m = String(content).match(/구분\s*[:：]\s*([^\n\r]{0,40})/);
  if (!m) return false;
  return /A\s*\/?\s*S/i.test(m[1]);
}

function extractField(content: string, label: string, multiline: boolean): string {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    "(?:^|[\\r\\n])" + esc + "\\s*[:：]?\\s*([\\s\\S]*?)(?=[\\r\\n](?:(?:" + FIELD_LABEL_PATTERN + ")\\s*[:：]|[-=]{2,}|※|＊|\\*)|$)"
  );
  const match = content.match(pattern);
  if (!match) return "";
  let val = match[1].trim();
  val = val.replace(/[\r\n]+\s*[-=*※＊].*$/, "").trim();
  if (!val) return "";
  if (EMPTY_LABEL_RE.test(val)) return "";
  return multiline ? val : val.split(/[\r\n]/)[0].trim();
}

function extractFields(content: string): Record<string, string> {
  const f: Record<string, string> = {};
  SINGLE_FIELDS.forEach((lab) => { f[lab] = extractField(content, lab, false); });
  f["업체명"] = extractField(content, "업체명", false);
  f["내용"] = extractField(content, "내용", true);
  f["처리내용"] = extractField(content, "처리내용", true);
  const gm = content.match(/등급\s*[:：]?\s*\(?\s*([^),\n\r]+?)\s*[,)\r\n]/);
  if (gm) {
    const v = gm[1].trim();
    if (v && v !== "1 , 2 , 3" && v !== "1,2,3" && !/^\d?\s*,\s*\d/.test(v)) f["등급"] = v;
  }
  return f;
}

// MD5(업체명 + 21개 표시컬럼 값) — GAS dupKey_ 와 동일 (점검/AS 는 dedupKeyFields 없음 → displayCols 전체)
export function dupKey(vendor: string, obj: Record<string, string>): string {
  const parts = [String(vendor || "").trim()];
  for (const c of DISPLAY_COLS) {
    const v = obj[c];
    parts.push(v == null ? "" : String(v).trim());
  }
  return md5(parts.join(""));
}

function nowKst(): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

// 추출된 sparse obj(비어있지 않은 칸만) → 26칸 완성 행 + 헬퍼/ _dupKey
function buildRow(vendor: string, obj: Record<string, string>, raw: string, srcLabel: string): Row {
  const row: Row = {};
  for (const c of DISPLAY_COLS) row[c] = obj[c] == null ? "" : String(obj[c]);
  row["_업체명"] = vendor;
  row["_출처"] = srcLabel;
  row["_원문"] = raw || "";
  row["_등록시각"] = nowKst();
  row["_dupKey"] = dupKey(vendor, obj);
  return row;
}

// content 에서 한 종류(점검/AS) sparse obj 추출. 업체명 없으면 null.
function extractObj(content: string, dateStr: string, author: string, regionFallback: string, asDefault: boolean): { vendor: string; obj: Record<string, string> } | null {
  const f = extractFields(content);
  const vendor = f["업체명"];
  if (!vendor || vendor.length < 2 || /^부서명/.test(vendor)) return null;
  if (!f["작성자"]) f["작성자"] = String(author || "").replace(/님$/, "");
  if (!f["지역"]) f["지역"] = regionFallback || "";
  if (!f["작성일"]) f["작성일"] = dateStr || "";
  if (asDefault && !f["구분"]) f["구분"] = "AS";
  const obj: Record<string, string> = {};
  for (const c of DISPLAY_COLS) { if (f[c] != null && String(f[c]).trim() !== "") obj[c] = f[c]; }
  obj["업체명"] = vendor;
  return { vendor, obj };
}

const SRC_LABEL = "카톡:웹앱";

/** webappSaveInspection_ 와 동일: 구분에 따라 점검/AS 행을 만든다. */
export function buildRecords(text: string, dateStr: string, author: string, regionFallback: string): BuiltRecords {
  const content = String(text || "");
  const hasInspect = isInspectForm(content);
  const hasAS = isASForm(content);
  let inspect: Row | undefined;
  let as: Row | undefined;
  let region = "";

  if (hasInspect) {
    const r = extractObj(content, dateStr, author, regionFallback, false);
    if (r) { inspect = buildRow(r.vendor, r.obj, content, SRC_LABEL); region = region || (r.obj["지역"] || ""); }
  }
  if (hasAS) {
    const r = extractObj(content, dateStr, author, regionFallback, true);
    if (r) { as = buildRow(r.vendor, r.obj, content, SRC_LABEL); region = region || (r.obj["지역"] || ""); }
  }

  return { hasInspect, hasAS, inspect, as, region };
}
