# 홈 "AI 에이전트 팀" 안내 카드 — 설계안 (2026-10-19, feature-planner)

## 1. 한 줄 목표와 쓰는 사람
홈 하단에 "FIELD를 만들고 지키는 AI 에이전트 팀" 카드를 넣어, 팀장(Claude Code)과 7개 부서·역할마다 이름·이모지·한 줄 설명을 보여 준다.
쓰는 사람: CS팀 직원 전원(대표 지시 "에이전트 공부")·대표. 폰(390px)과 PC 둘 다. 읽기 전용, 데이터는 정적 파일 하나(DB 없음).

## 2. 기존 코드 재사용/확장 지점
- 홈 본체 `src/Home.tsx`
  - 홈은 App에서 lazyScreen으로 통째로 분할(`src/App.tsx:59`), KeepAlive로 상태 유지(`src/App.tsx:6584`). Home 안에서는 lazy를 쓰지 않고 하위 카드를 직접 import(`Home.tsx:2-4, 34`).
  - 화면 순서(`Home.tsx:338-528`): ① 관제 덱 348-373(StatusPill 2열 + CostTile 371) → ② LiveSendBoard 376 → ③ 지표 379-426(lg 12열: 왼 8·오른 4) → 경고줄 427 → FeedbackBoard 430 → ④ 절약 효과 433-453(5/7) → ⑤ 모듈 그리드 456-477(sm 2열·lg 5열) → ⑥ 릴리스 + ⑦ 온보딩 480-520(5/7) → ⑧ 푸터 523-526.
  - 공용 스타일: `card`(246)·`eyebrow`(247) 상수. 하위 카드 파일은 같은 상수를 자기 파일에 다시 선언(`LiveSendBoard.tsx:16-17`). 섹션 틀은 `relative border-t border-white/[0.08] px-4 py-5 sm:px-6`(433·456·480, `FeedbackBoard.tsx:158`).
  - 모바일: 모든 그리드가 기본 1열, sm(640) 2열, lg(1024) 12열. 온보딩 단추는 `grid-cols-2 sm:grid-cols-4`(505).
- 본보기(안내성 카드)
  - **⑦ 온보딩 스테퍼** `Home.tsx:94-99`(정적 배열 manuals) + `503-519`(단추 그리드 + 고른 항목만 아래 인라인 펼침, `openManual` 상태 304). 이번 카드와 구조가 같다(부서 단추 → 역할 목록 펼침).
  - ⑥ 릴리스 "더 보기" 접기(`487-500`, `patchExpanded` 305) — 긴 목록 접는 방식.
  - `src/CostTile.tsx:112-124` — 칸 + 전체 창(모바일 바닥 시트·PC 가운데, `fixed inset-0 z-[400]`). 전체 조직도 창이 필요해지면 이 패턴.
  - `src/HelpCenter.tsx:10-34` — 정적 GUIDES 배열 + group 묶음. 데이터 파일 모양의 참고.

## 3. 데이터 설계 (정적, DB 없음)
`src/agentTeam.ts` 하나.
```
type AgentRole = { key: string; name: string; emoji: string; desc: string; trigger: string; file?: string };
  // key = .claude/agents/<key>.md 와 일치(검사실·일하는 역할 8개). 팀장·운영 쪽은 file 없음
type AgentDept = { key: string; name: string; emoji: string; blurb: string; roles: AgentRole[] };
export const AGENT_LEADER: { name: "Claude Code"; emoji; title: "팀장"; desc; rule: "CLAUDE.md" };
export const AGENT_DEPTS: AgentDept[]  // 7개 고정 순서: 기획·디자인·데이터·개발·품질·검사실·운영
export const AGENT_FLOW: string[]       // "기획 → 디자인/DB → 구현 → QA → 배포 검사" (AGENTS.md:37)
```
부서 ↔ 역할(2026-10-19 01:02 기준 `.claude/agents/` 10개, 부서 7개):
- 기획실 feature-planner · 디자인실 ui-designer · 데이터실 db-schema · 개발실 developer(구현서 🧑‍💻, 신규) · 품질실 qa-checker, debugger · 검사실 field-deploy-check, sql-review, kakao-pc-rules · 운영실 ops-monitor(감시연 📡, 신규).
- 이름·부서·캐릭터의 **원본은 역할 파일 8번째 줄** `이름 X · 부서 Y실 · 캐릭터 Z` (developer.md:8, ops-monitor.md:8 에 이미 있음. 나머지 8개 파일은 아직 없음 → 같은 형식으로 한 줄씩 추가해야 카드와 맞출 수 있다).
- `agentTeam.ts` 는 손으로 쓰되, 테스트가 역할 파일의 그 줄을 읽어 name/dept/emoji 가 같은지 검사한다(어긋나면 빌드 막힘). 빌드 때 자동 생성(gen-patch-notes.mjs 방식)은 스크립트 하나가 더 늘어 이번엔 안 한다.
- 팀장 Claude Code 는 역할 파일이 없으므로 `AGENT_LEADER` 에만 둔다(규칙 출처 CLAUDE.md).

## 4. 화면 흐름
1. 홈 스크롤 → ⑤ 모듈 그리드 아래 새 섹션 "AI Agent Team".
2. 머리: 팀장 캐릭터(이모지·이름·한 줄) + 작동 흐름 한 줄(기획 → 디자인/DB → 구현 → QA → 배포 검사).
3. 부서 단추 7개(`grid-cols-2 sm:grid-cols-4 lg:grid-cols-7`, min-h-11). 처음엔 "기획" 열림.
4. 단추를 누르면 그 부서 역할들이 아래 인라인으로 펼쳐진다(이모지·이름·한 줄 설명·"언제 불리나"). 온보딩 ⑦과 같은 방식.
5. 다시 누르면 접힘. 모달·새 탭 없음.

## 5. 작업 분해 (서로 겹치지 않게)
| 역할 | 할 일 | 건드릴 파일 |
|---|---|---|
| ui-designer | 카드 컴포넌트. `card`/`eyebrow` 상수 자기 파일에 재선언, 섹션 틀 동일, 390px에서 단추 2열·내용 1열. 빈 상태 불필요(정적)이나 역할 0개 부서는 "준비 중" 한 줄 | `src/AgentTeamCard.tsx` (신규) |
| db-schema | **없음** (DB·SQL 없음) | — |
| 구현 | 데이터 파일 + 무결성 테스트 + 홈 진입점 2줄 | `src/agentTeam.ts`(신규), `src/agentTeam.test.ts`(신규), `src/Home.tsx` import 1줄(34 부근) + `<AgentTeamCard />` 1줄(477과 480 사이) |
| qa-checker | `npm run build`·`npm test`, Home 수정이 2줄인지, Home-*.js 크기 전후 비교(현재 143,501B), 390px 레이아웃, 역할 key가 `.claude/agents/*.md` 와 일치 | 읽기만 |

테스트(`src/agentTeam.test.ts`, vitest): ① 부서 7개·key 중복 없음 ② 모든 역할 name/emoji/desc 비어 있지 않음 ③ 역할 key 마다 `.claude/agents/<key>.md` 가 있고, 반대로 `.claude/agents/*.md` 전부가 카드에 있음(fs.readdirSync) ④ 역할 파일에 `이름 … · 부서 … · 캐릭터 …` 줄이 있으면 카드의 name/dept/emoji 와 일치. prebuild가 vitest를 돌리므로(package.json scripts) 역할 파일을 추가하고 카드에 안 넣으면 빌드가 막는다.

## 6. 위험·열린 질문 (사용자에게 한 번에)
1. **운영실에 ops-monitor 외에** 자동화(어사이드 10시 카운터 정리, 노트북 실행기, 메신저봇R)도 "도구"로 같이 보여줄지, 아니면 AI 역할만 보여줄지.
2. **debugger 소속**: 품질실(qa-checker와 같이) vs 개발실. 또 나머지 8개 역할 파일에 `이름 · 부서 · 캐릭터` 줄을 누가 넣을지(이름·이모지는 사용자 확정 필요).
3. **팀장 표기**: "Claude Code" 그대로 vs 한글 별명. 역할별 이모지·캐릭터 이름은 사용자가 정해 주면 데이터 파일에만 반영.
4. **위치**: 추천은 ⑤ 모듈 그리드 뒤(안내성 카드끼리 모임). 대표 노출이 목적이면 관제 덱 바로 아래(376 앞)도 가능하나 운영 지표가 밀린다.
5. 역할 파일 본문(.claude/agents/*.md)을 직원이 읽게 할지 — 번들에 안 들어가므로 보여주려면 public/ 복사 또는 `?raw` import 가 필요. 이번 범위에서는 한 줄 설명만.
6. 청크: Home-*.js 143KB 중 patchNotes.ts 70KB가 큰 몫(빌드마다 git log로 자라남). 이 카드는 데이터 ~3KB + 컴포넌트 ~4KB 로 10KB 미만 증가 → **lazy 분할 안 함**(Home 안에 lazy 패턴이 없고 정적 텍스트). 전체 조직도 창을 크게 만들게 되면 그 창만 lazy.

## 7. 하지 않을 것
- Supabase 표·RLS·엣지 함수, 에이전트 실행 상태(실시간) 표시.
- 새 탭/라우트, `src/App.tsx` 수정, HelpCenter GUIDES 추가, 사이드바.
- patchNotes 정리·Home 청크 다이어트, 다른 홈 카드 "김에 정리".
- `.claude/agents/*.md` 본문 노출·편집 기능.
