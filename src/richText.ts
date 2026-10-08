// 글자색 셀(RichCell)의 평문 ↔ html 변환 (2026-09-24)
// 허용하는 것은 <br>과 color 스타일의 <span>(빨강·파랑)뿐. 붙여 넣은 서식·태그는 전부 벗긴다.
export const RICH_COLORS = { black: "#0f172a", red: "#dc2626", blue: "#2563eb" } as const;
export type RichColorKey = keyof typeof RICH_COLORS;

const NBSP = String.fromCharCode(160);
export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const textToHtml = (text: string) => escapeHtml(text).replace(/\r?\n/g, "<br>");

// rgb()/hex 색을 빨강·파랑 중 가까운 것으로(그 외는 검정 = 색 없음)
export function colorKey(raw: string): RichColorKey {
  const rgb = raw.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  const hex = raw.match(/#([0-9a-f]{6})/i);
  let r = 0, g = 0, b = 0;
  if (rgb) { r = Number(rgb[1]); g = Number(rgb[2]); b = Number(rgb[3]); }
  else if (hex) { r = parseInt(hex[1].slice(0, 2), 16); g = parseInt(hex[1].slice(2, 4), 16); b = parseInt(hex[1].slice(4, 6), 16); }
  else return "black";
  if (r > 150 && g < 110 && b < 110) return "red";
  if (b > 150 && r < 110) return "blue";
  return "black";
}

// contentEditable 내용 → 허용 태그만 남긴 html
// 브라우저는 Enter 를 누르면 "첫 줄" + <div>둘째 줄</div> 처럼 첫 줄만 맨바닥 글로 두고 다음 줄부터 <div> 로 감싼다.
// 예전엔 <div> 뒤에만 <br> 을 붙여 첫 줄과 둘째 줄 사이 줄바꿈이 사라졌다(2026-10-08: "다른 화면 갔다 오면 줄바꿈이 안 돼 있어").
// 이제 덩어리(div·p·li) 앞에 글이 이어져 있으면 <br> 을 넣고, 뒤에도 <br> 을 둔다. 끝의 빈 줄만 지운다.
export function sanitizeRich(root: Node): string {
  const walkChildren = (parent: Node, inherited: RichColorKey): string => {
    let out = "";
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === 3) { // TEXT_NODE
        const t = escapeHtml(node.textContent || "");
        out += inherited === "black" || !t ? t : `<span style="color:${RICH_COLORS[inherited]}">${t}</span>`;
        continue;
      }
      if (node.nodeType !== 1) continue; // ELEMENT_NODE 외에는 버림
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (tag === "br") { out += "<br>"; continue; }
      let color = inherited;
      const cm = (el.getAttribute("style") || "").match(/color\s*:\s*([^;]+)/i);
      if (cm) color = colorKey(cm[1]);
      else if (tag === "font" && el.getAttribute("color")) color = colorKey(el.getAttribute("color") || "");
      const inner = walkChildren(el, color);
      const block = tag === "div" || tag === "p" || tag === "li";
      if (block) {
        if (out && !out.endsWith("<br>")) out += "<br>";
        out += inner.replace(/(<br>)+$/g, "") + "<br>";
      } else out += inner;
    }
    return out;
  };
  return walkChildren(root, "black").replace(/(<br>)+$/g, ""); // 끝의 빈 줄 제거(브라우저가 붙이는 여분 <br>)
}

// html → 평문(줄바꿈 유지)
export function richToText(html: string): string {
  const el = document.createElement("div");
  el.innerHTML = html.replace(/<br\s*\/?>/gi, "\n");
  return (el.textContent || "").split(NBSP).join(" ");
}
