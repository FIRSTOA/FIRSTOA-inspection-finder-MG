// 기번/자산기번 등 식별자 비교용 정규화 — 프로젝트 공용.
// (api.ts normId / WalkingMap normalizeIdKey / spareAdvice normSerial 로 3벌 중복이던 것을 통합)
export function normalizeId(value: string) {
  return String(value || "").replace(/[^0-9a-z]/gi, "").toLowerCase();
}
