// OKR 칸 지우는 중 커서가 맨 앞으로 튀던 문제(2026-10-25 사용자 "셀 안에 글자 잘못 써서 지우다 보니 자꾸 처음으로 가").
// RichCell 은 칸에 적은 것을 내보내고(emit), 바깥이 돌려준 값(wanted)이 마지막으로 내보낸 값(last)과 다르면 innerHTML 을 다시 쓴다 → 커서가 맨 앞.
// 돌아오는 값은 한 바퀴 돌며 모양이 바뀐다: 병목현상 칸은 bottleneckText 가 trim, 다른 칸도 richToText 가 NBSP 를 공백으로.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { shouldRepaint, textToHtml } from "../src/richText";
import { bottleneckText } from "../src/okr";

// RichCell.emit 이 색 없는 칸에서 내보내는 것과 바깥이 돌려주는 것을 그대로 흉내(richToText 는 DOM 이 필요해 평문은 직접 적는다)
const roundTrip = (typed: string, display: (t: string) => string) => ({ last: textToHtml(typed), wanted: textToHtml(display(typed)) });

describe("RichCell 다시 그리기 — 편집 중 커서 유지", () => {
  it("재현: 병목현상 칸에서 'abc d' 의 d 를 지우면 'abc ' → 돌아온 값 'abc' 가 달라 예전 규칙이면 다시 그렸다", () => {
    const { last, wanted } = roundTrip("abc ", bottleneckText);
    expect(wanted).not.toBe(last); // 돌아온 값이 다르다 = 글자 비교만으로는 내 입력의 메아리인지 모른다
    expect(shouldRepaint(wanted, last, true)).toBe(false); // 편집 중엔 다시 그리지 않는다(커서 유지)
  });
  it("재현: NBSP 가 섞인 칸 — 돌아온 값은 공백이라 달라도 편집 중엔 다시 그리지 않는다", () => {
    const nb = String.fromCharCode(160);
    expect(shouldRepaint("가나 ", `가나${nb}`, true)).toBe(false);
  });
  it("편집이 끝나면 바깥 값과 다를 때만 맞춘다(저장된 모양으로 보이게)", () => {
    const { last, wanted } = roundTrip("abc ", bottleneckText);
    expect(shouldRepaint(wanted, last, false)).toBe(true);
    expect(shouldRepaint("abc", "abc", false)).toBe(false);
    expect(shouldRepaint("abc", null, false)).toBe(true); // 상자가 새로 생긴 경우
  });
  it("RichCell 이 이 규칙을 쓰고, 편집 상태(mode)가 바뀔 때도 다시 따져 본다", () => {
    const src = readFileSync(resolve(__dirname, "../src/RichCell.tsx"), "utf8");
    expect(src).toMatch(/shouldRepaint\(wanted, lastRef\.current, mode === "editing"\)/);
    expect(src).toMatch(/\}, \[wanted, readOnly, mode\]\);/);
  });
});
