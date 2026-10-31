import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { UI } from "./ui/card";
import StateBox from "./ui/StateBox";
import PortalSelect from "./PortalSelect";
import { askConfirm } from "./confirmModal";
import { notify } from "./toast";
import { invokeEdgeFunction, selectRows, updateRows } from "./supabase";
import {
  KIND_LABEL, REVIEW_KIND_LABEL, WORK_STATUS_LABEL, actorName, dryRows, kstShort, nextPullKst, pullSummary, reviewSummary, scopeOptions,
  type PullResponse, type ReviewRow, type SyncStatus, type SyncWorkRow,
} from "./workinSync";

/**
 * 관리 › 전송·연동 › 기타 설정 › [워킨맵 동기화] 카드 (2026-10-31, 설계 docs/tasks/workinmap-sync-2026-10-31.md v2 P1-4).
 * 상태(계정·워크·다음 예정) · [로그인 시험]·[워크 목록 갱신]·[미리보기]·[지금 동기화] · 확인 큐 [처리됨].
 * 서버 일은 전부 엣지 workinmap-sync(비밀값은 엣지 secrets, 이 화면엔 없음). 표 쓰기는 SQL 이 anon 에 연 열만
 * (workin_sync_works.override_skip/override_by · workin_sync_review.resolved_at/resolved_by/resolution).
 */

const HEAD_BLOCK = "border-b border-slate-100 bg-slate-50 px-4 py-3 lg:px-5";
const FN = "workinmap-sync";
const REVIEW_COLS = "id,kind,field,place_id,ext_id,account_no,work_id,detail,created_at";
type Busy = "" | "status" | "works" | "dry" | "pull" | `login${number}` | `skip:${string}` | `review:${number}`;

export type WorkinSyncInitial = {
  status?: SyncStatus | null;
  reviews?: ReviewRow[];
  configEnabled?: boolean | null;
  dry?: PullResponse | null;
};

const who = () => actorName(typeof window !== "undefined" ? window.localStorage.getItem("firstoa.author") : "");

/** 미리보기·동기화 결과 표(워크별 짝 수·새 장소·바뀔 곳·색 검증·가드 사유) */
export function WorkinDryTable({ res }: { res: PullResponse }) {
  const rows = dryRows(res.results);
  return (
    <div className="border-b border-slate-100">
      <div className="px-4 py-2.5 text-[12px] font-black tabular-nums text-slate-800 lg:px-5">{pullSummary(res)}</div>
      {res.note && <div className={`${UI.note("info")} mx-3 mb-2 lg:mx-4`}>{res.note}</div>}
      {(res.accountErrors || []).map((a) => <div key={a.account} role="alert" className={`${UI.note("bad")} mx-3 mb-2 lg:mx-4`}>계정{a.account}: {a.error}</div>)}
      {(res.warnings || []).map((w) => <div key={w} className={`${UI.note("warn")} mx-3 mb-2 lg:mx-4`}>{w}</div>)}
      {rows.length === 0 ? <StateBox inside kind="empty" message="고른 범위에 대상 워크가 없습니다." hint="워크 목록 갱신 뒤 다시 보세요." /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[11px] font-bold tabular-nums text-slate-700">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2">워크</th><th className="px-2 py-2">결과</th><th className="px-2 py-2 text-right">워킨맵</th>
                <th className="px-2 py-2 text-right">짝</th><th className="px-2 py-2 text-right">새 장소</th><th className="px-2 py-2 text-right">바뀔 곳</th>
                <th className="px-2 py-2 text-right">색·메모</th><th className="px-3 py-2">색 검증 · 사유</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100" data-testid="workin-dry-rows">
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="max-w-[180px] truncate px-3 py-2 text-slate-900" title={r.name}>{r.name}<span className="ml-1 text-slate-400">계정{r.account}</span></td>
                  <td className="px-2 py-2"><span className={`${UI.badge} ${UI.tone[r.tone]}`}>{r.result}</span></td>
                  <td className="px-2 py-2 text-right">{r.remote ?? "-"}</td>
                  <td className="px-2 py-2 text-right">{r.matched ?? "-"}</td>
                  <td className="px-2 py-2 text-right">{r.fresh ?? "-"}</td>
                  <td className="px-2 py-2 text-right">{r.changed ?? "-"}</td>
                  <td className="px-2 py-2 text-right">{r.labelChanges ?? "-"}·{r.memoAdds ?? "-"}</td>
                  <td className="px-3 py-2">
                    {r.color && <div className="text-slate-500">{r.color}</div>}
                    {r.reason && <div className={r.tone === "bad" ? "text-rose-600" : "text-amber-700"}>{r.reason}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(res.unparsed || []).length > 0 && (
        <div className="px-4 py-2 text-[11px] font-semibold text-slate-500 lg:px-5">이름 규칙 밖 워크 {res.unparsed?.length}개: {res.unparsed?.map((u) => u.name).join(", ")}</div>
      )}
    </div>
  );
}

export default function WorkinSyncAdmin({ initial }: { initial?: WorkinSyncInitial }) {
  const [status, setStatus] = useState<SyncStatus | null>(initial?.status ?? null);
  const [statusError, setStatusError] = useState("");
  const [reviews, setReviews] = useState<ReviewRow[]>(initial?.reviews ?? []);
  const [reviewError, setReviewError] = useState("");
  const [configEnabled, setConfigEnabled] = useState<boolean | null>(initial?.configEnabled ?? null);
  const [loading, setLoading] = useState(!initial);
  const [busy, setBusy] = useState<Busy>("");
  const [scope, setScope] = useState("current");
  const [dry, setDry] = useState<PullResponse | null>(initial?.dry ?? null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [st, rv, cfg] = await Promise.allSettled([
      invokeEdgeFunction<SyncStatus>(FN, { action: "status" }, 45_000),
      selectRows<ReviewRow>("workin_sync_review", `select=${REVIEW_COLS}&resolved_at=is.null&order=id.desc&limit=200`),
      selectRows<{ key: string; value: string }>("app_config", "select=key,value&key=eq.WORKINMAP_SYNC_ENABLED"),
    ]);
    if (st.status === "fulfilled") { setStatus(st.value); setStatusError(""); }
    else setStatusError(st.reason instanceof Error ? st.reason.message : String(st.reason));
    if (rv.status === "fulfilled") { setReviews(rv.value); setReviewError(""); }
    else setReviewError(rv.reason instanceof Error ? rv.reason.message : String(rv.reason));
    if (cfg.status === "fulfilled") setConfigEnabled(String(cfg.value[0]?.value ?? "").trim().toLowerCase() === "true");
    setLoading(false);
  }, []);
  useEffect(() => { if (!initial) void load(); }, [initial, load]);

  // 스위치 상태: 엣지 status 가 정답, 엣지가 안 되면 app_config 를 직접 읽은 값
  const enabled = status ? status.enabled : configEnabled === true;
  const accountNos = useMemo(() => {
    const set = new Set<number>([...(status?.accountsConfigured || []), ...(status?.accounts || []).map((a) => Number(a.account_no))]);
    return [...set].filter((n) => n >= 1 && n <= 9).sort((a, b) => a - b);
  }, [status]);
  const works = useMemo(() => status?.works || [], [status]);
  const options = useMemo(() => scopeOptions(works), [works]);
  const openTotal = Object.values(status?.openReviews || {}).reduce((a, b) => a + b, 0);

  const fail = (what: string, e: unknown) => {
    const text = `${what} 실패: ${e instanceof Error ? e.message : String(e)}`;
    setResult({ ok: false, text });
    notify(text, "error");
  };

  const loginTest = async (n: number) => {
    setBusy(`login${n}`); setResult(null);
    try {
      const r = await invokeEdgeFunction<{ ok: boolean; via?: string; error?: string; paused?: boolean }>(FN, { action: "login_test", account: n }, 60_000);
      const text = r.ok ? `계정${n} 로그인 성공(${r.via || "ok"})` : `계정${n} 로그인 실패: ${r.error || "-"}${r.paused ? " · 멈춤 상태" : ""}`;
      setResult({ ok: r.ok, text }); notify(text, r.ok ? "success" : "error");
      void load();
    } catch (e) { fail(`계정${n} 로그인 시험`, e); }
    finally { setBusy(""); }
  };

  const refreshWorks = async () => {
    setBusy("works"); setResult(null);
    try {
      const r = await invokeEdgeFunction<{ ok: boolean; works?: unknown[]; accountErrors?: Array<{ account: number; error: string }>; warnings?: string[]; saveError?: string }>(FN, { action: "works" }, 90_000);
      const errs = (r.accountErrors || []).map((a) => `계정${a.account}: ${a.error}`);
      if (r.saveError) errs.push(`저장: ${r.saveError}`);
      const text = errs.length ? `워크 목록 일부 실패 — ${errs.join(" / ")}` : `워크 목록 ${r.works?.length ?? 0}개를 갱신했습니다.`;
      setResult({ ok: !errs.length, text }); notify(text, errs.length ? "error" : "success");
      void load();
    } catch (e) { fail("워크 목록 갱신", e); }
    finally { setBusy(""); }
  };

  const runPull = async (dryRun: boolean) => {
    if (!dryRun) {
      if (!enabled) { notify("WORKINMAP_SYNC_ENABLED 스위치가 꺼져 있어 쓰지 않습니다. 미리보기만 됩니다.", "error"); return; }
      const label = options.find((o) => o.value === scope)?.label || scope;
      const ok = await askConfirm(`워킨맵 → 웹앱 쓰기 시작합니다.\n범위: ${label}\n바뀐 칸은 workin_sync_log 에 전/후가 남습니다. 계속할까요?`, { danger: true, okLabel: "쓰기 시작" });
      if (!ok) return;
    }
    setBusy(dryRun ? "dry" : "pull"); setResult(null);
    try {
      const r = await invokeEdgeFunction<PullResponse>(FN, { action: "pull", scope, dryRun, manual: true }, 150_000);
      setDry(r);
      if (r.ok === false) notify(`${dryRun ? "미리보기" : "동기화"}: 중단·오류가 있는 워크가 있습니다. 표의 사유를 보세요.`, "error");
      else notify(pullSummary(r), "success");
      if (!dryRun) void load();
    } catch (e) { fail(dryRun ? "미리보기" : "동기화", e); }
    finally { setBusy(""); }
  };

  const toggleSkip = async (w: SyncWorkRow) => {
    setBusy(`skip:${w.work_id}`);
    try {
      await updateRows("workin_sync_works", `account_no=eq.${w.account_no}&work_id=eq.${encodeURIComponent(w.work_id)}`, { override_skip: !w.override_skip, override_by: who() });
      setStatus((s) => s && { ...s, works: s.works.map((x) => x.account_no === w.account_no && x.work_id === w.work_id ? { ...x, override_skip: !w.override_skip } : x) });
    } catch (e) { fail("건너뛰기 저장", e); }
    finally { setBusy(""); }
  };

  const resolve = async (r: ReviewRow, resolution: "ignored" | "applied") => {
    setBusy(`review:${r.id}`);
    try {
      await updateRows("workin_sync_review", `id=eq.${r.id}&resolved_at=is.null`, { resolved_at: new Date().toISOString(), resolved_by: who(), resolution });
      setReviews((cur) => cur.filter((x) => x.id !== r.id));
    } catch (e) { fail("확인 큐 처리", e); }
    finally { setBusy(""); }
  };

  const workName = (id: string | null) => works.find((w) => w.work_id === id)?.name || id || "-";

  return (
    <section className={UI.card}>
      <div className={`${HEAD_BLOCK} flex flex-wrap items-start justify-between gap-2`}>
        <div className="min-w-0">
          <h3 className={UI.title}>워킨맵 동기화</h3>
          <p className={UI.desc}>예전 워킨맵(workinmap.com)의 색·메모를 웹앱 워킨맵으로 가져옵니다. 계정 비밀번호는 서버(엣지 secrets)에만 있고 이 화면엔 없습니다.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} aria-label="워킨맵 동기화 새로고침" className={UI.btnIcon}>
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {loading && !status && <StateBox inside kind="loading" message="동기화 상태를 불러오는 중입니다…" />}
      {statusError && (
        <div role="alert" className={`${UI.note("bad")} m-3 lg:mx-4`}>
          상태 조회 실패: {statusError}
          <div className="mt-1 font-semibold">처음이면 순서대로: supabase/workin-sync-20261031.sql 실행 → 엣지 workinmap-sync 배포 → secrets WORKINMAP_1/2_EMAIL·PASSWORD.</div>
        </div>
      )}

      {/* 머리 한 줄: 스위치·다음 예정·확인 큐 */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-4 py-3 text-[12px] font-black tabular-nums text-slate-800 lg:px-5">
        <span className={`${UI.badge} ${enabled ? UI.tone.ok : UI.tone.off}`}>자동 가져오기 {enabled ? "켜짐" : "꺼짐"}</span>
        <span>{enabled ? `다음 예정 ${nextPullKst()} (매일 09·12·15·18시)` : "스위치가 꺼져 있어 자동 실행 없음 — 미리보기만 됩니다"}</span>
        {openTotal > 0 && <span className={`${UI.badge} ${UI.tone.warn}`}>{`확인 필요 ${openTotal}`}</span>}
      </div>

      {/* 계정 */}
      <div className="space-y-1.5 border-b border-slate-100 px-4 py-3 lg:px-5">
        <div className="text-[11px] font-black text-slate-500">계정</div>
        {status && accountNos.length === 0 && <div className={UI.note("warn")}>설정된 계정이 없습니다 — Supabase 대시보드 Edge Functions › Secrets 에 WORKINMAP_1_EMAIL·WORKINMAP_1_PASSWORD 를 넣으세요.</div>}
        {accountNos.map((n) => {
          const a = status?.accounts.find((x) => Number(x.account_no) === n);
          const configured = status?.accountsConfigured.includes(n) ?? false;
          return (
            <div key={n} className="flex flex-wrap items-center gap-1.5">
              <span className="text-[13px] font-black text-slate-800">{a?.label || `계정${n}`}</span>
              <span className={`${UI.badge} ${configured ? UI.tone.ok : UI.tone.bad}`}>{configured ? "secrets 있음" : "secrets 없음"}</span>
              {a?.paused && <span className={`${UI.badge} ${UI.tone.bad}`}>{`멈춤(로그인 ${a.fail_count ?? 0}회 실패)`}</span>}
              <span className="text-[11px] font-semibold text-slate-500">마지막 성공 {kstShort(a?.last_ok_at)}</span>
              {a?.last_error && <span className="min-w-0 truncate text-[11px] font-semibold text-rose-600" title={a.last_error}>{a.last_error.slice(0, 60)}</span>}
              <button type="button" disabled={!!busy || !configured} onClick={() => void loginTest(n)} className={`${UI.btnGhost} ml-auto text-xs!`}>
                {busy === `login${n}` ? "시험 중…" : a?.paused ? "다시 시도" : "로그인 시험"}
              </button>
            </div>
          );
        })}
      </div>

      {/* 동작 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 lg:px-5">
        <button type="button" disabled={!!busy || !status} onClick={() => void refreshWorks()} className={`${UI.btnGhost} text-xs!`}>
          {busy === "works" ? "목록 받는 중…" : "워크 목록 갱신"}
        </button>
        <PortalSelect direction="down" className="py-1.5 text-xs font-bold" width={240} value={scope} onChange={setScope} options={options} disabled={!!busy} />
        <button type="button" disabled={!!busy || !status} onClick={() => void runPull(true)} className={`${UI.btnGhost} text-xs!`}>
          {busy === "dry" ? "계산 중…" : "미리보기(dry)"}
        </button>
        <button type="button" aria-label="지금 동기화" disabled={!!busy || !status || !enabled} onClick={() => void runPull(false)} className={`${UI.btn} text-xs!`}>
          {busy === "pull" ? "쓰는 중… (몇 분 걸릴 수 있음)" : "지금 동기화"}
        </button>
        {!enabled && <p className="w-full text-[11px] font-semibold text-slate-500">[지금 동기화]는 전송 스위치 WORKINMAP_SYNC_ENABLED 를 켠 뒤에 됩니다. 먼저 워크 하나씩 미리보기로 짝·색을 확인하세요.</p>}
      </div>
      {result && <div role={result.ok ? "status" : "alert"} className={`${UI.note(result.ok ? "ok" : "bad")} m-3 lg:mx-4`}>{result.text}</div>}
      {dry && <WorkinDryTable res={dry} />}

      {/* 워크 표 */}
      <div className="border-b border-slate-100">
        <div className="px-4 pt-3 text-[11px] font-black text-slate-500 lg:px-5">워크 {works.length}개</div>
        {status && works.length === 0 && <StateBox inside kind="empty" message="받아 온 워크가 없습니다." hint="[워크 목록 갱신]을 누르세요." />}
        {works.length > 0 && (
          <div className="overflow-x-auto">
            <table className="mt-1 w-full min-w-[640px] text-left text-[11px] font-bold tabular-nums text-slate-700">
              <thead className="bg-slate-50 text-slate-500">
                <tr><th className="px-3 py-2">이름</th><th className="px-2 py-2">계정</th><th className="px-2 py-2">범위</th><th className="px-2 py-2 text-right">장소</th><th className="px-2 py-2">상태</th><th className="px-2 py-2">마지막 가져옴</th><th className="px-3 py-2">건너뛰기</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {works.map((w) => (
                  <tr key={`${w.account_no}|${w.work_id}`}>
                    <td className="max-w-[200px] px-3 py-2 text-slate-900">
                      <div className="truncate" title={w.name}>{w.name}</div>
                      {w.last_error && <div className="truncate text-rose-600" title={w.last_error}>{w.last_error.slice(0, 60)}</div>}
                    </td>
                    <td className="px-2 py-2">{w.account_no}</td>
                    <td className="whitespace-nowrap px-2 py-2">{w.team ? `${w.team}팀 ${w.year ?? ""}년 ${w.quarter ?? ""}Q ${KIND_LABEL[w.kind || ""] || w.kind || ""}` : "-"}</td>
                    <td className={`px-2 py-2 text-right ${w.place_count >= 950 ? "text-amber-600" : ""}`}>{w.place_count}</td>
                    <td className="px-2 py-2"><span className={`${UI.badge} ${w.status === "target" ? UI.tone.ok : w.status === "unparsed" ? UI.tone.warn : UI.tone.off}`}>{WORK_STATUS_LABEL[w.status] || w.status}</span></td>
                    <td className="whitespace-nowrap px-2 py-2">{kstShort(w.last_pulled_at)}{!w.first_pulled_at && w.status === "target" ? <span className="ml-1 text-slate-400">첫 회차 전</span> : null}</td>
                    <td className="px-3 py-2">
                      <button type="button" disabled={!!busy} aria-pressed={w.override_skip} onClick={() => void toggleSkip(w)}
                        className={`${UI.chip(w.override_skip)} text-[11px]!`}>{busy === `skip:${w.work_id}` ? "저장 중…" : w.override_skip ? "건너뜀" : "가져옴"}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 확인 큐 */}
      <div className="px-4 py-3 lg:px-5">
        <div className="text-xs font-black text-slate-700">확인 큐 {reviews.length}</div>
        <p className={UI.desc}>자동으로 반영하지 않은 것(짝 없음·후보 여럿·완료 내려감·사라짐 등)입니다. 웹앱 워킨맵에서 직접 맞춘 뒤 [반영함], 그대로 두려면 [무시]를 누르세요.</p>
        {reviewError && <div role="alert" className={`${UI.note("bad")} mt-2`}>확인 큐 조회 실패: {reviewError}</div>}
        {!reviewError && reviews.length === 0 && !loading && <div className="mt-2 text-[11px] font-semibold text-slate-400">미처리 건이 없습니다.</div>}
        <div className="mt-2 divide-y divide-slate-100">
          {reviews.map((r) => (
            <div key={r.id} className="flex flex-wrap items-start gap-2 py-2">
              <span className={`${UI.badge} ${UI.tone.warn}`}>{REVIEW_KIND_LABEL[r.kind] || r.kind}{r.field ? ` · ${r.field}` : ""}</span>
              <span className="min-w-0 flex-1 text-[11px] font-semibold text-slate-600">
                <span className="block truncate font-black text-slate-800">{workName(r.work_id)}{r.place_id ? ` · 장소 ${r.place_id}` : ""}</span>
                <span className="block break-all">{reviewSummary(r.detail)}</span>
                <span className="block text-slate-400">{kstShort(r.created_at)}</span>
              </span>
              <span className="flex shrink-0 gap-1.5">
                <button type="button" disabled={!!busy} onClick={() => void resolve(r, "applied")} className={`${UI.btnGhost} text-xs!`}>반영함</button>
                <button type="button" disabled={!!busy} onClick={() => void resolve(r, "ignored")} className={`${UI.btnGhost} text-xs!`}>무시</button>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
