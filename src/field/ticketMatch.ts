/**
 * FIELD 전송 뒤 "어느 일정을 정리할까" 고르는 순수 함수 (2026-10-27, 오류진).
 *
 * 사고: 점검 양식만 보냈는데 "AS 일정 완료할까요?"가 떴다(사용자 보고 2026-10-27).
 *  - 전송 뒤 매칭(App.tsx offerTicketMatchAfterSend)이 보낸 방(점검/AS)과 상관없이 AS 일정만 찾았고,
 *  - 날짜(최근 2주~모레)·담당자를 보지 않았고, 확인창에는 업체명 한 줄만 나왔다.
 *  - 점검 전송의 매월점검 자동 완료는 이름 "포함" 비교라 체인 지점이 서로를 닫았다
 *    (실측: rep|디쉐어|매월점검|2026-10-30(C팀 디쉐어) 가 10/15 B팀 "디쉐어김포사우점" AS 양식으로,
 *     09-30 건은 09/18 D팀 "디쉐어 태전점" 양식으로 닫힘. 업체명 "30V주식회사" 양식 하나가 다른 업체 매월점검 8건을 닫음 —
 *     옛 비교키가 "주식회사"만 남아 모든 "주식회사 …" 에 포함됐다).
 *
 * 규칙
 *  ① 종류: 점검 양식 → 매월점검(source autoplan·workin·manual·'' 모두 같은 유형), AS 양식 → AS·익일AS.
 *  ② 날짜: 오늘 → 지난 미완료(최근 순) → 예정(모레까지) 순.
 *  ③ 담당자: 같은 날짜 안에서 내 일정 먼저.
 *  ④ 2건 이상이면 고르게 한다(needsChoice). 1건이어도 확인창에 날짜·종류·담당·제목을 보인다(describeTicket).
 *  업체 일치: 양식의 기번·자산번호가 일정과 맞으면 그것만. 아니면 "같은 지점" 이름만 —
 *  법인표기만 남는 이름("30V주식회사")은 아무것과도 안 맞고, 한쪽에 더 붙은 꼬리가 지점(…점·지사·센터·현장)이면 다른 지점으로 본다.
 */
import { fieldTicketVendor, vendorMatchKey } from "../ids";

export type SentFormKind = "inspection" | "as";

export type MatchTicketRow = {
  id: string;
  vendor?: string | null;
  date?: string | null;
  status?: string | null;
  scheduleType?: string | null;
  assignee?: string | null;
  team?: string | null;
  serial?: string | null;
  asset?: string | null;
  receptionId?: string | null;
  calendarTitle?: string | null;
  issue?: string | null;
  source?: string | null;
};

export type TicketCandidate = {
  row: MatchTicketRow;
  by: "기번" | "업체명";
  when: "오늘" | "지난" | "예정";
  mine: boolean;
};

export const INSPECTION_TICKET_TYPES = ["매월점검"] as const;
export const AS_TICKET_TYPES = ["AS", "익일AS"] as const;
export const OPEN_TICKET_STATUSES = ["접수", "배정", "익일"] as const;

export function ticketTypesFor(kind: SentFormKind): readonly string[] {
  return kind === "inspection" ? INSPECTION_TICKET_TYPES : AS_TICKET_TYPES;
}

// 지점 구분과 무관한 꼬리 — 계약 표기·층·본사
const NOISE_TAIL = /(백업|합산|추가|단순|본사|본점|사옥|전체|\d+층|층)$/;
// 남는 꼬리가 이 모양이면 "다른 지점"
const BRANCH_TAIL = /(점|지점|지사|호점|센터|공장|현장|지부|본부|영업소|캠퍼스|분원|분점|지국)$/;

/** 업체+지점 비교키 — vendorMatchKey(법인표기·등급 접두·마감 꼬리 제거) 뒤 지점과 무관한 꼬리를 벗긴다. 지점명은 남긴다. */
export function vendorBranchKey(raw: string): string {
  const name = fieldTicketVendor(String(raw || "")).vendor || String(raw || "");
  let key = vendorMatchKey(name);
  for (let i = 0; i < 4 && NOISE_TAIL.test(key); i += 1) key = key.replace(NOISE_TAIL, "");
  return key;
}

/** 두 업체명이 같은 업체·같은 지점인가. "디쉐어" vs "디쉐어김포사우점" = 아니다(다른 지점일 수 있다). */
export function sameVendorBranch(a: string, b: string): boolean {
  const ka = vendorBranchKey(a);
  const kb = vendorBranchKey(b);
  if (ka.length < 3 || kb.length < 3) return false;
  if (ka === kb) return true;
  const [short, long] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  if (!long.startsWith(short)) return false;
  // 한쪽에 더 붙은 꼬리가 지점 모양(…점·지점·지사·현장)이면 다른 지점 — "디쉐어" vs "디쉐어김포사우점".
  // 상호 길이로 막지 않는다: "엔티에스"↔"엔티에스케이투", "뉴트리원"↔"뉴트리원루터회관" 은 같은 곳으로 닫혀 왔다(9~10월 실측)
  const rest = long.slice(short.length);
  return !BRANCH_TAIL.test(rest);
}

/** 양식의 시리얼넘버·자산기번 값(5자 이상, 영숫자만 대문자) */
export function formIdKeys(formText: string): Set<string> {
  return new Set(
    Array.from(String(formText || "").matchAll(/(?:시리얼넘버|자산기번|기번|자산번호)\s*:?\s*([A-Za-z0-9-]{5,})/g))
      .map((m) => m[1].replace(/[^0-9A-Za-z]/g, "").toUpperCase())
      .filter((v) => v.length >= 5),
  );
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isAssignedTo(assignee: string | null | undefined, author: string | null | undefined): boolean {
  const me = String(author || "").trim();
  if (!me) return false;
  return String(assignee || "").split(/[,/·\s]+/).map((v) => v.trim()).filter(Boolean).includes(me);
}

export type PickOptions = {
  vendor: string;
  kind: SentFormKind;
  today: string; // KST YYYY-MM-DD
  author?: string;
  formText?: string;
  daysBack?: number; // 기본 14 — 지난 미완료
  daysAhead?: number; // 기본 2 — 하루 이틀 당겨 간 경우
};

export function pickTicketsForSentForm(tickets: MatchTicketRow[], opts: PickOptions): { candidates: TicketCandidate[]; needsChoice: boolean } {
  const types = ticketTypesFor(opts.kind);
  const from = addDays(opts.today, -(opts.daysBack ?? 14));
  const until = addDays(opts.today, opts.daysAhead ?? 2);
  const pool = tickets.filter((row) => {
    const date = String(row.date || "");
    return types.includes(String(row.scheduleType || ""))
      && (OPEN_TICKET_STATUSES as readonly string[]).includes(String(row.status || ""))
      && date >= from && date <= until;
  });
  const ids = formIdKeys(opts.formText || "");
  const idHits = ids.size
    ? pool.filter((row) => [row.serial, row.asset]
      .map((v) => String(v || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase())
      .some((v) => v.length >= 5 && ids.has(v)))
    : [];
  const hits = idHits.length ? idHits : pool.filter((row) => sameVendorBranch(String(row.vendor || ""), opts.vendor));
  const by: TicketCandidate["by"] = idHits.length ? "기번" : "업체명";
  const rank = (c: TicketCandidate) => (c.when === "오늘" ? 0 : c.when === "지난" ? 1 : 2);
  const candidates = hits.map((row): TicketCandidate => {
    const date = String(row.date || "");
    return { row, by, when: date === opts.today ? "오늘" : date < opts.today ? "지난" : "예정", mine: isAssignedTo(row.assignee, opts.author) };
  }).sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.mine !== b.mine) return a.mine ? -1 : 1;
    const da = String(a.row.date || "");
    const db = String(b.row.date || "");
    // 지난 건은 최근 것부터, 예정 건은 가까운 것부터
    return a.when === "지난" ? db.localeCompare(da) : da.localeCompare(db);
  });
  return { candidates, needsChoice: candidates.length > 1 };
}

/** 확인창·고르기 창 한 줄: "10/26(오늘) · AS · 담당 이민구 · 주식회사 질경이본사 4층 — 출력 시 검은 줄" */
export function describeTicket(c: TicketCandidate): string {
  const date = String(c.row.date || "");
  const md = date ? `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}` : "날짜 없음";
  const when = c.when === "오늘" ? "오늘" : c.when === "지난" ? "지난 미완료" : "예정";
  const who = String(c.row.assignee || "").trim();
  const vendor = fieldTicketVendor(String(c.row.vendor || "")).vendor || String(c.row.vendor || "");
  const subject = String(c.row.issue || "").split(/\r?\n/).map((s) => s.trim()).find(Boolean) || "";
  return [
    `${md}(${when})`,
    String(c.row.scheduleType || "-"),
    who ? `담당 ${who}${c.mine ? "(나)" : ""}` : "담당 미배정",
    `${vendor}${subject ? ` — ${subject.slice(0, 40)}` : ""}`,
  ].join(" · ");
}

/** 보낸 방으로 양식 종류를 정한다. 점검방 전송은 묻지 않는다(2026-08-28 결정 — 매월점검은 점검 전송 자동 완료가 맡음) → null */
export function sentFormKind(destination: string | undefined, mode: string): SentFormKind | null {
  if (destination === "inspection") return null;
  if (!destination && mode === "inspection") return null;
  return "as";
}
