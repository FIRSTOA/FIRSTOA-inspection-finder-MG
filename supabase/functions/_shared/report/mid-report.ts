/**
 * 중간보고 본문 — 화면 [📋 중간보고](src/CsAsWorkspace.tsx)와 엣지 자동 중간보고(schedule-report)가 같은 글을 만든다(2026-10-31 이사).
 * 예전에는 컴포넌트 안 두 함수(buildMidReport·composeMidReport)가 같은 필터를 두 벌 적었다 — 여기 하나로 합쳤다.
 * tests/midReport.golden.test.ts 가 옮기기 전 글을 글자 단위로 지킨다.
 *
 * 양식(팀 관행):
 *   "12:00 중간보고 / --- / 금일 처리예정 / #이름 / •업체 기종 내용 … / --- / 익일일정 / •…"
 * 규칙: 완료된 건은 자동으로 빠진다(완료 여부를 눈으로 대조하던 일이 이 기능의 이유).
 *       오늘 연기 처리한 건은 '익일일정'에 → 날짜와 함께.
 * 2026-10-31 사용자 결정(Q2): "(진행중인 업무는 * 표시)" 줄과 "특이사항" 칸은 뺀다 — 자동 글에선 늘 비고,
 *       특이사항은 사람이 방에서 복사해 고친다(거의 없음). 화면 글도 같은 틀(같은 함수)이라 함께 빠진다.
 *
 * 날짜·머리 시각은 전부 인자로 받는다 — 서버(UTC)에서 브라우저 현지 시각을 쓰면 9시간 틀린다.
 * Deno·Vite 둘 다 읽으므로 외부 import 없이 _shared 안의 순수 함수만 쓴다.
 */
import { escapeRegExp, extractCategory, extractIssue, groupReportTickets, hasReportMember, reportHeadOf } from "./assignee-rules.ts";
import { historyCoreName } from "../vendor-core.ts";
import { fieldTicketVendor, logisticsTicketInfo } from "../ticket-title.ts";
import { nextBusinessDay, type KstNow } from "../kr-holidays.ts";
import { reportOrderFromMembers, type MemberLike, type ReportTeam } from "./team-order.ts";

export const REPORT_SEP = "-------------------"; // 중간보고 구분선 — 카톡에서 섹션이 끊어 읽히게

/** 보고에 쓰는 as_tickets 열만 */
export type ReportTicket = {
  team: string;
  date: string;
  status: string;
  scheduleType: string;
  source?: string;
  vendor: string;
  calendarTitle?: string;
  note?: string;
  issue: string;
  model: string;
  assignee: string;
};

/** report-polish(AI 다듬기)에 넘기는 한 줄 재료 */
export type PolishLineInput = { vendor: string; title: string; note: string; model: string; issue: string; category: string; kind: "물류" | "as" };

export type MidReportDay = "today" | "next";

export type MidReportPlan<T extends ReportTicket> = {
  /** 금일(또는 익일스케줄) 처리예정 — 사람별 묶음을 펼친 것(2명 일정은 두 번) */
  pending: Array<{ name: string; ticket: T }>;
  /** 익일일정(day=today 만) */
  tomorrows: T[];
  /** 모레 이후로 연기한 건(day=today 만) */
  deferredLater: T[];
  /** 규칙 기반 초안 — AI 실패 때 대체본 */
  draft: string;
  /** AI 다듬기 재료 — pending → tomorrows → deferredLater 순서 */
  payload: PolishLineInput[];
  /** AI 가 돌려준 줄을 같은 틀에 끼운다. 개수 불일치·빈 줄이면 null(→ 초안을 쓴다) */
  assemble: (lines: unknown) => string | null;
  /** 처리예정이 0건일 때 단계별 건수(화면 진단 줄) */
  diag?: string;
  /** 오늘 보고 대상 일정 수(완료 포함) — 0 이면 자동 발송은 'empty' */
  eligibleTodayCount: number;
  /** 머리 시각을 뺀 초안의 해시 — 차수끼리 변동 비교용(AI 문장은 매번 달라 못 쓴다) */
  draftHash: string;
};

export type MidReportOptions<T extends ReportTicket> = {
  /** 전 팀 일정(진단 줄이 전체 건수를 센다) — 팀 거르기는 여기서 한다 */
  tickets: T[];
  team: string;
  /** 보고 순서(팀장 → 자기 팀 → 지원 인원) — team-order.ts reportOrderOf */
  order: string[];
  todayYmd: string;
  tomorrowYmd: string;
  day?: MidReportDay;
  /** 머리 시각 "12:00" — 화면은 누른 시각, 서버는 차수 고정 */
  stamp: string;
  /** 익일스케줄(day=next) 각 건 아래 연락처·주소 줄 — 화면만 넘긴다 */
  detailOf?: (ticket: T) => string[];
};

const isLogistics = (t: ReportTicket) => t.scheduleType === "납품철수교체휴가교육" || t.scheduleType === "물류";
const cut = (value: string, max: number) => (value.length > max ? `${value.slice(0, max)}…` : value);
// 기종 초단축: 괄호 별명("헤라클래스")이 있으면 그것, 없으면 브랜드 접두를 뗀 짧은 표기
const shortModel = (model: string) => {
  const nick = model.match(/\(([가-힣A-Za-z0-9]{2,8})\)/)?.[1];
  if (nick) return nick;
  return cut(model.replace(/^(SL-|APEOS-|ApeosPort-?V?\s*|ECOSYS-|DocuCentre-?V?\s*|DocuPrint-?)/i, "").trim(), 9);
};
const DEFER_MARK = /\(\d{1,2}\/\d{1,2}로 연기\)/;
const mdOf = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;

/** 규칙 기반 한 줄 "•업체 기종 [구분] 내용" */
export function reportLineOf(ticket: ReportTicket, order: string[]): string {
  // 납품·철수: 고객사 + 품목(괄호 설명 제거) + 구분만 — "•뉴트리원 노트북 2대 납품"
  if (isLogistics(ticket)) {
    const info = logisticsTicketInfo((ticket.calendarTitle || "").trim() || ticket.vendor, ticket.note || ""); // 품목은 전체 제목에만 있다(vendor 는 고객사만, 2026-10-24)
    if (info.vendor) {
      const item = info.item.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
      return `•${cut(historyCoreName(info.vendor) || info.vendor, 12)} ${cut(item, 14)} ${info.category}`.replace(/\s+/g, " ").trim();
    }
  }
  // 업체명: 법인표기·위치 꼬리를 벗긴 핵심 이름만. 줄 머리에서 떼어낼 이름표 — 배정 칸 원문("김A,이B"), 없으면 제목 추정 1명
  const name = reportHeadOf(ticket, order);
  // "A/S"의 슬래시는 구분자가 아니다 — 잠깐 다른 글자로 바꿔 보호하고 자른 뒤 되돌린다
  let raw = ticket.vendor.replace(/A\/S/g, "A\u2044S").split(/\s*>\s*/)[0].split("/")[0].replace(/A\u2044S/g, "A/S");
  if (name) raw = raw.replace(new RegExp(`^\\s*${escapeRegExp(name)}\\s*[-–—:\\s]*`), "");
  const vendor = cut(historyCoreName(raw) || fieldTicketVendor(raw).vendor || raw.trim(), 12);
  const issue = extractIssue(ticket.issue, ticket.note).replace(/\s+/g, " ");
  const category = extractCategory(ticket.vendor, ticket.calendarTitle, name);
  return ["•" + vendor, ticket.model ? shortModel(ticket.model) : "", category, cut(issue, 14)].filter(Boolean).join(" ");
}

/** 본문 틀 — 초안·AI 조립이 같은 틀을 쓴다 */
function frame(day: MidReportDay, stamp: string, groups: string[], tomorrowLines: string[]): string {
  // 익일스케줄 양식 확정(2026-08-28): 머리말 한 줄 + 이름 그룹만 — 시각·구분선 없이 짧게
  if (day === "next") return ["익일 스케줄", "", ...(groups.length ? groups : ["없음"])].join("\n");
  return [
    `${stamp} 중간보고`,
    "",
    REPORT_SEP,
    "금일 처리예정",
    "",
    ...(groups.length ? groups : ["없음"]),
    "",
    REPORT_SEP,
    "익일일정",
    "",
    // 익일 일정이 0건이어도 제목만 덩그러니 두지 않고 "없음"(팀장 결정 2026-10-31 — 자동 발송 글이 끊긴 것처럼 보이지 않게)
    ...(tomorrowLines.length ? tomorrowLines : ["없음"]),
  ].join("\n");
}

/** 짧은 해시(FNV-1a 32bit, 16진 8자리) — Deno·브라우저 둘 다 동기로 */
export function textHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** 머리 시각 줄을 뺀 초안의 해시 */
export function midReportDraftHash(draft: string): string {
  return textHash(draft.split("\n").slice(1).join("\n"));
}

/**
 * 중간보고 계획 — 대상 거르기·사람별 묶음·익일·연기 꼬리·초안·AI 재료·AI 조립을 한 번에.
 * 대상: 그 팀 · vendor 에 휴가/연차 없음 · 휴가·매월점검 아님 · autoplan 아님(자동일정 점검 동선은 개인 계획).
 */
export function buildMidReportPlan<T extends ReportTicket>(opts: MidReportOptions<T>): MidReportPlan<T> {
  const { tickets, team, order, todayYmd, tomorrowYmd, stamp, detailOf } = opts;
  const day: MidReportDay = opts.day || "today";
  const targetYmd = day === "next" ? tomorrowYmd : todayYmd;
  const details = (ticket: T) => (day === "next" && detailOf ? detailOf(ticket) : []);
  const eligible = tickets.filter((ticket) =>
    ticket.team === team && !/휴가|연차/.test(ticket.vendor) && ticket.scheduleType !== "휴가"
    && ticket.source !== "autoplan" && ticket.scheduleType !== "매월점검");
  // 담당자가 아직 없는 건 — "#미배정"으로 묶어 빠뜨리지 않는다. CS 명단 밖 사람만 걸린 건은 그쪽(물류 인원) 몫이라 뺀다.
  // 금일 보고는 이름 없는 납품을 뺀다(물류 몫). 익일 보고는 물류까지 전부 — 누락을 눈으로 잡아 직접 지우는 쪽이 안전하다(2026-08-28 요청)
  const todayTeam = eligible.filter((ticket) => ticket.date === targetYmd && ticket.status !== "완료");
  const dayGroups = groupReportTickets(todayTeam, order, (ticket) => day === "next" || !isLogistics(ticket));
  const pending = dayGroups.flatMap((group) => group.tickets.map((ticket) => ({ name: group.name, ticket })));
  // 익일일정 — 다음 영업일에 잡힌 팀 일정 전부(누가 갈지 아직 모르니 이름 없이). 이름 없는 납품은 물류 몫이라 금일과 같은 기준으로 뺀다.
  // 익일스케줄 보고에는 익일일정·연기 꼬리 섹션이 없다 — 본문이 곧 익일이다
  const tomorrows = day === "next" ? [] : eligible.filter((ticket) =>
    ticket.date === tomorrowYmd && ticket.status !== "완료" && (!isLogistics(ticket) || hasReportMember(ticket, order)));
  // 모레 이후(주말 포함)로 연기한 건 — 연기 기록 "(M/D로 연기)"가 남아 있으면 연기 이력으로 본다.
  const deferredLater = day === "next" ? [] : eligible.filter((ticket) =>
    ticket.date > todayYmd && ticket.date !== tomorrowYmd && ticket.status !== "완료"
    && DEFER_MARK.test(ticket.note || ""));

  // 규칙 기반 초안
  const groups: string[] = [];
  for (const { name, tickets: mine } of dayGroups) {
    if (groups.length) groups.push("");   // 이름 사이 빈 줄 — 카톡에서 사람별로 끊어 읽힌다
    groups.push(`#${name}`, ...mine.flatMap((t) => [reportLineOf(t, order), ...details(t)]));
  }
  const draft = frame(day, stamp, groups, [
    ...tomorrows.map((t) => reportLineOf(t, order)),
    ...deferredLater.map((ticket) => `${reportLineOf(ticket, order)} → ${mdOf(ticket.date)}`),
  ]);

  // 진단 줄 — "왜 안 뜨지?"를 원격으로 잡기 위한 단계별 건수
  const todayAll = tickets.filter((ticket) => ticket.date === targetYmd && ticket.status !== "완료");
  const diag = pending.length ? undefined
    : `${day === "next" ? "익일" : "오늘"} ${targetYmd} · 전체 ${todayAll.length}건 → ${team}팀 ${todayTeam.length}건 → 이름매칭 0건 · 명단 ${order.join("·")}`;

  const payload: PolishLineInput[] = [...pending.map((entry) => entry.ticket), ...tomorrows, ...deferredLater].map((ticket) => ({
    vendor: ticket.vendor,
    title: ticket.calendarTitle || "",
    note: (ticket.note || "").split(/\n/).slice(0, 3).join(" ").slice(0, 240),
    model: ticket.model,
    issue: extractIssue(ticket.issue, ticket.note),
    category: extractCategory(ticket.vendor, ticket.calendarTitle, reportHeadOf(ticket, order)),
    kind: isLogistics(ticket) ? "물류" : "as",
  }));

  const assemble = (lines: unknown): string | null => {
    // 개수 불일치(edge는 40건까지만 다듬는다)·빈 줄이면 통째로 초안 폴백 — "•undefined" 방지
    if (!Array.isArray(lines) || lines.length !== payload.length
      || lines.some((line) => typeof line !== "string" || !line.trim())) return null;
    let index = 0;
    const out: string[] = [];
    for (const name of [...order, "미배정"]) {
      const mine = pending.filter((entry) => entry.name === name);
      if (!mine.length) continue;
      if (out.length) out.push("");   // 이름 사이 빈 줄
      out.push(`#${name}`, ...mine.flatMap((entry) => [`•${lines[index++]}`, ...details(entry.ticket)]));
    }
    return frame(day, stamp, out, [
      ...tomorrows.map(() => `•${lines[index++]}`),
      ...deferredLater.map((ticket) => `•${lines[index++]} → ${mdOf(ticket.date)}`),
    ]);
  };

  return {
    pending, tomorrows, deferredLater, draft, payload, assemble, diag,
    eligibleTodayCount: eligible.filter((ticket) => ticket.date === todayYmd).length,
    draftHash: midReportDraftHash(draft),
  };
}

/** as_tickets 행(REST, null 섞임) → 보고 재료. 빈 칸은 "" 로 */
export function toReportTicket(row: Record<string, unknown>): ReportTicket {
  const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  return {
    team: s(row.team), date: s(row.date).slice(0, 10), status: s(row.status), scheduleType: s(row.scheduleType),
    source: s(row.source), vendor: s(row.vendor), calendarTitle: s(row.calendarTitle), note: s(row.note),
    issue: s(row.issue), model: s(row.model), assignee: s(row.assignee),
  };
}

/** 자동 발송 차수 — "12"·"14" 는 머리 시각 고정(크론이 12:00:03 에 돌아도 "12:00"), "now" 는 지금 KST */
export type MidReportSlot = "12" | "14" | "now";

export function midReportStamp(slot: MidReportSlot, nowKst: KstNow): string {
  if (slot === "12") return "12:00";
  if (slot === "14") return "14:00";
  return `${nowKst.hh}:${nowKst.mm}`;
}

export type MidReportTextArgs = {
  /** as_tickets 행(그 팀만이든 전 팀이든) — toReportTicket 으로 정리된 것 또는 원본 행 */
  tickets: Array<ReportTicket | Record<string, unknown>>;
  /** cs_members 행(active 포함) */
  members: MemberLike[];
  /** kr-holidays.ts kstNow() — 오늘·머리 시각의 기준 */
  nowKst: KstNow;
  team: ReportTeam;
  slot: MidReportSlot;
};

/** 엣지용 — 명단·KST 날짜·차수로 오늘 중간보고 계획(초안·AI 재료·조립) */
export function midReportPlanFor(args: MidReportTextArgs): MidReportPlan<ReportTicket> {
  const tickets = args.tickets.map((row) => toReportTicket(row as Record<string, unknown>));
  return buildMidReportPlan({
    tickets,
    team: args.team,
    order: reportOrderFromMembers(args.team, args.members),
    todayYmd: args.nowKst.ymd,
    tomorrowYmd: nextBusinessDay(args.nowKst.ymd),
    day: "today",
    stamp: midReportStamp(args.slot, args.nowKst),
  });
}

/** 엣지용 — 규칙 기반 오늘 중간보고 글(AI 없이). AI 를 쓰려면 midReportPlanFor → polishReportLines → plan.assemble */
export function buildMidReportText(args: MidReportTextArgs): string {
  return midReportPlanFor(args).draft;
}
