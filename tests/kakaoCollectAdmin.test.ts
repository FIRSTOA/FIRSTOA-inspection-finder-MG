import { describe, expect, it } from "vitest";
import {
  bizDaysAfter, buildCollectRoomInsertSql, buildRoomViews, collectDraftProblem, collectHeadline, collectState, describeGasResult,
  formatKstShort, importLogByRoom, isMissingTableError, missingTableNotices, type CollectRoomRow, type GasCollectStatus,
} from "../src/kakaoCollectApi";
import { GAS_ADMIN_ACTIONS, allowedGasAction, createRateLimiter, gasAdminUrl, redactSecret } from "../supabase/functions/_shared/gas-admin";

const on = { enabled: true, export: true };

describe("collectState 상태 판정", () => {
  // 2026-10-26 = 월요일, 10-23 = 금요일, 10-24·25 = 주말
  it("오늘·어제는 정상", () => {
    expect(collectState(on, "2026-10-26", "2026-10-26")).toBe("ok");
    expect(collectState(on, "2026-10-25", "2026-10-26")).toBe("ok");
  });
  it("금요일 → 월요일은 영업일 1일이라 정상", () => {
    expect(collectState(on, "2026-10-23", "2026-10-26")).toBe("ok");
  });
  it("2~3영업일은 노랑, 4영업일 이상은 빨강", () => {
    expect(collectState(on, "2026-10-22", "2026-10-26")).toBe("warn"); // 금·월 = 2
    expect(collectState(on, "2026-10-21", "2026-10-26")).toBe("warn"); // 목·금·월 = 3
    expect(collectState(on, "2026-10-20", "2026-10-26")).toBe("bad");  // 4
  });
  it("공휴일은 영업일로 세지 않는다(10/9 한글날)", () => {
    // 10/7(수) → 10/12(월): 8·(9 휴일)·12 = 2영업일
    expect(bizDaysAfter("2026-10-07", "2026-10-12")).toBe(2);
    expect(collectState(on, "2026-10-07", "2026-10-12")).toBe("warn");
  });
  it("기록 없음 = 빨강, export=false·enabled=false = 회색", () => {
    expect(collectState(on, null, "2026-10-26")).toBe("bad");
    expect(collectState({ enabled: true, export: false }, null, "2026-10-26")).toBe("off");
    expect(collectState({ enabled: false, export: true }, "2026-10-26", "2026-10-26")).toBe("off");
  });
});

describe("방 줄·머리 한 줄", () => {
  const table: CollectRoomRow[] = [
    { room: "강서B 점검방", kinds: ["점검"], region: "B", enabled: true, export: true, structured: true, keep_raw: true, sort_order: 11, note: null },
    { room: "강북A 점검방", kinds: ["점검"], region: "A", enabled: true, export: true, structured: true, keep_raw: true, sort_order: 10, note: null },
    { room: "부품요청", kinds: ["부품"], region: "*", enabled: false, export: false, structured: false, keep_raw: false, sort_order: 90, note: null },
  ];
  const gas: GasCollectStatus = {
    ok: true,
    rooms: [
      { room: "강북A 점검방", last_import_at: "2026-10-25T22:12:00.000Z", held: 0 }, // KST 10/26 07:12
      { room: "강서B 점검방", last_import_at: "2026-10-20T01:00:00.000Z", held: 2 },
    ],
    held_total: 2, held_names: ["x.txt", "y.txt"], last_run: { at: "2026-10-25T22:12:00.000Z" },
  };
  const log = [
    { room: "강서B 점검방", to_at: "2026-10-22T03:00:00Z", status: "ok", created_at: "2026-10-22T04:00:00Z" },
    { room: "강서B 점검방", to_at: "2026-10-26T03:00:00Z", status: "error", created_at: "2026-10-26T04:00:00Z" },
  ];

  it("표 순서(sort_order)대로, 원문 최근 글은 error 줄을 빼고", () => {
    const v = buildRoomViews(table, gas, log, "2026-10-26");
    expect(v.map((r) => r.room)).toEqual(["강북A 점검방", "강서B 점검방", "부품요청"]);
    expect(v[1].lastRawAt).toBe("2026-10-22T03:00:00Z");
    expect(v[1].held).toBe(2);
    // 오늘 줄은 error 라 들어온 것으로 치지 않는다 → 마지막 = 10/22(목) → 금·월 2영업일 = 노랑
    expect(v[1].lastSeenYmd).toBe("2026-10-22");
    expect(v[1].state).toBe("warn");
    expect(v[1].recent).toHaveLength(2);
    expect(v[0].state).toBe("ok");
    expect(v[2].state).toBe("off");
  });

  it("머리 한 줄: 분모는 회색(수집 안 함) 방을 뺀다", () => {
    const v = buildRoomViews(table, gas, [], "2026-10-26");
    const h = collectHeadline(v, gas, null, "2026-10-26");
    expect(h.activeRooms).toBe(2);
    expect(h.todayRooms).toBe(1);
    expect(h.heldCount).toBe(2);
    expect(h.text).toBe("마지막 적재 10/26 07:12 · 확인필요 2 · 오늘 들어온 방 1/2");
  });

  it("표가 없으면 GAS 방 목록으로 대신", () => {
    const v = buildRoomViews(null, gas, [], "2026-10-26");
    expect(v.map((r) => r.room)).toEqual(["강북A 점검방", "강서B 점검방"]);
  });

  it("기록이 하나도 없으면 '기록 없음'", () => {
    expect(collectHeadline([], null, null, "2026-10-26").text).toBe("마지막 적재 기록 없음 · 확인필요 0 · 오늘 들어온 방 0/0");
  });

  it("importLogByRoom 은 최근 5줄만", () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ room: "r", to_at: null, status: "ok", created_at: `2026-10-2${i}T00:00:00Z` }));
    const by = importLogByRoom(rows);
    expect(by.r.recent).toHaveLength(5);
    expect(by.r.recent[0].created_at).toBe("2026-10-26T00:00:00Z");
  });

  it("formatKstShort", () => {
    expect(formatKstShort("2026-10-24T22:12:00Z")).toBe("10/25 07:12");
    expect(formatKstShort(null)).toBe("-");
    expect(formatKstShort("엉터리")).toBe("-");
  });
});

describe("404 때 안내", () => {
  it("표 없음 판정", () => {
    expect(isMissingTableError("조회 실패 kakao_collect_rooms(404): {\"code\":\"PGRST205\"}")).toBe(true);
    expect(isMissingTableError("relation \"public.kakao_import_log\" does not exist")).toBe(true);
    expect(isMissingTableError("조회 실패 kakao_collect_rooms(401): JWT")).toBe(false);
  });
  it("SQL 실행 대기 안내 문구", () => {
    expect(missingTableNotices(false, false)).toEqual([]);
    const n = missingTableNotices(true, true);
    expect(n).toHaveLength(2);
    expect(n[0]).toContain("SQL 실행 대기");
    expect(n[0]).toContain("supabase/kakao-collect-rooms-20261024.sql");
    expect(n[1]).toContain("supabase/kakao-messages-20261024.sql");
  });
});

describe("방 추가 SQL", () => {
  it("작은따옴표를 두 번, 모르는 종류는 뺀다, 지역 없으면 null", () => {
    expect(buildCollectRoomInsertSql({ room: " 완료방(납품,철수,교체) ", kinds: ["물류"], region: "*" }))
      .toBe("insert into public.kakao_collect_rooms (room, kinds, region, sort_order) values ('완료방(납품,철수,교체)', array['물류']::text[], '*', 100) on conflict (room) do nothing;");
    expect(buildCollectRoomInsertSql({ room: "O'Neil 방", kinds: ["점검", "AS", "엉뚱"], region: "" }))
      .toBe("insert into public.kakao_collect_rooms (room, kinds, region, sort_order) values ('O''Neil 방', array['점검','AS']::text[], null, 100) on conflict (room) do nothing;");
  });
  it("빈 이름·종류 없음은 막는다", () => {
    expect(collectDraftProblem({ room: " ", kinds: ["점검"] })).not.toBe("");
    expect(collectDraftProblem({ room: "a", kinds: [] })).not.toBe("");
    expect(collectDraftProblem({ room: "a", kinds: ["점검"] })).toBe("");
  });
});

describe("GAS 동작 결과", () => {
  it("GAS 403 본문은 실패로", () => {
    const r = describeGasResult("ingestnow", { ok: false, status: 403, error: "forbidden" });
    expect(r.ok).toBe(false);
    expect(r.text).toContain("관리 토큰");
  });
  it("성공 요약", () => {
    expect(describeGasResult("retryheld", { ok: true, moved: 3 }).text).toContain("3개");
    expect(describeGasResult("kakaoclear", { ok: true, removed: 1, remaining: 0 }).ok).toBe(true);
  });
});

describe("gas-admin 엣지 규칙(_shared/gas-admin)", () => {
  it("허용 목록은 세 개뿐", () => {
    expect([...GAS_ADMIN_ACTIONS]).toEqual(["ingestnow", "retryheld", "kakaoclear"]);
    expect(allowedGasAction(" IngestNow ")).toBe("ingestnow");
    for (const bad of ["celltrim", "dedupe", "seenreset", "cursorreset", "rebuildindex", "contactpeek", "photoarchive", "", null, undefined]) {
      expect(allowedGasAction(bad)).toBeNull();
    }
  });
  it("분당 5회, 1분 지나면 풀림, IP 따로", () => {
    const lim = createRateLimiter(5);
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) expect(lim.hit("1.1.1.1", t0 + i)).toBe(false);
    expect(lim.hit("1.1.1.1", t0 + 10)).toBe(true);
    expect(lim.hit("2.2.2.2", t0 + 10)).toBe(false);
    expect(lim.hit("1.1.1.1", t0 + 60_001)).toBe(false);
  });
  it("주소에 토큰을 인코딩해 붙이고, 응답에서는 가린다", () => {
    expect(gasAdminUrl("https://g/exec", "ingestnow", "a b&c")).toBe("https://g/exec?action=ingestnow&token=a%20b%26c");
    expect(redactSecret('{"url":"x?token=s3cr3t&y","raw":"s3cr3t"}', "s3cr3t")).toBe('{"url":"x?token=***&y","raw":"***"}');
    expect(redactSecret("a%20b%26c 그리고 a b&c", "a b&c")).toBe("*** 그리고 ***");
    expect(redactSecret("abc", "")).toBe("abc");
  });
});
