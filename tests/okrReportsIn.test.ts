import { describe, expect, it, vi } from "vitest";

const calls: string[] = [];
vi.mock("../src/supabase", async (orig) => ({
  ...(await orig<typeof import("../src/supabase")>()),
  selectAllRows: vi.fn(async (_t: string, q: string) => { calls.push(q); return [{ cycle_id: "2026-10-W4", team: "A", member: "홍", rows: [{ no: 1, judgment: "달성", actual: "3" }] }]; }),
}));

import { getOkrReportsIn } from "../src/okr";

describe("getOkrReportsIn 슬림 조회", () => {
  it("header 칸을 빼고 읽어도 판정·실적 행은 그대로 돌려준다", async () => {
    const out = await getOkrReportsIn(["2026-10-W4", "2026-10-W4"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toContain("select=*");
    expect(calls[0]).not.toContain("header");
    expect(calls[0]).toContain("rows");
    expect(out[0].rows[0]).toMatchObject({ no: 1, judgment: "달성", actual: "3" });
    expect(out[0].header.leader).toBe("");
    expect(await getOkrReportsIn([])).toEqual([]);
  });
});
