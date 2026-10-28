/**
 * 통합검색 "무엇이든 묻기" 답 표시 전용 부품 — 순수 props, 데이터 조회·상태 저장 없음.
 * Search360.tsx 가 data-ask 응답을 AskAnswerView 모양으로 바꿔 넘기면 된다.
 * 구성: AskRouteLine(라우트 한 줄·진행 단계) / AskAnswerCard(결론·잘된 점·부족한 점·근거 탭·다음 할 일) / AskLimitNotice(상한 안내)
 * 스타일은 Search360 카드(흰 바탕·slate 테두리·emerald 머리표)를 따른다. 강한 채움 색은 쓰지 않는다.
 */
import { useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, CircleDashed, Copy, Loader2, SearchX, X } from "lucide-react";

export type AskMode = "analysis" | "data" | "entity";

/** 부족한 점 한 줄 — rule 은 어떤 작성 규칙에 어긋났는지(선택) */
export interface AskGap { text: string; rule?: string }

/** 근거 묶음(도구 하나 = 탭 하나). rows 는 이미 가린(askMask) 값. */
export interface AskEvidenceGroup {
  id: string;
  /** 탭 글자 예: "OKR 주차별 판정" */
  title: string;
  /** 도구 이름(작게 표시) 예: okr_member_report */
  tool?: string;
  rows: Array<Record<string, unknown>>;
  /** 보여줄 칸 순서. 없으면 첫 행의 키 앞 6개 */
  columns?: string[];
  /** 문제 행 강조 칸: 이 칸 값이 비어 있으면 노랑으로 표시 (예 "판정") */
  warnWhenEmpty?: string;
}

export interface AskLimit {
  reason: "cost" | "time" | "rounds" | "daily";
  calls: number;
  usd?: number;
}

export interface AskAnswerView {
  question: string;
  mode: AskMode;
  /** 결론 한 줄(숫자·기간·기준 포함) */
  conclusion: string;
  strengths: string[];
  gaps: AskGap[];
  evidence: AskEvidenceGroup[];
  nextSteps: string[];
  /** 계산 기준·빠졌을 수 있는 것 한 줄 */
  basis?: string;
  /** 구조화되지 않은 일반 답(전체 질문·업체 질문) — 있으면 결론 위주 카드 대신 본문으로 */
  body?: string;
  /** 비용·시간 한 줄 예: "gpt-5.5 · 조회 4번 · $0.21 · 24초" */
  usageLine?: string;
  limit?: AskLimit;
}

export type AskViewState = "idle" | "loading" | "error" | "done";

const MODE_LABEL: Record<AskMode, string> = { analysis: "분석", data: "전체 질문", entity: "업체 질문" };

const LIMIT_TEXT: Record<AskLimit["reason"], string> = {
  cost: "한 질문 비용 상한에 닿아",
  time: "시간 상한에 닿아",
  rounds: "조회 횟수 상한에 닿아",
  daily: "오늘 분석 질문 한도에 닿아",
};

const cell = (v: unknown): string => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
const isEmpty = (v: unknown) => v == null || String(v).trim() === "";

function Section({ icon, title, tone, children }: { icon: ReactNode; title: string; tone: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5">
      <div className={`flex items-center gap-1.5 text-[12px] font-black ${tone}`}>{icon}{title}</div>
      {children}
    </div>
  );
}

/** 라우트 한 줄 + 진행 단계. steps 는 한국어 단계 이름, active 는 지금 단계 번호(0부터), 끝나면 active = steps.length */
export function AskRouteLine({ routeNote, steps = [], active = 0 }: { routeNote: string; steps?: string[]; active?: number }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-bold text-slate-500">{routeNote}</div>
      {steps.length > 0 && (
        <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[11px] font-bold">
          {steps.map((s, i) => {
            const done = i < active;
            const now = i === active;
            return (
              <li key={s} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={11} className="text-slate-300" />}
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${done ? "border-emerald-200 bg-white text-emerald-700" : now ? "border-slate-300 bg-slate-50 text-slate-800" : "border-slate-200 bg-white text-slate-400"}`}>
                  {done ? <CheckCircle2 size={11} /> : now ? <Loader2 size={11} className="animate-spin" /> : <CircleDashed size={11} />}{s}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** 상한에 걸려 중간까지로 답했을 때의 안내 */
export function AskLimitNotice({ limit }: { limit: AskLimit }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5 text-[12px] font-bold leading-5 text-amber-900">
      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
      <div>
        {LIMIT_TEXT[limit.reason]} 여기까지 읽고 답했습니다 (조회 {limit.calls}번{limit.usd != null ? `, $${limit.usd.toFixed(2)}` : ""}).
        <div className="font-semibold text-amber-800">기간이나 대상을 좁혀서 다시 물어보시면 더 정확하게 답해 드립니다.</div>
      </div>
    </div>
  );
}

/** 근거 묶음 탭 — 폰은 행을 카드로, sm 이상은 표로 */
export function AskEvidenceTabs({ groups, onRowClick }: { groups: AskEvidenceGroup[]; onRowClick?: (group: AskEvidenceGroup, row: Record<string, unknown>) => void }) {
  const [sel, setSel] = useState(0);
  if (!groups.length) return <div className="rounded-lg bg-slate-50 px-3 py-3 text-center text-[12px] font-bold text-slate-500">이 답에는 따로 조회한 근거 표가 없습니다.</div>;
  const g = groups[Math.min(sel, groups.length - 1)];
  const cols = g.columns && g.columns.length ? g.columns : Object.keys(g.rows[0] ?? {}).slice(0, 6);
  const rows = g.rows.slice(0, 60);
  const warn = (r: Record<string, unknown>) => !!g.warnWhenEmpty && isEmpty(r[g.warnWhenEmpty]);
  return (
    <div>
      <div role="tablist" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1.5">
        {groups.map((x, i) => (
          <button key={x.id} type="button" role="tab" aria-selected={i === sel} onClick={() => setSel(i)}
            className={`min-h-11 shrink-0 rounded-full border px-3 text-[12px] font-black transition sm:min-h-9 ${i === sel ? "border-slate-800 bg-white text-slate-900 shadow-sm" : "border-slate-200 bg-white text-slate-500 hover:text-slate-800"}`}>
            {x.title} <span className="tabular-nums text-slate-400">{x.rows.length}</span>
          </button>
        ))}
      </div>
      {g.tool && <div className="mb-1.5 font-mono text-[10px] font-bold text-slate-400">{g.tool}</div>}
      {!rows.length ? (
        <div className="rounded-lg bg-slate-50 px-3 py-3 text-center text-[12px] font-bold text-slate-500">조건에 맞는 행이 없습니다.</div>
      ) : (
        <>
          <ul className="space-y-1.5 sm:hidden">
            {rows.map((r, i) => (
              <li key={i}>
                <button type="button" disabled={!onRowClick} onClick={() => onRowClick?.(g, r)}
                  className={`block min-h-11 w-full rounded-lg border px-3 py-2 text-left ${warn(r) ? "border-amber-200 bg-amber-50/50" : "border-slate-200 bg-white"}`}>
                  {cols.map((c) => (
                    <div key={c} className="flex gap-2 text-[12px] leading-5">
                      <span className="w-16 shrink-0 font-black text-slate-400">{c}</span>
                      <span className={`min-w-0 break-words font-semibold ${isEmpty(r[c]) ? "text-amber-700" : "text-slate-800"}`}>{isEmpty(r[c]) ? "(빈칸)" : cell(r[c])}</span>
                    </div>
                  ))}
                </button>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-lg border border-slate-200 sm:block">
            <table className="min-w-full text-[12px]">
              <thead className="bg-slate-50 text-left font-black text-slate-500"><tr>{cols.map((c) => <th key={c} className="px-2.5 py-1.5">{c}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} onClick={() => onRowClick?.(g, r)} className={`border-t border-slate-100 ${warn(r) ? "bg-amber-50/50" : ""} ${onRowClick ? "cursor-pointer hover:bg-slate-50" : ""}`}>
                    {cols.map((c) => <td key={c} className={`max-w-[260px] truncate px-2.5 py-1.5 font-semibold ${isEmpty(r[c]) ? "text-amber-700" : "text-slate-700"}`} title={cell(r[c])}>{isEmpty(r[c]) ? "(빈칸)" : cell(r[c])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {g.rows.length > rows.length && <div className="mt-1 text-[10.5px] font-bold text-slate-400">앞 {rows.length}행만 보입니다 (전체 {g.rows.length}행).</div>}
        </>
      )}
    </div>
  );
}

/** 답 카드. state 가 done 이 아니면 로딩·에러·빈 상태 틀을 보여 준다. */
export default function AskAnswerCard({
  state = "done", answer, errorMessage, steps, activeStep, routeNote, onRetry, onCopy, onDismiss, onRowClick,
}: {
  state?: AskViewState;
  answer?: AskAnswerView;
  errorMessage?: string;
  steps?: string[];
  activeStep?: number;
  routeNote?: string;
  onRetry?: () => void;
  onCopy?: (text: string) => void;
  onDismiss?: () => void;
  onRowClick?: (group: AskEvidenceGroup, row: Record<string, unknown>) => void;
}) {
  const shell = "rounded-xl border border-slate-200 bg-white p-4 shadow-sm";

  if (state === "loading") {
    return (
      <section className={shell} aria-busy="true">
        <div className="flex items-center gap-2 text-[13px] font-black text-slate-800"><Loader2 size={15} className="animate-spin text-emerald-600" />기록을 읽고 답을 쓰는 중입니다</div>
        <div className="mt-2"><AskRouteLine routeNote={routeNote ?? "질문을 확인하고 있습니다."} steps={steps} active={activeStep} /></div>
        <div className="mt-3 space-y-1.5" aria-hidden="true"><div className="h-3 w-3/4 animate-pulse rounded bg-slate-100" /><div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" /></div>
        <div className="mt-2 text-[11px] font-semibold text-slate-500">분석 질문은 30초에서 1분 넘게 걸릴 수 있습니다. 잠시만 기다려 주세요.</div>
      </section>
    );
  }
  if (state === "error") {
    return (
      <section className="rounded-xl border border-red-200 bg-white p-4 shadow-sm" role="alert">
        <div className="flex items-center gap-1.5 text-[13px] font-black text-red-700"><AlertTriangle size={15} />답을 만들지 못했습니다</div>
        <div className="mt-1 text-[12.5px] font-semibold leading-6 text-slate-700">{errorMessage || "잠시 뒤 다시 시도해 주세요."}</div>
        {onRetry && <button type="button" onClick={onRetry} className="mt-2.5 inline-flex min-h-11 items-center rounded-full border border-slate-300 bg-white px-4 text-[12.5px] font-black text-slate-700 hover:bg-slate-50">다시 묻기</button>}
      </section>
    );
  }
  const empty = state === "idle" || !answer || (!answer.body && !answer.conclusion && !answer.evidence.length);
  if (empty || !answer) {
    return (
      <section className={`${shell} text-center`}>
        <SearchX size={22} className="mx-auto text-slate-300" />
        <div className="mt-1.5 text-[13px] font-black text-slate-700">{state === "idle" ? "아직 질문하지 않으셨습니다" : "기록에서 답할 근거를 찾지 못했습니다"}</div>
        <div className="mt-0.5 text-[12px] font-semibold text-slate-500">{state === "idle" ? "위 입력칸에 궁금한 것을 문장으로 적어 주세요." : "이름·기간·팀을 조금 더 구체적으로 적어 다시 물어봐 주세요."}</div>
      </section>
    );
  }

  const a = answer;
  const plain = [a.conclusion, ...a.strengths.map((s) => `+ ${s}`), ...a.gaps.map((g) => `- ${g.text}`), ...a.nextSteps.map((s, i) => `${i + 1}. ${s}`)].join("\n");
  return (
    <section className={shell}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-[11px] font-black text-emerald-700">
          <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px]">{MODE_LABEL[a.mode]}</span>
          <span className="min-w-0 truncate text-slate-700">Q. {a.question}</span>
        </div>
        <div className="flex gap-1.5">
          {onCopy && <button type="button" onClick={() => onCopy(a.body ?? plain)} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-slate-300 bg-white px-3 text-[11px] font-black text-slate-600 hover:bg-slate-50 sm:min-h-8"><Copy size={12} />복사</button>}
          {onDismiss && <button type="button" onClick={onDismiss} aria-label="답 지우기" className="inline-flex min-h-11 items-center gap-1 rounded-full border border-slate-300 bg-white px-3 text-[11px] font-black text-slate-500 hover:bg-slate-50 sm:min-h-8"><X size={12} />지우기</button>}
        </div>
      </div>

      {a.body ? (
        <div className="mt-2 whitespace-pre-wrap text-[13.5px] font-semibold leading-7 text-slate-800">{a.body}</div>
      ) : (
        <div className="mt-3 space-y-2.5">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-[14px] font-black leading-6 text-slate-900">{a.conclusion}</div>
          <div className="grid gap-2.5 lg:grid-cols-2">
            <Section icon={<CheckCircle2 size={14} />} title={`잘된 점 ${a.strengths.length}`} tone="text-emerald-700">
              {a.strengths.length ? (
                <ul className="mt-1.5 space-y-1.5">{a.strengths.map((s, i) => <li key={i} className="flex gap-2 text-[12.5px] font-semibold leading-5 text-slate-800"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />{s}</li>)}</ul>
              ) : <div className="mt-1.5 text-[12px] font-semibold text-slate-500">기록에서 뚜렷하게 짚을 점을 찾지 못했습니다.</div>}
            </Section>
            <Section icon={<AlertTriangle size={14} />} title={`부족한 점 ${a.gaps.length}`} tone="text-amber-700">
              {a.gaps.length ? (
                <ul className="mt-1.5 space-y-1.5">{a.gaps.map((g, i) => (
                  <li key={i} className="flex gap-2 text-[12.5px] font-semibold leading-5 text-slate-800">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                    <span>{g.text}{g.rule && <span className="ml-1.5 inline-block rounded-full border border-slate-200 px-1.5 text-[10px] font-black text-slate-500">{g.rule}</span>}</span>
                  </li>
                ))}</ul>
              ) : <div className="mt-1.5 text-[12px] font-semibold text-slate-500">규칙에 어긋난 곳이 보이지 않습니다.</div>}
            </Section>
          </div>
        </div>
      )}

      {a.evidence.length > 0 && (
        <details className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2" open={!a.body}>
          <summary className="min-h-9 cursor-pointer text-[12px] font-black text-slate-600">근거 {a.evidence.length}묶음 · {a.evidence.reduce((n, g) => n + g.rows.length, 0)}행</summary>
          <div className="mt-2"><AskEvidenceTabs groups={a.evidence} onRowClick={onRowClick} /></div>
        </details>
      )}

      {a.nextSteps.length > 0 && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3.5">
          <div className="text-[12px] font-black text-slate-700">다음에 하시면 좋은 일</div>
          <ol className="mt-1.5 space-y-1.5">{a.nextSteps.map((s, i) => <li key={i} className="flex gap-2 text-[12.5px] font-semibold leading-5 text-slate-800"><span className="w-4 shrink-0 text-right font-black tabular-nums text-slate-400">{i + 1}</span>{s}</li>)}</ol>
        </div>
      )}

      {a.limit && <div className="mt-3"><AskLimitNotice limit={a.limit} /></div>}
      {a.basis && <div className="mt-2 text-[10.5px] font-bold leading-4 text-slate-500">기준: {a.basis}</div>}
      {a.usageLine && <div className="mt-1 text-[10px] font-bold text-slate-400">{a.usageLine}</div>}
    </section>
  );
}
