/**
 * 필드 탭 점검·AS 공용 양식 패널. 상태는 App 에 있고 이 화면은 props 로 받아 콜백만 부른다.
 * App.tsx에서 글자 그대로 옮겨 왔고(2026-10-24, docs/tasks/field-form-tidy.md S5), S6 에서 겉모양만 "한 장의 종이"로 정돈했다
 * (카드 1장 + 구분선 + 글자 라벨, 칸마다 회색 바탕 없음). 값·콜백·보내는 글자는 그대로다.
 */
import { useEffect, useRef, useState } from "react";
import { UI } from "../ui/card";
import { authorLocked } from "../sso";
import ReportTypeSelector from "../ReportTypeSelector";
import { AuthorPicker } from "./AuthorPicker";
import { NumSelect } from "./NumSelect";
import { DevicePicker } from "./DevicePicker";
import { SpareQuickEditor } from "./SpareQuickEditor";
import { CounterOcrButton } from "./CounterOcrButton";
import { GradeCustomInput, GradeSelect } from "./GradeSelect";
import { applyGradeEverywhere, gradeChoice, hasGradeLine, readGradeLine, type GradeSetters } from "./gradeField";
import { DURATION_STEPS, HANTIN_OPTIONS, HOUR_OPTIONS, LEVEL_OPTIONS, MINUTE_OPTIONS, PARKING_OPTIONS, SHIP_OPTIONS, TONER_COLORS, type DeviceInfo, type PerItemForm, type SharedForm } from "./fieldFormModel";
import { Field, FieldFormCard, FieldFormHead, FieldSection, FIELD_TEXTAREA } from "./FieldFormShell.view";
import { nowRoundedDown5, suggestDuration } from "./arrivalTime";

export type ProcessingFormPanelProps = {
  itemForm: PerItemForm;
  setItemF: <K extends keyof PerItemForm>(key: K, value: PerItemForm[K]) => void;
  shared: SharedForm;
  setSharedF: <K extends keyof SharedForm>(key: K, value: SharedForm[K]) => void;
  itemCount: number;
  itemLabels: string[];
  selectedItem: number;
  setSelectedItem: (i: number) => void;
  accent: string;
  bgSoft: string; // S6(Q3)부터 칸 바탕에 쓰지 않는다 — App 호출부를 바꾸지 않으려고 자리만 남김
  author: string;
  setAuthor: (v: string) => void;
  reportTypes: string[];
  reportTypeOther: string;
  setReportTypes: (v: string[]) => void;
  setReportTypeOther: (v: string) => void;
  canManageDevices: boolean;
  allItemForms: PerItemForm[];
  onAddDevice: (info: DeviceInfo) => void;
  onUpdateDevice: (i: number, info: DeviceInfo) => void;
  onMoveDevice: (i: number, direction: -1 | 1) => void;
  onReorderDevice: (from: number, to: number) => void;
  onRemoveDevice: (i: number) => void;
  showLevel: boolean;
  showHantinParking: boolean;
  regionValue: string;
  /** 등급 — 결과 글(textOutput 또는 listOutput[0])의 "등급:" 줄이 값. gradeSetters 를 안 넘기면 등급 칸을 그리지 않는다 */
  gradeText?: string;
  gradeSetters?: GradeSetters;
  /** (테스트·직접 지정용) 등급 값과 바꾸기. gradeText/gradeSetters 보다 앞선다. null = 줄이 아직 없음(원본 전, 잠금) */
  grade?: string | null;
  onGrade?: (v: string) => void;
};

// 매수·잔량 숫자칸은 예전 높이(py-1.5) 그대로 — 폰에서 양식이 길어지지 않게(Q2). 나머지 한 줄 입력은 UI.input(h-10)
const countCell = "flex items-stretch overflow-hidden rounded-lg border border-slate-300 bg-white focus-within:border-blue-500";
const countTag = "flex w-9 shrink-0 items-center justify-center bg-slate-100 px-1 text-[11px] font-bold text-slate-600";
const countInput = "w-full min-w-0 bg-transparent px-2 py-1.5 text-sm font-semibold text-slate-900 outline-none";
const tonerInput = "w-full min-w-0 rounded-lg border border-slate-300 bg-white px-1 py-1.5 text-center text-sm font-semibold text-slate-900 outline-none focus:border-blue-500";
const toggleRow = "flex min-h-11 w-full items-center justify-between text-left text-[13px] font-bold text-slate-700";

export function ProcessingFormPanel({
  itemForm, setItemF,
  shared, setSharedF,
  itemCount, itemLabels, selectedItem, setSelectedItem,
  accent,
  author, setAuthor,
  reportTypes, reportTypeOther, setReportTypes, setReportTypeOther,
  canManageDevices, allItemForms, onAddDevice, onUpdateDevice, onMoveDevice, onReorderDevice, onRemoveDevice,
  showLevel, showHantinParking, regionValue,
  gradeText, gradeSetters, grade: gradeProp, onGrade: onGradeProp,
}: ProcessingFormPanelProps) {
  const grade = gradeProp !== undefined ? gradeProp : gradeSetters ? (hasGradeLine(gradeText || "") ? readGradeLine(gradeText || "") : null) : undefined;
  const onGrade = onGradeProp || (gradeSetters ? (g: string) => applyGradeEverywhere(g, gradeSetters.text, gradeSetters.list, gradeSetters.blocks) : undefined);
  const [partsExpanded, setPartsExpanded] = useState(false);
  // 직접 입력 글 칸 — 직접 입력을 골랐거나 목록 밖 값(불러온 '유지보수' 등)이면 연다. 목록 값을 고르면 닫는다
  const [gradeCustomPicked, setGradeCustomPicked] = useState(false);
  const showGrade = grade !== undefined && !!onGrade;
  const gradeCustomOpen = showGrade && grade !== null && (gradeCustomPicked || gradeChoice(grade).custom);
  const [selfExpanded, setSelfExpanded] = useState(false);
  // 소요 시간 "지금까지 n분" 제안 — 1분마다 지금 시각을 다시 읽는다(F-1, 2026-10-27)
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const durationSuggest = shared.duration ? null : suggestDuration(shared.arrivalHour, shared.arrivalMinute, now);
  // [지금] — App 의 setSharedF 는 그 렌더의 sharedForm 으로 미리보기 '도착시간' 줄을 고치므로, 한 번에 두 번 부르면
  // 두 번째가 옛 시를 쓴다. 시를 먼저 넣고, 새 시가 그려진 뒤(아래 effect) 분을 넣는다.
  const pendingArrivalMinute = useRef<{ hour: string; minute: string } | null>(null);
  useEffect(() => {
    const p = pendingArrivalMinute.current;
    if (!p || shared.arrivalHour !== p.hour) return;
    pendingArrivalMinute.current = null;
    if (shared.arrivalMinute !== p.minute) setSharedF("arrivalMinute", p.minute);
  });
  const fillArrivalNow = () => {
    const t = nowRoundedDown5(new Date());
    if (shared.arrivalHour === t.hour) {
      if (shared.arrivalMinute !== t.minute) setSharedF("arrivalMinute", t.minute);
      return;
    }
    pendingArrivalMinute.current = t;
    setSharedF("arrivalHour", t.hour);
  };
  const chip = (active: boolean) => ({ background: active ? accent : "#F1F5F9", color: active ? "white" : "#334155" });

  return (
    <FieldFormCard label="점검·AS 양식">
      {/* 머리: 작성자 / 지역 / 등급 / 구분 / 레벨 — 폰(390px)은 작성자 한 줄 + 지역·등급·구분·레벨 한 줄, sm 이상은 한 줄 */}
      <FieldFormHead accent={accent} className={`grid gap-2 ${showGrade
        ? (showLevel ? "grid-cols-[4rem_4.5rem_minmax(0,1fr)_4.5rem] sm:grid-cols-[minmax(0,1fr)_4rem_4.5rem_minmax(0,1fr)_4.5rem]" : "grid-cols-[4rem_4.5rem_minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_4rem_4.5rem_minmax(0,1fr)]")
        : (showLevel ? "grid-cols-[minmax(0,1fr)_4rem_minmax(0,1fr)_4.5rem]" : "grid-cols-[minmax(0,1fr)_4rem_minmax(0,1fr)]")}`}>
        <Field label="작성자" className={showGrade ? "col-span-full sm:col-span-1" : ""}>
          {authorLocked() ? <div className="truncate rounded-lg border border-transparent px-2 py-2 text-sm font-semibold text-slate-900">{author}</div> /* 그룹웨어 로그인 고정이면 이름만 글자로(2026-10-19 사용자 "없애라") */ : <AuthorPicker value={author} onChange={setAuthor} accent={accent} />}
        </Field>
        <Field label="지역">
          <NumSelect
            value={shared.region || regionValue}
            onChange={(v) => setSharedF("region", v)}
            options={["A", "B", "C", "D", "E"]}
            placeholder="-"
            accent={accent}
          />
        </Field>
        {showGrade && (
          <Field label="등급">
            {grade === null
              ? <div className="truncate rounded-lg border border-dashed border-slate-300 px-2 py-2 text-sm text-slate-400" title="원본을 넣으면 고를 수 있습니다">-</div>
              : <GradeSelect value={grade} accent={accent} onCustom={() => setGradeCustomPicked(true)} onChange={(v) => { setGradeCustomPicked(false); onGrade!(v); }} />}
          </Field>
        )}
        <Field label="구분" aside={<span className="text-[11px] text-slate-400">중복</span>}>
          <ReportTypeSelector selected={reportTypes} other={reportTypeOther} onSelected={setReportTypes} onOther={setReportTypeOther} accent={accent} />
        </Field>
        {showLevel && (
          <Field label="레벨">
            <NumSelect
              value={shared.level}
              onChange={(v) => setSharedF("level", v)}
              options={LEVEL_OPTIONS}
              placeholder="-"
              accent={accent}
            />
          </Field>
        )}
        {gradeCustomOpen && (
          <div className="col-span-full">
            <GradeCustomInput value={grade ?? ""} onChange={(v) => onGrade!(v)} autoFocus={gradeCustomPicked} />
          </div>
        )}
      </FieldFormHead>

      {/* 기기 · 처리내용 · 매수 · 잔량 · 여분 */}
      <FieldSection className="space-y-4">
        {canManageDevices ? <DevicePicker forms={allItemForms} labels={itemLabels} selected={selectedItem} onSelect={setSelectedItem} onAdd={onAddDevice} onUpdate={onUpdateDevice} onMove={onMoveDevice} onReorder={onReorderDevice} onRemove={onRemoveDevice} /> : itemCount > 1 && (
          <NumSelect value={String(selectedItem)} onChange={(v) => setSelectedItem(Number(v))} options={Array.from({ length: itemCount }, (_, i) => String(i))} labels={itemLabels} placeholder="기기 선택" accent={accent} />
        )}

        <Field label="처리내용">
          <textarea
            value={itemForm.processContent}
            onChange={(e) => setItemF("processContent", e.target.value)}
            rows={4}
            className={FIELD_TEXTAREA}
          />
        </Field>

        <Field label="매수" aside={<CounterOcrButton kind="count" model={itemForm.model} onResult={(r) => {
          // 읽은 칸만 채운다(빈 값은 지금 적힌 것을 지우지 않는다)
          const pairs: Array<[keyof PerItemForm, string]> = [["mailBlack", r.black], ["mailColor", r.color], ["mailLargeColor", r.largeColor], ["mailTotal", r.total]];
          for (const [k, v] of pairs) if (v) setItemF(k, v);
        }} />}>
          <div className="grid grid-cols-2 gap-1.5">
            <div className={countCell}>
              <span className={countTag}>흑</span>
              <input inputMode="numeric" value={itemForm.mailBlack} onChange={(e) => setItemF("mailBlack", e.target.value)} className={countInput} />
            </div>
            <div className={countCell}>
              <span className={countTag}>컬</span>
              <input inputMode="numeric" value={itemForm.mailColor} onChange={(e) => setItemF("mailColor", e.target.value)} className={countInput} />
            </div>
            <div className={countCell}>
              <span className={countTag}>큰컬</span>
              <input inputMode="numeric" value={itemForm.mailLargeColor} onChange={(e) => setItemF("mailLargeColor", e.target.value)} className={countInput} />
            </div>
            <div className={countCell}>
              <span className={countTag}>합</span>
              <input inputMode="numeric" value={itemForm.mailTotal} onChange={(e) => setItemF("mailTotal", e.target.value)} className={countInput} />
            </div>
          </div>
        </Field>

        {/* 잔량 — K/C/M/Y + 폐통, 직접 입력 (5칸) */}
        <Field label="잔량" aside={<CounterOcrButton kind="toner" model={itemForm.model} onResult={(r) => {
          // 폐통은 복합기 화면에 % 가 안 나온다(사용자, 2026-10-14) — K/C/M/Y 만 채우고 폐통은 손으로
          const pairs: Array<[keyof PerItemForm, string]> = [["tonerK", r.tonerK], ["tonerC", r.tonerC], ["tonerM", r.tonerM], ["tonerY", r.tonerY]];
          for (const [k, v] of pairs) if (v) setItemF(k, v);
        }} />}>
          <div className="grid grid-cols-5 gap-1">
            {(["K", "C", "M", "Y"] as const).map((ch: "K" | "C" | "M" | "Y") => {
              const key = (`toner${ch}`) as "tonerK" | "tonerC" | "tonerM" | "tonerY";
              return (
                <div key={ch}>
                  <div className="mb-0.5 flex items-center justify-center gap-0.5">
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full ring-1 ring-slate-300"
                      style={{ background: TONER_COLORS[ch] }}
                    />
                    <span className="text-[11px] font-semibold text-slate-600">{ch}</span>
                  </div>
                  <input
                    inputMode="numeric"
                    value={itemForm[key]}
                    onChange={(e) => setItemF(key, e.target.value)}
                    className={tonerInput}
                  />
                </div>
              );
            })}
            <div>
              <div className="mb-0.5 text-center text-[11px] font-semibold text-slate-600">폐통</div>
              <input
                inputMode="numeric"
                value={itemForm.waste}
                onChange={(e) => setItemF("waste", e.target.value)}
                className={tonerInput}
              />
            </div>
          </div>
        </Field>

        {/* 여분 — 원문은 보존하고 알려진 수량만 빠르게 조정 */}
        <Field label="여분">
          <SpareQuickEditor value={itemForm.spareRaw} onChange={(v)=>setItemF("spareRaw",v)} />
        </Field>
      </FieldSection>

      {/* 추가 정보 */}
      <FieldSection title="추가 정보" className="space-y-4">
        {showHantinParking && (
          <>
            {/* 한틴이카 — 칩 빠른선택 + 직접입력 */}
            <Field label="한틴이카유무">
              <div className="mb-1.5 flex flex-wrap gap-1">
                {HANTIN_OPTIONS.map((opt: string) => {
                  const active = itemForm.hantin === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setItemF("hantin", active ? "" : opt)}
                      className="rounded-full px-2.5 py-1 text-xs font-medium transition active:scale-95"
                      style={chip(active)}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
              <input
                type="text"
                placeholder="직접 입력"
                value={itemForm.hantin}
                onChange={(e) => setItemF("hantin", e.target.value)}
                className={UI.input}
              />
            </Field>

            {/* 주차비 — 칩 빠른선택 + 직접입력 */}
            <Field label="주차비지원유무">
              <div className="mb-1.5 flex flex-wrap gap-1">
                {PARKING_OPTIONS.map((opt: string) => {
                  const active = itemForm.parking === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setItemF("parking", active ? "" : opt)}
                      className="rounded-full px-3 py-1 text-xs font-medium transition active:scale-95"
                      style={chip(active)}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
              <input
                type="text"
                placeholder="직접 입력"
                value={itemForm.parking}
                onChange={(e) => setItemF("parking", e.target.value)}
                className={UI.input}
              />
            </Field>
          </>
        )}

        <Field label="특이사항">
          <textarea
            value={itemForm.notes}
            onChange={(e) => setItemF("notes", e.target.value)}
            rows={2}
            className={FIELD_TEXTAREA}
          />
        </Field>
      </FieldSection>

      {/* 부품·자가·시간 */}
      <FieldSection title="부품·자가·시간">
        <div className="divide-y divide-slate-100 border-y border-slate-100">
          {/* 부품신청 */}
          <div>
            <button type="button" onClick={() => setPartsExpanded((v) => !v)} className={toggleRow} aria-expanded={partsExpanded}>
              <span>※ 부품신청 ※</span>
              <span className="text-[11px] font-semibold text-slate-400">{partsExpanded ? "접기 ▲" : "펼치기 ▼"}</span>
            </button>
            {partsExpanded && (
            <div className="space-y-2.5 pb-3">
              <Field label="보증기간 내 여부">
                <input value={shared.warranty} onChange={(e) => setSharedF("warranty", e.target.value)} className={UI.input} />
              </Field>
              <Field label="교체 전 카운터 누적 사용매수">
                <input value={shared.cumCount} onChange={(e) => setSharedF("cumCount", e.target.value)} inputMode="numeric" className={UI.input} />
              </Field>
              <Field label="사용 부품 예상 사용매수">
                <input value={shared.expectedCount} onChange={(e) => setSharedF("expectedCount", e.target.value)} inputMode="numeric" className={UI.input} />
              </Field>
              <div className="pt-1 text-[11px] font-black text-slate-600">▶ 신청 부품</div>
              <Field label="물품명">
                <input value={shared.partName} onChange={(e) => setSharedF("partName", e.target.value)} className={UI.input} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="수량">
                  <input value={shared.partQty} onChange={(e) => setSharedF("partQty", e.target.value)} inputMode="numeric" className={UI.input} />
                </Field>
                <Field label="출고여부">
                  <NumSelect
                    value={shared.partShipped}
                    onChange={(v) => setSharedF("partShipped", v)}
                    options={SHIP_OPTIONS}
                    accent={accent}
                  />
                </Field>
              </div>
            </div>
            )}
          </div>

          {/* 자가신청 */}
          <div>
            <button type="button" onClick={() => setSelfExpanded((v) => !v)} className={toggleRow} aria-expanded={selfExpanded}>
              <span>※ 자가신청 ※</span>
              <span className="text-[11px] font-semibold text-slate-400">{selfExpanded ? "접기 ▲" : "펼치기 ▼"}</span>
            </button>
            {selfExpanded && (
            <div className="space-y-2.5 pb-3">
              <Field label="물품">
                <input value={shared.selfItem} onChange={(e) => setSharedF("selfItem", e.target.value)} className={UI.input} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="수량">
                  <input value={shared.selfQty} onChange={(e) => setSharedF("selfQty", e.target.value)} inputMode="numeric" className={UI.input} />
                </Field>
                <Field label="출고여부">
                  <NumSelect
                    value={shared.selfShipped}
                    onChange={(v) => setSharedF("selfShipped", v)}
                    options={SHIP_OPTIONS}
                    accent={accent}
                  />
                </Field>
              </div>
            </div>
            )}
          </div>
        </div>

        {/* 시간 */}
        <div className="mt-4 space-y-4">
          <Field label="도착 시간" aside={shared.arrivalHour ? (
            <span className="ml-auto text-xs font-semibold" style={{ color: accent }}>
              {shared.arrivalHour}:{shared.arrivalMinute || "00"}
            </span>
          ) : null}>
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="min-w-0 flex-[0.7_1_4.5rem]">
                <NumSelect
                  value={shared.arrivalHour}
                  onChange={(v) => setSharedF("arrivalHour", v)}
                  options={HOUR_OPTIONS}
                  placeholder="시"
                  accent={accent}
                  suffix="시"
                />
              </div>
              <div className="min-w-0 flex-[1.3_1_6rem]">
                <NumSelect
                  value={shared.arrivalMinute}
                  onChange={(v) => setSharedF("arrivalMinute", v)}
                  options={MINUTE_OPTIONS}
                  placeholder="분"
                  accent={accent}
                  suffix="분"
                />
              </div>
              {/* [지금] — 누른 시각(KST)을 5분 단위로 내려 시·분에 넣는다. 값이 있어도 덮어쓴다 */}
              <button
                type="button"
                onClick={fillArrivalNow}
                className="min-h-11 shrink-0 rounded-lg border bg-white px-3 text-sm font-bold transition active:scale-95"
                style={{ color: accent, borderColor: accent }}
              >
                지금
              </button>
            </div>
          </Field>

          <Field label="소요 시간" aside={
            <span className="ml-auto flex items-center gap-2">
              <span className="text-sm font-bold" style={{ color: accent }}>
                {shared.duration ? `${shared.duration}분` : "0분"}
              </span>
              {shared.duration && (
                <button
                  type="button"
                  onClick={() => setSharedF("duration", "")}
                  className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] text-slate-600 transition hover:bg-slate-200 active:scale-95"
                >
                  초기화
                </button>
              )}
            </span>
          }>
            {durationSuggest !== null && (
              <div className="mb-1.5 flex flex-wrap">
                <button
                  type="button"
                  onClick={() => setSharedF("duration", String(durationSuggest))}
                  className="min-h-11 max-w-full rounded-lg border bg-white px-3 text-left text-sm font-semibold text-slate-700 transition active:scale-95"
                  style={{ borderColor: accent }}
                >
                  도착 {shared.arrivalHour}:{shared.arrivalMinute || "00"} → <span className="font-bold" style={{ color: accent }}>지금까지 {durationSuggest}분</span> 넣기
                </button>
              </div>
            )}
            <div className="grid grid-cols-5 gap-1.5">
              {DURATION_STEPS.map((step: number) => (
                <button
                  key={step}
                  type="button"
                  onClick={() => {
                    const current = parseInt(shared.duration || "0", 10) || 0;
                    setSharedF("duration", String(current + step));
                  }}
                  className="rounded-lg bg-slate-100 py-2.5 text-sm font-semibold text-slate-700 transition active:scale-95"
                >
                  +{step}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </FieldSection>
    </FieldFormCard>
  );
}
