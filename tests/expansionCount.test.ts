import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  countableEvents, countExpansion, expansionTally, mergeExpansionIntoEvents, regionTeam, toExpansionRows,
  type ExpansionRaw,
} from "../src/workCount";
import { findSameDaySend, sentAtLabel } from "../src/expansionResendGuard";
import type { ActivityEvent } from "../src/operations";

// 명단(cs_members 2026-10-22 실측 일부): 신정훈 = 팀장, 정준영 = D
const ROSTER: Record<string, string> = { 이민구: "C", 박영현: "C", 이홍진: "C", 한왕주: "C", 신정훈: "팀장", 정준영: "D", 이호준: "B", 박옥주: "팀장" };
const teamOf = (a: string) => ROSTER[a] || "미지정";

// pc_expansion 2026-10 실제 행 모양(MCP 실측, 지역 C·"수도권 C"·"c"·빈칸) — 날짜 칸은 시트 미러 UTC 시각 글자
const C_OCT: Array<[number, string, string, string, string]> = [
  [108473, "2026-10-01T01:43:33.433246+00:00", "이민구", "", "주식회사 마이밸류본사"],
  [108475, "2026-10-01T04:26:44.913537+00:00", "이민구", "C", "주식회사 뉴로클 (Newrocle Inc.)"],
  [108476, "2026-10-01T05:22:15.431239+00:00", "박영현", "C", "30V주식회사 푸드나무4층 추가매월마감"],
  [108478, "2026-10-01T05:56:55.212476+00:00", "박영현", "C", "스튜디오리얼라이브"],
  [108479, "2026-10-01T06:38:12.614447+00:00", "이민구", "C", "세무회계 정율전 허니아케이드 주식회사(HONEY ARCADE Inc.)"],
  [108482, "2026-10-02T01:59:58.405199+00:00", "이민구", "C", "손손컴퍼니"],
  [108484, "2026-10-02T02:33:48.962812+00:00", "한왕주", "C", "주식회사 와이엘아이앤씨"],
  [108485, "2026-10-02T02:36:48.659009+00:00", "한왕주", "C", "주식회사 프리앤제이2"],
  [108488, "2026-10-06T02:13:39.760559+00:00", "한왕주", "C", "한성모직"],
  [108492, "2026-10-07T01:10:39.640833+00:00", "박영현", "C", "크라우닝"],
  [108494, "2026-10-07T01:15:34.535948+00:00", "한왕주", "C", "백화세무회계"],
  [108495, "2026-10-07T02:12:56.775527+00:00", "박영현", "C", "홀리가이드선교회"],
  [108496, "2026-10-07T02:54:03.153577+00:00", "박영현", "수도권 C", "피앤씨솔루션"],
  [108498, "2026-10-07T08:42:32.697234+00:00", "이민구", "C", "조우세무회계사무소"],
  [108500, "2026-10-08T01:14:41.626668+00:00", "이민구", "C", "주식회사 비전월드"],
  [108502, "2026-10-08T01:53:19.144765+00:00", "한왕주", "C", "포튼가먼트"],
  [108504, "2026-10-08T02:16:22.544583+00:00", "이민구", "C", "주식회사 레벨13"],
  [108505, "2026-10-08T04:13:50.602096+00:00", "이민구", "C", "루크레이티브"],
  [108506, "2026-10-08T06:23:55.706833+00:00", "이민구", "C", "주식회사 리하베스트"],
  [108507, "2026-10-12T02:28:21.836468+00:00", "이민구", "C", "(주)레인컴퍼니"],
  [108508, "2026-10-12T02:43:06.715227+00:00", "이민구", "C", "알코켐"],
  [108509, "2026-10-12T04:26:27.814912+00:00", "한왕주", "C", "문워크디자인"],
  [108510, "2026-10-12T04:46:38.917263+00:00", "이민구", "C", "어필 컴퍼니(A FEEL COMPANY)어필컴퍼니분기마감"],
  [108511, "2026-10-12T04:55:50.300099+00:00", "한왕주", "C", "주식회사 브레디스헬스케어"],
  [108512, "2026-10-12T04:58:46.310969+00:00", "이홍진", "C", "영음예술기획"],
  [108513, "2026-10-12T05:56:21.473489+00:00", "이민구", "C", "랩스컴퍼니"],
  [108514, "2026-10-12T07:25:27.236199+00:00", "이민구", "C", "325이엔씨"],
  [108515, "2026-10-13T02:02:30.917336+00:00", "한왕주", "C", "비피도 (BIFIDO. Co. Ltd.)"],
  [108517, "2026-10-13T04:38:04.841398+00:00", "이민구", "C", "맵스콘텐츠미디어랩"],
  [108521, "2026-10-14T02:26:14.983581+00:00", "한왕주", "C", "파트라"],
  [108529, "2026-10-15T05:53:19.921546+00:00", "한왕주", "C", "주식회사 세원기술단사무실백업/합산"],
  [108532, "2026-10-16T02:13:14.392755+00:00", "한왕주", "C", "주식회사 에스에이치파트너스그럭-전 씨에스 컨설팅(CS consulting)"],
  [108533, "2026-10-16T02:14:20.316698+00:00", "한왕주", "C", "주식회사 에스에이치파트너스그럭-전 씨에스 컨설팅(CS consulting)"], // 재전송
  [108535, "2026-10-16T06:17:40.632634+00:00", "박영현", "C", "주식회사 시민언론뉴탐사"],
  [108536, "2026-10-16T06:42:00.379831+00:00", "박영현", "c", "파커스"],
  [108539, "2026-10-16T07:51:46.382254+00:00", "이민구", "C", "오렌지스펙트럼 주식회사"],
  [108544, "2026-10-19T05:37:10.848809+00:00", "이민구", "C", "박정운법무사사무소"],
  [108545, "2026-10-19T07:28:22.151164+00:00", "한왕주", "C", "31N좋은당 보아스네집좋은당보아스네집분기마감"],
  [108554, "2026-10-20T08:22:32.459153+00:00", "신정훈", "C", "자연인"], // 팀장
  [108555, "2026-10-20T08:30:44.608759+00:00", "신정훈", "C", "어반티"], // 팀장
  [108556, "2026-10-20T09:02:41.986128+00:00", "한왕주", "C", "주식회사 비에이렌탈전 스튜디오통통통,성진에프앤에스"],
  [108557, "2026-10-21T01:24:15.345524+00:00", "박영현", "C", "세무법인 송정택스"],
  [108558, "2026-10-21T02:53:04.441743+00:00", "한왕주", "수도권 C", "주식회사 이너웨이브"],
  [108561, "2026-10-21T03:47:09.587385+00:00", "정준영", "", "신우테크"], // 지역 빈칸 → 작성자 팀 D
  [108562, "2026-10-21T04:37:41.707778+00:00", "한왕주", "C", "델타엔지니어링"],
  [108563, "2026-10-21T04:51:12.089829+00:00", "이민구", "C", "아우라네트웍"],
  [108567, "2026-10-21T06:03:43.646479+00:00", "박영현", "C", "공간코리아강남역현장"],
  [108568, "2026-10-21T06:52:48.753832+00:00", "박영현", "C", "화인브릿지"],
  [108569, "2026-10-21T06:53:44.542904+00:00", "한왕주", "C", "이노하스레디투잇"],
  [900001, "2026-09-30T14:59:59+00:00", "이민구", "C", "9월 마지막 행"], // 9/30 23:59 KST — 10월 아님
];
const raw = (rows: typeof C_OCT, hidden = new Set<number>()): ExpansionRaw[] =>
  rows.map(([id, d, a, r, v]) => ({ id, "날짜": d, "작성자": a, "지역": r, "_업체명": v, _hidden: hidden.has(id) }));
const OCT = { from: "2026-10-01", to: "2026-10-31" };
const C_PEOPLE = Object.entries(ROSTER).filter(([, t]) => t === "C").map(([n]) => n);

// 세 화면이 같은 원본에서 같은 함수를 지나도록 흉내
function lookupTab(rows: ExpansionRaw[]) { // DataLookup: expansionTally/countExpansion
  return countExpansion(toExpansionRows("pc_expansion", rows, teamOf), { ...OCT, team: "C" });
}
function teamStatus(rows: ExpansionRaw[], activity: ActivityEvent[] = []) { // OperationsDashboard: loadWorkEvents → 팀장 제외 → countableEvents → 팀 C
  const merged = mergeExpansionIntoEvents(activity, toExpansionRows("pc_expansion", rows, teamOf))
    .filter((e) => e.activityDate >= OCT.from && e.activityDate <= OCT.to);
  return countableEvents(merged.filter((e) => teamOf(e.author) !== "팀장"))
    .filter((e) => e.team === "C" && (e.category === "expansion_it" || e.category === "expansion_copier")).length;
}
function ranking(rows: ExpansionRaw[]) { // TeamRanking: 사람별 확장성 합(C 명단)
  const evs = countableEvents(mergeExpansionIntoEvents([], toExpansionRows("pc_expansion", rows, teamOf)))
    .filter((e) => e.activityDate >= OCT.from && e.activityDate <= OCT.to && e.team === "C");
  return C_PEOPLE.reduce((n, p) => n + evs.filter((e) => e.author === p).length, 0);
}

describe("확장성 건수 원본 하나·함수 하나(2026-10-22 C팀 48 vs 45)", () => {
  it("2026-10 C팀: 목록 48행(재전송 1·팀장 2 포함) → 45건, 세 화면 같은 값", () => {
    const rows = raw(C_OCT);
    expect(expansionTally(toExpansionRows("pc_expansion", rows, teamOf), { ...OCT, team: "C" })).toEqual({ count: 45, rows: 48, managers: 2, resends: 1 });
    expect(lookupTab(rows)).toBe(45);
    expect(teamStatus(rows)).toBe(45);
    expect(ranking(rows)).toBe(45);
  });

  it("활동 기록(activity_events)의 확장성은 더 세지 않는다 — 표에 없는 활동이 있어도 표 기준 그대로", () => {
    const act: ActivityEvent = { id: "x", createdAt: "2026-10-15T09:15:42Z", activityDate: "2026-10-15", author: "한왕주", team: "C", category: "expansion_it",
      vendor: "시트에 없는 업체", quantity: 1, machineCount: 0, sourceText: "", metadata: {}, status: "active", cancelledAt: "", cancelledBy: "" };
    expect(teamStatus(raw(C_OCT), [act])).toBe(45);
  });

  it("오발송 삭제(_hidden)한 행은 세 화면 모두에서 즉시 빠진다", () => {
    const rows = raw(C_OCT, new Set([108569]));
    expect([lookupTab(rows), teamStatus(rows), ranking(rows)]).toEqual([44, 44, 44]);
    // 재전송 둘 중 하나만 지우면 그날 그 업체는 여전히 1건
    const one = raw(C_OCT, new Set([108533]));
    expect([lookupTab(one), teamStatus(one), ranking(one)]).toEqual([45, 45, 45]);
  });

  it("지역 칸 → 팀: 표기 변형·전각·CSS, 못 읽으면 작성자 팀", () => {
    expect(["C", "c", "수도권 C", "수도권C", "Ｃ", "D(성남)", "E(기존 A)", "A,D,E", "CSS", "지방"].map(regionTeam)).toEqual(["C", "C", "C", "C", "C", "D", "E", "A", "E", "E"]);
    expect(["", "SS", "N", "확인 필요", "서울 서초구", "키맨/접수자: 이건희"].map(regionTeam)).toEqual(["", "", "", "", "", ""]);
    const [r] = toExpansionRows("pc_expansion", [{ id: 1, "날짜": "2026-10-21", "작성자": "정준영", "지역": "", "_업체명": "신우테크" }], teamOf);
    expect(r.team).toBe("D");
    // 복합기 미팅지역은 주소 — 팀으로 읽지 않고 작성자 팀
    const [m] = toExpansionRows("mfp_expansion", [{ id: 2, "등록일": "2026-10-02T03:33:20+00:00", "등록자": "이호준", "미팅지역": "서울 강서구", "상호": "공명성세무회계", "_업체명": "공명성세무회계" }], teamOf);
    expect([m.team, m.kind, m.day]).toEqual(["B", "expansion_copier", "2026-10-02"]);
  });

  it("세 화면 파일이 같은 입구를 쓴다", () => {
    expect(readFileSync("src/OperationsDashboard.tsx", "utf8")).toMatch(/loadWorkEvents\(/);
    expect(readFileSync("src/TeamRanking.tsx", "utf8")).toMatch(/loadWorkEvents\(/);
    expect(readFileSync("src/DataLookup.tsx", "utf8")).toMatch(/expansionTally\(/);
    expect(readFileSync("src/OperationsDashboard.tsx", "utf8")).not.toMatch(/getActivityEvents\(/);
  });
});

describe("보낼 때 막기 — 같은 작성자·같은 KST 날짜·같은 업체", () => {
  const sent: ExpansionRaw[] = [
    { id: 1, "날짜": "2026-10-16T02:13:14.392755+00:00", "작성자": "한왕주", "_업체명": "주식회사 에스에이치파트너스그럭-전 씨에스 컨설팅(CS consulting)" },
    { id: 2, "날짜": "2026-10-22", created_at: "2026-10-22T01:05:00+00:00", "작성자": "한왕주", "_업체명": "(주)델타엔지니어링" },
  ];
  it("같은 날 같은 업체(표기 변형 포함)면 찾는다, 다른 날·다른 사람·삭제한 행은 아님", () => {
    expect(findSameDaySend("pc_expansion", sent, "한왕주", "주식회사 에스에이치파트너스그럭-전 씨에스 컨설팅(CS consulting)", "2026-10-16")?.id).toBe(1);
    expect(findSameDaySend("pc_expansion", sent, "한왕주", "델타엔지니어링", "2026-10-22")?.id).toBe(2);
    expect(findSameDaySend("pc_expansion", sent, "한왕주", "델타엔지니어링", "2026-10-21")).toBeNull();
    expect(findSameDaySend("pc_expansion", sent, "이민구", "델타엔지니어링", "2026-10-22")).toBeNull();
    expect(findSameDaySend("pc_expansion", [{ ...sent[1], _hidden: true }], "한왕주", "델타엔지니어링", "2026-10-22")).toBeNull();
  });
  it("시각은 KST", () => {
    expect(sentAtLabel("2026-10-16T02:13:14.392755+00:00")).toBe("11:13");
    expect(sentAtLabel("2026-10-22")).toBe("시각 미상");
  });
});
