/** selectAllRowsFast 동시 수 램프(2→4→최대) — 행 수·순서가 이전(고정 동시 수)과 같아야 한다 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { selectAllRowsFast } from "../src/supabase";

afterEach(() => vi.unstubAllGlobals());

function stub(total: number) {
  const calls: number[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const offset = Number(/offset=(\d+)/.exec(url)![1]);
    const limit = Number(/limit=(\d+)/.exec(url)![1]);
    calls.push(offset);
    const rows = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => ({ id: offset + i }));
    return { ok: true, status: 200, json: async () => rows, text: async () => "" };
  }));
  return calls;
}

describe("selectAllRowsFast 램프", () => {
  for (const total of [0, 999, 1000, 1001, 1999, 2000, 2001, 4014, 6000, 8000, 13000]) {
    it(`${total}행 → 모두, 순서대로, 중복 없이`, async () => {
      stub(total);
      const rows = await selectAllRowsFast<{ id: number }>("t", "select=*", 1000, 6);
      expect(rows.length).toBe(total);
      expect(rows.every((r, i) => r.id === i)).toBe(true);
    });
  }
  it("2000행 표는 요청 3번(0·1000·2000)", async () => {
    const calls = stub(2000);
    await selectAllRowsFast("t", "select=*", 1000, 6);
    expect(calls).toEqual([0, 1000, 2000]);
  });
});
