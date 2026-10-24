/**
 * 카톡 "대화 내보내기" TXT → 글 목록(방·날짜·시:분·작성자·본문) + 가림 + 중복 키 (2026-10-24, 원문 보존)
 * 설계: docs/tasks/kakao-collect-expand.md 3-5 · docs/tasks/tab-search-kakao-history.md 3-2.
 * 쓰는 곳: 엣지 kakao-ingest(넣기), kakao-search(보여 주기 전 한 번 더 가림), tests/kakaoParse.test.ts. 브라우저·Deno·Node 공용(순수 TS).
 *
 * 형식(apps-script Kakao.gs parseKakaoMessages_ 의 3형식 + 시:분을 버리지 않음)
 *  1) 대괄호형  "[이민구] [오후 2:31] 본문"  + 날짜 띠 "--------------- 2026년 10월 23일 목요일 ---------------" (띠 없이 "2026년 10월 23일 목요일" 만 있어도)
 *  2) PC 점형   "2026. 10. 23. 오후 2:31, 이민구 : 본문"  (오전/오후 없는 24시간 "2026. 10. 23. 14:31, …" 도)
 *  3) 년월일형  "2026년 10월 23일 오후 2:31, 이민구 : 본문" (안드로이드 — 이름 없는 "2026년 10월 23일 오후 2:31" 줄은 날짜 줄로 본다)
 *  - 12시간제 → 24시간: 오전 12:xx = 00시, 오후 12:xx = 12시, 오후 1~11시 = +12.
 *  - 여러 줄 본문은 다음 글 머리가 나올 때까지 이어 붙인다. 초대·퇴장 같은 안내 줄은 버린다.
 *  - 날짜를 모르는 글(대괄호형인데 날짜 띠가 앞에 없음)은 버린다 — 시각 없는 원문은 중복 판정이 안 된다.
 *
 * 순서·중복
 *  - seq  = 같은 방·같은 분 안에서 몇 번째 글(1부터) — 화면 정렬용.
 *  - dupN = 같은 분·같은 작성자·같은 본문의 몇 번째(1부터) — toRows 가 가린 글 기준으로 다시 센다 — "네" 연타가 한 줄로 합쳐지지 않게 중복 키에 넣는다.
 *  - hash = SHA-256(가린 뒤: 방 | KST yyyy-mm-dd HH:mm | 작성자 | 본문 앞 500자 정규화 | #dupN). 같은 파일·겹치는 기간을 다시 넣어도 새 글만 들어간다.
 *    (seq 는 파일이 그 분의 앞 글을 빠뜨리면 바뀌므로 키에 넣지 않는다.)
 *
 * 가림(maskKakaoText) — 넣기 전에 한다(DB 트리거가 한 번 더)
 *  - 주민번호: _shared/privacy.ts maskRrn 그대로(하이픈형은 항상, 붙은 13자리는 "주민" 이름표가 있을 때만 — 기기 시리얼 오가림 방지)
 *  - 카드번호: 4-4-4-4 묶음은 항상 전부, 붙은 16자리는 "카드" 이름표가 있거나 룬(Luhn) 검사를 통과할 때 전부 가림
 *  - 계좌번호: "계좌" 이름표 뒤 숫자 — 끝 4자리만 남김
 *  - 휴대폰: 가운데 4자리만 → 010-****-5678 (원문 검색의 키는 업체·기번이라 전화 원번호가 필요 없다 — 사용자 결정 Q6)
 */
import { maskRrn } from "./privacy.ts";

export type KakaoMessage = {
  room: string;
  date: string;      // KST yyyy-mm-dd
  time: string;      // KST HH:mm (24시간)
  sentAt: string;    // "2026-10-23T14:31:00+09:00"
  author: string;
  text: string;      // 가림 전 원문(parseKakaoText) — maskMessages 뒤에는 가린 글
  seq: number;       // 같은 방·같은 분 안 순서(1부터)
  dupN: number;      // 같은 분·같은 작성자·같은 본문의 몇 번째(1부터)
};

export type KakaoHeader = { room: string; savedAt: string };

const pad2 = (n: string | number) => String(n).padStart(2, "0");
const ymd = (y: string, m: string, d: string) => `${y}-${pad2(m)}-${pad2(d)}`;

/** "오후" + 2 + 31 → "14:31". ampm 이 없으면 24시간제로 본다. 범위 밖이면 "" */
export function to24h(ampm: string | undefined, h: string | number, m: string | number): string {
  let hh = Number(h);
  const mm = Number(m);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || mm < 0 || mm > 59) return "";
  if (ampm === "오전" || /^am$/i.test(ampm || "")) hh = hh === 12 ? 0 : hh;
  else if (ampm === "오후" || /^pm$/i.test(ampm || "")) hh = hh === 12 ? 12 : hh + 12;
  if (hh < 0 || hh > 23) return "";
  return `${pad2(hh)}:${pad2(mm)}`;
}

// 대괄호형 글 머리
const BRACKET = /^\[([^\]]+)\]\s*\[(오전|오후)?\s*(\d{1,2}):(\d{2})\]\s?([\s\S]*)$/;
// PC 점형
const DOT = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*(오전|오후)?\s*(\d{1,2}):(\d{2}),\s*([^:]+?)\s*:\s?([\s\S]*)$/;
// 년월일형
const YMD_MSG = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*(오전|오후)?\s*(\d{1,2}):(\d{2}),\s*([^:]+?)\s*:\s?([\s\S]*)$/;
// 날짜 줄(띠·요일만·안드로이드의 "날짜 시각" 줄) — 글 머리가 아닌 것
const DATE_BAR = /^[-=\s]*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일(?:\s*[월화수목금토일]요일)?(?:\s*(?:오전|오후)?\s*\d{1,2}:\d{2})?[-=\s]*$/;
const DOT_BAR = /^[-=\s]*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?(?:\s*[월화수목금토일]요일)?[-=\s]*$/;
// 시스템 안내 줄(본문에 붙이지 않음)
const SYSTEM = /님(?:이|을|께서)\s.*(?:초대했습니다|입장했습니다|나갔습니다|내보냈습니다|되었습니다|시작했어요|들어왔습니다)\.?$|^채팅방 관리자가|^메시지가 삭제되었습니다\.?$/;
// 파일 머리
const HEAD_ROOM = /^(.+?)\s*(?:님과)?\s*카카오톡\s*대화(?:\s*\d+)?\s*$/;
const HEAD_SAVED = /^저장한\s*날짜\s*[:：]\s*(.+)$/;

/** 파일 첫 줄들의 방 이름·저장 날짜 — 없으면 빈 글 */
export function parseKakaoHeader(txt: string): KakaoHeader {
  const lines = String(txt || "").replace(/^\uFEFF/, "").split(/\r?\n/).slice(0, 5);
  let room = "";
  let savedAt = "";
  for (const l of lines) {
    const t = l.trim();
    if (!room) { const m = t.match(HEAD_ROOM); if (m) { room = m[1].trim(); continue; } }
    const s = t.match(HEAD_SAVED);
    if (s) savedAt = s[1].trim();
  }
  return { room, savedAt };
}

/** 본문 정규화(중복 키·검색용) — 앞뒤 공백, 줄 끝 공백, 연속 공백 */
export const normalizeBody = (s: string) => String(s || "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();

/**
 * TXT → 글 목록(가림 전). room 을 주면 그것, 없으면 파일 머리의 방 이름.
 * seq·dupN 은 이 파일 안에서 센다(조각으로 나눠 보내면 조각 안에서 — 조각은 날짜 띠 경계로 자른다).
 */
export function parseKakaoText(txt: string, room = ""): KakaoMessage[] {
  const src = String(txt || "").replace(/^\uFEFF/, "");
  const roomName = (room || parseKakaoHeader(src).room || "").trim();
  const lines = src.split(/\r?\n/);
  const out: KakaoMessage[] = [];
  let curDate = "";
  let last: KakaoMessage | null = null;
  const make = (date: string, time: string, author: string, text: string): KakaoMessage | null => {
    if (!date || !time) return null;
    const m: KakaoMessage = { room: roomName, date, time, sentAt: `${date}T${time}:00+09:00`, author: author.trim(), text, seq: 0, dupN: 0 };
    out.push(m);
    return m;
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) { if (last) last.text += "\n"; continue; }
    if (HEAD_SAVED.test(line.trim())) continue;

    const d = line.match(DOT);
    if (d) { curDate = ymd(d[1], d[2], d[3]); last = make(curDate, to24h(d[4], d[5], d[6]), d[7], d[8] || ""); continue; }
    const y = line.match(YMD_MSG);
    if (y) { curDate = ymd(y[1], y[2], y[3]); last = make(curDate, to24h(y[4], y[5], y[6]), y[7], y[8] || ""); continue; }
    const b = line.match(BRACKET);
    if (b) { last = make(curDate, to24h(b[2], b[3], b[4]), b[1], b[5] || ""); continue; }
    const bar = line.match(DATE_BAR) || line.match(DOT_BAR);
    if (bar) { curDate = ymd(bar[1], bar[2], bar[3]); last = null; continue; }
    if (SYSTEM.test(line.trim())) continue;
    if (last) last.text += `\n${line}`;
  }

  const minuteCount = new Map<string, number>();
  const sameCount = new Map<string, number>();
  const kept = out.filter((m) => { m.text = normalizeBody(m.text); return m.author !== "" && m.text !== ""; });
  for (const m of kept) {
    const mk = `${m.date} ${m.time}`;
    m.seq = (minuteCount.get(mk) || 0) + 1;
    minuteCount.set(mk, m.seq);
    const sk = `${mk}|${m.author}|${m.text.slice(0, 500)}`;
    m.dupN = (sameCount.get(sk) || 0) + 1;
    sameCount.set(sk, m.dupN);
  }
  return kept;
}

// ── 가림 ─────────────────────────────────────────────────────
const MOBILE = /(?<![\d-])(01[016789])([-.\s]?)(\d{3,4})([-.\s]?)(\d{4})(?![\d])/g;
const CARD_GROUPED = /(?<!\d)\d{4}([-\s])\d{4}\1\d{4}\1\d{4}(?![\d-])/g;
const CARD_PLAIN = /(?<![\d-])\d{16}(?![\d-])/g;
const CARD_LABEL = /카드/;
const ACCOUNT = /(계좌(?:번호)?\s*[:：]?\s*(?:[가-힣A-Za-z]{2,8}\s*)?)(\d[\d-]{6,22}\d)/g;

/** 룬 검사 — 붙은 16자리가 카드번호 모양인지 */
export function luhnOk(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return digits.length >= 12 && sum % 10 === 0;
}

const countRrnMasks = (s: string) => (s.match(/-\d\*{6}/g) || []).length;

/** 글 하나 가림 → { text, masked(가린 개수) } */
export function maskKakaoText(input: string): { text: string; masked: number } {
  let s = String(input ?? "");
  let masked = 0;
  // 1) 주민번호 — privacy.ts 규칙 그대로
  const before = countRrnMasks(s);
  s = maskRrn(s);
  masked += Math.max(0, countRrnMasks(s) - before);
  // 2) 카드번호 — 묶음형은 항상, 붙은 16자리는 이름표·룬 검사
  s = s.replace(CARD_GROUPED, (_m, sep: string) => { masked++; return ["****", "****", "****", "****"].join(sep); });
  s = s.replace(CARD_PLAIN, (m: string, offset: number, all: string) => {
    const near = all.slice(Math.max(0, offset - 12), offset);
    if (!CARD_LABEL.test(near) && !luhnOk(m)) return m;
    masked++;
    return "*".repeat(16);
  });
  // 3) 계좌번호 — 이름표 뒤 숫자, 끝 4자리만 남김
  s = s.replace(ACCOUNT, (_m, label: string, num: string) => {
    masked++;
    const keep = num.replace(/\D/g, "").slice(-4);
    return `${label}${num.slice(0, -4).replace(/\d/g, "*")}${keep}`;
  });
  // 4) 휴대폰 가운데 4자리
  s = s.replace(MOBILE, (_m, head: string, s1: string, _mid: string, s2: string, tail: string) => {
    masked++;
    return `${head}${s1 || "-"}****${s2 || "-"}${tail}`;
  });
  return { text: s, masked };
}

// ── 분류 추정(정규식만, AI 없음) ───────────────────────────────
const MEDIA = /^(?:사진(?:\s?\d+장)?|동영상|이모티콘|음성메시지|파일\s*[:：].*|보이스톡.*|페이스톡.*|삭제된 메시지입니다\.?)$/;
const SHARE = /\[FIELD\]|field[\w-]*\.vercel\.app|firstoa[\w-]*\.vercel\.app/i;
const FORM_KINDS: Array<[string, RegExp]> = [
  ["form:물류", /품목\s*[:：]|납품|철수|거래처명\s*\(지점/],
  ["form:불만접수", /불만/],
  ["form:계약갱신", /재계약|계약\s*갱신|재약정/],
  ["form:미수방문", /미수|미입금|보증금/],
  ["form:초과조정", /초과/],
  ["form:AS", /\bA\/?S\b|증상|처리\s*내용|고장/i],
  ["form:점검", /점검|매수|카운터|토너/],
];

/** 넣을 때 붙이는 분류 추정 — form:점검·form:AS·form:물류·form:불만접수·form:계약갱신·form:미수방문·form:초과조정·share·media·chat */
export function guessKind(text: string): string {
  const t = String(text || "").trim();
  if (MEDIA.test(t)) return "media";
  if (SHARE.test(t)) return "share";
  const labeled = (t.match(/^[^\n:：]{1,20}[:：]/gm) || []).length >= 3;
  if (labeled) for (const [k, rx] of FORM_KINDS) if (rx.test(t)) return k;
  return "chat";
}

// ── 중복 키 ──────────────────────────────────────────────────
/** 중복 키에 넣는 글 — 방 | 날짜 시:분 | 작성자 | 본문 앞 500자(정규화) | #n */
export function hashSource(m: Pick<KakaoMessage, "room" | "date" | "time" | "author" | "text" | "dupN">): string {
  const room = String(m.room || "").replace(/\s+/g, "");
  return `${room}|${m.date} ${m.time}|${m.author.trim()}|${normalizeBody(m.text).slice(0, 500)}|#${m.dupN}`;
}

/** SHA-256 16진수(Web Crypto — Deno·Node 18+·브라우저 공통) */
export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** kakao_messages 한 행(supabase/kakao-messages-20261024.sql) 중 파서가 채우는 칸 — kinds·region·is_bot·source·import_id 는 엣지가 붙인다 */
export type KakaoRow = {
  room: string; sent_at: string; seq: number; author: string; text: string;
  hash: string; kind_guess: string; masked: number; source_file: string | null;
};

/**
 * 넣을 행 만들기 — 가림 → 분류 추정 → 중복 키. 키는 가린 "뒤" 글로 계산한다(데이터실 권장):
 * 가리기 전 글로 해시하면 저장된 가린 글 + 해시로 가려진 숫자(휴대폰 4자리·주민 뒷자리)를 대입해 되찾을 수 있다.
 * 그래서 dupN 도 가린 글 기준으로 다시 센다(번호만 다른 두 글이 가린 뒤 같아지면 #1·#2 로 갈린다).
 * 가림 규칙을 바꾸면 그 규칙에 걸리는 글은 다음 적재에서 새 글로 한 번 더 들어간다 — 규칙은 함부로 바꾸지 않는다.
 */
export async function toRows(messages: KakaoMessage[], sourceFile = ""): Promise<{ rows: KakaoRow[]; masked: number }> {
  let masked = 0;
  const rows: KakaoRow[] = [];
  const same = new Map<string, number>();
  for (const m of messages) {
    const mk = maskKakaoText(m.text);
    const author = maskKakaoText(m.author).text;
    const text = mk.text.slice(0, 20000);
    const sk = `${m.room}|${m.date} ${m.time}|${author}|${normalizeBody(text).slice(0, 500)}`;
    const dupN = (same.get(sk) || 0) + 1;
    same.set(sk, dupN);
    const hash = await sha256Hex(hashSource({ room: m.room, date: m.date, time: m.time, author, text, dupN }));
    masked += mk.masked;
    rows.push({
      room: m.room, sent_at: m.sentAt, seq: m.seq, author, text,
      hash, kind_guess: guessKind(m.text), masked: Math.min(mk.masked, 32767), source_file: sourceFile || null,
    });
  }
  return { rows, masked };
}

/** UTF-8 바이트 수 — 한 요청 500KB 한도 판정 */
export const utf8Bytes = (s: string) => new TextEncoder().encode(String(s || "")).length;
export const MAX_INGEST_BYTES = 500 * 1024;
