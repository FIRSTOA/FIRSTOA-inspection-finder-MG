/**
 * 복합기 학습·처리이력 — 브랜드/기종별 수리 노하우와 처리 사례를 쌓는 팀 지식 베이스.
 * (supabase/dev-notes.sql의 copier_notes 테이블)
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { countRows, deleteRows, insertRow, selectRows, updateRows, uploadPublicFile } from "./supabase";
import FormModal from "./FormModal";
import { ALL_MODEL_NAMES, brandOfModel } from "./modelCatalog";
import { notify } from "./toast";

type CopierNote = {
  id: string; created_at: string; author: string; brand: string; model: string;
  kind: "학습" | "처리이력"; title: string; content: string;
};

// 기종 필터 칩: 팀 관용 시리즈명 (기록의 model 값과 일치하는 것들)
const BRANDS: Record<string, string[]> = {
  삼성: ["MX3", "MX4", "MX7", "흑백기"],
  신도: ["320", "410", "420", "450", "N501"],
  제록스: ["키슈/세이토", "마블", "베니/보탄", "헤라", "세레스", "305", "5005"],
  교세라: ["2100", "2101", "5521", "5526"],
  브라더: ["5700", "8900"],
  오키: ["5473"],
  HP: [],
  리코: [],
  캐논: [],
  코니카미놀타: [],
  렉스마크: ["MX410"],
  기타: [],
};
const BRAND_NAMES = Object.keys(BRANDS);

type QuizItem = { note: CopierNote; options: CopierNote[] };

type KnowledgeDoc = { id: string; category: string; brand: string; title: string; content: string; content_clean: string; summary: string; models: string[]; parts: string[]; difficulty: string; author: string; created_at: string };

// 노션식 미니 렌더러 — 제목(##/###) · 목록(-, 1.) · 구분선(---) · 토글(::: 제목 ~ :::) · 이미지 · 파일링크
function mdLine(line: string, key: number): ReactNode {
  const trimmed = line.trim();
  const image = trimmed.match(/^!\[[^\]]*\]\(([^)]+)\)$/);
  if (image) return <a key={key} href={image[1]} target="_blank" rel="noreferrer"><img src={image[1]} alt="" loading="lazy" className="max-h-[420px] rounded-lg border border-slate-200" /></a>;
  const file = trimmed.match(/^\[([^\]]+)\]\((https?:[^)]+)\)$/);
  if (file) return <a key={key} href={file[2]} target="_blank" rel="noreferrer" className="inline-block rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-black text-blue-700">📎 {file[1]}</a>;
  if (/^(---|\*\*\*|___)\s*$/.test(trimmed)) return <hr key={key} className="my-3 border-slate-200" />;
  if (/^\d+[.)]\s/.test(trimmed)) return <li key={key} className="ml-5 list-decimal text-sm leading-6 text-slate-800">{trimmed.replace(/^\d+[.)]\s*/, "")}</li>;
  if (/^[-•]\s/.test(trimmed)) return <li key={key} className="ml-5 list-disc text-sm leading-6 text-slate-800">{trimmed.replace(/^[-•]\s*/, "")}</li>;
  if (/^###/.test(trimmed)) return <h4 key={key} className="pt-1.5 text-[15px] font-black text-slate-800">{trimmed.replace(/^###\s*/, "")}</h4>;
  if (/^##/.test(trimmed)) return <h3 key={key} className="border-b border-slate-100 pb-1 pt-2.5 text-lg font-black text-slate-950">{trimmed.replace(/^##\s*/, "")}</h3>;
  if (!trimmed) return null;
  return <p key={key} className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{line}</p>;
}

function MdView({ text }: { text: string }) {
  const lines = String(text || "").split("\n");
  const out: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const trimmed = lines[index].trim();
    // ::: 제목 ~ ::: → 접었다 펴는 토글
    if (/^:::\s*\S/.test(trimmed)) {
      const title = trimmed.replace(/^:::\s*/, "");
      const body: string[] = [];
      index += 1;
      while (index < lines.length && lines[index].trim() !== ":::") { body.push(lines[index]); index += 1; }
      index += 1; // 닫는 ::: 건너뛰기
      out.push(
        <details key={`toggle-${out.length}`} className="rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5">
          <summary className="cursor-pointer select-none text-sm font-black text-slate-800">{title}</summary>
          <div className="mt-2"><MdView text={body.join("\n")} /></div>
        </details>,
      );
      continue;
    }
    out.push(mdLine(lines[index], out.length));
    index += 1;
  }
  return <div className="space-y-2">{out}</div>;
}

// content("증상: …\n처리: …\n지역: …" 형식)를 구조화 — 형식이 아니면 raw로 표시
function parseNoteContent(content: string) {
  const fields: Record<string, string> = {};
  let current = "";
  for (const line of String(content || "").split("\n")) {
    const match = line.match(/^(증상|처리|지역|레벨|업체)\s*:\s*(.*)$/);
    if (match) { current = match[1]; fields[current] = match[2]; }
    else if (current) fields[current] += `\n${line}`;
  }
  return fields["처리"] !== undefined ? fields : null;
}

function NoteBody({ note }: { note: CopierNote }) {
  const parsed = parseNoteContent(note.content);
  if (!parsed) return <p className="mt-1.5 whitespace-pre-wrap text-sm font-medium leading-6 text-slate-700">{note.content}</p>;
  const meta = [parsed["업체"], parsed["지역"] && `지역 ${parsed["지역"]}`, parsed["레벨"] && `레벨 ${parsed["레벨"]}`].filter(Boolean).join(" · ");
  return (
    <div className="mt-2 space-y-1.5">
      {meta && <div className="text-xs font-black text-slate-500">{meta}</div>}
      {parsed["증상"] && <div className="rounded-lg bg-rose-50/60 px-3 py-2">
        <span className="text-[10px] font-black text-rose-500">증상</span>
        <p className="mt-0.5 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-800">{parsed["증상"]}</p>
      </div>}
      <div className="rounded-lg bg-emerald-50/60 px-3 py-2">
        <span className="text-[10px] font-black text-emerald-600">처리</span>
        <p className="mt-0.5 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-800">{parsed["처리"]}</p>
      </div>
    </div>
  );
}

function buildQuiz(pool: CopierNote[], count: number): QuizItem[] {
  const usable = pool.filter((note) => note.title.trim() && note.content.trim());
  if (usable.length < 4) return [];
  const shuffled = [...usable].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length)).map((note) => {
    const others = usable.filter((item) => item.id !== note.id).sort(() => Math.random() - 0.5).slice(0, 3);
    return { note, options: [note, ...others].sort(() => Math.random() - 0.5) };
  });
}

export default function CopierNotes({ author }: { author: string }) {
  const [notes, setNotes] = useState<CopierNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [brand, setBrand] = useState<string>("전체");
  const [model, setModel] = useState<string>("전체");
  const [kindFilter, setKindFilter] = useState<"전체" | "학습" | "처리이력">("전체");
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<"desc" | "asc">("desc");
  // 상단 통계 (전체 기준 — 필터와 무관)
  const [stats, setStats] = useState<{ total: number; learn: number; cases: number; month: number } | null>(null);
  useEffect(() => {
    const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;
    void Promise.all([
      countRows("copier_notes"),
      countRows("copier_notes", `kind=eq.${encodeURIComponent("학습")}`),
      countRows("copier_notes", `kind=eq.${encodeURIComponent("처리이력")}`),
      countRows("copier_notes", `created_at=gte.${monthStart}`),
    ]).then(([total, learn, cases, month]) => setStats({ total, learn, cases, month })).catch(() => setStats(null));
  }, []);
  const [writeOpen, setWriteOpen] = useState(false);
  const [noteDetail, setNoteDetail] = useState<CopierNote | null>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try { const parsed = JSON.parse(localStorage.getItem("copier_recent_q_v1") || "[]"); return Array.isArray(parsed) ? parsed.slice(0, 6) : []; } catch { return []; }
  });
  const [view, setView] = useState<"notes" | "guide" | "quiz">("notes");
  // 노션에서 이관한 지식 가이드 (탈거·조립·에러 처리 등 실무 문서)
  const [guides, setGuides] = useState<KnowledgeDoc[] | null>(null);
  const [guideBrand, setGuideBrand] = useState("전체");
  const [guideCategory, setGuideCategory] = useState("전체");
  const [guidePart, setGuidePart] = useState("전체");
  const [showOriginal, setShowOriginal] = useState(false);
  const [guideQuery, setGuideQuery] = useState("");
  const [openGuide, setOpenGuide] = useState<KnowledgeDoc | null>(null);
  // 가이드 위키 편집 — 누구나 작성·수정 (노션처럼)
  const emptyGuideDraft = { id: "", title: "", brand: "", category: "", difficulty: "", summary: "", modelsText: "", content: "" };
  const [guideDraft, setGuideDraft] = useState(emptyGuideDraft);
  const [guideEditOpen, setGuideEditOpen] = useState(false);
  const [guideBusy, setGuideBusy] = useState(false);
  const [guidePhotoBusy, setGuidePhotoBusy] = useState(false);

  const guidePhotoRef = useRef<HTMLInputElement>(null);
  const guideBodyRef = useRef<HTMLTextAreaElement>(null);
  // 커서 위치에 스니펫 삽입 — 서식 버튼·사진·붙여넣기가 모두 이 길로
  const insertAtCursor = (snippet: string) => {
    const el = guideBodyRef.current;
    if (!el) { setGuideDraft((current) => ({ ...current, content: `${current.content.trimEnd()}\n${snippet}` })); return; }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const before = el.value.slice(0, start);
    const pad = before && !before.endsWith("\n") ? "\n" : "";
    const next = before + pad + snippet + el.value.slice(end);
    setGuideDraft((current) => ({ ...current, content: next }));
    requestAnimationFrame(() => { el.focus(); const pos = (before + pad + snippet).length; el.setSelectionRange(pos, pos); });
  };
  const openGuideEditor = (doc?: KnowledgeDoc) => {
    setGuideDraft(doc ? {
      id: doc.id, title: doc.title, brand: doc.brand, category: doc.category, difficulty: doc.difficulty,
      summary: doc.summary, modelsText: (doc.models || []).join(", "),
      content: (!doc.content_clean ? doc.content : doc.content_clean),
    } : { ...emptyGuideDraft, brand: guideBrand === "전체" ? "" : guideBrand, category: guideCategory === "전체" ? "" : guideCategory });
    setGuideEditOpen(true);
  };
  const saveGuide = async () => {
    if (guideBusy || !guideDraft.title.trim() || !guideDraft.content.trim()) return;
    setGuideBusy(true);
    try {
      const payload = {
        title: guideDraft.title.trim(), brand: guideDraft.brand.trim(), category: guideDraft.category.trim(),
        difficulty: guideDraft.difficulty, summary: guideDraft.summary.trim(),
        models: guideDraft.modelsText.split(",").map((t) => t.trim()).filter(Boolean),
        content: guideDraft.content, content_clean: "", updated_at: new Date().toISOString(),
      };
      if (guideDraft.id) await updateRows("knowledge_docs", `id=eq.${guideDraft.id}`, payload);
      else await insertRow("knowledge_docs", { ...payload, author: author || "미지정", source: "webapp" });
      setGuideEditOpen(false);
      setOpenGuide(null);
      setGuides(null); // 다시 불러오기
      notify(guideDraft.id ? "가이드를 수정했습니다." : "가이드를 등록했습니다.");
    } catch (e) {
      notify(`저장 실패: ${(e as Error).message}`, "error");
    } finally {
      setGuideBusy(false);
    }
  };
  const removeGuide = async (doc: KnowledgeDoc) => {
    if (!window.confirm(`"${doc.title}" 가이드를 삭제할까요?\n모든 직원의 목록에서 사라집니다.`)) return;
    try {
      await deleteRows("knowledge_docs", `id=eq.${doc.id}`);
      setOpenGuide(null);
      setGuides(null);
    } catch (e) { notify(`삭제 실패: ${(e as Error).message}`, "error"); }
  };
  const attachGuidePhoto = async (file: File | null) => {
    if (!file || !/^image\//.test(file.type)) return;
    setGuidePhotoBusy(true);
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const url = await uploadPublicFile("photos", `guides/${new Date().getFullYear()}/${crypto.randomUUID()}-${safe}`, file, file.type);
      insertAtCursor(`![](${url})\n`);
    } catch (e) { notify(`사진 업로드 실패: ${(e as Error).message}`, "error"); }
    finally { setGuidePhotoBusy(false); }
  };
  useEffect(() => {
    if (view !== "guide" || guides !== null) return;
    selectRows<KnowledgeDoc>("knowledge_docs", "select=*&order=brand.asc,title.asc&limit=1000")
      .then(setGuides)
      .catch(() => setGuides([]));
  }, [view, guides]);
  // 퀴즈: 처리이력·학습 기록을 문제 은행으로 쓰는 4지선다 (IT 기술퀴즈와 같은 흐름)
  const [quizBrand, setQuizBrand] = useState("전체");
  const [quizCount, setQuizCount] = useState(5);
  const [quiz, setQuiz] = useState<QuizItem[]>([]);
  const [quizIndex, setQuizIndex] = useState(-1);
  const [quizPick, setQuizPick] = useState("");
  const [quizScore, setQuizScore] = useState(0);
  const [wrongNotes, setWrongNotes] = useState<QuizItem[]>([]);

  const startQuiz = () => {
    const pool = quizBrand === "전체" ? notes : notes.filter((note) => note.brand === quizBrand);
    const built = buildQuiz(pool, quizCount);
    if (!built.length) { notify("제목·내용이 있는 기록이 4건 이상 쌓여야 퀴즈를 만들 수 있어요.", "error"); return; }
    setQuiz(built); setQuizIndex(0); setQuizPick(""); setQuizScore(0); setWrongNotes([]);
  };
  // 오답만 다시: 틀린 문제의 원본 노트로 새 퀴즈 구성
  const retryWrong = () => {
    const pool = wrongNotes.map((item) => item.note);
    const bank = notes.filter((note) => note.title.trim() && note.content.trim());
    const built = pool.map((note) => {
      const others = bank.filter((item) => item.id !== note.id).sort(() => Math.random() - 0.5).slice(0, 3);
      return { note, options: [note, ...others].sort(() => Math.random() - 0.5) };
    });
    setQuiz(built); setQuizIndex(0); setQuizPick(""); setQuizScore(0); setWrongNotes([]);
  };
  const answerQuiz = (id: string) => {
    if (quizPick || quizIndex < 0 || quizIndex >= quiz.length) return;
    setQuizPick(id);
    if (id === quiz[quizIndex].note.id) setQuizScore((score) => score + 1);
    else setWrongNotes((wrong) => [...wrong, quiz[quizIndex]]);
  };
  const nextQuiz = () => { setQuizPick(""); setQuizIndex((index) => index + 1); };
  const [draft, setDraft] = useState({ brand: "삼성", model: "", kind: "학습" as "학습" | "처리이력", title: "", content: "" });
  const [busy, setBusy] = useState(false);

  // 기록이 1만 건 이상이라 전체 로드는 느리다 — 최근 200건씩 페이지 로드, 검색·필터는 서버(전체 대상)에서 수행
  const PAGE_SIZE = 200;
  const [hasMore, setHasMore] = useState(false);
  const buildListQuery = useCallback((offset: number) => {
    const parts = ["select=*", `order=created_at.${order}`, `limit=${PAGE_SIZE}`, `offset=${offset}`];
    if (brand !== "전체") parts.push(`brand=eq.${encodeURIComponent(brand)}`);
    if (model !== "전체") parts.push(`model=eq.${encodeURIComponent(model)}`);
    if (kindFilter !== "전체") parts.push(`kind=eq.${encodeURIComponent(kindFilter)}`);
    const keyword = query.trim().replace(/["\\%,()]/g, "");
    if (keyword) {
      const pattern = `"*${keyword}*"`;
      parts.push(`or=${encodeURIComponent(`(title.ilike.${pattern},content.ilike.${pattern},model.ilike.${pattern},author.ilike.${pattern})`)}`);
    }
    return parts.join("&");
  }, [brand, model, kindFilter, query, order]);
  const load = useCallback(async (offset = 0) => {
    setLoading(true);
    setError("");
    try {
      const rows = await selectRows<CopierNote>("copier_notes", buildListQuery(offset));
      setNotes((current) => (offset === 0 ? rows : [...current, ...rows]));
      setHasMore(rows.length === PAGE_SIZE);
    } catch (e) {
      setError((e as Error).message || "불러오기 실패 — supabase/dev-notes.sql 실행 여부를 확인하세요.");
    } finally {
      setLoading(false);
    }
  }, [buildListQuery]);
  // 검색어 타이핑은 250ms 디바운스 후 서버 조회
  useEffect(() => { const timer = window.setTimeout(() => { void load(0); }, 250); return () => window.clearTimeout(timer); }, [load]);
  // 결과가 있는 검색어는 최근 검색으로 기억 (기기 저장, 6개)
  useEffect(() => {
    if (loading) return;
    const keyword = query.trim();
    if (!keyword || !notes.length) return;
    setRecentSearches((current) => {
      const next = [keyword, ...current.filter((item) => item !== keyword)].slice(0, 6);
      try { localStorage.setItem("copier_recent_q_v1", JSON.stringify(next)); } catch { /* 무시 */ }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const filtered = notes; // 필터·검색은 서버에서 이미 적용됨

  const submit = async () => {
    if (busy || !draft.content.trim()) return;
    if (!author) { setError("작성자를 먼저 선택하세요."); return; }
    setBusy(true);
    try {
      await insertRow("copier_notes", { author, brand: draft.brand, model: draft.model.trim(), kind: draft.kind, title: draft.title.trim(), content: draft.content.trim() });
      setDraft({ ...draft, title: "", content: "" });
      setWriteOpen(false);
      await load(0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeNote = async (note: CopierNote) => {
    if (note.author !== author) return;
    if (!window.confirm("이 기록을 삭제할까요?")) return;
    try {
      await deleteRows("copier_notes", `id=eq.${note.id}`);
      setNotes((current) => current.filter((n) => n.id !== note.id));
      setNoteDetail(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const currentQuiz = quizIndex >= 0 && quizIndex < quiz.length ? quiz[quizIndex] : null;

  return (
    <div className="space-y-4 pb-16">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="bg-[#1E252F] px-5 py-4">
          <h2 className="text-base font-black text-white lg:text-lg">복합기 학습·처리이력</h2>
          <p className="mt-0.5 text-[11px] font-semibold text-slate-400">현장 기록과 가이드를 쌓고, 퀴즈로 복합기 기술을 점검합니다.</p>
        </div>
        <div className="flex overflow-x-auto">
          {([["notes", "기록"], ["guide", "가이드"], ["quiz", "복합기 퀴즈"]] as const).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setView(key)}
              className={`relative shrink-0 whitespace-nowrap px-5 py-3.5 text-sm font-black transition ${view === key ? "text-slate-950 after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:bg-blue-600" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"}`}>{label}</button>
          ))}
        </div>
      </section>
      {view === "guide" && (() => {
        const list = guides || [];
        const brands = ["전체", ...Array.from(new Set(list.map((d) => d.brand).filter(Boolean)))];
        const categories = ["전체", ...Array.from(new Set(list.map((d) => d.category).filter(Boolean)))];
        const keyword = guideQuery.trim().toLowerCase();
        const partCounts = new Map<string, number>();
        list.forEach((d) => (d.parts || []).forEach((part) => partCounts.set(part, (partCounts.get(part) || 0) + 1)));
        const topParts = ["전체", ...Array.from(partCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([name]) => name)];
        const filtered = list.filter((d) =>
          (guideBrand === "전체" || d.brand === guideBrand) &&
          (guideCategory === "전체" || d.category === guideCategory) &&
          (guidePart === "전체" || (d.parts || []).includes(guidePart)) &&
          (!keyword || `${d.title} ${d.summary} ${(d.models || []).join(" ")} ${(d.parts || []).join(" ")} ${d.content}`.toLowerCase().includes(keyword)));
        return (
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex flex-wrap items-center gap-1">
                {brands.map((name) => (
                  <button key={name} type="button" onClick={() => setGuideBrand(name)} className={`rounded-full px-3 py-1.5 text-xs font-black ${guideBrand === name ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>{name}</button>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1">
                {categories.map((name) => (
                  <button key={name} type="button" onClick={() => setGuideCategory(name)} className={`rounded px-2.5 py-1 text-[11px] font-black ${guideCategory === name ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"}`}>{name}</button>
                ))}
                <input value={guideQuery} onChange={(e) => setGuideQuery(e.target.value)} placeholder="제목·요약·기종·부품 검색" className="h-8 min-w-40 flex-1 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                <span className="text-xs font-black tabular-nums text-slate-500">{filtered.length}건</span>
                <button type="button" onClick={() => openGuideEditor()} className="rounded-full bg-blue-600 px-4 py-1.5 text-xs font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700">+ 가이드 작성</button>
              </div>
              {topParts.length > 1 && <div className="mt-2 flex flex-wrap items-center gap-1">
                <span className="text-[10px] font-black text-slate-400">부품</span>
                {topParts.map((name) => (
                  <button key={name} type="button" onClick={() => setGuidePart(name)} className={`rounded px-2 py-1 text-[11px] font-black ${guidePart === name ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500"}`}>{name}</button>
                ))}
              </div>}
            </div>
            {guides === null && <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">불러오는 중…</div>}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {filtered.map((doc) => (
                <button key={doc.id} type="button" onClick={() => { setOpenGuide(doc); setShowOriginal(false); }} className="rounded-xl border border-slate-200 bg-white p-3.5 text-left shadow-sm transition hover:border-blue-300 hover:bg-blue-50/40">
                  <div className="flex flex-wrap items-center gap-1">
                    {doc.brand && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-600">{doc.brand}</span>}
                    {doc.category && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-600">{doc.category}</span>}
                    {doc.content.includes("storage/v1") && <span className="text-[10px]">📷</span>}
                  </div>
                  <div className="mt-1.5 text-sm font-black leading-5 text-slate-900">{doc.title}</div>
                  {doc.summary && <div className="mt-1 truncate text-xs font-semibold text-slate-500">{doc.summary}</div>}
                  {((doc.models || []).length > 0 || doc.difficulty) && <div className="mt-1.5 flex flex-wrap gap-1">
                    {(doc.models || []).slice(0, 3).map((model) => <span key={model} className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-500">{model}</span>)}
                    {doc.difficulty && <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${doc.difficulty === "어려움" ? "bg-rose-50 text-rose-600" : doc.difficulty === "보통" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-600"}`}>{doc.difficulty}</span>}
                  </div>}
                </button>
              ))}
            </div>
            {guides !== null && !filtered.length && <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">조건에 맞는 가이드가 없어요.</div>}
            {openGuide && (
              <FormModal wide icon={<span className="text-base">📘</span>} onClose={() => setOpenGuide(null)}
                title={
                  <span className="flex flex-col gap-1.5">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {openGuide.brand && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-black text-slate-300">{openGuide.brand}</span>}
                      {openGuide.category && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-600">{openGuide.category}</span>}
                      {openGuide.difficulty && <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${openGuide.difficulty === "어려움" ? "bg-rose-50 text-rose-600" : openGuide.difficulty === "보통" ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-600"}`}>{openGuide.difficulty}</span>}
                    </span>
                    <span className="text-base leading-snug">{openGuide.title}</span>
                  </span>
                }
                subtitle={`${openGuide.author || "노션 이관"} · ${openGuide.created_at.slice(0, 10)}`}
                footer={<>
                  <button type="button" onClick={() => void removeGuide(openGuide)} className="mr-auto rounded-full px-3 py-2 text-xs font-black text-slate-400 transition hover:bg-rose-50 hover:text-rose-500">삭제</button>
                  <button type="button" onClick={() => openGuideEditor(openGuide)} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-black text-slate-600 transition hover:bg-slate-50">✎ 수정</button>
                  <button type="button" onClick={() => setOpenGuide(null)} className="rounded-full bg-slate-900 px-6 py-2 text-xs font-black text-white transition hover:bg-slate-800">확인</button>
                </>}>
                {openGuide.summary && <div className="rounded-lg bg-blue-50/60 px-3 py-2 text-sm font-bold text-blue-800">{openGuide.summary}</div>}
                <MdView text={!showOriginal && openGuide.content_clean ? openGuide.content_clean : openGuide.content} />
                {!!openGuide.content_clean && <button type="button" onClick={() => setShowOriginal((v) => !v)} className="rounded-full border border-slate-200 px-3 py-1.5 text-[11px] font-black text-slate-500 transition hover:bg-slate-50">{showOriginal ? "정리본 보기" : "원본(노션 그대로) 보기"}</button>}
              </FormModal>
            )}
            {guideEditOpen && (
              <FormModal wide="xl" title={guideDraft.id ? "가이드 수정" : "새 가이드 작성"} subtitle="저장하면 모든 직원의 가이드 목록에 바로 반영됩니다" icon={<span className="text-base">📘</span>} onClose={() => setGuideEditOpen(false)}
                footer={<>
                  <button type="button" onClick={() => setGuideEditOpen(false)} className="rounded-full px-4 py-2.5 text-sm font-bold text-slate-500 transition hover:bg-slate-100">취소</button>
                  <button type="button" disabled={guideBusy || !guideDraft.title.trim() || !guideDraft.content.trim()} onClick={() => void saveGuide()}
                    className="rounded-full bg-blue-600 px-6 py-2.5 text-sm font-black text-white shadow-[0_4px_14px_rgba(37,99,235,0.35)] transition hover:bg-blue-700 disabled:opacity-40 disabled:shadow-none">{guideBusy ? "저장 중…" : guideDraft.id ? "수정 저장" : "가이드 등록"}</button>
                </>}>
                <div className="space-y-4">
                  <label className="block text-xs font-bold text-slate-500">제목 <b className="text-rose-500">*</b>
                    <input autoFocus value={guideDraft.title} onChange={(e) => setGuideDraft({ ...guideDraft, title: e.target.value })} placeholder="예: 세이토 정착기 탈거·조립"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="text-xs font-bold text-slate-500">브랜드
                      <select value={guideDraft.brand} onChange={(e) => setGuideDraft({ ...guideDraft, brand: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">
                        <option value="">공통</option>
                        {BRAND_NAMES.map((name) => <option key={name}>{name}</option>)}
                      </select>
                    </label>
                    <label className="text-xs font-bold text-slate-500">분류
                      <select value={guideDraft.category} onChange={(e) => setGuideDraft({ ...guideDraft, category: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">
                        <option value="">선택 안 함</option>
                        {[...new Set(["시스템 설정/에러", "부품 교체", "기타", ...categories.filter((name) => name !== "전체")])].map((name) => <option key={name}>{name}</option>)}
                      </select>
                    </label>
                    <label className="text-xs font-bold text-slate-500">난이도
                      <select value={guideDraft.difficulty} onChange={(e) => setGuideDraft({ ...guideDraft, difficulty: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">
                        <option value="">선택 안 함</option><option>쉬움</option><option>보통</option><option>어려움</option>
                      </select>
                    </label>
                  </div>
                  <label className="block text-xs font-bold text-slate-500">한 줄 요약
                    <input value={guideDraft.summary} onChange={(e) => setGuideDraft({ ...guideDraft, summary: e.target.value })} placeholder="목록 카드에 보이는 설명"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                  </label>
                  <label className="block text-xs font-bold text-slate-500">적용 기종 <span className="font-semibold text-slate-400">— 쉼표로 구분</span>
                    <input value={guideDraft.modelsText} onChange={(e) => setGuideDraft({ ...guideDraft, modelsText: e.target.value })} placeholder="예: 키슈, 세이토"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                  </label>
                  <div className="text-xs font-bold text-slate-500">
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <span>본문 <b className="text-rose-500">*</b></span>
                      <span className="flex flex-wrap gap-1">
                        {([["H 제목", "## 제목\n"], ["h 소제목", "### 소제목\n"], ["• 목록", "- 항목\n"], ["1. 번호", "1. 첫 단계\n"], ["— 구분선", "---\n"], ["▸ 토글", "::: 눌러서 펼치기\n내용을 여기에\n:::\n"]] as [string, string][]).map(([label, snippet]) => (
                          <button key={label} type="button" onClick={() => insertAtCursor(snippet)}
                            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-black text-slate-500 transition hover:bg-slate-50 hover:text-slate-700">{label}</button>
                        ))}
                        <button type="button" onClick={() => guidePhotoRef.current?.click()} disabled={guidePhotoBusy}
                          className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-black text-blue-600 transition hover:bg-blue-100 disabled:opacity-40">{guidePhotoBusy ? "올리는 중…" : "📷 사진"}</button>
                      </span>
                      <input ref={guidePhotoRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void attachGuidePhoto(e.target.files?.[0] || null); e.target.value = ""; }} />
                    </div>
                    <div className="mt-1 grid items-stretch gap-2 lg:grid-cols-2">
                      <textarea ref={guideBodyRef} value={guideDraft.content} onChange={(e) => setGuideDraft({ ...guideDraft, content: e.target.value })} rows={14}
                        onPaste={(e) => {
                          const pasted = Array.from(e.clipboardData?.files || []).find((f) => /^image\//.test(f.type));
                          if (pasted) { e.preventDefault(); void attachGuidePhoto(pasted); }
                        }}
                        placeholder={"위 버튼으로 서식을 넣거나, 캡처한 사진을 Ctrl+V로 바로 붙여넣으세요.\n\n## 준비물\n- 십자드라이버\n\n::: 자세한 순서 (누르면 펼쳐짐)\n1. 전원 차단\n2. 커버 탈거\n:::"}
                        className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 font-mono text-[13px] leading-6 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                      <div className="max-h-[240px] overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/60 px-4 py-3 lg:max-h-[380px]">
                        <div className="mb-1.5 text-[10px] font-black tracking-wide text-slate-300">미리보기 — 쓰는 대로 바로 적용됩니다</div>
                        {guideDraft.content.trim() ? <MdView text={guideDraft.content} /> : <p className="text-xs font-bold text-slate-300">왼쪽에 쓰기 시작하면 완성본이 여기 나타나요.</p>}
                      </div>
                    </div>
                    <div className="mt-1 text-[10px] font-semibold text-slate-400">💡 사진은 Ctrl+V 붙여넣기 지원 — 커서 위치에 바로 들어갑니다</div>
                  </div>
                </div>
              </FormModal>
            )}
          </div>
        );
      })()}

      {view === "quiz" && <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        {quizIndex < 0 && (() => {
          const bank = notes.filter((n) => n.title.trim() && n.content.trim());
          const bankOf = (name: string) => name === "전체" ? bank.length : bank.filter((n) => n.brand === name).length;
          return <div className="mx-auto max-w-xl py-4 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-3xl shadow-lg shadow-blue-200">🎓</div>
            <h3 className="mt-3 text-xl font-black text-slate-950">복합기 기술 퀴즈</h3>
            <p className="mt-1 text-sm font-semibold text-slate-500">팀이 쌓은 <b className="text-blue-600">{bank.length}건</b>의 실제 처리 사례가 문제가 됩니다.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-1.5">
              {["전체", ...BRAND_NAMES].map((name) => {
                const count = bankOf(name);
                return (
                  <button key={name} type="button" disabled={count < 4} onClick={() => setQuizBrand(name)} className={`rounded-full px-3 py-2 text-xs font-black transition ${quizBrand === name ? "bg-slate-900 text-white" : count < 4 ? "bg-slate-50 text-slate-300" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                    {name} <span className={quizBrand === name ? "text-slate-300" : "text-slate-400"}>{count}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex justify-center gap-2">
              {[5, 10].map((count) => <button key={count} type="button" onClick={() => setQuizCount(count)} className={`rounded-full px-5 py-2.5 text-sm font-black ${quizCount === count ? "bg-blue-600 text-white shadow-sm" : "border border-slate-200 text-slate-600"}`}>{count}문제</button>)}
            </div>
            <button type="button" onClick={startQuiz} className="mt-6 h-12 rounded-full bg-blue-600 shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 px-10 text-sm font-black text-white shadow-md shadow-blue-200 transition">퀴즈 시작 →</button>
            <p className="mt-3 text-[11px] font-bold text-slate-400">브랜드는 문제가 4건 이상일 때 선택할 수 있어요 · FIELD AS 전송이 쌓일수록 문제가 늘어납니다</p>
          </div>;
        })()}
        {currentQuiz && <div className="mx-auto max-w-2xl">
          <div className="flex items-center justify-between text-xs font-black text-slate-400">
            <span>문제 {quizIndex + 1} / {quiz.length}</span><span className="text-blue-600">✓ {quizScore}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${((quizIndex + (quizPick ? 1 : 0)) / quiz.length) * 100}%` }} />
          </div>
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap gap-1.5">
              <span className={`rounded px-2 py-0.5 text-[10px] font-black bg-slate-100 text-slate-600`}>{currentQuiz.note.brand}</span>
              {currentQuiz.note.model && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-600">{currentQuiz.note.model}</span>}
            </div>
            <div className="mt-2 text-base font-black text-slate-950">증상: {currentQuiz.note.title}</div>
            <div className="mt-1 text-xs font-bold text-slate-500">올바른 처리 내용을 고르세요</div>
          </div>
          <div className="mt-3 space-y-2">
            {currentQuiz.options.map((option, optionIndex) => {
              const picked = quizPick === option.id;
              const isAnswer = option.id === currentQuiz.note.id;
              const summary = (parseNoteContent(option.content)?.["처리"] || option.content).replace(/\n/g, " ");
              const tone = !quizPick ? "border-slate-200 bg-white hover:border-blue-300 hover:shadow-sm"
                : isAnswer ? "border-emerald-400 bg-emerald-50"
                : picked ? "border-rose-300 bg-rose-50" : "border-slate-200 bg-white opacity-50";
              return (
                <button key={option.id} type="button" onClick={() => answerQuiz(option.id)} className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left text-sm font-semibold leading-6 text-slate-700 transition ${tone}`}>
                  <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black ${quizPick && isAnswer ? "bg-emerald-500 text-white" : quizPick && picked ? "bg-rose-400 text-white" : "bg-slate-100 text-slate-500"}`}>{["①", "②", "③", "④"][optionIndex]}</span>
                  <span className="min-w-0">{summary.length > 150 ? `${summary.slice(0, 150)}…` : summary}{quizPick && isAnswer && <b className="ml-2 text-xs text-emerald-600">✓ 정답</b>}</span>
                </button>
              );
            })}
          </div>
          {quizPick && <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/50 p-3">
            <div className="text-[10px] font-black text-blue-500">정답 사례 자세히</div>
            <NoteBody note={currentQuiz.note} />
            <div className="mt-1 text-[10px] font-bold text-slate-400">{currentQuiz.note.author || "익명"} · {currentQuiz.note.created_at.slice(0, 10)}</div>
          </div>}
          {quizPick && <div className="mt-4 flex justify-end">
            <button type="button" onClick={nextQuiz} className="rounded-full bg-blue-600 shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 px-7 py-3 text-sm font-black text-white">{quizIndex + 1 >= quiz.length ? "결과 보기 →" : "다음 문제 →"}</button>
          </div>}
        </div>}
        {quizIndex >= quiz.length && quiz.length > 0 && <div className="mx-auto max-w-2xl py-4 text-center">
          <div className="text-4xl">{quizScore === quiz.length ? "🏆" : quizScore >= quiz.length * 0.7 ? "👏" : quizScore >= quiz.length / 2 ? "🙂" : "💪"}</div>
          <h3 className="mt-2 text-2xl font-black text-slate-950">{quizScore} / {quiz.length}</h3>
          <p className="mt-1 text-sm font-bold text-slate-500">정답률 {Math.round((quizScore / quiz.length) * 100)}%{quizScore === quiz.length ? " — 완벽합니다!" : ""}</p>
          {wrongNotes.length > 0 && <div className="mt-5 space-y-2 text-left">
            <div className="text-xs font-black text-slate-400">오답 노트 {wrongNotes.length}건 — 실제 처리 사례로 복습하세요</div>
            {wrongNotes.map((item) => <div key={item.note.id} className="rounded-lg border border-rose-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`rounded px-2 py-0.5 text-[10px] font-black bg-slate-100 text-slate-600`}>{item.note.brand}</span>
                {item.note.model && <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-black text-slate-600">{item.note.model}</span>}
                <span className="text-sm font-black text-slate-900">{item.note.title}</span>
              </div>
              <NoteBody note={item.note} />
            </div>)}
          </div>}
          <div className="mt-6 flex justify-center gap-2">
            {wrongNotes.length > 0 && <button type="button" onClick={retryWrong} className="rounded-lg border border-rose-300 bg-rose-50 px-6 py-3 text-sm font-black text-rose-700">오답만 다시 풀기</button>}
            <button type="button" onClick={() => { setQuizIndex(-1); setQuiz([]); }} className="rounded-full bg-blue-600 shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 px-6 py-3 text-sm font-black text-white">새 퀴즈</button>
          </div>
        </div>}
      </section>}

      {view === "notes" && <>
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {/* 다크 히어로 — 검색이 주인공 */}
        <div className="bg-[#151A23] px-5 pb-5 pt-5 text-center">
          {stats && <div className="mb-3.5 flex flex-wrap justify-center gap-1.5">
            {([["전체", stats.total.toLocaleString()], ["학습", stats.learn.toLocaleString()], ["처리이력", stats.cases.toLocaleString()], ["이번 달", `+${stats.month.toLocaleString()}`]] as [string, string][]).map(([label, value]) => (
              <span key={label} className="rounded-full bg-white/[0.07] px-3 py-1 text-[11px] font-bold text-slate-400">{label} <b className="tabular-nums text-white">{value}</b></span>
            ))}
          </div>}
          <label className="mx-auto flex max-w-xl items-center gap-2.5 rounded-full bg-white/10 px-5 py-3 transition focus-within:bg-white/[0.16]">
            <span className="shrink-0 text-slate-500">🔍</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="증상 · 에러코드 · 기종 · 처리법 검색"
              className="min-w-0 flex-1 bg-transparent text-sm font-bold text-white outline-none placeholder:text-slate-500" />
            {query && <button type="button" onClick={() => setQuery("")} aria-label="검색어 지우기" className="shrink-0 text-xs font-black text-slate-500 transition hover:text-slate-300">✕</button>}
          </label>
          {recentSearches.length > 0 && <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5">
            <span className="text-[10px] font-black text-slate-600">최근</span>
            {recentSearches.map((item) => (
              <button key={item} type="button" onClick={() => setQuery(item)} className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-[11px] font-bold text-slate-400 transition hover:bg-white/[0.14] hover:text-slate-200">{item}</button>
            ))}
          </div>}
        </div>

        {/* 브랜드 바 + 구분·정렬 + 기록 추가 */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-4 py-2.5">
          {["전체", ...BRAND_NAMES].map((name) => (
            <button key={name} type="button" onClick={() => { setBrand(name); setModel("전체"); }}
              className={`rounded-full px-3 py-1.5 text-xs font-black transition ${brand === name ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>{name}</button>
          ))}
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <div className="flex rounded-full bg-slate-100 p-0.5">
              {(["전체", "학습", "처리이력"] as const).map((value) => (
                <button key={value} type="button" onClick={() => setKindFilter(value)} className={`rounded-full px-2.5 py-1 text-[11px] font-black transition ${kindFilter === value ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{value}</button>
              ))}
            </div>
            <div className="flex rounded-full bg-slate-100 p-0.5">
              {([["desc", "최신순"], ["asc", "오래된순"]] as const).map(([value, label]) => (
                <button key={value} type="button" onClick={() => setOrder(value)} className={`rounded-full px-2.5 py-1 text-[11px] font-black transition ${order === value ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{label}</button>
              ))}
            </div>
            <button type="button" onClick={() => { setWriteOpen(true); setDraft({ ...draft, brand: brand === "전체" ? "삼성" : brand, model: model === "전체" ? "" : model }); }}
              className="rounded-full bg-blue-600 px-4 py-1.5 text-xs font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700">+ 기록 추가</button>
          </div>
        </div>
        {brand !== "전체" && (
          <div className="flex flex-wrap gap-1 border-b border-slate-100 bg-slate-50/50 px-4 py-2">
            {["전체", ...(BRANDS[brand] || [])].map((name) => (
              <button key={name} type="button" onClick={() => setModel(name)} className={`rounded-full px-2.5 py-1 text-[11px] font-black transition ${model === name ? "bg-blue-600 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100"}`}>{name}</button>
            ))}
          </div>
        )}

        {error && <div className="border-b border-rose-100 bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-700">{error}</div>}
        {loading && !notes.length && <div className="p-10 text-center text-sm font-bold text-slate-400">불러오는 중…</div>}
        {!loading && !filtered.length && <div className="p-12 text-center text-sm font-bold text-slate-400">{notes.length || query.trim() ? "조건에 맞는 기록이 없어요." : "첫 기록을 남겨보세요 — 같은 증상에서 팀 전체의 시간이 줄어듭니다."}</div>}

        {/* 증상 → 처리 행 리스트 */}
        <div className="divide-y divide-slate-50">
          {filtered.map((note) => {
            const parsed = parseNoteContent(note.content);
            const fix = (parsed?.["처리"] || (note.title ? note.content : "")).replace(/\n/g, " ").trim();
            const titleText = note.title || note.content.split("\n")[0];
            return (
              <button key={note.id} type="button" onClick={() => setNoteDetail(note)} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition hover:bg-slate-50">
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${note.kind === "학습" ? "bg-blue-50 text-blue-600" : "bg-emerald-50 text-emerald-700"}`}>{note.kind}</span>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">{note.brand}{note.model ? ` ${note.model}` : ""}</span>
                <span className="max-w-[45%] shrink-0 truncate text-[13.5px] font-black text-slate-900 sm:max-w-[32%]">{titleText}</span>
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-400">{fix ? `→ ${fix}` : ""}</span>
                <span className="hidden shrink-0 text-[11px] font-bold tabular-nums text-slate-400 sm:inline">{note.author || "익명"} · {note.created_at.slice(5, 10)}</span>
              </button>
            );
          })}
        </div>
        {hasMore && <button type="button" onClick={() => void load(notes.length)} disabled={loading}
          className="w-full border-t border-slate-100 py-3 text-sm font-black text-slate-500 transition hover:bg-slate-50 disabled:text-slate-300">{loading ? "불러오는 중…" : `더 보기 (현재 ${notes.length}건 표시)`}</button>}
      </section>

      {/* 기록 상세 모달 */}
      {noteDetail && (
        <FormModal icon={<span className="text-base">🔧</span>} onClose={() => setNoteDetail(null)}
          title={
            <span className="flex flex-col gap-1.5">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${noteDetail.kind === "학습" ? "bg-blue-50 text-blue-600" : "bg-emerald-50 text-emerald-700"}`}>{noteDetail.kind}</span>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-black text-slate-300">{noteDetail.brand}{noteDetail.model ? ` ${noteDetail.model}` : ""}</span>
              </span>
              <span className="text-base leading-snug">{noteDetail.title || "기록 상세"}</span>
            </span>
          }
          subtitle={`${noteDetail.author || "익명"} · ${noteDetail.created_at.slice(0, 10)}`}
          footer={<>
            {noteDetail.author === author && <button type="button" onClick={() => void removeNote(noteDetail)}
              className="mr-auto rounded-full px-3 py-2 text-xs font-black text-slate-400 transition hover:bg-rose-50 hover:text-rose-500">삭제</button>}
            <button type="button" onClick={() => { void navigator.clipboard.writeText(`[${noteDetail.brand}${noteDetail.model ? ` ${noteDetail.model}` : ""}] ${noteDetail.title}\n${noteDetail.content}`); notify("내용을 복사했습니다."); }}
              className="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-black text-slate-600 transition hover:bg-slate-50">📋 복사</button>
            <button type="button" onClick={() => setNoteDetail(null)} className="rounded-full bg-slate-900 px-6 py-2 text-xs font-black text-white transition hover:bg-slate-800">확인</button>
          </>}>
          <NoteBody note={noteDetail} />
        </FormModal>
      )}
            </>}

      {writeOpen && (
        <div className="fixed inset-0 z-[200] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setWriteOpen(false)}>
          <div className="flex max-h-[90vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <b>복합기 기록 추가</b>
              <button type="button" onClick={() => setWriteOpen(false)} className="rounded-full px-3 py-1.5 text-xs font-bold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700">닫기</button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-bold text-slate-500">브랜드
                  <select value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value, model: "" })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">
                    {BRAND_NAMES.map((name) => <option key={name}>{name}</option>)}
                  </select>
                </label>
                <label className="text-xs font-bold text-slate-500">구분
                  <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as "학습" | "처리이력" })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">
                    <option>학습</option><option>처리이력</option>
                  </select>
                </label>
              </div>
              <div className="text-xs font-bold text-slate-500">기종
                <div className="mt-1 flex flex-wrap gap-1">
                  {(BRANDS[draft.brand] || []).map((name) => (
                    <button key={name} type="button" onClick={() => setDraft({ ...draft, model: name })} className={`rounded px-2.5 py-1.5 text-[11px] font-black ${draft.model === name ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"}`}>{name}</button>
                  ))}
                </div>
                <input value={draft.model} list="copier-model-catalog" onChange={(e) => {
                  const value = e.target.value;
                  const detected = brandOfModel(value);
                  setDraft({ ...draft, model: value, ...(detected && BRAND_NAMES.includes(detected) ? { brand: detected } : {}) });
                }} placeholder="직접 입력 가능 — 정식 기종명 입력 시 브랜드 자동 선택" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                <datalist id="copier-model-catalog">{ALL_MODEL_NAMES.map((name) => <option key={name} value={name} />)}</datalist>
              </div>
              <label className="block text-xs font-bold text-slate-500">제목 (증상 요약)
                <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="예: 출력물 세로줄 발생" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
              </label>
              <label className="block text-xs font-bold text-slate-500">내용 (증상 · 원인 · 해결 방법)
                <textarea value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} rows={6} placeholder={"증상:\n원인:\n해결:"} className="mt-1 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold leading-6 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button type="button" onClick={() => setWriteOpen(false)} className="rounded-full border border-slate-200 px-4 py-2 text-sm font-bold text-slate-500">취소</button>
              <button type="button" disabled={busy || !draft.content.trim()} onClick={() => void submit()} className="rounded-full bg-slate-900 transition hover:bg-slate-800 px-5 py-2 text-sm font-black text-white disabled:opacity-40">{busy ? "저장 중…" : "저장"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
