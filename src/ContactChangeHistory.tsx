import { useEffect, useMemo, useState } from "react";
import { askConfirm } from "./confirmModal";
import { deleteRows, selectAllRows, selectRows, updateRows } from "./supabase";
import { vendorMatchKey } from "./ids";
import { notify } from "./toast";
import { maybePullContactSheet, pullContactSheet } from "./keyman";

type ContactChangeRow = {
  id: string;
  created_at: string;
  change_date: string;
  author: string;
  company: string;
  region: string;
  category: string;
  reason: string;
  grade: string;
  before_text: string;
  after_text: string;
  notes: string;
  source_text: string;
  photo_link: string;
  greeting_done: boolean;
  greeting_by: string;
  greeting_at: string | null;
  greeting_memo: string;
};

/** 키맨(사람) 변경인가 — 주소·전화만 바뀐 건은 인사 대상이 아니다 */
const isKeymanChange = (row: ContactChangeRow) =>
  /키맨|담당|대표|소장|점장|팀장|과장|부장|실장|사장|인사/.test(`${row.category} ${row.reason}`) && !/주소/.test(row.category);
/** 변경 후 며칠 지났나 */
const daysSince = (value: string) => {
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.floor((Date.now() - t) / 86400000);
};

const REGIONS = ["전체", "A", "B", "C", "D"];

function dateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "-";
  return date.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export default function ContactChangeHistory() {
  const [rows, setRows] = useState<ContactChangeRow[]>([]);
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("전체");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [applyBusyId, setApplyBusyId] = useState("");
  const [deleteBusyId, setDeleteBusyId] = useState("");
  const [greetBusyId, setGreetBusyId] = useState("");
  const [pullBusy, setPullBusy] = useState(false);

  const reload = () => selectRows<ContactChangeRow>("contact_changes", "select=*&order=change_date.desc,created_at.desc&limit=500")
    .then(setRows).catch((e) => setError((e as Error).message));

  // 시트가 최종 저장소다 — 카톡봇·Make로 시트에만 들어온 변경까지 보이게 가져온다
  const pullFromSheet = async () => {
    if (pullBusy) return;
    setPullBusy(true);
    try {
      const result = await pullContactSheet(400);
      await reload();
      notify(result.inserted
        ? `시트에서 ${result.inserted}건 새로 가져왔습니다 (읽은 줄 ${result.read})`
        : `새로 가져올 건이 없습니다 (읽은 줄 ${result.read})`, "success");
    } catch (e) { notify(`가져오기 실패: ${(e as Error).message}`, "error"); }
    finally { setPullBusy(false); }
  };
  const [onlyTodo, setOnlyTodo] = useState(false); // 인사 안 한 키맨 변경만 보기

  // 키맨이 바뀌면 초반에 인사를 드려야 나중 재계약·친밀도가 다르다(대표님 취지) — 인사 여부를 여기서 체크한다.
  const toggleGreeting = async (row: ContactChangeRow) => {
    if (greetBusyId) return;
    const next = !row.greeting_done;
    const who = (typeof window !== "undefined" && window.localStorage.getItem("firstoa.author")) || "";
    setGreetBusyId(row.id);
    try {
      const patch = next
        ? { greeting_done: true, greeting_by: who || "미지정", greeting_at: new Date().toISOString() }
        : { greeting_done: false, greeting_by: "", greeting_at: null };
      await updateRows("contact_changes", `id=eq.${row.id}`, patch);
      setRows((cur) => cur.map((r) => (r.id === row.id ? { ...r, ...patch } as ContactChangeRow : r)));
      notify(next ? "인사 완료로 표시했습니다" : "인사 표시를 해제했습니다", "success");
    } catch (e) { notify(`저장 실패: ${(e as Error).message}`, "error"); }
    finally { setGreetBusyId(""); }
  };

  const removeRow = async (row: ContactChangeRow) => {
    if (!await askConfirm(`이 변경이력을 삭제할까요?\n\n${row.company || "업체명 미기재"} · ${dateLabel(row.change_date || row.created_at)}`)) return;
    setDeleteBusyId(row.id);
    try {
      await deleteRows("contact_changes", `id=eq.${row.id}`);
      setRows((current) => current.filter((item) => item.id !== row.id));
    } catch (e) {
      setError((e as Error).message || "삭제하지 못했습니다.");
    } finally {
      setDeleteBusyId("");
    }
  };

  // 변경 후 정보를 워킨맵(앱이 원본인 DB)에 반영한다.
  // 임대리스트(vendor_info)는 구글시트가 원본이라 여기서 바꾸면 다음 동기화 때 덮이므로 반영하지 않는다.
  const applyToWorkinMap = async (row: ContactChangeRow) => {
    if (applyBusyId) return;
    const after = String(row.after_text || "").trim();
    if (!after) { notify("변경 후 내용이 비어 있어 반영할 수 없습니다.", "error"); return; }
    const key = vendorMatchKey(row.company);
    if (!key) { notify("업체명으로 워킨맵을 매칭할 수 없습니다.", "error"); return; }
    setApplyBusyId(row.id);
    try {
      const places = await selectAllRows<{ id: number; name: string; memos: string[] | null }>("workin_map_places", "select=id,name,memos");
      const matches = places.filter((place) => {
        const placeKey = vendorMatchKey(place.name || "");
        return placeKey && (placeKey === key || (placeKey.length >= 5 && key.length >= 5 && (placeKey.includes(key) || key.includes(placeKey))));
      });
      if (!matches.length) { notify("워킨맵에서 일치하는 거래처를 찾지 못했습니다.", "error"); return; }
      const isAddress = /주소/.test(row.category);
      const fieldLabel = isAddress ? "주소" : "연락처";
      const names = matches.slice(0, 5).map((m) => m.name).join("\n");
      if (!await askConfirm(`워킨맵 ${matches.length}곳의 ${fieldLabel}를 아래 내용으로 바꿉니다.

${names}${matches.length > 5 ? `
외 ${matches.length - 5}곳` : ""}

변경 후: ${after}
계속할까요?`)) return;
      for (const match of matches) {
        const memos = Array.isArray(match.memos) ? match.memos.map(String) : [];
        memos.push(`[변경반영] ${new Date().toISOString().slice(0, 10)} ${row.category || "변경"} → ${after}`.slice(0, 300));
        await updateRows("workin_map_places", `id=eq.${match.id}`, isAddress ? { address: after, address_detail: "", memos } : { phone: after, memos });
      }
      notify(`워킨맵 ${matches.length}곳에 반영했습니다.`, "success");
    } catch (e) {
      notify(`반영 실패: ${(e as Error).message}`, "error");
    } finally {
      setApplyBusyId("");
    }
  };

  useEffect(() => {
    // 화면을 열 때 시트 최신분을 조용히 가져온다(브라우저당 1시간 1회)
    void maybePullContactSheet().then((result) => { if (result?.inserted) void reload(); }).catch(() => undefined);
  }, []);

  useEffect(() => {
    let mounted = true;
    selectRows<ContactChangeRow>("contact_changes", "select=*&order=change_date.desc,created_at.desc&limit=500")
      .then((result) => { if (mounted) setRows(result); })
      .catch((reason) => { if (mounted) setError((reason as Error).message); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  // 최근 30일 안에 키맨이 바뀌었는데 아직 인사하지 않은 건 — 그 전 건은 이미 인사했다고 본다(2026-08-28 결정)
  const keymanTodo = useMemo(
    () => rows.filter((r) => isKeymanChange(r) && !r.greeting_done && daysSince(r.change_date || r.created_at) <= 30).length,
    [rows],
  );

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (region !== "전체" && row.region.trim().toUpperCase() !== region) return false;
      if (onlyTodo && !(isKeymanChange(row) && !row.greeting_done)) return false;
      if (!keyword) return true;
      return [row.company, row.author, row.category, row.reason, row.before_text, row.after_text, row.notes]
        .join(" ").toLowerCase().includes(keyword);
    });
  }, [rows, query, region, onlyTodo]);

  return (
    <div className="space-y-3 pb-12">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <p className="text-xs font-semibold text-slate-500">FIELD에서 전송한 변경 요청을 업체·지역별로 확인하고, 워킨맵에 반영합니다.</p>
          <div className="flex items-center gap-2">
            {keymanTodo > 0 && (
              <button type="button" onClick={() => setOnlyTodo((v) => !v)}
                className={`rounded-full px-3 py-1.5 text-xs font-black transition ${onlyTodo ? "bg-amber-500 text-white" : "bg-amber-100 text-amber-800 hover:bg-amber-200"}`}>
                🤝 인사 대기 {keymanTodo}건{onlyTodo ? " · 전체 보기" : ""}
              </button>
            )}
            <button type="button" disabled={pullBusy} onClick={() => void pullFromSheet()} title="담당자변경(키맨체크) 시트에서 최신 변경을 가져옵니다"
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-50">
              {pullBusy ? "가져오는 중…" : "⭳ 시트에서 가져오기"}
            </button>
            <div className="text-sm font-black text-slate-700">{filtered.length}건</div>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="업체명 · 담당자 · 변경 내용 검색" className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
          <div className="flex rounded-full bg-slate-100 p-1">
            {REGIONS.map((value) => <button key={value} type="button" onClick={() => setRegion(value)} className={`rounded-full px-3 py-1.5 text-xs font-black ${region === value ? "bg-slate-900 text-white" : "text-slate-500"}`}>{value === "전체" ? "전체" : `${value}팀`}</button>)}
          </div>
        </div>
      </section>

      {loading && <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm font-semibold text-slate-400">변경 기록을 불러오는 중입니다.</div>}
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">기록을 불러오지 못했습니다. Supabase SQL Editor에서 `contact-changes.sql`을 실행해 주세요.<br /><span className="text-xs">{error}</span></div>}
      {!loading && !error && <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {!filtered.length ? <div className="p-12 text-center text-sm font-semibold text-slate-400">아직 저장된 변경 기록이 없습니다.</div> : <div className="divide-y divide-slate-100">
          {filtered.map((row) => <details key={row.id} className="group">
            <summary className="grid cursor-pointer list-none grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 hover:bg-slate-50">
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-600">{row.region || "-"}</span>
              <span className="min-w-0"><b className="block truncate text-sm text-slate-900">{row.company || "업체명 미기재"}</b><span className="block truncate text-xs font-semibold text-slate-500">{row.category || "변경"} · {row.reason || "사유 미기재"}</span></span>
              <span className="text-right text-[11px] font-semibold text-slate-400">
                {isKeymanChange(row) && daysSince(row.change_date || row.created_at) <= 30 && (
                  row.greeting_done
                    ? <span className="mb-0.5 block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700">🤝 인사 완료</span>
                    : <span className="mb-0.5 block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-800">🤝 인사 필요 D+{daysSince(row.change_date || row.created_at)}</span>
                )}
                {dateLabel(row.change_date || row.created_at)}<br />{row.author || "-"}
              </span>
            </summary>
            <div className="grid gap-3 border-t border-slate-100 bg-slate-50 p-4 md:grid-cols-2">
              <div><div className="text-[11px] font-black text-slate-400">변경 전</div><div className="mt-1 whitespace-pre-wrap text-sm font-semibold text-slate-700">{row.before_text || "-"}</div></div>
              <div><div className="text-[11px] font-black text-slate-400">변경 후</div><div className="mt-1 whitespace-pre-wrap text-sm font-semibold text-slate-900">{row.after_text || "-"}</div></div>
              {row.notes && <div className="md:col-span-2"><div className="text-[11px] font-black text-slate-400">특이사항</div><div className="mt-1 whitespace-pre-wrap text-sm font-semibold text-slate-700">{row.notes}</div></div>}
              <div className="flex flex-wrap items-center gap-2 md:col-span-2">
                <span className="rounded bg-white px-2 py-1 text-xs font-bold text-slate-600">등급 {row.grade || "-"}</span>
                {row.photo_link && <a href={row.photo_link} target="_blank" rel="noreferrer" className="rounded-full border border-blue-200 bg-white px-3.5 py-1.5 text-xs font-black text-blue-700 transition hover:bg-blue-50">첨부 사진 보기</a>}
                {isKeymanChange(row) && (
                  <button type="button" disabled={greetBusyId === row.id} onClick={() => void toggleGreeting(row)}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-black transition ${row.greeting_done ? "bg-emerald-600 text-white" : "border border-amber-300 bg-white text-amber-700 hover:bg-amber-50"}`}>
                    {row.greeting_done ? `🤝 인사 완료 (${row.greeting_by || "-"}${row.greeting_at ? ` · ${dateLabel(row.greeting_at)}` : ""}) — 해제` : "🤝 인사 완료로 표시"}
                  </button>
                )}
                <button type="button" disabled={applyBusyId === row.id} onClick={() => void applyToWorkinMap(row)} className="rounded-full border border-emerald-200 bg-emerald-50 px-3.5 py-1.5 text-xs font-black text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50">{applyBusyId === row.id ? "반영 중…" : "워킨맵 반영"}</button>
                <span className="text-[10px] font-semibold text-slate-400">임대리스트는 시트가 원본이라 시트에서 수정해야 합니다</span>
                <button type="button" disabled={deleteBusyId === row.id} onClick={() => void removeRow(row)} className="ml-auto rounded-full px-2.5 py-1.5 text-[11px] font-black text-slate-300 transition hover:bg-rose-50 hover:text-rose-500 disabled:opacity-40">{deleteBusyId === row.id ? "삭제 중…" : "이력 삭제"}</button>
              </div>
            </div>
          </details>)}
        </div>}
      </section>}
    </div>
  );
}
