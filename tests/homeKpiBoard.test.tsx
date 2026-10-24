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
  HOME_KPI_DEFAULT_LAYOUT, HOME_KPI_LAYOUT_KEY, HOME_KPI_LAYOUT_VERSION, HOME_WIDGETS, effectivePeriod, mergeBundle, okrView,
  parseHomeLayout, quarterGoalView, readHomeLayout, serializeHomeLayout, sourcesForLayout, splitSources, tableRows, todayItems, unhandledParts,
  writeHomeLayout,
} from "../src/kpi/homeKpiModel";
import { countUnhandledKinds, countUnhandledTabs, mergeUnhandled, splitByGroup, UNHANDLED_KINDS, UNHANDLED_TABS, type ReceptionInput, type TicketInput } from "../src/homeUnhandled";
import { isLogisticsSchedule } from "../src/overdueLogic";
import { LOGISTICS_SCHEDULE_TYPES } from "../src/receptionBoardData";
import HomeUnhandledPanel from "../src/HomeUnhandledPanel";
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

describe("기본 배치(2026-10-24 마무리 — 위젯 4개, 분기 점검 진행은 달성표 K2 행 안)", () => {
  it("금일 현황(4x1) → KPI 달성표(4x2) → 미처리(4x1, 2x2 가능) → OKR(2x1)", () => {
    expect(HOME_KPI_DEFAULT_LAYOUT).toEqual([
      { id: "today", size: "4x1", hidden: false },
      { id: "table", size: "4x2", hidden: false },
      { id: "unhandledPanel", size: "4x1", hidden: false },
      { id: "K19", size: "2x1", hidden: false },
    ]);
    expect(HOME_WIDGETS.find((w) => w.id === "unhandledPanel")?.sizes).toContain("2x2");
    const kinds = Object.fromEntries(HOME_WIDGETS.map((w) => [w.id, w.kind]));
    expect(kinds).toEqual({ today: "todayStrip", table: "kpiTable", unhandledPanel: "panel", K19: "okr" });
    for (const w of HOME_WIDGETS) expect(w.sizes).toContain(HOME_KPI_DEFAULT_LAYOUT.find((x) => x.id === w.id)!.size);
  });

  it("옛 배치(10-23·10-24)에 남은 없앤 위젯 id(K1·exp·K10·K3·K12·unhandled·receptionPanel·K2)는 버리고, 버전은 1 그대로", () => {
    const old = JSON.stringify({ v: 1, items: ["today", "K2", "table", "K1", "exp", "K10", "unhandledPanel", "receptionPanel", "K3", "K19", "K12", "unhandled"].map((id) => ({ id, size: id === "table" ? "4x1" : "1x1", hidden: id === "K19" })) });
    const { items, restored } = parseHomeLayout(old);
    expect(restored).toBe(true);
    expect(items.map((x) => x.id)).toEqual(["today", "table", "unhandledPanel", "K19"]);
    expect(items.find((x) => x.id === "table")?.size).toBe("4x1"); // 허용 크기면 사용자가 고른 크기 유지
    expect(items.find((x) => x.id === "unhandledPanel")?.size).toBe("4x1"); // 허용 안 된 크기(1x1) → 첫 크기
    expect(items.find((x) => x.id === "K19")?.hidden).toBe(true);
    expect(HOME_KPI_LAYOUT_VERSION).toBe(1);
  });
});

describe("배치 저장/복원 — localStorage home_kpi_layout_v1 = {v:1, items}", () => {
  const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m }; };

  it("저장한 순서·크기·숨김이 그대로 돌아온다", () => {
    const st = memory();
    const changed = [...HOME_KPI_DEFAULT_LAYOUT].reverse().map((x) => (x.id === "unhandledPanel" ? { ...x, size: "2x2" as const } : x.id === "K19" ? { ...x, hidden: true } : x));
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

  it("K2 행 펼침 = 분기 점검 블록(quarterGoalView 그대로, kind 없음) — 기준 바꾸면 그 기준", () => {
    const k2 = tableRows(b, ctx).find((r) => r.id === "K2")!;
    const { kind: _kind, ...q } = quarterGoalView(b, "end")!;
    void _kind;
    expect(k2.quarter).toEqual(q);
    expect(tableRows(b, ctx, "early").find((r) => r.id === "K2")?.quarter?.basis).toBe("early");
    expect(tableRows(b, ctx).find((r) => r.id === "K1")?.quarter).toBeUndefined();
  });

  it("고른 기간과 실제 기간이 다른 행은 기준 글에 기간 칩(이번 주 → K10 '이번 달')", () => {
    const rows = tableRows(b, ctx);
    expect(rows.find((r) => r.id === "K10")?.targetLabel).toMatch(/이번 달$/);
    expect(rows.find((r) => r.id === "K1")?.targetLabel).not.toMatch(/이번 (주|달)$/);
    const month = tableRows(b, { ...ctx, period: "month" });
    expect(month.find((r) => r.id === "K19")?.targetLabel).not.toMatch(/이번 주$/); // K19 는 월도 된다
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

  it("범위 칩: 팀 하나 = 그 파트만, 개인 = 그 사람 행만(주별 막대도 같은 범위), 이번 달은 개인 고르기 비움", () => {
    const all = okrView(okrBundle, "week")!;
    expect(all.scope).toEqual({ team: "ALL", members: ["박X", "이호준"] });
    expect(all.scopeLabel).toBe("CS 4파트(A~D) · 이번 주");
    const a = okrView(okrBundle, "week", { team: "A" })!;
    expect(a.pct).toBe(50); // 완료 1 / 판정 2
    expect(a.missingTeams).toEqual([]);
    expect(a.scopeLabel).toBe("A파트 · 이번 주");
    expect(a.scope.members).toEqual([]);
    const me = okrView(okrBundle, "week", { team: "B", member: "이호준" })!;
    expect(me.pct).toBe(100);
    expect(me.scope).toEqual({ team: "B", member: "이호준", members: ["박X", "이호준"] });
    expect(me.weeks.find((w) => w.current)?.pct).toBe(100);
    expect(me.weeks.find((w) => w.label === "2주")?.pct).toBeNull(); // 2주는 C 파트 기록뿐
    const month = okrView(okrBundle, "month", { team: "B", member: "이호준" })!;
    expect(month.scope).toEqual({ team: "B", members: [] });
    expect(month.scopeLabel).toBe("B파트 · 이번 달");
  });

  it("이번 주 보고서가 하나도 없으면 pct null + 4팀 미작성", () => {
    const empty = bundleOf({ okr: { cycle: null, quarter: null, reports: [], week: { id: "2026-10-W4", weeks, goals, reports } } });
    const v = okrView(empty, "week")!;
    expect(v.pct).toBeNull();
    expect(v.missingTeams).toEqual(["A", "B", "C", "D"]);
  });
});

describe("미처리 칸 하나 — 숫자는 mergeUnhandled 한 벌(2026-10-24 불일치 수정)", () => {
  // 실측(2026-10-24): 익일AS 2건이 물류로 세였고(홈 물류 46 vs 현황판 44), 팀 "기타" 물류 4건은 어느 탭에도 없었다(탭 합 431 vs 전체 435)
  const recs: ReceptionInput[] = [
    { id: "r1", type: "복합기 AS", region: "수도권A", receipt_date: "2026-10-10", vendor: "가", status: "접수" },
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

  it("익일AS 는 AS 일정, 물류는 현황판과 같은 유형 목록(한 정의)", () => {
    expect(rows.find((r) => r.key === "t:t1")?.kind).toBe("AS일정");
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

  it("현황판: 위젯 4개 제목이 뜨고(불러오는 중), 없앤 위젯(미처리 전체 카드·분기 점검 진행 위젯 포함)은 없다", () => {
    const html = render(createElement(HomeKpiBoard, {}));
    for (const t of ["금일 현황", "KPI 달성표", "미처리", "OKR 달성률"]) expect(html).toContain(t);
    expect(HOME_WIDGETS.map((w) => w.title)).not.toContain("분기 점검 진행");
    for (const gone of ["미처리 전체", "미처리 일정"]) expect(html).not.toContain(gone);
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

