import { useMemo, useState } from "react";
import { searchLeaseList, getAsHistoryBySerial, type LeaseHit } from "./api";
import { kstDate } from "./visits";

type ReceiveRoute = "카카오" | "전화";
type ReceiveType = "원격이관" | "복합기 AS" | "IT AS";

// 임대리스트(_raw) 필드에서 값 꺼내기 (여러 후보 키 중 첫 값)
function pick(lease: LeaseHit | null, ...keys: string[]) {
  if (!lease) return "";
  for (const key of keys) {
    const value = (lease[key] || "").trim();
    if (value) return value;
  }
  return "";
}

function monthsBetween(from: string, to: string) {
  const start = new Date(from.replace(/\./g, "-"));
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
  const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  return months >= 0 ? `${months}개월` : "";
}

function receiptDay() {
  const d = kstDate();
  return `${Number(d.slice(5, 7))}. ${Number(d.slice(8, 10))}`;
}

type Manual = { 접수자성함: string; 접수자연락처: string; 제목: string; 증상: string; 유상무상: string; 참고사항: string };
const EMPTY_MANUAL: Manual = { 접수자성함: "", 접수자연락처: "", 제목: "", 증상: "", 유상무상: "무상", 참고사항: "" };

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
  const [copied, setCopied] = useState(false);

  const runSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setSearched(false);
    try {
      const rows = await searchLeaseList(query);
      setResults(rows);
    } finally {
      setSearching(false);
      setSearched(true);
    }
  };

  const selectLease = async (hit: LeaseHit) => {
    setLease(hit);
    setResults([]);
    setAsHistory([]);
    const serial = pick(hit, "시리얼번호(기번)", "기번");
    if (serial) {
      const history = await getAsHistoryBySerial(serial);
      setAsHistory(history);
    }
  };

  const report = useMemo(() => {
    if (!lease) return "";
    const 업체명 = pick(lease, "거래처명", "_업체명", "업체명");
    const 등급 = pick(lease, "등급");
    const 모델명 = pick(lease, "모델명", "기종");
    const 기종 = pick(lease, "기종");
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
    const 미수개월 = pick(lease, "미수개월수");
    const 키맨 = pick(lease, "키맨");
    const 담당지역 = pick(lease, "담당지역");
    const 코드 = pick(lease, "코드");
    const 틴텍코드 = pick(lease, "틴텍코드");
    const 주소 = pick(lease, "주소(실납품주소,도로명주소)", "주소");
    const 확장성 = pick(lease, "확장성");
    const 기기상태 = pick(lease, "기기상태");
    const 사용개월 = 계약일 ? monthsBetween(계약일, kstDate()) : "";
    const historyText = asHistory.length
      ? asHistory.map((h) => `■ ${h.date}\n${h.content}`).join("\n\n")
      : "없음";
    const 구분 = type === "IT AS" ? "IT A/S" : "A/S";
    const lines = [
      `${구분}   ${등급}   ${모델명}   ${업체명}`,
      `종료일 ${종료일}  ·  지역 ${담당지역}  ·  접수일 ${receiptDay()}`,
      `기번 ${기번}   자산번호 ${자산번호}`,
      `접수유형 ${route}   접수분야 ${구분}`,
      `임대리스트순번 ${순}   장비소유주 ${장비소유주}`,
      `계약일 ${계약일}   사용 ${사용개월}`,
      `종료일 ${종료일}   남은개월 ${남은개월}`,
      `납품/교체일 ${교체일}   방문주기 ${방문주기}`,
      `기본임대료 ${기본임대료}   평균임대료 ${평균임대료}`,
      `유지보수업체 ${유지보수}`,
      `접수자 ${manual.접수자성함} ${manual.접수자연락처}`,
      `일반전화 ${일반전화}`,
      `미수개월 ${미수개월}`,
      `★키맨 ${키맨}`,
      `방문담당자 ${담당지역}`,
      `한조/틴텍코드 ${코드} / ${틴텍코드}`,
      `주소 ${주소}   확장성 ${확장성}`,
      `기종 ${기종}   기기상태 ${기기상태}`,
      `유상/무상 ${manual.유상무상}`,
      `제목 ${manual.제목}`,
      `상태 ${manual.증상}`,
      `참고사항 ${manual.참고사항}`,
      `AS접수횟수(시리얼기준) ${asHistory.length}회`,
      `AS접수히스토리(시리얼기준)`,
      historyText,
    ];
    return lines.join("\n");
  }, [lease, manual, asHistory, route, type]);

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

  const reset = () => { setLease(null); setManual(EMPTY_MANUAL); setAsHistory([]); setQuery(""); setResults([]); setSearched(false); };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-3 sm:p-4">
      <div>
        <h2 className="text-xl font-black text-slate-950">서비스 접수</h2>
        <p className="mt-0.5 text-xs font-semibold text-slate-400">임대리스트에서 거래처를 찾아 카톡 보고용 양식을 자동으로 만듭니다. (작성자 {author})</p>
      </div>

      {/* 접수 경로 · 유형 */}
      <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-black text-slate-400">접수경로</span>
          {(["카카오", "전화"] as ReceiveRoute[]).map((r) => <button key={r} type="button" onClick={() => setRoute(r)} className={`rounded-lg px-3 py-1.5 text-xs font-black ${route === r ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>{r}</button>)}
          <span className="ml-2 text-xs font-black text-slate-400">접수유형</span>
          {(["원격이관", "복합기 AS", "IT AS"] as ReceiveType[]).map((t) => <button key={t} type="button" onClick={() => setType(t)} className={`rounded-lg px-3 py-1.5 text-xs font-black ${type === t ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-500"}`}>{t}</button>)}
        </div>
        {type === "원격이관" && <div className="mt-2 rounded-lg bg-blue-50 p-2 text-[11px] font-bold text-blue-700">원격이관은 통화로 처리 가능한 건입니다. (v1은 AS 양식 생성 중심 — 원격이관 기록은 다음 단계)</div>}
      </section>

      {/* 임대리스트 검색 */}
      <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="text-xs font-black text-slate-400">임대리스트 검색 (업체명 · 자산번호 · 순번)</div>
        <div className="mt-1.5 flex gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void runSearch(); }} placeholder="업체명 / 자산기번 / 순번" className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500" />
          <button type="button" onClick={() => void runSearch()} disabled={searching} className="shrink-0 rounded-md bg-blue-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{searching ? "검색중" : "검색"}</button>
        </div>
        {searched && !results.length && !lease && <div className="mt-2 text-xs font-bold text-slate-400">검색 결과가 없습니다. (자산번호·순번 검색은 컬럼 승격 SQL 실행 후 동작)</div>}
        {results.length > 0 && <div className="mt-2 max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
          {results.map((hit, index) => <button key={index} type="button" onClick={() => void selectLease(hit)} className="block w-full px-3 py-2 text-left hover:bg-slate-50">
            <div className="text-sm font-black text-slate-800">{pick(hit, "거래처명", "_업체명")} <span className="ml-1 text-[10px] font-bold text-slate-400">순{pick(hit, "순")}</span></div>
            <div className="text-[11px] font-semibold text-slate-500">{pick(hit, "기종", "모델명")} · 자산 {pick(hit, "자산번호") || "-"} · 기번 {pick(hit, "시리얼번호(기번)") || "-"} · {pick(hit, "담당지역")}</div>
          </button>)}
        </div>}
      </section>

      {/* 선택된 거래처 + 수동 입력 + 양식 */}
      {lease && <>
        <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-sm font-black text-slate-900">{pick(lease, "거래처명", "_업체명")}</div>
            <button type="button" onClick={reset} className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-black text-slate-500">다시 검색</button>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] font-semibold text-slate-600 sm:grid-cols-3">
            <span>기종 {pick(lease, "기종")}</span>
            <span>자산 {pick(lease, "자산번호") || "-"}</span>
            <span>기번 {pick(lease, "시리얼번호(기번)") || "-"}</span>
            <span>등급 {pick(lease, "등급") || "-"}</span>
            <span>종료 {pick(lease, "종료일") || "-"}</span>
            <span>미수 {pick(lease, "미수개월수") || "0"}개월</span>
          </div>
        </section>

        <section className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-2">
          {([["접수자성함", "접수자 성함"], ["접수자연락처", "접수자 연락처"], ["제목", "제목(짧게)"], ["증상", "증상/내용"], ["참고사항", "참고사항"]] as [keyof Manual, string][]).map(([key, label]) => (
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
            <button type="button" onClick={() => void copyReport()} className="rounded-md bg-slate-900 px-4 py-1.5 text-xs font-black text-white">{copied ? "복사됨 ✓" : "복사"}</button>
          </div>
          <textarea value={report} readOnly rows={18} className="mt-2 w-full resize-y rounded-md border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] leading-5 text-slate-700" />
          <div className="mt-1 text-[10px] font-bold text-slate-400">복사 후 {type === "IT AS" ? "IT" : "AS 팀"} 방에 붙여넣기. (전송·캘린더 자동화는 다음 단계)</div>
        </section>
      </>}
    </div>
  );
}
