/**
 * 카운터 문자전송 — 카톡 원문 파서 (직원 원본 프로젝트의 정규식 규칙을 그대로 이식)
 * 블록 분리 → 업체명·등급 → 연락처(이름/직함) → 기종 매칭 → 번호 기준 그룹 병합 → 문구 생성.
 */
import { EXCLUDE_FROM_LOOSE_MATCH, TXT_DEFAULT } from "./counterSmsData";

const TITLE_LIST = [
  "회장", "부회장", "사장", "부사장", "대표이사", "대표", "전무이사", "전무",
  "상무이사", "상무", "본부장", "부서장", "실장", "팀장", "부장", "차장", "과장",
  "대리", "주임", "사원", "이사", "원장", "점장", "점주", "매니저", "소장", "계장",
  "담당자", "담당", "선생", "박사", "사모", "여사", "회계", "경리",
];
const TITLE_RE = `(?:${TITLE_LIST.join("|")})(?:님)?`;
const NAME_RE = "[가-힣]{2,4}";
const PHONE_RE = /01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/g;

const NON_NAME_WORDS = new Set([
  "분기마감", "매월마감", "매월방문", "매주방문", "매주마감", "격주방문",
  "격주마감", "월말마감", "월말방문", "분기", "마감", "방문", "매월",
  "매주", "격주", "월말", "계약", "결제", "영업", "관리", "인쇄", "출력", "점검", "신규",
  "갱신", "해지", "카운터", "문자", "자료", "발송", "확인", "안내", "미수", "부착", "미부착",
  "유지보수", "유지", "보수", "서비스", "오른쪽", "왼쪽", "비서실", "회의실", "사무실", "관리실",
  "영업실", "본사", "지사", "지점", "매장", "연락처", "전화", "핸드폰", "전화번호", "대표번호",
  "연락", "문의", "담당자", "복합기", "키맨", "경영", "재무", "인사", "총무", "구매", "생산",
  "품질", "기술", "연구", "개발", "기획", "전산", "시설", "경비",
]);

export type GradeGroup = "v_group" | "s_group";
export type ParsedContact = { phone: string; label: string };
export type ParsedBlock = {
  index: number;
  raw: string;
  vendor: string;      // "N 주식회사 무암" 형태 (등급 접두)
  gradeGroup: GradeGroup;
  contacts: ParsedContact[];
  machine: string;
};
export type MergedTarget = {
  key: string;
  vendor: string;          // 대표 업체명
  gradeGroup: GradeGroup;
  phones: string[];
  labels: Record<string, string>;
  machines: string[];      // 중복 포함 (대수 계산용)
  vendorNames: string[];   // 통합된 지점·위치 이름들
};

function nameAfter(after: string): string | null {
  const stripped = after.replace(/^[\s:\-/,·()]+/, "");
  for (const len of [3, 2, 4]) {
    if (stripped.length < len) continue;
    const cand = stripped.slice(0, len);
    if (!new RegExp(`^[가-힣]{${len}}$`).test(cand)) continue;
    if (len < stripped.length && /[가-힣]/.test(stripped[len])) continue;
    if (!NON_NAME_WORDS.has(cand)) return cand;
  }
  return null;
}

function nameBefore(before: string): string | null {
  const stripped = before.replace(/[\s:\-/,·()]+$/, "");
  for (const len of [3, 2, 4]) {
    if (stripped.length < len) continue;
    const cand = stripped.slice(stripped.length - len);
    if (!new RegExp(`^[가-힣]{${len}}$`).test(cand)) continue;
    if (len < stripped.length && /[가-힣]/.test(stripped[stripped.length - len - 1])) continue;
    if (!NON_NAME_WORDS.has(cand)) return cand;
  }
  return null;
}

/** 첫 줄에서 등급·업체명 분리 (원본 parse_company_and_grade) */
export function parseCompanyAndGrade(firstLine: string): { gradeGroup: GradeGroup; vendor: string } {
  if (!firstLine) return { gradeGroup: "s_group", vendor: "거래처 확인 바람" };
  let rawGrade = "";
  let rawName = firstLine;
  const m = firstLine.match(/^\d+(?:\s*,\s*)\d*([a-zA-Z]+)?(.*)/);
  if (m) {
    rawGrade = (m[1] || "").toUpperCase();
    rawName = (m[2] || "").trim();
  } else {
    const alt = firstLine.match(/^(V|SS|S|NN|N)(.+)$/i);
    if (alt) {
      rawGrade = alt[1].toUpperCase();
      rawName = alt[2].trim();
    }
  }
  const gradeGroup: GradeGroup = rawGrade === "V" || rawGrade === "SS" ? "v_group" : "s_group";
  let name = rawName.split(/[/／]/)[0];
  const scheduleKeywords = ["매월마감", "매월방문", "매주방문", "매주마감", "격주방문", "격주마감", "월말마감", "월말방문", "분기마감", "USAGE TRACKER", "USAGE"];
  let earliest = name.length;
  for (const kw of scheduleKeywords) {
    const idx = name.indexOf(kw);
    if (idx >= 0 && idx < earliest) earliest = idx;
  }
  if (earliest < name.length) name = name.slice(0, earliest);
  name = name.replace(/[\s·,]+$/, "").trim();
  return { gradeGroup, vendor: rawGrade ? `${rawGrade} ${name}`.trim() : name };
}

/** 블록에서 연락처 + 이름/직함 라벨 추출 (원본 extract_contacts — 6단계 폴백 순서 유지) */
export function extractContacts(block: string): ParsedContact[] {
  const matches = [...block.matchAll(PHONE_RE)];
  const seen = new Set<string>();
  const out: ParsedContact[] = [];
  matches.forEach((m, idx) => {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const clean = m[0].replace(/[^0-9]/g, "");
    if (seen.has(clean)) return;
    seen.add(clean);
    const prevEnd = idx > 0 ? (matches[idx - 1].index ?? 0) + matches[idx - 1][0].length : Math.max(0, start - 60);
    const before = block.slice(prevEnd, start);
    const nextStart = idx + 1 < matches.length ? (matches[idx + 1].index ?? block.length) : Math.min(block.length, end + 40);
    const after = block.slice(end, nextStart);

    let label = "";
    let mm = after.match(new RegExp(`^\\s*[:\\-\\s/,·()]*\\s*(${NAME_RE})\\s*(${TITLE_RE})`));
    if (mm && !NON_NAME_WORDS.has(mm[1])) label = `${mm[1]} ${mm[2]}`;
    if (!label) {
      mm = before.match(new RegExp(`(?:^|[\\s/,:·\\-()])(${NAME_RE})\\s*(${TITLE_RE})\\s*[:\\-\\s/()]*$`));
      if (mm && !NON_NAME_WORDS.has(mm[1])) label = `${mm[1]} ${mm[2]}`;
    }
    if (!label) {
      mm = after.match(new RegExp(`^\\s*[:\\-\\s/,·()]*\\s*(${TITLE_RE})\\s+(${NAME_RE})`));
      if (mm && !NON_NAME_WORDS.has(mm[2])) label = `${mm[2]} ${mm[1]}`;
    }
    if (!label) {
      mm = before.match(new RegExp(`(${TITLE_RE})\\s+(${NAME_RE})\\s*[:\\-\\s/()]*$`));
      if (mm && !NON_NAME_WORDS.has(mm[2])) label = `${mm[2]} ${mm[1]}`;
    }
    if (!label) label = nameAfter(after) || "";
    if (!label) label = nameBefore(before) || "";
    if (!label) {
      mm = after.match(new RegExp(`^\\s*[:\\-\\s/,·()]*\\s*(${TITLE_RE})`));
      if (mm) label = mm[1];
    }
    if (!label) {
      mm = before.match(new RegExp(`(?:^|[\\s/,:·\\-()])(${TITLE_RE})\\s*[:\\-\\s/()]*$`));
      if (mm) label = mm[1];
    }
    out.push({ phone: clean, label });
  });
  return out;
}

/** 기종 매칭 (원본 우선순위 체인 그대로) */
export function matchMachine(block: string, machineKeys: string[]): string {
  const b = block.toLowerCase();
  if (b.includes("2101") || b.includes("ma2101") || b.includes("ma-2101")) return "MA2101";
  if (b.includes("2100") || b.includes("ma2100") || b.includes("ma-2100")) return "MA2100";
  if (b.includes("mx6") || b.includes("mx-6")) return "Mx6";
  if (b.includes("3250")) return "K3250";
  if (b.includes("3220")) return "X3220NR";
  if (b.includes("9201")) return "X-9201";
  if (/[xk]-?4\d{3}/.test(b) || b.includes("x4") || b.includes("k4")) return "X4-시리즈";
  if (/[xk]-?7\d{3}/.test(b) || b.includes("x7") || b.includes("k7")) return "X7-시리즈";
  if (b.includes("sl-")) return "SL-";
  if (b.includes("hp")) return "HP";
  // 신도리코 D410/D420 등이 렉스마크 410으로 오탐되던 것 방지 — D 접두를 먼저 확인
  if (/\bd-?4[1256]0\b/.test(b) || /\bd-?[34]\d{2}\b/.test(b)) {
    const hit = machineKeys.find((k) => /^D\d{3}$/.test(k) && b.includes(k.toLowerCase()));
    if (hit) return hit;
  }
  if (/(?:^|[^\d])410(?:[^\d]|$)/.test(b) && !/[dnxk]-?410/.test(b)) return "410";
  if (b.includes("lexmark") || b.includes("렉스마크")) return "Lexmark";
  if (b.includes("mp-c2003") || b.includes("c2003")) return "C3003";
  for (const key of machineKeys) {
    if (!EXCLUDE_FROM_LOOSE_MATCH.has(key) && b.includes(key.toLowerCase())) return key;
  }
  return "기본 기종";
}

/** 원문을 업체 블록으로 분리 (원본: 숫자+콤마로 시작하는 줄이 새 블록) */
export function splitBlocks(rawText: string): string[] {
  const lines = rawText.split("\n");
  const blocks: string[] = [];
  let cur: string[] = [];
  const isHead = (line: string) => /^\s*\d+\s*,\s*/.test(line);
  for (const line of lines) {
    if (isHead(line)) {
      if (cur.join("\n").trim()) blocks.push(cur.join("\n").trim());
      cur = [line];
    } else {
      cur.push(line);
    }
  }
  if (cur.join("\n").trim()) blocks.push(cur.join("\n").trim());
  const valid = blocks.filter((b) => b.trim().length > 5 && /^\s*\d+\s*,\s*/.test(b));
  return valid.length ? valid : (rawText.trim() ? [rawText.trim()] : []);
}

export function parseBlocks(rawText: string, machineKeys: string[]): ParsedBlock[] {
  return splitBlocks(rawText).map((raw, i) => {
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    const { gradeGroup, vendor } = parseCompanyAndGrade(lines[0] || "");
    return { index: i + 1, raw, vendor, gradeGroup, contacts: extractContacts(raw), machine: matchMachine(raw, machineKeys) };
  });
}

/** 같은 번호(+같은 등급군)면 한 통으로 병합 — 원본 grouped 로직 */
export function mergeTargets(blocks: ParsedBlock[]): MergedTarget[] {
  const groups = new Map<string, MergedTarget>();
  const phoneToKey = new Map<string, string>();
  let noPhoneSeq = 0;
  for (const b of blocks) {
    const phones = b.contacts.map((c) => c.phone);
    let key = "";
    for (const p of phones) {
      const hit = phoneToKey.get(`${b.gradeGroup}_${p}`);
      if (hit) { key = hit; break; }
    }
    if (!key) key = phones.length ? `${b.gradeGroup}_${b.vendor}` : `NOPHONE_${b.gradeGroup}_${++noPhoneSeq}`;
    if (!groups.has(key)) {
      groups.set(key, { key, vendor: b.vendor, gradeGroup: b.gradeGroup, phones: [], labels: {}, machines: [], vendorNames: [] });
    }
    const g = groups.get(key)!;
    for (const c of b.contacts) {
      if (!g.phones.includes(c.phone)) g.phones.push(c.phone);
      if (c.label && !g.labels[c.phone]) g.labels[c.phone] = c.label;
      phoneToKey.set(`${b.gradeGroup}_${c.phone}`, key);
    }
    g.machines.push(b.machine);
    if (!g.vendorNames.includes(b.vendor)) g.vendorNames.push(b.vendor);
  }
  return [...groups.values()];
}

/** 등급군별 문구 생성 (원본 build_message_by_grade) */
export function buildMessage(machines: string[], formats: Record<string, string>, templates: Record<string, string>, gradeGroup: GradeGroup): string {
  const counts = new Map<string, number>();
  for (const m of machines) counts.set(m, (counts.get(m) || 0) + 1);
  const models = [...counts.keys()];
  const total = machines.length;
  const prefix = gradeGroup === "v_group" ? "v_" : "s_";
  const singleClosing = templates[`${prefix}single_closing`] || "";

  if (models.length === 1 && total === 1) {
    const m = models[0];
    const how = formats[m] || TXT_DEFAULT;
    // 문구 자체가 완결형(인사말 포함)인 기종은 템플릿을 덧붙이지 않는다 — 원본 동작
    if (how.includes("안녕하세요") || how.includes("사용량확인차")) return `${how}\n(기종: ${m})\n${singleClosing}`;
    const greeting = templates[`${prefix}single_greeting`] || "";
    return `${greeting}\n\n▶ 기종: ${m}\n▶ 방법: ${how}\n\n${singleClosing}`;
  }

  const greeting = (templates[`${prefix}multi_greeting`] || "").replace(/\{total\}/g, String(total));
  const closing = templates[`${prefix}multi_closing`] || "";
  const lines: string[] = [greeting, ""];
  let idx = 0;
  for (const [m, count] of counts) {
    idx += 1;
    const how = formats[m] || TXT_DEFAULT;
    lines.push(`▶ 기종${idx}: ${m}${count > 1 ? ` (${count}대)` : ""}`);
    lines.push(`    방법: ${how}\n`);
  }
  lines.push(closing);
  return lines.join("\n");
}

export function formatPhone(phone: string): string {
  return phone.length === 11 ? `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}` : phone;
}
