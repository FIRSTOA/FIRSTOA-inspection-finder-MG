/**
 * 개인정보 가림 — 주민등록번호 (2026-10-22, 사용자 지시 "주민번호는 직원들이 못 보게")
 *
 * 임대리스트 시트의 '거래처 코드' 칸(원래 사업자번호 10자리)에 개인 고객은 주민번호가 들어가 있고,
 * 그 값이 vendor_info·vendor_master·lease_ident_code·misu.거래처코드·as_tickets.vendor_code·워킨맵 메모로 복사돼 있다.
 * DB 원본은 그대로 두고(시트가 원본, 검색·매칭 키로 계속 쓴다) "보여 줄 때만" 가린다. 앱(src/privacy.ts 가 다시 내보냄)과
 * 엣지 함수(entity-ask·data-ask)가 같은 규칙을 쓰도록 이 파일 하나에 둔다. 브라우저·Deno 공용 — import 없음.
 *
 * 규칙
 *  - 글 속(maskRrn): 앞6(또는 생년 8자리)-뒤7, 뒤 첫 자리 1~4 → "900101-1******". 하이픈·공백으로 나뉜 꼴만 가린다.
 *    하이픈 없는 13자리는 기기 시리얼(예: 8001104…, 점검·AS·접수에 실제로 있다)과 구별이 안 되므로
 *    "주민번호/생년월일/거래처 코드" 같은 이름표가 바로 앞에 있을 때만 가린다.
 *    더 긴 하이픈 번호(계좌 110-900101-1234567 같은) 속은 건드리지 않는다.
 *  - 칸 문맥(maskRrnValue): 거래처 코드 칸(isRrnKey)의 값이 통째로 13자리(하이픈 유무·뒤 첫 자리 무관)면 가린다.
 *    그 칸에 13자리가 들어갈 이유는 주민번호(또는 법인번호)뿐이라 오탐 걱정이 없다.
 */

const MASK = "******";
// 앞부분: 생년 8자리(19/20으로 시작) 또는 6자리. 구분: 하이픈류(앞뒤 공백 허용) 또는 공백 하나
const RRN_TEXT = /(?<!\d)(?<!\d[-‐‑–—])((?:19|20)\d{6}|\d{6})(?:\s*[-‐‑–—]\s*|\s)([1-4])\d{6}(?!\d)(?![-‐‑–—]\d)/g;
// 이름표 바로 뒤의 하이픈 없는 13(15)자리 — "주민번호: 9001011234567", "\"거래처 코드\":\"9001011234567\""
const RRN_LABELED = /((?:주민(?:등록)?\s*(?:번호)?|생년월일|거래처\s*코드|거래처코드|vendor_code)["']?\s*[:：=]?\s*["']?\s*)((?:19|20)\d{6}|\d{6})([0-9])\d{6}(?!\d)/gi;
// 칸 값 통째: 13자리(하이픈·공백 유무), 생년 8자리 꼴 포함
const RRN_WHOLE = /^\s*((?:19|20)\d{6}|\d{6})\s*[-‐‑–—\s]?\s*([0-9])\d{6}\s*$/;

/** 글 속 주민번호 모양을 "앞6-뒤첫자리******" 로. 문자열이 아니면 문자열로 바꿔 돌려준다 */
export function maskRrn(text: unknown): string {
  const s = String(text ?? "");
  if (!/\d{6}/.test(s)) return s;   // 빠른 길 — 6자리 숫자열이 없으면 손댈 것이 없다
  return s
    .replace(RRN_TEXT, (_m, head: string, g: string) => `${head}-${g}${MASK}`)
    .replace(RRN_LABELED, (_m, label: string, head: string, g: string) => `${label}${head}-${g}${MASK}`);
}

/** 주민번호가 들어갈 수 있는 칸 이름인가 — 거래처 코드 계열(vendor_info._raw '거래처 코드', misu '거래처코드', vendor_code, company_code, lease_ident_code.code …) */
export function isRrnKey(key: string): boolean {
  const k = String(key || "").trim();
  return /거래처\s*코드|사업자|주민|^(?:vendor_|company_)?code$|^vendor_?code$|^company_?code$|^companyCode$/i.test(k);
}

/** 칸 값 가림 — 거래처 코드 칸이면 통째 13자리도, 아니면 글 속 규칙만 */
export function maskRrnValue(value: unknown, key = ""): string {
  const s = String(value ?? "");
  if (isRrnKey(key)) {
    const m = s.match(RRN_WHOLE);
    if (m) return `${m[1]}-${m[2]}${MASK}`;
  }
  return maskRrn(s);
}

/** 거래처 코드 하나를 화면용으로 — maskRrnValue(code, "code") */
export const maskCode = (code: unknown): string => maskRrnValue(code, "code");

/** 행·객체·배열 통째 가림(새 값 반환, 원본 불변). 문자열은 칸 이름 문맥으로, 숫자·불린·null 은 그대로 */
export function maskDeep<T>(value: T, key = ""): T {
  if (typeof value === "string") return maskRrnValue(value, key) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => maskDeep(v, key)) as unknown as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = maskDeep(v, k);
    return out as T;
  }
  return value;
}
