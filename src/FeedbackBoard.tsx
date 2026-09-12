import { useEffect, useMemo, useRef, useState } from "react";
import { Bug, CheckCircle2, ChevronDown, Lightbulb, MessageSquarePlus, Rocket, Send, ThumbsUp, Wrench } from "lucide-react";
import { insertRow, selectRows, updateRows } from "./supabase";

// 홈 피드백 보드 (2026-09-12) — 직원이 불편·버그·개선점을 자유롭게 적고, 개발자가 답글과
// 구체 개발 지시(프롬프트)를 달아 체크 → "컨펌"하면 status=confirmed(개발 대기)로 넘어간다.
// 개발 파이프라인은 confirmed 항목을 집어 브랜치에서 만들고 결과(미리보기·커밋)를 result_note 등에 되돌려 쓴다.
// 배포는 사람이 마지막에 탭한다(무검토 자동 배포는 하지 않는다 — 55명 화면이다).

export type FeedbackItem = {
  id: number; created_at: string; author: string; category: string; screen: string; content: string;
  status: "new" | "triaged" | "confirmed" | "in_progress" | "done" | "rejected";
  dev_prompt: string; dev_comment: string; checked: boolean; votes: number;
  confirmed_at: string | null; done_at: string | null; result_note: string; commit_ref: string; preview_url: string;
};

const DEV_NAMES = ["이민구"]; // 개발자 컨트롤이 보이는 작성자 — SSO 붙으면 role로 대체
const CATEGORIES = [
  { key: "불편", icon: Wrench, tone: "bg-amber-500/15 text-amber-300" },
  { key: "버그", icon: Bug, tone: "bg-rose-500/15 text-rose-300" },
  { key: "개선", icon: Lightbulb, tone: "bg-blue-500/15 text-blue-300" },
  { key: "기타", icon: MessageSquarePlus, tone: "bg-slate-500/20 text-slate-300" },
];
const SCREENS = ["", "홈", "서비스접수", "일정리스트", "캘린더", "FIELD", "워킨맵", "자동일정", "조회", "관리", "기타"];
const STATUS: Record<FeedbackItem["status"], { label: string; tone: string }> = {
  new: { label: "접수", tone: "bg-white/10 text-slate-300" },
  triaged: { label: "개발자 확인", tone: "bg-blue-500/15 text-blue-300" },
  confirmed: { label: "개발 대기", tone: "bg-violet-500/20 text-violet-200" },
  in_progress: { label: "개발 중", tone: "bg-amber-500/20 text-amber-200" },
  done: { label: "반영 완료", tone: "bg-emerald-500/20 text-emerald-200" },
  rejected: { label: "보류", tone: "bg-slate-600/40 text-slate-400" },
};
const VOTED_KEY = "cs_feedback_voted_v1";

const relTime = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "방금"; if (m < 60) return `${m}분 전`; if (m < 1440) return `${Math.floor(m / 60)}시간 전`; return `${Math.floor(m / 1440)}일 전`;
};
const readVoted = (): number[] => { try { return JSON.parse(localStorage.getItem(VOTED_KEY) || "[]"); } catch { return []; } };

const card = "rounded-2xl border border-white/[0.08] bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]";
const eyebrow = "text-[10px] font-black uppercase tracking-[0.16em] text-slate-500";
const input = "w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5 text-[13px] font-semibold text-white placeholder:text-slate-500 outline-none transition focus:border-blue-400 focus:bg-white/[0.09]";

export default function FeedbackBoard({ author }: { author: string }) {
  const isDev = DEV_NAMES.includes(author);
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("불편");
  const [screen, setScreen] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"open" | "confirmed" | "done" | "all">("open");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [voted, setVoted] = useState<number[]>(readVoted);
  const loadingRef = useRef(false);

  const load = async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      setItems(await selectRows<FeedbackItem>("feedback_items", "select=*&order=created_at.desc&limit=200"));
      setError("");
    } catch (e) { setError(`보드를 못 불러왔습니다: ${(e as Error).message}`); }
    finally { loadingRef.current = false; }
  };
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const submit = async () => {
    const text = content.trim();
    if (!text || busy) return;
    if (!author) { setError("왼쪽 아래에서 작성자를 먼저 골라 주세요 — 누가 적었는지 알아야 답글을 드릴 수 있어요."); return; }
    setBusy(true);
    try {
      await insertRow("feedback_items", { author, category, screen, content: text });
      setContent(""); setScreen("");
      await load();
    } catch (e) { setError(`등록 실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  const patch = async (id: number, fields: Partial<FeedbackItem>) => {
    setItems((current) => current?.map((it) => (it.id === id ? { ...it, ...fields } : it)) ?? current);
    try { await updateRows("feedback_items", `id=eq.${id}`, fields); }
    catch (e) { setError(`저장 실패: ${(e as Error).message}`); void load(); }
  };

  const vote = async (item: FeedbackItem) => {
    if (voted.includes(item.id)) return;
    const next = [...voted, item.id]; setVoted(next);
    try { localStorage.setItem(VOTED_KEY, JSON.stringify(next)); } catch { /* 무시 */ }
    await patch(item.id, { votes: (item.votes || 0) + 1 });
  };

  const confirmChecked = async () => {
    const targets = (items || []).filter((it) => it.checked && (it.status === "new" || it.status === "triaged"));
    if (!targets.length || busy) return;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      for (const it of targets) await updateRows("feedback_items", `id=eq.${it.id}`, { status: "confirmed", confirmed_at: now, checked: false });
      await load();
    } catch (e) { setError(`컨펌 실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  const counts = useMemo(() => {
    const all = items || [];
    return {
      open: all.filter((it) => it.status === "new" || it.status === "triaged").length,
      confirmed: all.filter((it) => it.status === "confirmed" || it.status === "in_progress").length,
      done: all.filter((it) => it.status === "done" || it.status === "rejected").length,
      all: all.length,
      checked: all.filter((it) => it.checked && (it.status === "new" || it.status === "triaged")).length,
    };
  }, [items]);
  const visible = useMemo(() => {
    const all = items || [];
    if (tab === "open") return all.filter((it) => it.status === "new" || it.status === "triaged");
    if (tab === "confirmed") return all.filter((it) => it.status === "confirmed" || it.status === "in_progress");
    if (tab === "done") return all.filter((it) => it.status === "done" || it.status === "rejected");
    return all;
  }, [items, tab]);

  return (
    <div className="relative border-t border-white/[0.08] px-4 py-5 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div><div className={eyebrow}>Feedback</div><h3 className="mt-0.5 text-[15px] font-black text-white">불편·버그·개선점 — 편하게 적어 주세요</h3></div>
        <span className="text-[11px] font-bold text-slate-500">적으면 개발자가 답글을 달고, 컨펌된 건은 자동으로 개발에 들어갑니다</span>
      </div>

      <div className="grid gap-3 lg:grid-cols-12">
        {/* 등록 */}
        <div className={`p-4 lg:col-span-4 ${card}`}>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => { const Icon = c.icon; const on = category === c.key; return (
              <button key={c.key} type="button" onClick={() => setCategory(c.key)} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-black transition ${on ? "bg-white text-slate-950" : `${c.tone} hover:brightness-125`}`}><Icon size={13} />{c.key}</button>
            ); })}
          </div>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={4} placeholder={"예) 워킨맵 확대하면 버벅거려요 / 일정 상세에서 FIELD 버튼이 없어서 두 번 나가야 해요"} className={`mt-3 resize-y ${input}`} />
          <div className="mt-2 flex items-center gap-2">
            <select value={screen} onChange={(e) => setScreen(e.target.value)} className={`${input} py-2 text-[12px]`}>{SCREENS.map((s) => <option key={s} value={s} className="bg-slate-900">{s || "관련 화면(선택)"}</option>)}</select>
            <button type="button" disabled={busy || !content.trim()} onClick={() => void submit()} className="flex shrink-0 items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-[13px] font-black text-white shadow-lg transition hover:bg-blue-500 disabled:opacity-40"><Send size={14} />등록</button>
          </div>
          <div className="mt-2 text-[11px] font-bold text-slate-500">{author ? <>작성자 <span className="text-slate-300">{author}</span>로 올라갑니다</> : "작성자를 고르면 이름으로 올라갑니다"}</div>
          {error && <div className="mt-2 rounded-lg bg-rose-500/10 px-3 py-2 text-[11.5px] font-bold text-rose-300">{error}</div>}
        </div>

        {/* 목록 */}
        <div className={`flex min-h-[280px] flex-col lg:col-span-8 ${card}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] px-3 py-2.5">
            <div className="flex gap-1">
              {([["open", "접수·확인"], ["confirmed", "개발 대기·중"], ["done", "완료"], ["all", "전체"]] as const).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-full px-3 py-1.5 text-[11.5px] font-black transition ${tab === k ? "bg-white text-slate-950" : "text-slate-400 hover:bg-white/10 hover:text-white"}`}>{label} <span className="font-mono">{counts[k]}</span></button>
              ))}
            </div>
            {isDev && (
              <button type="button" disabled={busy || counts.checked === 0} onClick={() => void confirmChecked()} className="flex items-center gap-1.5 rounded-full bg-violet-600 px-3.5 py-1.5 text-[12px] font-black text-white shadow-lg transition hover:bg-violet-500 disabled:opacity-40"><Rocket size={13} />체크한 {counts.checked}건 컨펌 → 개발 대기</button>
            )}
          </div>
          <ul className="divide-y divide-white/[0.06]">
            {items === null && Array.from({ length: 3 }).map((_, i) => <li key={i} className="px-4 py-3"><div className="h-4 w-2/3 animate-pulse rounded bg-white/[0.06]" /></li>)}
            {items !== null && visible.length === 0 && <li className="px-4 py-10 text-center text-[12px] font-bold text-slate-500">{tab === "open" ? "새로 접수된 건이 없습니다 — 첫 의견을 남겨 주세요" : "해당 항목이 없습니다"}</li>}
            {visible.map((it) => {
              const cat = CATEGORIES.find((c) => c.key === it.category) || CATEGORIES[3]; const Icon = cat.icon; const st = STATUS[it.status] || STATUS.new; const open = expanded === it.id;
              return (
                <li key={it.id} className={`px-3 py-3 ${it.checked ? "bg-violet-500/[0.06]" : ""}`}>
                  <div className="flex items-start gap-2.5">
                    {isDev && (it.status === "new" || it.status === "triaged") && (
                      <label className="mt-0.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border border-white/20 bg-white/[0.06]" title="컨펌 대상 체크">
                        <input type="checkbox" checked={it.checked} onChange={(e) => void patch(it.id, { checked: e.target.checked, status: it.status === "new" ? "triaged" : it.status })} className="h-3.5 w-3.5 accent-violet-500" />
                      </label>
                    )}
                    <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${cat.tone}`}><Icon size={13} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-bold text-slate-400">
                        <span className="text-slate-200">{it.author}</span><span>{relTime(it.created_at)}</span>{it.screen && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-300">{it.screen}</span>}
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${st.tone}`}>{st.label}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-[13px] font-semibold leading-5 text-white">{it.content}</p>
                      {it.dev_comment && <div className="mt-2 rounded-lg border-l-2 border-blue-400 bg-blue-500/10 px-3 py-2 text-[12px] font-semibold leading-5 text-blue-100"><span className="mr-1.5 text-[10px] font-black text-blue-300">개발자</span>{it.dev_comment}</div>}
                      {(it.result_note || it.preview_url || it.commit_ref) && (
                        <div className="mt-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-[12px] font-semibold leading-5 text-emerald-100">
                          <span className="mr-1.5 inline-flex items-center gap-1 text-[10px] font-black text-emerald-300"><CheckCircle2 size={11} />결과</span>{it.result_note}
                          {it.preview_url && <a href={it.preview_url} target="_blank" rel="noreferrer" className="ml-2 underline">미리보기 열기</a>}
                          {it.commit_ref && <span className="ml-2 font-mono text-[10.5px] text-emerald-300">{it.commit_ref.slice(0, 7)}</span>}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button type="button" disabled={voted.includes(it.id)} onClick={() => void vote(it)} className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black transition ${voted.includes(it.id) ? "bg-white/10 text-slate-400" : "bg-white/10 text-slate-200 hover:bg-white/20"}`}><ThumbsUp size={11} />나도 그래요 <span className="font-mono">{it.votes || 0}</span></button>
                        {isDev && <button type="button" onClick={() => setExpanded(open ? null : it.id)} className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-black text-slate-200 hover:bg-white/20">개발자 메모 <ChevronDown size={12} className={`transition ${open ? "rotate-180" : ""}`} /></button>}
                      </div>
                      {isDev && open && (
                        <div className="mt-2 space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
                          <label className="block text-[10.5px] font-black text-slate-400">작성자에게 답글<textarea defaultValue={it.dev_comment} rows={2} onBlur={(e) => { if (e.target.value !== it.dev_comment) void patch(it.id, { dev_comment: e.target.value, status: it.status === "new" ? "triaged" : it.status }); }} className={`mt-1 ${input}`} placeholder="예) 확대할 때 끊기는 걸로 이해했어요 — 맞나요?" /></label>
                          <label className="block text-[10.5px] font-black text-violet-300">개발 지시(자동 개발에 그대로 들어가는 문장)<textarea defaultValue={it.dev_prompt} rows={3} onBlur={(e) => { if (e.target.value !== it.dev_prompt) void patch(it.id, { dev_prompt: e.target.value }); }} className={`mt-1 ${input}`} placeholder="예) 워킨맵 모바일 확대 배율에서 드래그 끊김 개선 — 라벨을 캔버스로" /></label>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[10.5px] font-black text-slate-400">상태</span>
                            {(Object.keys(STATUS) as FeedbackItem["status"][]).map((s) => <button key={s} type="button" onClick={() => void patch(it.id, { status: s, ...(s === "done" ? { done_at: new Date().toISOString() } : {}) })} className={`rounded-full px-2.5 py-1 text-[10.5px] font-black transition ${it.status === s ? "bg-white text-slate-950" : `${STATUS[s].tone} hover:brightness-125`}`}>{STATUS[s].label}</button>)}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
