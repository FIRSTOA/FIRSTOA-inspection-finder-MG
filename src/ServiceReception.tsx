import { useCallback, useEffect, useMemo, useState } from "react";
import {
  searchLeaseList, getAsHistory, getRecentInspections, findWorkinMapName, sendServiceReception,
  saveServiceReception, getServiceReceptions, setServiceReceptionStatus, updateServiceReception, getLeaseDeviceSummary,
  type LeaseHit, type ServiceReceptionRow, type AsHistoryEntry, type InspectionSnapshot, type LeaseDeviceSummary,
} from "./api";
import { kstDate } from "./visits";
import { selectRows, upsertRow, uploadPhoto } from "./supabase";
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
// 주소에서 층/호 추출 — FIELD 복붙 변환기(extractDepartment)와 같은 규칙으로 부서명을 만든다.
function deptFromAddress(text: string): string {
  const basement = text.match(/(지하\s*\d+층|B\s*\d+층)/i);
  if (basement) return basement[1].replace(/\s+/g, "");
  const spaced = text.match(/(?:^|\s)(\d{1,2})층/);
  if (spaced) return `${spaced[1]}층`;
  const merged = text.match(/(\d+)층/);
  if (merged) return merged[1].length <= 2 ? `${merged[1]}층` : `${merged[1].slice(-1)}층`;
  const ho = text.match(/(\d+호)/);
  return ho ? ho[1] : "";
}
function teamFromRegion(region: string) {
  const m = String(region || "").match(/수도권([A-D])/);
  return (m ? m[1] : "A") as "A" | "B" | "C" | "D";
}
// 증상 사진 업로드용 다운스케일 (원본 폰 사진은 수 MB — 1600px JPEG로 줄여 저장)
async function downscaleImage(file: File, maxSize = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  if (scale >= 1) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob || file), "image/jpeg", 0.85));
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
  전송완료: "bg-blue-50 text-blue-700",
  완료: "bg-emerald-50 text-emerald-700",
  익일: "bg-purple-50 text-purple-700",
  원격대기: "bg-amber-50 text-amber-700",
  원격완료: "bg-emerald-50 text-emerald-700",
};

type Manual = { 접수자성함: string; 접수자연락처: string; 제목: string; 증상: string; 유상무상: string; 참고사항: string; 교체이력: string; 주소: string };
const EMPTY_MANUAL: Manual = { 접수자성함: "", 접수자연락처: "", 제목: "", 증상: "", 유상무상: "무상", 참고사항: "", 교체이력: "", 주소: "" };

export default function ServiceReception({ author }: { author: string }) {
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
  const [photos, setPhotos] = useState<Array<{ url: string; name: string }>>([]);
  const [confirmAction, setConfirmAction] = useState<"save" | "send" | null>(null);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [scheduleToo, setScheduleToo] = useState(true); // 저장하면서 일정리스트에도 등록
  const [photoBusy, setPhotoBusy] = useState(false);

  const handlePhotoPick = async (files: FileList | null) => {
    if (!files || !files.length || photoBusy) return;
    setPhotoBusy(true);
    try {
      const uploaded: Array<{ url: string; name: string }> = [];
      for (const file of Array.from(files).slice(0, 6 - photos.length)) {
        const blob = await downscaleImage(file);
        const path = `reception/${crypto.randomUUID()}.jpg`;
        const url = await uploadPhoto(path, blob);
        uploaded.push({ url, name: file.name });
      }
      setPhotos((prev) => [...prev, ...uploaded]);
    } catch (e) {
      window.alert(`사진 업로드 실패: ${(e as Error).message}`);
    } finally {
      setPhotoBusy(false);
    }
  };
  const [actionResult, setActionResult] = useState("");

  // 접수 현황 리스트
  const [listDate, setListDate] = useState(kstDate());
  const [listPeriod, setListPeriod] = useState<ListPeriod>("day");
  const [listRows, setListRows] = useState<ServiceReceptionRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listFilter, setListFilter] = useState<"전체" | "복합기 AS" | "IT AS" | "원격이관" | "주소확인">("전체");
  const [openRowId, setOpenRowId] = useState("");
  const [previewRow, setPreviewRow] = useState<ServiceReceptionRow | null>(null);
  const [previewCopied, setPreviewCopied] = useState(false);

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
  useEffect(() => {
    const onFocus = () => { void loadList(listDate, listPeriod); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [listDate, listPeriod, loadList]);

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
    setManual((prev) => ({ ...prev, 주소: pick(hit, "주소(실납품주소,도로명주소)", "주소") }));
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
    const 주소 = manual.주소.trim() || pick(lease, "주소(실납품주소,도로명주소)", "주소");
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
      `★키맨성함/번호${T}${키맨.includes("\n") ? `"${키맨}"` : 키맨}`,
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
      keyman_info: [
        pick(lease, "일반전화") ? `일반전화 ${pick(lease, "일반전화")}` : "",
        pick(lease, "키맨") ? `★키맨성함/번호 ${pick(lease, "키맨")}` : "",
      ].filter(Boolean).join("\n"),
      lease_no: pick(lease, "순"),
      address: manual.주소.trim() || pick(lease, "주소(실납품주소,도로명주소)", "주소"),
      // 임대리스트 주소와 다르게 접수된 건 표시 — 시트 원본 주소 정비 대상 목록이 된다
      ...(manual.주소.trim() && manual.주소.trim() !== pick(lease, "주소(실납품주소,도로명주소)", "주소") ? { address_changed: true } : {}),
      // photos 컬럼 SQL 실행 전에도 일반 저장은 되도록, 사진이 있을 때만 포함
      ...(photos.length ? { photos: photos.map((photo) => photo.url) } : {}),
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
    setSearched(false); setWorkinName(""); setManualVendor(""); setSavedRowId(null); setPhotos([]);
  };

  // 저장만 (복합기/IT) 또는 원격 접수 저장(대기)
  const handleSave = async () => {
    if (busy) return;
    if (!vendorName) { setActionResult("업체를 선택(또는 입력)하세요."); return; }
    setBusy(true);
    setActionResult("");
    try {
      const rowId = await persist(type === "원격이관" ? "원격대기" : "접수");
      let scheduled = false;
      if (scheduleToo && type !== "원격이관") {
        try { scheduled = await createTicketFromReception(formSnapshotForTicket(rowId), false); } catch { /* 일정 등록 실패해도 접수 저장은 유효 */ }
      }
      setActionResult(type === "원격이관" ? "원격 접수 저장됨 (대기)" : `접수 저장됨${scheduled ? " + 일정 등록됨" : ""}`);
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
      let scheduled = false;
      if (scheduleToo && rowId) {
        try { scheduled = await createTicketFromReception(formSnapshotForTicket(rowId), false); } catch { /* 일정 등록 실패해도 전송은 유효 */ }
      }
      setActionResult(`전송 완료 — ${room}${res.testMode ? " (테스트 모드)" : ""}${scheduled ? " + 일정 등록됨" : ""}`);
      setSavedRowId(null);
      resetForm();
      await loadList(listDate, listPeriod);
    } catch (e) {
      setActionResult(`처리 실패: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // 접수 → 일정리스트(as_tickets) 등록 공용 로직 (수동 버튼·저장 시 자동 등록이 함께 쓴다)
  const createTicketFromReception = async (row: Pick<ServiceReceptionRow, "id" | "vendor" | "region" | "model" | "serial" | "asset_no" | "grade" | "keyman_info" | "receiver_name" | "receiver_phone" | "title" | "symptom" | "address">, confirmDup: boolean) => {
    const today = kstDate();
    const vendor = cleanVendorName(row.vendor);
    if (confirmDup) {
      const dup = await selectRows<{ id: string }>("as_tickets", `select=id&date=eq.${today}&vendor=eq.${encodeURIComponent(vendor)}&limit=1`).catch(() => []);
      if (dup.length && !window.confirm(`오늘 ${vendor} 일정이 이미 있습니다. 그래도 추가할까요?`)) return false;
    }
    await upsertRow("as_tickets", {
      id: `as-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      team: teamFromRegion(row.region), date: today, time: kstNowHM(),
      vendor, contact: (row.receiver_name || row.receiver_phone) ? `접수자 ${[row.receiver_name, row.receiver_phone].filter(Boolean).join(" ")}` : "",
      address: row.address || "", department: deptFromAddress(row.address || ""),
      model: row.model, serial: row.serial, asset: row.asset_no, grade: row.grade, keyman: row.keyman_info || "",
      issue: (row.symptom || row.title || "").slice(0, 500) || "서비스접수 연동",
      assignee: "", status: "접수", scheduleType: "AS", receptionId: row.id,
    }, "id");
    return true;
  };

  const [scheduleBusyId, setScheduleBusyId] = useState("");
  const addToSchedule = async (row: ServiceReceptionRow) => {
    if (scheduleBusyId) return;
    setScheduleBusyId(row.id);
    try {
      const created = await createTicketFromReception(row, true);
      if (created) window.alert("일정리스트에 등록했습니다. 일정리스트 탭에서 담당자를 배정하세요.");
    } catch (e) {
      window.alert(`일정 등록 실패: ${(e as Error).message}`);
    } finally {
      setScheduleBusyId("");
    }
  };

  // 저장 직후 자동 일정 등록에 쓸 현재 폼 스냅샷
  const formSnapshotForTicket = (id: string) => ({
    id, vendor: vendorName, region,
    model: pick(lease, "모델명", "기종"), serial: pick(lease, "시리얼번호(기번)", "기번"),
    asset_no: pick(lease, "자산번호"), grade: pick(lease, "등급"),
    keyman_info: [
      pick(lease, "일반전화") ? `일반전화 ${pick(lease, "일반전화")}` : "",
      pick(lease, "키맨") ? `★키맨성함/번호 ${pick(lease, "키맨")}` : "",
    ].filter(Boolean).join("\n"),
    receiver_name: manual.접수자성함.trim(), receiver_phone: manual.접수자연락처.trim(),
    title: manual.제목, symptom: manual.증상,
    address: manual.주소.trim() || pick(lease, "주소(실납품주소,도로명주소)", "주소"),
  });

  // 시트 원본 주소를 고친 뒤 누르면 '주소확인' 목록에서 내려간다.
  // 플래그를 지우지 않고 처리자·처리일을 남겨 나중에 누가 반영했는지 추적 가능.
  const resolveAddress = async (row: ServiceReceptionRow) => {
    if (!window.confirm("임대리스트 시트의 주소를 수정하셨나요? 확인 목록에서 제외합니다. (처리자와 처리일이 기록됩니다)")) return;
    try {
      const patch = { address_resolved_at: new Date().toISOString(), address_resolved_by: author || "미지정" };
      await updateServiceReception(row.id, patch);
      setListRows((current) => current.map((r) => r.id === row.id ? { ...r, ...patch } : r));
    } catch (e) {
      window.alert(`처리 실패: ${(e as Error).message}\n(dev-notes.sql 실행 여부를 확인하세요)`);
    }
  };

  const removeReception = async (row: ServiceReceptionRow) => {
    if (!window.confirm(`${row.vendor || "이 접수"} 건을 삭제할까요? (잘못 접수된 건 정리용)`)) return;
    try {
      await updateServiceReception(row.id, { deleted: true });
      setListRows((current) => current.filter((r) => r.id !== row.id));
    } catch (e) {
      window.alert(`삭제 실패: ${(e as Error).message}\n(reception-sync.sql 실행 여부를 확인하세요)`);
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
    addr: listRows.filter((r) => r.address_changed && !r.address_resolved_at).length,
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
  const filteredRows = useMemo(() => listFilter === "전체" ? listRows : listFilter === "주소확인" ? listRows.filter((r) => r.address_changed && !r.address_resolved_at) : listRows.filter((r) => r.type === listFilter), [listRows, listFilter]);
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
                <label className="text-[11px] font-black text-amber-700 sm:col-span-2 lg:col-span-3">방문 주소 (기사가 가는 주소 — 임대리스트와 다르면 꼭 수정)
                  <input value={manual.주소} onChange={(e) => setManual({ ...manual, 주소: e.target.value })} placeholder="주소 미기재" className="mt-1 w-full rounded-md border border-amber-300 bg-amber-50/40 px-2.5 py-2 text-sm font-semibold text-slate-900" />
                </label>
                <div className="text-[11px] font-black text-slate-500 sm:col-span-2 lg:col-span-3">증상 사진 (최대 6장)
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {photos.map((photo, index) => (
                      <span key={photo.url} className="relative">
                        <a href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={photo.name} className="h-16 w-16 rounded-md border border-slate-200 object-cover" /></a>
                        <button type="button" onClick={() => setPhotos((prev) => prev.filter((_, i) => i !== index))} className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[10px] font-black text-white">×</button>
                      </span>
                    ))}
                    {photos.length < 6 && <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-md border border-dashed border-slate-300 text-xl text-slate-400 hover:border-blue-400">
                      {photoBusy ? "…" : "+"}
                      <input type="file" accept="image/*" multiple disabled={photoBusy} onChange={(e) => { void handlePhotoPick(e.target.files); e.target.value = ""; }} className="hidden" />
                    </label>}
                  </div>
                </div>
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
                {type === "복합기 AS" && <button type="button" onClick={() => setConfirmAction("send")} disabled={busy || !report} className="rounded-md bg-blue-600 px-5 py-2.5 text-sm font-black text-white disabled:opacity-50">{busy ? "처리중…" : "접수 저장 + AS방 전송"}</button>}
                {type === "IT AS" && <span className="rounded-md bg-slate-100 px-3 py-2 text-[11px] font-bold text-slate-500">IT방 전송은 미정 — 저장 후 복사해 사용</span>}
                <button type="button" onClick={() => type === "원격이관" ? void handleSave() : setConfirmAction("save")} disabled={busy} className={`rounded-md px-5 py-2.5 text-sm font-black disabled:opacity-50 ${type === "복합기 AS" ? "border border-slate-300 bg-white text-slate-700" : "bg-blue-600 text-white"}`}>{busy ? "처리중…" : type === "원격이관" ? "원격 접수 저장 (대기)" : "접수 저장"}</button>
                {actionResult && <span className={`rounded-md px-3 py-2 text-[11px] font-black ${actionResult.includes("실패") ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>{actionResult}</span>}
              </div>
            </section>

            {confirmAction && (() => {
              const checkItems: Array<[string, string, boolean]> = [
                ["접수경로", route, true],
                ["접수유형", type, true],
                ["업체명", vendorName, true],
                ["기종", pick(lease, "모델명", "기종"), true],
                ["시리얼(기번)", pick(lease, "시리얼번호(기번)", "기번"), true],
                ["자산기번", pick(lease, "자산번호"), false],
                ["접수자 성함", manual.접수자성함.trim(), true],
                ["접수자 연락처", manual.접수자연락처.trim(), true],
              ];
              const missing = checkItems.filter(([, value, required]) => required && !value).length + (manual.주소.trim() ? 0 : 1);
              return (
                <div className="fixed inset-0 z-[210] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => { setConfirmAction(null); setConfirmChecked(false); }}>
                  <div className="flex max-h-[90vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-lg" onMouseDown={(e) => e.stopPropagation()}>
                    <div className="border-b border-slate-100 px-5 py-4">
                      <div className="text-xs font-black text-blue-600">{confirmAction === "send" ? "접수 저장 + AS방 전송" : "접수 저장"} 전 확인</div>
                      <div className="mt-0.5 text-base font-black text-slate-950">{vendorName}</div>
                    </div>
                    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
                      <div className={`rounded-lg border-2 p-3 ${manual.주소.trim() ? "border-amber-300 bg-amber-50" : "border-rose-300 bg-rose-50"}`}>
                        <div className="text-[11px] font-black text-slate-500">🚗 기사가 가는 방문 주소</div>
                        <div className={`mt-1 text-sm font-black ${manual.주소.trim() ? "text-slate-900" : "text-rose-600"}`}>{manual.주소.trim() || "미기재 — 주소를 확인하세요!"}</div>
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                        {checkItems.map(([label, value, required]) => (
                          <div key={label} className="rounded-md bg-slate-50 px-3 py-2">
                            <div className="text-[10px] font-black text-slate-400">{label}</div>
                            <div className={`mt-0.5 truncate text-xs font-black ${value ? "text-slate-800" : required ? "text-rose-600" : "text-slate-400"}`}>{value || "미기재"}</div>
                          </div>
                        ))}
                      </div>
                      {missing > 0 && <div className="rounded-md bg-rose-50 px-3 py-2 text-xs font-black text-rose-700">빨간 항목 {missing}개 — 그래도 진행하려면 아래 확인에 체크하세요.</div>}
                      <label className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 p-3 text-xs font-bold text-slate-700">
                        <input type="checkbox" checked={scheduleToo} onChange={(e) => setScheduleToo(e.target.checked)} className="mt-0.5 h-4 w-4 accent-blue-600" />
                        저장하면서 일정리스트에도 등록 (오늘 날짜, 담당자 미배정)
                      </label>
                      <label className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 p-3 text-xs font-bold text-slate-700">
                        <input type="checkbox" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} className="mt-0.5 h-4 w-4 accent-blue-600" />
                        방문 주소와 접수자·기기 정보를 확인했습니다{confirmAction === "send" ? " (AS방으로 전송됩니다)" : ""}
                      </label>
                    </div>
                    <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
                      <button type="button" onClick={() => { setConfirmAction(null); setConfirmChecked(false); }} className="rounded-md border border-slate-200 px-4 py-2 text-sm font-bold text-slate-500">취소</button>
                      <button type="button" disabled={!confirmChecked || busy} onClick={() => { const action = confirmAction; setConfirmAction(null); setConfirmChecked(false); if (action === "send") void handleSaveAndSend(); else void handleSave(); }} className="rounded-md bg-blue-600 px-5 py-2 text-sm font-black text-white disabled:opacity-40">{confirmAction === "send" ? "확인하고 전송" : "확인하고 저장"}</button>
                    </div>
                  </div>
                </div>
              );
            })()}

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
              {(["전체", "복합기 AS", "IT AS", "원격이관", "주소확인"] as const).map((f) => (
                <button key={f} type="button" onClick={() => setListFilter(f)} className={`rounded-md px-2.5 py-1.5 text-[11px] font-black ${listFilter === f ? "bg-slate-900 text-white" : f === "주소확인" && counts.addr > 0 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500"}`}>
                  {f === "전체" ? `전체 ${counts.total}` : f === "복합기 AS" ? `복합기 ${counts.copier}` : f === "IT AS" ? `IT ${counts.it}` : f === "원격이관" ? `원격 ${counts.remote}` : `📍주소 ${counts.addr}`}
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
                    <span className="text-[10px] font-semibold text-slate-400">{listPeriod === "day" ? kstTime(row.created_at) : `${row.receipt_date.slice(5).replace("-", "/")} ${kstTime(row.created_at)}`} · {row.author || "접수자 미지정"}</span>
                    {(row.title || row.symptom) && <span className="block truncate text-[11px] font-semibold text-slate-600">{row.title || "제목 없음"}{row.symptom ? ` — ${row.symptom}` : ""}</span>}
                  </span>
                  <span className="flex items-center gap-1.5">
                    {row.address_changed && !row.address_resolved_at && <span className="rounded bg-amber-100 px-1.5 py-1 text-[10px] font-black text-amber-800" title="임대리스트와 다른 주소로 접수됨">📍</span>}
                    <span className={`rounded px-1.5 py-1 text-[10px] font-black ${STATUS_TONE[row.status] || "bg-slate-100 text-slate-500"}`}>{row.status}</span>
                    {row.type === "원격이관" && <span onClick={(e) => { e.stopPropagation(); void toggleRemoteDone(row); }} className={`cursor-pointer rounded px-2 py-1 text-[10px] font-black ${row.status === "원격대기" ? "bg-emerald-600 text-white" : "border border-slate-200 text-slate-400"}`}>{row.status === "원격대기" ? "완료" : "대기로"}</span>}
                  </span>
                </button>
                {openRowId === row.id && <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 text-[11px] leading-5 text-slate-600">
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-semibold">
                    <span>경로 {row.route}</span><span>지역 {row.region || "-"}</span>
                    <span>모델 {row.model || "-"}</span><span>기번 {row.serial || "-"}</span>
                    <span>순 {row.lease_no || "-"}</span><span>자산기번 {row.asset_no || "-"}</span>
                    <span>접수자 {row.receiver_name || "-"}</span><span>연락처 {row.receiver_phone || "-"}</span>
                    <span>유상/무상 {row.paid}</span><span>접수 {kstTime(row.created_at)}</span>
                  </div>
                  {row.address && <div className="mt-1.5"><b className="text-slate-500">주소</b> {row.address}{row.address_changed ? (row.address_resolved_at
                    ? <span className="ml-1.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-black text-emerald-700">시트 반영됨 · {String(row.address_resolved_at).slice(0, 10)} {row.address_resolved_by || ""}</span>
                    : <>
                      <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-800">임대리스트와 다름 — 시트 주소 확인 필요</span>
                      <button type="button" onClick={(e) => { e.stopPropagation(); void resolveAddress(row); }} className="ml-1.5 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-black text-emerald-700">시트 반영 완료</button>
                    </>) : null}</div>}
                  {row.symptom && <div className="mt-1.5 whitespace-pre-wrap"><b className="text-slate-500">증상</b> {row.symptom}</div>}
                  {!!(row.photos?.length) && <div className="mt-2 flex flex-wrap gap-1.5">{row.photos.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt="증상 사진" className="h-14 w-14 rounded-md border border-slate-200 object-cover" /></a>)}</div>}
                  {row.notes && <div className="mt-1 whitespace-pre-wrap"><b className="text-slate-500">메모</b> {row.notes}</div>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {row.report_text && <button type="button" onClick={() => { setPreviewRow(row); setPreviewCopied(false); }} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-black text-slate-600">원본 미리보기</button>}
                    {row.type !== "원격이관" && <button type="button" disabled={scheduleBusyId === row.id} onClick={() => void addToSchedule(row)} className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-[11px] font-black text-blue-700 disabled:opacity-50">{scheduleBusyId === row.id ? "등록 중…" : "일정 등록"}</button>}
                    <button type="button" onClick={() => void removeReception(row)} className="rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] font-black text-rose-600">삭제</button>
                  </div>
                </div>}
              </div>
            ))}
          </div>

          {previewRow && (
            <div className="fixed inset-0 z-[200] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setPreviewRow(null)}>
              <div className="flex max-h-[85vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:max-w-2xl sm:rounded-lg" onMouseDown={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                  <div className="min-w-0">
                    <div className="text-xs font-black text-blue-600">원본 보고양식</div>
                    <div className="truncate text-base font-black text-slate-950">{previewRow.vendor || "업체 미기재"}</div>
                  </div>
                  <button type="button" onClick={() => setPreviewRow(null)} className="h-9 w-9 shrink-0 rounded-md text-xl font-black text-slate-400">×</button>
                </div>
                <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap bg-slate-50 p-4 font-mono text-[11px] leading-5 text-slate-700">{previewRow.report_text}</pre>
                <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
                  <button type="button" onClick={() => setPreviewRow(null)} className="rounded-md border border-slate-200 px-4 py-2 text-sm font-bold text-slate-500">닫기</button>
                  <button type="button" onClick={() => { void navigator.clipboard.writeText(previewRow.report_text).then(() => setPreviewCopied(true)); }} className="rounded-md bg-slate-900 px-5 py-2 text-sm font-black text-white">{previewCopied ? "복사됨 ✓" : "복사"}</button>
                </div>
              </div>
            </div>
          )}

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
