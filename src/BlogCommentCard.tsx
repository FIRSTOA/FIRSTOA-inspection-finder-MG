import { useEffect, useMemo, useState } from "react";
import { fetchMembers } from "./authors";
import { BLOG_BASIS_TEXT, BLOG_SHEET_URL, blogPeriods, blogTeamOf, countBlog, fetchBlogRows, type BlogRow } from "./blogSheet";
import { kstDate } from "./visits";

/** 주간현황판 — 블로그 댓글 칸(이번 주·이번 달 건수, 사람별 펼침). 시트를 못 읽으면 0이 아니라 안내를 보인다 */
export default function BlogCommentCard() {
  const [rows, setRows] = useState<BlogRow[] | null>(null);
  const [error, setError] = useState("");
  const [teams, setTeams] = useState<Map<string, string>>(new Map());
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"week" | "month">("week");

  useEffect(() => {
    let active = true;
    fetchBlogRows()
      .then((r) => { if (active) { setRows(r); setError(""); } })
      .catch((e) => { if (active) setError((e as Error).message); });
    // 명단을 못 읽으면 팀은 부서명 그대로 보인다(건수에는 영향 없음)
    fetchMembers()
      .then((list) => { if (active) setTeams(new Map(list.filter((m) => m.active).map((m) => [m.name, m.team]))); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const periods = useMemo(() => blogPeriods(kstDate()), []);
  const week = useMemo(() => (rows ? countBlog(rows, periods.week) : null), [rows, periods]);
  const month = useMemo(() => (rows ? countBlog(rows, periods.month) : null), [rows, periods]);
  const shown = scope === "week" ? week : month;

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
        <h3 className="text-sm font-black text-slate-950 lg:text-[15px]">블로그 댓글</h3>
        <a href={BLOG_SHEET_URL} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-blue-600">시트 열기</a>
      </div>
      {error ? (
        <div className="p-4 text-sm font-semibold text-rose-700">시트를 못 읽음 — {error}</div>
      ) : !rows || !week || !month || !shown ? (
        <div className="p-4 text-sm font-semibold text-slate-400">블로그 시트를 불러오는 중…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 divide-x divide-slate-100">
            {([["week", "이번 주", week], ["month", "이번 달", month]] as const).map(([key, label, c]) => (
              <button key={key} type="button" onClick={() => { setScope(key); setOpen(true); }} className={`px-4 py-3 text-left hover:bg-slate-50 ${scope === key ? "bg-blue-50" : ""}`}>
                <div className="text-[11px] font-bold text-slate-400">{label}</div>
                <div className="mt-1 text-2xl font-black tabular-nums text-slate-950">{c.count}건</div>
                <div className="text-[11px] font-semibold text-slate-400">{c.people}명 · {c.points}점</div>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setOpen(!open)} className="w-full border-t border-slate-100 px-4 py-2 text-left text-xs font-black text-slate-500">
            {open ? "사람별 접기" : "사람별 펼치기"} ({scope === "week" ? "이번 주" : "이번 달"})
          </button>
          {open && (
            shown.byPerson.length === 0 ? (
              <div className="px-4 pb-3 text-sm font-semibold text-slate-400">이 기간 기록이 없습니다.</div>
            ) : (
              <div className="divide-y divide-slate-100 border-t border-slate-100">
                {shown.byPerson.map((p) => (
                  <div key={p.name} className="flex items-center justify-between px-4 py-2 text-sm">
                    <span><b>{p.name}</b> <span className="text-xs text-slate-400">{blogTeamOf(p, teams)}</span></span>
                    <span><b className="tabular-nums">{p.count}</b>건 <span className="text-xs text-slate-400">{Math.round(p.points * 10) / 10}점</span></span>
                  </div>
                ))}
              </div>
            )
          )}
        </>
      )}
      <p className="border-t border-slate-100 px-4 py-2 text-[11px] font-semibold text-slate-400">{BLOG_BASIS_TEXT}</p>
    </section>
  );
}
