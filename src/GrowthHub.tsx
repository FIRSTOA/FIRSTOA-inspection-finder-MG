import { useEffect, useMemo, useRef, useState } from "react";
import { AUTHOR_TEAMS, useAuthorBook } from "./authors";
import PortalSelect from "./PortalSelect";
import { SUPABASE_ANON, SUPABASE_URL } from "./supabase";
import {
  GOLDEN_CATEGORIES,
  GOLDEN_QUESTIONS,
  getGoldenCard,
  getQuarterlyPlan,
  getWeeklyNotes,
  saveGoldenCard,
  saveQuarterlyPlan,
  type GoldenCard,
  type LevelGoal,
  type QuarterlyPlan,
  type WeeklyNoteRow,
} from "./visits";

type Tab = "records" | "plan" | "result" | "mission" | "golden";
type RecordType = "all" | "growth" | "learning" | "challenge" | "special";
type RecordPeriod = "month" | "quarter";
type AutoSaveStatus = "idle" | "saving" | "saved" | "error";

// 엑셀 클립보드 파서: 멀티라인 셀은 "…"로 감싸이고 내부 따옴표는 ""로 온다.
// 단순 줄바꿈 분리를 쓰면 멀티라인 목표가 여러 행으로 쪼개진다.
function parseClipboardGrid(text: string): string[][] {
  const grid: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/\r/g, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") { quoted = true; continue; }
    if (ch === "\t") { row.push(cell); cell = ""; continue; }
    if (ch === "\n") { row.push(cell); grid.push(row); row = []; cell = ""; continue; }
    cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); grid.push(row); }
  return grid.filter((cells) => cells.some((value) => value.trim()));
}

const EDIT_COLORS: Array<[string, string]> = [["#0f172a", "기본"], ["#dc2626", "빨강"], ["#2563eb", "파랑"], ["#059669", "초록"], ["#d97706", "주황"], ["#7c3aed", "보라"]];

// 부분 색칠 가능한 목표 에디터 (uncontrolled contentEditable — 타이핑 중 리렌더로 커서가 튀지 않게)
function RichGoalEditor({ initialHtml, onChange, className, minHeight = 96 }: { initialHtml: string; onChange: (html: string, text: string) => void; className?: string; minHeight?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  // 최초 1회만 내용 주입 — 매 렌더마다 innerHTML을 다시 쓰면 타이핑할 때 커서가 처음으로 튄다
  const seededRef = useRef(false);
  useEffect(() => {
    if (!seededRef.current && ref.current) { ref.current.innerHTML = initialHtml; seededRef.current = true; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const emit = () => { const el = ref.current; if (el) onChange(el.innerHTML, el.innerText); };
  const applyColor = (color: string) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand("foreColor", false, color);
    emit();
  };
  return (
    <div>
      <div ref={ref} contentEditable suppressContentEditableWarning
        onInput={emit} onBlur={emit} style={{ minHeight }}
        className={`whitespace-pre-wrap rounded-lg border border-slate-300 bg-white p-2.5 text-[13px] font-bold leading-6 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 ${className || ""}`} />
      <div className="mt-1 flex items-center gap-1">
        <span className="mr-0.5 text-[9px] font-bold text-slate-400">드래그 후 색</span>
        {EDIT_COLORS.map(([value, label]) => (
          <button key={label} type="button" title={label} onMouseDown={(e) => { e.preventDefault(); applyColor(value); }}
            className="h-4 w-4 rounded-full border" style={{ backgroundColor: value, borderColor: value }} />
        ))}
      </div>
    </div>
  );
}

const recordTypes = [
  ["growth", "성장노트"],
  ["learning", "배운 점"],
  ["challenge", "아이디어"],
  ["special", "특이사항"],
] as const;

const typeLabels: Record<RecordType, string> = {
  all: "전체",
  growth: "성장노트",
  learning: "배운 점",
  challenge: "아이디어",
  special: "특이사항",
};

const fieldLabels: Record<Exclude<RecordType, "all">, string[]> = {
  growth: ["상황", "문제점", "개선해야 할 점", "실행"],
  learning: ["날짜", "브랜드", "기종", "배운 점", "교육자", "소요시간"],
  challenge: ["내용"],
  special: ["내용"],
};
const hasRecordContent = (note: WeeklyNoteRow) => recordTypes.some(([key]) => String(note[key] || "").trim());
type LearningParsed = { 날짜: string; 브랜드: string; 기종: string; "배운 점": string; 교육자: string; 소요시간: string };
const statusText: Record<AutoSaveStatus, string> = {
  idle: "자동저장 대기",
  saving: "자동저장 중...",
  saved: "자동저장됨",
  error: "자동저장 실패",
};
const PLAN_CATEGORIES = ["AI", "자기개발", "매출증대", "매출안정", "효율성", "비용절감", "소통", "기타"] as const;
const GRADE_OPTIONS = ["A", "B", "C", "D"] as const;

const pad = (n: number) => String(n).padStart(2, "0");
const quarterRange = (year: number, quarter: number) => {
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const endDay = new Date(year, endMonth, 0).getDate();
  return { start: `${year}-${pad(startMonth)}-01`, end: `${year}-${pad(endMonth)}-${pad(endDay)}` };
};

const shortDate = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
function weekEndFromStart(weekStart: string) {
  const d = new Date(`${weekStart}T12:00:00+09:00`);
  d.setDate(d.getDate() + 4);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function weekNumberInMonth(weekStart: string) {
  const year = Number(weekStart.slice(0, 4));
  const month = Number(weekStart.slice(5, 7));
  const day = Number(weekStart.slice(8, 10));
  const seen = new Set<string>();
  for (let d = 1; d <= day; d++) {
    const cursor = new Date(`${year}-${pad(month)}-${pad(d)}T12:00:00+09:00`);
    const dayOfWeek = cursor.getDay() || 7;
    cursor.setDate(cursor.getDate() - dayOfWeek + 1);
    seen.add(`${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(cursor.getDate())}`);
  }
  return seen.size;
}
function weekDisplay(weekStart: string) {
  const end = weekEndFromStart(weekStart);
  return `${shortDate(weekStart)}~${shortDate(end)} · ${weekNumberInMonth(weekStart)}주차`;
}

function parseStructured(text: string, labels: string[]) {
  const result: Record<string, string> = Object.fromEntries(labels.map((label) => [label, ""]));
  const lines = text.split(/\r?\n/);
  let current = "";
  for (const raw of lines) {
    const line = raw.trimEnd();
    const matched = labels.find((label) => new RegExp(`^${label}\\s*[:：]`).test(line.trim()));
    if (matched) {
      current = matched;
      result[current] = line.replace(new RegExp(`^${matched}\\s*[:：]\\s*`), "");
    } else if (current) {
      result[current] = `${result[current]}${result[current] ? "\n" : ""}${line}`.trim();
    }
  }
  if (!Object.values(result).some((value) => value.trim())) {
    result[labels[0]] = text.trim();
  }
  return result;
}

function parseLearningLine(line: string): LearningParsed {
  if (line.includes("\t")) {
    const [날짜 = "", 브랜드 = "", 기종 = "", 배운점 = "", 교육자 = "", 소요시간 = ""] = line.trim().split("\t");
    return { 날짜, 브랜드, 기종, "배운 점": 배운점, 교육자, 소요시간 };
  }
  const parts = line.trim().split(/\s+/).filter(Boolean);
  const durationIndex = parts.findIndex((part, index) => index >= 3 && /^\d+\s*(?:분|시간)?$/.test(part));
  if (durationIndex >= 0) {
    return {
      날짜: parts[0] || "",
      브랜드: parts[1] || "",
      기종: parts[2] || "",
      "배운 점": parts.slice(3, durationIndex).join(" "),
      소요시간: parts[durationIndex] || "",
      교육자: parts.slice(durationIndex + 1).join(" "),
    };
  }
  return {
    날짜: parts[0] || "",
    브랜드: parts[1] || "",
    기종: parts[2] || "",
    "배운 점": parts.slice(3, -2).join(" ") || parts.slice(3).join(" "),
    소요시간: parts.length >= 5 ? parts.at(-2) || "" : "",
    교육자: parts.length >= 6 ? parts.at(-1) || "" : "",
  };
}

function parseLearningText(text: string): LearningParsed {
  const first = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  return parseLearningLine(first);
}

function weekLabelOnly(weekStart: string) {
  return `${Number(weekStart.slice(5, 7))}월 ${weekNumberInMonth(weekStart)}주차`;
}

function buildGrowthGatherText(rows: WeeklyNoteRow[]) {
  const body = rows
    .filter((row) => row.growth.trim())
    .map((row) => {
      const parsed = parseStructured(row.growth, ["상황", "문제점", "개선해야 할 점", "실행"]);
      const bullets = (value: string) => {
        const lines = value
          .split(/\r?\n/)
          .map((line) => line.trim().replace(/^-\s*/, ""))
          .filter(Boolean);
        return lines.length ? lines.map((line) => `-${line}`).join("\n") : "-";
      };
      return [
        `[${weekLabelOnly(row.weekStart)}]`,
        `[상황]`,
        bullets(parsed["상황"]),
        `[문제점]`,
        bullets(parsed["문제점"]),
        `[개선해야 할 점]`,
        bullets(parsed["개선해야 할 점"]),
        `[실행]`,
        bullets(parsed["실행"]),
      ].join("\n");
    })
    .join("\n\n");
  return body || "모을 성장노트가 없습니다.";
}

function buildLearningGatherText(rows: WeeklyNoteRow[]) {
  const items = rows.flatMap((row) =>
    row.learning
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => parseLearningLine(line))
      .filter((item) => item.날짜 || item.브랜드 || item.기종 || item["배운 점"]),
  );
  if (!items.length) return "모을 배운 점이 없습니다.";
  const dateValue = (date: string) => {
    const match = date.match(/(\d{1,2})\D+(\d{1,2})/);
    return match ? Number(match[1]) * 100 + Number(match[2]) : 9999;
  };
  const grouped = items.reduce<Record<string, LearningParsed[]>>((acc, item) => {
    const brand = item.브랜드 || "기타";
    (acc[brand] ||= []).push(item);
    return acc;
  }, {});
  return Object.entries(grouped)
    .sort(([a], [b]) => a.localeCompare(b, "ko"))
    .map(([brand, brandItems]) => {
      const lines = [...brandItems]
        .sort((a, b) => dateValue(a.날짜) - dateValue(b.날짜))
        .map((item) => [item.날짜, item.브랜드, item.기종, item["배운 점"], `${item.교육자}${item.교육자 && item.소요시간 ? " " : ""}${item.소요시간}`].join("\t"));
      return [`[${brand}]`, ...lines].join("\n");
    })
    .join("\n\n");
}

export default function GrowthHub({ author, onOpenWeek }: { author: string; onOpenWeek?: (weekStart: string) => void }) {
  const { book } = useAuthorBook();
  const now = new Date();
  const [tab, setTab] = useState<Tab>("records");
  const [year, setYear] = useState(now.getFullYear());
  const [quarter, setQuarter] = useState(Math.floor(now.getMonth() / 3) + 1);
  const [recordPeriod, setRecordPeriod] = useState<RecordPeriod>("quarter");
  const [recordMonth, setRecordMonth] = useState(now.getMonth() + 1);
  const [person, setPerson] = useState(author);
  const [type, setType] = useState<RecordType>("all");
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<WeeklyNoteRow[]>([]);
  const [plan, setPlan] = useState<QuarterlyPlan>({ author, year, quarter, goals: [] });
  const [card, setCard] = useState<GoldenCard>({ author, year, quarter, answers: {} });
  const [question, setQuestion] = useState(0);
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [gatherResult, setGatherResult] = useState<{ title: string; text: string } | null>(null);
  const [planAutoSaveStatus, setPlanAutoSaveStatus] = useState<AutoSaveStatus>("idle");
  const [cardAutoSaveStatus, setCardAutoSaveStatus] = useState<AutoSaveStatus>("idle");
  const [goldenBusy, setGoldenBusy] = useState(false);
  const planLastSavedRef = useRef("");
  const cardLastSavedRef = useRef("");

  const monthEnd = new Date(year, recordMonth, 0).getDate();
  const qRange = quarterRange(year, quarter);
  const range = recordPeriod === "month"
    ? { start: `${year}-${pad(recordMonth)}-01`, end: `${year}-${pad(recordMonth)}-${pad(monthEnd)}` }
    : qRange;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      getWeeklyNotes(range.start, range.end),
      person ? getQuarterlyPlan(person, year, quarter) : Promise.resolve({ author: "", year, quarter, goals: [] }),
      person ? getGoldenCard(person, year, quarter) : Promise.resolve({ author: "", year, quarter, answers: {} }),
    ])
      .then(([n, p, c]) => {
        if (!alive) return;
        setNotes(n);
        setPlan(p);
        setCard(c);
        planLastSavedRef.current = JSON.stringify({ ...p, author: person, year, quarter });
        cardLastSavedRef.current = JSON.stringify({ ...c, author: person, year, quarter });
        setPlanAutoSaveStatus("idle");
        setCardAutoSaveStatus("idle");
      })
      .catch((e) => alive && setMessage((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [person, year, quarter, range.start, range.end]);

  useEffect(() => {
    if (loading || !person) return;
    const payload = { ...plan, author: person, year, quarter };
    const signature = JSON.stringify(payload);
    if (signature === planLastSavedRef.current) return;
    setPlanAutoSaveStatus("saving");
    const timer = window.setTimeout(() => {
      saveQuarterlyPlan(payload)
        .then(() => {
          planLastSavedRef.current = signature;
          setPlanAutoSaveStatus("saved");
        })
        .catch((e) => {
          setPlanAutoSaveStatus("error");
          setMessage((e as Error).message);
        });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [plan, person, year, quarter, loading]);

  useEffect(() => {
    if (loading || !person) return;
    const payload = { ...card, author: person, year, quarter };
    const signature = JSON.stringify(payload);
    if (signature === cardLastSavedRef.current) return;
    setCardAutoSaveStatus("saving");
    const timer = window.setTimeout(() => {
      saveGoldenCard(payload)
        .then(() => {
          cardLastSavedRef.current = signature;
          setCardAutoSaveStatus("saved");
        })
        .catch((e) => {
          setCardAutoSaveStatus("error");
          setMessage((e as Error).message);
        });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [card, person, year, quarter, loading]);

  const rows = useMemo(() => notes.filter((note) => {
    if (!hasRecordContent(note)) return false;
    if (person && note.author !== person) return false;
    if (type !== "all" && !note[type].trim()) return false;
    const search = query.trim().toLowerCase();
    if (!search) return true;
    const allText = recordTypes.map(([key]) => note[key]).join(" ");
    return `${note.author} ${note.weekStart} ${allText}`.toLowerCase().includes(search);
  }), [notes, person, query, type]);
  const regularGoals = useMemo(() => plan.goals.filter((goal) => goal.category !== "미션"), [plan.goals]);
  const missionGoals = useMemo(() => plan.goals.filter((goal) => goal.category === "미션"), [plan.goals]);

  // 엑셀/시트에서 복사한 범위(탭 구분)를 붙여넣어 목표로 일괄 추가
  // 목표 서식 초기값: titleHtml 우선, 없으면 구버전 color/순수 텍스트를 HTML로
  const goalHtmlOf = (goal: LevelGoal) => goal.titleHtml
    || (goal.color ? `<span style="color:${goal.color}">` : "")
      + String(goal.title || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")
      + (goal.color ? "</span>" : "")
    || "";

  // 월별 결과 서식 초기값: monthNHtml 우선, 없으면 순수 텍스트를 이스케이프
  const monthHtmlOf = (goal: LevelGoal, m: 1 | 2 | 3) => goal[`month${m}Html`]
    || String(goal[`month${m}`] || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const setGoalMonth = (id: string, m: 1 | 2 | 3, html: string, text: string) =>
    setGoal(id, { [`month${m}Html`]: html, [`month${m}`]: text });
  // 목표 표시(읽기 전용): 서식 HTML이 있으면 색 그대로 보여준다
  const goalTitleView = (goal: LevelGoal, fallback = "-") => goal.titleHtml
    ? <span dangerouslySetInnerHTML={{ __html: goal.titleHtml }} />
    : <>{goal.title || fallback}</>;

  // 엑셀/시트에서 복사한 범위(탭 구분)를 붙여넣어 목표로 일괄 추가
  const PASTE_ROLES = ["무시", "구분", "등급", "목표", "현재레벨", "목표레벨", "요청예산", "예산반영", "1개월차", "2개월차", "3개월차"] as const;
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteRoles, setPasteRoles] = useState<string[]>([]);
  const pasteGrid = useMemo(() => parseClipboardGrid(pasteText), [pasteText]);
  useEffect(() => {
    // 컬럼 역할 자동 추정: 구분 값이면 '구분', 등급이면 '등급', 가장 긴 텍스트 열은 '목표'
    const cols = Math.max(0, ...pasteGrid.map((cells) => cells.length));
    if (!cols) { setPasteRoles([]); return; }
    const roles: string[] = Array(cols).fill("무시");
    let goalCol = -1;
    let goalLen = 0;
    for (let c = 0; c < cols; c++) {
      const values = pasteGrid.map((cells) => (cells[c] || "").trim()).filter(Boolean);
      if (!values.length) continue;
      if (values.every((v) => (PLAN_CATEGORIES as readonly string[]).includes(v) || v === "미션")) { roles[c] = "구분"; continue; }
      if (values.every((v) => (GRADE_OPTIONS as readonly string[]).includes(v))) { roles[c] = "등급"; continue; }
      const avg = values.reduce((sum, v) => sum + v.length, 0) / values.length;
      if (avg > goalLen) { goalLen = avg; goalCol = c; }
    }
    if (goalCol >= 0) roles[goalCol] = "목표";
    // 목표 뒤에 오는 숫자-only 열 두 개는 현재레벨 → 목표레벨로 추정
    if (goalCol >= 0) {
      const numericAfter: number[] = [];
      for (let c = goalCol + 1; c < cols; c++) {
        const values = pasteGrid.map((cells) => (cells[c] || "").trim()).filter(Boolean);
        if (values.length && values.every((v) => /^\d{1,3}$/.test(v))) numericAfter.push(c);
      }
      if (numericAfter[0] !== undefined && roles[numericAfter[0]] === "무시") roles[numericAfter[0]] = "현재레벨";
      if (numericAfter[1] !== undefined && roles[numericAfter[1]] === "무시") roles[numericAfter[1]] = "목표레벨";
    }
    setPasteRoles(roles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasteGrid.length, pasteText]);
  const importPasted = (asMission: boolean) => {
    const roleIndex = (role: string) => pasteRoles.indexOf(role);
    const goalIdx = roleIndex("목표");
    if (goalIdx < 0) { setMessage("어느 열이 '목표'인지 선택해 주세요."); return; }
    const imported: LevelGoal[] = [];
    let lastCategory = "";
    for (const cells of pasteGrid) {
      const at = (role: string) => { const i = roleIndex(role); return i >= 0 ? String(cells[i] || "").trim() : ""; };
      const title = String(cells[goalIdx] || "").trim();
      if (!title || title === "목표") continue;
      const rawCategory = at("구분");
      if (rawCategory) lastCategory = rawCategory;
      const category = asMission || lastCategory === "미션" ? "미션"
        : ((PLAN_CATEGORIES as readonly string[]).includes(lastCategory) ? lastCategory : "자기개발");
      imported.push({
        id: crypto.randomUUID(), category, grade: at("등급"), title,
        currentLevel: at("현재레벨"), targetLevel: at("목표레벨"), budget: at("요청예산"), reflectedBudget: at("예산반영"),
        month1: at("1개월차"), month2: at("2개월차"), month3: at("3개월차"),
        progress: 0, resultMerged: false,
      });
    }
    if (!imported.length) { setMessage("가져올 목표를 찾지 못했습니다. 열 역할을 확인해 주세요."); return; }
    setPlan({ ...plan, author: person, year, quarter, goals: [...plan.goals, ...imported] });
    setPasteOpen(false);
    setPasteText("");
    setMessage(`${imported.length}개 목표를 추가했습니다. 확인 후 저장을 눌러주세요.`);
  };

  const openGatherResult = (key: "growth" | "learning") => {
    const text = key === "growth" ? buildGrowthGatherText(rows) : buildLearningGatherText(rows);
    if (text.includes("모을") && text.includes("없습니다")) {
      setMessage(text);
      return;
    }
    setGatherResult({ title: key === "growth" ? "성장노트 모음" : "배운점 모음", text });
  };

  const copyGatherResult = async () => {
    if (!gatherResult) return;
    await navigator.clipboard.writeText(gatherResult.text);
    setMessage("모음 내용을 복사했습니다.");
  };

  const downloadGatherResult = () => {
    if (!gatherResult) return;
    const blob = new Blob([gatherResult.text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${gatherResult.title}_${year}-${recordPeriod === "month" ? `${pad(recordMonth)}월` : `${quarter}Q`}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const previousQuarter = () => quarter === 1 ? { year: year - 1, quarter: 4 } : { year, quarter: quarter - 1 };
  const goldenCardToText = (target: GoldenCard) => GOLDEN_QUESTIONS.map((q) => {
    const body = GOLDEN_CATEGORIES.map((cat) => {
      const value = target.answers[q]?.[cat]?.trim();
      return value ? `[${cat}]\n${value}` : "";
    }).filter(Boolean).join("\n\n");
    return body ? `## ${q}\n${body}` : "";
  }).filter(Boolean).join("\n\n");

  const buildGoldenPayload = (exampleCard?: GoldenCard, exampleMeta?: { year: number; quarter: number }, weeklyRecordsText = "") => {
    const planText = regularGoals.map((goal, i) => [
      `${i + 1}. [${goal.category}] ${goal.title || "(목표 미입력)"}`,
      `등급:${goal.grade || "-"} 현재:${goal.currentLevel || "-"} 목표:${goal.targetLevel || "-"} 진도율:${goal.progress || 0}%`,
      `${(quarter - 1) * 3 + 1}월: ${goal.month1 || "-"}`,
      `${(quarter - 1) * 3 + 2}월: ${goal.month2 || "-"}`,
      `${(quarter - 1) * 3 + 3}월: ${goal.month3 || "-"}`,
    ].join("\n")).join("\n\n");
    const missionText = missionGoals.map((goal, i) => [
      `${i + 1}. ${goal.title || "(미션 미입력)"}`,
      `등급:${goal.grade || "-"} 현재:${goal.currentLevel || "-"} 목표:${goal.targetLevel || "-"} 진도율:${goal.progress || 0}%`,
      `${(quarter - 1) * 3 + 1}월: ${goal.month1 || "-"}`,
      `${(quarter - 1) * 3 + 2}월: ${goal.month2 || "-"}`,
      `${(quarter - 1) * 3 + 3}월: ${goal.month3 || "-"}`,
    ].join("\n")).join("\n\n");
    return {
      year,
      quarter,
      author: person,
      categories: GOLDEN_CATEGORIES,
      questions: GOLDEN_QUESTIONS,
      currentAnswers: card.answers,
      exampleQuarter: exampleMeta ? `${exampleMeta.year}년 ${exampleMeta.quarter}분기` : "",
      exampleText: exampleCard ? goldenCardToText(exampleCard) : "",
      exampleAnswers: exampleCard?.answers || {},
      planText: planText || "없음",
      missionText: missionText || "없음",
      weeklyRecordsText: weeklyRecordsText || "없음",
    };
  };

  // 이번 분기 주간현황판 기록(성장노트·배운점·아이디어·특이사항)을 모아 골든카드 AI 입력에 넣는다
  const collectQuarterWeeklyText = async () => {
    try {
      const startMonth = (quarter - 1) * 3 + 1;
      const endMonth = startMonth + 2;
      const start = `${year}-${String(startMonth).padStart(2, "0")}-01`;
      const end = `${year}-${String(endMonth).padStart(2, "0")}-${new Date(year, endMonth, 0).getDate()}`;
      const all = await getWeeklyNotes(start, end);
      return all.filter((row) => row.author === person).map((row) => {
        const parts = recordTypes
          .map(([key, label]) => (String(row[key] || "").trim() ? `${label}: ${row[key]}` : ""))
          .filter(Boolean);
        return parts.length ? `[${weekDisplay(row.weekStart)}]\n${parts.join("\n")}` : "";
      }).filter(Boolean).join("\n\n").slice(0, 12000);
    } catch {
      return ""; // 주간 기록 조회 실패해도 골든카드 변환 자체는 진행
    }
  };

  const runGoldenAi = async () => {
    if (!person) {
      setMessage("작성자를 먼저 선택하세요.");
      return;
    }
    setGoldenBusy(true);
    setMessage("");
    try {
      const prev = previousQuarter();
      const [exampleCard, weeklyRecordsText] = await Promise.all([
        getGoldenCard(person, prev.year, prev.quarter),
        collectQuarterWeeklyText(),
      ]);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/golden-card-transform`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
        body: JSON.stringify(buildGoldenPayload(exampleCard, prev, weeklyRecordsText)),
      });
      if (!res.ok) throw new Error(`골든미팅카드 AI 변환 실패(${res.status})`);
      const data = await res.json();
      const answers = data.answers as GoldenCard["answers"] | undefined;
      if (!answers) throw new Error("AI 응답에 answers가 없습니다.");
      setCard({ ...card, author: person, year, quarter, answers });
      setMessage(`골든미팅카드를 AI로 변환했습니다. 사용 모델: ${data.model || "기본 모델"}`);
    } catch (e) {
      setMessage((e as Error).message || "골든미팅카드 AI 변환에 실패했습니다.");
    } finally {
      setGoldenBusy(false);
    }
  };

  const addGoal = (kind: "regular" | "mission" = "regular") => {
    const g: LevelGoal = {
      id: crypto.randomUUID(),
      category: kind === "mission" ? "미션" : "자기개발",
      grade: "C",
      title: "",
      currentLevel: "",
      targetLevel: "",
      budget: "",
      reflectedBudget: "",
      month1: "",
      month2: "",
      month3: "",
      progress: 0,
      resultMerged: false,
    };
    setPlan({ ...plan, author: person, year, quarter, goals: [...plan.goals, g] });
  };
  const setGoal = (id: string, patch: Partial<LevelGoal>) => setPlan({ ...plan, goals: plan.goals.map((g) => g.id === id ? { ...g, ...patch } : g) });
  const savePlan = async () => {
    try {
      const payload = { ...plan, author: person, year, quarter };
      setPlanAutoSaveStatus("saving");
      await saveQuarterlyPlan(payload);
      planLastSavedRef.current = JSON.stringify(payload);
      setPlanAutoSaveStatus("saved");
      setMessage("레벨업계획을 저장했습니다.");
    } catch (e) {
      setPlanAutoSaveStatus("error");
      setMessage((e as Error).message);
    }
  };
  const answer = (q: string, cat: string) => card.answers[q]?.[cat] || "";
  const setAnswer = (q: string, cat: string, value: string) => setCard({ ...card, answers: { ...card.answers, [q]: { ...(card.answers[q] || {}), [cat]: value } } });
  const saveCard = async () => {
    try {
      const payload = { ...card, author: person, year, quarter };
      setCardAutoSaveStatus("saving");
      await saveGoldenCard(payload);
      cardLastSavedRef.current = JSON.stringify(payload);
      setCardAutoSaveStatus("saved");
      setMessage("골든미팅카드를 저장했습니다.");
    } catch (e) {
      setCardAutoSaveStatus("error");
      setMessage((e as Error).message);
    }
  };

  return (
    <div className="space-y-5 pb-16">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {/* 다크 헤더 — 설명 + 조회 조건(연도/분기/직원)을 한 줄에 모은다 */}
        <div className="flex flex-col gap-3 bg-[#151A23] px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
          <p className="text-[11px] font-semibold text-slate-400">주간현황판 기록을 모아 계획표·결과표·미션결과표·골든미팅카드로 잇습니다.</p>
          <div className="flex flex-wrap gap-2">
            <PortalSelect tone="dark" width={140} value={String(year)} onChange={(next) => setYear(Number(next))}
              options={Array.from({ length: 6 }, (_, i) => now.getFullYear() - 4 + i).map((y) => ({ value: String(y), label: `${y}년` }))} />
            {tab !== "records" && (
              <div className="flex gap-1 rounded-full bg-white/10 p-1">
                {[1, 2, 3, 4].map((q) => <button key={q} onClick={() => setQuarter(q)} className={`rounded-full px-3 py-1 text-sm font-bold transition ${quarter === q ? "bg-white text-slate-950" : "text-slate-400 hover:text-white"}`}>{q}Q</button>)}
              </div>
            )}
            <PortalSelect tone="dark" width={200} value={person} onChange={setPerson} placeholder="전체 직원"
              hint={AUTHOR_TEAMS.find((team) => book[team]?.includes(person)) ? `${AUTHOR_TEAMS.find((team) => book[team]?.includes(person))}팀` : undefined}
              options={[{ value: "", label: "전체 직원" }, ...AUTHOR_TEAMS.flatMap((team) => (book[team] || []).map((name) => ({ value: name, label: name, group: `${team}팀` })))]} />
          </div>
        </div>
        <div className="flex overflow-x-auto border-b border-slate-200">
          {([["records", "성장기록 모아보기"], ["plan", "계획표"], ["result", "분기결과표"], ["mission", "미션결과표"], ["golden", "골든미팅카드"]] as [Tab, string][]).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`relative shrink-0 whitespace-nowrap px-4 py-3 text-[13px] font-black transition sm:px-5 sm:text-sm ${tab === key ? "text-slate-950 after:absolute after:inset-x-0 after:-bottom-px after:h-[3px] after:bg-blue-600" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"}`}>{label}</button>
          ))}
        </div>
      </section>

      {tab === "records" && (
        <section className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <span className="mr-1 text-[11px] font-black uppercase tracking-wide text-slate-400">조회 범위</span>
          {([["month", "월별"], ["quarter", "분기"]] as [RecordPeriod, string][]).map(([key, label]) => (
            <button key={key} onClick={() => setRecordPeriod(key)} className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${recordPeriod === key ? "bg-blue-600 text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)]" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>{label}</button>
          ))}
          {recordPeriod === "month" ? (
            <select value={recordMonth} onChange={(e) => setRecordMonth(Number(e.target.value))} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
            </select>
          ) : (
            <div className="flex gap-1 rounded-full bg-slate-100 p-1">
              {[1, 2, 3, 4].map((q) => <button key={q} onClick={() => setQuarter(q)} className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${quarter === q ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{q}Q</button>)}
            </div>
          )}
        </section>
      )}

      {message && <div className="rounded-lg bg-blue-50 p-3 text-sm font-semibold text-blue-700">{message}</div>}
      {loading && <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">불러오는 중입니다.</div>}

      {!loading && tab === "records" && (
        <>
          <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap gap-1.5">
              {(["all", "growth", "learning", "challenge", "special"] as RecordType[]).map((key) => (
                <button key={key} onClick={() => setType(key)} className={`rounded-full px-3.5 py-1.5 text-xs font-black transition ${type === key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>{typeLabels[key]}</button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => openGatherResult("growth")} className="rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-black text-slate-600 transition hover:bg-slate-50">성장노트 모음</button>
              <button onClick={() => openGatherResult("learning")} className="rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-black text-slate-600 transition hover:bg-slate-50">배운점 모음</button>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="내용 또는 직원 검색" className="min-w-64 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
            </div>
          </section>

          {(() => {
            const typeCounts = recordTypes.map(([key, label]) => [label, rows.filter((row) => String(row[key] || "").trim()).length] as [string, number]);
            const total = typeCounts.reduce((sum, [, count]) => sum + count, 0);
            const people = new Set(rows.map((row) => row.author)).size;
            return (
              <section className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                {([["총 기록", `${total}개`], ["참여 인원", `${people}명`], ["기록 주차", `${rows.length}건`], ...typeCounts.map(([label, count]) => [label, `${count}개`] as [string, string])]).map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-slate-200 bg-white px-2 py-3 text-center shadow-sm">
                    <div className="truncate text-base font-black tabular-nums text-slate-950">{value}</div>
                    <div className="mt-0.5 truncate text-[10px] font-bold text-slate-400">{label}</div>
                  </div>
                ))}
              </section>
            );
          })()}

          {type === "all" ? (
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              {rows.map((row) => {
                const id = `${row.author}-${row.weekStart}`;
                const count = recordTypes.filter(([key]) => row[key].trim()).length;
                const open = !!openRows[id];
                return (
                  <div key={id} className="border-b border-slate-100 last:border-0">
                    <button type="button" onClick={() => setOpenRows({ ...openRows, [id]: !open })} className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-slate-50">
                      <div>
                        <div className="text-[14px] font-black text-slate-900">{weekDisplay(row.weekStart)} <span className="text-slate-400">·</span> {row.author}</div>
                        <div className="mt-0.5 text-[11px] font-bold text-slate-400">기록 {count}개</div>
                      </div>
                      <span className="flex items-center gap-2">
                        {onOpenWeek && <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); onOpenWeek(row.weekStart); }} onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onOpenWeek(row.weekStart); } }} className="rounded-full border border-slate-200 bg-white transition hover:bg-slate-50 px-2.5 py-1.5 text-[11px] font-black text-slate-600 hover:border-blue-300 hover:text-blue-700">주간현황판 ↗</span>}
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-500">{open ? "접기" : "펼치기"}</span>
                      </span>
                    </button>
                    {open && (
                      <div className="grid gap-3 bg-slate-50 p-4 lg:grid-cols-2">
                        {recordTypes.map(([key, label]) => row[key].trim() && (
                          <div key={key} className="rounded-lg border border-slate-200 bg-white p-4">
                            <div className="text-xs font-black text-slate-500">{label}</div>
                            <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{row[key]}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {!rows.length && <div className="p-16 text-center text-sm text-slate-400">선택한 기간의 성장기록이 없습니다.</div>}
            </section>
          ) : (
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="space-y-3 p-3 md:hidden">
                {rows.map((row) => {
                  const parsed: Record<string, string> = type === "learning" ? parseLearningText(row[type]) : parseStructured(row[type], fieldLabels[type]);
                  return <article key={`${row.author}-${row.weekStart}`} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-2"><b className="text-sm text-slate-900">{row.author}</b>{onOpenWeek ? <button type="button" onClick={() => onOpenWeek(row.weekStart)} className="text-[11px] font-black text-blue-600">{weekDisplay(row.weekStart)} ↗</button> : <span className="text-[11px] font-bold text-slate-400">{weekDisplay(row.weekStart)}</span>}</div>
                    <div className="mt-3 space-y-2">{fieldLabels[type].map((label) => <div key={label} className="rounded-lg bg-white p-3"><div className="text-[10px] font-black text-slate-400">{label}</div><div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{parsed[label] || "-"}</div></div>)}</div>
                  </article>;
                })}
                {!rows.length && <div className="p-10 text-center text-sm text-slate-400">선택한 기록이 없습니다.</div>}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[980px] text-left">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="border-b border-slate-100 bg-slate-50/70 px-4 py-3 text-xs font-black text-slate-500">주차</th>
                      <th className="border-b border-slate-100 bg-slate-50/70 px-4 py-3 text-xs font-black text-slate-500">작성자</th>
                      {fieldLabels[type].map((label) => <th key={label} className="border-b border-slate-100 bg-slate-50/70 px-4 py-3 text-xs font-black text-slate-500">{label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const parsed: Record<string, string> = type === "learning" ? parseLearningText(row[type]) : parseStructured(row[type], fieldLabels[type]);
                      return (
                        <tr key={`${row.author}-${row.weekStart}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                          <td className="px-4 py-4 align-top text-xs font-bold text-slate-500">{weekDisplay(row.weekStart)}</td>
                          <td className="px-4 py-4 align-top text-sm font-bold text-slate-800">{row.author}</td>
                          {fieldLabels[type].map((label) => <td key={label} className="whitespace-pre-wrap px-4 py-4 align-top text-sm leading-6 text-slate-600">{parsed[label] || "-"}</td>)}
                        </tr>
                      );
                    })}
                    {!rows.length && <tr><td colSpan={fieldLabels[type].length + 2} className="p-16 text-center text-sm text-slate-400">선택한 기록이 없습니다.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      {pasteOpen && (
        <div className="fixed inset-0 z-[240] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setPasteOpen(false)}>
          <div className="flex max-h-[90vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:max-w-2xl sm:rounded-xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <b className="text-slate-950">엑셀 붙여넣기 — 여러 셀 한 번에</b>
              <button type="button" onClick={() => setPasteOpen(false)} className="rounded-full px-3 py-1.5 text-xs font-bold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700">닫기</button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
              <p className="text-xs font-semibold leading-5 text-slate-500">엑셀/시트에서 목표 범위를 복사해 아래에 붙여넣으세요. 열 역할은 자동 추정되며 직접 바꿀 수 있습니다.</p>
              <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={6} placeholder={"엑셀에서 복사한 내용을 여기에 붙여넣기 (Ctrl+V)"} className="w-full resize-y rounded-lg border border-slate-300 p-3 font-mono text-xs leading-5 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
              {pasteGrid.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-50">
                        {pasteRoles.map((role, index) => (
                          <th key={index} className="border-b border-slate-200 px-2 py-1.5">
                            <select value={role} onChange={(e) => setPasteRoles((cur) => cur.map((r, i) => i === index ? e.target.value : r))} className={`w-full rounded border px-1 py-1 text-[11px] font-black ${role === "무시" ? "border-slate-200 text-slate-400" : "border-blue-300 bg-blue-50 text-blue-700"} outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10`}>
                              {PASTE_ROLES.map((name) => <option key={name}>{name}</option>)}
                            </select>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pasteGrid.slice(0, 5).map((cells, rowIndex) => (
                        <tr key={rowIndex} className="border-b border-slate-100 last:border-0">
                          {pasteRoles.map((_, colIndex) => <td key={colIndex} className="max-w-40 truncate px-2 py-1.5 font-semibold text-slate-600">{cells[colIndex] || ""}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {pasteGrid.length > 5 && <div className="px-2 py-1.5 text-[10px] font-bold text-slate-400">외 {pasteGrid.length - 5}행 — 총 {pasteGrid.length}행 가져옵니다</div>}
                </div>
              )}
            </div>
            {pasteGrid.length > 0 && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button type="button" onClick={() => importPasted(false)} className="rounded-full bg-blue-600 shadow-[0_3px_10px_rgba(37,99,235,0.3)] hover:bg-blue-700 px-4 py-2 text-sm font-black text-white">기본업무로 추가</button>
              <button type="button" onClick={() => importPasted(true)} className="rounded-full bg-amber-600 px-4 py-2 text-sm font-black text-white">미션업무로 추가</button>
            </div>}
          </div>
        </div>
      )}

      {!loading && tab === "plan" && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-base font-black text-slate-950 lg:text-lg">{year}년 {quarter}분기 계획표</h3>
              <p className="mt-0.5 text-[11px] font-semibold text-slate-400">시트 양식처럼 기본업무와 미션업무를 한 행에서 함께 관리합니다.</p>
            </div>
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
              <button disabled={!person} onClick={() => setPasteOpen(true)} className="col-span-2 rounded-full border border-slate-300 bg-white px-3.5 py-2 text-xs font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-40 sm:text-sm">엑셀 붙여넣기</button>
              <button disabled={!person} onClick={() => addGoal("regular")} className="rounded-full bg-blue-600 px-3.5 py-2 text-xs font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 disabled:opacity-40 sm:text-sm">+ 기본업무</button>
              <button disabled={!person} onClick={() => addGoal("mission")} className="rounded-full bg-amber-500 px-3.5 py-2 text-xs font-black text-white transition hover:bg-amber-600 disabled:opacity-40 sm:text-sm">+ 미션업무</button>
            </div>
          </div>
          <div className="p-5">
          {!person && <div className="py-10 text-center text-sm font-bold text-amber-600">작성자 직원을 선택하세요.</div>}
          <div className="space-y-4 md:hidden">
            {regularGoals.map((goal, index) => <article key={goal.id} className="rounded-xl border border-blue-100 bg-blue-50/40 p-4">
              <div className="flex items-center justify-between"><b className="text-sm text-blue-800">기본업무 {index + 1}</b><button onClick={() => setPlan({ ...plan, goals: plan.goals.filter((item) => item.id !== goal.id) })} className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-rose-500 transition hover:bg-rose-50">×</button></div>
              <div className="mt-3 grid grid-cols-2 gap-2"><select value={goal.category} onChange={(e) => setGoal(goal.id, { category: e.target.value })} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">{PLAN_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select><select value={goal.grade || ""} onChange={(e) => setGoal(goal.id, { grade: e.target.value })} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"><option value="">등급</option>{GRADE_OPTIONS.map((grade) => <option key={grade}>{grade}</option>)}</select></div>
              <div className="mt-2"><RichGoalEditor key={goal.id} initialHtml={goalHtmlOf(goal)} onChange={(html, text) => setGoal(goal.id, { titleHtml: html, title: text })} /></div>
              <div className="mt-2 grid grid-cols-2 gap-2">{[["현재레벨", "currentLevel"], ["목표레벨", "targetLevel"], ["요청예산", "budget"], ["예산반영", "reflectedBudget"]] .map(([label, key]) => <label key={key} className="text-[10px] font-bold text-slate-500">{label}<input value={String(goal[key as keyof LevelGoal] || "")} onChange={(e) => setGoal(goal.id, { [key]: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" /></label>)}</div>
              <label className="mt-2 block text-[10px] font-bold text-slate-500">진도율<input type="number" min="0" max="999" value={goal.progress || ""} onChange={(e) => setGoal(goal.id, { progress: Number(e.target.value) || 0 })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" /></label>
            </article>)}
            {missionGoals.map((goal, index) => <article key={goal.id} className="rounded-xl border border-amber-100 bg-amber-50/40 p-4">
              <div className="flex items-center justify-between"><b className="text-sm text-amber-800">미션업무 {index + 1}</b><button onClick={() => setPlan({ ...plan, goals: plan.goals.filter((item) => item.id !== goal.id) })} className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-rose-500 transition hover:bg-rose-50">×</button></div>
              <div className="mt-3"><RichGoalEditor key={goal.id} initialHtml={goalHtmlOf(goal)} onChange={(html, text) => setGoal(goal.id, { titleHtml: html, title: text })} className="border-amber-200" /></div>
              <div className="mt-2 grid grid-cols-2 gap-2"><select value={goal.grade || ""} onChange={(e) => setGoal(goal.id, { grade: e.target.value })} className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"><option value="">등급</option>{GRADE_OPTIONS.map((grade) => <option key={grade}>{grade}</option>)}</select><input type="number" min="0" max="999" value={goal.progress || ""} onChange={(e) => setGoal(goal.id, { progress: Number(e.target.value) || 0 })} placeholder="진도율 %" className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" /><input value={goal.budget} onChange={(e) => setGoal(goal.id, { budget: e.target.value })} placeholder="요청예산" className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" /><input value={goal.reflectedBudget || ""} onChange={(e) => setGoal(goal.id, { reflectedBudget: e.target.value })} placeholder="예산반영" className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" /></div>
            </article>)}
          </div>
          {/* 기본업무·미션업무를 한 표에 옆으로 붙이면 1680px가 되어 미션 쪽이 화면 밖으로 밀린다.
              행끼리 짝지을 이유도 없으므로 위아래 두 표로 나눠 각자 전폭을 쓰게 한다. */}
          <div className="hidden space-y-4 md:block">
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-200 bg-blue-50/70 px-3 py-2.5">
                <span className="text-xs font-black text-blue-800">기본업무 (우선순위순)</span>
                <span className="text-[11px] font-bold tabular-nums text-blue-700/70">{regularGoals.length}건</span>
              </div>
              <table className="w-full table-fixed border-collapse text-left">
                <colgroup><col className="w-28" /><col className="w-20" /><col /><col className="w-20" /><col className="w-20" /><col className="w-28" /><col className="w-24" /><col className="w-20" /><col className="w-12" /></colgroup>
                <thead>
                  <tr>
                    {["구분", "업무등급", "목표", "현재레벨", "목표레벨", "요청예산(분기)", "예산반영", "진도율", ""].map((label) => <th key={label} className="border-b border-r border-slate-200 bg-slate-100/70 px-2 py-2.5 text-[11px] font-black text-slate-500 last:border-r-0">{label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {regularGoals.map((g) => (
                    <tr key={g.id} className="align-top hover:bg-slate-50/40">
                      <td className="border-b border-r border-slate-100 p-2"><select value={g.category} onChange={(e) => setGoal(g.id, { category: e.target.value })} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-semibold outline-none transition focus:border-blue-500">{PLAN_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></td>
                      <td className="border-b border-r border-slate-100 p-2"><select value={g.grade || ""} onChange={(e) => setGoal(g.id, { grade: e.target.value })} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-semibold outline-none transition focus:border-blue-500"><option value="">-</option>{GRADE_OPTIONS.map((grade) => <option key={grade}>{grade}</option>)}</select></td>
                      <td className="border-b border-r border-slate-100 p-2"><RichGoalEditor key={g.id} initialHtml={goalHtmlOf(g)} onChange={(html, text) => setGoal(g.id, { titleHtml: html, title: text })} /></td>
                      <td className="border-b border-r border-slate-100 p-2"><input value={g.currentLevel} onChange={(e) => setGoal(g.id, { currentLevel: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm tabular-nums outline-none transition focus:border-blue-500" /></td>
                      <td className="border-b border-r border-slate-100 p-2"><input value={g.targetLevel} onChange={(e) => setGoal(g.id, { targetLevel: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm tabular-nums outline-none transition focus:border-blue-500" /></td>
                      <td className="border-b border-r border-slate-100 p-2"><input value={g.budget} onChange={(e) => setGoal(g.id, { budget: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm tabular-nums outline-none transition focus:border-blue-500" /></td>
                      <td className="border-b border-r border-slate-100 p-2"><input value={g.reflectedBudget || ""} onChange={(e) => setGoal(g.id, { reflectedBudget: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm tabular-nums outline-none transition focus:border-blue-500" /></td>
                      <td className="border-b border-r border-slate-100 p-2"><input type="number" min="0" max="999" value={g.progress || ""} onChange={(e) => setGoal(g.id, { progress: Number(e.target.value) || 0 })} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm tabular-nums outline-none transition focus:border-blue-500" /></td>
                      <td className="border-b border-slate-100 p-2 text-center"><button onClick={() => setPlan({ ...plan, goals: plan.goals.filter((x) => x.id !== g.id) })} className="rounded-full px-2 py-1 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500">×</button></td>
                    </tr>
                  ))}
                  {!regularGoals.length && <tr><td colSpan={9} className="bg-slate-50/60 p-4 text-center text-xs font-bold text-slate-300">기본업무 없음 — 위 “+ 기본업무”로 추가하세요</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-200 bg-amber-50/70 px-3 py-2.5">
                <span className="text-xs font-black text-amber-800">미션업무</span>
                <span className="text-[11px] font-bold tabular-nums text-amber-700/70">{missionGoals.length}건</span>
              </div>
              <table className="w-full table-fixed border-collapse text-left">
                <colgroup><col /><col className="w-20" /><col className="w-28" /><col className="w-24" /><col className="w-20" /><col className="w-12" /></colgroup>
                <thead>
                  <tr>
                    {["목표", "업무등급", "요청예산(분기)", "예산반영", "진도율", ""].map((label) => <th key={`m-${label}`} className="border-b border-r border-slate-200 bg-amber-50/50 px-2 py-2.5 text-[11px] font-black text-amber-800 last:border-r-0">{label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {missionGoals.map((m) => (
                    <tr key={m.id} className="align-top hover:bg-amber-50/20">
                      <td className="border-b border-r border-slate-100 p-2"><RichGoalEditor key={m.id} initialHtml={goalHtmlOf(m)} onChange={(html, text) => setGoal(m.id, { titleHtml: html, title: text })} className="border-amber-300" /></td>
                      <td className="border-b border-r border-slate-100 p-2"><select value={m.grade || ""} onChange={(e) => setGoal(m.id, { grade: e.target.value })} className="w-full rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-sm outline-none transition focus:border-amber-500"><option value="">-</option>{GRADE_OPTIONS.map((grade) => <option key={grade}>{grade}</option>)}</select></td>
                      <td className="border-b border-r border-slate-100 p-2"><input value={m.budget} onChange={(e) => setGoal(m.id, { budget: e.target.value })} className="w-full rounded-lg border border-amber-300 px-2 py-1.5 text-sm tabular-nums outline-none transition focus:border-amber-500" /></td>
                      <td className="border-b border-r border-slate-100 p-2"><input value={m.reflectedBudget || ""} onChange={(e) => setGoal(m.id, { reflectedBudget: e.target.value })} className="w-full rounded-lg border border-amber-300 px-2 py-1.5 text-sm tabular-nums outline-none transition focus:border-amber-500" /></td>
                      <td className="border-b border-r border-slate-100 p-2"><input type="number" min="0" max="999" value={m.progress || ""} onChange={(e) => setGoal(m.id, { progress: Number(e.target.value) || 0 })} className="w-full rounded-lg border border-amber-300 px-2 py-1.5 text-sm tabular-nums outline-none transition focus:border-amber-500" /></td>
                      <td className="border-b border-slate-100 p-2 text-center"><button onClick={() => setPlan({ ...plan, goals: plan.goals.filter((x) => x.id !== m.id) })} className="rounded-full px-2 py-1 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500">×</button></td>
                    </tr>
                  ))}
                  {!missionGoals.length && <tr><td colSpan={6} className="bg-amber-50/30 p-4 text-center text-xs font-bold text-amber-300">미션업무 없음 — 위 “+ 미션업무”로 추가하세요</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          </div>
          {person && (
            <div className="sticky bottom-2 z-10 mx-3 mb-3 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.10)] backdrop-blur">
              <span className="text-[11px] font-bold text-slate-400">{statusText[planAutoSaveStatus]}</span>
              <button onClick={savePlan} className="rounded-full bg-blue-600 px-5 py-2 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700">지금 저장</button>
            </div>
          )}
        </section>
      )}

      {!loading && tab === "result" && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4">
            <div>
              <h3 className="text-base font-black text-slate-950 lg:text-lg">{year}년 {quarter}분기 결과표</h3>
              <p className="mt-0.5 text-[11px] font-semibold text-slate-400">목표별 월간 결과를 기록합니다. 수치와 진행률 %는 반드시 남기세요.</p>
            </div>
            <div className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-500">{statusText[planAutoSaveStatus]}</div>
          </div>
          <div className="p-5">
          <div className="space-y-4 md:hidden">
            {regularGoals.map((goal, index) => <article key={goal.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex items-start justify-between gap-3"><div><div className="text-[10px] font-black text-blue-600">{goal.category} · {goal.grade || "-"}</div><div className="mt-1 whitespace-pre-wrap text-sm font-black leading-6 text-slate-900">{goalTitleView(goal, `목표 ${index + 1}`)}</div></div><span className="shrink-0 rounded-full bg-blue-600 px-2.5 py-1 text-xs font-black tabular-nums text-white">{goal.progress || 0}%</span></div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-white p-2 text-slate-500">현재 <b className="float-right text-slate-800">{goal.currentLevel || "-"}</b></div><div className="rounded-lg bg-white p-2 text-slate-500">목표 <b className="float-right text-slate-800">{goal.targetLevel || "-"}</b></div></div>
              <div className="mt-3 flex justify-end"><button type="button" onClick={() => setGoal(goal.id, { resultMerged: !goal.resultMerged })} className="rounded-full border border-slate-200 bg-white transition hover:bg-slate-50 px-3 py-1.5 text-xs font-black text-slate-500">{goal.resultMerged ? "월별 나누기" : "분기 통합"}</button></div>
              {goal.resultMerged ? <div className="mt-2"><RichGoalEditor key={`${goal.id}-merged-m`} minHeight={165} initialHtml={monthHtmlOf(goal, 1)} onChange={(html, text) => setGoalMonth(goal.id, 1, html, text)} /></div> : <div className="mt-2 space-y-2">{([1, 2, 3] as const).map((m) => <div key={m} className="text-[11px] font-black text-slate-500">{(quarter - 1) * 3 + m}월<div className="mt-1"><RichGoalEditor key={`${goal.id}-m${m}-m`} minHeight={120} initialHtml={monthHtmlOf(goal, m)} onChange={(html, text) => setGoalMonth(goal.id, m, html, text)} /></div></div>)}</div>}
            </article>)}
            {!regularGoals.length && <div className="p-10 text-center text-sm text-slate-400">계획표에서 목표를 먼저 추가하세요.</div>}
          </div>
          <div className="hidden overflow-x-auto rounded-lg border border-slate-200 md:block">
            <table className="w-full min-w-[1100px] table-fixed text-left">
              <colgroup><col className="w-24" /><col className="w-[17%]" /><col className="w-16" /><col className="w-16" /><col className="w-16" /><col className="w-20" /><col className="w-20" /><col /><col /><col /></colgroup>
              <thead className="bg-slate-100/70">
                <tr>
                  <th className="border-b border-slate-200 px-3 py-3 text-[11px] font-black text-slate-500">구분</th>
                  <th className="border-b border-slate-200 px-3 py-3 text-[11px] font-black text-slate-500">목표</th>
                  <th className="border-b border-slate-200 px-3 py-3 text-[11px] font-black text-slate-500">등급</th>
                  <th className="border-b border-slate-200 px-3 py-3 text-[11px] font-black text-slate-500">현재</th>
                  <th className="border-b border-slate-200 px-3 py-3 text-[11px] font-black text-slate-500">목표</th>
                  <th className="border-b border-slate-200 px-3 py-3 text-[11px] font-black text-slate-500">진도율</th>
                  <th className="border-b border-slate-200 px-3 py-3 text-[11px] font-black text-slate-500">셀</th>
                  {[1, 2, 3].map((m) => <th key={m} className="border-b border-slate-200 px-3 py-3 text-[11px] font-black text-slate-500">{(quarter - 1) * 3 + m}월</th>)}
                </tr>
              </thead>
              <tbody>
                {regularGoals.map((g) => (
                  <tr key={g.id} className="border-b border-slate-100 align-top last:border-0 hover:bg-slate-50/40">
                    <td className="px-3 py-3 text-sm font-black text-slate-800">{g.category}</td>
                    <td className="whitespace-pre-wrap px-3 py-3 text-[13px] font-bold leading-6 text-slate-800">{goalTitleView(g)}</td>
                    <td className="px-3 py-3 text-sm font-bold text-slate-600">{g.grade || "-"}</td>
                    <td className="px-3 py-3 text-sm font-bold tabular-nums text-slate-600">{g.currentLevel || "-"}</td>
                    <td className="px-3 py-3 text-sm font-bold tabular-nums text-slate-600">{g.targetLevel || "-"}</td>
                    <td className="px-3 py-3"><span className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-black tabular-nums text-blue-700">{g.progress || 0}%</span></td>
                    <td className="px-3 py-3"><button type="button" onClick={() => setGoal(g.id, { resultMerged: !g.resultMerged })} className="whitespace-nowrap rounded-full border border-slate-200 bg-white transition hover:bg-slate-50 px-2.5 py-1 text-xs font-black text-slate-500">{g.resultMerged ? "나누기" : "합치기"}</button></td>
                    {g.resultMerged ? (
                      <td colSpan={3} className="px-3 py-3">
                        <div><RichGoalEditor key={`${g.id}-merged`} minHeight={190} initialHtml={monthHtmlOf(g, 1)} onChange={(html, text) => setGoalMonth(g.id, 1, html, text)} /></div>
                      </td>
                    ) : (
                      ([1, 2, 3] as const).map((m) => <td key={m} className="px-3 py-3"><div><RichGoalEditor key={`${g.id}-m${m}`} minHeight={165} initialHtml={monthHtmlOf(g, m)} onChange={(html, text) => setGoalMonth(g.id, m, html, text)} /></div></td>)
                    )}
                  </tr>
                ))}
                {!regularGoals.length && <tr><td colSpan={10} className="p-12 text-center text-sm font-bold text-slate-400">계획표에서 목표를 먼저 추가하세요.</td></tr>}
              </tbody>
            </table>
          </div>
          </div>
        </section>
      )}

      {!loading && tab === "mission" && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4">
            <div>
              <h3 className="text-base font-black text-slate-950 lg:text-lg">{year}년 {quarter}분기 미션결과표</h3>
              <p className="mt-0.5 text-[11px] font-semibold text-slate-400">미션별 기존 방식·개선 방식·소요시간·진행률을 기록합니다.</p>
            </div>
            <button disabled={!person} onClick={() => addGoal("mission")} className="rounded-full bg-amber-500 px-4 py-2 text-sm font-black text-white transition hover:bg-amber-600 disabled:opacity-40">+ 미션 추가</button>
          </div>
          <div className="p-5">
          <div className="space-y-4">
            {missionGoals.map((g, i) => (
              <div key={g.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70 p-4 pl-5">
                <span className="absolute inset-y-0 left-0 w-1 bg-amber-400" />
                <div className="grid gap-2 lg:grid-cols-[40px_1fr_80px_80px_80px_100px_36px]">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-sm font-black text-slate-400 shadow-sm">{i + 1}</span>
                  <div className="min-w-0"><RichGoalEditor key={`${g.id}-title`} minHeight={40} initialHtml={goalHtmlOf(g)} onChange={(html, text) => setGoal(g.id, { titleHtml: html, title: text })} /></div>
                  <select value={g.grade || ""} onChange={(e) => setGoal(g.id, { grade: e.target.value })} className="rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"><option value="">등급</option>{GRADE_OPTIONS.map((grade) => <option key={grade}>{grade}</option>)}</select>
                  <input value={g.currentLevel} onChange={(e) => setGoal(g.id, { currentLevel: e.target.value })} placeholder="현재" className="rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                  <input value={g.targetLevel} onChange={(e) => setGoal(g.id, { targetLevel: e.target.value })} placeholder="목표" className="rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                  <input type="number" min="0" max="999" value={g.progress || ""} onChange={(e) => setGoal(g.id, { progress: Number(e.target.value) || 0 })} placeholder="진도%" className="rounded-lg border border-slate-300 bg-white px-2 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                  <button onClick={() => setPlan({ ...plan, goals: plan.goals.filter((x) => x.id !== g.id) })} className="text-slate-300 hover:text-rose-500">×</button>
                </div>
                <div className="mt-3 flex justify-end">
                  <button type="button" onClick={() => setGoal(g.id, { resultMerged: !g.resultMerged })} className="rounded-full border border-slate-200 bg-white transition hover:bg-slate-50 px-3 py-1.5 text-xs font-black text-slate-500">
                    {g.resultMerged ? "나누기" : "합치기"}
                  </button>
                </div>
                {g.resultMerged ? (
                  <div className="mt-3 text-xs font-bold text-slate-500">
                    {(quarter - 1) * 3 + 1}~{(quarter - 1) * 3 + 3}월 미션 결과
                    <div className="mt-1"><RichGoalEditor key={`${g.id}-merged`} minHeight={210} initialHtml={monthHtmlOf(g, 1)} onChange={(html, text) => setGoalMonth(g.id, 1, html, text)} /></div>
                  </div>
                ) : (
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    {([1, 2, 3] as const).map((m) => <div key={m} className="text-xs font-bold text-slate-500">{(quarter - 1) * 3 + m}월 미션 결과<div className="mt-1"><RichGoalEditor key={`${g.id}-m${m}`} minHeight={165} initialHtml={monthHtmlOf(g, m)} onChange={(html, text) => setGoalMonth(g.id, m, html, text)} /></div></div>)}
                  </div>
                )}
              </div>
            ))}
            {!missionGoals.length && <div className="rounded-xl border border-dashed border-slate-300 p-12 text-center text-sm font-bold text-slate-400">미션을 추가하세요.</div>}
          </div>
          </div>
          {person && (
            <div className="sticky bottom-2 z-10 mx-3 mb-3 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.10)] backdrop-blur">
              <span className="text-[11px] font-bold text-slate-400">{statusText[planAutoSaveStatus]}</span>
              <button onClick={savePlan} className="rounded-full bg-blue-600 px-5 py-2 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700">지금 저장</button>
            </div>
          )}
        </section>
      )}

      {!loading && tab === "golden" && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-base font-black text-slate-950 lg:text-lg">{year}년 {quarter}분기 골든미팅카드</h3>
              <p className="mt-0.5 text-[11px] font-semibold text-slate-400">선택 분기의 계획표·분기결과표·미션결과표를 근거로 작성하세요.</p>
            </div>
            <button type="button" onClick={runGoldenAi} disabled={goldenBusy} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-50">
              {goldenBusy ? "AI 변환 중…" : "최신분기 AI변환"}
            </button>
          </div>
          {/* 질문 8개는 화면의 탭 역할 — 눌린 것만 진하게, 나머지는 조용히 */}
          <div className="grid grid-cols-2 gap-1.5 border-b border-slate-100 p-3 lg:grid-cols-4 2xl:grid-cols-8">
            {GOLDEN_QUESTIONS.map((q, i) => <button key={q} onClick={() => setQuestion(i)} className={`rounded-lg px-3 py-2.5 text-xs font-black leading-tight transition ${question === i ? "bg-slate-900 text-white shadow-sm" : "bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-700"}`}>{q}</button>)}
          </div>
          <div className="p-5">
            <h4 className="text-[15px] font-black text-slate-900 lg:text-lg">{GOLDEN_QUESTIONS[question]}</h4>
            <div className="mt-3 grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
              {GOLDEN_CATEGORIES.map((cat) => <label key={cat} className="text-[11px] font-black text-slate-500">{cat}<textarea value={answer(GOLDEN_QUESTIONS[question], cat)} onChange={(e) => setAnswer(GOLDEN_QUESTIONS[question], cat, e.target.value)} rows={8} className="mt-1 w-full resize-y rounded-lg border border-slate-300 bg-white p-3 text-sm font-normal leading-relaxed outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" /></label>)}
            </div>
          </div>
          {person && (
            <div className="sticky bottom-2 z-10 mx-3 mb-3 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.10)] backdrop-blur">
              <span className="text-[11px] font-bold text-slate-400">{statusText[cardAutoSaveStatus]}</span>
              <button onClick={saveCard} className="rounded-full bg-blue-600 px-5 py-2 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700">지금 저장</button>
            </div>
          )}
        </section>
      )}

      {gatherResult && (
        <div className="fixed inset-0 z-[80] flex items-end bg-slate-950/45 p-0 sm:items-center sm:justify-center sm:p-6">
          <div className="flex max-h-[88vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:max-w-4xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <div className="text-base font-black text-slate-950">{gatherResult.title}</div>
                <div className="mt-0.5 text-xs font-semibold text-slate-400">확인 후 복사하거나 txt로 받을 수 있습니다.</div>
              </div>
              <button type="button" onClick={() => setGatherResult(null)} className="rounded-full px-3 py-1.5 text-xs font-bold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700">닫기</button>
            </div>
            <textarea
              value={gatherResult.text}
              onChange={(e) => setGatherResult({ ...gatherResult, text: e.target.value })}
              className="min-h-[55vh] flex-1 resize-none bg-slate-50 p-5 font-mono text-sm leading-6 text-slate-800 outline-none"
            />
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-white px-5 py-4">
              <button type="button" onClick={downloadGatherResult} className="rounded-full border border-slate-200 bg-white transition hover:bg-slate-50 px-4 py-2 text-sm font-black text-slate-600 hover:bg-slate-50">txt 다운로드</button>
              <button type="button" onClick={copyGatherResult} className="rounded-full bg-slate-900 transition hover:bg-slate-800 px-4 py-2 text-sm font-black text-white">복사</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
