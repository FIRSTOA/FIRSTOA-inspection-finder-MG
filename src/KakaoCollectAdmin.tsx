import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Copy, RefreshCw } from "lucide-react";
import { UI } from "./ui/card";
import StateBox from "./ui/StateBox";
import PortalSelect from "./PortalSelect";
import { notify } from "./toast";
import {
  COLLECT_KINDS, COLLECT_REGIONS, COLLECT_STATE_LABEL, buildCollectRoomInsertSql, buildRoomViews, collectDraftProblem, collectHeadline,
  describeGasResult, formatKstShort, loadCollectCard, missingTableNotices, runGasAdmin, todayKst,
  type CollectCardData, type CollectState,
} from "./kakaoCollectApi";

/**
 * 관리 탭 › 전송·연동 › [카톡 수집] 카드 (2026-10-24, 설계 docs/tasks/kakao-collect-expand.md 3-6·4절).
 * 머리 한 줄 · 방별 줄(처리 칩·구조 적재 최근·원문 최근 글·상태 점) · 확인필요 · [지금 수집 실행]·[다시 넣기]·[끝난 작업 정리].
 * 쓰기 동작은 엣지 gas-admin 경유(토큰은 엣지 시크릿). 방 추가·수정은 표 권한이 SELECT 뿐이라 SQL 한 줄을 만들어 복사만 해 준다.
 */

const HEAD_BLOCK = "border-b border-slate-100 bg-slate-50 px-4 py-3 lg:px-5";
const DOT: Record<CollectState, string> = { ok: "bg-emerald-500", warn: "bg-amber-400", bad: "bg-rose-500", off: "bg-slate-300" };
const TONE: Record<CollectState, string> = { ok: UI.tone.ok, warn: UI.tone.warn, bad: UI.tone.bad, off: UI.tone.off };
type GasAction = "ingestnow" | "retryheld" | "kakaoclear";

export default function KakaoCollectAdmin() {
  const [data, setData] = useState<CollectCardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<GasAction | "">("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [openRoom, setOpenRoom] = useState("");
  const [draft, setDraft] = useState<{ room: string; kinds: string[]; region: string }>({ room: "", kinds: [], region: "A" });

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await loadCollectCard()); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const today = todayKst();
  const views = useMemo(() => data ? buildRoomViews(data.tableMissing ? null : data.table, data.gas, data.log, today) : [], [data, today]);
  const head = useMemo(() => collectHeadline(views, data?.gas || null, data?.admin || null, today), [views, data, today]);
  const notices = data ? missingTableNotices(data.tableMissing, data.logMissing) : [];
  const heldNames = data?.gas?.held_names || data?.admin?.drive?.heldNames || [];
  const unregistered = data?.gas?.unregistered || [];
  const jobs = data?.admin?.queue?.jobs || [];
  const finishedJobs = jobs.filter((j) => j.status === "done" || j.status === "error").length;
  const drive = data?.admin?.drive;

  const run = async (action: GasAction) => {
    setBusy(action);
    setResult(null);
    try {
      const r = describeGasResult(action, await runGasAdmin(action));
      setResult(r);
      notify(r.text, r.ok ? "success" : "error");
      if (r.ok) void load();
    } catch (e) {
      const text = `실행 실패: ${(e as Error).message}`;
      setResult({ ok: false, text });
      notify(text, "error");
    } finally { setBusy(""); }
  };

  const draftProblem = collectDraftProblem(draft);
  const sql = draftProblem ? "" : buildCollectRoomInsertSql(draft);
  const copySql = async () => {
    try { await navigator.clipboard.writeText(sql); notify("SQL 을 복사했습니다. Supabase SQL Editor 에 붙여 넣어 실행하세요.", "success"); }
    catch { notify("복사하지 못했습니다 — 아래 글을 직접 선택해 복사하세요.", "error"); }
  };
  const fillDraftName = (name: string) => {
    setDraft((d) => ({ ...d, room: name }));
    document.getElementById("kakao-collect-add")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section className={UI.card}>
      <div className={`${HEAD_BLOCK} flex flex-wrap items-start justify-between gap-2`}>
        <div className="min-w-0">
          <h3 className={UI.title}>카톡 수집</h3>
          <p className={UI.desc}>노트북 매크로가 저장한 카톡 대화를 GAS 가 FIELD 표로, 엣지가 원문 보관으로 넣습니다. 방마다 마지막으로 들어온 날을 봅니다.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} aria-label="카톡 수집 새로고침" className={UI.btnIcon}>
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {!data && loading && <StateBox inside kind="loading" message="수집 상태를 불러오는 중입니다…" />}

      {data && (
        <>
          {/* 머리 한 줄 */}
          <div className="border-b border-slate-100 px-4 py-3 text-[13px] font-black tabular-nums text-slate-800 lg:px-5">{head.text}</div>

          {notices.map((n) => <div key={n} className={`${UI.note("warn")} m-3 lg:mx-4`}>{n}</div>)}
          {data.tableError && <div role="alert" className={`${UI.note("bad")} m-3 lg:mx-4`}>수집 방 표 조회 실패: {data.tableError}</div>}
          {data.logError && <div role="alert" className={`${UI.note("bad")} m-3 lg:mx-4`}>원문 적재 기록 조회 실패: {data.logError}</div>}
          {data.gasError && <div role="alert" className={`${UI.note("bad")} m-3 lg:mx-4`}>GAS 수집 상태 조회 실패: {data.gasError}</div>}
          {data.adminError && <div role="alert" className={`${UI.note("bad")} m-3 lg:mx-4`}>GAS 수집함·작업 큐 조회 실패: {data.adminError}</div>}
          {data.gas?.supabaseError && <div className={`${UI.note("info")} m-3 lg:mx-4`}>GAS 가 수집 방 표 대신 _room_map 시트를 쓰고 있습니다: {data.gas.supabaseError}</div>}

          {/* 동작 */}
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 lg:px-5">
            <button type="button" disabled={!!busy} onClick={() => void run("ingestnow")} className={`${UI.btn} text-xs!`}>
              {busy === "ingestnow" ? "수집 중… (몇 분 걸릴 수 있음)" : "지금 수집 실행"}
            </button>
            <button type="button" disabled={!!busy || head.heldCount === 0} onClick={() => void run("retryheld")} className={`${UI.btnGhost} text-xs!`}>
              {busy === "retryheld" ? "되돌리는 중…" : `다시 넣기 (확인필요 ${head.heldCount})`}
            </button>
            <button type="button" disabled={!!busy || finishedJobs === 0} onClick={() => void run("kakaoclear")} className={`${UI.btnGhost} text-xs!`}>
              {busy === "kakaoclear" ? "정리 중…" : `끝난 작업 정리${finishedJobs ? ` (${finishedJobs})` : ""}`}
            </button>
            {drive && (drive.enabled ? (
              <span className="flex flex-wrap items-center gap-1.5">
                <span className={`${UI.badge} ${drive.hasTrigger ? UI.tone.ok : UI.tone.bad}`}>트리거 {drive.hasTrigger ? "동작 중" : "없음"}</span>
                <span className={`${UI.badge} tabular-nums ${(drive.pending || 0) > 0 ? UI.tone.warn : UI.tone.off}`}>대기 파일 {drive.pending ?? 0}</span>
                {drive.interval && <span className={`${UI.badge} ${UI.tone.off}`}>주기 {drive.interval}</span>}
                {drive.folderUrl && <a href={drive.folderUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center px-1 text-[11px] font-black text-blue-600 underline lg:min-h-9">폴더 열기</a>}
              </span>
            ) : <span className={`${UI.badge} ${UI.tone.bad}`}>수집함 꺼짐 — 카톡 대화가 들어오지 않습니다</span>)}
          </div>
          {result && <div role={result.ok ? "status" : "alert"} className={`${UI.note(result.ok ? "ok" : "bad")} m-3 lg:mx-4`}>{result.text}</div>}
          {jobs.length > 0 && (
            <div className="space-y-1 border-b border-slate-100 px-4 py-2.5 lg:px-5">
              {jobs.slice(0, 5).map((job, i) => (
                <div key={i} className="flex min-w-0 items-center gap-2 text-[11px] font-bold">
                  <span className={`${UI.badge} ${job.status === "done" ? UI.tone.ok : job.status === "error" ? UI.tone.bad : UI.tone.warn}`}>{job.status || "-"}</span>
                  <span className="truncate text-slate-600">{[job.roomType, job.teamLabel].filter(Boolean).join(" · ") || "-"}</span>
                  {job.lastError && <span className="truncate text-rose-500" title={job.lastError}>{job.lastError.slice(0, 40)}</span>}
                </div>
              ))}
            </div>
          )}

          {/* 방별 줄 */}
          <div className="divide-y divide-slate-100">
            {views.length === 0 && <StateBox inside kind="empty" message={data.tableMissing ? "SQL 실행 대기 — 수집 방 목록이 아직 없습니다." : "등록된 수집 방이 없습니다."} hint={data.tableMissing ? "supabase/kakao-collect-rooms-20261024.sql 실행 뒤 새로고침하세요." : undefined} />}
            {views.map((v) => {
              const open = openRoom === v.room;
              return (
                <div key={v.room}>
                  <button type="button" onClick={() => setOpenRoom(open ? "" : v.room)} aria-expanded={open}
                    className="flex min-h-11 w-full items-start gap-2 px-4 py-2.5 text-left transition hover:bg-slate-50 lg:px-5">
                    <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[v.state]}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1">
                        <span className="min-w-0 truncate text-[13px] font-black text-slate-800" title={v.room}>{v.room}</span>
                        {v.kinds.map((k) => <span key={k} className={`${UI.badge} ${UI.tone.off}`}>{k}</span>)}
                        {v.held > 0 && <span className={`${UI.badge} ${UI.tone.warn}`}>확인필요 {v.held}</span>}
                      </span>
                      <span className="mt-0.5 block text-[11px] font-semibold tabular-nums text-slate-500">
                        구조 적재 {formatKstShort(v.lastImportAt)} · 원문 최근 글 {formatKstShort(v.lastRawAt)}
                      </span>
                    </span>
                    <span className={`${UI.badge} shrink-0 ${TONE[v.state]}`}>{COLLECT_STATE_LABEL[v.state]}</span>
                    {open ? <ChevronDown size={15} className="mt-1 shrink-0 text-slate-400" /> : <ChevronRight size={15} className="mt-1 shrink-0 text-slate-400" />}
                  </button>
                  {open && (
                    <div className="bg-slate-50 px-4 pb-3 pt-1 text-[11px] font-semibold text-slate-600 lg:px-5">
                      <div className="flex flex-wrap gap-1.5 py-1">
                        <span className={`${UI.badge} ${UI.tone.off}`}>지역 {v.region || "-"}</span>
                        <span className={`${UI.badge} ${v.enabled ? UI.tone.ok : UI.tone.off}`}>{v.enabled ? "켜짐" : "꺼짐"}</span>
                        <span className={`${UI.badge} ${v.export ? UI.tone.ok : UI.tone.off}`}>매크로 저장 {v.export ? "O" : "X"}</span>
                        <span className={`${UI.badge} ${v.structured ? UI.tone.ok : UI.tone.off}`}>표 적재 {v.structured ? "O" : "X"}</span>
                        <span className={`${UI.badge} ${v.keepRaw ? UI.tone.ok : UI.tone.off}`}>원문 보관 {v.keepRaw ? "O" : "X"}</span>
                      </div>
                      <div className="mt-1 font-black text-slate-500">원문 적재 기록 최근 5줄</div>
                      {v.recent.length === 0 ? <div className="text-slate-400">기록이 없습니다(최근 14일).</div> : (
                        <ul className="mt-0.5 space-y-0.5">
                          {v.recent.map((r, i) => (
                            <li key={i} className="flex min-w-0 flex-wrap gap-x-2 tabular-nums">
                              <span>{formatKstShort(r.created_at)}</span>
                              <span className={r.status === "error" ? "text-rose-600" : r.status === "partial" ? "text-amber-600" : "text-emerald-700"}>{r.status}</span>
                              <span>새 글 {r.inserted ?? 0}</span>
                              <span>~{formatKstShort(r.to_at)}</span>
                              {r.error && <span className="truncate text-rose-600" title={r.error}>{r.error.slice(0, 50)}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 확인필요 */}
          {(heldNames.length > 0 || unregistered.length > 0) && (
            <div className="border-t border-slate-100 px-4 py-3 lg:px-5">
              <div className="text-xs font-black text-slate-700">확인필요 {head.heldCount}</div>
              <p className={UI.desc}>방 이름이 수집 표에 없거나 처리에 실패한 파일입니다. 방 이름이 다르면 아래에서 그 이름으로 추가(SQL)한 뒤 [다시 넣기]를 누르세요.</p>
              {unregistered.length > 0 && (
                <div className="mt-2 space-y-1">
                  <div className="text-[11px] font-black text-slate-500">표에 없는 방 이름</div>
                  {unregistered.map((name) => (
                    <div key={name} className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-slate-700" title={name}>{name}</span>
                      <button type="button" onClick={() => fillDraftName(name)} className={`${UI.btnGhost} shrink-0 text-xs!`}>이 이름으로 추가</button>
                    </div>
                  ))}
                </div>
              )}
              {heldNames.length > 0 && (
                <div className="mt-2">
                  <div className="text-[11px] font-black text-slate-500">확인필요 폴더의 파일(최대 10)</div>
                  <ul className="mt-0.5 space-y-0.5">
                    {heldNames.map((n) => <li key={n} className="truncate text-[11px] font-semibold text-slate-600" title={n}>{n}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* 방 추가(SQL) */}
          <div id="kakao-collect-add" className="border-t border-slate-100 px-4 py-3 lg:px-5">
            <div className="text-xs font-black text-slate-700">방 추가</div>
            <p className={`${UI.note("info")} mt-1.5`}>방 추가·수정은 아직 SQL 로 합니다(표 쓰기 권한 결정 대기). 아래에서 만든 한 줄을 복사해 Supabase SQL Editor 에서 실행하세요. 이미 있는 방은 바뀌지 않습니다.</p>
            <label className={`${UI.label} mt-2 block`}>방 이름 (카톡 방 제목 그대로)
              <input value={draft.room} onChange={(e) => setDraft({ ...draft, room: e.target.value })} placeholder="예: 완료방(납품,철수,교체)" className={`${UI.input} mt-1`} />
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className={UI.rowLabel}>처리</span>
              {COLLECT_KINDS.map((k) => {
                const on = draft.kinds.includes(k);
                return <button key={k} type="button" aria-pressed={on} onClick={() => setDraft({ ...draft, kinds: on ? draft.kinds.filter((x) => x !== k) : [...draft.kinds, k] })} className={UI.chip(on)}>{k}</button>;
              })}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className={UI.rowLabelInline}>지역</span>
              <PortalSelect width={110} value={draft.region} onChange={(next) => setDraft({ ...draft, region: next })}
                options={COLLECT_REGIONS.map((value) => ({ value, label: value === "*" ? "* 전 지역" : value }))} />
            </div>
            {draftProblem ? (
              <p className="mt-2 text-[11px] font-bold text-slate-400">{draftProblem}</p>
            ) : (
              <div className="mt-2">
                <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[11px] font-semibold text-slate-700">{sql}</pre>
                <button type="button" onClick={() => void copySql()} className={`${UI.btn} mt-2 text-xs!`}><Copy size={14} /> SQL 복사</button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
