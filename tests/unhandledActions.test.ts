// 미처리 [완료]·[보류]·[배정](2026-10-25) — 낙관 제거(pending 5분·실패 복원)·단추 노출 규칙·statusOnly 계약·표시 이름
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyPending, clearPending, markPending, PENDING_TTL_MS, readPending, resetPending } from "../src/unhandledPending";
import { performUnhandledAction, sheetStatusFor, unhandledButtons, unhandledRoute, pendingValueFor } from "../src/unhandledActions";
import { buildSheetStatusPayload, sheetVendorHead } from "../src/deptReceptionApi";
import { RECEPTION_TYPE_META, RECEPTION_TYPES } from "../src/ReceptionTypePicker";
import { receptionTypeLabel } from "../src/receptionTypeLabel";
import type { UnhandledRow } from "../src/homeUnhandled";

const base: UnhandledRow = { key: "r:1", source: "reception", kind: "영업팀", team: "영업", date: "2026-10-20", vendor: "가나상사", title: "", assignee: "", status: "진행중", ageDays: 5, receptionId: "1" };
const row = (p: Partial<UnhandledRow>): UnhandledRow => ({ ...base, ...p });

describe("unhandledPending", () => {
  beforeEach(() => resetPending());

  it("완료 = 5분 동안 줄을 뺀다, 만료되면 다시 보인다", () => {
    const now = 1_000_000;
    markPending("r:1", "done", "", now);
    const rows = [row({}), row({ key: "r:2", receptionId: "2" })];
    expect(applyPending(rows, { now: now + 1000 }).map((r) => r.key)).toEqual(["r:2"]);
    expect(applyPending(rows, { now: now + PENDING_TTL_MS + 1 }).map((r) => r.key)).toEqual(["r:1", "r:2"]);
  });

  it("실패면 clearPending → 줄이 되살아남", () => {
    markPending("r:1", "done");
    expect(applyPending([row({})])).toHaveLength(0);
    clearPending("r:1");
    expect(applyPending([row({})])).toHaveLength(1);
  });

  it("보류·배정은 줄을 남기고 상태·처리자만 덮는다", () => {
    markPending("r:1", "hold", "보류");
    markPending("r:2", "assign", "김수인");
    const out = applyPending([row({}), row({ key: "r:2" })]);
    expect(out.map((r) => [r.status, r.assignee])).toEqual([["보류", ""], ["진행중", "김수인"]]);
  });

  it("prune: 원본에서 이미 빠진 완료 줄·이미 같은 값인 줄의 pending 은 지운다(부분 목록은 prune 안 함)", () => {
    markPending("r:9", "done");
    markPending("r:1", "assign", "김수인");
    applyPending([row({ assignee: "김수인" })]); // prune 꺼짐 → 그대로
    expect(Object.keys(readPending()).sort()).toEqual(["r:1", "r:9"]);
    applyPending([row({ assignee: "김수인" })], { prune: true });
    expect(Object.keys(readPending())).toEqual([]);
  });

  it("performUnhandledAction 실패 → pending 지우고 빨간 토스트(삼키지 않음)", async () => {
    const notify = vi.fn();
    const bad = row({ key: "x:1", receptionId: undefined }); // 경로 없는 줄 → throw
    const ok = await performUnhandledAction(bad, "done", { by: "나" }, notify);
    expect(ok).toBe(false);
    expect(readPending()["x:1"]).toBeUndefined();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("완료 실패"), "error");
  });
});

describe("단추 노출 규칙", () => {
  const sheetRow = (kind: UnhandledRow["kind"], source: "sales" | "mgmt" | "remote") =>
    row({ key: `s:${source}:12`, kind, receptionId: undefined, sheet: { source, row: 12, seq: "301", author: "김", vendor: "가나상사" } });

  it("영업·경영 시트 줄 = 완료·보류·배정, 경로 sheet", () => {
    expect(unhandledRoute(sheetRow("영업팀", "sales"))).toBe("sheet");
    expect(unhandledButtons(sheetRow("경영지원", "mgmt"))).toEqual({ done: true, hold: true, assign: true, openSchedule: false });
  });
  it("원격·IT 는 보류 없음(Q1) — 시트 줄·앱 줄 모두", () => {
    expect(unhandledButtons(sheetRow("원격이관", "remote")).hold).toBe(false);
    expect(unhandledButtons(row({ key: "r:5", kind: "IT", receptionId: "5" }))).toEqual({ done: true, hold: false, assign: true, openSchedule: false });
    expect(unhandledRoute(row({ key: "s:remote:9", kind: "원격이관", receptionId: "5" }))).toBe("remote");
  });
  it("앱 부서 줄(시트에 이어진 줄 포함)은 dept 경로 — 시트 잡 따로 안 씀", () => {
    expect(unhandledRoute(row({}))).toBe("dept");
    expect(unhandledRoute(row({ key: "s:sales:12", receptionId: "1" }))).toBe("dept");
    expect(unhandledButtons(row({ kind: "운영지원", team: "운영" })).hold).toBe(true);
  });
  it("CS접수 = 완료 + 일정리스트 열기, 물류 = 완료만", () => {
    expect(unhandledButtons(row({ key: "t:a", source: "ticket", kind: "CS접수", receptionId: undefined }))).toEqual({ done: true, hold: false, assign: false, openSchedule: true });
    expect(unhandledButtons(row({ key: "t:b", source: "ticket", kind: "물류", receptionId: undefined }))).toEqual({ done: true, hold: false, assign: false, openSchedule: false });
  });
  it("시트 상태 값: 완료 = 처리완료, 보류 ↔ 진행중", () => {
    expect(sheetStatusFor("done", "진행중")).toBe("처리완료");
    expect(sheetStatusFor("hold", "진행중")).toBe("보류");
    expect(sheetStatusFor("hold", "보 류")).toBe("진행중");
    expect(pendingValueFor("hold", { status: "보류" })).toBe("진행중");
    expect(pendingValueFor("assign", { status: "" }, " 김수인 ")).toBe("김수인");
  });
});

describe("statusOnly 잡 payload(엣지 계약)", () => {
  it("최상위 키만 · 빈 status/handler 는 안 보냄 · vendorHead 정규화 앞 6자", () => {
    expect(sheetVendorHead("(주) 가나다 라마바사아")).toBe("가나다라마바");
    expect(sheetVendorHead("㈜ABC")).toBe("ABC");
    expect(buildSheetStatusPayload({ source: "sales", sheetRow: 12, seq: " 301 ", vendor: "가나상사", status: "처리완료", by: "나" }))
      .toEqual({ statusOnly: true, sheetRow: 12, seq: "301", vendorHead: "가나상사", status: "처리완료" });
    expect(buildSheetStatusPayload({ source: "remote", sheetRow: 7, seq: "", vendor: "다라", handler: "이찬우", by: "나" }))
      .toEqual({ statusOnly: true, sheetRow: 7, seq: "", vendorHead: "다라", handler: "이찬우" });
  });
});

describe("CS 접수 표시 이름(값은 복합기 AS 그대로)", () => {
  it("receptionTypeLabel", () => {
    expect(receptionTypeLabel("복합기 AS")).toBe("CS 접수");
    expect(receptionTypeLabel("복합기 AS", { short: true })).toBe("CS");
    expect(receptionTypeLabel("원격이관")).toBe("원격");
    expect(receptionTypeLabel("영업팀", { short: true })).toBe("영업");
    expect(receptionTypeLabel("모름")).toBe("모름");
    expect(RECEPTION_TYPE_META["복합기 AS"].type).toBe("복합기 AS");
    for (const m of RECEPTION_TYPES) expect(receptionTypeLabel(m.type)).toBe(m.label); // 선택기 글자와 한 벌
  });
});
