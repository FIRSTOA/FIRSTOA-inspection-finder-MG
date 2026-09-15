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
const DEVICE_ID_FILLED_RE = /^\s*(모델명|시리얼넘버|자산기번)\s*:\s*\S/;
const NOTE_KEYWORD_RE = /(통합|여분|토너|드럼|폐통|공용)\s*보관|보관\s*(위치|장소|함|중)|비고|메모|참고|캐비넷|케비넷|캐비닛|창고/;
// "450 토너 K 6 C 8 M 10 Y 7 폐 5", "5700 토너 3 드럼 3" — 기종별 재고를 줄줄이 적은 모양(기본값 "K- C-"는 숫자가 없어 안 걸린다)
const INVENTORY_RE = /토너\s*(?:[KCMY]\s*)?\d|드럼\s*\d|폐(?:통)?\s*\d|K\s*\d+\s*,?\s*C\s*\d+/i;

/**
 * 번호는 붙었지만 기기가 아닌 메모 블록인가.
 *  ① 기기 칸(모델명·시리얼넘버·처리내용…)이 하나도 없고 보관·여분·창고 낱말이 있으면 메모
 *     — "12.토너 통합보관(C0003 좌측 캐비넷…)" + 기종별 수량 (2026-09-16 아시아프라퍼티)
 *  ② 기기 칸은 있지만 모델명·시리얼넘버·자산기번이 전부 비어 있고, 창고·보관 낱말이나 재고 줄이 있으면 메모
 *     — "13. 14층 창고" + 처리내용에 "450 토너 K 6 C 8 …" (2026-09-16 휴스틸). 식별칸이 하나라도 차 있으면 기기.
 * 예전엔 둘 다 기기로 세어 빈 양식으로 바꾸고 처리내용·아래 줄을 버렸다.
 */
export function isSpareNoteBlock(lines: string[]): boolean {
  const body = lines.map((line) => line.trim()).filter((line) => line && !isDividerLine(line));
  if (!body.length || !/^\d+\./.test(body[0])) return false;
  const text = body.join("\n");
  const hasDeviceField = body.some((line) => DEVICE_FIELD_RE.test(line));
  if (!hasDeviceField) return NOTE_KEYWORD_RE.test(text);
  if (body.some((line) => DEVICE_ID_FILLED_RE.test(line))) return false;
  return NOTE_KEYWORD_RE.test(text) || INVENTORY_RE.test(text);
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

/** 구분선 바로 다음의 번호 줄 자리(기기 시작 후보) */
function numberedStarts(lines: string[]): boolean[] {
  const flags: boolean[] = new Array(lines.length).fill(false);
  let prevDivider = false;
  lines.forEach((line, i) => {
    if (isDividerLine(line)) { prevDivider = true; return; }
    if (line.trim() === "") return;
    if (prevDivider && /^\s*\d+\./.test(line) && !/※/.test(line)) flags[i] = true;
    prevDivider = false;
  });
  return flags;
}

/**
 * 어느 줄이 새 기기의 시작인가 — 구분선 바로 다음의 번호 줄만 인정한다
 * (처리내용/특이사항 안의 "2.토너교체"가 기기로 잡히지 않게). 번호 줄이라도 메모 블록이면 기기로 세지 않는다.
 */
export function itemStartFlags(lines: string[]): boolean[] {
  const starts = numberedStarts(lines);
  return starts.map((flag, i) => flag && !isSpareNoteBlock(blockFrom(lines, i)));
}

/**
 * 메모 블록에 속한 줄 표시 — 폼 파싱·병합은 이 줄들을 건너뛰어야 한다.
 * (메모 블록 안의 빈 "모델명:" 줄이 앞 기기의 모델명을 지워 버리는 사고 방지)
 */
export function noteBlockLineFlags(lines: string[]): boolean[] {
  const flags: boolean[] = new Array(lines.length).fill(false);
  const starts = numberedStarts(lines);
  starts.forEach((flag, i) => {
    if (!flag) return;
    const block = blockFrom(lines, i);
    if (!isSpareNoteBlock(block)) return;
    for (let j = 0; j < block.length; j += 1) flags[i + j] = true;
  });
  return flags;
}
