import { describe, expect, it } from "vitest";
import { normalizeHistory, searchText, searchTokens } from "../src/itStore";
import { dedupeLinks } from "../src/itSheet";
import { splitChips, splitPath, splitSteps } from "../src/itText";

describe("IT DB 저장소 — 순수 도우미", () => {
  it("검색용 글자: 모든 칸을 소문자로, 밑줄 키는 뺀다", () => {
    expect(searchText({ 업체명: "S파마피아", 증상: "부팅 오류 0xC0", _id: 3 })).toBe("s파마피아\n부팅 오류 0xc0");
  });
  it("검색 낱말: 예약문자 제거, 최대 6개", () => {
    expect(searchTokens('모니터 (꺼짐), "간헐"  a,b')).toEqual(["모니터", "꺼짐", "간헐", "a", "b"]);
    expect(searchTokens("1 2 3 4 5 6 7 8")).toHaveLength(6);
  });
  it("AS 등록 폼 → PC DB 머리글 모양(빈 칸은 빼고 제목은 업체명 - 증상)", () => {
    const d = normalizeHistory({ 작성자: "", 구분: "AS", 업체명: "크리액티브", 증상: "부팅 불가", 처리내용: "SSD 교체", 시리얼번호: "SN123", 지역: "B", 도착시간: "10:00" }, "이호준");
    expect(d).toMatchObject({ 등록자: "이호준", 분류: "AS", 업체명: "크리액티브", 자산번호: "SN123", 제목: "크리액티브 - 부팅 불가", 증상: "부팅 불가", 조치: "SSD 교체" });
    expect(d.키워드).toBe("B / 시리얼 SN123 / 도착 10:00");
    expect(d).not.toHaveProperty("제조사");
    expect(d.등록일).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("교육자료: 같은 분류는 최신 갱신 한 줄만", () => {
    const rows = [
      { 분류: "PC하드웨어", 링크: "old", 갱신: "2026-09-04 21:38" },
      { 분류: "PC하드웨어", 링크: "new", 갱신: "2026-09-05 15:48" },
      { 분류: "Windows_OS", 링크: "w", 갱신: "2026-09-05 15:49" },
    ];
    expect(dedupeLinks(rows).map((r) => r.링크)).toEqual(["new", "w"]);
  });
});

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
