// 미수 방문이력(CS 방문이력 작성기) 순수 로직 — 저장·화면 없음.
// 기준: docs/tasks/misu-visit-standard.md(법무팀 확정안), 설계: docs/tasks/misu-redesign.md §3·§4.
// 열 이름은 supabase/misu-visits.sql(misu_visits) 과 같다. 저장·카톡은 misuVisitApi.ts, 화면은 MisuVisitForm*.tsx / MisuVisitHistory*.tsx.
// 사용자 결정(2026-10-22): D2 2차 경고는 사진 4칸 필수(칸마다 촬영 불가 사유를 고르면 통과, 1차는 경고만),
// D3 08~21시 밖 방문은 경고 + 사유 필수, D4 방 없으면 저장만(이 파일과 무관), D10 옛 카톡 기록은 회색 '이전 기록'(체크리스트엔 안 셈).
import { kstDate } from "./visits";
import { maskCode } from "./privacy";

// ───────── 타입 ─────────
export type MisuRound = "1차 안내" | "2차 경고" | "추가";
export type MisuOpenStatus = "영업중" | "문 잠김" | "폐업 확인" | "";
export type MisuJudgment = "계속 독촉" | "철수" | "소송이관" | "";
export type MisuPhotoSlot = "outside" | "door" | "device" | "notice";
export type MisuRepPhoneStatus = "확보" | "거부" | "모름" | "";

export type MisuPhoto = { slot: MisuPhotoSlot; url: string; w?: number; h?: number };

export type MisuRulesAck = {
  sealed?: boolean; // 안내문 봉함 확인(4원칙 ③)
  thirdPartyNoDebt?: boolean; // 대표 아닌 사람에게 금액·채무를 말하지 않았음(4원칙 ②)
  principles?: boolean; // 4원칙 읽고 지킴(화면 확인 줄)
  offHoursReason?: string; // 08~21시 밖 방문 사유(D3)
};

/** misu_visits 한 행(저장·조회 공용). 숨김 3열 포함. */
export type MisuVisit = {
  id: string;
  created_at?: string;
  visited_at: string; // ISO(timestamptz)
  visit_round: MisuRound;
  author: string;
  author_sub: string;
  author_team: string;
  vendor: string;
  company_code: string;
  site_code: string;
  lease_seq: string;
  region: string;
  misu_months: string;
  misu_balance: string;
  contact_name: string;
  contact_title: string;
  contact_is_rep: boolean | null;
  rep_phone: string;
  rep_phone_status: MisuRepPhoneStatus | string;
  no_contact: boolean;
  open_status: MisuOpenStatus;
  evid_mail: string;
  evid_sign: string;
  evid_neighbor: string;
  closed_estimate: string;
  dun_methods: string[];
  dun_reply: string;
  promise_date: string;
  return_requested: boolean;
  return_to: string;
  return_reply: string;
  return_method: string;
  photos: MisuPhoto[];
  photo_skips: Partial<Record<MisuPhotoSlot, string>>;
  album_id: string;
  judgment: MisuJudgment;
  judgment_reason: string;
  rules_ack: MisuRulesAck;
  missing: string[];
  supplement_of: string | null;
  text_body: string;
  room: string;
  _hidden?: boolean | null;
  _hidden_by?: string | null;
  _hidden_at?: string | null;
};

/** 작성 중인 폼 = 저장할 행에서 서버가 채우는 값만 뺀 것. */
export type MisuVisitDraft = Omit<MisuVisit, "created_at" | "_hidden" | "_hidden_by" | "_hidden_at">;

// ───────── 칩 값(화면·문장 생성 공용) ─────────
export const MISU_ROUNDS: MisuRound[] = ["1차 안내", "2차 경고", "추가"];
export const CONTACT_TITLES = ["대표", "원장", "점장", "실장", "경리", "직원", "기타"] as const;
export const OPEN_STATUSES: Exclude<MisuOpenStatus, "">[] = ["영업중", "문 잠김", "폐업 확인"];
export const MAIL_OPTIONS = ["없음", "1주", "2주", "3주+", "수북"] as const;
export const SIGN_OPTIONS = ["유지", "철거"] as const;
export const NEIGHBOR_NONE = "진술 없음";
export const CLOSED_ESTIMATES = ["폐업 추정", "일시 휴무 추정", "판단 보류"] as const;
export const DUN_METHODS = ["구두 안내", "안내문 봉함 전달", "안내문 봉함 투입"] as const;
export const DUN_REPLY_CHIPS = ["대표에게 전달하겠다", "납부 약속", "분할 요청", "거부", "무응답"] as const;
export const RETURN_REPLY_CHIPS = ["대표 확인 후 회신", "반환 거부", "반환 약속", "무응답"] as const;
export const RETURN_METHODS = ["반송 주소 안내", "회수 방문 일정 협의", "안내 못함"] as const;
export const PHOTO_SKIP_REASONS = ["문 잠김", "거부", "기타"] as const;
export const JUDGMENTS: Exclude<MisuJudgment, "">[] = ["계속 독촉", "철수", "소송이관"];
export const PHOTO_SLOTS: MisuPhotoSlot[] = ["outside", "door", "device", "notice"];
export const PHOTO_SLOT_LABEL: Record<MisuPhotoSlot, string> = { outside: "외부", door: "출입문", device: "기기+S/N", notice: "안내문" };
export const PHOTO_SLOT_HINT: Record<MisuPhotoSlot, string> = {
  outside: "외부(간판+호수)", door: "출입문", device: "기기 전체+S/N 라벨", notice: "안내문 부착·투입",
};
/** 자유 입력에 있으면 경고(법무: 사실과 다르고 회사 리스크). */
export const FORBIDDEN_WORDS = ["신용불량", "구속", "감옥", "전과"];

const s = (v: unknown) => String(v ?? "").trim();

function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // 오래된 브라우저 대비(uuid v4 형식)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** 빈 초안. id 는 폼 열 때 한 번 만들어 재전송에도 그대로 쓴다(중복 저장 방지). */
export function emptyMisuVisitDraft(init: Partial<MisuVisitDraft> = {}, now: Date = new Date()): MisuVisitDraft {
  return {
    id: newId(),
    visited_at: now.toISOString(),
    visit_round: "1차 안내",
    author: "", author_sub: "", author_team: "",
    vendor: "", company_code: "", site_code: "", lease_seq: "", region: "",
    misu_months: "", misu_balance: "",
    contact_name: "", contact_title: "", contact_is_rep: null, rep_phone: "", rep_phone_status: "",
    no_contact: false, open_status: "",
    evid_mail: "", evid_sign: "", evid_neighbor: "", closed_estimate: "",
    dun_methods: [], dun_reply: "", promise_date: "",
    return_requested: false, return_to: "", return_reply: "", return_method: "",
    photos: [], photo_skips: {}, album_id: "",
    judgment: "", judgment_reason: "",
    rules_ack: {}, missing: [], supplement_of: null,
    text_body: "", room: "",
    ...init,
  };
}

// ───────── KST 시각 ─────────
const KST_TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const KST_WEEKDAY = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", weekday: "short" });

function toDate(v: string | Date): Date | null {
  const d = v instanceof Date ? v : new Date(String(v || ""));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** ISO → KST { date: "2026-10-22", hm: "14:20", weekday: "수", minutes: 860 }. 잘못된 값이면 null. */
export function kstParts(v: string | Date): { date: string; hm: string; weekday: string; minutes: number } | null {
  const d = toDate(v);
  if (!d) return null;
  const hm = KST_TIME.format(d);
  const [h, m] = hm.split(":").map(Number);
  return { date: kstDate(d), hm, weekday: KST_WEEKDAY.format(d).replace(/[^가-힣]/g, ""), minutes: h * 60 + m };
}

/** "2026-10-22(수) 14:20" */
export function formatKstDateTime(v: string | Date): string {
  const p = kstParts(v);
  return p ? `${p.date}(${p.weekday}) ${p.hm}` : s(v);
}

/** 채권추심법: 08:00~21:00(KST) 밖이면 true. 21:00 정각은 허용, 21:01 부터 밖. 시각을 못 읽으면 false. */
export function isOffHours(v: string | Date): boolean {
  const p = kstParts(v);
  if (!p) return false;
  return p.minutes < 8 * 60 || p.minutes > 21 * 60;
}

// ───────── 항목별 충족 판정 ─────────
/** ① 응대자: 이름·직위(이름 없이 '직원' 반려), 대표 아니면 대표 연락처 상태. 아무도 없음이면 충족(대신 ② 근거 필수). */
export function contactProblem(d: Pick<MisuVisit, "no_contact" | "contact_name" | "contact_title" | "contact_is_rep" | "rep_phone" | "rep_phone_status">): string {
  if (d.no_contact) return "";
  const name = s(d.contact_name);
  const title = s(d.contact_title);
  if (!name && title === "직원") return "'직원'은 반려 — 이름까지 적어 주세요";
  if (!name || name === "직원" || name === "모름") return "응대자 이름을 적어 주세요";
  if (!title) return "응대자 직위를 골라 주세요";
  if (d.contact_is_rep == null) return "대표자 본인인지 골라 주세요";
  if (d.contact_is_rep === false) {
    const st = s(d.rep_phone_status);
    if (!["확보", "거부", "모름"].includes(st)) return "대표자 연락처를 받았는지 골라 주세요(확보/거부/모름)";
    if (st === "확보" && s(d.rep_phone).replace(/\D/g, "").length < 9) return "확보한 대표자 연락처 번호를 적어 주세요";
  }
  return "";
}

/** ② 문 잠김(또는 아무도 없음)이면 근거(우편물·간판·옆 가게) 1개 이상. */
export function lockedEvidenceCount(d: Pick<MisuVisit, "evid_mail" | "evid_sign" | "evid_neighbor">): number {
  let n = 0;
  if (s(d.evid_mail)) n++;
  if (s(d.evid_sign)) n++;
  const nb = s(d.evid_neighbor);
  if (nb && nb !== NEIGHBOR_NONE) n++;
  return n;
}
export function needsLockedEvidence(d: Pick<MisuVisit, "open_status" | "no_contact">): boolean {
  return d.open_status === "문 잠김" || d.no_contact;
}

/** ③ 기기 반환 요구 3요소(누구에게·답변·방법). '안내 못함'은 방법 미충족. */
export function returnComplete(d: Pick<MisuVisit, "return_requested" | "return_to" | "return_reply" | "return_method">): boolean {
  return d.return_requested === true && !!s(d.return_to) && !!s(d.return_reply) && !!s(d.return_method) && s(d.return_method) !== "안내 못함";
}

/** ④ 칸별 상태: photo(사진 있음) / skip(촬영 불가 사유) / empty */
export function photoSlotState(d: Pick<MisuVisit, "photos" | "photo_skips">, slot: MisuPhotoSlot): "photo" | "skip" | "empty" {
  if ((d.photos || []).some((p) => p && p.slot === slot && s(p.url))) return "photo";
  if (s(d.photo_skips?.[slot])) return "skip";
  return "empty";
}
export function photoSlotsFilled(d: Pick<MisuVisit, "photos" | "photo_skips">): boolean {
  return PHOTO_SLOTS.every((slot) => photoSlotState(d, slot) !== "empty");
}

/** ⑤ 현장 판단 + 사유 */
export function judgmentComplete(d: Pick<MisuVisit, "judgment" | "judgment_reason">): boolean {
  return !!d.judgment && !!s(d.judgment_reason);
}

/** 자유 입력 칸에서 금지 표현 찾기 */
export function findForbiddenWords(d: Partial<MisuVisit>): string[] {
  const text = [d.dun_reply, d.return_reply, d.evid_neighbor, d.judgment_reason, d.contact_name, d.return_to].map(s).join("\n");
  return FORBIDDEN_WORDS.filter((w) => text.includes(w));
}

// ───────── 전송 전 검증 ─────────
export type MisuCheckKey = "contact" | "locked" | "return" | "photos" | "judgment";
export const MISU_CHECK_LABEL: Record<MisuCheckKey, string> = {
  contact: "① 응대자", locked: "② 문 잠김 근거", return: "③ 기기 반환 요구", photos: "④ 사진 4장", judgment: "⑤ 현장 판단",
};
export type MisuIssue = { key: MisuCheckKey | "open" | "sealed" | "offHours" | "thirdParty" | "dun" | "forbidden" | "vendor" | "author" | "visitedAt"; message: string };
export type MisuCheckRow = { key: MisuCheckKey; label: string; state: "ok" | "warn" | "block" | "skip" };
export type MisuValidation = {
  ok: boolean; // 막음 없음 → 보내기 가능
  blocks: MisuIssue[]; // 빨강(보내기 막음)
  warns: MisuIssue[]; // 노랑(보내기 허용)
  checks: MisuCheckRow[]; // 필수 5칸 ✓/✗ 표시용(skip = 이 차수에선 선택·해당 없음)
  missing: string[]; // 경고로 통과한 필수 항목 라벨 → misu_visits.missing 에 저장
  offHours: boolean;
};

/**
 * 차수별 검증(설계안 §4-A 검증 표).
 * - 1차 안내·추가: ③ 반환 요구는 선택(요구함인데 덜 채우면 경고), ④ 사진은 경고(missing 에 남음).
 * - 2차 경고: ③·④ 막음. ④는 칸마다 사진 또는 촬영 불가 사유면 통과(D2).
 * - 08~21시 밖: 사유 없으면 막음, 있으면 경고(D3).
 */
export function validateMisuVisit(d: MisuVisitDraft): MisuValidation {
  const blocks: MisuIssue[] = [];
  const warns: MisuIssue[] = [];
  const missing: string[] = [];
  const state: Record<MisuCheckKey, MisuCheckRow["state"]> = { contact: "ok", locked: "skip", return: "skip", photos: "ok", judgment: "ok" };
  const second = d.visit_round === "2차 경고";

  if (!s(d.vendor)) blocks.push({ key: "vendor", message: "업체를 골라 주세요" });
  if (!s(d.author)) blocks.push({ key: "author", message: "작성자를 골라 주세요" });
  if (!toDate(d.visited_at)) blocks.push({ key: "visitedAt", message: "방문 일시를 확인해 주세요" });

  // ① 응대자
  const cp = contactProblem(d);
  if (cp) { blocks.push({ key: "contact", message: cp }); state.contact = "block"; }

  // 운영 여부 + ② 근거
  if (!d.no_contact && !d.open_status) blocks.push({ key: "open", message: "운영 여부를 골라 주세요(영업중/문 잠김)" });
  if (needsLockedEvidence(d)) {
    state.locked = "ok";
    if (lockedEvidenceCount(d) < 1) {
      blocks.push({ key: "locked", message: "문 잠김 근거(우편물·간판·옆 가게) 중 하나 이상" });
      state.locked = "block";
    }
  }

  // 독촉 내용
  const methods = d.dun_methods || [];
  if (!methods.length) warns.push({ key: "dun", message: "독촉 전달 방법이 비어 있습니다" });
  if (methods.some((m) => m.startsWith("안내문")) && !d.rules_ack?.sealed) {
    blocks.push({ key: "sealed", message: "안내문 봉함 확인 체크(겉면에 금액·'미납'이 보이면 안 됨)" });
  }
  if (!d.no_contact && d.contact_is_rep === false && methods.length && !d.rules_ack?.thirdPartyNoDebt) {
    warns.push({ key: "thirdParty", message: "대표자가 아닌 사람에게 금액·채무를 말하지 않았는지 확인해 주세요" });
  }

  // ③ 기기 반환 요구
  if (second) {
    state.return = "ok";
    if (!returnComplete(d)) {
      blocks.push({ key: "return", message: "2차 경고는 기기 반환 요구 필수 — 누구에게·답변·반환 방법 안내까지" });
      state.return = "block";
    }
  } else if (d.return_requested) {
    state.return = "ok";
    if (!returnComplete(d)) {
      warns.push({ key: "return", message: "반환 요구 기록이 덜 찼습니다(누구에게·답변·방법)" });
      state.return = "warn";
    }
  }

  // ④ 사진
  if (!photoSlotsFilled(d)) {
    const empty = PHOTO_SLOTS.filter((slot) => photoSlotState(d, slot) === "empty").map((slot) => PHOTO_SLOT_LABEL[slot]);
    const msg = `사진 ${empty.join(" · ")} — 찍거나 촬영 불가 사유를 골라 주세요`;
    if (second) { blocks.push({ key: "photos", message: msg }); state.photos = "block"; }
    else { warns.push({ key: "photos", message: msg }); state.photos = "warn"; missing.push(MISU_CHECK_LABEL.photos); }
  }

  // ⑤ 현장 판단
  if (!judgmentComplete(d)) {
    blocks.push({ key: "judgment", message: d.judgment ? "현장 판단 사유 한 줄을 적어 주세요" : "현장 판단(계속 독촉/철수/소송이관)을 골라 주세요" });
    state.judgment = "block";
  }

  // 08~21시
  const offHours = isOffHours(d.visited_at);
  if (offHours) {
    if (!s(d.rules_ack?.offHoursReason)) blocks.push({ key: "offHours", message: "08~21시 밖 방문 — 사유를 적어 주세요(채권추심법)" });
    else warns.push({ key: "offHours", message: "08~21시 밖 방문으로 기록됩니다" });
  }

  const bad = findForbiddenWords(d);
  if (bad.length) warns.push({ key: "forbidden", message: `"${bad.join('", "')}" 같은 표현은 쓰지 마세요(법무 표준문안 범위 안에서만)` });

  const checks = (Object.keys(MISU_CHECK_LABEL) as MisuCheckKey[]).map((key) => ({ key, label: MISU_CHECK_LABEL[key], state: state[key] }));
  return { ok: blocks.length === 0, blocks, warns, checks, missing, offHours };
}

// ───────── 문장 생성(법무 X→O 예시 형식) ─────────
const PLAIN_DUN_REPLY: Record<string, string> = { 거부: "납부 거부", 무응답: "무응답", "분할 요청": "분할 납부 요청" };
const PLAIN_RETURN_REPLY: Record<string, string> = { "반환 거부": "반환 거부", "반환 약속": "반환 약속", 무응답: "무응답" };
const DUN_METHOD_TEXT: Record<string, string> = { "구두 안내": "구두 안내", "안내문 봉함 전달": "안내문 봉함 후 전달", "안내문 봉함 투입": "안내문 봉함 후 투입" };

function quote(v: string): string {
  const t = s(v).replace(/^["“”']+|["“”']+$/g, "").trim();
  return t ? `"${t}"` : "";
}
function contactWho(d: Pick<MisuVisit, "contact_title" | "contact_name">): string {
  const title = s(d.contact_title);
  return title && title !== "기타" ? title : s(d.contact_name);
}

/** ① 응대자: 김○○ / 점장 / 대표자 아님 · 대표자 연락처 확보(010-0000-0000) */
export function contactSentence(d: MisuVisit | MisuVisitDraft): string {
  if (d.no_contact) return "응대자 없음(문 잠김)";
  const head = [s(d.contact_name), s(d.contact_title)].filter(Boolean).join(" / ");
  if (d.contact_is_rep === true) return `${head} / 대표자 본인`;
  if (d.contact_is_rep === false) {
    const st = s(d.rep_phone_status);
    const tail = st === "확보" ? `대표자 연락처 확보(${s(d.rep_phone)})` : st === "거부" ? "대표자 연락처 요청했으나 거부" : st === "모름" ? "대표자 연락처 모름" : "대표자 연락처 미확인";
    return `${head} / 대표자 아님 · ${tail}`;
  }
  return head;
}

function mailText(v: string): string {
  const t = s(v);
  if (!t) return "";
  if (t === "없음") return "우편물 없음";
  if (t === "수북") return "우편물 수북이 적치";
  const plus = t.endsWith("+");
  const base = t.replace(/\+$/, "").replace(/치$/, "");
  if (/^\d+\s*(주|일|개월)$/.test(base)) return `우편물 ${base}치${plus ? " 이상" : ""} 적치`;
  return `우편물 ${t}`;
}

/** ② 운영 여부: 문 잠김 / 우편물 3주치 적치, 간판 유지, 옆 가게 "2개월째 안 열었다" → 폐업 추정 */
export function openSentence(d: MisuVisit | MisuVisitDraft): string {
  const status = d.open_status || (d.no_contact ? "문 잠김" : "");
  const ev: string[] = [];
  const mail = mailText(d.evid_mail);
  if (mail) ev.push(mail);
  if (s(d.evid_sign)) ev.push(`간판 ${s(d.evid_sign)}`);
  const nb = s(d.evid_neighbor);
  if (nb) ev.push(nb === NEIGHBOR_NONE ? "옆 가게 진술 없음" : `옆 가게 ${quote(nb)}`);
  let out = status || "운영 여부 미확인";
  if (ev.length) out += ` / ${ev.join(", ")}`;
  if (s(d.closed_estimate)) out += ` → ${s(d.closed_estimate)}`;
  return out;
}

/** ③ 미수 독촉: 점장에게 구두 안내, 안내문 봉함 후 전달. "대표에게 전달하겠다", 납부 약속 없음 */
export function dunSentence(d: MisuVisit | MisuVisitDraft): string {
  const methods = (d.dun_methods || []).map((m) => DUN_METHOD_TEXT[m] || s(m)).filter(Boolean);
  if (!methods.length) return "독촉 안내 없음";
  const who = d.no_contact ? "" : contactWho(d);
  const head = who ? `${who}에게 ${methods.join(", ")}` : `응대자 없음 — ${methods.join(", ")}`;
  const parts: string[] = [];
  const reply = s(d.dun_reply);
  if (reply && reply !== "납부 약속") parts.push(PLAIN_DUN_REPLY[reply] || quote(reply));
  parts.push(s(d.promise_date) ? `납부 약속 ${s(d.promise_date)}` : "납부 약속 없음");
  return `${head}. ${parts.join(", ")}`;
}

/** ④ 기기 반환: 점장에게 반환 요구 고지, 반송 주소 안내. "대표 확인 후 회신" */
export function returnSentence(d: MisuVisit | MisuVisitDraft): string {
  if (!d.return_requested) return "반환 요구 안 함";
  const to = s(d.return_to);
  const method = s(d.return_method);
  let out = `${to ? `${to}에게 ` : ""}반환 요구 고지`;
  if (method) out += `, ${method === "안내 못함" ? "반환 방법 안내 못함" : method}`;
  const reply = s(d.return_reply);
  if (reply) out += `. ${PLAIN_RETURN_REPLY[reply] || quote(reply)}`;
  return out;
}

/** ⑤ 사진: 외부 · 출입문 · 기기+S/N · 안내문 4장 / 불가 칸은 "기기+S/N 촬영 불가(문 잠김)" */
export function photoSentence(d: Pick<MisuVisit, "photos" | "photo_skips">): string {
  const taken: string[] = [];
  const others: string[] = [];
  let count = 0;
  for (const slot of PHOTO_SLOTS) {
    const st = photoSlotState(d, slot);
    if (st === "photo") {
      taken.push(PHOTO_SLOT_LABEL[slot]);
      count += (d.photos || []).filter((p) => p && p.slot === slot && s(p.url)).length;
    } else if (st === "skip") others.push(`${PHOTO_SLOT_LABEL[slot]} 촬영 불가(${s(d.photo_skips?.[slot])})`);
    else others.push(`${PHOTO_SLOT_LABEL[slot]} 미첨부`);
  }
  const parts: string[] = [];
  if (taken.length) parts.push(`${taken.join(" · ")} ${count}장`);
  parts.push(...others);
  return parts.join(", ") || "사진 없음";
}

/** ⑥ 현장 판단: 소송이관 — 2차 경고 후 무응답, 폐업 추정 */
export function judgmentSentence(d: Pick<MisuVisit, "judgment" | "judgment_reason">): string {
  if (!d.judgment) return "판단 없음";
  return s(d.judgment_reason) ? `${d.judgment} — ${s(d.judgment_reason)}` : d.judgment;
}

/** ①~⑥ 줄(카톡·미리보기·타임라인·법무 복사 공용) */
export function misuVisitLines(d: MisuVisit | MisuVisitDraft): string[] {
  return [
    `① 응대자: ${contactSentence(d)}`,
    `② 운영 여부: ${openSentence(d)}`,
    `③ 미수 독촉: ${dunSentence(d)}`,
    `④ 기기 반환: ${returnSentence(d)}`,
    `⑤ 사진: ${photoSentence(d)}`,
    `⑥ 현장 판단: ${judgmentSentence(d)}`,
  ];
}

export function roundHeader(r: MisuRound | string): string {
  return r === "1차 안내" ? "1차(안내)" : r === "2차 경고" ? "2차(경고)" : s(r) || "추가";
}

/** 미수 개월 "5" → "5개월", 잔액 "2140050" → "2,140,050원" */
export function formatMisuAmount(months: string, balance: string): string {
  const m = s(months);
  const mm = m ? (/^\d+(\.\d+)?$/.test(m) ? `${m}개월` : m) : "";
  const b = s(balance);
  const digits = b.replace(/[,\s원]/g, "");
  const bb = b ? (/^-?\d+$/.test(digits) ? `${Number(digits).toLocaleString("ko-KR")}원` : b) : "";
  return [mm, bb].filter(Boolean).join(" · ");
}

function vendorLine(d: Pick<MisuVisit, "vendor" | "company_code" | "lease_seq">): string {
  // 카톡방에 나가는 글 — 개인 고객 거래처코드는 주민번호라 가린다(2026-10-22). 저장 칸 company_code 는 원본 그대로(매칭 키)
  const codes = [s(d.company_code) && `거래처코드 ${maskCode(s(d.company_code))}`, s(d.lease_seq) && `임순 ${s(d.lease_seq)}`].filter(Boolean);
  return `${s(d.vendor)}${codes.length ? ` (${codes.join(" · ")})` : ""}`;
}

/**
 * 카톡 본문(지역 미수방). 사진 앨범 주소를 주면 끝에 "📷 사진 N장 모아보기:\n주소"를 붙인다
 * (visits.ts visitCoreText 가 이 꼬리를 떼고 중복 판정).
 */
export function buildMisuKakaoText(d: MisuVisit | MisuVisitDraft, opts: { albumUrl?: string } = {}): string {
  const lines: string[] = [`/미수 방문 ${roundHeader(d.visit_round)}${d.supplement_of ? " · 보완 기록" : ""}`];
  lines.push(`업체: ${vendorLine(d)}`);
  const amt = formatMisuAmount(d.misu_months, d.misu_balance);
  if (amt) lines.push(`미수: ${amt}`);
  const author = s(d.author) ? ` · 작성 ${s(d.author)}${s(d.author_team) ? `(${s(d.author_team)})` : ""}` : "";
  lines.push(`방문: ${formatKstDateTime(d.visited_at)}${author}`);
  lines.push("", ...misuVisitLines(d));
  const notes: string[] = [];
  if (isOffHours(d.visited_at)) notes.push(`※ 08~21시 밖 방문 — 사유: ${s(d.rules_ack?.offHoursReason) || "(없음)"}`);
  if (d.missing?.length) notes.push(`※ 보완 필요: ${d.missing.join(", ")}`);
  if (notes.length) lines.push("", ...notes);
  const photoCount = (d.photos || []).filter((p) => p && s(p.url)).length;
  if (opts.albumUrl && photoCount) lines.push("", `📷 사진 ${photoCount}장 모아보기:`, opts.albumUrl);
  return lines.join("\n");
}

// ───────── 업체 키·묶기 ─────────
/** 업체 이름 정규화: ㈜ / (주) / 주식회사 / 공백·괄호 기호 제거, 소문자 */
export function normMisuVendorName(name: string): string {
  return s(name)
    .replace(/㈜|\(주\)|（주）|주식회사|\(유\)|유한회사/g, "")
    .replace(/[\s·.,\-_/()（）[\]]/g, "")
    .toLowerCase();
}
export type MisuVendorRef = { company_code?: string; lease_seq?: string; vendor?: string };
export type MisuLinkKind = "code" | "lease" | "name";

/** 두 업체 참조가 같은 업체인가 — 거래처코드 > 임순 > 정규화 이름. 같지 않으면 null. */
export function matchMisuVendor(a: MisuVendorRef, b: MisuVendorRef): MisuLinkKind | null {
  const ca = s(a.company_code), cb = s(b.company_code);
  if (ca && cb) return ca === cb ? "code" : null; // 코드가 둘 다 있는데 다르면 다른 업체
  const la = s(a.lease_seq), lb = s(b.lease_seq);
  if (la && lb) return la === lb ? "lease" : null;
  const na = normMisuVendorName(a.vendor || ""), nb = normMisuVendorName(b.vendor || "");
  return na && na === nb ? "name" : null;
}

export type MisuVendorGroup = {
  key: string; // "c:코드" | "l:임순" | "n:이름" (그룹 첫 기록 기준)
  vendor: string; // 가장 최근 기록의 업체 이름
  company_code: string;
  lease_seq: string;
  linkedBy: MisuLinkKind; // 가장 약한 연결(이름이면 화면에 "이름으로 이어짐")
  visits: MisuVisit[]; // 방문일 최신 순
};

export function misuVendorKey(r: MisuVendorRef): string {
  if (s(r.company_code)) return `c:${s(r.company_code)}`;
  if (s(r.lease_seq)) return `l:${s(r.lease_seq)}`;
  return `n:${normMisuVendorName(r.vendor || "")}`;
}

const LINK_RANK: Record<MisuLinkKind, number> = { code: 0, lease: 1, name: 2 };

/** 방문 기록을 업체별로 묶는다(숨김 제외). 코드 있는 기록을 먼저 묶고 나머지를 임순·이름으로 붙인다. */
export function groupMisuVisitsByVendor(visits: MisuVisit[]): MisuVendorGroup[] {
  const list = visits.filter((v) => !v._hidden);
  const ordered = [...list].sort((a, b) => (s(b.company_code) ? 1 : 0) - (s(a.company_code) ? 1 : 0) || (s(b.lease_seq) ? 1 : 0) - (s(a.lease_seq) ? 1 : 0));
  const groups: Array<MisuVendorGroup & { refs: MisuVendorRef[] }> = [];
  for (const v of ordered) {
    let found: (typeof groups)[number] | null = null;
    let kind: MisuLinkKind | null = null;
    for (const g of groups) {
      for (const ref of g.refs) {
        const k = matchMisuVendor(ref, v);
        if (k && (!kind || LINK_RANK[k] < LINK_RANK[kind])) { found = g; kind = k; }
      }
      if (kind === "code") break;
    }
    if (found && kind) {
      found.visits.push(v);
      found.refs.push({ company_code: v.company_code, lease_seq: v.lease_seq, vendor: v.vendor });
      if (LINK_RANK[kind] > LINK_RANK[found.linkedBy]) found.linkedBy = kind;
      if (!found.company_code && s(v.company_code)) found.company_code = s(v.company_code);
      if (!found.lease_seq && s(v.lease_seq)) found.lease_seq = s(v.lease_seq);
    } else {
      groups.push({
        key: misuVendorKey(v), vendor: s(v.vendor), company_code: s(v.company_code), lease_seq: s(v.lease_seq),
        linkedBy: s(v.company_code) ? "code" : s(v.lease_seq) ? "lease" : "name",
        visits: [v], refs: [{ company_code: v.company_code, lease_seq: v.lease_seq, vendor: v.vendor }],
      });
    }
  }
  return groups.map((g) => {
    const sorted = sortVisitsDesc(g.visits);
    return { key: g.key, vendor: s(sorted[0]?.vendor) || g.vendor, company_code: g.company_code, lease_seq: g.lease_seq, linkedBy: g.linkedBy, visits: sorted };
  });
}

function visitTime(v: Pick<MisuVisit, "visited_at">): number {
  const d = toDate(v.visited_at);
  return d ? d.getTime() : 0;
}
function createdTime(v: Pick<MisuVisit, "created_at">): number {
  const d = v.created_at ? toDate(v.created_at) : null;
  return d ? d.getTime() : 0;
}
function sortVisitsDesc(list: MisuVisit[]): MisuVisit[] {
  return [...list].sort((a, b) => visitTime(b) - visitTime(a) || createdTime(b) - createdTime(a));
}

// ───────── 보완 기록·차수 제안 ─────────
/**
 * 실효 기록: 숨김을 빼고, 보완 기록이 있는 원 기록은 가장 늦게 작성된 보완 기록으로 갈아 끼운다.
 * (보완 기록은 원 기록을 고친 '새 전체본'으로 저장한다는 약속 — 구현서 B)
 */
export function effectiveMisuVisits(visits: MisuVisit[]): MisuVisit[] {
  const live = visits.filter((v) => !v._hidden);
  const byId = new Map(live.map((v) => [v.id, v]));
  const rootOf = (v: MisuVisit): string => {
    let cur = v;
    const seen = new Set<string>();
    while (cur.supplement_of && byId.has(cur.supplement_of) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.supplement_of)!;
    }
    return cur.supplement_of && !byId.has(cur.supplement_of) ? cur.supplement_of : cur.id;
  };
  const latest = new Map<string, MisuVisit>();
  for (const v of live) {
    const root = rootOf(v);
    const prev = latest.get(root);
    const isSupp = !!v.supplement_of;
    if (!prev) { latest.set(root, v); continue; }
    const prevSupp = !!prev.supplement_of;
    if ((isSupp && !prevSupp) || (isSupp === prevSupp && createdTime(v) > createdTime(prev))) latest.set(root, v);
  }
  return sortVisitsDesc([...latest.values()]);
}

export type MisuRoundSuggestion = { round: MisuRound; count: number; lastRound: MisuRound | ""; lastVisitedAt: string; lastAuthor: string };

/** 지난 기록으로 다음 차수 제안: 없음 → 1차 안내, 1차 있음 → 2차 경고, 2차 있음 → 추가. */
export function suggestNextRound(visits: MisuVisit[]): MisuRoundSuggestion {
  const eff = effectiveMisuVisits(visits);
  const last = eff[0];
  const has = (r: MisuRound) => eff.some((v) => v.visit_round === r);
  const round: MisuRound = has("2차 경고") ? "추가" : has("1차 안내") ? "2차 경고" : "1차 안내";
  return { round, count: eff.length, lastRound: last?.visit_round || "", lastVisitedAt: last?.visited_at || "", lastAuthor: s(last?.author) };
}

// ───────── 소송이관 준비 체크리스트(ⓐ~ⓖ)·상태 칩 ─────────
export type MisuChecklistKey = "a" | "b" | "c" | "d" | "e" | "f" | "g";
export type MisuChecklistItem = { key: MisuChecklistKey; mark: string; label: string; ok: boolean; detail: string };
export type MisuChecklist = { items: MisuChecklistItem[]; ready: boolean };

/** 설계안 §4-B 5번. 옛 카톡 기록은 넣지 않는다(D10) — misu_visits 행만. */
export function litigationChecklist(visits: MisuVisit[]): MisuChecklist {
  const eff = effectiveMisuVisits(visits);
  const firsts = eff.filter((v) => v.visit_round === "1차 안내");
  const seconds = eff.filter((v) => v.visit_round === "2차 경고");
  const badContact = eff.filter((v) => !!contactProblem(v));
  const latest = eff[0];
  const offHours = eff.filter((v) => isOffHours(v.visited_at));
  const day = (v?: MisuVisit) => (v ? kstParts(v.visited_at)?.date || "" : "");
  const items: MisuChecklistItem[] = [
    { key: "a", mark: "ⓐ", label: "1차 안내 기록", ok: firsts.length > 0, detail: firsts.length ? `${firsts.length}건 · ${day(firsts[firsts.length - 1])}` : "없음" },
    { key: "b", mark: "ⓑ", label: "2차 경고 기록", ok: seconds.length > 0, detail: seconds.length ? `${seconds.length}건 · ${day(seconds[seconds.length - 1])}` : "없음" },
    { key: "c", mark: "ⓒ", label: "2차 반환 요구(누구에게·답변·방법)", ok: seconds.some(returnComplete), detail: seconds.some(returnComplete) ? "있음" : seconds.length ? "2차 기록에 3요소 부족" : "2차 없음" },
    { key: "d", mark: "ⓓ", label: "방문마다 응대자 이름·직위", ok: eff.length > 0 && badContact.length === 0, detail: badContact.length ? `${badContact.length}건 부족` : eff.length ? "모두 있음" : "방문 없음" },
    { key: "e", mark: "ⓔ", label: "2차 사진 4칸", ok: seconds.some(photoSlotsFilled), detail: seconds.some(photoSlotsFilled) ? "있음" : seconds.length ? "칸 비어 있음" : "2차 없음" },
    {
      key: "f", mark: "ⓕ", label: "현장 판단 소송이관/철수 + 사유",
      ok: !!latest && (latest.judgment === "소송이관" || latest.judgment === "철수") && !!s(latest.judgment_reason),
      detail: latest ? judgmentSentence(latest) : "방문 없음",
    },
    { key: "g", mark: "ⓖ", label: "08~21시 밖 방문 없음", ok: eff.length > 0 && offHours.length === 0, detail: offHours.length ? `${offHours.length}건 시간 외` : eff.length ? "없음" : "방문 없음" },
  ];
  return { items, ready: items.every((i) => i.ok) };
}

export type MisuVendorStatus = "소송이관 준비 완료" | "보완 필요" | "반환요구 기록 있음" | "2차 완료" | "1차만" | "방문 기록 없음";
export const MISU_STATUS_ORDER: MisuVendorStatus[] = ["소송이관 준비 완료", "보완 필요", "반환요구 기록 있음", "2차 완료", "1차만", "방문 기록 없음"];

/** 업체당 상태 칩 하나(위가 우선). '1차만' = 기록은 있으나 2차 경고가 없음(추가 차수만 있어도 여기). */
export function misuVendorStatus(visits: MisuVisit[]): MisuVendorStatus {
  const eff = effectiveMisuVisits(visits);
  if (!eff.length) return "방문 기록 없음";
  if (litigationChecklist(visits).ready) return "소송이관 준비 완료";
  if (eff.some((v) => (v.missing || []).length > 0)) return "보완 필요";
  if (eff.some((v) => v.return_requested)) return "반환요구 기록 있음";
  if (eff.some((v) => v.visit_round === "2차 경고")) return "2차 완료";
  return "1차만";
}

/** [법무 전달용 복사] 본문 — 관리부가 소송방에 붙여넣는 요약. 오래된 방문부터. */
export function buildLegalCopyText(visits: MisuVisit[], info: { vendor?: string; company_code?: string; lease_seq?: string; misu_months?: string; misu_balance?: string } = {}): string {
  const eff = effectiveMisuVisits(visits);
  const latest = eff[0];
  const vendor = s(info.vendor) || s(latest?.vendor);
  const codes = [
    // 법무 복사본도 직원 손을 거친다 — 주민번호 가림(2026-10-22). 실번호가 필요하면 법무가 임대리스트 원본에서
    s(info.company_code || latest?.company_code) && `거래처코드 ${maskCode(s(info.company_code || latest?.company_code))}`,
    s(info.lease_seq || latest?.lease_seq) && `임순 ${s(info.lease_seq || latest?.lease_seq)}`,
    formatMisuAmount(s(info.misu_months || latest?.misu_months), s(info.misu_balance || latest?.misu_balance)) && `미수 ${formatMisuAmount(s(info.misu_months || latest?.misu_months), s(info.misu_balance || latest?.misu_balance))}`,
  ].filter(Boolean);
  const cl = litigationChecklist(visits);
  const lines: string[] = [`[소송이관 CS 방문이력] ${vendor}`];
  if (codes.length) lines.push(codes.join(" · "));
  lines.push(`준비 체크: ${cl.items.map((i) => `${i.mark}${i.ok ? "✓" : "✗"}`).join(" ")}${cl.ready ? " (완료)" : " (미완)"}`);
  for (const v of [...eff].reverse()) {
    const author = s(v.author) ? ` · ${s(v.author)}${s(v.author_team) ? `(${s(v.author_team)})` : ""}` : "";
    lines.push("", `${v.visit_round} · ${formatKstDateTime(v.visited_at)} 방문${author}${v.supplement_of ? " · 보완" : ""}`, ...misuVisitLines(v));
    if (isOffHours(v.visited_at)) lines.push(`※ 08~21시 밖 방문 — 사유: ${s(v.rules_ack?.offHoursReason) || "(없음)"}`);
  }
  return lines.join("\n");
}

// ───────── 타임라인(새 기록 + 옛 카톡·관리부 메모) ─────────
export type MisuLegacyEntry = { at: string; source: string; author?: string; text: string };
export type MisuTimelineEntry =
  | { kind: "visit"; sortKey: string; visit: MisuVisit; supplement: boolean }
  | { kind: "legacy"; sortKey: string; entry: MisuLegacyEntry };

/**
 * 느슨한 날짜 → 정렬 키 "YYYY-MM-DD HH:MM"(KST). ISO(Z/오프셋)·"2024-03-05"·"2024. 3. 5"·"2024/3/5 14:20"·"24.03.05" 지원.
 * 못 읽으면 "".
 */
export function looseSortKey(v: string): string {
  const t = s(v);
  if (!t) return "";
  if (/T\d{2}:\d{2}/.test(t) && /(Z|[+-]\d{2}:?\d{2})$/.test(t)) {
    const p = kstParts(t);
    return p ? `${p.date} ${p.hm}` : "";
  }
  const m = t.match(/^(\d{2,4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})일?(?:[\sT]+(\d{1,2}):(\d{2}))?/);
  if (!m) return "";
  const y = m[1].length === 2 ? `20${m[1]}` : m[1];
  const pad = (x: string) => x.padStart(2, "0");
  return `${y}-${pad(m[2])}-${pad(m[3])} ${m[4] ? `${pad(m[4])}:${m[5]}` : "00:00"}`;
}

/**
 * 한 업체의 타임라인(최신 위). 원 기록 바로 아래에 보완 기록(작성 순)을 supplement=true 로 붙인다.
 * 옛 기록은 날짜로 끼워 넣고, 같은 시각이면 새 기록이 먼저. 날짜를 못 읽은 옛 기록은 맨 아래.
 */
export function mergeMisuTimeline(visits: MisuVisit[], legacy: MisuLegacyEntry[] = []): MisuTimelineEntry[] {
  const live = visits.filter((v) => !v._hidden);
  const ids = new Set(live.map((v) => v.id));
  const roots = live.filter((v) => !v.supplement_of || !ids.has(v.supplement_of));
  const children = new Map<string, MisuVisit[]>();
  for (const v of live) {
    if (v.supplement_of && ids.has(v.supplement_of)) {
      const arr = children.get(v.supplement_of) || [];
      arr.push(v);
      children.set(v.supplement_of, arr);
    }
  }
  type Block = { sortKey: string; rank: number; items: MisuTimelineEntry[] };
  const blocks: Block[] = [];
  for (const r of roots) {
    const key = looseSortKey(r.visited_at);
    const items: MisuTimelineEntry[] = [{ kind: "visit", sortKey: key, visit: r, supplement: false }];
    const walk = (id: string) => {
      const kids = (children.get(id) || []).sort((a, b) => createdTime(a) - createdTime(b));
      for (const k of kids) {
        items.push({ kind: "visit", sortKey: looseSortKey(k.visited_at), visit: k, supplement: true });
        walk(k.id);
      }
    };
    walk(r.id);
    blocks.push({ sortKey: key, rank: 0, items });
  }
  for (const e of legacy) {
    const key = looseSortKey(e.at);
    blocks.push({ sortKey: key, rank: 1, items: [{ kind: "legacy", sortKey: key, entry: e }] });
  }
  blocks.sort((a, b) => {
    if (!a.sortKey !== !b.sortKey) return a.sortKey ? -1 : 1;
    if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? 1 : -1;
    return a.rank - b.rank;
  });
  return blocks.flatMap((b) => b.items);
}
