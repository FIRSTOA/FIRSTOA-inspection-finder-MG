/**
 * 통합검색 분석 도구 목록 한 곳(구현 B, 2026-10-29) — data-ask/index.ts 가 `ASK_TOOLS` 를 그대로 모델 도구로 붙인다.
 * 각 도구 = { name, description(모델에게), parameters(JSON 스키마), run(args, ctx) => Promise<object>, label(진행 표시 한국어) }.
 * query_rows·tally·vendor_team·team_members·app_guide 는 data-ask(구현 A) 것 — 여기 같은 이름을 두지 않는다.
 */
import type { AskToolDef } from "./tool-util.ts";
import { okrMemberReport, okrTeamReport } from "./tools-okr.ts";
import { inspectionGap, misuFollowupTool, personActivity, photoSummary, recontractProgress, scheduleView, unhandledNow, vendorLookup } from "./tools-field.ts";
import { itSheetTool, kakaoSearchTool, kpiExplain, opsStatus } from "./tools-ext.ts";

export type { AskMode, AskTool, AskToolArgs, AskToolCtx, AskToolDef } from "./tool-util.ts";

const S = (description: string) => ({ type: "string", description });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, ...(required.length ? { required } : {}) });
const PERIOD = S("기간: '2026-10'(달) · '2026-10-W3'(주차) · '2026-Q4'(분기) · '이번 주'·'지난주'·'지난달'. 비우면 이번 달");
const FROM = S("시작 'YYYY-MM-DD'(또는 'YYYY-MM'). 비우면 이번 달 1일");
const TO = S("끝 'YYYY-MM-DD'(포함). 비우면 오늘");
const TEAM = S("팀 A~E(E = CSS·지방)");

export const ASK_TOOLS: AskToolDef[] = [
  {
    name: "okr_member_report", label: "OKR 기록 읽는 중",
    description: "한 사람의 OKR 분석 재료. 주차별 작성 여부(빠진 주), 목표별 주차 판정 흐름, 작성 품질 검사 9가지(판정 없음·숫자 없음·사유/개선계획/근거 빈칸·해당없음 근거·글 속 %와 판정 불일치·앞 주 복붙·쪼갠 달성기준 없음), 개인 달성률·팀 평균·전체 평균(홈 K19 와 같은 셈), 팀장·파트장 피드백, 근거 원문(칸마다 300자). '이민구 OKR 잘 됐나·어디가 부족한가' 같은 질문에 먼저 부른다.",
    parameters: obj({ person: S("사람 이름(명단 이름)"), period: PERIOD }, ["person"]),
    run: okrMemberReport,
  },
  {
    name: "okr_team_report", label: "팀 OKR 비교 중",
    description: "한 파트(A~D)의 OKR — 팀원별 달성률·미작성 주·판정 분포·작성 검사 건수, 목표별 판정 분포와 미흡·미착수 팀원, 파트 종합 판정과 팀원 판정(가장 나쁜 것)이 다른 칸. E(CSS)는 OKR 대상 아님.",
    parameters: obj({ team: S("A·B·C·D"), period: PERIOD }, ["team"]),
    run: okrTeamReport,
  },
  {
    name: "person_activity", label: "사람 활동 모으는 중",
    description: "사람 한 명의 기간 활동 — 표별 건수(점검·AS·방문·접수 작성·시트 처리·일정 담당·부품·확장성·미수 방문·초과 제안·불만·담당자 변경·물류·활동 기록·사진), 같은 팀 1인 평균, 요일 분포, 많이 간 업체. '박영현 이번 달 뭐 했어', '지경민 접수 처리 패턴'.",
    parameters: obj({ person: S("사람 이름"), from: FROM, to: TO }, ["person"]),
    run: personActivity,
  },
  {
    name: "inspection_gap", label: "점검 누락 찾는 중",
    description: "팀의 워킨맵 점검 대상(분기점검·매월점검) 중 기간 안 점검 기록이 없는 곳과 마지막 점검일(자동 일정과 같은 서버 매칭). 지도 색 G5·G12 완료는 따로. 'C팀 이번 달 점검 누락 업체'.",
    parameters: obj({ team: TEAM, from: FROM, to: TO }, ["team"]),
    run: inspectionGap,
  },
  {
    name: "recontract_progress", label: "재계약 진행 보는 중",
    description: "워킨맵 재계약 지점의 팀별 진행(G5 완료·G6 진행·G7 제외, 홈 K35 와 같은 셈) + 미완료 지점의 재계약 표 마지막 갱신상태·위험도·진행상황 글. '재계약 진행률 낮은 팀과 원인'.",
    parameters: obj({ team: TEAM, quarter: { type: "number", description: "분기 1~4(비우면 이번 분기)" }, year: { type: "number", description: "연도(예 2027, 비우면 그 분기에 가장 가까운 해 — 12월에 1분기면 다음 해)" } }),
    run: recontractProgress,
  },
  {
    name: "misu_followup", label: "미수 방문 대조 중",
    description: "미수 N개월 이상 업체(최신 미수 목록) × 미수 방문이력·방문기록·미수 CS 체크 — 방문 안 한 곳, 약속일 지난 곳. '미수 3개월 이상 중 방문 안 한 곳'.",
    parameters: obj({ min_months: { type: "number", description: "최소 미수 개월(기본 3)" }, team: TEAM, since: S("방문을 볼 시작일(기본 60일 전)") }),
    run: misuFollowupTool,
  },
  {
    name: "unhandled_now", label: "미처리 모으는 중",
    description: "지금 미처리 — 지난 일정(완료 아님·매월점검 제외)·앱 부서 접수·시트 열린 줄을 한 목록으로, 카톡방(room_map)·종류·팀 묶음과 경과일. '카톡방별 오늘 미처리', '지난 일정 처리 안 된 것 누구 건'. 홈 미처리 숫자는 packs.kpi 우선.",
    parameters: obj({ team: TEAM, kind: S("종류 낱말(CS접수·물류·원격이관·IT·경영지원·영업팀)"), room: S("카톡방 이름 일부") }),
    run: unhandledNow,
  },
  {
    name: "schedule_view", label: "일정 보는 중",
    description: "사람·팀의 일정(as_tickets), 내 일정 고정 순서(서버 저장분), 일정 메모, 팀 캘린더(회식·교육·휴무 — 묻는 사람과 같은 팀만), suggest:true 면 자동 일정 후보. '내일 이민구 일정 순서', 'C팀 이번 주 휴무'.",
    parameters: obj({ person: S("사람 이름"), team: TEAM, from: S("시작 'YYYY-MM-DD'(기본 오늘)"), to: S("끝(기본 7일 뒤)"), suggest: { type: "boolean", description: "자동 일정 후보도" } }),
    run: scheduleView,
  },
  {
    name: "vendor_lookup", label: "업체 찾는 중",
    description: "업체 이름 → 업체 코드·별칭·워킨맵 팀/종류/색·표별 최근 1년 기록 수. 질문에 업체가 섞여 있을 때(예 'C팀 중 잡플러스 …') 먼저 확인용.",
    parameters: obj({ name: S("업체 이름") }, ["name"]),
    run: vendorLookup,
  },
  {
    name: "photo_summary", label: "사진 세는 중",
    description: "사진 앨범 요약 — 앨범 수·장수·분류·사람별·업체 상위·최근 앨범 id(사진 주소는 주지 않음). team 을 주면 앨범 안 올린 팀원도. '무암 사진 있어?', '이번 주 사진 안 올린 기사'.",
    parameters: obj({ vendor: S("업체 이름 일부"), author: S("올린 사람"), category: S("분류 낱말"), team: TEAM, from: FROM, to: TO }),
    run: photoSummary,
  },
  {
    name: "it_sheet", label: "IT 시트 읽는 중",
    description: "IT파트 공개 시트(남의 시트 — 읽기만)에서 낱말이 모두 든 줄. tab: knowledge(IT기술력DB) · history(PC DB 처리이력) · sales(영업상담DB) · links(교육자료링크). 'PC 부팅 안 될 때 IT 처리이력'.",
    parameters: obj({ tab: { type: "string", enum: ["knowledge", "history", "sales", "links"] }, q: S("띄어쓰기로 나눈 낱말(모두 포함)"), limit: { type: "number", description: "최대 40" } }, ["tab", "q"]),
    run: (args, ctx) => itSheetTool(args, ctx),
  },
  {
    name: "kakao_search", label: "카톡 대화 찾는 중",
    description: "카톡방 대화 원문 검색(가린 글). 스위치가 꺼져 있으면 enabled:false — 그때는 카톡을 근거로 쓰지 않는다. 검색어 필수.",
    parameters: obj({ q: S("검색 낱말(최대 3개)"), room: S("방 이름"), from: S("YYYY-MM-DD"), to: S("YYYY-MM-DD") }, ["q"]),
    run: kakaoSearchTool,
  },
  {
    name: "ops_status", label: "운영 상태 확인 중",
    description: "운영 상태 요약 — 노트북 실행기 심박 몇 분 전, 카톡 방별 최근 배달(24시간), 발송 대기 수, 시트 동기화 실패·대기 수, 주요 스위치 on/off. '카톡 잘 가고 있어?', '노트북 살아있어?'.",
    parameters: obj({}),
    run: (args, ctx) => opsStatus(args, ctx),
  },
  {
    name: "kpi_explain", label: "KPI 정의 찾는 중",
    description: "KPI 정의(무엇을 어떤 기준으로 세나·숫자를 낸 함수·목표 기준)와 아직 셈법이 없는 지표의 사유. 'OKR 달성률 어떻게 계산해?', 'K24 기준'. 숫자 자체는 packs.kpi.",
    parameters: obj({ kpi: S("'K19' 또는 지표 이름 낱말(비우면 목록)") }),
    run: kpiExplain,
  },
];
