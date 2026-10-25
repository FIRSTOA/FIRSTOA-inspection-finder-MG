/**
 * 홈 3차 팀 카드 5장(2026-10-25, docs/tasks/home-design-3-impl-2026-10-25.md 2번).
 * 원칙: 카드 본문은 무채색(white/[0.035]), 팀 색은 위 띠 4px + 팀명 글자에만. 본문 숫자·타일 배경은 상태색만(한 자리 한 뜻).
 * 폰(390px): 한 줄 가로 스크롤(카드 15rem) — 이 띠 안에서만 스크롤, 페이지 가로 스크롤 없음. xl 부터 5칸 격자.
 * 카드를 누르면 그 팀으로 거르기(파랑 ring), 다시 누르면 전체. 숫자는 teamBoard.ts 모델 그대로(여기서 세지 않음).
 * 2026-10-25 밤: 칸마다 따로 — 아직 안 온 칸(c.wait·tile.wait)만 "…" 점선, 온 칸은 바로 숫자(카드 전체를 로딩으로 묶지 않음).
 */
import { AlertTriangle } from "lucide-react";
import type { KpiStatus } from "./KpiWidgets.view";
import { TEAM_COLORS, type TeamKey } from "./teamColors";
import { NO_WAIT, TEAM_PILL_LABEL, type TeamCardModel, type TeamPill } from "./teamBoard";

const PILL: Record<TeamPill, string> = {
  done: "bg-emerald-500/15 text-emerald-300", onTrack: "bg-sky-500/15 text-sky-300", behind: "bg-rose-500/15 text-rose-300", none: "bg-white/[0.07] text-slate-400",
};
const TILE_BG: Record<KpiStatus, string> = {
  done: "bg-emerald-500/15", onTrack: "bg-sky-500/12", behind: "bg-rose-500/18", none: "bg-white/[0.04]", pending: "border border-dashed border-slate-600",
};
const TILE_TEXT: Record<KpiStatus, string> = {
  done: "text-emerald-300", onTrack: "text-sky-300", behind: "text-rose-300", none: "text-slate-200", pending: "text-slate-500",
};
const STATUS_WORD: Record<KpiStatus, string> = { done: "달성", onTrack: "순항", behind: "부족", none: "목표 없음", pending: "준비 중" };

const num = (n: number | null, suffix = "") => (n === null ? "—" : `${n.toLocaleString("ko-KR")}${suffix}`);
/** 아직 안 온 칸 — 점선 "…"(0·"—"과 구별) */
const WAIT_MARK = "…";
const say = (wait: boolean, text: string) => (wait ? "불러오는 중" : text);

function Big({ label, value, tone, wait = false }: { label: string; value: string; tone?: string; wait?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[11px] font-bold text-slate-400">{label}</div>
      {wait
        ? <div className="mt-0.5 inline-flex h-5.5 min-w-10 items-center justify-center rounded border border-dashed border-slate-600 font-mono text-[15px] font-black leading-none text-slate-500" aria-label={`${label} 불러오는 중`}>{WAIT_MARK}</div>
        : <div className={`truncate font-mono text-[20px] font-black leading-6 tabular-nums ${tone || "text-white"}`}>{value}</div>}
    </div>
  );
}

function TeamCard({ c, on, dim, onPick }: { c: TeamCardModel; on: boolean; dim: boolean; onPick: () => void }) {
  const tc = TEAM_COLORS[c.team];
  const w = c.wait ?? NO_WAIT;
  const aria = `${c.label}팀 ${say(w.pill, TEAM_PILL_LABEL[c.pill])} · 미처리 ${say(w.unhandled, num(c.unhandled))} · OKR ${c.okrApplies ? say(w.okr, num(c.okrPct, "%")) : "대상 아님"} · 정기점검 ${say(w.inspection, num(c.inspectionPct, "%"))}${c.stale ? " · 마지막 값(갱신 중)" : ""}${on ? " · 선택됨(다시 누르면 전체)" : ""}`;
  return (
    <button
      type="button" onClick={onPick} aria-pressed={on} aria-label={aria}
      className={`relative flex w-full min-w-0 flex-col overflow-hidden rounded-2xl border bg-white/[0.035] text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 ${on ? "border-blue-400/70 ring-2 ring-blue-400" : "border-white/[0.08] hover:bg-white/[0.06]"} ${dim ? "opacity-60" : ""}`}
    >
      <span aria-hidden className="block h-1 w-full shrink-0" style={{ backgroundColor: tc.hex }} />
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 text-[15px] font-black" style={{ color: tc.text }}>{c.label}팀</span>
          <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-slate-400">{w.headcount ? `${WAIT_MARK}명 · ` : c.headcount === null ? "" : `${c.headcount}명 · `}{c.region}</span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-black ${w.pill ? `${PILL.none} border border-dashed border-slate-600` : PILL[c.pill]}`}>{w.pill ? WAIT_MARK : TEAM_PILL_LABEL[c.pill]}</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <Big label="미처리" wait={w.unhandled} value={num(c.unhandled)} tone={c.unhandled ? "text-rose-200" : c.unhandled === 0 ? "text-emerald-300" : "text-slate-500"} />
          <Big label="OKR 이번 주" wait={w.okr} value={c.okrApplies ? num(c.okrPct, "%") : "—"} tone={c.okrApplies && c.okrPct !== null ? undefined : "text-slate-500"} />
          <Big label="정기점검" wait={w.inspection} value={num(c.inspectionPct, "%")} tone={c.inspectionPct === null ? "text-slate-500" : undefined} />
        </div>
        <div className="grid grid-cols-4 gap-1">
          {c.tiles.map((t) => (
            <div key={t.id} className={`min-w-0 rounded-md px-1 py-1 text-center ${t.wait ? TILE_BG.pending : TILE_BG[t.status]}`} title={`${t.label} ${t.wait ? "불러오는 중" : STATUS_WORD[t.status]}`}>
              <div className="truncate text-[11px] font-bold text-slate-300">{t.label}</div>
              <div className={`truncate font-mono text-[13px] font-black tabular-nums ${t.wait ? TILE_TEXT.pending : TILE_TEXT[t.status]}`}>
                {t.wait ? WAIT_MARK : t.pct !== null ? `${t.pct}%` : t.status === "none" && t.value !== null ? num(t.value) : "—"}
              </div>
            </div>
          ))}
        </div>
        <p className={`flex min-w-0 items-center gap-1 text-[11px] font-bold ${c.alerts.length && !w.alerts ? "text-amber-200" : "text-slate-500"}`}>
          {c.alerts.length > 0 && !w.alerts && <AlertTriangle size={12} className="shrink-0" aria-hidden />}
          <span className="truncate">{w.alerts ? `주의 ${WAIT_MARK}` : c.alerts.length ? c.alerts.join(" · ") : "주의 없음"}</span>
        </p>
      </div>
    </button>
  );
}

export function TeamBoardStrip({ cards, selected, onSelect }: { cards: TeamCardModel[]; selected: TeamKey | null; onSelect: (t: TeamKey) => void }) {
  return (
    <section aria-label="팀 카드 — 누르면 아래 달성표·미처리·OKR 이 그 팀으로" className="mb-2 min-w-0">
      <ul className="grid min-w-0 auto-cols-[15rem] grid-flow-col gap-2 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:thin] xl:auto-cols-auto xl:grid-flow-row xl:grid-cols-5 xl:overflow-visible xl:pb-0">
        {cards.map((c) => (
          <li key={c.team} className="flex min-w-0">
            <TeamCard c={c} on={selected === c.team} dim={selected !== null && selected !== c.team} onPick={() => onSelect(c.team)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
