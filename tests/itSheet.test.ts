import { describe, expect, it } from "vitest";
import { buildQuiz, parseCsv, rowsFromCsv, searchRows } from "../src/itSheet";

describe("IT 시트 CSV 읽기", () => {
  it("따옴표 안의 쉼표·줄바꿈·겹따옴표를 살린다", () => {
    const csv = 'ID,제목,증상\r\n1,"윈도우 업데이트 후 부팅 오류 (0xc0)","복구 화면 반복\n""자동 복구"" 실패"\r\n2,모니터 꺼짐,\r\n';
    const grid = parseCsv(csv);
    expect(grid[1]).toEqual(["1", "윈도우 업데이트 후 부팅 오류 (0xc0)", '복구 화면 반복\n"자동 복구" 실패']);
    expect(grid[2]).toEqual(["2", "모니터 꺼짐", ""]);
  });
  it("머리글 기준 객체로, 빈 머리글 열은 버리고 빈 줄은 건너뛴다", () => {
    const rows = rowsFromCsv("ID,카테고리,,퀴즈답\n1,CPU,x,교차 테스트\n,,,\n2,메모리,y,재장착\n");
    expect(rows).toEqual([{ ID: "1", 카테고리: "CPU", 퀴즈답: "교차 테스트" }, { ID: "2", 카테고리: "메모리", 퀴즈답: "재장착" }]);
  });
  it("머리글이 없는 탭(교육자료링크)은 주어진 이름으로", () => {
    const rows = rowsFromCsv("PC하드웨어,https://x,퍼스트전산 교육자료 - PC하드웨어,2026-09-05 15:48,45\n", ["분류", "링크", "제목", "갱신", "문항수"]);
    expect(rows[0]).toMatchObject({ 분류: "PC하드웨어", 링크: "https://x", 문항수: "45" });
  });
});

describe("검색", () => {
  const rows = [{ 업체명: "S파마피아", 증상: "부팅 오류 0xc0" }, { 업체명: "현장 미상", 증상: "모니터 간헐적 꺼짐" }];
  it("낱말이 모두 들어 있는 줄만, 대소문자 무시", () => {
    expect(searchRows(rows, "모니터 꺼짐")).toHaveLength(1);
    expect(searchRows(rows, "0XC0")).toHaveLength(1);
    expect(searchRows(rows, "모니터 부팅")).toHaveLength(0);
    expect(searchRows(rows, "  ")).toHaveLength(2);
  });
});

describe("퀴즈 만들기", () => {
  const rows = [
    { ID: "1", 카테고리: "CPU/쿨링", "부품명/항목": "CPU", 퀴즈문제: "CPU 불량 판별은?", 퀴즈답: "교차 테스트", 난이도: "2" },
    { ID: "2", 카테고리: "CPU/쿨링", "부품명/항목": "쿨러", 퀴즈문제: "온도 90도 넘으면?", 퀴즈답: "먼지 제거·서멀 재도포", 난이도: "1" },
    { ID: "3", 카테고리: "메모리", "부품명/항목": "RAM", 퀴즈문제: "비프음 길게?", 퀴즈답: "메모리 재장착", 난이도: "2" },
    { ID: "4", 카테고리: "메모리", "부품명/항목": "RAM", 퀴즈문제: "중복 답", 퀴즈답: "교차 테스트", 난이도: "2" },
    { ID: "5", 카테고리: "저장장치", "부품명/항목": "SSD", 퀴즈문제: "", 퀴즈답: "펌웨어", 난이도: "3" },
  ];
  const rand = () => 0.42;
  it("문제·답이 있는 줄만, 레벨 필터, 보기엔 정답이 꼭 있고 같은 답은 한 번만", () => {
    const all = buildQuiz(rows, 10, "전체", rand);
    expect(all).toHaveLength(4);
    all.forEach((q) => { expect(q.보기).toContain(q.정답); expect(new Set(q.보기).size).toBe(q.보기.length); expect(q.보기.length).toBeLessThanOrEqual(4); });
    const lv2 = buildQuiz(rows, 10, "2", rand);
    expect(lv2.every((q) => q.난이도 === "2")).toBe(true);
    expect(lv2).toHaveLength(3);
  });
  it("오답은 문제와 낱말이 겹치는 줄(같은 주제)에서 먼저 고른다", () => {
    const pool = [
      { ID: "a", 카테고리: "", "부품명/항목": "공개키", 퀴즈문제: "공개키 암호화 방식에서 암호화에 사용하는 키는?", 퀴즈답: "수신자의 공개키", 난이도: "5" },
      { ID: "b", 카테고리: "", "부품명/항목": "비밀키", 퀴즈문제: "공개키 암호화 방식에서 복호화에 사용하는 키는?", 퀴즈답: "수신자의 개인키", 난이도: "5" },
      { ID: "c", 카테고리: "", "부품명/항목": "대칭키", 퀴즈문제: "대칭키 암호화 방식의 특징은?", 퀴즈답: "암호화·복호화 키가 같다", 난이도: "5" },
      { ID: "d", 카테고리: "", "부품명/항목": "케이블", 퀴즈문제: "랜선 T568B 첫 번째 색은?", 퀴즈답: "흰주황", 난이도: "5" },
      { ID: "e", 카테고리: "", "부품명/항목": "RDP", 퀴즈문제: "원격 데스크톱 기본 포트는?", 퀴즈답: "3389", 난이도: "5" },
      { ID: "f", 카테고리: "", "부품명/항목": "인증서", 퀴즈문제: "공개키 인증서를 발급하는 기관은?", 퀴즈답: "인증기관(CA)", 난이도: "5" },
    ];
    const q = buildQuiz(pool, 6, "전체", () => 0).find((x) => x.id === "a")!;
    expect(q.보기).toContain("수신자의 공개키");
    expect(q.보기).not.toContain("흰주황");
    expect(q.보기).not.toContain("3389");
    expect(q.카테고리).toBe("공개키"); // 카테고리가 비면 부품명/항목으로
  });
  it("문항 수 제한과 필드 매핑", () => {
    const one = buildQuiz(rows, 1, "전체", rand);
    expect(one).toHaveLength(1);
    expect(one[0].부품명).toBeTruthy();
    expect(one[0].문제).toBeTruthy();
  });
});
