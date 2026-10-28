/**
 * 통합검색 "무엇이든 묻기" 가림 한 곳 (2026-10-29, 설계 docs/tasks/search-ask-everything-2026-10-29.md 4장 2·결정 Q2)
 *
 * askMask(value, key) = privacy.maskRrnValue(칸 문맥 주민번호) → kakao-parse.maskKakaoText(주민·카드·계좌·휴대폰 가운데 4자리)
 *   + 전화 칸(휴대폰번호·rep_phone·phone·tel·일반전화·연락처 …)은 휴대폰이 아닌 번호(02-1234-5678 같은 일반전화)도 가운데를 가린다.
 * 모델에게 가는 도구 결과·앱에 돌려주는 rows/evidence·answer 세 곳 모두 이 함수로. 원번호는 업체 검색 카드(기존 화면)에서 본다.
 * 브라우저·Deno·Node 공용(순수 TS) — tests/askMask.test.ts.
 */
import { maskRrnValue } from "../privacy.ts";
import { maskKakaoText } from "../kakao-parse.ts";

/** 전화번호가 들어가는 칸 이름인가 */
export function isPhoneKey(key: string): boolean {
  const k = String(key || "").trim();
  return /phone|^tel$|_tel$|^tel_|전화|휴대폰|핸드폰|연락처|recipient/i.test(k);
}

// 일반·지역·대표번호: 02-123-4567, 031 1234 5678, 0507-1234-5678, 1588-1234
const ANY_PHONE = /(?<![\d*])(0\d{1,3})([-.\s]?)(\d{3,4})([-.\s]?)(\d{4})(?![\d*])/g;

/** 전화 칸 값 — 가운데 자리를 * 로 */
export function maskPhoneText(text: string): string {
  return String(text ?? "").replace(ANY_PHONE, (_m, a: string, s1: string, mid: string, s2: string, b: string) => `${a}${s1 || "-"}${"*".repeat(mid.length)}${s2 || "-"}${b}`);
}

/** 글 하나 가림. key 는 칸 이름(없으면 글 규칙만) */
export function askMaskText(value: unknown, key = ""): string {
  let s = maskRrnValue(value, key);
  s = maskKakaoText(s).text;
  if (isPhoneKey(key)) s = maskPhoneText(s);
  return s;
}

/** 행·객체·배열 통째 가림(새 값, 원본 불변). 문자열만 가리고 숫자·불린·null 은 그대로 */
export function askMask<T>(value: T, key = ""): T {
  if (typeof value === "string") return askMaskText(value, key) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => askMask(v, key)) as unknown as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = askMask(v, k);
    return out as T;
  }
  return value;
}
