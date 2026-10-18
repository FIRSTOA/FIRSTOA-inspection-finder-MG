import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Bot, CalendarCheck, ChevronDown } from "lucide-react";
import { AGENT_DEPTS, AGENT_FLOW_STEPS, AGENT_LEADER, type AgentAccent, type AgentDept, type AgentModel } from "./agentTeam";
import { AGENT_WORK_LOG, type AgentWorkItem } from "./agentWorkLog";
import { kstDate, weekRange } from "./visits";

// 카드 테두리: 평소 / 관제 덱 알약으로 불려 왔을 때(1.5초). 모션 줄이기면 글로우 없이 테두리만.
const cardBase = "rounded-2xl border bg-white/[0.035] transition-[border-color,box-shadow,transform] duration-500 motion-reduce:transition-none";
const cardIdle = "border-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]";
const cardFlash = "border-fuchsia-300 shadow-[0_0_0_4px_rgba(232,121,249,0.55),0_0_0_10px_rgba(232,121,249,0.18),0_0_90px_-4px_rgba(232,121,249,0.95)] motion-safe:scale-[1.012]";
const FOCUS_EVENT = "agent-team:focus";
const FLASH_MS = 2600;
const eyebrow = "text-[10px] font-black uppercase tracking-[0.16em] text-slate-500";
// 단추에 inline box-shadow(입체 그림자)를 쓰므로 초점 표시는 ring 대신 outline 으로 한다(ring 은 box-shadow 라 덮인다).
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400";
const MODEL_STYLE: Record<AgentModel, string> = {
  opus: "bg-violet-500/20 text-violet-200",
  sonnet: "bg-sky-500/20 text-sky-200",
  haiku: "bg-emerald-500/20 text-emerald-200",
};
const MODELS: AgentModel[] = ["opus", "sonnet", "haiku"];
const MODEL_INFO: Record<AgentModel, { label: string; dot: string; bar: string }> = {
  opus: { label: "설계·원인 추적", dot: "bg-violet-400", bar: "bg-violet-400/70" },
  sonnet: { label: "구현·검사", dot: "bg-sky-400", bar: "bg-sky-400/70" },
  haiku: { label: "빠른 통과 점검", dot: "bg-emerald-400", bar: "bg-emerald-400/70" },
};
const ACCENT_RGB: Record<AgentAccent, string> = {
  fuchsia: "232,121,249",
  pink: "244,114,182",
  blue: "96,165,250",
  lime: "163,230,53",
  yellow: "250,204,21",
  orange: "251,146,60",
  cyan: "34,211,238",
};
const rgba = (a: AgentAccent, o: number) => `rgba(${ACCENT_RGB[a]},${o})`;

const ALL_ROLES = AGENT_DEPTS.flatMap((d) => d.roles);
const MODEL_COUNT = Object.fromEntries(MODELS.map((m) => [m, ALL_ROLES.filter((r) => r.model === m).length])) as Record<AgentModel, number>;
const MODEL_KINDS = MODELS.filter((m) => MODEL_COUNT[m] > 0).length;
// "직원 10 출근 중 · 부서 7 · 모델 3" — 출근 점은 정적(상시 애니메이션은 팀장 ping·흐름 빛 점 2개만)
const STATS = [
  { value: ALL_ROLES.length, label: "직원", sub: "출근 중", live: true, sr: `직원 ${ALL_ROLES.length}명 출근 중` },
  { value: AGENT_DEPTS.length, label: "부서", sub: `흐름 ${AGENT_FLOW_STEPS.length}단계`, live: false, sr: `부서 ${AGENT_DEPTS.length}개` },
  { value: MODEL_KINDS, label: "모델", sub: "급별 배치", live: false, sr: `모델 ${MODEL_KINDS}종` },
];

/** 직원별 "한 일" 집계. 같은 커밋이 여러 직원에게 잡히므로 부서·전체 합계는 커밋 해시 기준 고유 수로 센다. */
type Count = { today: number; week: number };
type RoleWork = { today: AgentWorkItem[]; week: number };
type WorkStats = { byRole: Record<string, RoleWork>; byDept: Record<string, Count>; total: Count };
const DEPT_OF = new Map(AGENT_DEPTS.flatMap((d) => d.roles.map((r) => [r.key, d.name] as const)));
const EMPTY_ROLE: RoleWork = { today: [], week: 0 };
const EMPTY_COUNT: Count = { today: 0, week: 0 };

function buildWorkStats(today: string): WorkStats {
  const { start, end } = weekRange(today);
  const roleToday: Record<string, AgentWorkItem[]> = {};
  const roleSeen: Record<string, Set<string>> = {};
  const roleWeek: Record<string, Set<string>> = {};
  const deptToday: Record<string, Set<string>> = {};
  const deptWeek: Record<string, Set<string>> = {};
  const allToday = new Set<string>();
  const allWeek = new Set<string>();
  const add = (m: Record<string, Set<string>>, k: string, h: string) => (m[k] ??= new Set()).add(h);
  for (const it of AGENT_WORK_LOG) {
    const dept = DEPT_OF.get(it.agent);
    if (!dept || !it.hash || it.date < start || it.date > end) continue;
    add(roleWeek, it.agent, it.hash);
    add(deptWeek, dept, it.hash);
    allWeek.add(it.hash);
    if (it.date !== today) continue;
    add(deptToday, dept, it.hash);
    allToday.add(it.hash);
    const seen = (roleSeen[it.agent] ??= new Set());
    if (seen.has(it.hash)) continue;
    seen.add(it.hash);
    (roleToday[it.agent] ??= []).push(it);
  }
  const byRole: Record<string, RoleWork> = {};
  for (const r of ALL_ROLES) byRole[r.key] = { today: roleToday[r.key] ?? [], week: roleWeek[r.key]?.size ?? 0 };
  const byDept: Record<string, Count> = {};
  for (const d of AGENT_DEPTS) byDept[d.name] = { today: deptToday[d.name]?.size ?? 0, week: deptWeek[d.name]?.size ?? 0 };
  return { byRole, byDept, total: { today: allToday.size, week: allWeek.size } };
}
const OFF_FLOW = AGENT_DEPTS.filter((d) => d.stage === null);
const stageShort = (d: AgentDept) => (d.stage === null ? "상시" : `${d.stage + 1}단계`);
const stageLong = (d: AgentDept) => (d.stage === null ? "흐름 밖 · 상시 감시" : `${d.stage + 1}단계 · ${AGENT_FLOW_STEPS[d.stage]}`);

// 배경: 청사진 격자(위쪽만 보이게 마스크) + 빛 번짐 3개. blur 필터 대신 radial-gradient 라 가볍다.
const GRID_STYLE: CSSProperties = {
  backgroundImage: "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
  backgroundSize: "22px 22px",
  maskImage: "radial-gradient(ellipse 85% 60% at 50% 0%, #000 25%, transparent 75%)",
  WebkitMaskImage: "radial-gradient(ellipse 85% 60% at 50% 0%, #000 25%, transparent 75%)",
};
const GLOW_STYLE: CSSProperties = {
  background:
    "radial-gradient(420px circle at 0% 0%, rgba(232,121,249,0.14), transparent 60%), radial-gradient(380px circle at 100% 18%, rgba(56,189,248,0.10), transparent 60%), radial-gradient(420px circle at 45% 100%, rgba(251,146,60,0.07), transparent 60%)",
};

const prefersReducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * 홈 하단 "FIELD AI 에이전트 팀" 카드 (2026-10-19 고도화 → 같은 날 브랜딩·직원·한 일 추가).
 * 머리글(FIRSTOA CS · FIELD AI TEAM, 직원 출근 스탯, 오늘·이번 주 한 일 합계) → 조직도(팀장 → 부서 7, 부서마다 오늘·주 배지)
 * → 일 흐름 레일 → 모델 범례. 부서를 누르면 직원 카드(출근 점·오늘 투입/대기 중·오늘 한 일·이번 주 N건)가 펼쳐진다.
 * 한 일 재료는 agentWorkLog.ts(빌드 때 git 기록에서 생성). 빈 배열이면 모두 "대기 중 · 이번 주 0건"으로 보인다.
 * 최상위 id="agent-team" — 관제 덱 알약이 scrollIntoView 뒤 "agent-team:focus" 이벤트를 보내면 1.5초 테두리·글로우.
 */
export default function AgentTeamCard() {
  const [openDept, setOpenDept] = useState(AGENT_DEPTS[0].name);
  const [flash, setFlash] = useState(false);
  const dept = AGENT_DEPTS.find((d) => d.name === openDept);
  const rootRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const glareRef = useRef<HTMLDivElement>(null);
  const toggle = (name: string) => setOpenDept((cur) => (cur === name ? "" : name));
  const today = kstDate();
  const work = useMemo(() => buildWorkStats(today), [today]);

  // 관제 덱 알약 → 이 카드로 스크롤 뒤 보내는 이벤트. 다시 눌리면 타이머를 새로 건다.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let timer: number | undefined;
    const onFocus = () => {
      setFlash(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setFlash(false), FLASH_MS);
    };
    el.addEventListener(FOCUS_EVENT, onFocus);
    return () => {
      el.removeEventListener(FOCUS_EVENT, onFocus);
      window.clearTimeout(timer);
    };
  }, []);

  // 마우스일 때만: 조직도 판이 커서 쪽으로 살짝 기울고, 빛 반사가 커서를 따라간다. 터치·모션 줄이기면 아무것도 안 한다.
  // 상태 대신 ref 로 style 을 직접 바꿔 마우스 움직임마다 다시 그리지 않는다.
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current, glare = glareRef.current;
    if (e.pointerType !== "mouse" || !stage || !glare || prefersReducedMotion()) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    stage.style.transform = `rotateX(${((0.5 - py) * 5).toFixed(2)}deg) rotateY(${((px - 0.5) * 7).toFixed(2)}deg)`;
    glare.style.background = `radial-gradient(520px circle at ${(px * 100).toFixed(1)}% ${(py * 100).toFixed(1)}%, rgba(255,255,255,0.07), transparent 60%)`;
    glare.style.opacity = "1";
  };
  const onLeave = () => {
    if (stageRef.current) stageRef.current.style.transform = "";
    if (glareRef.current) glareRef.current.style.opacity = "0";
  };

  return (
    <section id="agent-team" ref={rootRef} aria-label="FIELD AI 에이전트 팀" className="relative scroll-mt-4 border-t border-white/[0.08] px-4 py-5 sm:px-6">
      <div className={`relative min-w-0 ${cardBase} ${flash ? cardFlash : cardIdle}`}>
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
          <div className="absolute inset-0" style={GLOW_STYLE} />
          <div className="absolute inset-0" style={GRID_STYLE} />
        </div>

        {/* ① 머리글 + 스탯 — 관제 덱 "FIRSTOA CS · LIVE OPERATIONS" 표시줄과 같은 계열(파랑 대신 우리 팀 자주색) */}
        <header className="relative px-4 pb-4 pt-4 sm:px-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10.5px] font-black tracking-[0.22em] text-fuchsia-300">
                <Bot aria-hidden size={13} />
                FIRSTOA CS · FIELD AI TEAM
              </div>
              <h3 className="mt-2 bg-linear-to-r from-white via-white to-fuchsia-200 bg-clip-text text-[20px] font-black leading-snug text-transparent sm:text-[22px]">FIELD AI 에이전트 팀</h3>
              <p className="mt-1 text-[12px] font-semibold leading-[18px] text-slate-400">
                CS팀이 직접 꾸린 AI 직원 {ALL_ROLES.length}명입니다. 사람 1명이 지시하면 팀장 클로드가 기획→구현→검사로 일을 나눠 맡깁니다.
              </p>
              <div className="mt-2.5 inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.05] px-2.5 py-1 text-[11px] font-bold text-slate-300">
                <CalendarCheck aria-hidden size={13} className={work.total.today > 0 ? "shrink-0 text-emerald-300" : "shrink-0 text-slate-500"} />
                <span className="truncate">
                  <span className="text-slate-500">팀 한 일 · </span>오늘 <b className="font-black tabular-nums text-white">{work.total.today}</b>건 · 이번 주 <b className="font-black tabular-nums text-white">{work.total.week}</b>건
                </span>
              </div>
            </div>
            <ul className="grid w-full grid-cols-3 gap-2 sm:w-auto" aria-label="팀 규모">
              {STATS.map((s) => (
                <li key={s.label} className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-2 py-2 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_10px_24px_-14px_rgba(0,0,0,0.9)] sm:min-w-[84px]">
                  <span className="sr-only">{s.sr}</span>
                  <div aria-hidden className="flex items-baseline justify-center gap-1">
                    <span className="text-[10.5px] font-bold text-slate-400">{s.label}</span>
                    <span className="text-[22px] font-black leading-none tabular-nums text-white">{s.value}</span>
                  </div>
                  <div aria-hidden className="mt-1 flex items-center justify-center gap-1 text-[10.5px] font-bold">
                    {s.live && <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" />}
                    <span className={s.live ? "text-emerald-300" : "text-slate-500"}>{s.sub}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </header>

        {/* ② 조직도: 팀장 → 부서 7 */}
        <section className="relative border-t border-white/[0.08] px-3 pb-4 pt-3 sm:px-5" aria-label="조직도">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-1">
            <div className={eyebrow}>조직도</div>
            <div className="text-[10.5px] font-bold text-slate-500">부서를 누르면 직원 카드가 펼쳐집니다</div>
          </div>
          <div className="relative [perspective:1400px]" onPointerMove={onMove} onPointerLeave={onLeave}>
            <div ref={glareRef} aria-hidden className="pointer-events-none absolute -inset-2 rounded-2xl opacity-0 transition-opacity duration-300" />
            <div ref={stageRef} className="relative transition-transform duration-300 ease-out will-change-transform [backface-visibility:hidden] motion-reduce:transition-none">
              <LeaderNode />

              {/* PC: 가운데 줄기 → 가로 버스선 → 부서 7칸 */}
              <div aria-hidden className="mx-auto hidden h-6 w-0.5 bg-linear-to-b from-fuchsia-300/70 to-white/20 lg:block" />
              <ul className="relative hidden grid-cols-7 gap-2 pt-5 lg:grid">
                <span aria-hidden className="absolute left-[calc(100%/14)] right-[calc(100%/14)] top-0 h-0.5 rounded-full bg-linear-to-r from-fuchsia-400/60 via-white/25 to-cyan-400/60" />
                {AGENT_DEPTS.map((d) => {
                  const open = openDept === d.name;
                  return (
                    <li key={d.name} className="relative">
                      <span aria-hidden className="absolute -top-5 left-1/2 h-5 w-0.5 -translate-x-1/2" style={{ background: rgba(d.accent, open ? 0.9 : 0.35) }} />
                      <DeptNode d={d} open={open} onToggle={() => toggle(d.name)} layout="col" count={work.byDept[d.name] ?? EMPTY_COUNT} />
                    </li>
                  );
                })}
              </ul>

              {/* 폰·태블릿: 왼쪽 세로 줄기에서 가지가 뻗는 나무 + 고른 부서는 바로 아래 펼침 */}
              <div aria-hidden className="ml-[34px] h-3 w-0.5 bg-fuchsia-300/50 lg:hidden" />
              <ul className="relative lg:hidden">
                {AGENT_DEPTS.map((d, i) => {
                  const open = openDept === d.name;
                  const last = i === AGENT_DEPTS.length - 1;
                  return (
                    <li key={d.name} className="relative pb-2.5 pl-[52px] last:pb-0">
                      <span aria-hidden className={`absolute left-[34px] top-0 w-0.5 bg-white/15 ${last ? "h-[27px]" : "h-full"}`} />
                      <span aria-hidden className="absolute left-[36px] top-[26px] h-0.5 w-4" style={{ background: rgba(d.accent, open ? 0.9 : 0.35) }} />
                      <span aria-hidden className="absolute left-[31px] top-[23px] size-2 rounded-full ring-2 ring-[#0B0F17]" style={{ background: rgba(d.accent, open ? 1 : 0.55) }} />
                      <DeptNode d={d} open={open} onToggle={() => toggle(d.name)} layout="row" count={work.byDept[d.name] ?? EMPTY_COUNT} />
                      {open && <div className="mt-2.5"><RoleList d={d} work={work.byRole} /></div>}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </section>

        {/* PC: 고른 부서 역할 카드 */}
        {dept && (
          <section className="relative hidden border-t border-white/[0.08] px-5 py-4 lg:block" aria-label={`${dept.name} 직원`}>
            <div className="mb-2.5 flex items-center gap-2">
              <span aria-hidden className="size-2 rounded-full" style={{ background: rgba(dept.accent, 1), boxShadow: `0 0 10px ${rgba(dept.accent, 0.8)}` }} />
              <span className="text-[12.5px] font-black text-white">{dept.name}</span>
              <span className="text-[11px] font-bold text-slate-500">{stageLong(dept)}</span>
              <span className="ml-auto text-[11px] font-bold tabular-nums text-slate-400">
                오늘 {(work.byDept[dept.name] ?? EMPTY_COUNT).today}건 · 이번 주 {(work.byDept[dept.name] ?? EMPTY_COUNT).week}건
              </span>
            </div>
            <RoleList d={dept} work={work.byRole} />
          </section>
        )}

        {/* ③ 일 흐름 레일 */}
        <section className="relative border-t border-white/[0.08] px-4 py-4 sm:px-5" aria-label="일 흐름">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <div className={eyebrow}>일 흐름</div>
            <div className="text-[10.5px] font-bold text-slate-500">{dept ? `${dept.name} · ${stageLong(dept)}` : "부서를 고르면 흐름 위 위치가 표시됩니다"}</div>
          </div>
          <ol className="relative mt-3 grid grid-cols-5">
            <span aria-hidden className="absolute left-[10%] right-[10%] top-[15px] h-0.5 rounded-full bg-linear-to-r from-fuchsia-400/50 via-lime-300/40 to-orange-400/50" />
            <span aria-hidden className="absolute left-[10%] right-[10%] top-[15px] h-0 motion-reduce:hidden">
              <span className="agent-flow-run absolute inset-x-0 top-0 h-0">
                <span className="absolute -left-1.5 -top-[5px] size-3 rounded-full bg-white shadow-[0_0_12px_4px_rgba(255,255,255,0.45)]" />
              </span>
            </span>
            {AGENT_FLOW_STEPS.map((s, i) => {
              const on = !!dept && dept.stage === i;
              const owners = AGENT_DEPTS.filter((d) => d.stage === i);
              return (
                <li key={s} className="relative flex flex-col items-center gap-1.5 px-0.5 text-center" aria-current={on ? "step" : undefined}>
                  <span
                    className={`grid size-8 place-items-center rounded-full border text-[11px] font-black tabular-nums transition-colors ${on ? "text-white" : "border-white/[0.14] bg-[#121826] text-slate-400"}`}
                    style={on && dept ? { borderColor: rgba(dept.accent, 0.8), background: `radial-gradient(circle at 35% 30%, ${rgba(dept.accent, 0.55)}, ${rgba(dept.accent, 0.18)} 70%), #121826`, boxShadow: `0 0 0 4px ${rgba(dept.accent, 0.15)}, 0 6px 16px -4px ${rgba(dept.accent, 0.7)}` } : undefined}
                  >
                    {i + 1}
                  </span>
                  <span className={`text-[11px] font-black leading-tight ${on ? "text-white" : "text-slate-300"}`}>{s}</span>
                  <span className="hidden text-[10px] font-semibold leading-tight text-slate-500 sm:block">{owners.map((d) => d.name).join("·")}</span>
                </li>
              );
            })}
          </ol>
          {OFF_FLOW.length > 0 && (
            <p className={`mt-3 text-[11px] font-semibold leading-4 ${dept && dept.stage === null ? "text-cyan-200" : "text-slate-500"}`}>
              {OFF_FLOW.map((d) => d.name).join("·")}은 흐름 밖에서 심박·발송·백업을 상시 읽기 전용으로 지켜봅니다.
            </p>
          )}
        </section>

        {/* ④ 모델 범례 */}
        <section className="relative border-t border-white/[0.08] px-4 py-4 sm:px-5" aria-label="모델 구성">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <div className={eyebrow}>급에 따라 모델을 나눠 씁니다</div>
            <div className="text-[10.5px] font-bold text-slate-500">무거운 판단은 큰 모델, 반복 점검은 가벼운 모델</div>
          </div>
          <div aria-hidden className="mt-2.5 flex h-2 gap-0.5 overflow-hidden rounded-full">
            {MODELS.map((m) => <span key={m} className={MODEL_INFO[m].bar} style={{ flexGrow: MODEL_COUNT[m] }} />)}
          </div>
          <ul className="mt-2.5 grid grid-cols-3 gap-2">
            {MODELS.map((m) => (
              <li key={m} className="rounded-xl bg-white/[0.04] px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${MODEL_STYLE[m]}`}>{m}</span>
                  <span className="text-[13px] font-black tabular-nums text-white">{MODEL_COUNT[m]}<span className="ml-0.5 text-[10.5px] font-bold text-slate-500">명</span></span>
                </div>
                <div className="mt-1 text-[11px] font-bold leading-4 text-slate-400">{MODEL_INFO[m].label}</div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[10.5px] font-semibold leading-4 text-slate-500">
            2026-10-19 입사 · 직원 명부는 저장소 .claude/agents/ · 팀장 규칙은 CLAUDE.md · 한 일은 커밋 기록에서 자동으로 모읍니다(같은 커밋은 1건)
          </p>
        </section>
      </div>
    </section>
  );
}

/** 팀장 노드: 겹친 판 두 장 + 빛나는 이모지 타일 + 가동 점. (translateZ 로 띄우던 것은 글자가 어중간한 배율로 재래스터돼 흐려져서 뺐다 — 2026-10-19 실측) */
function LeaderNode() {
  return (
    <div className="relative mx-auto lg:max-w-lg">
      <span aria-hidden className="absolute inset-x-2 -bottom-2 top-2 rounded-2xl border border-fuchsia-300/10 bg-fuchsia-400/[0.05]" />
      <div
        className="relative flex items-center gap-3 rounded-2xl border border-white/[0.12] p-2.5"
        style={{ background: "linear-gradient(135deg, rgba(232,121,249,0.16), rgba(56,189,248,0.08) 55%, rgba(18,24,38,0.92))", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12), 0 18px 40px -18px rgba(232,121,249,0.55)" }}
      >
        <span
          className="relative grid size-12 shrink-0 place-items-center rounded-xl text-[30px] leading-none"
          style={{ background: "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.22), rgba(255,255,255,0.04) 70%)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2), 0 8px 16px -8px rgba(0,0,0,0.8)" }}
        >
          <span aria-hidden className="drop-shadow-[0_6px_8px_rgba(0,0,0,0.55)]">{AGENT_LEADER.emoji}</span>
          <span aria-hidden className="absolute -right-0.5 -top-0.5 flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:hidden" />
            <span className="relative inline-flex size-2.5 rounded-full bg-emerald-400 ring-2 ring-[#0B0F17]" />
          </span>
        </span>
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-fuchsia-200/80">{AGENT_LEADER.title} · 지휘</div>
          <div className="text-[13.5px] font-black leading-snug text-white">{AGENT_LEADER.name}</div>
          <div className="mt-0.5 text-[11.5px] font-semibold leading-4 text-slate-300">{AGENT_LEADER.desc}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * 부서 노드: 아래 판(두께) 위에 단추가 떠 있고, 호버·열림이면 더 들린다(틈이 벌어지며 입체감).
 * 들림은 단추가 아닌 감싼 div 에서 한다 — index.css 의 button 공통 transition 이 Tailwind transition 을 덮기 때문.
 */
function DeptNode({ d, open, onToggle, layout, count }: { d: AgentDept; open: boolean; onToggle: () => void; layout: "row" | "col"; count: Count }) {
  const col = layout === "col";
  // 오늘 일한 부서는 초록, 아니면 회색(상태 색 규칙). 숫자는 커밋 고유 수.
  const workBadge = (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-black tabular-nums ${count.today > 0 ? "bg-emerald-500/15 text-emerald-200" : "bg-white/[0.06] text-slate-400"}`}
    >
      <span className="sr-only">한 일 </span>오늘 {count.today}<span aria-hidden className="text-slate-500">·</span>주 {count.week}
    </span>
  );
  const emojis = (
    <span aria-hidden className={`flex shrink-0 -space-x-1.5 leading-none drop-shadow-[0_6px_8px_rgba(0,0,0,0.55)] ${col ? "text-[28px]" : "text-[26px]"}`}>
      {d.roles.map((r) => <span key={r.key}>{r.emoji}</span>)}
    </span>
  );
  const meta = (
    <span className={`flex items-center gap-1.5 ${col ? "justify-center" : ""}`}>
      <span className="text-[10px] font-black" style={{ color: rgba(d.accent, open ? 1 : 0.8) }}>{stageShort(d)}</span>
      <span aria-hidden className="flex gap-0.5">
        {d.roles.map((r) => <span key={r.key} className={`size-1.5 rounded-full ${MODEL_INFO[r.model].dot}`} />)}
      </span>
    </span>
  );
  return (
    <div className="group relative">
      <span
        aria-hidden
        className="absolute inset-x-1.5 -bottom-1.5 top-1.5 rounded-xl border border-white/[0.05] bg-white/[0.025]"
        style={open ? { borderColor: rgba(d.accent, 0.25), background: rgba(d.accent, 0.07) } : undefined}
      />
      <div className={`relative transition-transform duration-200 ease-out motion-reduce:transition-none ${open ? "-translate-y-1" : "group-hover:-translate-y-1"}`}>
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className={`relative flex min-h-11 w-full rounded-xl border text-left ${focusRing} ${open ? "bg-[#1a2133]" : "border-white/[0.08] bg-[#121826] hover:bg-[#161d2c]"} ${col ? "flex-col items-center gap-1.5 px-1.5 pb-2.5 pt-3 text-center" : "items-center gap-3 px-3 py-2"}`}
          style={
            open
              ? { borderColor: rgba(d.accent, 0.55), boxShadow: `0 0 0 1px ${rgba(d.accent, 0.2)}, 0 14px 30px -12px ${rgba(d.accent, 0.55)}, inset 0 1px 0 rgba(255,255,255,0.08)` }
              : { boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 10px 22px -14px rgba(0,0,0,0.9)" }
          }
        >
          {emojis}
          {col ? (
            <>
              <span className="text-[13px] font-black text-white">{d.name} <span className="text-[10.5px] font-bold text-slate-400">{d.roles.length}</span></span>
              {meta}
              {workBadge}
              <ChevronDown aria-hidden size={14} className={`text-slate-400 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-black text-white">{d.name} <span className="text-[11px] font-bold text-slate-400">{d.roles.length}명</span></span>
                {/* 폰 폭(390px)에서 이름 줄이 밀리지 않게 배지는 단계 줄 옆에 둔다 */}
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">{meta}{workBadge}</span>
              </span>
              <ChevronDown aria-hidden size={16} className={`shrink-0 text-slate-400 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * 부서 직원 카드 목록. 직원 0명 부서는 "준비 중" 한 줄(빈 상태). 데이터가 정적이라 로딩·에러 상태는 없다.
 * 카드마다: 출근 점(정적 초록) · 오늘 투입/대기 중 배지 · 오늘 한 일 최대 2줄(1줄 말줄임) · 이번 주 N건.
 */
function RoleList({ d, work }: { d: AgentDept; work: Record<string, RoleWork> }) {
  if (d.roles.length === 0) {
    return <p className="rounded-xl border border-dashed border-white/[0.1] px-3 py-3 text-[12px] font-semibold text-slate-500">아직 배치된 직원이 없습니다. 준비 중입니다.</p>;
  }
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {d.roles.map((r) => {
        const w = work[r.key] ?? EMPTY_ROLE;
        const busy = w.today.length > 0;
        const more = w.today.length - 2;
        return (
          <li
            key={r.key}
            className="relative min-w-0 overflow-hidden rounded-xl border border-white/[0.08] bg-[#121826]/80 p-3"
            style={{ boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 12px 26px -16px ${rgba(d.accent, 0.6)}` }}
          >
            <span aria-hidden className="pointer-events-none absolute -right-10 -top-10 size-28 rounded-full" style={{ background: `radial-gradient(circle, ${rgba(d.accent, 0.22)}, transparent 70%)` }} />
            <div className="relative flex items-start gap-3">
              <span
                aria-hidden
                className="relative grid size-12 shrink-0 place-items-center rounded-xl border text-[28px] leading-none"
                style={{ background: `linear-gradient(145deg, ${rgba(d.accent, 0.24)}, ${rgba(d.accent, 0.04)})`, borderColor: rgba(d.accent, 0.3), boxShadow: `inset 0 1px 0 rgba(255,255,255,0.14), 0 8px 18px -10px ${rgba(d.accent, 0.8)}` }}
              >
                <span className="drop-shadow-[0_5px_6px_rgba(0,0,0,0.5)]">{r.emoji}</span>
                {/* 출근 점: 팀장 것과 같은 부품이지만 ping 없이 정적(직원 10명이 다 깜빡이면 산만하다) */}
                <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-emerald-400 ring-2 ring-[#0B0F17]" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[14px] font-black text-white">{r.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${MODEL_STYLE[r.model]}`}>{r.model}</span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black ${busy ? "bg-emerald-500/15 text-emerald-200" : "bg-white/[0.06] text-slate-400"}`}
                  >
                    <span aria-hidden className={`size-1.5 rounded-full ${busy ? "bg-emerald-400" : "bg-slate-500"}`} />
                    <span className="sr-only">출근 중, </span>
                    {busy ? "오늘 투입" : "대기 중"}
                  </span>
                </div>
                <div className="mt-0.5 break-all font-mono text-[10.5px] font-semibold text-slate-500">{r.key}</div>
              </div>
            </div>
            <div className="relative mt-2 text-[12.5px] font-bold leading-[18px] text-slate-200">{r.desc}</div>
            <div className="relative mt-1.5 flex gap-1.5 text-[11px] font-semibold leading-4 text-slate-400">
              <span className="shrink-0 rounded bg-white/[0.06] px-1.5 font-black text-slate-300">언제</span>
              <span>{r.trigger}</span>
            </div>

            {/* 한 일: 오늘 최대 2줄 + 이번 주 건수. 없으면 한 줄로 "오늘은 대기 중 · 이번 주 N건" */}
            <div className="relative mt-2.5 border-t border-white/[0.06] pt-2">
              {busy ? (
                <>
                  <div className="flex items-baseline justify-between gap-2 text-[10.5px] font-black">
                    <span className="text-emerald-300">오늘 한 일</span>
                    <span className="tabular-nums text-slate-400">이번 주 {w.week}건</span>
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {w.today.slice(0, 2).map((it) => (
                      <li key={it.hash} className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-semibold leading-4 text-slate-200">
                        <span aria-hidden className="size-1 shrink-0 rounded-full bg-emerald-400/80" />
                        <span className="min-w-0 flex-1 truncate" title={`${it.hash.slice(0, 7)} ${it.summary}`}>{it.summary}</span>
                      </li>
                    ))}
                  </ul>
                  {more > 0 && <div className="mt-0.5 pl-2.5 text-[10.5px] font-bold text-slate-500">외 {more}건 더</div>}
                </>
              ) : (
                <div className="text-[11px] font-bold tabular-nums text-slate-500">오늘은 대기 중 · 이번 주 {w.week}건</div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
