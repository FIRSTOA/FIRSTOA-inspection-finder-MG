import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Plus, RefreshCw, Trash2 } from "lucide-react";
import { deleteRows, insertRow, selectRows, updateRows } from "./supabase";
import PortalSelect from "./PortalSelect";

/**
 * 카톡방·전송 설정 관리.
 *
 * 지금까지 이 값들은 Supabase 콘솔을 직접 열어야 바꿀 수 있었다.
 * (전송 on/off, 테스트 모드, 카테고리·지역별 방 이름)
 */
type ConfigRow = { key: string; value: string };
type RoomRow = { category: string; region: string; room: string };
type SheetJob = { id: string; category?: string; status?: string; created_at?: string; error?: string; message?: string };

const SWITCHES: Array<{ key: string; label: string; desc: string; danger?: boolean }> = [
  { key: "FIELD_KAKAO_SEND_ENABLED", label: "카톡 전송", desc: "끄면 FIELD 전송이 큐에만 쌓이고 방으로 나가지 않습니다." },
  { key: "FIELD_SHEET_SYNC_ENABLED", label: "시트 동기화", desc: "끄면 FIELD 기록이 구글시트에 기입되지 않습니다." },
  { key: "TEST_MODE", label: "테스트 모드", desc: "켜면 모든 전송이 아래 테스트 방으로만 갑니다.", danger: true },
  { key: "FIELD_SHEET_TEST_MODE", label: "시트 테스트 모드", desc: "켜면 시트 기입이 테스트 탭으로만 갑니다.", danger: true },
];

const ROOM_CATEGORIES = ["점검", "AS", "미수", "재계약", "불만", "초과조정", "자가", "부품", "물류", "PC", "복합기"];
const ROOM_REGIONS = ["*", "A", "B", "C", "D", "CD"];

export default function SystemAdmin() {
  const [config, setConfig] = useState<ConfigRow[]>([]);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [jobs, setJobs] = useState<SheetJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<RoomRow>({ category: "점검", region: "A", room: "" });

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
    if (!window.confirm(`${row.category} · ${row.region} 방 매핑을 삭제할까요?\n\n"${row.room}"`)) return;
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
              <div className="text-sm font-black text-slate-900">테스트 방 이름</div>
              <p className="mt-0.5 text-[11px] font-semibold text-slate-400">테스트 모드에서 모든 전송이 이 방으로 갑니다.</p>
            </div>
            <input defaultValue={valueOf("TEST_ROOM")} onBlur={(e) => { if (e.target.value !== valueOf("TEST_ROOM")) void saveConfig("TEST_ROOM", e.target.value); }}
              className="w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
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

      {/* 시트 동기화 최근 상태 */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-4">
          <h3 className="text-base font-black text-slate-950 lg:text-lg">시트 기입 최근 작업</h3>
          <p className="mt-0.5 text-[11px] font-semibold text-slate-400">FIELD·접수에서 구글시트로 보낸 요청의 결과입니다. 실패가 쌓이면 Apps Script 배포를 확인하세요.</p>
        </div>
        <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
          {jobs.map((job) => {
            const failed = /fail|error/i.test(String(job.status || "")) || !!job.error;
            return (
              <div key={job.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${failed ? "bg-rose-100 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>{job.status || (failed ? "실패" : "완료")}</span>
                <span className="w-32 shrink-0 truncate text-xs font-bold text-slate-600">{job.category || "-"}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-500" title={job.error || job.message || ""}>{job.error || job.message || "-"}</span>
                <span className="shrink-0 font-mono text-[10px] font-bold tabular-nums text-slate-400">{String(job.created_at || "").slice(5, 16).replace("T", " ")}</span>
              </div>
            );
          })}
          {!jobs.length && <div className="p-8 text-center text-sm font-bold text-slate-400">{loading ? "불러오는 중…" : "최근 작업 기록이 없습니다."}</div>}
        </div>
      </section>
    </div>
  );
}
