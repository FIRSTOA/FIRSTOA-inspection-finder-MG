import { useMemo, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  FilePenLine,
  GraduationCap,
  MapPinned,
  Megaphone,
  MessageSquareText,
  PhoneCall,
  Plus,
  Route,
  Send,
  Sparkles,
  Target,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import workflowImage from "./assets/cs-workflow-home.webp";

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
  { key: "calendar", title: "일정 확인", desc: "팀 일정과 오늘 업무", icon: CalendarDays, tone: "bg-blue-600 text-white" },
  { key: "field", title: "FIELD 작성", desc: "양식·사진·업무방 전송", icon: FilePenLine, tone: "bg-slate-950 text-white" },
  { key: "walkingMap", title: "워킨맵", desc: "점검·재계약 대상", icon: MapPinned, tone: "bg-emerald-600 text-white" },
  { key: "asReception", title: "일정리스트", desc: "금일·익일·예정 업무", icon: ClipboardList, tone: "bg-violet-600 text-white" },
];

const workGroups: Array<{ title: string; items: MenuItem[] }> = [
  {
    title: "현장 운영",
    items: [
      { key: "calendar", title: "CS 캘린더", desc: "팀별 일정 등록·수정·완료", icon: CalendarDays, tone: "bg-blue-50 text-blue-700" },
      { key: "asReception", title: "일정리스트", desc: "금일·익일·예정 일정 처리", icon: ClipboardList, tone: "bg-violet-50 text-violet-700" },
      { key: "field", title: "FIELD", desc: "현장 양식 작성·사진·전송", icon: FilePenLine, tone: "bg-slate-100 text-slate-800" },
      { key: "walkingMap", title: "워킨맵", desc: "점검·재계약·방문 이력", icon: MapPinned, tone: "bg-emerald-50 text-emerald-700" },
    ],
  },
  {
    title: "고객 관리",
    items: [
      { key: "happycall", title: "해피콜", desc: "방문 후 문자·예약 발송", icon: PhoneCall, tone: "bg-rose-50 text-rose-700" },
      { key: "promoSend", title: "홍보물 발송·인쇄", desc: "홍보자료 문자·메일·인쇄", icon: Megaphone, tone: "bg-amber-50 text-amber-700" },
      { key: "counterSms", title: "카운터 문자전송", desc: "복합기 사용량 요청 자동화", icon: MessageSquareText, tone: "bg-slate-100 text-slate-400", pending: true },
      { key: "itHistory", title: "IT 학습·처리이력", desc: "처리이력·퀴즈·기술 레벨", icon: GraduationCap, tone: "bg-slate-100 text-slate-400", pending: true },
    ],
  },
  {
    title: "기록·성과",
    items: [
      { key: "daily", title: "일일방문일지", desc: "기간별 방문·업무시간 집계", icon: BarChart3, tone: "bg-cyan-50 text-cyan-700" },
      { key: "weekly", title: "주간현황판", desc: "목표·병목·실적·성장 기록", icon: Target, tone: "bg-indigo-50 text-indigo-700" },
      { key: "growth", title: "성장기록", desc: "분기 결과·미션·골든미팅카드", icon: Sparkles, tone: "bg-fuchsia-50 text-fuchsia-700" },
    ],
  },
];

const comparisons = [
  { task: "양식 작성", before: "카톡 복사 → 삼성노트 → 불필요 내용 삭제·수정", after: "원본 붙여넣기·사진·검색으로 자동 변환", oldTime: "5~8분", newTime: "1~2분" },
  { task: "업무방 전송", before: "점검·AS·자가·부품방을 찾아 내용과 사진을 각각 전송", after: "업무 종류 선택 한 번으로 지정 방에 내용·사진 전송", oldTime: "3~5분", newTime: "1~2분" },
  { task: "업무 보고", before: "방문 내용을 일일방문일지와 주간현황판에 다시 작성", after: "FIELD 기록이 일일·주간 실적으로 자동 집계", oldTime: "5~10분", newTime: "자동" },
];

const flow = [
  { title: "일정·대상", desc: "캘린더·워킨맵", icon: CalendarDays, screen: "calendar" as Screen },
  { title: "현장 입력", desc: "FIELD 한 번 작성", icon: FilePenLine, screen: "field" as Screen },
  { title: "업무방 전송", desc: "내용·사진 함께", icon: Send, screen: "field" as Screen },
  { title: "자동 집계", desc: "일일·주간 현황", icon: BarChart3, screen: "daily" as Screen },
  { title: "후속 관리", desc: "해피콜·성장기록", icon: PhoneCall, screen: "happycall" as Screen },
];

const manuals = [
  { id: "start", title: "처음 사용할 때", summary: "일정 확인부터 현장 완료까지", icon: Route, steps: ["캘린더 또는 일정리스트에서 오늘 업무를 확인합니다.", "워킨맵에서 점검·재계약 대상과 최근 방문 이력을 확인합니다.", "FIELD에서 양식을 작성하고 사진을 첨부한 뒤 해당 업무방으로 전송합니다.", "저장된 방문은 일일방문일지와 주간현황판에서 자동으로 확인합니다."] },
  { id: "field", title: "FIELD 작성·전송", summary: "원본 변환, 기기 수정, 사진, 전송", icon: FilePenLine, steps: ["원본 붙여넣기, 사진 변환 또는 거래처 검색으로 양식을 불러옵니다.", "기기선택에서 위치·모델·시리얼·자산기번·내용을 확인합니다.", "작성 칸과 결과 미리보기가 같은 내용인지 최종 확인합니다.", "사진을 첨부하고 점검·AS·물류 등 해당 업무방으로 전송합니다."] },
  { id: "manage", title: "방문 이후 관리", summary: "이력, 해피콜, 홍보물, 성과 기록", icon: ClipboardCheck, steps: ["통합이력에서 거래처의 점검·AS·불만·미수 등 전체 기록을 찾습니다.", "최근 방문 업체에는 해피콜을 즉시 또는 예약 발송할 수 있습니다.", "필요한 홍보물을 문자·메일로 보내거나 현장에서 인쇄해 활용합니다.", "주간현황과 성장기록을 분기 결과 및 골든미팅카드 자료로 이어갑니다."] },
];

function MenuRow({ item, onOpen }: { item: MenuItem; onOpen: (screen: Screen) => void }) {
  const Icon = item.icon;
  return (
    <button type="button" onClick={() => onOpen(item.key)} className="group flex min-h-[64px] w-full items-center gap-3 border-t border-slate-100 px-4 py-3 text-left transition first:border-t-0 hover:bg-slate-50 active:bg-slate-100">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${item.tone}`}><Icon size={18} strokeWidth={2.2} /></span>
      <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="truncate text-sm font-black text-slate-950">{item.title}</span>{item.pending && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-black text-slate-500">준비 중</span>}</span><span className="mt-0.5 block text-xs font-semibold text-slate-500">{item.desc}</span></span>
      <ArrowRight size={15} className="shrink-0 text-slate-300 transition group-hover:text-blue-600" />
    </button>
  );
}

export default function Home({ onGoField, onNavigate }: { onGoField: () => void; onNavigate?: (screen: Screen) => void }) {
  const today = useMemo(() => new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(new Date()), []);
  const quarter = useMemo(() => Math.floor(new Date().getMonth() / 3) + 1, []);
  const [openManual, setOpenManual] = useState("");
  const [showAllMenus, setShowAllMenus] = useState(false);
  const go = (screen: Screen) => screen === "field" ? onGoField() : onNavigate?.(screen);

  return (
    <div className="space-y-5 pb-10">
      <section className="relative min-h-[310px] overflow-hidden rounded-lg bg-slate-950 text-white shadow-sm sm:min-h-[330px]">
        <img src={workflowImage} alt="현장에서 FIELD를 작성하고 운영 현황을 확인하는 CS 업무" className="absolute inset-0 h-full w-full object-cover object-[68%_center]" />
        <div className="absolute inset-0 bg-slate-950/75" />
        <div className="relative flex min-h-[310px] max-w-3xl flex-col justify-center p-5 sm:min-h-[330px] sm:p-8 lg:p-10">
          <div className="flex flex-wrap items-center gap-2 text-xs font-black text-blue-200"><span>{today}</span><span className="h-3 w-px bg-white/25" /><span>{quarter}분기 운영 중</span></div>
          <h2 className="mt-3 max-w-2xl text-3xl font-black leading-tight sm:text-4xl">현장 기록 한 번으로<br />전송부터 보고까지</h2>
          <p className="mt-3 max-w-xl text-sm font-semibold leading-6 text-slate-200 sm:text-base">카톡 원본을 다시 고치고, 여러 방에 보내고, 일지에 또 적던 반복 업무를 하나의 흐름으로 연결합니다.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={() => go("field")} className="flex min-h-11 items-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-black shadow-sm hover:bg-blue-500"><Plus size={17} />FIELD 바로 작성</button>
            <button type="button" onClick={() => go("calendar")} className="min-h-11 rounded-md border border-white/25 bg-slate-950/45 px-4 py-2.5 text-sm font-black hover:bg-white/10">오늘 일정 확인</button>
          </div>
        </div>
      </section>

      <section aria-label="핵심 효율" className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {[
            ["한 번 입력", "양식·전송·집계 연결"],
            ["4개 업무방", "점검·AS·자가·부품 분기"],
            ["자동 집계", "일일·주간 재작성 제거"],
            ["약 10분+", "방문 1건 반복업무 절감 예상"],
          ].map(([value, label], index) => <div key={value} className={`px-4 py-4 ${index % 2 ? "border-l" : ""} ${index > 1 ? "border-t lg:border-t-0" : ""} lg:border-l lg:first:border-l-0`}><div className="text-lg font-black text-slate-950 sm:text-xl">{value}</div><div className="mt-1 text-[11px] font-bold leading-4 text-slate-500 sm:text-xs">{label}</div></div>)}
        </div>
      </section>

      <section>
        <div className="mb-3 px-1"><h3 className="text-lg font-black text-slate-950">바로 시작</h3><p className="mt-0.5 text-xs font-semibold text-slate-500">현장과 이동 중 가장 자주 쓰는 메뉴입니다.</p></div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {primaryLinks.map((item) => {
            const Icon = item.icon;
            return <button key={item.key} type="button" onClick={() => go(item.key)} className="flex min-h-[96px] items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-blue-200 hover:shadow-md sm:p-4"><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${item.tone}`}><Icon size={19} /></span><span className="min-w-0"><span className="block text-sm font-black text-slate-950">{item.title}</span><span className="mt-1 block text-[11px] font-semibold leading-4 text-slate-500 sm:text-xs">{item.desc}</span></span></button>;
          })}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-5">
          <div><div className="text-xs font-black text-blue-600">BEFORE → NOW</div><h3 className="mt-1 text-lg font-black text-slate-950">반복 업무가 어떻게 줄었는지</h3><p className="mt-1 text-xs font-semibold text-slate-500">기존 현장 흐름을 기준으로 한 예상 시간이며 실제 운영 데이터로 조정할 수 있습니다.</p></div>
          <div className="shrink-0 rounded-md bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-800">건당 약 11~19분 절감 여지</div>
        </div>
        <div className="hidden grid-cols-[110px_minmax(0,1fr)_80px_minmax(0,1fr)_80px] bg-slate-50 px-5 py-2 text-[11px] font-black text-slate-500 md:grid"><span>업무</span><span>기존 방식</span><span>예상</span><span>현재 웹앱</span><span>예상</span></div>
        <div className="divide-y divide-slate-100">
          {comparisons.map((row) => <div key={row.task} className="grid gap-3 px-4 py-4 md:grid-cols-[110px_minmax(0,1fr)_80px_minmax(0,1fr)_80px] md:items-center md:px-5"><div className="text-sm font-black text-slate-950">{row.task}</div><div><span className="mb-1 block text-[10px] font-black text-slate-400 md:hidden">기존</span><p className="text-xs font-semibold leading-5 text-slate-500">{row.before}</p></div><div className="text-xs font-black text-rose-600">{row.oldTime}</div><div><span className="mb-1 block text-[10px] font-black text-blue-600 md:hidden">현재</span><p className="text-xs font-bold leading-5 text-slate-800">{row.after}</p></div><div className="text-xs font-black text-emerald-700">{row.newTime}</div></div>)}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-4 sm:px-5"><h3 className="text-base font-black text-slate-950">한 번의 현장 기록이 이어지는 곳</h3><p className="mt-1 text-xs font-semibold text-slate-500">단순 양식 작성 앱이 아니라 일정, 현장, 고객, 보고를 연결하는 CS 운영 시스템입니다.</p></div>
        <div className="grid grid-cols-2 sm:grid-cols-5">
          {flow.map((item, index) => {
            const Icon = item.icon;
            return <button key={item.title} type="button" onClick={() => go(item.screen)} className={`relative min-h-[112px] border-slate-100 px-3 py-4 text-left hover:bg-slate-50 ${index ? "border-l" : ""} ${index > 1 ? "border-t sm:border-t-0" : ""} ${index === 4 ? "col-span-2 sm:col-span-1" : ""}`}><Icon size={20} className="text-blue-600" /><span className="mt-3 block text-sm font-black text-slate-950">{item.title}</span><span className="mt-1 block text-[11px] font-semibold text-slate-500">{item.desc}</span>{index < flow.length - 1 && <ArrowRight size={14} className="absolute right-2 top-5 hidden text-slate-300 sm:block" />}</button>;
          })}
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        {[
          { icon: Clock3, title: "반복 시간 감소", desc: "현장 내용의 재작성과 카톡방별 반복 전송을 줄여 실제 처리 업무에 시간을 씁니다." },
          { icon: CheckCircle2, title: "누락과 오기입 감소", desc: "사진, 기기정보, 전송 대상과 방문기록을 한 흐름에서 확인해 빠뜨릴 가능성을 낮춥니다." },
          { icon: UsersRound, title: "팀 운영 가시화", desc: "캘린더, 워킨맵 진행률, 일일·주간 실적으로 현재 업무 상태를 함께 확인합니다." },
        ].map((item) => <div key={item.title} className="border-l-4 border-blue-600 bg-white px-4 py-4 shadow-sm"><item.icon size={20} className="text-blue-600" /><h3 className="mt-3 text-sm font-black text-slate-950">{item.title}</h3><p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{item.desc}</p></div>)}
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <button type="button" aria-expanded={showAllMenus} onClick={() => setShowAllMenus(!showAllMenus)} className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-slate-50 sm:px-5"><span className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-950 text-white"><ClipboardList size={18} /></span><span className="min-w-0 flex-1"><span className="block text-sm font-black text-slate-950">전체 업무 메뉴</span><span className="mt-0.5 block text-xs font-semibold text-slate-500">현장 운영·고객 관리·기록 성과 기능 보기</span></span><ChevronDown size={18} className={`text-slate-400 transition ${showAllMenus ? "rotate-180" : ""}`} /></button>
        {showAllMenus && <div className="grid border-t border-slate-200 lg:grid-cols-3">{workGroups.map((group, index) => <div key={group.title} className={index ? "border-t border-slate-200 lg:border-l lg:border-t-0" : ""}><div className="bg-slate-50 px-4 py-2.5 text-xs font-black text-slate-700">{group.title}</div>{group.items.map((item) => <MenuRow key={item.key} item={item} onOpen={go} />)}</div>)}</div>}
      </section>

      <section id="home-manual" className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-950 px-4 py-4 text-white sm:px-5"><span className="flex h-9 w-9 items-center justify-center rounded-md bg-white/10"><BookOpen size={19} /></span><div><h3 className="text-sm font-black">빠른 사용 안내</h3><p className="mt-0.5 text-[11px] font-semibold text-slate-400">필요한 업무만 펼쳐 확인하세요.</p></div></div>
        <div className="divide-y divide-slate-100">
          {manuals.map((manual) => {
            const Icon = manual.icon;
            const open = openManual === manual.id;
            return <div key={manual.id}><button type="button" aria-expanded={open} onClick={() => setOpenManual(open ? "" : manual.id)} className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-slate-50 sm:px-5"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${open ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}><Icon size={18} /></span><span className="min-w-0 flex-1"><span className="block text-sm font-black text-slate-950">{manual.title}</span><span className="mt-0.5 block text-xs font-semibold text-slate-500">{manual.summary}</span></span><ChevronDown size={18} className={`shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} /></button>{open && <div className="border-t border-slate-100 bg-slate-50 px-4 py-4 sm:px-5"><ol className="space-y-3">{manual.steps.map((step) => <li key={step} className="flex gap-3"><span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check size={13} strokeWidth={3} /></span><span className="text-sm font-semibold leading-6 text-slate-700">{step}</span></li>)}</ol></div>}</div>;
          })}
        </div>
      </section>
    </div>
  );
}
