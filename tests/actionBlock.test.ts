/**
 * 완료·연기 처리 양식 회귀 테스트.
 *
 * 케이스는 전부 실제로 카톡방에 나갔던 것 — "기종: - / 자산기번: - / 시리얼번호: - / 접수내용: -"만
 * 찍혀 나가거나, 사유란에 붙여넣은 보고양식 전문이 그대로 도배된 건들이다.
 */
import { describe, expect, it } from "vitest";
import { buildActionBlock, condenseReason, extractDeviceInfo } from "../src/actionBlock";

// 사유란에 통째로 붙여넣어진 FIELD 보고양식 (빈 정기점검 블록까지 두 벌 붙은 실제 형태)
const PASTED_FORM = [
  "작성자:박영현", "구분: AS", "레벨:3", "등급:V",
  "업체명:주식회사 알스퀘어디자인", "부서명:5층", "지역:C", "키맨/접수자:010-7221-1098",
  "ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ", "1.",
  "모델명: ApeosPort-3060", "시리얼넘버: 821304", "자산기번: C3106",
  "내용: 글자체가 겹쳐서 출력이 됩니다.",
  "처리내용: 사무실 취외 드럼 교환 처리 완료 \n출력 30매 이상 정상확인",
  "매수: 흑282706 컬- 큰컬- 합-", "토너잔량: K39 C- M- Y-",
  "ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ", "",
  "작성자:박영현", "구분: AS", "모델명:", "내용: 정기점검", "처리내용: 정기점검", "매수:흑- 컬- 큰컬- 합-",
].join("\n");

describe("네이버 수입 일정 — 컬럼이 비어 있어도 원문에서 채운다", () => {
  it("공백이 끼는 모델 표기(ApeosPort-V C3375)를 잡는다", () => {
    const ticket = { vendor: "A/S\t NN\tApeosPort-V C3375(세이토)\t28NN빌드인사이트-분기마감\t종료일\t26. 10. 17\t 지역\t" };
    const block = buildActionBlock(ticket, { author: "신정훈", reason: "금일 처리 완료" });
    expect(block).toBe([
      "업체명: 빌드인사이트",
      "작성자: 신정훈",
      "기종: ApeosPort-V C3375",   // 예전엔 "기종: -"
      "처리내용: 금일 처리 완료",
    ].join("\n"));
  });

  it("모델 뒤 탭에 붙은 등급 접두(27N…)를 물지 않는다", () => {
    const ticket = { vendor: "A/S\t N\tHP-9010\t27N디아트치과-단순마감마감\t종료일\t22. 9. 27\t 지역\t수도권C" };
    const info = extractDeviceInfo(ticket);
    expect(info.model).toBe("HP-9010");
  });

  it("연기 라벨은 처리내용 끝에 붙는다", () => {
    const ticket = { vendor: "A/S\t N\tHP-9010\t27N디아트치과-단순마감마감" };
    const block = buildActionBlock(ticket, { author: "이홍진", reason: "익일 hp8730으로 교체", deferLabel: "8/25로 연기" });
    expect(block).toContain("처리내용: 익일 hp8730으로 교체 (8/25로 연기)");
    expect(block).toContain("업체명: 디아트치과");
  });

  it("값이 없는 줄은 '-'로 채우지 않고 뺀다", () => {
    const block = buildActionBlock({ vendor: "28NN빌드인사이트-분기마감" }, { author: "신정훈", reason: "완료" });
    expect(block).not.toContain("자산기번");
    expect(block).not.toContain("시리얼번호");
    expect(block).not.toContain("접수내용");
  });
});

describe("사유란에 보고양식을 붙여넣은 경우", () => {
  const ticket = { vendor: '"30V주식회사 알스퀘어디자인5층 외주관리팀(가산빌딩)전 외주관리팀  아남타워 5층 192.168.1.8' };

  it("처리내용만 뽑아 카톡방 도배를 막는다", () => {
    expect(condenseReason(PASTED_FORM)).toBe("사무실 취외 드럼 교환 처리 완료 출력 30매 이상 정상확인 / 정기점검");
  });

  it("보고양식 안의 기기 정보로 빈 칸을 채운다", () => {
    const block = buildActionBlock(ticket, { author: "박영현", reason: PASTED_FORM });
    expect(block).toBe([
      "업체명: 주식회사 알스퀘어디자인 (5층)",   // 캘린더 제목(부서·건물·IP 붙은 원문) 대신 양식의 업체명
      "작성자: 박영현",
      "기종: ApeosPort-3060",
      "자산기번: C3106",
      "시리얼번호: 821304",
      "접수내용: 글자체가 겹쳐서 출력이 됩니다.",
      "처리내용: 사무실 취외 드럼 교환 처리 완료 출력 30매 이상 정상확인 / 정기점검",
    ].join("\n"));
  });

  it("일정 '내용'에 쌓을 때는 원문을 그대로 남긴다", () => {
    const block = buildActionBlock(ticket, { author: "박영현", reason: PASTED_FORM, condense: false });
    expect(block).toContain("토너잔량: K39");
    expect(block).toContain("매수: 흑282706");
  });

  it("보고양식이 아닌 평범한 사유는 손대지 않는다", () => {
    const plain = "용지 지속적으로 번짐. 헤드세척, 중고헤드교체, 새용지교체해도 증상 동일하다고 함.";
    expect(condenseReason(plain)).toBe(plain);
  });
});

describe("업체명 라벨", () => {
  it("업체명을 못 뽑으면 '캘린더제목:'으로 적어 오해를 막는다", () => {
    const block = buildActionBlock({ vendor: "", calendarTitle: "" }, { author: "", reason: "완료" });
    expect(block.startsWith("캘린더제목:")).toBe(true);
  });

  it("작성자가 없으면 그 줄을 넣지 않는다", () => {
    const block = buildActionBlock({ vendor: "28NN빌드인사이트-분기마감" }, { reason: "완료" });
    expect(block).not.toContain("작성자");
  });

  it("사유가 비면 아무 것도 만들지 않는다 (조용한 완료)", () => {
    expect(buildActionBlock({ vendor: "빌드인사이트" }, { author: "신정훈", reason: "   " })).toBe("");
  });
});

describe("제목 머리의 '이름 - a/s' 접두 (2026-08-25 실사고)", () => {
  it("등급 접두가 없어도 이름·구분 기호·a/s를 벗기고 업체명을 잡는다", () => {
    const block = buildActionBlock({ vendor: "이호준 - a/s NN SL-K3250NR 위례올림수학학원-분기마감 종료일 24. 6" }, { author: "이호준", reason: "정착기 교체 완료" });
    expect(block).toContain("업체명: 위례올림수학학원");
    expect(block).not.toContain("업체명: 이호준");
  });
  it("등급 접두가 있는 원래 형태도 그대로 정상", () => {
    const block = buildActionBlock({ vendor: "이호준 - a/s NN SL-K3250NR 1NN위례올림수학학원-분기마감 종료일 24. 6" }, { author: "이호준", reason: "완료" });
    expect(block).toContain("업체명: 위례올림수학학원");
  });
});

describe("접수내용 — 양식의 '제목' 줄이 구분 낱말(A/S)보다 우선 (2026-08-25 실사고)", () => {
  const NOTE = [
    "A/S    V   Apeos-C3070   17V건축사무소에스파스수냐빌딩 4층 안쪽방문전 정우석 차장님에게 연락 후 주차확인 필요 / 백업/합산매월마감   종료일   27. 6. 30",
    "기번   130335   자산번호   X7052                  ",
    "접수유형   전화   접수분야   A/S                  ",
    "기종   Apeos-C3070   기기상태   확인요망                  ",
    "제목    출력시 글자 뭉개짐                        ",
    "상태    뚜렷하게 표현되지않고, 뭉개져서 나옴                        ",
  ].join("\n");
  const ticket = { vendor: "A/S\t V\tApeos-C3070\t17V건축사무소에스파스수냐빌딩 4층 안쪽방문전 정우석 차장님에게 연락 후 주차확인 필요 / 백업/합산매월마감", note: NOTE };

  it("접수내용은 '출력시 글자 뭉개짐' — 'A/S'가 아니다", () => {
    const block = buildActionBlock(ticket, { author: "박영현", reason: "익일 오전 방문", deferLabel: "8/26로 연기" });
    expect(block).toContain("접수내용: 출력시 글자 뭉개짐");
    expect(block).not.toContain("접수내용: A/S");
    expect(block).toContain("자산기번: X7052");
    expect(block).toContain("시리얼번호: 130335");
  });

  it("제목이 없고 접수분야가 여분요청이면 그건 내용으로 쓴다", () => {
    const block = buildActionBlock({ vendor: "여분요청 V SL-X7500LX 12#V디쉐어세종", note: "접수유형   전화   접수분야   여분요청\n제목    \n상태    " }, { author: "심태현", reason: "완료" });
    expect(block).toContain("접수내용: 여분요청");
  });
});
