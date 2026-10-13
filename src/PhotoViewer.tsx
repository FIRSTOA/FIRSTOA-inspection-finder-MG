/**
 * 사진 보기 창 — 확대(휠·핀치·＋－·더블클릭), 90° 회전, 끌어서 이동, 좌우 넘기기, "선명하게"(보기용 보정) (2026-10-13)
 *
 * 왜: 접수 사진이 작게만 보여 판단이 안 됐다(240×320 같은 캡처본). 원본 파일은 건드리지 않고 화면에서만 키우고 또렷하게 한다.
 *     "선명하게"는 작은 사진을 2~3배로 늘린 뒤 언샤프 마스크를 한 번 거친 것 — 글자·선이 조금 더 읽힌다. 저장·링크는 늘 원본.
 * 쓰는 곳: 앨범(AlbumView), 일정리스트·서비스접수의 증상 사진.
 */
import { useCallback, useEffect, useRef, useState } from "react";

const isVideo = (u: string) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(u);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
  const pinch = useRef<{ d: number; s: number } | null>(null);
  const swipe = useRef<number | null>(null);
  const url = urls[idx];
  const video = isVideo(url);

  const reset = useCallback(() => { setScale(1); setRot(0); setPos({ x: 0, y: 0 }); }, []);
  const go = useCallback((n: number) => { if (n < 0 || n >= urls.length) return; setIdx(n); setScale(1); setRot(0); setPos({ x: 0, y: 0 }); setSharpSrc(null); }, [urls.length]);
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
  const onPointerDown = (e: React.PointerEvent) => { if (e.button !== 0) return; drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y, moved: false }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
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
    if (scale <= 1 && Math.abs(dx) > 50) { if (dx > 0) go(idx - 1); else go(idx + 1); }
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
          {onDownload && <button type="button" className={btn} onClick={() => onDownload(url, idx)} title="원본 저장">저장</button>}
        </>}
        <button type="button" className={`${btn} ml-auto`} onClick={onClose}>닫기 ✕</button>
      </div>
      {/* 가운데 — 사진. 휠 확대, 끌어서 이동, 핀치, 더블클릭 확대/맞춤 */}
      <div className="relative min-h-0 flex-1 select-none overflow-hidden" onClick={(e) => e.stopPropagation()} onWheel={onWheel}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { drag.current = null; }}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        onDoubleClick={() => (scale > 1 ? reset() : zoomTo(2.5))} style={{ touchAction: "none", cursor: scale > 1 ? "grab" : "default" }}>
        <div className="flex h-full w-full items-center justify-center">
          {video
            ? <video src={url} controls autoPlay playsInline className="max-h-full max-w-full object-contain" />
            : <img src={sharp && sharpSrc ? sharpSrc : url} alt="" draggable={false}
                className="max-h-full max-w-full object-contain transition-transform duration-75"
                style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale}) rotate(${rot}deg)`, imageRendering: "auto" }} />}
        </div>
        {idx > 0 && <button type="button" onClick={() => go(idx - 1)} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/20 px-3 py-2 text-xl font-bold">‹</button>}
        {idx < urls.length - 1 && <button type="button" onClick={() => go(idx + 1)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/20 px-3 py-2 text-xl font-bold">›</button>}
      </div>
      <div className="px-3 py-1.5 text-center text-[10.5px] font-semibold text-slate-400" onClick={(e) => e.stopPropagation()}>휠·핀치·더블클릭으로 확대, 확대한 뒤 끌어서 이동 · 원본 파일은 바뀌지 않습니다</div>
    </div>
  );
}
