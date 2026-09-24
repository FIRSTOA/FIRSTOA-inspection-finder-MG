// OKR 화면 — 기록·성과 > OKR (2026-09-24)
// 엑셀 "CS팀_8월_OKR_실행결과" 워크북을 웹으로 옮겼다. 다른 탭과 같은 짙은 상단 바에 연도 + 1~12월만 두고, 달을 고르면 그 달 OKR이 열린다
// (없으면 지난달 목표를 복사한 초안 — 무언가 적는 순간 저장).
//  - 구조: Pillar 3개(AI·효율성·비용절감 / 매출증대·안정 / 나의 성장·소통) × 병목 1·2·3 = 목표 9개.
//  - 목표·달성기준은 두 층: 달의 공통 목표(통합집계에서 팀장이 고침) ← 파트 고유 목표(파트 종합에서 고침, 처음 고칠 때 공통을 복사).
//    파트 고유 목표가 없으면 공통을 그대로 따른다. 팀원 칸에서는 읽기만 — 파트 종합·팀원은 같은 목표를 본다(2026-09-24 사용자).
//  - 파트 탭(A~D) = 엑셀 시트 한 장. Pillar는 표 위 가로 막대(행 머리), 그 아래 병목 1·2·3 행. 셀은 엑셀처럼: 한 번 눌러 선택 → Del 삭제 → 더블클릭·Enter·타이핑으로 편집.
//    노란 칸(실제결과·사유·개선계획·근거자료)과 목표·달성기준은 글자색 검정·빨강·파랑을 바꿔 적을 수 있다(RichCell).
//    완료·해당없음이 아니면 사유·개선계획이 필수(빈 칸이 붉게), 미흡·미착수 행은 왼쪽 띠.
//  - 파트 안에 [파트 종합] + 팀원 박스(× 로 기록 삭제). 팀원은 자기 박스에서 적고, 파트장은 종합에서 모아 넣는다. 통계·통합집계는 파트 종합 행 기준.
//  - AI 보조(엣지 okr-assist): ✨정리(메모 → 양식) · ✨합치기(팀원 → 종합, 건수 합산) · ✨초안(파트 결과 → 팀장 피드백). 숫자는 만들지 않는다.
//  - 디자인 원칙(2026-09-24 사용자): 설명 문구·이모지 없이, 색은 판정 등급과 노란 입력칸에만.
//  - 저장은 자동(0.7초 디바운스). 같은 칸을 두 사람이 동시에 고치면 나중 저장이 이긴다.
import { useEffect, useMemo, useRef, useState } from "react";
import PortalSelect from "./PortalSelect";
import RichCell from "./RichCell";
import JudgmentPicker from "./JudgmentPicker";
import { askConfirm } from "./confirmModal";
import { useAuthorBook } from "./authors";
import { teamForAuthor } from "./operations";
import {
  JUDGMENT_INFO, OKR_PILLARS, OKR_TEAMS, achievementRate, actionMembers, actionTeams, bottleneckLabel, cycleLabel, defaultCycleTitle,
  defaultGoalTemplate, deleteOkrReport, emptyGoal, emptyReport, emptyResultRow, findReport, getOkrReports, isAlert, listOkrCycles, memberReports,
  mergeMemberActuals, monthCycleId, needsReasonPlan, normalizeJudgment, okrAssist, pillarIndex, pillarLabel, probeOkrSchema, remapFeedback, remapReports,
  renumberGoals, reportKey, resultRowFor, saveOkrCycle, saveOkrReport, worstJudgment, worstOfJudgments,
  type OkrCycle, type OkrGoal, type OkrReport, type OkrResultRow, type OkrTeam, type RichField,
} from "./okr";

type Tab = "all" | OkrTeam;
type SaveStatus = "idle" | "saving" | "saved" | "error";
type GoalOps = { onGoal: (no: number, patch: Partial<OkrGoal>) => void; onPillar: (nos: number[], idx: number) => void; onInsert: (afterNo: number, pillarFull: string) => void; onRemove: (goal: OkrGoal) => void };

const kstToday = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
const teamName = (team: string) => `${team}파트`;
const pad = (n: number) => String(n).padStart(2, "0");
const sig = (c: OkrCycle) => JSON.stringify({ goals: c.goals, feedback: c.feedback, title: c.title });
const shortBottleneck = (goals: OkrGoal[], no: number) => bottleneckLabel(goals, no).replace("병목현상", "병목");
// 노란 칸의 색 정보 갱신 — 평문으로 바뀐 칸(AI·합치기)은 색을 지운다
const withHtml = (row: OkrResultRow, field: RichField, html: string | undefined): OkrResultRow["html"] => {
  const next = { ...(row.html || {}) };
  if (html) next[field] = html; else delete next[field];
  return Object.keys(next).length ? next : undefined;
};
const clearHtml = (row: OkrResultRow, fields: RichField[]): OkrResultRow["html"] => {
  const next = { ...(row.html || {}) };
  for (const f of fields) delete next[f];
  return Object.keys(next).length ? next : undefined;
};
const goalHtml = (g: OkrGoal, field: "objective" | "criteria", html: string | undefined): OkrGoal["html"] => {
  const next = { ...(g.html || {}) };
  if (html) next[field] = html; else delete next[field];
  return Object.keys(next).length ? next : undefined;
};

const TD = "border border-slate-200 align-top";
const TD_READ = `${TD} px-2 py-1.5`;
const TD_CELL = `${TD} h-px p-0`; // h-px: 안의 셀(RichCell)이 칸 높이를 꽉 채우게(어디를 눌러도 반응)
const TD_EDIT = `${TD_CELL} focus-within:ring-2 focus-within:ring-inset focus-within:ring-slate-400`;
const TD_WRITE = `${TD_CELL} bg-[#FFFBEB] focus-within:bg-white`;
const TH_READ = "border border-slate-300 bg-slate-100 px-2 py-1.5 text-slate-600";
const TH_WRITE = "border border-slate-300 bg-[#FDECB3] px-2 py-1.5 text-slate-800";
const LINK = "text-slate-500 hover:text-slate-900 hover:underline disabled:opacity-40";
const INLINE_SELECT = "!rounded-md !border-0 !bg-transparent !px-1.5 !py-0.5 !text-[12px] !font-bold !text-slate-200 hover:!bg-white/10"; // 제목 블록 안의 글자 드롭다운

// 열 너비 — 머리 칸 오른쪽 가장자리를 끌어 조절(엑셀처럼, 2026-09-24). 이 브라우저에 기억(localStorage), 가장자리를 두 번 누르면 기본값.
function useColWidths(storageKey: string, defaults: number[]) {
  const [widths, setWidths] = useState<number[]>(() => {
    try { const saved = JSON.parse(localStorage.getItem(storageKey) || "null"); if (Array.isArray(saved) && saved.length === defaults.length) return saved.map((n) => Math.max(40, Number(n) || 0)); } catch { /* 무시 */ }
    return defaults;
  });
  const persist = (next: number[]) => { try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* 무시 */ } };
  const startDrag = (index: number, e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const start = widths[index];
    let latest = widths;
    const onMove = (ev: MouseEvent) => { const next = [...latest]; next[index] = Math.max(40, start + ev.clientX - startX); latest = next; setWidths(next); };
    const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); persist(latest); };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
  const resetCol = (index: number) => { const next = [...widths]; next[index] = defaults[index]; setWidths(next); persist(next); };
  return { widths, total: widths.reduce((a, b) => a + b, 0), startDrag, resetCol };
}
const ResizeHandle = ({ onDrag, onReset }: { onDrag: (e: React.MouseEvent) => void; onReset: () => void }) => <span onMouseDown={onDrag} onDoubleClick={onReset} title="끌어서 너비 조절 · 두 번 누르면 기본" className="absolute -right-[3px] top-0 z-10 h-full w-[7px] cursor-col-resize select-none hover:bg-slate-400/60" />;

// Pillar 행 머리 — 표 위 가로 막대. 고칠 수 있는 화면(파트 종합·통합집계)에서는 여기서 Pillar를 바꾸고 병목을 추가한다.
function PillarBar({ idx, colSpan, editable, onPillar, onAdd }: { idx: number; colSpan: number; editable: boolean; onPillar: (i: number) => void; onAdd: () => void }) {
  return <tr><td colSpan={colSpan} className="border border-slate-800 bg-slate-800 px-2 py-1 text-[12px] font-black text-white">
    <div className="flex items-center gap-3">
      {editable
        ? <select value={String(idx)} onChange={(e) => onPillar(Number(e.target.value))} className="cursor-pointer bg-slate-800 text-[12px] font-black text-white outline-none">
          <option value="-1">Pillar 미정</option>
          {OKR_PILLARS.map((p, i) => <option key={p.label} value={String(i)}>Pillar {i + 1} · {p.label}</option>)}
        </select>
        : <span className="px-1">{idx >= 0 ? `Pillar ${idx + 1} · ${OKR_PILLARS[idx].label}` : "Pillar 미정"}</span>}
      {editable && <button type="button" onClick={onAdd} className="ml-auto text-[11px] font-bold text-slate-400 hover:text-white">＋ 병목</button>}
    </div>
  </td></tr>;
}

// 병목 칸 — "병목 n" + 작은 ×(목표 삭제, 고칠 수 있을 때만)
function BottleneckCell({ goals, goal, alert, alertTone, editable, onRemove }: { goals: OkrGoal[]; goal: OkrGoal; alert: boolean; alertTone: string; editable: boolean; onRemove: (g: OkrGoal) => void }) {
  return <td className={`${TD_READ} text-[11px] font-bold text-slate-500 ${alert ? `border-l-4 ${alertTone}` : ""}`}>
    <div className="flex items-start justify-between gap-1">{shortBottleneck(goals, goal.no)}{editable && <button type="button" title="이 목표 삭제" onClick={() => onRemove(goal)} className="text-slate-300 hover:text-rose-600">×</button>}</div>
  </td>;
}

function JudgmentBadge({ value }: { value: string }) {
  const j = normalizeJudgment(value);
  if (!j) return <span className="text-[11px] text-slate-300">—</span>;
  return <span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-bold ${JUDGMENT_INFO[j].tone}`}>{j}</span>;
}

// 연속된 같은 Pillar 목표를 한 묶음으로(막대 하나 + 병목 1·2·3 행)
function pillarRuns(goals: OkrGoal[]): Array<{ idx: number; goals: OkrGoal[] }> {
  const out: Array<{ idx: number; goals: OkrGoal[] }> = [];
  for (const g of goals) {
    const idx = pillarIndex(g.pillar);
    const last = out[out.length - 1];
    if (last && last.idx === idx) last.goals.push(g);
    else out.push({ idx, goals: [g] });
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
          reportSavedRef.current = Object.fromEntries(rows.map((r) => [reportKey(r), repSig(r)]));
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
  // 자동 저장 — 달(공통 목표·피드백)
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

  // 자동 저장 — 파트·팀원 결과(바뀐 것만, 파트 고유 목표 포함). 초안 달이면 달 행을 먼저 만든다(외래키).
  useEffect(() => {
    if (!cycle || loading || loadedCycleRef.current !== cycle.id) return;
    const dirty = reports.filter((r) => repSig(r) !== (reportSavedRef.current[reportKey(r)] || ""));
    if (!dirty.length) return;
    pendingReportsRef.current = dirty;
    const timer = window.setTimeout(async () => {
      pendingReportsRef.current = [];
      try {
        if (!cyclesRef.current.some((c) => c.id === cycle.id)) { await saveOkrCycle(cycle, author); cycleSavedRef.current = sig(cycle); rememberSaved(cycle); }
        await Promise.all(dirty.map((r) => saveOkrReport(r, author).then(() => { reportSavedRef.current[reportKey(r)] = repSig(r); })));
        setSaveStatus("saved");
      } catch (e) { setSaveStatus("error"); setMessage((e as Error).message); }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [reports, cycle, author, loading]);

  const commonGoals = cycle?.goals || [];
  const partOf = (team: OkrTeam) => findReport(reports, team, "");
  const hasCustom = (team: string) => !!findReport(reports, team, "")?.goals?.length;
  // 파트가 보는 목표 — 고유 목표가 있으면 그것, 없으면 달의 공통 목표
  const teamGoalsOf = (team: OkrTeam): OkrGoal[] => { const own = partOf(team)?.goals; return own?.length ? own : commonGoals; };
  const updateCycle = (patch: Partial<OkrCycle>) => { setSaveStatus("saving"); setCycle((cur) => (cur ? { ...cur, ...patch } : cur)); };
  const setFeedback = (no: number, memo: string, memoHtml?: string) => updateCycle({ feedback: { ...(cycle?.feedback || {}), [String(no)]: { ...(cycle?.feedback?.[String(no)] || { memo: "" }), memo, memoHtml } } });
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

  // 목표 편집 — scope "common"은 달의 공통 목표(통합집계), 파트면 그 파트 고유 목표(처음 고칠 때 공통을 복사).
  // 번호가 바뀌면(삽입·삭제) 결과 행도 같이 옮긴다: 공통은 고유 목표가 없는 파트만, 파트는 그 파트(종합+팀원)만.
  const goalOpsFor = (scope: "common" | OkrTeam): GoalOps => {
    const current = scope === "common" ? commonGoals : teamGoalsOf(scope);
    const write = (next: OkrGoal[]) => (scope === "common" ? updateCycle({ goals: next }) : patchReport(scope, "", (r) => ({ ...r, goals: next })));
    const only = scope === "common" ? (r: OkrReport) => !hasCustom(r.team) : (r: OkrReport) => r.team === scope;
    const reorder = (next: OkrGoal[], remap: Map<number, number>) => {
      if (scope === "common") updateCycle({ goals: renumberGoals(next), feedback: remapFeedback(cycle?.feedback || {}, remap) });
      else write(renumberGoals(next));
      setReports((cur) => remapReports(cur, remap, only));
    };
    return {
      onGoal: (no, patch) => write(current.map((g) => (g.no === no ? { ...g, ...patch } : g))),
      onPillar: (nos, idx) => write(current.map((g) => (nos.includes(g.no) ? { ...g, pillar: idx >= 0 ? OKR_PILLARS[idx].full : "" } : g))),
      onInsert: (afterNo, pillarFull) => {
        const at = current.findIndex((g) => g.no === afterNo);
        reorder([...current.slice(0, at + 1), { ...emptyGoal(0), pillar: pillarFull }, ...current.slice(at + 1)], new Map(current.map((g) => [g.no, g.no <= afterNo ? g.no : g.no + 1])));
      },
      onRemove: (goal) => { void (async () => {
        const affected = reports.filter(only).filter((r) => { const row = resultRowFor(r, goal.no); return row.actual || row.judgment; }).map((r) => `${teamName(r.team)}${r.member ? ` ${r.member}` : ""}`);
        const ok = await askConfirm(`${pillarLabel(goal.pillar)} ${shortBottleneck(current, goal.no)} 목표를 삭제할까요?${affected.length ? `\n\n이미 결과를 적은 곳: ${affected.join(", ")} — 그 결과도 함께 지워집니다.` : ""}`, { danger: true, okLabel: "삭제" });
        if (!ok) return;
        const remaining = current.filter((g) => g.no !== goal.no);
        reorder(remaining, new Map(remaining.map((g, i) => [g.no, i + 1])));
      })(); },
    };
  };
  const copyGoalsFrom = (sourceId: string) => {
    const src = cycles.find((c) => c.id === sourceId);
    if (!src) return;
    updateCycle({ goals: src.goals.map((g) => ({ ...g })) });
    setMessage(`${cycleLabel(src)} 목표 ${src.goals.length}개를 가져왔어요`);
  };

  const monthLabel = cycle ? `${cycle.year}년 ${cycle.month}월` : "";
  const goalPayload = (g: OkrGoal) => ({ no: g.no, pillar: pillarLabel(g.pillar), objective: g.objective, criteria: g.criteria });
  const goalNameIn = (goals: OkrGoal[], no: number) => { const g = goals.find((x) => x.no === no); return g ? `${pillarLabel(g.pillar)} ${shortBottleneck(goals, no)}` : `${no}번`; };

  // 팀원 기록 삭제(박스 ×) — 명단에 있는 사람은 박스는 남고 이 달 기록만 지워진다
  const removeMember = async (team: OkrTeam, name: string) => {
    const rec = findReport(reports, team, name);
    const filled = rec ? rec.rows.filter((x) => x.actual || x.judgment).length : 0;
    const inRoster = rosterOf(team).includes(name);
    const ok = await askConfirm(`${name}의 ${monthLabel} ${teamName(team)} 기록을 지울까요?${filled ? `\n적힌 목표 ${filled}개가 지워지며 되돌릴 수 없습니다.` : ""}${inRoster ? "\n(인원 명단에 있는 사람이라 박스는 남습니다 — 명단에서 빼려면 관리 › 인원)" : ""}`, { danger: true, okLabel: "지우기" });
    if (!ok) return;
    try {
      if (rec) await deleteOkrReport(cycleId, team, name);
      setReports((cur) => cur.filter((r) => !(r.team === team && r.member === name)));
      delete reportSavedRef.current[reportKey({ team, member: name })];
      if (member === name) setMember("");
      setMessage(`${name} 기록을 지웠어요`);
    } catch (e) { setMessage((e as Error).message); }
  };

  // 팀원들이 적은 실제결과를 파트 종합 칸으로 — 비어 있으면 넣고, 있으면 뒤에 덧붙인다. 종합판정이 비어 있으면 팀원 판정 중 가장 나쁜 것을 넣는다.
  const mergeMembers = async (team: OkrTeam, no: number) => {
    const goals = teamGoalsOf(team);
    const members = memberReports(reports, team);
    const merged = mergeMemberActuals(members, no);
    if (!merged) { setMessage(`${goalNameIn(goals, no)}에 팀원이 적은 실제결과가 아직 없어요.`); return; }
    const part = resultRowFor(partOf(team), no);
    if (part.actual.trim() && !(await askConfirm(`${goalNameIn(goals, no)} 종합 실제결과에 이미 내용이 있어요. 팀원 기록을 그 뒤에 덧붙일까요?`, { okLabel: "덧붙이기" }))) return;
    const judgment = part.judgment || worstOfJudgments(members.map((m) => resultRowFor(m, no).judgment));
    updateResult(team, "", no, { actual: part.actual.trim() ? `${part.actual.trimEnd()}\n${merged}` : merged, judgment, html: clearHtml(part, ["actual"]) });
  };
  // ✨ 메모 → 양식. 실제결과·종합판정은 바꾸고, 사유·개선계획·근거자료는 비어 있는 칸만 채운다.
  const aiFormat = async (team: OkrTeam, who: string, no: number) => {
    const goals = teamGoalsOf(team);
    const goal = goals.find((g) => g.no === no); if (!goal) return;
    const row = resultRowFor(findReport(reports, team, who), no);
    if (!row.actual.trim()) { setMessage("실제결과 칸에 한 일을 대충이라도 적은 뒤 ✨정리를 누르세요 (예: 계약서 8건 중 5건 확인, 3건은 카톡만 보냄)"); return; }
    const key = `fmt|${team}|${who}|${no}`;
    setAiBusy(key);
    try {
      const res = await okrAssist({ mode: "format", month: monthLabel, goal: goalPayload(goal), text: row.actual, reason: row.reason, plan: row.plan, evidence: row.evidence });
      const filled: RichField[] = ["actual", ...(["reason", "plan", "evidence"] as RichField[]).filter((f) => !row[f].trim() && res[f])];
      updateResult(team, who, no, {
        actual: res.actual || row.actual, judgment: normalizeJudgment(res.judgment || "") || row.judgment,
        reason: row.reason.trim() ? row.reason : res.reason || "", plan: row.plan.trim() ? row.plan : res.plan || "", evidence: row.evidence.trim() ? row.evidence : res.evidence || "",
        html: clearHtml(row, filled),
      });
      setMessage("양식으로 정리했어요 — 숫자와 (수치 없음) 표시를 확인해 주세요");
    } catch (e) { setMessage(`정리 실패: ${(e as Error).message}`); }
    finally { setAiBusy(""); }
  };
  // ✨ 팀원 기록 → 파트 종합(건수 합산). 종합 칸을 통째로 바꾼다(있으면 확인).
  const aiMerge = async (team: OkrTeam, no: number) => {
    const goals = teamGoalsOf(team);
    const goal = goals.find((g) => g.no === no); if (!goal) return;
    const members = memberReports(reports, team).map((m) => ({ name: m.member, ...resultRowFor(m, no) })).filter((m) => m.actual.trim() || m.judgment);
    if (!members.length) { setMessage(`${goalNameIn(goals, no)}에 팀원 기록이 아직 없어요.`); return; }
    const part = resultRowFor(partOf(team), no);
    if ((part.actual.trim() || part.reason.trim()) && !(await askConfirm(`${goalNameIn(goals, no)} 종합 칸(실제결과·판정·사유·개선계획·근거자료)을 팀원 ${members.length}명 기록으로 다시 씁니다. 지금 내용은 덮어씁니다.`, { okLabel: "다시 쓰기" }))) return;
    const key = `mrg|${team}|${no}`;
    setAiBusy(key);
    try {
      const res = await okrAssist({ mode: "merge", month: monthLabel, goal: goalPayload(goal), members: members.map(({ name, actual, judgment, reason, plan, evidence }) => ({ name, actual, judgment, reason, plan, evidence })) });
      updateResult(team, "", no, { actual: res.actual || part.actual, judgment: normalizeJudgment(res.judgment || "") || part.judgment, reason: res.reason || part.reason, plan: res.plan || part.plan, evidence: res.evidence || part.evidence, html: undefined });
      setMessage(`팀원 ${members.length}명 기록을 합쳐 종합 칸을 채웠어요 — 합산 건수를 확인해 주세요`);
    } catch (e) { setMessage(`합치기 실패: ${(e as Error).message}`); }
    finally { setAiBusy(""); }
  };
  // ✨ 파트 결과 → 팀장 피드백 초안(공통 목표 기준)
  const aiFeedback = async (no: number) => {
    const goal = commonGoals.find((g) => g.no === no); if (!goal) return;
    const teams = OKR_TEAMS.map((t) => ({ team: t, ...resultRowFor(partOf(t), no) })).filter((t) => t.actual.trim() || t.judgment);
    if (!teams.length) { setMessage(`${goalNameIn(commonGoals, no)}에 파트 결과가 아직 없어요.`); return; }
    const existing = cycle?.feedback?.[String(no)]?.memo || "";
    if (existing.trim() && !(await askConfirm(`${goalNameIn(commonGoals, no)} 피드백 칸에 이미 글이 있어요. 초안으로 바꿀까요?`, { okLabel: "바꾸기" }))) return;
    const key = `fb|${no}`;
    setAiBusy(key);
    try {
      const res = await okrAssist({ mode: "feedback", month: monthLabel, goal: goalPayload(goal), teams: teams.map(({ team, actual, judgment, reason, plan, evidence }) => ({ team, actual, judgment, reason, plan, evidence })) });
      if (res.memo) { setFeedback(no, res.memo, undefined); setMessage("피드백 초안을 넣었어요 — 팀장님 말로 다듬어 주세요"); }
    } catch (e) { setMessage(`초안 실패: ${(e as Error).message}`); }
    finally { setAiBusy(""); }
  };

  const monthsWithData = useMemo(() => new Set(cycles.filter((c) => c.kind === "month" && c.year === year).map((c) => c.month)), [cycles, year]);
  const years = useMemo(() => { const ys = new Set<number>([Number(today.slice(0, 4)), Number(today.slice(0, 4)) - 1, ...cycles.map((c) => c.year)]); return [...ys].sort((a, b) => b - a); }, [cycles, today]);
  const tabs: Array<[Tab, string]> = [["all", "통합집계"], ...OKR_TEAMS.map((t) => [t, teamName(t)] as [Tab, string])];
  const isDraft = !!cycle && !cycles.some((c) => c.id === cycle.id); // 아직 DB에 없는 달(지난달 목표를 복사한 초안)

  if (!author) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm font-semibold text-amber-800">FIELD에서 작성자를 먼저 선택해 주세요.</div>;

  return <div className="space-y-4 pb-16">
    {(!cycle || tableMissing) && !loading && <div className="rounded-xl bg-[#1E252F] px-5 py-4 text-sm font-black text-white">OKR · {year}년 {month}월</div>}
    {tableMissing && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><b>OKR 표가 아직 없습니다.</b> Supabase SQL Editor에서 <code className="rounded bg-white px-1">supabase/okr.sql</code>(표 만들기)을 한 번 실행한 뒤 이 화면을 다시 열어 주세요.</div>}
    {needsUpgrade && !tableMissing && <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"><b>OKR 표를 한 번 더 올려야 합니다.</b> 팀원별 기록 칸(member)이 없는 예전 표라 저장이 안 됩니다. Supabase SQL Editor에서 <code className="rounded bg-white px-1">supabase/okr.sql</code>을 다시 실행하면(기존 내용은 그대로) 바로 됩니다.</div>}
    {message && !tableMissing && <div className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white">{message}</div>}

    {cycle && !tableMissing && <>
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="bg-[#1E252F] px-5 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="-ml-1.5 flex flex-wrap items-center gap-x-0.5 gap-y-1 text-[12px] font-bold text-slate-300">
                <PortalSelect tone="dark" className={INLINE_SELECT} width={110} value={String(year)} onChange={(v) => openMonth(Number(v), month)} options={years.map((y) => ({ value: String(y), label: `${y}년` }))} />
                <span className="px-1 text-slate-500">·</span><span className="px-1 tabular-nums">{cycle.start_date} ~ {cycle.end_date}</span>
                {saveStatus === "saving" && <span className="ml-2 text-slate-400">저장 중…</span>}
                {saveStatus === "error" && <span className="ml-2 text-rose-300">저장 실패</span>}
              </div>
              <h2 className="mt-1 text-lg font-black tracking-tight text-white lg:text-xl">{cycle.title || defaultCycleTitle(cycle)}</h2>
              {isDraft && <p className="mt-1 text-[11px] font-semibold text-slate-400">{commonGoals.some((g) => g.objective) ? "아직 기록이 없는 달 — 지난달 목표를 그대로 가져왔습니다" : "아직 목표가 없는 달 — 표에서 바로 적어 주세요"}</p>}
            </div>
            <div className="grid w-full grid-cols-6 gap-1 rounded-full bg-white/10 p-1 sm:grid-cols-12 lg:w-[560px] lg:shrink-0">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <button key={m} type="button" onClick={() => openMonth(year, m)} className={`relative rounded-full px-1 py-1.5 text-xs font-bold transition sm:text-sm ${month === m ? "bg-white text-slate-950" : monthsWithData.has(m) ? "text-slate-200 hover:bg-white/10" : "text-slate-500 hover:bg-white/10"}`}>{m}월{monthsWithData.has(m) && month !== m && <span className="absolute right-1.5 top-1.5 h-1 w-1 rounded-full bg-white/70" />}</button>)}
            </div>
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto px-3 pt-2">
          {tabs.map(([key, label]) => {
            const rep = key === "all" ? undefined : findReport(reports, key, "");
            const goals = key === "all" ? commonGoals : teamGoalsOf(key);
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
          ? <SummaryView cycle={cycle} cycles={cycles} reports={reports} aiBusy={aiBusy} customTeams={OKR_TEAMS.filter(hasCustom)} onFeedback={setFeedback} onAiFeedback={(no) => void aiFeedback(no)} onCopyGoals={copyGoalsFrom} onTemplate={() => updateCycle({ goals: defaultGoalTemplate() })} {...goalOpsFor("common")} />
          : <TeamView team={tab} cycle={cycle} goals={teamGoalsOf(tab)} custom={hasCustom(tab)} reports={reports} member={member} onMember={setMember} onRemoveMember={(name) => void removeMember(tab, name)} roster={rosterOf(tab)} author={author} aiBusy={aiBusy}
              onHeader={(patch) => patchReport(tab, "", (r) => ({ ...r, header: { ...r.header, ...patch } }))}
              onResult={(no, patch) => updateResult(tab, member, no, patch)}
              onResetGoals={() => { void (async () => { if (await askConfirm(`${teamName(tab)} 고유 목표를 지우고 달의 공통 목표를 다시 따를까요?`, { okLabel: "공통으로" })) patchReport(tab, "", (r) => ({ ...r, goals: undefined })); })(); }}
              onMerge={(no) => void mergeMembers(tab, no)} onAiMerge={(no) => void aiMerge(tab, no)} onAiFormat={(no) => void aiFormat(tab, member, no)} {...goalOpsFor(tab)} />}
    </>}
  </div>;
}

const repSig = (r: OkrReport) => JSON.stringify({ header: r.header, rows: r.rows, goals: r.goals });

// ── 사람 박스(파트 종합 / 팀원) — 이름 · 판정 n/9 · 미흡 수. 팀원 박스는 고른 상태에서 ×로 기록 삭제 ──
function PersonBox({ label, sub, rows, total, selected, onClick, onRemove }: { label: string; sub?: string; rows: OkrResultRow[]; total: number; selected: boolean; onClick: () => void; onRemove?: () => void }) {
  const judged = rows.filter((r) => normalizeJudgment(r.judgment)).length;
  const alerts = rows.filter((r) => isAlert(r.judgment)).length;
  const pct = total ? Math.round((judged / total) * 100) : 0;
  return <div role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }} className={`relative w-[128px] shrink-0 cursor-pointer rounded-lg border p-2.5 text-left transition ${selected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-800 hover:border-slate-400"}`}>
    <div className="flex items-baseline justify-between gap-1"><span className="truncate text-[13px] font-black">{label}</span><span className={`text-[11px] font-bold tabular-nums ${selected ? "text-slate-300" : "text-slate-400"}`}>{judged}/{total}</span></div>
    <div className="h-4 text-[10px] font-semibold text-slate-400">{alerts ? <span className={selected ? "text-rose-300" : "text-rose-600"}>미흡·미착수 {alerts}</span> : sub || ""}</div>
    <div className={`mt-1 h-1 overflow-hidden rounded-full ${selected ? "bg-white/20" : "bg-slate-100"}`}><div className={`h-full transition-all ${selected ? "bg-white" : "bg-slate-800"}`} style={{ width: `${pct}%` }} /></div>
    {onRemove && selected && <button type="button" title="이 사람의 이 달 기록 삭제" onClick={(e) => { e.stopPropagation(); onRemove(); }} className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-[11px] font-black text-slate-500 hover:border-rose-400 hover:text-rose-600">×</button>}
  </div>;
}

// ── 파트 시트: Pillar 막대 + 병목 1·2·3 행, 열 머리는 엑셀과 같게(No·Pillar 열은 막대로 대신), 격자 셀 ──
const COLS: Array<[string, number, "read" | "write"]> = [
  ["병목", 58, "read"], ["목표", 220, "read"], ["달성기준", 250, "read"],
  ["실제결과", 300, "write"], ["종합판정", 104, "write"], ["사유", 210, "write"], ["개선계획", 210, "write"], ["근거자료", 210, "write"],
];

function TeamView({ team, cycle, goals, custom, reports, member, onMember, onRemoveMember, roster, author, aiBusy, onHeader, onResult, onResetGoals, onMerge, onAiMerge, onAiFormat, onGoal, onPillar, onInsert, onRemove }: {
  team: OkrTeam; cycle: OkrCycle; goals: OkrGoal[]; custom: boolean; reports: OkrReport[]; member: string; onMember: (m: string) => void; onRemoveMember: (name: string) => void; roster: string[]; author: string; aiBusy: string;
  onHeader: (patch: Partial<OkrReport["header"]>) => void; onResult: (no: number, patch: Partial<OkrResultRow>) => void; onResetGoals: () => void; onMerge: (no: number) => void; onAiMerge: (no: number) => void; onAiFormat: (no: number) => void;
} & GoalOps) {
  const partReport = findReport(reports, team, "") || emptyReport(cycle.id, team, "");
  const members = memberReports(reports, team);
  const memberNames = useMemo(() => { const seen = new Set<string>(); return [...roster, ...members.map((m) => m.member)].filter((n) => n && !seen.has(n) && seen.add(n)); }, [roster, members]);
  const current = member ? (findReport(reports, team, member) || emptyReport(cycle.id, team, member)) : partReport;
  const editable = !member; // 목표·달성기준·Pillar는 파트 종합에서만 고친다
  const [openMembers, setOpenMembers] = useState<Record<number, boolean>>({});
  const runs = pillarRuns(goals);
  const addOtherName = () => {
    const name = window.prompt("이 파트에 기록할 이름(관리 › 인원 명단에 없는 사람)");
    if (name && name.trim()) onMember(name.trim());
  };
  const rowsOf = (r: OkrReport | undefined) => goals.map((g) => resultRowFor(r, g.no));
  const col = useColWidths("okr_cols_team", COLS.map(([, w]) => w));
  const rich = (row: OkrResultRow, field: RichField, no: number, placeholder: string, extra = "") => <RichCell text={row[field]} html={row.html?.[field]} placeholder={placeholder} className={extra} minRows={3} onChange={(t, h) => onResult(no, { [field]: t, html: withHtml(row, field, h) })} />;
  const goalCell = (goal: OkrGoal, field: "objective" | "criteria", placeholder: string, extra = "") => <RichCell text={goal[field]} html={goal.html?.[field]} placeholder={placeholder} className={extra} minRows={2} readOnly={!editable} onChange={(t, h) => onGoal(goal.no, { [field]: t, html: goalHtml(goal, field, h) })} />;

  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    {/* 사람 박스 */}
    <div className="flex flex-wrap items-stretch gap-2 border-b border-slate-200 bg-slate-50 p-3">
      <PersonBox label="파트 종합" sub="통합집계에 반영" rows={rowsOf(partReport)} total={goals.length} selected={!member} onClick={() => onMember("")} />
      <div role="button" tabIndex={0} onClick={() => onMember("__sum__")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onMember("__sum__"); } }} className={`w-[104px] shrink-0 cursor-pointer rounded-lg border p-2.5 text-left transition ${member === "__sum__" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-800 hover:border-slate-400"}`}>
        <div className="text-[13px] font-black">팀원 집계</div>
        <div className="h-4 text-[10px] font-semibold text-slate-400">{members.length}명 · 조치 필요 인원</div>
        <div className="mt-1 h-1" />
      </div>
      <span className="mx-0.5 hidden w-px self-stretch bg-slate-200 sm:block" />
      {memberNames.map((name) => <PersonBox key={name} label={name} sub={name === author ? "나" : ""} rows={rowsOf(findReport(reports, team, name))} total={goals.length} selected={member === name} onClick={() => onMember(name)} onRemove={() => onRemoveMember(name)} />)}
      <button type="button" onClick={addOtherName} className="w-[64px] shrink-0 rounded-lg border border-dashed border-slate-300 text-[11px] font-bold text-slate-400 hover:bg-white">＋ 이름</button>
      {!memberNames.length && <div className="self-center text-[11px] font-semibold text-slate-400">관리 › 인원 명단에 {teamName(team)} 인원을 넣으면 이름 박스가 생깁니다</div>}
      {editable && custom && <button type="button" onClick={onResetGoals} className="ml-auto self-center text-[11px] font-bold text-slate-400 hover:text-slate-700 hover:underline">{teamName(team)} 고유 목표 사용 중 · 공통으로 되돌리기</button>}
    </div>
    {member === "__sum__" ? <TeamSummary team={team} goals={goals} members={members} partReport={partReport} onMember={onMember} /> : <>
    {/* 제출 정보 — 엑셀 머리 칸처럼(파트 종합에서만) */}
    {!member && <div className="grid grid-cols-2 border-b border-slate-200 text-[12px] lg:grid-cols-4">
      {([["leader", "파트장(부파트장)", "text"], ["author", "작성자", "text"], ["submitted", "제출일", "date"], ["headcount", "파트 인원수", "text"]] as Array<[keyof OkrReport["header"], string, string]>).map(([key, label, type], i) => <label key={key} className={`flex items-center gap-2 px-3 py-1.5 ${i < 3 ? "lg:border-r lg:border-slate-200" : ""} ${i % 2 === 0 ? "border-r border-slate-200" : ""}`}>
        <span className="w-[92px] shrink-0 text-[11px] font-bold text-slate-500">{label}</span>
        <input type={type} value={partReport.header[key]} onChange={(e) => onHeader({ [key]: e.target.value })} placeholder={key === "headcount" ? String(memberNames.length || "") : ""} className="min-w-0 flex-1 rounded bg-[#FFFBEB] px-2 py-1 text-[12px] font-semibold text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-inset focus:ring-slate-400" />
      </label>)}
    </div>}

    <div className="overflow-x-auto">
      <table className="table-fixed border-collapse text-left text-[12px]" style={{ width: col.total, minWidth: col.total }}>
        <colgroup>{COLS.map(([label], i) => <col key={label} style={{ width: col.widths[i] }} />)}</colgroup>
        <thead className="sticky top-0 z-10 text-[11px] font-bold">
          <tr>{COLS.map(([label, , mode], i) => <th key={label} className={`relative ${mode === "write" ? TH_WRITE : TH_READ}`}>{label}<ResizeHandle onDrag={(e) => col.startDrag(i, e)} onReset={() => col.resetCol(i)} /></th>)}</tr>
        </thead>
        <tbody>
          {runs.map((run, ri) => <FragmentRows key={`run-${ri}`}>
            <PillarBar idx={run.idx} colSpan={COLS.length} editable={editable} onPillar={(i) => onPillar(run.goals.map((g) => g.no), i)} onAdd={() => onInsert(run.goals[run.goals.length - 1].no, run.goals[0].pillar)} />
            {run.goals.map((goal) => {
              const row = resultRowFor(current, goal.no);
              const j = normalizeJudgment(row.judgment);
              const suggested = worstJudgment(row.actual);
              const alert = isAlert(row.judgment);
              const mustExplain = needsReasonPlan(row.judgment);
              const memberEntries = !member ? members.map((m) => ({ name: m.member, row: resultRowFor(m, goal.no) })).filter((x) => x.row.actual.trim() || x.row.judgment) : [];
              const open = !member && !!openMembers[goal.no];
              const fmtKey = `fmt|${team}|${member}|${goal.no}`;
              const mrgKey = `mrg|${team}|${goal.no}`;
              return <FragmentRows key={goal.no}>
                <tr>
                  <BottleneckCell goals={goals} goal={goal} alert={alert} alertTone={j === "미착수" ? "border-l-rose-500" : "border-l-orange-500"} editable={editable} onRemove={onRemove} />
                  <td className={editable ? TD_EDIT : TD_CELL}>{goalCell(goal, "objective", "", "font-semibold text-slate-900")}</td>
                  <td className={editable ? TD_EDIT : TD_CELL}>{goalCell(goal, "criteria", "")}</td>
                  <td className={TD_WRITE}>
                    {rich(row, "actual", goal.no, "")}
                    <div className="flex flex-wrap gap-x-3 px-2 pb-1 text-[10px] font-bold">
                      <button type="button" disabled={!!aiBusy} onClick={() => onAiFormat(goal.no)} className={LINK}>{aiBusy === fmtKey ? "정리 중…" : "✨ 정리"}</button>
                      {!member && members.length > 0 && <button type="button" onClick={() => setOpenMembers((cur) => ({ ...cur, [goal.no]: !open }))} className={LINK}>{open ? "팀원 기록 닫기" : `팀원 기록 ${memberEntries.length}`}</button>}
                      {!member && memberEntries.length > 0 && <>
                        <button type="button" disabled={!!aiBusy} onClick={() => onAiMerge(goal.no)} className={LINK}>{aiBusy === mrgKey ? "합치는 중…" : "✨ 합치기"}</button>
                        <button type="button" onClick={() => onMerge(goal.no)} className={LINK}>그대로 모아 넣기</button>
                      </>}
                    </div>
                  </td>
                  <td className={`${TD} h-px p-0 ${j ? JUDGMENT_INFO[j].tone : "bg-[#FFFBEB]"}`}>
                    <JudgmentPicker value={j} suggested={row.actual.trim() ? suggested : ""} onChange={(v) => onResult(goal.no, { judgment: v })} />
                    {suggested && suggested !== j && row.actual.trim() && <button type="button" onClick={() => onResult(goal.no, { judgment: suggested })} className="block w-full px-2 pb-1 text-left text-[10px] font-bold text-slate-500 hover:underline">→ {suggested}로</button>}
                  </td>
                  <td className={`${TD_WRITE} ${mustExplain && !row.reason.trim() ? "!bg-rose-50" : ""}`}>{rich(row, "reason", goal.no, "")}</td>
                  <td className={`${TD_WRITE} ${mustExplain && !row.plan.trim() ? "!bg-rose-50" : ""}`}>{rich(row, "plan", goal.no, "")}</td>
                  <td className={TD_WRITE}>{rich(row, "evidence", goal.no, "")}</td>
                </tr>
                {open && <tr className="bg-slate-50">
                  <td colSpan={COLS.length} className={`${TD} px-3 py-2`}>
                    {memberEntries.length === 0 ? <div className="text-[11px] font-semibold text-slate-400">아직 아무도 적지 않았어요. 팀원은 위 이름 박스에서 자기 기록을 씁니다.</div>
                      : <table className="w-full border-collapse text-[11px]"><colgroup><col style={{ width: 80 }} /><col style={{ width: "32%" }} /><col style={{ width: 76 }} /><col /><col /><col /></colgroup>
                        <thead><tr className="text-[10px] font-bold text-slate-500">{["이름", "실제결과", "종합판정", "사유", "개선계획", "근거자료"].map((h) => <th key={h} className="border border-slate-200 bg-white px-1.5 py-1 text-left">{h}</th>)}</tr></thead>
                        <tbody className="align-top">{memberEntries.map((x) => <tr key={x.name} className="bg-white"><td className="border border-slate-200 px-1.5 py-1 font-black text-slate-800"><button type="button" onClick={() => onMember(x.name)} className="hover:underline">{x.name}</button></td><td className="whitespace-pre-wrap border border-slate-200 px-1.5 py-1 text-slate-700">{x.row.actual}</td><td className="border border-slate-200 px-1.5 py-1"><JudgmentBadge value={x.row.judgment} /></td><td className="whitespace-pre-wrap border border-slate-200 px-1.5 py-1 text-slate-600">{x.row.reason}</td><td className="whitespace-pre-wrap border border-slate-200 px-1.5 py-1 text-slate-600">{x.row.plan}</td><td className="whitespace-pre-wrap border border-slate-200 px-1.5 py-1 text-slate-600">{x.row.evidence}</td></tr>)}</tbody>
                      </table>}
                  </td>
                </tr>}
              </FragmentRows>;
            })}
          </FragmentRows>)}
          {goals.length === 0 && <tr><td colSpan={COLS.length} className="p-8 text-center text-sm font-bold text-slate-400">목표가 없습니다 — 통합집계에서 [3 × 3 빈 틀] 또는 [다른 달 목표 가져오기]</td></tr>}
        </tbody>
      </table>
    </div>
    </>}
  </section>;
}

// ── 팀원 집계: 통합집계와 같은 모양으로, 목표별 팀원 판정 · 조치 필요 인원(미흡·미착수) · 파트 종합판정 ──
function TeamSummary({ team, goals, members, partReport, onMember }: { team: OkrTeam; goals: OkrGoal[]; members: OkrReport[]; partReport: OkrReport; onMember: (m: string) => void }) {
  const runs = pillarRuns(goals);
  const names = members.map((m) => m.member);
  const heads = ["병목", "목표", ...names, "조치 필요 인원", "파트 종합"];
  const col = useColWidths(`okr_cols_teamsum_${team}_${names.length}`, [58, 280, ...names.map(() => 96), 150, 104]);
  const stats = members.map((m) => { const rows = goals.map((g) => resultRowFor(m, g.no)); return { name: m.member, judged: rows.filter((r) => normalizeJudgment(r.judgment)).length, alerts: rows.filter((r) => isAlert(r.judgment)).length, rate: achievementRate(rows) }; });
  return <div className="space-y-3 p-3">
    {stats.length > 0 && <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((st) => <button key={st.name} type="button" onClick={() => onMember(st.name)} className="rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-slate-400">
        <div className="flex items-center justify-between"><div className="text-sm font-black text-slate-900">{st.name}</div><div className="text-[11px] font-bold tabular-nums text-slate-400">{st.judged >= goals.length && goals.length ? "작성 완료" : `판정 ${st.judged}/${goals.length}`}</div></div>
        <div className="mt-1 flex items-end justify-between"><div className="text-2xl font-black tabular-nums text-slate-950">{st.rate === null ? "—" : `${st.rate}%`}<span className="ml-1 text-xs font-semibold text-slate-400">달성</span></div><div className="text-[11px] font-bold">{st.alerts > 0 ? <span className="text-rose-600">미흡·미착수 {st.alerts}</span> : <span className="text-slate-300">미흡 없음</span>}</div></div>
      </button>)}
    </div>}
    <div className="overflow-x-auto">
      <table className="table-fixed border-collapse text-left text-[12px]" style={{ width: col.total, minWidth: col.total }}>
        <colgroup>{heads.map((h, i) => <col key={`${h}-${i}`} style={{ width: col.widths[i] }} />)}</colgroup>
        <thead className="text-[11px] font-bold"><tr>{heads.map((h, i) => <th key={`${h}-${i}`} className={`relative ${TH_READ} ${i >= 2 && i < 2 + names.length ? "text-center" : ""} ${i === heads.length - 1 ? "text-center" : ""}`}>{h}<ResizeHandle onDrag={(e) => col.startDrag(i, e)} onReset={() => col.resetCol(i)} /></th>)}</tr></thead>
        <tbody>
          {runs.map((run, ri) => <FragmentRows key={`run-${ri}`}>
            <PillarBar idx={run.idx} colSpan={heads.length} editable={false} onPillar={() => undefined} onAdd={() => undefined} />
            {run.goals.map((goal) => {
              const alertNames = members.filter((m) => isAlert(resultRowFor(m, goal.no).judgment)).map((m) => m.member);
              const part = resultRowFor(partReport, goal.no);
              const suggested = worstOfJudgments(members.map((m) => resultRowFor(m, goal.no).judgment));
              return <tr key={goal.no}>
                <td className={`${TD_READ} text-[11px] font-bold text-slate-500 ${alertNames.length ? "border-l-4 border-l-orange-500" : ""}`}>{shortBottleneck(goals, goal.no)}</td>
                <td className={`${TD_READ} whitespace-pre-wrap font-semibold leading-snug text-slate-800`}>{goal.objective}</td>
                {members.map((m) => <td key={m.member} className={`${TD} px-1 py-1.5 text-center`}><button type="button" onClick={() => onMember(m.member)} title={`${m.member} 기록 보기`}><JudgmentBadge value={resultRowFor(m, goal.no).judgment} /></button></td>)}
                <td className={`${TD_READ} text-[11px] leading-snug`}>{alertNames.length ? <span className="font-black text-rose-600">{alertNames.join(", ")}</span> : <span className="text-slate-300">—</span>}</td>
                <td className={`${TD} px-1 py-1.5 text-center`}><JudgmentBadge value={part.judgment} />{!normalizeJudgment(part.judgment) && suggested && <div className="mt-0.5 text-[10px] font-bold text-slate-400">제안 {suggested}</div>}</td>
              </tr>;
            })}
          </FragmentRows>)}
          {goals.length === 0 && <tr><td colSpan={heads.length} className="border border-slate-200 p-8 text-center text-sm font-bold text-slate-400">목표가 없습니다</td></tr>}
        </tbody>
      </table>
    </div>
    {!members.length && <div className="text-center text-[12px] font-semibold text-slate-400">아직 팀원 기록이 없습니다 — 팀원이 자기 박스에서 적으면 여기 모입니다</div>}
  </div>;
}

// tbody 안에서 여러 행을 묶는 용도
function FragmentRows({ children }: { children: React.ReactNode }) { return <>{children}</>; }

// ── 통합집계: 엑셀 '1.통합집계' 시트와 같은 열(목표 · 파트별 종합판정 · 조치 필요 파트 · 피드백). 공통 목표를 여기서 고친다 ──
function SummaryView({ cycle, cycles, reports, aiBusy, customTeams, onFeedback, onAiFeedback, onCopyGoals, onTemplate, onGoal, onPillar, onInsert, onRemove }: {
  cycle: OkrCycle; cycles: OkrCycle[]; reports: OkrReport[]; aiBusy: string; customTeams: string[]; onFeedback: (no: number, memo: string, memoHtml?: string) => void; onAiFeedback: (no: number) => void;
  onCopyGoals: (sourceId: string) => void; onTemplate: () => void;
} & GoalOps) {
  const goals = cycle.goals;
  const partRows = reports.filter((r) => !r.member);
  const runs = pillarRuns(goals);
  const perTeam = OKR_TEAMS.map((t) => {
    const rep = partRows.find((r) => r.team === t);
    const teamGoals = rep?.goals?.length ? rep.goals : goals;
    const rows = teamGoals.map((g) => resultRowFor(rep, g.no));
    const ms = memberReports(reports, t);
    return { team: t, rep, total: teamGoals.length, judged: rows.filter((r) => normalizeJudgment(r.judgment)).length, alerts: rows.filter((r) => isAlert(r.judgment)).length, rate: achievementRate(rows), members: ms.map((m) => ({ name: m.member, judged: teamGoals.filter((g) => normalizeJudgment(resultRowFor(m, g.no).judgment)).length })) };
  });
  const otherMonths = cycles.filter((c) => c.kind === "month" && c.id !== cycle.id && c.goals.some((g) => g.objective.trim()));
  const SUMMARY_COLS = 4 + OKR_TEAMS.length; // 병목 · 목표 · 파트별 · 조치 · 피드백
  const col = useColWidths("okr_cols_summary", [58, 300, ...OKR_TEAMS.map(() => 84), 130, 360]);
  const heads = ["병목", "목표 (공통)", ...OKR_TEAMS.map(teamName), "조치 필요 파트", "미흡항목 피드백 & 다음 달 개선 방향"];
  return <div className="space-y-3">
    <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {perTeam.map(({ team, rep, total, judged, alerts, rate, members }) => <div key={team} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between"><div className="text-sm font-black text-slate-900">{teamName(team)}</div><div className="text-[11px] font-bold tabular-nums text-slate-400">{judged >= total && total ? "제출 완료" : `판정 ${judged}/${total}`}</div></div>
        <div className="mt-1 flex items-end justify-between"><div className="text-2xl font-black tabular-nums text-slate-950">{rate === null ? "—" : `${rate}%`}<span className="ml-1 text-xs font-semibold text-slate-400">달성</span></div><div className="text-right text-[11px] font-bold">{alerts > 0 ? <span className="text-rose-600">미흡·미착수 {alerts}</span> : <span className="text-slate-300">미흡 없음</span>}</div></div>
        <div className="mt-2 border-t border-slate-100 pt-2 text-[10px] font-semibold text-slate-400">{rep?.header.leader ? `파트장 ${rep.header.leader}` : "파트장 미기재"}{customTeams.includes(team) ? " · 고유 목표" : ""}{members.length ? ` · ${members.map((m) => `${m.name} ${m.judged}/${total}`).join(", ")}` : ""}</div>
      </div>)}
    </section>

    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {(otherMonths.length > 0 || !goals.some((g) => g.objective.trim())) && <div className="flex flex-wrap items-center justify-end gap-1 border-b border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600">
        {!goals.some((g) => g.objective.trim()) && <button type="button" onClick={onTemplate} className="rounded-lg px-2.5 py-1.5 hover:bg-slate-100">3 × 3 빈 틀</button>}
        {otherMonths.length > 0 && <PortalSelect width={200} value="" onChange={(v) => v && onCopyGoals(v)} options={[{ value: "", label: "다른 달 목표 가져오기…" }, ...otherMonths.map((c) => ({ value: c.id, label: `${cycleLabel(c)} (${c.goals.length}개)` }))]} />}
      </div>}
      <div className="overflow-x-auto">
        <table className="table-fixed border-collapse text-left text-[12px]" style={{ width: col.total, minWidth: col.total }}>
          <colgroup>{heads.map((h, i) => <col key={h} style={{ width: col.widths[i] }} />)}</colgroup>
          <thead className="text-[11px] font-bold"><tr>{heads.map((h, i) => <th key={h} className={`relative ${i === heads.length - 1 ? TH_WRITE : TH_READ} ${i >= 2 && i < 2 + OKR_TEAMS.length ? "text-center" : ""}`}>{h}<ResizeHandle onDrag={(e) => col.startDrag(i, e)} onReset={() => col.resetCol(i)} /></th>)}</tr></thead>
          <tbody>
            {runs.map((run, ri) => <FragmentRows key={`run-${ri}`}>
              <PillarBar idx={run.idx} colSpan={SUMMARY_COLS} editable onPillar={(i) => onPillar(run.goals.map((g) => g.no), i)} onAdd={() => onInsert(run.goals[run.goals.length - 1].no, run.goals[0].pillar)} />
              {run.goals.map((goal) => {
                const actions = actionTeams(reports, goal.no);
                const who = actionMembers(reports, goal.no);
                const fb = cycle.feedback?.[String(goal.no)];
                const fbKey = `fb|${goal.no}`;
                return <tr key={goal.no}>
                  <BottleneckCell goals={goals} goal={goal} alert={actions.length > 0} alertTone="border-l-orange-500" editable onRemove={onRemove} />
                  <td className={TD_EDIT}><RichCell text={goal.objective} html={goal.html?.objective} minRows={2} className="font-semibold text-slate-800" onChange={(t, h) => onGoal(goal.no, { objective: t, html: goalHtml(goal, "objective", h) })} /></td>
                  {OKR_TEAMS.map((t) => <td key={t} className={`${TD} px-1 py-1.5 text-center`}><JudgmentBadge value={resultRowFor(partRows.find((r) => r.team === t), goal.no).judgment} /></td>)}
                  <td className={`${TD_READ} text-[11px] leading-snug`}>{actions.length ? actions.map((t) => <div key={t}><span className="font-black text-rose-600">{t}파트</span>{who[t]?.length ? <span className="text-slate-500"> · {who[t].join(", ")}</span> : null}</div>) : <span className="text-slate-300">—</span>}</td>
                  <td className={TD_WRITE}>
                    <RichCell text={fb?.memo || ""} html={fb?.memoHtml} minRows={2} onChange={(t, h) => onFeedback(goal.no, t, h)} />
                    <div className="px-2 pb-1 text-[10px] font-bold"><button type="button" disabled={!!aiBusy} onClick={() => onAiFeedback(goal.no)} className={LINK}>{aiBusy === fbKey ? "초안 쓰는 중…" : "✨ 초안"}</button></div>
                  </td>
                </tr>;
              })}
            </FragmentRows>)}
            {goals.length === 0 && <tr><td colSpan={SUMMARY_COLS} className="p-8 text-center text-sm font-bold text-slate-400">목표가 없습니다 — 위 [3 × 3 빈 틀] 또는 [다른 달 목표 가져오기]</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </div>;
}
