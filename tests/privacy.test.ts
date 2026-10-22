import { describe, expect, it } from "vitest";
import { isRrnKey, maskCode, maskDeep, maskRrn, maskRrnValue } from "../src/privacy";

// 2026-10-22 주민번호 가림 — 임대리스트 '거래처 코드' 칸에 개인 고객 주민번호(실측 vendor_info 109행·코드 83곳)
describe("maskRrn — 글 속", () => {
  it("하이픈 꼴은 뒤 첫 자리만 남기고 가린다", () => {
    expect(maskRrn("대표 900101-1234567 연락")).toBe("대표 900101-1****** 연락");
    expect(maskRrn("900101 - 2234567")).toBe("900101-2******");
    expect(maskRrn("900101 2234567")).toBe("900101-2******");
    expect(maskRrn("[\"/\", \"원주희(개인)\", \"790327-2123456\"]")).toBe("[\"/\", \"원주희(개인)\", \"790327-2******\"]");
  });
  it("생년 8자리 꼴도", () => {
    expect(maskRrn("생년 19900101-1234567")).toBe("생년 19900101-1******");
    expect(maskRrn("20010101-3234567")).toBe("20010101-3******");
  });
  it("이름표 뒤의 하이픈 없는 13자리는 가린다", () => {
    expect(maskRrn("주민번호: 9001011234567")).toBe("주민번호: 900101-1******");
    expect(maskRrn("거래처 코드 9001012234567")).toBe("거래처 코드 900101-2******");
    expect(maskRrn(JSON.stringify({ "거래처 코드": "9001012234567" }))).toBe("{\"거래처 코드\":\"900101-2******\"}");
  });
  it("이름표 없는 13자리(기기 시리얼)는 그대로 — 점검·AS·접수에 실제로 8001104… 시리얼이 있다", () => {
    expect(maskRrn("8001104123456")).toBe("8001104123456");
    expect(maskRrn("S/N 8001104123456")).toBe("S/N 8001104123456");
    expect(maskRrn("[\"A1234\", \"8001104123456\"]")).toBe("[\"A1234\", \"8001104123456\"]");
  });
  it("전화·사업자번호·긴 계좌·좌표·해시는 건드리지 않는다", () => {
    expect(maskRrn("010-1234-5678")).toBe("010-1234-5678");
    expect(maskRrn("123-45-67890")).toBe("123-45-67890");
    expect(maskRrn("1234567890")).toBe("1234567890");
    expect(maskRrn("12345678901234")).toBe("12345678901234");
    expect(maskRrn("110-900101-1234567")).toBe("110-900101-1234567");
    expect(maskRrn("900101-1234567-01")).toBe("900101-1234567-01");
    expect(maskRrn("37.4806081234567")).toBe("37.4806081234567");
    expect(maskRrn("9999999999999d9999999999fc9af9ef")).toBe("9999999999999d9999999999fc9af9ef");
    expect(maskRrn("900101-5234567")).toBe("900101-5234567");   // 뒤 첫 자리 1~4 만(지시 패턴)
  });
  it("빈 값·숫자", () => {
    expect(maskRrn(null)).toBe("");
    expect(maskRrn(undefined)).toBe("");
    expect(maskRrn(42)).toBe("42");
  });
});

describe("maskRrnValue — 거래처 코드 칸 문맥", () => {
  it("코드 칸이면 하이픈 없는 13자리도 통째 가린다(뒤 첫 자리 무관)", () => {
    expect(maskRrnValue("9001011234567", "거래처 코드")).toBe("900101-1******");
    expect(maskRrnValue(" 900101-1234567 ", "거래처코드")).toBe("900101-1******");
    expect(maskRrnValue("9001015234567", "vendor_code")).toBe("900101-5******");
    expect(maskRrnValue("199001011234567", "code")).toBe("19900101-1******");
    expect(maskCode("6602022123456")).toBe("660202-2******");
  });
  it("사업자번호 10자리·임대 코드 5자리는 그대로", () => {
    expect(maskRrnValue("1234567890", "거래처 코드")).toBe("1234567890");
    expect(maskRrnValue("123-45-67890", "code")).toBe("123-45-67890");
    expect(maskCode("12345")).toBe("12345");
    expect(maskCode("")).toBe("");
  });
  it("코드 칸이 아니면 13자리 시리얼은 그대로", () => {
    expect(maskRrnValue("8001104123456", "시리얼넘버")).toBe("8001104123456");
    expect(maskRrnValue("8001104123456", "serial")).toBe("8001104123456");
  });
  it("isRrnKey", () => {
    for (const k of ["거래처 코드", "거래처코드", "code", "vendor_code", "company_code", "companyCode", "사업자번호", "주민번호"]) expect(isRrnKey(k)).toBe(true);
    for (const k of ["lease_code", "leaseCode", "코드", "한조코드", "시리얼넘버", "serial", "_dupKey"]) expect(isRrnKey(k)).toBe(false);
  });
});

describe("maskDeep — 행 통째", () => {
  it("_raw 안의 거래처 코드까지, 원본은 그대로", () => {
    const row = { id: 1, _업체명: "개인고객", 시리얼넘버: "8001104123456", _raw: { "거래처 코드": "9001011234567", 메모: ["주민 900101-2234567"] }, n: 3, ok: true, x: null };
    const out = maskDeep(row);
    expect(out._raw).toEqual({ "거래처 코드": "900101-1******", 메모: ["주민 900101-2******"] });
    expect(out.시리얼넘버).toBe("8001104123456");
    expect(out.id).toBe(1); expect(out.n).toBe(3); expect(out.ok).toBe(true); expect(out.x).toBeNull();
    expect(row._raw["거래처 코드"]).toBe("9001011234567");
  });
});
