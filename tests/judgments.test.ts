/**
 * 판정 자동 테스트 — 실제로 터졌던 사고 사례를 박제해서, 판정 로직을 고칠 때
 * 과거 사고가 되살아나는지 배포 전에 잡는다. `npm test`로 실행.
 *
 * 케이스 출처(전부 실제 운영 사고/실데이터):
 *  - 재계약 212건 미분류: 워킨맵 재계약 이름이 "2109/27SS…" 형식
 *  - 무천디자인 오매칭 / 더채움 못 찾음: 법인 접두어·㈜ 표기 차이
 *  - 한성알앤씨 이력 못 찾음: 워킨맵 꼬리표가 키에 붙음
 *  - 워킨맵 190곳 "#" 접두("20#SS…", "2609/17#V…") 매칭 실패 (2026-08-14 발견)
 *  - 충청도가 D로, D가 E로 가던 지역 오판정
 *  - 내 일정 FIELD 불러오기가 분기점검을 AS로 변환하던 모드 감지 경로
 */
import { describe, expect, it } from "vitest";
import { fieldTicketVendor, historyCoreName, logisticsTicketInfo, normalizeId, parseEquipComment, parseInspectionBlocks, vendorMatchKey, workinVendorName } from "../src/ids";
import { normRegion } from "../src/region";
import { detectReportTypesFromInput, detectUnifiedInputMode } from "../src/fieldModes";
import { nextBusinessDay } from "../src/planDate";
import { parseCompanyAndGrade } from "../src/counterSmsParser";

describe("vendorMatchKey — 업체명 매칭 키", () => {
  it("㈜/(주) 표기 차이를 없앤다 (더채움 사고)", () => {
    expect(vendorMatchKey("㈜더채움자산운용")).toBe("더채움자산운용");
    expect(vendorMatchKey("(주)한성알앤씨")).toBe(vendorMatchKey("한성알앤씨"));
  });

  it("법인 접두어를 벗겨 앞부분 일치 오폭을 막는다 (무천디자인 사고)", () => {
    expect(vendorMatchKey("주식회사 무암")).toBe("무암");
    expect(vendorMatchKey("주식회사 무천디자인")).toBe("무천디자인");
    expect(vendorMatchKey("주식회사 무천디자인").startsWith(vendorMatchKey("주식회사 무암"))).toBe(false);
  });

  it("워킨맵 재계약 접두 '2109/27SS'를 벗긴다 (재계약 212건 미분류 사고)", () => {
    expect(vendorMatchKey("2109/27SS한성알앤씨매월마감")).toBe("한성알앤씨");
  });

  it("접두 번호와 등급 사이 #도 벗긴다 (워킨맵 190곳 — 20#SS·2609/17#V 형식)", () => {
    expect(vendorMatchKey("20#SS한불엠앤에스㈜1층 리셉션 사무실안쪽매월마감")).toBe("한불엠앤에스1층리셉션사무실안쪽");
    expect(vendorMatchKey("2609/17#V파인솔루션 주식회사506호C3608 기기이동 매월마감").startsWith("파인솔루션")).toBe(true);
    expect(vendorMatchKey("25#V보림토건(주) 3분기점검").startsWith("보림토건")).toBe(true);
  });

  it("마감 꼬리표를 벗긴다 (한성알앤씨 이력 못 찾던 사고)", () => {
    expect(vendorMatchKey("4S㈜화인브릿지학동로분기마감")).toBe("화인브릿지학동로");
    expect(vendorMatchKey("14SS㈜이오플랜본사1매월마감")).toBe("이오플랜본사1");
  });

  it("접두·꼬리 없는 평범한 이름은 그대로", () => {
    expect(vendorMatchKey("잡플러스")).toBe("잡플러스");
  });
  it("법인표기 위치 불문·괄호 메모 제거 — SQL vendor_key_와 정렬 (고객리포트 점검 0회 오표기 방지)", () => {
    expect(vendorMatchKey("블루닷 주식회사(bluedot Inc.)")).toBe("블루닷");
    expect(vendorMatchKey("블루닷")).toBe("블루닷");
    expect(vendorMatchKey("디자인멜로우 (비번 2580*)")).toBe("디자인멜로우");
  });
});

describe("historyCoreName — 통합이력 검색어 핵심 토큰", () => {
  it("접수 제목에서 업체명만 뽑는다 (퍼뮤니티 사례 — 통째 검색 0건 사고)", () => {
    expect(historyCoreName("여분요청 N SL-X3220NR 14N주식회사 퍼뮤니티 (Furmunity Corp.)-분기마감 종료일 28. 5. 14 지역 수도권C 접수")).toBe("퍼뮤니티");
    expect(historyCoreName("주식회사 무암 (Mooam)")).toBe("무암");
    expect(historyCoreName("이동유통 주식회사에스플러스인베스트먼트(유")).toBe("이동유통");
  });
  it("평범한 업체명은 그대로", () => {
    expect(historyCoreName("한성알앤씨")).toBe("한성알앤씨");
  });
  it("배정자 접두('이름 - ')를 벗긴다 — 사람 이름이 검색어가 되던 사고", () => {
    expect(historyCoreName("한왕주 - 전자계약서 작성 확인 / SS / 포바이포")).not.toBe("한왕주");
  });
  it("본사·지점 접미를 벗긴다 — '넥스트라이프본사'로 찾으면 놓치던 사고", () => {
    expect(historyCoreName("㈜넥스트라이프본사")).toBe("넥스트라이프");
    expect(historyCoreName("세무그룹청연청연 3층 입구왼쪽매년")).toBe("세무그룹청연청연");
  });
  it("보고 양식 단어(제목·방문전 등)는 검색어가 아니다", () => {
    expect(historyCoreName("제목 방문전 연락 요망 무천디자인 토너 전달")).toBe("무천디자인");
    expect(historyCoreName("방문후 확인 전달 셋팅")).not.toBe("방문후");
  });
  it("등급 접두 토큰(30S업체명)을 최우선으로 잡는다 — 브라더·셋팅요청 오탐 사고", () => {
    expect(historyCoreName("셋팅요청 S D450 30S제이드자산운용전 ㈜이도헬스케어")).toBe("제이드자산운용"); // "전(前)" 표기까지 벗긴다 — 검색 0건 사고
    expect(historyCoreName("여분전달 V D450 11V사단법인 안보경영연구원-백평")).toBe("안보경영연구원");
    expect(historyCoreName("여분요청 SS ECOSYS-M5521CDN K3개 브라더")).not.toBe("브라더");
  });
  it("슬래시 제목·#등급 접두도 뚫는다 — '제목'·'20#SS한불…' 오탐 사고", () => {
    expect(historyCoreName("제목/캘린더제목 이전셋팅 S SL-X7400LX 26S주식회사 피알유-방문 전날 연락요청분기마감")).toBe("피알유");
    expect(historyCoreName("한왕주 여분요청 SS ECOSYS-M5521CDN K3개 브라더 토너 3개 20#SS한불엠앤에스㈜1층 리셉션")).toBe("한불엠앤에스");
  });
});

describe("workinVendorName — 워킨맵 지명에서 표시용 업체명 (SQL workin_vendor_와 거울)", () => {
  it("접두 번호·등급을 벗기고 공백은 살린다 (통합이력 검색어용)", () => {
    expect(workinVendorName("14SS㈜이오플랜본사1매월마감")).toBe("㈜이오플랜본사1");
    expect(workinVendorName("2609/17#V파인솔루션 주식회사506호C3608 기기이동 매월마감")).toBe("파인솔루션 주식회사506호C3608 기기이동");
  });
  it("특이사항(/ 뒤)과 마감 꼬리를 자른다", () => {
    expect(workinVendorName("3NN 아스크스토리디에스 분기점검/토너 챙길 것")).toBe("아스크스토리디에스 분기점검");
    expect(workinVendorName("30S세무그룹청연-매년마감")).toBe("세무그룹청연"); // "매년" 꼬리 — 청연 이력 미스 수리
  });
  it("영문 괄호 꼬리와 뒤붙은 법인표기를 벗긴다 — 블루닷 이력 키 어긋남 수리", () => {
    expect(workinVendorName("30S블루닷 주식회사(bluedot Inc.)-분기마감")).toBe("블루닷");
    expect(workinVendorName("블루닷 주식회사(bluedot Inc.")).toBe("블루닷");
    // ㈜가 이름 중간에 낀 경우는 그대로 (꼬리만 벗긴다)
    expect(workinVendorName("15NN한불엠앤에스㈜1층")).toBe("한불엠앤에스㈜1층");
  });
});

describe("normalizeId — 기번/자산번호 비교 키", () => {
  it("기호·공백·대소문자를 무시한다", () => {
    expect(normalizeId("0A6X-BJMR 40001DY")).toBe("0a6xbjmr40001dy");
    expect(normalizeId("b7872")).toBe(normalizeId("B7872"));
  });
});

describe("normRegion — 지역 판정 (A~E 있으면 그 글자, 그 외 값 있으면 E)", () => {
  it("A~E 글자가 있으면 그 글자", () => {
    expect(normRegion("수도권A")).toBe("A");
    expect(normRegion("C지역")).toBe("C");
    expect(normRegion("c")).toBe("C");
    expect(normRegion("D")).toBe("D");
  });
  it("글자가 없으면 전부 E (충청도가 D로 가던 사고)", () => {
    expect(normRegion("충청남도 천안")).toBe("E");
    expect(normRegion("지방")).toBe("E");
    expect(normRegion("강남")).toBe("E");
  });
  it("빈 값은 빈 문자열 (지역 없음 검증용)", () => {
    expect(normRegion("")).toBe("");
    expect(normRegion("  ")).toBe("");
  });
});

describe("parseEquipComment — 워킨맵 comment '모델 / 시리얼' 분해", () => {
  it("공백 유무와 무관하게 첫 슬래시로 나눈다", () => {
    expect(parseEquipComment("ApeosPort-VII C5573(보탄) / 291047")).toEqual({ model: "ApeosPort-VII C5573(보탄)", serial: "291047" });
    expect(parseEquipComment("SL-X3220NR/0A6XBJMR40001DY")).toEqual({ model: "SL-X3220NR", serial: "0A6XBJMR40001DY" });
  });
  it("슬래시가 없으면 전부 모델, 빈 값은 빈 결과", () => {
    expect(parseEquipComment("BIZHUB-128DN")).toEqual({ model: "BIZHUB-128DN", serial: "" });
    expect(parseEquipComment("")).toEqual({ model: "", serial: "" });
  });
});

describe("detectUnifiedInputMode — 점검/AS 원문 자동 감지 (내 일정 FIELD 불러오기 경로)", () => {
  it("접수 마커가 2개 이상이면 AS(빈 양식) 계열", () => {
    expect(detectUnifiedInputMode("접수분야: AS\n방문담당자: 홍길동\n내용: 급지 불량")).toBe("blank-report");
  });
  it("첫 줄이 AS/여분요청/자가요청으로 시작하면 AS 계열", () => {
    expect(detectUnifiedInputMode("AS 프린터 급지 불량\n연락처 010")).toBe("blank-report");
    expect(detectUnifiedInputMode("A/S 요청드립니다")).toBe("blank-report");
    expect(detectUnifiedInputMode("여분요청 토너 K 2개")).toBe("blank-report");
  });
  it("점검 원문은 inspection — 분기점검이 AS로 변환되면 안 된다", () => {
    expect(detectUnifiedInputMode("업체명: 한성알앤씨\n지역: C\n매수: 흑12345 컬678 큰컬0 합13023\n토너잔량: K80 C70 M60 Y50")).toBe("inspection");
  });
});

describe("detectReportTypesFromInput — 구분 자동 감지", () => {
  it("구분/접수분야 줄에서 유형을 뽑는다", () => {
    expect(detectReportTypesFromInput("구분: 점검, AS")).toEqual(["점검", "AS"]);
    expect(detectReportTypesFromInput("접수분야: 여분")).toEqual(["여분"]);
    expect(detectReportTypesFromInput("구분: 셋팅")).toEqual(["세팅"]);
  });
  it("구분 줄이 없으면 첫 단어로 판정한다", () => {
    expect(detectReportTypesFromInput("점검 다녀왔습니다")).toEqual(["점검"]);
  });
});

describe("nextBusinessDay — 주말 건너뛰기 (주말 무근무 설계)", () => {
  it("주말을 건너뛴다 (8/17은 광복절 대체공휴일이라 18일)", () => {
    expect(nextBusinessDay("2026-08-15")).toBe("2026-08-18");
    expect(nextBusinessDay("2026-08-16")).toBe("2026-08-18");
    expect(nextBusinessDay("2026-08-21")).toBe("2026-08-24"); // 평범한 금 → 월
  });
  it("평일은 다음 날", () => {
    expect(nextBusinessDay("2026-08-17")).toBe("2026-08-18");
  });
  it("한국 공휴일(대체공휴일 포함)도 건너뛴다", () => {
    expect(nextBusinessDay("2026-08-14")).toBe("2026-08-18"); // 금 → 광복절 토·대체공휴일 월 건너뛰고 화
    expect(nextBusinessDay("2026-12-31")).toBe("2027-01-04"); // 신정(금) 건너뛰고 월
  });
});

describe("parseCompanyAndGrade — 카운터 문자 첫 줄 판정 (원본 로직 박제)", () => {
  it("V·SS는 v_group, 그 외는 s_group", () => {
    expect(parseCompanyAndGrade("SS한불엠앤에스매월마감").gradeGroup).toBe("v_group");
    expect(parseCompanyAndGrade("N정도테크매월마감").gradeGroup).toBe("s_group");
  });
  it("마감 키워드 앞까지가 업체명", () => {
    expect(parseCompanyAndGrade("SS한불엠앤에스매월마감").vendor).toBe("SS 한불엠앤에스");
  });
  it("빈 줄은 확인 바람 처리", () => {
    expect(parseCompanyAndGrade("").vendor).toBe("거래처 확인 바람");
  });
});

describe("parseInspectionBlocks — 점검 원문의 기기 블록 분해 (푸드나무 5대 사례)", () => {
  const FOODNAMU = [
    "4층", "모델명: L8900", "시리얼넘버: E76881M5F576410", "자산기번: B8547", "내용: 정기점검", "처리내용:",
    "매수:흑835 컬766 큰컬- 합1601", "토너잔량:K80 C80 M80 Y80", "폐통:        %", "여분:", "한틴이카유무:", "주차비지원유무:", "특이사항:",
    "ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ",
    "4층", "모델명: ApeosPort-C2560", "시리얼넘버: 226993", "자산기번: A0078", "내용: 정기점검", "처리내용: 정기점검",
    "매수:흑384481 컬85270 큰컬1576 합469751", "토너잔량:K48 C61 M52 Y58", "폐통: 20%",
    "여분: 4층 창고방에 통합보관", "K8 C5 M5 Y6 폐통 6개", "8900 1set",
    "한틴이카유무: 한조 한공X Ip따로 받아야함", "주차비지원유무: 주차장 자리 없을시 유료주차장이용", "특이사항:",
    "ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ",
    "지하1층", "모델명: ApeosPort-C2060", "시리얼넘버: 226750", "자산기번: A0077", "내용: 정기점검",
    "처리내용: 정기점검", "빨간색 출력 불량", "테스트패턴 5번 빨간색 100%20매 이상 출력으로 농도 강제 조정 처리",
    "매수:흑121755 컬74140 큰컬3795 합195895", "토너잔량:K34 C60 M57 Y58", "폐통: 70%", "여분: 4층 창고 통합 보관",
    "한틴이카유무: 한조", "주차비지원유무: 유", "특이사항: 없음",
  ].join("\n");
  it("기기 대수·기번·층·여러 줄 값을 정확히 나눈다", () => {
    const blocks = parseInspectionBlocks(FOODNAMU);
    expect(blocks.length).toBe(3);
    expect(blocks.map((b) => b.asset)).toEqual(["B8547", "A0078", "A0077"]);
    expect(blocks[0].loc).toBe("4층");
    expect(blocks[2].loc).toBe("지하1층");
    expect(blocks[1].counts).toBe("흑384481 컬85270 큰컬1576 합469751");
    expect(blocks[1].spare).toContain("통합보관");
    expect(blocks[1].spare).toContain("K8 C5 M5 Y6 폐통 6개"); // 여러 줄 여분이 붙는다
    expect(blocks[2].handled).toContain("농도 강제 조정 처리"); // 여러 줄 처리내용
    expect(blocks[2].special).toBe("없음");
  });
  it("원문이 없거나 블록이 아니면 빈 배열", () => {
    expect(parseInspectionBlocks("")).toEqual([]);
    expect(parseInspectionBlocks("단순 메모 텍스트")).toEqual([]);
  });
});

describe("fieldTicketVendor — 일정리스트→FIELD 변환의 업체명·구분 (네이버 미러 제목)", () => {
  const TITLE = "이민구 셋팅요청\t S\tD450\t30S제이드자산운용전 ㈜이도헬스케어/ 알에프헬스케어전 주식회사 제이드앤파트너스분기마감\t종료일\t27. 8. 24\t ";
  it("업체명부(슬래시·법인 병기 보존)만 남기고 마감·종료일 꼬리를 뗀다", () => {
    const parsed = fieldTicketVendor(TITLE);
    expect(parsed.vendor).toBe("제이드자산운용전 ㈜이도헬스케어/ 알에프헬스케어전 주식회사 제이드앤파트너스");
    expect(parsed.gubun).toBe("세팅"); // 셋팅요청 → 구분 세팅 (AS 고정이던 사고)
  });
  it("접수 경로의 평범한 업체명은 그대로", () => {
    expect(fieldTicketVendor("주식회사 무암")).toEqual({ vendor: "주식회사 무암", gubun: "A/S" });
  });
});

describe("logisticsTicketInfo — 물류 제목에서 고객사·품목·구분 (일정→FIELD 물류탭)", () => {
  it("슬래시 열차에서 품목 앞 세그먼트가 고객사", () => {
    expect(logisticsTicketInfo("네오정보 직송-판매납품/네오정보/개인영업/디스페이스코리아/안드로이드전자칠판 65형(본체+옵션(스탠드)/확인서서명필수"))
      .toEqual({ vendor: "디스페이스코리아", item: "안드로이드전자칠판 65형(본체+옵션(스탠드)", category: "납품" });
    expect(logisticsTicketInfo("◆◆◆◆◆ 오전9시고정-IT/납품(현장)/퍼스트/운영팀/증설/웅진컴퍼스-서울교육대학교 단기/I5일사노(리퍼) 6대/확인서서명필수").vendor)
      .toBe("웅진컴퍼스-서울교육대학교 단기");
    const out = logisticsTicketInfo("9시부터 수업이기에 오전 7~8시 사이 철수해야함-철수(일반)/퍼스트/현장종료/웅진컴퍼스-서울교육대학교 단기/D420 2대, 노트북6대/확인서서명필수");
    expect(out.vendor).toBe("웅진컴퍼스-서울교육대학교 단기");
    expect(out.category).toBe("철수");
  });
});
