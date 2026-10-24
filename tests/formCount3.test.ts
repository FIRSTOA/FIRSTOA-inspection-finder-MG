/**
 * 숫자 통일 3단계(2026-10-24) — 담당자 변경(K27)을 활동 기록 대신 contact_changes 원본 표로, 팀 현황 "업무" 합계에서 마감 카운터 제외,
 * 내 현황(myFormCounts) 양식 숫자 = 순위표 사람 값.
 *
 * MCP 실측(contact_changes, 숨김·팀장 제외, 같은 사람·날·업체 1건):
 *   10월 전(활동 기록 contact_change, 팀장 제외) A10 B13 C8 = 31 → 후(원본) A12 B16 C8 E1 · 미지정 29 = 66
 *    9월 전 A1 B8 C19 = 28                         → 후 A25 B22 C21 D6 E9 · 미지정 46 = 129
 *   (미지정 = CS 밖 작성자 — 경영지원·IT파트·전략영업·명단 밖 이름. 팀 칸에는 안 들고 "전체"에만)
 * 교체양식(K28)은 원본 표가 없다(복사 전용 양식, [복사] 때 activity_events 1줄 — 10월 1건) → 활동 기록 그대로.
 * 마감 카운터(counter)는 activity_events 에 지금까지 0행 → 실데이터 전후 숫자는 같다. 아래 테스트가 섞이면 빠지는 것을 고정한다.
 */
import { describe, expect, it } from "vitest";
import { countableEvents, toFieldRows, type FieldRaw } from "../src/workCount";
import type { ActivityEvent } from "../src/operations";
import {
  contactTeamQuery, contactTeamSpec, countFormEvents, countForms, csOnlyTeam, formTally, isWorkEvent, mergeFormsIntoEvents, misuFormRows, NO_TEAM, toFormTableRows, withFieldLogistics,
  type FormRaw, type FormSet,
} from "../src/formCount";
import { kpiCount, type KpiFacts } from "../src/kpi/kpiCompute";
import { myFormCounts, type WorkLedger } from "../src/myWorkCount";
import { rankingLogisticsCount } from "../src/rankingLogistics";
import type { MisuVisit } from "../src/misuVisit";

// 명단 실측 모양: CS A~D, CSS → E, 팀장, 경영지원·전략영업(팀 글자 없음 → 미지정), IT파트 → IT
const ROSTER: Record<string, string> = {
  권태혁: "B", 이호준: "B", 조윤: "B", 한왕주: "C", 정웅: "A", 엄재현: "E", 박옥주: "팀장",
  김슬기: "미지정", 박진영: "미지정", 김광태: "IT",
};
const teamOf = (a: string) => ROSTER[a] || "미지정";
const OCT = { from: "2026-10-01", to: "2026-10-31" };

const ev = (id: string, day: string, author: string, team: string, category: string, vendor: string, extra: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id, createdAt: `${day}T02:00:00Z`, activityDate: day, author, team, category, vendor, quantity: 1, machineCount: 0, sourceText: "", metadata: {}, status: "active", cancelledAt: "", cancelledBy: "", ...extra,
} as ActivityEvent);
const cc = (id: number, day: string, author: string, company: string, region: string, extra: Partial<FormRaw> = {}): FormRaw =>
  ({ id: `c${id}`, created_at: `${day}T03:00:00Z`, change_date: day, author, company, region, _hidden: false, ...extra });

// 10월 모양 축소판 — FIELD [보내기] 건(활동 기록 있음) + 키맨체크 시트 행(활동 기록 없음)
const CONTACT_RAW: FormRaw[] = [
  cc(1, "2026-10-02", "권태혁", "가나상사", "B"),
  cc(2, "2026-10-02", "권태혁", "(주)가나상사", "B"), // 같은 사람·날·업체(표기 변형) → 1건
  cc(3, "2026-10-05", "이호준", "다라전자", "B"), // 시트 행 — 활동 기록 없음
  cc(4, "2026-10-06", "한왕주", "마바학원", "C"),
  cc(5, "2026-10-07", "엄재현", "사아병원", "E"), // CSS → E
  cc(6, "2026-10-08", "정웅", "자차물산", "수도권 C"), // CS 작성자 → 지역 칸(C)
  cc(7, "2026-10-09", "김슬기", "카타상회", "D"), // 경영지원 → 미지정(지역 D 라도 D팀 칸에 안 듦)
  cc(8, "2026-10-10", "박진영", "파하건설", "A → D"), // 전략영업 → 미지정
  cc(9, "2026-10-11", "김광태", "IT고객", "B"), // IT파트 → 미지정
  cc(10, "2026-10-12", "프로", "명단밖", ""), // 명단 밖 → 미지정
  cc(11, "2026-10-13", "박옥주", "팀장업체", "B"), // 팀장 → 제외
  cc(12, "2026-10-14", "조윤", "숨김업체", "B", { _hidden: true }), // 오발송 삭제 → 제외
  cc(13, "2026-09-30", "조윤", "9월업체", "B"), // 기간 밖
];
// 같은 기간 활동 기록(전) — FIELD [보내기] 성공분만 남았다
const CONTACT_EVENTS: ActivityEvent[] = [
  ev("a1", "2026-10-02", "권태혁", "B", "contact_change", "가나상사"),
  ev("a2", "2026-10-06", "한왕주", "C", "contact_change", "마바학원"),
  ev("a3", "2026-10-13", "박옥주", "B", "contact_change", "팀장업체"), // 팀장
];

describe("담당자 변경(K27) — contact_changes 원본 표", () => {
  const rows = toFormTableRows("contact_changes", CONTACT_RAW, teamOf);

  it("팀 규칙: CS 작성자만 팀(지역 칸 → 작성자 팀), CS 밖은 미지정, 팀장은 manager", () => {
    expect(csOnlyTeam("정웅", "수도권 C", teamOf)).toBe("C");
    expect(csOnlyTeam("정웅", "", teamOf)).toBe("A");
    expect(csOnlyTeam("엄재현", "CSS", teamOf)).toBe("E");
    expect(csOnlyTeam("김슬기", "D", teamOf)).toBe(NO_TEAM);
    expect(csOnlyTeam("김광태", "B", teamOf)).toBe(NO_TEAM);
    expect(csOnlyTeam("박옥주", "B", teamOf)).toBe("팀장");
    expect(rows.find((r) => r.id === "c11")?.manager).toBe(true);
    expect(rows.find((r) => r.id === "c1")).toMatchObject({ author: "권태혁", vendor: "가나상사", day: "2026-10-02", team: "B", table: "contact_changes" });
  });

  it("전(활동 기록 2건, 팀장 제외) → 후(원본 9건): 팀 칸 B2·C2·E1, 미지정 4는 전체에만", () => {
    const before = countableEvents(CONTACT_EVENTS.filter((e) => teamOf(e.author) !== "팀장")).filter((e) => e.category === "contact_change");
    expect(before.length).toBe(2);
    expect(countForms("contact_change", rows, OCT.from, OCT.to)).toBe(9);
    const teams = ["A", "B", "C", "D", "E"].map((t) => countForms("contact_change", rows, OCT.from, OCT.to, { team: t }));
    expect(teams).toEqual([0, 2, 2, 0, 1]);
    const noTeam = countForms("contact_change", rows, OCT.from, OCT.to, { team: NO_TEAM });
    expect(noTeam).toBe(4);
    expect(teams.reduce((a, b) => a + b, 0) + noTeam).toBe(countForms("contact_change", rows, OCT.from, OCT.to)); // 팀 칸 합 + 미지정 = 전체
  });

  it("홈 K27 = 팀 현황·순위표(합성 활동) = 조회 탭(formTally)", () => {
    const facts: KpiFacts = { contact: rows };
    const ctx = { today: "2026-10-24", teamOf };
    expect(kpiCount("K27", facts, {}, OCT, ctx)?.n).toBe(9);
    expect(kpiCount("K27", facts, { team: "B" }, OCT, ctx)?.n).toBe(2);
    expect(kpiCount("K27", facts, { author: "권태혁" }, OCT, ctx)?.n).toBe(1);
    expect(kpiCount("K27", {}, {}, OCT, ctx)).toBeNull(); // 원본을 못 읽으면 0 이 아니라 못 셈

    const merged = countableEvents(mergeFormsIntoEvents(CONTACT_EVENTS, { contact_change: rows }).filter((e) => e.activityDate >= OCT.from && e.activityDate <= OCT.to));
    expect(countFormEvents("contact_change", merged)).toBe(9);
    expect(countFormEvents("contact_change", merged.filter((e) => e.team === "B"))).toBe(2);
    expect(merged.some((e) => e.id === "a1")).toBe(false); // 활동 기록 행은 원본으로 갈아 끼워짐

    expect(formTally("contact_change", rows, OCT)).toMatchObject({ count: 9, managers: 1, resends: 1 });
  });

  it("교체양식은 원본 표가 없어 활동 기록 그대로(오발송 제외)", () => {
    const evs = [ev("r1", "2026-10-20", "정웅", "A", "replacement", "교체업체"), ev("r2", "2026-10-20", "정웅", "A", "replacement", "취소", { status: "cancelled" })];
    const merged = countableEvents(mergeFormsIntoEvents(evs, { contact_change: rows }));
    expect(merged.filter((e) => e.category === "replacement").length).toBe(1);
  });
});

describe("팀 현황 '업무' 합계 — 마감 카운터(counter) 제외", () => {
  it("전: 전체 업무 = 모든 활동(카운터 2 포함 5) → 후: 업무 3(업무 구성 칸 합과 같다)", () => {
    const evs = [
      ev("i1", "2026-10-20", "정웅", "A", "replacement", "가"),
      ev("i2", "2026-10-20", "정웅", "A", "contact_change", "나"),
      ev("i3", "2026-10-21", "정웅", "A", "recontract", "다"),
      ev("k1", "2026-10-21", "정웅", "A", "counter", "카운터1", { machineCount: 3 }),
      ev("k2", "2026-10-22", "한왕주", "C", "counter", "카운터2", { machineCount: 2 }),
    ];
    expect(evs.length).toBe(5); // 전(예전 matchesFilter "all" = true)
    const work = evs.filter(isWorkEvent);
    expect(work.length).toBe(3);
    expect(new Set(work.map((e) => e.author)).size).toBe(1); // 카운터만 보낸 사람(한왕주)은 활동 인원에서 빠짐
    expect(work.reduce((n, e) => n + e.machineCount, 0)).toBe(0); // 기기·물품 칸에 카운터 기기 수가 안 섞임
  });
});

/* 내 현황(myFormCounts) = 순위표 사람 값 */
const frow = (id: number, author: string, vendor: string, types: string, day: string): FieldRaw => ({
  id, "작성일": day, created_at: `${day}T02:00:00Z`, "작성자": author, "지역": ROSTER[author] || "", "_업체명": vendor, "업체명": vendor, "_출처": "카톡:웹앱",
  "모델명": "C3070", "시리얼넘버": `S${id}9`, "자산기번": "", "_원문": "", "구분": types, _hidden: false,
});
const FIELD = toFieldRows("jeomgeom", [frow(1, "한왕주", "세팅업체", "점검, 세팅", "2026-10-14"), frow(2, "한왕주", "여분업체", "점검, 여분", "2026-10-15")], teamOf);
const LOGI: FormRaw[] = [
  { id: 1, created_at: "2026-10-16T00:44:03Z", "작성일": "2026-10-16", "작성자": "한왕주", "구분": "철수", "거래처명": "섬김", "_업체명": "섬김", "_출처": "웹앱:물류", "수량": "1" },
  { id: 2, created_at: "2026-10-16T00:44:30Z", "작성일": "2026-10-16", "작성자": "한왕주", "구분": "철수", "거래처명": "섬김", "_업체명": "섬김", "_출처": "웹앱:물류", "수량": "1" }, // 연타 → 1
  { id: 3, created_at: "2026-10-17T00:00:00Z", "작성일": "2026-10-17", "작성자": "한왕주", "구분": "마감", "거래처명": "마감업체", "_업체명": "마감업체", "_출처": "웹앱:물류" },
];
const RECON: FormRaw[] = [
  { id: 1, created_at: "2026-10-20T02:00:00Z", "날짜": "2026-10-20", "작성자": "한왕주", "지역": "C", "_출처": "웹앱:재계약", "_업체명": "(주)델타" },
  { id: 2, created_at: "2026-10-21T02:00:00Z", "날짜": "2026-10-21", "작성자": "한왕주", "지역": "C", "_출처": "웹앱:재계약", "_업체명": "델타" }, // 같은 업체 → 1곳
];
const BULMAN: FormRaw[] = [{ id: 1, created_at: "2026-10-21T02:00:00Z", "날짜": "2026-10-21", "작성자": "한왕주", "지역": "", "_출처": "시트:불만", "_업체명": "아이더" }];
const OVER: FormRaw[] = [{ id: 1, created_at: "2026-10-22T02:00:00Z", "방문일": "2026-10-22", "작성자": "한왕주", "지역": "C", "_출처": "웹앱:초과조정", "_업체명": "초과업체" }];
const MISU = misuFormRows([
  { id: "m1", created_at: "2026-10-20T01:00:00Z", visited_at: "2026-10-20T01:00:00Z", author: "한왕주", author_team: "C", vendor: "미수업체", _hidden: false, supplement_of: null },
  { id: "m2", created_at: "2026-10-20T03:00:00Z", visited_at: "2026-10-20T01:00:00Z", author: "한왕주", author_team: "C", vendor: "미수업체", _hidden: false, supplement_of: "m1" }, // 보완 → 1
] as unknown as MisuVisit[], teamOf);
const FORMS: FormSet = {
  logistics: toFormTableRows("logistics_records", LOGI, teamOf), recontract: toFormTableRows("recontract", RECON, teamOf),
  complaint: toFormTableRows("bulman", BULMAN, teamOf), overage: toFormTableRows("overage_adjust", OVER, teamOf), misu: MISU,
  contact_change: toFormTableRows("contact_changes", [cc(1, "2026-10-06", "한왕주", "마바학원", "C"), cc(2, "2026-10-06", "한왕주", "마바학원", "C")], teamOf),
};
const LEDGER: WorkLedger = { field: FIELD, expansion: [], forms: FORMS };

describe("내 현황 양식 숫자(myFormCounts) = 순위표 사람 값", () => {
  it("한왕주 10월: 물류 2(철수 1 + 점검 양식 세팅 1) · 기타 2(여분·마감) · 재계약 1곳 · 불만 1곳 · 초과 1 · 미수 1 · 담당자 변경 1", () => {
    const mine = myFormCounts(LEDGER, "한왕주", OCT.from, OCT.to);
    expect(mine).toEqual({ logistics: 2, logisticsEtc: 2, recontract: 1, complaint: 1, overage: 1, misu: 1, contact_change: 1 });

    // 순위표 입구(loadWorkEvents → countableEvents) + TeamRanking METRICS 셈
    const evs = countableEvents(mergeFormsIntoEvents([], withFieldLogistics(FORMS, FIELD))).filter((e) => e.author === "한왕주");
    expect(rankingLogisticsCount(evs)).toBe(mine.logistics);
    for (const k of ["recontract", "complaint", "overage", "misu", "contact_change"] as const) expect(countFormEvents(k, evs)).toBe(mine[k]);
  });

  it("양식 원본을 못 읽었으면 null(방문 장부 숫자 유지), 작성자가 비면 0", () => {
    expect(myFormCounts({ field: FIELD, expansion: [] }, "한왕주", OCT.from, OCT.to).misu).toBeNull();
    const noMisu = myFormCounts({ ...LEDGER, forms: { ...FORMS, misu: undefined } }, "한왕주", OCT.from, OCT.to);
    expect(noMisu.misu).toBeNull();
    expect(noMisu.overage).toBe(1);
    expect(myFormCounts(LEDGER, "  ", OCT.from, OCT.to).recontract).toBe(0);
  });
});

/* 조회 탭 담당자·주소 변경 팀 필터(목록) = 건수 카드(csOnlyTeam) — 2026-10-24 */
describe("조회 탭 담당자 변경 팀 필터 = csOnlyTeam", () => {
  // contact_changes.region 실측 값 전부(2026-10-24 MCP, 전각 'Ｄ' 1행은 Postgres 가 못 읽어 뺌 — formCount 주석)
  const REGIONS = ["", "a", "A", "A  -> C", "A -> D", "A → A", "A → D", "A > B", "A->B", "A->C", "A>B", "A~D", "b", "B", "B -> A", "B->A", "B->B", "B->C", "B,E", "B>A", "BD", "B지역",
    "c", "C", "C -> B", "C → A", "C > B", "C > C", "C > D", "c->b", "c->c", "C->D", "C,D", "c>b", "d", "D", "D -> A", "D > B", "d > c", "D > E", "D->A", "D->D", "D,E", "D>B", "D지역",
    "e", "E", "E > A", "E-> D", "강원도", "경기", "경상도", "공통", "대영이앤지 주식회사", "성남", "수도권", "수도권 C", "수도권 D", "수도권A", "수도권b", "수도권c", "수도권C", "수도권D > 수도권C",
    "수도권E", "수도권지역", "수도권지역 :A", "전체", "지방", "평택", "CSS", "css 지원", null];
  const BOOK: Record<string, string[]> = { A: ["정웅"], B: ["권태혁", "이호준", "조윤"], C: ["한왕주"], D: [], E: ["엄재현"], 팀장: ["박옥주"], IT: ["김광태"] };
  const AUTHORS = ["정웅", "권태혁", "한왕주", "엄재현", "박옥주", "김슬기", "김광태", "프로"];
  // Postgres imatch(대소문자 무시) 를 JS 로 — [:space:] 만 공백 클래스로 바꾼다
  const re = (pg: string) => new RegExp(pg.split("[:space:]").join("\\s"), "i");
  const listHas = (team: string, author: string, region: string | null) => {
    const spec = contactTeamSpec(team, BOOK);
    const r = region === null ? null : region;
    return (spec.csNames.includes(author) && r !== null && re(spec.teamRegex).test(r))
      || (spec.teamNames.includes(author) && (r === null || !re(spec.anyRegex).test(r)));
  };

  it("모든 실측 지역 값 × 작성자: 목록 필터에 걸리는 팀 = 카드 셈의 팀(csOnlyTeam)", () => {
    for (const team of ["A", "B", "C", "D", "E"]) for (const author of AUTHORS) for (const region of REGIONS) {
      expect([team, author, region, listHas(team, author, region)]).toEqual([team, author, region, csOnlyTeam(author, region ?? "", teamOf) === team]);
    }
  });

  it("팀 필터 카드 = 목록 행 수(같은 행들) — B팀", () => {
    const rows = toFormTableRows("contact_changes", CONTACT_RAW, teamOf).filter((r) => !r.hidden && r.day >= OCT.from && r.day <= OCT.to);
    const listed = rows.filter((r) => listHas("B", r.author, String(r.raw.region ?? "")));
    expect(formTally("contact_change", rows, { ...OCT, team: "B" }).rows).toBe(listed.length);
    expect(listed.map((r) => r.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("PostgREST 조각: or=(CS 작성자&지역 팀 | 그 팀 작성자&지역에 팀 없음), 이름 따옴표", () => {
    const q = decodeURIComponent(contactTeamQuery("B", BOOK));
    expect(q.startsWith("or=(and(author.in.(")).toBe(true);
    expect(q).toContain(`"권태혁","이호준","조윤"`);
    expect(q).toContain("region.imatch.");
    expect(q).toContain("or(region.is.null,region.not.imatch.");
    expect(q).not.toContain("\\");
    expect(decodeURIComponent(contactTeamQuery("D", BOOK))).toContain(`author.in.("__없음__")`);
  });
});
