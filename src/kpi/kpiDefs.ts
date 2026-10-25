/**
 * 홈 KPI 현황판 — KPI 정의 목록(설계안 docs/tasks/home-kpi-dashboard.md, Q1~Q13 = 8절 제안값 확정, 2026-10-23).
 * 사용자 추가 요구(같은 날): ① 분기 점검 목표 꼴(워킨맵 "점검 n/m · %"와 남은 영업일·하루 필요량) ② 인당 목표(관리 탭에서 고침)
 * ③ CS 전체 → 팀 → 개인 같은 KPI 달성 ④ 금일 현황 한 줄 ⑤ FIELD 실적 종류 전부 + 칭찬 ⑥ 주요 목표(main) 표시.
 *
 * 여기에는 "무엇을 어떤 기준으로 세나"와 목표 기본값만 둔다. 숫자는 kpiCompute.ts 가 기존 함수로 낸다.
 * 목표값 원칙(설계안 3절 7): 기본값 = docs/okr/2026-Q4-okr.json·사용자 지시에서 옮긴 숫자,
 * app_config KPI_TARGETS(JSON)가 있으면 덮는다(SQL 불필요). 모양:
 *   {"K7":{"perPersonBizDay":1,"main":true},"K10":{"perTeamMonth":2,"perPersonMonth":1},"holidays":["2026-12-31"]}
 *   · 칸 이름은 KpiTarget 그대로, main = 주요 목표 보기에 넣을지, holidays = 영업일에서 더 뺄 날(회사 휴무 등)
 */
export type KpiId =
  | "K1" | "K2" | "K3" | "K4" | "K7" | "K8" | "K10" | "K11" | "K12" | "K13" | "K14" | "K15"
  | "K16" | "K17" | "K18" | "K19" | "K20" | "K21"
  | "K24" | "K25" | "K26" | "K27" | "K28" | "K29" | "K30" | "K31" | "K32" | "K33" | "K34";

export type KpiGroup = "현장 실행" | "고객가치·영업" | "응대 속도" | "성장·OKR";
/** 기간 키 — 금일·이번 주(월~일, Q4)·이번 달·이번 분기 */
export type KpiPeriodKey = "today" | "week" | "month" | "quarter";
/** 기본 기간: 위 넷 + 열린 건(기간 없음) + 최근 7일 */
export type KpiPeriod = KpiPeriodKey | "open" | "7d";
/** 위젯 틀(설계안 4-1) */
export type KpiWidget = "number" | "ring" | "teamBars" | "spark" | "goal";
export type KpiSize = "1x1" | "2x1" | "2x2";
/** 누르면 열 화면 — App 의 screen 값과 그 화면 안에서 고를 탭(안내 글) */
export type KpiScreen = { screen: "weekly" | "lookup" | "okr" | "walkingMap" | "serviceReception" | "calendar" | "contactChanges" | "selfdev" | "itHistory"; tab: string };
/** 숫자 원본(로더 단위) — kpiData.ts 가 이 단위로 한 번씩만 읽는다 */
export type KpiSource =
  | "roster" | "field" | "expansion" | "events" | "workin" | "overage" | "recontract" | "bulman" | "misu"
  /** 물류 양식 표(logistics_records, 2026-10-24 — K24 가 활동 기록 대신) */
  | "logistics"
  /** 담당자·주소 변경 표(contact_changes, 키맨체크 시트 행 포함 — 2026-10-24 3단계, K27 이 활동 기록 대신) */
  | "contact"
  | "unhandled" | "receptionWeek" | "keyman" | "okr" | "blog" | "praise" | "customerPraise" | "visits" | "office"
  /** IT 학습 기록 표(2026-10-24, supabase/it-learning-logs-20261024.sql) — 표가 없으면 "준비 중" */
  | "itQuiz" | "itPractice"
  /** 오버홀 기록 구글 시트(overhaulSheet.loadOverhaulRows, 탭 = app_config OVERHAUL_SHEET_TAB, 기본 "리스트(26년)") — 2026-10-24 */
  | "overhaul";
/** 상태: 바로 됨 · 원본 표 실행 대기(표 없으면 "준비 중") · 원본 없음(회색 안내, 연결 필요) */
export type KpiStatus = "ready" | "pending-table" | "unlinked";
/** 셀 수 있는 범위 */
export type KpiScopeKind = "all" | "team" | "person";
/**
 * 목표 기준
 *  perPersonWeek   인당 주 n(기간 영업일 ÷ 5 주로 환산 — 공휴일 주는 줄어든다)
 *  perPersonBizDay 인당 영업일 n(주말·한국 공휴일·holidays 제외)
 *  perTeamMonth    파트당 월 n(전체 = monthTotal 이 있으면 그것, 없으면 파트 수 × n; 개인은 perPersonMonth 를 줄 때만)
 *  workin          워킨맵 분기 대상 단위(완료/대상)
 *  ratio           분자/분모 %(목표 value %)
 *  zero            0 이어야 정상(미처리·지남)
 *  none            목표 없음 — 실적만
 */
export type KpiTargetBasis = "perPersonWeek" | "perPersonBizDay" | "perTeamMonth" | "workin" | "ratio" | "zero" | "none";

export type KpiTarget = {
  value?: number;
  perPersonWeek?: number;
  perPersonBizDay?: number;
  perTeamMonth?: number;
  perPersonMonth?: number;
  monthTotal?: number;
  quarterTotal?: number;
  /** 주요 목표 보기에 넣을지(관리 탭에서 켜고 끔) */
  main?: boolean;
};

export type KpiDef = {
  id: KpiId;
  name: string;
  unit: string;
  group: KpiGroup;
  period: KpiPeriod;
  /** 고를 수 있는 기간(금일·주·월·분기 중) */
  periods: KpiPeriodKey[];
  scopes: KpiScopeKind[];
  widget: KpiWidget;
  sizes: KpiSize[];
  /** 위젯 아래 한 줄 "기준: …" (설계안 3절 3) */
  basis: string;
  /** 숫자를 낸 기존 함수(근거 추적용) */
  source: string;
  loads: KpiSource[];
  status: KpiStatus;
  targetBasis: KpiTargetBasis;
  /** 목표 기본값 + 출처. 없으면 null(실적만) */
  target: (KpiTarget & { from: string }) | null;
  /** 주요 목표 기본값(사용자 2026-10-23: 점검 분기·블로그 주2·PC 영업일1·초과 월2·IT 실습 주1·IT 퀴즈 주2·오버홀 주2점) */
  main: boolean;
  /** 큰 값이 좋은가(미처리·지남은 작을수록 좋다) */
  better: "up" | "down";
  /** 팀 줄 — OKR 은 A~D(E 제외, OKR_TEAMS), 미처리는 부서 포함 */
  teams: "A~E" | "A~D" | "A~E+부서" | "없음";
  screen: KpiScreen;
  /** 금일 현황 띠에 넣을지 */
  today: boolean;
};

export const KPI_TARGETS_CONFIG_KEY = "KPI_TARGETS";

const OKR_Q4 = "docs/okr/2026-Q4-okr.json";
const ALL_P: KpiPeriodKey[] = ["today", "week", "month", "quarter"];
const ATP: KpiScopeKind[] = ["all", "team", "person"];
const AT: KpiScopeKind[] = ["all", "team"];
const FIELD_BASIS = "점검·AS 표 · 같은 날 같은 업체 같은 기기 재전송 1 · 오발송 삭제·팀장 제외 · 팀 = 지역 칸(없으면 작성자 팀)";
const EVENT_BASIS = "활동 기록 · 오발송 제외 · 같은 사람·종류·업체 10분 안 재전송 1건 · 팀장 제외 · 팀 = 활동 기록 팀";

export const KPI_DEFS: KpiDef[] = [
  // ── A. 현장 실행 ──
  {
    id: "K2", name: "분기 점검 진행", unit: "단위", group: "현장 실행", period: "quarter", periods: ["quarter"], scopes: AT,
    widget: "ring", sizes: ["1x1", "2x1", "2x2"], basis: "워킨맵 · 분기점검 G5·G12 완료 · 매월점검 3단위(G2=1·G3=2·G5/G12=3) · 남은 영업일(분기 말일·말일 10일 전)",
    source: "workinProgress.teamWorkinProgress·workinPace — 워킨맵 '팀별 진행률'과 같은 식", loads: ["workin", "roster"], status: "ready",
    targetBasis: "workin", target: { value: 100, from: "분기 말 100%(설계안 K2)" }, main: true, better: "up", teams: "A~E",
    screen: { screen: "walkingMap", tab: "팀별 진행률" }, today: false,
  },
  {
    id: "K1", name: "점검", unit: "대", group: "현장 실행", period: "week", periods: ALL_P, scopes: ATP, widget: "number", sizes: ["1x1", "2x1", "2x2"],
    basis: `${FIELD_BASIS} · 기기 대수`, source: "workCount.countField(kind inspection) — 홈·조회 탭·팀 현황·순위표 공통", loads: ["field"], status: "ready",
    targetBasis: "none", target: null, main: false, better: "up", teams: "A~E", screen: { screen: "weekly", tab: "팀 현황" }, today: true,
  },
  {
    id: "K3", name: "AS", unit: "건", group: "현장 실행", period: "week", periods: ALL_P, scopes: ATP, widget: "spark", sizes: ["1x1", "2x1"],
    basis: `${FIELD_BASIS} · 양식 건수`, source: "workCount.countField(kind as)", loads: ["field"], status: "ready",
    targetBasis: "none", target: null, main: false, better: "up", teams: "A~E", screen: { screen: "weekly", tab: "팀 현황" }, today: true,
  },
  {
    id: "K24", name: "물류", unit: "건", group: "현장 실행", period: "week", periods: ALL_P, scopes: ATP, widget: "number", sizes: ["1x1"],
    basis: "물류 양식 표 + 점검·AS 양식의 세팅 · 여분·마감 제외(팀 현황 '물류' 칸) · 같은 날 같은 사람 같은 업체 1건 · 오발송 삭제·팀장 제외 · 팀 = 작성자 팀", source: "formCount.countForms(logistics, part main) — 팀 현황·순위표·조회 탭 공통(2026-10-24, 활동 기록 대신)",
    loads: ["logistics", "field"], status: "ready", targetBasis: "none", target: null, main: false, better: "up", teams: "A~E", screen: { screen: "weekly", tab: "팀 현황 › 물류" }, today: true,
  },
  {
    id: "K4", name: "방문 업체", unit: "곳", group: "현장 실행", period: "week", periods: ALL_P, scopes: ATP, widget: "number", sizes: ["1x1"],
    basis: "방문 장부 · 방문한 행만 · (날짜·업체) 1건 · 취소 제외 · 팀 = 작성자 명단 팀", source: "visits.getTeamVisits + 주간현황판 summarizeVisits 의 visits 규칙",
    loads: ["visits"], status: "ready", targetBasis: "none", target: null, main: false, better: "up", teams: "A~E", screen: { screen: "weekly", tab: "내 현황" }, today: true,
  },
  {
    id: "K33", name: "오버홀", unit: "점", group: "현장 실행", period: "week", periods: ALL_P, scopes: ATP, widget: "goal", sizes: ["1x1", "2x1"],
    basis: "오버홀 기록 구글 시트 · 한 행 = 1건 · 날짜 칸(yy/mm/dd·yyyy/m/d) · 점 = 오버홀포인트 합(수리포인트는 사람 칸에 따로) · 팀 = 명단 팀(없으면 부서명 끝 글자) · 외부인력·퇴사자·직책자 제외 · 목표 = 인원 × 주 2점",
    source: "overhaulSheet.loadOverhaulRows·countOverhaul(탭 = app_config OVERHAUL_SHEET_TAB, 없으면 '리스트(26년)' · export CSV gid)",
    loads: ["overhaul", "roster"], status: "ready", targetBasis: "perPersonWeek", target: { perPersonWeek: 2, from: "사용자 2026-10-23 '오버홀 인당 주 2점'" },
    main: true, better: "up", teams: "A~E", screen: { screen: "weekly", tab: "내 현황 › 사무실" }, today: true,
  },
  // ── B. 고객가치·영업 ──
  {
    id: "K7", name: "PC확장성", unit: "건", group: "고객가치·영업", period: "month", periods: ALL_P, scopes: ATP, widget: "teamBars", sizes: ["2x1", "2x2"],
    basis: "PC 확장성 표(시트 포함) · 같은 날 같은 업체 재전송 1건 · 오발송 삭제·팀장 제외 · 팀 = 지역 칸(없으면 작성자 팀) · 목표 = 인원 × 영업일 1건",
    source: "workCount.countExpansion(kind expansion_it)", loads: ["expansion", "roster"], status: "ready",
    targetBasis: "perPersonBizDay", target: { perPersonBizDay: 1, from: "사용자 2026-10-23 'PC확장성 인당 영업일 1개'(공휴일·주말 제외)" },
    main: true, better: "up", teams: "A~E", screen: { screen: "lookup", tab: "PC 확장성" }, today: true,
  },
  {
    id: "K8", name: "복합기확장성", unit: "건", group: "고객가치·영업", period: "month", periods: ALL_P, scopes: ATP, widget: "teamBars", sizes: ["2x1", "2x2"],
    basis: "복합기 확장성 표(시트 포함) · 같은 날 같은 업체 재전송 1건 · 오발송 삭제·팀장 제외 · 팀 = 작성자 팀",
    source: "workCount.countExpansion(kind expansion_copier)", loads: ["expansion"], status: "ready",
    targetBasis: "none", target: null, main: false, better: "up", teams: "A~E", screen: { screen: "lookup", tab: "복합기 확장성" }, today: true,
  },
  {
    id: "K10", name: "초과사용 제안 방문", unit: "건", group: "고객가치·영업", period: "month", periods: ["month", "quarter"], scopes: ATP, widget: "goal", sizes: ["2x1", "1x1", "2x2"],
    basis: "초과조정 표 · 방문일(없으면 작성 시각) · 같은 사람·같은 날·같은 업체 1건 · 오발송 삭제·팀장 제외 · 팀 = 지역 칸 → 출처 괄호 → 작성자 팀 · 팀 과제: 목표 = 파트당 월 2건(CS 전체 = 파트 수 × 2, 분기 = × 3) · 개인은 목표 없이 실적만 · 월 목표라 [이번 주]에서도 이번 달로 셈",
    source: "kpiCompute.countOverageVisits = formCount.countForms(overage) (Q7: 초과조정 양식 1건 = 방문 1건)", loads: ["overage", "roster"], status: "ready",
    targetBasis: "perTeamMonth", target: { perTeamMonth: 2, from: `${OKR_Q4} 4번(파트 월 2·분기 6) · 사용자 2026-10-24 '팀 과제, 팀당 월 2건' — 전체 = 파트 수 × 2(monthTotal·quarterTotal 을 설정하면 그 값) · 인당은 perPersonMonth 로 설정` },
    main: true, better: "up", teams: "A~E", screen: { screen: "lookup", tab: "초과조정" }, today: true,
  },
  {
    id: "K11", name: "초과 제안 기록 완결률", unit: "%", group: "고객가치·영업", period: "month", periods: ["week", "month", "quarter"], scopes: ATP, widget: "ring", sizes: ["1x1"],
    basis: "K10 과 같은 행 · 고객반응·진행상태 둘 다 채운 건 / 건", source: "kpiCompute.overageCompleteness", loads: ["overage"], status: "ready",
    targetBasis: "ratio", target: { value: 100, from: `${OKR_Q4} 4번("고객반응·조치내용 100% 기록")` }, main: false, better: "up", teams: "A~E", screen: { screen: "lookup", tab: "초과조정" }, today: false,
  },
  {
    id: "K25", name: "재계약 진행", unit: "곳", group: "고객가치·영업", period: "month", periods: ALL_P, scopes: ATP, widget: "number", sizes: ["1x1"],
    basis: "재계약 표(FIELD 웹앱·카톡 가져오기) · 같은 업체는 기간 안 1곳 · 오발송 삭제·팀장 제외 · 팀 = 지역 칸 → 출처 괄호 → 작성자 팀", source: "formCount.countForms(recontract) — 팀 현황·순위표·조회 탭 공통(2026-10-24, 활동 기록 대신)",
    loads: ["recontract"], status: "ready", targetBasis: "none", target: null, main: false, better: "up", teams: "A~E", screen: { screen: "weekly", tab: "팀 현황 › 재계약" }, today: true,
  },
  {
    // 2026-10-24 홈 개편: 따로 위젯 없이 홈 '미처리 전체' 카드의 한 줄(합산)과 달성표 [전체 지표]에만 나온다
    id: "K12", name: "재계약 확인 지남", unit: "곳", group: "고객가치·영업", period: "open", periods: [], scopes: AT, widget: "number", sizes: ["1x1"],
    basis: "재계약 표 · 업체별 마지막 기록 · 다음확인일(날짜 칸) < 오늘 · 최종상태 갱신완료·종료 아님 · 글자로 적힌 옛 확인일은 따로 셈",
    source: "kpiCompute.recontractOverdue (Q8: 계약서 7영업일 확인 대신)", loads: ["recontract"], status: "ready",
    targetBasis: "zero", target: { value: 0, from: `${OKR_Q4} 6번("7영업일 이내 확인 100%" 대체, Q8)` }, main: false, better: "down", teams: "A~E", screen: { screen: "lookup", tab: "재계약" }, today: false,
  },
  {
    id: "K13", name: "재계약 갱신 완료율", unit: "%", group: "고객가치·영업", period: "quarter", periods: ["month", "quarter"], scopes: ATP, widget: "ring", sizes: ["1x1"],
    basis: "재계약 표 · 기간 안 기록 업체(표기 변형 묶음) 중 마지막 기록이 갱신완료인 곳 · 팀장 제외", source: "kpiCompute.recontractRenewal", loads: ["recontract"], status: "ready",
    targetBasis: "ratio", target: null, main: false, better: "up", teams: "A~E", screen: { screen: "lookup", tab: "재계약" }, today: false,
  },
  {
    id: "K14", name: "미수 방문", unit: "건", group: "고객가치·영업", period: "month", periods: ALL_P, scopes: ATP, widget: "teamBars", sizes: ["2x1", "1x1"],
    basis: "미수 방문이력 표 · 숨김 제외 · 보완 기록은 원 기록 1건으로(실효 기록) · 같은 날 같은 사람 같은 업체 1건 · 팀 = 작성 당시 팀 · 팀장 제외",
    source: "misuVisit.effectiveMisuVisits → formCount.countForms(misu) + misuVisitHistoryData.loadMisuVisits", loads: ["misu"], status: "pending-table",
    targetBasis: "none", target: null, main: false, better: "up", teams: "A~E", screen: { screen: "lookup", tab: "미수 › 방문 이력" }, today: true,
  },
  {
    id: "K26", name: "불만 처리", unit: "곳", group: "고객가치·영업", period: "month", periods: ALL_P, scopes: ATP, widget: "number", sizes: ["1x1"],
    basis: "불만 표(웹앱·시트·카톡 가져오기) · 같은 업체는 기간 안 1곳 · 오발송 삭제·팀장 제외 · 팀 = 지역 칸 → 출처 괄호 → 작성자 팀", source: "formCount.countForms(complaint) — 팀 현황·순위표·조회 탭 공통(2026-10-24, 활동 기록 대신)",
    loads: ["bulman"], status: "ready", targetBasis: "none", target: null, main: false, better: "up", teams: "A~E", screen: { screen: "weekly", tab: "팀 현황 › 불만" }, today: true,
  },
  {
    id: "K15", name: "불만 처리 완료율", unit: "%", group: "고객가치·영업", period: "month", periods: ["week", "month", "quarter"], scopes: ATP, widget: "ring", sizes: ["1x1"],
    basis: "불만 표 · 기간 안 기록 업체(표기 변형 묶음) 중 마지막 기록 최종상태 완료 · 오발송 삭제·팀장 제외", source: "kpiCompute.complaintCompletion", loads: ["bulman"], status: "ready",
    targetBasis: "ratio", target: { value: 100, from: `${OKR_Q4} 6번("불만 건 원인·다음 조치 100% 기록")` }, main: false, better: "up", teams: "A~E", screen: { screen: "lookup", tab: "불만" }, today: false,
  },
  {
    id: "K27", name: "담당자 변경", unit: "건", group: "고객가치·영업", period: "month", periods: ALL_P, scopes: ATP, widget: "number", sizes: ["1x1"],
    basis: "담당자·주소 변경 표(FIELD 양식 + 키맨체크 시트) · 같은 날 같은 사람 같은 업체 1건 · 오발송 삭제·팀장 제외 · 팀 = CS(A~E) 작성자만 지역 칸(없으면 작성자 팀), CS 밖 작성자는 팀 미지정(전체에만)",
    source: "formCount.countForms(contact_change) — 팀 현황·순위표·조회 탭 공통(2026-10-24 3단계, 활동 기록 대신)", loads: ["contact"], status: "ready",
    targetBasis: "none", target: null, main: false, better: "up", teams: "A~E", screen: { screen: "weekly", tab: "팀 현황 › 담당자·주소 변경" }, today: true,
  },
  {
    id: "K28", name: "교체양식", unit: "건", group: "고객가치·영업", period: "month", periods: ALL_P, scopes: ATP, widget: "number", sizes: ["1x1"],
    // 교체양식은 복사 전용(전송 없음)이라 원본 표가 없다 — [복사] 때 남는 활동 기록이 유일한 원본(2026-10-24 확인)
    basis: EVENT_BASIS, source: "loadWorkEvents + countableEvents(replacement) — 원본 표 없음([복사] 활동 기록이 원본)", loads: ["events"], status: "ready",
    targetBasis: "none", target: null, main: false, better: "up", teams: "A~E", screen: { screen: "weekly", tab: "팀 현황 › 교체양식" }, today: true,
  },
  // ── C. 응대 속도 ──
  {
    id: "K16", name: "서비스접수 미처리", unit: "건", group: "응대 속도", period: "open", periods: [], scopes: AT, widget: "number", sizes: ["1x1", "2x2"],
    basis: "열린 접수 6종(90일) · 7일 지난 원격대기 제외 · 시트 기준 스위치 켜지면 시트 상태 · 팀 = 지역(지원 3종은 부서)",
    source: "homeUnhandled.mergeUnhandled + countUnhandledTabs — 홈 미처리 판과 같은 함수", loads: ["unhandled"], status: "ready",
    targetBasis: "zero", target: { value: 0, from: "0건(설계안 K16)" }, main: false, better: "down", teams: "A~E+부서", screen: { screen: "serviceReception", tab: "미처리 현황" }, today: false,
  },
  {
    id: "K17", name: "지난 일정 미처리", unit: "건", group: "응대 속도", period: "open", periods: [], scopes: AT, widget: "number", sizes: ["1x1", "2x2"],
    basis: "일정(as_tickets) 날짜 지남·완료 아님·180일 안 · 매월점검 제외 · 열린 접수와 겹치는 AS 일정은 접수로만 셈",
    source: "homeUnhandled.mergeUnhandled(source ticket)", loads: ["unhandled"], status: "ready",
    targetBasis: "zero", target: { value: 0, from: "0건(설계안 K17)" }, main: false, better: "down", teams: "A~E", screen: { screen: "calendar", tab: "미처리" }, today: false,
  },
  {
    id: "K29", name: "접수 처리율(이번 주)", unit: "%", group: "응대 속도", period: "week", periods: ["week"], scopes: ["all"], widget: "ring", sizes: ["1x1"],
    basis: "이번 주(월~일) 접수된 서비스접수 중 완료 / 전체 · 삭제 제외", source: "deptReception.weekCompletionRate — 접수 현황판 '이번 주 완료율'과 같은 함수",
    loads: ["receptionWeek"], status: "ready", targetBasis: "ratio", target: null, main: false, better: "up", teams: "없음", screen: { screen: "serviceReception", tab: "미처리 현황" }, today: false,
  },
  {
    id: "K18", name: "키맨 변경 인사 완료율", unit: "%", group: "응대 속도", period: "7d", periods: [], scopes: ["all"], widget: "ring", sizes: ["1x1"],
    basis: "담당자 변경 표 최근 7일 · 담당·키맨·명의 변경 중 인사 완료 표시된 것 · 오발송 삭제 제외",
    source: "kpiCompute.keymanKpi — 홈 '키맨 변경 7일' 칸과 같은 조건", loads: ["keyman"], status: "ready",
    targetBasis: "ratio", target: { value: 100, from: "100%(설계안 K18)" }, main: false, better: "up", teams: "없음", screen: { screen: "contactChanges", tab: "담당자 변경" }, today: false,
  },
  // ── D. 성장·OKR ──
  {
    id: "K19", name: "OKR 달성률", unit: "%", group: "성장·OKR", period: "week", periods: ["week", "month"], scopes: AT, widget: "ring", sizes: ["1x1", "2x1", "2x2"],
    basis: "이번 주(월~금 주차) 파트 판정 — 파트 종합 판정, 없으면 그 주 팀원 판정 중 가장 나쁜 것 · 완료·해당없음 / 판정 있는 목표 · A~D(E 제외) · 이번 주 판정이 없는 파트는 0% 가 아니라 '미작성' · [이번 달] = 월 파트 종합",
    source: "okr.achievementRate·judgmentCounts(입력 = 이번 주 okr_reports, 2026-10-24 사용자 '프로들은 주만 쓴다') — 월은 OKR 월 통합집계 파트 카드와 같은 식", loads: ["okr"], status: "ready",
    targetBasis: "ratio", target: { value: 100, from: `${OKR_Q4} 전 목표 100%` }, main: false, better: "up", teams: "A~D", screen: { screen: "okr", tab: "주차 기록" }, today: false,
  },
  {
    id: "K20", name: "블로그 답글", unit: "건", group: "성장·OKR", period: "week", periods: ALL_P, scopes: ATP, widget: "goal", sizes: ["1x1", "2x1"],
    basis: "블로그 기록 시트 · 한 행 = 1건 · 목표 = 인원 × 주 2건", source: "blogSheet.countBlog — 주간현황판 블로그 댓글 칸과 같은 함수", loads: ["blog", "roster"], status: "ready",
    targetBasis: "perPersonWeek", target: { perPersonWeek: 2, from: `${OKR_Q4} 8번(인당 주 2건) · 사용자 2026-10-23` }, main: true, better: "up", teams: "A~E",
    screen: { screen: "weekly", tab: "블로그 댓글" }, today: true,
  },
  {
    id: "K21", name: "IT 실습(기술력)", unit: "회", group: "성장·OKR", period: "week", periods: ["week", "month", "quarter"], scopes: ATP, widget: "goal", sizes: ["1x1"],
    basis: "IT 학습 [실습 기록] 1행 = 1회 + 주간 현황판 배운 점 중 브랜드 IT 1줄 = 1회(같은 날 같은 글 1회) · 작성자 = 기기에서 고른 작성자(배운 점은 글쓴이) · 날짜 = KST(배운 점은 줄의 날짜 — 연도 없는 10/20 은 그 주 연도, 못 읽으면 그 주 월요일) · 팀장 제외 · 목표 = 인원 × 주 1회",
    source: "itLogs.loadItPracticeLogs(it_practice_logs, 2026-10-24) + visits.getWeeklyNotes → learningLines.itLearningRowsFromNotes(배운 점 브랜드 IT, 2026-10-25) — 둘 다 없을 때만 준비 중", loads: ["itPractice", "roster"], status: "ready", targetBasis: "perPersonWeek", target: { perPersonWeek: 1, from: `사용자 2026-10-23 'IT 실습 기술력 주 1회'(${OKR_Q4} 7번)` },
    main: true, better: "up", teams: "A~E", screen: { screen: "itHistory", tab: "IT 학습 › 실습 기록" }, today: false,
  },
  {
    id: "K34", name: "IT 퀴즈", unit: "회", group: "성장·OKR", period: "week", periods: ["week", "month", "quarter"], scopes: ATP, widget: "goal", sizes: ["1x1"],
    basis: "IT 학습 › 기술 퀴즈 완료 1번 = 1회(it_quiz_attempts) · 작성자 = 기기에서 고른 작성자 · 날짜 = KST · 팀장 제외 · 목표 = 인원 × 주 2회",
    source: "itLogs.loadItQuizAttempts(it_quiz_attempts, 2026-10-24) — 표가 없으면 준비 중", loads: ["itQuiz", "roster"], status: "ready", targetBasis: "perPersonWeek", target: { perPersonWeek: 2, from: "사용자 2026-10-23 'IT 퀴즈 주 2회'" },
    main: true, better: "up", teams: "A~E", screen: { screen: "itHistory", tab: "기술 퀴즈" }, today: false,
  },
  {
    id: "K30", name: "받은 칭찬", unit: "건", group: "성장·OKR", period: "month", periods: ALL_P, scopes: ATP, widget: "number", sizes: ["1x1"],
    basis: "칭찬 게시판(praise_posts) · 받는 사람(to_name) 기준 · 팀 = 명단 팀", source: "praise_posts(자기개발 › 칭찬 탭 원본)", loads: ["praise"], status: "ready",
    targetBasis: "none", target: null, main: false, better: "up", teams: "A~E", screen: { screen: "selfdev", tab: "칭찬" }, today: true,
  },
  {
    id: "K31", name: "보낸 칭찬", unit: "건", group: "성장·OKR", period: "month", periods: ALL_P, scopes: ATP, widget: "number", sizes: ["1x1"],
    basis: "칭찬 게시판(praise_posts) · 쓴 사람(from_author) 기준 · 팀 = 명단 팀", source: "praise_posts", loads: ["praise"], status: "ready",
    targetBasis: "none", target: null, main: false, better: "up", teams: "A~E", screen: { screen: "selfdev", tab: "칭찬" }, today: false,
  },
  {
    id: "K32", name: "고객 칭찬 접수", unit: "건", group: "성장·OKR", period: "month", periods: ALL_P, scopes: ATP, widget: "number", sizes: ["1x1"],
    basis: "FIELD 칭찬 양식(field_sheet_sync_jobs category praise) · 작성 직원 기준 · 접수 시각 KST 날짜", source: "api.sendPraiseForm 이 쌓는 동기화 작업 행", loads: ["customerPraise"], status: "ready",
    targetBasis: "none", target: null, main: false, better: "up", teams: "A~E", screen: { screen: "selfdev", tab: "칭찬(고객 칭찬은 DB통합시트 칭찬 탭)" }, today: true,
  },
];

/** 재계약 확인 지남 정의(사용자 2026-10-24 "뭘까" — 홈 미처리 카드 ⓘ 에 이 문장 그대로) */
export const RECONTRACT_OVERDUE_DEFINITION = "재계약 표에서 업체별 마지막 기록의 \"다음확인일\"이 오늘보다 지났는데 최종상태가 갱신완료·종료가 아닌 곳.";

export const KPI_BY_ID: Record<KpiId, KpiDef> =Object.fromEntries(KPI_DEFS.map((d) => [d.id, d])) as Record<KpiId, KpiDef>;

/** 원본이 없거나 셈법이 다른 파일에 묻혀 만들지 않은 KPI 와 이유 */
export const KPI_NOT_BUILT: Array<{ id: string; name: string; reason: string }> = [
  { id: "K5", name: "점검 리포트 작성 완결률", reason: "'미작성' 판정이 InspectionReport.tsx 화면 안에 있음 — 함수로 꺼내는 작업이 이번 범위 밖" },
  { id: "K6", name: "해피콜 발송률", reason: "대상 규칙이 CustomerEngagement.tsx 화면 안에 있음 — 함수로 꺼낸 뒤 연결, 목표값 팀장 결정 대기" },
  { id: "K9", name: "PC·IT 홍보 안내 달성률", reason: "무엇으로 셀지(방문 기록 영업 1·2차 / PC확장성 / 홍보물 발송) Q6 팀장 판단 대기" },
  { id: "K22", name: "병목 개선 건수", reason: "숫자 칸 없음 — OKR 보고 글뿐" },
  { id: "K23", name: "FIELD 처리율", reason: "장부 행 ↔ 활동 기록을 잇는 열쇠가 정해지지 않음 — 새 셈법이 필요해 보류" },
  { id: "-", name: "청정기", reason: "청정기 점검은 점검 표(jeomgeom)에 같이 들어가 K1 에 포함 — 따로 셀 칸 없음(모델명 브랜드 판정은 api.ts 검색용 정규식뿐)" },
];

const NUM_FIELDS: Array<Exclude<keyof KpiTarget, "main">> = ["value", "perPersonWeek", "perPersonBizDay", "perTeamMonth", "perPersonMonth", "monthTotal", "quarterTotal"];

/** 목표 기본값(OKR 문서·사용자 지시에서 옮긴 것) + main 기본값 */
export function defaultKpiTargets(): Record<KpiId, KpiTarget> {
  const out = {} as Record<KpiId, KpiTarget>;
  for (const d of KPI_DEFS) {
    const t: KpiTarget = { main: d.main };
    if (d.target) for (const k of NUM_FIELDS) if (d.target[k] !== undefined) t[k] = d.target[k];
    out[d.id] = t;
  }
  return out;
}

export type KpiSettings = { targets: Record<KpiId, KpiTarget>; holidays: string[]; error: string };

/**
 * app_config KPI_TARGETS(JSON) → 기본값 위에 덮은 목표·주요 목표·추가 휴일. 이상한 값은 그 칸만 버리고 error 에 적는다
 * (조용히 삼키지 않음 — 관리 탭·위젯 안내용). 모르는 KPI id·칸 이름·음수·숫자 아닌 값은 무시.
 */
export function parseKpiTargets(raw: string | null | undefined): KpiSettings {
  const targets = defaultKpiTargets();
  const holidays: string[] = [];
  const text = String(raw ?? "").trim();
  if (!text) return { targets, holidays, error: "" };
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { targets, holidays, error: `${KPI_TARGETS_CONFIG_KEY} 가 JSON 이 아닙니다 — 기본 목표를 씁니다` }; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { targets, holidays, error: `${KPI_TARGETS_CONFIG_KEY} 는 {"K10":{"perTeamMonth":2}} 모양이어야 합니다 — 기본 목표를 씁니다` };
  const bad: string[] = [];
  for (const [id, over] of Object.entries(parsed as Record<string, unknown>)) {
    if (id === "holidays") {
      if (Array.isArray(over)) for (const d of over) { if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) holidays.push(d); else bad.push(`holidays.${String(d)}`); }
      else bad.push("holidays");
      continue;
    }
    if (!(id in KPI_BY_ID) || !over || typeof over !== "object" || Array.isArray(over)) { bad.push(id); continue; }
    const cur: KpiTarget = { ...targets[id as KpiId] };
    for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
      if (k === "main") { if (typeof v === "boolean") cur.main = v; else bad.push(`${id}.main`); continue; }
      const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
      if (!NUM_FIELDS.includes(k as (typeof NUM_FIELDS)[number]) || !Number.isFinite(n) || n < 0) { bad.push(`${id}.${k}`); continue; }
      cur[k as (typeof NUM_FIELDS)[number]] = n;
    }
    targets[id as KpiId] = cur;
  }
  return { targets, holidays, error: bad.length ? `${KPI_TARGETS_CONFIG_KEY} 에서 무시한 값: ${bad.join(", ")}` : "" };
}

/** 주요 목표 보기 목록(설정의 main 반영, 정의 순서) */
export function mainKpiIds(targets: Record<KpiId, KpiTarget>): KpiId[] {
  return KPI_DEFS.filter((d) => targets[d.id]?.main ?? d.main).map((d) => d.id);
}
