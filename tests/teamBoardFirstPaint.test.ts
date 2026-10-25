/**
 * 홈 팀 카드 첫 그림(2026-10-25 밤 사용자 "홈에서 팀별 수치가 조금 늦게 나온다").
 * 원인: 팀 카드가 달성표 34지표 전체(tableRows)를 쓰고, 묶음이 오기 전엔 카드 전체가 로딩("…"·"불러오는 중"),
 *       점검(워킨맵)·PC확장성은 무거운 원본(3단계)이라 첫 그림 뒤 수 초, 마지막 값 캐시에 팀 카드가 없었다.
 *  ① 캐시 v3 에 팀 카드 5장(v2 도 읽음) ② 안 온 칸만 "…"(부분 그리기) ③ 필요한 지표 행만 행 캐시로(숫자 같음)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import HomeKpiBoard from "../src/HomeKpiBoard";
import { kpiRanges, type KpiFacts } from "../src/kpi/kpiCompute";
import { ALL_KPI_SOURCES, type KpiBundle } from "../src/kpi/kpiData";
import { parseKpiTargets, type KpiSource } from "../src/kpi/kpiDefs";
import { toFieldRows, type FieldRaw } from "../src/workCount";
import { firstLoadPhases, HOME_KPI_DEFAULT_LAYOUT, sourcesForLayout, tableRows, tableRowsFor } from "../src/kpi/homeKpiModel";
import {
  HOME_KPI_SNAPSHOT_KEY, HOME_KPI_SNAPSHOT_KEY_V2, buildHomeSnapshot, parseHomeSnapshot, readHomeSnapshot, writeHomeSnapshot,
} from "../src/kpi/homeKpiSnapshot";
import {
  mergeTeamCardsWithSnapshot, NO_WAIT, TEAM_INSPECTION_KPI, TEAM_MINI_KPIS, teamBoardFromParts, teamBoardKpiIds, teamBoardView, teamCardWait, teamWaiting,
  type TeamCardModel,
} from "../src/kpi/teamBoard";
import type { UnhandledRow } from "../src/homeUnhandled";

const TODAY = "2026-10-23";
const NOW = Date.parse("2026-10-23T03:00:00Z");
const teamOf = (a: string) => ({ 한왕주: "C", 이민구: "C", 엄재현: "E", 가: "A" } as Record<string, string>)[a] || "미지정";
const fr = (id: number, day: string, author: string): FieldRaw => ({
  id, "작성일": day, created_at: `${day}T02:00:00Z`, "작성자": author, "지역": teamOf(author), "_업체명": `업체${id}`, "업체명": `업체${id}`, "_출처": "카톡:웹앱",
  "모델명": "C3070", "시리얼넘버": `S${id}`, "자산기번": `B${id}`, "_원문": `1.\n모델명: C3070\n시리얼넘버: S${id}`, _hidden: false,
});
const un = (team: UnhandledRow["team"], ageDays: number, key: string): UnhandledRow => ({ key, source: "reception", kind: "CS접수", team, date: "2026-10-20", vendor: "", title: "", assignee: "", status: "", ageDays });
const FACTS: KpiFacts = {
  roster: [{ name: "한왕주", team: "C" }, { name: "이민구", team: "C" }, { name: "엄재현", team: "E" }, { name: "가", team: "A" }],
  field: toFieldRows("jeomgeom", [fr(1, "2026-10-20", "한왕주"), fr(2, "2026-10-23", "이민구"), fr(3, "2026-10-23", "엄재현")], teamOf),
  expansion: [], workin: [{ team: "C", label: "G5", kind: "quarter" }],
  itPractice: [{ author: "한왕주", date: "2026-10-21" }, { author: "가", date: "2026-10-22" }],
  unhandled: [un("A", 3, "1"), un("C", 0, "2"), un("C", 9, "3")],
};
const bundleOf = (sources: Iterable<KpiSource> = ALL_KPI_SOURCES, failed: KpiSource[] = []): KpiBundle => ({
  today: TODAY, ranges: kpiRanges(TODAY), facts: FACTS,
  sources: Object.fromEntries([...sources].map((s) => [s, failed.includes(s) ? { status: "error", at: 1, error: "x" } : { status: "ok", at: 1 }])),
  settings: parseKpiTargets(""), unhandledInfo: null, loadedAt: 1,
});
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
};
const WANT = sourcesForLayout(HOME_KPI_DEFAULT_LAYOUT);
const [FIRST, LATE] = firstLoadPhases(WANT);

describe("③ 필요한 지표 행만 — 숫자는 달성표와 같은 행(같은 객체)", () => {
  it("팀 카드 지표 = 주요 목표 + 미니 4 + 분기 점검, 34개보다 적다", () => {
    const ids = teamBoardKpiIds(parseKpiTargets("").targets);
    for (const t of TEAM_MINI_KPIS) expect(ids).toContain(t.id);
    expect(ids).toContain(TEAM_INSPECTION_KPI);
    expect(ids.length).toBeLessThan(tableRows(bundleOf(), { teamOf, period: "week" }).length);
  });
  it("tableRowsFor 의 행 = tableRows 의 같은 행(행 캐시 — 달성표가 다시 세지 않음)", () => {
    const b = bundleOf();
    const ctx = { teamOf, period: "week" as const };
    const part = tableRowsFor(b, ctx, ["K20", "K2"]);
    const all = tableRows(b, ctx);
    expect(part.map((r) => r.id)).toEqual(["K2", "K20"]); // 정의 순서
    for (const r of part) expect(all.find((x) => x.id === r.id)).toBe(r);
  });
  it("다 온 묶음: 팀 카드 숫자는 예전 방식(달성표 전체 행으로 조합)과 같다", () => {
    const b = bundleOf();
    const ctx = { teamOf, period: "week" as const };
    const now = teamBoardView(b, "week", teamOf, "end");
    const before = teamBoardFromParts({ rows: tableRows(b, ctx), unhandled: b.facts.unhandled ?? null, roster: b.facts.roster ?? null, okrWeek: null });
    const strip = (c: TeamCardModel) => ({ ...c, wait: undefined, alerts: c.alerts.filter((a) => !a.startsWith("OKR")), tiles: c.tiles.map((t) => ({ ...t, wait: undefined })) });
    expect(now.map(strip)).toEqual(before.map(strip));
    expect(now.every((c) => JSON.stringify(c.wait) === JSON.stringify(NO_WAIT))).toBe(true);
  });
});

describe("② 부분 그리기 — 안 온 칸만 '…'", () => {
  it("teamCardWait: 기다림 없음 → 전부 숫자, 주요 목표 하나라도 기다리면 알약·주의 '…', CSS 는 OKR 을 기다리지 않는다", () => {
    expect(teamCardWait("A", ["K20"], undefined).card).toEqual(NO_WAIT);
    const w = { ids: new Set(["K20"]), unhandled: false, okr: true, roster: false };
    const a = teamCardWait("A", ["K20", "K33"], w);
    expect(a.card).toMatchObject({ pill: true, unhandled: false, okr: true, inspection: false, alerts: true });
    expect(a.tile("K20")).toBe(true);
    expect(a.tile("K21")).toBe(false);
    expect(teamCardWait("E", ["K33"], w).card).toMatchObject({ pill: false, okr: false, alerts: false });
  });
  it("첫 단계만 온 묶음: IT실습·인원은 숫자, 블로그(바깥)·PC확장·정기점검(무거운)·미처리는 '…'", () => {
    const b = bundleOf(FIRST);
    const w = teamWaiting(b, teamBoardKpiIds(b.settings.targets), WANT);
    expect(w.unhandled).toBe(true);
    expect(w.roster).toBe(false);
    const cards = teamBoardView(b, "week", teamOf, "end", WANT);
    const C = cards.find((c) => c.team === "C")!;
    const tile = (short: string) => C.tiles.find((t) => t.label === short)!;
    expect(tile("IT실습").wait).toBeUndefined();
    expect(tile("IT실습").value).toBe(1);
    expect(tile("블로그").wait).toBe(true);
    expect(tile("PC확장").wait).toBe(true);
    expect(C.wait).toMatchObject({ inspection: true, unhandled: true, headcount: false, pill: true });
    expect(C.headcount).toBe(2);
  });
  it("바깥 원본까지 온 묶음: 미처리는 숫자로 바뀌고 점검은 아직 '…' — 같은 함수라 다 온 뒤 숫자와 같다", () => {
    const b = bundleOf([...FIRST, ...LATE]);
    const C = teamBoardView(b, "week", teamOf, "end", WANT).find((c) => c.team === "C")!;
    const full = teamBoardView(bundleOf(), "week", teamOf, "end", WANT).find((c) => c.team === "C")!;
    expect(C.wait?.unhandled).toBe(false);
    expect(C.unhandled).toBe(full.unhandled);
    expect(C.unhandled).toBe(2);
    expect(C.wait?.inspection).toBe(true);
    expect(C.tiles.find((t) => t.label === "블로그")?.wait).toBeUndefined();
  });
  it("실패한 원본·안 읽을 원본(숨긴 위젯)은 기다리지 않는다('—' 그대로 — 실패를 '…'로 숨기지 않음)", () => {
    const b = bundleOf(FIRST, ["itPractice"]);
    const C = teamBoardView(b, "week", teamOf, "end", WANT).find((c) => c.team === "C")!;
    expect(C.tiles.find((t) => t.label === "IT실습")?.wait).toBeUndefined();
    const noUnhandled = new Set([...WANT].filter((s) => s !== "unhandled"));
    expect(teamWaiting(b, [], noUnhandled).unhandled).toBe(false);
  });
  it("묶음이 없으면 칸마다 '…'(카드 틀·팀 이름·지역은 그대로)", () => {
    const cards = teamBoardView(null, "week", teamOf, "end", WANT);
    expect(cards.map((c) => c.label)).toEqual(["A", "B", "C", "D", "CSS"]);
    expect(cards[0].wait).toMatchObject({ pill: true, unhandled: true, okr: true, inspection: true });
    expect(cards[0].tiles.every((t) => t.wait)).toBe(true);
  });
});

describe("① 마지막 값 캐시 v3 — 팀 카드 포함", () => {
  it("저장·복원: 팀 카드 5장이 같은 함수 값 그대로 돌아온다", () => {
    const b = bundleOf();
    const snap = buildHomeSnapshot(b, teamOf, NOW);
    expect(snap.teams?.map((c) => c.team)).toEqual(["A", "B", "C", "D", "E"]);
    const s = mem();
    expect(writeHomeSnapshot(s, snap)).toBe("");
    const back = readHomeSnapshot(s, TODAY, NOW + 60_000)!;
    expect(back.teams).toEqual(teamBoardView(b, "week", teamOf, "end"));
    expect(s.m.get(HOME_KPI_SNAPSHOT_KEY)!.length).toBeLessThan(96_000);
  });
  it("호환: v2 키에 저장된 옛 값도 읽는다(팀 카드만 null) · 팀 카드 모양이 깨지면 팀 카드만 버린다", () => {
    const snap = buildHomeSnapshot(bundleOf(), teamOf, NOW);
    const { teams: _t, ...v2 } = { ...snap, v: 2 };
    void _t;
    const s = mem();
    s.setItem(HOME_KPI_SNAPSHOT_KEY_V2, JSON.stringify(v2));
    const back = readHomeSnapshot(s, TODAY, NOW)!;
    expect(back).not.toBeNull();
    expect(back.teams).toBeNull();
    expect(back.table.length).toBe(snap.table.length);
    const broken = parseHomeSnapshot(JSON.stringify({ ...snap, teams: [{ nope: 1 }] }), TODAY, NOW)!;
    expect(broken.teams).toBeNull();
    expect(broken.table.length).toBe(snap.table.length);
  });
  it("mergeTeamCardsWithSnapshot: 기다리는 칸만 캐시 값, 온 칸·실패 칸은 새 값, 캐시도 기다림이던 칸은 안 씀", () => {
    const snapCards = teamBoardView(bundleOf(), "week", teamOf, "end").map((c) => ({ ...c, unhandled: 77 }));
    snapCards[0] = { ...snapCards[0], wait: { ...NO_WAIT, inspection: true }, inspectionPct: 99 };
    const live = teamBoardView(bundleOf(FIRST), "week", teamOf, "end", WANT);
    const { cards, used } = mergeTeamCardsWithSnapshot(live, snapCards);
    expect(used).toBe(true);
    const A = cards.find((c) => c.team === "A")!;
    expect(A.unhandled).toBe(77);
    expect(A.wait?.unhandled).toBe(false);
    expect(A.stale).toBe(true);
    expect(A.wait?.inspection).toBe(true); // 캐시도 기다림 → '…' 그대로
    expect(A.inspectionPct).not.toBe(99);
    const C = cards.find((c) => c.team === "C")!;
    expect(C.tiles.find((t) => t.label === "IT실습")).toEqual(live.find((c) => c.team === "C")!.tiles.find((t) => t.label === "IT실습")); // 온 칸은 새 값
    expect(mergeTeamCardsWithSnapshot(live, null)).toEqual({ cards: live, used: false });
  });
});

describe("홈 첫 화면 — 캐시가 있으면 팀 숫자부터", () => {
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
  it("캐시 있음: 팀 카드 aria 에 캐시 미처리 수 · 마지막 값 / 캐시 없음: 칸마다 불러오는 중(카드 전체 '불러오는 중' 문구 없음)", () => {
    const snap = buildHomeSnapshot(bundleOf(), teamOf, NOW);
    const html = renderWith(JSON.stringify(snap));
    expect(html).toMatch(/aria-label="C팀 [^"]*미처리 2 [^"]*마지막 값\(갱신 중\)/);
    const bare = renderWith(null);
    expect(bare).toMatch(/aria-label="C팀 불러오는 중 · 미처리 불러오는 중/);
    expect(bare).not.toContain(">불러오는 중</span>");
  });
});
