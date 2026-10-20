// 핵심방향 띠(2026-10-21 다시 만듦) — 월 통합집계 맨 위. 머리글 한 문장 + "주간 실행 → 월말 확인 → 분기 정리" 3단계 타임라인.
// 저장은 부모(onChange)가 한다(okr_cycles.direction 텍스트 한 덩어리). okr.ts 의 directionSteps 는 쓰지 않는다(이 파일 안 헬퍼만).
//
// 저장 형식(줄 단위):
//   1번째 줄            = 머리글(핵심방향 한 문장). 머리글이 비면 이 줄을 생략한다.
//   "주간: …"           = 주간 실행
//   "월말: …"           = 월말 확인
//   "분기: …"           = 분기 정리
//   접두 없는 줄이 접두 줄 뒤에 오면 바로 앞 단계의 다음 줄(여러 줄 본문)로 붙는다.
//   읽을 때는 "주간 실행:" · "월말 확인:" · "분기 정리:" · 전각 콜론(：)도 받아 준다. 빈 단계는 줄을 쓰지 않는다.
//
// 옛 글 호환(접두 줄이 하나도 없는 글, 예: 10월 전사본 3문장):
//   - 보기: 첫 줄 = 머리글, 나머지 줄은 문단으로 그대로 보인다(억지로 쪼개지 않음).
//   - [고치기]: 머리글 칸 = 첫 줄, 나머지는 "주간 실행" 칸에 통째로 넣고 안내 한 줄을 띄운다. 사람이 나눠 옮기면
//     입력하는 순간 새 형식으로 저장된다(아무것도 안 고치고 [완료]면 원문 그대로 남는다).
// 정규식에 lookbehind((?<=), (?<!)) 금지 — 옛 사파리에서 SyntaxError 로 화면 전체가 안 뜬다.
import { useState } from "react";
import { Check, Info, Pencil, Target } from "lucide-react";

type StepKey = "week" | "month" | "quarter";
type DirectionFields = { headline: string; week: string; month: string; quarter: string };
type ParsedDirection = { fields: DirectionFields; legacy: boolean; rest: string[] };

const STEPS: Array<{ key: StepKey; no: number; title: string; ask: string; prefix: string }> = [
  { key: "week", no: 1, title: "주간 실행", ask: "주간 실행을", prefix: "주간" },
  { key: "month", no: 2, title: "월말 확인", ask: "월말 확인을", prefix: "월말" },
  { key: "quarter", no: 3, title: "분기 정리", ask: "분기 정리를", prefix: "분기" },
];

// "주간:" / "주간 실행:" / "월말 확인 :" / "분기：" 등. 줄 맨 앞만 본다.
const PREFIX_RE = /^(주간|월말|분기)(?:\s*(?:실행|확인|정리))?\s*[:：]\s*/;

function stepKeyOf(word: string): StepKey {
  return word === "월말" ? "month" : word === "분기" ? "quarter" : "week";
}

function parseDirection(text: string): ParsedDirection {
  const lines = (text || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const fields: DirectionFields = { headline: "", week: "", month: "", quarter: "" };
  const legacy = !lines.some((l) => PREFIX_RE.test(l));
  if (legacy) return { fields: { ...fields, headline: lines[0] || "" }, legacy: true, rest: lines.slice(1) };
  const parts: Record<StepKey, string[]> = { week: [], month: [], quarter: [] };
  const rest: string[] = [];
  let current: StepKey | "" = "";
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] || "";
    const m = PREFIX_RE.exec(line);
    if (m) {
      const key = stepKeyOf(m[1] || "");
      current = key;
      const body = line.slice(m[0].length).trim();
      if (body) parts[key].push(body);
    } else if (i === 0) {
      fields.headline = line;
    } else if (current !== "") {
      parts[current].push(line);
    } else {
      rest.push(line); // 머리글과 첫 접두 줄 사이의 접두 없는 줄
    }
  }
  return { fields: { ...fields, week: parts.week.join("\n"), month: parts.month.join("\n"), quarter: parts.quarter.join("\n") }, legacy: false, rest };
}

function serializeDirection(f: DirectionFields): string {
  const out: string[] = [];
  const headline = f.headline.replace(/\s*\r?\n\s*/g, " ").trim();
  if (headline) out.push(headline);
  for (const s of STEPS) {
    const body = f[s.key].split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (body.length) out.push(`${s.prefix}: ${body[0]}`, ...body.slice(1));
  }
  return out.join("\n");
}

// [고치기] 를 눌렀을 때 칸 4개에 넣을 값. 옛 글·머리글 밑 접두 없는 줄은 "주간 실행" 칸 앞쪽에 통째로.
function toDraft(p: ParsedDirection): { draft: DirectionFields; moved: boolean } {
  const moved = p.rest.length > 0;
  const week = [...p.rest, p.fields.week].filter(Boolean).join("\n");
  return { draft: { ...p.fields, week }, moved };
}

const BTN = "inline-flex min-h-11 items-center gap-1 rounded-full border border-slate-200 bg-white px-3 text-[12px] font-black text-slate-700 transition hover:border-indigo-300 hover:text-indigo-700 sm:min-h-8";
const INPUT = "w-full resize-y rounded-lg border border-slate-300 bg-white p-2 text-base leading-relaxed text-slate-900 outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200 sm:text-[13px]";

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
  const setField = (key: keyof DirectionFields, value: string) => {
    if (!draft) return;
    const next: DirectionFields = { ...draft, [key]: value };
    setDraft(next);
    onChange(serializeDirection(next));
  };

  const { fields, rest } = parsed;
  const hasSteps = STEPS.some((s) => fields[s.key].trim());
  const empty = !fields.headline && !hasSteps && rest.length === 0;

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
          <span>예전 글은 "주간 실행" 칸에 통째로 넣었습니다. 월말 확인·분기 정리에 해당하는 문장은 해당 칸으로 잘라 옮겨 주세요.</span>
        </div>}
        <label className="block">
          <span className="mb-1 block text-[12px] font-black text-slate-700">핵심방향 한 문장</span>
          <textarea value={draft.headline} onChange={(e) => setField("headline", e.target.value)} rows={2} autoFocus placeholder="이번 달 팀이 향하는 방향을 한 문장으로 적어 주세요." className={`${INPUT} font-bold`} />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          {STEPS.map((s) => <label key={s.key} className="block">
            <span className="mb-1 flex items-center gap-1.5 text-[12px] font-black text-slate-700">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[11px] font-black tabular-nums text-white">{s.no}</span>{s.title}
            </span>
            <textarea value={draft[s.key]} onChange={(e) => setField(s.key, e.target.value)} rows={3} placeholder={`${s.ask} 적어 주세요.`} className={INPUT} />
          </label>)}
        </div>
        <div className="text-[11px] text-slate-400">입력하는 대로 자동 저장됩니다. 끝나면 [완료]를 눌러 주세요.</div>
      </div>
      : empty
        ? <div className="px-3 py-4 text-[13px] text-slate-500">{editable ? "아직 핵심방향이 없습니다. [고치기]를 눌러 이번 달 핵심방향을 적어 주세요." : "아직 핵심방향이 등록되지 않았습니다."}</div>
        : <div className="space-y-3 px-3 py-3">
          {fields.headline
            ? <div className="border-l-4 border-indigo-600 pl-3 text-[17px] font-black leading-snug text-slate-900 sm:text-lg">{fields.headline}</div>
            : <div className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-[13px] text-slate-400">{editable ? "핵심방향 한 문장을 적어 주세요." : "핵심방향 문장이 아직 없습니다."}</div>}

          {parsed.legacy
            ? rest.length > 0 && <div className="space-y-1 text-[13px] leading-relaxed text-slate-700">{rest.map((r, i) => <p key={i} className="whitespace-pre-wrap">{r}</p>)}</div>
            : <>
              {rest.length > 0 && <div className="space-y-1 text-[13px] leading-relaxed text-slate-700">{rest.map((r, i) => <p key={i} className="whitespace-pre-wrap">{r}</p>)}</div>}
              <ol className="flex flex-col sm:grid sm:grid-cols-3 sm:gap-3">
                {STEPS.map((s, i) => {
                  const body = fields[s.key].trim();
                  const last = i === STEPS.length - 1;
                  return <li key={s.key} className="flex gap-2 sm:block">
                    <div className="flex shrink-0 flex-col items-center sm:flex-row">
                      <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-black tabular-nums ${body ? "bg-indigo-600 text-white" : "border border-slate-300 bg-white text-slate-400"}`}>{s.no}</span>
                      {!last && <span aria-hidden className="mt-1 w-px flex-1 bg-indigo-200 sm:mt-0 sm:-mr-3 sm:ml-2 sm:h-px sm:w-auto" />}
                    </div>
                    <div className={`min-w-0 flex-1 ${last ? "" : "pb-3"} sm:mt-1.5 sm:pb-0`}>
                      <div className="flex min-h-7 items-center text-[13px] font-black text-slate-900 sm:min-h-0">{s.title}</div>
                      {body
                        ? <div className="mt-0.5 whitespace-pre-wrap text-[13px] leading-snug text-slate-700">{body}</div>
                        : <div className="mt-1 rounded-lg border border-dashed border-slate-200 px-2 py-1.5 text-[12px] text-slate-400">{editable ? `${s.ask} 적어 주세요` : "아직 적지 않았습니다"}</div>}
                    </div>
                  </li>;
                })}
              </ol>
            </>}
        </div>}
  </section>;
}
