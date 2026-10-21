// 조회 › 미수 › [방문 이력] 의 표시 틀(조회·필터 계산·복사 없음). 값·핸들러·계산 결과는 모두 props 로 받는다.
// 설계: docs/tasks/misu-redesign.md §4-B. PC 위주지만 폰(390px)에서도 표 대신 카드로 접힌다.
// 업체 카드(상태 칩) → 펼치면 소송이관 준비 체크리스트 ⓐ~ⓖ + [법무 전달용 복사] → 방문 타임라인(최신 위) → 이전 기록(카톡·관리부 메모, 회색).
import { useState, type ReactNode } from "react";
import {
  AlertCircle, AlertTriangle, Camera, Check, ChevronDown, Clock, Copy, CornerDownRight, EyeOff, FilePlus, Loader2,
  RotateCcw, Search, SlidersHorizontal, X,
} from "lucide-react";
import PortalSelect from "./PortalSelect";

// ───────── 타입 ─────────
export type MisuVisitStatusView = "소송이관 준비 완료" | "보완 필요" | "반환요구 기록 있음" | "2차 완료" | "1차만" | "방문 기록 없음";

export type MisuHistoryVendor = {
  key: string; // 업체 묶음 키(거래처코드 → 임순 → 정규화 이름)
  name: string;
  team?: string; // A~E
  region?: string;
  months?: string; // "5개월"
  monthsNum?: number; // 3 이상이면 빨강 표시
  balance?: string; // "2,140,050원"
  status: MisuVisitStatusView;
  visitCount: number;
  lastVisit?: { date: string; round: string; author: string } | null; // date 는 표시용("10-22")
  linkedByName?: boolean; // 코드 없이 이름으로 이어진 묶음
  csChecked?: boolean;
};

export type MisuHistoryPhoto = {
  slot: string; // outside | door | device | notice
  label: string; // "외부"
  url?: string; // 원본(뷰어로 넘김)
  thumbUrl?: string; // 썸네일(없으면 url)
  skipReason?: string; // 촬영 불가 사유
};

export type MisuHistoryVisit = {
  id: string;
  round: string; // 1차 안내 / 2차 경고 / 추가
  visitedAt: string; // 표시용 "10-22(수) 14:20"
  createdAt: string; // 표시용 "10-22 14:35"
  author: string;
  authorTeam?: string;
  judgment?: string; // 계속 독촉 / 철수 / 소송이관
  judgmentReason?: string;
  lines: string[]; // misuVisitLines() — "① 응대자: …" (첫 ": " 앞이 라벨)
  photos: MisuHistoryPhoto[];
  missing: string[]; // 경고로 통과한 미충족 — '보완 필요'
  offHours?: boolean; // 08~21시 밖
  offHoursReason?: string;
  textBody?: string; // 카톡 원문
  room?: string; // 보낸 방(빈 값 = 저장만)
  supplementOf?: string | null; // 보완 기록이면 원 기록 id → 들여쓰기
  canHide?: boolean; // 작성자 본인·당일
};

/** misuVisit.ts litigationChecklist().items 를 그대로 넘길 수 있는 모양. mark: "ⓐ"…"ⓖ" */
export type MisuChecklistItemView = { key: string; mark: string; label: string; ok: boolean; detail?: string };

/** misuVisit.ts MisuLegacyEntry 와 같은 모양. at 은 화면에 그대로 찍힌다. source: "카톡" | "경영체크" | "전략체크" | "CS체크" */
export type MisuLegacyEntryView = { at: string; source: string; author?: string; text: string };

export type MisuHistoryDetail = {
  state: "loading" | "error" | "ready";
  error?: string;
  visits: MisuHistoryVisit[]; // 최신 위, 보완 기록은 원 기록 바로 아래에 놓아서 넘긴다(mergeMisuTimeline 순서)
  checklist: MisuChecklistItemView[];
  legacyState: "loading" | "error" | "ready";
  legacyError?: string;
  legacy: MisuLegacyEntryView[];
};

export type MisuHistoryFilters = {
  team: string; // "전체" | "A"…
  period: "30일" | "90일" | "전체" | "직접";
  from: string; // YYYY-MM-DD (직접)
  to: string;
  judgment: string; // "" = 전체
  status: string; // "" = 전체
  author: string; // "" = 전체
  query: string;
  sort: "최근 방문순" | "잔액순" | "개월순";
};

export type MisuVisitHistoryViewProps = {
  state: "loading" | "error" | "ready";
  error?: string;
  onRetry?: () => void;
  tableNotReady?: boolean; // misu_visits 표 실행 전
  vendors: MisuHistoryVendor[]; // 필터·정렬이 끝난 목록
  totalCount?: number; // 필터 전 업체 수
  filters: MisuHistoryFilters;
  onFilters: (patch: Partial<MisuHistoryFilters>) => void;
  teamOptions?: string[]; // 기본 A~E
  authorOptions: string[];
  openKey: string | null;
  onToggle: (key: string) => void;
  detail: MisuHistoryDetail | null; // openKey 업체의 상세
  onOpenPhoto: (urls: string[], index: number) => void; // 컨테이너가 PhotoViewer 를 띄운다
  onCopyLegal: (key: string) => void;
  copyResult?: { key: string; tone: "ok" | "error"; text: string } | null;
  onHide?: (visitId: string) => void; // 확인창은 컨테이너(confirmModal)에서
  onSupplement?: (visitId: string) => void; // 보완 기록 쓰기(작성기로 이동)
};

// ───────── 색 ─────────
const STATUS_ORDER: MisuVisitStatusView[] = ["소송이관 준비 완료", "보완 필요", "반환요구 기록 있음", "2차 완료", "1차만", "방문 기록 없음"];
const STATUS_TONE: Record<MisuVisitStatusView, string> = {
  "소송이관 준비 완료": "bg-emerald-100 text-emerald-700 ring-emerald-200",
  "보완 필요": "bg-amber-100 text-amber-800 ring-amber-200",
  "반환요구 기록 있음": "bg-blue-50 text-blue-700 ring-blue-200",
  "2차 완료": "bg-indigo-50 text-indigo-700 ring-indigo-200",
  "1차만": "bg-slate-100 text-slate-600 ring-slate-200",
  "방문 기록 없음": "bg-white text-slate-400 ring-slate-200",
};
const JUDGMENT_TONE: Record<string, string> = {
  "계속 독촉": "bg-blue-50 text-blue-700",
  "철수": "bg-amber-100 text-amber-800",
  "소송이관": "bg-rose-100 text-rose-700",
};

/** 상태 칩 — [전체 현황] 줄에서도 그대로 쓸 수 있게 export */
export function MisuVisitStatusChip({ status, size = "md" }: { status: MisuVisitStatusView; size?: "sm" | "md" }) {
  return <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full font-black ring-1 ring-inset ${size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]"} ${STATUS_TONE[status]}`}>{status}</span>;
}

const pill = (on: boolean) => `inline-flex min-h-9 shrink-0 items-center rounded-full px-3 text-[12px] font-black transition ${on ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`;
const dateInput = "h-11 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-[13px] font-semibold text-slate-800 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10";

function FilterRow({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <span className="w-10 shrink-0 text-[10px] font-black text-slate-400">{name}</span>
      {children}
    </div>
  );
}

function Checklist({ items, onCopy, copyResult }: { items: MisuChecklistItemView[]; onCopy: () => void; copyResult?: { tone: "ok" | "error"; text: string } | null }) {
  const okCount = items.filter((i) => i.ok).length;
  const all = items.length > 0 && okCount === items.length;
  return (
    <div className={`rounded-lg border p-3 ${all ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200 bg-slate-50/60"}`}>
      <div className="flex items-center gap-2">
        <b className="text-[13px] font-black text-slate-800">소송이관 준비</b>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-black tabular-nums ${all ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-600"}`}>{okCount}/{items.length}</span>
      </div>
      <ul className="mt-2 grid gap-1 sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.key} className="flex items-start gap-1.5 text-[12px] leading-5">
            <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${i.ok ? "bg-emerald-500 text-white" : "bg-rose-100 text-rose-600"}`}>{i.ok ? <Check size={11} aria-label="충족" /> : <X size={11} aria-label="미충족" />}</span>
            <span className="min-w-0">
              <span className={`font-bold ${i.ok ? "text-slate-700" : "text-rose-700"}`}>{i.mark} {i.label}</span>
              {i.detail && <span className="block text-[11px] font-medium text-slate-500">{i.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onCopy} disabled={!all} className="mt-2.5 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 text-[13px] font-black text-white transition hover:bg-slate-800 disabled:pointer-events-none disabled:bg-slate-300 sm:w-auto">
        <Copy size={15} aria-hidden />법무 전달용 복사
      </button>
      {!all && <div className="mt-1 text-[11px] font-bold text-slate-500">ⓐ~ⓖ가 모두 채워지면 복사할 수 있습니다.</div>}
      {copyResult && <div role={copyResult.tone === "error" ? "alert" : "status"} className={`mt-1 text-[12px] font-bold ${copyResult.tone === "error" ? "text-rose-600" : "text-emerald-700"}`}>{copyResult.text}</div>}
    </div>
  );
}

function PhotoStrip({ photos, onOpen }: { photos: MisuHistoryPhoto[]; onOpen: (urls: string[], index: number) => void }) {
  const viewable = photos.filter((ph) => ph.url);
  const urls = viewable.map((ph) => ph.url as string);
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {photos.map((ph) => {
        const idx = ph.url ? urls.indexOf(ph.url) : -1;
        return ph.url ? (
          <button key={ph.slot} type="button" onClick={() => onOpen(urls, Math.max(0, idx))} className="group relative aspect-square overflow-hidden rounded-md bg-slate-100" aria-label={`${ph.label} 사진 크게 보기`}>
            <img src={ph.thumbUrl || ph.url} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:opacity-90" />
            <span className="absolute inset-x-0 bottom-0 truncate bg-black/50 px-1 py-0.5 text-[10px] font-bold text-white">{ph.label}</span>
          </button>
        ) : (
          <div key={ph.slot} className="flex aspect-square flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 p-1 text-center">
            <Camera size={14} className="text-slate-300" aria-hidden />
            <span className="mt-0.5 text-[10px] font-bold text-slate-500">{ph.label}</span>
            <span className={`text-[10px] font-semibold leading-3 ${ph.skipReason ? "text-slate-500" : "text-rose-600"}`}>{ph.skipReason ? `불가: ${ph.skipReason}` : "없음"}</span>
          </div>
        );
      })}
    </div>
  );
}

function VisitItem({ v, onOpenPhoto, onHide, onSupplement }: { v: MisuHistoryVisit; onOpenPhoto: (urls: string[], index: number) => void; onHide?: (id: string) => void; onSupplement?: (id: string) => void }) {
  const is2nd = v.round === "2차 경고";
  return (
    <li className={`relative ${v.supplementOf ? "ml-5" : ""}`}>
      <span aria-hidden className={`absolute -left-4.25 top-3 h-2.5 w-2.5 rounded-full ring-2 ring-white ${v.supplementOf ? "hidden" : is2nd ? "bg-rose-500" : "bg-blue-500"}`} />
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {v.supplementOf && <span className="inline-flex items-center gap-0.5 text-[11px] font-black text-slate-500"><CornerDownRight size={12} aria-hidden />보완</span>}
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${is2nd ? "bg-rose-50 text-rose-700" : "bg-blue-50 text-blue-700"}`}>{v.round}</span>
          {v.judgment && <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${JUDGMENT_TONE[v.judgment] || "bg-slate-100 text-slate-600"}`}>{v.judgment}</span>}
          {v.missing.length > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-black text-amber-800">보완 필요</span>}
          {v.offHours && <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-black text-amber-800"><Clock size={11} aria-hidden />시간 외</span>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] font-bold text-slate-700">
          <span>{v.visitedAt} 방문</span>
          <span className="text-slate-300" aria-hidden>·</span>
          <span>{v.author}{v.authorTeam ? `(${v.authorTeam})` : ""}</span>
          <span className="text-slate-300" aria-hidden>·</span>
          <span className="font-medium text-slate-400">작성 {v.createdAt}</span>
        </div>
        {v.judgmentReason && <div className="mt-1 text-[12px] font-semibold text-slate-600">판단 사유: {v.judgmentReason}</div>}
        {v.offHours && v.offHoursReason && <div className="mt-0.5 text-[12px] font-semibold text-amber-800">시간 외 사유: {v.offHoursReason}</div>}

        <dl className="mt-2 space-y-1">
          {v.lines.map((line, i) => {
            const cut = line.indexOf(": ");
            const k = cut > 0 ? line.slice(0, cut) : "";
            const text = cut > 0 ? line.slice(cut + 2) : line;
            return (
              <div key={`${i}-${k}`} className="grid grid-cols-[76px_minmax(0,1fr)] gap-2 text-[12px] leading-5 sm:grid-cols-[96px_minmax(0,1fr)]">
                <dt className="font-bold text-slate-400">{k}</dt>
                <dd className={`break-keep ${text.trim() ? "font-semibold text-slate-800" : "font-bold text-rose-600"}`}>{text.trim() || "(비어 있음)"}</dd>
              </div>
            );
          })}
        </dl>
        {v.missing.length > 0 && <div className="mt-1.5 rounded-md bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800">보완할 것: {v.missing.join(", ")}</div>}

        {v.photos.length > 0 && <div className="mt-2"><PhotoStrip photos={v.photos} onOpen={onOpenPhoto} /></div>}

        <div className="mt-2 flex flex-wrap items-center gap-1">
          {v.textBody && (
            <details className="group w-full">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 text-[12px] font-bold text-slate-500 [&::-webkit-details-marker]:hidden">
                카톡 원문{v.room ? ` · ${v.room}` : " · 저장만(방 미정)"}<ChevronDown size={14} aria-hidden className="transition group-open:rotate-180" />
              </summary>
              <pre className="whitespace-pre-wrap break-all rounded-md bg-slate-50 p-2.5 font-sans text-[12px] leading-5 text-slate-700">{v.textBody}</pre>
            </details>
          )}
          {onSupplement && !v.supplementOf && <button type="button" onClick={() => onSupplement(v.id)} className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-[12px] font-bold text-blue-700 hover:bg-blue-50"><FilePlus size={14} aria-hidden />보완 기록 쓰기</button>}
          {onHide && v.canHide && <button type="button" onClick={() => onHide(v.id)} className="ml-auto inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-[12px] font-bold text-slate-400 hover:bg-slate-100 hover:text-slate-600"><EyeOff size={14} aria-hidden />숨기기</button>}
        </div>
      </div>
    </li>
  );
}

function VendorDetail({ vendorKey, detail, p }: { vendorKey: string; detail: MisuHistoryDetail | null; p: MisuVisitHistoryViewProps }) {
  if (!detail || detail.state === "loading") {
    return <div role="status" className="flex items-center gap-1.5 px-1 py-4 text-[12px] font-bold text-slate-500"><Loader2 size={14} className="animate-spin" aria-hidden />방문 이력을 불러오는 중입니다.</div>;
  }
  if (detail.state === "error") {
    return (
      <div role="alert" className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2.5 text-[12px] font-bold text-rose-700">
        <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden /><span className="min-w-0 flex-1">방문 이력을 불러오지 못했습니다.{detail.error ? ` (${detail.error})` : ""}</span>
        {p.onRetry && <button type="button" onClick={p.onRetry} className="inline-flex min-h-9 shrink-0 items-center gap-0.5 rounded px-1.5 text-blue-700 hover:bg-white"><RotateCcw size={12} aria-hidden />다시</button>}
      </div>
    );
  }
  const copy = p.copyResult && p.copyResult.key === vendorKey ? p.copyResult : null;
  return (
    <div className="space-y-3">
      <Checklist items={detail.checklist} onCopy={() => p.onCopyLegal(vendorKey)} copyResult={copy} />

      <div>
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">방문 타임라인</div>
        {detail.visits.length ? (
          <ol className="mt-2 space-y-2 border-l-2 border-slate-200 pl-3">
            {detail.visits.map((v) => <VisitItem key={v.id} v={v} onOpenPhoto={p.onOpenPhoto} onHide={p.onHide} onSupplement={p.onSupplement} />)}
          </ol>
        ) : (
          <div className="mt-2 rounded-lg border border-dashed border-slate-200 px-3 py-5 text-center text-[12px] font-bold text-slate-400">아직 CS 방문 기록이 없습니다. 필드 › 미수에서 작성하면 여기에 쌓입니다.</div>
        )}
      </div>

      <details className="group rounded-lg bg-slate-50">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 px-3 text-[12px] font-bold text-slate-500 [&::-webkit-details-marker]:hidden">
          이전 기록 (카톡·관리부 메모){detail.legacyState === "ready" && <span className="tabular-nums text-slate-400">{detail.legacy.length}건</span>}
          <span className="text-[11px] font-medium text-slate-400">— 체크리스트에는 세지 않습니다</span>
          <ChevronDown size={14} aria-hidden className="ml-auto shrink-0 transition group-open:rotate-180" />
        </summary>
        <div className="px-3 pb-3">
          {detail.legacyState === "loading" && <div role="status" className="flex items-center gap-1.5 text-[12px] font-bold text-slate-400"><Loader2 size={13} className="animate-spin" aria-hidden />불러오는 중입니다.</div>}
          {detail.legacyState === "error" && <div role="alert" className="text-[12px] font-bold text-rose-600">이전 기록을 불러오지 못했습니다.{detail.legacyError ? ` (${detail.legacyError})` : ""}</div>}
          {detail.legacyState === "ready" && !detail.legacy.length && <div className="text-[12px] font-bold text-slate-400">이전 기록이 없습니다.</div>}
          {detail.legacyState === "ready" && detail.legacy.length > 0 && (
            <ul className="max-h-80 space-y-1.5 overflow-y-auto">
              {detail.legacy.map((e, i) => (
                <li key={`${i}-${e.at}`} className="rounded-md border border-slate-200 bg-white/60 px-2.5 py-1.5 text-slate-500">
                  <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] font-bold text-slate-400">
                    <span className="rounded bg-slate-200 px-1.5 py-px text-slate-500">{e.source}</span><span>{e.at}</span>{e.author && <span>{e.author}</span>}
                  </div>
                  <div className="mt-0.5 whitespace-pre-wrap break-all text-[12px] leading-5">{e.text}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </div>
  );
}

export default function MisuVisitHistoryView(p: MisuVisitHistoryViewProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const f = p.filters;
  const teams = p.teamOptions || ["A", "B", "C", "D", "E"];
  const activeMore = [f.period !== "전체" && f.period, f.judgment, f.status, f.author].filter(Boolean).length;
  const statusCounts = STATUS_ORDER.map((s) => [s, p.vendors.filter((v) => v.status === s).length] as const);

  return (
    <div className="space-y-3">
      {p.tableNotReady && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] font-bold text-amber-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />방문이력 표가 아직 준비 중입니다. 관리부 미수 목록과 이전 기록만 보입니다.
        </div>
      )}

      {/* 필터 */}
      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
            <input value={f.query} onChange={(e) => p.onFilters({ query: e.target.value })} placeholder="업체명 검색" aria-label="업체명 검색" className="h-11 w-full rounded-lg border border-slate-300 pl-9 pr-3 text-[13px] font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
          </div>
          <button type="button" onClick={() => setMoreOpen((x) => !x)} aria-expanded={moreOpen} className={`inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg border px-3 text-[12px] font-black transition ${moreOpen || activeMore ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
            <SlidersHorizontal size={14} aria-hidden />필터{activeMore ? ` ${activeMore}` : ""}
          </button>
        </div>
        <FilterRow name="팀">
          {["전체", ...teams].map((t) => <button key={t} type="button" aria-pressed={f.team === t} onClick={() => p.onFilters({ team: t })} className={pill(f.team === t)}>{t === "전체" ? "전체" : `${t}팀`}</button>)}
        </FilterRow>
        <FilterRow name="상태">
          <button type="button" aria-pressed={!f.status} onClick={() => p.onFilters({ status: "" })} className={pill(!f.status)}>전체</button>
          {statusCounts.map(([s, n]) => (
            <button key={s} type="button" aria-pressed={f.status === s} onClick={() => p.onFilters({ status: f.status === s ? "" : s })} className={pill(f.status === s)}>
              {s}{p.state === "ready" && !f.status && <span className="ml-1 tabular-nums opacity-70">{n}</span>}
            </button>
          ))}
        </FilterRow>
        {moreOpen && (
          <div className="space-y-2 border-t border-slate-100 pt-2">
            <FilterRow name="기간">
              {(["30일", "90일", "전체", "직접"] as const).map((x) => <button key={x} type="button" aria-pressed={f.period === x} onClick={() => p.onFilters({ period: x })} className={pill(f.period === x)}>{x === "30일" || x === "90일" ? `최근 ${x}` : x}</button>)}
            </FilterRow>
            {f.period === "직접" && (
              <div className="flex items-center gap-1.5 pl-11.5">
                <input type="date" value={f.from} onChange={(e) => p.onFilters({ from: e.target.value })} aria-label="시작일" className={dateInput} />
                <span className="text-slate-400" aria-hidden>~</span>
                <input type="date" value={f.to} onChange={(e) => p.onFilters({ to: e.target.value })} aria-label="종료일" className={dateInput} />
              </div>
            )}
            <FilterRow name="판단">
              {["", "계속 독촉", "철수", "소송이관"].map((j) => <button key={j || "전체"} type="button" aria-pressed={f.judgment === j} onClick={() => p.onFilters({ judgment: j })} className={pill(f.judgment === j)}>{j || "전체"}</button>)}
            </FilterRow>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-10 shrink-0 text-[10px] font-black text-slate-400">작성자</span>
              <PortalSelect value={f.author} onChange={(x) => p.onFilters({ author: x })} width={180} placeholder="전체"
                options={[{ value: "", label: "전체" }, ...p.authorOptions.map((a) => ({ value: a, label: a }))]} />
              <span className="ml-1 w-8 shrink-0 text-[10px] font-black text-slate-400">정렬</span>
              <PortalSelect value={f.sort} onChange={(x) => p.onFilters({ sort: x as MisuHistoryFilters["sort"] })} width={150}
                options={(["최근 방문순", "잔액순", "개월순"] as const).map((s) => ({ value: s, label: s }))} />
            </div>
          </div>
        )}
      </div>

      {/* 목록 */}
      {p.state === "loading" && <div role="status" className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white p-10 text-sm font-bold text-slate-400"><Loader2 size={16} className="animate-spin" aria-hidden />방문 이력을 불러오는 중입니다.</div>}
      {p.state === "error" && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
          <AlertCircle size={16} className="shrink-0" aria-hidden /><span className="min-w-0 flex-1">방문 이력을 불러오지 못했습니다.{p.error ? ` (${p.error})` : ""}</span>
          {p.onRetry && <button type="button" onClick={p.onRetry} className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-white px-3 text-[12px] font-black text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100"><RotateCcw size={14} aria-hidden />다시 불러오기</button>}
        </div>
      )}
      {p.state === "ready" && (
        <>
          <div className="px-1 text-[12px] font-bold text-slate-500">업체 <span className="tabular-nums text-slate-800">{p.vendors.length}</span>곳{typeof p.totalCount === "number" && p.totalCount !== p.vendors.length ? <span className="text-slate-400"> / 전체 {p.totalCount}곳</span> : null}</div>
          {!p.vendors.length ? (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">조건에 맞는 업체가 없습니다. 필터를 바꿔 보세요.</div>
          ) : (
            <ul className="space-y-2">
              {p.vendors.map((v) => {
                const open = p.openKey === v.key;
                return (
                  <li key={v.key} className={`overflow-hidden rounded-xl border bg-white shadow-sm ${open ? "border-blue-300" : "border-slate-200"}`}>
                    <button type="button" onClick={() => p.onToggle(v.key)} aria-expanded={open} className="flex min-h-14 w-full items-center gap-3 px-3.5 py-3 text-left transition hover:bg-blue-50/40 sm:px-4">
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <b className="min-w-0 truncate text-[14px] font-black text-slate-900">{v.name}</b>
                          <MisuVisitStatusChip status={v.status} />
                          {v.csChecked && <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-black text-blue-700">CS체크</span>}
                          {v.linkedByName && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500" title="거래처코드 없이 업체 이름으로 묶었습니다">이름으로 이어짐</span>}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] font-bold text-slate-500">
                          {v.team && <span>{v.team}팀</span>}
                          {v.region && <span>{v.region}</span>}
                          {v.months && <span className={(v.monthsNum || 0) >= 3 ? "text-rose-600" : ""}>{v.months}</span>}
                          {v.balance && <span className="tabular-nums text-slate-800">{v.balance}</span>}
                          <span className="text-slate-400">{v.lastVisit ? `마지막 ${v.lastVisit.date} · ${v.lastVisit.round} · ${v.lastVisit.author}` : "방문 기록 없음"}{v.visitCount > 1 ? ` (총 ${v.visitCount}회)` : ""}</span>
                        </span>
                      </span>
                      <ChevronDown size={18} aria-hidden className={`shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
                    </button>
                    {open && <div className="border-t border-slate-100 px-3.5 py-3 sm:px-4"><VendorDetail vendorKey={v.key} detail={p.detail} p={p} /></div>}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
