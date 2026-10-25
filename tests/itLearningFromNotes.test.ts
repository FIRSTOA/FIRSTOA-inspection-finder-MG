import { describe, expect, it } from "vitest";
import { combineItPractice, isItBrand, itLearningRowsFromNotes, learningDateOf, parseLearningLine, parseLearningText } from "../src/learningLines";
import type { WeeklyNoteRow } from "../src/visits";

const note = (author: string, weekStart: string, learning: string): WeeklyNoteRow => ({
  author, weekStart, learning, goals: {}, goalItems: [], bottlenecks: [] as unknown as WeeklyNoteRow["bottlenecks"],
  thisWeekGoal: "", thisWeekResult: "", nextWeekGoal: "", review: "", growth: "", challenge: "", special: "", request: "", praise: "",
} as WeeklyNoteRow);
const RANGE = { from: "2026-10-01", to: "2026-12-31" };

describe("isItBrand — 브랜드 IT 판정", () => {
  it("IT·it·공백·IT로 시작(뒤가 영문·숫자 아님)은 IT", () => {
    for (const b of ["IT", "it", "It", " IT ", "I T", "IT파트", "it 파트", "IT-실습", "IT/네트워크"]) expect(isItBrand(b), b).toBe(true);
  });
  it("다른 브랜드·빈 칸은 IT 아님", () => {
    for (const b of ["ITX", "itx", "ITEM", "IT2", "아이티", "", "캐논", "KIT", "신도IT"]) expect(isItBrand(b), b).toBe(false);
  });
});

describe("parseLearningLine — 탭/공백 파싱(GrowthHub 와 같은 동작)", () => {
  it("탭 구분", () => {
    expect(parseLearningLine("2026-10-21\tIT\t공유기\t포트포워딩 설정\t김선배\t30분")).toEqual({ 날짜: "2026-10-21", 브랜드: "IT", 기종: "공유기", "배운 점": "포트포워딩 설정", 교육자: "김선배", 소요시간: "30분" });
  });
  it("공백 구분 폴백(소요시간 숫자 뒤 교육자)", () => {
    expect(parseLearningLine("2026-10-21 IT 공유기 포트 포워딩 30분 김선배")).toEqual({ 날짜: "2026-10-21", 브랜드: "IT", 기종: "공유기", "배운 점": "포트 포워딩", 소요시간: "30분", 교육자: "김선배" });
  });
  it("parseLearningText 는 첫 줄만", () => {
    expect(parseLearningText("\n2026-10-21\t캐논\tC3530\t급지\n2026-10-22\tIT\tPC\t드라이버").브랜드).toBe("캐논");
  });
});

describe("learningDateOf", () => {
  it("YYYY-MM-DD·./ 구분은 읽고, 연도 없는 날짜는 빈 값", () => {
    expect(learningDateOf("2026-10-21")).toBe("2026-10-21");
    expect(learningDateOf("2026.10.5")).toBe("2026-10-05");
    expect(learningDateOf("2026/1/2(금)")).toBe("2026-01-02");
    expect(learningDateOf("10/21")).toBe(""); // week_start 없으면 못 읽음
    expect(learningDateOf("2026-13-01")).toBe("");
  });
  it("연도 없는 M/D·M.D·M-D·M월 D일 = week_start 연도, 6개월 넘게 뒤면 전년", () => {
    expect(learningDateOf("10/20", "2026-10-19")).toBe("2026-10-20");
    expect(learningDateOf("9/30", "2026-09-28")).toBe("2026-09-30");
    expect(learningDateOf("10/01", "2026-09-28")).toBe("2026-10-01");
    expect(learningDateOf("10.22", "2026-10-19")).toBe("2026-10-22");
    expect(learningDateOf("10-23", "2026-10-19")).toBe("2026-10-23");
    expect(learningDateOf("10월 24일", "2026-10-19")).toBe("2026-10-24");
    expect(learningDateOf("12/30", "2027-01-04")).toBe("2026-12-30");
    expect(learningDateOf("1/2", "2026-12-28")).toBe("2027-01-02");
    expect(learningDateOf("13/40", "2026-10-19")).toBe("");
    expect(learningDateOf("어제", "2026-10-19")).toBe("");
  });
});

describe("itLearningRowsFromNotes", () => {
  it("IT 줄만 세고 다른 브랜드는 뺀다", () => {
    const rows = itLearningRowsFromNotes([note("한왕주", "2026-10-19", [
      "2026-10-20\tIT\t공유기\t포트포워딩\t김선배\t30분",
      "2026-10-21\t캐논\tC3530\t급지 롤러",
      "2026-10-21\tITX\t?\t다른 브랜드",
      "2026-10-22 it파트 PC 드라이버 재설치 20분",
    ].join("\n"))], RANGE);
    expect(rows).toEqual([{ author: "한왕주", date: "2026-10-20" }, { author: "한왕주", date: "2026-10-22" }]);
  });
  it("연도 없는 날짜는 그 주 연도로, 못 읽으면 그 주 week_start", () => {
    expect(itLearningRowsFromNotes([note("신정훈", "2026-10-19", "10/21\tIT\tPC\t윈도 업데이트\n어제\tIT\tPC\t공유 폴더")], RANGE)).toEqual([{ author: "신정훈", date: "2026-10-21" }, { author: "신정훈", date: "2026-10-19" }]);
  });
  it("같은 작성자·같은 날짜·같은 글은 1회, 글이 다르거나 사람이 다르면 따로", () => {
    const rows = itLearningRowsFromNotes([
      note("한왕주", "2026-10-19", "2026-10-20\tIT\tPC\t드라이버\n2026-10-20\tIT\tPC\t 드라이버 \n2026-10-20\tIT\tPC\t프린터 공유"),
      note("한왕주", "2026-10-26", "2026-10-20\tIT\tPC\t드라이버"),
      note("신정훈", "2026-10-19", "2026-10-20\tIT\tPC\t드라이버"),
    ], RANGE);
    expect(rows).toHaveLength(3);
  });
  it("범위 밖·작성자 없음·내용 없는 줄은 뺀다", () => {
    const rows = itLearningRowsFromNotes([
      note("한왕주", "2026-09-28", "2026-09-30\tIT\tPC\t드라이버"),
      note("", "2026-10-19", "2026-10-20\tIT\tPC\t드라이버"),
      note("신정훈", "2026-10-19", "2026-10-20\tIT"),
    ], RANGE);
    expect(rows).toEqual([]);
  });
});

describe("combineItPractice — 두 원본 합산", () => {
  const p = [{ author: "한왕주", date: "2026-10-20" }];
  const n = [{ author: "신정훈", date: "2026-10-21" }];
  it("둘 다 있으면 합", () => expect(combineItPractice(p, n)).toEqual([...p, ...n]));
  it("실습 표 없음(null)이어도 배운 점은 센다", () => expect(combineItPractice(null, n)).toEqual(n));
  it("배운 점 못 읽음이면 실습만", () => expect(combineItPractice(p, null)).toEqual(p));
  it("둘 다 없으면 null(준비 중)", () => expect(combineItPractice(null, null)).toBeNull());
});
