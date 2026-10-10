/**
 * 에이전트 답 속 SVG → 진짜 그림 (2026-10-10)
 *
 * 왜: "석상에 내일 방문 안내할 건데 고객용 리포트 이미지로 만들어 줘"라고 묻자 모델이 SVG 코드를 글자로 돌려줬다("이미지로는 불가한가?").
 *     SVG 는 브라우저가 바로 그릴 수 있으니, 답에서 <svg>…</svg> 를 꺼내 <img> 로 그린 뒤 캔버스에 구워 PNG(저장·복사)와
 *     MMS 용 JPG(≤200KB, 솔라피 최대 1500×1440 — InspectionReport 와 같은 규칙)로 만든다.
 * 안전: 모델이 준 SVG 는 innerHTML 로 넣지 않고 <img src=blob:> 으로만 그린다(스크립트·외부 자원이 실행되지 않는다).
 */

export type SvgAnswer = { svg: string; rest: string; width: number; height: number };

/** 답에서 첫 <svg>…</svg> 를 꺼낸다(```svg 코드 울타리 포함). 나머지 글은 rest 로(코드 자리는 "[이미지]") */
export function extractSvg(answer: string): SvgAnswer | null {
  const text = String(answer || "");
  const m = text.match(/<svg[\s>][\s\S]*?<\/svg>/i);
  if (!m) return null;
  let svg = m[0];
  if (!/xmlns=/.test(svg)) svg = svg.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  const num = (name: string) => { const a = svg.match(new RegExp(`<svg[^>]*\\s${name}="([\\d.]+)`, "i")); return a ? Number(a[1]) : 0; };
  let width = num("width"), height = num("height");
  if (!width || !height) {
    const vb = svg.match(/viewBox="\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)/i);
    if (vb) { width = width || Number(vb[1]); height = height || Number(vb[2]); }
  }
  if (!width || !height) { width = width || 1080; height = height || 1350; }
  // 코드 울타리째 지운다 — ```svg … ``` 또는 울타리 없는 날 SVG
  const rest = text
    .replace(/```(?:svg|xml|html)?\s*<svg[\s>][\s\S]*?<\/svg>\s*```/i, "[이미지]")
    .replace(/<svg[\s>][\s\S]*?<\/svg>/i, "[이미지]")
    .replace(/\*\*/g, "")
    .trim();
  return { svg, rest, width, height };
}

/** 답의 나머지 글에서 "발송 문구" 부분 — 마지막 문단(모델이 코드 아래에 붙여 주는 문자 초안). 없으면 전체 */
export function captionFromRest(rest: string): string {
  const parts = String(rest || "").split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p && p !== "[이미지]");
  const last = parts[parts.length - 1] || "";
  return /안녕하세요|감사합니다|드립니다|안내/.test(last) ? last : "";
}

/** SVG 글자 → <img> → 캔버스. 폰트는 기기 것으로(외부 폰트 없음). scale 2 로 선명하게 */
export async function svgToCanvas(svg: string, width: number, height: number, scale = 2): Promise<HTMLCanvasElement> {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("SVG 를 그리지 못했습니다(형식 오류)"));
      el.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("캔버스를 만들 수 없습니다");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally { URL.revokeObjectURL(url); }
}

export const canvasToPng = (canvas: HTMLCanvasElement) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));

/** MMS 용 JPG data URL — ≤200KB, 1500×1440 상자 안(솔라피). 못 줄이면 null */
export async function canvasToMmsJpeg(source: HTMLCanvasElement): Promise<string | null> {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const width = source.width, height = source.height;
  let ratio = Math.min(1, 1500 / width, 1440 / height);
  for (let round = 0; round < 6; round++) {
    const w = Math.max(1, Math.round(width * ratio)), h = Math.max(1, Math.round(height * ratio));
    for (const q of [0.92, 0.86, 0.8, 0.72, 0.64, 0.56]) {
      canvas.width = w; canvas.height = h; ctx.imageSmoothingQuality = "high"; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.drawImage(source, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", q));
      if (blob && blob.size <= 200 * 1024) {
        return await new Promise<string>((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.onerror = () => reject(fr.error); fr.readAsDataURL(blob); });
      }
    }
    ratio *= 0.85;
  }
  return null;
}

export const PHONE_RE = /01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/g;
/** 글(키맨 "010-8742-9124 윤지환 대표님", 전화 칸)에서 휴대전화 번호만 숫자로 */
export function mobilePhonesIn(...texts: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const t of texts) for (const m of String(t || "").match(PHONE_RE) || []) { const d = m.replace(/\D/g, ""); if (!out.includes(d)) out.push(d); }
  return out;
}
