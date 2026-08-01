import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { SUPABASE_ANON, SUPABASE_URL } from "./supabase";

/**
 * 동기화 현황 — 조회 화면이 읽는 표들이 "어디서, 언제까지" 채워졌는지 보여준다.
 *
 * 기록이 들어오는 길은 세 갈래다.
 *  - 시트: First-DATA Apps Script(SupabaseSync.gs)의 시간 트리거가 구글시트 → DB로 복사
 *  - 카톡: 메신저봇이 업무방 메시지를 웹훅으로 넘기면 GAS가 파싱해 기록
 *  - 웹앱: FIELD·접수 화면에서 저장 즉시 직접 기록
 * 여기서는 길별 "마지막 기록 시각"을 보여준다 — 어느 길이 끊겼는지 바로 드러난다.
 */
type Route = { label: "시트" | "카톡" | "웹앱"; filter: string };
type CategoryDef = {
  label: string;
  table: string;
  routes: Route[];         // 이 표에 기록이 들어오는 길
  sheetNote?: string;      // 원본 시트/방 설명
};

const ENC = (v: string) => encodeURIComponent(v);
const CATEGORIES: CategoryDef[] = [
  { label: "점검", table: "jeomgeom", routes: [{ label: "카톡", filter: `_출처=like.${ENC("카톡")}*` }, { label: "웹앱", filter: `_출처=not.like.${ENC("카톡")}*` }], sheetNote: "팀별 점검방 메시지 + FIELD 전송" },
  { label: "AS", table: "as_records", routes: [{ label: "카톡", filter: `_출처=like.${ENC("카톡")}*` }, { label: "시트", filter: `_출처=like.${ENC("시트")}*` }], sheetNote: "팀별 AS방 메시지 + AS접수 시트" },
  { label: "물류", table: "logistics_records", routes: [{ label: "웹앱", filter: `_출처=like.${ENC("웹앱")}*` }], sheetNote: "FIELD 물류 양식" },
  { label: "불만", table: "bulman", routes: [{ label: "시트", filter: `_출처=like.${ENC("시트")}*` }, { label: "카톡", filter: `_출처=like.${ENC("카톡")}*` }, { label: "웹앱", filter: `_출처=like.${ENC("웹앱")}*` }], sheetNote: "불만 시트 + CD불만고객방" },
  { label: "미수", table: "misu", routes: [{ label: "시트", filter: `_출처=like.${ENC("시트")}*` }, { label: "카톡", filter: `_출처=like.${ENC("카톡")}*` }], sheetNote: "미수현황 시트(수도권A~E) + 미수 보고방" },
  { label: "초과료", table: "overage", routes: [{ label: "시트", filter: `_출처=like.${ENC("시트")}*` }], sheetNote: "초과 시트" },
  { label: "초과조정", table: "overage_adjust", routes: [{ label: "카톡", filter: `_출처=like.${ENC("카톡")}*` }, { label: "웹앱", filter: `_출처=not.like.${ENC("카톡")}*` }], sheetNote: "초과업체조정 방 + FIELD" },
  { label: "재계약", table: "recontract", routes: [{ label: "카톡", filter: `_출처=like.${ENC("카톡")}*` }, { label: "시트", filter: `_출처=like.${ENC("시트")}*` }], sheetNote: "팀별 계약종료체크 방" },
  { label: "해지방어", table: "churn_defense", routes: [{ label: "웹앱", filter: "" }], sheetNote: "FIELD 해지방어 양식" },
  { label: "관리지원", table: "mgmt_support", routes: [{ label: "웹앱", filter: "" }], sheetNote: "FIELD 관리지원 양식" },
  { label: "PC 확장성", table: "pc_expansion", routes: [{ label: "시트", filter: `_출처=like.${ENC("시트")}*` }, { label: "웹앱", filter: `_출처=like.${ENC("웹앱")}*` }], sheetNote: "PC 확장성 DB 시트 + IT통합 양식" },
  { label: "복합기 확장성", table: "mfp_expansion", routes: [{ label: "시트", filter: `_출처=like.${ENC("시트")}*` }], sheetNote: "영업확장성 DB 통합추출 시트" },
];

type RowState = {
  total: number | null;
  latest: string;              // 전체 최신
  routes: Array<{ label: string; latest: string }>;
  error?: string;
};

const HEADERS = { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` };

async function latestOf(table: string, filter: string): Promise<string> {
  const q = `select=created_at&order=created_at.desc&limit=1${filter ? `&${filter}` : ""}`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${q}`, { headers: HEADERS });
  if (!res.ok) return "";
  const rows = (await res.json()) as Array<{ created_at?: string }>;
  return rows[0]?.created_at || "";
}

async function countOf(table: string): Promise<number | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id&limit=1`, {
    method: "HEAD",
    headers: { ...HEADERS, Prefer: "count=exact" },
  });
  const range = res.headers.get("content-range") || "";
  const total = Number(range.split("/")[1]);
  return Number.isFinite(total) ? total : null;
}

function ago(iso: string) {
  if (!iso) return { text: "기록 없음", stale: true };
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  const text = days <= 0 ? "오늘" : days === 1 ? "어제" : `${days}일 전`;
  // 일주일 넘게 조용하면 길이 끊겼을 수 있다 (주말·휴가는 며칠이면 정상)
  return { text, stale: days >= 7 };
}

function stamp(iso: string) {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function SyncStatus() {
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    await Promise.all(CATEGORIES.map(async (category) => {
      try {
        const [total, latest, ...routeLatest] = await Promise.all([
          countOf(category.table),
          latestOf(category.table, ""),
          ...category.routes.map((route) => latestOf(category.table, route.filter)),
        ]);
        setRows((current) => ({
          ...current,
          [category.table]: { total, latest, routes: category.routes.map((route, index) => ({ label: route.label, latest: routeLatest[index] })) },
        }));
      } catch (e) {
        setRows((current) => ({ ...current, [category.table]: { total: null, latest: "", routes: [], error: (e as Error).message } }));
      }
    }));
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const routeTone = (label: string) => label === "시트" ? "bg-emerald-50 text-emerald-700" : label === "카톡" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700";

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4">
          <div>
            <h3 className="text-base font-black text-slate-950 lg:text-lg">동기화 현황</h3>
            <p className="mt-0.5 text-[11px] font-semibold text-slate-400">조회가 읽는 표마다 기록이 들어오는 길(시트·카톡·웹앱)별 마지막 기록 시각입니다. 7일 이상 조용한 길은 빨갛게 표시됩니다.</p>
          </div>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-[11px] font-black text-slate-600 transition hover:bg-slate-50">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />새로고침
          </button>
        </div>

        {/* 표 머리 */}
        <div className="hidden grid-cols-[110px_minmax(0,1.2fr)_90px_minmax(0,2fr)] gap-2 border-b border-slate-200 bg-slate-100/70 px-4 py-2.5 sm:grid">
          <span className="text-[11px] font-black text-slate-500">분류</span>
          <span className="text-[11px] font-black text-slate-500">원본</span>
          <span className="text-right text-[11px] font-black text-slate-500">총 건수</span>
          <span className="text-[11px] font-black text-slate-500">경로별 마지막 기록</span>
        </div>

        <div className="divide-y divide-slate-100">
          {CATEGORIES.map((category) => {
            const state = rows[category.table];
            return (
              <div key={category.table} className="grid gap-2 px-4 py-3 sm:grid-cols-[110px_minmax(0,1.2fr)_90px_minmax(0,2fr)] sm:items-center">
                <span className="text-[13px] font-black text-slate-900">{category.label}</span>
                <span className="truncate text-[11px] font-semibold text-slate-500" title={category.sheetNote}>{category.sheetNote}</span>
                <span className="font-mono text-xs font-bold tabular-nums text-slate-700 sm:text-right">{state?.total != null ? state.total.toLocaleString() : "…"}</span>
                <span className="flex flex-wrap items-center gap-1.5">
                  {state ? state.routes.map((route) => {
                    const meta = ago(route.latest);
                    return (
                      <span key={route.label} title={route.latest ? `마지막 기록 ${stamp(route.latest)}` : "기록 없음"}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${meta.stale ? "bg-rose-50 text-rose-600" : routeTone(route.label)}`}>
                        {route.label} <b className="tabular-nums">{meta.text}</b>
                        {route.latest && <span className="hidden font-mono text-[10px] font-semibold opacity-60 lg:inline">{stamp(route.latest)}</span>}
                      </span>
                    );
                  }) : <span className="text-[11px] font-bold text-slate-300">확인 중…</span>}
                  {state?.error && <span className="text-[11px] font-bold text-rose-500">{state.error.slice(0, 60)}</span>}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-black text-slate-950">동기화는 어디서 도나요?</h3>
        <div className="mt-3 grid gap-3 text-[12px] font-semibold leading-5 text-slate-600 lg:grid-cols-3">
          <div className="rounded-lg bg-emerald-50/60 p-3">
            <div className="mb-1 font-black text-emerald-800">시트 → DB</div>
            First-DATA Apps Script(SupabaseSync.gs)의 <b>시간 트리거</b>가 주기적으로 복사합니다.
            주기를 바꾸거나 시트가 바뀌면 <b>First-DATA Apps Script의 트리거 설정</b>에서 조정합니다.
          </div>
          <div className="rounded-lg bg-amber-50/60 p-3">
            <div className="mb-1 font-black text-amber-800">카톡 → DB</div>
            메신저봇이 업무방 메시지를 웹훅으로 넘기면 GAS가 양식을 해석해 즉시 기록합니다.
            길이 끊기면 봇 기기·웹훅 주소를 확인하세요.
          </div>
          <div className="rounded-lg bg-blue-50/60 p-3">
            <div className="mb-1 font-black text-blue-800">웹앱 → DB</div>
            FIELD·서비스접수에서 저장하는 즉시 직접 기록됩니다. 별도 동기화가 없습니다.
          </div>
        </div>
      </section>
    </div>
  );
}
