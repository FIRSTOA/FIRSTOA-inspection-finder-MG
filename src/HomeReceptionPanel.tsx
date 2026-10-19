// 홈 관제 덱 "미처리 접수" 카드 감싸개. 표시는 HomeReceptionCard(윤화면 틀).
// 홈을 열 때 1번 + 5분마다 읽고, 숨은 탭에서는 쉰다. 누르면 서비스접수 탭(현황판이 맨 위).
import { useCallback, useEffect, useRef, useState } from "react";
import HomeReceptionCard from "./HomeReceptionCard";
import { fetchOpenReceptions } from "./deptReceptionApi";
import { summarizeForHome, toBoardRows, type HomeReceptionSummary } from "./receptionBoardData";
import { kstDate } from "./visits";

export default function HomeReceptionPanel({ onOpen }: { onOpen: () => void }) {
  const [summary, setSummary] = useState<HomeReceptionSummary | null>(null);
  const [error, setError] = useState("");
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const rows = toBoardRows(await fetchOpenReceptions(90));
      if (!alive.current) return;
      setSummary(summarizeForHome(rows, kstDate()));
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
  return (
    <HomeReceptionCard
      counts={summary?.counts ?? empty.counts}
      oldest={summary?.oldest ?? null}
      over7={summary?.over7}
      onClick={onOpen}
      loading={!summary && !error}
      error={error || undefined}
    />
  );
}
