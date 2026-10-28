// 통합검색 OKR 도구(T1·T2, 2026-10-29) — 가짜 rest 로 읽기 경로까지, 숫자는 홈 K19 와 같은 함수
import { describe, expect, it } from "vitest";
import { okrMemberReport, okrTeamReport, toReport, type MemberAnalysis, type TeamAnalysis } from "../supabase/functions/_shared/ask/tools-okr.ts";
import { ASK_TOOLS, type AskToolCtx } from "../supabase/functions/_shared/ask/tools-index.ts";
import { askMask } from "../supabase/functions/_shared/ask/mask.ts";

type Row = Record<string, unknown>;
const goals = [1, 2, 3].map((no) => ({ no, pillar: "Pillar 1.\nAI · 효율성 · 비용절감", bottleneck: `병목현상 ${no}`, objective: `목표 ${no}`, criteria: `월 기준 ${no}`, html: { objective: "<b>x</b>" } }));
const row = (no: number, judgment: string, actual = `${no}건 처리`, extra: Row = {}) => ({ no, actual, judgment, reason: "", plan: "", evidence: "근거", html: { actual: "<i>색</i>" }, ...extra });
const report = (cycle_id: string, member: string, rows: Row[], team = "C") => ({ cycle_id, team, member, header: { leader: "", author: member, goals: [1, 2, 3].map((no) => ({ no, criteria: `쪼갠 ${no}` })) }, rows, updated_at: "2026-10-28T00:00:00Z" });
const tables: Record<string, Row[]> = {
  okr_cycles: [
    { id: "2026-Q4", kind: "quarter", year: 2026, month: 10, goals, feedback: {} },
    { id: "2026-10", kind: "month", year: 2026, month: 10, goals, goals_origin: "leader", feedback: { 2: { memo: "2번은 숫자로", memoHtml: "<p>x</p>", judgment: "미흡" } } },
  ],
  okr_reports: [
    report("2026-10-W1", "이민구", [row(1, "완료"), row(2, "미흡", "3건 (30%)", { reason: "인력" }), row(3, "완료")]),
    report("2026-10-W2", "이민구", [row(1, "완료"), row(2, "부분달성", "8건 (80%)", { reason: "r" }), row(3, "완료")]),
    report("2026-10-W3", "이민구", [row(1, "완료"), row(2, "완료", "10건 (100%)"), row(3, "완료")]),
    report("2026-10-W4", "이민구", [row(1, "완료"), row(2, "완료", "10건 (100%)"), row(3, "", "진행 중")]),
    report("2026-10-W1", "지경민", [row(1, "미착수", "0건", { reason: "휴가" })]),
  ],
  cs_members: [{ name: "이민구", team: "C", title: "" }, { name: "지경민", team: "C", title: "" }, { name: "팀장님", team: "C", title: "팀장" }, { name: "홍길동", team: "A", title: "" }],
};
const tableOf = (path: string) => path.split("?")[0];
function fakeCtx(data: Record<string, Row[]>, asker = { name: "이민구", team: "C", dept: "CS", title: "" }): AskToolCtx {
  return {
    rest: {
      async get<T>(path: string) { return (data[tableOf(path)] || []) as T[]; },
      async getAll<T>(table: string) { return { rows: (data[table] || []) as T[], truncated: false }; },
      async count(table: string) { return (data[table] || []).length; },
      async rpc<T>(name: string) { return (data[`rpc:${name}`] || []) as T; },
      async edge<T>(fn: string) { return (data[`edge:${fn}`]?.[0] || {}) as T; },
    },
    mask: askMask, today: "2026-10-29", asker, mode: "analysis",
  };
}

describe("okr_member_report", () => {
  it("이민구 10월 — W4 목표 3 판정 빈칸을 짚고, 달성률은 K19 규칙(11/12)", async () => {
    const r = await okrMemberReport({ person: "이민구", period: "2026-10" }, fakeCtx(tables)) as unknown as MemberAnalysis & { error?: string };
    expect(r.error).toBeUndefined();
    expect(r.team).toBe("C");
    expect(r.weeks.map((w: { id: string }) => w.id)).toEqual(["2026-10-W1", "2026-10-W2", "2026-10-W3", "2026-10-W4"]);
    expect(r.missingWeeks).toEqual([]);
    expect(r.rate.done).toBe(9); expect(r.rate.judged).toBe(11); expect(r.rate.person).toBe(82);
    // 팀 = 이민구 82%·지경민 0% 평균(팀장 제외) = 41
    expect(r.rate.team).toBe(41);
    const blank = r.checks.items.filter((i: { check: number }) => i.check === 1);
    expect(blank).toEqual([expect.objectContaining({ week: "2026-10-W4", no: 3 })]);
    expect(r.goals.find((g: { no: number }) => g.no === 2).byWeek).toEqual({ "2026-10-W1": "미흡", "2026-10-W2": "부분달성", "2026-10-W3": "완료", "2026-10-W4": "완료" });
    expect(r.goals.find((g: { no: number }) => g.no === 2).leaderFeedback).toBe("2번은 숫자로");
    expect(JSON.stringify(r)).not.toMatch(/<b>|<i>|memoHtml/);
  });

  it("E팀·명단에 없는 사람은 오류로 알린다", async () => {
    const r = await okrMemberReport({ person: "없는사람", period: "2026-10" }, fakeCtx(tables));
    expect(String(r.error)).toContain("OKR 대상");
    expect((await okrTeamReport({ team: "E" }, fakeCtx(tables))).error).toContain("CSS");
  });

  it("rest 실패를 성공처럼 넘기지 않는다", async () => {
    const ctx = fakeCtx(tables);
    ctx.rest.get = async () => { throw new Error("401 permission denied"); };
    expect(String((await okrMemberReport({ person: "이민구" }, ctx)).error)).toContain("401");
  });
});

describe("okr_team_report", () => {
  it("C팀 — 팀원별 몫·미작성 주·목표별 미흡/미착수 팀원", async () => {
    const r = await okrTeamReport({ team: "C팀", period: "2026-10" }, fakeCtx(tables)) as unknown as TeamAnalysis;
    expect(r.members.map((m: { name: string; pct: number }) => [m.name, m.pct])).toEqual([["이민구", 82], ["지경민", 0]]);
    expect(r.members[1].missingWeeks).toEqual(["2026-10-W2", "2026-10-W3", "2026-10-W4"]);
    expect(r.rate.team).toBe(41);
    expect(r.goals.find((g: { no: number }) => g.no === 1).actionMembers).toEqual(["지경민"]);
  });
});

describe("도구 목록", () => {
  it("이름이 겹치지 않고 A 의 기본 도구 이름을 쓰지 않는다", () => {
    const names = ASK_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of ["query_rows", "tally", "vendor_team", "team_members", "app_guide"]) expect(names).not.toContain(n);
    for (const t of ASK_TOOLS) { expect(t.parameters.type).toBe("object"); expect(typeof t.run).toBe("function"); expect(t.label).toBeTruthy(); }
  });

  it("toReport 는 html 을 버린다", () => {
    const r = toReport(report("2026-10-W1", "이민구", [row(1, "완료")]));
    expect(JSON.stringify(r)).not.toContain("html");
    expect(r.goals?.[0].criteria).toBe("쪼갠 1");
  });
});
