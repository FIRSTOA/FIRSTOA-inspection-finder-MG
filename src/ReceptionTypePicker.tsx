// 서비스접수 종류 선택기(표시 전용). 윗줄 "현장" 3종 + 아랫줄 "지원" 3종, 버튼마다 아이콘·이름·열린 건수 배지.
// props: value(선택값) · onChange(종류) · counts(종류별 열린 건수) · deptEnabled(false 면 "지원" 줄 숨김).
// 종류 메타(이름·아이콘·색)는 ReceptionBoard·HomeReceptionCard 도 함께 쓰도록 여기서 내보낸다.
import type { ComponentType } from "react";
import { Briefcase, Handshake, Laptop, MonitorSmartphone, Printer, Settings2 } from "lucide-react";

export type ReceptionType = "복합기 AS" | "원격이관" | "IT" | "경영지원" | "운영지원" | "영업팀";

export type ReceptionTypeMeta = {
  type: ReceptionType;
  label: string;
  group: "현장" | "지원";
  icon: ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>;
  /** 배지·작은 칩 (연한 바탕) — 기존 TYPE_TONE 과 같은 형식 */
  badge: string;
  /** 선택된 버튼 */
  active: string;
  /** 선택 안 된 버튼의 호버 */
  hover: string;
  /** 열 머리의 가는 색 띠 */
  bar: string;
  /** 어두운 홈 카드용 점 */
  dot: string;
};

// 색 배정: 기존 복합기 blue · 원격 violet · IT cyan 유지, 새 3종은 겹치지 않는 fuchsia · emerald · orange.
// 상태색(주의 amber·실패 red)과 헷갈리지 않게 amber/red 계열은 종류색에서 뺐다.
export const RECEPTION_TYPES: ReceptionTypeMeta[] = [
  { type: "복합기 AS", label: "복합기 AS", group: "현장", icon: Printer, badge: "bg-blue-50 text-blue-700", active: "border-blue-600 bg-blue-600 text-white", hover: "hover:border-blue-300 hover:text-blue-700", bar: "bg-blue-500", dot: "bg-blue-400" },
  { type: "원격이관", label: "원격", group: "현장", icon: MonitorSmartphone, badge: "bg-violet-50 text-violet-700", active: "border-violet-600 bg-violet-600 text-white", hover: "hover:border-violet-300 hover:text-violet-700", bar: "bg-violet-500", dot: "bg-violet-400" },
  { type: "IT", label: "IT", group: "현장", icon: Laptop, badge: "bg-cyan-50 text-cyan-700", active: "border-cyan-600 bg-cyan-600 text-white", hover: "hover:border-cyan-300 hover:text-cyan-700", bar: "bg-cyan-500", dot: "bg-cyan-400" },
  { type: "경영지원", label: "경영지원", group: "지원", icon: Briefcase, badge: "bg-fuchsia-50 text-fuchsia-700", active: "border-fuchsia-600 bg-fuchsia-600 text-white", hover: "hover:border-fuchsia-300 hover:text-fuchsia-700", bar: "bg-fuchsia-500", dot: "bg-fuchsia-400" },
  { type: "운영지원", label: "운영지원", group: "지원", icon: Settings2, badge: "bg-emerald-50 text-emerald-700", active: "border-emerald-600 bg-emerald-600 text-white", hover: "hover:border-emerald-300 hover:text-emerald-700", bar: "bg-emerald-500", dot: "bg-emerald-400" },
  { type: "영업팀", label: "영업팀", group: "지원", icon: Handshake, badge: "bg-orange-50 text-orange-700", active: "border-orange-600 bg-orange-600 text-white", hover: "hover:border-orange-300 hover:text-orange-700", bar: "bg-orange-500", dot: "bg-orange-400" },
];

export const RECEPTION_TYPE_META = Object.fromEntries(RECEPTION_TYPES.map((m) => [m.type, m])) as Record<ReceptionType, ReceptionTypeMeta>;

type Props = {
  value: ReceptionType;
  onChange: (type: ReceptionType) => void;
  counts: Record<ReceptionType, number>;
  deptEnabled: boolean;
};

export default function ReceptionTypePicker({ value, onChange, counts, deptEnabled }: Props) {
  const groups: Array<"현장" | "지원"> = deptEnabled ? ["현장", "지원"] : ["현장"];
  return (
    <div className="space-y-2" role="group" aria-label="접수 종류">
      {groups.map((g) => (
        <div key={g} className="flex">
          <div className="grid flex-1 grid-cols-3 gap-1.5 sm:gap-2">
            {RECEPTION_TYPES.filter((m) => m.group === g).map((m) => {
              const Icon = m.icon;
              const on = value === m.type;
              const n = counts[m.type] ?? 0;
              return (
                <button key={m.type} type="button" aria-pressed={on} onClick={() => onChange(m.type)}
                  className={`relative flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl border px-1.5 py-2 text-[12px] font-black transition sm:flex-row sm:gap-2 sm:px-3 sm:text-[13px] ${on ? `${m.active} shadow-sm` : `border-slate-200 bg-white text-slate-500 ${m.hover}`}`}>
                  <Icon size={16} aria-hidden />
                  <span className="whitespace-nowrap">{m.label}</span>
                  {n > 0 && <span className={`absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] tabular-nums sm:static ${on ? "bg-white/25 text-white" : m.badge}`}>{n}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
