/**
 * 접수 카톡 글 = 각 방 실물 양식(docs/tasks/dept-kakao-card-2026-10-27.md 5절 표본). 전화번호는 모두 가짜(010-0000-xxxx).
 * now = 2026-10-26 KST.
 */
import { describe, expect, it } from "vitest";
import { buildDeptReceptionRow, type DeptReceptionInput } from "../src/deptReception";
import {
  buildDeptKakaoText, buildItKakaoCard, cardDate, cardDateYY, cardWon, korDayWithWeekday, monthsLeft, monthsUsed, serializeCard,
  KAKAO_CARD_MAX,
} from "../src/receptionKakaoCard";
import { isTableReceptionHead } from "../src/inspectionBlocks";
import { legacyItHeadLine, receptionTitleLine } from "../src/receptionKakaoCard";
import { fieldTicketVendor } from "../src/ids";
import { buildActionBlock } from "../src/actionBlock";

const NOW = new Date("2026-10-26T10:00:00+09:00");
const T = "\t";
const rowOf = (input: DeptReceptionInput) => buildDeptReceptionRow(input);

describe("경영지원 카드(A1:M15)", () => {
  const lease = {
    업체명: "30㈜올림커뮤니케이션중곡동 현장위탁품목매월마감", 등급: "S", 임대여부: "임대중", 순: "22454", 장비소유주: "",
    계약일: "가구", 종료일: "", "납품/교체일": "2026-10-09", 기본금액: "가구", 연평균: "가구",
    "기본(흑)": "1600", "추가(흑)": "14", 납품담당: "알앤텍", "위탁/유지보수및기타사항": "알앤텍",
    미수개월수: "0", 세금계산서: "010-0000-1218 김민석 기사", "관리 담당자": "수도권C",
  };
  const row = rowOf({
    dept: "경영지원", author: "홍길동", route: "사내", via: "이윤아", handler: "김슬기", vendor: "올림커뮤니케이션", leaseNo: "22454",
    region: "수도권C", field: "청구관련", content: "22454 22455 마지막 청구 명세서 해당 메일로 발송 및 안내 부탁드립니다.",
    receiverPhone: "010-0000-5787", address: "서울 광진구 중곡동 93-11 6층(엘베유)", lease,
  });
  it("실물과 같은 15줄 + 꼬리 줄", () => {
    expect(buildDeptKakaoText(row, lease, NOW)).toBe([
      `청구관련${T}30㈜올림커뮤니케이션중곡동 현장위탁품목매월마감${T}${T}${T}종료일${T}${T}지역${T}수도권C${T}방문주기${T}${T}${T}접수일${T}10. 26`,
      `작성자${T}홍길동${T}처리자${T}김슬기(사내 이윤아)`,
      `기번${T}${T}급한여부`,
      `임대여부${T}임대중${T}접수분야${T}청구관련`,
      `임대리스트순번${T}22454${T}장비소유주`,
      `계약일${T}가구${T}종료일`,
      `납품/교체일${T}2026. 10. 9${T}남은개월`,
      `기본임대료${T}가구${T}평균임대료${T}가구`,
      `기본매수${T}흑백1600${T}추가장당${T}흑백14`,
      `설치업체${T}알앤텍${T}유지보수업체${T}알앤텍`,
      `접수자성함${T}${T}접수자연락처${T}010-0000-5787`,
      `미수개월${T}${T}★키맨성함/번호${T}010-0000-1218 김민석 기사`,
      `방문담당자${T}수도권C${T}사용여부${T}0개월`,
      `주소${T}서울 광진구 중곡동 93-11 6층(엘베유)${T}확장성`,
      `기종${T}${T}기번`,
      `접수내용${T}22454 22455 마지막 청구 명세서 해당 메일로 발송 및 안내 부탁드립니다.`,
      `접수유형${T}사내`,
    ].join("\n"));
  });
  it("buildDeptReceptionRow 가 lease 를 받아 카드로 report_text 를 만든다", () => {
    expect(row.report_text.startsWith(`청구관련${T}30㈜올림커뮤니케이션`)).toBe(true);
    expect(row.report_text).toContain(`임대리스트순번${T}22454`);
  });
});

describe("전략영업 카드", () => {
  const lease = {
    업체명: "17N메이크건설양평현장매월마감", 등급: "N", 모델명: "SL-X4220RX", 임대여부: "임대중", 순: "22343",
    계약일: "2026-08-18", 종료일: "2026-11-17", 기본금액: "150000", 연평균: "",
    "기본(컬)": "500", "기본(흑)": "3000", "추가(컬)": "100", "추가(흑)": "10", 미수개월수: "0", "관리 담당자": "수도권D",
  };
  const row = rowOf({
    dept: "영업팀", author: "홍길동", route: "카카오", handler: "김수인", vendor: "메이크건설", leaseNo: "22343", grade: "N",
    region: "D", field: "현장/단기 철수",
    content: "양평현장/ 3개월 선결제(8/18~11/17)/ 11월 17일까지만 하고 기기 철수요청\n*현장상황에 따라 앞당겨 질 수도 있다고 하심",
    receiverPhone: "010-0000-0196", address: "경기 양평군 양서면 양수로 93 1층 컨테이너",
  });
  it("머리 셀 줄 + 빈 줄 + 라벨:값 쌍 + 🔹 접수내용 + 꼬리 줄", () => {
    expect(buildDeptKakaoText(row, lease, NOW)).toBe([
      `N${T}현장/단기 철수${T}SL-X4220RX${T}17N메이크건설양평현장매월마감${T}종료일${T}26. 11. 17${T}지역${T}수도권D${T}접수일${T}10. 26`,
      "",
      "작성자:   홍길동   /   처리자:   김수인",
      "임대여부:   임대중   /   접수분야:   현장/단기 철수",
      "상호:   17N메이크건설양평현장매월마감   /   임대리스트순번:   22343",
      "계약일:   2026. 8. 18   /   종료일:   2026. 11. 17",
      "기본임대료:   ₩150,000   /   평균임대료:",
      "기본매수:   컬러500/흑백3000   /   추가장당:   컬러100/흑백10",
      "접수자성함:   /   접수자연락처   010-0000-0196",
      "미수개월:   /   남은개월:   1개월",
      "주소:   경기 양평군 양서면 양수로 93 1층 컨테이너",
      "🔹 접수내용:   양평현장/ 3개월 선결제(8/18~11/17)/ 11월 17일까지만 하고 기기 철수요청",
      "*현장상황에 따라 앞당겨 질 수도 있다고 하심",
      "접수유형:   카카오",
    ].join("\n"));
  });
  it("신규 업체(lease null) — 임대리스트 칸은 빈칸, 순번은 신규, '개월'만 남지 않는다", () => {
    const nrow = rowOf({ dept: "영업팀", author: "홍길동", route: "전화", vendor: "새업체", field: "렌탈문의", content: "문의" });
    const text = buildDeptKakaoText(nrow, null, NOW);
    expect(text).toContain("상호:   새업체   /   임대리스트순번:   신규");
    expect(text).toContain("미수개월:   /   남은개월:");
    expect(text).not.toMatch(/남은개월:\s+개월/);
  });
});

describe("IT 카드", () => {
  const lease = {
    업체명: "주식회사 유디임팩트 패스트파이브", 등급: "V", 품목: "노트북", 자산번호: "IT-0001", "시리얼번호(기번)": "SN0001",
    임대여부: "임대중", 순: "16419", 장비소유주: "퍼스트전산", 계약일: "2025-01-21", 종료일: "2028-01-20", "납품/교체일": "2025-01-21",
    기본금액: "70000", 연평균: "63000", 납품담당: "퍼스트전산", 제조사: "LG", 모델명: "16ZD90SU",
    "옵션1 (FAX/CPU)": "코어울트라5-125U", "옵션2 (트레이/램/SSD)": "24GB/512GB/", "옵션3 (피니셔/그래픽)": "X내장", "옵션4 (솔루션/윈도우)": "WIN10PRO",
    세금계산서: "김인실 팀장 010-0000-4045 (결제/계약, 키맨-부)\n안항선 그룹장 010-0000-4046", "주소(실납품주소,도로명주소)": "서울 강남구 테헤란로 1",
    미수개월수: "0",
  };
  const manual = { 접수자성함: "백지연", 접수자연락처: "010-0000-7942", 제목: "", 증상: "특정 키보드 타이핑이 안됨", 참고사항: "", 주소: "" };
  it("실물 틀 그대로", () => {
    expect(buildItKakaoCard({ lease, manual, route: "카카오", region: "수도권C", author: "홍길동", paid: "무상" }, NOW)).toBe([
      `IT${T}AS${T}V${T}노트북${T}주식회사 유디임팩트 패스트파이브`,
      `작성자${T}홍길동`,
      `난이도${T}${T}긴급도`,
      `자산번호${T}IT-0001${T}시리얼번호${T}SN0001`,
      `지역${T}수도권C${T}이관여부`,
      `접수유형${T}카카오${T}임대여부${T}임대중`,
      `임대리스트순번${T}16419${T}장비소유주${T}퍼스트전산`,
      `계약일${T}2025. 1. 21${T}종료일${T}2028. 1. 20`,
      `납품/교체일${T}2025. 1. 21${T}남은개월${T}15개월`,
      `기본임대료${T}₩70,000${T}평균임대료${T}₩63,000`,
      `설치업체${T}퍼스트전산${T}유지보수업체`,
      `접수자성함연락처${T}백지연 / 010-0000-7942${T}제조사${T}LG`,
      `기종${T}16ZD90SU/코어울트라5-125U24GB/512GB/X내장WIN10PRO${T}사양`,
      "일반전화",
      "미수개월",
      `★키맨성함/번호${T}김인실 팀장 010-0000-4045 (결제/계약, 키맨-부) / 안항선 그룹장 010-0000-4046`,
      `주소${T}서울 강남구 테헤란로 1${T}확장성`,
      `증상${T}특정 키보드 타이핑이 안됨${T}처리내용`,
      "유상/무상 무상",
    ].join("\n"));
  });
  it("사진 링크는 카드 뒤·꼬리 줄 앞, 제목은 '제목 / 증상'", () => {
    const text = buildItKakaoCard({
      lease, manual: { ...manual, 제목: "키보드", 참고사항: "오후 방문" }, route: "전화", region: "수도권C", author: "홍길동",
      photoLines: ["📷 증상사진 2장 모아보기:", "https://example.test/?album=x"],
    }, NOW);
    expect(text).toContain(`증상${T}키보드 / 특정 키보드 타이핑이 안됨${T}처리내용\n📷 증상사진 2장 모아보기:\nhttps://example.test/?album=x\n참고사항 오후 방문`);
  });
  it("새 IT 머리는 붙여넣기 분할이 접수 시작으로 본다", () => {
    expect(isTableReceptionHead(`IT${T}AS${T}V${T}노트북${T}업체`)).toBe(true);
    expect(isTableReceptionHead(`IT A/S${T}V`)).toBe(true); // 옛 머리도 그대로
    expect(isTableReceptionHead(`ITAS${T}V`)).toBe(false);
  });
});

describe("운영지원 카드(경영 틀 기반, 2026-10-27 자유 글 틀 폐기)", () => {
  const lease = {
    업체명: "12S알스퀘어디자인울산현장매월마감", 임대여부: "임대중", 순: "11110", 계약일: "2026-08-01", 종료일: "2027-07-31",
    기본금액: "150000", "기본(흑)": "3000", 납품담당: "알앤텍", "위탁/유지보수및기타사항": "알앤텍",
    세금계산서: "010-0000-1111 김키맨", 확장성: "가능", 모델명: "SL-X4220RX", "시리얼번호(기번)": "SN-1", "관리 담당자": "수도권D",
  };
  it("모든 칸을 채운 표본", () => {
    const row = rowOf({
      dept: "운영지원", author: "홍길동", route: "사내", via: "이윤아", handler: "박운영", outside: true, progress: "안내완",
      vendor: "알스퀘어디자인", leaseNo: "11110", region: "D", address: "울산 동구 대학병원로 25",
      receiverName: "이성민", receiverPhone: "010-0000-8971", field: "배송/택배",
      content: "SL-X4220RX 1대, 데탑 5대\n싣는 곳 1층", scheduleDate: "2026-08-24", lease,
    });
    expect(buildDeptKakaoText(row, lease, NOW)).toBe([
      `배송/택배${T}12S알스퀘어디자인울산현장매월마감${T}${T}${T}종료일${T}27. 7. 31${T}지역${T}수도권D${T}접수일${T}10. 26`,
      `작성자${T}홍길동${T}처리자${T}박운영(사내 이윤아)`,
      `접수유형${T}사내${T}접수분야${T}배송/택배`,
      `예정일${T}2026. 8. 24(월)${T}외근요청${T}예`,
      `임대여부${T}임대중${T}임대리스트순번${T}11110`,
      `계약일${T}2026. 8. 1${T}종료일${T}2027. 7. 31`,
      `기본임대료${T}₩150,000${T}기본매수${T}흑백3000`,
      `설치업체${T}알앤텍${T}유지보수업체${T}알앤텍`,
      `업체담당자${T}이성민${T}연락처${T}010-0000-8971`,
      `★키맨성함/번호${T}010-0000-1111 김키맨`,
      `주소${T}울산 동구 대학병원로 25${T}확장성${T}가능`,
      `기종${T}SL-X4220RX${T}기번${T}SN-1`,
      `접수내용${T}SL-X4220RX 1대, 데탑 5대`,
      "싣는 곳 1층",
      `진행메모${T}안내완`,
    ].join("\n"));
  });
  it("일부만 채운 표본(신규 업체·예정일·처리자 없음) — 라벨은 두고 값만 빈칸", () => {
    const row = rowOf({
      dept: "운영지원", author: "홍길동", route: "전화", vendor: "새운영업체", receiverName: "이성민", receiverPhone: "010-0000-8971",
      field: "배송/택배", content: "택배 2건",
    });
    expect(buildDeptKakaoText(row, null, NOW)).toBe([
      `배송/택배${T}새운영업체${T}${T}${T}종료일${T}${T}지역${T}${T}접수일${T}10. 26`,
      `작성자${T}홍길동`,
      `접수유형${T}전화${T}접수분야${T}배송/택배`,
      `예정일${T}${T}외근요청`,
      `임대여부${T}${T}임대리스트순번${T}신규`,
      `계약일${T}${T}종료일`,
      `기본임대료${T}${T}기본매수`,
      `설치업체${T}${T}유지보수업체`,
      `업체담당자${T}이성민${T}연락처${T}010-0000-8971`,
      "★키맨성함/번호",
      `주소${T}${T}확장성`,
      `기종${T}${T}기번`,
      `접수내용${T}택배 2건`,
    ].join("\n"));
  });
});

describe("경영·영업 카드: 칸 없는 폼 값은 접수내용 뒤 한 줄씩(기재한 값 유실 금지)", () => {
  it("경영 — 예정일·외근요청·계약서구분·진행메모", () => {
    const row = rowOf({ dept: "경영지원", author: "홍길동", route: "카카오", handler: "김슬기", vendor: "가짜업체", field: "기타", content: "내용",
      scheduleDate: "2026-10-30", outside: true, contractKind: "전자", progress: "안내완" });
    expect(buildDeptKakaoText(row, null, NOW).split("\n").slice(-6)).toEqual([
      `접수내용${T}내용`, `접수유형${T}카카오`, `예정일${T}2026. 10. 30(금)`, `외근요청${T}예`, `계약서구분${T}전자`, `진행메모${T}안내완`,
    ]);
  });
  it("영업 — 본문 꼴(라벨:   값), 처리자 없는 사내 요청자", () => {
    const row = rowOf({ dept: "영업팀", author: "홍길동", route: "사내", via: "이윤아", handler: " ", vendor: "가짜업체", field: "기타", content: "내용",
      scheduleDate: "2026-10-30" });
    const text = buildDeptKakaoText(row, null, NOW);
    expect(text).toContain("🔹 접수내용:   내용\n접수유형:   사내\n예정일:   2026. 10. 30(금)");
  });
});

describe("값 규칙", () => {
  it("① 엑셀 일련번호 종료일 → 날짜, 지난 날짜는 만료", () => {
    expect(cardDate("45992")).toBe("2025. 12. 1");
    expect(monthsLeft("45992", NOW)).toBe("만료");
    expect(monthsLeft("2026-10-30", NOW)).toBe("0개월");
  });
  it("② 범위 밖 연도는 빈칸, 글자는 그대로, 남은개월은 빈칸", () => {
    expect(cardDate("2076-08-28")).toBe("");
    expect(cardDateYY("2076-08-28")).toBe("");
    expect(monthsLeft("2076-08-28", NOW)).toBe("");
    expect(cardDate("가구")).toBe("가구");
    expect(monthsLeft("가구", NOW)).toBe("");
    expect(monthsUsed("가구", NOW)).toBe("");
  });
  it("③ 연평균 소수는 반올림", () => {
    expect(cardWon("97666.66667")).toBe("₩97,667");
    expect(cardWon("")).toBe("");
    expect(cardWon("가구")).toBe("가구");
  });
  it("요일·직렬화 끝 공백", () => {
    expect(korDayWithWeekday("2026-10-26")).toBe("10월 26일(월)");
    expect(serializeCard([{ kind: "cells", cells: ["a", "", ""] }, { kind: "pairs", pairs: [["라벨", ""]] }])).toBe("a\n라벨:");
  });
  it("⑥ 끝 공백 없음·⑦ 표본 길이 1,000자 미만", () => {
    const lease = { 업체명: "업체", 순: "1", 종료일: "2027-01-01" };
    for (const dept of ["경영지원", "영업팀", "운영지원"] as const) {
      const text = rowOf({ dept, author: "홍길동", route: "카카오", vendor: "업체", leaseNo: "1", field: "기타", content: "내용 \n둘째 줄", lease }).report_text;
      expect(text).not.toMatch(/[ \t]+$/m);
      expect(text.length).toBeLessThan(1000);
    }
  });
  it("3,000자 넘으면 접수내용 끝을 자른다", () => {
    const row = rowOf({ dept: "영업팀", author: "홍길동", route: "카카오", vendor: "업체", field: "기타", content: "가".repeat(5000) });
    expect(row.report_text.length).toBeLessThanOrEqual(KAKAO_CARD_MAX);
    expect(row.report_text).toContain("…(앱 접수에 전체)");
    expect(row.symptom.length).toBe(5000);
  });
});

describe("IT 일정·네이버 제목은 옛 형식 그대로(검수아 지적 2026-10-27)", () => {
  const lease = {
    업체명: "25#V주식회사 가짜테크", 등급: "V", 발행: "25", "누적방식 (월/분/반/년)": "매월", 품목: "노트북", 모델명: "16ZD90SU",
    종료일: "2028-01-20", 순: "10001", 임대여부: "임대중",
  };
  const manual = { 접수자성함: "백지연", 접수자연락처: "010-0000-7942", 증상: "키보드 불량" };
  const card = buildItKakaoCard({ lease, manual, route: "카카오", region: "수도권C", author: "홍길동" }, NOW);
  // 2026-10-27 전 ServiceReception report 첫 줄 식: IT A/S⇥등급⇥모델명⇥{발행+등급}업체명⇥마감구분⇥종료일⇥YY⇥지역⇥{지역}⇥접수일⇥M. D
  const OLD_HEAD = `IT A/S${T}V${T}16ZD90SU${T}25V주식회사 가짜테크${T}매월마감${T}종료일${T}28. 1. 20${T}지역${T}수도권C${T}접수일${T}10. 26`;
  it("저장 직후 폼에서 만든 제목 = 옛 첫 줄과 같은 글자", () => {
    expect(legacyItHeadLine(lease, "수도권C", NOW)).toBe(OLD_HEAD);
    const title = receptionTitleLine(card, legacyItHeadLine(lease, "수도권C", NOW));
    expect(title).toBe(OLD_HEAD.replace(/\t/g, " "));
    expect(fieldTicketVendor(title).vendor).toBe("주식회사 가짜테크");
  });
  it("DB 에서 다시 읽은 새 카드(제목 줄 없음)도 옛 모양으로 바꿔 품목이 업체명에 붙지 않는다", () => {
    expect(card.split("\n")[0]).toBe(`IT${T}AS${T}V${T}노트북${T}주식회사 가짜테크`);
    const title = receptionTitleLine(card);
    expect(title).toBe("IT A/S V 16ZD90SU 주식회사 가짜테크 종료일 28. 1. 20 지역 수도권C");
    expect(fieldTicketVendor(title).vendor).toBe("주식회사 가짜테크");
  });
  it("CS 글은 첫 줄 그대로(탭→공백)", () => {
    expect(receptionTitleLine(`A/S${T}S${T}SL-X4220${T}업체${T}종료일\n작성자${T}홍길동`)).toBe("A/S S SL-X4220 업체 종료일");
  });
  it("완료 카톡 블록 업체명이 '주식회사 가짜테크'", () => {
    const block = buildActionBlock(
      { vendor: "주식회사 가짜테크", calendarTitle: receptionTitleLine(card).slice(0, 120), note: card, model: "16ZD90SU" },
      { author: "홍길동", reason: "키보드 교체 완료" },
    );
    expect(block).toContain("업체명: 주식회사 가짜테크");
    expect(block).not.toContain("노트북 주식회사");
  });
});

describe("네 부서 공통: 둘째 줄이 작성자(AS방 CS 카드와 같은 자리, 2026-10-27 사용자)", () => {
  const lease = { 업체명: "가짜업체", 순: "1", 등급: "S", 품목: "노트북" };
  const second = (text: string) => text.split("\n").filter((l, i) => i === 0 || l !== "")[1];
  it("경영·영업·운영·IT 모두 작성자, 꼬리 '접수자 …' 줄 없음", () => {
    const texts: string[] = [];
    for (const dept of ["경영지원", "영업팀", "운영지원"] as const) {
      texts.push(buildDeptKakaoText(rowOf({ dept, author: "홍길동", route: "카카오", vendor: "가짜업체", leaseNo: "1", field: "기타", content: "내용", lease }), lease, NOW));
    }
    texts.push(buildItKakaoCard({ lease, manual: { 증상: "내용" }, route: "카카오", region: "수도권C", author: "홍길동" }, NOW));
    // 영업은 지역 없을 때 처리자 기본값(박진영)이 붙는다
    expect(texts.map(second)).toEqual([`작성자${T}홍길동`, "작성자:   홍길동   /   처리자:   박진영", `작성자${T}홍길동`, `작성자${T}홍길동`]);
    texts.forEach((t) => expect(t).not.toMatch(/^접수자 /m));
  });
  it("처리자가 없으면 처리자 칸째 빠진다", () => {
    const row = rowOf({ dept: "경영지원", author: "홍길동", route: "카카오", vendor: "가짜업체", region: "C", field: "기타", content: "내용" });
    expect(row.remote_meta.handler).toBe("");
    expect(buildDeptKakaoText(row, null, NOW).split("\n")[1]).toBe(`작성자${T}홍길동`);
  });
});
