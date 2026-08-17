/**
 * 여분·폐통 지급 분석 공용 헬퍼 (워킨맵 · 서비스접수 공유)
 *  - 최근 점검 2회로 기간 포함 사용량(흑/컬/큰컬, 월평균)을 계산하고
 *  - 최근 점검의 여분·폐통 수량을 기준과 비교해 "몇 개 주면 되는지" 권장한다.
 *  기준: A3 복합기 = 여분 2세트·폐통 2 / A4(소형기) = 2세트(월 3,000매 이상이면 3세트).
 *  모델 분류가 안 되는 기기는 2세트 기준으로 계산한다.
 */
export type SnapshotLike = { date: string; counts: string; toner: string; spare: string; waste?: string; serial?: string };

import { normalizeId as normSerial } from "./ids";

// 소형기(A4) 모델 번호 — 이 목록 외에는 전부 A3(대형)로 본다.
// 소형 컬러: 2100·2101·5521·5526·8900·5473·305 / 소형 흑백: 5700
// lookbehind 미사용(구형 iOS Safari<16.4에서 모듈 로드 실패 방지) — 숫자 경계는 (^|\D)로 판정.
const SMALL_MODEL = /(?:^|\D)(2100|2101|5521|5526|8900|5473|305|5700)(?!\d)/;
// 토너 여분 대상이 아닌 기기 — 공기청정기(샤오미·블루스카이 등)·세단기.
const NON_TONER_DEVICE = /샤오미|블루스카이|공기청정|공청|세단기|세절기|파쇄기/i;
// 잉크젯(HP 등) — 여분 1세트면 충분.
const INKJET = /\bHP\b|잉크/i;

export function counterOf(counts: string, label: string): number | null {
  // "컬"이 "큰컬"에 걸리지 않게 lookbehind로 구분한다.
  const pattern = label === "컬" ? "(?:^|[^큰])컬\\s*[-:]?\\s*([\\d,]+)" : `${label}\\s*[-:]?\\s*([\\d,]+)`;
  const match = String(counts).match(new RegExp(pattern, "i"));
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

export function monthsBetweenDates(from: string, to: string) {
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.max(1, Math.round(Math.abs(b.getTime() - a.getTime()) / 86_400_000 / 30));
}

// 여분 문자열에서 색상별 수량·폐통 수량 추출
// ("K1 C1 M1 Y1 폐1", "토너1set폐1", "2세트", "각1", "토너 2 드럼 1"(흑백기) 등 대응)
function spareCounts(text: string) {
  const source = String(text || "");
  const map: Record<string, number> = {};
  // 수량은 1~2자리로 제한 — "C4030" 같은 모델번호를 색상 수량으로 오파싱하지 않게 한다.
  for (const m of source.toUpperCase().matchAll(/([KCMY])\s*[-:]?\s*(\d{1,2})(?!\d)/g)) map[m[1]] = (map[m[1]] || 0) + Number(m[2]);
  const set = source.match(/(\d{1,2})\s*(?:세트|SET|셋트|셋)/i) || source.match(/각\s*(\d{1,2})(?!\d)/);
  if (set) for (const color of ["K", "C", "M", "Y"]) map[color] = Math.max(map[color] || 0, Number(set[1]));
  const tonerGeneric = source.match(/토너\s*[-:]?\s*(\d{1,2})(?!\d)/);
  const drum = source.match(/드럼\s*[-:]?\s*(\d{1,2})(?!\d)/);
  const waste = source.match(/폐(?:통)?\s*[-:]?\s*(\d{1,2})(?!\d)/);
  return {
    map,
    waste: waste ? Number(waste[1]) : null,
    tonerGeneric: tonerGeneric ? Number(tonerGeneric[1]) : null,
    drum: drum ? Number(drum[1]) : null,
    any: Object.keys(map).length > 0 || !!waste || !!tonerGeneric || !!drum,
  };
}

export type SpareNeed = { label: string; count: number };
export type UsageSpareAdvice = { usageLine: string; adviceLine: string; warning: string; needsList: SpareNeed[] };

export function usageSpareAdvice(latest: SnapshotLike | undefined, previous: SnapshotLike | undefined, model: string): UsageSpareAdvice | null {
  if (!latest) return null;
  if (NON_TONER_DEVICE.test(model)) return null; // 공청기·세단기는 여분 분석 대상 아님

  // 기간 포함 사용량.
  //  - 기번이 다르면(기기 교체) 비교 전체를 생략한다.
  //  - 기번이 같은데 특정 카운터만 줄었으면(입력 오타 가능) 그 항목만 빼고 나머지는 비교한다.
  let usageLine = "";
  let warning = "";
  if (previous) {
    const latestSerial = normSerial(latest.serial || "");
    const prevSerial = normSerial(previous.serial || "");
    const serialMismatch = latestSerial.length >= 4 && prevSerial.length >= 4 && latestSerial !== prevSerial;
    if (serialMismatch) {
      warning = "전방문·전전방문 기기(기번)가 달라 사용량 비교를 생략합니다";
    } else {
      const months = monthsBetweenDates(previous.date, latest.date);
      const parts: string[] = [];
      const negatives: string[] = [];
      let total = 0;
      for (const label of ["흑", "컬", "큰컬"]) {
        const cur = counterOf(latest.counts, label);
        const prev = counterOf(previous.counts, label);
        if (cur === null || prev === null) continue;
        const diff = cur - prev;
        if (diff < 0) { negatives.push(label); continue; }
        total += diff;
        parts.push(`${label} ${diff.toLocaleString()}매`);
      }
      // 흑/컬 없이 "합"만 적는 관행(3060 등) — 합계 차이로라도 월평균을 잡는다
      if (!parts.length) {
        const curTotal = counterOf(latest.counts, "합");
        const prevTotal = counterOf(previous.counts, "합");
        if (curTotal !== null && prevTotal !== null && curTotal >= prevTotal) {
          total = curTotal - prevTotal;
          parts.push(`합계 ${total.toLocaleString()}매`);
        }
      }
      if (parts.length) {
        const monthly = months ? Math.round(total / months) : total;
        usageLine = `${months}개월간 ${parts.join(" · ")} (월평균 약 ${monthly.toLocaleString()}매)`;
      }
      if (negatives.length) warning = `${negatives.join("·")} 카운터가 이전보다 작아 해당 항목은 제외했습니다 (입력 오류 가능)`;
    }
  }

  // 기준: A3컬러=2세트·폐통2 / A4컬러(소형)=3세트 / A3흑백=K2·폐통2 / A4흑백(소형)=K2 / 잉크젯=1세트
  const isInkjet = INKJET.test(model);
  const isSmall = SMALL_MODEL.test(model);
  // 컬러기 여부 → 세트 구성 색상 (흑백기는 CMY 표기가 없고 '토너1'·'K1' 식으로 적는다)
  const isColor = isInkjet || (counterOf(latest.counts, "컬") ?? 0) > 0 || /[CMY]\s*[-:]?\s*\d/i.test(latest.toner || "") || /[CMY]\s*[-:]?\s*\d/i.test(latest.spare || "");
  const colors = isColor ? ["K", "C", "M", "Y"] : ["K"];
  const targetSets = isInkjet ? 1 : isSmall && isColor ? 3 : 2;
  const wasteTarget = isInkjet || isSmall ? 0 : 2;
  const gradeLabel = isInkjet ? "잉크젯" : `${isSmall ? "A4" : "A3"}${isColor ? "컬러" : "흑백"}`;
  const standard = `${gradeLabel} ${isColor ? `${targetSets}세트` : `K${targetSets}`}${wasteTarget ? `·폐통${wasteTarget}` : ""} 기준`;

  // 주의: latest.waste(폐통 컬럼)는 폐통 '잔량 %'라 여분 수량이 아니다 — 여분 폐통 수는 여분 문자열의 "폐-N"에서만 읽는다.
  const { map, waste, tonerGeneric, drum, any } = spareCounts(latest.spare || "");
  if (!any) {
    return { usageLine, warning, needsList: [], adviceLine: `여분 기록 없음 — ${standard}으로 채우도록 확인 필요` };
  }
  // 색상 표기 없이 "토너 N"만 적힌 경우(흑백기 관행) — 세트 개수로 간주해 채운다.
  if (!Object.keys(map).length && tonerGeneric !== null) for (const color of colors) map[color] = tonerGeneric;
  const needs: string[] = [];
  const needsList: SpareNeed[] = [];
  for (const color of colors) {
    const need = targetSets - (map[color] || 0);
    if (need > 0) { needs.push(`${color}${need}`); needsList.push({ label: color, count: need }); }
  }
  if (wasteTarget) {
    const needWaste = wasteTarget - (waste ?? 0);
    if (needWaste > 0) { needs.push(`폐통${needWaste}`); needsList.push({ label: "폐통", count: needWaste }); }
  }
  const nowLabel = [
    ...colors.map((color) => `${color}${map[color] || 0}`),
    waste !== null ? `폐통${waste}` : "",
    drum !== null ? `드럼${drum}` : "",
  ].filter(Boolean).join(" ");
  return {
    usageLine,
    warning,
    needsList,
    adviceLine: needs.length
      ? `현재 ${nowLabel} → 지급 권장 ${needs.join(" · ")} (${standard})`
      : `현재 ${nowLabel} → 기준 충족, 추가 지급 불필요 (${standard})`,
  };
}

// 자가신청 물품 표기 (예: "K토너2 폐통1")
export function spareNeedItems(needsList: SpareNeed[]) {
  return needsList.map((need) => `${need.label === "폐통" ? "폐통" : `${need.label}토너`}${need.count}`);
}
