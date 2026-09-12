import { describe, expect, it } from "vitest";
import { maxUpdatedAt, mergePlaces, staleIdsFromStamps, updatedAtKey, updatedAtMs } from "../src/placesSync";

/**
 * 워킨맵 공용 목록 증분 폴링(2026-09) — 4,500행(≈5MB)을 30초마다 통째로 받던 것을
 * updated_at 이후 행만 받아 id로 병합한다. 병합 규칙이 어긋나면 방금 저장한 라벨이 옛 값으로
 * 되살아나거나(낙관적 수정 덮어쓰기), 저장 전 새 행이 정기 대조에서 지워진다.
 */

type Row = { id: number; label: string; updatedAt?: string };
const row = (id: number, label: string, updatedAt?: string): Row => ({ id, label, updatedAt });

describe("updatedAtMs / maxUpdatedAt", () => {
  it("PostgREST 형식(+00:00, 밀리초·마이크로초 혼재)을 같은 축으로 읽는다", () => {
    expect(updatedAtMs("2026-09-11T09:32:50.502+00:00")).toBe(Date.parse("2026-09-11T09:32:50.502Z"));
    // Date.parse는 µs를 버린다 — 비교 키는 자릿수를 살린다
    expect(updatedAtMs("2026-09-11T09:32:50.502123+00:00")).toBe(updatedAtMs("2026-09-11T09:32:50.502+00:00"));
    expect(updatedAtKey("2026-09-11T09:32:50.502123+00:00")).toBeGreaterThan(updatedAtKey("2026-09-11T09:32:50.502+00:00"));
    expect(updatedAtKey("2026-09-11T09:32:50.5+00:00")).toBe(updatedAtKey("2026-09-11T09:32:50.500+00:00"));
    expect(updatedAtKey("2026-09-11T09:32:50+00:00")).toBeLessThan(updatedAtKey("2026-09-11T09:32:50.000001+00:00"));
    expect(updatedAtMs(undefined)).toBe(0);
    expect(updatedAtMs("not a date")).toBe(0);
    expect(updatedAtKey(undefined)).toBe(0);
  });

  it("가장 늦은 updated_at을 고르되 seed보다 옛것이면 seed를 유지한다(서버 값 기준, Date.now() 아님)", () => {
    const rows = [{ updated_at: "2026-09-10T00:00:00+00:00" }, { updated_at: "2026-09-11T09:32:50.502+00:00" }, {}];
    expect(maxUpdatedAt(rows)).toBe("2026-09-11T09:32:50.502+00:00");
    expect(maxUpdatedAt(rows, "2026-09-12T00:00:00+00:00")).toBe("2026-09-12T00:00:00+00:00");
    expect(maxUpdatedAt([])).toBe("");
  });
});

describe("mergePlaces — 증분 병합", () => {
  const T1 = "2026-09-11T09:00:00+00:00";
  const T2 = "2026-09-11T09:30:00+00:00";

  it("바뀐 게 없으면 같은 배열을 돌려 리렌더를 피한다", () => {
    const current = [row(1, "G1", T1), row(2, "G2", T1)];
    expect(mergePlaces(current, [], null)).toBe(current);
    expect(mergePlaces(current, [row(1, "G1", T1)], null)).toBe(current); // 같은 stamp = 덮어쓰지 않음
  });

  it("더 새로운 stamp의 원격 행만 덮어쓴다", () => {
    const current = [row(1, "G1", T1), row(2, "G2", T1)];
    const next = mergePlaces(current, [row(1, "G5", T2)], null);
    expect(next).not.toBe(current);
    expect(next.map((p) => p.label)).toEqual(["G5", "G2"]);
  });

  it("낙관적 수정(옛 stamp를 든 로컬 행)은 그보다 옛 원격 행으로 되살아나지 않는다", () => {
    // 로컬에서 G1→G5로 바꿨고 저장은 아직 진행 중(로컬 stamp는 예전 T2 그대로). 폴링이 T1짜리 옛 행을 들고 와도 무시.
    const current = [row(1, "G5", T2)];
    expect(mergePlaces(current, [row(1, "G1", T1)], null)).toBe(current);
  });

  it("stamp가 없는 로컬 행(저장 응답 전 새 행)은 원격 행이 오면 그대로 받는다", () => {
    const current = [row(9, "G1")];
    expect(mergePlaces(current, [row(9, "G1", T2)], null)[0].updatedAt).toBe(T2);
  });

  it("새 행은 덧붙이고 전량 조회와 같은 id 오름차순으로 맞춘다", () => {
    const current = [row(1, "G1", T1), row(3, "G3", T1)];
    const next = mergePlaces(current, [row(2, "G2", T2)], null);
    expect(next.map((p) => p.id)).toEqual([1, 2, 3]);
  });

  it("정기 대조(liveIds)에서 원격에 없는 행은 지우되, stamp 없는 새 행은 남긴다", () => {
    const current = [row(1, "G1", T1), row(2, "G2", T1), row(3, "G3")];
    const next = mergePlaces(current, [], new Set([1]));
    expect(next.map((p) => p.id)).toEqual([1, 3]);
  });

  it("정기 대조 때 incoming에 있어도 liveIds에 없는 행은 넣지 않는다(대조와 증분 사이에 지워진 행)", () => {
    const current = [row(1, "G1", T1)];
    const next = mergePlaces(current, [row(2, "G2", T2)], new Set([1]));
    expect(next).toBe(current);
  });

  it("전량 대조에서 아무것도 안 바뀌면 같은 배열", () => {
    const current = [row(1, "G1", T1), row(2, "G2", T1)];
    expect(mergePlaces(current, [], new Set([1, 2]))).toBe(current);
  });
});

describe("staleIdsFromStamps — 정기 대조에서 다시 받을 행", () => {
  it("서버 stamp가 로컬과 다른 행만, 이번 증분에 이미 든 행은 빼고 고른다", () => {
    const stamps = [
      { id: 1, updated_at: "A" }, // 같음 → 제외
      { id: 2, updated_at: "B2" }, // 다름 → 포함(시계 늦은 기기의 저장 등)
      { id: 3, updated_at: "C" }, // 로컬에 없음(새 행) → 포함
      { id: 4, updated_at: "D2" }, // 다르지만 이번 증분에 이미 있음 → 제외
    ];
    const local = [{ id: 1, updatedAt: "A" }, { id: 2, updatedAt: "B" }, { id: 4, updatedAt: "D" }];
    expect(staleIdsFromStamps(stamps, local, [4])).toEqual([2, 3]);
  });
});
