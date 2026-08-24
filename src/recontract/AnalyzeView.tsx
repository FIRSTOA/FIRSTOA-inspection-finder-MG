/**
 * 이카운트 분석 — 옛 재계약 웹앱(recontract_webapp)의 화면 구조를 그대로 옮긴 것.
 *
 * 입력: 이카운트 거래처관리대장 I 화면 전체 복사(Ctrl+A → Ctrl+C) → 붙여넣기 → 분석.
 * 프로그램 설치·자동 로그인 없이 전 직원이 쓸 수 있는 경로다.
 *
 * 화면 순서(원본 구조 + 사용자 확정 수정):
 *   다크 히어로(핵심 판단) → 판정 배지 → 핵심 지표(매출·총 사용량·활용률·초과·미수) →
 *   계약 이력(적요) → 월별 상세 표(사용·초과 종류/매수/금액·청구·수금) →
 *   거래처 이력(특이사항·불만·미수·AS·지난 협상 — 업체명으로 자동 조회, 플랜 판단에도 반영) →
 *   추천 플랜 A/B/C → 위험 플래그/권한 밖 → 원문 그대로 보기(적요·대장 전체)
 * 시나리오·추이 차트는 사용자 요청으로 뺐다(scenario.ts 엔진은 보존).
 *
 * 분석 결과는 이 기기(localStorage)에 남아 거래처 카드 목록으로 쌓인다.
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ClipboardPaste, TrendingUp, Trash2, X } from "lucide-react";
import { notify } from "../toast";
import { getAsHistory, type AsHistoryEntry } from "../api";
import { getVendorFlagsBatch, type VendorWorkFlags } from "../vendorFlags";
import { vendorMatchKey } from "../ids";
import { analyzeLedger, type LedgerAnalysis } from "./ledger";
import { judge, type Judgement } from "./judge";
import { calcProposals, type ExtraSignals, type Proposal } from "./proposals";
import { fetchBriefing, type RcBriefing, type RcTarget } from "./api";

const STORE_KEY = "recontract_analyze_v1";   // { [vendor]: { raw, at } }

type Stored = Record<string, { raw: string; at: string }>;
type Analyzed = { vendor: string; at: string; raw: string; analysis: LedgerAnalysis; verdict: Judgement };

function loadStore(): Stored {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch { return {}; }
}
function saveStore(store: Stored) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* 용량 초과 등 — 무시 */ }
}

const money = (n: number) => Math.round(n).toLocaleString("ko-KR");
const man = (n: number) => (n / 10_000).toFixed(n >= 1_000_000 ? 0 : 1); // 만원

const DIFF_TONE: Record<string, string> = {
  쉬움: "bg-emerald-50 text-emerald-700", 보통: "bg-blue-50 text-blue-700",
  어려움: "bg-amber-50 text-amber-700", 매우어려움: "bg-red-50 text-red-700",
};

function Badge({ tone, children }: { tone: "gray" | "blue" | "amber" | "red" | "green"; children: React.ReactNode }) {
  const cls = { gray: "bg-slate-100 text-slate-700", blue: "bg-blue-50 text-blue-700", amber: "bg-amber-50 text-amber-800", red: "bg-red-50 text-red-700", green: "bg-emerald-50 text-emerald-700" }[tone];
  return <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${cls}`}>{children}</span>;
}

function KPI({ label, value, unit, sub, tone = "gray" }: { label: string; value: string | number; unit?: string; sub?: string; tone?: "gray" | "blue" | "amber" | "red" | "green" }) {
  const valueCls = { gray: "text-slate-900", blue: "text-blue-600", red: "text-red-600", amber: "text-amber-600", green: "text-emerald-600" }[tone];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-2xl font-bold ${valueCls}`}>{typeof value === "number" ? value.toLocaleString("ko-KR") : value}{!!unit && <span className="ml-1 text-sm font-normal text-slate-400">{unit}</span>}</div>
      {!!sub && <div className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{sub}</div>}
    </div>
  );
}

function ProposalCard({ proposal }: { proposal: Proposal }) {
  if (proposal.recommended) {
    return (
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 p-6 text-white">
        <div className="absolute right-0 top-0 h-32 w-32 -translate-y-16 translate-x-16 rounded-full bg-white/10" />
        <div className="relative">
          <div className="mb-3 flex items-center justify-between">
            <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-600">권장</span>
            <span className="text-xs text-blue-100">{proposal.termYears}년</span>
          </div>
          <h4 className="mb-2 text-xl font-bold">{proposal.label}</h4>
          {!!proposal.reason && <div className="mb-3 inline-block rounded border border-amber-200/40 bg-amber-300/30 px-2 py-0.5 text-[10px] font-medium text-amber-100">✦ {proposal.reason}</div>}
          <ul className="mb-4 space-y-1.5 text-xs leading-relaxed text-blue-50">{proposal.highlights.map((h) => <li key={h}>· {h}</li>)}</ul>
          <div className="space-y-1.5 rounded-xl bg-white/10 p-3 text-xs backdrop-blur">
            <div className="flex justify-between"><span className="text-blue-100">회사 매출</span><strong>{money(proposal.companyRevenue)}원</strong></div>
            <div className="flex justify-between"><span className="text-blue-100">혜택 비용</span><strong>{money(proposal.benefitValue)}원</strong></div>
            <div className="flex justify-between border-t border-white/20 pt-1.5"><span className="text-blue-100">회사 ROI</span><strong className="text-sm text-amber-300">×{proposal.companyROI}</strong></div>
          </div>
          <div className="mt-3 text-[11px] leading-relaxed text-blue-100">{proposal.note}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="mb-3 flex items-center justify-between">
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{proposal.rank}안</span>
        <span className="text-xs text-slate-400">{proposal.termYears}년</span>
      </div>
      <h4 className="mb-2 text-lg font-bold text-slate-900">{proposal.label}</h4>
      {!!proposal.reason && <div className="mb-3 inline-block rounded bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-500">{proposal.reason}</div>}
      <ul className="mb-4 space-y-1.5 text-xs leading-relaxed text-slate-600">{proposal.highlights.map((h) => <li key={h}>· {h}</li>)}</ul>
      <div className="space-y-1.5 rounded-xl bg-slate-50 p-3 text-xs">
        <div className="flex justify-between"><span className="text-slate-500">회사 매출</span><strong className="text-slate-900">{money(proposal.companyRevenue)}원</strong></div>
        <div className="flex justify-between"><span className="text-slate-500">혜택 비용</span><strong className="text-slate-900">{money(proposal.benefitValue)}원</strong></div>
        <div className="flex justify-between border-t border-slate-200 pt-1.5"><span className="text-slate-500">회사 ROI</span><strong className="text-blue-600">×{proposal.companyROI}</strong></div>
      </div>
    </div>
  );
}

// ─── 상세 (원본 InternalView 구조) ──────────────────────────────────────────

function DetailView({ item, onBack, onRemove }: { item: Analyzed; onBack: () => void; onRemove: () => void }) {
  const { analysis, verdict } = item;
  const overCount = analysis.usage.reduce((sum, stat) => sum + stat.초과월수, 0);
  const 미납실질 = analysis.payment.미납월.filter((ym) => ym !== analysis.months[analysis.months.length - 1]?.ym).length;
  const current = analysis.현재계약;

  // 대장 밖 이력 — 업체명으로 AS·불만·미수·초과·특이사항·지난 협상을 자동으로 불러온다
  const [briefing, setBriefing] = useState<RcBriefing | null>(null);
  const [asHistory, setAsHistory] = useState<AsHistoryEntry[]>([]);
  const [flags, setFlags] = useState<VendorWorkFlags | null>(null);
  useEffect(() => {
    let alive = true;
    const pseudo = { key: vendorMatchKey(item.vendor), vendor: item.vendor } as unknown as RcTarget;
    fetchBriefing(pseudo).then((r) => { if (alive) setBriefing(r); }).catch(() => undefined);
    getAsHistory(item.vendor, "").then((r) => { if (alive) setAsHistory(r); }).catch(() => undefined);
    getVendorFlagsBatch([item.vendor]).then((m) => { if (alive) setFlags(m.get(item.vendor) || null); }).catch(() => undefined);
    return () => { alive = false; };
  }, [item.vendor]);

  // 불러온 이력이 플랜 판단에도 반영된다 — 장비 이슈·불만 누적이면 A안이 바뀐다
  const extra = useMemo<ExtraSignals>(() => {
    const recentAs = asHistory[0]?.date || "";
    const days = recentAs ? Math.round((Date.now() - Date.parse(recentAs)) / 86_400_000) : 9999;
    return {
      complaintTotal: briefing?.bulman.length || 0,
      complaintSevere: (briefing?.bulman || []).filter((row) => /상|심각/.test(row["불만항목"] || "")).length,
      complaintDevice: (briefing?.bulman || []).some((row) => /장비|출력|하드웨어|기기|품질|소음|잼|프린트|토너|용지/.test(`${row["불만유형"]} ${row["불만내용"]}`)),
      asTotal: asHistory.length,
      asRecent: days <= 60,
    };
  }, [briefing, asHistory]);
  const proposals = useMemo(() => calcProposals(analysis, verdict, extra), [analysis, verdict, extra]);
  const recommended = proposals.find((p) => p.recommended)!;
  const note = flags?.note;

  // 기간 총 사용량 — 컬러(A4+A3)·흑백
  const totals = useMemo(() => {
    const sum = { 컬러: 0, 흑백: 0 };
    for (const month of analysis.months) {
      for (const counter of month.counters) {
        if (counter.kind === "흑백") sum.흑백 += counter.사용;
        else sum.컬러 += counter.사용;
      }
    }
    return sum;
  }, [analysis]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button type="button" onClick={onBack} className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900">
          <ChevronLeft size={15} /> 거래처 목록
        </button>
        <button type="button" onClick={onRemove} className="flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold text-slate-400 hover:bg-rose-50 hover:text-rose-600">
          <Trash2 size={13} /> 분석 삭제
        </button>
      </div>

      {/* 히어로 — 핵심 판단 한 줄 */}
      <section className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 p-6 text-white sm:p-8">
        <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">INTERNAL DASHBOARD</div>
        <h1 className="mb-3 text-2xl font-bold tracking-tight sm:text-3xl">{item.vendor}</h1>
        <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-300">
          <span>{current?.models[0] || analysis.months.length + "개월 대장"}</span>
          <span className="text-slate-600">·</span>
          <span>월 {money(analysis.billing.월기본료)}원</span>
          {!!current?.from && (<><span className="text-slate-600">·</span><span>{current.from} ~ {current.to}</span></>)}
        </div>
        <div className="rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur">
          <div className="mb-1.5 text-xs uppercase tracking-wider text-slate-300">핵심 판단</div>
          <div className="text-base leading-relaxed">
            <strong className="text-white">{verdict.거래관계} 거래처 ({verdict.거래연차}년)</strong> · {verdict.거래처유형} · 난이도 <strong>{verdict.난이도}</strong>
            {" → 1순위 "}<strong className="text-amber-300">{recommended.label}</strong>
          </div>
        </div>
      </section>

      {/* 판정 배지 줄 */}
      <div className="flex flex-wrap gap-2">
        <Badge tone="blue">관계 {verdict.거래관계} · {verdict.거래연차}년</Badge>
        <Badge tone="blue">유형 {verdict.거래처유형}</Badge>
        <Badge tone={["어려움", "매우어려움"].includes(verdict.난이도) ? "amber" : "gray"}>난이도 {verdict.난이도}</Badge>
        <Badge tone="gray">사용 {verdict.사용패턴}</Badge>
        <Badge tone={["많음", "매우많음"].includes(verdict.초과수준) ? "red" : "gray"}>초과 {verdict.초과수준}</Badge>
        <Badge tone={verdict.결제안정성 === "안정" ? "green" : "amber"}>결제 {verdict.결제안정성}</Badge>
      </div>

      {/* 핵심 지표 */}
      <section>
        <h2 className="mb-3 text-base font-bold text-slate-900">핵심 지표 <span className="ml-1 text-[11px] font-medium text-slate-400">대장 조회기간 {analysis.기간.from} ~ {analysis.기간.to}</span></h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <KPI label="누적 매출" value={man(analysis.누계.판매)} unit="만원" sub={`수금 ${man(analysis.누계.수금)}만원`} tone="blue" />
          <KPI label="컬러 총 사용" value={totals.컬러} unit="매"
            sub={`월평균 ${money(analysis.usage.find((u) => u.kind === "컬러")?.월평균 || 0)}매 · ${analysis.months.length}개월`} tone="blue" />
          <KPI label="흑백 총 사용" value={totals.흑백} unit="매"
            sub={`월평균 ${money(analysis.usage.find((u) => u.kind === "흑백")?.월평균 || 0)}매 · ${analysis.months.length}개월`} />
          <KPI label="컬러 활용률" value={verdict.컬러활용률} unit="%"
            sub={(() => { const c = analysis.usage.find((u) => u.kind === "컬러"); return c ? `평균 ${money(c.월평균)}매 / 기본 ${money(c.기본매수)}매` : ""; })()}
            tone={verdict.컬러활용률 >= 100 ? "red" : verdict.컬러활용률 >= 80 ? "amber" : "gray"} />
          <KPI label="초과료 누적" value={man(analysis.billing.초과청구합)} unit="만원" sub={`${overCount}회 발생`} tone={overCount >= 3 ? "amber" : "gray"} />
          <KPI label="미수 잔액" value={analysis.누계.잔액 === 0 ? "없음" : man(analysis.누계.잔액)} unit={analysis.누계.잔액 === 0 ? "" : "만원"}
            sub={`미납 ${미납실질}개월 · 수금 평균 ${analysis.payment.평균지연일}일`} tone={미납실질 > 0 ? "amber" : "green"} />
        </div>
      </section>

      {/* 계약 이력 (적요) */}
      {!!analysis.contracts.length && (
        <section className="rounded-2xl border border-slate-100 bg-white p-6">
          <h2 className="mb-4 text-base font-bold text-slate-900">계약 이력 <span className="ml-1 text-[11px] font-medium text-slate-400">적요에서 읽음 · 최근 먼저</span></h2>
          <div className="space-y-2">
            {analysis.contracts.map((note, index) => (
              <div key={`${note.from}-${index}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-slate-50 pb-2 last:border-0 last:pb-0">
                <span className="font-mono text-sm font-bold tabular-nums text-slate-700">{note.from || "?"} ~ {note.to || "?"}</span>
                {!!note.label && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">{note.label}</span>}
                {!!note.models.length && <span className="text-xs font-medium text-slate-600">{note.models.join(", ")}</span>}
                {!!note.월기본료 && <span className="text-xs font-bold text-slate-800">월 {money(note.월기본료)}원</span>}
                {!!note.컬러기본 && <span className="text-xs text-slate-500">컬 {note.컬러기본}/{note.컬러단가} · 흑 {note.흑백기본}/{note.흑백단가}</span>}
                {!!note.보증금 && <span className="text-xs text-slate-500">보증금 {money(note.보증금)}원</span>}
                {!!note.무상.length && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">{note.무상.join("·")} 무상</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 월별 상세 — 매달 얼마나 썼고, 초과가 무엇으로 몇 매·얼마인지 */}
      <section className="rounded-2xl border border-slate-100 bg-white p-6">
        <h2 className="mb-4 text-base font-bold text-slate-900">월별 상세 <span className="ml-1 text-[11px] font-medium text-slate-400">초과가 난 달은 붉게</span></h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3">월</th>
                <th className="py-2 pr-3 text-right">컬러 사용</th>
                <th className="py-2 pr-3 text-right">흑백 사용</th>
                <th className="py-2 pr-3">초과</th>
                <th className="py-2 pr-3 text-right">청구</th>
                <th className="py-2 text-right">수금</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {analysis.months.map((month) => {
                const color = month.counters.filter((c) => c.kind !== "흑백").reduce((sum, c) => sum + c.사용, 0);
                const bw = month.counters.filter((c) => c.kind === "흑백").reduce((sum, c) => sum + c.사용, 0);
                const hasOver = month.excesses.length > 0;
                return (
                  <tr key={month.ym} className={`border-b border-slate-50 last:border-0 ${hasOver ? "bg-red-50/60" : ""}`}>
                    <td className="py-2 pr-3 font-mono text-xs font-bold text-slate-600">{month.ym.replace("-", ".")}</td>
                    <td className="py-2 pr-3 text-right font-semibold text-slate-800">{money(color)}</td>
                    <td className="py-2 pr-3 text-right font-semibold text-slate-600">{money(bw)}</td>
                    <td className="py-2 pr-3">
                      {hasOver
                        ? month.excesses.map((excess, index) => (
                            <span key={index} className="mr-1 inline-block rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-bold text-red-700">
                              {excess.kind} {money(excess.초과)}매 · {money(excess.금액)}원
                            </span>
                          ))
                        : <span className="text-[11px] text-slate-300">—</span>}
                    </td>
                    <td className="py-2 pr-3 text-right font-semibold text-slate-800">{month.청구 ? money(month.청구) : <span className="text-slate-300">—</span>}</td>
                    <td className="py-2 text-right">
                      {month.수금
                        ? <span className="font-semibold text-emerald-600">{money(month.수금)}{month.지연일 >= 0 ? <span className="ml-1 text-[10px] text-slate-400">+{month.지연일}일</span> : null}</span>
                        : month.청구 ? <span className="text-[11px] font-bold text-amber-600">미수금</span> : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 font-bold text-slate-900">
                <td className="py-2 pr-3 text-xs">합계</td>
                <td className="py-2 pr-3 text-right">{money(totals.컬러)}</td>
                <td className="py-2 pr-3 text-right">{money(totals.흑백)}</td>
                <td className="py-2 pr-3 text-[11px] text-red-600">{overCount ? `${overCount}회 · ${money(analysis.billing.초과청구합)}원` : "없음"}</td>
                <td className="py-2 pr-3 text-right">{money(analysis.누계.판매)}</td>
                <td className="py-2 text-right">{money(analysis.누계.수금)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* 거래처 이력 — 업체명으로 자동 조회 (특이사항·불만·미수·AS·지난 협상) */}
      {!!note?.text && (
        <section className="rounded-2xl border border-violet-200 bg-violet-50/60 p-6">
          <h2 className="mb-2 text-sm font-bold text-violet-600">거래처 특이사항{note.author ? ` · ${note.author}` : ""}</h2>
          {(note.workStart || note.lunchTime) && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {note.workStart && <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-violet-700 ring-1 ring-violet-200">출근 {note.workStart}</span>}
              {note.lunchTime && <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-violet-700 ring-1 ring-violet-200">점심 {note.lunchTime}</span>}
            </div>
          )}
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-violet-900">{note.text}</div>
        </section>
      )}

      {(!!briefing?.bulman.length || !!briefing?.misu.length || asHistory.length > 0 || !!briefing?.history.length) && (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {!!briefing?.bulman.length && (
            <div className="rounded-2xl border border-rose-100 bg-white p-5">
              <h3 className="mb-3 text-sm font-bold text-rose-600">🚨 불만 {briefing.bulman.length}건</h3>
              <div className="space-y-2">
                {briefing.bulman.slice(0, 4).map((row, index) => (
                  <div key={index} className="rounded-lg bg-rose-50/60 px-3 py-2 text-xs leading-relaxed text-slate-700">
                    <span className="font-mono font-bold text-slate-500">{row["날짜"]}</span>
                    {!!row["불만유형"] && <span className="ml-2 rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{row["불만유형"]}</span>}
                    <div className="mt-1">{row["불만내용"]}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {!!briefing?.misu.length && (
            <div className="rounded-2xl border border-amber-100 bg-white p-5">
              <h3 className="mb-3 text-sm font-bold text-amber-600">💰 미수 {briefing.misu.length}건</h3>
              <div className="space-y-2">
                {briefing.misu.slice(0, 4).map((row, index) => (
                  <div key={index} className="rounded-lg bg-amber-50/60 px-3 py-2 text-xs leading-relaxed text-slate-700">
                    <span className="font-mono font-bold text-slate-500">{row["입력일"]}</span>
                    <span className="ml-2 font-bold text-amber-700">{row["미수개월"] || "-"}개월 {row["미수잔액"] ? `${money(Number(row["미수잔액"].replace(/[^0-9]/g, "")) || 0)}원` : ""}</span>
                    {!!row["방문내용"] && <div className="mt-1">{row["방문내용"]}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {asHistory.length > 0 && (
            <div className="rounded-2xl border border-slate-100 bg-white p-5">
              <h3 className="mb-3 text-sm font-bold text-slate-700">🔧 AS 이력 {asHistory.length}건 <span className="text-[10px] font-medium text-slate-400">최근 5건</span></h3>
              <div className="space-y-1.5">
                {asHistory.slice(0, 5).map((entry, index) => (
                  <div key={index} className="flex items-start gap-2 text-xs text-slate-700">
                    <span className="shrink-0 font-mono font-bold text-slate-400">{entry.date.slice(2)}</span>
                    <span className="min-w-0 flex-1 truncate">{entry.model && <b className="mr-1 text-slate-500">{entry.model}</b>}{entry.content}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {!!briefing?.history.length && (
            <div className="rounded-2xl border border-blue-100 bg-white p-5">
              <h3 className="mb-3 text-sm font-bold text-blue-700">📋 지난 재계약 협상 {briefing.history.length}건</h3>
              <div className="space-y-2">
                {briefing.history.slice(0, 3).map((row) => (
                  <div key={row.id} className="rounded-lg bg-blue-50/60 px-3 py-2 text-xs leading-relaxed text-slate-700">
                    <span className="font-mono font-bold text-slate-500">{row.날짜}</span>
                    {!!row.갱신상태 && <span className="ml-2 rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{row.갱신상태}</span>}
                    {!!row.갱신위험도 && <span className="ml-1 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">위험 {row.갱신위험도}</span>}
                    {!!row.제안조건 && <div className="mt-1 whitespace-pre-wrap">{row.제안조건}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* 추천 플랜 비교 */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-slate-900"><TrendingUp size={16} className="text-blue-500" /> 추천 플랜 비교</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">{proposals.map((p) => <ProposalCard key={p.rank} proposal={p} />)}</div>
      </section>

      {/* 위험 플래그 / 권한 밖 */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-100 bg-white p-6">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-red-600">⚠ 위험 플래그</h3>
          {verdict.위험신호.length
            ? <ul className="space-y-3">{verdict.위험신호.map((flag) => <li key={flag} className="flex items-start gap-3 text-sm text-slate-700"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />{flag}</li>)}</ul>
            : <div className="text-sm text-slate-400">특이 위험 없음</div>}
        </div>
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-600"><X size={14} /> 권한 밖 (제안 금지)</h3>
          <ul className="space-y-2.5">{verdict.권한밖.map((item2) => <li key={item2} className="flex items-start gap-3 text-sm text-slate-500"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />{item2}</li>)}</ul>
        </div>
      </section>

      {/* 원문 그대로 — 적요와 거래내역. 파서가 놓친 게 있어도 여기서 눈으로 확인한다 */}
      <section className="space-y-3">
        <details className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
          <summary className="cursor-pointer px-6 py-4 text-sm font-bold text-slate-700 hover:bg-slate-50">📜 적요 원문 그대로 보기</summary>
          <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap border-t border-slate-100 bg-slate-50 p-5 font-mono text-[12px] leading-6 text-slate-700">{analysis.remarks || "적요 없음"}</pre>
        </details>
        <details className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
          <summary className="cursor-pointer px-6 py-4 text-sm font-bold text-slate-700 hover:bg-slate-50">🧾 붙여넣은 대장 전체 원문 (판매/수금내역 포함)</summary>
          <pre className="max-h-[60vh] overflow-auto whitespace-pre border-t border-slate-100 bg-slate-50 p-5 font-mono text-[11.5px] leading-6 text-slate-700">{item.raw}</pre>
        </details>
      </section>
    </div>
  );
}

// ─── 목록 + 입력 (원본 InputView / VendorCard 구조) ─────────────────────────

export default function AnalyzeView() {
  const [store, setStore] = useState<Stored>(loadStore);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [picked, setPicked] = useState("");

  const analyzed = useMemo<Analyzed[]>(() => {
    return Object.entries(store)
      .map(([vendor, { raw, at }]) => {
        try {
          const analysis = analyzeLedger(raw);
          if (!analysis.months.length && !analysis.contracts.length) return null;
          return { vendor, at, raw, analysis, verdict: judge(analysis) };
        } catch { return null; }
      })
      .filter((item): item is Analyzed => !!item)
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [store]);

  useEffect(() => { if (!analyzed.length) setPasteOpen(true); }, [analyzed.length]);

  const addPaste = (text: string) => {
    const body = text.trim();
    if (!body) { notify("이카운트 화면을 붙여넣어 주세요.", "info"); return; }
    try {
      const analysis = analyzeLedger(body);
      if (!analysis.months.length && !analysis.contracts.length) {
        notify("대장 형식을 못 읽었습니다 — 거래처관리대장 I 화면 전체(적요 + 판매/수금내역)를 복사해 주세요.", "error");
        return;
      }
      const vendor = analysis.vendor || `이름미상-${Date.now()}`;
      const next = { ...store, [vendor]: { raw: body, at: new Date().toISOString() } };
      setStore(next); saveStore(next);
      setPasteText(""); setPasteOpen(false); setPicked(vendor);
      notify(`${vendor} 분석 완료 ✓`, "success");
    } catch (e) {
      notify(`분석 실패: ${(e as Error).message}`, "error");
    }
  };

  const removeVendor = (vendor: string) => {
    const next = { ...store };
    delete next[vendor];
    setStore(next); saveStore(next);
    setPicked("");
  };

  const detail = analyzed.find((item) => item.vendor === picked);
  if (detail) return <DetailView item={detail} onBack={() => setPicked("")} onRemove={() => removeVendor(detail.vendor)} />;

  return (
    <div className="space-y-4">
      {/* 입력 — 이카운트 전체 복사 → 붙여넣기 */}
      {(pasteOpen || !analyzed.length) && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">STEP 1</div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">이카운트 화면을 통째로 붙여넣으세요</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">
            이카운트 → 회계 I → 출력물 → <b className="text-slate-700">거래처관리대장 I</b>에서 거래처 조회 →
            <b className="text-slate-700"> 전체 선택(Ctrl+A) → 복사(Ctrl+C)</b> → 아래에 붙여넣기(Ctrl+V).
            프로그램 설치 없이 그대로 분석됩니다.
          </p>
          <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={7}
            placeholder="여기에 붙여넣기 — 적요와 판매/수금내역이 모두 들어와야 합니다"
            className="mt-3 w-full resize-y rounded-xl border-2 border-transparent bg-slate-50 p-4 font-mono text-[12px] leading-5 outline-none transition focus:border-blue-500 focus:bg-white" />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => addPaste(pasteText)}
              className="rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm shadow-blue-500/25 transition hover:bg-blue-700">분석하기</button>
            <button type="button" onClick={async () => { try { addPaste(await navigator.clipboard.readText()); } catch { notify("클립보드를 읽지 못했습니다 — 입력창에 직접 붙여주세요.", "info"); } }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-50"><ClipboardPaste size={15} />클립보드에서 바로 분석</button>
            {analyzed.length > 0 && <button type="button" onClick={() => setPasteOpen(false)} className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-400 hover:text-slate-600">닫기</button>}
          </div>
        </section>
      )}

      {/* 거래처 카드 목록 */}
      {analyzed.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">분석된 거래처 {analyzed.length}곳 <span className="ml-1 text-[11px] font-medium text-slate-400">이 기기에 저장됨</span></h2>
            {!pasteOpen && <button type="button" onClick={() => setPasteOpen(true)} className="rounded-full bg-slate-900 px-4 py-2 text-xs font-bold text-white transition hover:bg-slate-800">+ 거래처 추가</button>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {analyzed.map((item) => {
              const proposals = calcProposals(item.analysis, item.verdict);
              const recommended = proposals.find((p) => p.recommended)!;
              return (
                <button key={item.vendor} type="button" onClick={() => setPicked(item.vendor)}
                  className="group rounded-2xl border border-slate-100 bg-white p-6 text-left transition-all hover:border-blue-200 hover:shadow-md">
                  <div className="mb-2 flex items-center gap-1.5">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${DIFF_TONE[item.verdict.난이도] || "bg-slate-100 text-slate-600"}`}>{item.verdict.난이도}</span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700">{item.verdict.거래관계} {item.verdict.거래연차}년</span>
                  </div>
                  <h3 className="truncate text-lg font-bold text-slate-900">{item.vendor}</h3>
                  <div className="mt-1 text-xs text-slate-500">월 {money(item.analysis.billing.월기본료)}원 · 컬러 {item.verdict.컬러활용률}% · 초과 {item.analysis.usage.reduce((s, u) => s + u.초과월수, 0)}회</div>
                  <div className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">→ {recommended.label}</div>
                  <div className="mt-2 text-[10px] text-slate-400">{item.at.slice(0, 16).replace("T", " ")} 분석</div>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
