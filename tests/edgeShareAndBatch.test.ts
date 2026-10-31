import { describe, expect, it } from "vitest";
import { kstHourOf, regionLetter, shareHoldReason, shareNewChanges } from "../supabase/functions/contact-sheet-pull/share";
import { insertInChunks, isStatementTimeout } from "../supabase/functions/_shared/rest-batch";

// KST 시각 → epoch ms
const kst = (ymdhm: string) => Date.parse(`${ymdhm}:00+09:00`);

/** contact_changes·room_map·outbox 를 흉내 내는 가짜 REST (두 실행이 같은 상태를 나눠 쓴다) */
function fakeRest(opts: { outboxFails?: boolean } = {}) {
  const changes = [{ id: 7, change_date: "2026-10-31", company: "테스트상사", region: "수도권A", category: "키맨", reason: "담당 교체", after_text: "홍길동 010-0000-0000", shared_at: null as string | null, shared_room: "" }];
  const outbox: Array<{ room: string; text: string }> = [];
  const calls: string[] = [];
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
  const fetchFn = async (url: string, init: RequestInit = {}) => {
    const method = init.method || "GET";
    calls.push(`${method} ${url.split("?")[0].split("/").pop()}`);
    if (url.includes("/contact_changes?select=")) {
      // 두 실행이 거의 동시에 읽는 상황 — 읽는 순간의 미공유 행
      return json(changes.filter((c) => c.shared_at === null).map((c) => ({ ...c })));
    }
    if (url.includes("/room_map?")) return json([{ category: "점검", region: "A", room: "강북A 점검방" }]);
    if (url.includes("/contact_changes?id=eq.") && method === "PATCH") {
      const body = JSON.parse(String(init.body));
      const row = changes.find((c) => url.includes(`id=eq.${c.id}`))!;
      if (url.includes("shared_at=is.null")) {
        if (row.shared_at !== null) return json([]); // 이미 다른 실행이 잡음
        Object.assign(row, body);
        return json([row]);
      }
      Object.assign(row, body);
      return new Response(null, { status: 204 });
    }
    if (url.endsWith("/outbox") && method === "POST") {
      if (opts.outboxFails) return new Response("boom", { status: 500 });
      outbox.push(JSON.parse(String(init.body)));
      return new Response(null, { status: 201 });
    }
    throw new Error(`예상 못 한 호출 ${method} ${url}`);
  };
  return { changes, outbox, calls, fetchFn };
}

describe("contact-sheet-pull 공유 시간 규칙", () => {
  it("10시 전·22시 이후는 보류, 10~21시는 보낸다", () => {
    expect(shareHoldReason(9)).toMatch(/10시 전/);
    expect(shareHoldReason(10)).toBeNull();
    expect(shareHoldReason(21)).toBeNull();
    expect(shareHoldReason(22)).toMatch(/22시 이후/);
    expect(shareHoldReason(23)).toMatch(/22시 이후/);
    expect(shareHoldReason(0)).toMatch(/10시 전/);
  });
  it("kstHourOf 는 UTC 를 KST 로 바꿔 센다", () => {
    expect(kstHourOf(kst("2026-10-31T22:05"))).toBe(22);
    expect(kstHourOf(kst("2026-11-01T00:30"))).toBe(0);
  });
  it("22시 이후에는 DB 를 읽지도 않고 보류한다", async () => {
    const db = fakeRest();
    const r = await shareNewChanges("k", "https://x/rest/v1", { nowMs: kst("2026-10-31T22:30"), fetchFn: db.fetchFn });
    expect(r.held).toMatch(/22시/);
    expect(db.calls).toEqual([]);
    expect(db.outbox).toEqual([]);
  });
  it("regionLetter", () => {
    expect(regionLetter("수도권지역 :A")).toBe("A");
    expect(regionLetter("")).toBe("");
  });
});

describe("contact-sheet-pull 겹쳐 돌 때 한 번만 공유", () => {
  it("10:00 에 daily·share 크론이 같이 돌아도 outbox 는 1건", async () => {
    const db = fakeRest();
    const now = kst("2026-10-31T10:00");
    const [a, b] = await Promise.all([
      shareNewChanges("k", "https://x/rest/v1", { nowMs: now, fetchFn: db.fetchFn }),
      shareNewChanges("k", "https://x/rest/v1", { nowMs: now, fetchFn: db.fetchFn }),
    ]);
    expect(db.outbox).toHaveLength(1);
    expect(db.outbox[0].room).toBe("강북A 점검방");
    expect(db.outbox[0].text).toContain("테스트상사");
    expect(a.shared + b.shared).toBe(1);
    expect(a.claimedElsewhere + b.claimedElsewhere).toBe(1);
    expect(db.changes[0].shared_at).not.toBeNull();
  });
  it("outbox 넣기가 실패하면 잡기를 되돌려 다음 실행이 다시 보낸다", async () => {
    const db = fakeRest({ outboxFails: true });
    const r = await shareNewChanges("k", "https://x/rest/v1", { nowMs: kst("2026-10-31T11:00"), fetchFn: db.fetchFn });
    expect(r.shared).toBe(0);
    expect(r.skipped).toBe(1);
    expect(db.changes[0].shared_at).toBeNull();
    expect(db.changes[0].shared_room).toBe("");
  });
});

describe("insertInChunks — 57014 이면 반으로 쪼개 다시", () => {
  const timeout = () => new Error('POST /kakao_messages → 500: {"code":"57014","message":"canceling statement due to statement timeout"}');
  it("isStatementTimeout", () => {
    expect(isStatementTimeout(timeout())).toBe(true);
    expect(isStatementTimeout(new Error("23505 duplicate key"))).toBe(false);
  });
  it("큰 묶음이 시간 초과면 쪼개 모두 넣는다", async () => {
    const rows = Array.from({ length: 600 }, (_, i) => i);
    const sizes: number[] = [];
    const n = await insertInChunks(rows, async (chunk) => {
      if (chunk.length > 100) throw timeout(); // 100행 넘으면 8초 초과라고 가정
      sizes.push(chunk.length);
      return chunk.length;
    }, { size: 250, minSize: 25 });
    expect(n).toBe(600);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(100);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(600);
  });
  it("시간 초과가 아닌 오류는 그대로 던진다", async () => {
    await expect(insertInChunks([1, 2, 3], async () => { throw new Error("403 forbidden"); })).rejects.toThrow("403");
  });
  it("최소 크기에서도 시간 초과면 던진다(무한 쪼개기 없음)", async () => {
    let calls = 0;
    await expect(insertInChunks(Array.from({ length: 100 }, (_, i) => i), async () => { calls += 1; throw timeout(); }, { size: 100, minSize: 25 })).rejects.toThrow("57014");
    expect(calls).toBeLessThan(10);
  });
});
