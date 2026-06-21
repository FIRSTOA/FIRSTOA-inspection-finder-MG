/** 사진 앨범 보기 — 카톡 링크(?album=id)로 진입 시 사진 전부 격자로 표시.
 *  탭하면 전체화면 + 좌우 스와이프/화살표로 넘기기 (모바일 최적화). */
import { useEffect, useRef, useState } from "react";
import { getAlbum } from "./supabase";

export default function AlbumView({ id }: { id: string }) {
  const [urls, setUrls] = useState<string[]>([]);
  const [vendor, setVendor] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState<number | null>(null);
  const touchX = useRef<number | null>(null);

  useEffect(() => {
    getAlbum(id)
      .then((a) => { setUrls(a.urls || []); setVendor(a.vendor || ""); })
      .catch((e) => setErr((e as Error).message || "불러오기 실패"))
      .finally(() => setLoading(false));
  }, [id]);

  const prev = () => setIdx((i) => (i == null ? i : Math.max(0, i - 1)));
  const next = () => setIdx((i) => (i == null ? i : Math.min(urls.length - 1, i + 1)));

  // 키보드 ←/→/Esc (데스크톱)
  useEffect(() => {
    if (idx == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "Escape") setIdx(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, urls.length]);

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <div className="sticky top-0 z-10 flex items-center justify-between bg-slate-800 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">{vendor || "현장 사진"}</div>
          {urls.length > 0 && <div className="text-[11px] text-slate-400">{urls.length}장 · 사진 탭 → 좌우로 넘기기</div>}
        </div>
      </div>

      {loading && <div className="p-8 text-center text-slate-400">불러오는 중…</div>}
      {err && <div className="p-8 text-center text-rose-300">{err}</div>}

      <div className="grid grid-cols-3 gap-1 p-1 sm:grid-cols-4">
        {urls.map((u, i) => (
          <button key={i} type="button" onClick={() => setIdx(i)} className="aspect-square overflow-hidden bg-slate-800">
            <img src={u} alt={`사진 ${i + 1}`} loading="lazy" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>

      {idx != null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          onClick={() => setIdx(null)}
          onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
          onTouchEnd={(e) => {
            if (touchX.current == null) return;
            const dx = e.changedTouches[0].clientX - touchX.current;
            if (dx > 40) prev(); else if (dx < -40) next();
            touchX.current = null;
          }}
        >
          <img
            src={urls[idx]}
            alt=""
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />

          {/* 좌우 화살표 (데스크톱/탭) */}
          {idx > 0 && (
            <button type="button" onClick={(e) => { e.stopPropagation(); prev(); }}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/20 px-3 py-2 text-xl font-bold">‹</button>
          )}
          {idx < urls.length - 1 && (
            <button type="button" onClick={(e) => { e.stopPropagation(); next(); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/20 px-3 py-2 text-xl font-bold">›</button>
          )}

          {/* 카운터 + 닫기 */}
          <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs font-semibold">
            {idx + 1} / {urls.length}
          </div>
          <button type="button" className="absolute right-3 top-3 rounded-full bg-white/20 px-3 py-1.5 text-sm font-bold"
            onClick={(e) => { e.stopPropagation(); setIdx(null); }}>닫기</button>
        </div>
      )}
    </div>
  );
}
