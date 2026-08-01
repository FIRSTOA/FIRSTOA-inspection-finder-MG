import PortalSelect from "./PortalSelect";
import { useEffect, useMemo, useState } from "react";
import { selectAllRows, selectRows } from "./supabase";

/**
 * 미수·초과료 현황 보드 — 조회 탭이 렌더한다.
 * 원래 부서 요청 화면의 하위 탭이었으나, 성격이 "조회"라 옮겨왔다 (2026-08-01).
 * 시트 전체 재적재 표라 created_at 정렬이 무의미해서 자체 정렬(잔액/개월/최신)을 가진다.
 */
/**
 * 부서 요청 — 타부서(관리부·영업부 등)가 CS팀에 남기는 요청함.
 * 카운터확인·미수체크·방문요청을 리스트로 받고, 미수 현황 탭에서 미수 시트를 보기 좋게 조회한다.
 * (supabase/dept-requests.sql)
 */


// 유형은 분류일 뿐이라 색을 주지 않는다 — 색은 "지금 급한가"(상태)에만 쓴다.

type SheetRecord = Record<string, unknown>;

const TEAM_NAMES = ["A", "B", "C", "D", "E"];
function teamOfSource(source: string) {
  return String(source || "").match(/수도권([A-E])/)?.[1] || "";
}
const SHEET_ERROR = /^#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NULL!|ERROR!?)$/i;
function str(row: SheetRecord, key: string) {
  const value = String(row[key] ?? "").trim();
  // 시트의 VLOOKUP 실패값(#N/A 등)이 그대로 동기화된 것 — 값이 아니라 빈칸으로 취급
  return SHEET_ERROR.test(value) ? "" : value;
}
function won(value: string | number) {
  const digits = Number(String(value).replace(/[^\d]/g, "")) || 0;
  return digits ? `₩${digits.toLocaleString()}` : "-";
}

// 행 클릭 상세 팝업 — 지정한 필드 순서대로, 값 있는 것만
// 상세 모달 섹션 구성: 핵심 수치는 크게, 연락처는 바로 걸 수 있게, 체크 이력은 묶어서
type DetailLayout = {
  metrics: [string, "won" | "months" | "text", string?][]; // [컬럼키, 형식, 표시라벨]
  sections: { label: string; fields: string[] }[];          // 이름 붙은 정보 묶음들
};

function SheetDetailModal({ title, row, fields, onClose, layout }: { title: string; row: SheetRecord; fields: string[]; onClose: () => void; layout?: DetailLayout }) {
  const raw = (row["_raw"] && typeof row["_raw"] === "object" ? row["_raw"] : {}) as Record<string, unknown>;
  const valueOf = (key: string) => str(row, key) || String(raw[key] ?? "").trim();
  const used = new Set<string>(["_업체명"]);
  const badges = ["등급", "지역", "임대여부", "관리담당자", "관리 담당자"].map((key) => { used.add(key); return [key, valueOf(key)] as [string, string]; }).filter(([, v]) => v);
  const metrics = (layout?.metrics || []).map(([key, kind, label]) => { used.add(key); return { key, kind, label: label || key, value: valueOf(key) }; }).filter((m) => m.value);
  const sections = (layout?.sections || []).map(({ label, fields: sectionFields }) => ({
    label,
    rows: sectionFields.map((key) => { used.add(key); return [key, valueOf(key)] as [string, string]; }).filter(([, v]) => v),
  })).filter((sec) => sec.rows.length);
  const restKeys = [...fields.filter((key) => !used.has(key)), ...Object.keys(raw).filter((key) => !fields.includes(key) && !used.has(key) && !key.startsWith("_"))];
  const rest = restKeys.map((key) => [key, valueOf(key)] as [string, string]).filter(([key, v]) => v && key !== "원문");
  const rawText = valueOf("원문");

  const metricView = (m: { key: string; kind: string; value: string }) => {
    if (m.kind === "won") { const n = Number(m.value.replace(/[^\d]/g, "")) || 0; return <span>{n.toLocaleString()}<small className="ml-0.5 text-xs font-bold text-slate-400">원</small></span>; }
    if (m.kind === "months") { const n = Number(m.value.replace(/[^\d]/g, "")) || 0; return <span className={n >= 3 ? "text-rose-600" : ""}>{n}<small className="ml-0.5 text-xs font-bold text-slate-400">개월</small></span>; }
    return <span className="break-all text-base">{m.value}</span>;
  };
  const rowLine = ([key, value]: [string, string]) => {
    const phone = value.match(/0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}/)?.[0];
    return (
      <div key={key} className="flex items-start justify-between gap-3 py-1.5">
        <span className="w-20 shrink-0 pt-0.5 text-[11px] font-black text-slate-400">{key.replace(/^_/, "")}</span>
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm font-bold leading-5 text-slate-800">{value}</span>
        {phone && <a href={`tel:${phone.replace(/[^0-9]/g, "")}`} className="shrink-0 rounded-full bg-emerald-600 transition hover:bg-emerald-700 px-2.5 py-1 text-[11px] font-black text-white">📞</a>}
      </div>
    );
  };
  const section = (label: string, body: React.ReactNode) => (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-1 text-[10px] font-black tracking-wide text-slate-400">{label}</div>
      {body}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[220] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={onClose}>
      <div className="flex max-h-[88vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 text-lg font-black leading-6 text-slate-950">{valueOf("_업체명") || title || "업체명 없음 (단기건 등)"}</div>
            <button type="button" onClick={onClose} className="h-8 w-8 shrink-0 rounded-lg text-xl font-black text-slate-400">×</button>
          </div>
          {badges.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">
            {badges.map(([key, value]) => <span key={key} className={`rounded px-1.5 py-0.5 text-[11px] font-black ${key === "등급" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>{key === "등급" ? `${value}등급` : value}</span>)}
          </div>}
        </div>
        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
          {metrics.length > 0 && <div className={`grid gap-1.5 ${metrics.length <= 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4"}`}>
            {metrics.map((m) => (
              <div key={m.key} className="rounded-lg bg-slate-50 px-2 py-2.5 text-center">
                <div className="text-lg font-black text-slate-900">{metricView(m)}</div>
                <div className="mt-0.5 text-[10px] font-bold text-slate-400">{m.label}</div>
              </div>
            ))}
          </div>}
          {sections.map((sec) => <div key={sec.label}>{section(sec.label, <div className="divide-y divide-slate-100">{sec.rows.map(rowLine)}</div>)}</div>)}
          {rest.length > 0 && section("기타 정보", <div className="divide-y divide-slate-100">{rest.map(rowLine)}</div>)}
          {!!rawText && <details className="rounded-lg border border-slate-200">
            <summary className="cursor-pointer px-3 py-2.5 text-xs font-black text-slate-500">원문 펼치기</summary>
            <pre className="whitespace-pre-wrap border-t border-slate-100 bg-slate-50 p-3 text-xs leading-5 text-slate-700">{rawText}</pre>
          </details>}
        </div>
      </div>
    </div>
  );
}

const MISU_DETAIL_LAYOUT: DetailLayout = {
  metrics: [["미수개월", "months"], ["미수잔액", "won"], ["실제 개월수", "months"], ["실제 잔액", "won"]],
  sections: [
    { label: "연락처 · 주소", fields: ["업체담당자", "휴대폰번호", "메일주소", "주소"] },
    { label: "확인 · 체크 이력", fields: ["입금약속일", "체크여부", "CS담당", "CS체크", "CS-1회", "CS-2회", "경영담당", "경영체크", "경영-1회", "경영-2회", "전략담당", "전략체크", "전략-1회", "전략-2회", "메일발송여부", "문자발송여부"] },
  ],
};

const OVERAGE_DETAIL_LAYOUT: DetailLayout = {
  metrics: [["합계", "won", "초과료 합계"], ["컬러초과료", "won", "컬러 초과료"], ["흑백초과료", "won", "흑백 초과료"], ["기본금액", "won", "기본금액"]],
  sections: [
    { label: "접수 내용", fields: ["날짜", "접수내용", "초과보고", "AS건수", "AS접수내용"] },
    { label: "계약 · 기기", fields: ["마감방식", "기본매수", "초과장당금액", "연평균", "계약일", "종료일", "남은개월", "모델명", "자산번호"] },
    { label: "연락처", fields: ["업체담당자", "전화번호", "주소"] },
    { label: "미수 연계", fields: ["미수개월수", "미수금액"] },
    { label: "특이사항", fields: ["특이사항", "소모품정보"] },
  ],
};

const MISU_DETAIL_FIELDS = ["_업체명", "지역", "미수개월", "미수잔액", "실제 개월수", "실제 잔액", "입금약속일", "CS담당", "CS체크", "CS-1회", "CS-2회", "경영담당", "경영체크", "경영-1회", "경영-2회", "전략담당", "전략체크", "전략-1회", "전략-2회", "체크여부", "월임대료", "업체담당자", "관리담당자", "휴대폰번호", "메일주소", "주소", "등급", "임대여부", "거래처코드", "메일발송여부", "문자발송여부", "입력일", "입력자", "_출처", "원문"];

type CsCheckRow = { key: string; team: string; vendor: string; checked: boolean; cs_manager: string; cs1: string; cs2: string; synced_at: string };

export function MisuBoard() {
  const [rows, setRows] = useState<SheetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [team, setTeam] = useState("전체");
  const [monthsFilter, setMonthsFilter] = useState<"전체" | "1~2개월" | "3개월+">("전체");
  const [sort, setSort] = useState<"잔액순" | "개월순" | "최신순">("잔액순");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<SheetRecord | null>(null);
  // 관리부가 시트에서 CS체크한 업체만 모아 보는 목록 (misu_cs_checks — GAS 1시간 동기화)
  const [boardView, setBoardView] = useState<"전체" | "CS체크">("전체");
  const [csChecks, setCsChecks] = useState<CsCheckRow[] | null>(null);
  useEffect(() => {
    selectRows<CsCheckRow>("misu_cs_checks", "select=*&checked=eq.true&order=team.asc,vendor.asc")
      .then(setCsChecks)
      .catch(() => setCsChecks(null)); // 테이블 미설치면 안내만
  }, []);

  useEffect(() => {
    let active = true;
    const sourceCol = encodeURIComponent("_출처");
    selectAllRows<SheetRecord>("misu", `select=*&${sourceCol}=like.${encodeURIComponent("시트")}*&order=id.asc`)
      .then((data) => {
        if (!active) return;
        // 시트에 있는 행 그대로 (팀별 건수가 시트와 일치하게). 잔액은 팀마다 컬럼이 달라
        // 미수잔액 → 실제 잔액 순으로 읽는다 (B팀 시트는 '실제 잔액'만 있음).
        setRows(data.filter((row) => str(row, "_업체명")).map((row) => {
          const balance = Number(str(row, "미수잔액").replace(/[^\d]/g, "")) || Number(str(row, "실제 잔액").replace(/[^\d]/g, "")) || 0;
          const months = Number(str(row, "미수개월").replace(/[^\d]/g, "")) || Number(str(row, "실제 개월수").replace(/[^\d]/g, "")) || 0;
          const match = str(row, "입력일").match(/(\d{4})[.\-/]\s*(\d{1,2})(?:[.\-/]\s*(\d{1,2}))?/);
          const date = match ? `${match[1]}-${match[2].padStart(2, "0")}-${(match[3] || "1").padStart(2, "0")}` : "";
          return { ...row, _team: teamOfSource(str(row, "_출처")), _balance: balance, _months: months, _date: date };
        }));
      })
      .catch((e) => { if (active) setError((e as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (team !== "전체" && str(r, "_team") !== team) return false;
      const months = Number(r["_months"]) || 0;
      if (monthsFilter === "1~2개월" && months >= 3) return false;
      if (monthsFilter === "3개월+" && months < 3) return false;
      if (keyword && !str(r, "_업체명").toLowerCase().includes(keyword)) return false;
      return true;
    });
    const balanceOf = (r: SheetRecord) => Number(r["_balance"]) || 0;
    const monthsOf = (r: SheetRecord) => Number(r["_months"]) || 0;
    const flip = sortDir === "asc" ? -1 : 1;
    if (sort === "잔액순") return [...list].sort((a, b) => (balanceOf(b) - balanceOf(a)) * flip);
    if (sort === "개월순") return [...list].sort((a, b) => (monthsOf(b) - monthsOf(a) || balanceOf(b) - balanceOf(a)) * flip);
    return [...list].sort((a, b) => String(b["_date"]).localeCompare(String(a["_date"])) * flip);
  }, [rows, team, monthsFilter, sort, sortDir, query]);

  const totalBalance = filtered.reduce((sum, r) => sum + (Number(r["_balance"]) || 0), 0);

  const csList = (csChecks || []).filter((c) => (team === "전체" || c.team === team) && (!query.trim() || c.vendor.toLowerCase().includes(query.trim().toLowerCase())));
  const misuByVendor = useMemo(() => {
    const map = new Map<string, SheetRecord>();
    rows.forEach((r) => map.set(`${str(r, "_team")}|${str(r, "_업체명").trim()}`, r));
    return map;
  }, [rows]);

  return (
    <div className="space-y-3">
      <div className="flex w-fit rounded-full bg-slate-100 p-1">
        {(["전체", "CS체크"] as const).map((name) => (
          <button key={name} type="button" onClick={() => setBoardView(name)} className={`rounded-full px-4 py-1.5 text-sm font-black transition ${boardView === name ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
            {name === "전체" ? "전체 현황" : "CS체크 목록"}
            {name === "CS체크" && csChecks && <span className={`ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${boardView === name ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-500"}`}>{(csChecks || []).length}</span>}
          </button>
        ))}
      </div>
      {boardView === "CS체크" && (
        <div className="space-y-3">
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
            {["전체", ...TEAM_NAMES].map((name) => {
              const count = name === "전체" ? (csChecks || []).length : (csChecks || []).filter((c) => c.team === name).length;
              return (
                <button key={name} type="button" onClick={() => setTeam(name)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-black transition sm:px-3.5 ${team === name ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
                  {name === "전체" ? "전체" : `${name}팀`} <span className={team === name ? "text-blue-300" : "text-blue-600"}>{count}</span>
                </button>
              );
            })}
          </div>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="업체명 검색" className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
          {csChecks === null && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs font-bold text-amber-700">CS체크 동기화가 아직 설정되지 않았어요 — Supabase에서 misu-cs-check.sql 실행 후 First-DATA GAS의 syncMisuCsToSupabase를 실행해 주세요.</div>}
          {csChecks !== null && <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="grid grid-cols-[minmax(0,1fr)_26px_40px_84px] gap-1.5 border-b border-slate-200 bg-slate-100/70 px-3 py-3 text-[11px] font-black text-slate-500 sm:grid-cols-[minmax(0,1fr)_50px_70px_120px_110px_110px] sm:gap-2 sm:px-4">
              <span>업체명</span><span>팀</span><span className="text-right">개월</span><span className="text-right">잔액</span><span className="hidden sm:block">CS-1회</span><span className="hidden sm:block">CS-2회</span>
            </div>
            <div className="max-h-[62vh] divide-y divide-slate-100 overflow-y-auto">
              {csList.map((c) => {
                const misu = misuByVendor.get(`${c.team}|${c.vendor.trim()}`);
                return (
                  <button key={c.key} type="button" onClick={() => misu && setDetail(misu)} className={`grid w-full grid-cols-[minmax(0,1fr)_26px_40px_84px] items-center gap-1.5 px-3 py-2.5 text-left text-xs sm:grid-cols-[minmax(0,1fr)_50px_70px_120px_110px_110px] sm:gap-2 sm:px-4 ${misu ? "hover:bg-blue-50/40" : "cursor-default"}`}>
                    <span className="min-w-0">
                      <span className="block truncate font-black text-slate-800">{c.vendor}</span>
                      {c.cs_manager && <span className="block truncate text-[10px] font-bold text-slate-400">CS담당 {c.cs_manager}</span>}
                    </span>
                    <span className="font-bold text-slate-500">{c.team ? <><span className="sm:hidden">{c.team}</span><span className="hidden sm:inline">{c.team}팀</span></> : "-"}</span>
                    <span className={`text-right font-black ${misu && (Number(misu["_months"]) || 0) >= 3 ? "text-rose-600" : "text-slate-600"}`}>{misu && Number(misu["_months"]) ? <><span className="sm:hidden">{String(misu["_months"])}</span><span className="hidden sm:inline">{String(misu["_months"])}개월</span></> : "-"}</span>
                    <span className="text-right font-black text-slate-800">{misu ? won(Number(misu["_balance"]) || 0) : "-"}</span>
                    <span className="hidden truncate font-semibold text-slate-500 sm:block">{c.cs1 || "-"}</span>
                    <span className="hidden truncate font-semibold text-slate-500 sm:block">{c.cs2 || "-"}</span>
                  </button>
                );
              })}
              {!csList.length && <div className="p-10 text-center text-sm font-bold text-slate-400">CS체크된 업체가 없어요.</div>}
            </div>
          </section>}
          {detail && <SheetDetailModal title={`${str(detail, "_업체명")} — 미수 상세`} row={detail} fields={MISU_DETAIL_FIELDS} layout={MISU_DETAIL_LAYOUT} onClose={() => setDetail(null)} />}
        </div>
      )}
      {boardView === "전체" && <>
      <div className="grid grid-cols-3 gap-2">
        {([
          [`${filtered.length}곳`, "미수 업체"],
          [won(totalBalance), "잔액 합계"],
          [`${filtered.filter((r) => (Number(r["_months"]) || 0) >= 3).length}곳`, "3개월 이상"],
        ] as [string, string][]).map(([value, label]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white px-3 py-4 text-center shadow-sm">
            <div className="truncate text-lg font-black tabular-nums text-slate-950 sm:text-xl">{value}</div>
            <div className="mt-1 text-[11px] font-bold text-slate-400">{label}</div>
          </div>
        ))}
      </div>
      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <span className="w-8 shrink-0 text-[10px] font-black text-slate-400">팀</span>
          {["전체", ...TEAM_NAMES].map((name) => <button key={name} type="button" onClick={() => setTeam(name)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-black transition sm:px-3.5 ${team === name ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>{name === "전체" ? "전체" : `${name}팀`}</button>)}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-8 text-[10px] font-black text-slate-400">조건</span>
          {(["전체", "1~2개월", "3개월+"] as const).map((name) => <button key={name} type="button" onClick={() => setMonthsFilter(name)} className={`rounded-full px-3 py-1.5 text-[11px] font-black transition ${monthsFilter === name ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>{name}</button>)}
          <span className="ml-2 w-8 shrink-0 text-[10px] font-black text-slate-400">정렬</span>
          <span className="flex rounded-full bg-slate-100 p-1">
            {(["잔액순", "개월순", "최신순"] as const).map((name) => <button key={name} type="button" onClick={() => { if (sort === name) setSortDir((d) => (d === "desc" ? "asc" : "desc")); else { setSort(name); setSortDir("desc"); } }} className={`rounded-full px-2.5 py-1 text-[11px] font-black ${sort === name ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{name}{sort === name ? (sortDir === "desc" ? " ↓" : " ↑") : ""}</button>)}
          </span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="업체명 검색" className="h-9 min-w-32 flex-1 rounded-lg border border-slate-300 px-3 text-xs font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
        </div>
      </div>
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div>}
      {loading && <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">불러오는 중…</div>}
      {!loading && <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-[minmax(0,1fr)_64px_100px_70px] gap-2 border-b border-slate-200 bg-slate-100/70 px-4 py-3 text-[11px] font-black text-slate-500 sm:grid-cols-[minmax(0,1fr)_50px_90px_70px_120px_80px]">
          <span>업체명</span><span className="hidden sm:block">팀</span><span className="hidden sm:block">지역</span><span className="text-right">개월</span><span className="text-right">잔액</span><span className="text-right">입력일</span>
        </div>
        <div className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
          {filtered.map((r) => (
            <button key={String(r["id"])} type="button" onClick={() => setDetail(r)} className="grid w-full grid-cols-[minmax(0,1fr)_64px_100px_70px] items-center gap-2 px-4 py-3 text-left text-xs transition hover:bg-blue-50/50 sm:grid-cols-[minmax(0,1fr)_50px_90px_70px_120px_80px]">
              <span className="truncate text-[13px] font-black text-slate-900">{str(r, "_업체명")}</span>
              <span className="hidden font-bold text-slate-500 sm:block">{str(r, "_team") ? `${str(r, "_team")}팀` : "-"}</span>
              <span className="hidden truncate font-bold text-slate-500 sm:block">{str(r, "지역") || "-"}</span>
              <span className={`text-right font-black ${(Number(r["_months"]) || 0) >= 3 ? "text-rose-600" : "text-slate-600"}`}>{Number(r["_months"]) ? `${r["_months"]}개월` : "-"}</span>
              <span className="text-right font-black text-slate-800">{won(Number(r["_balance"]) || 0)}</span>
              <span className="text-right font-bold text-slate-400">{String(r["_date"] || "").slice(2) || "-"}</span>
            </button>
          ))}
          {!filtered.length && <div className="p-10 text-center text-sm font-bold text-slate-400">조건에 맞는 미수 업체가 없어요.</div>}
        </div>
      </section>}
      {detail && <SheetDetailModal title={`${str(detail, "_업체명")} — 미수 상세`} row={detail} fields={MISU_DETAIL_FIELDS} layout={MISU_DETAIL_LAYOUT} onClose={() => setDetail(null)} />}
      </>}
    </div>
  );
}

const OVERAGE_DETAIL_FIELDS = ["_업체명", "관리 담당자", "날짜", "접수내용", "컬러초과료", "흑백초과료", "합계", "마감방식", "기본매수", "초과장당금액", "AS건수", "초과보고", "모델명", "자산번호", "등급", "임대여부", "기본금액", "연평균", "계약일", "종료일", "남은개월", "미수개월수", "미수금액", "전화번호", "특이사항", "AS접수내용", "소모품정보", "_출처"];

function overageTeam(row: SheetRecord): string {
  const raw = (row["_raw"] && typeof row["_raw"] === "object" ? row["_raw"] : {}) as Record<string, unknown>;
  const manager = String(raw["관리 담당자"] ?? "").trim();
  const metro = manager.match(/수도권([A-E])/)?.[1];
  if (metro) return metro;
  return manager ? "E" : ""; // 경상도·충청도 등 지방권역은 E
}

export function OverageBoard() {
  const [rows, setRows] = useState<SheetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [team, setTeam] = useState("전체");
  const [grade, setGrade] = useState("전체");
  const [yearMonth, setYearMonth] = useState("전체");
  const [sort, setSort] = useState<"최신순" | "금액순">("최신순");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<SheetRecord | null>(null);

  useEffect(() => {
    let active = true;
    const sourceCol = encodeURIComponent("_출처");
    // 최근 12개월치만 — 오래된 초과 기록까지 다 내려받으면 payload만 커진다 (예: 26년 7월이면 25-07-01부터)
    const now = new Date();
    const fromDate = `${now.getFullYear() - 1}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    selectAllRows<SheetRecord>("overage", `select=*&${sourceCol}=like.${encodeURIComponent("시트")}*&${encodeURIComponent("날짜")}=gte.${fromDate}&order=id.desc`)
      .then((data) => {
        if (!active) return;
        setRows(data.map((row) => {
          const match = str(row, "날짜").match(/(\d{4})[.\-/]\s*(\d{1,2})(?:[.\-/]\s*(\d{1,2}))?/);
          const date = match ? `${match[1]}-${match[2].padStart(2, "0")}-${(match[3] || "1").padStart(2, "0")}` : "";
          return { ...row, _date: date, _total: Number(str(row, "합계").replace(/[^\d]/g, "")) || 0, _team: overageTeam(row) };
        }));
      })
      .catch((e) => { if (active) setError((e as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const yearMonths = useMemo(() => ["전체", ...Array.from(new Set(rows.map((r) => String(r["_date"] || "").slice(0, 7)).filter(Boolean))).sort().reverse().slice(0, 18)], [rows]);
  const grades = useMemo(() => ["전체", ...Array.from(new Set(rows.map((r) => str(r, "등급")).filter(Boolean))).sort()], [rows]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (team !== "전체" && str(r, "_team") !== team) return false;
      if (grade !== "전체" && str(r, "등급") !== grade) return false;
      if (yearMonth !== "전체" && String(r["_date"] || "").slice(0, 7) !== yearMonth) return false;
      if (keyword && !str(r, "_업체명").toLowerCase().includes(keyword) && !str(r, "접수내용").toLowerCase().includes(keyword)) return false;
      return true;
    });
    const flip = sortDir === "asc" ? -1 : 1;
    if (sort === "금액순") return [...list].sort((a, b) => ((Number(b["_total"]) || 0) - (Number(a["_total"]) || 0)) * flip);
    return [...list].sort((a, b) => String(b["_date"]).localeCompare(String(a["_date"])) * flip);
  }, [rows, team, grade, yearMonth, sort, sortDir, query]);

  const totalSum = filtered.reduce((sum, r) => sum + (Number(r["_total"]) || 0), 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {([
          [`${filtered.length}건`, "초과 내역"],
          [won(totalSum), "합계 금액"],
          [`${new Set(filtered.map((r) => str(r, "_업체명"))).size}곳`, "업체 수"],
        ] as [string, string][]).map(([value, label]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white px-3 py-4 text-center shadow-sm">
            <div className="truncate text-lg font-black tabular-nums text-slate-950 sm:text-xl">{value}</div>
            <div className="mt-1 text-[11px] font-bold text-slate-400">{label}</div>
          </div>
        ))}
      </div>
      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <span className="w-8 shrink-0 text-[10px] font-black text-slate-400">팀</span>
          {["전체", ...TEAM_NAMES].map((name) => <button key={name} type="button" onClick={() => setTeam(name)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-black transition sm:px-3.5 ${team === name ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>{name === "전체" ? "전체" : `${name}팀`}</button>)}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-8 shrink-0 text-[10px] font-black text-slate-400">조건</span>
          <PortalSelect width={110} value={yearMonth} onChange={setYearMonth}
            options={yearMonths.map((name) => ({ value: name, label: name === "전체" ? "전체 년월" : name }))} />
          <span className="mx-0.5 h-4 w-px bg-slate-200" />
          {grades.slice(0, 8).map((name) => <button key={name} type="button" onClick={() => setGrade(name)} className={`rounded-full px-3 py-1.5 text-[11px] font-black transition ${grade === name ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>{name}</button>)}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-8 shrink-0 text-[10px] font-black text-slate-400">정렬</span>
          <span className="flex rounded-full bg-slate-100 p-1">
            {(["최신순", "금액순"] as const).map((name) => <button key={name} type="button" onClick={() => { if (sort === name) setSortDir((d) => (d === "desc" ? "asc" : "desc")); else { setSort(name); setSortDir("desc"); } }} className={`rounded-full px-2.5 py-1 text-[11px] font-black ${sort === name ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{name}{sort === name ? (sortDir === "desc" ? " ↓" : " ↑") : ""}</button>)}
          </span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="업체명·접수내용 검색" className="h-9 min-w-32 flex-1 rounded-lg border border-slate-300 px-3 text-xs font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
        </div>
      </div>
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div>}
      {loading && <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">불러오는 중…</div>}
      {!loading && <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-[minmax(0,1fr)_110px_80px] gap-2 border-b border-slate-200 bg-slate-100/70 px-4 py-3 text-[11px] font-black text-slate-500 sm:grid-cols-[minmax(0,1fr)_50px_90px_120px_80px]">
          <span>업체명 · 접수내용</span><span className="hidden sm:block">팀</span><span className="hidden sm:block">마감방식</span><span className="text-right">합계</span><span className="text-right">날짜</span>
        </div>
        <div className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
          {filtered.slice(0, 300).map((r) => (
            <button key={String(r["id"])} type="button" onClick={() => setDetail(r)} className="grid w-full grid-cols-[minmax(0,1fr)_110px_80px] items-center gap-2 px-4 py-3 text-left text-xs transition hover:bg-blue-50/50 sm:grid-cols-[minmax(0,1fr)_50px_90px_120px_80px]">
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-black text-slate-900">{str(r, "_업체명")}</span>
                {str(r, "접수내용") && <span className="block truncate text-[11px] font-semibold text-slate-500">{str(r, "접수내용")}</span>}
              </span>
              <span className="hidden font-bold text-slate-500 sm:block">{str(r, "_team") ? `${str(r, "_team")}팀` : "-"}</span>
              <span className="hidden truncate font-bold text-slate-500 sm:block">{str(r, "마감방식") || "-"}</span>
              <span className="text-right font-black text-slate-800">{won(Number(r["_total"]) || 0)}</span>
              <span className="text-right font-bold text-slate-400">{String(r["_date"] || "").slice(2) || "-"}</span>
            </button>
          ))}
          {filtered.length > 300 && <div className="p-3 text-center text-[11px] font-bold text-slate-400">상위 300건만 표시 — 필터·검색으로 좁혀주세요</div>}
          {!filtered.length && <div className="p-10 text-center text-sm font-bold text-slate-400">조건에 맞는 초과 내역이 없어요.</div>}
        </div>
      </section>}
      {detail && <SheetDetailModal title={`${str(detail, "_업체명")} — 초과료 상세`} row={detail} fields={OVERAGE_DETAIL_FIELDS} layout={OVERAGE_DETAIL_LAYOUT} onClose={() => setDetail(null)} />}
    </div>
  );
}
