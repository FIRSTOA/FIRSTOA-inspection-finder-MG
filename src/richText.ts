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
export function sanitizeRich(root: Node): string {
  const walk = (node: Node, inherited: RichColorKey): string => {
    if (node.nodeType === 3) { // TEXT_NODE
      const t = escapeHtml(node.textContent || "");
      return inherited === "black" || !t ? t : `<span style="color:${RICH_COLORS[inherited]}">${t}</span>`;
    }
    if (node.nodeType !== 1) return ""; // ELEMENT_NODE 외에는 버림
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === "br") return "<br>";
    let color = inherited;
    const cm = (el.getAttribute("style") || "").match(/color\s*:\s*([^;]+)/i);
    if (cm) color = colorKey(cm[1]);
    else if (tag === "font" && el.getAttribute("color")) color = colorKey(el.getAttribute("color") || "");
    const inner = Array.from(el.childNodes).map((c) => walk(c, color)).join("");
    const block = tag === "div" || tag === "p" || tag === "li";
    return block ? `${inner}<br>` : inner;
  };
  return Array.from(root.childNodes).map((c) => walk(c, "black")).join("").replace(/(<br>)+$/g, ""); // 끝의 빈 줄 제거(브라우저가 붙이는 여분 <br>)
}

// html → 평문(줄바꿈 유지)
export function richToText(html: string): string {
  const el = document.createElement("div");
  el.innerHTML = html.replace(/<br\s*\/?>/gi, "\n");
  return (el.textContent || "").split(NBSP).join(" ");
}
