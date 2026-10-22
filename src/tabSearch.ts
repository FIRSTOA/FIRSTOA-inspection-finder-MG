/**
 * 필드 탭별 검색(1단계, 2026-10-22) — 탭 맨 위 검색칸에 업체명·자산·시리얼을 치면 "그 탭 업무"의 FIELD 기록만 한 줄 타임라인으로.
 * 설계: docs/tasks/tab-search-kakao-history.md 3-1·4절. 카톡 원문(2단계)은 아직 없다 — 화면에 자리만.
 *
 * - 업체 찾기·키 묶음·표 수집은 통합 검색 360(src/entity360.ts)을 그대로 쓴다: gather(e, { only }) 로 그 탭 표만.
 * - SOURCES 에 없는 표(misu_visits)는 SOURCES 를 고치지 않고 여기 EXTRA_SOURCES 로 덧붙여 같은 조건 조립 함수로 모은다.
 * - 건수는 세지 않는다(건수 원본 = src/workCount.ts). 요약은 "마지막 사건" 날짜만.
 * - 주민번호 모양 값(앞6-뒤7)은 화면에 내보내기 전에 가린다(maskRrn — 본문은 src/privacy.ts, 2026-10-22 옮김).
 *
 * React 없는 순수 로직 + 조회 한 함수(runTabSearch). 테스트: tests/tabSearch.test.ts
 */
import {
  buildExactQuery, buildLooseQuery, firstOf, gather, isOtherVendor, matchesEntity, rawTextOf, SOURCES, str, toEvent,
  type Entity, type Row, type SourceDef, type SourceResult,
} from "./entity360";
import { selectRows } from "./supabase";
import { maskRrn } from "./privacy";

// ── 탭 정의 ─────────────────────────────────────────────────
export type TabKey =
  | "inspection" | "air" | "logistics" | "it" | "copier-exp" | "contact" | "bulman" | "misu" | "overage" | "recontract" | "replacement";

export type TabChip = { key: string; label: string; tables: string[] };
/** 요약 한 줄의 한 칸 — "마지막 납품 2025-03-10" / "철수 없음" */
export type SummaryKind = { label: string; tables: string[]; match?: RegExp };

export type TabSpec = {
  key: TabKey;
  label: string;          // "물류"
  question: string;       // 검색칸 안내 — "이 업체 물류 이력 — 업체명·자산·시리얼"
  tables: string[];       // SOURCES 의 표 이름(gather only)
  extra?: string[];       // EXTRA_SOURCES 의 표 이름
  chips?: TabChip[];      // 점검·AS 처럼 안에서 거르는 칩([전체]는 화면이 붙인다)
  summary: SummaryKind[];
  note?: string;          // 거르는 기준 안내(청정기·교체)
};

// 청정기 판정 — src/api.ts AIR_RX(청정기 거래처검색)와 같은 기준. api.ts 는 무거워 끌어오지 않고 같은 식을 둔다
export const AIR_RX = /블루스카이|샤오미|xiaomi|mi[\s-]?air|blue\s?sky/i;
const SWAP_RX = /교체/;

const INSPECTION_CHIPS: TabChip[] = [
  { key: "jeom", label: "점검", tables: ["jeomgeom", "visit_logs"] },
  { key: "as", label: "AS", tables: ["as_records"] },
  { key: "recv", label: "접수·일정", tables: ["service_receptions", "as_tickets"] },
];

export const TAB_SPECS: Record<TabKey, TabSpec> = {
  inspection: {
    key: "inspection", label: "점검·AS", question: "이 업체 점검·AS 이력 — 업체명·자산·시리얼",
    tables: ["jeomgeom", "visit_logs", "as_records", "service_receptions", "as_tickets"], chips: INSPECTION_CHIPS,
    summary: [{ label: "점검", tables: ["jeomgeom", "visit_logs"] }, { label: "AS", tables: ["as_records"] }, { label: "접수", tables: ["service_receptions"] }],
  },
  air: {
    key: "air", label: "청정기", question: "이 업체 청정기 점검·AS — 업체명·자산·시리얼",
    tables: ["jeomgeom", "as_records"],
    summary: [{ label: "청정기 점검", tables: ["jeomgeom"] }, { label: "청정기 AS", tables: ["as_records"] }],
    note: "모델명·원문에 청정기 브랜드(블루스카이·샤오미)가 있는 기록만",
  },
  logistics: {
    key: "logistics", label: "물류", question: "이 업체 납품·철수·교체 — 업체명·자산·시리얼",
    tables: ["logistics_records", "lease_status", "vendor_info"],
    summary: [
      { label: "납품", tables: ["logistics_records", "lease_status"], match: /납품|설치|신규/ },
      { label: "철수", tables: ["logistics_records", "lease_status"], match: /철수|회수|해지/ },
      { label: "교체", tables: ["logistics_records", "lease_status"], match: SWAP_RX },
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
    tables: ["bulman"], summary: [{ label: "불만", tables: ["bulman"] }],
  },
  misu: {
    key: "misu", label: "미수", question: "이 업체 미수 이력 — 업체명",
    tables: ["misu"], extra: ["misu_visits"],
    summary: [{ label: "미수 방문", tables: ["misu_visits"] }, { label: "미수 기록", tables: ["misu"] }],
  },
  overage: {
    key: "overage", label: "초과조정", question: "이 업체 초과료·조정 — 업체명·자산",
    tables: ["overage_adjust", "overage"],
    summary: [{ label: "조정 제안", tables: ["overage_adjust"] }, { label: "초과료", tables: ["overage"] }],
  },
  recontract: {
    key: "recontract", label: "재계약", question: "이 업체 재계약 이력 — 업체명",
    // churn_defense(해지방어)는 칸 이름을 아직 몰라 SOURCES 에 없다(entity360 주석) — 데이터가 생기면 추가
    tables: ["recontract"], summary: [{ label: "재계약", tables: ["recontract"] }],
  },
  replacement: {
    key: "replacement", label: "교체", question: "이 업체 기기 교체 이력 — 업체명·자산·시리얼",
    tables: ["lease_status", "logistics_records"], summary: [{ label: "교체", tables: ["lease_status", "logistics_records"] }],
    note: "구분·분류에 '교체'가 있는 납품·물류 기록만",
  },
};

/** 필드 탭(mode·확장성 하위 탭) → 검색 탭. null = 검색칸 숨김(칭찬·테스트 탭) */
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
    default: return null; // praise 등
  }
}

// ── SOURCES 밖 표 ──────────────────────────────────────────
export const EXTRA_SOURCES: SourceDef[] = [
  // CS 미수 방문이력(2026-10-22). company_code = 마스터 거래처코드. SQL 실행 전이면 404 → 조용히 건너뜀
  { table: "misu_visits", label: "미수 방문", group: "영업·관리", tone: "bg-orange-50 text-orange-800 border-orange-200",
    nameCols: ["vendor"], deviceCols: [], rawCols: [], codeCol: "company_code", hidden: "_hidden=not.is.true",
    dateKeys: ["visited_at", "created_at"], titleKeys: ["visit_round"], snippetKeys: ["open_status", "judgment", "dun_reply", "promise_date"],
    authorKeys: ["author"], teamKeys: ["author_team", "region"], modelKeys: [], serialKeys: [], assetKeys: [],
    titleFn: (row) => `미수 ${str(row, "visit_round") || "방문"}${str(row, "judgment") ? ` · ${str(row, "judgment")}` : ""}`,
    limit: 200 },
];

/** 표가 아직 없음(SQL 실행 전) — PostgREST 404 / PGRST205 / 42P01 */
export const isTableMissing = (msg: string) => /\(404\)|PGRST205|42P01|does not exist|Could not find the table/i.test(String(msg || ""));

/** 탭이 보는 표 정의 목록(SOURCES + 덧붙인 것) — 화면의 "찾아본 곳" 문구에도 쓴다 */
export function sourcesOf(spec: TabSpec): SourceDef[] {
  const base = spec.tables.map((t) => SOURCES.find((s) => s.table === t)).filter((s): s is SourceDef => !!s);
  const extra = (spec.extra || []).map((t) => EXTRA_SOURCES.find((s) => s.table === t)).filter((s): s is SourceDef => !!s);
  return [...base, ...extra];
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
};

/** 탭 기준으로 남길 행인가 — 청정기·교체·방문기록(점검) 거름 */
export function keepRow(tab: TabKey, table: string, row: Row): boolean {
  if (tab === "air") return AIR_RX.test(str(row, "모델명")) || AIR_RX.test(str(row, "_원문"));
  if (tab === "replacement") return SWAP_RX.test(`${str(row, "구분")} ${str(row, "분류")} ${str(row, "교체전기종")}`);
  if (tab === "inspection" && table === "visit_logs") return /점검/.test(str(row, "work_kinds"));
  return true;
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
      out.push({
        key: ev.key, table: r.source.table, kind: r.source.label, tone: r.source.tone,
        date: ev.date, title: maskRrn(ev.title || r.source.label), detail: maskRrn(ev.snippet), author: maskRrn(ev.author), team: ev.team,
        device: maskRrn(device), raw: maskRrn(rawTextOf(row) || firstOf(row, r.source.titleKeys)).slice(0, 2000), loose,
        otherVendor: e && isOtherVendor(ev, e) ? maskRrn(ev.vendor) : "",
      });
    };
    r.exact.forEach((row) => push(row, false));
    r.loose.forEach((row) => push(row, true));
  }
  // 최신 위. 날짜 없는 줄은 맨 아래
  return out.sort((a, b) => (b.date || "0000").localeCompare(a.date || "0000") || a.key.localeCompare(b.key));
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

/** 탭 검색 한 번 — 그 탭 표만 병렬로. 표별 실패는 ok:false 로 남기고 나머지는 그대로 */
export async function runTabSearch(spec: TabSpec, e: Entity): Promise<TabResult[]> {
  const extras = sourcesOf(spec).filter((s) => (spec.extra || []).includes(s.table));
  const [base, more] = await Promise.all([
    spec.tables.length ? gather(e, { only: spec.tables }) : Promise.resolve([] as SourceResult[]),
    Promise.all(extras.map((s) => gatherExtra(s, e))),
  ]);
  return [...base, ...more];
}

/** 표 수집 요청 수 상한(업체 찾기·키 묶음 제외) — SOURCES 표는 정확·원문·느슨 최대 3, 덧붙인 표는 정확·느슨 2 */
export function maxRequestsOf(spec: TabSpec): number {
  return spec.tables.length * 3 + (spec.extra || []).length * 2;
}
