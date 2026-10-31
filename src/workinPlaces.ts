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
