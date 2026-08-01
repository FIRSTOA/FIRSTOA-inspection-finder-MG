import { useEffect, useMemo, useState } from "react";
import { selectRows } from "./supabase";
import { AUTHOR_TEAMS, useAuthorBook } from "./authors";
import NoticeBoard from "./NoticeBoard";
import DeptRequests from "./DeptRequests";

/**
 * 공지·요청 허브 — "사람이 나에게 보낸 것"을 한 지붕 아래.
 * 공지 = 읽으면 끝, 요청 = 처리해야 끝이라 탭으로 가른다 (한 목록에 섞지 않는다).
 * 다크 상태줄이 두 탭의 "나에게 온" 숫자를 항상 보여준다.
 */
type Tab = "notice" | "request";

export default function InboxHub({ author }: { author: string }) {
  const { book } = useAuthorBook();
  const [tab, setTab] = useState<Tab>(() => (window.localStorage.getItem("cs_inbox_tab_v1") as Tab) === "request" ? "request" : "notice");
  const [unreadNotices, setUnreadNotices] = useState<number | null>(null);
  const [myWaiting, setMyWaiting] = useState<number | null>(null);
  const [myUpdates, setMyUpdates] = useState<number>(0);

  useEffect(() => { window.localStorage.setItem("cs_inbox_tab_v1", tab); }, [tab]);

  const myTeam = useMemo(() => AUTHOR_TEAMS.find((team) => book[team]?.includes(author)) || "", [book, author]);

  // 요청 대기 수 (내 것 기준) — 상태줄용 가벼운 집계
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const rows = await selectRows<{ status: string; target_type?: string; target?: string }>(
          "dept_requests", "select=status,target_type,target&status=eq.%EB%8C%80%EA%B8%B0&limit=500");
        if (!alive) return;
        const mine = rows.filter((row) => {
          const type = row.target_type || "전체";
          if (type === "전체") return true;
          if (type === "팀") return !!myTeam && row.target === myTeam;
          return !!author && row.target === author;
        });
        setMyWaiting(mine.length);
        if (author) {
          const updates = await selectRows<{ id: number }>("dept_requests", `select=id&requester_ack=eq.false&requester=ilike.${encodeURIComponent(`*${author}*`)}&limit=100`);
          if (alive) setMyUpdates(updates.length);
        }
      } catch { /* 집계 실패해도 화면은 동작 */ }
    })();
    return () => { alive = false; };
  }, [tab, myTeam, author]);

  const chip = (label: string, value: number | null, warn: boolean, go: Tab) => (
    <button type="button" onClick={() => setTab(go)}
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold transition ${warn ? "bg-rose-400/15 text-rose-300 hover:bg-rose-400/25" : "bg-white/[0.07] text-slate-400 hover:bg-white/[0.14] hover:text-slate-200"}`}>
      {label} <b className={`tabular-nums ${warn ? "" : "text-white"}`}>{value ?? "…"}건</b>
    </button>
  );

  return (
    <div className="space-y-4 pb-16">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 bg-[#151A23] px-4 py-2.5">
          {chip("안 읽은 공지", unreadNotices, (unreadNotices ?? 0) > 0, "notice")}
          {chip("내 대기 요청", myWaiting, (myWaiting ?? 0) > 0, "request")}
          {myUpdates > 0 && chip("내 요청 진행 소식", myUpdates, true, "request")}
          <span className="ml-auto text-[11px] font-semibold text-slate-500">{author ? `${author}${myTeam ? ` · ${myTeam}팀` : ""} 기준` : "작성자를 선택하면 내 것만 골라 보여줍니다"}</span>
        </div>
        <div className="flex overflow-x-auto">
          {([["notice", "공지사항"], ["request", "부서 요청"]] as Array<[Tab, string]>).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`relative shrink-0 whitespace-nowrap px-5 py-3.5 text-sm font-black transition ${tab === key ? "text-slate-950 after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:bg-blue-600" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"}`}>
              {label}
              {key === "notice" && (unreadNotices ?? 0) > 0 && <span className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[11px] tabular-nums text-white">{unreadNotices}</span>}
              {key === "request" && (myWaiting ?? 0) > 0 && <span className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[11px] tabular-nums text-white">{myWaiting}</span>}
            </button>
          ))}
        </div>
      </section>

      {/* 공지 탭은 항상 마운트 — 안 읽은 수를 상태줄에 계속 공급 (요청 탭일 땐 숨김) */}
      <div className={tab === "notice" ? "" : "hidden"}>
        <NoticeBoard author={author} onUnreadChange={setUnreadNotices} />
      </div>
      {tab === "request" && <DeptRequests author={author} embedded />}
    </div>
  );
}
