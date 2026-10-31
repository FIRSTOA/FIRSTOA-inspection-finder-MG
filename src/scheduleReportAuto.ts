/**
 * 자동 중간보고(12:00·14:00, 엣지 schedule-report) — 일정리스트 [📋 중간보고] 창의 "자동 발송 띠"가 쓰는 순수 로직 + 데이터 읽기/쓰기(2026-10-31).
 * 설계: docs/tasks/schedule-report-auto-2026-10-31.md 7절. 표 schedule_report_log(supabase/schedule-report-20261031.sql).
 * 설정 읽는 규칙은 엣지 supabase/functions/schedule-report/logic.ts readConfig·teamsToRun·pickRoom 과 같게 맞춘다
 *   (AUTO 없으면 꺼짐 · TEST 없으면 켜짐 · 전역 TEST_MODE 켜짐도 테스트방 · TEAMS 없으면 C).
 */
import { getConfig, getRoomMap, insertRow, invokeEdgeFunction, selectRows } from "./supabase";
import { kstDate } from "./visits";

export const SCHEDULE_REPORT_TEAMS = ["A", "B", "C", "D", "E"] as const;
export type ScheduleReportTeam = (typeof SCHEDULE_REPORT_TEAMS)[number];

export type ScheduleReportLogRow = {
  id: number;
  kst_date: string;
  team: string;
  slot: string;           // 12 · 14 · now · copy
  status: string;         // claim · queued · dry · skipped · failed · copied
  reason: string;
  room: string;
  real_room: string;
  test: boolean;
  outbox_id: string | null;
  text: string;
  created_at: string;
};

export type DeliveryRow = { outbox_id: string; sender: string; sent_at: string };

export type ScheduleReportAutoConfig = { auto: boolean; test: boolean; teams: string[]; testRoom: string };

const switchOn = (value: unknown, fallback: boolean) => {
  const v = String(value ?? "").trim().toLowerCase();
  return v ? v === "true" : fallback;
};

/** SCHEDULE_REPORT_TEAMS 값 → 팀 목록(쉼표·공백·가운뎃점, 없으면 C) */
export function parseReportTeams(value: unknown): string[] {
  const raw = String(value ?? "").trim() || "C";
  const out: string[] = [];
  for (const piece of raw.split(/[\s,·/]+/)) {
    const t = piece.trim().toUpperCase();
    if ((SCHEDULE_REPORT_TEAMS as readonly string[]).includes(t) && !out.includes(t)) out.push(t);
  }
  return out;
}

export function autoConfigOf(cfg: Record<string, string | undefined>): ScheduleReportAutoConfig {
  return {
    auto: switchOn(cfg.SCHEDULE_REPORT_AUTO, false),
    test: switchOn(cfg.SCHEDULE_REPORT_TEST, true) || switchOn(cfg.TEST_MODE, true),
    teams: parseReportTeams(cfg.SCHEDULE_REPORT_TEAMS),
    testRoom: String(cfg.TEST_ROOM || "").trim() || "테스트 전용방",
  };
}

/** 엣지 reason → 한국어(띠·안내). 모르는 값은 그대로 */
const REASON_LABELS: Record<string, string> = {
  off: "자동 발송 꺼짐(관리 탭)",
  kakao_off: "카톡 전송 꺼짐(관리 탭)",
  holiday: "공휴일 쉼",
  before10: "10시 전이라 쉼",
  after19: "19시 이후라 보내지 않음",
  too_soon: "10분 안에 이미 보냄",
  manual_copied: "사람이 먼저 복사해 건너뜀",
  empty: "오늘 일정 없음",
  no_room: "카톡방 매핑 없음(관리 탭 스케줄|팀)",
  already: "이미 보냄",
  log_update_failed: "보냈지만 기록 저장 실패",
};
export function reasonLabel(reason: string): string {
  const r = (reason || "").trim();
  if (!r) return "";
  if (r.startsWith("ai_fallback")) return "AI 다듬기 실패 → 초안 발송";
  if (r.startsWith("log_update_failed")) return "보냈지만 기록 갱신 실패(관리자 확인)";
  return REASON_LABELS[r] || r;
}

const hmOf = (iso: string) => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(t));
};

/** 한 차수(12·14) 칸 글 — 표의 그 차수 마지막 행 + 배달 기록 + 지금 KST 시각("HH:MM") */
export function slotLabel(
  slot: "12" | "14",
  rows: ScheduleReportLogRow[],
  deliveries: DeliveryRow[],
  nowHm: string,
  opts: { pendingOutbox?: string[]; deliveryKnown?: boolean } = {},
): string {
  const head = `${slot}:00`;
  const mine = rows.filter((r) => r.slot === slot && r.status !== "dry")
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const row = mine[0];
  if (!row) return nowHm < `${slot}:05` ? `${head} 대기` : `${head} 기록 없음`;
  const where = row.test ? "(테스트방)" : "";
  if (row.status === "queued") {
    const fallbackNote = row.reason.startsWith("ai_fallback") ? " · 초안" : "";
    const d = row.outbox_id ? deliveries.find((x) => x.outbox_id === row.outbox_id) : undefined;
    if (d) return `${head} ✓ 배달 ${hmOf(d.sent_at)} ${d.sender === "pc" ? "노트북" : "봇"}${where}${fallbackNote}`;
    if (row.outbox_id && opts.pendingOutbox?.includes(row.outbox_id)) return `${head} 보내는 중${where}${fallbackNote}`;
    return `${head} ✓ 보냄${where}${opts.deliveryKnown === false ? "(배달 확인 못 함)" : ""}${fallbackNote}`;
  }
  if (row.status === "claim") return `${head} 만드는 중`;
  if (row.status === "skipped") return `${head} 건너뜀: ${reasonLabel(row.reason)}`;
  if (row.status === "failed") return `${head} 실패: ${reasonLabel(row.reason) || "알 수 없음"}`;
  return `${head} ${row.status}`;
}

/** 띠 한 줄 — 자동 꺼짐이면 그 안내만 */
export function bandSummary(
  cfg: Pick<ScheduleReportAutoConfig, "auto">,
  rows: ScheduleReportLogRow[],
  deliveries: DeliveryRow[],
  nowHm: string,
  opts: { pendingOutbox?: string[]; deliveryKnown?: boolean } = {},
): string {
  if (!cfg.auto) return "자동 발송 꺼짐(관리 탭)";
  return `자동 발송 ${slotLabel("12", rows, deliveries, nowHm, opts)} · ${slotLabel("14", rows, deliveries, nowHm, opts)}`;
}

/** 마지막으로 실제 나간 글(차수·지금 보내기 모두) */
export function lastSentRow(rows: ScheduleReportLogRow[]): ScheduleReportLogRow | null {
  const sent = rows.filter((r) => r.status === "queued" && r.text)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return sent[0] || null;
}

/** [지금 보내기] 보일 사람 — 팀장 또는 그 팀 명단 */
export function canSendNow(author: string, members: string[], leaders: string[]): boolean {
  const me = (author || "").trim();
  if (!me) return false;
  return leaders.includes(me) || members.includes(me);
}

/** [지금 보내기] 10분 제한 — 남은 ms(0 이면 가능). 엣지 nowTooSoon 과 같은 기준(now 행 queued·claim) */
export const NOW_GAP_MS = 10 * 60_000;
export function nowCooldownMs(rows: ScheduleReportLogRow[], nowMs: number): number {
  let left = 0;
  for (const r of rows) {
    if (r.slot !== "now" || (r.status !== "queued" && r.status !== "claim")) continue;
    const at = Date.parse(r.created_at);
    if (!Number.isFinite(at)) continue;
    left = Math.max(left, NOW_GAP_MS - (nowMs - at));
  }
  return Math.max(0, left);
}

/** 표가 아직 없음(SQL 실행 전) — 띠를 조용히 숨긴다 */
export const isMissingTableError = (e: unknown) => /42P01|PGRST205|\(404\)/.test(String((e as Error)?.message ?? e));
/** 엣지가 아직 배포 전 */
export const isMissingEdgeError = (e: unknown) => /\(404\)|not found/i.test(String((e as Error)?.message ?? e));

export const kstHm = (d = new Date()) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

// ---- 데이터 ----

/** 설정 + 그 팀 방(room_map 스케줄|팀, 없으면 "") */
export async function loadAutoConfig(team: string): Promise<ScheduleReportAutoConfig & { room: string }> {
  const [cfg, rooms] = await Promise.all([getConfig(), getRoomMap()]);
  return { ...autoConfigOf(cfg), room: rooms[`스케줄|${team.toUpperCase()}`] || "" };
}

const LOG_COLUMNS = "id,kst_date,team,slot,status,reason,room,real_room,test,outbox_id,text,created_at";

/** 오늘(KST) 그 팀 기록 + 배달 기록. 배달·대기열 읽기가 실패하면 deliveryKnown=false(띠에 "배달 확인 못 함") */
export async function loadTodayLog(team: string): Promise<{ rows: ScheduleReportLogRow[]; deliveries: DeliveryRow[]; pendingOutbox: string[]; deliveryKnown: boolean }> {
  const rows = await selectRows<ScheduleReportLogRow>("schedule_report_log",
    `select=${LOG_COLUMNS}&kst_date=eq.${kstDate()}&team=eq.${encodeURIComponent(team)}&order=created_at.desc&limit=50`);
  const ids = [...new Set(rows.map((r) => r.outbox_id).filter((v): v is string => !!v))];
  if (!ids.length) return { rows, deliveries: [], pendingOutbox: [], deliveryKnown: true };
  const inList = `in.(${ids.join(",")})`;
  try {
    const [deliveries, pending] = await Promise.all([
      selectRows<DeliveryRow>("kakao_delivery_log", `select=outbox_id,sender,sent_at&outbox_id=${inList}`),
      selectRows<{ id: string }>("outbox", `select=id&id=${inList}`),
    ]);
    return { rows, deliveries, pendingOutbox: pending.map((p) => p.id), deliveryKnown: true };
  } catch {
    // 배달 기록 표가 없거나 읽기 실패 — 발송 기록(rows)은 보이고, 띠에 "배달 확인 못 함"으로 알린다
    return { rows, deliveries: [], pendingOutbox: [], deliveryKnown: false };
  }
}

/** 사람이 [복사] 누른 기록 — 엣지가 60분 안 복사면 그 차수를 건너뛴다(같은 글 두 번 방지). 실패는 호출 쪽이 무시 */
export async function recordReportCopy(team: string, actor: string): Promise<void> {
  await insertRow("schedule_report_log", { kst_date: kstDate(), team, slot: "copy", status: "copied", actor: (actor || "").slice(0, 40) });
}

export type ScheduleReportResult = {
  team: string; slot: string; status: string; reason?: string; room?: string; realRoom?: string; test?: boolean;
  text?: string; lines?: number; polished?: boolean; outboxId?: string; logId?: number; chars?: number;
};

/** 엣지 호출 — AI 다듬기가 길 수 있어 90초 */
export async function callScheduleReport(body: { slot: "now"; team: string; dryRun?: boolean; actor: string }): Promise<ScheduleReportResult | null> {
  const res = await invokeEdgeFunction<{ ok: boolean; results?: ScheduleReportResult[] }>("schedule-report", body, 90_000);
  return res.results?.find((r) => r.team === body.team) || res.results?.[0] || null;
}
