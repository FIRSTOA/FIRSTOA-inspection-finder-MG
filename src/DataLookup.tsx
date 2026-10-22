import { currentBook, teamLabel, useMembers, type AuthorTeam } from "./authors";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { notify } from "./toast";
import { askConfirm } from "./confirmModal";
import { Download, RefreshCw, Search, X } from "lucide-react";
import { countRows, selectRows, SUPABASE_ANON, SUPABASE_URL, invokeEdgeFunction } from "./supabase";
import { setActivityEventsCancelledByKey, setActivityEventsCancelledBySource, setActivityEventsCancelledByVendor, teamForAuthor } from "./operations";
import { EXPANSION_BASIS_TEXT, EXPANSION_SOURCES, countExpansion, countField, expansionTally, FIELD_BASIS_TEXT, FIELD_SOURCES, fieldTally, kstDayOf, kstTextRange, toExpansionRows, toFieldRows, UTC_TEXT_DATE_TABLES, type ExpansionRaw, type ExpansionTable, type FieldRaw, type FieldTable } from "./workCount";
import { loadExpansionRaw, loadFieldRaw } from "./expansionSource";
import { setVisitsCancelledBySource, setVisitsCancelledByVendor } from "./visits";
import { LOOKUP_CATEGORIES, LOOKUP_GROUPS, type LookupCategory, type LookupColumn } from "./lookupCatalog";
import { MisuBoard, OverageBoard } from "./MisuOverageBoards";
import StockBoard from "./StockBoard";
import SupplyBoard from "./SupplyBoard";
import { kstDate } from "./visits";
import { okrWeeksInMonth } from "./okr";
import { calendarRange } from "./periodRange";

type Row = Record<string, unknown>;

const PAGE = 300;
// 확장성 표 → 활동 기록 종류·작성자 칸 (숨김을 팀 현황에도 반영할 때 쓴다)
const EXPANSION_KIND_BY_TABLE: Record<string, "expansion_it" | "expansion_copier"> = { pc_expansion: "expansion_it", mfp_expansion: "expansion_copier" };
const expansionAuthorField = (table: string) => table === "pc_expansion" ? "작성자" : table === "mfp_expansion" ? "등록자" : "";
const isExpansionTable = (table: string): table is ExpansionTable => table in EXPANSION_SOURCES;
const isFieldTable = (table: string): table is FieldTable => table in FIELD_SOURCES;
// 시트가 원본인 미러 표(밤 00:30 통째 교체) — 오발송 삭제는 mirror_hidden 장부가 다음 날에도 유지한다
const SHEET_MIRROR_TABLES = new Set(["pc_expansion", "mfp_expansion", "misu", "overage"]);
const PERIODS = [
  ["month", "이번 달"], ["lastmonth", "지난달"], ["3m", "최근 3개월"], ["6m", "최근 6개월"], ["1y", "최근 1년"], ["all", "전체"],
] as const;
type PeriodKey = typeof PERIODS[number][0] | "week"; // "week" = 월~일 한 주(PC 확장성만, 2026-10-08)

// 월요일 기준 한 주 — 어느 날짜를 주든 그 주의 월요일과 일요일
function weekOf(date: string): { start: string; end: string } {
  const d = new Date(`${date}T12:00:00+09:00`);
  const dow = (d.getUTCDay() + 6) % 7; // 월=0 … 일=6
  const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - dow);
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
  return { start: mon.toISOString().slice(0, 10), end: sun.toISOString().slice(0, 10) };
}
const shiftDays = (date: string, days: number) => { const d = new Date(`${date}T12:00:00+09:00`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

const SHEET_ERROR = /^#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NULL!|ERROR!?)$/i;
function text(row: Row, key: string) {
  const value = row[key];
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ");   // work_kinds 같은 배열은 쉼표로
  if (typeof value === "object") return JSON.stringify(value);
  const out = String(value);
  return SHEET_ERROR.test(out.trim()) ? "" : out;   // 시트 수식 에러값은 빈칸 취급
}

/** 1,234 형태로 보이는 값이면 숫자로 취급해 오른쪽 정렬·등폭이 자연스럽게 */
function shortValue(value: string, key: string) {
  if (!value) return "-";
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return value.slice(0, 16).replace("T", " ");
  if (key === "photos" || value.startsWith("[")) return value === "[]" ? "-" : value;
  return value;
}

function csvCell(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export default function DataLookup({ author = "" }: { author?: string }) {
  const [categoryKey, setCategoryKey] = useState<string>(() => window.localStorage.getItem("cs_lookup_category_v1") || "jeomgeom");
  const [period, setPeriod] = useState<PeriodKey>("3m");
  const [weekStart, setWeekStart] = useState(() => weekOf(kstDate()).start); // 주 단위 조회의 월요일
  const week = useMemo(() => weekOf(weekStart), [weekStart]);
  // "10월 1주차" — OKR·주간현황판과 같은 셈법(월요일이 든 달 기준, 그 달에 시작하는 주를 1·2·3…)
  const weekLabel = useMemo(() => {
    const y = Number(week.start.slice(0, 4)), m = Number(week.start.slice(5, 7));
    const no = okrWeeksInMonth(y, m).find((w) => w.start === week.start)?.weekNo;
    return no ? `${m}월 ${no}주차` : `${m}월`;
  }, [week]);
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc"); // 최신순이 기본 — 오래된 것부터 훑을 때만 바꾼다(2026-09-16 요청)
  // 묶음 탭을 누르면 그 묶음에서 마지막으로 보던 항목으로(없으면 첫 항목) — 2단 선택(묶음 → 항목)
  const lastInGroup = useRef<Record<string, string>>({});
  // 항목 고르기(2026-10-12): PC는 왼쪽 세로 목록(전부 보임), 휴대폰은 단추 → 바닥 창. 최근 본 항목은 칩으로 한 번에
  const [pickerOpen, setPickerOpen] = useState(false);
  const [recentKeys, setRecentKeys] = useState<string[]>(() => { try { return (JSON.parse(localStorage.getItem("cs_lookup_recent_v1") || "[]") as string[]).filter((k) => LOOKUP_CATEGORIES.some((c) => c.key === k)); } catch { return []; } });
  const pick = (key: string) => {
    const cat = LOOKUP_CATEGORIES.find((c) => c.key === key);
    if (!cat) return;
    lastInGroup.current[cat.group] = key;
    setCategoryKey(key);
    setPickerOpen(false);
    setRecentKeys((cur) => { const next = [key, ...cur.filter((k) => k !== key)].slice(0, 6); try { localStorage.setItem("cs_lookup_recent_v1", JSON.stringify(next)); } catch { /* 무시 */ } return next; });
  };
  const [team, setTeam] = useState("전체");
  // 팀 아래 인원 필터(2026-10-08) — 팀을 고르면 그 팀 사람 단추가 나오고 사람별 건수가 같이 보인다(PC확장성 개인별 실적)
  const [member, setMember] = useState("");
  const roster = useMembers();
  const teamMembers = useMemo(() => team === "전체" ? [] : roster.filter((m) => m.active && (m.team === team || (team === "E" && m.team === "CSS") || m.team.split(/[·/,]/).map((x) => x.trim()).includes(team))), [roster, team]);
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  // 작성자 → 팀 명단(currentBook: CSS=E·겸직 포함) — 확장성 팀 규칙이 teamForAuthor 와 같은 명단을 쓰게. roster 가 바뀌면 다시
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const teamBookNames = useMemo(() => team === "전체" ? [] : [...(currentBook()[team as AuthorTeam] || [])], [team, roster]);
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  // 잘못된 기록 숨김(soft delete) — 원문 보존, 누가·언제 숨겼는지 기록. 지원 테이블에만 노출
  const HIDEABLE = useMemo(() => new Set(["jeomgeom", "as_records", "logistics_records", "bulman", "misu", "overage", "overage_adjust", "recontract", "churn_defense", "mgmt_support", "pc_expansion", "mfp_expansion", "contact_changes", "stock_items"]), []);
  // 기록 수정 — 접수팀이 잘못 적은 값이 이력으로 남으면 다음 판단이 틀려진다.
  // 통합이력·FIELD 검색·접수 AS히스토리가 전부 이 행을 직접 읽으므로 여기서 고치면 모든 화면에 반영된다.
  // 처음엔 기기 식별자 4칸만 열었는데 "다른 것도 실수를 고치고 싶다"(2026-09-09)로 전 칸 개방 —
  // 원문 동기화·수정 이력(_edit_log)이 같은 흐름을 타므로 어떤 칸이든 변경 전 값이 남는다.
  const RECORD_FIELDS = useMemo(() => [
    "작성일", "작성자", "구분", "레벨", "등급", "업체명", "부서명", "지역", "키맨/접수자",
    "모델명", "시리얼넘버", "자산기번", "내용", "처리내용", "매수", "토너잔량", "폐통", "여분",
    "한틴이카유무", "주차비지원유무", "특이사항",
  ], []);
  const EDITABLE_FIELDS: Record<string, string[]> = useMemo(() => ({
    jeomgeom: RECORD_FIELDS,
    as_records: RECORD_FIELDS,
  }), [RECORD_FIELDS]);
  const [showHidden, setShowHidden] = useState(false);
  const [chip, setChip] = useState(""); // chipFilter 유형 선택 (빈 값 = 전체)
  const [hideBusy, setHideBusy] = useState(false);
  const [editDraft, setEditDraft] = useState<Record<string, string> | null>(null); // null = 보기 모드
  const [editBusy, setEditBusy] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<Row | null>(null);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);

  const category = useMemo<LookupCategory>(
    () => LOOKUP_CATEGORIES.find((item) => item.key === categoryKey) || LOOKUP_CATEGORIES[0],
    [categoryKey],
  );

  useEffect(() => { window.localStorage.setItem("cs_lookup_category_v1", categoryKey); }, [categoryKey]);
  // 분류를 바꾸면 검색어도 비운다 — 표마다 검색 대상 컬럼이 달라, 남은 검색어가 엉뚱한 표에 적용됐다
  // (거래처 특이사항에서 '오전'을 찾고 미수로 옮기면 미수가 '오전' 기준으로 걸러지던 버그, 2026-08-19)
  useEffect(() => { setRows([]); setReachedEnd(false); setChip(""); setQuery(""); setQueryDraft(""); setMember(""); }, [categoryKey, team]);
  useEffect(() => { setRows([]); setReachedEnd(false); }, [member]);

  // 조회 한 번에 필요한 쿼리를 만든다. offset만 바꿔 "더 보기"에 재사용.
  const buildQuery = useCallback((offset: number) => {
    const parts = ["select=*"];
    if (HIDEABLE.has(category.table)) parts.push(`_hidden=${showHidden ? "is.true" : "not.is.true"}`);
    if (category.filterQuery) parts.push(category.filterQuery);
    if (category.chipFilter && chip) parts.push(`${encodeURIComponent(category.chipFilter.field)}=eq.${encodeURIComponent(chip)}`);
    if (period !== "all") {
      const range = period === "week" ? { from: week.start, to: week.end } : calendarRange(period, kstDate()); // 달력 기준(이번 달 1일~말일 등)
      if (UTC_TEXT_DATE_TABLES.has(category.table)) {
        // 확장성 날짜 칸은 'YYYY-MM-DD'(웹앱)와 UTC 시각 글자(시트 미러)가 섞여 있다 — KST 하루 경계로 자른다(workCount.ts)
        const kst = kstTextRange(range.from, range.to);
        parts.push(`${encodeURIComponent(category.dateField)}=gte.${kst.gte}`, `${encodeURIComponent(category.dateField)}=lt.${kst.lt}`);
      } else {
        parts.push(`${encodeURIComponent(category.dateField)}=gte.${range.from}`, `${encodeURIComponent(category.dateField)}=lte.${range.to}T23:59:59`);
      }
    }
    if (query.trim()) {
      // PostgREST or 조건 — 정의된 검색 필드를 한 번에 훑는다.
      // 컬럼 이름을 반드시 따옴표로 감싼다: "관심품목(세분화)"처럼 괄호가 든 이름이 있어
      // 그냥 넣으면 or 구문이 깨진다(400).
      const needle = query.trim().replace(/[(),*"]/g, " ").trim();
      parts.push(`or=(${category.searchFields.map((field) => `"${field}".ilike.*${needle}*`).join(",")})`);
    }
    if (member && category.searchFields.includes("작성자")) parts.push(`${encodeURIComponent("작성자")}=ilike.*${encodeURIComponent(member)}*`);
    if (team !== "전체" && (category.teamField || category.teamSourceParen)) {
      // 팀 컬럼('수도권C'·'C'·'C,D')과 출처 라벨의 괄호("카톡:재계약(A)")를 함께 본다 —
      // 시트 동기화분은 지역 칸이 빈 경우가 많아(재계약은 100%) 컬럼만으로는 다 빠진다.
      const conds: string[] = [];
      // 확장성 팀 규칙은 workCount.ts toExpansionRows 와 같게(2026-10-22): PC 는 지역 칸 → 비면 작성자 명단 팀(CSS=E 포함),
      // 복합기 '미팅지역'은 주소라 팀이 아니다 → 작성자 명단 팀만
      const authorField = expansionAuthorField(category.table);
      const teamNames = authorField ? teamBookNames : [];
      const namesIn = teamNames.length ? teamNames.map((n) => `"${n.replace(/"/g, "")}"`).join(",") : `"__없음__"`;
      if (category.teamField && category.table !== "mfp_expansion") conds.push(`"${category.teamField}".ilike."*${team}*"`);
      if (category.teamSourceParen) conds.push(`"_출처".ilike."*(*${team}*)*"`);
      if (category.table === "mfp_expansion") conds.push(`"${authorField}".in.(${namesIn})`);
      else if (authorField && category.teamField) conds.push(`and(or("${category.teamField}".is.null,"${category.teamField}".eq.""),"${authorField}".in.(${namesIn}))`);
      parts.push(`or=(${conds.map((cond) => encodeURIComponent(cond)).join(",")})`);
    }
    parts.push(`order=${encodeURIComponent(category.orderField)}.${sortDir}`, `limit=${PAGE}`);
    if (offset > 0) parts.push(`offset=${offset}`);
    return parts.join("&");
  }, [category, period, week, query, team, member, HIDEABLE, showHidden, chip, sortDir, teamBookNames]);
  // 주 단위는 PC 확장성에서만 — 다른 표로 옮기면 3개월로 돌아간다
  useEffect(() => { if (period === "week" && category.key !== "pc") setPeriod("3m"); }, [category.key, period]);

  // 확장성 건수 — 팀 현황·순위표와 같은 원본(표 행)·같은 함수(workCount countExpansion)로 센다(2026-10-22).
  // 목록은 행 그대로 보여 주고 건수 카드만 이 값. 오발송 삭제·삭제 취소 뒤 expansionNonce 로 다시 읽는다.
  const [expansionRaw, setExpansionRaw] = useState<{ key: string; rows: ExpansionRaw[] } | null>(null);
  const [expansionNonce, setExpansionNonce] = useState(0);
  const expansionRange = useMemo(() => period === "all" ? null : period === "week" ? { from: week.start, to: week.end } : calendarRange(period, kstDate()), [period, week]);
  const expansionKey = `${category.table}|${expansionRange?.from || ""}|${expansionRange?.to || ""}|${expansionNonce}`;
  useEffect(() => {
    const table = category.table;
    if (!isExpansionTable(table)) return;
    let alive = true;
    loadExpansionRaw(table, expansionRange?.from, expansionRange?.to)
      .then((rows) => { if (alive) setExpansionRaw({ key: expansionKey, rows }); })
      .catch((e: unknown) => { if (alive) setError(`확장성 건수 계산 실패: ${(e as Error).message}`); });
    return () => { alive = false; };
  }, [category.table, expansionRange, expansionKey]);
  const expansionRows = useMemo(() => {
    const table = category.table;
    if (!isExpansionTable(table) || expansionRaw?.key !== expansionKey || !roster) return null; // roster: 명단이 늦게 오면 작성자 팀 다시 계산
    return toExpansionRows(table, expansionRaw.rows, teamForAuthor);
  }, [category.table, expansionRaw, expansionKey, roster]);
  // 검색어·유형 칩·삭제 기록 보기 중엔 행 수만(함수 범위 = 기간·팀·사람)
  const expansionCount = useMemo(() => {
    if (!expansionRows || showHidden || query.trim() || chip) return null;
    return expansionTally(expansionRows, { team, author: member || undefined });
  }, [expansionRows, showHidden, query, chip, team, member]);

  // 점검 대수·AS 건수 — 홈·팀 현황·순위표와 같은 원본(표 행)·같은 함수(workCount countField)로 센다(2026-10-22).
  // 목록은 행(양식 1장) 그대로, 건수 카드만 이 값. '전체' 기간은 원문을 다 받아야 해서 행 수만 보인다.
  const [fieldRaw, setFieldRaw] = useState<{ key: string; rows: FieldRaw[] } | null>(null);
  const fieldKey = `${category.table}|${expansionRange?.from || ""}|${expansionRange?.to || ""}|${expansionNonce}`;
  useEffect(() => {
    const table = category.table;
    if (!isFieldTable(table) || !expansionRange) return;
    let alive = true;
    loadFieldRaw(table, expansionRange.from, expansionRange.to)
      .then((rows) => { if (alive) setFieldRaw({ key: fieldKey, rows }); })
      .catch((e: unknown) => { if (alive) setError(`${FIELD_SOURCES[table].label} 수 계산 실패: ${(e as Error).message}`); });
    return () => { alive = false; };
  }, [category.table, expansionRange, fieldKey]);
  const fieldRows = useMemo(() => {
    const table = category.table;
    if (!isFieldTable(table) || fieldRaw?.key !== fieldKey || !roster) return null;
    return toFieldRows(table, fieldRaw.rows, teamForAuthor);
  }, [category.table, fieldRaw, fieldKey, roster]);
  const fieldCount = useMemo(() => {
    const table = category.table;
    if (!isFieldTable(table) || !fieldRows || showHidden || query.trim() || chip) return null;
    return fieldTally(fieldRows, { kind: FIELD_SOURCES[table].kind, team, author: member || undefined });
  }, [category.table, fieldRows, showHidden, query, chip, team, member]);

  // 사람별 건수 — 지금 조건(기간·유형·검색어·팀)에서 작성자만 바꿔 가며 세어 단추 옆에 보여 준다
  const canMember = Boolean(category.teamField) && category.searchFields.includes("작성자");
  useEffect(() => {
    if (!canMember || !teamMembers.length) { setMemberCounts({}); return; }
    if (isExpansionTable(category.table)) {
      // 확장성은 같은 함수로(재전송 1건·팀장 제외) — 사람 합 = 팀 건수
      if (!expansionRows || query.trim() || chip || showHidden) { setMemberCounts({}); return; }
      setMemberCounts(Object.fromEntries(teamMembers.map((m) => [m.name, countExpansion(expansionRows, { team, author: m.name })])));
      return;
    }
    if (isFieldTable(category.table) && fieldRows && !query.trim() && !chip && !showHidden) {
      // 점검·AS 도 같은 함수로(재전송 1·팀장 제외·점검은 대수) — 사람 합 = 팀 값
      const kind = FIELD_SOURCES[category.table].kind;
      setMemberCounts(Object.fromEntries(teamMembers.map((m) => [m.name, countField(fieldRows, { kind, team, author: m.name })])));
      return;
    }
    let alive = true;
    const base = buildQuery(0).split("&").filter((part) => !/^(select|order|limit|offset)=/.test(part) && !part.startsWith(`${encodeURIComponent("작성자")}=`));
    Promise.all(teamMembers.map((m) => countRows(category.table, [...base, `${encodeURIComponent("작성자")}=ilike.*${encodeURIComponent(m.name)}*`].join("&")).then((n) => [m.name, n] as const).catch(() => [m.name, -1] as const)))
      .then((pairs) => { if (alive) setMemberCounts(Object.fromEntries(pairs)); });
    return () => { alive = false; };
  }, [canMember, teamMembers, buildQuery, category.table, expansionRows, fieldRows, query, chip, showHidden, team]);

  const fetchPage = useCallback(async (offset: number) => {
    setLoading(true);
    setError("");
    try {
      if (offset === 0) {
        // 첫 페이지는 직접 fetch — content-range 헤더에서 필터 반영 총 건수를 같이 받는다
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${category.table}?${buildQuery(0)}`, {
          headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, Prefer: "count=exact" },
        });
        if (!res.ok) throw new Error(`조회 실패 (${res.status})`);
        const next = (await res.json()) as Row[];
        const exact = Number((res.headers.get("content-range") || "").split("/")[1]);
        setTotalCount(Number.isFinite(exact) ? exact : null);
        setReachedEnd(next.length < PAGE);
        setRows(next);
      } else {
        const next = await selectRows<Row>(category.table, buildQuery(offset));
        setReachedEnd(next.length < PAGE);
        setRows((current) => [...current, ...next]);
      }
    } catch (e) {
      setError((e as Error).message || "조회에 실패했습니다.");
      if (!offset) setRows([]);
    } finally {
      setLoading(false);
    }
  }, [buildQuery, category.table]);

  // 카테고리·기간·검색어가 바뀌면 처음부터 다시 읽는다
  useEffect(() => { void fetchPage(0); }, [fetchPage]);

  const visibleColumns = category.columns;
  const template = visibleColumns.map((column) => column.width || "minmax(0,1fr)").join(" ");
  const hideClass = (column: LookupColumn) => column.hideBelow === "lg" ? "hidden lg:block" : column.hideBelow === "sm" ? "hidden sm:block" : "";

  const exportCsv = () => {
    const header = visibleColumns.map((column) => column.label);
    const lines = [header.map(csvCell).join(",")];
    rows.forEach((row) => lines.push(visibleColumns.map((column) => csvCell(text(row, column.key))).join(",")));
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${category.label}_${kstDate()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const detailFields = useMemo(() => {
    if (!detail) return [] as Array<[string, string]>;
    return Object.entries(detail)
      .filter(([key]) => !key.startsWith("_dupKey") && key !== "id" && key !== "_edit_log")
      .map(([key, value]) => [key, value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)] as [string, string])
      .filter(([, value]) => value.trim());
  }, [detail]);

  // 묶음별 항목 목록 — PC 왼쪽 세로 목록(compact=false)과 휴대폰 바닥 창(compact=true)이 같이 쓴다
  const groupedList = (compact: boolean) => LOOKUP_GROUPS.map((group) => (
    <div key={group}>
      <div className={`px-3 text-[10px] font-black tracking-wide text-slate-400 ${compact ? "mb-1 mt-3" : "bg-slate-50 py-1.5"}`}>{group}</div>
      <div className={compact ? "grid grid-cols-2 gap-1.5 px-3" : ""}>
        {LOOKUP_CATEGORIES.filter((c) => c.group === group).map((item) => (
          <button key={item.key} type="button" onClick={() => pick(item.key)}
            className={compact
              ? `rounded-lg border px-3 py-2 text-left text-[13px] font-black ${item.key === categoryKey ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700"}`
              : `flex w-full items-center px-3 py-1.5 text-left text-[12.5px] font-bold transition ${item.key === categoryKey ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-50"}`}>
            {item.label}
          </button>
        ))}
      </div>
    </div>
  ));

  return (
    <div className="space-y-4">
      {/* PC: 묶음별 목록을 위에 가로로 — 왼쪽은 읽기 힘들고, 알약보다 이 목록 형식이 낫다(2026-10-12) */}
      <nav className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:grid lg:grid-cols-6 lg:divide-x lg:divide-slate-100">{groupedList(false)}</nav>
      <div className="min-w-0 space-y-4">
      {/* 카테고리 — 그룹별로 묶어 한 줄씩 */}
      {/* 휴대폰·태블릿: 현재 항목 단추 + 최근 칩. PC(lg)에서는 왼쪽 목록이 있어 숨긴다 */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:hidden">
        <div className="flex items-center gap-2 px-3 py-2">
          <button type="button" onClick={() => setPickerOpen(true)} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left">
            <span className="shrink-0 text-[10.5px] font-black text-slate-400">{category.group}</span>
            <span className="min-w-0 truncate text-[14px] font-black text-slate-900">{category.label}</span>
            <span className="ml-auto shrink-0 text-[11px] font-bold text-slate-400">항목 고르기 ▾</span>
          </button>
          <button type="button" onClick={() => void fetchPage(0)} title="새로고침" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-500"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
        </div>
        {recentKeys.filter((k) => k !== categoryKey).length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto border-t border-slate-100 px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <span className="shrink-0 text-[10px] font-black text-slate-400">최근</span>
            {recentKeys.filter((k) => k !== categoryKey).slice(0, 5).map((k) => { const c = LOOKUP_CATEGORIES.find((x) => x.key === k); return c ? <button key={k} type="button" onClick={() => pick(k)} className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-[11.5px] font-black text-slate-600">{c.label}</button> : null; })}
          </div>
        )}
      </section>
      {/* PC: 현재 항목 이름·설명·새로고침 한 줄 */}
      <section className="hidden items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm lg:flex">
        <span className="shrink-0 text-[10.5px] font-black text-slate-400">{category.group}</span>
        <span className="shrink-0 text-[15px] font-black text-slate-900">{category.label}</span>
        <span className="min-w-0 truncate text-[11px] font-semibold text-slate-400">{category.note || "기록이 저장된 표를 그대로 조회합니다. 행을 누르면 모든 항목과 원문을 볼 수 있습니다."}</span>
        <button type="button" onClick={() => void fetchPage(0)} title="새로고침" className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-500 transition hover:bg-slate-50"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
      </section>

      {/* 전용 보드가 있는 카테고리: CS체크·정렬·수량조절 등 기능이 범용 표보다 풍부해 그대로 흡수 */}
      {category.custom === "misu" && <MisuBoard />}
      {category.custom === "overage" && <OverageBoard />}
      {category.custom === "stock" && <StockBoard author={author} />}
      {category.custom === "self" && <SupplyBoard author={author} kind="자가" withTools />}
      {category.custom === "parts" && <SupplyBoard author={author} kind="부품" withTools />}

      {/* KPI — 미수 보드와 같은 요약 카드 (필터가 그대로 반영된 정확한 수) */}
      {!category.custom && (
        <div className="grid grid-cols-3 gap-2">
          {([
            [expansionCount ? expansionCount.count.toLocaleString() + "건" : fieldCount && isFieldTable(category.table) ? fieldCount.count.toLocaleString() + FIELD_SOURCES[category.table].unit : totalCount != null ? totalCount.toLocaleString() + (isExpansionTable(category.table) || isFieldTable(category.table) ? "행" : "건") : "…", period === "week" ? `${weekLabel} (${md(week.start)}~${md(week.end)}) 기록` : `${PERIODS.find(([value]) => value === period)?.[1] || ""} 기록`],
            [rows.length ? shortValue(text(rows[0], category.dateField), category.dateField) : "-", "가장 최근 기록"],
            [team === "전체" ? "전 팀" : teamLabel(team), query ? `"${query}" 검색 중` : "보는 범위"],
          ] as [string, string][]).map(([value, label]) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-white px-3 py-4 text-center shadow-sm">
              <div className="truncate text-lg font-black tabular-nums text-slate-950 sm:text-xl">{value}</div>
              <div className="mt-1 text-[11px] font-bold text-slate-400">{label}</div>
            </div>
          ))}
        </div>
      )}
      {!category.custom && isExpansionTable(category.table) && (
        <div className="-mt-1 px-1 text-[11px] font-bold text-slate-500">
          기준: {EXPANSION_SOURCES[category.table].label} 표(시트 포함), {EXPANSION_BASIS_TEXT} — 주간현황판 팀 현황·순위표와 같은 숫자.
          {expansionCount && expansionCount.rows !== expansionCount.count && <span className="text-slate-400"> 목록 {expansionCount.rows}행 중 재전송 {expansionCount.resends}·팀장 {expansionCount.managers} 제외.</span>}
          {!expansionCount && (query.trim() || chip || showHidden) && <span className="text-slate-400"> 검색·유형·삭제한 기록 보기 중에는 행 수만 보입니다.</span>}
        </div>
      )}

      {!category.custom && isFieldTable(category.table) && (
        <div className="-mt-1 px-1 text-[11px] font-bold text-slate-500">
          기준: {FIELD_SOURCES[category.table].label} 표, {FIELD_BASIS_TEXT} — 홈·주간현황판 팀 현황·순위표와 같은 숫자.
          {fieldCount && <span className="text-slate-400"> 목록 {fieldCount.rows}행(양식) 중 재전송 {fieldCount.resends}·팀장 {fieldCount.managers} 제외.</span>}
          {!fieldCount && (query.trim() || chip || showHidden || period === "all") && <span className="text-slate-400"> 검색·유형·삭제한 기록·전체 기간 보기 중에는 행 수만 보입니다.</span>}
        </div>
      )}

      {/* 검색 + 결과 (범용) */}
      {!category.custom && <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="space-y-2 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-full shrink-0 text-[10px] font-black text-slate-400 sm:w-8">기간</span>
            {category.key === "pc" && (
              <button type="button" onClick={() => setPeriod("week")}
                className={`rounded-full px-3 py-1.5 text-[11px] font-black transition ${period === "week" ? "bg-slate-900 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100"}`}>이번 주</button>
            )}
            {PERIODS.map(([value, label]) => (
              <button key={value} type="button" onClick={() => setPeriod(value)}
                className={`rounded-full px-3 py-1.5 text-[11px] font-black transition ${period === value ? "bg-slate-900 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100"}`}>{label.replace("최근 ", "")}</button>
            ))}
            {period === "week" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1 py-0.5">
                <button type="button" onClick={() => setWeekStart(shiftDays(week.start, -7))} className="rounded-full px-2 py-1 text-[12px] font-black text-slate-600 hover:bg-white" title="지난 주">◀</button>
                <span className="min-w-[132px] text-center text-[11px] font-black tabular-nums text-slate-800">{weekLabel} <span className="font-bold text-slate-500">{md(week.start)}~{md(week.end)}</span></span>
                <button type="button" onClick={() => setWeekStart(shiftDays(week.start, 7))} className="rounded-full px-2 py-1 text-[12px] font-black text-slate-600 hover:bg-white" title="다음 주">▶</button>
                {week.start !== weekOf(kstDate()).start && <button type="button" onClick={() => setWeekStart(weekOf(kstDate()).start)} className="rounded-full px-2 py-1 text-[10px] font-black text-blue-600 hover:bg-white">이번 주</button>}
              </span>
            )}
            <span className="mx-1 hidden h-4 w-px bg-slate-200 sm:inline-block" />
            {([["desc", "최신순"], ["asc", "오래된순"]] as const).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setSortDir(value)} title={`${category.orderField} 기준`}
                className={`rounded-full px-3 py-1.5 text-[11px] font-black transition ${sortDir === value ? "bg-blue-600 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100"}`}>{label}</button>
            ))}
            <div className="flex shrink-0 items-center gap-2 sm:ml-auto">
              <button type="button" onClick={exportCsv} disabled={!rows.length}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-[11px] font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">
                <Download size={13} />CSV
              </button>
            </div>
          </div>
          {category.chipFilter && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-full shrink-0 text-[10px] font-black text-slate-400 sm:w-8">유형</span>
              <button type="button" onClick={() => setChip("")}
                className={`rounded-full px-3.5 py-1.5 text-[11px] font-black transition ${chip === "" ? "bg-slate-900 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100"}`}>전체</button>
              {category.chipFilter.options.map(([value, label]) => (
                <button key={value} type="button" onClick={() => setChip(value)}
                  className={`rounded-full px-3.5 py-1.5 text-[11px] font-black transition ${chip === value ? "bg-slate-900 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100"}`}>{label}</button>
              ))}
            </div>
          )}
          {category.teamField && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-full shrink-0 text-[10px] font-black text-slate-400 sm:w-8">팀</span>
              {["전체", "A", "B", "C", "D", "E"].map((value) => (
                <button key={value} type="button" onClick={() => setTeam(value)}
                  className={`rounded-full px-3.5 py-1.5 text-[11px] font-black transition ${team === value ? "bg-slate-900 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100"}`}>
                  {value === "전체" ? "전체" : teamLabel(value)}
                </button>
              ))}
            </div>
          )}
          {canMember && team !== "전체" && teamMembers.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-full shrink-0 text-[10px] font-black text-slate-400 sm:w-8">인원</span>
              <button type="button" onClick={() => setMember("")}
                className={`rounded-full px-3.5 py-1.5 text-[11px] font-black transition ${member === "" ? "bg-blue-600 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100"}`}>{teamLabel(team)} 전체</button>
              {teamMembers.map((m) => (
                <button key={m.name} type="button" onClick={() => setMember(member === m.name ? "" : m.name)} title={`${m.name}이(가) 작성자인 기록만`}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-black transition ${member === m.name ? "bg-blue-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"}`}>
                  {m.name}<span className={`ml-1 tabular-nums ${member === m.name ? "text-blue-100" : "text-slate-400"}`}>{memberCounts[m.name] === undefined ? "…" : memberCounts[m.name] < 0 ? "?" : memberCounts[m.name]}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={queryDraft} onChange={(e) => setQueryDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") setQuery(queryDraft); }}
                placeholder={`${category.label} 검색 — 업체명 · 작성자 · 내용`}
                className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-8 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
              {queryDraft && <button type="button" onClick={() => { setQueryDraft(""); setQuery(""); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X size={14} /></button>}
            </div>
            <button type="button" onClick={() => setQuery(queryDraft)} className="shrink-0 rounded-full bg-blue-600 px-4 py-2 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700">검색</button>
          </div>
        </div>

        {category.note && <div className="border-b border-amber-100 bg-amber-50/60 px-4 py-2 text-[11px] font-bold text-amber-800">{category.note}</div>}
        {error && <div className="border-b border-rose-100 bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-700">{error}</div>}

        {/* 표 머리 */}
        <div className="hidden gap-2 border-b border-slate-200 bg-slate-100/70 px-4 py-2.5 sm:grid" style={{ gridTemplateColumns: template }}>
          {visibleColumns.map((column) => (
            <span key={column.key} className={`truncate text-[11px] font-black text-slate-500 ${column.align === "right" ? "text-right" : ""} ${hideClass(column)}`}>{column.label}</span>
          ))}
        </div>

        {HIDEABLE.has(category.table) && (
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-4 py-1.5">
            <span className="text-[10px] font-bold text-slate-400">{showHidden ? "오발송 삭제한 기록만 보는 중 — 잘못 지운 건 상세에서 삭제 취소" : "오발송·잘못된 기록은 상세에서 오발송 삭제 (모든 화면·숫자에서 빠짐, 원문 보존)"}</span>
            <button type="button" onClick={() => { setShowHidden((v) => !v); setRows([]); }}
              className={`rounded-full px-2.5 py-1 text-[10px] font-black transition ${showHidden ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
              {showHidden ? "일반 기록 보기" : "삭제한 기록 보기"}
            </button>
          </div>
        )}
        <div className="max-h-[68vh] divide-y divide-slate-100 overflow-y-auto">
          {loading && !rows.length && <div className="p-12 text-center text-sm font-bold text-slate-400">불러오는 중…</div>}
          {!loading && !rows.length && !error && <div className="p-12 text-center text-sm font-bold text-slate-400">조건에 맞는 기록이 없습니다.</div>}

          {rows.map((row, index) => (
            <button key={String(row.id ?? index)} type="button" onClick={() => { setEditDraft(null); setDetail(row); }}
              className="block w-full px-4 py-3 text-left transition hover:bg-blue-50/40">
              {/* PC: 표 / 모바일: 카드 */}
              <span className="hidden gap-2 sm:grid" style={{ gridTemplateColumns: template }}>
                {visibleColumns.map((column) => {
                  const value = shortValue(text(row, column.key), column.key);
                  return (
                    <span key={column.key}
                      className={`truncate text-xs ${column.align === "right" ? "text-right" : ""} ${column.mono ? "font-mono tabular-nums" : ""} ${column.strong ? "text-[13px] font-black text-slate-900" : "font-semibold text-slate-600"} ${hideClass(column)}`}
                      title={value}>{value}</span>
                  );
                })}
              </span>
              <span className="block sm:hidden">
                <span className="flex items-center justify-between gap-2">
                  <b className="truncate text-[13px] font-black text-slate-900">{shortValue(text(row, category.vendorField), category.vendorField)}</b>
                  <span className="shrink-0 font-mono text-[11px] font-bold tabular-nums text-slate-400">{shortValue(text(row, category.dateField), category.dateField)}</span>
                </span>
                <span className="mt-1 block truncate text-[11px] font-semibold text-slate-500">
                  {visibleColumns.filter((column) => column.key !== category.vendorField && column.key !== category.dateField).slice(0, 3)
                    .map((column) => `${column.label} ${shortValue(text(row, column.key), column.key)}`).join(" · ")}
                </span>
              </span>
            </button>
          ))}
        </div>

        {!reachedEnd && rows.length > 0 && (
          <div className="border-t border-slate-100 p-3 text-center">
            <button type="button" disabled={loading} onClick={() => void fetchPage(rows.length)}
              className="rounded-full border border-slate-300 bg-white px-5 py-2 text-sm font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">
              {loading ? "불러오는 중…" : `${PAGE}건 더 보기`}
            </button>
          </div>
        )}
      </section>}

      {detail && (
        <div className="fixed inset-0 z-[200] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => { setEditDraft(null); setDetail(null); }}>
          <div className="flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-w-3xl sm:rounded-xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4">
              <div className="min-w-0">
                <div className="text-[11px] font-black text-blue-600">{category.label}</div>
                <div className="truncate text-base font-black text-slate-950">{text(detail, category.vendorField) || "제목 없음"}</div>
              </div>
              <button type="button" onClick={() => setDetail(null)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100"><X size={18} /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
              {/* 미수 상세와 같은 라벨-값 줄 — 전화번호가 보이면 바로 걸 수 있게 */}
              <div className="rounded-lg border border-slate-200 p-3">
                {detailFields.filter(([key]) => !["_원문", "원문", "source_text", "report_text", "_raw", "photos", "remote_meta"].includes(key)).map(([key, value]) => {
                  const phone = value.match(/0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}/)?.[0];
                  const editable = editDraft !== null && (EDITABLE_FIELDS[category.table] || []).includes(key);
                  return (
                    <div key={key} className="flex items-start justify-between gap-3 border-b border-slate-50 py-1.5 last:border-0">
                      <span className="w-24 shrink-0 pt-0.5 text-[11px] font-black text-slate-400">{key.replace(/^_/, "")}</span>
                      {editable
                        ? <input value={editDraft[key] ?? value} onChange={(e) => setEditDraft((cur) => ({ ...(cur || {}), [key]: e.target.value }))}
                            className="min-w-0 flex-1 rounded-lg border border-blue-300 bg-blue-50/40 px-2 py-1 text-sm font-bold text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                        : <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm font-bold leading-5 text-slate-800">{value}</span>}
                      {!editable && phone && <a href={`tel:${phone.replace(/[^0-9]/g, "")}`} className="shrink-0 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-black text-white transition hover:bg-emerald-700">📞</a>}
                    </div>
                  );
                })}
              </div>
              {Array.isArray(detail["_edit_log"]) && (detail["_edit_log"] as unknown[]).length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                  <div className="mb-1 text-[10px] font-black tracking-wide text-amber-700">수정 이력</div>
                  {(detail["_edit_log"] as Array<{ at?: string; by?: string; changes?: Record<string, [string, string]> }>).map((entry, index) => (
                    <div key={index} className="border-b border-amber-100 py-1 text-[11px] font-bold text-amber-900 last:border-0">
                      <span className="tabular-nums text-amber-700">{String(entry.at || "").slice(0, 16).replace("T", " ")}</span> · {entry.by || "미지정"}
                      {Object.entries(entry.changes || {}).map(([key, [before, after]]) => (
                        <span key={key} className="ml-2 inline-block">{key}: {before || "(빈값)"} → <b>{after || "(빈값)"}</b></span>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {detailFields.filter(([key]) => ["_원문", "원문", "source_text", "report_text"].includes(key)).map(([key, value]) => (
                <div key={key} className="rounded-lg border border-slate-200 p-3">
                  <div className="mb-1 text-[10px] font-black tracking-wide text-slate-400">{key.replace(/^_/, "")}</div>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-mono text-[11px] leading-5 text-slate-700">{value}</pre>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              {/* 기기 식별자 수정 — 잘못 접수된 기번이 이력으로 남으면 다음 AS 판단이 틀려진다.
                  이 행이 통합이력·FIELD 검색·접수 AS히스토리의 원본이라 여기서 고치면 전부 반영된다. */}
              {(EDITABLE_FIELDS[category.table] || []).length > 0 && detail.id != null && (
                editDraft === null
                  ? <button type="button" onClick={() => setEditDraft({})}
                      className="mr-auto rounded-full border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-black text-blue-700 transition hover:bg-blue-100">✏️ 기록 수정</button>
                  : <>
                      <button type="button" onClick={() => setEditDraft(null)}
                        className="mr-auto rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-600">취소</button>
                      <button type="button" disabled={editBusy || !Object.keys(editDraft).length}
                        onClick={async () => {
                          const changed = Object.entries(editDraft).filter(([key, next]) => next.trim() !== String(detail[key] ?? "").trim());
                          // _원문에도 같은 라벨 줄이 있으면 함께 고친다 — FIELD 불러오기·통합이력이 원문을 읽어서,
                          // 컬럼만 고치면 거기엔 옛 값이 그대로 남는다(실제 지적). 변경 전 값은 _edit_log에 남긴다.
                          const raw = typeof detail["_원문"] === "string" ? String(detail["_원문"]) : "";
                          const rewriteRaw = () => {
                            if (!raw.trim()) return "";
                            const lines = raw.split("\n");
                            let touched = false;
                            for (const key of EDITABLE_FIELDS[category.table] || []) {
                              const next = (editDraft[key] ?? String(detail[key] ?? "")).trim();
                              if (!next) continue;
                              const hits = lines.map((line, index) => ({ index, m: line.match(new RegExp(`^(\\s*${key}\\s*[:：]\\s*)(.*)$`)) }))
                                .filter((h): h is { index: number; m: RegExpMatchArray } => !!h.m);
                              const oldVal = String(detail[key] ?? "").trim();
                              for (const h of hits) {
                                const cur = h.m[2].trim();
                                if (cur === next) continue;
                                // 여러 기기 블록이 한 원문에 있을 수 있다 — 이 행의 옛 값과 같은 줄만 고친다.
                                // (옛 값을 모르면 줄이 하나뿐일 때만 — 다른 기기 줄을 건드리면 안 된다)
                                if (oldVal ? cur === oldVal : hits.length === 1) {
                                  lines[h.index] = h.m[1] + next;
                                  touched = true;
                                }
                              }
                            }
                            return touched ? lines.join("\n") : "";
                          };
                          const newRaw = rewriteRaw();
                          if (!changed.length && !newRaw) { setEditDraft(null); return; }
                          const summary = [
                            ...changed.map(([key, next]) => `${key}: ${String(detail[key] ?? "") || "(빈값)"} → ${next.trim() || "(빈값)"}`),
                            ...(newRaw ? ["원문 속 해당 줄도 함께 수정"] : []),
                          ].join("\n");
                          if (!await askConfirm(`이 기록을 수정할까요?\n\n${summary}\n\n통합이력·FIELD 불러오기·접수 AS히스토리가 전부 이 기록을 읽으므로 모든 화면에 바로 반영됩니다. 변경 전 값은 수정 이력에 남습니다.`)) return;
                          setEditBusy(true);
                          const patch: Record<string, unknown> = Object.fromEntries(changed.map(([key, next]) => [key, next.trim()]));
                          // 업체명을 고치면 매칭 키(_업체명)도 함께 — 안 맞추면 검색은 되는데 이력 매칭이 어긋난다
                          if (typeof patch["업체명"] === "string") patch["_업체명"] = patch["업체명"];
                          if (newRaw) patch["_원문"] = newRaw;
                          // 수정 이력 — 누가 언제 무엇을 바꿨는지 (원문 원본 추적은 이 로그가 담당한다)
                          const prevLog = Array.isArray(detail["_edit_log"]) ? detail["_edit_log"] as unknown[] : [];
                          patch["_edit_log"] = [...prevLog, {
                            at: new Date().toISOString(), by: author || "미지정",
                            changes: Object.fromEntries(changed.map(([key, next]) => [key, [String(detail[key] ?? ""), next.trim()]])),
                            ...(newRaw ? { rawRewritten: true } : {}),
                          }];
                          try {
                            // 8/17 보안 강화로 anon UPDATE가 회수된 테이블 — 엣지 함수가 화이트리스트 검증 후 대신 쓴다
                            const r = await invokeEdgeFunction<{ ok?: boolean; error?: string }>("record-edit",
                              { action: "edit", table: category.table, id: String(detail.id), patch });
                            if (r.error) throw new Error(r.error);
                            setDetail({ ...detail, ...patch });
                            setRows((cur) => cur.map((row) => (row.id === detail.id ? { ...row, ...patch } : row)));
                            setEditDraft(null);
                          } catch (e) {
                            alert(`수정 실패: ${(e as Error).message}`);
                          } finally {
                            setEditBusy(false);
                          }
                        }}
                        className="rounded-full bg-blue-600 px-5 py-2 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-40">{editBusy ? "저장 중…" : "저장"}</button>
                    </>
              )}
              <button type="button" onClick={() => { void navigator.clipboard.writeText(detailFields.map(([key, value]) => `${key}: ${value}`).join("\n")); }}
                className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-600 transition hover:bg-slate-50">전체 복사</button>
              {HIDEABLE.has(category.table) && detail.id != null && (
                <button type="button" disabled={hideBusy}
                  onClick={async () => {
                    const hiding = !showHidden;
                    if (!await askConfirm(hiding
                      ? `이 기록을 오발송 삭제할까요?\n모든 화면·숫자(조회·팀 현황·순위표)에서 바로 빠집니다. 원문은 보존되어 [삭제한 기록 보기]에서 삭제 취소할 수 있습니다.${SHEET_MIRROR_TABLES.has(category.table) ? "\n시트가 원본인 표라 밤마다 시트로 다시 채워지지만 삭제 장부가 막아 다음 날에도 빠진 채로 둡니다. 다만 시트에서 그 행 내용을 고치면 새 기록으로 다시 생기니, 시트에서도 지우는 것이 확실합니다." : ""}`
                      : "오발송 삭제를 취소할까요?\n이 기록이 다시 모든 화면·숫자에 들어갑니다.", { danger: hiding, okLabel: hiding ? "오발송 삭제" : "삭제 취소" })) return;
                    setHideBusy(true);
                    void invokeEdgeFunction<{ ok?: boolean; error?: string }>("record-edit",
                      { action: "hide", table: category.table, id: String(detail.id), hidden: hiding, by: author || "미지정" })
                      .then((r) => { if (r.error) throw new Error(r.error); })
                      .then(() => {
                        // 현장 기록(점검·AS·물류)은 업무현황판 집계에서도 같이 제외/복원 — 오발송 기능 일원화
                        if (["jeomgeom", "as_records", "logistics_records"].includes(category.table)) {
                          const sourceText = String(detail["_원문"] ?? detail["원문"] ?? detail["source_text"] ?? "");
                          const rowAuthor = String(detail["작성자"] ?? detail["author"] ?? "");
                          const rowDate = String(detail[category.dateField] ?? "").slice(0, 10);
                          const rowVendor = String(detail["_업체명"] ?? detail["업체명"] ?? "");
                          if (sourceText.trim() && rowAuthor && rowDate) {
                            void setActivityEventsCancelledBySource(sourceText, rowAuthor, rowDate, hiding, author || "미지정").catch(() => {});
                            void setVisitsCancelledBySource(sourceText, rowAuthor, rowDate, hiding, author || "미지정").catch(() => {});
                          }
                          // 원문이 조금 달라진 중복 전송분까지 — 업체+작성자+날짜 기준으로 한 번 더
                          if (rowVendor.trim() && rowAuthor && rowDate) {
                            void setVisitsCancelledByVendor(rowVendor, rowAuthor, rowDate, hiding, author || "미지정").catch(() => {});
                            void setActivityEventsCancelledByVendor(rowVendor, rowAuthor, rowDate, hiding, author || "미지정").catch(() => {});
                          }
                        }
                        // 확장성 건수는 이제 표(_hidden)에서 바로 센다(workCount countExpansion). 아래는 활동 기록(통합검색 타임라인·
                        // 실시간 전송판)도 맞춰 두는 것 — 같은 사람·같은 날·같은 거래처에 보이는 행이 하나도 안 남을 때만 취소.
                        const expansionKind = EXPANSION_KIND_BY_TABLE[category.table];
                        const authorField = expansionAuthorField(category.table);
                        if (expansionKind && authorField) {
                          const rowAuthor = String(detail[authorField] ?? "").trim();
                          const rowVendor = String(detail["_업체명"] ?? "").trim();
                          const rowDay = kstDayOf(String(detail[category.dateField] ?? ""));
                          if (rowAuthor && rowVendor && /^\d{4}-\d{2}-\d{2}$/.test(rowDay)) {
                            const kst = kstTextRange(rowDay, rowDay);
                            const same = [`_hidden=not.is.true`, `${encodeURIComponent(authorField)}=eq.${encodeURIComponent(rowAuthor)}`,
                              `${encodeURIComponent("_업체명")}=eq.${encodeURIComponent(rowVendor)}`,
                              `${encodeURIComponent(category.dateField)}=gte.${kst.gte}`, `${encodeURIComponent(category.dateField)}=lt.${kst.lt}`].join("&");
                            void countRows(category.table, same)
                              .then((left) => { if (hiding ? left === 0 : left > 0) return setActivityEventsCancelledByKey(expansionKind, rowVendor, rowAuthor, rowDay, hiding, author || "미지정"); })
                              .catch((e: unknown) => notify(`활동 기록 반영 실패:${(e as Error).message}`, "error"));
                          }
                        }
                        setRows((current) => current.filter((r) => r.id !== detail.id));
                        setDetail(null);
                        if (isExpansionTable(category.table) || isFieldTable(category.table)) setExpansionNonce((n) => n + 1); // 건수 카드도 바로 다시 센다
                      })
                      .catch((e: unknown) => notify(`처리 실패: ${(e as Error).message}`, "error"))
                      .finally(() => setHideBusy(false));
                  }}
                  className={`rounded-full border px-4 py-2 text-sm font-black transition disabled:opacity-40 ${showHidden ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100"}`}>
                  {hideBusy ? "처리 중…" : showHidden ? "삭제 취소" : "오발송 삭제"}
                </button>
              )}
              <button type="button" onClick={() => setDetail(null)} className="rounded-full bg-slate-900 px-5 py-2 text-sm font-black text-white transition hover:bg-slate-800">닫기</button>
            </div>
          </div>
        </div>
      )}
      </div>
      {pickerOpen && (
        <div className="fixed inset-0 z-[200] flex items-end bg-black/40 lg:hidden" onMouseDown={() => setPickerOpen(false)}>
          <div className="max-h-[82vh] w-full overflow-y-auto rounded-t-2xl bg-white pb-6 shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-3"><b className="text-[14px] text-slate-900">기록 조회 항목</b><button type="button" onClick={() => setPickerOpen(false)} className="text-[12px] font-black text-slate-500">닫기</button></div>
            {groupedList(true)}
          </div>
        </div>
      )}
    </div>
  );
}
