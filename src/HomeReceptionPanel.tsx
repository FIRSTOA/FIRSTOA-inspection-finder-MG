// 홈 "미처리 전체" 카드(2026-10-24 개편 ④ — 사용자 5·6). 큰 숫자 = 접수 미처리 + 물류 미처리 + 재계약 확인 지남.
//  · 접수 = 서비스접수 현황판과 같은 재료(loadBoardData → summarizeForHome, 일정 완료된 복합기 AS 접수는 빼고 자가 치유) — 이 카드가 읽는다
//  · 물류 = 홈 '미처리 일정' 칸과 같은 함수(homeUnhandled.splitByGroup), 재계약 확인 지남 = kpiCompute.recontractOverdue — 현황판 묶음(bundle)에서 받는다
//  · 합산·표시 모양은 homeKpiModel.unhandledTotalView, 그리는 건 KpiWidget(unhandledTotal, 윤화면)
// 홈을 열 때 1번 + 5분마다 읽고, 숨은 탭·다른 화면 뒤(KeepAlive)에서는 쉰다. 누르면 서비스접수 탭의 오른쪽 기둥이 "미처리 현황"으로 열린다.
import { useCallback, useEffect, useRef, useState } from "react";
import { loadBoardData, summarizeForHome, type HomeReceptionSummary } from "./receptionBoardData";
import { RECEPTION_RIGHT_KEY, SHOW_BOARD_EVENT } from "./receptionRightView";
import { RECEPTION_TYPES } from "./ReceptionTypePicker";
import { kstDate } from "./visits";
import { useScreenActive } from "./screenActive";
import { KpiWidget, type KpiLoadStatus, type KpiSize } from "./kpi/KpiWidgets.view";
import type { KpiBundle } from "./kpi/kpiData";
import { UNHANDLED_TOTAL_DEFS, unhandledParts, unhandledTotalView } from "./kpi/homeKpiModel";

type Props = { onOpen: () => void; bundle?: KpiBundle | null; size?: KpiSize; disabled?: boolean };

export default function HomeReceptionPanel({ onOpen, bundle = null, size, disabled }: Props) {
  const [summary, setSummary] = useState<HomeReceptionSummary | null>(null);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const active = useScreenActive();

  const refresh = useCallback(async () => {
    try {
      const day = kstDate();
      const board = await loadBoardData(day);
      if (!alive.current) return;
      setSummary(summarizeForHome(board.rows, day));
      setError("");
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (!active) return; // 다른 화면이 떠 있으면(KeepAlive 숨김) 쉰다
    alive.current = true;
    const first = window.setTimeout(() => { void refresh(); }, 0);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 300_000);
    return () => { alive.current = false; window.clearTimeout(first); window.clearInterval(timer); };
  }, [refresh, active]);

  // 서비스접수 화면이 이미 떠 있으면(KeepAlive) localStorage 를 다시 읽지 않으므로 이벤트도 같이 보낸다
  const open = () => {
    try { localStorage.setItem(RECEPTION_RIGHT_KEY, "board"); } catch { /* 저장 못 해도 이벤트로 연다 */ }
    window.dispatchEvent(new CustomEvent(SHOW_BOARD_EVENT));
    onOpen();
  };

  const parts = unhandledParts(bundle);
  const failed = (st: { status: string } | undefined) => st?.status === "error" || st?.status === "missing";
  const srcError = bundle?.sources.unhandled && failed(bundle.sources.unhandled) ? bundle.sources.unhandled : undefined;
  // 접수·물류가 있으면 그린다. 재계약(무거운 원본 — 첫 로드 2단계)은 오면 합계에 더하고, 오기 전·실패면 0 으로 더하지 않고 "—"
  const recontractState: "loading" | "error" = failed(bundle?.sources.recontract) ? "error" : "loading";
  const ready = summary && parts.logistics !== null;
  const view = ready ? unhandledTotalView({
    reception: RECEPTION_TYPES.reduce((n, m) => n + (summary.counts[m.type] ?? 0), 0),
    logistics: parts.logistics!, recontract: parts.recontract, recontractState,
    breakdown: RECEPTION_TYPES.map((m) => ({ label: m.label, value: summary.counts[m.type] ?? 0, tone: (summary.counts[m.type] ?? 0) > 0 ? "warn" : "idle" })),
    oldest: summary.oldest ? `${summary.oldest.vendor || "업체 미정"} (${summary.oldest.days}일)` : undefined, // 위젯이 "가장 오래된 건 · " 를 붙인다
  }) : undefined;
  const errorText = error ? `접수 미처리를 불러오지 못했습니다 — ${error}`
    : !ready && srcError && "error" in srcError ? `물류 미처리를 불러오지 못했습니다 — ${srcError.error}` : "";
  const status: KpiLoadStatus = errorText ? "error" : view ? "ready" : "loading";

  return (
    <KpiWidget
      kind="unhandledTotal"
      title="미처리 전체"
      basis={UNHANDLED_TOTAL_DEFS.map((d) => `${d.label}: ${d.text}`).join(" / ")}
      status={status}
      view={view}
      size={size}
      theme="deck"
      errorText={errorText || undefined}
      onRetry={() => { void refresh(); }}
      onOpen={open}
      openLabel="미처리 현황"
      disabled={disabled}
    />
  );
}
