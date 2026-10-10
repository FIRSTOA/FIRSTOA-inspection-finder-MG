import { describe, expect, it } from "vitest";
import { captionFromRest, extractSvg, mobilePhonesIn } from "../src/answerSvg";

const ANSWER = `가능합니다. 아래 내용은 **고객에게 바로 보낼 수 있는 방문안내 이미지용 SVG**입니다.

\`\`\`svg
<svg width="1080" height="1350" viewBox="0 0 1080 1350" xmlns="http://www.w3.org/2000/svg">
  <rect width="1080" height="1350" fill="#F3F7FF"/>
  <text x="130" y="225" font-size="58">방문 안내 리포트</text>
</svg>
\`\`\`

발송 문구는 이렇게 붙이면 됩니다.

**안녕하세요, 법률사무소 석상 담당자님. 퍼스트전산입니다.
내일 복합기 점검 방문 예정으로 안내드립니다. 감사합니다.**`;

describe("에이전트 답 속 SVG → 그림 (2026-10-10 석상 방문 안내)", () => {
  it("코드 울타리 안의 SVG 를 꺼내고, 크기를 읽고, 나머지 글에서 코드는 [이미지]로 바꾼다", () => {
    const out = extractSvg(ANSWER);
    expect(out).not.toBeNull();
    expect(out!.width).toBe(1080); expect(out!.height).toBe(1350);
    expect(out!.svg.startsWith("<svg")).toBe(true); expect(out!.svg.endsWith("</svg>")).toBe(true);
    expect(out!.rest).toContain("[이미지]");
    expect(out!.rest).not.toContain("<svg");
    expect(out!.rest).not.toContain("**");
  });
  it("발송 문구는 마지막 문단에서, 휴대전화는 키맨 글에서", () => {
    const out = extractSvg(ANSWER)!;
    expect(captionFromRest(out.rest)).toContain("안녕하세요, 법률사무소 석상 담당자님");
    expect(mobilePhonesIn("010-8742-9124 윤지환 대표님(총괄)", "02-123-4567", "01012345678")).toEqual(["01087429124", "01012345678"]);
  });
  it("SVG 가 없으면 null, xmlns 가 없으면 붙여 준다, viewBox 만 있으면 거기서 크기", () => {
    expect(extractSvg("그냥 글")).toBeNull();
    const out = extractSvg('<svg viewBox="0 0 1080 1080"><rect/></svg>')!;
    expect(out.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out.width).toBe(1080); expect(out.height).toBe(1080);
  });
});
