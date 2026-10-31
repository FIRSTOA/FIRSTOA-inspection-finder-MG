// 자동 중간보고 엣지(schedule-report) 순수 분기: 인증·요청·슬롯 판정·방 선택·테스트방 치환·[복사]/연타 (2026-10-31)
import { describe, expect, it } from "vitest";
import {
  copyWindowStartIso, isAuthorized, isUniqueViolation, nowTooSoon, parseRequest, pickRoom, readConfig, slotGate, teamsToRun, withTestHeader,
} from "../supabase/functions/schedule-report/logic.ts";

const b64url = (obj: unknown) => btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (payload: Record<string, unknown>) => `Bearer ${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.sig`;
const NOW = Date.parse("2026-11-02T03:00:05Z"); // 월요일 KST 12:00:05
const REF = "kkdiihazgzesbqxjytqv";

const cfgOn = readConfig({
  SCHEDULE_REPORT_AUTO: "true", SCHEDULE_REPORT_TEST: "false", TEST_MODE: "false", TEST_ROOM: "테스트 전용방", FIELD_KAKAO_SEND_ENABLED: "true",
});

describe("schedule-report 인증", () => {
  it("이 프로젝트 anon/service JWT 만, 만료·다른 ref·다른 role·무인증은 거절", () => {
    const ctx = { projectRef: REF, serviceKey: "svc-key", nowMs: NOW };
    expect(isAuthorized(jwt({ ref: REF, role: "anon", exp: NOW / 1000 + 3600 }), ctx)).toBe(true);
    expect(isAuthorized(jwt({ ref: REF, role: "service_role" }), ctx)).toBe(true);
    expect(isAuthorized("Bearer svc-key", ctx)).toBe(true);
    expect(isAuthorized(jwt({ ref: REF, role: "anon", exp: NOW / 1000 - 1 }), ctx)).toBe(false);
    expect(isAuthorized(jwt({ ref: "otherproject", role: "anon" }), ctx)).toBe(false);
    expect(isAuthorized(jwt({ ref: REF, role: "authenticated" }), ctx)).toBe(false);
    expect(isAuthorized(null, ctx)).toBe(false);
    expect(isAuthorized("Bearer not-a-jwt", ctx)).toBe(false);
  });
});

describe("schedule-report 요청·설정", () => {
  it("slot 검사·team 대문자·actor 기본값", () => {
    expect(parseRequest({ slot: "12" })).toEqual({ slot: "12", team: undefined, dryRun: false, actor: "cron" });
    expect(parseRequest({ slot: "now", team: "c", actor: "  홍길동 ", dryRun: true })).toEqual({ slot: "now", team: "C", dryRun: true, actor: "홍길동" });
    expect(parseRequest({ slot: "13" })).toHaveProperty("error");
    expect(parseRequest({ slot: "12", team: "Z" })).toHaveProperty("error");
    expect(parseRequest(null)).toHaveProperty("error");
  });

  it("설정 기본값(키 없음): 자동 꺼짐·테스트방 켜짐·TEST_MODE 켜짐 취급·팀 C", () => {
    const empty = readConfig({});
    expect(empty).toMatchObject({ auto: false, testOn: true, testMode: true, testRoom: "테스트 전용방", kakaoEnabled: false });
    expect(teamsToRun(undefined, empty.teams)).toEqual(["C"]);
    expect(teamsToRun(undefined, " c, a ,C,x")).toEqual(["C", "A"]);
    expect(teamsToRun("B", "C")).toEqual(["B"]);
  });
});

describe("schedule-report 차수 판정", () => {
  const at = (ymd: string, hh: string) => ({ ymd, hh, mm: "00" });
  it("12/14: off → kakao_off → holiday → before10 순, now 는 스위치 무관·19시 뒤 막힘, dryRun 은 통과", () => {
    expect(slotGate({ slot: "12", dryRun: false, config: { ...cfgOn, auto: false }, nowKst: at("2026-11-02", "12") })).toBe("off");
    expect(slotGate({ slot: "12", dryRun: false, config: { ...cfgOn, kakaoEnabled: false }, nowKst: at("2026-11-02", "12") })).toBe("kakao_off");
    expect(slotGate({ slot: "14", dryRun: false, config: cfgOn, nowKst: at("2026-12-25", "14") })).toBe("holiday");
    expect(slotGate({ slot: "12", dryRun: false, config: cfgOn, nowKst: at("2026-10-31", "12") })).toBe("holiday"); // 토요일
    expect(slotGate({ slot: "12", dryRun: false, config: cfgOn, nowKst: at("2026-11-02", "09") })).toBe("before10");
    expect(slotGate({ slot: "12", dryRun: false, config: cfgOn, nowKst: at("2026-11-02", "12") })).toBeNull();
    expect(slotGate({ slot: "now", dryRun: false, config: { ...cfgOn, auto: false }, nowKst: at("2026-11-02", "15") })).toBeNull();
    expect(slotGate({ slot: "now", dryRun: false, config: cfgOn, nowKst: at("2026-11-02", "19") })).toBe("after19");
    expect(slotGate({ slot: "12", dryRun: true, config: readConfig({}), nowKst: at("2026-10-31", "07") })).toBeNull();
  });
});

describe("schedule-report 방 선택·테스트방", () => {
  const rows = [{ region: "A", room: "강남A 스케줄" }, { region: " c ", room: "강남C 스케줄" }];
  it("매핑 없으면 no_room(테스트 모드여도), 테스트 스위치·TEST_MODE 면 테스트방 + 머리 한 줄", () => {
    expect(pickRoom(rows, "B", { testOn: true, testMode: true, testRoom: "테스트 전용방" })).toEqual({ ok: false, reason: "no_room" });
    expect(pickRoom([{ region: "C", room: "  " }], "C", cfgOn)).toEqual({ ok: false, reason: "no_room" });
    expect(pickRoom(rows, "C", cfgOn)).toEqual({ ok: true, room: "강남C 스케줄", realRoom: "강남C 스케줄", test: false });
    const viaSwitch = pickRoom(rows, "C", { ...cfgOn, testOn: true });
    expect(viaSwitch).toEqual({ ok: true, room: "테스트 전용방", realRoom: "강남C 스케줄", test: true });
    expect(pickRoom(rows, "C", { ...cfgOn, testMode: true })).toMatchObject({ room: "테스트 전용방", test: true });
    expect(withTestHeader("12:00 중간보고\n…", { test: true, realRoom: "강남C 스케줄" })).toBe("[테스트 · 원래는 강남C 스케줄]\n12:00 중간보고\n…");
    expect(withTestHeader("본문", { test: false, realRoom: "강남C 스케줄" })).toBe("본문");
  });
});

describe("schedule-report [복사]·연타·중복", () => {
  it("복사 창 = 차수 KST 60분 전(UTC), now 는 없음 · now 10분 연타 · 409/23505 = already", () => {
    expect(copyWindowStartIso("12", "2026-11-02")).toBe("2026-11-02T02:00:00.000Z");
    expect(copyWindowStartIso("14", "2026-11-02")).toBe("2026-11-02T04:00:00.000Z");
    expect(copyWindowStartIso("now", "2026-11-02")).toBeNull();
    const nineMinAgo = new Date(NOW - 9 * 60_000).toISOString();
    const elevenMinAgo = new Date(NOW - 11 * 60_000).toISOString();
    expect(nowTooSoon([{ status: "queued", created_at: nineMinAgo }], NOW)).toBe(true);
    expect(nowTooSoon([{ status: "skipped", created_at: nineMinAgo }], NOW)).toBe(false);
    expect(nowTooSoon([{ status: "queued", created_at: elevenMinAgo }], NOW)).toBe(false);
    expect(isUniqueViolation(409, "")).toBe(true);
    expect(isUniqueViolation(400, '{"code":"23505"}')).toBe(true);
    expect(isUniqueViolation(400, '{"code":"23502"}')).toBe(false);
  });
});
