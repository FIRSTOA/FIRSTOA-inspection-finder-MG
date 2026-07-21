import { useMemo } from "react";
import {
  CalendarDays,
  ChartNoAxesCombined,
  ClipboardList,
  FilePenLine,
  GraduationCap,
  MapPinned,
  Megaphone,
  MessageSquareText,
  PhoneCall,
  Plus,
  Sparkles,
  Target,
  type LucideIcon,
} from "lucide-react";

type Screen =
  | "field"
  | "calendar"
  | "walkingMap"
  | "asReception"
  | "happycall"
  | "promoSend"
  | "daily"
  | "weekly"
  | "growth"
  | "itHistory"
  | "counterSms";

type MenuItem = {
  key: Screen;
  title: string;
  desc: string;
  icon: LucideIcon;
  tone: string;
  pending?: boolean;
};

const primaryLinks: MenuItem[] = [
  { key: "calendar", title: "CS 캘린더", desc: "팀별 AS·물류·휴가 일정", icon: CalendarDays, tone: "bg-blue-600 text-white" },
  { key: "walkingMap", title: "워킨맵", desc: "점검·재계약 거래처 관리", icon: MapPinned, tone: "bg-emerald-600 text-white" },
  { key: "asReception", title: "일정리스트", desc: "금일·익일·예정 일정 확인", icon: ClipboardList, tone: "bg-violet-600 text-white" },
  { key: "happycall", title: "해피콜", desc: "방문 고객 후속 확인", icon: PhoneCall, tone: "bg-rose-600 text-white" },
];

const workGroups: Array<{ title: string; subtitle: string; items: MenuItem[] }> = [
  {
    title: "현장 운영",
    subtitle: "접수부터 방문 완료까지",
    items: [
      { key: "field", title: "FIELD", desc: "점검·AS·물류 양식 작성과 카톡방 전송", icon: FilePenLine, tone: "bg-blue-600 text-white" },
      { key: "calendar", title: "CS 캘린더", desc: "팀과 업무 종류별 일정 추가·수정·완료", icon: CalendarDays, tone: "bg-sky-600 text-white" },
      { key: "walkingMap", title: "워킨맵", desc: "분기·매월점검과 재계약 진행 관리", icon: MapPinned, tone: "bg-emerald-600 text-white" },
      { key: "asReception", title: "일정리스트", desc: "금일·익일·예정 및 물류 일정 확인", icon: ClipboardList, tone: "bg-violet-600 text-white" },
    ],
  },
  {
    title: "고객 후속관리",
    subtitle: "방문 이후 고객 접점 관리",
    items: [
      { key: "happycall", title: "해피콜", desc: "점검·AS 고객 문자 발송과 예약 관리", icon: PhoneCall, tone: "bg-rose-600 text-white" },
      { key: "promoSend", title: "홍보물 발송·인쇄", desc: "홍보물 미리보기와 문자·메일 발송", icon: Megaphone, tone: "bg-amber-500 text-white" },
      { key: "counterSms", title: "카운터 문자전송", desc: "복합기 사용량 요청 자동문자", icon: MessageSquareText, tone: "bg-slate-300 text-slate-600", pending: true },
      { key: "itHistory", title: "IT 학습·처리이력", desc: "처리이력 검색과 기술 학습", icon: GraduationCap, tone: "bg-slate-300 text-slate-600", pending: true },
    ],
  },
  {
    title: "기록·성과관리",
    subtitle: "일일 기록부터 분기 회고까지",
    items: [
      { key: "daily", title: "일일방문일지", desc: "기간별 방문·기기·업무시간 집계", icon: ChartNoAxesCombined, tone: "bg-cyan-600 text-white" },
      { key: "weekly", title: "주간현황판", desc: "목표·병목·실적·성장 기록 관리", icon: Target, tone: "bg-indigo-600 text-white" },
      { key: "growth", title: "성장기록", desc: "분기 계획·결과·골든미팅카드 정리", icon: Sparkles, tone: "bg-fuchsia-600 text-white" },
    ],
  },
];

function MenuRow({ item, onOpen }: { item: MenuItem; onOpen: (screen: Screen) => void }) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => onOpen(item.key)}
      className="group flex min-h-[76px] w-full items-center gap-3 border-t border-slate-100 px-4 py-3 text-left transition first:border-t-0 hover:bg-slate-50 active:bg-slate-100 sm:min-h-[82px] sm:px-5"
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-[11px] font-black ${item.tone}`}>
        <Icon size={19} strokeWidth={2.2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-black text-slate-950 sm:text-base">{item.title}</span>
          {item.pending && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-black text-slate-500">준비 중</span>}
        </span>
        <span className="mt-1 block text-xs font-semibold leading-5 text-slate-500">{item.desc}</span>
      </span>
      <span className="text-lg font-bold text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-blue-600">›</span>
    </button>
  );
}

export default function Home({ onGoField, onNavigate }: { onGoField: () => void; onNavigate?: (screen: Screen) => void }) {
  const today = useMemo(() => new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(new Date()), []);
  const quarter = useMemo(() => Math.floor(new Date().getMonth() / 3) + 1, []);
  const go = (screen: Screen) => screen === "field" ? onGoField() : onNavigate?.(screen);

  return (
    <div className="space-y-4 pb-10 sm:space-y-5">
      <section className="overflow-hidden rounded-lg bg-slate-950 text-white shadow-sm">
        <div className="flex flex-col gap-5 p-5 sm:p-7 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-blue-300">
              <span>{today}</span>
              <span className="h-3 w-px bg-white/20" />
              <span>{quarter}분기</span>
            </div>
            <h2 className="mt-2 text-2xl font-black text-white sm:text-3xl">오늘의 CS 업무</h2>
            <p className="mt-2 text-sm font-semibold text-slate-400">일정 확인부터 현장 처리, 고객 후속관리까지 한 곳에서 진행합니다.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <button type="button" onClick={() => go("field")} className="flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-blue-600 px-4 py-3 text-sm font-black text-white transition hover:bg-blue-500"><Plus size={17} />FIELD 작성</button>
            <button type="button" onClick={() => go("calendar")} className="min-h-11 rounded-md border border-white/20 bg-white/10 px-4 py-3 text-sm font-black text-white transition hover:bg-white/15">일정 확인</button>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between px-1">
          <div>
            <h3 className="text-base font-black text-slate-950 sm:text-lg">바로가기</h3>
            <p className="mt-0.5 text-xs font-semibold text-slate-500">현장에서 자주 쓰는 메뉴</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          {primaryLinks.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.key} type="button" onClick={() => go(item.key)} className="flex min-h-[104px] flex-col justify-between rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-200 hover:shadow-md active:bg-slate-50 sm:min-h-[116px]">
                <span className={`flex h-9 w-9 items-center justify-center rounded-md ${item.tone}`}><Icon size={18} strokeWidth={2.2} /></span>
                <span>
                  <span className="block text-sm font-black text-slate-950 sm:text-base">{item.title}</span>
                  <span className="mt-1 block text-[11px] font-semibold leading-4 text-slate-500 sm:text-xs">{item.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-3 px-1">
          <h3 className="text-base font-black text-slate-950 sm:text-lg">업무 메뉴</h3>
          <p className="mt-0.5 text-xs font-semibold text-slate-500">현재 CS SYSTEM에서 처리할 수 있는 전체 업무입니다.</p>
        </div>
        <div className="grid gap-3 xl:grid-cols-3">
          {workGroups.map((group) => (
            <div key={group.title} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
                <div className="text-sm font-black text-slate-950">{group.title}</div>
                <div className="mt-0.5 text-[11px] font-semibold text-slate-500">{group.subtitle}</div>
              </div>
              <div>{group.items.map((item) => <MenuRow key={item.key} item={item} onOpen={go} />)}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
