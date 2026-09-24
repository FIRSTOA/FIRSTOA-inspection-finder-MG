// OKR 화면 — 기록·성과 > OKR (2026-09-24)
// 엑셀 "CS팀_8월_OKR_실행결과" 워크북을 웹으로 옮겼다. 위: 기간(월간/주간) 선택, 가운데: 통합집계 / 파트별 탭.
//  - 파트 탭 = 엑셀 시트 한 장: 열 머리(No·Pillar·병목현상·목표·달성기준·실제결과·종합판정·사유·개선계획·근거자료)는 엑셀과 같고,
//    한 행에 목표 하나. 왼쪽 흰 칸은 읽기, 오른쪽 노란 칸에 쓴다. 화면은 단정하게 — 꾸밈 요소를 줄인다(2026-09-24 요청).
//  - 파트 안에 [파트 종합] + 팀원 이름 탭. 팀원은 자기 탭에 적고, 파트장은 [팀원 기록 모아 넣기]로 종합 칸을 채운다.
//    통합집계는 파트 종합 행만 읽는다(A~D 통계 = 팀원 기록의 합).
//  - 저장은 자동(0.7초 디바운스). 같은 칸을 두 사람이 동시에 고치면 나중 저장이 이긴다.
import { useEffect, useMemo, useRef, useState } from "react";
import PortalSelect from "./PortalSelect";
import { askConfirm } from "./confirmModal";
import { teamLabel, useAuthorBook } from "./authors";
import { teamForAuthor } from "./operations";
import {
  JUDGMENT_INFO, OKR_JUDGMENTS, OKR_TEAMS, achievementRate, actionMembers, actionTeams, cycleLabel, defaultCycleTitle, deleteOkrCycle, emptyGoal,
  emptyReport, emptyResultRow, findReport, getOkrReports, judgmentCounts, listOkrCycles, memberReports, mergeMemberActuals, monthCycleId,
  normalizeJudgment, okrWeeksInMonth, probeOkrSchema, renumberGoals, reportKey, resultRowFor, saveOkrCycle, saveOkrReport, splitPillar, weekCycleId, worstJudgment,
  worstOfJudgments, type OkrCycle, type OkrGoal, type OkrReport, type OkrResultRow, type OkrTeam,
} from "./okr";

type Tab = "all" | OkrTeam;
type SaveStatus = "idle" | "saving" | "saved" | "error";

const kstToday = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
const teamName = (team: string) => (team === "E" ? teamLabel("E") : `${team}파트`);
const teamShort = (team: string) => (team === "E" ? "CSS" : team);
const shortTime = (iso?: string) => (iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

function AutoGrowTextarea({ value, onChange, className = "", rows = 2, placeholder = "" }: { value: string; onChange: (v: string) => void; className?: string; rows?: number; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const el = ref.current; if (!el) return; el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }, [value]);
  return <textarea ref={ref} rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`resize-none overflow-hidden ${className}`} />;
}

// 노란 칸(쓰는 곳) / 흰 칸(목표 편집 때만)
const cellInput = "w-full rounded border border-amber-200/60 bg-amber-50/50 px-2 py-1.5 text-[12px] leading-snug text-slate-800 outline-none placeholder:text-slate-300 focus:border-amber-400 focus:bg-white";
const plainInput = "w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-[12px] leading-snug text-slate-800 outline-none focus:border-blue-400";
const headInput = "w-full rounded-lg border border-slate-200 bg-amber-50/50 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-400 focus:bg-white";

// 달성기준 줄 — "[건수형]" "[차월반영]" 꼬리표만 살짝 표시
function CriteriaLines({ text }: { text: string }) {
  const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return <div className="text-[11px] text-slate-300">—</div>;
  return <ul className="space-y-1">{lines.map((line, i) => {
    const parts = line.split(/(\[건수형\]|\[차월반영\])/g).filter(Boolean);
    return <li key={i} className="text-[12px] leading-snug text-slate-700">{parts.map((p, j) => p === "[건수형]" ? <span key={j} className="ml-1 rounded bg-blue-50 px-1 text-[10px] font-bold text-blue-600">건수형</span> : p === "[차월반영]" ? <span key={j} className="mr-1 rounded bg-violet-50 px-1 text-[10px] font-bold text-violet-600">차월반영</span> : <span key={j}>{p.replace(/^•\s*/, "• ")}</span>)}</li>;
  })}</ul>;
}

function JudgmentBadge({ value }: { value: string }) {
  const j = normalizeJudgment(value);
  if (!j) return <span className="inline-flex rounded border border-dashed border-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-300">미기재</span>;
  return <span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-bold ${JUDGMENT_INFO[j].tone}`}>{j}</span>;
}

export default function OkrHub({ author }: { author: string }) {
  const today = kstToday();
  const { book } = useAuthorBook();
  const myTeam = useMemo(() => { const t = teamForAuthor(author); return (OKR_TEAMS as readonly string[]).includes(t) ? (t as OkrTeam) : null; }, [author]);
  const [cycles, setCycles] = useState<OkrCycle[]>([]);
  const [cycleId, setCycleId] = useState("");
  const [cycle, setCycle] = useState<OkrCycle | null>(null);
  const [reports, setReports] = useState<OkrReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [needsUpgrade, setNeedsUpgrade] = useState(false); // okr_reports.member 열이 없는 옛 표
  useEffect(() => { void probeOkrSchema().then((ok) => setNeedsUpgrade(!ok)).catch(() => undefined); }, []);
  const [message, setMessage] = useState("");
  useEffect(() => { if (!message) return; const t = window.setTimeout(() => setMessage(""), 5000); return () => window.clearTimeout(t); }, [message]);
  const [tab, setTab] = useState<Tab>(myTeam || "all");
  const [member, setMember] = useState(myTeam ? author : ""); // '' = 파트 종합
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

  const rosterOf = (team: OkrTeam): string[] => book[team] || [];
  // 파트 탭을 바꾸면: 내가 그 파트 팀원이면 내 탭, 아니면 파트 종합
  const openTeam = (team: Tab) => { setTab(team); setMember(team !== "all" && rosterOf(team).includes(author) ? author : ""); };

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

  // 기간이 바뀌면 그 기간의 목표·피드백과 파트·팀원 결과를 읽는다.
  // cycles를 의존성에 넣지 않는다 — 기간 자동 저장 뒤 목록을 갱신할 때마다 결과를 다시 읽어 입력 중인 결과를 덮어쓰게 되므로.
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
        reportSavedRef.current = Object.fromEntries(rows.map((r) => [reportKey(r), JSON.stringify({ header: r.header, rows: r.rows })]));
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

  // 자동 저장 — 파트·팀원 결과(바뀐 것만)
  useEffect(() => {
    if (!cycle || loading || loadedCycleRef.current !== cycle.id) return;
    const dirty = reports.filter((r) => JSON.stringify({ header: r.header, rows: r.rows }) !== (reportSavedRef.current[reportKey(r)] || ""));
    if (!dirty.length) return;
    pendingReportsRef.current = dirty;
    setSaveStatus("saving");
    const timer = window.setTimeout(() => {
      pendingReportsRef.current = [];
      Promise.all(dirty.map((r) => saveOkrReport(r, author).then(() => { reportSavedRef.current[reportKey(r)] = JSON.stringify({ header: r.header, rows: r.rows }); })))
        .then(() => setSaveStatus("saved"))
        .catch((e) => { setSaveStatus("error"); setMessage((e as Error).message); });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [reports, cycle, author, loading]);

  const goals = cycle?.goals || [];
  const updateCycle = (patch: Partial<OkrCycle>) => setCycle((cur) => (cur ? { ...cur, ...patch } : cur));
  const updateGoal = (no: number, patch: Partial<OkrGoal>) => updateCycle({ goals: goals.map((g) => (g.no === no ? { ...g, ...patch } : g)) });
  const setFeedback = (no: number, memo: string) => updateCycle({ feedback: { ...(cycle?.feedback || {}), [String(no)]: { ...(cycle?.feedback?.[String(no)] || { memo: "" }), memo } } });
  const patchReport = (team: string, who: string, fn: (r: OkrReport) => OkrReport) => setReports((cur) => {
    const exists = cur.some((r) => r.team === team && (r.member || "") === who);
    const base = exists ? cur : [...cur, emptyReport(cycleId, team, who)];
    return base.map((r) => (r.team === team && (r.member || "") === who ? fn(r) : r));
  });
  const updateResult = (team: string, who: string, no: number, patch: Partial<OkrResultRow>) => patchReport(team, who, (r) => {
    const has = r.rows.some((x) => x.no === no);
    const rows = has ? r.rows.map((x) => (x.no === no ? { ...x, ...patch } : x)) : [...r.rows, { ...emptyResultRow(no), ...patch }];
    return { ...r, rows: rows.sort((a, b) => a.no - b.no) };
  });
  // 팀원들이 적은 실제결과를 파트 종합 칸으로 — 비어 있으면 넣고, 있으면 뒤에 덧붙인다. 종합판정이 비어 있으면 팀원 판정 중 가장 나쁜 것을 넣는다.
  const mergeMembers = async (team: OkrTeam, no: number) => {
    const members = memberReports(reports, team);
    const merged = mergeMemberActuals(members, no);
    if (!merged) { setMessage(`${no}번 목표에 팀원이 적은 실제결과가 아직 없어요.`); return; }
    const part = resultRowFor(findReport(reports, team, ""), no);
    if (part.actual.trim() && !(await askConfirm(`${no}번 종합 실제결과에 이미 내용이 있어요. 팀원 기록을 그 뒤에 덧붙일까요?`, { okLabel: "덧붙이기" }))) return;
    const judgment = part.judgment || worstOfJudgments(members.map((m) => resultRowFor(m, no).judgment));
    updateResult(team, "", no, { actual: part.actual.trim() ? `${part.actual.trimEnd()}\n${merged}` : merged, judgment });
  };

  const addGoal = () => updateCycle({ goals: renumberGoals([...goals, emptyGoal(goals.length + 1)]) });
  const removeGoal = async (goal: OkrGoal) => {
    const used = reports.filter((r) => { const row = resultRowFor(r, goal.no); return row.actual || row.judgment; }).map((r) => `${teamName(r.team)}${r.member ? ` ${r.member}` : ""}`);
    const ok = await askConfirm(`${goal.no}번 목표를 삭제할까요?${used.length ? `\n\n이미 결과를 적은 곳: ${used.join(", ")} — 그 결과도 함께 지워집니다.` : ""}\n뒤 번호는 앞으로 당겨집니다.`, { danger: true, okLabel: "삭제" });
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
  // 엑셀 워크북 데이터(8월 A~D 결과·피드백, 9월 목표, 9월 2주차 C) — 없는 기간·파트만 넣는다. 데이터는 동적 import라 평소 번들엔 안 실린다.
  const [seeding, setSeeding] = useState(false);
  const importSeed = async () => {
    const ok = await askConfirm("엑셀 'CS팀 8월 OKR 통합피드백' 데이터를 넣을까요?\n8월(A~D파트 결과·팀장 피드백) · 9월 목표 · 9월 2주차 C파트 결과가 들어갑니다. 이미 있는 기간·파트는 건너뜁니다.", { okLabel: "불러오기" });
    if (!ok) return;
    setSeeding(true);
    try {
      const { OKR_SEED_CYCLES, OKR_SEED_REPORTS } = await import("./okrSeed");
      const existing = new Set(cycles.map((c) => c.id));
      let added = 0;
      for (const c of OKR_SEED_CYCLES) { if (existing.has(c.id)) continue; await saveOkrCycle(c, author); added += 1; }
      const have = new Set<string>();
      for (const id of OKR_SEED_CYCLES.map((c) => c.id)) { if (existing.has(id)) (await getOkrReports(id)).forEach((r) => have.add(`${r.cycle_id}|${reportKey(r)}`)); }
      let addedReports = 0;
      for (const r of OKR_SEED_REPORTS) { if (have.has(`${r.cycle_id}|${reportKey(r)}`)) continue; await saveOkrReport(r, author); addedReports += 1; }
      await reloadCycles("2026-08");
      setTab("all");
      setMessage(`엑셀 데이터를 넣었어요 — 기간 ${added}개 · 파트 결과 ${addedReports}개${added + addedReports === 0 ? " (이미 다 있어서 새로 넣은 건 없음)" : ""}`);
    } catch (e) { setMessage((e as Error).message); }
    finally { setSeeding(false); }
  };
  const removeCycle = async () => {
    if (!cycle) return;
    const filled = reports.filter((r) => r.rows.some((x) => x.actual || x.judgment)).length;
    const ok = await askConfirm(`${cycleLabel(cycle)} OKR 기간을 통째로 삭제할까요?\n목표 ${goals.length}개와 결과를 적은 파트·팀원 ${filled}건이 함께 지워지며 되돌릴 수 없습니다.`, { danger: true, okLabel: "기간 삭제" });
    if (!ok) return;
    try { await deleteOkrCycle(cycle.id); setCycleId(""); await reloadCycles(); setMessage("삭제했어요"); } catch (e) { setMessage((e as Error).message); }
  };

  const cycleOptions = useMemo(() => cycles.map((c) => ({ value: c.id, label: `${cycleLabel(c)}${c.title ? ` · ${c.title.replace(/^CS팀\s*/, "")}` : ""}`, group: c.kind === "month" ? "월간" : "주간" })), [cycles]);
  const tabs: Array<[Tab, string]> = [["all", "통합집계"], ...OKR_TEAMS.map((t) => [t, teamName(t)] as [Tab, string])];

  if (!author) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm font-semibold text-amber-800">FIELD에서 작성자를 먼저 선택해 주세요.</div>;

  return <div className="space-y-3 pb-16">

    {tableMissing && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><b>OKR 표가 아직 없습니다.</b> Supabase SQL Editor에서 <code className="rounded bg-white px-1">supabase/okr.sql</code>(표 만들기)을 한 번 실행한 뒤 이 화면을 다시 열어 주세요.</div>}
    {needsUpgrade && !tableMissing && <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"><b>OKR 표를 한 번 더 올려야 합니다.</b> 팀원별 기록 칸(member)이 없는 예전 표라 저장이 안 됩니다. Supabase SQL Editor에서 <code className="rounded bg-white px-1">supabase/okr.sql</code>을 다시 실행하면(기존 내용은 그대로) 바로 됩니다.</div>}
    {message && !tableMissing && <div className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white">{message}</div>}
    {guideOpen && <GuidePanel />}

    {cycle && <>
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
          <PortalSelect width={280} value={cycleId} onChange={setCycleId} options={cycleOptions} />
          {editGoals && <input value={cycle.title} onChange={(e) => updateCycle({ title: e.target.value })} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-black text-slate-950 outline-none lg:w-[360px]" placeholder={defaultCycleTitle(cycle)} />}
          <div className="ml-auto flex items-center gap-1 text-xs font-bold text-slate-500">
            <span className="mr-2 text-[11px] font-semibold text-slate-400">{saveStatus === "saving" ? "저장 중…" : saveStatus === "error" ? <span className="text-rose-600">저장 실패</span> : ""}</span>
            <button type="button" onClick={() => setNewOpen(true)} className="rounded-lg px-2.5 py-1.5 hover:bg-slate-100">＋ 새 기간</button>
            <button type="button" onClick={() => setEditGoals((v) => !v)} className={`rounded-lg px-2.5 py-1.5 ${editGoals ? "bg-amber-200 text-slate-900" : "hover:bg-slate-100"}`}>{editGoals ? "✓ 목표 편집 끝" : "목표 편집"}</button>
            <button type="button" onClick={() => setGuideOpen((v) => !v)} className={`rounded-lg px-2.5 py-1.5 ${guideOpen ? "bg-slate-200 text-slate-900" : "hover:bg-slate-100"}`}>가이드</button>
          </div>
        </div>
        <div className="mt-3 flex gap-1 overflow-x-auto border-b border-slate-100 px-3">
          {tabs.map(([key, label]) => {
            const rep = key === "all" ? undefined : findReport(reports, key, "");
            const judged = rep ? rep.rows.filter((x) => normalizeJudgment(x.judgment)).length : 0;
            return <button key={key} type="button" onClick={() => openTeam(key)} className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-black transition ${tab === key ? "border-slate-900 text-slate-950" : "border-transparent text-slate-400 hover:text-slate-700"}`}>
              {label}{key !== "all" && goals.length > 0 && <span className={`rounded px-1 text-[10px] tabular-nums ${judged >= goals.length ? "bg-emerald-100 text-emerald-700" : judged ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-400"}`}>{judged}/{goals.length}</span>}
            </button>;
          })}
        </div>
        {editGoals && <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-800">
          <span>✎ 목표 편집 중 — 흰 칸(Pillar·병목현상·목표·달성기준)을 고칩니다. 파트가 쓰는 칸은 그대로 있어요.</span>
          <button type="button" onClick={addGoal} className="rounded-full border border-amber-300 bg-white px-2.5 py-1 text-xs font-black text-amber-800 hover:bg-amber-100">＋ 목표 추가</button>
          {cycles.filter((c) => c.id !== cycle.id).length > 0 && <PortalSelect width={220} value="" onChange={(v) => v && importGoalsFrom(v)} options={[{ value: "", label: "다른 기간에서 목표 가져오기…" }, ...cycles.filter((c) => c.id !== cycle.id).map((c) => ({ value: c.id, label: `${cycleLabel(c)} (${c.goals.length}개)`, group: c.kind === "month" ? "월간" : "주간" }))]} />}
          <button type="button" disabled={seeding} onClick={importSeed} className="rounded-full border border-amber-300 bg-white px-2.5 py-1 text-xs font-black text-amber-800 hover:bg-amber-100 disabled:opacity-50">{seeding ? "넣는 중…" : "엑셀 데이터 불러오기"}</button>
          <button type="button" onClick={removeCycle} className="ml-auto rounded-full border border-rose-200 bg-white px-2.5 py-1 text-xs font-black text-rose-600 hover:bg-rose-50">이 기간 삭제</button>
        </div>}
      </section>

      {loading ? <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm font-bold text-slate-400">불러오는 중…</div>
        : tab === "all"
          ? <SummaryView cycle={cycle} reports={reports} onFeedback={setFeedback} />
          : <TeamView team={tab} cycle={cycle} reports={reports} member={member} onMember={setMember} roster={rosterOf(tab)} author={author} editGoals={editGoals}
              onHeader={(patch) => patchReport(tab, member, (r) => ({ ...r, header: { ...r.header, ...patch } }))}
              onResult={(no, patch) => updateResult(tab, member, no, patch)}
              onGoal={updateGoal} onRemoveGoal={removeGoal} onMerge={(no) => void mergeMembers(tab, no)} />}
    </>}

    {!cycle && !loading && !tableMissing && <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
      <div className="text-sm font-bold text-slate-500">아직 OKR 기간이 없습니다.</div>
      <button type="button" onClick={() => setNewOpen(true)} className="mt-4 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-black text-white hover:bg-slate-800">＋ 이번 달 OKR 기간 만들기</button>
      <div className="mt-3 text-xs font-semibold text-slate-400"><button type="button" onClick={() => setGuideOpen((v) => !v)} className="font-black text-slate-600 underline">작성 가이드</button> · 엑셀로 하던 8월 OKR을 참고용으로 넣으려면 → <button type="button" disabled={seeding} onClick={importSeed} className="font-black text-slate-600 underline disabled:opacity-50">{seeding ? "넣는 중…" : "엑셀 데이터 불러오기"}</button></div>
    </div>}

    {newOpen && <NewCycleModal cycles={cycles} today={today} onClose={() => setNewOpen(false)} onCreate={async (draft) => {
      if (cycles.some((c) => c.id === draft.id)) { setMessage(`${cycleLabel(draft)} 기간은 이미 있어요 — 위 목록에서 고르세요.`); setNewOpen(false); setCycleId(draft.id); return; }
      try { await saveOkrCycle(draft, author); setNewOpen(false); setEditGoals(draft.goals.length === 0); await reloadCycles(draft.id); openTeam(myTeam || "all"); }
      catch (e) { setMessage((e as Error).message); }
    }} />}
  </div>;
}

// ── 파트 시트: 한 행에 목표 하나, 열 머리는 엑셀과 같게 ──
const COLS: Array<[string, number, "read" | "write"]> = [
  ["No", 40, "read"], ["Pillar", 92, "read"], ["병목현상", 92, "read"], ["목표", 220, "read"], ["달성기준", 250, "read"],
  ["실제결과", 290, "write"], ["종합판정", 112, "write"], ["사유", 200, "write"], ["개선계획", 200, "write"], ["근거자료", 200, "write"],
];
const TABLE_MIN = COLS.reduce((n, [, w]) => n + w, 0);

function TeamView({ team, cycle, reports, member, onMember, roster, author, editGoals, onHeader, onResult, onGoal, onRemoveGoal, onMerge }: {
  team: OkrTeam; cycle: OkrCycle; reports: OkrReport[]; member: string; onMember: (m: string) => void; roster: string[]; author: string; editGoals: boolean;
  onHeader: (patch: Partial<OkrReport["header"]>) => void; onResult: (no: number, patch: Partial<OkrResultRow>) => void; onGoal: (no: number, patch: Partial<OkrGoal>) => void; onRemoveGoal: (goal: OkrGoal) => void; onMerge: (no: number) => void;
}) {
  const goals = cycle.goals;
  const partReport = findReport(reports, team, "") || emptyReport(cycle.id, team, "");
  const members = memberReports(reports, team);
  const memberNames = useMemo(() => { const seen = new Set<string>(); return [...roster, ...members.map((m) => m.member)].filter((n) => n && !seen.has(n) && seen.add(n)); }, [roster, members]);
  const current = member ? (findReport(reports, team, member) || emptyReport(cycle.id, team, member)) : partReport;
  const rows = goals.map((g) => resultRowFor(current, g.no));
  const counts = judgmentCounts(rows);
  const rate = achievementRate(rows);
  const judged = rows.filter((r) => normalizeJudgment(r.judgment)).length;
  const [openMembers, setOpenMembers] = useState<Record<number, boolean>>({});
  const judgedOf = (r: OkrReport | undefined) => (r ? goals.filter((g) => normalizeJudgment(resultRowFor(r, g.no).judgment)).length : 0);
  const addOtherName = () => {
    const name = window.prompt("이 파트에 기록할 이름(관리 › 인원 명단에 없는 사람)");
    if (name && name.trim()) onMember(name.trim());
  };

  return <div className="space-y-3">
    {/* 머리: 파트 종합 / 팀원 탭 + 제출 정보 */}
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-4 py-2.5">
        <button type="button" onClick={() => onMember("")} className={`rounded-full px-3 py-1 text-xs font-black transition ${!member ? "bg-slate-900 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>파트 종합 <span className="tabular-nums opacity-70">{judgedOf(partReport)}/{goals.length}</span></button>
        <span className="mx-1 h-4 w-px bg-slate-200" />
        {memberNames.map((name) => { const r = findReport(reports, team, name); const n = judgedOf(r); return <button key={name} type="button" onClick={() => onMember(name)} className={`rounded-full px-3 py-1 text-xs font-black transition ${member === name ? "bg-blue-600 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{name}{name === author && <span className="ml-1 text-[10px] opacity-70">나</span>} <span className={`tabular-nums ${member === name ? "opacity-80" : n >= goals.length && goals.length ? "text-emerald-600" : n ? "text-amber-600" : "text-slate-300"}`}>{n}/{goals.length}</span></button>; })}
        {!memberNames.length && <span className="text-[11px] font-semibold text-slate-400">관리 › 인원 명단에 {teamName(team)} 인원을 넣으면 이름 탭이 생깁니다</span>}
        <button type="button" onClick={addOtherName} className="rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-[11px] font-bold text-slate-400 hover:bg-slate-50">＋ 다른 이름</button>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {OKR_JUDGMENTS.map((j) => counts[j] > 0 && <span key={j} className={`rounded border px-1.5 py-0.5 text-[11px] font-bold ${JUDGMENT_INFO[j].tone}`}>{j} {counts[j]}</span>)}
          <span className="rounded bg-slate-900 px-2 py-0.5 text-[11px] font-black text-white tabular-nums">{judged}/{goals.length}{rate !== null && ` · ${rate}%`}</span>
        </div>
      </div>
      <div className="px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-base font-black text-slate-950">{member ? `${teamName(team)} · ${member}` : `${teamName(team)} 종합`}</h3>
          <span className="text-[11px] font-semibold text-slate-400">{member ? "내 기록 — 파트장이 종합에서 모아 씁니다" : "통합집계에 올라가는 행 — 팀원 기록은 No 아래 👥로 펼쳐 모아 넣습니다"}{current.updated_at && ` · 마지막 저장 ${shortTime(current.updated_at)}${current.updated_by ? ` ${current.updated_by}` : ""}`}</span>
        </div>
        {!member && <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {([["leader", "파트장(부파트장)", "text"], ["author", "작성자", "text"], ["submitted", "제출일", "date"], ["headcount", "파트 인원수", "text"]] as Array<[keyof OkrReport["header"], string, string]>).map(([key, label, type]) => <label key={key} className="block text-[11px] font-black text-slate-500">{label}
            <input type={type} value={current.header[key]} onChange={(e) => onHeader({ [key]: e.target.value })} className={`mt-1 ${headInput}`} placeholder={key === "headcount" ? `${memberNames.length || ""}` : ""} />
          </label>)}
        </div>}
      </div>
    </section>

    {goals.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm font-bold text-slate-400">이 기간에는 아직 목표가 없어요. 위 [목표 편집]에서 추가하거나 다른 기간에서 가져오세요.</div>
      : <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="table-fixed border-collapse text-left" style={{ minWidth: TABLE_MIN, width: "100%" }}>
          <colgroup>{COLS.map(([label, w]) => <col key={label} style={{ width: w }} />)}</colgroup>
          <thead className="sticky top-0 z-10 text-[11px] font-black">
            <tr>{COLS.map(([label, , mode]) => <th key={label} className={`border-b border-slate-200 px-2 py-2 ${mode === "write" ? "bg-amber-100/80 text-amber-900" : "bg-slate-100 text-slate-500"}`}>{label}</th>)}</tr>
          </thead>
          <tbody className="align-top">
            {goals.map((goal) => {
              const row = resultRowFor(current, goal.no);
              const j = normalizeJudgment(row.judgment);
              const suggested = worstJudgment(row.actual);
              const pillar = splitPillar(goal.pillar);
              const needReason = (j === "부분달성" || j === "미흡" || j === "미착수") && !row.reason.trim();
              const needPlan = j === "미흡" && !row.plan.trim();
              const memberEntries = !member ? members.map((m) => ({ name: m.member, row: resultRowFor(m, goal.no) })).filter((x) => x.row.actual.trim() || x.row.judgment) : [];
              const open = !!openMembers[goal.no];
              return <FragmentRows key={goal.no}>
                <tr className="border-b border-slate-100">
                  <td className="px-2 py-2 text-center">
                    <div className="text-sm font-black text-slate-800">{goal.no}</div>
                    {editGoals && <button type="button" onClick={() => onRemoveGoal(goal)} className="mt-1 text-[10px] font-bold text-rose-500 hover:underline">삭제</button>}
                    {!member && !editGoals && <button type="button" onClick={() => setOpenMembers((cur) => ({ ...cur, [goal.no]: !open }))} title="팀원 기록 보기" className={`mt-1 rounded px-1 py-0.5 text-[10px] font-bold ${memberEntries.length ? "bg-blue-50 text-blue-700 hover:bg-blue-100" : "text-slate-300"}`}>👥{memberEntries.length}</button>}
                  </td>
                  <td className="px-2 py-2">{editGoals ? <input value={goal.pillar} onChange={(e) => onGoal(goal.no, { pillar: e.target.value })} className={plainInput} placeholder="Pillar 1. AI · 효율성" />
                    : <div className="text-[11px] leading-snug text-slate-600">{pillar.num && <div className="font-black text-slate-800">{pillar.num}</div>}{pillar.name}</div>}</td>
                  <td className="px-2 py-2">{editGoals ? <input value={goal.bottleneck} onChange={(e) => onGoal(goal.no, { bottleneck: e.target.value })} className={plainInput} placeholder="병목현상 1" />
                    : <div className="whitespace-pre-wrap text-[11px] leading-snug text-slate-600">{goal.bottleneck}</div>}</td>
                  <td className="px-2 py-2">{editGoals ? <AutoGrowTextarea value={goal.objective} onChange={(v) => onGoal(goal.no, { objective: v })} className={plainInput} rows={3} /> : <div className="whitespace-pre-wrap text-[12px] font-bold leading-snug text-slate-900">{goal.objective}</div>}</td>
                  <td className="px-2 py-2">{editGoals ? <AutoGrowTextarea value={goal.criteria} onChange={(v) => onGoal(goal.no, { criteria: v })} className={`font-mono ${plainInput}`} rows={4} placeholder={"• 항목: 1건 이상  [건수형]\n• 이행률: 100%"} /> : <CriteriaLines text={goal.criteria} />}</td>
                  <td className="bg-amber-50/30 px-2 py-2">
                    <AutoGrowTextarea value={row.actual} onChange={(v) => onResult(goal.no, { actual: v })} className={cellInput} rows={3} placeholder="항목 : 14건 중 11건 (79%, 미흡)" />
                    {!member && memberEntries.length > 0 && <button type="button" onClick={() => onMerge(goal.no)} className="mt-1 text-[10px] font-bold text-blue-600 hover:underline">👥 팀원 기록 모아 넣기</button>}
                  </td>
                  <td className="bg-amber-50/30 px-2 py-2">
                    <select value={j} onChange={(e) => onResult(goal.no, { judgment: e.target.value })} className={`w-full rounded border px-1.5 py-1.5 text-[12px] font-bold outline-none ${j ? JUDGMENT_INFO[j].tone : "border-amber-200/60 bg-amber-50/50 text-slate-400"}`}>
                      <option value="">선택</option>
                      {OKR_JUDGMENTS.map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                    {suggested && suggested !== j && row.actual.trim() && <button type="button" onClick={() => onResult(goal.no, { judgment: suggested })} className="mt-1 w-full rounded border border-blue-200 bg-blue-50 px-1 py-0.5 text-[10px] font-bold text-blue-700 hover:bg-blue-100">{suggested} 적용</button>}
                  </td>
                  <td className="bg-amber-50/30 px-2 py-2"><AutoGrowTextarea value={row.reason} onChange={(v) => onResult(goal.no, { reason: v })} className={`${cellInput} ${needReason ? "border-rose-300" : ""}`} rows={3} />{needReason && <div className="mt-0.5 text-[10px] font-bold text-rose-500">사유 필요</div>}</td>
                  <td className="bg-amber-50/30 px-2 py-2"><AutoGrowTextarea value={row.plan} onChange={(v) => onResult(goal.no, { plan: v })} className={`${cellInput} ${needPlan ? "border-rose-300" : ""}`} rows={3} />{needPlan && <div className="mt-0.5 text-[10px] font-bold text-rose-500">개선계획 필요</div>}</td>
                  <td className="bg-amber-50/30 px-2 py-2"><AutoGrowTextarea value={row.evidence} onChange={(v) => onResult(goal.no, { evidence: v })} className={cellInput} rows={3} /></td>
                </tr>
                {open && !member && <tr className="border-b border-slate-100 bg-blue-50/30">
                  <td className="px-2 py-2" />
                  <td colSpan={9} className="px-2 py-2">
                    <div className="mb-1.5 flex items-center gap-2 text-[11px] font-black text-blue-800">👥 {goal.no}번 팀원 기록 {memberEntries.length}명{memberEntries.length > 0 && <button type="button" onClick={() => onMerge(goal.no)} className="rounded border border-blue-200 bg-white px-2 py-0.5 text-[10px] font-bold text-blue-700 hover:bg-blue-100">종합 실제결과에 모아 넣기</button>}</div>
                    {memberEntries.length === 0 ? <div className="text-[11px] font-semibold text-slate-400">아직 아무도 적지 않았어요. 팀원은 위 이름 탭에서 자기 기록을 씁니다.</div>
                      : <table className="w-full table-fixed border-collapse text-[11px]"><colgroup><col style={{ width: 90 }} /><col style={{ width: "34%" }} /><col style={{ width: 80 }} /><col /><col /><col /></colgroup>
                        <thead><tr className="text-[10px] font-black text-slate-400"><th className="px-1.5 py-1 text-left">이름</th><th className="px-1.5 py-1 text-left">실제결과</th><th className="px-1.5 py-1 text-left">종합판정</th><th className="px-1.5 py-1 text-left">사유</th><th className="px-1.5 py-1 text-left">개선계획</th><th className="px-1.5 py-1 text-left">근거자료</th></tr></thead>
                        <tbody className="align-top">{memberEntries.map((x) => <tr key={x.name} className="border-t border-blue-100"><td className="px-1.5 py-1.5 font-black text-slate-800"><button type="button" onClick={() => onMember(x.name)} className="hover:underline">{x.name}</button></td><td className="whitespace-pre-wrap px-1.5 py-1.5 text-slate-700">{x.row.actual}</td><td className="px-1.5 py-1.5"><JudgmentBadge value={x.row.judgment} /></td><td className="whitespace-pre-wrap px-1.5 py-1.5 text-slate-600">{x.row.reason}</td><td className="whitespace-pre-wrap px-1.5 py-1.5 text-slate-600">{x.row.plan}</td><td className="whitespace-pre-wrap px-1.5 py-1.5 text-slate-600">{x.row.evidence}</td></tr>)}</tbody>
                      </table>}
                  </td>
                </tr>}
              </FragmentRows>;
            })}
          </tbody>
        </table>
      </section>}
  </div>;
}

// tbody 안에서 행 두 줄(목표 행 + 팀원 펼침 행)을 묶는 용도
function FragmentRows({ children }: { children: React.ReactNode }) { return <>{children}</>; }

// ── 통합집계: 엑셀 '1.통합집계' 시트와 같은 열(No · Pillar · 목표 · 파트별 종합판정 · 조치 필요 파트 · 피드백) ──
function SummaryView({ cycle, reports, onFeedback }: { cycle: OkrCycle; reports: OkrReport[]; onFeedback: (no: number, memo: string) => void }) {
  const goals = cycle.goals;
  const partRows = reports.filter((r) => !r.member);
  const teamsShown = OKR_TEAMS.filter((t) => t !== "E" || reports.some((r) => r.team === "E" && r.rows.length));
  const perTeam = teamsShown.map((t) => {
    const rep = partRows.find((r) => r.team === t);
    const rows = goals.map((g) => resultRowFor(rep, g.no));
    const ms = memberReports(reports, t);
    return { team: t, rep, judged: rows.filter((r) => normalizeJudgment(r.judgment)).length, rate: achievementRate(rows), counts: judgmentCounts(rows), members: ms.map((m) => ({ name: m.member, judged: goals.filter((g) => normalizeJudgment(resultRowFor(m, g.no).judgment)).length })) };
  });
  return <div className="space-y-3">
    <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {perTeam.map(({ team, rep, judged, rate, counts, members }) => <div key={team} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between"><div className="text-sm font-black text-slate-900">{teamName(team)}</div><div className={`text-[11px] font-black ${judged >= goals.length && goals.length ? "text-emerald-600" : "text-slate-400"}`}>{judged >= goals.length && goals.length ? "제출 완료" : `${judged}/${goals.length}`}</div></div>
        <div className="mt-1.5 flex items-end justify-between"><div className="text-2xl font-black tabular-nums text-slate-950">{rate === null ? "—" : `${rate}%`}<span className="ml-1 text-xs font-semibold text-slate-400">달성</span></div><div className="text-right text-[10px] font-semibold text-slate-400">{rep?.header.leader ? `파트장 ${rep.header.leader}` : ""}{rep?.header.headcount ? ` · ${rep.header.headcount}명` : ""}</div></div>
        <div className="mt-2 flex flex-wrap gap-1">{OKR_JUDGMENTS.map((j) => counts[j] > 0 && <span key={j} className={`rounded border px-1.5 py-0 text-[10px] font-bold ${JUDGMENT_INFO[j].tone}`}>{j} {counts[j]}</span>)}</div>
        {members.length > 0 && <div className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5 border-t border-slate-100 pt-2 text-[10px] font-semibold text-slate-500">{members.map((m) => <span key={m.name}>{m.name} <span className={`tabular-nums ${m.judged >= goals.length && goals.length ? "text-emerald-600" : m.judged ? "text-amber-600" : "text-slate-300"}`}>{m.judged}/{goals.length}</span></span>)}</div>}
      </div>)}
    </section>
    <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full table-fixed border-collapse text-left" style={{ minWidth: 980 }}>
        <colgroup><col style={{ width: 40 }} /><col style={{ width: 100 }} /><col style={{ width: 260 }} />{teamsShown.map((t) => <col key={t} style={{ width: 84 }} />)}<col style={{ width: 120 }} /><col /></colgroup>
        <thead className="text-[11px] font-black"><tr><th className="bg-slate-100 px-2 py-2 text-slate-500">No</th><th className="bg-slate-100 px-2 py-2 text-slate-500">Pillar</th><th className="bg-slate-100 px-2 py-2 text-slate-500">목표</th>{teamsShown.map((t) => <th key={t} className="bg-slate-100 px-2 py-2 text-center text-slate-500">{teamName(t)}</th>)}<th className="bg-slate-100 px-2 py-2 text-slate-500">조치 필요 파트</th><th className="bg-amber-100/80 px-2 py-2 text-amber-900">미흡항목 피드백 & 다음 달 개선 방향</th></tr></thead>
        <tbody className="align-top">
          {goals.map((goal) => {
            const pillar = splitPillar(goal.pillar);
            const actions = actionTeams(reports, goal.no);
            const who = actionMembers(reports, goal.no);
            const memo = cycle.feedback?.[String(goal.no)]?.memo || "";
            return <tr key={goal.no} className="border-t border-slate-100">
              <td className="px-2 py-2 text-center text-sm font-black text-slate-800">{goal.no}</td>
              <td className="px-2 py-2 text-[11px] leading-snug text-slate-600">{pillar.num && <div className="font-black text-slate-800">{pillar.num}</div>}{pillar.name}</td>
              <td className="whitespace-pre-wrap px-2 py-2 text-[12px] font-bold leading-snug text-slate-800">{goal.objective}</td>
              {teamsShown.map((t) => <td key={t} className="px-1 py-2 text-center"><JudgmentBadge value={resultRowFor(partRows.find((r) => r.team === t), goal.no).judgment} /></td>)}
              <td className="px-2 py-2 text-[11px] leading-snug">{actions.length ? actions.map((t) => <div key={t}><span className="font-black text-rose-600">{teamShort(t)}</span>{who[t]?.length ? <span className="text-slate-500"> · {who[t].join(", ")}</span> : null}</div>) : <span className="text-slate-300">—</span>}</td>
              <td className="bg-amber-50/30 px-2 py-2"><AutoGrowTextarea value={memo} onChange={(v) => onFeedback(goal.no, v)} className={cellInput} rows={2} /></td>
            </tr>;
          })}
          {goals.length === 0 && <tr><td colSpan={5 + teamsShown.length} className="p-8 text-center text-sm font-bold text-slate-400">목표가 없습니다.</td></tr>}
        </tbody>
      </table>
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
        <p><b>누가 어디에?</b> 팀원은 자기 파트 탭 → 자기 이름 탭에 씁니다. 파트장은 [파트 종합]에서 [팀원 기록 모아 넣기]로 합쳐 파트 결과를 만들고 제출 정보를 채웁니다. 통합집계는 파트 종합만 봅니다.</p>
        <p><b>무엇을?</b> 한 행이 목표 하나. 왼쪽 흰 칸(Pillar·병목현상·목표·달성기준)은 읽기만, 오른쪽 <b>노란 칸</b>(실제결과 / 종합판정 / 사유 / 개선계획 / 근거자료)에 씁니다.</p>
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
