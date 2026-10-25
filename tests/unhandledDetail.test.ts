// 미처리 상세 팝업 본문(2026-10-25 밤 사용자 "시트면 시트에 있는 내용이 나와야지 — 잘린 듯")
import { describe, expect, it } from "vitest";
import { DETAIL_TEXT_MAX, headerError, parseSheetRows, SHEET_LAYOUTS, sheetRowDetail } from "../supabase/functions/reception-sheet-open/state";
import { normalizeSheetRowDetail } from "../src/receptionSheetOpen";
import { detailBodyText, detailSourceOf, receptionDetailBody, sheetDetailBody } from "../src/unhandledDetail";
import { mergeUnhandled, ticketContent, ticketFields, type TicketInput } from "../src/homeUnhandled";

/** 영업 탭 5행 머리(dept-sheet-spec SALES_COLUMNS 순서, 33열) */
const SALES_HEAD = [
  "순번", "접수일", "년월", "접수시간", "접수자", "처리자", "진행중/처리완료/보류/취소", "승인여부", "외근요청\n여부", "2차\n담당자", "2차\n체크여부",
  "순", "임대여부", "등급", "지역", "업체명", "접수유형", "접수분야", "자산번호", "미수개월수", "업체담당자", "전화번호", "접수내용", "처리내용",
  "모델명", "기본금액", "연평균", "계약일", "종료일", "남은개월", "기본매수", "초과장당금액", "주소",
];
const LONG = `안녕하세요 견적 금일중으로 부탁드립니다. 노트북 및 복합기 렌탈 가능여부 확인 부탁드립니다.\n둘째 줄\n${"가".repeat(DETAIL_TEXT_MAX - 80)}`;

function salesRow(over: Record<number, string> = {}): string[] {
  const r = Array.from({ length: 33 }, () => "");
  Object.assign(r, { 0: "1201", 1: "10월 20일", 2: "2610", 3: "10:12", 4: "이찬우", 5: "", 6: "진행중", 14: "수도권A", 15: "가나상사", 17: "견적", 20: "김담당", 21: "010-1234-5678", 22: LONG, 32: "서울 강남구 1" });
  for (const [k, v] of Object.entries(over)) r[Number(k)] = v;
  return r;
}

describe("엣지 state.sheetRowDetail — 시트 한 행 열 전부", () => {
  const L = SHEET_LAYOUTS.sales;
  it("목록 summary 는 40자로 잘린다(잘림의 원인) — 상세는 4,000자 내용 그대로", () => {
    const parsed = parseSheetRows(L, [SALES_HEAD, [], salesRow()]);
    expect(parsed.rows[0].summary.length).toBeLessThanOrEqual(41);
    const d = sheetRowDetail(L, SALES_HEAD, salesRow(), 7);
    expect(LONG.length).toBeLessThanOrEqual(DETAIL_TEXT_MAX);
    expect(d.content).toBe(LONG); // 줄바꿈·길이 그대로
    expect(d.contentLabel).toBe("접수내용");
  });
  it("열 전부(시트 순서), 빈 칸·전화번호 열 생략, 상태 머리는 '상태', 머리 줄바꿈은 공백", () => {
    const d = sheetRowDetail(L, SALES_HEAD, salesRow({ 8: "Y" }), 7);
    expect(d.cells.map((c) => c.label)).toEqual(["순번", "접수일", "년월", "접수시간", "접수자", "상태", "외근요청 여부", "지역", "업체명", "접수분야", "업체담당자", "주소"]);
    expect(d.cells.find((c) => c.label === "상태")?.value).toBe("진행중");
    expect(JSON.stringify(d)).not.toContain("010-1234-5678");
    expect(d.seq).toBe("1201");
    expect(d.cls).toBe("open");
  });
  it("4,000자 넘는 칸만 자른다, CRLF 는 줄바꿈 하나로", () => {
    const d = sheetRowDetail(L, SALES_HEAD, salesRow({ 22: "가".repeat(DETAIL_TEXT_MAX + 10), 23: "처리\r\n둘째" }), 7);
    expect(d.content.length).toBe(DETAIL_TEXT_MAX + 1);
    expect(d.content.endsWith("…")).toBe(true);
    expect(d.cells.find((c) => c.label === "처리내용")?.value).toBe("처리\n둘째");
  });
  it("같은 머리·같은 값이 두 번(경영 자산번호 T·BB)이면 한 번", () => {
    const head = ["순번", "접수일", "x", "x", "x", "x", "진행중/처리완료/보류/취소", "자산번호", "자산번호"];
    const d = sheetRowDetail({ ...SHEET_LAYOUTS.mgmt, summaryCol: 25 }, head, ["1", "10월 1일", "", "", "", "", "", "B1", "B1"], 7);
    expect(d.cells.filter((c) => c.label === "자산번호")).toHaveLength(1);
  });
  it("headerError: 상태 머리가 다르면 문구", () => {
    expect(headerError(L, SALES_HEAD)).toBe("");
    expect(headerError(L, ["순번", "", "", "", "", "", "상태"])).toContain("시트 머리 변경");
  });
});

describe("프런트 조립 — 시트 행 팝업 본문", () => {
  it("엣지 응답 → 본문 → '열 이름: 값' 줄(빈 칸 생략·내용 그대로)", () => {
    const d = normalizeSheetRowDetail({
      source: "sales", sheetRow: 7, seq: "1201", state: "진행중", contentLabel: "접수내용", content: LONG,
      cells: [{ label: "접수자", value: "이찬우" }, { label: "처리자", value: "  " }, { label: "", value: "x" }, { label: "업체명", value: "가나상사" }],
    });
    expect(d).not.toBeNull();
    const body = sheetDetailBody(d!);
    expect(body.fields).toEqual([{ label: "접수자", value: "이찬우" }, { label: "업체명", value: "가나상사" }]);
    expect(body.content).toBe(LONG);
    expect(detailBodyText(body)).toBe(`접수자: 이찬우\n업체명: 가나상사\n접수내용: ${LONG}`);
  });
  it("옛 엣지(목록만 줌)·이상한 응답은 null", () => {
    expect(normalizeSheetRowDetail(undefined)).toBeNull();
    expect(normalizeSheetRowDetail({ source: "x" })).toBeNull();
  });
});

describe("앱 접수 행 팝업 본문", () => {
  it("내용·증상·처리자·처리내용·비고·사진 수(썸네일 아님), 빈 칸 생략", () => {
    const b = receptionDetailBody({
      id: "9", author: "손영근", route: "카카오", title: "프린터 스캔 안 됨", symptom: "스캔 버튼 눌러도 반응 없음\n어제부터",
      notes: "오후만 방문 가능", photos: ["a.jpg", "b.jpg", null], remote_meta: { handler: "한왕주", handled: "드라이버 재설치" },
      receiver_name: "이서주", receiver_phone: "010-1111-2222", region: "수도권D", grade: "",
    });
    expect(b.content).toBe("프린터 스캔 안 됨\n\n스캔 버튼 눌러도 반응 없음\n어제부터");
    const map = Object.fromEntries(b.fields.map((f) => [f.label, f.value]));
    expect(map).toMatchObject({ 접수자: "손영근", 처리자: "한왕주", 처리내용: "드라이버 재설치", 비고: "오후만 방문 가능", 사진: "2장", "지역/등급": "수도권D", 업체담당자: "이서주 010-1111-2222" });
    expect(b.fields.some((f) => f.label === "기번")).toBe(false);
  });
  it("detailSourceOf: 시트 행 = sheet, 앱 접수 = reception, 일정 = null", () => {
    expect(detailSourceOf({ key: "s:sales:7", source: "reception", sheet: { source: "sales", row: 7, seq: "1", author: "", vendor: "" } })).toBe("sheet");
    expect(detailSourceOf({ key: "r:9", source: "reception", receptionId: "9" })).toBe("reception");
    expect(detailSourceOf({ key: "t:1", source: "ticket", receptionId: "9" })).toBeNull();
  });
});

describe("캘린더(as_tickets) 행 — 잘림 없음", () => {
  const note = `상호 : 튜링\n${"메".repeat(3990)}`;
  const title = "기존 기기 구매전환-판매납품/퍼스트/튜링/".padEnd(200, "x");
  const t: TicketInput = { id: "1", team: "C", date: "2026-10-23", time: "15:00", vendor: "튜링", assignee: "김담우", status: "접수", scheduleType: "AS", issue: "토너 교체", calendarTitle: title, note, address: "서울 강남구 테헤란로 1" };
  it("제목 200자·메모 4,000자 그대로(목록 행 fields·detail)", () => {
    const [row] = mergeUnhandled([], [t], "2026-10-25");
    expect(row.fields?.find((f) => f.label === "제목")?.value).toBe(title);
    expect(row.detail).toBe(`토너 교체\n\n${note}`);
    expect(ticketContent(t).length).toBe("토너 교체\n\n".length + note.length);
  });
  it("ticketFields: 빈 칸 생략, 제목 없으면 issue", () => {
    expect(ticketFields({ issue: "AS", calendarTitle: "", time: "", address: "" })).toEqual([{ label: "제목", value: "AS" }]);
    expect(ticketContent({ issue: "AS", calendarTitle: "", note: "" })).toBe("AS");
  });
});
