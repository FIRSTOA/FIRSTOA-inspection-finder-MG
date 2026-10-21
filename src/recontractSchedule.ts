/**
 * 재계약 "다음 확인일" → 일정(as_tickets 1행 + 네이버 캘린더 미러) 만들기 — 순수 로직 + 저장 흐름.
 * 설계: docs/tasks/recontract-next-check.md (D1 "AS" · D2 기본 익일통합as · D4 [옮기기] · D5 요약+원문 · D6 테스트 모드 · D7 팀 시각)
 *
 * - 같은 재계약 건(_dupKey)은 항상 같은 일정 id(rc-…) + 같은 네이버 stableKey → 몇 번 눌러도 1일정.
 * - 일정리스트(as_tickets)가 원본, 네이버는 미러 — 원본 저장이 실패하면 네이버는 부르지 않는다.
 * - Supabase 는 supabase.ts 래퍼만 쓴다.
 */
import { getConfig, invokeEdgeFunction, isTestModeValue, selectRows, updateRows, upsertRow } from "./supabase";
import { nextBusinessDay } from "./planDate";
import { regionLetter } from "./region";
import { fieldTicketVendor, vendorMatchKey } from "./ids";
import { md5 } from "./md5";

// ───────────── 날짜 도우미 (YYYY-MM-DD, 시간대 무관 계산) ─────────────
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function isYmd(value: unknown): value is string {
  const v = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const toUtc = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fromUtc = (dt: Date) => dt.toISOString().slice(0, 10);

export function weekdayKo(ymd: string): string { return isYmd(ymd) ? WEEKDAYS[toUtc(ymd).getUTCDay()] : ""; }

/** 카톡·내용용 "2026-10-29(목)". 날짜가 아니면 그대로 돌려준다(옛 글자값 "차주 중"). */
export function formatYmdKo(value: string): string { return isYmd(value) ? `${value}(${weekdayKo(value)})` : String(value ?? ""); }

/** 칸·칩 표시용 "10/29(목)". */
export function formatYmdShort(value: string): string {
  if (!isYmd(value)) return String(value ?? "");
  const [, m, d] = value.split("-").map(Number);
  return `${m}/${d}(${weekdayKo(value)})`;
}

export function addDaysYmd(ymd: string, days: number): string { const dt = toUtc(ymd); dt.setUTCDate(dt.getUTCDate() + days); return fromUtc(dt); }

/** 달 더하기 — 말일 넘침은 그 달 말일로(1/31 + 1달 = 2/28). */
export function addMonthsYmd(ymd: string, months: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return fromUtc(new Date(Date.UTC(y, m - 1 + months, Math.min(d, last))));
}

export type DateChip = { label: string; ymd: string };

/** 빠른 선택 칩(D3): 익일(영업일 보정)·+3일·+1주·+2주·+1달·+3달(달력 그대로). */
export function nextCheckChips(today: string): DateChip[] {
  return [
    { label: "익일", ymd: nextBusinessDay(today) },
    { label: "+3일", ymd: addDaysYmd(today, 3) },
    { label: "+1주", ymd: addDaysYmd(today, 7) },
    { label: "+2주", ymd: addDaysYmd(today, 14) },
    { label: "+1달", ymd: addMonthsYmd(today, 1) },
    { label: "+3달", ymd: addMonthsYmd(today, 3) },
  ];
}

// ───────────── 팀·담당·내용 ─────────────
export const SCHEDULE_TEAMS = ["A", "B", "C", "D", "E"] as const;
/** 팀 시각(D7) — 웹캘린더 팀 필터·네이버 팀 추정이 이 시각으로 돈다(CsAsWorkspace TEAM_SLOT 과 같은 값). */
export const TEAM_TIME: Record<string, string> = { A: "09:00", B: "12:00", C: "15:00", D: "18:00", E: "21:00" };

/** 양식 지역 → 없으면 작성자 팀(명단) → 그래도 없으면 "" (확인창에서 고르게). */
export function teamForRecontract(form: Record<string, string>, author: string, book: Partial<Record<string, string[]>> = {}): string {
  const fromForm = regionLetter(String(form["지역"] || ""));
  if (fromForm) return fromForm;
  const who = String(author || "").trim();
  if (!who) return "";
  return SCHEDULE_TEAMS.find((t) => (book[t] || []).includes(who)) || "";
}

/** 후속담당자가 명단에 있는 이름이면 그 이름, 아니면 작성자. */
export function assigneeForRecontract(form: Record<string, string>, author: string, names: string[]): string {
  const follow = String(form["후속담당자"] || "").trim();
  return follow && names.includes(follow) ? follow : String(author || "").trim();
}

export function vendorOf(form: Record<string, string>): string { return String(form["업체명"] || "").trim(); }

export function defaultScheduleTitle(vendor: string, testMode: boolean): string {
  const base = `[재계약 확인] ${vendor}`.trim();
  return testMode ? `[테스트] ${base}` : base;
}

/** 내용 기본 문장(3-3) — 빈 값은 빼고, 아래에 카톡 전송 원문 전체(D5). */
export function buildRecontractSummary(form: Record<string, string>, author: string, ymd: string, text: string, writtenOn = ""): string {
  const v = (k: string) => String(form[k] || "").trim();
  const join = (parts: Array<[string, string]>, sep: string) => parts.filter(([, val]) => val).map(([label, val]) => `${label}: ${val}`).join(sep);
  const lines = [
    `[재계약 확인] ${vendorOf(form)} · 다음 확인일 ${formatYmdKo(ymd)}`,
    join([["갱신 상태", v("갱신상태")], ["위험도", v("갱신위험도")], ["고객 반응", v("고객반응현황")]], " / "),
    join([["계약 종료일", v("계약종료일")], ["월 렌탈료", v("월렌탈료")]], " · "),
    join([["제안 조건", v("제안조건")]], ""),
    join([["갱신 방향", v("갱신방향")]], ""),
    join([["내부 협의", v("내부협의")]], ""),
    join([["후속 담당", v("후속담당자")], ["기한", v("기한")]], " · "),
    join([["관리 포인트", v("관리포인트")]], ""),
    `— 작성 ${[String(author || "").trim(), writtenOn].filter(Boolean).join(" ")} (FIELD 재계약)`,
  ].filter(Boolean);
  const raw = String(text || "").trim();
  return raw ? `${lines.join("\n")}\n\n— 전송 원문 —\n${raw}` : lines.join("\n");
}

/** 같은 재계약 건 = 같은 일정 id. dupKey 가 없으면 양식 내용으로 만든다(같은 내용이면 같은 id). */
export function recontractTicketId(dupKey: string, form: Record<string, string> = {}): string {
  const key = String(dupKey || "").trim() || md5(JSON.stringify(Object.keys(form).sort().map((k) => [k, form[k]])));
  return `rc-${key.slice(0, 20)}`;
}

export type RecontractScheduleInput = {
  dupKey: string;
  form: Record<string, string>;
  author: string;
  testMode: boolean;
  date: string;
  team: string;
  title: string;
  address: string;
  note: string;
  assignee: string;
};

/** as_tickets 1행(3-2). naverUid 는 넣지 않는다 — 다시 저장(merge)해도 이미 붙은 네이버 연결을 지우지 않게. */
export function buildRecontractTicket(input: RecontractScheduleInput): Record<string, unknown> {
  const f = input.form;
  const title = input.title.trim();
  return {
    id: recontractTicketId(input.dupKey, f),
    team: input.team, date: input.date, time: TEAM_TIME[input.team] || "09:00",
    vendor: vendorOf(f), contact: String(f["담당자"] || "").trim(),
    address: input.address.trim(), department: "",
    model: String(f["기종"] || "").trim(), serial: "", asset: "", grade: String(f["등급"] || "").trim(), keyman: "",
    issue: "재계약 확인 (FIELD 재계약에서 등록)",
    calendarTitle: (input.testMode && !title.startsWith("[테스트]") ? `[테스트] ${title}` : title).slice(0, 120),
    note: input.note,
    assignee: input.assignee, status: "배정", scheduleType: "AS", source: "recontract", receptionId: "",
  };
}

/** 입력 검사 — 빈 문자열이면 통과. */
export function validateScheduleInput(input: Pick<RecontractScheduleInput, "date" | "team" | "title">, today: string): string {
  if (!isYmd(input.date)) return "날짜를 골라 주세요";
  if (input.date < today) return "오늘 이후 날짜만 일정으로 만들 수 있습니다";
  if (!(SCHEDULE_TEAMS as readonly string[]).includes(input.team)) return "팀(A~E)을 골라 주세요";
  if (!input.title.trim()) return "제목을 적어 주세요";
  return "";
}

// ───────────── 대기 중인 제안(기기 안, 24시간) ─────────────
export const SCHEDULE_OFFER_KEY = "recontract_schedule_offer_v1";
export const SCHEDULE_OFFER_TTL_MS = 24 * 60 * 60 * 1000;
export type ScheduleOffer = { dupKey: string; form: Record<string, string>; author: string; text: string; testMode: boolean; at: number };

/** 보낸 양식이 재계약이고 다음확인일이 날짜일 때만 묻는다(빈 값·글자값이면 안 물음). */
export function shouldOfferSchedule(d: { schemaKey: string; form: Record<string, string> }): boolean {
  return d.schemaKey === "recontract" && isYmd(String(d.form?.["다음확인일"] || ""));
}

const storage = (): Storage | null => { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } };

export function saveScheduleOffer(offer: ScheduleOffer): void {
  try { storage()?.setItem(SCHEDULE_OFFER_KEY, JSON.stringify(offer)); } catch (e) { console.warn("일정 제안 보관 실패", e); }
}

export function readScheduleOffer(now = Date.now()): ScheduleOffer | null {
  const s = storage();
  if (!s) return null;
  let o: ScheduleOffer | null = null;
  try { o = JSON.parse(s.getItem(SCHEDULE_OFFER_KEY) || "null") as ScheduleOffer | null; } catch { o = null; }
  const valid = Boolean(o && typeof o === "object" && o.form && typeof o.at === "number" && now - o.at <= SCHEDULE_OFFER_TTL_MS
    && shouldOfferSchedule({ schemaKey: "recontract", form: o.form }));
  if (!valid) { try { s.removeItem(SCHEDULE_OFFER_KEY); } catch { /* 지울 수 없으면 다음 읽기에서도 무효로 걸러진다 */ } return null; }
  return o;
}

/** dupKey 를 주면 같은 건일 때만 지운다(다른 건 제안이 새로 들어와 있으면 남김). */
export function clearScheduleOffer(dupKey?: string): void {
  const s = storage();
  if (!s) return;
  try {
    if (dupKey) {
      const cur = JSON.parse(s.getItem(SCHEDULE_OFFER_KEY) || "null") as ScheduleOffer | null;
      if (cur && cur.dupKey !== dupKey) return;
    }
    s.removeItem(SCHEDULE_OFFER_KEY);
  } catch { /* 저장소 접근 불가 — 24시간 뒤 자동 무효 */ }
}

// ───────────── 저장 흐름 (5절) ─────────────
export type OpenRecontractTicket = { id: string; vendor: string; date: string; time?: string; note?: string; naverUid?: string; issue?: string; status?: string };
export type NaverJob =
  | { kind: "push"; ticketId: string; title: string; date: string; time: string; location: string; description: string }
  | { kind: "update"; uid: string; date: string; time: string; description: string };
export type NaverState = "ok" | "off" | "test" | "none" | "failed";
export type ScheduleResult =
  | { kind: "duplicate"; existing: OpenRecontractTicket[] }
  | { kind: "created" | "moved"; ticketId: string; date: string; naver: NaverState; naverError?: string; naverJob?: NaverJob };
export type ScheduleChoice = "auto" | "new" | { moveId: string };

export const naverEnabledOf = (cfg: Record<string, string>) => /^(true|1|on|y)$/i.test(String(cfg.NAVER_CALENDAR_ENABLED || ""));

/** 같은 업체의 열린 재계약 일정(완료 아님 · issue "재계약…" · 오늘-30일 이후, 워킨맵 등록분 포함). 자기 id 는 뺀다. */
export async function findOpenRecontractTickets(vendor: string, selfId: string, today: string): Promise<OpenRecontractTicket[]> {
  const key = vendorMatchKey(vendor);
  if (key.length < 2) return [];
  const enc = encodeURIComponent;
  const rows = await selectRows<OpenRecontractTicket>("as_tickets",
    `select=id,vendor,date,time,note,naverUid,issue,status&status=neq.${enc("완료")}&issue=like.${enc("재계약*")}&date=gte.${addDaysYmd(today, -30)}&order=date.asc&limit=500`);
  return rows.filter((t) => t.id !== selfId && vendorMatchKey(fieldTicketVendor(t.vendor).vendor || t.vendor) === key);
}

/** 네이버 미러 한 번 — push 면 받은 uid 를 일정에 붙인다. 같은 stableKey 라 다시 불러도 네이버 1건. */
export async function runNaverJob(job: NaverJob): Promise<void> {
  if (job.kind === "update") {
    await invokeEdgeFunction("naver-calendar-push", { action: "caldav_update", uid: job.uid, date: job.date, time: job.time, description: job.description });
    return;
  }
  const r = await invokeEdgeFunction<{ uid?: string }>("naver-calendar-push", {
    stableKey: job.ticketId, title: job.title, date: job.date, time: job.time, location: job.location, description: job.description,
  });
  if (!r?.uid) throw new Error("네이버 응답에 일정 번호가 없습니다");
  try {
    await updateRows("as_tickets", `id=eq.${encodeURIComponent(job.ticketId)}`, { naverUid: r.uid, naverPushedAt: new Date().toISOString() });
  } catch (e) {
    throw new Error(`네이버 연결 저장 실패: ${(e as Error).message}`);
  }
}

async function mirror(job: NaverJob | null, testMode: boolean): Promise<{ naver: NaverState; naverError?: string; naverJob?: NaverJob }> {
  if (!job) return { naver: "none" };
  if (testMode) return { naver: "test" };
  let cfg: Record<string, string>;
  try { cfg = await getConfig(); } catch (e) { return { naver: "failed", naverError: (e as Error).message, naverJob: job }; }
  if (isTestModeValue(cfg.TEST_MODE)) return { naver: "test" }; // 보낸 뒤 테스트 모드로 바뀐 경우도 네이버는 건드리지 않는다(D6)
  if (!naverEnabledOf(cfg)) return { naver: "off" };
  try { await runNaverJob(job); return { naver: "ok" }; } catch (e) { return { naver: "failed", naverError: (e as Error).message, naverJob: job }; }
}

/**
 * 일정 만들기. 일정(as_tickets) 저장이 실패하면 throw — 호출부가 오류 토스트·제안 유지.
 * 네이버만 실패하면 throw 하지 않고 naver "failed" + naverJob(다시 시도용)을 돌려준다.
 */
export async function createRecontractSchedule(input: RecontractScheduleInput, choice: ScheduleChoice, today: string): Promise<ScheduleResult> {
  const bad = validateScheduleInput(input, today);
  if (bad) throw new Error(bad);
  const row = buildRecontractTicket(input);
  const ticketId = String(row.id);
  const time = String(row.time);

  if (choice === "auto") {
    const existing = await findOpenRecontractTickets(vendorOf(input.form), ticketId, today);
    if (existing.length) return { kind: "duplicate", existing };
  }

  if (typeof choice === "object") {
    const rows = await selectRows<OpenRecontractTicket>("as_tickets", `select=id,vendor,date,time,note,naverUid&id=eq.${encodeURIComponent(choice.moveId)}&limit=1`);
    const target = rows[0];
    if (!target) throw new Error("옮길 일정을 찾지 못했습니다 — 이미 지워졌을 수 있습니다");
    const note = target.note ? `${input.note}\n\n— 이전 내용 —\n${target.note}` : input.note;
    await updateRows("as_tickets", `id=eq.${encodeURIComponent(target.id)}`, { date: input.date, time, team: input.team, note });
    const job: NaverJob | null = target.naverUid ? { kind: "update", uid: target.naverUid, date: input.date, time, description: note } : null;
    return { kind: "moved", ticketId: target.id, date: input.date, ...(await mirror(job, input.testMode)) };
  }

  await upsertRow("as_tickets", row, "id");
  const job: NaverJob = {
    kind: "push", ticketId, title: String(row.calendarTitle), date: input.date, time,
    location: String(row.address || ""), description: input.note,
  };
  return { kind: "created", ticketId, date: input.date, ...(await mirror(job, input.testMode)) };
}

/** 결과 → 사용자 문구. */
export function scheduleResultMessage(r: Exclude<ScheduleResult, { kind: "duplicate" }>): string {
  const head = r.kind === "moved" ? `일정을 ${formatYmdShort(r.date)}로 옮겼습니다` : `일정을 만들었습니다 (${formatYmdShort(r.date)})`;
  const naver = r.naver === "ok" ? "네이버 ✓" : r.naver === "off" ? "네이버 꺼짐" : r.naver === "test" ? "테스트 모드 — 네이버 안 올림" : r.naver === "none" ? "네이버 연결 없음" : "네이버 실패";
  return `${head} — 일정리스트·캘린더 ✓ / ${naver}`;
}
