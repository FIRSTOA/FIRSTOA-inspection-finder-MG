/**
 * 재계약 준비 — 데이터 조회.
 *
 * 방문 대상은 우리가 새로 만들지 않는다. **워킨맵의 현분기 재계약 목록이 곧 대상**이다
 * (workin_map_places · kind=renewal · quarter=현분기). 임대리스트 종료일로 따로 뽑으면
 * 워킨맵과 다른 목록이 나와 "이 업체 왜 여기 있냐"가 된다.
 *
 * CS가 방문하는 등급만 남긴다 — S(일반프로+부파트장)·SS(팀장급). V는 영업부 관할이라 뺀다.
 * 라벨 G5(완료)·G6·G7(영업부)·G12(이관)도 이번 분기 방문 대상이 아니다.
 *
 * 이력은 이미 있는 원장에서 모아 붙인다(새로 적재하는 것 없음):
 *   misu(미수) · overage(초과료) · bulman(불만) · as_records(AS) · recontract(과거 재계약 협상)
 *
 * 업체 묶기는 vendorMatchKey — 같은 업체의 지점 여러 곳(401호·405호)이 한 카드로 모여야
 * 대장 한 장으로 분석이 된다. 앱 다른 곳과 같은 키라 판정이 어긋나지 않는다.
 */
import { selectAllRows, selectRows } from "../supabase";
import { vendorMatchKey, workinVendorName } from "../ids";
import {
  RENEWAL_DONE_LABELS, RENEWAL_LABEL_DESC, addressGroupKey, currentQuarter, renewalEndYmd, renewalGrade,
  type Quarter,
} from "../workinPlaces";

/** 한글·기호 섞인 컬럼명을 PostgREST select에 안전하게 싣는다 */
function cols(...names: string[]) {
  return names.map((name) => encodeURIComponent(/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) ? name : `"${name}"`)).join(",");
}
const enc = encodeURIComponent;

/** "60000"·"1,200,000"·빈값 → 숫자. 임대리스트 금액은 문자열로 들어 있다 */
export function won(value: unknown): number {
  const digits = String(value ?? "").replace(/[^0-9.-]/g, "");
  const num = Number(digits);
  return Number.isFinite(num) ? num : 0;
}

/** KST 오늘 (YYYY-MM-DD) — UTC로 찍으면 밤에 하루 밀린다 */
export function kstToday(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** 오늘부터 months개월 뒤 (YYYY-MM-DD) */
export function ymdAfterMonths(months: number): string {
  const now = new Date(Date.now() + 9 * 3600_000);
  const moved = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, now.getUTCDate()));
  return moved.toISOString().slice(0, 10);
}

/** 종료일까지 남은 날 (음수면 이미 지남) */
export function ddayOf(ymd: string): number {
  const target = Date.parse(`${String(ymd).slice(0, 10)}T00:00:00+09:00`);
  if (!Number.isFinite(target)) return 9999;
  const today = Date.parse(`${kstToday()}T00:00:00+09:00`);
  return Math.round((target - today) / 86_400_000);
}

/** "2026.8.11"·"2026-08-11"·"26-9-16" 혼재 → YYYY-MM-DD (원장마다 표기가 다르다) */
export function normalizeYmd(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const m = raw.match(/(\d{2,4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!m) return "";
  const year = m[1].length === 2 ? `20${m[1]}` : m[1];
  return `${year}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

export type RcDevice = {
  id: number;
  vendor: string;
  순번: string;
  등급: string;
  구: string;
  품목: string;
  계약일: string;
  종료일: string;
  남은개월: string;
  계약기간: string;
  월렌탈료: number;
  연평균: number;
  모델명: string;
  기종: string;
  제조사: string;
  자산번호: string;
  기번: string;
  추가컬: string;
  추가흑: string;
  추가조건: string;
  누적방식: string;
};

/** 재계약 대상 품목 — 복합기 계열만. PC·노트북·세단기·공기청정기는 재계약 방문 건이 아니다 */
export function isCopier(품목: string, 기종 = ""): boolean {
  const text = `${품목} ${기종}`;
  return /복합기/.test(text);
}

const LEASE_COLS = cols(
  "id", "_업체명", "순번", "등급", "시/구", "품목", "계약일", "종료일", "남은개월", "계약기간",
  "기본금액", "연평균", "모델명", "기종", "제조사", "자산번호", "기번", "추가(컬)", "추가(흑)",
  "추가조건", "누적방식 (월/분/반/년)",
);

function toDevice(row: Record<string, unknown>): RcDevice {
  const pick = (key: string) => String(row[key] ?? "").trim();
  return {
    id: Number(row.id) || 0,
    vendor: pick("_업체명"),
    순번: pick("순번"),
    등급: pick("등급"),
    구: pick("시/구"),
    품목: pick("품목"),
    계약일: pick("계약일"),
    종료일: pick("종료일"),
    남은개월: pick("남은개월"),
    계약기간: pick("계약기간"),
    월렌탈료: won(row["기본금액"]),
    연평균: won(row["연평균"]),
    모델명: pick("모델명"),
    기종: pick("기종"),
    제조사: pick("제조사"),
    자산번호: pick("자산번호"),
    기번: pick("기번"),
    추가컬: pick("추가(컬)"),
    추가흑: pick("추가(흑)"),
    추가조건: pick("추가조건"),
    누적방식: pick("누적방식 (월/분/반/년)"),
  };
}

// ─── 신호(미수·초과·불만·AS·과거 재계약) ────────────────────────────────────
// 업체별로 따로 조회하면 281곳에 요청 281번이다. 경량 컬럼으로 한 번에 받아 키로 색인한다.

export type MisuSignal = { 개월: number; 잔액: number; 약속일: string; 최근일: string };
export type OverageSignal = { 건수: number; 최근합계: number; 최근일: string; 기본매수: string; 초과단가: string };
export type CountSignal = { 건수: number; 최근일: string };
export type RcHistoryRow = {
  id: number; 날짜: string; 작성자: string; 갱신상태: string; 갱신위험도: string;
  최종상태: string; 제안조건: string; 관리포인트: string; 다음확인일: string; 원문: string;
};

export type RcSignals = {
  misu?: MisuSignal;
  overage?: OverageSignal;
  bulman?: CountSignal;
  as?: CountSignal;
  history?: { 건수: number; 최근일: string; 갱신상태: string; 갱신위험도: string; 최종상태: string };
};

type SignalIndex = Map<string, RcSignals>;
let signalCache: { at: number; promise: Promise<SignalIndex> } | null = null;
const SIGNAL_TTL = 5 * 60_000;

/** 신호 색인 (업체키 → 신호). 5분 캐시 — 목록에서 반복 사용된다 */
export function getSignalIndex(force = false): Promise<SignalIndex> {
  if (!force && signalCache && Date.now() - signalCache.at < SIGNAL_TTL) return signalCache.promise;
  const promise = buildSignalIndex();
  signalCache = { at: Date.now(), promise };
  promise.catch(() => { signalCache = null; }); // 실패는 캐시하지 않는다
  return promise;
}

export function clearSignalCache() { signalCache = null; }

async function buildSignalIndex(): Promise<SignalIndex> {
  const since = ymdAfterMonths(-18); // AS·불만은 최근 18개월만 — 오래된 건 재계약 판단에 쓰지 않는다
  const safe = async <T>(run: Promise<T[]>): Promise<T[]> => { try { return await run; } catch { return []; } };
  const [misu, overage, bulman, asRows, history] = await Promise.all([
    safe(selectAllRows<Record<string, unknown>>("misu",
      `select=${cols("_업체명", "입력일", "미수개월", "미수잔액", "입금약속일")}&order=id.asc`)),
    safe(selectAllRows<Record<string, unknown>>("overage",
      `select=${cols("_업체명", "날짜", "합계", "기본매수", "초과장당금액")}&order=id.asc`)),
    safe(selectAllRows<Record<string, unknown>>("bulman",
      `select=${cols("_업체명", "날짜")}&${enc("날짜")}=gte.${since}&order=id.asc`)),
    safe(selectAllRows<Record<string, unknown>>("as_records",
      `select=${cols("_업체명", "작성일")}&${enc("작성일")}=gte.${since}&order=id.asc`)),
    safe(selectAllRows<Record<string, unknown>>("recontract",
      `select=${cols("_업체명", "날짜", "갱신상태", "갱신위험도", "최종상태")}&order=id.asc`)),
  ]);

  const index: SignalIndex = new Map();
  const slot = (vendor: unknown): RcSignals | null => {
    const key = vendorMatchKey(String(vendor ?? ""));
    if (!key) return null;
    const found = index.get(key);
    if (found) return found;
    const fresh: RcSignals = {};
    index.set(key, fresh);
    return fresh;
  };

  for (const row of misu) {
    const bucket = slot(row["_업체명"]);
    if (!bucket) continue;
    const date = normalizeYmd(row["입력일"]);
    const months = won(row["미수개월"]);
    const prev = bucket.misu;
    // 같은 업체 여러 건이면 최근 것으로 — 미수는 "지금 상태"가 중요하다
    if (!prev || date > prev.최근일) {
      bucket.misu = { 개월: months, 잔액: won(row["미수잔액"]), 약속일: normalizeYmd(row["입금약속일"]), 최근일: date };
    }
  }
  for (const row of overage) {
    const bucket = slot(row["_업체명"]);
    if (!bucket) continue;
    const date = normalizeYmd(row["날짜"]);
    const prev = bucket.overage;
    const latest = !prev || date > prev.최근일;
    bucket.overage = {
      건수: (prev?.건수 || 0) + 1,
      최근합계: latest ? won(row["합계"]) : (prev?.최근합계 || 0),
      최근일: latest ? date : (prev?.최근일 || ""),
      기본매수: latest ? String(row["기본매수"] ?? "").trim() : (prev?.기본매수 || ""),
      초과단가: latest ? String(row["초과장당금액"] ?? "").trim() : (prev?.초과단가 || ""),
    };
  }
  const bump = (bucket: RcSignals, field: "bulman" | "as", date: string) => {
    const prev = bucket[field];
    bucket[field] = { 건수: (prev?.건수 || 0) + 1, 최근일: date > (prev?.최근일 || "") ? date : (prev?.최근일 || "") };
  };
  for (const row of bulman) {
    const bucket = slot(row["_업체명"]);
    if (bucket) bump(bucket, "bulman", normalizeYmd(row["날짜"]));
  }
  for (const row of asRows) {
    const bucket = slot(row["_업체명"]);
    if (bucket) bump(bucket, "as", normalizeYmd(row["작성일"]));
  }
  for (const row of history) {
    const bucket = slot(row["_업체명"]);
    if (!bucket) continue;
    const date = normalizeYmd(row["날짜"]);
    const prev = bucket.history;
    const latest = !prev || date > prev.최근일;
    bucket.history = {
      건수: (prev?.건수 || 0) + 1,
      최근일: latest ? date : (prev?.최근일 || ""),
      // 상태는 최근 기록의 것 — 옛 시트 유입분은 이 칸이 비어 있어 빈값이면 앞의 값을 지킨다
      갱신상태: latest ? (String(row["갱신상태"] ?? "").trim() || prev?.갱신상태 || "") : (prev?.갱신상태 || ""),
      갱신위험도: latest ? (String(row["갱신위험도"] ?? "").trim() || prev?.갱신위험도 || "") : (prev?.갱신위험도 || ""),
      최종상태: latest ? (String(row["최종상태"] ?? "").trim() || prev?.최종상태 || "") : (prev?.최종상태 || ""),
    };
  }
  return index;
}

/** 이력 배지 — 방문 전에 알아야 할 부가 이력. 점수가 아니라 사실만 적는다 */
function historyBadges(signals: RcSignals): string[] {
  const out: string[] = [];
  const misu = signals.misu;
  if (misu && (misu.개월 > 0 || misu.잔액 > 0)) {
    out.push(misu.개월 > 0 ? `미수 ${misu.개월}개월` : "미수 있음");
  }
  const bulman = signals.bulman;
  if (bulman?.건수) out.push(`불만 ${bulman.건수}건${ddayOf(bulman.최근일) > -190 ? " (최근)" : ""}`);
  const overage = signals.overage;
  if (overage?.건수) out.push(`초과 ${overage.건수}회`);
  const as = signals.as;
  if (as?.건수) out.push(`AS ${as.건수}건`);
  const 위험도 = signals.history?.갱신위험도;
  if (위험도) out.push(`갱신위험 ${위험도}`);
  return out;
}


/**
 * 워킨맵 메모에서 계약 조건을 읽는다.
 *
 * 메모는 시트에서 붙여온 줄 뭉치라 라벨이 붙은 줄과 자유 메모가 섞여 있다:
 *   "기본요금150000" "평단가150000" "컬러1000/흑백3000" "컬러100/흑백10" "미수금0원/0개월미수"
 *   "현재 영업팀이 갱신 진행중. 계약서 발송 완료한 업체"   ← 이게 방문 여부를 가르는 정보다
 * 앞의 것은 표로 세우고, 뒤의 문장은 그대로 보여준다.
 */
export type WorkinTerms = {
  기본요금: number;
  평단가: number;
  컬러기본: number;
  흑백기본: number;
  컬러단가: number;
  흑백단가: number;
  미수금: number;
  미수개월: number;
  진행메모: string[];
};

export function parseWorkinMemos(memos: string[], vendor: string): WorkinTerms {
  const terms: WorkinTerms = { 기본요금: 0, 평단가: 0, 컬러기본: 0, 흑백기본: 0, 컬러단가: 0, 흑백단가: 0, 미수금: 0, 미수개월: 0, 진행메모: [] };
  const pairs: Array<[number, number]> = [];
  for (const raw of memos) {
    const line = String(raw || "").trim();
    if (!line || line === "/") continue;
    const fee = line.match(/기본요금\s*([\d,]+)/);
    if (fee) { terms.기본요금 = won(fee[1]); continue; }
    const avg = line.match(/평단가\s*([\d,]+)/);
    if (avg) { terms.평단가 = won(avg[1]); continue; }
    const pair = line.match(/^컬러\s*([\d,]+)\s*\/\s*흑백\s*([\d,]+)$/);
    if (pair) { pairs.push([won(pair[1]), won(pair[2])]); continue; }
    const misu = line.match(/미수금\s*([\d,]+)\s*원\s*\/\s*([\d,]+)\s*개월/);
    if (misu) { terms.미수금 = won(misu[1]); terms.미수개월 = won(misu[2]); continue; }
    // 라벨 없는 잡줄 걸러내기 — 등급·시/구·주소·순번·상태·업체명·모델/기번
    if (/^(V|SS|S|NN|N)$/i.test(line)) continue;
    if (/^계약종료/.test(line)) continue;
    if (/^(임대중|임대종료|계약갱신|위탁|해지)$/.test(line)) continue;
    if (/^\d+$/.test(line)) continue;                          // 순번·사업자번호
    if (/^[가-힣]+\/[가-힣]+$/.test(line)) continue;             // "서울/강남구"
    if (/^(서울|경기|인천|부산|대구|광주|대전|울산|강원|충북|충남|전북|전남|경북|경남|제주|세종)\s/.test(line)) continue; // 주소
    if (/^[A-Za-z0-9\-]+\/\d{6,}$/.test(line)) continue;       // "D450/800100607798"
    // 업체명만 적힌 줄은 버리되, 업체명이 앞에 붙은 긴 메모는 살린다
    // ("S 바이드뮬러코리아\n현재 영업팀이 갱신 진행중…" 같은 진행 메모가 방문 여부를 가른다)
    const flat = line.replace(/\s/g, "");
    const vendorFlat = vendor.replace(/\s/g, "");
    if (vendorFlat && flat.length <= vendorFlat.length + 4 && flat.includes(vendorFlat.slice(0, 6))) continue;
    terms.진행메모.push(line);
  }
  // 큰 값이 기본매수, 작은 값이 초과 단가 (둘 다 "컬러N/흑백M" 형식이라 값으로 가른다)
  if (pairs.length) {
    const sorted = pairs.sort((a, b) => (b[0] + b[1]) - (a[0] + a[1]));
    [terms.컬러기본, terms.흑백기본] = sorted[0];
    if (sorted.length > 1) [terms.컬러단가, terms.흑백단가] = sorted[sorted.length - 1];
  }
  return terms;
}

// ─── 현분기 재계약 방문 대상 (워킨맵) ──────────────────────────────────────

export type RcPlace = {
  id: number;
  team: string;
  label: string;         // G1~G12 (진행 색상)
  진행: string;          // 라벨 뜻 — 완료·영업부·이관이면 방문 대상이 아니다
  등급: string;
  원본이름: string;      // "2610/8SS주식회사 한국성간보-매월마감"
  vendor: string;        // 표시용
  종료일: string;        // 자동연장 투영 반영 (분기 월이면 올해로)
  원종료일: string;      // 이름·메모에 적힌 그대로
  투영: boolean;
  dday: number;
  주소: string;
  전화: string;
  메모: string[];
  비고: string;
};

export type RcTarget = {
  key: string;           // vendorMatchKey — 대장 한 장으로 묶는 단위
  vendor: string;
  등급: string;          // S | SS (섞이면 높은 쪽)
  team: string;
  종료일: string;        // 가장 빠른 것 (투영 반영)
  투영: boolean;         // 자동연장으로 연도를 올해로 읽은 건
  dday: number;
  주소: string;
  같은건물: number;      // 같은 주소에 있는 다른 대상 수 — 한 번에 도는 동선
  places: RcPlace[];     // 같은 업체의 지점들 (401호·405호)
  labels: string[];
  signals: RcSignals;
  badges: string[];
  조건: WorkinTerms;      // 워킨맵 메모에서 읽은 계약 조건 (대장 없을 때의 유일한 근거)
};

type DbPlace = {
  id: number; team: string; quarter: number; kind: string; label: string | null;
  name: string; address: string | null; address_detail: string | null;
  phone: string | null; comment: string | null; memos: string[] | null; visible: boolean | null;
};

/** CS가 방문하는 등급 — S(일반프로+부파트장) · SS(팀장급). V는 영업부 관할 */
export const CS_GRADES = ["SS", "S"];

export type RenewalScope = {
  targets: RcTarget[];
  quarter: Quarter;
  제외: { 완료: number; 영업부: number; 이관: number; 등급외: number; 무등급: number };
};

/**
 * 현분기 재계약 방문 대상.
 * 워킨맵 목록 그대로 가져와 CS 등급(S·SS)만 남기고, 업체 단위로 묶는다.
 */
export async function fetchRenewalScope(quarter: Quarter = currentQuarter(), team?: string): Promise<RenewalScope> {
  const query = `select=${cols("id", "team", "quarter", "kind", "label", "name", "address", "address_detail", "phone", "comment", "memos", "visible")}`
    + `&kind=eq.renewal&quarter=eq.${quarter}${team ? `&team=eq.${enc(team)}` : ""}&order=id.asc`;
  const [rows, signals] = await Promise.all([
    selectAllRows<DbPlace>("workin_map_places", query),
    getSignalIndex(),
  ]);

  const baseYear = new Date(Date.now() + 9 * 3600_000).getFullYear();
  const 제외 = { 완료: 0, 영업부: 0, 이관: 0, 등급외: 0, 무등급: 0 };
  const buckets = new Map<string, RcPlace[]>();

  for (const row of rows) {
    const memos = Array.isArray(row.memos) ? row.memos.map(String) : [];
    const place = { name: String(row.name || ""), memos };
    const label = String(row.label || "");
    const 등급 = renewalGrade(place);
    // 방문 대상이 아닌 것부터 걸러낸다 — 왜 빠졌는지 화면에 세어 보여준다
    if (RENEWAL_DONE_LABELS.has(label)) {
      if (label === "G5") 제외.완료 += 1;
      else if (label === "G12") 제외.이관 += 1;
      else 제외.영업부 += 1;
      continue;
    }
    if (!등급) { 제외.무등급 += 1; continue; }
    if (!CS_GRADES.includes(등급)) { 제외.등급외 += 1; continue; }

    const end = renewalEndYmd(place, baseYear, quarter);
    const vendor = workinVendorName(row.name) || String(row.name || "").trim();
    const entry: RcPlace = {
      id: row.id,
      team: String(row.team || ""),
      label,
      진행: RENEWAL_LABEL_DESC[label] || "",
      등급,
      원본이름: String(row.name || ""),
      vendor,
      종료일: end.ymd,
      원종료일: end.original,
      투영: end.projected,
      dday: end.ymd ? ddayOf(end.ymd) : 9999,
      주소: [String(row.address || "").trim(), String(row.address_detail || "").trim()].filter(Boolean).join(" "),
      전화: String(row.phone || "").trim(),
      메모: memos.filter((memo) => memo.trim() && memo.trim() !== "/"),
      비고: String(row.comment || "").trim(),
    };
    const key = vendorMatchKey(vendor) || `place-${row.id}`;
    const list = buckets.get(key);
    if (list) list.push(entry);
    else buckets.set(key, [entry]);
  }

  // 같은 건물에 대상이 몇 곳인지 — 한 번 가서 여러 곳 도는 동선 파악용
  const buildingCount = new Map<string, number>();
  for (const places of buckets.values()) {
    const seen = new Set<string>();
    for (const place of places) {
      const groupKey = addressGroupKey(place.주소);
      if (!groupKey || seen.has(groupKey)) continue;
      seen.add(groupKey);
      buildingCount.set(groupKey, (buildingCount.get(groupKey) || 0) + 1);
    }
  }

  const targets: RcTarget[] = Array.from(buckets.entries()).map(([key, places]) => {
    const sorted = places.sort((a, b) => (a.종료일 || "9999").localeCompare(b.종료일 || "9999"));
    const first = sorted[0];
    const vendorSignals = signals.get(key) || {};
    return {
      key,
      vendor: sorted.map((place) => place.vendor).sort((a, b) => b.length - a.length)[0] || first.vendor,
      등급: sorted.some((place) => place.등급 === "SS") ? "SS" : first.등급,
      team: first.team,
      종료일: first.종료일,
      투영: sorted.some((place) => place.투영),
      dday: first.dday,
      주소: sorted.map((place) => place.주소).find(Boolean) || "",
      같은건물: buildingCount.get(addressGroupKey(sorted.map((place) => place.주소).find(Boolean) || "")) || 1,
      places: sorted,
      labels: Array.from(new Set(sorted.map((place) => place.label).filter(Boolean))),
      signals: vendorSignals,
      badges: historyBadges(vendorSignals),
      조건: parseWorkinMemos(sorted.flatMap((place) => place.메모), sorted[0].vendor),
    };
  }).sort((a, b) => (a.종료일 || "9999").localeCompare(b.종료일 || "9999") || a.vendor.localeCompare(b.vendor));

  return { targets, quarter, 제외 };
}

// ─── 업체 브리핑(상세) ───────────────────────────────────────────────────────

export type RcBriefing = {
  copiers: RcDevice[];             // 복합기 — 재계약 대상
  others: RcDevice[];              // PC·노트북·세단기 등 (참고용, 접어서 보여준다)
  raw: Record<string, string>;     // 임대리스트 _raw — 담당지역·영업담당자·확장성·특이사항 등
  history: RcHistoryRow[];
  misu: Array<Record<string, string>>;
  overage: Array<Record<string, string>>;
  bulman: Array<Record<string, string>>;
};

function textRow(row: Record<string, unknown>, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) out[key] = String(row[key] ?? "").trim();
  return out;
}

/** 한 업체의 상세 — 이름으로 넓게 긁고 키로 다시 걸러 표기 변형을 놓치지 않는다 */
export async function fetchBriefing(target: RcTarget): Promise<RcBriefing> {
  const probe = target.vendor.replace(/㈜|\(주\)|주식회사/g, "").trim().slice(0, 6) || target.vendor.slice(0, 6);
  const like = `${enc("_업체명")}=ilike.*${enc(probe)}*`;
  const mine = (rows: Array<Record<string, unknown>>) =>
    rows.filter((row) => vendorMatchKey(String(row["_업체명"] ?? "")) === target.key);
  const safe = async <T>(run: Promise<T[]>): Promise<T[]> => { try { return await run; } catch { return []; } };

  const [leaseRows, historyRows, misuRows, overageRows, bulmanRows] = await Promise.all([
    safe(selectRows<Record<string, unknown>>("vendor_info",
      `select=${LEASE_COLS},_raw&${like}&${enc("임대여부")}=eq.${enc("임대중")}&limit=200`)),
    safe(selectRows<Record<string, unknown>>("recontract",
      `select=${cols("id", "날짜", "작성자", "갱신상태", "갱신위험도", "최종상태", "제안조건", "관리포인트", "다음확인일", "원문", "_업체명")}&${like}&order=${enc("날짜")}.desc&limit=40`)),
    safe(selectRows<Record<string, unknown>>("misu",
      `select=${cols("입력일", "미수개월", "미수잔액", "입금약속일", "고객반응", "방문내용", "특이사항", "_업체명")}&${like}&order=id.desc&limit=20`)),
    safe(selectRows<Record<string, unknown>>("overage",
      `select=${cols("날짜", "합계", "컬러초과료", "흑백초과료", "기본매수", "초과장당금액", "모델명", "접수내용", "_업체명")}&${like}&order=${enc("날짜")}.desc&limit=24`)),
    safe(selectRows<Record<string, unknown>>("bulman",
      `select=${cols("날짜", "불만유형", "불만항목", "불만내용", "대안제시", "재발방지", "고객감정상태", "_업체명")}&${like}&order=id.desc&limit=20`)),
  ]);

  const lease = mine(leaseRows);
  const rawSource = lease.find((row) => row._raw && typeof row._raw === "object");
  const raw: Record<string, string> = {};
  if (rawSource) for (const [key, value] of Object.entries(rawSource._raw as Record<string, unknown>)) raw[key] = String(value ?? "").trim();

  const devices = lease.map(toDevice).sort((a, b) => a.종료일.localeCompare(b.종료일));
  return {
    copiers: devices.filter((device) => isCopier(device.품목, device.기종)),
    others: devices.filter((device) => !isCopier(device.품목, device.기종)),
    raw,
    history: mine(historyRows).map((row) => ({
      id: Number(row.id) || 0,
      날짜: normalizeYmd(row["날짜"]),
      작성자: String(row["작성자"] ?? "").trim(),
      갱신상태: String(row["갱신상태"] ?? "").trim(),
      갱신위험도: String(row["갱신위험도"] ?? "").trim(),
      최종상태: String(row["최종상태"] ?? "").trim(),
      제안조건: String(row["제안조건"] ?? "").trim(),
      관리포인트: String(row["관리포인트"] ?? "").trim(),
      다음확인일: normalizeYmd(row["다음확인일"]),
      원문: String(row["원문"] ?? "").trim(),
    })),
    misu: mine(misuRows).map((row) => {
      const text = textRow(row, ["입력일", "미수개월", "미수잔액", "입금약속일", "고객반응", "방문내용", "특이사항"]);
      text["입력일"] = normalizeYmd(text["입력일"]) || text["입력일"].slice(0, 10);
      return text;
    }),
    overage: mine(overageRows).map((row) => {
      const text = textRow(row, ["날짜", "합계", "컬러초과료", "흑백초과료", "기본매수", "초과장당금액", "모델명", "접수내용"]);
      text["날짜"] = normalizeYmd(text["날짜"]) || text["날짜"].slice(0, 10);
      return text;
    }),
    bulman: mine(bulmanRows).map((row) => {
      const text = textRow(row, ["날짜", "불만유형", "불만항목", "불만내용", "대안제시", "재발방지", "고객감정상태"]);
      text["날짜"] = normalizeYmd(text["날짜"]) || text["날짜"].slice(0, 10);
      return text;
    }),
  };
}
