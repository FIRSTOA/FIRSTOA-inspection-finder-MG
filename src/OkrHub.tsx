// OKR 화면 — 기록·성과 > OKR (2026-09-24)
// 엑셀 "CS팀_8월_OKR_실행결과" 워크북을 웹으로 옮겼다. 위: 기간(월간/주간) 선택, 가운데: 통합집계 / 파트별 탭.
//  - 파트 탭: 노란 칸(실제결과·종합판정·사유·개선계획·근거자료)만 쓰면 된다. 목표·달성기준은 읽기 전용(팀장이 [목표 편집]으로만 고침).
//  - 통합집계: 목표별 A~E 판정과 '조치 필요 파트'(미흡·미착수)가 자동으로 모이고, 팀장 피드백·다음 달 개선 방향을 적는다.
//  - 저장은 자동(0.7초 디바운스). 같은 파트를 두 사람이 동시에 고치면 나중 저장이 이긴다.
import { useEffect, useMemo, useRef, useState } from "react";
import PortalSelect from "./PortalSelect";
import { askConfirm } from "./confirmModal";
import { teamLabel } from "./authors";
import { teamForAuthor } from "./operations";
import {
  JUDGMENT_INFO, OKR_JUDGMENTS, OKR_TEAMS, achievementRate, actionTeams, cycleLabel, defaultCycleTitle, deleteOkrCycle, emptyGoal, emptyReport,
  emptyResultRow, getOkrReports, judgmentCounts, listOkrCycles, monthCycleId, normalizeJudgment, okrWeeksInMonth, renumberGoals, resultRowFor,
  saveOkrCycle, saveOkrReport, splitPillar, weekCycleId, worstJudgment,
  type OkrCycle, type OkrGoal, type OkrReport, type OkrResultRow, type OkrTeam,
} from "./okr";

type Tab = "all" | OkrTeam;
type SaveStatus = "idle" | "saving" | "saved" | "error";

const kstToday = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
const teamName = (team: string) => (team === "E" ? teamLabel("E") : `${team}파트`);
const shortTime = (iso?: string) => (iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

function AutoGrowTextarea({ value, onChange, className = "", rows = 2, placeholder = "", disabled = false }: { value: string; onChange: (v: string) => void; className?: string; rows?: number; placeholder?: string; disabled?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const el = ref.current; if (!el) return; el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }, [value]);
  return <textarea ref={ref} rows={rows} value={value} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`resize-none overflow-hidden ${className}`} />;
}

const inputClass = "w-full rounded-lg border border-slate-200 bg-amber-50/60 px-3 py-2 text-sm leading-relaxed text-slate-800 outline-none focus:border-amber-400 focus:bg-white disabled:bg-slate-50";
const plainInput = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400";

// 달성기준 줄 — "[건수형]" "[차월반영]" 꼬리표에 색을 입힌다
function CriteriaLines({ text }: { text: string }) {
  const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return <div className="text-xs text-slate-400">달성기준 없음</div>;
  return <ul className="space-y-1">{lines.map((line, i) => {
    const parts = line.split(/(\[건수형\]|\[차월반영\])/g).filter(Boolean);
    return <li key={i} className="text-[13px] leading-snug text-slate-700">{parts.map((p, j) => p === "[건수형]" ? <span key={j} className="ml-1 rounded bg-blue-50 px-1 text-[10px] font-black text-blue-600">건수형</span> : p === "[차월반영]" ? <span key={j} className="mr-1 rounded bg-violet-50 px-1 text-[10px] font-black text-violet-600">차월반영</span> : <span key={j}>{p.replace(/^•\s*/, "• ")}</span>)}</li>;
  })}</ul>;
}

function JudgmentBadge({ value, small = false }: { value: string; small?: boolean }) {
  const j = normalizeJudgment(value);
  if (!j) return <span className={`inline-flex rounded-full border border-dashed border-slate-300 px-2 ${small ? "py-0 text-[10px]" : "py-0.5 text-[11px]"} font-bold text-slate-400`}>미기재</span>;
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 ${small ? "py-0 text-[10px]" : "py-0.5 text-[11px]"} font-black ${JUDGMENT_INFO[j].tone}`}><span className={`h-1.5 w-1.5 rounded-full ${JUDGMENT_INFO[j].dot}`} />{j}</span>;
}

export default function OkrHub({ author }: { author: string }) {
  const today = kstToday();
  const myTeam = useMemo(() => { const t = teamForAuthor(author); return (OKR_TEAMS as readonly string[]).includes(t) ? (t as OkrTeam) : null; }, [author]);
  const [cycles, setCycles] = useState<OkrCycle[]>([]);
  const [cycleId, setCycleId] = useState("");
  const [cycle, setCycle] = useState<OkrCycle | null>(null);
  const [reports, setReports] = useState<OkrReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<Tab>(myTeam || "all");
  const [editGoals, setEditGoals] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const cycleSavedRef = useRef("");
  const reportSavedRef = useRef<Record<string, string>>({});
  const loadedCycleRef = useRef("");
  const cyclesRef = useRef<OkrCycle[]>([]);
  useEffect(() => { cyclesRef.current = cycles; }, [cycles]);
  // 디바운스 대기 중인 저장 — 기간을 바꾸거나 화면을 나갈 때 잃지 않도록 즉시 저장(flush)한다
  const pendingCycleRef = useRef<OkrCycle | null>(null);
  const pendingReportsRef = useRef<OkrReport[]>([]);
  const flushPending = () => {
    const c = pendingCycleRef.current; pendingCycleRef.current = null;
    const rs = pendingReportsRef.current; pendingReportsRef.current = [];
    if (c) void saveOkrCycle(c, author).catch(() => undefined);
    for (const r of rs) void saveOkrReport(r, author).catch(() => undefined);
  };
  useEffect(() => () => flushPending(), []); // eslint-disable-line react-hooks/exhaustive-deps -- 언마운트 시 1회

  const reloadCycles = async (pick?: string) => {
    try {
      const list = await listOkrCycles();
      setCycles(list);
      setTableMissing(false);
      if (pick) setCycleId(pick);
      else if (!cycleId || !list.some((c) => c.id === cycleId)) {
        // 기본: 오늘이 든 월간 기간 → 없으면 가장 최근 월간 → 그것도 없으면 첫 번째
        const month = list.find((c) => c.kind === "month" && c.start_date <= today && c.end_date >= today) || list.find((c) => c.kind === "month") || list[0];
        setCycleId(month?.id || "");
      }
      return list;
    } catch (e) {
      const msg = (e as Error).message || "";
      if (/okr_cycles|relation|404|schema cache/i.test(msg)) setTableMissing(true);
      setMessage(msg);
      return [];
    } finally { setLoading(false); }
  };
  useEffect(() => { void reloadCycles(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 기간이 바뀌면 그 기간의 목표·피드백과 파트별 결과를 읽는다.
  // cycles를 의존성에 넣지 않는다 — 기간 자동 저장 뒤 목록을 갱신할 때마다 결과를 다시 읽어 입력 중인 파트 결과를 덮어쓰게 되므로.
  useEffect(() => {
    flushPending();
    if (!cycleId) { setCycle(null); setReports([]); return; }
    const found = cyclesRef.current.find((c) => c.id === cycleId) || null;
    setCycle(found);
    cycleSavedRef.current = found ? JSON.stringify({ goals: found.goals, feedback: found.feedback, title: found.title }) : "";
    let alive = true;
    setLoading(true);
    getOkrReports(cycleId)
      .then((rows) => {
        if (!alive) return;
        setReports(rows);
        reportSavedRef.current = Object.fromEntries(rows.map((r) => [r.team, JSON.stringify({ header: r.header, rows: r.rows })]));
        loadedCycleRef.current = cycleId;
        setSaveStatus("idle");
      })
      .catch((e) => alive && setMessage((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [cycleId]); // eslint-disable-line react-hooks/exhaustive-deps -- flushPending·cyclesRef는 ref만 읽는다

  // 자동 저장 — 기간(목표·피드백·제목)
  useEffect(() => {
    if (!cycle || loading || loadedCycleRef.current !== cycle.id) return;
    const signature = JSON.stringify({ goals: cycle.goals, feedback: cycle.feedback, title: cycle.title });
    if (signature === cycleSavedRef.current) return;
    pendingCycleRef.current = cycle;
    setSaveStatus("saving");
    const timer = window.setTimeout(() => {
      pendingCycleRef.current = null;
      saveOkrCycle(cycle, author)
        .then(() => { cycleSavedRef.current = signature; setSaveStatus("saved"); setCycles((cur) => cur.map((c) => (c.id === cycle.id ? cycle : c))); })
        .catch((e) => { setSaveStatus("error"); setMessage((e as Error).message); });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [cycle, author, loading]);

  // 자동 저장 — 파트별 결과(바뀐 파트만)
  useEffect(() => {
    if (!cycle || loading || loadedCycleRef.current !== cycle.id) return;
    const dirty = reports.filter((r) => JSON.stringify({ header: r.header, rows: r.rows }) !== (reportSavedRef.current[r.team] || ""));
    if (!dirty.length) return;
    pendingReportsRef.current = dirty;
    setSaveStatus("saving");
    const timer = window.setTimeout(() => {
      pendingReportsRef.current = [];
      Promise.all(dirty.map((r) => saveOkrReport(r, author).then(() => { reportSavedRef.current[r.team] = JSON.stringify({ header: r.header, rows: r.rows }); })))
        .then(() => setSaveStatus("saved"))
        .catch((e) => { setSaveStatus("error"); setMessage((e as Error).message); });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [reports, cycle, author, loading]);

  const goals = cycle?.goals || [];
  const updateCycle = (patch: Partial<OkrCycle>) => setCycle((cur) => (cur ? { ...cur, ...patch } : cur));
  const updateGoal = (no: number, patch: Partial<OkrGoal>) => updateCycle({ goals: goals.map((g) => (g.no === no ? { ...g, ...patch } : g)) });
  const setFeedback = (no: number, memo: string) => updateCycle({ feedback: { ...(cycle?.feedback || {}), [String(no)]: { ...(cycle?.feedback?.[String(no)] || { memo: "" }), memo } } });
  const reportOf = (team: string) => reports.find((r) => r.team === team) || emptyReport(cycleId, team);
  const patchReport = (team: string, fn: (r: OkrReport) => OkrReport) => setReports((cur) => {
    const exists = cur.some((r) => r.team === team);
    const base = exists ? cur : [...cur, emptyReport(cycleId, team)];
    return base.map((r) => (r.team === team ? fn(r) : r));
  });
  const updateResult = (team: string, no: number, patch: Partial<OkrResultRow>) => patchReport(team, (r) => {
    const has = r.rows.some((x) => x.no === no);
    const rows = has ? r.rows.map((x) => (x.no === no ? { ...x, ...patch } : x)) : [...r.rows, { ...emptyResultRow(no), ...patch }];
    return { ...r, rows: rows.sort((a, b) => a.no - b.no) };
  });

  const addGoal = () => updateCycle({ goals: renumberGoals([...goals, emptyGoal(goals.length + 1)]) });
  const removeGoal = async (goal: OkrGoal) => {
    const used = reports.filter((r) => { const row = resultRowFor(r, goal.no); return row.actual || row.judgment; }).map((r) => teamName(r.team));
    const ok = await askConfirm(`${goal.no}번 목표를 삭제할까요?${used.length ? `\n\n이미 결과를 적은 파트: ${used.join(", ")} — 그 결과도 함께 지워집니다.` : ""}\n뒤 번호는 앞으로 당겨집니다.`, { danger: true, okLabel: "삭제" });
    if (!ok) return;
    const remaining = goals.filter((g) => g.no !== goal.no);
    const remap = new Map(remaining.map((g, i) => [g.no, i + 1]));
    updateCycle({ goals: renumberGoals(remaining), feedback: Object.fromEntries(Object.entries(cycle?.feedback || {}).filter(([k]) => remap.has(Number(k))).map(([k, v]) => [String(remap.get(Number(k))), v])) });
    setReports((cur) => cur.map((r) => ({ ...r, rows: r.rows.filter((x) => remap.has(x.no)).map((x) => ({ ...x, no: remap.get(x.no) || x.no })) })));
  };
  const importGoalsFrom = (sourceId: string) => {
    const src = cycles.find((c) => c.id === sourceId);
    if (!src) return;
    updateCycle({ goals: src.goals.map((g) => ({ ...g })) });
    setMessage(`${cycleLabel(src)} 목표 ${src.goals.length}개를 가져왔어요 (자동 저장)`);
  };
  const removeCycle = async () => {
    if (!cycle) return;
    const filled = reports.filter((r) => r.rows.some((x) => x.actual || x.judgment)).length;
    const ok = await askConfirm(`${cycleLabel(cycle)} OKR 기간을 통째로 삭제할까요?\n목표 ${goals.length}개와 결과를 적은 파트 ${filled}개가 함께 지워지며 되돌릴 수 없습니다.`, { danger: true, okLabel: "기간 삭제" });
    if (!ok) return;
    try { await deleteOkrCycle(cycle.id); setCycleId(""); await reloadCycles(); setMessage("삭제했어요"); } catch (e) { setMessage((e as Error).message); }
  };

  const cycleOptions = useMemo(() => cycles.map((c) => ({ value: c.id, label: `${cycleLabel(c)}${c.title ? ` · ${c.title.replace(/^CS팀\s*/, "")}` : ""}`, group: c.kind === "month" ? "월간" : "주간" })), [cycles]);
  const tabs: Array<[Tab, string]> = [["all", "통합집계"], ...OKR_TEAMS.map((t) => [t, teamName(t)] as [Tab, string])];

  if (!author) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm font-semibold text-amber-800">FIELD에서 작성자를 먼저 선택해 주세요.</div>;

  return <div className="space-y-4 pb-16">
    <section className="flex flex-col gap-3 rounded-xl bg-[#151A23] p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <PortalSelect tone="dark" width={260} value={cycleId} onChange={setCycleId} options={cycleOptions.length ? cycleOptions : [{ value: "", label: "OKR 기간 없음 — 새로 만들기" }]} />
        <button type="button" onClick={() => setNewOpen(true)} className="rounded-full bg-white px-3 py-1.5 text-xs font-black text-slate-900 hover:bg-slate-100">＋ 새 기간</button>
        {cycle && <button type="button" onClick={() => setEditGoals((v) => !v)} className={`rounded-full px-3 py-1.5 text-xs font-black transition ${editGoals ? "bg-amber-300 text-slate-900" : "border border-white/15 text-slate-300 hover:bg-white/10"}`}>{editGoals ? "✓ 목표 편집 끝" : "목표 편집"}</button>}
        <button type="button" onClick={() => setGuideOpen((v) => !v)} className={`rounded-full px-3 py-1.5 text-xs font-black transition ${guideOpen ? "bg-white/20 text-white" : "border border-white/15 text-slate-300 hover:bg-white/10"}`}>작성 가이드</button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-300">
        {cycle && <span className="rounded-full bg-white/10 px-3 py-1.5 tabular-nums">{cycle.start_date} ~ {cycle.end_date}</span>}
        <span className={`rounded-full px-3 py-1.5 ${saveStatus === "saving" ? "bg-blue-500/20 text-blue-200" : saveStatus === "saved" ? "bg-emerald-500/20 text-emerald-200" : saveStatus === "error" ? "bg-rose-500/20 text-rose-200" : "bg-white/10"}`}>{saveStatus === "saving" ? "자동 저장중" : saveStatus === "saved" ? "자동 저장됨" : saveStatus === "error" ? "저장 실패" : "자동 저장"}</span>
      </div>
    </section>

    {tableMissing && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><b>OKR 표가 아직 없습니다.</b> Supabase SQL Editor에서 <code className="rounded bg-white px-1">supabase/okr.sql</code>을 한 번 실행하면 8월 OKR(A~D파트 결과·팀장 피드백)과 9월 목표가 함께 들어옵니다.</div>}
    {message && !tableMissing && <div className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-600"><span>{message}</span><button type="button" onClick={() => setMessage("")} className="text-slate-400 hover:text-slate-700">닫기</button></div>}
    {guideOpen && <GuidePanel />}

    {cycle && <>
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="bg-[#1E252F] px-5 py-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-blue-400">{cycle.kind === "week" ? "Weekly OKR" : "Monthly OKR"} · {cycleLabel(cycle)}</div>
          {editGoals
            ? <input value={cycle.title} onChange={(e) => updateCycle({ title: e.target.value })} className="mt-1 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-lg font-black text-white outline-none lg:max-w-xl" placeholder={defaultCycleTitle(cycle)} />
            : <h2 className="mt-1 text-lg font-black tracking-tight text-white lg:text-xl">{cycle.title || defaultCycleTitle(cycle)}</h2>}
          <p className="mt-1 text-[11px] font-semibold text-slate-400">목표 {goals.length}개 · 파트는 노란 칸(실제결과 / 종합판정 / 사유·개선계획 / 근거자료)만 채우면 됩니다. 저장은 자동.</p>
        </div>
        <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-3 pt-3">
          {tabs.map(([key, label]) => {
            const rep = key === "all" ? null : reportOf(key);
            const judged = rep ? rep.rows.filter((x) => normalizeJudgment(x.judgment)).length : 0;
            return <button key={key} type="button" onClick={() => setTab(key)} className={`flex shrink-0 items-center gap-1.5 rounded-t-lg px-3 py-2 text-sm font-black transition ${tab === key ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}>
              {label}{rep && goals.length > 0 && <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${judged >= goals.length ? "bg-emerald-500 text-white" : judged ? "bg-amber-300 text-slate-900" : "bg-slate-200 text-slate-500"}`}>{judged}/{goals.length}</span>}
              {key === myTeam && <span className="text-[10px] text-blue-300">내 파트</span>}
            </button>;
          })}
        </div>
        {editGoals && <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-800">
          <span>✎ 목표 편집 중 — 흰 칸(Pillar·병목·목표·달성기준)을 고칩니다. 파트가 쓰는 칸은 그대로 있어요.</span>
          <button type="button" onClick={addGoal} className="rounded-full border border-amber-300 bg-white px-2.5 py-1 text-xs font-black text-amber-800 hover:bg-amber-100">＋ 목표 추가</button>
          {cycles.filter((c) => c.id !== cycle.id).length > 0 && <PortalSelect width={220} value="" onChange={(v) => v && importGoalsFrom(v)} options={[{ value: "", label: "다른 기간에서 목표 가져오기…" }, ...cycles.filter((c) => c.id !== cycle.id).map((c) => ({ value: c.id, label: `${cycleLabel(c)} (${c.goals.length}개)`, group: c.kind === "month" ? "월간" : "주간" }))]} />}
          <button type="button" onClick={removeCycle} className="ml-auto rounded-full border border-rose-200 bg-white px-2.5 py-1 text-xs font-black text-rose-600 hover:bg-rose-50">이 기간 삭제</button>
        </div>}
      </section>

      {loading ? <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm font-bold text-slate-400">불러오는 중…</div>
        : tab === "all"
          ? <SummaryView cycle={cycle} reports={reports} onFeedback={setFeedback} />
          : <TeamView team={tab} cycle={cycle} report={reportOf(tab)} editGoals={editGoals} onHeader={(patch) => patchReport(tab, (r) => ({ ...r, header: { ...r.header, ...patch } }))} onResult={(no, patch) => updateResult(tab, no, patch)} onGoal={updateGoal} onRemoveGoal={removeGoal} />}
    </>}

    {!cycle && !loading && !tableMissing && <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">OKR 기간이 없습니다. 위 [＋ 새 기간]으로 이번 달 OKR을 만들어 주세요.</div>}

    {newOpen && <NewCycleModal cycles={cycles} today={today} onClose={() => setNewOpen(false)} onCreate={async (draft) => {
      if (cycles.some((c) => c.id === draft.id)) { setMessage(`${cycleLabel(draft)} 기간은 이미 있어요 — 위 목록에서 고르세요.`); setNewOpen(false); setCycleId(draft.id); return; }
      try { await saveOkrCycle(draft, author); setNewOpen(false); setEditGoals(draft.goals.length === 0); await reloadCycles(draft.id); setTab(myTeam || "all"); }
      catch (e) { setMessage((e as Error).message); }
    }} />}
  </div>;
}

// ── 파트별 실행결과 ──
function TeamView({ team, cycle, report, editGoals, onHeader, onResult, onGoal, onRemoveGoal }: {
  team: OkrTeam; cycle: OkrCycle; report: OkrReport; editGoals: boolean;
  onHeader: (patch: Partial<OkrReport["header"]>) => void; onResult: (no: number, patch: Partial<OkrResultRow>) => void; onGoal: (no: number, patch: Partial<OkrGoal>) => void; onRemoveGoal: (goal: OkrGoal) => void;
}) {
  const goals = cycle.goals;
  const rows = goals.map((g) => resultRowFor(report, g.no));
  const counts = judgmentCounts(rows);
  const rate = achievementRate(rows);
  const judged = rows.filter((r) => normalizeJudgment(r.judgment)).length;
  return <div className="space-y-4">
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-black text-slate-950">{teamName(team)} 제출 정보</h3>
          <p className="mt-0.5 text-xs font-semibold text-slate-400">파트장 · 작성자 · 제출일 · 인원수 {report.updated_at && <span className="ml-2 text-slate-300">마지막 저장 {shortTime(report.updated_at)}{report.updated_by ? ` · ${report.updated_by}` : ""}</span>}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {OKR_JUDGMENTS.map((j) => counts[j] > 0 && <span key={j} className={`rounded-full border px-2 py-0.5 text-[11px] font-black ${JUDGMENT_INFO[j].tone}`}>{j} {counts[j]}</span>)}
          <span className="rounded-full bg-slate-900 px-2.5 py-0.5 text-[11px] font-black text-white tabular-nums">제출 {judged}/{goals.length}{rate !== null && ` · 달성 ${rate}%`}</span>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {([["leader", "파트장(부파트장)", "text"], ["author", "작성자", "text"], ["submitted", "제출일", "date"], ["headcount", "파트 인원수", "text"]] as Array<[keyof OkrReport["header"], string, string]>).map(([key, label, type]) => <label key={key} className="block text-[11px] font-black text-slate-500">{label}
          <input type={type} value={report.header[key]} onChange={(e) => onHeader({ [key]: e.target.value })} className={`mt-1 ${inputClass}`} placeholder={key === "headcount" ? "예) 4" : ""} />
        </label>)}
      </div>
    </section>

    {goals.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm font-bold text-slate-400">이 기간에는 아직 목표가 없어요. 위 [목표 편집]에서 추가하거나 다른 기간에서 가져오세요.</div>}
    {goals.map((goal) => {
      const row = resultRowFor(report, goal.no);
      const j = normalizeJudgment(row.judgment);
      const suggested = worstJudgment(row.actual);
      const pillar = splitPillar(goal.pillar);
      const needReason = (j === "부분달성" || j === "미흡" || j === "미착수") && !row.reason.trim();
      const needPlan = j === "미흡" && !row.plan.trim();
      const needEvidence = j === "해당없음" && !row.evidence.trim();
      return <section key={goal.no} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          {/* 흰 칸: 읽기 전용(편집 모드에서만 입력) */}
          <div className="border-b border-slate-100 bg-slate-50/70 p-4 lg:border-b-0 lg:border-r">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-black text-white">{goal.no}</span>
              {pillar.num && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-black text-indigo-700">{pillar.num}</span>}
              {pillar.name && <span className="text-[11px] font-bold text-slate-500">{pillar.name}</span>}
              {goal.bottleneck && !editGoals && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-black text-rose-600">{goal.bottleneck.split(/\r?\n/)[0]}</span>}
              {editGoals && <button type="button" onClick={() => onRemoveGoal(goal)} className="ml-auto rounded-full border border-rose-200 px-2 py-0.5 text-[11px] font-black text-rose-600 hover:bg-rose-50">삭제</button>}
            </div>
            {editGoals ? <div className="mt-3 space-y-2">
              <label className="block text-[11px] font-black text-slate-500">Pillar<input value={goal.pillar} onChange={(e) => onGoal(goal.no, { pillar: e.target.value })} className={`mt-1 ${plainInput}`} placeholder="Pillar 1. AI · 효율성 · 비용절감" /></label>
              <label className="block text-[11px] font-black text-slate-500">병목현상<input value={goal.bottleneck} onChange={(e) => onGoal(goal.no, { bottleneck: e.target.value })} className={`mt-1 ${plainInput}`} placeholder="병목현상 1" /></label>
              <label className="block text-[11px] font-black text-slate-500">목표<AutoGrowTextarea value={goal.objective} onChange={(v) => onGoal(goal.no, { objective: v })} className={`mt-1 ${plainInput}`} rows={2} /></label>
              <label className="block text-[11px] font-black text-slate-500">달성기준 (한 줄에 하나, • 로 시작 / 개수 기준이면 뒤에 [건수형])<AutoGrowTextarea value={goal.criteria} onChange={(v) => onGoal(goal.no, { criteria: v })} className={`mt-1 font-mono text-[12px] ${plainInput}`} rows={4} /></label>
            </div> : <>
              <div className="mt-3 text-[15px] font-black leading-snug text-slate-900 whitespace-pre-wrap">{goal.objective || <span className="text-slate-400">목표 미기재</span>}</div>
              <div className="mt-3 text-[11px] font-black uppercase tracking-wide text-slate-400">달성기준</div>
              <div className="mt-1"><CriteriaLines text={goal.criteria} /></div>
            </>}
          </div>
          {/* 노란 칸: 파트가 쓰는 곳 */}
          <div className="space-y-3 p-4">
            <label className="block text-[11px] font-black text-slate-600">실제결과 <span className="font-semibold text-slate-400">— 항목 이름 : n건 중 m건 (x%, 등급) 한 줄씩</span>
              <AutoGrowTextarea value={row.actual} onChange={(v) => onResult(goal.no, { actual: v })} className={`mt-1 ${inputClass}`} rows={3} placeholder={"예) 1주일 이내 확인 이행률 : 14건 중 11건 (79%, 미흡)"} />
            </label>
            <div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-black text-slate-600">종합판정 <span className="font-semibold text-slate-400">— 가장 나쁜 등급 하나</span>
                {suggested && suggested !== j && row.actual.trim() && <button type="button" onClick={() => onResult(goal.no, { judgment: suggested })} className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-700 hover:bg-blue-100">실제결과 기준 제안: {suggested} ← 적용</button>}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {OKR_JUDGMENTS.map((g) => <button key={g} type="button" title={`${JUDGMENT_INFO[g].when} → ${JUDGMENT_INFO[g].then}`} onClick={() => onResult(goal.no, { judgment: j === g ? "" : g })} className={`rounded-full border px-3 py-1 text-xs font-black transition ${j === g ? `${JUDGMENT_INFO[g].tone} ring-2 ring-offset-1 ring-slate-900/20` : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>{g}</button>)}
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-[11px] font-black text-slate-600">사유 <span className="font-semibold text-slate-400">— "○○○ 때문에, ○건을 못 했습니다"</span>{needReason && <span className="ml-1 text-rose-600">필요</span>}
                <AutoGrowTextarea value={row.reason} onChange={(v) => onResult(goal.no, { reason: v })} className={`mt-1 ${inputClass} ${needReason ? "border-rose-300" : ""}`} rows={2} />
              </label>
              <label className="block text-[11px] font-black text-slate-600">개선계획 <span className="font-semibold text-slate-400">— "다음 달부터 ○○○ 하겠습니다"</span>{needPlan && <span className="ml-1 text-rose-600">필요</span>}
                <AutoGrowTextarea value={row.plan} onChange={(v) => onResult(goal.no, { plan: v })} className={`mt-1 ${inputClass} ${needPlan ? "border-rose-300" : ""}`} rows={2} />
              </label>
            </div>
            <label className="block text-[11px] font-black text-slate-600">근거자료 <span className="font-semibold text-slate-400">— 항목 이름 : 실제 내용 (파일 이름만 쓰면 반려)</span>{needEvidence && <span className="ml-1 text-rose-600">'대상 0건'이라고 적기</span>}
              <AutoGrowTextarea value={row.evidence} onChange={(v) => onResult(goal.no, { evidence: v })} className={`mt-1 ${inputClass}`} rows={2} />
            </label>
          </div>
        </div>
      </section>;
    })}
  </div>;
}

// ── 통합집계 ──
function SummaryView({ cycle, reports, onFeedback }: { cycle: OkrCycle; reports: OkrReport[]; onFeedback: (no: number, memo: string) => void }) {
  const goals = cycle.goals;
  const teamsShown = OKR_TEAMS.filter((t) => t !== "E" || reports.some((r) => r.team === "E" && r.rows.length));
  const perTeam = teamsShown.map((t) => {
    const rep = reports.find((r) => r.team === t);
    const rows = goals.map((g) => resultRowFor(rep, g.no));
    return { team: t, rep, judged: rows.filter((r) => normalizeJudgment(r.judgment)).length, rate: achievementRate(rows), counts: judgmentCounts(rows) };
  });
  return <div className="space-y-4">
    <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {perTeam.map(({ team, rep, judged, rate, counts }) => <div key={team} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between"><div className="text-sm font-black text-slate-900">{teamName(team)}</div><div className={`text-[11px] font-black ${judged >= goals.length && goals.length ? "text-emerald-600" : "text-slate-400"}`}>{judged >= goals.length && goals.length ? "제출 완료" : `제출 ${judged}/${goals.length}`}</div></div>
        <div className="mt-2 flex items-end justify-between"><div className="text-2xl font-black tabular-nums text-slate-950">{rate === null ? "—" : `${rate}%`}<span className="ml-1 text-xs font-semibold text-slate-400">달성</span></div><div className="text-[10px] font-semibold text-slate-400">{rep?.header.leader ? `파트장 ${rep.header.leader}` : ""}{rep?.header.headcount ? ` · ${rep.header.headcount}명` : ""}</div></div>
        <div className="mt-2 flex flex-wrap gap-1">{OKR_JUDGMENTS.map((j) => counts[j] > 0 && <span key={j} className={`rounded-full border px-1.5 py-0 text-[10px] font-black ${JUDGMENT_INFO[j].tone}`}>{j} {counts[j]}</span>)}</div>
      </div>)}
    </section>
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4"><h3 className="text-base font-black text-slate-950">목표별 종합판정 · 팀장 피드백</h3><p className="mt-0.5 text-xs font-semibold text-slate-400">조치 필요 파트는 미흡·미착수 판정에서 자동으로 뽑힙니다. 피드백 칸은 팀장이 적는 곳(자동 저장).</p></div>
      <div className="divide-y divide-slate-100">
        {goals.map((goal) => {
          const pillar = splitPillar(goal.pillar);
          const actions = actionTeams(reports, goal.no);
          const memo = cycle.feedback?.[String(goal.no)]?.memo || "";
          return <div key={goal.no} className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,4fr)_minmax(0,3fr)_minmax(0,5fr)]">
            <div>
              <div className="flex flex-wrap items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] font-black text-white">{goal.no}</span>{pillar.num && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-black text-indigo-700">{pillar.num}</span>}<span className="text-[10px] font-bold text-slate-400">{pillar.name}</span></div>
              <div className="mt-1.5 text-[13px] font-bold leading-snug text-slate-800 whitespace-pre-wrap">{goal.objective}</div>
            </div>
            <div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
                {teamsShown.map((t) => { const row = resultRowFor(reports.find((r) => r.team === t), goal.no); return <div key={t} className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5 text-center"><div className="text-[10px] font-black text-slate-500">{t === "E" ? "CSS" : t}</div><div className="mt-0.5"><JudgmentBadge value={row.judgment} small /></div></div>; })}
              </div>
              <div className="mt-2 text-[11px] font-black text-slate-500">조치 필요 파트: {actions.length ? <span className="text-rose-600">{actions.map((t) => (t === "E" ? "CSS" : t)).join(", ")}</span> : <span className="text-slate-400">없음</span>}</div>
            </div>
            <label className="block text-[11px] font-black text-slate-600">미흡항목 피드백 & 다음 달 개선 방향
              <AutoGrowTextarea value={memo} onChange={(v) => onFeedback(goal.no, v)} className={`mt-1 ${inputClass}`} rows={2} placeholder={"1. 대상: ○파트 미흡\n2. 피드백: …\n3. 다음 달 개선 방향: …"} />
            </label>
          </div>;
        })}
        {goals.length === 0 && <div className="p-8 text-center text-sm font-bold text-slate-400">목표가 없습니다.</div>}
      </div>
    </section>
  </div>;
}

// ── 새 기간 ──
function NewCycleModal({ cycles, today, onClose, onCreate }: { cycles: OkrCycle[]; today: string; onClose: () => void; onCreate: (draft: OkrCycle) => Promise<void> }) {
  const [kind, setKind] = useState<"month" | "week">("month");
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month, setMonth] = useState(Number(today.slice(5, 7)));
  const weeks = useMemo(() => okrWeeksInMonth(year, month), [year, month]);
  const [weekNo, setWeekNo] = useState(() => okrWeeksInMonth(year, month).find((w) => w.start <= today && w.end >= today)?.weekNo || 1);
  const [source, setSource] = useState<string>("__auto__");
  const [busy, setBusy] = useState(false);
  const monthOfSame = cycles.find((c) => c.kind === "month" && c.year === year && c.month === month);
  const latestMonth = cycles.find((c) => c.kind === "month");
  const autoSource = kind === "week" ? monthOfSame || latestMonth : latestMonth;
  const resolvedSource = source === "__auto__" ? autoSource : source === "__blank__" ? undefined : cycles.find((c) => c.id === source);
  const week = weeks.find((w) => w.weekNo === weekNo) || weeks[0];
  const id = kind === "week" ? weekCycleId(year, month, week?.weekNo || 1) : monthCycleId(year, month);
  const exists = cycles.some((c) => c.id === id);
  const lastDay = new Date(year, month, 0).getDate();
  const draft: OkrCycle = {
    id, kind, year, month, week_no: kind === "week" ? week?.weekNo || 1 : null,
    start_date: kind === "week" ? week?.start || today : `${year}-${String(month).padStart(2, "0")}-01`,
    end_date: kind === "week" ? week?.end || today : `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    parent_id: kind === "week" ? monthOfSame?.id || null : null,
    title: "", goals: resolvedSource ? resolvedSource.goals.map((g) => ({ ...g })) : [], feedback: {},
  };
  draft.title = defaultCycleTitle(draft);
  const years = Array.from({ length: 3 }, (_, i) => Number(today.slice(0, 4)) - 1 + i);
  return <div className="fixed inset-0 z-[2500] flex items-end justify-center bg-black/50 p-3 sm:items-center" onClick={onClose}>
    <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
      <h3 className="text-lg font-black text-slate-950">새 OKR 기간</h3>
      <p className="mt-0.5 text-xs font-semibold text-slate-400">월간은 그 달 목표·파트별 결과·통합집계, 주간은 그 달 목표를 복사해 주차별 실행결과를 적습니다.</p>
      <div className="mt-4 grid grid-cols-2 gap-1 rounded-full bg-slate-100 p-1">{(["month", "week"] as const).map((k) => <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-full py-1.5 text-sm font-black transition ${kind === k ? "bg-slate-900 text-white" : "text-slate-500"}`}>{k === "month" ? "월간 OKR" : "주간 실행결과"}</button>)}</div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <PortalSelect width={110} value={String(year)} onChange={(v) => setYear(Number(v))} options={years.map((y) => ({ value: String(y), label: `${y}년` }))} />
        <PortalSelect width={100} value={String(month)} onChange={(v) => { setMonth(Number(v)); setWeekNo(1); }} options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}월` }))} />
        {kind === "week" && <PortalSelect width={200} value={String(week?.weekNo || 1)} onChange={(v) => setWeekNo(Number(v))} options={weeks.map((w) => ({ value: String(w.weekNo), label: `${w.weekNo}주차 ${w.start.slice(5).replace("-", "/")}~${w.end.slice(5).replace("-", "/")}` }))} />}
      </div>
      <label className="mt-3 block text-[11px] font-black text-slate-500">목표 가져오기
        <div className="mt-1"><PortalSelect width={320} value={source} onChange={setSource} options={[
          { value: "__auto__", label: autoSource ? `자동 — ${cycleLabel(autoSource)} 목표 ${autoSource.goals.length}개` : "자동 — 가져올 기간 없음(빈 목표)" },
          { value: "__blank__", label: "빈 목표로 시작(직접 입력)" },
          ...cycles.map((c) => ({ value: c.id, label: `${cycleLabel(c)} (${c.goals.length}개)`, group: c.kind === "month" ? "월간" : "주간" })),
        ]} /></div>
      </label>
      <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">{draft.title} · <span className="tabular-nums">{draft.start_date} ~ {draft.end_date}</span> · 목표 {draft.goals.length}개{exists && <span className="ml-2 font-black text-rose-600">이미 있는 기간입니다</span>}</div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-full border border-slate-200 px-4 py-2 text-sm font-black text-slate-600 hover:bg-slate-50">취소</button>
        <button type="button" disabled={busy || exists} onClick={async () => { setBusy(true); try { await onCreate(draft); } finally { setBusy(false); } }} className="rounded-full bg-slate-900 px-4 py-2 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-40">{busy ? "만드는 중…" : "만들기"}</button>
      </div>
    </div>
  </div>;
}

// ── 작성 가이드(엑셀 0.작성가이드 요약) ──
function GuidePanel() {
  return <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-700 shadow-sm">
    <h3 className="text-base font-black text-slate-950">OKR 실행결과 작성 가이드 — 처음 보는 사람도 5분이면 됩니다</h3>
    <div className="mt-3 grid gap-4 lg:grid-cols-2">
      <div className="space-y-2">
        <p><b>무엇을 하나요?</b> 우리 파트 탭 → 맨 위 제출 정보(파트장·작성자·제출일·인원수) → 목표마다 <b>노란 칸</b>(실제결과 / 종합판정 / 사유·개선계획 / 근거자료)만 채웁니다. 흰 칸(Pillar·병목·목표·달성기준)은 읽기만.</p>
        <p><b>실제결과</b>는 세 가지를 한 줄로: 얼마나 했는지(14건 중 11건) + 몇 %인지(79%) + 등급(미흡) → <code className="rounded bg-slate-100 px-1">1주일 이내 확인 이행률 : 14건 중 11건 (79%, 미흡)</code></p>
        <p><b>달성률</b> = 실제로 한 것 ÷ 해야 했던 것 × 100. <b>[건수형]</b>은 했으면 100%, 안 했으면 0% — 중간이 없습니다.</p>
        <p><b>종합판정</b>은 달성기준마다 나온 등급 중 <b>가장 나쁜 것 하나</b>. 실제결과에 등급을 적어 두면 화면이 제안해 줍니다.</p>
        <p><b>해당없음</b>은 할 대상이 처음부터 0건일 때만(예: 이 달 계약 종료 0건). 완료로 고르면 안 됩니다. 근거자료에 '대상 0건'이라고 씁니다.</p>
      </div>
      <div className="space-y-2">
        <table className="w-full text-xs"><thead><tr className="text-left text-[11px] font-black text-slate-400"><th className="py-1">등급</th><th>언제</th><th>더 써야 할 것</th></tr></thead><tbody>
          {OKR_JUDGMENTS.map((j) => <tr key={j} className="border-t border-slate-100"><td className="py-1.5"><JudgmentBadge value={j} /></td><td className="font-semibold">{JUDGMENT_INFO[j].when}</td><td className="text-slate-500">{JUDGMENT_INFO[j].then}</td></tr>)}
        </tbody></table>
        <p><b>사유</b>는 사람 탓이 아니라 방법 탓으로, 숫자를 넣어서: "카톡방에 요청만 올리고 캘린더에 확인 일정을 안 잡아서 3건은 7일이 지나서 확인했습니다." <b>개선계획</b>은 다음 달에 무엇을 바꿀지: "요청한 날 바로 캘린더에 7일 확인 일정을 등록하겠습니다." 숫자와 바꿀 것이 없으면 반려됩니다.</p>
        <p><b>근거자료</b>는 실제결과에 적은 항목 이름을 그대로 쓰고 실제 내용을: "개선대상 선정 : AS점검 변환기 / 추가개선점 : CS 전용 ERP로 업그레이드". 파일 이름만 쓰거나 실제결과를 되풀이하면 반려.</p>
      </div>
    </div>
  </section>;
}

