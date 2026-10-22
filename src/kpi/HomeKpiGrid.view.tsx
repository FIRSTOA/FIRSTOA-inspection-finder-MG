/**
 * 홈 KPI 그리드 + 편집 모드 — 표시 전용. 설계안 docs/tasks/home-kpi-dashboard.md 4-2~4-5절.
 * 배치(layout)는 props 로 받고, 바뀔 때마다 onLayoutChange 로 통째로 돌려준다. 저장(localStorage·DB)은 컨테이너 몫.
 *
 * 칸: 폰 2열 · 태블릿(md) 6열 · PC(lg) 12열.  1x1 = 폰 반 줄/PC 3칸, 2x1 = 폰 한 줄/PC 6칸, 2x2 = 6칸 × 두 줄, 4x1 = 한 줄 전체.
 *   폰은 높이(2x2)를 무시하고 순서대로 쌓는다(빈 칸 메우기도 안 함 — [위]/[아래] 단추 순서와 화면 순서가 같아야 한다).
 *   md 이상은 grid-flow-row-dense 로 빈 칸을 메운다.
 * 편집: [편집] → 위젯마다 손잡이(PC 마우스·펜, Pointer Events — AgentTeamCard 와 같은 방식, 라이브러리 없음)·크기 순환·위/아래·숨기기.
 *   폰(터치)은 끌기 대신 [위]/[아래] 단추(터치 끌기는 스크롤과 부딪힌다). 손잡이는 키보드 화살표로도 옮긴다. 끄는 중 Esc = 취소.
 *   [위젯 추가] = 숨긴 위젯·배치에 없는 위젯 다시 켜기(끝에 붙음). [기본 배치로] = 확인 뒤 defaultLayout 으로.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, Eye, EyeOff, GripVertical, LayoutGrid, Maximize2, Pencil, Plus, RotateCcw } from "lucide-react";
import { askConfirm } from "../confirmModal";
import { notify } from "../toast";
import type { KpiSize, KpiTheme } from "./KpiWidgets.view";

// ── 타입(props) ─────────────────────────────────────────────────────────────
/** 배치 한 칸. 순서 = 배열 순서(x·y 좌표 없음). 크기는 위젯이 허용하는 것만 유효 — 아니면 그 위젯의 첫 크기로 그린다. */
export type KpiLayoutItem = { id: string; size: KpiSize; hidden?: boolean };

/** 그리드에 놓을 수 있는 위젯 하나. render 는 크기·편집 여부를 받아 <KpiWidget .../> 를 돌려준다. */
export type KpiGridWidget = {
  id: string;
  title: string;                 // 편집 막대·[위젯 추가] 목록에 쓰는 이름
  sizes: KpiSize[];              // 허용 크기(순서 = 크기 단추 순환 순서). 첫 값이 기본
  description?: string;          // [위젯 추가] 목록 보조 글
  render: (ctx: { size: KpiSize; editing: boolean }) => ReactNode;
};

export type HomeKpiGridProps = {
  layout: KpiLayoutItem[];
  widgets: KpiGridWidget[];
  onLayoutChange: (next: KpiLayoutItem[]) => void;
  defaultLayout: KpiLayoutItem[];
  theme?: KpiTheme;
  toolbarStart?: ReactNode;      // 머리 왼쪽(기간 칩 [이번 주|이번 달|분기] 등)
  loading?: boolean;             // 배치를 아직 못 읽었을 때 뼈대 4칸
  notice?: string;               // 배치 저장 실패 같은 안내 한 줄(노랑)
  editable?: boolean;            // false 면 [편집] 단추 없음
  editing?: boolean;             // 주면 제어형, 안 주면 안에서 관리
  onEditingChange?: (editing: boolean) => void;
};

// ── 칸 크기(Tailwind 는 글자 그대로 있어야 만들어 준다) ───────────────────────
const SPAN: Record<KpiSize, string> = {
  "1x1": "col-span-1 md:col-span-2 lg:col-span-3",
  "2x1": "col-span-2 md:col-span-3 lg:col-span-6",
  "2x2": "col-span-2 md:col-span-3 md:row-span-2 lg:col-span-6 lg:row-span-2",
  "4x1": "col-span-2 md:col-span-6 lg:col-span-12",
};
const SIZE_LABEL: Record<KpiSize, string> = { "1x1": "작게", "2x1": "넓게", "2x2": "크게", "4x1": "한 줄" };

const TOKENS: Record<KpiTheme, { btn: string; btnOn: string; bar: string; text: string; sub: string; panel: string; skeleton: string; outline: string }> = {
  deck: {
    btn: "bg-white/[0.07] text-slate-200 hover:bg-white/[0.12] hover:text-white",
    btnOn: "bg-white text-slate-950 hover:bg-slate-100",
    bar: "border-white/10 bg-slate-900/90",
    text: "text-white", sub: "text-slate-400",
    panel: "border-white/[0.08] bg-white/[0.04]",
    skeleton: "bg-white/[0.05]",
    outline: "outline-dashed outline-1 outline-offset-2 outline-white/25",
  },
  light: {
    btn: "bg-slate-100 text-slate-700 hover:bg-slate-200",
    btnOn: "bg-slate-900 text-white hover:bg-slate-800",
    bar: "border-slate-200 bg-white",
    text: "text-slate-900", sub: "text-slate-500",
    panel: "border-slate-200 bg-slate-50",
    skeleton: "bg-slate-100",
    outline: "outline-dashed outline-1 outline-offset-2 outline-slate-300",
  },
};
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400";

// ── 순서 바꾸기(순수, 이 파일 안에서만) ───────────────────────────────────────
function moveTo(layout: KpiLayoutItem[], id: string, targetId: string, after: boolean): KpiLayoutItem[] {
  if (id === targetId) return layout;
  const item = layout.find((x) => x.id === id);
  if (!item) return layout;
  const rest = layout.filter((x) => x.id !== id);
  const idx = rest.findIndex((x) => x.id === targetId);
  if (idx < 0) return layout;
  rest.splice(after ? idx + 1 : idx, 0, item);
  return rest;
}

type DragState = { id: string; pointerId: number; startX: number; startY: number; el: HTMLElement };

export function HomeKpiGrid(props: HomeKpiGridProps) {
  const { layout, widgets, onLayoutChange, defaultLayout, theme = "deck", toolbarStart, loading, notice, editable = true } = props;
  const k = TOKENS[theme];
  const [innerEditing, setInnerEditing] = useState(false);
  const editing = props.editing ?? innerEditing;
  const setEditing = (v: boolean) => { setInnerEditing(v); props.onEditingChange?.(v); };
  const [addOpen, setAddOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const drag = useRef<DragState | null>(null);
  const dropRef = useRef<{ id: string; after: boolean } | null>(null);

  const byId = useMemo(() => new Map(widgets.map((w) => [w.id, w])), [widgets]);
  // 화면에 그릴 칸: 배치 순서대로, 아는 위젯·숨기지 않은 것만. 크기는 허용 크기로 맞춘다
  const visible = useMemo(() => layout.flatMap((it) => {
    const w = byId.get(it.id);
    if (!w || it.hidden) return [];
    const size = w.sizes.includes(it.size) ? it.size : (w.sizes[0] ?? "1x1");
    return [{ item: it, widget: w, size }];
  }), [layout, byId]);
  // 다시 켤 수 있는 것: 숨긴 것 + 배치에 아예 없는 새 위젯
  const addable = useMemo(() => {
    const inLayout = new Set(layout.map((x) => x.id));
    return widgets.filter((w) => !inLayout.has(w.id) || layout.find((x) => x.id === w.id)?.hidden);
  }, [layout, widgets]);

  const change = (next: KpiLayoutItem[]) => { if (next !== layout) onLayoutChange(next); };
  const moveBy = (id: string, dir: -1 | 1) => {
    const pos = visible.findIndex((v) => v.item.id === id);
    const neighbor = visible[pos + dir];
    if (pos < 0 || !neighbor) return;
    change(moveTo(layout, id, neighbor.item.id, dir > 0));
  };
  const cycleSize = (id: string) => {
    const w = byId.get(id);
    const cur = visible.find((v) => v.item.id === id)?.size;
    if (!w || !cur || w.sizes.length < 2) return;
    const next = w.sizes[(w.sizes.indexOf(cur) + 1) % w.sizes.length];
    change(layout.map((x) => (x.id === id ? { ...x, size: next } : x)));
  };
  const hide = (id: string) => {
    change(layout.map((x) => (x.id === id ? { ...x, hidden: true } : x)));
    notify(`'${byId.get(id)?.title ?? id}'을(를) 숨겼습니다. [위젯 추가]에서 다시 켤 수 있습니다.`);
  };
  const show = (id: string) => {
    const w = byId.get(id);
    if (!w) return;
    const prev = layout.find((x) => x.id === id);
    const item: KpiLayoutItem = { id, size: prev && w.sizes.includes(prev.size) ? prev.size : (w.sizes[0] ?? "1x1"), hidden: false };
    // 다시 켠 위젯은 맨 끝에 붙인다(설계안 4-5 "새 위젯은 끝에")
    change([...layout.filter((x) => x.id !== id), item]);
  };
  const reset = async () => {
    if (!(await askConfirm("기본 배치로 되돌릴까요? 순서·크기·숨김이 처음 모양으로 바뀝니다.", { okLabel: "되돌리기" }))) return;
    change(defaultLayout);
    notify("기본 배치로 되돌렸습니다.", "success");
  };
  const finish = () => { clearDrag(); setEditing(false); setAddOpen(false); };

  // ── PC 끌기(Pointer Events). 터치는 받지 않는다 — 폰은 [위]/[아래] 단추 ──
  // 끌던 것 버리기 — ref·setter 만 써서 늘 같은 함수
  const clearDrag = useCallback(() => {
    const d = drag.current;
    if (d) d.el.style.transform = "";
    drag.current = null;
    dropRef.current = null;
    setDragId(null);
    setDrop(null);
  }, []);
  useEffect(() => {
    if (!dragId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") clearDrag(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dragId, clearDrag]);

  const onGripDown = (e: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (e.pointerType === "touch" || e.button !== 0) return;
    const el = e.currentTarget.closest<HTMLElement>("[data-kpi-id]");
    if (!el) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, el };
    setDragId(id);
  };
  const onGripMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    d.el.style.transform = `translate(${e.clientX - d.startX}px, ${e.clientY - d.startY}px)`;
    // 끌리는 칸 자신도 포인터 아래에 있으므로 elementsFromPoint 로 "다른" 칸을 찾는다
    const target = document.elementsFromPoint(e.clientX, e.clientY)
      .map((n) => n.closest("[data-kpi-id]") as HTMLElement | null)
      .find((n): n is HTMLElement => !!n && n.dataset.kpiId !== d.id);
    if (!target) return;
    const r = target.getBoundingClientRect();
    const next = { id: target.dataset.kpiId!, after: e.clientX > r.left + r.width / 2 };
    if (dropRef.current?.id !== next.id || dropRef.current.after !== next.after) { dropRef.current = next; setDrop(next); }
  };
  const onGripUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const target = dropRef.current;
    clearDrag();
    if (target) change(moveTo(layout, d.id, target.id, target.after));
  };
  const onGripKey = (e: ReactKeyboardEvent<HTMLButtonElement>, id: string) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); moveBy(id, -1); }
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); moveBy(id, 1); }
  };

  const btn = `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-3 text-[12px] font-black transition disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`;
  const iconBtn = `inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg text-[11px] font-black transition disabled:cursor-not-allowed disabled:opacity-30 ${k.btn} ${focusRing}`;

  return (
    <section aria-label="CS KPI 현황판" className="min-w-0">
      {/* 머리: 왼쪽 = 컨테이너 몫(기간 칩), 오른쪽 = 편집 단추들 */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">{toolbarStart}</div>
        {editable && (
          editing ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => setAddOpen((o) => !o)} aria-expanded={addOpen} className={`${btn} ${addOpen ? k.btnOn : k.btn}`}>
                <Plus size={15} aria-hidden />위젯 추가{addable.length ? <span className="rounded-full bg-blue-500 px-1.5 font-mono text-[10px] text-white">{addable.length}</span> : null}
              </button>
              <button type="button" onClick={() => void reset()} className={`${btn} ${k.btn}`}><RotateCcw size={15} aria-hidden />기본 배치로</button>
              <button type="button" onClick={finish} className={`${btn} bg-blue-600 text-white hover:bg-blue-500`}><Check size={15} aria-hidden />완료</button>
            </div>
          ) : (
            <button type="button" onClick={() => setEditing(true)} className={`${btn} ${k.btn}`}><Pencil size={14} aria-hidden />편집</button>
          )
        )}
      </div>

      {notice && <p role="status" className="mb-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11.5px] font-bold text-amber-300">{notice}</p>}

      {editing && (
        <p className={`mb-3 text-[11.5px] font-bold leading-4 ${k.sub}`}>
          <span className="hidden lg:inline">손잡이(<GripVertical size={12} className="inline" aria-hidden />)를 끌어 옮기거나 </span>[위]·[아래]로 순서를, 크기 단추로 칸 크기를 바꿉니다. 바꾸는 즉시 반영됩니다.
        </p>
      )}

      {/* 위젯 추가 목록 */}
      {editing && addOpen && (
        <div className={`mb-3 rounded-2xl border p-3 ${k.panel}`}>
          <div className={`mb-2 flex items-center gap-1.5 text-[11px] font-black ${k.sub}`}><LayoutGrid size={13} aria-hidden />숨긴 위젯 · 새 위젯</div>
          {addable.length === 0 ? (
            <p className={`py-2 text-[12px] font-bold ${k.sub}`}>모든 위젯이 이미 켜져 있습니다.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {addable.map((w) => (
                <li key={w.id}>
                  <button type="button" onClick={() => show(w.id)} className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition ${k.btn} ${focusRing}`}>
                    <Eye size={15} aria-hidden className="shrink-0 text-emerald-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-black">{w.title}</span>
                      {w.description && <span className={`block truncate text-[10.5px] font-bold ${k.sub}`}>{w.description}</span>}
                    </span>
                    <span className="shrink-0 text-[11px] font-black text-emerald-400">켜기</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6 lg:grid-cols-12" aria-busy="true" aria-label="KPI 배치를 불러오는 중">
          {(["1x1", "1x1", "2x1", "2x1"] as KpiSize[]).map((s, i) => <div key={i} className={`h-36 animate-pulse rounded-2xl ${k.skeleton} ${SPAN[s]}`} />)}
        </div>
      ) : visible.length === 0 ? (
        <div className={`rounded-2xl border border-dashed px-4 py-8 text-center ${k.panel}`}>
          <p className={`text-[13px] font-black ${k.text}`}>보이는 위젯이 없습니다.</p>
          <p className={`mt-1 text-[12px] font-bold ${k.sub}`}>[편집] → [위젯 추가]에서 보고 싶은 위젯을 켜 주세요.</p>
          {editable && (
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              <button type="button" onClick={() => { setEditing(true); setAddOpen(true); }} className={`${btn} ${k.btn}`}><Plus size={15} aria-hidden />위젯 추가</button>
              <button type="button" onClick={() => void reset()} className={`${btn} ${k.btn}`}><RotateCcw size={15} aria-hidden />기본 배치로</button>
            </div>
          )}
        </div>
      ) : (
        <ol className="grid list-none grid-cols-2 gap-3 md:auto-rows-[minmax(10rem,auto)] md:grid-flow-row-dense md:grid-cols-6 lg:grid-cols-12">
          {visible.map(({ item, widget, size }, idx) => {
            const dragging = dragId === item.id;
            const marker = drop && drop.id === item.id ? drop : null;
            return (
              <li
                key={item.id}
                data-kpi-id={item.id}
                className={`relative flex min-w-0 flex-col ${SPAN[size]} ${editing ? `rounded-2xl ${k.outline}` : ""} ${dragging ? "z-20 cursor-grabbing opacity-90 shadow-2xl" : "transition-transform"}`}
              >
                {/* 놓일 자리 표시(앞/뒤) */}
                {marker && <span aria-hidden className={`absolute inset-y-2 z-10 w-1 rounded-full bg-blue-400 shadow-[0_0_12px_rgba(96,165,250,0.9)] ${marker.after ? "-right-2" : "-left-2"}`} />}

                {editing && (
                  <div className={`mb-1.5 flex items-center gap-1 rounded-xl border p-1 ${k.bar}`} role="group" aria-label={`${widget.title} 배치`}>
                    <button
                      type="button"
                      onPointerDown={(e) => onGripDown(e, item.id)}
                      onPointerMove={onGripMove}
                      onPointerUp={onGripUp}
                      onPointerCancel={clearDrag}
                      onKeyDown={(e) => onGripKey(e, item.id)}
                      aria-label={`${widget.title} 끌어서 옮기기 — 화살표 키로도 옮길 수 있습니다`}
                      title="끌어서 옮기기"
                      className={`hidden min-h-11 w-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg lg:inline-flex ${k.btn} ${focusRing}`}
                    >
                      <GripVertical size={16} aria-hidden />
                    </button>
                    <button type="button" onClick={() => moveBy(item.id, -1)} disabled={idx === 0} aria-label={`${widget.title} 앞으로`} className={iconBtn}><ArrowUp size={15} aria-hidden /><span className="hidden sm:inline">위</span></button>
                    <button type="button" onClick={() => moveBy(item.id, 1)} disabled={idx === visible.length - 1} aria-label={`${widget.title} 뒤로`} className={iconBtn}><ArrowDown size={15} aria-hidden /><span className="hidden sm:inline">아래</span></button>
                    <button
                      type="button"
                      onClick={() => cycleSize(item.id)}
                      disabled={widget.sizes.length < 2}
                      aria-label={`${widget.title} 크기 바꾸기, 지금 ${SIZE_LABEL[size]}(${size})`}
                      title={widget.sizes.length < 2 ? "이 위젯은 크기가 하나뿐입니다" : `크기: ${widget.sizes.join(" → ")}`}
                      className={iconBtn}
                    >
                      <Maximize2 size={14} aria-hidden /><span className="font-mono">{size}</span>
                    </button>
                    <button type="button" onClick={() => hide(item.id)} aria-label={`${widget.title} 숨기기`} title="숨기기" className={iconBtn}><EyeOff size={15} aria-hidden /></button>
                  </div>
                )}

                {/* 편집 중엔 위젯을 눌러도 이동하지 않게 막고 흐리게 */}
                <div className={`min-h-0 flex-1 ${editing ? "pointer-events-none select-none opacity-60" : ""}`} inert={editing}>
                  {widget.render({ size, editing })}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export default HomeKpiGrid;
