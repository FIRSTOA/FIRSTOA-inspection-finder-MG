import { describe, expect, it } from "vitest";
import { isWorkinRowDone, matchToken, matchVendor, modelTokens, pickRowsForDevices, sameWorkinVendor, type WorkinPickRow } from "../src/workinAutoComplete";

/**
 * 2026-10-31 사용자 결정: 점검 양식을 보내면 워킨맵 자동 완료는 양식의 기기 수만큼만 칠한다.
 * 실측: 범건축 9행인데 "후보 N곳 · 자동 반영 제외"로 막혀 1행만 G5 됐다.
 */
const row = (id: number, label: string, name: string, comment = "", extra: Partial<WorkinPickRow> = {}): WorkinPickRow => ({
  id, quarter: 4, kind: "quarter", label, name, comment, memos: [], ...extra,
});

// 범건축 9행 — comment 에 모델/기번이 있는 행, 없는 행이 섞여 있다
const beom = (labels: string[] = Array(9).fill("G1")): WorkinPickRow[] => [
  row(101, labels[0], "31S범건축 1층 총무", "D470/809150710260"),
  row(102, labels[1], "31S범건축 2층 설계1팀", ""),
  row(103, labels[2], "31S범건축 3층 설계2팀", "D450/AB12345678"),
  row(104, labels[3], "31S범건축 4층 구조팀", ""),
  row(105, labels[4], "31S범건축 5층 대표실", ""),
  row(106, labels[5], "31S범건축 6층 회의실", ""),
  row(107, labels[6], "31S범건축 7층 전기팀", ""),
  row(108, labels[7], "31S범건축 8층 기계팀", ""),
  row(109, labels[8], "31S범건축 9층 자료실", ""),
];
const others: WorkinPickRow[] = [
  row(50, "G1", "12N다른회사 본관", "X7500/ZZ99999999"),
  row(201, "G1", "31S범건축 1층 총무", "", { quarter: 1 }),
];
const dev = (index: number, serial = "", asset = "", model = "") => ({ index, serial: matchToken(serial), asset: matchToken(asset), model });
const scope = { kind: "quarter" as const, quarter: 4, vendorKey: matchVendor("범건축"), targetLabel: "G5" };

describe("pickRowsForDevices — 기기 수만큼만", () => {
  it("범건축 9행·양식 4대(2대는 comment 일치, 2대는 불일치) → 4행", () => {
    const rows = [...others, ...beom()];
    // 순서를 섞어도 ① 일치 행을 ②가 먼저 가져가지 않는다
    const result = pickRowsForDevices([dev(0, "NOPE11111"), dev(1, "809150710260"), dev(2), dev(3, "", "AB12345678")], rows, scope);
    expect(result.picks.map((p) => p.row?.id)).toEqual([102, 101, 104, 103]);
    expect(result.picks.map((p) => p.basis)).toEqual(["업체 순번", "시리얼", "업체 순번", "자산기번"]);
    expect(result.picks.every((p) => p.state === "pick")).toBe(true);
    expect(result.pickedRows).toBe(4);
    expect(result.vendorRows).toBe(9);
    expect(result.openRows).toBe(9);
  });

  it("1대 → 1행(번호 순 첫 미완료 행)", () => {
    const labels = ["G5", "G1", "G1", "G1", "G1", "G1", "G1", "G1", "G1"];
    const result = pickRowsForDevices([dev(0, "UNKNOWN999")], [...others, ...beom(labels)], scope);
    expect(result.pickedRows).toBe(1);
    expect(result.picks[0].row?.id).toBe(102);
  });

  it("기기 0대 → 1행", () => {
    const result = pickRowsForDevices([], beom(), scope);
    expect(result.picks).toHaveLength(1);
    expect(result.pickedRows).toBe(1);
    expect(result.picks[0].row?.id).toBe(101);
  });

  it("전부 이미 G5 → 0행, 이미 반영", () => {
    const result = pickRowsForDevices([dev(0), dev(1, "809150710260")], beom(Array(9).fill("G5")), scope);
    expect(result.pickedRows).toBe(0);
    expect(result.picks.map((p) => p.state)).toEqual(["done", "done"]);
    expect(result.picks.every((p) => p.row?.label === "G5")).toBe(true);
  });

  it("기기 수 > 남은 미완료 행이면 있는 만큼만", () => {
    const labels = ["G5", "G5", "G5", "G5", "G5", "G5", "G5", "G1", "G1"];
    const result = pickRowsForDevices([dev(0), dev(1), dev(2), dev(3)], beom(labels), scope);
    expect(result.pickedRows).toBe(2);
    expect(result.picks.map((p) => p.state)).toEqual(["pick", "pick", "done", "done"]);
  });

  it("다른 범위(분기·종류)와 다른 업체는 고르지 않는다", () => {
    const result = pickRowsForDevices([dev(0)], others, scope);
    expect(result.picks[0].state).toBe("none");
  });

  it("매월점검은 이번 달 단계 이상이면 완료로 본다", () => {
    const monthly = [
      row(1, "G2", "범건축", "", { kind: "monthly" }),
      row(2, "G1", "범건축", "", { kind: "monthly" }),
    ];
    const result = pickRowsForDevices([dev(0), dev(1)], monthly, { ...scope, kind: "monthly", targetLabel: "G2" });
    expect(result.picks.map((p) => [p.row?.id, p.state])).toEqual([[2, "pick"], [1, "done"]]);
    expect(isWorkinRowDone({ kind: "monthly", label: "G3" }, "G5")).toBe(false);
    expect(isWorkinRowDone({ kind: "quarter", label: "G12" }, "G5")).toBe(true);
  });

  it("①-2 시리얼 불일치면 같은 업체 미완료 행 중 모델명(핵심 토큰) 든 행을 번호 순보다 먼저", () => {
    const rows = beom();
    rows[5] = { ...rows[5], comment: "HP-9010 복도" };
    rows[7] = { ...rows[7], comment: "C2060" };
    const result = pickRowsForDevices([dev(0, "", "", "C2060 (신도)"), dev(1, "", "", "HP 9010"), dev(2, "", "", "HP-9010"), dev(3)], rows, scope);
    expect(result.picks.map((p) => [p.row?.id, p.basis])).toEqual([[108, "모델명"], [106, "모델명"], [101, "업체 순번"], [102, "업체 순번"]]);
    // "HP 9010"(띄어 씀)도 정규화하면 hp9010 — 둘째 HP-9010 은 남은 모델 행이 없어 번호 순
    // 완료 행에 모델이 있어도 고르지 않는다 → 번호 순
    const done = beom(["G5", "G1", "G1", "G1", "G1", "G1", "G1", "G1", "G1"]);
    expect(pickRowsForDevices([dev(0, "", "", "D470")], done, scope).picks[0]).toMatchObject({ basis: "업체 순번" });
    expect(pickRowsForDevices([dev(0, "", "", "D470")], done, scope).picks[0].row?.id).toBe(102);
    expect(modelTokens("Sindoh D450/C2060")).toEqual(expect.arrayContaining(["d450", "c2060"]));
    expect(modelTokens("HP-9010")).toContain("hp9010");
  });

  it("짧은 다른 업체 오매칭 안 됨 — 포함은 접두일 때만", () => {
    expect(sameWorkinVendor("범건축", matchVendor("12N대범건축사사무소 본사"))).toBe(false);
    const rows = [row(1, "G1", "12N대범건축사사무소 본사"), ...beom()];
    expect(pickRowsForDevices([dev(0)], rows, scope).picks[0].row?.id).toBe(101);
    expect(pickRowsForDevices([dev(0)], [rows[0]], scope).picks[0].state).toBe("none");
  });

  it("업체 키 비교 — 3자 이상 접두, 2자는 완전 일치만", () => {
    expect(sameWorkinVendor("범건축", matchVendor("31S범건축 3층"))).toBe(true);
    expect(sameWorkinVendor("삼성", "삼성전자")).toBe(false);
    expect(sameWorkinVendor("삼성", "삼성")).toBe(true);
  });
});
