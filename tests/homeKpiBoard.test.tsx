/**
 * 홈 KPI 현황판(2026-10-23) — 기본 배치 · 배치 저장/복원 · 숨긴 위젯 원본 안 읽기 · 묶음 합치기(실패면 마지막 값) ·
 * 위젯 보기(달성표·띠·분기 진행)가 kpiCompute 와 같은 값 · 렌더 스모크(서버 렌더, fetch 막음).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { countField, toFieldRows, type FieldRaw } from "../src/workCount";
import { kpiCount, kpiRanges, workinPace, type KpiFacts } from "../src/kpi/kpiCompute";
import { ALL_KPI_SOURCES, type KpiBundle } from "../src/kpi/kpiData";
import { parseKpiTargets, type KpiSource } from "../src/kpi/kpiDefs";
import {
  HOME_KPI_DEFAULT_LAYOUT, HOME_KPI_LAYOUT_KEY, HOME_KPI_LAYOUT_VERSION, HOME_WIDGETS, effectivePeriod, mergeBundle, okrView, okrPeopleForTeam, pickOkrWeekId,
  parseHomeLayout, quarterGoalView, readHomeLayout, serializeHomeLayout, sourcesForLayout, splitSources, tableRows, tableRowsFor, todayItems, unhandledParts,
  writeHomeLayout,
} from "../src/kpi/homeKpiModel";
import { countUnhandledKinds, countUnhandledTabs, mergeUnhandled, splitByGroup, UNHANDLED_KINDS, UNHANDLED_TABS, type ReceptionInput, type TicketInput } from "../src/homeUnhandled";
import { isLogisticsSchedule } from "../src/overdueLogic";
import { LOGISTICS_SCHEDULE_TYPES } from "../src/receptionBoardData";
import HomeUnhandledPanel from "../src/HomeUnhandledPanel";
import { recontractOverdue, toFormRows } from "../src/kpi/kpiCompute";
import { emptyReport, type OkrReport } from "../src/okr";
import { KpiWidget } from "../src/kpi/KpiWidgets.view";
import { okrTeamFromFilter, statusTileClass, teamCellDimmed } from "../src/kpi/kpiTiles";
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

describe("기본 배치(2026-10-24 마무리 — 위젯 4개, 분기 점검 진행은 달성표 K2 행 안)", () => {
  it("금일 현황(4x1, 기본 숨김 — 2026-10-24 사용자 \"금일 현황은 없어도\") → KPI 달성표(4x2) → 미처리(2x2, 4x1 가능) → OKR(2x2 — 미처리와 반반)", () => {
    expect(HOME_KPI_DEFAULT_LAYOUT).toEqual([
      { id: "today", size: "4x1", hidden: true },
      { id: "table", size: "4x2", hidden: false },
      { id: "unhandledPanel", size: "2x2", hidden: false },
      { id: "K19", size: "2x2", hidden: false },
    ]);
    expect(HOME_WIDGETS.find((w) => w.id === "unhandledPanel")?.sizes).toContain("2x2");
    const kinds = Object.fromEntries(HOME_WIDGETS.map((w) => [w.id, w.kind]));
    expect(kinds).toEqual({ today: "todayStrip", table: "kpiTable", unhandledPanel: "panel", K19: "okr" });
    for (const w of HOME_WIDGETS) expect(w.sizes).toContain(HOME_KPI_DEFAULT_LAYOUT.find((x) => x.id === w.id)!.size);
  });

  it("옛 배치(10-23·10-24)에 남은 없앤 위젯 id(K1·exp·K10·K3·K12·unhandled·receptionPanel·K2)는 버리고, v1 은 금일 현황만 숨겨 v2 로 읽는다", () => {
    const old = JSON.stringify({ v: 1, items: ["today", "K2", "table", "K1", "exp", "K10", "unhandledPanel", "receptionPanel", "K3", "K19", "K12", "unhandled"].map((id) => ({ id, size: id === "table" ? "4x1" : "1x1", hidden: id === "K19" })) });
    const { items, restored } = parseHomeLayout(old);
    expect(restored).toBe(true);
    expect(items.map((x) => x.id)).toEqual(["today", "table", "unhandledPanel", "K19"]);
    expect(items.find((x) => x.id === "table")?.size).toBe("4x1"); // 허용 크기면 사용자가 고른 크기 유지
    expect(items.find((x) => x.id === "unhandledPanel")?.size).toBe("2x2"); // 허용 안 된 크기(1x1) → 첫 크기
    expect(items.find((x) => x.id === "K19")?.hidden).toBe(true);
    expect(items.find((x) => x.id === "K19")?.size).toBe("2x2"); // v3 이전: OKR 은 미처리와 반반으로 올림
    expect(items.find((x) => x.id === "today")?.hidden).toBe(true); // v1 이전: 금일 현황은 숨김(2026-10-24 오후)
    expect(HOME_KPI_LAYOUT_VERSION).toBe(3);
  });
});

describe("배치 저장/복원 — localStorage home_kpi_layout_v1 = {v:1, items}", () => {
  const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m }; };

  it("저장한 순서·크기·숨김이 그대로 돌아온다", () => {
    const st = memory();
    const changed = [...HOME_KPI_DEFAULT_LAYOUT].reverse().map((x) => (x.id === "unhandledPanel" ? { ...x, size: "4x1" as const } : x.id === "K19" ? { ...x, hidden: true } : x));
    expect(writeHomeLayout(st, changed)).toBe("");
    expect(JSON.parse(st.m.get(HOME_KPI_LAYOUT_KEY)!).v).toBe(3);
    expect(readHomeLayout(st)).toEqual(changed);
  });

  it("모르는 id·중복은 버리고, 허용 안 된 크기는 첫 크기로, 새 위젯은 끝에 붙인다", () => {
    const raw = JSON.stringify({ v: 3, items: [{ id: "K19", size: "2x1" }, { id: "옛위젯", size: "1x1" }, { id: "K19", size: "1x1" }, { id: "table", size: "1x1", hidden: true }] });
    const { items, restored } = parseHomeLayout(raw);
    expect(restored).toBe(true);
    expect(items[0]).toEqual({ id: "K19", size: "2x1", hidden: false });
    expect(items[1]).toEqual({ id: "table", size: "4x2", hidden: true });
    expect(items.map((x) => x.id).sort()).toEqual(HOME_WIDGETS.map((w) => w.id).sort());
    expect(items.slice(2).map((x) => x.id)).toEqual(HOME_WIDGETS.map((w) => w.id).filter((id) => id !== "K19" && id !== "table"));
  });

  it("v2 저장분(OKR 2x1·1x1)은 v3 로 읽을 때 K19 만 2x2 로 올리고 나머지 크기·숨김은 그대로", () => {
    const raw = JSON.stringify({ v: 2, items: [{ id: "table", size: "4x1" }, { id: "K19", size: "2x1" }, { id: "unhandledPanel", size: "4x1", hidden: true }, { id: "today", size: "4x1", hidden: true }] });
    const { items } = parseHomeLayout(raw);
    expect(items.map((x) => [x.id, x.size, x.hidden])).toEqual([["table", "4x1", false], ["K19", "2x2", false], ["unhandledPanel", "4x1", true], ["today", "4x1", true]]);
  });

  it("깨진 글·다른 버전·없음 → 기본 배치", () => {
    for (const raw of [null, "", "{", JSON.stringify({ v: 4, items: [] }), JSON.stringify({ items: [] }), "[]"]) {
      expect(parseHomeLayout(raw)).toEqual({ items: HOME_KPI_DEFAULT_LAYOUT, restored: false });
    }
  });

  it("저장 실패는 안내 글로 돌려준다(조용히 삼키지 않음)", () => {
    const full = { getItem: () => null, setItem: () => { throw new Error("QuotaExceeded"); } };
    expect(writeHomeLayout(full, HOME_KPI_DEFAULT_LAYOUT)).toContain("저장하지 못했습니다");
    expect(writeHomeLayout(null, HOME_KPI_DEFAULT_LAYOUT)).toContain("저장할 수 없습니다");
    expect(serializeHomeLayout([{ id: "K1", size: "1x1" }])).toBe('{"v":3,"items":[{"id":"K1","size":"1x1","hidden":false}]}');
  });
});

describe("읽을 원본 — 숨긴 위젯 원본은 안 읽는다", () => {
  it("OKR 만 보이면 OKR·명단만", () => {
    const only = HOME_KPI_DEFAULT_LAYOUT.map((x) => ({ ...x, hidden: x.id !== "K19" }));
    expect([...sourcesForLayout(only)].sort()).toEqual(["okr", "roster"]);
  });
  it("미처리 칸은 묶음의 미처리·재계약(+명단)만 — 따로 읽지 않는다", () => {
    const panel = HOME_KPI_DEFAULT_LAYOUT.map((x) => ({ ...x, hidden: x.id !== "unhandledPanel" }));
    expect([...sourcesForLayout(panel)].sort()).toEqual(["recontract", "roster", "unhandled"]);
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

  it("달성표: 점검(K1) 줄은 없다(분기 점검 진행 K2 와 원본이 같아 중복 — 2026-10-26). 숫자는 kpiCount·금일 현황·팀 현황에 그대로", () => {
    const rows = tableRows(b, ctx);
    expect(rows.find((r) => r.id === "K1")).toBeUndefined();
    expect(tableRowsFor(b, ctx, ["K1", "K2"]).map((r) => r.id)).toEqual(["K2"]);
    const w = b.ranges.week;
    expect(kpiCount("K1", FACTS, {}, w, { teamOf })?.n).toBe(countField(FIELD, { kind: "inspection", from: w.from, to: w.to }));
    expect(kpiCount("K1", FACTS, {}, w, { teamOf })?.n).toBe(3);
    expect(kpiCount("K1", FACTS, { team: "C" }, w, { teamOf })?.n).toBe(2);
  });

  it("주요 목표 = 설정 main(분기 점검·블로그·PC·초과·IT 실습·IT 퀴즈·오버홀). IT 표가 없으면 '준비 중 · SQL 실행 대기'(숫자 0 금지)", () => {
    const missing = bundleOf(FACTS);
    missing.sources.itPractice = { status: "missing", at: 1, error: "표 없음" };
    const rows = tableRows(missing, ctx);
    // 2026-10-26: IT 퀴즈(K34) 빼고 재계약 진행(K35)
    expect(rows.filter((r) => r.main).map((r) => r.id).sort()).toEqual(["K10", "K2", "K20", "K21", "K33", "K35", "K7"].sort());
    const k21 = rows.find((r) => r.id === "K21")!;
    expect(k21).toMatchObject({ cellState: "pending", pendingText: "준비 중 · SQL 실행 대기", status: "pending" });
    expect(k21.cells.every((c) => c.value === null)).toBe(true);
    const custom = tableRows(bundleOf(FACTS, ALL_KPI_SOURCES, '{"K3":{"main":true},"K7":{"main":false}}'), ctx);
    expect(custom.find((r) => r.id === "K3")?.main).toBe(true);
    expect(custom.find((r) => r.id === "K7")?.main).toBe(false);
  });

  it("IT 실습·퀴즈 표가 있으면 인당 주 1·2 목표로 상태를 낸다(팀장 제외)", () => {
    const it2 = bundleOf({ ...FACTS, itPractice: [{ author: "한왕주", date: "2026-10-20" }, { author: "신정훈", date: "2026-10-21" }], itQuiz: [] });
    const rows = tableRows(it2, ctx);
    const k21 = rows.find((r) => r.id === "K21")!;
    expect(k21.cells.find((c) => c.scope === "CS")).toMatchObject({ value: 1, target: 4 }); // 팀장 기록 제외, 4명 × 주 1
    expect(k21.people.find((p) => p.name === "한왕주")).toMatchObject({ value: 1, target: 1, done: true });
    expect(rows.find((r) => r.id === "K34")?.cells.find((c) => c.scope === "CS")).toMatchObject({ value: 0, target: 8 });
  });

  it("못 읽은 원본은 0 이 아니라 '불러오지 못함'", () => {
    const bad = bundleOf(FACTS);
    bad.sources.field = { status: "error", at: 1, error: "timeout" };
    const rows = tableRows(bad, ctx);
    expect(rows.find((r) => r.id === "K3")).toMatchObject({ cellState: "error", pendingText: "불러오지 못함", status: "pending" });
    expect(todayItems(bad, ctx).find((x) => x.id === "K1")?.value).toBeNull();
  });

  it("기간: 고를 수 없는 지표는 정의 기간(OKR 은 주·월, 미처리 = 열린 건 — 경과 없음)", () => {
    expect(effectivePeriod("K1", "today")).toBe("today");
    expect(effectivePeriod("K19", "week")).toBe("week");
    expect(effectivePeriod("K19", "quarter")).toBe("week");
    expect(effectivePeriod("K16", "week")).toBeNull();
    expect(tableRows(b, ctx).find((r) => r.id === "K16")?.pace).toBeNull();
  });

  it("금일 현황: 오늘 점검 2대(이민구·엄재현)", () => {
    expect(todayItems(b, ctx).find((x) => x.id === "K1")?.value).toBe(2);
  });

  it("분기 점검 진행 = 팀별만(workinPace 팀 줄 — 팀 인원 기준 필요/지금), 기준 칩 말일/말일 10일 전", () => {
    const v = quarterGoalView(b)!;
    const pace = workinPace(WORKIN, b.ranges, ROSTER, []);
    expect(v.basis).toBe("end");
    expect(v.teams.map((t) => t.team)).toEqual(["A", "B", "C", "D", "CSS"]);
    const c = v.teams.find((t) => t.team === "C")!;
    const pc = pace.find((p) => p.team === "C")!;
    expect(c).toMatchObject({ done: 4, total: 10, pct: 40, headcount: 2, need: pc.toEnd.needHead, now: pc.pacePerPerson });
    expect(v.teams.find((t) => t.team === "B")).toMatchObject({ headcount: 0 });
    expect(v.bizDaysLeft).toBe(pace[0].toEnd.days);
    expect(v.elapsed).toBeCloseTo(b.ranges.quarterElapsedRate / 100);
    const early = quarterGoalView(b, "early")!;
    expect(early.bizDaysLeft).toBe(pace[0].toEarly.days);
    expect(early.teams.find((t) => t.team === "C")?.need).toBe(pc.toEarly.needHead);
    expect(early.endLabel).toMatch(/^말일 10일 전/);
  });

  it("K2 행 펼침 = 분기 점검 블록(quarterGoalView 그대로, kind 없음) — 기준 바꾸면 그 기준", () => {
    const k2 = tableRows(b, ctx).find((r) => r.id === "K2")!;
    const { kind: _kind, ...q } = quarterGoalView(b, "end")!;
    void _kind;
    expect(k2.quarter).toEqual(q);
    expect(tableRows(b, ctx, "early").find((r) => r.id === "K2")?.quarter?.basis).toBe("early");
    expect(tableRows(b, ctx).find((r) => r.id === "K3")?.quarter).toBeUndefined();
  });

  it("고른 기간과 실제 기간이 다른 행은 기준 글에 기간 칩(이번 주 → K10 '이번 달')", () => {
    const rows = tableRows(b, ctx);
    expect(rows.find((r) => r.id === "K10")?.targetLabel).toMatch(/이번 달$/);
    expect(rows.find((r) => r.id === "K3")?.targetLabel).not.toMatch(/이번 (주|달)$/);
    const month = tableRows(b, { ...ctx, period: "month" });
    expect(month.find((r) => r.id === "K19")?.targetLabel).not.toMatch(/이번 주$/); // K19 는 월도 된다
  });
});

describe("⑤ OKR 주 단위 — 이번 주 보고서, 없는 파트는 미작성(0% 아님)", () => {
  const goals = [1, 2].map((no) => ({ no, pillar: "P", bottleneck: "", objective: `목표${no}`, criteria: "" }));
  const rep = (cycle: string, team: string, member: string, js: string[]): OkrReport => ({ ...emptyReport(cycle, team, member), rows: js.map((j, i) => ({ no: i + 1, actual: "", judgment: j, reason: "", plan: "", evidence: "" })) });
  const weeks = [1, 2, 3, 4].map((n) => ({ id: `2026-10-W${n}`, weekNo: n, label: `${n}주` }));
  const reports = [
    // 2026-10-26 팀 % = 팀원별 평균(파트 종합 행은 % 에 안 듦) — 그래서 A·C 는 파트 종합 대신 팀원 한 명(정X·최X) 행으로 같은 판정을 준다
    rep("2026-10-W3", "A", "정X", ["완료", "미흡"]),
    rep("2026-10-W3", "B", "이호준", ["완료", ""]), rep("2026-10-W3", "B", "박X", ["미착수", ""]), // 판정 수는 가장 나쁜 판정 행
    rep("2026-10-W2", "C", "최X", ["완료", "완료"]), // 지난주만 — 이번 주엔 C 구성원 최X 미작성(0%)
  ];
  const okrBundle = bundleOf({ okr: { cycle: null, quarter: null, reports: [], week: { id: "2026-10-W3", weeks, goals, reports } } });
  const wk = (n: number, pct: number | null, o: { current?: boolean; selected?: boolean; future?: boolean } = {}) =>
    ({ id: `2026-10-W${n}`, label: `${n}주`, pct, current: !!o.current, selected: !!o.selected, future: !!o.future });

  it("이번 주 달성률·판정 수·미작성 파트·주별 막대(기본 = 이번 주, 4주는 아직 안 옴)", () => {
    const v = okrView(okrBundle)!;
    expect(v.pct).toBe(38); // 구성원 4명 평균: 정X 50·이호준 100·박X 0·최X 미작성 0 → 37.5 (종전 판정 행 완료 1/3 = 33)
    expect(v.counts.find((c) => c.label === "미착수")?.value).toBe(1);
    expect(v.missingTeams).toEqual(["C", "D"]);
    expect(v.weekId).toBe("2026-10-W3");
    // 2주 = 최X 100 + 나머지 3명 미작성 0 → 25 (종전 C 판정 행만 100) · 3주 = 위와 같은 38
    expect(v.weeks).toEqual([wk(1, null), wk(2, 25), wk(3, 38, { current: true, selected: true }), wk(4, null, { future: true })]);
  });

  it("범위 칩: 팀 하나 = 그 파트만, 개인 = 그 사람 행만(주별 막대도 같은 범위) · 머리 글 = 범위 · 몇 월 몇 주차(월~금)", () => {
    const all = okrView(okrBundle)!;
    expect(all.scope).toEqual({ team: "ALL", members: ["박X", "이호준", "정X", "최X"] }); // 정X·최X = 파트 종합 대신 넣은 팀원
    expect(all.scopeLabel).toBe("CS 4파트 · 10월 3주차(10/19~10/23)");
    const a = okrView(okrBundle, { team: "A" })!;
    expect(a.pct).toBe(50); // 정X 완료 1 / 판정 2
    expect(a.missingTeams).toEqual([]);
    expect(a.scopeLabel).toBe("A파트 · 10월 3주차(10/19~10/23)");
    expect(a.scope.members).toEqual(["정X"]); // 파트 종합 대신 팀원 정X
    const me = okrView(okrBundle, { team: "B", member: "이호준" })!;
    expect(me.pct).toBe(100);
    expect(me.scope).toEqual({ team: "B", member: "이호준", members: ["박X", "이호준"] });
    expect(me.scopeLabel).toBe("이호준(B) · 10월 3주차(10/19~10/23)");
    expect(me.weeks.find((w) => w.current)?.pct).toBe(100);
    expect(me.weeks.find((w) => w.label === "2주")?.pct).toBeNull(); // 2주는 C 파트 기록뿐
    // (2026-10-25) 옛 period "month" 기대(이번 달 범위·"B파트 · 이번 달")는 삭제 — OKR 박스에서 월 보기를 뺐다(달성표 K19 행에서 월·분기)
  });

  it("주차 고르기: 2주 = pct·판정 수·미작성 파트·팀 칩 %·머리 글 전부 2주 기준", () => {
    const v = okrView(okrBundle, { weekId: "2026-10-W2" })!;
    expect(v.weekId).toBe("2026-10-W2");
    expect(v.pct).toBe(25); // 최X 100 + 정X·이호준·박X 그 주 미작성 0 → 25 (종전 C 판정 행만 100)
    expect(v.allPct).toBe(25);
    expect(v.counts.find((c) => c.label === "완료")?.value).toBe(2);
    expect(v.missingTeams).toEqual(["A", "B", "D"]);
    expect(v.teamLines?.map((l) => [l.team, l.pct])).toEqual([["A", null], ["B", null], ["C", 100], ["D", null]]);
    expect(v.scopeLabel).toBe("CS 4파트 · 10월 2주차(10/12~10/16)");
    expect(v.weeks.map((w) => [w.selected, w.current])).toEqual([[false, false], [true, false], [false, true], [false, false]]);
  });

  it("주차 고르기: 없는 id(달이 바뀜)·아직 안 온 주·'week'·생략은 이번 주로", () => {
    for (const id of ["2026-09-W4", "2026-10-W4", "week", undefined]) expect(okrView(okrBundle, { weekId: id })!.weekId).toBe("2026-10-W3");
    const w = okrBundle.facts.okr!.week!;
    expect(pickOkrWeekId(w, "2026-10-W1")).toBe("2026-10-W1");
    expect(pickOkrWeekId(w, "2026-11-W1")).toBe("2026-10-W3");
  });

  it("5주 있는 달 = 주차 5칸(칩·막대 둘 다 이 목록)", () => {
    const weeks5 = [1, 2, 3, 4, 5].map((n) => ({ id: `2026-08-W${n}`, weekNo: n, label: `${n}주` }));
    const v = okrView(bundleOf({ okr: { cycle: null, quarter: null, reports: [], week: { id: "2026-08-W5", weeks: weeks5, goals, reports: [] } } }))!;
    expect(v.weeks.map((w) => w.label)).toEqual(["1주", "2주", "3주", "4주", "5주"]);
    expect(v.weeks.some((w) => w.future)).toBe(false);
    expect(v.scopeLabel).toBe("CS 4파트 · 8월 5주차(8/31~9/4)");
    const html = renderToString(createElement(KpiWidget, { kind: "okr", title: "OKR", basis: "b", status: "ready", size: "2x1", view: { ...v, scope: { ...v.scope, onScope: () => {} }, onWeek: () => {} } }));
    const group = html.slice(html.indexOf('aria-label="OKR 주차"'));
    expect((group.slice(0, group.indexOf("</div>")).match(/<button/g) ?? []).length).toBe(5);
  });

  it("파트별 미니 바 teams — 전체 A~D, 팀 하나·개인은 그 파트만, 미작성 파트는 null", () => {
    expect(okrView(okrBundle)!.teams).toEqual([
      { team: "A", pct: 50 }, { team: "B", pct: 50 }, { team: "C", pct: null }, { team: "D", pct: null }, // B = 이호준 100·박X 0 평균(종전 가장 나쁜 판정 0)
    ]);
    expect(okrView(okrBundle, { team: "A" })!.teams).toEqual([{ team: "A", pct: 50 }]);
    expect(okrView(okrBundle, { team: "B", member: "이호준" })!.teams).toEqual([{ team: "B", pct: 100 }]);
    // (2026-10-25) 옛 period "month" teams 기대는 삭제 — OKR 박스 월 보기 삭제
  });

  it("이번 주 보고서가 하나도 없으면 pct null + 4팀 미작성", () => {
    const empty = bundleOf({ okr: { cycle: null, quarter: null, reports: [], week: { id: "2026-10-W4", weeks, goals, reports } } });
    const v = okrView(empty)!;
    expect(v.pct).toBeNull();
    expect(v.missingTeams).toEqual(["A", "B", "C", "D"]);
  });

  // 홈 3차(2026-10-25): 개인 드롭다운 대신 팀 칩 → 팀원 목록. 숫자는 okrWeekResult 그대로(새로 세지 않음)
  const withKim = bundleOf({ okr: { cycle: null, quarter: null, reports: [...reports, rep("2026-10-W2", "B", "김Y", ["완료", "미흡"])], week: { id: "2026-10-W3", weeks, goals, reports: [...reports, rep("2026-10-W2", "B", "김Y", ["완료", "미흡"])] } } });
  it("팀 칩 B = 그 팀원 목록(% 내림차순, 미작성은 아래): 판정 수·달성률, 이번 주 기록 없는 사람은 미작성 + 지난주 %", () => {
    const b = okrView(withKim, { team: "B" })!;
    expect(b.people).toEqual([
      { name: "이호준", pct: 100, counts: { done: 1, partial: 0, poor: 0, none: 0 }, missing: false, prevPct: null },
      { name: "박X", pct: 0, counts: { done: 0, partial: 0, poor: 0, none: 1 }, missing: false, prevPct: null },
      { name: "김Y", pct: null, counts: { done: 0, partial: 0, poor: 0, none: 0 }, missing: true, prevPct: 50 },
    ]);
    expect(okrView(withKim, { team: "A" })!.people.map((p) => p.name)).toEqual(["정X"]); // A 는 팀원 정X 한 명(파트 종합 대신, 2026-10-26)
  });
  it("팀 칩 B + 2주 고름 = 팀원 목록·prevPct 가 2주 기준(앞 주 = 1주)", () => {
    const b = okrView(withKim, { team: "B", weekId: "2026-10-W2" })!;
    expect(b.people).toEqual([
      { name: "김Y", pct: 50, counts: { done: 1, partial: 0, poor: 1, none: 0 }, missing: false, prevPct: null },
      { name: "박X", pct: null, counts: { done: 0, partial: 0, poor: 0, none: 0 }, missing: true, prevPct: null },
      { name: "이호준", pct: null, counts: { done: 0, partial: 0, poor: 0, none: 0 }, missing: true, prevPct: null },
    ]);
    expect(b.pct).toBe(17); // B 팀 2주 = 김Y 50·박X 0·이호준 0 평균 (종전 판정 행 50)
    expect(okrPeopleForTeam(withKim, "B", "2026-10-W2")).toEqual(b.people);
    // 이번 주(3주)를 고르면 김Y 는 미작성 + 앞 주(2주) 50%
    expect(okrPeopleForTeam(withKim, "B", "2026-10-W3").find((p) => p.name === "김Y")?.prevPct).toBe(50);
    expect(okrPeopleForTeam(withKim, "B")).toEqual(okrPeopleForTeam(withKim, "B", "week")); // 팀 카드 호출 꼴 호환
  });
  it("명단(roster) 기준: 이번 달 보고를 한 번도 안 쓴 사람도 미작성으로 나온다(팀장·다른 팀 제외), 팀 4줄 미작성 n명도 같은 정의", () => {
    const okr = withKim.facts.okr!;
    const withRoster = bundleOf({ okr, roster: [{ name: "최Z", team: "B" }, { name: "박X", team: "B" }, { name: "장팀", team: "B", title: "팀장" }, { name: "한A", team: "A" }] });
    const ppl = okrPeopleForTeam(withRoster, "B", "week");
    expect(ppl.map((p) => [p.name, p.missing])).toEqual([["이호준", false], ["박X", false], ["김Y", true], ["최Z", true]]);
    expect(ppl.find((p) => p.name === "최Z")).toEqual({ name: "최Z", pct: null, counts: { done: 0, partial: 0, poor: 0, none: 0 }, missing: true, prevPct: null });
    expect(okrPeopleForTeam(withRoster, "A", "week").map((p) => p.name)).toEqual(["정X", "한A"]); // 보고자 정X(작성) 위, 명단 한A(미작성) 아래
    expect(okrPeopleForTeam(withRoster, "B", "month")).toEqual([]); // 옛 호출 호환
    // C 1 = 최X(2주만 씀) 3주 미작성, 2주의 A 2 = 정X(3주만 씀)·한A — 파트 종합 대신 팀원 행이라 늘었다
    expect(okrView(withRoster)!.teamLines?.map((l) => [l.team, l.missing])).toEqual([["A", 1], ["B", 2], ["C", 1], ["D", 0]]);
    expect(okrView(withRoster, { weekId: "2026-10-W2" })!.teamLines?.map((l) => [l.team, l.missing])).toEqual([["A", 2], ["B", 3], ["C", 0], ["D", 0]]);
  });
  it("전체 칩 = 팀 4줄(%·미작성 n명), 칩 % 는 고른 범위와 상관없이 A~D 전체", () => {
    const all = okrView(withKim)!;
    expect(all.people).toEqual([]);
    expect(all.allPct).toBe(30); // 5명 평균: 정X 50·이호준 100·박X 0·김Y 0·최X 0 (종전 판정 행 1/3 = 33)
    expect(all.teamLines).toEqual([
      // B 33 = (100 + 0 + 0) / 3 (종전 0), C 미작성 1 = 최X
      { team: "A", pct: 50, missing: 0 }, { team: "B", pct: 33, missing: 1 }, { team: "C", pct: null, missing: 1 }, { team: "D", pct: null, missing: 0 },
    ]);
    const b = okrView(withKim, { team: "B" })!;
    expect(b.allPct).toBe(30);
    expect(b.teamLines).toEqual(all.teamLines);
    // (2026-10-25) 옛 period "month" 팀원·팀 4줄 기대는 삭제 — OKR 박스 월 보기 삭제
  });
});

describe("홈 3차 달성표 상태 타일 · 팀 필터(2026-10-25)", () => {
  const render = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, "");
  it("statusTileClass: 달성 초록·순항 파랑·부족 빨강·목표 없음 회색, 목표 없는 칸은 상태와 상관없이 회색", () => {
    expect(statusTileClass("done", true)).toBe("bg-emerald-500/15");
    expect(statusTileClass("onTrack", true)).toBe("bg-sky-500/12");
    expect(statusTileClass("behind", true)).toBe("bg-rose-500/18");
    expect(statusTileClass("none", true)).toBe("bg-white/[0.04]");
    expect(statusTileClass("behind", false)).toBe("bg-white/[0.04]");
    expect(statusTileClass("pending", false)).toContain("border-dashed");
  });
  it("teamCellDimmed: 필터 없으면 아무것도 안 흐림, 있으면 다른 팀만(CS 전체는 그대로)", () => {
    expect(["CS", "A", "B", "C", "D", "E"].some((s) => teamCellDimmed(s as "A", null))).toBe(false);
    expect(["CS", "A", "B", "C", "D", "E"].some((s) => teamCellDimmed(s as "A", undefined))).toBe(false);
    expect(["CS", "A", "B", "C", "D", "E"].filter((s) => teamCellDimmed(s as "A", "C"))).toEqual(["A", "B", "D", "E"]);
  });
  it("okrTeamFromFilter: A~D 는 그 팀 칩, CSS(E)·없음은 전체", () => {
    expect(okrTeamFromFilter("C")).toBe("C");
    expect(okrTeamFromFilter("E")).toBe("ALL");
    expect(okrTeamFromFilter(null)).toBe("ALL");
  });
  it("달성표 렌더: teamFilter 있으면 다른 팀 칸 opacity-40, 없으면 흐린 칸 없음 · 머리줄 팀 배지·폰 5칸 띠", () => {
    const rows = tableRows(bundleOf(FACTS), { teamOf, period: "week" }).filter((r) => r.main);
    const view = (teamFilter?: "A" | "B" | "C" | "D" | "E" | null) => render(createElement(KpiWidget, {
      kind: "kpiTable", title: "KPI 달성표", basis: "x", status: "ready", size: "4x2",
      view: { kind: "kpiTable", period: "week", view: "main", rows, counts: { main: rows.length, all: rows.length }, onPeriod: () => {}, onView: () => {}, teamFilter },
    }));
    const plain = view();
    expect(plain).not.toContain("opacity-40");
    expect(plain).toContain("CSS팀");
    expect(plain).toContain("grid grid-cols-5"); // 폰 카드 아래 5칸 띠
    expect(plain).toContain("bg-indigo-400/[0.18]"); // A 팀 배지(팀 색)
    expect(view("C")).toContain("opacity-40");
    expect(view(null)).not.toContain("opacity-40");
  });
});

describe("미처리 칸 하나 — 숫자는 mergeUnhandled 한 벌(2026-10-24 불일치 수정)", () => {
  // 실측(2026-10-24): 익일AS 2건이 물류로 세였고(홈 물류 46 vs 현황판 44), 팀 "기타" 물류 4건은 어느 탭에도 없었다(탭 합 431 vs 전체 435)
  const recs: ReceptionInput[] = [
    { id: "r1", type: "원격이관", region: "수도권A", receipt_date: "2026-10-10", vendor: "가", status: "접수" }, // 복합기 AS 접수는 2026-10-25부터 일정 기준이라 원격으로
    { id: "r2", type: "IT", region: "", receipt_date: "2026-10-12", vendor: "나", status: "접수" },
    { id: "r3", type: "영업팀", region: "", receipt_date: "2026-10-15", vendor: "다", status: "접수" },
  ];
  const tks: TicketInput[] = [
    { id: "t1", team: "B", date: "2026-10-20", vendor: "라", assignee: "", status: "배정", scheduleType: "익일AS" },
    { id: "t2", team: "C", date: "2026-10-19", vendor: "마", assignee: "", status: "배정", scheduleType: "납품철수교체휴가교육" },
    { id: "t3", team: "기타", date: "2026-10-18", vendor: "바", assignee: "", status: "배정", scheduleType: "납품철수교체휴가교육" },
    { id: "t4", team: "D", date: "2026-10-17", vendor: "사", assignee: "", status: "배정", scheduleType: "물류" },
    { id: "t5", team: "E", date: "2026-10-16", vendor: "아", assignee: "", status: "배정", scheduleType: "AS" },
  ];
  const rows = mergeUnhandled(recs, tks, TODAY);

  it("전체 = 팀 탭 합 = 종류 칸 합", () => {
    const tabs = countUnhandledTabs(rows);
    const kinds = countUnhandledKinds(rows);
    expect(tabs["전체"]).toBe(8);
    expect(UNHANDLED_TABS.filter((t) => t !== "전체").reduce((n, t) => n + tabs[t], 0)).toBe(tabs["전체"]);
    expect(UNHANDLED_KINDS.reduce((n, k) => n + kinds[k], 0)).toBe(tabs["전체"]);
    expect(tabs["기타"]).toBe(2); // 팀 없는 IT 접수 + 팀 "기타" 물류
  });

  it("익일AS 는 CS접수, 물류는 현황판과 같은 유형 목록(한 정의)", () => {
    expect(rows.find((r) => r.key === "t:t1")?.kind).toBe("CS접수");
    expect(countUnhandledKinds(rows)["물류"]).toBe(3);
    expect(LOGISTICS_SCHEDULE_TYPES.every((t) => isLogisticsSchedule(t))).toBe(true);
    for (const t of ["AS", "익일AS", "매월점검", ""]) expect(isLogisticsSchedule(t)).toBe(false);
  });

  it("물류 칸 = 팀 현황 물류(unhandledParts, splitByGroup)와 같은 값 · 패널 렌더 숫자 = 같은 함수", () => {
    const b = bundleOf({ unhandled: rows }, ["unhandled", "roster"]);
    expect(unhandledParts(b).logistics).toBe(countUnhandledKinds(rows)["물류"]);
    expect(unhandledParts(b).logistics).toBe(splitByGroup(rows).logistics.length);
    const html = renderToString(createElement(HomeUnhandledPanel, { bundle: b, onOpenOverdue: () => {}, onOpenReception: () => {} })).replace(/<!-- -->/g, "");
    expect(html).toContain("8건");
    expect(html).toMatch(/data-kind="물류"[^>]*>.*?<span[^>]*>3<\/span>/);
    expect(html).toMatch(/data-kind="recontract"[^>]*>.*?<span[^>]*>—<\/span>/); // 재계약 원본 전: 0 아님
    expect(html).toContain("기타"); // 팀 없는 행이 있으면 기타 탭
    expect(html).not.toContain("미처리 전체");
  });

  it("묶음 전에는 … (0 으로 그리지 않음)", () => {
    const html = renderToString(createElement(HomeUnhandledPanel, { bundle: null, onOpenOverdue: () => {}, onOpenReception: () => {} }));
    expect(html).toContain("…");
  });

  it("물류 = 홈 미처리 일정 칸과 같은 함수(splitByGroup), 재계약 = recontractOverdue — 못 읽은 원본은 null(0 아님)", () => {
    const tickets: TicketInput[] = [
      { id: "1", team: "C", date: "2026-10-20", vendor: "가", assignee: "", status: "대기", scheduleType: "납품철수교체휴가교육" },
      { id: "2", team: "A", date: "2026-10-21", vendor: "나", assignee: "", status: "대기", scheduleType: "AS" },
    ];
    const unhandled = mergeUnhandled([], tickets, TODAY);
    const recontract = toFormRows([
      { id: 1, created_at: "2026-10-01T01:00:00Z", "날짜": "2026-10-01", "작성자": "한왕주", "업체명": "가업체", "최종상태": "진행중", "다음확인일": "2026-10-10" },
      { id: 2, created_at: "2026-10-02T01:00:00Z", "날짜": "2026-10-02", "작성자": "한왕주", "업체명": "나업체", "최종상태": "종료", "다음확인일": "2026-10-10" },
    ], "날짜", teamOf);
    const parts = unhandledParts(bundleOf({ unhandled, recontract }));
    expect(parts.logistics).toBe(splitByGroup(unhandled).logistics.length);
    expect(parts.recontract).toBe(recontractOverdue(recontract, TODAY).count);
    expect(parts).toEqual({ logistics: 1, recontract: 1 });
    expect(countUnhandledTabs(unhandled)["전체"]).toBe(2);
    expect(unhandledParts(bundleOf({}, []))).toEqual({ logistics: null, recontract: null });
    expect(unhandledParts(null)).toEqual({ logistics: null, recontract: null });
  });
});

describe("렌더 스모크(서버 렌더, fetch 막음)", () => {
  beforeAll(() => { vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 }))); });
  afterAll(() => { vi.unstubAllGlobals(); });
  const render = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, "");

  it("현황판: 보이는 위젯 3개 제목이 뜨고(불러오는 중, 금일 현황은 기본 숨김), 없앤 위젯(미처리 전체 카드·분기 점검 진행 위젯 포함)은 없다", () => {
    const html = render(createElement(HomeKpiBoard, {}));
    for (const t of ["KPI 달성표", "미처리", "OKR 달성률"]) expect(html).toContain(t);
    expect(html).not.toContain("금일 현황");
    expect(HOME_WIDGETS.map((w) => w.title)).not.toContain("분기 점검 진행");
    for (const gone of ["미처리 전체", "미처리 일정"]) expect(html).not.toContain(gone);
    for (const tab of ["전체", "A", "CSS", "경영", "운영", "영업"]) expect(html).toContain(`>${tab}</button>`); // 홈 3차: E 탭은 화면 이름 CSS
    for (const gone of ["초과사용 제안 방문", "PC·복합기 확장성", "미처리 요약"]) expect(html).not.toContain(gone);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("편집");
  });

  it("금일 현황은 숨김일 뿐 삭제 아님: 편집 [위젯 추가]에 1개로 잡히고, 켜서 저장한 배치면 다시 그린다", () => {
    expect(HOME_WIDGETS.map((w) => w.id)).toContain("today");
    const editing = render(createElement(HomeKpiBoard, { editing: true }));
    expect(editing).toMatch(/위젯 추가<span[^>]*>1<\/span>/);
    // [켜기] = 숨김 풀고 끝에 붙여 저장(HomeKpiGrid show) — 그 저장 글을 읽으면 금일 현황이 다시 보인다
    const turnedOn = [...HOME_KPI_DEFAULT_LAYOUT.filter((x) => x.id !== "today"), { id: "today", size: "4x1" as const, hidden: false }];
    const saved = serializeHomeLayout(turnedOn);
    expect(parseHomeLayout(saved).items.find((x) => x.id === "today")?.hidden).toBe(false);
    const store = new Map<string, string>([[HOME_KPI_LAYOUT_KEY, saved]]);
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } } });
    try {
      const html = render(createElement(HomeKpiBoard, {}));
      expect(html).toContain(`aria-label="금일 현황"`);
    } finally {
      vi.unstubAllGlobals();
      vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    }
  });

  it("달성표 위젯: 주요 목표/전체 지표 칩과 지표 이름", () => {
    const rows = tableRows(bundleOf(FACTS), { teamOf, period: "week" });
    const html = render(createElement(KpiWidget, {
      kind: "kpiTable", title: "KPI 달성표", basis: "x", status: "ready", size: "4x2",
      view: { kind: "kpiTable", period: "week", view: "main", rows: rows.filter((r) => r.main), counts: { main: rows.filter((r) => r.main).length, all: rows.length }, onPeriod: () => {}, onView: () => {} },
    }));
    expect(html).toContain("KPI 달성표");
    expect(html).toContain("주요 목표");
    expect(html).toContain("전체 지표");
    expect(html).toContain("분기 점검 진행");
  });

  it("홈: 머리 띠(큰 날짜·연도 | 분기 남은 영업일 칩 | 갱신 + 편집, 주차 없음) → KPI 현황판 → 운영·시스템(데이터 자산·절약 효과 없음)", () => {
    const html = render(createElement(Home, { onGoField: () => {} }));
    expect(html).toMatch(/\d+월 \d+일 [일월화수목금토]요일<\/span>/);
    expect(html).toMatch(/[1-4]분기 <span[^>]*>·<\/span> 말일까지 <b[^>]*>\d+<\/b>영업일/);
    const head = html.slice(0, html.indexOf("CS KPI 현황판"));
    expect(head).not.toContain("주차");
    expect(html).toContain("갱신 ");
    expect(html).toContain("text-2xl");
    expect(html).not.toContain("FIRSTOA CS · KPI");
    expect(html).not.toContain("데이터 자산");
    const iBoard = html.indexOf("CS KPI 현황판");
    const iOps = html.indexOf("운영·시스템");
    expect(iBoard).toBeGreaterThan(0);
    expect(iOps).toBeGreaterThan(iBoard);
    expect(html).toContain('aria-expanded="true" aria-controls="home-ops"');
    const iAgent = html.indexOf('id="agent-team"');
    expect(iAgent).toBeGreaterThan(iOps);
    expect(html).not.toContain("절약 추정"); // IMPACT 삭제(2026-10-24)
  });
});

