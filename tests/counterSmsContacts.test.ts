import { describe, expect, it } from "vitest";
import { contactChoices, contactVendorKey, normalizePhone, pickDefaultPhone, rulesForVendor, ruleStamp, type ContactRule } from "../src/counterSmsContacts";

const rule = (over: Partial<ContactRule>): ContactRule => ({
  id: "r", vendor_key: contactVendorKey("N 주식회사 무암 (Mooam)-"), vendor: "N 주식회사 무암 (Mooam)-", phone: "01044816440",
  kind: "block", name: "", memo: "", updated_by: "이민구", updated_at: "2026-09-16T01:00:00.000Z", ...over,
});

describe("contactVendorKey — 표기가 달라도 같은 업체", () => {
  it("파서 등급 접두·순번·법인표기·영문 괄호를 벗겨 같은 키", () => {
    const a = contactVendorKey("N 주식회사 무암 (Mooam)-");
    expect(a).toBe(contactVendorKey("17N주식회사 무암 (Mooam)-분기마감"));
    expect(a).toBe(contactVendorKey("무암"));
    expect(contactVendorKey("V 웰스매니지먼트 주식회사")).toBe(contactVendorKey("16N웰스매니지먼트 주식회사"));
  });
  it("다른 업체는 다른 키", () => {
    expect(contactVendorKey("N 무암")).not.toBe(contactVendorKey("N 무암테크"));
  });
});

describe("contactChoices / pickDefaultPhone", () => {
  const phones = ["01044816440", "01011112222"];
  const labels = { "01044816440": "현해리대표님" };
  it("규칙이 없으면 파싱된 번호 그대로, 첫 번호가 기본", () => {
    const choices = contactChoices(phones, labels, []);
    expect(choices.map((c) => c.phone)).toEqual(phones);
    expect(choices[0].label).toBe("현해리대표님");
    expect(pickDefaultPhone(choices)).toBe("01044816440");
  });
  it("보내지 말 것(block) 번호는 뒤로 밀리고 기본 선택에서 빠진다", () => {
    const choices = contactChoices(phones, labels, [rule({ kind: "block", memo: "퇴사" })]);
    expect(choices[0].phone).toBe("01011112222");
    expect(choices[1].blocked?.memo).toBe("퇴사");
    expect(pickDefaultPhone(choices)).toBe("01011112222");
  });
  it("새 담당(prefer) 번호는 목록에 없어도 맨 앞에 붙고 기본 선택이 된다 — 이름은 규칙에서", () => {
    const choices = contactChoices(phones, labels, [rule({ kind: "prefer", phone: "010-9999-0000", name: "김철수 과장" })]);
    expect(choices[0]).toMatchObject({ phone: "01099990000", label: "김철수 과장" });
    expect(choices[0].preferred?.name).toBe("김철수 과장");
    expect(pickDefaultPhone(choices)).toBe("01099990000");
  });
  it("전부 차단이면 기본 선택 없음 — 화면이 경고를 띄운다", () => {
    const choices = contactChoices(["01044816440"], labels, [rule({ kind: "block" })]);
    expect(pickDefaultPhone(choices)).toBe("");
  });
});

describe("rulesForVendor / normalizePhone / ruleStamp", () => {
  it("업체 키로 규칙을 고른다", () => {
    const rules = [rule({}), rule({ id: "x", vendor_key: contactVendorKey("다른업체"), vendor: "다른업체" })];
    expect(rulesForVendor(rules, "17N주식회사 무암 (Mooam)-분기마감")).toHaveLength(1);
    expect(rulesForVendor(rules, "S 다른업체")).toHaveLength(1);
    expect(rulesForVendor(rules, "")).toHaveLength(0);
  });
  it("번호는 숫자만, 기록 꼬리표는 '월/일 이름'", () => {
    expect(normalizePhone("010-4481-6440")).toBe("01044816440");
    expect(ruleStamp(rule({}))).toBe("9/16 이민구");
  });
});
