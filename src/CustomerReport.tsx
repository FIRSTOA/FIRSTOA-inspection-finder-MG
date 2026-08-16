/**
 * 고객 리포트 — "이렇게까지 관리해?"를 만드는 대외용 서비스 리포트.
 * 전 업체 대상(접수 없어도 생성), 기간은 월간·분기·반기·연간.
 * A4 비율 1~2장, 내용이 장 경계에서 잘리지 않게 행 수 기준으로 분할.
 * [PNG 저장]으로 장마다 이미지 파일, [인쇄]로 브라우저 PDF 저장.
 * 발송(문자 MMS·메일)은 2단계 — 지금은 생성·저장까지.
 */
import { useMemo, useState } from "react";
import { Download, FileImage, Laptop, Monitor, Package, Printer, Search, UserPlus, Wind } from "lucide-react";
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
  deviceTotal: number;
  catCounts: Array<{ label: string; count: number }>; // 품목별 대수 (컬러복합기·데스크탑·모니터…)
  deviceDetail: Array<{ cat: string; maker: string; model: string; asset: string }>; // 상세: 품목·브랜드·기종·자산기번
  sinceYear: number | null; // 첫 계약 연도 — "20XX년부터 함께" 감사 문구용
  lastInspection: string;
};

// 품목명 표기 정리 + 아이콘 — 리포트 '관리 중인 장비'에서 품목별 대수로 보여준다 (기종 나열은 안 함)
function normalizeCat(item: string) {
  const t = item.trim();
  if (/^pc모니터$/i.test(t)) return "PC모니터";
  if (/^태블릿pc$/i.test(t)) return "태블릿PC";
  return t || "기타";
}
function catIcon(label: string) {
  if (/복합기|프린터|플로터/.test(label)) return Printer;
  if (/노트북|태블릿/.test(label)) return Laptop;
  if (/모니터|데스크탑|소프트웨어|유지보수/.test(label)) return Monitor;
  if (/공기청정기/.test(label)) return Wind;
  return Package;
}

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
        "vendor_info", `select=${encodeURIComponent("품목,제조사,모델명,기종,자산번호,임대여부,첫계약일,_업체명")}&${nameCol}=eq.${encodeURIComponent(vendorName)}&_hidden=not.is.true&limit=500`,
      );
      const active = deviceRows.filter((r) => r["임대여부"] === "임대중");
      const catMap = new Map<string, number>();
      for (const r of active) {
        const label = normalizeCat(String(r["품목"] || ""));
        catMap.set(label, (catMap.get(label) || 0) + 1);
      }
      const catCounts = Array.from(catMap.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
      // 상세 목록: 복합기·플로터 등 관리 핵심 장비 우선, 브랜드·기종·자산기번만 간결하게
      const deviceDetail = active
        .map((r) => ({ cat: normalizeCat(String(r["품목"] || "")), maker: String(r["제조사"] || "").trim(), model: String(r["모델명"] || r["기종"] || "").trim(), asset: String(r["자산번호"] || "").trim() }))
        .sort((a, b) => (/복합기|프린터|플로터/.test(b.cat) ? 1 : 0) - (/복합기|프린터|플로터/.test(a.cat) ? 1 : 0));
      // 함께한 기간: 임대리스트 첫계약일 중 가장 오래된 연도
      const sinceYear = (() => {
        const years = deviceRows.map((r) => Number(String(r["첫계약일"] || "").match(/(20\d{2})/)?.[1] || 0)).filter((y) => y >= 2000);
        return years.length ? Math.min(...years) : null;
      })();
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
        // 점검은 방문 한 번에 여러 대를 보므로 날짜별로 1행으로 묶고 기기 칸엔 대수만 (기기 나열은 의미 없음)
        ...(() => {
          const byDate = new Map<string, Array<Record<string, unknown>>>();
          for (const r of inspections) {
            const d = String(r["작성일"] || "").slice(0, 10);
            byDate.set(d, [...(byDate.get(d) || []), r]);
          }
          return Array.from(byDate.entries()).map(([d, group]) => ({
            date: d,
            kind: "정기 점검",
            device: `복합기 ${group.length}대`,
            desc: "정기 방문 점검",
            result: String(group[0]?.["처리내용"] || "점검 완료").slice(0, 40),
          }));
        })(),
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
        deviceTotal: active.length,
        catCounts, deviceDetail, sinceYear,
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
    ["정기 점검", report.counts.inspection], ["AS 방문", report.counts.as], ["원격 지원", report.counts.remote + report.counts.it], ["관리 기기", report.deviceTotal],
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

              {/* 감사 인사 — 리포트의 첫 문장은 숫자가 아니라 관계여야 한다 */}
              <div className="border-b border-slate-100 px-10 py-4 text-[12.5px] font-semibold leading-6 text-slate-600">
                {report.vendor} 담당자님, {report.sinceYear ? `${report.sinceYear}년부터 ${Math.max(1, new Date().getFullYear() - report.sinceYear + 1)}년째 ` : ""}저희 퍼스트전산을 믿고 맡겨 주셔서 진심으로 감사합니다.
                {" "}{report.periodLabel} 동안 함께한 서비스 내용을 정리해 전해 드립니다. 불편하셨던 점이나 필요하신 것이 있다면 언제든 담당자에게 편하게 말씀해 주세요.
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
                      <th className="py-2 pr-3">날짜</th><th className="py-2 pr-3">구분</th><th className="py-2 pr-3">기기</th><th className="py-2 pr-3">내용</th><th className="py-2">처리</th>
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

                <div className="mt-7 text-[13px] font-black text-slate-950">■ 관리 중인 장비 <span className="text-[11px] font-bold text-slate-400">총 {report.deviceTotal}대</span></div>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {report.catCounts.slice(0, 8).map(({ label, count }) => {
                    const Icon = catIcon(label);
                    return (
                      <div key={label} className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-blue-600 shadow-sm"><Icon size={16} /></span>
                        <span className="min-w-0">
                          <span className="block truncate text-[11px] font-black text-slate-700">{label}</span>
                          <span className="block text-[13px] font-black text-slate-950" style={{ fontVariantNumeric: "tabular-nums" }}>{count}대</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
                {report.catCounts.length > 8 && <div className="mt-1.5 text-[10px] font-bold text-slate-400">외 {report.catCounts.slice(8).reduce((s, c) => s + c.count, 0)}대</div>}
                {report.deviceDetail.length > 0 && (
                  <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
                    <table className="w-full text-left text-[11.5px]">
                      <thead><tr className="border-b border-slate-200 bg-slate-50 text-[10.5px] font-black text-slate-500">
                        <th className="px-3 py-1.5">품목</th><th className="px-3 py-1.5">브랜드</th><th className="px-3 py-1.5">기종</th><th className="px-3 py-1.5">자산기번</th>
                      </tr></thead>
                      <tbody>
                        {report.deviceDetail.slice(0, 8).map((d, i) => (
                          <tr key={i} className="border-b border-slate-100 last:border-0">
                            <td className="whitespace-nowrap px-3 py-1.5 font-bold text-slate-600">{d.cat}</td>
                            <td className="whitespace-nowrap px-3 py-1.5 font-semibold text-slate-600">{d.maker || "-"}</td>
                            <td className="max-w-[220px] truncate px-3 py-1.5 font-semibold text-slate-700">{d.model || "-"}</td>
                            <td className="whitespace-nowrap px-3 py-1.5 font-bold text-slate-800" style={{ fontVariantNumeric: "tabular-nums" }}>{d.asset || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {report.deviceDetail.length > 8 && <div className="border-t border-slate-100 px-3 py-1.5 text-[10px] font-bold text-slate-400">외 {report.deviceDetail.length - 8}대 — 전체 목록은 담당자에게 요청하시면 보내드립니다.</div>}
                  </div>
                )}
              </div>

              <div className="mt-auto px-10 pb-8">
                <div className="overflow-hidden rounded-xl bg-gradient-to-r from-[#1E252F] to-[#2b3a52] px-6 py-5 text-white">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <div className="text-[13px] font-black text-blue-300">사무실 IT의 모든 것, 퍼스트전산이 함께합니다</div>
                      <div className="mt-0.5 text-[11px] font-semibold text-slate-400">렌탈도 판매도 — 필요하실 때 담당자에게 말씀만 주세요 · 대표번호 1522-1093</div>
                    </div>
                  </div>
                  <div className="mt-3.5 grid grid-cols-3 gap-2">
                    {[
                      { icon: Printer, title: "복합기 · 프린터", desc: "렌탈 · 판매 · 유지보수" },
                      { icon: Monitor, title: "PC · 맥 · 모니터", desc: "렌탈 · 판매 · 사양 상담" },
                      { icon: UserPlus, title: "입·퇴사자 IT", desc: "계정·장비 셋업 · 회수 대행" },
                    ].map(({ icon: Icon, title, desc }) => (
                      <div key={title} className="flex items-center gap-3 rounded-lg bg-white/10 px-4 py-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500/25"><Icon size={17} className="text-blue-200" /></span>
                        <span>
                          <div className="text-[12px] font-black leading-4">{title}</div>
                          <div className="mt-0.5 text-[10px] font-semibold text-slate-400">{desc}</div>
                        </span>
                      </div>
                    ))}
                  </div>
                  {/* 취급 소프트웨어 — 제품이 눈에 보이게 워드마크풍 배지로 (로고 원본은 라이선스 문제로 안 씀) */}
                  <div className="mt-3 flex items-center gap-2 rounded-lg bg-black/20 px-4 py-2.5">
                    <span className="shrink-0 text-[10px] font-black text-slate-400">소프트웨어<br />설치·라이선스</span>
                    <div className="flex flex-1 flex-wrap items-center gap-1.5">
                      {[
                        { mark: "W", name: "Windows", bg: "#0078D4" },
                        { mark: "X", name: "Excel", bg: "#217346" },
                        { mark: "P", name: "PowerPoint", bg: "#D24726" },
                        { mark: "한", name: "한글·한컴오피스", bg: "#0E4A9E" },
                        { mark: "A", name: "AutoCAD", bg: "#C43C33" },
                        { mark: "Ps", name: "Photoshop", bg: "#001E36" },
                        { mark: "Ai", name: "Illustrator", bg: "#330000" },
                        { mark: "V3", name: "백신·보안", bg: "#1B7A43" },
                      ].map(({ mark, name, bg }) => (
                        <span key={name} className="flex items-center gap-1.5 rounded-md bg-white/[0.08] py-1 pl-1 pr-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded text-[9px] font-black text-white" style={{ background: bg }}>{mark}</span>
                          <span className="text-[10px] font-bold text-slate-200">{name}</span>
                        </span>
                      ))}
                      <span className="text-[10px] font-bold text-slate-400">외 업무용 SW 전반</span>
                    </div>
                  </div>
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
                      <th className="py-2 pr-3">날짜</th><th className="py-2 pr-3">구분</th><th className="py-2 pr-3">기기</th><th className="py-2 pr-3">내용</th><th className="py-2">처리</th>
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
