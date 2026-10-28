import { describe, expect, it } from "vitest";
import { sheetListBucket, sheetListCanAct, sheetListCountNote, sheetListLabel, sheetListLine2, sheetListTime } from "../src/sheetListRowState";

describe("sheetListRowState — 접수리스트 시트 줄", () => {
  it("상태 칩 칸: open 접수(진행중 글자면 진행중)·hold 진행중·done/record 완료", () => {
    expect(sheetListBucket("open", "")).toBe("접수");
    expect(sheetListBucket("open", "진행 중")).toBe("진행중");
    expect(sheetListBucket("hold", "보류")).toBe("진행중");
    expect(sheetListBucket("done", "처리완료")).toBe("완료");
    expect(sheetListBucket("record", "")).toBe("완료");
  });
  it("보이는 글자: 보류는 '보류', CS 시트 줄은 '기록'", () => {
    expect(sheetListLabel("hold", "보류")).toBe("보류");
    expect(sheetListLabel("record", "익일 10/20")).toBe("기록");
    expect(sheetListLabel("open", "처리중")).toBe("진행중");
    expect(sheetListLabel("done", "완료")).toBe("완료");
  });
  it("처리 단추: 열린 영업·경영·원격 줄만, 완료·CS·순번 빈 줄은 없음", () => {
    expect(sheetListCanAct({ cls: "open", source: "sales", seq: "12" })).toBe(true);
    expect(sheetListCanAct({ cls: "hold", source: "remote", seq: "3" })).toBe(true);
    expect(sheetListCanAct({ cls: "done", source: "mgmt", seq: "5" })).toBe(false);
    expect(sheetListCanAct({ cls: "record", source: "copier", seq: "1" })).toBe(false);
    expect(sheetListCanAct({ cls: "open", source: "copier", seq: "1" })).toBe(false);
    expect(sheetListCanAct({ cls: "open", source: "sales", seq: " " })).toBe(false);
  });
  it("시각·둘째 줄·숫자 안내", () => {
    expect(sheetListTime("9:06")).toBe("09:06");
    expect(sheetListTime("")).toBe("--:--");
    expect(sheetListTime(undefined)).toBe("--:--");
    expect(sheetListLine2("토너 교체", "검정 토너\n부족")).toBe("토너 교체 — 검정 토너 부족");
    expect(sheetListLine2("", "가".repeat(50))).toBe(`${"가".repeat(40)}…`);
    expect(sheetListCountNote(3, 5)).toBe("(앱 3 · 시트 5)");
    expect(sheetListCountNote(3, 0)).toBe("");
  });
  it("보류 줄은 상태 칩 '진행중' 칸에 세되 글자는 '보류'(같은 줄 두 함수 일치)", () => {
    expect([sheetListBucket("hold", "보류"), sheetListLabel("hold", "보류")]).toEqual(["진행중", "보류"]);
  });
});
