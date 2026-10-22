/**
 * 불만·재계약·초과조정(isCat) 양식 — 보낸 뒤 비우기(2026-10-22 "보내고 나면 비워져야 하지 않나").
 * 원인: App.tsx isCat 분기가 `return Boolean(res.ok)` 로 먼저 끝나 resetAfterSend() 에 닿지 않았다.
 * 지키는 것: ① isCat 분기가 성공(res.ok)일 때만 return 앞에서 resetAfterSend() 를 부른다
 *          ② resetAfterSend 가 catForms 를 emptyCatForm 으로, 사진을 clearPhotos 로 비운다
 *          ③ 양식을 비워도 재계약 "일정 만들까요?" 제안(localStorage)은 보낸 값 그대로 남는다.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyCatForm } from "../src/categoryForms";
import { emitCategorySent } from "../src/categorySentEvent";
import { readScheduleOffer, SCHEDULE_OFFER_KEY } from "../src/recontractSchedule";

const APP = readFileSync(resolve(__dirname, "../src/App.tsx"), "utf8").replace(/\r\n/g, "\n");

function catBranch(): string {
  const start = APP.indexOf("if (isCat) {\n      const res = await sendCategoryForm(");
  expect(start).toBeGreaterThan(-1);
  const end = APP.indexOf("return Boolean(res.ok);", start);
  expect(end).toBeGreaterThan(start);
  return APP.slice(start, end);
}

describe("isCat 전송 뒤 비우기(App.tsx 흐름)", () => {
  it("성공일 때만 return 앞에서 resetAfterSend() 를 부른다", () => {
    expect(catBranch()).toMatch(/if \(res\.ok\) resetAfterSend\(\);/);
  });
  it("resetAfterSend 가 카테고리 양식과 사진을 비운다", () => {
    const s = APP.indexOf("const resetAfterSend = () => {");
    const body = APP.slice(s, APP.indexOf("\n  };", s));
    expect(body).toMatch(/clearPhotos\(\[mode\]\)/);
    expect(body).toMatch(/if \(isCat\) setCatForms\(\(prev\) => \(\{ \.\.\.prev, \[mode\]: emptyCatForm\(mode\) \}\)\)/);
  });
  it("emptyCatForm 은 재계약 모든 칸을 빈 값으로 만든다", () => {
    const f = emptyCatForm("recontract");
    expect(Object.keys(f)).toContain("다음확인일");
    expect(Object.values(f).every((v) => v === "")).toBe(true);
  });
});

describe("양식을 비워도 재계약 일정 제안은 남는다", () => {
  const mem = new Map<string, string>();
  beforeEach(() => {
    mem.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => { mem.set(k, String(v)); },
      removeItem: (k: string) => { mem.delete(k); },
      clear: () => mem.clear(), key: () => null, get length() { return mem.size; },
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("보낸 form 을 나중에 비워도(같은 객체를 지워도) 제안의 다음확인일이 그대로다", () => {
    const form: Record<string, string> = { ...emptyCatForm("recontract"), 업체명: "보림토건(주)", 다음확인일: "2026-10-29" };
    emitCategorySent({ schemaKey: "recontract", form, author: "이민구", dupKey: "d1", text: "본문", testMode: true });
    for (const k of Object.keys(form)) form[k] = ""; // App 이 양식을 비운 상황
    expect(mem.has(SCHEDULE_OFFER_KEY)).toBe(true);
    const offer = readScheduleOffer();
    expect(offer?.form["다음확인일"]).toBe("2026-10-29");
    expect(offer?.form["업체명"]).toBe("보림토건(주)");
  });
});
