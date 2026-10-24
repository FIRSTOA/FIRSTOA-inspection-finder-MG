import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supabase", async (orig) => {
  const real = await orig<typeof import("../src/supabase")>();
  return { ...real, invokeEdgeFunction: vi.fn() };
});

import { invokeEdgeFunction } from "../src/supabase";
import { buildKakaoRequest, highlightParts, kakaoTimeLabel, searchKakao, TAB_SPECS } from "../src/tabSearch";

const mocked = vi.mocked(invokeEdgeFunction);
afterEach(() => mocked.mockReset());

describe("탭 검색 2단계 — 카톡 대화 탭", () => {
  it("탭마다 볼 방 종류: 점검·AS / 물류 / 초과조정은 재계약 방까지, 수집 안 하는 탭은 없음", () => {
    expect(TAB_SPECS.inspection.kakaoKinds).toEqual(["점검", "AS"]);
    expect(TAB_SPECS.logistics.kakaoKinds).toEqual(["물류"]);
    expect(TAB_SPECS.overage.kakaoKinds).toEqual(["재계약", "초과조정"]);
    expect(TAB_SPECS.it.kakaoKinds).toBeUndefined();
    expect(TAB_SPECS.praise.kakaoKinds).toBeUndefined();
  });

  it("요청 몸통 — 2자 미만·방 없는 탭은 부르지 않는다, limit 은 200 넘지 않음", () => {
    expect(buildKakaoRequest(TAB_SPECS.logistics, "무암")).toEqual({ q: "무암", kinds: ["물류"], limit: 100 });
    expect(buildKakaoRequest(TAB_SPECS.logistics, " ㈜ ")).toBeNull();
    expect(buildKakaoRequest(TAB_SPECS.it, "무암")).toBeNull();
    expect(buildKakaoRequest(TAB_SPECS.bulman, "무암", { limit: 999, from: "2026-01-01" })).toEqual({ q: "무암", kinds: ["불만"], limit: 200, from: "2026-01-01" });
  });

  it("kakao-search 를 부르고 주민번호 모양은 한 번 더 가린다 · 실패는 throw(조용히 빈 결과로 두지 않음)", async () => {
    mocked.mockResolvedValueOnce({
      ok: true, enabled: true, limit: 100, truncated: false,
      rows: [{ id: 1, room: "강남C 점검방", sent_at: "2026-10-23T05:31:00+00:00", seq: 1, author: "이민구", text: "무암 점검 900101-1234567", kind_guess: "chat", is_bot: false }],
    });
    const r = await searchKakao(TAB_SPECS.inspection, "무암");
    expect(mocked).toHaveBeenCalledWith("kakao-search", { q: "무암", kinds: ["점검", "AS"], limit: 100 }, 15_000);
    expect(r.rows[0].text).toBe("무암 점검 900101-1******");

    mocked.mockResolvedValueOnce({ ok: false, error: "검색이 너무 잦습니다" });
    await expect(searchKakao(TAB_SPECS.inspection, "무암")).rejects.toThrow("검색이 너무 잦습니다");

    // 방 없는 탭은 부르지 않는다
    mocked.mockClear();
    expect((await searchKakao(TAB_SPECS.contact, "무암")).rows).toEqual([]);
    expect(mocked).not.toHaveBeenCalled();
  });

  it("시각은 KST, 하이라이트는 낱말마다(대소문자 무시)", () => {
    expect(kakaoTimeLabel("2026-10-23T05:31:00+00:00")).toBe("2026-10-23 14:31");
    expect(kakaoTimeLabel("2026-10-23T14:31:00+09:00")).toBe("2026-10-23 14:31");
    expect(highlightParts("무암 SL-X7400 토너", "무암 x7400")).toEqual([
      { t: "무암", hit: true }, { t: " SL-", hit: false }, { t: "X7400", hit: true }, { t: " 토너", hit: false },
    ]);
    expect(highlightParts("글 (괄호)", "(괄호")).toEqual([{ t: "글 ", hit: false }, { t: "(괄호", hit: true }, { t: ")", hit: false }]);
  });
});
