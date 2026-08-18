/**
 * 재계약 준비 — 방문 전에 "누구를 언제 만나야 하고, 무슨 카드를 들고 갈지"를 만드는 화면.
 *
 * 두 화면뿐이다.
 *   ① 레이더: 종료 임박 업체를 임박순·금액순·위험순으로 — 오늘 누구부터 볼지 고르는 자리
 *   ② 브리핑: 고른 업체의 계약·사용량·미수·불만·AS·과거 협상 기록을 한 장으로
 *
 * 판정(유형·난이도·추천 기간)과 제안 플랜은 다음 단계에서 legacy 엔진을 이식해 붙인다.
 * 지금은 사람이 판단할 근거를 모아 주는 것까지 — 근거 없는 자동 판정보다 이게 먼저다.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ClipboardCopy, RefreshCw, Search } from "lucide-react";
import { notify } from "../toast";
import ProposalSheet from "./ProposalSheet";
import {
  ddayOf, fetchBriefing, fetchExpiringDevices, getSignalIndex, groupTargets, clearSignalCache,
  type RcBriefing, type RcTarget,
} from "./api";

const MONTH_CHIPS = [1, 3, 6, 12] as const;
type SortKey = "dday" | "money" | "risk";
const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "dday", label: "임박순" },
  { key: "money", label: "금액순" },
  { key: "risk", label: "위험순" },
];

const money = (value: number) => value.toLocaleString("ko-KR");
const ddayLabel = (dday: number) => (dday === 0 ? "D-DAY" : dday > 0 ? `D-${dday}` : `${-dday}일 지남`);
const ddayTone = (dday: number) =>
  dday <= 14 ? "bg-rose-500 text-white" : dday <= 45 ? "bg-amber-500 text-white" : "bg-slate-700 text-white";
const riskTone = (risk: number) =>
  risk >= 6 ? "bg-rose-100 text-rose-700" : risk >= 3 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500";

/** 알약 칩 — 앱 공통 톤 */
function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-black transition ${on ? "bg-white text-slate-950 shadow-sm" : "bg-white/10 text-slate-300 hover:bg-white/20 hover:text-white"}`}>
      {children}
    </button>
  );
}

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${tone}`}>{children}</span>;
}

export default function RecontractPrep() {
  const [months, setMonths] = useState(3);
  const [sort, setSort] = useState<SortKey>("dday");
  const [query, setQuery] = useState("");
  const [grade, setGrade] = useState("전체");
  const [riskOnly, setRiskOnly] = useState(false);
  const [targets, setTargets] = useState<RcTarget[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [picked, setPicked] = useState<RcTarget | null>(null);
  const [limit, setLimit] = useState(40);

  const load = useCallback(async (force = false) => {
    setTargets(null);
    setLoadError("");
    try {
      if (force) clearSignalCache();
      const [devices, signals] = await Promise.all([fetchExpiringDevices(months), getSignalIndex(force)]);
      setTargets(groupTargets(devices, signals));
      setLimit(40);
    } catch (e) {
      setLoadError((e as Error).message || "불러오지 못했습니다");
      setTargets([]);
    }
  }, [months]);

  useEffect(() => { void load(); }, [load]);

  const grades = useMemo(() => {
    const found = new Set<string>();
    (targets || []).forEach((t) => { if (t.등급) found.add(t.등급); });
    const order = ["SS", "S", "V", "N", "NN"]; // 등급 위계대로 — 알파벳순은 뜻이 없다
    const known = order.filter((g) => found.has(g));
    const rest = Array.from(found).filter((g) => !order.includes(g)).sort();
    return ["전체", ...known, ...rest];
  }, [targets]);

  const shown = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const list = (targets || []).filter((t) => {
      if (grade !== "전체" && t.등급 !== grade) return false;
      if (riskOnly && t.risk < 3) return false;
      if (!keyword) return true;
      if (t.vendor.toLowerCase().includes(keyword) || t.구.includes(keyword)) return true;
      return t.devices.some((d) => `${d.모델명} ${d.기종} ${d.자산번호} ${d.기번} ${d.순번}`.toLowerCase().includes(keyword));
    });
    return list.sort((a, b) =>
      sort === "money" ? b.월렌탈료합 - a.월렌탈료합
        : sort === "risk" ? (b.risk - a.risk) || (a.dday - b.dday)
          : (a.dday - b.dday) || (b.월렌탈료합 - a.월렌탈료합));
  }, [targets, query, grade, riskOnly, sort]);

  const totals = useMemo(() => ({
    업체: shown.length,
    대수: shown.reduce((sum, t) => sum + t.대수, 0),
    월렌탈료: shown.reduce((sum, t) => sum + t.월렌탈료합, 0),
    위험: shown.filter((t) => t.risk >= 3).length,
  }), [shown]);

  if (picked) return <Briefing target={picked} onBack={() => setPicked(null)} />;

  return (
    <div className="space-y-4">
      {/* 조건 — 다크 패널 (앱 헤더와 같은 톤) */}
      <section className="overflow-hidden rounded-xl bg-[#1E252F] shadow-sm">
        <div className="flex items-center gap-2 px-3.5 py-3 lg:px-5">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-black text-white lg:text-[15px]">종료 임박 거래처</div>
            <div className="mt-0.5 text-[11px] font-semibold text-slate-400">
              {targets === null ? "불러오는 중…" : `${months}개월 안 종료 · 업체 ${totals.업체}곳 · 기기 ${totals.대수}대 · 월 ${money(totals.월렌탈료)}원`}
            </div>
          </div>
          <button type="button" onClick={() => void load(true)} aria-label="새로 불러오기"
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-white/10 px-2.5 text-[12px] font-black text-slate-200 transition hover:bg-white/20">
            <RefreshCw size={13} /> 갱신
          </button>
        </div>
        <div className="space-y-1.5 px-3.5 pb-3 lg:px-5">
          <div className="flex flex-wrap items-center gap-1.5">
            {MONTH_CHIPS.map((m) => (
              <Chip key={m} on={months === m} onClick={() => setMonths(m)}>{m}개월</Chip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {SORTS.map((s) => (
              <Chip key={s.key} on={sort === s.key} onClick={() => setSort(s.key)}>{s.label}</Chip>
            ))}
            <Chip on={riskOnly} onClick={() => setRiskOnly(!riskOnly)}>위험만 {totals.위험}</Chip>
          </div>
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="업체·모델·자산번호·순번"
              className="w-full rounded-lg border border-white/15 bg-white/10 py-2 pl-7 pr-2.5 text-xs font-semibold text-white outline-none transition placeholder:text-slate-500 focus:border-blue-400 focus:bg-white/15" />
          </div>
          {grades.length > 2 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {grades.map((g) => <Chip key={g} on={grade === g} onClick={() => setGrade(g)}>{g}</Chip>)}
            </div>
          )}
        </div>
      </section>

      {!!loadError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">
          불러오기 실패 — {loadError}
        </div>
      )}

      {targets === null && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm font-bold text-slate-400">
          임대리스트에서 종료 임박 기기를 찾는 중…
        </div>
      )}

      {targets !== null && !shown.length && !loadError && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm font-bold text-slate-400">
          조건에 맞는 업체가 없습니다 — 기간을 늘려보세요.
        </div>
      )}

      <div className="space-y-2">
        {shown.slice(0, limit).map((target) => (
          <button key={target.key} type="button" onClick={() => setPicked(target)}
            className="block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-left shadow-sm transition hover:border-blue-300 hover:shadow-md">
            <div className="flex items-start gap-2.5">
              <span className={`shrink-0 rounded-lg px-2 py-1 text-[12px] font-black tabular-nums ${ddayTone(target.dday)}`}>
                {ddayLabel(target.dday)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm font-black text-slate-900">{target.vendor}</span>
                  {!!target.등급 && <Badge tone="bg-slate-900 text-white">{target.등급}</Badge>}
                </div>
                <div className="mt-0.5 text-[11px] font-bold text-slate-500">
                  {target.최단종료일} 종료{target.종료일수 > 1 ? ` · 종료일 ${target.종료일수}갈래` : ""}{target.구 ? ` · ${target.구}` : ""}
                </div>
                <div className="text-[11px] font-black tabular-nums text-slate-700">
                  {target.대수}대 · 월 {money(target.월렌탈료합)}원
                </div>
                {!!target.risks.length && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {target.risks.map((risk) => <Badge key={risk} tone={riskTone(target.risk)}>{risk}</Badge>)}
                    {!!target.signals.history?.건수 && (
                      <Badge tone="bg-blue-50 text-blue-700">
                        협상기록 {target.signals.history.건수}{target.signals.history.최종상태 ? ` · ${target.signals.history.최종상태}` : ""}
                      </Badge>
                    )}
                  </div>
                )}
                {!target.risks.length && !!target.signals.history?.건수 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <Badge tone="bg-blue-50 text-blue-700">협상기록 {target.signals.history.건수}</Badge>
                  </div>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      {shown.length > limit && (
        <button type="button" onClick={() => setLimit((n) => n + 40)}
          className="w-full rounded-xl border border-slate-300 bg-white py-2.5 text-xs font-black text-slate-600 transition hover:bg-slate-50">
          더 보기 ({shown.length - limit}곳 남음)
        </button>
      )}
    </div>
  );
}

// ─── 브리핑 ──────────────────────────────────────────────────────────────────

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-baseline gap-2 border-b border-slate-100 bg-slate-50/70 px-3.5 py-2">
        <h3 className="text-[13px] font-black text-slate-900">{title}</h3>
        {!!hint && <span className="text-[11px] font-semibold text-slate-400">{hint}</span>}
      </div>
      <div className="p-3.5">{children}</div>
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

function Briefing({ target, onBack }: { target: RcTarget; onBack: () => void }) {
  const [data, setData] = useState<RcBriefing | null>(null);
  const [failed, setFailed] = useState("");

  useEffect(() => {
    let alive = true;
    setData(null);
    setFailed("");
    fetchBriefing(target)
      .then((result) => { if (alive) setData(result); })
      .catch((e) => { if (alive) setFailed((e as Error).message || "불러오지 못했습니다"); });
    return () => { alive = false; };
  }, [target]);

  const [showRest, setShowRest] = useState(false);
  const devices = data?.devicesAll.length ? data.devicesAll : target.devices;
  const raw = data?.raw || {};
  const 월합 = devices.reduce((sum, d) => sum + d.월렌탈료, 0);
  // 이번 재계약 대상(레이더에 걸린 기기)과 나머지 임대중 기기를 나눈다
  const dueIds = useMemo(() => new Set(target.devices.map((d) => d.id)), [target]);
  const dueDevices = devices.filter((d) => dueIds.has(d.id));
  const restDevices = devices.filter((d) => !dueIds.has(d.id));

  const briefText = useMemo(() => {
    const lines = [
      `[재계약 준비] ${target.vendor}${target.등급 ? ` (${target.등급})` : ""}`,
      `종료 ${target.최단종료일} · ${ddayLabel(target.dday)} · 임대중 ${devices.length}대 · 월 ${money(월합)}원`,
      raw["담당지역"] ? `담당지역 ${raw["담당지역"]}${raw["영업담당자"] ? ` · 영업 ${raw["영업담당자"]}` : ""}` : "",
      raw["주소(실납품주소,도로명주소)"] ? `주소 ${raw["주소(실납품주소,도로명주소)"]}` : "",
      raw["키맨"] ? `키맨 ${raw["키맨"].replace(/\n/g, " / ")}` : "",
      "",
      "■ 기기·계약",
      ...devices.map((d) => `- ${d.종료일} 종료 · ${d.모델명 || d.기종} · 자산 ${d.자산번호 || "-"} · 월 ${money(d.월렌탈료)}원${d.추가컬 || d.추가흑 ? ` · 추가 컬${d.추가컬 || "-"}/흑${d.추가흑 || "-"}` : ""}${d.누적방식 ? ` · ${d.누적방식}` : ""}`),
    ];
    if (target.risks.length) lines.push("", `■ 주의: ${target.risks.join(" · ")}`);
    const misu = target.signals.misu;
    if (misu && (misu.개월 > 0 || misu.잔액 > 0)) lines.push(`- 미수 ${misu.개월}개월 ${money(misu.잔액)}원${misu.약속일 ? ` (약속 ${misu.약속일})` : ""}`);
    const overage = target.signals.overage;
    if (overage?.건수) lines.push(`- 초과 ${overage.건수}회 · 최근 ${overage.최근일} ${money(overage.최근합계)}원${overage.기본매수 ? ` · 기본 ${overage.기본매수}` : ""}`);
    if (data?.history.length) {
      lines.push("", "■ 지난 협상");
      for (const h of data.history.slice(0, 3)) {
        lines.push(`- ${h.날짜} ${h.갱신상태 || ""}${h.갱신위험도 ? `/위험 ${h.갱신위험도}` : ""}${h.제안조건 ? ` · ${h.제안조건.replace(/\n/g, " ")}` : ""}`);
      }
    }
    return lines.filter((line) => line !== "").join("\n");
  }, [target, devices, raw, data, 월합]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(briefText);
      notify("브리핑을 복사했습니다 ✓", "success");
    } catch {
      notify("복사 실패 — 화면에서 직접 선택해 복사하세요.", "error");
    }
  };

  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-xl bg-[#1E252F] shadow-sm">
        <div className="flex items-start gap-2.5 px-3.5 py-3 lg:px-5">
          <button type="button" onClick={onBack} aria-label="목록으로"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-slate-200 transition hover:bg-white/20">
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="min-w-0 truncate text-sm font-black text-white lg:text-[15px]">{target.vendor}</span>
              {!!target.등급 && <Badge tone="bg-white text-slate-950">{target.등급}</Badge>}
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-black tabular-nums ${ddayTone(target.dday)}`}>{ddayLabel(target.dday)}</span>
            </div>
            <div className="mt-0.5 text-[11px] font-semibold text-slate-400">
              {target.최단종료일} 종료 · 임대중 {devices.length}대 · 월 {money(월합)}원
              {raw["담당지역"] ? ` · ${raw["담당지역"]}` : target.구 ? ` · ${target.구}` : ""}
            </div>
          </div>
          <button type="button" onClick={() => void copy()}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-2.5 text-[12px] font-black text-white transition hover:bg-blue-700">
            <ClipboardCopy size={13} /> 복사
          </button>
        </div>
      </section>

      {!!failed && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">상세를 불러오지 못했습니다 — {failed}</div>}

      <ProposalSheet vendorKey={target.key} vendorName={target.vendor} />

      <Section title="거래처" hint="임대리스트 기준">
        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-3 lg:grid-cols-4">
          <Field label="담당지역" value={raw["담당지역"] || target.구} />
          <Field label="관리 담당자" value={raw["관리 담당자"] || ""} />
          <Field label="영업담당자" value={raw["영업담당자"] || ""} />
          <Field label="일반전화" value={raw["일반전화"] || ""} />
          <Field label="키맨" value={(raw["키맨"] || "").replace(/\n/g, " / ")} />
          <Field label="장비소유주" value={raw["장비소유주"] || ""} />
          <Field label="방문주기" value={raw["방문주기"] ? `${raw["방문주기"].replace(/개월$/, "")}개월` : ""} />
          <Field label="세금계산서 담당" value={raw["세금계산서"] || ""} />
        </div>
        {!!raw["주소(실납품주소,도로명주소)"] && (
          <div className="mt-2.5 border-t border-slate-100 pt-2.5">
            <Field label="주소" value={raw["주소(실납품주소,도로명주소)"]} />
          </div>
        )}
        {!!raw["특이사항"] && (
          <div className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-bold text-amber-900 whitespace-pre-wrap">
            {raw["특이사항"]}
          </div>
        )}
      </Section>

      <Section title="기기·계약" hint={`이번 대상 ${dueDevices.length}대 · 임대중 전체 ${devices.length}대`}>
        <div className="space-y-2">
          {(showRest ? [...dueDevices, ...restDevices] : dueDevices).map((device) => {
            const dday = device.종료일 ? ddayLabel(ddayOf(device.종료일)) : "";
            return (
              <div key={device.id} className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[13px] font-black text-slate-900">{device.모델명 || device.기종 || "모델 미기재"}</span>
                  {!!device.제조사 && <Badge tone="bg-slate-200 text-slate-600">{device.제조사}</Badge>}
                  <span className={`ml-auto text-[12px] font-black tabular-nums ${device.월렌탈료 ? "text-slate-700" : "text-rose-500"}`}>{device.월렌탈료 ? `월 ${money(device.월렌탈료)}원` : "월 렌탈료 미기재"}</span>
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-4">
                  <Field label="계약" value={[device.계약일, device.계약기간].filter(Boolean).join(" · ")} />
                  <Field label="종료" value={device.종료일 ? `${device.종료일}${dday ? ` (${dday})` : ""}` : "미기재"} />
                  <Field label="자산·기번" value={[device.자산번호, device.기번].filter(Boolean).join(" / ")} />
                  <Field label="순번" value={device.순번} />
                  <Field label="추가단가" value={device.추가컬 || device.추가흑 ? `컬 ${device.추가컬 || "-"} / 흑 ${device.추가흑 || "-"}` : ""} />
                  <Field label="누적방식" value={device.누적방식} />
                  <Field label="연평균" value={device.연평균 ? `${money(device.연평균)}원` : ""} />
                  <Field label="추가조건" value={device.추가조건} />
                </div>
              </div>
            );
          })}
        </div>
        {!!restDevices.length && (
          <button type="button" onClick={() => setShowRest((v) => !v)}
            className="mt-2 w-full rounded-lg border border-slate-300 bg-white py-2 text-[12px] font-black text-slate-600 transition hover:bg-slate-50">
            {showRest ? "나머지 접기" : `같은 업체 나머지 임대중 ${restDevices.length}대 보기`}
          </button>
        )}
      </Section>

      {data === null && !failed && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm font-bold text-slate-400">이력을 불러오는 중…</div>
      )}

      {!!data?.history.length && (
        <Section title="지난 재계약 협상" hint={`${data.history.length}건 · /계약갱신 기록`}>
          <div className="space-y-2">
            {data.history.map((row) => (
              <div key={row.id} className="rounded-lg border border-blue-100 bg-blue-50/50 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[12px] font-black tabular-nums text-slate-700">{row.날짜}</span>
                  {!!row.갱신상태 && <Badge tone="bg-blue-600 text-white">{row.갱신상태}</Badge>}
                  {!!row.갱신위험도 && <Badge tone={row.갱신위험도 === "상" ? "bg-rose-100 text-rose-700" : row.갱신위험도 === "중" ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-600"}>위험 {row.갱신위험도}</Badge>}
                  {!!row.최종상태 && <Badge tone="bg-slate-200 text-slate-700">{row.최종상태}</Badge>}
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
              <div key={index} className="rounded-lg border border-slate-200 px-3 py-2 text-[12px] font-bold text-slate-700">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums text-slate-500">{row["입력일"]}</span>
                  <Badge tone="bg-rose-100 text-rose-700">{row["미수개월"] || "-"}개월 {row["미수잔액"] ? `${money(Number(row["미수잔액"].replace(/[^0-9]/g, "")) || 0)}원` : ""}</Badge>
                  {!!row["입금약속일"] && <Badge tone="bg-emerald-100 text-emerald-700">약속 {row["입금약속일"]}</Badge>}
                </div>
                {!!row["방문내용"] && <div className="mt-1 whitespace-pre-wrap text-slate-600">{row["방문내용"]}</div>}
                {!!row["고객반응"] && <div className="mt-0.5 text-slate-500">반응 · {row["고객반응"]}</div>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {!!data?.overage.length && (
        <Section title="사용량 초과" hint={`${data.overage.length}건 — 재계약 조건의 핵심 근거`}>
          <div className="space-y-1.5">
            {data.overage.map((row, index) => (
              <div key={index} className="rounded-lg border border-slate-200 px-3 py-2 text-[12px] font-bold text-slate-700">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums text-slate-500">{row["날짜"]}</span>
                  {!!row["모델명"] && <span className="text-slate-600">{row["모델명"]}</span>}
                  <span className="ml-auto tabular-nums text-slate-900">{row["합계"] ? `${money(Number(row["합계"].replace(/[^0-9]/g, "")) || 0)}원` : ""}</span>
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  {row["기본매수"] ? `기본 ${row["기본매수"]}` : ""}{row["초과장당금액"] ? ` · 단가 ${row["초과장당금액"]}` : ""}
                  {row["컬러초과료"] || row["흑백초과료"] ? ` · 컬 ${row["컬러초과료"] || "-"} / 흑 ${row["흑백초과료"] || "-"}` : ""}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {!!data?.bulman.length && (
        <Section title="불만" hint={`${data.bulman.length}건 — 방문 전 반드시 확인`}>
          <div className="space-y-1.5">
            {data.bulman.map((row, index) => (
              <div key={index} className="rounded-lg border border-rose-200 bg-rose-50/50 px-3 py-2 text-[12px] font-bold text-slate-700">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums text-slate-500">{row["날짜"]}</span>
                  {!!row["불만유형"] && <Badge tone="bg-rose-600 text-white">{row["불만유형"]}</Badge>}
                  {!!row["불만항목"] && <Badge tone="bg-rose-100 text-rose-700">{row["불만항목"]}</Badge>}
                </div>
                {!!row["불만내용"] && <div className="mt-1 whitespace-pre-wrap text-slate-700">{row["불만내용"]}</div>}
                {!!row["대안제시"] && <div className="mt-1 text-slate-600">대안 · {row["대안제시"]}</div>}
                {!!row["재발방지"] && <div className="mt-0.5 text-slate-500">재발방지 · {row["재발방지"]}</div>}
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="AS·점검 빈도" hint="최근 18개월">
        <div className="flex flex-wrap gap-2 text-[12px] font-bold text-slate-700">
          <Badge tone="bg-slate-100 text-slate-700">AS {target.signals.as?.건수 || 0}건{target.signals.as?.최근일 ? ` · 최근 ${target.signals.as.최근일}` : ""}</Badge>
          <Badge tone="bg-slate-100 text-slate-700">불만 {target.signals.bulman?.건수 || 0}건</Badge>
          <Badge tone="bg-slate-100 text-slate-700">초과 {target.signals.overage?.건수 || 0}회</Badge>
        </div>
        <p className="mt-2 text-[11px] font-semibold text-slate-400">
          기기별 점검 매수·여분 추이와 판정(유형·난이도·추천 기간)·제안 플랜은 다음 단계에서 붙습니다.
        </p>
      </Section>
    </div>
  );
}
