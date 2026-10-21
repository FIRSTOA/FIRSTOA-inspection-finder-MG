// 조회 기간 칩의 달력 기준 범위 — "오늘 기준 지난 30일"이 아니라 이번 달 1일~말일 같은 달력 단위.
// today 는 kstDate() 값(YYYY-MM-DD)을 넘긴다.

export type CalendarPeriod = "month" | "lastmonth" | "3m" | "6m" | "1y";

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1~12

function monthStart(today: string, offset: number) {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)) - 1 + offset;
  const d = new Date(Date.UTC(y, m, 1));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
}

/** 달력 기준 기간. 이번 달을 포함하는 구간의 끝은 이번 달 말일 */
export function calendarRange(key: CalendarPeriod, today: string): { from: string; to: string } {
  const thisMonth = monthStart(today, 0);
  const endOf = (p: { y: number; m: number }) => `${p.y}-${pad(p.m)}-${pad(lastDay(p.y, p.m))}`;
  if (key === "lastmonth") {
    const p = monthStart(today, -1);
    return { from: `${p.y}-${pad(p.m)}-01`, to: endOf(p) };
  }
  const n = key === "month" ? 1 : key === "3m" ? 3 : key === "6m" ? 6 : 12;
  const first = monthStart(today, -(n - 1)); // 이번 달 포함 n개 달력월
  return { from: `${first.y}-${pad(first.m)}-01`, to: endOf(thisMonth) };
}
