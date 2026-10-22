/**
 * 일정 담당자 여러 명(쉼표 목록) 공용 함수 — docs/tasks/schedule-multi-assignee.md
 */
import { describe, expect, it } from "vitest";
import { addedAssignees, formatAssignees, hasAssignee, joinAssignees, MAX_ASSIGNEES, parseAssignees, primaryAssignee } from "../src/assignees";

describe("parseAssignees", () => {
  it("1명은 그대로 1개", () => {
    expect(parseAssignees("김정민")).toEqual(["김정민"]);
  });
  it("빈 값·null 은 빈 배열", () => {
    expect(parseAssignees("")).toEqual([]);
    expect(parseAssignees(null)).toEqual([]);
    expect(parseAssignees(undefined)).toEqual([]);
    expect(parseAssignees(" , ")).toEqual([]);
  });
  it("쉼표·전각 쉼표·슬래시·가운뎃점·공백을 모두 구분자로, 순서 유지·중복 제거", () => {
    expect(parseAssignees("김A,이B")).toEqual(["김A", "이B"]);
    expect(parseAssignees(" 김A ， 이B / 박C · 김A ")).toEqual(["김A", "이B", "박C"]);
  });
  it("괄호 든 이름은 깨지지 않는다", () => {
    expect(parseAssignees("김광태(IT),심태현")).toEqual(["김광태(IT)", "심태현"]);
  });
});

describe("joinAssignees", () => {
  it("1명이면 예전 값과 같은 글자", () => {
    expect(joinAssignees(["김정민"])).toBe("김정민");
  });
  it("쉼표·공백 없음·선택 순서·중복 제거", () => {
    expect(joinAssignees(["이B", " 김A ", "이B"])).toBe("이B,김A");
  });
  it("최대 인원을 넘는 뒷사람은 버린다", () => {
    expect(MAX_ASSIGNEES).toBe(3);
    expect(joinAssignees(["a", "b", "c", "d"])).toBe("a,b,c");
    expect(joinAssignees(["a", "b", "c"], 2)).toBe("a,b");
  });
  it("아무도 없으면 빈 문자열(미배정)", () => {
    expect(joinAssignees([])).toBe("");
  });
  it("parse 와 왕복해도 같은 값", () => {
    expect(joinAssignees(parseAssignees("김A,이B,박C"))).toBe("김A,이B,박C");
  });
});

describe("hasAssignee — 정확 일치", () => {
  it("'이수'와 '이수진'이 섞이지 않는다", () => {
    expect(hasAssignee("이수진", "이수")).toBe(false);
    expect(hasAssignee("이수,김A", "이수진")).toBe(false);
    expect(hasAssignee("이수진,김A", "이수진")).toBe(true);
    expect(hasAssignee("김A,이수", "이수")).toBe(true);
  });
  it("1명일 때 예전 === 비교와 같다", () => {
    expect(hasAssignee("김정민", "김정민")).toBe(true);
    expect(hasAssignee("김정민", "심태현")).toBe(false);
  });
  it("빈 이름은 누구와도 일치하지 않는다", () => {
    expect(hasAssignee("", "")).toBe(false);
    expect(hasAssignee("김A", "")).toBe(false);
  });
});

describe("formatAssignees·primaryAssignee", () => {
  it("1명은 그대로, 여러 명은 가운뎃점, short 는 '외 N'", () => {
    expect(formatAssignees("김정민")).toBe("김정민");
    expect(formatAssignees("김정민", { short: true })).toBe("김정민");
    expect(formatAssignees("김A,이B")).toBe("김A·이B");
    expect(formatAssignees("김A,이B,박C", { short: true })).toBe("김A 외 2");
    expect(formatAssignees("")).toBe("");
  });
  it("대표는 첫 사람", () => {
    expect(primaryAssignee("이B,김A")).toBe("이B");
    expect(primaryAssignee("")).toBe("");
  });
});

describe("addedAssignees — 배정 푸시 대상", () => {
  it("1명 → 다른 1명: 새 사람만 (예전 targets:[assignee]와 같다)", () => {
    expect(addedAssignees("김A", "이B")).toEqual(["이B"]);
    expect(addedAssignees("", "김A")).toEqual(["김A"]);
  });
  it("한 명만 추가하면 추가된 사람에게만", () => {
    expect(addedAssignees("김A", "김A,이B")).toEqual(["이B"]);
  });
  it("두 명을 새로 걸면 둘 다", () => {
    expect(addedAssignees("", "김A,이B")).toEqual(["김A", "이B"]);
  });
  it("빼기만 하거나 순서만 바꾸면 아무에게도 안 보낸다", () => {
    expect(addedAssignees("김A,이B", "김A")).toEqual([]);
    expect(addedAssignees("김A,이B", "이B,김A")).toEqual([]);
    expect(addedAssignees("김A", "")).toEqual([]);
  });
});
