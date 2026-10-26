/**
 * 재계약 다음 확인일 = 날짜 필수 + 보내기 성공 시 일정 바로 만들기(2026-10-27).
 * 지키는 것: 날짜 없음/글자값 → 보내기 막힘 · 날짜 있음 → 자동 생성 인자(팀·제목·날짜) · 열린 일정 있음 → 창(duplicate)
 *          · 실패 → 창(failed) · 테스트 모드 → 창(sheet) · [취소] → 일정리스트 삭제 + 네이버 삭제.
 */
import { describe, expect, it, vi } from "vitest";
import { categoryFormBlock, isStrictDateKey } from "../src/categoryForms";
import {
  autoCreatedMessage, autoCreateRecontractSchedule, cancelRecontractSchedule, type AutoScheduleDeps,
} from "../src/recontractAutoSchedule";
import type { createRecontractSchedule, ScheduleOffer } from "../src/recontractSchedule";

const FORM: Record<string, string> = {
  작성자: "", 지역: "C", 등급: "S", 업체명: "보림토건(주)", 담당자: "김과장 010-1234-5678", 기종: "C3060",
  후속담당자: "이민구", 다음확인일: "2026-11-15",
};
const offer = (form: Record<string, string> = FORM, testMode = false): ScheduleOffer =>
  ({ dupKey: "abc123", form, author: "이민구", text: "■ 재계약 원문", testMode, at: Date.UTC(2026, 9, 27, 3) });

type Create = typeof createRecontractSchedule;
const deps = (create: Create, findAddress: AutoScheduleDeps["findAddress"] = async () => "서울 중구 1"): AutoScheduleDeps =>
  ({ today: "2026-10-27", book: {}, names: ["이민구"], writtenOn: "2026-10-27", findAddress, create });

describe("다음 확인일 = 날짜만·필수", () => {
  it("비었거나 글자값이면 보내기 막힘, 날짜면 통과", () => {
    expect(categoryFormBlock("recontract", { ...FORM, 다음확인일: "" })).toBe("다음 확인일을 고르세요");
    expect(categoryFormBlock("recontract", { ...FORM, 다음확인일: "차주 중" })).toBe("다음 확인일을 고르세요");
    expect(categoryFormBlock("recontract", FORM)).toBe("");
  });
  it("다른 양식(불만)은 막지 않고, 글로 쓰기 막는 칸은 재계약 다음확인일만", () => {
    expect(categoryFormBlock("bulman", { 다음확인일: "" })).toBe("");
    expect(isStrictDateKey("recontract", "다음확인일")).toBe(true);
    expect(isStrictDateKey("bulman", "다음확인일")).toBe(false);
    expect(isStrictDateKey("recontract", "계약종료일")).toBe(false);
  });
});

describe("보내기 성공 → 일정 자동 생성", () => {
  it("날짜 있음 → createRecontractSchedule(auto) 인자: 팀 C·제목·날짜·장소·담당", async () => {
    const create = vi.fn<Create>(async (input) => ({ kind: "created", ticketId: "rc-abc123", date: input.date, naver: "ok" }));
    const r = await autoCreateRecontractSchedule(offer(), deps(create));
    expect(r).toMatchObject({ kind: "created", ticketId: "rc-abc123", date: "2026-11-15", naver: "ok" });
    expect(create).toHaveBeenCalledTimes(1);
    const [input, choice, today] = create.mock.calls[0];
    expect(choice).toBe("auto");
    expect(today).toBe("2026-10-27");
    expect(input).toMatchObject({ team: "C", title: "[재계약 확인] 보림토건(주)", date: "2026-11-15", address: "서울 중구 1", assignee: "이민구", dupKey: "abc123" });
    expect(input.note).toContain("■ 재계약 원문");
    expect(autoCreatedMessage("2026-11-15", "ok")).toBe("재계약 확인 일정 11/15 만들었습니다");
  });
  it("주소 조회가 실패해도 빈 장소로 만든다", async () => {
    const create = vi.fn<Create>(async (input) => ({ kind: "created", ticketId: "rc-x", date: input.date, naver: "ok" }));
    await autoCreateRecontractSchedule(offer(), deps(create, async () => { throw new Error("timeout"); }));
    expect(create.mock.calls[0][0].address).toBe("");
  });
  it("같은 업체 열린 재계약 일정 있음 → duplicate(창)", async () => {
    const existing = [{ id: "rc-old", vendor: "보림토건", date: "2026-11-01" }];
    const create = vi.fn<Create>(async () => ({ kind: "duplicate", existing }));
    expect(await autoCreateRecontractSchedule(offer(), deps(create))).toEqual({ kind: "duplicate", existing });
  });
  it("저장 실패·팀 모름 → failed(창)", async () => {
    const create = vi.fn<Create>(async () => { throw new Error("공용 저장 실패 as_tickets(500)"); });
    expect(await autoCreateRecontractSchedule(offer(), deps(create))).toEqual({ kind: "failed", error: "공용 저장 실패 as_tickets(500)" });
    // 지역·명단 없음 → 팀 "" → 실제 함수의 입력 검사에서 실패
    const real = await autoCreateRecontractSchedule(offer({ ...FORM, 지역: "" }), { ...deps(undefined as unknown as Create), create: undefined });
    expect(real).toEqual({ kind: "failed", error: "팀(A~E)을 골라 주세요" });
  });
  it("테스트 모드 → 만들지 않고 창, 날짜 없음 → 건너뜀", async () => {
    const create = vi.fn<Create>();
    expect(await autoCreateRecontractSchedule(offer(FORM, true), deps(create))).toEqual({ kind: "sheet" });
    expect(await autoCreateRecontractSchedule(offer({ ...FORM, 다음확인일: "" }), deps(create))).toEqual({ kind: "skip" });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("[취소] → 삭제", () => {
  it("일정리스트 행 삭제 + 네이버 uid 있으면 caldav_delete", async () => {
    const select = vi.fn(async () => [{ id: "rc-abc123", naverUid: "uid-9" }]);
    const remove = vi.fn(async () => undefined);
    const invoke = vi.fn(async () => ({ ok: true }));
    const r = await cancelRecontractSchedule("rc-abc123", { select: select as never, remove, invoke: invoke as never });
    expect(r).toEqual({});
    expect(remove).toHaveBeenCalledWith("as_tickets", "id=eq.rc-abc123");
    expect(invoke).toHaveBeenCalledWith("naver-calendar-push", { action: "caldav_delete", uid: "uid-9" });
  });
  it("네이버만 실패 → throw 없이 naverError, 일정리스트 삭제 실패 → throw", async () => {
    const select = vi.fn(async () => [{ id: "rc-1", naverUid: "u" }]);
    const r = await cancelRecontractSchedule("rc-1", { select: select as never, remove: async () => undefined, invoke: (async () => { throw new Error("CalDAV 401"); }) as never });
    expect(r).toEqual({ naverError: "CalDAV 401" });
    const invoke = vi.fn();
    await expect(cancelRecontractSchedule("rc-1", { select: select as never, remove: async () => { throw new Error("삭제 실패"); }, invoke: invoke as never })).rejects.toThrow("삭제 실패");
    expect(invoke).not.toHaveBeenCalled();
  });
});
