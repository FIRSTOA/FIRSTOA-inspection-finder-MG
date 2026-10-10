import { describe, expect, it } from "vitest";
import { buildCounterCaption } from "../src/counterSmsPhoto";

const target = { id: "csb-1-003", vendor: "V (주)잡플러스4층백업", team: "C", machines: ["X7-시리즈"], lease_code: "21638", serials: ["ZPBLBJST8000GQV"], assets: ["A5571"], list_kind: "", cms_day: null };

describe("마감 카운터 사진 — 글 만들기", () => {
  it("업체·기종·시리얼·자산·임대코드·주소·전송자 순으로, 등급 접두는 뗀다", () => {
    const text = buildCounterCaption(target, { author: "이민구", info: { address: "서울 광진구 천호대로 537, 15층", model: "SL-X7400LXR" }, now: new Date("2026-10-10T06:30:00Z") });
    expect(text.split("\n")).toEqual([
      "[마감 카운터] (주)잡플러스4층백업",
      "기종: SL-X7400LXR",
      "시리얼: ZPBLBJST8000GQV",
      "자산기번: A5571",
      "임대코드: 21638",
      "주소: 서울 광진구 천호대로 537, 15층",
      "전송: 이민구 · 2026-10-10 15:30 · C팀",
      "카운터 사진 첨부",
    ]);
  });
  it("봇으로 보낼 땐 사진 링크 줄, CMS 는 결제일 표시, 없는 항목은 뺀다", () => {
    const text = buildCounterCaption({ ...target, serials: [], assets: [], lease_code: null, list_kind: "CMS", cms_day: 15 }, { author: "", info: {}, now: new Date("2026-10-10T06:30:00Z"), withLink: "https://x/y.jpg" });
    expect(text).toContain("[마감 카운터] (주)잡플러스4층백업 (CMS 15일)");
    expect(text).toContain("기종: X7-시리즈");       // 임대리스트 기종이 없으면 파서 기종
    expect(text).not.toContain("시리얼:");
    expect(text).not.toContain("주소:");
    expect(text).toContain("전송: 미지정");
    expect(text.trim().endsWith("사진: https://x/y.jpg")).toBe(true);
  });
});
