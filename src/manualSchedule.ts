/**
 * 내 일정 직접 추가 — 스케줄 원문(번호 붙은 블록)을 일정 항목으로 푼다.
 * 워킨맵에 없는 곳(분기마감 방문 등)은 자동일정·워킨맵 [내 일정에 넣기]로는 넣을 길이 없어,
 * 원문을 그대로 붙여 넣으면 한 건씩 일정이 되게 한다(2026-09-15 요청).
 *
 * 블록 예 (줄 순서가 바뀌어도 된다 — 줄마다 생김새로 판별):
 *   1.마감/한공                                        ← 번호.구분/한틴이카
 *   16N웰스매니지먼트 주식회사-분기마감                ← 순번·등급 + 업체명 + "-"일정 꼬리
 *   010-9707-9066 허경무 매니저님(총괄)                ← 연락처(키맨)
 *   23093 / ECOSYS-M5526CDN / VUV0511991 / C1916       ← 임대순번 / 기종 / 기번 / 자산
 *   서울 강남구 역삼동 832-7 황화빌딩 1301호 ㄴ엘베유무 : 유 ← 주소 (+ 꼬리 메모)
 *   첫 분기마감                                        ← 나머지는 메모
 */
export type ManualScheduleEntry = {
  kind: string;        // 마감 · 점검 · AS · 여분 · 세팅 … (첫 줄 "1.마감/한공"의 마감)
  hantin: string;      // 첫 줄 "/" 뒤(한공·한조 등) — 한틴이카 상태
  grade: string;       // 업체 줄 머리 등급(N·V·S·SS·NN)
  vendor: string;      // 순번·등급·"-분기마감" 꼬리를 뗀 업체명
  title: string;       // "-" 뒤 일정 꼬리(분기마감·매월마감 등)
  phone: string;
  keyman: string;      // 연락처 줄 그대로("010-… 허경무 매니저님(총괄)")
  leaseNo: string;     // 기기 줄 첫 토큰(임대리스트 순번)
  model: string;
  serial: string;
  asset: string;
  address: string;
  addressNote: string; // "엘베유무 : 유" 같은 주소 꼬리
  memo: string;        // 분류되지 않은 나머지 줄
  raw: string;
};

const BLOCK_HEAD_RE = /^\s*\d+\s*\.\s*(?=[^\d\s])/; // "1.마감/한공" — "2025. 7. 23" 같은 날짜 줄은 제외
const PHONE_RE = /01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/;
const REGION_HEAD_RE = /^(서울|경기|인천|부산|대구|광주|대전|울산|세종|강원|충북|충남|충청|전북|전남|전라|경북|경남|경상|제주)/;
const ADDRESS_HINT_RE = /(특별시|광역시|[가-힣]{1,6}(시|구|군)\s+[가-힣]|[가-힣0-9]+(로|길)\s?\d|[가-힣]+동\s?\d)/;
const SCHEDULE_TAIL_RE = /(분기마감|매월마감|월말마감|매월방문|매주방문|매주마감|격주방문|격주마감|월말방문|분기점검|정기점검|USAGE TRACKER|USAGE)/i;
const ADDRESS_NOTE_CUT_RE = /\s*ㄴ|\s+\(?엘베/;

function splitBlocks(text: string): string[][] {
  const blocks: string[][] = [];
  let current: string[] | null = null;
  for (const rawLine of String(text || "").replace(/\r/g, "").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (BLOCK_HEAD_RE.test(line)) { current = [line]; blocks.push(current); continue; }
    if (!current) { current = [line]; blocks.push(current); continue; } // 번호 없이 시작한 원문도 한 블록으로
    current.push(line);
  }
  return blocks;
}

/** 업체 줄 → 등급·업체명·꼬리. "17, 17N주식회사 무암 (Mooam)-분기마감" → N / "주식회사 무암 (Mooam)" / "분기마감" */
export function parseVendorLine(line: string): { grade: string; vendor: string; title: string } {
  const trimmed = String(line || "").trim();
  // 순번(16 · "17, 17")과 등급(N·V·SS…)은 등급 뒤에 한글·괄호가 올 때만 뗀다 — "NH농협"·"3M코리아"는 그대로
  const m = trimmed.match(/^(?:\d+\s*,\s*)?\d*\s*#?(SS|NN|V|S|N)?(?=[가-힣(㈜[]|\s|$)\s*(.*)$/i);
  const grade = m ? (m[1] || "").toUpperCase() : "";
  let rest = m ? m[2].trim() : trimmed;
  let title = "";
  const tail = rest.match(SCHEDULE_TAIL_RE);
  if (tail && tail.index !== undefined && tail.index > 0) {
    title = rest.slice(tail.index).trim();
    rest = rest.slice(0, tail.index);
  }
  const vendor = rest.replace(/[\s\-–—·,/／]+$/g, "").replace(/\s{2,}/g, " ").trim();
  return { grade, vendor, title };
}

function isDeviceLine(line: string): boolean {
  if (PHONE_RE.test(line)) return false;
  const parts = line.split(/\s*[/／]\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return false;
  // 기종·기번 토큰은 영문+숫자가 섞인다 (ECOSYS-M5526CDN · VUV0511991 · C1916)
  return parts.some((p) => /[A-Za-z]/.test(p) && /\d/.test(p));
}

function isAddressLine(line: string): boolean {
  return REGION_HEAD_RE.test(line) || ADDRESS_HINT_RE.test(line);
}

function parseBlock(lines: string[]): ManualScheduleEntry | null {
  const entry: ManualScheduleEntry = {
    kind: "", hantin: "", grade: "", vendor: "", title: "", phone: "", keyman: "", leaseNo: "",
    model: "", serial: "", asset: "", address: "", addressNote: "", memo: "", raw: lines.join("\n"),
  };
  const body = [...lines];
  if (body.length && BLOCK_HEAD_RE.test(body[0])) {
    const head = body.shift()!.replace(BLOCK_HEAD_RE, "").trim();
    const [kind, ...restHead] = head.split(/\s*[/／]\s*/);
    entry.kind = (kind || "").trim();
    entry.hantin = restHead.join("/").trim();
  }
  const memo: string[] = [];
  let vendorTaken = false;
  for (const line of body) {
    if (!entry.phone && PHONE_RE.test(line)) {
      entry.phone = (line.match(PHONE_RE)?.[0] || "").replace(/[.\s]/g, "-");
      entry.keyman = line;
      continue;
    }
    if (!entry.model && isDeviceLine(line)) {
      const parts = line.split(/\s*[/／]\s*/).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 4) { [entry.leaseNo, entry.model, entry.serial, entry.asset] = parts; }
      else if (parts.length === 3) { [entry.model, entry.serial, entry.asset] = parts; }
      else { [entry.model, entry.serial] = parts; }
      continue;
    }
    if (!vendorTaken) {
      // 헤더 바로 다음 줄이 업체명 — 주소처럼 보여도 업체가 먼저 온다는 관행을 따른다
      Object.assign(entry, parseVendorLine(line));
      vendorTaken = true;
      continue;
    }
    if (!entry.address && isAddressLine(line)) {
      const cut = line.search(ADDRESS_NOTE_CUT_RE);
      if (cut > 0) {
        entry.address = line.slice(0, cut).trim();
        entry.addressNote = line.slice(cut).replace(/^[\sㄴ(]+/, "").replace(/\)$/, "").trim();
      } else {
        entry.address = line;
      }
      continue;
    }
    memo.push(line);
  }
  entry.memo = memo.join("\n");
  if (!entry.vendor) return null;
  return entry;
}

/** 원문 전체 → 일정 항목 목록. 업체명을 못 읽은 블록은 버린다. */
export function parseManualSchedules(text: string): ManualScheduleEntry[] {
  return splitBlocks(text).map(parseBlock).filter((e): e is ManualScheduleEntry => e !== null);
}
