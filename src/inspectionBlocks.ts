/**
 * 점검 양식의 기기 블록 판정 — 구분선·번호 줄·"기기가 아닌 메모 블록" 규칙.
 * App.tsx(변환기·폼 병합)와 테스트가 같은 함수를 쓴다.
 */

// Divider characters seen in the wild: hyphen/underscore, ㅡ(U+3161), box drawing (═ ─ ━ ⎼), dashes (― — –)
export const DIVIDER_CHAR_CLASS = "[-_\\u3161\\u2550\\u2500\\u2501\\u23BC\\u2015\\u2014\\u2013]";
export const DIVIDER_LINE_REGEX = new RegExp(`^\\s*${DIVIDER_CHAR_CLASS}{3,}\\s*$`);

export function isDividerLine(line: string): boolean {
  return DIVIDER_LINE_REGEX.test(line);
}

const DEVICE_FIELD_RE = /^\s*(모델명|시리얼넘버|자산기번|내용|처리내용|매수|토너잔량|폐통|여분|한틴이카유무|주차비지원유무|특이사항)\s*:/;
const NOTE_KEYWORD_RE = /(통합|여분|토너|드럼|폐통|공용)\s*보관|보관\s*(위치|장소|함|중)|비고|메모|참고|캐비넷|케비넷|캐비닛|창고/;

/**
 * "12.토너 통합보관(C0003 좌측 캐비넷…)"처럼 번호는 붙었지만 기기가 아닌 메모 블록인가.
 * 기기 칸(모델명·시리얼넘버·처리내용…)이 하나도 없고 보관·여분·창고 같은 낱말이 있으면 메모로 본다.
 * 예전엔 이것도 기기로 세어 빈 기기 양식으로 바꾸고 아래 줄(5473 / K3 C3 M3 Y1…)을 버렸다(2026-09-16 아시아프라퍼티).
 */
export function isSpareNoteBlock(lines: string[]): boolean {
  const body = lines.map((line) => line.trim()).filter((line) => line && !isDividerLine(line));
  if (!body.length || !/^\d+\./.test(body[0])) return false;
  if (body.some((line) => DEVICE_FIELD_RE.test(line))) return false;
  return NOTE_KEYWORD_RE.test(body.join("\n"));
}

/** 번호 줄(start)부터 다음 구분선·※ 전까지의 블록 */
function blockFrom(lines: string[], start: number): string[] {
  const out: string[] = [];
  for (let j = start; j < lines.length; j += 1) {
    if (j > start && (isDividerLine(lines[j]) || /^※/.test(lines[j]))) break;
    out.push(lines[j]);
  }
  return out;
}

/**
 * 어느 줄이 새 기기의 시작인가 — 구분선 바로 다음의 번호 줄만 인정한다
 * (처리내용/특이사항 안의 "2.토너교체"가 기기로 잡히지 않게). 번호 줄이라도 메모 블록이면 기기로 세지 않는다.
 */
export function itemStartFlags(lines: string[]): boolean[] {
  const flags: boolean[] = new Array(lines.length).fill(false);
  let prevDivider = false;
  lines.forEach((line, i) => {
    if (isDividerLine(line)) { prevDivider = true; return; }
    if (line.trim() === "") return;
    if (prevDivider && /^\s*\d+\./.test(line) && !/※/.test(line) && !isSpareNoteBlock(blockFrom(lines, i))) flags[i] = true;
    prevDivider = false;
  });
  return flags;
}
