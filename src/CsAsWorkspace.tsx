import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteRows, selectAllRows, upsertRow, upsertRows } from "./supabase";
import { isMobileDevice, kakaoMapSearchLink, naverMapLink } from "./navApp";
import { getServiceReceptionById, setServiceReceptionStatus, type ServiceReceptionRow } from "./api";
import { getVendorFlagsBatch, type VendorWorkFlags } from "./vendorFlags";

type Team = "A" | "B" | "C" | "D";
type AsStatus = "접수" | "배정" | "완료" | "익일";
type ScheduleType = "AS" | "익일AS" | "물류" | "휴가" | "매월점검";
type ScheduleFilter = ScheduleType;
type ViewMode = "list" | "calendar";
type DayFilter = "today" | "tomorrow" | "scheduled";

export type AsTicket = {
  id: string;
  team: Team;
  date: string;
  time: string;
  vendor: string;
  contact: string;
  address: string;
  department: string;
  model: string;
  serial: string;
  asset: string;
  grade: string;
  keyman: string;
  receptionId: string;
  repeatMonthly?: boolean; // 매월 반복 — 완료하면 다음 달 같은 날로 자동 생성
  issue: string;
  note?: string; // 내용 — 처리 결과·점검/AS 양식이 쌓이는 칸
  assignee: string;
  status: AsStatus;
  scheduleType: ScheduleType;
  naverPushedAt?: string | null;   // 네이버 캘린더로 보낸 시각 (중복 등록 방지용)
};

const teams: Team[] = ["A", "B", "C", "D"];
const scheduleFilters: ScheduleFilter[] = ["AS", "익일AS", "물류", "휴가", "매월점검"];
const teamAssignees: Record<Team, string[]> = {
  A: ["김정민", "심태현", "정웅만", "신정훈"],
  B: ["권태혁", "조윤", "윤기준", "신정훈"],
  C: ["이홍진", "박영현", "이민구", "한왕주", "신정훈"],
  D: ["양승원", "김종희", "이호준", "신정훈"],
};

const storageKey = "cs_as_tickets_v4";
// 날짜는 호출 시점마다 계산한다 — 모듈 로드 시 고정하면 자정 이후 금일/익일 분류가 전부 어긋난다.
const getTodayYmd = () => formatDate(new Date());
const getTomorrowYmd = () => nextBusinessDay(getTodayYmd());

// 옛 데모 시드 티켓 id — 로컬 → 서버 이관 시 제외한다.
const SEED_IDS = new Set(["as-1", "as-2", "as-3", "as-4"]);

function formatDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00+09:00`);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

function nextBusinessDay(date: string) {
  let next = addDays(date, 1);
  while ([0, 6].includes(new Date(`${next}T12:00:00+09:00`).getDay())) next = addDays(next, 1);
  return next;
}

function addMonths(date: string, months: number) {
  const d = new Date(`${date}T12:00:00+09:00`);
  d.setMonth(d.getMonth() + months);
  return formatDate(d);
}

function monthStart(date: string) {
  return `${date.slice(0, 7)}-01`;
}

function monthGrid(date: string) {
  const first = new Date(`${monthStart(date)}T12:00:00+09:00`);
  const gridStart = addDays(formatDate(first), -first.getDay());
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

function normalizeTicketSchedule(ticket: AsTicket): AsTicket {
  if (ticket.scheduleType === "물류" || ticket.scheduleType === "휴가" || ticket.scheduleType === "매월점검") return ticket;
  const isFuture = ticket.date > getTodayYmd();
  const nextStatus = ticket.status === "완료"
    ? "완료"
    : isFuture
      ? "익일"
      : ticket.status === "익일"
        ? (ticket.assignee ? "배정" : "접수")
        : ticket.status;
  return { ...ticket, scheduleType: isFuture ? "익일AS" : "AS", status: nextStatus };
}

// 다음 달 같은 일자 (31일 → 다음 달 말일로 보정)
export function nextMonthSameDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const lastDay = new Date(y, m + 1, 0).getDate(); // 다음 달 말일
  const day = Math.min(d, lastDay);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// 매월 반복 티켓 완료 시 다음 달 일정 행 생성 (일정리스트·FIELD 전송 팝업 공용)
export function buildMonthlyCloneRow(ticket: Record<string, unknown>, targetDate?: string): Record<string, unknown> {
  const base = ticket as unknown as AsTicket;
  const date = targetDate || nextMonthSameDay(base.date);
  const kind = base.scheduleType === "익일AS" ? "AS" : base.scheduleType;
  return {
    // 결정적 id: 같은 업체·유형·날짜 반복 일정은 어느 기기가 만들어도 같은 행으로 upsert된다
    id: `rep|${base.vendor.trim()}|${kind}|${date}`,
    team: base.team, date, time: base.time,
    vendor: base.vendor, contact: base.contact, address: base.address, department: base.department,
    model: base.model, serial: base.serial, asset: base.asset || "", grade: base.grade || "",
    keyman: base.keyman || "", receptionId: "", repeatMonthly: true,
    issue: base.issue, note: "", assignee: base.assignee,
    status: base.assignee ? "배정" : "접수",
    scheduleType: base.scheduleType === "익일AS" ? "AS" : base.scheduleType,
  };
}

// 반복 시리즈 지평선: 각 매월 반복 그룹(업체+유형)의 마지막 일정에서 오늘+11개월까지 이어 붙일 행을 계산.
// 새로고침 때마다 부족분만 만들어 반복이 무기한 이어진다. 중간에 지운 달은 되살리지 않는다(마지막 일정 이후만 연장).
export function buildSeriesExtensionRows(list: AsTicket[], todayYmd: string): Record<string, unknown>[] {
  const existing = new Set(list.map((t) => `${seriesGroupOf(t)}|${t.date}`));
  const [ty, tm] = todayYmd.split("-").map(Number);
  const horizonTotal = ty * 12 + (tm - 1) + 11;
  const horizonYm = `${Math.floor(horizonTotal / 12)}-${String((horizonTotal % 12) + 1).padStart(2, "0")}`;
  const latest = new Map<string, AsTicket>();
  for (const t of list) {
    if (!t.repeatMonthly || !t.vendor.trim()) continue;
    const g = seriesGroupOf(t);
    const prev = latest.get(g);
    if (!prev || t.date > prev.date) latest.set(g, t);
  }
  const rows: Record<string, unknown>[] = [];
  for (const tail of latest.values()) {
    let date = tail.date;
    for (let guard = 0; guard < 24; guard++) {
      date = nextMonthSameDay(date);
      if (date.slice(0, 7) > horizonYm) break;
      const key = `${seriesGroupOf(tail)}|${date}`;
      if (existing.has(key)) continue;
      existing.add(key);
      rows.push(buildMonthlyCloneRow(tail as unknown as Record<string, unknown>, date));
    }
  }
  return rows;
}

// 캘린더 필터를 이 기기에 저장 — 앱 재진입·탭 이동에도 체크 상태 유지
function loadStoredFilter<T extends string>(key: string, allowed: readonly T[], fallback: T[]): T[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    if (Array.isArray(parsed)) return parsed.filter((item): item is T => allowed.includes(item as T));
  } catch { /* 저장값 손상 시 기본값 */ }
  return fallback;
}

// 매월 반복 시리즈 식별 키: 업체 + 업무종류
function seriesGroupOf(t: { vendor: string; scheduleType: string }): string {
  return `${t.vendor.trim()}|${t.scheduleType === "익일AS" ? "AS" : t.scheduleType}`;
}

function dayNumberColor(index: number, inMonth: boolean): string {
  const dow = index % 7; // 달력 그리드는 일요일 시작
  if (!inMonth) return dow === 0 ? "text-rose-300" : dow === 6 ? "text-blue-300" : "text-slate-300";
  return dow === 0 ? "text-rose-500" : dow === 6 ? "text-blue-600" : "text-slate-700";
}

// 일정 기본 조회 범위: 오늘 기준 6개월 전 1일부터 (그보다 과거 달은 캘린더에서 열람할 때 그 달만 로드)
function ticketWindowStart(todayYmd: string): string {
  const [y, m] = todayYmd.split("-").map(Number);
  const total = y * 12 + (m - 1) - 6;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

function kstNowHM() {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
}

function blankTicket(date: string, overrides: Partial<AsTicket> = {}): AsTicket {
  return {
    id: `as-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    team: "A",
    date,
    time: kstNowHM(),
    vendor: "",
    contact: "",
    address: "",
    department: "",
    model: "",
    serial: "",
    asset: "",
    grade: "",
    keyman: "",
    receptionId: "",
    repeatMonthly: false,
    issue: "",
    note: "",
    assignee: "",
    status: "접수",
    scheduleType: "AS",
    ...overrides,
  };
}

// 이 기기 캐시(localStorage) — 서버 응답 전 첫 화면과 오프라인 대비용.
function loadTickets(): AsTicket[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || "null");
    return Array.isArray(parsed) ? parsed.map((ticket: Omit<Partial<AsTicket>, "status"> & { status?: string }) => normalizeTicketSchedule({
      asset: "",
      grade: "",
      keyman: "",
      receptionId: "",
      ...ticket,
      status: ticket.status === "미루기" ? "익일" : (ticket.status || "접수"),
      scheduleType: ticket.scheduleType || (ticket.status === "미루기" || ticket.status === "익일" ? "익일AS" : "AS"),
    } as AsTicket)) : [];
  } catch {
    return [];
  }
}

const TICKET_COLUMNS = "id,team,date,time,vendor,contact,address,department,model,serial,asset,grade,keyman,receptionId,repeatMonthly,issue,note,assignee,status,scheduleType,naverPushedAt";
// 서버 저장용 — 옛 로컬 JSON에 섞인 여분 속성이 올라가지 않게 정해진 필드만 뽑는다.
function toDbRow(t: AsTicket) {
  return { id: t.id, team: t.team, date: t.date, time: t.time, vendor: t.vendor, contact: t.contact, address: t.address, department: t.department, model: t.model, serial: t.serial, asset: t.asset || "", grade: t.grade || "", keyman: t.keyman || "", receptionId: t.receptionId || "", repeatMonthly: !!t.repeatMonthly, issue: t.issue, note: t.note || "", assignee: t.assignee, status: t.status, scheduleType: t.scheduleType };
}

// 이 기기에만 있던 일정을 1회 서버로 올린다(성공해야 플래그 기록 → 실패 시 다음 진입에서 재시도).
const migratedKey = "cs_as_tickets_migrated_v1";
async function migrateLocalOnce() {
  try {
    if (localStorage.getItem(migratedKey)) return;
    const local = loadTickets().filter((ticket) => !SEED_IDS.has(ticket.id));
    if (local.length) await upsertRows("as_tickets", local.map(toDbRow), "id");
    localStorage.setItem(migratedKey, "1");
  } catch {
    // 서버 연결 실패 — 다음 로드에서 재시도
  }
}

// 워킨맵·FIELD와 같은 기준의 점검·미수·재계약 상태 배지 — AS 나가는 김에 함께 처리할 일을 바로 보이게.
function VendorFlagBadges({ flags }: { flags: VendorWorkFlags | undefined }) {
  if (!flags) return null;
  const misuBalance = flags.misu ? (flags.misu.balance.replace(/[^\d]/g, "") ? `${Number(flags.misu.balance.replace(/[^\d]/g, "")).toLocaleString()}원` : flags.misu.balance) : "";
  return (
    <span className="flex flex-wrap gap-1">
      {flags.inspection && (flags.inspection.done
        ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-600">점검완료</span>
        : flags.inspection.carried
          ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">점검 다음분기</span>
          : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-800">{flags.inspection.quarter}분기 점검</span>)}
      {flags.misu && (flags.misu.cleared
        ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">미수 완납</span>
        : <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black text-rose-700">미수{flags.misu.months ? ` ${flags.misu.months}개월` : ""}{misuBalance ? ` ${misuBalance}` : ""}</span>)}
      {flags.renewal && (flags.renewal.done
        ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">재계약 완료</span>
        : <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-black text-rose-600">재계약{flags.renewal.due ? ` · 종료 ${flags.renewal.due}` : ""}</span>)}
    </span>
  );
}

// "서울 강남구 삼성로100길 8 202호" → "강남구 삼성로100길" (표에는 지역 요약만)
function shortAddress(address: string) {
  const m = String(address || "").match(/([가-힣]+(?:구|군|시))\s+([가-힣A-Za-z0-9·]+(?:대로|로|길)[0-9]*(?:번?길)?)/);
  return m ? `${m[1]} ${m[2]}` : "";
}
function AddrNav({ address }: { address: string }) {
  if (!address.trim()) return null;
  const target = address.trim();
  const q = encodeURIComponent(target);
  const linkClass = "rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-black";
  return (
    <span className="flex shrink-0 gap-1">
      <a href={naverMapLink(target)} {...(isMobileDevice ? {} : { target: "_blank", rel: "noreferrer" })} className={`${linkClass} text-emerald-600`}>N</a>
      <a href={kakaoMapSearchLink(target)} {...(isMobileDevice ? {} : { target: "_blank", rel: "noreferrer" })} className={`${linkClass} text-amber-600`}>K</a>
      <a href={`tmap://search?name=${q}`} className={`${linkClass} text-blue-600`}>T</a>
    </span>
  );
}

function statusClass(status: AsStatus) {
  if (status === "완료") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "익일") return "border-purple-200 bg-purple-50 text-purple-700";
  if (status === "배정") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function scheduleColor(type: ScheduleType, completed = false) {
  if (completed) return "bg-slate-100 text-slate-400 line-through";
  if (type === "익일AS") return "bg-purple-100 text-purple-700";
  if (type === "물류") return "bg-rose-100 text-rose-700";
  if (type === "휴가") return "bg-emerald-100 text-emerald-700";
  if (type === "매월점검") return "bg-amber-100 text-amber-700";
  return "bg-blue-100 text-blue-700";
}

function buildFieldAsText(ticket: AsTicket, author: string) {
  // 접수 보고양식을 FIELD에 복붙했을 때(formatPrinterReport)와 완전히 같은 형식.
  return [
    `작성자:${author || ticket.assignee || ""}`,
    "구분:A/S",
    "레벨:1",
    `등급:${ticket.grade || ""}`,
    `업체명:${ticket.vendor}`,
    `부서명:${ticket.department}`,
    `지역:${ticket.team}`,
    `키맨/접수자:${ticket.contact}`,
    ...(ticket.keyman ? ticket.keyman.split("\n") : []),
    "ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ",
    "1.",
    `모델명:${ticket.model}`,
    `시리얼넘버:${ticket.serial}`,
    `자산기번: ${ticket.asset || ""}`,
    `내용: ${ticket.issue}`,
    "처리내용:",
    "매수:흑- 컬- 큰컬- 합-",
    "토너잔량:K- C- M- Y-",
    "폐통:  %",
    "여분:  K- C- M- Y- 폐-",
    "한틴이카유무:",
    "주차비지원유무:",
    "특이사항:",
    "ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ",
    "※부품신청※",
    "보증기간 내 여부 :",
    "교체 전 카운터 누적 사용매수 :",
    "사용 부품 예상 사용매수 :",
    "▶ 신청 부품",
    "물품명:",
    "수량:",
    "출고여부:",
    "ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ",
    "※자가신청※",
    "물품:",
    "수량:",
    "출고여부:",
    "ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ",
    "도착 시간:",
    "소요 시간:",
  ].join("\n");
}

export function CsCalendar() {
  return <CsAsWorkspace view="calendar" />;
}

export function AsReception({ author, onUseField }: { author: string; onUseField: (fieldText: string, ticket?: { id: string; receptionId?: string; vendor?: string }) => void }) {
  return <CsAsWorkspace view="as" author={author} onUseField={onUseField} />;
}

function CsAsWorkspace({ view, author = "", onUseField }: { view: "calendar" | "as"; author?: string; onUseField?: (fieldText: string, ticket?: { id: string; receptionId?: string; vendor?: string }) => void }) {
  const todayYmd = getTodayYmd();
  const tomorrowYmd = getTomorrowYmd();
  const [, setDateTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => { if (getTodayYmd() !== todayYmd) setDateTick((tick) => tick + 1); }, 60_000);
    return () => window.clearInterval(timer);
  }, [todayYmd]);
  const [tickets, setTicketsState] = useState<AsTicket[]>(loadTickets);
  const [syncError, setSyncError] = useState("");

  // 서버(as_tickets)가 원본 — 진입·포커스 복귀·60초 주기로 새로 읽어 팀원 변경분을 반영한다.
  const refreshTickets = useCallback(async () => {
    if (pendingWritesRef.current > 0) return; // 저장/삭제 반영 중 — 다음 주기에 새로고침
    try {
      const windowStart = ticketWindowStart(getTodayYmd());
      const rows = await selectAllRows<AsTicket>("as_tickets", `select=${TICKET_COLUMNS}&date=gte.${windowStart}&order=date.asc,time.asc`);
      let normalized = rows.map((row) => normalizeTicketSchedule(row));
      // 매월 반복 그룹을 오늘+11개월까지 자동 연장 (부족분만 생성 — 반복이 무기한 이어짐)
      const extension = buildSeriesExtensionRows(normalized, getTodayYmd());
      if (extension.length) {
        normalized = [...normalized, ...extension.map((row) => normalizeTicketSchedule(row as unknown as AsTicket))];
        void upsertRows("as_tickets", extension, "id").catch(() => { /* 다음 새로고침에서 재시도 */ });
      }
      // 과거 달 열람으로 이미 로드한 옛 일정은 유지한 채 최신 범위만 갱신
      setTicketsState((current) => {
        const fresh = new Set(normalized.map((row) => row.id));
        const older = current.filter((row) => row.date < windowStart && !fresh.has(row.id));
        return [...older, ...normalized];
      });
      try { localStorage.setItem(storageKey, JSON.stringify(normalized)); } catch { /* 캐시 실패 무시 */ }
      setSyncError("");
    } catch {
      setSyncError("일정 서버에 연결하지 못해 이 기기에 저장된 사본을 보여주는 중입니다.");
    }
  }, []);
  useEffect(() => {
    void migrateLocalOnce().then(refreshTickets);
    const onFocus = () => { void refreshTickets(); };
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => { void refreshTickets(); }, 60_000);
    return () => { window.removeEventListener("focus", onFocus); window.clearInterval(timer); };
  }, [refreshTickets]);

  const [vendorFlags, setVendorFlags] = useState<Map<string, VendorWorkFlags>>(new Map());
  useEffect(() => {
    const vendors = Array.from(new Set(tickets.map((ticket) => ticket.vendor.trim()).filter(Boolean)));
    if (!vendors.length) { setVendorFlags(new Map()); return; }
    let active = true;
    getVendorFlagsBatch(vendors)
      .then((flags) => { if (active) setVendorFlags(flags); })
      .catch(() => { /* 배지 조회 실패는 조용히 넘어간다 — 일정 자체 기능엔 영향 없음 */ });
    return () => { active = false; };
  }, [tickets]);

  // 저장·삭제가 서버에 닿기 전에 focus 새로고침이 옛 데이터를 다시 그려
  // "지운 일정이 잠깐 되살아나는" 버벅임이 있었다 — 쓰기 진행 중엔 새로고침을 미룬다.
  const pendingWritesRef = useRef(0);
  const trackWrite = async (work: Promise<unknown>, failMessage: string) => {
    pendingWritesRef.current += 1;
    try {
      await work;
    } catch {
      setSyncError(failMessage);
    } finally {
      pendingWritesRef.current -= 1;
    }
  };
  // 매월 반복 일정: 저장 즉시 앞으로 11개월치를 미리 만들어 달마다 달력에 보이게 한다.
  // (같은 업체·유형·날짜가 이미 있으면 건너뛰어 중복 생성 방지)
  const seriesKey = (t: { vendor: string; date: string; scheduleType: string }) =>
    `${t.vendor.trim()}|${t.date}|${t.scheduleType === "익일AS" ? "AS" : t.scheduleType}`;
  const ensureMonthlySeries = (base: AsTicket) => {
    const existing = new Set(tickets.map((t) => seriesKey(t)));
    existing.add(seriesKey(base));
    const rows: Record<string, unknown>[] = [];
    let date = base.date;
    for (let k = 0; k < 11; k++) {
      date = nextMonthSameDay(date);
      const row = buildMonthlyCloneRow(base as unknown as Record<string, unknown>, date);
      const key = seriesKey(row as unknown as AsTicket);
      if (existing.has(key)) continue;
      existing.add(key);
      rows.push(row);
    }
    if (!rows.length) return;
    setTicketsState((current) => [...current, ...rows.map((row) => normalizeTicketSchedule(row as unknown as AsTicket))]);
    void trackWrite(upsertRows("as_tickets", rows, "id"), "반복 일정 생성 실패 — 새로고침 후 다시 시도해 주세요.");
  };

  const persistRemote = (ticket: AsTicket) => {
    void trackWrite(upsertRow("as_tickets", toDbRow(ticket), "id"), "일정 서버 저장에 실패했습니다 — 네트워크 확인 후 다시 수정해 주세요.");
  };
  const removeRemote = (id: string) => {
    void trackWrite(deleteRows("as_tickets", `id=eq.${encodeURIComponent(id)}`), "일정 서버 삭제에 실패했습니다 — 네트워크 확인 후 다시 시도해 주세요.");
  };
  const [team, setTeam] = useState<Team | "ALL">(() => loadStoredFilter<Team | "ALL">("cs_as_team_filter_v1", [...teams, "ALL"], ["ALL"])[0] || "ALL");
  const [visibleScheduleTypes, setVisibleScheduleTypes] = useState<ScheduleFilter[]>(() => loadStoredFilter("cs_calendar_types_v1", scheduleFilters, scheduleFilters));
  const [visibleTeams, setVisibleTeams] = useState<Team[]>(() => loadStoredFilter("cs_calendar_teams_v1", teams, teams));
  useEffect(() => { try { localStorage.setItem("cs_as_team_filter_v1", JSON.stringify([team])); } catch { /* 저장 실패 무시 */ } }, [team]);
  useEffect(() => { try { localStorage.setItem("cs_calendar_types_v1", JSON.stringify(visibleScheduleTypes)); } catch { /* 저장 실패 무시 */ } }, [visibleScheduleTypes]);
  useEffect(() => { try { localStorage.setItem("cs_calendar_teams_v1", JSON.stringify(visibleTeams)); } catch { /* 저장 실패 무시 */ } }, [visibleTeams]);
  const [viewMode, setViewMode] = useState<ViewMode>("calendar");
  const [currentMonth, setCurrentMonth] = useState(monthStart(todayYmd));
  const [mobileSelectedDate, setMobileSelectedDate] = useState(todayYmd);
  const [calendarFiltersOpen, setCalendarFiltersOpen] = useState(false);
  const [dayFilter, setDayFilter] = useState<DayFilter>("today");
  const [editId, setEditId] = useState("");
  const [newTicket, setNewTicket] = useState<AsTicket | null>(null);
  const [deferId, setDeferId] = useState("");
  const [detailId, setDetailId] = useState("");
  const [dupTicketId, setDupTicketId] = useState("");
  const [dupDate, setDupDate] = useState(getTodayYmd());
  const dupTicket = tickets.find((ticket) => ticket.id === dupTicketId);

  const duplicateTicket = (ticket: AsTicket, date: string) => {
    const copy: AsTicket = {
      ...ticket,
      id: `as-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      date,
      status: ticket.assignee ? "배정" : "접수",
      scheduleType: ticket.scheduleType === "익일AS" ? "AS" : ticket.scheduleType,
      receptionId: "",
    };
    const normalized = normalizeTicketSchedule(copy);
    setTickets([...tickets, normalized]);
    persistRemote(normalized);
    setDupTicketId("");
  };
  const [detailReception, setDetailReception] = useState<ServiceReceptionRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [customDate, setCustomDate] = useState(tomorrowYmd);

  const editTicket = tickets.find((ticket) => ticket.id === editId);
  const detailTicket = tickets.find((ticket) => ticket.id === detailId);
  useEffect(() => {
    setDetailReception(null);
    const receptionId = tickets.find((ticket) => ticket.id === detailId)?.receptionId;
    if (!receptionId) return;
    let active = true;
    setDetailLoading(true);
    getServiceReceptionById(receptionId)
      .then((row) => { if (active) setDetailReception(row); })
      .catch(() => { /* 원본 조회 실패 시 일정 정보만 표시 */ })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailId]);
  const deferTicket = tickets.find((ticket) => ticket.id === deferId);

  const setTickets = (next: AsTicket[]) => {
    setTicketsState(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // localStorage가 막힌 환경에서는 현재 화면 상태만 유지합니다.
    }
  };

  // 매월 반복 중지: 이후(오늘 이후 날짜) 미완료 반복 일정을 지우고, 지난 일정들의 반복 플래그도 꺼서
  // 새로고침 자동 연장이 시리즈를 되살리지 않게 한다.
  const stopMonthlySeries = (base: AsTicket) => {
    const g = seriesGroupOf(base);
    const members = tickets.filter((t) => t.id !== base.id && seriesGroupOf(t) === g && t.repeatMonthly);
    if (!members.length) return;
    const future = members.filter((t) => t.date > base.date && t.status !== "완료");
    if (future.length && !window.confirm(`매월 반복을 중지할까요?\n예정된 반복 일정 ${future.length}건이 함께 삭제됩니다.`)) return;
    const futureIds = new Set(future.map((t) => t.id));
    const rest = members.filter((t) => !futureIds.has(t.id)).map((t) => ({ ...t, repeatMonthly: false }));
    const restIds = new Set(rest.map((t) => t.id));
    setTicketsState((current) => current.filter((t) => !futureIds.has(t.id)).map((t) => (restIds.has(t.id) ? { ...t, repeatMonthly: false } : t)));
    for (const t of future) void trackWrite(deleteRows("as_tickets", `id=eq.${encodeURIComponent(t.id)}`), "반복 일정 삭제 실패 — 새로고침 후 다시 시도해 주세요.");
    if (rest.length) void trackWrite(upsertRows("as_tickets", rest.map(toDbRow), "id"), "반복 중지 저장 실패 — 새로고침 후 다시 시도해 주세요.");
  };

  const update = (id: string, patch: Partial<AsTicket>) => {
    const before = tickets.find((ticket) => ticket.id === id);
    const next = tickets.map((ticket) => (ticket.id === id ? normalizeTicketSchedule({ ...ticket, ...patch }) : ticket));
    setTickets(next);
    const changed = next.find((ticket) => ticket.id === id);
    if (changed) persistRemote(changed);
    if (changed?.repeatMonthly && before && !before.repeatMonthly) ensureMonthlySeries(changed);
    if (changed && before?.repeatMonthly && !changed.repeatMonthly) stopMonthlySeries(changed);
    // 서비스접수에서 넘어온 일정이면 처리 상태를 접수 현황에도 반영 (완료/익일/접수)
    if (changed && before && changed.receptionId && changed.status !== before.status) {
      const mapped = changed.status === "완료" ? "완료" : changed.status === "익일" ? "익일" : "접수";
      void setServiceReceptionStatus(changed.receptionId, mapped).catch(() => { /* 접수 동기화 실패는 일정 기능에 영향 없음 */ });
    }
  };

  // 담당자 배정 팝업: 배정 버튼 → 팀원 이름 선택
  const [assignId, setAssignId] = useState("");
  const assignTicket = tickets.find((t) => t.id === assignId) || null;
  const applyAssign = (ticket: AsTicket, name: string) => {
    update(ticket.id, { assignee: name, status: name && ticket.status === "접수" ? "배정" : !name && ticket.status === "배정" ? "접수" : ticket.status });
    setAssignId("");
  };

  // 매월 반복 일정 날짜 이동: 다른 반복 건이 있으면 "이 일정만/전체" 선택 팝업을 띄운다
  const [moveTarget, setMoveTarget] = useState<{ ticket: AsTicket; date: string } | null>(null);
  const seriesOthers = (base: AsTicket) =>
    tickets.filter((t) => t.id !== base.id && seriesGroupOf(t) === seriesGroupOf(base) && t.repeatMonthly && t.status !== "완료");
  const requestMoveDate = (id: string, date: string) => {
    const ticket = tickets.find((t) => t.id === id);
    if (!ticket || ticket.date === date) return;
    if (ticket.repeatMonthly && seriesOthers(ticket).length) setMoveTarget({ ticket, date });
    else update(id, { date });
  };
  // 전체 이동: 미완료 반복 건 전부를 각자 달의 새 일자(예: 매월 5일 → 매월 8일)로 옮긴다. 완료된 지난 기록은 그대로 둔다.
  const applyMoveAll = (base: AsTicket, newDate: string) => {
    const day = Number(newDate.slice(8, 10));
    const g = seriesGroupOf(base);
    const moved = tickets
      .filter((t) => seriesGroupOf(t) === g && t.repeatMonthly && t.status !== "완료")
      .map((t) => {
        if (t.id === base.id) return { ...t, date: newDate };
        const [y, m] = t.date.split("-").map(Number);
        const d = Math.min(day, new Date(y, m, 0).getDate());
        return { ...t, date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
      });
    const movedIds = new Map(moved.map((t) => [t.id, t]));
    setTicketsState((current) => current.map((t) => movedIds.get(t.id) ?? t));
    void trackWrite(upsertRows("as_tickets", moved.map(toDbRow), "id"), "반복 일정 이동 저장 실패 — 새로고침 후 다시 시도해 주세요.");
  };

  // 네이버 캘린더로 보내기 — 네이버 API는 '등록'만 지원해 단방향이다.
  // 반복 일정이 수백 건이라 자동 전량 전송은 하지 않고, 이 버튼으로 고른 건만 보낸다.
  const [naverBusyId, setNaverBusyId] = useState("");
  const sendToNaver = async (ticket: AsTicket) => {
    if (naverBusyId) return;
    if (ticket.naverPushedAt && !window.confirm("이미 네이버 캘린더에 등록한 일정입니다. 한 번 더 등록할까요?")) return;
    setNaverBusyId(ticket.id);
    try {
      const [hour, minute] = (ticket.time || "09:00").split(":").map(Number);
      const endHour = Math.min(23, (Number.isFinite(hour) ? hour : 9) + 1);
      const response = await fetch("/api/naver-add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `[${ticket.scheduleType}] ${ticket.vendor || "일정"}`,
          date: ticket.date,
          location: ticket.address || "",
          description: [
            ticket.issue && `내용: ${ticket.issue}`,
            ticket.model && `기기: ${ticket.model}${ticket.serial ? ` / ${ticket.serial}` : ""}`,
            `팀/담당: ${ticket.team}팀 ${ticket.assignee || "미배정"}`,
            ticket.contact && `연락처: ${ticket.contact}`,
            ticket.note,
          ].filter(Boolean).join("\n"),
          startTime: ticket.time || "",
          endTime: ticket.time ? `${String(endHour).padStart(2, "0")}:${String(Number.isFinite(minute) ? minute : 0).padStart(2, "0")}` : "",
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { window.alert(`네이버 캘린더 등록 실패: ${result.error || response.status}${result.detail ? `\n${result.detail}` : ""}`); return; }
      const pushedAt = new Date().toISOString();
      setTicketsState((current) => current.map((item) => (item.id === ticket.id ? { ...item, naverPushedAt: pushedAt } : item)));
      void upsertRow("as_tickets", { id: ticket.id, naverPushedAt: pushedAt }, "id").catch(() => {});
      window.alert("네이버 캘린더에 등록했습니다.");
    } catch (e) {
      window.alert(`네이버 캘린더 등록 실패: ${(e as Error).message}`);
    } finally {
      setNaverBusyId("");
    }
  };

  const removeTicket = (ticket: AsTicket) => {
    if (!window.confirm(`${ticket.vendor || "이 일정"}을 삭제할까요?`)) return false;
    setTickets(tickets.filter((item) => item.id !== ticket.id));
    removeRemote(ticket.id);
    setEditId("");
    return true;
  };

  const toggleDone = (ticket: AsTicket) => {
    const completing = ticket.status !== "완료";
    update(ticket.id, { status: completing ? "완료" : (ticket.assignee ? "배정" : "접수") });
    // 매월 반복: 다음 달 일정이 아직 없으면 만들어 시리즈 말단을 연장한다 (있으면 건너뜀)
    if (completing && ticket.repeatMonthly) {
      const clone = buildMonthlyCloneRow(ticket as unknown as Record<string, unknown>);
      const key = seriesKey(clone as unknown as AsTicket);
      if (!tickets.some((t) => seriesKey(t) === key)) {
        setTicketsState((current) => [...current, normalizeTicketSchedule(clone as unknown as AsTicket)]);
        void trackWrite(upsertRow("as_tickets", clone, "id"), "반복 일정 생성 실패 — 새로고침 후 확인해 주세요.");
      }
    }
  };

  const openDefer = (ticket: AsTicket) => {
    setDeferId(ticket.id);
    setCustomDate(tomorrowYmd);
  };

  const applyDefer = (date: string) => {
    if (!deferTicket || !date) return;
    const isAsSchedule = deferTicket.scheduleType === "AS" || deferTicket.scheduleType === "익일AS";
    update(deferTicket.id, { date, status: isAsSchedule ? "익일" : deferTicket.status, scheduleType: isAsSchedule ? "익일AS" : deferTicket.scheduleType });
    setDeferId("");
  };

  const targetDate = dayFilter === "today" ? todayYmd : tomorrowYmd;
  const scheduleRows = tickets.filter((ticket) => {
    if (team !== "ALL" && ticket.team !== team) return false;
    if (dayFilter === "today") return ticket.date === todayYmd;
    if (dayFilter === "tomorrow") return ticket.date === tomorrowYmd;
    return ticket.date > todayYmd && ticket.date !== tomorrowYmd;
  });

  // 기본 조회 범위(6개월) 이전 달을 캘린더에서 열면 그 달 일정만 추가 로드
  const loadedOldMonthsRef = useRef(new Set<string>());
  useEffect(() => {
    const ym = currentMonth.slice(0, 7);
    if (`${ym}-01` >= ticketWindowStart(getTodayYmd()) || loadedOldMonthsRef.current.has(ym)) return;
    loadedOldMonthsRef.current.add(ym);
    void selectAllRows<AsTicket>("as_tickets", `select=${TICKET_COLUMNS}&date=gte.${ym}-01&date=lte.${ym}-31&order=date.asc,time.asc`)
      .then((rows) => setTicketsState((current) => {
        const ids = new Set(current.map((row) => row.id));
        return [...rows.filter((row) => !ids.has(row.id)).map((row) => normalizeTicketSchedule(row)), ...current];
      }))
      .catch(() => { loadedOldMonthsRef.current.delete(ym); });
  }, [currentMonth]);

  const calendarDays = useMemo(() => monthGrid(currentMonth), [currentMonth]);
  const visibleTickets = useMemo(
    () => tickets.filter((ticket) => {
      return visibleTeams.includes(ticket.team) && visibleScheduleTypes.includes(ticket.scheduleType);
    }),
    [tickets, visibleScheduleTypes, visibleTeams],
  );
  const monthTickets = visibleTickets.filter((ticket) => ticket.date.slice(0, 7) === currentMonth.slice(0, 7));

  // 일정 추가 기본값: 캘린더에서 체크된 팀·업무종류 중 첫 값 (예: B팀+매월점검만 켜두면 그대로 미리 채움)
  const newTicketDefaults = (): Partial<AsTicket> => ({
    team: teams.find((item) => visibleTeams.includes(item)) || "A",
    scheduleType: scheduleFilters.find((item) => visibleScheduleTypes.includes(item)) || "AS",
  });

  const toggleScheduleFilter = (filter: ScheduleFilter) => {
    setVisibleScheduleTypes((current) => current.includes(filter) ? current.filter((item) => item !== filter) : [...current, filter]);
  };

  const toggleVisibleTeam = (calendarTeam: Team) => {
    setVisibleTeams((current) => current.includes(calendarTeam) ? current.filter((item) => item !== calendarTeam) : [...current, calendarTeam]);
  };

  const renderTicketCard = (ticket: AsTicket) => (
    <button key={ticket.id} type="button" onClick={() => setDetailId(ticket.id)} className="block w-full rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-blue-300 hover:bg-blue-50/40">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-black text-slate-900">{ticket.vendor}</div>
          <div className="mt-1 text-xs font-semibold text-slate-500">{ticket.issue}</div>
        </div>
        <span className={`rounded border px-2 py-0.5 text-[11px] font-black ${statusClass(ticket.status)}`}>{ticket.status}</span>
      </div>
      <div className="mt-2 text-xs font-semibold text-slate-400">{ticket.team}팀 {ticket.scheduleType} · 담당 {ticket.assignee || "미배정"} · {ticket.model}{shortAddress(ticket.address) ? ` · 📍 ${shortAddress(ticket.address)}` : ""}</div>
      <div className="mt-1.5"><VendorFlagBadges flags={vendorFlags.get(ticket.vendor.trim())} /></div>
    </button>
  );

  return (
    <div className="space-y-5">
      {!!syncError && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-bold text-amber-700">{syncError}</div>}
      {view === "as" && <section className="flex flex-col gap-3 rounded-xl bg-[#151A23] px-4 py-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <p className="text-[11px] font-semibold text-slate-400">팀별 AS·물류·휴가·매월점검 일정을 확인하고 담당자 배정·완료·일정 변경을 처리합니다.</p>
        <div className="flex flex-wrap gap-1 rounded-full bg-white/10 p-1">
          <button type="button" onClick={() => setTeam("ALL")} className={`rounded-full px-3.5 py-1.5 text-sm font-black transition ${team === "ALL" ? "bg-white text-slate-950" : "text-slate-400 hover:text-white"}`}>전체</button>
          {teams.map((item) => (
            <button key={item} type="button" onClick={() => setTeam(item)} className={`rounded-full px-3.5 py-1.5 text-sm font-black transition ${team === item ? "bg-white text-slate-950" : "text-slate-400 hover:text-white"}`}>{item}팀</button>
          ))}
        </div>
      </section>}

      {view === "calendar" ? (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex min-h-[720px] flex-col lg:flex-row">
            <aside className="border-b border-slate-200 bg-slate-50/70 p-3 lg:w-56 lg:flex-none lg:border-b-0 lg:border-r lg:p-4">
              <div className="grid grid-cols-2 gap-2 lg:block">
                <button type="button" onClick={() => setNewTicket(blankTicket(todayYmd, newTicketDefaults()))} className="flex w-full items-center justify-center gap-1.5 rounded-full bg-blue-600 px-4 py-3 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700">
                  <span className="text-lg leading-none">+</span> 일정 추가
                </button>
                <button type="button" onClick={() => setCalendarFiltersOpen((current) => !current)} className="rounded-full border border-slate-200 bg-white transition hover:bg-slate-50 px-4 py-3 text-sm font-black text-slate-600 shadow-sm lg:hidden">필터 {calendarFiltersOpen ? "닫기" : "열기"}</button>
              </div>
              <div className={`${calendarFiltersOpen ? "block" : "hidden"} mt-3 lg:mt-5 lg:block`}>
                <div className="grid grid-cols-2 gap-3 lg:block lg:space-y-5">
                  <div>
                    <div className="mb-2 text-[11px] font-black uppercase tracking-wide text-slate-400">업무 종류</div>
                    <div className="space-y-0.5 rounded-lg border border-slate-200 bg-white p-1.5">
                      {scheduleFilters.map((filter) => (
                        <label key={filter} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50">
                          <input type="checkbox" checked={visibleScheduleTypes.includes(filter)} onChange={() => toggleScheduleFilter(filter)} className="h-4 w-4 accent-blue-600" />
                          <span className={`h-2.5 w-2.5 rounded-full ${filter === "익일AS" ? "bg-purple-500" : filter === "물류" ? "bg-rose-500" : filter === "휴가" ? "bg-emerald-500" : filter === "매월점검" ? "bg-amber-500" : "bg-blue-600"}`} />
                          {filter}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 text-[11px] font-black uppercase tracking-wide text-slate-400">담당 팀</div>
                    <div className="grid grid-cols-2 gap-0.5 rounded-lg border border-slate-200 bg-white p-1.5 lg:grid-cols-1">
                      {teams.map((calendarTeam) => (
                        <label key={calendarTeam} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50">
                          <input type="checkbox" checked={visibleTeams.includes(calendarTeam)} onChange={() => toggleVisibleTeam(calendarTeam)} className="h-4 w-4 accent-blue-600" />
                          {calendarTeam}팀
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </aside>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setCurrentMonth(monthStart(todayYmd))} className="rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-black text-slate-700 transition hover:bg-slate-50">오늘</button>
                  <button type="button" aria-label="이전 달" onClick={() => setCurrentMonth(addMonths(currentMonth, -1))} className="flex h-9 w-9 items-center justify-center rounded-full text-xl font-bold text-slate-500 transition hover:bg-slate-100">‹</button>
                  <button type="button" aria-label="다음 달" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="flex h-9 w-9 items-center justify-center rounded-full text-xl font-bold text-slate-500 transition hover:bg-slate-100">›</button>
                  <h2 className="ml-1 text-lg font-black text-slate-950 sm:text-xl">{Number(currentMonth.slice(0, 4))}년 {Number(currentMonth.slice(5, 7))}월</h2>
                </div>
                <div className="rounded-full bg-slate-100 p-1">
                  {(["calendar", "list"] as ViewMode[]).map((mode) => (
                    <button key={mode} type="button" onClick={() => setViewMode(mode)} className={`rounded-full px-3 py-1.5 text-xs font-black ${viewMode === mode ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{mode === "calendar" ? "월" : "목록"}</button>
                  ))}
                </div>
              </div>

              {viewMode === "list" ? (
                <div className="space-y-4 p-3 sm:p-4">
                  {Array.from(
                    monthTickets.sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
                      .reduce((groups, ticket) => {
                        const list = groups.get(ticket.date) || [];
                        list.push(ticket);
                        groups.set(ticket.date, list);
                        return groups;
                      }, new Map<string, AsTicket[]>()),
                  ).map(([date, list]) => (
                    <div key={date}>
                      <div className={`sticky top-0 z-10 flex items-center gap-2 rounded-lg bg-slate-100/95 px-3 py-1.5 backdrop-blur ${date === todayYmd ? "text-blue-700" : "text-slate-600"}`}>
                        <span className="text-sm font-black">{Number(date.slice(5, 7))}/{Number(date.slice(8, 10))} ({["일", "월", "화", "수", "목", "금", "토"][new Date(`${date}T00:00:00`).getDay()]})</span>
                        {date === todayYmd && <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-black text-white">오늘</span>}
                        <span className="text-[11px] font-bold text-slate-400">{list.length}건</span>
                      </div>
                      <div className="mt-1.5 space-y-2">
                        {list.map((ticket) => renderTicketCard(ticket))}
                      </div>
                    </div>
                  ))}
                  {!monthTickets.length && <div className="p-12 text-center text-sm font-semibold text-slate-400">이 달의 일정이 없습니다.</div>}
                </div>
              ) : (
                <>
                <div className="md:hidden">
                  <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
                    {["일", "월", "화", "수", "목", "금", "토"].map((day, index) => <div key={day} className={`py-2 text-center text-[11px] font-black ${index === 0 ? "text-rose-500" : index === 6 ? "text-blue-500" : "text-slate-500"}`}>{day}</div>)}
                  </div>
                  <div className="grid grid-cols-7">
                    {calendarDays.map((date, dayIndex) => {
                      const rows = visibleTickets.filter((ticket) => ticket.date === date);
                      const inMonth = date.slice(0, 7) === currentMonth.slice(0, 7);
                      const isToday = date === todayYmd;
                      const isSelected = date === mobileSelectedDate;
                      return (
                        <button key={date} type="button" onClick={() => setMobileSelectedDate(date)} className={`min-h-16 border-b border-r border-slate-200 p-1 text-left ${inMonth ? (dayIndex === 0 ? "bg-rose-50/30" : dayIndex === 6 ? "bg-blue-50/25" : "bg-white") : "bg-slate-50"} ${isSelected ? "ring-2 ring-inset ring-blue-500" : ""}`}>
                          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-black ${isToday ? "bg-blue-600 text-white" : dayNumberColor(dayIndex, inMonth)}`}>{Number(date.slice(8, 10))}</span>
                          <span className="mt-1 flex flex-wrap gap-0.5">
                            {rows.slice(0, 4).map((ticket) => <span key={ticket.id} className={`h-1.5 w-1.5 rounded-full ${ticket.scheduleType === "익일AS" ? "bg-purple-500" : ticket.scheduleType === "물류" ? "bg-rose-500" : ticket.scheduleType === "휴가" ? "bg-emerald-500" : ticket.scheduleType === "매월점검" ? "bg-amber-500" : "bg-blue-600"}`} />)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="border-t border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-sm font-black text-slate-900">{Number(mobileSelectedDate.slice(5, 7))}월 {Number(mobileSelectedDate.slice(8, 10))}일 · {visibleTickets.filter((ticket) => ticket.date === mobileSelectedDate).length}건</div>
                      <button type="button" onClick={() => setNewTicket(blankTicket(mobileSelectedDate, newTicketDefaults()))} className="rounded-full bg-blue-600 shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 px-3 py-2 text-xs font-black text-white">+ 일정</button>
                    </div>
                    <div className="space-y-1.5">
                      {visibleTickets.filter((ticket) => ticket.date === mobileSelectedDate).map((ticket) => (
                        <button key={ticket.id} type="button" onClick={() => setDetailId(ticket.id)} className={`block w-full rounded-lg px-3 py-2.5 text-left ${scheduleColor(ticket.scheduleType, ticket.status === "완료")}`}>
                          <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-black">{ticket.time} {ticket.vendor || "새 일정"}</span><span className="shrink-0 text-[10px] font-black">{ticket.team}팀 · {ticket.scheduleType}</span></div>
                          {!!ticket.issue && <div className="mt-1 truncate text-xs font-semibold opacity-75">{ticket.issue}</div>}
                        </button>
                      ))}
                      {!visibleTickets.some((ticket) => ticket.date === mobileSelectedDate) && <div className="py-4 text-center text-xs font-semibold text-slate-400">등록된 일정이 없습니다.</div>}
                    </div>
                  </div>
                </div>
                <div className="hidden overflow-x-auto md:block">
                  <div className="min-w-[760px]">
                    <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
                      {["일", "월", "화", "수", "목", "금", "토"].map((day, index) => <div key={day} className={`px-2 py-2.5 text-center text-[11px] font-black ${index === 0 ? "bg-rose-50/60 text-rose-500" : index === 6 ? "bg-blue-50/50 text-blue-500" : "text-slate-500"}`}>{day}</div>)}
                    </div>
                    <div className="grid grid-cols-7">
                      {calendarDays.map((date, dayIndex) => {
                        const rows = visibleTickets.filter((ticket) => ticket.date === date);
                        const inMonth = date.slice(0, 7) === currentMonth.slice(0, 7);
                        const isToday = date === todayYmd;
                        return (
                          <div key={date} onClick={() => setNewTicket(blankTicket(date, newTicketDefaults()))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData("text/calendar-ticket"); if (id) requestMoveDate(id, date); }} className={`group min-h-28 border-b border-r border-slate-200 p-1.5 transition sm:min-h-32 2xl:min-h-40 2xl:p-2 ${inMonth ? (dayIndex === 0 ? "bg-rose-50/25" : dayIndex === 6 ? "bg-blue-50/20" : "bg-white") : "bg-slate-50/70"} hover:bg-blue-50/30`}>
                            <button type="button" className={`mb-1.5 flex h-7 w-7 items-center justify-center rounded-full text-xs font-black tabular-nums transition ${isToday ? "bg-blue-600 text-white shadow-[0_2px_8px_rgba(37,99,235,0.35)]" : `${dayNumberColor(dayIndex, inMonth)}${inMonth ? " hover:bg-slate-100" : ""}`}`}>{Number(date.slice(8, 10))}</button>
                            <div className="space-y-1">
                              {rows.slice(0, 5).map((ticket) => (
                                <button key={ticket.id} type="button" draggable onDragStart={(event) => { event.dataTransfer.setData("text/calendar-ticket", ticket.id); event.dataTransfer.effectAllowed = "move"; }} onClick={(event) => { event.stopPropagation(); setDetailId(ticket.id); }} className={`block w-full cursor-grab truncate rounded-md px-2 py-1 text-left text-[11px] font-bold shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition hover:brightness-95 active:cursor-grabbing ${scheduleColor(ticket.scheduleType, ticket.status === "완료")}`}>
                                  {ticket.vendor || "새 일정"}
                                </button>
                              ))}
                              {rows.length > 5 && <div onClick={(event) => event.stopPropagation()} className="px-1 pt-0.5 text-[10px] font-black text-slate-400">+{rows.length - 5}개 더</div>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                </>
              )}
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="grid w-full grid-cols-3 rounded-full bg-slate-100 p-1 sm:w-auto">
              {([["today", "금일일정"], ["tomorrow", "익일일정"], ["scheduled", "예정일정"]] as [DayFilter, string][]).map(([key, label]) => (
                <button key={key} type="button" onClick={() => setDayFilter(key)} className={`rounded-full px-4 py-1.5 text-sm font-black transition ${dayFilter === key ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{label}</button>
              ))}
            </div>
            <div className="text-xs font-bold text-slate-400">{dayFilter === "today" ? targetDate : dayFilter === "tomorrow" ? tomorrowYmd : `${tomorrowYmd} 제외 이후 일정`} · {scheduleRows.length}건</div>
          </div>

          <div className="space-y-3 md:hidden">
            {scheduleRows.map((ticket) => (
              <article key={ticket.id} onClick={() => setDetailId(ticket.id)} className={`cursor-pointer rounded-lg border p-4 shadow-sm active:bg-blue-50/50 ${ticket.status === "완료" ? "border-blue-300 bg-blue-50/70" : "border-slate-200 bg-white"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 text-left">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-black text-white">{ticket.team}팀</span>
                      <span className="text-xs font-black text-slate-500">{ticket.date} {ticket.time}</span>
                    </div>
                    <div className={`mt-2 text-base font-black ${ticket.status === "완료" ? "text-blue-700" : "text-slate-950"}`}>{ticket.vendor}</div>
                    <div className="mt-1 text-sm font-semibold text-slate-600">{ticket.issue}</div>
                    <div className="mt-2 text-xs font-semibold text-slate-400">{ticket.model} · {ticket.serial || "시리얼 미입력"}{shortAddress(ticket.address) ? ` · 📍 ${shortAddress(ticket.address)}` : ""}</div>
                    <div className="mt-2"><VendorFlagBadges flags={vendorFlags.get(ticket.vendor.trim())} /></div>
                  </div>
                  {ticket.status === "완료" && <span className="shrink-0 rounded-full bg-blue-600 shadow-[0_3px_10px_rgba(37,99,235,0.3)] hover:bg-blue-700 px-2.5 py-1.5 text-xs font-black text-white">✓ 완료</span>}
                </div>
                <select onClick={(event) => event.stopPropagation()} value={ticket.assignee} onChange={(event) => update(ticket.id, { assignee: event.target.value, status: event.target.value && ticket.status === "접수" ? "배정" : ticket.status })} className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold">
                  <option value="">미배정</option>
                  {teamAssignees[ticket.team].map((name) => <option key={name}>{name}</option>)}
                </select>
                <div className="mt-3 flex gap-2" onClick={(event) => event.stopPropagation()}>
                  {(ticket.scheduleType === "AS" || ticket.scheduleType === "익일AS") && <button type="button" onClick={() => onUseField?.(buildFieldAsText(ticket, author), { id: ticket.id, receptionId: ticket.receptionId, vendor: ticket.vendor })} className="flex-1 rounded-full bg-slate-900 transition hover:bg-slate-800 px-2 py-2.5 text-xs font-black text-white">FIELD AS</button>}
                  <button type="button" onClick={() => setAssignId(ticket.id)} className="flex-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-2.5 text-xs font-black text-emerald-700">배정</button>
                  <button type="button" onClick={() => toggleDone(ticket)} className={`flex-1 rounded-full border px-2 py-2.5 text-xs font-black ${ticket.status === "완료" ? "border-slate-300 bg-white text-slate-600" : "border-blue-200 bg-blue-50 text-blue-700"}`}>{ticket.status === "완료" ? "완료 취소" : "완료"}</button>
                  <button type="button" onClick={() => openDefer(ticket)} className="flex-1 rounded-full border border-purple-200 bg-purple-50 px-2 py-2.5 text-xs font-black text-purple-700">익일</button>
                  <button type="button" onClick={() => removeTicket(ticket)} className="flex-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-2.5 text-xs font-black text-rose-600">삭제</button>
                </div>
              </article>
            ))}
            {!scheduleRows.length && <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-12 text-center text-sm font-semibold text-slate-400">등록된 일정이 없습니다.</div>}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[1100px] text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-black text-slate-500">
                  <th className="px-3 py-3">팀</th>
                  <th className="px-3 py-3">일정</th>
                  <th className="w-[21%] px-3 py-3">업체명</th>
                  <th className="w-[24%] px-3 py-3">접수내용</th>
                  <th className="px-3 py-3">기기</th>
                  <th className="px-3 py-3">담당자</th>
                  <th className="px-3 py-3 text-right">처리</th>
                </tr>
              </thead>
              <tbody>
                {scheduleRows.map((ticket) => (
                  <tr key={ticket.id} onClick={() => setDetailId(ticket.id)} className={`cursor-pointer border-b last:border-0 hover:bg-blue-50/40 ${ticket.status === "완료" ? "border-blue-100 bg-blue-50/70" : "border-slate-100"}`}>
                    <td className="px-3 py-4 text-sm font-black">{ticket.team}팀</td>
                    <td className="px-3 py-4 text-sm font-bold">{ticket.time}<div className="text-[11px] text-slate-400">{ticket.date}</div></td>
                    <td className="px-3 py-4">
                      <div className="flex items-center gap-2 text-sm font-black text-slate-900"><span className="max-w-[220px] truncate">{ticket.vendor}</span>{ticket.repeatMonthly && <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-600">🔁</span>}{ticket.status === "완료" && <span className="shrink-0 rounded bg-blue-600 px-2 py-0.5 text-[10px] font-black text-white">✓ 완료</span>}</div>
                      {shortAddress(ticket.address) && <div className="mt-0.5 text-[10px] font-bold text-slate-400">📍 {shortAddress(ticket.address)}</div>}
                      <div className="mt-1.5"><VendorFlagBadges flags={vendorFlags.get(ticket.vendor.trim())} /></div>
                    </td>
                    <td className="px-3 py-4 text-xs font-semibold text-slate-600">{ticket.issue || "-"}</td>
                    <td className="px-3 py-4 text-sm font-semibold text-slate-600">{ticket.model}<div className="text-[11px] text-slate-400">{ticket.serial}</div></td>
                    <td className="px-3 py-4" onClick={(event) => event.stopPropagation()}>
                      <select value={ticket.assignee} onChange={(event) => update(ticket.id, { assignee: event.target.value, status: event.target.value && ticket.status === "접수" ? "배정" : ticket.status })} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold">
                        <option value="">미배정</option>
                        {teamAssignees[ticket.team].map((name) => <option key={name}>{name}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-4" onClick={(event) => event.stopPropagation()}>
                      <div className="flex justify-end gap-1.5">
                        {(ticket.scheduleType === "AS" || ticket.scheduleType === "익일AS") && <button type="button" onClick={() => onUseField?.(buildFieldAsText(ticket, author), { id: ticket.id, receptionId: ticket.receptionId, vendor: ticket.vendor })} className="rounded-full bg-slate-900 transition hover:bg-slate-800 px-3 py-2 text-xs font-black text-white">FIELD AS</button>}
                        <button type="button" onClick={() => setAssignId(ticket.id)} className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700">배정</button>
                        <button type="button" onClick={() => toggleDone(ticket)} className={`rounded-full border px-3 py-2 text-xs font-black ${ticket.status === "완료" ? "border-slate-200 bg-white text-slate-500" : "border-blue-200 bg-blue-50 text-blue-700"}`}>{ticket.status === "완료" ? "완료취소" : "완료"}</button>
                        <button type="button" onClick={() => openDefer(ticket)} className="rounded-full border border-purple-200 bg-purple-50 px-3 py-2 text-xs font-black text-purple-700">익일</button>
                        <button type="button" onClick={() => removeTicket(ticket)} className="rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-600">삭제</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!scheduleRows.length && (
                  <tr><td colSpan={7} className="px-3 py-10 text-center text-sm font-semibold text-slate-400">등록된 일정이 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {detailTicket && (() => {
        const ticket = detailTicket;
        // 접수자·키맨의 모든 연락처를 줄 단위로 뽑아 각각 통화 버튼을 단다 (여러 명이면 선택해서 전화)
        const phoneEntries = [ticket.contact, ...ticket.keyman.split("\n")]
          .map((line) => line.trim())
          .filter(Boolean)
          .flatMap((line) => {
            const phones = line.match(/0\d{1,2}[- ]?\d{3,4}[- ]?\d{4}/g) || [];
            return phones.map((phone) => ({ line, phone }));
          });
        const reception = detailReception;
        const infoCell = (label: string, value: string) => (
          <div className="rounded-lg bg-slate-50 px-3 py-2"><div className="text-[10px] font-black text-slate-400">{label}</div><div className="mt-0.5 truncate text-xs font-black text-slate-800">{value || "-"}</div></div>
        );
        return (
          <div className="fixed inset-0 z-[115] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setDetailId("")}>
            <div className="flex max-h-[90vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:max-w-2xl sm:rounded-lg" onMouseDown={(event) => event.stopPropagation()}>
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-slate-900 px-2 py-0.5 text-[10px] font-black text-white">{ticket.team}팀</span>
                    <span className={`rounded border px-2 py-0.5 text-[10px] font-black ${statusClass(ticket.status)}`}>{ticket.status}</span>
                    <span className="text-[11px] font-black text-slate-400">{ticket.date} {ticket.time}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2"><span className="truncate text-lg font-black text-slate-950">{ticket.vendor || "업체 미기재"}</span>{ticket.repeatMonthly && <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-600">🔁 매월</span>}</div>
                </div>
                <button type="button" onClick={() => setDetailId("")} className="h-9 w-9 shrink-0 rounded-lg text-xl font-black text-slate-400">×</button>
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
                {!!ticket.issue && <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-3"><div className="text-[10px] font-black text-blue-500">접수 내용</div><div className="mt-1 whitespace-pre-wrap text-sm font-bold leading-6 text-slate-800">{ticket.issue}</div></div>}
                {!!ticket.note && <details className="rounded-lg border border-emerald-100 bg-emerald-50/40" open={ticket.note.length < 300}>
                  <summary className="cursor-pointer px-3 py-2.5 text-[10px] font-black text-emerald-600">내용 (처리 결과·양식)</summary>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-emerald-100 px-3 py-2 font-mono text-xs leading-5 text-slate-700">{ticket.note}</pre>
                </details>}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {infoCell("기종", ticket.model)}
                  {infoCell("시리얼(기번)", ticket.serial)}
                  {infoCell("자산기번", ticket.asset)}
                  {infoCell("등급", ticket.grade)}
                  {reception && infoCell("순(임대리스트)", reception.lease_no)}
                  {reception && infoCell("접수유형·경로", `${reception.type} · ${reception.route}`)}
                  {infoCell("담당자", ticket.assignee || "미배정")}
                  {reception && infoCell("유상/무상", reception.paid)}
                  {ticket.department && infoCell("부서", ticket.department)}
                </div>
                {phoneEntries.length > 0 && <div className="rounded-lg border border-slate-200 p-3">
                  <div className="text-[10px] font-black text-slate-400">연락처 — 누를 상대를 선택하세요</div>
                  <div className="mt-1.5 space-y-1.5">
                    {phoneEntries.map(({ line, phone }, index) => (
                      <div key={`${phone}-${index}`} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-xs font-bold text-slate-700">{line}</span>
                        <a href={`tel:${phone.replace(/[^0-9]/g, "")}`} className="shrink-0 rounded-full bg-emerald-600 transition hover:bg-emerald-700 px-3 py-1.5 text-xs font-black text-white">📞 {phone}</a>
                      </div>
                    ))}
                  </div>
                </div>}
                {!phoneEntries.length && !!(ticket.contact || ticket.keyman) && <div className="rounded-lg border border-slate-200 p-3 text-xs font-bold text-slate-600">{[ticket.contact, ticket.keyman].filter(Boolean).join("\n")}</div>}
                {!!ticket.address && <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                  <div className="min-w-0"><div className="text-[10px] font-black text-amber-600">방문 주소</div><div className="mt-0.5 text-sm font-black text-slate-800">{ticket.address}</div></div>
                  <AddrNav address={ticket.address} />
                </div>}
                {detailLoading && <div className="py-2 text-center text-xs font-bold text-slate-400">접수 원본 불러오는 중…</div>}
                {!!(reception?.photos?.length) && <div>
                  <div className="text-[10px] font-black text-slate-400">증상 사진</div>
                  <div className="mt-1.5 flex flex-wrap gap-2">{reception.photos.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt="증상 사진" className="h-20 w-20 rounded-lg border border-slate-200 object-cover" /></a>)}</div>
                </div>}
                {!!reception?.report_text && <details className="rounded-lg border border-slate-200">
                  <summary className="cursor-pointer px-3 py-2.5 text-xs font-black text-slate-600">원본 보고양식 펼치기</summary>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-slate-100 bg-slate-50 p-3 font-mono text-[11px] leading-5 text-slate-700">{reception.report_text}</pre>
                  <div className="border-t border-slate-100 p-2 text-right"><button type="button" onClick={() => void navigator.clipboard.writeText(reception.report_text)} className="rounded-full bg-slate-900 transition hover:bg-slate-800 px-3 py-1.5 text-[11px] font-black text-white">복사</button></div>
                </details>}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3">
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setDetailId(""); setEditId(ticket.id); }} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-50">수정</button>
                  <button type="button" onClick={() => { setDetailId(""); setDupTicketId(ticket.id); setDupDate(ticket.date); }} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-50">복제</button>
                  <button type="button" disabled={naverBusyId === ticket.id} onClick={() => void sendToNaver(ticket)} title="네이버 캘린더에 이 일정을 등록합니다" className={`rounded-full border px-4 py-2 text-sm font-black disabled:opacity-50 ${ticket.naverPushedAt ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-300 text-slate-700"}`}>{naverBusyId === ticket.id ? "등록 중…" : ticket.naverPushedAt ? "네이버 ✓" : "네이버 캘린더"}</button>
                </div>
                <div className="flex gap-2">
                  {(ticket.scheduleType === "AS" || ticket.scheduleType === "익일AS") && onUseField && <button type="button" onClick={() => { setDetailId(""); onUseField(buildFieldAsText(ticket, author), { id: ticket.id, receptionId: ticket.receptionId, vendor: ticket.vendor }); }} className="rounded-full bg-slate-900 transition hover:bg-slate-800 px-4 py-2 text-sm font-black text-white">FIELD AS</button>}
                  <button type="button" onClick={() => setAssignId(ticket.id)} className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700">배정</button>
                  <button type="button" onClick={() => { toggleDone(ticket); setDetailId(""); }} className={`rounded-full border px-4 py-2 text-sm font-black ${ticket.status === "완료" ? "border-slate-300 text-slate-600" : "border-blue-200 bg-blue-50 text-blue-700"}`}>{ticket.status === "완료" ? "완료 취소" : "완료"}</button>
                  <button type="button" onClick={() => { setDetailId(""); openDefer(ticket); }} className="rounded-full border border-purple-200 bg-purple-50 px-4 py-2 text-sm font-black text-purple-700">익일</button>
                  <button type="button" onClick={() => { if (removeTicket(ticket)) setDetailId(""); }} className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-black text-rose-600">삭제</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {editTicket && <TicketEditModal ticket={editTicket} onClose={() => setEditId("")} onSave={(patch) => {
        const newDate = patch.date;
        if (editTicket.repeatMonthly && patch.repeatMonthly !== false && newDate && newDate !== editTicket.date && seriesOthers(editTicket).length) {
          update(editTicket.id, { ...patch, date: editTicket.date });
          setMoveTarget({ ticket: { ...editTicket, ...patch, date: editTicket.date }, date: newDate });
        } else update(editTicket.id, patch);
        setEditId("");
      }} onComplete={() => { toggleDone(editTicket); setEditId(""); }} onDefer={() => { setEditId(""); openDefer(editTicket); }} onDelete={() => removeTicket(editTicket)} />}
      {newTicket && <TicketEditModal ticket={newTicket} title="일정 추가" onClose={() => setNewTicket(null)} onSave={(patch) => { const created = normalizeTicketSchedule({ ...newTicket, ...patch }); setTickets([...tickets, created]); persistRemote(created); if (created.repeatMonthly) ensureMonthlySeries(created); setNewTicket(null); }} />}
      {dupTicket && (
        <div className="fixed inset-0 z-[130] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setDupTicketId("")}>
          <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-lg" onMouseDown={(event) => event.stopPropagation()}>
            <div className="text-lg font-black text-slate-950">일정 복제</div>
            <div className="mt-1 text-sm font-semibold text-slate-500">{dupTicket.vendor || "이 일정"} — 어느 날짜로 복제할까요?</div>
            <div className="mt-5 grid grid-cols-3 gap-2">
              {([["같은 날", dupTicket.date], ["익일", nextBusinessDay(dupTicket.date)], ["다음 달", nextMonthSameDay(dupTicket.date)]] as [string, string][]).map(([label, date]) => (
                <button key={label} type="button" onClick={() => duplicateTicket(dupTicket, date)} className="rounded-full border border-slate-200 px-2 py-3 text-sm font-black text-slate-700 hover:bg-slate-50">
                  {label}<div className="mt-1 text-xs font-bold text-slate-400">{date.slice(5)}</div>
                </button>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <input type="date" value={dupDate} onChange={(event) => setDupDate(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
              <button type="button" onClick={() => { if (dupDate) duplicateTicket(dupTicket, dupDate); }} className="rounded-full bg-blue-600 shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 px-4 py-2 text-sm font-black text-white">이 날짜로 복제</button>
            </div>
          </div>
        </div>
      )}
      {assignTicket && (
        <div className="fixed inset-0 z-[140] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setAssignId("")}>
          <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-lg" onMouseDown={(event) => event.stopPropagation()}>
            <div className="text-lg font-black text-slate-950">담당자 배정</div>
            <div className="mt-1 text-sm font-semibold text-slate-500">{assignTicket.vendor || "이 일정"} · {assignTicket.team}팀 · 현재 {assignTicket.assignee || "미배정"}</div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              {teamAssignees[assignTicket.team].map((name) => (
                <button key={name} type="button" onClick={() => applyAssign(assignTicket, name)} className={`rounded-full border px-3 py-3 text-sm font-black ${assignTicket.assignee === name ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>{name}</button>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <button type="button" onClick={() => applyAssign(assignTicket, "")} className="rounded-full border border-slate-200 px-4 py-2 text-sm font-black text-slate-500 hover:bg-slate-50">미배정으로</button>
              <button type="button" onClick={() => setAssignId("")} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-black text-slate-600 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">닫기</button>
            </div>
          </div>
        </div>
      )}
      {moveTarget && (
        <div className="fixed inset-0 z-[130] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setMoveTarget(null)}>
          <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-lg" onMouseDown={(event) => event.stopPropagation()}>
            <div className="text-lg font-black text-slate-950">🔁 매월 반복 일정 이동</div>
            <div className="mt-1 text-sm font-semibold text-slate-500">{moveTarget.ticket.vendor || "이 일정"} · {moveTarget.ticket.date} → {moveTarget.date}</div>
            <div className="mt-5 space-y-2">
              <button type="button" onClick={() => { update(moveTarget.ticket.id, { date: moveTarget.date }); setMoveTarget(null); }} className="w-full rounded-lg border border-slate-200 px-4 py-3 text-left text-sm font-black text-slate-700 hover:bg-slate-50">
                이 일정만 이동<div className="mt-0.5 text-xs font-bold text-slate-400">이번 건만 {moveTarget.date}로 옮기고, 다른 달은 그대로 둡니다</div>
              </button>
              <button type="button" onClick={() => { applyMoveAll(moveTarget.ticket, moveTarget.date); setMoveTarget(null); }} className="w-full rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-left text-sm font-black text-blue-700 hover:bg-blue-100">
                전체 반복 일정 이동 ({seriesOthers(moveTarget.ticket).length + 1}건)<div className="mt-0.5 text-xs font-bold text-blue-500/80">앞으로 오는 미완료 반복 일정을 전부 매월 {Number(moveTarget.date.slice(8, 10))}일로 바꿉니다 (완료된 지난 기록은 유지)</div>
              </button>
            </div>
            <div className="mt-3 text-right"><button type="button" onClick={() => setMoveTarget(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-black text-slate-600 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">취소</button></div>
          </div>
        </div>
      )}
      {deferTicket && <DeferModal ticket={deferTicket} customDate={customDate} onCustomDate={setCustomDate} onClose={() => setDeferId("")} onApply={applyDefer} />}
    </div>
  );
}

function TicketEditModal({ ticket, title = "일정 수정", onClose, onSave, onComplete, onDefer, onDelete }: { ticket: AsTicket; title?: string; onClose: () => void; onSave: (patch: Partial<AsTicket>) => void; onComplete?: () => void; onDefer?: () => void; onDelete?: () => void }) {
  const [draft, setDraft] = useState(ticket);
  const set = <K extends keyof AsTicket>(key: K, value: AsTicket[K]) => setDraft((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="fixed inset-0 z-[120] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={onClose}>
      <div className="flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:max-w-2xl sm:rounded-lg" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <b>{title}</b>
          <button type="button" onClick={onClose} className="text-xs font-bold text-slate-400">닫기</button>
        </div>
        <div className="grid min-h-0 gap-3 overflow-y-auto p-4 sm:p-5 md:grid-cols-2">
          <label className="text-xs font-bold text-slate-500">
            팀
            <select value={draft.team} onChange={(event) => set("team", event.target.value as Team)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal">
              {teams.map((item) => <option key={item} value={item}>{item}팀</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-slate-500">
            캘린더
            <select value={draft.scheduleType === "익일AS" ? "AS" : draft.scheduleType} onChange={(event) => set("scheduleType", event.target.value as ScheduleType)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal">
              {(["AS", "물류", "휴가", "매월점검"] as ScheduleType[]).map((type) => <option key={type} value={type}>{draft.team}팀 {type}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-slate-500">
            담당자
            <select value={draft.assignee} onChange={(event) => set("assignee", event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal">
              <option value="">미배정</option>
              {teamAssignees[draft.team].map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>
          <Field label="업체명" value={draft.vendor} onChange={(value) => set("vendor", value)} />
          <Field label="부서명" value={draft.department} onChange={(value) => set("department", value)} />
          <Field label="날짜" value={draft.date} type="date" onChange={(value) => set("date", value)} />
          <Field label="시간" value={draft.time} type="time" onChange={(value) => set("time", value)} />
          <Field label="연락처" value={draft.contact} onChange={(value) => set("contact", value)} />
          <Field label="주소" value={draft.address} onChange={(value) => set("address", value)} />
          <Field label="기종" value={draft.model} onChange={(value) => set("model", value)} />
          <Field label="시리얼" value={draft.serial} onChange={(value) => set("serial", value)} />
          <Field label="자산기번" value={draft.asset || ""} onChange={(value) => set("asset", value)} />
          <Field label="등급" value={draft.grade || ""} onChange={(value) => set("grade", value)} />
          <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-700 md:col-span-2">
            <input type="checkbox" checked={!!draft.repeatMonthly} onChange={(event) => set("repeatMonthly", event.target.checked)} className="h-4 w-4 accent-blue-600" />
            🔁 매월 반복 — 완료 처리하면 다음 달 같은 날로 일정이 자동 생성됩니다 (매월방문 업체용)
          </label>
          <label className="text-xs font-bold text-slate-500 md:col-span-2">
            키맨 정보 <span className="font-semibold text-slate-400">(FIELD 양식의 키맨/접수자 아랫줄에 그대로 들어감)</span>
            <textarea value={draft.keyman || ""} onChange={(event) => set("keyman", event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 p-3 text-sm font-normal" />
          </label>
          <label className="text-xs font-bold text-slate-500 md:col-span-2">
            접수내용
            <textarea value={draft.issue} onChange={(event) => set("issue", event.target.value)} rows={4} className="mt-1 w-full rounded-lg border border-slate-300 p-3 text-sm font-normal" />
          </label>
          <label className="text-xs font-bold text-slate-500 md:col-span-2">
            내용 <span className="font-semibold text-slate-400">— 처리 결과·점검/AS 양식 (완료 처리 시 자동으로 쌓임, 직접 붙여넣기도 가능)</span>
            <AutoGrowTextarea value={draft.note || ""} onChange={(value) => set("note", value)} minRows={3} className="mt-1 w-full rounded-lg border border-slate-300 p-3 font-mono text-xs leading-5" />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-4">
          <div>{onDelete && <button type="button" onClick={onDelete} className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-black text-rose-600">삭제</button>}</div>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-full border border-slate-200 px-4 py-2 text-sm font-bold text-slate-500">취소</button>
            {onDefer && <button type="button" onClick={onDefer} className="rounded-full border border-purple-200 bg-purple-50 px-4 py-2 text-sm font-black text-purple-700">익일</button>}
            {onComplete && <button type="button" onClick={onComplete} className="rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-black text-blue-700">{ticket.status === "완료" ? "완료 취소" : "완료"}</button>}
            <button type="button" onClick={() => onSave(draft)} className="rounded-full bg-blue-600 shadow-[0_3px_10px_rgba(37,99,235,0.3)] hover:bg-blue-700 px-4 py-2 text-sm font-black text-white">저장</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeferModal({ ticket, customDate, onCustomDate, onClose, onApply }: { ticket: AsTicket; customDate: string; onCustomDate: (date: string) => void; onClose: () => void; onApply: (date: string) => void }) {
  const today = getTodayYmd();
  const options = [
    ["익일", getTomorrowYmd()],
    ["1주", addDays(today, 7)],
    ["1달", addMonths(today, 1)],
    ["3달", addMonths(today, 3)],
  ] as const;

  return (
    <div className="fixed inset-0 z-[130] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-lg" onMouseDown={(event) => event.stopPropagation()}>
        <div className="text-lg font-black text-slate-950">익일 일정 변경</div>
        <div className="mt-1 text-sm font-semibold text-slate-500">{ticket.vendor}</div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          {options.map(([label, date]) => (
            <button key={label} type="button" onClick={() => onApply(date)} className="rounded-full border border-slate-200 px-4 py-3 text-sm font-black text-slate-700 hover:bg-slate-50">
              {label}
              <div className="mt-1 text-xs text-slate-400">{date}</div>
            </button>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <input type="date" value={customDate} onChange={(event) => onCustomDate(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
          <button type="button" onClick={() => onApply(customDate)} className="rounded-full bg-purple-600 px-4 py-2 text-sm font-black text-white">직접선택</button>
        </div>
      </div>
    </div>
  );
}

// 내용에 맞춰 높이가 자동으로 늘어나는 입력칸
function AutoGrowTextarea({ value, onChange, className = "", minRows = 3 }: { value: string; onChange: (value: string) => void; className?: string; minRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return <textarea ref={ref} rows={minRows} value={value} onChange={(event) => onChange(event.target.value)} className={`resize-none overflow-hidden ${className}`} />;
}

function Field({ label, value, type = "text", onChange }: { label: string; value: string; type?: string; onChange: (value: string) => void }) {
  return (
    <label className="text-xs font-bold text-slate-500">
      {label}
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
    </label>
  );
}
