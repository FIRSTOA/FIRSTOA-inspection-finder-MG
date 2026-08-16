/**
 * 홈 — 오늘의 작업대. (2026-08 전면 개편)
 * 마케팅 랜딩이 아니라 "지금 뭐부터 하면 되는지"가 보이는 첫 화면:
 * 오늘 일정·미배정·분기 점검 진행률(실데이터) → 바로 시작 타일 → 업무 흐름 → 새 기능 → 사용 안내.
 */
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  FilePenLine,
  GraduationCap,
  Layers3,
  MapPinned,
  Megaphone,
  MessageSquareText,
  PhoneCall,
  Route,
  Search,
  Sparkles,
  Target,
  UsersRound,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { selectAllRows, selectRows } from "./supabase";
import { kstDate } from "./visits";

type Screen =
  | "field"
  | "calendar"
  | "walkingMap"
  | "autoSchedule"
  | "asReception"
  | "serviceReception"
  | "lookup"
  | "happycall"
  | "promoSend"
  | "daily"
  | "weekly"
  | "growth"
  | "itHistory"
  | "counterSms"
  | "selfdev"
  | "copierNotes"
  | "operations";

type MenuItem = { key: Screen; title: string; desc: string; icon: LucideIcon; tone: string };

const primaryLinks: MenuItem[] = [
  { key: "serviceReception", title: "서비스접수", desc: "접수 한 번 → 일정·네이버 자동 등록", icon: ClipboardList, tone: "bg-rose-600 text-white" },
  { key: "asReception", title: "일정리스트", desc: "배정 박스·⚠체크·전화·FIELD", icon: ClipboardList, tone: "bg-violet-600 text-white" },
  { key: "calendar", title: "캘린더", desc: "네이버와 20초 동기화·드래그 이동", icon: CalendarDays, tone: "bg-blue-600 text-white" },
  { key: "walkingMap", title: "워킨맵", desc: "분기 점검·재계약 지도 (G라벨 안내)", icon: MapPinned, tone: "bg-emerald-600 text-white" },
  { key: "autoSchedule", title: "자동 일정", desc: "가까운 점검 후보 + 사용량·여분", icon: Wand2, tone: "bg-amber-500 text-white" },
  { key: "field", title: "FIELD", desc: "양식 변환·사진·업무방 전송", icon: FilePenLine, tone: "bg-slate-950 text-white" },
];

const workGroups: Array<{ title: string; items: MenuItem[] }> = [
  {
    title: "현장 운영",
    items: [
      { key: "serviceReception", title: "서비스접수", desc: "임대리스트 검색·⚠체크·주소변경 처리", icon: ClipboardList, tone: "bg-rose-50 text-rose-700" },
      { key: "asReception", title: "일정리스트", desc: "미배정/배정 박스·구분 칩·경과 표시", icon: ClipboardList, tone: "bg-violet-50 text-violet-700" },
      { key: "calendar", title: "캘린더", desc: "네이버 양방향·팀 필터·검색·그날 팝업", icon: CalendarDays, tone: "bg-blue-50 text-blue-700" },
      { key: "walkingMap", title: "워킨맵", desc: "점검·재계약·미수 알림·자가신청", icon: MapPinned, tone: "bg-emerald-50 text-emerald-700" },
      { key: "autoSchedule", title: "자동 일정", desc: "앵커 기준 추천·이력·여분 권장", icon: Wand2, tone: "bg-amber-50 text-amber-700" },
      { key: "field", title: "FIELD", desc: "현장 양식 작성·사진·전송", icon: FilePenLine, tone: "bg-slate-100 text-slate-800" },
      { key: "lookup", title: "조회", desc: "통합이력·미수·초과·시트 데이터", icon: Search, tone: "bg-cyan-50 text-cyan-700" },
    ],
  },
  {
    title: "학습·지식",
    items: [
      { key: "copierNotes", title: "복합기 학습·처리이력", desc: "브랜드·기종별 사례 + 기술 퀴즈", icon: GraduationCap, tone: "bg-blue-50 text-blue-700" },
      { key: "itHistory", title: "IT 학습·처리이력", desc: "PC 처리이력·기술 퀴즈", icon: GraduationCap, tone: "bg-cyan-50 text-cyan-700" },
      { key: "selfdev", title: "자기개발/지식공유", desc: "독서·배움 공유·목표·칭찬 릴레이", icon: BookOpen, tone: "bg-amber-50 text-amber-700" },
    ],
  },
  {
    title: "기록·성과",
    items: [
      { key: "daily", title: "일일방문일지", desc: "기간별 방문·업무시간 집계", icon: BarChart3, tone: "bg-cyan-50 text-cyan-700" },
      { key: "weekly", title: "주간현황판", desc: "목표·병목·실적·성장 기록", icon: Target, tone: "bg-indigo-50 text-indigo-700" },
      { key: "growth", title: "성장기록", desc: "분기 결과·미션·골든미팅카드", icon: Sparkles, tone: "bg-fuchsia-50 text-fuchsia-700" },
      { key: "operations", title: "업무관리", desc: "팀 운영 현황·재계약=업체 수 집계", icon: UsersRound, tone: "bg-slate-100 text-slate-700" },
      { key: "happycall", title: "해피콜", desc: "방문 후 문자·예약 발송", icon: PhoneCall, tone: "bg-rose-50 text-rose-700" },
      { key: "promoSend", title: "홍보물 발송·인쇄", desc: "홍보자료 문자·메일·인쇄", icon: Megaphone, tone: "bg-amber-50 text-amber-700" },
      { key: "counterSms", title: "카운터 문자전송", desc: "카톡 목록 → 업체별 카운터 요청 문자", icon: MessageSquareText, tone: "bg-emerald-50 text-emerald-600" },
    ],
  },
];

// 접수 → 완료까지 실제 흐름 (2026-08 기준 — 네이버 동기화 포함)
const flow = [
  { title: "접수", desc: "접수 저장 = 일정 + 네이버 캘린더 자동 등록", icon: ClipboardList, screen: "serviceReception" as Screen },
  { title: "배정", desc: "일정리스트에서 담당 배정 · ⚠체크 확인", icon: ClipboardList, screen: "asReception" as Screen },
  { title: "현장", desc: "FIELD 양식·사진 → 업무방 전송", icon: FilePenLine, screen: "field" as Screen },
  { title: "완료", desc: "완료 = 팀 완료 캘린더 이동 + 체크", icon: ClipboardCheck, screen: "calendar" as Screen },
  { title: "집계", desc: "일일·주간·업무관리 자동 반영", icon: BarChart3, screen: "daily" as Screen },
];

// 최근 크게 바뀐 것들 — 팀원에게 "뭐가 달라졌는지" 안내
const highlights = [
  { icon: CalendarDays, title: "네이버 캘린더 완전 동기화", desc: "등록·수정·완료·삭제 전부 양방향, 반영 20초. 네이버에 직접 적은 일정도 팀 시간대로 자동 수입됩니다.", screen: "calendar" as Screen },
  { icon: Layers3, title: "⚠체크 + 통합이력", desc: "업체에 걸린 미수·초과·불만·점검·재계약을 ⚠칩 하나로. 누르면 이번 분기 체크(사용량·여분·기기 포함)가 열립니다.", screen: "asReception" as Screen },
  { icon: Wand2, title: "자동 일정 추천", desc: "마지막 일정에서 가까운 점검·재계약 후보를 추천. 최근 2회 점검으로 사용량과 챙길 여분까지 계산해 줍니다.", screen: "autoSchedule" as Screen },
  { icon: MapPinned, title: "워킨맵 색상 뜻 표기", desc: "G1~G12가 업무별로 무슨 뜻인지(마감일 구간·완료·이관 등) 색상 메뉴와 목록에 바로 표시됩니다.", screen: "walkingMap" as Screen },
];

const manuals = [
  { id: "start", title: "처음 사용할 때", summary: "접수부터 완료까지 한 흐름", icon: Route, steps: [
    "서비스접수에서 임대리스트를 검색해 접수합니다 — 업체명 옆 ⚠칩으로 미수·불만을 먼저 확인하세요.",
    "저장하면 일정리스트와 네이버 캘린더에 자동 등록됩니다 (같은 걸 두 번 눌러도 중복 생성되지 않습니다).",
    "일정리스트에서 담당을 배정하고, 행의 전화·FIELD 버튼으로 바로 처리합니다.",
    "완료를 누르면 네이버에서도 팀 완료 캘린더로 이동·체크되고, 일일·주간 실적에 자동 집계됩니다.",
  ] },
  { id: "sync", title: "네이버 캘린더와 같이 쓰기", summary: "어디서 고쳐도 따라옵니다", icon: CalendarDays, steps: [
    "네이버에서 일정 날짜를 옮기면 웹앱 일정도 최대 20초 안에 따라 움직입니다 (반대도 동일).",
    "네이버에 직접 적은 일정도 시간이 있으면 팀 시간대(9/12/15/18/21시=A~E, 그 외=기타)로 일정리스트에 들어옵니다. 종일 일정(연차 등)은 캘린더 표시 전용입니다.",
    "삭제도 양방향입니다 — 접수 원본은 남지만 일정은 사라지니 삭제는 신중하게.",
    "매월점검은 웹앱 전용이라 네이버에 등록되지 않고 캘린더에만 보입니다.",
  ] },
  { id: "history", title: "통합이력·⚠체크 활용", summary: "방문 전 30초 점검", icon: Layers3, steps: [
    "목록에서 ⚠숫자 칩이 보이면 그 업체에 확인할 게 있다는 뜻입니다 — 빨강(미수·불만) > 주황(초과) > 파랑(점검·재계약).",
    "칩을 누르면 통합이력이 열리고, 맨 위 '이번 분기 체크' 카드에서 사용량·여분 권장·기기 구성·특이사항까지 한눈에 봅니다.",
    "같은 이름을 쓰는 법인이 여럿이면(청연 등) 검색창 아래 '넓게 보기' 버튼으로 계열 전체를 볼 수 있습니다.",
    "기록이 안 보이면 시스템관리의 거래처 코드 확정에서 코드를 연결하면 정확해집니다.",
  ] },
  { id: "autoplan", title: "자동 일정으로 동선 짜기", summary: "가까운 점검 후보 추천", icon: Wand2, steps: [
    "날짜·팀을 고르면 그날 필수 일정이 뜹니다 — 마지막 일정(앵커)을 기준으로 잡습니다.",
    "[가까운 순으로 추천]을 누르면 현분기 워킨맵 점검·재계약 후보가 거리순으로 나옵니다.",
    "후보마다 마지막 점검일·사용량·챙길 여분·보유 기기·특이사항이 함께 보입니다.",
    "체크해서 등록하면 내 일정에 배정 상태로 들어갑니다.",
  ] },
  { id: "address", title: "주소가 바뀌었을 때", summary: "한 곳에서 처리하면 전부 반영", icon: ClipboardCheck, steps: [
    "서비스접수의 '주소변경 처리'를 사용하세요 — 워킨맵과 임대리스트(웹앱 DB)에 동시 반영됩니다.",
    "구글시트 원본은 담당자가 직접 수정한 뒤 '시트 반영 완료'를 눌러야 완결됩니다.",
    "시트를 안 고치면 다음 주간 동기화 때 옛 주소로 되돌아갑니다.",
  ] },
];

function MenuRow({ item, onOpen }: { item: MenuItem; onOpen: (screen: Screen) => void }) {
  const Icon = item.icon;
  return (
    <button type="button" onClick={() => onOpen(item.key)} className="group flex min-h-[64px] w-full items-center gap-3 border-t border-slate-100 px-4 py-3 text-left transition first:border-t-0 hover:bg-slate-50 active:bg-slate-100">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${item.tone}`}><Icon size={18} strokeWidth={2.2} /></span>
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-black text-slate-950">{item.title}</span><span className="mt-0.5 block text-xs font-semibold text-slate-500">{item.desc}</span></span>
      <ArrowRight size={15} className="shrink-0 text-slate-300 group-hover:text-blue-600" />
    </button>
  );
}

export default function Home({ onGoField, onNavigate }: { onGoField: () => void; onNavigate?: (screen: Screen) => void }) {
  const todayLabel = useMemo(() => new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(new Date()), []);
  const quarter = useMemo(() => Math.floor(new Date().getMonth() / 3) + 1, []);
  const [openManual, setOpenManual] = useState("");
  const [showAllMenus, setShowAllMenus] = useState(false);
  const go = (screen: Screen) => screen === "field" ? onGoField() : onNavigate?.(screen);

  // 오늘 요약 — 일정리스트와 같은 기준(매월점검 제외)으로 미배정/진행/완료를 센다
  const [todayStats, setTodayStats] = useState<{ total: number; un: number; doing: number; done: number } | null>(null);
  // 분기 점검 진행률 — 워킨맵 quarter 대상 중 G5(완료) 비율 (G12 이관은 대상에서 제외)
  const [quarterStats, setQuarterStats] = useState<{ total: number; done: number } | null>(null);
  useEffect(() => {
    let active = true;
    const date = kstDate();
    void selectRows<{ assignee: string | null; status: string; scheduleType: string }>(
      "as_tickets", `select=assignee,status,scheduleType&date=eq.${date}&limit=1000`,
    ).then((rows) => {
      if (!active) return;
      const list = rows.filter((t) => t.scheduleType !== "매월점검");
      const done = list.filter((t) => t.status === "완료").length;
      const un = list.filter((t) => t.status !== "완료" && !(t.assignee || "").trim()).length;
      setTodayStats({ total: list.length, un, doing: list.length - done - un, done });
    }).catch(() => undefined);
    void selectAllRows<{ label: string | null }>(
      "workin_map_places", `select=label&kind=eq.quarter&quarter=eq.${Math.floor(new Date().getMonth() / 3) + 1}&visible=not.is.false`,
    ).then((rows) => {
      if (!active) return;
      const scoped = rows.filter((r) => r.label !== "G12");
      setQuarterStats({ total: scoped.length, done: scoped.filter((r) => r.label === "G5").length });
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const progress = quarterStats && quarterStats.total ? Math.round((quarterStats.done / quarterStats.total) * 100) : null;

  return (
    <div className="space-y-5 pb-10">
      {/* 오늘의 작업대 — 다크 헤더 + 실시간 숫자 */}
      <section className="overflow-hidden rounded-xl bg-[#1E252F] text-white shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4 px-5 py-6 sm:px-7">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-black text-blue-300"><span>{todayLabel}</span><span className="h-3 w-px bg-white/25" /><span>{quarter}분기 운영 중</span></div>
            <h2 className="mt-2 text-2xl font-black leading-tight sm:text-3xl">오늘 뭐부터 할까요</h2>
            <p className="mt-1.5 text-sm font-semibold text-slate-400">접수 한 번이면 일정·네이버 캘린더·실적 집계까지 자동으로 이어집니다.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => go("asReception")} className="min-h-10 rounded-full bg-blue-600 px-4 py-2 text-sm font-black shadow-[0_3px_10px_rgba(37,99,235,0.35)] transition hover:bg-blue-700">오늘 일정 열기</button>
              <button type="button" onClick={() => go("serviceReception")} className="min-h-10 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-sm font-black transition hover:bg-white/15">접수하기</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => go("asReception")} className="min-w-[104px] rounded-xl bg-white/[0.07] px-4 py-3 text-left transition hover:bg-white/[0.14]">
              <div className="text-[11px] font-black text-slate-400">오늘 일정</div>
              <div className="mt-1 text-2xl font-black tabular-nums">{todayStats ? todayStats.total : "–"}<span className="ml-1 text-xs font-bold text-slate-400">건</span></div>
            </button>
            <button type="button" onClick={() => go("asReception")} className={`min-w-[104px] rounded-xl px-4 py-3 text-left transition ${todayStats?.un ? "bg-rose-500/15 hover:bg-rose-500/25" : "bg-white/[0.07] hover:bg-white/[0.14]"}`}>
              <div className={`text-[11px] font-black ${todayStats?.un ? "text-rose-300" : "text-slate-400"}`}>미배정</div>
              <div className={`mt-1 text-2xl font-black tabular-nums ${todayStats?.un ? "text-rose-300" : ""}`}>{todayStats ? todayStats.un : "–"}<span className="ml-1 text-xs font-bold opacity-60">건</span></div>
            </button>
            <button type="button" onClick={() => go("asReception")} className="min-w-[104px] rounded-xl bg-white/[0.07] px-4 py-3 text-left transition hover:bg-white/[0.14]">
              <div className="text-[11px] font-black text-slate-400">완료</div>
              <div className="mt-1 text-2xl font-black tabular-nums text-emerald-300">{todayStats ? todayStats.done : "–"}<span className="ml-1 text-xs font-bold text-slate-400">/{todayStats ? todayStats.total : "–"}</span></div>
            </button>
            <button type="button" onClick={() => go("walkingMap")} className="min-w-[124px] rounded-xl bg-white/[0.07] px-4 py-3 text-left transition hover:bg-white/[0.14]">
              <div className="text-[11px] font-black text-slate-400">{quarter}분기 점검</div>
              <div className="mt-1 text-2xl font-black tabular-nums">{progress === null ? "–" : `${progress}%`}</div>
              {quarterStats && <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${progress ?? 0}%` }} /></div>}
            </button>
          </div>
        </div>
      </section>

      {/* 바로 시작 */}
      <section>
        <div className="mb-3 px-1"><h3 className="text-base font-black text-slate-950 lg:text-lg">바로 시작</h3></div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          {primaryLinks.map((item) => {
            const Icon = item.icon;
            return <button key={item.key} type="button" onClick={() => go(item.key)} className="flex min-h-[92px] items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md sm:p-4"><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${item.tone}`}><Icon size={19} /></span><span className="min-w-0"><span className="block text-sm font-black text-slate-950">{item.title}</span><span className="mt-1 block text-[11px] font-semibold leading-4 text-slate-500">{item.desc}</span></span></button>;
          })}
        </div>
      </section>

      {/* 업무 흐름 */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-4 sm:px-5"><h3 className="text-base font-black text-slate-950">입력은 한 번, 전파는 자동</h3><p className="mt-1 text-xs font-semibold text-slate-500">접수부터 집계까지 — 중간에 다시 적는 일이 없습니다.</p></div>
        <div className="grid grid-cols-2 sm:grid-cols-5">
          {flow.map((item, index) => {
            const Icon = item.icon;
            return <button key={item.title} type="button" onClick={() => go(item.screen)} className={`relative min-h-[104px] border-slate-100 px-3 py-4 text-left hover:bg-slate-50 ${index ? "border-l" : ""} ${index > 1 ? "border-t sm:border-t-0" : ""} ${index === 4 ? "col-span-2 sm:col-span-1" : ""}`}><Icon size={20} className="text-blue-600" /><span className="mt-2.5 block text-sm font-black text-slate-950">{item.title}</span><span className="mt-1 block text-[11px] font-semibold leading-4 text-slate-500">{item.desc}</span>{index < flow.length - 1 && <ArrowRight size={14} className="absolute right-2 top-5 hidden text-slate-300 sm:block" />}</button>;
          })}
        </div>
      </section>

      {/* 새로 들어온 기능 */}
      <section>
        <div className="mb-3 px-1"><h3 className="text-base font-black text-slate-950 lg:text-lg">최근 크게 바뀐 것</h3><p className="mt-0.5 text-xs font-semibold text-slate-500">2026년 8월 업데이트 — 누르면 해당 화면으로 이동합니다.</p></div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {highlights.map((item) => {
            const Icon = item.icon;
            return <button key={item.title} type="button" onClick={() => go(item.screen)} className="rounded-xl border border-slate-200 border-l-4 border-l-blue-600 bg-white px-4 py-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><Icon size={20} className="text-blue-600" /><h4 className="mt-2.5 text-sm font-black text-slate-950">{item.title}</h4><p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{item.desc}</p></button>;
          })}
        </div>
      </section>

      {/* 전체 메뉴 */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <button type="button" aria-expanded={showAllMenus} onClick={() => setShowAllMenus(!showAllMenus)} className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-slate-50 sm:px-5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-white"><ClipboardList size={18} /></span><span className="min-w-0 flex-1"><span className="block text-sm font-black text-slate-950">전체 업무 메뉴</span><span className="mt-0.5 block text-xs font-semibold text-slate-500">현장 운영·학습·기록 성과 전체 보기</span></span><ChevronDown size={18} className={`text-slate-400 transition ${showAllMenus ? "rotate-180" : ""}`} /></button>
        {showAllMenus && <div className="grid border-t border-slate-200 lg:grid-cols-3">{workGroups.map((group, index) => <div key={group.title} className={index ? "border-t border-slate-200 lg:border-l lg:border-t-0" : ""}><div className="bg-slate-50 px-4 py-2.5 text-[11px] font-black uppercase tracking-wide text-slate-500">{group.title}</div>{group.items.map((item) => <MenuRow key={`${group.title}-${item.key}`} item={item} onOpen={go} />)}</div>)}</div>}
      </section>

      {/* 사용 안내 */}
      <section id="home-manual" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-200 bg-[#1E252F] px-4 py-4 text-white sm:px-5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10"><BookOpen size={19} /></span><div><h3 className="text-sm font-black">빠른 사용 안내</h3><p className="mt-0.5 text-[11px] font-semibold text-slate-400">필요한 업무만 펼쳐 확인하세요.</p></div></div>
        <div className="divide-y divide-slate-100">
          {manuals.map((manual) => {
            const Icon = manual.icon;
            const open = openManual === manual.id;
            return <div key={manual.id}><button type="button" aria-expanded={open} onClick={() => setOpenManual(open ? "" : manual.id)} className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-slate-50 sm:px-5"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${open ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}><Icon size={18} /></span><span className="min-w-0 flex-1"><span className="block text-sm font-black text-slate-950">{manual.title}</span><span className="mt-0.5 block text-xs font-semibold text-slate-500">{manual.summary}</span></span><ChevronDown size={18} className={`shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} /></button>{open && <div className="border-t border-slate-100 bg-slate-50 px-4 py-4 sm:px-5"><ol className="space-y-3">{manual.steps.map((step) => <li key={step} className="flex gap-3"><span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check size={13} strokeWidth={3} /></span><span className="text-sm font-semibold leading-6 text-slate-700">{step}</span></li>)}</ol></div>}</div>;
          })}
        </div>
      </section>
    </div>
  );
}
