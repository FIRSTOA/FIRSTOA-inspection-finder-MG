import { describe, expect, it } from "vitest";
import { bucketDate, dateCondRange, kstDay, pickDateTextRows, planTally, runTally, splitDateFilters, tallyRows } from "../supabase/functions/_shared/ask/tally";
import { CATALOG } from "../supabase/functions/_shared/ask/catalog";
import { makeRest } from "../supabase/functions/_shared/ask/rest";

// 통합검색 tally(T3) — 설계 5-3
describe("tally", () => {
  it("날짜 — 'YYYY-MM-DD 0:00'·ISO(UTC→KST)·묶음", () => {
    expect(kstDay("2026-10-05 0:00")).toBe("2026-10-05");
    expect(kstDay("2026-10-04T16:30:00Z")).toBe("2026-10-05");   // KST 01:30
    expect(kstDay("2026.10.5")).toBe("2026-10-05");
    expect(bucketDate("2026-10-29", "week")).toBe("2026-10-26");   // 목 → 그 주 월요일
    expect(bucketDate("2026-10-26", "week")).toBe("2026-10-26");
    expect(bucketDate("2026-11-01", "week")).toBe("2026-10-26");   // 일요일
    expect(bucketDate("2026-10-29", "month")).toBe("2026-10");
    expect(bucketDate("", "day")).toBe("(빈칸)");
  });

  it("묶음별 건수·업체 중복 제거·명단 팀", () => {
    const rows = [
      { 작성자: "이민구", _업체명: "무암", 작성일: "2026-10-01" },
      { 작성자: "이민구", _업체명: "무암", 작성일: "2026-10-01" },
      { 작성자: "박영현", _업체명: "잡플러스", 작성일: "2026-10-08" },
      { 작성자: "지경민", _업체명: "무암", 작성일: "2026-10-09" },
      { 작성자: "외부인", _업체명: "가나", 작성일: "2026-10-09" },
    ];
    const teams: Record<string, string> = { 이민구: "C", 박영현: "C", 지경민: "B" };
    const teamOf = (n: string) => teams[n] || "";
    const r = tallyRows(rows, { groupBy: ["_author_team"], authorCol: "작성자", teamOf, distinctCol: "_업체명" });
    expect(r.total).toBe(5);
    expect(r.distinct_total).toBe(3);
    expect(r.groups[0]).toEqual({ key: { _author_team: "C" }, count: 3, distinct: 2 });
    expect(r.groups.find((g) => g.key._author_team === "(명단 밖)")?.count).toBe(1);
    const byWeek = tallyRows(rows, { groupBy: [], dateCol: "작성일", bucket: "week" });
    expect(byWeek.groups.map((g) => [g.key["작성일:week"], g.count])).toEqual([["2026-10-05", 3], ["2026-09-28", 2]]);
    const capped = tallyRows(rows, { groupBy: ["_업체명"], maxGroups: 1 });
    expect(capped.groups.length).toBe(1);
    expect(capped.other).toEqual({ groups: 2, count: 2 });
  });

  it("인자 검사 — 없는 표·칸·작성자 칸 없는 표의 _author_team·날짜 없는 표의 묶음", () => {
    expect("error" in planTally({ table: "app_config" })).toBe(true);
    expect("error" in planTally({ table: "jeomgeom", group_by: ["password"] })).toBe(true);
    expect("error" in planTally({ table: "workin_map_places", group_by: ["_author_team"] })).toBe(true);
    expect("error" in planTally({ table: "room_map", date_bucket: "month" })).toBe(true);
    const ok = planTally({ table: "jeomgeom", group_by: ["_author_team"], distinct: true, date_bucket: "month", filters: [{ col: "작성일", op: "gte", value: "2026-10-01" }] });
    expect("error" in ok).toBe(false);
    if (!("error" in ok)) expect([...ok.select].sort()).toEqual(["_업체명", "작성일", "작성자"].sort());
  });

  it("runTally — 페이지 넘겨 읽고 숨김 조건을 붙인다", async () => {
    const urls: string[] = [];
    const fake = async (u: string) => { urls.push(u); return new Response(JSON.stringify([{ 작성자: "이민구" }, { 작성자: "지경민" }]), { status: 200 }); };
    const rest = makeRest("https://x.supabase.co", "anon", { fetchImpl: fake });
    const out = await runTally({ table: "jeomgeom", group_by: ["_author_team"] }, { rest, teamOf: (n) => (n === "이민구" ? "C" : "B") });
    expect(out.total).toBe(2);
    expect(urls[0]).toContain("_hidden=not.is.true");
    expect(urls[0]).toContain("limit=1000&offset=0");
  });
});

describe("글자 날짜 칸(cat.dateText) 날짜 조건 — 2026-10-29 misu 실데이터", () => {
  it("misu 입력일 gte 는 서버로 보내지 않고 읽은 뒤 날짜로 거른다('2026.1.7'·쓰레기 행 제외)", async () => {
    const urls: string[] = [];
    const rows = [{ 입력일: "2026.1.7" }, { 입력일: "2026-10-29 00:00:00" }, { 입력일: "2026.10.08" }, { 입력일: "마장역 역세권 장기전세 재개발추진 준비위원회" }, { 입력일: "2026-09-13 00:00:00" }];
    const fake = async (u: string) => { urls.push(decodeURIComponent(u)); return new Response(JSON.stringify(rows), { status: 200 }); };
    const rest = makeRest("https://x.supabase.co", "anon", { fetchImpl: fake });
    const out = await runTally({ table: "misu", filters: [{ col: "입력일", op: "gte", value: "2026-09-14" }] }, { rest, teamOf: () => "" });
    expect(out.total).toBe(2);
    expect(urls[0]).not.toContain('"입력일"=gte');
    expect(urls[0]).toContain("입력일");   // select 에 날짜 칸
    const plan = planTally({ table: "jeomgeom", filters: [{ col: "작성일", op: "gte", value: "2026-10-01" }] });
    if (!("error" in plan)) expect(plan.dateConds).toEqual([]);   // 깨끗한 칸은 그대로 서버 조건
  });
  it("kstDay 는 섞인 형식도 읽는다", () => {
    expect(kstDay("Fri Mar 20 2026 00:00:00 GMT+0900")).toBe("2026-03-20");
    expect(kstDay("2026. 3. 10.")).toBe("2026-03-10");
  });
});

describe("query_rows 글자 날짜 칸 고르기(data-ask queryRows) — 2026-10-29", () => {
  const rows = [
    { id: 1, 입력일: "2026-10-29 00:00:00", _업체명: "가" },
    { id: 2, 입력일: "마장역 역세권 장기전세 재개발추진 준비위원회", _업체명: "쓰레기" },
    { id: 3, 입력일: "2026.9.8", _업체명: "나" },
    { id: 4, 입력일: "Fri Mar 20 2026 00:00:00 GMT+0900", _업체명: "다" },
    { id: 5, 입력일: "2026-10-29 00:00:00", _업체명: "라" },
    { id: 6, 입력일: "2026.1.7", _업체명: "마" },
  ];
  it("기본(최근순) — 쓰레기 행·JS 글·점 표기가 맨 앞에 오지 않고 날짜순, 못 읽는 행은 맨 뒤, 같은 날은 나중 id 먼저", () => {
    const p = pickDateTextRows(rows, "입력일", [], "desc", 10);
    expect(p.rows.map((r) => r.id)).toEqual([5, 1, 3, 4, 6, 2]);
    expect(pickDateTextRows(rows, "입력일", [], "asc", 2).rows.map((r) => r.id)).toEqual([6, 4]);
  });
  it("모델 날짜 조건은 서버로 안 보내고 읽은 뒤 거른다('2026.1.7' 새지 않음)", () => {
    const { rest, dateConds } = splitDateFilters(CATALOG.misu, [{ col: "입력일", op: "gte", value: "2026-09-14" }, { col: "_업체명", op: "eq", value: "가" }]);
    expect(rest).toHaveLength(1);
    expect(dateCondRange(dateConds)).toEqual({ from: "2026-09-14", to: "9999-12-31" });
    const p = pickDateTextRows(rows, "입력일", dateConds, "desc", 2);
    expect([p.rows.map((r) => r.id), p.total]).toEqual([[5, 1], 2]);
  });
});
