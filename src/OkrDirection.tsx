// 핵심방향 띠(2026-10-21 다시 만듦) — 월 통합집계 맨 위. 머리글 한 문장 + 3단계 타임라인(기본 제목 "주간 실행 → 월말 확인 → 분기 정리").
// 저장은 부모(onChange)가 한다(okr_cycles.direction 텍스트 한 덩어리). okr.ts 의 directionSteps 는 쓰지 않는다(이 파일 안 헬퍼만).
//
// 저장 형식(줄 단위, 2026-10-21 2차 — 단계 제목도 고칠 수 있게):
//   1번째 줄            = 머리글(핵심방향 한 문장). 머리글이 비면 이 줄을 생략한다.
//   "1. 제목: 본문"     = 1단계(기본 제목 "주간 실행")
//   "2. 제목: 본문"     = 2단계(기본 제목 "월말 확인")
//   "3. 제목: 본문"     = 3단계(기본 제목 "분기 정리")
//   접두 없는 줄이 접두 줄 뒤에 오면 바로 앞 단계의 다음 줄(여러 줄 본문)로 붙는다.
//   쓸 때는 제목이 기본값이어도 항상 적는다. 본문이 비고 제목도 기본값인 단계는 줄을 쓰지 않는다
//   (제목만 바꾸고 본문이 빈 단계는 "2. 제목:" 처럼 제목을 지키려고 줄을 쓴다). 제목 안의 콜론·줄바꿈은 지운다.
//   읽을 때는 "1)" · 전각 점(．) · 전각 콜론(：)도 받아 주고, 제목이 비면("1. : 본문") 기본 제목으로 본다.
//
// 1차 형식 호환(읽기만): "주간: …" / "월말: …" / "분기: …" 와 "주간 실행:" · "월말 확인:" · "분기 정리:" 변형은
//   기본 제목의 1·2·3단계로 읽는다. 한 번이라도 고치면 새 번호 형식으로 다시 저장된다.
//
// 옛 글 호환(접두 줄이 하나도 없는 글, 예: 10월 전사본 3문장):
//   - 보기: 첫 줄 = 머리글, 나머지 줄은 문단으로 그대로 보인다(억지로 쪼개지 않음).
//   - [고치기]: 머리글 칸 = 첫 줄, 나머지는 1단계 칸에 통째로 넣고 안내 한 줄을 띄운다. 사람이 나눠 옮기면
//     입력하는 순간 새 형식으로 저장된다(아무것도 안 고치고 [완료]면 원문 그대로 남는다).
//
// 보기 모드: 본문이 있는 단계만 그린다(번호는 원래 번호, 연결선은 보이는 단계끼리). 셋 다 비면 단계 영역 없이 연한 안내 한 줄.
// 정규식에 lookbehind((?<=), (?<!)) 금지 — 옛 사파리에서 SyntaxError 로 화면 전체가 안 뜬다.
import { useState } from "react";
import { Check, Info, Pencil, Target } from "lucide-react";

type StepKey = "week" | "month" | "quarter";
type StepTitles = Record<StepKey, string>;
type DirectionFields = { headline: string; week: string; month: string; quarter: string; titles: StepTitles };
type ParsedDirection = { fields: DirectionFields; legacy: boolean; rest: string[] };
type TextKey = "headline" | StepKey;

const STEPS: ReadonlyArray<{ key: StepKey; no: 1 | 2 | 3; title: string }> = [
  { key: "week", no: 1, title: "주간 실행" },
  { key: "month", no: 2, title: "월말 확인" },
  { key: "quarter", no: 3, title: "분기 정리" },
];

// 새 형식: "1. 제목: 본문" / "2) 제목：본문" / "3. : 본문"(제목 비면 기본). 줄 맨 앞만 본다.
const NUM_RE = /^([123])\s*[.)．]\s*([^:：\n]*?)\s*[:：]\s*/;
// 1차 형식: "주간:" / "주간 실행:" / "월말 확인 :" / "분기：" 등.
const PREFIX_RE = /^(주간|월말|분기)(?:\s*(?:실행|확인|정리))?\s*[:：]\s*/;

function emptyTitles(): StepTitles {
  return { week: "", month: "", quarter: "" };
}

function stepKeyOfWord(word: string): StepKey {
  return word === "월말" ? "month" : word === "분기" ? "quarter" : "week";
}

function stepKeyOfNo(no: string): StepKey {
  return no === "2" ? "month" : no === "3" ? "quarter" : "week";
}

function cleanTitle(t: string): string {
  return t.replace(/[:：\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function titleOf(titles: StepTitles, key: StepKey): string {
  const t = cleanTitle(titles[key] || "");
  if (t) return t;
  const def = STEPS.find((s) => s.key === key);
  return def ? def.title : "";
}

// 줄 맨 앞의 단계 접두를 읽는다. 없으면 null.
function matchStep(line: string): { key: StepKey; title: string; body: string } | null {
  const n = NUM_RE.exec(line);
  if (n) return { key: stepKeyOfNo(n[1] || ""), title: cleanTitle(n[2] || ""), body: line.slice(n[0].length).trim() };
  const p = PREFIX_RE.exec(line);
  if (p) return { key: stepKeyOfWord(p[1] || ""), title: "", body: line.slice(p[0].length).trim() };
  return null;
}

function parseDirection(text: string): ParsedDirection {
  const lines = (text || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const base: DirectionFields = { headline: "", week: "", month: "", quarter: "", titles: emptyTitles() };
  const legacy = !lines.some((l) => matchStep(l) !== null);
  if (legacy) return { fields: { ...base, headline: lines[0] || "" }, legacy: true, rest: lines.slice(1) };
  const parts: Record<StepKey, string[]> = { week: [], month: [], quarter: [] };
  const titles = emptyTitles();
  const rest: string[] = [];
  let headline = "";
  let current: StepKey | "" = "";
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] || "";
    const m = matchStep(line);
    if (m) {
      current = m.key;
      if (m.title && !titles[m.key]) titles[m.key] = m.title; // 같은 번호가 두 번 오면 먼저 적힌 제목
      if (m.body) parts[m.key].push(m.body);
    } else if (i === 0) {
      headline = line;
    } else if (current !== "") {
      parts[current].push(line);
    } else {
      rest.push(line); // 머리글과 첫 접두 줄 사이의 접두 없는 줄
    }
  }
  return {
    fields: { headline, week: parts.week.join("\n"), month: parts.month.join("\n"), quarter: parts.quarter.join("\n"), titles },
    legacy: false,
    rest,
  };
}

function serializeDirection(f: DirectionFields): string {
  const out: string[] = [];
  const headline = f.headline.replace(/\s*\r?\n\s*/g, " ").trim();
  if (headline) out.push(headline);
  for (const s of STEPS) {
    const body = f[s.key].split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const title = titleOf(f.titles, s.key);
    const customTitle = title !== s.title;
    if (!body.length && !customTitle) continue;
    out.push(body.length ? `${s.no}. ${title}: ${body[0]}` : `${s.no}. ${title}:`, ...body.slice(1));
  }
  return out.join("\n");
}

// [고치기] 를 눌렀을 때 칸에 넣을 값. 옛 글·머리글 밑 접두 없는 줄은 1단계 칸 앞쪽에 통째로.
function toDraft(p: ParsedDirection): { draft: DirectionFields; moved: boolean } {
  const moved = p.rest.length > 0;
  const week = [...p.rest, p.fields.week].filter(Boolean).join("\n");
  return { draft: { ...p.fields, week, titles: { ...p.fields.titles } }, moved };
}

// 보이는 단계 수에 맞춘 PC 칸 수(Tailwind 는 글자 그대로의 클래스만 만든다).
const COLS: Record<number, string> = { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" };

const BTN = "inline-flex min-h-11 items-center gap-1 rounded-full border border-slate-200 bg-white px-3 text-[12px] font-black text-slate-700 transition hover:border-indigo-300 hover:text-indigo-700 sm:min-h-8";
const INPUT = "w-full resize-y rounded-lg border border-slate-300 bg-white p-2 text-base leading-relaxed text-slate-900 outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200 sm:text-[13px]";
const TITLE_INPUT = "min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-base font-black text-slate-900 outline-none placeholder:font-black placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200 sm:min-h-8 sm:text-[13px]";

export default function OkrDirection({ text, editable, onChange, label = "핵심방향" }: { text: string; editable: boolean; onChange: (t: string) => void; label?: string }) {
  const [draft, setDraft] = useState<DirectionFields | null>(null); // null = 보기 모드
  const [moved, setMoved] = useState(false);
  const parsed = parseDirection(text || "");
  const editing = editable && draft !== null;

  const startEdit = () => {
    const d = toDraft(parsed);
    setDraft(d.draft);
    setMoved(d.moved);
  };
  const commit = (next: DirectionFields) => {
    setDraft(next);
    onChange(serializeDirection(next));
  };
  const setField = (key: TextKey, value: string) => {
    if (!draft) return;
    const next: DirectionFields = { ...draft, titles: { ...draft.titles } };
    next[key] = value;
    commit(next);
  };
  const setTitle = (key: StepKey, value: string) => {
    if (!draft) return;
    commit({ ...draft, titles: { ...draft.titles, [key]: value.replace(/[:：\r\n]/g, "") } });
  };

  const { fields, rest } = parsed;
  const visibleSteps = STEPS.filter((s) => fields[s.key].trim() !== "");
  const empty = !fields.headline && visibleSteps.length === 0 && rest.length === 0;
  // 단계가 하나도 없을 때의 연한 안내. 옛 글 문단이 보이는 경우엔 띄우지 않는다.
  const showNoStepsHint = visibleSteps.length === 0 && !(parsed.legacy && rest.length > 0);

  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-1">
      <Target size={14} aria-hidden className="shrink-0 text-indigo-600" />
      <div className="text-[12px] font-black tracking-wide text-indigo-700">★ {label}</div>
      <div className="ml-auto">
        {editable && (editing
          ? <button type="button" onClick={() => { setDraft(null); setMoved(false); }} className={BTN}><Check size={14} aria-hidden />완료</button>
          : <button type="button" onClick={startEdit} className={BTN}><Pencil size={13} aria-hidden />고치기</button>)}
      </div>
    </div>

    {editing && draft
      ? <div className="space-y-3 p-3">
        {moved && <div className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-[12px] font-semibold leading-snug text-amber-900">
          <Info size={14} aria-hidden className="mt-0.5 shrink-0" />
          <span>예전 글은 1단계 "{titleOf(draft.titles, "week")}" 칸에 통째로 넣었습니다. 2·3단계에 해당하는 문장은 해당 칸으로 잘라 옮겨 주세요.</span>
        </div>}
        <label className="block">
          <span className="mb-1 block text-[12px] font-black text-slate-700">핵심방향 한 문장</span>
          <textarea value={draft.headline} onChange={(e) => setField("headline", e.target.value)} rows={2} autoFocus placeholder="이번 달 팀이 향하는 방향을 한 문장으로 적어 주세요." className={`${INPUT} font-bold`} />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          {STEPS.map((s) => {
            const shown = titleOf(draft.titles, s.key);
            return <div key={s.key} className="min-w-0">
              <div className="mb-1 flex items-center gap-1.5">
                <span aria-hidden className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[11px] font-black tabular-nums text-white">{s.no}</span>
                <input type="text" value={draft.titles[s.key]} onChange={(e) => setTitle(s.key, e.target.value)} maxLength={20} placeholder={s.title} aria-label={`${s.no}단계 제목(비우면 "${s.title}")`} className={TITLE_INPUT} />
              </div>
              <textarea value={draft[s.key]} onChange={(e) => setField(s.key, e.target.value)} rows={3} aria-label={`${s.no}단계 ${shown} 내용`} placeholder={`${shown} 내용을 적어 주세요.`} className={INPUT} />
            </div>;
          })}
        </div>
        <div className="text-[11px] text-slate-400">입력하는 대로 자동 저장됩니다. 단계 제목을 비우면 기본 제목으로 돌아갑니다. 끝나면 [완료]를 눌러 주세요.</div>
      </div>
      : empty
        ? <div className="px-3 py-4 text-[13px] text-slate-500">{editable ? "아직 핵심방향이 없습니다. [고치기]를 눌러 이번 달 핵심방향을 적어 주세요." : "아직 핵심방향이 등록되지 않았습니다."}</div>
        : <div className="space-y-3 px-3 py-3">
          {fields.headline
            ? <div className="border-l-4 border-indigo-600 pl-3 text-[17px] font-black leading-snug text-slate-900 sm:text-lg">{fields.headline}</div>
            : <div className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-[13px] text-slate-400">{editable ? "핵심방향 한 문장을 적어 주세요." : "핵심방향 문장이 아직 없습니다."}</div>}

          {rest.length > 0 && <div className="space-y-1 text-[13px] leading-relaxed text-slate-700">{rest.map((r, i) => <p key={i} className="whitespace-pre-wrap">{r}</p>)}</div>}

          {showNoStepsHint
            ? <div className="text-[12px] text-slate-400">{editable ? "주간·월말·분기 단계는 [고치기]에서 적습니다." : "아직 적지 않았습니다."}</div>
            : visibleSteps.length > 0 && <ol className={`flex flex-col sm:grid sm:gap-3 ${COLS[visibleSteps.length] || "sm:grid-cols-3"}`}>
              {visibleSteps.map((s, i) => {
                const body = fields[s.key].trim();
                const last = i === visibleSteps.length - 1;
                return <li key={s.key} className="flex gap-2 sm:block">
                  <div className="flex shrink-0 flex-col items-center sm:flex-row">
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[12px] font-black tabular-nums text-white">{s.no}</span>
                    {!last && <span aria-hidden className="mt-1 w-px flex-1 bg-indigo-200 sm:mt-0 sm:-mr-3 sm:ml-2 sm:h-px sm:w-auto" />}
                  </div>
                  <div className={`min-w-0 flex-1 ${last ? "" : "pb-3"} sm:mt-1.5 sm:pb-0`}>
                    <div className="flex min-h-7 items-center text-[13px] font-black text-slate-900 sm:min-h-0">{titleOf(fields.titles, s.key)}</div>
                    <div className="mt-0.5 whitespace-pre-wrap text-[13px] leading-snug text-slate-700">{body}</div>
                  </div>
                </li>;
              })}
            </ol>}
        </div>}
  </section>;
}
