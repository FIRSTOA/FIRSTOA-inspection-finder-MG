// 홈 관제 덱 "미처리 접수" 카드 감싸개. 표시는 HomeReceptionCard(윤화면 틀).
// 홈을 열 때 1번 + 5분마다 읽고, 숨은 탭에서는 쉰다. 누르면 서비스접수 탭의 오른쪽 기둥이 "미처리 현황"으로 열린다.
// 일정 미처리(as_tickets, OverduePanel 과 같은 규칙) 건수도 같이 읽어 카드에 넘긴다.
import { useCallback, useEffect, useRef, useState } from "react";
import HomeReceptionCard from "./HomeReceptionCard";
import { fetchOpenReceptions } from "./deptReceptionApi";
import { loadScheduleOverdue, summarizeForHome, toBoardRows, type HomeReceptionSummary } from "./receptionBoardData";
import { RECEPTION_RIGHT_KEY, SHOW_BOARD_EVENT } from "./receptionRightView";
import { kstDate } from "./visits";

export default function HomeReceptionPanel({ onOpen }: { onOpen: () => void }) {
  const [summary, setSummary] = useState<HomeReceptionSummary | null>(null);
  const [error, setError] = useState("");
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const day = kstDate();
      const [open, schedule] = await Promise.all([fetchOpenReceptions(90), loadScheduleOverdue(day)]);
      if (!alive.current) return;
      setSummary(summarizeForHome(toBoardRows(open), day, schedule));
      setError("");
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    const first = window.setTimeout(() => { void refresh(); }, 0);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 300_000);
    return () => { alive.current = false; window.clearTimeout(first); window.clearInterval(timer); };
  }, [refresh]);

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
