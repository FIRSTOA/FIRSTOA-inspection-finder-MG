import { describe, expect, it } from "vitest";
import { firstDeviceOf, parseSupplyRequests, splitItems } from "../supabase/functions/_shared/supply-requests.ts";
import { rowsFor } from "../src/supplyRequests";

// AS 보고 원문 그대로(2026-10-08, 활동 기록에서)
const AS_TEXT = `작성자:김종희
구분: AS
업체명:이룸안중학원전 이룸청북학원 2호점
지역:D
ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ
1.
모델명: N501
시리얼넘버: 342110460714
자산기번: D0225
내용: 인쇄할 때 상단 부분에 잉크가루가 묻어나오고 글씨가 잘 안보임
처리내용: 1.맥 pc 스캔 재설정 완료
ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ
※부품신청※
보증기간 내 여부 : 무
교체 전 카운터 누적 사용매수 : 305091
사용 부품 예상 사용매수 : 305091
▶ 신청 부품
물품명: 드럼1,현상기1
수량:
출고여부: 선출고완료
ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ
※자가신청※
물품:
수량:
출고여부:
ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ
도착 시간: 17:20
소요 시간: 29분
`;
const BOTH_TEXT = `※부품신청※
보증기간 내 여부 : 무
교체 전 카운터 누적 사용매수 : 328505
사용 부품 예상 사용매수 : 328505
▶ 신청 부품
물품명: 픽업롤러1,롤러2,부싱2,클러치1
수량:
출고여부: 출고부탁드립니다
ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ
※자가신청※
물품: K2
수량:
출고여부: 출고부탁드립니다
ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ
도착 시간: 15:45
`;
const EMPTY_TEXT = `※부품신청※
보증기간 내 여부 :
▶ 신청 부품
물품명:
수량:
출고여부:
ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ
※자가신청※
물품:
수량:
출고여부:
`;

describe("부품·자가 신청 읽기 (2026-10-11)", () => {
  it("부품 칸: 품목마다 한 행, 끝 숫자는 수량, 보증·카운터·출고여부를 같이", () => {
    const rows = parseSupplyRequests(AS_TEXT);
    expect(rows.map((r) => [r.kind, r.item, r.qty])).toEqual([["부품", "드럼", "1"], ["부품", "현상기", "1"]]);
    expect(rows[0]).toMatchObject({ status: "선출고완료", warranty: "무", counter: "305091", expected: "305091" });
    expect(firstDeviceOf(AS_TEXT)).toEqual({ model: "N501", serial: "342110460714", asset: "D0225" });
  });
  it("부품 4종 + 자가(K2 → K 2개)", () => {
    const rows = parseSupplyRequests(BOTH_TEXT);
    expect(rows.filter((r) => r.kind === "부품").map((r) => `${r.item}×${r.qty}`)).toEqual(["픽업롤러×1", "롤러×2", "부싱×2", "클러치×1"]);
    expect(rows.filter((r) => r.kind === "자가")).toHaveLength(1);
    expect(rows.find((r) => r.kind === "자가")).toMatchObject({ item: "K", qty: "2", status: "출고부탁드립니다" });
  });
  it("빈 양식은 아무것도 만들지 않는다", () => {
    expect(parseSupplyRequests(EMPTY_TEXT)).toEqual([]);
    expect(splitItems("없음")).toEqual([]);
    expect(splitItems("토너 K 2개, 폐토너통 1")).toEqual([{ item: "토너 K", qty: "2" }, { item: "폐토너통", qty: "1" }]);
  });
  it("표에 넣을 행: 팀 글자·첫 기기·중복키(전송 때와 채우기 때 같은 키)", () => {
    const a = rowsFor({ sourceTable: "as_records", date: "2026-10-08", author: "김종희", team: "D", vendor: "이룸안중학원전 이룸청북학원 2호점", text: AS_TEXT });
    const b = rowsFor({ sourceTable: "as_records", sourceId: 37100, date: "2026-10-08T00:00:00", author: "김종희", team: "D지역", vendor: "이룸안중학원전 이룸청북학원 2호점", text: AS_TEXT });
    expect(a).toHaveLength(2);
    expect(a[0]).toMatchObject({ kind: "부품", item: "드럼", qty: "1", team: "D", model: "N501", serial: "342110460714", asset: "D0225", source_table: "as_records", source_id: "" });
    expect(b[0].source_id).toBe("37100");
    expect(a.map((r) => r._dupKey)).toEqual(b.map((r) => r._dupKey));
  });
});
