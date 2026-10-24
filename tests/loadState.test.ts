/**
 * 조회 실패를 0건으로 보이지 않게(2026-10-24 위험 점검 10번) — 고객 리포트·자동 일정.
 */
import { describe, expect, it } from "vitest";
import { countLabel, failureMessage, reportViewState, tryLoad, type LoadFailure } from "../src/loadState";

describe("tryLoad", () => {
  it("성공은 값 그대로, 실패는 null + 이름표 기록(빈 배열로 바꾸지 않음)", async () => {
    const failures: LoadFailure[] = [];
    expect(await tryLoad("접수", Promise.resolve([1, 2]), failures)).toEqual([1, 2]);
    const r = await tryLoad("점검 기록", Promise.reject(new Error("timeout")), failures);
    expect(r).toBeNull();
    expect(failures).toEqual([{ label: "점검 기록", message: "timeout" }]);
  });
});

describe("실패 시 0건 문구 없음", () => {
  it("failureMessage 는 다시 시도 안내 + 실패 이름표, '0건' 없음", () => {
    const msg = failureMessage([{ label: "AS·원격·IT 접수", message: "Failed to fetch" }], "리포트 자료");
    expect(msg).toContain("불러오지 못했습니다");
    expect(msg).toContain("다시 시도");
    expect(msg).toContain("AS·원격·IT 접수");
    expect(msg).not.toMatch(/0건/);
  });
  it("실패 없으면 빈 문자열", () => {
    expect(failureMessage([])).toBe("");
  });
  it("countLabel — 실패면 '—', 성공 0이면 '0건'", () => {
    expect(countLabel(0, true)).toBe("—");
    expect(countLabel(0, false)).toBe("0건");
    expect(countLabel(3, false)).toBe("3건");
  });
});

describe("reportViewState — 실패 상태에서 보내기·저장 단추 비활성", () => {
  it("오류면 error·canSend false (리포트가 남아 있어도)", () => {
    expect(reportViewState({ hasReport: false, loading: false, error: "점검 기록 실패" })).toEqual({ kind: "error", canSend: false });
    expect(reportViewState({ hasReport: true, loading: false, error: "x" })).toEqual({ kind: "error", canSend: false });
  });
  it("만드는 중·아무것도 없음도 보낼 수 없다", () => {
    expect(reportViewState({ hasReport: true, loading: true, error: "" }).canSend).toBe(false);
    expect(reportViewState({ hasReport: false, loading: false, error: "" })).toEqual({ kind: "idle", canSend: false });
  });
  it("정상 리포트만 보낼 수 있다", () => {
    expect(reportViewState({ hasReport: true, loading: false, error: "" })).toEqual({ kind: "ready", canSend: true });
  });
});
