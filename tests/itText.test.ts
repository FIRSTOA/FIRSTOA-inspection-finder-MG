import { describe, expect, it } from "vitest";
import { dedupeLinks } from "../src/itSheet";
import { splitChips, splitPath, splitSteps } from "../src/itText";

describe("상세 카드 — 글 쪼개기", () => {
  it("화살표·번호·줄바꿈 목록을 단계로", () => {
    expect(splitSteps("재장착 → 서멀 재도포 → 다른 보드에서 교차 테스트")).toEqual(["재장착", "서멀 재도포", "다른 보드에서 교차 테스트"]);
    expect(splitSteps("1. 전원 분리 2. 메모리 재장착 3. 부팅 확인")).toEqual(["전원 분리", "메모리 재장착", "부팅 확인"]);
    expect(splitSteps("- 먼지 제거\n- 팬 RPM 확인")).toEqual(["먼지 제거", "팬 RPM 확인"]);
    expect(splitSteps("그냥 한 문장입니다.")).toEqual(["그냥 한 문장입니다."]);
    expect(splitSteps("점검 마무리 인사에 이어 붙일 것 / '온 김에'가 부담을 없애준다")).toEqual(["점검 마무리 인사에 이어 붙일 것", "'온 김에'가 부담을 없애준다"]);
    expect(splitSteps("윈도우 8/10 기능 변경")).toEqual(["윈도우 8/10 기능 변경"]);
  });
  it("키워드 칩과 설정 경로 조각", () => {
    expect(splitChips("B / 시리얼 SN1 / 도착 10:00")).toEqual(["B", "시리얼 SN1", "도착 10:00"]);
    expect(splitPath("제어판 > 시스템 > 고급 시스템 설정")).toEqual(["제어판", "시스템", "고급 시스템 설정"]);
  });
});

describe("교육자료 링크", () => {
  it("같은 분류는 최신 갱신 한 줄만(권한 걸린 옛 파일 제외)", () => {
    const rows = [
      { 분류: "PC하드웨어", 링크: "old", 갱신: "2026-09-04 21:38" },
      { 분류: "PC하드웨어", 링크: "new", 갱신: "2026-09-05 15:48" },
      { 분류: "Windows_OS", 링크: "w", 갱신: "2026-09-05 15:49" },
    ];
    expect(dedupeLinks(rows).map((r) => r.링크)).toEqual(["new", "w"]);
  });
});
