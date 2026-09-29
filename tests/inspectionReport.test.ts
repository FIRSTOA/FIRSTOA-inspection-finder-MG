import { describe, expect, it } from "vitest";
import { delta, keymanDisplayName, keymanMobile, matchPrevious, parseInspectionForm, tonerLow, wasteLow } from "../src/reportForm";

const RAW = `작성자: 박영현
구분: 점검
레벨: 1
등급 : S
업체명: 제이커브인베스트먼트
부서명 :
지역: C
키맨/접수자: 010-4080-9378 위지혜 팀장
ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ
1.
모델명: ApeosPort-C2060
시리얼넘버: 223495
자산기번: C6523
내용: 정기점검
처리내용: 정기점검
매수:흑46989 컬52132 큰컬21 합99121
토너잔량:K80 C50 M63 Y84
폐통: 70%
여분: K2,C2,M2,Y1,폐2
위지혜팀장 뒤 캐비넷에 보관
한틴이카유무: 한유
주차비지원유무: 가능/지원
특이사항:
ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ
※부품신청※
보증기간 내 여부 :
▶ 신청 부품
물품명:
ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ
※자가신청※
물품:
ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ
도착 시간: 14:20
소요 시간:

📷 현장사진 8장 모아보기:
https://firstoa-inspection-finder-mg.vercel.app/?album=0ee7db58-e993-4e13-86f7-276fee3df4ef`;

describe("점검 리포트 — 양식 원문 읽기", () => {
  const data = parseInspectionForm(RAW);
  it("머리: 업체·키맨 이름·번호·작성자·도착·앨범", () => {
    expect(data.vendor).toBe("제이커브인베스트먼트");
    expect(data.keymanName).toBe("위지혜 팀장");
    expect(data.keymanPhone).toBe("01040809378");
    expect(data.author).toBe("박영현");
    expect(data.arrival).toBe("14:20");
    expect(data.album).toContain("?album=0ee7db58");
    expect(data.albumCount).toBe(8);
  });
  it("기기 한 대: 매수·토너·폐통·여분·보관 위치. 부품/자가신청 칸은 기기로 세지 않는다", () => {
    expect(data.devices).toHaveLength(1);
    const d = data.devices[0];
    expect([d.model, d.serial, d.asset]).toEqual(["ApeosPort-C2060", "223495", "C6523"]);
    expect([d.mono, d.color, d.total]).toEqual([46989, 52132, 99121]);
    expect(d.toner).toEqual({ K: 80, C: 50, M: 63, Y: 84 });
    expect(d.waste).toBe(70);
    expect(d.spare).toEqual({ K: 2, C: 2, M: 2, Y: 1, W: 2 });
    expect(d.spareNote).toBe("위지혜팀장 뒤 캐비넷에 보관");
    expect(d.note).toBe("");
    expect(d.content).toBe("정기점검"); // AS 리포트에서는 접수 내용으로 쓴다('처리내용:' 줄은 '내용:'으로 잡히지 않는다)
  });
  it("지난 점검과 짝지어 증가분, 교체 기준(토너 25% 이하·폐토너통 여유 25% 이하)", () => {
    const prev = parseInspectionForm(RAW.replace("흑46989 컬52132 큰컬21 합99121", "흑44154 컬49205 큰컬21 합93359"));
    const p = matchPrevious(data.devices[0], prev);
    expect(p && delta(data.devices[0].mono, p.mono)).toBe(2835);
    expect(p && delta(data.devices[0].color, p.color)).toBe(2927);
    expect(delta(10, 20)).toBeNull();
    expect(tonerLow(25)).toBe(true); expect(tonerLow(26)).toBe(false);
    expect(wasteLow(25)).toBe(true); expect(wasteLow(26)).toBe(false); expect(wasteLow(80)).toBe(false);
  });
  it("키맨 이름은 직함까지만 — 위치 메모('5층에 계심')나 둘째 줄은 리포트에 안 나온다", () => {
    expect(keymanDisplayName("010-4080-9378 위지혜 팀장")).toBe("위지혜 팀장");
    expect(keymanDisplayName("이은선 차장님 5층에 계심 010-1111-2222")).toBe("이은선 차장");
    expect(keymanDisplayName("김담당 010-1111-2222\n총무팀 3층")).toBe("김담당");
    expect(keymanDisplayName("02-702-0670")).toBe("");
    expect(parseInspectionForm("업체명: 테스트\n키맨/접수자: 이은선 차장님 5층에 계심\n010-1234-5678").keymanName).toBe("이은선 차장");
  });
  it("키맨이 둘이고 유선번호가 섞여도 — 휴대폰 번호와 그 옆 사람(임미애 담당자)이 받는 사람", () => {
    const raw = "김수경차장님 본사총괄 02-561-6512 임미애 담당자님 010-5245-4254";
    expect(keymanMobile(raw)).toBe("01052454254");
    expect(keymanDisplayName(raw)).toBe("임미애 담당자");
    expect(keymanMobile("김수경차장님 02-561-6512")).toBe(""); // 유선만 있으면 MMS를 못 보내니 번호를 비워 둔다
    expect(keymanDisplayName("김수경차장님 02-561-6512")).toBe("김수경차장");
    expect(keymanDisplayName("010-5245-4254 임미애 담당자님 / 김수경차장님 본사총괄")).toBe("임미애 담당자");
  });
  it("기기 여러 대·토너 표기 변형", () => {
    const two = parseInspectionForm("업체명: 테스트\n키맨/접수자: 홍길동 010-1111-2222\nㅡㅡㅡㅡㅡ\n1.\n모델명: A\n자산기번: X1\n매수:흑100 컬200 큰컬- 합300\n토너잔량: K-20 C:30 M 40 Y50\n폐통: 80%\n여분: K1 C0 M0 Y0 폐1\nㅡㅡㅡㅡㅡ\n2.\n모델명: B\n시리얼넘버: S2\n매수:흑1 컬- 큰컬- 합1\n토너잔량:K90\nㅡㅡㅡㅡㅡ\n※부품신청※\n물품명:");
    expect(two.devices.map((d) => d.model)).toEqual(["A", "B"]);
    expect(two.devices[0].toner).toEqual({ K: 20, C: 30, M: 40, Y: 50 });
    expect(two.devices[0].spare).toEqual({ K: 1, C: 0, M: 0, Y: 0, W: 1 });
    expect(two.devices[1].color).toBeNull();
    expect(two.devices[1].toner).toEqual({ K: 90, C: null, M: null, Y: null });
    expect(two.keymanName).toBe("홍길동");
  });
});
