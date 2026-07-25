/**
 * 여분·폐통 지급 분석 공용 헬퍼 (워킨맵 · 서비스접수 공유)
 *  - 최근 점검 2회로 기간 포함 사용량(흑/컬/큰컬, 월평균)을 계산하고
 *  - 최근 점검의 여분·폐통 수량을 기준과 비교해 "몇 개 주면 되는지" 권장한다.
 *  기준: A3 복합기 = 여분 2세트·폐통 2 / A4(소형기) = 2세트(월 3,000매 이상이면 3세트).
 *  모델 분류가 안 되는 기기는 2세트 기준으로 계산한다.
 */
export type SnapshotLike = { date: string; counts: string; toner: string; spare: string; waste?: string; serial?: string };

function normSerial(value: string) {
  return String(value || "").replace(/[^0-9a-z]/gi, "").toLowerCase();
}

const A3_PATTERN = /(MX\d|APEOS|DOCU|DC[- ]?\d|X7\d{2}|C2060|C2560|C3060|C2270|C2271|C3370|C3375|C4470|C5570|7845|7855|B7185|B7125)/i;
const A4_PATTERN = /(SL[- ]?X3|SL[- ]?X4|SL[- ]?C4|SL[- ]?M4|X32\d|X42\d|X28\d|3220|4220|3280|D420|D320|C24\d|C31\d)/i;

export function counterOf(counts: string, label: string): number | null {
  // "컬"이 "큰컬"에 걸리지 않게 lookbehind로 구분한다.
  const pattern = label === "컬" ? "(?<!큰)컬\\s*[-:]?\\s*([\\d,]+)" : `${label}\\s*[-:]?\\s*([\\d,]+)`;
  const match = String(counts).match(new RegExp(pattern, "i"));
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

export function monthsBetweenDates(from: string, to: string) {
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.max(1, Math.round(Math.abs(b.getTime() - a.getTime()) / 86_400_000 / 30));
}

// 여분 문자열에서 색상별 수량·폐통 수량 추출 ("K1 C1 M1 Y1 폐1", "토너1set폐1", "2세트", "각1" 등 대응)
function spareCounts(text: string) {
  const source = String(text || "");
  const map: Record<string, number> = {};
  for (const m of source.toUpperCase().matchAll(/([KCMY])\s*[-:]?\s*(\d+)/g)) map[m[1]] = (map[m[1]] || 0) + Number(m[2]);
  const set = source.match(/(\d+)\s*(?:세트|SET|셋트|셋)/i) || source.match(/각\s*(\d+)/);
  if (set) for (const color of ["K", "C", "M", "Y"]) map[color] = Math.max(map[color] || 0, Number(set[1]));
  const waste = source.match(/폐(?:통)?\s*[-:]?\s*(\d+)/);
  return { map, waste: waste ? Number(waste[1]) : null, any: Object.keys(map).length > 0 || !!waste };
}

export type UsageSpareAdvice = { usageLine: string; adviceLine: string; warning: string };

export function usageSpareAdvice(latest: SnapshotLike | undefined, previous: SnapshotLike | undefined, model: string): UsageSpareAdvice | null {
  if (!latest) return null;

  // 기간 포함 사용량 — 두 방문의 기기가 다르거나 카운터가 줄었으면(기기 교체/리셋) 비교를 생략한다.
  let usageLine = "";
  let warning = "";
  if (previous) {
    const latestSerial = normSerial(latest.serial || "");
    const prevSerial = normSerial(previous.serial || "");
    const serialMismatch = latestSerial.length >= 4 && prevSerial.length >= 4 && latestSerial !== prevSerial;
    const months = monthsBetweenDates(previous.date, latest.date);
    const parts: string[] = [];
    let negative = false;
    for (const label of ["흑", "컬", "큰컬"]) {
      const cur = counterOf(latest.counts, label);
      const prev = counterOf(previous.counts, label);
      if (cur === null || prev === null) continue;
      if (cur - prev < 0) negative = true;
      parts.push(`${label} ${(cur - prev).toLocaleString()}매`);
    }
    if (serialMismatch || negative) {
      warning = "전방문·전전방문 기기가 다르거나 카운터가 초기화되어 사용량 비교를 생략합니다 (자산·기번 확인 필요)";
    } else if (parts.length) {
      const total = parts.length ? ["흑", "컬", "큰컬"].reduce((sum, label) => {
        const cur = counterOf(latest.counts, label);
        const prev = counterOf(previous.counts, label);
        return cur !== null && prev !== null ? sum + (cur - prev) : sum;
      }, 0) : 0;
      const monthly = months ? Math.round(total / months) : total;
      usageLine = `${months}개월간 ${parts.join(" · ")} (월평균 약 ${monthly.toLocaleString()}매)`;
    }
  }

  // 기준: 여분 2세트 고정(사용자 판단 여지), 폐통은 A3 분류 시 2개.
  const grade = A3_PATTERN.test(model) ? "A3" : A4_PATTERN.test(model) ? "A4" : "";
  const targetSets = 2;
  const wasteTarget = grade === "A3" ? 2 : 0;
  const standard = `${targetSets}세트${wasteTarget ? `·폐통${wasteTarget}` : ""} 기준`;

  // 컬러기 여부 → 세트 구성 색상
  const isColor = (counterOf(latest.counts, "컬") ?? 0) > 0 || /[CMY]\s*[-:]?\s*\d/i.test(latest.toner || "") || /[CMY]\s*[-:]?\s*\d/i.test(latest.spare || "");
  const colors = isColor ? ["K", "C", "M", "Y"] : ["K"];

  const wasteText = /^\d+$/.test(String(latest.waste || "").trim()) ? `폐${String(latest.waste).trim()}` : String(latest.waste || "");
  const { map, waste, any } = spareCounts(`${latest.spare || ""} ${wasteText}`);
  if (!any) {
    return { usageLine, warning, adviceLine: `여분 기록 없음 — ${standard}으로 채우도록 확인 필요` };
  }
  const needs: string[] = [];
  for (const color of colors) {
    const need = targetSets - (map[color] || 0);
    if (need > 0) needs.push(`${color}${need}`);
  }
  if (wasteTarget) {
    const needWaste = wasteTarget - (waste ?? 0);
    if (needWaste > 0) needs.push(`폐통${needWaste}`);
  }
  const nowLabel = [...colors.map((color) => `${color}${map[color] || 0}`), waste !== null ? `폐통${waste}` : ""].filter(Boolean).join(" ");
  return {
    usageLine,
    warning,
    adviceLine: needs.length
      ? `현재 ${nowLabel} → 지급 권장 ${needs.join(" · ")} (${standard})`
      : `현재 ${nowLabel} → 기준 충족, 추가 지급 불필요 (${standard})`,
  };
}
