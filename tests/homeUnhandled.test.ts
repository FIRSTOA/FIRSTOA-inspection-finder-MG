import { describe, expect, it } from "vitest";
import { countUnhandledKinds, countUnhandledTabs, filterUnhandled, mergeUnhandled, receptionTeam, parseSortOrder, rowsForTab, sortUnhandled, UNHANDLED_SORT_KEY, splitByGroup, ticketDetail, UNHANDLED_KINDS, type ReceptionInput, type TicketInput } from "../src/homeUnhandled";
import { isOverdueTicket } from "../src/overdueLogic";

const today = "2026-10-19";
const rec = (id: string, type: string, region: string, date: string, handler = ""): ReceptionInput => ({
  id, type, region, receipt_date: date, vendor: `업체${id}`, status: "접수", remote_meta: handler ? { handler } : null,
});
const tic = (id: string, scheduleType: string, team: string, date: string, receptionId = ""): TicketInput => ({
  id, scheduleType, team, date, vendor: `일정${id}`, assignee: "", status: "배정", receptionId,
});

const receptions = [
  rec("r1", "복합기 AS", "수도권A", "2026-10-10"),
  rec("r2", "원격이관", "강원도", "2026-10-15"),
  rec("r3", "경영지원", "수도권B", "2026-10-12", "이윤아"),
  rec("r4", "영업팀", "", "2026-10-18"),
];
const tickets = [
  tic("t1", "AS", "A", "2026-10-11", "r1"),       // 복합기 AS 접수 r1 은 세지 않으므로 일정으로 센다(2026-10-25)
  tic("t2", "AS", "C", "2026-10-05", "gone"),     // 접수가 닫혔거나 90일 밖 → AS일정
  tic("t3", "AS", "D", "2026-10-16"),             // 접수 연결 없음 → AS일정
  tic("t4", "납품철수교체휴가교육", "B", "2026-10-01", "r3"), // 물류는 연결 있어도 포함
  tic("t5", "물류", "E", "2026-10-17"),
];

describe("홈 미처리 토탈", () => {
  const rows = mergeUnhandled(receptions, tickets, today);

  it("복합기 AS 는 일정 기준: 복합기 접수 행은 빼고, AS 일정은 전부 CS접수 칸", () => {
    expect(rows.find((r) => r.key === "r:r1")).toBeUndefined();
    for (const k of ["t:t1", "t:t2", "t:t3"]) expect(rows.find((r) => r.key === k)?.kind).toBe("CS접수");
    expect(rows.filter((r) => r.source === "reception").map((r) => r.receptionId).sort()).toEqual(["r2", "r3", "r4"]);
    expect(rows).toHaveLength(8);
    expect(UNHANDLED_KINDS as string[]).toEqual(["CS접수", "원격이관", "IT", "경영지원", "운영지원", "영업팀", "물류"]); // 옛 복합기 AS·AS일정 칸 없음
  });

  it("물류(납품철수교체휴가교육·물류)는 전부 들어가고 팀은 일정 팀", () => {
    const logi = rows.filter((r) => r.kind === "물류");
    expect(logi.map((r) => r.key).sort()).toEqual(["t:t4", "t:t5"]);
    expect(logi.find((r) => r.key === "t:t4")?.team).toBe("B");
  });

  it("팀·부서 매핑과 담당, 오래된 순", () => {
    expect(receptionTeam("복합기 AS", "수도권A")).toBe("A");
    expect(receptionTeam("원격이관", "강원도")).toBe("E");
    expect(receptionTeam("IT", "")).toBe("");
    expect(receptionTeam("경영지원", "수도권B")).toBe("경영");
    expect(receptionTeam("운영지원", "수도권C")).toBe("운영");
    expect(receptionTeam("영업팀", "")).toBe("영업");
    const r3 = rows.find((r) => r.key === "r:r3");
    expect(r3?.assignee).toBe("이윤아");
    expect(r3?.ageDays).toBe(7);
    expect(rows[0].key).toBe("t:t4");
    expect(rows.map((r) => r.date)).toEqual([...rows.map((r) => r.date)].sort());
  });

  it("필터와 탭별 건수", () => {
    const c = countUnhandledTabs(rows);
    expect(c["전체"]).toBe(8);
    expect(c.A).toBe(1);
    expect(c.B).toBe(1); // t4(물류·B) 포함
    expect(c.C).toBe(1);
    expect(c.D).toBe(1);
    expect(c.E).toBe(2); // r2 + t5(물류)
    expect(c["경영"]).toBe(1);
    expect(c["운영"]).toBe(0);
    expect(c["영업"]).toBe(1);
    expect(c.A + c.B + c.C + c.D + c.E + c["경영"] + c["운영"] + c["영업"]).toBe(c["전체"]);
    expect("물류" in c).toBe(false);
    expect(filterUnhandled(rows, "E", "물류").map((r) => r.key)).toEqual(["t:t5"]);
    const g = splitByGroup(rowsForTab(rows, "E"));
    expect(g.work.map((r) => r.key)).toEqual(["r:r2"]);
    expect(g.logistics.map((r) => r.key)).toEqual(["t:t5"]);
  });
});

describe("mergeUnhandled 원격대기 7일 규칙", () => {
  it("7일 지난 원격대기는 빼고 최근 원격대기·오래된 접수는 둔다", () => {
    const rows = mergeUnhandled([
      { ...rec("s1", "원격이관", "A", "2026-09-01"), status: "원격대기" },
      { ...rec("s2", "원격이관", "A", "2026-10-15"), status: "원격대기" },
      rec("s3", "원격이관", "A", "2026-09-01"),
    ], [], today);
    expect(rows.map((r) => r.receptionId).sort()).toEqual(["s2", "s3"]);
  });
});

// 재현(2026-10-25 사용자 스크린샷): C팀 "접수·AS 8건" — 복합기 AS 접수(service_receptions 접수/진행중)가 일정 없이(6건) 또는
// 다음 날 일정(2건)만 있어서 일정리스트 [미처리]엔 없는데 홈 미처리엔 남았다.
describe("홈 CS접수 = 일정리스트 [미처리]와 같은 판정(2026-10-25)", () => {
  const t = "2026-10-25";
  const copier = (id: string, date: string, status = "접수"): ReceptionInput => ({ ...rec(id, "복합기 AS", "수도권C", date), status });
  const rs = [
    copier("c1", "2026-08-18", "진행중"), // 20SS선도전기 — 네이버에서만 완료, 연결 일정 없음
    copier("c2", "2026-09-03"),           // 에이준재활의학과 — 일정 없음
    copier("c3", "2026-10-23"),           // 와이즈조인 — 일정 10-26(익일)
    rec("x1", "원격이관", "수도권C", "2026-10-20"),
  ];
  const ts: TicketInput[] = [
    { ...tic("k1", "익일AS", "C", "2026-10-26", "c3"), status: "익일" }, // 아직 날짜 안 지남
    tic("k2", "AS", "C", "2026-10-24"),                                   // 지난 날짜·미완료 → 미처리
    { ...tic("k3", "AS", "C", "2026-10-20"), status: "완료" },
    tic("k4", "매월점검", "C", "2026-10-10"),
    tic("k5", "익일AS", "C", "2026-10-22"),
    tic("k6", "납품철수교체휴가교육", "C", "2026-10-21"),
    tic("k7", "AS", "C", t),                                              // 오늘 = 아직 미처리 아님
    tic("k8", "AS", "C", "2026-10-19", "x1"),                             // 열린 원격 접수와 이어진 일정 → 접수 행으로만
  ];
  const rows = mergeUnhandled(rs, ts, t);

  it("일정 없는·날짜 안 지난 복합기 접수는 홈 미처리에 없다", () => {
    for (const id of ["c1", "c2", "c3"]) expect(rows.find((r) => r.receptionId === id)).toBeUndefined();
    expect(rows.find((r) => r.key === "t:k1")).toBeUndefined();
  });

  it("CS접수 칸 + 물류 칸 = 일정리스트 [미처리] 건수(같은 함수) − 열린 원격·IT 접수와 이어진 일정", () => {
    const kinds = countUnhandledKinds(rows);
    const listOverdue = ts.filter((x) => isOverdueTicket(x, t)); // CsAsWorkspace overdueCount 와 같은 조건
    expect(listOverdue.map((x) => x.id).sort()).toEqual(["k2", "k5", "k6", "k8"]);
    expect(kinds["CS접수"] + kinds["물류"]).toBe(listOverdue.length - 1); // k8 은 원격 접수 x1 행으로 센다
    expect(rows.filter((r) => r.kind === "CS접수").map((r) => r.key).sort()).toEqual(["t:k2", "t:k5"]);
    expect(rows.find((r) => r.receptionId === "x1" && r.source === "reception")?.kind).toBe("원격이관");
  });

  it("isOverdueTicket: 지난 날짜·완료 아님·매월점검 아님", () => {
    expect(isOverdueTicket({ date: "2026-10-24", status: "배정", scheduleType: "AS" }, t)).toBe(true);
    expect(isOverdueTicket({ date: t, status: "배정", scheduleType: "AS" }, t)).toBe(false);
    expect(isOverdueTicket({ date: "2026-10-24", status: "완료", scheduleType: "AS" }, t)).toBe(false);
    expect(isOverdueTicket({ date: "2026-10-24", status: "배정", scheduleType: "매월점검" }, t)).toBe(false);
  });
});

describe("일정 행 상세 본문 — 네이버에서 온 일정은 issue 가 비고 calendarTitle·note 에 내용(2026-10-25 사용자 \"물류 일정 내용이 왜 없음\")", () => {
  const today = "2026-10-25";
  const naverLogi: TicketInput = {
    id: "nv-1", team: "C", date: "2026-10-23", time: "15:00", vendor: "튜링", assignee: "김담우", status: "접수", scheduleType: "납품철수교체휴가교육",
    issue: "", calendarTitle: "기존 기기 구매전환-판매납품/퍼스트/튜링/X4220RX(리퍼)/확인서서명필수", note: "주소 서울 강남구 …\n담당 010-0000-0000", address: "서울 강남구 테헤란로 1",
  };
  it("제목은 issue 가 비면 calendarTitle, 팝업 정보 표 = 제목·시각·주소, 내용 칸 = 메모(2026-10-25 밤 팝업 틀)", () => {
    const rows = mergeUnhandled([], [naverLogi], today);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("물류");
    expect(rows[0].title).toBe(naverLogi.calendarTitle);
    expect(rows[0].fields).toEqual([
      { label: "제목", value: naverLogi.calendarTitle },
      { label: "시각", value: "15:00" },
      { label: "주소", value: "서울 강남구 테헤란로 1" },
    ]);
    expect(rows[0].detail).toBe(naverLogi.note);
    expect(rows[0].contentLabel).toBe("메모");
  });
  it("issue 가 있으면 제목은 issue, 본문에 제목·issue 둘 다(같으면 한 번)", () => {
    expect(ticketDetail({ issue: "토너 교체", calendarTitle: "토너 교체", note: "", address: "", time: "" })).toBe("토너 교체");
    expect(ticketDetail({ issue: "토너 교체", calendarTitle: "강남C 토너", note: "메모", address: "", time: "" })).toBe("강남C 토너\n토너 교체\n메모");
    expect(ticketDetail({})).toBe("");
  });
});

describe("미처리 정렬 sortUnhandled(2026-10-25 밤)", () => {
  const mk = (key: string, date: string) => ({ key, date }) as never;
  const rows = [mk("b", "2026-10-02"), mk("x", ""), mk("a", "2026-10-01"), mk("c", "2026-10-03")];
  const keys = (rs: Array<{ key: string }>) => rs.map((r) => r.key).join(",");
  it("오래된 순·최근 순 양방향, 날짜 없는 행은 어느 쪽이든 맨 아래, 원본 불변", () => {
    expect(keys(sortUnhandled(rows, "old"))).toBe("a,b,c,x");
    expect(keys(sortUnhandled(rows, "recent"))).toBe("c,b,a,x");
    expect(keys(rows)).toBe("b,x,a,c");
  });
  it("저장값 복원: recent 만 최근 순, 없음·깨진 값은 오래된 순, 키는 cs_unhandled_sort_v1", () => {
    expect(UNHANDLED_SORT_KEY).toBe("cs_unhandled_sort_v1");
    expect(parseSortOrder("recent")).toBe("recent");
    expect(parseSortOrder("old")).toBe("old");
    expect(parseSortOrder(null)).toBe("old");
    expect(parseSortOrder("zzz")).toBe("old");
  });
});
