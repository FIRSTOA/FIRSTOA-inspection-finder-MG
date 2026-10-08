import { describe, expect, it } from "vitest";
import { sanitizeRich, textToHtml } from "../src/richText";

// contentEditable 이 만드는 DOM 을 흉내 낸 가짜 노드(브라우저 없이 돌리기 위해)
type FakeNode = { nodeType: number; textContent?: string; tagName?: string; childNodes: FakeNode[]; getAttribute: (k: string) => string | null };
const text = (t: string): FakeNode => ({ nodeType: 3, textContent: t, childNodes: [], getAttribute: () => null });
const el = (tag: string, children: FakeNode[], attrs: Record<string, string> = {}): FakeNode => ({ nodeType: 1, tagName: tag.toUpperCase(), childNodes: children, getAttribute: (k) => attrs[k] ?? null });
const root = (...children: FakeNode[]) => el("div", children) as unknown as Node;

describe("sanitizeRich — 줄바꿈 보존 (2026-10-08 OKR 칸 줄바꿈 유실)", () => {
  it("첫 줄은 맨바닥 글, 다음 줄은 <div> — 사이에 줄바꿈이 들어간다", () => {
    expect(sanitizeRich(root(text("첫 줄"), el("div", [text("둘째 줄")]), el("div", [text("셋째 줄")])))).toBe("첫 줄<br>둘째 줄<br>셋째 줄");
  });
  it("전부 <div> 인 경우도 같은 결과", () => {
    expect(sanitizeRich(root(el("div", [text("a")]), el("div", [text("b")])))).toBe("a<br>b");
  });
  it("빈 줄(<div><br></div>)은 빈 줄로 남고, 끝의 여분 <br> 은 지운다", () => {
    expect(sanitizeRich(root(text("a"), el("div", [el("br", [])]), el("div", [text("b")]), el("div", [el("br", [])])))).toBe("a<br><br>b");
  });
  it("<br> 로 줄을 나눈 경우(파이어폭스)도 그대로", () => {
    expect(sanitizeRich(root(text("a"), el("br", []), text("b")))).toBe("a<br>b");
  });
  it("색 span 은 유지되고 그 밖의 태그는 벗긴다", () => {
    expect(sanitizeRich(root(el("span", [text("빨강")], { style: "color: rgb(220, 38, 38)" }), el("div", [el("b", [text("굵게")])]))))
      .toBe('<span style="color:#dc2626">빨강</span><br>굵게');
  });
  it("textToHtml 은 줄바꿈을 <br> 로", () => { expect(textToHtml("a\nb")).toBe("a<br>b"); });
});
