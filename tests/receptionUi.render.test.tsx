// 서비스접수 개편 표시 컴포넌트 4개가 서버 렌더로 깨지지 않고 나오는지 확인하는 최소 회귀 테스트
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import ReceptionTypePicker, { RECEPTION_TYPES, type ReceptionType } from "../src/ReceptionTypePicker";
import ReceptionBoard, { daysBetween, type ReceptionRow } from "../src/ReceptionBoard";
import HomeReceptionCard from "../src/HomeReceptionCard";
import DeptReceptionFormView from "../src/DeptReceptionForm.view";

const noop = () => {};
const counts = Object.fromEntries(RECEPTION_TYPES.map((m, i) => [m.type, i])) as Record<ReceptionType, number>;
const rows: ReceptionRow[] = [
  { id: "a", type: "영업지원", vendor: "가나상사", field: "해지문의", author: "김수인", handler: "", status: "접수", receipt_date: "2026-10-05", scheduled_date: "2026-10-10" },
  { id: "b", type: "IT", vendor: "다라전자", field: "", author: "박민", handler: "이찬우", status: "보류", receipt_date: "2026-10-18" },
];

describe("접수 개편 표시 컴포넌트 렌더", () => {
  it("선택기: 지원 줄은 deptEnabled 일 때만 나온다", () => {
    const on = renderToString(createElement(ReceptionTypePicker, { value: "IT", onChange: noop, counts, deptEnabled: true }));
    const off = renderToString(createElement(ReceptionTypePicker, { value: "IT", onChange: noop, counts, deptEnabled: false }));
    expect(on).toContain("영업지원");
    expect(off).not.toContain("영업지원");
    expect(off).toContain("복합기 AS");
  });

  it("현황판: 경과일·빈 열·상태 3종", () => {
    expect(daysBetween("2026-10-05", "2026-10-19")).toBe(14);
    const html = renderToString(createElement(ReceptionBoard, { rows, today: "2026-10-19", onSelectType: noop, renderActions: () => "단추" }));
    expect(html).toContain("가나상사");
    expect(html).toContain("14일");
    expect(html).toContain("없음 ✓");
    expect(renderToString(createElement(ReceptionBoard, { rows: [], today: "2026-10-19", onSelectType: noop, renderActions: () => null }))).toContain("미처리 접수가 없습니다");
    expect(renderToString(createElement(ReceptionBoard, { rows, today: "2026-10-19", onSelectType: noop, renderActions: () => null, loading: true }))).toContain("새로고침 중");
    expect(renderToString(createElement(ReceptionBoard, { rows: [], today: "2026-10-19", onSelectType: noop, renderActions: () => null, loading: true }))).toContain("불러오는 중");
    expect(renderToString(createElement(ReceptionBoard, { rows, today: "2026-10-19", onSelectType: noop, renderActions: () => null, error: "x" }))).toContain("이전 데이터 표시");
    expect(renderToString(createElement(ReceptionBoard, { rows: [], today: "2026-10-19", onSelectType: noop, renderActions: () => null, error: "x" }))).toContain("불러오지 못했습니다");
  });

  it("홈 카드: 합계와 가장 오래된 건", () => {
    const html = renderToString(createElement(HomeReceptionCard, { counts, oldest: { vendor: "가나상사", type: "영업지원", days: 14 }, onClick: noop }));
    expect(html).toContain("미처리 접수 15건");
    expect(html).toContain("가나상사");
  });

  it("현황판: selectedType 이면 그 열만, deptEnabled=false 면 지원 3종 숨김", () => {
    const sel = renderToString(createElement(ReceptionBoard, { rows, today: "2026-10-19", onSelectType: noop, renderActions: () => null, selectedType: "영업지원" }));
    expect(sel).toMatch(/예정일 지남 (<!-- -->)?1/);
    expect(sel).not.toContain("다라전자");
    const off = renderToString(createElement(ReceptionBoard, { rows, today: "2026-10-19", onSelectType: noop, renderActions: () => null, deptEnabled: false }));
    expect(off).not.toContain("영업지원");
    expect(off).toContain("다라전자");
  });

  it("홈 카드: over7 이 1 이상일 때만 7일↑ 가 보인다", () => {
    const base = { counts, oldest: null, onClick: noop };
    expect(renderToString(createElement(HomeReceptionCard, { ...base, over7: 3 }))).toContain("7일↑");
    expect(renderToString(createElement(HomeReceptionCard, { ...base, over7: 0 }))).not.toContain("7일↑");
  });

  it("부서 폼 틀: 경영지원만 계약서구분이 보인다", () => {
    const base = {
      dept: "경영지원" as const, mode: "device" as const, onModeChange: noop, query: "", onQueryChange: noop, onSearch: noop, candidates: null, preview: null,
      routeOptions: ["카카오", "전화"], route: "전화", onRoute: noop, fieldOptions: ["청구관련"], field: "청구관련", onField: noop, fieldCustom: "", onFieldCustom: noop,
      receiverName: "", onReceiverName: noop, receiverPhone: "", onReceiverPhone: noop, symptom: "", onSymptom: noop, notes: "", onNotes: noop,
      handlerSlot: null, outside: false, onOutside: noop, scheduledDate: "", onScheduledDate: noop, required: [["업체", false], ["접수내용", true]] as Array<[string, boolean]>, onSave: noop,
    };
    const mgmt = renderToString(createElement(DeptReceptionFormView, { ...base, contractKind: "", onContractKind: noop }));
    const sales = renderToString(createElement(DeptReceptionFormView, { ...base, dept: "영업지원" }));
    expect(mgmt).toContain("계약서구분");
    expect(sales).not.toContain("계약서구분");
    expect(mgmt).toContain("기기로 접수");
    expect(mgmt).toContain("시트에 자동으로 기입됩니다");
  });
});
