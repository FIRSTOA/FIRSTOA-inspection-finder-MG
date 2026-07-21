import { useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  ChartNoAxesCombined,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  FilePenLine,
  GraduationCap,
  MapPinned,
  Megaphone,
  MessageSquareText,
  PhoneCall,
  Plus,
  Route,
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

type ManualItem = {
  id: string;
  title: string;
  summary: string;
  icon: LucideIcon;
  steps: string[];
  note: string;
};

const primaryLinks: MenuItem[] = [
  { key: "calendar", title: "일정 확인", desc: "팀별 AS·익일AS·물류·휴가", icon: CalendarDays, tone: "bg-blue-600 text-white" },
  { key: "field", title: "FIELD 작성", desc: "현장 양식 작성·사진·전송", icon: FilePenLine, tone: "bg-slate-950 text-white" },
  { key: "walkingMap", title: "워킨맵", desc: "점검 대상·재계약·진행률", icon: MapPinned, tone: "bg-emerald-600 text-white" },
  { key: "asReception", title: "일정리스트", desc: "금일·익일·예정 업무 처리", icon: ClipboardList, tone: "bg-violet-600 text-white" },
];

const workGroups: Array<{ title: string; subtitle: string; items: MenuItem[] }> = [
  {
    title: "현장 운영",
    subtitle: "일정 확인부터 현장 완료까지",
    items: [
      { key: "calendar", title: "CS 캘린더", desc: "일정 추가·이동·수정·완료·익일 처리", icon: CalendarDays, tone: "bg-blue-50 text-blue-700" },
      { key: "asReception", title: "일정리스트", desc: "금일·익일·예정 일정과 물류 업무 확인", icon: ClipboardList, tone: "bg-violet-50 text-violet-700" },
      { key: "field", title: "FIELD", desc: "점검·AS·물류 등 양식 작성과 카톡방 전송", icon: FilePenLine, tone: "bg-slate-100 text-slate-800" },
      { key: "walkingMap", title: "워킨맵", desc: "분기·매월점검, 재계약 대상과 진행률 관리", icon: MapPinned, tone: "bg-emerald-50 text-emerald-700" },
    ],
  },
  {
    title: "고객 후속관리",
    subtitle: "방문 이후 고객 접점 관리",
    items: [
      { key: "happycall", title: "해피콜", desc: "최근 점검·AS 고객 문자와 예약 발송 관리", icon: PhoneCall, tone: "bg-rose-50 text-rose-700" },
      { key: "promoSend", title: "홍보물 발송·인쇄", desc: "홍보물 선택 후 방문 업체·직접 입력 고객에게 발송", icon: Megaphone, tone: "bg-amber-50 text-amber-700" },
      { key: "counterSms", title: "카운터 문자전송", desc: "복합기 사용량 요청 자동문자", icon: MessageSquareText, tone: "bg-slate-100 text-slate-400", pending: true },
      { key: "itHistory", title: "IT 학습·처리이력", desc: "IT 처리이력 검색·퀴즈·기술 레벨", icon: GraduationCap, tone: "bg-slate-100 text-slate-400", pending: true },
    ],
  },
  {
    title: "기록·성과",
    subtitle: "방문 집계부터 분기 회고까지",
    items: [
      { key: "daily", title: "일일방문일지", desc: "일·주·월·분기·연간 방문과 업무시간 집계", icon: ChartNoAxesCombined, tone: "bg-cyan-50 text-cyan-700" },
      { key: "weekly", title: "주간현황판", desc: "목표·병목·실적·성장노트·배운 점 관리", icon: Target, tone: "bg-indigo-50 text-indigo-700" },
      { key: "growth", title: "성장기록", desc: "분기 계획·결과·미션·골든미팅카드 작성", icon: Sparkles, tone: "bg-fuchsia-50 text-fuchsia-700" },
    ],
  },
];

const flow = [
  { no: "01", title: "일정·대상 확인", desc: "캘린더, 일정리스트, 워킨맵", screen: "calendar" as Screen },
  { no: "02", title: "현장 처리", desc: "FIELD 작성, 사진 첨부, 카톡방 전송", screen: "field" as Screen },
  { no: "03", title: "고객 후속관리", desc: "해피콜, 홍보물 발송·인쇄", screen: "happycall" as Screen },
  { no: "04", title: "기록·성과 정리", desc: "일지, 주간현황, 성장기록", screen: "weekly" as Screen },
];

const manuals: ManualItem[] = [
  {
    id: "schedule",
    title: "캘린더·일정리스트",
    summary: "팀 일정 등록부터 완료·익일까지",
    icon: CalendarDays,
    steps: [
      "CS 캘린더에서 업무 종류와 담당 팀을 선택해 일정을 등록합니다.",
      "일정은 드래그로 날짜를 옮기거나 눌러 내용·시간·담당자를 수정합니다.",
      "당일 업무는 일정리스트의 금일일정에서 확인하고 완료 또는 익일 처리합니다.",
      "익일은 다음 영업일뿐 아니라 오늘 이후로 넘긴 모든 AS 일정을 의미합니다.",
    ],
    note: "팀 필터를 사용하면 필요한 일정만 볼 수 있으며 캘린더와 일정리스트의 날짜·상태는 함께 변경됩니다.",
  },
  {
    id: "field",
    title: "FIELD 작성·전송",
    summary: "원본 변환, 기기 수정, 사진, 업무방 전송",
    icon: FilePenLine,
    steps: [
      "점검·AS는 원본 붙여넣기, 사진 변환 또는 거래처 검색으로 양식을 불러옵니다.",
      "기기선택에서 순서를 바꾸고 기기위치·모델·시리얼·자산기번·내용을 확인합니다.",
      "작성 칸과 결과 미리보기는 동기화되므로 어느 쪽에서 수정해도 최종 내용을 다시 확인합니다.",
      "현장 사진을 첨부하고 점검·AS·물류 등 해당 업무방으로 전송합니다.",
    ],
    note: "사진이 없으면 전송 전에 업로드 또는 사진 불필요를 선택합니다. AS 변환 시 워킨맵 분기점검 대상과 마지막 점검일도 확인할 수 있습니다.",
  },
  {
    id: "map",
    title: "워킨맵",
    summary: "점검·재계약 대상, 색상, 방문이력 관리",
    icon: MapPinned,
    steps: [
      "담당 팀·분기·업무와 G1~G12 색상을 선택해 필요한 거래처만 봅니다.",
      "지도 마커를 누르면 거래처를 선택하고 모바일에서는 하단 요약을 눌러 전체 상세를 엽니다.",
      "분기점검은 최근 방문일과 60일 방문대기 여부, 최근 두 번의 매수·토너·여분 변화를 확인합니다.",
      "목록 편집에서 색상을 일괄 변경하고 엑셀 불러오기·내보내기로 목록을 관리합니다.",
    ],
    note: "점검 완료 색상과 매월점검 단계가 팀별 진행률에 반영됩니다. 수정한 지도 위치·조건·색상은 사용자별로 유지됩니다.",
  },
  {
    id: "customer",
    title: "해피콜·홍보물",
    summary: "방문 업체 후속 문자와 홍보 자료 활용",
    icon: PhoneCall,
    steps: [
      "해피콜에서 최근 7일의 점검·AS 방문 업체를 선택하고 키맨 연락처를 확인합니다.",
      "저장한 문구를 선택해 즉시 발송하거나 예약하고, 발송 전에는 예약을 취소할 수 있습니다.",
      "홍보물 발송·인쇄에서 자료를 미리보고 최근 방문 업체 또는 직접 입력한 담당자를 선택합니다.",
      "여러 담당자를 추가한 뒤 문자·메일 발송 또는 인쇄용 파일 열기를 사용합니다.",
    ],
    note: "연락처와 이름이 맞지 않으면 발송 전에 직접 수정합니다. 고객 발송은 대표번호 기반으로 운영하는 것이 기본입니다.",
  },
  {
    id: "record",
    title: "일지·주간현황·성장기록",
    summary: "자동 집계와 주간·분기 회고 작성",
    icon: ChartNoAxesCombined,
    steps: [
      "FIELD에서 저장된 방문 기록은 일일방문일지의 기간별 실적과 방문 상세에 반영됩니다.",
      "주간현황판에서 주간 목표, 병목현상, 결과, 성장노트와 배운 점을 수시로 작성합니다.",
      "성장기록에서 월·분기별 성장노트와 배운 점을 모아 확인합니다.",
      "분기 계획표의 결과와 미션결과를 채운 뒤 AI로 골든미팅카드를 작성하고 내용을 검토합니다.",
    ],
    note: "주간 기록과 분기 문서는 자동 저장됩니다. AI 결과의 수치·달성률은 원본 결과표와 반드시 대조합니다.",
  },
];

function MenuRow({ item, onOpen }: { item: MenuItem; onOpen: (screen: Screen) => void }) {
  const Icon = item.icon;
  return (
    <button type="button" onClick={() => onOpen(item.key)} className="group flex min-h-[70px] w-full items-center gap-3 border-t border-slate-100 px-4 py-3 text-left transition first:border-t-0 hover:bg-slate-50 active:bg-slate-100">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${item.tone}`}><Icon size={18} strokeWidth={2.2} /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2"><span className="truncate text-sm font-black text-slate-950">{item.title}</span>{item.pending && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-black text-slate-500">준비 중</span>}</span>
        <span className="mt-0.5 block text-xs font-semibold leading-5 text-slate-500">{item.desc}</span>
      </span>
      <ArrowRight size={15} className="shrink-0 text-slate-300 transition group-hover:text-blue-600" />
    </button>
  );
}

export default function Home({ onGoField, onNavigate }: { onGoField: () => void; onNavigate?: (screen: Screen) => void }) {
  const today = useMemo(() => new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(new Date()), []);
  const quarter = useMemo(() => Math.floor(new Date().getMonth() / 3) + 1, []);
  const [openManual, setOpenManual] = useState("field");
  const go = (screen: Screen) => screen === "field" ? onGoField() : onNavigate?.(screen);

  return (
    <div className="space-y-5 pb-10">
      <section className="overflow-hidden rounded-lg bg-slate-950 text-white shadow-sm">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="p-5 sm:p-7 lg:px-8">
            <div className="flex items-center gap-2 text-xs font-black text-blue-300"><span>{today}</span><span className="h-3 w-px bg-white/20" /><span>{quarter}분기 운영 중</span></div>
            <h2 className="mt-2 text-2xl font-black sm:text-3xl">오늘 업무를 바로 시작하세요</h2>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-400">일정과 점검 대상을 확인하고, FIELD 처리부터 고객 후속관리와 업무 기록까지 이어서 진행합니다.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 border-t border-white/10 p-4 lg:w-[340px] lg:border-l lg:border-t-0">
            <button type="button" onClick={() => go("calendar")} className="min-h-11 rounded-md border border-white/15 bg-white/10 px-3 py-2 text-sm font-black hover:bg-white/15">일정 확인</button>
            <button type="button" onClick={() => go("field")} className="flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-black hover:bg-blue-500"><Plus size={16} />FIELD 작성</button>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 px-1"><h3 className="text-base font-black text-slate-950 sm:text-lg">자주 쓰는 업무</h3><p className="mt-0.5 text-xs font-semibold text-slate-500">현장과 이동 중 빠르게 여는 메뉴입니다.</p></div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {primaryLinks.map((item) => {
            const Icon = item.icon;
            return <button key={item.key} type="button" onClick={() => go(item.key)} className="flex min-h-[104px] flex-col justify-between rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-200 hover:shadow-md active:bg-slate-50"><span className={`flex h-9 w-9 items-center justify-center rounded-md ${item.tone}`}><Icon size={18} strokeWidth={2.2} /></span><span><span className="block text-sm font-black text-slate-950">{item.title}</span><span className="mt-1 block text-[11px] font-semibold leading-4 text-slate-500 sm:text-xs">{item.desc}</span></span></button>;
          })}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 sm:px-5"><span className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-50 text-blue-700"><Route size={19} /></span><div><h3 className="text-sm font-black text-slate-950">CS 업무 흐름</h3><p className="text-[11px] font-semibold text-slate-500">업무가 각 메뉴에 어떻게 이어지는지 확인합니다.</p></div></div>
        <div className="grid sm:grid-cols-2 xl:grid-cols-4">
          {flow.map((item, index) => <button key={item.no} type="button" onClick={() => go(item.screen)} className="group flex items-start gap-3 border-t border-slate-100 px-4 py-4 text-left first:border-t-0 sm:[&:nth-child(2)]:border-t-0 xl:border-l xl:border-t-0 xl:first:border-l-0"><span className="text-xs font-black text-blue-600">{item.no}</span><span className="min-w-0 flex-1"><span className="block text-sm font-black text-slate-950">{item.title}</span><span className="mt-1 block text-xs font-semibold leading-5 text-slate-500">{item.desc}</span></span>{index < flow.length - 1 && <ArrowRight size={14} className="mt-1 hidden text-slate-300 xl:block" />}</button>)}
        </div>
      </section>

      <section>
        <div className="mb-3 px-1"><h3 className="text-base font-black text-slate-950 sm:text-lg">전체 업무 메뉴</h3><p className="mt-0.5 text-xs font-semibold text-slate-500">현재 CS SYSTEM에서 사용할 수 있는 기능입니다.</p></div>
        <div className="grid gap-3 xl:grid-cols-3">
          {workGroups.map((group) => <div key={group.title} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 bg-slate-50 px-4 py-3"><div className="text-sm font-black text-slate-950">{group.title}</div><div className="mt-0.5 text-[11px] font-semibold text-slate-500">{group.subtitle}</div></div><div>{group.items.map((item) => <MenuRow key={item.key} item={item} onOpen={go} />)}</div></div>)}
        </div>
      </section>

      <section id="home-manual" className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-950 px-4 py-4 text-white sm:px-5"><span className="flex h-9 w-9 items-center justify-center rounded-md bg-white/10"><BookOpen size={19} /></span><div><h3 className="text-sm font-black">CS SYSTEM 사용 매뉴얼</h3><p className="mt-0.5 text-[11px] font-semibold text-slate-400">필요한 업무를 눌러 최신 사용 방법을 확인하세요.</p></div></div>
        <div className="divide-y divide-slate-100">
          {manuals.map((manual) => {
            const Icon = manual.icon;
            const open = openManual === manual.id;
            return <div key={manual.id}>
              <button type="button" aria-expanded={open} onClick={() => setOpenManual(open ? "" : manual.id)} className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-slate-50 sm:px-5"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${open ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}><Icon size={18} /></span><span className="min-w-0 flex-1"><span className="block text-sm font-black text-slate-950">{manual.title}</span><span className="mt-0.5 block text-xs font-semibold text-slate-500">{manual.summary}</span></span><ChevronDown size={18} className={`shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} /></button>
              {open && <div className="border-t border-slate-100 bg-slate-50 px-4 py-4 sm:px-5"><ol className="space-y-3">{manual.steps.map((step, index) => <li key={step} className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-black text-blue-700 shadow-sm">{index + 1}</span><span className="pt-0.5 text-sm font-semibold leading-6 text-slate-700">{step}</span></li>)}</ol><div className="mt-4 flex gap-2 border-t border-slate-200 pt-3 text-xs font-semibold leading-5 text-slate-600"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" /><span>{manual.note}</span></div></div>}
            </div>;
          })}
        </div>
      </section>
    </div>
  );
}
