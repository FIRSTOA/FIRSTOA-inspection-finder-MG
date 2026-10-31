import { describe, expect, it } from "vitest";
import {
  autoConfigOf, bandSummary, canSendNow, lastSentRow, nowCooldownMs, parseReportTeams, reasonLabel,
  type ScheduleReportLogRow,
} from "../src/scheduleReportAuto";

const row = (p: Partial<ScheduleReportLogRow>): ScheduleReportLogRow => ({
  id: 1, kst_date: "2026-11-02", team: "C", slot: "12", status: "queued", reason: "", room: "테스트 전용방", real_room: "강남C 스케줄",
  test: true, outbox_id: null, text: "", created_at: "2026-11-02T03:00:05Z", ...p,
});

describe("자동 중간보고 띠 문구", () => {
  it("자동 꺼짐이면 그 안내만", () => {
    expect(bandSummary({ auto: false }, [row({})], [], "12:30")).toBe("자동 발송 꺼짐(관리 탭)");
  });
  it("12시 배달(봇·테스트방) · 14시 대기", () => {
    const rows = [row({ outbox_id: "o1" })];
    const deliveries = [{ outbox_id: "o1", sender: "bot", sent_at: "2026-11-02T03:00:41Z" }];
    expect(bandSummary({ auto: true }, rows, deliveries, "12:30")).toBe("자동 발송 12:00 ✓ 배달 12:00:41 봇(테스트방) · 14:00 대기");
  });
  it("건너뜀·실패·보내는 중·지난 차수 기록 없음 · dry 는 무시", () => {
    const rows = [
      row({ id: 2, slot: "12", status: "skipped", reason: "manual_copied", test: false }),
      row({ id: 3, slot: "14", status: "dry", created_at: "2026-11-02T05:30:00Z" }),
    ];
    expect(bandSummary({ auto: true }, rows, [], "14:30")).toBe("자동 발송 12:00 건너뜀: 사람이 먼저 복사해 건너뜀 · 14:00 기록 없음");
    expect(bandSummary({ auto: true }, [row({ outbox_id: "o9", test: false })], [], "12:10", { pendingOutbox: ["o9"] }))
      .toBe("자동 발송 12:00 보내는 중 · 14:00 대기");
    expect(bandSummary({ auto: true }, [row({ status: "failed", reason: "boom" })], [], "12:10")).toContain("12:00 실패: boom");
  });
  it("reason 한국어 — 엣지 값 그대로 매핑, ai_fallback 은 접두", () => {
    expect(reasonLabel("off")).toBe("자동 발송 꺼짐(관리 탭)");
    expect(reasonLabel("holiday")).toBe("공휴일 쉼");
    expect(reasonLabel("empty")).toBe("오늘 일정 없음");
    expect(reasonLabel("ai_fallback: timeout")).toBe("AI 다듬기 실패 → 초안 발송");
    expect(reasonLabel("weird")).toBe("weird");
  });
});

describe("자동 중간보고 설정·권한·10분 제한", () => {
  it("설정 기본값: AUTO 꺼짐 · TEST 켜짐 · TEAMS=C · 전역 TEST_MODE 켜짐도 테스트방", () => {
    expect(autoConfigOf({})).toEqual({ auto: false, test: true, teams: ["C"], testRoom: "테스트 전용방" });
    expect(autoConfigOf({ SCHEDULE_REPORT_AUTO: "true", SCHEDULE_REPORT_TEST: "false", TEST_MODE: "false" }).test).toBe(false);
    expect(autoConfigOf({ SCHEDULE_REPORT_TEST: "false", TEST_MODE: "true" }).test).toBe(true);
    expect(parseReportTeams(" c, a ·x,C")).toEqual(["C", "A"]);
  });
  it("[지금 보내기]는 팀장·그 팀 명단만", () => {
    expect(canSendNow("신정훈", ["이홍진"], ["신정훈"])).toBe(true);
    expect(canSendNow("이홍진", ["이홍진", "이민구"], ["신정훈"])).toBe(true);
    expect(canSendNow("이권선", ["이홍진"], ["신정훈"])).toBe(false);
    expect(canSendNow("", ["이홍진"], ["신정훈"])).toBe(false);
  });
  it("10분 제한 — now queued·claim 만 세고, dry·skipped·차수 행은 무시", () => {
    const at = Date.parse("2026-11-02T03:00:00Z");
    const rows = [
      row({ slot: "now", status: "queued", created_at: "2026-11-02T03:00:00Z" }),
      row({ slot: "now", status: "dry", created_at: "2026-11-02T03:09:00Z" }),
      row({ slot: "12", status: "queued", created_at: "2026-11-02T03:09:00Z" }),
    ];
    expect(nowCooldownMs(rows, at + 4 * 60_000)).toBe(6 * 60_000);
    expect(nowCooldownMs(rows, at + 10 * 60_000)).toBe(0);
    expect(nowCooldownMs([row({ slot: "now", status: "skipped" })], at)).toBe(0);
  });
  it("마지막 발송 = 본문 있는 queued 중 가장 늦은 것", () => {
    const rows = [
      row({ id: 1, text: "12시 글", created_at: "2026-11-02T03:00:05Z" }),
      row({ id: 2, slot: "now", text: "지금 글", created_at: "2026-11-02T04:10:00Z" }),
      row({ id: 3, slot: "14", status: "dry", text: "미리보기", created_at: "2026-11-02T05:00:00Z" }),
    ];
    expect(lastSentRow(rows)?.text).toBe("지금 글");
    expect(lastSentRow([])).toBeNull();
  });
});
