// 2026-10-21 버그 재발 방지: 7일 세션이 켜 둔 화면에서 만료되면 작성자 고르기·인원 선택 창이 되살아나던 문제
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorLocked, parseSsoSession } from "../src/sso";
import { decideBootView } from "../src/ssoBoot";

const user = { sub: "1", username: "u", name: "홍길동", empNo: "1", department: "CS", position: "", email: "", role: "STAFF" };
const loginAt = Date.parse("2026-10-14T09:00:00+09:00");
const raw = JSON.stringify({ user, at: new Date(loginAt).toISOString(), exp: loginAt + 7 * 24 * 3600_000 });

describe("그룹웨어 세션 만료", () => {
  it("10/14 09시 로그인은 10/21 08시엔 살아 있고 10/21 10시엔 만료", () => {
    expect(parseSsoSession(raw, Date.parse("2026-10-21T08:00:00+09:00"))?.user.name).toBe("홍길동");
    expect(parseSsoSession(raw, Date.parse("2026-10-21T10:00:00+09:00"))).toBeNull();
  });
  it("12시간짜리 옛 exp 도 로그인 시각 + 7일로 늘려 본다", () => {
    const old = JSON.stringify({ user, at: new Date(loginAt).toISOString(), exp: loginAt + 12 * 3600_000 });
    expect(parseSsoSession(old, Date.parse("2026-10-18T09:00:00+09:00"))).not.toBeNull();
  });
  it("깨진 값·빈 값은 세션 없음", () => {
    expect(parseSsoSession(null, Date.now())).toBeNull();
    expect(parseSsoSession("{", Date.now())).toBeNull();
  });
});

describe("첫 화면 분기", () => {
  const base = { publicPage: false, hasSession: true, ssoError: "" };
  it("잠금 + 세션 만료면 본 앱이 아니라 그룹웨어 재로그인", () => {
    expect(decideBootView({ ...base, required: "on", hasSession: false })).toBe("login");
    expect(decideBootView({ ...base, required: "on", hasSession: false, ssoError: "실패" })).toBe("gate");
  });
  it("스위치 값을 아직 모르는 새 기기는 본 앱(작성자 고르기)을 그리지 않고 기다린다", () => {
    expect(decideBootView({ ...base, required: "unknown", hasSession: false })).toBe("wait-config");
  });
  it("잠금 + 세션 있음, 또는 잠금 꺼짐이면 본 앱", () => {
    expect(decideBootView({ ...base, required: "on" })).toBe("app");
    expect(decideBootView({ ...base, required: "off", hasSession: false })).toBe("app");
  });
  it("앨범·사진 링크는 로그인과 무관", () => {
    expect(decideBootView({ ...base, publicPage: true, required: "on", hasSession: false })).toBe("public");
  });
});

describe("작성자 고정", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const store = (m: Record<string, string>) => ({ getItem: (k: string) => (k in m ? m[k] : null) });
  it("잠금이 켜져 있으면 세션이 만료돼도 작성자 고르기를 되살리지 않는다", () => {
    vi.stubGlobal("localStorage", store({ cs_sso_required_v1: "1" })); // 세션 키 없음 = 만료/삭제
    expect(authorLocked()).toBe(true);
  });
  it("잠금이 꺼져 있으면 예전처럼 고른다", () => {
    vi.stubGlobal("localStorage", store({ cs_sso_required_v1: "0" }));
    expect(authorLocked()).toBe(false);
  });
});
