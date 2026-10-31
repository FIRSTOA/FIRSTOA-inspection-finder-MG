import { describe, expect, it } from "vitest";
import { decideGoneTicket, probeResultOf } from "../supabase/functions/naver-calendar-sync/guard.ts";

// 2026-10-31: 네이버 장애 때 "다른 캘린더로 옮김"을 못 확인하면 지우지 않고 미룬다(8월 사고 계통 재발 방지)
describe("naver-calendar-sync 삭제 가드", () => {
  it("캘린더 목록 조회 실패(null) → 보류", () => {
    expect(decideGoneTicket({ accountCals: null, probes: [] })).toBe("defer");
  });
  it("다른 캘린더에 살아 있음 → 옮김(삭제 안 함)", () => {
    expect(decideGoneTicket({ accountCals: ["a", "b"], probes: ["absent", "found"] })).toBe("moved");
  });
  it("확인 중 하나라도 실패 → 보류", () => {
    expect(decideGoneTicket({ accountCals: ["a", "b"], probes: ["absent", "error"] })).toBe("defer");
  });
  it("전부 없음으로 확인 → 삭제. 다른 캘린더가 아예 없어도(빈 배열, 조회는 성공) 삭제", () => {
    expect(decideGoneTicket({ accountCals: ["a", "b"], probes: ["absent", "absent"] })).toBe("delete");
    expect(decideGoneTicket({ accountCals: [], probes: [] })).toBe("delete");
  });
  it("probe 응답 판정: 2xx 있음 · 404/410 없음 · 5xx·타임아웃(null) 실패", () => {
    expect(probeResultOf({ ok: true, status: 200 })).toBe("found");
    expect(probeResultOf({ ok: false, status: 404 })).toBe("absent");
    expect(probeResultOf({ ok: false, status: 410 })).toBe("absent");
    expect(probeResultOf({ ok: false, status: 503 })).toBe("error");
    expect(probeResultOf(null)).toBe("error");
  });
});
