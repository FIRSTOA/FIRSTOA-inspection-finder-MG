import { useEffect, useMemo, useState } from "react";
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

type Tab = "records" | "plan" | "golden";
type RecordType = "all" | "growth" | "learning" | "challenge" | "special";
type RecordPeriod = "month" | "quarter";

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
  learning: ["날짜", "브랜드", "기종", "배운 점", "소요시간", "교육자"],
  challenge: ["내용"],
  special: ["내용"],
};
const hasRecordContent = (note: WeeklyNoteRow) => recordTypes.some(([key]) => String(note[key] || "").trim());
type LearningParsed = { 날짜: string; 브랜드: string; 기종: string; "배운 점": string; 소요시간: string; 교육자: string };

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
  return `${weekNumberInMonth(weekStart)}주차`;
}

function buildGrowthGatherText(rows: WeeklyNoteRow[]) {
  const body = rows
    .filter((row) => row.growth.trim())
    .map((row) => `[${weekLabelOnly(row.weekStart)}]\n${row.growth.trim()}`)
    .join("\n\n");
  return body || "정리할 성장노트가 없습니다.";
}

function buildLearningGatherText(rows: WeeklyNoteRow[]) {
  const lines = rows.flatMap((row) =>
    row.learning
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `${weekLabelOnly(row.weekStart)} ${line}`),
  );
  return lines.join("\n") || "정리할 배운 점이 없습니다.";
}

const growthGatherInstruction = `아래 성장노트를 주차별로 정리해줘.
응답은 코드 복사하기 좋은 일반 텍스트로만 작성해.
각 주차는 반드시 [1주차], [2주차] 형식으로 시작해.
각 주차 안에는 상황, 문제점, 개선해야할 점, 실행을 이 순서로 정리해.
이미 적힌 내용을 과장하지 말고, 문장은 짧고 명확하게 다듬어줘.

출력 예시:
[1주차]
상황:
문제점:
개선해야할 점:
실행:`;

const learningGatherInstruction = `아래 배운 점 기록을 날짜별, 브랜드/기종별로 정리해줘.
응답은 코드 복사하기 좋은 일반 텍스트로만 작성해.
맨 위에는 총 투자 시간, 월/주/일 평균 시간을 계산해 적어줘.
그 아래는 [삼성] 85분, [제록스] 90분처럼 브랜드 또는 분류별로 묶어줘.
각 줄은 "M/D 브랜드 기종 배운내용 -교육자 [소요시간]" 형식으로 정리해.
브랜드가 애매하면 소형기, 기타처럼 알맞게 묶어줘.
날짜 순서를 유지하고, 교육자가 있으면 줄 끝의 소요시간 앞에 붙여줘.
없는 정보는 억지로 만들지 마.`;

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
  const [aiBusy, setAiBusy] = useState<"growth" | "learning" | "">("");
  const [aiResult, setAiResult] = useState<{ title: string; text: string } | null>(null);

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
      })
      .catch((e) => alive && setMessage((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [person, year, quarter, range.start, range.end]);

  const rows = useMemo(() => notes.filter((note) => {
    if (!hasRecordContent(note)) return false;
    if (person && note.author !== person) return false;
    if (type !== "all" && !note[type].trim()) return false;
    const search = query.trim().toLowerCase();
    if (!search) return true;
    const allText = recordTypes.map(([key]) => note[key]).join(" ");
    return `${note.author} ${note.weekStart} ${allText}`.toLowerCase().includes(search);
  }), [notes, person, query, type]);

  const runGatherAi = async (key: "growth" | "learning") => {
    const input = key === "growth" ? buildGrowthGatherText(rows) : buildLearningGatherText(rows);
    if (input.includes("정리할") && input.includes("없습니다")) {
      setMessage(input);
      return;
    }
    setAiBusy(key);
    setMessage("");
    try {
      const endpoint = String(import.meta.env.VITE_AI_TRANSFORM_URL || `${SUPABASE_URL}/functions/v1/growth-note-transform`);
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
        body: JSON.stringify({
          text: input,
          instruction: key === "growth" ? growthGatherInstruction : learningGatherInstruction,
          outputMode: "raw",
        }),
      });
      if (!res.ok) throw new Error(`AI 변환 실패(${res.status})`);
      const data = await res.json();
      const text = String(data.result || data.text || data.output || "").trim();
      setAiResult({ title: key === "growth" ? "성장노트 모으기 AI변환" : "배운 점 모으기 AI변환", text: text || input });
    } catch (e) {
      setMessage((e as Error).message || "AI 변환에 실패했습니다.");
    } finally {
      setAiBusy("");
    }
  };

  const copyAiResult = async () => {
    if (!aiResult) return;
    await navigator.clipboard.writeText(aiResult.text);
    setMessage("AI변환 결과를 복사했습니다.");
  };

  const downloadAiResult = () => {
    if (!aiResult) return;
    const blob = new Blob([aiResult.text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${aiResult.title}_${year}-${recordPeriod === "month" ? `${pad(recordMonth)}월` : `${quarter}Q`}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const addGoal = () => {
    const g: LevelGoal = { id: crypto.randomUUID(), category: "자기개발", title: "", currentLevel: "", targetLevel: "", budget: "", month1: "", month2: "", month3: "", progress: 0 };
    setPlan({ ...plan, author: person, year, quarter, goals: [...plan.goals, g] });
  };
  const setGoal = (id: string, patch: Partial<LevelGoal>) => setPlan({ ...plan, goals: plan.goals.map((g) => g.id === id ? { ...g, ...patch } : g) });
  const savePlan = async () => {
    try {
      await saveQuarterlyPlan({ ...plan, author: person, year, quarter });
      setMessage("레벨업계획을 저장했습니다.");
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const answer = (q: string, cat: string) => card.answers[q]?.[cat] || "";
  const setAnswer = (q: string, cat: string, value: string) => setCard({ ...card, answers: { ...card.answers, [q]: { ...(card.answers[q] || {}), [cat]: value } } });
  const saveCard = async () => {
    try {
      await saveGoldenCard({ ...card, author: person, year, quarter });
      setMessage("골든미팅카드를 저장했습니다.");
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  return (
    <div className="space-y-5 pb-16">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-xs font-bold uppercase tracking-wide text-blue-600">분기 회고를 빠르게 준비하는 기록함</div>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950 lg:text-3xl">성장기록 허브</h2>
        <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-500">
          주간현황판에 적은 성장노트, 배운 점, 아이디어, 특이사항을 모아봅니다. 분기 회고 때는 정리 프롬프트를 복사해서 GPT에 붙여넣으면 됩니다.
        </p>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm xl:flex-row xl:items-center xl:justify-between">
        <div className="grid grid-cols-3 gap-1 rounded-md bg-slate-100 p-1">
          {([["records", "성장기록 모아보기"], ["plan", "레벨업계획"], ["golden", "골든미팅카드"]] as [Tab, string][]).map(([key, label]) => (
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
              <button disabled={!!aiBusy} onClick={() => runGatherAi("growth")} className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 disabled:opacity-50">{aiBusy === "growth" ? "변환 중..." : "성장노트 모으기 AI변환"}</button>
              <button disabled={!!aiBusy} onClick={() => runGatherAi("learning")} className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 disabled:opacity-50">{aiBusy === "learning" ? "변환 중..." : "배운 점 모으기 AI변환"}</button>
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
              <h3 className="text-xl font-black text-slate-950">{year}년 {quarter}분기 레벨업계획</h3>
              <p className="text-xs font-semibold text-slate-500">목표와 월별 실행 결과를 한 표에서 관리합니다.</p>
            </div>
            <button disabled={!person} onClick={addGoal} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">목표 추가</button>
          </div>
          {!person && <div className="mt-8 text-center text-sm text-amber-600">작성자 직원을 선택하세요.</div>}
          <div className="mt-5 space-y-4">
            {plan.goals.map((g, i) => (
              <div key={g.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="grid gap-2 lg:grid-cols-[40px_120px_1fr_90px_90px_120px_80px_36px]">
                  <span className="py-2 text-center text-sm font-bold text-slate-300">{i + 1}</span>
                  <select value={g.category} onChange={(e) => setGoal(g.id, { category: e.target.value })} className="rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold">{[...GOLDEN_CATEGORIES, "기타"].map((c) => <option key={c}>{c}</option>)}</select>
                  <input value={g.title} onChange={(e) => setGoal(g.id, { title: e.target.value })} placeholder="목표와 실행기준" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" />
                  <input value={g.currentLevel} onChange={(e) => setGoal(g.id, { currentLevel: e.target.value })} placeholder="현재" className="rounded-md border border-slate-300 bg-white px-2 text-sm" />
                  <input value={g.targetLevel} onChange={(e) => setGoal(g.id, { targetLevel: e.target.value })} placeholder="목표" className="rounded-md border border-slate-300 bg-white px-2 text-sm" />
                  <input value={g.budget} onChange={(e) => setGoal(g.id, { budget: e.target.value })} placeholder="예산" className="rounded-md border border-slate-300 bg-white px-2 text-sm" />
                  <input type="number" min="0" max="100" value={g.progress || ""} onChange={(e) => setGoal(g.id, { progress: Number(e.target.value) || 0 })} placeholder="진도%" className="rounded-md border border-slate-300 bg-white px-2 text-sm" />
                  <button onClick={() => setPlan({ ...plan, goals: plan.goals.filter((x) => x.id !== g.id) })} className="text-slate-300 hover:text-rose-500">×</button>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  {[1, 2, 3].map((m) => <label key={m} className="text-xs font-bold text-slate-500">{(quarter - 1) * 3 + m}월 결과<textarea value={g[`month${m}` as "month1"]} onChange={(e) => setGoal(g.id, { [`month${m}`]: e.target.value })} rows={5} className="mt-1 w-full resize-y rounded-md border border-slate-300 bg-white p-3 text-sm font-normal leading-relaxed outline-none focus:border-blue-300" /></label>)}
                </div>
              </div>
            ))}
          </div>
          {person && <button onClick={savePlan} className="mt-5 w-full rounded-md bg-blue-600 py-3 text-sm font-bold text-white">레벨업계획 저장</button>}
        </section>
      )}

      {!loading && tab === "golden" && (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <h3 className="text-xl font-black text-slate-950">{year}년 {quarter}분기 골든미팅카드</h3>
            <p className="text-xs font-semibold text-slate-500">성장기록 모아보기에서 정리한 내용을 참고해 작성하세요.</p>
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
          {person && <button onClick={saveCard} className="mt-5 w-full rounded-md bg-blue-600 py-3 text-sm font-bold text-white">골든미팅카드 저장</button>}
        </section>
      )}

      {aiResult && (
        <div className="fixed inset-0 z-[80] flex items-end bg-slate-950/45 p-0 sm:items-center sm:justify-center sm:p-6" onClick={() => setAiResult(null)}>
          <div className="flex max-h-[88vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:max-w-4xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <div className="text-base font-black text-slate-950">{aiResult.title}</div>
                <div className="mt-0.5 text-xs font-semibold text-slate-400">확인 후 복사하거나 txt로 받을 수 있습니다.</div>
              </div>
              <button type="button" onClick={() => setAiResult(null)} className="rounded-md px-3 py-2 text-sm font-bold text-slate-400 hover:bg-slate-100 hover:text-slate-700">닫기</button>
            </div>
            <textarea
              value={aiResult.text}
              onChange={(e) => setAiResult({ ...aiResult, text: e.target.value })}
              className="min-h-[55vh] flex-1 resize-none bg-slate-50 p-5 font-mono text-sm leading-6 text-slate-800 outline-none"
            />
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-white px-5 py-4">
              <button type="button" onClick={downloadAiResult} className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-600 hover:bg-slate-50">txt 다운로드</button>
              <button type="button" onClick={copyAiResult} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-black text-white">복사</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
