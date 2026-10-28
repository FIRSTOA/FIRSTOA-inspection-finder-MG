import { addUsage, emptyUsage, loadPrices, logUsage, priceUsage, type Prices } from "../_shared/ai-usage.ts";
import GUIDE_PAGES from "../_shared/app-guide.json" with { type: "json" };
import { APP_GUIDE_EXTRA } from "../_shared/app-guide-extra.ts";
import { CATALOG, OKR_GUIDE, catalogText, pkOf, scopeAllows, shapeRow, type Asker, type Cat } from "../_shared/ask/catalog.ts";
import { askMask, askMaskText } from "../_shared/ask/mask.ts";
import { FILTER_OPS, buildFilterParts, colSql, makeRest, type AskRest } from "../_shared/ask/rest.ts";
import { AUTHOR_TEAM, dateCondRange, pickDateTextRows, runTally, splitDateFilters } from "../_shared/ask/tally.ts";
import { rosterTeam, textDateLoose } from "../_shared/ask/tool-util.ts";
import * as toolsIndex from "../_shared/ask/tools-index.ts";
/**
 * 전체 데이터에 물어보기 — "무엇이든 묻기" (2026-10-10 시작, 2026-10-29 확장: docs/tasks/search-ask-everything-2026-10-29.md 구현 A)
 *
 * 한 업체가 아니라 표 전체·사람·팀·OKR·KPI·운영 상태를 묻는 질문. 모델이 도구를 골라 직접 조회하고(읽기 전용, 허용 표·칸만) 답한다.
 * 표 목록은 _shared/ask/catalog.ts, 가림은 _shared/ask/mask.ts(askMask), 읽기 창구는 _shared/ask/rest.ts, 건수 세기는 _shared/ask/tally.ts,
 * 분석 도구(OKR·사람 활동·점검 누락·미수 후속·미처리·일정·사진·IT 시트·카톡·운영 상태·KPI 정의)는 _shared/ask/tools-index.ts(구현 B).
 *
 * 요청 POST JSON
 *   { question, author, mode?: "data" | "analysis", people?: Array<string | {name, team?}>, teams?: string[],
 *     packs?: Record<string, unknown> | Array<{ kind, title?, data }>  (앱이 계산한 값 — 25KB 이하, 넘으면 버리고 note),
 *     context?: string  (이어서 묻기 — 앞 답 요약, 1,500자) }
 * 응답 200
 *   { answer, mode, evidence: [{ id, tool, title, table, columns, rows, count, truncated }],
 *     rows, columns, table   (옛 앱 호환 — 표 행이 있는 마지막 근거),
 *     calls, model, usage, cost: { usd, priced, model }, ms,
 *     limits: { rounds, maxRounds, maxUsd, stopped: null | "cost" | "time" | "rounds", note },
 *     asker: { name, team }, packs: { used: string[], dropped?: string } }
 * 오류: 400 질문 없음 · 429 { error, code: "daily_limit", spent, cap } (분석 모드만, 하루 총액 넘음) · 502 OpenAI · 500
 *
 * 상한(설계 4장 4, 결정 Q3): 왕복 data 9 / analysis 16 · 한 질문 ASK_MAX_USD(기본 1.5) · 엣지 140초에서 마무리 왕복 강제 ·
 * 하루 ASK_DAILY_USD(기본 20, ai_usage 오늘 KST 합) 넘으면 분석 모드 거절(일반 질문은 허용).
 * 비용 기록 fn: 'data-ask' / 'data-ask:analysis'.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://kkdiihazgzesbqxjytqv.supabase.co";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const REST: AskRest = makeRest(SUPABASE_URL, ANON);

type Mode = "data" | "analysis";
const MAX_ROUNDS: Record<Mode, number> = { data: 9, analysis: 16 };
const WALL_MS = 140_000;            // 이 시간을 넘기면 도구를 끊고 마무리 왕복
const PACKS_MAX = 25_000;           // 앱 꾸러미 상한(글자 수)
const envNum = (k: string, d: number) => { const n = Number(Deno.env.get(k)); return Number.isFinite(n) && n > 0 ? n : d; };

const TEAM_LETTER = (v: string) => { const m = String(v || "").match(/[A-E]/i); return m ? m[0].toUpperCase() : (/지방|CSS/i.test(v) ? "E" : ""); };
const vendorKey = (v: string) => String(v || "").replace(/㈜|\(주\)|\(유\)/g, "").replace(/\([^)]*\)?/g, " ").replace(/^(?:\d{4}\/)?\d+[#/\-\s]*(?:SS|NN|S|N|V)?/i, "").replace(/(?:분기|매월|계약종료|재계약|점검|마감).*$/i, "").replace(/주식회사|유한회사|유한책임회사|재단법인|사단법인|농업회사법인/g, "").replace(/[^0-9a-z가-힣]/gi, "").toLowerCase().slice(0, 12);

const KST = 9 * 3600_000;
const kstToday = () => new Date(Date.now() + KST).toISOString().slice(0, 10);
/** 이번 주 월요일~일요일(KST) */
function weekRange() {
  const now = new Date(Date.now() + KST); const dow = (now.getUTCDay() + 6) % 7; // 월=0
  const mon = new Date(now.getTime() - dow * 86_400_000); const sun = new Date(mon.getTime() + 6 * 86_400_000);
  return `${mon.toISOString().slice(0, 10)} ~ ${sun.toISOString().slice(0, 10)} (다음 주 월요일 ${new Date(sun.getTime() + 86_400_000).toISOString().slice(0, 10)} 미만)`;
}

// ── 명단(cs_members) — 묻는 사람·명단 팀(_author_team)·Q1 범위 ──
type Member = { name: string; team: string; dept: string; title: string };
async function loadMembers(): Promise<Member[]> {
  const rows = await REST.get<{ name: string; team: string | null; dept: string | null; title: string | null }>("cs_members?select=name,team,dept,title,active&active=is.true&order=team.asc,sort.asc&limit=300");
  // 겸직 'A·B' 는 첫 팀(rosterTeam = 앱 rosterFromMembers 와 같은 규칙), 팀 글자 없는 부서 글은 그대로
  return rows.map((r) => ({ name: String(r.name || "").trim(), team: rosterTeam(r.team), dept: String(r.dept || "").trim(), title: String(r.title || "").trim() }));
}
/** 명단 팀 글자(A~E) — CSS 는 E. 팀 칸이 없는 부서 사람은 "" */
const memberTeamLetter = (m: Member) => (/^CSS$/i.test(m.team) ? "E" : /^[A-E]$/i.test(m.team) ? m.team.toUpperCase() : "");

/** 행 칸 하나를 앱·모델로 — 칸 목록·길이 상한·가림 */
const outRow = (cat: Cat, r: Record<string, unknown>) => askMask(shapeRow(cat, r));

type Evidence = { id: string; tool: string; title: string; table: string; columns: string[]; rows: Array<Record<string, unknown>>; count: number; truncated: boolean };
const tableLabel = (t: string) => { const d = CATALOG[t]?.desc || t; return d.split(/[(.—,]/)[0].trim().slice(0, 24) || t; };

type ToolCtx = { rest: AskRest; mask: typeof askMask; today: string; asker: Asker; mode: Mode; members: Member[]; teamOf: (name: string) => string; teamOfGroup: (name: string) => string };

async function queryRows(args: Record<string, unknown>, ctx: ToolCtx) {
  const table = String(args.table || "");
  const cat = CATALOG[table];
  if (!cat) return { error: `허용되지 않은 표: ${table}. 가능한 표: ${Object.keys(CATALOG).join(", ")}` };
  const want = Array.isArray(args.select) ? (args.select as string[]).filter((c) => cat.cols.includes(c)) : [];
  // 지식 표는 날짜·처리자를 늘 같이 — 모델이 없는 칸 이름(date·handler)을 골라 사례에 날짜가 빠지던 것(2026-10-12)
  if (cat.long) for (const extra of [cat.date || "", "author"]) if (extra && cat.cols.includes(extra) && want.length && !want.includes(extra)) want.push(extra);
  // Q1 범위 표는 거를 칸을 늘 같이
  if (cat.scope === "author" && cat.author && want.length && !want.includes(cat.author)) want.push(cat.author);
  if (cat.scope === "team" && want.length && !want.includes(cat.team || "team")) want.push(cat.team || "team");
  const cols = [...(want.length ? want : cat.cols.slice(0, 20)), ...(cat.countCols || [])];
  const parts: string[] = [`select=${encodeURIComponent(cols.map(colSql).join(","))}`];
  // 형식 섞인 글자 날짜 칸(cat.dateText — misu·bulman·overage_adjust)의 날짜 조건은 서버 글자 비교 대신 읽은 뒤 날짜로(tally 와 같은 규칙)
  const split = splitDateFilters(cat, args.filters);
  const f = buildFilterParts(table, cat, split.rest);
  if ("error" in f) return f;
  parts.push(...f.parts);
  if (cat.hidden) parts.push(cat.hidden);
  const order = String(args.order || ""); const [oc, od] = order.split(".");
  // 지식 표(플레이북·처리이력)는 글이 길어 행은 적게, 글은 길게 돌려준다
  const limit = Math.min(cat.long ? 40 : 300, Math.max(1, Number(args.limit) || (cat.long ? 20 : 200)));
  const scoped = (raw: Array<Record<string, unknown>>) => (cat.scope ? raw.filter((r) => scopeAllows(cat, r, ctx.asker, ctx.teamOfGroup)) : raw);
  if (cat.dateText && cat.date && (!oc || oc === cat.date)) {
    // 날짜순 목록 — 서버 order=<날짜> 는 글자 정렬(쓰레기 행·'Fri Mar …'·'2026.9.8' 이 맨 앞). id 순으로 넉넉히 읽고 ymdOf 로 정렬
    const dateCol = cat.date;
    const sel = cols.includes(dateCol) ? parts : [`select=${encodeURIComponent([...cols, dateCol].map(colSql).join(","))}`, ...parts.slice(1)];
    const r = dateCondRange(split.dateConds);
    const q = [...sel, ...(split.dateConds.length ? [textDateLoose(dateCol, r.from, r.to)] : [])].join("&");
    try {
      const { rows: raw, truncated } = await ctx.rest.getAll<Record<string, unknown>>(table, q, { max: 20_000, orderBy: pkOf(cat) });
      const allowed = scoped(raw);
      const picked = pickDateTextRows(allowed, dateCol, split.dateConds, oc && od === "asc" ? "asc" : "desc", limit);
      return {
        table, count: picked.rows.length, truncated: truncated || picked.total > limit, rows: picked.rows.map((x) => outRow(cat, x)),
        ...(picked.total > limit ? { matched: picked.total } : {}),
        ...(allowed.length < raw.length ? { hidden_by_scope: raw.length - allowed.length, note: "같은 팀(부서) 것만 보여 줍니다(설계 Q1)" } : {}),
      };
    } catch (e) { return { error: String((e as Error).message) }; }
  }
  if (oc && cat.cols.includes(oc)) parts.push(`order=${encodeURIComponent(colSql(oc))}.${od === "asc" ? "asc" : "desc"}`);
  else if (cat.date) parts.push(`order=${encodeURIComponent(colSql(cat.date))}.desc`);
  else parts.push(`order=${encodeURIComponent(colSql(pkOf(cat)))}.asc`);
  parts.push(`limit=${limit}`);
  try {
    const raw = await ctx.rest.get<Record<string, unknown>>(`${table}?${parts.join("&")}`);
    const allowed = scoped(raw);
    // 가림(2026-10-29 askMask — 주민·카드·계좌·휴대폰) — 모델이 보는 행과 앱에 돌려주는 행 모두. 조건(filters)은 원본 값으로 걸린다
    return {
      table, count: allowed.length, truncated: raw.length >= limit, rows: allowed.map((r) => outRow(cat, r)),
      ...(allowed.length < raw.length ? { hidden_by_scope: raw.length - allowed.length, note: "같은 팀(부서) 것만 보여 줍니다(설계 Q1)" } : {}),
    };
  } catch (e) { return { error: String((e as Error).message) }; }
}

/** 업체명 → 팀(A~E). 일정·접수·워킨맵·점검 순으로 최근 기록의 팀을 쓴다 */
async function vendorTeam(args: Record<string, unknown>, ctx: ToolCtx) {
  const vendors = (Array.isArray(args.vendors) ? args.vendors : []).map(String).filter(Boolean).slice(0, 60);
  if (!vendors.length) return { error: "vendors 가 비었습니다" };
  const keyOf = new Map(vendors.map((v) => [vendorKey(v), v]));
  const out: Record<string, { team: string; from: string }> = {};
  const failed: string[] = [];
  const assign = (name: string, team: string, from: string) => { const k = vendorKey(name); const orig = keyOf.get(k); const t = TEAM_LETTER(team); if (orig && t && !out[orig]) out[orig] = { team: t, from }; };
  const inList = `in.(${vendors.map((v) => `"${encodeURIComponent(v.replace(/"/g, ""))}"`).join(",")})`;
  try { (await ctx.rest.get<Record<string, string>>(`as_tickets?select=vendor,team,date&vendor=${inList}&order=date.desc&limit=400`)).forEach((r) => assign(r.vendor, r.team, "일정")); } catch { failed.push("일정"); }
  try { (await ctx.rest.get<Record<string, string>>(`service_receptions?select=vendor,region,receipt_date&vendor=${inList}&deleted=is.false&order=receipt_date.desc&limit=400`)).forEach((r) => assign(r.vendor, r.region, "접수")); } catch { failed.push("접수"); }
  try { (await ctx.rest.get<Record<string, string>>(`jeomgeom?select=${encodeURIComponent('"_업체명",지역,작성일')}&${encodeURIComponent('"_업체명"')}=${inList}&_hidden=not.is.true&order=${encodeURIComponent('"작성일"')}.desc&limit=400`)).forEach((r) => assign(r["_업체명"], r["지역"], "점검")); } catch { failed.push("점검"); }
  const missing = vendors.filter((v) => !out[v]).slice(0, 30);
  for (const v of missing) {
    const core = vendorKey(v).slice(0, 6);
    if (core.length < 2) continue;
    try {
      const rows = await ctx.rest.get<Record<string, string>>(`workin_map_places?select=name,team&name=ilike.*${encodeURIComponent(core)}*&limit=5`);
      const hit = rows.find((r) => vendorKey(r.name) === vendorKey(v)) || rows[0];
      if (hit) out[v] = { team: TEAM_LETTER(hit.team), from: "워킨맵" };
    } catch { if (!failed.includes("워킨맵")) failed.push("워킨맵"); }
  }
  return { teams: out, unresolved: vendors.filter((v) => !out[v]), ...(failed.length ? { failed_sources: failed } : {}) };
}

/** 팀 인원 명단(cs_members) — 사람별 집계 때 0건인 사람도 빠지지 않게 */
function teamMembers(args: Record<string, unknown>, ctx: ToolCtx) {
  const team = String(args.team || "").trim().toUpperCase();
  const list = ctx.members.filter((m) => !team || memberTeamLetter(m) === team || m.team.toUpperCase() === team).map((m) => ({ name: m.name, team: memberTeamLetter(m) || m.team || m.dept, title: m.title, dept: m.dept }));
  return { team: team || "전체", members: list };
}

/** 앱 사용설명서(public/guide 21편 + 2026-10 변경분) — topic 낱말로 맞는 편 최대 3개 */
type GuidePage = { key: string; title: string; text: string };
function appGuide(args: Record<string, unknown>) {
  const topic = String(args.topic || "").trim();
  const pages: GuidePage[] = [...(GUIDE_PAGES as GuidePage[]), { key: "recent", title: "2026년 10월 추가·변경(최신)", text: APP_GUIDE_EXTRA }];
  const words = topic.split(/[\s,·/?？]+/).map((w) => w.replace(/(은|는|이|가|을|를|에서|으로|로|의|도)$/, "")).filter((w) => w.length >= 2);
  const score = (p: GuidePage) => words.reduce((n, w) => n + (p.title.includes(w) ? 8 : 0) + Math.min(20, p.text.split(w).length - 1), 0);
  const picked = words.length ? pages.map((p) => ({ p, s: score(p) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 3).map((x) => x.p) : [];
  const list = pages.map((p) => `${p.key}: ${p.title}`).join("\n");
  if (!picked.length) return { pages: list, note: "topic 에 핵심 낱말(예: '자가 반납', '마감 문자', '워킨맵 라벨')을 주면 그 설명서 본문을 돌려줍니다. 최신 변경은 key 'recent'.", recent: APP_GUIDE_EXTRA.slice(0, 7000) };
  return { pages: picked.map((p) => ({ key: p.key, title: p.title, text: p.text.slice(0, 9000) })), all: list };
}

// ── 구현 B 도구 연결 — tools-index 의 내보내기 모양이 몇 가지여도 받아들인다 ──
type ToolRun = (args: Record<string, unknown>, ctx: ToolCtx) => Promise<unknown> | unknown;
type ToolDef = { name: string; description: string; parameters: Record<string, unknown>; run: ToolRun; title?: string };
function normalizeTools(mod: Record<string, unknown>): ToolDef[] {
  const out: ToolDef[] = [];
  const pickRun = (o: Record<string, unknown>) => (o.run || o.handler || o.fn || o.execute) as ToolRun | undefined;
  const add = (name: string, o: Record<string, unknown>, run?: ToolRun) => {
    const fn = run || pickRun(o);
    if (!name || typeof fn !== "function" || out.some((t) => t.name === name)) return;
    out.push({ name, description: String(o.description || ""), parameters: (o.parameters as Record<string, unknown>) || { type: "object", properties: {} }, run: fn, title: typeof o.label === "string" ? o.label : typeof o.title === "string" ? o.title : undefined });
  };
  const runners = (mod.ASK_TOOL_RUNNERS || mod.TOOL_RUNNERS || mod.RUNNERS) as Record<string, ToolRun> | undefined;
  for (const key of ["ASK_TOOLS", "TOOLS", "default", "ASK_TOOL_DEFS", "TOOL_DEFS"]) {
    const v = mod[key];
    if (Array.isArray(v)) for (const o of v as Array<Record<string, unknown>>) add(String(o?.name || ""), o || {}, runners?.[String(o?.name || "")]);
    else if (v && typeof v === "object") for (const [name, o] of Object.entries(v as Record<string, Record<string, unknown>>)) add(String(o?.name || name), o || {}, runners?.[name]);
  }
  return out;
}
const BASE_TOOL_NAMES = new Set(["app_guide", "team_members", "query_rows", "tally", "vendor_team"]);
const EXT_TOOLS = normalizeTools(toolsIndex as unknown as Record<string, unknown>).filter((t) => !BASE_TOOL_NAMES.has(t.name));

const TOOL_LABEL: Record<string, string> = { query_rows: "표 조회", tally: "건수 세기", vendor_team: "업체 팀 찾기", team_members: "팀 명단", app_guide: "사용설명서" };

const BASE_TOOLS = [
  { type: "function", name: "app_guide", description: "FIELD 앱(이 프로젝트)의 사용설명서 21편과 2026년 10월 변경분. '앱에서 어떻게 해', '어느 탭에서', '자가 반납 절차', '마감 문자 자동 수집', '재고 기종', '워킨맵 라벨' 같은 사용법·절차·구조 질문이면 먼저 부른다. topic 에 핵심 낱말을 띄어쓰기로.",
    parameters: { type: "object", properties: { topic: { type: "string", description: "관심 주제 낱말(예: '자가 반납 사진')" } } } },
  { type: "function", name: "team_members", description: "현재 인원 명단(cs_members). team 은 A~E(E=CSS·지방) — 비우면 전 부서(경영지원·영업·IT·운영지원 포함, title 팀장·파트장). '팀원별로 몇 건씩' 같은 사람별 집계를 할 때 먼저 불러 0건인 사람도 넣는다.",
    parameters: { type: "object", properties: { team: { type: "string" } } } },
  { type: "function", name: "query_rows", description: "허용된 표에서 조건으로 행을 읽는다(읽기 전용, 최대 300행 — 지식 표 40행). 날짜 칸은 텍스트라 gte/lt 로 'YYYY-MM-01' ~ 다음 달 1일로 자른다. ilike 는 부분 일치. 건수만 필요하면 tally 를 쓴다.",
    parameters: { type: "object", properties: {
      table: { type: "string", enum: Object.keys(CATALOG) },
      select: { type: "array", items: { type: "string" }, description: "받을 칸(생략하면 기본 칸)" },
      filters: { type: "array", items: { type: "object", properties: { col: { type: "string" }, op: { type: "string", enum: [...FILTER_OPS] }, value: { type: "string", description: "in 은 쉼표로 여러 값" } }, required: ["col", "op", "value"] } },
      order: { type: "string", description: "칸.asc 또는 칸.desc" }, limit: { type: "number" } }, required: ["table"] } },
  { type: "function", name: "tally", description: `행 대신 묶음별 건수를 센다(서버가 최대 20,000행을 넘겨 읽음). '팀별 이번 달 AS 건수', '작성자별 불만 처리 수', '달별 접수 추이', '같은 기기에 드럼 몇 번' 같은 세기 질문은 query_rows 대신 이것. group_by 에 표 칸(최대 3개) 또는 '${AUTHOR_TEAM}'(작성자의 명단 팀 — 점검·AS 팀별 건수는 이것이 KPI 와 같다). distinct=true 면 묶음마다 업체 중복 제거 수.`,
    parameters: { type: "object", properties: {
      table: { type: "string", enum: Object.keys(CATALOG) },
      filters: { type: "array", items: { type: "object", properties: { col: { type: "string" }, op: { type: "string", enum: [...FILTER_OPS] }, value: { type: "string" } }, required: ["col", "op", "value"] } },
      group_by: { type: "array", items: { type: "string" } },
      distinct: { type: ["boolean", "string"], description: "true = 업체 칸 중복 제거 수, 칸 이름 = 그 칸 서로 다른 값 수" },
      date_bucket: { type: "string", enum: ["", "day", "week", "month"], description: "표 날짜 칸으로 묶기(week = 그 주 월요일)" } }, required: ["table"] } },
  { type: "function", name: "vendor_team", description: "업체명 목록의 담당 팀(A~E)을 일정·접수·점검·워킨맵 기록으로 찾는다. 팀 칸이 없거나 비어 있는 표(미수·초과료·임대리스트·재계약)에서 '팀별'로 추릴 때 쓴다.",
    parameters: { type: "object", properties: { vendors: { type: "array", items: { type: "string" } } }, required: ["vendors"] } },
];
const TOOLS = [...BASE_TOOLS, ...EXT_TOOLS.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters }))];

const INSTRUCTION = () => `너는 복합기 렌탈·IT 유지보수 회사 "퍼스트전산"의 사내 데이터 비서다. 직원이 표 전체·사람·팀·OKR·KPI·일정·운영 상태·앱 사용법을 묻는다.
도구로 직접 조회해서 답한다. 지어내지 않는다. 조회 결과에 없으면 없다고 말한다.
요령:
- 팀(A~E): as_tickets.team / service_receptions.region('수도권C'→C, '지방'→E) 은 믿을 만하다. jeomgeom·as_records 의 지역 칸은 대부분 'A' — 팀별 건수는 tally group_by '${AUTHOR_TEAM}'(작성자 명단 팀). misu.지역·overage(팀 없음)·vendor_info·recontract 는 팀이 없거나 비어 있으니 먼저 조건(달·등급 등)으로 추린 뒤 vendor_team 으로 팀을 붙여 걸러라.
- 달: 날짜 칸 gte 'YYYY-MM-01' 과 lt '다음달-01'. 올해는 ${new Date(Date.now() + KST).getUTCFullYear()}년, 오늘(KST)은 ${kstToday()}, 이번 주는 ${weekRange()} (월~일). "이번 주"는 그 범위, "지난주"는 그 전 7일.
- 세는 질문(몇 건·몇 곳·누가 많이·추이)은 tally 로 센다. 300행을 받아 직접 세지 않는다. query_rows 는 근거 행을 보여 줄 때만.
- 사람별 집계("팀원별 몇 건씩"): team_members 로 명단을 받고, 표의 작성자/author/등록자/입력자/assignee 칸으로 세어 명단의 모든 사람을 0건까지 적는다. 명단에 없는 작성자가 있으면 "그 외"로 따로 적는다.
- 조회 결과가 limit 에 걸려 잘렸으면(truncated) 조건을 더 좁혀 다시 조회하거나 tally 로 센다. 잘린 채로 세지 않는다.
- "CS가 체크할 곳" 같은 말은 미수 개월·금액이 크거나 약속일이 지난 곳, 최종상태가 비어 있거나 미완료인 곳으로 해석하고, 해석 기준을 답에 적어라.
- 같은 업체가 여러 행이면 업체 단위로 묶어 최신 행 기준으로 말한다.
- 답 형식: 첫 줄 결론(몇 곳, 기준). 그 아래 목록을 "· 업체명 — 핵심 숫자/상태 [출처 날짜]"로 최대 40줄. 마지막에 기준과 빠졌을 수 있는 것 한 줄. 존댓말. 전화번호는 도구가 주지 않는다 — 연락처를 물으면 "업체 검색 카드에서 확인"으로 안내한다.
- 안내 문구·문자 초안을 요청하면 목록 아래에 바로 쓸 수 있는 문구를 한 벌 적는다(업체명 자리는 {업체명}).
- 복합기 기술 질문은 세 표를 순서대로 쓴다. ① 교체법·절차·설정·체크 순서("ACR 센서 교체법", "토너 공급에러 체크 순서", "9100 포트 설정")는 knowledge_docs(가이드 450편 — title/content ilike, 부품·에러 낱말로 두세 번 다르게 찾아본다)를 먼저 읽고 본문 순서를 그대로 옮겨 답한다. ② 증상 원인("X3220 세로줄 원인", "묻어남")은 copier_playbook(증상별 원인·점검 순서·부품 — series/symptom/title/summary ilike)을 보고 ③ copier_notes(실제 처리이력 — model/title/content ilike, 최신순 20~40건)로 뒷받침한다. 가이드가 있으면 가이드를 답의 뼈대로 쓰고 처리이력은 사례로만 덧붙인다. 답은 "가능한 원인(많은 순) → 현장 점검 순서 → 교체 부품 → 실제 사례 n건(날짜·처리자·한 줄)" 꼴로, 사례가 없으면 플레이북 초안임을 밝힌다. 안전·전원 관련 작업은 전원 차단을 먼저 적는다.
- 이 앱(FIELD)·업무 절차·"어느 탭에서", "어떻게 해" 질문은 app_guide 도구(topic 에 핵심 낱말)로 설명서를 읽고 그대로 답한다. 설명서에 없는 기능은 없다고 말한다. 2026년 10월에 바뀐 것은 key 'recent' 에 있다.
- 회사·팀·사람 질문은 team_members 와 표에서 확인한 것만. 모르는 것은 모른다고 한다. 사람은 기록 사실로만 말하고 인상 평가·서열 표현은 쓰지 않는다.
- KPI·달성률·순위·팀 보드 숫자는 앱이 붙인 "앱 계산값" 이 있으면 그 숫자를 그대로 쓴다(화면과 같아야 한다). 없으면 직접 센 값임을 밝히고 "화면 값과 다를 수 있음"을 적는다.
- 주간 회고·분기 계획·골든카드·자기 목표·부서 달력은 묻는 사람과 같은 팀(부서) 것만 보인다. 걸러져 안 보인 것이 있으면(hidden_by_scope) 그렇다고 말한다.
- 그림(카드·리포트·포스터·안내문)을 "이미지로" 만들어 달라고 하면: 마크다운 코드블록 \`\`\`svg 안에 자체 완결 SVG 하나를 쓴다 — width="1080" height="1350"(세로) 또는 1080×1080, 같은 viewBox, 외부 폰트·이미지·스크립트·링크 없음, font-family="Pretendard, Apple SD Gothic Neo, Malgun Gothic, Noto Sans KR, sans-serif", 글자 크기 22 이상, 한 줄 28자 이내로 상자 밖으로 안 나가게, 긴 주소는 두 줄로. 회사명은 "퍼스트전산"(영문 쓰지 않음). 내용(업체명·기기·주소·증상·날짜)은 기록에 있는 것만. 코드블록 아래에 함께 보낼 문자 문구를 3줄 이내로 한 문단 쓴다. 앱이 그 SVG 를 그림으로 바꿔 저장·복사·문자(MMS) 전송 단추를 보여 주므로 "저장하세요" 같은 설명은 쓰지 않는다.

${OKR_GUIDE}

쓸 수 있는 표와 칸(칸 이름은 이 그대로만 — 없는 칸을 고르면 빠진다):
${catalogText()}`;

// 분석 모드 지시문 꼬리(설계 5-1)
const ANALYSIS_TAIL = `
[분석 모드] 이 질문은 사람·팀·원인 분석이다. 세는 것은 도구(okr·tally·활동 도구)에 맡기고, 너는 읽고 판단한다.
답 형식(이 순서, 각 제목 줄 그대로):
① 결론 — 한 줄(숫자·기간·기준)
② 잘된 점 — 2~4개
③ 부족한 점 — 2~4개, 각각 어떤 규칙(작성가이드·KPI 기준)에 어긋났는지
④ 근거 — "· [2026-10-W3 · 목표 5 · 부분달성] 실제결과 '…' — 사유 칸 비어 있음" 꼴, 최대 12줄
⑤ 다음에 할 일 — 1~3개
⑥ 계산 기준·빠졌을 수 있는 것 — 한 줄
사람 질문은 기록 사실로만, 인상 평가·서열 표현 금지.`;

/** 앱 꾸러미 → 지시 글. 25KB 넘으면 버린다 */
function packsText(packs: unknown): { text: string; used: string[]; dropped?: string } {
  if (!packs || (typeof packs !== "object")) return { text: "", used: [] };
  const list: Array<{ kind: string; title?: string; data: unknown }> = Array.isArray(packs)
    ? (packs as Array<Record<string, unknown>>).filter((p) => p && typeof p === "object").map((p) => ({ kind: String(p.kind || p.name || "pack"), title: p.title ? String(p.title) : undefined, data: p.data ?? p }))
    : Object.entries(packs as Record<string, unknown>).map(([kind, data]) => ({ kind, data }));
  if (!list.length) return { text: "", used: [] };
  const body = JSON.stringify(askMask(list));
  if (body.length > PACKS_MAX) return { text: "", used: [], dropped: `앱 계산값이 ${Math.round(body.length / 1000)}KB 로 상한(25KB)을 넘어 쓰지 않았습니다` };
  return { text: `\n\n[앱 계산값 — 화면과 같은 숫자. KPI·달성률·순위는 이 값을 그대로 쓴다]\n${body}`, used: list.map((p) => p.kind) };
}

/** 오늘(KST) ai_usage 합계 — 서비스 키로 읽는다(anon 은 권한 없음). 못 읽으면 null */
async function spentToday(sbUrl: string, sbHeaders: Record<string, string>): Promise<number | null> {
  if (!sbUrl || !sbHeaders.apikey) return null;
  const since = new Date(Date.parse(`${kstToday()}T00:00:00+09:00`)).toISOString();
  try {
    const res = await fetch(`${sbUrl}/rest/v1/ai_usage?select=usd&created_at=gte.${encodeURIComponent(since)}&limit=5000`, { headers: sbHeaders, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const rows = await res.json() as Array<{ usd: number | string | null }>;
    return rows.reduce((n, r) => n + (Number(r.usd) || 0), 0);
  } catch { return null; }
}

function evidenceOf(tool: string, args: Record<string, unknown>, result: Record<string, unknown>, seq: number, toolTitle?: string): Evidence[] {
  const out: Evidence[] = [];
  const pushRows = (title: string, table: string, rows: unknown, count?: unknown, truncated?: unknown) => {
    if (!Array.isArray(rows) || !rows.length || typeof rows[0] !== "object") return;
    const list = askMask((rows as Array<Record<string, unknown>>).slice(0, 120));
    const columns = [...new Set(list.flatMap((r) => Object.keys(r || {})))].slice(0, 30);
    out.push({ id: `${seq}-${out.length}`, tool, title, table, columns, rows: list, count: Number(count ?? rows.length) || rows.length, truncated: !!truncated || rows.length > 120 });
  };
  if (tool === "tally" && Array.isArray(result.groups)) {
    const rows = (result.groups as Array<{ key: Record<string, string>; count: number; distinct?: number }>).map((g) => ({ ...g.key, 건수: g.count, ...(g.distinct != null ? { 업체수: g.distinct } : {}) }));
    pushRows(`${tableLabel(String(result.table || args.table || ""))} 건수 · 합계 ${result.total ?? 0}`, String(result.table || ""), rows, rows.length, result.truncated);
    return out;
  }
  if (Array.isArray(result.evidence)) {
    for (const e of result.evidence as Array<Record<string, unknown>>) pushRows(String(e.title || toolTitle || tool), String(e.table || ""), e.rows, e.count, e.truncated);
    if (out.length) return out;
  }
  if (Array.isArray(result.rows)) {
    const table = String(result.table || "");
    pushRows(table ? `${tableLabel(table)} · ${result.count ?? (result.rows as unknown[]).length}건` : (toolTitle || TOOL_LABEL[tool] || tool), table, result.rows, result.count, result.truncated);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY") || "";
    if (!apiKey) return Response.json({ error: "OPENAI_API_KEY missing" }, { status: 500, headers: jsonHeaders });
    const body = await req.json().catch(() => ({}));
    const question = String(body.question || "").trim().slice(0, 600);
    if (!question) return Response.json({ error: "question 이 필요합니다" }, { status: 400, headers: jsonHeaders });
    const mode: Mode = body.mode === "analysis" ? "analysis" : "data";
    const author = String(body.author || "").trim().slice(0, 40);
    const model = Deno.env.get("OPENAI_ASK_MODEL") || Deno.env.get("OPENAI_REPORT_MODEL") || "gpt-5.5";
    const effort = mode === "analysis" ? (Deno.env.get("OPENAI_ASK_ANALYSIS_EFFORT") || "medium") : "medium";
    const maxUsd = envNum("ASK_MAX_USD", 1.5);
    const dailyUsd = envNum("ASK_DAILY_USD", 20);
    const maxRounds = MAX_ROUNDS[mode];
    const t0 = Date.now();

    const sbUrl = Deno.env.get("SUPABASE_URL") || ""; const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const sbHeaders = { apikey: sbKey, Authorization: `Bearer ${sbKey}`, "Content-Type": "application/json" };

    // 하루 총액(분석 모드만 거절)
    if (mode === "analysis") {
      const spent = await spentToday(sbUrl, sbHeaders);
      if (spent != null && spent >= dailyUsd) {
        return Response.json({ error: `오늘 분석 질문 한도($${dailyUsd})를 넘었습니다(오늘 $${spent.toFixed(2)}). 일반 질문은 계속 됩니다 — 내일 다시 물어 주세요.`, code: "daily_limit", spent, cap: dailyUsd }, { status: 429, headers: jsonHeaders });
      }
    }

    // 명단·묻는 사람
    let members: Member[] = []; let membersError = "";
    try { members = await loadMembers(); } catch (e) { membersError = String((e as Error).message).slice(0, 120); }
    const me = members.find((m) => m.name === author);
    const asker: Asker = { name: author, team: me?.team || "", dept: me?.dept || "", title: me?.title || "" };
    const byName = new Map(members.map((m) => [m.name, m]));
    const teamOf = (name: string) => { const m = byName.get(String(name || "").trim()); return m ? (memberTeamLetter(m) || m.team || m.dept) : ""; };
    const teamOfGroup = (name: string) => { const m = byName.get(String(name || "").trim()); return m ? (m.team || m.dept) : ""; };
    const ctx: ToolCtx = { rest: REST, mask: askMask, today: kstToday(), asker, mode, members, teamOf, teamOfGroup };

    // 사용자 메시지 — 질문 + 라우터 단서 + 이어묻기 + 앱 꾸러미
    const people = (Array.isArray(body.people) ? body.people : []).slice(0, 10).map((p: unknown) => typeof p === "string" ? p : String((p as Record<string, unknown>)?.name || "")).filter(Boolean);
    const teams = (Array.isArray(body.teams) ? body.teams : []).slice(0, 6).map(String).filter(Boolean);
    const contextText = String(body.context || "").trim().slice(0, 1500);
    const packs = packsText(body.packs);
    const hints = [
      author ? `묻는 사람: ${author}${me ? ` (${memberTeamLetter(me) ? `${memberTeamLetter(me)}팀` : me.team || me.dept}${me.title ? ` ${me.title}` : ""})` : " (명단에 없음)"}` : "",
      people.length ? `질문 속 사람(명단): ${people.join(", ")}` : "",
      teams.length ? `질문 속 팀: ${teams.join(", ")}` : "",
      contextText ? `앞 대화 요약(이어서 묻기):\n${askMaskText(contextText)}` : "",
    ].filter(Boolean).join("\n");
    const userText = `${question}${hints ? `\n\n[참고]\n${hints}` : ""}${packs.text}`;

    const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
    const system = INSTRUCTION() + (mode === "analysis" ? ANALYSIS_TAIL : "");
    let input: unknown[] = [{ role: "system", content: system }, { role: "user", content: userText }];
    let previous: string | undefined;
    const calls: string[] = []; const evidence: Evidence[] = [];
    let usage = emptyUsage();
    let prices: Prices | null = null;
    const usdNow = () => (prices ? priceUsage(usage, prices) : null);
    let stopped: null | "cost" | "time" | "rounds" = null;
    let seq = 0;

    // 단가는 비용 상한 판단에 필요 — 처음 한 번
    prices = await loadPrices(sbUrl, sbHeaders, (k) => Deno.env.get(k), model);

    for (let round = 0; round < maxRounds; round += 1) {
      const finalRound = stopped !== null;
      const res = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers, body: JSON.stringify({
        model, reasoning: { effort }, tools: TOOLS, ...(finalRound ? { tool_choice: "none" } : {}), input, ...(previous ? { previous_response_id: previous } : {}),
      }) });
      if (!res.ok) return Response.json({ error: (await res.text()).slice(0, 300), model, calls }, { status: 502, headers: jsonHeaders });
      const data = await res.json();
      previous = data.id;
      usage = addUsage(usage, data.usage);
      const fnCalls = (data.output || []).filter((o: { type: string }) => o.type === "function_call");
      if (!fnCalls.length || finalRound) {
        const answer = data.output_text || (data.output || []).flatMap((o: { content?: Array<{ text?: string }> }) => o.content || []).map((c: { text?: string }) => c.text || "").join("\n") || "";
        const usd = usdNow();
        await logUsage(sbUrl, sbHeaders, { fn: mode === "analysis" ? "data-ask:analysis" : "data-ask", model, question, author, usage, usd, ms: Date.now() - t0 });
        const last = [...evidence].reverse().find((e) => e.table && e.tool !== "tally");
        const note = stopped === "cost" ? `여기까지 읽고 답했습니다(조회 ${calls.length}회, 한 질문 상한 $${maxUsd}) — 범위를 좁히면 더 정확합니다`
          : stopped === "time" ? `여기까지 읽고 답했습니다(조회 ${calls.length}회, ${Math.round(WALL_MS / 1000)}초 상한) — 범위를 좁히면 더 정확합니다`
          : stopped === "rounds" ? `여기까지 읽고 답했습니다(조회 ${calls.length}회, 왕복 상한 ${maxRounds}) — 범위를 좁히면 더 정확합니다` : "";
        return Response.json({
          answer: askMaskText(String(answer).trim()).slice(0, 8000),
          mode, evidence: evidence.slice(-12),
          rows: last ? last.rows : [], columns: last ? last.columns : [], table: last ? last.table : "",
          calls, model, usage, cost: { usd, priced: prices.known, model }, ms: Date.now() - t0,
          limits: { rounds: usage.rounds, maxRounds, maxUsd, stopped, note },
          asker: { name: author, team: me ? (memberTeamLetter(me) || me.team || me.dept) : "" },
          packs: { used: packs.used, ...(packs.dropped ? { dropped: packs.dropped } : {}) },
          ...(membersError ? { warnings: [`명단을 못 읽었습니다: ${membersError}`] } : {}),
        }, { headers: jsonHeaders });
      }

      // 상한 판단 — 이번 도구 결과까지는 넣고, 다음 왕복을 마무리(도구 없음)로
      const usd = usdNow();
      if (usd != null && usd >= maxUsd) stopped = "cost";
      else if (Date.now() - t0 >= WALL_MS) stopped = "time";
      else if (round >= maxRounds - 2) stopped = "rounds";

      input = [];
      for (const call of fnCalls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(call.arguments || "{}"); } catch { /* 빈 인자 */ }
        let result: Record<string, unknown>;
        let toolTitle: string | undefined;
        if (stopped === "cost" || stopped === "time") result = { error: "상한에 걸려 조회를 멈췄습니다 — 지금까지 받은 것으로 답하세요" };
        else {
          try {
            if (call.name === "query_rows") result = await queryRows(args, ctx);
            else if (call.name === "tally") result = await runTally(args, { rest: REST, teamOf, rowAllowed: (cat, row) => scopeAllows(cat, row, asker, teamOfGroup) });
            else if (call.name === "vendor_team") result = await vendorTeam(args, ctx);
            else if (call.name === "team_members") result = teamMembers(args, ctx);
            else if (call.name === "app_guide") result = appGuide(args);
            else {
              const ext = EXT_TOOLS.find((t) => t.name === call.name);
              toolTitle = ext?.title;
              const r = ext ? await ext.run(args, ctx) : { error: "모르는 도구" };
              result = askMask((r && typeof r === "object" ? r : { result: r }) as Record<string, unknown>);
            }
          } catch (e) { result = { error: String((e as Error).message || e).slice(0, 300) }; }
        }
        seq += 1;
        calls.push(`${call.name}(${JSON.stringify(args).slice(0, 160)}) → ${"error" in result ? result.error : "count" in result ? `${result.count}행` : "total" in result ? `${result.total}건` : "ok"}`);
        if (!("error" in result)) evidence.push(...evidenceOf(call.name, args, result, seq, toolTitle));
        input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result).slice(0, 60000) });
      }
      if (stopped) input.push({ role: "user", content: stopped === "rounds" ? "조회 횟수 상한입니다. 더 조회하지 말고 지금까지 받은 결과로 답하세요. 빠졌을 수 있는 것을 마지막 줄에 적으세요." : `${stopped === "cost" ? "비용" : "시간"} 상한에 걸렸습니다. 더 조회하지 말고 지금까지 받은 결과로 답하고, 마지막 줄에 "범위를 좁혀 주세요"라고 적으세요.` });
    }
    return Response.json({ error: "조회가 너무 많아 멈췄습니다 — 질문을 좁혀 주세요", calls, model }, { status: 502, headers: jsonHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: jsonHeaders });
  }
});
