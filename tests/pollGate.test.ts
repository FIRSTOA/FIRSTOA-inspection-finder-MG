/**
 * 숨은 화면 조회 차단(2026-10-24 위험 점검 8번) — 화면이 숨어 있거나 탭이 안 보이면 요청 0, focus 몰림은 15초에 한 번.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canPoll, createGapGate, FOCUS_MIN_GAP_MS, gatedHandler, NAVER_PULL_GAP_MS, pageVisible } from "../src/pollGate";

describe("pageVisible·canPoll", () => {
  it("탭이 숨으면 false, document 없으면 true", () => {
    expect(pageVisible({ visibilityState: "hidden" })).toBe(false);
    expect(pageVisible({ visibilityState: "visible" })).toBe(true);
    expect(pageVisible(undefined)).toBe(true);
  });
  it("화면 활성 + 탭 보임 둘 다여야 읽는다", () => {
    expect(canPoll(true, true)).toBe(true);
    expect(canPoll(false, true)).toBe(false);
    expect(canPoll(true, false)).toBe(false);
  });
});

describe("createGapGate", () => {
  it("최소 간격 안의 두 번째 통과는 막고, 지나면 연다", () => {
    let now = 1_000_000;
    const gate = createGapGate(FOCUS_MIN_GAP_MS, () => now);
    expect(gate.tryPass()).toBe(true);
    now += 14_999;
    expect(gate.tryPass()).toBe(false);
    now += 1;
    expect(gate.tryPass()).toBe(true);
  });
  it("force 는 간격을 무시하고, mark 는 시각만 기록", () => {
    const now = 0;
    const gate = createGapGate(1000, () => now);
    gate.mark();
    expect(gate.tryPass()).toBe(false);
    expect(gate.tryPass(true)).toBe(true);
  });
  it("네이버 당기기는 5분 간격", () => {
    expect(NAVER_PULL_GAP_MS).toBe(300_000);
  });
});

describe("gatedHandler — 비활성일 때 fetch 0회", () => {
  const fetchMock = vi.fn(async () => new Response("[]"));
  beforeEach(() => { vi.useFakeTimers(); fetchMock.mockClear(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  const run = () => fetch("https://example.invalid/rest/v1/x");

  it("화면이 숨어 있으면 focus 가 100번 와도 fetch 0회", () => {
    const onFocus = gatedHandler(() => false, createGapGate(), run, () => true);
    for (let i = 0; i < 100; i++) onFocus();
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
  it("탭이 안 보이면 화면 활성이어도 fetch 0회", () => {
    const onFocus = gatedHandler(() => true, createGapGate(), run, () => false);
    onFocus();
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
  it("보이는 화면: 15초 안 focus 몰림은 1회만, 15초 지나면 다시 1회", () => {
    const onFocus = gatedHandler(() => true, createGapGate(), run, () => true);
    for (let i = 0; i < 10; i++) onFocus();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(FOCUS_MIN_GAP_MS);
    onFocus();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("주기 조회 패턴: 숨은 동안 타이머를 걷으면 15초 x 1시간 동안 fetch 0회", () => {
    // LiveSendBoard·FeedbackBoard 와 같은 모양 — active 가 false 면 setInterval 을 걸지 않는다
    const start = (active: boolean) => {
      if (!active) return () => undefined;
      const t = setInterval(() => { if (canPoll(true, true)) void run(); }, 15_000);
      return () => clearInterval(t);
    };
    const stop = start(false);
    vi.advanceTimersByTime(60 * 60_000);
    stop();
    expect(fetchMock).toHaveBeenCalledTimes(0);
    const stop2 = start(true);
    vi.advanceTimersByTime(60_000);
    stop2();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
