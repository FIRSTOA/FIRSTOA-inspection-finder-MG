import { describe, expect, it } from "vitest";
import { askMask, askMaskText, isPhoneKey, maskPhoneText } from "../supabase/functions/_shared/ask/mask";

// 통합검색 가림 — 설계 4장 2·결정 Q2(휴대폰 가운데 4자리 기본 가림)
describe("askMask", () => {
  it("주민번호(글 속·거래처 코드 칸 통째)", () => {
    expect(askMaskText("고객 900101-1234567 확인")).toBe("고객 900101-1****** 확인");
    expect(askMaskText("9001011234567", "거래처코드")).toBe("900101-1******");
    // 이름표 없는 붙은 13자리는 기기 시리얼일 수 있어 그대로
    expect(askMaskText("시리얼 8001104123456")).toBe("시리얼 8001104123456");
  });

  it("휴대폰 가운데 4자리 — 글 속에서도", () => {
    expect(askMaskText("담당 010-1234-5678 연락")).toBe("담당 010-****-5678 연락");
    expect(askMaskText("01012345678")).toContain("****");
  });

  it("계좌(이름표 뒤 끝 4자리만)·카드(묶음 전부)", () => {
    const a = askMaskText("계좌 국민 123456-01-234567 입금");
    expect(a).toContain("4567");
    expect(a).not.toContain("123456-01");
    expect(askMaskText("카드 1234-5678-9012-3456")).toBe("카드 ****-****-****-****");
  });

  it("전화 칸은 일반전화·대표번호도 가운데를 가린다", () => {
    expect(isPhoneKey("일반전화")).toBe(true);
    expect(isPhoneKey("rep_phone")).toBe(true);
    expect(isPhoneKey("tel")).toBe(true);
    expect(isPhoneKey("작성자")).toBe(false);
    expect(askMaskText("02-123-4567", "일반전화")).toBe("02-***-4567");
    expect(maskPhoneText("031 1234 5678")).toBe("031 **** 5678");
    // 전화 칸이 아니면 일반전화 모양 숫자(기번 등)는 건드리지 않는다
    expect(askMaskText("02-123-4567", "자산기번")).toBe("02-123-4567");
  });

  it("행·배열 통째 — 칸 이름 문맥, 숫자·null 그대로, 원본 불변", () => {
    const row = { 휴대폰번호: "010-9876-5432", 미수잔액: 120000, 메모: "주민 900101-2345678", 거래처코드: "9001012345678", 빈칸: null, rows: [{ actual: "010 1111 2222 연락" }] };
    const out = askMask(row);
    expect(out.휴대폰번호).toBe("010-****-5432");
    expect(out.미수잔액).toBe(120000);
    expect(out.메모).toContain("900101-2******");
    expect(out.거래처코드).toBe("900101-2******");
    expect(out.빈칸).toBeNull();
    expect(out.rows[0].actual).toContain("****");
    expect(row.휴대폰번호).toBe("010-9876-5432");
  });
});
