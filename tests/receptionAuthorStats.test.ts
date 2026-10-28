import { describe, expect, it } from "vitest";
import { authorStatParts, authorStats } from "../src/receptionAuthorStats";

const rows = [
  { author: "가", type: "복합기 AS", receipt_date: "2026-10-28" },
  { author: "가", type: "경영지원", receipt_date: "2026-10-28" },
  { author: "가", type: "운영지원", receipt_date: "2026-10-27" },
  { author: "가", type: "영업팀", receipt_date: "2026-10-28" },
  { author: "나", type: "IT", receipt_date: "2026-10-28" },
  { author: "", type: "원격이관", receipt_date: "2026-10-26" },
];

describe("receptionAuthorStats", () => {
  it("경영·운영·영업을 따로 센다", () => {
    const s = Object.fromEntries(authorStats(rows))["가"];
    expect(s).toMatchObject({ total: 4, cs: 1, mgmt: 1, ops: 1, sales: 1, remote: 0 });
  });
  it("0 인 칸은 생략하되 CS 는 남긴다", () => {
    const s = Object.fromEntries(authorStats(rows))["나"];
    expect(authorStatParts(s).map((p) => p.label)).toEqual(["CS", "IT"]);
  });
  it("기간 필터", () => {
    const m = Object.fromEntries(authorStats(rows, { start: "2026-10-28", end: "2026-10-28" }));
    expect(m["가"].total).toBe(3);
    expect(m["미지정"]).toBeUndefined();
  });
  it("합계 = 종류 합", () => {
    for (const [, s] of authorStats(rows)) expect(s.total).toBe(s.cs + s.it + s.remote + s.mgmt + s.ops + s.sales);
  });
});
