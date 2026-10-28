# 통합검색 "무엇이든 묻기" — 설계안 (2026-10-29)

작성: 기획실 한설계(feature-planner, opus). 조사·설계만, 코드 0, SQL 0.
사용자 원문(2026-10-29): "통합검색은 못하는 게 없도록 만들어. 예를 들어 '이민구 OKR 작성 잘 되었는지, 어느 부분이 잘되고 안 되었는지 분석해줘' 이런 것도 가능해야 해. 모든 부분이 가능해야 해. 섬세하게 파악해."

실측 방법: 이 세션에는 Supabase MCP 도구가 연결되지 않아, **앱과 같은 anon 키로 읽기 전용 REST HEAD(count=exact)·1행 조회**로 표 89개의 행 수·칸을 쟀다(2026-10-29 새벽). anon 에 안 보이는 표(401)는 "anon 0"으로 적었다. 쓰기 0.

---

## 1. 목표와 쓰는 사람

**한 줄 목표**: 조회 › 통합검색 입력칸 하나에 무엇을 물어도(업체·사람·팀·기간·OKR·KPI·일정·사진·미수 방문·IT 시트·운영 상태·앱 사용법) 회사 데이터에서 근거를 찾아 **숫자는 화면과 같은 규칙으로 세고**, 분석형 질문에는 "잘된 점 / 부족한 점 / 근거 행"으로 답한다.

**쓰는 사람**: 팀장·파트장(PC, 팀·사람 분석, OKR·KPI 원인 찾기) > CS 기사(폰, 업체·일정·방법 질문) > 관리·지원 부서(PC, 접수·미수). 고객은 쓰지 않는다.

**지금 실측(ai_usage 최근 기록)**: data-ask 26건 — 비용 중앙값 $0.09 · p90 $0.38 · 최대 $1.02, 시간 중앙값 18초 · p90 53초, 왕복 중앙값 3 · 최대 7(상한 9). entity-ask 3건 중앙값 $0.05. 모델 = `OPENAI_ASK_MODEL` 없으면 `OPENAI_REPORT_MODEL` 없으면 `gpt-5.5`(실측 기록 전부 gpt-5.5), reasoning effort medium.

**지금 "이민구 OKR 분석해줘"를 치면**: Search360 `submit` → DATA_RE 에 OKR·사람 이름 단서가 없어 먼저 `askEntity`(업체 찾기)를 돌고 → 못 찾으면 data-ask → CATALOG 에 okr_* 표가 없어 "기록에 없습니다". 즉 **경로와 재료 둘 다 없다.**

---

## 2. 기존 코드 재사용·확장 지점

| 무엇 | 파일:함수 | 이번에 |
|---|---|---|
| 전체 질문 에이전트 | supabase/functions/data-ask/index.ts — `CATALOG`(23표), `queryRows`, `vendorTeam`, `teamMembers`, `appGuide`, 왕복 루프(최대 9) | CATALOG·도구를 `_shared/ask/` 로 빼서 키우고, 루프에 비용·시간 상한, "분석 모드" |
| 업체 질문 에이전트 | supabase/functions/entity-ask/index.ts (앱이 모은 events 만 근거, 도구 없음) | 그대로 둔다(업체 하나는 이 경로가 가장 정확·저렴) |
| 업체 기록 모으기 | src/entity360.ts `gather`·`resolveCandidates`·`isStrongCandidate`·`entityTokensFromQuestion` | 라우터가 그대로 씀 |
| 라우팅 | src/Search360.tsx `submit`·`askEntity`·`askData`, `QUESTION_RE`·`DATA_RE` | 순수 함수 `src/askRoute.ts` 로 빼고 사람·OKR·KPI 단서 추가 |
| 주민번호 가림 | supabase/functions/_shared/privacy.ts `maskDeep`·`maskRrn` (**주민번호만** 가림 — 전화·계좌는 안 가림) | 4장: `maskKakaoText` 와 합친 `askMask` |
| 전화·계좌·카드 가림 | supabase/functions/_shared/kakao-parse.ts `maskKakaoText`(주민·카드·계좌·휴대폰 가운데 4자리), src/receptionSheetState.ts `maskPhones` | data-ask 출력 전체에 재사용 |
| OKR 규칙 | src/okr.ts `normalizeJudgment`·`JUDGMENT_INFO`·`achievementRate`·`worstJudgment`·`needsReasonPlan`·`goalAppliesTo`·`goalsApplyingTo`·`monthScreenGoals`·`goalsForTeamTotal`·`isLegacyMonthId` / src/kpi/kpiCompute.ts `okrWeekMemberRows`·`okrMemberShares`·`okrShareAverage`·`okrWeekResult`·`okrTeamMembers` | 순수 부분만 `_shared/ask/okr-rules.ts` 로 옮기고 src/okr.ts·kpiCompute.ts 는 다시 내보냄(counter-sms 와 같은 방식). okr.ts 는 `./supabase` 를 import 하므로 통째 이전 불가 |
| KPI 계산 | src/kpi/kpiData.ts `loadKpiBundle` → kpiCompute `kpiCount`·`kpiProgress`, src/kpi/homeKpiSnapshot.ts(계산된 위젯 값 localStorage `home_kpi_snapshot_v3`, 약 25KB) | **서버로 옮기지 않는다**(visits.ts·formCount 등이 supabase 래퍼·외부 시트에 묶임). 앱이 계산해 "꾸러미"로 넘긴다(5장) |
| KPI 정의 글 | src/kpi/kpiDefs.ts `KPI_DEFS`(basis·source 설명), `KPI_PENDING` | 빌드 스크립트로 JSON 을 만들어 모델에 정의 설명으로 준다 |
| IT 시트 | src/itSheet.ts(import 없음 — 순수) `IT_TABS` gid·`parseCsv`·`valueByPrefix` | `_shared/ask/it-sheet.ts` 로 옮기고 src 는 재수출. 엣지가 공개 CSV 를 **그때그때 읽기만**(저장 안 함) |
| 카톡 원문 | supabase/functions/kakao-search(스위치 `KAKAO_SEARCH_ENABLED`, 검색어 필수, 200줄) | data-ask 도구가 이 함수를 그대로 부른다(같은 제한·기록) |
| 앱 사용법 | _shared/app-guide.json + app-guide-extra.ts, tools/build-app-guide.mjs | 그대로 + 이번 기능 설명 추가 |
| 비용 기록 | _shared/ai-usage.ts `addUsage`·`priceUsage`·`logUsage` | 그대로, fn 이름에 모드 붙임(`data-ask:analysis`) — 표 변경 없음 |

---

## 3. 실측 표 분류 (public 89개 확인, 2026-10-29)

표기: 행 수(anon 기준) · (a) 이미 CATALOG · (b) 넣어야 함 · (b*) 도구로만(행을 직접 주지 않고 요약) · (c) 넣으면 안 됨 · (d) 비어 있음 — 채워지면 (b)

### 3-1. (a) 이미 CATALOG — 23개 (+ cs_members 는 team_members 도구)
knowledge_docs 450 · copier_playbook 145 · copier_notes 13,430 · vendor_notes 76 · supply_requests 2,229 · misu 8,299 · overage 3,334 · overage_adjust 3 · recontract 1,200 · bulman 1,714 · jeomgeom 24,260 · as_records 14,636 · service_receptions 1,171 · as_tickets 1,890 · visit_logs 3,448 · contact_changes 1,497 · vendor_info 23,288 · lease_status 28,933 · pc_expansion 1,335 · mfp_expansion 1,171 · counter_sms_targets 113 · workin_map_places 7,895 · logistics_records 92 · (cs_members 59)

같이 고칠 점:
- **misu.휴대폰번호**, vendor_info.일반전화·키맨 이 그대로 모델과 앱 표에 간다(maskDeep 은 주민번호만 가림). → 4장 askMask.
- as_tickets 의 `note`(처리 블록 — 일정리스트 간단처리 AS 의 유일한 기록)·`calendarTitle` 이 CATALOG 에 없다 → 추가. `vendor_code` 는 주민번호 가능 칸이라 넣지 않음.
- jeomgeom.지역 거의 'A'(10-19 감사) — desc 에 "팀은 작성자의 명단 팀(cs_members) 우선" 규칙(KPI 와 같은 기준).

### 3-2. (b) 넣어야 함 — 행 조회 허용(칸 화이트리스트)
| 표 | 행 | 쓰는 질문 | 넣을 칸·주의 |
|---|---|---|---|
| okr_cycles | 15 | OKR 목표·달성기준·팀장 피드백 | id·kind·title·year·month·week_no·start/end_date·parent_id·direction·goals_origin·goals(no·pillar·bottleneck·objective·criteria·scope, html 제외)·feedback(memo·judgment, memoHtml 제외). JSON 이라 주로 okr 도구가 읽음 |
| okr_reports | 79 | 사람·파트 OKR 기록 | cycle_id·team·member·header(leader·author·submitted·goals)·rows(no·actual·judgment·reason·plan·evidence, **html 제외** — 이민구 한 주 7.6KB→3.4KB)·updated_at |
| reception_sheet_rows | 2,493 | 시트에만 적힌 접수·미처리 | source(sales/mgmt/remote/copier)·month·seq·kind·receipt_date·author·handler·state·cls(open/hold/done/record)·vendor·field·region·summary·reception_id·first/last_seen_at·gone_at. raw·content 는 길이 제한, 가림 재적용 |
| team_calendar_events | 6 | 팀 캘린더(회식·교육·휴무) | team·date·time·title·memo·author. **팀 전용 화면**이라 묻는 사람 팀만(Q1) |
| misu_visits | 1(anon) | 미수 방문이력 | visited_at·visit_round·author·author_team·vendor·region·misu_months·misu_balance·open_status·dun_methods·dun_reply·promise_date·return_requested·judgment·judgment_reason·missing·text_body(가림). **rep_phone·contact_name·photos 제외** |
| misu_cs_checks | 203 | 미수 CS 체크 | team·vendor·checked·cs_manager·cs1·cs2·synced_at |
| activity_events | 3,648 | 물류·교체 원본(K24·K28), 사람 활동 | activity_date·author·team·category·vendor·quantity·machine_count·status. source_text 200자·가림 |
| photo_albums | 3,330 | "○○ 사진 있어?", 사진 올린 사람 | vendor·category·author·region·source_type·created_at·장수(urls 길이). **urls 원본은 주지 않고** 앨범 id → 앱 뷰어 |
| plan_memos | 56 | 일정 메모·내 일정 순서 | author·ticket_id·memo. `__order__:날짜` 행 = 내 일정 고정 순서(MyPlan.tsx) |
| weekly_notes | 12 | 사람 분석(주간 회고·목표·병목) | author·week_start·this_week_goal·this_week_result·next_week_goal·bottlenecks·learning·growth·challenge (Q1) |
| quarterly_plans / golden_cards / self_goals | 4 / 6 / 0 | 분기 계획·골든카드 | author·year·quarter·goals/answers (Q1) |
| praise_posts | 0(anon) | K30·K31 칭찬 | to_name·from_author·created_at·본문 |
| it_quiz_attempts / it_practice_logs | 1 / 0 | K34·K21 | author·kst_date·level·score / title·memo |
| stock_items | 355 | 재고("X3220 드럼 몇 개") | kind·brand·name·condition·qty·unit·category·models·note, _hidden 제외 |
| kakao_collect_rooms / room_map | 24 / 30 | "어느 방으로 가?" | 방 이름·종류·지역(발송 매핑) |
| kakao_delivery_log | 629 | "오늘 C팀 방에 뭐 나갔어" | sent_at·sender·room·kind·vendor (본문 없음) |
| message_jobs / happycall_messages | 2,358 / 3 | 해피콜·예약 문자 발송 여부 | source_type·channel·status·scheduled_at·sent_at·error. recipient·message 는 가림·120자 |
| notices / food_places / promo_materials / message_templates / copier_learning_posts / reading_posts / feedback_items | 1 / 95 / 4 / 11 / 0 / 2 / 3 | 공지·맛집·홍보물·문구 틀·게시판 | 제목·본문 요약 위주, food_places.tel 가림 |
| counter_sms_contact_rules | 12 | 연락금지·연락처 규칙 | vendor·kind·name·memo — **phone 제외** |
| report_recipients / report_send_log | 3 / 2 | 리포트 받는 사람·보낸 기록 | vendor·name·active / 보낸 날짜 — phone 가림 |
| supply_events | 2 | 부품 단계 이력 | 그대로 |

### 3-3. (b*) 도구로만 — 행을 직접 주지 않고 요약·해석
- vendor_master 5,704 · vendor_match_alias 13,242 · vendor_alias_key 9,778 · lease_ident_code 17,602 · workin_vendor_code 3,571 → `vendor_lookup` 도구(업체 이름·코드 풀기). 코드 칸에 주민번호가 섞여 행 그대로는 안 준다.
- worker_heartbeat 1 · room_activity 42 · kakao_delivery_log · outbox(anon 0 보임) · field_sheet_sync_jobs 1,993(실패 건수만) → `ops_status` 도구(심박 몇 분 전·방별 마지막 배달·대기 건수·실패 건수). 원문 없음.
- ai_usage 207 → `ops_status` 안에서 "이번 달 AI 비용 합계·건수"만. 질문 원문·작성자는 안 줌(남의 질문 노출).
- photo_assets 27,351 → 앨범 장수 세기만.
- kakao_messages(anon 0, 아직 0행) → `kakao_search` 도구 = 기존 엣지 kakao-search 호출(스위치 꺼지면 "꺼져 있음"으로 답).
- field_sheet_sync_jobs category praise → K32 "고객 칭찬 접수" 건수만(KPI 꾸러미로 들어옴).

### 3-4. (c) 넣으면 안 됨 — 이유
| 표 | 이유 |
|---|---|
| app_config 24 | `KAKAO_BOOK_KEY`·`NAVER_*`·`PHOTO_DRIVE_FOLDER` 같은 설정·키값. 스위치 상태는 ops_status 가 이름을 정해 둔 몇 개만 true/false 로 |
| app_config_lock · app_config_log(anon 0, client_ip) | 운영 보안 기록 |
| naver_oauth(anon 0) | OAuth 토큰 |
| push_subscriptions 9 | 푸시 구독 키(10-19 감사에서 공개 읽기 문제로 지적) |
| worker_jobs · worker_heartbeat 원문 | 노트북 내부 큐·명령. 요약만(b*) |
| outbox | 발송 대기 원문(전화번호·고객 글), 곧 지워지는 임시 표 |
| counter_sms_batches 13 · counter_sms_inbox 20 원문 | 관리부 목록·문자 원문(전화번호 다수). 결과는 counter_sms_targets 로 이미 봄 |
| kakao_import_log · mirror_hidden(anon 0) · field_sheet_sync_jobs 원문 | 기술 로그·동기화 큐(원문에 전화번호) |
| _backup_* 4개 · okr_*_bak_20261020 | 백업 사본 — 중복·옛 값으로 숫자가 틀어짐 |
| ops 스키마(edge_calls·cron_command_backup) · cron.* | 비노출 스키마, vault JWT 경로 |
| kakao_messages 직접 조회 | anon 0 이 설계 의도 — kakao-search 경유만 |

### 3-5. (d) 비어 있음(0행) — 칸만 등록해 두고 채워지면 자동으로
churn_defense · mgmt_support · dept_requests · office_logs · self_goals · praise_posts · copier_learning_posts · copier_quiz_results · reading_comments · it_practice_logs. (copier_expansion·site_company·records_all 은 라이브 404 — 없음)

### 3-6. 화면에서 계산만 하는 값 — 어디서 나오나
| 값 | 원본 표 | 계산 함수 | 질문 경로 |
|---|---|---|---|
| K1 점검(대)·K3 AS(건) | jeomgeom·as_records(+일정 완료) | workCount.countField | 꾸러미(규칙: 같은 날 1건·팀=명단 팀) |
| K2 분기 점검 진행·워킨맵 페이스 | workin_map_places + cs_members | workinProgress.teamWorkinProgress·kpiCompute.workinPace | 꾸러미 |
| K35 재계약 진행 | workin_map_places(kind renewal, G5 완료·G6 진행·G7 제외) | workinProgress.renewalProgress | 꾸러미 + 도구 T6(행) |
| K24 물류 · K28 교체 | logistics_records + 점검·AS 세팅 + activity_events | kpiCompute.isMainLogistics·countableEvents | 꾸러미 |
| K4 방문 업체 | visit_logs | visits.getTeamVisits | 꾸러미 |
| K33 오버홀 | **외부 시트**(app_config OVERHAUL_SHEET_TAB) | overhaulSheet.countOverhaul | 꾸러미만 |
| K7·K8 확장성 | pc_expansion·mfp_expansion | workCount.countExpansion | 꾸러미 |
| K10·K11 초과 제안 | overage_adjust | kpiCompute.countOverageVisits·overageCompleteness | 꾸러미 |
| K25·K12·K13 재계약 | recontract | kpiCompute.recontractOverdue·recontractRenewal | 꾸러미 |
| K14 미수 방문 | misu + misu_visits | misuVisit.effectiveMisuVisits·formCount | 꾸러미 + T7(행) |
| K26·K15 불만 | bulman | kpiCompute.complaintCompletion | 꾸러미 |
| K27 담당자 변경·K18 키맨 인사 | contact_changes(greeting_done) | formCount / kpiCompute.keymanKpi | 꾸러미 |
| K16·K17 미처리(접수·지난 일정) | service_receptions + reception_sheet_rows/시트 + as_tickets | homeUnhandled.mergeUnhandled·countUnhandledTabs | 꾸러미 + T8(행 목록) |
| K29 접수 처리율 | service_receptions | deptReception.weekCompletionRate | 꾸러미 |
| **K19 OKR 달성률** | okr_reports(주차 개인 행) + cs_members | kpiCompute.okrMemberShares·okrShareAverage — 개인 = 판정 있는 목표 중 완료·해당없음 비율, **판정 0 = 미작성 = 0%**, 팀 = 팀원 평균, 전체 = A~D 전원 평균, 아무도 판정 없으면 null(0% 아님). 8·9월(옛 달)은 파트 종합 판정 비율 | **서버 도구 T1·T2**(규칙을 _shared 로 옮김) |
| K20 블로그 | **외부 시트** | blogSheet.countBlog | 꾸러미만 |
| K21 IT 실습 · K34 IT 퀴즈 | it_practice_logs + weekly_notes 배운 점 / it_quiz_attempts | itLogs·learningLines | 꾸러미 |
| K30·K31 칭찬 · K32 고객 칭찬 | praise_posts / field_sheet_sync_jobs(praise) | kpiCount | 꾸러미 |
| 팀 보드(팀 카드 5장)·순위 | 위 전부 | kpi/teamBoard.teamBoardView | 꾸러미(homeKpiSnapshot 에 이미 계산값) |
| 목표값 | app_config KPI 목표 키(kpiDefs KPI_TARGETS_CONFIG_KEY) | kpiCompute.kpiTargetFor | 꾸러미 |
| 미정 지표 K5·K6·K9·K22·K23 | — | kpiDefs KPI_PENDING(사유 있음) | "아직 셈법 없음"으로 답(T15) |

**결론**: OKR 은 규칙이 작고(판정 5종·평균) 글 분석이 핵심이라 **서버 도구**로. 나머지 KPI·팀 보드 숫자는 앱이 이미 계산하는 값을 **꾸러미(packs.kpi)로 넘겨** 화면 숫자와 답 숫자가 어긋나지 않게 한다(visits.ts 등이 supabase 래퍼·외부 시트에 묶여 Deno 로 옮기면 두 벌 관리가 된다).

---

## 4. 안전

1. **읽기 전용 유지**: 모든 도구는 anon 키 REST GET 만(지금과 같음). service role 은 ai_usage 기록과 kakao-search 경유뿐. 새 도구도 insert/update/쓰기 rpc 없음. 읽기 RPC(`suggest_workin_candidates` 등)는 이름 화이트리스트로만.
2. **가림 한 곳으로**: `_shared/ask/mask.ts` `askMask(value, key)` = privacy.maskRrnValue(칸 문맥) → kakao-parse.maskKakaoText(카드·계좌·휴대폰 가운데 4자리). 모델에게 가는 도구 결과·앱으로 돌려주는 rows·answer 세 곳 모두. 전화 칸(휴대폰번호·rep_phone·phone·tel·일반전화)은 기본 가림 — 원번호는 업체 검색 카드(기존 화면)에서 본다(Q2).
3. **빼는 것**: 3-4 표, 칸 중 html·memoHtml·urls·raw 원문·storage_path·client_ip·token·key 이름 칸. CATALOG 테스트가 금지 표·칸이 없는지 검사.
4. **상한**:

| | 지금 | 제안 |
|---|---|---|
| 왕복 | 9 | 일반 9 / 분석 모드 16 |
| 한 도구 결과 | 60,000자 | 그대로, 표 행 300(long 40) |
| 한 질문 비용 | 없음 | `ASK_MAX_USD`(기본 1.5) 넘으면 도구 중단 → 그때까지로 답 + "범위를 좁혀 주세요" |
| 한 질문 시간 | 앱 180초 | 엣지 140초에서 마무리 왕복 강제, 앱 대기 240초 |
| 하루 총액 | 없음 | `ASK_DAILY_USD`(기본 20) — ai_usage 오늘 합계 넘으면 분석 모드 거절(일반 질문은 허용) |

5. **비용 추정($/질문)**: 단순 조회 $0.05~0.15(지금 중앙값 0.09). 분석형(OKR 한 사람 한 달 = T1 1회 약 6k 토큰 + 근거) $0.15~0.5. 팀 비교·원인 분석(도구 4~8회) $0.4~1.2. `tally` 도구(행 대신 건수만)로 행 300개를 넘기던 질문의 입력 토큰을 크게 줄여 p90 을 지금 $0.38 근처로 묶는 것이 목표.
6. **모델**: 지금 gpt-5.5 / effort medium 그대로. 분석 모드만 `OPENAI_ASK_ANALYSIS_EFFORT`(기본 medium, high 는 실측 뒤 결정). 단가는 app_config AI_PRICE_* 로 이미 표시됨.
7. **누가 물었나**: author 는 기기에서 고른 이름(서버 검증 없음, SSO 2단계 RLS 미착수). "본인만" 자료(Q1)는 서버가 author 로 거르는 수준이며 완전한 권한 통제가 아님을 매뉴얼에 적는다.

---

## 5. 분석형 질문 설계

### 5-1. 원칙
- **세는 것은 도구가, 읽고 판단하는 것은 모델이.** 모델이 300행을 받아 세면 틀리고 비싸다 → 서버 도구가 화면과 같은 규칙으로 센 숫자 + 판단에 필요한 원문 조각만 준다.
- **화면 숫자와 같아야 한다.** KPI 는 앱 계산값 꾸러미, OKR 은 src 와 같은 코드(_shared 공용)로.
- **분석 답 형식(지시문에 고정)**: ① 결론 한 줄(숫자·기간·기준) ② 잘된 점 2~4개 ③ 부족한 점 2~4개(각각 어떤 규칙에 어긋났는지) ④ 근거 — "· [2026-10-W3 · 목표 5 · 부분달성] 실제결과 '…' — 사유 칸 비어 있음" 꼴, 최대 12줄 ⑤ 다음에 할 일 1~3개 ⑥ 계산 기준·빠졌을 수 있는 것 한 줄. 사람 질문은 기록 사실로만, 인상 평가·서열 표현 금지.

### 5-2. OKR 을 모델이 이해하도록 — 지시문·desc 에 넣을 구조 설명
- 3층: 분기(okr_cycles kind quarter, id `2026-Q4`, 9목표 = Pillar 3 × 병목 3, 팀장 문서) → 월(kind month, id `2026-10`, parent_id 분기, direction = 팀장 핵심방향, goals_origin leader/copy/import/manual) → 주차(kind week, id `2026-10-W3`, 그 주 월요일이 든 달·월~금, goals 는 비어 있고 월/분기 목표를 씀).
- 기록: okr_reports(cycle_id × team × member). member '' = 파트 종합, member '이름' = 팀원 개인. rows[] = 목표 번호(no)별 actual(실제결과)·judgment(종합판정)·reason(사유)·plan(개선계획)·evidence(근거자료). header.goals = 파트/개인이 쪼갠 달성기준, header.feedback = 파트장 피드백. 팀장 피드백 = okr_cycles.feedback[no].memo·judgment.
- 판정 5종과 작성 규칙(작성가이드 6번, okr.ts JUDGMENT_INFO): 완료(100%, 숫자만) · 해당없음(대상 0건, 근거에 '대상 0건') · 부분달성(80~99%, 숫자+사유) · 미흡(1~79%, 숫자+사유+개선계획) · 미착수(0%, 사유). '미달성'→미흡, '달성'→완료로 읽음.
- 달성률: 개인 = 판정 있는 목표 중 완료·해당없음 비율, 그 기간 판정 0 = **미작성 = 0%**. 팀 = 팀원(명단 ∪ 보고자, 팀장 제외) 평균. 전체 = A~D 전원 평균. 아무도 판정이 없으면 "미작성"(0%로 그리지 않음). 8·9월은 옛 구조(파트 종합 판정 비율). E(CSS)팀은 OKR 대상 아님.
- 주차 단계: 계획→진행→점검→마무리 — 월 종합 판정 제안은 **마지막 기록 주차** 기준(평균 아님, 팀장 결정).
- 실측 예(이민구, C팀): 10월 W1~W4 개인 기록 있음, W4 는 목표 10행 중 4번 판정 빈칸 → "그 주 미작성 목표"로 짚어야 정답.

### 5-3. 새 도구 목록(서버, `_shared/ask/*`)
| # | 도구(인자) | 돌려주는 것 | 읽는 표 | 대표 질문 |
|---|---|---|---|---|
| T1 | `okr_member_report(person, period)` period = `2026-10`·`2026-10-W3`·`2026-Q4` | 주차별 작성 여부(제출 주/빠진 주), 목표별(번호·Pillar·병목·목표·달성기준) 주차 판정 흐름, **작성 품질 검사**(아래), 개인 달성률·팀 평균·전체 평균(숫자만), 파트장·팀장 피드백 원문, 근거 원문(actual/reason/plan/evidence 각 300자, html 제외) | okr_cycles·okr_reports·cs_members | "이민구 OKR 작성 잘 됐나, 어디가 잘/안 됐나" |
| T2 | `okr_team_report(team, period)` | 팀원별 달성률·미작성 주·판정 분포, 파트 종합 vs 팀원 판정 불일치, 조치 필요 목표(미흡·미착수 — actionTeams/actionMembers 규칙) | 같음 | "C팀 10월 OKR 어디가 약해?" |
| T3 | `tally(table, filters, group_by[], distinct?, date_bucket?)` | 행 대신 묶음별 건수(+업체 중복 제거 수). 서버가 1,000행씩 최대 20,000행 넘겨 읽어 셈 | CATALOG 표 전부 | "팀별 이번 달 AS 건수", "작성자별 불만 처리" |
| T4 | `person_activity(person, from, to)` | 표별 건수(점검·AS·방문·접수 작성/처리·부품·확장성·미수·재계약·불만·물류·OKR·사진), 요일·시간대 분포, 업체 상위 10, 같은 기간 팀 평균 | 위 표들(표별 작성자 칸 매핑 하나로) | "지경민 접수 처리 패턴", "박영현 이번 달 뭐 했어" |
| T5 | `inspection_gap(team, period)` | 워킨맵 대상(kind quarter/monthly) 중 기간 안 점검 기록(jeomgeom·일정 매월점검 완료·visit_logs inspection) 없는 업체 + 마지막 점검일 | workin_map_places·jeomgeom·as_tickets·visit_logs | "C팀 이번 달 점검 누락 업체" |
| T6 | `recontract_progress(team?, quarter)` | 팀별 재계약 대상(워킨맵 renewal)·G5/G6/G7 수·recontract 마지막 상태·갱신위험도·진행상황 글 묶음(낮은 팀의 공통 사유 재료) | workin_map_places·recontract | "재계약 진행률 낮은 팀 원인" |
| T7 | `misu_followup(min_months, team?, since?)` | 미수 N개월↑ 업체(최신 행) × 미수 방문이력·visit_logs·misu_cs_checks — 방문 안 한 곳·약속일 지난 곳 | misu·misu_visits·visit_logs·misu_cs_checks (+vendor_team) | "미수 3개월 이상 중 방문 안 한 곳" |
| T8 | `unhandled_now(team?, room?, kind?)` | 미처리 목록(앱 접수 미완료 + 시트 cls open/hold + 지난 일정 미처리), 접수 종류 → room_map 방 이름으로 묶음, 경과일 | service_receptions·reception_sheet_rows·as_tickets·room_map | "카톡방별 오늘 미처리" |
| T9 | `schedule_view(person?, team?, from, to)` | 일정(as_tickets)·팀 캘린더(Q1 범위)·일정 메모·내 일정 고정 순서(plan_memos `__order__:날짜`)·자동 일정 후보(읽기 RPC suggest_workin_candidates) | as_tickets·team_calendar_events·plan_memos | "내일 이민구 일정 순서", "C팀 이번 주 휴무" |
| T10 | `vendor_lookup(name)` | 업체 코드·별칭·임대 코드·담당 팀·표별 최근 기록 수(한 업체 깊은 질문이면 "업체 질문으로 다시" 신호) | vendor_master·vendor_match_alias·lease_ident_code·workin_vendor_code | 섞인 질문("C팀 중 잡플러스 …") |
| T11 | `photo_summary(vendor?, author?, category?, from?, to?)` | 앨범 수·장수·분류·최근 앨범 id(앱 링크) | photo_albums·photo_assets(세기만) | "무암 사진 있어?", "이번 주 사진 안 올린 기사" |
| T12 | `it_sheet(tab, q, limit)` tab = knowledge/history/sales/links | IT파트 공개 시트 CSV 를 그때 읽어 낱말 일치 행(최대 40) — **저장·복사 없음**, 비공개면 "IT 시트가 비공개" | 외부 구글 시트(gid 표 src/itSheet.ts) | "PC 부팅 안 될 때 IT 처리이력" |
| T13 | `kakao_search(q, room?, from?, to?)` | 기존 엣지 kakao-search 결과(가린 글) — 스위치 꺼지면 enabled:false | kakao_messages(경유) | "C팀 방에서 잡플러스 얘기" |
| T14 | `ops_status()` | 노트북 심박 n분 전·카톡 방별 마지막 배달·outbox 대기·동기화 실패 건수·이번 달 AI 비용 합계·주요 스위치 on/off | worker_heartbeat·room_activity·kakao_delivery_log·outbox(count)·field_sheet_sync_jobs(count)·ai_usage(sum)·app_config(이름 정한 스위치만) | "카톡 잘 가고 있어?", "노트북 살아있어?" |
| T15 | `kpi_explain(kpi?)` | KPI 정의(무엇을 어떻게 세는지 — kpiDefs basis·source), 미정 지표 사유 | `_shared/ask/kpi-defs.json`(빌드 산출) | "OKR 달성률 어떻게 계산해?" |
| (앱) | `packs.kpi` — 질문에 KPI·달성·순위·현황·미처리 단서가 있으면 앱이 붙이는 계산값 | 기간(주·월·분기) × 범위(전체·팀·개인) 지표 값·목표·상태(done/onTrack/behind), 팀 카드 5장, 계산 시각 | homeKpiSnapshot(12시간 안) → 없으면 loadKpiBundle | "B팀 KPI 왜 빨강이야", "이번 주 팀 순위" |

**OKR 작성 품질 검사(T1, 순수 함수 `okrWritingChecks`)** — 목표 행마다:
1. 판정 없음(그 주 미작성 목표) 2. 실제결과에 숫자 없음(완료라도 "숫자만 쓰면 끝" 규칙) 3. 부분달성·미흡·미착수인데 사유 빈칸 4. 미흡·미착수인데 개선계획 빈칸 5. 해당없음인데 근거에 '대상 0건' 없음 6. 실제결과 속 %·등급 낱말로 계산한 판정(`worstJudgment(actual)`)과 고른 판정이 다름 7. 근거자료 빈칸 8. 앞 주와 실제결과 같은 문장(복붙) 9. 쪼갠 달성기준(header.goals) 없이 월 기준 그대로. 결과 = {목표 no, 주차, 검사 번호, 원문 조각}.

### 5-4. 같은 방식이 필요한 분석 질문(14)
| # | 질문 예 | 도구 | 핵심 표 |
|---|---|---|---|
| 1 | 이민구 10월 OKR 작성 잘 됐나, 잘된/안된 부분 | T1 | okr_* |
| 2 | C팀 10월 OKR 어느 목표가 약하고 누가 미작성? | T2 | okr_* |
| 3 | C팀 이번 달 점검 누락 업체 | T5 | workin_map_places·jeomgeom·as_tickets·visit_logs |
| 4 | 지경민 접수 처리 패턴(속도·종류·밀린 것) | T4 + T8 | service_receptions·reception_sheet_rows |
| 5 | 재계약 진행률 낮은 팀과 원인 | T6 + packs.kpi(K35·K13) | workin renewal·recontract |
| 6 | 미수 3개월 이상 중 방문 안 한 곳 | T7 | misu·misu_visits·visit_logs |
| 7 | 카톡방별 오늘 미처리 | T8 | service_receptions·reception_sheet_rows·room_map |
| 8 | B팀 KPI 중 빨강인 것과 이유 | packs.kpi + T15 + T3 | 꾸러미 |
| 9 | 지난 일정인데 처리 안 된 것 누구 건? | T8(지난 일정) + T9 | as_tickets |
| 10 | 같은 기기에 드럼 3번 이상 들어간 곳 | T3(group_by serial·item_std) | supply_requests |
| 11 | 불만 많은 업체 중 재계약 앞둔 곳(위험 업체) | T3 + query_rows + vendor_team | bulman·recontract·vendor_info |
| 12 | 박영현 이번 달 활동 요약(현장·영업·OKR·사진) | T4 + T1 + T11 | 여러 표 |
| 13 | 노트북·카톡 발송 지금 괜찮아? | T14 | 운영 요약 |
| 14 | 점검 보고는 많은데 사진 안 올린 기사 | T3(jeomgeom 작성자) + T11 | jeomgeom·photo_albums |

---

## 6. 일정·캘린더·시트 보관·사진·미수 방문·IT 시트 붙이는 방법

| 대상 | 방법 | 주의 |
|---|---|---|
| 일정(as_tickets) | 이미 CATALOG — note·calendarTitle 칸 추가, T9 로 사람·팀 일정 묶음 | 일정 간단처리 AS 는 as_records 에 없고 note 에만 있음(desc 에 명시) |
| 팀 캘린더(team_calendar_events) | CATALOG + T9. **묻는 사람 팀으로 서버에서 거름**(Q1) | 화면이 팀 전용 — 기본은 같은 팀만 |
| 내 일정 순서 | plan_memos `__order__:YYYY-MM-DD` 행을 T9 가 순서로 풀어 as_tickets 와 이음 | 기기 localStorage 에만 있는 순서는 못 봄 |
| 자동 일정 | 읽기 RPC suggest_workin_candidates(화이트리스트) — 경과 9999 = "점검 기록 없음"(autoScheduleCandidate NO_RECORD_DAYS) | (0,0) 좌표는 거리 계산 안 함 |
| 네이버 캘린더 | 범위 밖(외부 API·토큰) | 10장 |
| 시트 보관(reception_sheet_rows) | CATALOG + T8. cls open/hold = 미처리, gone_at 있으면 시트에서 사라진 줄 | raw 는 이미 가린 값이지만 askMask 한 번 더 |
| 사진 | T11. 앨범 단위 요약 + 앱 링크(앨범 id). URL 목록은 모델에 안 줌 | photos 버킷은 공개 URL — 답에 URL 을 늘어놓지 않음 |
| 미수 방문 | CATALOG(가린 칸만) + T7 | rep_phone·contact_name·사진 제외 |
| IT 시트 | T12: 엣지가 src/itSheet.ts 와 같은 공개 CSV 주소(gid)를 fetch(서버라 CORS 무관) → 낱말 일치 행만 → 저장 안 함. 파서는 `_shared/ask/it-sheet.ts`(src/itSheet.ts 순수부 이전·재수출) | memory 규칙 "IT 는 남의 것, 보는 창으로만" 준수 — 복사·캐시 표 없음(엣지 메모리 5분 캐시만). 시트 비공개 시 이 도구만 실패 |
| 오버홀·블로그 외부 시트 | 숫자는 packs.kpi(K33·K20)로만 | 시트 원문 질문은 범위 밖 |

---

## 7. 화면 — "아무거나 물어보면 된다" 라우팅

### 7-1. 라우터 `src/askRoute.ts`(순수, 테스트 대상)
입력 → `{ mode: "search" | "entity" | "data" | "analysis", people[], teams[], packs[], reason }`
1. 문장 아님(QUESTION_RE 불일치 + 3어절 이하) → **search**(지금과 같음).
2. 질문 속 이름이 cs_members(활성) 이름과 일치 → people 에 넣고 **analysis**(업체 찾기 건너뜀 — 사람 이름이 업체 별칭에 붙는 사고 방지).
3. OKR·KPI·달성률·순위·분석·패턴·원인·누락·왜·잘됐·부족 단서 → **analysis**. KPI·현황·순위·빨강·미처리 단서면 packs 에 `kpi`.
4. 팀·기간·등급·전체·지식·사용법 단서(DATA_RE) → **data**.
5. 그 밖에 질문 속 업체가 확실(isStrongCandidate) → **entity**(entity-ask, 지금과 같음). 아니면 **data**.
- data 와 analysis 는 같은 엣지 data-ask 에 `mode` 만 다르게(왕복 상한·지시문 꼬리·비용 상한). 업체 + 분석이 섞이면 analysis 로 가고 모델이 T10 vendor_lookup 을 쓴다.
- 방식 알약(modePill)은 남기되 자동이 기본. 라우트 한 줄(setRouteNote)을 "OKR·사람 분석으로 물었습니다 — 이민구(C)" 처럼 구체적으로.

### 7-2. 화면 흐름(폰·PC 공통)
1. 조회 › 통합검색 입력칸에 문장 입력(예시 칩에 "이민구 10월 OKR 잘된 점·부족한 점", "C팀 이번 달 점검 누락 업체", "카톡방별 오늘 미처리" 추가).
2. 라우트 한 줄 + 진행 표시("OKR 기록 읽는 중 → 팀 평균 비교 중", 도구 이름을 한국어로).
3. KPI 질문이면 앱이 계산값을 붙인다(홈 캐시가 12시간 안이면 즉시, 아니면 "계산 중" 몇 초).
4. 답: 결론 → 잘된 점/부족한 점(분석 모드만 두 칸) → 근거 목록 → 다음 할 일.
5. 근거 표: 지금은 마지막 표 하나(lastTable)만 → **도구별 근거 묶음**(evidence: [{tool, title, rows}])을 탭처럼 고른다. 행을 누르면 해당 화면(OKR 주차·업체 360·앨범)으로.
6. 답 아래 비용·시간(기존) + 상한에 걸렸으면 "여기까지 읽고 답했습니다(조회 n회, $x) — 범위를 좁히면 더 정확".
7. [이어서 묻기]: 앞 답 요약을 다음 질문에 붙임(앱 메모리만, 서버 저장 없음).

---

## 8. 작업 분해(서로 겹치지 않게)

### ui-designer(윤화면, sonnet) — 목업 먼저(디자인은 항상 목업 이미지)
- 아트보드 3장: ① 분석 답 카드(결론·잘된 점·부족한 점·근거·다음 할 일) 폰/PC ② 근거 묶음 탭 ③ 라우트 한 줄·진행 단계·상한 안내.
- 건드릴 파일: 새 `src/AskAnswer.view.tsx`(분석 답 표시 전용, 순수 props). Search360.tsx 는 건드리지 않음(구현 C 가 연결).

### db-schema(표다빈, opus) — SQL 0 목표, 확인만
- 3-2 표들이 anon select 로 실제 다 보이는지(RLS 로 0·1행처럼 보이는 표: misu_visits 1·praise_posts 0·outbox 0) 확인하고 맞는지 판정. 안 보이는 표는 도구에서 빼거나 별도 SQL 설계(이 설계안 밖).
- 읽기 RPC 화이트리스트(suggest_workin_candidates 등)가 쓰기 없음·SECURITY DEFINER 여부 확인.
- tally 부하: jeomgeom 24k·lease_status 29k 를 1,000행씩 읽을 때 statement timeout 위험 조건(`_원문` ilike 등) 목록.
- 건드릴 파일: 없음(보고만). 필요 시 `supabase/ask-indexes-<날짜>.sql` 제안만.

### 구현 — 파일 단위 3명 동시
- **구현 A(엣지 뼈대, opus)**: `supabase/functions/data-ask/index.ts`(루프: mode·왕복 16·ASK_MAX_USD·ASK_DAILY_USD·140초 마무리·evidence 묶음 응답·packs 받기·askMask 일괄), 새 `supabase/functions/_shared/ask/catalog.ts`(CATALOG 이전 + 3-2 표 + desc·OKR 구조 설명), `_shared/ask/mask.ts`, `_shared/ask/tally.ts`, `_shared/ask/rest.ts`(GET·페이지 넘김·읽기 RPC 화이트리스트).
- **구현 B(분석 도구, opus)**: 새 `_shared/ask/okr-rules.ts`(src/okr.ts·kpiCompute 의 순수 OKR 함수 이전 + `okrWritingChecks`) + `src/okr.ts`·`src/kpi/kpiCompute.ts` 는 **재수출 줄만**, 새 `_shared/ask/tools-okr.ts`(T1·T2), `_shared/ask/tools-field.ts`(T4~T11), `_shared/ask/tools-ext.ts`(T12~T15), `_shared/ask/it-sheet.ts`(src/itSheet.ts 순수부 이전, src 재수출), 새 `tools/build-ask-kpi-defs.mjs` → `_shared/ask/kpi-defs.json`.
- **구현 C(앱, sonnet)**: 새 `src/askRoute.ts`, 새 `src/askPacks.ts`(homeKpiSnapshot 읽기 → 없으면 loadKpiBundle·kpiProgress 로 기간×범위 꾸러미, 25KB 이하), `src/Search360.tsx`(submit 을 askRoute 로, data-ask 에 mode·people·packs·이어묻기 요약, 대기 240초, 예시 칩, AskAnswer.view 연결, evidence 탭).
- 겹침 규칙: src/okr.ts·kpiCompute.ts·itSheet.ts 는 **B 만**, Search360.tsx 는 **C 만**, data-ask/index.ts 는 **A 만**. A↔B 경계 = 도구 함수 시그니처 `(args, ctx) => Promise<object>`(ctx = rest·mask·today·asker·mode).
- 순서: 목업(윤화면) ∥ DB 확인(표다빈) ∥ 구현 B → 구현 A(도구 연결) → 구현 C → QA → 배포 검사(엣지 data-ask 재배포 포함).

### qa-checker(검수아, sonnet)
- 새 테스트: `tests/askRoute.test.ts`(이민구·C팀·잡플러스·"X3220 세로줄"·"앱에서 자가 반납" 라우트), `tests/askOkrRules.parity.test.ts`(src 재수출과 _shared 결과 동일 — 기존 OKR/KPI 테스트 그대로 통과), `tests/askOkrWritingChecks.test.ts`(9가지 검사), `tests/askCatalog.test.ts`(3-4 금지 표·html/phone/token 칸 없음, desc 의 칸 이름이 cols 에 있음), `tests/askMask.test.ts`(주민·휴대폰·계좌·카드), `tests/askTally.test.ts`.
- 실데이터 골든 질문 14개(5-4)를 스크래치 스크립트로 1회씩 — 숫자는 홈·OKR 화면 값과 대조, 질문당 비용·시간 기록. 이민구 10월: W1~W4 판정이 OKR 화면과 같은지, W4 목표 4 빈 판정을 짚는지.
- npm run build·npm test 통과, field-deploy-check.
- 매뉴얼: docs/manual/user/09-search360.md(물을 수 있는 것·답 형식·상한), docs/manual/ops/05-edge-functions.md(data-ask 도구·환경변수 ASK_MAX_USD·ASK_DAILY_USD·OPENAI_ASK_ANALYSIS_EFFORT), `_shared/app-guide-extra.ts` 한 단락.

---

## 9. 위험·열린 질문

위험
- R1 **사람 분석의 민감도**: OKR·활동 패턴·주간 회고를 남이 물을 수 있다. author 는 서버 검증이 없어 "본인만" 규칙도 완전하지 않다.
- R2 **숫자 불일치**: 서버 도구가 화면과 다른 규칙으로 세면 신뢰가 무너진다 → KPI 는 꾸러미, OKR 은 공용 코드, 패리티 테스트. 꾸러미 없는 호출은 "화면 값과 다를 수 있음" 표시.
- R3 **비용 폭주**: 분석 모드 16왕복 × 큰 결과. 질문당·하루 상한 + tally 로 막는다. data-ask 는 공개 호출(10-10 감사의 결정 대기 항목)이라 외부 반복 호출 시 OpenAI 비용 발생 → 하루 상한이 유일한 방어.
- R4 엣지 벽시계 한도 → 140초 마무리 왕복.
- R5 IT 시트가 비공개·gid 변경되면 T12 만 실패.
- R6 동명이인·별칭: cs_members 이름과 업체 이름이 겹치면 사람으로 간다("업체 ○○"로 물으면 업체 — 매뉴얼에 적음).
- R7 jeomgeom.지역 대부분 'A' — 팀 집계는 작성자 명단 팀으로(desc·T3 기본값).
- R8 이번 세션은 MCP 미연결이라 RLS 로 가려진 행 수(misu_visits 등)는 실제보다 적게 보였을 수 있다 → 표다빈 확인 항목.

사용자에게 물을 것(한 번에 3개)
- **Q1 사람 분석 공개 범위**: OKR·업무 기록 분석은 누구나 묻게 하고(OKR 화면도 이미 누구나 봄), **주간 회고(weekly_notes)·골든카드·분기 계획·팀 캘린더**는 "묻는 사람 본인 / 같은 팀만"으로 거를까요? (추천: 그렇게. 팀장·파트장은 cs_members 직함으로 팀 전체 허용)
- **Q2 전화번호**: 답·근거 표에서 휴대폰은 가운데 4자리를 기본으로 가리고, 원번호는 업체 검색 카드에서만 보게 할까요? (추천: 가림. 지금 data-ask 는 미수 휴대폰번호를 그대로 돌려줌)
- **Q3 비용 상한**: 분석 질문 1건 최대 $1.5(약 2,000원), 하루 전체 $20 넘으면 분석 질문만 멈추는 기준이 괜찮을까요? (지금 실측 최대 $1.02/건)

---

## 10. 하지 않을 것(범위 밖)
- 쓰기·수정(질문으로 일정 만들기·카톡 보내기·OKR 대신 작성) — 읽기 전용 유지. OKR 문장 다듬기는 기존 okr-assist.
- 새 표·SQL·RLS 변경(필요해지면 표다빈 별도 설계안). ai_usage 칸 추가 안 함(fn 이름으로 모드 구분).
- KPI 계산 로직 서버 이전(꾸러미로 대체). 외부 시트(IT·오버홀·블로그)를 Supabase 로 복사·저장.
- 네이버 캘린더·그룹웨어·이카운트 등 외부 시스템 조회.
- 카톡 원문 수집 켜기(KAKAO_SEARCH_ENABLED·매크로) — 켜지면 T13 이 자동으로 동작.
- entity-ask(업체 하나) 구조·entity360 수집 규칙 변경.
- 음성 질문·대화 기록 서버 저장·질문 공유.

## 결정(2026-10-29 새벽, 사용자 "알아서 해줘 그냥" → 팀장이 추천안 채택)
- Q1: 주간 회고·골든카드·분기 계획·팀 캘린더 = 본인 또는 같은 팀만. OKR·업무 기록은 누구나.
- Q2: 답·근거 표의 휴대폰은 가운데 4자리 기본 가림(askMask = maskRrn + maskKakaoText).
- Q3: ASK_MAX_USD 1.5 / ASK_DAILY_USD 20, 분석 모드 왕복 16, 엣지 140초 안.
- 엣지 배포는 권한 분류기가 막으면 사용자가 `npx supabase functions deploy <이름> --project-ref kkdiihazgzesbqxjytqv --use-api` 한 줄 실행.
