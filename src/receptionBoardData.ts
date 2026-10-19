// 미처리 접수 현황판·홈 카드의 데이터 층(순수 변환 + 한 번 읽기). 화면은 ReceptionBoardPanel·HomeReceptionPanel.
// 설계: docs/tasks/reception-dept-types.md 4-1, 4-5. Supabase 접근은 래퍼(selectAllRows·fetchOpenReceptions)만.
import type { ReceptionRow } from "./ReceptionBoard";
import { RECEPTION_TYPES, type ReceptionType } from "./ReceptionTypePicker";
import { fetchOpenReceptions, type OpenReceptionRow } from "./deptReceptionApi";
import { ageDays, isDeptType, weekCompletionRate } from "./deptReception";
import { selectAllRows, selectRows } from "./supabase";
import { fieldTicketVendor } from "./ids";
import { kstDate } from "./visits";

const KNOWN_TYPES = new Set<string>(RECEPTION_TYPES.map((m) => m.type));

/** 열린 접수 행 → 현황판 카드 행. 6종 밖의 종류는 뺀다. 처리자·예정일·미룸 횟수는 지원 3종만 remote_meta 에서 읽는다. 상태(원격대기 포함)는 그대로 — 틀이 접수 칸에 합산한다. */
/** remote_meta.postpone_count(숫자 문자열일 수 있음) → 0 이상 정수 */
export function postponeOf(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function toBoardRows(rows: OpenReceptionRow[]): ReceptionRow[] {
  const out: ReceptionRow[] = [];
  for (const r of rows) {
    if (!KNOWN_TYPES.has(r.type)) continue;
    const dept = isDeptType(r.type);
    const meta = r.remote_meta || {};
    const schedule = dept ? String(meta.schedule_date || "") : "";
    out.push({
      id: r.id,
      type: r.type as ReceptionType,
      vendor: String(r.vendor || ""),
      field: String(r.field || r.title || ""),
      author: String(r.author || ""),
      handler: dept ? String(meta.handler || "") : "",
      status: String(r.status || ""),
      receipt_date: String(r.receipt_date || "").slice(0, 10),
      scheduled_date: /^\d{4}-\d{2}-\d{2}/.test(schedule) ? schedule.slice(0, 10) : null,
      postponeCount: dept ? postponeOf(meta.postpone_count) : 0,
    });
  }
  return out;
}

/** 이번 주 월요일(KST, YYYY-MM-DD). today 는 kstDate() 값. */
export function weekStartOf(today: string): string {
  const t = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  const dow = new Date(t).getUTCDay() || 7;
  return new Date(t - (dow - 1) * 86_400_000).toISOString().slice(0, 10);
}

type WeekRow = { status: string; receipt_date: string };
export type BoardData = { rows: ReceptionRow[]; sources: Record<string, OpenReceptionRow>; todayCount: number; weekDoneRate: number | null };

/**
 * 현황판 재료 한 번 읽기: 열린 건(90일) + 이번 주 접수 전체(완료율·오늘 접수 수용, 최소 컬럼).
 * 완료율은 열린 건만으로는 셀 수 없어 이번 주 접수분을 상태 무관하게 따로 받는다. 실패는 throw.
 */
export async function loadBoardData(today: string = kstDate()): Promise<BoardData> {
  const weekStart = weekStartOf(today);
  const [open, week] = await Promise.all([
    fetchOpenReceptions(90),
    selectAllRows<WeekRow>("service_receptions", `select=status,receipt_date&receipt_date=gte.${weekStart}&deleted=eq.false`),
  ]);
  const rate = weekCompletionRate(week, today);
  const sources: Record<string, OpenReceptionRow> = {};
  for (const r of open) sources[r.id] = r;
  return {
    rows: toBoardRows(open),
    sources,
    todayCount: week.filter((r) => String(r.receipt_date || "").slice(0, 10) === today).length,
    weekDoneRate: rate.total ? Math.round(rate.rate * 100) : null,
  };
}

/** 일정 미처리 한 줄 — ReceptionBoard 의 ScheduleRow 와 같은 모양(구조 호환) */
export type ScheduleOverdueRow = { id: string; vendor: string; scheduleType: string; team: string; assignee: string; date: string; time?: string; status: string };

/** today 기준 n일 전(YYYY-MM-DD). today 는 kstDate() 값. */
export function daysBefore(today: string, n: number): string {
  const t = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  return new Date(t - n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * 일정 미처리(물류·AS·납품 등) — 홈 OverduePanel 과 같은 규칙:
 * as_tickets 중 날짜가 오늘 이전·180일 이내, 상태 완료 아님, 매월점검 제외, 최근 날짜 순 최대 3000건.
 * 업체명은 fieldTicketVendor 로 정리(구분 꼬리 제거). 실패는 throw.
 */
export async function loadScheduleOverdue(today: string = kstDate()): Promise<ScheduleOverdueRow[]> {
  const from = daysBefore(today, 180);
  const rows = await selectRows<ScheduleOverdueRow>("as_tickets", `select=id,team,date,time,vendor,assignee,status,scheduleType&date=lt.${today}&date=gte.${from}&status=neq.${encodeURIComponent("완료")}&scheduleType=neq.${encodeURIComponent("매월점검")}&order=date.desc,time.asc&limit=3000`);
  return rows.map((r) => {
    const raw = String(r.vendor || "");
    return { id: String(r.id), vendor: fieldTicketVendor(raw).vendor || raw, scheduleType: String(r.scheduleType || ""), team: String(r.team || ""), assignee: String(r.assignee || ""), date: String(r.date || "").slice(0, 10), time: r.time ? String(r.time) : undefined, status: String(r.status || "") };
  });
}

/** 일정리스트의 미처리 탭 열기 예약(Home.tsx openOverdue 와 같은 신호). 탭 전환은 부르는 쪽이 한다. */
export function requestOpenOverdue() {
  try { localStorage.setItem("cs_as_open_overdue", "1"); } catch { /* 저장 못 해도 이벤트로 연다 */ }
  window.setTimeout(() => window.dispatchEvent(new CustomEvent("cs:open-overdue")), 300);
}

export type HomeReceptionSummary = { counts: Record<ReceptionType, number>; oldest: { vendor: string; type: ReceptionType; days: number } | null; over7: number; scheduleOverdue: number };

/** 현황판 행 → 홈 카드 숫자(종류별 건수 + 가장 오래된 1건 + 경과 7일 이상 건수 + 일정 미처리 건수). */
export function summarizeForHome(rows: ReceptionRow[], today: string, schedule: ScheduleOverdueRow[] = []): HomeReceptionSummary {
  const counts = Object.fromEntries(RECEPTION_TYPES.map((m) => [m.type, 0])) as Record<ReceptionType, number>;
  let oldest: ReceptionRow | null = null;
  let over7 = 0;
  for (const r of rows) {
    counts[r.type] += 1;
    if (r.receipt_date && ageDays(r.receipt_date, today) >= 7) over7 += 1;
    if (r.receipt_date && (!oldest || r.receipt_date < oldest.receipt_date)) oldest = r;
  }
  return { counts, oldest: oldest ? { vendor: oldest.vendor, type: oldest.type, days: ageDays(oldest.receipt_date, today) } : null, over7, scheduleOverdue: schedule.filter((r) => r.date && r.date < today).length };
}
