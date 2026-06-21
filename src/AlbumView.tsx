/** 사진 앨범 보기 — 카톡 링크(?album=id)로 진입 시 사진 전부 격자로 표시. 탭하면 전체화면. */
import { useEffect, useState } from "react";
import { getAlbum } from "./supabase";

export default function AlbumView({ id }: { id: string }) {
  const [urls, setUrls] = useState<string[]>([]);
  const [vendor, setVendor] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState<string | null>(null);

  useEffect(() => {
    getAlbum(id)
      .then((a) => { setUrls(a.urls || []); setVendor(a.vendor || ""); })
      .catch((e) => setErr((e as Error).message || "불러오기 실패"))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <div className="sticky top-0 z-10 flex items-center justify-between bg-slate-800 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">{vendor || "현장 사진"}</div>
          {urls.length > 0 && <div className="text-[11px] text-slate-400">{urls.length}장</div>}
        </div>
      </div>

      {loading && <div className="p-8 text-center text-slate-400">불러오는 중…</div>}
      {err && <div className="p-8 text-center text-rose-300">{err}</div>}

      <div className="grid grid-cols-3 gap-1 p-1 sm:grid-cols-4">
        {urls.map((u, i) => (
          <button key={i} type="button" onClick={() => setZoom(u)} className="aspect-square overflow-hidden bg-slate-800">
            <img src={u} alt={`사진 ${i + 1}`} loading="lazy" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>

      {zoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-2" onClick={() => setZoom(null)}>
          <img src={zoom} alt="" className="max-h-full max-w-full object-contain" />
          <button type="button" className="absolute right-3 top-3 rounded-full bg-white/20 px-3 py-1.5 text-sm font-bold" onClick={() => setZoom(null)}>닫기</button>
        </div>
      )}
    </div>
  );
}
