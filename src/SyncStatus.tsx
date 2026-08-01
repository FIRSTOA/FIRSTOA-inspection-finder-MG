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
type Route = { label: string; filter: string; quiet?: boolean };  // quiet: 예전 경로라 조용해도 정상 (회색 표시)
type CategoryDef = {
  label: string;
  table: string;
  routes: Route[];         // 이 표에 기록이 들어오는 길
  sheetNote?: string;      // 원본 시트/방 설명
  timeField?: string;      // 최신 시각 컬럼 (기본 created_at — 업서트 표는 _등록시각이 진실)
  staleDays?: number;      // 이 일수 넘게 조용하면 빨간 표시 (기본 7)
};

const ENC = (v: string) => encodeURIComponent(v);
const CATEGORIES: CategoryDef[] = [
  // "웹앱" = FIELD 저장이 직접 기록한 행 (출처 라벨이 관례상 "카톡:웹앱").
  // "카톡 (중단)" = 카톡방 메시지 수집 — 현재 봇 수집이 멈춰 있어(사용자 확인) 회색으로 둔다.
  { label: "점검", table: "jeomgeom", sheetNote: "FIELD 전송 + 팀별 점검방", routes: [
    { label: "웹앱", filter: `_출처=like.${ENC("카톡:웹앱")}*` },
    { label: "카톡 (중단)", filter: `_출처=like.${ENC("카톡:점검")}*`, quiet: true },
  ] },
  { label: "AS", table: "as_records", sheetNote: "FIELD 전송 + 팀별 AS방 (시트분은 초기 이관)", routes: [
    { label: "웹앱", filter: `_출처=like.${ENC("카톡:웹앱")}*` },
    { label: "카톡 (중단)", filter: `_출처=like.${ENC("카톡:AS")}*`, quiet: true },
  ] },
  { label: "물류", table: "logistics_records", sheetNote: "FIELD 물류 양식", staleDays: 30, routes: [{ label: "웹앱", filter: `_출처=like.${ENC("웹앱")}*` }] },
  { label: "불만", table: "bulman", sheetNote: "불만 시트 + FIELD", routes: [
    { label: "시트", filter: `_출처=like.${ENC("시트")}*`, },
    { label: "웹앱", filter: `_출처=like.${ENC("웹앱")}*`, quiet: true },
    { label: "카톡 (중단)", filter: `_출처=like.${ENC("카톡")}*`, quiet: true },
  ] },
  { label: "미수", table: "misu", sheetNote: "미수현황 시트(수도권A~E) — 매시간 전체 재적재", routes: [
    { label: "시트", filter: "" },
  ] },
  { label: "초과료", table: "overage", sheetNote: "초과 시트", routes: [{ label: "시트", filter: `_출처=like.${ENC("시트")}*` }] },
  { label: "초과조정", table: "overage_adjust", sheetNote: "초과업체조정 방 + FIELD (드문 업무)", staleDays: 90, routes: [
    { label: "카톡 (중단)", filter: `_출처=like.${ENC("카톡")}*`, quiet: true },
    { label: "웹앱", filter: `_출처=not.like.${ENC("카톡")}*`, quiet: true },
  ] },
  // 재계약은 카톡방 수집이 유일한 경로였는데 그 수집이 중단됨 — 새 기록이 못 들어오는 상태
  { label: "재계약", table: "recontract", sheetNote: "계약종료체크 방 — 수집 중단으로 새 기록 없음", routes: [
    { label: "카톡 (중단)", filter: `_출처=like.${ENC("카톡")}*`, quiet: true },
  ] },
  { label: "해지방어", table: "churn_defense", sheetNote: "FIELD 해지방어 양식", routes: [{ label: "웹앱", filter: "" }] },
  { label: "관리지원", table: "mgmt_support", sheetNote: "FIELD 관리지원 양식", routes: [{ label: "웹앱", filter: "" }] },
  { label: "PC 확장성", table: "pc_expansion", sheetNote: "PC 확장성 DB 시트 + IT통합 양식", staleDays: 9, routes: [
    { label: "시트", filter: `_출처=like.${ENC("시트")}*` },
    { label: "웹앱", filter: `_출처=like.${ENC("웹앱")}*`, quiet: true },
  ] },
  { label: "복합기 확장성", table: "mfp_expansion", sheetNote: "영업확장성 DB 통합추출 시트", staleDays: 9, routes: [{ label: "시트", filter: `_출처=like.${ENC("시트")}*` }] },
  // 임대리스트는 주 1회 전체 업서트 — 서울 이전 때 조용히 실패해 5일 묵었던 전례가 있어 감시망에 넣는다
  { label: "임대리스트", table: "vendor_info", timeField: "_등록시각", staleDays: 9, routes: [{ label: "시트", filter: "" }], sheetNote: "임대리스트 원본시트 (주 1회 전체 동기화)" },
];

type RowState = {
  total: number | null;
  latest: string;              // 전체 최신
  routes: Array<{ label: string; latest: string }>;
  error?: string;
};

const HEADERS = { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` };

async function latestOf(table: string, filter: string, timeField = "created_at"): Promise<string> {
  const field = encodeURIComponent(timeField);
  const q = `select=${field}&order=${field}.desc.nullslast&limit=1${filter ? `&${filter}` : ""}`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${q}`, { headers: HEADERS });
  if (!res.ok) return "";
  const rows = (await res.json()) as Array<Record<string, string | undefined>>;
  return rows[0]?.[timeField] || "";
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

function kstDate(iso: string) {
  // sv-SE 로케일 = YYYY-MM-DD 형식
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

function ago(iso: string, staleDays = 7) {
  if (!iso) return { text: "기록 없음", stale: true };
  // 시각 차가 아니라 달력 날짜 차이 — 어제 저녁 기록을 "오늘"이라 부르지 않도록
  const days = Math.round((Date.parse(kstDate(new Date().toISOString())) - Date.parse(kstDate(iso))) / 86400000);
  const text = days <= 0 ? "오늘" : days === 1 ? "어제" : `${days}일 전`;
  // 기준 일수 넘게 조용하면 길이 끊겼을 수 있다 (주 1회 동기화 표는 기준을 늘려 잡는다)
  return { text, stale: days >= staleDays };
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
          latestOf(category.table, "", category.timeField),
          ...category.routes.map((route) => latestOf(category.table, route.filter, category.timeField)),
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
            <p className="mt-0.5 text-[11px] font-semibold text-slate-400">표마다 기록이 들어오는 길별 마지막 기록 시각. 빨강 = 끊긴 것으로 의심, 회색 = 예전 경로라 조용해도 정상.</p>
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
                  {state && state.total === 0 ? (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-400">아직 기록 없음</span>
                  ) : state ? state.routes.map((route, index) => {
                    const def = category.routes[index];
                    const meta = ago(route.latest, category.staleDays);
                    const tone = def?.quiet
                      ? "bg-slate-100 text-slate-400"                             // 휴면 경로 — 조용해도 정상
                      : meta.stale ? "bg-rose-50 text-rose-600" : routeTone(route.label);
                    return (
                      <span key={route.label} title={route.latest ? `마지막 기록 ${stamp(route.latest)}` : "기록 없음"}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${tone}`}>
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
