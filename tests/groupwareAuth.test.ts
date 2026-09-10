import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAuthorizeUrl, parseCallback, verifyToken } from "../src/groupwareAuth";

// 그룹웨어 SSO 연동 — 명세(firstoa-groupware 안내 페이지) 기준 고정 테스트.
// 네트워크 없이 도는 순수 함수와, fetch를 흉내 낸 userinfo 검증만 다룬다.

describe("buildAuthorizeUrl", () => {
  it("authorize 주소에 redirect_uri·state를 인코딩해 붙인다", () => {
    const url = buildAuthorizeUrl("https://firstoa-inspection-finder-mg.vercel.app/", "abc123");
    expect(url.startsWith("https://firstoa-groupware.vercel.app/sso/authorize?")).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get("redirect_uri")).toBe("https://firstoa-inspection-finder-mg.vercel.app/");
    expect(params.get("state")).toBe("abc123");
  });
});

describe("parseCallback", () => {
  it("token·state가 없으면 평소 진입(none)", () => {
    expect(parseCallback("", "saved")).toEqual({ kind: "none" });
    expect(parseCallback("?album=xyz", null)).toEqual({ kind: "none" });
  });

  it("state가 저장값과 같고 token이 있으면 ok", () => {
    expect(parseCallback("?token=JWT.here&state=s1", "s1")).toEqual({ kind: "ok", token: "JWT.here" });
  });

  it("state가 다르거나 저장값이 없으면 거부(state-mismatch) — CSRF 방어", () => {
    expect(parseCallback("?token=JWT&state=evil", "s1")).toEqual({ kind: "state-mismatch" });
    expect(parseCallback("?token=JWT&state=s1", null)).toEqual({ kind: "state-mismatch" });
    expect(parseCallback("?token=JWT", "s1")).toEqual({ kind: "state-mismatch" });
  });

  it("state는 맞는데 token이 없으면 no-token", () => {
    expect(parseCallback("?state=s1", "s1")).toEqual({ kind: "no-token" });
  });

  it("네이버 캘린더 콜백(state=firstoa&code=…)은 우리 저장 state와 달라 섞이지 않는다", () => {
    // main.tsx는 token이 있을 때만 우리 콜백으로 본다. 여기서는 파서 단독 동작만 고정.
    expect(parseCallback("?code=n1&state=firstoa", "s1")).toEqual({ kind: "state-mismatch" });
  });
});

describe("verifyToken (userinfo)", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const user = { sub: "u1", username: "hong", name: "홍길동", empNo: "2024001", department: "CS팀", position: "과장", email: "hong@firstoa.co.kr", role: "STAFF", mustChangePassword: false };

  it("200 {ok:true,user} → user 반환, 토큰은 쿼리와 Bearer 헤더 양쪽으로 전달", async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      expect(input).toBe("https://firstoa-groupware.vercel.app/sso/userinfo?token=T1");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer T1");
      return new Response(JSON.stringify({ ok: true, user }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(verifyToken("T1")).resolves.toEqual(user);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("401 {ok:false} → null (만료/무효 토큰)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 401 })));
    await expect(verifyToken("expired")).resolves.toBeNull();
  });

  it("200이라도 ok:true·user가 없으면 null — 응답 형태를 믿지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    await expect(verifyToken("weird")).resolves.toBeNull();
  });

  it("네트워크 실패 → null (앱은 로그인 안 된 상태로 그대로 뜬다)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(verifyToken("T")).resolves.toBeNull();
  });
});
