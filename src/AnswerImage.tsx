/**
 * 에이전트가 만든 SVG 카드를 그림으로 보여 주고 저장·복사·문자(MMS) 전송 (2026-10-10)
 * - 저장: PNG 내려받기(폰은 사진첩/다운로드 → 카톡으로 보내면 된다)
 * - 복사: 클립보드에 그림(PC 크롬 등에서 카톡 PC 에 바로 붙여넣기)
 * - 문자: customer-message-send(type report) 로 MMS — 번호는 업체 키맨·전화에서 미리 채우고, 보내기 전 확인창
 */
import { useEffect, useState } from "react";
import { askConfirm } from "./confirmModal";
import { notify } from "./toast";
import { invokeEdgeFunction } from "./supabase";
import { canvasToMmsJpeg, canvasToPng, captionFromRest, svgToCanvas, type SvgAnswer } from "./answerSvg";

export default function AnswerImage({ item, vendor, phones, author }: { item: SvgAnswer; vendor: string; phones: string[]; author: string }) {
  const [src, setSrc] = useState("");
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [error, setError] = useState("");
  const [phone, setPhone] = useState(phones[0] || "");
  const [text, setText] = useState(() => captionFromRest(item.rest) || `안녕하세요, ${vendor || "고객"} 담당자님. 퍼스트전산입니다. 안내 이미지를 보내드립니다.`);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    let url = "";
    let alive = true;
    (async () => {
      try {
        const c = await svgToCanvas(item.svg, item.width, item.height, 2);
        const png = await canvasToPng(c);
        if (!alive || !png) return;
        url = URL.createObjectURL(png);
        setCanvas(c); setSrc(url);
      } catch (e) { if (alive) setError((e as Error).message); }
    })();
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [item.svg, item.width, item.height]);

  const fileName = `${(vendor || "안내").replace(/[\\/:*?"<>|\s]+/g, "_")}_${new Date().toISOString().slice(0, 10)}.png`;
  const save = () => { if (!src) return; const a = document.createElement("a"); a.href = src; a.download = fileName; a.click(); };
  const copy = async () => {
    if (!canvas) return;
    try {
      const png = await canvasToPng(canvas);
      if (!png) throw new Error("PNG 변환 실패");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      notify("그림을 복사했습니다 — 카톡 창에 붙여넣기 하세요", "success");
    } catch { notify("이 기기에서는 그림 복사가 안 됩니다 — [저장] 뒤 사진첩에서 보내 주세요", "info"); }
  };
  const sendMms = async () => {
    const to = phone.replace(/\D/g, "");
    if (!/^01\d{8,9}$/.test(to)) { notify("받는 휴대전화 번호를 확인해 주세요", "error"); return; }
    if (!canvas) return;
    if (!await askConfirm(`${vendor || "고객"} — ${to.replace(/(\d{3})(\d{3,4})(\d{4})/, "$1-$2-$3")} 번호로 그림 문자(MMS)를 보낼까요?\n\n${text}`, { okLabel: "MMS 보내기" })) return;
    setBusy("mms");
    try {
      const mms = await canvasToMmsJpeg(canvas);
      if (!mms) throw new Error("그림을 200KB 아래로 줄이지 못했습니다");
      await invokeEdgeFunction("customer-message-send", { channel: "sms", type: "report", to, text, vendor, author, imageBase64: mms.replace(/^data:image\/\w+;base64,/, ""), subject: "방문 안내" }, 60_000);
      notify("MMS 를 보냈습니다", "success");
    } catch (e) { notify(`MMS 전송 실패: ${(e as Error).message}`, "error"); } finally { setBusy(""); }
  };

  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="text-[10.5px] font-black text-slate-500">🖼️ 에이전트가 만든 그림 <span className="font-bold text-slate-400">· {item.width}×{item.height} · 글자체는 이 기기 것으로 그립니다</span></div>
      {error && <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-bold text-rose-700">{error} — 답 글의 SVG 코드를 복사해 파일(.svg)로 저장하면 열립니다.</div>}
      {src && <img src={src} alt="안내 그림" className="mt-2 max-h-[520px] w-auto max-w-full rounded-lg border border-slate-200 bg-white shadow-sm" />}
      {src && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={save} className="rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-black text-white">저장(PNG)</button>
          <button type="button" onClick={() => void copy()} className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-black text-slate-700">복사</button>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="받는 휴대전화" inputMode="tel" className="w-36 rounded-lg border border-slate-300 px-2.5 py-1.5 text-[12px] font-bold outline-none focus:border-blue-500" />
          <button type="button" onClick={() => void sendMms()} disabled={!!busy} className="rounded-full bg-emerald-600 px-3 py-1.5 text-[11px] font-black text-white disabled:opacity-50">{busy ? "보내는 중…" : "문자(MMS)로 보내기"}</button>
          {phones.length > 1 && <span className="text-[10px] font-bold text-slate-400">번호 후보: {phones.map((p) => p.replace(/(\d{3})(\d{3,4})(\d{4})/, "$1-$2-$3")).join(", ")}</span>}
        </div>
      )}
      {src && <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-[12px] font-semibold leading-5 text-slate-800 outline-none focus:border-blue-500" />}
    </div>
  );
}
