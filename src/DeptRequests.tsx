/**
 * 부서 요청 — 타부서(관리부·영업부 등)가 CS팀에 남기는 요청함.
 * 카운터확인·미수체크·방문요청을 리스트로 받고, 미수 현황 탭에서 미수 시트를 보기 좋게 조회한다.
 * (supabase/dept-requests.sql)
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteRows, insertRow, selectAllRows, selectRows, updateRows } from "./supabase";

type DeptRequest = {
  id: string; created_at: string; requester: string; kind: string; vendor: string;
  content: string; due_date: string | null; status: "대기" | "처리중" | "완료";
  handled_by: string; handled_at: string | null; memo: string;
};

const KINDS = ["카운터확인", "미수체크", "방문요청", "기타"] as const;
const KIND_TONE: Record<string, string> = {
  카운터확인: "bg-blue-50 text-blue-700", 미수체크: "bg-amber-50 text-amber-700",
  방문요청: "bg-emerald-50 text-emerald-700", 기타: "bg-slate-100 text-slate-600",
};
const STATUS_TONE: Record<string, string> = {
  대기: "bg-rose-50 text-rose-600", 처리중: "bg-amber-50 text-amber-700", 완료: "bg-emerald-50 text-emerald-700",
};

type MisuRow = { vendor: string; months: string; balance: number; date: string; region: string };

function MisuBoard() {
  const [rows, setRows] = useState<MisuRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [region, setRegion] = useState("전체");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    const select = encodeURIComponent("_업체명,미수개월,미수잔액,입력일,지역");
    const fallback = encodeURIComponent("_업체명,미수개월,미수잔액,입력일");
    const sourceCol = encodeURIComponent("_출처");
    const fetchRows = (cols: string) => selectAllRows<Record<string, unknown>>("misu", `select=${cols}&${sourceCol}=like.${encodeURIComponent("시트")}*&order=id.asc`);
    fetchRows(select).catch(() => fetchRows(fallback))
      .then((data) => {
        if (!active) return;
        // 업체별 최신 1건, 잔액 있는 건만 (워킨맵 미수 배지와 같은 기준)
        const map = new Map<string, MisuRow>();
        for (const row of data) {
          const vendor = String(row["_업체명"] || "").trim();
          if (!vendor) continue;
          const balance = Number(String(row["미수잔액"] || "").replace(/[^\d]/g, "")) || 0;
          const match = String(row["입력일"] || "").match(/(\d{4})[.\-/]\s*(\d{1,2})(?:[.\-/]\s*(\d{1,2}))?/);
          const date = match ? `${match[1]}-${match[2].padStart(2, "0")}-${(match[3] || "1").padStart(2, "0")}` : "";
          const prev = map.get(vendor);
          if (!prev || date > prev.date) map.set(vendor, { vendor, months: String(row["미수개월"] || "").replace(/개월/g, "").trim(), balance, date, region: String(row["지역"] || "").trim() });
        }
        setRows(Array.from(map.values()).filter((r) => r.balance > 0).sort((a, b) => b.balance - a.balance));
      })
      .catch((e) => { if (active) setError((e as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const regions = useMemo(() => ["전체", ...Array.from(new Set(rows.map((r) => r.region).filter(Boolean))).sort()], [rows]);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return rows.filter((r) => (region === "전체" || r.region === region) && (!keyword || r.vendor.toLowerCase().includes(keyword)));
  }, [rows, region, query]);
  const totalBalance = filtered.reduce((sum, r) => sum + r.balance, 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {([
          [`${filtered.length}곳`, "미수 업체"],
          [`₩${totalBalance.toLocaleString()}`, "미수 잔액 합계"],
          [`${filtered.filter((r) => Number(r.months) >= 3).length}곳`, "3개월 이상"],
        ] as [string, string][]).map(([value, label]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-center shadow-sm">
            <div className="truncate text-lg font-black text-slate-950">{value}</div>
            <div className="mt-0.5 text-[10px] font-bold text-slate-400">{label}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="업체명 검색" className="h-9 min-w-0 flex-1 rounded-md border border-slate-300 px-3 text-sm font-semibold" />
        <div className="flex flex-wrap gap-1">
          {regions.map((name) => <button key={name} type="button" onClick={() => setRegion(name)} className={`rounded-md px-2.5 py-1.5 text-xs font-black ${region === name ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>{name}</button>)}
        </div>
      </div>
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div>}
      {loading && <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">불러오는 중…</div>}
      {!loading && <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-[minmax(0,1fr)_60px_110px_80px] gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-[11px] font-black text-slate-500 sm:grid-cols-[minmax(0,1fr)_80px_80px_130px_90px]">
          <span>업체명</span><span className="hidden sm:block">지역</span><span className="text-right">개월</span><span className="text-right">잔액</span><span className="text-right">입력일</span>
        </div>
        <div className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
          {filtered.map((r) => (
            <div key={r.vendor} className="grid grid-cols-[minmax(0,1fr)_60px_110px_80px] items-center gap-2 px-4 py-2.5 text-xs sm:grid-cols-[minmax(0,1fr)_80px_80px_130px_90px]">
              <span className="truncate font-black text-slate-800">{r.vendor}</span>
              <span className="hidden font-bold text-slate-500 sm:block">{r.region || "-"}</span>
              <span className={`text-right font-black ${Number(r.months) >= 3 ? "text-rose-600" : "text-slate-600"}`}>{r.months || "-"}개월</span>
              <span className="text-right font-black text-slate-800">₩{r.balance.toLocaleString()}</span>
              <span className="text-right font-bold text-slate-400">{r.date.slice(2) || "-"}</span>
            </div>
          ))}
          {!filtered.length && <div className="p-10 text-center text-sm font-bold text-slate-400">조건에 맞는 미수 업체가 없어요.</div>}
        </div>
      </section>}
    </div>
  );
}

export default function DeptRequests({ author }: { author: string }) {
  const [tab, setTab] = useState<"requests" | "misu">("requests");
  const [rows, setRows] = useState<DeptRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [kindFilter, setKindFilter] = useState("전체");
  const [statusFilter, setStatusFilter] = useState("진행");
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState({ requester: "", kind: "카운터확인" as string, vendor: "", content: "", due_date: "" });
  const [busy, setBusy] = useState(false);

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

  const waiting = rows.filter((r) => r.status === "대기").length;
  const filtered = useMemo(() => rows.filter((r) => {
    if (kindFilter !== "전체" && r.kind !== kindFilter) return false;
    if (statusFilter === "진행") return r.status !== "완료";
    if (statusFilter !== "전체" && r.status !== statusFilter) return false;
    return true;
  }), [rows, kindFilter, statusFilter]);

  const submit = async () => {
    if (busy || !draft.content.trim() || !draft.requester.trim()) return;
    setBusy(true);
    try {
      await insertRow("dept_requests", { requester: draft.requester.trim(), kind: draft.kind, vendor: draft.vendor.trim(), content: draft.content.trim(), due_date: draft.due_date || null });
      setDraft({ ...draft, vendor: "", content: "", due_date: "" });
      setFormOpen(false);
      await load();
    } catch (e) {
      window.alert(`등록 실패: ${(e as Error).message}`);
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
      window.alert(`상태 변경 실패: ${(e as Error).message}`);
      void load();
    }
  };

  const remove = async (row: DeptRequest) => {
    if (!window.confirm("이 요청을 삭제할까요?")) return;
    try {
      await deleteRows("dept_requests", `id=eq.${row.id}`);
      setRows((current) => current.filter((r) => r.id !== row.id));
    } catch (e) {
      window.alert(`삭제 실패: ${(e as Error).message}`);
    }
  };

  return (
    <div className="space-y-4 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex w-fit gap-1 rounded-md bg-slate-100 p-1">
          <button type="button" onClick={() => setTab("requests")} className={`rounded px-4 py-2 text-sm font-black ${tab === "requests" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>
            📥 요청 목록 {waiting > 0 && <span className="ml-1 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-black text-white">{waiting}</span>}
          </button>
          <button type="button" onClick={() => setTab("misu")} className={`rounded px-4 py-2 text-sm font-black ${tab === "misu" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>💰 미수 현황</button>
        </div>
        {tab === "requests" && <button type="button" onClick={() => setFormOpen(true)} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-black text-white">+ 요청 등록</button>}
      </div>

      {tab === "misu" && <MisuBoard />}

      {tab === "requests" && <>
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold text-slate-500">타부서의 카운터확인·미수체크·방문 요청을 받아 처리합니다. 처리하면 담당자와 시각이 남습니다.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1">
              {["전체", ...KINDS].map((name) => <button key={name} type="button" onClick={() => setKindFilter(name)} className={`rounded-md px-2.5 py-1.5 text-xs font-black ${kindFilter === name ? "bg-slate-900 text-white" : KIND_TONE[name] || "bg-slate-100 text-slate-500"}`}>{name}</button>)}
            </div>
            <div className="ml-auto flex rounded-md bg-slate-100 p-1">
              {["진행", "완료", "전체"].map((name) => <button key={name} type="button" onClick={() => setStatusFilter(name)} className={`rounded px-3 py-1.5 text-xs font-black ${statusFilter === name ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{name}</button>)}
            </div>
          </div>
        </section>

        {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div>}
        {loading && <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">불러오는 중…</div>}
        {!loading && !filtered.length && <div className="rounded-lg border border-slate-200 bg-white p-12 text-center text-sm font-bold text-slate-400">{rows.length ? "조건에 맞는 요청이 없어요." : "아직 요청이 없어요. 타부서에 이 화면을 공유해 주세요."}</div>}

        <div className="space-y-2">
          {filtered.map((row) => (
            <article key={row.id} className={`rounded-lg border p-4 shadow-sm ${row.status === "대기" ? "border-rose-200 bg-white" : row.status === "처리중" ? "border-amber-200 bg-amber-50/30" : "border-slate-200 bg-slate-50/50"}`}>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`rounded px-2 py-0.5 text-[10px] font-black ${KIND_TONE[row.kind] || "bg-slate-100 text-slate-600"}`}>{row.kind}</span>
                <span className={`rounded px-2 py-0.5 text-[10px] font-black ${STATUS_TONE[row.status]}`}>{row.status}</span>
                {row.vendor && <span className="text-sm font-black text-slate-900">{row.vendor}</span>}
                {row.due_date && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-black text-blue-600">희망 {row.due_date}</span>}
                <span className="ml-auto text-[11px] font-bold text-slate-400">{row.requester} · {row.created_at.slice(5, 10)}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-slate-700">{row.content}</p>
              {row.status === "완료" && row.handled_by && <div className="mt-1.5 text-[11px] font-bold text-emerald-600">✓ {row.handled_by} 처리 · {String(row.handled_at || "").slice(0, 10)}</div>}
              <div className="mt-2.5 flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
                {row.status !== "처리중" && row.status !== "완료" && <button type="button" onClick={() => void setStatus(row, "처리중")} className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-black text-amber-700">처리 시작</button>}
                {row.status !== "완료" && <button type="button" onClick={() => void setStatus(row, "완료")} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-black text-white">완료</button>}
                {row.status === "완료" && <button type="button" onClick={() => void setStatus(row, "대기")} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-black text-slate-500">완료 취소</button>}
                <button type="button" onClick={() => void remove(row)} className="ml-auto text-[11px] font-black text-slate-300 hover:text-rose-500">삭제</button>
              </div>
            </article>
          ))}
        </div>
      </>}

      {formOpen && (
        <div className="fixed inset-0 z-[200] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setFormOpen(false)}>
          <div className="w-full rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-md sm:rounded-lg" onMouseDown={(e) => e.stopPropagation()}>
            <b className="text-slate-950">요청 등록</b>
            <div className="mt-4 space-y-3">
              <label className="block text-xs font-bold text-slate-500">요청 부서/이름 <b className="text-rose-500">*</b>
                <input value={draft.requester} onChange={(e) => setDraft({ ...draft, requester: e.target.value })} placeholder="예: 관리부 김OO" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold" />
              </label>
              <div className="text-xs font-bold text-slate-500">유형
                <div className="mt-1 flex flex-wrap gap-1">
                  {KINDS.map((name) => <button key={name} type="button" onClick={() => setDraft({ ...draft, kind: name })} className={`rounded-md px-3 py-2 text-xs font-black ${draft.kind === name ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>{name}</button>)}
                </div>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_140px] gap-2">
                <label className="text-xs font-bold text-slate-500">업체명 (선택)
                  <input value={draft.vendor} onChange={(e) => setDraft({ ...draft, vendor: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold" />
                </label>
                <label className="text-xs font-bold text-slate-500">희망일 (선택)
                  <input type="date" value={draft.due_date} onChange={(e) => setDraft({ ...draft, due_date: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold" />
                </label>
              </div>
              <label className="block text-xs font-bold text-slate-500">요청 내용 <b className="text-rose-500">*</b>
                <textarea value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} rows={3} placeholder="예: OO업체 카운터 확인 부탁드립니다 / OO업체 미수 3개월 체크 요청" className="mt-1 w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold leading-6" />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setFormOpen(false)} className="rounded-md border border-slate-200 px-4 py-2 text-sm font-bold text-slate-500">취소</button>
              <button type="button" disabled={busy || !draft.content.trim() || !draft.requester.trim()} onClick={() => void submit()} className="rounded-md bg-slate-900 px-5 py-2 text-sm font-black text-white disabled:opacity-40">{busy ? "등록 중…" : "등록"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
