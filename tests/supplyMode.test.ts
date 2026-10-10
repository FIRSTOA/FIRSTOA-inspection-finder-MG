import { describe, expect, it } from "vitest";
import { modeOf } from "../supabase/functions/_shared/supply-requests.ts";
import { rowsFor } from "../src/supplyRequests";

const TEXT = (ship: string) => `※자가신청※
물품: K2
수량:
출고여부: ${ship}
ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ
`;

describe("신청의 성격 — 차량재고 지급 vs 출고 요청 (2026-10-11)", () => {
  it("'차량재고'·'보충'이라고 분명히 적었을 때만 차량재고, '선출고완료'(전날 신청해 다음 날 준 것)·'출고부탁드립니다'·빈값은 출고요청", () => {
    expect(modeOf("차량재고로 지급했습니다")).toBe("차량재고");
    expect(modeOf("보충 요청")).toBe("차량재고");
    expect(modeOf("선출고완료")).toBe("출고요청");
    expect(modeOf("교체완료")).toBe("출고요청");
    expect(modeOf("출고부탁드립니다")).toBe("출고요청");
    expect(modeOf("")).toBe("출고요청");
  });
  it("차량재고 건은 신청 즉시 그 업체에 지급으로, 출고요청 건은 신청 단계로 들어간다", () => {
    const a = rowsFor({ sourceTable: "jeomgeom", date: "2026-10-08", author: "이민구", team: "C", vendor: "석상", text: TEXT("차량재고로 지급") });
    expect(a[0]).toMatchObject({ mode: "차량재고", stage: "지급", used_vendor: "석상", used_by: "이민구" });
    const b = rowsFor({ sourceTable: "jeomgeom", date: "2026-10-08", author: "이민구", team: "C", vendor: "석상", text: TEXT("출고부탁드립니다") });
    expect(b[0]).toMatchObject({ mode: "출고요청", stage: "신청" });
    expect((b[0] as Record<string, unknown>).used_vendor).toBeUndefined();
  });
});
