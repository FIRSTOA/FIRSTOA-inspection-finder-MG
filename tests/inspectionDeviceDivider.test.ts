import { describe, expect, it } from "vitest";
import { closeDeviceBlock, isDividerLine, joinFormSections, rebuildDeviceText } from "../src/inspectionBlocks";

// 2026-10-31 "필드 탭에서 기기 추가 시 언더바(구분선)가 한 줄 더 생김" 재현.
// 모양 기준: 실제 카톡방에 올라간 점검 원문(jeomgeom._원문 45629·45630) — 머리 / ㅡ / 1. … 특이사항 / ㅡ / 2. … / ㅡ / ※부품신청※
const DIV = "ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ";
// App.tsx NEW_DEVICE_LINES·STANDARD_PARTS_SECTION 과 같은 줄
const NEW_DEVICE_LINES = [
  "모델명:", "시리얼넘버:", "자산기번:", "내용:", "처리내용:",
  "매수: 흑-    컬-    큰컬-    합-", "토너잔량:K-   C-   M-   Y-", "폐통:        %",
  "여분:", "한틴이카유무:", "주차비지원유무:", "특이사항:", DIV,
];
const PARTS = [
  DIV, "※부품신청※", "보증기간 내 여부 : ", "교체 전 카운터 누적 사용매수 : ", "사용 부품 예상 사용매수 : ", "▶ 신청 부품",
  "물품명:", "수량:", "출고여부: ", DIV, "※자가신청※", "물품:", "수량:", "출고여부:", DIV,
];
const FOOTER = PARTS.slice(1); // inspectionDeviceParts 는 ※ 줄부터 꼬리로 자른다
const HEADER = ["작성자: 테스트", "구분: 점검", "레벨: 1", "등급:", "업체명:", "부서명:", "지역:", "키맨/접수자:", DIV];
const filled = (n: number, model: string) => [`${n}.`, `모델명: ${model}`, "시리얼넘버: S1", "자산기번: B0001", "내용: 정기점검", "처리내용: 정기점검", "특이사항: 없음"];

/** 빈 줄을 빼고 구분선 두 줄이 붙은 곳의 수 */
const doubled = (text: string) => {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  return lines.filter((line, i) => i > 0 && isDividerLine(line) && isDividerLine(lines[i - 1])).length;
};
/** 기기 사이(구분선 다음 번호 줄 앞) 구분선 수 */
const dividersBeforeNumber = (text: string) => {
  const lines = text.split("\n");
  return lines.filter((line, i) => /^\d+\.$/.test(line) && i > 0 && isDividerLine(lines[i - 1])).length;
};

describe("첫 기기 [＋ 추가] — 새 점검 양식 만들기", () => {
  it("새 기기 끝 구분선 + 부품신청 앞 구분선이 한 줄로 합쳐진다", () => {
    const text = joinFormSections(HEADER, ["1.", ...NEW_DEVICE_LINES], PARTS).join("\n");
    expect(doubled(text)).toBe(0);
    expect(text).toContain(`특이사항:\n${DIV}\n※부품신청※`);
    // 예전 코드([...header, ...device, ...parts])는 여기서 두 줄이 됐다
    expect(doubled([...HEADER, "1.", ...NEW_DEVICE_LINES, ...PARTS].join("\n"))).toBe(1);
  });
  it("조각 안쪽 줄·빈 줄은 건드리지 않는다", () => {
    expect(joinFormSections(["a", ""], [DIV, "b"])).toEqual(["a", "", DIV, "b"]);
    expect(joinFormSections([DIV, ""], [DIV, "b"])).toEqual([DIV, "", "b"]);
    expect(joinFormSections(["a", DIV], ["b", DIV], [])).toEqual(["a", DIV, "b", DIV]);
  });
});

describe("기기 추가·삭제·순서 바꾸기 — rebuildDeviceText", () => {
  it.each([2, 3])("기기 %i대: 기기 사이 구분선은 정확히 한 줄(번호 앞 구분선 = 기기 수)", (n) => {
    // 첫 기기는 실제 양식처럼 부품신청 앞 구분선으로 끝나고, 나머지는 [＋ 추가]로 붙은 새 기기
    const devices = [[...filled(1, "X7500"), DIV], ...Array.from({ length: n - 1 }, (_, i) => [`${i + 2}.`, ...NEW_DEVICE_LINES])];
    const text = rebuildDeviceText(HEADER, devices, FOOTER, DIV);
    expect(doubled(text)).toBe(0);
    expect(dividersBeforeNumber(text)).toBe(n);
    expect(text.split("\n").filter(isDividerLine).length).toBe(1 + n + 2); // 머리 1 + 기기 끝 n + 부품신청 안 2
  });

  it("실제 원문 모양(45629: 기기 3대)을 그대로 다시 만든다", () => {
    const devices = [[...filled(1, "ma2100"), DIV], [...filled(2, "X7400"), DIV], [...filled(3, "K4305"), DIV]];
    const expected = [...HEADER, ...devices.flat(), ...FOOTER].join("\n");
    expect(rebuildDeviceText(HEADER, devices, FOOTER, DIV)).toBe(expected);
  });

  it("이미 겹친 구분선(45612 모양)은 기기를 추가할 때 한 줄로 정리된다", () => {
    const devices = [[...filled(1, "D320"), DIV, DIV], [...filled(2, "D321"), DIV]];
    const text = rebuildDeviceText(HEADER, [...devices, ["3.", ...NEW_DEVICE_LINES]], FOOTER, DIV);
    expect(doubled(text)).toBe(0);
    expect(text).toContain(`특이사항: 없음\n${DIV}\n2.`);
  });

  it("구분선 없이 끝난 블록엔 하나 붙이고, 끝 빈 줄은 뗀다", () => {
    expect(closeDeviceBlock(["1.", "모델명: A"], DIV)).toEqual(["1.", "모델명: A", DIV]);
    expect(closeDeviceBlock(["1.", "모델명: A", DIV, ""], DIV)).toEqual(["1.", "모델명: A", DIV]);
    expect(closeDeviceBlock(["1.", "모델명: A", DIV, "", "─────", ""], DIV)).toEqual(["1.", "모델명: A", DIV]);
  });

  it("블록 안쪽 구분선(메모 블록 앞)은 남긴다", () => {
    const block = [...filled(11, "5473"), DIV, "12.토너 통합보관(캐비넷)", "K3 C3", DIV];
    expect(closeDeviceBlock(block, DIV)).toEqual(block);
  });

  it("번호를 1부터 다시 매긴다", () => {
    const text = rebuildDeviceText(HEADER, [[...filled(3, "B"), DIV], [...filled(1, "A"), DIV]], FOOTER, DIV);
    expect(text).toContain(`${DIV}\n1.\n모델명: B`);
    expect(text).toContain(`${DIV}\n2.\n모델명: A`);
  });
});
