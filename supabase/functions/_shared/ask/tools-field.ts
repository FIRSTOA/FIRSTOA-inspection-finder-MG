/**
 * 통합검색 분석 도구 — 현장·사람·업체(T4~T11) (2026-10-29, 설계 docs/tasks/search-ask-everything-2026-10-29.md 5-3·6장)
 *
 *  T4 person_activity   사람 한 명의 표별 건수·요일 분포·업체 상위·같은 팀 평균
 *  T5 inspection_gap    워킨맵 점검 대상 중 기간 안 점검 기록 없는 곳(읽기 RPC suggest_workin_candidates 의 마지막 점검일)
 *  T6 recontract_progress 워킨맵 재계약(G5 완료·G6 진행·G7 제외) + 재계약 표 마지막 상태·위험도·진행상황 글
 *  T7 misu_followup     미수 N개월↑ × 미수 방문·방문기록·CS 체크 — 방문 안 한 곳·약속일 지난 곳
 *  T8 unhandled_now     지금 미처리(지난 일정·앱 부서 접수·시트 열린 줄) → 카톡방(room_map) 묶음
 *  T9 schedule_view     일정·내 일정 고정 순서·팀 캘린더(설계 Q1: 본인·같은 팀만)·자동 일정 후보
 *  T10 vendor_lookup    업체 이름 → 코드·별칭·워킨맵 팀·표별 최근 기록 수
 *  T11 photo_summary    사진 앨범 수·장수·분류·사람별(URL 은 주지 않음)
 * 전부 읽기 전용(ctx.rest). 실패한 표는 sources[].error 로 그대로 알린다(성공처럼 넘기지 않음). 순수 부분은 tests/askToolsField.test.ts.
 */
import {
  addDays, askerMaySee, clip, dateRange, daysBetween, enc, findPerson, inList, inYmd, loadRoster, num, qc, str, teamLetter, textDateLoose, toolError, topCounts, vendorKey, ymdOf,
  type AskToolArgs, type AskToolCtx, type RosterRow,
} from "./tool-util.ts";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const weekdayOf = (ymd: string) => (ymd ? WEEKDAYS[new Date(`${ymd}T12:00:00Z`).getUTCDay()] : "");
const quarterNo = (ymd: string) => Math.ceil(Number(ymd.slice(5, 7)) / 3);
const TEAMS = ["A", "B", "C", "D", "E"];
const teamArg = (v: unknown) => { const t = teamLetter(str(v).toUpperCase().replace(/팀|파트/g, "").trim()); return TEAMS.includes(t) ? t : ""; };
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/* ───────────── T4 사람 활동 ───────────── */

/** 표별 작성자·날짜·업체 칸(카탈로그와 같은 숨김 조건). match ilike = 칸에 여러 이름이 들어가는 표(팀 평균 생략).
 *  textDate = 날짜 칸이 글자이고 형식이 섞인 표(2026-10-29 실측: bulman 117행 '2024. 5. 23'·'Fri Mar 20 2026 …', overage_adjust '2026년 6월 10일') — 서버는 넉넉히, 자르기는 inYmd */
export type ActivitySource = { table: string; label: string; author: string; date: string; vendor: string; hidden?: string; match?: "eq" | "ilike"; textDate?: boolean };
export const ACTIVITY_SOURCES: ActivitySource[] = [
  { table: "jeomgeom", label: "점검 보고(기기 행)", author: "작성자", date: "작성일", vendor: "_업체명", hidden: "_hidden=not.is.true" },
  { table: "as_records", label: "AS 보고", author: "작성자", date: "작성일", vendor: "_업체명", hidden: "_hidden=not.is.true" },
  { table: "visit_logs", label: "방문기록", author: "author", date: "work_date", vendor: "vendor", hidden: "status=neq.cancelled" },
  { table: "service_receptions", label: "접수 작성", author: "author", date: "receipt_date", vendor: "vendor", hidden: "deleted=is.false" },
  { table: "reception_sheet_rows", label: "시트 접수 처리자", author: "handler", date: "receipt_date", vendor: "vendor" },
  { table: "as_tickets", label: "일정 담당", author: "assignee", date: "date", vendor: "vendor", match: "ilike" },
  { table: "supply_requests", label: "부품·자가 신청", author: "author", date: "request_date", vendor: "vendor", hidden: `stage=neq.${enc("취소")}` },
  { table: "pc_expansion", label: "PC 확장성", author: "작성자", date: "날짜", vendor: "_업체명", hidden: "_hidden=not.is.true" },
  { table: "mfp_expansion", label: "복합기 확장성", author: "등록자", date: "등록일", vendor: "_업체명", hidden: "_hidden=not.is.true" },
  { table: "misu_visits", label: "미수 방문", author: "author", date: "visited_at", vendor: "vendor", hidden: "_hidden=not.is.true" },
  { table: "overage_adjust", label: "초과료 조정 제안", author: "작성자", date: "방문일", vendor: "_업체명", hidden: "_hidden=not.is.true", textDate: true },
  { table: "bulman", label: "불만 처리", author: "처리자", date: "날짜", vendor: "_업체명", hidden: "_hidden=not.is.true", textDate: true },
  { table: "contact_changes", label: "담당자·주소 변경", author: "author", date: "change_date", vendor: "company", hidden: "_hidden=not.is.true" },
  { table: "logistics_records", label: "물류 양식", author: "작성자", date: "작성일", vendor: "_업체명", hidden: "_hidden=not.is.true" },
  { table: "activity_events", label: "활동 기록(물류·교체 원본)", author: "author", date: "activity_date", vendor: "vendor", hidden: "status=neq.cancelled" },
  { table: "photo_albums", label: "사진 앨범", author: "author", date: "created_at", vendor: "vendor" },
];

export type ActivityCount = { table: string; label: string; person: number; teamTotal: number | null; teamAvg: number | null; vendors: Array<{ key: string; count: number }>; error?: string; truncated?: boolean };

/** 순수 — 한 표의 행(작성자·날짜·업체)을 사람·팀 몫으로 */
export function countActivity(src: ActivitySource, rows: Array<Record<string, unknown>>, person: string, members: string[]): ActivityCount & { days: string[] } {
  const mine = rows.filter((r) => (src.match === "ilike" ? str(r[src.author]).includes(person) : str(r[src.author]) === person));
  const teamTotal = src.match === "ilike" ? null : rows.filter((r) => members.includes(str(r[src.author]))).length;
  return {
    table: src.table, label: src.label, person: mine.length, teamTotal,
    teamAvg: teamTotal === null || !members.length ? null : Math.round((teamTotal / members.length) * 10) / 10,
    vendors: topCounts(mine.map((r) => str(r[src.vendor])), 5),
    days: mine.map((r) => ymdOf(r[src.date])).filter(Boolean),
  };
}

export async function personActivity(args: AskToolArgs, ctx: AskToolCtx) {
  try {
    const roster = await loadRoster(ctx);
    const who = findPerson(roster, str(args.person));
    const person = who?.name || str(args.person);
    if (!person) return { error: "person(사람 이름)이 필요합니다" };
    const { from, to } = dateRange(args.from, args.to, ctx.today);
    const members = who ? roster.filter((r) => r.team === who.team && r.title !== "팀장").map((r) => r.name) : [person];
    if (!members.includes(person)) members.push(person);
    const end = addDays(to, 1);
    const results = await Promise.all(ACTIVITY_SOURCES.map(async (src) => {
      const who = src.match === "ilike" ? `${qc(src.author)}=ilike.${enc(`*${person}*`)}` : `${qc(src.author)}=${inList(members)}`;
      const range = src.textDate ? [textDateLoose(src.date, from, to)] : [`${qc(src.date)}=gte.${from}`, `${qc(src.date)}=lt.${end}`];
      const q = [`select=${qc(src.author)},${qc(src.date)},${qc(src.vendor)}`, who, ...range, src.hidden || ""].filter(Boolean).join("&");
      try {
        const { rows, truncated } = await ctx.rest.getAll<Record<string, unknown>>(src.table, q, { max: 8000, orderBy: src.textDate ? "id" : src.date });
        const inRange = src.textDate ? rows.filter((r) => inYmd(r[src.date], from, to)) : rows;
        return { ...countActivity(src, inRange, person, members), ...(truncated ? { truncated: true } : {}) };
      } catch (e) { return { table: src.table, label: src.label, person: 0, teamTotal: null, teamAvg: null, vendors: [], days: [] as string[], error: errText(e) }; }
    }));
    const days = results.flatMap((r) => r.days);
    const byWeekday = Object.fromEntries(WEEKDAYS.map((d) => [d, 0])) as Record<string, number>;
    for (const d of days) byWeekday[weekdayOf(d)] += 1;
    const out = {
      person, team: who?.team || "(명단에 없음)", title: who?.title || "", from, to,
      teamMembers: members.length,
      sources: results.map(({ days: _d, ...r }) => { void _d; return r; }).filter((r) => r.person || r.teamTotal || r.error),
      byWeekday,
      busiestDays: topCounts(days, 5),
      topVendors: topCounts(results.flatMap((r) => r.vendors.flatMap((v) => Array(v.count).fill(v.key) as string[])), 10),
      notes: [
        "팀 평균 = 같은 명단 팀(팀장 제외) 합 ÷ 인원. 일정 담당(as_tickets)은 이름이 여럿 들어가 팀 평균을 내지 않는다.",
        "KPI 숫자(같은 날 재전송 1건 등 KPI 규칙)는 packs.kpi 값을 우선 — 여기 건수는 표 행 수다.",
        ...(who ? [] : [`${person} 은(는) 명단(cs_members)에 없는 이름 — 본인 기록만 셈`]),
      ],
    };
    return ctx.mask(out);
  } catch (e) { return toolError(e); }
}

/* ───────────── T5 점검 누락 ───────────── */

/** RPC suggest_workin_candidates 한 줄 중 쓰는 칸 */
export type WorkinCandidate = { id?: number; place_name?: string; vendor?: string; grade?: string; label?: string; last_date?: string | null; days_since?: number | null };
const NO_RECORD_DAYS = 9999; // autoScheduleCandidate NO_RECORD_DAYS 와 같은 센티널
const DONE_LABELS = new Set(["G5", "G12"]);

/** 순수 — 대상 지점 × 마지막 점검일 → 기간 안 기록 없는 곳(지도 완료 G5·G12 는 따로) */
export function inspectionGaps(places: Array<WorkinCandidate & { kind: string }>, from: string) {
  const rows = places.map((p) => {
    const last = p.days_since === NO_RECORD_DAYS ? "" : ymdOf(p.last_date);
    return { name: str(p.place_name), vendor: str(p.vendor), kind: p.kind, label: str(p.label), lastInspection: last || "(기록 없음)", inPeriod: !!last && last >= from, mapDone: DONE_LABELS.has(str(p.label)) };
  });
  const missing = rows.filter((r) => !r.inPeriod && !r.mapDone).sort((a, b) => (a.lastInspection < b.lastInspection ? -1 : 1));
  return {
    total: rows.length,
    recordedInPeriod: rows.filter((r) => r.inPeriod).length,
    mapDone: rows.filter((r) => r.mapDone).length,
    missingCount: missing.length,
    missing: missing.slice(0, 150),
    mapDoneButNoRecord: rows.filter((r) => r.mapDone && !r.inPeriod).slice(0, 30),
  };
}

export async function inspectionGap(args: AskToolArgs, ctx: AskToolCtx) {
  const team = teamArg(args.team);
  if (!team) return { error: "team(A~E)이 필요합니다" };
  const { from, to } = dateRange(args.from ?? args.period, args.to, ctx.today);
  const quarter = quarterNo(from);
  const sources: Array<{ kind: string; error?: string; n?: number }> = [];
  const places: Array<WorkinCandidate & { kind: string }> = [];
  for (const kind of ["quarter", "monthly"]) {
    try {
      const rows = await ctx.rest.rpc<WorkinCandidate[]>("suggest_workin_candidates", { p_team: team, p_kind: kind, p_quarter: quarter, p_grades: [], p_lat: null, p_lng: null, p_min_days: 0, p_limit: 2000 });
      const list = Array.isArray(rows) ? rows : [];
      places.push(...list.map((r) => ({ ...r, kind })));
      sources.push({ kind, n: list.length });
    } catch (e) { sources.push({ kind, error: errText(e) }); }
  }
  if (sources.every((s) => s.error)) return { error: `워킨맵 점검 대상을 읽지 못했습니다 — ${sources.map((s) => s.error).join(" / ")}` };
  return ctx.mask({
    team, quarter: `${quarter}분기`, from, to, ...inspectionGaps(places, from), sources,
    rule: "대상 = 워킨맵 그 분기 분기점검·매월점검 지점(숨김 제외). 마지막 점검일 = 자동 일정과 같은 서버 함수(suggest_workin_candidates, 업체 키 매칭) — 기간 시작일 이후면 기록 있음. 지도 색 G5·G12 = 완료로 따로 셈.",
  });
}

/* ───────────── T6 재계약 진행 ───────────── */

export type RenewalPlace = { id?: number; team: string; label: string; name: string };
export type RecontractRow = Record<string, unknown>;

/** 순수 — 팀별 G5/G6/G7·나머지 + 미완료 지점에 재계약 표 마지막 행 붙이기 */
export function renewalByTeam(places: RenewalPlace[], recontract: RecontractRow[], team?: string) {
  const latest = new Map<string, RecontractRow>();
  for (const r of [...recontract].sort((a, b) => (ymdOf(a["날짜"]) < ymdOf(b["날짜"]) ? -1 : 1))) { const k = vendorKey(r["_업체명"]); if (k) latest.set(k, r); }
  const teams = [...new Set(places.map((p) => teamLetter(p.team)).filter(Boolean))].filter((t) => !team || t === team).sort();
  return teams.map((t) => {
    const mine = places.filter((p) => teamLetter(p.team) === t);
    const label = (p: RenewalPlace) => str(p.label);
    const target = mine.filter((p) => label(p) !== "G7");
    const done = target.filter((p) => label(p) === "G5").length;
    const open = target.filter((p) => label(p) !== "G5").map((p) => {
      const r = latest.get(vendorKey(p.name));
      return { name: p.name, label: label(p) || "(색 없음)", 갱신상태: str(r?.["갱신상태"]), 갱신위험도: str(r?.["갱신위험도"]), 최종상태: str(r?.["최종상태"]), 계약종료일: str(r?.["계약종료일"]), 다음확인일: str(r?.["다음확인일"]), 진행상황: clip(r?.["진행상황"], 160), 기록일: ymdOf(r?.["날짜"]) || "(재계약 기록 없음)" };
    });
    return {
      team: t, target: target.length, done, inProgress: target.filter((p) => label(p) === "G6").length, excludedG7: mine.length - target.length,
      pct: target.length ? Math.round((done / target.length) * 100) : null,
      noRecord: open.filter((o) => o.기록일 === "(재계약 기록 없음)").length,
      openStates: topCounts(open.map((o) => o.갱신상태 || "(빈칸)"), 8),
      openRisks: topCounts(open.map((o) => o.갱신위험도 || "(빈칸)"), 6),
      open: open.slice(0, 40),
    };
  });
}

/**
 * 분기 번호만 있을 때의 연도 — 오늘(KST YYYY-MM-DD)의 (연, 분기)에서 가장 가까운 해, 동점이면 지난 쪽.
 * 12월에 1분기 → 다음 해, 1월에 4분기 → 작년. src/workinPlaces.ts nearestYearFor · SQL workin_nearest_year_ 와 같은 규칙(2026-10-31)
 */
export function nearestYearOf(quarter: number, todayYmd: string): number {
  const y = Number(todayYmd.slice(0, 4));
  const here = y * 4 + quarterNo(todayYmd);
  let best = y - 1;
  for (const c of [y - 1, y, y + 1]) if (Math.abs(c * 4 + quarter - here) < Math.abs(best * 4 + quarter - here)) best = c;
  return best;
}
/** 연도 인자 — 2자리(27)면 2027, 비었거나 이상하면 null */
export function yearArg(v: unknown): number | null {
  const n = Math.trunc(Number(str(v).replace(/년/g, "").trim()));
  if (!Number.isFinite(n) || n <= 0) return null;
  const y = n < 100 ? 2000 + n : n;
  return y >= 2020 && y <= 2100 ? y : null;
}

export async function recontractProgress(args: AskToolArgs, ctx: AskToolCtx) {
  const team = teamArg(args.team) || undefined;
  const q = Math.min(4, Math.max(1, num(args.quarter, quarterNo(ctx.today))));
  // 같은 분기 번호가 해마다 있다(workin_map_places.year, 2026-10-31) — 연도를 안 주면 가장 가까운 해
  const year = yearArg(args.year) ?? nearestYearOf(q, ctx.today);
  try {
    const [places, rec] = await Promise.all([
      ctx.rest.getAll<RenewalPlace>("workin_map_places", `select=id,team,label,name&kind=eq.renewal&year=eq.${year}&quarter=eq.${q}`, { max: 5000 }),
      ctx.rest.getAll<RecontractRow>("recontract", `select=${["날짜", "_업체명", "담당팀", "계약종료일", "진행상황", "갱신상태", "갱신위험도", "최종상태", "다음확인일"].map(qc).join(",")}&_hidden=not.is.true&${qc("날짜")}=gte.${addDays(ctx.today, -400)}`, { max: 6000, orderBy: "날짜" }),
    ]);
    return ctx.mask({
      quarter: `${String(year).slice(2)}년 ${q}분기`, teams: renewalByTeam(places.rows, rec.rows, team),
      rule: "대상 = 워킨맵 재계약(kind renewal) 그 분기 지점 중 G7(전략영업 V·SS) 뺀 전부, 완료 = G5, 진행 = G6 — 홈 K35 와 같은 셈. 재계약 표는 업체 키로 마지막 기록(최근 400일)을 붙였다.",
      ...(rec.truncated ? { note: "재계약 표가 상한에 걸려 일부만 읽음" } : {}),
    });
  } catch (e) { return toolError(e); }
}

/* ───────────── T7 미수 후속 ───────────── */

const monthsOf = (v: unknown) => { const m = str(v).match(/\d+(?:\.\d+)?/); return m ? Number(m[0]) : 0; };

/** 순수 — 업체별 최신 미수 행 × 방문(미수 방문·방문기록) × CS 체크 */
export function misuFollowup(input: {
  misu: Array<Record<string, unknown>>; misuVisits: Array<Record<string, unknown>>; visitLogs: Array<Record<string, unknown>>; csChecks: Array<Record<string, unknown>>;
  minMonths: number; team?: string; today: string;
}) {
  const latest = new Map<string, Record<string, unknown>>();
  for (const r of input.misu) {
    const k = vendorKey(r["_업체명"]); if (!k) continue;
    const prev = latest.get(k);
    if (!prev || ymdOf(r["입력일"]) >= ymdOf(prev["입력일"])) latest.set(k, r);
  }
  const csTeam = new Map<string, { team: string; checked: boolean }>();
  for (const c of input.csChecks) { const k = vendorKey(c.vendor); if (k) csTeam.set(k, { team: teamLetter(c.team), checked: c.checked === true || str(c.checked) === "true" }); }
  const lastBy = (rows: Array<Record<string, unknown>>, vcol: string, dcol: string) => {
    const m = new Map<string, Record<string, unknown>>();
    for (const r of rows) { const k = vendorKey(r[vcol]); if (!k) continue; const p = m.get(k); if (!p || ymdOf(r[dcol]) >= ymdOf(p[dcol])) m.set(k, r); }
    return m;
  };
  const mv = lastBy(input.misuVisits, "vendor", "visited_at");
  const vl = lastBy(input.visitLogs, "vendor", "work_date");
  let unknownTeam = 0;
  const list = [...latest.entries()].map(([k, r]) => {
    const months = Math.max(monthsOf(r["실제 개월수"]), monthsOf(r["미수개월"]));
    const cs = csTeam.get(k);
    const team = cs?.team || teamLetter(r["지역"]) || str(mv.get(k)?.author_team) || "";
    const visit = mv.get(k); const log = vl.get(k);
    const promise = ymdOf(visit?.promise_date) || ymdOf(r["입금약속일"]) || ymdOf(r["약속일"]);
    return {
      vendor: str(r["_업체명"]), team: TEAMS.includes(teamLetter(team)) ? teamLetter(team) : team || "(팀 모름)", months, balance: str(r["실제 잔액"]) || str(r["미수잔액"]),
      misuDate: ymdOf(r["입력일"]), customerReaction: clip(r["고객반응"], 120),
      lastMisuVisit: ymdOf(visit?.visited_at), lastMisuVisitBy: str(visit?.author), visitJudgment: str(visit?.judgment),
      lastVisitLog: ymdOf(log?.work_date), lastVisitLogBy: str(log?.author),
      promiseDate: promise, promiseOverdue: !!promise && promise < input.today, csChecked: !!cs?.checked,
    };
  }).filter((x) => x.months >= input.minMonths).filter((x) => {
    if (!input.team) return true;
    if (x.team === "(팀 모름)") { unknownTeam += 1; return false; }
    return x.team === input.team;
  }).sort((a, b) => b.months - a.months || a.vendor.localeCompare(b.vendor, "ko"));
  const notVisited = list.filter((x) => !x.lastMisuVisit && !x.lastVisitLog);
  return {
    count: list.length, notVisitedCount: notVisited.length, promiseOverdueCount: list.filter((x) => x.promiseOverdue).length,
    notVisited: notVisited.slice(0, 80), promiseOverdue: list.filter((x) => x.promiseOverdue).slice(0, 40), all: list.slice(0, 120),
    ...(unknownTeam ? { unknownTeam } : {}),
  };
}

/** 순수 — 미수 입력일 글들 중 ymdOf 로 읽히는 가장 늦은 날(오늘 뒤 오타는 뺌). 없으면 "" */
export function misuLatestDay(rows: Array<Record<string, unknown>>, today: string): string {
  let best = "";
  for (const r of rows) { const d = ymdOf(r["입력일"]); if (d && d <= today && d > best) best = d; }
  return best;
}

export async function misuFollowupTool(args: AskToolArgs, ctx: AskToolCtx) {
  const minMonths = Math.max(1, num(args.min_months, 3));
  const team = teamArg(args.team) || undefined;
  const since = dateRange(args.since || addDays(ctx.today, -60), ctx.today, ctx.today).from;
  try {
    // misu.입력일 은 글자 칸이고 형식이 섞여 있다('2026-06-22 00:00:00'·'2026.9.8'·업체명이 잘못 들어간 행) — 서버 order·gte 는 글자 비교라
    // 최신일·45일 창이 틀린다(order desc 1행 = 한글 쓰레기 행 → "비어 있습니다", gte 는 '2026.1.7' 이 새어 듦). 넉넉히 읽고 ymdOf 로 자른다.
    const head = await ctx.rest.getAll<Record<string, unknown>>("misu", `select=${qc("입력일")}&_hidden=not.is.true&${textDateLoose("입력일", addDays(ctx.today, -400), ctx.today)}`, { max: 20000 });
    const latestDay = misuLatestDay(head.rows, ctx.today);
    if (!latestDay) return { error: "미수 표에서 최근 400일 안 입력일을 읽지 못했습니다" };
    const winFrom = addDays(latestDay, -45);
    const cols = ["_업체명", "입력일", "지역", "미수개월", "미수잔액", "실제 개월수", "실제 잔액", "입금약속일", "약속일", "고객반응"].map(qc).join(",");
    const [misuAll, mv, vl, cs] = await Promise.all([
      ctx.rest.getAll<Record<string, unknown>>("misu", `select=${cols}&_hidden=not.is.true&${textDateLoose("입력일", winFrom, latestDay)}`, { max: 20000 }),
      ctx.rest.getAll<Record<string, unknown>>("misu_visits", `select=vendor,visited_at,author,author_team,promise_date,judgment&_hidden=not.is.true&visited_at=gte.${since}`, { max: 3000, orderBy: "visited_at" }),
      ctx.rest.getAll<Record<string, unknown>>("visit_logs", `select=vendor,work_date,author&status=neq.cancelled&work_date=gte.${since}`, { max: 6000, orderBy: "work_date" }),
      ctx.rest.get<Record<string, unknown>>("misu_cs_checks?select=team,vendor,checked&limit=2000"),
    ]);
    const misu = misuAll.rows.filter((r) => inYmd(r["입력일"], winFrom, latestDay));
    return ctx.mask({
      minMonths, team: team || "전체", since, misuListDate: latestDay,
      ...misuFollowup({ misu, misuVisits: mv.rows, visitLogs: vl.rows, csChecks: cs, minMonths, team, today: ctx.today }),
      rule: `미수 = 최신 미수 목록(${latestDay} 기준 45일 안 행)에서 업체별 마지막 행, 개월 = 실제 개월수·미수개월 중 큰 값. 방문 = ${since} 이후 미수 방문이력 또는 방문기록. 팀 = 미수 CS 체크 팀 → 미수 지역 → 방문자 팀.`,
    });
  } catch (e) { return toolError(e); }
}

/* ───────────── T8 지금 미처리 ───────────── */

export type UnhandledItem = { source: "일정" | "앱 접수" | "시트"; kind: string; team: string; date: string; ageDays: number; vendor: string; who: string; status: string; title: string; room: string };
const LOGISTICS = new Set(["물류", "납품철수교체휴가교육"]);
const SHEET_KIND: Record<string, string> = { sales: "영업팀", mgmt: "경영지원", remote: "원격이관", copier: "복합기" };

/** 순수 — 접수 종류·팀 → 카톡방(room_map category|region, 없으면 * 공통) */
export function roomFor(roomMap: Array<{ category?: string; region?: string; room?: string }>, kind: string, team: string): string {
  const cat = (c: string) => str(c).replace(/\s+/g, "");
  const k = cat(kind);
  const hits = roomMap.filter((r) => { const c = cat(r.category || ""); return !!c && (c === k || c.includes(k) || k.includes(c)); });
  const exact = hits.find((r) => teamLetter(r.region) === team) || hits.find((r) => str(r.region) === "*") || hits[0];
  return str(exact?.room);
}

/** 순수 — 세 원본을 한 목록으로(시트 줄과 짝지어진 앱 접수는 시트 쪽만) */
export function mergeUnhandledNow(input: {
  tickets: Array<Record<string, unknown>>; receptions: Array<Record<string, unknown>>; sheet: Array<Record<string, unknown>>;
  roomMap: Array<{ category?: string; region?: string; room?: string }>; today: string;
}): UnhandledItem[] {
  const age = (d: string) => (d ? Math.max(0, daysBetween(d, input.today)) : 0);
  const out: UnhandledItem[] = [];
  for (const t of input.tickets) {
    const date = ymdOf(t.date); if (!date || date >= input.today || str(t.status) === "완료" || str(t.scheduleType) === "매월점검") continue;
    const kind = LOGISTICS.has(str(t.scheduleType)) ? "물류" : "CS접수";
    const team = teamLetter(t.team);
    out.push({ source: "일정", kind, team, date, ageDays: age(date), vendor: str(t.vendor), who: str(t.assignee), status: str(t.status) || "미처리", title: clip(t.issue || t.calendarTitle, 80), room: roomFor(input.roomMap, kind === "물류" ? "물류" : "AS", team) });
  }
  const sheetIds = new Set(input.sheet.map((s) => str(s.reception_id)).filter(Boolean));
  for (const r of input.receptions) {
    if (sheetIds.has(str(r.id)) || str(r.status) === "완료" || str(r.type) === "복합기 AS") continue;
    const date = ymdOf(r.receipt_date); const kind = str(r.type) || "접수"; const team = teamLetter(r.region);
    out.push({ source: "앱 접수", kind, team, date, ageDays: age(date), vendor: str(r.vendor), who: str(r.author), status: str(r.status), title: clip(r.title || r.symptom, 80), room: roomFor(input.roomMap, kind, team) });
  }
  for (const s of input.sheet) {
    if (!["open", "hold"].includes(str(s.cls)) || str(s.gone_at)) continue;
    const date = ymdOf(s.receipt_date); const kind = SHEET_KIND[str(s.source)] || str(s.kind) || str(s.source); const team = teamLetter(s.region);
    out.push({ source: "시트", kind, team, date, ageDays: age(date), vendor: str(s.vendor), who: str(s.handler) || str(s.author), status: str(s.state) || (str(s.cls) === "hold" ? "보류" : "미처리"), title: clip(s.summary, 80), room: roomFor(input.roomMap, kind, team) });
  }
  return out.sort((a, b) => b.ageDays - a.ageDays);
}

export async function unhandledNow(args: AskToolArgs, ctx: AskToolCtx) {
  const team = teamArg(args.team);
  const kindWant = str(args.kind);
  const roomWant = str(args.room);
  const since = addDays(ctx.today, -180);
  const errors: string[] = [];
  const safe = async <T>(label: string, p: Promise<T>, empty: T) => { try { return await p; } catch (e) { errors.push(`${label}: ${errText(e)}`); return empty; } };
  const [tickets, receptions, sheet, roomMap] = await Promise.all([
    safe("일정", ctx.rest.getAll<Record<string, unknown>>("as_tickets", `select=id,date,team,vendor,assignee,status,${qc("scheduleType")},issue,${qc("calendarTitle")}&date=lt.${ctx.today}&date=gte.${since}&status=neq.${enc("완료")}`, { max: 4000, orderBy: "date" }).then((r) => r.rows), []),
    safe("앱 접수", ctx.rest.getAll<Record<string, unknown>>("service_receptions", `select=id,receipt_date,type,vendor,region,title,symptom,status,author&deleted=is.false&status=neq.${enc("완료")}&receipt_date=gte.${since}`, { max: 3000, orderBy: "receipt_date" }).then((r) => r.rows), []),
    safe("시트", ctx.rest.getAll<Record<string, unknown>>("reception_sheet_rows", "select=id,source,kind,receipt_date,author,handler,state,cls,vendor,region,summary,reception_id,gone_at&cls=in.(open,hold)&gone_at=is.null", { max: 3000 }).then((r) => r.rows), []),
    safe("카톡방 매핑", ctx.rest.get<{ category?: string; region?: string; room?: string }>("room_map?select=category,region,room&limit=500"), []),
  ]);
  if (errors.length === 4) return { error: `미처리 원본을 하나도 읽지 못했습니다 — ${errors.join(" / ")}` };
  let items = mergeUnhandledNow({ tickets, receptions, sheet, roomMap, today: ctx.today });
  if (team) items = items.filter((x) => x.team === team);
  if (kindWant) items = items.filter((x) => x.kind.includes(kindWant) || kindWant.includes(x.kind));
  if (roomWant) items = items.filter((x) => x.room.includes(roomWant));
  const groups = new Map<string, { room: string; kind: string; team: string; count: number; oldestDays: number }>();
  for (const x of items) {
    const key = `${x.room || "(방 매핑 없음)"}|${x.kind}|${x.team}`;
    const g = groups.get(key) || { room: x.room || "(방 매핑 없음)", kind: x.kind, team: x.team || "(팀 없음)", count: 0, oldestDays: 0 };
    g.count += 1; g.oldestDays = Math.max(g.oldestDays, x.ageDays); groups.set(key, g);
  }
  return ctx.mask({
    today: ctx.today, total: items.length,
    byRoom: [...groups.values()].sort((a, b) => b.count - a.count),
    items: items.slice(0, 150),
    ...(errors.length ? { partial: errors } : {}),
    rule: "일정 = 지난 날짜·완료 아님·매월점검 아님(일정리스트 [미처리]와 같은 판정, 최근 180일). 앱 접수 = 완료 아닌 부서 접수(복합기 AS 는 일정 기준이라 뺌). 시트 = 보관 표 cls open/hold·시트에서 안 사라진 줄. 방 = room_map 종류·지역 매칭(추정). 홈 미처리 숫자는 packs.kpi(K16·K17)가 정확.",
  });
}

/* ───────────── T9 일정 보기 ───────────── */

/** 순수 — plan_memos '__order__:날짜' 행 → { 날짜: [일정 id…] } */
export function pinnedOrders(rows: Array<{ ticket_id?: string; memo?: string }>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    const m = str(r.ticket_id).match(/^__order__:(\d{4}-\d{2}-\d{2})$/);
    if (!m) continue;
    try { const ids = JSON.parse(str(r.memo) || "[]"); if (Array.isArray(ids)) out[m[1]] = [...new Set(ids.map(String))]; } catch { out[m[1]] = []; }
  }
  return out;
}

export async function scheduleView(args: AskToolArgs, ctx: AskToolCtx) {
  try {
    const roster = await loadRoster(ctx);
    const who = str(args.person) ? findPerson(roster, str(args.person)) : null;
    const person = who?.name || str(args.person);
    const team = teamArg(args.team) || who?.team || "";
    if (!person && !team) return { error: "person 또는 team 이 필요합니다" };
    const { from, to } = dateRange(args.from || ctx.today, args.to || addDays(ctx.today, 7), ctx.today);
    const who2 = person ? `assignee=ilike.${enc(`*${person}*`)}` : `team=eq.${enc(team)}`;
    const tickets = await ctx.rest.getAll<Record<string, unknown>>("as_tickets", `select=id,date,time,team,vendor,${qc("scheduleType")},issue,assignee,status,${qc("calendarTitle")},note,address&${who2}&date=gte.${from}&date=lte.${to}&order=date.asc,time.asc`, { max: 2000 });
    const out: Record<string, unknown> = {
      person: person || undefined, team, from, to,
      tickets: tickets.rows.slice(0, 200).map((t) => ({ id: str(t.id), date: str(t.date), time: str(t.time), team: str(t.team), vendor: str(t.vendor), type: str(t.scheduleType), assignee: str(t.assignee), status: str(t.status), issue: clip(t.issue, 120), note: clip(t.note, 200) })),
      ticketCount: tickets.rows.length,
    };
    if (person) {
      try {
        const memos = await ctx.rest.get<{ ticket_id?: string; memo?: string }>(`plan_memos?select=ticket_id,memo&author=eq.${enc(person)}&limit=500`);
        const orders = pinnedOrders(memos);
        const inRange = Object.fromEntries(Object.entries(orders).filter(([d]) => d >= from && d <= to));
        const byId = new Map(tickets.rows.map((t) => [str(t.id), t]));
        out.pinnedOrder = Object.fromEntries(Object.entries(inRange).map(([d, ids]) => [d, ids.map((id, i) => ({ order: i + 1, id, vendor: str(byId.get(id)?.vendor) || "(이 범위 일정에 없음)" }))]));
        out.memos = memos.filter((m) => !str(m.ticket_id).startsWith("__") && byId.has(str(m.ticket_id))).map((m) => ({ ticket: str(m.ticket_id), memo: clip(m.memo, 200) }));
      } catch (e) { out.pinnedOrder = { error: errText(e) }; }
    }
    // 팀 캘린더(회식·교육·휴무) — 설계 Q1: 묻는 사람 본인·같은 팀만
    if (team) {
      if (!askerMaySee(ctx.asker, { team })) out.teamCalendar = { hidden: `팀 캘린더는 같은 팀만 볼 수 있습니다(묻는 사람: ${ctx.asker.name || "이름 없음"} ${ctx.asker.team || ""})` };
      else {
        try {
          const ev = await ctx.rest.get<Record<string, unknown>>(`team_calendar_events?select=date,time,title,memo,author&team=eq.${enc(team)}&date=gte.${from}&date=lte.${to}&order=date.asc,time.asc&limit=300`);
          out.teamCalendar = ev.map((e) => ({ date: str(e.date), time: str(e.time).slice(0, 5), title: clip(e.title, 80), memo: clip(e.memo, 160), author: str(e.author) }));
        } catch (e) { out.teamCalendar = { error: errText(e) }; }
      }
    }
    if (args.suggest === true && TEAMS.includes(team)) {
      try {
        const c = await ctx.rest.rpc<WorkinCandidate[]>("suggest_workin_candidates", { p_team: team, p_kind: "quarter", p_quarter: quarterNo(ctx.today), p_grades: [], p_lat: null, p_lng: null, p_min_days: 60, p_limit: 15 });
        out.autoCandidates = (Array.isArray(c) ? c : []).map((x) => ({ place: str(x.place_name), grade: str(x.grade), label: str(x.label), lastInspection: x.days_since === NO_RECORD_DAYS ? "(기록 없음)" : ymdOf(x.last_date), daysSince: x.days_since === NO_RECORD_DAYS ? null : x.days_since }));
      } catch (e) { out.autoCandidates = { error: errText(e) }; }
    }
    out.notes = ["내 일정 고정 순서는 서버(plan_memos)에 저장된 것만 — 기기에만 있는 순서는 못 본다.", "네이버 캘린더 원본은 범위 밖."];
    return ctx.mask(out);
  } catch (e) { return toolError(e); }
}

/* ───────────── T10 업체 찾기 ───────────── */

/** textDate = 형식 섞인 글자 날짜 칸 — HEAD count 의 글자 비교 대신 날짜 칸만 읽어 ymdOf 로 센다 */
const RECENT_TABLES: Array<{ table: string; label: string; vendor: string; date: string; hidden?: string; textDate?: boolean }> = [
  { table: "as_tickets", label: "일정", vendor: "vendor", date: "date" },
  { table: "service_receptions", label: "접수", vendor: "vendor", date: "receipt_date", hidden: "deleted=is.false" },
  { table: "jeomgeom", label: "점검", vendor: "_업체명", date: "작성일", hidden: "_hidden=not.is.true" },
  { table: "as_records", label: "AS 보고", vendor: "_업체명", date: "작성일", hidden: "_hidden=not.is.true" },
  { table: "misu", label: "미수", vendor: "_업체명", date: "입력일", hidden: "_hidden=not.is.true", textDate: true },
  { table: "bulman", label: "불만", vendor: "_업체명", date: "날짜", hidden: "_hidden=not.is.true", textDate: true },
  { table: "recontract", label: "재계약", vendor: "_업체명", date: "날짜", hidden: "_hidden=not.is.true" },
];

export async function vendorLookup(args: AskToolArgs, ctx: AskToolCtx) {
  const name = str(args.name);
  const key = vendorKey(name);
  if (key.length < 2) return { error: "name(업체 이름 두 글자 이상)이 필요합니다" };
  const core = name.replace(/㈜|\(주\)|주식회사/g, "").trim().slice(0, 12);
  const since = addDays(ctx.today, -365);
  const errors: string[] = [];
  const safe = async <T>(label: string, p: Promise<T>, empty: T) => { try { return await p; } catch (e) { errors.push(`${label}: ${errText(e)}`); return empty; } };
  const [master, alias, workin, counts] = await Promise.all([
    safe("업체 마스터", ctx.rest.get<Record<string, unknown>>(`vendor_master?select=code,name,aliases,device_count&name=ilike.${enc(`*${core}*`)}&limit=10`), []),
    safe("별칭", ctx.rest.get<Record<string, unknown>>(`vendor_match_alias?select=akey,code&akey=eq.${enc(key)}&limit=10`), []),
    safe("워킨맵", ctx.rest.get<Record<string, unknown>>(`workin_map_places?select=team,kind,label,quarter,name&name=ilike.${enc(`*${core}*`)}&limit=20`), []),
    Promise.all(RECENT_TABLES.map(async (t) => {
      try {
        const like = `${qc(t.vendor)}=ilike.${enc(`*${core}*`)}`;
        if (t.textDate) {
          const { rows } = await ctx.rest.getAll<Record<string, unknown>>(t.table, [`select=${qc(t.date)}`, like, textDateLoose(t.date, since, ctx.today), t.hidden || ""].filter(Boolean).join("&"), { max: 5000 });
          return { label: t.label, count: rows.filter((r) => inYmd(r[t.date], since, ctx.today)).length };
        }
        return { label: t.label, count: await ctx.rest.count(t.table, [like, `${qc(t.date)}=gte.${since}`, t.hidden || ""].filter(Boolean).join("&")) };
      }
      catch (e) { return { label: t.label, count: null, error: errText(e) }; }
    })),
  ]);
  const teams = topCounts(workin.map((w) => teamLetter(w.team)), 3);
  const strong = master.filter((m) => vendorKey(m.name) === key).length === 1 || alias.length > 0;
  return ctx.mask({
    query: name,
    master: master.map((m) => ({ code: str(m.code), name: str(m.name), aliases: clip(m.aliases, 160), devices: m.device_count ?? null })),
    aliasCodes: [...new Set(alias.map((a) => str(a.code)))],
    workin: workin.map((w) => ({ name: str(w.name), team: teamLetter(w.team), kind: str(w.kind), label: str(w.label), quarter: w.quarter ?? null })),
    team: teams[0]?.key || "",
    recentCounts: counts,
    ...(strong ? { hint: "업체 하나로 좁혀졌습니다 — 이 업체 하나의 깊은 질문이면 업체 질문(업체 360)으로 다시 물으면 더 정확합니다." } : {}),
    ...(errors.length ? { partial: errors } : {}),
    note: "최근 기록 수 = 최근 365일, 업체 이름 부분 일치(같은 글자가 든 다른 업체가 섞일 수 있음).",
  });
}

/* ───────────── T11 사진 요약 ───────────── */

/** 순수 — 앨범 행(urls 는 세기만) → 요약 */
export function summarizeAlbums(rows: Array<Record<string, unknown>>, roster?: RosterRow[], team?: string) {
  const photos = (r: Record<string, unknown>) => (Array.isArray(r.urls) ? (r.urls as unknown[]).length : 0);
  const byAuthor = new Map<string, { albums: number; photos: number }>();
  for (const r of rows) { const a = str(r.author) || "(작성자 없음)"; const x = byAuthor.get(a) || { albums: 0, photos: 0 }; x.albums += 1; x.photos += photos(r); byAuthor.set(a, x); }
  const members = roster && team ? roster.filter((m) => m.team === team && m.title !== "팀장").map((m) => m.name) : [];
  return {
    albums: rows.length,
    photos: rows.reduce((n, r) => n + photos(r), 0),
    byCategory: topCounts(rows.map((r) => str(r.category) || "(분류 없음)"), 12),
    byAuthor: [...byAuthor.entries()].map(([author, v]) => ({ author, ...v })).sort((a, b) => b.albums - a.albums).slice(0, 40),
    topVendors: topCounts(rows.map((r) => str(r.vendor)), 10),
    ...(members.length ? { membersWithoutAlbums: members.filter((m) => !byAuthor.has(m)) } : {}),
    recent: [...rows].sort((a, b) => (str(a.created_at) < str(b.created_at) ? 1 : -1)).slice(0, 10).map((r) => ({ album_id: str(r.id), date: ymdOf(r.created_at), vendor: str(r.vendor), category: str(r.category), author: str(r.author), photos: photos(r) })),
  };
}

export async function photoSummary(args: AskToolArgs, ctx: AskToolCtx) {
  try {
    const { from, to } = dateRange(args.from, args.to, ctx.today);
    const team = teamArg(args.team);
    const parts = ["select=id,vendor,category,author,region,source_type,created_at,urls", `created_at=gte.${from}`, `created_at=lt.${addDays(to, 1)}`];
    if (str(args.vendor)) parts.push(`vendor=ilike.${enc(`*${str(args.vendor)}*`)}`);
    if (str(args.author)) parts.push(`author=eq.${enc(str(args.author))}`);
    if (str(args.category)) parts.push(`category=ilike.${enc(`*${str(args.category)}*`)}`);
    const [{ rows, truncated }, roster] = await Promise.all([
      ctx.rest.getAll<Record<string, unknown>>("photo_albums", parts.join("&"), { max: 6000, orderBy: "created_at" }),
      team ? loadRoster(ctx) : Promise.resolve(undefined),
    ]);
    const scoped = team && roster ? rows.filter((r) => { const p = roster.find((m) => m.name === str(r.author)); return p ? p.team === team : teamLetter(r.region) === team; }) : rows;
    return ctx.mask({
      from, to, team: team || "전체", ...summarizeAlbums(scoped, roster, team || undefined), ...(truncated ? { truncated: true } : {}),
      note: "사진 주소는 주지 않는다 — 앨범 id 로 앱 사진 뷰어에서 연다. 기간 = 앨범 올린 날(created_at).",
    });
  } catch (e) { return toolError(e); }
}
