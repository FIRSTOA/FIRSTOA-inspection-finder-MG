import { describe, expect, it } from "vitest";
import { checkCallback, SSO_CALLBACK_PATH } from "../src/sso";

const saved = JSON.stringify({ state: "abc123", returnTo: "/?tab=okr" });

describe("그룹웨어 SSO 콜백 판정", () => {
  it("콜백 주소도 아니고 토큰도 없으면 아무것도 하지 않는다", () => {
    expect(checkCallback("/", "?album=x", null)).toEqual({ kind: "none" });
    expect(checkCallback("/", "?state=firstoa&code=naver", null)).toEqual({ kind: "none" });
  });
  it("state가 보관한 값과 같을 때만 토큰을 믿고, 원래 있던 화면으로 돌려보낸다", () => {
    expect(checkCallback(SSO_CALLBACK_PATH, "?token=T.T.T&state=abc123", saved)).toEqual({ kind: "ok", token: "T.T.T", returnTo: "/?tab=okr" });
  });
  it("state가 다르거나 없으면 거절한다(다른 브라우저·위조)", () => {
    expect(checkCallback(SSO_CALLBACK_PATH, "?token=T&state=zzz", saved).kind).toBe("error");
    expect(checkCallback(SSO_CALLBACK_PATH, "?token=T&state=abc123", null).kind).toBe("error");
  });
  it("토큰 없이 콜백으로 오면 오류 + 원래 화면", () => {
    const r = checkCallback(SSO_CALLBACK_PATH, "", saved);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.returnTo).toBe("/?tab=okr");
  });
  it("돌아갈 곳이 콜백 자신이거나 바깥 주소면 첫 화면으로", () => {
    const loop = JSON.stringify({ state: "s", returnTo: SSO_CALLBACK_PATH });
    const ext = JSON.stringify({ state: "s", returnTo: "https://evil.example/" });
    const prot = JSON.stringify({ state: "s", returnTo: "//evil.example/" });
    expect(checkCallback(SSO_CALLBACK_PATH, "?token=T&state=s", loop)).toMatchObject({ kind: "ok", returnTo: "/" });
    expect(checkCallback(SSO_CALLBACK_PATH, "?token=T&state=s", ext)).toMatchObject({ kind: "ok", returnTo: "/" });
    expect(checkCallback(SSO_CALLBACK_PATH, "?token=T&state=s", prot)).toMatchObject({ kind: "ok", returnTo: "/" });
  });
});
