/**
 * GAS 카톡 원문 보내기(apps-script/first-data/src/KakaoRaw.gs) — node 에서 .gs 를 그대로 읽어 검사한다.
 * 2026-10-29·30 "강남C as": 조각 하나가 DB 문장 시간 초과(57014)로 500 이 나면 바로 멈춰 원문이 하루 1~2조각씩만 늘었다.
 * → 시간 초과는 같은 조각을 다시 보내고, 다른 실패(토큰·형식 등)는 지금처럼 바로 멈춘다.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(resolve(__dirname, "../apps-script/first-data/src/KakaoRaw.gs"), "utf8");

type Reply = { code: number; body: Record<string, unknown> };
type Out = { ok: boolean; sent: number; chunks: number; total: number; error: string };

/** 엣지 응답을 차례로 돌려주는 가짜 UrlFetchApp. 첫 호출은 mode:'last'(마지막 적재 시각) */
function load(replies: Reply[]) {
  const calls: Array<Record<string, unknown>> = [];
  const sleeps: number[] = [];
  const UrlFetchApp = {
    fetch: (_url: string, opt: { payload: string }) => {
      calls.push(JSON.parse(opt.payload));
      const r = replies.shift() ?? { code: 200, body: { ok: true, inserted: 0 } };
      return { getResponseCode: () => r.code, getContentText: () => JSON.stringify(r.body) };
    },
  };
  const PropertiesService = { getScriptProperties: () => ({ getProperty: () => "tok" }) };
  const Utilities = { sleep: (ms: number) => { sleeps.push(ms); } };
  const push = new Function("UrlFetchApp", "PropertiesService", "Utilities", "SUPABASE_URL", "SUPABASE_ANON",
    src + "\nreturn pushRawMessages_;")(UrlFetchApp, PropertiesService, Utilities, "https://x.supabase.co", "anon") as
    (room: string, text: string, file: string) => Out;
  return { push, calls, sleeps };
}

const TEXT = "강남C as 님과 카카오톡 대화\n\n--------------- 2023년 11월 28일 화요일 ---------------\n[홍길동] [오전 10:01] 접수합니다";
const TIMEOUT: Reply = { code: 500, body: { ok: false, error: 'POST /kakao_messages → 500: {"code":"57014","details":null,"hint":null,"message":"canceling statement due to statement timeout"}' } };
const LAST: Reply = { code: 200, body: { ok: true, last_to_at: null } };

describe("pushRawMessages_ 조각 재시도", () => {
  it("DB 시간 초과(57014)는 같은 조각을 다시 보내 성공한다", () => {
    const { push, calls, sleeps } = load([LAST, TIMEOUT, { code: 200, body: { ok: true, inserted: 1 } }]);
    const out = push("강남C as", TEXT, "강남C as_20261030.txt");
    expect(out.ok).toBe(true);
    expect(out.sent).toBe(1);
    expect(calls.filter((c) => c.chunk_index === 0)).toHaveLength(2);
    expect(sleeps.length).toBe(1);
  });
  it("계속 시간 초과면 정해진 횟수만 다시 보내고 실패를 돌려준다", () => {
    const { push, calls } = load([LAST, TIMEOUT, TIMEOUT, TIMEOUT, TIMEOUT]);
    const out = push("강남C as", TEXT, "f.txt");
    expect(out.ok).toBe(false);
    expect(out.error).toContain("1/1조각 실패");
    expect(calls.filter((c) => c.chunk_index === 0)).toHaveLength(3); // 처음 1 + 재시도 2
  });
  it("시간 초과가 아닌 실패(토큰 등)는 다시 보내지 않는다", () => {
    const { push, calls, sleeps } = load([LAST, { code: 401, body: { ok: false, error: "토큰 불일치" } }]);
    const out = push("강남C as", TEXT, "f.txt");
    expect(out.ok).toBe(false);
    expect(calls.filter((c) => c.chunk_index === 0)).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });
});
