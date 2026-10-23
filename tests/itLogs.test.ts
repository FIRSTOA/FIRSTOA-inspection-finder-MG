import { afterEach, describe, expect, it, vi } from "vitest";
import { createOnceGuard, isMissingTableError, ItLogsMissingError, loadItPracticeLogs, loadItQuizAttempts, saveQuizAttempt } from "../src/itLogs";
import { kstDate } from "../src/visits";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe("itLogs", () => {
  it("404/PGRST205 는 ItLogsMissingError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ code: "PGRST205", message: "Could not find the table" }, 404)));
    await expect(loadItQuizAttempts("2026-10-01", "2026-10-31")).rejects.toBeInstanceOf(ItLogsMissingError);
    await expect(saveQuizAttempt({ author: "a", level: "1", total: 10, score: 5 })).rejects.toBeInstanceOf(ItLogsMissingError);
  });

  it("다른 오류는 그대로", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ message: "boom" }, 500)));
    const error = await loadItPracticeLogs("2026-10-01", "2026-10-31").catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ItLogsMissingError);
    expect(isMissingTableError("relation 42P01")).toBe(true);
  });

  it("정상 응답은 {author,date} 로 매핑", async () => {
    const fetchMock = vi.fn(async () => json([{ author: "홍길동", kst_date: "2026-10-05" }, { author: null, kst_date: "2026-10-06" }]));
    vi.stubGlobal("fetch", fetchMock);
    const rows = await loadItQuizAttempts("2026-10-01", "2026-10-31");
    expect(rows).toEqual([{ author: "홍길동", date: "2026-10-05" }, { author: "", date: "2026-10-06" }]);
    expect(String(fetchMock.mock.calls[0][0])).toContain("it_quiz_attempts?");
  });

  it("saveQuizAttempt 는 kst_date 를 넣어 insert", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await saveQuizAttempt({ author: "홍길동", level: "전체", total: 10, score: 7 });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ author: "홍길동", level: "전체", total: 10, score: 7 });
    expect(body.kst_date).toBe(kstDate());
  });

  it("중복 저장 가드", () => {
    const guard = createOnceGuard();
    expect(guard.take("1")).toBe(true);
    expect(guard.take("1")).toBe(false);
    guard.release("1");
    expect(guard.take("1")).toBe(true);
  });
});
