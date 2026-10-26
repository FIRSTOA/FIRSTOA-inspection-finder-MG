// FIELD 전송 뒤 일정 맞춤 — 2026-10-27 "점검 갔는데 AS 일정 완료하겠냐고 뜸" 재발 방지.
// 실데이터(as_tickets 2026-10 질경이·디쉐어 행)를 줄여 옮긴 것.
import { describe, expect, it } from "vitest";
import { describeTicket, pickTicketsForSentForm, sameVendorBranch, sentFormKind, vendorBranchKey, type MatchTicketRow } from "../src/field/ticketMatch";

const TODAY = "2026-10-26";
const row = (p: Partial<MatchTicketRow> & { id: string }): MatchTicketRow => ({ status: "접수", scheduleType: "AS", date: TODAY, assignee: "", ...p });

const INSPECTION_FORM = "작성자: 이민구\n구분: 점검\n업체명: 디쉐어\n부서명 : 강남\n1.\n시리얼넘버: 595369\n자산기번: C3051\n";

describe("pickTicketsForSentForm", () => {
  it("점검 전송인데 같은 업체 일정이 AS뿐이면 후보 0 — 묻지 않는다", () => {
    const tickets = [row({ id: "as1", vendor: "디쉐어", scheduleType: "AS" })];
    const r = pickTicketsForSentForm(tickets, { vendor: "디쉐어", kind: "inspection", today: TODAY, author: "이민구", formText: INSPECTION_FORM });
    expect(r.candidates).toHaveLength(0);
    expect(r.needsChoice).toBe(false);
  });

  it("종류가 맞는 1건이면 그 건 하나 (AS 전송 → AS 일정, 매월점검은 제외)", () => {
    const tickets = [
      row({ id: "nv-질경이", vendor: "주식회사 질경이본사 4층", scheduleType: "AS", assignee: "이민구" }),
      row({ id: "rep-질경이", vendor: "질경이", scheduleType: "매월점검" }),
    ];
    const r = pickTicketsForSentForm(tickets, { vendor: "질경이 본사", kind: "as", today: TODAY, author: "이민구" });
    expect(r.candidates.map((c) => c.row.id)).toEqual(["nv-질경이"]);
    expect(r.needsChoice).toBe(false);
    expect(r.candidates[0].mine).toBe(true);
  });

  it("점검 전송은 매월점검 일정만 본다", () => {
    const tickets = [
      row({ id: "as", vendor: "디쉐어", scheduleType: "AS" }),
      row({ id: "rep", vendor: "디쉐어", scheduleType: "매월점검", date: "2026-10-28" }),
    ];
    const r = pickTicketsForSentForm(tickets, { vendor: "디쉐어", kind: "inspection", today: TODAY });
    expect(r.candidates.map((c) => c.row.id)).toEqual(["rep"]);
  });

  it("후보가 2건이면 자동으로 고르지 않는다 — 오늘·내 것이 먼저", () => {
    const tickets = [
      row({ id: "old", vendor: "레이어스튜디오", date: "2026-10-20", assignee: "김정민" }),
      row({ id: "todayOther", vendor: "레이어스튜디오", assignee: "김정민" }),
      row({ id: "todayMine", vendor: "레이어스튜디오-분기마감", assignee: "이민구,김정민" }),
    ];
    const r = pickTicketsForSentForm(tickets, { vendor: "레이어스튜디오", kind: "as", today: TODAY, author: "이민구" });
    expect(r.needsChoice).toBe(true);
    expect(r.candidates.map((c) => c.row.id)).toEqual(["todayMine", "todayOther", "old"]);
  });

  it("앞 글자가 같은 다른 지점은 뺀다 (디쉐어 강남 점검 ↔ 디쉐어대구 칠곡점 AS)", () => {
    const tickets = [
      row({ id: "칠곡", vendor: "주식회사 디쉐어대구 칠곡점매월마감", date: "2026-10-14", serial: "0A2HBJNHC0000ZZ", asset: "B8103" }),
      row({ id: "양주", vendor: "주식회사 디쉐어양주옥정지점백업/합산", scheduleType: "익일AS" }),
    ];
    expect(pickTicketsForSentForm(tickets, { vendor: "디쉐어", kind: "as", today: TODAY, formText: INSPECTION_FORM }).candidates).toHaveLength(0);
  });

  it("기번·자산번호가 맞으면 이름이 달라도 그 기기 일정만", () => {
    const tickets = [
      row({ id: "nv", vendor: "주식회사 질경이본사 4층" }),
      row({ id: "byAsset", vendor: "질경이 4층 3220", asset: "C0952" }),
    ];
    const r = pickTicketsForSentForm(tickets, { vendor: "질경이 본사", kind: "as", today: TODAY, formText: "업체명: 질경이 본사\n자산기번: C0952\n" });
    expect(r.candidates.map((c) => c.row.id)).toEqual(["byAsset"]);
    expect(r.candidates[0].by).toBe("기번");
  });

  it("완료·범위 밖(15일 전, 3일 뒤) 일정은 후보가 아니다", () => {
    const tickets = [
      row({ id: "done", vendor: "질경이", status: "완료" }),
      row({ id: "old", vendor: "질경이", date: "2026-10-11" }),
      row({ id: "far", vendor: "질경이", date: "2026-10-29" }),
    ];
    expect(pickTicketsForSentForm(tickets, { vendor: "질경이", kind: "as", today: TODAY }).candidates).toHaveLength(0);
  });
});

describe("sameVendorBranch", () => {
  it("층·본사·마감 꼬리는 같은 지점", () => {
    expect(sameVendorBranch("질경이 본사", "주식회사 질경이본사 4층")).toBe(true);
    expect(sameVendorBranch("디쉐어", "디쉐어")).toBe(true);
    expect(vendorBranchKey("주식회사 디쉐어양주옥정지점백업/합산")).toBe("디쉐어양주옥정지점");
  });
  it("짧은 상호만 같으면 다른 지점 — 10/15 김포사우점 AS 가 C팀 '디쉐어' 매월점검을 닫은 경우", () => {
    expect(sameVendorBranch("디쉐어", "주식회사 디쉐어김포사우점백업/합산")).toBe(false);
    expect(sameVendorBranch("디쉐어", "디쉐어 태전점")).toBe(false);
  });
  it("법인표기만 남는 양식 업체명(30V주식회사)은 아무 일정과도 안 맞는다 — 9~10월 매월점검 8건 오닫힘", () => {
    for (const v of ["주식회사 피앤씨솔루션", "주식회사 뉴트리원", "주식회사 레벨13", "주식회사 에이피더핀(AP The Fin Inc)"]) {
      expect(sameVendorBranch(v, "30V주식회사")).toBe(false);
    }
  });
  it("지점이 아닌 꼬리는 같은 곳으로 닫혀 온 그대로 (회귀 방지)", () => {
    expect(sameVendorBranch("엔티에스", "엔티에스케이투")).toBe(true);
    expect(sameVendorBranch("주식회사 뉴트리원", "주식회사 뉴트리원루터회관")).toBe(true);
    expect(sameVendorBranch("㈜파커스 (주식회사 제이앤테크 유지보수위탁)", "파커스")).toBe(true);
  });
  it("긴 상호 뒤 꼬리가 지점(…점·지점)이면 다른 지점, 지점이 아닌 꼬리는 같은 곳", () => {
    expect(sameVendorBranch("한국성간보", "주식회사 한국성간보부산지점 추가매월마감")).toBe(false);
    expect(sameVendorBranch("스투디움엑스퍼트학원1호점", "스투디움엑스퍼트학원2호점")).toBe(false);
    expect(sameVendorBranch("효성중공업 죽전역", "효성중공업㈜죽전역 해링턴 플레이스 더스카이 AS사무실매월마감")).toBe(true);
  });
});

describe("sentFormKind · describeTicket", () => {
  it("점검방 전송은 묻지 않는다, AS방·기타 모드는 AS", () => {
    expect(sentFormKind("inspection", "inspection")).toBeNull();
    expect(sentFormKind(undefined, "inspection")).toBeNull();
    expect(sentFormKind("as", "inspection")).toBe("as");
    expect(sentFormKind(undefined, "air-purifier")).toBe("as");
  });
  it("확인 문구에 날짜·종류·담당·제목이 나온다", () => {
    const [c] = pickTicketsForSentForm([row({ id: "x", vendor: "주식회사 질경이본사 4층", assignee: "이민구", issue: "출력 시 검은색 줄 생김\n2줄" })],
      { vendor: "질경이 본사", kind: "as", today: TODAY, author: "이민구" }).candidates;
    expect(describeTicket(c)).toBe("10/26(오늘) · AS · 담당 이민구(나) · 주식회사 질경이본사 4층 — 출력 시 검은색 줄 생김");
  });
});
