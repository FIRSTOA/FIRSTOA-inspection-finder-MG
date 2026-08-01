import { useEffect, useMemo, useState } from "react";
import { selectRows } from "./supabase";
import { AUTHOR_TEAMS, useAuthorBook } from "./authors";

/**
 * 사이드바 배지용: 안 읽은 공지 + 나에게 온 대기 요청 수.
 * 어느 화면에 있든 새 소식이 온 걸 알 수 있게 App 차원에서 가볍게 폴링한다.
 */
export function useInboxBadge(author: string): number {
  const { book } = useAuthorBook();
  const [count, setCount] = useState(0);
  const myTeam = useMemo(() => AUTHOR_TEAMS.find((team) => book[team]?.includes(author)) || "", [book, author]);

  useEffect(() => {
    let alive = true;
    const isMine = (row: { target_type?: string; target?: string }) => {
      const type = row.target_type || "전체";
      if (type === "전체") return true;
      if (type === "팀") return !!myTeam && row.target === myTeam;
      return !!author && row.target === author;
    };
    const refresh = async () => {
      try {
        const [notices, myReads, waiting] = await Promise.all([
          selectRows<{ id: string; target_type?: string; target?: string }>("notices", "select=id,target_type,target&order=created_at.desc&limit=300"),
          author ? selectRows<{ notice_id: string }>("notice_reads", `select=notice_id&reader=eq.${encodeURIComponent(author)}&limit=1000`) : Promise.resolve([]),
          selectRows<{ target_type?: string; target?: string }>("dept_requests", `select=target_type,target&status=eq.${encodeURIComponent("대기")}&limit=500`),
        ]);
        if (!alive) return;
        const readSet = new Set(myReads.map((read) => read.notice_id));
        const unread = author ? notices.filter((notice) => isMine(notice) && !readSet.has(notice.id)).length : 0;
        const mineWaiting = waiting.filter(isMine).length;
        setCount(unread + mineWaiting);
      } catch { /* 배지는 실패해도 조용히 */ }
    };
    void refresh();
    const timer = window.setInterval(refresh, 120_000);
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [author, myTeam]);

  return count;
}
