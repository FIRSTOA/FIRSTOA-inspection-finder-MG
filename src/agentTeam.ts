// 홈 "AI 에이전트 팀" 카드의 정적 데이터 (2026-10-19).
// 원본은 .claude/agents/<key>.md 8번째 줄 `이름 X · 부서 Y · 캐릭터 Z` — tests/agentTeam.test.ts 가 일치를 검사한다.
export type AgentModel = "opus" | "sonnet" | "haiku";
export type AgentRole = { key: string; name: string; emoji: string; model: AgentModel; desc: string; trigger: string };
/** 부서 색 — 역할 파일 frontmatter `color:` 계열에 맞춤(purple→fuchsia, green→lime). 모델 배지 색(보라·하늘·초록)과 겹치지 않게 골랐다. */
export type AgentAccent = "fuchsia" | "pink" | "blue" | "lime" | "yellow" | "orange" | "cyan";
/** accent: 카드 노드 색 · stage: AGENT_FLOW_STEPS 의 몇 번째 단계에서 일하는지(null = 흐름 밖 상시 감시) */
export type AgentDept = { name: string; roles: AgentRole[]; accent: AgentAccent; stage: number | null };
export type AgentLeader = { name: string; emoji: string; title: string; desc: string };

export const AGENT_LEADER: AgentLeader = {
  name: "클로드 · Claude Code (Fable 5.1)",
  emoji: "🧭",
  title: "팀장",
  desc: "누굴 부를지 정하고 최종 판단·코드 리뷰",
};

export const AGENT_DEPTS: AgentDept[] = [
  { name: "기획실", accent: "fuchsia", stage: 0, roles: [
    { key: "feature-planner", name: "한설계", emoji: "📐", model: "opus", desc: "기존 코드를 조사해 설계안 작성", trigger: "기능 추가·개선 요청이 오면 먼저" },
  ] },
  { name: "디자인실", accent: "pink", stage: 1, roles: [
    { key: "ui-designer", name: "윤화면", emoji: "🎨", model: "sonnet", desc: "화면 틀·레이아웃·일관성 담당", trigger: "새 화면을 만들거나 고칠 때" },
  ] },
  { name: "데이터실", accent: "blue", stage: 1, roles: [
    { key: "db-schema", name: "표다빈", emoji: "🗄️", model: "opus", desc: "테이블·권한·크론 설계와 SQL 작성", trigger: "새 표·컬럼·권한 에러가 날 때" },
  ] },
  { name: "개발실", accent: "lime", stage: 2, roles: [
    { key: "developer", name: "구현서", emoji: "🧑‍💻", model: "sonnet", desc: "승인된 설계안대로 코드 구현", trigger: "설계안 승인 뒤 구현할 때" },
    { key: "debugger", name: "오류진", emoji: "🔍", model: "opus", desc: "원인 추적·근본 수정·재발 방지", trigger: "에러·\"안 돼요\"가 들어왔을 때" },
  ] },
  { name: "품질실", accent: "yellow", stage: 3, roles: [
    { key: "qa-checker", name: "검수아", emoji: "✅", model: "sonnet", desc: "빌드·테스트·범위·회귀 검사", trigger: "작업을 끝내기 직전마다" },
  ] },
  { name: "검사실", accent: "orange", stage: 4, roles: [
    { key: "field-deploy-check", name: "배포준", emoji: "🚀", model: "haiku", desc: "배포 전후 통과·실패만 보고", trigger: "커밋·푸시·배포 직전과 직후" },
    { key: "sql-review", name: "권한나", emoji: "🔐", model: "sonnet", desc: "SQL 권한·삭제 위험·비밀키 검사", trigger: "SQL을 건네기 직전" },
    { key: "kakao-pc-rules", name: "방지훈", emoji: "💬", model: "sonnet", desc: "카톡 자동화 금지 규칙 강제", trigger: "카톡 PC·봇 코드 수정 전후" },
  ] },
  { name: "운영실", accent: "cyan", stage: null, roles: [
    { key: "ops-monitor", name: "감시연", emoji: "📡", model: "haiku", desc: "심박·발송·백업 상태를 읽기 전용 점검", trigger: "\"잘 돌아가?\" 질문이 올 때" },
  ] },
];

export const AGENT_FLOW = "기획 → 디자인·DB → 구현 → QA → 배포 검사";
/** 일 흐름 레일 단계(AGENT_FLOW 를 쪼갠 것 — 문구는 AGENT_FLOW 하나만 고치면 된다) */
export const AGENT_FLOW_STEPS = AGENT_FLOW.split(" → ");
