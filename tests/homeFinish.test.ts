/**
 * 홈 마무리 배선(2026-10-24, 구현서A):
 *  · 카톡 배달 기록(kakaoDelivery) — 오늘 봇/노트북 건수·노트북 목록·표 없음 판정·KST 0시
 *  · 달성표 개인 칩 보조 글자 — K20 올해 누계(blogYearTotals) · K33 "수리 n점"(overhaulByPerson)
 *  · 마지막 값 캐시 v2 — 미처리 합계(전체·팀 탭·종류 칸)를 같은 함수로
 *  · 로더 — 오버홀 원본은 설정 탭으로 읽고, 사무실 일지(office) 조회는 없다
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isDeliveryTableMissing, kstDayStartIso, kstHm, summarizeDeliveries, type DeliveryRow } from "../src/kakaoDelivery";
import { blogYearTotals, kpiRanges, overhaulByPerson, type KpiFacts } from "../src/kpi/kpiCompute";
import { ALL_KPI_SOURCES, type KpiBundle } from "../src/kpi/kpiData";
import { parseKpiTargets } from "../src/kpi/kpiDefs";
import { FAST_SOURCES, tableRows } from "../src/kpi/homeKpiModel";
import { HOME_KPI_SNAPSHOT_KEY, HOME_KPI_SNAPSHOT_VERSION, buildHomeSnapshot, parseHomeSnapshot, summarizeUnhandled } from "../src/kpi/homeKpiSnapshot";
import { countUnhandledKinds, countUnhandledTabs, mergeUnhandled, type ReceptionInput, type TicketInput } from "../src/homeUnhandled";

const TODAY = "2026-10-23"; // 금요일
const teamOf = (a: string) => ({ 한왕주: "C", 이민구: "C", 엄재현: "E" } as Record<string, string>)[a] || "미지정";
const ROSTER = [{ name: "한왕주", team: "C" }, { name: "이민구", team: "C" }, { name: "엄재현", team: "E" }];
const bundleOf = (facts: KpiFacts): KpiBundle => ({
  today: TODAY, ranges: kpiRanges(TODAY), facts,
  sources: Object.fromEntries([...ALL_KPI_SOURCES, "overhaul"].map((s) => [s, { status: "ok", at: 1 }])),
  settings: parseKpiTargets(""), unhandledInfo: null, loadedAt: 1,
});

describe("카톡 배달 기록 — 오늘 봇/노트북 건수", () => {
  const rows: DeliveryRow[] = [
    { sender: "bot", sent_at: "2026-10-23T01:00:00Z", room: "점검방A", kind: "점검", vendor: "가" },
    { sender: "pc", sent_at: "2026-10-23T02:05:00Z", room: "AS방C", kind: "AS", vendor: "나" },
    { sender: "pc", sent_at: "2026-10-23T03:10:00Z", room: "부품방", kind: null, vendor: null },
    { sender: "bot", sent_at: "2026-10-23T04:00:00Z", room: "점검방B", kind: "봇점검", vendor: null },
    { sender: "??", sent_at: "2026-10-23T04:30:00Z", room: "x", kind: null, vendor: null },
  ];
  it("건수는 sender 별, 노트북 목록은 최근 것부터 limit 건", () => {
    const s = summarizeDeliveries(rows, 1);
    expect(s.bot).toBe(2);
    expect(s.pc).toBe(2);
    expect(s.pcList.map((r) => r.room)).toEqual(["부품방"]);
    expect(summarizeDeliveries(rows).pcList.map((r) => r.room)).toEqual(["부품방", "AS방C"]);
    expect(summarizeDeliveries([])).toEqual({ bot: 0, pc: 0, pcList: [] });
  });
  it("KST 0시 = 전날 15:00 UTC, 시각은 KST HH:MM", () => {
    expect(kstDayStartIso("2026-10-24")).toBe("2026-10-23T15:00:00Z");
    expect(kstDayStartIso("2026-01-01")).toBe("2025-12-31T15:00:00Z");
    expect(kstHm("2026-10-23T02:05:00Z")).toBe("11:05");
    expect(kstHm("2026-10-23T15:30:00Z")).toBe("00:30");
    expect(kstHm("x")).toBe("--:--");
  });
  it("표 없음(404·PGRST205·42P01)만 '준비 중' — 그 밖의 실패는 실패", () => {
    expect(isDeliveryTableMissing(new Error('조회 실패 kakao_delivery_log(404): {"code":"PGRST205"}'))).toBe(true);
    expect(isDeliveryTableMissing(new Error("relation does not exist 42P01"))).toBe(true);
    expect(isDeliveryTableMissing(new Error("조회 실패 kakao_delivery_log(500): boom"))).toBe(false);
    expect(isDeliveryTableMissing(new Error("Failed to fetch"))).toBe(false);
  });
});

describe("달성표 개인 칩 보조 글자 — 같은 함수", () => {
  const blog = [
    { seq: "1", date: "2026-01-05", name: "한왕주", dept: "강북C", points: 1 },
    { seq: "2", date: "2026-10-20", name: "한왕주", dept: "강북C", points: 1 },
    { seq: "3", date: "2026-10-21", name: "이민구", dept: "강북C", points: 1 },
    { seq: "4", date: "2025-12-30", name: "이민구", dept: "강북C", points: 1 }, // 작년 — 누계 밖
  ];
  const overhaul = [
    { author: "한왕주", date: "2026-10-20", points: 2, repairPoints: 1.5, dept: "강북C" },
    { author: "이민구", date: "2026-10-21", points: 1, repairPoints: 0, dept: "강북C" },
    { author: "엄재현", date: "2026-10-01", points: 3, repairPoints: 2, dept: "CSS" }, // 이번 주 밖
  ];
  const b = bundleOf({ roster: ROSTER, blog, overhaul });
  const rows = tableRows(b, { teamOf, period: "week" });

  it("K20 블로그: 개인 칩 total = 올해 누계(blogYearTotals)", () => {
    const k20 = rows.find((r) => r.id === "K20")!;
    const totals = blogYearTotals(blog, TODAY);
    expect(k20.people.length).toBeGreaterThan(0);
    for (const p of k20.people) expect(p.total).toBe(totals.get(p.name) ?? 0);
    expect(k20.people.find((p) => p.name === "한왕주")?.total).toBe(2);
    expect(k20.people.find((p) => p.name === "이민구")?.total).toBe(1);
  });
  it("K33 오버홀: 개인 칩 sub = '수리 n점'(이번 주, overhaulByPerson) — 수리 0 이면 없음", () => {
    const k33 = rows.find((r) => r.id === "K33")!;
    const by = overhaulByPerson(overhaul, ROSTER, teamOf, b.ranges.week);
    expect(by.byPerson.find((p) => p.name === "한왕주")?.repairPoints).toBe(1.5);
    expect(k33.people.find((p) => p.name === "한왕주")?.sub).toBe("수리 1.5점");
    expect(k33.people.find((p) => p.name === "이민구")?.sub).toBeUndefined();
    expect(rows.find((r) => r.id === "K1")?.people.every((p) => p.sub === undefined && p.total === undefined)).toBe(true);
  });
});

describe("마지막 값 캐시 v2 — 미처리 합계", () => {
  const recs: ReceptionInput[] = [
    { id: "r1", type: "복합기 AS", region: "수도권A", receipt_date: "2026-10-10", vendor: "가", status: "접수" },
    { id: "r2", type: "IT", region: "", receipt_date: "2026-10-12", vendor: "나", status: "접수" },
  ];
  const tks: TicketInput[] = [
    { id: "t1", team: "B", date: "2026-10-20", vendor: "라", assignee: "", status: "배정", scheduleType: "AS" },
    { id: "t2", team: "E", date: "2026-10-16", vendor: "아", assignee: "", status: "배정", scheduleType: "물류" },
  ];
  const rows = mergeUnhandled(recs, tks, TODAY);

  it("합계·팀 탭·종류 칸 = homeUnhandled 같은 함수(전체 = 탭 합 = 종류 합)", () => {
    const u = summarizeUnhandled(rows, 3);
    const tabs = countUnhandledTabs(rows);
    const kinds = countUnhandledKinds(rows);
    expect(u.total).toBe(tabs["전체"]);
    expect(u.tabs.reduce((n, t) => n + t.value, 0)).toBe(u.total);
    expect(u.kinds.reduce((n, k) => n + k.value, 0)).toBe(u.total);
    expect(u.kinds.reduce((n, k) => n + k.value, 0)).toBe(Object.values(kinds).reduce((n, v) => n + v, 0));
    expect(u.tabs.find((t) => t.label === "CSS")?.value).toBe(tabs.E); // E 는 CSS 로
    expect(u.recontract).toBe(3);
    expect(u.oldest).toMatch(/나 \(11일/); // 복합기 AS 접수 "가"는 일정 기준이라 미처리 밖(2026-10-25)
  });
  it("캐시에 들어가고(원본 ok 일 때만), 키·버전은 v2", () => {
    expect(HOME_KPI_SNAPSHOT_KEY).toBe("home_kpi_snapshot_v2");
    expect(HOME_KPI_SNAPSHOT_VERSION).toBe(2);
    const b = bundleOf({ roster: ROSTER, unhandled: rows });
    const snap = buildHomeSnapshot(b, teamOf, Date.parse("2026-10-23T03:00:00Z"));
    expect(snap.unhandled?.total).toBe(rows.length);
    const back = parseHomeSnapshot(JSON.stringify(snap), TODAY, Date.parse("2026-10-23T03:01:00Z"));
    expect(back?.unhandled).toEqual(snap.unhandled);
    const failed = { ...b, sources: { ...b.sources, unhandled: { status: "error" as const, at: 1, error: "x" } } };
    expect(buildHomeSnapshot(failed, teamOf, 1).unhandled).toBeNull();
    // 모양이 깨진 미처리 칸이면 캐시 전체를 버린다
    expect(parseHomeSnapshot(JSON.stringify({ ...snap, unhandled: { total: "x" } }), TODAY, Date.parse("2026-10-23T03:01:00Z"))).toBeNull();
  });
});

describe("로더 — 오버홀은 설정 탭으로, 사무실 일지 조회 없음", () => {
  const src = readFileSync("src/kpi/kpiData.ts", "utf8");
  it("overhaul 원본 = loadOverhaulRows(overhaulTabFrom(설정)) · office_logs 조회 없음 · 60초 원본에 office 없음", () => {
    expect(src).toMatch(/run\("overhaul", async \(\) => loadOverhaulRows\(overhaulTabFrom\(/);
    expect(src).not.toMatch(/office_logs/);
    expect(src).not.toMatch(/run\("office"/);
    expect([...FAST_SOURCES]).not.toContain("office");
  });
});
