// CS 접수·물류 완료 공용 모듈 — 일정리스트와 홈 미처리 [완료]가 같은 규칙을 쓰는지
import { describe, expect, it, vi } from "vitest";
import {
  completeTicket, copierDoneKind, copierDoneText, NAVER_DELIVERY_CAL_ID, naverCompleteAction, receptionStatusFromSiblings,
  type CompletionDeps,
} from "../src/ticketCompletion";

type Row = Record<string, unknown> & { id: string };

function makeDeps(row: Row | null, opts: {
  patchFail?: boolean; readFail?: boolean; siblings?: Array<{ id: string; status: string; assignee?: string }>;
  reception?: Record<string, unknown> | null; monthlyDup?: boolean; visitDup?: boolean; kakaoOk?: boolean; naverFail?: boolean; itCalId?: string;
} = {}) {
  const log: string[] = [];
  const naverCalls: Array<Record<string, unknown>> = [];
  const deps: CompletionDeps = {
    readTicket: vi.fn(async () => { log.push("read"); if (opts.readFail) throw new Error("net"); return row as never; }),
    patchTicket: vi.fn(async () => { log.push("patch"); if (opts.patchFail) throw new Error("boom"); }),
    readSiblings: vi.fn(async () => { log.push("siblings"); return opts.siblings || []; }),
    setReceptionStatus: vi.fn(async () => { log.push("receptionStatus"); }),
    getReception: vi.fn(async () => { log.push("getReception"); return (opts.reception ?? null) as never; }),
    sendCopierDone: vi.fn(async () => { log.push("bd"); }),
    loadItCalId: vi.fn(async () => opts.itCalId || ""),
    naver: vi.fn(async (body: Record<string, unknown>) => {
      naverCalls.push(body); log.push(`naver:${body.action}`);
      if (opts.naverFail) throw new Error("caldav");
      return (body.action === "caldav_get" ? { description: "원래" } : { status: "moved" }) as never;
    }) as CompletionDeps["naver"],
    findMonthlyDup: vi.fn(async () => !!opts.monthlyDup),
    buildMonthlyClone: vi.fn(async (r: Record<string, unknown>) => ({ id: `rep|${r.vendor}`, vendor: r.vendor })),
    saveClone: vi.fn(async () => { log.push("clone"); }),
    findVisitDup: vi.fn(async () => !!opts.visitDup),
    saveVisit: vi.fn(async () => { log.push("visit"); return "new"; }),
    sendKakao: vi.fn(async () => { log.push("kakao"); return opts.kakaoOk === false ? { ok: false, error: "방 없음" } : { ok: true }; }),
    now: () => new Date(2026, 9, 25, 14, 5),
    emitChanged: vi.fn(() => { log.push("emit"); }),
  };
  return { deps, log, naverCalls };
}

const asRow: Row = {
  id: "t1", team: "C", vendor: "가나상사", status: "배정", assignee: "김철수", scheduleType: "AS", source: "", naverUid: "u1",
  receptionId: "r1", repeatMonthly: true, note: "기존 메모", grade: "A", calendarTitle: "가나상사", model: "", serial: "", asset: "", issue: "",
};

describe("판정 순수 함수", () => {
  it("naverCompleteAction: IT 제자리·팀 이동·물류 제자리(내용 덧붙임 없음)·미러 없음", () => {
    expect(naverCompleteAction({ naverUid: "u", source: "it", scheduleType: "AS", team: "A" }, { itCalId: "IT1" }))
      .toEqual({ kind: "check", calId: "IT1", writeNote: true, target: "it" });
    expect(naverCompleteAction({ naverUid: "u", scheduleType: "AS", team: "C" })).toEqual({ kind: "move", team: "C", writeNote: true });
    expect(naverCompleteAction({ naverUid: "u", scheduleType: "납품철수교체휴가교육", team: "C" }))
      .toEqual({ kind: "check", calId: NAVER_DELIVERY_CAL_ID, writeNote: false, target: "delivery" });
    expect(naverCompleteAction({ naverUid: "u", scheduleType: "물류", source: "it" }).kind).toBe("check");
    expect(naverCompleteAction({ naverUid: "", scheduleType: "AS" })).toEqual({ kind: "none" });
  });
  it("receptionStatusFromSiblings: 가장 앞선 단계", () => {
    expect(receptionStatusFromSiblings(["완료", "배정"])).toBe("완료");
    expect(receptionStatusFromSiblings(["접수", "배정"])).toBe("진행중");
    expect(receptionStatusFromSiblings(["익일", "접수"])).toBe("접수");
    expect(receptionStatusFromSiblings([])).toBe("접수");
  });
  it("copierDoneText / copierDoneKind: BD열 문구", () => {
    const at = new Date(2026, 9, 5, 9, 7);
    expect(copierDoneText("완료", at, "김철수")).toBe("완료 10/5 09:07 김철수");
    expect(copierDoneText("익일", at, "김철수")).toBe("익일 10/5 09:07");
    expect(copierDoneText("-", at)).toBe("-");
    expect(copierDoneKind("완료", "배정")).toBe("완료");
    expect(copierDoneKind("배정", "완료")).toBe("-");
    expect(copierDoneKind("배정", "접수")).toBe("");
  });
});

describe("completeTicket", () => {
  it("단계 순서: PATCH → 접수 → BD열 → 네이버(기록→이동) → 반복 → 방문 → 카톡", async () => {
    const { deps, log, naverCalls } = makeDeps(asRow, { siblings: [{ id: "t1", status: "배정" }, { id: "t2", status: "접수" }], reception: { type: "복합기 AS", lease_no: "12345", author: "접수자", vendor: "가나상사", sheet_row: 7 } });
    const r = await completeTicket("t1", { text: "토너 교체", mode: "visit" }, { author: "이영희", today: "2026-10-25" }, deps);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
    expect(log).toEqual(["read", "patch", "siblings", "receptionStatus", "getReception", "bd", "naver:caldav_get", "naver:caldav_update", "naver:caldav_move", "clone", "visit", "kakao", "emit"]);
    // PATCH 는 최신 메모 뒤에 블록을 잇는다
    const patch = (deps.patchTicket as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<string, string>;
    expect(patch.status).toBe("완료");
    expect(patch.note.startsWith("기존 메모\n\n")).toBe(true);
    expect(patch.note).toContain("토너 교체");
    // 형제 중 가장 앞선 단계 = 방금 완료한 이 일정 → 완료, 처리자는 그 일정 담당
    expect((deps.setReceptionStatus as ReturnType<typeof vi.fn>).mock.calls[0].slice(0, 2)).toEqual(["r1", "완료"]);
    expect((deps.setReceptionStatus as ReturnType<typeof vi.fn>).mock.calls[0][2].by).toBe("김철수");
    expect((deps.sendCopierDone as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ firstNo: "12345", sheetRow: 7, doneText: "완료 10/25 14:05 김철수" });
    expect(naverCalls[2]).toEqual({ action: "caldav_move", uid: "u1", team: "C" });
    expect((deps.sendKakao as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("수도권C");
  });

  it("1단계(PATCH) 실패면 나머지를 하지 않는다", async () => {
    const { deps, log } = makeDeps(asRow, { patchFail: true });
    const r = await completeTicket({ id: "t1" }, { text: "x", mode: "visit" }, { author: "이영희" }, deps);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("boom");
    expect(log).toEqual(["read", "patch"]);
  });

  it("최신 행을 못 읽으면 PATCH 도 하지 않는다(메모 덮어쓰기 방지)", async () => {
    const { deps, log } = makeDeps(asRow, { readFail: true });
    const r = await completeTicket("t1", { text: "x" }, { author: "a" }, deps);
    expect(r.ok).toBe(false);
    expect(log).toEqual(["read"]);
  });

  it("이미 완료면 아무것도 안 한다", async () => {
    const { deps, log } = makeDeps({ ...asRow, status: "완료" });
    const r = await completeTicket("t1", { text: "x" }, { author: "a" }, deps);
    expect(r).toMatchObject({ ok: true, alreadyDone: true });
    expect(log).toEqual(["read"]);
  });

  it("물류: 네이버 납품철수교체 캘린더 제자리 완료 체크만(기록·이동 없음), 카톡·방문 없음", async () => {
    const row = { ...asRow, scheduleType: "납품철수교체휴가교육", receptionId: "", repeatMonthly: false };
    const { deps, log, naverCalls } = makeDeps(row);
    const r = await completeTicket("t1", { text: "설치 완료" }, { author: "이영희" }, deps);
    expect(r.ok).toBe(true);
    expect(naverCalls).toEqual([{ action: "caldav_check", uid: "u1", done: true, calId: NAVER_DELIVERY_CAL_ID }]);
    expect(log).not.toContain("kakao");
    expect(log).not.toContain("visit");
  });

  it("IT: 설정에서 IT 캘린더를 읽어 그 자리에서 기록 후 체크", async () => {
    const row = { ...asRow, source: "it", receptionId: "", repeatMonthly: false };
    const { deps, naverCalls } = makeDeps(row, { itCalId: "ITCAL" });
    await completeTicket("t1", { text: "원격 처리", mode: "phone" }, { author: "이영희" }, deps);
    expect(naverCalls.map((c) => [c.action, c.calId])).toEqual([["caldav_get", "ITCAL"], ["caldav_update", "ITCAL"], ["caldav_check", "ITCAL"]]);
  });

  it("2~7 단계 실패는 warnings 로 돌려주고 완료는 유지", async () => {
    const { deps, log } = makeDeps({ ...asRow, receptionId: "" }, { naverFail: true, kakaoOk: false });
    const r = await completeTicket("t1", { text: "처리", mode: "visit" }, { author: "이영희" }, deps);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes("네이버"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("카톡"))).toBe(true);
    expect(log).toContain("visit");
  });

  it("반복 다음 달이 이미 있거나 같은 날 방문일지가 있으면 건너뜀", async () => {
    const { deps, log } = makeDeps({ ...asRow, receptionId: "", naverUid: "" }, { monthlyDup: true, visitDup: true });
    const r = await completeTicket("t1", { text: "처리", mode: "visit" }, { author: "이영희" }, deps);
    expect(r.ok).toBe(true);
    expect(log).not.toContain("clone");
    expect(log).not.toContain("visit");
  });

  it("처리 내용이 비면 카톡·네이버 기록 없이 이동만, 메모는 그대로", async () => {
    const { deps, log } = makeDeps({ ...asRow, receptionId: "", repeatMonthly: false });
    await completeTicket("t1", { text: "  " }, { author: "이영희" }, deps);
    expect(log).toEqual(["read", "patch", "naver:caldav_move", "emit"]);
    const patch = (deps.patchTicket as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<string, string>;
    expect(patch.note).toBe("기존 메모");
  });
});
