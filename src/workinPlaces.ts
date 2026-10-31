/**
 * 워킨맵 지점 공통 판정 — 워킨맵(WalkingMap)과 재계약 준비(recontract)가 같은 규칙을 쓴다.
 *
 * 왜 공유 모듈인가: 같은 규칙을 두 곳에 베껴 두면 한쪽만 고쳐져 어긋난다(족보 브랜드 오배정 사고).
 * 등급·계약종료월 판정이 어긋나면 재계약 방문 대상이 화면마다 달라진다.
 *
 * 워킨맵 이름 표기는 사람이 시트에서 붙여온 것이라 형식이 여럿이다:
 *   "2610/8SS주식회사 한국성간보-매월마감"   ← 접두 2610 = 계약종료 26년 10월
 *   "2609/7SS아서피앤디401호매월마감"
 * 등급은 이름 접두에 붙거나, 메모에 등급만 한 줄로 적혀 있다(메모가 우선).
 */
import { kstDate } from "./visits";
export type Quarter = 1 | 2 | 3 | 4;
export type WorkinPlaceLike = { name: string; memos: string[] };

/**
 * 재계약 라벨 뜻(2026-10-26 사용자 색 기준): G1·G2·G3 기존대로, G5 = 완료, G6 = 진행중, G7 = 전략영업(중요 거래처 V·SS — CS 관리 밖).
 * 홈 KPI K35 재계약 진행 = G5 개수 / G7 을 뺀 전체(workinProgress.renewalProgress).
 */
export const RENEWAL_LABEL_DESC: Record<string, string> = {
  G5: "재계약 완료",
  G6: "진행중",
  G7: "전략영업(관리 밖)",
  G12: "이관",
};

/** 방문 대상에서 빠지는 라벨 (완료·전략영업·이관). G6(진행중)은 2026-10-26 부터 방문 대상에 남는다 */
export const RENEWAL_DONE_LABELS = new Set(["G5", "G7", "G12"]);

/** 재계약 분기 월 배정 — 종료월 기준으로 한 달 앞서 도는 관행 (1Q=2·3·4월) */
export function renewalQuarterMonths(quarter: Quarter): number[] {
  return quarter === 1 ? [2, 3, 4] : quarter === 2 ? [5, 6, 7] : quarter === 3 ? [8, 9, 10] : [11, 12, 1];
}

/** 지금 분기 */
/**
 * 매월점검 이름 맨 앞 숫자 = 마감일(1~31). 세금계산서용 카운터 검침을 위해 마감 전 영업일 며칠 안에 방문한다.
 * 예 "20V웍스피어 유한책임회사…" → 20. 숫자가 없거나 범위 밖이면 null.
 * 워킨맵 마감일순 정렬과 AS 접수 방문 판단(visitAdvice)이 같이 쓴다.
 */
export function monthlyClosingDay(name: string): number | null {
  const match = String(name ?? "").match(/^\s*(\d{1,2})/);
  if (!match) return null;
  const day = Number(match[1]);
  return day >= 1 && day <= 31 ? day : null;
}

export function currentQuarter(now = new Date()): Quarter {
  return (Math.floor(now.getMonth() / 3) + 1) as Quarter;
}

// ── 연도+분기(2026-10-31 설계 docs/tasks/workin-year-rollover-2026-10-31.md §3-2) ──
// workin_map_places 에 year 칸이 생겨 범위 키가 (team, year, quarter, kind) 다. 해가 바뀌면 "27년 1분기"와 "26년 1분기"가 섞이지 않게
// 분기 번호만 비교하지 말고 아래 헬퍼로 (연, 분기) 쌍을 비교한다. 날짜는 KST(kstDate) — 기기 시계 getMonth 는 아침 9시 전 어긋난다.

export type YearQuarter = { year: number; quarter: Quarter };
/** 범위 — team·kind 는 빼도 된다(모든 팀·업무) */
export type WorkinScope = { team?: string; year: number; quarter: Quarter | number; kind?: string };

const toQuarter = (q: unknown): Quarter => Math.min(4, Math.max(1, Math.trunc(Number(q)) || 1)) as Quarter;

/** 지금 (연, 분기) — KST */
export function currentYQ(now: Date = new Date()): YearQuarter {
  const [y, m] = kstDate(now).split("-").map(Number);
  return { year: y, quarter: toQuarter(Math.ceil(m / 3)) };
}

/** n 분기 옮기기 — 4분기 +1 → 다음 해 1분기, 1분기 −1 → 작년 4분기 */
export function shiftYQ(yq: YearQuarter, n: number): YearQuarter {
  const idx = yq.year * 4 + (toQuarter(yq.quarter) - 1) + Math.trunc(n);
  return { year: Math.floor(idx / 4), quarter: ((((idx % 4) + 4) % 4) + 1) as Quarter };
}

/**
 * 분기 번호만 있을 때의 연도 — 지금(KST 연·분기)에서 가장 가까운 해, 동점이면 지난 쪽.
 * 12월(4분기)에 1분기 → 다음 해, 1월에 4분기 → 작년, 4분기 중 2분기 → 올해(동점 → 과거).
 * SQL public.workin_nearest_year_(supabase/workin-year-20261101.sql)와 같은 규칙 — 바꾸면 둘 다.
 */
export function nearestYearFor(quarter: Quarter | number, now: Date = new Date()): number {
  const cur = currentYQ(now);
  const q = toQuarter(quarter);
  const here = cur.year * 4 + cur.quarter;
  let best = cur.year - 1;
  for (const y of [cur.year - 1, cur.year, cur.year + 1]) {
    if (Math.abs(y * 4 + q - here) < Math.abs(best * 4 + q - here)) best = y;
  }
  return best;
}

/** "26년 4분기" · short=true 면 칩용 "26·4Q" */
export function yqLabel(yq: YearQuarter, short = false): string {
  const yy = String(yq.year).slice(-2);
  return short ? `${yy}·${yq.quarter}Q` : `${yy}년 ${yq.quarter}분기`;
}
/** 칩용 짧은 표기 "26·4Q" */
export const yqChip = (yq: YearQuarter): string => yqLabel(yq, true);
/** "2026-4" (워킨맵 필터 savedIn 과 같은 모양) */
export const yqKey = (yq: YearQuarter): string => `${yq.year}-${yq.quarter}`;

/**
 * PostgREST 쿼리 조각(앞에 & 없음).
 * - 범위 객체 { team?, year, quarter, kind? } → `team=eq.C&year=eq.2026&quarter=eq.4&kind=eq.quarter`
 * - (연, 분기) 목록 → 1개면 `year=eq.Y&quarter=eq.Q`, 여럿이면 `or=(and(year.eq.2026,quarter.eq.4),and(year.eq.2027,quarter.eq.1))`
 *   (or= 는 한 쿼리에 한 번만 쓸 수 있다 — 다른 or 와 같이 쓰려면 and=(…) 로 감쌀 것)
 */
export function scopeFilter(scope: WorkinScope | YearQuarter[]): string {
  const enc = (v: unknown) => encodeURIComponent(String(v));
  if (Array.isArray(scope)) {
    const list = scope.filter((x, i) => scope.findIndex((y) => y.year === x.year && y.quarter === x.quarter) === i);
    if (!list.length) return "";
    if (list.length === 1) return `year=eq.${Math.trunc(list[0].year)}&quarter=eq.${toQuarter(list[0].quarter)}`;
    return `or=(${list.map((x) => `and(year.eq.${Math.trunc(x.year)},quarter.eq.${toQuarter(x.quarter)})`).join(",")})`;
  }
  const parts: string[] = [];
  if (scope.team) parts.push(`team=eq.${enc(scope.team)}`);
  parts.push(`year=eq.${Math.trunc(scope.year)}`, `quarter=eq.${toQuarter(scope.quarter)}`);
  if (scope.kind) parts.push(`kind=eq.${enc(scope.kind)}`);
  return parts.join("&");
}

type YearRowLike = { year?: number | null; ext_year?: number | null; quarter: number };
/** 행의 연도 — year 칸이 없으면(캐시·옛 응답) ext_year → 분기 번호로 가장 가까운 해 */
export function placeYear(row: YearRowLike, now: Date = new Date()): number {
  const y = Number(row.year);
  if (Number.isInteger(y) && y > 2000) return y;
  const ext = Number(row.ext_year);
  if (Number.isInteger(ext) && ext > 2000) return ext;
  return nearestYearFor(row.quarter, now);
}

/** 행이 그 (연, 분기)인가 */
export function sameYQ(row: YearRowLike, yq: YearQuarter, now: Date = new Date()): boolean {
  return Number(row.quarter) === yq.quarter && placeYear(row, now) === yq.year;
}

/** 등급 — 메모에 등급만 적힌 줄이 우선, 없으면 이름 접두에서 (V·SS·S·NN·N) */
export function renewalGrade(place: WorkinPlaceLike): string {
  const memoGrade = (place.memos || []).map((memo) => String(memo).trim().toUpperCase()).find((memo) => /^(V|SS|S|NN|N)$/.test(memo));
  if (memoGrade) return memoGrade;
  return String(place.name || "").match(/^(?:\d{4}\/)?\d*(SS|NN|S|N|V)(?=[^A-Z]|$)/i)?.[1]?.toUpperCase() || "";
}

export type ContractEnd = { year: number; month: number; key: number; label: string; date: string };

/** 계약 종료월 — 메모 "계약종료년월일26-10-09" 또는 이름 접두 "2610/" */
export function contractEnd(place: WorkinPlaceLike, baseYear: number): ContractEnd | null {
  const source = [place.name, ...(place.memos || [])].join(" ");
  const marked = source.match(/계약종료(?:년월)?\s*[-/:.]?\s*(\d{2,4})\s*[-년/.]?\s*(\d{1,2})?/);
  const leading = String(place.name || "").match(/^(\d{2})(\d{2})\//);
  let year = 0;
  let month = 0;
  if (marked) {
    const digits = marked[1];
    if (digits.length === 4 && !marked[2]) {
      year = 2000 + Number(digits.slice(0, 2));
      month = Number(digits.slice(2));
    } else {
      year = digits.length === 2 ? 2000 + Number(digits) : Number(digits);
      month = Number(marked[2] || 0);
    }
  } else if (leading) {
    year = 2000 + Number(leading[1]);
    month = Number(leading[2]);
  }
  if (!year || month < 1 || month > 12) return null;
  if (year < 1900 || year > baseYear + 20) return null;
  return {
    year,
    month,
    key: year * 100 + month,
    label: `${String(year).slice(2)}년 ${month}월`,
    date: `${year}.${String(month).padStart(2, "0")}.${new Date(year, month, 0).getDate()}`,
  };
}

/** 계약 종료일 — 메모에 일자까지 있으면 그것까지(YYYY-MM-DD), 없으면 월 말일 */
export function contractEndYmd(place: WorkinPlaceLike, baseYear: number): string {
  const exact = [place.name, ...(place.memos || [])].join(" ")
    .match(/계약종료(?:년월일?)?\s*[-/:.]?\s*(\d{2})[-./](\d{1,2})[-./](\d{1,2})/);
  if (exact) return `20${exact[1]}-${exact[2].padStart(2, "0")}-${exact[3].padStart(2, "0")}`;
  const end = contractEnd(place, baseYear);
  if (!end) return "";
  return `${end.year}-${String(end.month).padStart(2, "0")}-${String(new Date(end.year, end.month, 0).getDate()).padStart(2, "0")}`;
}

/**
 * 자동연장된 계약의 종료월을 현재 주기로 투영한다.
 *
 * 워킨맵 이름 접두는 처음 계약한 종료년월이라 자동연장을 거치면 연도가 옛것으로 남는다
 * ("2109/27SS…" = 21년 9월). 월은 그대로 유효하므로 분기 월에 들어가면 올해로 읽는다.
 * 이 투영 없이 옛 연도를 그대로 쓰면 "1786일 지남"처럼 엉뚱한 D-day가 나온다.
 */
export function projectedContractEnd(place: WorkinPlaceLike, baseYear: number, quarter: Quarter): ContractEnd | null {
  const original = contractEnd(place, baseYear);
  const months = renewalQuarterMonths(quarter);
  if (!original || !months.includes(original.month)) return null;
  const year = quarter === 4 && original.month === 1 ? baseYear + 1 : baseYear;
  return {
    year,
    month: original.month,
    key: months.indexOf(original.month),
    label: `${original.month}월`,
    date: `${year}.${String(original.month).padStart(2, "0")}.${new Date(year, original.month, 0).getDate()}`,
  };
}

/**
 * 재계약 방문용 종료일(YYYY-MM-DD).
 * 분기 월에 해당하면 올해로 투영하고(자동연장), 아니면 적힌 그대로 쓴다.
 * 메모에 일자까지 있으면 그 일자를 살린다.
 */
export function renewalEndYmd(place: WorkinPlaceLike, baseYear: number, quarter: Quarter): { ymd: string; projected: boolean; original: string } {
  const original = contractEndYmd(place, baseYear);
  const projected = projectedContractEnd(place, baseYear, quarter);
  if (!projected) return { ymd: original, projected: false, original };
  const day = original && original.slice(5, 7) === String(projected.month).padStart(2, "0")
    ? original.slice(8, 10)
    : String(new Date(projected.year, projected.month, 0).getDate()).padStart(2, "0");
  const ymd = `${projected.year}-${String(projected.month).padStart(2, "0")}-${day}`;
  return { ymd, projected: ymd !== original, original };
}

/** 같은 건물 묶기 키 — 주소를 기호·공백 없이 정규화 (동선 파악용) */
export function addressGroupKey(address: string, fallback = ""): string {
  const flat = String(address || "").replace(/\s+/g, "").replace(/[^0-9a-z가-힣]/gi, "").toLowerCase();
  return flat || fallback;
}
