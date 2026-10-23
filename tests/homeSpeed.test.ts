/**
 * 홈 속도 재발 방지(2026-10-24, 사용자 "앱이 너무 느려졌어" — 홈 KPI 현황판 0ed131d 이후).
 *  ① 원인: 관제 덱 1초 시계가 홈 전체를 매초 다시 그려 현황판이 매초 달성표·띠·추세를 새로 셌다(숨은 홈도) →
 *     위젯 보기는 같은 묶음·같은 기간이면 다시 세지 않는다(cachedView)
 *  ② 첫 로드는 가벼운 원본 먼저, 여러 쪽짜리 무거운 원본(점검·AS·활동 기록·워킨맵·방문·재계약·확장성)은 뒤에
 *  ③ 요청 수 상한 — 실측 행 수(2026-10-24)로 흉내 낸 표에서 첫 단계·전체 요청 수가 늘지 않게
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { kpiRanges, type KpiFacts } from "../src/kpi/kpiCompute";
import { ALL_KPI_SOURCES, loadKpiBundle, type KpiBundle } from "../src/kpi/kpiData";
import { parseKpiTargets, type KpiSource } from "../src/kpi/kpiDefs";
import { toFieldRows, type FieldRaw } from "../src/workCount";
import {
  HEAVY_SOURCES, HOME_KPI_DEFAULT_LAYOUT, cachedView, firstLoadPhases, mergeBundle, sourcesForLayout, tableRows, todayItems,
} from "../src/kpi/homeKpiModel";
import Home from "../src/Home";

const TODAY = "2026-10-23";
const teamOf = (a: string) => ({ 한왕주: "C", 이민구: "C", 엄재현: "E" } as Record<string, string>)[a] || "미지정";
const fr = (id: number, day: string, author: string): FieldRaw => ({
  id, "작성일": day, created_at: `${day}T02:00:00Z`, "작성자": author, "지역": teamOf(author), "_업체명": `업체${id}`, "업체명": `업체${id}`, "_출처": "카톡:웹앱",
  "모델명": "C3070", "시리얼넘버": `S${id}`, "자산기번": `B${id}`, "_원문": `1.\n모델명: C3070\n시리얼넘버: S${id}`, _hidden: false,
});
const FACTS: KpiFacts = {
  roster: [{ name: "한왕주", team: "C" }, { name: "이민구", team: "C" }, { name: "엄재현", team: "E" }],
  field: toFieldRows("jeomgeom", [fr(1, "2026-10-20", "한왕주"), fr(2, "2026-10-23", "이민구"), fr(3, "2026-10-23", "엄재현")], teamOf),
  expansion: [], workin: [{ team: "C", label: "G5", kind: "quarter" }],
};
const bundleOf = (): KpiBundle => ({
  today: TODAY, ranges: kpiRanges(TODAY), facts: FACTS,
  sources: Object.fromEntries([...ALL_KPI_SOURCES].map((s) => [s, { status: "ok", at: 1 }])),
  settings: parseKpiTargets(""), unhandledInfo: null, loadedAt: 1,
});

describe("① 위젯 보기는 같은 묶음·같은 기간이면 다시 세지 않는다", () => {
  it("다시 그리기 60번(1분치 시계) → 달성표 계산 1번, 값은 tableRows 와 같다", () => {
    const b = bundleOf();
    const ctx = { teamOf, period: "week" as const };
    const make = vi.fn(() => tableRows(b, ctx));
    let last: ReturnType<typeof tableRows> | null = null;
    for (let i = 0; i < 60; i++) last = cachedView(b, ctx, "table", make);
    expect(make).toHaveBeenCalledTimes(1);
    expect(last).toEqual(tableRows(b, ctx));
  });

  it("기간이 바뀌면·새로 읽어 묶음이 바뀌면 다시 센다", () => {
    const b = bundleOf();
    const make = vi.fn(() => todayItems(b, { teamOf }));
    cachedView(b, { teamOf, period: "week" }, "today", make);
    cachedView(b, { teamOf, period: "month" }, "today", make);
    expect(make).toHaveBeenCalledTimes(2);
    const next = mergeBundle({ bundle: b, okAt: {} }, { ...bundleOf(), loadedAt: 2 }).bundle;
    cachedView(next, { teamOf, period: "week" }, "today", make);
    expect(make).toHaveBeenCalledTimes(3);
  });
});

describe("② 첫 로드 두 단계 — 가벼운 원본 먼저", () => {
  it("기본 배치: 첫 단계엔 무거운 원본이 없고, 두 단계를 합치면 원래 원본 그대로(숫자 같음)", () => {
    const want = sourcesForLayout(HOME_KPI_DEFAULT_LAYOUT);
    const [light, heavy] = firstLoadPhases(want);
    for (const s of ["field", "events", "workin", "visits", "recontract", "expansion"] as KpiSource[]) {
      expect(light.has(s)).toBe(false);
      expect(heavy.has(s)).toBe(true);
    }
    expect(light.has("roster")).toBe(true); // 팀 판정용 명단은 먼저
    expect(new Set([...light, ...heavy])).toEqual(want);
    for (const s of heavy) expect(HEAVY_SOURCES.has(s)).toBe(true);
  });
});

/* ③ 요청 수 — PostgREST 를 흉내(표마다 실측 행 수, limit/offset 대로 잘라 줌) */
const ROWS: Record<string, number> = {
  jeomgeom: 1300, as_records: 700, activity_events: 2069, workin_map_places: 4014, visit_logs: 2002, recontract: 1200, pc_expansion: 300, mfp_expansion: 250,
};
function stubRest() {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const m = url.match(/\/rest\/v1\/([^?]+)\?(.*)$/);
    if (!m) return new Response("", { status: 200 }); // 시트 CSV·엣지 함수
    const table = decodeURIComponent(m[1]);
    const q = new URLSearchParams(m[2]);
    const total = ROWS[table] ?? 0;
    const offset = Number(q.get("offset") || 0), limit = Number(q.get("limit") || 1000);
    const n = Math.max(0, Math.min(limit, total - offset));
    return new Response(JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: offset + i }))), { status: 200 });
  }));
  return calls;
}
const restTables = (calls: string[]) => calls.map((u) => u.match(/\/rest\/v1\/([^?]+)/)?.[1]).filter(Boolean) as string[];

describe("③ 요청 수 상한(실측 행 수 흉내)", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("첫 단계(가벼운 원본): 무거운 표를 하나도 안 읽고 25번 이하", async () => {
    const calls = stubRest();
    const [light] = firstLoadPhases(sourcesForLayout(HOME_KPI_DEFAULT_LAYOUT));
    await loadKpiBundle({ sources: light, today: TODAY });
    const tables = restTables(calls);
    for (const t of Object.keys(ROWS)) expect(tables).not.toContain(t);
    expect(calls.length).toBeLessThanOrEqual(25);
  });

  it("전체(기본 배치) 한 번: 70번 이하 — 늘어나면 새 원본·전량 조회가 끼었는지 확인", async () => {
    const calls = stubRest();
    await loadKpiBundle({ sources: sourcesForLayout(HOME_KPI_DEFAULT_LAYOUT), today: TODAY });
    expect(calls.length).toBeLessThanOrEqual(70);
  });
});

describe("홈 렌더 — 초 시계는 LiveClock 한 칸", () => {
  it("HH:MM:SS 가 그대로 보인다", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    const html = renderToString(createElement(Home, { onGoField: () => {} }));
    vi.unstubAllGlobals();
    expect(html).toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});
