/**
 * 통합검색 "무엇이든 묻기" 라우터 — 순수 함수(설계안 docs/tasks/search-ask-everything-2026-10-29.md 7-1).
 *
 * 입력 글 하나 → 어디로 물을지:
 *  1. 문장 아님(QUESTION_RE 불일치 + 3어절 이하) → search(업체·기번 검색, 지금과 같음)
 *  2. 질문 속 이름이 명단(cs_members 활성) 이름과 일치 → analysis(업체 찾기 건너뜀 — 사람 이름이 업체 별칭에 붙는 사고 방지)
 *     단 "업체 ○○"·"○○ 업체"로 적으면 사람으로 보지 않는다(동명이인, 설계안 R6)
 *  3. OKR·KPI·달성률·분석·패턴·누락·잘됐/안 됐·부족 단서 → analysis.
 *     원인·왜·이유는 팀·사람·KPI 단서와 같이 있을 때만 analysis — "X3220 세로줄 원인"은 지식 질문이라 data
 *  4. 팀·기간·등급·전체·지식·사용법 단서(DATA_RE)·조건 단서(N개월 이상 등) → data
 *  5. 그 밖 → entity(질문 속 업체가 확실하면 entity-ask, 아니면 data — 확실한지는 화면이 resolveCandidates 로 본다)
 * KPI·현황·순위·빨강·미처리 단서면 packs 에 "kpi"(앱 계산값을 붙인다).
 * 응답 → 답 카드(AskAnswer.view) 변환(toAskAnswerView)도 여기 — 순수.
 * 테스트: tests/askRoute.test.ts
 */
import type { AskAnswerView, AskEvidenceGroup, AskLimit, AskMode } from "./AskAnswer.view";

export type AskRouteKind = "search" | "entity" | "data" | "analysis";
export type AskPeriod = "week" | "month" | "quarter";
export type AskPerson = { name: string; team?: string };
export type AskMember = { name: string; team?: string; active?: boolean };

export type AskRoute = {
  kind: AskRouteKind;
  people: AskPerson[];
  /** A~E (CSS팀 = E) */
  teams: string[];
  /** 붙일 앱 계산값 — 지금은 "kpi" 하나 */
  packs: string[];
  /** KPI 꾸러미 기간(이번 주 기본) */
  period: AskPeriod;
  /** 화면 라우트 한 줄 */
  note: string;
};

/** 문장인가(질문·요청) — 이게 아니면 업체명·기번 검색으로 본다 */
export const QUESTION_RE = /[?？]|몇|언제|어디|어떻|무슨|뭐|얼마|줘|주세요|알려|정리|요약|목록|리스트|있어|있나|됐어|했어|중에|추려|비교|평균|합계|건수|누가|왜|해야|필요|만들|분석/;
/** 표 전체를 조건으로 추리는 질문의 단서 — 팀·기간·등급·"각각/씩/전체", 지식(증상·처리·사용법) 질문(2026-10-12) */
export const DATA_RE = /[A-E]\s*팀|이번\s*주|지난\s*주|이번\s*달|지난\s*달|\d{1,2}\s*월|등급|전체|모든|각각|몇\s*개씩|씩|리스트|목록|순위|합계|평균|건수|누가|제일|가장|원인|증상|고치|수리\s*방법|처리\s*방법|사용법|어떻게\s*(해|하|써|보|쓰)|매뉴얼|설명서|기능|앱에서|어느\s*탭|어디서/;
/** 조건으로 추리는 말(업체 이름이 아님) — "미수 3개월 이상 중 방문 안 한 곳" */
const CONDITION_RE = /\d+\s*(개월|일|주|건|번|회)\s*(이상|이하|넘|미만|초과|지난)|안\s*한\s*곳|없는\s*곳|안\s*간\s*곳|빠진\s*곳/;
/** 분석 단서 */
const ANALYSIS_RE = /OKR|오케이알|KPI|달성\s*률|달성도|분석|패턴|누락|미작성|잘\s*(됐|되었|된|한|했)|안\s*(됐|되었|된)|부족|약해|약한|빨강|빨간|어느\s*부분|평가|추이|성과/i;
/** 원인·왜 — 팀·사람·KPI 와 같이 있을 때만 분석 */
const CAUSE_RE = /원인|왜|이유/;
/** 복합기·앱 지식 질문 — 원인이 들어 있어도 분석이 아니라 지식 검색 */
const KNOWLEDGE_RE = /증상|고치|수리\s*방법|처리\s*방법|사용법|어떻게\s*(해|하|써|보|쓰)|매뉴얼|설명서|앱에서|어느\s*탭|어디서|세로줄|가로줄|번짐|걸림|잼|에러|오류\s*코드|부팅|소음|용지|토너|드럼|인쇄|스캔|팩스|복사기|복합기/;
/** KPI 꾸러미 단서 */
const KPI_PACK_RE = /KPI|달성\s*률|달성도|목표|순위|현황|빨강|빨간|미처리|진행\s*률|팀\s*보드|페이스/i;
const KPI_WORD_RE = /KPI|목표|순위|진행\s*률|재계약|점검|미처리|현황/i;

const TEAM_LABEL: Record<string, string> = { A: "A", B: "B", C: "C", D: "D", E: "CSS" };

/** 글 속 팀(A~E, CSS팀 = E). 순서대로, 중복 없이 */
export function teamsIn(text: string): string[] {
  const out: string[] = [];
  const add = (t: string) => { if (!out.includes(t)) out.push(t); };
  for (const m of text.matchAll(/(CSS|[A-Ea-e])\s*팀/g)) add(m[1].toUpperCase() === "CSS" ? "E" : m[1].toUpperCase());
  if (/CSS/i.test(text)) add("E");
  return out;
}

/** 글 속 명단 이름(두 글자 이상, 활성). "업체 ○○"·"○○ 업체"는 사람 아님 */
export function peopleIn(text: string, members: AskMember[]): AskPerson[] {
  const out: AskPerson[] = [];
  const seen = new Set<string>();
  const list = members.filter((m) => m.active !== false && String(m.name || "").trim().length >= 2)
    .sort((a, b) => b.name.trim().length - a.name.trim().length); // 긴 이름 먼저
  for (const m of list) {
    const name = m.name.trim();
    if (seen.has(name) || !text.includes(name)) continue;
    if (text.includes(`업체 ${name}`) || text.includes(`${name} 업체`) || text.includes(`업체명 ${name}`)) continue;
    // 이미 잡힌 더 긴 이름의 일부면 건너뛴다(예: "김민" ⊂ "김민수")
    if ([...seen].some((s) => s.includes(name))) continue;
    seen.add(name);
    out.push(m.team ? { name, team: m.team } : { name });
    if (out.length >= 10) break;
  }
  return out;
}

export function periodIn(text: string): AskPeriod {
  if (/분기|Q[1-4]/i.test(text)) return "quarter";
  if (/이번\s*달|지난\s*달|이달|\d{1,2}\s*월|월간|한\s*달/.test(text)) return "month";
  return "week";
}

export function isSentence(text: string): boolean {
  const t = text.trim();
  return QUESTION_RE.test(t) || t.split(/\s+/).filter(Boolean).length >= 4;
}

const who = (people: AskPerson[]) => people.slice(0, 3).map((p) => (p.team ? `${p.name}(${TEAM_LABEL[p.team] || p.team})` : p.name)).join(", ") + (people.length > 3 ? ` 외 ${people.length - 3}명` : "");
const teamWord = (teams: string[]) => teams.map((t) => (t === "E" ? "CSS팀" : `${t}팀`)).join("·");

/**
 * 라우트. forced 가 auto 가 아니면 그 방식(사람·팀·꾸러미 단서는 그대로 뽑는다).
 * members = cs_members 명단(이름·팀·활성). 못 읽었으면 빈 배열 — 그럼 사람 단서만 빠진다.
 */
export function askRoute(raw: string, members: AskMember[] = [], forced: "auto" | AskRouteKind = "auto"): AskRoute {
  const text = raw.trim();
  const people = peopleIn(text, members);
  const teams = teamsIn(text);
  for (const p of people) if (p.team && /^[A-E]$/.test(p.team) && !teams.includes(p.team)) teams.push(p.team);
  const period = periodIn(text);
  const wantKpi = KPI_PACK_RE.test(text);
  const base = { people, teams, period, packs: [] as string[] };
  const withPacks = (kind: AskRouteKind) => (kind === "analysis" || kind === "data") && wantKpi ? ["kpi"] : [];

  if (forced !== "auto") {
    const note = forced === "search" ? "업체·기번 검색으로 찾았습니다" : forced === "entity" ? "업체 질문으로 물었습니다" : forced === "analysis" ? "분석 질문으로 물었습니다(방식 고정)" : "전체 데이터·지식 질문으로 물었습니다(방식 고정)";
    return { ...base, kind: forced, packs: withPacks(forced), note };
  }
  if (!text || !isSentence(text)) return { ...base, kind: "search", note: "" };

  const knowledge = KNOWLEDGE_RE.test(text);
  const analysisCue = ANALYSIS_RE.test(text);
  const causeCue = CAUSE_RE.test(text) && !knowledge && (people.length > 0 || teams.length > 0 || KPI_WORD_RE.test(text));

  if (people.length) {
    const what = /OKR|오케이알/i.test(text) ? "OKR·사람 분석" : "사람 분석";
    return { ...base, kind: "analysis", packs: withPacks("analysis"), note: `${what}으로 물었습니다 — ${who(people)}` };
  }
  if (analysisCue || causeCue) {
    const what = /OKR|오케이알/i.test(text) ? "OKR 분석" : /KPI|달성|순위|빨강|빨간/i.test(text) ? "KPI 분석" : "분석";
    const scope = teams.length ? ` — ${teamWord(teams)}` : "";
    const packNote = wantKpi ? " · 홈 KPI 계산값을 붙입니다" : "";
    return { ...base, kind: "analysis", packs: withPacks("analysis"), note: `${what} 질문으로 물었습니다${scope}${packNote}` };
  }
  if (DATA_RE.test(text) || CONDITION_RE.test(text) || knowledge) {
    const note = knowledge && !teams.length ? "복합기·앱 사용법 같은 지식 질문으로 보여 전체 데이터·지식에 물었습니다" : `팀·기간·조건으로 추리는 질문으로 보여 전체 데이터에 물었습니다${teams.length ? ` — ${teamWord(teams)}` : ""}`;
    return { ...base, kind: "data", packs: withPacks("data"), note };
  }
  return { ...base, kind: "entity", note: "질문 속 업체부터 찾습니다 — 없으면 전체 데이터에 묻습니다" };
}

/* ───────────── data-ask 응답 → 답 카드 ───────────── */

export type DataAskEvidence = { id?: string; tool?: string; title?: string; table?: string; columns?: string[]; rows?: Array<Record<string, unknown>>; count?: number; truncated?: boolean };
export type DataAskResponse = {
  answer?: string;
  mode?: string;
  evidence?: DataAskEvidence[];
  rows?: Array<Record<string, unknown>>;
  columns?: string[];
  table?: string;
  calls?: string[];
  model?: string;
  cost?: { usd?: number | null; priced?: boolean; model?: string } | null;
  ms?: number;
  limits?: { rounds?: number; maxRounds?: number; maxUsd?: number; stopped?: null | "cost" | "time" | "rounds"; note?: string } | null;
  packs?: { used?: string[]; dropped?: string } | null;
  warnings?: string[];
};

/** 판정 칸 — 비어 있으면 노랑(OKR 미작성 목표) */
const WARN_COLS = ["판정", "종합판정", "judgment"];

export function evidenceGroups(res: DataAskResponse, mask: <T>(v: T) => T = (v) => v): AskEvidenceGroup[] {
  const list = Array.isArray(res.evidence) ? res.evidence : [];
  const groups: AskEvidenceGroup[] = list.filter((e) => e && Array.isArray(e.rows)).map((e, i) => {
    const rows = mask(e.rows || []);
    const columns = Array.isArray(e.columns) && e.columns.length ? e.columns : undefined;
    const keys = columns || Object.keys(rows[0] || {});
    const warn = WARN_COLS.find((c) => keys.includes(c));
    const more = e.truncated && typeof e.count === "number" && e.count > rows.length ? ` (전체 ${e.count.toLocaleString()} 중)` : "";
    return { id: String(e.id || `${e.tool || "ev"}-${i}`), title: `${e.title || e.table || e.tool || "근거"}${more}`, tool: e.tool, rows, ...(columns ? { columns } : {}), ...(warn ? { warnWhenEmpty: warn } : {}) };
  });
  // 옛 응답(evidence 없음) — 마지막 표 하나
  if (!groups.length && Array.isArray(res.rows) && res.rows.length) {
    groups.push({ id: "last", title: res.table || "조회 결과", rows: mask(res.rows), ...(res.columns?.length ? { columns: res.columns } : {}) });
  }
  return groups;
}

export function usageLineOf(res: DataAskResponse): string {
  const parts: string[] = [];
  const model = res.model || res.cost?.model;
  if (model) parts.push(model);
  parts.push(`조회 ${(res.calls || []).length}번`);
  if (res.cost && res.cost.priced && typeof res.cost.usd === "number") parts.push(`$${res.cost.usd.toFixed(2)}`);
  else parts.push("금액 계산 불가");
  if (typeof res.ms === "number") parts.push(`${Math.round(res.ms / 1000)}초`);
  return parts.join(" · ");
}

export function limitOf(res: DataAskResponse): AskLimit | undefined {
  const s = res.limits?.stopped;
  if (!s) return undefined;
  return { reason: s, calls: (res.calls || []).length, ...(res.cost && typeof res.cost.usd === "number" ? { usd: res.cost.usd } : {}) };
}

/** 응답 → 답 카드. answer 는 본문(body) 그대로(서버 지시문이 결론·잘된 점·부족한 점 순서로 쓴다) */
export function toAskAnswerView(question: string, res: DataAskResponse, body: string, mask: <T>(v: T) => T = (v) => v): AskAnswerView {
  const mode: AskMode = res.mode === "analysis" ? "analysis" : "data";
  const notes = [res.limits?.note, res.packs?.dropped, ...(res.warnings || [])].filter((x): x is string => !!x && !!String(x).trim());
  return {
    question, mode, conclusion: "", strengths: [], gaps: [], nextSteps: [],
    body: body || "(답이 비어 있습니다)",
    evidence: evidenceGroups(res, mask),
    usageLine: usageLineOf(res),
    ...(notes.length ? { basis: notes.join(" · ") } : {}),
    ...(limitOf(res) ? { limit: limitOf(res) } : {}),
  };
}

/** 이어서 묻기 요약(서버 1,500자 상한 안) — 앞 질문 + 답 앞부분 */
export function followUpContext(question: string, answer: string, max = 1400): string {
  const q = `앞 질문: ${question.trim().slice(0, 200)}`;
  const a = answer.replace(/<svg[\s\S]*?<\/svg>/gi, "").replace(/\n{3,}/g, "\n\n").trim();
  return `${q}\n앞 답 요약: ${a.slice(0, Math.max(0, max - q.length - 10))}`;
}

/** 근거 행의 업체 칸 — 있으면 업체 360 으로 열 수 있다 */
const VENDOR_COLS = ["업체", "업체명", "_업체명", "거래처", "거래처명", "상호", "고객명", "vendor", "vendor_name", "company", "name_vendor"];
export function vendorOfRow(row: Record<string, unknown>): string {
  for (const c of VENDOR_COLS) {
    const v = row[c];
    if (typeof v === "string" && v.trim().length >= 2) return v.trim();
  }
  return "";
}
