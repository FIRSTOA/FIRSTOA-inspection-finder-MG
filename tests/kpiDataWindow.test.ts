/**
 * 홈 KPI 지난 기간 보기 — 로더 anchor·window(설계안 docs/tasks/home-period-nav-2026-10-26.md 6절 구현 B).
 * 점검·AS·확장성·양식 로더는 가짜로 바꿔 받은 from·to 를 보고, 나머지 PostgREST 는 fetch 를 흉내 내 URL 을 본다(homeSpeed 테스트와 같은 방식).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loaderCalls = vi.hoisted(() => ({ field: [] as unknown[][], expansion: [] as unknown[][], form: [] as unknown[][] }));
vi.mock("../src/expansionSource", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/expansionSource")>();
  return {
    ...orig,
    loadFieldRows: vi.fn(async (...a: unknown[]) => { loaderCalls.field.push(a); return []; }),
    loadExpansionRows: vi.fn(async (...a: unknown[]) => { loaderCalls.expansion.push(a); return []; }),
    loadFormRaw: vi.fn(async (...a: unknown[]) => { loaderCalls.form.push(a); return []; }),
  };
});

import { kpiCount, kpiLoadFrom, kpiRanges, rosterFromMembers, type ReceptionWeekRow } from "../src/kpi/kpiCompute";
import { loadKpiBundle } from "../src/kpi/kpiData";
import type { KpiSource } from "../src/kpi/kpiDefs";
import { invalidateMembersCache } from "../src/authors";

const TODAY = "2026-10-26"; // 월요일
const SRC = new Set<KpiSource>(["roster", "field", "expansion", "events", "visits", "workin", "overage", "receptionWeek", "okr"]);

let urls: string[] = [];
let members: unknown[] = [];
beforeEach(() => {
  urls = [];
  members = [];
  loaderCalls.field.length = 0; loaderCalls.expansion.length = 0; loaderCalls.form.length = 0;
  invalidateMembersCache();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(decodeURIComponent(url));
    if (/\/rest\/v1\/cs_members/.test(url)) return new Response(JSON.stringify(members), { status: 200 });
    return new Response("[]", { status: 200 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

const urlsOf = (table: string) => urls.filter((u) => u.includes(`/rest/v1/${table}?`));

describe("loadKpiBundle anchor·window", () => {
  it("window 를 주면 날짜 원본 로더가 그 from·to 로 불리고, today 는 진짜 오늘·anchor·window 가 묶음에 실린다", async () => {
    const window = { from: "2026-04-01", to: "2026-06-30" };
    const b = await loadKpiBundle({ sources: SRC, today: TODAY, anchor: "2026-06-30", window });
    expect(loaderCalls.field).toEqual([["2026-04-01", "2026-06-30"]]);
    expect(loaderCalls.expansion).toEqual([["2026-04-01", "2026-06-30"]]);
    expect(loaderCalls.form).toEqual([["overage_adjust", "2026-04-01", "2026-06-30"]]);
    expect(urlsOf("activity_events").some((u) => u.includes("2026-04-01") && u.includes("2026-06-30"))).toBe(true);
    expect(urlsOf("visit_logs").some((u) => u.includes("2026-04-01") && u.includes("2026-06-30"))).toBe(true);
    expect(urlsOf("workin_map_places").every((u) => u.includes("quarter=eq.2"))).toBe(true); // anchor 의 분기
    expect(b.today).toBe(TODAY);
    expect(b.anchor).toBe("2026-06-30");
    expect(b.window).toEqual(window);
    expect(b.ranges.today).toBe(TODAY);
    expect(b.ranges.quarter).toEqual({ from: "2026-04-01", to: "2026-06-30" });
    expect(b.ranges.quarterElapsedRate).toBe(100);
  });

  it("anchor 없으면 지금과 같다 — kpiLoadFrom~분기 말, 분기 4, 묶음에 anchor·window 없음", async () => {
    const b = await loadKpiBundle({ sources: SRC, today: TODAY });
    const R = kpiRanges(TODAY);
    expect(loaderCalls.field).toEqual([[kpiLoadFrom(R), R.quarter.to]]);
    expect(b.ranges).toEqual(R);
    expect("anchor" in b).toBe(false);
    expect("window" in b).toBe(false);
    expect(urlsOf("workin_map_places").every((u) => u.includes("quarter=eq.4"))).toBe(true);
  });

  it("anchor = today 이면 anchor 없는 묶음과 범위·조회가 같다", async () => {
    await loadKpiBundle({ sources: SRC, today: TODAY });
    const plain = [...urls].sort();
    const plainField = [...loaderCalls.field];
    urls = []; loaderCalls.field.length = 0; invalidateMembersCache();
    const b = await loadKpiBundle({ sources: SRC, today: TODAY, anchor: TODAY });
    expect(b.ranges).toEqual(kpiRanges(TODAY));
    expect(loaderCalls.field).toEqual(plainField);
    expect([...urls].sort()).toEqual(plain);
  });

  it("okr 는 anchor 의 달·주차로 읽는다(9월 셋째 주 일요일 → 2026-09)", async () => {
    await loadKpiBundle({ sources: new Set<KpiSource>(["okr"]), today: TODAY, anchor: "2026-09-20" });
    const okr = urlsOf("okr_cycles").join("\n");
    expect(okr).toContain("2026-09");
    expect(okr).not.toContain("2026-10");
  });

  it("receptionWeek 는 8주 전 월요일부터 읽는다", async () => {
    await loadKpiBundle({ sources: new Set<KpiSource>(["receptionWeek"]), today: TODAY });
    const u = urlsOf("service_receptions");
    expect(u.length).toBeGreaterThan(0);
    expect(u[0]).toContain(`receipt_date=gte.${kpiRanges(TODAY).weeks8[0].from}`);
  });

  it("anchor 가 있으면 명단을 그 기간 재직자로 거른다", async () => {
    members = [
      { id: "1", name: "재직", team: "A", dept: "CS팀", title: "", active: true, joined_on: null, left_on: null, sort: 1 },
      { id: "2", name: "나중입사", team: "A", dept: "CS팀", title: "", active: true, joined_on: "2026-08-01", left_on: null, sort: 2 },
    ];
    const b = await loadKpiBundle({ sources: new Set<KpiSource>(["roster"]), today: TODAY, anchor: "2026-06-30", window: { from: "2026-04-01", to: "2026-06-30" } });
    expect(b.facts.roster?.map((m) => m.name)).toEqual(["재직"]);
  });
});

describe("K29 — 8주 치 행에서도 이번 주 값은 같다", () => {
  it("이번 주 행만 vs 8주 행", () => {
    const R = kpiRanges(TODAY);
    const thisWeek: ReceptionWeekRow[] = [
      { status: "완료", receipt_date: "2026-10-26" }, { status: "접수", receipt_date: "2026-10-27" }, { status: "원격완료", receipt_date: "2026-11-01" },
    ];
    const older: ReceptionWeekRow[] = [
      { status: "접수", receipt_date: "2026-10-25" }, { status: "완료", receipt_date: "2026-10-19" }, { status: "접수", receipt_date: R.weeks8[0].from },
    ];
    const ctx = { today: TODAY, teamOf: () => "" };
    const a = kpiCount("K29", { receptionWeek: thisWeek }, {}, R.week, ctx);
    const b = kpiCount("K29", { receptionWeek: [...older, ...thisWeek] }, {}, R.week, ctx);
    expect(a).toEqual({ n: 2, d: 3 });
    expect(b).toEqual(a);
    // 지난주는 8주 치 안에서 바로 센다
    expect(kpiCount("K29", { receptionWeek: [...older, ...thisWeek] }, {}, { from: "2026-10-19", to: "2026-10-25" }, ctx)).toEqual({ n: 1, d: 2 });
  });
});

describe("rosterFromMembers(members, range)", () => {
  const base = { team: "B", title: "", active: true };
  const M = [
    { ...base, name: "빈칸" },
    { ...base, name: "널", joined_on: null, left_on: null },
    { ...base, name: "기간중퇴사", left_on: "2026-09-15" },
    { ...base, name: "이전퇴사", left_on: "2026-08-31" },
    { ...base, name: "기간후입사", joined_on: "2026-10-01" },
    { ...base, name: "기간중입사", joined_on: "2026-09-30" },
    { ...base, name: "비활성퇴사", active: false, left_on: "2026-09-10" },
    { ...base, name: "비활성", active: false },
  ];
  const sep = { from: "2026-09-01", to: "2026-09-30" };
  it("range 없으면 지금처럼 활성만", () => {
    expect(rosterFromMembers(M).map((m) => m.name)).toEqual(["빈칸", "널", "기간중퇴사", "이전퇴사", "기간후입사", "기간중입사"]);
  });
  it("range 면 joined_on ≤ to, left_on ≥ from(빈칸 통과) — 그 기간에 있다가 나간 비활성은 포함", () => {
    expect(rosterFromMembers(M, sep).map((m) => m.name)).toEqual(["빈칸", "널", "기간중퇴사", "기간중입사", "비활성퇴사"]);
  });
});
