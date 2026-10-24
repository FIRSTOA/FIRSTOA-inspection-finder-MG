// 미처리 접수 현황판의 데이터 층(순수 변환 + 한 번 읽기). 화면은 ReceptionBoardPanel. 홈 미처리는 homeUnhandled.mergeUnhandled(2026-10-24 하나로).
// 설계: docs/tasks/reception-dept-types.md 4-1, 4-5. Supabase 접근은 래퍼(selectAllRows·fetchOpenReceptions)만.
import type { ReceptionRow } from "./ReceptionBoard";
import { RECEPTION_TYPES, type ReceptionType } from "./ReceptionTypePicker";
import { fetchOpenReceptions, type OpenReceptionRow } from "./deptReceptionApi";
import { ageDays, isDeptType, isStaleRemote, weekCompletionRate } from "./deptReception";
import { selectAllRows, selectRows, updateRows } from "./supabase";
import { fieldTicketVendor } from "./ids";
import { kstDate } from "./visits";
import { LOGISTICS_SCHEDULE_TYPES } from "./overdueLogic";
import { mergeSheetAndDb, sheetRowStatus, sheetRowUrl, type SheetOpenResult, type SheetOpenRow } from "./receptionSheetOpen";

const KNOWN_TYPES = new Set<string>(RECEPTION_TYPES.map((m) => m.type));

/** 열린 접수 행 → 현황판 카드 행. 6종 밖의 종류는 뺀다. 처리자·예정일·미룸 횟수는 지원 3종만 remote_meta 에서 읽는다. 상태(원격대기 포함)는 그대로 — 틀이 접수 칸에 합산한다. */
/** remote_meta.postpone_count(숫자 문자열일 수 있음) → 0 이상 정수 */
export function postponeOf(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 현황판 행 + "일정 없음" 표시(복합기 AS 인데 연결 일정이 하나도 없음). ReceptionRow 에 같은 이름 optional 필드가 생기면 그대로 맞물린다. */
export type BoardRow = ReceptionRow & { noTicket?: boolean };

export function toBoardRows(rows: OpenReceptionRow[], noTicketIds?: ReadonlySet<string>, today: string = kstDate()): BoardRow[] {
  const out: BoardRow[] = [];
  for (const r of rows) {
    if (!KNOWN_TYPES.has(r.type)) continue;
    if (isStaleRemote(r, today)) continue; // 7일 지난 원격대기 = 원격팀 처리로 봄
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
      ...(noTicketIds?.has(r.id) ? { noTicket: true } : {}),
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
export type BoardData = {
  rows: BoardRow[]; sources: Record<string, OpenReceptionRow>; todayCount: number; weekDoneRate: number | null;
  /** 일정 완료인데 접수가 열려 있어 이번에 완료로 고친 건수 */
  healed: number;
  /** 일정 대조·자가 치유 실패 메시지(화면은 계속, 패널이 한 번 알린다). 없으면 "" */
  syncError: string;
  /** 시트 기준(C3) — applySheetToBoard 가 채운다. 스위치 꺼짐이면 없음 */
  sheetMode?: boolean;
  /** 시트 읽기 실패·일부 탭 빠짐 안내 한 줄(없으면 "") */
  sheetNotice?: string;
  /** 90일 넘은 시트 미처리(칸 숫자 밖, "90일 넘음 n" 칩) */
  over90?: BoardRow[];
  /** 시트 완료로 DB 접수를 맞춘 건수(엣지 자가 치유, 스위치 켜졌을 때만) */
  sheetHealed?: number;
};

/** 일정(as_tickets)과 대조하는 접수 종류·상태. 보류·원격대기는 사람이 일부러 둔 상태라 건드리지 않는다. */
const TICKET_LINKED_TYPE = "복합기 AS";
const HEALABLE_STATUS = new Set(["접수", "진행중"]);
export const TICKET_SYNC_BY = "일정 완료 동기화";

type LinkedTicket = { id?: string; receptionId: string | null; status: string | null };

/**
 * 열린 복합기 AS 접수 ↔ 연결 일정 대조(순수).
 * - 연결 일정 중 하나라도 '완료'면 doneIds(열린 건에서 빼고 DB 를 완료로 고칠 것) — CsAsWorkspace 의 "최고 단계" 집계와 같은 규칙.
 * - 연결 일정이 하나도 없으면 noTicketIds(접수만 하고 일정 등록을 안 한 건 — 열린 건 그대로).
 * 대상은 복합기 AS · 상태 접수/진행중만.
 */
export function reconcileWithTickets(rows: OpenReceptionRow[], tickets: LinkedTicket[]): { doneIds: string[]; noTicketIds: Set<string> } {
  const byReception = new Map<string, string[]>();
  for (const t of tickets) {
    const rid = String(t.receptionId || "");
    if (!rid) continue;
    const list = byReception.get(rid) || [];
    list.push(String(t.status || ""));
    byReception.set(rid, list);
  }
  const doneIds: string[] = [];
  const noTicketIds = new Set<string>();
  for (const r of rows) {
    if (r.type !== TICKET_LINKED_TYPE || !HEALABLE_STATUS.has(String(r.status || ""))) continue;
    const st = byReception.get(r.id);
    if (!st || !st.length) noTicketIds.add(r.id);
    else if (st.includes("완료")) doneIds.push(r.id);
  }
  return { doneIds, noTicketIds };
}

const inList = (ids: string[]) => ids.map((i) => encodeURIComponent(`"${i}"`)).join(",");

/** 접수 id 묶음 → 연결 일정(id·receptionId·status). URL 길이 때문에 100개씩. 실패는 throw. */
async function fetchLinkedTickets(ids: string[]): Promise<LinkedTicket[]> {
  const out: LinkedTicket[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const part = ids.slice(i, i + 100);
    out.push(...await selectRows<LinkedTicket>("as_tickets", `select=id,receptionId,status&receptionId=in.(${inList(part)})&limit=1000`));
  }
  return out;
}

/** 일정은 완료됐는데 접수가 접수/진행중으로 남은 건을 완료로 고친다(조건에 상태를 다시 걸어 그 사이 사람이 바꾼 건은 건드리지 않음). 실패는 throw. */
export async function healDoneReceptions(ids: string[], now: string = new Date().toISOString()): Promise<void> {
  for (let i = 0; i < ids.length; i += 100) {
    const part = ids.slice(i, i + 100);
    await updateRows("service_receptions", `id=in.(${inList(part)})&status=in.(${[...HEALABLE_STATUS].map((s) => encodeURIComponent(s)).join(",")})`,
      { status: "완료", completed_at: now, completed_by: TICKET_SYNC_BY });
  }
}

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
  // 복합기 AS 접수 ↔ 일정 대조: 일정 완료면 열린 건에서 빼고 DB 도 완료로(자가 치유), 일정 없으면 "일정 없음" 표시.
  // 대조·치유 실패는 화면을 막지 않는다 — 대조 실패면 원래 상태 그대로 보여 주고 syncError 로 알린다.
  let syncError = "";
  let healed = 0;
  let doneSet = new Set<string>();
  let noTicketIds = new Set<string>();
  const linkedIds = open.filter((r) => r.type === TICKET_LINKED_TYPE && HEALABLE_STATUS.has(String(r.status || ""))).map((r) => r.id);
  if (linkedIds.length) {
    try {
      const rec = reconcileWithTickets(open, await fetchLinkedTickets(linkedIds));
      doneSet = new Set(rec.doneIds);
      noTicketIds = rec.noTicketIds;
      if (rec.doneIds.length) {
        try {
          await healDoneReceptions(rec.doneIds);
          healed = rec.doneIds.length;
        } catch (e) {
          syncError = `일정 완료 ${rec.doneIds.length}건을 접수에 반영하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
    } catch (e) {
      syncError = `접수와 일정 대조 실패(숫자에 완료된 건이 섞였을 수 있음): ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  const stillOpen = open.filter((r) => !doneSet.has(r.id) && !isStaleRemote(r, today));
  const sources: Record<string, OpenReceptionRow> = {};
  for (const r of stillOpen) sources[r.id] = r;
  return {
    rows: toBoardRows(stillOpen, noTicketIds, today),
    sources,
    todayCount: week.filter((r) => String(r.receipt_date || "").slice(0, 10) === today).length,
    weekDoneRate: rate.total ? Math.round(rate.rate * 100) : null,
    healed,
    syncError,
  };
}

/** 시트 미처리 행 → 현황판 행. 앱 접수에 이어진 행은 그 접수 id(상세·처리 단추가 그대로 붙음), 아니면 sheet:<탭>:<행> */
export function sheetToBoardRow(row: SheetOpenRow): BoardRow {
  return {
    id: row.receptionId || `sheet:${row.source}:${row.sheetRow}`,
    type: row.kind,
    vendor: String(row.vendor || ""),
    field: String(row.field || row.summary || ""),
    author: String(row.author || ""),
    handler: String(row.handler || ""),
    status: sheetRowStatus(row),
    receipt_date: String(row.date || ""),
    scheduled_date: null,
    postponeCount: 0,
    sheet: {
      source: row.source, sheetRow: row.sheetRow, seq: String(row.seq || ""), state: String(row.state || ""),
      summary: String(row.summary || ""), region: String(row.region || ""), url: sheetRowUrl(row.source, row.sheetRow),
      linked: Boolean(row.receptionId),
    },
  };
}

/**
 * DB 현황판 재료 + 시트 결과 → 시트 기준 현황판(C3). 스위치 꺼짐(enabled=false)이면 data 그대로(숫자 변화 없음).
 * 시트를 못 읽으면 DB 그대로 + sheetNotice. 순수 함수.
 */
export function applySheetToBoard(data: BoardData, sheet: SheetOpenResult, today: string = kstDate()): BoardData {
  if (!sheet.enabled) return data;
  const merge = mergeSheetAndDb(Object.values(data.sources), sheet.data, today, sheet.error);
  const kept = new Set(merge.db.map((r) => r.id));
  const sources: Record<string, OpenReceptionRow> = {};
  for (const r of merge.db) sources[r.id] = r;
  // 이어진 시트 행의 DB 원본은 (열려 있으면) 남겨 둔다 — 지원 3종 처리 단추가 원본을 쓴다
  for (const r of merge.sheet) if (r.receptionId && data.sources[r.receptionId]) sources[r.receptionId] = data.sources[r.receptionId];
  return {
    ...data,
    rows: [...data.rows.filter((r) => kept.has(r.id)), ...merge.sheet.map(sheetToBoardRow)],
    sources,
    sheetMode: merge.sheetKinds.length > 0,
    sheetNotice: merge.notice,
    over90: merge.over90.map(sheetToBoardRow),
    sheetHealed: sheet.data?.healed || 0,
  };
}

/** 일정 미처리 한 줄 — ReceptionBoard 의 ScheduleRow 와 같은 모양(구조 호환) */
export type ScheduleOverdueRow = { id: string; vendor: string; scheduleType: string; team: string; assignee: string; date: string; time?: string; status: string };

/** today 기준 n일 전(YYYY-MM-DD). today 는 kstDate() 값. */
export function daysBefore(today: string, n: number): string {
  const t = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  return new Date(t - n * 86_400_000).toISOString().slice(0, 10);
}

/** 물류 미처리로 세는 일정 유형 — 정의는 overdueLogic 한 곳(홈 미처리와 같은 값) */
export { LOGISTICS_SCHEDULE_TYPES };

/**
 * 물류 미처리 — as_tickets 중 유형이 물류·납품철수교체휴가교육(일정리스트 '납품' 칸)만,
 * 날짜가 오늘 이전·180일 이내, 상태 완료 아님, 최근 날짜 순 최대 3000건.
 * (2026-10-19 사용자 요청으로 AS 를 빼고 물류만. 매월점검은 유형 조건으로 자연히 빠진다.)
 * 업체명은 fieldTicketVendor 로 정리(구분 꼬리 제거). 실패는 throw.
 */
export async function loadScheduleOverdue(today: string = kstDate()): Promise<ScheduleOverdueRow[]> {
  const from = daysBefore(today, 180);
  const rows = await selectRows<ScheduleOverdueRow>("as_tickets", `select=id,team,date,time,vendor,assignee,status,scheduleType&date=lt.${today}&date=gte.${from}&status=neq.${encodeURIComponent("완료")}&scheduleType=in.(${LOGISTICS_SCHEDULE_TYPES.map((t) => encodeURIComponent(`"${t}"`)).join(",")})&order=date.desc,time.asc&limit=3000`);
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
