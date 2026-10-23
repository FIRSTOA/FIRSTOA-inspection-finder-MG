// 홈 관제 덱 "미처리 접수" 카드 감싸개. 표시는 HomeReceptionCard(윤화면 틀).
// 홈을 열 때 1번 + 5분마다 읽고, 숨은 탭에서는 쉰다. 홈이 다른 화면 뒤에 숨어 있으면(KeepAlive) 멈추고, 다시 보이면 한 번 읽는다(2026-10-24 속도). 누르면 서비스접수 탭의 오른쪽 기둥이 "미처리 현황"으로 열린다.
// 물류 미처리(as_tickets 중 물류·납품철수교체휴가교육, 지난 날짜·완료 아님) 건수도 같이 읽어 카드에 넘긴다.
import { useCallback, useEffect, useRef, useState } from "react";
import HomeReceptionCard from "./HomeReceptionCard";
import { loadBoardData, loadScheduleOverdue, summarizeForHome, type HomeReceptionSummary } from "./receptionBoardData";
import { RECEPTION_RIGHT_KEY, SHOW_BOARD_EVENT } from "./receptionRightView";
import { kstDate } from "./visits";
import { useScreenActive } from "./screenActive";

export default function HomeReceptionPanel({ onOpen }: { onOpen: () => void }) {
  const [summary, setSummary] = useState<HomeReceptionSummary | null>(null);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const active = useScreenActive();

  const refresh = useCallback(async () => {
    try {
      const day = kstDate();
      // 현황판과 같은 재료(일정 완료된 복합기 AS 접수는 빼고 자가 치유) — 홈 숫자와 현황판 숫자가 어긋나지 않게
      const [board, logistics] = await Promise.all([loadBoardData(day), loadScheduleOverdue(day)]);
      if (!alive.current) return;
      setSummary(summarizeForHome(board.rows, day, logistics));
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

  const empty = summarizeForHome([], kstDate());
  // 서비스접수 화면이 이미 떠 있으면(KeepAlive) localStorage 를 다시 읽지 않으므로 이벤트도 같이 보낸다
  const open = () => {
    try { localStorage.setItem(RECEPTION_RIGHT_KEY, "board"); } catch { /* 저장 못 해도 이벤트로 연다 */ }
    window.dispatchEvent(new CustomEvent(SHOW_BOARD_EVENT));
    onOpen();
  };
  return (
    <HomeReceptionCard
      counts={summary?.counts ?? empty.counts}
      oldest={summary?.oldest ?? null}
      over7={summary?.over7}
      scheduleOverdue={summary?.scheduleOverdue}
      onClick={open}
      loading={!summary && !error}
      error={error || undefined}
    />
  );
}
