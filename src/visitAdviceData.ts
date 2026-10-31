/**
 * AS 접수 뒤 "방문 판단 안내글" — 자료 모으기 + 큐 적재(구현 B, 2026-10-31).
 * 설계: docs/tasks/as-reception-visit-advice-2026-10-31.md 2장(재료)·4장(값 정의·추가일정)·맨 아래 "결정".
 *
 * 흐름: runVisitAdviceFor(접수, 방)
 *   → collectVisitAdviceInput  업체 코드(RPC resolve_ticket_vendor_code) → 지점 행(임대리스트 순번) → entity360 buildEntity·gather → 값
 *   → judgeVisit → shouldSend → buildVisitAdviceText   (src/visitAdvice.ts, 구현 A의 순수 규칙 — 여기서는 부르기만)
 *   → enqueueVisitAdvice      RPC queue_visit_advice(할 일 없으면 send=false 로도 꼭). 실제 카톡 발송은 DB 크론 flush_visit_advice
 *
 * 누락 금지(사용자 결정): 자료 수집이 실패하면 건너뛰지 않고 "판단불가(자료 못 읽음)" 글을 넣는다.
 * 표가 아직 없으면(SQL 실행 전) 콘솔 경고 + 화면 토스트용 오류를 돌려준다.
 */
import { buildEntity, dateOf, gather, identKey, str, type Entity, type Row, type SourceResult } from "./entity360";
import { vendorMatchKey } from "./ids";
import { isBusinessDay, nextBusinessDay } from "./planDate";
import { usageSpareAdvice, type SnapshotLike } from "./spareAdvice";
import { getConfig, rpc, selectAllRows, selectRows } from "./supabase";
import type { ServiceReceptionRow } from "./api";
import { kstDate } from "./visits";
import {
  buildVisitAdviceText, judgeVisit, sameBuildingKey, shouldSend,
  type VisitAdviceInput,
} from "./visitAdvice";

export const VISIT_ADVICE_TABLE = "visit_advice_log";

// ── 모은 값(판정 재료) ─────────────────────────────────────────
export type UpcomingTicket = {
  id: string; date: string; time: string; scheduleType: string; source: string; status: string;
  vendor: string; vendorCode: string; calendarTitle: string; issue: string; team: string;
  /** 어떻게 이어졌나 — code(거래처 코드) · name(이름 키, 코드 없음) · device(기번·자산번호) · building(같은 건물 주소) */
  matchedBy: "code" | "name" | "device" | "building";
  /** 이번 접수 지점과 같은 지점 기록인가(업체명 표기·기기 번호 일치) — 아니면 글에 지점명을 붙인다 */
  sameBranch: boolean;
  /** 같은 사업자 다른 표기인데 일정에 주소가 없어 같은 건물인지 판단 못 함 — 글에 "(주소 미확인)" (2026-10-31) */
  addressUnknown?: boolean;
};

export type VisitAdviceFacts = {
  receptionId: string;
  vendor: string; grade: string; model: string; asset: string; serial: string;
  code: string;                 // 마스터 거래처 코드(못 정하면 "")
  branchName: string;           // 임대리스트 지점 표기(_업체명) — 없으면 접수 업체명
  companyBased: boolean;        // 지점 기록이 없어 회사 전체 기록을 썼다 → 값 뒤 "(회사 기준)"
  lastInspect: string;          // yyyy-mm-dd, 없으면 ""
  lastAs: string;               // 다녀온 AS 최댓값(이번 접수·이번 접수로 만든 일정 제외)
  elapsedDays: number | null;   // 오늘 − 마지막점검일
  workin: { has: boolean; kinds: string[]; labels: string[]; teams: string[]; renewalOnly: boolean; pick: null | { label: string; kind: "quarter" | "monthly" } };
  deviceCount: number;          // 지점 임대중 복합기·프린터·플로터
  asDeviceCount: number;        // 마지막AS일 하루에 본 서로 다른 기기 수
  asAfterInspection: { date: string; deviceCount: number }[]; // 마지막점검일 뒤 다녀온 AS(날짜별 본 기기 수)
  spare: "충분" | "부족" | "모름"; spareShortDevices: number;
  selfOpen: number;             // 자가신청(kind 자가) 아직 지급 안 된 건
  selfSinceInspect: number;     // 마지막점검일 뒤 자가신청 건수
  upcoming: UpcomingTicket[];   // 날짜·시간 순
  today: string;
};

export type CollectOpts = { today?: string; thresholds?: { quarterDays: number; monthlyDays: number } };
type NotFound = { notFound: true; reason: string };

// ── 작은 도우미 ───────────────────────────────────────────────
const enc = encodeURIComponent;
const col = (c: string) => enc(/[^A-Za-z0-9_]/.test(c) ? `"${c}"` : c);
const normName = (s: string) => String(s || "").replace(/\s+/g, " ").trim();
const DEVICE_KIND = /복합기|프린터|플로터/;
const quarterOf = (ymd: string) => Math.ceil(Number(ymd.slice(5, 7)) / 3);

/** 오늘(KST) − ymd 일수. 형식이 아니면 null (visitAdvice.daysBetween 과 인자 순서가 반대라 이름을 달리 둔다) */
function daysDiff(ymd: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${ymd}T00:00:00Z`)) / 86_400_000);
}

const rowDeviceKeys = (row: Row): string[] => {
  const keys = [str(row, "시리얼넘버"), str(row, "자산기번"), str(row, "serial"), str(row, "asset")].map(identKey);
  const list = row["_기번목록"];
  if (Array.isArray(list)) keys.push(...list.map((v) => identKey(String(v))));
  return keys.filter((k) => k.length >= 3);
};

/**
 * 보낼 시각(설계 3-3). 10:00~19:59 = 지금, 0~9시 = 오늘 10:00(영업일 아니면 다음 영업일), 20시 이후 = 다음 영업일 10:00.
 * 20시 이후를 "지금"으로 두면 크론(10~19시)이 다음 날 10시에 집을 때 due_at 이 6시간 넘게 지나 skipped 된다 — 누락이라 다음 영업일로 민다.
 */
export function visitAdviceDueAt(now: Date = new Date(), hours: [number, number] = [10, 20]): string {
  const today = kstDate(now);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", hourCycle: "h23" }).format(now));
  const at = (ymd: string) => new Date(`${ymd}T${String(hours[0]).padStart(2, "0")}:00:00+09:00`).toISOString();
  if (hour >= hours[0] && hour < hours[1]) return now.toISOString();
  if (hour < hours[0]) return at(isBusinessDay(today) ? today : nextBusinessDay(today));
  return at(nextBusinessDay(today));
}

/** "10-20" → [10, 20]. 이상하면 기본값 */
export function parseAdviceHours(v: string | undefined): [number, number] {
  const m = String(v || "").match(/^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/);
  const a = m ? Number(m[1]) : 10, b = m ? Number(m[2]) : 20;
  return a >= 0 && b <= 24 && a < b ? [a, b] : [10, 20];
}

// ── 1. 지점 행 ───────────────────────────────────────────────
/** 임대리스트에서 이번 접수의 지점 행 — 순번(lease_no) → 자산기번·시리얼 순. 그 _업체명과 같은 행 전부 */
async function findBranchRows(rc: ServiceReceptionRow): Promise<{ branchName: string; rows: Row[]; leaseCode: string }> {
  const lease = String(rc.lease_no || "").trim();
  let hit: Row[] = [];
  if (lease) hit = await selectRows<Row>("vendor_info", `select=${enc("_업체명,코드")}&${enc(`_raw->>순`)}=eq.${enc(lease)}&_hidden=not.is.true&limit=1`);
  if (!hit.length) {
    const ors: string[] = [];
    const asset = String(rc.asset_no || "").trim(), serial = String(rc.serial || "").trim();
    if (asset.length >= 3) ors.push(`${col("자산번호")}.eq.${enc(asset)}`);
    if (serial.length >= 4) ors.push(`${col("기번")}.eq.${enc(serial)}`, `${col("시리얼번호(기번)")}.eq.${enc(serial)}`);
    if (ors.length) hit = await selectRows<Row>("vendor_info", `select=${enc("_업체명,코드")}&or=(${ors.join(",")})&_hidden=not.is.true&limit=1`);
  }
  const branchName = hit[0] ? str(hit[0], "_업체명") : "";
  if (!branchName) return { branchName: "", rows: [], leaseCode: "" };
  const rows = await selectRows<Row>("vendor_info", `select=*&${col("_업체명")}=eq.${enc(branchName)}&_hidden=not.is.true&limit=200`);
  return { branchName, rows, leaseCode: str(hit[0], "코드") };
}

// ── 2. 추가일정(앞으로 잡힌 일정) ─────────────────────────────
type TicketRow = Record<string, unknown>;
const TICKET_COLS = "id,team,date,time,vendor,address,serial,asset,receptionId,issue,status,scheduleType,calendarTitle,source,vendor_code";

/**
 * as_tickets 중 date ≥ today · 완료/취소 아님 · 휴가 아님 · 이번 접수로 만든 일정 아님, 그리고
 * (a) 같은 거래처 코드 / 코드 없을 때 이름 키 / 지점 기기 번호  (b) 같은 건물(sameBuildingKey 주소 일치)
 * 단 (a)로 이어졌어도 **같은 지점이 아니고 주소가 다른 건물이면 뺀다** — 사용자 결정(2026-10-31): "같은 사업자의 다른 지점이 아니라
 * 같은 주소(건물)만. 같은 주소인데 두 번 갈 필요 없잖아". 주소가 비어 판단 못 하면 넣되 addressUnknown 으로 표시한다(놓치는 쪽이 더 나쁘다).
 */
export function pickUpcomingTickets(rows: TicketRow[], ctx: {
  receptionId: string; code: string; entity: Entity; branchName: string; branchDeviceKeys: string[]; buildingKeys: string[]; today: string;
}): UpcomingTicket[] {
  const out: UpcomingTicket[] = [];
  const buildings = new Set(ctx.buildingKeys.filter(Boolean));
  for (const r of rows) {
    const s = (k: string) => str(r, k);
    if (!s("date") || s("date") < ctx.today) continue;
    if (/완료|취소/.test(s("status"))) continue;
    if (/휴가/.test(s("scheduleType")) || /휴가|연차/.test(s("vendor"))) continue;
    if (ctx.receptionId && s("receptionId") === ctx.receptionId) continue;
    const vcode = s("vendor_code");
    const vkey = vendorMatchKey(s("vendor"));
    const devHit = [identKey(s("serial")), identKey(s("asset"))].some((k) => k.length >= 3 && (ctx.entity.deviceKeys.includes(k) || ctx.branchDeviceKeys.includes(k)));
    let matchedBy: UpcomingTicket["matchedBy"] | null = null;
    if (ctx.code && vcode === ctx.code) matchedBy = "code";
    else if (devHit) matchedBy = "device";
    else if (!vcode && vkey.length >= 2 && ctx.entity.nameKeys.includes(vkey)) matchedBy = "name";
    else if (buildings.size) {
      const bk = sameBuildingKey(s("address"));
      if (bk && buildings.has(bk)) matchedBy = "building";
    }
    if (!matchedBy) continue;
    const sameBranch = devHit || (!!ctx.branchName && normName(s("vendor")) === normName(ctx.branchName));
    let addressUnknown = false;
    if (matchedBy !== "building" && !sameBranch) {
      const bk = sameBuildingKey(s("address"));
      if (bk && buildings.size) { if (!buildings.has(bk)) continue; }   // 같은 사업자라도 다른 주소 지점 → 제외
      else addressUnknown = true;                                        // 주소를 모르면 넣고 표시
    }
    out.push({
      id: s("id"), date: s("date").slice(0, 10), time: s("time"), scheduleType: s("scheduleType"), source: s("source"), status: s("status"),
      vendor: s("vendor"), vendorCode: vcode, calendarTitle: s("calendarTitle"), issue: s("issue"), team: s("team"), matchedBy, sameBranch,
      ...(addressUnknown ? { addressUnknown: true } : {}),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
}

// ── 3. 기록에서 값 뽑기(순수) ─────────────────────────────────
type Scope = { branchName: string; deviceKeys: string[] };
const inBranch = (row: Row, sc: Scope, nameCols: string[]) =>
  rowDeviceKeys(row).some((k) => sc.deviceKeys.includes(k)) || (!!sc.branchName && nameCols.some((c) => normName(str(row, c)) === normName(sc.branchName)));

/** 지점 기록 우선 — 하나도 없으면 회사 전체(companyBased) */
export function scopeRows(rows: Row[], sc: Scope, nameCols: string[]): { rows: Row[]; companyBased: boolean } {
  const mine = rows.filter((r) => inBranch(r, sc, nameCols));
  return mine.length || !rows.length ? { rows: mine, companyBased: false } : { rows, companyBased: true };
}

const maxDate = (rows: Row[], keys: string[], today: string) =>
  rows.map((r) => dateOf(r, keys)).filter((d) => d && d <= today).sort().pop() || "";

export function deriveVisitFacts(input: {
  reception: ServiceReceptionRow; code: string; entity: Entity; branchName: string; branchRows: Row[];
  results: SourceResult[]; tickets: TicketRow[]; today: string;
}): VisitAdviceFacts {
  const { reception: rc, entity, branchName, branchRows, results, today } = input;
  const exact = (t: string) => results.find((r) => r.source.table === t)?.exact || [];
  const failed = results.filter((r) => !r.ok).map((r) => `${r.source.table}: ${r.error || "실패"}`);
  if (failed.length) throw new Error(`자료 조회 실패 — ${failed.join(" / ")}`);
  const branchDeviceKeys = Array.from(new Set(branchRows.flatMap((r) => [str(r, "기번"), str(r, "시리얼번호(기번)"), str(r, "자산번호")]).map(identKey).filter((k) => k.length >= 3)));
  const sc: Scope = { branchName, deviceKeys: branchDeviceKeys };

  const jeom = scopeRows(exact("jeomgeom"), sc, ["_업체명", "업체명"]);
  const asr = scopeRows(exact("as_records"), sc, ["_업체명", "업체명"]);
  const lastInspect = maxDate(jeom.rows, ["작성일"], today);
  // 다녀온 AS = AS 보고 + AS·익일AS 일정 완료. 이번 접수로 만든 일정은 뺀다(접수 자체는 "다녀온 것"이 아니다)
  const ticketsAll = exact("as_tickets").filter((r) => str(r, "receptionId") !== rc.id);
  const asDone = scopeRows(ticketsAll.filter((r) => /AS/i.test(str(r, "scheduleType")) && /완료/.test(str(r, "status"))), sc, ["vendor"]);
  const lastAsRecord = maxDate(asr.rows, ["작성일"], today);
  const lastAsTicket = maxDate(asDone.rows, ["date"], today);
  const lastAs = [lastAsRecord, lastAsTicket].sort().pop() || "";
  // 그날 본 기기 수 = AS 보고의 서로 다른 기번·자산기번(같은 기기 블록 여러 행은 1대). 보고 없이 일정 완료만 있으면 1대
  const ticketDates = new Set(asDone.rows.map((r) => dateOf(r, ["date"])));
  const asDevicesOn = (d: string) =>
    new Set(asr.rows.filter((r) => dateOf(r, ["작성일"]) === d).map((r) => rowDeviceKeys(r)[0] || `row:${String(r.id)}`)).size || (ticketDates.has(d) ? 1 : 0);
  const asDeviceCount = lastAs ? asDevicesOn(lastAs) : 0;
  const asDates = Array.from(new Set([...asr.rows.map((r) => dateOf(r, ["작성일"])), ...ticketDates])).filter((d) => d && d <= today && (!lastInspect || d > lastInspect)).sort();
  const asAfterInspection = asDates.map((date) => ({ date, deviceCount: asDevicesOn(date) }));

  // 기기 대수 — 지점 임대중 복합기·프린터·플로터(품목이 비어 있으면 기종이 있는 행을 센다)
  const renting = branchRows.filter((r) => /임대중/.test(str(r, "임대여부")) || !str(r, "임대여부"));
  const deviceCount = renting.filter((r) => DEVICE_KIND.test(str(r, "품목")) || (!str(r, "품목") && !!(str(r, "모델명") || str(r, "기종")))).length;

  // 여분 — 지점 기기별 최근 점검 2회 → usageSpareAdvice. 기기 번호로 못 나누면 지점 기록 전체를 한 대로
  const snap = (r: Row): SnapshotLike => ({ date: dateOf(r, ["작성일"]), counts: str(r, "매수"), toner: str(r, "토너잔량"), spare: str(r, "여분"), waste: str(r, "폐통"), serial: str(r, "시리얼넘버") });
  const byDevice = new Map<string, Row[]>();
  for (const r of jeom.rows) { const k = rowDeviceKeys(r)[0] || "_"; byDevice.set(k, [...(byDevice.get(k) || []), r]); }
  let spareKnown = 0, spareShort = 0;
  for (const rows of byDevice.values()) {
    const sorted = [...rows].sort((a, b) => dateOf(b, ["작성일"]).localeCompare(dateOf(a, ["작성일"])));
    const adv = usageSpareAdvice(snap(sorted[0]), sorted[1] ? snap(sorted[1]) : undefined, str(sorted[0], "모델명"));
    if (!adv) continue;
    spareKnown += 1;
    if (adv.needsList.length) spareShort += 1;
  }
  const spare: VisitAdviceFacts["spare"] = !spareKnown ? "모름" : spareShort ? "부족" : "충분";

  // 자가신청 — kind 자가, 지점 우선
  const self = scopeRows(exact("supply_requests").filter((r) => str(r, "kind") === "자가"), sc, ["vendor", "used_vendor"]).rows;
  const selfOpen = self.filter((r) => !/지급|반납|불량|취소/.test(str(r, "stage"))).length;
  const selfSinceInspect = lastInspect ? self.filter((r) => str(r, "request_date").slice(0, 10) > lastInspect).length : self.length;

  // 워킨맵 — 이번 분기·숨김 아님. 지점명이 이름에 들어간 곳 우선, 없으면 코드 전체
  const q = quarterOf(today);
  const places = exact("workin_map_places").filter((r) => Number(str(r, "quarter")) === q && r.visible !== false);
  const branchTag = (branchName.match(/\(([^)]+)\)/)?.[1] || "").replace(/\s+/g, "");
  const branchPlaces = branchTag ? places.filter((r) => str(r, "name").replace(/\s+/g, "").includes(branchTag)) : [];
  const wp = branchPlaces.length ? branchPlaces : places;
  const kinds = Array.from(new Set(wp.map((r) => str(r, "kind")).filter(Boolean)));
  const visitKinds = kinds.filter((k) => k === "quarter" || k === "monthly");
  const workin = {
    has: visitKinds.length > 0,
    kinds,
    labels: Array.from(new Set(wp.filter((r) => str(r, "kind") !== "renewal").map((r) => str(r, "label")).filter(Boolean))),
    teams: Array.from(new Set(wp.map((r) => str(r, "team")).filter(Boolean))),
    renewalOnly: kinds.length > 0 && visitKinds.length === 0,
    pick: null as null | { label: string; kind: "quarter" | "monthly" },
  };
  // 글에 찍을 한 곳 — 매월점검이 섞여 있으면 매월(기준 25일). 그 종류의 장소가 전부 G5·G12면 그 라벨(완료·이관), 아니면 "C팀"
  const visitRows = wp.filter((r) => str(r, "kind") === "quarter" || str(r, "kind") === "monthly");
  if (visitRows.length) {
    const kind: "quarter" | "monthly" = visitRows.some((r) => str(r, "kind") === "monthly") ? "monthly" : "quarter";
    const ofKind = visitRows.filter((r) => str(r, "kind") === kind);
    const doneLabel = (r: Row) => (/^G(5|12)$/i.test(str(r, "label")) ? str(r, "label").toUpperCase() : "");
    const allDone = ofKind.every((r) => doneLabel(r));
    const team = str(ofKind[0], "team");
    workin.pick = { kind, label: allDone ? (ofKind.some((r) => doneLabel(r) === "G5") ? "G5" : "G12") : team ? (/팀$/.test(team) ? team : `${team}팀`) : "" };
  }

  const buildingKeys = [rc.address, ...branchRows.map((r) => str(r, "주소상세주소"))].map((a) => sameBuildingKey(String(a || ""))).filter(Boolean);
  const upcoming = pickUpcomingTickets(input.tickets, { receptionId: rc.id, code: input.code, entity, branchName, branchDeviceKeys, buildingKeys, today });

  return {
    receptionId: rc.id, vendor: rc.vendor, grade: rc.grade, model: rc.model, asset: rc.asset_no, serial: rc.serial,
    code: input.code, branchName: branchName || rc.vendor, companyBased: jeom.companyBased || asr.companyBased,
    lastInspect, lastAs, elapsedDays: lastInspect ? daysDiff(lastInspect, today) : null,
    workin, deviceCount, asDeviceCount, asAfterInspection, spare, spareShortDevices: spareShort, selfOpen, selfSinceInspect, upcoming, today,
  };
}

// ── 4. 모으기(조회) ──────────────────────────────────────────
const GATHER_ONLY = ["jeomgeom", "as_records", "as_tickets", "supply_requests", "workin_map_places"];

export async function collectVisitAdviceFacts(rc: ServiceReceptionRow, opts: CollectOpts = {}): Promise<VisitAdviceFacts | NotFound> {
  const today = opts.today || kstDate();
  const [codeRaw, branch] = await Promise.all([
    rpc<string | null>("resolve_ticket_vendor_code", { p_reception: rc.id, p_serial: rc.serial || "", p_asset: rc.asset_no || "", p_vendor: rc.vendor || "" }),
    findBranchRows(rc),
  ]);
  const code = typeof codeRaw === "string" ? codeRaw.trim() : "";
  if (!code && !branch.branchName) return { notFound: true, reason: "임대리스트에서 못 찾음" };
  const entity = await buildEntity({ code, leaseCode: branch.leaseCode, name: branch.branchName || rc.vendor, deviceCount: branch.rows.length, how: "접수" }, branch.branchName || rc.vendor);
  const [results, tickets] = await Promise.all([
    gather(entity, { only: GATHER_ONLY }),
    selectAllRows<TicketRow>("as_tickets", `select=${TICKET_COLS}&date=gte.${today}&or=(status.is.null,status.neq.${enc("완료")})&order=date.asc,time.asc,id.asc`),
  ]);
  return deriveVisitFacts({ reception: rc, code, entity, branchName: branch.branchName, branchRows: branch.rows.length ? branch.rows : entity.leaseRows, results, tickets, today });
}

// ── 구현 A(visitAdvice.ts) 입력으로 ─────────────────────────────
const SOURCE_KO: Record<string, string> = { naver: "네이버 수입", recontract: "재계약", autoplan: "자동계획", workin: "워킨맵", manual: "직접 등록" };
const LOGI_WORD = /납품|철수|교체|회수|이전|설치|세팅|셋팅/;

/** 일정 종류 낱말(설계 4-4) — 재계약 확인 · AS·익일AS → AS · 매월점검 · 물류는 제목의 첫 물류 낱말(없으면 물류) */
export function ticketKindLabel(t: Pick<UpcomingTicket, "scheduleType" | "source" | "calendarTitle">): string {
  if (t.source === "recontract") return "재계약 확인";
  if (/AS/i.test(t.scheduleType)) return "AS";
  if (/매월/.test(t.scheduleType)) return "매월점검";
  const w = (t.calendarTitle.match(LOGI_WORD) || [])[0];
  if (w) return w === "셋팅" ? "세팅" : w;
  if (/물류|납품|철수|교체/.test(t.scheduleType)) return "물류";
  return t.scheduleType || "일정";
}

/** 글 한 줄 설명 — 종류(+ AS 증상 12자 / 물류 구분 괄호) + 다른 지점이면 지점명 + 이름으로만 이어졌으면 (이름 일치) */
export function ticketTitle(t: UpcomingTicket, branchName: string): string {
  const kind = ticketKindLabel(t);
  let detail = "";
  if (kind === "AS" && t.issue) detail = `(${t.issue.replace(/\s+/g, " ").trim().slice(0, 12)})`;
  else if (kind !== "AS" && kind !== "매월점검" && kind !== "재계약 확인") {
    const seg = t.calendarTitle.split("/").map((x) => x.trim()).find((x) => LOGI_WORD.test(x)) || "";
    const paren = seg.match(/(?:납품|철수|교체|회수|이전|설치|세팅|셋팅)만?(\([^)]{1,8}\))/);
    if (paren) detail = paren[1];
  }
  const other = t.matchedBy !== "building" && !t.sameBranch && normName(t.vendor) && normName(t.vendor) !== normName(branchName)
    ? ` — ${(t.vendor.match(/\(([^)]+)\)/)?.[1] || t.vendor).trim().slice(0, 16)}` : "";
  return `${kind}${detail}${other}${t.matchedBy === "name" ? " (이름 일치)" : ""}${t.addressUnknown ? " (주소 미확인)" : ""}`;
}

export function toVisitAdviceInput(f: VisitAdviceFacts, thresholds = { quarterDays: 60, monthlyDays: 25 }): VisitAdviceInput {
  const deviceLine = [f.model, f.asset, f.serial].map((x) => String(x || "").trim()).filter(Boolean).join("/");
  return {
    vendor: f.branchName || f.vendor, grade: f.grade, deviceLine,
    lastInspection: f.lastInspect || undefined, lastAs: f.lastAs || undefined,
    asAfterInspection: f.asAfterInspection, deviceTotal: f.deviceCount, spare: f.spare, selfRequestOpen: f.selfOpen,
    workin: f.workin.pick, today: f.today, thresholds,
    upcoming: f.upcoming.map((t) => ({
      date: t.date, kind: ticketKindLabel(t), title: ticketTitle(t, f.branchName), vendor: t.vendor,
      sameBuilding: t.matchedBy === "building",
      source: [SOURCE_KO[t.source] || "", t.team ? (/팀$/.test(t.team) ? t.team : `${t.team}팀`) : ""].filter(Boolean).join(", "),
    })),
  };
}

/** 모으기 + A 입력 변환. 못 찾으면 { notFound: true }. 조회 실패는 throw(runVisitAdviceFor 가 판단불가 글로 바꾼다) */
export async function collectVisitAdviceInput(rc: ServiceReceptionRow, opts: CollectOpts = {}): Promise<VisitAdviceInput | { notFound: true }> {
  const f = await collectVisitAdviceFacts(rc, opts);
  return "notFound" in f ? { notFound: true } : toVisitAdviceInput(f, opts.thresholds);
}

// ── 5. 큐 적재(RPC queue_visit_advice — supabase/visit-advice-20261031.sql) ─────────────
export class VisitAdviceTableMissing extends Error {
  constructor(detail: string) { super(`방문 판단 표·함수(${VISIT_ADVICE_TABLE}·queue_visit_advice)가 아직 없습니다 — SQL 실행 전. ${detail}`.slice(0, 300)); this.name = "VisitAdviceTableMissing"; }
}
/** 표·함수 없음 — 42P01(표) · 42883(함수) · PGRST202(RPC 못 찾음) · PGRST205(표 못 찾음) */
export const isTableMissingError = (msg: string) => /42P01|42883|PGRST202|PGRST205|Could not find the (table|function)/i.test(msg);

export type EnqueueStatus = "queued" | "skipped" | "exists" | "ignored";

/**
 * 접수 1건의 안내글을 visit_advice_log 에 넣는다(RPC). send=false 면 "할 일 없음"으로 skipped 행만 남긴다 —
 * 이 행이 있어야 크론의 보충 감지(10분 뒤 판단불가 글)에 걸리지 않는다. 같은 접수가 이미 처리됐으면 "exists"(바뀌는 것 없음).
 */
export async function enqueueVisitAdvice(receptionId: string, roomSent: string, text: string, opts: {
  due_at?: string; verdict?: string; facts?: Record<string, unknown>; author?: string; send?: boolean; reason?: string;
} = {}): Promise<EnqueueStatus> {
  if (!receptionId) throw new Error("접수 id 가 없습니다");
  const send = opts.send !== false;
  if (send && !roomSent) throw new Error("보낸 방이 없습니다");
  try {
    const res = await rpc<{ status?: string } | null>("queue_visit_advice", {
      p_reception_id: receptionId, p_room: roomSent || "", p_text: text, p_verdict: opts.verdict || null, p_send: send,
      p_due_at: opts.due_at || visitAdviceDueAt(), p_facts: opts.facts || {}, p_author: opts.author || "", p_reason: opts.reason || "",
    });
    const s = String(res?.status || "");
    return s === "queued" || s === "skipped" || s === "exists" || s === "ignored" ? s : send ? "queued" : "skipped";
  } catch (e) {
    const msg = (e as Error).message || String(e);
    if (isTableMissingError(msg)) {
      console.warn(`[방문 판단] ${VISIT_ADVICE_TABLE}·queue_visit_advice 없음 — SQL(supabase/visit-advice-20261031.sql) 실행 전`, msg);
      throw new VisitAdviceTableMissing(msg);
    }
    throw e;
  }
}

// ── 6. 한 번에 ───────────────────────────────────────────────
export type VisitAdviceRunResult =
  | { status: "queued" | "exists" | "ignored"; verdict: string; dueAt: string; immediate: boolean }
  | { status: "no-task"; verdict: string }
  | { status: "off" }
  | { status: "error"; tableMissing: boolean; error: string };

const numCfg = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
const deviceLineOf = (rc: ServiceReceptionRow) => [rc.model, rc.asset_no, rc.serial].map((x) => String(x || "").trim()).filter(Boolean).join("/");
/** 못 찾음·자료 못 읽음일 때 구현 A 에 넘길 최소 입력(머리 줄 = 접수 업체명 + 등급) */
function bareInput(rc: ServiceReceptionRow, today: string, thresholds: VisitAdviceInput["thresholds"], extra: Partial<VisitAdviceInput>): VisitAdviceInput {
  return { vendor: rc.vendor, grade: rc.grade, deviceLine: deviceLineOf(rc), asAfterInspection: [], deviceTotal: 0, spare: "모름", selfRequestOpen: 0, workin: null, upcoming: [], today, thresholds, ...extra };
}
/** " (10/30 21:40 접수분)" — 보류했다가 아침에 나가는 글의 첫 줄 꼬리(설계 3-3) */
export function receivedTag(createdAt: string | undefined, now: Date): string {
  const d = createdAt ? new Date(createdAt) : now;
  const t = Number.isFinite(d.getTime()) ? d : now;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(t);
  const g = (k: string) => parts.find((p) => p.type === k)?.value || "";
  return ` (${g("month")}/${g("day")} ${g("hour")}:${g("minute")} 접수분)`;
}

/**
 * 접수 1건 → 판정 → 큐. 화면을 막지 않게 부르는 쪽은 void ...then(결과 → 토스트 꼬리).
 * 실패를 삼키지 않는다: 자료 실패 = 판단불가(자료 못 읽음) 글로 적재, 적재 실패 = status "error"(tableMissing 이면 SQL 실행 전).
 * 스위치(VISIT_ADVICE_ENABLED)가 꺼져 있으면 "off" — opts.force 로 건너뛸 수 있다(테스트·다시 계산).
 */
export async function runVisitAdviceFor(rc: ServiceReceptionRow, roomSent: string, opts: { now?: Date; force?: boolean } = {}): Promise<VisitAdviceRunResult> {
  const now = opts.now || new Date();
  const today = kstDate(now);
  let cfg: Record<string, string> = {};
  try { cfg = await getConfig(); } catch (e) { console.warn("[방문 판단] 설정 조회 실패 — 기본값으로 진행(발송은 DB 크론이 스위치를 다시 본다)", e); }
  if (!opts.force && String(cfg.VISIT_ADVICE_ENABLED || "false").toLowerCase() !== "true") return { status: "off" };
  const thresholds = { quarterDays: numCfg(cfg.VISIT_ADVICE_MIN_DAYS, 60), monthlyDays: numCfg(cfg.VISIT_ADVICE_MONTHLY_DAYS, 25) };
  const dueAt = visitAdviceDueAt(now, parseAdviceHours(cfg.VISIT_ADVICE_HOURS));
  const immediate = Date.parse(dueAt) <= now.getTime() + 1000;
  let input: VisitAdviceInput;
  try {
    const got = await collectVisitAdviceInput(rc, { today, thresholds });
    input = "notFound" in got ? bareInput(rc, today, thresholds, { notFound: true }) : got;
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.warn("[방문 판단] 자료 수집 실패 — 판단불가(자료 못 읽음) 글로 적재", msg);
    input = bareInput(rc, today, thresholds, { lookupError: msg.replace(/\s+/g, " ").slice(0, 120) });
  }
  const judged = judgeVisit(input);
  const send = shouldSend(judged, input.upcoming);
  let text = buildVisitAdviceText(input, judged);
  if (send && !immediate) { const [first, ...rest] = text.split("\n"); text = [first + receivedTag(rc.created_at, now), ...rest].join("\n"); }
  const facts: Record<string, unknown> = { ...input, verdict: judged.verdict, elapsedDays: judged.elapsedDays, reasons: judged.reasons };
  try {
    // 할 일이 없어도(불필요 + 추가일정 없음) send=false 로 반드시 부른다 — 안 부르면 크론 보충이 10분 뒤 판단불가 글을 보낸다
    const r = await enqueueVisitAdvice(rc.id, roomSent, text, { due_at: send ? dueAt : now.toISOString(), verdict: judged.verdict, facts, author: rc.author, send });
    if (!send) return { status: "no-task", verdict: judged.verdict };
    return { status: r === "skipped" ? "queued" : r, verdict: judged.verdict, dueAt, immediate };
  } catch (e) {
    return { status: "error", tableMissing: e instanceof VisitAdviceTableMissing, error: (e as Error).message || String(e) };
  }
}
