/**
 * 고객 리포트 — "이렇게까지 관리해?"를 만드는 대외용 서비스 리포트.
 * 전 업체 대상(접수 없어도 생성), 기간은 월간·분기·반기·연간.
 * A4 비율 1~2장, 내용이 장 경계에서 잘리지 않게 행 수 기준으로 분할.
 * [PNG 저장]으로 장마다 이미지 파일, [인쇄]로 브라우저 PDF 저장.
 * 발송(문자 MMS·메일)은 2단계 — 지금은 생성·저장까지.
 */
import { useMemo, useState } from "react";
import { Download, FileImage, Printer, Search } from "lucide-react";
import { selectRows } from "./supabase";
import { vendorMatchKey } from "./ids";
import { notify } from "./toast";

type PeriodKind = "month" | "quarter" | "half" | "year";
type ServiceRow = { date: string; kind: string; device: string; desc: string; result: string };
type ReportData = {
  vendor: string;
  periodLabel: string;
  rows: ServiceRow[];
  counts: { as: number; remote: number; it: number; inspection: number };
  devices: { mfp: number; pc: number; monitor: number; etc: number };
  deviceList: string[];
  lastInspection: string;
};

const PERIOD_OPTIONS: Array<{ key: PeriodKind; label: string }> = [
  { key: "month", label: "월간" }, { key: "quarter", label: "분기" }, { key: "half", label: "반기" }, { key: "year", label: "연간" },
];

function periodRange(kind: PeriodKind, anchor: string): { start: string; end: string; label: string } {
  const [y, m] = anchor.split("-").map(Number);
  const end = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
  if (kind === "month") return { start: `${anchor}-01`, end: end(y, m), label: `${y}년 ${m}월` };
  if (kind === "quarter") {
    const q = Math.floor((m - 1) / 3) + 1;
    const sm = (q - 1) * 3 + 1;
    return { start: `${y}-${String(sm).padStart(2, "0")}-01`, end: end(y, sm + 2), label: `${y}년 ${q}분기` };
  }
  if (kind === "half") {
    const first = m <= 6;
    return { start: `${y}-${first ? "01" : "07"}-01`, end: end(y, first ? 6 : 12), label: `${y}년 ${first ? "상반기" : "하반기"}` };
  }
  return { start: `${y}-01-01`, end: `${y}-12-31`, label: `${y}년` };
}

// FIELD 보고 전문에서 처리내용 줄만 뽑는다 — 리포트에는 결과 한 줄이면 충분
function handledLine(note: string) {
  const match = String(note || "").match(/처리내용\s*[:：]\s*([^\n]+)/);
  return match ? match[1].trim().slice(0, 40) : "";
}

const KIND_LABEL: Record<string, string> = { "복합기 AS": "AS 방문", "원격이관": "원격 지원", "IT": "IT 지원" };

export default function CustomerReport({ author }: { author: string }) {
  void author;
  const today = new Date();
  const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 15);
  const [periodKind, setPeriodKind] = useState<PeriodKind>("month");
  const [anchor, setAnchor] = useState(`${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const range = useMemo(() => periodRange(periodKind, anchor), [periodKind, anchor]);

  const search = async () => {
    const q = query.trim();
    if (q.length < 2) { notify("업체명을 2글자 이상 입력해 주세요.", "error"); return; }
    setSearching(true);
    try {
      const rows = await selectRows<{ "_업체명": string }>(
        "vendor_info", `select=${encodeURIComponent("_업체명")}&${encodeURIComponent("_업체명")}=ilike.*${encodeURIComponent(q)}*&${encodeURIComponent("임대여부")}=eq.${encodeURIComponent("임대중")}&_hidden=not.is.true&limit=400`,
      );
      const unique = Array.from(new Set(rows.map((r) => String(r["_업체명"] || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko"));
      setHits(unique.slice(0, 40));
      if (!unique.length) notify("임대중 기기가 있는 업체 중에 없습니다 — 이름을 줄여서 검색해 보세요.", "error");
    } catch (e) {
      notify(`검색 실패: ${(e as Error).message}`, "error");
    } finally { setSearching(false); }
  };

  const build = async (vendorName: string) => {
    setLoading(true);
    setReport(null);
    try {
      const key = vendorMatchKey(vendorName);
      const core = encodeURIComponent(vendorName.slice(0, 12));
      const nameCol = encodeURIComponent("_업체명");
      // ① 기기 현황 (임대중)
      const deviceRows = await selectRows<Record<string, string>>(
        "vendor_info", `select=${encodeURIComponent("품목,모델명,기종,자산번호,임대여부,_업체명")}&${nameCol}=eq.${encodeURIComponent(vendorName)}&_hidden=not.is.true&limit=500`,
      );
      const active = deviceRows.filter((r) => r["임대여부"] === "임대중");
      const devices = { mfp: 0, pc: 0, monitor: 0, etc: 0 };
      const deviceList: string[] = [];
      for (const r of active) {
        const item = String(r["품목"] || "");
        if (/복합기|프린터|플로터/.test(item)) { devices.mfp += 1; deviceList.push(`${r["모델명"] || r["기종"] || "복합기"}${r["자산번호"] ? ` (${r["자산번호"]})` : ""}`); }
        else if (/모니터/i.test(item)) devices.monitor += 1;
        else if (/pc|데스크|노트북|태블릿|소프트웨어/i.test(item)) devices.pc += 1;
        else devices.etc += 1;
      }
      // ② 기간 내 접수 (AS·원격·IT)
      const receptions = (await selectRows<Record<string, unknown>>(
        "service_receptions", `select=id,receipt_date,type,vendor,model,serial,asset_no,symptom,status&vendor=ilike.*${core}*&deleted=not.is.true&receipt_date=gte.${range.start}&receipt_date=lte.${range.end}&limit=200`,
      ).catch(() => [])).filter((r) => vendorMatchKey(String(r.vendor || "")) === key);
      // 처리내용: 접수에 연결된 일정의 note(FIELD 전송 양식)에서
      const ids = receptions.map((r) => String(r.id));
      const notes = ids.length ? await selectRows<{ receptionId: string; note: string }>(
        "as_tickets", `select=receptionId,note&receptionId=in.(${ids.map((i) => `"${i}"`).join(",")})&limit=200`,
      ).catch(() => [] as Array<{ receptionId: string; note: string }>) : [];
      const noteOf = new Map(notes.map((n) => [n.receptionId, n.note] as const));
      // ③ 기간 내 점검 방문
      const inspections = (await selectRows<Record<string, unknown>>(
        "jeomgeom", `select=${encodeURIComponent("작성일,_업체명,모델명,자산기번,처리내용")}&${nameCol}=ilike.*${core}*&_hidden=not.is.true&${encodeURIComponent("작성일")}=gte.${range.start}&${encodeURIComponent("작성일")}=lte.${range.end}&limit=200`,
      ).catch(() => [])).filter((r) => vendorMatchKey(String(r["_업체명"] || "")) === key);

      const rows: ServiceRow[] = [
        ...receptions.map((r) => ({
          date: String(r.receipt_date || ""),
          kind: KIND_LABEL[String(r.type || "")] || String(r.type || ""),
          device: [String(r.model || ""), String(r.asset_no || r.serial || "")].filter(Boolean).join(" · "),
          desc: String(r.symptom || "").slice(0, 34),
          result: handledLine(String(noteOf.get(String(r.id)) || "")) || (String(r.status) === "완료" || String(r.status) === "전송완료" ? "처리 완료" : "진행 중"),
        })),
        ...inspections.map((r) => ({
          date: String(r["작성일"] || "").slice(0, 10),
          kind: "정기 점검",
          device: [String(r["모델명"] || ""), String(r["자산기번"] || "")].filter(Boolean).join(" · "),
          desc: "정기 방문 점검",
          result: String(r["처리내용"] || "점검 완료").slice(0, 40),
        })),
      ].sort((a, b) => a.date.localeCompare(b.date));

      const lastAll = (await selectRows<Record<string, unknown>>(
        "jeomgeom", `select=${encodeURIComponent("작성일,_업체명")}&${nameCol}=ilike.*${core}*&_hidden=not.is.true&order=${encodeURIComponent("작성일")}.desc&limit=20`,
      ).catch(() => [])).filter((r) => vendorMatchKey(String(r["_업체명"] || "")) === key);

      setReport({
        vendor: vendorName,
        periodLabel: range.label,
        rows,
        counts: {
          as: receptions.filter((r) => r.type === "복합기 AS").length,
          remote: receptions.filter((r) => r.type === "원격이관").length,
          it: receptions.filter((r) => r.type === "IT").length,
          inspection: inspections.length,
        },
        devices, deviceList,
        lastInspection: String(lastAll[0]?.["작성일"] || "").slice(0, 10),
      });
      setHits([]);
    } catch (e) {
      notify(`리포트 생성 실패: ${(e as Error).message}`, "error");
    } finally { setLoading(false); }
  };

  // ── 장 나누기: 1장에 요약+내역 10행까지, 넘치면 2장(최대 24행), 그 이상은 "외 n건" ──
  const PAGE1_ROWS = 10;
  const PAGE2_ROWS = 14;
  const page1Rows = report ? report.rows.slice(0, PAGE1_ROWS) : [];
  const page2Rows = report ? report.rows.slice(PAGE1_ROWS, PAGE1_ROWS + PAGE2_ROWS) : [];
  const overflow = report ? Math.max(0, report.rows.length - PAGE1_ROWS - PAGE2_ROWS) : 0;

  const savePng = async () => {
    if (!report) return;
    setSaving(true);
    try {
      const { default: html2canvas } = await import("html2canvas");
      const pages = Array.from(document.querySelectorAll<HTMLElement>(".report-page"));
      for (let i = 0; i < pages.length; i += 1) {
        const canvas = await html2canvas(pages[i], { scale: 2, backgroundColor: "#ffffff" });
        const link = document.createElement("a");
        link.download = `${report.vendor}_${report.periodLabel}_${i + 1}.png`.replace(/\s+/g, "");
        link.href = canvas.toDataURL("image/png");
        link.click();
      }
      notify(`리포트 이미지 ${pages.length}장 저장 완료 ✓`, "success");
    } catch (e) {
      notify(`이미지 저장 실패: ${(e as Error).message}`, "error");
    } finally { setSaving(false); }
  };

  const totalServices = report ? report.counts.as + report.counts.remote + report.counts.it + report.counts.inspection : 0;

  const summaryCells = report ? [
    ["정기 점검", report.counts.inspection], ["AS 방문", report.counts.as], ["원격 지원", report.counts.remote + report.counts.it], ["관리 기기", report.devices.mfp + report.devices.pc + report.devices.monitor + report.devices.etc],
  ] as const : [];

  return (
    <div className="space-y-4 pb-10">
      <style>{`@media print { body * { visibility: hidden; } .report-print-area, .report-print-area * { visibility: visible; } .report-print-area { position: absolute; left: 0; top: 0; } .report-page { page-break-after: always; box-shadow: none !important; margin: 0 !important; } }`}</style>

      <section className="rounded-xl bg-[#1E252F] px-5 py-4 text-white shadow-sm">
        <div className="text-[15px] font-black">고객 리포트</div>
        <div className="mt-0.5 text-[11px] font-semibold text-slate-400">전 업체 대상 — 접수가 없어도 "잘 관리되고 있다"는 리포트가 나갑니다. 이미지로 저장해 발송하세요.</div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-full bg-white/10 p-1">
            {PERIOD_OPTIONS.map(({ key, label }) => (
              <button key={key} type="button" onClick={() => setPeriodKind(key)} className={`rounded-full px-3 py-1.5 text-xs font-black transition ${periodKind === key ? "bg-white text-slate-950" : "text-slate-400 hover:text-white"}`}>{label}</button>
            ))}
          </div>
          <input type="month" value={anchor} onChange={(e) => e.target.value && setAnchor(e.target.value)} className="rounded-lg border border-white/15 bg-white/10 px-2 py-2 text-xs font-black text-white outline-none" />
          <span className="rounded-full bg-blue-600/25 px-3 py-1.5 text-xs font-black text-blue-200">{range.label} · {range.start} ~ {range.end}</span>
        </div>
        <div className="relative mt-2 flex max-w-xl gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }} placeholder="업체명 검색 (임대중 기기 보유 업체)"
            className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-bold text-white outline-none placeholder:text-slate-500 focus:border-blue-400" />
          <button type="button" onClick={() => void search()} disabled={searching} className="flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-2 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-40"><Search size={15} />{searching ? "검색 중" : "검색"}</button>
          {hits.length > 0 && (
            <div className="absolute left-0 right-0 top-11 z-30 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl">
              {hits.map((name) => (
                <button key={name} type="button" onClick={() => void build(name)} className="block w-full border-b border-slate-100 px-3 py-2.5 text-left text-sm font-bold text-slate-800 last:border-0 hover:bg-blue-50">{name}</button>
              ))}
            </div>
          )}
        </div>
      </section>

      {loading && <div className="rounded-xl border border-slate-200 bg-white py-16 text-center text-sm font-bold text-slate-400">리포트를 만드는 중…</div>}

      {report && !loading && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void savePng()} disabled={saving} className="flex items-center gap-1.5 rounded-full bg-slate-900 px-4 py-2 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-40"><FileImage size={15} />{saving ? "저장 중…" : "PNG 저장 (장별)"}</button>
            <button type="button" onClick={() => window.print()} className="flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-50"><Printer size={15} />인쇄 / PDF</button>
            <span className="text-xs font-bold text-slate-400"><Download size={12} className="mr-1 inline" />저장한 이미지를 문자·메일로 보내세요 (자동 발송은 2단계 예정)</span>
          </div>

          <div className="report-print-area space-y-5">
            {/* ─── 1장 ─── */}
            <div className="report-page mx-auto w-[794px] max-w-full overflow-hidden rounded-sm bg-white text-slate-900 shadow-lg" style={{ minHeight: 1050 }}>
              <div className="bg-[#1E252F] px-10 pb-7 pt-8 text-white">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[11px] font-black tracking-[0.22em] text-blue-300">FIRST OA · SERVICE REPORT</div>
                    <div className="mt-2 text-[26px] font-black leading-tight">{report.periodLabel} 서비스 리포트</div>
                    <div className="mt-1 text-sm font-bold text-slate-300">{report.vendor} 귀중</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-black">퍼스트전산</div>
                    <div className="mt-0.5 text-[11px] font-semibold text-slate-400">사무기기 · IT 통합 관리</div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-4 divide-x divide-slate-200 border-b border-slate-200 bg-slate-50">
                {summaryCells.map(([label, value]) => (
                  <div key={label} className="px-6 py-5 text-center">
                    <div className="text-[28px] font-black leading-none text-slate-950" style={{ fontVariantNumeric: "tabular-nums" }}>{value}<span className="text-sm font-bold text-slate-400">{label === "관리 기기" ? "대" : "회"}</span></div>
                    <div className="mt-1.5 text-[11px] font-black text-slate-500">{label}</div>
                  </div>
                ))}
              </div>

              <div className="px-10 py-7">
                <div className="text-[13px] font-black text-slate-950">■ {report.periodLabel} 서비스 내역</div>
                {page1Rows.length ? (
                  <table className="mt-3 w-full text-left text-[12px]">
                    <thead><tr className="border-b-2 border-slate-900 text-[11px] font-black text-slate-500">
                      <th className="py-2 pr-3">날짜</th><th className="py-2 pr-3">구분</th><th className="py-2 pr-3">기기</th><th className="py-2 pr-3">요청 내용</th><th className="py-2">처리</th>
                    </tr></thead>
                    <tbody>
                      {page1Rows.map((row, i) => (
                        <tr key={i} className="border-b border-slate-100">
                          <td className="whitespace-nowrap py-2.5 pr-3 font-bold" style={{ fontVariantNumeric: "tabular-nums" }}>{row.date.slice(5).replace("-", "/")}</td>
                          <td className="whitespace-nowrap py-2.5 pr-3"><span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${row.kind === "정기 점검" ? "bg-emerald-50 text-emerald-700" : row.kind === "원격 지원" || row.kind === "IT 지원" ? "bg-indigo-50 text-indigo-700" : "bg-blue-50 text-blue-700"}`}>{row.kind}</span></td>
                          <td className="max-w-[150px] truncate py-2.5 pr-3 font-semibold text-slate-600">{row.device || "-"}</td>
                          <td className="max-w-[170px] truncate py-2.5 pr-3 font-semibold text-slate-600">{row.desc || "-"}</td>
                          <td className="max-w-[160px] truncate py-2.5 font-bold text-slate-800">{row.result}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-6 text-center">
                    <div className="text-sm font-black text-emerald-800">이 기간 동안 장애·요청 없이 안정적으로 운영되었습니다 ✓</div>
                    <div className="mt-1 text-[11px] font-semibold text-emerald-700">{report.lastInspection ? `최근 정기 점검일 ${report.lastInspection} — 다음 분기에도 방문 점검으로 관리해 드립니다.` : "정기 점검 일정에 맞춰 방문 관리해 드리고 있습니다."}</div>
                  </div>
                )}
                {report.rows.length > PAGE1_ROWS && <div className="mt-2 text-right text-[11px] font-bold text-slate-400">계속 → 2장</div>}

                <div className="mt-7 text-[13px] font-black text-slate-950">■ 관리 중인 장비</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {report.devices.mfp > 0 && <span className="rounded-lg bg-slate-100 px-3 py-2 text-[12px] font-black text-slate-800">복합기 {report.devices.mfp}대</span>}
                  {report.devices.pc > 0 && <span className="rounded-lg bg-slate-100 px-3 py-2 text-[12px] font-black text-slate-800">PC·노트북 {report.devices.pc}대</span>}
                  {report.devices.monitor > 0 && <span className="rounded-lg bg-slate-100 px-3 py-2 text-[12px] font-black text-slate-800">모니터 {report.devices.monitor}대</span>}
                  {report.devices.etc > 0 && <span className="rounded-lg bg-slate-100 px-3 py-2 text-[12px] font-black text-slate-800">기타 {report.devices.etc}대</span>}
                  {report.deviceList.slice(0, 3).map((d) => <span key={d} className="rounded-lg border border-slate-200 px-3 py-2 text-[11px] font-semibold text-slate-500">{d}</span>)}
                </div>
              </div>

              <div className="mt-auto px-10 pb-8">
                <div className="rounded-xl bg-gradient-to-r from-[#1E252F] to-[#2b3a52] px-6 py-5 text-white">
                  <div className="text-[12px] font-black text-blue-300">퍼스트전산이 함께합니다</div>
                  <div className="mt-1.5 text-[13px] font-bold leading-6">복합기·프린터 렌탈 <span className="text-slate-400">|</span> PC·모니터·소프트웨어 <span className="text-slate-400">|</span> 입·퇴사자 IT 셋업 <span className="text-slate-400">|</span> 정기 방문 점검</div>
                  <div className="mt-1 text-[11px] font-semibold text-slate-400">사무실 IT의 모든 것 — 필요하실 때 담당자에게 말씀만 주세요. 대표번호 02-000-0000</div>
                </div>
                <div className="mt-3 text-center text-[10px] font-semibold text-slate-400">본 리포트는 {report.periodLabel} 서비스 기록을 바탕으로 자동 작성되었습니다 · 퍼스트전산</div>
              </div>
            </div>

            {/* ─── 2장 (내역이 넘칠 때만) ─── */}
            {page2Rows.length > 0 && (
              <div className="report-page mx-auto w-[794px] max-w-full overflow-hidden rounded-sm bg-white text-slate-900 shadow-lg" style={{ minHeight: 1050 }}>
                <div className="flex items-center justify-between bg-[#1E252F] px-10 py-5 text-white">
                  <div className="text-sm font-black">{report.periodLabel} 서비스 내역 (계속) — {report.vendor}</div>
                  <div className="text-[11px] font-semibold text-slate-400">퍼스트전산 · 2/2</div>
                </div>
                <div className="px-10 py-7">
                  <table className="w-full text-left text-[12px]">
                    <thead><tr className="border-b-2 border-slate-900 text-[11px] font-black text-slate-500">
                      <th className="py-2 pr-3">날짜</th><th className="py-2 pr-3">구분</th><th className="py-2 pr-3">기기</th><th className="py-2 pr-3">요청 내용</th><th className="py-2">처리</th>
                    </tr></thead>
                    <tbody>
                      {page2Rows.map((row, i) => (
                        <tr key={i} className="border-b border-slate-100">
                          <td className="whitespace-nowrap py-2.5 pr-3 font-bold" style={{ fontVariantNumeric: "tabular-nums" }}>{row.date.slice(5).replace("-", "/")}</td>
                          <td className="whitespace-nowrap py-2.5 pr-3"><span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${row.kind === "정기 점검" ? "bg-emerald-50 text-emerald-700" : row.kind === "원격 지원" || row.kind === "IT 지원" ? "bg-indigo-50 text-indigo-700" : "bg-blue-50 text-blue-700"}`}>{row.kind}</span></td>
                          <td className="max-w-[150px] truncate py-2.5 pr-3 font-semibold text-slate-600">{row.device || "-"}</td>
                          <td className="max-w-[170px] truncate py-2.5 pr-3 font-semibold text-slate-600">{row.desc || "-"}</td>
                          <td className="max-w-[160px] truncate py-2.5 font-bold text-slate-800">{row.result}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {overflow > 0 && <div className="mt-3 text-[11px] font-bold text-slate-400">외 {overflow}건 — 상세 내역은 담당자에게 문의해 주세요.</div>}
                </div>
              </div>
            )}
          </div>

          <div className="mx-auto max-w-[794px] rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] font-bold text-amber-800">
            발송 전 확인: 업체명·기간·건수({totalServices}회)가 맞는지 훑어보고 저장하세요. 자동 발송(문자 MMS·메일)과 수신자 관리는 2단계로 만들 예정입니다.
          </div>
        </>
      )}

      {!report && !loading && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center">
          <div className="text-sm font-black text-slate-500">기간을 고르고 업체를 검색하면 리포트가 만들어집니다</div>
          <div className="mt-1 text-xs font-semibold text-slate-400">접수가 없는 업체도 "안정 운영 + 정기 점검" 리포트가 나갑니다 — 전 업체 대상</div>
        </div>
      )}
    </div>
  );
}
