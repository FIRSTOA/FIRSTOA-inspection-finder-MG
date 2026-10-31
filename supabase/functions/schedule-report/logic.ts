/**
 * schedule-report 순수 분기 — 인증(JWT 내용)·요청 읽기·설정 읽기·차수 판정·방 선택·테스트방 치환·[복사]/연타 판정.
 * Deno 전역(Deno.env·fetch)을 쓰지 않는다 → vitest 가 직접 import 한다(tests/scheduleReportEdge.test.ts).
 * 설계: docs/tasks/schedule-report-auto-2026-10-31.md 5절 + 맨 아래 결정(2026-10-31).
 */
import { isBusinessDay, type KstNow } from "../_shared/kr-holidays.ts";

export type Slot = "12" | "14" | "now";
export type Team = "A" | "B" | "C" | "D" | "E";
export const TEAMS: readonly Team[] = ["A", "B", "C", "D", "E"];

export type ScheduleReportRequest = { slot: Slot; team?: Team; dryRun: boolean; actor: string };

/** 요청 본문 → 검사된 요청. 틀리면 error(400) */
export function parseRequest(body: unknown): ScheduleReportRequest | { error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const slot = String(b.slot ?? "").trim();
  if (slot !== "12" && slot !== "14" && slot !== "now") return { error: "slot 은 12·14·now 중 하나" };
  let team: Team | undefined;
  if (b.team !== undefined && b.team !== null && String(b.team).trim() !== "") {
    const t = String(b.team).trim().toUpperCase();
    if (!(TEAMS as readonly string[]).includes(t)) return { error: "team 은 A~E" };
    team = t as Team;
  }
  const dryRun = b.dryRun === true;
  const fallbackActor = slot === "now" ? "" : "cron";
  const actor = String(b.actor ?? "").trim().slice(0, 40) || fallbackActor;
  return { slot, team, dryRun, actor };
}

/** JWT 가운데 조각 읽기(서명 검증은 게이트웨이 verify_jwt 가 이미 함) */
export function jwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * 인증 — reception-sheet-open snapshotAuthorized 와 같은 규칙: 이 프로젝트 ref · role anon|service_role · 만료 전.
 * (크론 = vault field_cron_jwt = anon, 앱 [지금 보내기] = anon.) service role 키 글자 일치도 통과.
 */
export function isAuthorized(authorization: string | null, ctx: { projectRef: string; serviceKey?: string; nowMs: number }): boolean {
  const bearer = (authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return false;
  if (ctx.serviceKey && bearer === ctx.serviceKey) return true;
  const p = jwtPayload(bearer);
  if (!p) return false;
  const roleOk = p.role === "anon" || p.role === "service_role";
  const refOk = Boolean(ctx.projectRef) && p.ref === ctx.projectRef;
  const expOk = typeof p.exp !== "number" || p.exp * 1000 > ctx.nowMs;
  return roleOk && refOk && expOk;
}

/** SUPABASE_URL(https://<ref>.supabase.co) → ref */
export function projectRefOf(url: string): string {
  const m = /^https?:\/\/([a-z0-9]+)\./i.exec(url || "");
  return m ? m[1] : "";
}

/** app_config 값 → 켜짐. 없으면(undefined·빈 값) fallback */
export function switchOn(value: unknown, fallback: boolean): boolean {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v) return fallback;
  return v === "true";
}

/** 돌릴 팀 — team 인자 우선, 없으면 SCHEDULE_REPORT_TEAMS(쉼표·공백, 없으면 C) */
export function teamsToRun(teamArg: Team | undefined, teamsConfig: unknown): Team[] {
  if (teamArg) return [teamArg];
  const raw = String(teamsConfig ?? "").trim() || "C";
  const out: Team[] = [];
  for (const piece of raw.split(/[\s,·/]+/)) {
    const t = piece.trim().toUpperCase();
    if ((TEAMS as readonly string[]).includes(t) && !out.includes(t as Team)) out.push(t as Team);
  }
  return out;
}

export type ReportConfig = {
  /** SCHEDULE_REPORT_AUTO (없으면 꺼짐) */
  auto: boolean;
  /** SCHEDULE_REPORT_TEST (없으면 켜짐) */
  testOn: boolean;
  /** 전역 TEST_MODE (없으면 켜짐 — weekly-keyman-poster 선례) */
  testMode: boolean;
  /** TEST_ROOM (없으면 "테스트 전용방") */
  testRoom: string;
  /** FIELD_KAKAO_SEND_ENABLED (앱 isEnabled 와 같이 'true' 만 켜짐) — 관리 탭 "카톡 전송" 끄기 = 비상 정지 */
  kakaoEnabled: boolean;
  /** SCHEDULE_REPORT_TEAMS 원문 */
  teams: unknown;
};

export const CONFIG_KEYS = ["SCHEDULE_REPORT_AUTO", "SCHEDULE_REPORT_TEST", "SCHEDULE_REPORT_TEAMS", "TEST_MODE", "TEST_ROOM", "FIELD_KAKAO_SEND_ENABLED"] as const;

export function readConfig(map: Record<string, string | undefined>): ReportConfig {
  return {
    auto: switchOn(map.SCHEDULE_REPORT_AUTO, false),
    testOn: switchOn(map.SCHEDULE_REPORT_TEST, true),
    testMode: switchOn(map.TEST_MODE, true),
    testRoom: String(map.TEST_ROOM || "").trim() || "테스트 전용방",
    kakaoEnabled: switchOn(map.FIELD_KAKAO_SEND_ENABLED, false),
    teams: map.SCHEDULE_REPORT_TEAMS,
  };
}

/**
 * 차수 판정 — 보내면 안 되는 이유(reason) 또는 null.
 * dryRun 은 미리 보기라 막지 않는다(주말·10시 전에도 글을 볼 수 있게).
 * 12/14: 스위치 꺼짐 off → 카톡 전송 꺼짐 kakao_off → 영업일 아님 holiday → 10시 전 before10.
 * now  : 스위치와 무관. kakao_off → holiday → 10~19시 밖 before10/after19.
 */
export function slotGate(input: { slot: Slot; dryRun: boolean; config: ReportConfig; nowKst: KstNow }): string | null {
  const { slot, dryRun, config, nowKst } = input;
  if (dryRun) return null;
  if (slot !== "now" && !config.auto) return "off";
  if (!config.kakaoEnabled) return "kakao_off";
  if (!isBusinessDay(nowKst.ymd)) return "holiday";
  const hh = Number(nowKst.hh);
  if (hh < 10) return "before10";
  if (slot === "now" && hh >= 19) return "after19";
  return null;
}

export type RoomPick = { ok: true; room: string; realRoom: string; test: boolean } | { ok: false; reason: "no_room" };

/**
 * 방 정하기 — room_map 스케줄|팀. 매핑이 없으면 no_room(테스트 모드여도 안 보냄 — 매핑 누락을 테스트방이 덮지 않게).
 * 이 기능 테스트 스위치 또는 전역 TEST_MODE 가 켜져 있으면 테스트방으로(real_room 에 원래 방).
 */
export function pickRoom(
  rows: Array<{ region?: unknown; room?: unknown }>,
  team: Team,
  config: Pick<ReportConfig, "testOn" | "testMode" | "testRoom">,
): RoomPick {
  const hit = rows.find((r) => String(r.region ?? "").trim().toUpperCase() === team && String(r.room ?? "").trim());
  if (!hit) return { ok: false, reason: "no_room" };
  const realRoom = String(hit.room).trim();
  if (config.testOn || config.testMode) return { ok: true, room: config.testRoom, realRoom, test: true };
  return { ok: true, room: realRoom, realRoom, test: false };
}

/** 테스트방 글 머리 — weekly-keyman-poster 선례와 같은 꼴 */
export function withTestHeader(text: string, pick: { test: boolean; realRoom: string }): string {
  return pick.test ? `[테스트 · 원래는 ${pick.realRoom}]\n${text}` : text;
}

/** 사람이 [복사] 한 기록을 보는 창의 시작 — 차수 시각(KST) 60분 전(UTC ISO). now 는 보지 않음(null) */
export function copyWindowStartIso(slot: Slot, ymd: string): string | null {
  if (slot === "now") return null;
  const at = new Date(`${ymd}T${slot}:00:00+09:00`).getTime() - 60 * 60_000;
  return new Date(at).toISOString();
}

/** [지금 보내기] 연타 막기 — 같은 팀 now 가 10분 안에 queued/claim 이면 true */
export const NOW_MIN_GAP_MS = 10 * 60_000;
export function nowTooSoon(rows: Array<{ status?: unknown; created_at?: unknown }>, nowMs: number): boolean {
  return rows.some((r) => {
    const st = String(r.status ?? "");
    if (st !== "queued" && st !== "claim") return false;
    const at = Date.parse(String(r.created_at ?? ""));
    return Number.isFinite(at) && nowMs - at < NOW_MIN_GAP_MS;
  });
}

/** PostgREST unique 위반(부분 인덱스라 on_conflict 를 못 쓴다 — 409/23505 를 'already' 로) */
export function isUniqueViolation(status: number, bodyText: string): boolean {
  return status === 409 || /23505/.test(bodyText);
}

/** 로그 열 제약(text ≤6000, reason ≤300) 안으로 */
export const clip = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value);
