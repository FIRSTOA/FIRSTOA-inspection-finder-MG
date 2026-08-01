import { useCallback, useEffect, useMemo, useState } from "react";
import { Megaphone, Pin, Plus, Trash2 } from "lucide-react";
import FormModal from "./FormModal";
import { deleteRows, insertRow, selectRows, updateRows } from "./supabase";
import { AUTHOR_TEAMS, useAuthorBook } from "./authors";
import PortalSelect from "./PortalSelect";
import { notify } from "./toast";

/**
 * 공지사항 — 부서요청과 같은 대상 체계(전체/팀/개인)를 쓰는 "읽으면 끝"인 소식.
 *
 * 핵심은 읽음 확인: 카드를 펼치면 내 읽음이 기록되고,
 * 모두에게 "읽음 9/14 · 안 읽음: 홍길동, …"이 보인다 — 공지가 전달됐는지
 * 다시 물어볼 필요가 없게.
 */
type Notice = {
  id: string;
  created_at: string;
  author: string;
  title: string;
  body: string;
  target_type: "전체" | "팀" | "개인";
  target: string;
  pinned: boolean;
};
type ReadRow = { notice_id: string; reader: string };

export default function NoticeBoard({ author, onUnreadChange }: { author: string; onUnreadChange?: (n: number) => void }) {
  const { book } = useAuthorBook();
  const [rows, setRows] = useState<Notice[]>([]);
  const [reads, setReads] = useState<ReadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState("");
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ title: "", body: "", target_type: "전체" as Notice["target_type"], target: "", pinned: false });

  const myTeam = useMemo(() => AUTHOR_TEAMS.find((team) => book[team]?.includes(author)) || "", [book, author]);
  const activeMembers = useMemo(() => AUTHOR_TEAMS.flatMap((team) => book[team] || []), [book]);

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

  const isForMe = useCallback((row: Notice) => {
    if (row.target_type === "전체") return true;
    if (row.target_type === "팀") return !!myTeam && row.target === myTeam;
    return !!author && row.target === author;
  }, [myTeam, author]);

  /** 공지의 대상 인원 명단 (읽음 분모) */
  const audienceOf = useCallback((row: Notice): string[] => {
    if (row.target_type === "전체") return activeMembers;
    if (row.target_type === "팀") return book[row.target as typeof AUTHOR_TEAMS[number]] || [];
    return [row.target];
  }, [activeMembers, book]);

  const readSet = useMemo(() => {
    const map = new Map<string, Set<string>>();
    reads.forEach((read) => {
      const set = map.get(read.notice_id) || new Set<string>();
      set.add(read.reader);
      map.set(read.notice_id, set);
    });
    return map;
  }, [reads]);

  const visible = useMemo(() => rows.filter((row) => scope === "all" || isForMe(row)), [rows, scope, isForMe]);
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
    } catch { /* PK 충돌(이미 읽음)은 무시 */ }
  };

  const submit = async () => {
    if (busy || !draft.title.trim()) return;
    if (draft.target_type !== "전체" && !draft.target) { notify("대상 팀/직원을 선택하세요.", "error"); return; }
    setBusy(true);
    try {
      await insertRow("notices", {
        author: author || "미지정", title: draft.title.trim(), body: draft.body.trim(),
        target_type: draft.target_type, target: draft.target_type === "전체" ? "" : draft.target, pinned: draft.pinned,
      });
      setDraft({ title: "", body: "", target_type: "전체", target: "", pinned: false });
      setFormOpen(false);
      await load();
    } catch (e) {
      notify(`등록 실패: ${(e as Error).message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const togglePin = async (row: Notice) => {
    setRows((current) => current.map((item) => item.id === row.id ? { ...item, pinned: !row.pinned } : item)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at.localeCompare(a.created_at)));
    try {
      await updateRows("notices", `id=eq.${row.id}`, { pinned: !row.pinned });
    } catch (e) { notify(`고정 변경 실패: ${(e as Error).message}`, "error"); void load(); }
  };

  const remove = async (row: Notice) => {
    if (!window.confirm(`"${row.title}" 공지를 삭제할까요?`)) return;
    try {
      await deleteRows("notices", `id=eq.${row.id}`);
      setRows((current) => current.filter((item) => item.id !== row.id));
    } catch (e) { notify(`삭제 실패: ${(e as Error).message}`, "error"); }
  };

  const targetBadge = (row: Notice) => {
    if (row.target_type === "전체") return <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-600">전체</span>;
    if (row.target_type === "팀") return <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-black text-violet-600">{row.target}팀</span>;
    return <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700">{row.target}</span>;
  };

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
          {myUnread > 0 && <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-black text-rose-600">안 읽음 {myUnread}건</span>}
          <button type="button" onClick={() => setFormOpen(true)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-2 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700">
            <Plus size={15} />공지 작성
          </button>
        </div>
      </section>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div>}
      {loading && <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">불러오는 중…</div>}
      {!loading && !visible.length && <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm font-bold text-slate-400">아직 공지가 없습니다. 첫 공지를 작성해 보세요.</div>}

      <div className="space-y-2">
        {visible.map((row) => {
          const readers = readSet.get(row.id) || new Set<string>();
          const audience = audienceOf(row);
          const unreadPeople = audience.filter((name) => !readers.has(name));
          const iRead = !author || readers.has(author);
          const open = openId === row.id;
          return (
            <article key={row.id} className={`overflow-hidden rounded-xl border shadow-sm transition ${row.pinned ? "border-blue-200 bg-blue-50/30" : "border-slate-200 bg-white"}`}>
              <button type="button" className="block w-full px-4 py-3 text-left"
                onClick={() => { setOpenId(open ? "" : row.id); if (!open) void markRead(row); }}>
                <div className="flex flex-wrap items-center gap-1.5">
                  {row.pinned && <Pin size={13} className="shrink-0 text-blue-600" />}
                  {!iRead && <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500" title="안 읽음" />}
                  <span className={`min-w-0 truncate text-[14px] leading-snug ${iRead ? "font-bold text-slate-700" : "font-black text-slate-950"}`}>{row.title}</span>
                  {targetBadge(row)}
                  <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px] font-bold text-slate-400">
                    <span className={`tabular-nums ${unreadPeople.length ? "" : "text-emerald-600"}`}>읽음 {audience.length - unreadPeople.length}/{audience.length}</span>
                    <span>{row.author} · {row.created_at.slice(5, 10)}</span>
                  </span>
                </div>
              </button>
              {open && (
                <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3">
                  <p className="whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-700">{row.body || "(내용 없음)"}</p>
                  <div className="mt-3 flex flex-wrap items-start gap-2">
                    {unreadPeople.length > 0 ? (
                      <div className="flex min-w-0 flex-wrap items-center gap-1">
                        <span className="text-[10px] font-black text-slate-400">안 읽음</span>
                        {unreadPeople.map((name) => <span key={name} className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">{name}</span>)}
                      </div>
                    ) : (
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700">✓ 전원 읽음</span>
                    )}
                    <span className="ml-auto flex shrink-0 gap-1.5">
                      <button type="button" onClick={() => void togglePin(row)}
                        className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-black transition ${row.pinned ? "bg-blue-600 text-white hover:bg-blue-700" : "border border-slate-300 bg-white text-slate-500 hover:bg-slate-50"}`}>
                        <Pin size={12} />{row.pinned ? "고정 해제" : "상단 고정"}
                      </button>
                      <button type="button" onClick={() => void remove(row)}
                        className="rounded-full p-1.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"><Trash2 size={14} /></button>
                    </span>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {formOpen && (
        <FormModal title="새 공지" subtitle={`${author || "작성자 미선택"} 이름으로 올라갑니다 — 읽음 여부가 모두에게 보여요`} icon={<Megaphone size={17} />} onClose={() => setFormOpen(false)}
          footer={<>
            <button type="button" onClick={() => setFormOpen(false)} className="rounded-full px-4 py-2.5 text-sm font-bold text-slate-500 transition hover:bg-slate-100">취소</button>
            <button type="button" disabled={busy || !draft.title.trim()} onClick={() => void submit()}
              className="rounded-full bg-blue-600 px-6 py-2.5 text-sm font-black text-white shadow-[0_4px_14px_rgba(37,99,235,0.35)] transition hover:bg-blue-700 disabled:opacity-40 disabled:shadow-none">{busy ? "올리는 중…" : "공지 올리기"}</button>
          </>}>
          <div className="space-y-4">
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
                    <PortalSelect width={110} value={draft.target} onChange={(next) => setDraft({ ...draft, target: next })} placeholder="팀 선택"
                      options={AUTHOR_TEAMS.filter((team) => team !== "팀장").map((team) => ({ value: team, label: `${team}팀` }))} />
                  )}
                  {draft.target_type === "개인" && (
                    <PortalSelect width={160} value={draft.target} onChange={(next) => setDraft({ ...draft, target: next })} placeholder="직원 선택"
                      options={AUTHOR_TEAMS.flatMap((team) => (book[team] || []).map((name) => ({ value: name, label: name, group: `${team}팀` })))} />
                  )}
                </div>
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
