/**
 * 점검 리포트(2026-09-30) — 정기점검 양식 한 장을 고객용 리포트 이미지로 만들어 키맨에게 문자(MMS)로 보낸다.
 * 해피콜 탭의 세 번째 모드(해피콜 / 분기점검 안내 / 점검 리포트). 왼쪽은 최근 점검 목록(내 것 기본), 오른쪽은 리포트 카드와 [발송].
 *  - 재료: jeomgeom._원문(FIELD 점검 양식) → inspectionReport.ts 파서. 같은 업체의 직전 점검과 짝지어 사용량 증가분을 낸다.
 *  - 이미지: 카드 DOM을 html2canvas-pro로 굽고 JPG ≤200KB·긴 변 1440 안으로 줄여 customer-message-send(솔라피 MMS)로 보낸다.
 *  - 기록: message_jobs(source_type=inspection_report, status=sent) — 목록에 '발송됨' 표시, 같은 건 재발송은 확인창.
 *  - 기준(CS팀): 토너 잔량 25% 이하 교체, 폐토너통 75% 이상(여유 25% 이하) 교체 예정. 보내기 전 확인창, 10~19시 밖이면 한 번 더 확인.
 *  - 내부용 항목(레벨·등급·한틴이카·주차비·부품/자가신청)은 리포트에 넣지 않는다.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import { Image as ImageIcon, RefreshCw, Send } from "lucide-react";
import { insertRow, invokeEdgeFunction, selectRows } from "./supabase";
import { askConfirm } from "./confirmModal";
import { notify } from "./toast";
import { kstDate } from "./visits";
import { delta, fmt, matchPrevious, parseInspectionForm, tonerLow, wasteFull, type ReportData, type TonerKey } from "./reportForm";

type JeomRow = { id: number; 작성일: string; 작성자: string; 구분: string; 업체명: string; _업체명: string; 모델명: string; 자산기번: string; _원문: string; created_at: string };
const enc = encodeURIComponent;
const COLS = "id,작성일,작성자,구분,업체명,_업체명,모델명,자산기번,_원문,created_at";
const TONER: Array<[TonerKey, string, string]> = [["K", "검정", "#2a2a2e"], ["C", "파랑", "#0e9ad0"], ["M", "빨강", "#d8368a"], ["Y", "노랑", "#efb400"]];
const kstHour = () => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", hour12: false }).format(new Date()));
const shortDate = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const koreanDate = (d: string) => { const dt = new Date(`${d}T12:00:00+09:00`); const day = ["일", "월", "화", "수", "목", "금", "토"][dt.getUTCDay()]; return `${d.slice(0, 4)}. ${Number(d.slice(5, 7))}. ${Number(d.slice(8, 10))} (${day})`; };

// 카드 DOM → MMS용 JPG(base64). 솔라피 한도: 200KB, 세로 이미지는 긴 변 1440.
async function cardToMmsJpeg(node: HTMLElement): Promise<string | null> {
  const { default: html2canvas } = await import("html2canvas-pro");
  const source = await html2canvas(node, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const width = source.width, height = source.height;
  let dim = Math.min(1440, Math.max(width, height));
  for (let round = 0; round < 6; round++) {
    const ratio = dim / Math.max(width, height);
    const w = Math.max(1, Math.round(width * ratio)), h = Math.max(1, Math.round(height * ratio));
    for (const q of [0.92, 0.86, 0.8, 0.72, 0.64, 0.56]) {
      canvas.width = w; canvas.height = h; ctx.imageSmoothingQuality = "high"; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.drawImage(source, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", q));
      if (blob && blob.size <= 200 * 1024) {
        const dataUrl = await new Promise<string>((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.onerror = () => reject(fr.error); fr.readAsDataURL(blob); });
        return dataUrl;
      }
    }
    dim = Math.round(dim * 0.8);
  }
  return null;
}

// ── 리포트 카드(고객이 받는 그림 그대로). 색은 이미지라 고정값 ──
function ReportCard({ data, prev, prevDate, date, author, qr, cardRef }: { data: ReportData; prev: ReportData | null; prevDate: string; date: string; author: string; qr: string; cardRef: React.RefObject<HTMLDivElement | null> }) {
  const month = Number(date.slice(5, 7));
  const nextMonth = month === 12 ? 1 : month + 1;
  const ink = "#1c2230", ink2 = "#4a5567", ink3 = "#8a93a3", line = "#e3e7ee", panel = "#f4f6f9", accent = "#1f9d8a", accentSoft = "#e2f4f0", warn = "#d98a1a", warnSoft = "#fbf0dc";
  const H = ({ children, tag, warnTag }: { children: ReactNode; tag?: string; warnTag?: boolean }) => <div className="flex items-baseline justify-between gap-3"><div style={{ color: ink3 }} className="text-[12px] font-black uppercase tracking-[.12em]">{children}</div>{tag && <span style={{ background: warnTag ? warnSoft : accentSoft, color: warnTag ? warn : accent }} className="rounded-full px-2.5 py-1 text-[12px] font-bold">{tag}</span>}</div>;
  return <div ref={cardRef} style={{ width: 720, background: "#fff", color: ink, fontVariantNumeric: "tabular-nums" }} className="overflow-hidden rounded-[22px] shadow-[0_18px_50px_rgba(20,28,40,.18)]">
    <div style={{ background: "#1e252f", color: "#fff" }} className="relative px-7 pb-6 pt-7">
      <div style={{ position: "absolute", right: -40, top: -60, width: 220, height: 220, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(31,157,138,.35), rgba(31,157,138,0))" }} />
      <div className="relative flex items-center justify-between gap-3">
        <div className="text-[15px] font-black tracking-wide">FIRST<span style={{ color: "#8fd8cb" }}>OA</span> 퍼스트전산</div>
        <div style={{ color: "#aeb8c8" }} className="text-[11px] font-medium uppercase tracking-[.14em]">Monthly Service Report</div>
      </div>
      <div className="relative mt-4 text-[26px] font-black leading-tight tracking-tight">{data.vendor}<br />{month}월 정기점검 리포트</div>
      <div style={{ color: "#c9d1dd" }} className="relative mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        <span>방문 <b className="text-white">{koreanDate(date)}{data.arrival ? ` ${data.arrival}` : ""}</b></span>
        <span>담당 <b className="text-white">{author}</b></span>
        {data.keymanName && <span>키맨 <b className="text-white">{data.keymanName}님</b></span>}
      </div>
    </div>
    <div className="grid gap-5 px-7 pb-7 pt-1">
      {data.devices.map((d) => {
        const p = matchPrevious(d, prev);
        const dm = p ? delta(d.mono, p.mono) : null, dc = p ? delta(d.color, p.color) : null;
        const lows = TONER.filter(([k]) => tonerLow(d.toner[k])).map(([, name]) => name);
        const workLines = String(d.work || "").split("\n").map((l) => l.trim()).filter(Boolean);
        const acts = [workLines.length && !/^정기점검$/.test(workLines.join("")) ? workLines.slice(0, 4).join(" / ") : `정기점검 완료${d.note ? "" : " · 이상 없음"}`, "카운터 확인 및 여분 재고 점검", ...(lows.length ? [`${lows.join("·")} 토너 교체 필요 — 여분으로 교체해 드립니다`] : []), ...(data.albumCount ? [`현장 사진 ${data.albumCount}장 기록`] : [])];
        return <div key={d.index} className="grid gap-5">
          <div style={{ borderBottom: `1px solid ${line}` }} className="grid grid-cols-[1fr_auto] items-center gap-3 pb-4 pt-4">
            <div>
              <div className="text-[22px] font-bold tracking-tight">{d.model || "복합기"}{data.devices.length > 1 ? <span style={{ color: ink3 }} className="ml-2 text-[13px] font-semibold">{d.index}호기</span> : null}</div>
              <div style={{ color: ink2 }} className="mt-1 flex flex-wrap gap-x-3.5 text-[13px]">{d.asset && <span>관리번호 {d.asset}</span>}{d.serial && <span>S/N {d.serial}</span>}</div>
            </div>
            <div style={{ color: ink3 }} className="text-right text-[12px]">점검 결과<b style={{ color: lows.length || wasteFull(d.waste) ? warn : ink }} className="block text-[18px] font-bold">{lows.length ? "토너 교체 필요" : wasteFull(d.waste) ? "폐토너통 교체 예정" : "이상 없음"}</b></div>
          </div>
          {(d.mono != null || d.color != null) && <div className="grid gap-2.5">
            <H tag="누적 카운터 기준">사용량</H>
            <div className="grid grid-cols-2 gap-2.5">
              {[["흑백", d.mono, dm], ["컬러", d.color, dc]].map(([k, v, dv]) => <div key={String(k)} style={{ background: panel }} className="rounded-[14px] px-4 py-3.5">
                <div style={{ color: ink2 }} className="text-[12px] font-medium">{k as string}</div>
                <div className="mt-1 text-[28px] font-bold tracking-tight">{fmt(v as number | null)}<small style={{ color: ink3 }} className="ml-0.5 text-[13px] font-medium">매</small></div>
                {dv != null && <div style={{ color: ink2 }} className="mt-1.5 text-[12px]">지난 점검({shortDate(prevDate)}) 대비 <b style={{ color: accent }}>+{fmt(dv as number)}매</b></div>}
              </div>)}
            </div>
          </div>}
          <div className="grid gap-2.5">
            <H tag={lows.length ? `${lows.join("·")} 교체 필요` : "교체 필요 없음"} warnTag={lows.length > 0}>토너 잔량</H>
            <div className="grid gap-2">
              {TONER.map(([k, name, color]) => { const v = d.toner[k]; return <div key={k} className="grid grid-cols-[52px_1fr_44px] items-center gap-3">
                <div className="flex items-center gap-1.5 text-[13px] font-bold"><i style={{ background: color, width: 12, height: 12, borderRadius: 4, display: "inline-block" }} />{name}</div>
                <div style={{ background: panel, height: 12, borderRadius: 999, position: "relative", overflow: "hidden" }}><b style={{ display: "block", height: "100%", borderRadius: 999, width: `${v ?? 0}%`, background: color }} /><i style={{ position: "absolute", left: "25%", top: 0, bottom: 0, width: 1, background: "rgba(0,0,0,.18)" }} /></div>
                <div style={{ color: tonerLow(v) ? warn : ink }} className="text-right text-[14px] font-bold">{v == null ? "-" : `${v}%`}</div>
              </div>; })}
            </div>
            <div style={{ color: ink3 }} className="text-[11px]">세로선(25%)에 닿기 전에 여분으로 교체해 드립니다.</div>
            {d.waste != null && <div style={{ background: wasteFull(d.waste) ? warnSoft : panel }} className="grid grid-cols-[1fr_auto] items-center gap-3.5 rounded-[14px] px-4 py-3">
              <div style={{ color: wasteFull(d.waste) ? "#7a4d06" : ink }} className="text-[13px] font-bold">폐토너통<small style={{ color: wasteFull(d.waste) ? "#9a6a1f" : ink3 }} className="mt-0.5 block text-[12px] font-medium">{wasteFull(d.waste) ? "다음 방문 때 새것으로 교체 예정" : "여유 있음"}</small></div>
              <div style={{ color: wasteFull(d.waste) ? warn : ink }} className="text-[22px] font-bold">{d.waste}%</div>
            </div>}
          </div>
          {Object.values(d.spare).some((v) => v != null) && <div className="grid gap-2.5">
            <H>사무실 보관 여분</H>
            <div className="flex flex-wrap gap-2">
              {TONER.map(([k, name, color]) => d.spare[k] != null && <span key={k} style={{ border: `1px solid ${line}` }} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-bold"><i style={{ background: color, width: 10, height: 10, borderRadius: 3, display: "inline-block" }} />{name} {d.spare[k]}</span>)}
              {d.spare.W != null && <span style={{ border: `1px solid ${line}` }} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-bold"><i style={{ background: "#9aa3b2", width: 10, height: 10, borderRadius: 3, display: "inline-block" }} />폐토너통 {d.spare.W}</span>}
            </div>
            {d.spareNote && <div style={{ color: ink2 }} className="text-[12px]">보관 위치 · {d.spareNote}</div>}
          </div>}
          <div className="grid gap-2.5">
            <H>오늘 조치</H>
            <ul className="m-0 grid list-none gap-2 p-0">
              {acts.map((a, i) => <li key={i} className="grid grid-cols-[22px_1fr] gap-2.5 text-[14px] leading-relaxed"><span style={{ background: accentSoft, color: accent, width: 20, height: 20, marginTop: 2 }} className="grid place-items-center rounded-full text-[12px] font-black">✓</span><span>{a}</span></li>)}
              {d.note && <li className="grid grid-cols-[22px_1fr] gap-2.5 text-[14px] leading-relaxed"><span style={{ background: warnSoft, color: warn, width: 20, height: 20, marginTop: 2 }} className="grid place-items-center rounded-full text-[12px] font-black">!</span><span>확인 사항: {d.note}</span></li>}
            </ul>
          </div>
        </div>;
      })}
      <div style={{ borderTop: `1px solid ${line}` }} className="grid grid-cols-[1fr_auto] items-center gap-4 pt-4">
        <div>
          <div style={{ color: ink2 }} className="text-[13px]"><b style={{ color: ink }} className="mb-0.5 block text-[15px] font-black">다음 방문 · {nextMonth}월 정기점검</b>일정이 잡히면 하루 전에 문자로 안내드립니다.</div>
          <div style={{ color: ink3 }} className="mt-2.5 text-[12px] leading-relaxed">기기 문제나 소모품 요청은 담당자에게 전화·카톡 한 통이면 됩니다.<br /><b style={{ color: ink }}>{author}</b> · 퍼스트전산 CS팀</div>
        </div>
        {qr && <div className="grid justify-items-center gap-1.5"><div style={{ border: `1px solid ${line}` }} className="rounded-[10px] bg-white p-1.5"><img src={qr} alt="현장 사진" width={80} height={80} style={{ display: "block" }} /></div><div style={{ color: ink3 }} className="text-[11px]">현장 사진 {data.albumCount || ""}장</div></div>}
      </div>
    </div>
  </div>;
}

export default function InspectionReportBoard({ author, switcher }: { author: string; switcher?: ReactNode }) {
  const [rows, setRows] = useState<JeomRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [mine, setMine] = useState(true);
  const [days, setDays] = useState<30 | 90>(30);
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sent, setSent] = useState<Map<string, string>>(new Map());
  const [prev, setPrev] = useState<{ data: ReportData; date: string } | null>(null);
  const [qr, setQr] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState<{ src: string; kb: number } | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const since = kstDate(new Date(Date.now() - days * 86400_000));
      const who = mine && author ? `&${enc("작성자")}=eq.${enc(author)}` : "";
      const [list, jobs] = await Promise.all([
        selectRows<JeomRow>("jeomgeom", `select=${enc(COLS)}&_hidden=is.false&${enc("작성일")}=gte.${since}&${enc("구분")}=ilike.${enc("*점검*")}${who}&order=${enc("작성일")}.desc,created_at.desc&limit=300`),
        selectRows<{ source_id: string; sent_at: string | null }>("message_jobs", "select=source_id,sent_at&source_type=eq.inspection_report&status=eq.sent&limit=2000").catch(() => []),
      ]);
      setRows(list);
      setSent(new Map(jobs.map((j) => [String(j.source_id), String(j.sent_at || "")])));
    } catch (e) { notify((e as Error).message, "error"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [mine, days, author]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => { const k = q.trim().toLowerCase(); return k ? rows.filter((r) => `${r.업체명} ${r.모델명} ${r.작성자}`.toLowerCase().includes(k)) : rows; }, [rows, q]);
  const selected = useMemo(() => rows.find((r) => r.id === selectedId) || null, [rows, selectedId]);
  const data = useMemo(() => (selected ? parseInspectionForm(selected._원문) : null), [selected]);

  // 선택한 건이 바뀌면: 받는 번호, 직전 점검(같은 업체·이전 날짜), 앨범 QR
  useEffect(() => {
    if (!selected || !data) { setPrev(null); setQr(""); return; }
    setPhone(data.keymanPhone);
    let live = true;
    const vendor = selected._업체명 || selected.업체명;
    selectRows<JeomRow>("jeomgeom", `select=${enc(COLS)}&_hidden=is.false&${enc("_업체명")}=eq.${enc(vendor)}&${enc("작성일")}=lt.${selected.작성일}&${enc("구분")}=ilike.${enc("*점검*")}&order=${enc("작성일")}.desc,created_at.desc&limit=1`)
      .then((r) => { if (live) setPrev(r[0] ? { data: parseInspectionForm(r[0]._원문), date: r[0].작성일 } : null); })
      .catch(() => { if (live) setPrev(null); });
    if (data.album) QRCode.toDataURL(data.album, { width: 160, margin: 0, color: { dark: "#1c2230", light: "#ffffff" } }).then((u) => { if (live) setQr(u); }).catch(() => { if (live) setQr(""); });
    else setQr("");
    return () => { live = false; };
  }, [selected, data]);

  const makeImage = async (): Promise<string | null> => {
    const node = cardRef.current; if (!node) return null;
    setBusy("이미지 만드는 중…");
    try { return await cardToMmsJpeg(node); }
    catch (e) { notify(`이미지 생성 실패: ${(e as Error).message}`, "error"); return null; }
    finally { setBusy(""); }
  };
  const showPreview = async () => {
    const src = await makeImage();
    if (!src) { notify("이미지를 만들지 못했습니다", "error"); return; }
    setPreview({ src, kb: Math.round((src.length * 3) / 4 / 1024) });
  };
  const send = async () => {
    if (!selected || !data) return;
    const to = phone.replace(/[^\d]/g, "");
    if (!/^01\d{8,9}$/.test(to)) { notify("받는 휴대폰 번호를 확인해 주세요 (양식의 키맨 번호가 없으면 직접 입력)", "error"); return; }
    const already = sent.get(String(selected.id));
    if (already && !(await askConfirm(`이 점검 리포트는 ${already.slice(0, 16).replace("T", " ")}에 이미 보냈습니다. 다시 보낼까요?`, { okLabel: "다시 보내기" }))) return;
    const h = kstHour();
    if ((h < 10 || h >= 19) && !(await askConfirm(`지금은 ${h}시입니다. 업무시간(10~19시) 밖인데 그래도 보낼까요?`, { danger: true, okLabel: "지금 보내기" }))) return;
    if (!(await askConfirm(`${data.vendor}\n${data.keymanName || "키맨"} ${to.replace(/(\d{3})(\d{3,4})(\d{4})/, "$1-$2-$3")}\n\n${Number(selected.작성일.slice(5, 7))}월 정기점검 리포트 이미지를 문자(MMS)로 보낼까요?`, { okLabel: "보내기" }))) return;
    const src = await makeImage();
    if (!src) { notify("이미지를 만들지 못해 보내지 않았습니다", "error"); return; }
    setBusy("보내는 중…");
    try {
      const month = Number(selected.작성일.slice(5, 7));
      const text = `[퍼스트전산] ${data.vendor} ${month}월 정기점검 리포트를 보내드립니다.\n오늘 확인한 사용량·토너 잔량·여분과 다음 방문 안내를 사진으로 정리했습니다.\n담당 ${author} · 퍼스트전산 CS팀`;
      await invokeEdgeFunction("customer-message-send", { channel: "sms", type: "inspection_report", to, text, imageBase64: src.replace(/^data:image\/\w+;base64,/, ""), subject: `${month}월 정기점검 리포트` });
      const now = new Date().toISOString();
      await insertRow("message_jobs", { source_type: "inspection_report", source_id: String(selected.id), channel: "sms", recipient: to, message: text, payload: { type: "inspection_report", vendor: data.vendor, author, date: selected.작성일, keyman: data.keymanName }, status: "sent", scheduled_at: now, sent_at: now, created_by: author }).catch(() => undefined);
      setSent((cur) => new Map(cur).set(String(selected.id), now));
      notify(`${data.vendor}에 리포트를 보냈습니다`, "success");
    } catch (e) { notify(`발송 실패: ${(e as Error).message}`, "error"); }
    finally { setBusy(""); }
  };

  const PILL = (on: boolean) => `rounded-full px-3 py-1.5 text-[12px] font-black transition ${on ? "bg-slate-900 text-white" : "bg-white text-slate-500 hover:text-slate-900 border border-slate-200"}`;
  return <div className="space-y-4">
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-start justify-between gap-3 bg-[#1E252F] px-5 py-4">
        <div className="min-w-0"><div className="text-[11px] font-black text-slate-400">방문 후 · 고객 전달</div><div className="text-lg font-black text-white">점검 리포트</div><div className="mt-0.5 text-[12px] font-semibold text-slate-400">점검 양식이 그대로 고객용 리포트 이미지가 됩니다. 점검 간 곳을 고르고 [리포트 발송]</div></div>
        {switcher}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <button type="button" onClick={() => setMine(true)} className={PILL(mine)}>내 점검</button>
        <button type="button" onClick={() => setMine(false)} className={PILL(!mine)}>전체</button>
        <span className="mx-1 h-4 w-px bg-slate-200" />
        <button type="button" onClick={() => setDays(30)} className={PILL(days === 30)}>최근 30일</button>
        <button type="button" onClick={() => setDays(90)} className={PILL(days === 90)}>90일</button>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="업체·기종 검색" className="ml-auto w-full rounded-full border border-slate-200 px-3 py-1.5 text-[12px] font-semibold outline-none focus:border-slate-400 sm:w-48" />
        <button type="button" onClick={() => void load()} title="다시 읽기" className="rounded-full border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50"><RefreshCw size={14} /></button>
      </div>
    </section>

    <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-2.5 text-[11px] font-black text-slate-400">점검 {filtered.length}건{loading ? " · 불러오는 중…" : ""}</div>
        <div className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
          {!loading && !filtered.length && <div className="px-4 py-10 text-center text-[12px] font-semibold text-slate-400">기간 안에 점검 기록이 없습니다</div>}
          {filtered.map((r) => { const on = r.id === selectedId; const s = sent.get(String(r.id)); return <button key={r.id} type="button" onClick={() => setSelectedId(r.id)} className={`block w-full px-4 py-2.5 text-left transition ${on ? "bg-slate-900 text-white" : "hover:bg-slate-50"}`}>
            <div className="flex items-center justify-between gap-2"><span className={`text-[11px] font-bold tabular-nums ${on ? "text-slate-300" : "text-slate-400"}`}>{r.작성일}{!mine && r.작성자 ? ` · ${r.작성자}` : ""}</span>{s && <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${on ? "bg-white/20 text-white" : "bg-emerald-50 text-emerald-700"}`}>발송됨 {shortDate(s.slice(0, 10))}</span>}</div>
            <div className="mt-0.5 truncate text-[13px] font-black">{r.업체명}</div>
            <div className={`truncate text-[11px] font-semibold ${on ? "text-slate-300" : "text-slate-500"}`}>{r.모델명 || "기종 미기재"}{r.자산기번 ? ` · ${r.자산기번}` : ""}</div>
          </button>; })}
        </div>
      </section>

      <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {!selected || !data ? <div className="px-4 py-16 text-center text-[13px] font-semibold text-slate-400">왼쪽에서 점검 간 곳을 고르면 리포트가 여기 만들어집니다</div> : <>
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
            <label className="flex items-center gap-2 text-[12px] font-bold text-slate-600">받는 번호<input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="키맨 휴대폰" className="w-40 rounded-full border border-slate-200 px-3 py-1.5 text-[12px] font-semibold tabular-nums outline-none focus:border-slate-400" /></label>
            {data.keymanName && <span className="text-[12px] font-semibold text-slate-400">{data.keymanName}</span>}
            {!data.keymanPhone && <span className="text-[11px] font-bold text-rose-600">양식에 휴대폰 번호가 없어 직접 넣어야 합니다</span>}
            <div className="ml-auto flex gap-2">
              <button type="button" disabled={!!busy} onClick={() => void showPreview()} className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3.5 py-2 text-[12px] font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"><ImageIcon size={14} />이미지 미리보기</button>
              <button type="button" disabled={!!busy} onClick={() => void send()} className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-2 text-[12px] font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 disabled:opacity-50"><Send size={14} />{busy || "리포트 발송"}</button>
            </div>
          </div>
          {prev && <div className="border-b border-slate-100 bg-slate-50 px-4 py-1.5 text-[11px] font-semibold text-slate-500">직전 점검 {prev.date} 기록과 비교해 사용량 증가분을 넣었습니다</div>}
          <div className="overflow-x-auto bg-slate-100 p-4"><ReportCard data={data} prev={prev?.data || null} prevDate={prev?.date || ""} date={selected.작성일} author={selected.작성자 || author} qr={qr} cardRef={cardRef} /></div>
        </>}
      </section>
    </div>

    {preview && <div className="fixed inset-0 z-[2400] flex items-center justify-center bg-black/60 p-4" onMouseDown={() => setPreview(null)}>
      <div className="max-h-[92vh] w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-[#1E252F] px-4 py-3 text-white"><div className="text-[13px] font-black">문자로 가는 이미지 그대로 · {preview.kb}KB</div><button type="button" onClick={() => setPreview(null)} className="rounded-full px-2 py-1 text-[12px] font-bold text-slate-300 hover:text-white">닫기</button></div>
        <div className="max-h-[80vh] overflow-y-auto bg-slate-200 p-3"><img src={preview.src} alt="리포트 미리보기" className="mx-auto block w-full rounded-lg" /></div>
      </div>
    </div>}
  </div>;
}
