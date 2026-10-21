// 필드 › 미수 = CS 방문이력 작성기의 표시 틀(저장·API·검증 계산 없음). 값·핸들러·검증 결과는 모두 props 로 받는다.
// 설계: docs/tasks/misu-redesign.md §4-A · 기준: docs/tasks/misu-visit-standard.md (법무팀 5가지 + 현장 4원칙)
// 폰(390px) 우선 세로 7단계: ① 업체·차수 → ② 방문 일시·응대자 → ③ 운영 여부 → ④ 독촉 → ⑤ 기기 반환 요구 → ⑥ 사진 4칸 → ⑦ 현장 판단
// 그 아래 자동 문장 미리보기 + 필수 점검 + 카톡방 안내 + 보내기 띠. 빨강은 '막음'에만, 노랑은 '경고'에만 쓴다.
//
// 연결(2단계): value 는 src/misuVisit.ts 의 MisuVisitDraft 와 열 이름·값 모양이 같다(이 파일은 import 하지 않음 — 구조만 맞춤).
//   <MisuVisitFormView value={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
//     validation={validateMisuVisit(draft)} previewLines={misuVisitLines(draft)} … />
// 칩 문구 기본값은 misuVisit.ts 의 상수와 같은 문자열이다. 바뀌면 options 로 넘긴다.
import { useState, type ReactNode } from "react";
import {
  AlertCircle, AlertTriangle, Building2, Camera, Check, ChevronDown, Clock, ImagePlus, Info, Loader2,
  RotateCcw, Search, Send, ShieldCheck, X,
} from "lucide-react";

// ───────── 타입 (misuVisit.ts 와 같은 모양을 이 파일 안에 둔다) ─────────
export type MisuVisitRoundView = "1차 안내" | "2차 경고" | "추가";
export type MisuPhotoSlotKey = "outside" | "door" | "device" | "notice";
export type MisuStepNo = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** 폼 입력값 = MisuVisitDraft 의 화면 입력 칸 부분집합. onChange(patch) 로 부분 갱신 */
export type MisuVisitFormValue = {
  visit_round: MisuVisitRoundView;
  visited_at: string; // ISO(timestamptz). 화면에선 KST 벽시계로 바꿔 보여준다
  no_contact: boolean;
  contact_name: string;
  contact_title: string; // "기타" 면 이름만 문장에 쓰임(로직 규칙)
  contact_is_rep: boolean | null;
  rep_phone_status: string; // 확보 / 거부 / 모름 / ""
  rep_phone: string;
  open_status: "영업중" | "문 잠김" | "폐업 확인" | "";
  evid_mail: string;
  evid_sign: string;
  evid_neighbor: string; // 인용 또는 "진술 없음"
  closed_estimate: string;
  dun_methods: string[];
  dun_reply: string; // 칩 값 또는 들은 말 그대로
  promise_date: string; // YYYY-MM-DD
  return_requested: boolean;
  return_to: string;
  return_reply: string; // 칩 값 또는 들은 말 그대로
  return_method: string;
  photo_skips: Partial<Record<MisuPhotoSlotKey, string>>;
  judgment: "계속 독촉" | "철수" | "소송이관" | "";
  judgment_reason: string;
  rules_ack: { sealed?: boolean; thirdPartyNoDebt?: boolean; principles?: boolean; offHoursReason?: string };
};

/** 사진 칸 하나의 상태. null = 아직 없음 */
export type MisuPhotoSlotState = {
  previewUrl?: string; // 로컬 미리보기(blob:) — 없으면 url
  url?: string; // 올라간 주소
  status: "ready" | "uploading" | "done" | "error"; // ready = 골랐고 아직 안 올림(보낼 때 올림)
  error?: string;
  lowRes?: boolean; // 짧은 변 600px 미만
};

/** 업체 고르기 후보(관리부 미수 목록 또는 거래처 검색 결과) */
export type MisuVendorOption = {
  key: string;
  name: string;
  source: "misu" | "master";
  team?: string; // A~E
  months?: string; // "5개월"
  balance?: string; // "2,140,050원"
  companyCode?: string;
  leaseSeq?: string;
  csChecked?: boolean;
  visitCount?: number;
  lastRound?: string;
  lastVisitDate?: string; // "10-22"
};

/** 검증 결과 — misuVisit.ts validateMisuVisit() 반환값을 그대로 넘길 수 있는 모양 */
export type MisuFormIssue = { key: string; message: string };
export type MisuFormCheckRow = { key: string; label: string; state: "ok" | "warn" | "block" | "skip" };
export type MisuFormValidation = { blocks: MisuFormIssue[]; warns: MisuFormIssue[]; checks: MisuFormCheckRow[]; offHours?: boolean };

/** 검증 이슈 key → 단계 번호(단계 머리 배지·단계 안 안내문 위치) */
const ISSUE_STEP: Record<string, MisuStepNo> = {
  vendor: 1, author: 1,
  visitedAt: 2, offHours: 2, contact: 2,
  open: 3, locked: 3,
  dun: 4, sealed: 4, thirdParty: 4,
  return: 5,
  photos: 6,
  judgment: 7, forbidden: 7,
};
/** 미리보기 ①~⑥ 줄 → 관련 이슈 key */
const LINE_ISSUES: string[][] = [["contact"], ["open", "locked"], ["dun", "sealed", "thirdParty"], ["return"], ["photos"], ["judgment"]];

export type MisuVisitFormOptions = {
  contactTitles: string[];
  repPhoneStatuses: string[];
  mail: string[];
  sign: string[];
  neighborNone: string;
  neighborQuick: string[];
  closedEstimates: string[];
  dunMethods: string[];
  dunReplies: string[];
  promiseReply: string; // 이 답변이면 날짜 칸이 보임
  returnReplies: string[];
  returnMethods: string[];
  photoSkipReasons: string[];
  judgmentReasonQuick: string[];
  offHoursQuick: string[];
};

const DEFAULT_OPTIONS: MisuVisitFormOptions = {
  contactTitles: ["대표", "원장", "점장", "실장", "경리", "직원", "기타"],
  repPhoneStatuses: ["확보", "거부", "모름"],
  mail: ["없음", "1주", "2주", "3주+", "수북"],
  sign: ["유지", "철거"],
  neighborNone: "진술 없음",
  neighborQuick: ["1개월째 안 열었다", "2개월째 안 열었다", "3개월째 안 열었다"],
  closedEstimates: ["폐업 추정", "일시 휴무 추정", "판단 보류"],
  dunMethods: ["구두 안내", "안내문 봉함 전달", "안내문 봉함 투입"],
  dunReplies: ["대표에게 전달하겠다", "납부 약속", "분할 요청", "거부", "무응답"],
  promiseReply: "납부 약속",
  returnReplies: ["대표 확인 후 회신", "반환 거부", "반환 약속", "무응답"],
  returnMethods: ["반송 주소 안내", "회수 방문 일정 협의", "안내 못함"],
  photoSkipReasons: ["문 잠김", "거부", "기타"],
  judgmentReasonQuick: ["1차 안내 후 무응답", "2차 경고 후 무응답", "폐업 추정", "납부 약속 받음", "분할 납부 협의 중"],
  offHoursQuick: ["고객이 지정한 시간", "야간 영업 업장"],
};

const PHOTO_SLOTS: Array<{ key: MisuPhotoSlotKey; no: string; label: string; hint: string }> = [
  { key: "outside", no: "①", label: "외부", hint: "간판 + 호수가 보이게" },
  { key: "door", no: "②", label: "출입문", hint: "열림·잠김 상태" },
  { key: "device", no: "③", label: "기기 + S/N", hint: "기기 전체와 S/N 라벨" },
  { key: "notice", no: "④", label: "안내문", hint: "부착·투입 모습" },
];

const STEP_TITLES: Record<MisuStepNo, string> = {
  1: "업체·차수", 2: "방문 일시·응대자", 3: "운영 여부", 4: "독촉 내용", 5: "기기 반환 요구", 6: "사진 4칸", 7: "현장 판단",
};

const RULES: Array<{ title: string; body: string }> = [
  { title: "08시 ~ 21시 사이에만", body: "그 밖의 시간 방문·전화·문자는 채권추심법 위반입니다." },
  { title: "채무 사실과 금액은 대표자·담당자에게만", body: "직원·옆 가게·건물 관리인에게는 영업 여부만 물어봅니다." },
  { title: "안내문은 반드시 봉함", body: "봉투 겉면에 금액이나 '미납'이 보이면 제3자 고지 문제가 됩니다." },
  { title: "잠긴 곳은 절대 열지 않기", body: "문을 따거나 기기를 들고 나오는 것은 계약서에 권한이 있어도 안 됩니다." },
];

export type MisuVisitFormViewProps = {
  value: MisuVisitFormValue;
  onChange: (patch: Partial<MisuVisitFormValue>) => void;
  options?: Partial<MisuVisitFormOptions>;

  // 머리
  authorSlot?: ReactNode; // 작성자 표시/선택(SSO 잠금이면 이름만) — 컨테이너가 꽂는다
  draftNotice?: string; // 예: "10-22 14:20 에 쓰던 내용을 이어 씁니다"
  onDiscardDraft?: () => void;

  // ① 업체
  vendorListLabel?: string; // 예: "C팀 미수 목록"
  vendorList: MisuVendorOption[]; // 검색어로 좁힌 결과(좁히기는 컨테이너)
  vendorListState: "loading" | "error" | "ready";
  vendorListError?: string;
  vendorQuery: string;
  onVendorQuery: (v: string) => void;
  selectedVendor: MisuVendorOption | null;
  onPickVendor: (v: MisuVendorOption) => void;
  onClearVendor: () => void;
  otherQuery: string; // 다른 업체 찾기(거래처 검색)
  onOtherQuery: (v: string) => void;
  onOtherSearch: () => void;
  otherSearching?: boolean;
  otherError?: string;
  otherResults: MisuVendorOption[] | null; // null = 아직 검색 안 함
  suggestedRound?: MisuVisitRoundView; // suggestNextRound().round
  roundHint?: string; // 예: "지난 방문 1건 · 마지막 1차 안내(10-02)"

  // ⑥ 사진
  photos: Record<MisuPhotoSlotKey, MisuPhotoSlotState | null>;
  onPhotoFile: (slot: MisuPhotoSlotKey, file: File) => void; // 사진을 넣으면 그 칸의 촬영 불가 사유는 컨테이너가 지운다
  onPhotoRemove: (slot: MisuPhotoSlotKey) => void;
  onPhotoRetry?: (slot: MisuPhotoSlotKey) => void;

  // 검증·미리보기
  validation: MisuFormValidation;
  previewLines: string[]; // misuVisitLines() — "① 응대자: …" 형식(첫 ": " 앞이 라벨)
  kakaoText?: string; // 카톡으로 나갈 전체 원문(접어서 보여줌)

  // 보내기
  roomNotice?: { tone: "ok" | "warn"; text: string } | null; // 예: warn "저장만 됩니다(카톡방 미정)"
  tableNotReady?: boolean; // 표 실행 전 — 저장·전송 막음
  onSubmit?: () => void; // 없으면 보내기 단추를 그리지 않음(App 공용 보내기 단추를 쓸 때)
  submitting?: boolean;
  result?: { tone?: "ok" | "warn" | "error"; text: string } | null;
};

// ───────── KST 벽시계 ↔ ISO ─────────
const KST_PARTS = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function isoToKstInput(iso: string): string {
  const d = new Date(iso || "");
  if (Number.isNaN(d.getTime())) return "";
  const get = (t: string) => KST_PARTS.formatToParts(d).find((x) => x.type === t)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
function kstInputToIso(local: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return "";
  const d = new Date(`${local}:00+09:00`);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

// ───────── 공통 토큰 (DeptReceptionForm.view 와 같은 톤, 터치는 44px) ─────────
const input = "h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-[14px] font-semibold text-slate-900 outline-none transition placeholder:font-medium placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10";
const label = "text-[11px] font-semibold text-slate-500";
const section = "text-[11px] font-bold uppercase tracking-wider text-slate-400";
const req = <span className="text-red-500">*</span>;

type ChipTone = "blue" | "slate" | "amber" | "rose" | "emerald";
const CHIP_ON: Record<ChipTone, string> = {
  blue: "border-blue-600 bg-blue-600 text-white",
  slate: "border-slate-800 bg-slate-800 text-white",
  amber: "border-amber-500 bg-amber-500 text-white",
  rose: "border-rose-600 bg-rose-600 text-white",
  emerald: "border-emerald-600 bg-emerald-600 text-white",
};

function Chip({ on, onClick, children, tone = "blue" }: { on: boolean; onClick: () => void; children: ReactNode; tone?: ChipTone }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={`inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border px-3 text-[13px] font-bold transition ${on ? CHIP_ON[tone] : "border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700"}`}>
      {on && <Check size={14} aria-hidden />}{children}
    </button>
  );
}

/** 칩 한 줄 — 단일 선택(같은 칩 다시 누르면 해제) */
function ChipRow({ options, value, onPick, tone }: { options: string[]; value: string; onPick: (v: string) => void; tone?: ChipTone }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {options.map((o) => <Chip key={o} on={value === o} tone={tone} onClick={() => onPick(value === o ? "" : o)}>{o}</Chip>)}
    </div>
  );
}

/** 칩 또는 직접 적기(들은 말 그대로) — 값 하나에 칩 문구나 인용이 들어간다 */
function ChipOrQuote({ options, value, onChange, placeholder, ariaLabel }: { options: string[]; value: string; onChange: (v: string) => void; placeholder: string; ariaLabel: string }) {
  const isChip = options.includes(value);
  return (
    <>
      <ChipRow options={options} value={value} onPick={onChange} />
      <input value={isChip ? "" : value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={ariaLabel} className={`${input} mt-1.5`} />
    </>
  );
}

function CheckLine({ checked, onChange, children, need }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; need?: boolean }) {
  return (
    <label className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-[13px] font-semibold ${checked ? "border-emerald-200 bg-emerald-50 text-emerald-800" : need ? "border-rose-200 bg-rose-50 text-rose-700" : "border-slate-200 bg-white text-slate-700"}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 shrink-0 accent-emerald-600" />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

type StepState = "block" | "warn" | "ok" | "none";
function stepState(val: MisuFormValidation, step: MisuStepNo): StepState {
  if (val.blocks.some((i) => ISSUE_STEP[i.key] === step)) return "block";
  if (val.warns.some((i) => ISSUE_STEP[i.key] === step)) return "warn";
  return "none";
}

function Step({ no, title, tag, state, done, summary, open, onToggle, children }: {
  no: MisuStepNo; title: string; tag?: ReactNode; state: StepState; done?: boolean; summary?: string; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  const ok = state === "none" && !!done;
  const dot = ok ? "bg-emerald-500 text-white" : state === "block" ? "bg-rose-500 text-white" : state === "warn" ? "bg-amber-400 text-white" : "bg-slate-200 text-slate-600";
  return (
    <section className="border-t border-slate-100" aria-label={`${no}단계 ${title}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left lg:px-5">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-black ${dot}`}>{ok ? <Check size={14} aria-hidden /> : no}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <b className="text-[14px] font-black text-slate-900">{title}</b>
            {tag}
            {state === "block" && <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-black text-rose-600">필수 누락</span>}
            {state === "warn" && <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-black text-amber-700">확인 필요</span>}
          </span>
          {!open && summary && <span className="mt-0.5 block truncate text-[12px] font-medium text-slate-500">{summary}</span>}
        </span>
        <ChevronDown size={18} aria-hidden className={`shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="space-y-3 px-4 pb-4 lg:px-5">{children}</div>}
    </section>
  );
}

function StepMessages({ val, step }: { val: MisuFormValidation; step: MisuStepNo }) {
  const rows = [
    ...val.blocks.filter((i) => ISSUE_STEP[i.key] === step).map((i) => ({ ...i, block: true })),
    ...val.warns.filter((i) => ISSUE_STEP[i.key] === step).map((i) => ({ ...i, block: false })),
  ];
  if (!rows.length) return null;
  return (
    <ul className="space-y-1">
      {rows.map((c, n) => (
        <li key={`${c.key}-${n}`} role={c.block ? "alert" : "status"} className={`flex items-start gap-1.5 text-[12px] font-bold ${c.block ? "text-rose-600" : "text-amber-700"}`}>
          {c.block ? <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />}{c.message}
        </li>
      ))}
    </ul>
  );
}

function VendorRow({ v, onPick }: { v: MisuVendorOption; onPick: () => void }) {
  return (
    <button type="button" onClick={onPick} className="flex min-h-14 w-full items-center gap-3 px-3.5 py-2.5 text-left transition hover:bg-blue-50/50">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <b className="truncate text-[14px] font-black text-slate-900">{v.name}</b>
          {v.csChecked && <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-700">CS체크</span>}
          {v.source === "master" && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">미수 목록 밖</span>}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] font-bold text-slate-500">
          {v.team && <span>{v.team}팀</span>}
          {v.months && <span className="text-rose-600">{v.months}</span>}
          {v.balance && <span className="tabular-nums text-slate-700">{v.balance}</span>}
          <span className="text-slate-400">{v.visitCount ? `방문 ${v.visitCount}건${v.lastRound ? ` · 마지막 ${v.lastRound}` : ""}${v.lastVisitDate ? `(${v.lastVisitDate})` : ""}` : "방문 기록 없음"}</span>
        </span>
      </span>
    </button>
  );
}

function PhotoSlotCard({ meta, state, skip, reasons, onFile, onRemove, onRetry, onSkip }: {
  meta: (typeof PHOTO_SLOTS)[number];
  state: MisuPhotoSlotState | null;
  skip: string;
  reasons: string[];
  onFile: (f: File) => void;
  onRemove: () => void;
  onRetry?: () => void;
  onSkip: (reason: string) => void;
}) {
  const [skipOpen, setSkipOpen] = useState(false);
  const src = state?.previewUrl || state?.url || "";
  const has = !!src;
  const custom = !!skip && !reasons.includes(skip); // 기타 직접 입력값
  const otherOn = skip === "기타" || custom;
  const done = has ? state?.status !== "error" : !!skip.trim();
  const fileInput = (capture: boolean) => (
    <input type="file" accept="image/*" {...(capture ? { capture: "environment" as const } : {})} className="hidden"
      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
  );
  return (
    <div className={`flex min-w-0 flex-col rounded-lg border p-2 ${done ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 bg-white"}`}>
      <div className="flex items-baseline justify-between gap-1">
        <b className="truncate text-[13px] font-black text-slate-800">{meta.no} {meta.label}</b>
        {done && <Check size={14} className="shrink-0 text-emerald-600" aria-label="채움" />}
      </div>
      <div className="truncate text-[11px] font-medium text-slate-400">{meta.hint}</div>

      {has ? (
        <div className="relative mt-1.5 aspect-4/3 overflow-hidden rounded-md bg-slate-100">
          <img src={src} alt={`${meta.label} 사진`} className="h-full w-full object-cover" />
          {state?.status === "uploading" && <div className="absolute inset-0 flex items-center justify-center bg-white/60"><Loader2 size={20} className="animate-spin text-slate-500" aria-label="올리는 중" /></div>}
          <button type="button" onClick={onRemove} className="absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white" aria-label={`${meta.label} 사진 빼기`}><X size={16} aria-hidden /></button>
        </div>
      ) : !(skipOpen || skip) ? (
        <div className="mt-1.5 grid grid-cols-2 gap-1">
          <label className="flex min-h-11 cursor-pointer items-center justify-center gap-1 rounded-md bg-blue-600 text-[12px] font-bold text-white transition hover:bg-blue-700"><Camera size={15} aria-hidden />찍기{fileInput(true)}</label>
          <label className="flex min-h-11 cursor-pointer items-center justify-center gap-1 rounded-md border border-slate-200 bg-white text-[12px] font-bold text-slate-600 transition hover:border-blue-300 hover:text-blue-700"><ImagePlus size={15} aria-hidden />앨범{fileInput(false)}</label>
          <button type="button" onClick={() => setSkipOpen(true)} className="col-span-2 min-h-11 rounded-md border border-dashed border-slate-300 text-[12px] font-bold text-slate-500 hover:border-slate-400 hover:text-slate-700">촬영 불가</button>
        </div>
      ) : (
        <div className="mt-1.5 space-y-1">
          <div className="text-[11px] font-bold text-slate-500">촬영 불가 사유</div>
          <div className="flex flex-wrap gap-1">
            {reasons.map((r) => {
              const on = r === "기타" ? otherOn : skip === r;
              return <button key={r} type="button" aria-pressed={on} onClick={() => onSkip(on ? "" : r)}
                className={`min-h-11 rounded-md border px-2.5 text-[12px] font-bold ${on ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-600"}`}>{r}</button>;
            })}
          </div>
          {otherOn && <input value={skip === "기타" ? "" : skip} onChange={(e) => onSkip(e.target.value.trim() ? e.target.value : "기타")} placeholder="사유를 적어 주세요" aria-label={`${meta.label} 촬영 불가 사유`} className={`${input} text-[13px]`} />}
          <button type="button" onClick={() => { onSkip(""); setSkipOpen(false); }} className="min-h-11 w-full rounded-md text-[12px] font-bold text-blue-700 hover:bg-blue-50">사진으로 채우기</button>
        </div>
      )}

      {state?.status === "error" && (
        <div role="alert" className="mt-1 flex items-center gap-1 text-[11px] font-bold text-rose-600">
          <AlertCircle size={12} className="shrink-0" aria-hidden /><span className="min-w-0 flex-1 truncate">{state.error || "올리지 못했습니다"}</span>
          {onRetry && <button type="button" onClick={onRetry} className="inline-flex min-h-9 items-center gap-0.5 rounded px-1.5 text-blue-700 hover:bg-blue-50"><RotateCcw size={12} aria-hidden />다시</button>}
        </div>
      )}
      {state?.lowRes && <div className="mt-1 text-[11px] font-bold text-amber-700">화질이 낮습니다(600px 미만). 가능하면 다시 찍어 주세요.</div>}
    </div>
  );
}

/** 현장 4원칙 안내(접기). 작성기 맨 위에 둔다 */
export function MisuRulesGuide({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group rounded-lg border border-slate-200 bg-slate-50">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-[13px] font-bold text-slate-700 [&::-webkit-details-marker]:hidden">
        <ShieldCheck size={16} className="shrink-0 text-emerald-600" aria-hidden />현장에서 지킬 4가지
        <ChevronDown size={16} aria-hidden className="ml-auto text-slate-400 transition group-open:rotate-180" />
      </summary>
      <ol className="space-y-1.5 px-3 pb-3">
        {RULES.map((r, i) => (
          <li key={r.title} className="text-[12px] leading-5 text-slate-600"><b className="text-slate-800">{i + 1}. {r.title}</b> — {r.body}</li>
        ))}
        <li className="pt-1 text-[12px] font-semibold leading-5 text-rose-600">"신용불량 등록된다", "구속된다" 같은 말은 사실과 다르고 회사에 위험합니다. 안내는 법무팀 표준문안 범위 안에서만 해 주세요.</li>
      </ol>
    </details>
  );
}

// ───────── 본체 ─────────
export default function MisuVisitFormView(p: MisuVisitFormViewProps) {
  const o: MisuVisitFormOptions = { ...DEFAULT_OPTIONS, ...(p.options || {}) };
  const v = p.value;
  const set = p.onChange;
  const val = p.validation;
  const ack = v.rules_ack || {};
  const setAck = (patch: Partial<MisuVisitFormValue["rules_ack"]>) => set({ rules_ack: { ...ack, ...patch } });
  const is2nd = v.visit_round === "2차 경고";
  const offHours = !!val.offHours;

  // 단계 펼침(표시 상태만). ⑤ 기기 반환은 2차면 항상 펼침, 아니면 기본 접힘
  const [closed, setClosed] = useState<Set<MisuStepNo>>(() => new Set<MisuStepNo>([5]));
  const isOpen = (n: MisuStepNo) => (n === 5 && is2nd) || !closed.has(n);
  const toggle = (n: MisuStepNo) => setClosed((prev) => { const next = new Set(prev); if (next.has(n)) next.delete(n); else next.add(n); return next; });

  const canSend = !val.blocks.length && !p.tableNotReady && !p.submitting && !!p.selectedVendor;
  const contactLabel = [v.contact_name.trim(), v.contact_title === "기타" ? "" : v.contact_title].filter(Boolean).join(" ");
  const showThirdParty = !v.no_contact && v.contact_is_rep === false;
  const showSealed = v.dun_methods.some((m) => m.startsWith("안내문"));
  const slotFilled = (k: MisuPhotoSlotKey) => !!(p.photos[k]?.previewUrl || p.photos[k]?.url) || !!(v.photo_skips[k] || "").trim();
  const photoFilled = PHOTO_SLOTS.filter((s) => slotFilled(s.key)).length;
  const lineTone = (i: number): "block" | "warn" | "ok" => {
    const keys = LINE_ISSUES[i] || [];
    if (val.blocks.some((x) => keys.includes(x.key))) return "block";
    if (val.warns.some((x) => keys.includes(x.key))) return "warn";
    return "ok";
  };
  const visitedLocal = isoToKstInput(v.visited_at);

  return (
    <div className="space-y-3">
      {p.tableNotReady && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] font-bold text-rose-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />방문이력 표가 아직 준비 중입니다. 지금은 저장·전송이 되지 않습니다.
        </div>
      )}
      {p.draftNotice && (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-1 text-[12px] font-bold text-blue-800">
          <Info size={14} className="shrink-0" aria-hidden /><span className="min-w-0 flex-1">{p.draftNotice}</span>
          {p.onDiscardDraft && <button type="button" onClick={p.onDiscardDraft} className="min-h-11 shrink-0 rounded-md px-2 text-blue-700 hover:bg-blue-100">새로 쓰기</button>}
        </div>
      )}

      <MisuRulesGuide />

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-3.5 lg:px-5">
          <div className="min-w-0">
            <div className={section}>CS 방문이력 작성기</div>
            <div className="mt-0.5 text-[12px] font-medium text-slate-500">버튼을 누르면 법무팀 기준 문장이 자동으로 채워집니다.</div>
          </div>
          {p.authorSlot && <div className="shrink-0">{p.authorSlot}</div>}
        </div>

        {/* ① 업체·차수 */}
        <Step no={1} title={STEP_TITLES[1]} state={stepState(val, 1)} done={!!p.selectedVendor} open={isOpen(1)} onToggle={() => toggle(1)}
          summary={p.selectedVendor ? `${p.selectedVendor.name} · ${v.visit_round}` : "업체를 골라 주세요"}>
          {p.selectedVendor ? (
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              <div className="flex items-center gap-2">
                <Building2 size={15} className="shrink-0 text-slate-400" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-[15px] font-black text-slate-950">{p.selectedVendor.name}</span>
                <button type="button" onClick={p.onClearVendor} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-200 hover:text-slate-700" aria-label="업체 다시 고르기"><X size={18} aria-hidden /></button>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                {([["팀", p.selectedVendor.team ? `${p.selectedVendor.team}팀` : ""], ["미수", p.selectedVendor.months || ""], ["잔액", p.selectedVendor.balance || ""], ["거래처코드", p.selectedVendor.companyCode || ""], ["임순", p.selectedVendor.leaseSeq || ""]] as Array<[string, string]>)
                  .filter(([, x]) => x).map(([k, x]) => (
                    <span key={k} className="inline-flex items-baseline gap-1"><span className="text-[11px] font-medium text-slate-400">{k}</span><span className={`text-[12px] font-bold text-slate-800 ${k === "거래처코드" || k === "임순" ? "font-mono" : "tabular-nums"}`}>{x}</span></span>
                  ))}
              </div>
              {p.roundHint && <div className="mt-1 text-[12px] font-bold text-blue-700">{p.roundHint}</div>}
            </div>
          ) : (
            <>
              <div>
                <div className={label}>{p.vendorListLabel || "우리 팀 미수 목록"}</div>
                <div className="relative mt-1">
                  <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
                  <input value={p.vendorQuery} onChange={(e) => p.onVendorQuery(e.target.value)} placeholder="업체명으로 좁히기" aria-label="미수 목록에서 업체 찾기" className={`${input} pl-9`} />
                </div>
                {p.vendorListState === "loading" && <div role="status" className="mt-2 flex items-center gap-1.5 text-[12px] font-bold text-slate-500"><Loader2 size={14} className="animate-spin" aria-hidden />미수 목록을 불러오는 중입니다.</div>}
                {p.vendorListState === "error" && <div role="alert" className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[12px] font-bold text-amber-800"><AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden /><span>미수 목록을 불러오지 못했습니다. 아래 [다른 업체 찾기]로 진행해 주세요.{p.vendorListError ? ` (${p.vendorListError})` : ""}</span></div>}
                {p.vendorListState === "ready" && !p.vendorList.length && <div className="mt-2 rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-[12px] font-bold text-slate-400">{p.vendorQuery.trim() ? "목록에 맞는 업체가 없습니다. 아래에서 찾아 주세요." : "우리 팀 미수 목록이 비어 있습니다."}</div>}
                {p.vendorListState === "ready" && p.vendorList.length > 0 && (
                  <div className="mt-2 max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                    {p.vendorList.map((x) => <VendorRow key={x.key} v={x} onPick={() => p.onPickVendor(x)} />)}
                  </div>
                )}
              </div>
              <div>
                <div className={label}>다른 업체 찾기 (미수 목록에 없을 때)</div>
                <div className="relative mt-1">
                  <input value={p.otherQuery} onChange={(e) => p.onOtherQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") p.onOtherSearch(); }} placeholder="거래처명 / 거래처코드" aria-label="거래처 검색" className={`${input} pr-24`} />
                  <button type="button" onClick={p.onOtherSearch} disabled={p.otherSearching} className="absolute right-1 top-1 inline-flex h-9 items-center gap-1 rounded-md bg-slate-800 px-3 text-[12px] font-bold text-white hover:bg-slate-900 disabled:opacity-40"><Search size={14} aria-hidden />{p.otherSearching ? "찾는 중" : "찾기"}</button>
                </div>
                {p.otherError && <div role="alert" className="mt-1.5 flex items-start gap-1.5 text-[12px] font-bold text-rose-600"><AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden />찾지 못했습니다. 잠시 뒤 다시 시도해 주세요. ({p.otherError})</div>}
                {p.otherSearching && <div role="status" className="mt-1.5 flex items-center gap-1.5 text-[12px] font-bold text-slate-500"><Loader2 size={14} className="animate-spin" aria-hidden />거래처를 찾는 중입니다.</div>}
                {p.otherResults && !p.otherSearching && (p.otherResults.length ? (
                  <div className="mt-2 max-h-60 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                    {p.otherResults.map((x) => <VendorRow key={x.key} v={x} onPick={() => p.onPickVendor(x)} />)}
                  </div>
                ) : <div className="mt-1.5 text-[12px] font-bold text-slate-400">검색 결과가 없습니다.</div>)}
              </div>
            </>
          )}
          <div>
            <div className={label}>방문 차수 {req}</div>
            <div className="mt-1 grid grid-cols-3 gap-1.5">
              {(["1차 안내", "2차 경고", "추가"] as const).map((r) => (
                <Chip key={r} on={v.visit_round === r} tone={r === "2차 경고" ? "rose" : "blue"} onClick={() => set({ visit_round: r })}>
                  {r}{p.suggestedRound === r && v.visit_round !== r && <span className="rounded bg-blue-50 px-1 text-[10px] text-blue-700">추천</span>}
                </Chip>
              ))}
            </div>
            {p.suggestedRound && v.visit_round !== p.suggestedRound && <div className="mt-1.5 text-[12px] font-bold text-amber-700">지난 기록으로는 '{p.suggestedRound}' 차례입니다. 맞는지 확인해 주세요.</div>}
            {is2nd && <div className="mt-1.5 text-[12px] font-bold text-slate-600">2차 경고는 기기 반환 요구와 사진 4칸이 필수입니다.</div>}
          </div>
          <StepMessages val={val} step={1} />
        </Step>

        {/* ② 방문 일시·응대자 */}
        <Step no={2} title={STEP_TITLES[2]} state={stepState(val, 2)} done={!!visitedLocal && (v.no_contact || !!v.contact_name.trim())} open={isOpen(2)} onToggle={() => toggle(2)}
          summary={v.no_contact ? "응대자 없음" : contactLabel || "응대자를 적어 주세요"}>
          <div>
            <div className={label}>방문 일시 {req}</div>
            <div className="mt-1 flex gap-1.5">
              <input type="datetime-local" value={visitedLocal} onChange={(e) => { const iso = kstInputToIso(e.target.value); if (iso) set({ visited_at: iso }); }} aria-label="방문 일시" className={`${input} min-w-0 flex-1`} />
              <button type="button" onClick={() => set({ visited_at: new Date().toISOString() })} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-bold text-slate-600 hover:border-blue-300 hover:text-blue-700"><Clock size={14} aria-hidden />지금</button>
            </div>
            {offHours && (
              <div className="mt-2 space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                <div className="flex items-start gap-1.5 text-[12px] font-bold text-amber-800"><AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />08시~21시 밖의 방문입니다. 채권추심법상 문제가 될 수 있어 사유를 꼭 남겨 주세요.</div>
                <div className="flex flex-wrap gap-1.5">
                  {o.offHoursQuick.map((q) => <Chip key={q} tone="amber" on={ack.offHoursReason === q} onClick={() => setAck({ offHoursReason: ack.offHoursReason === q ? "" : q })}>{q}</Chip>)}
                </div>
                <input value={ack.offHoursReason || ""} onChange={(e) => setAck({ offHoursReason: e.target.value })} placeholder="시간 외 방문 사유" aria-label="시간 외 방문 사유" className={input} />
              </div>
            )}
          </div>

          <div>
            <div className={label}>응대자 {req}</div>
            <div className="mt-1">
              <Chip on={v.no_contact} tone="slate" onClick={() => set(v.no_contact ? { no_contact: false } : { no_contact: true, ...(v.open_status ? {} : { open_status: "문 잠김" as const }) })}>아무도 없음 (문 잠김 등)</Chip>
            </div>
          </div>
          {v.no_contact ? (
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] font-semibold text-slate-600">응대자 없음으로 기록됩니다. 대신 ③ 운영 여부에서 문이 잠겼다는 근거를 하나 이상 남겨 주세요.</div>
          ) : (
            <>
              <label className="block"><span className={label}>이름 {req}</span>
                <input value={v.contact_name} onChange={(e) => set({ contact_name: e.target.value })} placeholder="예: 김○○" autoComplete="off" className={`${input} mt-1`} />
              </label>
              <div>
                <div className={label}>직위 {req}</div>
                <ChipRow options={o.contactTitles} value={v.contact_title} onPick={(t) => set({ contact_title: t, ...(t === "대표" ? { contact_is_rep: true } : {}) })} />
                {v.contact_title === "직원" && !v.contact_name.trim() && <div role="alert" className="mt-1.5 flex items-start gap-1.5 text-[12px] font-bold text-rose-600"><AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden />'직원'만 적으면 반려됩니다. 이름까지 적어 주세요.</div>}
              </div>
              <div>
                <div className={label}>대표자 본인인가요? {req}</div>
                <div className="mt-1 grid grid-cols-2 gap-1.5">
                  <Chip on={v.contact_is_rep === true} onClick={() => set({ contact_is_rep: v.contact_is_rep === true ? null : true })}>대표 본인</Chip>
                  <Chip on={v.contact_is_rep === false} onClick={() => set({ contact_is_rep: v.contact_is_rep === false ? null : false })}>대표 아님</Chip>
                </div>
              </div>
              {v.contact_is_rep === false && (
                <div>
                  <div className={label}>대표자 연락처 {req}</div>
                  <div className="mt-1 grid grid-cols-3 gap-1.5">
                    {o.repPhoneStatuses.map((s) => <Chip key={s} on={v.rep_phone_status === s} onClick={() => set({ rep_phone_status: v.rep_phone_status === s ? "" : s })}>{s}</Chip>)}
                  </div>
                  {v.rep_phone_status === "확보" && <input type="tel" inputMode="tel" value={v.rep_phone} onChange={(e) => set({ rep_phone: e.target.value })} placeholder="010-0000-0000" aria-label="대표자 연락처" className={`${input} mt-1.5`} />}
                </div>
              )}
            </>
          )}
          <StepMessages val={val} step={2} />
        </Step>

        {/* ③ 운영 여부 */}
        <Step no={3} title={STEP_TITLES[3]} state={stepState(val, 3)} done={!!v.open_status} open={isOpen(3)} onToggle={() => toggle(3)}
          summary={v.open_status ? [v.open_status, v.closed_estimate].filter(Boolean).join(" → ") : "영업 여부를 골라 주세요"}>
          <div className="grid grid-cols-2 gap-1.5">
            <Chip on={v.open_status === "영업중"} tone="emerald" onClick={() => set({ open_status: v.open_status === "영업중" ? "" : "영업중" })}>영업중</Chip>
            <Chip on={v.open_status === "문 잠김"} tone="slate" onClick={() => set({ open_status: v.open_status === "문 잠김" ? "" : "문 잠김" })}>문 잠김</Chip>
          </div>
          {(v.open_status === "문 잠김" || v.no_contact) && (
            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <div className="text-[12px] font-bold text-slate-600">잠겼다는 근거를 하나 이상 남겨 주세요. {req}</div>
              <div><div className={label}>우편물 적치</div><ChipRow options={o.mail} value={v.evid_mail} onPick={(x) => set({ evid_mail: x })} /></div>
              <div><div className={label}>간판</div><ChipRow options={o.sign} value={v.evid_sign} onPick={(x) => set({ evid_sign: x })} /></div>
              <div>
                <div className={label}>옆 가게 진술</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Chip on={v.evid_neighbor === o.neighborNone} tone="slate" onClick={() => set({ evid_neighbor: v.evid_neighbor === o.neighborNone ? "" : o.neighborNone })}>{o.neighborNone}</Chip>
                  {o.neighborQuick.map((q) => <Chip key={q} on={v.evid_neighbor === q} onClick={() => set({ evid_neighbor: v.evid_neighbor === q ? "" : q })}>"{q}"</Chip>)}
                </div>
                <input value={v.evid_neighbor === o.neighborNone ? "" : v.evid_neighbor} onChange={(e) => set({ evid_neighbor: e.target.value })} placeholder='들은 말 그대로 (예: "2개월째 안 열었다")' aria-label="옆 가게 진술" className={`${input} mt-1.5`} />
              </div>
              <div><div className={label}>결론</div><ChipRow options={o.closedEstimates} value={v.closed_estimate} onPick={(x) => set({ closed_estimate: x })} /></div>
            </div>
          )}
          <StepMessages val={val} step={3} />
        </Step>

        {/* ④ 독촉 내용 */}
        <Step no={4} title={STEP_TITLES[4]} state={stepState(val, 4)} done={v.dun_methods.length > 0} open={isOpen(4)} onToggle={() => toggle(4)}
          summary={v.dun_methods.length ? `${v.dun_methods.join(", ")}${v.dun_reply ? ` · ${v.dun_reply}` : ""}` : "전달 방법을 골라 주세요"}>
          <div>
            <div className={label}>전달 방법 (여러 개 고를 수 있어요)</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {o.dunMethods.map((m) => {
                const on = v.dun_methods.includes(m);
                return <Chip key={m} on={on} onClick={() => set({ dun_methods: on ? v.dun_methods.filter((x) => x !== m) : [...v.dun_methods, m] })}>{m}</Chip>;
              })}
            </div>
          </div>
          {showSealed && <CheckLine checked={!!ack.sealed} need onChange={(c) => setAck({ sealed: c })}>안내문을 봉투에 넣어 봉함했습니다. 겉면에 금액·'미납' 표시가 없습니다.</CheckLine>}
          {showThirdParty && <CheckLine checked={!!ack.thirdPartyNoDebt} onChange={(c) => setAck({ thirdPartyNoDebt: c })}>대표·담당자가 아닌 분에게 금액·채무 사실은 말하지 않았습니다.</CheckLine>}
          <div>
            <div className={label}>상대 답변</div>
            <ChipOrQuote options={o.dunReplies} value={v.dun_reply} onChange={(x) => set({ dun_reply: x })} placeholder="또는 들은 말 그대로 적기" ariaLabel="상대 답변 직접 입력" />
            {v.dun_reply === o.promiseReply && (
              <label className="mt-1.5 block"><span className={label}>약속한 날짜</span>
                <input type="date" value={v.promise_date} onChange={(e) => set({ promise_date: e.target.value })} className={`${input} mt-1`} />
              </label>
            )}
          </div>
          <StepMessages val={val} step={4} />
        </Step>

        {/* ⑤ 기기 반환 요구 */}
        <Step no={5} title={STEP_TITLES[5]} state={stepState(val, 5)} done={v.return_requested && !!v.return_to.trim() && !!v.return_reply.trim() && !!v.return_method} open={isOpen(5)} onToggle={() => { if (!is2nd) toggle(5); }}
          tag={is2nd ? <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-black text-rose-600">2차 필수</span> : <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500">선택</span>}
          summary={v.return_requested ? `요구함${v.return_reply ? ` · ${v.return_reply}` : ""}` : "1차 방문은 선택입니다"}>
          {is2nd && <div className="rounded-lg bg-rose-50/60 px-3 py-2 text-[12px] font-semibold leading-5 text-rose-700">반환 요구 기록이 없으면 기기값을 청구할 수 없습니다. 누구에게 말했는지, 뭐라고 답했는지, 반환 방법까지 남겨 주세요.</div>}
          <div className="grid grid-cols-2 gap-1.5">
            <Chip on={v.return_requested} onClick={() => set({ return_requested: true, ...(!v.return_to.trim() && contactLabel ? { return_to: contactLabel } : {}) })}>요구함</Chip>
            <Chip on={!v.return_requested} tone="slate" onClick={() => set({ return_requested: false })}>요구 안 함</Chip>
          </div>
          {v.return_requested && (
            <div className="space-y-3">
              <div>
                <label className="block"><span className={label}>누구에게 {is2nd && req}</span>
                  <input value={v.return_to} onChange={(e) => set({ return_to: e.target.value })} placeholder="이름 / 직위" className={`${input} mt-1`} />
                </label>
                {contactLabel && v.return_to !== contactLabel && <button type="button" onClick={() => set({ return_to: contactLabel })} className="mt-1 min-h-11 rounded-md px-2 text-[12px] font-bold text-blue-700 hover:bg-blue-50">응대자와 같음: {contactLabel}</button>}
              </div>
              <div><div className={label}>답변 {is2nd && req}</div>
                <ChipOrQuote options={o.returnReplies} value={v.return_reply} onChange={(x) => set({ return_reply: x })} placeholder="또는 들은 말 그대로 적기" ariaLabel="반환 답변 직접 입력" />
              </div>
              <div><div className={label}>반환 방법 안내 {is2nd && req}</div><ChipRow options={o.returnMethods} value={v.return_method} onPick={(x) => set({ return_method: x })} /></div>
            </div>
          )}
          <StepMessages val={val} step={5} />
        </Step>

        {/* ⑥ 사진 4칸 */}
        <Step no={6} title={STEP_TITLES[6]} state={stepState(val, 6)} done={photoFilled === 4} open={isOpen(6)} onToggle={() => toggle(6)}
          tag={<span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-black tabular-nums text-slate-600">{photoFilled}/4</span>}
          summary={`${photoFilled}/4칸 채움`}>
          <div className="text-[12px] font-medium text-slate-500">{is2nd ? "2차 경고는 4칸 모두 필요합니다. 찍을 수 없으면 칸마다 [촬영 불가]로 사유를 골라 주세요." : "4칸을 채우는 것이 원칙입니다. 찍을 수 없으면 [촬영 불가]로 사유를 골라 주세요."}</div>
          <div className="grid grid-cols-2 gap-2">
            {PHOTO_SLOTS.map((s) => (
              <PhotoSlotCard key={s.key} meta={s} state={p.photos[s.key]} skip={v.photo_skips[s.key] || ""} reasons={o.photoSkipReasons}
                onFile={(f) => p.onPhotoFile(s.key, f)} onRemove={() => p.onPhotoRemove(s.key)}
                onRetry={p.onPhotoRetry ? () => p.onPhotoRetry?.(s.key) : undefined}
                onSkip={(r) => { const next: MisuVisitFormValue["photo_skips"] = { ...v.photo_skips }; next[s.key] = r; set({ photo_skips: next }); }} />
            ))}
          </div>
          <StepMessages val={val} step={6} />
        </Step>

        {/* ⑦ 현장 판단 */}
        <Step no={7} title={STEP_TITLES[7]} state={stepState(val, 7)} done={!!v.judgment && !!v.judgment_reason.trim()} open={isOpen(7)} onToggle={() => toggle(7)}
          summary={v.judgment ? `${v.judgment}${v.judgment_reason ? ` — ${v.judgment_reason}` : ""}` : "판단을 골라 주세요"}>
          <div className="grid grid-cols-3 gap-1.5">
            <Chip on={v.judgment === "계속 독촉"} onClick={() => set({ judgment: v.judgment === "계속 독촉" ? "" : "계속 독촉" })}>계속 독촉</Chip>
            <Chip on={v.judgment === "철수"} tone="amber" onClick={() => set({ judgment: v.judgment === "철수" ? "" : "철수" })}>철수</Chip>
            <Chip on={v.judgment === "소송이관"} tone="rose" onClick={() => set({ judgment: v.judgment === "소송이관" ? "" : "소송이관" })}>소송이관</Chip>
          </div>
          <div>
            <div className={label}>사유 한 줄 {req}</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {o.judgmentReasonQuick.map((q) => <Chip key={q} tone="slate" on={v.judgment_reason === q} onClick={() => set({ judgment_reason: v.judgment_reason === q ? "" : q })}>{q}</Chip>)}
            </div>
            <input value={v.judgment_reason} onChange={(e) => set({ judgment_reason: e.target.value })} placeholder="예: 2차 경고 후 무응답, 폐업 추정" aria-label="현장 판단 사유" className={`${input} mt-1.5`} />
          </div>
          <StepMessages val={val} step={7} />
        </Step>
      </div>

      {/* 미리보기 + 4원칙 확인 + 보내기 */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="px-4 pt-3.5 lg:px-5">
          <div className={section}>보낼 문장 미리보기</div>
          <div className="mt-0.5 text-[12px] font-medium text-slate-500">빨간 줄은 이대로 보내면 법무팀에서 반려됩니다.</div>
          <ul className="mt-2 space-y-1.5">
            {p.previewLines.map((line, i) => {
              const cut = line.indexOf(": ");
              const head = cut > 0 ? line.slice(0, cut) : "";
              const text = cut > 0 ? line.slice(cut + 2) : line;
              const tone = lineTone(i);
              const box = tone === "block" ? "bg-rose-50" : tone === "warn" ? "bg-amber-50" : "bg-emerald-50/60";
              const ink = tone === "block" ? "text-rose-600" : tone === "warn" ? "text-amber-700" : "text-emerald-700";
              return (
                <li key={`${i}-${head}`} className={`rounded-lg px-3 py-2 ${box}`}>
                  {head && <div className={`flex items-center gap-1 text-[11px] font-black ${ink}`}>{tone === "block" ? <X size={12} aria-hidden /> : tone === "warn" ? <AlertTriangle size={12} aria-hidden /> : <Check size={12} aria-hidden />}{head}</div>}
                  <div className="mt-0.5 break-keep text-[13px] font-semibold leading-5 text-slate-800">{text}</div>
                </li>
              );
            })}
          </ul>
          {p.kakaoText && (
            <details className="group mt-2">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 text-[12px] font-bold text-slate-500 [&::-webkit-details-marker]:hidden">카톡 원문 전체 보기<ChevronDown size={14} aria-hidden className="transition group-open:rotate-180" /></summary>
              <pre className="whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-3 font-sans text-[12px] leading-5 text-slate-700">{p.kakaoText}</pre>
            </details>
          )}
        </div>

        <div className="px-4 pt-3 lg:px-5">
          <CheckLine checked={!!ack.principles} onChange={(c) => setAck({ principles: c })}>현장 4원칙(시간·채무 고지 대상·봉함·잠긴 곳 안 열기)을 지켰습니다.</CheckLine>
        </div>

        <div className="sticky bottom-0 z-10 mt-3 rounded-b-xl border-t border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur lg:px-5">
          <div className="flex flex-wrap gap-1">
            {val.checks.map((c) => (
              <span key={c.key} className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${c.state === "ok" ? "bg-emerald-50 text-emerald-700" : c.state === "block" ? "bg-rose-50 text-rose-600" : c.state === "warn" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-400"}`}>
                {c.state === "ok" ? "✓" : c.state === "block" ? "✗" : c.state === "warn" ? "!" : "–"} {c.label}{c.state === "skip" ? " (선택)" : ""}
              </span>
            ))}
          </div>
          {p.roomNotice && <div className={`mt-1.5 text-[12px] font-bold ${p.roomNotice.tone === "warn" ? "text-amber-700" : "text-slate-500"}`}>{p.roomNotice.text}</div>}
          {(val.blocks.length > 0 || val.warns.length > 0) && (
            <div className="mt-1 text-[12px] font-bold">
              {val.blocks.length > 0 && <span className="text-rose-600">필수 {val.blocks.length}개가 비어 있어 보낼 수 없습니다. </span>}
              {val.warns.length > 0 && <span className="text-amber-700">확인 {val.warns.length}개는 보낼 수 있지만 기록에 표시됩니다.</span>}
            </div>
          )}
          {p.onSubmit && (
            <button type="button" onClick={p.onSubmit} disabled={!canSend} className="mt-2 inline-flex min-h-12 w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 text-[14px] font-black text-white transition hover:bg-blue-700 disabled:pointer-events-none disabled:opacity-40">
              {p.submitting ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Send size={16} aria-hidden />}{p.submitting ? "저장하고 보내는 중…" : "저장하고 보내기"}
            </button>
          )}
          {p.result && <div role={p.result.tone === "error" ? "alert" : "status"} className={`mt-1.5 text-[12px] font-bold ${p.result.tone === "error" ? "text-rose-600" : p.result.tone === "warn" ? "text-amber-700" : "text-emerald-600"}`}>{p.result.text}</div>}
        </div>
      </div>
    </div>
  );
}
