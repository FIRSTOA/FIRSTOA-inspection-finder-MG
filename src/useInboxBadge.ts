import { useEffect, useState } from "react";
import { selectRows } from "./supabase";
import { useAuthorBook, useMembers } from "./authors";
import { makeIsForMe } from "./audience";

/**
 * 사이드바 배지용: 안 읽은 공지 + 나에게 온 대기 요청 + 내 요청 진행 소식.
 * 어느 화면에 있든 새 소식이 온 걸 알 수 있게 App 차원에서 가볍게 폴링하고,
 * 앱 안에서 공지·요청이 움직이면 pingInbox()로 즉시 다시 센다 (새로고침 불필요).
 */
export const INBOX_EVENT = "inbox-changed";

/** 공지·요청에 변화를 만든 직후 호출 — 배지·허브 숫자가 그 자리에서 갱신된다 */
export function pingInbox() {
  window.dispatchEvent(new Event(INBOX_EVENT));
}

export function useInboxBadge(author: string): number {
  const { book } = useAuthorBook();
  const members = useMembers();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    const isMine = makeIsForMe(author, members, book);
    const refresh = async () => {
      try {
        const [notices, myReads, waiting, updates] = await Promise.all([
          selectRows<{ id: string; target_type?: string; target?: string }>("notices", "select=id,target_type,target&order=created_at.desc&limit=300"),
          author ? selectRows<{ notice_id: string }>("notice_reads", `select=notice_id&reader=eq.${encodeURIComponent(author)}&limit=1000`) : Promise.resolve([]),
          selectRows<{ target_type?: string; target?: string; requester?: string }>("dept_requests", `select=target_type,target,requester&status=eq.${encodeURIComponent("대기")}&limit=500`),
          // 내가 올린 요청의 상태 변화(처리중·완료)를 아직 못 봄
          author ? selectRows<{ id: number }>("dept_requests", `select=id&requester_ack=eq.false&requester=ilike.${encodeURIComponent(`*${author}*`)}&limit=100`) : Promise.resolve([]),
        ]);
        if (!alive) return;
        const readSet = new Set(myReads.map((read) => read.notice_id));
        const unread = author ? notices.filter((notice) => isMine(notice) && !readSet.has(notice.id)).length : 0;
        const mineWaiting = waiting.filter((row) => isMine(row) && !(author && (row.requester || "").split(/\s+/).includes(author))).length;
        setCount(unread + mineWaiting + updates.length);
      } catch { /* 배지는 실패해도 조용히 */ }
    };
    void refresh();
    const timer = window.setInterval(refresh, 120_000);
    const onWake = () => { void refresh(); };
    window.addEventListener("focus", onWake);
    window.addEventListener(INBOX_EVENT, onWake);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", onWake);
      window.removeEventListener(INBOX_EVENT, onWake);
    };
  }, [author, members, book]);

  return count;
}
