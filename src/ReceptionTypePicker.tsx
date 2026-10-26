// 서비스접수 종류 선택기(표시 전용). 한 줄 탭 막대: "현장" 3종 | "지원" 3종, 칸마다 아이콘·이름·열린 건수(숫자만).
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
  { type: "복합기 AS", label: "CS 접수", group: "현장", icon: Printer, badge: "bg-blue-50 text-blue-700", active: "border-blue-600 bg-blue-600 text-white", hover: "hover:border-blue-300 hover:text-blue-700", bar: "bg-blue-500", dot: "bg-blue-400" },
  { type: "원격이관", label: "원격", group: "현장", icon: MonitorSmartphone, badge: "bg-violet-50 text-violet-700", active: "border-violet-600 bg-violet-600 text-white", hover: "hover:border-violet-300 hover:text-violet-700", bar: "bg-violet-500", dot: "bg-violet-400" },
  { type: "IT", label: "IT", group: "현장", icon: Laptop, badge: "bg-cyan-50 text-cyan-700", active: "border-cyan-600 bg-cyan-600 text-white", hover: "hover:border-cyan-300 hover:text-cyan-700", bar: "bg-cyan-500", dot: "bg-cyan-400" },
  { type: "경영지원", label: "경영지원", group: "지원", icon: Briefcase, badge: "bg-fuchsia-50 text-fuchsia-700", active: "border-fuchsia-600 bg-fuchsia-600 text-white", hover: "hover:border-fuchsia-300 hover:text-fuchsia-700", bar: "bg-fuchsia-500", dot: "bg-fuchsia-400" },
  { type: "운영지원", label: "운영지원", group: "지원", icon: Settings2, badge: "bg-emerald-50 text-emerald-700", active: "border-emerald-600 bg-emerald-600 text-white", hover: "hover:border-emerald-300 hover:text-emerald-700", bar: "bg-emerald-500", dot: "bg-emerald-400" },
  { type: "영업팀", label: "전략영업", group: "지원", icon: Handshake, badge: "bg-orange-50 text-orange-700", active: "border-orange-600 bg-orange-600 text-white", hover: "hover:border-orange-300 hover:text-orange-700", bar: "bg-orange-500", dot: "bg-orange-400" },
];

export const RECEPTION_TYPE_META = Object.fromEntries(RECEPTION_TYPES.map((m) => [m.type, m])) as Record<ReceptionType, ReceptionTypeMeta>;

// 종류 값 → 화면 글자(복합기 AS = "CS 접수")는 receptionTypeLabel.ts(react-refresh 규칙 때문에 따로)

type Props = {
  value: ReceptionType;
  onChange: (type: ReceptionType) => void;
  counts: Record<ReceptionType, number>;
  deptEnabled: boolean;
};

// 한 줄 탭 막대(높이 40px): 현장 3칸 | 얇은 세로 구분 | 지원 3칸. 폰(≤640)은 줄바꿈 없이 가로 스크롤, sm 이상은 칸이 폭을 나눠 가진다.
export default function ReceptionTypePicker({ value, onChange, counts, deptEnabled }: Props) {
  const shown = RECEPTION_TYPES.filter((m) => deptEnabled || m.group === "현장");
  return (
    <div className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex h-10 min-w-max items-stretch gap-1 sm:min-w-0" role="group" aria-label="접수 종류">
        {shown.map((m, i) => {
          const Icon = m.icon;
          const on = value === m.type;
          const n = counts[m.type] ?? 0;
          const divider = m.group === "지원" && shown[i - 1]?.group === "현장";
          return (
            <div key={m.type} className="contents">
              {divider && <span aria-hidden className="mx-1 my-2 w-px shrink-0 bg-slate-200" />}
              <button type="button" aria-pressed={on} onClick={() => onChange(m.type)}
                className={`flex h-10 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-[13px] font-bold transition sm:min-w-0 sm:flex-1 sm:shrink ${on ? m.active : `border-slate-200 bg-white text-slate-500 ${m.hover}`}`}>
                <Icon size={15} aria-hidden />
                <span className="truncate">{m.label}</span>
                {n > 0 && <span className={`text-[11px] font-semibold tabular-nums ${on ? "text-white/75" : "text-slate-400"}`}>{n}</span>}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
