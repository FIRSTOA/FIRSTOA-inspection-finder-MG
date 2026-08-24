/**
 * 재계약 제안 한 장 — 방문 전에 이것만 보면 되게.
 *
 * 위에서 아래로 읽는 순서가 곧 상담 순서다:
 *   판정 한 줄 → 협상 카드(추천/차선) → 그 카드를 고른 근거(사용량·수금) → 주의 → 계약 이력 → 권한 밖
 *
 * 대장 텍스트는 이 기기에만 남긴다(localStorage). 붙여넣은 걸 팀과 공유하려면 DB 저장이 필요한데
 * 그건 recontract_prep 테이블을 만든 뒤에 붙인다.
 */
import { useEffect, useMemo, useState } from "react";
import { ClipboardCopy, ClipboardPaste, Trash2 } from "lucide-react";
import { notify } from "../toast";
import { analyzeLedger, type LedgerAnalysis } from "./ledger";
import { judge, type Judgement } from "./judge";

const money = (value: number) => value.toLocaleString("ko-KR");
const STORE_PREFIX = "recontract_ledger_";

function Stat({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 py-2">
      <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-0.5 truncate text-[13px] font-black ${tone || "text-slate-900"}`}>{value}</div>
    </div>
  );
}

/**
 * 월별 사용량 — 기본매수 선을 넘는 달이 눈에 바로 보이게.
 * 기본매수가 실사용보다 훨씬 크면(흑백 기본 3,000에 월 330장) 선을 그리면 막대가 눌려 안 보인다.
 * 그때는 사용량 기준으로 스케일을 잡고 기본선은 글로만 적는다.
 */
const HEIGHT = 64;
function UsageBars({ analysis, kind, base }: { analysis: LedgerAnalysis; kind: "컬러" | "흑백"; base: number }) {
  const series = analysis.months.map((month) => ({
    ym: month.ym,
    used: month.counters
      .filter((counter) => (kind === "컬러" ? counter.kind.startsWith("컬러") : counter.kind === "흑백"))
      .reduce((sum, counter) => sum + counter.사용, 0),
    over: month.excesses.some((excess) => excess.kind === kind),
  }));
  if (!series.length) return null;
  const peak = Math.max(...series.map((point) => point.used), 1);
  const 선표시 = !!base && base <= peak * 2.2;
  const ceiling = 선표시 ? Math.max(peak, base) * 1.12 : peak * 1.12;
  return (
    <div>
      <div className="relative" style={{ height: HEIGHT }}>
        <div className="absolute inset-0 flex items-end gap-[3px]">
          {series.map((point) => (
            <div key={point.ym} className={`flex-1 rounded-t ${point.over ? "bg-rose-500" : base && point.used > base ? "bg-amber-500" : kind === "컬러" ? "bg-blue-500" : "bg-slate-500"}`}
              style={{ height: Math.max(2, Math.round((point.used / ceiling) * HEIGHT)) }}
              title={`${point.ym} · ${money(point.used)}매`} />
          ))}
        </div>
        {선표시 && (
          <div className="absolute left-0 right-0 border-t border-dashed border-rose-400"
            style={{ bottom: Math.round((base / ceiling) * HEIGHT) }}>
            <span className="absolute right-0 top-0.5 rounded bg-white/80 px-1 text-[10px] font-black text-rose-500">기본 {money(base)}매</span>
          </div>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] font-bold text-slate-400">
        <span>{series[0].ym.replace("-", ".")}</span>
        {!선표시 && !!base && <span className="text-slate-500">기본 {money(base)}매 — 사용량이 크게 미달</span>}
        <span>{series[series.length - 1].ym.replace("-", ".")}</span>
      </div>
    </div>
  );
}

/** 카톡에 붙일 한 장 텍스트 */
function sheetText(analysis: LedgerAnalysis, verdict: Judgement): string {
  const lines = [
    `[재계약 제안] ${analysis.vendor}`,
    `${verdict.헤드라인}`,
    "",
    `■ 판정`,
    `- 거래 ${verdict.거래연차}년차 ${verdict.거래관계} · ${verdict.거래처유형} · 난이도 ${verdict.난이도}`,
    `- 추천 계약기간 ${verdict.추천기간}년`,
    `- 추천 카드: ${verdict.추천카드}${verdict.혜택필요 ? "" : " (혜택 없이 1차 시도)"}`,
    `- 차선: ${verdict.차선카드}`,
    "",
    `■ 근거`,
    ...analysis.usage.map((stat) =>
      `- ${stat.kind} 월평균 ${money(stat.월평균)}매${stat.기본매수 ? ` / 기본 ${money(stat.기본매수)}매 (여유 ${stat.여유율}%)` : ""}`
      + `${stat.초과월수 ? ` · 초과 ${stat.초과월수}개월` : ""} · ${stat.추세}`),
    `- 월기본료 ${money(analysis.billing.월기본료)}원 · 최근청구 ${money(analysis.billing.최근청구)}원`,
    `- 수금 ${analysis.payment.판정} (평균 ${analysis.payment.평균지연일}일 · ${analysis.payment.완납월수}/${analysis.payment.청구월수}개월 완납)`,
  ];
  if (verdict.위험신호.length) lines.push("", "■ 주의", ...verdict.위험신호.map((flag) => `- ${flag}`));
  if (analysis.contracts.length) {
    lines.push("", "■ 계약 이력");
    for (const note of analysis.contracts.slice(0, 5)) {
      lines.push(`- ${note.from || "?"}~${note.to || "?"} ${note.label}${note.월기본료 ? ` · 월 ${money(note.월기본료)}원` : ""}`
        + `${note.컬러기본 ? ` (컬 ${note.컬러기본}/${note.컬러단가} 흑 ${note.흑백기본}/${note.흑백단가})` : ""}`);
    }
  }
  lines.push("", `■ 권한 밖 (제시 금지)`, ...verdict.권한밖.map((item) => `- ${item}`));
  return lines.join("\n");
}

export default function ProposalSheet({ vendorKey, vendorName }: { vendorKey: string; vendorName: string }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);

  // 이 기기에 남겨둔 대장 — 방문 준비를 며칠에 걸쳐 하니 다시 붙이게 하면 안 된다
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORE_PREFIX + vendorKey);
      setText(saved || "");
      setOpen(!saved);
    } catch { /* 저장소 접근 불가는 무시 */ }
  }, [vendorKey]);

  const result = useMemo(() => {
    const body = text.trim();
    if (!body) return null;
    try {
      const analysis = analyzeLedger(body);
      if (!analysis.months.length && !analysis.contracts.length) return { error: "대장 형식을 못 읽었습니다 — '판매/수금내역'까지 포함해 전체를 붙여주세요." } as const;
      return { analysis, verdict: judge(analysis) } as const;
    } catch (e) {
      return { error: (e as Error).message } as const;
    }
  }, [text]);

  const save = (next: string) => {
    setText(next);
    try {
      if (next.trim()) localStorage.setItem(STORE_PREFIX + vendorKey, next);
      else localStorage.removeItem(STORE_PREFIX + vendorKey);
    } catch { /* 무시 */ }
  };

  const paste = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip.trim()) { notify("클립보드가 비어 있습니다.", "info"); return; }
      save(clip);
      setOpen(false);
      notify("대장을 읽었습니다 ✓", "success");
    } catch {
      notify("클립보드를 읽지 못했습니다 — 입력창에 직접 붙여주세요(Ctrl+V).", "info");
      setOpen(true);
    }
  };

  const copySheet = async () => {
    if (!result || "error" in result) return;
    try {
      await navigator.clipboard.writeText(sheetText(result.analysis, result.verdict));
      notify("제안 한 장을 복사했습니다 ✓", "success");
    } catch {
      notify("복사 실패 — 화면에서 직접 선택해 복사하세요.", "error");
    }
  };

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-3.5 py-2">
        <h3 className="text-[13px] font-black text-slate-900">재계약 제안 한 장</h3>
        <span className="text-[11px] font-semibold text-slate-400">이카운트 거래처관리대장 기준</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={() => void paste()}
            className="flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-black text-white transition hover:bg-slate-800">
            <ClipboardPaste size={13} /> 대장 붙여넣기
          </button>
          {!!text && (
            <>
              <button type="button" onClick={() => void copySheet()}
                className="flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11px] font-black text-white transition hover:bg-blue-700">
                <ClipboardCopy size={13} /> 한 장 복사
              </button>
              <button type="button" onClick={() => { save(""); setOpen(true); }} aria-label="지우기"
                className="flex items-center rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-slate-500 transition hover:bg-slate-50">
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      </div>

      {(open || !text) && (
        <div className="border-b border-slate-100 p-3.5">
          <p className="mb-2 text-[11px] font-bold leading-relaxed text-slate-500">
            이카운트 → 회계 I → 출력물 → <b className="text-slate-700">거래처관리대장 I</b>에서 <b className="text-slate-700">{vendorName}</b> 조회 →
            화면 전체 선택(Ctrl+A) → 복사(Ctrl+C) → 아래에 붙여넣기.
            <span className="text-slate-400"> 적요와 판매/수금내역이 모두 들어와야 분석됩니다.</span>
          </p>
          <textarea value={text} onChange={(e) => save(e.target.value)} rows={5}
            placeholder="여기에 대장 전체를 붙여넣으세요"
            className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 font-mono text-[11px] text-slate-800 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
        </div>
      )}

      {!!result && "error" in result && (
        <div className="m-3.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[12px] font-bold text-rose-700">{result.error}</div>
      )}

      {!!result && !("error" in result) && (() => {
        const { analysis, verdict } = result;
        return (
          <div className="space-y-3 p-3.5">
            {/* 판정 한 줄 — 이 문장이 상담의 첫 마디다 */}
            <div className="rounded-xl bg-[#1E252F] px-3.5 py-3">
              <div className="text-[11px] font-black uppercase tracking-wide text-slate-400">판정</div>
              <div className="mt-0.5 text-[13px] font-black leading-snug text-white">{verdict.헤드라인}</div>
              {analysis.vendor !== vendorName && (
                <div className="mt-1 text-[11px] font-bold text-amber-300">
                  붙여넣은 대장은 “{analysis.vendor}” — 다른 업체가 아닌지 확인하세요
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="거래 관계" value={`${verdict.거래연차}년차 ${verdict.거래관계}`} />
              <Stat label="거래처 유형" value={verdict.거래처유형} />
              <Stat label="난이도" value={verdict.난이도}
                tone={verdict.난이도 === "쉬움" ? "text-emerald-600" : verdict.난이도.includes("어려") ? "text-rose-600" : "text-slate-900"} />
              <Stat label="추천 계약기간" value={`${verdict.추천기간}년`} />
            </div>

            {/* 협상 카드 */}
            <div className="rounded-xl border-2 border-blue-200 bg-blue-50/60 px-3.5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-blue-600 px-2.5 py-1 text-[11px] font-black text-white">추천 카드</span>
                <span className="text-[15px] font-black text-slate-900">{verdict.추천카드}</span>
                {!verdict.혜택필요 && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-black text-emerald-700">혜택 없이 1차 시도</span>}
              </div>
              <div className="mt-1.5 text-[12px] font-bold text-slate-600">차선 · {verdict.차선카드}</div>
              <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {verdict.혜택가치.map((card) => (
                  <div key={card.card} className={`rounded-lg border px-2.5 py-1.5 ${card.card === verdict.추천카드 ? "border-blue-400 bg-white" : "border-slate-200 bg-white/70"}`}>
                    <div className="text-[11px] font-black text-slate-800">{card.card}</div>
                    <div className="text-[12px] font-black tabular-nums text-slate-900">{card.value === null ? "별도 산정" : `${money(card.value)}원`}</div>
                    <div className="text-[10px] font-semibold text-slate-400">{card.note}</div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] font-bold text-slate-500">회사 손해 기준 · 계약기간 {verdict.추천기간}년(={verdict.추천기간 * 12}개월) 전체로 환산해 비교</p>
            </div>

            {/* 근거 */}
            <div className="grid gap-2 sm:grid-cols-2">
              {analysis.usage.map((stat) => (
                <div key={stat.kind} className="rounded-xl border border-slate-200 px-3 py-2.5">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[12px] font-black text-slate-900">{stat.kind}</span>
                    <span className="text-[12px] font-black tabular-nums text-slate-700">월평균 {money(stat.월평균)}매</span>
                    {!!stat.기본매수 && (
                      <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-black ${stat.여유율 <= 0 ? "bg-rose-100 text-rose-700" : stat.여유율 < 20 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700"}`}>
                        여유 {stat.여유율}%
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] font-bold text-slate-500">
                    기본 {stat.기본매수 ? `${money(stat.기본매수)}매 (${stat.기본매수출처})` : "미확인"} · 최근3개월 {money(stat.최근3평균)}매 · {stat.추세}
                    {stat.초과월수 ? ` · 초과 ${stat.초과월수}개월` : ""}
                  </div>
                  <div className="mt-2">
                    <UsageBars analysis={analysis} kind={stat.kind as "컬러" | "흑백"} base={stat.기본매수} />
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="월 기본료" value={`${money(analysis.billing.월기본료)}원`} />
              <Stat label="최근 청구" value={`${money(analysis.billing.최근청구)}원`} />
              <Stat label="초과 청구 누계" value={`${money(analysis.billing.초과청구합)}원`} tone={analysis.billing.초과청구합 ? "text-amber-700" : ""} />
              <Stat label="수금" value={`${analysis.payment.판정} · 평균 ${analysis.payment.평균지연일}일`}
                tone={analysis.payment.판정 === "우량" ? "text-emerald-600" : analysis.payment.판정 === "주의" ? "text-rose-600" : ""} />
            </div>

            {!!verdict.위험신호.length && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5">
                <div className="text-[11px] font-black uppercase tracking-wide text-amber-700">주의</div>
                <ul className="mt-1 space-y-0.5">
                  {verdict.위험신호.map((flag) => (
                    <li key={flag} className="text-[12px] font-bold text-amber-900">· {flag}</li>
                  ))}
                </ul>
              </div>
            )}

            {!!analysis.contracts.length && (
              <div className="rounded-xl border border-slate-200 px-3.5 py-2.5">
                <div className="text-[11px] font-black uppercase tracking-wide text-slate-400">계약 이력 (적요)</div>
                <div className="mt-1.5 space-y-1.5">
                  {analysis.contracts.map((note, index) => (
                    <div key={`${note.from}-${index}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-slate-100 pb-1.5 last:border-0 last:pb-0">
                      <span className="text-[12px] font-black tabular-nums text-slate-700">{note.from || "?"} ~ {note.to || "?"}</span>
                      {!!note.label && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-600">{note.label}</span>}
                      {!!note.models.length && <span className="text-[11px] font-bold text-slate-600">{note.models.join(", ")}</span>}
                      {!!note.월기본료 && <span className="text-[11px] font-black tabular-nums text-slate-800">월 {money(note.월기본료)}원</span>}
                      {!!note.컬러기본 && <span className="text-[11px] font-bold text-slate-500">컬 {note.컬러기본}/{note.컬러단가} · 흑 {note.흑백기본}/{note.흑백단가}</span>}
                      {!!note.보증금 && <span className="text-[11px] font-bold text-slate-500">보증금 {money(note.보증금)}원</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
              <div className="text-[11px] font-black uppercase tracking-wide text-slate-400">권한 밖 — 제시 금지</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {verdict.권한밖.map((item) => (
                  <span key={item} className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-slate-500 ring-1 ring-slate-200">{item}</span>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
    </section>
  );
}
