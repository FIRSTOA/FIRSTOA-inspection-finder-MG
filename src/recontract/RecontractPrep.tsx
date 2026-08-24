/**
 * 재계약 준비 — 현분기 워킨맵 재계약 방문 대상을 준비하는 화면.
 *
 * 대상은 우리가 만들지 않는다. 워킨맵 현분기 재계약 목록이 곧 대상이고, 그중 CS가 가는
 * 등급만 남긴다 — S(일반프로+부파트장) · SS(팀장급). V는 영업부 관할.
 *
 * 두 화면뿐이다.
 *   ① 레이더: 팀(A~D)별 방문 대상 — 종료일 순. 오늘 누구부터 갈지 고르는 자리
 *   ② 준비: 이카운트 대장 분석(제안 한 장) + 복합기 계약 + 방문 김에 볼 그 외 품목
 *           + 방문 정보(특이사항·출입·연락) + 미수·불만·AS·지난 협상 이력
 *
 * 재계약 건은 복합기지만 방문 김에 PC·세단기도 같이 처리하니 그 외 품목도 보조로 보여준다.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ClipboardCopy, RefreshCw, Search } from "lucide-react";
import { notify } from "../toast";
import { getVendorFlagsBatch, type VendorWorkFlags } from "../vendorFlags";
import { currentQuarter, type Quarter } from "../workinPlaces";
import ProposalSheet from "./ProposalSheet";
import {
  clearSignalCache, ddayOf, fetchBriefing, fetchRenewalScope,
  type RcBriefing, type RcDevice, type RcTarget, type RenewalScope,
} from "./api";

const TEAMS = ["A", "B", "C", "D"] as const;
const GRADE_TONE: Record<string, string> = { SS: "bg-violet-600 text-white", S: "bg-blue-600 text-white" };
/** 등급이 곧 방문자다 — 누가 가는 건인지 화면에서 바로 알아야 한다 */
const GRADE_WHO: Record<string, string> = { SS: "팀장급 방문", S: "일반프로 + 부파트장 방문" };
const money = (value: number) => value.toLocaleString("ko-KR");
const ddayLabel = (dday: number) => (dday === 0 ? "D-DAY" : dday > 0 ? `D-${dday}` : `${-dday}일 지남`);
const ddayTone = (dday: number) => (dday <= 14 ? "text-rose-600" : dday <= 45 ? "text-amber-600" : "text-slate-500");
const STORE_PREFIX = "recontract_ledger_";

/** 카드에는 시·구까지만 — 상세 주소는 준비 화면에서 본다 */
function shortAddress(address: string): string {
  const tokens = String(address || "").trim().split(/\s+/);
  if (tokens.length <= 2) return tokens.join(" ");
  const gu = tokens.findIndex((token) => /(구|군|시)$/.test(token));
  return tokens.slice(0, Math.max(2, gu + 1)).join(" ");
}

function hasLedger(key: string): boolean {
  try { return !!localStorage.getItem(STORE_PREFIX + key)?.trim(); } catch { return false; }
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-black transition ${on ? "bg-white text-slate-950 shadow-sm" : "bg-white/10 text-slate-300 hover:bg-white/20 hover:text-white"}`}>
      {children}
    </button>
  );
}

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${tone}`}>{children}</span>;
}

/** 작은 라벨 + 큰 숫자 — 한눈에 들어오는 요약 */
function Kpi({ label, value, unit, sub, tone = "text-slate-900" }: { label: string; value: string | number; unit?: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-3.5 py-3">
      <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`mt-0.5 text-2xl font-black leading-none ${tone}`}>
        {typeof value === "number" ? money(value) : value}
        {!!unit && <span className="ml-1 text-sm font-bold text-slate-400">{unit}</span>}
      </div>
      {!!sub && <div className="mt-1 text-[11px] font-semibold text-slate-500">{sub}</div>}
    </div>
  );
}

export default function RecontractPrep({ author = "" }: { author?: string }) {
  const quarter = currentQuarter();
  const [team, setTeam] = useState<string>(() => {
    try { return localStorage.getItem("recontract_team") || "C"; } catch { return "C"; }
  });
  const [grade, setGrade] = useState("전체");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<RenewalScope | null>(null);
  const [loadError, setLoadError] = useState("");
  const [picked, setPicked] = useState<RcTarget | null>(null);
  const [ledgerTick, setLedgerTick] = useState(0);   // 분석 완료 배지 갱신용

  const load = useCallback(async (force = false) => {
    setScope(null);
    setLoadError("");
    try {
      if (force) clearSignalCache();
      setScope(await fetchRenewalScope(quarter as Quarter, team));
    } catch (e) {
      setLoadError((e as Error).message || "불러오지 못했습니다");
    }
  }, [quarter, team]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { try { localStorage.setItem("recontract_team", team); } catch { /* 무시 */ } }, [team]);

  const targets = scope?.targets || [];
  const counts = useMemo(() => ({
    전체: targets.length,
    SS: targets.filter((target) => target.등급 === "SS").length,
    S: targets.filter((target) => target.등급 === "S").length,
  }), [targets]);

  const shown = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return targets.filter((target) => {
      if (grade !== "전체" && target.등급 !== grade) return false;
      if (!keyword) return true;
      return `${target.vendor} ${target.주소} ${target.places.map((place) => place.원본이름).join(" ")}`.toLowerCase().includes(keyword);
    });
  }, [targets, grade, query]);

  const done = useMemo(() => {
    void ledgerTick;   // 준비 화면에서 돌아오면 다시 센다
    return shown.filter((target) => hasLedger(target.key)).length;
  }, [shown, ledgerTick]);
  const 주의 = shown.filter((target) => target.badges.length).length;

  if (picked) {
    return <PrepView target={picked} author={author} onBack={() => { setPicked(null); setLedgerTick((n) => n + 1); }} />;
  }

  return (
    <div className="space-y-4">
      {/* 조건 — 팀만 고르면 된다. 분기는 현분기, 등급은 CS가 가는 S·SS만 */}
      <section className="overflow-hidden rounded-2xl bg-[#1E252F] shadow-sm">
        <div className="flex items-center gap-2 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-black text-white">{quarter}Q 재계약 방문 대상</div>
            <div className="mt-0.5 text-[11px] font-semibold text-slate-400">워킨맵 재계약 · CS 담당 등급(S·SS) · 종료일 순</div>
          </div>
          <button type="button" onClick={() => void load(true)} aria-label="새로 불러오기"
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-white/10 px-2.5 text-[12px] font-black text-slate-200 transition hover:bg-white/20">
            <RefreshCw size={13} /> 갱신
          </button>
        </div>
        <div className="space-y-1.5 px-4 pb-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {TEAMS.map((value) => <Chip key={value} on={team === value} onClick={() => setTeam(value)}>{value}팀</Chip>)}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip on={grade === "전체"} onClick={() => setGrade("전체")}>전체 {counts.전체}</Chip>
            <Chip on={grade === "SS"} onClick={() => setGrade("SS")}>SS {counts.SS}</Chip>
            <Chip on={grade === "S"} onClick={() => setGrade("S")}>S {counts.S}</Chip>
            <span className="ml-1 text-[11px] font-bold text-slate-400">SS 팀장급 · S 일반프로+부파트장</span>
          </div>
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="업체·주소 검색"
              className="w-full rounded-lg border border-white/15 bg-white/10 py-2 pl-7 pr-2.5 text-xs font-semibold text-white outline-none transition placeholder:text-slate-500 focus:border-blue-400 focus:bg-white/15" />
          </div>
          {!!scope && (
            <p className="pt-0.5 text-[11px] font-semibold text-slate-500">
              제외 — 재계약 완료 {scope.제외.완료} · 영업부 관할 {scope.제외.영업부} · 이관 {scope.제외.이관} · V등급 등 {scope.제외.등급외 + scope.제외.무등급}
            </p>
          )}
        </div>
      </section>

      {!!loadError && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">불러오기 실패 — {loadError}</div>}

      {scope === null && !loadError && (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-12 text-center text-sm font-bold text-slate-400">워킨맵 재계약 목록을 불러오는 중…</div>
      )}

      {!!scope && (
        <div className="grid grid-cols-3 gap-2">
          <Kpi label="방문 대상" value={shown.length} unit="곳" sub={`${team}팀 · ${quarter}Q`} />
          <Kpi label="분석 완료" value={done} unit="곳" tone={done ? "text-emerald-600" : "text-slate-300"} sub="대장 붙여넣은 곳" />
          <Kpi label="주의 필요" value={주의} unit="곳" tone={주의 ? "text-amber-600" : "text-slate-300"} sub="미수·불만·AS 등" />
        </div>
      )}

      {!!scope && !shown.length && (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-12 text-center text-sm font-bold text-slate-400">
          {team}팀 {quarter}Q에 해당하는 대상이 없습니다.
        </div>
      )}

      <div className="space-y-2">
        {shown.map((target) => {
          const analyzed = hasLedger(target.key);
          return (
            <button key={target.key} type="button" onClick={() => setPicked(target)}
              className="block w-full rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-blue-300 hover:shadow-md">
              <div className="flex items-start gap-3">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[13px] font-black ${GRADE_TONE[target.등급] || "bg-slate-700 text-white"}`}>
                  {target.등급}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <h3 className="min-w-0 flex-1 truncate text-[15px] font-black tracking-tight text-slate-900">{target.vendor}</h3>
                    <span className={`shrink-0 text-[12px] font-black tabular-nums ${ddayTone(target.dday)}`}>
                      {target.종료일 ? ddayLabel(target.dday) : "종료일 미기재"}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] font-semibold text-slate-500">
                    {!!target.종료일 && <span className="tabular-nums">{target.종료일.slice(0, 7).replace("-", ".")} 종료</span>}
                    {target.places.length > 1 && <span className="font-black text-slate-600">지점 {target.places.length}곳</span>}
                    {target.같은건물 > 1 && <span className="font-black text-blue-600">같은 건물 {target.같은건물}곳</span>}
                    <span className="min-w-0 truncate">{shortAddress(target.주소)}</span>
                  </div>
                  {(target.badges.length > 0 || analyzed) && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {analyzed && <Pill tone="bg-emerald-100 text-emerald-700">분석 완료</Pill>}
                      {target.badges.map((badge) => (
                        <Pill key={badge} tone={badge.startsWith("미수") || badge.startsWith("갱신위험") ? "bg-rose-100 text-rose-700" : badge.startsWith("불만") ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}>{badge}</Pill>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── 준비 화면 ───────────────────────────────────────────────────────────────

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-baseline gap-2 border-b border-slate-100 px-4 py-2.5">
        <h3 className="text-[13px] font-black text-slate-900">{title}</h3>
        {!!hint && <span className="text-[11px] font-semibold text-slate-400">{hint}</span>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 break-words text-[12px] font-bold text-slate-800">{value}</div>
    </div>
  );
}

function DeviceRow({ device, quarterEnd }: { device: RcDevice; quarterEnd: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${quarterEnd ? "border-blue-300 bg-blue-50/40" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[13px] font-black text-slate-900">{device.모델명 || device.기종 || "모델 미기재"}</span>
        {!!device.품목 && <Pill tone="bg-slate-100 text-slate-600">{device.품목}</Pill>}
        {quarterEnd && <Pill tone="bg-blue-600 text-white">이번 분기 종료</Pill>}
        <span className={`ml-auto text-[12px] font-black tabular-nums ${device.월렌탈료 ? "text-slate-800" : "text-rose-500"}`}>
          {device.월렌탈료 ? `월 ${money(device.월렌탈료)}원` : "렌탈료 미기재"}
        </span>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-4">
        <Field label="계약" value={[device.계약일, device.계약기간].filter(Boolean).join(" · ")} />
        <Field label="종료" value={device.종료일 || "미기재"} />
        <Field label="자산·기번" value={[device.자산번호, device.기번].filter(Boolean).join(" / ")} />
        <Field label="순번" value={device.순번} />
        <Field label="추가단가" value={device.추가컬 || device.추가흑 ? `컬 ${device.추가컬 || "-"} / 흑 ${device.추가흑 || "-"}` : ""} />
        <Field label="누적방식" value={device.누적방식} />
        <Field label="연평균" value={device.연평균 ? `${money(device.연평균)}원` : ""} />
        <Field label="추가조건" value={device.추가조건} />
      </div>
    </div>
  );
}

function PrepView({ target, author, onBack }: { target: RcTarget; author: string; onBack: () => void }) {
  const [data, setData] = useState<RcBriefing | null>(null);
  const [failed, setFailed] = useState("");
  const [flags, setFlags] = useState<VendorWorkFlags | null>(null);
  const [showOthers, setShowOthers] = useState(true);

  useEffect(() => {
    let alive = true;
    setData(null);
    setFailed("");
    fetchBriefing(target).then((result) => { if (alive) setData(result); })
      .catch((e) => { if (alive) setFailed((e as Error).message || "불러오지 못했습니다"); });
    getVendorFlagsBatch([target.vendor]).then((map) => { if (alive) setFlags(map.get(target.vendor) || null); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [target]);

  const raw = data?.raw || {};
  const 이번분기종료 = (ymd: string) => !!ymd && !!target.종료일 && ymd.slice(0, 7) === target.종료일.slice(0, 7);
  const note = flags?.note;

  const visitText = useMemo(() => {
    const lines = [
      `[재계약 방문] ${target.vendor} (${target.등급} · ${GRADE_WHO[target.등급] || ""})`,
      target.종료일 ? `계약종료 ${target.종료일} · ${ddayLabel(target.dday)}` : "",
      target.주소 ? `주소 ${target.주소}` : "",
      raw["키맨"] ? `키맨 ${raw["키맨"].replace(/\n/g, " / ")}` : "",
      raw["일반전화"] ? `일반전화 ${raw["일반전화"]}` : "",
      note?.text ? `특이사항 ${note.text.replace(/\n/g, " / ")}` : "",
      note?.workStart || note?.lunchTime ? `출근 ${note?.workStart || "-"} · 점심 ${note?.lunchTime || "-"}` : "",
      target.badges.length ? `주의 ${target.badges.join(" · ")}` : "",
    ].filter(Boolean);
    if (data?.copiers.length) {
      lines.push("", "■ 복합기 (재계약 대상)");
      for (const device of data.copiers) {
        lines.push(`- ${device.모델명 || device.기종} · 종료 ${device.종료일 || "?"} · 월 ${money(device.월렌탈료)}원 · 자산 ${device.자산번호 || "-"}`);
      }
    }
    if (data?.others.length) {
      lines.push("", "■ 그 외 임대 품목 (방문 김에 확인)");
      for (const device of data.others) {
        lines.push(`- ${device.품목 || "기타"} ${device.모델명 || device.기종} · 종료 ${device.종료일 || "?"} · 월 ${money(device.월렌탈료)}원`);
      }
    }
    return lines.join("\n");
  }, [target, raw, note, data]);

  const copyVisit = async () => {
    try {
      await navigator.clipboard.writeText(visitText);
      notify("방문 정보를 복사했습니다 ✓", "success");
    } catch {
      notify("복사 실패 — 화면에서 직접 선택해 복사하세요.", "error");
    }
  };

  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-2xl bg-[#1E252F]">
        <div className="flex items-start gap-2.5 px-4 py-3">
          <button type="button" onClick={onBack} aria-label="목록으로"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-slate-200 transition hover:bg-white/20">
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-black ${GRADE_TONE[target.등급] || "bg-white text-slate-900"}`}>{target.등급}</span>
              <span className="min-w-0 truncate text-[15px] font-black text-white">{target.vendor}</span>
            </div>
            <div className="mt-0.5 text-[11px] font-semibold text-slate-400">
              {GRADE_WHO[target.등급] || ""} · {target.team}팀
              {target.종료일 ? ` · 종료 ${target.종료일} (${ddayLabel(target.dday)})${target.투영 ? " · 자동연장" : ""}` : ""}
              {target.places.length > 1 ? ` · 지점 ${target.places.length}곳` : ""}
            </div>
          </div>
          <button type="button" onClick={() => void copyVisit()}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-2.5 text-[12px] font-black text-white transition hover:bg-blue-700">
            <ClipboardCopy size={13} /> 방문정보
          </button>
        </div>
      </section>

      {/* 제안 한 장 — 준비의 본체 */}
      <ProposalSheet vendorKey={target.key} vendorName={target.vendor} />

      {!!failed && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">이력을 불러오지 못했습니다 — {failed}</div>}

      {/* 방문 정보 — 출입·연락 규칙은 도착해서 알면 늦다 */}
      <Section title="방문 정보" hint="임대리스트 · 거래처 특이사항">
        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-4">
          <Field label="담당지역" value={raw["담당지역"] || target.team} />
          <Field label="관리 담당자" value={raw["관리 담당자"] || ""} />
          <Field label="키맨" value={(raw["키맨"] || "").replace(/\n/g, " / ")} />
          <Field label="일반전화" value={raw["일반전화"] || target.places[0]?.전화 || ""} />
          <Field label="출근 시간" value={note?.workStart || ""} />
          <Field label="점심 시간" value={note?.lunchTime || ""} />
          <Field label="방문주기" value={raw["방문주기"] ? `${raw["방문주기"].replace(/개월$/, "")}개월` : ""} />
          <Field label="장비소유주" value={raw["장비소유주"] || ""} />
        </div>
        <div className="mt-2.5 border-t border-slate-100 pt-2.5">
          <Field label="주소" value={target.주소 || raw["주소(실납품주소,도로명주소)"] || ""} />
        </div>
        {!!note?.text && (
          <div className="mt-2.5 whitespace-pre-wrap rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-[12px] font-bold text-violet-900">{note.text}</div>
        )}
        {!!raw["특이사항"] && (
          <div className="mt-2 whitespace-pre-wrap rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-bold text-amber-900">임대리스트 특이사항 · {raw["특이사항"]}</div>
        )}
      </Section>

      {/* 워킨맵에 적힌 조건 — 대장을 못 붙였을 때 유일한 조건 근거다 */}
      {(target.조건.기본요금 > 0 || target.조건.컬러기본 > 0 || target.조건.진행메모.length > 0
        || target.places.some((place) => place.비고 && !/^[A-Za-z0-9-]+\/\d{6,}$/.test(place.비고.trim()))) && (
        <Section title="워킨맵 기재 조건" hint="시트에서 넘어온 값 · 대장이 있으면 대장이 우선">
          {(target.조건.기본요금 > 0 || target.조건.컬러기본 > 0) && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-4">
              <Field label="기본요금" value={target.조건.기본요금 ? `${money(target.조건.기본요금)}원` : ""} />
              <Field label="평단가" value={target.조건.평단가 ? `${money(target.조건.평단가)}원` : ""} />
              <Field label="기본매수" value={target.조건.컬러기본 || target.조건.흑백기본 ? `컬 ${money(target.조건.컬러기본)} / 흑 ${money(target.조건.흑백기본)}` : ""} />
              <Field label="초과단가" value={target.조건.컬러단가 || target.조건.흑백단가 ? `컬 ${target.조건.컬러단가} / 흑 ${target.조건.흑백단가}` : ""} />
              <Field label="미수" value={target.조건.미수개월 || target.조건.미수금 ? `${target.조건.미수개월}개월 ${money(target.조건.미수금)}원` : "없음"} />
            </div>
          )}
          {(target.조건.진행메모.length > 0 || target.places.some((place) => place.비고 && !/^[A-Za-z0-9-]+\/\d{6,}$/.test(place.비고.trim()))) && (
            <div className="mt-2.5 space-y-1.5 border-t border-slate-100 pt-2.5">
              {target.places.filter((place) => place.비고 && !/^[A-Za-z0-9-]+\/\d{6,}$/.test(place.비고.trim())).map((place) => (
                <div key={`c-${place.id}`} className="whitespace-pre-wrap rounded-xl border border-blue-200 bg-blue-50/60 px-3 py-2 text-[12px] font-bold text-slate-800">{place.비고}</div>
              ))}
              {target.조건.진행메모.map((memo, index) => (
                <div key={index} className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-[12px] font-bold text-slate-700">{memo}</div>
              ))}
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            {target.places.map((place) => (
              <span key={place.id} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                {place.label || "라벨없음"} · {place.원본이름}
              </span>
            ))}
          </div>
        </Section>
      )}

      {data === null && !failed && (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-sm font-bold text-slate-400">임대·이력을 불러오는 중…</div>
      )}

      {!!data?.copiers.length && (() => {
        // 임대리스트 종료일이 한참 미래면 이미 재계약이 반영된 건이다 — 헛방문을 막는다
        const 갱신완료 = data.copiers.filter((device) => device.종료일 && ddayOf(device.종료일) > 365);
        const 이번분기 = data.copiers.filter((device) => 이번분기종료(device.종료일));
        return (
          <Section title="복합기 계약" hint={`재계약 대상 · 임대중 ${data.copiers.length}대`}>
            {!이번분기.length && !!갱신완료.length && (
              <div className="mb-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-[12px] font-black text-emerald-800">
                임대리스트에는 이미 {갱신완료[0].종료일}까지 계약이 들어가 있습니다 — 재계약이 반영된 건일 수 있으니 워킨맵 라벨을 확인하세요.
              </div>
            )}
            <div className="space-y-2">
              {data.copiers.map((device) => <DeviceRow key={device.id} device={device} quarterEnd={이번분기종료(device.종료일)} />)}
            </div>
          </Section>
        );
      })()}

      {!!data?.others.length && (
        <Section title="그 외 임대 품목" hint={`${data.others.length}대 — 방문 김에 같이 확인·처리`}>
          <button type="button" onClick={() => setShowOthers((v) => !v)} className="mb-2 text-[11px] font-black text-blue-700">
            {showOthers ? "접기" : "펼치기"}
          </button>
          {showOthers && (
            <div className="space-y-2">
              {data.others.map((device) => <DeviceRow key={device.id} device={device} quarterEnd={이번분기종료(device.종료일)} />)}
            </div>
          )}
        </Section>
      )}

      {!!data?.history.length && (
        <Section title="지난 재계약 협상" hint={`${data.history.length}건 · /계약갱신 기록`}>
          <div className="space-y-2">
            {data.history.map((row) => (
              <div key={row.id} className="rounded-xl border border-blue-100 bg-blue-50/50 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[12px] font-black tabular-nums text-slate-700">{row.날짜}</span>
                  {!!row.갱신상태 && <Pill tone="bg-blue-600 text-white">{row.갱신상태}</Pill>}
                  {!!row.갱신위험도 && <Pill tone={row.갱신위험도 === "상" ? "bg-rose-100 text-rose-700" : row.갱신위험도 === "중" ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-600"}>위험 {row.갱신위험도}</Pill>}
                  {!!row.최종상태 && <Pill tone="bg-slate-200 text-slate-700">{row.최종상태}</Pill>}
                  {!!row.작성자 && <span className="ml-auto text-[11px] font-bold text-slate-400">{row.작성자}</span>}
                </div>
                {!!row.제안조건 && <div className="mt-1.5 whitespace-pre-wrap text-[12px] font-bold text-slate-800">{row.제안조건}</div>}
                {!!row.관리포인트 && <div className="mt-1 text-[11px] font-bold text-blue-700">관리포인트 · {row.관리포인트}</div>}
                {!!row.다음확인일 && <div className="mt-1 text-[11px] font-bold text-slate-500">다음 확인 {row.다음확인일}</div>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {!!data?.misu.length && (
        <Section title="미수" hint={`${data.misu.length}건`}>
          <div className="space-y-1.5">
            {data.misu.map((row, index) => (
              <div key={index} className="rounded-xl border border-slate-200 px-3 py-2 text-[12px] font-bold text-slate-700">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums text-slate-500">{row["입력일"]}</span>
                  <Pill tone="bg-rose-100 text-rose-700">{row["미수개월"] || "-"}개월 {row["미수잔액"] ? `${money(Number(row["미수잔액"].replace(/[^0-9]/g, "")) || 0)}원` : ""}</Pill>
                  {!!row["입금약속일"] && <Pill tone="bg-emerald-100 text-emerald-700">약속 {row["입금약속일"]}</Pill>}
                </div>
                {!!row["방문내용"] && <div className="mt-1 whitespace-pre-wrap text-slate-600">{row["방문내용"]}</div>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {!!data?.bulman.length && (
        <Section title="불만" hint={`${data.bulman.length}건 — 방문 전 반드시 확인`}>
          <div className="space-y-1.5">
            {data.bulman.map((row, index) => (
              <div key={index} className="rounded-xl border border-rose-200 bg-rose-50/50 px-3 py-2 text-[12px] font-bold text-slate-700">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums text-slate-500">{row["날짜"]}</span>
                  {!!row["불만유형"] && <Pill tone="bg-rose-600 text-white">{row["불만유형"]}</Pill>}
                  {!!row["불만항목"] && <Pill tone="bg-rose-100 text-rose-700">{row["불만항목"]}</Pill>}
                </div>
                {!!row["불만내용"] && <div className="mt-1 whitespace-pre-wrap text-slate-700">{row["불만내용"]}</div>}
                {!!row["대안제시"] && <div className="mt-1 text-slate-600">대안 · {row["대안제시"]}</div>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {!!data?.overage.length && (
        <Section title="초과료 청구 이력" hint={`${data.overage.length}건`}>
          <div className="space-y-1.5">
            {data.overage.map((row, index) => (
              <div key={index} className="rounded-xl border border-slate-200 px-3 py-2 text-[12px] font-bold text-slate-700">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums text-slate-500">{row["날짜"]}</span>
                  {!!row["모델명"] && <span className="text-slate-600">{row["모델명"]}</span>}
                  <span className="ml-auto tabular-nums text-slate-900">{row["합계"] ? `${money(Number(row["합계"].replace(/[^0-9]/g, "")) || 0)}원` : ""}</span>
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  {row["기본매수"] ? `기본 ${row["기본매수"]}` : ""}{row["초과장당금액"] ? ` · 단가 ${row["초과장당금액"]}` : ""}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="AS·불만 빈도" hint="최근 18개월">
        <div className="flex flex-wrap gap-2">
          <Pill tone="bg-slate-100 text-slate-700">AS {target.signals.as?.건수 || 0}건{target.signals.as?.최근일 ? ` · 최근 ${target.signals.as.최근일}` : ""}</Pill>
          <Pill tone="bg-slate-100 text-slate-700">불만 {target.signals.bulman?.건수 || 0}건</Pill>
          <Pill tone="bg-slate-100 text-slate-700">초과 {target.signals.overage?.건수 || 0}회</Pill>
          {!!author && <Pill tone="bg-slate-100 text-slate-500">준비 {author}</Pill>}
        </div>
      </Section>
    </div>
  );
}
