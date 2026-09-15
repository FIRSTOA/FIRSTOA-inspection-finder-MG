import { describe, expect, it } from "vitest";
import { formRegionForSend } from "../src/api";

// 2026-09-15 보림토건(주)신반포 — 여분 티켓을 FIELD로 불러 보내면 양식에 지역:C가 있어도 "지역 비어 있음"으로 막혔다
const form = (gubun: string, region = "C") => [
  "작성자:이홍진", `구분: ${gubun}`, "레벨:1", "등급:V",
  "업체명:보림토건(주)신반포 22차 현장(사무실)", "부서명:301호", `지역:${region}`, "키맨/접수자:. 010-4840-7121",
  "ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ", "1.", "모델명: ES5473", "시리얼넘버: BW11005326", "자산기번: B7452",
  "내용: 토너 여분요청", "처리내용:", "매수:흑- 컬- 큰컬- 합-", "토너잔량:K- C- M- Y-", "폐통:  %", "여분:  K- C- M- Y- 폐-",
  "한틴이카유무:", "주차비지원유무:", "특이사항:",
].join("\n");

describe("formRegionForSend", () => {
  it("구분이 여분·마감·세팅(점검/AS 글자 없음)이어도 누른 방 기준으로 지역을 읽는다", () => {
    expect(formRegionForSend(form("여분"), "as", "2026-09-15", "이홍진")).toBe("C");
    expect(formRegionForSend(form("마감"), "inspection", "2026-09-15", "이홍진")).toBe("C");
    expect(formRegionForSend(form("세팅"), "as", "2026-09-15", "이홍진")).toBe("C");
  });
  it("점검·AS 양식은 예전과 같다", () => {
    expect(formRegionForSend(form("점검"), "inspection", "2026-09-15", "이홍진")).toBe("C");
    expect(formRegionForSend(form("AS"), "as", "2026-09-15", "이홍진")).toBe("C");
  });
  it("방을 아직 안 골랐어도 '지역:' 줄은 읽는다", () => {
    expect(formRegionForSend(form("여분"), undefined, "2026-09-15", "이홍진")).toBe("C");
  });
  it("지역 줄이 진짜 비어 있으면 빈칸 — 전송은 여전히 막혀야 한다", () => {
    expect(formRegionForSend(form("여분", ""), "as", "2026-09-15", "이홍진")).toBe("");
    expect(formRegionForSend(form("점검", ""), "inspection", "2026-09-15", "이홍진")).toBe("");
  });
});
