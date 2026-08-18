/**
 * 재계약 준비 — 데이터 조회.
 *
 * 방문 전에 알아야 할 것을 이미 있는 원장에서 모아 온다(새로 적재하는 것 없음).
 *   대상 발굴: vendor_info(임대리스트) 임대여부=임대중 + 종료일 구간 — 종료일이 ISO라 서버에서 걸러진다
 *   신호:      misu(미수) · overage(초과료) · bulman(불만) · as_records(AS) · recontract(과거 재계약 협상)
 *
 * 업체 묶기는 vendorMatchKey를 쓴다 — "㈜에코라"·"주식회사 에코라(ECoRALtd)"가 한 업체로 모여야
 * 대수·월 렌탈료 합계가 맞는다. 앱 다른 곳(워킨맵·통합이력)과 같은 키를 쓰므로 판정이 어긋나지 않는다.
 */
import { selectAllRows, selectRows } from "../supabase";
import { vendorMatchKey } from "../ids";

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

const TARGET_COLS = cols(
  "id", "_업체명", "순번", "등급", "시/구", "계약일", "종료일", "남은개월", "계약기간",
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

/** 종료 임박 기기 — 임대중 + 종료일이 오늘~months개월 안 */
export async function fetchExpiringDevices(months: number): Promise<RcDevice[]> {
  const query = `select=${TARGET_COLS}&${enc("임대여부")}=eq.${enc("임대중")}`
    + `&${enc("종료일")}=gte.${kstToday()}&${enc("종료일")}=lte.${ymdAfterMonths(months)}`
    + `&order=${enc("종료일")}.asc,id.asc`;
  const rows = await selectAllRows<Record<string, unknown>>("vendor_info", query);
  return rows.map(toDevice).filter((device) => device.vendor);
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

// ─── 업체 단위로 묶기 ────────────────────────────────────────────────────────

export type RcTarget = {
  key: string;
  vendor: string;        // 표시용 — 같은 업체의 표기 중 가장 긴 것(정보량이 많다)
  등급: string;
  구: string;
  대수: number;
  월렌탈료합: number;
  최단종료일: string;
  dday: number;
  종료일수: number;      // 종료일이 여러 갈래면 방문 한 번에 못 끝낸다
  devices: RcDevice[];
  signals: RcSignals;
  risk: number;
  risks: string[];       // 점수의 근거 — 배지로 그대로 보여준다
};

/** 등급 우선순위 — 업체 대표 등급을 고를 때만 쓴다 */
const GRADE_RANK = ["SS", "S", "V", "N", "NN"];
function bestGrade(values: string[]): string {
  const found = values.map((v) => v.trim().toUpperCase()).filter(Boolean);
  for (const grade of GRADE_RANK) if (found.includes(grade)) return grade;
  return found[0] || "";
}

/** 위험 점수 — 왜 높은지 말할 수 있어야 쓸모가 있다. 점수보다 근거가 본체다 */
function scoreRisk(signals: RcSignals): { risk: number; risks: string[] } {
  const risks: string[] = [];
  let risk = 0;
  const misu = signals.misu;
  if (misu && (misu.개월 > 0 || misu.잔액 > 0)) {
    const months = misu.개월;
    risk += months >= 3 ? 4 : months >= 2 ? 3 : 2;
    risks.push(months > 0 ? `미수 ${months}개월` : "미수 있음");
  }
  const bulman = signals.bulman;
  if (bulman?.건수) {
    const recent = ddayOf(bulman.최근일) > -190; // 최근 6개월
    risk += recent ? 3 : 1;
    risks.push(`불만 ${bulman.건수}건${recent ? " (최근)" : ""}`);
  }
  const overage = signals.overage;
  if (overage && overage.건수 >= 3) { risk += 2; risks.push(`초과 ${overage.건수}회`); }
  else if (overage?.건수) { risk += 1; risks.push(`초과 ${overage.건수}회`); }
  const as = signals.as;
  if (as && as.건수 >= 6) { risk += 2; risks.push(`AS ${as.건수}건`); }
  else if (as && as.건수 >= 3) { risk += 1; risks.push(`AS ${as.건수}건`); }
  const 위험도 = signals.history?.갱신위험도;
  if (위험도 === "상") { risk += 4; risks.push("갱신위험 상"); }
  else if (위험도 === "중") { risk += 2; risks.push("갱신위험 중"); }
  return { risk, risks };
}

/** 기기 목록 + 신호 → 업체 카드 */
export function groupTargets(devices: RcDevice[], signals: SignalIndex): RcTarget[] {
  const buckets = new Map<string, RcDevice[]>();
  for (const device of devices) {
    const key = vendorMatchKey(device.vendor) || device.vendor;
    const list = buckets.get(key);
    if (list) list.push(device);
    else buckets.set(key, [device]);
  }
  const out: RcTarget[] = [];
  for (const [key, list] of buckets) {
    const ends = list.map((d) => d.종료일).filter(Boolean).sort();
    const 최단종료일 = ends[0] || "";
    const vendorSignals = signals.get(key) || {};
    const { risk, risks } = scoreRisk(vendorSignals);
    out.push({
      key,
      vendor: list.map((d) => d.vendor).sort((a, b) => b.length - a.length)[0] || "",
      등급: bestGrade(list.map((d) => d.등급)),
      구: list.map((d) => d.구).find(Boolean) || "",
      대수: list.length,
      월렌탈료합: list.reduce((sum, d) => sum + d.월렌탈료, 0),
      최단종료일,
      dday: ddayOf(최단종료일),
      종료일수: new Set(ends).size,
      devices: list.sort((a, b) => a.종료일.localeCompare(b.종료일)),
      signals: vendorSignals,
      risk,
      risks,
    });
  }
  return out;
}

// ─── 업체 브리핑(상세) ───────────────────────────────────────────────────────

export type RcBriefing = {
  devicesAll: RcDevice[];          // 종료 임박분만이 아니라 그 업체의 임대중 전부
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
      `select=${TARGET_COLS},_raw&${like}&${enc("임대여부")}=eq.${enc("임대중")}&limit=200`)),
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

  return {
    devicesAll: lease.map(toDevice).sort((a, b) => a.종료일.localeCompare(b.종료일)),
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
    misu: mine(misuRows).map((row) => textRow(row, ["입력일", "미수개월", "미수잔액", "입금약속일", "고객반응", "방문내용", "특이사항"])),
    overage: mine(overageRows).map((row) => textRow(row, ["날짜", "합계", "컬러초과료", "흑백초과료", "기본매수", "초과장당금액", "모델명", "접수내용"])),
    bulman: mine(bulmanRows).map((row) => textRow(row, ["날짜", "불만유형", "불만항목", "불만내용", "대안제시", "재발방지", "고객감정상태"])),
  };
}
