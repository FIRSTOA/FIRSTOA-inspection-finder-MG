/**
 * 홈 KPI 마지막 값 캐시(2026-10-24, 사용자 "홈 처음 들어갈 때 너무 느려, 바로 나오게") — src/kpi/homeKpiSnapshot.ts
 *  저장/복원 왕복 · 버전/지표 목록/날짜/나이/깨진 글은 버림 · 원본 행 없이 작게 · 안 읽은(off) 칸만 캐시로, 실패(error)는 덮지 않음
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import HomeKpiBoard from "../src/HomeKpiBoard";
import { kpiRanges, type KpiFacts } from "../src/kpi/kpiCompute";
import { ALL_KPI_SOURCES, type KpiBundle } from "../src/kpi/kpiData";
import { parseKpiTargets, type KpiSource } from "../src/kpi/kpiDefs";
import { toFieldRows, type FieldRaw } from "../src/workCount";
import { tableRows, todayItems } from "../src/kpi/homeKpiModel";
import {
  HOME_KPI_SNAPSHOT_KEY, HOME_KPI_SNAPSHOT_MAX_AGE_MS, HOME_KPI_SNAPSHOT_MAX_CHARS, HOME_KPI_SNAPSHOT_VERSION,
  buildHomeSnapshot, mergeSnapshotList, parseHomeSnapshot, readHomeSnapshot, snapshotAgo, writeHomeSnapshot,
} from "../src/kpi/homeKpiSnapshot";

const TODAY = "2026-10-23";
const NOW = Date.parse("2026-10-23T03:00:00Z");
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
const bundleOf = (sources: Iterable<KpiSource> = ALL_KPI_SOURCES, status: "ok" | "error" = "ok"): KpiBundle => ({
  today: TODAY, ranges: kpiRanges(TODAY), facts: FACTS,
  sources: Object.fromEntries([...sources].map((s) => [s, status === "ok" ? { status: "ok", at: 1 } : { status: "error", at: 1, error: "x" }])),
  settings: parseKpiTargets(""), unhandledInfo: null, loadedAt: 1,
});
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
};

describe("저장·복원", () => {
  it("왕복: 같은 함수가 센 값 그대로(이번 주 달성표·금일 띠), 개인 칩·원본 행은 넣지 않는다", () => {
    const b = bundleOf();
    const snap = buildHomeSnapshot(b, teamOf, NOW);
    const s = mem();
    expect(writeHomeSnapshot(s, snap)).toBe("");
    const back = readHomeSnapshot(s, TODAY, NOW + 60_000);
    expect(back).not.toBeNull();
    const ctx = { teamOf, period: "week" as const };
    expect(back!.table.map((r) => [r.id, r.cells])).toEqual(tableRows(b, ctx).filter((r) => r.cellState === "ready").map((r) => [r.id, r.cells]));
    expect(back!.table.every((r) => r.people.length === 0)).toBe(true);
    expect(back!.todayItems.map((x) => [x.id, x.value])).toEqual(todayItems(b, ctx).map((x) => [x.id, x.value]));
    const text = s.m.get(HOME_KPI_SNAPSHOT_KEY)!;
    expect(text).not.toContain("_원문"); // 원본 행이 들어가지 않는다
    expect(text.length).toBeLessThan(HOME_KPI_SNAPSHOT_MAX_CHARS);
  });

  it("버전·지표 목록이 다르면 버린다", () => {
    const snap = buildHomeSnapshot(bundleOf(), teamOf, NOW);
    expect(parseHomeSnapshot(JSON.stringify({ ...snap, v: HOME_KPI_SNAPSHOT_VERSION + 1 }), TODAY, NOW)).toBeNull();
    expect(parseHomeSnapshot(JSON.stringify({ ...snap, defs: "K1,K2" }), TODAY, NOW)).toBeNull();
    expect(parseHomeSnapshot(JSON.stringify(snap), TODAY, NOW)).not.toBeNull();
  });

  it("다른 날 값·12시간 지난 값·깨진 글·모양 틀림은 버린다(무시하고 평소대로 읽음)", () => {
    const text = JSON.stringify(buildHomeSnapshot(bundleOf(), teamOf, NOW));
    expect(parseHomeSnapshot(text, "2026-10-24", NOW)).toBeNull();
    expect(parseHomeSnapshot(text, TODAY, NOW + HOME_KPI_SNAPSHOT_MAX_AGE_MS + 1)).toBeNull();
    expect(parseHomeSnapshot(text.slice(0, 50), TODAY, NOW)).toBeNull();
    expect(parseHomeSnapshot("null", TODAY, NOW)).toBeNull();
    expect(parseHomeSnapshot(JSON.stringify({ ...JSON.parse(text), table: [{ nope: 1 }] }), TODAY, NOW)).toBeNull();
    expect(parseHomeSnapshot(null, TODAY, NOW)).toBeNull();
  });

  it("저장소가 없거나 가득 차면 저장하지 않고 이유를 돌려준다(화면은 새 값 그대로)", () => {
    const snap = buildHomeSnapshot(bundleOf(), teamOf, NOW);
    expect(writeHomeSnapshot(null, snap)).not.toBe("");
    expect(writeHomeSnapshot({ getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } }, snap)).toContain("Quota");
    expect(readHomeSnapshot({ getItem: () => { throw new Error("denied"); }, setItem: () => {} }, TODAY, NOW)).toBeNull();
  });

  it("실패한 원본으로 센 행·칩은 캐시에 넣지 않는다", () => {
    const snap = buildHomeSnapshot(bundleOf(ALL_KPI_SOURCES, "error"), teamOf, NOW);
    expect(snap.table).toEqual([]);
    expect(snap.todayItems).toEqual([]);
    expect(snap.k2.end).toBeNull();
  });
});

describe("새 값 + 캐시 섞기", () => {
  const snapRows = [{ id: "K1", v: 1 }, { id: "K2", v: 2 }];
  it("묶음이 없으면 캐시 그대로(used)", () => {
    expect(mergeSnapshotList(null, snapRows, () => true)).toEqual({ list: snapRows, used: true });
  });
  it("아직 안 읽은(off) 행만 캐시로, 읽은 행·실패 행은 새 값 그대로", () => {
    const live = [{ id: "K1", v: 10 }, { id: "K2", v: 20 }, { id: "K3", v: 30 }];
    const r = mergeSnapshotList(live, snapRows, (id) => id === "K2");
    expect(r.list).toEqual([{ id: "K1", v: 10 }, { id: "K2", v: 2 }, { id: "K3", v: 30 }]);
    expect(r.used).toBe(true);
    expect(mergeSnapshotList(live, snapRows, () => false)).toEqual({ list: live, used: false });
  });
  it("캐시가 없으면 새 값만", () => {
    expect(mergeSnapshotList(null, undefined, () => true)).toEqual({ list: [], used: false });
  });
  it("n분 전 표시", () => {
    expect(snapshotAgo(NOW, NOW + 20_000)).toBe("방금");
    expect(snapshotAgo(NOW, NOW + 7 * 60_000)).toBe("7분 전");
    expect(snapshotAgo(NOW, NOW + 125 * 60_000)).toBe("2시간 전");
  });
});

describe("홈 첫 화면 — 캐시가 있으면 읽기 전에 숫자를 그린다", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  const renderWith = (stored: string | null) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW + 5 * 60_000);
    const s = mem();
    if (stored) s.setItem(HOME_KPI_SNAPSHOT_KEY, stored);
    vi.stubGlobal("window", { localStorage: s });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    return renderToString(createElement(HomeKpiBoard, {})).replace(/<!-- -->/g, "");
  };
  it("같은 날 캐시: '5분 전 값 · 갱신 중' + 달성표 행이 바로 보인다", () => {
    const snap = buildHomeSnapshot(bundleOf(), teamOf, NOW);
    const html = renderWith(JSON.stringify(snap));
    expect(html).toContain("5분 전 값 · 갱신 중");
    const mainRow = snap.table.find((r) => r.main);
    expect(mainRow).toBeTruthy();
    expect(html).toContain(mainRow!.name);
    // 캐시 없으면 같은 순간 달성표·금일 띠는 뼈대(aria-busy), 캐시가 있으면 숫자
    const bare = renderWith(null);
    for (const t of ["KPI 달성표", "금일 현황"]) {
      expect(bare).toContain(`aria-label="${t}" aria-busy="true"`);
      expect(html).not.toContain(`aria-label="${t}" aria-busy="true"`);
    }
  });
  it("캐시가 없거나 버전이 다르면 평소대로(캐시 표시 없음)", () => {
    expect(renderWith(null)).not.toContain("값 · 갱신 중");
    const snap = buildHomeSnapshot(bundleOf(), teamOf, NOW);
    expect(renderWith(JSON.stringify({ ...snap, v: 999 }))).not.toContain("값 · 갱신 중");
  });
});
