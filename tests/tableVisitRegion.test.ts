import { describe, expect, it } from "vitest";
import { tableVisitRegion } from "../src/region";

// 2026-10-21 지앤아이: 서비스접수 E팀(CSS) 건은 접수 리포트의 방문담당자 칸이 "지방"으로 온다.
// 미양식 변환이 A~E 글자만 찾아서 "지방"을 못 읽고 기본 C로 채워 강남C 방으로 오발송됐다.
const report = (visit: string) => [
  "A/S\tNN\tSL-X3220NR\t25NN(주) 테스트-매월마감\t매월마감\t종료일\t27. 4. 25\t지역\t지방\t접수일\t10. 21",
  "작성자\t홍길동",
  "기번\t0A6XBJMT90000AA\t자산번호\t미부착",
  "접수자연락처\t010-0000-0000",
  `방문담당자\t${visit}`,
  "주소\t충남 아산시 배방읍 장재리 1번지, 1층\t확장성\t/",
].join("\n");

describe("tableVisitRegion (접수 리포트 방문담당자 → 지역)", () => {
  it("지방(E팀·CSS) → E — C로 떨어지면 안 된다", () => {
    expect(tableVisitRegion(report("지방"))).toBe("E");
  });
  it("수도권A~E 는 예전처럼 그 글자", () => {
    expect(tableVisitRegion(report("수도권A"))).toBe("A");
    expect(tableVisitRegion(report("수도권C"))).toBe("C");
    expect(tableVisitRegion(report("수도권E"))).toBe("E");
  });
  it("칸이 비었거나 못 읽으면 빈칸 — 기본값은 호출부가 정한다", () => {
    expect(tableVisitRegion(report(""))).toBe("");
    expect(tableVisitRegion("A/S\tV\t모델\n기번\tXYZ")).toBe("");
  });
});
