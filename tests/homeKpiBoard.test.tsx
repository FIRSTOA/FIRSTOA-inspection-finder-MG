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
  HOME_KPI_DEFAULT_LAYOUT, HOME_KPI_LAYOUT_KEY, HOME_KPI_LAYOUT_VERSION, HOME_WIDGETS, UNHANDLED_TOTAL_DEFS, effectivePeriod, mergeBundle, okrView,
  parseHomeLayout, quarterGoalView, readHomeLayout, serializeHomeLayout, sourcesForLayout, splitSources, tableRows, todayItems, unhandledParts,
  unhandledTotalView, weekSummary, writeHomeLayout,
} from "../src/kpi/homeKpiModel";
import { RECONTRACT_OVERDUE_DEFINITION } from "../src/kpi/kpiDefs";
import { countUnhandledTabs, mergeUnhandled, splitByGroup, type TicketInput } from "../src/homeUnhandled";
import { recontractOverdue, toFormRows } from "../src/kpi/kpiCompute";
import { emptyReport, type OkrReport } from "../src/okr";
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

describe("기본 배치(2026-10-24 개편 — 위젯 6개)", () => {
  it("금일 현황(4x1) → KPI 달성표(4x2) → 분기 점검 진행(2x1) → 미처리 전체(2x1) → 미처리 일정(2x2) → OKR(1x1)", () => {
    expect(HOME_KPI_DEFAULT_LAYOUT).toEqual([
      { id: "today", size: "4x1", hidden: false },
      { id: "table", size: "4x2", hidden: false },
      { id: "K2", size: "2x1", hidden: false },
      { id: "receptionPanel", size: "2x1", hidden: false },
      { id: "unhandledPanel", size: "2x2", hidden: false },
      { id: "K19", size: "1x1", hidden: false },
    ]);
    const kinds = Object.fromEntries(HOME_WIDGETS.map((w) => [w.id, w.kind]));
    expect(kinds).toEqual({ today: "todayStrip", table: "kpiTable", K2: "quarterGoal", receptionPanel: "unhandledTotal", unhandledPanel: "panel", K19: "okr" });
    for (const w of HOME_WIDGETS) expect(w.sizes).toContain(HOME_KPI_DEFAULT_LAYOUT.find((x) => x.id === w.id)!.size);
  });

  it("옛 배치(10-23)에 남은 없앤 위젯 id(K1·exp·K10·K3·K12·unhandled)는 버리고, 버전은 1 그대로", () => {
    const old = JSON.stringify({ v: 1, items: ["today", "K2", "table", "K1", "exp", "K10", "unhandledPanel", "receptionPanel", "K3", "K19", "K12", "unhandled"].map((id) => ({ id, size: id === "table" ? "4x1" : "1x1", hidden: id === "K19" })) });
    const { items, restored } = parseHomeLayout(old);
    expect(restored).toBe(true);
    expect(items.map((x) => x.id)).toEqual(["today", "K2", "table", "unhandledPanel", "receptionPanel", "K19"]);
    expect(items.find((x) => x.id === "table")?.size).toBe("4x1"); // 허용 크기면 사용자가 고른 크기 유지
    expect(items.find((x) => x.id === "K2")?.size).toBe("2x1"); // 허용 안 된 크기(1x1) → 첫 크기
    expect(items.find((x) => x.id === "K19")?.hidden).toBe(true);
    expect(HOME_KPI_LAYOUT_VERSION).toBe(1);
  });
});

describe("배치 저장/복원 — localStorage home_kpi_layout_v1 = {v:1, items}", () => {
  const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m }; };

  it("저장한 순서·크기·숨김이 그대로 돌아온다", () => {
    const st = memory();
    const changed = [...HOME_KPI_DEFAULT_LAYOUT].reverse().map((x) => (x.id === "K2" ? { ...x, size: "4x1" as const } : x.id === "K19" ? { ...x, hidden: true } : x));
    expect(writeHomeLayout(st, changed)).toBe("");
    expect(JSON.parse(st.m.get(HOME_KPI_LAYOUT_KEY)!).v).toBe(1);
    expect(readHomeLayout(st)).toEqual(changed);
  });

  it("모르는 id·중복은 버리고, 허용 안 된 크기는 첫 크기로, 새 위젯은 끝에 붙인다", () => {
    const raw = JSON.stringify({ v: 1, items: [{ id: "K19", size: "2x1" }, { id: "옛위젯", size: "1x1" }, { id: "K19", size: "1x1" }, { id: "table", size: "1x1", hidden: true }] });
    const { items, restored } = parseHomeLayout(raw);
    expect(restored).toBe(true);
    expect(items[0]).toEqual({ id: "K19", size: "2x1", hidden: false });
    expect(items[1]).toEqual({ id: "table", size: "4x2", hidden: true });
    expect(items.map((x) => x.id).sort()).toEqual(HOME_WIDGETS.map((w) => w.id).sort());
    expect(items.slice(2).map((x) => x.id)).toEqual(HOME_WIDGETS.map((w) => w.id).filter((id) => id !== "K19" && id !== "table"));
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
  it("미처리 일정 칸은 현황판 원본을 더 읽게 하지 않고, 미처리 전체 카드는 미처리·재계약(+명단)만", () => {
    const panel = HOME_KPI_DEFAULT_LAYOUT.map((x) => ({ ...x, hidden: x.id !== "unhandledPanel" }));
    expect(sourcesForLayout(panel).size).toBe(0);
    const total = HOME_KPI_DEFAULT_LAYOUT.map((x) => ({ ...x, hidden: x.id !== "receptionPanel" }));
    expect([...sourcesForLayout(total)].sort()).toEqual(["recontract", "roster", "unhandled"]);
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

  it("달성표: 점검 행 = countField(이번 주, 팀장 제외) — CS·A~E 칸, 팀 막대·개인 칩도 같은 함수, 목표 없음 = none + 지난주 대비", () => {
    const rows = tableRows(b, ctx);
    const k1 = rows.find((r) => r.id === "K1")!;
    const w = b.ranges.week;
    const cs = k1.cells.find((c) => c.scope === "CS")!;
    expect(cs.value).toBe(countField(FIELD, { kind: "inspection", from: w.from, to: w.to }));
    expect(cs.value).toBe(3);
    expect(k1.cells.map((c) => c.scope)).toEqual(["CS", "A", "B", "C", "D", "E"]);
    expect(k1.cells.find((c) => c.scope === "C")?.value).toBe(2);
    expect(k1.teamBars.find((t) => t.team === "CSS")?.value).toBe(1); // E 는 CSS 로 보인다
    expect(k1.people.find((p) => p.name === "엄재현")).toMatchObject({ value: 1, team: "CSS", target: null, done: false });
    expect(k1.status).toBe("none");
    expect(k1.trend).toEqual({ delta: 3, label: "지난주 대비" });
    expect(k1.cellState).toBe("ready");
    expect(k1.pace).toBeCloseTo(b.ranges.weekElapsedRate / 100); // 위젯 약속: 0~1
    expect(k1.main).toBe(false);
  });

  it("개인 칩은 팀 순서 → 실적 내림차순", () => {
    const k1 = tableRows(b, ctx).find((r) => r.id === "K1")!;
    expect(k1.people.map((p) => p.name)).toEqual(["이권선", "이민구", "한왕주", "엄재현"]);
  });

  it("주요 목표 = 설정 main(분기 점검·블로그·PC·초과·IT 실습·IT 퀴즈·오버홀). IT 표가 없으면 '준비 중 · SQL 실행 대기'(숫자 0 금지)", () => {
    const missing = bundleOf(FACTS);
    missing.sources.itPractice = { status: "missing", at: 1, error: "표 없음" };
    const rows = tableRows(missing, ctx);
    expect(rows.filter((r) => r.main).map((r) => r.id).sort()).toEqual(["K10", "K2", "K20", "K21", "K33", "K34", "K7"].sort());
    const k21 = rows.find((r) => r.id === "K21")!;
    expect(k21).toMatchObject({ cellState: "pending", pendingText: "준비 중 · SQL 실행 대기", status: "pending" });
    expect(k21.cells.every((c) => c.value === null)).toBe(true);
    const custom = tableRows(bundleOf(FACTS, ALL_KPI_SOURCES, '{"K1":{"main":true},"K7":{"main":false}}'), ctx);
    expect(custom.find((r) => r.id === "K1")?.main).toBe(true);
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
    expect(rows.find((r) => r.id === "K1")).toMatchObject({ cellState: "error", pendingText: "불러오지 못함", status: "pending" });
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

  it("절약 효과 '이번 주' = 같은 함수", () => {
    expect(weekSummary(b, "이민구", teamOf)).toMatchObject({ mine: { inspection: 1, as: 0 }, all: { inspection: 3, as: 0 } });
    expect(weekSummary(bundleOf({}), "이민구", teamOf)).toBeNull();
  });
});

describe("⑤ OKR 주 단위 — 이번 주 보고서, 없는 파트는 미작성(0% 아님)", () => {
  const goals = [1, 2].map((no) => ({ no, pillar: "P", bottleneck: "", objective: `목표${no}`, criteria: "" }));
  const rep = (cycle: string, team: string, member: string, js: string[]): OkrReport => ({ ...emptyReport(cycle, team, member), rows: js.map((j, i) => ({ no: i + 1, actual: "", judgment: j, reason: "", plan: "", evidence: "" })) });
  const weeks = [1, 2, 3, 4].map((n) => ({ id: `2026-10-W${n}`, weekNo: n, label: `${n}주` }));
  const reports = [
    rep("2026-10-W3", "A", "", ["완료", "미흡"]), // 파트 종합
    rep("2026-10-W3", "B", "이호준", ["완료", ""]), rep("2026-10-W3", "B", "박X", ["미착수", ""]), // 팀원만 — 가장 나쁜 판정
    rep("2026-10-W2", "C", "", ["완료", "완료"]), // 지난주만
  ];
  const okrBundle = bundleOf({ okr: { cycle: null, quarter: null, reports: [], week: { id: "2026-10-W3", weeks, goals, reports } } });

  it("이번 주 달성률·판정 수·미작성 파트·주별 막대", () => {
    const v = okrView(okrBundle, "week")!;
    expect(v.pct).toBe(33); // 완료 1 / 판정 3(A 완료·미흡, B 미착수)
    expect(v.counts.find((c) => c.label === "미착수")?.value).toBe(1);
    expect(v.missingTeams).toEqual(["C", "D"]);
    expect(v.weeks).toEqual([
      { label: "1주", pct: null, current: false }, { label: "2주", pct: 100, current: false },
      { label: "3주", pct: 33, current: true }, { label: "4주", pct: null, current: false },
    ]);
  });

  it("이번 주 보고서가 하나도 없으면 pct null + 4팀 미작성", () => {
    const empty = bundleOf({ okr: { cycle: null, quarter: null, reports: [], week: { id: "2026-10-W4", weeks, goals, reports } } });
    const v = okrView(empty, "week")!;
    expect(v.pct).toBeNull();
    expect(v.missingTeams).toEqual(["A", "B", "C", "D"]);
  });
});

describe("④ 미처리 전체 = 접수 + 물류 + 재계약 확인 지남", () => {
  it("큰 숫자 = 세 숫자 합, 정의문 그대로", () => {
    const v = unhandledTotalView({ reception: 27, logistics: 44, recontract: 3, breakdown: [{ label: "IT", value: 2 }] });
    expect(v.total).toBe(27 + 44 + 3);
    expect(v.parts.map((p) => [p.label, p.value])).toEqual([["접수", 27], ["물류", 44], ["재계약 확인 지남", 3]]);
    expect(v.defs).toBe(UNHANDLED_TOTAL_DEFS);
    expect(v.defs.find((d) => d.label === "재계약 확인 지남")?.text).toBe(RECONTRACT_OVERDUE_DEFINITION);
    expect(RECONTRACT_OVERDUE_DEFINITION).toBe('재계약 표에서 업체별 마지막 기록의 "다음확인일"이 오늘보다 지났는데 최종상태가 갱신완료·종료가 아닌 곳.');
  });

  it("재계약 미도착(2단계 전)·실패 시 접수+물류 합계, 재계약 칸은 '—'(0 없음)", () => {
    const loading = unhandledTotalView({ reception: 27, logistics: 44, recontract: null, breakdown: [] });
    expect(loading.total).toBe(71);
    const rc = loading.parts[2];
    expect(rc.value).toBeNull();
    expect(rc.label).toContain("재계약 확인 중");
    expect(loading.parts.some((p) => p.value === 0)).toBe(false);
    const failed = unhandledTotalView({ reception: 27, logistics: 44, recontract: null, recontractState: "error", breakdown: [] });
    expect(failed.total).toBe(71);
    expect(failed.parts[2]).toMatchObject({ value: null });
    expect(failed.parts[2].label).toContain("재계약 제외");
    // 도착하면 합계 갱신
    expect(unhandledTotalView({ reception: 27, logistics: 44, recontract: 2, breakdown: [] }).total).toBe(73);
    // 렌더: null 칸은 "—"
    const html = renderToString(createElement(KpiWidget, { kind: "unhandledTotal", title: "미처리 전체", basis: "x", status: "ready", size: "2x1", view: loading })).replace(/<!-- -->/g, "");
    expect(html).toContain("재계약 확인 중");
    expect(html).toMatch(/재계약 확인 중\)\s*<b[^>]*>—<\/b>/);
  });

  it("물류 = 홈 미처리 일정 칸과 같은 함수(splitByGroup), 재계약 = recontractOverdue — 못 읽은 원본은 null(0 아님)", () => {
    const tickets: TicketInput[] = [
      { id: "1", team: "C", date: "2026-10-20", vendor: "가", assignee: "", status: "대기", scheduleType: "납품" },
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

  it("현황판: 위젯 6개 제목이 뜨고(불러오는 중), 없앤 위젯은 없다", () => {
    const html = render(createElement(HomeKpiBoard, {}));
    for (const t of ["금일 현황", "KPI 달성표", "분기 점검 진행", "미처리 전체", "미처리 일정", "OKR 달성률"]) expect(html).toContain(t);
    for (const tab of ["전체", "A", "E", "경영", "운영", "영업"]) expect(html).toContain(`>${tab}</button>`);
    for (const gone of ["초과사용 제안 방문", "PC·복합기 확장성", "미처리 요약"]) expect(html).not.toContain(gone);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("편집");
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

  it("홈: 한 줄 머리(날짜·주차·분기·갱신 + 편집) → KPI 현황판 → 운영·시스템(데이터 자산 없음, 절약 효과는 맨 아래)", () => {
    const html = render(createElement(Home, { onGoField: () => {} }));
    expect(html).toMatch(/\d+월 \d+일\([일월화수목금토]\) <span[^>]*>·<\/span> \d+주차 <span[^>]*>·<\/span> [1-4]분기/);
    expect(html).toContain("갱신 ");
    expect(html).not.toContain("FIRSTOA CS · KPI");
    expect(html).not.toContain("데이터 자산");
    const iBoard = html.indexOf("CS KPI 현황판");
    const iOps = html.indexOf("운영·시스템");
    expect(iBoard).toBeGreaterThan(0);
    expect(iOps).toBeGreaterThan(iBoard);
    expect(html).toContain('aria-expanded="true" aria-controls="home-ops"');
    const iAgent = html.indexOf('id="agent-team"');
    const iImpact = html.indexOf("Impact · 절약 추정");
    expect(iAgent).toBeGreaterThan(iOps);
    expect(iImpact).toBeGreaterThan(iAgent); // IMPACT 는 운영 블록 맨 아래
  });
});

