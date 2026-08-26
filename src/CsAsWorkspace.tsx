import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { askConfirm } from "./confirmModal";
import { deleteRows, invokeEdgeFunction, selectAllRows, selectRows, updateRows, upsertRow, upsertRows } from "./supabase";
import { isMobileDevice, kakaoMapSearchLink, naverMapLink } from "./navApp";
import PortalSelect from "./PortalSelect";
import { nextBusinessDay } from "./planDate";
import { getServiceReceptionById, sendServiceReception, setServiceReceptionStatus, type ServiceReceptionRow, sendReceptionCopierCompleteJob } from "./api";
import { getVendorFlagsBatch, type VendorWorkFlags } from "./vendorFlags";
import { VendorAlertChip } from "./VendorAlert";
import UnifiedHistory from "./UnifiedHistory";
import { fieldTicketVendor, historyCoreName, logisticsTicketInfo, slashTrainVendor } from "./ids";
import { buildActionBlock as buildShareBlock, type ActionTicketLike } from "./actionBlock";
import { vendorNameByCode } from "./vendorCodes";
import { COMPANY_MEMBERS } from "./companyDirectory";
import { useAuthorBook } from "./authors";
import { escapeRegExp, extractCategory, extractIssue, matchReportAssignee as reportAssignee } from "./reportAssignee";

// 직원 이름이 통합이력 검색어가 되는 것 방지 — 네이버 수기 제목은 "이름 제목"으로 시작하는 관행
const MEMBER_NAMES = new Set(COMPANY_MEMBERS.map((m) => m.name));
import { notify } from "./toast";
import MyPlan from "./MyPlan";
import TeamCalendar from "./TeamCalendar";

type Team = "A" | "B" | "C" | "D" | "E" | "기타"; // 기타 = 팀 시간대 밖(11시 등)의 네이버 수입 일정
type AsStatus = "접수" | "배정" | "완료" | "익일";
// 분류는 네이버 캘린더 이름과 맞춘다(2026-08-15): 물류·휴가 → '납품철수교체휴가교육'로 통합,
// AS 미처리 표시는 '익일통합as'. "물류"/"휴가"는 옛 데이터 호환용으로만 남긴다.
type ScheduleType = "AS" | "익일AS" | "납품철수교체휴가교육" | "매월점검" | "물류" | "휴가";
type ViewMode = "list" | "calendar" | "mine" | "team"; // team = 팀 전용 캘린더(일정리스트·네이버와 무관)
type DayFilter = "today" | "tomorrow" | "scheduled";

export type AsTicket = {
  source?: string; // "autoplan" = 자동일정 생성 — 캘린더(월) 표시는 생략, 내 일정·목록에는 표시
  vendor_code?: string; // 거래처 코드 — 저장 시 DB 트리거가 자동 부착(순번>시리얼>자산기번>이름)
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
  naverUid?: string; // 네이버 캘린더 미러 일정의 UID — 있으면 CalDAV로 조회·수정·삭제 가능
  calendarTitle?: string; // 캘린더 표시 제목(보고양식 첫 줄) — 배정 시 "이름-" 접두사가 붙어 네이버와 동기화
  repeatMonthly?: boolean; // 매월 반복 — 완료하면 다음 달 같은 날로 자동 생성
  issue: string;
  note?: string; // 내용 — 처리 결과·점검/AS 양식이 쌓이는 칸
  assignee: string;
  status: AsStatus;
  scheduleType: ScheduleType;
  naverPushedAt?: string | null;   // 네이버 캘린더로 보낸 시각 (중복 등록 방지용)
};

const teams: Team[] = ["A", "B", "C", "D"]; // 필터·배정 명단용 기본 4팀 (E는 21시 슬롯 — 아래 개별 취급)
// 캘린더 표시 유형 — AS 계열은 날짜가 아니라 처리 여부로 구분한다 (금일·익일·예정 어디든 미처리는 미처리)
const displayFilters = ["익일통합as", "AS[완료]", "납품철수교체휴가교육", "매월점검"] as const;
type DisplayFilter = typeof displayFilters[number];
function displayTypeOf(t: { scheduleType: string; status: string }): DisplayFilter {
  if (t.scheduleType === "AS" || t.scheduleType === "익일AS") return t.status === "완료" ? "AS[완료]" : "익일통합as";
  if (t.scheduleType === "물류" || t.scheduleType === "휴가" || t.scheduleType === "납품철수교체휴가교육") return "납품철수교체휴가교육";
  return t.scheduleType as DisplayFilter;
}
// AS 완료는 팀별 네이버 완료 캘린더로 이동한다 — 표기도 그 캘린더 이름을 쓴다
// 팀 완료 캘린더의 실제 이름(네이버 CalDAV displayname 실측, 2026-08-25) — A·B는 "강북서AB as" 하나를 같이 쓴다
const DONE_CAL_LABEL: Record<Team, string> = { A: "강북서AB as", B: "강북서AB as", C: "강남C as", D: "경기 D as", E: "E지역 AS/점검 토탈", 기타: "as완료" };
const NAVER_MAIN_CAL = "76de84c7-48a2-46c6-8de0-edc721a03f3f"; // 익일통합as — 접수·수기 일정이 모이는 대상 캘린더

const storageKey = "cs_as_tickets_v4";
const REPORT_SEP = "-------------------"; // 중간보고 구분선 — 카톡에서 섹션이 끊어 읽히게
// 보고 머리의 시각 — 12시/14시 차수 대신 생성 시각 그대로("14:35 중간보고"). AI가 만드니 아무 때나 뽑아도 된다
const reportStamp = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
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

// 영업일 계산은 공용(planDate) 하나만 쓴다 — 주말+한국 공휴일(대체 포함) 제외

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
  if (ticket.scheduleType === "물류" || ticket.scheduleType === "휴가" || ticket.scheduleType === "납품철수교체휴가교육" || ticket.scheduleType === "매월점검") return ticket;
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

const TICKET_COLUMNS = "id,team,date,time,vendor,contact,address,department,model,serial,asset,grade,keyman,receptionId,repeatMonthly,issue,note,assignee,status,scheduleType,naverUid,calendarTitle,source,vendor_code";
// 서버 저장용 — 옛 로컬 JSON에 섞인 여분 속성이 올라가지 않게 정해진 필드만 뽑는다.
/** 리스트·캘린더 표시 제목 — 캘린더 제목(보고양식 첫 줄)에 배정자 이름 접두사. 없으면 업체명 */
function displayTitleOf(t: AsTicket) {
  const base = (t.calendarTitle || "").trim() || t.vendor || "일정";
  return `${t.assignee ? `${t.assignee}-` : ""}${base}`;
}

function toDbRow(t: AsTicket) {
  return { id: t.id, team: t.team, date: t.date, time: t.time, vendor: t.vendor, contact: t.contact, address: t.address, department: t.department, model: t.model, serial: t.serial, asset: t.asset || "", grade: t.grade || "", keyman: t.keyman || "", receptionId: t.receptionId || "", naverUid: t.naverUid || "", calendarTitle: t.calendarTitle || "", repeatMonthly: !!t.repeatMonthly, issue: t.issue, note: t.note || "", assignee: t.assignee, status: t.status, scheduleType: t.scheduleType };
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

// (VendorFlagBadges 배지 나열은 2026-08-15 ⚠칩(VendorAlert)+통합이력 팝업으로 흡수 — 삭제)

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

function scheduleColor(type: ScheduleType, completed = false) {
  // AS 계열은 날짜가 아니라 처리 여부가 기준: 미처리=보라, 완료=파랑(취소선)
  if (type === "AS" || type === "익일AS") return completed ? "bg-blue-100 text-blue-700 line-through" : "bg-lime-100 text-lime-800";
  if (completed) return "bg-slate-100 text-slate-400 line-through";
  if (type === "물류" || type === "휴가" || type === "납품철수교체휴가교육") return "bg-rose-100 text-rose-700";
  if (type === "매월점검") return "bg-amber-100 text-amber-700";
  return "bg-blue-100 text-blue-700";
}

// 네이버 미러 일정의 note에는 접수원본 전문이 들어 있다 — 있으면 조립 양식 대신 원문을 FIELD 변환기에 태운다
// (접수 내용을 직접 복붙해 변환한 것과 완전히 같은 결과: 구분 세팅·부서명·키맨·내용까지)
function receptionRawOf(ticket: AsTicket): string {
  // 익일 처리 후엔 메모에 "[날짜 전송 양식]" 블록이 누적된다 — 접수원본 부분만 잘라 변환기에 넣는다
  // (어제 양식의 모델명·매수 줄이 두 번째 기기로 오인되는 것 방지)
  const note = String(ticket.note || "").split(/\n\[\d{4}-\d{2}-\d{2} 전송 양식\]/)[0].trim();
  return /기번\s/.test(note) && /(접수분야|접수유형|임대리스트순번|★키맨)/.test(note) ? note : "";
}

function buildFieldAsText(ticket: AsTicket, author: string) {
  // 접수 보고양식을 FIELD에 복붙했을 때(formatPrinterReport)와 완전히 같은 형식.
  // 네이버 미러 일정은 제목 전체가 vendor에 실려 온다 — 업체명부만 남기고 구분(셋팅요청→세팅)도 제목에서 읽는다
  const cleaned = fieldTicketVendor(ticket.vendor);
  return [
    `작성자:${author || ticket.assignee || ""}`,
    `구분:${cleaned.gubun}`,
    "레벨:1",
    `등급:${ticket.grade || ""}`,
    `업체명:${cleaned.vendor}`,
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

export function AsReception({ author, onUseField, onSelfRequest, onLoadForm, onLogistics }: { author: string; onUseField: (fieldText: string, ticket?: { id: string; receptionId?: string; vendor?: string }) => void; onSelfRequest?: (text: string) => void; onLoadForm?: (rawText: string, ticket?: { id: string; receptionId?: string; vendor?: string }) => void; onLogistics?: (t: { id: string; receptionId?: string; vendor?: string; issue?: string; model?: string; note?: string }) => void }) {
  return <CsAsWorkspace view="as" author={author} onUseField={onUseField} onSelfRequest={onSelfRequest} onLoadForm={onLoadForm} onLogistics={onLogistics} />;
}

function CsAsWorkspace({ view, author = "", onUseField, onSelfRequest, onLoadForm, onLogistics }: { view: "calendar" | "as"; author?: string; onUseField?: (fieldText: string, ticket?: { id: string; receptionId?: string; vendor?: string }) => void; onSelfRequest?: (text: string) => void; onLoadForm?: (rawText: string, ticket?: { id: string; receptionId?: string; vendor?: string }) => void; onLogistics?: (t: { id: string; receptionId?: string; vendor?: string; issue?: string; model?: string; note?: string }) => void }) {
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
  const [histVendor, setHistVendor] = useState(""); // ⚠ 칩 클릭 → 통합이력 팝업
  // 코드가 붙은 일정은 마스터 대표명으로 검색(정확) — 없으면 제목에서 업체명 토큰 추출(폴백)
  // 이력 검색·특이사항 플래그가 같이 쓰는 업체명 질의 — 네이버 수기 제목은 "이름 제목"으로 시작하는 관행이라
  // 배정자 또는 회사 명단과 대조해 사람 이름을 벗기고, "계약갱신제안 / SS급 / 한국농어민신문 / 조은유 차장" 꼴이면
  // 등급 칸 다음(업체 칸)을 쓴다 — 첫 칸(내용)으로 찾으면 엉뚱한 결과가 났다(실사고)
  const historyQueryOf = (t: { vendor: string; assignee?: string }) => {
    let raw = t.vendor.trim();
    const who = (t.assignee || "").trim();
    const firstToken = raw.split(/\s+/)[0] || "";
    if (who && raw.startsWith(who)) raw = raw.slice(who.length).replace(/^[\s\-–—:]+/, "");
    else if (MEMBER_NAMES.has(firstToken.replace(/[-–—:]+$/, ""))) raw = raw.slice(firstToken.length).replace(/^[\s\-–—:]+/, "");
    return slashTrainVendor(raw) || raw;
  };
  const openTicketHistory = (t: { vendor: string; vendor_code?: string; assignee?: string }) => {
    const fallback = historyCoreName(historyQueryOf(t));
    if (!t.vendor_code) { setHistVendor(fallback); return; }
    void vendorNameByCode(t.vendor_code).then((name) => setHistVendor(name || fallback)).catch(() => setHistVendor(fallback));
  };
  useEffect(() => {
    const vendors = Array.from(new Set(tickets.map((ticket) => historyQueryOf(ticket)).filter(Boolean)));
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
    } catch (error) {
      // 원인(401·제약 위반·네트워크)을 삼키지 않는다 — "저장 실패"만 보이면 원격에서 진단이 불가능하다
      console.error("as_tickets write failed", error);
      setSyncError(`${failMessage} (${(error as Error)?.message || String(error)})`);
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
  const [team, setTeam] = useState<Team | "ALL" | "종일">(() => loadStoredFilter<Team | "ALL" | "종일">("cs_as_team_filter_v1", [...teams, "E", "기타", "종일", "ALL"], ["ALL"])[0] || "ALL");
  const [visibleScheduleTypes, setVisibleScheduleTypes] = useState<DisplayFilter[]>(() => loadStoredFilter("cs_calendar_types_v3", [...displayFilters], [...displayFilters]));
  const [visibleTeams, setVisibleTeams] = useState<Team[]>(() => loadStoredFilter("cs_calendar_teams_v1", teams, teams));
  useEffect(() => { try { localStorage.setItem("cs_as_team_filter_v1", JSON.stringify([team])); } catch { /* 저장 실패 무시 */ } }, [team]);
  useEffect(() => { try { localStorage.setItem("cs_calendar_types_v2", JSON.stringify(visibleScheduleTypes)); } catch { /* 저장 실패 무시 */ } }, [visibleScheduleTypes]);
  useEffect(() => { try { localStorage.setItem("cs_calendar_teams_v1", JSON.stringify(visibleTeams)); } catch { /* 저장 실패 무시 */ } }, [visibleTeams]);
  const [viewMode, setViewMode] = useState<ViewMode>("calendar");
  const [myPlanOpen, setMyPlanOpen] = useState(false); // 일정리스트 탭의 내 일정(지도+동선) 보기
  // 중간보고(12시·14시 카톡 보고) 자동 생성 — 팀 일정을 눈으로 대조해 손으로 쓰던 일을 던다
  const [midReport, setMidReport] = useState<{ team: Team; text: string; polishing?: boolean; diag?: string } | null>(null);
  const midReportSeq = useRef(0); // 차수·팀을 바꾼 뒤 늦게 도착한 AI 응답이 덮어쓰지 않게
  // 팀 전용 캘린더가 보여줄 팀 — 작성자의 팀(팀장은 칩으로 선택). 명단에 없는 사람은 현재 팀 필터, 그것도 없으면 C
  const [teamCalTeam, setTeamCalTeam] = useState<Team | null>(null);
  // 팀 명단 — 관리탭 인원(cs_members) 실시간. 신입·퇴사·팀 이동이 보고와 배정에 바로 반영된다.
  const { book: memberBook } = useAuthorBook();
  const csLeaders = memberBook["팀장"]?.length ? memberBook["팀장"] : ["신정훈"];
  const teamAssignees = useMemo<Record<Team, string[]>>(() => {
    const lead = memberBook["팀장"]?.length ? memberBook["팀장"] : ["신정훈"];
    const of = (t: "A" | "B" | "C" | "D") => {
      const names = memberBook[t] || []; // DB를 못 읽어도 authors.ts의 시드(AUTHOR_BOOK)가 채워준다 — 예비 명단을 두 벌 두면 서로 어긋난다
      return [...names.filter((n) => !lead.includes(n)), ...lead]; // 팀장은 어느 팀 화면에서든 선택 가능
    };
    return { A: of("A"), B: of("B"), C: of("C"), D: of("D"), E: [], 기타: [] };
  }, [memberBook]);
  const teamCalViewTeam: Team = teamCalTeam
    || ((["A", "B", "C", "D"] as Team[]).find((t) => teamAssignees[t].includes(author) && !csLeaders.includes(author)) as Team | undefined)
    || (teams.includes(team as Team) ? team as Team : "C");
  // 보고 순서: 팀장 최상단 → 명단 순서(부파트장이 첫 번째) 그대로
  const reportOrder = (reportTeam: Team) => {
    const mine = teamAssignees[reportTeam].filter((n) => !csLeaders.includes(n));
    // 다른 지역으로 지원 나간 CS 인원의 건도 보고에 들어가야 한다 — 자기 팀 뒤에 나머지 CS 명단을 붙인다(건이 있을 때만 그룹이 생긴다)
    const others = (["A", "B", "C", "D"] as Team[]).filter((t) => t !== reportTeam)
      .flatMap((t) => teamAssignees[t]).filter((n) => !csLeaders.includes(n) && !mine.includes(n));
    return [...csLeaders, ...mine, ...Array.from(new Set(others))];
  };
  const [currentMonth, setCurrentMonth] = useState(monthStart(todayYmd));
  // 네이버 캘린더에서 직접 만든 일정(동기화 크론이 가져옴) — 캘린더(월)에 읽기 전용 표시
  type NaverEventRow = { uid: string; date: string; time: string; title: string; location: string; description: string; calendar_id: string; completed: boolean };
  const [naverEvents, setNaverEvents] = useState<NaverEventRow[]>([]);
  const [naverReloadTick, setNaverReloadTick] = useState(0);
  const [naverDayDate, setNaverDayDate] = useState<string | null>(null); // 날짜 클릭 → 그날 통합 목록 팝업
  useEffect(() => {
    const ym = currentMonth.slice(0, 7);
    // 달력(이번 달)과 일정리스트(오늘~예정)를 모두 덮는 범위 — 월말에 익일이 다음 달이어도 보이게
    const from = [`${ym}-01`, addDays(getTodayYmd(), -7)].sort()[0];
    const to = [`${ym}-31`, addDays(getTodayYmd(), 60)].sort()[1];
    void selectRows<NaverEventRow>(
      "naver_calendar_events", `select=uid,date,time,title,location,description,calendar_id,completed&date=gte.${from}&date=lte.${to}&order=date.asc,time.asc`,
    ).then(setNaverEvents).catch(() => setNaverEvents([]));
  }, [currentMonth, naverReloadTick]);
  // 동기화 결과가 화면에 바로 따라오도록 — 45초마다 재조회 + 창 복귀 시 네이버를 즉시 당겨온다
  useEffect(() => {
    const bump = () => setNaverReloadTick((t) => t + 1);
    let lastPull = 0;
    const pullNow = () => {
      if (Date.now() - lastPull < 60_000) { bump(); return; } // 과호출 방지
      lastPull = Date.now();
      void invokeEdgeFunction("naver-calendar-sync", { action: "sync" }).catch(() => undefined).finally(() => window.setTimeout(bump, 1500));
    };
    const timer = window.setInterval(bump, 45_000);
    window.addEventListener("focus", pullNow);
    pullNow(); // 첫 진입 시 즉시 1회
    return () => { window.clearInterval(timer); window.removeEventListener("focus", pullNow); };
  }, []);
  // N 칩 클릭 → 상세 보기 (한방향 원칙: 네이버 직접 일정은 네이버가 원본 — 웹앱은 보기 전용.
  //  처리가 필요하면 [웹앱 일정으로 등록]으로 승격 — naverUid가 연결돼 완료·익일·드래그가
  //  기존 일정과 똑같이 동작하고, 네이버 원본도 따라 움직인다)
  const [naverDetail, setNaverDetail] = useState<NaverEventRow | null>(null);
  // 납품철수교체휴가교육 캘린더(75632617) — 그 외(익일통합as)는 AS 미처리와 같은 보라 계열
  const NAVER_DELIVERY_CAL = "75632617";
  // 팀 완료 캘린더 id — 관리 탭 설정(app_config NAVER_TEAM_CALENDAR_*)이 원본. 완료 캘린더에서 온 일정은 "AS[완료]"로 분류한다
  const [teamCalIds, setTeamCalIds] = useState<Partial<Record<Team, string>>>({ C: "75904193" });
  useEffect(() => {
    selectRows<{ key: string; value: string }>("app_config", "select=key,value&key=like.NAVER_TEAM_CALENDAR_*")
      .then((rows) => {
        const next: Partial<Record<Team, string>> = {};
        for (const row of rows) { const t = row.key.replace("NAVER_TEAM_CALENDAR_", "") as Team; if ((row.value || "").trim()) next[t] = row.value.trim(); }
        if (Object.keys(next).length) setTeamCalIds(next);
      })
      .catch(() => { /* 설정을 못 읽으면 C만 아는 기본값 유지 */ });
  }, []);
  const doneCalIds = useMemo(() => new Set(Object.values(teamCalIds).filter(Boolean) as string[]), [teamCalIds]);
  const naverCategoryOf = (ev: { calendar_id: string }): DisplayFilter =>
    ev.calendar_id === NAVER_DELIVERY_CAL ? "납품철수교체휴가교육" : doneCalIds.has(ev.calendar_id) ? "AS[완료]" : "익일통합as";
  const naverChipStyle = (ev: { calendar_id: string; completed: boolean }) =>
    ev.completed ? "border-slate-200 bg-slate-50 text-slate-400 line-through"
      : ev.calendar_id === NAVER_DELIVERY_CAL ? "border-rose-200 bg-rose-100 text-rose-700 hover:bg-rose-200"
      : "border-lime-200 bg-lime-50 text-lime-800 hover:bg-lime-100";
  const naverBadgeStyle = (ev: { calendar_id: string; completed: boolean }) =>
    ev.completed ? "bg-slate-400" : ev.calendar_id === NAVER_DELIVERY_CAL ? "bg-rose-600" : "bg-lime-600";
  // 드래그로 날짜 이동 — 네이버가 원본이므로 네이버에 바로 반영하고, 실패하면 되돌린다
  const moveNaverEvent = (uid: string, date: string) => {
    const ev = naverEvents.find((x) => x.uid === uid);
    if (!ev || ev.date === date) return;
    const prevDate = ev.date;
    setNaverEvents((cur) => cur.map((x) => (x.uid === uid ? { ...x, date } : x)));
    void invokeEdgeFunction("naver-calendar-push", { action: "caldav_update", uid, date, calId: ev.calendar_id })
      .then(() => notify(`네이버 일정이 ${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}로 이동됐습니다 ✓`, "success"))
      .catch((e) => {
        setNaverEvents((cur) => cur.map((x) => (x.uid === uid ? { ...x, date: prevDate } : x)));
        notify(`네이버 일정 이동 실패: ${(e as Error).message}`, "error");
      });
  };
  // 캘린더 검색 — 업체·제목·주소·내용에서 찾는다 (웹앱 일정 + 네이버 종일 일정)
  const [calSearch, setCalSearch] = useState("");
  const calSearchResults = useMemo(() => {
    const q = calSearch.trim().toLowerCase();
    if (q.length < 2) return [] as Array<{ kind: "ticket" | "naver"; id: string; date: string; title: string; key: string }>;
    const hitT = tickets.filter((t) => t.scheduleType !== "매월점검" && [t.vendor, t.calendarTitle, t.address, t.issue].some((v) => (v || "").toLowerCase().includes(q)))
      .map((t) => ({ kind: "ticket" as const, id: t.id, date: t.date, title: displayTitleOf(t), key: `t-${t.id}` }));
    const hitN = naverEvents.filter((ev) => [ev.title, ev.location, ev.description].some((v) => (v || "").toLowerCase().includes(q)))
      .map((ev) => ({ kind: "naver" as const, id: ev.uid, date: ev.date, title: ev.title || "(제목 없음)", key: `n-${ev.uid}` }));
    return [...hitT, ...hitN].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
  }, [calSearch, tickets, naverEvents]);
  // 네이버 일정 필드 저장 — 티켓 모달과 같은 감각(입력창 벗어나면 저장), 네이버에 바로 반영
  const saveNaverField = async (patch: Partial<Pick<NaverEventRow, "title" | "date" | "time" | "location" | "description">>) => {
    const ev = naverDetail;
    if (!ev) return;
    const next = { ...ev, ...patch };
    setNaverDetail(next);
    setNaverEvents((cur) => cur.map((x) => (x.uid === ev.uid ? next : x)));
    try {
      await invokeEdgeFunction("naver-calendar-push", {
        action: "caldav_update", uid: ev.uid, calId: ev.calendar_id,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.location !== undefined ? { location: patch.location } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.date !== undefined ? { date: patch.date } : {}),
        ...(patch.time !== undefined ? { time: patch.time } : {}),
      });
      notify("저장됐습니다 — 네이버 캘린더에도 반영 ✓", "success");
    } catch (e) {
      setNaverDetail(ev);
      setNaverEvents((cur) => cur.map((x) => (x.uid === ev.uid ? ev : x)));
      notify(`네이버 반영 실패: ${(e as Error).message}`, "error");
    }
  };
  // 캘린더 간 이동 — 동기화 대상 캘린더면 분류가 바뀌고, 그 외(완료 캘린더 등)면 목록에서 빠진다
  // 캘린더 이동 선택지 — 익일통합as·납품 + 설정된 팀 완료 캘린더 전부(같은 id는 한 번만: 강북서AB as)
  const NAVER_CAL_LIST = useMemo(() => {
    const list = [
      { id: NAVER_MAIN_CAL, name: "익일통합as" },
      { id: NAVER_DELIVERY_CAL, name: "납품철수교체휴가교육" },
    ];
    for (const t of ["A", "B", "C", "D", "E"] as Team[]) {
      const id = teamCalIds[t];
      if (id && !list.some((c) => c.id === id)) list.push({ id, name: `${DONE_CAL_LABEL[t]} (완료 캘린더)` });
    }
    return list;
  }, [teamCalIds]);
  const transferNaverEvent = async (toCal: string) => {
    const ev = naverDetail;
    if (!ev) return;
    const toName = NAVER_CAL_LIST.find((c) => c.id === toCal)?.name || "다른 캘린더";
    if (!await askConfirm(`이 일정을 "${toName}"(으)로 옮길까요?`)) return;
    try {
      await invokeEdgeFunction("naver-calendar-push", { action: "caldav_transfer", uid: ev.uid, calId: ev.calendar_id, toCal });
      const synced = toCal === NAVER_MAIN_CAL || toCal === NAVER_DELIVERY_CAL;
      if (synced) {
        const next = { ...ev, calendar_id: toCal };
        setNaverDetail(next);
        setNaverEvents((cur) => cur.map((x) => (x.uid === ev.uid ? next : x)));
      } else {
        setNaverEvents((cur) => cur.filter((x) => x.uid !== ev.uid));
        setNaverDetail(null);
      }
      notify(`"${toName}"(으)로 이동했습니다 ✓`, "success");
    } catch (e) {
      notify(`캘린더 이동 실패: ${(e as Error).message}`, "error");
    }
  };
  // 팀 ↔ 시간 규칙 (A=09 B=12 C=15 D=18 E=21) — 팀을 고르면 시간이 따라간다
  const TEAM_SLOT: Record<string, string> = { A: "09:00", B: "12:00", C: "15:00", D: "18:00", E: "21:00" };
  const TEAM_SLOT_LABEL: Record<string, string> = { A: "오전 9시", B: "오후 12시", C: "오후 3시", D: "오후 6시", E: "오후 9시" };
  // 날짜 입력은 어디를 눌러도 달력이 열리게 (기본은 아이콘만 반응)
  const openPicker = (e: React.MouseEvent<HTMLInputElement>) => { try { (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { /* 미지원 브라우저 */ } };
  const [naverDoneConfirm, setNaverDoneConfirm] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);       // 웹앱 일정 제목 편집 중 값 (null=보기)
  const [naverTitleDraft, setNaverTitleDraft] = useState<string | null>(null); // 네이버 일정 제목 편집 중 값
  useEffect(() => { setNaverTitleDraft(null); }, [naverDetail?.uid]);
  const [naverDupOpen, setNaverDupOpen] = useState<"복제" | "반복" | "익일" | null>(null);
  const [naverDupDate, setNaverDupDate] = useState("");
  const [naverDupBusy, setNaverDupBusy] = useState(false);
  const [naverDeleteConfirm, setNaverDeleteConfirm] = useState(false);
  const deleteNaverEvent = async () => {
    const ev = naverDetail;
    if (!ev) return;
    setNaverDeleteConfirm(false);
    try {
      await invokeEdgeFunction("naver-calendar-push", { action: "caldav_delete", uid: ev.uid, calId: ev.calendar_id });
      setNaverEvents((cur) => cur.filter((x) => x.uid !== ev.uid));
      setNaverDetail(null);
      notify("네이버 캘린더에서 삭제됐습니다 ✓", "success");
    } catch (e) {
      notify(`삭제 실패: ${(e as Error).message}`, "error");
    }
  };
  const duplicateNaverEvent = async (dates: string[]) => {
    const ev = naverDetail;
    if (!ev || naverDupBusy) return;
    setNaverDupBusy(true);
    let made = 0;
    try {
      for (const d of dates) {
        const r = await invokeEdgeFunction<{ uid?: string }>("naver-calendar-push", { action: "caldav_duplicate", uid: ev.uid, calId: ev.calendar_id, newDate: d });
        if (r.uid) { setNaverEvents((cur) => [...cur, { ...ev, uid: r.uid as string, date: d, completed: false }].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))); made += 1; }
      }
      notify(`${made}건 복제됐습니다 — 네이버 캘린더에도 생성 ✓`, "success");
      setNaverDupOpen(null);
    } catch (e) {
      notify(`복제 실패(${made}건까지 완료): ${(e as Error).message}`, "error");
    } finally { setNaverDupBusy(false); }
  };
  // 완료 체크 토글 — 네이버 일정을 옮기지 않고 완료 표시만 (네이버 앱에도 체크로 보임)
  const [naverCheckBusy, setNaverCheckBusy] = useState(false);
  const toggleNaverComplete = async (target?: NaverEventRow) => {
    const ev = target || naverDetail;
    if (!ev || naverCheckBusy) return;
    const done = !ev.completed;
    setNaverCheckBusy(true);
    try {
      await invokeEdgeFunction("naver-calendar-push", { action: "caldav_check", uid: ev.uid, calId: ev.calendar_id, done });
      setNaverEvents((cur) => cur.map((x) => (x.uid === ev.uid ? { ...x, completed: done } : x)));
      setNaverDetail((cur) => (cur && cur.uid === ev.uid ? null : cur));
      notify(done ? "네이버 일정 완료 처리 ✓" : "완료 해제됐습니다", "success");
    } catch (e) {
      notify(`완료 처리 실패: ${(e as Error).message}`, "error");
    } finally { setNaverCheckBusy(false); }
  };
  // 네이버 일정의 팀: 시간대 규칙(A=09, B=12, C=15, D=18)으로 유추 — 그 외 시간·종일은 팀 없음(항상 표시)
  const naverTeamOf = (ev: { time: string }): string | null => (({ "09:00": "A", "12:00": "B", "15:00": "C", "18:00": "D", "21:00": "E" } as Record<string, string>)[ev.time] || null);
  // 팀 필터 확장분: E(21시)·종일 — A~D와 똑같이 켜고 끌 수 있다
  const [visibleExtra, setVisibleExtra] = useState<string[]>(() => loadStoredFilter("cs_calendar_extra_v2", ["E", "종일", "기타"], ["E", "종일", "기타"]));
  useEffect(() => { try { localStorage.setItem("cs_calendar_extra_v2", JSON.stringify(visibleExtra)); } catch { /* 무시 */ } }, [visibleExtra]);
  const shownNaverEvents = useMemo(() => {
    const linked = new Set(tickets.map((t) => t.naverUid).filter(Boolean));
    return naverEvents.filter((ev) => {
      if (linked.has(ev.uid) || !visibleScheduleTypes.includes(naverCategoryOf(ev))) return false;
      if (!ev.time) return visibleExtra.includes("종일");           // 종일 일정(연차 등)
      const team = naverTeamOf(ev);
      if (team === "E") return visibleExtra.includes("E");          // 21시 = E팀 — 이제 필터를 따른다
      if (team) return visibleTeams.includes(team as Team);
      return true; // 기타 시간(팀 규칙 밖)은 항상 표시
    });
  }, [naverEvents, tickets, visibleScheduleTypes, visibleTeams, visibleExtra]);
  // 네이버 목록 뷰 구도(시간|분류|내용|팀)의 한 줄 행 — 목록 탭·그날 팝업 공용
  // 좌측 한 칸에 "C팀 (오후 3시)" — 팀 시간대와 다르면 실제 시각을 그대로 보여준다
  const teamTimeLabel = (team: string | null, time: string) => {
    // 팀이 있으면 항상 팀 시간대로 — 접수 시각(12:53 등)은 표에 따로 보여주지 않는다(접수시간 열 제거, 2026-08-25)
    if (team === "기타" && time) return Number(time.slice(0, 2)) < 12 ? `오전 ${time}` : `오후 ${time}`;
    if (team && time) return `${team}팀 (${TEAM_SLOT_LABEL[team] || time})`;
    if (team) return `${team}팀 (종일)`;
    if (time) return Number(time.slice(0, 2)) < 12 ? `오전 ${time}` : `오후 ${time}`;
    return "종일";
  };
  // 분류 짧은 라벨 — 칩이 "납품철수교체휴가교…"처럼 잘리는 것 방지 (색으로 캘린더 구분)
  const shortCat = (cat: string) => (cat === "납품철수교체휴가교육" ? "납품" : cat === "익일통합as" ? "익일as" : cat === "AS[완료]" ? "완료" : cat === "매월점검" ? "매월" : cat);
  const compactTicketRow = (t: AsTicket) => (
    <button key={t.id} type="button" onClick={() => { setNaverDayDate(null); setDetailId(t.id); }}
      className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition hover:bg-slate-50">
      <span className="w-[6.5rem] shrink-0 text-[11px] font-black tabular-nums text-slate-500">{teamTimeLabel(t.team, t.time)}</span>
      <span className="w-16 shrink-0 truncate text-[11px] font-bold text-slate-400">{guOf(t.address || "")}</span>
      <span className={`w-14 shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-black ${scheduleColor(t.scheduleType, t.status === "완료")}`}>{shortCat(displayTypeOf(t))}</span>
      <span className={`min-w-0 flex-1 truncate text-[12.5px] font-bold ${t.status === "완료" ? "text-slate-400 line-through" : "text-slate-800"}`}>{displayTitleOf(t)}{t.issue ? ` ｜ ${t.issue}` : ""}{t.address ? ` ｜ ${t.address}` : ""}</span>
    </button>
  );
  const compactNaverRow = (ev: NaverEventRow) => (
    <button key={ev.uid} type="button" onClick={() => { setNaverDayDate(null); setNaverDetail({ ...ev }); }}
      className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition hover:bg-slate-50">
      <span className="w-[6.5rem] shrink-0 text-[11px] font-black tabular-nums text-slate-500">{teamTimeLabel(naverTeamOf(ev), ev.time)}</span>
      <span className="w-16 shrink-0 truncate text-[11px] font-bold text-slate-400">{guOf(ev.location || "")}</span>
      <span className={`w-14 shrink-0 rounded border px-1.5 py-0.5 text-center text-[10px] font-black ${naverChipStyle(ev)}`}>{shortCat(naverCategoryOf(ev))}</span>
      <span className={`min-w-0 flex-1 truncate text-[12.5px] font-bold ${ev.completed ? "text-slate-400 line-through" : "text-slate-800"}`}>{ev.title || "(제목 없음)"}{ev.location ? ` ｜ ${ev.location}` : ""}</span>
    </button>
  );
  // 주소에서 지역구(송파구·광명시 등) 추출 — 표시·정렬용 (필터는 하지 않는다)
  const guOf = (addr: string) => {
    const a = String(addr || "");
    const gu = a.match(/[가-힣]{1,6}구(?=[\s\d]|$)/)?.[0];
    if (gu) return gu;
    const si = (a.match(/[가-힣]{1,6}시(?=[\s\d]|$)/g) || []).filter((x) => !/특별시|광역시$/.test(x));
    return si[si.length - 1] || "";
  };
  // 하루치 통합 행 — 정렬: 분류(납품철수교체 먼저 → 익일통합as) → 종일 먼저 → 시간 → 지역구
  const CAT_ORDER: Record<string, number> = { "납품철수교체휴가교육": 0, "익일통합as": 1, "AS[완료]": 2, "매월점검": 3 };
  const mergedDayRows = (date: string) => {
    const dayTickets = visibleTickets.filter((t) => t.date === date);
    const dayNaver = shownNaverEvents.filter((ev) => ev.date === date);
    const items = [
      ...dayTickets.map((t) => ({ kind: "ticket" as const, t, cat: CAT_ORDER[displayTypeOf(t)] ?? 9, time: t.time || "", gu: guOf(t.address || "") })),
      ...dayNaver.map((ev) => ({ kind: "naver" as const, ev, cat: CAT_ORDER[naverCategoryOf(ev)] ?? 9, time: ev.time || "", gu: guOf(ev.location || "") })),
    ];
    return items.sort((a, b) => a.cat - b.cat || (a.time === "" ? -1 : b.time === "" ? 1 : 0) || a.time.localeCompare(b.time) || a.gu.localeCompare(b.gu));
  };

  const [mobileSelectedDate, setMobileSelectedDate] = useState(todayYmd);
  const [dayFilter, setDayFilter] = useState<DayFilter>("today");
  // 일정 유형 필터 (중복 선택) — AS는 익일AS 포함, 전부 끄면 아무것도 안 보인다(자동 전체 복귀 없음)
  const LIST_TYPE_OPTIONS = ["AS", "AS[완료]", "납품철수교체휴가교육"] as const; // 매월점검은 캘린더 전용 — 일정리스트 제외
  const [listTypes, setListTypes] = useState<string[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem("cs_list_types_v2") || "null");
      if (Array.isArray(parsed)) return parsed.filter((item) => (LIST_TYPE_OPTIONS as readonly string[]).includes(item));
    } catch { /* 기본값 */ }
    return [...LIST_TYPE_OPTIONS];
  });
  const setListTypesPersist = (next: string[]) => {
    setListTypes(next);
    try { localStorage.setItem("cs_list_types_v2", JSON.stringify(next)); } catch { /* 무시 */ }
  };
  const toggleListType = (name: string) => {
    // 평범한 토글 — 켜진 걸 누르면 그것만 빠진다. 전부 꺼도 그대로 둔다
    const next = listTypes.includes(name) ? listTypes.filter((item) => item !== name) : [...listTypes, name];
    setListTypesPersist(next);
  };
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
    setTitleDraft(null);
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
  const stopMonthlySeries = async (base: AsTicket) => {
    const g = seriesGroupOf(base);
    const members = tickets.filter((t) => t.id !== base.id && seriesGroupOf(t) === g && t.repeatMonthly);
    if (!members.length) return;
    const future = members.filter((t) => t.date > base.date && t.status !== "완료");
    if (future.length && !await askConfirm(`매월 반복을 중지할까요?\n예정된 반복 일정 ${future.length}건이 함께 삭제됩니다.`)) return;
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
    if (changed && before?.repeatMonthly && !changed.repeatMonthly) void stopMonthlySeries(changed);
    // 배정자·제목이 바뀌면 네이버 일정 제목도 "이름-제목"으로 동기화 (수기로 캘린더에 이름 적던 작업 대체)
    if (changed && before && changed.naverUid && (changed.calendarTitle || "").trim()
      && (changed.assignee !== before.assignee || (changed.calendarTitle || "") !== (before.calendarTitle || ""))) {
      void invokeEdgeFunction("naver-calendar-push", { action: "caldav_update", uid: changed.naverUid, title: displayTitleOf(changed) })
        .catch((e) => notify(`네이버 제목 동기화 실패: ${(e as Error).message}`, "error"));
    }
    // 새로 배정된 사람에게 웹푸시 — 자기 이름이 걸린 일정을 바로 알게
    if (changed && before && changed.assignee && changed.assignee !== before.assignee) {
      void invokeEdgeFunction("push-send", {
        title: `일정 배정 — ${(changed.calendarTitle || "").trim() || changed.vendor || "일정"}`.slice(0, 80),
        body: `${changed.date} ${changed.time || ""} · ${changed.team}팀`.trim(),
        tag: `assign-${changed.id}`,
        category: "assign",
        targets: [changed.assignee],
      }).catch(() => undefined);
    }
    // 네이버 미러 동기화: 완료되면 팀 완료 캘린더(예: C→강남C as)로 이동, 날짜·시간이 바뀌면(익일 연기 등) 일정 시간 이동
    if (changed && before && changed.naverUid) {
      const completedNow = changed.status === "완료" && before.status !== "완료";
      const rescheduled = changed.date !== before.date || changed.time !== before.time;
      const uncompletedNow = before.status === "완료" && changed.status !== "완료";
      const isDelivery = changed.scheduleType === "납품철수교체휴가교육" || changed.scheduleType === "물류";
      if ((completedNow || uncompletedNow) && isDelivery) {
        // 납품·철수·교체 캘린더는 영업부 소관 — 웹앱에서 완료/취소해도 네이버는 건드리지 않는다(2026-08-26 결정; 예전엔 제자리 체크를 했다)
        if (completedNow) notify("물류 일정은 웹앱에서만 완료 처리됩니다 — 네이버 캘린더(납품철수교체)는 영업부가 관리", "success");
      } else if (completedNow) {
        void invokeEdgeFunction<{ status?: string; toCalendarId?: string }>("naver-calendar-push", { action: "caldav_move", uid: changed.naverUid, team: changed.team })
          // 팀 완료 캘린더가 아직 설정되지 않으면 함수가 제자리에서 완료 체크만 한다 — 그때 "이동"이라 알리면 거짓이다
          .then((r) => {
            if (r.status !== "moved") return;
            const moved = !!r.toCalendarId && r.toCalendarId !== NAVER_CAL_LIST[0].id;
            notify(moved ? `네이버: ${DONE_CAL_LABEL[changed.team]} 캘린더로 이동 + 완료 체크 ✓` : "네이버: 완료 체크 ✓ (이 팀은 완료 캘린더가 설정되지 않아 제자리에서 체크)", "success");
          })
          .catch((e) => notify(`네이버 완료 이동 실패: ${(e as Error).message}`, "error"));
      } else if (uncompletedNow) {
        void invokeEdgeFunction<{ status?: string }>("naver-calendar-push", { action: "caldav_move", uid: changed.naverUid, team: changed.team, direction: "back" })
          .then((r) => { if (r.status === "restored") notify("네이버: 일정이 원래 캘린더로 복귀 (완료 체크 해제) ✓", "success"); })
          .catch((e) => notify(`네이버 복귀 실패: ${(e as Error).message}`, "error"));
      } else if (rescheduled) {
        // 팀=시간 규칙이라 시간이 바뀌면(팀 변경) 네이버 일정 시간도 함께 옮긴다
        void invokeEdgeFunction("naver-calendar-push", { action: "caldav_update", uid: changed.naverUid, date: changed.date, ...(changed.time && changed.time !== before.time ? { time: changed.time } : {}) })
          .catch((e) => notify(`네이버 일정 변경 실패: ${(e as Error).message}`, "error"));
      }
    }
    // 서비스접수에서 넘어온 일정이면 처리 상태를 접수 리스트에도 반영
    // 접수 → (배정) 진행중 → (완료) 완료 — 배정 해제·완료 취소는 다시 접수로
    if (changed && before && changed.receptionId && changed.status !== before.status) {
      // 같은 접수에 티켓이 여러 개면(재방문 등) 최고 단계로 집계 —
      // B 티켓의 배정 해제가 A 티켓의 완료를 "접수"로 되돌리는 사고 방지
      const mappedOf = (st: string) => (st === "완료" ? "완료" : st === "배정" ? "진행중" : "접수");
      const rank: Record<string, number> = { 완료: 2, 진행중: 1, 접수: 0 };
      const siblings = next.filter((t) => t.receptionId === changed.receptionId);
      const mapped = siblings.map((t) => mappedOf(t.status)).reduce((a, b) => (rank[a] >= rank[b] ? a : b), "접수");
      // 완료면 처리 시각·처리자(완료시킨 티켓의 담당)도 접수 리스트에 남긴다 — 원격의 처리완료 열과 대칭
      const doneTicket = siblings.find((t) => t.status === "완료") || changed;
      const done = mapped === "완료"
        ? { at: new Date().toISOString(), by: doneTicket.assignee || author || "" }
        : { at: null, by: "" };
      void setServiceReceptionStatus(changed.receptionId, mapped, done).catch(() => { /* 접수 동기화 실패는 일정 기능에 영향 없음 */ });
      // 접수 시트 BD열(처리완료) 기입 — 완료/익일은 표기, 완료·익일에서 되돌리면 "-"
      // 행번호가 있으면 그 행, 없으면(과거 접수) 퍼스트순으로 최신 행을 찾아 갱신
      const bdText = changed.status === "완료" ? "완료" : changed.status === "익일" ? "익일" : (before.status === "완료" || before.status === "익일") ? "-" : "";
      if (bdText) {
        void (async () => {
          try {
            const reception = await getServiceReceptionById(changed.receptionId!);
            if (reception && reception.type === "복합기 AS" && reception.lease_no) {
              const now = new Date();
              const stamp = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
              const doneText = bdText === "-" ? "-" : `${bdText} ${stamp}${bdText === "완료" && done.by ? ` ${done.by}` : ""}`;
              await sendReceptionCopierCompleteJob({ author: reception.author, vendor: reception.vendor, firstNo: reception.lease_no, sheetRow: reception.sheet_row ?? null, doneText });
            }
          } catch { /* 시트 반영 실패는 DB 상태에 영향 없음 */ }
        })();
      }
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

  // 간소 일정 추가(캘린더용) — 제목·날짜·팀·장소·내용·캘린더(분류)·매월반복만
  const [simpleAdd, setSimpleAdd] = useState<{ date: string; title: string; team: Team; address: string; note: string; cal: ScheduleType; repeat: boolean } | null>(null);
  const openSimpleAdd = (date: string) => setSimpleAdd({ date, title: "", team: (teams.find((t) => visibleTeams.includes(t)) || "A") as Team, address: "", note: "", cal: "AS", repeat: false });
  const submitSimpleAdd = () => {
    const f = simpleAdd;
    if (!f || !f.title.trim()) return;
    const created = normalizeTicketSchedule({
      ...blankTicket(f.date, {}),
      team: f.team, time: TEAM_SLOT[f.team] || "09:00",
      vendor: f.title.trim().slice(0, 80), calendarTitle: f.title.trim().slice(0, 120),
      address: f.address.trim(), note: f.note, scheduleType: f.cal, repeatMonthly: f.repeat,
    });
    setTickets([...tickets, created]);
    persistRemote(created);
    if (created.repeatMonthly) ensureMonthlySeries(created);
    setSimpleAdd(null);
    notify("일정이 추가됐습니다 ✓", "success");
    // 3면 동기화: 매월점검(웹앱 전용) 외에는 네이버 캘린더에도 등록 — 분류에 맞는 캘린더로
    if (f.cal !== "매월점검") {
      const calId = f.cal === "납품철수교체휴가교육" ? NAVER_DELIVERY_CAL : NAVER_CAL_LIST[0].id;
      void invokeEdgeFunction<{ uid?: string }>("naver-calendar-push", {
        stableKey: created.id, calId,
        title: created.calendarTitle || created.vendor, date: created.date, time: created.time || "09:00",
        location: created.address || "", description: created.note || "",
      }).then((r) => {
        if (!r.uid) return;
        const uid = r.uid;
        // update()는 이 콜백이 잡은 클로저의 tickets(생성 전 배열)를 봐서 방금 만든 일정을 못 찾는다
        // — naverUid가 유실되면 네이버 쪽 수정·삭제·완료가 웹앱으로 돌아오지 못한다
        setTicketsState((current) => current.map((t) => (t.id === created.id ? { ...t, naverUid: uid } : t)));
        void trackWrite(updateRows("as_tickets", `id=eq.${encodeURIComponent(created.id)}`, { naverUid: uid }), "네이버 연결 저장 실패 — 이 일정은 네이버 쪽 수정이 웹앱에 반영되지 않습니다.");
        notify("네이버 캘린더에도 등록됐습니다 ✓", "success");
        if (created.repeatMonthly) {
          // 반복 클론도 네이버에 사본 생성 (표시 동기 — 개별 수정 연동은 원본만)
          void (async () => {
            let d = created.date;
            for (let k = 0; k < 11; k++) {
              d = nextMonthSameDay(d);
              await invokeEdgeFunction("naver-calendar-push", { action: "caldav_duplicate", uid: r.uid, calId, newDate: d }).catch(() => undefined);
            }
          })();
        }
      }).catch((e) => notify(`네이버 등록 실패(웹앱 일정은 정상): ${(e as Error).message}`, "error"));
    }
  };
  // 삭제는 디자인 확인 모달을 거친다 (브라우저 confirm 대체) — 확정 시 doRemoveTicket 실행
  const [deleteTarget, setDeleteTarget] = useState<AsTicket | null>(null);
  const removeTicket = (ticket: AsTicket) => { setDeleteTarget(ticket); return false; };
  const doRemoveTicket = (ticket: AsTicket) => {
    setTickets(tickets.filter((item) => item.id !== ticket.id));
    removeRemote(ticket.id);
    if (ticket.naverUid) void invokeEdgeFunction("naver-calendar-push", { action: "caldav_delete", uid: ticket.naverUid }).catch(() => { /* CalDAV 미설정·실패 시 네이버에서 직접 삭제 */ });
    setDetailId("");
    setDeleteTarget(null);
    notify("일정이 삭제됐습니다" + (ticket.naverUid ? " — 네이버 캘린더 미러도 함께 삭제 ✓" : " ✓"), "success");
  };

  // 완료·연기 사유 공유: 팀 AS방으로 "업체명 - 라벨 / 줄바꿈 / 내용" 전송 + 네이버 일정 내용에 기록.
  // 사유를 비우면 아무 것도 보내지 않는다 (조용한 완료/연기 — 기존 동작 유지)
  // 처리 양식(완료·연기 공통) — 카톡방·네이버 일정 내용·웹앱 일정 메모가 전부 같은 블록으로 동기화된다.
  // 양식 만들기는 actionBlock.ts에 모아 뒀다 (FIELD 익일 미루기와 같은 함수 — 예전엔 따로 만들어
  // 한쪽만 고쳐지고 일정리스트 완료 건은 계속 "기종: - / 자산기번: -"로 나갔다)
  const buildActionBlock = (ticket: AsTicket, reason: string, deferLabel?: string, condense = true) =>
    buildShareBlock(ticket as unknown as ActionTicketLike, { author: author || ticket.assignee, reason, deferLabel, condense });
  const shareActionReason = async (ticket: AsTicket, label: string, reason: string) => {
    const text = reason.trim();
    if (!text) return;
    const block = buildActionBlock(ticket, reason, label || undefined);
    // 납품·철수·교체는 영업부 소관 — 팀 AS방이 아니라 완료방(납품,철수,교체)으로 보낸다
    const isDelivery = ticket.scheduleType === "납품철수교체휴가교육" || ticket.scheduleType === "물류";
    // 납품·철수·교체를 일정리스트 버튼으로 완료/연기할 땐 카톡을 보내지 않는다(2026-08-25 결정) —
    // 물류방 보고는 FIELD 전송이 담당하고, 여기선 웹 일정 상태와 네이버 일정 기록만 남긴다.
    if (!isDelivery) {
      void sendServiceReception("AS", `수도권${ticket.team}`, block)
        .then((r) => { if (!r.ok) notify(`카톡 전송 실패: ${r.error}`, "error"); })
        .catch((e) => notify(`카톡 전송 실패: ${(e as Error).message}`, "error"));
    }
    if (ticket.naverUid) {
      try {
        const cur = await invokeEdgeFunction<{ description?: string }>("naver-calendar-push", { action: "caldav_get", uid: ticket.naverUid });
        await invokeEdgeFunction("naver-calendar-push", { action: "caldav_update", uid: ticket.naverUid, description: `${cur.description || ""}\n\n${block}` });
      } catch (e) {
        notify(`네이버 일정 기록 실패: ${(e as Error).message}`, "error");
      }
    }
  };
  // 완료 사유 입력 모달 대상 (완료 취소는 사유 없이 즉시)
  const [doneTicket, setDoneTicket] = useState<AsTicket | null>(null);
  const openDone = (ticket: AsTicket) => { if (ticket.status === "완료") toggleDone(ticket); else setDoneTicket(ticket); };
  const applyDone = async (reason: string) => {
    const ticket = doneTicket;
    setDoneTicket(null);
    if (!ticket) return;
    // 상태 저장을 먼저 — 카톡·네이버 왕복을 기다리는 사이 모바일이 카톡으로 전환되면 fetch가 끊겨
    // "네이버 기록 실패"만 뜨고 완료 저장이 영영 안 되던 실사고(2026-08-25). 기록은 뒤에서 이어 남긴다.
    const block = buildActionBlock(ticket, reason);
    toggleDone(ticket, { note: `${(ticket.note || "").trim() ? `${ticket.note}\n\n` : ""}${block}` }); // 웹앱 일정 메모에도 동일 기록
    void shareActionReason(ticket, "", reason);
  };

  const toggleDone = (ticket: AsTicket, extraPatch: Partial<AsTicket> = {}) => {
    const completing = ticket.status !== "완료";
    update(ticket.id, { status: completing ? "완료" : (ticket.assignee ? "배정" : "접수"), ...extraPatch });
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

  const applyDefer = (date: string, reason = "") => {
    if (!deferTicket || !date) return;
    const ticket = deferTicket;
    const isAsSchedule = ticket.scheduleType === "AS" || ticket.scheduleType === "익일AS";
    setDeferId("");
    const deferLabel = `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}로 연기`;
    const notePatch = reason.trim() ? { note: `${(ticket.note || "").trim() ? `${ticket.note}\n\n` : ""}${buildActionBlock(ticket, reason, deferLabel, false)}` } : {};
    // 날짜·상태 저장 먼저, 카톡·네이버 기록은 뒤에 (applyDone과 같은 이유)
    update(ticket.id, { date, status: isAsSchedule ? "익일" : ticket.status, scheduleType: isAsSchedule ? "익일AS" : ticket.scheduleType, ...notePatch });
    void shareActionReason(ticket, deferLabel, reason);
  };

  /**
   * 중간보고 본문 생성 — 팀 관행 양식 그대로:
   *   "12시 1차 중간보고 / (진행중인 업무는 * 표시) / --- / 금일 처리예정 / #이름 / •이름 업체 기종 내용 …"
   * 규칙: 완료된 건은 자동으로 빠진다(완료 여부를 눈으로 대조하던 일이 이 기능의 이유).
   *       오늘 연기 처리한 건은 '익일변경'에 → 날짜와 함께. 진행중 * 표시는 사람이 아는 것이라 손으로.
   */
  const buildMidReport = (reportTeam: Team) => {
    // 필수 일정만 — 자동일정으로 만든 점검 동선(source=autoplan)과 매월점검은 개인 계획이지 보고 대상이 아니다
    const teamTickets = tickets.filter((ticket) =>
      ticket.team === reportTeam && !/휴가|연차/.test(ticket.vendor) && ticket.scheduleType !== "휴가"
      && ticket.source !== "autoplan" && ticket.scheduleType !== "매월점검");
    // CS 팀원 이름이 배정된 건만 — 물류 인원 등 다른 이름의 건은 그쪽에서 소화한다.
    // 순서: 팀장 최상단 → 부파트장(명단 첫 번째) → 동급 순 (명단 순서 그대로)
    const order = reportOrder(reportTeam);
    const assigneeOf = (ticket: AsTicket) => reportAssignee(ticket, order);
    const isLogistics = (t: AsTicket) => t.scheduleType === "납품철수교체휴가교육" || t.scheduleType === "물류";
    const cut = (value: string, max: number) => (value.length > max ? `${value.slice(0, max)}…` : value);
    // 기종 초단축: 괄호 별명("헤라클래스")이 있으면 그것, 없으면 브랜드 접두를 뗀 짧은 표기
    const shortModel = (model: string) => {
      const nick = model.match(/\(([가-힣A-Za-z0-9]{2,8})\)/)?.[1];
      if (nick) return nick;
      return cut(model.replace(/^(SL-|APEOS-|ApeosPort-?V?\s*|ECOSYS-|DocuCentre-?V?\s*|DocuPrint-?)/i, "").trim(), 9);
    };
    const lineOf = (ticket: AsTicket) => {
      // 납품·철수: 고객사 + 품목(괄호 설명 제거) + 구분만 — "•뉴트리원 노트북 2대 납품"
      if (ticket.scheduleType === "납품철수교체휴가교육" || ticket.scheduleType === "물류") {
        const info = logisticsTicketInfo(ticket.vendor);
        if (info.vendor) {
          const item = info.item.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
          return `•${cut(historyCoreName(info.vendor) || info.vendor, 12)} ${cut(item, 14)} ${info.category}`.replace(/\s+/g, " ").trim();
        }
      }
      // 업체명: 법인표기·위치 꼬리를 벗긴 핵심 이름만
      const name = assigneeOf(ticket);
      // "A/S"의 슬래시는 구분자가 아니다 — 잠깐 다른 글자로 바꿔 보호하고 자른 뒤 되돌린다
      let raw = ticket.vendor.replace(/A\/S/g, "A\u2044S").split(/\s*>\s*/)[0].split("/")[0].replace(/A\u2044S/g, "A/S");
      if (name) raw = raw.replace(new RegExp(`^\\s*${escapeRegExp(name)}\\s*[-–—:\\s]*`), "");
      const vendor = cut(historyCoreName(raw) || fieldTicketVendor(raw).vendor || raw.trim(), 12);
      const issue = extractIssue(ticket.issue, ticket.note).replace(/\s+/g, " ");
      const category = extractCategory(ticket.vendor, ticket.calendarTitle, name);
      return ["•" + vendor, ticket.model ? shortModel(ticket.model) : "", category, cut(issue, 14)].filter(Boolean).join(" ");
    };
    const todays = teamTickets.filter((ticket) =>
      ticket.date === todayYmd && ticket.status !== "완료" && order.includes(assigneeOf(ticket)));
    // 담당자가 아직 없는 AS 접수 건(제목에도 이름 없음) — "#미배정"으로 묶어 빠뜨리지 않는다 (이름 없는 납품은 물류 몫이라 제외)
    const unassigned = teamTickets.filter((ticket) =>
      ticket.date === todayYmd && ticket.status !== "완료" && !assigneeOf(ticket) && !isLogistics(ticket));
    const groups: string[] = [];
    for (const name of order) {
      const mine = todays.filter((ticket) => assigneeOf(ticket) === name);
      if (mine.length) {
        if (groups.length) groups.push("");   // 이름 사이 빈 줄 — 카톡에서 사람별로 끊어 읽힌다
        groups.push(`#${name}`, ...mine.map(lineOf));
      }
    }
    if (unassigned.length) {
      if (groups.length) groups.push("");
      groups.push("#미배정", ...unassigned.map(lineOf));
    }
    // 익일일정 — 다음 영업일에 잡힌 팀 일정 전부. 누가 갈지 아직 모르니 이름 없이 적는다.
    // 오늘 익일로 넘긴 건도 날짜가 내일이면 자연히 여기 들어오고, 이름 없는 납품은 물류 몫이라 금일과 같은 기준으로 뺀다.
    const tomorrows = teamTickets.filter((ticket) =>
      ticket.date === tomorrowYmd && ticket.status !== "완료" && (!isLogistics(ticket) || order.includes(assigneeOf(ticket))));
    // 모레 이후(주말 포함)로 연기한 건 — 연기 기록 "(M/D로 연기)"가 남아 있으면 연기 이력으로 본다.
    // 마크의 날짜를 현재 날짜와 정확 대조하던 방식은 물류 건(status가 익일이 안 됨)과
    // 연기 후 날짜를 다시 옮긴 건, 토요일로 연기한 건을 보고에서 통째로 빠뜨렸다.
    const deferredLater = teamTickets.filter((ticket) =>
      ticket.date > todayYmd && ticket.date !== tomorrowYmd && ticket.status !== "완료"
      && /\(\d{1,2}\/\d{1,2}로 연기\)/.test(ticket.note || ""));
    const tomorrowLines = [
      ...tomorrows.map(lineOf),
      ...deferredLater.map((ticket) => `${lineOf(ticket)} → ${Number(ticket.date.slice(5, 7))}/${Number(ticket.date.slice(8, 10))}`),
    ];
    return [
      `${reportStamp()} 중간보고`,
      "(진행중인 업무는 * 표시)",
      "",
      REPORT_SEP,
      "금일 처리예정",
      "",
      ...(groups.length ? groups : ["없음"]),
      "",
      REPORT_SEP,
      "익일일정",
      ...(tomorrowLines.length ? ["", ...tomorrowLines] : []),
      "",
      REPORT_SEP,
      "특이사항",   // 자동으로 못 채우는 칸 — 보내기 전에 손으로 적거나 비워 둔다
    ].join("\n");
  };
  /**
   * 보고 열기·재생성 — 규칙 기반 본문을 즉시 띄우고, AI(report-polish)가 줄을 사람 수준으로
   * 다듬어 교체한다("쇼군웨이크스노우보드 3220 용지제거 후 소음"). 실패하면 규칙 기반 그대로.
   */
  const composeMidReport = (reportTeam: Team) => {
    const seq = ++midReportSeq.current;
    // AI에 넘길 재료 — buildMidReport와 같은 필터·순서 (그쪽 규칙이 바뀌면 여기도 함께)
    const order = reportOrder(reportTeam);
    const assigneeOf = (ticket: AsTicket) => reportAssignee(ticket, order);
    const eligible = tickets.filter((ticket) =>
      ticket.team === reportTeam && !/휴가|연차/.test(ticket.vendor) && ticket.scheduleType !== "휴가"
      && ticket.source !== "autoplan" && ticket.scheduleType !== "매월점검");
    const isLogistics = (t: AsTicket) => t.scheduleType === "납품철수교체휴가교육" || t.scheduleType === "물류";
    const pending = [
      ...order.flatMap((name) =>
        eligible.filter((ticket) => ticket.date === todayYmd && ticket.status !== "완료" && assigneeOf(ticket) === name)
          .map((ticket) => ({ name, ticket }))),
      ...eligible.filter((ticket) => ticket.date === todayYmd && ticket.status !== "완료" && !assigneeOf(ticket) && !isLogistics(ticket))
        .map((ticket) => ({ name: "미배정", ticket })),
    ];
    const tomorrows = eligible.filter((ticket) =>
      ticket.date === tomorrowYmd && ticket.status !== "완료" && (!isLogistics(ticket) || order.includes(assigneeOf(ticket))));
    const deferredLater = eligible.filter((ticket) =>
      ticket.date > todayYmd && ticket.date !== tomorrowYmd && ticket.status !== "완료"
      && /\(\d{1,2}\/\d{1,2}로 연기\)/.test(ticket.note || ""));
    // 진단 줄 — "왜 안 뜨지?"를 원격으로 잡기 위한 단계별 건수 (모달에만 표시, 복사 안 됨)
    const todayAll = tickets.filter((ticket) => ticket.date === todayYmd && ticket.status !== "완료");
    const todayTeam = eligible.filter((ticket) => ticket.date === todayYmd && ticket.status !== "완료");
    const diag = pending.length ? undefined
      : `오늘 ${todayYmd} · 전체 ${todayAll.length}건 → ${reportTeam}팀 ${todayTeam.length}건 → 이름매칭 0건 · 명단 ${order.join("·")}`;
    // 규칙 기반 초안은 화면에 먼저 보여주지 않는다 — 거친 줄이 헷갈리게 한다. AI 실패 시의 대체본으로만 쓴다.
    const draft = buildMidReport(reportTeam);
    const payload = [...pending.map((entry) => entry.ticket), ...tomorrows, ...deferredLater].map((ticket) => ({
      vendor: ticket.vendor,
      title: ticket.calendarTitle || "",
      note: (ticket.note || "").split(/\n/).slice(0, 3).join(" ").slice(0, 240),
      model: ticket.model,
      issue: extractIssue(ticket.issue, ticket.note),
      category: extractCategory(ticket.vendor, ticket.calendarTitle, reportAssignee(ticket, order)),
      kind: ticket.scheduleType === "납품철수교체휴가교육" || ticket.scheduleType === "물류" ? "물류" : "as",
    }));
    if (!payload.length) { setMidReport({ team: reportTeam, text: draft, polishing: false, diag }); return; }
    setMidReport({ team: reportTeam, text: "", polishing: true, diag });
    const fallback = () => setMidReport((cur) => (cur && midReportSeq.current === seq ? { ...cur, text: draft, polishing: false } : cur));
    void invokeEdgeFunction<{ lines: string[] }>("report-polish", { lines: payload })
      .then((res) => {
        if (midReportSeq.current !== seq) return;
        // 개수 불일치(edge는 40건까지만 다듬는다)·빈 줄이면 통째로 초안 폴백 — "•undefined" 방지
        if (!Array.isArray(res.lines) || res.lines.length !== payload.length
          || res.lines.some((line) => typeof line !== "string" || !line.trim())) { fallback(); return; }
        let index = 0;
        const groups: string[] = [];
        for (const name of [...order, "미배정"]) {
          const mine = pending.filter((entry) => entry.name === name);
          if (mine.length) {
            if (groups.length) groups.push("");   // 이름 사이 빈 줄
            groups.push(`#${name}`, ...mine.map(() => `•${res.lines[index++]}`));
          }
        }
        const tomorrowLines = [
          ...tomorrows.map(() => `•${res.lines[index++]}`),
          ...deferredLater.map((ticket) => `•${res.lines[index++]} → ${Number(ticket.date.slice(5, 7))}/${Number(ticket.date.slice(8, 10))}`),
        ];
        const text = [
          `${reportStamp()} 중간보고`,
          "(진행중인 업무는 * 표시)",
          "",
          REPORT_SEP,
          "금일 처리예정",
          "",
          ...(groups.length ? groups : ["없음"]),
          "",
          REPORT_SEP,
          "익일일정",
          ...(tomorrowLines.length ? ["", ...tomorrowLines] : []),
          "",
          REPORT_SEP,
          "특이사항",
        ].join("\n");
        setMidReport((cur) => (cur && midReportSeq.current === seq ? { ...cur, text, polishing: false } : cur));
      })
      .catch(fallback);
  };
  const openMidReport = () => {
    const myTeam = (Object.keys(teamAssignees) as Team[]).find((t) => teamAssignees[t].includes(author)) || (teams.includes(team as Team) ? team as Team : "C");
    composeMidReport(myTeam);
  };

  const targetDate = dayFilter === "today" ? todayYmd : tomorrowYmd;
  // 팀·유형·날짜만 거른 기준 행 — 직원 칩의 건수 배지와 목록이 같은 범위를 본다
  const baseRows = tickets.filter((ticket) => {
    if (ticket.scheduleType === "매월점검") return false; // 매월점검은 캘린더에서만 (날짜 맞춰 가면 되는 것들)
    if (team === "종일") { if (ticket.time) return false; }
    else if (team !== "ALL" && ticket.team !== team) return false;
    const dt = displayTypeOf(ticket); // 익일통합as / AS[완료] / 납품철수교체휴가교육
    if (!listTypes.includes(dt === "익일통합as" ? "AS" : dt)) return false;
    if (dayFilter === "today") return ticket.date === todayYmd;
    if (dayFilter === "tomorrow") return ticket.date === tomorrowYmd;
    return ticket.date > todayYmd && ticket.date !== tomorrowYmd;
  });
  // 네이버 오버레이(종일 연차·회의 등 티켓으로 수입 안 된 것)도 같은 조건으로 걸러 리스트에 한 몸으로 합친다
  const naverBase = useMemo(() => {
    const linked = new Set(tickets.map((t) => t.naverUid).filter(Boolean));
    return naverEvents.filter((ev) => {
      if (linked.has(ev.uid)) return false;
      const cat = naverCategoryOf(ev);
      if (!listTypes.includes(cat === "익일통합as" ? "AS" : cat)) return false;
      const evTeam = ev.time ? (naverTeamOf(ev) || "기타") : "종일";
      if (team === "종일") { if (ev.time) return false; }
      else if (team !== "ALL" && evTeam !== team) return false;
      if (dayFilter === "today") return ev.date === todayYmd;
      if (dayFilter === "tomorrow") return ev.date === tomorrowYmd;
      return ev.date > todayYmd && ev.date !== tomorrowYmd;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naverEvents, tickets, listTypes, team, dayFilter, todayYmd, tomorrowYmd]);
  // 행에서 바로 전화 — 접수자 연락처·키맨의 첫 번호만. 없으면 버튼을 만들지 않는다 (제목에서 긁으면 엉뚱한 숫자가 잡힘)
  /**
   * 행에서 바로 전화 — 접수자·키맨 번호.
   * 컬럼(contact·keyman)이 비어 있는 일정(네이버 수입 건)은 번호가 접수 원문(note)에만 있어
   * 통화 버튼이 아예 안 나왔다 → 원문의 "접수자성함/접수자연락처", "★키맨성함/번호"에서 이름까지 뽑는다.
   * 제목에서 숫자를 긁으면 엉뚱한 번호(기번·자산번호)가 잡히므로 라벨 옆 번호만 인정한다.
   */
  const PHONE_RE = /01\d[- ]?\d{3,4}[- ]?\d{4}|0\d{1,2}[- ]?\d{3,4}[- ]?\d{4}/;
  const phonesOf = (t: AsTicket): Array<{ label: string; name: string; number: string }> => {
    const out: Array<{ label: string; name: string; number: string }> = [];
    const push = (label: string, name: string, raw: string) => {
      const number = (raw.match(PHONE_RE) || [])[0] || "";
      if (!number) return;
      const digits = number.replace(/[^0-9]/g, "");
      if (out.some((p) => p.number.replace(/[^0-9]/g, "") === digits)) return;
      // 양식 라벨이 값에 섞여 오는 건이 있다("★키맨성함/번호 정수호주") — 라벨·기호를 걷어낸 이름만 남긴다
      const clean = name
        .replace(PHONE_RE, "")
        .replace(/★|키맨성함\/?번호|키맨|접수자성함|접수자연락처|일반전화|[()]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      out.push({ label, name: clean.slice(0, 14), number });
    };
    push("접수자", "", t.contact || "");
    push("키맨", (t.keyman || "").replace(PHONE_RE, ""), t.keyman || "");
    const raw = String(t.note || "").replace(/_x000d_/g, " ");
    const field = (label: RegExp) => (raw.match(label) || [])[1] || "";
    push("접수자", field(/접수자성함[\t ]*([^\t\n]*)/), field(/접수자연락처[\t ]*([^\t\n]*)/));
    push("키맨", field(/키맨성함\/번호[\t ]*([^\t\n]*)/).replace(PHONE_RE, "").replace(/[()]/g, ""), field(/키맨성함\/번호[\t ]*([^\t\n]*)/));
    push("일반전화", "", field(/일반전화[\t ]*([^\t\n]*)/));
    return out;
  };

  /** 통화 버튼 — 번호가 하나면 바로 연결, 접수자·키맨이 둘 다 있으면 골라 걸도록 (잘못된 상대에게 걸리지 않게) */
  const CallButton = ({ ticket, compact }: { ticket: AsTicket; compact?: boolean }) => {
    const list = phonesOf(ticket);
    const [open, setOpen] = useState(false);
    if (!list.length) return null;
    const cls = compact
      ? "flex-1 rounded-full bg-emerald-600 px-2 py-1.5 text-center text-[11px] font-black text-white"
      : "shrink-0 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-black text-white transition hover:bg-emerald-700";
    if (list.length === 1) {
      return (
        <a href={`tel:${list[0].number.replace(/[^0-9]/g, "")}`} onClick={(e) => e.stopPropagation()} className={cls}
          title={`${list[0].label}${list[0].name ? ` ${list[0].name}` : ""} ${list[0].number}`}>📞</a>
      );
    }
    return (
      <span className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => setOpen((v) => !v)} className={cls} title="통화 — 접수자·키맨 선택">📞 {list.length}</button>
        {open && (
          <span className="absolute bottom-full right-0 z-30 mb-1 flex min-w-[190px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            {list.map((phone) => (
              <a key={phone.number} href={`tel:${phone.number.replace(/[^0-9]/g, "")}`} onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2.5 text-left text-xs font-black text-slate-800 transition hover:bg-emerald-50">
                <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">{phone.label}</span>
                <span className="min-w-0 flex-1 truncate">{phone.name || phone.number}</span>
                {phone.name && <span className="shrink-0 text-[10px] font-bold tabular-nums text-slate-400">{phone.number.slice(-4)}</span>}
              </a>
            ))}
          </span>
        )}
      </span>
    );
  };
  // 상태 요약 바: 전체/미배정/진행/완료 — 클릭하면 그 상태만 (아침에 "뭐부터"가 바로 보이게)
  const [statusPick, setStatusPick] = useState<"" | "미배정" | "배정" | "완료">("");
  const statusOf = (t: AsTicket) => (t.status === "완료" ? "완료" : t.assignee ? "배정" : "미배정");
  const statusCounts = useMemo(() => {
    const c = { 전체: baseRows.length + naverBase.length, 미배정: 0, 배정: 0, 완료: 0 };
    for (const t of baseRows) c[statusOf(t)] += 1;
    for (const ev of naverBase) c[ev.completed ? "완료" : "미배정"] += 1;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseRows, naverBase]);
  const scheduleRows = baseRows.filter((ticket) => !(statusPick && statusOf(ticket) !== statusPick)).sort((a, b) => {
    // 이름별로 묶어서 표시 — 미배정 먼저, 그 다음 이름순 (여러 직원 일정이 섞여 뒤죽박죽되지 않게)
    const ka = a.assignee || "";
    const kb = b.assignee || "";
    if (ka !== kb) return ka === "" ? -1 : kb === "" ? 1 : ka.localeCompare(kb, "ko");
    // 같은 사람 안에서는 날짜 → 구분(납품 먼저→익일as) → 지역구(성동구끼리 모임) → 시간 → 제목 이름순
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    const ca = CAT_ORDER[displayTypeOf(a)] ?? 9, cb = CAT_ORDER[displayTypeOf(b)] ?? 9;
    if (ca !== cb) return ca - cb;
    const ga = guOf(a.address || ""), gb = guOf(b.address || "");
    if (ga !== gb) return ga.localeCompare(gb, "ko");
    if ((a.time || "") !== (b.time || "")) return (a.time || "").localeCompare(b.time || "");
    return displayTitleOf(a).localeCompare(displayTitleOf(b), "ko");
  });
  const listNaver = naverBase.filter((ev) => !statusPick || (ev.completed ? "완료" : "미배정") === statusPick)
    .sort((a, b) => a.date.localeCompare(b.date) || ((CAT_ORDER[naverCategoryOf(a)] ?? 9) - (CAT_ORDER[naverCategoryOf(b)] ?? 9)) || guOf(a.location || "").localeCompare(guOf(b.location || ""), "ko") || (a.time || "").localeCompare(b.time || "") || (a.title || "").localeCompare(b.title || "", "ko"));

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
      if (ticket.source === "autoplan") return false; // 자동일정 생성 건은 캘린더를 어지럽히지 않는다 (내 일정·일정리스트에는 표시)
      if (!visibleScheduleTypes.includes(displayTypeOf(ticket))) return false;
      if (!ticket.time) return visibleExtra.includes("종일");
      if (ticket.team === "E") return visibleExtra.includes("E");
      if (ticket.team === "기타") return visibleExtra.includes("기타");
      return visibleTeams.includes(ticket.team);
    }),
    [tickets, visibleScheduleTypes, visibleTeams, visibleExtra],
  );
  const monthTickets = visibleTickets.filter((ticket) => ticket.date.slice(0, 7) === currentMonth.slice(0, 7));

  // 일정 추가 기본값: 캘린더에서 체크된 팀·업무종류 중 첫 값 (예: B팀+매월점검만 켜두면 그대로 미리 채움)

  const toggleScheduleFilter = (filter: DisplayFilter) => {
    setVisibleScheduleTypes((current) => current.includes(filter) ? current.filter((item) => item !== filter) : [...current, filter]);
  };


  return (
    <div className="space-y-5">
      {!!syncError && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-bold text-amber-700">{syncError}</div>}

      {view === "calendar" ? (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex min-h-[720px] flex-col lg:flex-row">
            {/* 필터 — PC는 세로 사이드바, 모바일은 한 줄 툴바(팀·검색·추가) + 업무 칩 */}
            <aside className="border-b border-slate-700 bg-[#1E252F] px-3 py-2.5 lg:w-52 lg:flex-none lg:border-b-0 lg:border-r lg:p-3.5">
              {(() => {
                const pill = (on: boolean) => `flex w-auto items-center justify-between gap-2 rounded-full px-2 py-1 text-[11px] font-black transition lg:w-full lg:px-3.5 lg:py-2 ${on ? "bg-white text-slate-950" : "bg-white/10 text-slate-300 hover:bg-white/20 hover:text-white"}`;
                const allTypesOn = displayFilters.every((f) => visibleScheduleTypes.includes(f));
                // 모바일 칩은 한 줄에 들어와야 읽힌다 — 캘린더 원래 이름(납품철수교체휴가교육 등)은 PC에서만
                const shortFilterLabel: Partial<Record<DisplayFilter, string>> = { 익일통합as: "익일AS", 납품철수교체휴가교육: "납품·철수" };
                return (<>
                  {/* 모바일: [팀 ▾][검색][＋] 한 줄 / PC: 세로 스택 */}
                  <div className="flex items-center gap-1.5 lg:block">
                    <button type="button" onClick={() => openSimpleAdd(todayYmd)} aria-label="일정 추가"
                      className="order-3 flex h-9 shrink-0 items-center justify-center gap-1 rounded-xl bg-blue-600 px-2.5 text-[12px] font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.35)] transition hover:bg-blue-700 lg:order-none lg:h-auto lg:w-full lg:gap-1.5 lg:rounded-full lg:px-4 lg:py-2.5 lg:text-sm">
                      <span className="text-base leading-none">＋</span><span className="lg:hidden">추가</span><span className="hidden lg:inline">일정 추가</span>
                    </button>
                    <div className="relative order-2 min-w-0 flex-1 lg:mt-2.5">
                      <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input value={calSearch} onChange={(e) => setCalSearch(e.target.value)} placeholder="업체·제목 검색"
                        className="w-full rounded-lg border border-white/15 bg-white/10 py-2 pl-7 pr-2.5 text-xs font-semibold text-white outline-none transition placeholder:text-slate-500 focus:border-blue-400 focus:bg-white/15" />
                      {calSearch.trim().length >= 2 && (
                        <div className="absolute right-0 z-[70] mt-1.5 max-h-72 w-[min(20rem,calc(100vw_-_6.5rem))] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-[0_16px_40px_rgba(15,23,42,0.25)] lg:left-0 lg:right-0 lg:w-80">
                          {calSearchResults.map((r) => (
                            <button key={r.key} type="button" onClick={() => { setCalSearch(""); if (r.kind === "ticket") setDetailId(r.id); else { const ev = naverEvents.find((x) => x.uid === r.id); if (ev) setNaverDetail({ ...ev }); } }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-slate-50">
                              <span className="w-16 shrink-0 text-[10px] font-black tabular-nums text-slate-400">{r.date.slice(5)}</span>
                              <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-800">{r.title}</span>
                            </button>
                          ))}
                          {!calSearchResults.length && <div className="px-3 py-3 text-center text-[11px] font-semibold text-slate-400">검색 결과 없음</div>}
                        </div>
                      )}
                    </div>
                    <div className="order-1 shrink-0 lg:mt-4">
                      <div className="mb-1.5 hidden text-[10px] font-black uppercase tracking-wider text-slate-500 lg:block">팀 <span className="normal-case text-slate-600">— 내 팀만 보기</span></div>
                      {(() => {
                        // 단일 선택: 전체 / 특정 팀(+종일은 팀 무관 정보라 함께) / E팀 / 종일만
                        const pickValue = (() => {
                          const allOn = teams.every((t) => visibleTeams.includes(t)) && ["E", "종일", "기타"].every((x) => visibleExtra.includes(x));
                          if (allOn) return "전체";
                          if (visibleTeams.length === 1 && !visibleExtra.length) return visibleTeams[0];
                          if (!visibleTeams.length && visibleExtra.includes("E")) return "E";
                          if (!visibleTeams.length && visibleExtra.includes("종일")) return "종일";
                          return "전체";
                        })();
                        return (
                          <PortalSelect tone="dark" direction="down" className="w-[8.75rem] py-1.5 font-semibold lg:w-full lg:py-2" width={200}
                            value={pickValue}
                            onChange={(v) => {
                              if (v === "전체") { setVisibleTeams([...teams]); setVisibleExtra(["E", "종일", "기타"]); }
                              else if (v === "종일") { setVisibleTeams([]); setVisibleExtra(["종일"]); }
                              else if (v === "E") { setVisibleTeams([]); setVisibleExtra(["E"]); }
                              else if (v === "기타") { setVisibleTeams([]); setVisibleExtra(["기타"]); }
                              else { setVisibleTeams([v as Team]); setVisibleExtra([]); } // 팀 선택 = 그 팀만 (종일 제외)
                            }}
                            options={[
                              { value: "전체", label: "전체 팀" },
                              ...teams.map((tm) => ({ value: tm, label: `${tm}팀 · ${TEAM_SLOT_LABEL[tm]}` })),
                              { value: "E", label: "E팀 · 오후 9시" },
                              { value: "기타", label: "기타 시간 (11시 등)" },
                              { value: "종일", label: "종일만 (연차 등)" },
                            ]} />
                        );
                      })()}
                    </div>
                  </div>
                  <div className="mb-1.5 hidden text-[10px] font-black uppercase tracking-wider text-slate-500 lg:mt-4 lg:block">업무</div>
                  <div className="mt-2 flex flex-wrap gap-1 lg:mt-0 lg:flex-col">
                    <button type="button" onClick={() => setVisibleScheduleTypes([...displayFilters])} className={pill(allTypesOn)}><span>전체</span></button>
                    {displayFilters.map((f) => (
                      <button key={f} type="button" onClick={() => toggleScheduleFilter(f)} className={pill(visibleScheduleTypes.includes(f))}>
                        <span className="flex min-w-0 items-center gap-1 lg:gap-1.5"><span className={`h-1.5 w-1.5 shrink-0 rounded-full lg:h-2 lg:w-2 ${f === "익일통합as" ? "bg-lime-500" : f === "AS[완료]" ? "bg-blue-500" : f === "납품철수교체휴가교육" ? "bg-rose-500" : "bg-amber-500"}`} /><span className="truncate lg:hidden">{f === "AS[완료]" ? (visibleTeams.length === 1 && !visibleExtra.includes("E") ? DONE_CAL_LABEL[visibleTeams[0]] : "as완료") : (shortFilterLabel[f] || f)}</span><span className="hidden truncate lg:inline">{f === "AS[완료]" ? (visibleTeams.length === 1 && !visibleExtra.includes("E") ? DONE_CAL_LABEL[visibleTeams[0]] : "as완료") : f}</span></span>
                      </button>
                    ))}
                  </div>
                </>);
              })()}
            </aside>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <button type="button" onClick={() => { setCurrentMonth(monthStart(todayYmd)); window.setTimeout(() => document.getElementById(`cal-day-${todayYmd}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 120); }} className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-black text-slate-700 transition hover:bg-slate-50 sm:px-3.5 sm:py-1.5 sm:text-xs">오늘</button>
                  <button type="button" aria-label="이전 달" onClick={() => setCurrentMonth(addMonths(currentMonth, -1))} className="flex h-8 w-8 items-center justify-center rounded-full text-lg font-bold text-slate-500 transition hover:bg-slate-100 sm:h-9 sm:w-9 sm:text-xl">‹</button>
                  <button type="button" aria-label="다음 달" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="flex h-8 w-8 items-center justify-center rounded-full text-lg font-bold text-slate-500 transition hover:bg-slate-100 sm:h-9 sm:w-9 sm:text-xl">›</button>
                  <h2 className="ml-0.5 whitespace-nowrap text-base font-black text-slate-950 sm:ml-1 sm:text-xl">{Number(currentMonth.slice(0, 4))}년 {Number(currentMonth.slice(5, 7))}월</h2>
                </div>
                <div className="rounded-full bg-slate-100 p-0.5 sm:p-1">
                  {(["calendar", "list", "team"] as ViewMode[]).map((mode) => (
                    <button key={mode} type="button" onClick={() => setViewMode(mode)} className={`rounded-full px-2.5 py-1 text-[11px] font-black sm:px-3 sm:py-1.5 sm:text-xs ${viewMode === mode ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{mode === "calendar" ? "달력" : mode === "list" ? "목록" : "🔒 팀"}</button>
                  ))}
                </div>
              </div>

              {viewMode === "list" ? (
                <div className="space-y-4 p-3 sm:p-4">
                  {(() => {
                    const groups = monthTickets.sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
                      .reduce((acc, ticket) => {
                        const list = acc.get(ticket.date) || [];
                        list.push(ticket);
                        acc.set(ticket.date, list);
                        return acc;
                      }, new Map<string, AsTicket[]>());
                    // 네이버 직접 일정도 같은 날짜 그룹에 — 웹앱 일정 아래 초록 줄로
                    const dates = Array.from(new Set([...groups.keys(), ...shownNaverEvents.map((ev) => ev.date)])).sort();
                    return dates.map((date) => {
                      const list = groups.get(date) || [];
                      const dayNaver = shownNaverEvents.filter((ev) => ev.date === date);
                      return (
                        <div key={date} id={`cal-day-${date}`}>
                          <div className={`sticky top-0 z-10 flex items-center gap-2 rounded-lg px-3 py-1.5 backdrop-blur ${date === todayYmd ? "bg-blue-100/95 text-blue-700" : "bg-slate-100/95 text-slate-600"}`}>
                            <span className="text-sm font-black">{Number(date.slice(5, 7))}/{Number(date.slice(8, 10))} ({["일", "월", "화", "수", "목", "금", "토"][new Date(`${date}T00:00:00`).getDay()]})</span>
                            {date === todayYmd && <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-black text-white">오늘</span>}
                            <span className="text-[11px] font-bold text-slate-400">{list.length + dayNaver.length}건{dayNaver.length ? ` (네이버 ${dayNaver.length})` : ""}</span>
                          </div>
                          <div className={`mt-1 divide-y divide-slate-100 overflow-hidden rounded-lg bg-white ${date === todayYmd ? "border-2 border-blue-500 shadow-[0_0_0_3px_rgba(59,130,246,0.12)]" : "border border-slate-200"}`}>
                            {mergedDayRows(date).map((row) => (row.kind === "ticket" ? compactTicketRow(row.t) : compactNaverRow(row.ev)))}
                          </div>
                        </div>
                      );
                    });
                  })()}
                  {!monthTickets.length && !shownNaverEvents.length && <div className="p-12 text-center text-sm font-semibold text-slate-400">이 달의 일정이 없습니다.</div>}
                </div>
              ) : viewMode === "team" ? (
                <div className="p-3 sm:p-4">
                  {/* 팀장은 팀을 골라 볼 수 있다 — 팀원은 자기 팀 고정 */}
                  {csLeaders.includes(author) && (
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {teams.map((t) => (
                        <button key={t} type="button" onClick={() => setTeamCalTeam(t)} className={`rounded-full px-3 py-1 text-[11px] font-black ${teamCalViewTeam === t ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>{t}팀</button>
                      ))}
                    </div>
                  )}
                  <TeamCalendar team={teamCalViewTeam} author={author} />
                </div>
              ) : viewMode === "calendar" ? (
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
                            {rows.slice(0, 4).map((ticket) => { const dt = displayTypeOf(ticket); return <span key={ticket.id} className={`h-1.5 w-1.5 rounded-full ${dt === "익일통합as" ? "bg-lime-500" : dt === "AS[완료]" ? "bg-blue-600" : dt === "납품철수교체휴가교육" ? "bg-rose-600" : "bg-amber-500"}`} />; })}
                            {shownNaverEvents.filter((ev) => ev.date === date).slice(0, 2).map((ev) => <span key={ev.uid} className={`h-1.5 w-1.5 rounded-sm ${naverBadgeStyle(ev)}`} />)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="border-t border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-sm font-black text-slate-900">{Number(mobileSelectedDate.slice(5, 7))}월 {Number(mobileSelectedDate.slice(8, 10))}일 · {visibleTickets.filter((ticket) => ticket.date === mobileSelectedDate).length}건</div>
                      <button type="button" onClick={() => openSimpleAdd(mobileSelectedDate)} className="rounded-full bg-blue-600 shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 px-3 py-2 text-xs font-black text-white">+ 일정</button>
                    </div>
                    <div className="space-y-1.5">
                      {visibleTickets.filter((ticket) => ticket.date === mobileSelectedDate).map((ticket) => (
                        <button key={ticket.id} type="button" onClick={() => setDetailId(ticket.id)} className={`block w-full rounded-lg px-3 py-2.5 text-left ${scheduleColor(ticket.scheduleType, ticket.status === "완료")}`}>
                          <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-black">{ticket.time} {ticket.vendor || "새 일정"}</span><span className="shrink-0 text-[10px] font-black">{ticket.team}팀 · {ticket.scheduleType}</span></div>
                          {!!ticket.issue && <div className="mt-1 truncate text-xs font-semibold opacity-75">{ticket.issue}</div>}
                        </button>
                      ))}
                      {shownNaverEvents.filter((ev) => ev.date === mobileSelectedDate).map((ev) => (
                        <button key={ev.uid} type="button" onClick={() => setNaverDetail({ ...ev })} className={`block w-full rounded-lg border px-3 py-2.5 text-left transition ${naverChipStyle(ev)}`}>
                          <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-black">{ev.time && `${ev.time} `}{ev.title || "(제목 없음)"}</span>{naverTeamOf(ev) && <span className="shrink-0 text-[10px] font-black opacity-60">{naverTeamOf(ev)}팀</span>}</div>
                          {!!ev.location && <div className="mt-1 truncate text-xs font-semibold opacity-75">{ev.location}</div>}
                        </button>
                      ))}
                      {!visibleTickets.some((ticket) => ticket.date === mobileSelectedDate) && !shownNaverEvents.some((ev) => ev.date === mobileSelectedDate) && <div className="py-4 text-center text-xs font-semibold text-slate-400">등록된 일정이 없습니다.</div>}
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
                          <div key={date} onClick={() => setNaverDayDate(date)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData("text/calendar-ticket"); if (id) requestMoveDate(id, date); const nuid = event.dataTransfer.getData("text/naver-event"); if (nuid) moveNaverEvent(nuid, date); }} className={`group min-h-28 border-b border-r border-slate-200 p-1.5 transition sm:min-h-32 2xl:min-h-40 2xl:p-2 ${inMonth ? (dayIndex === 0 ? "bg-rose-50/25" : dayIndex === 6 ? "bg-blue-50/20" : "bg-white") : "bg-slate-50/70"} hover:bg-blue-50/30`}>
                            <button type="button" className={`mb-1.5 flex h-7 w-7 items-center justify-center rounded-full text-xs font-black tabular-nums transition ${isToday ? "bg-blue-600 text-white shadow-[0_2px_8px_rgba(37,99,235,0.35)]" : `${dayNumberColor(dayIndex, inMonth)}${inMonth ? " hover:bg-slate-100" : ""}`}`}>{Number(date.slice(8, 10))}</button>
                            <div className="space-y-1">
                              {rows.slice(0, 5).map((ticket) => (
                                <button key={ticket.id} type="button" draggable onDragStart={(event) => { event.dataTransfer.setData("text/calendar-ticket", ticket.id); event.dataTransfer.effectAllowed = "move"; }} onClick={(event) => { event.stopPropagation(); setDetailId(ticket.id); }} className={`block w-full cursor-grab truncate rounded-md px-2 py-1 text-left text-[11px] font-bold shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition hover:brightness-95 active:cursor-grabbing ${scheduleColor(ticket.scheduleType, ticket.status === "완료")}`} title={displayTitleOf(ticket)}>
                                  {displayTitleOf(ticket)}
                                </button>
                              ))}
                              {rows.length > 5 && <button type="button" onClick={(event) => { event.stopPropagation(); setNaverDayDate(date); }} className="px-1 pt-0.5 text-[10px] font-black text-slate-500 underline decoration-dotted hover:text-slate-700">+{rows.length - 5}개 더</button>}
                              {shownNaverEvents.filter((ev) => ev.date === date).slice(0, 3).map((ev) => (
                                <button key={ev.uid} type="button" draggable onDragStart={(event) => { event.dataTransfer.setData("text/naver-event", ev.uid); event.dataTransfer.effectAllowed = "move"; }}
                                  onClick={(event) => { event.stopPropagation(); setNaverDetail({ ...ev }); }} title={`네이버 캘린더 일정\n${ev.time ? `${ev.time} · ` : ""}${ev.title}${ev.location ? `\n${ev.location}` : ""}`}
                                  className={`block w-full cursor-grab truncate rounded-md border px-2 py-1 text-left text-[11px] font-bold transition active:cursor-grabbing ${naverChipStyle(ev)}`}>
                                  {ev.time && `${ev.time} `}{ev.title || "(제목 없음)"}
                                </button>
                              ))}
                              {shownNaverEvents.filter((ev) => ev.date === date).length > 3 && <button type="button" onClick={(event) => { event.stopPropagation(); setNaverDayDate(date); }} className="px-1 pt-0.5 text-[10px] font-black text-emerald-600 underline decoration-dotted hover:text-emerald-700">+N {shownNaverEvents.filter((ev) => ev.date === date).length - 3}개 더</button>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                </>
              ) : null}
            </div>
          </div>
        </section>
      ) : (
        <section className="space-y-4">
          {/* 필터 패널 — 일정이 많아지면 이 띠가 화면을 잡아먹는다는 피드백(2026-08-18).
              줄 수를 줄이고(3줄) 높이를 낮췄다: ① 팀 ② 일정 구분 + 건수 ③ 상태·유형 한 줄(가로 스크롤). */}
          <div className="space-y-1.5 rounded-xl bg-[#1E252F] px-3 py-2 shadow-sm">
            {/* ① 팀 — 팝업 없이 한 줄, 좁으면 가로 스크롤 */}
            <div className="flex gap-0.5 overflow-x-auto rounded-full bg-white/[0.07] p-0.5 sm:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {([["ALL", "전체"], ...([...teams, "E"] as Team[]).map((t) => [t, t] as const), ["기타", "기타"], ["종일", "종일"]] as Array<[string, string]>).map(([value, label]) => (
                <button key={value} type="button" onClick={() => setTeam(value as typeof team)}
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-black transition ${team === value ? "bg-white text-slate-950 shadow-sm" : "text-slate-400"}`}>{label}</button>
              ))}
            </div>
            {/* ② 일정 구분 + 대상 건수 */}
            <div className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto rounded-full bg-white/[0.07] p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-none">
                {([["today", "금일"], ["tomorrow", "익일"], ["scheduled", "예정"]] as [DayFilter, string][]).map(([key, label]) => (
                  <button key={key} type="button" onClick={() => { setMyPlanOpen(false); setDayFilter(key); }}
                    className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-[12.5px] font-black transition sm:px-4 ${!myPlanOpen && dayFilter === key ? "bg-white text-slate-950" : "text-slate-400 hover:text-white"}`}>
                    <span className="sm:hidden">{label}</span><span className="hidden sm:inline">{label}일정</span>
                  </button>
                ))}
                <button type="button" onClick={() => setMyPlanOpen(true)}
                  className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-[12.5px] font-black transition sm:px-4 ${myPlanOpen ? "bg-blue-600 text-white" : "text-blue-400 hover:text-blue-300"}`}>내 일정</button>
              </div>
              {/* 넓은 화면은 팀 칩을 여기 나란히 (모바일은 위 줄) */}
              <div className="ml-auto hidden gap-0.5 rounded-full bg-white/[0.07] p-0.5 sm:flex">
                {([["ALL", "전체"], ...([...teams, "E"] as Team[]).map((t) => [t, `${t}팀`] as const), ["기타", "기타"], ["종일", "종일"]] as Array<[string, string]>).map(([value, label]) => (
                  <button key={value} type="button" onClick={() => setTeam(value as typeof team)}
                    className={`rounded-full px-3 py-1 text-xs font-black transition ${team === value ? "bg-white text-slate-950" : "text-slate-400 hover:text-white"}`}>{label}</button>
                ))}
              </div>
            </div>
            {/* ③ 상태 ④ 유형 — 한 줄에 몰면 가로 스크롤해야 해서 불편하다는 피드백(2026-08-19) → 두 줄로 나누고
                줄바꿈 허용(스크롤 없음). 칩 높이는 그대로 얇게 유지. */}
            {!myPlanOpen && (
              <>
              <div className="flex flex-wrap items-center gap-1">
                {([["", `전체 ${statusCounts.전체}`, "bg-white text-slate-950", "bg-white/[0.07] text-slate-300"],
                   ["미배정", `미배정 ${statusCounts.미배정}`, "bg-rose-500 text-white", "bg-white/[0.07] text-rose-300"],
                   ["배정", `배정 ${statusCounts.배정}`, "bg-emerald-500 text-white", "bg-white/[0.07] text-emerald-300"],
                   ["완료", `완료 ${statusCounts.완료}`, "bg-blue-500 text-white", "bg-white/[0.07] text-blue-300"]] as const).map(([key, label, onCls, offCls]) => (
                  <button key={key || "all"} type="button" onClick={() => setStatusPick(key as typeof statusPick)}
                    className={`rounded-full px-2.5 py-1 text-[11.5px] font-black tabular-nums transition ${statusPick === key ? onCls : offCls}`}>{label}</button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <button type="button" onClick={() => setListTypesPersist([...LIST_TYPE_OPTIONS])}
                  className={`rounded-full px-2.5 py-1 text-[11.5px] font-black transition ${listTypes.length === LIST_TYPE_OPTIONS.length ? "bg-white text-slate-950" : "bg-white/[0.07] text-slate-300"}`}>전체</button>
                {LIST_TYPE_OPTIONS.map((name) => {
                  const full = name === "AS" ? "익일통합as"
                    : name === "AS[완료]" ? (team !== "ALL" && team !== "종일" ? DONE_CAL_LABEL[team] : "as완료")
                    : name;
                  const short = name === "납품철수교체휴가교육" ? "납품·철수" : name === "AS" ? "익일as" : full;
                  return (
                    <button key={name} type="button" onClick={() => toggleListType(name)}
                      className={`rounded-full px-2.5 py-1 text-[11.5px] font-black transition ${listTypes.includes(name) ? "bg-white text-slate-950" : "bg-white/[0.07] text-slate-500"}`}>
                      <span className="lg:hidden">{short}</span><span className="hidden lg:inline">{full}</span>
                    </button>
                  );
                })}
                {/* 중간보고 — 12시·14시 카톡 보고 자동 생성 */}
                <button type="button" onClick={openMidReport}
                  className="ml-auto shrink-0 rounded-full bg-white/[0.07] px-3 py-1 text-[11.5px] font-black text-slate-300 transition hover:bg-white/20 hover:text-white">📋 중간보고</button>
                <span className="shrink-0 text-[11px] font-bold tabular-nums text-slate-400">
                  {dayFilter === "today" ? targetDate.slice(5).replace("-", "/") : dayFilter === "tomorrow" ? tomorrowYmd.slice(5).replace("-", "/") : "예정"} · {scheduleRows.length + listNaver.length}건
                </span>
              </div>
              </>
            )}
          </div>

          {myPlanOpen && <MyPlan tickets={tickets} author={author} onSelfRequest={onSelfRequest} onUseField={onUseField} onLoadForm={onLoadForm}
            // AS 일정은 일정리스트 [FIELD]와 같은 직행 — 접수원본이 있으면 그걸, 없으면 제목으로 조립한 양식으로 바로 FIELD 탭 (예전엔 과거 양식 검색창이 먼저 떴다)
            onFieldDirect={(t) => {
              const ticket = tickets.find((x) => x.id === t.id);
              if (!ticket) return;
              // 납품·철수·교체는 물류 필드로 (일정리스트의 물류 [FIELD]와 같은 경로)
              if (ticket.scheduleType === "납품철수교체휴가교육" || ticket.scheduleType === "물류") {
                onLogistics?.({ id: ticket.id, receptionId: ticket.receptionId, vendor: ticket.vendor, issue: ticket.issue, model: ticket.model, note: ticket.note });
                return;
              }
              const raw = receptionRawOf(ticket);
              const link = { id: ticket.id, receptionId: ticket.receptionId, vendor: ticket.vendor };
              if (raw && onLoadForm) onLoadForm(raw, link); else onUseField?.(buildFieldAsText(ticket, author), link);
            }}
            onRemove={(t) => { const target = tickets.find((x) => x.id === t.id); if (target) removeTicket(target); }} />}
          <div className={`space-y-3 md:hidden ${myPlanOpen ? "!hidden" : ""}`}>
            {/* 한 구조로 통일(2026-08-19) — 예정 일정은 익일로 넘어올 때까지 배정을 거의 하지 않아
                사실상 '미배정' 한 박스이고, 그 안에서 날짜로 끊는 게 자연스럽다는 판단.
                위계: 사람(얇은 색 띠) > 날짜(흰 라벨, 스크롤에 붙음). */}
            {(() => {
              const DOW = ["일", "월", "화", "수", "목", "금", "토"];
              const sorted = dayFilter === "scheduled"
                ? [...scheduleRows].sort((a, b) => (a.assignee || "").localeCompare(b.assignee || "", "ko") || a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || ""))
                : scheduleRows;
              const groups: Array<{ key: string; rows: AsTicket[] }> = [];
              for (const t of sorted) {
                const key = t.assignee || "";
                const last = groups[groups.length - 1];
                if (last && last.key === key) last.rows.push(t);
                else groups.push({ key, rows: [t] });
              }
              return groups.map((group) => (
                // 스티키 날짜 띠가 잘리지 않게 박스에 overflow-hidden을 쓰지 않는다
                <section key={`${group.key}-${group.rows[0].id}`} className={`rounded-xl border shadow-sm ${group.key ? "border-emerald-200" : "border-amber-200"}`}>
                  <div className={`flex items-center justify-between rounded-t-xl px-3 py-1 ${group.key ? "bg-emerald-600" : "bg-amber-500"}`}>
                    <span className="text-[12px] font-black text-white">{group.key || "미배정"}</span>
                    <span className="text-[10.5px] font-bold tabular-nums text-white/75">{group.rows.length}건</span>
                  </div>
                  <div className="space-y-2 rounded-b-xl bg-slate-50/60 p-2">
                    {group.rows.map((ticket, gi) => {
                      const dow = new Date(`${ticket.date}T00:00:00`).getDay();
                      const newDate = dayFilter === "scheduled" && (gi === 0 || group.rows[gi - 1].date !== ticket.date);
                      return (
                        <div key={ticket.id}>
                          {newDate && (
                            <div className="sticky top-0 z-10 -mx-2 mb-1.5 flex items-center gap-2 border-b border-slate-200 bg-slate-50/95 px-2 py-1 backdrop-blur">
                              <span className={`rounded px-1.5 py-0.5 text-[12px] font-black tabular-nums text-white ${dow === 0 ? "bg-rose-500" : dow === 6 ? "bg-blue-500" : "bg-slate-700"}`}>
                                {Number(ticket.date.slice(5, 7))}/{Number(ticket.date.slice(8, 10))}
                              </span>
                              <span className={`text-[11px] font-black ${dow === 0 ? "text-rose-600" : dow === 6 ? "text-blue-600" : "text-slate-500"}`}>{DOW[dow]}</span>
                              <span className="text-[10.5px] font-bold tabular-nums text-slate-400">{group.rows.filter((r) => r.date === ticket.date).length}건</span>
                              <span className="h-px flex-1 bg-slate-200" />
                            </div>
                          )}
                                        <article onClick={() => setDetailId(ticket.id)} className={`cursor-pointer rounded-lg border p-2.5 shadow-sm active:bg-blue-50/50 ${ticket.status === "완료" ? "border-blue-300 bg-blue-50/70" : !ticket.assignee ? "border-amber-200 bg-amber-50/50" : "border-slate-200 bg-white"}`}>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-black">
                  <span className="rounded bg-slate-900 px-1.5 py-0.5 text-white">{ticket.team}</span>
                  {/* PC 표와 같은 구분 칩 — 모바일에서도 익일as(연두)/납품(로즈)/점검(호박)이 한눈에 갈리게 */}
                  <span className={`rounded px-1.5 py-0.5 ${scheduleColor(ticket.scheduleType, ticket.status === "완료")}`}>
                    {ticket.scheduleType === "AS" || ticket.scheduleType === "익일AS" ? "익일as" : ticket.scheduleType === "매월점검" ? "점검" : "납품"}
                  </span>
                  <span className="text-slate-500">{ticket.date.slice(5)} {ticket.time}</span>
                  <span className={`rounded-full px-2 py-0.5 ${ticket.assignee ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>{ticket.assignee || "미배정"}</span>
                  {ticket.status === "완료" && <span className="ml-auto rounded-full bg-blue-600 px-2 py-0.5 text-white">✓</span>}
                </div>
                <div className={`mt-1.5 truncate text-sm font-black leading-snug ${ticket.status === "완료" ? "text-blue-700" : "text-slate-950"}`} title={displayTitleOf(ticket)}>{displayTitleOf(ticket)}</div>
                {ticket.issue && <div className="mt-0.5 truncate text-xs font-semibold text-slate-500">{ticket.issue}</div>}
                <div className="mt-0.5 truncate text-[11px] font-semibold text-slate-400">{[ticket.model, shortAddress(ticket.address) && `📍 ${shortAddress(ticket.address)}`].filter(Boolean).join(" · ")}</div>
                <div className="mt-2 flex gap-1.5" onClick={(event) => event.stopPropagation()}>
                  <CallButton ticket={ticket} compact />
                  {(ticket.scheduleType === "AS" || ticket.scheduleType === "익일AS") && <button type="button" onClick={() => { const raw = receptionRawOf(ticket); const link = { id: ticket.id, receptionId: ticket.receptionId, vendor: ticket.vendor }; if (raw && onLoadForm) onLoadForm(raw, link); else onUseField?.(buildFieldAsText(ticket, author), link); }} className="flex-1 rounded-full bg-slate-900 px-2 py-1.5 text-[11px] font-black text-white transition hover:bg-slate-800">FIELD</button>}
                  {(ticket.scheduleType === "납품철수교체휴가교육" || ticket.scheduleType === "물류") && !/휴가|연차/.test(ticket.vendor) && onLogistics && <button type="button" onClick={() => onLogistics({ id: ticket.id, receptionId: ticket.receptionId, vendor: ticket.vendor, issue: ticket.issue, model: ticket.model, note: ticket.note })} className="flex-1 rounded-full bg-slate-700 px-2 py-1.5 text-[11px] font-black text-white transition hover:bg-slate-600">FIELD</button>}
                  <button type="button" onClick={() => setAssignId(ticket.id)} className="flex-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] font-black text-emerald-700">배정</button>
                  <button type="button" onClick={() => openDone(ticket)} className={`flex-1 rounded-full border px-2 py-1.5 text-[11px] font-black ${ticket.status === "완료" ? "border-slate-300 bg-white text-slate-600" : "border-blue-200 bg-blue-50 text-blue-700"}`}>{ticket.status === "완료" ? "취소" : "완료"}</button>
                  <button type="button" onClick={() => openDefer(ticket)} className="flex-1 rounded-full border border-purple-200 bg-purple-50 px-2 py-1.5 text-[11px] font-black text-purple-700">익일</button>
                  <button type="button" onClick={() => removeTicket(ticket)} className="flex-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] font-black text-rose-600">삭제</button>
                </div>
              </article>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ));
            })()}
            {!!listNaver.length && (
              <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                {listNaver.map((ev) => compactNaverRow(ev))}
              </div>
            )}
            {!scheduleRows.length && !listNaver.length && <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-12 text-center text-sm font-semibold text-slate-400">등록된 일정이 없습니다.</div>}
          </div>

          <div className={`hidden space-y-4 ${myPlanOpen ? "" : "md:block"}`}>
            {(() => {
              // 배정자별 박스 — 미배정(로즈)과 배정자(에메랄드)를 확실히 구분. 네이버 종일·연차 일정도 미배정 박스에 한 몸으로 흡수
              const doneRows = scheduleRows.filter((t) => t.status === "완료");
              const activeRows = scheduleRows.filter((t) => t.status !== "완료");
              const naverActive = listNaver.filter((ev) => !ev.completed);
              const naverDone = listNaver.filter((ev) => ev.completed);
              const groups: Array<{ key: string; rows: AsTicket[]; naver: NaverEventRow[] }> = [];
              for (const t of activeRows) {
                const key = t.assignee || "";
                const g = groups.find((x) => x.key === key);
                if (g) g.rows.push(t); else groups.push({ key, rows: [t], naver: [] });
              }
              if (naverActive.length) {
                const g = groups.find((x) => x.key === "");
                if (g) g.naver = naverActive; else groups.unshift({ key: "", rows: [], naver: naverActive });
              }
              if (doneRows.length || naverDone.length) groups.push({ key: "__done__", rows: doneRows, naver: naverDone });
              const th = "whitespace-nowrap px-3 py-2 text-xs font-black text-slate-500";
              const dowOf = (date: string) => ["일", "월", "화", "수", "목", "금", "토"][new Date(`${date}T00:00:00`).getDay()];
              // 네이버 원본 행 — 티켓과 같은 컬럼 구도로 한 표에 들어간다 (클릭=네이버 상세, 완료=제자리 체크)
              const naverListRow = (ev: NaverEventRow, done: boolean) => {
                const evTeam = ev.time ? (naverTeamOf(ev) || "기타") : "종일";
                return (
                  <tr key={`nv-${ev.uid}`} onClick={() => setNaverDetail({ ...ev })} className={`h-12 cursor-pointer border-b last:border-0 ${done ? "border-blue-100 bg-blue-50/60 hover:bg-blue-50" : "border-slate-100 hover:bg-blue-50/40"}`}>
                    <td className="whitespace-nowrap px-3 py-1.5 text-sm font-black">{evTeam === "종일" || evTeam === "기타" ? evTeam : `${evTeam}팀`}</td>
                    <td className="whitespace-nowrap px-3 py-1.5"><span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-black ${naverChipStyle(ev)}`}>{shortCat(naverCategoryOf(ev))}</span></td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs font-bold text-slate-500">{guOf(ev.location || "") || "-"}</td>
                    {dayFilter === "scheduled" && <td className="whitespace-nowrap px-3 py-1.5 text-sm font-bold">{Number(ev.date.slice(5, 7))}/{Number(ev.date.slice(8, 10))} <span className="text-[11px] text-slate-400">({dowOf(ev.date)})</span></td>}
                    <td className="px-3 py-1.5"><div className={`max-w-[560px] truncate text-sm font-black ${done ? "text-slate-400 line-through" : "text-slate-900"}`} title={ev.title}>{ev.title || "(제목 없음)"}</div></td>
                    <td className="px-3 py-1.5"><div className="max-w-[240px] truncate text-xs font-semibold text-slate-600" title={ev.description || ""}>{ev.description || "-"}</div></td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs text-slate-300">-</td>
                    <td className="whitespace-nowrap px-3 py-1.5" onClick={(event) => event.stopPropagation()}>
                      <div className="flex flex-nowrap justify-end gap-1.5">
                        <button type="button" onClick={() => void toggleNaverComplete(ev)} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-black ${done ? "border-slate-200 bg-white text-slate-500" : "border-blue-200 bg-blue-50 text-blue-700"}`}>{done ? "취소" : "완료"}</button>
                      </div>
                    </td>
                  </tr>
                );
              };
              const ticketListRow = (ticket: AsTicket) => (
                <tr key={ticket.id} onClick={() => setDetailId(ticket.id)} className={`h-12 cursor-pointer border-b last:border-0 hover:bg-blue-50/40 ${ticket.status === "완료" ? "border-blue-100 bg-blue-50/70" : "border-slate-100"}`}>
                  <td className="whitespace-nowrap px-3 py-1.5 text-sm font-black">{ticket.team === "기타" ? "기타" : `${ticket.team}팀`}</td>
                  <td className="whitespace-nowrap px-3 py-1.5"><span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-black ${scheduleColor(ticket.scheduleType, ticket.status === "완료")}`}>{shortCat(displayTypeOf(ticket))}</span></td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs font-bold text-slate-500">{guOf(ticket.address || "") || "-"}</td>
                  {dayFilter === "scheduled" && <td className="whitespace-nowrap px-3 py-1.5 text-sm font-bold">{Number(ticket.date.slice(5, 7))}/{Number(ticket.date.slice(8, 10))} <span className="text-[11px] text-slate-400">({dowOf(ticket.date)})</span></td>}
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2 text-sm font-black text-slate-900"><span className="max-w-[560px] truncate" title={displayTitleOf(ticket)}>{displayTitleOf(ticket)}</span>{ticket.repeatMonthly && <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-600">🔁</span>}{ticket.status === "완료" && <span className="shrink-0 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-black text-white">✓ 완료</span>}<VendorAlertChip flags={vendorFlags.get(historyQueryOf(ticket))} onOpen={() => openTicketHistory(ticket)} /></div>
                  </td>
                  <td className="px-3 py-1.5"><div className="max-w-[240px] truncate text-xs font-semibold text-slate-600" title={ticket.issue || ""}>{ticket.issue || "-"}</div></td>
                  <td className="whitespace-nowrap px-3 py-1.5"><div className="max-w-[200px] truncate text-xs font-semibold text-slate-600" title={[ticket.model, ticket.serial, ticket.asset && `자산 ${ticket.asset}`].filter(Boolean).join(" · ")}>{[ticket.model, ticket.serial, ticket.asset && `자산 ${ticket.asset}`].filter(Boolean).join(" · ") || "-"}</div></td>
                  <td className="whitespace-nowrap px-3 py-1.5" onClick={(event) => event.stopPropagation()}>
                    <div className="flex flex-nowrap justify-end gap-1.5">
                      <CallButton ticket={ticket} />
                      {(ticket.scheduleType === "AS" || ticket.scheduleType === "익일AS") && <button type="button" onClick={() => { const raw = receptionRawOf(ticket); const link = { id: ticket.id, receptionId: ticket.receptionId, vendor: ticket.vendor }; if (raw && onLoadForm) onLoadForm(raw, link); else onUseField?.(buildFieldAsText(ticket, author), link); }} className="shrink-0 rounded-full bg-slate-900 transition hover:bg-slate-800 px-3 py-1.5 text-xs font-black text-white">FIELD</button>}
                      {(ticket.scheduleType === "납품철수교체휴가교육" || ticket.scheduleType === "물류") && !/휴가|연차/.test(ticket.vendor) && onLogistics && <button type="button" onClick={() => onLogistics({ id: ticket.id, receptionId: ticket.receptionId, vendor: ticket.vendor, issue: ticket.issue, model: ticket.model, note: ticket.note })} className="shrink-0 rounded-full bg-slate-700 transition hover:bg-slate-600 px-3 py-1.5 text-xs font-black text-white">FIELD</button>}
                      <button type="button" onClick={() => setAssignId(ticket.id)} className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700">배정</button>
                      <button type="button" onClick={() => openDone(ticket)} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-black ${ticket.status === "완료" ? "border-slate-200 bg-white text-slate-500" : "border-blue-200 bg-blue-50 text-blue-700"}`}>{ticket.status === "완료" ? "취소" : "완료"}</button>
                      <button type="button" onClick={() => openDefer(ticket)} className="shrink-0 rounded-full border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-black text-purple-700">익일</button>
                      <button type="button" onClick={() => removeTicket(ticket)} className="shrink-0 rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-black text-rose-600">삭제</button>
                    </div>
                  </td>
                </tr>
              );
              // 티켓·네이버 행을 한 줄기로 섞어 정렬 — 날짜 → 종일(연차류)은 맨 아래 → 구분(납품→익일as) → 지역구 → 시간 → 이름
              const mergedActive = (rowList: AsTicket[], naverList: NaverEventRow[]) => [
                ...rowList.map((t) => ({ date: t.date, allday: t.time ? 0 : 1, cat: CAT_ORDER[displayTypeOf(t)] ?? 9, gu: guOf(t.address || "") || "￿", time: t.time || "", title: displayTitleOf(t), node: ticketListRow(t) })),
                ...naverList.map((ev) => ({ date: ev.date, allday: ev.time ? 0 : 1, cat: CAT_ORDER[naverCategoryOf(ev)] ?? 9, gu: guOf(ev.location || "") || "￿", time: ev.time || "", title: ev.title || "", node: naverListRow(ev, false) })),
              ].sort((a, b) => a.date.localeCompare(b.date) || a.allday - b.allday || a.cat - b.cat || a.gu.localeCompare(b.gu, "ko") || a.time.localeCompare(b.time) || a.title.localeCompare(b.title, "ko")).flatMap((x, i, arr) => (
                // 예정 탭은 여러 날짜가 섞이므로 날짜가 바뀔 때마다 띠를 넣어 일별로 끊어 보여준다
                dayFilter === "scheduled" && x.date !== arr[i - 1]?.date ? [(
                  <tr key={`day-${x.date}`} className="border-b border-slate-200 bg-slate-100">
                    <td colSpan={9} className="px-3 py-1.5 text-[11px] font-black text-slate-600">📅 {Number(x.date.slice(5, 7))}/{Number(x.date.slice(8, 10))} ({dowOf(x.date)})</td>
                  </tr>
                ), x.node] : [x.node]
              ));
              return groups.map(({ key, rows, naver }) => key === "__done__" ? (
                <details key="__done__" className="overflow-hidden rounded-xl border-2 border-blue-300 bg-white shadow-sm">
                  <summary className="flex cursor-pointer items-center gap-2 bg-blue-50/70 px-4 py-2 transition hover:bg-blue-50">
                    <span className="text-sm font-black text-blue-800">✓ {team !== "ALL" && team !== "종일" ? DONE_CAL_LABEL[team] : "완료 (as완료 캘린더)"}</span>
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-black text-blue-700">{rows.length + naver.length}건</span>
                    <span className="text-[10px] font-bold text-slate-400">— 눌러서 펼치기</span>
                  </summary>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1050px] text-left">
                      <tbody>
                        {[
                          ...rows.map((ticket) => ({ date: ticket.date, cat: CAT_ORDER[displayTypeOf(ticket)] ?? 9, gu: guOf(ticket.address || "") || "￿", title: displayTitleOf(ticket), node: (
                          <tr key={ticket.id} onClick={() => setDetailId(ticket.id)} className="h-11 cursor-pointer border-b border-blue-100 bg-blue-50/60 last:border-0 hover:bg-blue-50">
                            <td className="whitespace-nowrap px-3 py-1.5 text-sm font-black">{ticket.team === "기타" ? "기타" : `${ticket.team}팀`}</td>
                            <td className="whitespace-nowrap px-3 py-1.5"><span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-black ${scheduleColor(ticket.scheduleType, true)}`}>{shortCat(displayTypeOf(ticket))}</span></td>
                            <td className="whitespace-nowrap px-3 py-1.5 text-xs font-bold text-slate-500">{guOf(ticket.address || "") || "-"}</td>
                            {dayFilter === "scheduled" && <td className="whitespace-nowrap px-3 py-1.5 text-sm font-bold">{Number(ticket.date.slice(5, 7))}/{Number(ticket.date.slice(8, 10))}</td>}
                            <td className="w-[54%] px-3 py-1.5 text-sm font-black text-slate-500 line-through"><div className="max-w-[420px] truncate" title={displayTitleOf(ticket)}>{displayTitleOf(ticket)}</div></td>
                            <td className="whitespace-nowrap px-3 py-1.5" onClick={(event) => event.stopPropagation()}>
                              <div className="flex justify-end"><button type="button" onClick={() => openDone(ticket)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-500">완료 취소</button></div>
                            </td>
                          </tr>
                          ) })),
                          ...naver.map((ev) => {
                            const evTeam = ev.time ? (naverTeamOf(ev) || "기타") : "종일";
                            return { date: ev.date, cat: CAT_ORDER[naverCategoryOf(ev)] ?? 9, gu: guOf(ev.location || "") || "￿", title: ev.title || "", node: (
                            <tr key={`nvd-${ev.uid}`} onClick={() => setNaverDetail({ ...ev })} className="h-11 cursor-pointer border-b border-blue-100 bg-blue-50/60 last:border-0 hover:bg-blue-50">
                              <td className="whitespace-nowrap px-3 py-1.5 text-sm font-black">{evTeam === "종일" || evTeam === "기타" ? evTeam : `${evTeam}팀`}</td>
                              <td className="whitespace-nowrap px-3 py-1.5"><span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-black ${naverChipStyle(ev)}`}>{shortCat(naverCategoryOf(ev))}</span></td>
                              <td className="whitespace-nowrap px-3 py-1.5 text-xs font-bold text-slate-500">{guOf(ev.location || "") || "-"}</td>
                              {dayFilter === "scheduled" && <td className="whitespace-nowrap px-3 py-1.5 text-sm font-bold">{Number(ev.date.slice(5, 7))}/{Number(ev.date.slice(8, 10))}</td>}
                              <td className="w-[54%] px-3 py-1.5 text-sm font-black text-slate-500 line-through"><div className="max-w-[420px] truncate" title={ev.title}>{ev.title || "(제목 없음)"}</div></td>
                              <td className="whitespace-nowrap px-3 py-1.5" onClick={(event) => event.stopPropagation()}>
                                <div className="flex justify-end"><button type="button" onClick={() => void toggleNaverComplete(ev)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-500">완료 취소</button></div>
                              </td>
                            </tr>
                            ) };
                          }),
                        ].sort((a, b) => a.date.localeCompare(b.date) || a.cat - b.cat || a.gu.localeCompare(b.gu, "ko") || a.title.localeCompare(b.title, "ko")).map((x) => x.node)}
                      </tbody>
                    </table>
                  </div>
                </details>
              ) : (
                <section key={key || "__none__"} className={`overflow-hidden rounded-xl border-2 bg-white shadow-sm ${key ? "border-emerald-300" : "border-rose-400"}`}>
                  <div className={`flex items-center gap-2 px-4 py-2 ${key ? "bg-emerald-50/60" : "bg-rose-50"}`}>
                    <span className={`text-sm font-black ${key ? "text-emerald-900" : "text-rose-800"}`}>{key || "미배정 — 배정 필요"}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${key ? "bg-white text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{rows.length + naver.length}건</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1100px] text-left">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                          <th className={th}>팀</th><th className={th}>구분</th><th className={th}>지역구</th>{dayFilter === "scheduled" && <th className={th}>방문일정</th>}
                          <th className={`${th} w-[34%]`}>제목</th><th className={`${th} w-[15%]`}>접수내용</th>
                          <th className={th}>기기</th><th className={`${th} text-right`}>처리</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mergedActive(rows, naver)}
                      </tbody>
                    </table>
                  </div>
                </section>
              ));
            })()}
            {!scheduleRows.length && !listNaver.length && <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-12 text-center text-sm font-semibold text-slate-400">등록된 일정이 없습니다.</div>}
          </div>
        </section>
      )}

      <UnifiedHistory vendor={histVendor} accent="#2563eb" open={!!histVendor} onClose={() => setHistVendor("")} onError={(msg) => notify(msg, "error")} author={author} />

      {detailTicket && (() => {
        const ticket = detailTicket;
        // 접수자·키맨 연락처 — 라벨·기호를 걷어낸 이름만 남긴 phonesOf를 쓴다.
        // 예전엔 원문 줄을 그대로 truncate해서 번호 왼쪽(이름)이 화면에서 잘렸다.
        const phoneEntries = phonesOf(ticket);
        const reception = detailReception;
        return (
          <div className="fixed inset-0 z-[115] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setDetailId("")}>
            <div className="flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-w-2xl sm:rounded-xl" onMouseDown={(event) => event.stopPropagation()}>
              <div className="bg-[#1E252F] px-5 py-4">
                {view === "calendar" ? (
                  <div className="flex items-center gap-2 text-[11px] font-black">
                    <span className="rounded bg-lime-600 px-1.5 py-0.5 text-white">익일통합as</span>
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-slate-300">{ticket.team}팀</span>
                    {ticket.status === "완료" && <span className="rounded bg-emerald-500/90 px-1.5 py-0.5 text-white">완료됨</span>}
                    <span className="ml-auto hidden text-slate-400 sm:inline">수정하면 네이버 캘린더에 바로 반영</span>
                    <button type="button" onClick={() => setDetailId("")} className="ml-1 rounded-full p-1 text-slate-400 transition hover:bg-white/10 hover:text-white" aria-label="닫기"><svg className="h-4 w-4" viewBox="0 0 20 20" fill="none"><path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg></button>
                  </div>
                ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-black text-white">{ticket.team}팀</span>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${ticket.status === "완료" ? "bg-blue-500 text-white" : ticket.status === "배정" ? "bg-emerald-500/90 text-white" : "bg-white/15 text-slate-200"}`}>{ticket.status}</span>
                    <span className="text-[11px] font-bold text-slate-400">{ticket.date} {ticket.time}</span>
                    {ticket.repeatMonthly && <span className="rounded-full bg-white/15 px-2 py-1 text-[10px] font-black text-blue-200">🔁 매월</span>}
                    {ticket.naverUid && <span className="rounded-full bg-emerald-500/20 px-2 py-1 text-[10px] font-black text-emerald-300">네이버 ✓</span>}
                  </div>
                  <button type="button" onClick={() => setDetailId("")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg font-black text-slate-400 transition hover:bg-white/10 hover:text-white">×</button>
                </div>
                )}
                {/* 제목 — [수정]을 눌러야 편집, [저장]으로 확정 (저장하면 리스트·캘린더·네이버 제목이 함께 바뀐다) */}
                <div className="mt-2 flex items-center gap-2">
                  {ticket.assignee && <span className="shrink-0 rounded bg-emerald-500/90 px-2 py-1 text-sm font-black text-white">{ticket.assignee}</span>}
                  {titleDraft === null ? (<>
                    <span className="min-w-0 flex-1 truncate px-1 text-[15px] font-bold text-white">{(ticket.calendarTitle || "").trim() || ticket.vendor}</span>
                    <VendorAlertChip flags={vendorFlags.get(historyQueryOf(ticket))} onOpen={() => openTicketHistory(ticket)} />
                    <button type="button" onClick={() => setTitleDraft((ticket.calendarTitle || "").trim() || ticket.vendor)} className="shrink-0 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-black text-slate-200 transition hover:bg-white/20">수정</button>
                  </>) : (<>
                    <input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} autoFocus
                      onKeyDown={(e) => { if (e.key === "Enter") { const v = titleDraft.trim(); if (v) { update(ticket.id, { calendarTitle: v }); notify("제목이 저장됐습니다" + (ticket.naverUid ? " — 네이버 캘린더에도 반영 ✓" : " ✓"), "success"); } setTitleDraft(null); } if (e.key === "Escape") setTitleDraft(null); }}
                      style={{ fontWeight: 700 }}
                      className="min-w-0 flex-1 rounded-lg border border-blue-400 bg-white/15 px-3 py-2 text-[15px] text-white outline-none placeholder:text-slate-500" />
                    <button type="button" onClick={() => { const v = titleDraft.trim(); if (v) { update(ticket.id, { calendarTitle: v }); notify("제목이 저장됐습니다" + (ticket.naverUid ? " — 네이버 캘린더에도 반영 ✓" : " ✓"), "success"); } setTitleDraft(null); }} className="shrink-0 rounded-full bg-blue-600 px-3.5 py-1.5 text-xs font-black text-white shadow-[0_2px_8px_rgba(37,99,235,0.4)] transition hover:bg-blue-700">저장</button>
                  </>)}
                </div>

              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
                {/* 기본 정보 — 날짜·팀·장소·연락처를 한 박스로 (흩어짐 방지) */}
                <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/40 p-3.5">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs font-bold text-slate-500">날짜
                      <input type="date" value={ticket.date} onClick={openPicker} onChange={(e) => { if (e.target.value && e.target.value !== ticket.date) requestMoveDate(ticket.id, e.target.value); }}
                        className="mt-1 w-full cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500" />
                    </label>
                    <div className="text-xs font-bold text-slate-500">팀
                      <div className="mt-1">
                        <PortalSelect direction="down" className="w-full bg-white py-2 font-semibold" width={240}
                          value={ticket.time ? ticket.team : "종일"}
                          onChange={(v) => {
                            if (v === "종일") { if (ticket.time) { update(ticket.id, { time: "" }); notify("종일 일정으로 변경 ✓", "success"); } return; }
                            const tm = v as Team;
                            if (tm !== ticket.team || !ticket.time) { update(ticket.id, { team: tm, time: TEAM_SLOT[tm] }); notify(`${tm}팀(${TEAM_SLOT_LABEL[tm]})으로 변경 ✓`, "success"); }
                          }}
                          options={[{ value: "종일", label: "종일" }, ...(["A", "B", "C", "D", "E"] as Team[]).map((tm) => ({ value: tm, label: `${tm}팀 · ${TEAM_SLOT_LABEL[tm]}` }))]} />
                      </div>
                    </div>
                  </div>
                  <div className="text-xs font-bold text-slate-500">장소
                    <div className="mt-1 flex items-center gap-2">
                      <input key={`addr-${ticket.id}`} defaultValue={ticket.address || ""}
                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                        onBlur={(e) => { const v = e.target.value.trim(); if (v !== (ticket.address || "")) { update(ticket.id, { address: v }); if (ticket.naverUid) void invokeEdgeFunction("naver-calendar-push", { action: "caldav_update", uid: ticket.naverUid, location: v }).catch(() => undefined); notify("주소가 저장됐습니다" + (ticket.naverUid ? " — 네이버에도 반영 ✓" : " ✓"), "success"); } }}
                        placeholder="방문 주소"
                        className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500" />
                      {view === "as" && !!ticket.address && <AddrNav address={ticket.address} />}
                    </div>
                  </div>
                  {view === "as" && phoneEntries.length > 0 && <div className="text-xs font-bold text-slate-500">연락처
                    <div className="mt-1 space-y-1.5">
                      {phoneEntries.map(({ label, name, number }, index) => (
                        <div key={`${number}-${index}`} className="flex items-center gap-2">
                          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-600">{label}</span>
                          {!!name && <span className="min-w-0 flex-1 break-words text-xs font-bold text-slate-700">{name}</span>}
                          <a href={`tel:${number.replace(/[^0-9]/g, "")}`} className="ml-auto shrink-0 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-black text-white transition hover:bg-emerald-700">📞 {number}</a>
                        </div>
                      ))}
                    </div>
                  </div>}
                  {view === "as" && !phoneEntries.length && !!(ticket.contact || ticket.keyman) && <div className="text-xs font-bold text-slate-600 whitespace-pre-wrap">{[ticket.contact, ticket.keyman].filter(Boolean).join("\n")}</div>}
                </div>
                {view === "calendar" && !!ticket.naverUid && (
                  <div className="text-xs font-bold text-slate-500">캘린더 이동
                    <div className="mt-1">
                      <PortalSelect direction="down" className="w-full py-2 font-semibold" width={280}
                        value={NAVER_CAL_LIST[0].id}
                        onChange={(v) => { if (v !== NAVER_CAL_LIST[0].id) { void invokeEdgeFunction("naver-calendar-push", { action: "caldav_transfer", uid: ticket.naverUid, toCal: v }).then(() => notify(`네이버 미러가 "${NAVER_CAL_LIST.find((c) => c.id === v)?.name || "다른 캘린더"}"(으)로 이동됐습니다 ✓`, "success")).catch((e) => notify(`이동 실패: ${(e as Error).message}`, "error")); } }}
                        options={NAVER_CAL_LIST.map((c) => ({ value: c.id, label: c.name }))} />
                    </div>
                  </div>
                )}
                {detailLoading && <div className="py-2 text-center text-xs font-bold text-slate-400">접수 원본 불러오는 중…</div>}
                {view === "as" && !!(reception?.photos?.length) && <div>
                  <div className="text-[10px] font-black text-slate-400">증상 사진</div>
                  <div className="mt-1.5 flex flex-wrap gap-2">{reception.photos.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt="증상 사진" className="h-20 w-20 rounded-lg border border-slate-200 object-cover" /></a>)}</div>
                </div>}
                {view === "as" && <label className="block text-xs font-bold text-slate-500">접수 내용 <span className="font-semibold text-slate-400">— 입력창을 벗어나면 저장</span>
                  <textarea key={`issue-${ticket.id}`} defaultValue={ticket.issue || ""} rows={Math.min(5, Math.max(2, (ticket.issue || "").split("\n").length))}
                    onBlur={(e) => { const v = e.target.value; if (v !== (ticket.issue || "")) { update(ticket.id, { issue: v }); notify("접수 내용이 저장됐습니다 ✓", "success"); } }}
                    className="mt-1 w-full resize-y rounded-lg border border-blue-200 bg-blue-50/40 p-3.5 text-[13.5px] font-medium leading-[1.7] text-slate-800 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10" />
                </label>}
                <label className="block text-xs font-bold text-slate-500">{view === "calendar" ? "내용" : "내용 (처리 결과·양식)"} <span className="font-semibold text-slate-400">{view === "calendar" ? "— 입력창을 벗어나면 저장" : "— 완료 처리 시 자동으로 쌓이고, 직접 수정도 가능"}</span>
                  <textarea key={`note-${ticket.id}`} defaultValue={ticket.note || ""} rows={ticket.note ? Math.min(10, Math.max(3, ticket.note.split("\n").length)) : 3}
                    onBlur={(e) => { const v = e.target.value; if (v !== (ticket.note || "")) { update(ticket.id, { note: v }); if (ticket.naverUid) void invokeEdgeFunction("naver-calendar-push", { action: "caldav_update", uid: ticket.naverUid, description: v }).catch(() => undefined); notify("내용이 저장됐습니다" + (ticket.naverUid ? " — 네이버에도 반영 ✓" : " ✓"), "success"); } }}
                    className="mt-1 w-full resize-y rounded-lg border border-slate-300 bg-slate-50/50 p-3.5 text-[13.5px] font-medium leading-[1.7] text-slate-800 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10" />
                </label>
              </div>
              <div className="space-y-1.5 border-t border-slate-100 px-4 py-3 sm:px-5">
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => { setDetailId(""); openDefer(ticket); }} className="flex-1 whitespace-nowrap rounded-lg border border-purple-200 bg-purple-50 py-2.5 text-xs font-black text-purple-700">익일</button>
                  <button type="button" onClick={() => { setDetailId(""); setDupTicketId(ticket.id); setDupDate(ticket.date); }} className="flex-1 whitespace-nowrap rounded-lg border border-slate-300 bg-white py-2.5 text-xs font-black text-slate-700 transition hover:bg-slate-50">복제</button>
                  {view === "calendar" && <button type="button" onClick={() => { if (ticket.repeatMonthly) { update(ticket.id, { repeatMonthly: false }); } else { update(ticket.id, { repeatMonthly: true }); notify("다음 달부터 11개월, 매월 같은 날로 생성했습니다 ✓", "success"); } }} className="flex-1 whitespace-nowrap rounded-lg border border-slate-300 bg-white py-2.5 text-xs font-black text-slate-700 transition hover:bg-slate-50">{ticket.repeatMonthly ? "반복 해제" : "매월 반복"}</button>}
                  {view === "as" && <button type="button" onClick={() => setAssignId(ticket.id)} className="flex-1 whitespace-nowrap rounded-lg border border-emerald-300 bg-emerald-50 py-2.5 text-xs font-black text-emerald-700">배정</button>}
                  <button type="button" onClick={() => { removeTicket(ticket); }} className="flex-1 whitespace-nowrap rounded-lg border border-rose-200 bg-rose-50 py-2.5 text-xs font-black text-rose-600">삭제</button>
                </div>
                <button type="button" onClick={() => { setDetailId(""); openDone(ticket); }} className={`w-full whitespace-nowrap rounded-lg py-2.5 text-xs font-black transition ${ticket.status === "완료" ? "border border-slate-300 bg-white text-slate-600" : "bg-emerald-600 text-white shadow-[0_3px_10px_rgba(5,150,105,0.3)] hover:bg-emerald-700"}`}>{ticket.status === "완료" ? "완료 취소" : "✓ 완료"}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {dupTicket && (
        <div className="fixed inset-0 z-[130] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setDupTicketId("")}>
          <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-xl" onMouseDown={(event) => event.stopPropagation()}>
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
      {midReport && (
        <div className="fixed inset-0 z-[150] flex items-end bg-black/45 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setMidReport(null)}>
          <div className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 bg-[#1E252F] px-5 py-4">
              <div>
                <div className="text-[15px] font-black text-white">중간보고 생성</div>
                <div className="mt-0.5 text-[11px] font-semibold text-slate-400">{midReport.polishing ? "🤖 AI가 보고를 만드는 중…" : "완료된 건은 자동으로 빠졌습니다 — 진행중(*)만 표시하고 복사하세요"}</div>
              </div>
              <button type="button" onClick={() => setMidReport(null)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white">✕</button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
              {teams.map((value) => (
                <button key={value} type="button" onClick={() => composeMidReport(value)}
                  className={`rounded-full px-3 py-1.5 text-[12px] font-black transition ${midReport.team === value ? "bg-slate-900 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200"}`}>{value}팀</button>
              ))}
            </div>
            {midReport.diag && <div className="border-b border-slate-100 bg-amber-50/70 px-4 py-1.5 text-[11px] font-semibold text-slate-500">{midReport.diag}</div>}
            <textarea value={midReport.text} readOnly={midReport.polishing} placeholder="🤖 AI가 보고를 만드는 중… 몇 초만 기다려 주세요" onChange={(event) => setMidReport({ ...midReport, text: event.target.value })} rows={16}
              className="min-h-0 flex-1 resize-none border-0 px-5 py-4 font-mono text-[13px] leading-6 text-slate-800 outline-none" />
            <div className="flex shrink-0 gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-3">
              <button type="button" onClick={() => composeMidReport(midReport.team)}
                className="rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-600">다시 생성</button>
              <button type="button" disabled={midReport.polishing} onClick={() => { void navigator.clipboard.writeText(midReport.text).then(() => notify("중간보고를 복사했습니다 — 카톡방에 붙여넣으세요 ✓", "success")).catch(() => notify("복사 실패 — 본문을 직접 선택해 복사하세요.", "error")); }}
                className="flex-1 rounded-full bg-blue-600 py-2.5 text-sm font-black text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">{midReport.polishing ? "생성 중…" : "복사"}</button>
            </div>
          </div>
        </div>
      )}
      {assignTicket && (
        <div className="fixed inset-0 z-[140] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setAssignId("")}>
          <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-xl" onMouseDown={(event) => event.stopPropagation()}>
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
          <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-xl" onMouseDown={(event) => event.stopPropagation()}>
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
      {doneTicket && <DoneReasonModal ticket={doneTicket} onClose={() => setDoneTicket(null)} onApply={(reason) => void applyDone(reason)} />}
      {naverDayDate && (() => {
        const rows = mergedDayRows(naverDayDate);
        return (
        <div className="fixed inset-0 z-[2390] flex items-center justify-center bg-black/45 p-4 sm:p-8" onMouseDown={() => setNaverDayDate(null)}>
          <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex flex-wrap items-center justify-between gap-2 bg-[#1E252F] px-5 py-4">
              <div>
                <div className="text-[11px] font-black text-slate-400">{["일", "월", "화", "수", "목", "금", "토"][new Date(`${naverDayDate}T00:00:00`).getDay()]}요일 일정</div>
                <div className="mt-0.5 text-[16px] font-black text-white">{Number(naverDayDate.slice(5, 7))}월 {Number(naverDayDate.slice(8, 10))}일 · {rows.length}건</div>
              </div>
              <button type="button" onClick={() => { const d = naverDayDate; setNaverDayDate(null); openSimpleAdd(d); }} className="rounded-full bg-blue-600 px-4 py-2 text-xs font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700">＋ 일정 추가</button>
            </div>
            <div className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
              {rows.map((row) => (row.kind === "ticket" ? compactTicketRow(row.t) : compactNaverRow(row.ev)))}
              {!rows.length && <div className="py-10 text-center text-xs font-semibold text-slate-400">이 날짜의 일정이 없습니다.</div>}
            </div>
            <div className="border-t border-slate-100 px-4 py-3">
              <button type="button" onClick={() => setNaverDayDate(null)} className="w-full rounded-full border border-slate-300 bg-white py-2.5 text-sm font-black text-slate-600 transition hover:bg-slate-50">닫기</button>
            </div>
          </div>
        </div>
        );
      })()}
      {naverDetail && (
        <div className="fixed inset-0 z-[2400] flex items-center justify-center bg-black/45 p-4" onMouseDown={() => setNaverDetail(null)}>
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="bg-[#1E252F] px-5 py-4">
              <div className="flex items-center gap-2 text-[11px] font-black">
                <span className={`rounded px-1.5 py-0.5 text-white ${naverBadgeStyle(naverDetail)}`}>{naverCategoryOf(naverDetail)}</span>
                {naverTeamOf(naverDetail) && <span className="rounded bg-white/10 px-1.5 py-0.5 text-slate-300">{naverTeamOf(naverDetail)}팀</span>}
                {naverDetail.completed && <span className="rounded bg-emerald-500/90 px-1.5 py-0.5 text-white">완료됨</span>}
                <span className="ml-auto hidden text-slate-400 sm:inline">수정하면 네이버 캘린더에 바로 반영</span>
                <button type="button" onClick={() => setNaverDetail(null)} className="ml-1 rounded-full p-1 text-slate-400 transition hover:bg-white/10 hover:text-white" aria-label="닫기"><svg className="h-4 w-4" viewBox="0 0 20 20" fill="none"><path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg></button>
              </div>
              {/* 제목 — [수정]을 눌러야 편집, [저장]으로 확정 (네이버에 바로 반영) */}
              <div className="mt-2 flex items-center gap-2">
                {naverTitleDraft === null ? (<>
                  <span className="min-w-0 flex-1 truncate px-1 text-[15px] font-bold text-white">{naverDetail.title || "(제목 없음)"}</span>
                  <button type="button" onClick={() => setNaverTitleDraft(naverDetail.title)} className="shrink-0 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-black text-slate-200 transition hover:bg-white/20">수정</button>
                </>) : (<>
                  <input value={naverTitleDraft} onChange={(e) => setNaverTitleDraft(e.target.value)} autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") { const v = naverTitleDraft.trim(); if (v && v !== naverDetail.title) void saveNaverField({ title: v }); setNaverTitleDraft(null); } if (e.key === "Escape") setNaverTitleDraft(null); }}
                    style={{ fontWeight: 700 }}
                    className="min-w-0 flex-1 rounded-lg border border-blue-400 bg-white/15 px-3 py-2 text-[15px] text-white outline-none placeholder:text-slate-500" />
                  <button type="button" onClick={() => { const v = naverTitleDraft.trim(); if (v && v !== naverDetail.title) void saveNaverField({ title: v }); setNaverTitleDraft(null); }} className="shrink-0 rounded-full bg-blue-600 px-3.5 py-1.5 text-xs font-black text-white shadow-[0_2px_8px_rgba(37,99,235,0.4)] transition hover:bg-blue-700">저장</button>
                </>)}
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-bold text-slate-500">날짜
                  <input type="date" value={naverDetail.date} onClick={openPicker} onChange={(e) => { if (e.target.value) void saveNaverField({ date: e.target.value }); }}
                    className="mt-1 w-full cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500" />
                </label>
                <div className="text-xs font-bold text-slate-500">팀
                  <div className="mt-1">
                    <PortalSelect direction="down" className="w-full py-2 font-semibold" width={240}
                      value={naverTeamOf(naverDetail) || ""} onChange={(v) => { const slot = TEAM_SLOT[v]; if (slot) void saveNaverField({ time: slot, date: naverDetail.date }); }}
                      options={[{ value: "", label: "종일" }, ...["A", "B", "C", "D", "E"].map((tm) => ({ value: tm, label: `${tm}팀 · ${TEAM_SLOT_LABEL[tm]}` }))]} />
                  </div>
                </div>
              </div>
              <label className="block text-xs font-bold text-slate-500">장소
                <input key={`loc-${naverDetail.uid}`} defaultValue={naverDetail.location}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v !== naverDetail.location) void saveNaverField({ location: v }); }}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500" />
              </label>
              <label className="block text-xs font-bold text-slate-500">내용 <span className="font-semibold text-slate-400">— 입력창을 벗어나면 저장</span>
                <textarea key={`desc-${naverDetail.uid}`} defaultValue={naverDetail.description} rows={8}
                  onBlur={(e) => { const v = e.target.value; if (v !== naverDetail.description) void saveNaverField({ description: v }); }}
                  className="mt-1 w-full resize-y rounded-lg border border-slate-300 bg-slate-50/50 p-3.5 text-[13.5px] font-medium leading-[1.7] text-slate-800 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10" />
              </label>
              <div className="text-xs font-bold text-slate-500">캘린더 이동
                <div className="mt-1">
                  <PortalSelect direction="down" className="w-full py-2 font-semibold" width={280}
                    value={naverDetail.calendar_id} onChange={(v) => { if (v !== naverDetail.calendar_id) void transferNaverEvent(v); }}
                    options={[...NAVER_CAL_LIST.map((c) => ({ value: c.id, label: c.name })), ...(NAVER_CAL_LIST.some((c) => c.id === naverDetail.calendar_id) ? [] : [{ value: naverDetail.calendar_id, label: "(현재 캘린더)" }])]} />
                </div>
              </div>
            </div>
            <div className="space-y-1.5 border-t border-slate-100 px-4 py-3">
              <div className="flex gap-1.5">
                <button type="button" onClick={() => { setNaverDupDate(getTomorrowYmd()); setNaverDupOpen("익일"); }} className="flex-1 whitespace-nowrap rounded-lg border border-purple-200 bg-purple-50 py-2.5 text-xs font-black text-purple-700">익일</button>
                <button type="button" onClick={() => { setNaverDupDate(naverDetail.date); setNaverDupOpen("복제"); }} className="flex-1 whitespace-nowrap rounded-lg border border-slate-300 bg-white py-2.5 text-xs font-black text-slate-700 transition hover:bg-slate-50">복제</button>
                <button type="button" onClick={() => setNaverDupOpen("반복")} className="flex-1 whitespace-nowrap rounded-lg border border-slate-300 bg-white py-2.5 text-xs font-black text-slate-700 transition hover:bg-slate-50">매월 반복</button>
                <button type="button" onClick={() => setNaverDeleteConfirm(true)} className="flex-1 whitespace-nowrap rounded-lg border border-rose-200 bg-rose-50 py-2.5 text-xs font-black text-rose-600">삭제</button>
              </div>
              <button type="button" disabled={naverCheckBusy} onClick={() => { if (naverDetail.completed) void toggleNaverComplete(); else setNaverDoneConfirm(true); }} className={`w-full rounded-lg py-2.5 text-xs font-black transition disabled:opacity-40 ${naverDetail.completed ? "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50" : "bg-emerald-600 text-white shadow-[0_3px_10px_rgba(5,150,105,0.3)] hover:bg-emerald-700"}`}>{naverCheckBusy ? "처리 중…" : naverDetail.completed ? "완료 해제" : "✓ 완료"}</button>
            </div>
            {naverDeleteConfirm && (
              <div className="fixed inset-0 z-[2460] flex items-center justify-center bg-black/45 p-5" onMouseDown={() => setNaverDeleteConfirm(false)}>
                <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
                  <div className="bg-[#1E252F] px-5 py-4">
                    <div className="text-[11px] font-black text-rose-400">🗑 삭제하시겠습니까?</div>
                    <div className="mt-0.5 truncate text-[15px] font-black text-white">{naverDetail.title || "(제목 없음)"}</div>
                  </div>
                  <div className="px-5 py-4 text-sm font-bold text-slate-700">삭제하면 되돌릴 수 없습니다.<div className="mt-1.5 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600">네이버 캘린더에서도 삭제됩니다.</div></div>
                  <div className="flex gap-2 px-4 pb-4">
                    <button type="button" onClick={() => setNaverDeleteConfirm(false)} className="flex-1 rounded-full border border-slate-300 bg-white py-2.5 text-sm font-black text-slate-600 transition hover:bg-slate-50">취소</button>
                    <button type="button" onClick={() => void deleteNaverEvent()} className="flex-[2] rounded-full bg-rose-600 py-2.5 text-sm font-black text-white shadow-[0_3px_10px_rgba(225,29,72,0.3)] transition hover:bg-rose-700">삭제</button>
                  </div>
                </div>
              </div>
            )}
            {naverDoneConfirm && (
              <div className="fixed inset-0 z-[2450] flex items-center justify-center bg-black/45 p-5" onMouseDown={() => setNaverDoneConfirm(false)}>
                <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
                  <div className="bg-[#1E252F] px-5 py-4">
                    <div className="text-[11px] font-black text-emerald-400">✓ 완료 처리</div>
                    <div className="mt-0.5 truncate text-[15px] font-black text-white">{naverDetail.title || "(제목 없음)"}</div>
                  </div>
                  <div className="px-5 py-4 text-sm font-bold text-slate-700">이 일정을 완료 처리할까요?<div className="mt-1 text-xs font-semibold text-slate-400">네이버 캘린더 앱에도 완료 체크로 표시됩니다.</div></div>
                  <div className="flex gap-2 px-4 pb-4">
                    <button type="button" onClick={() => setNaverDoneConfirm(false)} className="flex-1 rounded-full border border-slate-300 bg-white py-2.5 text-sm font-black text-slate-600 transition hover:bg-slate-50">취소</button>
                    <button type="button" onClick={() => { setNaverDoneConfirm(false); void toggleNaverComplete(); }} className="flex-[2] rounded-full bg-emerald-600 py-2.5 text-sm font-black text-white shadow-[0_3px_10px_rgba(5,150,105,0.3)] transition hover:bg-emerald-700">✓ 완료</button>
                  </div>
                </div>
              </div>
            )}
            {naverDupOpen && (
              <div className="fixed inset-0 z-[2450] flex items-center justify-center bg-black/45 p-5" onMouseDown={() => !naverDupBusy && setNaverDupOpen(null)}>
                <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
                  <div className="bg-[#1E252F] px-5 py-4">
                    <div className="text-[11px] font-black text-blue-400">{naverDupOpen === "복제" ? "일정 복제" : naverDupOpen === "익일" ? "일정 미루기" : "매월 반복 생성"}</div>
                    <div className="mt-0.5 truncate text-[15px] font-black text-white">{naverDetail.title || "(제목 없음)"}</div>
                  </div>
                  {naverDupOpen === "익일" ? (
                    <div className="px-5 py-4">
                      <div className="grid grid-cols-2 gap-2">
                        {([["익일", getTomorrowYmd()], ["1주", addDays(getTodayYmd(), 7)], ["1달", addMonths(getTodayYmd(), 1)], ["3달", addMonths(getTodayYmd(), 3)]] as const).map(([label, d]) => (
                          <button key={label} type="button" onClick={() => { void saveNaverField({ date: d }); setNaverDupOpen(null); }} className="rounded-full border border-slate-200 px-4 py-3 text-sm font-black text-slate-700 hover:bg-slate-50">
                            {label}<div className="mt-1 text-xs text-slate-400">{d}</div>
                          </button>
                        ))}
                      </div>
                      <div className="mt-3 flex gap-2">
                        <input type="date" value={naverDupDate} onClick={openPicker} onChange={(e) => setNaverDupDate(e.target.value)} className="min-w-0 flex-1 cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold outline-none transition focus:border-purple-500" />
                        <button type="button" disabled={!naverDupDate} onClick={() => { void saveNaverField({ date: naverDupDate }); setNaverDupOpen(null); }} className="rounded-full bg-purple-600 px-4 py-2 text-sm font-black text-white disabled:opacity-40">직접선택</button>
                      </div>
                    </div>
                  ) : naverDupOpen === "복제" ? (
                    <div className="px-5 py-4">
                      <label className="block text-xs font-bold text-slate-500">복제할 날짜
                        <input type="date" value={naverDupDate} onClick={openPicker} onChange={(e) => setNaverDupDate(e.target.value)} className="mt-1 w-full cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500" />
                      </label>
                    </div>
                  ) : (
                    <div className="px-5 py-4 text-sm font-bold text-slate-700">이 일정을 다음 달부터 <b>11개월간 매월 같은 날</b>로 복제합니다.<div className="mt-1 text-xs font-semibold text-slate-400">네이버 캘린더에도 그대로 생성됩니다.</div></div>
                  )}
                  <div className="flex gap-2 px-4 pb-4">
                    <button type="button" disabled={naverDupBusy} onClick={() => setNaverDupOpen(null)} className="flex-1 rounded-full border border-slate-300 bg-white py-2.5 text-sm font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">취소</button>
                    {naverDupOpen !== "익일" && <button type="button" disabled={naverDupBusy || (naverDupOpen === "복제" && !naverDupDate)} onClick={() => { if (naverDupOpen === "복제") void duplicateNaverEvent([naverDupDate]); else { const ds: string[] = []; let d = naverDetail.date; for (let k = 0; k < 11; k++) { d = nextMonthSameDay(d); ds.push(d); } void duplicateNaverEvent(ds); } }} className="flex-[2] rounded-full bg-blue-600 py-2.5 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 disabled:opacity-40">{naverDupBusy ? "생성 중…" : naverDupOpen === "복제" ? "이 날짜로 복제" : "11개월 반복 생성"}</button>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {simpleAdd && (
        <div className="fixed inset-0 z-[2440] flex items-center justify-center bg-black/45 p-4" onMouseDown={() => setSimpleAdd(null)}>
          <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between bg-[#1E252F] px-5 py-4">
              <div className="text-[15px] font-black text-white">＋ 일정 추가</div>
              <button type="button" onClick={() => setSimpleAdd(null)} className="rounded-full p-1 text-slate-400 transition hover:bg-white/10 hover:text-white" aria-label="닫기"><svg className="h-4 w-4" viewBox="0 0 20 20" fill="none"><path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg></button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
              <label className="block text-xs font-bold text-slate-500">제목
                <input value={simpleAdd.title} onChange={(e) => setSimpleAdd({ ...simpleAdd, title: e.target.value })} autoFocus placeholder="예: 신정훈 - 전자계약서 작성 확인"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-bold text-slate-500">날짜
                  <input type="date" value={simpleAdd.date} onClick={openPicker} onChange={(e) => { if (e.target.value) setSimpleAdd({ ...simpleAdd, date: e.target.value }); }}
                    className="mt-1 w-full cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500" />
                </label>
                <div className="text-xs font-bold text-slate-500">팀
                  <div className="mt-1">
                    <PortalSelect direction="down" className="w-full py-2 font-semibold" width={240}
                      value={simpleAdd.team} onChange={(v) => setSimpleAdd({ ...simpleAdd, team: v as Team })}
                      options={(["A", "B", "C", "D", "E"] as Team[]).map((tm) => ({ value: tm, label: `${tm}팀 · ${TEAM_SLOT_LABEL[tm]}` }))} />
                  </div>
                </div>
              </div>
              <label className="block text-xs font-bold text-slate-500">장소
                <input value={simpleAdd.address} onChange={(e) => setSimpleAdd({ ...simpleAdd, address: e.target.value })} placeholder="방문 주소 (선택)"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500" />
              </label>
              <label className="block text-xs font-bold text-slate-500">내용
                <textarea value={simpleAdd.note} onChange={(e) => setSimpleAdd({ ...simpleAdd, note: e.target.value })} rows={5} placeholder="일정 내용 (선택)"
                  className="mt-1 w-full resize-y rounded-lg border border-slate-300 bg-slate-50/50 p-3.5 text-[13.5px] font-medium leading-[1.7] text-slate-800 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10" />
              </label>
              <div className="grid grid-cols-2 items-end gap-2">
                <div className="text-xs font-bold text-slate-500">캘린더
                  <div className="mt-1">
                    <PortalSelect direction="down" className="w-full py-2 font-semibold" width={260}
                      value={simpleAdd.cal} onChange={(v) => setSimpleAdd({ ...simpleAdd, cal: v as ScheduleType })}
                      options={[{ value: "AS", label: "익일통합as" }, { value: "납품철수교체휴가교육", label: "납품철수교체휴가교육" }, { value: "매월점검", label: "매월점검" }]} />
                  </div>
                </div>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-black text-slate-600 transition hover:bg-slate-50">
                  <input type="checkbox" checked={simpleAdd.repeat} onChange={(e) => setSimpleAdd({ ...simpleAdd, repeat: e.target.checked })} className="h-4 w-4 accent-blue-600" />
                  매월 반복 (11개월)
                </label>
              </div>
            </div>
            <div className="border-t border-slate-100 px-4 py-3">
              <button type="button" disabled={!simpleAdd.title.trim()} onClick={submitSimpleAdd} className="w-full rounded-full bg-blue-600 py-2.5 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 disabled:opacity-40">등록</button>
            </div>
          </div>
        </div>
      )}
      {deleteTarget && (
        <div className="fixed inset-0 z-[2460] flex items-center justify-center bg-black/45 p-5" onMouseDown={() => setDeleteTarget(null)}>
          <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="bg-[#1E252F] px-5 py-4">
              <div className="text-[11px] font-black text-rose-400">🗑 삭제하시겠습니까?</div>
              <div className="mt-0.5 truncate text-[15px] font-black text-white">{(deleteTarget.calendarTitle || "").trim() || deleteTarget.vendor || "이 일정"}</div>
            </div>
            <div className="px-5 py-4 text-sm font-bold text-slate-700">삭제하면 되돌릴 수 없습니다.{deleteTarget.naverUid && <div className="mt-1.5 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600">네이버 캘린더의 미러 일정도 함께 삭제됩니다.</div>}</div>
            <div className="flex gap-2 px-4 pb-4">
              <button type="button" onClick={() => setDeleteTarget(null)} className="flex-1 rounded-full border border-slate-300 bg-white py-2.5 text-sm font-black text-slate-600 transition hover:bg-slate-50">취소</button>
              <button type="button" onClick={() => doRemoveTicket(deleteTarget)} className="flex-[2] rounded-full bg-rose-600 py-2.5 text-sm font-black text-white shadow-[0_3px_10px_rgba(225,29,72,0.3)] transition hover:bg-rose-700">삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 네이버 캘린더 미러 일정 조회·수정 — CalDAV 경유 (실험적: 네이버 비공식 통로)


// 완료 사유 입력 — 적으면 팀 AS방 카톡 + 네이버 일정 내용에 남고, 비우면 조용히 완료만
function DoneReasonModal({ ticket, onClose, onApply }: { ticket: AsTicket; onClose: () => void; onApply: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const isDelivery = ticket.scheduleType === "납품철수교체휴가교육" || ticket.scheduleType === "물류";
  return (
    <div className="fixed inset-0 z-[130] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="text-lg font-black text-slate-950">✓ 완료 처리하시겠습니까?</div>
        <div className="mt-1 text-sm font-semibold text-slate-500">{ticket.vendor}</div>
        {!!ticket.naverUid && (isDelivery
          ? <div className="mt-2 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">납품·철수·교체는 영업부 캘린더 소관입니다 — 네이버 일정은 <b>옮기지 않고 제자리에서 완료 체크</b>만 합니다.</div>
          : <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">네이버 캘린더 일정에 완료 체크됩니다. {ticket.team}팀 완료 캘린더가 등록돼 있으면 그 캘린더로 옮겨집니다.</div>)}
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus
          placeholder={`처리 내용 (필수) — ${isDelivery ? "완료방(납품,철수,교체)" : "팀 AS방"}으로 전송되고 네이버 일정에도 기록됩니다`}
          className="mt-4 w-full resize-y rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={onClose} className="rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-600">취소</button>
          <button type="button" disabled={!reason.trim()} onClick={() => onApply(reason)} className="flex-1 rounded-full bg-blue-600 py-2.5 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-40">완료</button>
        </div>
      </div>
    </div>
  );
}

function DeferModal({ ticket, customDate, onCustomDate, onClose, onApply }: { ticket: AsTicket; customDate: string; onCustomDate: (date: string) => void; onClose: () => void; onApply: (date: string, reason?: string) => void }) {
  const [reason, setReason] = useState("");
  const today = getTodayYmd();
  const options = [
    ["익일", getTomorrowYmd()],
    ["1주", addDays(today, 7)],
    ["1달", addMonths(today, 1)],
    ["3달", addMonths(today, 3)],
  ] as const;

  return (
    <div className="fixed inset-0 z-[130] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="text-lg font-black text-slate-950">익일 일정 변경</div>
        <div className="mt-1 text-sm font-semibold text-slate-500">{ticket.vendor}</div>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} autoFocus
          placeholder="① 미루는 사유부터 입력하세요 (필수) — 팀 AS방으로 전송되고 네이버 일정에도 기록됩니다"
          className="mt-4 w-full resize-y rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-semibold outline-none transition focus:border-purple-500 focus:ring-4 focus:ring-purple-500/10" />
        {!reason.trim() && <div className="mt-1.5 text-[11px] font-bold text-purple-500">사유를 입력하면 아래 날짜 버튼이 열립니다</div>}
        <div className="mt-3 grid grid-cols-2 gap-2">
          {options.map(([label, date]) => (
            <button key={label} type="button" disabled={!reason.trim()} onClick={() => onCustomDate(date)} className={`rounded-full border px-4 py-3 text-sm font-black transition disabled:opacity-40 ${customDate === date ? "border-purple-500 bg-purple-50 text-purple-700 ring-4 ring-purple-500/10" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>
              {label}
              <div className="mt-1 text-xs text-slate-400">{date}</div>
            </button>
          ))}
        </div>
        <div className="mt-3">
          <input type="date" value={customDate} onChange={(event) => onCustomDate(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold outline-none transition focus:border-purple-500 focus:ring-4 focus:ring-purple-500/10" />
        </div>
        <button type="button" disabled={!reason.trim() || !customDate} onClick={() => onApply(customDate, reason)}
          className="mt-3 w-full rounded-full bg-purple-600 py-2.5 text-sm font-black text-white shadow-[0_3px_10px_rgba(147,51,234,0.3)] transition hover:bg-purple-700 disabled:opacity-40">
          {customDate ? `${customDate}(으)로 일정 변경` : "날짜를 선택하세요"}
        </button>
      </div>
    </div>
  );
}

// 내용에 맞춰 높이가 자동으로 늘어나는 입력칸

