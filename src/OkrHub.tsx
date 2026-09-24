// OKR 화면 — 기록·성과 > OKR (2026-09-24)
// 엑셀 "CS팀_8월_OKR_실행결과" 워크북을 웹으로 옮겼다. 다른 탭과 같은 짙은 상단 바에 연도 + 1~12월만 두고, 달을 고르면 그 달 OKR이 열린다
// (없으면 지난달 목표를 복사한 초안 — 무언가 적는 순간 저장).
//  - 구조: Pillar 3개(AI·효율성·비용절감 / 매출증대·안정 / 나의 성장·소통) × 병목현상 1·2·3 = 목표 9개. 목표·달성기준은 팀장·파트장이 정하고 팀원 모두 같다.
//  - 파트 탭(A~D) = 엑셀 시트 한 장. 열 머리는 엑셀과 같고 한 행에 목표 하나, 격자 셀. 팀원은 실제결과·종합판정·사유·개선계획·근거자료만 쓴다.
//    완료·해당없음이 아니면 사유·개선계획이 필수(빈 칸이 붉게), 미흡·미착수 행은 왼쪽 띠로 바로 보인다.
//  - 파트 안에 [파트 종합] + 팀원 박스. 팀원은 자기 박스에서 적고, 파트장은 종합에서 팀원 기록을 모아 넣는다. 통계·통합집계는 파트 종합 행 기준.
//  - AI 보조(엣지 okr-assist): ✨정리(메모 → 양식) · ✨합치기(팀원 → 종합, 건수 합산) · ✨초안(파트 결과 → 팀장 피드백). 숫자는 만들지 않는다.
//  - 디자인 원칙(2026-09-24 사용자): 색은 판정 등급과 노란 입력칸에만. 나머지는 회색. 화면마다 "뭘 하면 되는지" 한 줄.
//  - 저장은 자동(0.7초 디바운스). 같은 칸을 두 사람이 동시에 고치면 나중 저장이 이긴다.
import { useEffect, useMemo, useRef, useState } from "react";
import PortalSelect from "./PortalSelect";
import { askConfirm } from "./confirmModal";
import { useAuthorBook } from "./authors";
import { teamForAuthor } from "./operations";
import {
  JUDGMENT_INFO, OKR_JUDGMENTS, OKR_PILLARS, OKR_TEAMS, achievementRate, actionMembers, actionTeams, bottleneckLabel, cycleLabel, defaultCycleTitle,
  defaultGoalTemplate, emptyGoal, emptyReport, emptyResultRow, findReport, getOkrReports, isAlert, listOkrCycles, memberReports,
  mergeMemberActuals, monthCycleId, needsReasonPlan, normalizeJudgment, okrAssist, pillarIndex, pillarLabel, probeOkrSchema, renumberGoals, reportKey,
  resultRowFor, saveOkrCycle, saveOkrReport, sortGoalsByPillar, worstJudgment, worstOfJudgments,
  type OkrCycle, type OkrGoal, type OkrReport, type OkrResultRow, type OkrTeam,
} from "./okr";

type Tab = "all" | OkrTeam;
type SaveStatus = "idle" | "saving" | "saved" | "error";

const kstToday = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
const teamName = (team: string) => `${team}파트`;
const shortTime = (iso?: string) => (iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const pad = (n: number) => String(n).padStart(2, "0");
const sig = (c: OkrCycle) => JSON.stringify({ goals: c.goals, feedback: c.feedback, title: c.title });

// 셀 안에 꽉 차는 입력칸 — 테두리·둥근 모서리 없이 엑셀 셀처럼
function CellArea({ value, onChange, rows = 2, placeholder = "", className = "" }: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; className?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const el = ref.current; if (!el) return; el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }, [value]);
  return <textarea ref={ref} rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`block w-full resize-none overflow-hidden bg-transparent px-2 py-1.5 text-[12px] leading-snug text-slate-800 outline-none placeholder:text-slate-300 ${className}`} />;
}

const TD = "border border-slate-200 align-top";
const TD_READ = `${TD} px-2 py-1.5`;
const TD_WRITE = `${TD} p-0 bg-[#FFFBEB] focus-within:bg-white focus-within:ring-2 focus-within:ring-inset focus-within:ring-slate-400`;
const TH_READ = "border border-slate-300 bg-slate-100 px-2 py-1.5 text-slate-600";
const TH_WRITE = "border border-slate-300 bg-[#FDECB3] px-2 py-1.5 text-slate-800";
const LINK = "text-slate-500 hover:text-slate-900 hover:underline disabled:opacity-40";

// 달성기준 줄 — "[건수형]" "[차월반영]" 꼬리표는 회색 작은 글자로
function CriteriaLines({ text }: { text: string }) {
  const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return <span className="text-slate-300">—</span>;
  return <ul className="space-y-0.5">{lines.map((line, i) => {
    const parts = line.split(/(\[건수형\]|\[차월반영\])/g).filter(Boolean);
    return <li key={i} className="text-[12px] leading-snug text-slate-700">{parts.map((p, j) => p === "[건수형]" || p === "[차월반영]" ? <span key={j} className="mx-0.5 rounded bg-slate-100 px-1 text-[10px] font-bold text-slate-500">{p.slice(1, -1)}</span> : <span key={j}>{p.replace(/^•\s*/, "• ")}</span>)}</li>;
  })}</ul>;
}

function JudgmentBadge({ value }: { value: string }) {
  const j = normalizeJudgment(value);
  if (!j) return <span className="text-[11px] text-slate-300">—</span>;
  return <span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-bold ${JUDGMENT_INFO[j].tone}`}>{j}</span>;
}

// Pillar 셀 병합 — 연속된 같은 Pillar 행을 한 칸으로(엑셀처럼). Pillar 미정은 각자 한 칸.
function pillarGroups(goals: OkrGoal[]): Array<{ first: boolean; count: number; members: number[] }> {
  const key = (g: OkrGoal) => { const i = pillarIndex(g.pillar); return i < 0 ? `u${g.no}` : String(i); };
  const out: Array<{ first: boolean; count: number; members: number[] }> = [];
  let i = 0;
  while (i < goals.length) {
    let j = i + 1;
    while (j < goals.length && key(goals[j]) === key(goals[i])) j++;
    const members = goals.slice(i, j).map((g) => g.no);
    for (let k = i; k < j; k++) out.push({ first: k === i, count: j - i, members });
    i = j;
  }
  return out;
}

export default function OkrHub({ author }: { author: string }) {
  const today = kstToday();
  const { book } = useAuthorBook();
  const myTeam = useMemo(() => { const t = teamForAuthor(author); return (OKR_TEAMS as readonly string[]).includes(t) ? (t as OkrTeam) : null; }, [author]);
  const [cycles, setCycles] = useState<OkrCycle[]>([]);
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month, setMonth] = useState(Number(today.slice(5, 7)));
  const cycleId = monthCycleId(year, month);
  const [cycle, setCycle] = useState<OkrCycle | null>(null);
  const [reports, setReports] = useState<OkrReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [needsUpgrade, setNeedsUpgrade] = useState(false); // okr_reports.member 열이 없는 옛 표
  useEffect(() => { void probeOkrSchema().then((ok) => setNeedsUpgrade(!ok)).catch(() => undefined); }, []);
  const [message, setMessage] = useState("");
  useEffect(() => { if (!message) return; const t = window.setTimeout(() => setMessage(""), 6000); return () => window.clearTimeout(t); }, [message]);
  const [tab, setTab] = useState<Tab>(myTeam || "all");
  const [member, setMember] = useState(myTeam ? author : ""); // '' = 파트 종합
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [aiBusy, setAiBusy] = useState("");
  const cycleSavedRef = useRef("");
  const reportSavedRef = useRef<Record<string, string>>({});
  const loadedCycleRef = useRef("");
  const cyclesRef = useRef<OkrCycle[]>([]);
  useEffect(() => { cyclesRef.current = cycles; }, [cycles]);
  // 디바운스 대기 중인 저장 — 달을 바꾸거나 화면을 나갈 때 잃지 않도록 즉시 저장(flush)한다
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
  // 파트 탭을 바꾸면: 내가 그 파트 팀원이면 내 박스, 아니면 파트 종합
  const openTeam = (team: Tab) => { setTab(team); setMember(team !== "all" && rosterOf(team).includes(author) ? author : ""); };

  // 달 열기 — DB에 있으면 그 달 결과를 읽고, 없으면 가장 최근 지난달 목표를 복사한 초안(적는 순간 저장).
  // effect가 아니라 핸들러에서 한다: 자동 저장 뒤 목록이 갱신될 때 결과를 다시 읽어 입력 중인 값을 덮어쓰는 일이 없다.
  const openTokenRef = useRef(0);
  const openMonth = (y: number, m: number, list: OkrCycle[] = cyclesRef.current) => {
    flushPending();
    setYear(y); setMonth(m);
    const id = monthCycleId(y, m);
    const token = ++openTokenRef.current;
    const found = list.find((c) => c.id === id) || null;
    if (found) {
      setCycle(found);
      cycleSavedRef.current = sig(found);
      setLoading(true);
      getOkrReports(id)
        .then((rows) => {
          if (token !== openTokenRef.current) return;
          setReports(rows);
          reportSavedRef.current = Object.fromEntries(rows.map((r) => [reportKey(r), JSON.stringify({ header: r.header, rows: r.rows })]));
          loadedCycleRef.current = id;
          setSaveStatus("idle");
        })
        .catch((e) => token === openTokenRef.current && setMessage((e as Error).message))
        .finally(() => token === openTokenRef.current && setLoading(false));
      return;
    }
    const start = `${y}-${pad(m)}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const previous = list.filter((c) => c.kind === "month" && c.start_date < start).sort((a, b) => (a.start_date < b.start_date ? 1 : -1))[0];
    const draft: OkrCycle = { id, kind: "month", title: "", year: y, month: m, week_no: null, start_date: start, end_date: `${y}-${pad(m)}-${pad(lastDay)}`, parent_id: null, goals: previous ? previous.goals.map((g) => ({ ...g })) : defaultGoalTemplate(), feedback: {} };
    draft.title = defaultCycleTitle(draft);
    setCycle(draft);
    cycleSavedRef.current = sig(draft);
    setReports([]);
    reportSavedRef.current = {};
    loadedCycleRef.current = id;
    setSaveStatus("idle");
    setLoading(false);
  };
  useEffect(() => {
    listOkrCycles()
      .then((list) => { setCycles(list); cyclesRef.current = list; setTableMissing(false); openMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7)), list); })
      .catch((e) => { const msg = (e as Error).message || ""; if (/okr_cycles|relation|404|schema cache/i.test(msg)) setTableMissing(true); setMessage(msg); setLoading(false); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- 처음 한 번

  const rememberSaved = (saved: OkrCycle) => {
    setCycles((cur) => (cur.some((c) => c.id === saved.id) ? cur.map((c) => (c.id === saved.id ? saved : c)) : [saved, ...cur]));
  };
  // 자동 저장 — 달(목표·피드백)
  useEffect(() => {
    if (!cycle || loading || loadedCycleRef.current !== cycle.id) return;
    const signature = sig(cycle);
    if (signature === cycleSavedRef.current) return;
    pendingCycleRef.current = cycle;
    const timer = window.setTimeout(() => {
      pendingCycleRef.current = null;
      saveOkrCycle(cycle, author)
        .then(() => { cycleSavedRef.current = signature; setSaveStatus("saved"); rememberSaved(cycle); })
        .catch((e) => { setSaveStatus("error"); setMessage((e as Error).message); });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [cycle, author, loading]);

  // 자동 저장 — 파트·팀원 결과(바뀐 것만). 초안 달이면 달 행을 먼저 만든다(외래키).
  useEffect(() => {
    if (!cycle || loading || loadedCycleRef.current !== cycle.id) return;
    const dirty = reports.filter((r) => JSON.stringify({ header: r.header, rows: r.rows }) !== (reportSavedRef.current[reportKey(r)] || ""));
    if (!dirty.length) return;
    pendingReportsRef.current = dirty;
    const timer = window.setTimeout(async () => {
      pendingReportsRef.current = [];
      try {
        if (!cyclesRef.current.some((c) => c.id === cycle.id)) { await saveOkrCycle(cycle, author); cycleSavedRef.current = sig(cycle); rememberSaved(cycle); }
        await Promise.all(dirty.map((r) => saveOkrReport(r, author).then(() => { reportSavedRef.current[reportKey(r)] = JSON.stringify({ header: r.header, rows: r.rows }); })));
        setSaveStatus("saved");
      } catch (e) { setSaveStatus("error"); setMessage((e as Error).message); }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [reports, cycle, author, loading]);

  const goals = cycle?.goals || [];
  const updateCycle = (patch: Partial<OkrCycle>) => { setSaveStatus("saving"); setCycle((cur) => (cur ? { ...cur, ...patch } : cur)); };
  const updateGoal = (no: number, patch: Partial<OkrGoal>) => updateCycle({ goals: goals.map((g) => (g.no === no ? { ...g, ...patch } : g)) });
  const setFeedback = (no: number, memo: string) => updateCycle({ feedback: { ...(cycle?.feedback || {}), [String(no)]: { ...(cycle?.feedback?.[String(no)] || { memo: "" }), memo } } });
  const patchReport = (team: string, who: string, fn: (r: OkrReport) => OkrReport) => { setSaveStatus("saving"); setReports((cur) => {
    const exists = cur.some((r) => r.team === team && (r.member || "") === who);
    const base = exists ? cur : [...cur, emptyReport(cycleId, team, who)];
    return base.map((r) => (r.team === team && (r.member || "") === who ? fn(r) : r));
  }); };
  const updateResult = (team: string, who: string, no: number, patch: Partial<OkrResultRow>) => patchReport(team, who, (r) => {
    const has = r.rows.some((x) => x.no === no);
    const rows = has ? r.rows.map((x) => (x.no === no ? { ...x, ...patch } : x)) : [...r.rows, { ...emptyResultRow(no), ...patch }];
    return { ...r, rows: rows.sort((a, b) => a.no - b.no) };
  });
  const goalOf = (no: number) => goals.find((g) => g.no === no);
  const monthLabel = cycle ? `${cycle.year}년 ${cycle.month}월` : "";
  const goalPayload = (g: OkrGoal) => ({ no: g.no, pillar: pillarLabel(g.pillar), objective: g.objective, criteria: g.criteria });

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
  // ✨ 메모 → 양식. 실제결과·종합판정은 바꾸고, 사유·개선계획·근거자료는 비어 있는 칸만 채운다.
  const aiFormat = async (team: OkrTeam, who: string, no: number) => {
    const goal = goalOf(no); if (!goal) return;
    const row = resultRowFor(findReport(reports, team, who), no);
    if (!row.actual.trim()) { setMessage("실제결과 칸에 한 일을 대충이라도 적은 뒤 ✨정리를 누르세요 (예: 계약서 8건 중 5건 확인, 3건은 카톡만 보냄)"); return; }
    const key = `fmt|${team}|${who}|${no}`;
    setAiBusy(key);
    try {
      const res = await okrAssist({ mode: "format", month: monthLabel, goal: goalPayload(goal), text: row.actual, reason: row.reason, plan: row.plan, evidence: row.evidence });
      updateResult(team, who, no, {
        actual: res.actual || row.actual, judgment: normalizeJudgment(res.judgment || "") || row.judgment,
        reason: row.reason.trim() ? row.reason : res.reason || "", plan: row.plan.trim() ? row.plan : res.plan || "", evidence: row.evidence.trim() ? row.evidence : res.evidence || "",
      });
      setMessage("양식으로 정리했어요 — 숫자와 (수치 없음) 표시를 확인해 주세요");
    } catch (e) { setMessage(`정리 실패: ${(e as Error).message}`); }
    finally { setAiBusy(""); }
  };
  // ✨ 팀원 기록 → 파트 종합(건수 합산). 종합 칸을 통째로 바꾼다(있으면 확인).
  const aiMerge = async (team: OkrTeam, no: number) => {
    const goal = goalOf(no); if (!goal) return;
    const members = memberReports(reports, team).map((m) => ({ name: m.member, ...resultRowFor(m, no) })).filter((m) => m.actual.trim() || m.judgment);
    if (!members.length) { setMessage(`${no}번 목표에 팀원 기록이 아직 없어요.`); return; }
    const part = resultRowFor(findReport(reports, team, ""), no);
    if ((part.actual.trim() || part.reason.trim()) && !(await askConfirm(`${no}번 종합 칸(실제결과·판정·사유·개선계획·근거자료)을 팀원 ${members.length}명 기록으로 다시 씁니다. 지금 내용은 덮어씁니다.`, { okLabel: "다시 쓰기" }))) return;
    const key = `mrg|${team}|${no}`;
    setAiBusy(key);
    try {
      const res = await okrAssist({ mode: "merge", month: monthLabel, goal: goalPayload(goal), members: members.map(({ name, actual, judgment, reason, plan, evidence }) => ({ name, actual, judgment, reason, plan, evidence })) });
      updateResult(team, "", no, { actual: res.actual || part.actual, judgment: normalizeJudgment(res.judgment || "") || part.judgment, reason: res.reason || part.reason, plan: res.plan || part.plan, evidence: res.evidence || part.evidence });
      setMessage(`팀원 ${members.length}명 기록을 합쳐 종합 칸을 채웠어요 — 합산 건수를 확인해 주세요`);
    } catch (e) { setMessage(`합치기 실패: ${(e as Error).message}`); }
    finally { setAiBusy(""); }
  };
  // ✨ 파트 결과 → 팀장 피드백 초안
  const aiFeedback = async (no: number) => {
    const goal = goalOf(no); if (!goal) return;
    const teams = OKR_TEAMS.map((t) => ({ team: t, ...resultRowFor(findReport(reports, t, ""), no) })).filter((t) => t.actual.trim() || t.judgment);
    if (!teams.length) { setMessage(`${no}번 목표에 파트 결과가 아직 없어요.`); return; }
    const existing = cycle?.feedback?.[String(no)]?.memo || "";
    if (existing.trim() && !(await askConfirm(`${no}번 피드백 칸에 이미 글이 있어요. 초안으로 바꿀까요?`, { okLabel: "바꾸기" }))) return;
    const key = `fb|${no}`;
    setAiBusy(key);
    try {
      const res = await okrAssist({ mode: "feedback", month: monthLabel, goal: goalPayload(goal), teams: teams.map(({ team, actual, judgment, reason, plan, evidence }) => ({ team, actual, judgment, reason, plan, evidence })) });
      if (res.memo) { setFeedback(no, res.memo); setMessage("피드백 초안을 넣었어요 — 팀장님 말로 다듬어 주세요"); }
    } catch (e) { setMessage(`초안 실패: ${(e as Error).message}`); }
    finally { setAiBusy(""); }
  };

  const addGoal = (pillarFull = "") => updateCycle({ goals: renumberGoals([...goals, { ...emptyGoal(goals.length + 1), pillar: pillarFull }]) });
  const removeGoal = async (goal: OkrGoal) => {
    const used = reports.filter((r) => { const row = resultRowFor(r, goal.no); return row.actual || row.judgment; }).map((r) => `${teamName(r.team)}${r.member ? ` ${r.member}` : ""}`);
    const ok = await askConfirm(`${goal.no}번 목표를 삭제할까요?${used.length ? `\n\n이미 결과를 적은 곳: ${used.join(", ")} — 그 결과도 함께 지워집니다.` : ""}\n뒤 번호는 앞으로 당겨집니다.`, { danger: true, okLabel: "삭제" });
    if (!ok) return;
    const remaining = goals.filter((g) => g.no !== goal.no);
    const remap = new Map(remaining.map((g, i) => [g.no, i + 1]));
    updateCycle({ goals: renumberGoals(remaining), feedback: Object.fromEntries(Object.entries(cycle?.feedback || {}).filter(([k]) => remap.has(Number(k))).map(([k, v]) => [String(remap.get(Number(k))), v])) });
    setReports((cur) => cur.map((r) => ({ ...r, rows: r.rows.filter((x) => remap.has(x.no)).map((x) => ({ ...x, no: remap.get(x.no) || x.no })) })));
  };
  const copyGoalsFrom = (sourceId: string) => {
    const src = cycles.find((c) => c.id === sourceId);
    if (!src) return;
    updateCycle({ goals: src.goals.map((g) => ({ ...g })) });
    setMessage(`${cycleLabel(src)} 목표 ${src.goals.length}개를 가져왔어요`);
  };
  // 수정을 끝내면 Pillar 순으로 정렬해 번호를 다시 매긴다(결과 행·피드백 번호도 함께)
  const finishGoalEdit = () => {
    const rank = (g: OkrGoal) => { const i = pillarIndex(g.pillar); return i < 0 ? 99 : i; };
    const order = [...goals].sort((a, b) => rank(a) - rank(b));
    const remap = new Map(order.map((g, i) => [g.no, i + 1]));
    if (goals.every((g) => remap.get(g.no) === g.no)) return;
    updateCycle({ goals: sortGoalsByPillar(goals), feedback: Object.fromEntries(Object.entries(cycle?.feedback || {}).map(([k, v]) => [String(remap.get(Number(k)) || k), v])) });
    setReports((cur) => cur.map((r) => ({ ...r, rows: r.rows.map((x) => ({ ...x, no: remap.get(x.no) || x.no })).sort((a, b) => a.no - b.no) })));
  };

  const monthsWithData = useMemo(() => new Set(cycles.filter((c) => c.kind === "month" && c.year === year).map((c) => c.month)), [cycles, year]);
  const years = useMemo(() => { const ys = new Set<number>([Number(today.slice(0, 4)), Number(today.slice(0, 4)) - 1, ...cycles.map((c) => c.year)]); return [...ys].sort((a, b) => b - a); }, [cycles, today]);
  const tabs: Array<[Tab, string]> = [["all", "통합집계"], ...OKR_TEAMS.map((t) => [t, teamName(t)] as [Tab, string])];
  const isDraft = !!cycle && !cycles.some((c) => c.id === cycle.id); // 아직 DB에 없는 달(지난달 목표를 복사한 초안)

  if (!author) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm font-semibold text-amber-800">FIELD에서 작성자를 먼저 선택해 주세요.</div>;

  return <div className="space-y-4 pb-16">
    <section className="flex flex-col gap-3 rounded-xl bg-[#151A23] p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
        <PortalSelect tone="dark" width={110} value={String(year)} onChange={(v) => openMonth(Number(v), month)} options={years.map((y) => ({ value: String(y), label: `${y}년` }))} />
        <div className="grid flex-1 grid-cols-6 gap-1 rounded-full bg-white/10 p-1 sm:grid-cols-12">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <button key={m} type="button" onClick={() => openMonth(year, m)} className={`relative rounded-full px-1 py-1.5 text-xs font-bold transition sm:text-sm ${month === m ? "bg-white text-slate-950" : monthsWithData.has(m) ? "text-slate-200 hover:bg-white/10" : "text-slate-500 hover:bg-white/10"}`}>{m}월{monthsWithData.has(m) && month !== m && <span className="absolute right-1.5 top-1.5 h-1 w-1 rounded-full bg-white/70" />}</button>)}
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
        {saveStatus === "saving" && <span className="rounded-full bg-white/10 px-3 py-1.5">저장 중…</span>}
        {saveStatus === "error" && <span className="rounded-full bg-rose-500/20 px-3 py-1.5 text-rose-200">저장 실패</span>}
        {cycle && <span className="rounded-full bg-white/10 px-3 py-1.5 tabular-nums">{cycle.start_date} ~ {cycle.end_date}</span>}
      </div>
    </section>

    {tableMissing && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><b>OKR 표가 아직 없습니다.</b> Supabase SQL Editor에서 <code className="rounded bg-white px-1">supabase/okr.sql</code>(표 만들기)을 한 번 실행한 뒤 이 화면을 다시 열어 주세요.</div>}
    {needsUpgrade && !tableMissing && <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"><b>OKR 표를 한 번 더 올려야 합니다.</b> 팀원별 기록 칸(member)이 없는 예전 표라 저장이 안 됩니다. Supabase SQL Editor에서 <code className="rounded bg-white px-1">supabase/okr.sql</code>을 다시 실행하면(기존 내용은 그대로) 바로 됩니다.</div>}
    {message && !tableMissing && <div className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white">{message}</div>}

    {cycle && !tableMissing && <>
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="bg-[#1E252F] px-5 py-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-blue-400">Monthly OKR · {cycleLabel(cycle)}</div>
          <h2 className="mt-1 text-lg font-black tracking-tight text-white lg:text-xl">{cycle.title || defaultCycleTitle(cycle)}</h2>
          <p className="mt-1 text-[11px] font-semibold text-slate-400">{isDraft ? `아직 기록이 없는 달 — ${goals.some((g) => g.objective) ? "지난달 목표를 그대로 가져왔습니다. 고칠 게 있으면 통합집계의 [목표 수정]" : "Pillar 3 × 병목현상 3 빈 틀입니다. 통합집계의 [목표 수정]에서 목표·달성기준을 넣어 주세요"}` : `Pillar 3 × 병목현상 3 · 목표 ${goals.length}개 · 노란 칸에만 씁니다 · 자동 저장`}</p>
        </div>
        <div className="flex gap-1 overflow-x-auto px-3 pt-2">
          {tabs.map(([key, label]) => {
            const rep = key === "all" ? undefined : findReport(reports, key, "");
            const rows = rep ? goals.map((g) => resultRowFor(rep, g.no)) : [];
            const judged = rows.filter((x) => normalizeJudgment(x.judgment)).length;
            const alerts = rows.filter((x) => isAlert(x.judgment)).length;
            return <button key={key} type="button" onClick={() => openTeam(key)} className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-black transition ${tab === key ? "border-slate-900 text-slate-950" : "border-transparent text-slate-400 hover:text-slate-700"}`}>
              {label}{key !== "all" && goals.length > 0 && <span className="text-[11px] font-bold tabular-nums text-slate-400">{judged}/{goals.length}</span>}
              {alerts > 0 && <span className="text-[11px] font-bold text-rose-600">미흡 {alerts}</span>}
            </button>;
          })}
        </div>
      </section>

      {loading ? <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm font-bold text-slate-400">불러오는 중…</div>
        : tab === "all"
          ? <SummaryView cycle={cycle} cycles={cycles} reports={reports} aiBusy={aiBusy} onFeedback={setFeedback} onAiFeedback={(no) => void aiFeedback(no)} onGoal={updateGoal} onAddGoal={addGoal} onRemoveGoal={removeGoal} onCopyGoals={copyGoalsFrom} onTemplate={() => updateCycle({ goals: defaultGoalTemplate() })} onFinishEdit={finishGoalEdit} />
          : <TeamView team={tab} cycle={cycle} reports={reports} member={member} onMember={setMember} roster={rosterOf(tab)} author={author} aiBusy={aiBusy}
              onHeader={(patch) => patchReport(tab, "", (r) => ({ ...r, header: { ...r.header, ...patch } }))}
              onResult={(no, patch) => updateResult(tab, member, no, patch)}
              onMerge={(no) => void mergeMembers(tab, no)} onAiMerge={(no) => void aiMerge(tab, no)} onAiFormat={(no) => void aiFormat(tab, member, no)} />}
    </>}
  </div>;
}

// ── 사람 박스(파트 종합 / 팀원) — 이름 · 판정 n/9 · 미흡 수. 색은 선택(검정)과 미흡(빨강)뿐 ──
function PersonBox({ label, sub, rows, total, selected, onClick }: { label: string; sub?: string; rows: OkrResultRow[]; total: number; selected: boolean; onClick: () => void }) {
  const judged = rows.filter((r) => normalizeJudgment(r.judgment)).length;
  const alerts = rows.filter((r) => isAlert(r.judgment)).length;
  const pct = total ? Math.round((judged / total) * 100) : 0;
  return <button type="button" onClick={onClick} className={`w-[128px] shrink-0 rounded-lg border p-2.5 text-left transition ${selected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-800 hover:border-slate-400"}`}>
    <div className="flex items-baseline justify-between gap-1"><span className="truncate text-[13px] font-black">{label}</span><span className={`text-[11px] font-bold tabular-nums ${selected ? "text-slate-300" : "text-slate-400"}`}>{judged}/{total}</span></div>
    <div className={`h-4 text-[10px] font-semibold ${selected ? "text-slate-400" : "text-slate-400"}`}>{alerts ? <span className={selected ? "text-rose-300" : "text-rose-600"}>미흡·미착수 {alerts}</span> : sub || ""}</div>
    <div className={`mt-1 h-1 overflow-hidden rounded-full ${selected ? "bg-white/20" : "bg-slate-100"}`}><div className={`h-full transition-all ${selected ? "bg-white" : "bg-slate-800"}`} style={{ width: `${pct}%` }} /></div>
  </button>;
}

// ── 파트 시트: 한 행에 목표 하나, 열 머리는 엑셀과 같게, 격자 셀 ──
const COLS: Array<[string, number, "read" | "write"]> = [
  ["No", 44, "read"], ["Pillar", 104, "read"], ["병목현상", 78, "read"], ["목표", 220, "read"], ["달성기준", 250, "read"],
  ["실제결과", 290, "write"], ["종합판정", 104, "write"], ["사유", 200, "write"], ["개선계획", 200, "write"], ["근거자료", 200, "write"],
];
const TABLE_MIN = COLS.reduce((n, [, w]) => n + w, 0);

function TeamView({ team, cycle, reports, member, onMember, roster, author, aiBusy, onHeader, onResult, onMerge, onAiMerge, onAiFormat }: {
  team: OkrTeam; cycle: OkrCycle; reports: OkrReport[]; member: string; onMember: (m: string) => void; roster: string[]; author: string; aiBusy: string;
  onHeader: (patch: Partial<OkrReport["header"]>) => void; onResult: (no: number, patch: Partial<OkrResultRow>) => void; onMerge: (no: number) => void; onAiMerge: (no: number) => void; onAiFormat: (no: number) => void;
}) {
  const goals = cycle.goals;
  const partReport = findReport(reports, team, "") || emptyReport(cycle.id, team, "");
  const members = memberReports(reports, team);
  const memberNames = useMemo(() => { const seen = new Set<string>(); return [...roster, ...members.map((m) => m.member)].filter((n) => n && !seen.has(n) && seen.add(n)); }, [roster, members]);
  const current = member ? (findReport(reports, team, member) || emptyReport(cycle.id, team, member)) : partReport;
  const rows = goals.map((g) => resultRowFor(current, g.no));
  const rate = achievementRate(rows);
  const judged = rows.filter((r) => normalizeJudgment(r.judgment)).length;
  const alerts = rows.filter((r) => isAlert(r.judgment)).length;
  const missing = rows.filter((r) => needsReasonPlan(r.judgment) && (!r.reason.trim() || !r.plan.trim())).length;
  const [openMembers, setOpenMembers] = useState<Record<number, boolean>>({});
  const groups = pillarGroups(goals);
  const addOtherName = () => {
    const name = window.prompt("이 파트에 기록할 이름(관리 › 인원 명단에 없는 사람)");
    if (name && name.trim()) onMember(name.trim());
  };
  const rowsOf = (r: OkrReport | undefined) => goals.map((g) => resultRowFor(r, g.no));
  // 지금 이 화면에서 할 일 — 한 줄
  const todo = member
    ? (judged < goals.length ? `① 실제결과에 한 일을 적고 ✨정리 → ② 종합판정 확인 → ③ 완료가 아니면 사유·개선계획 (남은 목표 ${goals.length - judged}개)` : missing ? `사유·개선계획이 빈 목표 ${missing}개를 채우면 끝` : "이 달 기록 완료 — 파트장이 종합에서 모읍니다")
    : (members.length ? `팀원 기록이 모이면 No 아래 👥 → ✨합치기(건수 합산) 또는 모아 넣기 → 판정 확인 → 위 제출 정보 (판정 ${judged}/${goals.length})` : "팀원이 각자 이름 박스에서 적으면 여기서 모읍니다. 직접 적어도 됩니다.");

  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    {/* 사람 박스 */}
    <div className="flex flex-wrap items-stretch gap-2 border-b border-slate-200 bg-slate-50 p-3">
      <PersonBox label="파트 종합" sub="통합집계에 반영" rows={rowsOf(partReport)} total={goals.length} selected={!member} onClick={() => onMember("")} />
      <span className="mx-0.5 hidden w-px self-stretch bg-slate-200 sm:block" />
      {memberNames.map((name) => <PersonBox key={name} label={name} sub={name === author ? "나" : ""} rows={rowsOf(findReport(reports, team, name))} total={goals.length} selected={member === name} onClick={() => onMember(name)} />)}
      <button type="button" onClick={addOtherName} className="w-[64px] shrink-0 rounded-lg border border-dashed border-slate-300 text-[11px] font-bold text-slate-400 hover:bg-white">＋ 이름</button>
      {!memberNames.length && <div className="self-center text-[11px] font-semibold text-slate-400">관리 › 인원 명단에 {teamName(team)} 인원을 넣으면 이름 박스가 생깁니다</div>}
    </div>
    {/* 제출 정보 — 엑셀 머리 칸처럼(파트 종합에서만) */}
    {!member && <div className="grid grid-cols-2 border-b border-slate-200 text-[12px] lg:grid-cols-4">
      {([["leader", "파트장(부파트장)", "text"], ["author", "작성자", "text"], ["submitted", "제출일", "date"], ["headcount", "파트 인원수", "text"]] as Array<[keyof OkrReport["header"], string, string]>).map(([key, label, type], i) => <label key={key} className={`flex items-center gap-2 px-3 py-1.5 ${i < 3 ? "lg:border-r lg:border-slate-200" : ""} ${i % 2 === 0 ? "border-r border-slate-200" : ""}`}>
        <span className="w-[92px] shrink-0 text-[11px] font-bold text-slate-500">{label}</span>
        <input type={type} value={partReport.header[key]} onChange={(e) => onHeader({ [key]: e.target.value })} placeholder={key === "headcount" ? String(memberNames.length || "") : ""} className="min-w-0 flex-1 rounded bg-[#FFFBEB] px-2 py-1 text-[12px] font-semibold text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-inset focus:ring-slate-400" />
      </label>)}
    </div>}
    {/* 할 일 한 줄 + 상태 */}
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 px-3 py-2 text-[11px] font-semibold text-slate-500">
      <span className="text-[13px] font-black text-slate-900">{member ? `${teamName(team)} · ${member}` : `${teamName(team)} 종합`}</span>
      <span>{todo}</span>
      <span className="ml-auto tabular-nums">{rate !== null && `달성 ${rate}%`}{alerts > 0 && <span className="ml-2 text-rose-600">미흡·미착수 {alerts}</span>}{current.updated_at && <span className="ml-2 text-slate-400">저장 {shortTime(current.updated_at)}{current.updated_by ? ` ${current.updated_by}` : ""}</span>}</span>
    </div>

    {goals.length === 0 ? <div className="p-8 text-center text-sm font-bold text-slate-400">이 달에는 아직 목표가 없어요. 통합집계 탭의 [목표 수정]에서 넣어 주세요.</div>
      : <div className="overflow-x-auto">
        <table className="border-collapse text-left text-[12px]" style={{ minWidth: TABLE_MIN, width: "100%" }}>
          <colgroup>{COLS.map(([label, w]) => <col key={label} style={{ width: w }} />)}</colgroup>
          <thead className="sticky top-0 z-10 text-[11px] font-bold">
            <tr>{COLS.map(([label, , mode]) => <th key={label} className={mode === "write" ? TH_WRITE : TH_READ}>{label}</th>)}</tr>
          </thead>
          <tbody>
            {goals.map((goal, gi) => {
              const row = resultRowFor(current, goal.no);
              const j = normalizeJudgment(row.judgment);
              const suggested = worstJudgment(row.actual);
              const group = groups[gi];
              const alert = isAlert(row.judgment);
              const mustExplain = needsReasonPlan(row.judgment);
              const memberEntries = !member ? members.map((m) => ({ name: m.member, row: resultRowFor(m, goal.no) })).filter((x) => x.row.actual.trim() || x.row.judgment) : [];
              const open = !member && !!openMembers[goal.no];
              const spanExtra = !member ? group.members.filter((no) => openMembers[no]).length : 0;
              const fmtKey = `fmt|${team}|${member}|${goal.no}`;
              const mrgKey = `mrg|${team}|${goal.no}`;
              return <FragmentRows key={goal.no}>
                <tr>
                  <td className={`${TD} px-1 py-1.5 text-center ${alert ? `border-l-4 ${j === "미착수" ? "border-l-rose-500" : "border-l-orange-500"}` : ""}`}>
                    <div className="text-[13px] font-black text-slate-800">{goal.no}</div>
                    {!member && <button type="button" onClick={() => setOpenMembers((cur) => ({ ...cur, [goal.no]: !open }))} title="팀원 기록 보기" className={`mt-0.5 text-[10px] font-bold ${memberEntries.length ? "text-slate-700 hover:underline" : "text-slate-300"}`}>👥{memberEntries.length}</button>}
                  </td>
                  {group.first && <td rowSpan={group.count + spanExtra} className={`${TD_READ} bg-slate-50 text-[11px] font-bold leading-snug text-slate-700`}>{pillarLabel(goal.pillar) || <span className="text-slate-300">미정</span>}</td>}
                  <td className={`${TD_READ} text-[11px] text-slate-500`}>{bottleneckLabel(goals, goal.no)}</td>
                  <td className={`${TD_READ} whitespace-pre-wrap font-semibold leading-snug text-slate-900`}>{goal.objective || <span className="font-normal text-slate-300">—</span>}</td>
                  <td className={TD_READ}><CriteriaLines text={goal.criteria} /></td>
                  <td className={TD_WRITE}>
                    <CellArea value={row.actual} onChange={(v) => onResult(goal.no, { actual: v })} rows={3} placeholder="한 일을 대충 적고 ✨정리 — 예) 계약서 8건 중 5건 확인, 3건은 카톡만" />
                    <div className="flex flex-wrap gap-x-3 px-2 pb-1 text-[10px] font-bold">
                      <button type="button" disabled={!!aiBusy} onClick={() => onAiFormat(goal.no)} className={LINK}>{aiBusy === fmtKey ? "정리 중…" : "✨ 정리"}</button>
                      {!member && memberEntries.length > 0 && <>
                        <button type="button" disabled={!!aiBusy} onClick={() => onAiMerge(goal.no)} className={LINK}>{aiBusy === mrgKey ? "합치는 중…" : `✨ 팀원 ${memberEntries.length}명 합치기`}</button>
                        <button type="button" onClick={() => onMerge(goal.no)} className={LINK}>그대로 모아 넣기</button>
                      </>}
                    </div>
                  </td>
                  <td className={`${TD} p-0 ${j ? JUDGMENT_INFO[j].tone : "bg-[#FFFBEB]"}`}>
                    <select value={j} onChange={(e) => onResult(goal.no, { judgment: e.target.value })} className="w-full bg-transparent px-1.5 py-1.5 text-[12px] font-bold outline-none">
                      <option value="">선택</option>
                      {OKR_JUDGMENTS.map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                    {suggested && suggested !== j && row.actual.trim() && <button type="button" onClick={() => onResult(goal.no, { judgment: suggested })} className="block w-full px-1.5 pb-1 text-left text-[10px] font-bold text-slate-600 hover:underline">→ {suggested}로</button>}
                  </td>
                  <td className={`${TD_WRITE} ${mustExplain && !row.reason.trim() ? "!bg-rose-50" : ""}`}><CellArea value={row.reason} onChange={(v) => onResult(goal.no, { reason: v })} rows={3} placeholder={mustExplain ? "필수 — ○○○ 때문에 ○건을 못 했습니다" : ""} className={mustExplain && !row.reason.trim() ? "placeholder:text-rose-400" : ""} /></td>
                  <td className={`${TD_WRITE} ${mustExplain && !row.plan.trim() ? "!bg-rose-50" : ""}`}><CellArea value={row.plan} onChange={(v) => onResult(goal.no, { plan: v })} rows={3} placeholder={mustExplain ? "필수 — 다음 달부터 ○○○ 하겠습니다" : ""} className={mustExplain && !row.plan.trim() ? "placeholder:text-rose-400" : ""} /></td>
                  <td className={TD_WRITE}><CellArea value={row.evidence} onChange={(v) => onResult(goal.no, { evidence: v })} rows={3} placeholder={j === "해당없음" ? "대상 0건" : "항목 이름 : 실제 내용"} /></td>
                </tr>
                {open && <tr className="bg-slate-50">
                  <td className={`${TD} px-1 py-1.5`} />
                  <td colSpan={8} className={`${TD} px-2 py-2`}>
                    <div className="mb-1.5 flex items-center gap-3 text-[11px] font-bold text-slate-700">👥 {goal.no}번 팀원 기록 {memberEntries.length}명
                      {memberEntries.length > 0 && <><button type="button" disabled={!!aiBusy} onClick={() => onAiMerge(goal.no)} className={LINK}>{aiBusy === mrgKey ? "합치는 중…" : "✨ 건수 합산해 종합에 넣기"}</button><button type="button" onClick={() => onMerge(goal.no)} className={LINK}>그대로 모아 넣기</button></>}
                    </div>
                    {memberEntries.length === 0 ? <div className="text-[11px] font-semibold text-slate-400">아직 아무도 적지 않았어요. 팀원은 위 이름 박스에서 자기 기록을 씁니다.</div>
                      : <table className="w-full border-collapse text-[11px]"><colgroup><col style={{ width: 80 }} /><col style={{ width: "32%" }} /><col style={{ width: 76 }} /><col /><col /><col /></colgroup>
                        <thead><tr className="text-[10px] font-bold text-slate-500">{["이름", "실제결과", "종합판정", "사유", "개선계획", "근거자료"].map((h) => <th key={h} className="border border-slate-200 bg-white px-1.5 py-1 text-left">{h}</th>)}</tr></thead>
                        <tbody className="align-top">{memberEntries.map((x) => <tr key={x.name} className="bg-white"><td className="border border-slate-200 px-1.5 py-1 font-black text-slate-800"><button type="button" onClick={() => onMember(x.name)} className="hover:underline">{x.name}</button></td><td className="whitespace-pre-wrap border border-slate-200 px-1.5 py-1 text-slate-700">{x.row.actual}</td><td className="border border-slate-200 px-1.5 py-1"><JudgmentBadge value={x.row.judgment} /></td><td className="whitespace-pre-wrap border border-slate-200 px-1.5 py-1 text-slate-600">{x.row.reason}</td><td className="whitespace-pre-wrap border border-slate-200 px-1.5 py-1 text-slate-600">{x.row.plan}</td><td className="whitespace-pre-wrap border border-slate-200 px-1.5 py-1 text-slate-600">{x.row.evidence}</td></tr>)}</tbody>
                      </table>}
                  </td>
                </tr>}
              </FragmentRows>;
            })}
          </tbody>
        </table>
      </div>}
  </section>;
}

// tbody 안에서 행 두 줄(목표 행 + 팀원 펼침 행)을 묶는 용도
function FragmentRows({ children }: { children: React.ReactNode }) { return <>{children}</>; }

// ── 통합집계: 엑셀 '1.통합집계' 시트와 같은 열(No · Pillar · 목표 · 파트별 종합판정 · 조치 필요 파트 · 피드백) + [목표 수정] ──
function SummaryView({ cycle, cycles, reports, aiBusy, onFeedback, onAiFeedback, onGoal, onAddGoal, onRemoveGoal, onCopyGoals, onTemplate, onFinishEdit }: {
  cycle: OkrCycle; cycles: OkrCycle[]; reports: OkrReport[]; aiBusy: string; onFeedback: (no: number, memo: string) => void; onAiFeedback: (no: number) => void;
  onGoal: (no: number, patch: Partial<OkrGoal>) => void; onAddGoal: (pillarFull?: string) => void; onRemoveGoal: (goal: OkrGoal) => void; onCopyGoals: (sourceId: string) => void; onTemplate: () => void; onFinishEdit: () => void;
}) {
  const goals = cycle.goals;
  const [editGoals, setEditGoals] = useState(!goals.some((g) => g.objective.trim()));
  const partRows = reports.filter((r) => !r.member);
  const groups = pillarGroups(goals);
  const perTeam = OKR_TEAMS.map((t) => {
    const rep = partRows.find((r) => r.team === t);
    const rows = goals.map((g) => resultRowFor(rep, g.no));
    const ms = memberReports(reports, t);
    return { team: t, rep, judged: rows.filter((r) => normalizeJudgment(r.judgment)).length, alerts: rows.filter((r) => isAlert(r.judgment)).length, rate: achievementRate(rows), members: ms.map((m) => ({ name: m.member, judged: goals.filter((g) => normalizeJudgment(resultRowFor(m, g.no).judgment)).length })) };
  });
  const otherMonths = cycles.filter((c) => c.kind === "month" && c.id !== cycle.id && c.goals.some((g) => g.objective.trim()));
  const toggleEdit = () => { if (editGoals) onFinishEdit(); setEditGoals((v) => !v); };
  const actionCount = goals.filter((g) => actionTeams(reports, g.no).length).length;
  return <div className="space-y-3">
    <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {perTeam.map(({ team, rep, judged, alerts, rate, members }) => <div key={team} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between"><div className="text-sm font-black text-slate-900">{teamName(team)}</div><div className="text-[11px] font-bold tabular-nums text-slate-400">{judged >= goals.length && goals.length ? "제출 완료" : `판정 ${judged}/${goals.length}`}</div></div>
        <div className="mt-1 flex items-end justify-between"><div className="text-2xl font-black tabular-nums text-slate-950">{rate === null ? "—" : `${rate}%`}<span className="ml-1 text-xs font-semibold text-slate-400">달성</span></div><div className="text-right text-[11px] font-bold">{alerts > 0 ? <span className="text-rose-600">미흡·미착수 {alerts}</span> : <span className="text-slate-300">미흡 없음</span>}</div></div>
        <div className="mt-2 border-t border-slate-100 pt-2 text-[10px] font-semibold text-slate-400">{rep?.header.leader ? `파트장 ${rep.header.leader}` : "파트장 미기재"}{members.length ? ` · 팀원 기록 ${members.map((m) => `${m.name} ${m.judged}/${goals.length}`).join(", ")}` : ""}</div>
      </div>)}
    </section>

    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2 text-[11px] font-semibold text-slate-500">
        <span className="text-[13px] font-black text-slate-900">통합집계</span>
        <span>{editGoals ? "Pillar를 고르고 목표·달성기준을 적습니다(팀장·파트장). 병목현상 번호는 Pillar 안 순서대로 자동. 끝나면 [✓ 수정 끝]" : actionCount ? `조치 필요 목표 ${actionCount}개 — 피드백 칸에 ✨초안 → 팀장님 말로 다듬기` : "미흡·미착수 판정이 생기면 조치 필요 파트가 자동으로 표시됩니다"}</span>
        <div className="ml-auto flex items-center gap-1 text-xs font-bold text-slate-600">
          {editGoals && <button type="button" onClick={() => onAddGoal(goals.length ? goals[goals.length - 1].pillar : OKR_PILLARS[0].full)} className="rounded-lg px-2.5 py-1.5 hover:bg-slate-100">＋ 목표 추가</button>}
          {editGoals && !goals.some((g) => g.objective.trim()) && <button type="button" onClick={onTemplate} className="rounded-lg px-2.5 py-1.5 hover:bg-slate-100">3 × 3 빈 틀</button>}
          {editGoals && otherMonths.length > 0 && <PortalSelect width={200} value="" onChange={(v) => v && onCopyGoals(v)} options={[{ value: "", label: "다른 달 목표 가져오기…" }, ...otherMonths.map((c) => ({ value: c.id, label: `${cycleLabel(c)} (${c.goals.length}개)` }))]} />}
          <button type="button" onClick={toggleEdit} className={`rounded-lg px-2.5 py-1.5 ${editGoals ? "bg-slate-900 text-white" : "hover:bg-slate-100"}`}>{editGoals ? "✓ 수정 끝" : "목표 수정"}</button>
        </div>
      </div>
      <div className="overflow-x-auto">
        {editGoals
          ? <table className="w-full border-collapse text-left text-[12px]" style={{ minWidth: 900 }}>
            <colgroup><col style={{ width: 44 }} /><col style={{ width: 190 }} /><col style={{ width: 84 }} /><col /><col /><col style={{ width: 52 }} /></colgroup>
            <thead className="text-[11px] font-bold"><tr>{["No", "Pillar", "병목현상", "목표", "달성기준 (한 줄에 하나 · 개수 기준은 뒤에 [건수형])", ""].map((h) => <th key={h} className={TH_READ}>{h}</th>)}</tr></thead>
            <tbody>
              {goals.map((goal) => <tr key={goal.no}>
                <td className={`${TD} px-1 py-1.5 text-center text-[13px] font-black text-slate-800`}>{goal.no}</td>
                <td className={`${TD} p-0`}><select value={String(pillarIndex(goal.pillar))} onChange={(e) => onGoal(goal.no, { pillar: Number(e.target.value) >= 0 ? OKR_PILLARS[Number(e.target.value)].full : "" })} className="w-full bg-transparent px-2 py-1.5 text-[12px] font-bold text-slate-800 outline-none">
                  <option value="-1">Pillar 선택</option>{OKR_PILLARS.map((p, i) => <option key={p.label} value={String(i)}>Pillar {i + 1}. {p.label}</option>)}
                </select></td>
                <td className={`${TD_READ} text-[11px] text-slate-500`}>{pillarIndex(goal.pillar) >= 0 ? bottleneckLabel(goals, goal.no) : "—"}</td>
                <td className={`${TD} p-0 focus-within:ring-2 focus-within:ring-inset focus-within:ring-slate-400`}><CellArea value={goal.objective} onChange={(v) => onGoal(goal.no, { objective: v })} rows={2} placeholder="이 달에 이만큼은 하자 — 한 문장" /></td>
                <td className={`${TD} p-0 focus-within:ring-2 focus-within:ring-inset focus-within:ring-slate-400`}><CellArea value={goal.criteria} onChange={(v) => onGoal(goal.no, { criteria: v })} rows={3} placeholder={"• 항목: 1건 이상  [건수형]\n• 이행률: 100%"} className="font-mono text-[11px]" /></td>
                <td className={`${TD} px-1 py-1.5 text-center`}><button type="button" onClick={() => onRemoveGoal(goal)} className="text-[11px] font-bold text-slate-400 hover:text-rose-600 hover:underline">삭제</button></td>
              </tr>)}
              {goals.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-sm font-bold text-slate-400">목표가 없습니다. [3 × 3 빈 틀] 또는 [다른 달 목표 가져오기]</td></tr>}
            </tbody>
          </table>
          : <table className="w-full border-collapse text-left text-[12px]" style={{ minWidth: 1000 }}>
            <colgroup><col style={{ width: 44 }} /><col style={{ width: 104 }} /><col style={{ width: 260 }} />{OKR_TEAMS.map((t) => <col key={t} style={{ width: 84 }} />)}<col style={{ width: 130 }} /><col /></colgroup>
            <thead className="text-[11px] font-bold"><tr><th className={TH_READ}>No</th><th className={TH_READ}>Pillar</th><th className={TH_READ}>목표</th>{OKR_TEAMS.map((t) => <th key={t} className={`${TH_READ} text-center`}>{teamName(t)}</th>)}<th className={TH_READ}>조치 필요 파트</th><th className={TH_WRITE}>미흡항목 피드백 & 다음 달 개선 방향</th></tr></thead>
            <tbody>
              {goals.map((goal, gi) => {
                const actions = actionTeams(reports, goal.no);
                const who = actionMembers(reports, goal.no);
                const memo = cycle.feedback?.[String(goal.no)]?.memo || "";
                const group = groups[gi];
                const fbKey = `fb|${goal.no}`;
                return <tr key={goal.no}>
                  <td className={`${TD} px-1 py-1.5 text-center text-[13px] font-black text-slate-800 ${actions.length ? "border-l-4 border-l-orange-500" : ""}`}>{goal.no}</td>
                  {group.first && <td rowSpan={group.count} className={`${TD_READ} bg-slate-50 text-[11px] font-bold leading-snug text-slate-700`}>{pillarLabel(goal.pillar) || <span className="text-slate-300">미정</span>}</td>}
                  <td className={`${TD_READ} whitespace-pre-wrap font-semibold leading-snug text-slate-800`}><span className="mr-1 text-[10px] font-bold text-slate-400">{bottleneckLabel(goals, goal.no)}</span>{goal.objective}</td>
                  {OKR_TEAMS.map((t) => <td key={t} className={`${TD} px-1 py-1.5 text-center`}><JudgmentBadge value={resultRowFor(partRows.find((r) => r.team === t), goal.no).judgment} /></td>)}
                  <td className={`${TD_READ} text-[11px] leading-snug`}>{actions.length ? actions.map((t) => <div key={t}><span className="font-black text-rose-600">{t}파트</span>{who[t]?.length ? <span className="text-slate-500"> · {who[t].join(", ")}</span> : null}</div>) : <span className="text-slate-300">—</span>}</td>
                  <td className={TD_WRITE}>
                    <CellArea value={memo} onChange={(v) => onFeedback(goal.no, v)} rows={2} placeholder={actions.length ? "1. 대상: …  2. 피드백: …  3. 다음 달 개선 방향: …" : ""} />
                    <div className="px-2 pb-1 text-[10px] font-bold"><button type="button" disabled={!!aiBusy} onClick={() => onAiFeedback(goal.no)} className={LINK}>{aiBusy === fbKey ? "초안 쓰는 중…" : "✨ 초안"}</button></div>
                  </td>
                </tr>;
              })}
              {goals.length === 0 && <tr><td colSpan={5 + OKR_TEAMS.length} className="p-8 text-center text-sm font-bold text-slate-400">목표가 없습니다. 위 [목표 수정]에서 넣어 주세요.</td></tr>}
            </tbody>
          </table>}
      </div>
    </section>
  </div>;
}
