/**
 * 서비스접수 종류 값 → 화면 글자. 2026-10-25 사용자 "복합기 AS 는 CS 접수로 이름 통일" — **표시만** 바꾼다.
 * DB 값(service_receptions.type = '복합기 AS')·CHECK 제약·시트·카톡 양식·필터 쿼리는 그대로(값 비교 줄은 이 함수를 쓰지 않는다).
 * 긴 이름은 ReceptionTypePicker RECEPTION_TYPES label 과 같다. short = 좁은 칩용.
 */
const LONG: Record<string, string> = { "복합기 AS": "CS 접수", 원격이관: "원격", IT: "IT", 경영지원: "경영지원", 운영지원: "운영지원", 영업팀: "영업팀" };
const SHORT: Record<string, string> = { "복합기 AS": "CS", 원격이관: "원격", IT: "IT", 경영지원: "경영", 운영지원: "운영", 영업팀: "영업" };

export function receptionTypeLabel(type: string, opts: { short?: boolean } = {}): string {
  return (opts.short ? SHORT : LONG)[type] ?? type;
}
