/**
 * 사진 보기 창 — 확대(휠·핀치·＋－·더블클릭), 90° 회전, 끌어서 이동, 좌우 넘기기, "선명하게"(보기용 보정) (2026-10-13)
 *
 * 왜: 접수 사진이 작게만 보여 판단이 안 됐다(240×320 같은 캡처본). 원본 파일은 건드리지 않고 화면에서만 키우고 또렷하게 한다.
 *     "선명하게"는 작은 사진을 2~3배로 늘린 뒤 언샤프 마스크를 한 번 거친 것 — 글자·선이 조금 더 읽힌다. 저장·링크는 늘 원본.
 * 쓰는 곳: 앨범(AlbumView), 일정리스트·서비스접수의 증상 사진, 카톡 링크(?photo=).
 * 그리기(2026-10-14): 동그라미·네모·펜·화살표, 색, 되돌리기·지우기, [표시째 저장](원본 + 표시를 합친 새 PNG — 원본 파일은 그대로).
 */
import { useCallback, useEffect, useRef, useState } from "react";

const isVideo = (u: string) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(u);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
type Tool = "circle" | "rect" | "pen" | "arrow" | "text";
// 좌표는 사진 원래 픽셀 기준. 글상자는 text·size(px)·bg(배경색, ""=없음)
type Mark = { tool: Tool; color: string; w: number; pts: Array<[number, number]>; text?: string; size?: number; bg?: string };
const COLORS = ["#ef4444", "#facc15", "#22c55e", "#3b82f6", "#ffffff", "#0f172a"];
const BGS = ["", "#ffffff", "#0f172a", "#facc15"];
const SIZES = [8, 10, 12, 14, 16, 20, 24, 32, 48];   // 글자 크기(pt) — 화면에 보이는 크기 기준, 사진 해상도로 바꿔 넣는다
const TOOL_LABEL: Record<Tool, string> = { circle: "◯", rect: "▢", arrow: "↗", pen: "✎", text: "T" };
const FONT = "Pretendard, Apple SD Gothic Neo, Malgun Gothic, Noto Sans KR, sans-serif";
/** 글상자 크기 짐작(한글은 거의 정사각) */
const textBox = (m: Mark) => { const sz = m.size || 32; const lines = String(m.text || "").split("\n"); const w = Math.max(...lines.map((l) => [...l].reduce((n, ch) => n + (/[ -~]/.test(ch) ? 0.58 : 1), 0))) * sz; return { w: w + sz * 0.6, h: lines.length * sz * 1.25 + sz * 0.35, lines, sz }; };

/** 표시 하나를 SVG 요소로 */
function MarkShape({ m }: { m: Mark }) {
  const [a, b] = [m.pts[0], m.pts[m.pts.length - 1]];
  const common = { stroke: m.color, strokeWidth: m.w, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (m.tool === "text") {
    const { w, h, lines, sz } = textBox(m);
    return <g>{m.bg && <rect x={a[0]} y={a[1]} width={w} height={h} rx={sz * 0.2} fill={m.bg} fillOpacity={0.88} />}
      <text x={a[0] + sz * 0.3} y={a[1] + sz * 1.05} fill={m.color} fontSize={sz} fontWeight={800} fontFamily={FONT}>{lines.map((l, i) => <tspan key={i} x={a[0] + sz * 0.3} dy={i ? sz * 1.25 : 0}>{l}</tspan>)}</text></g>;
  }
  if (m.tool === "pen") return <polyline points={m.pts.map((p) => p.join(",")).join(" ")} {...common} />;
  if (m.tool === "rect") return <rect x={Math.min(a[0], b[0])} y={Math.min(a[1], b[1])} width={Math.abs(b[0] - a[0])} height={Math.abs(b[1] - a[1])} {...common} />;
  if (m.tool === "circle") return <ellipse cx={(a[0] + b[0]) / 2} cy={(a[1] + b[1]) / 2} rx={Math.abs(b[0] - a[0]) / 2} ry={Math.abs(b[1] - a[1]) / 2} {...common} />;
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), h = m.w * 4;
  const p1: [number, number] = [b[0] - h * Math.cos(ang - 0.45), b[1] - h * Math.sin(ang - 0.45)];
  const p2: [number, number] = [b[0] - h * Math.cos(ang + 0.45), b[1] - h * Math.sin(ang + 0.45)];
  return <g {...common}><line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} /><polyline points={`${p1.join(",")} ${b.join(",")} ${p2.join(",")}`} /></g>;
}

/** 원본 + 표시를 합친 PNG(보이는 회전 그대로) */
async function exportMarked(url: string, marks: Mark[], rot: number, nat: { w: number; h: number }): Promise<string | null> {
  try {
    const img = new Image(); img.crossOrigin = "anonymous";
    await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error("load")); img.src = url; });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${nat.w}" height="${nat.h}" viewBox="0 0 ${nat.w} ${nat.h}">${marks.map((m) => {
      const [a, b] = [m.pts[0], m.pts[m.pts.length - 1]];
      const st = `stroke="${m.color}" stroke-width="${m.w}" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
      if (m.tool === "text") {
        const { w, h, lines, sz } = textBox(m);
        const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return `${m.bg ? `<rect x="${a[0]}" y="${a[1]}" width="${w}" height="${h}" rx="${sz * 0.2}" fill="${m.bg}" fill-opacity="0.88"/>` : ""}<text x="${a[0] + sz * 0.3}" y="${a[1] + sz * 1.05}" fill="${m.color}" font-size="${sz}" font-weight="800" font-family="${FONT}">${lines.map((l, i) => `<tspan x="${a[0] + sz * 0.3}" dy="${i ? sz * 1.25 : 0}">${esc(l)}</tspan>`).join("")}</text>`;
      }
      if (m.tool === "pen") return `<polyline ${st} points="${m.pts.map((p) => p.join(",")).join(" ")}"/>`;
      if (m.tool === "rect") return `<rect ${st} x="${Math.min(a[0], b[0])}" y="${Math.min(a[1], b[1])}" width="${Math.abs(b[0] - a[0])}" height="${Math.abs(b[1] - a[1])}"/>`;
      if (m.tool === "circle") return `<ellipse ${st} cx="${(a[0] + b[0]) / 2}" cy="${(a[1] + b[1]) / 2}" rx="${Math.abs(b[0] - a[0]) / 2}" ry="${Math.abs(b[1] - a[1]) / 2}"/>`;
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), h = m.w * 4;
      return `<g ${st}><line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/><polyline points="${b[0] - h * Math.cos(ang - 0.45)},${b[1] - h * Math.sin(ang - 0.45)} ${b[0]},${b[1]} ${b[0] - h * Math.cos(ang + 0.45)},${b[1] - h * Math.sin(ang + 0.45)}"/></g>`;
    }).join("")}</svg>`;
    const over = new Image();
    await new Promise<void>((ok, bad) => { over.onload = () => ok(); over.onerror = () => bad(new Error("svg")); over.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; });
    const turned = rot % 180 !== 0;
    const c = document.createElement("canvas"); c.width = turned ? nat.h : nat.w; c.height = turned ? nat.w : nat.h;
    const ctx = c.getContext("2d"); if (!ctx) return null;
    ctx.translate(c.width / 2, c.height / 2); ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(img, -nat.w / 2, -nat.h / 2, nat.w, nat.h); ctx.drawImage(over, -nat.w / 2, -nat.h / 2, nat.w, nat.h);
    return c.toDataURL("image/png");
  } catch { return null; }
}

/** 보기용 보정 — 작으면 키우고(최대 3배, 1600px 까지) 3×3 언샤프로 또렷하게. 실패(CORS 등)하면 null */
async function enhance(url: string): Promise<string | null> {
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error("load")); img.src = url; });
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return null;
    const factor = w >= 1200 ? 1 : w >= 600 ? 2 : 3;
    const W = Math.min(1600, Math.round(w * factor)), H = Math.round(h * (W / w));
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, W, H);
    const src = ctx.getImageData(0, 0, W, H);
    const out = ctx.createImageData(W, H);
    const s = src.data, d = out.data;
    const k = factor === 1 ? 0.35 : 0.6;   // 선명 강도 — 원본이 크면 약하게
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        let sum = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
          sum += s[(yy * W + xx) * 4 + ch]; n++;
        }
        const blur = sum / n, v = s[i + ch];
        d[i + ch] = clamp(Math.round(v + (v - blur) * k * 2), 0, 255);
      }
      d[i + 3] = s[i + 3];
    }
    ctx.putImageData(out, 0, 0);
    return c.toDataURL("image/png");
  } catch { return null; }
}

export default function PhotoViewer({ urls, index, onClose, onDownload }: { urls: string[]; index: number; onClose: () => void; onDownload?: (url: string, i: number) => void }) {
  const [idx, setIdx] = useState(index);
  const [scale, setScale] = useState(1);
  const [rot, setRot] = useState(0);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [sharp, setSharp] = useState(false);
  const [sharpSrc, setSharpSrc] = useState<string | null>(null);
  const [sharpBusy, setSharpBusy] = useState(false);
  // 그리기
  const [drawOn, setDrawOn] = useState(false);
  const [tool, setTool] = useState<Tool>("circle");
  const [color, setColor] = useState(COLORS[0]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [saving, setSaving] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [live, setLive] = useState<Mark | null>(null);          // 그리는 중인 표시
  const [textSize, setTextSize] = useState(16);
  const [textBg, setTextBg] = useState("#ffffff");
  const [textAt, setTextAt] = useState<[number, number] | null>(null);   // 글상자 놓을 자리(누른 곳, 사진 좌표)
  const [textScreen, setTextScreen] = useState<{ x: number; y: number } | null>(null);   // 그 자리의 화면 좌표 — 입력 상자를 바로 거기 띄운다
  const [textDraft, setTextDraft] = useState("");
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
  const pinch = useRef<{ d: number; s: number } | null>(null);
  const swipe = useRef<number | null>(null);
  const url = urls[idx];
  const video = isVideo(url);

  const reset = useCallback(() => { setScale(1); setRot(0); setPos({ x: 0, y: 0 }); }, []);
  const go = useCallback((n: number) => { if (n < 0 || n >= urls.length) return; setIdx(n); setScale(1); setRot(0); setPos({ x: 0, y: 0 }); setSharpSrc(null); setMarks([]); }, [urls.length]);
  // 화면 좌표 → 사진 원래 픽셀 좌표(확대·이동·회전을 거꾸로) — SVG 의 화면 변환 행렬을 뒤집어 쓴다
  const toImg = (e: React.PointerEvent): [number, number] | null => {
    const svg = svgRef.current; if (!svg) return null;
    const m = svg.getScreenCTM(); if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [Math.round(p.x), Math.round(p.y)];
  };
  const penW = Math.max(3, Math.round(Math.max(nat.w, nat.h) / 220));
  const drawDown = (e: React.PointerEvent) => {
    const p = toImg(e); if (!p) return; e.stopPropagation();
    if (tool === "text") { setTextAt(p); setTextScreen({ x: e.clientX, y: e.clientY }); setTextDraft(""); return; }   // 누른 자리에 바로 입력 상자
    (e.currentTarget as Element).setPointerCapture(e.pointerId); setLive({ tool, color, w: penW, pts: [p, p] });
  };
  const drawMove = (e: React.PointerEvent) => {
    if (!live) return; const p = toImg(e); if (!p) return; e.stopPropagation();
    setLive((d) => (d ? { ...d, pts: d.tool === "pen" ? [...d.pts, p] : [d.pts[0], p] } : d));
  };
  const drawUp = (e: React.PointerEvent) => {
    const d = live; setLive(null); if (!d) return; e.stopPropagation();
    const [a, b] = [d.pts[0], d.pts[d.pts.length - 1]];
    if (d.tool === "pen" ? d.pts.length > 2 : Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) > 6) setMarks((cur) => [...cur, d]);
  };
  const putText = () => {
    if (!textAt || !textDraft.trim()) return;
    // pt → 화면 px(×1.33) → 사진 px(사진 원래 폭 ÷ 지금 화면에 보이는 폭) — 확대해 둔 상태면 그만큼 작게 들어간다
    const rect = svgRef.current?.getBoundingClientRect();
    const shown = rect ? Math.max(rect.width, rect.height) : 0;
    const perPx = shown ? Math.max(nat.w, nat.h) / shown : 1;
    setMarks((cur) => [...cur, { tool: "text", color, w: 0, pts: [textAt], text: textDraft.trim(), size: Math.max(4, Math.round(textSize * 1.33 * perPx)), bg: textBg }]);
    setTextAt(null); setTextScreen(null); setTextDraft("");
  };
  const saveMarked = async () => {
    if (!nat.w) return; setSaving(true);
    const data = await exportMarked(url, marks, rot, nat);
    setSaving(false);
    if (!data) { window.alert("표시째 저장을 만들지 못했습니다 — 화면을 캡처해 주세요"); return; }
    const a = document.createElement("a"); a.href = data; a.download = `사진_표시_${idx + 1}.png`; a.click();
  };
  const zoomTo = useCallback((next: number) => setScale(clamp(Number(next.toFixed(2)), 1, 8)), []);

  // 선명하게 — 사진이 바뀌거나 켜질 때 한 번 만든다(보기용, 원본은 그대로)
  useEffect(() => {
    if (!sharp || video) { setSharpSrc(null); return; }
    let alive = true; setSharpBusy(true);
    void enhance(url).then((r) => { if (alive) { setSharpSrc(r); setSharpBusy(false); } });
    return () => { alive = false; };
  }, [sharp, url, video]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") go(idx - 1);
      else if (e.key === "ArrowRight") go(idx + 1);
      else if (e.key === "+" || e.key === "=") zoomTo(scale * 1.25);
      else if (e.key === "-") zoomTo(scale / 1.25);
      else if (e.key === "r" || e.key === "R") setRot((r) => (r + 90) % 360);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, scale, go, zoomTo, onClose]);

  const onWheel = (e: React.WheelEvent) => { e.preventDefault(); zoomTo(e.deltaY < 0 ? scale * 1.15 : scale / 1.15); };
  const onPointerDown = (e: React.PointerEvent) => { if (e.button !== 0 || drawOn) return; drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y, moved: false }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || pinch.current) return;
    const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.current.moved = true;
    if (scale > 1) setPos({ x: drag.current.px + dx, y: drag.current.py + dy });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!drawOn && scale <= 1 && Math.abs(dx) > 50) { if (dx > 0) go(idx - 1); else go(idx + 1); }
  };
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) { const [a, b] = [e.touches[0], e.touches[1]]; pinch.current = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), s: scale }; }
    else if (e.touches.length === 1) swipe.current = e.touches[0].clientX;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinch.current) { e.preventDefault(); const [a, b] = [e.touches[0], e.touches[1]]; const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); zoomTo(pinch.current.s * (d / pinch.current.d)); }
  };
  const onTouchEnd = () => { pinch.current = null; swipe.current = null; };

  const btn = "rounded-full bg-white/15 px-3 py-1.5 text-[12px] font-black text-white hover:bg-white/25 disabled:opacity-40";
  return (
    <div className="fixed inset-0 z-[300] flex flex-col bg-black/95 text-white" onClick={onClose} role="dialog" aria-label="사진 보기">
      {/* 위 — 번호·조절 단추 */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2" onClick={(e) => e.stopPropagation()}>
        <span className="rounded-full bg-black/50 px-3 py-1 text-xs font-black">{idx + 1} / {urls.length}</span>
        {!video && <>
          <button type="button" className={btn} onClick={() => zoomTo(scale / 1.25)} title="축소 (－)">－</button>
          <span className="min-w-12 text-center text-[12px] font-black tabular-nums">{Math.round(scale * 100)}%</span>
          <button type="button" className={btn} onClick={() => zoomTo(scale * 1.25)} title="확대 (＋)">＋</button>
          <button type="button" className={btn} onClick={() => setRot((r) => (r + 90) % 360)} title="90° 회전 (R)">↻ 회전</button>
          <button type="button" className={btn} onClick={reset} title="원래 크기로">맞춤</button>
          <button type="button" className={`${btn} ${sharp ? "bg-emerald-500/80 hover:bg-emerald-500" : ""}`} onClick={() => setSharp((v) => !v)} title="보기용 보정 — 작은 사진을 키우고 또렷하게. 원본은 그대로">{sharpBusy ? "보정 중…" : sharp ? "선명하게 ✓" : "선명하게"}</button>
          <button type="button" className={`${btn} ${drawOn ? "bg-rose-500/80 hover:bg-rose-500" : ""}`} onClick={() => setDrawOn((v) => !v)} title="동그라미·네모·화살표·펜으로 표시">{drawOn ? "그리기 ✓" : "그리기"}</button>
          {onDownload && <button type="button" className={btn} onClick={() => onDownload(url, idx)} title="원본 저장">저장</button>}
        </>}
        <button type="button" className={`${btn} ml-auto`} onClick={onClose}>닫기 ✕</button>
      </div>
      {drawOn && !video && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2" onClick={(e) => e.stopPropagation()}>
          {(Object.keys(TOOL_LABEL) as Tool[]).map((t) => <button key={t} type="button" onClick={() => setTool(t)} className={`h-8 w-8 rounded-full text-[15px] font-black ${tool === t ? "bg-white text-slate-950" : "bg-white/15 text-white"}`} title={t === "circle" ? "동그라미" : t === "rect" ? "네모" : t === "arrow" ? "화살표" : "펜"}>{TOOL_LABEL[t]}</button>)}
          <span className="mx-1 h-5 w-px bg-white/20" />
          {COLORS.map((c) => <button key={c} type="button" onClick={() => setColor(c)} className={`h-7 w-7 rounded-full border-2 ${color === c ? "border-white" : "border-transparent"}`} style={{ background: c }} aria-label="색" />)}
          {tool === "text" && <>
            <span className="mx-1 h-5 w-px bg-white/20" />
            <select value={textSize} onChange={(e) => setTextSize(Number(e.target.value))} title="글자 크기" className="rounded-full bg-white/15 px-2 py-1.5 text-[12px] font-black text-white">{SIZES.map((v) => <option key={v} value={v} className="text-slate-900">{v}</option>)}</select>
            <span className="text-[11px] font-black text-slate-300">배경</span>
            {BGS.map((b) => <button key={b || "none"} type="button" onClick={() => setTextBg(b)} title={b ? "배경색" : "배경 없음"} className={`h-7 w-7 rounded-md border-2 text-[10px] font-black ${textBg === b ? "border-white" : "border-white/20"}`} style={{ background: b || "transparent", color: "#fff" }}>{b ? "" : "없음"}</button>)}
          </>}
          <span className="mx-1 h-5 w-px bg-white/20" />
          <button type="button" className={btn} disabled={!marks.length} onClick={() => setMarks((cur) => cur.slice(0, -1))}>되돌리기</button>
          <button type="button" className={btn} disabled={!marks.length} onClick={() => setMarks([])}>모두 지우기</button>
          <button type="button" className={`${btn} bg-emerald-500/80 hover:bg-emerald-500`} disabled={!marks.length || saving} onClick={() => void saveMarked()}>{saving ? "만드는 중…" : "표시째 저장"}</button>
          {tool === "text" && (
            <span className="w-full text-[11px] font-semibold text-slate-300">사진에서 글을 넣을 자리를 누르면 그 자리에 입력 상자가 뜹니다 — Enter 넣기 · Shift+Enter 줄바꿈 · Esc 취소</span>
          )}
        </div>
      )}
      {/* 가운데 — 사진. 휠 확대, 끌어서 이동, 핀치, 더블클릭 확대/맞춤 */}
      <div className="relative min-h-0 flex-1 select-none overflow-hidden" onClick={(e) => e.stopPropagation()} onWheel={onWheel}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { drag.current = null; }}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        onDoubleClick={() => { if (drawOn) return; if (scale > 1) reset(); else zoomTo(2.5); }} style={{ touchAction: "none", cursor: scale > 1 ? "grab" : "default" }}>
        <div className="flex h-full w-full items-center justify-center">
          {video
            ? <video src={url} controls autoPlay playsInline className="max-h-full max-w-full object-contain" />
            : <div className="relative inline-block max-h-full max-w-full transition-transform duration-75" style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale}) rotate(${rot}deg)` }}>
                <img src={sharp && sharpSrc ? sharpSrc : url} alt="" draggable={false} onLoad={(e) => { const im = e.currentTarget; if (!sharp || !nat.w) setNat({ w: im.naturalWidth, h: im.naturalHeight }); }}
                  className="block max-h-[calc(100dvh-150px)] max-w-[100vw] object-contain" />
                {nat.w > 0 && (
                  <svg ref={svgRef} viewBox={`0 0 ${nat.w} ${nat.h}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full"
                    style={{ pointerEvents: drawOn ? "auto" : "none", cursor: drawOn ? "crosshair" : "default", touchAction: "none" }}
                    onPointerDown={drawDown} onPointerMove={drawMove} onPointerUp={drawUp}>
                    {marks.map((m, i) => <MarkShape key={i} m={m} />)}
                    {live && <MarkShape m={live} />}
                    {textAt && <g stroke={color} strokeWidth={penW / 1.5} strokeLinecap="round"><line x1={textAt[0] - penW * 3} y1={textAt[1]} x2={textAt[0] + penW * 3} y2={textAt[1]} /><line x1={textAt[0]} y1={textAt[1] - penW * 3} x2={textAt[0]} y2={textAt[1] + penW * 3} /></g>}
                  </svg>
                )}
              </div>}
        </div>
        {idx > 0 && <button type="button" onClick={() => go(idx - 1)} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/20 px-3 py-2 text-xl font-bold">‹</button>}
        {idx < urls.length - 1 && <button type="button" onClick={() => go(idx + 1)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/20 px-3 py-2 text-xl font-bold">›</button>}
      </div>
      {textAt && textScreen && (
        <div className="fixed z-[310] flex items-start gap-1" style={{ left: Math.min(textScreen.x, window.innerWidth - 250), top: Math.min(textScreen.y, window.innerHeight - 90) }} onClick={(e) => e.stopPropagation()}>
          <textarea autoFocus value={textDraft} onChange={(e) => setTextDraft(e.target.value)} rows={2} placeholder="글자 입력"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); putText(); } if (e.key === "Escape") { e.stopPropagation(); setTextAt(null); setTextScreen(null); } }}
            className="w-52 resize rounded-md border-2 px-2 py-1 font-extrabold outline-none" style={{ borderColor: color, color, background: textBg || "rgba(255,255,255,.08)", fontSize: Math.min(28, textSize * 1.33) }} />
          <div className="flex flex-col gap-1">
            <button type="button" disabled={!textDraft.trim()} onClick={putText} className="rounded-md bg-blue-600 px-2 py-1 text-[11px] font-black text-white disabled:opacity-40">넣기</button>
            <button type="button" onClick={() => { setTextAt(null); setTextScreen(null); }} className="rounded-md bg-white/20 px-2 py-1 text-[11px] font-black text-white">취소</button>
          </div>
        </div>
      )}
      <div className="px-3 py-1.5 text-center text-[10.5px] font-semibold text-slate-400" onClick={(e) => e.stopPropagation()}>휠·핀치·더블클릭으로 확대, 확대한 뒤 끌어서 이동 · 원본 파일은 바뀌지 않습니다</div>
    </div>
  );
}
