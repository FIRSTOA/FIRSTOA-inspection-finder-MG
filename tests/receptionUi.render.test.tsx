// 서비스접수 개편 표시 컴포넌트 4개가 서버 렌더로 깨지지 않고 나오는지 확인하는 최소 회귀 테스트
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import ReceptionTypePicker, { RECEPTION_TYPES, type ReceptionType } from "../src/ReceptionTypePicker";
import ReceptionBoard, { daysBetween, type ReceptionRow } from "../src/ReceptionBoard";
import HomeReceptionCard from "../src/HomeReceptionCard";
import ReceptionListFilters from "../src/ReceptionListFilters";
import DeptReceptionFormView from "../src/DeptReceptionForm.view";

const noop = () => {};
const counts = Object.fromEntries(RECEPTION_TYPES.map((m, i) => [m.type, i])) as Record<ReceptionType, number>;
const rows: ReceptionRow[] = [
  { id: "a", type: "영업팀", vendor: "가나상사", field: "해지문의", author: "김수인", handler: "", status: "접수", receipt_date: "2026-10-05", scheduled_date: "2026-10-10" },
  { id: "b", type: "IT", vendor: "다라전자", field: "", author: "박민", handler: "이찬우", status: "보류", receipt_date: "2026-10-18" },
];

describe("접수 개편 표시 컴포넌트 렌더", () => {
  it("선택기: 지원 줄은 deptEnabled 일 때만 나온다", () => {
    const on = renderToString(createElement(ReceptionTypePicker, { value: "IT", onChange: noop, counts, deptEnabled: true }));
    const off = renderToString(createElement(ReceptionTypePicker, { value: "IT", onChange: noop, counts, deptEnabled: false }));
    expect(on).toContain("전략영업");
    expect(off).not.toContain("전략영업");
    expect(off).toContain("CS 접수"); // 2026-10-25 표시 이름만 CS 접수(값은 복합기 AS 그대로)
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

  it("현황판: 시트에 짝 없는 접수 카드에만 \"시트에 없음\" 칩", () => {
    const mk = (compact: boolean, sheetMissing: boolean) => renderToString(createElement(ReceptionBoard, { rows: [{ ...rows[0], sheetMissing }], today: "2026-10-19", onSelectType: noop, renderActions: () => null, compact }));
    for (const compact of [true, false]) {
      expect(mk(compact, true)).toContain("시트에 없음");
      expect(mk(compact, false)).not.toContain("시트에 없음");
    }
  });

  it("홈 카드: 합계와 가장 오래된 건", () => {
    const html = renderToString(createElement(HomeReceptionCard, { counts, oldest: { vendor: "가나상사", type: "영업팀", days: 14 }, onClick: noop }));
    expect(html).toContain("미처리 접수 15건");
    expect(html).toContain("가나상사");
  });

  it("현황판: selectedType 이면 그 열만, deptEnabled=false 면 지원 3종 숨김", () => {
    const sel = renderToString(createElement(ReceptionBoard, { rows, today: "2026-10-19", onSelectType: noop, renderActions: () => null, selectedType: "영업팀" }));
    expect(sel).toMatch(/예정일 지남 (<!-- -->)?1/);
    expect(sel).not.toContain("다라전자");
    const off = renderToString(createElement(ReceptionBoard, { rows, today: "2026-10-19", onSelectType: noop, renderActions: () => null, deptEnabled: false }));
    expect(off).not.toContain("전략영업");
    expect(off).toContain("다라전자");
  });

  it("현황판: 종류를 골라도 숫자 띠 타일 7개(물류 포함)는 유지된다", () => {
    const scheduleRows = [{ id: "s1", vendor: "마바물류", scheduleType: "납품철수교체휴가교육", team: "A팀", assignee: "최기사", date: "2026-10-12", status: "미완료" }];
    const html = renderToString(createElement(ReceptionBoard, { rows, today: "2026-10-19", onSelectType: noop, renderActions: () => null, scheduleRows, selectedType: "IT" }));
    expect((html.match(/aria-pressed/g) ?? []).length).toBe(7);
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
    expect(html).toContain("물류 미처리");
    expect(html).not.toContain("마바물류");
  });

  it("홈 카드: over7 이 1 이상일 때만 7일↑ 가 보인다", () => {
    const base = { counts, oldest: null, onClick: noop };
    expect(renderToString(createElement(HomeReceptionCard, { ...base, over7: 3 }))).toContain("7일↑");
    expect(renderToString(createElement(HomeReceptionCard, { ...base, over7: 0 }))).not.toContain("7일↑");
  });

  it("현황판 compact: 접기 열·빈 열·예정일 지남 유지", () => {
    const html = renderToString(createElement(ReceptionBoard, { rows, today: "2026-10-19", onSelectType: noop, renderActions: () => null, compact: true }));
    expect(html).toContain("가나상사");
    expect(html).toContain("없음 ✓");
    expect(html).toContain("aria-expanded");
    expect(html).toMatch(/예정일 지남 (<!-- -->)?1/);
  });

  it("현황판 scheduleRows: 일정 미처리 열·단추, 종류 선택 시 숨김", () => {
    const scheduleRows = [{ id: "s1", vendor: "마바물류", scheduleType: "납품철수교체휴가교육", team: "A팀", assignee: "최기사", date: "2026-10-12", status: "미완료" }];
    const base = { rows, today: "2026-10-19", onSelectType: noop, renderActions: () => null, scheduleRows, onOpenSchedule: noop };
    const html = renderToString(createElement(ReceptionBoard, base));
    expect(html).toContain("물류 미처리");
    expect(html).not.toContain("일정 미처리");
    expect(html).toContain("마바물류");
    expect(html).toContain("납품");
    expect(html).toContain("네이버 캘린더에서 완료 처리하면 다음 동기화(1분) 뒤 사라집니다");
    expect(html).not.toContain("일정리스트에서 처리");
    expect(html).not.toContain('role="button"');
    expect(renderToString(createElement(ReceptionBoard, { ...base, selectedType: "IT" }))).not.toContain("마바물류");
    expect(renderToString(createElement(ReceptionBoard, { ...base, compact: true }))).toContain("마바물류");
  });

  it("홈 카드: scheduleOverdue 가 있으면 일정 미처리 줄이 나온다", () => {
    const base = { counts, oldest: null, onClick: noop };
    expect(renderToString(createElement(HomeReceptionCard, { ...base, scheduleOverdue: 4 }))).toContain("물류 미처리");
    expect(renderToString(createElement(HomeReceptionCard, base))).not.toContain("물류 미처리");
  });

  it("접수리스트 필터: 영업 칸·deptEnabled=false 숨김·숫자·주소 강조", () => {
    const base = { typeFilter: "전체", onTypeFilter: noop, typeCounts: { 전체: 26, "복합기 AS": 26, 영업팀: 3, 주소확인: 5 }, statusFilter: "전체" as const, onStatusFilter: noop, statusCounts: { 전체: 26, 접수: 4, 진행중: 2, 완료: 20 } };
    const on = renderToString(createElement(ReceptionListFilters, base));
    const off = renderToString(createElement(ReceptionListFilters, { ...base, deptEnabled: false }));
    expect(on).toContain("영업");
    expect(on).toContain("진행중");
    expect(on).toContain("📍주소");
    expect(on).toContain("bg-amber-50");
    expect(off).not.toContain("영업");
    expect(off).not.toContain("경영");
    expect(off).toContain("CS 접수"); // 2026-10-25 밤 "복합기" 칩 → "CS 접수"(표시만)
  });

  it("부서 폼 틀: 경영지원만 계약서구분이 보인다", () => {
    const base = {
      dept: "경영지원" as const, mode: "device" as const, onModeChange: noop, query: "", onQueryChange: noop, onSearch: noop, candidates: null, preview: null,
      routeOptions: ["카카오", "전화"], route: "전화", onRoute: noop, fieldOptions: ["청구관련"], field: "청구관련", onField: noop, fieldCustom: "", onFieldCustom: noop,
      receiverName: "", onReceiverName: noop, receiverPhone: "", onReceiverPhone: noop, symptom: "", onSymptom: noop, notes: "", onNotes: noop,
      handlerSlot: null, outside: false, onOutside: noop, scheduledDate: "", onScheduledDate: noop, required: [["업체", false], ["접수내용", true]] as Array<[string, boolean]>, onSave: noop,
    };
    const mgmt = renderToString(createElement(DeptReceptionFormView, { ...base, contractKind: "", onContractKind: noop }));
    const sales = renderToString(createElement(DeptReceptionFormView, { ...base, dept: "영업팀" }));
    expect(mgmt).toContain("계약서구분");
    expect(sales).not.toContain("계약서구분");
    expect(mgmt).not.toContain("업체로 접수");
    expect(mgmt).toContain("임대리스트 검색 — 업체명·부서명·자산·시리얼·순번"); // C4: 부서명 검색 추가
    expect(mgmt).toContain("순번 하나로 업체 정보가 자동 채워집니다");
    expect(mgmt).not.toContain("시트에 자동 기입됩니다");
    const picked = renderToString(createElement(DeptReceptionFormView, { ...base, custKind: "기존" as const, onCustKind: noop, onClearVendor: noop,
      selectedSummary: { name: "가나다상사", fields: [["순", "12", "num"], ["모델", "X1"]] as Array<[string, string, ("num" | "mono" | "")?]> } }));
    expect(picked).toContain("시트에 자동 기입됩니다");
    expect(picked).toContain("다시 검색");
    expect(picked).toContain("가나다상사");
    const fresh = renderToString(createElement(DeptReceptionFormView, { ...base, custKind: "신규" as const, onCustKind: noop, onNewRegion: noop, newVendorName: "" }));
    expect(fresh).toContain("신규 거래처 업체명");
    expect(fresh).toContain("지역(팀)");
  });
});
