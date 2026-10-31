import { describe, expect, it } from "vitest";
import { visitAdviceLogLabel, visitAdviceNote } from "../src/visitAdviceNote";

// 2026-10-31(토) 14:00 KST
const now = new Date("2026-10-31T05:00:00Z");

describe("visitAdviceNote", () => {
  it("즉시 대기·보류 예정(같은 날·다른 날)", () => {
    expect(visitAdviceNote({ status: "queued", verdict: "필요", dueAt: now.toISOString(), immediate: true }, now)).toBe(" + 방문 판단 글 대기(1분 안)");
    const early = new Date("2026-10-31T00:30:00Z"); // 09:30 KST
    expect(visitAdviceNote({ status: "queued", verdict: "필요", dueAt: "2026-10-31T01:00:00Z", immediate: false }, early)).toBe(" + 방문 판단 글 10:00 예정");
    expect(visitAdviceNote({ status: "queued", verdict: "판단필요", dueAt: "2026-11-02T01:00:00Z", immediate: false }, now)).toBe(" + 방문 판단 글 11/2 10:00 예정");
  });
  it("오류: 표 없음과 그 밖의 실패를 나눈다", () => {
    expect(visitAdviceNote({ status: "error", tableMissing: true, error: "PGRST202" }, now)).toBe(" · 방문 판단 표 없음(SQL 실행 전)");
    expect(visitAdviceNote({ status: "error", tableMissing: false, error: "network" }, now)).toBe(" · 방문 판단 글 실패(접수는 정상)");
  });
  it("꺼짐·할 일 없음·이미 있음은 표시 없음", () => {
    expect(visitAdviceNote({ status: "off" }, now)).toBe("");
    expect(visitAdviceNote({ status: "no-task", verdict: "불필요" }, now)).toBe("");
    expect(visitAdviceNote({ status: "exists", verdict: "필요", dueAt: "", immediate: true }, now)).toBe("");
    expect(visitAdviceNote(null, now)).toBe("");
  });
});

describe("visitAdviceLogLabel", () => {
  it("상태별 한 줄", () => {
    expect(visitAdviceLogLabel({ status: "queued", due_at: "2026-11-02T01:00:00Z" }, now)).toBe("대기 11/2 10:00");
    expect(visitAdviceLogLabel({ status: "sent", sent_at: "2026-10-31T03:01:00Z" }, now)).toBe("보냄 12:01");
    expect(visitAdviceLogLabel({ status: "skipped", reason: "no_action" }, now)).toBe("할 일 없음");
    expect(visitAdviceLogLabel({ status: "skipped", reason: "cancelled" }, now)).toBe("안 보냄(접수 취소·삭제)");
    expect(visitAdviceLogLabel({ status: "error", error: "no_room" }, now)).toBe("실패");
    expect(visitAdviceLogLabel(null, now)).toBe("");
  });
});
