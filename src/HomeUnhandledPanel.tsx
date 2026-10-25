/**
 * 홈 미처리 칸(2026-10-19, 2026-10-24 "미처리 전체" 카드와 하나로 합침).
 * 숫자는 전부 현황판 묶음(HomeKpiBoard → loadKpiBundle)의 facts.unhandled = homeUnhandled.mergeUnhandled 한 벌에서 센다:
 *  · 머리 "미처리 n건" = 전체 행 수 = 팀 탭 합(A~E·경영·운영·영업·기타) = 종류 칸 합(복합기 AS·원격·IT·경영·운영·영업·AS 일정·물류)
 *  · 재계약 확인 지남 = kpiCompute.recontractOverdue(묶음 recontract, 무거운 원본이라 늦게 옴) — 팀·일정 행이 아니라 합계 밖 칸, 없으면 "—"
 * 전에는 이 칸이 자기 로더로 따로 읽었고, 옆 카드(HomeReceptionPanel)는 시트를 빼고 DB 접수만 셌다(접수 27 vs 435).
 * 탭(팀)·종류 칸(누르면 목록 거르기) → 목록은 "접수·AS" 묶음 + "물류" 묶음. 접수 행 → 서비스접수 미처리 현황, CS접수(일정) 행 → 일정리스트 미처리.
 * 갱신은 HomeKpiBoard 가 한다(unhandled 는 60초 가벼운 원본, 숨은 화면·탭에서 쉼).
 * 홈 3차(2026-10-25): 팀 탭 A~E 에 팀 색 점(min-h-11), 목록 줄 팀 글자는 팀 색 배지, team prop(홈 팀 카드 선택)이 오면 그 팀 탭으로. 숫자 로직 불변.
 * 미처리 단추(2026-10-25): 상세 팝업 아래 [완료][보류][배정](UnhandledActionBar — 부서 미니 업무공간·현황판 시트 카드와 같은 부품).
 *  누르면 unhandledPending 에 적혀 이 칸(머리·탭·종류 칸·목록)에서 바로 빠지고, 다음 묶음 읽기(60초)부터 다른 칸도 같이 맞는다.
 */
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import FormModal from "./FormModal";
import { teamColor, type TeamKey } from "./kpi/teamColors";
import { kindsForTab } from "./kpi/teamBoard";
import { CalendarClock } from "lucide-react";
import { fieldTicketVendor } from "./ids";
import { formatAssignees } from "./assignees";
import { overdueAgeTone } from "./overdueLogic";
import { RECEPTION_TYPE_META, type ReceptionType } from "./ReceptionTypePicker";
import { RECEPTION_RIGHT_KEY, SHOW_BOARD_EVENT } from "./receptionRightView";
import type { KpiBundle } from "./kpi/kpiData";
import { unhandledParts } from "./kpi/homeKpiModel";
import UnhandledActionBar, { SheetRowLink } from "./UnhandledActionBar.view";
import { applyPending, usePendingVersion } from "./unhandledPending";
import {
  countUnhandledKinds, countUnhandledTabs, oldestUnhandled, rowsForTab, splitByGroup, UNHANDLED_BADGE, UNHANDLED_KIND_LABEL,
  type UnhandledKind, type UnhandledRow, type UnhandledTab,
} from "./homeUnhandled";

const card = "rounded-2xl border border-white/[0.08] bg-white/[0.03]";
const TAB_GROUPS: UnhandledTab[][] = [["전체"], ["A", "B", "C", "D", "E"], ["경영", "운영", "영업"], ["기타"]];
const DEPT_TEAMS = new Set(["경영", "운영", "영업"]);

const dotOf = (k: UnhandledKind): string =>
  k === "CS접수" ? RECEPTION_TYPE_META["복합기 AS"].dot : k === "물류" ? "bg-slate-400" : RECEPTION_TYPE_META[k as ReceptionType]?.dot || "bg-slate-400";
/** 팀 탭(A~E)만 팀 색 — 전체·경영·운영·영업·기타는 null(점 없음) */
const tc = (t: string) => (t.length === 1 ? teamColor(t) : null);
/** 목록 줄 팀 글자 배지(팀 색 옅은 배경 + 팀 색 글자, 11px). 색만으로 구별하지 않게 글자(A~D·CSS)도 함께 */
function TeamBadge({ team }: { team: string }) {
  const c = tc(team);
  if (!c) return <span className="text-slate-500">{team}</span>;
  return <span className="rounded px-1 text-[11px] font-black leading-4" style={{ backgroundColor: c.soft, color: c.text }}>{c.label}</span>;
}
const vendorOf = (r: UnhandledRow) => (r.source === "ticket" ? (fieldTicketVendor(r.vendor).vendor || r.vendor) : r.vendor);

type Props = {
  /** 현황판 묶음 — unhandled(K16)·recontract(K12) 원본을 쓴다. null = 아직 안 읽음 */
  bundle: KpiBundle | null;
  onOpenOverdue: () => void;
  onOpenReception: () => void;
  onRetry?: () => void;
  /** 홈 팀 카드에서 고른 팀(없으면 전체) — 바뀌면 그 팀 탭으로 옮긴다 */
  team?: TeamKey | null;
};

export default function HomeUnhandledPanel({ bundle, onOpenOverdue, onOpenReception, onRetry, team = null }: Props) {
  const [tab, setTab] = useState<UnhandledTab>(team ?? "전체");
  // 팀 카드 선택이 바뀌면 탭을 따라 옮긴다(렌더 중 상태 맞춤 — effect 없이). 사용자가 탭을 직접 눌러도 다음 카드 선택 전까지 그대로
  const [seenTeam, setSeenTeam] = useState<TeamKey | null>(team);
  if (seenTeam !== team) { setSeenTeam(team); setTab(team ?? "전체"); }
  const [kind, setKind] = useState<UnhandledKind | null>(null);
  const [detail, setDetail] = useState<UnhandledRow | null>(null);
  const closeDetail = useCallback(() => setDetail(null), []);
  // 방금 처리한 줄은 묶음을 다시 읽기 전에도 이 칸에서 먼저 반영(로더도 같은 pending 을 입힌다 — 두 번 입혀도 같다)
  const pendingVer = usePendingVersion();
  const rawRows = bundle?.facts.unhandled ?? null;
  const rows = useMemo(() => (rawRows && pendingVer >= 0 ? applyPending(rawRows) : rawRows), [rawRows, pendingVer]);
  const src = bundle?.sources.unhandled;
  const srcError = src && src.status !== "ok" ? src.error : "";
  const recSrc = bundle?.sources.recontract;
  const recontract = unhandledParts(bundle).recontract;
  const recState = recontract !== null ? "" : recSrc && recSrc.status !== "ok" ? "재계약 원본을 못 읽음" : "재계약 확인 중";
  const info = bundle?.unhandledInfo ?? null;

  const counts = useMemo(() => countUnhandledTabs(rows || []), [rows]);
  const tabRows = useMemo(() => rowsForTab(rows || [], tab), [rows, tab]);
  const kinds = useMemo(() => countUnhandledKinds(tabRows), [tabRows]);
  // 고른 탭에 맞는 종류 칸만(2026-10-25) — 숫자는 그대로, 보이는 칸만 줄인다. 고른 칸이 숨겨지면 선택을 풀어 그 탭 전체 목록
  const shownKinds = useMemo(() => kindsForTab(tab, kinds), [tab, kinds]);
  const activeKind = kind && shownKinds.kinds.includes(kind) ? kind : null;
  if (kind && !activeKind) setKind(null);
  const list = useMemo(() => (activeKind ? tabRows.filter((r) => r.kind === activeKind) : tabRows), [tabRows, activeKind]);
  const groups = useMemo(() => splitByGroup(list), [list]);
  const oldest = useMemo(() => oldestUnhandled(tabRows), [tabRows]);
  const total = counts["전체"];
  // 서비스접수 화면이 이미 떠 있으면(KeepAlive) localStorage 를 다시 읽지 않으므로 이벤트도 같이 보낸다
  const openReception = () => {
    try { localStorage.setItem(RECEPTION_RIGHT_KEY, "board"); } catch { /* 저장 못 해도 이벤트로 연다 */ }
    window.dispatchEvent(new CustomEvent(SHOW_BOARD_EVENT));
    onOpenReception();
  };
  const renderRow = (r: UnhandledRow) => {
    const tone = overdueAgeTone(r.ageDays);
    const vendor = vendorOf(r);
    const body = (
      <>
        <span className="w-11 shrink-0 font-mono text-[11px] font-bold tabular-nums text-slate-400">{r.date.slice(5).replace("-", "/")}</span>
        <span className={`w-12 shrink-0 text-[10.5px] font-black ${tone === "red" ? "text-rose-300" : tone === "amber" ? "text-amber-300" : "text-slate-400"}`}>{r.ageDays ? `${r.ageDays}일 전` : "오늘"}</span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-slate-100">{vendor || r.title || "(업체 없음)"}</span>
        <span className="flex shrink-0 items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-black text-slate-300">
          <span className={`h-1.5 w-1.5 rounded-full ${dotOf(r.kind)}`} aria-hidden />
          {UNHANDLED_BADGE[r.kind]}
          {r.team && !DEPT_TEAMS.has(r.team) ? <TeamBadge team={r.team} /> : null}
        </span>
        <span className={`w-14 shrink-0 truncate text-right text-[11px] font-black ${r.assignee ? "text-slate-400" : "text-rose-300"}`}>{formatAssignees(r.assignee, { short: true }) || "미배정"}</span>
      </>
    );
    // 2026-10-25 사용자 "제목을 누르면 탭 이동 말고 상세 팝업": 줄 → 상세 팝업, 이동은 팝업 안 [열기] 단추로
    return <UnhandledRowButton row={r} onPick={setDetail}>{body}</UnhandledRowButton>;
  };
  // 작은 칸 — 종류 8칸(누르면 목록 거르기) + 재계약 확인 지남(합계 밖, 점선)
  const cell = (key: string, label: string, value: number | null, on: boolean, onClick?: () => void, note?: string) => (
    <button
      key={key} type="button" onClick={onClick} disabled={!onClick} title={note} data-kind={key}
      className={`flex min-w-0 flex-col items-start rounded-lg border px-2 py-1.5 text-left transition ${on ? "border-white/40 bg-white/[0.10]" : "border-white/[0.06] bg-white/[0.03]"} ${onClick ? "hover:border-white/25" : "cursor-default border-dashed"}`}
    >
      <span className="w-full truncate text-[10px] font-black text-slate-400">{label}</span>
      <span className={`font-mono text-[14px] font-black ${value === null ? "text-slate-500" : value ? "text-rose-200" : "text-emerald-300"}`}>{value === null ? "—" : value}</span>
    </button>
  );
  return (
    <div className={`p-4 sm:col-span-2 ${card}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-[10.5px] font-black tracking-[0.18em] text-slate-400"><CalendarClock size={13} className={total ? "text-rose-300" : "text-emerald-300"} />미처리</span>
        <span className={`font-mono text-[13px] font-black ${total ? "text-rose-200" : "text-emerald-300"}`}>{rows === null ? "…" : `${total}건`}</span>
        {rows !== null && tab !== "전체" && <span className="text-[10.5px] font-bold text-slate-500">{tc(tab)?.label ?? tab} {tabRows.length}건</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {TAB_GROUPS.map((group, gi) => {
          const shown = group.filter((t) => t !== "기타" || counts[t] > 0); // 기타(팀 없는 일정)는 있을 때만
          if (!shown.length) return null;
          return (
            <span key={gi} className="flex items-center gap-1">
              {gi > 0 && <span className="mx-0.5 h-4 w-px bg-white/10" aria-hidden />}
              {shown.map((t) => {
                const n = counts[t];
                const on = tab === t;
                return (
                  <button key={t} type="button" onClick={() => setTab(t)} aria-pressed={on} className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[11px] font-black transition ${on ? "bg-white text-slate-950" : n ? "bg-white/[0.06] text-rose-200 hover:text-white" : "bg-white/[0.06] text-slate-500 hover:text-slate-300"}`}>
                    {tc(t) && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tc(t)?.hex }} />}
                    {tc(t)?.label ?? t}{n ? <span className={`font-mono ${on ? "text-rose-600" : ""}`}>{n}</span> : ""}
                  </button>
                );
              })}
            </span>
          );
        })}
      </div>
      {/* 칸이 하나뿐이면(경영·운영·영업 탭) 칸 띠는 숨기고 목록 바로 */}
      {(shownKinds.kinds.length + (shownKinds.recontract ? 1 : 0)) > 1 && (
        <div className={`mt-2.5 grid grid-cols-3 gap-1.5 ${shownKinds.recontract ? "sm:grid-cols-5 lg:grid-cols-9" : "sm:grid-cols-5"}`}>
          {shownKinds.kinds.map((k) => cell(k, UNHANDLED_KIND_LABEL[k], rows === null ? null : kinds[k], activeKind === k, () => setKind(activeKind === k ? null : k)))}
          {shownKinds.recontract && cell("recontract", "재계약 확인 지남", recontract, false, undefined, recState ? `${recState} · 합계 밖(업체 단위)` : "합계 밖(업체 단위) — 다음확인일이 지난 재계약")}
        </div>
      )}
      {rows !== null && oldest && (
        <p className="mt-2 truncate text-[11px] font-bold text-slate-400">
          가장 오래된 건 · <span className="text-slate-200">{vendorOf(oldest) || oldest.title || "업체 미정"}</span> ({oldest.ageDays}일 · {UNHANDLED_BADGE[oldest.kind]})
        </p>
      )}
      {srcError && (
        <p className="mt-2 text-[11px] font-bold text-amber-300">
          미처리를 새로 읽지 못했습니다{rows ? " — 마지막 값" : ""} · {srcError}
          {onRetry && <button type="button" onClick={onRetry} className="ml-2 font-black text-blue-300 hover:text-white">다시</button>}
        </p>
      )}
      {info?.sheetMode && (
        <p className="mt-1.5 text-[10.5px] font-bold text-slate-500">
          영업·경영·원격·IT 는 시트 상태 열 기준 · 최근 90일
          {info.over90 > 0 && <span className="ml-1.5 rounded-full bg-white/[0.06] px-2 py-0.5 font-black text-slate-300">90일 넘음 {info.over90}</span>}
        </p>
      )}
      <div className="mt-3 max-h-[320px] overflow-y-auto rounded-xl border border-white/[0.06]">
        {rows === null && <ul>{Array.from({ length: 3 }).map((_, i) => <li key={i} className="px-3 py-2.5"><div className="h-3.5 animate-pulse rounded bg-white/[0.06]" /></li>)}</ul>}
        {rows !== null && !list.length && <p className="px-3 py-5 text-center text-[12px] font-bold text-emerald-300">{tab === "전체" ? "" : `${tc(tab)?.label ?? tab} `}{activeKind ? `${UNHANDLED_KIND_LABEL[activeKind]} ` : ""}미처리 없음</p>}
        {rows !== null && groups.work.length > 0 && (
          <section>
            <h4 className="sticky top-0 bg-slate-900/95 px-3 py-1.5 text-[10.5px] font-black tracking-wide text-slate-300">접수·AS <span className="font-mono text-rose-200">{groups.work.length}건</span></h4>
            <ul className="divide-y divide-white/[0.06]">{groups.work.map((r) => <li key={r.key}>{renderRow(r)}</li>)}</ul>
          </section>
        )}
        {rows !== null && groups.logistics.length > 0 && (
          <section>
            <h4 className="sticky top-0 bg-slate-900/95 px-3 py-1.5 text-[10.5px] font-black tracking-wide text-slate-300">물류 <span className="font-mono text-rose-200">{groups.logistics.length}건</span> <span className="ml-1 text-[10px] font-bold text-slate-500">줄을 눌러 [완료] — 네이버 일정에도 완료 체크</span></h4>
            <ul className="divide-y divide-white/[0.06]">{groups.logistics.map((r) => <li key={r.key}>{renderRow(r)}</li>)}</ul>
          </section>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <button type="button" onClick={openReception} className="text-[11px] font-black text-blue-300 transition hover:text-white">접수 미처리 현황 →</button>
        <button type="button" onClick={onOpenOverdue} className="text-[11px] font-black text-blue-300 transition hover:text-white">AS 일정리스트 →</button>
      </div>
      {detail && typeof document !== "undefined" && createPortal(
        <UnhandledDetail row={detail} onClose={closeDetail} actions onOpen={detail.kind === "물류" ? undefined : () => { setDetail(null); if (detail.source === "reception") openReception(); else onOpenOverdue(); }} />,
        document.body,
      )}
    </div>
  );
}

/** 목록 한 줄 단추 — 누르면 상세 팝업(onPick)만. 화면 이동 콜백은 받지 않는다(이동은 팝업 안 [열기]) */
export function UnhandledRowButton({ row, onPick, children }: { row: UnhandledRow; onPick: (r: UnhandledRow) => void; children: ReactNode }) {
  return (
    <button type="button" onClick={() => onPick(row)} aria-haspopup="dialog" className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-white/[0.05] ${row.kind === "물류" ? "opacity-80" : ""}`}>
      {children}
    </button>
  );
}

/**
 * 미처리 상세 팝업(FormModal — 폰은 아래서 올라오는 시트). 이미 받은 행 값만(새 조회 없음), 글은 평문(HTML 해석 안 함).
 * actions 면 아래에 [완료][보류][배정](UnhandledActionBar). onOpen 은 보조 단추(접수 = 서비스접수에서 열기, CS접수 = 일정리스트에서 열기), 물류는 없음.
 * 단추를 누르면(처리 시작) 팝업을 닫는다 — 줄은 목록에서 바로 빠지거나 상태가 바뀐다.
 */
export function UnhandledDetail({ row, onClose, onOpen, actions = false, author }: { row: UnhandledRow; onClose: () => void; onOpen?: () => void; actions?: boolean; author?: string }) {
  const vendor = vendorOf(row);
  const c = tc(row.team);
  const field = (label: string, value: ReactNode) => (
    <div className="flex gap-3 text-[13px]"><dt className="w-16 shrink-0 font-bold text-slate-500">{label}</dt><dd className="min-w-0 flex-1 break-words font-semibold text-slate-800">{value}</dd></div>
  );
  const ticketOpen = actions && row.source === "ticket"; // 일정 줄은 열기를 단추 줄 안의 보조 단추로
  return (
    <FormModal
      title={vendor || row.title || "(업체 없음)"}
      subtitle={`${UNHANDLED_KIND_LABEL[row.kind]} 미처리 · ${row.source === "reception" ? "서비스접수" : "AS 일정"}`}
      onClose={onClose}
      footer={<div className="flex w-full flex-col gap-2">
        {actions && <UnhandledActionBar row={row} author={author} onStarted={onClose} onOpenSchedule={ticketOpen ? onOpen : undefined} />}
        <div className="flex items-center justify-end gap-2">
          {onOpen && !ticketOpen && <button type="button" onClick={onOpen} className={`min-h-11 rounded-xl px-4 text-[13px] font-black transition ${actions ? "bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100" : "bg-blue-600 text-white hover:bg-blue-500"}`}>{row.source === "reception" ? "서비스접수에서 열기" : "AS 일정리스트에서 열기"}</button>}
          <button type="button" onClick={onClose} className="min-h-11 rounded-xl bg-white px-4 text-[13px] font-black text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-100">닫기</button>
        </div>
      </div>}
    >
      <dl className="space-y-2">
        {field("종류", UNHANDLED_KIND_LABEL[row.kind])}
        {field("팀", c ? <span className="rounded px-1.5 py-0.5 text-[12px] font-black text-slate-900" style={{ backgroundColor: c.hex }}>{c.label}</span> : row.team || "없음")}
        {field("접수일", `${row.date || "—"} · ${row.ageDays ? `${row.ageDays}일 지남` : "오늘"}`)}
        {field("담당자", formatAssignees(row.assignee) || <span className="text-rose-600">미배정</span>)}
        {field("상태", row.status || "—")}
      </dl>
      <div>
        <div className="mb-1 flex items-center gap-2 text-[12px] font-bold text-slate-500">내용<span className="ml-auto"><SheetRowLink row={row} /></span></div>
        <p className="whitespace-pre-wrap break-words rounded-xl bg-slate-50 px-3 py-2.5 text-[13px] font-semibold leading-relaxed text-slate-800">{row.detail || row.title || "(내용 없음)"}</p>
      </div>
      {row.kind === "물류" && <p className="text-[12px] font-bold text-slate-500">[완료]를 누르면 일정리스트에서 완료되고 네이버 캘린더 일정에도 완료 체크됩니다(이동 없음).</p>}
    </FormModal>
  );
}
