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
  const [downloading, setDownloading] = useState(false);
  const [downloadErr, setDownloadErr] = useState("");
  const touchX = useRef<number | null>(null);

  useEffect(() => {
    getAlbum(id)
      .then((a) => { setUrls(a.urls || []); setVendor(a.vendor || ""); })
      .catch((e) => setErr((e as Error).message || "불러오기 실패"))
      .finally(() => setLoading(false));
  }, [id]);

  const isVideo = (u: string) => /\.(mp4|mov|webm|m4v|avi|3gp|mkv)(\?|$)/i.test(u);
  const prev = () => setIdx((i) => (i == null ? i : Math.max(0, i - 1)));
  const next = () => setIdx((i) => (i == null ? i : Math.min(urls.length - 1, i + 1)));

  const safeVendor = (vendor || "현장사진").replace(/[\\/:*?"<>|]/g, "_");
  const downloadPhoto = async (url: string, photoIndex: number) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error("사진을 불러오지 못했습니다.");
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `${safeVendor}_${String(photoIndex + 1).padStart(2, "0")}.jpg`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  };

  const handleDownload = async (url: string, photoIndex: number) => {
    setDownloading(true);
    setDownloadErr("");
    try {
      await downloadPhoto(url, photoIndex);
    } catch (error) {
      setDownloadErr((error as Error).message || "사진 다운로드에 실패했습니다.");
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadAll = async () => {
    setDownloading(true);
    setDownloadErr("");
    try {
      for (const [photoIndex, url] of urls.entries()) {
        if (!isVideo(url)) await downloadPhoto(url, photoIndex);
      }
    } catch (error) {
      setDownloadErr((error as Error).message || "사진 다운로드에 실패했습니다.");
    } finally {
      setDownloading(false);
    }
  };

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
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-slate-800 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">{vendor || "현장 사진"}</div>
          {urls.length > 0 && <div className="text-[11px] text-slate-400">{urls.length}장 · 사진 탭 → 좌우로 넘기기</div>}
        </div>
        {urls.some((url) => !isVideo(url)) && (
          <button
            type="button"
            disabled={downloading}
            onClick={handleDownloadAll}
            className="shrink-0 rounded-lg bg-white px-3 py-2 text-xs font-bold text-slate-900 disabled:opacity-50"
          >
            {downloading ? "다운로드 중…" : "사진 전체 저장"}
          </button>
        )}
      </div>

      {loading && <div className="p-8 text-center text-slate-400">불러오는 중…</div>}
      {err && <div className="p-8 text-center text-rose-300">{err}</div>}
      {downloadErr && <div className="px-4 py-2 text-center text-sm text-rose-300">{downloadErr}</div>}

      <div className="grid grid-cols-3 gap-1 p-1 sm:grid-cols-4">
        {urls.map((u, i) => (
          <div key={i} className="relative aspect-square overflow-hidden bg-slate-800">
            <button type="button" onClick={() => setIdx(i)} className="h-full w-full">
              {isVideo(u) ? (
                <>
                  <video src={u} preload="metadata" muted className="h-full w-full object-cover" />
                  <span className="absolute inset-0 flex items-center justify-center text-3xl text-white/90 drop-shadow">▶</span>
                </>
              ) : (
                <img src={u} alt={`사진 ${i + 1}`} loading="lazy" className="h-full w-full object-cover" />
              )}
            </button>
            {!isVideo(u) && (
              <button
                type="button"
                aria-label={`사진 ${i + 1} 다운로드`}
                disabled={downloading}
                onClick={() => void handleDownload(u, i)}
                className="absolute bottom-1 right-1 rounded-md bg-black/70 px-2 py-1 text-[11px] font-bold text-white disabled:opacity-50"
              >
                저장
              </button>
            )}
          </div>
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
          {isVideo(urls[idx]) ? (
            <video
              src={urls[idx]}
              controls
              autoPlay
              playsInline
              className="max-h-full max-w-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img
              src={urls[idx]}
              alt=""
              className="max-h-full max-w-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          )}

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
          {!isVideo(urls[idx]) && (
            <button
              type="button"
              disabled={downloading}
              className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-900 disabled:opacity-50"
              onClick={(e) => { e.stopPropagation(); void handleDownload(urls[idx], idx); }}
            >
              JPEG 다운로드
            </button>
          )}
        </div>
      )}
    </div>
  );
}
