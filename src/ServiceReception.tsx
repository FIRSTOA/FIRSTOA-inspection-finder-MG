import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Building2, ChevronLeft, ChevronRight, Copy, ExternalLink, ImagePlus, Search, Send, ShieldCheck } from "lucide-react";
import {
  searchLeaseList, getAsHistory, getRecentInspections, findWorkinMapName, sendServiceReception,
  saveServiceReception, getServiceReceptions, setServiceReceptionStatus, updateServiceReception, getLeaseDeviceSummary,
  type LeaseHit, type ServiceReceptionRow, type AsHistoryEntry, type InspectionSnapshot, type LeaseDeviceSummary,
} from "./api";
import { kstDate } from "./visits";
import { selectAllRows, selectRows, updateRows, upsertRow, uploadPhoto } from "./supabase";
import { sendReceptionCopierSheetJob, sendReceptionRemoteSheetJob } from "./api";
import { prepareImageForUpload } from "./imageUpload";
import { getServiceReceptionById } from "./api";
import { vendorMatchKey } from "./ids";
import { usageSpareAdvice } from "./spareAdvice";
import { notify } from "./toast";

type ReceiveRoute = "카카오" | "전화";
type ReceiveType = "원격이관" | "복합기 AS" | "IT";

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
// 접수 당시의 시트 표기값 (접수일 "7월 31일" / 접수시각 "20:22") — 처리 단계 갱신에도 그대로 보낸다
function receiptParts(iso: string) {
  const d = new Date(iso);
  const base = Number.isNaN(d.getTime()) ? new Date() : d;
  const parts = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" }).format(base);
  return { date: parts.replace(/\.$/, "").replace(/(\d+)\.\s*(\d+)/, "$1월 $2일"), time: kstTime(iso) };
}

// "8. 1 (금) 14:32" — 상단 다크바용
function kstStamp() {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", month: "numeric", day: "numeric", weekday: "short",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date());
  return parts.replace(/\s+/g, " ").trim();
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
  IT: "bg-cyan-50 text-cyan-700",
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

// 신규 거래처(복합기 AS) 접수 시트 직접 기재 필드 — 섹션별 구성 (열: F~AT)
const NEW_LEASE_SECTIONS: { label: string; fields: [string, string][] }[] = [
  { label: "기본", fields: [["firstNo", "임대리스트 순번"], ["leaseStatus", "임대여부"], ["warranty", "보증여부"], ["misuMonths", "미수개월"]] },
  { label: "업체", fields: [["grade", "등급"], ["tel", "일반전화"], ["vendorManager", "현장 업체담당자(AK열)"], ["keyman", "키맨"]] },
  { label: "기기", fields: [["model", "모델명"], ["item", "품목"], ["maker", "제조사"], ["series", "기종"], ["assetNo", "자산번호"], ["serialNo", "기번"], ["assetSerial", "자산기번"], ["deviceState", "기기상태"], ["hanjoCode", "한조/틴텍코드"]] },
  { label: "계약·임대", fields: [["baseRent", "기본임대료"], ["avgRent", "평균임대료"], ["contractStart", "계약일"], ["contractEnd", "종료일"], ["monthsLeft", "남은개월수"], ["owner", "장비소유주"], ["installer", "설치업체"], ["visitCycle", "방문주기"], ["extraTerms", "추가조건"]] },
  { label: "기타", fields: [["notes", "특이사항"]] },
];
const EMPTY_NEW_LEASE: Record<string, string> = Object.fromEntries(NEW_LEASE_SECTIONS.flatMap((sec) => sec.fields.map(([key]) => [key, ""])));
const EMPTY_MANUAL: Manual = { 접수자성함: "", 접수자연락처: "", 제목: "", 증상: "", 유상무상: "", 참고사항: "", 교체이력: "", 주소: "" };
// 접수 시트 — 파일은 하나, 구분에 따라 탭(gid)만 다르다
const RECEPTION_SHEET_BASE = "https://docs.google.com/spreadsheets/d/1QRlW8IXoPjCyS1A4sIx0E4C1Z64Pa0hMmOWbfAOpn9g/edit#gid=";
const RECEPTION_SHEET_GID: Record<ReceiveType, string> = { "복합기 AS": "1181394897", IT: "916322987", 원격이관: "916322987" };

// 전체 주소 → 시(AL)·구(AM) 분리. 입력은 주소 한 칸만 받고 시트의 두 열은 여기서 채운다.
//  · 광역시/특별시:  "서울 강남구 역삼동"      → 시 서울,      구 강남구
//  · 도 단위:        "경기 성남시 분당구"      → 시 경기 성남시, 구 분당구
const WIDE_CITIES = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종"];
const PROVINCE_SHORT: Record<string, string> = {
  경기도: "경기", 강원도: "강원", 강원특별자치도: "강원", 충청북도: "충북", 충청남도: "충남",
  전라북도: "전북", 전북특별자치도: "전북", 전라남도: "전남", 경상북도: "경북", 경상남도: "경남",
  제주도: "제주", 제주특별자치도: "제주",
};
// 시각 입력: 숫자만 쳐도 콜론이 자동으로 들어간다 ("1531" → "15:31").
// type="time"은 브라우저 로케일에 따라 오전/오후로 표시돼 24시간 표기를 강제할 수 없어 직접 처리한다.
function typeTime(raw: string): string {
  const digits = String(raw || "").replace(/[^0-9]/g, "").slice(0, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`;
}
// 입력을 마치면 HH:mm으로 보정 — "9" → 09:00, "931" → 09:31, "1531" → 15:31 (범위 초과는 잘라 맞춤)
function normalizeTime(raw: string): string {
  const digits = String(raw || "").replace(/[^0-9]/g, "");
  if (!digits) return "";
  const [hh, mm] = digits.length <= 2 ? [digits, "0"]
    : digits.length === 3 ? [digits.slice(0, 1), digits.slice(1)]
    : [digits.slice(0, 2), digits.slice(2)];
  const hour = Math.min(23, Number(hh) || 0);
  const minute = Math.min(59, Number(mm) || 0);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function splitCityDistrict(address: string): { city: string; district: string } {
  const tokens = String(address || "").trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { city: "", district: "" };
  const district = tokens.find((token) => token.length >= 2 && /(구|군)$/.test(token)) || "";
  const head = tokens[0].replace(/(특별자치시|특별시|광역시)$/, "");
  // 광역시·특별시는 시 열에 그 이름만 (구는 구 열로)
  if (WIDE_CITIES.includes(head)) return { city: head, district };
  // 도 단위는 "도 + 시"를 시 열에 함께 넣는다
  const province = PROVINCE_SHORT[tokens[0]] || tokens[0].replace(/(특별자치도|도)$/, "");
  const cityToken = tokens.slice(1).find((token) => /시$/.test(token)) || "";
  const city = [province, cityToken].filter(Boolean).join(" ");
  // 시 열에 이미 시 이름이 들어갔으면 구 열은 구/군만 남긴다
  return { city, district: district === cityToken ? "" : district };
}

export default function ServiceReception({ author }: { author: string }) {
  const [route, setRoute] = useState<ReceiveRoute>("카카오");
  const [type, setType] = useState<ReceiveType>("복합기 AS");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LeaseHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [lease, setLease] = useState<LeaseHit | null>(null);
  const [manual, setManual] = useState<Manual>(EMPTY_MANUAL);
  // 접수 시트 기입용: 기존(임대리스트 순번으로 시트 함수 자동 채움) / 신규(직접 기재 — 준비 중)
  const [custKind, setCustKind] = useState<"기존" | "신규">("기존");
  const [firstNo, setFirstNo] = useState("");
  const [fieldChoice, setFieldChoice] = useState("A/S");
  const [fieldCustom, setFieldCustom] = useState("");
  const [paidCustom, setPaidCustom] = useState("");
  const [newLease, setNewLease] = useState<Record<string, string>>({ ...EMPTY_NEW_LEASE });
  // 원격·IT 접수 시트('원격' 탭) 전용 입력 — IT/원격이관은 같은 탭을 쓰고 L열(한조처리)로만 갈린다
  const [remote, setRemote] = useState({ hanjoCustom: "", hanjoDirect: false });
  const isRemoteType = type === "IT" || type === "원격이관";
  // 한조처리(L): 직접입력이면 그 값, 아니면 구분에서 파생 — IT면 반드시 "IT", 원격이관은 공백
  const hanjoFinal = remote.hanjoDirect ? remote.hanjoCustom.trim() : (type === "IT" ? "IT" : "");
  const fieldFinal = fieldChoice === "직접기재" ? fieldCustom.trim() || "A/S" : fieldChoice;
  const paidFinal = manual.유상무상 === "직접기재" ? paidCustom.trim() || "무상" : manual.유상무상;
  const [manualVendor, setManualVendor] = useState("");
  const [asHistory, setAsHistory] = useState<AsHistoryEntry[]>([]);
  useEffect(() => { if (lease) setFirstNo(String(lease["순"] ?? "").trim()); }, [lease]);
  const [snapshots, setSnapshots] = useState<InspectionSnapshot[]>([]);
  const [snapshotDeviceMatch, setSnapshotDeviceMatch] = useState(true);
  const [deviceSummary, setDeviceSummary] = useState<LeaseDeviceSummary>({ active: 0, items: [] });
  const [workinName, setWorkinName] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedRowId, setSavedRowId] = useState<string | null>(null);
  const sheetRowTargetRef = useRef<string>("");   // 접수 저장 직후 시트 행번호를 기록할 대상 접수 id
  const [photos, setPhotos] = useState<Array<{ url: string; name: string }>>([]);
  const [confirmAction, setConfirmAction] = useState<"save" | "send" | null>(null);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [scheduleToo, setScheduleToo] = useState(true); // 저장하면서 일정리스트에도 등록
  const [photoBusy, setPhotoBusy] = useState(false);

  const handlePhotoPick = async (files: FileList | File[] | null) => {
    if (!files || !files.length || photoBusy) return;
    setPhotoBusy(true);
    try {
      const uploaded: Array<{ url: string; name: string }> = [];
      for (const file of Array.from(files).slice(0, 6 - photos.length)) {
        // 모바일(HEIC·고화소)에서도 실패하지 않게 — 축소 불가 시 원본을 실제 형식으로 올린다
        const prepared = await prepareImageForUpload(file, 1600);
        const url = await uploadPhoto(`reception/${crypto.randomUUID()}.${prepared.ext}`, prepared.blob, prepared.contentType);
        uploaded.push({ url, name: file.name });
      }
      setPhotos((prev) => [...prev, ...uploaded]);
    } catch (e) {
      notify(`사진 업로드 실패: ${(e as Error).message}`, "error");
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
  const [listFilter, setListFilter] = useState<"전체" | "복합기 AS" | "IT" | "원격이관" | "주소확인">("전체");
  const [openRowId, setOpenRowId] = useState("");
  // 화면을 한 번에 하나만 보여준다: 복합기 접수 / 원격·IT 접수+처리 / 전체 접수 리스트
  const [page, setPage] = useState<"copier" | "remote" | "list">(() => {
    try { const saved = localStorage.getItem("reception_page_v1"); return saved === "remote" || saved === "list" ? saved : "copier"; } catch { return "copier"; }
  });
  useEffect(() => { try { localStorage.setItem("reception_page_v1", page); } catch { /* 무시 */ } }, [page]);
  // 원격·IT 작업 보드는 기간과 무관하게 최근 30일 건을 모아 본다 (어제 미완료 건이 사라지면 안 된다)
  const [remoteQueue, setRemoteQueue] = useState<ServiceReceptionRow[]>([]);
  const loadRemoteQueue = useCallback(async () => {
    const end = kstDate();
    const rows = await getServiceReceptions(shiftDate(end, -30), end).catch(() => [] as ServiceReceptionRow[]);
    setRemoteQueue(rows.filter((row) => row.type === "IT" || row.type === "원격이관"));
  }, []);
  // 처리(원격·IT) 입력 초안 — 접수 후 나중에 채우는 값들. 행별로 보관하고 저장 시 DB+시트에 반영.
  const [handling, setHandling] = useState<Record<string, Record<string, string>>>({});
  const [handlingBusyId, setHandlingBusyId] = useState("");
  const [typeBusyId, setTypeBusyId] = useState("");
  const handlingOf = (row: ServiceReceptionRow) => handling[row.id] ?? { ...(row.remote_meta || {}) };
  const patchHandling = (row: ServiceReceptionRow, patch: Record<string, string>) =>
    setHandling((current) => ({ ...current, [row.id]: { ...handlingOf(row), ...patch } }));

  // 처리값을 DB에 저장하고, 접수 때 만든 시트 행을 같은 자리에 갱신한다 (행이 없으면 새로 추가)
  // 시트 반영은 웹훅을 거쳐 몇 초 걸리므로 항상 백그라운드로 — 버튼은 기다리지 않는다.
  // 같은 접수의 시트 작업은 반드시 한 줄로 세워서 순서대로 보낸다.
  // 접수 기입(5~15초 소요)이 끝나기 전에 시작·종료·처리저장이 겹치면 서로 상대가 만든 행을
  // 모른 채 각각 새 행을 만들어(관측: 3~4행 생성) 흩어진다. 앞 작업이 알려준 행번호를 이어받는다.
  const sheetChainRef = useRef<Record<string, Promise<number | null>>>({});
  const runSheetWrite = (id: string, task: (target: number | null) => Promise<number | null>) => {
    const previous = sheetChainRef.current[id] ?? Promise.resolve<number | null>(null);
    const next = previous.then((target) => task(target)).catch(() => null);
    sheetChainRef.current[id] = next;
    return next;
  };

  const syncRemoteSheet = (row: ServiceReceptionRow, meta: Record<string, string>) => {
    if (!row.lease_no) return;
    void runSheetWrite(row.id, async (chained) => {
      // 앞 작업이 알려준 행 → 화면에 있는 행 → DB에 저장된 행 순으로 대상을 찾는다
      let target = chained ?? row.sheet_row ?? null;
      if (!target) target = (await getServiceReceptionById(row.id).catch(() => null))?.sheet_row ?? null;
      const { row: sheetRow } = await sendReceptionRemoteSheetJob({
        author: row.author, vendor: row.vendor, leaseNo: row.lease_no, route: row.route,
        hanjo: meta.hanjo || (row.type === "IT" ? "IT" : ""),
        start: meta.start || "", end: meta.end || "", result: meta.result || "", handler: meta.handler || "",
        contact: [row.receiver_name, row.receiver_phone].filter(Boolean).join("\n"),
        symptom: row.symptom || "", extraCount: meta.extraCount || "", handled: meta.handled || "",
        linked: meta.linked || "",
        ...(() => { const parts = receiptParts(row.created_at); return { receiptDate: parts.date, receiptTime: parts.time, receiptAuthor: row.author }; })(),
      }, target);
      if (sheetRow && sheetRow !== target) {
        void updateServiceReception(row.id, { sheet_row: sheetRow }).catch(() => {});
        setListRows((current) => current.map((item) => (item.id === row.id ? { ...item, sheet_row: sheetRow } : item)));
      }
      return sheetRow ?? target;
    });
  };

  const saveHandling = async (row: ServiceReceptionRow, extra: Record<string, string> = {}, silent = false) => {
    const meta = { ...handlingOf(row), ...extra };
    if (Object.keys(extra).length) patchHandling(row, extra);   // 시각 기록은 즉시 화면에 반영
    if (!silent) setHandlingBusyId(row.id);
    try {
      const nextStatus = meta.result === "처리완료" ? "원격완료" : row.status;
      await updateServiceReception(row.id, { remote_meta: meta, ...(nextStatus !== row.status ? { status: nextStatus } : {}) });
      // 시트는 "처리 저장"에서 한 번만 반영한다. 시작·종료 스탬프까지 매번 보내면
      // 웹훅 지연(5~15초)이 겹쳐 서로 다른 행이 만들어지고 체감도 느려진다.
      if (!silent) syncRemoteSheet(row, meta);
      if (!silent) {
        setHandling((current) => { const next = { ...current }; delete next[row.id]; return next; });
        await loadList(listDate, listPeriod);
        void loadRemoteQueue();
      }
    } catch (e) {
      notify(`처리 저장 실패: ${(e as Error).message}`, "error");
    } finally {
      if (!silent) setHandlingBusyId("");
    }
  };

  // 구분 전환 — 복합기 AS ↔ 원격이관 ↔ IT. 시트 탭이 바뀌면 기존 행 연결을 끊는다.
  const changeType = async (row: ServiceReceptionRow, next: string) => {
    if (row.type === next) return;
    const groupOf = (t: string) => (t === "복합기 AS" ? "copier" : "remote");
    const crossTab = groupOf(row.type) !== groupOf(next);
    if (!window.confirm(`${row.vendor || "이 접수"}를 ${next}(으)로 바꿀까요?${crossTab ? "\n시트 탭이 달라 기존 기입 행과의 연결은 해제됩니다." : ""}`)) return;
    setTypeBusyId(row.id);
    try {
      await updateServiceReception(row.id, { type: next, ...(crossTab ? { sheet_row: null } : {}) });
      await loadList(listDate, listPeriod);
      void loadRemoteQueue();
    } catch (e) {
      notify(`구분 변경 실패: ${(e as Error).message}`, "error");
    } finally {
      setTypeBusyId("");
    }
  };
  const [previewRow, setPreviewRow] = useState<ServiceReceptionRow | null>(null);
  const [previewCopied, setPreviewCopied] = useState(false);
  // 상단 다크바 시계 — 30초마다만 갱신 (화면이 커서 매초 다시 그리면 낭비)
  const [clock, setClock] = useState(() => kstStamp());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(kstStamp()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

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
  useEffect(() => { if (page === "remote") void loadRemoteQueue(); }, [page, loadRemoteQueue]);
  const goPage = (next: "copier" | "remote" | "list") => {
    setPage(next);
    setActionResult("");
    if (next === "copier" && type !== "복합기 AS") setType("복합기 AS");
    if (next === "remote" && type === "복합기 AS") setType("원격이관");
  };
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

  const vendorName = workinName || pick(lease, "거래처명", "_업체명", "업체명") || (custKind === "신규" ? manualVendor.trim() : "");
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
    const 구분 = type === "IT" ? "IT A/S" : fieldFinal;
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
      notify("복사 실패 — 양식을 직접 선택해 복사하세요.", "error");
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
      paid: paidFinal,
      field: fieldFinal,
      first_no: firstNo.trim(),
      ...(isRemoteType ? { remote_meta: { hanjo: hanjoFinal } } : {}),
      cust_kind: type === "복합기 AS" ? custKind : "",
      notes: manual.참고사항,
      report_text: type === "원격이관" ? "" : report,
      status,
      sent_room: sentRoom,
    });
  };

  const resetForm = () => {
    setLease(null); setManual(EMPTY_MANUAL); setAsHistory([]); setSnapshots([]); setSnapshotDeviceMatch(true); setDeviceSummary({ active: 0, items: [] }); setQuery(""); setResults([]);
    setSearched(false); setWorkinName(""); setManualVendor(""); setSavedRowId(null); setPhotos([]);
    setFirstNo(""); setFieldChoice("A/S"); setFieldCustom(""); setPaidCustom(""); setCustKind("기존"); setNewLease({ ...EMPTY_NEW_LEASE }); setRemote({ hanjoCustom: "", hanjoDirect: false });
  };

  // 복합기 AS 접수를 접수 시트에 자동 기입 (기존: 퍼스트순 기준 자동 채움 / 신규: 직접 기재) — 실패해도 접수 저장은 유효
  const writeReceptionSheet = async (): Promise<string> => {
    if (isRemoteType) {
      if (custKind === "신규") return " · 원격 신규는 시트 기입 준비 중 (접수는 저장됨)";
      if (!firstNo.trim()) return " · 순번 미입력 — 시트 기입 생략";
      // 폼이 곧 초기화되므로 보낼 값을 먼저 복사해 둔다 (비동기 중에 빈 값이 되는 것 방지)
      const payload = {
        author, vendor: vendorName, leaseNo: firstNo.trim(), route, hanjo: hanjoFinal,
        start: "", end: "", result: "", handler: "",
        // U열: 접수자 성함 + 연락처를 줄바꿈으로 합친다
        contact: [manual.접수자성함.trim(), manual.접수자연락처.trim()].filter(Boolean).join("\n"),
        symptom: manual.증상.trim(), extraCount: "", handled: "", linked: "",
      };
      const receptionId = sheetRowTargetRef.current;
      try {
        // 접수 시점엔 접수분만 기입 — 시작·종료·처리여부는 대기열에서 처리할 때 같은 행에 채운다.
        // 같은 줄(runSheetWrite)에 세워 이후 처리 작업이 이 행번호를 이어받게 한다.
        let message = "";
        await runSheetWrite(receptionId, async () => {
          const result = await sendReceptionRemoteSheetJob(payload);
          message = result.message;
          if (result.row && receptionId) {
            await updateServiceReception(receptionId, { sheet_row: result.row }).catch(() => {});
            setListRows((current) => current.map((item) => (item.id === receptionId ? { ...item, sheet_row: result.row } : item)));
          }
          return result.row ?? null;
        });
        return ` · ${message}`;
      } catch (e) {
        return ` · 시트 기입 실패(${(e as Error).message})`;
      }
    }
    if (type !== "복합기 AS") return "";
    if (custKind === "기존" && !firstNo.trim()) return " · 퍼스트순 미입력 — 시트 기입 생략";
    try {
      const base = {
        author, vendor: vendorName, firstNo: firstNo.trim(), route, field: fieldFinal,
        paid: paidFinal, receiverName: manual.접수자성함.trim(), receiverPhone: manual.접수자연락처.trim(),
        title: manual.제목.trim(), symptom: manual.증상.trim(),
      };
      const message = custKind === "기존"
        ? await sendReceptionCopierSheetJob(base)
        : await (async () => {
          const address = manual.주소.trim();
          const { city, district } = splitCityDistrict(address);
          return sendReceptionCopierSheetJob(base, {
            ...newLease,
            leaseStatus: newLease.leaseStatus === "직접기재" ? (newLease.leaseStatusCustom || "").trim() : newLease.leaseStatus,
            company: vendorName,
            address,
            city,
            district,
          });
        })();
      return ` · ${message}`;
    } catch (e) {
      return ` · 시트 기입 실패(${(e as Error).message})`;
    }
  };

  // 저장만 (복합기/IT) 또는 원격 접수 저장(대기)
  const handleSave = async () => {
    if (busy) return;
    if (!vendorName) { setActionResult("업체를 선택(또는 입력)하세요."); return; }
    setBusy(true);
    setActionResult("");
    try {
      const rowId = await persist(type === "원격이관" ? "원격대기" : "접수");
      sheetRowTargetRef.current = rowId;
      let scheduled = false;
      if (scheduleToo && type !== "원격이관") {
        try { scheduled = await createTicketFromReception(formSnapshotForTicket(rowId), false); } catch { /* 일정 등록 실패해도 접수 저장은 유효 */ }
      }
      const sheetPending = isRemoteType ? (custKind === "기존" && !!firstNo.trim()) : (custKind === "신규" || !!firstNo.trim());
      if (sheetPending) void writeReceptionSheet().then((note) => setActionResult((current) => current.replace(" · 접수시트 기입 중…", "") + note));
      setActionResult(`${type === "원격이관" ? "원격 접수 저장됨 (대기)" : `접수 저장됨${scheduled ? " + 일정 등록됨" : ""}`}${sheetPending ? " · 접수시트 기입 중…" : ""}`);
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
      const sheetPending = type === "복합기 AS" && (custKind === "신규" || !!firstNo.trim());  // 전송 경로는 복합기 AS 전용
      if (sheetPending) void writeReceptionSheet().then((note) => setActionResult((current) => current.replace(" · 접수시트 기입 중…", "") + note));
      setActionResult(`전송 완료 — ${room}${res.testMode ? " (테스트 모드)" : ""}${scheduled ? " + 일정 등록됨" : ""}${sheetPending ? " · 접수시트 기입 중…" : ""}`);
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
      if (created) notify("일정리스트에 등록했습니다. 일정리스트 탭에서 담당자를 배정하세요.", "success");
    } catch (e) {
      notify(`일정 등록 실패: ${(e as Error).message}`, "error");
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

  // 새 주소를 앱 데이터(워킨맵 + Supabase 임대리스트)에 자동 반영.
  // 임대리스트는 자동 동기화가 없어(수동 1회 적재) 여기서 고쳐도 덮이지 않는다. 구글시트 원본만 수동.
  const [applyBusyId, setApplyBusyId] = useState("");
  const applyAddressToApp = async (row: ServiceReceptionRow) => {
    if (applyBusyId) return;
    const after = (row.address || "").trim();
    if (!after) { notify("반영할 주소가 비어 있습니다.", "info"); return; }
    if (!window.confirm(`워킨맵과 임대리스트(Supabase)의 주소를 아래로 바꿉니다.\n\n${after}\n\n구글시트 원본은 자동으로 바뀌지 않으니 별도 수정 후 '시트 반영 완료'를 눌러주세요. 계속할까요?`)) return;
    setApplyBusyId(row.id);
    try {
      // 1) 워킨맵: 업체명 매칭되는 모든 지점 주소 갱신 + 메모 기록
      let mapCount = 0;
      const key = vendorMatchKey(row.vendor);
      if (key) {
        const places = await selectAllRows<{ id: number; name: string; memos: string[] | null }>("workin_map_places", "select=id,name,memos");
        const matches = places.filter((place) => {
          const placeKey = vendorMatchKey(place.name || "");
          return placeKey && (placeKey === key || (placeKey.length >= 5 && key.length >= 5 && (placeKey.includes(key) || key.includes(placeKey))));
        });
        for (const match of matches) {
          const memos = Array.isArray(match.memos) ? match.memos.map(String) : [];
          memos.push(`[주소반영] ${kstDate()} 서비스접수 기준 → ${after}`.slice(0, 300));
          await updateRows("workin_map_places", `id=eq.${match.id}`, { address: after, address_detail: "", memos });
        }
        mapCount = matches.length;
      }
      // 2) 임대리스트(vendor_info): 순번 → 자산번호 → 기번 순으로 해당 기기 행을 찾아 _raw 주소 갱신
      let leaseUpdated = false;
      const enc = encodeURIComponent;
      const finder = row.lease_no ? `${enc("순번")}=eq.${enc(row.lease_no)}`
        : row.asset_no ? `${enc("자산번호")}=eq.${enc(row.asset_no)}`
        : row.serial ? `${enc("기번")}=eq.${enc(row.serial)}` : "";
      if (finder) {
        const targets = await selectRows<{ id: number; _raw: Record<string, unknown> | null }>("vendor_info", `select=id,_raw&${finder}&limit=1`).catch(() => []);
        const target = targets[0];
        if (target && target._raw && typeof target._raw === "object") {
          const raw = { ...target._raw } as Record<string, unknown>;
          raw["주소(실납품주소,도로명주소)"] = after;
          if ("주소" in raw) raw["주소"] = after;
          await updateRows("vendor_info", `id=eq.${target.id}`, { _raw: raw });
          leaseUpdated = true;
        }
      }
      notify(`반영 완료 — 워킨맵 ${mapCount}곳 · 임대리스트 ${leaseUpdated ? "1건" : "매칭 실패(순번·자산·기번 없음)"}\n구글시트 원본을 수정한 뒤 '시트 반영 완료'를 눌러주세요.`, "error");
    } catch (e) {
      notify(`반영 실패: ${(e as Error).message}`, "error");
    } finally {
      setApplyBusyId("");
    }
  };

  // 시트 원본 주소를 고친 뒤 누르면 '주소확인' 목록에서 내려간다.
  // 플래그를 지우지 않고 처리자·처리일을 남겨 나중에 누가 반영했는지 추적 가능.
  const resolveAddress = async (row: ServiceReceptionRow) => {
    if (!window.confirm("임대리스트 시트의 주소를 수정하셨나요? 확인 목록에서 제외합니다. (처리자와 처리일이 기록됩니다)")) return;
    try {
      const patch = { address_resolved_at: new Date().toISOString(), address_resolved_by: author || "미지정" };
      await updateServiceReception(row.id, patch);
      setListRows((current) => current.map((r) => r.id === row.id ? { ...r, ...patch } : r));
    } catch (e) {
      notify(`처리 실패: ${(e as Error).message}\n(dev-notes.sql 실행 여부를 확인하세요)`, "error");
    }
  };

  const removeReception = async (row: ServiceReceptionRow) => {
    if (!window.confirm(`${row.vendor || "이 접수"} 건을 삭제할까요? (잘못 접수된 건 정리용)`)) return;
    try {
      await updateServiceReception(row.id, { deleted: true });
      setListRows((current) => current.filter((r) => r.id !== row.id));
    } catch (e) {
      notify(`삭제 실패: ${(e as Error).message}\n(reception-sync.sql 실행 여부를 확인하세요)`, "error");
    }
  };

  const toggleRemoteDone = async (row: ServiceReceptionRow) => {
    const next = row.status === "원격대기" ? "원격완료" : "원격대기";
    try {
      await setServiceReceptionStatus(row.id, next);
      setListRows((current) => current.map((r) => r.id === row.id ? { ...r, status: next } : r));
    } catch (e) {
      notify(`상태 변경 실패: ${(e as Error).message}`, "error");
    }
  };

  // ---- 통계 ----
  const counts = useMemo(() => ({
    total: listRows.length,
    copier: listRows.filter((r) => r.type === "복합기 AS").length,
    it: listRows.filter((r) => r.type === "IT").length,
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
      else if (r.type === "IT") entry.it += 1;
      else entry.remote += 1;
      map.set(key, entry);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].total - a[1].total);
  }, [listRows]);
  const filteredRows = useMemo(() => listFilter === "전체" ? listRows : listFilter === "주소확인" ? listRows.filter((r) => r.address_changed && !r.address_resolved_at) : listRows.filter((r) => r.type === listFilter), [listRows, listFilter]);
  const isToday = listDate === kstDate();
  // 필수값은 한 배열로만 정의한다 — 카운터와 아래 체크 칩이 서로 어긋나지 않게.
  // 구분별로 실제 필요한 것만: 원격이관은 방문·제목 개념이 없고, 시트 기입엔 순번이 필요하다.
  const requiredItems: [string, boolean][] = [
    ["업체", Boolean(vendorName)],
    ["접수자", Boolean(manual.접수자성함.trim())],
    ["연락처", Boolean(manual.접수자연락처.trim())],
    ...(type === "복합기 AS" ? [["제목", Boolean(manual.제목.trim())] as [string, boolean]] : []),
    ["내용", Boolean(manual.증상.trim())],
    ...(type === "원격이관" ? [] : [["주소", Boolean(manual.주소.trim() || pick(lease, "주소(실납품주소,도로명주소)", "주소"))] as [string, boolean]]),
    // 순번은 시트 기입 기준값 — 기존 거래처일 때만 필수 (신규는 순번이 없다)
    ...(custKind === "기존" ? [["순번", Boolean(firstNo.trim())] as [string, boolean]] : []),
  ];
  const readyCount = requiredItems.filter(([, ok]) => ok).length;
  const isReady = readyCount === requiredItems.length;

  // 원격 작업 상태: 시작 전 = 대기 / 시작했고 처리여부 없음 = 진행중 / 처리여부 있음 = 완료
  const remoteStateOf = (row: ServiceReceptionRow) => {
    const meta = handlingOf(row);
    return meta.result ? "완료" : meta.start ? "진행중" : "대기";
  };
  const REMOTE_STATE_TONE: Record<string, string> = {
    대기: "bg-amber-100 text-amber-800", 진행중: "bg-cyan-100 text-cyan-800", 완료: "bg-emerald-100 text-emerald-800",
  };

  const renderQueueRow = (row: ServiceReceptionRow) => (
              <div key={row.id}>
                <button type="button" onClick={() => setOpenRowId(openRowId === row.id ? "" : row.id)} className={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50 ${openRowId === row.id ? "bg-slate-50" : ""}`}>
                  <span className="w-12 shrink-0 text-center">
                    <span className="block text-[13px] font-black tabular-nums leading-tight text-slate-900">{kstTime(row.created_at)}</span>
                    {listPeriod !== "day" && <span className="block text-[10px] font-bold tabular-nums text-slate-400">{row.receipt_date.slice(5).replace("-", "/")}</span>}
                    <span className={`mt-1 block rounded px-1 py-0.5 text-[9px] font-black ${TYPE_TONE[row.type] || "bg-slate-100 text-slate-600"}`}>{row.type === "복합기 AS" ? "복합기" : row.type === "IT" ? "IT" : "원격"}</span>
                  </span>
                  <span className="min-w-0">
                    <b className="block truncate text-[15px] font-black leading-snug text-slate-950">{row.vendor || "업체 미기재"}</b>
                    {(row.title || row.symptom) && <span className="block truncate text-xs font-semibold text-slate-600">{row.title || "제목 없음"}{row.symptom ? ` — ${row.symptom}` : ""}</span>}
                    <span className="block truncate text-[11px] font-bold text-slate-400">{row.author || "접수자 미지정"}{row.region ? ` · ${row.region}` : ""}{row.model ? ` · ${row.model}` : ""}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {row.address_changed && !row.address_resolved_at && <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-800" title="임대리스트와 다른 주소로 접수됨">📍</span>}
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${STATUS_TONE[row.status] || "bg-slate-100 text-slate-500"}`}>{row.status}</span>
                    {row.type === "원격이관" && <span onClick={(e) => { e.stopPropagation(); void toggleRemoteDone(row); }} className={`flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-[11px] font-black transition ${row.status === "원격대기" ? "bg-blue-600 text-white shadow-[0_3px_10px_rgba(37,99,235,0.35)] hover:bg-blue-700" : "border border-slate-300 bg-white text-slate-400 hover:border-slate-400"}`}>{row.status === "원격대기" ? "완료" : "대기로"}</span>}
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
                  {row.address && <div className="mt-1.5">
                    <div><b className="text-slate-500">주소</b> {row.address}</div>
                    {row.address_changed && <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {row.address_resolved_at
                        ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700">시트 반영됨 · {String(row.address_resolved_at).slice(0, 10)} {row.address_resolved_by || ""}</span>
                        : <>
                          <span className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-800">임대리스트와 다름</span>
                          <button type="button" disabled={applyBusyId === row.id} onClick={(e) => { e.stopPropagation(); void applyAddressToApp(row); }} className="whitespace-nowrap rounded border border-blue-300 bg-blue-50 px-1.5 py-0.5 text-[10px] font-black text-blue-700 disabled:opacity-50">{applyBusyId === row.id ? "반영 중…" : "워킨맵·임대리스트 반영"}</button>
                          <button type="button" onClick={(e) => { e.stopPropagation(); void resolveAddress(row); }} className="whitespace-nowrap rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-black text-emerald-700">시트 반영 완료</button>
                        </>}
                    </div>}
                  </div>}
                  {row.symptom && <div className="mt-1.5 whitespace-pre-wrap"><b className="text-slate-500">증상</b> {row.symptom}</div>}
                  {!!(row.photos?.length) && <div className="mt-2 flex flex-wrap gap-1.5">{row.photos.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt="증상 사진" className="h-14 w-14 rounded-lg border border-slate-200 object-cover" /></a>)}</div>}
                  {row.notes && <div className="mt-1 whitespace-pre-wrap"><b className="text-slate-500">메모</b> {row.notes}</div>}
                  {(row.type === "IT" || row.type === "원격이관") && (() => {
                    const meta = handlingOf(row);
                    const field = "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10";
                    return (
                      <div className="mt-2 rounded-xl border border-slate-200 bg-white p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-black text-blue-700">원격 처리</span>
                          <span className="text-[10px] font-bold text-slate-400">한조처리 {meta.hanjo || (row.type === "IT" ? "IT" : "공백")}</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {meta.start
                            ? <span className="rounded bg-white px-2 py-1 text-[11px] font-black text-slate-700">시작 {meta.start}</span>
                            : <button type="button" onClick={() => void saveHandling(row, { start: kstNowHM() }, true)} className="rounded-full bg-blue-600 px-4 py-2 text-[12px] font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] hover:bg-blue-700">▶ 원격 시작</button>}
                          {meta.start && (meta.end
                            ? <span className="rounded bg-white px-2 py-1 text-[11px] font-black text-slate-700">종료 {meta.end}</span>
                            : <button type="button" onClick={() => void saveHandling(row, { end: kstNowHM() }, true)} className="rounded-full bg-slate-900 px-4 py-2 text-[12px] font-black text-white transition hover:bg-slate-800">■ 종료</button>)}
                          {meta.start && <input value={meta.start} inputMode="numeric" maxLength={5} onChange={(e) => patchHandling(row, { start: typeTime(e.target.value) })} onBlur={(e) => patchHandling(row, { start: normalizeTime(e.target.value) })} className={`w-16 ${field} tabular-nums`} title="시작 수정" />}
                          {meta.end && <input value={meta.end} inputMode="numeric" maxLength={5} onChange={(e) => patchHandling(row, { end: typeTime(e.target.value) })} onBlur={(e) => patchHandling(row, { end: normalizeTime(e.target.value) })} className={`w-16 ${field} tabular-nums`} title="종료 수정" />}
                        </div>
                        <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                          <select value={meta.result || ""} onChange={(e) => patchHandling(row, { result: e.target.value })} className={field}>
                            <option value="">처리여부</option>
                            {["처리완료", "접수취소", "재접수", "자체해결", "AS이관", "중복접수", "방문이관"].map((v) => <option key={v}>{v}</option>)}
                          </select>
                          <input value={meta.handler || ""} onChange={(e) => patchHandling(row, { handler: e.target.value })} placeholder="처리자" className={field} />
                          <input value={meta.extraCount || ""} onChange={(e) => patchHandling(row, { extraCount: e.target.value })} placeholder="추가대수" className={field} />
                        </div>
                        <textarea value={meta.handled || ""} onChange={(e) => patchHandling(row, { handled: e.target.value })} rows={2} placeholder="처리내용" className={`mt-1.5 w-full resize-y ${field}`} />
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-600">
                            <input type="checkbox" checked={meta.linked === "연동완료"} onChange={(e) => patchHandling(row, { linked: e.target.checked ? "연동완료" : "" })} className="h-4 w-4 accent-blue-600" />연동완료
                          </label>
                          <button type="button" disabled={handlingBusyId === row.id} onClick={() => void saveHandling(row)} className="rounded-full bg-blue-600 px-4 py-2 text-[12px] font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 disabled:opacity-40 disabled:shadow-none">{handlingBusyId === row.id ? "저장 중…" : "처리 저장 · 시트 반영"}</button>
                        </div>
                        {!row.lease_no && <div className="mt-1 text-[10px] font-bold text-amber-600">순번이 없어 시트 반영은 생략됩니다 (DB에는 저장)</div>}
                      </div>
                    );
                  })()}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-black text-slate-400">구분 변경</span>
                    {(["복합기 AS", "원격이관", "IT"] as const).map((t) => (
                      <button key={t} type="button" disabled={typeBusyId === row.id || row.type === t} onClick={() => void changeType(row, t)}
                        className={`rounded-full border px-3 py-1 text-[10px] font-black transition ${row.type === t ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-500 hover:border-blue-300 hover:text-blue-700"}`}>{t}</button>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {row.report_text && <button type="button" onClick={() => { setPreviewRow(row); setPreviewCopied(false); }} className="rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-[11px] font-black text-slate-600 transition hover:bg-slate-50">원본 미리보기</button>}
                    {row.type !== "원격이관" && <button type="button" disabled={scheduleBusyId === row.id} onClick={() => void addToSchedule(row)} className="rounded-full border border-blue-200 bg-blue-50 px-3.5 py-1.5 text-[11px] font-black text-blue-700 transition hover:bg-blue-100 disabled:opacity-40">{scheduleBusyId === row.id ? "등록 중…" : "일정 등록"}</button>}
                    <button type="button" onClick={() => void removeReception(row)} className="rounded-full border border-rose-200 bg-rose-50 px-3.5 py-1.5 text-[11px] font-black text-rose-600 transition hover:bg-rose-100">삭제</button>
                  </div>
                </div>}
              </div>
  );

  // 리스트 탭은 기간·필터 결과를, 원격 탭은 최근 30일 원격·IT를 대기/진행중/완료로 묶어 보여준다
  const queueBody = page === "remote"
    ? (["대기", "진행중", "완료"] as const).map((state) => {
        const groupRows = remoteQueue.filter((row) => remoteStateOf(row) === state);
        if (!groupRows.length) return null;
        return (
          <div key={state}>
            <div className="sticky top-0 z-10 flex items-center gap-2 bg-[#151A23]/95 px-4 py-2 backdrop-blur">
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-black ${REMOTE_STATE_TONE[state]}`}>{state}</span>
              <span className="text-[11px] font-bold text-slate-400">{groupRows.length}건</span>
            </div>
            {groupRows.map(renderQueueRow)}
          </div>
        );
      })
    : filteredRows.map(renderQueueRow);


  return (
    <div className="mx-auto w-full max-w-[1560px] space-y-4 pb-16">
      {/* 헤더 + 탭 — 한 번에 한 가지 일만 보이게 나눈다 */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:rounded-xl">
        {/* 다크 상태바 — 오늘 상황과 현재 시각을 한 줄로 (제목은 상단 헤더에 이미 있다) */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-[#151A23] px-4 py-2.5">
          <span className="flex items-center gap-1.5 text-[13px] font-black text-white">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.25)]" />접수 가능
          </span>
          <span className="text-[11px] font-bold text-slate-400">
            {isToday ? "오늘" : listDate.slice(5)} 접수 <b className="text-white">{counts.total}</b>건
            {page === "remote" ? <> · 원격 처리중 <b className="text-white">{remoteQueue.filter((row) => remoteStateOf(row) === "진행중").length}</b></> : null}
          </span>
          {counts.addr > 0 && <span className="rounded bg-amber-400/15 px-2 py-0.5 text-[11px] font-black text-amber-300">📍 주소확인 {counts.addr}</span>}
          <span className="ml-auto text-xs font-bold tabular-nums text-slate-300">{clock}</span>
        </div>
        <div className="flex border-b border-slate-200">
          {([["copier", "복합기 AS", counts.copier], ["remote", "원격 · IT", remoteQueue.filter((row) => remoteStateOf(row) !== "완료").length], ["list", "접수 리스트", counts.total]] as ["copier" | "remote" | "list", string, number][]).map(([key, label, count]) => (
            <button key={key} type="button" onClick={() => goPage(key)}
              className={`relative flex-1 px-3 py-3.5 text-[13px] font-black transition sm:text-[15px] ${page === key ? "text-slate-950 after:absolute after:inset-x-0 after:-bottom-px after:h-[3px] after:bg-blue-600" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"}`}>
              {label}
              {count > 0 && <span className={`ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${page === key ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-400"}`}>{count}</span>}
            </button>
          ))}
        </div>
      </section>

      <div className={`space-y-4 ${page === "remote" ? "2xl:grid 2xl:grid-cols-[minmax(0,1fr)_minmax(420px,560px)] 2xl:items-start 2xl:gap-4 2xl:space-y-0" : ""}`}>
        {/* ==== 접수 작성 (리스트 탭에서는 감춘다) ==== */}
        <div className={page === "list" ? "hidden" : "space-y-4"}>
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:rounded-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-[#1E252F] px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-white/10 text-xs font-black text-white">1</span>
                <div>
                  <div className="text-sm font-black text-white lg:text-[15px]">거래처 선택</div>
                  <div className="text-[11px] font-semibold text-slate-400">{page === "remote" ? "원격 처리할 거래처를 고릅니다." : "AS 대상 기기를 정확히 고릅니다."}</div>
                </div>
              </div>
              <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black ${lease || (custKind === "신규" && manualVendor.trim()) ? "bg-emerald-400/15 text-emerald-300" : "bg-white/10 text-slate-300"}`}>
                <Building2 size={13} /> {lease || (custKind === "신규" && manualVendor.trim()) ? "선택 완료" : "선택 필요"}
              </div>
            </div>
            <div className="p-4 lg:p-5">
            <div className="flex items-center gap-2">
              <span className="flex rounded-full bg-slate-100 p-1">
                {(["기존", "신규"] as const).map((k) => (
                  <button key={k} type="button" onClick={() => { setCustKind(k); setLease(null); setQuery(""); setResults([]); setSearched(false); setWorkinName(""); setManualVendor(""); setAsHistory([]); setSnapshots([]); setDeviceSummary({ active: 0, items: [] }); }} className={`rounded-full px-5 py-2 text-xs font-black transition ${custKind === k ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{k}</button>
                ))}
              </span>
            </div>
            {custKind === "기존" && <div className="mt-3 flex gap-2">
              <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void runSearch(); }} placeholder="임대리스트 검색 — 업체명 / 자산기번 / 순번" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3.5 py-3 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
              <button type="button" onClick={() => void runSearch()} disabled={searching} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-blue-600 px-5 py-3 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-40"><Search size={15} />{searching ? "검색중" : "검색"}</button>
            </div>}
            {custKind === "신규" && <label className="mt-3 block text-[11px] font-black text-slate-500">업체명
              <input value={manualVendor} onChange={(e) => setManualVendor(e.target.value)} placeholder="신규 거래처 업체명" className="mt-1 w-full rounded-lg border border-slate-300 px-3.5 py-3 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
            </label>}
            {searched && !results.length && !lease && <div className="mt-2 text-xs font-bold text-slate-400">검색 결과가 없습니다.</div>}
            {results.length > 0 && <div className="mt-2 max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
              {results.map((hit, index) => {
                const sameVendor = resultVendorCounts.get((hit["_업체명"] || "").trim()) || 0;
                const leaseState = pick(hit, "임대여부");
                const ended = leaseState && leaseState !== "임대중";
                return (
                  <button key={index} type="button" onClick={() => void selectLease(hit)} className={`flex w-full items-center gap-3 px-3.5 py-3 text-left transition hover:bg-blue-50/50 ${ended ? "opacity-60" : ""}`}>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <b className="truncate text-[14px] font-black text-slate-900">{pick(hit, "거래처명", "_업체명")}</b>
                        {ended && <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black text-rose-600">{leaseState}</span>}
                        {sameVendor > 1 && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-700">기기 {sameVendor}대</span>}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] font-bold text-slate-500">
                        <span className="text-slate-400">순 <span className="tabular-nums text-slate-600">{pick(hit, "순")}</span></span>
                        <span>{pick(hit, "모델명", "기종") || "-"}</span>
                        <span className="text-slate-400">자산 <span className="font-mono text-slate-600">{pick(hit, "자산번호") || "-"}</span></span>
                        <span className="text-slate-400">기번 <span className="font-mono text-slate-600">{pick(hit, "시리얼번호(기번)") || "-"}</span></span>
                        <span>{pick(hit, "담당지역")}</span>
                      </span>
                    </span>
                    <ChevronRight size={16} className="shrink-0 text-slate-300" />
                  </button>
                );
              })}
            </div>}
            {lease && <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate text-base font-black text-slate-950 lg:text-lg">{pick(lease, "거래처명", "_업체명")}</span>
                  {workinName && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700">워킨맵 매칭</span>}
                  {pick(lease, "임대여부") && pick(lease, "임대여부") !== "임대중" && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black text-rose-600">{pick(lease, "임대여부")} 기기</span>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {asHistory.length > 0 && <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-black text-rose-600">AS 기기 {asHistory.filter((h) => h.serialMatch).length}회 · 업체 {asHistory.length}회</span>}
                  <button type="button" onClick={resetForm} className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-black text-slate-500 transition hover:border-slate-400 hover:text-slate-700">다시 검색</button>
                </div>
              </div>
              {deviceSummary.active > 1 && <div className="border-b border-slate-100 bg-amber-50/70 px-4 py-2 text-[11px] font-bold text-amber-800">
                임대중 {deviceSummary.active}대({deviceSummary.items.map(([item, n]) => `${item} ${n}`).join(" · ")}) — 접수할 기기의 자산·기번이 맞는지 확인하세요
              </div>}
              {/* 값을 칩으로 흘려놓으면 기번·자산을 눈으로 대조하기 어렵다 — 라벨/값 표로 세운다 */}
              <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 sm:grid-cols-4 2xl:grid-cols-8">
                {([["순", pick(lease, "순") || "-", "num"], ["모델", pick(lease, "모델명") || "-", ""], ["자산번호", pick(lease, "자산번호") || "-", "mono"], ["기번", pick(lease, "시리얼번호(기번)") || "-", "mono"], ["등급", pick(lease, "등급") || "-", ""], ["지역", region || "-", ""], ["종료일", pick(lease, "종료일") || "-", "num"], ["미수", `${pick(lease, "미수개월수") || "0"}개월`, "num"]] as [string, string, string][]).map(([label, value, kind]) => (
                  <div key={label} className="min-w-0 px-3 py-2.5">
                    <div className="text-[10px] font-bold text-slate-400">{label}</div>
                    <div className={`mt-0.5 truncate text-[13px] font-black text-slate-900 ${kind === "mono" ? "font-mono" : kind === "num" ? "tabular-nums" : ""}`} title={value}>{value}</div>
                  </div>
                ))}
              </div>
            </div>}
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:rounded-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-[#1E252F] px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-white/10 text-xs font-black text-white">2</span>
                <div>
                  <div className="text-sm font-black text-white lg:text-[15px]">접수 내용 입력</div>
                  <div className="text-[11px] font-semibold text-slate-400">고객이 말한 증상과 기사 방문 정보를 먼저 남깁니다.</div>
                </div>
              </div>
              <div className={`rounded-full px-2.5 py-1 text-[11px] font-black ${isReady ? "bg-emerald-400/15 text-emerald-300" : "bg-white/10 text-slate-300"}`}>{readyCount}/{requiredItems.length} 필수 입력</div>
            </div>
            <div className="p-4 lg:p-5">
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center gap-2">
                  <div className="sr-only">접수유형</div>
                  <div className="flex rounded-full bg-white p-1 ring-1 ring-slate-200">
                    {(["카카오", "전화"] as ReceiveRoute[]).map((r) => (
                      <button key={r} type="button" onClick={() => setRoute(r)} className={`rounded-full px-3.5 py-1.5 text-xs font-black transition ${route === r ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-700"}`}>{r}</button>
                    ))}
                  </div>
                </div>
                {custKind === "기존" && <label className="flex items-center gap-2 text-[11px] font-black text-slate-500">임대리스트 순번
                  <input value={firstNo} onChange={(e) => setFirstNo(e.target.value)} placeholder="예: 1234" className="h-8 w-28 rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-black text-slate-900 outline-none focus:border-slate-700" />
                </label>}
                {type === "복합기 AS" && <div className="flex flex-wrap items-center gap-2 sm:ml-4">
                  <span className="shrink-0 text-[11px] font-black text-slate-500">접수분야</span>
                  <div className="flex flex-wrap gap-1.5">
                    {["A/S", "점검요청", "여분요청", "세팅요청", "불만", "미수", "해지방어", "직접기재"].map((v) => <button key={v} type="button" onClick={() => setFieldChoice(v)} className={`rounded-full border px-3.5 py-1.5 text-[11px] font-black transition ${fieldChoice === v ? "border-blue-600 bg-blue-600 text-white shadow-[0_2px_8px_rgba(37,99,235,0.3)]" : "border-slate-200 bg-white text-slate-500 hover:border-blue-300 hover:text-blue-700"}`}>{v}</button>)}
                    {fieldChoice === "직접기재" && <input value={fieldCustom} onChange={(e) => setFieldCustom(e.target.value)} placeholder="분야 입력" className="h-8 w-44 rounded-lg border border-slate-400 bg-white px-2.5 text-[11px] font-bold text-slate-900 outline-none focus:border-slate-900" />}
                  </div>
                  <select aria-label="접수분야" value={fieldChoice} onChange={(e) => setFieldChoice(e.target.value)} className="sr-only">
                    {["A/S", "점검요청", "여분요청", "세팅요청", "불만", "미수", "해지방어", "직접기재"].map((v) => <option key={v}>{v}</option>)}
                  </select>
                </div>}
                {isRemoteType && <div className="flex flex-wrap items-center gap-2 sm:ml-4">
                  <span className="shrink-0 text-[11px] font-black text-slate-500">한조처리</span>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => { setType("원격이관"); setRemote({ ...remote, hanjoDirect: false }); }} className={`rounded-full border px-3.5 py-1.5 text-[11px] font-black transition ${!remote.hanjoDirect && type === "원격이관" ? "border-blue-600 bg-blue-600 text-white shadow-[0_2px_8px_rgba(37,99,235,0.3)]" : "border-slate-200 bg-white text-slate-500 hover:border-blue-300 hover:text-blue-700"}`}>원격이관</button>
                    <button type="button" onClick={() => { setType("IT"); setRemote({ ...remote, hanjoDirect: false }); }} className={`rounded-full border px-3.5 py-1.5 text-[11px] font-black transition ${!remote.hanjoDirect && type === "IT" ? "border-blue-600 bg-blue-600 text-white shadow-[0_2px_8px_rgba(37,99,235,0.3)]" : "border-slate-200 bg-white text-slate-500 hover:border-blue-300 hover:text-blue-700"}`}>IT</button>
                    <button type="button" onClick={() => setRemote({ ...remote, hanjoDirect: true })} className={`rounded-full border px-3.5 py-1.5 text-[11px] font-black transition ${remote.hanjoDirect ? "border-blue-600 bg-blue-600 text-white shadow-[0_2px_8px_rgba(37,99,235,0.3)]" : "border-slate-200 bg-white text-slate-500 hover:border-blue-300 hover:text-blue-700"}`}>직접기재</button>
                    {remote.hanjoDirect && <input autoFocus value={remote.hanjoCustom} onChange={(e) => setRemote({ ...remote, hanjoCustom: e.target.value })} placeholder="한조처리 입력" className="h-8 w-32 rounded-lg border border-slate-400 bg-white px-2.5 text-[11px] font-bold text-slate-900 outline-none focus:border-slate-900" />}
                  </div>
                </div>}
              </div>
              {type === "복합기 AS" && custKind === "신규" && <div className="mt-2 space-y-1.5 rounded-lg border border-amber-200 bg-amber-50/40 p-2.5">
                <div className="text-[11px] font-black text-amber-700">신규 거래처 정보 — 아는 것만 채우면 됩니다 (빈 칸은 시트에도 빈 칸)</div>
                {NEW_LEASE_SECTIONS.map((sec) => {
                  const filled = sec.fields.filter(([key]) => (newLease[key] || "").trim()).length;
                  return (
                    <details key={sec.label} open={sec.label === "기본"} className="rounded-lg border border-amber-100 bg-white/70">
                      <summary className="cursor-pointer px-2.5 py-2 text-xs font-black text-slate-600">
                        {sec.label} <span className={`ml-1 text-[10px] ${filled ? "text-blue-600" : "text-slate-300"}`}>{filled}/{sec.fields.length}</span>
                      </summary>
                      <div className="grid grid-cols-2 gap-1.5 px-2.5 pb-2.5 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
                        {sec.fields.map(([key, label]) => {
                          const options = key === "leaseStatus" ? ["임대중", "임대종료", "직접기재"]
                            : key === "warranty" ? ["보증O", "보증X"]
                            : key === "grade" ? ["N", "NN", "S", "SS", "V"] : null;
                          return <label key={key} className="text-[10px] font-bold text-slate-500">{label}
                            {options && !(key === "leaseStatus" && newLease.leaseStatus === "직접기재")
                              ? <select value={newLease[key] || ""} onChange={(e) => setNewLease({ ...newLease, [key]: e.target.value })} className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"><option value="">선택</option>{options.map((option) => <option key={option}>{option}</option>)}</select>
                              : key === "leaseStatus"
                              // 직접기재를 고르면 같은 자리에서 입력 — 줄이 늘어나지 않게 select를 input으로 교체
                              ? <span className="mt-0.5 flex gap-1">
                                  <input autoFocus value={newLease.leaseStatusCustom || ""} onChange={(e) => setNewLease({ ...newLease, leaseStatusCustom: e.target.value })} placeholder="임대여부 입력" className="min-w-0 flex-1 rounded-lg border border-slate-400 bg-white px-2 py-1.5 text-xs font-semibold text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                                  <button type="button" title="선택으로 되돌리기" onClick={() => setNewLease({ ...newLease, leaseStatus: "", leaseStatusCustom: "" })} className="shrink-0 rounded-full border border-slate-300 px-1.5 text-[10px] font-black text-slate-400 hover:text-slate-700 transition hover:bg-slate-50">↺</button>
                                </span>
                              : <input value={newLease[key] || ""} onChange={(e) => setNewLease({ ...newLease, [key]: e.target.value })} className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />}
                          </label>;
                        })}
                      </div>
                    </details>
                  );
                })}
              </div>}
              <div className="mt-2 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {([["접수자성함", "접수자 성함"], ["접수자연락처", "접수자 연락처"], ["제목", "제목(짧게)"]] as [keyof Manual, string][]).map(([key, label]) => (
                  <label key={key} className="text-[11px] font-black text-slate-500">{label}
                    <input value={manual[key]} onChange={(e) => setManual({ ...manual, [key]: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                  </label>
                ))}
                <label className="text-[11px] font-black text-slate-500 sm:col-span-2 lg:col-span-3">증상/내용
                  <textarea value={manual.증상} onChange={(e) => setManual({ ...manual, 증상: e.target.value })} rows={2} className="mt-1 w-full resize-y rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                </label>
                <label className="text-[11px] font-black text-slate-500 sm:col-span-2 lg:col-span-3">방문 주소 <span className="font-bold text-slate-400">기사가 실제로 가는 주소 — 임대리스트와 다르면 꼭 수정</span>
                  <input value={manual.주소} onChange={(e) => setManual({ ...manual, 주소: e.target.value })} placeholder="주소를 입력하세요" className={`mt-1 w-full rounded-lg border px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:ring-4 ${manual.주소.trim() ? "border-slate-300 focus:border-blue-500 focus:ring-blue-500/10" : "border-rose-300 bg-rose-50/40 focus:border-rose-400 focus:ring-rose-500/10"}`} />
                  {!manual.주소.trim() && <span className="mt-1 block text-[11px] font-black text-rose-600">· 방문 주소가 비어 있습니다 — 방문 일정에 꼭 필요하니 입력해 주세요.</span>}
                </label>
                <div className="text-[11px] font-black text-slate-500 sm:col-span-2 lg:col-span-3">증상 사진 (최대 6장)
                  <div tabIndex={0} onPaste={(e) => { const files = Array.from(e.clipboardData.files).filter((file) => file.type.startsWith("image/")); if (files.length) { e.preventDefault(); void handlePhotoPick(files); } }} className="mt-1 flex flex-wrap items-center gap-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-200">
                    {photos.map((photo, index) => (
                      <span key={photo.url} className="relative">
                        <a href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={photo.name} className="h-16 w-16 rounded-lg border border-slate-200 object-cover" /></a>
                        <button type="button" onClick={() => setPhotos((prev) => prev.filter((_, i) => i !== index))} className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[10px] font-black text-white">×</button>
                      </span>
                    ))}
                    {photos.length < 6 && <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-400 hover:border-blue-400">
                      {photoBusy ? "…" : <ImagePlus size={21} />}
                      <input type="file" accept="image/*" multiple disabled={photoBusy} onChange={(e) => { void handlePhotoPick(e.target.files); e.target.value = ""; }} className="hidden" />
                    </label>}
                    {!photos.length && <span className="text-[10px] font-bold text-slate-400">클릭 후 Ctrl+V로 붙여넣기 가능</span>}
                  </div>
                </div>
                {type === "복합기 AS" && <>
                  <label className="text-[11px] font-black text-slate-500">유상/무상
                    {manual.유상무상 === "직접기재"
                      ? <span className="mt-1 flex gap-1">
                          <input autoFocus value={paidCustom} onChange={(e) => setPaidCustom(e.target.value)} placeholder="직접 입력" className="min-w-0 flex-1 rounded-lg border border-slate-400 px-2.5 py-2 text-sm font-semibold text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                          <button type="button" title="선택으로 되돌리기" onClick={() => { setManual({ ...manual, 유상무상: "" }); setPaidCustom(""); }} className="shrink-0 rounded-full border border-slate-300 px-2 text-[11px] font-black text-slate-400 hover:text-slate-700 transition hover:bg-slate-50">↺</button>
                        </span>
                      : <select value={manual.유상무상} onChange={(e) => setManual({ ...manual, 유상무상: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"><option value="">선택</option>{["무상", "유상", "직접기재"].map((v) => <option key={v}>{v}</option>)}</select>}
                  </label>
                  <label className="text-[11px] font-black text-slate-500">교체이력 (예: 1회)
                    <input value={manual.교체이력} onChange={(e) => setManual({ ...manual, 교체이력: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                  </label>
                  <label className="text-[11px] font-black text-slate-500">참고사항
                    <input value={manual.참고사항} onChange={(e) => setManual({ ...manual, 참고사항: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                  </label>
                </>}
                {type === "원격이관" && <label className="text-[11px] font-black text-slate-500 sm:col-span-2 lg:col-span-3">처리 내용/메모
                  <input value={manual.참고사항} onChange={(e) => setManual({ ...manual, 참고사항: e.target.value })} placeholder="원격 안내 내용, 후속 필요사항 등" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                </label>}
              </div>
              {type !== "원격이관" && !!report && <div className="mt-3 border-t border-slate-100 pt-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-black text-slate-400">카톡 보고용 양식</div>
                  <button type="button" onClick={() => void copyReport()} className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white transition hover:bg-slate-50 px-3 py-1.5 text-xs font-black text-slate-700"><Copy size={13} />{copied ? "복사됨 ✓" : "복사"}</button>
                </div>
                <textarea value={report} readOnly rows={12} className="mt-2 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-mono text-[11px] leading-5 text-slate-700 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
              </div>}

              <div className="sticky bottom-2 z-10 -mx-4 mt-4 border-t border-slate-200 bg-white/95 px-4 pb-2 pt-3 backdrop-blur lg:mx-0 lg:rounded-2xl lg:border lg:border-slate-200 lg:px-5 lg:py-4 lg:shadow-[0_10px_30px_rgba(15,23,42,0.12)]">
              <div className="flex flex-wrap items-center gap-2">
                {requiredItems.map(([label, ok]) => (
                  <span key={label} className={`rounded-full px-2.5 py-1 text-[10px] font-black ${ok ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-500"}`}>{ok ? "✓" : "•"} {label}</span>
                ))}
                <span className="ml-auto flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => window.open(RECEPTION_SHEET_BASE + RECEPTION_SHEET_GID[type], "_blank", "noopener,noreferrer")} className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-black text-slate-600 transition hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900"><ExternalLink size={15} />{type === "복합기 AS" ? "AS접수 시트" : "원격 시트"}</button>
                  <button type="button" onClick={() => type === "원격이관" ? void handleSave() : setConfirmAction("save")} disabled={busy} className={`inline-flex items-center gap-1.5 rounded-full px-5 py-3 text-sm font-black transition disabled:opacity-40 ${type === "복합기 AS" ? "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50" : "bg-blue-600 text-white shadow-[0_4px_14px_rgba(37,99,235,0.35)] hover:bg-blue-700"}`}><ShieldCheck size={15} />{busy ? "처리중…" : type === "원격이관" ? "원격 접수 저장" : "접수 저장"}</button>
                  {type === "복합기 AS" && <button type="button" onClick={() => setConfirmAction("send")} disabled={busy || !report || !isReady} className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-6 py-3 text-sm font-black text-white shadow-[0_4px_14px_rgba(37,99,235,0.35)] transition hover:bg-blue-700 disabled:opacity-40 disabled:shadow-none"><Send size={15} />{busy ? "처리중…" : "저장 + AS방 전송"}</button>}
                </span>
              </div>
              {actionResult && <div className={`mt-2 rounded-lg px-3 py-2 text-[11px] font-black ${actionResult.includes("실패") ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>{actionResult}</div>}
              </div>
            </div>
            </section>

            {confirmAction && (() => {
              // 신규 거래처는 임대리스트 정보가 없다 — 직접 기재값을 보고, 필수로 강제하지 않는다.
              const isNewVendor = type === "복합기 AS" && custKind === "신규";
              const checkItems: Array<[string, string, boolean]> = [
                ["접수유형", route, true],
                ["구분", type + (isNewVendor ? " · 신규" : ""), true],
                ["업체명", vendorName, true],
                ["기종", isNewVendor ? (newLease.model || "") : pick(lease, "모델명", "기종"), !isNewVendor],
                ["시리얼(기번)", isNewVendor ? (newLease.serialNo || "") : pick(lease, "시리얼번호(기번)", "기번"), !isNewVendor],
                ["자산기번", isNewVendor ? (newLease.assetNo || "") : pick(lease, "자산번호"), !isNewVendor && type === "복합기 AS"],
                ["접수자 성함", manual.접수자성함.trim(), true],
                ["접수자 연락처", manual.접수자연락처.trim(), true],
                ["증상", manual.증상.trim(), true],
                ["주소", manual.주소.trim() || pick(lease, "주소(실납품주소,도로명주소)", "주소"), type !== "원격이관"],
              ];
              const missing = checkItems.filter(([, value, required]) => required && !value).length + (manual.주소.trim() ? 0 : 1);
              return (
                <div className="fixed inset-0 z-[210] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => { setConfirmAction(null); setConfirmChecked(false); }}>
                  <div className="flex max-h-[90vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-xl" onMouseDown={(e) => e.stopPropagation()}>
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
                          <div key={label} className="rounded-lg bg-slate-50 px-3 py-2">
                            <div className="text-[10px] font-black text-slate-400">{label}</div>
                            <div className={`mt-0.5 truncate text-xs font-black ${value ? "text-slate-800" : required ? "text-rose-600" : "text-slate-400"}`}>{value || "미기재"}</div>
                          </div>
                        ))}
                      </div>
                      {missing > 0 && <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-black text-rose-700">빨간 항목 {missing}개 — 그래도 진행하려면 아래 확인에 체크하세요.</div>}
                      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 text-xs font-bold text-slate-700">
                        <input type="checkbox" checked={scheduleToo} onChange={(e) => setScheduleToo(e.target.checked)} className="mt-0.5 h-4 w-4 accent-blue-600" />
                        저장하면서 일정리스트에도 등록 (오늘 날짜, 담당자 미배정)
                      </label>
                      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 text-xs font-bold text-slate-700">
                        <input type="checkbox" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} className="mt-0.5 h-4 w-4 accent-blue-600" />
                        방문 주소와 접수자·기기 정보를 확인했습니다{confirmAction === "send" ? " (AS방으로 전송됩니다)" : ""}
                      </label>
                    </div>
                    <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
                      <button type="button" onClick={() => { setConfirmAction(null); setConfirmChecked(false); }} className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-black text-slate-500 transition hover:bg-slate-50">취소</button>
                      <button type="button" disabled={!confirmChecked || busy} onClick={() => { const action = confirmAction; setConfirmAction(null); setConfirmChecked(false); if (action === "send") void handleSaveAndSend(); else void handleSave(); }} className="rounded-full bg-blue-600 px-6 py-2.5 text-sm font-black text-white shadow-[0_4px_14px_rgba(37,99,235,0.35)] transition hover:bg-blue-700 disabled:opacity-40 disabled:shadow-none">{confirmAction === "send" ? "확인하고 전송" : "확인하고 저장"}</button>
                    </div>
                  </div>
                </div>
              );
            })()}

        </div>

        {/* ==== 목록: 원격 탭은 작업 보드, 리스트 탭은 기간별 접수 기록 ==== */}
        {page !== "copier" && <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:rounded-xl">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-[#1E252F] px-4 py-3">
            <div>
              <h3 className="text-sm font-black text-white lg:text-[15px]">{page === "remote" ? "원격 · IT 작업" : "접수 리스트"}</h3>
              <p className="text-[11px] font-semibold text-slate-400">{page === "remote" ? "최근 30일 · 카드를 열어 시작·종료와 처리 결과를 남깁니다" : "행을 열어 상세·일정 등록·주소 확인을 처리합니다"}</p>
            </div>
            {page === "remote" && <button type="button" onClick={() => void loadRemoteQueue()} className="rounded-full bg-white/10 px-3.5 py-1.5 text-[11px] font-black text-slate-200 transition hover:bg-white/20">새로고침</button>}
          </div>
          {page === "list" && <div className="border-b border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <button type="button" aria-label="이전 기간" onClick={() => setListDate(listPeriod === "day" ? shiftDate(listDate, -1) : listPeriod === "week" ? shiftDate(listDate, -7) : shiftMonths(listDate, listPeriod === "month" ? -1 : -3))} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:bg-slate-50"><ChevronLeft size={16} /></button>
                <input type="date" value={listDate} onChange={(e) => e.target.value && setListDate(e.target.value)} className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-bold text-slate-700 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                <button type="button" aria-label="다음 기간" onClick={() => setListDate(listPeriod === "day" ? shiftDate(listDate, 1) : listPeriod === "week" ? shiftDate(listDate, 7) : shiftMonths(listDate, listPeriod === "month" ? 1 : 3))} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:bg-slate-50"><ChevronRight size={16} /></button>
                {!isToday && <button type="button" onClick={() => setListDate(kstDate())} className="rounded-full bg-slate-900 px-3.5 py-1.5 text-[11px] font-black text-white transition hover:bg-slate-800">오늘</button>}
              </div>
              <div className="grid grid-cols-4 rounded-full bg-slate-100 p-1 sm:w-72">
                {(Object.keys(PERIOD_LABEL) as ListPeriod[]).map((p) => (
                  <button key={p} type="button" onClick={() => setListPeriod(p)} className={`rounded-full px-2 py-1.5 text-[11px] font-black transition ${listPeriod === p ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{PERIOD_LABEL[p]}</button>
                ))}
              </div>
            </div>
            {listPeriod !== "day" && <div className="mt-2 text-[11px] font-bold text-slate-400">{periodRangeOf(listPeriod, listDate).start} ~ {periodRangeOf(listPeriod, listDate).end} · {counts.total}건</div>}
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {(["전체", "복합기 AS", "IT", "원격이관", "주소확인"] as const).map((f) => (
                <button key={f} type="button" onClick={() => setListFilter(f)} className={`rounded-full px-3.5 py-1.5 text-[11px] font-black transition ${listFilter === f ? "bg-slate-900 text-white" : f === "주소확인" && counts.addr > 0 ? "bg-amber-100 text-amber-800 hover:bg-amber-200" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
                  {f === "전체" ? `전체 ${counts.total}` : f === "복합기 AS" ? `복합기 ${counts.copier}` : f === "IT" ? `IT ${counts.it}` : f === "원격이관" ? `원격 ${counts.remote}` : `📍주소 ${counts.addr}`}
                </button>
              ))}
            </div>
          </div>}

          <div className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
            {listLoading && page === "list" && <div className="p-8 text-center text-xs font-bold text-slate-400">불러오는 중…</div>}
            {page === "remote" && !remoteQueue.length && <div className="p-8 text-center text-xs font-bold text-slate-400">최근 30일 원격·IT 접수가 없습니다.</div>}
            {page === "list" && !listLoading && !filteredRows.length && <div className="p-8 text-center text-xs font-bold text-slate-400">{listPeriod === "day" ? `${listDate.slice(5)} 접수 기록이 없습니다.` : `${PERIOD_LABEL[listPeriod]} 접수 기록이 없습니다.`}</div>}
            {queueBody}
          </div>

          {previewRow && (
            <div className="fixed inset-0 z-[200] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setPreviewRow(null)}>
              <div className="flex max-h-[85vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:max-w-2xl sm:rounded-xl" onMouseDown={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                  <div className="min-w-0">
                    <div className="text-xs font-black text-blue-600">원본 보고양식</div>
                    <div className="truncate text-base font-black text-slate-950">{previewRow.vendor || "업체 미기재"}</div>
                  </div>
                  <button type="button" onClick={() => setPreviewRow(null)} className="h-9 w-9 shrink-0 rounded-lg text-xl font-black text-slate-400">×</button>
                </div>
                <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap bg-slate-50 p-4 font-mono text-[11px] leading-5 text-slate-700">{previewRow.report_text}</pre>
                <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
                  <button type="button" onClick={() => setPreviewRow(null)} className="rounded-full border border-slate-200 px-4 py-2 text-sm font-bold text-slate-500">닫기</button>
                  <button type="button" onClick={() => { void navigator.clipboard.writeText(previewRow.report_text).then(() => setPreviewCopied(true)); }} className="rounded-full bg-slate-900 transition hover:bg-slate-800 px-5 py-2 text-sm font-black text-white">{previewCopied ? "복사됨 ✓" : "복사"}</button>
                </div>
              </div>
            </div>
          )}

          {page === "list" && byAuthor.length > 0 && <div className="border-t border-slate-200 bg-slate-50/60 p-4">
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
        </section>}
      </div>
    </div>
  );
}
