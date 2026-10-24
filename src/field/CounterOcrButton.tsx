/**
 * 점검·AS 양식의 [📷 매수 분석]·[📷 잔량 분석] 단추. 관리 탭 FIELD_OCR 스위치 캐시(ocrFlag)는 이 파일 한 곳에만 둔다.
 * App.tsx에서 글자 그대로 옮겨 왔다(2026-10-24, docs/tasks/field-form-tidy.md S2).
 */
import { useEffect, useState } from "react";
import { getConfig, invokeEdgeFunction } from "../supabase";
import { prepareImageForUpload } from "../imageUpload";

/** [📷 매수 분석] — 복합기 카운터·소모품 화면 사진을 찍거나 고르면 매수(흑·컬·큰컬·합)·잔량(K/C/M/Y)·폐통을 읽어 채운다(2026-10-14, counter-ocr) */
export type CounterOcr = { black: string; color: string; largeColor: string; total: string; tonerK: string; tonerC: string; tonerM: string; tonerY: string; waste: string; note?: string; error?: string };
let ocrFlag: Promise<boolean> | null = null;   // 관리 탭 FIELD_OCR — 켜야 [매수 분석]·[잔량 분석]이 보인다(시험 중이라 숨김, 2026-10-14)
export function CounterOcrButton({ kind, model, onResult }: { kind: "count" | "toner"; model: string; onResult: (r: CounterOcr) => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [on, setOn] = useState(false);
  useEffect(() => {
    ocrFlag ||= getConfig().then((c) => /^(true|1|on|yes)$/i.test(String(c.FIELD_OCR || ""))).catch(() => false);
    let alive = true; void ocrFlag?.then((v) => { if (alive) setOn(v); });
    return () => { alive = false; };
  }, []);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setNote("");
    try {
      const prepared = await prepareImageForUpload(file, 1800, { quality: 0.9 });
      const dataUrl = await new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => bad(new Error("사진을 읽지 못했습니다")); r.readAsDataURL(prepared.blob); });
      const res = await invokeEdgeFunction<CounterOcr>("counter-ocr", { image: dataUrl, model, kind, author: localStorage.getItem("author") || "" }, 90_000);
      if (res.error) throw new Error(res.error);
      const got = (kind === "count"
        ? [res.black && `흑 ${res.black}`, res.color && `컬 ${res.color}`, res.largeColor && `큰컬 ${res.largeColor}`, res.total && `합 ${res.total}`]
        : [[res.tonerK, res.tonerC, res.tonerM, res.tonerY].some(Boolean) && `K${res.tonerK || "-"} C${res.tonerC || "-"} M${res.tonerM || "-"} Y${res.tonerY || "-"}`]).filter(Boolean);
      if (!got.length) { setNote(`읽은 숫자가 없습니다${res.note ? ` — ${res.note}` : ""}. ${kind === "count" ? "카운터(사용량) 화면" : "소모품(토너 잔량) 화면"}을 정면에서 가깝게 찍어 주세요`); return; }
      onResult(res);
      setNote(`채움: ${got.join(" · ")}${res.note ? ` (${res.note})` : ""} — 숫자를 한 번 확인하세요`);
    } catch (e) { setNote(`분석 실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };
  if (!on) return null;
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      <label className={`shrink-0 cursor-pointer rounded-full px-2.5 py-0.5 text-[11.5px] font-black ${busy ? "bg-slate-200 text-slate-400" : "bg-blue-600 text-white hover:bg-blue-700"}`} title={kind === "count" ? "카운터(사용량) 화면 사진으로 흑·컬·큰컬·합 자동 기입" : "소모품 화면 사진으로 토너 잔량 K/C/M/Y 자동 기입(폐통은 직접)"}>
        {busy ? "분석 중…" : kind === "count" ? "📷 매수 분석" : "📷 잔량 분석"}
        <input type="file" accept="image/*" capture="environment" disabled={busy} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void pick(f); }} />
      </label>
      {note && <span className="min-w-0 basis-full text-[10.5px] font-semibold leading-4 text-slate-500">{note}</span>}
    </span>
  );
}
