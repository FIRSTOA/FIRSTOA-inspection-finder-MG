import { useCallback, useEffect, useMemo, useState } from "react";
import {
  searchLeaseList, getAsHistory, getRecentInspections, findWorkinMapName, sendServiceReception,
  saveServiceReception, getServiceReceptions, setServiceReceptionStatus, updateServiceReception, getLeaseDeviceSummary,
  type LeaseHit, type ServiceReceptionRow, type AsHistoryEntry, type InspectionSnapshot, type LeaseDeviceSummary,
} from "./api";
import { kstDate } from "./visits";
import { selectRows, upsertRow } from "./supabase";
import { usageSpareAdvice } from "./spareAdvice";

type ReceiveRoute = "카카오" | "전화";
type ReceiveType = "원격이관" | "복합기 AS" | "IT AS";

function pick(lease: LeaseHit | null, ...keys: string[]) {
  if (!lease) return "";
  for (const key of keys) {
    const value = (lease[key] || "").trim();
    if (value) return value;
  }
  return "";
}

// "2025-04-03" / "2025.4.3" → "2025. 4. 3"
function fmtDot(value: string) {
  const m = String(value).match(/(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
  return m ? `${m[1]}. ${Number(m[2])}. ${Number(m[3])}` : String(value || "").trim();
}
function fmtDotYY(value: string) {
  return fmtDot(value).replace(/^\d{2}(\d{2})\./, "$1.");
}
function korYMD(date: string) {
  const m = String(date).match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1].slice(2)}년 ${Number(m[2])}월 ${Number(m[3])}일` : String(date || "");
}
function fmtWon(value: string) {
  const digits = String(value).replace(/[^\d]/g, "");
  return digits ? `₩${Number(digits).toLocaleString()}` : String(value || "").trim();
}
function withMonths(value: string) {
  const v = String(value || "").trim();
  return /^\d+$/.test(v) ? `${v}개월` : v;
}
function monthsBetween(from: string, to: string) {
  const start = new Date(from.replace(/\./g, "-").replace(/\s/g, ""));
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
  const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  return months >= 0 ? `${months}개월` : "";
}
function receiptDay() {
  const d = kstDate();
  return `${Number(d.slice(5, 7))}. ${Number(d.slice(8, 10))}`;
}
// 담당지역(강남/노원구 등) → 수도권A~D / 지방
const DISTRICT_TEAM: Array<[string, string]> = [
  ["강북", "A"], ["노원", "A"], ["도봉", "A"], ["성북", "A"], ["중랑", "A"], ["동대문", "A"], ["성동", "A"], ["광진", "A"], ["종로", "A"], ["용산", "A"],
  ["강서", "B"], ["양천", "B"], ["영등포", "B"], ["구로", "B"], ["금천", "B"], ["마포", "B"], ["은평", "B"], ["서대문", "B"],
  ["강남", "C"], ["서초", "C"], ["송파", "C"], ["강동", "C"], ["관악", "C"], ["동작", "C"],
  ["경기", "D"], ["인천", "D"], ["고양", "D"], ["파주", "D"], ["부천", "D"], ["성남", "D"], ["수원", "D"], ["안양", "D"], ["용인", "D"],
];
function regionLabel(area: string) {
  const a = String(area || "").trim();
  if (!a) return "";
  if (a === "지방") return "지방";
  for (const [key, team] of DISTRICT_TEAM) if (a.includes(key)) return `수도권${team}`;
  return a;
}
type ListPeriod = "day" | "week" | "month" | "quarter";
const PERIOD_LABEL: Record<ListPeriod, string> = { day: "일일", week: "주간", month: "월간", quarter: "분기" };
function periodRangeOf(period: ListPeriod, date: string): { start: string; end: string } {
  if (period === "day") return { start: date, end: date };
  if (period === "week") {
    const d = new Date(`${date}T12:00:00+09:00`);
    const start = shiftDate(date, -((d.getDay() + 6) % 7)); // 월요일 시작
    return { start, end: shiftDate(start, 6) };
  }
  const year = Number(date.slice(0, 4));
  if (period === "month") {
    const month = Number(date.slice(5, 7));
    return { start: `${date.slice(0, 7)}-01`, end: `${date.slice(0, 7)}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}` };
  }
  const startMonth = Math.floor((Number(date.slice(5, 7)) - 1) / 3) * 3 + 1;
  const endMonth = startMonth + 2;
  return {
    start: `${year}-${String(startMonth).padStart(2, "0")}-01`,
    end: `${year}-${String(endMonth).padStart(2, "0")}-${String(new Date(year, endMonth, 0).getDate()).padStart(2, "0")}`,
  };
}
function shiftMonths(date: string, months: number) {
  const d = new Date(`${date.slice(0, 7)}-01T12:00:00+09:00`);
  d.setMonth(d.getMonth() + months);
  return kstDate(d);
}
// 임대리스트 거래처명에 붙는 엑셀 잔재(_x000d_)와 뒷줄 키맨 메모를 떼고 첫 줄만 쓴다.
function cleanVendorName(value: string) {
  return String(value || "").split(/_x000d_|\r|\n/)[0].trim();
}
// 24시간제 HH:MM (ko-KR + hour12:false 조합이 환경에 따라 12시간제로 나오는 문제 회피)
function kstNowHM() {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
}
function teamFromRegion(region: string) {
  const m = String(region || "").match(/수도권([A-D])/);
  return (m ? m[1] : "A") as "A" | "B" | "C" | "D";
}
// 접수 행 → FIELD AS 원본 양식 (일정리스트 buildFieldAsText와 같은 형식)
function receptionToFieldText(row: ServiceReceptionRow) {
  return [
    `작성자:${row.author || ""}`,
    "구분: AS",
    "레벨:1",
    `등급:${row.grade || ""}`,
    `업체명:${cleanVendorName(row.vendor)}`,
    "부서명:",
    `지역:${teamFromRegion(row.region)}`,
    `키맨/접수자:${[row.receiver_phone, row.receiver_name].filter(Boolean).join(" ")}`,
    "ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ",
    "1.",
    `모델명: ${row.model}`,
    `시리얼넘버: ${row.serial}`,
    `자산기번: ${row.asset_no || ""}`.trimEnd(),
    `내용: ${[row.title, row.symptom].filter(Boolean).join(" / ")}`,
    "처리내용:",
    "매수:흑- 컬- 큰컬- 합-",
    "토너잔량:K- C- M- Y-",
    "폐통:  %",
    "여분: K- C- M- Y- 폐-",
    "한틴이카유무:",
    "주차비지원유무:",
    "특이사항:",
    "ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ",
    "※부품신청※",
    "보증기간 내 여부 :",
    "교체 전 카운터 누적 사용매수 :",
    "사용 부품 예상 사용매수 :",
    "▶ 신청 부품",
    "물품명:",
    "수량:",
    "출고여부:",
    "ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ",
    "※자가신청※",
    "물품:",
    "수량:",
    "출고여부:",
    "ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ",
    "도착 시간:",
    "소요 시간:",
  ].join("\n");
}
function kstTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(11, 16);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}
function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T12:00:00+09:00`);
  d.setDate(d.getDate() + days);
  return kstDate(d);
}

const TYPE_TONE: Record<string, string> = {
  "복합기 AS": "bg-blue-50 text-blue-700",
  "IT AS": "bg-cyan-50 text-cyan-700",
  "원격이관": "bg-violet-50 text-violet-700",
};
const STATUS_TONE: Record<string, string> = {
  접수: "bg-slate-100 text-slate-600",
  전송완료: "bg-emerald-50 text-emerald-700",
  원격대기: "bg-amber-50 text-amber-700",
  원격완료: "bg-emerald-50 text-emerald-700",
};

type Manual = { 접수자성함: string; 접수자연락처: string; 제목: string; 증상: string; 유상무상: string; 참고사항: string; 교체이력: string };
const EMPTY_MANUAL: Manual = { 접수자성함: "", 접수자연락처: "", 제목: "", 증상: "", 유상무상: "무상", 참고사항: "", 교체이력: "" };

export default function ServiceReception({ author, onUseField }: { author: string; onUseField?: (text: string) => void }) {
  const [route, setRoute] = useState<ReceiveRoute>("카카오");
  const [type, setType] = useState<ReceiveType>("복합기 AS");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LeaseHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [lease, setLease] = useState<LeaseHit | null>(null);
  const [manual, setManual] = useState<Manual>(EMPTY_MANUAL);
  const [manualVendor, setManualVendor] = useState("");
  const [asHistory, setAsHistory] = useState<AsHistoryEntry[]>([]);
  const [snapshots, setSnapshots] = useState<InspectionSnapshot[]>([]);
  const [snapshotDeviceMatch, setSnapshotDeviceMatch] = useState(true);
  const [deviceSummary, setDeviceSummary] = useState<LeaseDeviceSummary>({ active: 0, items: [] });
  const [workinName, setWorkinName] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedRowId, setSavedRowId] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState("");

  // 접수 현황 리스트
  const [listDate, setListDate] = useState(kstDate());
  const [listPeriod, setListPeriod] = useState<ListPeriod>("day");
  const [listRows, setListRows] = useState<ServiceReceptionRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listFilter, setListFilter] = useState<"전체" | "복합기 AS" | "IT AS" | "원격이관">("전체");
  const [openRowId, setOpenRowId] = useState("");

  const loadList = useCallback(async (date: string, period: ListPeriod = "day") => {
    setListLoading(true);
    try {
      const { start, end } = periodRangeOf(period, date);
      setListRows(await getServiceReceptions(start, end));
    } catch {
      setListRows([]);
    } finally {
      setListLoading(false);
    }
  }, []);
  useEffect(() => { void loadList(listDate, listPeriod); }, [listDate, listPeriod, loadList]);

  const runSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setSearched(false);
    try {
      setResults(await searchLeaseList(query));
    } finally {
      setSearching(false);
      setSearched(true);
    }
  };

  const selectLease = async (hit: LeaseHit) => {
    setLease(hit);
    setResults([]);
    setAsHistory([]);
    setSnapshots([]);
    setSnapshotDeviceMatch(true);
    setDeviceSummary({ active: 0, items: [] });
    setWorkinName("");
    setActionResult("");
    const vendor = pick(hit, "거래처명", "_업체명", "업체명");
    const exactVendor = pick(hit, "_업체명");
    const serial = pick(hit, "시리얼번호(기번)", "기번");
    const assetNo = pick(hit, "자산번호");
    if (vendor || serial) setAsHistory(await getAsHistory(vendor, serial, assetNo));
    if (vendor) {
      const [name, recent, devices] = await Promise.all([
        findWorkinMapName(vendor),
        getRecentInspections(vendor, serial, assetNo),
        getLeaseDeviceSummary(exactVendor || vendor),
      ]);
      setWorkinName(name);
      setSnapshots(recent.snapshots);
      setSnapshotDeviceMatch(recent.deviceMatch);
      setDeviceSummary(devices);
    }
  };

  const vendorName = workinName || pick(lease, "거래처명", "_업체명", "업체명") || manualVendor.trim();
  const region = regionLabel(pick(lease, "담당지역"));
  // 검색 결과 안에서 같은 업체가 몇 행(기기)인지 — 여러 대면 표시해 오선택을 막는다.
  const resultVendorCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const hit of results) {
      const key = (hit["_업체명"] || "").trim();
      if (key) map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [results]);

  const report = useMemo(() => {
    if (!lease) return "";
    const 업체명 = workinName || pick(lease, "거래처명", "_업체명", "업체명");
    const 등급 = pick(lease, "등급");
    const 모델명 = pick(lease, "모델명", "기종");
    const 기번 = pick(lease, "시리얼번호(기번)", "기번");
    const 자산번호 = pick(lease, "자산번호");
    const 순 = pick(lease, "순");
    const 장비소유주 = pick(lease, "장비소유주") || "퍼스트전산";
    const 계약일 = pick(lease, "계약일", "첫계약일");
    const 종료일 = pick(lease, "종료일");
    const 남은개월 = pick(lease, "남은개월");
    const 교체일 = pick(lease, "납품/교체일");
    const 방문주기 = pick(lease, "방문주기");
    const 기본임대료 = pick(lease, "기본금액");
    const 평균임대료 = pick(lease, "연평균");
    const 유지보수 = pick(lease, "위탁/유지보수및기타사항") || "없음";
    const 일반전화 = pick(lease, "일반전화");
    const 미수개월Raw = pick(lease, "미수개월수");
    const 미수개월 = 미수개월Raw === "0" ? "" : 미수개월Raw;
    const 키맨 = pick(lease, "키맨");
    const 코드 = pick(lease, "코드");
    const 틴텍코드 = pick(lease, "틴텍코드");
    const 주소 = pick(lease, "주소(실납품주소,도로명주소)", "주소");
    const 확장성 = pick(lease, "확장성");
    const 기기상태 = pick(lease, "기기상태");
    const 사용개월 = 계약일 ? monthsBetween(계약일, kstDate()) : "";
    const 교체일로부터 = /\d{4}[.\-/]/.test(교체일) ? `${monthsBetween(교체일, kstDate())}사용중` : "";
    const 구분 = type === "IT AS" ? "IT A/S" : "A/S";
    // AS이력: 이 기기(시리얼/자산기번 일치)만 우선. 기기교체 등으로 일치가 없으면 업체기준으로 폴백해 표기.
    const serialEntries = asHistory.filter((h) => h.serialMatch);
    const basisEntries = serialEntries.length ? serialEntries : asHistory;
    const basisLabel = serialEntries.length ? "시리얼기준" : "업체기준";
    // 자가사용내역: 최근 점검 2회(전방문/전전방문) + 기간 포함 사용량 + 여분·폐통 지급 권장(워킨맵과 동일 로직).
    const usage: string[] = [];
    const [snap0, snap1] = snapshots;
    if (snapshots.length && !snapshotDeviceMatch) usage.push(`※ 이 기기(자산·기번) 점검기록이 없어 업체 기록 기준입니다 — 다른 기기 기록일 수 있음`);
    const snapDevice = (s: InspectionSnapshot) => [s.model, s.asset && `자산 ${s.asset}`, s.serial && `기번 ${s.serial}`].filter(Boolean).join(" · ");
    if (snap0) usage.push(`■ 전방문 ${snap0.date}${snapDevice(snap0) ? ` · 기기 ${snapDevice(snap0)}` : ""} · 매수 ${snap0.counts || "-"} · 여분 ${snap0.spare || "-"}${snap0.waste ? ` · 폐통 ${snap0.waste}` : ""}`);
    if (snap1) usage.push(`■ 전전방문 ${snap1.date}${snapDevice(snap1) ? ` · 기기 ${snapDevice(snap1)}` : ""} · 매수 ${snap1.counts || "-"} · 여분 ${snap1.spare || "-"}${snap1.waste ? ` · 폐통 ${snap1.waste}` : ""}`);
    const advice = usageSpareAdvice(snap0, snap1, `${모델명} ${pick(lease, "기종")}`);
    if (advice?.warning) usage.push(`■ 주의: ${advice.warning}`);
    if (advice?.usageLine) usage.push(`■ 사용량: ${advice.usageLine}`);
    if (advice) usage.push(`■ 여분 분석: ${advice.adviceLine}`);
    const T = "\t";
    const lines = [
      `${구분}${T}${등급}${T}${모델명}${T}${업체명}${T}종료일${T}${fmtDotYY(종료일)}${T}지역${T}${region}${T}접수일${T}${receiptDay()}`,
      `기번${T}${기번}${T}자산번호${T}${자산번호}`,
      `접수유형${T}${route}${T}접수분야${T}${구분}`,
      `임대리스트순번${T}${순}${T}장비소유주${T}${장비소유주}`,
      `계약일${T}${fmtDot(계약일)}${T}사용개월${T}${사용개월}`,
      `종료일${T}${fmtDot(종료일)}${T}남은개월${T}${withMonths(남은개월)}`,
      `납품/교체일${T}${fmtDot(교체일)}${T}방문주기${T}${withMonths(방문주기)}`,
      `기본임대료${T}${fmtWon(기본임대료)}${T}평균임대료${T}${fmtWon(평균임대료)}`,
      `설치업체${T}${장비소유주}${T}유지보수업체${T}${유지보수}`,
      `접수자성함${T}${manual.접수자성함}`,
      `접수자연락처${T}${manual.접수자연락처}`,
      `일반전화${T}${일반전화}`,
      `미수개월${T}${미수개월}`,
      `★키맨성함/번호${T}${키맨}`,
      `방문담당자${T}${region}`,
      `한조/틴텍코드${T}${코드} / ${틴텍코드}`,
      `주소${T}${주소}${T}확장성${T}${확장성}`,
      `기종${T}${모델명}${T}기기상태${T}${기기상태}`,
      `유상/무상${T}${manual.유상무상}`,
      `제목${T}${manual.제목}`,
      `상태${T}${manual.증상}`,
      `참고사항${T}${manual.참고사항}`,
      `교체이력${T}${manual.교체이력}${T}교체일로부터${T}${교체일로부터}`,
      `AS접수횟수(${basisLabel})${T}${basisEntries.length}회`,
      `AS접수히스토리(${basisLabel})`,
      basisEntries.length ? basisEntries.map((h) => {
        const device = [h.model, h.asset && `자산 ${h.asset}`, h.serial && `기번 ${h.serial}`].filter(Boolean).join(" / ");
        return `■ 날짜: ${korYMD(h.date)}${device ? `\n■ 기기: ${device}` : ""}\n■ 내용: ${h.content}`;
      }).join("\n\n") : "없음",
      `자가사용내역(최근6개월)`,
      usage.length ? usage.join("\n\n") : "점검 기록 없음",
    ];
    return lines.join("\n");
  }, [lease, manual, asHistory, snapshots, snapshotDeviceMatch, route, type, workinName, region]);

  const copyReport = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      window.alert("복사 실패 — 양식을 직접 선택해 복사하세요.");
    }
  };

  const persist = async (status: string, sentRoom = "") => {
    return saveServiceReception({
      author, route, type,
      vendor: vendorName,
      asset_no: pick(lease, "자산번호"),
      serial: pick(lease, "시리얼번호(기번)", "기번"),
      model: pick(lease, "모델명", "기종"),
      region,
      grade: pick(lease, "등급"),
      receiver_name: manual.접수자성함.trim(),
      receiver_phone: manual.접수자연락처.trim(),
      title: manual.제목,
      symptom: manual.증상,
      paid: manual.유상무상,
      notes: manual.참고사항,
      report_text: type === "원격이관" ? "" : report,
      status,
      sent_room: sentRoom,
    });
  };

  const resetForm = () => {
    setLease(null); setManual(EMPTY_MANUAL); setAsHistory([]); setSnapshots([]); setSnapshotDeviceMatch(true); setDeviceSummary({ active: 0, items: [] }); setQuery(""); setResults([]);
    setSearched(false); setWorkinName(""); setManualVendor(""); setSavedRowId(null);
  };

  // 저장만 (복합기/IT) 또는 원격 접수 저장(대기)
  const handleSave = async () => {
    if (busy) return;
    if (!vendorName) { setActionResult("업체를 선택(또는 입력)하세요."); return; }
    setBusy(true);
    setActionResult("");
    try {
      await persist(type === "원격이관" ? "원격대기" : "접수");
      setActionResult(type === "원격이관" ? "원격 접수 저장됨 (대기)" : "접수 저장됨");
      resetForm();
      await loadList(listDate, listPeriod);
    } catch (e) {
      setActionResult(`저장 실패: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // 복합기 AS: 저장 + AS방 전송 — 선저장(접수) 후 전송, 성공 시 전송완료로 갱신.
  // 전송 실패 시 저장된 행을 기억해 재시도에서 중복 저장·중복 카톡을 막는다.
  const handleSaveAndSend = async () => {
    if (busy || !report) return;
    setBusy(true);
    setActionResult("");
    try {
      let rowId = savedRowId;
      if (!rowId) {
        rowId = await persist("접수");
        setSavedRowId(rowId);
      }
      const res = await sendServiceReception("AS", region, report);
      if (!res.ok) {
        setActionResult(`전송 실패: ${res.error} — 접수는 저장됐어요. 다시 누르면 전송만 재시도합니다.`);
        return;
      }
      const room = String(res.message || "").replace("게시 대기: ", "");
      if (rowId) await updateServiceReception(rowId, { status: "전송완료", sent_room: room });
      setActionResult(`전송 완료 — ${room}${res.testMode ? " (테스트 모드)" : ""}`);
      setSavedRowId(null);
      resetForm();
      await loadList(listDate, listPeriod);
    } catch (e) {
      setActionResult(`처리 실패: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // 접수 → 일정리스트(as_tickets) 등록. 같은 날 같은 업체 일정이 있으면 물어본다.
  const [scheduleBusyId, setScheduleBusyId] = useState("");
  const addToSchedule = async (row: ServiceReceptionRow) => {
    if (scheduleBusyId) return;
    setScheduleBusyId(row.id);
    try {
      const today = kstDate();
      const vendor = cleanVendorName(row.vendor);
      const dup = await selectRows<{ id: string }>("as_tickets", `select=id&date=eq.${today}&vendor=eq.${encodeURIComponent(vendor)}&limit=1`).catch(() => []);
      if (dup.length && !window.confirm(`오늘 ${vendor} 일정이 이미 있습니다. 그래도 추가할까요?`)) return;
      await upsertRow("as_tickets", {
        id: `as-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        team: teamFromRegion(row.region), date: today, time: kstNowHM(),
        vendor, contact: [row.receiver_phone, row.receiver_name].filter(Boolean).join(" "), address: "", department: "",
        model: row.model, serial: row.serial, asset: row.asset_no, grade: row.grade,
        issue: [row.title, row.symptom].filter(Boolean).join(" / ").slice(0, 500) || "서비스접수 연동",
        assignee: "", status: "접수", scheduleType: "AS",
      }, "id");
      window.alert("일정리스트에 등록했습니다. 일정리스트 탭에서 담당자를 배정하세요.");
    } catch (e) {
      window.alert(`일정 등록 실패: ${(e as Error).message}`);
    } finally {
      setScheduleBusyId("");
    }
  };

  const toggleRemoteDone = async (row: ServiceReceptionRow) => {
    const next = row.status === "원격대기" ? "원격완료" : "원격대기";
    try {
      await setServiceReceptionStatus(row.id, next);
      setListRows((current) => current.map((r) => r.id === row.id ? { ...r, status: next } : r));
    } catch (e) {
      window.alert(`상태 변경 실패: ${(e as Error).message}`);
    }
  };

  // ---- 통계 ----
  const counts = useMemo(() => ({
    total: listRows.length,
    copier: listRows.filter((r) => r.type === "복합기 AS").length,
    it: listRows.filter((r) => r.type === "IT AS").length,
    remote: listRows.filter((r) => r.type === "원격이관").length,
    remoteWaiting: listRows.filter((r) => r.status === "원격대기").length,
  }), [listRows]);
  const byAuthor = useMemo(() => {
    const map = new Map<string, { total: number; copier: number; it: number; remote: number }>();
    for (const r of listRows) {
      const key = r.author || "미지정";
      const entry = map.get(key) || { total: 0, copier: 0, it: 0, remote: 0 };
      entry.total += 1;
      if (r.type === "복합기 AS") entry.copier += 1;
      else if (r.type === "IT AS") entry.it += 1;
      else entry.remote += 1;
      map.set(key, entry);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].total - a[1].total);
  }, [listRows]);
  const filteredRows = useMemo(() => listFilter === "전체" ? listRows : listRows.filter((r) => r.type === listFilter), [listRows, listFilter]);
  const isToday = listDate === kstDate();

  return (
    <div className="space-y-4 pb-16">
      {/* 헤더 + 요약 */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-950">서비스 접수</h2>
            <p className="mt-1 text-xs font-semibold text-slate-500">고객 연락(카카오·전화)을 접수하고, 임대리스트 매칭 → 보고 양식 → 팀방 전송까지 처리합니다.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {[["오늘 접수", counts.total], ["복합기", counts.copier], ["IT", counts.it], ["원격", counts.remote], ["원격대기", counts.remoteWaiting]].map(([label, value]) => (
              <div key={String(label)} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-center">
                <div className="text-[10px] font-bold text-slate-400">{label}{!isToday && label === "오늘 접수" ? ` (${listDate.slice(5)})` : ""}</div>
                <div className="text-lg font-black text-slate-900">{value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(380px,440px)]">
        {/* ==== 좌: 접수 작성 ==== */}
        <div className="space-y-4">
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-black text-slate-400">접수경로</span>
              {(["카카오", "전화"] as ReceiveRoute[]).map((r) => <button key={r} type="button" onClick={() => setRoute(r)} className={`rounded-md px-3.5 py-2 text-xs font-black ${route === r ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>{r}</button>)}
              <span className="ml-3 text-xs font-black text-slate-400">접수유형</span>
              {(["복합기 AS", "IT AS", "원격이관"] as ReceiveType[]).map((t) => <button key={t} type="button" onClick={() => { setType(t); setActionResult(""); }} className={`rounded-md px-3.5 py-2 text-xs font-black ${type === t ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"}`}>{t}</button>)}
            </div>
            <div className="mt-3 flex gap-2">
              <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void runSearch(); }} placeholder="임대리스트 검색 — 업체명 / 자산기번 / 순번" className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2.5 text-sm font-semibold outline-none focus:border-blue-500" />
              <button type="button" onClick={() => void runSearch()} disabled={searching} className="shrink-0 rounded-md bg-blue-600 px-5 py-2.5 text-sm font-black text-white disabled:opacity-50">{searching ? "검색중" : "검색"}</button>
            </div>
            {searched && !results.length && !lease && <div className="mt-2 text-xs font-bold text-slate-400">검색 결과가 없습니다.</div>}
            {results.length > 0 && <div className="mt-2 max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
              {results.map((hit, index) => {
                const sameVendor = resultVendorCounts.get((hit["_업체명"] || "").trim()) || 0;
                const leaseState = pick(hit, "임대여부");
                const ended = leaseState && leaseState !== "임대중";
                return (
                  <button key={index} type="button" onClick={() => void selectLease(hit)} className={`block w-full px-3 py-2.5 text-left hover:bg-blue-50/50 ${ended ? "opacity-60" : ""}`}>
                    <div className="flex items-center gap-1.5 text-sm font-black text-slate-800">
                      <span className="truncate">{pick(hit, "거래처명", "_업체명")}</span>
                      <span className="shrink-0 text-[10px] font-bold text-slate-400">순{pick(hit, "순")}</span>
                      {ended && <span className="shrink-0 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-black text-rose-600">{leaseState}</span>}
                      {sameVendor > 1 && <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-700">기기 {sameVendor}대</span>}
                    </div>
                    <div className="text-[11px] font-semibold text-slate-500">{pick(hit, "품목", "모델명", "기종")} · {pick(hit, "모델명", "기종")} · 자산 {pick(hit, "자산번호") || "-"} · 기번 {pick(hit, "시리얼번호(기번)") || "-"} · {pick(hit, "담당지역")}</div>
                  </button>
                );
              })}
            </div>}
            {lease && <div className="mt-3 rounded-md border border-blue-100 bg-blue-50/40 p-3">
              <div className="flex items-center justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm font-black text-slate-900">
                  <span className="truncate">{pick(lease, "거래처명", "_업체명")}</span>
                  {workinName && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-black text-emerald-700">워킨맵 매칭</span>}
                  {pick(lease, "임대여부") && pick(lease, "임대여부") !== "임대중" && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-black text-rose-600">{pick(lease, "임대여부")} 기기</span>}
                  {deviceSummary.active > 1 && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-700">임대중 {deviceSummary.active}대({deviceSummary.items.map(([item, n]) => `${item} ${n}`).join(" · ")}) — 자산·기번 확인</span>}
                </div>
                <button type="button" onClick={resetForm} className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-black text-slate-500">다시 검색</button>
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-semibold text-slate-600 sm:grid-cols-3 lg:grid-cols-4">
                <span>모델 {pick(lease, "모델명") || "-"}</span>
                <span>자산 {pick(lease, "자산번호") || "-"}</span>
                <span>기번 {pick(lease, "시리얼번호(기번)") || "-"}</span>
                <span>등급 {pick(lease, "등급") || "-"}</span>
                <span>지역 {region || "-"}</span>
                <span>종료 {pick(lease, "종료일") || "-"}</span>
                <span>미수 {pick(lease, "미수개월수") || "0"}개월</span>
                <span className="text-rose-600">{asHistory.length ? `AS이력 기기 ${asHistory.filter((h) => h.serialMatch).length}회 · 업체 ${asHistory.length}회` : "AS이력 없음"}</span>
              </div>
            </div>}
            {!lease && type === "원격이관" && <label className="mt-3 block text-[11px] font-black text-slate-500">업체명 직접 입력 (임대리스트 미매칭 시)
              <input value={manualVendor} onChange={(e) => setManualVendor(e.target.value)} placeholder="업체명" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold" />
            </label>}
          </section>

          {(lease || (type === "원격이관" && manualVendor.trim())) && <>
            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-black text-slate-400">접수 내용</div>
              <div className="mt-2 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {([["접수자성함", "접수자 성함"], ["접수자연락처", "접수자 연락처"], ["제목", "제목(짧게)"]] as [keyof Manual, string][]).map(([key, label]) => (
                  <label key={key} className="text-[11px] font-black text-slate-500">{label}
                    <input value={manual[key]} onChange={(e) => setManual({ ...manual, [key]: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm font-semibold text-slate-900" />
                  </label>
                ))}
                <label className="text-[11px] font-black text-slate-500 sm:col-span-2 lg:col-span-3">증상/내용
                  <textarea value={manual.증상} onChange={(e) => setManual({ ...manual, 증상: e.target.value })} rows={2} className="mt-1 w-full resize-y rounded-md border border-slate-300 px-2.5 py-2 text-sm font-semibold text-slate-900" />
                </label>
                {type !== "원격이관" && <>
                  <label className="text-[11px] font-black text-slate-500">유상/무상
                    <select value={manual.유상무상} onChange={(e) => setManual({ ...manual, 유상무상: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm font-semibold text-slate-900">{["무상", "유상", "보증"].map((v) => <option key={v}>{v}</option>)}</select>
                  </label>
                  <label className="text-[11px] font-black text-slate-500">교체이력 (예: 1회)
                    <input value={manual.교체이력} onChange={(e) => setManual({ ...manual, 교체이력: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm font-semibold text-slate-900" />
                  </label>
                  <label className="text-[11px] font-black text-slate-500">참고사항
                    <input value={manual.참고사항} onChange={(e) => setManual({ ...manual, 참고사항: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm font-semibold text-slate-900" />
                  </label>
                </>}
                {type === "원격이관" && <label className="text-[11px] font-black text-slate-500 sm:col-span-2 lg:col-span-3">처리 내용/메모
                  <input value={manual.참고사항} onChange={(e) => setManual({ ...manual, 참고사항: e.target.value })} placeholder="원격 안내 내용, 후속 필요사항 등" className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm font-semibold text-slate-900" />
                </label>}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {type === "복합기 AS" && <button type="button" onClick={() => void handleSaveAndSend()} disabled={busy || !report} className="rounded-md bg-blue-600 px-5 py-2.5 text-sm font-black text-white disabled:opacity-50">{busy ? "처리중…" : "접수 저장 + AS방 전송"}</button>}
                {type === "IT AS" && <span className="rounded-md bg-slate-100 px-3 py-2 text-[11px] font-bold text-slate-500">IT방 전송은 미정 — 저장 후 복사해 사용</span>}
                <button type="button" onClick={() => void handleSave()} disabled={busy} className={`rounded-md px-5 py-2.5 text-sm font-black disabled:opacity-50 ${type === "복합기 AS" ? "border border-slate-300 bg-white text-slate-700" : "bg-blue-600 text-white"}`}>{busy ? "처리중…" : type === "원격이관" ? "원격 접수 저장 (대기)" : "접수 저장"}</button>
                {actionResult && <span className={`rounded-md px-3 py-2 text-[11px] font-black ${actionResult.includes("실패") ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>{actionResult}</span>}
              </div>
            </section>

            {type !== "원격이관" && lease && <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-xs font-black text-slate-400">카톡 보고용 양식</div>
                <button type="button" onClick={() => void copyReport()} className="rounded-md border border-slate-300 bg-white px-4 py-1.5 text-xs font-black text-slate-700">{copied ? "복사됨 ✓" : "복사"}</button>
              </div>
              <textarea value={report} readOnly rows={18} className="mt-2 w-full resize-y rounded-md border border-slate-200 bg-slate-50 p-2.5 font-mono text-[11px] leading-5 text-slate-700" />
            </section>}
          </>}
        </div>

        {/* ==== 우: 접수 현황 ==== */}
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm xl:sticky xl:top-6">
          <div className="border-b border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-slate-950">접수 현황</h3>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setListDate(listPeriod === "day" ? shiftDate(listDate, -1) : listPeriod === "week" ? shiftDate(listDate, -7) : shiftMonths(listDate, listPeriod === "month" ? -1 : -3))} className="h-8 w-8 rounded-md border border-slate-200 text-sm font-black text-slate-500">‹</button>
                <input type="date" value={listDate} onChange={(e) => e.target.value && setListDate(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1.5 text-xs font-bold text-slate-700" />
                <button type="button" onClick={() => setListDate(listPeriod === "day" ? shiftDate(listDate, 1) : listPeriod === "week" ? shiftDate(listDate, 7) : shiftMonths(listDate, listPeriod === "month" ? 1 : 3))} className="h-8 w-8 rounded-md border border-slate-200 text-sm font-black text-slate-500">›</button>
                {!isToday && <button type="button" onClick={() => setListDate(kstDate())} className="rounded-md bg-slate-900 px-2.5 py-1.5 text-[11px] font-black text-white">오늘</button>}
              </div>
            </div>
            <div className="mt-2.5 grid grid-cols-4 rounded-md bg-slate-100 p-1">
              {(Object.keys(PERIOD_LABEL) as ListPeriod[]).map((p) => (
                <button key={p} type="button" onClick={() => setListPeriod(p)} className={`rounded px-2 py-1.5 text-[11px] font-black ${listPeriod === p ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{PERIOD_LABEL[p]}</button>
              ))}
            </div>
            {listPeriod !== "day" && <div className="mt-1.5 text-[10px] font-bold text-slate-400">{periodRangeOf(listPeriod, listDate).start} ~ {periodRangeOf(listPeriod, listDate).end} · {counts.total}건</div>}
            <div className="mt-2.5 flex gap-1">
              {(["전체", "복합기 AS", "IT AS", "원격이관"] as const).map((f) => (
                <button key={f} type="button" onClick={() => setListFilter(f)} className={`rounded-md px-2.5 py-1.5 text-[11px] font-black ${listFilter === f ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>
                  {f === "전체" ? `전체 ${counts.total}` : f === "복합기 AS" ? `복합기 ${counts.copier}` : f === "IT AS" ? `IT ${counts.it}` : `원격 ${counts.remote}`}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[52vh] divide-y divide-slate-100 overflow-y-auto">
            {listLoading && <div className="p-8 text-center text-xs font-bold text-slate-400">불러오는 중…</div>}
            {!listLoading && !filteredRows.length && <div className="p-8 text-center text-xs font-bold text-slate-400">{listPeriod === "day" ? `${listDate.slice(5)} 접수 기록이 없습니다.` : `${PERIOD_LABEL[listPeriod]} 접수 기록이 없습니다.`}</div>}
            {!listLoading && filteredRows.map((row) => (
              <div key={row.id}>
                <button type="button" onClick={() => setOpenRowId(openRowId === row.id ? "" : row.id)} className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-2 px-4 py-2.5 text-left hover:bg-slate-50">
                  <span className={`rounded px-1.5 py-1 text-[10px] font-black ${TYPE_TONE[row.type] || "bg-slate-100 text-slate-600"}`}>{row.type === "복합기 AS" ? "복합기" : row.type === "IT AS" ? "IT" : "원격"}</span>
                  <span className="min-w-0">
                    <b className="block truncate text-sm text-slate-800">{row.vendor || "업체 미기재"}</b>
                    <span className="text-[10px] font-semibold text-slate-400">{listPeriod === "day" ? kstTime(row.created_at) : `${row.receipt_date.slice(5).replace("-", "/")} ${kstTime(row.created_at)}`} · {row.author || "접수자 미지정"} · {row.title || row.symptom.slice(0, 20) || "-"}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className={`rounded px-1.5 py-1 text-[10px] font-black ${STATUS_TONE[row.status] || "bg-slate-100 text-slate-500"}`}>{row.status}</span>
                    {row.type === "원격이관" && <span onClick={(e) => { e.stopPropagation(); void toggleRemoteDone(row); }} className={`cursor-pointer rounded px-2 py-1 text-[10px] font-black ${row.status === "원격대기" ? "bg-emerald-600 text-white" : "border border-slate-200 text-slate-400"}`}>{row.status === "원격대기" ? "완료" : "대기로"}</span>}
                  </span>
                </button>
                {openRowId === row.id && <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 text-[11px] leading-5 text-slate-600">
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-semibold">
                    <span>경로 {row.route}</span><span>지역 {row.region || "-"}</span>
                    <span>모델 {row.model || "-"}</span><span>기번 {row.serial || "-"}</span>
                    <span>유상/무상 {row.paid}</span><span>접수 {kstTime(row.created_at)}</span>
                  </div>
                  {row.symptom && <div className="mt-1.5 whitespace-pre-wrap"><b className="text-slate-500">증상</b> {row.symptom}</div>}
                  {row.notes && <div className="mt-1 whitespace-pre-wrap"><b className="text-slate-500">메모</b> {row.notes}</div>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {row.report_text && <button type="button" onClick={() => void navigator.clipboard.writeText(row.report_text)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-black text-slate-600">양식 다시 복사</button>}
                    {row.type !== "원격이관" && <button type="button" disabled={scheduleBusyId === row.id} onClick={() => void addToSchedule(row)} className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-[11px] font-black text-blue-700 disabled:opacity-50">{scheduleBusyId === row.id ? "등록 중…" : "일정 등록"}</button>}
                    {row.type !== "원격이관" && onUseField && <button type="button" onClick={() => onUseField(receptionToFieldText(row))} className="rounded-md bg-slate-900 px-3 py-1.5 text-[11px] font-black text-white">FIELD 변환</button>}
                  </div>
                </div>}
              </div>
            ))}
          </div>

          {byAuthor.length > 0 && <div className="border-t border-slate-200 p-4">
            <div className="text-[11px] font-black text-slate-400">접수자별 처리 ({listPeriod === "day" ? listDate.slice(5) : PERIOD_LABEL[listPeriod]})</div>
            <div className="mt-2 space-y-1">
              {byAuthor.map(([name, stat]) => (
                <div key={name} className="flex items-center justify-between text-xs">
                  <span className="font-black text-slate-700">{name}</span>
                  <span className="font-bold text-slate-500">총 {stat.total} <span className="text-blue-600">복합기 {stat.copier}</span> · <span className="text-cyan-600">IT {stat.it}</span> · <span className="text-violet-600">원격 {stat.remote}</span></span>
                </div>
              ))}
            </div>
          </div>}
        </section>
      </div>
    </div>
  );
}
