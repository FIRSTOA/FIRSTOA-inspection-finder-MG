/**
 * 날짜 시트·일정 확인 시트 서버 렌더(testing-library 없음 — renderToString) + CategoryForm 날짜 칸 렌더.
 * 지키는 것: 칩 6개에 날짜 표시 · [미정·글로 쓰기] 비상구 · 확인 시트 3단계 문구 · 재계약 칸은 "날짜 고르기" 버튼, 불만 칸은 글자 input.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import DatePickSheet from "../src/DatePickSheet";
import RecontractScheduleSheetView, { type RecontractScheduleSheetViewProps } from "../src/RecontractScheduleSheet.view";
import CategoryForm from "../src/CategoryForm";
import { emptyCatForm } from "../src/categoryForms";

const noop = () => undefined;

describe("DatePickSheet", () => {
  const html = renderToString(createElement(DatePickSheet, { title: "다음 확인일", value: "2026-10-29", today: "2026-10-22", onPick: noop, onClose: noop, onText: noop }));
  it("칩 6개 + 날짜 표시(익일 10/23(금), +1주 10/29(목))", () => {
    for (const label of ["익일", "+3일", "+1주", "+2주", "+1달", "+3달"]) expect(html).toContain(label);
    expect(html).toContain("10/23(금)");
    expect(html).toContain("10/29(목)");
  });
  it("날짜 칸은 오늘 이전 막음, 비상구 단추 있음", () => {
    expect(html).toContain('min="2026-10-22"');
    expect(html).toContain("미정·글로 쓰기");
    expect(html).not.toMatch(/<button(?![^>]*type="button")/);
  });
  it("onText 가 없으면 비상구 단추도 없음", () => {
    const h = renderToString(createElement(DatePickSheet, { value: "", today: "2026-10-22", onPick: noop, onClose: noop }));
    expect(h).not.toContain("미정·글로 쓰기");
  });
});

describe("RecontractScheduleSheetView", () => {
  const base: RecontractScheduleSheetViewProps = {
    phase: "form", vendor: "보림토건", today: "2026-10-22", date: "2026-10-29", team: "C", title: "[재계약 확인] 보림토건",
    address: "", note: "요약", naverLine: "일정리스트·캘린더·네이버 캘린더에 함께 만들어집니다", error: "", busy: false,
    duplicates: [{ id: "wk-1", vendor: "보림토건", date: "2026-10-25", issue: "재계약 방문 (워킨맵에서 등록)" }],
    onDate: noop, onTeam: noop, onTitle: noop, onAddress: noop, onNote: noop, onCreate: noop, onSkip: noop,
    onMove: noop, onCreateAnyway: noop, onBackToForm: noop, onRetryNaver: noop, onFinish: noop,
  };
  it("입력 단계: 질문·안내 줄·[일정 만들기]/[안 만들기]·팀 칩(E=CSS)", () => {
    const h = renderToString(createElement(RecontractScheduleSheetView, base));
    expect(h).toContain("다음 확인일로 일정 만들까요?");
    expect(h).toContain("네이버 캘린더에 함께");
    expect(h).toContain("일정 만들기");
    expect(h).toContain("안 만들기");
    expect(h).toContain("CSS");
  });
  it("중복 단계: [옮기기]가 첫 단추, 새로 하나 더·취소", () => {
    const h = renderToString(createElement(RecontractScheduleSheetView, { ...base, phase: "dup" }));
    const move = h.indexOf("그 일정을 10/29(목)로 옮기기");
    expect(move).toBeGreaterThan(0);
    expect(h.indexOf("새로 하나 더")).toBeGreaterThan(move);
    expect(h).toContain("취소");
  });
  it("네이버 실패 단계: 다시 시도", () => {
    const h = renderToString(createElement(RecontractScheduleSheetView, { ...base, phase: "naverFailed", naverError: "쓰기 상한" }));
    expect(h).toContain("네이버 다시 시도");
    expect(h).toContain("쓰기 상한");
  });
  it("검사 오류가 있으면 만들기 단추가 막힘", () => {
    const h = renderToString(createElement(RecontractScheduleSheetView, { ...base, error: "팀(A~E)을 골라 주세요" }));
    expect(h).toContain("팀(A~E)을 골라 주세요");
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>일정 만들기/);
  });
});

describe("CategoryForm 날짜 칸", () => {
  const props = (schemaKey: string, form: Record<string, string>) => ({
    schemaKey, form, setForm: noop, author: "이민구", setAuthor: noop, onLoad: () => null, onError: noop,
  });
  it("재계약: 빈 값이면 '날짜 고르기' 버튼, 날짜면 10/29(목) 표시", () => {
    expect(renderToString(createElement(CategoryForm, props("recontract", emptyCatForm("recontract"))))).toContain("날짜 고르기");
    expect(renderToString(createElement(CategoryForm, props("recontract", { ...emptyCatForm("recontract"), 다음확인일: "2026-10-29" })))).toContain("10/29(목)");
  });
  it("재계약 다음 확인일은 '날짜만' 표시(비워도 됨, 2026-10-27)", () => {
    expect(renderToString(createElement(CategoryForm, props("recontract", emptyCatForm("recontract"))))).toContain("날짜만");
    expect(renderToString(createElement(CategoryForm, props("bulman", emptyCatForm("bulman"))))).not.toContain("날짜만");
  });
  it("재계약 옛 글자값은 그 글자를 그대로 보여 줌", () => {
    expect(renderToString(createElement(CategoryForm, props("recontract", { ...emptyCatForm("recontract"), 다음확인일: "차주 중" })))).toContain("차주 중");
  });
  it("불만: 다음 확인일은 여전히 글자 input(날짜 고르기 버튼 없음)", () => {
    const h = renderToString(createElement(CategoryForm, props("bulman", emptyCatForm("bulman"))));
    expect(h).toContain("다음 확인일");
    expect(h).not.toContain("날짜 고르기");
  });
});
