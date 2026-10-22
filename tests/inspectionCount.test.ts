import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  countableEvents, countField, fieldTally, machineKeysOf, mergeFieldIntoEvents, toFieldRows,
  type FieldKind, type FieldRaw, type FieldRow,
} from "../src/workCount";
import type { ActivityEvent } from "../src/operations";

// 점검·AS 수 원본 하나·함수 하나(2026-10-22) — 홈·팀 현황·순위표·조회 탭이 같은 값을 내는지 고정한다.
// 명단(cs_members 2026-10-22 실측 일부): 박옥주·신정훈 = 팀장, 엄재현 = CSS(E)
const ROSTER: Record<string, string> = { 한왕주: "C", 박영현: "C", 이민구: "C", 엄재현: "E", 이권선: "A", 김종희: "D", 이호준: "B", 박옥주: "팀장", 신정훈: "팀장" };
const teamOf = (a: string) => ROSTER[a] || "미지정";

const doc = (machines: Array<[model: string, serial: string, asset: string]>, region = "C") =>
  ["작성자: x", "구분: 점검", `지역: ${region}`, "ㅡㅡㅡㅡㅡㅡㅡㅡㅡ",
    ...machines.flatMap(([m, s, a], i) => [`${i + 1}.`, `모델명: ${m}`, `시리얼넘버: ${s}`, `자산기번: ${a}`, "내용: 정기점검", "ㅡㅡㅡㅡㅡㅡㅡㅡㅡ"])].join("\n");
const row = (id: number, day: string, at: string, author: string, region: string, vendor: string, machines: Array<[string, string, string]>, extra: Partial<FieldRaw> = {}): FieldRaw => ({
  id, "작성일": day, created_at: at, "작성자": author, "지역": region, "_업체명": vendor, "업체명": vendor, "_출처": "카톡:웹앱",
  "모델명": machines[0]?.[0] || "", "시리얼넘버": machines[0]?.[1] || "", "자산기번": machines[0]?.[2] || "", "_원문": doc(machines, region), _hidden: false, ...extra,
});

// jeomgeom 2026-10 실제 행 모양(MCP 실측) — 시각은 UTC
const JEOMGEOM: FieldRaw[] = [
  // 같은 업체·같은 날 다른 기기 2장(엄재현, E) → 2대. 거래처로 묶으면 1이 되는 경우
  row(34028, "2026-10-20", "2026-10-20T02:18:43Z", "엄재현", "E", "홍성지역협력네트워크", [["X4220", "ZJY0BJMR90001VX", "X7855"]]),
  row(34036, "2026-10-20", "2026-10-20T03:01:26Z", "엄재현", "E", "홍성지역협력네트워크", [["X4300", "28S3BJKK400037M", "X7854"]]),
  // 1시간 뒤 재전송(한왕주) → 1대. 10분 묶음이면 2가 되는 경우
  row(34136, "2026-10-21", "2026-10-21T07:30:12Z", "한왕주", "C", "주식회사 한국에스엠에이", [["SL-X4220RX", "28S3B1BH10006QE", "D0090"]]),
  row(34139, "2026-10-21", "2026-10-21T08:29:56Z", "한왕주", "C", "주식회사 한국에스엠에이", [["SL-X4220RX", "28S3B1BH10006QE", "D0090"]]),
  // 다음 날 다른 사람이 같은 기기 → 따로 1대
  row(34147, "2026-10-22", "2026-10-22T01:23:29Z", "박영현", "C", "주식회사 한국에스엠에이", [["SL-X4220RX", "28S3B1BH10006QE", "D0090"]]),
  // 양식 1장에 3대(이너인포 형태) → 3대
  row(34158, "2026-10-22", "2026-10-22T02:11:05Z", "이민구", "C", "(주)이너인포 구로본사", [["ApeosPort-C3070", "520702", "B6394"], ["ApeosPort-C3070", "520643", "B3254"], ["ApeosPort-C3070", "520589", "B6323"]]),
  // 3분 재전송(이권선, A) → 1대
  row(33628, "2026-10-08", "2026-10-08T02:35:27Z", "이권선", "A", "동양팩", [["C2060", "311001", "D6222"]]),
  row(33632, "2026-10-08", "2026-10-08T02:38:41Z", "이권선", "A", "동양팩", [["C2060", "311001", "D6222"]]),
  // 팀장 기록(B 지역) → 제외
  row(34151, "2026-10-22", "2026-10-22T01:38:37Z", "박옥주", "B", "주식회사 잭슨카멜레온", [["ApeosPort-C2060", "214079", "A1627"]]),
  // 지역 칸 빈 카톡 가져오기분 → 출처 괄호 팀(C)
  row(20001, "2026-10-02", "2026-10-02T05:00:00Z", "이호준", "", "닥터다이어리", [["X3220", "0A6XBJLN80008QB", "B0273"]], { "_출처": "카톡:점검(C)" }),
  // 오발송 삭제 → 제외
  row(34999, "2026-10-21", "2026-10-21T09:00:00Z", "한왕주", "C", "델타엔지니어링", [["D450", "800120326702", "A1267"]], { _hidden: true }),
  // 시리얼·자산 둘 다 빈 기기 2대 양식 → 2대(모델#순번)
  row(20002, "2026-10-15", "2026-10-15T03:00:00Z", "박영현", "C", "공간코리아", [["X3220", "-", ""], ["X3220", "없음", ""]]),
];
// as_records 2026-10 실제 행 모양
const AS: FieldRaw[] = [
  row(37153, "2026-10-12", "2026-10-12T05:52:58Z", "김종희", "D", "주식회사 비티엑스코리아 중부지사평택 2창고", [["X3220", "0A6XBJPTA000E2J", ""]]),
  row(37154, "2026-10-12", "2026-10-12T06:12:17Z", "김종희", "D", "주식회사 비티엑스코리아 중부지사평택 2창고", [["X3220", "0A6XBJPTA000E2J", ""]]), // 20분 뒤 재전송
  row(37405, "2026-10-20", "2026-10-20T01:58:29Z", "박영현", "C", "엔티에스케이투 K2 7층 오른쪽 아이더디자인", [["V C3375", "840123", "E3200"]]),
  row(37417, "2026-10-20", "2026-10-20T04:39:46Z", "박영현", "C", "엔티에스케이투 K2 7층 오른쪽 아이더디자인", [["V C3375", "840123", "E3200"]]), // 3시간 뒤 재전송
  // AS 양식 1장에 2대 → AS 는 양식 건수 1건
  row(37500, "2026-10-21", "2026-10-21T02:00:00Z", "김종희", "D", "이터니티 영어학원광교상현점", [["SL-X3220NR", "0A6XBJMR6000HA", "D4090"], ["X3220NR", "0A6XBJMM70007GD", "D4025"]]),
  // 팀장 '점검, AS' 양식(두 표에 다 들어감) → 제외
  row(37010, "2026-10-01", "2026-10-01T03:00:00Z", "신정훈", "C", "주식회사 노비텍17층", [["X7400", "ZPBLBJSTA0010PP", "B5723"]]),
];

const OCT = { from: "2026-10-01", to: "2026-10-31" };
const rows = (): FieldRow[] => [...toFieldRows("jeomgeom", JEOMGEOM, teamOf), ...toFieldRows("as_records", AS, teamOf)];

// 화면마다 흉내 — 실제 화면과 같은 함수 경로
const home = (kind: FieldKind, team: string) => countField(rows(), { kind, team, ...OCT });          // Home: countField(weekRows, {kind, team})
const lookup = (kind: FieldKind, team: string) => fieldTally(rows(), { kind, team, ...OCT }).count; // DataLookup: fieldTally
function teamStatus(kind: FieldKind, team: string, activity: ActivityEvent[] = []) {                // OperationsDashboard: loadWorkEvents → 팀장 제외 → countableEvents
  const evs = countableEvents(mergeFieldIntoEvents(activity, rows()).filter((e) => teamOf(e.author) !== "팀장"));
  const m = evs.filter((e) => e.team === team && e.category === kind);
  return kind === "inspection" ? m.reduce((n, e) => n + Math.max(1, Number(e.machineCount) || 0), 0) : m.length;
}
function rankingPerson(kind: FieldKind, person: string) {                                          // TeamRanking: countableEvents → 사람별 METRICS
  const evs = countableEvents(mergeFieldIntoEvents([], rows())).filter((e) => e.author === person && e.category === kind);
  return kind === "inspection" ? evs.reduce((n, e) => n + (e.machineCount || 1), 0) : evs.length;
}

describe("점검·AS 수 — 원본(jeomgeom·as_records) 하나·함수 하나", () => {
  it("팀별 점검 대수: 홈 = 조회 탭 = 팀 현황", () => {
    const want: Record<string, number> = { A: 1, B: 0, C: 1 + 1 + 3 + 1 + 2, D: 0, E: 2 };
    for (const [team, n] of Object.entries(want)) {
      expect([home("inspection", team), lookup("inspection", team), teamStatus("inspection", team)]).toEqual([n, n, n]);
    }
  });

  it("팀별 AS 건수: 홈 = 조회 탭 = 팀 현황 (재전송 1, 여러 대 양식 1건, 팀장 제외)", () => {
    for (const [team, n] of Object.entries({ C: 1, D: 2, A: 0 })) {
      expect([home("as", team), lookup("as", team), teamStatus("as", team)]).toEqual([n, n, n]);
    }
  });

  it("사람별: 순위표 = 조회 탭 사람 단추(countField author)", () => {
    const cases: Array<[string, FieldKind, number]> = [["한왕주", "inspection", 1], ["엄재현", "inspection", 2], ["이민구", "inspection", 3], ["박영현", "inspection", 3], ["김종희", "as", 2], ["박영현", "as", 1]];
    for (const [p, kind, n] of cases) {
      expect(rankingPerson(kind, p)).toBe(n);
      expect(countField(rows(), { kind, author: p, ...OCT })).toBe(n);
    }
  });

  it("설명 줄: 목록 행(양식), 재전송, 팀장 수", () => {
    expect(fieldTally(rows(), { kind: "inspection", team: "C", ...OCT })).toEqual({ count: 8, rows: 6, managers: 0, resends: 1 });
    expect(fieldTally(rows(), { kind: "as", team: "C", ...OCT })).toEqual({ count: 1, rows: 3, managers: 1, resends: 1 });
  });
});

describe("점검·AS 수 — 활동 기록 제외, 기기 열쇠, 화면 입구", () => {
  it("활동 기록(activity_events)의 점검·AS 는 더 세지 않는다 — 물류 등 다른 종류는 그대로", () => {
    const ev = (category: string, vendor: string): ActivityEvent => ({ id: vendor, createdAt: "2026-10-15T01:00:00Z", activityDate: "2026-10-15", author: "한왕주", team: "C",
      category, vendor, quantity: 1, machineCount: 5, sourceText: "", metadata: {}, status: "active", cancelledAt: "", cancelledBy: "" } as ActivityEvent);
    const act = [ev("inspection", "표에 없는 업체"), ev("as", "표에 없는 업체"), ev("logistics", "물류 업체")];
    expect(teamStatus("inspection", "C", act)).toBe(8);
    expect(teamStatus("as", "C", act)).toBe(1);
    expect(mergeFieldIntoEvents(act, rows()).filter((e) => e.category === "logistics")).toHaveLength(1);
  });

  it("같은 업체를 10분 안에 보낸 다른 기기 양식도 합쳐지지 않는다(countableEvents 가 표 원본분은 건너뜀)", () => {
    const two: FieldRaw[] = [
      row(1, "2026-10-14", "2026-10-14T02:00:00Z", "이민구", "C", "델타엔지니어링", [["D450", "800120326702", "A1267"]]),
      row(2, "2026-10-14", "2026-10-14T02:03:00Z", "이민구", "C", "델타엔지니어링", [["D320", "376330209836", "B6454"]]),
    ];
    expect(countableEvents(mergeFieldIntoEvents([], toFieldRows("jeomgeom", two, teamOf)))).toHaveLength(2);
  });

  it("기기 열쇠: 시리얼, 없으면 자산, 둘 다 없으면 모델#순번. 원문 기기 칸이 없으면 행 칸", () => {
    expect(machineKeysOf(doc([["X", "zjy-1bjpr 7000", "D0215"], ["Y", "", "b3679 c 3284"], ["Z", "-", "없음"]]))).toEqual(["ZJY1BJPR7000", "B3679C3284", "Z#3"]);
    expect(machineKeysOf("", { model: "D450", serial: "800130944855", asset: "X9352" })).toEqual(["800130944855"]);
    const noModel = ["시리얼넘버: 111A", "자산기번: A1", "시리얼넘버: 222B", "자산기번: A2"].join("\n");
    expect(machineKeysOf(noModel)).toEqual(["111A", "222B"]); // 모델명 줄 없이 시리얼이 두 번 = 2대
  });

  it("화면 파일이 같은 입구를 쓴다", () => {
    // 홈(2026-10-23 KPI 현황판): 점검·AS 는 KPI 로더(kpiData → loadFieldRows)가 읽고 kpiCompute(countField)가 센다.
    // 관제 덱 인사말도 그 묶음을 weekSummary 로 받는다(Home 이 따로 읽지 않음)
    const homeSrc = readFileSync("src/Home.tsx", "utf8");
    expect(homeSrc).toMatch(/weekSummary\(/);
    expect(homeSrc.includes("weekCols")).toBe(false);
    expect(readFileSync("src/kpi/kpiData.ts", "utf8")).toMatch(/loadFieldRows\(/);
    expect(readFileSync("src/kpi/kpiCompute.ts", "utf8")).toMatch(/countField\(/);
    expect(readFileSync("src/DataLookup.tsx", "utf8")).toMatch(/fieldTally\(/);
    expect(readFileSync("src/OperationsDashboard.tsx", "utf8")).toMatch(/loadWorkEvents\(/);
    expect(readFileSync("src/TeamRanking.tsx", "utf8")).toMatch(/loadWorkEvents\(/);
    expect(readFileSync("src/expansionSource.ts", "utf8")).toMatch(/mergeFieldIntoEvents\(/);
  });
});
