/**
 * 2026-10-24 위험 점검 즉시 항목 1·2·6 재발 방지 (개발실 오류진)
 *  1. 네이버 수입 일정 업체명 = 제목 앞 80자 통째 → 고객사만 (naver 739건 중 80자 274건)
 *  2. 완료 처리 때 일정 조회 실패를 [] 로 삼켜 note 를 이번 양식만으로 덮어씀
 *  6. 접수→일정 중복 검사 조회 실패를 [] 로 삼켜 중복 일정 생성
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { importedTicketVendor, logisticsTicketInfo as sharedLogistics, noteCompanyName } from "../supabase/functions/_shared/ticket-title";
import { fieldTicketVendor, logisticsTicketInfo } from "../src/ids";
import { readOrStop } from "../src/ticketGuard";

describe("네이버 수입 일정 업체명 — 고객사만", () => {
  it("물류 슬래시 열차는 품목 앞 고객사 칸 (80자 넘는 실제 제목)", () => {
    const title = "방문시 무조건 이사님께 연락 오전오후 무관, 전일 전화 필수-IT/철수(일반)/퍼스트/현장종료/동원건축사사무소-파주 금천현장/X4220/확인서서명필수";
    expect(title.length).toBeGreaterThan(80);
    expect(importedTicketVendor(title, "", true)).toBe("동원건축사사무소-파주 금천현장");
  });
  it("품목 칸이 모델명뿐이어도(수량 없음) 그 앞이 고객사 — 웹앱 물류 양식도 같은 파서", () => {
    expect(logisticsTicketInfo("철수(일반)/퍼스트/계약종료/밀레니얼웍스/X3220/확인서서명필수")).toEqual({ vendor: "밀레니얼웍스", item: "X3220", category: "철수" });
    expect(logisticsTicketInfo("셋팅-자산번호,셋팅만-교체(일반)/네오정보/재계약(기기상향)/원모기지/K4305LX->K7600LX(리퍼)/전자").vendor).toBe("원모기지");
    expect(logisticsTicketInfo("미처리회수-울산사무실에서 사용중/(일반)/네오정보/기기고장/세중종합물류-울산/X3220(회수기번: 0A6XBJLR30003LA)").vendor).toBe("세중종합물류-울산");
    expect(logisticsTicketInfo("오후, 전일 시간 조율 필요 -철수(일반)/퍼스트/계약종료/엠텔/ES5473/확인서서명필수").vendor).toBe("엠텔");
    expect(logisticsTicketInfo("철수(일반)/퍼스트/계약종료/케이씨엘/태블릿PC/확인서서명필수").vendor).toBe("케이씨엘");
  });
  it("품목을 못 알아봐도 끝 비고 칸 두 칸 앞이 고객사 · 괄호 안 슬래시는 칸이 아니다 · 내부 용어는 고객사가 아니다", () => {
    expect(logisticsTicketInfo("미처리회수, 10.30 -철수(일반)/퍼스트/계약종료/우륵아파트리모델링주택조합/세단기/확인서서명필수").vendor).toBe("우륵아파트리모델링주택조합");
    expect(logisticsTicketInfo("★재건정보통신 진행-판매납품/재건정보통신/증설/세안이엔씨-용인 덕성데이터현장/네트워크공사/확인서서명필수").vendor).toBe("세안이엔씨-용인 덕성데이터현장");
    expect(logisticsTicketInfo("교체철수만(일반)/퍼스트/운영팀/기기고장/참좋은교육/VII C4473->AC4570(보탄2/리퍼)/확인서서명필수"))
      .toEqual({ vendor: "참좋은교육", item: "VII C4473->AC4570(보탄2/리퍼)", category: "철수" });
    expect(logisticsTicketInfo("★네오정보-판매납품/네오정보/옥외광고/권태풍 고객님/SL-X3220NR(새기기)/확인서서명필수").vendor).toBe("권태풍 고객님");
    expect(importedTicketVendor("근처 일정있을때 금요일 오후 / IT / 고인돌 방문 해서 데스크탑 5대 수령", "", true)).not.toBe("IT");
  });
  it("글머리 메모의 '3개월'을 품목으로 오인하지 않는다 — 구분 칸 뒤부터 찾는다", () => {
    const title = "고객이 일정잡고 다시 연락준다고 함/보관 후 재납품건, 8.13 철수로부터 3개월 후 날짜로 지정한 것, 주소 및 확정여부 체크필요-재납품(일반)/퍼스트/운영팀/증설/비욘드더베이스/X3220(리퍼)/확인서서명필수";
    expect(importedTicketVendor(title, "", true)).toBe("비욘드더베이스");
  });
  it("물류는 본문 '상호 :' 줄이 있으면 그것", () => {
    const title = "⭐오후 4시반 이후 방문 요망, 엘리베이터 사용 신청 필요, 전일 연락 필수-납품(일반)/퍼스트/운영팀/신규/디지털자산거래소/X3220/확인서서명필수";
    expect(importedTicketVendor(title, "7. 상호(사업자등록증 유/무) : 디지털자산 거래소 (순 21944)", true)).toBe("디지털자산 거래소");
  });
  // 2026-10-24 정리 SQL 재계산 때 남은 꼬리(681건 중 순번 17·등급 11·주소 2·유상A/S 2) — 실제 본문 줄
  it("상호 줄 순번 표기는 모양과 상관없이 뗀다", () => {
    expect(noteCompanyName("7. 상호(사업자등록증 유/무) : 케이지엔지니어링종합건축사사무소파주현장( 15229 )")).toBe("케이지엔지니어링종합건축사사무소파주현장");
    expect(noteCompanyName("1. 상호명 : 주식회사 보평이엔씨 (21862)")).toBe("주식회사 보평이엔씨");
    expect(noteCompanyName("7. 상호 : 디쉐어-김포사우점 ( 22563,22564 )")).toBe("디쉐어-김포사우점");
    expect(noteCompanyName("7. 상호 : 주식회사 지투지프라이빗에쿼티(GTOG Private Equity Co.,Ltd.) / 순: 4336")).toBe("주식회사 지투지프라이빗에쿼티(GTOG Private Equity Co.,Ltd.)");
    expect(noteCompanyName("7. 상호 : (주)딥스톤인베스트먼트 (사유: 사용안함/사업정리 및 폐업)")).toBe("(주)딥스톤인베스트먼트");
    expect(noteCompanyName("1. 상호명 : 본점(2)")).toBe("본점(2)"); // 층·호수 같은 짧은 숫자 괄호는 남긴다
  });
  it("상호 줄 앞의 임대리스트 등급 접두(28V·12N)는 뗀다", () => {
    expect(noteCompanyName("4. 상호 : 28V(주) 드림엔지니어링울산하이드로젠현장")).toBe("(주) 드림엔지니어링울산하이드로젠현장");
    expect(noteCompanyName("7. 상호(사업자등록증 유/무) : 12N서원인테리어")).toBe("서원인테리어");
  });
  it("상호 칸에 주소를 적었으면 버리고 제목 고객사를 쓴다", () => {
    const note = "7. 상호(사업자등록증 유/무) :경기 김포시 사우중로 77 6층 에이닷 영어학원 ( 22563,22564 )";
    expect(noteCompanyName(note)).toBe("");
    expect(importedTicketVendor("교체(일반)/퍼스트/운영팀/기기고장/디쉐어-김포사우점/X7500LX, X3220NR->X7500LX(리퍼) 2대/확인서서명필수", note, true)).toBe("디쉐어-김포사우점");
  });
  it("'유상A/S' 행위어는 업체명에서 걷어낸다", () => {
    expect(importedTicketVendor("유상A/S\t \t\t북마을\t종료일\t\t 지역\t\t접수일\t10. 20")).toBe("북마을");
  });
  it("AS 제목은 FIELD 변환과 같은 업체명부(등급 접두 뒤, 마감 꼬리 앞)", () => {
    expect(importedTicketVendor("여분요청\t N\tSL-X3220NR\t7N건아토건(주)-분기마감\t종료일\t27. 5. 7\t 지역\t수도권B")).toBe("건아토건(주)");
    expect(importedTicketVendor("셋팅요청\t V\tSL-X7500LX\t12#V주식회사 디쉐어양주옥정지점백업/합산매월마감\t종료일\t27. 10. 22")).toBe("주식회사 디쉐어양주옥정지점백업/합산");
  });
  it("결과는 80자를 넘지 않는다", () => {
    expect(importedTicketVendor("가".repeat(150)).length).toBeLessThanOrEqual(80);
  });
  it("연차·휴가 일정은 제목 그대로 — 화면의 /휴가|연차/ 필터가 업체명 칸을 본다", () => {
    expect(importedTicketVendor("연차 이혁주 잔여 4일", "", true)).toBe("연차 이혁주 잔여 4일");
  });
  it("웹앱(src/ids)과 엣지(_shared)가 같은 함수를 쓴다", () => {
    expect(logisticsTicketInfo).toBe(sharedLogistics);
    expect(fieldTicketVendor("이민구 셋팅요청 S D450 30S업체명테스트 분기마감").gubun).toBe("세팅");
  });
  it("엣지 동기화가 제목 앞 80자를 업체명으로 넣지 않는다", () => {
    const src = readFileSync("supabase/functions/naver-calendar-sync/index.ts", "utf8");
    expect(src).not.toMatch(/vendor:\s*ev\.title\.slice/);
    expect(src).toMatch(/vendor:\s*importedTicketVendor\(ev\.title/);
  });
  it("물류 FIELD 버튼은 전체 제목(calendarTitle)을 넘기고, App 파서가 그것을 먼저 읽는다", () => {
    const ws = readFileSync("src/CsAsWorkspace.tsx", "utf8");
    const calls = ws.match(/onLogistics\??\.?\(\{[^}]*\}\)/g) || [];
    expect(calls.length).toBe(4);
    for (const call of calls) expect(call).toContain("calendarTitle: ticket.calendarTitle");
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toMatch(/logisticsTicketInfo\(`\$\{\(t as \{ calendarTitle\?: string \}\)\.calendarTitle \|\| t\.vendor/);
  });
});

describe("쓰기 전 조회 실패는 멈춘다", () => {
  it("readOrStop — 성공이면 행 그대로", async () => {
    await expect(readOrStop(Promise.resolve([{ id: "a" }]), "x")).resolves.toEqual([{ id: "a" }]);
  });
  it("readOrStop — 실패를 빈 배열로 바꾸지 않고 사람이 읽을 오류로 던진다", async () => {
    await expect(readOrStop(Promise.reject(new Error("조회 실패 as_tickets(503)")), "이미 만든 일정"))
      .rejects.toThrow(/이미 만든 일정 확인을 못 해서 멈췄어요.*as_tickets\(503\)/);
  });
  it("접수→일정 중복 검사(ServiceReception)는 조회 실패를 삼키지 않는다", () => {
    const src = readFileSync("src/ServiceReception.tsx", "utf8");
    const start = src.indexOf("const createTicketFromReception");
    const block = src.slice(start, src.indexOf("const ticketId", start));
    expect(block).toContain("readOrStop(");
    expect(block).not.toContain(".catch(() => [])");
  });
  it("완료/익일 처리(App finishTicket)는 일정 조회 실패 시 note 덮어쓰기 PATCH 전에 멈춘다", () => {
    const src = readFileSync("src/App.tsx", "utf8");
    const start = src.indexOf("const finishTicket = async");
    const block = src.slice(start, src.indexOf("await updateRows(\"as_tickets\"", start));
    expect(start).toBeGreaterThan(0);
    expect(block).not.toContain(".catch(() => [])");
    expect(block).toMatch(/\.catch\(\(e: Error\) => \{ throw new Error\(/);
  });
});

describe("IT 접수 일정 제목 탭 8칸(2026-10-31) — 엣지 공용 파서도 거래처명 칸만", () => {
  const T = "\t";
  const titles: Array<[string, string]> = [
    [`IT A/S${T}V${T}P2175${T}510QCUK567078${T}노트북${T}15Z90S-GP56ML${T}화면 깜빡임${T}주식회사 올리브인터내셔널`, "주식회사 올리브인터내셔널"],
    [`IT A/S${T}S${T}${T}5CG1234XYZ${T}데스크탑${T}HP 400 G7${T}부팅 안 됨 셋팅요청${T}(주)한빛 / 강남지점`, "(주)한빛 / 강남지점"],
    [`이호준-IT A/S${T}N${T}${T}${T}모니터${T}${T}${T}다온세무회계`, "다온세무회계"],
  ];
  it.each(titles)("%s → %s", (title, vendor) => {
    expect(fieldTicketVendor(title).vendor).toBe(vendor);
    expect(importedTicketVendor(title)).toBe(vendor);
  });
  it("탭이 공백으로 바뀐 옛 IT 제목은 예전 규칙 그대로", () => {
    expect(fieldTicketVendor("IT A/S V 16ZD90SU 25V주식회사 가짜테크 매월마감 종료일 28. 1. 20").vendor).toBe("주식회사 가짜테크");
  });
});
