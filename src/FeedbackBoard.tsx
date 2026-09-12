import { useEffect, useMemo, useRef, useState } from "react";
import { Bug, CheckCircle2, ChevronDown, ExternalLink, Lightbulb, Lock, MessageSquarePlus, Rocket, Send, ThumbsUp, Trash2, Undo2, Wrench, XCircle } from "lucide-react";
import { askConfirm } from "./confirmModal";
import { insertRow, selectRows, updateRows } from "./supabase";

// 홈 피드백 보드 (2026-09-12) — 직원이 불편·버그·개선점을 자유롭게 적고, 개발자가 답글과
// 구체 개발 지시(프롬프트)를 달아 체크 → "개발 시작"하면 status=confirmed(개발 대기)로 넘어간다.
// 개발 파이프라인(클라우드 루틴, docs/feedback-pipeline-runner.md)이 confirmed 항목을 집어
// 브랜치에서 구현·테스트·푸시하고 결과(미리보기·커밋·메모)를 되돌려 쓴다(status=review).
// 배포는 개발자가 [배포 요청]을 눌러야 파이프라인이 main에 합친다(auto_deploy를 켠 항목만 바로).
// 상태: new 접수 → triaged 확인 → confirmed 개발 대기 → in_progress 개발 중 → review 미리보기 확인 → deploy 배포 요청 → done / rejected 반려

export type FeedbackStatus = "new" | "triaged" | "confirmed" | "in_progress" | "review" | "deploy" | "done" | "rejected";
export type FeedbackItem = {
  id: number; created_at: string; author: string; category: string; screen: string; content: string;
  status: FeedbackStatus;
  dev_prompt: string; dev_comment: string; checked: boolean; votes: number; auto_deploy: boolean;
  confirmed_at: string | null; started_at: string | null; done_at: string | null; deleted_at: string | null;
  result_note: string; commit_ref: string; preview_url: string; branch: string; run_log: string;
};

const DEV_NAMES = ["이민구"]; // 개발자 컨트롤(개발 시작·반려·삭제·지시)이 보이는 작성자 — SSO 붙으면 role로 대체
const CATEGORIES = [
  { key: "불편", icon: Wrench, tone: "bg-amber-500/15 text-amber-300" },
  { key: "버그", icon: Bug, tone: "bg-rose-500/15 text-rose-300" },
  { key: "개선", icon: Lightbulb, tone: "bg-blue-500/15 text-blue-300" },
  { key: "기타", icon: MessageSquarePlus, tone: "bg-slate-500/20 text-slate-300" },
];
const SCREENS = ["", "홈", "서비스접수", "일정리스트", "캘린더", "FIELD", "워킨맵", "자동일정", "조회", "관리", "기타"];
const STATUS: Record<FeedbackStatus, { label: string; tone: string }> = {
  new: { label: "접수", tone: "bg-white/10 text-slate-300" },
  triaged: { label: "개발자 확인", tone: "bg-blue-500/15 text-blue-300" },
  confirmed: { label: "개발 대기", tone: "bg-violet-500/20 text-violet-200" },
  in_progress: { label: "개발 중", tone: "bg-amber-500/20 text-amber-200" },
  review: { label: "미리보기 확인", tone: "bg-cyan-500/20 text-cyan-200" },
  deploy: { label: "배포 요청", tone: "bg-emerald-500/15 text-emerald-300" },
  done: { label: "반영 완료", tone: "bg-emerald-500/25 text-emerald-100" },
  rejected: { label: "반려", tone: "bg-slate-600/40 text-slate-400" },
};
const OPEN: FeedbackStatus[] = ["new", "triaged"];
const QUEUE: FeedbackStatus[] = ["confirmed", "in_progress", "review", "deploy"];
const CLOSED: FeedbackStatus[] = ["done", "rejected"];
const VOTED_KEY = "cs_feedback_voted_v1";

const relTime = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "방금"; if (m < 60) return `${m}분 전`; if (m < 1440) return `${Math.floor(m / 60)}시간 전`; return `${Math.floor(m / 1440)}일 전`;
};
const readVoted = (): number[] => { try { return JSON.parse(localStorage.getItem(VOTED_KEY) || "[]"); } catch { return []; } };

const card = "rounded-2xl border border-white/[0.08] bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]";
const eyebrow = "text-[10px] font-black uppercase tracking-[0.16em] text-slate-500";
const input = "w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5 text-[13px] font-semibold text-white placeholder:text-slate-500 outline-none transition focus:border-blue-400 focus:bg-white/[0.09]";
const miniBtn = "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black transition";

export default function FeedbackBoard({ author }: { author: string }) {
  const isDev = DEV_NAMES.includes(author);
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("불편");
  const [screen, setScreen] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"open" | "queue" | "done" | "all">("open");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [voted, setVoted] = useState<number[]>(readVoted);
  const loadingRef = useRef(false);

  const load = async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      setItems(await selectRows<FeedbackItem>("feedback_items", "select=*&deleted_at=is.null&order=created_at.desc&limit=200"));
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
    try { await insertRow("feedback_items", { author, category, screen, content: text }); setContent(""); setScreen(""); await load(); }
    catch (e) { setError(`등록 실패: ${(e as Error).message}`); }
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

  // 삭제는 소프트(deleted_at) — 작성자 본인은 접수 상태일 때만, 개발자는 언제든
  const remove = async (item: FeedbackItem) => {
    const ok = await askConfirm(`이 글을 삭제할까요?\n"${item.content.slice(0, 60)}${item.content.length > 60 ? "…" : ""}"`, { danger: true, okLabel: "삭제" });
    if (!ok) return;
    await patch(item.id, { deleted_at: new Date().toISOString() });
    setItems((current) => current?.filter((it) => it.id !== item.id) ?? current);
  };

  // 반려 — 사유(답글) 없이는 못 한다. 작성자가 이유를 봐야 하니까
  const reject = async (item: FeedbackItem, reason: string) => {
    if (!reason.trim()) { setError("반려 사유를 '작성자에게 답글'에 먼저 적어 주세요 — 작성자가 이유를 봅니다."); return; }
    await patch(item.id, { status: "rejected", dev_comment: reason.trim(), checked: false });
  };

  // 개발 시작 — 체크됐고 개발 지시가 있는 것만 큐(confirmed)로. 지시 없는 건 건너뛰고 알린다
  const startDev = async () => {
    const targets = (items || []).filter((it) => it.checked && (OPEN.includes(it.status) || it.status === "rejected"));
    const ready = targets.filter((it) => it.dev_prompt.trim()); const missing = targets.length - ready.length;
    if (!ready.length || busy) { if (missing) setError(`체크한 ${missing}건에 개발 지시가 없습니다 — [개발자 메모]에서 지시를 적어 주세요.`); return; }
    const ok = await askConfirm(`${ready.length}건을 개발 대기 큐에 넣습니다. 클라우드 개발 루틴이 순서대로 브랜치에 구현·테스트하고 결과를 여기에 답니다.${ready.some((it) => it.auto_deploy) ? `\n\n⚠ ${ready.filter((it) => it.auto_deploy).length}건은 '자동 배포'가 켜져 있어 미리보기 없이 main까지 반영됩니다.` : ""}${missing ? `\n(지시 없는 ${missing}건은 제외)` : ""}`, { okLabel: "개발 시작" });
    if (!ok) return;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      for (const it of ready) await updateRows("feedback_items", `id=eq.${it.id}`, { status: "confirmed", confirmed_at: now, checked: false });
      await load(); setTab("queue");
    } catch (e) { setError(`개발 시작 실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  const counts = useMemo(() => {
    const all = items || [];
    const checkedOpen = all.filter((it) => it.checked && (OPEN.includes(it.status) || it.status === "rejected"));
    return {
      open: all.filter((it) => OPEN.includes(it.status)).length,
      queue: all.filter((it) => QUEUE.includes(it.status)).length,
      done: all.filter((it) => CLOSED.includes(it.status)).length,
      all: all.length,
      checked: checkedOpen.length,
      ready: checkedOpen.filter((it) => it.dev_prompt.trim()).length,
    };
  }, [items]);
  const visible = useMemo(() => {
    const all = items || [];
    if (tab === "open") return all.filter((it) => OPEN.includes(it.status));
    if (tab === "queue") return all.filter((it) => QUEUE.includes(it.status));
    if (tab === "done") return all.filter((it) => CLOSED.includes(it.status));
    return all;
  }, [items, tab]);

  return (
    <div className="relative border-t border-white/[0.08] px-4 py-5 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div><div className={eyebrow}>Feedback</div><h3 className="mt-0.5 text-[15px] font-black text-white">불편·버그·개선점 — 편하게 적어 주세요</h3></div>
        <span className="text-[11px] font-bold text-slate-500">적으면 개발자가 답글을 달고, 개발 시작한 건은 자동으로 구현돼 결과가 여기 붙습니다</span>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        {/* 등록 */}
        <div className={`min-w-0 p-4 lg:col-span-4 ${card}`}>
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
          <div className="mt-2 text-[11px] font-bold text-slate-500">{author ? <>작성자 <span className="text-slate-300">{author}</span>로 올라갑니다 · 내 글은 접수 상태일 때 삭제할 수 있어요</> : "작성자를 고르면 이름으로 올라갑니다"}</div>
          {error && <div className="mt-2 flex items-start justify-between gap-2 rounded-lg bg-rose-500/10 px-3 py-2 text-[11.5px] font-bold text-rose-300"><span>{error}</span><button type="button" onClick={() => setError("")} className="shrink-0 text-rose-200">닫기</button></div>}
        </div>

        {/* 목록 */}
        <div className={`flex min-h-[280px] min-w-0 flex-col lg:col-span-8 ${card}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] px-3 py-2.5">
            <div className="flex flex-wrap gap-1">
              {([["open", "접수·확인"], ["queue", "개발 대기·진행"], ["done", "완료·반려"], ["all", "전체"]] as const).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-full px-3 py-1.5 text-[11.5px] font-black transition ${tab === k ? "bg-white text-slate-950" : "text-slate-400 hover:bg-white/10 hover:text-white"}`}>{label} <span className="font-mono">{counts[k]}</span></button>
              ))}
            </div>
            {isDev ? (
              <div className="flex items-center gap-2">
                {counts.checked > counts.ready && <span className="text-[10.5px] font-bold text-amber-300">지시 없는 {counts.checked - counts.ready}건 제외</span>}
                <button type="button" disabled={busy || counts.ready === 0} onClick={() => void startDev()} className="flex items-center gap-1.5 rounded-full bg-violet-600 px-3.5 py-1.5 text-[12px] font-black text-white shadow-lg transition hover:bg-violet-500 disabled:opacity-40"><Rocket size={13} />개발 시작 ({counts.ready}건)</button>
              </div>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-white/[0.06] px-2.5 py-1 text-[10.5px] font-bold text-slate-500"><Lock size={11} />개발 시작·반려는 개발자(이민구)만 — 권한 없음</span>
            )}
          </div>
          <ul className="divide-y divide-white/[0.06]">
            {items === null && Array.from({ length: 3 }).map((_, i) => <li key={i} className="px-4 py-3"><div className="h-4 w-2/3 animate-pulse rounded bg-white/[0.06]" /></li>)}
            {items !== null && visible.length === 0 && <li className="px-4 py-10 text-center text-[12px] font-bold text-slate-500">{tab === "open" ? "새로 접수된 건이 없습니다 — 첫 의견을 남겨 주세요" : "해당 항목이 없습니다"}</li>}
            {visible.map((it) => {
              const cat = CATEGORIES.find((c) => c.key === it.category) || CATEGORIES[3]; const Icon = cat.icon; const st = STATUS[it.status] || STATUS.new; const open = expanded === it.id;
              const canCheck = isDev && (OPEN.includes(it.status) || it.status === "rejected");
              const canDelete = isDev || (author && author === it.author && it.status === "new");
              return (
                <li key={it.id} className={`px-3 py-3 ${it.checked ? "bg-violet-500/[0.06]" : ""}`}>
                  <div className="flex items-start gap-2.5">
                    {canCheck && (
                      <label className="mt-0.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border border-white/20 bg-white/[0.06]" title="개발 시작 대상 체크">
                        <input type="checkbox" checked={it.checked} onChange={(e) => void patch(it.id, { checked: e.target.checked, status: it.status === "new" ? "triaged" : it.status })} className="h-3.5 w-3.5 accent-violet-500" />
                      </label>
                    )}
                    <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${cat.tone}`}><Icon size={13} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-bold text-slate-400">
                        <span className="text-slate-200">{it.author}</span><span>{relTime(it.created_at)}</span>{it.screen && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-300">{it.screen}</span>}
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${st.tone}`}>{st.label}</span>
                        {it.auto_deploy && QUEUE.includes(it.status) && <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-black text-rose-300">자동 배포</span>}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-[13px] font-semibold leading-5 text-white">{it.content}</p>
                      {it.dev_comment && <div className={`mt-2 rounded-lg border-l-2 px-3 py-2 text-[12px] font-semibold leading-5 ${it.status === "rejected" ? "border-slate-500 bg-white/[0.04] text-slate-300" : "border-blue-400 bg-blue-500/10 text-blue-100"}`}><span className={`mr-1.5 text-[10px] font-black ${it.status === "rejected" ? "text-slate-400" : "text-blue-300"}`}>{it.status === "rejected" ? "반려 사유" : "개발자"}</span>{it.dev_comment}</div>}
                      {(it.result_note || it.preview_url || it.commit_ref) && (
                        <div className="mt-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-[12px] font-semibold leading-5 text-emerald-100">
                          <span className="mr-1.5 inline-flex items-center gap-1 text-[10px] font-black text-emerald-300"><CheckCircle2 size={11} />결과</span>{it.result_note}
                          {it.preview_url && <a href={it.preview_url} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 underline">미리보기 열기 <ExternalLink size={11} /></a>}
                          {it.commit_ref && <span className="ml-2 font-mono text-[10.5px] text-emerald-300">{it.commit_ref.slice(0, 7)}</span>}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button type="button" disabled={voted.includes(it.id)} onClick={() => void vote(it)} className={`${miniBtn} ${voted.includes(it.id) ? "bg-white/10 text-slate-400" : "bg-white/10 text-slate-200 hover:bg-white/20"}`}><ThumbsUp size={11} />나도 그래요 <span className="font-mono">{it.votes || 0}</span></button>
                        {canDelete && <button type="button" onClick={() => void remove(it)} className={`${miniBtn} bg-white/10 text-slate-300 hover:bg-rose-500/20 hover:text-rose-200`}><Trash2 size={11} />삭제</button>}
                        {isDev && QUEUE.includes(it.status) && it.status !== "deploy" && <button type="button" onClick={() => void askConfirm(it.status === "in_progress" ? "개발이 이미 진행 중일 수 있어요. 큐에서 빼면 결과가 와도 반영하지 않고 '개발자 확인'으로 되돌립니다." : "개발 대기에서 빼고 '개발자 확인'으로 되돌릴까요?", { okLabel: "되돌리기" }).then((ok) => { if (ok) void patch(it.id, { status: "triaged", checked: false, confirmed_at: null }); })} className={`${miniBtn} bg-white/10 text-slate-200 hover:bg-white/20`}><Undo2 size={11} />개발 취소</button>}
                        {isDev && it.status === "review" && <button type="button" onClick={() => void askConfirm("미리보기를 확인했고 main에 반영(배포)을 요청할까요? 다음 루틴 실행 때 합쳐집니다.", { okLabel: "배포 요청" }).then((ok) => { if (ok) void patch(it.id, { status: "deploy" }); })} className={`${miniBtn} bg-emerald-600 text-white hover:bg-emerald-500`}><Rocket size={11} />배포 요청</button>}
                        {isDev && it.status === "rejected" && <button type="button" onClick={() => void patch(it.id, { status: "triaged" })} className={`${miniBtn} bg-white/10 text-slate-200 hover:bg-white/20`}><Undo2 size={11} />반려 해제</button>}
                        {isDev && <button type="button" onClick={() => setExpanded(open ? null : it.id)} className={`${miniBtn} bg-white/10 text-slate-200 hover:bg-white/20`}>개발자 메모 <ChevronDown size={12} className={`transition ${open ? "rotate-180" : ""}`} /></button>}
                      </div>
                      {isDev && open && (
                        <DevPanel item={it} onPatch={(fields) => patch(it.id, fields)} onReject={(reason) => reject(it, reason)} />
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

function DevPanel({ item, onPatch, onReject }: { item: FeedbackItem; onPatch: (fields: Partial<FeedbackItem>) => Promise<void>; onReject: (reason: string) => Promise<void> }) {
  const [comment, setComment] = useState(item.dev_comment || "");
  const [prompt, setPrompt] = useState(item.dev_prompt || "");
  const [showLog, setShowLog] = useState(false);
  const saveComment = () => { if (comment !== item.dev_comment) void onPatch({ dev_comment: comment, status: item.status === "new" ? "triaged" : item.status }); };
  const savePrompt = () => { if (prompt !== item.dev_prompt) void onPatch({ dev_prompt: prompt, status: item.status === "new" ? "triaged" : item.status }); };
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
      <label className="block text-[10.5px] font-black text-slate-400">작성자에게 답글 <span className="font-bold text-slate-500">— 반려할 때는 사유로 쓰입니다</span>
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} onBlur={saveComment} rows={2} className={`mt-1 ${input}`} placeholder="예) 확대할 때 끊기는 걸로 이해했어요 — 맞나요?" /></label>
      <label className="block text-[10.5px] font-black text-violet-300">개발 지시 <span className="font-bold text-violet-400/70">— 자동 개발 루틴에 그대로 들어가는 문장(구체적으로: 어느 화면, 어떤 동작, 완료 기준)</span>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} onBlur={savePrompt} rows={3} className={`mt-1 ${input}`} placeholder="예) 워킨맵 모바일에서 확대 배율일 때 드래그가 끊긴다 — 라벨을 캔버스로 그려 DOM 핀을 없애고, 폰 조건(CPU 4배)에서 드래그 프레임 끊김 0을 확인" /></label>
      <div className="flex flex-wrap items-center gap-2">
        <label className={`${miniBtn} cursor-pointer ${item.auto_deploy ? "bg-rose-500/20 text-rose-200" : "bg-white/10 text-slate-300"}`} title="켜면 미리보기 없이 main까지 자동 반영">
          <input type="checkbox" checked={item.auto_deploy} onChange={(e) => void onPatch({ auto_deploy: e.target.checked })} className="mr-1 h-3 w-3 accent-rose-500" />자동 배포까지{item.auto_deploy ? " (미리보기 생략)" : ""}
        </label>
        {item.status !== "rejected" && item.status !== "done" && <button type="button" onClick={() => void onReject(comment)} className={`${miniBtn} bg-white/10 text-slate-200 hover:bg-white/20`}><XCircle size={11} />반려 (사유 = 위 답글)</button>}
        <span className="ml-auto flex flex-wrap items-center gap-1">
          <span className="text-[10.5px] font-black text-slate-500">상태</span>
          {(Object.keys(STATUS) as FeedbackStatus[]).map((s) => <button key={s} type="button" onClick={() => void onPatch({ status: s, ...(s === "done" ? { done_at: new Date().toISOString() } : {}) })} className={`rounded-full px-2 py-0.5 text-[10px] font-black transition ${item.status === s ? "bg-white text-slate-950" : `${STATUS[s].tone} hover:brightness-125`}`}>{STATUS[s].label}</button>)}
        </span>
      </div>
      {(item.branch || item.run_log) && (
        <div className="text-[10.5px] font-bold text-slate-500">
          {item.branch && <span className="font-mono">branch {item.branch}</span>}
          {item.run_log && <button type="button" onClick={() => setShowLog(!showLog)} className="ml-2 underline">실행 기록 {showLog ? "접기" : "보기"}</button>}
          {showLog && item.run_log && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-2 font-mono text-[10px] text-slate-300">{item.run_log}</pre>}
        </div>
      )}
    </div>
  );
}
