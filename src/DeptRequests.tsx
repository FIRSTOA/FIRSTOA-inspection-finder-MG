import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteRows, insertRow, selectRows, updateRows } from "./supabase";
import { AUTHOR_TEAMS, useAuthorBook } from "./authors";
import { COMPANY_MEMBERS, memberGroup, memberValue } from "./companyDirectory";
import PortalSelect from "./PortalSelect";
import { notify } from "./toast";

/**
 * 부서 요청 — 타부서가 CS팀에 올리는 요청함.
 * (미수·초과료 현황 보드는 성격이 "조회"라 조회 탭으로 이동, 2026-08-01)
 *
 * 대상 지정: 전체 공지 / 특정 팀 / 특정 개인.
 * 기본 보기는 "내 것"(전체공지 + 우리 팀 + 나에게 온 것) — 다른 팀 앞으로 온
 * 요청까지 다 보이면 정작 내가 처리할 일이 묻힌다.
 */
type DeptRequest = {
  id: number;
  created_at: string;
  requester: string;
  kind: string;
  vendor: string;
  content: string;
  due_date: string | null;
  status: "대기" | "처리중" | "완료";
  handled_by: string;
  handled_at: string | null;
  target_type: "전체" | "팀" | "개인";
  target: string;
};

const KINDS = ["카운터확인", "미수체크", "방문요청", "기타"] as const;
const STATUS_TONE: Record<string, string> = {
  대기: "bg-rose-100 text-rose-700", 처리중: "bg-amber-100 text-amber-800", 완료: "bg-slate-100 text-slate-500",
};
const STATUS_BAR: Record<string, string> = { 대기: "bg-rose-500", 처리중: "bg-amber-400", 완료: "bg-slate-200" };

export default function DeptRequests({ author, embedded = false }: { author: string; embedded?: boolean }) {
  const { book } = useAuthorBook();
  const [rows, setRows] = useState<DeptRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [kindFilter, setKindFilter] = useState("전체");
  const [statusFilter, setStatusFilter] = useState("진행");
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState({
    requester: "", kind: "카운터확인" as string, kindCustom: "", vendor: "", content: "", due_date: "",
    target_type: "전체" as DeptRequest["target_type"], target: "",
  });
  const [busy, setBusy] = useState(false);

  const myTeam = useMemo(() => AUTHOR_TEAMS.find((team) => book[team]?.includes(author)) || "", [book, author]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRows(await selectRows<DeptRequest>("dept_requests", "select=*&order=created_at.desc&limit=500"));
    } catch (e) {
      setError((e as Error).message || "불러오기 실패 — supabase/dept-requests.sql 실행 여부를 확인하세요.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const isMine = useCallback((row: DeptRequest) => {
    const type = row.target_type || "전체";
    if (type === "전체") return true;
    if (type === "팀") return !!myTeam && row.target === myTeam;
    return !!author && row.target === author;
  }, [myTeam, author]);

  const visible = useMemo(() => rows.filter((row) => scope === "all" || isMine(row)), [rows, scope, isMine]);
  const waiting = visible.filter((row) => row.status === "대기").length;
  const hiddenCount = rows.length - visible.length;

  const filtered = useMemo(() => visible.filter((row) => {
    if (kindFilter !== "전체" && !(row.kind === kindFilter || (kindFilter === "기타" && row.kind.startsWith("기타")))) return false;
    if (statusFilter === "진행") return row.status !== "완료";
    if (statusFilter !== "전체" && row.status !== statusFilter) return false;
    return true;
  }), [visible, kindFilter, statusFilter]);

  const submit = async () => {
    const requester = draft.requester.startsWith("__") ? draft.requester.slice(2).trim() : draft.requester.trim();
    if (busy || !draft.content.trim() || !requester) return;
    if (draft.target_type !== "전체" && !draft.target) { notify("대상 팀/직원을 선택하세요.", "error"); return; }
    setBusy(true);
    try {
      const kind = draft.kind === "기타" && draft.kindCustom.trim() ? `기타(${draft.kindCustom.trim()})` : draft.kind;
      await insertRow("dept_requests", {
        requester, kind, vendor: draft.vendor.trim(),
        content: draft.content.trim(), due_date: draft.due_date || null,
        target_type: draft.target_type, target: draft.target_type === "전체" ? "" : draft.target,
      });
      setDraft({ ...draft, vendor: "", content: "", due_date: "", kindCustom: "" });
      setFormOpen(false);
      await load();
    } catch (e) {
      notify(`등록 실패: ${(e as Error).message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (row: DeptRequest, status: DeptRequest["status"]) => {
    const patch = status === "완료"
      ? { status, handled_by: author || "미지정", handled_at: new Date().toISOString() }
      : { status, handled_by: status === "처리중" ? (author || "미지정") : "", handled_at: null };
    setRows((current) => current.map((r) => r.id === row.id ? { ...r, ...patch } as DeptRequest : r));
    try {
      await updateRows("dept_requests", `id=eq.${row.id}`, patch);
    } catch (e) {
      notify(`상태 변경 실패: ${(e as Error).message}`, "error");
      void load();
    }
  };

  const remove = async (row: DeptRequest) => {
    if (!window.confirm("이 요청을 삭제할까요?")) return;
    try {
      await deleteRows("dept_requests", `id=eq.${row.id}`);
      setRows((current) => current.filter((r) => r.id !== row.id));
    } catch (e) {
      notify(`삭제 실패: ${(e as Error).message}`, "error");
    }
  };

  const targetBadge = (row: DeptRequest) => {
    const type = row.target_type || "전체";
    if (type === "전체") return <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-600">전체</span>;
    if (type === "팀") return <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-black text-violet-600">{row.target}팀</span>;
    return <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700">{row.target}</span>;
  };

  return (
    <div className="space-y-4 pb-16">
      {/* 허브(공지·요청)에 안겨 있으면 다크바는 허브가 담당 — 여기선 필터만 */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {!embedded && <div className="flex flex-wrap items-center gap-2 bg-[#151A23] px-4 py-2.5">
          <span className="flex items-center gap-1.5 rounded-full bg-white/[0.07] px-2.5 py-1 text-[11px] font-bold text-slate-400">
            내 대기 요청 <b className={`tabular-nums ${waiting > 0 ? "text-rose-300" : "text-white"}`}>{waiting}건</b>
          </span>
          {myTeam && <span className="rounded-full bg-white/[0.07] px-2.5 py-1 text-[11px] font-bold text-slate-400">{author} · {myTeam}팀 기준</span>}
        </div>}
        <div className="flex flex-wrap items-center gap-2 p-4">
          <div className="flex rounded-full bg-slate-100 p-1">
            {([["mine", "내 것"], ["all", "모든 요청"]] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setScope(key)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-black transition ${scope === key ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                {label}{key === "all" && hiddenCount > 0 && scope === "mine" ? ` +${hiddenCount}` : ""}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {["전체", ...KINDS].map((name) => <button key={name} type="button" onClick={() => setKindFilter(name)} className={`rounded-full px-3.5 py-1.5 text-xs font-black transition ${kindFilter === name ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>{name}</button>)}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex rounded-full bg-slate-100 p-1">
              {["진행", "완료", "전체"].map((name) => <button key={name} type="button" onClick={() => setStatusFilter(name)} className={`rounded-full px-3 py-1.5 text-xs font-black ${statusFilter === name ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{name}</button>)}
            </div>
            <button type="button" onClick={() => setFormOpen(true)}
              className="rounded-full bg-blue-600 px-4 py-2 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700">+ 요청 등록</button>
          </div>
        </div>
      </section>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div>}
      {loading && <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">불러오는 중…</div>}
      {!loading && !filtered.length && <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm font-bold text-slate-400">{rows.length ? (scope === "mine" && hiddenCount > 0 ? "내게 온 요청이 없어요 — 다른 팀 앞 요청은 \"모든 요청\"에서 볼 수 있어요." : "조건에 맞는 요청이 없어요.") : "아직 요청이 없어요. 타부서에 이 화면을 공유해 주세요."}</div>}

      <div className="grid gap-2 xl:grid-cols-2 2xl:grid-cols-3">
        {filtered.map((row) => (
          <article key={row.id} className={`relative overflow-hidden rounded-xl border border-slate-200 p-4 pl-5 shadow-sm ${row.status === "완료" ? "bg-slate-50/60" : "bg-white"}`}>
            <span className={`absolute inset-y-0 left-0 w-1 ${STATUS_BAR[row.status] || "bg-slate-200"}`} />
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-black ${STATUS_TONE[row.status]}`}>{row.status}</span>
              {targetBadge(row)}
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600">{row.kind}</span>
              {row.vendor && <span className="truncate text-sm font-black text-slate-900">{row.vendor}</span>}
              {row.due_date && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${row.status !== "완료" && row.due_date < new Date().toISOString().slice(0, 10) ? "bg-rose-50 text-rose-600" : "bg-slate-100 text-slate-500"}`}>희망 {row.due_date.slice(5)}</span>}
              <span className="ml-auto shrink-0 text-[11px] font-bold text-slate-400">{row.requester} · {row.created_at.slice(5, 10)}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-700">{row.content}</p>
            {row.status === "완료" && row.handled_by && <div className="mt-1.5 text-[11px] font-bold text-slate-500">✓ {row.handled_by} 처리 · {String(row.handled_at || "").slice(0, 10)}</div>}
            <div className="mt-3 flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              {row.status !== "처리중" && row.status !== "완료" && <button type="button" onClick={() => void setStatus(row, "처리중")} className="rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-black text-slate-600 transition hover:bg-slate-50">처리 시작</button>}
              {row.status !== "완료" && <button type="button" onClick={() => void setStatus(row, "완료")} className="rounded-full bg-blue-600 px-3.5 py-1.5 text-xs font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700">완료 처리</button>}
              {row.status === "완료" && <button type="button" onClick={() => void setStatus(row, "대기")} className="rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-black text-slate-500 transition hover:bg-slate-50">완료 취소</button>}
              <button type="button" onClick={() => void remove(row)} className="ml-auto text-[11px] font-black text-slate-300 transition hover:text-rose-500">삭제</button>
            </div>
          </article>
        ))}
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-[200] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setFormOpen(false)}>
          <div className="w-full rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-md sm:rounded-xl" onMouseDown={(e) => e.stopPropagation()}>
            <b className="text-slate-950">요청 등록</b>
            <div className="mt-4 space-y-3">
              <div className="text-xs font-bold text-slate-500">요청 부서/이름 <b className="text-rose-500">*</b>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <PortalSelect width={200} value={draft.requester.startsWith("__") ? "__custom" : draft.requester} placeholder="명단에서 선택"
                    onChange={(next) => setDraft({ ...draft, requester: next === "__custom" ? "__" : next })}
                    options={[
                      ...COMPANY_MEMBERS.map((member) => ({ value: memberValue(member), label: member.name, group: memberGroup(member), hint: member.title })),
                      { value: "__custom", label: "직접 입력…" },
                    ]} />
                  {draft.requester.startsWith("__") && (
                    <input autoFocus value={draft.requester.slice(2)} onChange={(e) => setDraft({ ...draft, requester: "__" + e.target.value })}
                      placeholder="부서 이름 직접 입력" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                  )}
                </div>
              </div>
              <div className="text-xs font-bold text-slate-500">누구에게 <b className="text-rose-500">*</b>
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
              <div className="text-xs font-bold text-slate-500">유형
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {KINDS.map((name) => <button key={name} type="button" onClick={() => setDraft({ ...draft, kind: name })} className={`rounded-full px-3 py-2 text-xs font-black ${draft.kind === name ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>{name}</button>)}
                  {draft.kind === "기타" && (
                    <input autoFocus value={draft.kindCustom} onChange={(e) => setDraft({ ...draft, kindCustom: e.target.value })}
                      placeholder="어떤 업무인지 입력" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                  )}
                </div>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_140px] gap-2">
                <label className="text-xs font-bold text-slate-500">제목 (선택)
                  <input value={draft.vendor} onChange={(e) => setDraft({ ...draft, vendor: e.target.value })} placeholder="예: ○○업체 카운터" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                </label>
                <label className="text-xs font-bold text-slate-500">희망일 (선택)
                  <input type="date" value={draft.due_date} onChange={(e) => setDraft({ ...draft, due_date: e.target.value })} onClick={(e) => e.currentTarget.showPicker?.()} className="mt-1 w-full cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                </label>
              </div>
              <label className="block text-xs font-bold text-slate-500">요청 내용 <b className="text-rose-500">*</b>
                <textarea value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} rows={3} placeholder="예: OO업체 카운터 확인 부탁드립니다 / OO업체 미수 3개월 체크 요청" className="mt-1 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold leading-6 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setFormOpen(false)} className="rounded-full border border-slate-200 px-4 py-2 text-sm font-bold text-slate-500">취소</button>
              <button type="button" disabled={busy || !draft.content.trim() || !(draft.requester.startsWith("__") ? draft.requester.slice(2).trim() : draft.requester.trim())} onClick={() => void submit()} className="rounded-full bg-blue-600 px-5 py-2 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 disabled:opacity-40">{busy ? "등록 중…" : "등록"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
