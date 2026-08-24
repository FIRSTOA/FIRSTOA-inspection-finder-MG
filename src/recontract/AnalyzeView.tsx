/**
 * 이카운트 분석 — 옛 재계약 웹앱(recontract_webapp)의 화면 구조를 그대로 옮긴 것.
 *
 * 입력: 이카운트 거래처관리대장 I 화면 전체 복사(Ctrl+A → Ctrl+C) → 붙여넣기 → 분석.
 * 프로그램 설치·자동 로그인 없이 전 직원이 쓸 수 있는 경로다.
 *
 * 화면 순서(원본 InternalView 그대로):
 *   다크 히어로(핵심 판단) → 판정 배지 → 핵심 지표 4칸 → 계약 이력(적요) →
 *   월별 사용량 추이 → 추천 플랜 A/B/C → 위험 플래그 / 권한 밖 → 예상 상담 시나리오
 *
 * 분석 결과는 이 기기(localStorage)에 남아 거래처 카드 목록으로 쌓인다.
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ClipboardPaste, TrendingUp, Trash2, X } from "lucide-react";
import { notify } from "../toast";
import { analyzeLedger, type LedgerAnalysis } from "./ledger";
import { judge, type Judgement } from "./judge";
import { calcProposals, type Proposal } from "./proposals";
import { buildCounseling } from "./scenario";

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

/** 월별 사용량 — 컬러·흑백 막대 + 기본매수 선 (원본 UsageChart 자리) */
function UsageChart({ analysis, kind }: { analysis: LedgerAnalysis; kind: "컬러" | "흑백" }) {
  const stat = analysis.usage.find((u) => u.kind === kind);
  const series = analysis.months.map((m) => ({
    ym: m.ym,
    used: m.counters.filter((c) => (kind === "컬러" ? c.kind.startsWith("컬러") : c.kind === "흑백")).reduce((s, c) => s + c.사용, 0),
    over: m.excesses.some((e) => e.kind === kind),
  }));
  if (!series.length) return <div className="py-6 text-center text-xs text-slate-400">카운터 데이터 없음</div>;
  const base = stat?.기본매수 || 0;
  const peak = Math.max(...series.map((p) => p.used), 1);
  const showLine = !!base && base <= peak * 2.2;
  const ceiling = (showLine ? Math.max(peak, base) : peak) * 1.12;
  const H = 120;
  return (
    <div>
      <div className="relative" style={{ height: H }}>
        <div className="absolute inset-0 flex items-end gap-[3px]">
          {series.map((p) => (
            <div key={p.ym} title={`${p.ym} · ${money(p.used)}매`}
              className={`flex-1 rounded-t ${p.over ? "bg-red-500" : base && p.used > base ? "bg-amber-400" : kind === "컬러" ? "bg-blue-500" : "bg-slate-400"}`}
              style={{ height: Math.max(3, Math.round((p.used / ceiling) * H)) }} />
          ))}
        </div>
        {showLine && (
          <div className="absolute left-0 right-0 border-t border-dashed border-red-400" style={{ bottom: Math.round((base / ceiling) * H) }}>
            <span className="absolute right-0 top-0.5 rounded bg-white/85 px-1 text-[10px] font-bold text-red-500">기본 {money(base)}매</span>
          </div>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] font-medium text-slate-400">
        <span>{series[0].ym.replace("-", ".")}</span>
        <span>월평균 {money(stat?.월평균 || 0)}매{!showLine && base ? ` · 기본 ${money(base)}매 (크게 미달)` : ""}</span>
        <span>{series[series.length - 1].ym.replace("-", ".")}</span>
      </div>
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

function ScenarioItem({ scenario, index }: { scenario: { reaction: string; intent: string; response: string; followUp: string }; index: number }) {
  const [open, setOpen] = useState(index <= 2);
  return (
    <div className="overflow-hidden rounded-xl border border-slate-100">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 p-4 text-left hover:bg-slate-50">
        <span className="rounded bg-slate-900 px-2 py-1 text-[10px] font-bold tracking-wider text-white">{String(index).padStart(2, "0")}</span>
        <span className="flex-1 text-sm font-medium text-slate-900">"{scenario.reaction}"</span>
        <ChevronRight size={15} className={`text-slate-400 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-slate-100 bg-slate-50 px-4 pb-4 pt-3">
          <div className="grid gap-1 sm:grid-cols-[80px_1fr]"><span className="text-[11px] font-bold text-slate-400">상담 의도</span><span className="text-sm text-slate-700">{scenario.intent}</span></div>
          <div className="grid gap-1 sm:grid-cols-[80px_1fr]"><span className="text-[11px] font-bold text-slate-400">추천 답변</span><span className="block rounded-lg border border-slate-100 bg-white p-3 text-sm leading-relaxed text-slate-800">{scenario.response}</span></div>
          <div className="grid gap-1 sm:grid-cols-[80px_1fr]"><span className="text-[11px] font-bold text-slate-400">유도 멘트</span><em className="text-sm text-blue-700">{scenario.followUp}</em></div>
        </div>
      )}
    </div>
  );
}

// ─── 상세 (원본 InternalView 구조) ──────────────────────────────────────────

function DetailView({ item, onBack, onRemove }: { item: Analyzed; onBack: () => void; onRemove: () => void }) {
  const { analysis, verdict } = item;
  const proposals = useMemo(() => calcProposals(analysis, verdict), [analysis, verdict]);
  const counseling = useMemo(() => buildCounseling(analysis, verdict), [analysis, verdict]);
  const recommended = proposals.find((p) => p.recommended)!;
  const overCount = analysis.usage.reduce((sum, stat) => sum + stat.초과월수, 0);
  const 미납실질 = analysis.payment.미납월.filter((ym) => ym !== analysis.months[analysis.months.length - 1]?.ym).length;
  const current = analysis.현재계약;

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
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KPI label="누적 매출" value={man(analysis.누계.판매)} unit="만원" sub={`수금 ${man(analysis.누계.수금)}만원`} tone="blue" />
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

      {/* 월별 사용량 추이 */}
      <section className="rounded-2xl border border-slate-100 bg-white p-6">
        <h2 className="mb-5 text-base font-bold text-slate-900">월별 사용량 추이</h2>
        <div className="grid gap-6 lg:grid-cols-2">
          <div><div className="mb-2 text-xs font-bold text-blue-600">컬러</div><UsageChart analysis={analysis} kind="컬러" /></div>
          <div><div className="mb-2 text-xs font-bold text-slate-500">흑백</div><UsageChart analysis={analysis} kind="흑백" /></div>
        </div>
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

      {/* 예상 상담 시나리오 */}
      <section className="rounded-2xl border border-slate-100 bg-white p-6">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-bold text-slate-900">예상 상담 시나리오 ({counseling.scenarios.length}건)</h2>
          <span className="text-[11px] font-medium text-slate-400">1차 방향 — {counseling.firstApproach}</span>
        </div>
        <div className="space-y-2">{counseling.scenarios.map((s, i) => <ScenarioItem key={s.reaction} scenario={s} index={i + 1} />)}</div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl bg-rose-50 p-3 text-xs leading-relaxed text-rose-700"><b>금지 표현</b> · {counseling.avoidPhrases.join(" / ")}</div>
          <div className="rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600"><b>마무리 멘트</b> · {counseling.closing}</div>
        </div>
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
