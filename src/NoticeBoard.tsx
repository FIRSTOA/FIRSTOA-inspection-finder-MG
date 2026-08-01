import { useCallback, useEffect, useMemo, useState } from "react";
import { Megaphone, Pin, Plus, Search, Trash2 } from "lucide-react";
import FormModal from "./FormModal";
import { deleteRows, insertRow, selectRows, updateRows } from "./supabase";
import { useAuthorBook, useMembers } from "./authors";
import PersonPicker from "./PersonPicker";
import { audienceNames, makeIsForMe, teamTargetLabel, teamTargetOptions } from "./audience";
import { pingInbox } from "./useInboxBadge";
import PortalSelect from "./PortalSelect";
import { notify } from "./toast";

/**
 * 공지사항 — 게시판형 리스트 + 상세 모달.
 *
 * 한 줄 = 한 공지 (구분 칩 · 제목 · 대상 · 읽음 진행). 행을 누르면 상세 모달이
 * 열리며 그 순간 내 읽음이 기록된다. 본문·안읽음 명단·고정/삭제는 전부 모달 안 —
 * 리스트는 훑는 곳, 모달은 읽는 곳으로 가른다. 고정·긴급은 항상 맨 위.
 */
type Notice = {
  id: string;
  created_at: string;
  author: string;
  title: string;
  body: string;
  category: string;
  target_type: "전체" | "팀" | "개인";
  target: string;
  pinned: boolean;
};
type ReadRow = { notice_id: string; reader: string };

const CATEGORIES = ["일반", "긴급", "인사", "시스템"] as const;
const CATEGORY_TONE: Record<string, string> = {
  긴급: "bg-rose-50 text-rose-600", 일반: "bg-slate-100 text-slate-500",
  인사: "bg-amber-50 text-amber-700", 시스템: "bg-blue-50 text-blue-700",
};

function stamp(iso: string) {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function NoticeBoard({ author, onUnreadChange }: { author: string; onUnreadChange?: (n: number) => void }) {
  const { book } = useAuthorBook();
  const members = useMembers();
  const [rows, setRows] = useState<Notice[]>([]);
  const [reads, setReads] = useState<ReadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState("");
  const [showReaders, setShowReaders] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ title: "", body: "", category: "일반" as string, target_type: "전체" as Notice["target_type"], target: "", pinned: false });

  const teamOptions = useMemo(() => teamTargetOptions(members), [members]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [notices, readRows] = await Promise.all([
        selectRows<Notice>("notices", "select=*&order=pinned.desc,created_at.desc&limit=300"),
        selectRows<ReadRow>("notice_reads", "select=notice_id,reader&limit=5000"),
      ]);
      setRows(notices);
      setReads(readRows);
      setError("");
    } catch (e) {
      setError((e as Error).message || "공지를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const isForMe = useMemo(() => makeIsForMe(author, members, book), [author, members, book]);
  const audienceOf = useCallback((row: Notice): string[] => audienceNames(row, members, book), [members, book]);

  const readSet = useMemo(() => {
    const map = new Map<string, Set<string>>();
    reads.forEach((read) => {
      const set = map.get(read.notice_id) || new Set<string>();
      set.add(read.reader);
      map.set(read.notice_id, set);
    });
    return map;
  }, [reads]);

  const visible = useMemo(() => {
    const query = search.trim();
    return rows
      .filter((row) => scope === "all" || isForMe(row))
      .filter((row) => !query || row.title.includes(query) || row.body.includes(query) || row.author.includes(query))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned)
        || Number(b.category === "긴급") - Number(a.category === "긴급")
        || b.created_at.localeCompare(a.created_at));
  }, [rows, scope, isForMe, search]);

  const myUnread = useMemo(
    () => rows.filter((row) => isForMe(row) && author && !readSet.get(row.id)?.has(author)).length,
    [rows, isForMe, readSet, author],
  );
  useEffect(() => { onUnreadChange?.(myUnread); }, [myUnread, onUnreadChange]);

  const markRead = async (row: Notice) => {
    if (!author || readSet.get(row.id)?.has(author)) return;
    setReads((current) => [...current, { notice_id: row.id, reader: author }]);
    try {
      await insertRow("notice_reads", { notice_id: row.id, reader: author });
      pingInbox();
    } catch { /* PK 충돌(이미 읽음)은 무시 */ }
  };

  const openDetail = (row: Notice) => {
    setDetailId(row.id);
    setShowReaders(false);
    void markRead(row);
  };

  const submit = async () => {
    if (busy || !draft.title.trim()) return;
    if (draft.target_type !== "전체" && !draft.target) { notify("대상 팀/직원을 선택하세요.", "error"); return; }
    setBusy(true);
    try {
      await insertRow("notices", {
        author: author || "미지정", title: draft.title.trim(), body: draft.body.trim(), category: draft.category,
        target_type: draft.target_type, target: draft.target_type === "전체" ? "" : draft.target, pinned: draft.pinned,
      });
      setDraft({ title: "", body: "", category: "일반", target_type: "전체", target: "", pinned: false });
      setFormOpen(false);
      await load();
      pingInbox();
    } catch (e) {
      notify(`등록 실패: ${(e as Error).message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const togglePin = async (row: Notice) => {
    setRows((current) => current.map((item) => item.id === row.id ? { ...item, pinned: !row.pinned } : item));
    try {
      await updateRows("notices", `id=eq.${row.id}`, { pinned: !row.pinned });
    } catch (e) { notify(`고정 변경 실패: ${(e as Error).message}`, "error"); void load(); }
  };

  const remove = async (row: Notice) => {
    if (!window.confirm(`"${row.title}" 공지를 삭제할까요?`)) return;
    try {
      await deleteRows("notices", `id=eq.${row.id}`);
      setRows((current) => current.filter((item) => item.id !== row.id));
      setDetailId("");
      pingInbox();
    } catch (e) { notify(`삭제 실패: ${(e as Error).message}`, "error"); }
  };

  const categoryChip = (row: Notice) => (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${CATEGORY_TONE[row.category] || CATEGORY_TONE.일반}`}>{row.category || "일반"}</span>
  );
  const targetBadge = (row: Notice) => {
    if (row.target_type === "전체") return <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-600">전체</span>;
    if (row.target_type === "팀") return <span className="shrink-0 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-black text-violet-600">팀 · {teamTargetLabel(row.target)}</span>;
    if (author && row.target === author) return <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-800 ring-1 ring-emerald-300">👤 나에게</span>;
    return <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700">👤 {row.target}</span>;
  };

  const detailRow = detailId ? rows.find((row) => row.id === detailId) : undefined;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full bg-slate-100 p-1">
            {([["mine", "내 공지"], ["all", "모든 공지"]] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setScope(key)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-black transition ${scope === key ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{label}</button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 transition focus-within:bg-slate-200/70">
            <Search size={13} className="shrink-0 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="공지 검색"
              className="w-24 bg-transparent text-xs font-bold text-slate-700 outline-none placeholder:text-slate-400 lg:w-36" />
          </label>
          {myUnread > 0 && <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-black text-rose-600">안 읽음 {myUnread}건</span>}
          <button type="button" onClick={() => setFormOpen(true)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-2 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700">
            <Plus size={15} />공지 작성
          </button>
        </div>
      </section>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div>}
      {loading && <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">불러오는 중…</div>}
      {!loading && !visible.length && (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm font-bold text-slate-400">
          {search.trim() ? `"${search.trim()}" 검색 결과가 없습니다` : "아직 공지가 없습니다. 첫 공지를 작성해 보세요."}
        </div>
      )}

      {!loading && visible.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {visible.map((row) => {
            const readers = readSet.get(row.id) || new Set<string>();
            const audience = audienceOf(row);
            const readCount = audience.filter((name) => readers.has(name)).length;
            const percent = audience.length ? Math.round((readCount / audience.length) * 100) : 0;
            const iRead = !author || readers.has(author);
            const lifted = row.pinned || row.category === "긴급";
            return (
              <button key={row.id} type="button" onClick={() => openDetail(row)}
                className={`flex w-full items-center gap-2.5 border-b border-slate-50 px-4 py-2.5 text-left transition last:border-b-0 hover:bg-slate-50/80 ${lifted ? "bg-slate-50/60" : "bg-white"}`}>
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${iRead ? "bg-transparent" : "bg-rose-500"}`} title={iRead ? "" : "안 읽음"} />
                {categoryChip(row)}
                {row.pinned && <Pin size={12} className="shrink-0 text-blue-600" />}
                <span className={`min-w-0 flex-1 truncate text-[13.5px] leading-snug ${iRead ? "font-bold text-slate-500" : "font-black text-slate-950"}`}>{row.title}</span>
                {targetBadge(row)}
                <span className="hidden shrink-0 text-[11px] font-bold tabular-nums text-slate-400 sm:inline">{row.author} · {row.created_at.slice(5, 10)}</span>
                <span className="shrink-0 text-right">
                  <span className={`block text-[11px] font-black tabular-nums ${percent === 100 ? "text-emerald-600" : "text-slate-500"}`}>{readCount}/{audience.length}</span>
                  <span className="mt-0.5 block h-1 w-12 overflow-hidden rounded-full bg-slate-100">
                    <span className={`block h-full rounded-full transition-all ${percent === 100 ? "bg-emerald-500" : "bg-blue-500"}`} style={{ width: `${percent}%` }} />
                  </span>
                </span>
              </button>
            );
          })}
        </section>
      )}

      {/* ── 상세 모달 — 본문 · 읽음 확인 · 고정/삭제 ── */}
      {detailRow && (() => {
        const readers = readSet.get(detailRow.id) || new Set<string>();
        const audience = audienceOf(detailRow);
        const unreadPeople = audience.filter((name) => !readers.has(name));
        const readPeople = audience.filter((name) => readers.has(name));
        const percent = audience.length ? Math.round((readPeople.length / audience.length) * 100) : 0;
        return (
          <FormModal wide icon={<Megaphone size={17} />} onClose={() => setDetailId("")}
            title={
              <span className="flex flex-col gap-1.5">
                <span className="flex flex-wrap items-center gap-1.5">{categoryChip(detailRow)}{targetBadge(detailRow)}{detailRow.pinned && <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-black text-blue-300"><Pin size={10} />고정됨</span>}</span>
                <span className="text-base leading-snug">{detailRow.title}</span>
              </span>
            }
            subtitle={`${detailRow.author} · ${stamp(detailRow.created_at)}`}
            footer={<>
              <button type="button" onClick={() => void remove(detailRow)}
                className="mr-auto inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-black text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"><Trash2 size={13} />삭제</button>
              <button type="button" onClick={() => void togglePin(detailRow)}
                className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-black transition ${detailRow.pinned ? "bg-blue-600 text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] hover:bg-blue-700" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}>
                <Pin size={12} />{detailRow.pinned ? "고정 해제" : "상단 고정"}
              </button>
              <button type="button" onClick={() => setDetailId("")}
                className="rounded-full bg-slate-900 px-6 py-2 text-xs font-black text-white transition hover:bg-slate-800">확인</button>
            </>}>
            <p className="whitespace-pre-wrap rounded-xl bg-slate-50 px-4 py-3.5 text-sm font-semibold leading-7 text-slate-700">{detailRow.body || "(내용 없음)"}</p>
            <div>
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] font-black tracking-wide text-slate-500">읽음 확인</span>
                <span className={`text-xs font-black tabular-nums ${percent === 100 ? "text-emerald-600" : "text-slate-700"}`}>{readPeople.length}/{audience.length} <span className="font-bold text-slate-400">· {percent}%</span></span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div className={`h-full rounded-full transition-all ${percent === 100 ? "bg-emerald-500" : "bg-blue-500"}`} style={{ width: `${percent}%` }} />
              </div>
              {unreadPeople.length > 0 ? (
                <div className="mt-2.5 flex flex-wrap items-center gap-1">
                  <span className="mr-0.5 text-[10px] font-black text-rose-400">안 읽음 {unreadPeople.length}</span>
                  {unreadPeople.slice(0, 24).map((name) => <span key={name} className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">{name}</span>)}
                  {unreadPeople.length > 24 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-400">+{unreadPeople.length - 24}</span>}
                </div>
              ) : (
                <div className="mt-2.5"><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700">✓ 전원 읽음</span></div>
              )}
              {readPeople.length > 0 && unreadPeople.length > 0 && (
                <div className="mt-2">
                  <button type="button" onClick={() => setShowReaders((current) => !current)}
                    className="text-[10px] font-black text-slate-400 transition hover:text-slate-600">읽은 사람 {readPeople.length}명 {showReaders ? "접기 ▲" : "보기 ▼"}</button>
                  {showReaders && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {readPeople.map((name) => <span key={name} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">{name}</span>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </FormModal>
        );
      })()}

      {/* ── 작성 모달 ── */}
      {formOpen && (
        <FormModal title="새 공지" subtitle={`${author || "작성자 미선택"} 이름으로 올라갑니다 — 읽음 여부가 모두에게 보여요`} icon={<Megaphone size={17} />} onClose={() => setFormOpen(false)}
          footer={<>
            <button type="button" onClick={() => setFormOpen(false)} className="rounded-full px-4 py-2.5 text-sm font-bold text-slate-500 transition hover:bg-slate-100">취소</button>
            <button type="button" disabled={busy || !draft.title.trim()} onClick={() => void submit()}
              className="rounded-full bg-blue-600 px-6 py-2.5 text-sm font-black text-white shadow-[0_4px_14px_rgba(37,99,235,0.35)] transition hover:bg-blue-700 disabled:opacity-40 disabled:shadow-none">{busy ? "올리는 중…" : "공지 올리기"}</button>
          </>}>
          <div className="space-y-4">
              <div className="text-xs font-bold text-slate-500">구분
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {CATEGORIES.map((name) => (
                    <button key={name} type="button" onClick={() => setDraft({ ...draft, category: name })}
                      className={`rounded-full px-3.5 py-2 text-xs font-black transition ${draft.category === name ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>{name}</button>
                  ))}
                  <span className="ml-1 text-[10px] font-bold text-slate-400">긴급은 목록 맨 위에 올라갑니다</span>
                </div>
              </div>
              <label className="block text-xs font-bold text-slate-500">제목 <b className="text-rose-500">*</b>
                <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
              </label>
              <div className="text-xs font-bold text-slate-500">누구에게
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <div className="flex rounded-full bg-slate-100 p-1">
                    {(["전체", "팀", "개인"] as const).map((type) => (
                      <button key={type} type="button" onClick={() => setDraft({ ...draft, target_type: type, target: "" })}
                        className={`rounded-full px-3.5 py-1.5 text-xs font-black transition ${draft.target_type === type ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>
                        {type === "전체" ? "전체 공지" : type === "팀" ? "특정 팀" : "특정 직원"}
                      </button>
                    ))}
                  </div>
                  {draft.target_type === "팀" && (
                    <PortalSelect width={185} value={draft.target} onChange={(next) => setDraft({ ...draft, target: next })} placeholder="부서·팀 선택"
                      options={teamOptions} />
                  )}
                </div>
                {draft.target_type === "개인" && <div className="mt-2 rounded-xl border border-slate-100 bg-slate-50/60 p-2.5"><PersonPicker value={draft.target} onChange={(next) => setDraft({ ...draft, target: next })} /></div>}
              </div>
              <label className="block text-xs font-bold text-slate-500">내용
                <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={5}
                  className="mt-1 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold leading-6 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-600">
                <input type="checkbox" checked={draft.pinned} onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })} className="h-4 w-4 accent-blue-600" />
                목록 상단에 고정 (중요 공지)
              </label>
          </div>
        </FormModal>
      )}
    </div>
  );
}
