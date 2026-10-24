/**
 * 양식 건수(물류·재계약·불만·초과조정·미수) — 원본 표 하나·함수 하나(2026-10-24, 숫자 통일 2단계).
 *
 * 왜: 점검·AS 는 10-23 에 원본 표(jeomgeom·as_records) + workCount.countField 로 통일했다(활동 기록에서 점검 26·AS 29장이 빠져 있던 선례).
 *     나머지 양식은 아직 activity_events(countableEvents)를 셌다. activity_events 는 FIELD 의 [보내기] 성공 뒤 App.tsx recordOperation 이
 *     따로 한 줄 더 쓰는 기록이라, 시트·카톡 가져오기로 들어온 행은 처음부터 없고(10월 불만 D팀 2건 = 시트 입력),
 *     기록 실패도 안내 글로만 끝난다. 그래서 숫자를 원본 표에서 센다. activity_events 는 활동 타임라인으로만 남는다.
 *
 * 원본
 *   물류      logistics_records(물류 양식) + 점검·AS 양식의 구분 칸 여분·마감·세팅(jeomgeom·as_records, 같은 양식이 두 표에 있으면 1건)
 *             — 예전 활동 기록도 이 두 갈래였다(App.tsx recordFieldOperations 가 점검·AS 양식의 여분·마감·세팅을 물류 1건으로 적음)
 *   재계약    recontract(FIELD 웹앱·카톡 가져오기 — _출처로 구분, 둘 다 센다)
 *   불만      bulman(웹앱·시트 미러·카톡 가져오기 — 모두 센다)
 *   초과조정  overage_adjust
 *   미수      misu_visits(보완 기록은 원 기록과 합쳐 1건 — misuVisit.effectiveMisuVisits)
 *
 * 규칙(workCount 와 같음 — 이 함수 하나를 홈 KPI·팀 현황·순위표·조회 탭이 같이 쓴다)
 *   · 오발송 삭제(_hidden) 행 제외 · 팀장(명단 팀 '팀장') 기록 제외
 *   · 같은 작성자·같은 KST 날짜·같은 업체(vendorMatchKey) = 1건(물류는 물류/기타(여분·마감) 칸을 따로 본다)
 *   · 팀 = 지역 칸 → 출처 괄호('카톡:재계약(C)') → 작성자 명단 팀
 *   · 재계약·불만은 "업체 수"(기간 안 같은 업체 = 1곳, 사용자 기존 셈법) · 나머지는 건수
 */
import { kstDayOf, regionTeam, vendorKeyOf, type FieldRow } from "./workCount";
import { normalizeLogisticsKind, type ActivityEvent, type LogisticsKind } from "./operations";
import { effectiveMisuVisits, type MisuVisit } from "./misuVisit";

export type FormKind = "logistics" | "recontract" | "complaint" | "overage" | "misu";
export const FORM_KINDS: FormKind[] = ["logistics", "recontract", "complaint", "overage", "misu"];
/** 업체 수로 세는 종류(재계약·불만 — 2~3차 방문이 이어져도 업체 1곳의 진행) */
export const VENDOR_UNIT_KINDS: ReadonlySet<FormKind> = new Set<FormKind>(["recontract", "complaint"]);
export const FORM_LABELS: Record<FormKind, { label: string; unit: string }> = {
  logistics: { label: "물류", unit: "건" }, recontract: { label: "재계약", unit: "곳" }, complaint: { label: "불만", unit: "곳" },
  overage: { label: "초과조정", unit: "건" }, misu: { label: "미수 방문", unit: "건" },
};
export const FORM_BASIS_TEXT = "양식 원본 표 · 같은 날 같은 사람 같은 업체 1건 · 재계약·불만은 업체 수 · 오발송 삭제·팀장 기록 제외 · 팀 = 지역 칸(없으면 작성자 팀)";

/* ───────────── 행 정리(양식 표 공통) ───────────── */

/** 출처 라벨 괄호의 팀 — '카톡:초과조정(C)' → C */
export function sourceParenTeam(value: unknown): string {
  return regionTeam(String(value ?? "").match(/\(([^)]*)\)/)?.[1] || "");
}

const pad = (n: number) => String(n).padStart(2, "0");
const isYmdText = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const MONTHS: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const ymdOf = (y: number, m: number, d: number) => {
  const ymd = `${y}-${pad(m)}-${pad(d)}`;
  return isYmdText(ymd) ? ymd : "";
};
/**
 * 날짜 칸 글자 → YYYY-MM-DD, 못 읽으면 "".
 * 읽는 꼴(2026-10-24 불만 시트·카톡 가져오기 실측): '2026-10-21' · '2026.10.21' · '2024. 5. 23' · '2026/10/21' · '26-07-13'(yy-mm-dd)
 *   · '2026-10-21T…'(UTC 시각 글자 → KST 날짜) · 'Thu Aug 24 2023 00:00:00 GMT+0900'(시트 Date 글자, 적힌 날짜 그대로)
 * 연도가 없는 '6월 19일'은 못 읽음("") — 집계에서 빠진다(아래 toFormRows).
 */
export function looseYmd(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:/.test(s)) return kstDayOf(s);
  const full = s.match(/^(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})/);
  if (full) return ymdOf(Number(full[1]), Number(full[2]), Number(full[3]));
  const short = s.match(/^(\d{2})-(\d{1,2})-(\d{1,2})(?!\d)/);
  if (short) return ymdOf(2000 + Number(short[1]), Number(short[2]), Number(short[3]));
  const js = s.match(/^[A-Z][a-z]{2} ([A-Z][a-z]{2}) (\d{1,2}) (\d{4})\b/);
  if (js && MONTHS[js[1]]) return ymdOf(Number(js[3]), MONTHS[js[1]], Number(js[2]));
  return "";
}

export type FormRaw = Record<string, unknown> & { id?: unknown; _hidden?: unknown };
export type FormRow = {
  id: string; at: string; day: string; author: string; vendor: string; vendorKey: string;
  team: string; manager: boolean; hidden: boolean; raw: FormRaw;
  /** 원본 표(합성 활동 id·조회 탭 설명용) */
  table?: string;
  /** 물류 구분(납품·교체·세팅·이전·철수·여분·마감·기타) — 물류 행만 */
  logistics?: LogisticsKind;
  /** 물류 수량·기기 대수(팀 현황 '기기·물품' 칸) */
  qty?: number;
};

/** 양식 행의 KST 날짜(toFormRows 규칙) — 적힌 날짜 → 빈 칸이면 created_at(시트 미러 제외) → 못 읽으면 "" */
export function formDay(dateValue: unknown, createdAt: string, source: unknown): string {
  const text = String(dateValue ?? "").trim();
  if (text) return looseYmd(text);
  if (!createdAt || String(source ?? "").startsWith("시트:")) return "";
  return kstDayOf(createdAt);
}

export type FormRowOptions = { vendorFields?: string[]; authorField?: string; table?: string };
/**
 * 날짜 = dateField 를 looseYmd 로 읽은 값.
 *   · 적혀 있는데 못 읽으면("6월 19일") "" → 기간을 준 셈(countForms·formTally)에서 빠진다. created_at 으로 대신하지 않는다(2026-10-24 QA):
 *     시트 미러·카톡 가져오기 행은 created_at 이 가져온 시각(밤마다·8/27 일괄)이라 옛 기록이 가져온 달로 들어간다.
 *   · 칸이 비었으면 created_at 의 KST 날짜 — FIELD 양식에서 방문일을 비우고 보낸 행(저장 시각 = 작성 시각)을 살린다.
 *     단 시트 미러(_출처 '시트:')는 created_at 이 밤마다 새로 찍혀 빈 칸도 빠진다.
 * 팀 = 지역 칸 → 출처 괄호 → 작성자 팀(workCount.toFieldRows 와 같은 순서)
 */
export function toFormRows(raws: FormRaw[], dateField: string, teamOf: (author: string) => string, opts: FormRowOptions = {}): FormRow[] {
  const vendorFields = opts.vendorFields || ["_업체명", "업체명"];
  const authorField = opts.authorField || "작성자";
  return raws.map((r) => {
    const author = String(r[authorField] ?? "").trim();
    const authorTeam = teamOf(author);
    const vendor = vendorFields.map((f) => String(r[f] ?? "").trim()).find(Boolean) || "";
    const created = String(r.created_at ?? "");
    return {
      id: String(r.id ?? ""), at: created, day: formDay(r[dateField], created, r["_출처"]),
      author, vendor, vendorKey: vendorKeyOf(vendor),
      team: regionTeam(r["지역"]) || sourceParenTeam(r["_출처"]) || authorTeam,
      manager: authorTeam === "팀장", hidden: r._hidden === true, raw: r,
      ...(opts.table ? { table: opts.table } : {}),
    };
  });
}

const byTime = (a: FormRow, b: FormRow) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id, undefined, { numeric: true });
/** 업체(표기 변형 묶음)마다 가장 늦은 기록 */
export function latestByVendor(rows: FormRow[]): FormRow[] {
  const m = new Map<string, FormRow>();
  for (const r of [...rows].sort(byTime)) m.set(r.vendorKey || `#${r.id}`, r);
  return [...m.values()];
}

/* ───────────── 표별 읽는 칸·변환 ───────────── */

export type FormTable = "logistics_records" | "recontract" | "bulman" | "overage_adjust";
export const FORM_SOURCES: Record<FormTable, { kind: FormKind; dateField: string; columns: string[]; vendorFields: string[] }> = {
  logistics_records: { kind: "logistics", dateField: "작성일", columns: ["id", "_hidden", "created_at", "작성일", "작성자", "구분", "거래처명", "_업체명", "_출처", "수량"], vendorFields: ["_업체명", "거래처명"] },
  recontract: { kind: "recontract", dateField: "날짜", columns: ["id", "_hidden", "created_at", "날짜", "작성자", "지역", "_출처", "업체명", "_업체명", "갱신상태", "최종상태", "다음확인일"], vendorFields: ["_업체명", "업체명"] },
  bulman: { kind: "complaint", dateField: "날짜", columns: ["id", "_hidden", "created_at", "날짜", "작성자", "지역", "_출처", "업체명", "_업체명", "최종상태", "접수/처리"], vendorFields: ["_업체명", "업체명"] },
  overage_adjust: { kind: "overage", dateField: "방문일", columns: ["id", "_hidden", "created_at", "방문일", "작성자", "지역", "_출처", "업체명", "_업체명", "고객반응", "진행상태"], vendorFields: ["_업체명", "업체명"] },
};
export const FORM_TABLE_BY_KIND: Partial<Record<FormKind, FormTable>> = { logistics: "logistics_records", recontract: "recontract", complaint: "bulman", overage: "overage_adjust" };
export const isFormTable = (table: string): table is FormTable => table in FORM_SOURCES;

const firstNumber = (v: unknown) => Math.max(0, Number(String(v ?? "").match(/\d+/)?.[0] || 0));

/** 표 행 → 집계 행. 물류는 구분(물류 칸/기타 칸 판정)·수량을 같이 */
export function toFormTableRows(table: FormTable, raws: FormRaw[], teamOf: (author: string) => string): FormRow[] {
  const src = FORM_SOURCES[table];
  const rows = toFormRows(raws, src.dateField, teamOf, { vendorFields: src.vendorFields, table });
  if (table !== "logistics_records") return rows;
  return rows.map((r) => ({ ...r, logistics: normalizeLogisticsKind(String(r.raw["구분"] ?? "")), qty: firstNumber(r.raw["수량"]) }));
}

/**
 * 점검·AS 양식의 구분 칸 → 물류 1건(App.tsx recordFieldOperations 와 같은 판정: 여분 → 마감 → 세팅 순으로 하나).
 * '점검, AS' 양식은 두 표에 다 들어 있다 → 같은 사람·날·업체·칸이면 countableForms 가 1건으로 묶는다.
 */
export function fieldReportLogistics(reportTypes: string): LogisticsKind | "" {
  const tokens = String(reportTypes || "").normalize("NFKC").split(/[,·/]+/).map((t) => t.replace(/\s+/g, ""));
  if (tokens.includes("여분")) return "여분";
  if (tokens.includes("마감")) return "마감";
  if (tokens.includes("세팅") || tokens.includes("셋팅")) return "세팅";
  return "";
}
export function fieldLogisticsRows(field: FieldRow[]): FormRow[] {
  const out: FormRow[] = [];
  for (const f of field) {
    const kind = fieldReportLogistics(f.reportTypes || "");
    if (!kind) continue;
    out.push({
      id: `${f.table}:${f.id}`, at: f.at, day: f.day, author: f.author, vendor: f.vendor, vendorKey: vendorKeyOf(f.vendor),
      team: f.team, manager: f.manager, hidden: f.hidden, raw: {}, table: f.table, logistics: kind, qty: Math.max(1, f.machines.length),
    });
  }
  return out;
}

/** 미수 방문 → 집계 행(보완 기록은 원 기록과 합쳐 1건). 팀 = 작성 당시 팀(author_team) → 작성자 명단 팀 */
export function misuFormRows(visits: MisuVisit[], teamOf: (author: string) => string): FormRow[] {
  return effectiveMisuVisits(visits).map((v) => {
    const author = String(v.author || "").trim();
    const authorTeam = teamOf(author);
    const savedTeam = String(v.author_team || "").trim();
    const vendor = String(v.vendor || "").trim();
    const at = String(v.created_at || v.visited_at || "");
    return {
      id: String(v.id), at, day: kstDayOf(String(v.visited_at || at)), author, vendor, vendorKey: vendorKeyOf(vendor),
      team: regionTeam(savedTeam) || (savedTeam === "팀장" ? "팀장" : authorTeam),
      manager: authorTeam === "팀장" || savedTeam === "팀장", hidden: v._hidden === true, raw: {}, table: "misu_visits",
    };
  });
}

/* ───────────── 세기 ───────────── */

export type FormPart = "main" | "etc" | "all";
export type FormScope = { team?: string; author?: string; from?: string; to?: string; part?: FormPart };

/** 물류 칸: 여분·마감 = 기타, 그 밖 = 물류(팀 현황 logistics_main·홈 K24 와 같은 판정) */
export function logisticsPartOf(kind: LogisticsKind | undefined): "main" | "etc" {
  return kind === "여분" || kind === "마감" ? "etc" : "main";
}

const formScoped = (kind: FormKind, rows: FormRow[], s: FormScope) => rows.filter((r) => !r.hidden
  && (!s.team || s.team === "전체" || r.team === s.team)
  && (!s.author || r.author === s.author)
  && (!s.from || r.day >= s.from) && (!s.to || r.day <= s.to)
  && (kind !== "logistics" || !s.part || s.part === "all" || logisticsPartOf(r.logistics) === s.part));

/** 세는 대상 행 — 삭제·팀장 제외 → (작성자, KST 날짜, 업체[, 물류 칸]) 1건. 업체를 못 읽은 행은 한 행씩 */
export function countableForms(kind: FormKind, rows: FormRow[], s: FormScope = {}): FormRow[] {
  const seen = new Set<string>();
  const out: FormRow[] = [];
  for (const r of [...formScoped(kind, rows, s)].sort(byTime)) {
    if (r.manager) continue;
    if (r.vendorKey) {
      const k = `${r.author}|${r.day}|${r.vendorKey}${kind === "logistics" ? `|${logisticsPartOf(r.logistics)}` : ""}`;
      if (seen.has(k)) continue;
      seen.add(k);
    }
    out.push(r);
  }
  return out;
}

/** 서로 다른 업체 수(빈 업체 제외) */
const vendorUnits = (keys: string[]) => new Set(keys.filter(Boolean)).size;

/**
 * 양식 건수 — 홈 KPI·팀 현황·순위표·조회 탭이 모두 이 값.
 * 재계약·불만 = 업체 수, 물류·초과조정·미수 = 건수. 물류는 opts.part(main = 여분·마감 제외, etc = 여분·마감, 기본 all).
 */
export function countForms(kind: FormKind, rows: FormRow[], from?: string, to?: string, opts: Omit<FormScope, "from" | "to"> = {}): number {
  const list = countableForms(kind, rows, { ...opts, from, to });
  return VENDOR_UNIT_KINDS.has(kind) ? vendorUnits(list.map((r) => r.vendorKey)) : list.length;
}

/** 화면 설명용: 범위 안 행 수와 빠진 이유별 수(재계약·불만은 같은 업체 묶음도 따로) */
export function formTally(kind: FormKind, rows: FormRow[], s: FormScope = {}): { count: number; rows: number; managers: number; resends: number; sameVendor: number } {
  const inScope = formScoped(kind, rows, s);
  const managers = inScope.filter((r) => r.manager).length;
  const counted = countableForms(kind, rows, s);
  const count = VENDOR_UNIT_KINDS.has(kind) ? vendorUnits(counted.map((r) => r.vendorKey)) : counted.length;
  return { count, rows: inScope.length, managers, resends: inScope.length - managers - counted.length, sameVendor: counted.length - count };
}

/* ───────────── 팀 현황·순위표 입구(활동 목록) ───────────── */

/** 종류별 원본 행 묶음 — 못 읽은(없는) 종류는 비워 둔다(그 종류는 활동 기록을 그대로 쓴다) */
export type FormSet = Partial<Record<FormKind, FormRow[]>>;

/** 물류 원본 = 물류 양식 표 + 점검·AS 양식의 여분·마감·세팅 */
export function withFieldLogistics(forms: FormSet, field: FieldRow[]): FormSet {
  return forms.logistics ? { ...forms, logistics: [...forms.logistics, ...fieldLogisticsRows(field)] } : forms;
}

/**
 * 활동 기록에서 양식 종류를 표 원본으로 갈아 끼운다 — 센 행 하나 = 활동 1개(metadata.counted → countableEvents 재묶음을 건너뛴다).
 * 담당자 변경·교체양식·마감 카운터는 활동 기록 그대로(전용 원본 없음/이번 범위 밖).
 */
export function mergeFormsIntoEvents(events: ActivityEvent[], forms: FormSet): ActivityEvent[] {
  const replaced = new Set(FORM_KINDS.filter((k) => forms[k]));
  const fromTables: ActivityEvent[] = [];
  for (const kind of replaced) {
    for (const r of countableForms(kind, forms[kind] || [])) {
      fromTables.push({
        id: `${r.table || kind}:${r.id}`, createdAt: r.at || r.day, activityDate: r.day, author: r.author, team: r.team,
        category: kind, vendor: r.vendor, quantity: 1, machineCount: kind === "logistics" ? r.qty || 0 : 0, sourceText: "",
        metadata: { sourceTable: r.table || "", counted: true, ...(r.logistics ? { logisticsCategory: r.logistics } : {}) },
        status: "active", cancelledAt: "", cancelledBy: "",
      });
    }
  }
  return [...events.filter((e) => !replaced.has(e.category as FormKind)), ...fromTables];
}

/** 이미 범위·팀·사람으로 거른 활동 목록에서 한 종류 세기(팀 현황 칸·순위표 칸) — countForms 와 같은 단위 */
export function countFormEvents(kind: FormKind, events: ActivityEvent[]): number {
  const list = events.filter((e) => e.category === kind);
  return VENDOR_UNIT_KINDS.has(kind) ? vendorUnits(list.map((e) => vendorKeyOf(e.vendor || ""))) : list.length;
}
