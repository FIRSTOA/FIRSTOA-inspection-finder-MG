import { describe, expect, it } from "vitest";
import { isDividerLine, isSpareNoteBlock, isTableReceptionHead, itemStartFlags, noteBlockLineFlags, splitTableReceptionBlocks } from "../src/inspectionBlocks";

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
  // 2026-09-16 휴스틸 — 기기 양식 모양이지만 모델명·시리얼·자산기번이 전부 비고 처리내용에 창고 재고를 적었다
  const HUSTEEL_NOTE = [
    "13.", "14층 창고", "모델명:", "시리얼넘버:", "자산기번:", "내용: 정기점검",
    "처리내용: 450 토너 K 6 C 8 M 10 Y 7 폐 5", "5700 토너 3 드럼 3", "CM305 토너 K 4 C 6 M 5 Y 5",
    "매수: 흑-    컬-    큰컬-    합-", "토너잔량:K-   C-   M-   Y-", "폐통:        %", "여분: K- C- M- Y- 폐-", "한틴이카유무:", "주차비지원유무:", "특이사항:",
  ];
  it("식별칸이 전부 빈 기기 양식에 창고·재고가 적혀 있으면 메모", () => {
    expect(isSpareNoteBlock(HUSTEEL_NOTE)).toBe(true);
    // 창고 낱말이 없어도 처리내용의 재고 줄만으로 메모
    expect(isSpareNoteBlock(HUSTEEL_NOTE.map((l) => (l === "14층 창고" ? "14층" : l)))).toBe(true);
  });
  it("식별칸이 하나라도 차 있으면 기기 — 처리내용에 토너 수량이 있어도", () => {
    expect(isSpareNoteBlock(HUSTEEL_NOTE.map((l) => (l === "모델명:" ? "모델명: 5700" : l)))).toBe(false);
    expect(isSpareNoteBlock(HUSTEEL_NOTE.map((l) => (l === "자산기번:" ? "자산기번: C0603" : l)))).toBe(false);
  });
  it("식별칸이 비어도 토너잔량·여분·폐통 칸에 숫자가 있는 건 기기 — 모델명 안 적은 새 기기가 메모로 밀리면 안 된다(2026-09-24 케이티투)", () => {
    expect(isSpareNoteBlock(["2.", "케이티투 3층", "모델명:", "시리얼넘버:", "자산기번:", "내용: 테스트", "처리내용: 정기점검", "매수: 흑123 컬124 큰컬- 합1245", "토너잔량:K33 C33 M33 Y33", "폐통: 50%", "여분: K1 C1 M1 Y1 폐1", "한틴이카유무: 한조", "주차비지원유무: 유", "특이사항:"])).toBe(false);
  });
  it("식별칸이 비어도 재고·보관 낱말이 없는 빈 기기 양식은 기기로 남는다(아직 안 채운 새 기기)", () => {
    expect(isSpareNoteBlock(["13.", "14층 신규", "모델명:", "시리얼넘버:", "자산기번:", "내용: 정기점검", "처리내용: 정기점검", "매수: 흑- 컬- 큰컬- 합-", "토너잔량:K- C- M- Y-", "여분: K- C- M- Y- 폐-"])).toBe(false);
  });
});

describe("noteBlockLineFlags", () => {
  it("메모 블록의 줄만 표시 — 폼 파싱·병합이 앞 기기 칸을 덮어쓰지 않게", () => {
    const lines = [DIV, ...device(1, "5700"), DIV, "13.", "14층 창고", "모델명:", "처리내용: 450 토너 K 6 C 8", DIV, "※부품신청※", "물품명:"];
    const flags = noteBlockLineFlags(lines);
    expect(flags[lines.indexOf("13.")]).toBe(true);
    expect(flags[lines.indexOf("14층 창고")]).toBe(true);
    expect(flags[lines.indexOf("처리내용: 450 토너 K 6 C 8")]).toBe(true);
    expect(flags[lines.indexOf("1.")]).toBe(false);
    expect(flags[lines.indexOf("모델명: 5700")]).toBe(false);
    expect(flags[lines.indexOf("※부품신청※")]).toBe(false);
    expect(itemStartFlags(lines).filter(Boolean)).toHaveLength(1);
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

describe("splitTableReceptionBlocks — 접수 표 원문은 접수 머리줄에서만 나눈다 (2026-09-17 그루젠)", () => {
  const gruzen = [
    "A/S\tS\tSL-X7400LXR\t20S(주)그루젠남영빌딩2층 > 과천SL-NWE001X 기능 추가매월마감\t매월마감\t종료일\t29. 4. 20",
    "기번\tZPBLBJSTA00107H",
    "상태\t프린트시 간헐적으로 줄 발생",
    "AS접수이력(시리얼기준)",
    "■ 내용: 1. 프린트시 줄발생",
    "2. 용지걸림",
    "",
    "■ 일시: 26년 1월 30일",
    "■ 내용: 묻어나옴",
  ].join("\n");
  it("빈 줄·번호 줄이 있어도 접수 한 건은 한 블록", () => {
    const blocks = splitTableReceptionBlocks(gruzen);
    expect(blocks).toHaveLength(1);
    expect(blocks[0][0]).toMatch(/^A\/S\t/);
    expect(blocks[0]).not.toContain("");
    expect(blocks[0]).toContain("2. 용지걸림");
  });
  it("접수 여러 건을 이어 붙이면 머리줄(A/S·IT A/S·여분요청 + 탭)마다 나눈다", () => {
    const two = `${gruzen}\nIT A/S\tN\tHP-M428\t3N주식회사 무암\n기번\tX1\n여분요청\tS\tD450\t7S웰스\n기번\tY2`;
    const blocks = splitTableReceptionBlocks(two);
    expect(blocks.map((b) => b[0].split("\t")[0])).toEqual(["A/S", "IT A/S", "여분요청"]);
    expect(blocks[1]).toEqual(["IT A/S\tN\tHP-M428\t3N주식회사 무암", "기번\tX1"]);
  });
  it("머리줄 판정 — 접수분야 토큰 + 탭만 (표 안의 '접수분야⇥A/S'·번호 줄은 아님)", () => {
    expect(isTableReceptionHead("A/S\tS\tSL-X7400LXR")).toBe(true);
    expect(isTableReceptionHead("IT A/S\tN\tHP")).toBe(true);
    expect(isTableReceptionHead("접수분야\tA/S")).toBe(false);
    expect(isTableReceptionHead("2. 용지걸림")).toBe(false);
    expect(isTableReceptionHead("■ 내용: A/S 요청")).toBe(false);
  });
});
