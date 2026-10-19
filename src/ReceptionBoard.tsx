// 미처리 접수 현황판(표시 전용). 숫자 띠(종류×접수·진행중·보류) + 종류별 열(예정일 지남 먼저, 오래된 순 카드) + 카드 단추 자리.
// props: rows(열린 건) · today(YYYY-MM-DD) · onSelectType · renderActions(row) · loading · error · todayCount · weekDoneRate(0~100, 없으면 null)
//        · selectedType(그 종류 열만 넓게) · deptEnabled(기본 true, false 면 지원 3종 숨김).
// 경과 3일↑ 노랑, 7일↑ 빨강, 예정일 지난 건은 빨간 테두리. 열마다 20장까지만 먼저 보이고 "더 보기"로 펼친다.
import { useState, type ReactNode } from "react";
import { AlertCircle, CalendarClock, Check, Loader2 } from "lucide-react";
import { RECEPTION_TYPES, type ReceptionType } from "./ReceptionTypePicker";

export type ReceptionRow = {
  id: string;
  type: ReceptionType;
  vendor: string;
  field: string;
  author: string;
  handler: string;
  status: string;
  receipt_date: string;
  scheduled_date?: string | null;
  postponeCount?: number;
};

type Props = {
  rows: ReceptionRow[];
  today: string;
  onSelectType: (type: ReceptionType) => void;
  renderActions: (row: ReceptionRow) => ReactNode;
  loading?: boolean;
  error?: string;
  todayCount?: number;
  weekDoneRate?: number | null;
  selectedType?: ReceptionType | null;
  deptEnabled?: boolean;
};

const OPEN = ["접수", "진행중", "보류", "원격대기"] as const;
const STAT_COLS = ["접수", "진행중", "보류"] as const;
const PAGE = 20;

/** YYYY-MM-DD 두 날짜의 일수 차(UTC 기준이라 시간대 영향 없음). 파싱 실패면 0. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(a) || Number.isNaN(b) ? 0 : Math.max(0, Math.round((b - a) / 86400000));
}

function ageBadge(days: number): string {
  if (days >= 7) return "bg-red-100 text-red-700";
  if (days >= 3) return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-500";
}

export default function ReceptionBoard({ rows, today, onSelectType, renderActions, loading, error, todayCount, weekDoneRate, selectedType, deptEnabled = true }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const open = rows.filter((r) => (OPEN as readonly string[]).includes(r.status));
  const types = RECEPTION_TYPES.filter((m) => deptEnabled || m.group === "현장");
  const columns = selectedType ? types.filter((m) => m.type === selectedType) : types;
  const sortOld = (a: ReceptionRow, b: ReceptionRow) => a.receipt_date.localeCompare(b.receipt_date) || a.id.localeCompare(b.id);
  const isLate = (r: ReceptionRow) => Boolean(r.scheduled_date) && String(r.scheduled_date).slice(0, 10) < today;
  const byType = (t: ReceptionType) => open.filter((r) => r.type === t).sort(sortOld);
  // 원격대기는 '접수' 칸에 합산
  const countOf = (t: ReceptionType, s: string) => open.filter((r) => r.type === t && (r.status === s || (s === "접수" && r.status === "원격대기"))).length;
  const todayN = todayCount ?? rows.filter((r) => r.receipt_date.slice(0, 10) === today).length;
  const hasData = rows.length > 0;

  if (loading && !hasData) return <div role="status" className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-8 text-sm font-bold text-slate-500"><Loader2 size={16} className="animate-spin" />미처리 접수를 불러오는 중입니다.</div>;
  if (error && !hasData) return <div role="alert" className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700"><AlertCircle size={18} className="mt-0.5 shrink-0" /><span>미처리 접수를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요. ({error})</span></div>;

  const renderCard = (r: ReceptionRow) => {
    const age = daysBetween(r.receipt_date, today);
    const late = isLate(r);
    return (
      <li key={r.id} className={`rounded-lg border bg-white p-2.5 ${late ? "border-red-400 ring-1 ring-red-200" : "border-slate-200"}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 wrap-break-word text-[13px] font-black text-slate-900">{r.vendor || "업체 미정"}</div>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black tabular-nums ${ageBadge(age)}`}>{age === 0 ? "오늘" : `${age}일`}</span>
        </div>
        <div className="mt-0.5 wrap-break-word text-[12px] font-bold text-slate-600">
          {r.field || "분야 미입력"}
          {r.status === "보류" && <span className="ml-1.5 rounded bg-slate-200 px-1 py-0.5 text-[10px] font-black text-slate-600">보류</span>}
          {r.status === "원격대기" && <span className="ml-1.5 text-[10px] font-black text-violet-600">원격대기</span>}
          {(r.postponeCount ?? 0) >= 1 && <span className="ml-1.5 rounded bg-amber-50 px-1 py-0.5 text-[10px] font-black text-amber-700">미룸 {r.postponeCount}회</span>}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-semibold text-slate-500">
          <span>접수 {r.author || "-"}</span>
          <span>처리 {r.handler || "미지정"}</span>
        </div>
        {r.scheduled_date && <div className={`mt-1 inline-flex items-center gap-1 text-[11px] font-black ${late ? "text-red-600" : "text-slate-500"}`}><CalendarClock size={12} aria-hidden />예정 {String(r.scheduled_date).slice(5, 10)}{late && " · 지났습니다"}</div>}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">{renderActions(r)}</div>
      </li>
    );
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-label="미처리 접수 현황판">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[#1E252F] px-4 py-3">
        <div className="text-sm font-black text-white lg:text-[15px]">미처리 접수 현황 <span className="ml-1 tabular-nums text-slate-400">{open.filter((r) => types.some((m) => m.type === r.type)).length}건</span><span className="ml-2 text-[11px] font-bold text-slate-400">최근 90일 열린 건 · 오른쪽 목록은 고른 기간 기준</span></div>
        <div className="flex gap-2 text-[11px] font-black">
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-slate-200">오늘 접수 <b className="tabular-nums text-white">{todayN}</b></span>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-slate-200">이번 주 완료율 <b className="tabular-nums text-white">{weekDoneRate == null ? "-" : `${weekDoneRate}%`}</b></span>
        </div>
      </div>
      {loading && <div role="status" className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-4 py-1.5 text-[11px] font-bold text-slate-500"><Loader2 size={12} className="animate-spin" />새로고침 중…</div>}
      {error && <div role="alert" className="flex items-center gap-1.5 border-b border-red-200 bg-red-50 px-4 py-1.5 text-[11px] font-black text-red-600"><AlertCircle size={12} />최신 조회 실패 — 이전 데이터 표시</div>}

      {/* (a) 숫자 띠 — 폰 2열 · 태블릿 3열 · PC 현장 3 | 지원 3 */}
      <div className={`grid grid-cols-2 gap-2 border-b border-slate-200 bg-slate-50 p-3 sm:grid-cols-3 ${types.length > 3 ? "lg:grid-cols-6" : ""}`}>
        {types.map((m, i) => {
          const Icon = m.icon;
          const on = selectedType === m.type;
          const divider = deptEnabled && i === 3 ? "lg:border-l-4 lg:border-l-slate-300" : "";
          return (
            <button key={m.type} type="button" aria-pressed={on} onClick={() => onSelectType(m.type)} className={`min-h-11 rounded-xl border p-2.5 text-left transition hover:border-slate-400 ${divider} ${on ? "border-slate-900 bg-white ring-2 ring-slate-900/20" : "border-slate-200 bg-white"}`}>
              <div className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-black ${m.badge}`}><Icon size={12} aria-hidden />{m.label}</div>
              <div className="mt-1.5 grid grid-cols-3 text-center">
                {STAT_COLS.map((s) => (
                  <div key={s}>
                    <div className={`text-lg font-black tabular-nums ${countOf(m.type, s) > 0 ? "text-slate-900" : "text-slate-300"}`}>{countOf(m.type, s)}</div>
                    <div className="text-[10px] font-bold text-slate-400">{s}</div>
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {/* (b) 종류별 열 — 폰은 세로 쌓기, md 이상은 가로 스크롤(선택 시 그 열만 넓게) */}
      {open.filter((r) => types.some((m) => m.type === r.type)).length === 0 ? (
        <div className="flex items-center justify-center gap-1.5 p-8 text-sm font-black text-emerald-600"><Check size={16} />미처리 접수가 없습니다. 모두 처리되었습니다.</div>
      ) : (
        <div className="flex flex-col gap-3 p-3 md:flex-row md:overflow-x-auto">
          {columns.map((m, ci) => {
            const all = byType(m.type);
            const late = all.filter(isLate);
            const rest = all.filter((r) => !isLate(r));
            const ordered = [...late, ...rest];
            const shown = expanded[m.type] ? ordered : ordered.slice(0, PAGE);
            const hidden = ordered.length - shown.length;
            const shownLate = shown.filter(isLate);
            const shownRest = shown.filter((r) => !isLate(r));
            const prev = columns[ci - 1];
            return (
              <div key={m.type} className="contents">
                {prev && prev.group !== m.group && <div aria-hidden className="hidden w-px shrink-0 self-stretch bg-slate-300 md:block" />}
                <div className={selectedType ? "md:w-full" : "md:w-72 md:shrink-0"}>
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                    <div className={`h-1 ${m.bar}`} />
                    <button type="button" onClick={() => onSelectType(m.type)} className="flex min-h-11 w-full items-center justify-between px-3 text-left">
                      <span className="text-[13px] font-black text-slate-800">{m.label}</span>
                      <span className="text-[11px] font-black tabular-nums text-slate-400">{all.length}건</span>
                    </button>
                    {all.length === 0 ? (
                      <div className="px-3 pb-3 text-[12px] font-black text-emerald-600">없음 ✓</div>
                    ) : (
                      <div className="space-y-2 px-2 pb-2">
                        {shownLate.length > 0 && (
                          <div>
                            <div className="mb-1 rounded bg-red-600 px-2 py-1 text-[11px] font-black text-white">예정일 지남 {late.length}</div>
                            <ul className="space-y-2">{shownLate.map(renderCard)}</ul>
                          </div>
                        )}
                        {shownRest.length > 0 && <ul className="space-y-2">{shownRest.map(renderCard)}</ul>}
                        {hidden > 0 && <button type="button" onClick={() => setExpanded((e) => ({ ...e, [m.type]: true }))} className="min-h-11 w-full rounded-lg border border-slate-300 bg-white text-[12px] font-black text-slate-600 transition hover:bg-slate-100">더 보기 {hidden}</button>}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
