import { describe, expect, it } from "vitest";
import { ASK_PACK_MAX_CHARS, fitPacks, type AskPack } from "../src/askPacks";

const big = (kind: string, n: number): AskPack => ({ kind, title: kind, data: { rows: Array.from({ length: n }, (_, i) => ({ i, text: "가나다라마바사".repeat(10) })) } });

describe("askPacks.fitPacks — 크기 상한", () => {
  it("작으면 그대로", () => {
    const r = fitPacks([big("a", 3)]);
    expect(r.trimmed).toEqual([]);
    expect(r.packs[0].data.rows).toHaveLength(3);
  });
  it("크면 상한 안으로 줄이고 표시", () => {
    const r = fitPacks([big("kpi_table", 600), big("kpi_teams", 50)]);
    expect(JSON.stringify(r.packs).length).toBeLessThanOrEqual(ASK_PACK_MAX_CHARS);
    expect(r.trimmed).toContain("kpi_table");
    const t = r.packs.find((p) => p.kind === "kpi_table")!;
    expect(t.data.truncated).toBe(true);
    expect(t.data.rowsTotal).toBe(600);
  });
  it("줄일 행이 없으면 뒤 꾸러미부터 버린다", () => {
    const one = (kind: string): AskPack => ({ kind, title: kind, data: { rows: [{ text: "x".repeat(15_000) }] } });
    const r = fitPacks([one("a"), one("b")]);
    expect(r.packs.map((p) => p.kind)).toEqual(["a"]);
    expect(r.trimmed).toEqual(["b"]);
  });
  it("원본은 건드리지 않는다", () => {
    const src = [big("a", 600)];
    fitPacks(src);
    expect(src[0].data.rows).toHaveLength(600);
  });
  it("엣지 상한(25,000자)보다 작다", () => {
    expect(ASK_PACK_MAX_CHARS).toBeLessThan(25_000);
  });
});

describe("askPacks.packsFromSnapshot", () => {
  it("팀을 주면 그 팀 칸만(전체 칸은 남김)", async () => {
    const { packsFromSnapshot } = await import("../src/askPacks");
    const snap = {
      v: 3, defs: "", savedAt: 0, today: "2026-10-29", todayItems: [], k2: { end: null, early: null }, okr: { week: null, month: null }, unhandled: null, teams: null,
      table: [{ id: "K1", name: "점검", unit: "대", status: "behind", targetLabel: "", basis: "기준", main: true, pace: null, teamBars: [], people: [], cellState: "ready",
        cells: [{ scope: "CS", value: 10, target: 20, status: "behind" }, { scope: "B", value: 2, target: 5, status: "behind" }, { scope: "C", value: 3, target: 5, status: "onTrack" }] }],
    } as unknown as Parameters<typeof packsFromSnapshot>[0];
    const packs = packsFromSnapshot(snap, { teams: ["B"] });
    const row = packs[0].data.rows[0] as { cells: unknown[][] };
    expect(row.cells.map((c) => c[0])).toEqual(["CS", "B"]);
    expect(row.cells[1][3]).toBe("부족");
  });
});
