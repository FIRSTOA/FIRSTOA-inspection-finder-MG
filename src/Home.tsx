import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  BarChart3,
  BookOpen,
  Bot,
  CalendarDays,
  Camera,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  Database,
  FilePenLine,
  GraduationCap,
  MapPinned,
  Megaphone,
  MessageSquareText,
  PhoneCall,
  Plus,
  Radio,
  RefreshCw,
  Route,
  ShieldCheck,
  Sparkles,
  Target,
  UsersRound,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { PATCH_NOTES } from "./patchNotes";
import { countRows, selectRows } from "./supabase";
import { getTeamVisits, kstDate, weekRange } from "./visits";

// 홈 = 실시간 운영 현황판 (2026-09-12 개편)
// 위: 다크 관제 패널 — 라이브 시계·시스템 상태·오늘/이번 주 지표·팀별 분기 진행률·실시간 활동 피드(60초 갱신)
// 아래: 예전 홈의 정보를 압축 — 바로 시작 · 기능 한 줄 요약 · 절약 효과 칩 · 최신 패치 3건 · 사용 안내
// 데이터는 전부 anon 읽기 가능한 테이블만 쓴다(jeomgeom·as_records·outbox·workin_map_places·contact_changes·visit_logs 등).

type Screen =
  | "field"
  | "calendar"
  | "walkingMap"
  | "asReception"
  | "serviceReception"
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
  { key: "serviceReception", title: "서비스접수", desc: "접수·확인 팝업·일정 자동등록", icon: ClipboardList, tone: "bg-rose-600 text-white" },
  { key: "asReception", title: "일정리스트", desc: "상세 팝업·통화·네비·FIELD 변환", icon: ClipboardList, tone: "bg-violet-600 text-white" },
  { key: "walkingMap", title: "워킨맵", desc: "점검·재계약·미수·여분 분석", icon: MapPinned, tone: "bg-emerald-600 text-white" },
  { key: "field", title: "FIELD 작성", desc: "양식·사진·업무방 전송", icon: FilePenLine, tone: "bg-slate-950 text-white" },
];

// 기능별 "무엇이 편해지는지" 한 줄 — 길게 설명하지 않는다(요청: 간략히)
const workGroups: Array<{ title: string; items: MenuItem[] }> = [
  {
    title: "현장 운영",
    items: [
      { key: "serviceReception", title: "서비스접수", desc: "임대리스트 검색 → 접수·일정까지 한 번에", icon: ClipboardList, tone: "bg-rose-50 text-rose-700" },
      { key: "asReception", title: "일정리스트", desc: "상세·통화·네비·FIELD 변환이 한 팝업에", icon: ClipboardList, tone: "bg-violet-50 text-violet-700" },
      { key: "calendar", title: "CS 캘린더", desc: "팀 일정 등록·완료, 네이버와 자동 동기화", icon: CalendarDays, tone: "bg-blue-50 text-blue-700" },
      { key: "walkingMap", title: "워킨맵", desc: "분기 대상·미수·재계약을 지도 위에서 색으로", icon: MapPinned, tone: "bg-emerald-50 text-emerald-700" },
      { key: "field", title: "FIELD", desc: "원본 붙여넣기 → 양식·사진·방 전송 1분", icon: FilePenLine, tone: "bg-slate-100 text-slate-800" },
    ],
  },
  {
    title: "학습·지식",
    items: [
      { key: "copierNotes", title: "복합기 학습·처리이력", desc: "기종별 사례가 쌓여 다음 AS가 빨라진다", icon: GraduationCap, tone: "bg-blue-50 text-blue-700" },
      { key: "itHistory", title: "IT 학습·처리이력", desc: "PC 처리이력 검색·기술 퀴즈", icon: GraduationCap, tone: "bg-cyan-50 text-cyan-700" },
      { key: "selfdev", title: "자기개발/지식공유", desc: "독서·배움·칭찬 릴레이", icon: BookOpen, tone: "bg-amber-50 text-amber-700" },
    ],
  },
  {
    title: "기록·성과",
    items: [
      { key: "daily", title: "일일방문일지", desc: "FIELD 기록이 그대로 일지로 — 재작성 0", icon: BarChart3, tone: "bg-cyan-50 text-cyan-700" },
      { key: "weekly", title: "주간현황판", desc: "목표·병목·실적 자동 집계", icon: Target, tone: "bg-indigo-50 text-indigo-700" },
      { key: "growth", title: "성장기록", desc: "분기 결과·미션·골든미팅카드", icon: Sparkles, tone: "bg-fuchsia-50 text-fuchsia-700" },
      { key: "operations", title: "업무관리", desc: "팀 운영 현황·담당자/주소 변경이력", icon: UsersRound, tone: "bg-slate-100 text-slate-700" },
      { key: "happycall", title: "해피콜", desc: "방문 후 문자·예약 발송", icon: PhoneCall, tone: "bg-rose-50 text-rose-700" },
      { key: "promoSend", title: "홍보물 발송·인쇄", desc: "홍보자료 문자·메일·인쇄", icon: Megaphone, tone: "bg-amber-50 text-amber-700" },
      { key: "counterSms", title: "카운터 문자전송", desc: "카톡 목록 → 업체별 카운터 요청 문자", icon: MessageSquareText, tone: "bg-emerald-50 text-emerald-600" },
    ],
  },
];

// 절약 효과 — 칩 한 줄로 (요청: 간단히)
const savings = [
  { task: "양식 작성", before: "5~8분", after: "1~2분" },
  { task: "업무방 전송", before: "3~5분", after: "1~2분" },
  { task: "업무 보고", before: "5~10분", after: "자동" },
];

const manuals = [
  { id: "start", title: "처음 사용할 때", summary: "접수부터 현장 완료까지", icon: Route, steps: ["서비스접수에서 임대리스트를 검색해 접수하고, 확인 팝업에서 주소·접수자를 점검합니다.", "일정리스트에서 오늘 일정을 확인하고 통화·네비로 이동합니다.", "현장에서 FIELD에 원본을 붙여넣어 양식으로 바꾸고 사진을 붙여 업무방에 전송합니다.", "완료 처리하면 일일방문일지·주간현황판에 자동 집계됩니다."] },
  { id: "reception", title: "접수 → 일정 → FIELD 연동", summary: "접수 한 번으로 일정·양식까지", icon: ClipboardList, steps: ["접수 저장 시 '일정리스트에도 등록'을 켜두면 오늘 날짜로 일정이 생깁니다.", "일정 상세의 FIELD 버튼을 누르면 접수 원본이 그대로 양식으로 바뀝니다.", "완료 처리하면 접수 상태도 함께 바뀝니다."] },
  { id: "field", title: "FIELD 작성·전송", summary: "원본 변환, 기기 수정, 사진, 전송", icon: FilePenLine, steps: ["원본 붙여넣기, 사진 변환 또는 거래처 검색으로 양식을 불러옵니다.", "기기 정보·토너·여분을 확인하고 필요한 칸만 고칩니다.", "업무 종류를 고르면 지정된 방으로 내용과 사진이 한 번에 전송됩니다."] },
  { id: "manage", title: "방문 이후 관리", summary: "이력, 해피콜, 홍보물, 성과 기록", icon: ClipboardCheck, steps: ["통합이력에서 거래처의 점검·AS·불만·미수 등 전체 기록을 찾습니다.", "해피콜·홍보물 발송으로 방문 뒤 고객 접점을 이어갑니다.", "주간현황판·성장기록에서 목표와 실적을 정리합니다."] },
];

// ── 실시간 데이터 ────────────────────────────────────────────────────────────
type RecordRow = { id: number; created_at: string | null; 작성일: string; 작성자: string; 업체명: string; 구분: string; 지역: string };
type Telemetry = {
  fetchedAt: number;
  latencyMs: number;
  todayInspections: number; todayAs: number;
  weekInspections: number; weekAs: number;
  daily: Array<{ date: string; inspections: number; as: number }>; // 최근 7일
  weekAuthors: number;
  weekVisits: number; weekMinutes: number;
  outboxPending: number; outboxOldestMin: number | null; botLastDelivery: string | null;
  sheetPending: number; sheetFailed: number;
  keymanChanges7d: number; keymanGreetWaiting: number;
  totalRecords: number; totalPhotos: number; activeMembers: number;
  teamProgress: Array<{ team: string; done: number; total: number }>;
  recent: RecordRow[];
  errors: string[];
};

const COL = (name: string) => encodeURIComponent(name);
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return kstDate(d); };

async function loadTelemetry(): Promise<Telemetry> {
  const today = kstDate();
  const week = weekRange(today);
  const d7 = daysAgo(6);
  const quarter = Math.floor(new Date().getMonth() / 3) + 1;
  const errors: string[] = [];
  const t0 = performance.now();
  const latencyProbe = countRows("cs_members", "active=is.true").catch((e) => { errors.push(`멤버 ${(e as Error).message}`); return 0; });
  const activeMembers = await latencyProbe;
  const latencyMs = Math.round(performance.now() - t0);

  const safe = async <T,>(label: string, p: Promise<T>, fallback: T): Promise<T> => {
    try { return await p; } catch (e) { errors.push(`${label} ${(e as Error).message}`); return fallback; }
  };
  const [insp7, as7, recentInsp, recentAs, outbox, activity, sheetJobs, keyman, visits, totalInsp, totalAs, totalPhotos, workin] = await Promise.all([
    safe("점검7일", selectRows<{ 작성일: string; 작성자: string }>("jeomgeom", `select=${COL("작성일")},${COL("작성자")}&${COL("작성일")}=gte.${d7}&_hidden=not.is.true`), []),
    safe("AS7일", selectRows<{ 작성일: string; 작성자: string }>("as_records", `select=${COL("작성일")},${COL("작성자")}&${COL("작성일")}=gte.${d7}&_hidden=not.is.true`), []),
    safe("최근점검", selectRows<RecordRow>("jeomgeom", `select=id,created_at,${COL("작성일")},${COL("작성자")},${COL("업체명")},${COL("구분")},${COL("지역")}&_hidden=not.is.true&order=id.desc&limit=8`), []),
    safe("최근AS", selectRows<RecordRow>("as_records", `select=id,created_at,${COL("작성일")},${COL("작성자")},${COL("업체명")},${COL("구분")},${COL("지역")}&_hidden=not.is.true&order=id.desc&limit=8`), []),
    safe("봇큐", selectRows<{ created_at: string }>("outbox", "select=created_at&order=created_at.asc&limit=50"), []),
    safe("봇배달", selectRows<{ last_at: string }>("room_activity", "select=last_at&source=eq.bot_send&order=last_at.desc&limit=1"), []),
    safe("시트큐", selectRows<{ sheet_status: string | null; created_at: string }>("field_sheet_sync_jobs", `select=sheet_status,created_at&created_at=gte.${d7}&order=id.desc&limit=300`), []), // 최근 7일만 — 옛 실패가 영구히 빨갛게 뜨지 않게
    safe("키맨", selectRows<{ greeting_done: boolean | null; category: string | null }>("contact_changes", `select=greeting_done,category&change_date=gte.${d7}&_hidden=not.is.true`), []),
    safe("방문", getTeamVisits(week.start, week.end), []),
    safe("점검누적", countRows("jeomgeom"), 0),
    safe("AS누적", countRows("as_records"), 0),
    safe("사진", countRows("photo_assets"), 0),
    safe("워킨맵", selectRows<{ team: string; label: string; kind: string }>("workin_map_places", `select=team,label,kind&quarter=eq.${quarter}&kind=in.(quarter,monthly)&visible=not.is.false`), []),
  ]);

  const dayKeys = Array.from({ length: 7 }, (_, i) => daysAgo(6 - i));
  const daily = dayKeys.map((date) => ({
    date,
    inspections: insp7.filter((r) => String(r.작성일 || "").slice(0, 10) === date).length,
    as: as7.filter((r) => String(r.작성일 || "").slice(0, 10) === date).length,
  }));
  const inWeek = (d: string) => d >= week.start && d <= week.end;
  const weekRows = [...insp7, ...as7].filter((r) => inWeek(String(r.작성일 || "").slice(0, 10)));
  const now = Date.now();
  const oldest = outbox[0]?.created_at ? Math.round((now - new Date(outbox[0].created_at).getTime()) / 60000) : null;
  const statusOf = (s: string | null) => (s || "").toLowerCase();
  const visited = visits.filter((v) => v.visited);
  const teams = ["A", "B", "C", "D"];
  return {
    fetchedAt: now, latencyMs,
    todayInspections: daily[6].inspections, todayAs: daily[6].as,
    weekInspections: insp7.filter((r) => inWeek(String(r.작성일 || "").slice(0, 10))).length,
    weekAs: as7.filter((r) => inWeek(String(r.작성일 || "").slice(0, 10))).length,
    daily,
    weekAuthors: new Set(weekRows.map((r) => r.작성자).filter(Boolean)).size,
    weekVisits: visited.length,
    weekMinutes: visited.reduce((s, v) => s + Object.values((v as unknown as { minutes?: Record<string, number> }).minutes || {}).reduce((a, b) => a + (Number(b) || 0), 0), 0),
    outboxPending: outbox.length, outboxOldestMin: oldest,
    botLastDelivery: activity[0]?.last_at || null,
    sheetPending: sheetJobs.filter((j) => ["pending", "queued", "retry"].includes(statusOf(j.sheet_status))).length,
    sheetFailed: sheetJobs.filter((j) => ["failed", "error"].includes(statusOf(j.sheet_status))).length,
    keymanChanges7d: keyman.length,
    keymanGreetWaiting: keyman.filter((k) => !k.greeting_done && /담당|키맨|명의/.test(k.category || "")).length,
    totalRecords: totalInsp + totalAs, totalPhotos, activeMembers,
    // 워킨맵 '팀별 진행률'과 같은 셈법 — 분기점검은 G5·G12가 완료, 매월점검은 한 곳이 3단위(G2=1·G3=2·G5/G12=3)
    teamProgress: teams.map((team) => {
      const rows = workin.filter((w) => w.team === team);
      const quarterly = rows.filter((w) => w.kind === "quarter");
      const monthly = rows.filter((w) => w.kind === "monthly");
      const monthlyUnits = (label: string) => (label === "G2" ? 1 : label === "G3" ? 2 : label === "G5" || label === "G12" ? 3 : 0);
      return {
        team,
        total: quarterly.length + monthly.length * 3,
        done: quarterly.filter((w) => w.label === "G5" || w.label === "G12").length + monthly.reduce((sum, w) => sum + monthlyUnits(w.label), 0),
      };
    }),
    recent: [...recentInsp, ...recentAs].sort((a, b) => String(b.created_at || b.작성일).localeCompare(String(a.created_at || a.작성일))).slice(0, 10),
    errors,
  };
}

function useTelemetry() {
  const [data, setData] = useState<Telemetry | null>(null);
  const [loading, setLoading] = useState(true);
  const busy = useRef(false);
  const refresh = async () => {
    if (busy.current) return;
    busy.current = true;
    try { setData(await loadTelemetry()); } finally { busy.current = false; setLoading(false); }
  };
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);
  return { data, loading, refresh };
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(t); }, []);
  return now;
}

const fmtNum = (n: number) => n.toLocaleString("ko-KR");
const relTime = (iso: string | null) => {
  if (!iso) return "기록 없음";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  if (m < 60 * 24) return `${Math.floor(m / 60)}시간 전`;
  return `${Math.floor(m / 1440)}일 전`;
};
const clockOf = (row: RecordRow) => {
  if (row.created_at) { const d = new Date(row.created_at); return `${row.작성일?.slice(5) || ""} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`.trim(); }
  return row.작성일?.slice(5) || "";
};

// ── 화면 조각 ────────────────────────────────────────────────────────────────
function StatusPill({ tone, icon: Icon, label, value }: { tone: "ok" | "warn" | "bad" | "idle"; icon: LucideIcon; label: string; value: string }) {
  const dot = tone === "ok" ? "bg-emerald-400" : tone === "warn" ? "bg-amber-400" : tone === "bad" ? "bg-rose-500" : "bg-slate-500";
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        {tone !== "idle" && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:hidden ${dot}`} />}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${dot}`} />
      </span>
      <Icon size={14} className="shrink-0 text-slate-400" />
      <span className="min-w-0">
        <span className="block text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</span>
        <span className="block truncate text-[12.5px] font-black text-slate-100">{value}</span>
      </span>
    </div>
  );
}

function Metric({ label, value, sub, icon: Icon, accent = "text-blue-300" }: { label: string; value: string; sub?: string; icon: LucideIcon; accent?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-[0.14em] text-slate-500"><span>{label}</span><Icon size={14} className={accent} /></div>
      <div className="mt-2 text-[28px] font-black leading-none tabular-nums text-white sm:text-[32px]">{value}</div>
      {sub && <div className="mt-1.5 text-[11px] font-bold text-slate-400">{sub}</div>}
    </div>
  );
}

function Bars({ daily }: { daily: Telemetry["daily"] }) {
  const max = Math.max(1, ...daily.map((d) => d.inspections + d.as));
  return (
    <div className="flex h-16 items-end gap-1.5">
      {daily.map((d, i) => {
        const total = d.inspections + d.as;
        const h = Math.max(total ? 6 : 2, Math.round((total / max) * 60));
        const ih = total ? Math.round((d.inspections / total) * h) : 0;
        return (
          <div key={d.date} className="group flex flex-1 flex-col items-center gap-1" title={`${d.date} · 점검 ${d.inspections} · AS ${d.as}`}>
            <div className="flex w-full flex-col justify-end overflow-hidden rounded-sm bg-white/[0.06]" style={{ height: 60 }}>
              <div className={`w-full ${i === 6 ? "bg-blue-400" : "bg-blue-500/60"}`} style={{ height: ih }} />
              <div className={`w-full ${i === 6 ? "bg-violet-400" : "bg-violet-500/60"}`} style={{ height: h - ih }} />
            </div>
            <span className={`text-[9.5px] font-black tabular-nums ${i === 6 ? "text-white" : "text-slate-500"}`}>{d.date.slice(8)}</span>
          </div>
        );
      })}
    </div>
  );
}

function MenuRow({ item, onOpen }: { item: MenuItem; onOpen: (screen: Screen) => void }) {
  const Icon = item.icon;
  return (
    <button type="button" onClick={() => onOpen(item.key)} className="group flex min-h-[56px] w-full items-center gap-3 border-t border-slate-100 px-4 py-2.5 text-left transition first:border-t-0 hover:bg-slate-50 active:bg-slate-100">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${item.tone}`}><Icon size={16} strokeWidth={2.2} /></span>
      <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-black text-slate-950">{item.title}</span><span className="block truncate text-[11px] font-semibold text-slate-500">{item.desc}</span></span>
      <ArrowRight size={14} className="shrink-0 text-slate-300 group-hover:text-blue-600" />
    </button>
  );
}

export default function Home({ onGoField, onNavigate }: { onGoField: () => void; onNavigate?: (screen: Screen) => void }) {
  const now = useClock();
  const { data, loading, refresh } = useTelemetry();
  const [openManual, setOpenManual] = useState("");
  const [showAllMenus, setShowAllMenus] = useState(false);
  const [patchExpanded, setPatchExpanded] = useState(false);
  const go = (screen: Screen) => screen === "field" ? onGoField() : onNavigate?.(screen);

  const quarter = Math.floor(now.getMonth() / 3) + 1;
  const dateLabel = useMemo(() => new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(now), [now.getDate()]); // eslint-disable-line react-hooks/exhaustive-deps
  const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  const weekNo = Math.ceil((((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000) + new Date(now.getFullYear(), 0, 1).getDay() + 1) / 7);

  const patchGroups = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of PATCH_NOTES) map.set(p.date, [...(map.get(p.date) || []), p.note]);
    return Array.from(map.entries());
  }, []);

  // 상태 판정 — 숫자보다 "정상/지연" 한 단어가 먼저 읽히게
  const bot: { tone: "ok" | "warn" | "bad" | "idle"; value: string } = !data ? { tone: "idle", value: "확인 중" }
    : data.outboxPending === 0 ? { tone: "ok", value: `정상 · 마지막 배달 ${relTime(data.botLastDelivery)}` }
    : (data.outboxOldestMin ?? 0) >= 30 ? { tone: "bad", value: `지연 · ${data.outboxPending}건 대기 ${data.outboxOldestMin}분` }
    : { tone: "warn", value: `전송 중 · ${data.outboxPending}건` };
  const sheet: { tone: "ok" | "warn" | "bad" | "idle"; value: string } = !data ? { tone: "idle", value: "확인 중" }
    : data.sheetFailed ? { tone: "bad", value: `실패 ${data.sheetFailed} · 대기 ${data.sheetPending}` }
    : data.sheetPending ? { tone: "warn", value: `대기 ${data.sheetPending}건` } : { tone: "ok", value: "정상 · 큐 비어 있음" };
  const db: { tone: "ok" | "warn" | "bad" | "idle"; value: string } = !data ? { tone: "idle", value: "확인 중" }
    : data.errors.length ? { tone: "warn", value: `응답 ${data.latencyMs}ms · 일부 조회 실패` }
    : { tone: data.latencyMs < 400 ? "ok" : "warn", value: `응답 ${data.latencyMs}ms` };
  const totalProgress = data ? data.teamProgress.reduce((s, t) => s + t.total, 0) : 0;
  const doneProgress = data ? data.teamProgress.reduce((s, t) => s + t.done, 0) : 0;
  const pct = (done: number, total: number) => total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="space-y-5 pb-10">
      {/* ── 관제 패널 ── */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0B0F17] text-white shadow-[0_10px_40px_rgba(2,6,23,0.35)]">
        <div className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "linear-gradient(rgba(148,163,184,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,.6) 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
        <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-blue-600/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 right-0 h-80 w-80 rounded-full bg-violet-600/15 blur-3xl" />

        <div className="relative flex flex-col gap-4 border-b border-white/10 px-4 py-4 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10.5px] font-black tracking-[0.22em] text-blue-300"><Radio size={13} className="animate-pulse motion-reduce:animate-none" />FIRSTOA CS · LIVE OPERATIONS</div>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-mono text-[40px] font-black leading-none tabular-nums tracking-tight sm:text-[52px]">{clock}</span>
              <span className="text-sm font-bold text-slate-300">{dateLabel}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-black">
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-slate-200">{quarter}분기 운영 중</span>
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-slate-200">{weekNo}주차</span>
              {data && <span className="rounded-full bg-white/10 px-2.5 py-1 text-slate-200">CS 재직 {data.activeMembers}명</span>}
              {data && <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-emerald-300">갱신 {relTime(new Date(data.fetchedAt).toISOString())}</span>}
            </div>
          </div>
          <div className="grid w-full gap-2 sm:grid-cols-2 lg:w-auto lg:min-w-[560px]">
            <StatusPill tone={db.tone} icon={Database} label="데이터베이스" value={db.value} />
            <StatusPill tone={bot.tone} icon={Bot} label="카톡 전송 봇" value={bot.value} />
            <StatusPill tone={sheet.tone} icon={ShieldCheck} label="시트 동기화" value={sheet.value} />
            <StatusPill tone="ok" icon={Zap} label="최근 배포" value={patchGroups[0] ? `${patchGroups[0][0]} · ${patchGroups[0][1].length}건 반영` : "-"} />
          </div>
        </div>

        <div className="relative grid gap-3 px-4 py-4 sm:px-6 lg:grid-cols-12 lg:items-start">
          <div className="grid auto-rows-min gap-3 sm:grid-cols-2 lg:col-span-7">
            <Metric label="오늘 현장 기록" icon={Activity} accent="text-emerald-300"
              value={data ? fmtNum(data.todayInspections + data.todayAs) : "—"}
              sub={data ? `점검 ${data.todayInspections} · AS ${data.todayAs} · 이번 주 ${fmtNum(data.weekInspections + data.weekAs)}건` : loading ? "불러오는 중" : ""} />
            <Metric label="이번 주 방문" icon={Route} accent="text-blue-300"
              value={data ? fmtNum(data.weekVisits) : "—"}
              sub={data ? `${Math.round(data.weekMinutes / 60)}시간 현장 · 작성자 ${data.weekAuthors}명` : ""} />
            <Metric label="키맨·주소 변경 7일" icon={UsersRound} accent="text-amber-300"
              value={data ? fmtNum(data.keymanChanges7d) : "—"}
              sub={data ? (data.keymanGreetWaiting ? `인사 대기 ${data.keymanGreetWaiting}건 — 워킨맵에서 🤝` : "인사 대기 없음") : ""} />
            <Metric label="데이터 자산" icon={Camera} accent="text-violet-300"
              value={data ? fmtNum(data.totalRecords) : "—"}
              sub={data ? `점검·AS 기록 누적 · 사진 ${fmtNum(data.totalPhotos)}장` : ""} />
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4 sm:col-span-2">
              <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                <span>최근 7일 기록 추이</span>
                <span className="flex items-center gap-3 normal-case tracking-normal"><span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-blue-400" />점검</span><span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-violet-400" />AS</span></span>
              </div>
              <div className="mt-3">{data ? <Bars daily={data.daily} /> : <div className="h-16 animate-pulse rounded bg-white/[0.05]" />}</div>
            </div>
          </div>

          <div className="grid gap-3 lg:col-span-5">
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{quarter}분기 점검 진행률 <span className="normal-case tracking-normal text-slate-600">· 워킨맵 기준</span></span>
                <span className="text-[12px] font-black tabular-nums text-white">{data ? `${pct(doneProgress, totalProgress)}%` : "—"} <span className="text-slate-500">{data ? `${fmtNum(doneProgress)}/${fmtNum(totalProgress)}` : ""}</span></span>
              </div>
              <div className="mt-3 space-y-2.5">
                {(data?.teamProgress || ["A", "B", "C", "D"].map((team) => ({ team, done: 0, total: 0 }))).map((t) => (
                  <div key={t.team} className="flex items-center gap-3">
                    <span className="w-6 shrink-0 text-[12px] font-black text-slate-300">{t.team}팀</span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-400 transition-[width] duration-700" style={{ width: `${pct(t.done, t.total)}%` }} /></div>
                    <span className="w-24 shrink-0 text-right text-[11px] font-black tabular-nums text-slate-300">{pct(t.done, t.total)}% <span className="text-slate-500">{t.done}/{t.total}</span></span>
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => go("walkingMap")} className="mt-3 flex items-center gap-1 text-[11px] font-black text-blue-300 hover:text-white">워킨맵에서 색상별로 보기 <ArrowRight size={13} /></button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-white/10 bg-white/[0.04]">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:hidden" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" /></span>실시간 활동</span>
                <button type="button" onClick={() => void refresh()} className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[10.5px] font-black text-slate-300 transition hover:bg-white/20 hover:text-white"><RefreshCw size={11} />새로고침</button>
              </div>
              <ul className="max-h-[372px] divide-y divide-white/[0.06] overflow-y-auto">
                {(data?.recent || []).map((row) => (
                  <li key={`${row.구분}-${row.id}`} className="flex items-center gap-3 px-4 py-2">
                    <span className="w-[86px] shrink-0 whitespace-nowrap font-mono text-[10.5px] font-bold tabular-nums text-slate-500">{clockOf(row)}</span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black ${/AS/i.test(row.구분) ? "bg-violet-500/20 text-violet-200" : "bg-blue-500/20 text-blue-200"}`}>{row.구분 || "기록"}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-slate-100">{row.업체명}</span>
                    <span className="shrink-0 text-[11px] font-black text-slate-400">{row.작성자}{row.지역 ? ` · ${row.지역}` : ""}</span>
                  </li>
                ))}
                {!data && Array.from({ length: 6 }).map((_, i) => <li key={i} className="px-4 py-2.5"><div className="h-3.5 animate-pulse rounded bg-white/[0.06]" /></li>)}
                {data && !data.recent.length && <li className="px-4 py-6 text-center text-xs font-bold text-slate-500">기록이 없습니다</li>}
              </ul>
            </div>
          </div>
        </div>
        {data?.errors.length ? <div className="relative border-t border-amber-500/20 bg-amber-500/10 px-4 py-2 text-[11px] font-bold text-amber-200 sm:px-6">일부 지표를 못 불러왔습니다: {data.errors.slice(0, 3).join(" · ")}</div> : null}
      </section>

      {/* ── 바로 시작 ── */}
      <section>
        <div className="mb-2.5 flex items-end justify-between px-1"><h3 className="text-base font-black text-slate-950">바로 시작</h3><span className="text-[11px] font-semibold text-slate-500">현장과 이동 중 가장 자주 쓰는 메뉴</span></div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {primaryLinks.map((item) => {
            const Icon = item.icon;
            return <button key={item.key} type="button" onClick={() => go(item.key)} className="flex min-h-[84px] items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md active:translate-y-0"><span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${item.tone}`}><Icon size={21} strokeWidth={2.2} /></span><span className="min-w-0"><span className="block text-sm font-black text-slate-950">{item.title}</span><span className="mt-0.5 block text-[11px] font-semibold leading-4 text-slate-500">{item.desc}</span></span></button>;
          })}
        </div>
      </section>

      {/* ── 절약 효과 + 기능 한 줄 요약 ── */}
      <section className="grid gap-3 lg:grid-cols-12">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-4">
          <div className="flex items-center gap-2 text-[11px] font-black text-blue-600"><Clock3 size={14} />절약 효과</div>
          <div className="mt-3 space-y-2">
            {savings.map((s) => (
              <div key={s.task} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-[12.5px] font-black text-slate-800">{s.task}</span>
                <span className="flex items-center gap-1.5 text-[12px] font-black tabular-nums"><span className="text-slate-400 line-through decoration-slate-300">{s.before}</span><ArrowRight size={12} className="text-slate-300" /><span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">{s.after}</span></span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] font-semibold leading-5 text-slate-500">방문 1건당 약 10분+ · 한 번 입력이 양식·전송·집계로 이어집니다.</p>
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:col-span-8">
          <button type="button" aria-expanded={showAllMenus} onClick={() => setShowAllMenus(!showAllMenus)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-slate-50">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-white"><Sparkles size={17} /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-black text-slate-950">전체 기능 — 무엇이 편해지는지 한 줄씩</span><span className="block text-[11px] font-semibold text-slate-500">{workGroups.reduce((s, g) => s + g.items.length, 0)}개 화면 · 3개 영역</span></span>
            <ChevronDown size={17} className={`shrink-0 text-slate-400 transition ${showAllMenus ? "rotate-180" : ""}`} />
          </button>
          {showAllMenus && <div className="grid border-t border-slate-200 lg:grid-cols-3">{workGroups.map((group, index) => <div key={group.title} className={index ? "border-t border-slate-200 lg:border-l lg:border-t-0" : ""}><div className="bg-slate-50 px-4 py-2 text-[11px] font-black text-slate-500">{group.title}</div>{group.items.map((item) => <MenuRow key={item.key} item={item} onOpen={go} />)}</div>)}</div>}
        </div>
      </section>

      {/* ── 패치노트: 최신 날짜 3건만, 나머지는 접힘 ── */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white"><Zap size={15} /></span><div><h3 className="text-sm font-black text-slate-950">업데이트</h3><p className="text-[11px] font-semibold text-slate-500">현장 피드백 → 수정 → 자동 기록</p></div></div>
          <div className="flex items-center gap-1.5 text-[11px] font-black"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">누적 {PATCH_NOTES.length}건</span>{patchGroups[0] && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">최신 {patchGroups[0][0]}</span>}</div>
        </div>
        <ul className="divide-y divide-slate-100">
          {(patchExpanded ? patchGroups.slice(0, 8) : patchGroups.slice(0, 1)).map(([date, notes], gi) => (
            <li key={date} className="px-4 py-3 sm:px-5">
              <div className="flex items-center gap-2 text-[11px] font-black"><span className="rounded bg-slate-950 px-1.5 py-0.5 tabular-nums text-white">{date}</span>{gi === 0 && <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[9.5px] text-white">NEW</span>}<span className="text-slate-400">{notes.length}건</span></div>
              <ul className="mt-2 space-y-1">
                {(gi === 0 && !patchExpanded ? notes.slice(0, 3) : notes.slice(0, 6)).map((note) => <li key={note} className="flex gap-2 text-[12.5px] font-semibold leading-5 text-slate-700"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" /><span className="min-w-0 truncate" title={note}>{note}</span></li>)}
                {notes.length > (gi === 0 && !patchExpanded ? 3 : 6) && <li className="pl-3.5 text-[11px] font-bold text-slate-400">… 외 {notes.length - (gi === 0 && !patchExpanded ? 3 : 6)}건</li>}
              </ul>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setPatchExpanded(!patchExpanded)} className="flex w-full items-center justify-center gap-1.5 border-t border-slate-100 py-2.5 text-[11.5px] font-black text-slate-500 transition hover:bg-slate-50 hover:text-slate-900">{patchExpanded ? "접기" : "최근 배포 더 보기"}<ChevronDown size={14} className={`transition ${patchExpanded ? "rotate-180" : ""}`} /></button>
      </section>

      {/* ── 사용 안내 ── */}
      <section id="home-manual" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-950 px-4 py-3.5 text-white sm:px-5"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10"><BookOpen size={16} /></span><div><h3 className="text-sm font-black">사용 안내</h3><p className="text-[11px] font-semibold text-slate-400">처음 쓰는 분을 위한 4단계 — 자세한 건 사용설명서</p></div></div>
        <div className="divide-y divide-slate-100">
          {manuals.map((manual) => {
            const Icon = manual.icon; const open = openManual === manual.id;
            return <div key={manual.id}><button type="button" aria-expanded={open} onClick={() => setOpenManual(open ? "" : manual.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 sm:px-5"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${open ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}><Icon size={16} /></span><span className="min-w-0 flex-1"><span className="block text-[13px] font-black text-slate-950">{manual.title}</span><span className="block text-[11px] font-semibold text-slate-500">{manual.summary}</span></span><ChevronDown size={16} className={`shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} /></button>{open && <ol className="space-y-1.5 bg-slate-50 px-4 py-3 pl-[60px] sm:px-5 sm:pl-[64px]">{manual.steps.map((step, i) => <li key={step} className="flex gap-2 text-[12.5px] font-semibold leading-5 text-slate-700"><span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[9px] font-black text-white">{i + 1}</span>{step}</li>)}</ol>}</div>;
          })}
        </div>
      </section>

      <div className="flex items-center justify-center gap-2 text-[11px] font-bold text-slate-400"><Plus size={12} />새 기능 제안은 팀장·개발 담당에게 — 반영되면 위 업데이트에 자동으로 올라옵니다</div>
    </div>
  );
}
