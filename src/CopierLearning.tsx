/**
 * 복합기 학습자료 게시판 (2026-10-09) — 복합기 학습·처리이력 › [학습자료] 탭.
 *  누구나 글을 올리고 고치는 게시판(가이드 위키와 같은 신뢰 모델, supabase/copier-learning.sql 의 copier_learning_posts).
 *  다른 직원이 만든 "구동원리" 교육가이드는 표에 넣지 않고 맨 위 고정 글로 보여 준다(CopierPrinciple — 화면 안에 그대로).
 *  본문은 가이드와 같은 미니 마크다운(MdView): ## 제목 · - 목록 · ::: 토글 · 사진(Ctrl+V) · 파일.
 */
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, CirclePlay, Paperclip, Pin, Plus } from "lucide-react";
import CopierPrinciple from "./CopierPrinciple";
import FormModal from "./FormModal";
import MdView from "./MdView";
import { askConfirm } from "./confirmModal";
import { BRAND_NAMES } from "./copierTaxonomy";
import { deleteRows, insertRow, selectRows, updateRows, uploadPublicFile } from "./supabase";
import { notify } from "./toast";

type Attachment = { name: string; url: string };
type LearningPost = {
  id: string; created_at: string; updated_at?: string; author: string; title: string; category: string; brand: string;
  summary: string; content: string; attachments: Attachment[]; pinned: boolean;
};
const CATEGORIES = ["구동원리", "급지·반송", "화상·화질", "정착", "전장·보드", "네트워크·설정", "교육자료", "기타"];
const CATEGORY_TONE: Record<string, string> = {
  구동원리: "bg-indigo-50 text-indigo-700", "급지·반송": "bg-amber-50 text-amber-700", "화상·화질": "bg-rose-50 text-rose-600", 정착: "bg-orange-50 text-orange-700",
  "전장·보드": "bg-emerald-50 text-emerald-700", "네트워크·설정": "bg-sky-50 text-sky-700", 교육자료: "bg-violet-50 text-violet-700", 기타: "bg-slate-100 text-slate-600",
};
// 고정 글 — 다른 직원이 만든 교육가이드(애니메이션 8개). 표가 없어도 항상 보인다
const PRINCIPLE_ID = "__principle__";
const PRINCIPLE: LearningPost = {
  id: PRINCIPLE_ID, created_at: "2026-10-08", author: "교육가이드", title: "종이 한 장이 나오기까지 — Apeos C3061G / C3067G 구동원리와 급지",
  category: "구동원리", brand: "", summary: "화상 형성 7단계 · 용지 급지 · ADF 원고 급지 — 그림 8개가 단계별로 움직입니다", content: "", attachments: [], pinned: true,
};
const EMPTY_DRAFT = { id: "", title: "", category: "기타", brand: "", summary: "", content: "", attachments: [] as Attachment[], pinned: false };
const darkSelect = (active: boolean) =>
  `max-w-[46vw] rounded-full px-3 py-1.5 text-xs font-black outline-none transition [&>option]:bg-white [&>option]:font-bold [&>option]:text-slate-900 ${active ? "bg-blue-600 text-white" : "bg-white/[0.08] text-slate-300 hover:bg-white/[0.14]"}`;
const normalize = (value: string) => value.toLowerCase().replace(/[\s\-_./·]/g, "");
const fieldClass = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10";

export default function CopierLearning({ author }: { author: string }) {
  const [posts, setPosts] = useState<LearningPost[] | null>(null);
  const [tableMissing, setTableMissing] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("전체");
  const [open, setOpen] = useState<LearningPost | null>(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState<"" | "photo" | "file">("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    selectRows<LearningPost>("copier_learning_posts", "select=*&order=pinned.desc,created_at.desc&limit=500")
      .then((rows) => { if (!alive) return; setPosts(rows.map((r) => ({ ...r, attachments: Array.isArray(r.attachments) ? r.attachments : [] }))); setTableMissing(false); setError(""); })
      .catch((e) => {
        if (!alive) return;
        const msg = (e as Error).message || "";
        setPosts([]);
        if (/404|relation|schema cache|copier_learning_posts/i.test(msg)) setTableMissing(true); else setError(msg);
      });
    return () => { alive = false; };
  }, [reloadKey]);
  const reload = () => setReloadKey((k) => k + 1);

  const all = [PRINCIPLE, ...(posts || [])];
  const tokens = query.trim().split(/\s+/).map(normalize).filter(Boolean);
  const filtered = all.filter((p) =>
    (category === "전체" || p.category === category) &&
    (!tokens.length || tokens.every((t) => normalize(`${p.title} ${p.summary} ${p.category} ${p.brand} ${p.author} ${p.content}`).includes(t))));
  const countOf = (name: string) => name === "전체" ? all.length : all.filter((p) => p.category === name).length;

  // 커서 위치에 스니펫 삽입 — 서식 버튼·사진·붙여넣기가 모두 이 길로(가이드 편집기와 같은 방식)
  const insertAtCursor = (snippet: string) => {
    const el = bodyRef.current;
    if (!el) { setDraft((current) => ({ ...current, content: `${current.content.trimEnd()}\n${snippet}` })); return; }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const before = el.value.slice(0, start);
    const pad = before && !before.endsWith("\n") ? "\n" : "";
    const next = before + pad + snippet + el.value.slice(end);
    setDraft((current) => ({ ...current, content: next }));
    requestAnimationFrame(() => { el.focus(); const pos = (before + pad + snippet).length; el.setSelectionRange(pos, pos); });
  };
  const upload = async (file: File | null, kind: "photo" | "file") => {
    if (!file) return;
    if (kind === "photo" && !/^image\//.test(file.type)) { notify("사진 파일만 본문에 넣을 수 있어요 — 다른 파일은 📎 파일로 올려 주세요.", "error"); return; }
    setUploadBusy(kind);
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const url = await uploadPublicFile("photos", `learning/${new Date().getFullYear()}/${crypto.randomUUID()}-${safe}`, file, file.type || "application/octet-stream");
      if (kind === "photo") insertAtCursor(`![](${url})\n`);
      else setDraft((current) => ({ ...current, attachments: [...current.attachments, { name: file.name, url }] }));
    } catch (e) { notify(`업로드 실패: ${(e as Error).message}`, "error"); }
    finally { setUploadBusy(""); }
  };
  const openEditor = (post?: LearningPost) => {
    if (tableMissing) { notify("학습자료 표가 아직 없어요 — 관리자가 supabase/copier-learning.sql 을 실행하면 글을 올릴 수 있습니다.", "error"); return; }
    setDraft(post ? { id: post.id, title: post.title, category: post.category, brand: post.brand, summary: post.summary, content: post.content, attachments: post.attachments || [], pinned: !!post.pinned }
      : { ...EMPTY_DRAFT, category: category === "전체" ? "기타" : category });
    setEditOpen(true);
  };
  const save = async () => {
    if (busy || !draft.title.trim() || !draft.content.trim()) return;
    setBusy(true);
    try {
      const payload = {
        title: draft.title.trim(), category: draft.category, brand: draft.brand, summary: draft.summary.trim(), content: draft.content,
        attachments: draft.attachments, pinned: draft.pinned, updated_at: new Date().toISOString(),
      };
      if (draft.id) {
        await updateRows("copier_learning_posts", `id=eq.${draft.id}`, payload);
        setOpen((current) => current && current.id === draft.id ? { ...current, ...payload } : current);
      } else await insertRow("copier_learning_posts", { ...payload, author: author || "미지정" });
      setEditOpen(false);
      reload();
      notify(draft.id ? "학습자료를 수정했습니다." : "학습자료를 올렸습니다 — 모든 직원에게 바로 보입니다.");
    } catch (e) { notify(`저장 실패: ${(e as Error).message}`, "error"); }
    finally { setBusy(false); }
  };
  const remove = async (post: LearningPost) => {
    if (!await askConfirm(`"${post.title}" 글을 삭제할까요?\n모든 직원의 목록에서 사라집니다.`, { danger: true, okLabel: "삭제" })) return;
    try {
      await deleteRows("copier_learning_posts", `id=eq.${post.id}`);
      setOpen(null);
      reload();
    } catch (e) { notify(`삭제 실패: ${(e as Error).message}`, "error"); }
  };
  const chip = (name: string) => <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${CATEGORY_TONE[name] || CATEGORY_TONE["기타"]}`}>{name}</span>;

  const editor = () => (
    <FormModal wide="xl" title={draft.id ? "학습자료 수정" : "학습자료 올리기"} subtitle="저장하면 모든 직원의 학습자료 목록에 바로 보입니다" icon={<span className="text-base">🎓</span>} onClose={() => setEditOpen(false)}
      footer={<>
        <button type="button" onClick={() => setEditOpen(false)} className="rounded-full px-4 py-2.5 text-sm font-bold text-slate-500 transition hover:bg-slate-100">취소</button>
        <button type="button" disabled={busy || !draft.title.trim() || !draft.content.trim()} onClick={() => void save()}
          className="rounded-full bg-blue-600 px-6 py-2.5 text-sm font-black text-white shadow-[0_4px_14px_rgba(37,99,235,0.35)] transition hover:bg-blue-700 disabled:opacity-40 disabled:shadow-none">{busy ? "저장 중…" : draft.id ? "수정 저장" : "올리기"}</button>
      </>}>
      <div className="space-y-4">
        <label className="block text-xs font-bold text-slate-500">제목 <b className="text-rose-500">*</b>
          <input autoFocus value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="예: 정착기 온도 제어 원리와 자주 나는 에러" className={fieldClass} />
        </label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <label className="text-xs font-bold text-slate-500">분류
            <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} className={`${fieldClass} bg-white`}>
              {CATEGORIES.map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-slate-500">브랜드
            <select value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value })} className={`${fieldClass} bg-white`}>
              <option value="">공통</option>
              {BRAND_NAMES.map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>
          <label className="col-span-2 flex items-center gap-2 self-end rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-bold text-slate-600 sm:col-span-1">
            <input type="checkbox" checked={draft.pinned} onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })} className="h-4 w-4 accent-blue-600" />
            <Pin size={12} /> 목록 맨 위에 고정
          </label>
        </div>
        <label className="block text-xs font-bold text-slate-500">한 줄 요약
          <input value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} placeholder="목록에 보이는 설명" className={fieldClass} />
        </label>
        <div className="text-xs font-bold text-slate-500">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <span>본문 <b className="text-rose-500">*</b></span>
            <span className="flex flex-wrap gap-1">
              {([["H 제목", "## 제목\n"], ["h 소제목", "### 소제목\n"], ["• 목록", "- 항목\n"], ["1. 번호", "1. 첫 단계\n"], ["— 구분선", "---\n"], ["▸ 토글", "::: 눌러서 펼치기\n내용을 여기에\n:::\n"]] as [string, string][]).map(([label, snippet]) => (
                <button key={label} type="button" onClick={() => insertAtCursor(snippet)} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-black text-slate-500 transition hover:bg-slate-50 hover:text-slate-700">{label}</button>
              ))}
              <button type="button" onClick={() => photoRef.current?.click()} disabled={!!uploadBusy} className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-black text-blue-600 transition hover:bg-blue-100 disabled:opacity-40">{uploadBusy === "photo" ? "올리는 중…" : "📷 사진"}</button>
              <button type="button" onClick={() => fileRef.current?.click()} disabled={!!uploadBusy} className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">{uploadBusy === "file" ? "올리는 중…" : "📎 파일"}</button>
            </span>
            <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void upload(e.target.files?.[0] || null, "photo"); e.target.value = ""; }} />
            <input ref={fileRef} type="file" className="hidden" onChange={(e) => { void upload(e.target.files?.[0] || null, "file"); e.target.value = ""; }} />
          </div>
          <div className="mt-1 grid items-stretch gap-2 lg:grid-cols-2">
            <textarea ref={bodyRef} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} rows={14}
              onPaste={(e) => { const pasted = Array.from(e.clipboardData?.files || []).find((f) => /^image\//.test(f.type)); if (pasted) { e.preventDefault(); void upload(pasted, "photo"); } }}
              placeholder={"위 버튼으로 서식을 넣거나, 캡처한 사진을 Ctrl+V로 바로 붙여넣으세요.\n\n## 핵심 원리\n- 한 줄씩\n\n::: 자세히 (누르면 펼쳐짐)\n1. 첫 단계\n2. 다음 단계\n:::"}
              className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 font-mono text-[13px] leading-6 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
            <div className="max-h-[240px] overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/60 px-4 py-3 lg:max-h-[380px]">
              <div className="mb-1.5 text-[10px] font-black tracking-wide text-slate-300">미리보기 — 쓰는 대로 바로 적용됩니다</div>
              {draft.content.trim() ? <MdView text={draft.content} /> : <p className="text-xs font-bold text-slate-300">왼쪽에 쓰기 시작하면 완성본이 여기 나타나요.</p>}
            </div>
          </div>
          {draft.attachments.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">
            {draft.attachments.map((a, i) => <span key={a.url} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-black text-slate-600"><Paperclip size={11} />{a.name}<button type="button" aria-label="첨부 제거" onClick={() => setDraft({ ...draft, attachments: draft.attachments.filter((_, j) => j !== i) })} className="ml-0.5 text-slate-400 hover:text-rose-500">✕</button></span>)}
          </div>}
          <div className="mt-1 text-[10px] font-semibold text-slate-400">💡 사진은 Ctrl+V 붙여넣기 지원 — 커서 위치에 바로 들어갑니다 · PDF 등 다른 파일은 📎 파일로 첨부</div>
        </div>
      </div>
    </FormModal>
  );

  // ── 상세: 목록 자리를 그대로 차지한다(새 창·팝업 없이) ──
  if (open) {
    const isPrinciple = open.id === PRINCIPLE_ID;
    return (
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2.5">
          <button type="button" onClick={() => setOpen(null)} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-black text-slate-600 transition hover:bg-slate-100"><ArrowLeft size={15} /> 학습자료 목록</button>
          <span className="hidden min-w-0 flex-1 truncate text-xs font-bold text-slate-400 sm:block">{open.title}</span>
          {!isPrinciple && <span className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => void remove(open)} className="rounded-full px-3 py-1.5 text-xs font-black text-slate-400 transition hover:bg-rose-50 hover:text-rose-500">삭제</button>
            <button type="button" onClick={() => openEditor(open)} className="rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-black text-slate-600 transition hover:bg-slate-50">✎ 수정</button>
          </span>}
        </div>
        {isPrinciple ? <div className="bg-slate-50 p-2 sm:p-3"><CopierPrinciple /></div> : (
          <article className="px-4 py-5 sm:px-6">
            <div className="flex flex-wrap items-center gap-1.5">
              {chip(open.category)}
              {open.brand && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-600">{open.brand}</span>}
              {open.pinned && <span className="inline-flex items-center gap-0.5 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-600"><Pin size={10} /> 고정</span>}
            </div>
            <h3 className="mt-2 text-xl font-black leading-snug text-slate-950 lg:text-2xl">{open.title}</h3>
            <div className="mt-1.5 text-xs font-bold text-slate-400">{open.author || "미지정"} · {open.created_at.slice(0, 10)}{open.updated_at && open.updated_at.slice(0, 10) !== open.created_at.slice(0, 10) ? ` · 수정 ${open.updated_at.slice(0, 10)}` : ""}</div>
            {open.summary && <div className="mt-4 rounded-lg bg-blue-50/60 px-3.5 py-2.5 text-sm font-bold text-blue-800">{open.summary}</div>}
            <div className="mt-4"><MdView text={open.content} /></div>
            {open.attachments.length > 0 && <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <div className="mb-1.5 text-[11px] font-black text-slate-500">첨부 {open.attachments.length}</div>
              <div className="flex flex-wrap gap-1.5">{open.attachments.map((a) => <a key={a.url} href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-blue-700 transition hover:bg-blue-50"><Paperclip size={12} />{a.name}</a>)}</div>
            </div>}
          </article>
        )}
        {editOpen && editor()}
      </section>
    );
  }

  // ── 목록 ──
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="bg-[#151A23] px-5 pb-4 pt-3.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <label className="flex min-w-[220px] flex-1 items-center gap-2.5 rounded-full bg-white/10 px-5 py-3 transition focus-within:bg-white/[0.16] lg:max-w-2xl">
            <span className="shrink-0 text-slate-500">🔍</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="제목 · 내용 · 분류 · 작성자 검색" className="min-w-0 flex-1 bg-transparent text-sm font-bold text-white outline-none placeholder:text-slate-500" />
            {query && <button type="button" onClick={() => setQuery("")} aria-label="검색어 지우기" className="shrink-0 text-xs font-black text-slate-500 transition hover:text-slate-300">✕</button>}
          </label>
          <span className="ml-auto rounded-full bg-white/[0.07] px-3 py-1 text-[11px] font-bold text-slate-400">자료 <b className="tabular-nums text-white">{filtered.length}</b></span>
        </div>
        <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={darkSelect(category !== "전체")}>
            <option value="전체">분류 전체 ({countOf("전체")})</option>
            {CATEGORIES.map((name) => <option key={name} value={name}>{name} ({countOf(name)})</option>)}
          </select>
          <button type="button" onClick={() => openEditor()} className="ml-auto inline-flex items-center gap-1 rounded-full bg-blue-600 px-4 py-1.5 text-xs font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.35)] transition hover:bg-blue-700"><Plus size={14} /> 자료 올리기</button>
        </div>
      </div>
      {tableMissing && <div className="border-b border-amber-100 bg-amber-50 px-4 py-2.5 text-xs font-bold text-amber-800">학습자료 표가 아직 없습니다 — 관리자가 Supabase SQL Editor에서 <code className="rounded bg-white px-1">supabase/copier-learning.sql</code>을 한 번 실행하면 글을 올릴 수 있어요. 구동원리는 지금도 볼 수 있습니다.</div>}
      {error && <div className="border-b border-rose-100 bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-700">{error}</div>}
      {posts === null && <div className="p-6 text-center text-xs font-bold text-slate-400">불러오는 중…</div>}
      {posts !== null && !filtered.length && <div className="p-12 text-center text-sm font-bold text-slate-400">조건에 맞는 자료가 없어요 — 첫 자료를 올려 보세요.</div>}
      {filtered.length > 0 && <div className="divide-y divide-slate-100">
        {filtered.map((post) => {
          const isPrinciple = post.id === PRINCIPLE_ID;
          const hasPhoto = post.content.includes("storage/v1");
          return (
            <button key={post.id} type="button" onClick={() => setOpen(post)} className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50 ${isPrinciple ? "bg-indigo-50/40" : ""}`}>
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${isPrinciple ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"}`}>{isPrinciple ? <CirclePlay size={20} /> : <span className="text-[10px] font-black">{post.category.slice(0, 2)}</span>}</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  {chip(post.category)}
                  {post.brand && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-600">{post.brand}</span>}
                  {post.pinned && <span className="inline-flex items-center gap-0.5 text-[10px] font-black text-blue-600"><Pin size={10} /> 고정</span>}
                  {isPrinciple && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-black text-indigo-700">움직이는 그림 8개</span>}
                </span>
                <span className="mt-1 block truncate text-sm font-black text-slate-900">{post.title}</span>
                <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">{post.summary || "세부 내용을 확인하세요."}</span>
                <span className="mt-0.5 block text-[11px] font-semibold text-slate-400">{post.author || "미지정"} · {post.created_at.slice(0, 10)}{hasPhoto ? " · 사진" : ""}{post.attachments.length ? ` · 첨부 ${post.attachments.length}` : ""}</span>
              </span>
              <ChevronRight size={17} className="shrink-0 text-slate-300" />
            </button>
          );
        })}
      </div>}
      {editOpen && editor()}
    </section>
  );
}
