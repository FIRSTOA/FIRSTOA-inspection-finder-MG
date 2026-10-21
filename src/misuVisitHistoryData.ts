// 조회 › 미수 › [방문 이력] 데이터 — 읽기·합치기·필터(화면 없음). 화면 틀은 MisuVisitHistory.view.tsx, 상태는 MisuVisitHistory.tsx.
// 설계: docs/tasks/misu-redesign.md §4-B. 판정·문장·체크리스트는 misuVisit.ts 를 그대로 쓴다(여기서 다시 만들지 않는다).
// 출처 3가지를 업체 하나로 잇는다:
//   ① misu_visits(CS 방문이력, _hidden=false)  ② misu 표의 시트 행(관리부 현재 미수 목록 — 거래처코드·_raw.임순·잔액·개월·팀)
//   ③ misu_cs_checks(관리부 CS체크). 잇는 키는 matchMisuVendor(거래처코드 > 임순 > 정규화 이름 — 이름이면 "이름으로 이어짐").
// 이전 기록(D10): misu 표의 카톡 행(2023-11~2026-06-23) + 시트 _raw 의 경영체크·전략체크·CS체크 메모 → 회색, 체크리스트엔 안 셈.
import { kstDate } from "./visits";
import { selectAllRows, selectRows, updateRows } from "./supabase";
import {
  effectiveMisuVisits, formatKstDateTime, formatMisuAmount, groupMisuVisitsByVendor, isOffHours, kstParts, matchMisuVendor,
  mergeMisuTimeline, misuVendorStatus, misuVisitLines, normMisuVendorName, PHOTO_SLOTS, PHOTO_SLOT_LABEL,
  type MisuLegacyEntry, type MisuLinkKind, type MisuVendorRef, type MisuVendorStatus, type MisuVisit,
} from "./misuVisit";
import type { MisuHistoryFilters, MisuHistoryPhoto, MisuHistoryVendor, MisuHistoryVisit } from "./MisuVisitHistory.view";

const s = (v: unknown) => String(v ?? "").trim();
const SHEET_ERROR = /^#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NULL!|ERROR!?)$/i;
type Rec = Record<string, unknown>;
const rawOf = (row: Rec): Rec => (row["_raw"] && typeof row["_raw"] === "object" ? (row["_raw"] as Rec) : {});
/** 위 칸 → _raw 순으로 읽고, 시트 오류값(#N/A 등)은 빈칸. */
function cell(row: Rec, key: string): string {
  const top = s(row[key]);
  const v = top || s(rawOf(row)[key]);
  return SHEET_ERROR.test(v) ? "" : v;
}
const digits = (v: string) => Number(v.replace(/[^\d]/g, "")) || 0;

// ───────── 표 없음 판정 ─────────
/** misu_visits SQL 실행 전: PostgREST 404 / PGRST205(스키마 캐시에 표 없음) / 42P01 */
export function isTableMissingError(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e ?? "");
  return /\(404\)|PGRST205|42P01|does not exist|Could not find the table/i.test(m);
}

// ───────── ② 시트 행(관리부 미수 목록) ─────────
export type MisuSheetVendor = {
  id: string;
  vendor: string;
  team: string; // A~E (_출처 "시트:수도권A_…")
  region: string; // 지역 칸(양주시 등)
  company_code: string;
  lease_seq: string;
  monthsNum: number;
  balanceNum: number;
  row: Rec; // 이전 기록(메모)·상세용 원본
};

/** misu 시트 행 → 업체 한 줄. 잔액·개월은 MisuBoard 와 같은 순서(미수잔액 → 실제 잔액). 업체명 없으면 null. */
export function sheetRowToVendor(row: Rec): MisuSheetVendor | null {
  const vendor = cell(row, "_업체명") || cell(row, "거래처명");
  if (!vendor) return null;
  const lease = rawOf(row)["임순"];
  return {
    id: s(row["id"]),
    vendor,
    team: s(row["_출처"]).match(/수도권([A-E])/)?.[1] || "",
    region: cell(row, "지역"),
    company_code: cell(row, "거래처코드"),
    lease_seq: lease == null || SHEET_ERROR.test(s(lease)) ? "" : s(lease),
    monthsNum: digits(cell(row, "미수개월")) || digits(cell(row, "실제 개월수")),
    balanceNum: digits(cell(row, "미수잔액")) || digits(cell(row, "실제 잔액")),
    row,
  };
}

// ───────── 이전 기록 변환 ─────────
/** 느슨한 입력일 "2026-06-22 00:00:00" → "2026-06-22", 시각이 0시가 아니면 "2026-06-22 14:20" */
function legacyAt(v: string): string {
  const t = s(v);
  const m = t.match(/^(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})(?:[\sT]+(\d{1,2}):(\d{2}))?/);
  if (!m) return t;
  const day = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return m[4] && !(Number(m[4]) === 0 && m[5] === "00") ? `${day} ${m[4].padStart(2, "0")}:${m[5]}` : day;
}

/**
 * misu 표 카톡 행(_출처 "카톡:미수(A)") → 이전 기록 한 줄.
 * 원문 머리의 "입력자: " 는 떼고, 봇 조회 답장("미수금 조회 결과입니다" — 시트 메모를 다시 읊은 것)은 null(중복이라 뺌).
 */
export function kakaoRowToLegacy(row: Rec): MisuLegacyEntry | null {
  const author = s(row["입력자"]);
  let text = s(row["원문"]) || s(row["_원문"]);
  if (!text) return null;
  if (/미수금 조회 결과/.test(text)) return null;
  if (author && text.startsWith(`${author}:`)) text = text.slice(author.length + 1).trim();
  return { at: legacyAt(s(row["입력일"]) || s(row["_등록시각"])), source: "카톡", author: author || undefined, text };
}

/** 시트 행 _raw 의 경영체크·전략체크·CS체크 메모 → 이전 기록(날짜는 마지막 체크일, 없으면 입력일). 빈 메모는 뺀다. */
export function sheetMemosToLegacy(row: Rec): MisuLegacyEntry[] {
  const at = legacyAt(cell(row, "마지막 체크일") || cell(row, "입력일"));
  const out: MisuLegacyEntry[] = [];
  for (const [col, who] of [["경영체크", "경영담당"], ["전략체크", "전략담당"], ["CS체크", "CS담당"]] as const) {
    const text = cell(row, col);
    if (!text) continue;
    out.push({ at, source: col, author: cell(row, who) || undefined, text });
  }
  return out;
}

// ───────── ①+②+③ 합치기 ─────────
export type MisuJoinedVendor = {
  key: string;
  name: string;
  team: string;
  region: string;
  company_code: string;
  lease_seq: string;
  monthsNum: number;
  balanceNum: number;
  csChecked: boolean;
  linkedBy: MisuLinkKind | null; // 방문 기록과 이어진 방식(null = 방문 없음 또는 시트 없음)
  sheet: MisuSheetVendor | null; // 관리부 목록에 없는 업체면 null
  visits: MisuVisit[]; // 이 업체 방문(숨김 제외, 최신 위)
  status: MisuVendorStatus;
};

export type MisuCsCheck = { team: string; vendor: string; checked: boolean };

const LINK_RANK: Record<MisuLinkKind, number> = { code: 0, lease: 1, name: 2 };

/**
 * 시트 업체 ∪ 방문 기록 업체. 방문 묶음(groupMisuVisitsByVendor)마다 가장 강하게 이어지는 시트 행 하나에 붙인다
 * (같은 묶음이 두 시트 행에 겹쳐 보이지 않게). 시트에 없는 방문 묶음은 따로 한 줄.
 */
export function joinMisuHistory(sheet: MisuSheetVendor[], visits: MisuVisit[], csChecks: MisuCsCheck[] = []): MisuJoinedVendor[] {
  const groups = groupMisuVisitsByVendor(visits);
  const cs = new Set(csChecks.filter((c) => c.checked).map((c) => `${s(c.team)}|${s(c.vendor)}`));
  const attached = new Map<number, { kind: MisuLinkKind; visits: MisuVisit[] }>(); // 시트 행 index → 붙은 방문
  const leftovers: typeof groups = [];
  for (const g of groups) {
    const ref: MisuVendorRef = { company_code: g.company_code, lease_seq: g.lease_seq, vendor: g.vendor };
    let best = -1;
    let bestKind: MisuLinkKind | null = null;
    sheet.forEach((sv, i) => {
      const k = matchMisuVendor({ company_code: sv.company_code, lease_seq: sv.lease_seq, vendor: sv.vendor }, ref);
      if (k && (!bestKind || LINK_RANK[k] < LINK_RANK[bestKind])) { best = i; bestKind = k; }
    });
    if (best < 0 || !bestKind) { leftovers.push(g); continue; }
    // 묶음 안이 이름으로만 이어졌으면 약한 쪽을 보여 준다
    const kind: MisuLinkKind = LINK_RANK[g.linkedBy] > LINK_RANK[bestKind] ? g.linkedBy : bestKind;
    const prev = attached.get(best);
    if (prev) { prev.visits.push(...g.visits); if (LINK_RANK[kind] > LINK_RANK[prev.kind]) prev.kind = kind; }
    else attached.set(best, { kind, visits: [...g.visits] });
  }
  const out: MisuJoinedVendor[] = sheet.map((sv, i) => {
    const a = attached.get(i);
    const vs = a ? liveSorted(a.visits) : [];
    return {
      key: `s:${sv.id || i}`, name: sv.vendor, team: sv.team, region: sv.region, company_code: sv.company_code, lease_seq: sv.lease_seq,
      monthsNum: sv.monthsNum, balanceNum: sv.balanceNum, csChecked: cs.has(`${sv.team}|${sv.vendor}`),
      linkedBy: a ? a.kind : null, sheet: sv, visits: vs, status: misuVendorStatus(vs),
    };
  });
  for (const g of leftovers) {
    const latest = g.visits[0];
    const team = s(latest?.author_team) || s(latest?.region);
    out.push({
      key: `v:${g.key}`, name: g.vendor, team: /^[A-E]$/.test(team) ? team : "", region: "", company_code: g.company_code, lease_seq: g.lease_seq,
      monthsNum: digits(s(latest?.misu_months)), balanceNum: digits(s(latest?.misu_balance)),
      csChecked: false, linkedBy: g.linkedBy, sheet: null, visits: g.visits, status: misuVendorStatus(g.visits),
    });
  }
  return out;
}
/** 숨김 뺀 원본 기록(보완 포함) 최신 위 — 타임라인·체크리스트는 각 함수가 알아서 실효 기록을 고른다. */
function liveSorted(list: MisuVisit[]): MisuVisit[] {
  return list.filter((v) => !v._hidden).sort((a, b) => s(b.visited_at).localeCompare(s(a.visited_at)) || s(b.created_at).localeCompare(s(a.created_at)));
}

// ───────── 필터·정렬 ─────────
export const DEFAULT_MISU_HISTORY_FILTERS: MisuHistoryFilters = {
  team: "전체", period: "전체", from: "", to: "", judgment: "", status: "", author: "", query: "", sort: "최근 방문순",
};

/** 기간 → KST 날짜 범위(없는 쪽은 열림). 30일 = 오늘 포함 30일. */
export function misuPeriodRange(f: Pick<MisuHistoryFilters, "period" | "from" | "to">, today = kstDate()): { from: string; to: string } {
  if (f.period === "30일" || f.period === "90일") {
    const n = f.period === "30일" ? 29 : 89;
    const d = new Date(`${today}T12:00:00+09:00`);
    d.setUTCDate(d.getUTCDate() - n);
    return { from: kstDate(d), to: "" };
  }
  if (f.period === "직접") return { from: s(f.from), to: s(f.to) };
  return { from: "", to: "" };
}

/** misu_visits 목록 조회 쿼리(숨김 제외, 방문일 최신 위). 날짜는 KST 하루 경계. */
export function misuVisitsQuery(range: { from: string; to: string }): string {
  const parts = ["select=*", "_hidden=eq.false"];
  if (/^\d{4}-\d{2}-\d{2}$/.test(range.from)) parts.push(`visited_at=gte.${encodeURIComponent(`${range.from}T00:00:00+09:00`)}`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(range.to)) parts.push(`visited_at=lte.${encodeURIComponent(`${range.to}T23:59:59.999+09:00`)}`);
  parts.push("order=visited_at.desc");
  return parts.join("&");
}

const latestEffective = (v: MisuJoinedVendor) => effectiveMisuVisits(v.visits)[0];

/**
 * 필터: 팀 · 상태 칩 · 현장 판단(마지막 실효 기록 기준) · 작성자(그 사람 기록이 하나라도) · 업체 검색(정규화 이름 포함).
 * 기간이 '전체'가 아니면 그 기간에 방문 기록이 있는 업체만(방문 없는 시트 업체는 숨김).
 */
export function filterSortMisuVendors(list: MisuJoinedVendor[], f: MisuHistoryFilters): MisuJoinedVendor[] {
  const q = normMisuVendorName(f.query);
  const out = list.filter((v) => {
    if (f.team !== "전체" && v.team !== f.team) return false;
    if (f.status && v.status !== f.status) return false;
    if (f.period !== "전체" && !v.visits.length) return false;
    if (f.judgment && latestEffective(v)?.judgment !== f.judgment) return false;
    if (f.author && !v.visits.some((x) => s(x.author) === f.author)) return false;
    if (q && !normMisuVendorName(v.name).includes(q)) return false;
    return true;
  });
  const last = (v: MisuJoinedVendor) => s(latestEffective(v)?.visited_at);
  if (f.sort === "잔액순") return out.sort((a, b) => b.balanceNum - a.balanceNum || b.monthsNum - a.monthsNum);
  if (f.sort === "개월순") return out.sort((a, b) => b.monthsNum - a.monthsNum || b.balanceNum - a.balanceNum);
  // 최근 방문순: 방문 있는 업체 먼저(최근 위), 방문 없는 업체는 잔액순
  return out.sort((a, b) => {
    const la = last(a), lb = last(b);
    if (!la !== !lb) return la ? -1 : 1;
    return lb.localeCompare(la) || b.balanceNum - a.balanceNum;
  });
}

// ───────── 화면 모양으로 바꾸기 ─────────
/** "2026-10-22(수) 14:20" → 올해면 "10-22(수) 14:20" */
function shortDateTime(iso: string, today: string): string {
  const full = formatKstDateTime(iso);
  return full.startsWith(`${today.slice(0, 4)}-`) ? full.slice(5) : full;
}

export function toHistoryVendor(v: MisuJoinedVendor, today = kstDate()): MisuHistoryVendor {
  const last = latestEffective(v);
  const lastDate = last ? kstParts(last.visited_at)?.date || "" : "";
  const months = v.monthsNum ? formatMisuAmount(String(v.monthsNum), "") : "";
  const balance = v.balanceNum ? formatMisuAmount("", String(v.balanceNum)) : "";
  return {
    key: v.key, name: v.name, team: v.team || undefined, region: v.region || undefined,
    months: months || undefined, monthsNum: v.monthsNum, balance: balance || undefined,
    status: v.status, visitCount: effectiveMisuVisits(v.visits).length,
    lastVisit: last ? { date: lastDate.startsWith(`${today.slice(0, 4)}-`) ? lastDate.slice(5) : lastDate, round: last.visit_round, author: s(last.author) } : null,
    linkedByName: v.linkedBy === "name" && v.visits.length > 0,
    csChecked: v.csChecked,
  };
}

/** 지금 화면을 보는 사람(숨김 권한·숨긴 사람 기록용) */
export type MisuViewer = { name: string; sub: string };

/** 숨기기: 숨기지 않은 기록 · 작성자 본인(SSO sub 가 둘 다 있으면 sub, 아니면 이름) · 작성(created_at) KST 당일만 */
export function canHideMisuVisit(v: MisuVisit, viewer: MisuViewer, today = kstDate()): boolean {
  if (v._hidden) return false;
  const created = v.created_at ? kstParts(v.created_at)?.date : "";
  if (!created || created !== today) return false;
  if (s(v.author_sub) && s(viewer.sub)) return s(v.author_sub) === s(viewer.sub);
  return !!s(viewer.name) && s(viewer.name) === s(v.author);
}

function historyPhotos(v: MisuVisit): MisuHistoryPhoto[] {
  const any = (v.photos || []).some((p) => p && s(p.url)) || Object.keys(v.photo_skips || {}).length > 0;
  if (!any) return [];
  return PHOTO_SLOTS.map((slot) => {
    const ph = (v.photos || []).find((p) => p && p.slot === slot && s(p.url));
    return { slot, label: PHOTO_SLOT_LABEL[slot], url: ph ? s(ph.url) : undefined, skipReason: ph ? undefined : s(v.photo_skips?.[slot]) || undefined };
  });
}

/** 업체 타임라인(최신 위, 보완 기록은 원 기록 바로 아래) → 화면 모양 */
export function toHistoryVisits(visits: MisuVisit[], viewer: MisuViewer, today = kstDate()): MisuHistoryVisit[] {
  return mergeMisuTimeline(visits, []).flatMap((e) => {
    if (e.kind !== "visit") return [];
    const v = e.visit;
    return [{
      id: v.id, round: v.visit_round, visitedAt: shortDateTime(v.visited_at, today),
      createdAt: v.created_at ? shortDateTime(v.created_at, today).replace(/\([^)]*\)/, "") : "",
      author: s(v.author), authorTeam: s(v.author_team) || undefined,
      judgment: v.judgment || undefined, judgmentReason: s(v.judgment_reason) || undefined,
      lines: misuVisitLines(v), photos: historyPhotos(v), missing: v.missing || [],
      offHours: isOffHours(v.visited_at), offHoursReason: s(v.rules_ack?.offHoursReason) || undefined,
      textBody: s(v.text_body) || undefined, room: s(v.room) || undefined,
      supplementOf: e.supplement ? v.supplement_of : null,
      canHide: canHideMisuVisit(v, viewer, today),
    }];
  });
}

/** 이전 기록 최신 위(날짜 못 읽은 것은 아래) */
export function sortLegacy(list: MisuLegacyEntry[]): MisuLegacyEntry[] {
  return mergeMisuTimeline([], list).flatMap((e) => (e.kind === "legacy" ? [e.entry] : []));
}

// ───────── 조회(supabase.ts 래퍼만) ─────────
export async function loadMisuVisits(range: { from: string; to: string }): Promise<MisuVisit[]> {
  return selectAllRows<MisuVisit>("misu_visits", misuVisitsQuery(range));
}

/** 업체 하나의 전체 방문(기간 무관) — 체크리스트는 기간 밖 1차 기록까지 봐야 해서 펼칠 때 따로 읽는다. */
export function vendorVisitsQuery(ref: MisuVendorRef): string {
  const ors: string[] = [];
  const q = (v: string) => `"${v.replace(/"/g, "")}"`;
  if (s(ref.company_code)) ors.push(`company_code.eq.${q(s(ref.company_code))}`);
  if (s(ref.lease_seq)) ors.push(`lease_seq.eq.${q(s(ref.lease_seq))}`);
  const name = s(ref.vendor);
  if (name) ors.push(`vendor.eq.${q(name)}`);
  return `select=*&_hidden=eq.false&or=${encodeURIComponent(`(${ors.join(",")})`)}&order=visited_at.desc&limit=500`;
}
export async function loadVendorVisits(ref: MisuVendorRef): Promise<MisuVisit[]> {
  if (!s(ref.company_code) && !s(ref.lease_seq) && !s(ref.vendor)) return [];
  const rows = await selectRows<MisuVisit>("misu_visits", vendorVisitsQuery(ref));
  // 서버는 넓게(코드 OR 임순 OR 이름) 가져오고, 같은 업체 판정은 matchMisuVendor 로 다시 거른다(코드가 다르면 다른 업체).
  return rows.filter((v) => matchMisuVendor(ref, v));
}

export async function loadMisuSheetVendors(): Promise<MisuSheetVendor[]> {
  const src = encodeURIComponent("_출처");
  const rows = await selectAllRows<Rec>("misu", `select=*&${src}=like.${encodeURIComponent("시트")}*&order=id.asc`);
  return rows.map(sheetRowToVendor).filter((v): v is MisuSheetVendor => !!v);
}

export async function loadMisuCsChecks(): Promise<MisuCsCheck[]> {
  return selectRows<MisuCsCheck>("misu_cs_checks", "select=team,vendor,checked&checked=eq.true");
}

/** 이름 검색용 핵심어: ㈜·(주)·주식회사 떼고 앞뒤 공백 정리(가운데 공백은 그대로 — ilike 가 그대로 비교) */
export function misuNameCore(name: string): string {
  return s(name).replace(/㈜|\(주\)|（주）|주식회사|\(유\)|유한회사/g, " ").replace(/\s+/g, " ").trim();
}

/** 옛 카톡 미수 행 쿼리 — 업체 펼칠 때 그 업체만(_업체명 ilike), 숨김 제외, 최근 200건 */
export function legacyKakaoQuery(name: string): string {
  const core = misuNameCore(name).replace(/[*,()"]/g, " ").trim();
  const col = encodeURIComponent("_업체명");
  const src = encodeURIComponent("_출처");
  return `select=id,${encodeURIComponent("입력일")},${encodeURIComponent("입력자")},${encodeURIComponent("원문")},${col},${encodeURIComponent("_등록시각")}&${src}=like.${encodeURIComponent("카톡")}*&${col}=ilike.${encodeURIComponent(`*${core}*`)}&_hidden=not.is.true&order=id.desc&limit=200`;
}

/** 카톡 행을 읽어 같은 업체(정규화 이름 같음)만 이전 기록으로. 이름이 비면 빈 배열. */
export async function loadLegacyKakao(name: string): Promise<MisuLegacyEntry[]> {
  if (!misuNameCore(name)) return [];
  const rows = await selectRows<Rec>("misu", legacyKakaoQuery(name));
  const want = normMisuVendorName(name);
  return rows.filter((r) => normMisuVendorName(s(r["_업체명"])) === want).map(kakaoRowToLegacy).filter((e): e is MisuLegacyEntry => !!e);
}

/**
 * 숨기기(한 방향 — 표 정책이 _hidden=false → true 만 허용). 저장은 return=minimal 이라 정책에 막혀도 오류가 안 나므로
 * 다시 읽어 숨겨졌는지 확인한다. 확인 안 되면 throw.
 */
export async function hideMisuVisit(id: string, by: string): Promise<void> {
  const idq = `id=eq.${encodeURIComponent(id)}`;
  await updateRows("misu_visits", `${idq}&_hidden=eq.false`, { _hidden: true, _hidden_by: by, _hidden_at: new Date().toISOString() });
  const back = await selectRows<{ _hidden: boolean }>("misu_visits", `select=_hidden&${idq}`);
  if (!back.length || back[0]._hidden !== true) throw new Error("숨김이 저장되지 않았습니다(권한 또는 이미 바뀐 기록)");
}
