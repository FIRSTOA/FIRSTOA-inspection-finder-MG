/**
 * 숫자 통일 2단계(2026-10-24) — 물류·재계약·불만·초과조정·미수를 활동 기록(activity_events) 대신 양식 원본 표로 센다.
 * 실측(MCP, 10/1~24): 불만 시트 입력 D팀 2건은 활동 기록이 아예 없다(활동 0 → 원본 2곳). 물류·재계약은 활동 = 원본(재전송 1건 묶음 뒤).
 * 이 파일은 "전(활동 기록) / 후(원본 표)" 숫자를 고정하고, 홈 KPI(countForms) = 팀 현황·순위표(mergeFormsIntoEvents → countFormEvents) = 조회 탭(formTally)을 확인한다.
 */
import { describe, expect, it } from "vitest";
import { countableEvents, toFieldRows, type FieldRaw } from "../src/workCount";
import type { ActivityEvent } from "../src/operations";
import {
  countFormEvents, countForms, fieldLogisticsRows, fieldReportLogistics, formTally, looseYmd, mergeFormsIntoEvents, misuFormRows, toFormTableRows, withFieldLogistics,
  type FormRaw,
} from "../src/formCount";
import { countOverageVisits } from "../src/kpi/kpiCompute";
import type { MisuVisit } from "../src/misuVisit";

const ROSTER: Record<string, string> = { 한왕주: "C", 이민구: "C", 박영현: "C", 양승원: "D", 정준영: "D", 김정민: "A", 이호준: "B", 권태혁: "B", 신정훈: "팀장" };
const teamOf = (a: string) => ROSTER[a] || "미지정";
const OCT = { from: "2026-10-01", to: "2026-10-24" };

const ev = (id: string, day: string, at: string, author: string, team: string, category: string, vendor: string, extra: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id, createdAt: at, activityDate: day, author, team, category, vendor, quantity: 1, machineCount: 0, sourceText: "", metadata: {}, status: "active", cancelledAt: "", cancelledBy: "", ...extra,
} as ActivityEvent);

/* 실측 모양 그대로(10월) */
const BULMAN: FormRaw[] = [
  // 시트 미러(불만-총괄담당자 시트) — FIELD [보내기]를 안 거쳐 activity_events 가 없다
  { id: 33146, created_at: "2026-10-01T15:26:52Z", "날짜": "2026-10-01T08:52:15.000Z", "작성자": "양승원", "지역": "", "_출처": "시트:불만-총괄담당자는 홍대경,신정훈", "_업체명": "로뎀나무교회", "접수/처리": "불만접수" },
  { id: 36612, created_at: "2026-10-12T15:27:18Z", "날짜": "2026-10-12T01:09:00.000Z", "작성자": "정준영", "지역": "", "_출처": "시트:불만-총괄담당자는 홍대경,신정훈", "_업체명": "참좋은교육에듀럭스", "접수/처리": "불만접수" },
  // 밤마다 다시 찍힌 created_at(10/23) — 날짜 칸은 7월 → 10월에 들어오면 안 된다
  { id: 40089, created_at: "2026-10-23T15:27:02Z", "날짜": "2026-07-02", "작성자": "이민구", "지역": "", "_출처": "시트:불만-총괄담당자는 홍대경,신정훈", "_업체명": "(주)엠와이씨엔엠", "접수/처리": "불만처리" },
];
const LOGI: FormRaw[] = [
  { id: 68, created_at: "2026-10-16T00:44:03Z", "작성일": "2026-10-16", "작성자": "한왕주", "구분": "철수", "거래처명": "섬김노인요양센타", "_업체명": "섬김노인요양센타", "_출처": "웹앱:물류", "수량": "1" },
  { id: 81, created_at: "2026-10-23T00:53:10Z", "작성일": "2026-10-23", "작성자": "한왕주", "구분": "납품", "거래처명": "뉴트리원-본사", "_업체명": "뉴트리원-본사", "_출처": "웹앱:물류", "수량": "2대" },
  { id: 85, created_at: "2026-10-23T09:28:09Z", "작성일": "2026-10-23", "작성자": "한왕주", "구분": "납품", "거래처명": "디지털자산 거래소 공동협의체-메인복합기", "_업체명": "디지털자산 거래소 공동협의체-메인복합기", "_출처": "웹앱:물류" },
  { id: 90, created_at: "2026-10-20T01:00:00Z", "작성일": "2026-10-20", "작성자": "신정훈", "구분": "납품", "거래처명": "팀장업체", "_업체명": "팀장업체", "_출처": "웹앱:물류" }, // 팀장 제외
  { id: 91, created_at: "2026-10-21T01:00:00Z", "작성일": "2026-10-21", "작성자": "한왕주", "구분": "교체", "거래처명": "오발송", "_업체명": "오발송", "_출처": "웹앱:물류", _hidden: true }, // 삭제 제외
];
// 같은 활동 기록 — 10/16 은 22초 사이 두 번 기록(연타), 10/23 오후 건은 업체명이 메모 글로 들어갔다
const LOGI_EVENTS: ActivityEvent[] = [
  ev("e1", "2026-10-16", "2026-10-16T00:44:03Z", "한왕주", "C", "logistics", "섬김노인요양센타", { metadata: { logisticsCategory: "철수" } }),
  ev("e2", "2026-10-16", "2026-10-16T00:44:26Z", "한왕주", "C", "logistics", "섬김노인요양센타", { metadata: { logisticsCategory: "철수" } }),
  ev("e3", "2026-10-23", "2026-10-23T00:53:10Z", "한왕주", "C", "logistics", "뉴트리원-본사", { metadata: { logisticsCategory: "납품" } }),
  ev("e4", "2026-10-23", "2026-10-23T09:28:11Z", "한왕주", "C", "logistics", "⭐오후 4시반 이후 IP 현황 사진 참조⭐-납품(일반)", { metadata: { logisticsCategory: "납품" } }),
];

/* 점검·AS 양식의 구분 칸 여분·세팅·마감 → 물류(App.tsx recordFieldOperations 와 같은 판정) */
const frow = (id: number, author: string, vendor: string, types: string, day = "2026-10-14"): FieldRaw => ({
  id, "작성일": day, created_at: `${day}T02:00:00Z`, "작성자": author, "지역": ROSTER[author] || "", "_업체명": vendor, "업체명": vendor, "_출처": "카톡:웹앱",
  "모델명": "C3070", "시리얼넘버": `S${id}9`, "자산기번": "", "_원문": "", "구분": types, _hidden: false,
});
const FIELD = [
  ...toFieldRows("jeomgeom", [frow(1, "권태혁", "라비에벨", "여분, 점검"), frow(2, "이호준", "원종동153번", "점검, 여분, 세팅"), frow(3, "권태혁", "아이에스건설 신림현장", "점검, 세팅"), frow(4, "이민구", "손", "점검, 마감"), frow(5, "이호준", "일반점검", "점검")], teamOf),
  ...toFieldRows("as_records", [frow(11, "권태혁", "라비에벨", "AS, 여분, 점검")], teamOf), // 같은 양식이 두 표에 → 1건
];

describe("formCount — 원본 표 규칙", () => {
  it("날짜 칸: UTC 시각 글자는 KST 날짜, 점·빗금 날짜도 읽는다", () => {
    expect(looseYmd("2026-10-01T08:52:15.000Z")).toBe("2026-10-01");
    expect(looseYmd("2026-09-30T16:00:00.000Z")).toBe("2026-10-01");
    expect(looseYmd("2026.10.2")).toBe("2026-10-02");
    expect(looseYmd("6월 19일")).toBe("");
    // 불만 카톡 가져오기·시트 Date 글자(2026-10-24 실측 114행)
    expect(looseYmd("2024. 5. 23")).toBe("2024-05-23");
    expect(looseYmd("Thu Aug 24 2023 00:00:00 GMT+0900 (Korean Standard Time)")).toBe("2023-08-24");
    expect(looseYmd("26-07-13")).toBe("2026-07-13");
  });

  it("날짜 칸을 못 읽으면 created_at 으로 대신하지 않는다 — 8/27 일괄 가져오기 행이 8월 숫자로 새지 않게(QA 2026-10-24)", () => {
    const raws: FormRaw[] = [
      { id: 1, created_at: "2026-08-26T16:42:34Z", "날짜": "2024. 7. 22", "작성자": "이민구", "_출처": "카톡:불만(C,D)", "_업체명": "옛업체" },          // 2024년 기록
      { id: 2, created_at: "2026-08-26T16:43:00Z", "날짜": "Wed Mar 25 2026 00:00:00 GMT+0900", "작성자": "이민구", "_출처": "카톡:불만(C,D)", "_업체명": "삼월업체" },
      { id: 3, created_at: "2026-08-26T16:44:00Z", "날짜": "7월 쯤", "작성자": "이민구", "_출처": "카톡:불만(C,D)", "_업체명": "모름업체" },               // 못 읽음 → 제외
      { id: 4, created_at: "2026-10-23T15:27:02Z", "날짜": "", "작성자": "양승원", "_출처": "시트:불만-총괄담당자는 홍대경,신정훈", "_업체명": "빈칸미러" }, // 미러 빈 칸 → 제외
      { id: 5, created_at: "2026-08-20T02:00:00Z", "날짜": "", "작성자": "이민구", "_출처": "웹앱:불만", "_업체명": "빈칸웹앱" },                         // FIELD 빈 칸 → 저장 날짜
    ];
    const rows = toFormTableRows("bulman", raws, teamOf);
    expect(rows.map((r) => r.day)).toEqual(["2024-07-22", "2026-03-25", "", "", "2026-08-20"]);
    expect(countForms("complaint", rows, "2026-08-01", "2026-08-31")).toBe(1); // 예전(created_at 대신) 4곳
    expect(countForms("complaint", rows, "2026-03-01", "2026-03-31")).toBe(1);
    expect(countForms("complaint", rows, "2026-10-01", "2026-10-31")).toBe(0);
    expect(formTally("complaint", rows, {}).rows).toBe(5); // 기간 없으면 다 보임(목록과 같은 행 수)
  });

  it("불만(시트 입력) — 전: 활동 기록 0곳 / 후: 원본 D팀 2곳(누수 2), 7월 날짜 미러 행은 10월에 안 들어옴", () => {
    const rows = toFormTableRows("bulman", BULMAN, teamOf);
    const before = countFormEvents("complaint", countableEvents([])); // 10월 activity_events complaint = 0행(실측)
    expect(before).toBe(0);
    expect(countForms("complaint", rows, OCT.from, OCT.to)).toBe(2);
    expect(countForms("complaint", rows, OCT.from, OCT.to, { team: "D" })).toBe(2);
    expect(countForms("complaint", rows, OCT.from, OCT.to, { team: "C" })).toBe(0);
    expect(countForms("complaint", rows, "2026-07-01", "2026-07-31")).toBe(1);
  });

  it("물류(물류 양식) — 전: 활동 4행 → 재전송 묶음 3 / 후: 원본 3(팀장·삭제 제외), 숫자 같음", () => {
    const rows = toFormTableRows("logistics_records", LOGI, teamOf);
    expect(countableEvents(LOGI_EVENTS).filter((e) => e.category === "logistics")).toHaveLength(3);
    expect(countForms("logistics", rows, OCT.from, OCT.to)).toBe(3);
    expect(countForms("logistics", rows, OCT.from, OCT.to, { part: "main", team: "C" })).toBe(3);
  });

  it("점검·AS 양식의 여분·세팅·마감 → 물류 기타/물류 칸(두 표에 든 같은 양식은 1건, '여분, 세팅'은 여분)", () => {
    expect(fieldReportLogistics("점검, 여분, 세팅")).toBe("여분");
    expect(fieldReportLogistics("점검, 셋팅")).toBe("세팅");
    expect(fieldReportLogistics("점검, 재계약및 초과")).toBe("");
    const rows = fieldLogisticsRows(FIELD);
    expect(rows).toHaveLength(5); // 라비에벨 2(두 표) + 원종동 + 아이에스 + 손
    expect(countForms("logistics", rows, OCT.from, OCT.to, { part: "etc" })).toBe(3); // 라비에벨 1 · 원종동 1 · 손(마감) 1
    expect(countForms("logistics", rows, OCT.from, OCT.to, { part: "main" })).toBe(1); // 아이에스 세팅
  });

  it("재계약 — 업체 수(같은 업체 다른 날 2번 = 1곳), 조회 탭 설명 수", () => {
    const raws: FormRaw[] = [
      { id: 3533, created_at: "2026-10-15T05:07:17Z", "날짜": "2026-10-15", "작성자": "박영현", "지역": "C", "_출처": "웹앱:재계약", "_업체명": "주식회사 케이웨이컴퍼니" },
      { id: 3600, created_at: "2026-10-20T05:07:17Z", "날짜": "2026-10-20", "작성자": "박영현", "지역": "C", "_출처": "웹앱:재계약", "_업체명": "케이웨이컴퍼니" }, // 2차 방문
      { id: 3535, created_at: "2026-10-21T01:24:21Z", "날짜": "2026-10-21", "작성자": "김정민", "지역": "A", "_출처": "웹앱:재계약", "_업체명": "바디챌린지" },
      { id: 3525, created_at: "2026-06-20T06:28:39Z", "날짜": "26-07-13", "작성자": "", "_출처": "카톡:재계약(C)", "_업체명": "넥스브레인" }, // 글자 날짜 → created_at(6월)
    ];
    const rows = toFormTableRows("recontract", raws, teamOf);
    expect(countForms("recontract", rows, OCT.from, OCT.to)).toBe(2);
    expect(countForms("recontract", rows, OCT.from, OCT.to, { team: "C" })).toBe(1);
    expect(formTally("recontract", rows, { ...OCT, team: "C" })).toEqual({ count: 1, rows: 2, managers: 0, resends: 0, sameVendor: 1 });
    expect(rows.find((r) => r.id === "3525")?.team).toBe("C"); // 출처 괄호 팀
  });

  it("초과조정 — kpiCompute.countOverageVisits(K10) = countForms(overage)", () => {
    const raws: FormRaw[] = [
      { id: 1, created_at: "2026-10-20T02:00:00Z", "방문일": "2026-10-20", "작성자": "한왕주", "지역": "C", "_업체명": "가" },
      { id: 2, created_at: "2026-10-20T02:05:00Z", "방문일": "2026.10.20", "작성자": "한왕주", "지역": "C", "_업체명": "가" }, // 재전송
      { id: 3, created_at: "2026-10-21T02:00:00Z", "방문일": "6월 19일", "작성자": "양승원", "_출처": "카톡:초과업체조정(D)", "_업체명": "나" }, // 연도 없는 글자 날짜 → 제외(created_at 으로 대신 안 함)
      { id: 4, created_at: "2026-10-22T02:00:00Z", "방문일": "", "작성자": "양승원", "_출처": "웹앱:초과조정", "_업체명": "다" }, // FIELD 빈 칸 → 저장 날짜
    ];
    const rows = toFormTableRows("overage_adjust", raws, teamOf);
    expect(countForms("overage", rows, OCT.from, OCT.to)).toBe(2);
    expect(countOverageVisits(rows, OCT)).toBe(2);
    expect(countForms("overage", rows, OCT.from, OCT.to, { team: "D" })).toBe(1);
    expect(countOverageVisits(rows, { ...OCT, team: "D" })).toBe(countForms("overage", rows, OCT.from, OCT.to, { team: "D" }));
  });

  it("미수 방문 — 보완 기록은 원 기록 1건, 숨김 제외", () => {
    const base = { visit_round: "1차", author_sub: "", vendor: "가나상사", company_code: "", site_code: "", lease_seq: "" } as unknown as MisuVisit;
    const visits = [
      { ...base, id: "v1", created_at: "2026-10-20T01:00:00Z", visited_at: "2026-10-20T01:00:00Z", author: "양승원", author_team: "D", _hidden: false, supplement_of: null },
      { ...base, id: "v2", created_at: "2026-10-20T03:00:00Z", visited_at: "2026-10-20T01:00:00Z", author: "양승원", author_team: "D", _hidden: false, supplement_of: "v1" },
      { ...base, id: "v3", created_at: "2026-10-21T01:00:00Z", visited_at: "2026-10-21T01:00:00Z", author: "양승원", author_team: "D", vendor: "다라", _hidden: true, supplement_of: null },
    ] as unknown as MisuVisit[];
    const rows = misuFormRows(visits, teamOf);
    expect(countForms("misu", rows, OCT.from, OCT.to)).toBe(1);
    expect(countForms("misu", rows, OCT.from, OCT.to, { team: "D" })).toBe(1);
  });
});

describe("10월 물류 실측 모양 고정 — 활동 기록(전) = 원본 표 countForms(후) = 합성 활동(팀 현황·순위표)", () => {
  // MCP 실측(10/1~24): 물류 양식 표 main A1 B7 C19 D16 · 점검·AS 양식 세팅 B3 C2(행 3, C 하나는 '점검, AS'로 두 표) D1
  //                   · 여분 A3 B11 C10 · 마감 C1 · 여분 D9 → 물류 A/B/C/D 1/10/21/17 = 49, 기타 34
  //                   활동 기록: 물류 양식 44행(C 10/16 22초 연타 1 포함) + 점검·AS 양식 40행
  const AUTH: Record<string, string> = { A: "김정민", B: "이호준", C: "이민구", D: "양승원" };
  const day = (i: number) => `2026-10-${String(1 + (i % 24)).padStart(2, "0")}`;
  const logiRaw: FormRaw[] = [];
  const fieldRaw: { j: FieldRaw[]; a: FieldRaw[] } = { j: [], a: [] };
  const events: ActivityEvent[] = [];
  let n = 0;
  const addLogi = (team: string, count: number) => {
    for (let i = 0; i < count; i++, n++) {
      const v = `물류${team}${i}`, d = day(n), at = `${d}T0${i % 10}:00:00Z`;
      logiRaw.push({ id: 1000 + n, created_at: at, "작성일": d, "작성자": AUTH[team], "구분": "납품", "거래처명": v, "_업체명": v, "_출처": "웹앱:물류" });
      events.push(ev(`l${n}`, d, at, AUTH[team], team, "logistics", v, { metadata: { logisticsCategory: "납품" } }));
    }
  };
  const addField = (team: string, types: string, kind: string, count: number, twoTables = 0) => {
    for (let i = 0; i < count; i++, n++) {
      const v = `${kind}${team}${i}`, d = day(n);
      const row = { ...frow(2000 + n, AUTH[team], v, types, d), "지역": team };
      fieldRaw.j.push(row);
      if (i < twoTables) fieldRaw.a.push({ ...row, id: 5000 + n, "구분": `AS, ${types}` });
      events.push(ev(`f${n}`, d, `${d}T02:00:00Z`, AUTH[team], team, "logistics", v, { metadata: { logisticsCategory: kind } }));
    }
  };
  addLogi("A", 1); addLogi("B", 7); addLogi("C", 19); addLogi("D", 16);
  const c0 = logiRaw.find((r) => r["작성자"] === AUTH.C)!;
  events.push(ev("dup", String(c0["작성일"]), "2026-10-02T00:00:22Z", AUTH.C, "C", "logistics", String(c0["_업체명"]), { metadata: { logisticsCategory: "납품" } })); // 22초 연타
  events.find((e) => e.vendor === c0["_업체명"] && e.id !== "dup")!.createdAt = "2026-10-02T00:00:00Z";
  addField("B", "점검, 세팅", "세팅", 3); addField("C", "점검, 세팅", "세팅", 2, 1); addField("D", "점검, 세팅", "세팅", 1);
  addField("A", "여분, 점검", "여분", 3); addField("B", "여분, 점검", "여분", 11); addField("C", "점검, 여분", "여분", 10); addField("C", "점검, 마감", "마감", 1); addField("D", "여분, 점검", "여분", 9);
  const field = [...toFieldRows("jeomgeom", fieldRaw.j, teamOf), ...toFieldRows("as_records", fieldRaw.a, teamOf)];
  const forms = withFieldLogistics({ logistics: toFormTableRows("logistics_records", logiRaw, teamOf) }, field);
  const isEtc = (e: ActivityEvent) => ["여분", "마감"].includes(String(e.metadata?.logisticsCategory || ""));

  it("팀별 물류 1/10/21/17 · 기타 34 가 전·후·합성에서 같다", () => {
    expect(events).toHaveLength(84); // 활동 기록 84행(물류 양식 44 + 점검·AS 양식 40)
    const before = countableEvents(events);
    const merged = countableEvents(mergeFormsIntoEvents(events, forms));
    const main: Record<string, number> = { A: 1, B: 10, C: 21, D: 17 };
    let etcTotal = 0;
    for (const team of ["A", "B", "C", "D"]) {
      const b = before.filter((e) => e.team === team), m = merged.filter((e) => e.team === team);
      const after = countForms("logistics", forms.logistics!, OCT.from, OCT.to, { part: "main", team });
      expect([b.filter((e) => !isEtc(e)).length, after, m.filter((e) => !isEtc(e)).length]).toEqual([main[team], main[team], main[team]]);
      const etc = countForms("logistics", forms.logistics!, OCT.from, OCT.to, { part: "etc", team });
      expect([b.filter(isEtc).length, m.filter(isEtc).length]).toEqual([etc, etc]);
      etcTotal += etc;
    }
    expect(etcTotal).toBe(34);
    expect(countForms("logistics", forms.logistics!, OCT.from, OCT.to)).toBe(49 + 34);
  });
});

describe("같은 숫자 — 홈 KPI(countForms) = 팀 현황·순위표(활동 목록 합성) = 조회 탭(formTally)", () => {
  const forms = withFieldLogistics({
    logistics: toFormTableRows("logistics_records", LOGI, teamOf),
    complaint: toFormTableRows("bulman", BULMAN, teamOf),
  }, FIELD);
  // 팀 현황 입구: 활동 기록(물류 4행 + 담당자 변경 1행) → 양식 종류는 표 원본으로 교체 → 팀장 제외 → 재전송 묶음
  const merged = countableEvents(mergeFormsIntoEvents([...LOGI_EVENTS, ev("c1", "2026-10-14", "2026-10-14T02:00:00Z", "권태혁", "B", "contact_change", "태성")], forms));
  const inOct = merged.filter((e) => e.activityDate >= OCT.from && e.activityDate <= OCT.to);

  it("활동 기록의 물류 행은 빠지고 표 원본 행만 남는다(담당자 변경은 활동 기록 그대로)", () => {
    expect(merged.some((e) => e.id === "e1")).toBe(false);
    expect(merged.filter((e) => e.category === "contact_change")).toHaveLength(1);
    expect(merged.every((e) => e.category !== "logistics" || e.metadata?.counted === true)).toBe(true);
  });

  it("팀별 물류(여분·마감 제외)·기타·불만이 세 화면에서 같다", () => {
    const isEtc = (e: ActivityEvent) => ["여분", "마감"].includes(String(e.metadata?.logisticsCategory || ""));
    for (const team of ["A", "B", "C", "D"]) {
      const scoped = inOct.filter((e) => e.team === team);
      const kpiMain = countForms("logistics", forms.logistics!, OCT.from, OCT.to, { part: "main", team });
      const dashMain = scoped.filter((e) => e.category === "logistics" && !isEtc(e)).length; // 팀 현황 logistics_main · 순위표 rankingLogisticsCount
      const lookupMain = formTally("logistics", forms.logistics!, { ...OCT, team, part: "main" }).count;
      expect([dashMain, lookupMain]).toEqual([kpiMain, kpiMain]);
      expect(scoped.filter((e) => e.category === "logistics" && isEtc(e)).length).toBe(countForms("logistics", forms.logistics!, OCT.from, OCT.to, { part: "etc", team }));
      expect(countFormEvents("complaint", scoped)).toBe(countForms("complaint", forms.complaint!, OCT.from, OCT.to, { team }));
    }
    // 고정 값: C 물류 3(물류 양식) · B 물류 1(세팅 양식) · B 기타 2 · C 기타 1(마감) · D 불만 2곳
    expect(countForms("logistics", forms.logistics!, OCT.from, OCT.to, { part: "main", team: "C" })).toBe(3);
    expect(countForms("logistics", forms.logistics!, OCT.from, OCT.to, { part: "main", team: "B" })).toBe(1);
    expect(countForms("logistics", forms.logistics!, OCT.from, OCT.to, { part: "etc", team: "B" })).toBe(2);
    expect(countForms("logistics", forms.logistics!, OCT.from, OCT.to, { part: "etc", team: "C" })).toBe(1);
    expect(countFormEvents("complaint", inOct.filter((e) => e.team === "D"))).toBe(2);
  });

  it("사람별(순위표) 합 = 팀 값(업체 수 종류는 사람마다 업체를 따로 세므로 같은 업체 협업이면 사람 합 ≥ 팀)", () => {
    const people = [...new Set(inOct.filter((e) => e.team === "D").map((e) => e.author))];
    const sum = people.reduce((n, p) => n + countFormEvents("complaint", inOct.filter((e) => e.author === p)), 0);
    expect(sum).toBe(2);
  });

  it("못 읽은 종류는 활동 기록 그대로(예: 미수 표가 아직 없을 때)", () => {
    const misuEv = ev("m1", "2026-10-20", "2026-10-20T01:00:00Z", "양승원", "D", "misu", "가나상사");
    const out = mergeFormsIntoEvents([misuEv], { complaint: [] });
    expect(out.map((e) => e.id)).toEqual(["m1"]);
  });
});
