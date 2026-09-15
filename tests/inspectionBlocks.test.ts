import { describe, expect, it } from "vitest";
import { isDividerLine, isSpareNoteBlock, itemStartFlags } from "../src/inspectionBlocks";

const DIV = "ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ";
const device = (n: number, model: string) => [
  `${n}.`, `모델명: ${model}`, "시리얼넘버: ABC123", "자산기번: C0001", "내용: 정기점검", "처리내용: 정기점검",
  "매수:흑- 컬- 큰컬- 합-", "토너잔량:K- C- M- Y-", "폐통:  %", "여분: K1 C1 M1 Y1", "한틴이카유무:", "주차비지원유무:", "특이사항:",
];
// 2026-09-16 아시아프라퍼티 — 기기 1~11 뒤에 "12." 여분 통합보관 메모가 이어진다
const NOTE = [
  "12.토너 통합보관(C0003좌측캐비넷,C0004좌측캐비넷 끝)",
  "", "5473", "K3 C3 M3 Y1", "", "5700", "토너2 드럼2", "", "450", "K3 C3 M4 Y1 폐2", "", "5521", "K4 C6 M5 Y7",
];
const TEXT = ["작성자: 이민구", "구분: 점검", "업체명: 아시아프라퍼티", "지역: C", DIV, ...device(1, "5473"), DIV, ...device(2, "5700"), DIV, ...NOTE, DIV, "※부품신청※", "물품명:"].join("\n");

describe("isSpareNoteBlock", () => {
  it("기기 칸이 없고 보관·여분 낱말이 있는 번호 블록은 메모", () => {
    expect(isSpareNoteBlock(NOTE)).toBe(true);
    expect(isSpareNoteBlock(["3. 여분 보관 위치", "3층 창고"])).toBe(true);
  });
  it("모델명 등 기기 칸이 하나라도 있으면 기기 — 특이사항에 '보관'이 있어도", () => {
    expect(isSpareNoteBlock(device(1, "5473"))).toBe(false);
    expect(isSpareNoteBlock(["4.", "모델명: D450", "특이사항: 여분은 창고 보관"])).toBe(false);
  });
  it("보관·여분 같은 낱말이 없는 번호 블록(위치만 적힌 새 기기)은 기기로 남는다", () => {
    expect(isSpareNoteBlock(["3.", "5층 복사기"])).toBe(false);
    expect(isSpareNoteBlock([])).toBe(false);
  });
});

describe("itemStartFlags", () => {
  it("메모 블록은 기기로 세지 않는다 — 12번이 있어도 기기는 2대", () => {
    const flags = itemStartFlags(TEXT.split("\n"));
    expect(flags.filter(Boolean)).toHaveLength(2);
    const lines = TEXT.split("\n");
    expect(flags[lines.indexOf("1.")]).toBe(true);
    expect(flags[lines.indexOf("2.")]).toBe(true);
    expect(flags[lines.indexOf(NOTE[0])]).toBe(false);
  });
  it("구분선 바로 다음 번호 줄만 기기 시작 — 처리내용 안의 '2.토너교체'는 아니다", () => {
    const lines = [DIV, "1.", "모델명: D450", "처리내용: 1.청소", "2.토너교체", DIV, "2.", "모델명: D320"];
    const flags = itemStartFlags(lines);
    expect(flags[1]).toBe(true);
    expect(flags[4]).toBe(false);
    expect(flags[6]).toBe(true);
  });
});

describe("isDividerLine", () => {
  it("ㅡ·-·─ 계열 3자 이상만 구분선", () => {
    expect(isDividerLine(DIV)).toBe(true);
    expect(isDividerLine("---")).toBe(true);
    expect(isDividerLine("──")).toBe(false);
    expect(isDividerLine("12.토너 통합보관")).toBe(false);
  });
});
