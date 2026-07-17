import { useEffect, useMemo, useRef, useState } from "react";
import { AUTHOR_TEAMS, useAuthorBook } from "./authors";
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

export default function GrowthHub({ author }: { author: string }) {
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

  const buildGoldenPayload = (exampleCard?: GoldenCard, exampleMeta?: { year: number; quarter: number }) => {
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
    };
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
      const exampleCard = await getGoldenCard(person, prev.year, prev.quarter);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/golden-card-transform`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
        body: JSON.stringify(buildGoldenPayload(exampleCard, prev)),
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
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-xs font-bold uppercase tracking-wide text-blue-600">분기 회고를 빠르게 준비하는 기록함</div>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950 lg:text-3xl">성장기록 허브</h2>
        <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-500">
          주간현황판 기록을 모아보고, 공식 분기목표 양식의 계획표·결과표·미션결과표·골든미팅카드를 관리합니다.
        </p>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm xl:flex-row xl:items-center xl:justify-between">
        <div className="grid grid-cols-2 gap-1 rounded-md bg-slate-100 p-1 md:grid-cols-5">
          {([["records", "성장기록 모아보기"], ["plan", "계획표"], ["result", "분기결과표"], ["mission", "미션결과표"], ["golden", "골든미팅카드"]] as [Tab, string][]).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} className={`rounded px-5 py-2 text-sm font-bold transition ${tab === key ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>{label}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700">
            {Array.from({ length: 6 }, (_, i) => now.getFullYear() - 4 + i).map((y) => <option key={y}>{y}</option>)}
          </select>
          {tab !== "records" && (
            <div className="flex gap-1 rounded-md bg-slate-100 p-1">
              {[1, 2, 3, 4].map((q) => <button key={q} onClick={() => setQuarter(q)} className={`rounded px-3 py-1.5 text-sm font-bold transition ${quarter === q ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{q}Q</button>)}
            </div>
          )}
          <select value={person} onChange={(e) => setPerson(e.target.value)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700">
            <option value="">전체 직원</option>
            {AUTHOR_TEAMS.map((team) => <optgroup key={team} label={`${team}팀`}>{book[team].map((name) => <option key={name}>{name}</option>)}</optgroup>)}
          </select>
        </div>
      </section>

      {tab === "records" && (
        <section className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <span className="mr-2 text-xs font-bold text-slate-500">조회 범위</span>
          {([["month", "월별"], ["quarter", "분기"]] as [RecordPeriod, string][]).map(([key, label]) => (
            <button key={key} onClick={() => setRecordPeriod(key)} className={`rounded px-3 py-2 text-xs font-bold transition ${recordPeriod === key ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:text-slate-800"}`}>{label}</button>
          ))}
          {recordPeriod === "month" ? (
            <select value={recordMonth} onChange={(e) => setRecordMonth(Number(e.target.value))} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
            </select>
          ) : (
            <div className="flex gap-1 rounded-md bg-slate-100 p-1">
              {[1, 2, 3, 4].map((q) => <button key={q} onClick={() => setQuarter(q)} className={`rounded px-3 py-1.5 text-xs font-bold transition ${quarter === q ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{q}Q</button>)}
            </div>
          )}
        </section>
      )}

      {message && <div className="rounded-lg bg-blue-50 p-3 text-sm font-semibold text-blue-700">{message}</div>}
      {loading && <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">불러오는 중입니다.</div>}

      {!loading && tab === "records" && (
        <>
          <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap gap-1">
              {(["all", "growth", "learning", "challenge", "special"] as RecordType[]).map((key) => (
                <button key={key} onClick={() => setType(key)} className={`rounded px-3 py-1.5 text-xs font-bold transition ${type === key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:text-slate-800"}`}>{typeLabels[key]}</button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => openGatherResult("growth")} className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700">성장노트 모음</button>
              <button onClick={() => openGatherResult("learning")} className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700">배운점 모음</button>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="내용 또는 직원 검색" className="min-w-64 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold outline-none focus:border-blue-300" />
            </div>
          </section>

          {type === "all" ? (
            <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              {rows.map((row) => {
                const id = `${row.author}-${row.weekStart}`;
                const count = recordTypes.filter(([key]) => row[key].trim()).length;
                const open = !!openRows[id];
                return (
                  <div key={id} className="border-b border-slate-100 last:border-0">
                    <button type="button" onClick={() => setOpenRows({ ...openRows, [id]: !open })} className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-slate-50">
                      <div>
                        <div className="text-sm font-black text-slate-900">{weekDisplay(row.weekStart)} · {row.author}</div>
                        <div className="mt-1 text-xs font-semibold text-slate-400">기록 {count}개</div>
                      </div>
                      <span className="text-xs font-black text-blue-600">{open ? "접기" : "펼치기"}</span>
                    </button>
                    {open && (
                      <div className="grid gap-3 bg-slate-50 p-4 lg:grid-cols-2">
                        {recordTypes.map(([key, label]) => row[key].trim() && (
                          <div key={key} className="rounded-md border border-slate-200 bg-white p-4">
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
            <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="border-b border-slate-200 px-4 py-3 text-xs font-black text-slate-500">주차</th>
                      <th className="border-b border-slate-200 px-4 py-3 text-xs font-black text-slate-500">작성자</th>
                      {fieldLabels[type].map((label) => <th key={label} className="border-b border-slate-200 px-4 py-3 text-xs font-black text-slate-500">{label}</th>)}
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

      {!loading && tab === "plan" && (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-black text-slate-950">{year}년 {quarter}분기 계획표</h3>
              <p className="text-xs font-semibold text-slate-500">시트 양식처럼 기본업무와 미션업무를 한 행에서 함께 관리합니다.</p>
            </div>
            <div className="flex gap-2">
              <button disabled={!person} onClick={() => addGoal("regular")} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">기본업무 추가</button>
              <button disabled={!person} onClick={() => addGoal("mission")} className="rounded-md bg-orange-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">미션업무 추가</button>
            </div>
          </div>
          {!person && <div className="mt-8 text-center text-sm text-amber-600">작성자 직원을 선택하세요.</div>}
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[1680px] border-collapse text-left">
              <thead>
                <tr>
                  <th colSpan={9} className="border border-slate-300 bg-blue-50 px-3 py-2 text-center text-xs font-black text-slate-700">기본업무 (우선순위순)</th>
                  <th colSpan={6} className="border border-slate-300 bg-amber-50 px-3 py-2 text-center text-xs font-black text-orange-700">미션업무</th>
                </tr>
                <tr>
                  {["구분", "업무등급", "목표", "현재레벨", "목표레벨", "요청예산(분기)", "예산반영", "진도율", ""].map((label) => <th key={label} className="border border-slate-300 bg-slate-50 px-2 py-2 text-xs font-black text-slate-500">{label}</th>)}
                  {["목표", "업무등급", "요청예산(분기)", "예산반영", "진도율", ""].map((label) => <th key={`m-${label}`} className="border border-slate-300 bg-amber-50 px-2 py-2 text-xs font-black text-orange-700">{label}</th>)}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: Math.max(regularGoals.length, missionGoals.length, 1) }, (_, i) => {
                  const g = regularGoals[i];
                  const m = missionGoals[i];
                  return (
                  <tr key={`${g?.id || "empty"}-${m?.id || "empty"}-${i}`} className="align-top">
                    {g ? (
                      <>
                        <td className="border border-slate-300 p-2"><select value={g.category} onChange={(e) => setGoal(g.id, { category: e.target.value })} className="w-24 rounded border border-slate-200 bg-white px-2 py-1.5 text-sm font-semibold">{PLAN_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></td>
                        <td className="border border-slate-300 p-2"><select value={g.grade || ""} onChange={(e) => setGoal(g.id, { grade: e.target.value })} className="w-16 rounded border border-slate-200 bg-white px-2 py-1.5 text-sm font-semibold"><option value="">-</option>{GRADE_OPTIONS.map((grade) => <option key={grade}>{grade}</option>)}</select></td>
                        <td className="border border-slate-300 p-2"><textarea value={g.title} onChange={(e) => setGoal(g.id, { title: e.target.value })} rows={4} className="w-full min-w-[430px] resize-y rounded border border-slate-200 bg-white p-2 text-sm font-bold leading-5 text-slate-900" /></td>
                        <td className="border border-slate-300 p-2"><input value={g.currentLevel} onChange={(e) => setGoal(g.id, { currentLevel: e.target.value })} className="w-12 rounded border border-slate-200 px-2 py-1.5 text-sm" /></td>
                        <td className="border border-slate-300 p-2"><input value={g.targetLevel} onChange={(e) => setGoal(g.id, { targetLevel: e.target.value })} className="w-12 rounded border border-slate-200 px-2 py-1.5 text-sm" /></td>
                        <td className="border border-slate-300 p-2"><input value={g.budget} onChange={(e) => setGoal(g.id, { budget: e.target.value })} className="w-20 rounded border border-slate-200 px-2 py-1.5 text-sm" /></td>
                        <td className="border border-slate-300 p-2"><input value={g.reflectedBudget || ""} onChange={(e) => setGoal(g.id, { reflectedBudget: e.target.value })} className="w-20 rounded border border-slate-200 px-2 py-1.5 text-sm" /></td>
                        <td className="border border-slate-300 p-2"><input type="number" min="0" max="999" value={g.progress || ""} onChange={(e) => setGoal(g.id, { progress: Number(e.target.value) || 0 })} className="w-12 rounded border border-slate-200 px-2 py-1.5 text-sm" /></td>
                        <td className="border border-slate-300 p-2"><button onClick={() => setPlan({ ...plan, goals: plan.goals.filter((x) => x.id !== g.id) })} className="rounded px-2 py-1 text-slate-300 hover:bg-rose-50 hover:text-rose-500">×</button></td>
                      </>
                    ) : <td colSpan={9} className="border border-slate-300 bg-slate-50 p-2 text-center text-xs text-slate-300">기본업무 없음</td>}
                    {m ? (
                      <>
                        <td className="border border-slate-300 p-2"><textarea value={m.title} onChange={(e) => setGoal(m.id, { title: e.target.value })} rows={4} className="w-full min-w-[300px] resize-y rounded border border-orange-200 bg-white p-2 text-sm font-bold leading-5 text-orange-700" /></td>
                        <td className="border border-slate-300 p-2"><select value={m.grade || ""} onChange={(e) => setGoal(m.id, { grade: e.target.value })} className="w-16 rounded border border-orange-200 bg-white px-2 py-1.5 text-sm"><option value="">-</option>{GRADE_OPTIONS.map((grade) => <option key={grade}>{grade}</option>)}</select></td>
                        <td className="border border-slate-300 p-2"><input value={m.budget} onChange={(e) => setGoal(m.id, { budget: e.target.value })} className="w-20 rounded border border-orange-200 px-2 py-1.5 text-sm" /></td>
                        <td className="border border-slate-300 p-2"><input value={m.reflectedBudget || ""} onChange={(e) => setGoal(m.id, { reflectedBudget: e.target.value })} className="w-20 rounded border border-orange-200 px-2 py-1.5 text-sm" /></td>
                        <td className="border border-slate-300 p-2"><input type="number" min="0" max="999" value={m.progress || ""} onChange={(e) => setGoal(m.id, { progress: Number(e.target.value) || 0 })} className="w-12 rounded border border-orange-200 px-2 py-1.5 text-sm" /></td>
                        <td className="border border-slate-300 p-2"><button onClick={() => setPlan({ ...plan, goals: plan.goals.filter((x) => x.id !== m.id) })} className="rounded px-2 py-1 text-slate-300 hover:bg-rose-50 hover:text-rose-500">×</button></td>
                      </>
                    ) : <td colSpan={6} className="border border-slate-300 bg-amber-50/40 p-2 text-center text-xs text-orange-200">미션업무 없음</td>}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {person && (
            <button onClick={savePlan} className="mt-5 w-full rounded-md border border-blue-100 bg-blue-50 py-3 text-sm font-black text-blue-700 hover:bg-blue-100">
              {statusText[planAutoSaveStatus]} · 지금 저장
            </button>
          )}
        </section>
      )}

      {!loading && tab === "result" && (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-black text-slate-950">{year}년 {quarter}분기 결과표</h3>
              <p className="text-xs font-semibold text-slate-500">목표별 월간 결과를 기록합니다. 수치와 진행률 %는 반드시 남기는 기준으로 사용하세요.</p>
            </div>
            <div className="text-xs font-black text-blue-700">{statusText[planAutoSaveStatus]}</div>
          </div>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[1280px] text-left">
              <thead className="bg-slate-50">
                <tr>
                  <th className="border-b border-slate-200 px-3 py-3 text-xs font-black text-slate-500">구분</th>
                  <th className="border-b border-slate-200 px-3 py-3 text-xs font-black text-slate-500">목표</th>
                  <th className="border-b border-slate-200 px-3 py-3 text-xs font-black text-slate-500">등급</th>
                  <th className="border-b border-slate-200 px-3 py-3 text-xs font-black text-slate-500">현재</th>
                  <th className="border-b border-slate-200 px-3 py-3 text-xs font-black text-slate-500">목표</th>
                  <th className="border-b border-slate-200 px-3 py-3 text-xs font-black text-slate-500">진도율</th>
                  <th className="border-b border-slate-200 px-3 py-3 text-xs font-black text-slate-500">셀</th>
                  {[1, 2, 3].map((m) => <th key={m} className="border-b border-slate-200 px-3 py-3 text-xs font-black text-slate-500">{(quarter - 1) * 3 + m}월</th>)}
                </tr>
              </thead>
              <tbody>
                {regularGoals.map((g) => (
                  <tr key={g.id} className="border-b border-slate-100 align-top">
                    <td className="px-3 py-3 text-sm font-bold text-slate-700">{g.category}</td>
                    <td className="whitespace-pre-wrap px-3 py-3 text-sm leading-6 text-slate-700">{g.title || "-"}</td>
                    <td className="px-3 py-3 text-sm text-slate-600">{g.grade || "-"}</td>
                    <td className="px-3 py-3 text-sm text-slate-600">{g.currentLevel || "-"}</td>
                    <td className="px-3 py-3 text-sm text-slate-600">{g.targetLevel || "-"}</td>
                    <td className="px-3 py-3 text-sm font-black text-blue-700">{g.progress || 0}%</td>
                    <td className="px-3 py-3"><button type="button" onClick={() => setGoal(g.id, { resultMerged: !g.resultMerged })} className="whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-black text-slate-500 hover:bg-slate-50">{g.resultMerged ? "나누기" : "합치기"}</button></td>
                    {g.resultMerged ? (
                      <td colSpan={3} className="px-3 py-3">
                        <textarea value={g.month1} onChange={(e) => setGoal(g.id, { month1: e.target.value })} rows={8} className="w-full min-w-[820px] resize-y rounded-md border border-slate-300 bg-white p-3 text-sm leading-6 outline-none focus:border-blue-300" />
                      </td>
                    ) : (
                      [1, 2, 3].map((m) => <td key={m} className="px-3 py-3"><textarea value={g[`month${m}` as "month1"]} onChange={(e) => setGoal(g.id, { [`month${m}`]: e.target.value })} rows={7} className="w-full min-w-[260px] resize-y rounded-md border border-slate-300 bg-white p-3 text-sm leading-6 outline-none focus:border-blue-300" /></td>)
                    )}
                  </tr>
                ))}
                {!regularGoals.length && <tr><td colSpan={10} className="p-12 text-center text-sm text-slate-400">계획표에서 목표를 먼저 추가하세요.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!loading && tab === "mission" && (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-black text-slate-950">{year}년 {quarter}분기 미션결과표</h3>
              <p className="text-xs font-semibold text-slate-500">미션 목표별 기존 방식, 현재 개선 방식, 소요시간, 진행률을 기록합니다.</p>
            </div>
            <button disabled={!person} onClick={() => addGoal("mission")} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">미션 추가</button>
          </div>
          <div className="mt-5 space-y-4">
            {missionGoals.map((g, i) => (
              <div key={g.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="grid gap-2 lg:grid-cols-[48px_1fr_80px_80px_80px_100px_36px]">
                  <span className="py-2 text-center text-sm font-black text-slate-300">{i + 1}</span>
                  <input value={g.title} onChange={(e) => setGoal(g.id, { title: e.target.value })} placeholder="미션 목표" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" />
                  <select value={g.grade || ""} onChange={(e) => setGoal(g.id, { grade: e.target.value })} className="rounded-md border border-slate-300 bg-white px-2 text-sm"><option value="">등급</option>{GRADE_OPTIONS.map((grade) => <option key={grade}>{grade}</option>)}</select>
                  <input value={g.currentLevel} onChange={(e) => setGoal(g.id, { currentLevel: e.target.value })} placeholder="현재" className="rounded-md border border-slate-300 bg-white px-2 text-sm" />
                  <input value={g.targetLevel} onChange={(e) => setGoal(g.id, { targetLevel: e.target.value })} placeholder="목표" className="rounded-md border border-slate-300 bg-white px-2 text-sm" />
                  <input type="number" min="0" max="999" value={g.progress || ""} onChange={(e) => setGoal(g.id, { progress: Number(e.target.value) || 0 })} placeholder="진도%" className="rounded-md border border-slate-300 bg-white px-2 text-sm" />
                  <button onClick={() => setPlan({ ...plan, goals: plan.goals.filter((x) => x.id !== g.id) })} className="text-slate-300 hover:text-rose-500">×</button>
                </div>
                <div className="mt-3 flex justify-end">
                  <button type="button" onClick={() => setGoal(g.id, { resultMerged: !g.resultMerged })} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-500 hover:bg-slate-50">
                    {g.resultMerged ? "나누기" : "합치기"}
                  </button>
                </div>
                {g.resultMerged ? (
                  <label className="mt-3 block text-xs font-bold text-slate-500">
                    {(quarter - 1) * 3 + 1}~{(quarter - 1) * 3 + 3}월 미션 결과
                    <textarea value={g.month1} onChange={(e) => setGoal(g.id, { month1: e.target.value })} rows={9} className="mt-1 w-full resize-y rounded-md border border-slate-300 bg-white p-3 text-sm font-normal leading-6 outline-none focus:border-blue-300" />
                  </label>
                ) : (
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    {[1, 2, 3].map((m) => <label key={m} className="text-xs font-bold text-slate-500">{(quarter - 1) * 3 + m}월 미션 결과<textarea value={g[`month${m}` as "month1"]} onChange={(e) => setGoal(g.id, { [`month${m}`]: e.target.value })} rows={7} className="mt-1 w-full resize-y rounded-md border border-slate-300 bg-white p-3 text-sm font-normal leading-6 outline-none focus:border-blue-300" /></label>)}
                  </div>
                )}
              </div>
            ))}
            {!missionGoals.length && <div className="rounded-lg border border-dashed border-slate-200 p-12 text-center text-sm text-slate-400">미션을 추가하세요.</div>}
          </div>
          {person && (
            <button onClick={savePlan} className="mt-5 w-full rounded-md border border-blue-100 bg-blue-50 py-3 text-sm font-black text-blue-700 hover:bg-blue-100">
              {statusText[planAutoSaveStatus]} · 지금 저장
            </button>
          )}
        </section>
      )}

      {!loading && tab === "golden" && (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-xl font-black text-slate-950">{year}년 {quarter}분기 골든미팅카드</h3>
              <p className="text-xs font-semibold text-slate-500">최신 선택 분기의 계획표·분기결과표·미션결과표를 근거로 작성하세요.</p>
            </div>
            <button type="button" onClick={runGoldenAi} disabled={goldenBusy} className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-black text-blue-700 hover:bg-blue-100 disabled:opacity-50">
              {goldenBusy ? "AI 변환 중..." : "최신분기 AI변환"}
            </button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {GOLDEN_QUESTIONS.map((q, i) => <button key={q} onClick={() => setQuestion(i)} className={`rounded-md px-3 py-3 text-xs font-bold transition ${question === i ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:text-slate-800"}`}>{q}</button>)}
          </div>
          <div className="mt-5">
            <h4 className="text-lg font-black text-slate-900">{GOLDEN_QUESTIONS[question]}</h4>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              {GOLDEN_CATEGORIES.map((cat) => <label key={cat} className="text-xs font-bold text-slate-500">{cat}<textarea value={answer(GOLDEN_QUESTIONS[question], cat)} onChange={(e) => setAnswer(GOLDEN_QUESTIONS[question], cat, e.target.value)} rows={8} className="mt-1 w-full resize-y rounded-md border border-slate-300 bg-white p-3 text-sm font-normal leading-relaxed outline-none focus:border-blue-300" /></label>)}
            </div>
          </div>
          {person && (
            <button onClick={saveCard} className="mt-5 w-full rounded-md border border-blue-100 bg-blue-50 py-3 text-sm font-black text-blue-700 hover:bg-blue-100">
              {statusText[cardAutoSaveStatus]} · 지금 저장
            </button>
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
              <button type="button" onClick={() => setGatherResult(null)} className="rounded-md px-3 py-2 text-sm font-bold text-slate-400 hover:bg-slate-100 hover:text-slate-700">닫기</button>
            </div>
            <textarea
              value={gatherResult.text}
              onChange={(e) => setGatherResult({ ...gatherResult, text: e.target.value })}
              className="min-h-[55vh] flex-1 resize-none bg-slate-50 p-5 font-mono text-sm leading-6 text-slate-800 outline-none"
            />
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-white px-5 py-4">
              <button type="button" onClick={downloadGatherResult} className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-600 hover:bg-slate-50">txt 다운로드</button>
              <button type="button" onClick={copyGatherResult} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-black text-white">복사</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
