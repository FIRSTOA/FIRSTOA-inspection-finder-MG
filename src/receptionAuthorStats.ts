// 접수자별 처리 집계(서비스접수 목록 하단 카드). 경영·운영·영업(전략영업)을 '지원' 하나로 합치지 않고 각각 센다.
export type AuthorStat = { total: number; cs: number; it: number; remote: number; mgmt: number; ops: number; sales: number };
type Row = { author?: string; type: string; receipt_date?: string };

/** range 가 있으면 receipt_date 가 [start,end] 안인 행만 센다(목록은 보통 이미 기간으로 읽어 오므로 생략 가능). */
export function authorStats(rows: Row[], range?: { start: string; end: string }): Array<[string, AuthorStat]> {
  const map = new Map<string, AuthorStat>();
  for (const r of rows) {
    if (range) { const d = String(r.receipt_date || "").slice(0, 10); if (d < range.start || d > range.end) continue; }
    const key = r.author || "미지정";
    const e = map.get(key) || { total: 0, cs: 0, it: 0, remote: 0, mgmt: 0, ops: 0, sales: 0 };
    e.total += 1;
    if (r.type === "복합기 AS") e.cs += 1;
    else if (r.type === "IT") e.it += 1;
    else if (r.type === "경영지원") e.mgmt += 1;
    else if (r.type === "운영지원") e.ops += 1;
    else if (r.type === "영업팀") e.sales += 1;
    else e.remote += 1;
    map.set(key, e);
  }
  return Array.from(map.entries()).sort((a, b) => b[1].total - a[1].total);
}

/** 카드에 보일 칸. '총'·CS 는 항상, 나머지는 0 이면 생략(폰 폭). */
export function authorStatParts(s: AuthorStat): Array<{ key: string; label: string; n: number }> {
  const all = [
    { key: "cs", label: "CS", n: s.cs }, { key: "it", label: "IT", n: s.it }, { key: "remote", label: "원격", n: s.remote },
    { key: "mgmt", label: "경영", n: s.mgmt }, { key: "ops", label: "운영", n: s.ops }, { key: "sales", label: "영업", n: s.sales },
  ];
  return all.filter((p) => p.key === "cs" || p.n > 0);
}
