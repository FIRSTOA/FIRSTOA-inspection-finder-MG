// 접수리스트 필터(표시 전용). 두 줄 분할 막대: 1줄 종류, 2줄 상태. 칸이 붙은 얇은 막대, 선택 칸은 slate-900.
// props: typeFilter/onTypeFilter(종류) · typeCounts(키: 전체·복합기 AS·IT·원격이관·경영지원·운영지원·영업팀·주소확인)
//        statusFilter/onStatusFilter(상태) · statusCounts · deptEnabled(false 면 경영·운영·영업 칸 숨김).
export type ReceptionStatusFilter = "전체" | "접수" | "진행중" | "완료";

type Props = {
  typeFilter: string;
  onTypeFilter: (f: string) => void;
  typeCounts: Record<string, number>;
  statusFilter: ReceptionStatusFilter;
  onStatusFilter: (s: ReceptionStatusFilter) => void;
  statusCounts: Record<ReceptionStatusFilter, number>;
  deptEnabled?: boolean;
};

type Cell = { key: string; label: string; dept?: boolean; warn?: boolean };

const TYPE_CELLS: Cell[] = [
  { key: "전체", label: "전체" },
  { key: "복합기 AS", label: "복합기" },
  { key: "IT", label: "IT" },
  { key: "원격이관", label: "원격" },
  { key: "경영지원", label: "경영", dept: true },
  { key: "운영지원", label: "운영", dept: true },
  { key: "영업팀", label: "영업", dept: true },
  { key: "주소확인", label: "📍주소", warn: true },
];

const STATUS_CELLS: ReceptionStatusFilter[] = ["전체", "접수", "진행중", "완료"];

function Segment({ cells, value, onPick, counts, label, scroll }: {
  cells: Cell[]; value: string; onPick: (k: string) => void; counts: Record<string, number>; label: string; scroll?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className={`flex h-9 divide-x divide-slate-200 rounded-lg border border-slate-200 bg-white ${scroll ? "overflow-x-auto sm:h-auto sm:flex-wrap sm:gap-1.5 sm:divide-x-0 sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent" : "overflow-hidden"}`}>
      {cells.map((c) => {
        const on = value === c.key;
        const n = counts[c.key] ?? 0;
        const amber = c.warn && n > 0 && !on;
        const tone = on ? "bg-slate-900 text-white" : amber ? "bg-amber-50 text-amber-800 hover:bg-amber-100" : "text-slate-600 hover:bg-slate-50";
        return (
          <button key={c.key} type="button" aria-pressed={on} onClick={() => onPick(c.key)}
            className={`flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap px-3 text-[12px] font-bold transition ${scroll ? "h-9 sm:rounded-lg sm:border sm:border-slate-200" : "flex-1"} ${tone}`}>
            <span>{c.label}</span>
            <span className={`text-[10px] font-semibold tabular-nums ${on ? "text-white/70" : amber ? "text-amber-700" : n === 0 ? "text-slate-300" : "text-slate-400"}`}>{n}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function ReceptionListFilters({ typeFilter, onTypeFilter, typeCounts, statusFilter, onStatusFilter, statusCounts, deptEnabled = true }: Props) {
  const typeCells = TYPE_CELLS.filter((c) => deptEnabled || !c.dept);
  const statusCells: Cell[] = STATUS_CELLS.map((s) => ({ key: s, label: s }));
  return (
    <div className="space-y-1.5">
      <Segment cells={typeCells} value={typeFilter} onPick={onTypeFilter} counts={typeCounts} label="접수 종류 필터" scroll />
      <Segment cells={statusCells} value={statusFilter} onPick={(k) => onStatusFilter(k as ReceptionStatusFilter)} counts={statusCounts} label="접수 상태 필터" />
    </div>
  );
}
