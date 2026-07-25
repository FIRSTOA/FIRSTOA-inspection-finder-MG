import { useMemo, useState } from "react";
import { searchLeaseList, getAsHistory, findWorkinMapName, sendServiceReception, type LeaseHit } from "./api";
import { kstDate } from "./visits";

type ReceiveRoute = "카카오" | "전화";
type ReceiveType = "원격이관" | "복합기 AS" | "IT AS";

function pick(lease: LeaseHit | null, ...keys: string[]) {
  if (!lease) return "";
  for (const key of keys) {
    const value = (lease[key] || "").trim();
    if (value) return value;
  }
  return "";
}

// "2025-04-03" / "2025.4.3" → "2025. 4. 3"
function fmtDot(value: string) {
  const m = String(value).match(/(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
  return m ? `${m[1]}. ${Number(m[2])}. ${Number(m[3])}` : String(value || "").trim();
}
function fmtDotYY(value: string) {
  return fmtDot(value).replace(/^\d{2}(\d{2})\./, "$1.");
}
function korMD(date: string) {
  const m = String(date).match(/\d{4}-(\d{2})-(\d{2})/);
  return m ? `${Number(m[1])}월 ${Number(m[2])}일` : String(date || "");
}
function fmtWon(value: string) {
  const digits = String(value).replace(/[^\d]/g, "");
  return digits ? `₩${Number(digits).toLocaleString()}` : String(value || "").trim();
}
function withMonths(value: string) {
  const v = String(value || "").trim();
  return /^\d+$/.test(v) ? `${v}개월` : v;
}
function monthsBetween(from: string, to: string) {
  const start = new Date(from.replace(/\./g, "-").replace(/\s/g, ""));
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
  const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  return months >= 0 ? `${months}개월` : "";
}
function receiptDay() {
  const d = kstDate();
  return `${Number(d.slice(5, 7))}. ${Number(d.slice(8, 10))}`;
}
// 담당지역(강남/노원구 등) → 수도권A~D / 지방
const DISTRICT_TEAM: Array<[string, string]> = [
  ["강북", "A"], ["노원", "A"], ["도봉", "A"], ["성북", "A"], ["중랑", "A"], ["동대문", "A"], ["성동", "A"], ["광진", "A"], ["종로", "A"], ["용산", "A"],
  ["강서", "B"], ["양천", "B"], ["영등포", "B"], ["구로", "B"], ["금천", "B"], ["마포", "B"], ["은평", "B"], ["서대문", "B"],
  ["강남", "C"], ["서초", "C"], ["송파", "C"], ["강동", "C"], ["관악", "C"], ["동작", "C"],
  ["경기", "D"], ["인천", "D"], ["고양", "D"], ["파주", "D"], ["부천", "D"], ["성남", "D"], ["수원", "D"], ["안양", "D"], ["용인", "D"],
];
function regionLabel(area: string) {
  const a = String(area || "").trim();
  if (!a) return "";
  if (a === "지방") return "지방";
  for (const [key, team] of DISTRICT_TEAM) if (a.includes(key)) return `수도권${team}`;
  return a;
}

type Manual = { 접수자성함: string; 접수자연락처: string; 제목: string; 증상: string; 유상무상: string; 참고사항: string; 교체이력: string };
const EMPTY_MANUAL: Manual = { 접수자성함: "", 접수자연락처: "", 제목: "", 증상: "", 유상무상: "무상", 참고사항: "", 교체이력: "" };

export default function ServiceReception({ author }: { author: string }) {
  const [route, setRoute] = useState<ReceiveRoute>("카카오");
  const [type, setType] = useState<ReceiveType>("복합기 AS");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LeaseHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [lease, setLease] = useState<LeaseHit | null>(null);
  const [manual, setManual] = useState<Manual>(EMPTY_MANUAL);
  const [asHistory, setAsHistory] = useState<{ date: string; content: string }[]>([]);
  const [workinName, setWorkinName] = useState("");
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState("");

  const runSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setSearched(false);
    try {
      setResults(await searchLeaseList(query));
    } finally {
      setSearching(false);
      setSearched(true);
    }
  };

  const selectLease = async (hit: LeaseHit) => {
    setLease(hit);
    setResults([]);
    setAsHistory([]);
    setWorkinName("");
    const vendor = pick(hit, "거래처명", "_업체명", "업체명");
    const serial = pick(hit, "시리얼번호(기번)", "기번");
    if (vendor || serial) setAsHistory(await getAsHistory(vendor, serial));
    if (vendor) setWorkinName(await findWorkinMapName(vendor));
  };

  const report = useMemo(() => {
    if (!lease) return "";
    const 업체명 = workinName || pick(lease, "거래처명", "_업체명", "업체명");
    const 등급 = pick(lease, "등급");
    const 모델명 = pick(lease, "모델명", "기종");
    const 기번 = pick(lease, "시리얼번호(기번)", "기번");
    const 자산번호 = pick(lease, "자산번호");
    const 순 = pick(lease, "순");
    const 장비소유주 = pick(lease, "장비소유주") || "퍼스트전산";
    const 계약일 = pick(lease, "계약일", "첫계약일");
    const 종료일 = pick(lease, "종료일");
    const 남은개월 = pick(lease, "남은개월");
    const 교체일 = pick(lease, "납품/교체일");
    const 방문주기 = pick(lease, "방문주기");
    const 기본임대료 = pick(lease, "기본금액");
    const 평균임대료 = pick(lease, "연평균");
    const 유지보수 = pick(lease, "위탁/유지보수및기타사항") || "없음";
    const 일반전화 = pick(lease, "일반전화");
    const 미수개월Raw = pick(lease, "미수개월수");
    const 미수개월 = 미수개월Raw === "0" ? "" : 미수개월Raw;
    const 키맨 = pick(lease, "키맨");
    const 지역 = regionLabel(pick(lease, "담당지역"));
    const 코드 = pick(lease, "코드");
    const 틴텍코드 = pick(lease, "틴텍코드");
    const 주소 = pick(lease, "주소(실납품주소,도로명주소)", "주소");
    const 확장성 = pick(lease, "확장성");
    const 기기상태 = pick(lease, "기기상태");
    const 사용개월 = 계약일 ? monthsBetween(계약일, kstDate()) : "";
    const 교체일로부터 = /\d{4}[.\-/]/.test(교체일) ? `${monthsBetween(교체일, kstDate())}사용중` : "";
    const 구분 = type === "IT AS" ? "IT A/S" : "A/S";
    const T = "\t";
    const lines = [
      `${구분}${T}${등급}${T}${모델명}${T}${업체명}${T}종료일${T}${fmtDotYY(종료일)}${T}지역${T}${지역}${T}접수일${T}${receiptDay()}`,
      `기번${T}${기번}${T}자산번호${T}${자산번호}`,
      `접수유형${T}${route}${T}접수분야${T}${구분}`,
      `임대리스트순번${T}${순}${T}장비소유주${T}${장비소유주}`,
      `계약일${T}${fmtDot(계약일)}${T}사용개월${T}${사용개월}`,
      `종료일${T}${fmtDot(종료일)}${T}남은개월${T}${withMonths(남은개월)}`,
      `납품/교체일${T}${fmtDot(교체일)}${T}방문주기${T}${withMonths(방문주기)}`,
      `기본임대료${T}${fmtWon(기본임대료)}${T}평균임대료${T}${fmtWon(평균임대료)}`,
      `설치업체${T}${장비소유주}${T}유지보수업체${T}${유지보수}`,
      `접수자성함${T}${manual.접수자성함}`,
      `접수자연락처${T}${manual.접수자연락처}`,
      `일반전화${T}${일반전화}`,
      `미수개월${T}${미수개월}`,
      `★키맨성함/번호${T}${키맨}`,
      `방문담당자${T}${지역}`,
      `한조/틴텍코드${T}${코드} / ${틴텍코드}`,
      `주소${T}${주소}${T}확장성${T}${확장성}`,
      `기종${T}${모델명}${T}기기상태${T}${기기상태}`,
      `유상/무상${T}${manual.유상무상}`,
      `제목${T}${manual.제목}`,
      `상태${T}${manual.증상}`,
      `참고사항${T}${manual.참고사항}`,
      `교체이력${T}${manual.교체이력}${T}교체일로부터${T}${교체일로부터}`,
      `AS접수횟수(시리얼기준)${T}${asHistory.length}회`,
      `AS접수히스토리(시리얼기준)`,
      asHistory.length ? asHistory.map((h) => `■ 날짜: ${korMD(h.date)}\n■ 내용: ${h.content}`).join("\n\n") : "없음",
      `자가사용내역(최근6개월)`,
    ];
    return lines.join("\n");
  }, [lease, manual, asHistory, route, type, workinName]);

  const copyReport = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      window.alert("복사 실패 — 양식을 직접 선택해 복사하세요.");
    }
  };

  const sendReport = async () => {
    if (!report || sending) return;
    setSending(true);
    setSendResult("");
    try {
      const region = regionLabel(pick(lease, "담당지역"));
      const res = await sendServiceReception(type === "IT AS" ? "IT" : "AS", region, report);
      setSendResult(res.ok ? `전송 완료 — ${res.message}` : `전송 실패: ${res.error}`);
    } finally {
      setSending(false);
    }
  };

  const reset = () => { setLease(null); setManual(EMPTY_MANUAL); setAsHistory([]); setQuery(""); setResults([]); setSearched(false); setWorkinName(""); setSendResult(""); };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-3 sm:p-4">
      <div>
        <h2 className="text-xl font-black text-slate-950">서비스 접수</h2>
        <p className="mt-0.5 text-xs font-semibold text-slate-400">임대리스트에서 거래처를 찾아 카톡 보고용 양식을 자동으로 만듭니다. (작성자 {author})</p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-black text-slate-400">접수경로</span>
          {(["카카오", "전화"] as ReceiveRoute[]).map((r) => <button key={r} type="button" onClick={() => setRoute(r)} className={`rounded-lg px-3 py-1.5 text-xs font-black ${route === r ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>{r}</button>)}
          <span className="ml-2 text-xs font-black text-slate-400">접수유형</span>
          {(["원격이관", "복합기 AS", "IT AS"] as ReceiveType[]).map((t) => <button key={t} type="button" onClick={() => setType(t)} className={`rounded-lg px-3 py-1.5 text-xs font-black ${type === t ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-500"}`}>{t}</button>)}
        </div>
        {type === "원격이관" && <div className="mt-2 rounded-lg bg-blue-50 p-2 text-[11px] font-bold text-blue-700">원격이관은 통화로 처리 가능한 건입니다. (v1은 AS 양식 생성 중심)</div>}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="text-xs font-black text-slate-400">임대리스트 검색 (업체명 · 자산기번 · 순번)</div>
        <div className="mt-1.5 flex gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void runSearch(); }} placeholder="업체명 / 자산기번 / 순번" className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500" />
          <button type="button" onClick={() => void runSearch()} disabled={searching} className="shrink-0 rounded-md bg-blue-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{searching ? "검색중" : "검색"}</button>
        </div>
        {searched && !results.length && !lease && <div className="mt-2 text-xs font-bold text-slate-400">검색 결과가 없습니다.</div>}
        {results.length > 0 && <div className="mt-2 max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
          {results.map((hit, index) => <button key={index} type="button" onClick={() => void selectLease(hit)} className="block w-full px-3 py-2 text-left hover:bg-slate-50">
            <div className="text-sm font-black text-slate-800">{pick(hit, "거래처명", "_업체명")} <span className="ml-1 text-[10px] font-bold text-slate-400">순{pick(hit, "순")}</span></div>
            <div className="text-[11px] font-semibold text-slate-500">{pick(hit, "모델명", "기종")} · 자산 {pick(hit, "자산번호") || "-"} · 기번 {pick(hit, "시리얼번호(기번)") || "-"} · {pick(hit, "담당지역")}</div>
          </button>)}
        </div>}
      </section>

      {lease && <>
        <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-sm font-black text-slate-900">{pick(lease, "거래처명", "_업체명")}</div>
            <button type="button" onClick={reset} className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-black text-slate-500">다시 검색</button>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] font-semibold text-slate-600 sm:grid-cols-3">
            <span>모델 {pick(lease, "모델명") || "-"}</span>
            <span>자산 {pick(lease, "자산번호") || "-"}</span>
            <span>기번 {pick(lease, "시리얼번호(기번)") || "-"}</span>
            <span>등급 {pick(lease, "등급") || "-"}</span>
            <span>지역 {regionLabel(pick(lease, "담당지역")) || "-"}</span>
            <span>미수 {pick(lease, "미수개월수") || "0"}개월</span>
          </div>
        </section>

        <section className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-2">
          {([["접수자성함", "접수자 성함"], ["접수자연락처", "접수자 연락처"], ["제목", "제목(짧게)"], ["교체이력", "교체이력(예: 1회)"], ["증상", "증상/내용"], ["참고사항", "참고사항"]] as [keyof Manual, string][]).map(([key, label]) => (
            <label key={key} className={`text-[11px] font-black text-slate-500 ${key === "증상" || key === "참고사항" ? "sm:col-span-2" : ""}`}>{label}
              {key === "증상" || key === "참고사항"
                ? <textarea value={manual[key]} onChange={(e) => setManual({ ...manual, [key]: e.target.value })} rows={2} className="mt-1 w-full resize-y rounded-md border border-slate-300 px-2 py-1.5 text-sm font-semibold text-slate-900" />
                : <input value={manual[key]} onChange={(e) => setManual({ ...manual, [key]: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-semibold text-slate-900" />}
            </label>
          ))}
          <label className="text-[11px] font-black text-slate-500">유상/무상
            <select value={manual.유상무상} onChange={(e) => setManual({ ...manual, 유상무상: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm font-semibold text-slate-900">{["무상", "유상", "보증"].map((v) => <option key={v}>{v}</option>)}</select>
          </label>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-xs font-black text-slate-400">카톡 보고용 양식 {asHistory.length > 0 && <span className="text-rose-600">· AS이력 {asHistory.length}회</span>}</div>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => void copyReport()} className="rounded-md border border-slate-300 bg-white px-4 py-1.5 text-xs font-black text-slate-700">{copied ? "복사됨 ✓" : "복사"}</button>
              {type !== "원격이관" && <button type="button" onClick={() => void sendReport()} disabled={sending} className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-black text-white disabled:opacity-50">{sending ? "전송중…" : `${type === "IT AS" ? "IT방" : "AS방"} 전송`}</button>}
            </div>
          </div>
          <textarea value={report} readOnly rows={20} className="mt-2 w-full resize-y rounded-md border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] leading-5 text-slate-700" />
          {sendResult && <div className={`mt-1.5 rounded-md p-2 text-[11px] font-black ${sendResult.startsWith("전송 완료") ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{sendResult}</div>}
          <div className="mt-1 text-[10px] font-bold text-slate-400">전송 시 {type === "IT AS" ? "PC/IT방" : "담당팀 AS방"}으로 게시됩니다. (TEST_MODE 중엔 테스트방)</div>
        </section>
      </>}
    </div>
  );
}
