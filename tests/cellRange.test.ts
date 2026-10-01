import { describe, expect, it } from "vitest";
import { parseTsv, toTsv } from "../src/cellRange";

// 엑셀 ↔ OKR 표 복사·붙여넣기 글 형식(TSV) — 줄바꿈이 든 칸은 "…"로
describe("셀 범위 복사·붙여넣기 — TSV", () => {
  it("탭·줄바꿈으로 잇고, 줄바꿈·탭·따옴표가 든 칸은 따옴표로 감싼다", () => {
    expect(toTsv([["a", "b"], ["c", "d"]])).toBe("a\tb\nc\td");
    expect(toTsv([["두 줄\n글", 'say "hi"']])).toBe('"두 줄\n글"\t"say ""hi"""');
  });
  it("엑셀이 준 글을 되돌린다 — 따옴표 칸 안의 줄바꿈·겹따옴표 포함, 끝 빈 줄 제거, CRLF", () => {
    expect(parseTsv("a\tb\r\nc\td\r\n")).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseTsv('"두 줄\n글"\t"say ""hi"""\n')).toEqual([["두 줄\n글", 'say "hi"']]);
    expect(parseTsv("")).toEqual([]);
    expect(parseTsv("한 칸")).toEqual([["한 칸"]]);
  });
  it("복사한 것을 다시 읽으면 같다(왕복)", () => {
    const rows = [["• 계약서 8건 중 5건", "완료"], ["사유:\n- 인력 부족", ""], ["", "x\ty"]];
    expect(parseTsv(toTsv(rows))).toEqual(rows);
  });
});
