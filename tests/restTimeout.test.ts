/** REST 래퍼 시간 제한(2026-10-31) — 응답이 안 오면 읽기 45초·쓰기 30초 뒤 사람이 읽는 메시지로 중단, 정상 응답은 그대로 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { insertRecord, insertRow, selectRows, updateRows, enqueueOutbox, READ_TIMEOUT_MS, WRITE_TIMEOUT_MS } from "../src/supabase";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// 응답이 영영 안 오는 fetch — signal 이 끊기면 브라우저처럼 AbortError 로 끝난다
function hangingFetch() {
  return vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    // 실제 fetch 처럼 이미 끊긴 signal 이면 곧바로 실패
    if (init?.signal?.aborted) { reject(new DOMException("The operation was aborted.", "AbortError")); return; }
    init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
  }));
}

describe("REST 시간 제한", () => {
  it("기본값: 읽기 45초 · 쓰기 30초", () => {
    expect(READ_TIMEOUT_MS).toBe(45_000);
    expect(WRITE_TIMEOUT_MS).toBe(30_000);
  });

  it("쓰기 응답이 30초 넘게 없으면 '저장됐는지 확인' 문구로 중단 (가짜 시계)", async () => {
    vi.useFakeTimers();
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const p = updateRows("t", "id=eq.1", { a: 1 });
    const caught = p.catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(29_999);
    let settled = false;
    void p.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("30초");
    expect((err as Error).message).toContain("저장됐는지 목록에서 확인한 뒤 다시 시도하세요");
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it("읽기 응답이 45초 넘게 없으면 조회 중단 메시지 (가짜 시계)", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hangingFetch());
    const caught = selectRows("t", "select=*").catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
    const err = (await caught) as Error;
    expect(err.message).toContain("45초");
    expect(err.message).toContain("조회를 중단했습니다");
  });

  it("timeoutMs 주입(50ms) — insertRow 의 중복 조회가 멈춰도 끝난다", async () => {
    vi.stubGlobal("fetch", hangingFetch());
    await expect(insertRow("t", { _dupKey: "k", a: 1 }, { timeoutMs: 50 })).rejects.toThrow("서버 응답이 50ms 넘게 없어 중단했습니다 — 저장됐는지 목록에서 확인한 뒤 다시 시도하세요");
  });

  it("enqueueOutbox: 중복 조회가 시간 초과면 적재도 바로 중단 — 시간 초과 메시지", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    await expect(enqueueOutbox("방", "글", { timeoutMs: 50 })).rejects.toThrow("저장됐는지 목록에서 확인");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("정상 응답은 그대로 — 결과·상태 해석 불변", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return { ok: false, status: 409, text: async () => "" } as unknown as Response;
      return { ok: true, status: 200, json: async () => [{ id: 1 }], text: async () => "" } as unknown as Response;
    }));
    await expect(selectRows("t", "select=*")).resolves.toEqual([{ id: 1 }]);
    await expect(insertRecord("jeomgeom", {} as never)).resolves.toBe("dup");
  });

  it("시간 초과가 아닌 오류(서버 500·네트워크)는 원래 메시지 그대로", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, text: async () => "boom" }) as unknown as Response));
    await expect(updateRows("t", "id=eq.1", { a: 1 })).rejects.toThrow("수정 실패 t(500): boom");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(selectRows("t", "select=*")).rejects.toThrow("Failed to fetch");
  });

  it("호출자가 signal 을 넘기면 그 signal 이 쓰이고, 그 취소는 시간 초과로 바꾸지 않는다", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const p = selectRows("t", "select=*", { signal: controller.signal });
    controller.abort();
    await expect(p).rejects.toThrow("The operation was aborted.");
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBe(controller.signal);
  });
});
