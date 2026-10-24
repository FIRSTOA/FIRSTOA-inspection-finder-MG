import { describe, expect, it } from "vitest";
import {
  guessKind, hashSource, luhnOk, maskKakaoText, parseKakaoHeader, parseKakaoText, sha256Hex, to24h, toRows, utf8Bytes,
} from "../supabase/functions/_shared/kakao-parse";

// 실제 카톡 내보내기(PC·모바일 대괄호형) 모양 — 이름·번호는 가짜
const BRACKET_TXT = [
  "강남C 점검방 님과 카카오톡 대화",
  "저장한 날짜 : 2026-10-24 09:12:03",
  "",
  "--------------- 2026년 10월 23일 목요일 ---------------",
  "이민구님이 김철수님을 초대했습니다.",
  "[이민구] [오후 2:31] 무암 점검 완료",
  "매수 12,340",
  "토너 K 30%",
  "[김철수] [오후 2:31] 네",
  "[김철수] [오후 2:31] 네",
  "[이민구] [오전 12:05] 자정 넘어 보낸 글",
  "[이민구] [오후 12:40] 점심 글",
  "2026년 10월 24일 금요일",
  "[박영희] [오전 9:03] 고객 연락처 010-1234-5678 주민 900101-1234567",
].join("\n");

describe("kakao-parse — 형식", () => {
  it("파일 머리에서 방 이름·저장 날짜", () => {
    expect(parseKakaoHeader(BRACKET_TXT)).toEqual({ room: "강남C 점검방", savedAt: "2026-10-24 09:12:03" });
  });

  it("12시간제 → 24시간(오전 12시 = 00시, 오후 12시 = 12시)", () => {
    expect(to24h("오후", 2, 31)).toBe("14:31");
    expect(to24h("오전", 12, 5)).toBe("00:05");
    expect(to24h("오후", 12, 40)).toBe("12:40");
    expect(to24h(undefined, 9, 3)).toBe("09:03");
    expect(to24h("오후", 2, 61)).toBe("");
  });

  it("대괄호형: 날짜 띠(띠 없는 날짜 줄 포함)·여러 줄 본문·안내 줄 제외·같은 분 seq/dupN", () => {
    const ms = parseKakaoText(BRACKET_TXT);
    expect(ms.map((m) => [m.date, m.time, m.author])).toEqual([
      ["2026-10-23", "14:31", "이민구"],
      ["2026-10-23", "14:31", "김철수"],
      ["2026-10-23", "14:31", "김철수"],
      ["2026-10-23", "00:05", "이민구"],
      ["2026-10-23", "12:40", "이민구"],
      ["2026-10-24", "09:03", "박영희"],
    ]);
    expect(ms[0].room).toBe("강남C 점검방");
    expect(ms[0].text).toBe("무암 점검 완료\n매수 12,340\n토너 K 30%");
    expect(ms[0].sentAt).toBe("2026-10-23T14:31:00+09:00");
    // 같은 분 순서
    expect(ms.slice(0, 3).map((m) => m.seq)).toEqual([1, 2, 3]);
    // "네" 연타 — 같은 분·같은 사람·같은 글의 1번째·2번째
    expect([ms[1].dupN, ms[2].dupN]).toEqual([1, 2]);
    expect(hashSource(ms[1])).not.toBe(hashSource(ms[2]));
  });

  it("PC 점형·년월일형(안드로이드)·24시간 표기, 이름 없는 날짜 시각 줄은 날짜 줄", () => {
    const txt = [
      "2026. 10. 23. 오후 3:24, 홍길동 : 물류 납품 완료",
      "두 번째 줄",
      "2026. 10. 23. 15:30, 홍길동 : 24시간 표기",
      "2026년 10월 22일 오후 1:00",
      "2026년 10월 22일 오후 1:05, 김영수 : 안드로이드 글",
    ].join("\r\n");
    const ms = parseKakaoText(txt, "완료방(납품,철수,교체)");
    expect(ms.map((m) => `${m.date} ${m.time} ${m.author}`)).toEqual([
      "2026-10-23 15:24 홍길동", "2026-10-23 15:30 홍길동", "2026-10-22 13:05 김영수",
    ]);
    expect(ms[0].text).toBe("물류 납품 완료\n두 번째 줄");
    expect(ms[0].room).toBe("완료방(납품,철수,교체)");
  });

  it("날짜 띠가 없는 대괄호 글은 버린다(시각 없는 원문은 중복 판정 불가)", () => {
    expect(parseKakaoText("[이민구] [오후 2:31] 날짜 모름", "방")).toEqual([]);
  });
});

describe("kakao-parse — 가림", () => {
  it("주민번호 전부·휴대폰 가운데 4자리", () => {
    const r = maskKakaoText("고객 연락처 010-1234-5678 주민 900101-1234567 / 01098765432");
    expect(r.text).toBe("고객 연락처 010-****-5678 주민 900101-1****** / 010-****-5432");
    expect(r.masked).toBe(3);
  });

  it("이름표 없는 붙은 13자리(기기 시리얼)는 그대로, 이름표가 있으면 가림", () => {
    expect(maskKakaoText("시리얼 8001104123456 확인").text).toBe("시리얼 8001104123456 확인");
    expect(maskKakaoText("주민번호: 9001011234567").text).toContain("900101-1******");
  });

  it("카드번호: 묶음형은 항상, 붙은 16자리는 '카드' 이름표 또는 룬 검사", () => {
    expect(maskKakaoText("카드 1234-5678-9012-3456 결제").text).toBe("카드 ****-****-****-**** 결제");
    expect(luhnOk("4111111111111111")).toBe(true);
    expect(maskKakaoText("번호 4111111111111111").text).toBe(`번호 ${"*".repeat(16)}`);
    expect(maskKakaoText("결제카드 1234567890123456").text).toBe(`결제카드 ${"*".repeat(16)}`);
    expect(maskKakaoText("주문 1234567890123456").text).toBe("주문 1234567890123456"); // 이름표 없음·룬 실패
  });

  it("계좌번호는 끝 4자리만", () => {
    expect(maskKakaoText("계좌 국민 123-45-678901 로 입금").text).toBe("계좌 국민 ***-**-**8901 로 입금");
  });
});

describe("kakao-parse — 행 만들기", () => {
  it("분류 추정은 정규식만", () => {
    expect(guessKind("사진 3장")).toBe("media");
    expect(guessKind("작성자: 이민구\n구분: 납품\n거래처명(지점/현장명 必) : 무암\n품목: X7400")).toBe("form:물류");
    expect(guessKind("작성자: 이민구\n업체: 무암\n매수: 12340\n토너: 30%")).toBe("form:점검");
    expect(guessKind("네 알겠습니다")).toBe("chat");
  });

  it("toRows — 가린 글·같은 입력이면 같은 해시·다른 입력이면 다른 해시", async () => {
    const ms = parseKakaoText(BRACKET_TXT);
    const a = await toRows(ms, "kakao_20261024.txt");
    const b = await toRows(parseKakaoText(BRACKET_TXT), "다른파일.txt");
    expect(a.rows.map((r) => r.hash)).toEqual(b.rows.map((r) => r.hash)); // 파일 이름은 키에 안 들어간다
    expect(new Set(a.rows.map((r) => r.hash)).size).toBe(a.rows.length);
    const last = a.rows[a.rows.length - 1];
    expect(last.text).toBe("고객 연락처 010-****-5678 주민 900101-1******");
    expect(last.sent_at).toBe("2026-10-24T09:03:00+09:00");
    expect(a.masked).toBe(2);
    expect(a.rows[0].source_file).toBe("kakao_20261024.txt");
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(utf8Bytes("가")).toBe(3);
  });
});

describe("kakao-parse — 가린 뒤 해시", () => {
  it("번호만 다른 두 글(가리면 같아짐)도 서로 다른 해시 — 한 글이 사라지지 않는다", async () => {
    const txt = ["2026년 10월 23일 목요일", "[이민구] [오후 2:31] 연락처 010-1111-5678", "[이민구] [오후 2:31] 연락처 010-2222-5678"].join("\n");
    const { rows } = await toRows(parseKakaoText(txt, "방"));
    expect(rows.map((r) => r.text)).toEqual(["연락처 010-****-5678", "연락처 010-****-5678"]);
    expect(rows[0].hash).not.toBe(rows[1].hash);
    expect(rows.map((r) => r.masked)).toEqual([1, 1]);
  });
});

describe("kakao-parse — 파일 머리 BOM", () => {
  it("UTF-8 BOM 이 붙은 파일도 방 이름을 읽는다", () => {
    expect(parseKakaoHeader("\uFEFF완료방(납품,철수,교체) 님과 카카오톡 대화\n저장한 날짜 : 2026-10-24").room).toBe("완료방(납품,철수,교체)");
  });
});
