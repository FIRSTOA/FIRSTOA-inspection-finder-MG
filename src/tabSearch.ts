/**
 * 필드 탭별 검색(1단계, 2026-10-22) — 탭 맨 위 검색칸에 업체명·자산·시리얼을 치면 "그 탭 업무"의 FIELD 기록만 한 줄 타임라인으로.
 * 설계: docs/tasks/tab-search-kakao-history.md 3-1·4절. 2단계(2026-10-24): 결과 칸의 [카톡 대화] 탭 = 엣지 kakao-search(맨 아래 "카톡 대화" 절).
 *
 * - 업체 찾기·키 묶음·표 수집은 통합 검색 360(src/entity360.ts)을 그대로 쓴다: gather(e, { only }) 로 그 탭 표만.
 * - SOURCES 에 없는 표(misu_visits)는 SOURCES 를 고치지 않고 여기 EXTRA_SOURCES 로 덧붙여 같은 조건 조립 함수로 모은다.
 * - 건수는 세지 않는다(건수 원본 = src/workCount.ts). 요약은 "마지막 사건" 날짜만.
 * - 주민번호 모양 값(앞6-뒤7)은 화면에 내보내기 전에 가린다(maskRrn — 본문은 src/privacy.ts, 2026-10-22 옮김).
 *
 * React 없는 순수 로직 + 조회 한 함수(runTabSearch). 테스트: tests/tabSearch.test.ts
 */
import {
  buildExactQuery, buildLooseQuery, firstOf, gather, inList, isOtherVendor, matchesEntity, MISU_VISITS_SOURCE, rawTextOf, sameVendorKey, SOURCES, str, toEvent,
  type Entity, type Row, type SourceDef, type SourceResult,
} from "./entity360";
import { invokeEdgeFunction, selectRows } from "./supabase";
import { maskRrn } from "./privacy";
import { logisticsTicketInfo, vendorMatchKey } from "./ids";
import { normalizeLogisticsKind } from "./operations";
import { LOGISTICS_SCHEDULE_TYPES } from "./overdueLogic";

// ── 탭 정의 ─────────────────────────────────────────────────
export type TabKey =
  | "inspection" | "air" | "logistics" | "it" | "copier-exp" | "contact" | "bulman" | "misu" | "overage" | "recontract" | "replacement" | "praise";

export type TabChip = { key: string; label: string; tables: string[] };
/** 요약 한 줄의 한 칸 — "마지막 납품 2025-03-10" / "철수 없음" */
export type SummaryKind = { label: string; tables: string[]; match?: RegExp };

export type TabSpec = {
  key: TabKey;
  label: string;          // "물류"
  question: string;       // 검색칸 안내 — "이 업체 물류 이력 — 업체명·자산·시리얼"
  tables: string[];       // SOURCES 의 표 이름(gather only)
  extra?: string[];       // EXTRA_SOURCES 의 표 이름
  logiTickets?: boolean;  // 물류 일정(as_tickets 납품·철수·교체)도 모으고, 그 일정 제목으로 남은 물류 기록을 잇는다(gatherLogisticsTickets)
  chips?: TabChip[];      // 점검·AS 처럼 안에서 거르는 칩([전체]는 화면이 붙인다)
  summary: SummaryKind[];
  note?: string;          // 거르는 기준 안내(청정기·교체)
  kakaoKinds?: string[];  // 카톡 대화 탭이 볼 방 종류(kakao_collect_rooms.kinds). 없으면 수집 대상 방이 없는 탭
};

// 청정기 판정 — src/api.ts AIR_RX(청정기 거래처검색)와 같은 기준. api.ts 는 무거워 끌어오지 않고 같은 식을 둔다
export const AIR_RX = /블루스카이|샤오미|xiaomi|mi[\s-]?air|blue\s?sky/i;
const SWAP_RX = /교체/;

// 2026-10-24: 접수·일정(service_receptions·as_tickets)은 뺐다 — "점검·AS 이력"에 아직 처리 전인 접수가 섞인다는 피드백
const INSPECTION_CHIPS: TabChip[] = [
  { key: "jeom", label: "점검", tables: ["jeomgeom", "visit_logs"] },
  { key: "as", label: "AS", tables: ["as_records"] },
];

const LOGI_TABLES = ["logistics_records", "as_tickets", "activity_events", "lease_status"];

export const TAB_SPECS: Record<TabKey, TabSpec> = {
  inspection: {
    key: "inspection", label: "점검·AS", question: "이 업체 점검·AS 이력 — 업체명·자산·시리얼",
    tables: ["jeomgeom", "visit_logs", "as_records"], chips: INSPECTION_CHIPS, kakaoKinds: ["점검", "AS"],
    summary: [{ label: "점검", tables: ["jeomgeom", "visit_logs"] }, { label: "AS", tables: ["as_records"] }],
  },
  air: {
    key: "air", label: "청정기", question: "이 업체 청정기 점검·AS — 업체명·자산·시리얼",
    tables: ["jeomgeom", "as_records"], kakaoKinds: ["점검", "AS"],
    summary: [{ label: "청정기 점검", tables: ["jeomgeom"] }, { label: "청정기 AS", tables: ["as_records"] }],
    note: "모델명·원문에 청정기 브랜드(블루스카이·샤오미)가 있는 기록만",
  },
  logistics: {
    key: "logistics", label: "물류", question: "이 업체 납품·철수·교체 — 업체명·자산·시리얼",
    // 2026-10-24: 물류 양식 기록만 보면 "일정으로 처리한 납품"이 빠진다 — 물류 일정(완료)·활동(물류)도 같이, 같은 날·같은 종류는 한 줄(dedupeLogistics)
    tables: ["logistics_records", "activity_events", "lease_status", "vendor_info"], logiTickets: true, kakaoKinds: ["물류"],
    summary: [
      { label: "납품", tables: LOGI_TABLES, match: /납품|설치|신규/ },
      { label: "철수", tables: LOGI_TABLES, match: /철수|회수|해지/ },
      { label: "교체", tables: LOGI_TABLES, match: SWAP_RX },
    ],
  },
  it: {
    key: "it", label: "IT 확장성", question: "이 업체 IT 확장성 기록 — 업체명",
    tables: ["pc_expansion"], summary: [{ label: "IT 확장성", tables: ["pc_expansion"] }],
  },
  "copier-exp": {
    key: "copier-exp", label: "복합기 확장성", question: "이 업체 복합기(기타) 확장성 — 업체명",
    tables: ["mfp_expansion"], summary: [{ label: "확장성", tables: ["mfp_expansion"] }],
  },
  contact: {
    key: "contact", label: "담당자/주소 변경", question: "이 업체 담당자·주소 변경 — 업체명",
    tables: ["contact_changes"], summary: [{ label: "변경", tables: ["contact_changes"] }],
  },
  bulman: {
    key: "bulman", label: "불만", question: "이 업체 불만 이력 — 업체명",
    tables: ["bulman"], summary: [{ label: "불만", tables: ["bulman"] }], kakaoKinds: ["불만"],
  },
  misu: {
    key: "misu", label: "미수", question: "이 업체 미수 이력 — 업체명",
    tables: ["misu"], extra: ["misu_visits"], kakaoKinds: ["미수"],
    summary: [{ label: "미수 방문", tables: ["misu_visits"] }, { label: "미수 기록", tables: ["misu"] }],
  },
  overage: {
    key: "overage", label: "초과조정", question: "이 업체 초과료·조정 — 업체명·자산",
    tables: ["overage_adjust", "overage"], kakaoKinds: ["재계약", "초과조정"], // 초과조정 글은 재계약 방(…/초과사용 계약종료체크)에 있다
    summary: [{ label: "조정 제안", tables: ["overage_adjust"] }, { label: "초과료", tables: ["overage"] }],
  },
  recontract: {
    key: "recontract", label: "재계약", question: "이 업체 재계약 이력 — 업체명",
    // churn_defense(해지방어)는 칸 이름을 아직 몰라 SOURCES 에 없다(entity360 주석) — 데이터가 생기면 추가
    tables: ["recontract"], summary: [{ label: "재계약", tables: ["recontract"] }], kakaoKinds: ["재계약"],
  },
  replacement: {
    key: "replacement", label: "교체", question: "이 업체 기기 교체 이력 — 업체명·자산·시리얼",
    tables: ["lease_status", "logistics_records"], summary: [{ label: "교체", tables: ["lease_status", "logistics_records"] }], kakaoKinds: ["물류"],
    note: "구분·분류에 '교체'가 있는 납품·물류 기록만",
  },
  // 칭찬 탭 = 고객 칭찬 접수(PraiseForm → field_sheet_sync_jobs category=praise). 직원끼리 칭찬(praise_posts)은 업체 칸이 없어 업체 검색 대상이 아니다
  praise: {
    key: "praise", label: "칭찬", question: "이 업체 고객 칭찬 — 업체명",
    tables: [], extra: ["field_sheet_sync_jobs"], summary: [{ label: "칭찬", tables: ["field_sheet_sync_jobs"] }],
  },
};

/** 필드 탭(mode·확장성 하위 탭) → 검색 탭. null = 검색칸 숨김(테스트 탭 등) */
export function tabKeyOf(mode: string, pcSubTab?: string): TabKey | null {
  switch (mode) {
    case "inspection": case "blank-report": case "samsung-note": return "inspection";
    case "air-purifier": return "air";
    case "logistics": return "logistics";
    case "pc": return pcSubTab === "it" ? "it" : pcSubTab === "copier" ? "copier-exp" : null;
    case "contact-change": return "contact";
    case "bulman": return "bulman";
    case "misu": return "misu";
    case "overage-adjust": return "overage";
    case "recontract": return "recontract";
    case "replacement": return "replacement";
    case "praise": return "praise";
    default: return null;
  }
}

// ── SOURCES 밖 표 ──────────────────────────────────────────
export const EXTRA_SOURCES: SourceDef[] = [
  // CS 미수 방문이력(2026-10-22). SQL 실행 전이면 404 → 조용히 건너뜀. 정의 원본은 entity360(통합 검색 360 과 같은 객체, 2026-10-24)
  MISU_VISITS_SOURCE,
  // 고객 칭찬(2026-10-24) — 칭찬 양식은 시트 기입 큐(field_sheet_sync_jobs)에만 남는다. 날짜·이유는 payload.data 에서 별칭으로 꺼낸다
  { table: "field_sheet_sync_jobs", label: "칭찬", group: "고객 소통", tone: "bg-lime-50 text-lime-800 border-lime-200",
    nameCols: ["vendor"], deviceCols: [], rawCols: ["source_text"], hidden: "category=eq.praise",
    select: "*,praise_date:payload->data->>date,praise_reason:payload->data->>reason,praise_manager:payload->data->>manager,praise_grade:payload->data->>grade",
    dateKeys: ["praise_date", "created_at"], titleKeys: ["praise_reason"], snippetKeys: ["praise_manager", "praise_grade"],
    authorKeys: ["author"], teamKeys: ["region"], modelKeys: [], serialKeys: [], assetKeys: [],
    titleFn: (row) => `칭찬 — ${str(row, "praise_reason") || "이유 없음"}`,
    limit: 200 },
];

// ── 물류 일정(as_tickets) ─────────────────────────────────────
// 물류 일정 제목은 "글머리-납품(일반)/퍼스트/운영팀/증설/고객사/품목/비고" 꼴이고 캘린더에서 100자쯤에서 잘린다.
// 글머리가 길면 고객사 칸까지 잘려(2026-10-23 디지털자산 거래소 공동협의체 납품) 제목으로는 업체를 못 찾는다 — 본문(note)의 "상호(명) :" 줄이 정확하다.
/** 물류 일정의 고객사 이름 — 본문 "상호 :" 줄 → 제목 슬래시 열차 순 */
export function ticketVendorOf(row: Row): string {
  return logisticsTicketInfo(str(row, "vendor"), str(row, "note")).vendor;
}
/** 물류 일정 종류 — 본문 첫 줄("납품 (일반/장기)", "교체") → 제목의 "납품(일반)"·"철수(일반)" 꼴 → 낱말 */
export function ticketLogiKind(row: Row): string {
  const first = str(row, "note").split("\n")[0] || "";
  const head = first.match(/^\s*(판매납품|납품|철수|교체|이전|세팅|셋팅)/)?.[1];
  if (head) return normalizeLogisticsKind(head);
  const title = str(row, "calendarTitle") || str(row, "vendor"); // 2026-10-24 오후: 업체명 칸은 고객사만 남으므로 종류는 전체 제목에서
  const inTitle = title.match(/(납품|철수|교체)\(/)?.[1];
  if (inTitle) return inTitle;
  const k = normalizeLogisticsKind(`${title} ${first}`);
  return k === "기타" ? "물류" : k;
}
const TICKET_TYPES = `scheduleType=in.(${LOGISTICS_SCHEDULE_TYPES.map((t) => encodeURIComponent(`"${t}"`)).join(",")})`;
export const LOGI_TICKET_SOURCE: SourceDef = {
  table: "as_tickets", label: "물류 일정", group: "현장 기록", tone: "bg-yellow-50 text-yellow-800 border-yellow-200",
  nameCols: ["vendor"], deviceCols: [], rawCols: ["note"], codeCol: "vendor_code", hidden: TICKET_TYPES,
  dateKeys: ["date"], titleKeys: ["vendor"], snippetKeys: ["assignee", "team"], authorKeys: ["assignee"], teamKeys: ["team"], modelKeys: ["model"], serialKeys: ["serial"], assetKeys: ["asset"],
  titleFn: (row) => `${ticketLogiKind(row)} ${/완료/.test(str(row, "status")) ? "완료" : str(row, "status")} — ${ticketVendorOf(row) || str(row, "vendor")}`,
  limit: 200,
};
/** 이 일정이 찾는 업체 것인가 — 거래처 코드 또는 본문·제목에서 꺼낸 고객사 이름 키 */
export function ticketMatches(row: Row, e: Entity): boolean {
  if (e.code && str(row, "vendor_code") === e.code) return true;
  const keys = [ticketVendorOf(row), logisticsTicketInfo(str(row, "vendor")).vendor].map(vendorMatchKey).filter((k) => k.length >= 2);
  return keys.some((k) => e.nameKeys.some((n) => sameVendorKey(n, k)));
}
/** 물류 일정 조회 — 코드·이름 일치 + 본문/제목에 핵심 이름(넓게 받아 ticketMatches 로 정확·느슨을 가른다) */
export function buildLogiTicketQuery(e: Entity): string | null {
  const parts: string[] = [];
  if (e.code) parts.push(`vendor_code.eq.${encodeURIComponent(e.code)}`);
  if (e.names.length) parts.push(`vendor.${inList(e.names)}`);
  if (e.core && e.core.length >= 2) ["note", "vendor"].forEach((c) => parts.push(`${c}.ilike.*${encodeURIComponent(e.core)}*`));
  if (!parts.length) return null;
  return `select=*&${TICKET_TYPES}&or=(${parts.join(",")})&order=date.desc&limit=200`;
}
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const daysApart = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/** 표가 아직 없음(SQL 실행 전) — PostgREST 404 / PGRST205 / 42P01 */
export const isTableMissing = (msg: string) => /\(404\)|PGRST205|42P01|does not exist|Could not find the table/i.test(String(msg || ""));

/** 탭이 보는 표 정의 목록(SOURCES + 덧붙인 것) — 화면의 "찾아본 곳" 문구에도 쓴다 */
export function sourcesOf(spec: TabSpec): SourceDef[] {
  const base = spec.tables.map((t) => SOURCES.find((s) => s.table === t)).filter((s): s is SourceDef => !!s);
  const extra = (spec.extra || []).map((t) => EXTRA_SOURCES.find((s) => s.table === t)).filter((s): s is SourceDef => !!s);
  return [...base, ...extra, ...(spec.logiTickets ? [LOGI_TICKET_SOURCE] : [])];
}

// ── 개인정보 가림 ─────────────────────────────────────────────
// 본문은 src/privacy.ts(엣지 함수와 공용). 2026-10-22 전엔 하이픈 없는 13자리도 가려 기기 시리얼(8001104…)까지 가려졌다 — 이제 이름표가 있을 때만
export { maskRrn };

// ── 결과 → 타임라인 줄 ─────────────────────────────────────────
export type TabLine = {
  key: string; table: string; kind: string; tone: string;
  date: string; title: string; detail: string; author: string; team: string;
  device: string;      // 모델·자산·시리얼 한 줄
  raw: string;         // 펼침용 원문(가림 적용)
  loose: boolean;      // 이름 일부만 일치(확인 필요)
  otherVendor: string; // 같은 기기가 다른 업체 이름으로 남은 기록이면 그 이름
  vendor: string;      // 기록에 적힌 업체명(가림 적용) — 펼침의 "같은 업체 이력" 묶음
  logiKind: string;    // 물류 탭만: 납품·철수·교체·여분… (같은 날·같은 종류 한 줄로 묶는 기준)
  formText?: string;   // 점검·AS 탭의 jeomgeom·as_records 줄만: 양식 [불러오기]에 넣을 _원문 전체(가림·자르기 없음 — 거래처검색 불러오기와 같은 글)
};

/** [불러오기]에 넣을 양식 원문 — 점검·AS 탭의 점검(jeomgeom)·AS(as_records) 기록만. 다른 탭·표(방문기록·물류·불만…)는 "" = 단추 없음 */
export function loadableFormText(tab: TabKey, table: string, row: Row): string {
  if (tab !== "inspection") return "";
  if (table !== "jeomgeom" && table !== "as_records") return "";
  return str(row, "_원문").trim() ? str(row, "_원문") : "";
}

/** 이 줄에 [불러오기] 단추를 그릴까 — 불러오기 함수를 받은 화면(점검·AS 탭) + 양식 원문이 있는 점검·AS 기록 */
export function canLoadLine(line: Pick<TabLine, "formText">, onLoad: unknown): boolean {
  return typeof onLoad === "function" && !!line.formText;
}

/** 불러온 뒤 토스트 — "○○ 2026-10-20 AS 기록을 불러왔습니다" */
export function loadedToast(line: Pick<TabLine, "vendor" | "date" | "kind">): string {
  return [line.vendor, line.date, `${line.kind} 기록을 불러왔습니다`].filter(Boolean).join(" ");
}

/** 탭 기준으로 남길 행인가 — 청정기·교체·방문기록(점검) 거름 */
export function keepRow(tab: TabKey, table: string, row: Row): boolean {
  if (tab === "air") return AIR_RX.test(str(row, "모델명")) || AIR_RX.test(str(row, "_원문"));
  // 물류: 활동은 물류 종류만, 일정은 완료된 것만(배정·접수는 아직 안 한 일 — 이어 찾기에는 쓴다)
  if (tab === "logistics" && table === "activity_events") return str(row, "category") === "logistics";
  if (tab === "logistics" && table === "as_tickets") return /완료/.test(str(row, "status"));
  if (tab === "replacement") return SWAP_RX.test(`${str(row, "구분")} ${str(row, "분류")} ${str(row, "교체전기종")}`);
  if (tab === "inspection" && table === "visit_logs") return /점검/.test(str(row, "work_kinds"));
  return true;
}

/** 물류 기록 한 줄의 종류(납품·철수·교체·여분…) */
export function logiKindOf(table: string, row: Row): string {
  if (table === "as_tickets") return ticketLogiKind(row);
  if (table === "activity_events") {
    const meta = row.metadata && typeof row.metadata === "object" ? String((row.metadata as Record<string, unknown>).logisticsCategory || "") : "";
    const fromText = str(row, "source_text").match(/^[^\S\n]*구분[^\S\n]*[:：][^\S\n]*(.+)$/m)?.[1] || "";
    return normalizeLogisticsKind(meta || fromText);
  }
  if (table === "logistics_records") return normalizeLogisticsKind(str(row, "구분"));
  return "";
}

// 같은 날·같은 업체·같은 종류 물류는 한 줄로 — 물류 양식 기록 > 물류 일정 > 활동 순으로 남긴다(한 번 전송이 물류 기록·활동 두 표에 같이 쌓인다)
const LOGI_DEDUP_RANK: Record<string, number> = { logistics_records: 0, as_tickets: 1, activity_events: 2 };
export function dedupeLogistics(lines: TabLine[]): TabLine[] {
  const ranked = (l: TabLine) => l.table in LOGI_DEDUP_RANK && !!l.date && !!l.logiKind;
  const best = new Map<string, TabLine>();
  for (const l of lines.filter(ranked)) {
    const k = `${l.loose ? `L|${vendorMatchKey(l.vendor)}` : "E"}|${l.date}|${l.logiKind}`;
    const cur = best.get(k);
    if (!cur || LOGI_DEDUP_RANK[l.table] < LOGI_DEDUP_RANK[cur.table]) best.set(k, l);
  }
  const keep = new Set(Array.from(best.values()).map((l) => l.key));
  return lines.filter((l) => !ranked(l) || keep.has(l.key));
}

export function toLines(tab: TabKey, results: SourceResult[], e: Entity | null): TabLine[] {
  const out: TabLine[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    const push = (row: Row, loose: boolean) => {
      if (!keepRow(tab, r.source.table, row)) return;
      const ev = toEvent(r.source, row, loose);
      if (seen.has(ev.key)) return;
      seen.add(ev.key);
      const device = [ev.model, ev.asset && `자산 ${ev.asset}`, ev.serial && `S/N ${ev.serial}`].filter(Boolean).join(" · ");
      const logiKind = tab === "logistics" ? logiKindOf(r.source.table, row) : "";
      let title = maskRrn(ev.title || r.source.label);
      if (logiKind && !title.includes(logiKind)) title = `${logiKind} · ${title}`;
      // 물류 일정의 원문은 본문(note) — 제목은 잘린 캘린더 제목이라 그것만으로는 쓸모가 적다
      const ticket = r.source.table === "as_tickets";
      const via = str(row, "_viaTicket"); // 물류 일정 제목으로 이어 찾은 기록(gatherLogisticsTickets)
      const rawText = ticket ? [str(row, "vendor"), str(row, "note")].filter(Boolean).join("\n\n") : rawTextOf(row) || firstOf(row, r.source.titleKeys);
      out.push({
        key: ev.key, table: r.source.table, kind: r.source.label, tone: r.source.tone,
        date: ev.date, title, detail: maskRrn(ev.snippet), author: maskRrn(ev.author), team: ev.team,
        device: maskRrn(device), raw: maskRrn(rawText).slice(0, 2000), loose,
        otherVendor: e && !via && isOtherVendor(ev, e) ? maskRrn(ev.vendor) : "",
        vendor: maskRrn(via || (ticket && ticketVendorOf(row)) || ev.vendor), logiKind,
        formText: loadableFormText(tab, r.source.table, row),
      });
    };
    r.exact.forEach((row) => push(row, false));
    r.loose.forEach((row) => push(row, true));
  }
  // 최신 위. 날짜 없는 줄은 맨 아래
  const sorted = out.sort((a, b) => (b.date || "0000").localeCompare(a.date || "0000") || a.key.localeCompare(b.key));
  return tab === "logistics" ? dedupeLogistics(sorted) : sorted;
}

/** 펼침의 "같은 업체 · 같은 종류 최근 n건" — 이미 모은 줄에서만(추가 조회 없음). 정확 일치 줄이면 정확 일치끼리, 이름 일부 일치면 같은 이름끼리 */
export function relatedLines(lines: TabLine[], line: TabLine, n = 5): TabLine[] {
  const vk = vendorMatchKey(line.vendor);
  return lines.filter((l) => l.key !== line.key && l.kind === line.kind && (!line.logiKind || l.logiKind === line.logiKind)
    && (line.loose ? l.loose && !!vk && vendorMatchKey(l.vendor) === vk : !l.loose)).slice(0, n);
}

/** 칩으로 거르기. chipKey 가 없거나 "all" 이면 전부 */
export function filterByChip(lines: TabLine[], spec: TabSpec, chipKey: string): TabLine[] {
  const chip = spec.chips?.find((c) => c.key === chipKey);
  return chip ? lines.filter((l) => chip.tables.includes(l.table)) : lines;
}

export type SummaryPart = { label: string; date: string };
/** 탭 종류의 마지막 사건 — 정확 일치 줄만 본다(이름 일부 일치는 빼고) */
export function lastEvents(spec: TabSpec, lines: TabLine[]): SummaryPart[] {
  return spec.summary.map((k) => {
    const hit = lines.find((l) => !l.loose && l.date && k.tables.includes(l.table) && (!k.match || k.match.test(`${l.title} ${l.detail}`)));
    return { label: k.label, date: hit?.date || "" };
  });
}
export const summaryText = (parts: SummaryPart[]): string =>
  parts.map((p) => (p.date ? `마지막 ${p.label} ${p.date}` : `${p.label} 없음`)).join(" · ");

export type Coverage = { searched: string[]; failed: string[]; missing: string[]; rawSkipped: string[] };
/** 어디까지 찾았는지 — 빈 결과·실패 안내에 쓴다 */
export function coverageOf(results: TabResult[]): Coverage {
  const labels = (pred: (r: TabResult) => boolean) => Array.from(new Set(results.filter(pred).map((r) => r.source.label)));
  return {
    searched: labels((r) => r.ok && !r.missing),
    failed: labels((r) => !r.ok),
    missing: labels((r) => !!r.missing),
    rawSkipped: labels((r) => r.ok && !!r.rawSkipped),
  };
}

// ── 조회 ─────────────────────────────────────────────────────
export type TabResult = SourceResult & { missing?: boolean };

/** SOURCES 밖 표 하나 — gather 의 정확·느슨(승격) 규칙을 같은 조립 함수로. 원문 검색은 하지 않는다(덧붙인 표는 원문 칸이 없다) */
export async function gatherExtra(src: SourceDef, e: Entity): Promise<TabResult> {
  try {
    const q = buildExactQuery(src, e);
    const exact: Row[] = q ? await selectRows<Row>(src.table, q) : [];
    const seen = new Set(exact.map((r) => String(r.id)));
    const loose: Row[] = [];
    const lq = buildLooseQuery(src, e);
    if (lq) {
      for (const r of await selectRows<Row>(src.table, lq)) {
        if (seen.has(String(r.id))) continue;
        seen.add(String(r.id));
        (matchesEntity(src, r, e) ? exact : loose).push(r);
      }
    }
    return { source: src, exact, loose, ok: true };
  } catch (err) {
    const msg = (err as Error).message || String(err);
    if (isTableMissing(msg)) return { source: src, exact: [], loose: [], ok: true, missing: true };
    return { source: src, exact: [], loose: [], ok: false, error: msg.slice(0, 120) };
  }
}

/**
 * 물류 일정 모으기 — 이 업체 것(ticketMatches)은 정확, 이름만 비슷한 것은 느슨. 상태는 여기서 거르지 않는다(화면엔 완료만 — keepRow).
 * 그리고 이 업체 일정의 제목 그대로 거래처명이 적힌 물류 기록·활동을 찾아 돌려준다(bridge):
 * 일정에서 물류 양식을 열면 잘린 일정 제목이 거래처명으로 들어가(App openLogisticsTicketInfield → logisticsTicketInfo) 업체명으로는 안 걸린다.
 */
export async function gatherLogisticsTickets(e: Entity): Promise<{ tickets: TabResult; bridge: { logistics_records: Row[]; activity_events: Row[] } }> {
  const bridge = { logistics_records: [] as Row[], activity_events: [] as Row[] };
  try {
    const q = buildLogiTicketQuery(e);
    const rows = q ? await selectRows<Row>("as_tickets", q) : [];
    const exact: Row[] = [];
    const loose: Row[] = [];
    rows.forEach((r) => (ticketMatches(r, e) ? exact : loose).push(r));
    // 제목 → 날짜들. 짧은 제목("납품")은 다른 업체와 겹칠 수 있어 잇지 않는다
    const datesOfTitle = new Map<string, string[]>();
    const vendorOfTitle = new Map<string, string>();
    exact.forEach((r) => {
      const t = str(r, "vendor");
      if (t.length < 12) return;
      datesOfTitle.set(t, [...(datesOfTitle.get(t) || []), str(r, "date").slice(0, 10)]);
      if (!vendorOfTitle.has(t)) vendorOfTitle.set(t, ticketVendorOf(r));
    });
    const titles = Array.from(datesOfTitle.keys()).slice(0, 30);
    if (titles.length) {
      // 같은 제목이라도 일정 날짜와 2주 넘게 떨어진 기록은 다른 건으로 본다
      const near = (title: string, date: string) => YMD.test(date) && (datesOfTitle.get(title) || []).some((d) => YMD.test(d) && daysApart(d, date) <= 14);
      const [lr, ae] = await Promise.all([
        selectRows<Row>("logistics_records", `select=*&${encodeURIComponent('"_업체명"')}=${inList(titles)}&_hidden=not.is.true&limit=200`),
        selectRows<Row>("activity_events", `select=*&category=eq.logistics&vendor=${inList(titles)}&status=neq.cancelled&limit=200`),
      ]);
      // _viaTicket: 일정 제목으로 이은 행 — 화면은 "당시 다른 업체" 표시 대신 일정 본문의 고객사 이름을 쓴다
      bridge.logistics_records = lr.filter((r) => near(str(r, "_업체명"), str(r, "작성일").slice(0, 10))).map((r) => ({ ...r, _viaTicket: vendorOfTitle.get(str(r, "_업체명")) || "" }));
      bridge.activity_events = ae.filter((r) => near(str(r, "vendor"), str(r, "activity_date").slice(0, 10))).map((r) => ({ ...r, _viaTicket: vendorOfTitle.get(str(r, "vendor")) || "" }));
    }
    return { tickets: { source: LOGI_TICKET_SOURCE, exact, loose, ok: true }, bridge };
  } catch (err) {
    return { tickets: { source: LOGI_TICKET_SOURCE, exact: [], loose: [], ok: false, error: ((err as Error).message || String(err)).slice(0, 120) }, bridge };
  }
}

/** 일정 제목으로 이어 찾은 기록을 그 표 결과의 정확 일치에 붙인다(느슨에 있던 같은 행은 정확으로 옮긴다) */
export function mergeBridge(results: TabResult[], table: string, rows: Row[]): void {
  const r = results.find((x) => x.source.table === table);
  if (!r || !rows.length) return;
  const have = new Set(r.exact.map((x) => String(x.id)));
  const add = rows.filter((x) => !have.has(String(x.id)));
  const ids = new Set(add.map((x) => String(x.id)));
  r.loose = r.loose.filter((x) => !ids.has(String(x.id)));
  r.exact = [...r.exact, ...add];
}

/**
 * 정확도 느슨도 0건인 표만 한 번 더 — 핵심 이름 앞 3글자로(2026-10-24: "어울림디자인스튜디오" 로 찾으면 재계약 "어울림스튜디오디자인" 이 안 나왔다).
 * 나온 행은 matchesEntity(낱말 순서만 바뀐 이름 포함)로 정확·느슨을 가른다. 한글 핵심 이름 5자 이상일 때만.
 */
export function buildHeadQuery(src: SourceDef, e: Entity): string | null {
  const cols = src.looseCols || src.nameCols;
  if (!e.core || e.core.length < 5 || !cols.length || !/^[가-힣]{3}/.test(e.core)) return null;
  const head = encodeURIComponent(e.core.slice(0, 3));
  const c = (name: string) => (/[^A-Za-z0-9_]/.test(name) ? encodeURIComponent(`"${name}"`) : name);
  return `select=${src.select || "*"}&or=(${cols.map((name) => `${c(name)}.ilike.*${head}*`).join(",")})${src.hidden ? `&${src.hidden}` : ""}&limit=${src.limit || 200}`;
}
export async function retryByHead(r: TabResult, e: Entity): Promise<TabResult> {
  if (!r.ok || r.missing || r.exact.length || r.loose.length) return r;
  const q = buildHeadQuery(r.source, e);
  if (!q) return r;
  let rows: Row[];
  try {
    rows = await selectRows<Row>(r.source.table, q);
  } catch (err) {
    // 0건이 진짜 0건인지 모르게 됐다 — 화면에 "못 불러옴"으로 알린다(조용히 "없음"으로 두지 않는다)
    return { ...r, ok: false, error: ((err as Error)?.message || String(err)).slice(0, 120) };
  }
  const exact: Row[] = [];
  const loose: Row[] = [];
  rows.forEach((row) => (matchesEntity(r.source, row, e) ? exact : loose).push(row));
  return { ...r, exact, loose };
}

/** 탭 검색 한 번 — 그 탭 표만 병렬로. 표별 실패는 ok:false 로 남기고 나머지는 그대로 */
export async function runTabSearch(spec: TabSpec, e: Entity): Promise<TabResult[]> {
  const extras = sourcesOf(spec).filter((s) => (spec.extra || []).includes(s.table));
  const [base, more, logi] = await Promise.all([
    spec.tables.length ? gather(e, { only: spec.tables }) : Promise.resolve([] as SourceResult[]),
    Promise.all(extras.map((s) => gatherExtra(s, e))),
    spec.logiTickets ? gatherLogisticsTickets(e) : Promise.resolve(null),
  ]);
  const results: TabResult[] = await Promise.all([...base, ...more].map((r) => retryByHead(r, e)));
  if (logi) {
    mergeBridge(results, "logistics_records", logi.bridge.logistics_records);
    mergeBridge(results, "activity_events", logi.bridge.activity_events);
    results.push(logi.tickets);
  }
  return results;
}

/** 표 수집 요청 수 상한(업체 찾기·키 묶음 제외) — SOURCES 표는 정확·원문·느슨·앞글자 최대 4, 덧붙인 표는 정확·느슨·앞글자 3, 물류 일정은 일정 1 + 이어 찾기 2 */
export function maxRequestsOf(spec: TabSpec): number {
  return spec.tables.length * 4 + (spec.extra || []).length * 3 + (spec.logiTickets ? 3 : 0);
}

// ── 카톡 대화(2단계, 2026-10-24) ─────────────────────────────────
// 원문은 kakao_messages(anon 권한 0) — 엣지 kakao-search 로만 읽는다. 스위치 KAKAO_SEARCH_ENABLED 가 꺼져 있으면 enabled:false.
// 설계: docs/tasks/tab-search-kakao-history.md 3-2·7절 R1, docs/tasks/kakao-collect-expand.md 3-5.
export type KakaoHit = { id: number; room: string; sent_at: string; seq: number; author: string; text: string; kind_guess: string | null; is_bot: boolean };
export type KakaoSearchResult = { ok: boolean; enabled: boolean; rows: KakaoHit[]; limit: number; truncated: boolean; error?: string };
export type KakaoSearchOpts = { from?: string; to?: string; limit?: number; who?: string };

export const KAKAO_LIMIT = 100;

/** kakao-search 요청 몸통. 그 탭에 수집 방 종류가 없거나 검색어가 2자 미만이면 null(부르지 않는다) */
export function buildKakaoRequest(spec: TabSpec, q: string, opts: KakaoSearchOpts = {}): Record<string, unknown> | null {
  const query = String(q || "").trim();
  if (!spec.kakaoKinds?.length) return null;
  if (query.replace(/[^0-9A-Za-z가-힣]/g, "").length < 2) return null;
  const body: Record<string, unknown> = { q: query.slice(0, 60), kinds: spec.kakaoKinds, limit: Math.min(200, opts.limit || KAKAO_LIMIT) };
  if (opts.from) body.from = opts.from;
  if (opts.to) body.to = opts.to;
  if (opts.who) body.who = opts.who;
  return body;
}

/** 카톡 대화 찾기 — 실패는 throw(화면이 안내). 탭에 방이 없으면 빈 결과 */
export async function searchKakao(spec: TabSpec, q: string, opts: KakaoSearchOpts = {}): Promise<KakaoSearchResult> {
  const body = buildKakaoRequest(spec, q, opts);
  if (!body) return { ok: true, enabled: true, rows: [], limit: 0, truncated: false };
  const res = await invokeEdgeFunction<KakaoSearchResult>("kakao-search", body, 15_000);
  if (!res || res.ok === false) throw new Error(res?.error || "카톡 대화를 못 불러왔습니다");
  return { ...res, rows: (res.rows || []).map((r) => ({ ...r, text: maskRrn(r.text), author: maskRrn(r.author) })) };
}

/** 저장 시각(UTC 로 올 수 있음) → KST "2026-10-23 14:31" */
export function kakaoTimeLabel(sentAt: string): string {
  const t = Date.parse(sentAt);
  if (!Number.isFinite(t)) return String(sentAt || "").slice(0, 16).replace("T", " ");
  return new Date(t + 9 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");
}

/** 본문 하이라이트 조각 — 검색 낱말(대소문자 무시)이 든 곳을 hit:true 로. 낱말이 없으면 통째 한 조각 */
export function highlightParts(text: string, q: string): Array<{ t: string; hit: boolean }> {
  const src = String(text || "");
  const terms = String(q || "").trim().split(/\s+/).filter((w) => w.length >= 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!terms.length || !src) return [{ t: src, hit: false }];
  const rx = new RegExp(`(${terms.join("|")})`, "gi");
  const out: Array<{ t: string; hit: boolean }> = [];
  let last = 0;
  for (const m of src.matchAll(rx)) {
    const i = m.index ?? 0;
    if (!m[0]) continue;
    if (i > last) out.push({ t: src.slice(last, i), hit: false });
    out.push({ t: m[0], hit: true });
    last = i + m[0].length;
  }
  if (last < src.length) out.push({ t: src.slice(last), hit: false });
  return out.length ? out : [{ t: src, hit: false }];
}
