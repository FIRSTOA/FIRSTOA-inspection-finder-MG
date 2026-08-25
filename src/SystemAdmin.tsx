import { useEffect, useMemo, useState } from "react";
import { askConfirm } from "./confirmModal";
import { AlertTriangle, Plus, RefreshCw, Trash2 } from "lucide-react";
import { deleteRows, insertRow, invokeEdgeFunction, selectRows, updateRows } from "./supabase";
import { GAS_GET_URL } from "./api";
import { notify } from "./toast";
import PortalSelect from "./PortalSelect";
import VendorCodeAdmin from "./VendorCodeAdmin";

/**
 * 카톡방·전송 설정 관리.
 *
 * 지금까지 이 값들은 Supabase 콘솔을 직접 열어야 바꿀 수 있었다.
 * (전송 on/off, 테스트 모드, 카테고리·지역별 방 이름)
 */
type ConfigRow = { key: string; value: string };
type RoomRow = { category: string; region: string; room: string };
type SheetJob = { id: string; category?: string; sheet_status?: string; created_at?: string; last_error?: string; attempts?: number; sheet_row?: number | null };
// First-DATA GAS(action=adminstatus)가 주는 큐·수집함 상태 — 옛 웹 콘솔에서 이식
type GasStatus = {
  ok?: boolean;
  queue?: { jobs?: Array<{ roomType?: string; teamLabel?: string; status?: string; lastError?: string }>; active?: boolean };
  drive?: { enabled?: boolean; hasTrigger?: boolean; pending?: number; folderUrl?: string; interval?: string };
};

const SWITCHES: Array<{ key: string; label: string; desc: string; danger?: boolean }> = [
  { key: "FIELD_KAKAO_SEND_ENABLED", label: "카톡 전송", desc: "끄면 FIELD 전송이 큐에만 쌓이고 방으로 나가지 않습니다." },
  { key: "FIELD_SHEET_SYNC_ENABLED", label: "시트 동기화", desc: "끄면 FIELD 기록이 구글시트에 기입되지 않습니다." },
  { key: "TEST_MODE", label: "테스트 모드", desc: "켜면 모든 카카오톡 전송이 실제 방 대신 아래 테스트 카톡방으로만 갑니다.", danger: true },
  { key: "FIELD_SHEET_TEST_MODE", label: "시트 테스트 모드", desc: "켜면 시트 기입이 테스트 탭으로만 갑니다.", danger: true },
  { key: "NAVER_CALENDAR_ENABLED", label: "네이버 캘린더 미러", desc: "켜면 일정 등록 시 네이버 캘린더에도 자동 등록됩니다 (원본은 웹앱 일정리스트)." },
];

const ROOM_CATEGORIES = ["점검", "AS", "미수", "재계약", "불만", "초과조정", "자가", "부품", "물류", "PC", "복합기"];
const ROOM_REGIONS = ["*", "A", "B", "C", "D", "CD"];

export default function SystemAdmin() {
  const [config, setConfig] = useState<ConfigRow[]>([]);
  // 네이버 계정에 보이는 캘린더 목록(CalDAV PROPFIND) — 팀 완료 캘린더 ID를 공유 URL 없이도 고를 수 있게
  const [naverCalList, setNaverCalList] = useState<Array<{ id: string; name: string; owner: string }> | null>(null);
  const [naverCalLoading, setNaverCalLoading] = useState(false);
  const loadNaverCalList = async () => {
    setNaverCalLoading(true);
    try {
      const r = await invokeEdgeFunction<{ calendars?: Array<{ id: string; name: string; owner: string }> }>("naver-calendar-sync", { action: "list_calendars" });
      setNaverCalList((r.calendars || []).filter((c) => !/내 캘린더|내 할 일|네이버 예약/.test(c.name)));
    } catch (e) { notify(`캘린더 목록 조회 실패: ${(e as Error).message}`, "error"); }
    finally { setNaverCalLoading(false); }
  };
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [jobs, setJobs] = useState<SheetJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<RoomRow>({ category: "점검", region: "A", room: "" });
  const [gas, setGas] = useState<GasStatus | null>(null);
  const [gasError, setGasError] = useState("");
  const [ingestResult, setIngestResult] = useState("");
  const [collectRooms, setCollectRooms] = useState<Array<{ roomName: string; category: string; team: string }> | null>(null);
  const [collectDraft, setCollectDraft] = useState({ room: "", category: "점검", team: "A" });

  const load = async () => {
    setLoading(true);
    try {
      const [cfg, roomRows, jobRows] = await Promise.all([
        selectRows<ConfigRow>("app_config", "select=key,value&order=key.asc"),
        selectRows<RoomRow>("room_map", "select=category,region,room&order=category.asc,region.asc"),
        selectRows<SheetJob>("field_sheet_sync_jobs", "select=*&order=created_at.desc&limit=20").catch(() => []),
      ]);
      setConfig(cfg);
      setRooms(roomRows);
      setJobs(jobRows);
      setError("");
    } catch (e) {
      setError((e as Error).message || "설정을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);
  const loadGas = () => fetch(`${GAS_GET_URL}?action=adminstatus`).then((res) => res.json()).then(setGas).catch((e) => setGasError((e as Error).message));
  const loadCollectRooms = () => fetch(`${GAS_GET_URL}?action=roommap`).then((res) => res.json())
    .then((data) => setCollectRooms(data.rows || [])).catch((e) => setGasError((e as Error).message));
  useEffect(() => { void loadGas(); void loadCollectRooms(); }, []);

  const runIngestNow = () => {
    setBusy("ingestnow");
    setIngestResult("");
    fetch(`${GAS_GET_URL}?action=ingestnow`).then((res) => res.json())
      .then((r) => {
        setIngestResult(r.ok ? `파일 ${r.files} · 처리 ${r.done} · 신규 ${r.added} · 확인필요 ${r.held} · 실패 ${r.failed}` : String(r.error || "실패"));
        void loadGas();
      })
      .catch((e) => setIngestResult(`실행 실패: ${(e as Error).message}`))
      .finally(() => setBusy(""));
  };

  const valueOf = (key: string) => config.find((row) => row.key === key)?.value || "";
  const isOn = (key: string) => /^(true|1|on|y)$/i.test(valueOf(key));

  const saveConfig = async (key: string, value: string) => {
    setBusy(key);
    setNotice("");
    try {
      if (config.some((row) => row.key === key)) await updateRows("app_config", `key=eq.${encodeURIComponent(key)}`, { value });
      else await insertRow("app_config", { key, value });
      setConfig((current) => (current.some((row) => row.key === key) ? current.map((row) => (row.key === key ? { ...row, value } : row)) : [...current, { key, value }]));
      setNotice(`${key} 저장됨`);
    } catch (e) {
      setError((e as Error).message || "저장하지 못했습니다.");
    } finally {
      setBusy("");
    }
  };

  const addRoom = async () => {
    if (!draft.room.trim()) return;
    setBusy("room-add");
    try {
      const exists = rooms.some((row) => row.category === draft.category && row.region === draft.region);
      if (exists) await updateRows("room_map", `category=eq.${encodeURIComponent(draft.category)}&region=eq.${encodeURIComponent(draft.region)}`, { room: draft.room.trim() });
      else await insertRow("room_map", { category: draft.category, region: draft.region, room: draft.room.trim() });
      setDraft({ ...draft, room: "" });
      await load();
      setNotice("방 매핑 저장됨");
    } catch (e) {
      setError((e as Error).message || "저장하지 못했습니다.");
    } finally {
      setBusy("");
    }
  };

  const removeRoom = async (row: RoomRow) => {
    if (!await askConfirm(`${row.category} · ${row.region} 방 매핑을 삭제할까요?\n\n"${row.room}"`)) return;
    setBusy(`${row.category}|${row.region}`);
    try {
      await deleteRows("room_map", `category=eq.${encodeURIComponent(row.category)}&region=eq.${encodeURIComponent(row.region)}`);
      await load();
    } catch (e) {
      setError((e as Error).message || "삭제하지 못했습니다.");
    } finally {
      setBusy("");
    }
  };

  const grouped = useMemo(() => {
    const map = new Map<string, RoomRow[]>();
    rooms.forEach((row) => {
      const list = map.get(row.category) || [];
      list.push(row);
      map.set(row.category, list);
    });
    return Array.from(map.entries());
  }, [rooms]);

  const testMode = isOn("TEST_MODE") || isOn("FIELD_SHEET_TEST_MODE");

  return (
    <div className="space-y-4">
      {testMode && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-black text-amber-800">
          <AlertTriangle size={17} className="shrink-0" />
          테스트 모드가 켜져 있습니다 — 전송·기입이 실제 방/탭으로 가지 않습니다.
        </div>
      )}

      {/* 전송 스위치 */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4">
          <div>
            <h3 className="text-base font-black text-slate-950 lg:text-lg">전송·연동 스위치</h3>
            <p className="mt-0.5 text-[11px] font-semibold text-slate-400">지금까지 Supabase 콘솔에서만 바꿀 수 있던 값입니다.</p>
          </div>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-[11px] font-black text-slate-600 transition hover:bg-slate-50">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />새로고침
          </button>
        </div>
        {error && <div className="border-b border-rose-100 bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-700">{error}</div>}
        {notice && <div className="border-b border-emerald-100 bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-700">{notice}</div>}
        <div className="divide-y divide-slate-100">
          {SWITCHES.map((item) => {
            const on = isOn(item.key);
            return (
              <div key={item.key} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-slate-900">{item.label}</span>
                    <span className="font-mono text-[10px] font-bold text-slate-300">{item.key}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] font-semibold text-slate-400">{item.desc}</p>
                </div>
                <button type="button" disabled={busy === item.key} onClick={() => void saveConfig(item.key, on ? "false" : "true")}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-40 ${on ? (item.danger ? "bg-amber-500" : "bg-blue-600") : "bg-slate-200"}`}
                  aria-pressed={on} aria-label={`${item.label} ${on ? "켜짐" : "꺼짐"}`}>
                  <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-6" : "left-1"}`} />
                </button>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div>
              <div className="text-sm font-black text-slate-900">테스트 카톡방 이름</div>
              <p className="mt-0.5 text-[11px] font-semibold text-slate-400">카카오톡 방 이름입니다. 테스트 모드가 켜지면 모든 전송이 실제 방 대신 이 카톡방으로만 갑니다.</p>
            </div>
            <input defaultValue={valueOf("TEST_ROOM")} onBlur={(e) => { if (e.target.value !== valueOf("TEST_ROOM")) void saveConfig("TEST_ROOM", e.target.value); }}
              className="w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div>
              <div className="text-sm font-black text-slate-900">네이버 캘린더 ID</div>
              <p className="mt-0.5 text-[11px] font-semibold text-slate-400">비워두면 연동 계정의 기본 캘린더. 특정 캘린더로 보내려면 그 캘린더의 공유 URL(naver.me/…)을 그대로 붙여넣으세요 — 자동으로 ID로 바뀝니다. (캘린더 설정 → 공개 설정 → URL 복사)</p>
            </div>
            <input defaultValue={valueOf("NAVER_CALENDAR_ID")} placeholder="defaultCalendarId" onBlur={(e) => { if (e.target.value !== valueOf("NAVER_CALENDAR_ID")) void saveConfig("NAVER_CALENDAR_ID", e.target.value.trim()); }}
              className="w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div>
              <div className="text-sm font-black text-slate-900">네이버 재연동 (토큰 갱신)</div>
              <p className="mt-0.5 text-[11px] font-semibold text-slate-400">네이버 캘린더에 등록이 안 되기 시작하면(토큰 만료·비밀번호 변경) 연동 계정으로 로그인 한 번이면 됩니다. "연동 완료 ✓" 알림까지 확인하세요.</p>
            </div>
            <a href="https://nid.naver.com/oauth2.0/authorize?response_type=code&client_id=V_m8cXZT2YjdGqAJyssK&redirect_uri=https%3A%2F%2Ffirstoa-inspection-finder-mg.vercel.app%2F&state=firstoa"
              className="rounded-full border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700 transition hover:bg-emerald-100">재연동 열기</a>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div>
              <div className="text-sm font-black text-slate-900">팀별 완료 캘린더 ID</div>
              <p className="mt-0.5 text-[11px] font-semibold text-slate-400">일정 완료 시 익일통합as에서 이 캘린더로 이동합니다. 비운 팀은 제자리 완료 체크만. A·B는 "강북서AB as" 하나를 같이 씁니다(같은 ID).</p>
              <button type="button" onClick={() => void loadNaverCalList()} disabled={naverCalLoading}
                className="mt-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-50">
                {naverCalLoading ? "불러오는 중…" : "네이버 캘린더 목록 불러오기"}
              </button>
              {naverCalList && (
                <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto text-[11px] font-semibold text-slate-600">
                  {naverCalList.length === 0 && <li className="text-slate-400">캘린더가 없습니다</li>}
                  {naverCalList.map((c) => (
                    <li key={c.id} className="flex items-center gap-2">
                      <span className="w-40 truncate font-black text-slate-800">{c.name || "(이름 없음)"}</span>
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">{c.id}</code>
                      <button type="button" onClick={() => { void navigator.clipboard.writeText(c.id).then(() => notify(`${c.name} ID 복사 ✓`, "success")).catch(() => notify("복사 실패", "error")); }}
                        className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-500 hover:bg-slate-50">복사</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {(["A", "B", "C", "D", "E"] as const).map((t) => (
                <label key={t} className="flex items-center gap-1 text-xs font-black text-slate-500">{t}
                  <input defaultValue={valueOf(`NAVER_TEAM_CALENDAR_${t}`)} onBlur={(e) => { if (e.target.value !== valueOf(`NAVER_TEAM_CALENDAR_${t}`)) void saveConfig(`NAVER_TEAM_CALENDAR_${t}`, e.target.value.trim()); }}
                    className="w-32 rounded-lg border border-slate-300 px-2 py-2 text-xs font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 카톡방 매핑 */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-4">
          <h3 className="text-base font-black text-slate-950 lg:text-lg">카톡방 매핑</h3>
          <p className="mt-0.5 text-[11px] font-semibold text-slate-400">업무 종류 · 지역별로 어느 방에 보낼지 정합니다. 지역 <b>*</b> 는 전 지역 공통입니다.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-4">
          <label className="text-[11px] font-black text-slate-500">업무 종류
            <span className="mt-1 block"><PortalSelect width={130} value={draft.category} onChange={(next) => setDraft({ ...draft, category: next })}
              options={ROOM_CATEGORIES.map((value) => ({ value, label: value }))} /></span>
          </label>
          <label className="text-[11px] font-black text-slate-500">지역
            <span className="mt-1 block"><PortalSelect width={110} value={draft.region} onChange={(next) => setDraft({ ...draft, region: next })}
              options={ROOM_REGIONS.map((value) => ({ value, label: value === "*" ? "* 공통" : `${value}팀` }))} /></span>
          </label>
          <label className="min-w-0 flex-1 text-[11px] font-black text-slate-500">카톡방 이름
            <input value={draft.room} onChange={(e) => setDraft({ ...draft, room: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") void addRoom(); }}
              placeholder="카톡방 정확한 이름" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
          </label>
          <button type="button" onClick={() => void addRoom()} disabled={!draft.room.trim() || busy === "room-add"}
            className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-2.5 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 disabled:opacity-40">
            <Plus size={15} />저장
          </button>
        </div>
        <div className="grid gap-px bg-slate-100 sm:grid-cols-2 xl:grid-cols-3">
          {grouped.map(([groupName, list]) => (
            <div key={groupName} className="bg-white">
              <div className="border-b border-slate-100 px-4 py-2.5 text-xs font-black text-slate-700">{groupName}</div>
              <div className="divide-y divide-slate-50">
                {list.map((row) => (
                  <div key={`${row.category}|${row.region}`} className="flex items-center gap-2 px-4 py-2.5">
                    <span className="w-12 shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-center text-[10px] font-black text-slate-500">{row.region === "*" ? "공통" : row.region}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-slate-800" title={row.room}>{row.room}</span>
                    <button type="button" disabled={busy === `${row.category}|${row.region}`} onClick={() => void removeRoom(row)}
                      className="shrink-0 rounded-full p-1.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500 disabled:opacity-40"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {!grouped.length && !loading && <div className="bg-white p-8 text-center text-sm font-bold text-slate-400">등록된 방 매핑이 없습니다.</div>}
        </div>
      </section>

      {/* First-DATA GAS 상태 — 옛 웹 콘솔에서 이식한 항목 */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-4">
          <h3 className="text-base font-black text-slate-950 lg:text-lg">카톡 수집 상태 (First-DATA)</h3>
          <p className="mt-0.5 text-[11px] font-semibold text-slate-400">드라이브 수집함과 일괄 수집 작업 큐 — 옛 First-DATA 콘솔에 있던 항목입니다.</p>
        </div>
        {gasError && <div className="border-b border-rose-100 bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-700">GAS 상태 조회 실패: {gasError}</div>}
        {!gas && !gasError && <div className="p-6 text-center text-sm font-bold text-slate-400">First-DATA에서 상태를 불러오는 중…</div>}
        {gas && (
          <div className="grid gap-px bg-slate-100 sm:grid-cols-2">
            <div className="bg-white p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-black text-slate-700">드라이브 수집함 (카톡 TXT 자동 적재)</div>
                <button type="button" disabled={busy === "ingestnow"} onClick={runIngestNow}
                  className="rounded-full bg-blue-600 px-3 py-1 text-[10px] font-black text-white shadow-[0_2px_8px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 disabled:opacity-40">
                  {busy === "ingestnow" ? "수집 중… (몇 분 걸릴 수 있음)" : "지금 수집 실행"}
                </button>
              </div>
              {ingestResult && <div className="mt-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] font-bold text-slate-600">{ingestResult}</div>}
              {gas.drive?.enabled ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                  <span className={`rounded-full px-2.5 py-1 ${gas.drive.hasTrigger ? "bg-emerald-50 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>트리거 {gas.drive.hasTrigger ? "동작 중" : "없음"}</span>
                  <span className={`rounded-full px-2.5 py-1 tabular-nums ${(gas.drive.pending || 0) > 0 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500"}`}>대기 파일 {gas.drive.pending ?? 0}개</span>
                  {gas.drive.interval && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-500">주기 {gas.drive.interval}</span>}
                  {gas.drive.folderUrl && <a href={gas.drive.folderUrl} target="_blank" rel="noreferrer" className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-slate-600 transition hover:bg-slate-50">폴더 열기</a>}
                </div>
              ) : (
                <div className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-700">수집함이 꺼져 있습니다 — 카톡 대화가 DB로 들어오지 않는 상태입니다.</div>
              )}
            </div>
            <div className="bg-white p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-black text-slate-700">일괄 수집 작업 큐</div>
                {(gas.queue?.jobs?.length || 0) > 0 && (
                  <button type="button" disabled={busy === "kakaoclear"}
                    onClick={() => {
                      setBusy("kakaoclear");
                      fetch(`${GAS_GET_URL}?action=kakaoclear`).then((res) => res.json())
                        .then(() => fetch(`${GAS_GET_URL}?action=adminstatus`).then((res) => res.json()).then(setGas))
                        .catch((e) => setGasError((e as Error).message))
                        .finally(() => setBusy(""));
                    }}
                    className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[10px] font-black text-slate-500 transition hover:bg-slate-50 disabled:opacity-40">
                    {busy === "kakaoclear" ? "정리 중…" : "끝난 작업 정리"}
                  </button>
                )}
              </div>
              {gas.queue?.jobs?.length ? (
                <div className="mt-2 space-y-1">
                  {gas.queue.jobs.slice(0, 5).map((job, index) => (
                    <div key={index} className="flex items-center gap-2 text-[11px] font-bold">
                      <span className={`rounded-full px-2 py-0.5 ${job.status === "done" ? "bg-emerald-50 text-emerald-700" : job.status === "error" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"}`}>{job.status || "-"}</span>
                      <span className="truncate text-slate-600">{[job.roomType, job.teamLabel].filter(Boolean).join(" · ") || "-"}</span>
                      {job.lastError && <span className="truncate text-rose-500" title={job.lastError}>{job.lastError.slice(0, 40)}</span>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-[11px] font-bold text-slate-400">대기 중인 수집 작업이 없습니다.</div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* 카톡 수집 방 매핑 (받는 방향) — 옛 콘솔의 _room_map 시트를 웹앱에서 관리 */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-4">
          <h3 className="text-base font-black text-slate-950 lg:text-lg">카톡 수집 방 매핑 <span className="text-[11px] font-bold text-slate-400">받는 방향</span></h3>
          <p className="mt-0.5 text-[11px] font-semibold text-slate-400">드라이브에 올린 대화 txt가 어느 분류로 들어갈지 정합니다. 방이름은 txt 첫 줄의 "○○ 님과 카카오톡 대화"와 정확히 일치해야 합니다. (위 카톡방 매핑은 "보내는 방향"으로 별개)</p>
        </div>
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-4">
          <label className="min-w-0 flex-1 text-[11px] font-black text-slate-500">방이름 (정확히)
            <input value={collectDraft.room} onChange={(e) => setCollectDraft({ ...collectDraft, room: e.target.value })}
              placeholder="예: 강북A 미수 보증금미입금 보고방" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
          </label>
          <label className="text-[11px] font-black text-slate-500">분류
            <span className="mt-1 block"><PortalSelect width={120} value={collectDraft.category} onChange={(next) => setCollectDraft({ ...collectDraft, category: next })}
              options={["점검", "AS", "미수", "불만", "재계약"].map((value) => ({ value, label: value }))} /></span>
          </label>
          <label className="text-[11px] font-black text-slate-500">팀
            <input value={collectDraft.team} onChange={(e) => setCollectDraft({ ...collectDraft, team: e.target.value })}
              placeholder="A / AB / CD" className="mt-1 w-20 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
          </label>
          <button type="button" disabled={!collectDraft.room.trim() || busy === "collect-add"}
            onClick={() => {
              setBusy("collect-add");
              fetch(`${GAS_GET_URL}?action=roommapset&room=${encodeURIComponent(collectDraft.room.trim())}&category=${encodeURIComponent(collectDraft.category)}&team=${encodeURIComponent(collectDraft.team.trim())}`)
                .then((res) => res.json())
                .then((r) => { if (r.ok) { setCollectDraft({ ...collectDraft, room: "" }); void loadCollectRooms(); } else setGasError(String(r.error || "저장 실패")); })
                .catch((e) => setGasError((e as Error).message))
                .finally(() => setBusy(""));
            }}
            className="rounded-full bg-blue-600 px-4 py-2.5 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 disabled:opacity-40">저장</button>
        </div>
        <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
          {collectRooms === null && <div className="p-6 text-center text-sm font-bold text-slate-400">불러오는 중…</div>}
          {collectRooms?.map((row) => (
            <div key={row.roomName} className="flex items-center gap-2 px-4 py-2.5">
              <span className="w-16 shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-center text-[10px] font-black text-slate-500">{row.category}</span>
              <span className="w-10 shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-center text-[10px] font-black text-slate-500">{row.team || "-"}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-slate-800" title={row.roomName}>{row.roomName}</span>
              <button type="button" disabled={busy === `collect-del-${row.roomName}`}
                onClick={async () => {
                  if (!await askConfirm(`"${row.roomName}" 수집 매핑을 삭제할까요?`)) return;
                  setBusy(`collect-del-${row.roomName}`);
                  fetch(`${GAS_GET_URL}?action=roommapdel&room=${encodeURIComponent(row.roomName)}`)
                    .then((res) => res.json())
                    .then(() => void loadCollectRooms())
                    .catch((e) => setGasError((e as Error).message))
                    .finally(() => setBusy(""));
                }}
                className="shrink-0 rounded-full p-1.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500 disabled:opacity-40"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      </section>

      {/* 시트 동기화 최근 상태 */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-4">
          <h3 className="text-base font-black text-slate-950 lg:text-lg">시트 기입 최근 작업</h3>
          <p className="mt-0.5 text-[11px] font-semibold text-slate-400">FIELD·접수에서 구글시트로 보낸 요청의 결과입니다. 실패가 쌓이면 Apps Script 배포를 확인하세요.</p>
        </div>
        <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
          {jobs.map((job) => {
            const state = job.sheet_status === "synced" ? "완료" : job.sheet_status === "failed" ? "실패" : "대기";
            const tone = state === "완료" ? "bg-emerald-50 text-emerald-700" : state === "실패" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800";
            return (
              <div key={job.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${tone}`}>{state}{job.attempts ? ` ${job.attempts}회` : ""}</span>
                <span className="w-32 shrink-0 truncate text-xs font-bold text-slate-600">{job.category || "-"}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-500" title={job.last_error || ""}>{job.last_error || (state === "완료" ? `행 ${job.sheet_row ?? "-"}` : "-")}</span>
                {state !== "완료" && (
                  <button type="button" disabled={busy === `retry-${job.id}`}
                    onClick={() => { void (async () => { setBusy(`retry-${job.id}`); try { await invokeEdgeFunction("field-sheet-sync", { jobId: job.id }); await load(); } catch { /* 결과는 목록 갱신으로 확인 */ } finally { setBusy(""); } })(); }}
                    className="shrink-0 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-black text-blue-700 transition hover:bg-blue-100 disabled:opacity-40">
                    {busy === `retry-${job.id}` ? "실행 중…" : "다시 실행"}
                  </button>
                )}
                <span className="shrink-0 font-mono text-[10px] font-bold tabular-nums text-slate-400">{String(job.created_at || "").slice(5, 16).replace("T", " ")}</span>
              </div>
            );
          })}
          {!jobs.length && <div className="p-8 text-center text-sm font-bold text-slate-400">{loading ? "불러오는 중…" : "최근 작업 기록이 없습니다."}</div>}
        </div>
      </section>

      {/* 거래처 코드 미매칭 확정 — 워킨맵 지점 ↔ 임대리스트 거래처 수동 연결 */}
      <VendorCodeAdmin />
    </div>
  );
}
