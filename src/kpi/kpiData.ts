/**
 * 홈 KPI 현황판 — 로더(설계안 4-6). 기존 로더를 그대로 부르고, 원본 하나는 한 번만 읽는다.
 *  · 점검·AS = expansionSource.loadFieldRows, 확장성 = loadExpansionRows, 양식(물류·불만·초과조정·담당자 변경) = loadFormRaw, 활동 기록 = operations.getActivityEvents(교체양식만)
 *    → 팀 현황·순위표 입구(loadWorkEvents)와 같은 합성(mergeFieldIntoEvents(mergeExpansionIntoEvents(…)))을 이미 읽은 행으로 만든다(중복 조회 없음)
 *  · 기간은 한 번에: 분기 시작(또는 8주 전) ~ 분기 말 — 금일·주·월·분기 위젯은 메모리에서 거른다
 *  · 숨긴 위젯의 원본은 읽지 않는다(sources 인자)
 *  · 실패는 원본별 상태로(위젯마다 "—"·[다시]) — 하나가 실패해도 나머지는 뜬다. 원본 표가 아직 없으면(misu_visits) "missing" = 준비 중
 * Supabase 접근은 supabase.ts 래퍼만.
 */
import { getConfig, selectAllRows, selectAllRowsFast, selectRows } from "../supabase";
import { kstDate, getTeamVisits, getWeeklyNotes, weekRange } from "../visits";
import { fetchMembers } from "../authors";
import { getActivityEvents, teamForAuthor } from "../operations";
import { loadExpansionRows, loadFieldRows, loadFormRaw } from "../expansionSource";
import { toFormTableRows } from "../formCount";
import { countableEvents, mergeExpansionIntoEvents, mergeFieldIntoEvents } from "../workCount";
import { workinProgressQuery, type WorkinPlaceLite } from "../workinProgress";
import { fetchOpenReceptions } from "../deptReceptionApi";
import { loadSheetOpen, mergeSheetAndDb } from "../receptionSheetOpen";
import { mergeUnhandled, type TicketInput, type UnhandledRow } from "../homeUnhandled";
import { currentWeekOf, getOkrCycle, getOkrReports, getOkrReportsIn, isLegacyMonthId, monthCycleId, monthScreenGoals, quarterIdOfMonth, weekCycleId, weeksOfMonth } from "../okr";
import { loadItPracticeLogs, loadItQuizAttempts } from "../itLogs";
import { combineItPractice, itLearningRowsFromNotes } from "../learningLines";
import { fetchBlogRows } from "../blogSheet";
import { loadMisuVisits, isTableMissingError } from "../misuVisitHistoryData";
import { loadOverhaulRows, overhaulTabFrom } from "../overhaulSheet";
import { KPI_BY_ID, KPI_DEFS, KPI_TARGETS_CONFIG_KEY, parseKpiTargets, type KpiId, type KpiSettings, type KpiSource } from "./kpiDefs";
import {
  kpiLoadFrom, kpiRanges, RECONTRACT_COLUMNS, rosterFromMembers, shiftYmd, toFormRows,
  type CustomerPraiseRow, type FormRaw, type ItLogLite, type KeymanRow, type KpiFacts, type KpiRanges, type OkrFacts,
  type PraiseRow, type ReceptionWeekRow, type VisitLite,
} from "./kpiCompute";

export type KpiSourceStatus =
  | { status: "ok"; at: number; notice?: string }
  | { status: "error"; at: number; error: string }
  | { status: "missing"; at: number; error: string };

export type KpiUnhandledInfo = { sheetMode: boolean; notice: string; over90: number };

export type KpiBundle = {
  today: string;
  ranges: KpiRanges;
  facts: KpiFacts;
  sources: Partial<Record<KpiSource, KpiSourceStatus>>;
  settings: KpiSettings;
  unhandledInfo: KpiUnhandledInfo | null;
  loadedAt: number;
};

/** 위젯(KPI) 목록 → 읽을 원본. 숨긴 위젯 원본은 빠진다 */
export function sourcesFor(ids: Iterable<KpiId>): Set<KpiSource> {
  const out = new Set<KpiSource>();
  for (const id of ids) for (const s of KPI_BY_ID[id]?.loads || []) out.add(s);
  // 활동 기록은 점검·AS·확장성을 표 원본으로 갈아 끼운 뒤 센다(팀 현황과 같은 입구)
  if (out.has("events")) { out.add("field"); out.add("expansion"); }
  if (out.size) out.add("roster"); // 작성자 → 팀 판정·인원 목표에 늘 필요
  return out;
}

export const ALL_KPI_SOURCES: Set<KpiSource> = sourcesFor(KPI_DEFS.map((d) => d.id));

/** 로더 안에서 작성자 → 팀(teamForAuthor)을 매기는 원본 — 명단을 다 읽은 뒤에 조회를 시작한다(expansionSource·operations.getActivityEvents) */
export const ROSTER_FIRST: ReadonlySet<KpiSource> = new Set<KpiSource>(["field", "expansion", "events"]);

const enc = (name: string) => encodeURIComponent(/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) ? name : `"${name}"`);
const cols = (list: string[]) => `select=${list.map(enc).join(",")}`;
/** KST 날짜 0시 = 전날 15:00 UTC(timestamptz 비교용) */
const kstStartIso = (ymd: string) => `${shiftYmd(ymd, -1)}T15:00:00Z`;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 미처리(접수 6종 + 지난 일정) — HomeUnhandledPanel load 와 같은 조회·같은 함수(mergeSheetAndDb → mergeUnhandled) */
export async function loadUnhandledRows(today: string = kstDate()): Promise<{ rows: UnhandledRow[]; info: KpiUnhandledInfo; partialError: string }> {
  const from = shiftYmd(today, -180);
  const [rec, tic, sheetRes] = await Promise.allSettled([
    fetchOpenReceptions(90),
    selectRows<TicketInput>("as_tickets", `select=id,team,date,time,vendor,assignee,status,scheduleType,receptionId,issue,calendarTitle,note,address&date=lt.${today}&date=gte.${from}&status=neq.${encodeURIComponent("완료")}&scheduleType=neq.${encodeURIComponent("매월점검")}&order=date.desc,time.asc&limit=3000`),
    loadSheetOpen(),
  ]);
  if (rec.status === "rejected" && tic.status === "rejected") throw new Error(`접수·일정 미처리를 불러오지 못했습니다: ${msg(rec.reason)}`);
  const errs: string[] = [];
  if (rec.status === "rejected") errs.push("접수");
  if (tic.status === "rejected") errs.push("일정");
  const partialError = errs.length ? `${errs.join("·")} 미처리를 불러오지 못했습니다 — 숫자가 빠지거나 겹쳤을 수 있음` : "";
  const sheet = sheetRes.status === "fulfilled" ? sheetRes.value : { enabled: true as const, data: null, error: "시트 조회 실패" };
  const dbRows = rec.status === "fulfilled" ? rec.value : [];
  const tickets = tic.status === "fulfilled" ? tic.value : [];
  if (sheet.enabled) {
    const merged = mergeSheetAndDb(dbRows, sheet.data, today, sheet.error);
    return { rows: mergeUnhandled(merged.db, tickets, today, merged.sheet), info: { sheetMode: merged.sheetKinds.length > 0, notice: merged.notice, over90: merged.over90.length }, partialError };
  }
  return { rows: mergeUnhandled(dbRows, tickets, today), info: { sheetMode: false, notice: "", over90: 0 }, partialError };
}

/**
 * K21 원본 두 개를 함께 읽는다. 실습 기록 표 없음(ItLogsMissingError)이면 배운 점만, 배운 점을 못 읽으면 실습 기록만 세고 notice 로 알린다.
 * 둘 다 못 읽으면 실습 기록 쪽 오류를 던진다(표 없음이면 "준비 중", 아니면 오류).
 */
async function loadItPracticeBoth(from: string, to: string): Promise<{ rows: ItLogLite[]; notice: string }> {
  const [practice, notes] = await Promise.allSettled([
    loadItPracticeLogs(from, to),
    // 줄 날짜가 from 주의 월요일 주차 글에 있을 수 있어 week_start 는 그 주 월요일부터
    getWeeklyNotes(weekRange(from).start, to).then((rows) => itLearningRowsFromNotes(rows, { from, to })),
  ]);
  const practiceMissing = practice.status === "rejected" && practice.reason instanceof Error && practice.reason.name === "ItLogsMissingError";
  if (practice.status === "rejected" && !practiceMissing) throw practice.reason;
  if (notes.status === "rejected" && practice.status === "rejected") throw practice.reason;
  const rows = combineItPractice(practice.status === "fulfilled" ? practice.value : null, notes.status === "fulfilled" ? notes.value : null) || [];
  const notice = practiceMissing
    ? "실습 기록 표가 아직 없어 주간 현황판 배운 점(브랜드 IT)만 셉니다"
    : notes.status === "rejected" ? `배운 점을 못 읽어 실습 기록만 셉니다(${msg(notes.reason)})` : "";
  return { rows, notice };
}

/**
 * 한 번 읽기. sources 를 주면 그 원본만(기본: 전부). 실패는 throw 하지 않고 sources[원본] 상태로 돌려준다.
 * today 는 kstDate() 값(테스트에서 넘길 수 있다).
 */
export async function loadKpiBundle(opts: { sources?: Iterable<KpiSource>; today?: string } = {}): Promise<KpiBundle> {
  const today = opts.today || kstDate();
  const ranges = kpiRanges(today);
  const want = new Set(opts.sources ? [...opts.sources] : ALL_KPI_SOURCES);
  if (want.has("events")) { want.add("field"); want.add("expansion"); }
  const from = kpiLoadFrom(ranges);
  const to = [ranges.quarter.to, ranges.week.to].sort().pop() as string;
  const facts: KpiFacts = {};
  const sources: Partial<Record<KpiSource, KpiSourceStatus>> = {};
  const ok = (s: KpiSource, notice?: string) => { sources[s] = { status: "ok", at: Date.now(), ...(notice ? { notice } : {}) }; };
  const fail = (s: KpiSource, e: unknown) => {
    // IT 학습 기록 표(itLogs)는 표가 없으면 ItLogsMissingError 를 던진다(구현서B 계약) — 둘 다 "준비 중"
    const missing = isTableMissingError(e) || (e instanceof Error && e.name === "ItLogsMissingError");
    sources[s] = missing ? { status: "missing", at: Date.now(), error: "원본 표가 아직 없습니다(SQL 실행 대기) — 준비 중" } : { status: "error", at: Date.now(), error: msg(e) };
  };
  // 설정(목표·주요 목표·휴일) — 못 읽으면 기본 목표 + 안내. 다른 원본과 동시에 읽고 끝에서 기다린다(2026-10-24 속도: 설정 → 명단 → 원본 직렬 3왕복을 1왕복으로)
  // 설정 글은 한 번 읽어 목표(KPI_TARGETS)와 오버홀 시트 탭(OVERHAUL_SHEET_TAB)에 같이 쓴다
  const configP = getConfig();
  const settingsP: Promise<KpiSettings> = configP.then(
    (cfg) => parseKpiTargets(cfg[KPI_TARGETS_CONFIG_KEY]),
    (e) => ({ ...parseKpiTargets(""), error: `설정을 못 읽어 기본 목표를 씁니다(${msg(e)})` }),
  );

  // 명단 — 작성자 → 팀(teamForAuthor)이 이 명단을 쓴다. 못 읽으면 기기에 남은 명단(또는 시드)으로 판정하고 그렇게 알린다.
  // 조회는 동시에 시작하되, 팀 판정을 쓰는 곳(행 → 팀 변환 put, 로더 안에서 팀을 매기는 ROSTER_FIRST)은 명단이 끝난 뒤에 돈다 — 숫자는 예전 직렬과 같다
  const rosterReady: Promise<void> = !want.has("roster") ? Promise.resolve() : fetchMembers().then(
    (members) => {
      facts.roster = rosterFromMembers(members);
      ok("roster");
    },
    (e) => { fail("roster", e); },
  );
  const run = async <T,>(s: KpiSource, p: () => Promise<T>, put: (v: T) => void) => {
    if (!want.has(s)) return;
    try {
      if (ROSTER_FIRST.has(s)) await rosterReady;
      const v = await p();
      await rosterReady;
      put(v);
      if (!sources[s]) ok(s);
    } catch (e) { fail(s, e); }
  };

  // Promise.all 안 콜백이 채운다(지역 변수 재대입은 타입 좁히기가 풀리지 않아 묶음 객체로)
  const hold: { activity: Awaited<ReturnType<typeof getActivityEvents>> | null; unhandled: KpiUnhandledInfo | null } = { activity: null, unhandled: null };
  await Promise.all([
    run("field", () => loadFieldRows(from, to), (v) => { facts.field = v; }),
    run("expansion", () => loadExpansionRows(from, to), (v) => { facts.expansion = v; }),
    run("events", () => getActivityEvents(from, to), (v) => { hold.activity = v; }),
    run("workin", () => selectAllRowsFast<WorkinPlaceLite>("workin_map_places", workinProgressQuery(ranges.quarterNo)), (v) => { facts.workin = v; }),
    // 양식 표(초과조정·불만·물류)는 팀 현황·순위표와 같은 로더·같은 변환(expansionSource.loadFormRaw → formCount.toFormTableRows, 2026-10-24)
    run("overage", () => loadFormRaw("overage_adjust", from, to), (v) => { facts.overage = toFormTableRows("overage_adjust", v, teamForAuthor); }),
    run("logistics", () => loadFormRaw("logistics_records", from, to), (v) => { facts.logistics = toFormTableRows("logistics_records", v, teamForAuthor); }),
    // 담당자 변경(K27) = contact_changes 원본(키맨체크 시트 행 포함, 2026-10-24 3단계) — 팀 현황·순위표와 같은 로더·변환
    run("contact", () => loadFormRaw("contact_changes", from, to), (v) => { facts.contact = toFormTableRows("contact_changes", v, teamForAuthor); }),
    // 재계약 확인 지남은 업체별 마지막 기록이 필요해 기간 없이 전량
    run("recontract", () => selectAllRowsFast<FormRaw>("recontract", `${cols(RECONTRACT_COLUMNS)}&_hidden=not.is.true&order=id.asc`), (v) => { facts.recontract = toFormRows(v, "날짜", teamForAuthor); }),
    run("bulman", () => loadFormRaw("bulman", from, to), (v) => { facts.bulman = toFormTableRows("bulman", v, teamForAuthor); }),
    run("misu", () => loadMisuVisits({ from, to }), (v) => { facts.misu = v; }),
    run("unhandled", () => loadUnhandledRows(today), (v) => { facts.unhandled = v.rows; hold.unhandled = v.info; if (v.partialError || v.info.notice) ok("unhandled", [v.partialError, v.info.notice].filter(Boolean).join(" · ")); }),
    run("receptionWeek", () => selectAllRows<ReceptionWeekRow>("service_receptions", `select=status,receipt_date&receipt_date=gte.${ranges.week.from}&deleted=eq.false`), (v) => { facts.receptionWeek = v; }),
    run("keyman", () => selectRows<KeymanRow>("contact_changes", `select=greeting_done,category&change_date=gte.${ranges.last7.from}&_hidden=not.is.true`), (v) => { facts.keyman = v; }),
    run("okr", async (): Promise<OkrFacts> => {
      const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
      const id = monthCycleId(y, m);
      // 주 단위(2026-10-24): 오늘이 든 주차(월~금, 주가 시작한 달 기준 — 10/1 은 9월 4주차)와 그 달 주차 기록 한 번에
      const cw = currentWeekOf(today);
      const weeks = weeksOfMonth(cw.year, cw.month);
      const sameMonth = cw.year === y && cw.month === m;
      const [cycle, quarter, reports, weekReports, wCycle, wQuarter] = await Promise.all([
        getOkrCycle(id), getOkrCycle(quarterIdOfMonth(y, m)), getOkrReports(id, ""), getOkrReportsIn(weeks.map((w) => w.id)),
        sameMonth ? Promise.resolve(null) : getOkrCycle(monthCycleId(cw.year, cw.month)),
        sameMonth ? Promise.resolve(null) : getOkrCycle(quarterIdOfMonth(cw.year, cw.month)),
      ]);
      const wc = sameMonth ? cycle : wCycle;
      const wq = sameMonth ? quarter : wQuarter;
      const goals = !wc ? [] : isLegacyMonthId(wc.id) ? wc.goals : monthScreenGoals(wc, wq).goals;
      return {
        cycle, quarter, reports,
        week: { id: weekCycleId(cw.year, cw.month, cw.weekNo), weeks: weeks.map((w) => ({ id: w.id, weekNo: w.weekNo, label: `${w.weekNo}주` })), goals, reports: weekReports },
      };
    }, (v) => { facts.okr = v; }),
    run("blog", () => fetchBlogRows(), (v) => { facts.blog = v; }),
    run("praise", () => selectAllRows<PraiseRow>("praise_posts", `select=from_author,to_name,created_at&created_at=gte.${kstStartIso(from)}&order=created_at.asc`), (v) => { facts.praise = v; }),
    run("customerPraise", () => selectAllRows<CustomerPraiseRow>("field_sheet_sync_jobs", `select=author,created_at&category=eq.praise&created_at=gte.${kstStartIso(from)}&order=created_at.asc`), (v) => { facts.customerPraise = v; }),
    run("visits", () => getTeamVisits(from, to, { columns: "id,work_date,author,vendor,visited,status" }), (v) => { facts.visits = v.map<VisitLite>((x) => ({ workDate: x.workDate, author: x.author, vendor: x.vendor, visited: x.visited })); }),
    run("itQuiz", () => loadItQuizAttempts(from, to), (v) => { facts.itQuiz = v; }),
    // K21 IT 실습(2026-10-25) = 실습 기록(it_practice_logs) + 주간 현황판 배운 점 중 브랜드 IT 줄. 실습 표가 없어도 배운 점은 센다
    run("itPractice", () => loadItPracticeBoth(from, to), (v) => { facts.itPractice = v.rows; if (v.notice) ok("itPractice", v.notice); }),
    // 오버홀(K33, 2026-10-24 사무실 일지 대신): 탭 = 설정 OVERHAUL_SHEET_TAB(못 읽으면 기본 "리스트(26년)") — 실패는 overhaul 원본 상태로
    run("overhaul", async () => loadOverhaulRows(overhaulTabFrom(await configP.catch(() => null))), (v) => { facts.overhaul = v; }),
    rosterReady,
  ]);
  const settings = await settingsP;

  // 활동 기록 = 팀 현황 입구와 같은 합성 → 팀장 제외 → 재전송 묶음(OperationsDashboard 와 같은 순서)
  if (hold.activity && facts.field && facts.expansion) {
    const merged = mergeFieldIntoEvents(mergeExpansionIntoEvents(hold.activity, facts.expansion), facts.field);
    facts.events = countableEvents(merged.filter((e) => teamForAuthor(e.author) !== "팀장"));
  } else if (want.has("events") && sources.events?.status === "ok") {
    sources.events = { status: "error", at: Date.now(), error: "점검·AS·확장성 표를 못 읽어 활동 기록 합계를 낼 수 없습니다" };
  }

  return { today, ranges, facts, sources, settings, unhandledInfo: hold.unhandled, loadedAt: Date.now() };
}

/** 위젯 하나의 상태 — 원본 없음(연결 필요) · 준비 중(표 없음) · 실패(—·[다시]) · 정상 */
export type KpiCellState =
  | { status: "ok"; notice: string }
  | { status: "unlinked" | "missing" | "error" | "off"; message: string };

export function kpiCellState(id: KpiId, bundle: Pick<KpiBundle, "sources">): KpiCellState {
  const def = KPI_BY_ID[id];
  if (def.status === "unlinked") return { status: "unlinked", message: def.basis };
  const notices: string[] = [];
  for (const s of def.loads) {
    const st = bundle.sources[s];
    if (!st) return { status: "off", message: "읽지 않은 원본(숨긴 위젯)" };
    if (st.status === "missing") return { status: "missing", message: st.error };
    if (st.status === "error") {
      if (s === "roster") { notices.push(`명단을 못 읽어 팀 판정·인원 목표가 옛 명단 기준(${st.error})`); continue; }
      return { status: "error", message: st.error };
    }
    if (st.notice) notices.push(st.notice);
  }
  return { status: "ok", notice: notices.join(" · ") };
}
