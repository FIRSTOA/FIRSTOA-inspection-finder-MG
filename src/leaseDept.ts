/**
 * 서비스접수 임대리스트 검색 — 부서명/현장명(임대리스트 Q열) 단계의 순수 로직.
 * 설계: docs/tasks/reception-unhandled-sheet-and-dept-search.md C4 (D8 "-"·"_"·빈칸 = 빈 값, D9 순서 업체명 → 부서명 → 자산 → 기번 → 순번).
 *
 *  - vendor_info."부서명" 생성 컬럼(supabase/vendor-info-dept.sql)이 있으면 그 컬럼(trgm 인덱스)으로 찾는다.
 *  - SQL 실행 전이면 400(42703 컬럼 없음 / PGRST204)이 난다 → _raw->>"부서명/현장명" 로 대신 찾고,
 *    그 세션 동안은 처음부터 대체 경로로 간다(한 번 400 이면 다시 두드리지 않는다).
 */

/** _raw 안 원래 키 (임대리스트 Q열 머리) */
export const DEPT_RAW_KEY = "부서명/현장명";
/** 생성 컬럼 이름 (vendor-info-dept.sql) */
export const DEPT_COLUMN = "부서명";
/** LeaseHit 에 붙이는 "어느 단계에서 걸렸나" 키 */
export const MATCHED_BY_KEY = "_matchedBy";
export type LeaseMatchedBy = "업체" | "부서" | "자산" | "기번" | "순번";

/** 부서명 값 정리: 줄바꿈·연속 공백 → 공백 한 칸, "-"·"_"·빈칸 → "" */
export function cleanDept(value: unknown): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text === "-" || text === "_" ? "" : text;
}

/** 검색 결과(LeaseHit = _raw 를 펼친 것)에서 부서명 꺼내기 */
export function leaseDeptOf(hit: Record<string, string> | null | undefined): string {
  if (!hit) return "";
  return cleanDept(hit[DEPT_RAW_KEY] ?? hit[DEPT_COLUMN] ?? "");
}

/** 알약 표시용: 20자 넘으면 자르고 … */
export function deptPillText(dept: string, max = 20): string {
  const chars = Array.from(dept);
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : dept;
}

/**
 * 부서 단계를 돌릴지: 2글자 이상(1글자는 trgm 을 못 타 전체 훑기 → anon 3초 타임아웃 위험),
 * 숫자만이면 건너뜀(순번 재조회에서 1등이 바뀌지 않게).
 */
export function shouldSearchDept(kw: string): boolean {
  const k = String(kw || "").trim();
  return Array.from(k).length >= 2 && !/^\d+$/.test(k);
}

// 세션 캐시 — 생성 컬럼이 없다는 걸 한 번 확인하면 그 뒤로는 바로 대체 경로
let deptColumnMissing = false;
export function isDeptColumnMissing(): boolean { return deptColumnMissing; }
export function markDeptColumnMissing(): void { deptColumnMissing = true; }
/** 테스트용 초기화 */
export function resetDeptColumnCache(): void { deptColumnMissing = false; }

/** selectRows 오류가 "컬럼 없음(400)" 인지 — 타임아웃(500)·네트워크 오류는 아니다 */
export function isMissingColumnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\(400\)/.test(message) || /42703|PGRST204/.test(message);
}

/**
 * 부서 단계 PostgREST 필터(select·limit 제외).
 *  - 컬럼 경로: "부서명"=ilike.*kw* (생성 컬럼은 이미 "-"·"_"를 ''로 둔다)
 *  - 대체 경로: _raw->>"부서명/현장명"=ilike.*kw* & not.in.("-","_")
 */
export function deptFilter(kw: string, fallback: boolean): string {
  const enc = encodeURIComponent;
  const needle = `ilike.*${enc(String(kw || "").trim())}*`;
  if (!fallback) return `${enc(DEPT_COLUMN)}=${needle}`;
  const path = enc(`_raw->>"${DEPT_RAW_KEY}"`);
  return `${path}=${needle}&${path}=not.in.${enc('("-","_")')}`;
}
