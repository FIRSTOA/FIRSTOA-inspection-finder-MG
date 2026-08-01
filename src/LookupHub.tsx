import { useEffect, useState } from "react";
import { SUPABASE_ANON, SUPABASE_URL } from "./supabase";
import { kstDate } from "./visits";
import DataLookup from "./DataLookup";
import OperationsDashboard from "./OperationsDashboard";

/**
 * 조회 허브 — 관리 허브와 같은 [다크 상태줄 + 밑줄 탭] 구조.
 * 상태줄에는 "오늘 들어온 기록"을 띄운다: 조회에 들어온 사람이 가장 먼저 궁금한 숫자.
 */
type Tab = "records" | "status";

const TODAY_CHIPS: Array<{ label: string; table: string; dateField: string; extra?: string }> = [
  { label: "점검", table: "jeomgeom", dateField: "작성일" },
  { label: "AS", table: "as_records", dateField: "작성일" },
  { label: "접수", table: "service_receptions", dateField: "receipt_date", extra: "deleted=is.false" },
  { label: "미수", table: "misu", dateField: "입력일" },
];

async function todayCount(table: string, dateField: string, extra?: string): Promise<number | null> {
  const parts = [`select=id`, `${encodeURIComponent(dateField)}=eq.${kstDate()}`, "limit=1"];
  if (extra) parts.push(extra);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${parts.join("&")}`, {
    method: "HEAD",
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, Prefer: "count=exact" },
  });
  const total = Number((res.headers.get("content-range") || "").split("/")[1]);
  return Number.isFinite(total) ? total : null;
}

export default function LookupHub({ author }: { author: string }) {
  const [tab, setTab] = useState<Tab>(() => {
    const saved = window.localStorage.getItem("cs_lookup_tab_v1") as Tab;
    return saved === "status" ? "status" : "records";
  });
  const [counts, setCounts] = useState<Record<string, number | null>>({});

  useEffect(() => { window.localStorage.setItem("cs_lookup_tab_v1", tab); }, [tab]);

  useEffect(() => {
    let alive = true;
    TODAY_CHIPS.forEach((chip) => {
      void todayCount(chip.table, chip.dateField, chip.extra)
        .then((n) => { if (alive) setCounts((current) => ({ ...current, [chip.table]: n })); })
        .catch(() => {});
    });
    return () => { alive = false; };
  }, []);

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="bg-[#1E252F] px-5 py-4">
          <h2 className="text-base font-black text-white lg:text-lg">조회</h2>
          <p className="mt-0.5 text-[11px] font-semibold text-slate-400">쌓인 기록을 한 곳에서 — 기록 조회와 업무 현황판</p>
        </div>
        {/* 다크 상태줄 — 오늘 들어온 기록 */}
        <div className="flex flex-wrap items-center gap-2 bg-[#151A23] px-4 py-2.5">
          <span className="text-[11px] font-semibold text-slate-500">오늘 들어온 기록</span>
          {TODAY_CHIPS.map((chip) => (
            <span key={chip.table} className="flex items-center gap-1.5 rounded-full bg-white/[0.07] px-2.5 py-1 text-[11px] font-bold text-slate-400">
              {chip.label} <b className={`tabular-nums ${(counts[chip.table] ?? 0) > 0 ? "text-white" : "text-slate-500"}`}>{counts[chip.table] ?? "…"}</b>
            </span>
          ))}
          <span className="ml-auto hidden text-[11px] font-semibold text-slate-500 sm:block">기록은 보기 전용 — 수정·삭제는 각 업무 화면과 관리 탭에서</span>
        </div>
        <div className="flex overflow-x-auto">
          {([["records", "기록 조회"], ["status", "업무 현황판"]] as Array<[Tab, string]>).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`relative shrink-0 whitespace-nowrap px-5 py-3.5 text-sm font-black transition ${tab === key ? "text-slate-950 after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:bg-blue-600" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"}`}>{label}</button>
          ))}
        </div>
      </section>

      {tab === "records" ? <DataLookup author={author} /> : <OperationsDashboard author={author} />}
    </div>
  );
}
