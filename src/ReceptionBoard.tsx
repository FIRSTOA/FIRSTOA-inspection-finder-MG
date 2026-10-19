// 미처리 접수 현황판(표시 전용). 숫자 띠(종류×접수·진행중·보류) + 종류별 열(예정일 지남 먼저, 오래된 순 카드) + 카드 단추 자리.
// props: rows(열린 건) · today(YYYY-MM-DD) · onSelectType · renderActions(row) · loading · error · todayCount · weekDoneRate(0~100, 없으면 null)
//        · selectedType(그 종류 열만 넓게) · deptEnabled(기본 true, false 면 지원 3종 숨김)
//        · compact(오른쪽 기둥용 압축형: 작은 타일 + 세로 스택 + 열마다 접기)
//        · scheduleRows(물류 미처리 → "물류 미처리" 열, 현장 3종 뒤; 숫자 띠 타일을 누르면 그 열만 넓게, 다시 누르면 전체 — 내부 상태)
//        · onOpenSchedule(일정리스트로 가는 단추 + 카드 자체 클릭).
// 경과 3일↑ 노랑, 7일↑ 빨강, 예정일 지난 건은 빨간 테두리. 열마다 20장까지만 먼저 보이고 "더 보기"로 펼친다.
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { AlertCircle, CalendarClock, CalendarX2, Check, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
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

export type ScheduleRow = {
  id: string;
  vendor: string;
  scheduleType: string;
  team: string;
  assignee: string;
  date: string;
  time?: string;
  status: string;
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
  compact?: boolean;
  scheduleRows?: ScheduleRow[];
  onOpenSchedule?: () => void;
};

const OPEN = ["접수", "진행중", "보류", "원격대기"] as const;
const STAT_COLS = ["접수", "진행중", "보류"] as const;
const PAGE = 20;
const SCHEDULE_KEY = "__schedule";

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

/** "납품철수교체휴가교육" 같은 묶음 표기는 "납품" 으로 줄여 보인다. */
function scheduleTypeLabel(t: string): string {
  return t === "납품철수교체휴가교육" ? "납품" : t || "일정";
}

export default function ReceptionBoard({ rows, today, onSelectType, renderActions, loading, error, todayCount, weekDoneRate, selectedType, deptEnabled = true, compact = false, scheduleRows, onOpenSchedule }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [folded, setFolded] = useState<Record<string, boolean>>({}); // compact: 사용자가 직접 접거나 펼친 열(true=펼침)
  const open = rows.filter((r) => (OPEN as readonly string[]).includes(r.status));
  const [scheduleOnly, setScheduleOnly] = useState(false); // 물류 미처리 열만 넓게 보기(내부 상태)
  const types = RECEPTION_TYPES.filter((m) => deptEnabled || m.group === "현장");
  const focusSchedule = scheduleOnly && scheduleRows !== undefined && !selectedType;
  const columns = focusSchedule ? [] : selectedType ? types.filter((m) => m.type === selectedType) : types;
  const selectType = (t: ReceptionType) => { setScheduleOnly(false); onSelectType(t); };
  const sortOld = (a: ReceptionRow, b: ReceptionRow) => a.receipt_date.localeCompare(b.receipt_date) || a.id.localeCompare(b.id);
  const isLate = (r: ReceptionRow) => Boolean(r.scheduled_date) && String(r.scheduled_date).slice(0, 10) < today;
  const byType = (t: ReceptionType) => open.filter((r) => r.type === t).sort(sortOld);
  // 원격대기는 '접수' 칸에 합산
  const countOf = (t: ReceptionType, s: string) => open.filter((r) => r.type === t && (r.status === s || (s === "접수" && r.status === "원격대기"))).length;
  const todayN = todayCount ?? rows.filter((r) => r.receipt_date.slice(0, 10) === today).length;
  const hasData = rows.length > 0;
  // 일정 미처리 열: scheduleRows 가 넘어오고 종류 하나만 보는 중이 아닐 때만
  const hasSchedule = scheduleRows !== undefined; // 숫자 띠 타일은 선택과 무관하게 항상 보인다
  const showSchedule = hasSchedule && !selectedType; // 아래 열만 선택 시 숨김
  // 물류 타일: 종류가 골라진 상태면 그 선택을 풀고(같은 종류 재호출=해제) 물류 열만 본다
  const toggleSchedule = () => {
    if (selectedType) { onSelectType(selectedType); setScheduleOnly(true); return; }
    setScheduleOnly((v) => !v);
  };
  const schedAll = [...(scheduleRows ?? [])].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const openCount = open.filter((r) => types.some((m) => m.type === r.type)).length;
  const lastFieldTileType = types.filter((m) => m.group === "현장").at(-1)?.type; // 타일 띠는 선택과 무관
  const lastFieldType = columns.filter((m) => m.group === "현장").at(-1)?.type;

  if (loading && !hasData) return <div role="status" className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-8 text-sm font-bold text-slate-500"><Loader2 size={16} className="animate-spin" />미처리 접수를 불러오는 중입니다.</div>;
  if (error && !hasData) return <div role="alert" className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700"><AlertCircle size={18} className="mt-0.5 shrink-0" /><span>미처리 접수를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요. ({error})</span></div>;

  const renderCard = (r: ReceptionRow) => {
    const age = daysBetween(r.receipt_date, today);
    const late = isLate(r);
    const ageText = age === 0 ? "오늘" : `${age}일`;
    if (compact) {
      return (
        <li key={r.id} className={`rounded-lg border bg-white px-2 py-1.5 ${late ? "border-red-400 ring-1 ring-red-200" : "border-slate-200"}`}>
          <div className="flex items-center gap-1.5 text-[12px]">
            <span className="min-w-0 truncate font-black text-slate-900">{r.vendor || "업체 미정"}</span>
            <span className="min-w-0 shrink truncate font-bold text-slate-500">· {r.field || "분야 미입력"}</span>
            {r.status === "보류" && <span className="shrink-0 rounded bg-slate-200 px-1 text-[10px] font-black text-slate-600">보류</span>}
            {r.status === "원격대기" && <span className="shrink-0 text-[10px] font-black text-violet-600">원격대기</span>}
            {(r.postponeCount ?? 0) >= 1 && <span className="shrink-0 rounded bg-amber-50 px-1 text-[10px] font-black text-amber-700">미룸 {r.postponeCount}회</span>}
            <span className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-black tabular-nums ${ageBadge(age)}`}>{ageText}</span>
            <span className="shrink-0 text-[11px] font-semibold text-slate-500">{r.handler || "미지정"}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">{renderActions(r)}</div>
        </li>
      );
    }
    return (
      <li key={r.id} className={`rounded-lg border bg-white p-2.5 ${late ? "border-red-400 ring-1 ring-red-200" : "border-slate-200"}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 wrap-break-word text-[13px] font-black text-slate-900">{r.vendor || "업체 미정"}</div>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black tabular-nums ${ageBadge(age)}`}>{ageText}</span>
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

  const renderScheduleCard = (s: ScheduleRow) => {
    const age = daysBetween(s.date, today);
    return (
      <li key={s.id} {...(onOpenSchedule ? { role: "button", tabIndex: 0, onClick: onOpenSchedule, onKeyDown: (e: KeyboardEvent<HTMLLIElement>) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenSchedule(); } } } : {})}
        className={`rounded-lg border border-slate-300 bg-white px-2 py-1.5 ${onOpenSchedule ? "cursor-pointer transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-slate-900" : ""}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[12px] font-black text-slate-900">{s.vendor || "업체 미정"}</span>
          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-black tabular-nums ${ageBadge(age)}`}>{age === 0 ? "오늘" : `${age}일`}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-semibold text-slate-500">
          <span className="inline-flex items-center gap-1 tabular-nums"><CalendarClock size={11} aria-hidden />{s.date.slice(5, 10)}{s.time ? ` ${s.time.slice(0, 5)}` : ""}</span>
          <span className="rounded bg-slate-200 px-1 text-[10px] font-black text-slate-700">{scheduleTypeLabel(s.scheduleType)}</span>
          {s.team && <span>{s.team}</span>}
          <span>{s.assignee || "담당 미정"}</span>
        </div>
      </li>
    );
  };

  const scheduleButton = onOpenSchedule ? (
    <button type="button" onClick={onOpenSchedule} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-[12px] font-black text-slate-700 transition hover:bg-slate-100">
      <CalendarX2 size={14} aria-hidden />일정리스트에서 처리
    </button>
  ) : null;

  const scheduleList = (shown: ScheduleRow[], hidden: number) => (
    <div className="space-y-2 px-2 pb-2">
      <ul className="space-y-2">{shown.map(renderScheduleCard)}</ul>
      {hidden > 0 && <button type="button" onClick={() => setExpanded((e) => ({ ...e, [SCHEDULE_KEY]: true }))} className="min-h-11 w-full rounded-lg border border-slate-300 bg-white text-[12px] font-black text-slate-600 transition hover:bg-slate-100">더 보기 {hidden}</button>}
    </div>
  );

  // ---- 공통: 종류 열의 카드 묶음(예정일 지남 먼저) ----
  const typeBody = (type: ReceptionType) => {
    const all = byType(type);
    const late = all.filter(isLate);
    const ordered = [...late, ...all.filter((r) => !isLate(r))];
    const shown = expanded[type] ? ordered : ordered.slice(0, PAGE);
    const hidden = ordered.length - shown.length;
    const shownLate = shown.filter(isLate);
    const shownRest = shown.filter((r) => !isLate(r));
    return (
      <div className="space-y-2 px-2 pb-2">
        {shownLate.length > 0 && (
          <div>
            <div className="mb-1 rounded bg-red-600 px-2 py-1 text-[11px] font-black text-white">예정일 지남 {late.length}</div>
            <ul className="space-y-2">{shownLate.map(renderCard)}</ul>
          </div>
        )}
        {shownRest.length > 0 && <ul className="space-y-2">{shownRest.map(renderCard)}</ul>}
        {hidden > 0 && <button type="button" onClick={() => setExpanded((e) => ({ ...e, [type]: true }))} className="min-h-11 w-full rounded-lg border border-slate-300 bg-white text-[12px] font-black text-slate-600 transition hover:bg-slate-100">더 보기 {hidden}</button>}
      </div>
    );
  };

  const schedShown = expanded[SCHEDULE_KEY] ? schedAll : schedAll.slice(0, PAGE);
  const schedHidden = schedAll.length - schedShown.length;

  // ---- 머리띠 ----
  const header = compact ? (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 bg-[#1E252F] px-3 py-2">
      <div className="text-[13px] font-black text-white">미처리 접수 <span className="ml-0.5 tabular-nums text-slate-400">{openCount}건</span></div>
      <div className="text-[10px] font-bold text-slate-300">오늘 접수 <b className="tabular-nums text-white">{todayN}</b> · 완료율 <b className="tabular-nums text-white">{weekDoneRate == null ? "-" : `${weekDoneRate}%`}</b></div>
    </div>
  ) : (
    <div className="flex flex-wrap items-center justify-between gap-2 bg-[#1E252F] px-4 py-3">
      <div className="text-sm font-black text-white lg:text-[15px]">미처리 접수 현황 <span className="ml-1 tabular-nums text-slate-400">{openCount}건</span><span className="ml-2 text-[11px] font-bold text-slate-400">최근 90일 열린 건 · 오른쪽 목록은 고른 기간 기준</span></div>
      <div className="flex gap-2 text-[11px] font-black">
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-slate-200">오늘 접수 <b className="tabular-nums text-white">{todayN}</b></span>
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-slate-200">이번 주 완료율 <b className="tabular-nums text-white">{weekDoneRate == null ? "-" : `${weekDoneRate}%`}</b></span>
      </div>
    </div>
  );

  // ---- 숫자 띠 ----
  const tileCount = types.length + (hasSchedule ? 1 : 0);
  const lgCols = tileCount >= 7 ? "lg:grid-cols-7" : tileCount === 6 ? "lg:grid-cols-6" : tileCount === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3";
  const stats = compact ? (
    <div className="grid grid-cols-2 gap-1.5 border-b border-slate-200 bg-slate-50 p-2 min-[430px]:grid-cols-3">
      {types.map((m) => {
        const Icon = m.icon;
        const on = selectedType === m.type;
        return (
          <button key={m.type} type="button" aria-pressed={on} onClick={() => selectType(m.type)} className={`min-h-11 rounded-lg border px-2 py-1 text-left transition hover:border-slate-400 ${on ? "border-slate-900 bg-white ring-2 ring-slate-900/20" : "border-slate-200 bg-white"}`}>
            <div className="flex items-center gap-1 text-[11px] font-black text-slate-800"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.dot}`} aria-hidden /><Icon size={12} aria-hidden /><span className="truncate">{m.label}</span></div>
            <div className="mt-0.5 whitespace-nowrap text-[10px] font-bold tabular-nums text-slate-500">접수 {countOf(m.type, "접수")}·진행 {countOf(m.type, "진행중")}·보류 {countOf(m.type, "보류")}</div>
          </button>
        );
      })}
      {hasSchedule && (
        <button type="button" aria-pressed={focusSchedule} onClick={toggleSchedule} className={`flex min-h-11 flex-col justify-center rounded-lg border bg-white px-2 py-1 text-left transition hover:border-slate-400 ${focusSchedule ? "border-slate-900 ring-2 ring-slate-900/20" : "border-slate-300"}`}>
          <div className="flex items-center gap-1 text-[11px] font-black text-slate-800"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-500" aria-hidden /><CalendarX2 size={12} aria-hidden /><span className="truncate">물류 미처리</span></div>
          <div className={`mt-0.5 text-[10px] font-bold tabular-nums ${schedAll.length > 0 ? "text-slate-700" : "text-slate-400"}`}>{schedAll.length}건</div>
        </button>
      )}
    </div>
  ) : (
    <div className={`grid grid-cols-2 gap-2 border-b border-slate-200 bg-slate-50 p-3 sm:grid-cols-3 ${tileCount > 3 ? lgCols : ""}`}>
      {types.map((m, i) => {
        const Icon = m.icon;
        const on = selectedType === m.type;
        const divider = deptEnabled && m.group === "지원" && types[i - 1]?.group === "현장" ? "lg:border-l-4 lg:border-l-slate-300" : "";
        return (
          <div key={m.type} className="contents">
            {hasSchedule && m.type === lastFieldTileType && (
              <button type="button" aria-pressed={focusSchedule} onClick={toggleSchedule} className={`min-h-11 rounded-xl border bg-white p-2.5 text-left transition hover:border-slate-400 ${focusSchedule ? "border-slate-900 ring-2 ring-slate-900/20" : "border-slate-300"}`}>
                <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-700"><CalendarX2 size={12} aria-hidden />물류 미처리</div>
                <div className={`mt-1.5 text-lg font-black tabular-nums ${schedAll.length > 0 ? "text-slate-900" : "text-slate-300"}`}>{schedAll.length}<span className="ml-1 text-[10px] font-bold text-slate-400">건</span></div>
              </button>
            )}
            <button type="button" aria-pressed={on} onClick={() => selectType(m.type)} className={`min-h-11 rounded-xl border p-2.5 text-left transition hover:border-slate-400 ${divider} ${on ? "border-slate-900 bg-white ring-2 ring-slate-900/20" : "border-slate-200 bg-white"}`}>
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
          </div>
        );
      })}
    </div>
  );

  // ---- 열 영역 ----
  const isEmptyAll = openCount === 0 && (!showSchedule || schedAll.length === 0);
  let body: ReactNode;
  if (isEmptyAll) {
    body = <div className="flex items-center justify-center gap-1.5 p-8 text-sm font-black text-emerald-600"><Check size={16} />미처리 접수가 없습니다. 모두 처리되었습니다.</div>;
  } else if (compact) {
    // 세로 스택 + 열마다 접기(건수 있는 열만 기본 펼침)
    const stackItem = (key: string, label: string, bar: string, count: number, content: ReactNode, extra?: ReactNode, onTitle?: () => void) => {
      const isOpen = count > 0 && (folded[key] ?? true);
      return (
        <div key={key} className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
          <div className={`h-0.5 ${bar}`} />
          <div className="flex min-h-11 items-center">
            <button type="button" aria-expanded={isOpen} disabled={count === 0} onClick={() => setFolded((f) => ({ ...f, [key]: !isOpen }))} className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 px-2.5 text-left disabled:cursor-default">
              {count > 0 ? (isOpen ? <ChevronDown size={14} className="shrink-0 text-slate-400" aria-hidden /> : <ChevronRight size={14} className="shrink-0 text-slate-400" aria-hidden />) : <Check size={14} className="shrink-0 text-emerald-600" aria-hidden />}
              <span className="truncate text-[13px] font-black text-slate-800">{label}</span>
              <span className="text-[11px] font-black tabular-nums text-slate-400">{count}건</span>
              {count === 0 && <span className="ml-auto text-[12px] font-black text-emerald-600">없음 ✓</span>}
            </button>
            {onTitle && <button type="button" onClick={onTitle} className="mr-1 min-h-11 shrink-0 px-2 text-[11px] font-black text-slate-500 hover:text-slate-800">이 종류만</button>}
          </div>
          {extra}
          {isOpen && content}
        </div>
      );
    };
    const scheduleItem = () =>
      stackItem(SCHEDULE_KEY, "물류 미처리", "bg-slate-500", schedAll.length, scheduleList(schedShown, schedHidden), scheduleButton ? <div className="px-2 pb-2">{scheduleButton}</div> : undefined);
    body = (
      <div className="flex flex-col gap-2 p-2">
        {columns.map((m) => (
          <div key={m.type} className="contents">
            {stackItem(m.type, m.label, m.bar, byType(m.type).length, typeBody(m.type), undefined, selectedType ? undefined : () => selectType(m.type))}
            {showSchedule && m.type === lastFieldType && scheduleItem()}
          </div>
        ))}
        {showSchedule && lastFieldType === undefined && scheduleItem()}
      </div>
    );
  } else {
    // 폰은 세로 쌓기, md 이상은 가로 스크롤(선택 시 그 열만 넓게)
    const scheduleColumn = (wide: boolean) => (
      <div className={wide ? "md:w-full" : "md:w-72 md:shrink-0"}>
        <div className="overflow-hidden rounded-xl border border-slate-300 bg-slate-50">
          <div className="h-1 bg-slate-500" />
          <div className="flex min-h-11 items-center justify-between px-3">
            <span className="text-[13px] font-black text-slate-800">물류 미처리</span>
            <span className="text-[11px] font-black tabular-nums text-slate-400">{schedAll.length}건</span>
          </div>
          {scheduleButton && <div className="px-2 pb-2">{scheduleButton}</div>}
          {schedAll.length === 0 ? <div className="px-3 pb-3 text-[12px] font-black text-emerald-600">없음 ✓</div> : scheduleList(schedShown, schedHidden)}
        </div>
      </div>
    );
    body = (
      <div className="flex flex-col gap-3 p-3 md:flex-row md:overflow-x-auto">
        {focusSchedule && scheduleColumn(true)}
        {columns.map((m, ci) => {
          const all = byType(m.type);
          const prev = columns[ci - 1];
          return (
            <div key={m.type} className="contents">
              {prev && prev.group !== m.group && <div aria-hidden className="hidden w-px shrink-0 self-stretch bg-slate-300 md:block" />}
              <div className={selectedType ? "md:w-full" : "md:w-72 md:shrink-0"}>
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                  <div className={`h-1 ${m.bar}`} />
                  <button type="button" onClick={() => selectType(m.type)} className="flex min-h-11 w-full items-center justify-between px-3 text-left">
                    <span className="text-[13px] font-black text-slate-800">{m.label}</span>
                    <span className="text-[11px] font-black tabular-nums text-slate-400">{all.length}건</span>
                  </button>
                  {all.length === 0 ? <div className="px-3 pb-3 text-[12px] font-black text-emerald-600">없음 ✓</div> : typeBody(m.type)}
                </div>
              </div>
              {showSchedule && m.type === lastFieldType && scheduleColumn(false)}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-label="미처리 접수 현황판">
      {header}
      {loading && <div role="status" className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-4 py-1.5 text-[11px] font-bold text-slate-500"><Loader2 size={12} className="animate-spin" />새로고침 중…</div>}
      {error && <div role="alert" className="flex items-center gap-1.5 border-b border-red-200 bg-red-50 px-4 py-1.5 text-[11px] font-black text-red-600"><AlertCircle size={12} />최신 조회 실패 — 이전 데이터 표시</div>}
      {stats}
      {body}
    </section>
  );
}
