/**
 * 필드 탭 청정기 양식 패널. 상태는 App 에 있고 이 화면은 props 로 받아 콜백만 부른다.
 * App.tsx에서 글자 그대로 옮겨 왔고(2026-10-24, docs/tasks/field-form-tidy.md S4), S6 에서 겉모양만 "한 장의 종이"로 정돈했다.
 */
import { authorLocked } from "../sso";
import { AuthorPicker } from "./AuthorPicker";
import { NumSelect } from "./NumSelect";
import { DURATION_STEPS, HOUR_OPTIONS, MINUTE_OPTIONS, YESNO_OPTIONS, type AirPurifierForm } from "./fieldFormModel";
import { Field, FieldFormCard, FieldFormHead, FieldSection, FIELD_TEXTAREA } from "./FieldFormShell.view";

export type AirPurifierFormPanelProps = {
  form: AirPurifierForm;
  setAirF: <K extends keyof AirPurifierForm>(key: K, value: AirPurifierForm[K]) => void;
  accent: string;
  author: string;
  setAuthor: (v: string) => void;
};

export function AirPurifierFormPanel({
  form, setAirF, accent,
  author, setAuthor,
}: AirPurifierFormPanelProps) {
  return (
    <FieldFormCard label="청정기 양식">
      {/* 머리: 작성자 */}
      <FieldFormHead accent={accent}>
        <Field label="작성자">
          {authorLocked() ? <div className="truncate rounded-lg border border-transparent px-2 py-2 text-sm font-semibold text-slate-900">{author}</div> /* 그룹웨어 로그인 고정이면 이름만 글자로(2026-10-19 사용자 "없애라") */ : <AuthorPicker value={author} onChange={setAuthor} accent={accent} />}
        </Field>
      </FieldFormHead>

      {/* 필터리셋 / 필터교체 · 특이사항 */}
      <FieldSection className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <Field label="필터리셋">
            <NumSelect
              value={form.filterReset}
              onChange={(v) => setAirF("filterReset", v)}
              options={YESNO_OPTIONS}
              placeholder="-"
              accent={accent}
            />
          </Field>
          <Field label="필터교체">
            <NumSelect
              value={form.filterChange}
              onChange={(v) => setAirF("filterChange", v)}
              options={YESNO_OPTIONS}
              placeholder="-"
              accent={accent}
            />
          </Field>
        </div>

        <Field label="특이사항">
          <textarea
            value={form.notes}
            onChange={(e) => setAirF("notes", e.target.value)}
            rows={3}
            className={FIELD_TEXTAREA}
          />
        </Field>
      </FieldSection>

      {/* 시간 */}
      <FieldSection title="시간" className="space-y-4">
        <Field label="도착 시간" aside={form.arrivalHour ? (
          <span className="ml-auto text-xs font-semibold" style={{ color: accent }}>
            {form.arrivalHour}:{form.arrivalMinute || "00"}
          </span>
        ) : null}>
          <div className="grid grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] gap-1.5">
            <NumSelect
              value={form.arrivalHour}
              onChange={(v) => setAirF("arrivalHour", v)}
              options={HOUR_OPTIONS}
              placeholder="시"
              accent={accent}
              suffix="시"
            />
            <NumSelect
              value={form.arrivalMinute}
              onChange={(v) => setAirF("arrivalMinute", v)}
              options={MINUTE_OPTIONS}
              placeholder="분"
              accent={accent}
              suffix="분"
            />
          </div>
        </Field>

        <Field label="소요 시간" aside={
          <span className="ml-auto flex items-center gap-2">
            <span className="text-sm font-bold" style={{ color: accent }}>
              {form.duration ? `${form.duration}분` : "0분"}
            </span>
            {form.duration && (
              <button
                type="button"
                onClick={() => setAirF("duration", "")}
                className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] text-slate-600 transition hover:bg-slate-200 active:scale-95"
              >
                초기화
              </button>
            )}
          </span>
        }>
          <div className="grid grid-cols-5 gap-1.5">
            {DURATION_STEPS.map((step: number) => (
              <button
                key={step}
                type="button"
                onClick={() => {
                  const current = parseInt(form.duration || "0", 10) || 0;
                  setAirF("duration", String(current + step));
                }}
                className="rounded-lg bg-slate-100 py-2.5 text-sm font-semibold text-slate-700 transition active:scale-95"
              >
                +{step}
              </button>
            ))}
          </div>
        </Field>
      </FieldSection>
    </FieldFormCard>
  );
}
