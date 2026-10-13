/** 사진 앨범 보기 — 카톡 링크(?album=id)로 진입 시 사진 전부 격자로 표시.
 *  탭하면 전체화면 + 좌우 스와이프/화살표로 넘기기 (모바일 최적화). */
import { useEffect, useState } from "react";
import { getAlbum } from "./supabase";
import PhotoViewer, { latestEdited } from "./PhotoViewer";
import { photosToPdf } from "./photoPdf";

export default function AlbumView({ id }: { id: string }) {
  const [urls, setUrls] = useState<string[]>([]);
  const [vendor, setVendor] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadErr, setDownloadErr] = useState("");
  // 편집본(공유 저장된 것)이 있으면 격자·다운로드·PDF 모두 편집본으로(2026-10-14)
  const [shown, setShown] = useState<Record<string, string>>({});
  const [pdfNote, setPdfNote] = useState("");
  const refreshEdited = async (list: string[]) => {
    const pairs = await Promise.all(list.filter((u) => !/\.(mp4|mov|webm|m4v|avi|3gp|mkv)(\?|$)/i.test(u)).map(async (u) => [u, (await latestEdited(u))?.url || u] as [string, string]));
    setShown(Object.fromEntries(pairs));
  };
  const view = (u: string) => shown[u] || u;

  useEffect(() => {
    getAlbum(id)
      .then((a) => { setUrls(a.urls || []); setVendor(a.vendor || ""); void refreshEdited(a.urls || []); })
      .catch((e) => setErr((e as Error).message || "불러오기 실패"))
      .finally(() => setLoading(false));
  }, [id]);

  const isVideo = (u: string) => /\.(mp4|mov|webm|m4v|avi|3gp|mkv)(\?|$)/i.test(u);
  const prev = () => setIdx((i) => (i == null ? i : Math.max(0, i - 1)));
  const next = () => setIdx((i) => (i == null ? i : Math.min(urls.length - 1, i + 1)));

  const safeVendor = (vendor || "현장사진").replace(/[\\/:*?"<>|]/g, "_");
  // 카카오톡 인앱 브라우저는 blob 다운로드를 무시한다 — 스토리지의 네이티브 다운로드
  // 파라미터(?download=파일명)로 넘기면 브라우저가 진짜 다운로드로 처리해 갤러리에 잡힌다.
  const isKakaoInApp = /KAKAOTALK/i.test(navigator.userAgent);
  const openExternal = () => { window.location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(window.location.href)}`; };
  const downloadPhoto = async (url: string, photoIndex: number) => {
    const ext = (url.match(/\.(jpe?g|png|gif|webp|heic)(\?|$)/i) || [])[1] || "jpg";
    const filename = `${safeVendor}_${String(photoIndex + 1).padStart(2, "0")}.${ext}`;
    const href = `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(filename)}`;
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = filename; // 서버가 attachment 헤더를 줘서 크로스오리진이어도 다운로드로 처리됨
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    await new Promise((resolve) => window.setTimeout(resolve, 350)); // 연속 저장 시 브라우저가 큐잉할 틈
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

  // 전체 저장 = PDF 한 파일(사진 n장 → n쪽). 편집본이 있는 사진은 편집본으로
  const handleDownloadAll = async () => {
    setDownloading(true);
    setDownloadErr("");
    try {
      const list = urls.filter((u) => !isVideo(u)).map(view);
      const blob = await photosToPdf(list, (d, t) => setPdfNote(`PDF 만드는 중 ${d}/${t}`));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `${safeVendor}_사진${list.length}장.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (error) {
      setDownloadErr((error as Error).message || "PDF 를 만들지 못했습니다.");
    } finally {
      setDownloading(false); setPdfNote("");
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
            {downloading ? (pdfNote || "다운로드 중…") : "전체 PDF 저장"}
          </button>
        )}
      </div>

      {loading && <div className="p-8 text-center text-slate-400">불러오는 중…</div>}
      {err && <div className="p-8 text-center text-rose-300">{err}</div>}
      {downloadErr && <div className="px-4 py-2 text-center text-sm text-rose-300">{downloadErr}</div>}
      {isKakaoInApp && (
        <button type="button" onClick={openExternal} className="mx-4 my-2 block w-[calc(100%-2rem)] rounded-lg border border-amber-400/50 bg-amber-500/15 px-3 py-2.5 text-center text-xs font-bold leading-5 text-amber-200">
          카카오톡 브라우저에서는 사진 저장이 제한될 수 있어요<br /><span className="font-black underline">여기를 눌러 크롬·삼성브라우저로 열기</span> — 거기서 저장하면 갤러리에 들어갑니다
        </button>
      )}

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
                <img src={view(u)} alt={`사진 ${i + 1}`} loading="lazy" className="h-full w-full object-cover" />
              )}
            </button>
            {!isVideo(u) && (
              <button
                type="button"
                aria-label={`사진 ${i + 1} 다운로드`}
                disabled={downloading}
                onClick={() => void handleDownload(view(u), i)}
                className="absolute bottom-1 right-1 rounded-full bg-black/70 px-2 py-1 text-[11px] font-bold text-white disabled:opacity-50"
              >
                저장
              </button>
            )}
          </div>
        ))}
      </div>

      {/* 확대(휠·핀치·＋－)·회전·끌기·선명하게 — 작은 사진도 판단할 수 있게(2026-10-13). 원본은 그대로 */}
      {idx != null && <PhotoViewer urls={urls} index={idx} onClose={() => { setIdx(null); void refreshEdited(urls); }} onDownload={(u, i) => void handleDownload(u, i)} />}
    </div>
  );
}
