/**
 * 홈 KPI 현황판(2026-10-23) — 기본 배치 · 배치 저장/복원 · 숨긴 위젯 원본 안 읽기 · 묶음 합치기(실패면 마지막 값) ·
 * 위젯 보기(달성표·띠·분기 진행)가 kpiCompute 와 같은 값 · 렌더 스모크(서버 렌더, fetch 막음).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { countField, toFieldRows, type FieldRaw } from "../src/workCount";
import { kpiRanges, workinPace, type KpiFacts } from "../src/kpi/kpiCompute";
import { ALL_KPI_SOURCES, type KpiBundle } from "../src/kpi/kpiData";
import { parseKpiTargets, type KpiSource } from "../src/kpi/kpiDefs";
import {
  HOME_KPI_DEFAULT_LAYOUT, HOME_KPI_LAYOUT_KEY, HOME_WIDGETS, effectivePeriod, mergeBundle, parseHomeLayout, quarterGoalView, readHomeLayout,
  serializeHomeLayout, sourcesForLayout, splitSources, tableRows, todayItems, weekSummary, writeHomeLayout,
} from "../src/kpi/homeKpiModel";
import { KpiWidget } from "../src/kpi/KpiWidgets.view";
import HomeKpiBoard from "../src/HomeKpiBoard";
import Home from "../src/Home";

const TODAY = "2026-10-23"; // 금요일
const ROSTER_MAP: Record<string, string> = { 한왕주: "C", 이민구: "C", 엄재현: "E", 이권선: "A", 신정훈: "팀장" };
const teamOf = (a: string) => ROSTER_MAP[a] || "미지정";

const frow = (id: number, day: string, author: string, region: string, vendor: string, serial: string): FieldRaw => ({
  id, "작성일": day, created_at: `${day}T02:00:00Z`, "작성자": author, "지역": region, "_업체명": vendor, "업체명": vendor, "_출처": "카톡:웹앱",
  "모델명": "C3070", "시리얼넘버": serial, "자산기번": `B${id}`, "_원문": `작성자: x\n지역: ${region}\n1.\n모델명: C3070\n시리얼넘버: ${serial}\n자산기번: B${id}`, _hidden: false,
});
const FIELD = toFieldRows("jeomgeom", [
  frow(1, "2026-10-20", "한왕주", "C", "가업체", "S1"),
  frow(2, "2026-10-23", "이민구", "C", "나업체", "S2"),
  frow(3, "2026-10-23", "엄재현", "E", "다업체", "S3"),
  frow(4, "2026-10-21", "신정훈", "C", "라업체", "S4"), // 팀장 — 제외
], teamOf);

function bundleOf(facts: KpiFacts, sources: Iterable<KpiSource> = ALL_KPI_SOURCES, settingsRaw = ""): KpiBundle {
  const at = Date.UTC(2026, 9, 23, 3);
  return {
    today: TODAY, ranges: kpiRanges(TODAY), facts,
    sources: Object.fromEntries([...sources].map((s) => [s, { status: "ok", at }])),
    settings: parseKpiTargets(settingsRaw), unhandledInfo: null, loadedAt: at,
  };
}

const ROSTER = Object.entries(ROSTER_MAP).filter(([, t]) => t !== "팀장").map(([name, team]) => ({ name, team }));
const WORKIN = [
  ...Array.from({ length: 10 }, (_, i) => ({ team: "C", label: i < 4 ? "G5" : "G1", kind: "quarter" })),
  { team: "A", label: "G3", kind: "monthly" }, { team: "E", label: "G12", kind: "quarter" },
];
const FACTS: KpiFacts = { roster: ROSTER, field: FIELD, expansion: [], workin: WORKIN };

describe("기본 배치(사용자 2026-10-23)", () => {
  it("금일 현황 띠(4x1) → 분기 점검 진행(quarterGoal 2x1) → KPI 달성표(4x1) 순서, 그 뒤 설계안 1단계 위젯 + 기존 미처리 패널", () => {
    expect(HOME_KPI_DEFAULT_LAYOUT.slice(0, 3)).toEqual([
      { id: "today", size: "4x1", hidden: false },
      { id: "K2", size: "2x1", hidden: false },
      { id: "table", size: "4x1", hidden: false },
    ]);
    const kinds = Object.fromEntries(HOME_WIDGETS.map((w) => [w.id, w.kind]));
    expect(kinds).toMatchObject({ today: "todayStrip", K2: "quarterGoal", table: "kpiTable", unhandledPanel: "panel", receptionPanel: "panel", unhandled: "list" });
    expect(HOME_KPI_DEFAULT_LAYOUT.map((x) => x.id)).toEqual(["today", "K2", "table", "K1", "exp", "K10", "unhandledPanel", "receptionPanel", "K3", "K19", "K12", "unhandled"]);
    // 팀장 결정: 미처리 자리 = 기존 HomeUnhandledPanel(팀 탭), 요약 목록 위젯은 숨김으로 남김
    expect(HOME_KPI_DEFAULT_LAYOUT.filter((x) => x.hidden).map((x) => x.id)).toEqual(["unhandled"]);
    expect(HOME_KPI_DEFAULT_LAYOUT.find((x) => x.id === "unhandledPanel")?.size).toBe("2x2");
    for (const w of HOME_WIDGETS) expect(w.sizes).toContain(HOME_KPI_DEFAULT_LAYOUT.find((x) => x.id === w.id)!.size);
  });
});

describe("배치 저장/복원 — localStorage home_kpi_layout_v1 = {v:1, items}", () => {
  const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m }; };

  it("저장한 순서·크기·숨김이 그대로 돌아온다", () => {
    const st = memory();
    const changed = [...HOME_KPI_DEFAULT_LAYOUT].reverse().map((x) => (x.id === "K1" ? { ...x, size: "2x2" as const } : x.id === "K12" ? { ...x, hidden: true } : x));
    expect(writeHomeLayout(st, changed)).toBe("");
    expect(JSON.parse(st.m.get(HOME_KPI_LAYOUT_KEY)!).v).toBe(1);
    expect(readHomeLayout(st)).toEqual(changed);
  });

  it("모르는 id·중복은 버리고, 허용 안 된 크기는 첫 크기로, 새 위젯은 끝에 붙인다", () => {
    const raw = JSON.stringify({ v: 1, items: [{ id: "K3", size: "2x1" }, { id: "옛위젯", size: "1x1" }, { id: "K3", size: "1x1" }, { id: "table", size: "1x1", hidden: true }] });
    const { items, restored } = parseHomeLayout(raw);
    expect(restored).toBe(true);
    expect(items[0]).toEqual({ id: "K3", size: "2x1", hidden: false });
    expect(items[1]).toEqual({ id: "table", size: "4x1", hidden: true });
    expect(items.map((x) => x.id).sort()).toEqual(HOME_WIDGETS.map((w) => w.id).sort());
    expect(items.slice(2).map((x) => x.id)).toEqual(HOME_WIDGETS.map((w) => w.id).filter((id) => id !== "K3" && id !== "table"));
    expect(items.find((x) => x.id === "unhandled")?.hidden).toBe(true); // 새로 붙는 위젯도 기본 숨김을 따른다
  });

  it("깨진 글·다른 버전·없음 → 기본 배치", () => {
    for (const raw of [null, "", "{", JSON.stringify({ v: 2, items: [] }), JSON.stringify({ items: [] }), "[]"]) {
      expect(parseHomeLayout(raw)).toEqual({ items: HOME_KPI_DEFAULT_LAYOUT, restored: false });
    }
  });

  it("저장 실패는 안내 글로 돌려준다(조용히 삼키지 않음)", () => {
    const full = { getItem: () => null, setItem: () => { throw new Error("QuotaExceeded"); } };
    expect(writeHomeLayout(full, HOME_KPI_DEFAULT_LAYOUT)).toContain("저장하지 못했습니다");
    expect(writeHomeLayout(null, HOME_KPI_DEFAULT_LAYOUT)).toContain("저장할 수 없습니다");
    expect(serializeHomeLayout([{ id: "K1", size: "1x1" }])).toBe('{"v":1,"items":[{"id":"K1","size":"1x1","hidden":false}]}');
  });
});

describe("읽을 원본 — 숨긴 위젯 원본은 안 읽는다", () => {
  it("분기 점검 진행만 보이면 워킨맵·명단만", () => {
    const only = HOME_KPI_DEFAULT_LAYOUT.map((x) => ({ ...x, hidden: x.id !== "K2" }));
    expect([...sourcesForLayout(only)].sort()).toEqual(["roster", "workin"]);
  });
  it("패널 위젯(기존 미처리 칸·접수 카드)은 현황판 원본을 더 읽게 하지 않는다", () => {
    const only = HOME_KPI_DEFAULT_LAYOUT.map((x) => ({ ...x, hidden: !["unhandledPanel", "receptionPanel"].includes(x.id) }));
    expect(sourcesForLayout(only).size).toBe(0);
  });
  it("달성표가 보이면 전 KPI 원본, 다 숨기면 0", () => {
    expect(sourcesForLayout(HOME_KPI_DEFAULT_LAYOUT)).toEqual(ALL_KPI_SOURCES);
    expect(sourcesForLayout(HOME_KPI_DEFAULT_LAYOUT.map((x) => ({ ...x, hidden: true }))).size).toBe(0);
  });
  it("60초 갱신은 가벼운 원본만, 5분(full)은 전부", () => {
    const want = new Set<KpiSource>(["field", "unhandled", "workin", "overage"]);
    expect([...splitSources(want, false)].sort()).toEqual(["overage", "unhandled"]);
    expect(splitSources(want, true)).toEqual(want);
  });
});

describe("묶음 합치기 — 실패한 원본은 마지막 값 유지, 상태는 오류", () => {
  it("field 가 이번에 실패하면 앞 값(facts)은 남고 sources 는 error, okAt 은 앞 시각", () => {
    const first = mergeBundle(null, bundleOf({ field: FIELD }, ["field", "roster"]));
    const failed: KpiBundle = { ...bundleOf({}, []), sources: { field: { status: "error", at: 2, error: "timeout" } } };
    const next = mergeBundle(first, failed);
    expect(next.bundle.facts.field).toBe(FIELD);
    expect(next.bundle.sources.field?.status).toBe("error");
    expect(next.bundle.sources.roster?.status).toBe("ok");
    expect(next.okAt.field).toBe(first.okAt.field);
  });
  it("날짜가 바뀌면 앞 값을 버린다", () => {
    const first = mergeBundle(null, bundleOf({ field: FIELD }, ["field"]));
    const tomorrow: KpiBundle = { ...bundleOf({}, []), today: "2026-10-24", ranges: kpiRanges("2026-10-24") };
    expect(mergeBundle(first, tomorrow).bundle.facts.field).toBeUndefined();
  });
});

describe("위젯 보기 = kpiCompute 와 같은 값", () => {
  const b = bundleOf(FACTS);
  const ctx = { teamOf, period: "week" as const };

  it("달성표: 점검 행 = countField(이번 주, 팀장 제외), 팀 칸·개인 칸도 같은 함수", () => {
    const rows = tableRows(b, ctx);
    const k1 = rows.find((r) => r.id === "K1")!;
    const w = b.ranges.week;
    expect(k1.total.actual).toBe(countField(FIELD, { kind: "inspection", from: w.from, to: w.to }));
    expect(k1.total.actual).toBe(3);
    expect(k1.teams.find((t) => t.team === "C")?.actual).toBe(2);
    expect(k1.people?.find((p) => p.name === "엄재현")?.actual).toBe(1);
    expect(k1.total.target).toBeNull(); // 목표 없는 지표 = 실적만(n/—)
    expect(k1.main).toBe(false);
  });

  it("주요 목표 = 설정 main(기본: 분기 점검·블로그·PC·초과·IT 실습·IT 퀴즈·오버홀), 원본 없는 지표는 '원본 연결 필요'", () => {
    const rows = tableRows(b, ctx);
    expect(rows.filter((r) => r.main).map((r) => r.id).sort()).toEqual(["K10", "K2", "K20", "K21", "K33", "K34", "K7"].sort());
    expect(rows.find((r) => r.id === "K21")).toMatchObject({ pending: true, pendingText: "원본 연결 필요" });
    // 관리 탭에서 main 을 바꾸면 그대로
    const custom = tableRows(bundleOf(FACTS, ALL_KPI_SOURCES, '{"K1":{"main":true},"K7":{"main":false}}'), ctx);
    expect(custom.find((r) => r.id === "K1")?.main).toBe(true);
    expect(custom.find((r) => r.id === "K7")?.main).toBe(false);
  });

  it("못 읽은 원본·표 없는 원본은 0 이 아니라 안내", () => {
    const bad = bundleOf(FACTS);
    bad.sources.field = { status: "error", at: 1, error: "timeout" };
    bad.sources.misu = { status: "missing", at: 1, error: "표 없음" };
    const rows = tableRows(bad, ctx);
    expect(rows.find((r) => r.id === "K1")).toMatchObject({ pending: true, pendingText: "불러오지 못함" });
    expect(rows.find((r) => r.id === "K14")).toMatchObject({ pending: true, pendingText: "준비 중(원본 표 실행 대기)" });
    expect(todayItems(bad, ctx).find((x) => x.id === "K1")?.value).toBeNull();
  });

  it("기간: 고를 수 없는 지표는 정의 기간(OKR = 이번 달, 미처리 = 열린 건)", () => {
    expect(effectivePeriod("K1", "today")).toBe("today");
    expect(effectivePeriod("K19", "week")).toBe("month");
    expect(effectivePeriod("K16", "week")).toBeNull();
    const rows = tableRows(b, ctx);
    expect(rows.find((r) => r.id === "K19")?.period).toBe("이번 달");
    expect(rows.find((r) => r.id === "K1")?.period).toBeUndefined();
  });

  it("금일 현황: 오늘 점검 2대(이민구·엄재현)", () => {
    expect(todayItems(b, ctx).find((x) => x.id === "K1")?.value).toBe(2);
  });

  it("분기 점검 진행 = workinPace 전체 줄(워킨맵 꼴 완료/대상)", () => {
    const v = quarterGoalView(b)!;
    const pace = workinPace(WORKIN, b.ranges, ROSTER, []);
    expect(v.value).toBe(pace[0].done);
    expect(v.target).toBe(pace[0].total);
    expect(v.value).toBe(4 + 2 + 1); // C G5 4곳 + A 매월 G3 2단위 + E G12 1곳
    expect(v.target).toBe(10 + 3 + 1);
    expect(v.lines).toHaveLength(2);
    expect(v.teams?.map((t) => t.team)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("인사말 '이번 주 내 점검' = 같은 함수", () => {
    expect(weekSummary(b, "이민구", teamOf)).toMatchObject({ mine: { inspection: 1, as: 0 }, all: { inspection: 3, as: 0 } });
    expect(weekSummary(bundleOf({}), "이민구", teamOf)).toBeNull();
  });
});

describe("렌더 스모크(서버 렌더, fetch 막음)", () => {
  beforeAll(() => { vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 }))); });
  afterAll(() => { vi.unstubAllGlobals(); });
  const render = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, "");

  it("현황판: 기간 칩·기본 위젯 제목이 뜨고(불러오는 중), 0 으로 보이지 않는다", () => {
    const html = render(createElement(HomeKpiBoard, {}));
    expect(html).toContain("CS KPI 현황판");
    for (const p of ["오늘", "이번 주", "이번 달", "분기"]) expect(html).toContain(`>${p}</button>`);
    for (const t of ["금일 현황", "분기 점검 진행", "KPI 달성표"]) expect(html).toContain(t);
    // 기존 홈 미처리 칸(팀 탭) + 미처리 접수 카드가 그대로 있다
    expect(html).toContain("미처리 일정");
    for (const tab of ["전체", "A", "E", "경영", "운영", "영업"]) expect(html).toContain(`>${tab}</button>`);
    expect(html).toContain("접수 미처리 현황 →");
    expect(html).not.toContain("미처리 요약"); // 요약 목록 위젯은 기본 숨김
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("편집");
  });

  it("달성표 위젯: [주요 목표]/[전체 지표] + CS 전체·팀 열", () => {
    const html = render(createElement(KpiWidget, { kind: "kpiTable", title: "KPI 달성표", basis: "x", status: "ready", size: "4x1", view: { kind: "kpiTable", rows: tableRows(bundleOf(FACTS), { teamOf, period: "week" }) } }));
    expect(html).toContain("주요 목표");
    expect(html).toContain("전체 지표");
    expect(html).toContain("CS 전체");
    expect(html).toContain("분기 점검 진행");
    expect(html).toContain("원본 연결 필요");
  });

  it("분기 점검 진행 위젯: '점검 7/14 · 50%' 꼴", () => {
    const html = render(createElement(KpiWidget, { kind: "quarterGoal", title: "분기 점검 진행", basis: "x", status: "ready", size: "2x1", view: quarterGoalView(bundleOf(FACTS))! }));
    expect(html).toContain(">점검<");
    expect(html).toMatch(/7<span[^>]*>\/14<\/span>/);
    expect(html).toContain("· 50%");
    expect(html).toContain("필요");
  });

  it("홈: 관제 덱 → KPI 현황판 → 운영·시스템(기본 펼침 — 에이전트 팀 카드까지) → 피드백", () => {
    const html = render(createElement(Home, { onGoField: () => {} }));
    const iDeck = html.indexOf("FIRSTOA CS · KPI");
    const iBoard = html.indexOf("CS KPI 현황판");
    const iOps = html.indexOf("운영·시스템");
    expect(iDeck).toBeGreaterThanOrEqual(0);
    expect(iBoard).toBeGreaterThan(iDeck);
    expect(iOps).toBeGreaterThan(iBoard);
    expect(html).toContain('aria-expanded="true" aria-controls="home-ops"');
    expect(html).toContain('id="home-ops"');
    expect(html).toContain('id="agent-team"');
    expect(html.indexOf('id="agent-team"')).toBeGreaterThan(iOps);
  });
});
