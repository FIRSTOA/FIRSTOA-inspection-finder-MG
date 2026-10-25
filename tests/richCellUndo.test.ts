// OKR 칸 Ctrl+Z 가 엉뚱한 내용을 되돌리던 문제(2026-10-25 사용자 "컨트롤 Z 하면 이상한 게 되돌아감").
// 원인: 편집 중 Ctrl+Z 를 브라우저 기본 되돌리기에 맡겼다 — 그 스택은 문서 하나에 모든 칸·지난 편집 회차가 섞여 있고,
// RichCell 이 innerHTML 로 다시 쓴 것(편집 끝 다시 그리기 등)은 스택에 없어 남은 단계가 옛 글 조각을 되살렸다.
// 수정: 편집 회차마다 이 칸 기록(cellEditHistory)만으로 되돌린다. jsdom 없이 순서로 재현한다.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { editKind, historyKey, openHistory, recordEdit, redoEdit, undoEdit } from "../src/cellEditHistory";

describe("RichCell 편집 중 되돌리기 — 이 칸·이 회차만", () => {
  it("재현 순서: A칸 편집 → B칸 편집 → A칸 다시 편집 후 Ctrl+Z 는 A칸 이번 회차 것만 되돌리고, 그 앞(지난 회차·B칸)으로 넘어가지 않는다", () => {
    // 1회차 A: '목표' 입력(끝나면 기록은 버린다 — onBlur 에서 histRef = null)
    const a1 = openHistory("");
    recordEdit(a1, "목표", "type", 0);
    // B칸 회차는 별도 기록
    const b = openHistory("");
    recordEdit(b, "다른 칸 글", "type", 5000);
    // 2회차 A: 저장된 '목표' 에서 시작, ' 수정' 덧붙임
    const a2 = openHistory("목표");
    recordEdit(a2, "목표 수정", "type", 10000);
    expect(undoEdit(a2)).toBe("목표"); // 방금 친 글만 빠진다
    expect(undoEdit(a2)).toBeNull(); // 더 되돌릴 게 없다 — 예전엔 브라우저 스택이 B칸·1회차 단계를 꺼내 옛 글이 붙었다
    expect(a2.cur).toBe("목표");
  });
  it("이어 친 글자는 한 단계, 종류가 바뀌거나 1초 넘게 쉬면 새 단계", () => {
    const h = openHistory("가");
    recordEdit(h, "가나", "type", 0);
    recordEdit(h, "가나다", "type", 300);
    recordEdit(h, "가나", "delete", 600);
    recordEdit(h, "가나라", "type", 3000);
    expect(undoEdit(h)).toBe("가나");
    expect(undoEdit(h)).toBe("가나다");
    expect(undoEdit(h)).toBe("가");
    expect(undoEdit(h)).toBeNull();
    expect(redoEdit(h)).toBe("가나다");
    expect(redoEdit(h)).toBe("가나");
  });
  it("덮어쓰기 시작(선택 상태에서 바로 타이핑)도 Ctrl+Z 한 번이면 원래 글로", () => {
    const h = openHistory("원래 글"); // 비우기 전 내용으로 연다
    recordEdit(h, "x", "type", 0);
    expect(undoEdit(h)).toBe("원래 글");
  });
  it("같은 값(blur 때 다시 내보내기 등)은 단계를 만들지 않고, 되돌린 뒤 새로 치면 다시하기는 사라진다", () => {
    const h = openHistory("a");
    recordEdit(h, "ab", "type", 0);
    recordEdit(h, "ab", "other", 10);
    expect(h.past).toEqual(["a"]);
    undoEdit(h);
    recordEdit(h, "ac", "type", 20);
    expect(redoEdit(h)).toBeNull();
  });
  it("키 판정: Ctrl+Z 되돌리기, Ctrl+Shift+Z·Ctrl+Y 다시하기, 한글 입력 상태(key 가 ㅋ)도 code 로", () => {
    const k = (key: string, o: Partial<{ code: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => historyKey({ key, ctrlKey: true, metaKey: false, shiftKey: false, ...o });
    expect(k("z")).toBe("undo");
    expect(k("Z", { shiftKey: true })).toBe("redo");
    expect(k("y")).toBe("redo");
    expect(k("ㅋ", { code: "KeyZ" })).toBe("undo");
    expect(k("z", { ctrlKey: false })).toBeNull();
    expect(k("z", { altKey: true })).toBeNull();
    expect(editKind("insertText")).toBe("type");
    expect(editKind("deleteContentBackward")).toBe("delete");
    expect(editKind("formatFontColor")).toBe("other");
  });
  it("RichCell 이 편집 중 Ctrl+Z 와 메뉴 되돌리기(historyUndo)를 브라우저에 넘기지 않고, 회차가 끝나면 기록을 버린다", () => {
    const src = readFileSync(resolve(__dirname, "../src/RichCell.tsx"), "utf8");
    expect(src).toMatch(/const hk = historyKey\(e\);\s*\n\s*if \(hk\) \{ e\.preventDefault\(\); stepHistory\(hk\)/);
    expect(src).toMatch(/ev\.inputType !== "historyUndo"/);
    expect(src).toMatch(/onBlur=\{\(\) => \{ emit\(\); histRef\.current = null;/);
    expect(src).toMatch(/histRef\.current = openHistory\(sanitizeRich\(el\)\);\s*[^\n]*\n\s*if \(replace\) el\.innerHTML = "";/);
  });
});
