/**
 * 자동 일정 선택 스케줄 보관 규칙 — 2026-10-24 재발 방지.
 * (1) 고른 곳은 고를 때의 팀에 붙는다 — 칩을 바꿔도 원래 팀으로 저장·표시
 * (2) 작성자가 바뀌면 새 작성자 키 목록으로 — 이전 사람 목록이 새 사람 키로 저장되지 않는다
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadPicksFrom, picksAfterRegister, picksFor, picksForAuthor, picksKey, pickTeam, type OwnedPicks } from "../src/autoSchedulePicks";

type P = { date: string; team: string; id: string };
const D = "2026-10-27";

describe("(1) 고른 곳은 고를 때의 팀", () => {
  it("D팀에서 고른 뒤 칩을 C 로 바꾸면 C 목록엔 안 보이고, D 로 돌아오면 그대로 있으며, C 등록이 D 것을 지우지 않는다", () => {
    const saved: P[] = [
      { date: D, team: "D", id: "d1" },
      { date: D, team: "C", id: "c1" },
      { date: "2026-10-28", team: "D", id: "d-next" },
    ];
    expect(picksFor(saved, D, "C").map((x) => x.id)).toEqual(["c1"]);
    expect(picksFor(saved, D, "D").map((x) => x.id)).toEqual(["d1"]);
    // 등록할 때 저장하는 팀 = pick.team (화면 팀이 C 여도 D 로)
    expect(pickTeam(saved[0], "C")).toBe("D");
    expect(picksAfterRegister(saved, D, "C").map((x) => x.id)).toEqual(["d1", "d-next"]);
  });
  it("옛 저장분(팀 빈칸)은 지금 팀 것으로 본다", () => {
    const old: P[] = [{ date: D, team: "", id: "old" }];
    expect(picksFor(old, D, "B").map((x) => x.id)).toEqual(["old"]);
    expect(pickTeam(old[0], "B")).toBe("B");
  });
  it("화면 등록 코드가 화면 팀(team) 대신 고를 때의 팀으로 저장한다", () => {
    const src = readFileSync(new URL("../src/AutoSchedule.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/team: group\.team, date/);
    expect(src).toMatch(/team: pickTeam\(m, regTeam\)/);
    expect(src).not.toMatch(/cur\.filter\(\(x\) => x\.date !== date\)/);
  });
});

describe("(2) 작성자가 바뀌면 새 작성자 목록", () => {
  it("이전 사람 목록을 들고 가지 않고 새 사람 키에서 읽는다, 같은 작성자면 같은 객체", () => {
    const store = new Map<string, string>([
      [picksKey("이민구"), JSON.stringify([{ date: D, team: "C", id: "mine" }])],
      [picksKey("양승원"), JSON.stringify([{ date: D, team: "D", id: "his" }])],
    ]);
    const storage = { getItem: (k: string) => store.get(k) ?? null };
    const load = (a: string) => loadPicksFrom<P>(storage, a);
    const first: OwnedPicks<P> = { owner: "이민구", picks: load("이민구") };
    expect(picksForAuthor(first, "이민구", load)).toBe(first);
    const next = picksForAuthor(first, "양승원", load);
    expect(next.owner).toBe("양승원");
    expect(next.picks.map((x) => x.id)).toEqual(["his"]);
    expect(picksForAuthor(first, "새사람", load)).toEqual({ owner: "새사람", picks: [] });
  });
  it("깨진 저장값은 빈 목록", () => {
    expect(loadPicksFrom<P>({ getItem: () => "{bad" }, "x")).toEqual([]);
    expect(loadPicksFrom<P>(null, "x")).toEqual([]);
  });
  it("화면은 저장을 owner 키로만 한다(현재 author 키로 저장하지 않는다)", () => {
    const src = readFileSync(new URL("../src/AutoSchedule.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/picksKey\(ownedRaw\.owner\)/);
    expect(src).not.toMatch(/picksKey\(author\), JSON\.stringify/);
  });
});
