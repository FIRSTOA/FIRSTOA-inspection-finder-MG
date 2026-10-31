/**
 * 자동 중간보고 띠 — 일정리스트 [📋 중간보고] 창 팀 칩 아래(2026-10-31).
 * "자동 발송 12:00 ✓ 배달 12:00:41 봇(테스트방) · 14:00 대기" + [마지막 발송 보기] + [지금 보내기](팀장·그 팀 명단, 10분 1회).
 * 그 팀이 SCHEDULE_REPORT_TEAMS 에 없으면, 표가 아직 없으면(SQL 전), 엣지가 아직 없으면(배포 전) 띠를 숨긴다.
 * 로직은 src/scheduleReportAuto.ts. 설계 docs/tasks/schedule-report-auto-2026-10-31.md 7절.
 */
import { useCallback, useEffect, useState } from "react";
import { askConfirm } from "./confirmModal";
import { notify } from "./toast";
import {
  bandSummary, callScheduleReport, canSendNow, isMissingEdgeError, isMissingTableError, kstHm, lastSentRow,
  loadAutoConfig, loadTodayLog, nowCooldownMs, reasonLabel,
  type DeliveryRow, type ScheduleReportAutoConfig, type ScheduleReportLogRow,
} from "./scheduleReportAuto";

type Loaded = {
  cfg: ScheduleReportAutoConfig & { room: string };
  rows: ScheduleReportLogRow[];
  deliveries: DeliveryRow[];
  pendingOutbox: string[];
  deliveryKnown: boolean;
};

const previewOf = (text: string, max = 14) => {
  const lines = text.split("\n");
  return lines.length > max ? [...lines.slice(0, max), `… (${lines.length - max}줄 더)`].join("\n") : text;
};

export default function ScheduleReportBand({ team, author, members, leaders }: { team: string; author: string; members: string[]; leaders: string[] }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [showLast, setShowLast] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const cfg = await loadAutoConfig(team);
      if (!cfg.teams.includes(team)) { setData(null); setHidden(true); return; }
      const log = await loadTodayLog(team);
      setData({ cfg, ...log });
      setHidden(false);
      setLoadError("");
    } catch (e) {
      if (isMissingTableError(e)) { setHidden(true); return; }   // SQL 실행 전 — 조용히 숨김
      setLoadError((e as Error).message || "자동 발송 기록을 읽지 못했습니다");
    }
  }, [team]);

  useEffect(() => { setShowLast(false); void load(); }, [load]);

  if (hidden) return null;
  if (!data) {
    return loadError
      ? <div className="border-b border-slate-100 bg-rose-50 px-4 py-1.5 text-[11px] font-semibold text-rose-600">자동 발송 기록을 읽지 못했습니다 — {loadError}</div>
      : null;
  }

  const { cfg, rows } = data;
  const last = lastSentRow(rows);
  const allowed = canSendNow(author, members, leaders);
  const roomLabel = !cfg.room ? "카톡방 매핑 없음(관리 탭 스케줄|" + team + ")"
    : cfg.test ? `→ ${cfg.testRoom}(시험 중 · 원래 ${cfg.room})` : `→ ${cfg.room}`;

  const sendNow = async () => {
    const left = nowCooldownMs(rows, Date.now());
    if (left > 0) { notify(`방금 보냈습니다 — ${Math.ceil(left / 60_000)}분 뒤에 다시 보낼 수 있습니다.`, "info"); return; }
    setBusy(true);
    try {
      const dry = await callScheduleReport({ slot: "now", team, dryRun: true, actor: author });
      if (!dry) { notify("자동 발송 서버가 결과를 돌려주지 않았습니다.", "error"); return; }
      if (dry.status !== "dry") { notify(`보낼 수 없습니다: ${reasonLabel(dry.reason || "") || dry.status}`, dry.status === "failed" ? "error" : "info"); return; }
      // dryRun 이 글은 만들었지만 일정 0건·방 매핑 없음이면 확인창 없이 이유만(검수아 2026-10-31 — 빈 본문으로 "지금 보냅니다"가 뜨던 것)
      if (dry.reason === "empty" || dry.reason === "no_room" || !(dry.text || "").trim()) { notify(`보낼 수 없습니다: ${reasonLabel(dry.reason || "") || "보낼 글이 없습니다"}`, "info"); return; }
      const target = dry.test ? `${dry.room || cfg.testRoom}(시험 중 · 원래 ${dry.realRoom || cfg.room})` : (dry.room || cfg.room);
      const ok = await askConfirm(`${target} 에 지금 보냅니다.\n\n${previewOf(dry.text || "")}`, { okLabel: "지금 보내기" });
      if (!ok) return;
      const sent = await callScheduleReport({ slot: "now", team, actor: author });
      if (sent?.status === "queued") notify(`${team}팀 중간보고를 보냈습니다${sent.test ? "(테스트방)" : ""} ✓`, "success");
      else notify(`보내지 않았습니다: ${reasonLabel(sent?.reason || "") || sent?.status || "응답 없음"}`, sent?.status === "failed" ? "error" : "info");
    } catch (e) {
      if (isMissingEdgeError(e)) { notify("자동 발송 서버(schedule-report)가 아직 배포되지 않았습니다.", "info"); setHidden(true); return; }
      notify(`지금 보내기 실패: ${(e as Error).message}`, "error");
    } finally {
      setBusy(false);
      void load();
    }
  };

  return (
    <div className="border-b border-slate-100 bg-blue-50/60 px-4 py-2 text-[11px] font-semibold">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`min-w-0 flex-1 basis-56 ${cfg.auto ? "text-slate-700" : "text-slate-400"}`}>
          {bandSummary(cfg, rows, data.deliveries, kstHm(), { pendingOutbox: data.pendingOutbox, deliveryKnown: data.deliveryKnown })}
        </span>
        {last && (
          <button type="button" onClick={() => setShowLast((v) => !v)} className="shrink-0 rounded-full bg-white px-2.5 py-1 font-black text-slate-600 ring-1 ring-slate-200">
            {showLast ? "접기" : "마지막 발송 보기"}
          </button>
        )}
        {allowed && (
          <button type="button" disabled={busy} onClick={() => void sendNow()}
            className="shrink-0 rounded-full bg-slate-900 px-2.5 py-1 font-black text-white disabled:opacity-40">{busy ? "만드는 중…" : "지금 보내기"}</button>
        )}
      </div>
      <div className={`mt-0.5 ${cfg.test ? "text-amber-600" : "text-slate-400"}`}>{cfg.auto ? "12:00·14:00 " : ""}{roomLabel}</div>
      {showLast && last && (
        <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-white px-3 py-2 font-mono text-[12px] font-normal leading-5 text-slate-700 ring-1 ring-slate-200">{last.text}</pre>
      )}
    </div>
  );
}

/** [복사] 위 안내 한 줄 — 그 팀 자동이 켜져 있을 때만. 설정을 못 읽으면 안 보인다(안내일 뿐, 복사는 그대로 된다) */
export function ScheduleReportCopyNote({ team }: { team: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    loadAutoConfig(team)
      .then((cfg) => { if (alive) setOn(cfg.auto && cfg.teams.includes(team)); })
      .catch(() => { if (alive) setOn(false); });
    return () => { alive = false; };
  }, [team]);
  if (!on) return null;
  return (
    <div className="shrink-0 border-t border-amber-100 bg-amber-50 px-4 py-1.5 text-[11px] font-semibold text-amber-700">
      12:00·14:00 은 자동으로도 나갑니다 — 붙여 넣으면 두 번 올라갈 수 있습니다(복사 기록이 있으면 그 차수는 자동이 건너뜀)
    </div>
  );
}
