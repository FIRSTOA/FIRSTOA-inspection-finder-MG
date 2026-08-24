/**
 * 이카운트 분석 — 옛 재계약 웹앱(recontract_webapp) 구조 + 사용자 확정 수정.
 *
 * 입력: 이카운트 거래처관리대장 I 화면 전체 복사(Ctrl+A → Ctrl+C) → 붙여넣기 → 분석.
 * 프로그램 설치·자동 로그인 없이 전 직원이 쓴다.
 *
 * 목록 화면: 이번 분기 방문 대상(워킨맵 재계약 · S/SS)이 먼저 — 누굴 분석할지 여기서 고른다.
 * 분석 기록은 세션 저장(sessionStorage) — 창을 닫으면 남지 않는다(이카운트 매출 데이터).
 *
 * 상세 순서: 히어로(핵심 판단) → 판정·이력 배지 → 특이사항·불만·미수·AS·지난 협상(상단) →
 *   핵심 지표(컬러/흑백 활용률 포함) → 계약 이력 + 적요 상세(블록별 분석 + 원문) →
 *   월별 상세(이카운트형: 일자/적요/판매/수금/잔액 + 사용량·초과 칩 + 월계) →
 *   판매/수금내역 원문 → 추천 플랜 A/B/C → 위험 플래그/권한 밖
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ClipboardPaste, TrendingUp, Trash2, X } from "lucide-react";
import { notify } from "../toast";
import { getAsHistory, type AsHistoryEntry } from "../api";
import { getVendorFlagsBatch, type VendorWorkFlags } from "../vendorFlags";
import { vendorMatchKey } from "../ids";
import { teamForAuthor } from "../operations";
import { currentQuarter, type Quarter } from "../workinPlaces";
import { analyzeLedger, type LedgerAnalysis } from "./ledger";
import { judge, type Judgement } from "./judge";
import { calcProposals, type ExtraSignals, type Proposal } from "./proposals";
import { fetchBriefing, fetchRenewalScope, type RcBriefing, type RcTarget, type RenewalScope } from "./api";

const STORE_KEY = "recontract_analyze_v1";   // { [vendor]: { raw, at } }

type Stored = Record<string, { raw: string; at: string }>;
type Analyzed = { vendor: string; at: string; raw: string; analysis: LedgerAnalysis; verdict: Judgement };

// 이카운트 매출·수납 데이터라 기기에 남기지 않는다 — 세션 저장(창을 닫으면 소멸). 사용자 확정.
function loadStore(): Stored {
  try { return JSON.parse(sessionStorage.getItem(STORE_KEY) || "{}"); } catch { return {}; }
}
function saveStore(store: Stored) {
  try { sessionStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* 용량 초과 등 — 무시 */ }
}

const money = (n: number) => Math.round(n).toLocaleString("ko-KR");
const man = (n: number) => (n / 10_000).toFixed(n >= 1_000_000 ? 0 : 1); // 만원

const DIFF_TONE: Record<string, string> = {
  쉬움: "bg-emerald-50 text-emerald-700", 보통: "bg-blue-50 text-blue-700",
  어려움: "bg-amber-50 text-amber-700", 매우어려움: "bg-red-50 text-red-700",
};
const GRADE_TONE: Record<string, string> = { SS: "bg-violet-600 text-white", S: "bg-blue-600 text-white" };

function Badge({ tone, children }: { tone: "gray" | "blue" | "amber" | "red" | "green" | "violet"; children: React.ReactNode }) {
  const cls = { gray: "bg-slate-100 text-slate-700", blue: "bg-blue-50 text-blue-700", amber: "bg-amber-50 text-amber-800", red: "bg-red-50 text-red-700", green: "bg-emerald-50 text-emerald-700", violet: "bg-violet-50 text-violet-700" }[tone];
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

// ─── 상세 ────────────────────────────────────────────────────────────────────

function DetailView({ item, onBack, onRemove }: { item: Analyzed; onBack: () => void; onRemove: () => void }) {
  const { analysis, verdict } = item;
  const overCount = analysis.usage.reduce((sum, stat) => sum + stat.초과월수, 0);
  const 미납실질 = analysis.payment.미납월.filter((ym) => ym !== analysis.months[analysis.months.length - 1]?.ym).length;
  const current = analysis.현재계약;

  // 대장 밖 이력 — 업체명으로 특이사항·불만·미수·AS·지난 협상을 자동으로 불러온다
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

  // 불러온 이력이 플랜 판단에도 반영된다 — 장비 불만·AS 누적이면 A안이 기기 교체로 바뀐다
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

  // 기간 총 사용량 + 활용률 (컬러·흑백)
  const usage = useMemo(() => {
    const color = analysis.usage.find((u) => u.kind === "컬러");
    const bw = analysis.usage.find((u) => u.kind === "흑백");
    const total = { 컬러: 0, 흑백: 0 };
    for (const month of analysis.months) {
      for (const counter of month.counters) {
        if (counter.kind === "흑백") total.흑백 += counter.사용;
        else total.컬러 += counter.사용;
      }
    }
    const rate = (stat?: { 월평균: number; 기본매수: number }) =>
      stat && stat.기본매수 > 0 ? Math.round((stat.월평균 / stat.기본매수) * 100) : 0;
    return { color, bw, total, 컬러활용률: rate(color), 흑백활용률: rate(bw) };
  }, [analysis]);
  const countersMissing = analysis.months.length > 0 && usage.total.컬러 + usage.total.흑백 === 0;

  // 판매/수금내역 원문 — 붙여넣은 텍스트에서 그 부분만 잘라 이카운트 그대로 보여준다
  const rawTable = useMemo(() => {
    const idx = item.raw.indexOf("판매/수금내역");
    return idx >= 0 ? item.raw.slice(idx) : item.raw;
  }, [item.raw]);

  // 이카운트형 전표 표 — 잔액은 판매-수금 누적으로 계산
  const voucherRows = useMemo(() => {
    let balance = 0;
    const rows: Array<{ kind: "v" | "sub"; date: string; no: string; memo: string; 판매: number; 수금: number; 잔액: number; chips: string[] }> = [];
    const monthAgg = new Map<string, { 판매: number; 수금: number }>();
    for (const voucher of analysis.vouchers) {
      balance += voucher.판매 - voucher.수금;
      const chips: string[] = [];
      const color = voucher.items.filter((it) => it.counter && it.counter.kind !== "흑백").reduce((sum, it) => sum + (it.counter?.사용 || 0), 0);
      const bw = voucher.items.filter((it) => it.counter?.kind === "흑백").reduce((sum, it) => sum + (it.counter?.사용 || 0), 0);
      if (color || bw) chips.push(`컬 ${money(color)}매 · 흑 ${money(bw)}매`);
      for (const it of voucher.items) if (it.excess) chips.push(`⚠ ${it.excess.kind} ${money(it.excess.초과)}매 초과 · ${money(it.excess.금액)}원`);
      rows.push({ kind: "v", date: voucher.date, no: voucher.no, memo: voucher.memo, 판매: voucher.판매, 수금: voucher.수금, 잔액: balance, chips });
      const ym = voucher.date.slice(0, 7);
      const agg = monthAgg.get(ym) || { 판매: 0, 수금: 0 };
      agg.판매 += voucher.판매; agg.수금 += voucher.수금;
      monthAgg.set(ym, agg);
    }
    // 월계 줄 삽입 — 이카운트 화면과 같은 리듬
    const withSub: typeof rows = [];
    for (let i = 0; i < rows.length; i += 1) {
      withSub.push(rows[i]);
      const ym = rows[i].date.slice(0, 7);
      const nextYm = rows[i + 1]?.date.slice(0, 7);
      if (ym !== nextYm) {
        const agg = monthAgg.get(ym)!;
        withSub.push({ kind: "sub", date: ym, no: "", memo: "", 판매: agg.판매, 수금: agg.수금, 잔액: rows[i].잔액, chips: [] });
      }
    }
    return withSub;
  }, [analysis]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button type="button" onClick={onBack} className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900">
          <ChevronLeft size={15} /> 거래처 목록
        </button>
        <button type="button" onClick={onRemove} className="flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold text-slate-400 hover:bg-rose-50 hover:text-rose-600">
          <Trash2 size={13} /> 분석 지우기
        </button>
      </div>

      {/* 히어로 — 핵심 판단 한 줄 */}
      <section className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 p-6 text-white sm:p-8">
        <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">INTERNAL DASHBOARD</div>
        <h1 className="mb-3 text-2xl font-bold tracking-tight sm:text-3xl">{item.vendor}</h1>
        <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-300">
          <span>{current?.models[0] || `${analysis.months.length}개월 대장`}</span>
          <span className="text-slate-600">·</span>
          <span>월 {money(analysis.billing.월기본료)}원</span>
          {!!current?.from && (<><span className="text-slate-600">·</span><span>{current.from} ~ {current.to}</span></>)}
          <span className="text-slate-600">·</span>
          <span className="text-xs text-slate-400">조회 {analysis.기간.from} ~ {analysis.기간.to}</span>
        </div>
        <div className="rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur">
          <div className="mb-1.5 text-xs uppercase tracking-wider text-slate-300">핵심 판단</div>
          <div className="text-base leading-relaxed">
            <strong className="text-white">{verdict.거래관계} 거래처 ({verdict.거래연차}년)</strong> · {verdict.거래처유형} · 난이도 <strong>{verdict.난이도}</strong>
            {" → 1순위 "}<strong className="text-amber-300">{recommended.label}</strong>
          </div>
        </div>
      </section>

      {/* 판정 + 이력 배지 — 불만·미수·AS가 있으면 상단에서 바로 보인다 */}
      <div className="flex flex-wrap gap-2">
        <Badge tone="blue">관계 {verdict.거래관계} · {verdict.거래연차}년</Badge>
        <Badge tone="blue">유형 {verdict.거래처유형}</Badge>
        <Badge tone={["어려움", "매우어려움"].includes(verdict.난이도) ? "amber" : "gray"}>난이도 {verdict.난이도}</Badge>
        <Badge tone={["많음", "매우많음"].includes(verdict.초과수준) ? "red" : "gray"}>초과 {verdict.초과수준}</Badge>
        <Badge tone={verdict.결제안정성 === "안정" ? "green" : "amber"}>결제 {verdict.결제안정성}</Badge>
        {!!note?.text && <Badge tone="violet">특이사항 있음</Badge>}
        {!!briefing?.bulman.length && <Badge tone="red">불만 {briefing.bulman.length}건</Badge>}
        {!!briefing?.misu.length && <Badge tone="amber">미수 {briefing.misu.length}건</Badge>}
        {asHistory.length > 0 && <Badge tone="gray">AS {asHistory.length}건</Badge>}
      </div>

      {/* 거래처 특이사항 — 방문 규칙은 맨 위에서 보여야 한다 */}
      {!!note?.text && (
        <section className="rounded-2xl border border-violet-200 bg-violet-50/60 p-5">
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

      {/* 거래처 이력 — 업체명으로 자동 조회 */}
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

      {/* 핵심 지표 */}
      <section>
        <h2 className="mb-3 text-base font-bold text-slate-900">핵심 지표 <span className="ml-1 text-[11px] font-medium text-slate-400">대장 조회기간 {analysis.months.length}개월 기준</span></h2>
        {countersMissing && (
          <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-bold leading-relaxed text-amber-800">
            ⚠ 카운터(누계·사용) 줄을 인식하지 못해 사용량이 0으로 보입니다 — 아래 [판매/수금내역 원문]을 열어 카운터 줄이 들어왔는지 확인해 주세요. 원문 형식이 다르면 이민구에게 전달해 주시면 인식기를 맞추겠습니다.
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <KPI label="누적 매출" value={man(analysis.누계.판매)} unit="만원" sub={`수금 ${man(analysis.누계.수금)}만원 · 잔액 ${man(analysis.누계.잔액)}만원`} tone="blue" />
          <KPI label="컬러 사용 (기간 합)" value={usage.total.컬러} unit="매"
            sub={`월평균 ${money(usage.color?.월평균 || 0)}매 / 기본 ${money(usage.color?.기본매수 || 0)}매 → 활용률 ${usage.컬러활용률}%`}
            tone={usage.컬러활용률 >= 100 ? "red" : usage.컬러활용률 >= 80 ? "amber" : "blue"} />
          <KPI label="흑백 사용 (기간 합)" value={usage.total.흑백} unit="매"
            sub={`월평균 ${money(usage.bw?.월평균 || 0)}매 / 기본 ${money(usage.bw?.기본매수 || 0)}매 → 활용률 ${usage.흑백활용률}%`}
            tone={usage.흑백활용률 >= 100 ? "red" : "gray"} />
          <KPI label="초과료 누적" value={man(analysis.billing.초과청구합)} unit="만원" sub={`${overCount}회 발생`} tone={overCount >= 3 ? "amber" : "gray"} />
          <KPI label="미수 잔액" value={analysis.누계.잔액 === 0 ? "없음" : man(analysis.누계.잔액)} unit={analysis.누계.잔액 === 0 ? "" : "만원"}
            sub={`미납 ${미납실질}개월 · 수금 ${analysis.payment.판정}`} tone={미납실질 > 0 ? "amber" : "green"} />
          <KPI label="월 기본료" value={money(analysis.billing.월기본료)} unit="원" sub={`최근 청구 ${money(analysis.billing.최근청구)}원`} />
        </div>
      </section>

      {/* 계약 이력 + 적요 상세 — 블록별 분석과 그 원문을 함께 */}
      {!!analysis.contracts.length && (
        <section className="rounded-2xl border border-slate-100 bg-white p-6">
          <h2 className="mb-4 text-base font-bold text-slate-900">계약 이력 · 적요 상세 <span className="ml-1 text-[11px] font-medium text-slate-400">적요에서 읽음 · 최근 먼저 · 각 블록 아래는 원문</span></h2>
          <div className="space-y-3">
            {analysis.contracts.map((note2, index) => (
              <div key={`${note2.from}-${index}`} className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono text-sm font-bold tabular-nums text-slate-800">{note2.from || "?"} ~ {note2.to || "?"}</span>
                  {!!note2.label && <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white">{note2.label}</span>}
                  {!!note2.models.length && <span className="text-xs font-semibold text-slate-600">{note2.models.join(", ")}</span>}
                  {!!note2.years && <span className="text-[11px] text-slate-400">만 {note2.years}년</span>}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                  {!!note2.월기본료 && <span>기본료 <b className="text-slate-900">{money(note2.월기본료)}원</b></span>}
                  {!!note2.컬러기본 && <span>컬러 <b className="text-slate-900">{money(note2.컬러기본)}매</b> / 초과 {note2.컬러단가}원</span>}
                  {!!note2.흑백기본 && <span>흑백 <b className="text-slate-900">{money(note2.흑백기본)}매</b> / 초과 {note2.흑백단가}원</span>}
                  {!!note2.보증금 && <span>보증금 <b className="text-slate-900">{money(note2.보증금)}원</b></span>}
                  {!!note2.무상.length && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">{note2.무상.join("·")} 무상 — 재계약 때 유지 확인</span>}
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-[11px] font-semibold text-slate-400 hover:text-slate-600">이 블록의 적요 원문</summary>
                  <pre className="mt-1.5 whitespace-pre-wrap rounded-lg bg-white p-3 font-mono text-[11.5px] leading-5 text-slate-600 ring-1 ring-slate-100">{note2.raw}</pre>
                </details>
              </div>
            ))}
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-bold text-slate-500 hover:text-slate-700">📜 적요 전체 원문 그대로 보기</summary>
            <pre className="mt-2 max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-4 font-mono text-[12px] leading-6 text-slate-700">{analysis.remarks || "적요 없음"}</pre>
          </details>
        </section>
      )}

      {/* 월별 상세 — 이카운트 그대로: 일자 | 적요 | 판매 | 수금 | 잔액 (+사용량·초과 칩) */}
      <section className="rounded-2xl border border-slate-100 bg-white p-6">
        <h2 className="mb-4 text-base font-bold text-slate-900">월별 상세 <span className="ml-1 text-[11px] font-medium text-slate-400">이카운트 화면과 같은 배열 · 초과가 난 전표는 붉게</span></h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-3">일자</th>
                <th className="py-2 pr-3">적요</th>
                <th className="py-2 pr-3 text-right">판매</th>
                <th className="py-2 pr-3 text-right">수금</th>
                <th className="py-2 text-right">잔액</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {voucherRows.map((row, index) => row.kind === "sub" ? (
                <tr key={`s-${row.date}`} className="border-b border-slate-100 bg-slate-50/80 text-xs font-bold text-slate-500">
                  <td className="py-1.5 pr-3 font-mono">{row.date.replace("-", "/")} 계</td>
                  <td className="py-1.5 pr-3" />
                  <td className="py-1.5 pr-3 text-right">{row.판매 ? money(row.판매) : ""}</td>
                  <td className="py-1.5 pr-3 text-right">{row.수금 ? money(row.수금) : ""}</td>
                  <td className="py-1.5 text-right" />
                </tr>
              ) : (
                <tr key={`${row.date}-${row.no}-${index}`} className={`border-b border-slate-50 last:border-0 ${row.chips.some((chip) => chip.startsWith("⚠")) ? "bg-red-50/60" : ""}`}>
                  <td className="py-2 pr-3 font-mono text-xs font-bold text-slate-600">{row.date.slice(2).replace(/-/g, "/")}</td>
                  <td className="py-2 pr-3">
                    <div className="text-xs font-medium text-slate-700">{row.memo || <span className="text-slate-300">—</span>}</div>
                    {row.chips.length > 0 && (
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {row.chips.map((chip) => (
                          <span key={chip} className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${chip.startsWith("⚠") ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-500"}`}>{chip}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right font-semibold text-slate-800">{row.판매 ? money(row.판매) : <span className="text-slate-300">—</span>}</td>
                  <td className="py-2 pr-3 text-right font-semibold text-emerald-700">{row.수금 ? money(row.수금) : <span className="text-slate-300">—</span>}</td>
                  <td className="py-2 text-right font-semibold text-slate-500">{row.잔액 ? money(row.잔액) : <span className="text-slate-300">0</span>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 font-bold text-slate-900">
                <td className="py-2 pr-3 text-xs">누계</td>
                <td className="py-2 pr-3 text-[11px] text-red-600">{overCount ? `초과 ${overCount}회 · ${money(analysis.billing.초과청구합)}원` : ""}</td>
                <td className="py-2 pr-3 text-right">{money(analysis.누계.판매)}</td>
                <td className="py-2 pr-3 text-right">{money(analysis.누계.수금)}</td>
                <td className="py-2 text-right">{money(analysis.누계.잔액)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {/* 판매/수금내역 원문 — 표 바로 아래 (이카운트 화면 그대로) */}
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-bold text-slate-500 hover:text-slate-700">🧾 판매/수금내역 원문 그대로 보기</summary>
          <pre className="mt-2 max-h-[60vh] overflow-auto whitespace-pre rounded-xl bg-slate-50 p-4 font-mono text-[11.5px] leading-6 text-slate-700">{rawTable}</pre>
        </details>
      </section>

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
    </div>
  );
}

// ─── 목록 + 입력 ─────────────────────────────────────────────────────────────

export default function AnalyzeView({ author = "" }: { author?: string }) {
  const [store, setStore] = useState<Stored>(loadStore);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [picked, setPicked] = useState("");
  const [pendingVendor, setPendingVendor] = useState(""); // 워킨맵 목록에서 고른 업체 — 붙여넣기 안내용

  // 이번 분기 방문 대상 (워킨맵 재계약 · CS 등급 S/SS) — 누굴 분석할지 여기서 고른다
  const quarter = currentQuarter();
  const myTeam = useMemo(() => { const t = teamForAuthor(author); return ["A", "B", "C", "D"].includes(t) ? t : "C"; }, [author]);
  const [team, setTeam] = useState("");
  useEffect(() => { setTeam((cur) => cur || myTeam); }, [myTeam]);
  const [scope, setScope] = useState<RenewalScope | null>(null);
  const [targetLimit, setTargetLimit] = useState(10);
  useEffect(() => {
    if (!team) return;
    let alive = true;
    setScope(null);
    setTargetLimit(10);
    fetchRenewalScope(quarter as Quarter, team).then((r) => { if (alive) setScope(r); }).catch(() => { if (alive) setScope({ targets: [], quarter: quarter as Quarter, 제외: { 완료: 0, 영업부: 0, 이관: 0, 등급외: 0, 무등급: 0 } }); });
    return () => { alive = false; };
  }, [team, quarter]);

  const analyzed = useMemo<Analyzed[]>(() => {
    return Object.entries(store)
      .map(([vendor, { raw, at }]) => {
        try {
          const analysis = analyzeLedger(raw);
          if (!analysis.months.length && !analysis.contracts.length) return null;
          return { vendor, at, raw, analysis, verdict: judge(analysis) };
        } catch { return null; }
      })
      .filter((entry): entry is Analyzed => !!entry)
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [store]);
  const analyzedKeys = useMemo(() => new Map(analyzed.map((entry) => [vendorMatchKey(entry.vendor), entry.vendor])), [analyzed]);

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
      setPasteText(""); setPasteOpen(false); setPendingVendor(""); setPicked(vendor);
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
  const clearAll = () => {
    setStore({}); saveStore({});
    setPicked("");
    notify("분석 기록을 모두 지웠습니다.", "success");
  };

  const detail = analyzed.find((entry) => entry.vendor === picked);
  if (detail) return <DetailView item={detail} onBack={() => setPicked("")} onRemove={() => removeVendor(detail.vendor)} />;

  const ddayOf = (ymd: string) => (ymd ? Math.round((Date.parse(`${ymd}T00:00:00+09:00`) - Date.now()) / 86_400_000) : 9999);

  return (
    <div className="space-y-4">
      {/* 붙여넣기 — 워킨맵 목록에서 업체를 고르면 여기로 안내된다 */}
      {(pasteOpen || !analyzed.length) && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">이카운트 붙여넣기</div>
          {pendingVendor && <div className="mb-1 text-sm font-bold text-blue-700">▶ {pendingVendor} 의 관리대장을 붙여넣으세요</div>}
          <h2 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">이카운트 화면을 통째로 붙여넣으세요</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">
            이카운트 → 회계 I → 출력물 → <b className="text-slate-700">거래처관리대장 I</b>에서 거래처 조회 →
            <b className="text-slate-700"> 전체 선택(Ctrl+A) → 복사(Ctrl+C)</b> → 아래에 붙여넣기(Ctrl+V).
            분석 기록은 <b className="text-slate-700">이 창을 닫으면 남지 않습니다</b>.
          </p>
          <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={7}
            placeholder="여기에 붙여넣기 — 적요와 판매/수금내역이 모두 들어와야 합니다"
            className="mt-3 w-full resize-y rounded-xl border-2 border-transparent bg-slate-50 p-4 font-mono text-[12px] leading-5 outline-none transition focus:border-blue-500 focus:bg-white" />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => addPaste(pasteText)}
              className="rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm shadow-blue-500/25 transition hover:bg-blue-700">분석하기</button>
            <button type="button" onClick={async () => { try { addPaste(await navigator.clipboard.readText()); } catch { notify("클립보드를 읽지 못했습니다 — 입력창에 직접 붙여주세요.", "info"); } }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-50"><ClipboardPaste size={15} />클립보드에서 바로 분석</button>
            {analyzed.length > 0 && <button type="button" onClick={() => { setPasteOpen(false); setPendingVendor(""); }} className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-400 hover:text-slate-600">닫기</button>}
          </div>
        </section>
      )}

      {/* 분석된 거래처 카드 */}
      {analyzed.length > 0 && (
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold text-slate-900">분석된 거래처 {analyzed.length}곳 <span className="ml-1 text-[11px] font-medium text-slate-400">창을 닫으면 사라집니다</span></h2>
            <div className="flex items-center gap-1.5">
              {!pasteOpen && <button type="button" onClick={() => setPasteOpen(true)} className="rounded-full bg-slate-900 px-4 py-2 text-xs font-bold text-white transition hover:bg-slate-800">+ 거래처 추가</button>}
              <button type="button" onClick={clearAll} className="rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-500 transition hover:bg-slate-50">모두 지우기</button>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {analyzed.map((entry) => {
              const proposals = calcProposals(entry.analysis, entry.verdict);
              const recommended = proposals.find((p) => p.recommended)!;
              return (
                <button key={entry.vendor} type="button" onClick={() => setPicked(entry.vendor)}
                  className="group rounded-2xl border border-slate-100 bg-white p-6 text-left transition-all hover:border-blue-200 hover:shadow-md">
                  <div className="mb-2 flex items-center gap-1.5">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${DIFF_TONE[entry.verdict.난이도] || "bg-slate-100 text-slate-600"}`}>{entry.verdict.난이도}</span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700">{entry.verdict.거래관계} {entry.verdict.거래연차}년</span>
                  </div>
                  <h3 className="truncate text-lg font-bold text-slate-900">{entry.vendor}</h3>
                  <div className="mt-1 text-xs text-slate-500">월 {money(entry.analysis.billing.월기본료)}원 · 컬러 {entry.verdict.컬러활용률}% · 초과 {entry.analysis.usage.reduce((s, u) => s + u.초과월수, 0)}회</div>
                  <div className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">→ {recommended.label}</div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* 이번 분기 방문 대상 — 워킨맵 재계약 목록 (S·SS) */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-slate-900">{quarter}Q 재계약 방문 대상 <span className="ml-1 text-[11px] font-medium text-slate-400">워킨맵 기준 · S/SS</span></h2>
          </div>
          {["A", "B", "C", "D"].map((t) => (
            <button key={t} type="button" onClick={() => setTeam(t)}
              className={`rounded-full px-3 py-1.5 text-[12px] font-bold transition ${team === t ? "bg-slate-900 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200 hover:text-slate-800"}`}>
              {t}팀{t === myTeam ? " ★" : ""}
            </button>
          ))}
        </div>
        {scope === null && <div className="px-4 py-8 text-center text-xs font-bold text-slate-400">워킨맵 목록을 불러오는 중…</div>}
        {!!scope && !scope.targets.length && <div className="px-4 py-8 text-center text-xs font-bold text-slate-400">{team}팀 {quarter}Q 방문 대상이 없습니다.</div>}
        {!!scope && scope.targets.length > 0 && (
          <div className="divide-y divide-slate-50">
            {scope.targets.slice(0, targetLimit).map((target) => {
              const doneVendor = analyzedKeys.get(target.key);
              const dday = ddayOf(target.종료일);
              return (
                <button key={target.key} type="button"
                  onClick={() => {
                    if (doneVendor) { setPicked(doneVendor); return; }
                    setPendingVendor(target.vendor);
                    setPasteOpen(true);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-blue-50/40">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ${GRADE_TONE[target.등급] || "bg-slate-600 text-white"}`}>{target.등급}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-slate-900">{target.vendor}</span>
                    <span className="block truncate text-[11px] text-slate-400">{target.종료일 ? `${target.종료일} 종료` : "종료일 미기재"}{target.places.length > 1 ? ` · 지점 ${target.places.length}곳` : ""}</span>
                  </span>
                  {target.종료일 && <span className={`shrink-0 text-[11px] font-bold tabular-nums ${dday <= 14 ? "text-rose-600" : dday <= 45 ? "text-amber-600" : "text-slate-400"}`}>{dday >= 0 ? `D-${dday}` : `${-dday}일 지남`}</span>}
                  {doneVendor
                    ? <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700">분석됨 → 보기</span>
                    : <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500">대장 붙여넣기</span>}
                </button>
              );
            })}
            {scope.targets.length > targetLimit && (
              <button type="button" onClick={() => setTargetLimit((n) => n + 20)}
                className="w-full py-2.5 text-center text-xs font-bold text-blue-600 transition hover:bg-blue-50/40">더 보기 ({scope.targets.length - targetLimit}곳 남음)</button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
