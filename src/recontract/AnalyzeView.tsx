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
import { ChevronLeft, ClipboardPaste, Trash2 } from "lucide-react";
import { notify } from "../toast";
import { getAsHistory, type AsHistoryEntry } from "../api";
import { getVendorFlagsBatch, type VendorWorkFlags } from "../vendorFlags";
import { vendorMatchKey } from "../ids";
import { teamForAuthor } from "../operations";
import { currentQuarter, type Quarter } from "../workinPlaces";
import { analyzeLedger, type LedgerAnalysis } from "./ledger";
import { judge, type Judgement } from "./judge";
import { calcProposals, type ExtraSignals } from "./proposals";
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

/* ── 상세 화면 디자인 원칙 ─────────────────────────────────────────────────
 * 처음 보는 사람 기준: ① 요약 탭만 보면 방문 준비가 끝나야 한다
 * ② 근거(사용량·대장·계약·이력)는 탭으로 나눠 한 화면에 한 가지만
 * ③ 색은 뜻이 있을 때만 — 빨강=초과/위험, 호박=주의, 초록=정상, 파랑=추천 */

const tone = {
  red: "text-red-600", amber: "text-amber-600", green: "text-emerald-600", blue: "text-blue-600", slate: "text-slate-900",
};

function Stat({ label, value, unit, sub, color = "slate" }: { label: string; value: string | number; unit?: string; sub?: string; color?: keyof typeof tone }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold text-slate-400">{label}</div>
      <div className={`mt-0.5 text-xl font-bold tabular-nums leading-tight ${tone[color]}`}>
        {typeof value === "number" ? value.toLocaleString("ko-KR") : value}
        {!!unit && <span className="ml-0.5 text-[12px] font-medium text-slate-400">{unit}</span>}
      </div>
      {!!sub && <div className="mt-0.5 truncate text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-[13px] font-bold text-slate-900">{title}</h2>
        {!!hint && <span className="text-[11px] font-medium text-slate-400">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

// ─── 상세 ────────────────────────────────────────────────────────────────────

type DetailTab = "요약" | "사용량" | "대장" | "계약·적요" | "고객 이력";

function DetailView({ item, onBack, onRemove }: { item: Analyzed; onBack: () => void; onRemove: () => void }) {
  const { analysis, verdict } = item;
  const [tab, setTab] = useState<DetailTab>("요약");
  const overCount = analysis.usage.reduce((sum, stat) => sum + stat.초과월수, 0);
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
  const alternatives = proposals.filter((p) => !p.recommended);
  const note = flags?.note;

  // 사용량 — 기간 총합·활용률(컬러/흑백)
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
  const isAccum = useMemo(() => analysis.vouchers.some((voucher) => voucher.items.some((it) => /개월\s*누적/.test(it.label))), [analysis]);

  // 이카운트형 전표 표 — 상세 줄을 가공 없이 행으로. 잔액은 판매-수금 누적
  const voucherRows = useMemo(() => {
    let balance = 0;
    type Row = { kind: "v" | "item" | "sub"; date: string; no: string; memo: string; 판매: number; 수금: number; 잔액: number; excess: boolean };
    const rows: Row[] = [];
    const monthAgg = new Map<string, { 판매: number; 수금: number }>();
    for (const voucher of analysis.vouchers) {
      balance += voucher.판매 - voucher.수금;
      rows.push({ kind: "v", date: voucher.date, no: voucher.no, memo: voucher.memo, 판매: voucher.판매, 수금: voucher.수금, 잔액: balance, excess: false });
      for (const it of voucher.items) {
        rows.push({ kind: "item", date: "", no: "", memo: it.label, 판매: it.금액, 수금: 0, 잔액: 0, excess: !!it.excess });
      }
      const ym = voucher.date.slice(0, 7);
      const agg = monthAgg.get(ym) || { 판매: 0, 수금: 0 };
      agg.판매 += voucher.판매; agg.수금 += voucher.수금;
      monthAgg.set(ym, agg);
    }
    const withSub: Row[] = [];
    let lastYm = "";
    for (let i = 0; i < rows.length; i += 1) {
      withSub.push(rows[i]);
      if (rows[i].kind === "v") lastYm = rows[i].date.slice(0, 7);
      const next = rows.slice(i + 1).find((row) => row.kind === "v");
      const isMonthEnd = rows[i + 1]?.kind !== "item" && (!next || next.date.slice(0, 7) !== lastYm);
      if (isMonthEnd && lastYm && (rows[i].kind === "v" || rows[i].kind === "item")) {
        const agg = monthAgg.get(lastYm)!;
        withSub.push({ kind: "sub", date: lastYm, no: "", memo: "", 판매: agg.판매, 수금: agg.수금, 잔액: 0, excess: false });
        lastYm = "";
      }
    }
    return withSub;
  }, [analysis]);

  const historyCount = (briefing?.bulman.length || 0) + (briefing?.misu.length || 0) + asHistory.length + (briefing?.history.length || 0);
  const TABS: Array<{ key: DetailTab; badge?: number }> = [
    { key: "요약" },
    { key: "사용량", badge: overCount || undefined },
    { key: "대장" },
    { key: "계약·적요" },
    { key: "고객 이력", badge: historyCount || undefined },
  ];

  return (
    <div className="space-y-4">
      {/* 머리 — 업체명·핵심 판단·탭. 여기만 보면 어디를 보고 있는지 안다 */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-start gap-3 p-5 pb-4">
          <button type="button" onClick={onBack} aria-label="목록으로"
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800">
            <ChevronLeft size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{item.vendor}</h1>
              <span className="text-[12px] text-slate-400">{current?.models[0] || ""} · 월 {money(analysis.billing.월기본료)}원{current?.from ? ` · ${current.from} ~ ${current.to}` : ""}</span>
            </div>
            {/* 핵심 판단 한 문장 — 색은 판단 결과에만 */}
            <p className="mt-1.5 text-[14px] leading-relaxed text-slate-600">
              <b className="text-slate-900">{verdict.거래연차}년차 {verdict.거래관계}</b> · {verdict.거래처유형} · 난이도 <b className={verdict.난이도 === "쉬움" ? "text-emerald-600" : verdict.난이도.includes("어려") ? "text-red-600" : "text-slate-900"}>{verdict.난이도}</b>
              <span className="mx-1.5 text-slate-300">→</span>
              1순위 <b className="text-blue-600">{recommended.label}</b>
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold">
              <span className={`rounded-full px-2 py-0.5 ${["많음", "매우많음"].includes(verdict.초과수준) ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-500"}`}>초과 {verdict.초과수준}</span>
              <span className={`rounded-full px-2 py-0.5 ${verdict.결제안정성 === "안정" ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-700"}`}>결제 {verdict.결제안정성}</span>
              {!!note?.text && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-600">특이사항</span>}
              {!!briefing?.bulman.length && <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-600">불만 {briefing.bulman.length}</span>}
              {!!briefing?.misu.length && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">미수기록 {briefing.misu.length}</span>}
              {asHistory.length > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">AS {asHistory.length}</span>}
            </div>
          </div>
          <button type="button" onClick={onRemove} aria-label="분석 지우기"
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-300 transition hover:bg-red-50 hover:text-red-500">
            <Trash2 size={16} />
          </button>
        </div>
        {/* 탭 — 한 화면에 한 가지만 */}
        <div className="flex gap-1 overflow-x-auto border-t border-slate-100 bg-slate-50/60 px-3 py-2">
          {TABS.map(({ key, badge }) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-bold transition ${tab === key ? "bg-slate-900 text-white shadow-sm" : "text-slate-500 hover:bg-white hover:text-slate-800"}`}>
              {key}
              {badge !== undefined && <span className={`rounded-full px-1.5 text-[10px] font-bold ${tab === key ? "bg-white/20 text-white" : "bg-slate-200 text-slate-500"}`}>{badge}</span>}
            </button>
          ))}
        </div>
      </section>

      {countersMissing && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-bold leading-relaxed text-amber-800">
          ⚠ 카운터(누계·사용) 줄을 인식하지 못해 사용량이 0으로 보입니다 — [대장] 탭에서 카운터 줄이 들어왔는지 확인해 주세요. 형식이 다르면 이민구에게 원문을 전달해 주세요.
        </div>
      )}

      {/* ── 요약: 이것만 보면 방문 준비 끝 ── */}
      {tab === "요약" && (
        <>
          <Panel title="한눈 요약" hint={`대장 ${analysis.기간.from} ~ ${analysis.기간.to} · ${analysis.months.length}개월${isAccum ? " · 3개월 누적 청구" : ""}`}>
            <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
              <Stat label="누적 매출" value={man(analysis.누계.판매)} unit="만원" sub={`수금 ${man(analysis.누계.수금)}만원`} color="blue" />
              <Stat label="컬러 활용률" value={`${usage.컬러활용률}%`} sub={`월 ${money(usage.color?.월평균 || 0)} / 기본 ${money(usage.color?.기본매수 || 0)}매`}
                color={usage.컬러활용률 >= 100 ? "red" : usage.컬러활용률 >= 80 ? "amber" : "slate"} />
              <Stat label="흑백 활용률" value={`${usage.흑백활용률}%`} sub={`월 ${money(usage.bw?.월평균 || 0)} / 기본 ${money(usage.bw?.기본매수 || 0)}매`}
                color={usage.흑백활용률 >= 100 ? "red" : "slate"} />
              <Stat label="초과료 누적" value={man(analysis.billing.초과청구합)} unit="만원" sub={`${overCount}회 발생`} color={overCount >= 3 ? "amber" : "slate"} />
              <Stat label="미수 잔액" value={analysis.payment.실질잔액 === 0 ? "없음" : man(analysis.payment.실질잔액)} unit={analysis.payment.실질잔액 ? "만원" : ""}
                sub={`CMS 실패 ${analysis.payment.cms실패}회 · ${analysis.payment.판정}`}
                color={analysis.payment.실질잔액 > 0 || analysis.payment.cms실패 > 0 ? "amber" : "green"} />
            </div>
          </Panel>

          {/* 추천 플랜 — A안 하나만 크게, 대안은 한 줄씩 */}
          <section className="overflow-hidden rounded-2xl border border-blue-200 bg-white">
            <div className="flex flex-col gap-4 bg-gradient-to-br from-blue-600 to-blue-500 p-5 text-white sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold uppercase tracking-wider text-blue-200">추천 플랜</div>
                <div className="mt-0.5 text-2xl font-bold">{recommended.label}</div>
                <div className="mt-1 text-[12px] leading-relaxed text-blue-100">{recommended.reason}</div>
              </div>
              <div className="flex shrink-0 gap-5 text-right">
                <div><div className="text-[10px] text-blue-200">회사 매출</div><div className="text-[15px] font-bold tabular-nums">{money(recommended.companyRevenue)}원</div></div>
                <div><div className="text-[10px] text-blue-200">혜택 비용</div><div className="text-[15px] font-bold tabular-nums">{money(recommended.benefitValue)}원</div></div>
                <div><div className="text-[10px] text-blue-200">ROI</div><div className="text-[15px] font-bold text-amber-300">×{recommended.companyROI}</div></div>
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {alternatives.map((p) => (
                <div key={p.rank} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
                  <span className="w-8 shrink-0 text-[11px] font-bold text-slate-400">{p.rank}안</span>
                  <span className="text-[13px] font-bold text-slate-800">{p.label}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-slate-400">{p.reason}</span>
                  <span className="shrink-0 text-[12px] tabular-nums text-slate-500">비용 {money(p.benefitValue)}원 · ROI ×{p.companyROI}</span>
                </div>
              ))}
            </div>
          </section>

          {/* 주의 — 방문 전에 알아야 하는 것만, 조용한 카드 하나 */}
          {(verdict.위험신호.length > 0 || !!note?.text) && (
            <Panel title="방문 전 확인" hint="위험 신호 · 거래처 특이사항">
              {verdict.위험신호.length > 0 && (
                <ul className="space-y-1.5">
                  {verdict.위험신호.map((flag) => (
                    <li key={flag} className="flex items-start gap-2 text-[13px] leading-relaxed text-slate-700">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />{flag}
                    </li>
                  ))}
                </ul>
              )}
              {!!note?.text && (
                <div className="mt-3 rounded-xl bg-violet-50 p-3.5">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-violet-500">
                    거래처 특이사항{note.author ? ` · ${note.author}` : ""}
                    {note.workStart && <span className="rounded-full bg-white px-2 py-0.5 text-violet-700">출근 {note.workStart}</span>}
                    {note.lunchTime && <span className="rounded-full bg-white px-2 py-0.5 text-violet-700">점심 {note.lunchTime}</span>}
                  </div>
                  <div className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-violet-900">{note.text}</div>
                </div>
              )}
            </Panel>
          )}

          <Panel title="권한 밖 — 제시 금지">
            <div className="flex flex-wrap gap-1.5">
              {verdict.권한밖.map((rule) => (
                <span key={rule} className="rounded-full bg-slate-50 px-3 py-1 text-[12px] font-medium text-slate-500 ring-1 ring-slate-200">{rule}</span>
              ))}
            </div>
          </Panel>
        </>
      )}

      {/* ── 사용량 ── */}
      {tab === "사용량" && (
        <Panel title="월별 사용량" hint={isAccum ? "3개월 누적 청구 — 분기 달에 3개월 합이 찍힙니다" : "카운터가 찍힌 달 기준"}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[440px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] font-semibold text-slate-400">
                  <th className="py-2 pr-3 font-semibold">월</th>
                  <th className="py-2 pr-3 text-right font-semibold">컬러</th>
                  <th className="py-2 pr-3 text-right font-semibold">흑백</th>
                  <th className="py-2 font-semibold">초과</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {analysis.months.filter((month) => month.counters.length > 0).map((month) => {
                  const color = month.counters.filter((counter) => counter.kind !== "흑백").reduce((sum, counter) => sum + counter.사용, 0);
                  const bw = month.counters.filter((counter) => counter.kind === "흑백").reduce((sum, counter) => sum + counter.사용, 0);
                  return (
                    <tr key={month.ym} className="border-b border-slate-50 last:border-0">
                      <td className="py-2.5 pr-3 font-mono text-xs font-bold text-slate-500">{month.ym.replace("-", ".")}</td>
                      <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{money(color)}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-500">{money(bw)}</td>
                      <td className="py-2.5">
                        {month.excesses.length
                          ? month.excesses.map((excess, index) => (
                              <span key={index} className="mr-1 inline-flex items-center gap-1 text-[12px] font-semibold text-red-600">
                                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />{excess.kind} {money(excess.초과)}매 · {money(excess.금액)}원
                              </span>
                            ))
                          : <span className="text-slate-200">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 font-bold text-slate-900">
                  <td className="py-2.5 pr-3 text-xs">합계</td>
                  <td className="py-2.5 pr-3 text-right">{money(usage.total.컬러)}</td>
                  <td className="py-2.5 pr-3 text-right">{money(usage.total.흑백)}</td>
                  <td className="py-2.5 text-[12px] font-semibold text-red-600">{overCount ? `${overCount}회 · ${money(analysis.billing.초과청구합)}원` : ""}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Panel>
      )}

      {/* ── 대장: 이카운트 원문 그대로 ── */}
      {tab === "대장" && (
        <Panel title="판매 · 수금 대장" hint="이카운트 원문 그대로 · 초과 줄은 붉게">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-200 text-left text-[11px] font-semibold text-slate-400">
                  <th className="w-28 py-2 pr-3 font-semibold">일자</th>
                  <th className="py-2 pr-3 font-semibold">적요</th>
                  <th className="w-24 py-2 pr-3 text-right font-semibold">판매</th>
                  <th className="w-24 py-2 pr-3 text-right font-semibold">수금</th>
                  <th className="w-24 py-2 text-right font-semibold">잔액</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {voucherRows.map((row, index) => {
                  if (row.kind === "sub") {
                    return (
                      <tr key={`s-${row.date}-${index}`} className="border-y border-slate-200 bg-slate-50 text-xs font-bold text-slate-500">
                        <td className="py-1.5 pr-3 font-mono" colSpan={2}>{row.date.replace("-", "/")} 계</td>
                        <td className="py-1.5 pr-3 text-right">{row.판매 ? money(row.판매) : ""}</td>
                        <td className="py-1.5 pr-3 text-right">{row.수금 ? money(row.수금) : ""}</td>
                        <td className="py-1.5" />
                      </tr>
                    );
                  }
                  if (row.kind === "item") {
                    return (
                      <tr key={`i-${index}`}>
                        <td className="py-0.5 pr-3" />
                        <td className={`border-l-2 py-0.5 pl-3 pr-3 text-[12px] leading-5 ${row.excess ? "border-red-300 font-semibold text-red-600" : "border-slate-100 text-slate-400"}`}>{row.memo}</td>
                        <td className={`py-0.5 pr-3 text-right text-[12px] ${row.excess ? "font-semibold text-red-600" : "text-slate-400"}`}>{row.판매 ? money(row.판매) : ""}</td>
                        <td className="py-0.5 pr-3" />
                        <td className="py-0.5" />
                      </tr>
                    );
                  }
                  return (
                    <tr key={`v-${row.date}-${row.no}-${index}`} className="border-t border-slate-100">
                      <td className="py-2 pr-3 font-mono text-xs font-bold text-slate-700">{row.date.replace(/-/g, "/")}</td>
                      <td className="py-2 pr-3 text-[13px] font-semibold text-slate-800">{row.memo || <span className="text-slate-300">—</span>}</td>
                      <td className="py-2 pr-3 text-right font-semibold text-slate-900">{row.판매 ? money(row.판매) : ""}</td>
                      <td className="py-2 pr-3 text-right font-semibold text-emerald-600">{row.수금 ? money(row.수금) : ""}</td>
                      <td className="py-2 text-right text-slate-400">{row.잔액 ? money(row.잔액) : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-bold text-slate-900">
                  <td className="py-2.5 pr-3 text-xs" colSpan={2}>누계{overCount ? <span className="ml-2 text-[11px] font-semibold text-red-600">초과 {overCount}회 · {money(analysis.billing.초과청구합)}원</span> : null}</td>
                  <td className="py-2.5 pr-3 text-right">{money(analysis.누계.판매)}</td>
                  <td className="py-2.5 pr-3 text-right">{money(analysis.누계.수금)}</td>
                  <td className="py-2.5 text-right">{money(analysis.누계.잔액)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Panel>
      )}

      {/* ── 계약 · 적요 ── */}
      {tab === "계약·적요" && (
        <Panel title="계약 이력 · 적요" hint="위: 분석 요약(최근 먼저) · 아래: 적요 원문 그대로">
          {!!analysis.contracts.length && (
            <div className="mb-4 divide-y divide-slate-50">
              {analysis.contracts.map((note2, index) => (
                <div key={`${note2.from}-${index}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 first:pt-0 last:pb-0">
                  <span className="font-mono text-[13px] font-bold tabular-nums text-slate-800">{note2.from || "?"} ~ {note2.to || "?"}</span>
                  {!!note2.label && <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white">{note2.label}</span>}
                  {!!note2.models.length && <span className="text-[12px] font-semibold text-slate-600">{note2.models.join(", ")}</span>}
                  {!!note2.월기본료 && <span className="text-[12px] text-slate-500">기본료 <b className="text-slate-800">{money(note2.월기본료)}원</b></span>}
                  {!!note2.컬러기본 && <span className="text-[12px] text-slate-500">컬 <b className="text-slate-800">{money(note2.컬러기본)}</b>/{note2.컬러단가}</span>}
                  {!!note2.흑백기본 && <span className="text-[12px] text-slate-500">흑 <b className="text-slate-800">{money(note2.흑백기본)}</b>/{note2.흑백단가}</span>}
                  {!!note2.보증금 && <span className="text-[12px] text-slate-500">보증금 <b className="text-slate-800">{money(note2.보증금)}원</b></span>}
                  {!!note2.무상.length && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">{note2.무상.join("·")} 무상 유지 확인</span>}
                </div>
              ))}
            </div>
          )}
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-4 font-mono text-[12px] leading-6 text-slate-600">{analysis.remarks || "적요 없음"}</pre>
        </Panel>
      )}

      {/* ── 고객 이력 ── */}
      {tab === "고객 이력" && (
        <>
          {!historyCount && <div className="rounded-2xl border border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-400">이 업체로 조회된 불만·미수·AS·협상 기록이 없습니다.</div>}
          {!!briefing?.bulman.length && (
            <Panel title={`불만 ${briefing.bulman.length}건`}>
              <div className="space-y-2.5">
                {briefing.bulman.slice(0, 5).map((row, index) => (
                  <div key={index} className="text-[13px] leading-relaxed text-slate-700">
                    <span className="mr-2 font-mono text-[11px] font-bold text-slate-400">{row["날짜"]}</span>
                    {!!row["불만유형"] && <span className="mr-1.5 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600">{row["불만유형"]}</span>}
                    {row["불만내용"]}
                  </div>
                ))}
              </div>
            </Panel>
          )}
          {!!briefing?.misu.length && (
            <Panel title={`미수 기록 ${briefing.misu.length}건`}>
              <div className="space-y-2.5">
                {briefing.misu.slice(0, 5).map((row, index) => (
                  <div key={index} className="text-[13px] leading-relaxed text-slate-700">
                    <span className="mr-2 font-mono text-[11px] font-bold text-slate-400">{row["입력일"]}</span>
                    <b className="text-amber-700">{row["미수개월"] || "-"}개월 {row["미수잔액"] ? `${money(Number(row["미수잔액"].replace(/[^0-9]/g, "")) || 0)}원` : ""}</b>
                    {!!row["방문내용"] && <span className="ml-1.5 text-slate-500">{row["방문내용"]}</span>}
                  </div>
                ))}
              </div>
            </Panel>
          )}
          {asHistory.length > 0 && (
            <Panel title={`AS 이력 ${asHistory.length}건`} hint="최근 8건">
              <div className="space-y-2">
                {asHistory.slice(0, 8).map((entry, index) => (
                  <div key={index} className="flex items-start gap-2.5 text-[13px] text-slate-700">
                    <span className="shrink-0 font-mono text-[11px] font-bold text-slate-400">{entry.date.slice(2)}</span>
                    <span className="min-w-0 flex-1">{entry.model && <b className="mr-1 text-slate-500">{entry.model}</b>}{entry.content}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
          {!!briefing?.history.length && (
            <Panel title={`지난 재계약 협상 ${briefing.history.length}건`} hint="/계약갱신 기록">
              <div className="space-y-2.5">
                {briefing.history.slice(0, 4).map((row) => (
                  <div key={row.id} className="text-[13px] leading-relaxed text-slate-700">
                    <span className="mr-2 font-mono text-[11px] font-bold text-slate-400">{row.날짜}</span>
                    {!!row.갱신상태 && <span className="mr-1.5 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-600">{row.갱신상태}</span>}
                    {!!row.갱신위험도 && <span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">위험 {row.갱신위험도}</span>}
                    {row.제안조건}
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </>
      )}
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
  const [gradeFilter, setGradeFilter] = useState<"전체" | "SS" | "S">("전체");
  const [scopeTick, setScopeTick] = useState(0);   // 새로고침 — 워킨맵에서 완료(G5) 처리한 게 바로 반영되게
  useEffect(() => {
    if (!team) return;
    let alive = true;
    setScope(null);
    setTargetLimit(10);
    fetchRenewalScope(quarter as Quarter, team).then((r) => { if (alive) setScope(r); }).catch(() => { if (alive) setScope({ targets: [], quarter: quarter as Quarter, 제외: { 완료: 0, 영업부: 0, 이관: 0, 등급외: 0, 무등급: 0 } }); });
    return () => { alive = false; };
  }, [team, quarter, scopeTick]);

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
            <h2 className="text-sm font-bold text-slate-900">{quarter}Q 재계약 방문 대상{scope ? ` — 총 ${scope.targets.length}곳` : ""} <span className="ml-1 text-[11px] font-medium text-slate-400">워킨맵 기준</span></h2>
          </div>
          {["A", "B", "C", "D"].map((t) => (
            <button key={t} type="button" onClick={() => setTeam(t)}
              className={`rounded-full px-3 py-1.5 text-[12px] font-bold transition ${team === t ? "bg-slate-900 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200 hover:text-slate-800"}`}>
              {t}팀{t === myTeam ? " ★" : ""}
            </button>
          ))}
          <button type="button" onClick={() => setScopeTick((n) => n + 1)}
            className="rounded-full bg-white px-3 py-1.5 text-[12px] font-bold text-slate-500 ring-1 ring-slate-200 transition hover:text-slate-800">↻ 새로고침</button>
        </div>
        {!!scope && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-4 py-2">
            {(["전체", "SS", "S"] as const).map((g) => {
              const count = g === "전체" ? scope.targets.length : scope.targets.filter((t) => t.등급 === g).length;
              return (
                <button key={g} type="button" onClick={() => { setGradeFilter(g); setTargetLimit(10); }}
                  className={`rounded-full px-3 py-1 text-[11px] font-bold transition ${gradeFilter === g ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:text-slate-800"}`}>
                  {g} {count}
                </button>
              );
            })}
            <span className="ml-auto text-[10px] font-semibold text-slate-400">
              분석됨 {scope.targets.filter((t) => analyzedKeys.has(t.key)).length}/{scope.targets.length}
              {scope.제외.완료 > 0 && ` · 워킨맵 완료(G5) ${scope.제외.완료}곳 제외됨`}
            </span>
          </div>
        )}
        {scope === null && <div className="px-4 py-8 text-center text-xs font-bold text-slate-400">워킨맵 목록을 불러오는 중…</div>}
        {!!scope && !scope.targets.length && <div className="px-4 py-8 text-center text-xs font-bold text-slate-400">{team}팀 {quarter}Q 방문 대상이 없습니다.</div>}
        {!!scope && scope.targets.length > 0 && (() => {
          const filtered = gradeFilter === "전체" ? scope.targets : scope.targets.filter((t) => t.등급 === gradeFilter);
          return (
          <div className="divide-y divide-slate-50">
            {filtered.slice(0, targetLimit).map((target) => {
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
            {filtered.length > targetLimit && (
              <button type="button" onClick={() => setTargetLimit((n) => n + 20)}
                className="w-full py-2.5 text-center text-xs font-bold text-blue-600 transition hover:bg-blue-50/40">더 보기 ({filtered.length - targetLimit}곳 남음)</button>
            )}
            {!filtered.length && <div className="px-4 py-6 text-center text-xs font-bold text-slate-400">{gradeFilter}급 대상이 없습니다.</div>}
          </div>
          );
        })()}
      </section>
    </div>
  );
}
