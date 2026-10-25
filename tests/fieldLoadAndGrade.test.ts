/**
 * 2026-10-25 점검·AS 탭 검색 [불러오기] + 양식 윗줄 [등급] 드롭다운 — 순수 로직만.
 */
import { describe, expect, it } from "vitest";
import { canLoadLine, loadableFormText, loadedToast } from "../src/tabSearch";
import { detectUnifiedInputMode } from "../src/fieldModes";
import { GRADE_CUSTOM, applyGradeEverywhere, gradeChoice, gradeFromSelect, gradeOfOutput, readGradeLine, replaceGradeLine } from "../src/field/gradeField";

const INSP = "작성자: 홍길동\n구분: 점검\n레벨: 1\n등급: S\n업체명: 업체A\n지역: C\nㅡㅡㅡ\n1.\n모델명: C3060\n매수: 흑 100";
const AS = "AS 접수\n작성자:이민구\n구분: AS\n레벨:3\n등급:SS\n업체명:법무법인 유스트\n지역:C";

describe("탭 검색 → 양식 불러오기", () => {
  it("점검·AS 탭의 점검(jeomgeom)·AS(as_records) 기록만 원문을 넘긴다(가림·자르기 없이 전체)", () => {
    const long = `${INSP}\n${"특이사항: 길다 ".repeat(400)}`;
    expect(loadableFormText("inspection", "jeomgeom", { _원문: long })).toBe(long.trim());
    expect(loadableFormText("inspection", "as_records", { _원문: AS })).toBe(AS);
  });
  it("다른 탭·다른 표·원문 없는 줄은 단추 없음", () => {
    expect(loadableFormText("air", "jeomgeom", { _원문: INSP })).toBe("");
    expect(loadableFormText("logistics", "as_records", { _원문: AS })).toBe("");
    expect(loadableFormText("bulman", "jeomgeom", { _원문: INSP })).toBe("");
    expect(loadableFormText("inspection", "visit_logs", { _원문: INSP })).toBe("");
    expect(loadableFormText("inspection", "jeomgeom", { _원문: "  " })).toBe("");
    expect(canLoadLine({ formText: INSP }, undefined)).toBe(false);
    expect(canLoadLine({ formText: "" }, () => {})).toBe(false);
    expect(canLoadLine({ formText: INSP }, () => {})).toBe(true);
  });
  it("불러온 원문으로 양식 종류가 정해진다(기존 거래처검색 불러오기와 같은 판별): 점검 → 점검, AS → AS 양식", () => {
    expect(detectUnifiedInputMode(INSP)).toBe("inspection");
    expect(detectUnifiedInputMode(AS)).toBe("blank-report");
  });
  it("토스트 문구", () => {
    expect(loadedToast({ vendor: "업체A", date: "2026-10-20", kind: "AS" })).toBe("업체A 2026-10-20 AS 기록을 불러왔습니다");
    expect(loadedToast({ vendor: "업체A", date: "", kind: "점검" })).toBe("업체A 점검 기록을 불러왔습니다");
  });
});

describe("등급 드롭다운", () => {
  it("등급 줄 읽기·바꾸기 — 같은 줄만(빈 등급이 다음 줄을 먹지 않음), 띄어쓰기 모양 유지", () => {
    expect(readGradeLine(INSP)).toBe("S");
    expect(readGradeLine("등급:\n업체명: 업체A")).toBe("");
    expect(replaceGradeLine("등급:\n업체명: 업체A", "NN")).toBe("등급:NN\n업체명: 업체A");
    expect(replaceGradeLine(INSP, "유지보수")).toContain("\n등급: 유지보수\n업체명: 업체A");
    expect(replaceGradeLine(AS, "V")).toContain("\n등급:V\n");
    expect(replaceGradeLine("업체명: A", "S")).toBe("업체명: A");
    expect(gradeOfOutput("", [{ content: AS }])).toBe("SS");
    expect(gradeOfOutput("업체명: A", [])).toBeNull();
  });
  it("옵션 ↔ 직접 입력 왕복", () => {
    expect(gradeChoice("SS")).toEqual({ select: "SS", custom: false, text: "" });
    expect(gradeChoice("nn")).toEqual({ select: "NN", custom: false, text: "" });
    expect(gradeChoice("유지보수")).toEqual({ select: "유지보수", custom: true, text: "유지보수" });
    expect(gradeChoice("")).toEqual({ select: "", custom: false, text: "" });
    expect(gradeFromSelect(GRADE_CUSTOM)).toBeNull();
    expect(gradeFromSelect("V")).toBe("V");
    // 직접 입력한 값을 글에 쓰고 다시 읽으면 직접 입력 모드로 돌아온다
    const written = replaceGradeLine(INSP, "유지보수");
    expect(gradeChoice(readGradeLine(written)).custom).toBe(true);
    expect(gradeChoice(readGradeLine(replaceGradeLine(written, "S"))).custom).toBe(false);
  });
  it("결과 글·목록·손수정 블록의 등급 줄을 같이 바꾸고, 다른 손수정은 지우지 않는다", () => {
    let text = INSP;
    let list = [{ content: AS, extra: 1 }, { content: "업체명: X" }];
    let blocks: Record<number, string> = { 0: "구분: 점검\n등급: N", 2: "처리내용: 손으로 고침" };
    applyGradeEverywhere("V", (f) => { text = f(text); }, (f) => { list = f(list) as typeof list; }, (f) => { blocks = f(blocks); });
    expect(readGradeLine(text)).toBe("V");
    expect(readGradeLine(list[0].content)).toBe("V");
    expect(list[1].content).toBe("업체명: X");
    expect(blocks[0]).toBe("구분: 점검\n등급: V");
    expect(blocks[2]).toBe("처리내용: 손으로 고침");
  });
});
