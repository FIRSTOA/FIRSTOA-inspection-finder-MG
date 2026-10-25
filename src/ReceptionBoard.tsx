// 미처리 접수 현황판(표시 전용). 숫자 띠(종류×접수·진행중·보류) + 종류별 열(예정일 지남 먼저, 오래된 순 카드) + 카드 단추 자리.
// props: rows(열린 건) · today(YYYY-MM-DD) · onSelectType · renderActions(row) · loading · error · todayCount · weekDoneRate(0~100, 없으면 null)
//        · selectedType(그 종류 열만 넓게) · deptEnabled(기본 true, false 면 지원 3종 숨김)
//        · compact(오른쪽 기둥용 압축형: 작은 타일 + 세로 스택 + 열마다 접기)
//        · scheduleRows(물류 미처리 → "물류 미처리" 열, 현장 3종 뒤; 숫자 띠 타일을 누르면 그 열만 넓게, 다시 누르면 전체 — 내부 상태)
//        · onOpenSchedule(호환용으로 남김, 쓰지 않음 — 물류 카드는 읽기 전용, 처리는 네이버 캘린더에서).
// 경과 3일↑ 노랑, 7일↑ 빨강, 예정일 지난 건은 빨간 테두리. 열마다 20장까지만 먼저 보이고 "더 보기"로 펼친다.
import { useState, type ReactNode } from "react";
import { AlertCircle, CalendarClock, CalendarX2, Check, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { RECEPTION_TYPES, type ReceptionType } from "./ReceptionTypePicker";
import { sheetStateLabel } from "./receptionSheetState";
import { formatAssignees } from "./assignees";

/** 시트에서 온 행(C3 시트 기준) — 상태 글자·내용 요약·시트 링크. linked = 앱 접수에 이어진 행 */
export type SheetRowInfo = {
  source: "sales" | "mgmt" | "remote";
  sheetRow: number;
  seq: string;
  state: string;
  summary: string;
  region: string;
  url: string;
  linked: boolean;
};

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
  noTicket?: boolean; // 복합기 AS 접수인데 일정 등록이 없는 건
  sheet?: SheetRowInfo; // 시트에서 온 행(시트 기준 모드)
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
  /** 시트 기준 모드(C3): 머리 안내·완료율 "앱 접수 기준" 표기 */
  sheetMode?: boolean;
  /** 시트 읽기 실패·일부 빠짐 안내 한 줄 */
  sheetNotice?: string;
  /** 90일 넘은 시트 미처리 — 열마다 "90일 넘음 n" 칩으로 접어 둔다 */
  over90Rows?: ReceptionRow[];
  /** 카드 윗줄(업체·분야)을 누르면 — 상세 팝업 열기(2026-10-25 밤, 홈 미처리와 같은 UnhandledDetail). 없으면 누를 수 없는 글 */
  onOpenRow?: (row: ReceptionRow) => void;
};

const OPEN = ["접수", "진행중", "보류", "원격대기"] as const;
const STAT_COLS = ["접수", "진행중", "보류"] as const;
const PAGE = 20;
const SCHEDULE_KEY = "__schedule";
const OLD_KEY = (t: string) => `__old:${t}`;

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

/** 시트 행 표시: "시트" 배지 + 상태 글자(공란은 "상태 비어 있음") */
function SheetBadge({ sheet, compact }: { sheet: SheetRowInfo; compact: boolean }) {
  return (
    <span className={`${compact ? "" : "ml-1.5 "}inline-flex shrink-0 items-center gap-1 rounded bg-emerald-50 px-1 py-0.5 text-[10px] font-black text-emerald-700`}>
      시트<span className={`font-bold ${sheet.state.trim() ? "text-emerald-900" : "text-amber-700"}`}>{sheetStateLabel(sheet.state)}</span>
    </span>
  );
}

export default function ReceptionBoard({ rows, today, onSelectType, renderActions, loading, error, todayCount, weekDoneRate, selectedType, deptEnabled = true, compact = false, scheduleRows, sheetMode = false, sheetNotice, over90Rows, onOpenRow }: Props) {
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

  // 윗줄 누르기 = 상세 팝업(키보드 Enter·Space 도). 안쪽에 다른 단추가 없는 줄이라 role=button 으로 충분
  const openProps = (r: ReceptionRow) => (onOpenRow ? {
    role: "button" as const, tabIndex: 0, "aria-haspopup": "dialog" as const, title: "눌러서 상세 보기",
    onClick: () => onOpenRow(r),
    onKeyDown: (e: { key: string; preventDefault: () => void }) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenRow(r); } },
  } : {});
  const renderCard = (r: ReceptionRow) => {
    const age = daysBetween(r.receipt_date, today);
    const late = isLate(r);
    const ageText = !r.receipt_date ? "날짜?" : age === 0 ? "오늘" : `${age}일`;
    if (compact) {
      return (
        <li key={r.id} className={`px-3 py-2 ${late ? "border-l-2 border-l-red-500 bg-red-50/40" : ""}`}>
          <div {...openProps(r)} className={`flex w-full items-center gap-1.5 text-left text-[12px] ${onOpenRow ? "min-h-11 cursor-pointer rounded hover:bg-slate-50 sm:min-h-8" : ""}`}>
            <span className="min-w-0 truncate font-black text-slate-900">{r.vendor || "업체 미정"}</span>
            <span className="min-w-0 shrink truncate font-bold text-slate-500">· {r.field || "분야 미입력"}</span>
            {r.noTicket && <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] font-black text-slate-500">일정 없음</span>}
            {r.sheet && <SheetBadge sheet={r.sheet} compact />}
            {!r.sheet && r.status === "보류" && <span className="shrink-0 rounded bg-slate-200 px-1 text-[10px] font-black text-slate-600">보류</span>}
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
        <div {...openProps(r)} className={`flex w-full items-start justify-between gap-2 text-left ${onOpenRow ? "cursor-pointer rounded hover:bg-slate-50" : ""}`}>
          <div className="min-w-0 wrap-break-word text-[13px] font-black text-slate-900">{r.vendor || "업체 미정"}</div>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black tabular-nums ${ageBadge(age)}`}>{ageText}</span>
        </div>
        <div className="mt-0.5 wrap-break-word text-[12px] font-bold text-slate-600">
          {r.field || "분야 미입력"}
          {r.noTicket && <span className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 text-[10px] font-black text-slate-500">일정 없음</span>}
          {r.sheet && <SheetBadge sheet={r.sheet} compact={false} />}
          {!r.sheet && r.status === "보류" && <span className="ml-1.5 rounded bg-slate-200 px-1 py-0.5 text-[10px] font-black text-slate-600">보류</span>}
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
      <li key={s.id} className={compact ? "px-3 py-2" : "rounded-lg border border-slate-300 bg-white px-2 py-1.5"}>
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[12px] font-black text-slate-900">{s.vendor || "업체 미정"}</span>
          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-black tabular-nums ${ageBadge(age)}`}>{age === 0 ? "오늘" : `${age}일`}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-semibold text-slate-500">
          <span className="inline-flex items-center gap-1 tabular-nums"><CalendarClock size={11} aria-hidden />{s.date.slice(5, 10)}{s.time ? ` ${s.time.slice(0, 5)}` : ""}</span>
          <span className="rounded bg-slate-200 px-1 text-[10px] font-black text-slate-700">{scheduleTypeLabel(s.scheduleType)}</span>
          {s.team && <span>{s.team}</span>}
          <span>{formatAssignees(s.assignee) || "담당 미정"}</span>
        </div>
      </li>
    );
  };

  // 물류 미처리는 읽기 전용: 일정리스트는 네이버 캘린더에 관여하지 않으므로 처리 단추 없이 안내만 둔다
  const scheduleNote = <p className="text-[11px] font-bold leading-snug text-slate-500">네이버 캘린더에서 완료 처리하면 다음 동기화(1분) 뒤 사라집니다</p>;

  const scheduleList = (shown: ScheduleRow[], hidden: number) => (
    <div className={compact ? "pb-1" : "space-y-2 px-2 pb-2"}>
      <ul className={compact ? "divide-y divide-slate-100" : "space-y-2"}>{shown.map(renderScheduleCard)}</ul>
      {hidden > 0 && <button type="button" onClick={() => setExpanded((e) => ({ ...e, [SCHEDULE_KEY]: true }))} className={compact ? "min-h-11 w-full border-t border-slate-100 text-[12px] font-bold text-slate-500 transition hover:bg-slate-50" : "min-h-11 w-full rounded-lg border border-slate-300 bg-white text-[12px] font-black text-slate-600 transition hover:bg-slate-100"}>더 보기 {hidden}</button>}
    </div>
  );

  // ---- 90일 넘은 시트 미처리: 칸 숫자 밖, 칩을 눌러야 펼친다(오래된 순, 20장씩) ----
  const oldOf = (type: ReceptionType) => (over90Rows ?? []).filter((r) => r.type === type).sort(sortOld);
  const oldBody = (type: ReceptionType) => {
    const old = oldOf(type);
    if (!old.length) return null;
    const key = OLD_KEY(type);
    const isOpen = Boolean(folded[key]);
    const shown = expanded[key] ? old : old.slice(0, PAGE);
    return (
      <div className={compact ? "border-t border-slate-100 px-3 py-1.5" : ""}>
        <button type="button" aria-expanded={isOpen} onClick={() => setFolded((f) => ({ ...f, [key]: !isOpen }))} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-slate-300 bg-white px-2.5 text-[11px] font-black text-slate-600 transition hover:border-slate-400">
          {isOpen ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}90일 넘음 <span className="tabular-nums">{old.length}</span>
        </button>
        {isOpen && (
          <>
            <p className="mt-1 text-[11px] font-bold text-slate-500">칸 숫자에 넣지 않은 오래된 시트 건입니다. 처리했으면 시트 상태를 바꿔 주세요.</p>
            <ul className={compact ? "mt-1 divide-y divide-slate-100" : "mt-1 space-y-2"}>{shown.map(renderCard)}</ul>
            {old.length > shown.length && <button type="button" onClick={() => setExpanded((e) => ({ ...e, [key]: true }))} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white text-[12px] font-black text-slate-600 transition hover:bg-slate-100">더 보기 {old.length - shown.length}</button>}
          </>
        )}
      </div>
    );
  };

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
      <div className={compact ? "pb-1" : "space-y-2 px-2 pb-2"}>
        {shownLate.length > 0 && (
          <div>
            <div className={compact ? "bg-red-50 px-3 py-1 text-[11px] font-black text-red-600" : "mb-1 rounded bg-red-600 px-2 py-1 text-[11px] font-black text-white"}>예정일 지남 {late.length}</div>
            <ul className={compact ? "divide-y divide-slate-100" : "space-y-2"}>{shownLate.map(renderCard)}</ul>
          </div>
        )}
        {shownRest.length > 0 && <ul className={compact ? `divide-y divide-slate-100 ${shownLate.length > 0 ? "border-t border-slate-100" : ""}` : "space-y-2"}>{shownRest.map(renderCard)}</ul>}
        {hidden > 0 && <button type="button" onClick={() => setExpanded((e) => ({ ...e, [type]: true }))} className={compact ? "min-h-11 w-full border-t border-slate-100 text-[12px] font-bold text-slate-500 transition hover:bg-slate-50" : "min-h-11 w-full rounded-lg border border-slate-300 bg-white text-[12px] font-black text-slate-600 transition hover:bg-slate-100"}>더 보기 {hidden}</button>}
        {oldBody(type)}
      </div>
    );
  };

  const schedShown = expanded[SCHEDULE_KEY] ? schedAll : schedAll.slice(0, PAGE);
  const schedHidden = schedAll.length - schedShown.length;

  // ---- 머리띠 ----
  const header = compact ? (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-3 py-2">
      <div className="text-[13px] font-bold text-slate-900">미처리 접수 <span className="ml-0.5 tabular-nums text-slate-400">{openCount}건</span></div>
      <div className="text-[11px] font-medium text-slate-500">오늘 접수 <b className="tabular-nums text-slate-900">{todayN}</b> · 완료율 <b className="tabular-nums text-slate-900">{weekDoneRate == null ? "-" : `${weekDoneRate}%`}</b>{sheetMode && <span className="text-slate-400">(앱 접수 기준)</span>}</div>
      {sheetMode && <p className="w-full text-[11px] font-bold leading-snug text-slate-500">영업·경영·원격은 시트 상태 열 기준(처리완료·취소·이관이 아니면 미처리), 최근 90일</p>}
    </div>
  ) : (
    <div className="flex flex-wrap items-center justify-between gap-2 bg-[#1E252F] px-4 py-3">
      <div className="text-sm font-black text-white lg:text-[15px]">미처리 접수 현황 <span className="ml-1 tabular-nums text-slate-400">{openCount}건</span><span className="ml-2 text-[11px] font-bold text-slate-400">{sheetMode ? "최근 90일 · 영업·경영·원격은 시트 상태 열 기준(처리완료·취소·이관이 아니면 미처리)" : "최근 90일 열린 건 · 오른쪽 목록은 고른 기간 기준"}</span></div>
      <div className="flex gap-2 text-[11px] font-black">
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-slate-200">오늘 접수 <b className="tabular-nums text-white">{todayN}</b></span>
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-slate-200">이번 주 완료율 <b className="tabular-nums text-white">{weekDoneRate == null ? "-" : `${weekDoneRate}%`}</b>{sheetMode && <span className="ml-1 font-bold text-slate-400">앱 접수 기준</span>}</span>
      </div>
    </div>
  );

  // ---- 숫자 띠 ----
  const tileCount = types.length + (hasSchedule ? 1 : 0);
  const lgCols = tileCount >= 7 ? "lg:grid-cols-7" : tileCount === 6 ? "lg:grid-cols-6" : tileCount === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3";
  const stats = compact ? (
    <div className="grid grid-cols-2 gap-1.5 border-b border-slate-100 px-3 pb-3 min-[430px]:grid-cols-3">
      {types.map((m) => {
        const Icon = m.icon;
        const on = selectedType === m.type;
        return (
          <button key={m.type} type="button" aria-pressed={on} onClick={() => selectType(m.type)} className={`min-h-11 rounded-lg border px-2 py-1 text-left transition hover:border-slate-300 ${on ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white"}`}>
            <div className="flex items-center gap-1 text-[11px] font-black text-slate-800"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.dot}`} aria-hidden /><Icon size={12} aria-hidden /><span className="truncate">{m.label}</span></div>
            <div className="mt-0.5 whitespace-nowrap text-[10px] font-bold tabular-nums text-slate-500">접수 {countOf(m.type, "접수")}·진행 {countOf(m.type, "진행중")}·보류 {countOf(m.type, "보류")}</div>
          </button>
        );
      })}
      {hasSchedule && (
        <button type="button" aria-pressed={focusSchedule} onClick={toggleSchedule} className={`flex min-h-11 flex-col justify-center rounded-lg border px-2 py-1 text-left transition hover:border-slate-300 ${focusSchedule ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white"}`}>
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
        <div key={key} className="border-b border-slate-100 last:border-b-0">
          <div className="flex min-h-11 items-center">
            <button type="button" aria-expanded={isOpen} disabled={count === 0} onClick={() => setFolded((f) => ({ ...f, [key]: !isOpen }))} className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 px-3 text-left disabled:cursor-default">
              {count > 0 ? (isOpen ? <ChevronDown size={14} className="shrink-0 text-slate-400" aria-hidden /> : <ChevronRight size={14} className="shrink-0 text-slate-400" aria-hidden />) : <Check size={14} className="shrink-0 text-emerald-600" aria-hidden />}
              <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${bar}`} />
              <span className="truncate text-[13px] font-bold text-slate-800">{label}</span>
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
      stackItem(SCHEDULE_KEY, "물류 미처리", "bg-slate-500", schedAll.length, scheduleList(schedShown, schedHidden), <div className="px-3 pb-2">{scheduleNote}</div>);
    body = (
      <div className="flex flex-col">
        {columns.map((m) => (
          <div key={m.type} className="contents">
            {stackItem(m.type, m.label, m.bar, byType(m.type).length, typeBody(m.type), byType(m.type).length === 0 ? oldBody(m.type) : undefined, selectedType ? undefined : () => selectType(m.type))}
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
          <div className="px-3 pb-2">{scheduleNote}</div>
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
                  {all.length === 0 ? <div className="space-y-2 px-3 pb-3"><div className="text-[12px] font-black text-emerald-600">없음 ✓</div>{oldBody(m.type)}</div> : typeBody(m.type)}
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
    <section className={compact ? "bg-white" : "overflow-hidden rounded-2xl border border-slate-200 bg-white"} aria-label="미처리 접수 현황판">
      {header}
      {loading && <div role="status" className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-4 py-1.5 text-[11px] font-bold text-slate-500"><Loader2 size={12} className="animate-spin" />새로고침 중…</div>}
      {error && <div role="alert" className="flex items-center gap-1.5 border-b border-red-200 bg-red-50 px-4 py-1.5 text-[11px] font-black text-red-600"><AlertCircle size={12} />최신 조회 실패 — 이전 데이터 표시</div>}
      {sheetNotice && <div role="status" className="flex items-start gap-1.5 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-[11px] font-black text-amber-800"><AlertCircle size={12} className="mt-0.5 shrink-0" /><span className="min-w-0 wrap-break-word">{sheetNotice}</span></div>}
      {stats}
      {body}
    </section>
  );
}
