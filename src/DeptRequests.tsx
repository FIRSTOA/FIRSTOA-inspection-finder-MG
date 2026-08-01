import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteRows, insertRow, selectRows, updateRows } from "./supabase";
import { AUTHOR_TEAMS, displayTitle, useAuthorBook, useMembers } from "./authors";
import { makeIsForMe, myGroupLabel, teamTargetLabel, teamTargetOptions } from "./audience";
import { pingInbox } from "./useInboxBadge";
import FormModal from "./FormModal";
import { Send, Trash2 } from "lucide-react";
import PortalSelect from "./PortalSelect";
import { notify } from "./toast";

/**
 * 부서 요청 — 부서 사이에 오가는 요청함 (요청자는 로그인 작성자 본인으로 자동 기록).
 *
 * 리스트는 훑는 곳: 상태 카운트 칩(대기/처리중/완료)으로 거르고, 카드는 요약 한 줄.
 * 카드를 누르면 상세 모달 — 전체 내용 + 진행 타임라인(접수→시작→완료) + 처리 버튼.
 * 상태가 움직이면 요청자에게 배지 알림(requester_ack)이 간다.
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
  started_at: string | null;
  started_by: string;
  handled_by: string;
  handled_at: string | null;
  requester_ack: boolean;
  target_type: "전체" | "팀" | "개인";
  target: string;
};

const KINDS = ["카운터확인", "미수체크", "방문요청", "기타"] as const;
const STATUS_TONE: Record<string, string> = {
  대기: "bg-rose-100 text-rose-700", 처리중: "bg-amber-100 text-amber-800", 완료: "bg-slate-100 text-slate-500",
};
const STATUS_BAR: Record<string, string> = { 대기: "bg-rose-500", 처리중: "bg-amber-400", 완료: "bg-slate-200" };
const STATUS_DOT: Record<string, string> = { 대기: "bg-rose-500", 처리중: "bg-amber-400", 완료: "bg-slate-300" };

function stamp(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function DeptRequests({ author, embedded = false }: { author: string; embedded?: boolean }) {
  const { book } = useAuthorBook();
  const members = useMembers();
  const teamOptions = useMemo(() => teamTargetOptions(members), [members]);
  const personOptions = useMemo(() => {
    const active = members.filter((member) => member.active);
    if (active.length) return active.map((member) => ({ value: member.name, label: member.name, group: member.team ? `${member.dept} · ${member.team}` : member.dept, hint: displayTitle(member) }));
    return AUTHOR_TEAMS.flatMap((team) => (book[team] || []).map((name) => ({ value: name, label: name, group: `${team}팀` })));
  }, [members, book]);
  // 요청자 = 로그인 작성자 본인 — 인원 DB에서 부서·호칭을 붙여 기록한다
  const me = useMemo(() => members.find((member) => member.active && member.name === author), [members, author]);
  const requesterValue = me ? [me.dept, me.name, displayTitle(me)].join(" ") : author;
  const [rows, setRows] = useState<DeptRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [kindFilter, setKindFilter] = useState("전체");
  const [statusFilter, setStatusFilter] = useState("전체");
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [detailId, setDetailId] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState({
    kind: "카운터확인" as string, kindCustom: "", vendor: "", content: "", due_date: "",
    target_type: "전체" as DeptRequest["target_type"], target: "",
  });
  const [busy, setBusy] = useState(false);

  const groupLabel = useMemo(() => myGroupLabel(author, members), [author, members]);

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

  const isMine = useMemo(() => makeIsForMe(author, members, book), [author, members, book]);

  // 내가 올린 요청의 상태가 바뀌었는데 아직 못 본 것 — 파란 링으로 강조하고, 이 화면을 본 순간 확인 처리
  const [freshUpdates, setFreshUpdates] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!author || !rows.length) return;
    const mine = rows.filter((row) => !row.requester_ack && (row.requester || "").split(/\s+/).includes(author));
    if (!mine.length) return;
    setFreshUpdates((current) => new Set([...current, ...mine.map((row) => row.id)]));
    void updateRows("dept_requests", `requester_ack=eq.false&requester=ilike.${encodeURIComponent(`*${author}*`)}`, { requester_ack: true }).then(() => pingInbox()).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, author]);

  const visible = useMemo(() => rows.filter((row) => scope === "all" || isMine(row)), [rows, scope, isMine]);
  const waiting = visible.filter((row) => row.status === "대기").length;
  const hiddenCount = rows.length - visible.length;
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { 대기: 0, 처리중: 0, 완료: 0 };
    visible.forEach((row) => { counts[row.status] = (counts[row.status] || 0) + 1; });
    return counts;
  }, [visible]);

  const filtered = useMemo(() => visible.filter((row) => {
    if (kindFilter !== "전체" && !(row.kind === kindFilter || (kindFilter === "기타" && row.kind.startsWith("기타")))) return false;
    if (statusFilter !== "전체" && row.status !== statusFilter) return false;
    return true;
  }), [visible, kindFilter, statusFilter]);

  const submit = async () => {
    if (busy || !draft.content.trim()) return;
    if (!author) { notify("우측 상단에서 작성자(본인)를 먼저 선택하세요.", "error"); return; }
    if (draft.target_type !== "전체" && !draft.target) { notify("대상 팀/직원을 선택하세요.", "error"); return; }
    const requester = requesterValue;
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
      pingInbox();
    } catch (e) {
      notify(`등록 실패: ${(e as Error).message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (row: DeptRequest, status: DeptRequest["status"]) => {
    const now = new Date().toISOString();
    // 상태가 움직이면 요청자에게 알림 (requester_ack=false → 배지·하이라이트)
    const patch = status === "완료"
      ? { status, handled_by: author || "미지정", handled_at: now, started_at: row.started_at || now, started_by: row.started_by || author || "미지정", requester_ack: false }
      : status === "처리중"
      ? { status, handled_by: author || "미지정", handled_at: null, started_at: now, started_by: author || "미지정", requester_ack: false }
      : { status, handled_by: "", handled_at: null, started_at: null, started_by: "", requester_ack: false };
    setRows((current) => current.map((r) => r.id === row.id ? { ...r, ...patch } as DeptRequest : r));
    try {
      await updateRows("dept_requests", `id=eq.${row.id}`, patch);
      pingInbox();
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
      setDetailId(0);
      pingInbox();
    } catch (e) {
      notify(`삭제 실패: ${(e as Error).message}`, "error");
    }
  };

  const targetBadge = (row: DeptRequest) => {
    const type = row.target_type || "전체";
    if (type === "전체") return <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-600">전체</span>;
    if (type === "팀") return <span className="shrink-0 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-black text-violet-600">{teamTargetLabel(row.target)}</span>;
    return <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700">{row.target}</span>;
  };

  const overdue = (row: DeptRequest) => !!row.due_date && row.status !== "완료" && row.due_date < new Date().toISOString().slice(0, 10);
  const detailRow = detailId ? rows.find((row) => row.id === detailId) : undefined;

  return (
    <div className="space-y-4 pb-16">
      {/* 허브(공지·요청)에 안겨 있으면 다크바는 허브가 담당 — 여기선 필터만 */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {!embedded && <div className="flex flex-wrap items-center gap-2 bg-[#151A23] px-4 py-2.5">
          <span className="flex items-center gap-1.5 rounded-full bg-white/[0.07] px-2.5 py-1 text-[11px] font-bold text-slate-400">
            내 대기 요청 <b className={`tabular-nums ${waiting > 0 ? "text-rose-300" : "text-white"}`}>{waiting}건</b>
          </span>
          {author && <span className="rounded-full bg-white/[0.07] px-2.5 py-1 text-[11px] font-bold text-slate-400">{author}{groupLabel ? ` · ${groupLabel}` : ""} 기준</span>}
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
          {/* 상태 카운트 칩 — "지금 몇 건이 밀려 있나"가 필터를 겸한다 */}
          <div className="flex flex-wrap gap-1">
            {["전체", "대기", "처리중", "완료"].map((name) => (
              <button key={name} type="button" onClick={() => setStatusFilter(name)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-black transition ${statusFilter === name ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
                {name !== "전체" && <span className={`h-2 w-2 rounded-full ${STATUS_DOT[name]}`} />}
                {name}
                {name !== "전체" && <span className={`tabular-nums ${statusFilter === name ? "text-slate-300" : "text-slate-400"}`}>{statusCounts[name] || 0}</span>}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <PortalSelect width={130} value={kindFilter} onChange={setKindFilter}
              options={["전체", ...KINDS].map((name) => ({ value: name, label: name === "전체" ? "유형 전체" : name }))} />
            <button type="button" onClick={() => setFormOpen(true)}
              className="rounded-full bg-blue-600 px-4 py-2 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700">+ 요청 등록</button>
          </div>
        </div>
      </section>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div>}
      {loading && <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">불러오는 중…</div>}
      {!loading && !filtered.length && <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm font-bold text-slate-400">{rows.length ? (scope === "mine" && hiddenCount > 0 ? "내게 온 요청이 없어요 — 다른 팀 앞 요청은 \"모든 요청\"에서 볼 수 있어요." : "조건에 맞는 요청이 없어요.") : "아직 요청이 없어요. 타부서에 이 화면을 공유해 주세요."}</div>}

      {/* 슬림 카드 — 요약만. 누르면 상세 모달 */}
      <div className="grid gap-2 xl:grid-cols-2 2xl:grid-cols-3">
        {filtered.map((row) => (
          <button key={row.id} type="button" onClick={() => setDetailId(row.id)}
            className={`relative overflow-hidden rounded-xl border p-3.5 pl-5 text-left shadow-sm transition hover:border-slate-300 hover:shadow ${freshUpdates.has(row.id) ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200"} ${row.status === "완료" ? "bg-slate-50/60" : "bg-white"}`}>
            <span className={`absolute inset-y-0 left-0 w-1 ${STATUS_BAR[row.status] || "bg-slate-200"}`} />
            <span className="flex items-center gap-1.5">
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-black ${STATUS_TONE[row.status]}`}>{row.status}</span>
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{row.kind}</span>
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-black text-slate-900">{row.vendor || row.content.split("\n")[0]}</span>
              {overdue(row) && <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-black tabular-nums text-rose-600">희망 {row.due_date?.slice(5)}</span>}
            </span>
            <span className="mt-1.5 flex items-center gap-1.5">
              {targetBadge(row)}
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-400">{row.vendor ? row.content.split("\n")[0] : ""}</span>
              <span className="shrink-0 text-[11px] font-bold tabular-nums text-slate-400">{row.requester.split(/\s+/)[1] || row.requester} · {row.created_at.slice(5, 10)}</span>
            </span>
          </button>
        ))}
      </div>

      {/* ── 상세 모달 — 내용 · 진행 타임라인 · 처리 버튼 ── */}
      {detailRow && (() => {
        const steps = [
          { label: "요청 접수", at: detailRow.created_at, by: detailRow.requester, dot: "border-blue-500 bg-blue-500", done: true },
          { label: "처리 시작", at: detailRow.started_at, by: detailRow.started_by, dot: "border-amber-400 bg-amber-400", done: !!detailRow.started_at },
          { label: "완료", at: detailRow.status === "완료" ? detailRow.handled_at : null, by: detailRow.status === "완료" ? detailRow.handled_by : "", dot: "border-emerald-500 bg-emerald-500", done: detailRow.status === "완료" },
        ];
        return (
          <FormModal icon={<Send size={17} />} onClose={() => setDetailId(0)}
            title={
              <span className="flex flex-col gap-1.5">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-black ${STATUS_TONE[detailRow.status]}`}>{detailRow.status}</span>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-black text-slate-300">{detailRow.kind}</span>
                  {targetBadge(detailRow)}
                  {detailRow.due_date && <span className={`rounded-full px-2 py-0.5 text-[10px] font-black tabular-nums ${overdue(detailRow) ? "bg-rose-50 text-rose-600" : "bg-white/10 text-slate-300"}`}>희망 {detailRow.due_date.slice(5)}</span>}
                </span>
                <span className="text-base leading-snug">{detailRow.vendor || detailRow.kind}</span>
              </span>
            }
            subtitle={`${detailRow.requester} · ${stamp(detailRow.created_at)} 접수`}
            footer={<>
              <button type="button" onClick={() => void remove(detailRow)}
                className="mr-auto inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-black text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"><Trash2 size={13} />삭제</button>
              {detailRow.status === "대기" && (
                <button type="button" onClick={() => void setStatus(detailRow, "처리중")}
                  className="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-black text-slate-600 transition hover:bg-slate-50">처리 시작</button>
              )}
              {detailRow.status !== "완료" ? (
                <button type="button" onClick={() => void setStatus(detailRow, "완료")}
                  className="rounded-full bg-blue-600 px-5 py-2 text-xs font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700">완료 처리</button>
              ) : (<>
                <button type="button" onClick={() => void setStatus(detailRow, "대기")}
                  className="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-black text-slate-500 transition hover:bg-slate-50">완료 취소</button>
                <button type="button" onClick={() => setDetailId(0)}
                  className="rounded-full bg-slate-900 px-6 py-2 text-xs font-black text-white transition hover:bg-slate-800">확인</button>
              </>)}
            </>}>
            <p className="whitespace-pre-wrap rounded-xl bg-slate-50 px-4 py-3.5 text-sm font-semibold leading-7 text-slate-700">{detailRow.content}</p>
            <div>
              <div className="mb-2 text-[11px] font-black tracking-wide text-slate-500">진행 상황</div>
              <div className="rounded-xl border border-slate-100 px-4 py-3.5">
                {steps.map((step, index) => (
                  <div key={step.label} className="relative flex gap-3 pb-3.5 last:pb-0">
                    {index < steps.length - 1 && <span className={`absolute bottom-0 left-[5px] top-4 w-px ${steps[index + 1].done ? "bg-slate-300" : "bg-slate-100"}`} />}
                    <span className={`mt-0.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 ${step.done ? step.dot : "border-slate-200 bg-white"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className={`text-xs font-black ${step.done ? "text-slate-800" : "text-slate-300"}`}>{step.label}</span>
                        {step.done && <span className="text-[11px] font-bold tabular-nums text-slate-400">{stamp(step.at)}</span>}
                        {!step.done && <span className="text-[10px] font-bold text-slate-300">아직</span>}
                      </div>
                      {step.done && step.by && <div className="truncate text-[11px] font-semibold text-slate-400">{step.by}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </FormModal>
        );
      })()}

      {formOpen && (
        <FormModal title="새 요청" subtitle={author ? `${requesterValue} 이름으로 접수됩니다 — 처리 상황이 알림으로 돌아와요` : "우측 상단에서 작성자를 먼저 선택하세요"} icon={<Send size={17} />} onClose={() => setFormOpen(false)}
          footer={<>
            <button type="button" onClick={() => setFormOpen(false)} className="rounded-full px-4 py-2.5 text-sm font-bold text-slate-500 transition hover:bg-slate-100">취소</button>
            <button type="button" disabled={busy || !draft.content.trim() || !author} onClick={() => void submit()}
              className="rounded-full bg-blue-600 px-6 py-2.5 text-sm font-black text-white shadow-[0_4px_14px_rgba(37,99,235,0.35)] transition hover:bg-blue-700 disabled:opacity-40 disabled:shadow-none">{busy ? "보내는 중…" : "요청 보내기"}</button>
          </>}>
          <div className="space-y-4">
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
                    <PortalSelect width={185} value={draft.target} onChange={(next) => setDraft({ ...draft, target: next })} placeholder="부서·팀 선택"
                      options={teamOptions} />
                  )}
                  {draft.target_type === "개인" && (
                    <PortalSelect width={185} value={draft.target} onChange={(next) => setDraft({ ...draft, target: next })} placeholder="직원 선택"
                      options={personOptions} />
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
        </FormModal>
      )}
    </div>
  );
}
