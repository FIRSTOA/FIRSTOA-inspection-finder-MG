import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { LocateFixed } from "lucide-react";
import "leaflet/dist/leaflet.css";
import { deleteRows, selectAllRows, selectAllRowsFast, selectRows, upsertRows } from "./supabase";
import { isMobileDevice, kakaoMapRouteLink, kakaoMapSearchLink, naverMapLink } from "./navApp";
import { geocodeKR } from "./geocode";
import { loadKakaoMaps, type KakaoNS } from "./kakaoMap";
import { MISU_DETAIL_FIELDS, MISU_DETAIL_LAYOUT, OVERAGE_DETAIL_FIELDS, OVERAGE_DETAIL_LAYOUT, SheetDetailModal } from "./MisuOverageBoards";
import { normalizeId as normalizeIdKey, vendorMatchKey } from "./ids";
import { getTeamVisits, kstDate, type VisitRow } from "./visits";
import { spareNeedItems, usageSpareAdvice, type SpareNeed } from "./spareAdvice";
import { notify } from "./toast";

type MapLabel = {
  code: string;
  name: string;
  color: string;
};

type Team = "A" | "B" | "C" | "D";
type Quarter = 1 | 2 | 3 | 4;
type WorkKind = "quarter" | "monthly" | "renewal";

type MapPlace = {
  id: number;
  number: number;
  team?: Team;
  quarter?: Quarter;
  kind?: WorkKind;
  label: string;
  visible: boolean;
  name: string;
  comment: string;
  phone: string;
  address: string;
  addressDetail: string;
  latitude: number;
  longitude: number;
  memos: string[];
};

type DbMapPlace = {
  id: number;
  number: number;
  team: Team;
  quarter: Quarter;
  kind: WorkKind;
  label: string;
  visible: boolean;
  name: string;
  comment: string;
  phone: string;
  address: string;
  address_detail: string;
  latitude: number;
  longitude: number;
  memos: string[];
};

const storageKey = "cs_workin_map_places_v2";
const excelBaseHeaders = ["번호", "라벨", "지도에서", "이름", "코멘트", "전화번호", "주소", "상세주소", "위도", "경도"];
const defaultMemoColumnCount = 15;
const memoHeaders = (count: number) => Array.from({ length: count }, (_, index) => `메모${index + 1}`);
const teams: Team[] = ["A", "B", "C", "D"];
const quarters: Quarter[] = [1, 2, 3, 4];
const workKinds: { value: WorkKind; label: string }[] = [
  { value: "quarter", label: "분기점검" },
  { value: "monthly", label: "매월점검" },
  { value: "renewal", label: "재계약" },
];
const teamMapViews: Record<Team, { center: [number, number]; zoom: number }> = {
  A: { center: [37.64, 127.02], zoom: 10 },
  B: { center: [37.53, 126.88], zoom: 10 },
  C: { center: [37.52, 127.09], zoom: 10 },
  D: { center: [37.65, 127.2], zoom: 9 },
};

// MapCanvas(자식)의 지도 인스턴스를 메인 컴포넌트의 주소 검색이 쓸 수 있게 하는 다리
let addressFlyBridge: ((lat: number, lng: number, label: string, sub: string) => void) | null = null;
let addressClearBridge: (() => void) | null = null;

const mapLabels: MapLabel[] = [
  { code: "G1", name: "", color: "#ff8458" },
  { code: "G2", name: "", color: "#ffb51b" },
  { code: "G3", name: "", color: "#ff2f68" },
  { code: "G4", name: "", color: "#b22998" },
  { code: "G5", name: "점검 완료", color: "#087fa2" },
  { code: "G6", name: "", color: "#25b44b" },
  { code: "G7", name: "공청기", color: "#b56ef3" },
  { code: "G8", name: "", color: "#896347" },
  { code: "G9", name: "", color: "#c6a273" },
  { code: "G10", name: "", color: "#139fe4" },
  { code: "G11", name: "", color: "#1f744a" },
  { code: "G12", name: "이관", color: "#343434" },
];

type MapPreferences = {
  team: Team;
  quarter: Quarter;
  kind: WorkKind | "ALL";
  labels: string[];
};

function loadMapPreferences(key: string): MapPreferences {
  const currentQuarter = (Math.floor(new Date().getMonth() / 3) + 1) as Quarter;
  try {
    const stored = JSON.parse(localStorage.getItem(key) || "null") as Partial<MapPreferences> | null;
    const storedKind = stored?.kind;
    return {
      team: stored?.team && teams.includes(stored.team) ? stored.team : "C",
      quarter: stored?.quarter && quarters.includes(stored.quarter) ? stored.quarter : currentQuarter,
      kind: storedKind === "ALL" || workKinds.some((item) => item.value === storedKind) ? storedKind as WorkKind | "ALL" : "ALL",
      labels: Array.isArray(stored?.labels) ? stored.labels.filter((code) => mapLabels.some((item) => item.code === code)) : [],
    };
  } catch {
    return { team: "C", quarter: currentQuarter, kind: "ALL", labels: [] };
  }
}

function loadTeamMapView(key: string, team: Team) {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || "null") as Partial<Record<Team, { center: [number, number]; zoom: number }>> | null;
    const view = stored?.[team];
    if (view && Array.isArray(view.center) && view.center.length === 2 && view.center.every(Number.isFinite) && Number.isFinite(view.zoom)) return view;
  } catch {
    // Use the team default below.
  }
  return teamMapViews[team];
}

function saveTeamMapView(key: string, team: Team, map: L.Map) {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || "{}") as Partial<Record<Team, { center: [number, number]; zoom: number }>>;
    const center = map.getCenter();
    stored[team] = { center: [center.lat, center.lng], zoom: map.getZoom() };
    localStorage.setItem(key, JSON.stringify(stored));
  } catch {
    // A blocked localStorage should not prevent map use.
  }
}

const initialPlaces: MapPlace[] = [
  {
    id: 1,
    number: 1,
    label: "G2",
    visible: true,
    name: "14SS (주)이오플랜 본사 1 매월마감",
    comment: "ApeosPort-VII C5573(보탄) / 291047",
    phone: "김소연 과장 010-9067-5890",
    address: "서울 성동구 아차산로17길 49",
    addressDetail: "성수더블유센터 데시앙플렉스 1411호",
    latitude: 37.54657386,
    longitude: 127.0645951,
    memos: ["복합기확장성", "방문주기 1개월", "계약종료년월 2706", "미수금 0원 / 0개월", "한조10928 / 틴텍215881", "연평균 15만원 이상 거래처", "매월", "일반", "임대중", "SS", "서울/성동구"],
  },
  { id: 2, number: 2, label: "G3", visible: true, name: "11SO 이크럭스벤처파트너스(유) 분기마감", comment: "APEOSPORT-C2060 / 227683", phone: "정무열 010-5422-5078", address: "서울 강남구 강남대로 320", addressDetail: "5층 종합회의실", latitude: 37.4918, longitude: 127.0311, memos: ["방문주기 3개월", "계약종료년월 2606", "강남", "S"] },
  { id: 3, number: 3, label: "G4", visible: true, name: "25S 법률사무소 남산 계약종료", comment: "D420 / 792090564870", phone: "02-000-0000", address: "서울 중구 퇴계로", addressDetail: "남산빌딩 8층", latitude: 37.5582, longitude: 126.9866, memos: ["계약종료 확인", "기기상태 확인 필요"] },
  { id: 4, number: 4, label: "G5", visible: true, name: "3NN 아스크스토리디에스 분기점검", comment: "DocuCentre-V C3375 / 392700", phone: "010-0000-1111", address: "인천 남동구 인주대로", addressDetail: "본관 2층", latitude: 37.4474, longitude: 126.7052, memos: ["3분기 점검 완료", "일반"] },
  { id: 5, number: 5, label: "G2", visible: true, name: "26S 시티온전 시티엔 매월마감", comment: "SL-X4225RX / ZJY0BJMN600003Z", phone: "010-0000-2222", address: "대전 서구 둔산로", addressDetail: "3층 관리사무소", latitude: 36.351, longitude: 127.385, memos: ["매월 점검", "기본임대"] },
  { id: 6, number: 6, label: "G6", visible: true, name: "27NN 유어세무회계컨설팅", comment: "SL-X3220NR / 0A6XBJWC000ANJ", phone: "010-1111-2222", address: "대구 수성구 동대구로", addressDetail: "7층", latitude: 35.8581, longitude: 128.6306, memos: ["확장성 대상", "분기 점검"] },
  { id: 7, number: 7, label: "G10", visible: true, name: "18S 인포레인솔루션", comment: "C3375 / C3375-1801", phone: "010-3333-4444", address: "광주 서구 상무중앙로", addressDetail: "상무타워 10층", latitude: 35.1522, longitude: 126.8529, memos: ["AS 집중 관리"] },
  { id: 8, number: 8, label: "G8", visible: true, name: "9SS 유니메오 교체예정", comment: "AP C3060 / C3060-0001", phone: "010-4444-5555", address: "부산 해운대구 센텀중앙로", addressDetail: "센텀빌딩 4층", latitude: 35.1698, longitude: 129.1313, memos: ["동일 기종 교체 예정"] },
  { id: 9, number: 9, label: "G11", visible: true, name: "제주 지점 휴면관리", comment: "SL-X4220RX / JEJU-001", phone: "064-000-0000", address: "제주 제주시 연삼로", addressDetail: "2층", latitude: 33.4996, longitude: 126.5312, memos: ["방문 보류", "담당자 확인 필요"] },
];

function labelMeta(code: string) {
  return mapLabels.find((item) => item.code === code) || mapLabels[mapLabels.length - 1];
}

function isCompleted(place: MapPlace) {
  return place.label === "G5" || place.label === "G12";
}

function monthlyInspectionUnits(place: MapPlace) {
  if (place.label === "G2") return 1;
  if (place.label === "G3") return 2;
  if (place.label === "G5" || place.label === "G12") return 3;
  return 0;
}

const koreanHolidays: Record<number, string[]> = {
  2026: ["01-01", "02-16", "02-17", "02-18", "03-02", "05-01", "05-05", "05-25", "06-03", "08-17", "09-24", "09-25", "10-05", "10-09", "12-25"],
};

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function businessDaysBetween(start: Date, end: Date) {
  if (start > end) return 0;
  const holidays = new Set((koreanHolidays[start.getFullYear()] || []).map((day) => `${start.getFullYear()}-${day}`));
  let count = 0;
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cursor <= last) {
    const weekday = cursor.getDay();
    if (weekday !== 0 && weekday !== 6 && !holidays.has(localDateKey(cursor))) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

function quarterDates(year: number, quarter: Quarter) {
  const startMonth = (quarter - 1) * 3;
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth + 3, 0);
  const earlyEnd = new Date(end);
  earlyEnd.setDate(earlyEnd.getDate() - 10);
  return { start, end, earlyEnd };
}

function dailyTarget(remaining: number, businessDays: number, members: number) {
  if (remaining <= 0) return "완료";
  if (businessDays <= 0) return "기한 경과";
  return `${(remaining / businessDays / members).toFixed(1)}건/일`;
}

function contractEnd(place: MapPlace, baseYear: number) {
  const source = [place.name, ...place.memos].join(" ");
  const marked = source.match(/계약종료(?:년월)?\s*[-/:.]?\s*(\d{2,4})\s*[-년/.]?\s*(\d{1,2})?/);
  const leading = place.name.match(/^(\d{2})(\d{2})\//);
  let year = 0;
  let month = 0;
  if (marked) {
    const digits = marked[1];
    if (digits.length === 4 && !marked[2]) {
      year = 2000 + Number(digits.slice(0, 2));
      month = Number(digits.slice(2));
    } else {
      year = digits.length === 2 ? 2000 + Number(digits) : Number(digits);
      month = Number(marked[2] || 0);
    }
  } else if (leading) {
    year = 2000 + Number(leading[1]);
    month = Number(leading[2]);
  }
  if (!year || month < 1 || month > 12) return null;
  if (year < 1900 || year > baseYear + 20) return null;
  return { year, month, key: year * 100 + month, label: `${String(year).slice(2)}년 ${month}월`, date: `${year}.${String(month).padStart(2, "0")}.${new Date(year, month, 0).getDate()}` };
}

function renewalQuarterMonths(quarter: Quarter) {
  return quarter === 1 ? [2, 3, 4] : quarter === 2 ? [5, 6, 7] : quarter === 3 ? [8, 9, 10] : [11, 12, 1];
}

function fmtDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// G5(완료)/G12(이관) 라벨을 달 때 메모에 "[G5 완료] YYYY-MM-DD"가 기록된다. 그 완료일을 읽는다.
function completionDate(place: MapPlace) {
  for (const memo of place.memos) {
    const match = memo.match(/^\[(?:G5 완료|G12 이관)\]\s*(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  return "";
}

// 분기를 월요일 기준 주차로 나눈다.
function quarterWeeks(year: number, quarter: Quarter) {
  const startMonth = (quarter - 1) * 3;
  const qStart = new Date(year, startMonth, 1);
  const qEnd = new Date(year, startMonth + 3, 0);
  const cursor = new Date(qStart);
  const day = cursor.getDay();
  cursor.setDate(cursor.getDate() + (day === 0 ? -6 : 1 - day));
  const weeks: Array<{ label: string; start: string; end: string }> = [];
  let n = 1;
  while (cursor <= qEnd) {
    const weekEnd = new Date(cursor);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weeks.push({ label: `${n}주`, start: fmtDate(cursor), end: fmtDate(weekEnd) });
    cursor.setDate(cursor.getDate() + 7);
    n += 1;
  }
  return weeks;
}

// 미수 입력일 형식이 2025-12-09 / 2025.12.10 / 2026.7.2 로 섞여 있어 비교용으로 정규화한다.
function normMisuDate(value: string) {
  const match = String(value).match(/(\d{4})[.\-/]\s*(\d{1,2})(?:[.\-/]\s*(\d{1,2}))?/);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}-${(match[3] || "1").padStart(2, "0")}` : "";
}

function misuBalanceLabel(value: string) {
  const digits = String(value).replace(/[^\d]/g, "");
  return digits ? `${Number(digits).toLocaleString()}원` : String(value || "").trim();
}

// 매월점검 이름 맨 앞 숫자 = 마감일(1~31). 세금계산서용 카운터 검침을 위해 이 날 3~5일 전에 방문한다.
function monthlyClosingDay(name: string) {
  const match = String(name).match(/^\s*(\d{1,2})/);
  if (!match) return null;
  const day = Number(match[1]);
  return day >= 1 && day <= 31 ? day : null;
}

// 진행률 요약에서만 자동연장된 계약의 종료월을 현재 주기로 투영한다.
function projectedContractEnd(place: MapPlace, baseYear: number, quarter: Quarter) {
  const original = contractEnd(place, baseYear);
  const months = renewalQuarterMonths(quarter);
  if (!original || !months.includes(original.month)) return null;
  const year = quarter === 4 && original.month === 1 ? baseYear + 1 : baseYear;
  return {
    year,
    month: original.month,
    key: months.indexOf(original.month),
    label: `${original.month}월`,
    date: `${year}.${String(original.month).padStart(2, "0")}.${new Date(year, original.month, 0).getDate()}`,
  };
}

function renewalGrade(place: MapPlace) {
  const memoGrade = place.memos.map((memo) => memo.trim().toUpperCase()).find((memo) => /^(V|SS|S|NN|N)$/.test(memo));
  if (memoGrade) return memoGrade;
  return place.name.match(/^(?:\d{4}\/)?\d*(SS|NN|S|N|V)(?=[^A-Z]|$)/i)?.[1]?.toUpperCase() || "";
}

function addressGroupKey(place: MapPlace) {
  const address = (place.address.trim() || place.addressDetail.trim()).replace(/\s+/g, "").replace(/[^0-9a-z가-힣]/gi, "").toLowerCase();
  return address || `${place.latitude.toFixed(6)},${place.longitude.toFixed(6)}`;
}



function daysBetween(from: string, to: string) {
  return Math.max(0, Math.floor((new Date(`${to}T12:00:00+09:00`).getTime() - new Date(`${from}T12:00:00+09:00`).getTime()) / 86_400_000));
}

function dateDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return kstDate(date);
}

function deviceSerial(place: MapPlace) {
  const parts = place.comment.split("/").map((value) => value.trim()).filter(Boolean);
  return [...parts].reverse().find((value) => /^[A-Z0-9-]{5,}$/i.test(value.replace(/\s/g, "")))?.replace(/\s/g, "") || "";
}

// 점검이력 매칭용 최소 방문 형태 — visit_logs와 jeomgeom(원본) 어느 쪽에서 와도 동일하게 다룬다.
type VisitLike = { workDate: string; vendor: string; sourceText: string; note: string };



function deviceVisitText(visit: VisitLike, place: MapPlace) {
  const source = visit.sourceText || visit.note || "";
  const serial = deviceSerial(place);
  if (!serial || !source.toUpperCase().includes(serial.toUpperCase())) return source;
  const blocks = splitDeviceBlocks(source);
  return blocks.find((block) => block.toUpperCase().includes(serial.toUpperCase())) || source;
}

function visitMetric(text: string, label: string) {
  const nextField = "작성자|구분|레벨|등급|업체명|부서명|지역|키맨\\/접수자|모델명|시리얼넘버|자산기번|내용|처리내용|매수|토너잔량|폐통|여분|한틴이카유무|주차비지원유무|특이사항|도착 시간|소요 시간";
  const match = text.match(new RegExp(`(?:^|\\n)${label}\\s*[:：]\\s*([\\s\\S]*?)(?=\\n(?:${nextField})\\s*[:：]|\\n[-_=ㅡ]{5,}|\\n※|$)`, "i"));
  return (match?.[1] || "").trim().replace(/\n+/g, " · ");
}

function visitSpareLocation(spare: string) {
  return spare.match(/(?:보관\s*)?위치\s*[:：]?\s*([^·/]+)/i)?.[1]?.trim() || "";
}

function visitSnapshot(visit: VisitLike, place: MapPlace) {
  const text = deviceVisitText(visit, place);
  const spare = visitMetric(text, "여분");
  return {
    date: visit.workDate,
    counts: visitMetric(text, "매수"),
    toner: visitMetric(text, "토너잔량"),
    spare,
    waste: visitMetric(text, "폐통"),
    serial: visitMetric(text, "시리얼넘버"),
    model: visitMetric(text, "모델명"),
    asset: visitMetric(text, "자산기번"),
    spareLocation: visitSpareLocation(spare),
  };
}

// 스냅샷의 기기 식별 줄 — 기기 교체·혼동을 바로 알아챌 수 있게 모델/자산/기번을 붙인다.
function snapshotDeviceLabel(snapshot: { model?: string; asset?: string; serial?: string }) {
  return [snapshot.model, snapshot.asset && `자산 ${snapshot.asset}`, snapshot.serial && `기번 ${snapshot.serial}`].filter(Boolean).join(" · ");
}

// 업체 전체 자가신청 — 최근 방문 양식(모든 기기 블록)을 그대로 불러와 기기별 여분을 분석하고
// ※자가신청※에 기종별로 집계해 채운다. 예전 "점검방 양식 훑어보고 기종별로 적던" 흐름의 자동화.
// 기기 블록 분리 — 실제 양식은 "1. 2층 대표실 공청기"처럼 번호 뒤에 위치 텍스트가 붙기도 한다.
// 여러 분리 방식 중 기기 블록이 가장 많이 나오는 결과를 쓴다.
function splitDeviceBlocks(source: string) {
  const isDevice = (block: string) => visitMetric(block, "모델명") || visitMetric(block, "시리얼넘버");
  const candidates = [
    source.split(/\n(?=\d+\.[^\n]*\n\s*(?:부서명|모델명|시리얼넘버)\s*[:：])/), // "N. 위치" 다음 줄이 기기 필드
    source.split(/\n(?=\d+\.\s*(?:\n|$))/),                                    // "N." 단독 줄
    source.split(/\n(?=모델명\s*[:：])/),                                        // 번호 없이 모델명부터
  ].map((blocks) => blocks.filter(isDevice));
  return candidates.reduce((best, blocks) => (blocks.length > best.length ? blocks : best), [] as string[]);
}

// 이력 매칭용 원본(jeomgeom)은 기기 1대=1행이라 전체 양식이 아니다. 자가신청 시에만
// 그 날짜의 _원문(모든 기기 블록 포함)을 즉석에서 가져온다.
async function fetchFullFormText(vendor: string, workDate: string): Promise<string> {
  if (!vendor.trim()) return "";
  try {
    const rows = await selectRows<Record<string, unknown>>(
      "jeomgeom",
      `select=${encodeURIComponent("_원문,작성일")}&${encodeURIComponent("_업체명")}=eq.${encodeURIComponent(vendor)}&order=${encodeURIComponent("작성일")}.desc&limit=12`,
    );
    const texts = rows
      .filter((row) => String(row["작성일"] || "").slice(0, 10) === workDate)
      .map((row) => String(row["_원문"] || "").trim())
      .filter(Boolean);
    return texts.sort((a, b) => b.length - a.length)[0] || "";
  } catch {
    return "";
  }
}

function buildVendorSelfRequestText(author: string, visit: VisitLike): string | null {
  const source = visit.sourceText || "";
  const blocks = splitDeviceBlocks(source);
  if (blocks.length < 2) return null;
  const entries: string[] = [];
  for (const block of blocks) {
    const snapshot = {
      date: visit.workDate,
      counts: visitMetric(block, "매수"),
      toner: visitMetric(block, "토너잔량"),
      spare: visitMetric(block, "여분"),
      waste: visitMetric(block, "폐통"),
      serial: visitMetric(block, "시리얼넘버"),
    };
    const model = visitMetric(block, "모델명") || snapshot.serial || `기기${entries.length + 1}`;
    const advice = usageSpareAdvice(snapshot, undefined, model);
    if (!advice || !advice.needsList.length) continue;
    entries.push(`[${model}] ${spareNeedItems(advice.needsList).join(" ")}`);
  }
  const itemsLine = entries.join(" / ");
  let text = source.replace(/^작성자\s*[:：].*$/m, `작성자:${author}`);
  if (/※자가신청※/.test(text)) {
    text = text.replace(
      /(※자가신청※\s*\n)(물품\s*[:：][^\n]*\n?)?(수량\s*[:：][^\n]*\n?)?(출고여부\s*[:：][^\n]*)?/,
      `$1물품: ${itemsLine}\n수량:\n출고여부: 출고부탁드립니다`,
    );
  } else {
    text += ["", "ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ", "※자가신청※", `물품: ${itemsLine}`, "수량:", "출고여부: 출고부탁드립니다"].join("\n");
  }
  return text;
}

// 주소 옆 내비 바로가기 — 네이버지도 / 카카오맵(내비) / T맵(앱 전용 스킴).
function NavLinks({ place, large }: { place: MapPlace; large?: boolean }) {
  const address = [place.address, place.addressDetail].filter(Boolean).join(" ").trim();
  const hasCoord = Number.isFinite(place.latitude) && Number.isFinite(place.longitude) && place.latitude !== 0 && place.longitude !== 0;
  if (!address && !hasCoord) return null;
  const name = encodeURIComponent((place.name || address).slice(0, 30));
  const naver = naverMapLink(address || place.name);
  const kakao = hasCoord
    ? kakaoMapRouteLink((place.name || address).slice(0, 30), place.latitude, place.longitude)
    : kakaoMapSearchLink(address);
  const tmap = hasCoord ? `tmap://route?goalname=${name}&goalx=${place.longitude}&goaly=${place.latitude}` : "";
  const cls = large ? "rounded-lg px-2.5 py-1.5 text-xs font-black" : "rounded px-1.5 py-0.5 text-[10px] font-black";
  return (
    <span className={`inline-flex items-center ${large ? "gap-1.5" : "gap-1"}`}>
      <a href={naver} {...(isMobileDevice ? {} : { target: "_blank", rel: "noreferrer" })} title="네이버지도" className={`${cls} bg-[#03C75A] text-white`}>N</a>
      <a href={kakao} {...(isMobileDevice ? {} : { target: "_blank", rel: "noreferrer" })} title="카카오맵" className={`${cls} bg-[#FEE500] text-slate-900`}>K</a>
      {tmap && <a href={tmap} title="T맵 (앱)" className={`${cls} bg-rose-500 text-white`}>T</a>}
    </span>
  );
}

// 자가신청용 점검 양식 전체 생성 — 워킨맵은 판단만 하고 작성·전송은 FIELD로 넘긴다(핸드오프).
type SelfRequestSnapshot = { model?: string; serial?: string; asset?: string; counts?: string; toner?: string; waste?: string; spare?: string };
function buildSelfRequestText(author: string, vendor: string, place: MapPlace, snapshot: SelfRequestSnapshot | undefined, needsList: SpareNeed[]) {
  const items = spareNeedItems(needsList);
  return [
    `작성자:${author}`,
    "구분: 점검",
    "레벨:1",
    "등급:",
    `업체명:${vendor}`,
    "부서명:",
    `지역:${place.team || ""}`,
    "키맨/접수자:",
    "ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ",
    "1.",
    `모델명: ${snapshot?.model || place.comment.split("/")[0]?.trim() || ""}`,
    `시리얼넘버: ${snapshot?.serial || deviceSerial(place)}`,
    `자산기번: ${snapshot?.asset || ""}`,
    "내용: 여분 자가신청",
    "처리내용:",
    `매수: ${snapshot?.counts || "흑- 컬- 큰컬- 합-"}`,
    `토너잔량: ${snapshot?.toner || "K- C- M- Y-"}`,
    `폐통: ${snapshot?.waste || ""}`,
    `여분: ${snapshot?.spare || ""}`,
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
    `물품: ${items.join(" ")}`,
    "수량:",
    "출고여부: 출고부탁드립니다",
    "ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ",
    "도착 시간:",
    "소요 시간:",
  ].join("\n");
}

type InspectionArchiveRow = Record<string, unknown>;

function archiveText(row: InspectionArchiveRow) {
  const raw = String(row["_원문"] || "").trim();
  if (raw) return raw;
  return ["모델명", "시리얼넘버", "자산기번", "매수", "토너잔량", "폐통", "여분"]
    .map((label) => `${label}: ${String(row[label] || "").trim()}`)
    .join("\n");
}

function normalizePlaces(source: MapPlace[]) {
  return source.map((place, index) => ({
    ...place,
    team: place.team || teams[index % teams.length],
    quarter: place.quarter || ((index % 4) + 1) as Quarter,
    kind: place.kind || workKinds[index % workKinds.length].value,
  }));
}

function loadStoredPlaces(): MapPlace[] | null {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
    return Array.isArray(stored) && stored.length ? normalizePlaces(stored as MapPlace[]) : null;
  } catch {
    return null;
  }
}

function loadPlaces() { return loadStoredPlaces() || normalizePlaces(initialPlaces); }

function loadMigratablePlaces() {
  const stored = loadStoredPlaces();
  if (!stored) return null;
  const isDefaultSample = stored.length === initialPlaces.length
    && stored.every((place, index) => place.id === initialPlaces[index].id && place.name === initialPlaces[index].name);
  return isDefaultSample ? null : stored;
}

function fromDbPlace(place: DbMapPlace): MapPlace {
  return { ...place, addressDetail: place.address_detail || "", memos: Array.isArray(place.memos) ? place.memos : [] };
}

function toDbPlace(place: MapPlace, userKey: string): Record<string, unknown> {
  return {
    id: place.id, number: place.number, team: place.team || "C", quarter: place.quarter || 3,
    kind: place.kind || "quarter", label: place.label, visible: place.visible, name: place.name,
    comment: place.comment, phone: place.phone, address: place.address, address_detail: place.addressDetail,
    latitude: place.latitude, longitude: place.longitude, memos: place.memos, updated_by: userKey,
    updated_at: new Date().toISOString(),
  };
}

function withLabelHistory(place: MapPlace, previousLabel?: string): MapPlace {
  if (place.label === previousLabel || (place.label !== "G5" && place.label !== "G12")) return place;
  const date = kstDate();
  const entry = place.label === "G5" ? `[G5 완료] ${date}` : `[G12 이관] ${date}`;
  return place.memos.includes(entry) ? place : { ...place, memos: [...place.memos, entry] };
}

function blankPlace(number: number): MapPlace {
  return {
    id: Date.now(), number, team: "C", quarter: 3, kind: "quarter", label: "G1", visible: true, name: "", comment: "", phone: "",
    address: "", addressDetail: "", latitude: 37.5665, longitude: 126.978, memos: [],
  };
}

function compactMapName(name: string, maxLength = 17) {
  const compact = name.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}…` : compact;
}

function samePlaces(current: MapPlace[], next: MapPlace[]) {
  if (current.length !== next.length) return false;
  return JSON.stringify(current) === JSON.stringify(next);
}

function styleMapLabel(element: HTMLDivElement, active: boolean) {
  // 카카오 라벨은 자체 흰 말풍선 배경을 갖는다(data-kakao) — 비활성 복귀 시 흰 배경으로 되돌린다
  const kakaoStyle = element.style.display === "inline-block";
  element.style.background = active ? "#0f172a" : kakaoStyle ? "rgba(255,255,255,.94)" : "";
  element.style.color = active ? "#ffffff" : kakaoStyle ? "#0f172a" : "";
  element.style.padding = active ? "5px 7px" : kakaoStyle ? "2px 6px" : "";
  element.style.margin = active ? "-5px -7px" : "";
  element.style.borderRadius = active ? "4px" : kakaoStyle ? "5px" : "";
  element.style.boxShadow = active ? "0 4px 12px rgba(15, 23, 42, .28)" : kakaoStyle ? "0 1px 5px rgba(15,23,42,.22)" : "";
}

type CurrentPosition = {
  latitude: number;
  longitude: number;
  accuracy: number;
  revision: number;
};

const MapCanvas = memo(function MapCanvas({ places, selectedId, team, viewStorageKey, onSelect, currentPosition }: { places: MapPlace[]; selectedId: number | null; team: Team; viewStorageKey: string; onSelect: (id: number) => void; currentPosition: CurrentPosition | null }) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const addressPinRef = useRef<L.Marker | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const canvasRendererRef = useRef<L.Canvas | null>(null);
  const markerByIdRef = useRef(new Map<number, L.Marker | L.CircleMarker>());
  const markerSignatureRef = useRef(new Map<number, string>());
  const labelByIdRef = useRef(new Map<number, HTMLDivElement>());
  const locationLayerRef = useRef<L.LayerGroup | null>(null);
  const [tilesReady, setTilesReady] = useState(false);
  const [viewportRevision, setViewportRevision] = useState(0);

  useEffect(() => {
    if (!elementRef.current || mapRef.current) return;
    const mobile = window.matchMedia("(max-width: 1023px)").matches;
    const markerById = markerByIdRef.current;
    const markerSignatures = markerSignatureRef.current;
    const labelsById = labelByIdRef.current;
    const map = L.map(elementRef.current, {
      zoomControl: true,
      attributionControl: false,
      minZoom: 6,
      fadeAnimation: false,
      markerZoomAnimation: false,
      maxBounds: [[32.5, 123.5], [39.5, 132]],
      maxBoundsViscosity: 0.8,
    });
    map.setView(teamMapViews.C.center, teamMapViews.C.zoom);
    const tiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      updateWhenIdle: true,
      updateWhenZooming: false,
      keepBuffer: mobile ? 1 : 4,
      attribution: "",
    });
    tiles.once("load", () => setTilesReady(true));
    tiles.addTo(map);
    const attribution = L.control.attribution({ position: "bottomright", prefix: false }).addTo(map);
    attribution.addAttribution('<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>');
    const attributionElement = attribution.getContainer();
    if (attributionElement) {
      attributionElement.style.fontSize = "8px";
      attributionElement.style.lineHeight = "12px";
      attributionElement.style.padding = "0 3px";
      attributionElement.style.background = "rgba(255,255,255,.78)";
    }
    markerLayerRef.current = L.layerGroup().addTo(map);
    locationLayerRef.current = L.layerGroup().addTo(map);
    canvasRendererRef.current = L.canvas({ padding: 0.18 });
    mapRef.current = map;
    // 주소 검색(메인 컴포넌트)에서 좌표로 지도를 움직일 수 있게 모듈 다리 등록
    addressClearBridge = () => {
      if (addressPinRef.current) { addressPinRef.current.remove(); addressPinRef.current = null; }
    };
    addressFlyBridge = (lat, lng, label, sub) => {
      if (addressPinRef.current) { addressPinRef.current.remove(); addressPinRef.current = null; }
      // 기본 마커 아이콘은 번들에서 이미지가 빠져 깨져 보인다 — 스타일 핀으로 대체
      const marker = L.marker([lat, lng], {
        zIndexOffset: 1000,
        icon: L.divIcon({ className: "", html: '<div style="font-size:30px;line-height:30px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))">📍</div>', iconSize: [30, 30], iconAnchor: [15, 28] }),
      });
      marker.addTo(map).bindPopup(`📍 ${label}<br/><span style="font-size:11px;color:#64748b">${sub}</span>`).openPopup();
      addressPinRef.current = marker;
      map.flyTo([lat, lng], Math.max(map.getZoom(), 15));
    };
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    observer.observe(elementRef.current);
    window.setTimeout(() => map.invalidateSize({ pan: false }), 50);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      addressFlyBridge = null;
      addressClearBridge = null;
      markerLayerRef.current = null;
      locationLayerRef.current = null;
      canvasRendererRef.current = null;
      markerById.clear();
      markerSignatures.clear();
      labelsById.clear();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const view = loadTeamMapView(viewStorageKey, team);
    const mobile = window.matchMedia("(max-width: 1023px)").matches;
    map.setView(view.center, view.zoom, { animate: !mobile });
    let refreshTimer = 0;
    const persistView = () => {
      saveTeamMapView(viewStorageKey, team, map);
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => setViewportRevision((current) => current + 1), mobile ? 320 : 100);
    };
    map.on("moveend zoomend", persistView);
    return () => {
      window.clearTimeout(refreshTimer);
      map.off("moveend zoomend", persistView);
    };
  }, [team, viewStorageKey]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = markerLayerRef.current;
    if (!map || !layer) return;
    const mobile = window.matchMedia("(max-width: 1023px)").matches;
    // 모바일은 화면 가장자리에서 마커를 자주 제거·생성하면 이동이 끊겨 보인다.
    // 넉넉한 완충 범위를 유지해 작은 지도 이동에서는 기존 마커를 재사용한다.
    const renderBounds = map.getBounds().pad(mobile ? 0.08 : 0.12);
    const visiblePlaces = places.filter((place) => Number.isFinite(place.latitude) && Number.isFinite(place.longitude) && renderBounds.contains([place.latitude, place.longitude]));
    const groupedPlaces = Array.from(visiblePlaces.reduce((groups, place) => {
      const key = addressGroupKey(place);
      const current = groups.get(key) || [];
      current.push(place);
      groups.set(key, current);
      return groups;
    }, new Map<string, MapPlace[]>()).values());
    const visibleIds = new Set(groupedPlaces.map((group) => group[0].id));
    const visiblePlaceIds = new Set(visiblePlaces.map((place) => place.id));
    markerByIdRef.current.forEach((marker, id) => {
      if (visibleIds.has(id)) return;
      layer.removeLayer(marker);
      markerByIdRef.current.delete(id);
      markerSignatureRef.current.delete(id);
    });
    labelByIdRef.current.forEach((_, id) => { if (!visiblePlaceIds.has(id)) labelByIdRef.current.delete(id); });
    const coordinateCounts = new Map<string, number>();
    groupedPlaces.forEach(([place]) => {
      if (!Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) return;
      const key = `${place.latitude.toFixed(6)},${place.longitude.toFixed(6)}`;
      coordinateCounts.set(key, (coordinateCounts.get(key) || 0) + 1);
    });
    const coordinateIndexes = new Map<string, number>();
    groupedPlaces.forEach((group) => {
      const place = group[0];
      if (!Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) return;
      const coordinateKey = `${place.latitude.toFixed(6)},${place.longitude.toFixed(6)}`;
      const duplicateIndex = coordinateIndexes.get(coordinateKey) || 0;
      coordinateIndexes.set(coordinateKey, duplicateIndex + 1);
      const duplicateCount = coordinateCounts.get(coordinateKey) || 1;
      const spreadIndex = Math.max(0, duplicateIndex - 1);
      const ring = Math.floor(spreadIndex / 8) + 1;
      const angle = ((spreadIndex % 8) / 8) * Math.PI * 2;
      const basePoint = map.latLngToLayerPoint([place.latitude, place.longitude]);
      const distance = duplicateCount > 1 && duplicateIndex > 0 ? 38 * ring : 0;
      const displayPoint = L.point(basePoint.x + Math.cos(angle) * distance, basePoint.y + Math.sin(angle) * distance);
      const displayPosition = map.layerPointToLatLng(displayPoint);
      const meta = labelMeta(place.label);
      const groupLabel = group.length > 1 ? `${compactMapName(place.name, 12)} 외 ${group.length - 1}곳` : compactMapName(place.name);
      const groupTitle = group.map((item) => item.name).join("\n");
      const groupSelected = group.some((item) => item.id === selectedId);
      const permanentLabel = !mobile || map.getZoom() >= 15 || groupSelected;
      const signature = [displayPosition.lat.toFixed(7), displayPosition.lng.toFixed(7), meta.color, groupLabel, permanentLabel ? "label" : "marker", group.map((item) => `${item.id}:${item.name}`).join(",")].join("|");
      const currentMarker = markerByIdRef.current.get(place.id);
      if (currentMarker && markerSignatureRef.current.get(place.id) === signature) {
        const currentLabel = labelByIdRef.current.get(place.id);
        if (currentLabel) styleMapLabel(currentLabel, groupSelected);
        return;
      }
      if (currentMarker) {
        layer.removeLayer(currentMarker);
        group.forEach((item) => labelByIdRef.current.delete(item.id));
      }
      let marker: L.Marker | L.CircleMarker;
      if (mobile && !permanentLabel && canvasRendererRef.current) {
        marker = L.circleMarker(displayPosition, {
          renderer: canvasRendererRef.current,
          radius: group.length > 1 ? 8 : 6,
          color: "#ffffff",
          fillColor: meta.color,
          fillOpacity: 1,
          weight: 2,
        }).addTo(layer);
      } else {
        const icon = L.divIcon({
          className: "workin-map-marker",
          html: `<span style="position:relative;display:block;width:21px;height:21px;background:${meta.color};border:3px solid white;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 8px rgba(15,23,42,.35)">${group.length > 1 ? `<b style="position:absolute;right:-12px;top:-12px;display:flex;width:18px;height:18px;align-items:center;justify-content:center;border-radius:9px;background:#0f172a;color:white;font:700 10px sans-serif;transform:rotate(45deg)">${group.length}</b>` : ""}</span>`,
          iconSize: [28, 28],
          iconAnchor: [14, 27],
        });
        marker = L.marker(displayPosition, { icon }).addTo(layer);
      }
      let tooltip: HTMLDivElement | null = null;
      if (permanentLabel) {
        tooltip = document.createElement("div");
        tooltip.className = "cursor-pointer whitespace-nowrap text-[11px] font-bold";
        tooltip.textContent = groupLabel;
        tooltip.title = groupTitle;
        styleMapLabel(tooltip, groupSelected);
        tooltip.addEventListener("click", (event) => {
          event.stopPropagation();
          if (group.length === 1) onSelect(place.id);
          else marker.openPopup();
        });
        marker.bindTooltip(tooltip, { permanent: true, direction: "top", offset: [0, -22], opacity: 0.92, interactive: true });
      }
      if (group.length === 1) marker.on("click", () => onSelect(place.id));
      else {
        const popup = document.createElement("div");
        popup.className = "min-w-[220px] max-w-[280px] space-y-1";
        const heading = document.createElement("div");
        heading.className = "border-b border-slate-200 px-2 pb-2 text-xs font-black text-slate-500";
        heading.textContent = `같은 주소 · ${group.length}곳`;
        popup.appendChild(heading);
        group.forEach((item) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "block w-full rounded px-2 py-2 text-left text-xs font-bold hover:bg-slate-100";
          button.textContent = item.name;
          button.addEventListener("click", () => { onSelect(item.id); marker.closePopup(); });
          popup.appendChild(button);
        });
        marker.bindPopup(popup, { closeButton: true, maxHeight: 260 });
        marker.on("click", () => marker.openPopup());
      }
      markerByIdRef.current.set(place.id, marker);
      markerSignatureRef.current.set(place.id, signature);
      if (tooltip) group.forEach((item) => labelByIdRef.current.set(item.id, tooltip));
    });
  }, [places, onSelect, selectedId, viewportRevision]);

  useEffect(() => {
    new Set(labelByIdRef.current.values()).forEach((element) => styleMapLabel(element, false));
    if (selectedId !== null) {
      const selectedLabel = labelByIdRef.current.get(selectedId);
      if (selectedLabel) styleMapLabel(selectedLabel, true);
    }
    const map = mapRef.current;
    const place = selectedId === null ? null : places.find((item) => item.id === selectedId);
    if (map && place) map.panTo([place.latitude, place.longitude], { animate: true, duration: 0.25 });
  }, [selectedId, places]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = locationLayerRef.current;
    if (!map || !layer || !currentPosition) return;
    const point: L.LatLngExpression = [currentPosition.latitude, currentPosition.longitude];
    layer.clearLayers();
    L.circle(point, {
      radius: Math.max(15, currentPosition.accuracy),
      color: "#2563eb",
      fillColor: "#60a5fa",
      fillOpacity: 0.14,
      weight: 1,
      interactive: false,
    }).addTo(layer);
    L.circleMarker(point, {
      radius: 7,
      color: "#ffffff",
      fillColor: "#2563eb",
      fillOpacity: 1,
      weight: 3,
      interactive: false,
    }).addTo(layer);
    map.panTo(point, { animate: true, duration: 0.25 });
  }, [currentPosition]);

  return (
    <div className="relative h-full min-h-[500px] w-full bg-[#dce8ef]">
      <div ref={elementRef} className="h-full w-full" aria-label="전국 거래처 지도" />
      {!tilesReady && <div className="pointer-events-none absolute inset-0 z-[800] flex items-center justify-center bg-slate-100/75 text-sm font-black text-slate-500">지도 불러오는 중</div>}
    </div>
  );
});

// ── 카카오맵 캔버스 — MapCanvas(Leaflet)와 같은 인터페이스·기능 ──────────────
// 뷰포트 가상화(화면 안 핀만 생성) / 같은 주소 그룹핑(숫자 뱃지+목록 팝업) /
// 같은 좌표 원형 분산 / 팀별 뷰 저장 / 선택 하이라이트·이동 / GPS 점 / 주소핀 다리
function kakaoViewKey(key: string, team: Team) { return `${key}_kakao_${team}`; }
function loadKakaoView(key: string, team: Team): { lat: number; lng: number; level: number } {
  try {
    const raw = JSON.parse(localStorage.getItem(kakaoViewKey(key, team)) || "null");
    if (raw && Number.isFinite(raw.lat)) return raw;
  } catch { /* 아래 변환 */ }
  const legacy = loadTeamMapView(key, team); // 기존 Leaflet 저장값을 카카오 레벨로 근사 변환
  return { lat: legacy.center[0], lng: legacy.center[1], level: Math.min(14, Math.max(1, 20 - legacy.zoom)) };
}

const MapCanvasKakao = memo(function MapCanvasKakao({ kakao, places, selectedId, team, viewStorageKey, onSelect, currentPosition }: { kakao: KakaoNS; places: MapPlace[]; selectedId: number | null; team: Team; viewStorageKey: string; onSelect: (id: number) => void; currentPosition: CurrentPosition | null }) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KakaoNS | null>(null);
  const overlaysRef = useRef(new Map<number, KakaoNS>());     // placeId → 핀 CustomOverlay
  const signaturesRef = useRef(new Map<number, string>());
  const labelByIdRef = useRef(new Map<number, HTMLDivElement>());
  const popupRef = useRef<KakaoNS | null>(null);              // 열려 있는 그룹 팝업
  const gpsRef = useRef<KakaoNS[]>([]);
  const addressPinRef = useRef<KakaoNS | null>(null);
  const [ready, setReady] = useState(false);
  const [viewportRevision, setViewportRevision] = useState(0);

  useEffect(() => {
    if (!elementRef.current || mapRef.current) return;
    const view = loadKakaoView(viewStorageKey, team);
    const map = new kakao.maps.Map(elementRef.current, { center: new kakao.maps.LatLng(view.lat, view.lng), level: view.level });
    mapRef.current = map;
    kakao.maps.event.addListener(map, "tilesloaded", () => setReady(true));
    // 그룹 팝업은 지도 아무 데나 누르면 닫힌다 (✕만 고집하지 않게)
    kakao.maps.event.addListener(map, "click", () => { if (popupRef.current) { popupRef.current.setMap(null); popupRef.current = null; } });
    window.setTimeout(() => setReady(true), 2500); // 이벤트가 안 와도 로딩막은 걷는다
    // 주소 검색 다리
    addressClearBridge = () => { if (addressPinRef.current) { addressPinRef.current.setMap(null); addressPinRef.current = null; } };
    addressFlyBridge = (lat, lng, label, sub) => {
      if (addressPinRef.current) { addressPinRef.current.setMap(null); addressPinRef.current = null; }
      const el = document.createElement("div");
      el.style.cssText = "transform:translateY(-6px);text-align:center";
      el.innerHTML = `<div style="font-size:30px;line-height:30px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))">📍</div><div style="margin-top:2px;background:#fff;border:1px solid #cbd5e1;border-radius:8px;padding:3px 7px;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.15)">${label}<br/><span style="color:#64748b;font-weight:500">${sub}</span></div>`;
      const overlay = new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(lat, lng), content: el, yAnchor: 0.4, zIndex: 500 });
      overlay.setMap(map);
      addressPinRef.current = overlay;
      if (map.getLevel() > 4) map.setLevel(4);
      map.panTo(new kakao.maps.LatLng(lat, lng));
    };
    const observer = new ResizeObserver(() => map.relayout());
    observer.observe(elementRef.current);
    return () => {
      observer.disconnect();
      addressFlyBridge = null;
      addressClearBridge = null;
      overlaysRef.current.forEach((o) => o.setMap(null));
      overlaysRef.current.clear();
      signaturesRef.current.clear();
      labelByIdRef.current.clear();
      if (popupRef.current) popupRef.current.setMap(null);
      gpsRef.current.forEach((o) => o.setMap(null));
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 팀 전환·이동 시 뷰 저장 + 가시 마커 재계산
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const view = loadKakaoView(viewStorageKey, team);
    map.setCenter(new kakao.maps.LatLng(view.lat, view.lng));
    map.setLevel(view.level);
    let timer = 0;
    const persist = () => {
      const c = map.getCenter();
      try { localStorage.setItem(kakaoViewKey(viewStorageKey, team), JSON.stringify({ lat: c.getLat(), lng: c.getLng(), level: map.getLevel() })); } catch { /* 무시 */ }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setViewportRevision((cur) => cur + 1), 160);
    };
    kakao.maps.event.addListener(map, "idle", persist);
    return () => { window.clearTimeout(timer); kakao.maps.event.removeListener(map, "idle", persist); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team, viewStorageKey]);

  // 핀 렌더 — 화면(+여유) 안만 생성, 시그니처 같으면 재사용
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const mobile = window.matchMedia("(max-width: 1023px)").matches;
    const bounds = map.getBounds();
    const sw = bounds.getSouthWest(), ne = bounds.getNorthEast();
    const latPad = (ne.getLat() - sw.getLat()) * 0.12, lngPad = (ne.getLng() - sw.getLng()) * 0.12;
    const contains = (lat: number, lng: number) =>
      lat >= sw.getLat() - latPad && lat <= ne.getLat() + latPad && lng >= sw.getLng() - lngPad && lng <= ne.getLng() + lngPad;
    const visiblePlaces = places.filter((place) => Number.isFinite(place.latitude) && Number.isFinite(place.longitude) && contains(place.latitude, place.longitude));
    const groupedPlaces = Array.from(visiblePlaces.reduce((groups, place) => {
      const key = addressGroupKey(place);
      groups.set(key, [...(groups.get(key) || []), place]);
      return groups;
    }, new Map<string, MapPlace[]>()).values());
    const visibleIds = new Set(groupedPlaces.map((group) => group[0].id));
    const visiblePlaceIds = new Set(visiblePlaces.map((place) => place.id));
    overlaysRef.current.forEach((overlay, id) => {
      if (visibleIds.has(id)) return;
      overlay.setMap(null);
      overlaysRef.current.delete(id);
      signaturesRef.current.delete(id);
    });
    labelByIdRef.current.forEach((_, id) => { if (!visiblePlaceIds.has(id)) labelByIdRef.current.delete(id); });

    const projection = map.getProjection();
    const counts = new Map<string, number>();
    groupedPlaces.forEach(([place]) => {
      const key = `${place.latitude.toFixed(6)},${place.longitude.toFixed(6)}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const indexes = new Map<string, number>();
    groupedPlaces.forEach((group) => {
      const place = group[0];
      const coordKey = `${place.latitude.toFixed(6)},${place.longitude.toFixed(6)}`;
      const dupIndex = indexes.get(coordKey) || 0;
      indexes.set(coordKey, dupIndex + 1);
      const dupCount = counts.get(coordKey) || 1;
      const spreadIndex = Math.max(0, dupIndex - 1);
      const ring = Math.floor(spreadIndex / 8) + 1;
      const angle = ((spreadIndex % 8) / 8) * Math.PI * 2;
      let displayPos = new kakao.maps.LatLng(place.latitude, place.longitude);
      if (dupCount > 1 && dupIndex > 0) {
        const pt = projection.containerPointFromCoords(displayPos);
        displayPos = projection.coordsFromContainerPoint(new kakao.maps.Point(pt.x + Math.cos(angle) * 38 * ring, pt.y + Math.sin(angle) * 38 * ring));
      }
      const meta = labelMeta(place.label);
      const groupLabel = group.length > 1 ? `${compactMapName(place.name, 12)} 외 ${group.length - 1}곳` : compactMapName(place.name);
      const groupSelected = group.some((item) => item.id === selectedId);
      const permanentLabel = !mobile || map.getLevel() <= 5 || groupSelected;
      const signature = [displayPos.getLat().toFixed(7), displayPos.getLng().toFixed(7), meta.color, groupLabel, permanentLabel ? "label" : "dot", group.map((item) => `${item.id}:${item.name}`).join(",")].join("|");
      if (overlaysRef.current.has(place.id) && signaturesRef.current.get(place.id) === signature) {
        const currentLabel = labelByIdRef.current.get(place.id);
        if (currentLabel) styleMapLabel(currentLabel, groupSelected);
        return;
      }
      const existing = overlaysRef.current.get(place.id);
      if (existing) { existing.setMap(null); group.forEach((item) => labelByIdRef.current.delete(item.id)); }

      const container = document.createElement("div");
      container.style.cssText = "position:relative;cursor:pointer;display:flex;flex-direction:column;align-items:center";
      const openGroupPopup = () => {
        if (popupRef.current) { popupRef.current.setMap(null); popupRef.current = null; }
        const popup = document.createElement("div");
        popup.className = "min-w-[220px] max-w-[280px] space-y-1 rounded-xl border border-slate-200 bg-white p-2 shadow-xl";
        const heading = document.createElement("div");
        heading.className = "flex items-center justify-between border-b border-slate-200 px-2 pb-2 text-xs font-black text-slate-500";
        heading.innerHTML = `<span>같은 주소 · ${group.length}곳</span>`;
        const close = document.createElement("button");
        close.type = "button"; close.textContent = "✕"; close.className = "px-1 text-slate-400";
        close.addEventListener("click", () => { popupRef.current?.setMap(null); popupRef.current = null; });
        heading.appendChild(close);
        popup.appendChild(heading);
        const list = document.createElement("div");
        list.style.cssText = "max-height:240px;overflow-y:auto";
        group.forEach((item) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "block w-full rounded px-2 py-2 text-left text-xs font-bold hover:bg-slate-100";
          button.textContent = item.name;
          button.addEventListener("click", () => { onSelect(item.id); popupRef.current?.setMap(null); popupRef.current = null; });
          list.appendChild(button);
        });
        popup.appendChild(list);
        const overlay = new kakao.maps.CustomOverlay({ position: displayPos, content: popup, yAnchor: 1.15, zIndex: 600 });
        overlay.setMap(map);
        popupRef.current = overlay;
      };
      const handleClick = () => { if (group.length === 1) onSelect(place.id); else openGroupPopup(); };

      if (permanentLabel) {
        const tooltip = document.createElement("div");
        tooltip.className = "cursor-pointer whitespace-nowrap text-[11px] font-bold";
        tooltip.textContent = groupLabel;
        tooltip.title = group.map((item) => item.name).join("\n");
        // 지도 위 글자와 섞이지 않게 흰 말풍선 배경 (리플릿 tooltip CSS 대응)
        tooltip.style.cssText = "display:inline-block;background:rgba(255,255,255,.94);border:1px solid rgba(100,116,139,.45);border-radius:5px;padding:2px 6px;margin-bottom:3px;box-shadow:0 1px 5px rgba(15,23,42,.22);color:#0f172a";
        styleMapLabel(tooltip, groupSelected);
        tooltip.addEventListener("click", (event) => { event.stopPropagation(); handleClick(); });
        container.appendChild(tooltip);
      }
      const pin = document.createElement("div");
      pin.style.cssText = "display:inline-block";
      pin.innerHTML = permanentLabel
        ? `<span style="position:relative;display:block;width:21px;height:21px;margin:0 auto;background:${meta.color};border:3px solid white;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 8px rgba(15,23,42,.35)">${group.length > 1 ? `<b style=\"position:absolute;right:-12px;top:-12px;display:flex;width:18px;height:18px;align-items:center;justify-content:center;border-radius:9px;background:#0f172a;color:white;font:700 10px sans-serif;transform:rotate(45deg)\">${group.length}</b>` : ""}</span>`
        : `<span style="display:block;width:${group.length > 1 ? 16 : 12}px;height:${group.length > 1 ? 16 : 12}px;background:${meta.color};border:2px solid #fff;border-radius:50%;box-shadow:0 1px 4px rgba(15,23,42,.4)"></span>`;
      pin.addEventListener("click", (event) => { event.stopPropagation(); handleClick(); });
      container.appendChild(pin);

      const overlay = new kakao.maps.CustomOverlay({ position: displayPos, content: container, yAnchor: permanentLabel ? 0.95 : 0.5, zIndex: groupSelected ? 200 : 100 });
      overlay.setMap(map);
      overlaysRef.current.set(place.id, overlay);
      signaturesRef.current.set(place.id, signature);
      if (permanentLabel) group.forEach((item) => labelByIdRef.current.set(item.id, container.firstChild as HTMLDivElement));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, onSelect, selectedId, viewportRevision]);

  // 선택 변경: 라벨 하이라이트 + 지도 이동
  useEffect(() => {
    new Set(labelByIdRef.current.values()).forEach((element) => styleMapLabel(element, false));
    if (selectedId !== null) {
      const selectedLabel = labelByIdRef.current.get(selectedId);
      if (selectedLabel) styleMapLabel(selectedLabel, true);
    }
    const map = mapRef.current;
    const place = selectedId === null ? null : places.find((item) => item.id === selectedId);
    if (map && place && Number.isFinite(place.latitude)) map.panTo(new kakao.maps.LatLng(place.latitude, place.longitude));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, places]);

  // 현재 위치(GPS)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !currentPosition) return;
    gpsRef.current.forEach((o) => o.setMap(null));
    gpsRef.current = [];
    const pos = new kakao.maps.LatLng(currentPosition.latitude, currentPosition.longitude);
    const circle = new kakao.maps.Circle({ center: pos, radius: Math.max(15, currentPosition.accuracy), strokeWeight: 1, strokeColor: "#2563eb", strokeOpacity: 0.7, fillColor: "#60a5fa", fillOpacity: 0.14 });
    circle.setMap(map);
    const dot = document.createElement("div");
    dot.style.cssText = "width:14px;height:14px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.35)";
    const dotOverlay = new kakao.maps.CustomOverlay({ position: pos, content: dot, yAnchor: 0.5, zIndex: 400 });
    dotOverlay.setMap(map);
    gpsRef.current = [circle, dotOverlay];
    map.panTo(pos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPosition]);

  return (
    <div className="relative h-full min-h-[500px] w-full bg-[#eef3f6]">
      <div ref={elementRef} className="h-full w-full" aria-label="전국 거래처 지도 (카카오)" />
      {!ready && <div className="pointer-events-none absolute inset-0 z-[800] flex items-center justify-center bg-slate-100/75 text-sm font-black text-slate-500">지도 불러오는 중</div>}
    </div>
  );
});

export default function WalkingMap({ userKey = "guest", onSelfRequest }: { userKey?: string; onSelfRequest?: (text: string) => void }) {
  const initialLocalPlacesRef = useRef<MapPlace[] | null>(loadMigratablePlaces());
  const [places, setPlaces] = useState<MapPlace[]>(() => initialLocalPlacesRef.current || loadPlaces());
  const [sharedReady, setSharedReady] = useState(false);
  const [syncState, setSyncState] = useState<"loading" | "saved" | "error">("loading");
  const [query, setQuery] = useState("");
  // 지도 엔진: 카카오 SDK가 열리면 카카오, 아니면 기존 Leaflet (도메인 미등록 미리보기 등)
  const [kakaoNs, setKakaoNs] = useState<KakaoNS | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  useEffect(() => {
    void loadKakaoMaps().then((ns) => { setKakaoNs(ns); setEngineReady(true); });
  }, []);
  // 주소 지오코딩(OSM) — 분기점검에 없는 AS 방문지도 주소만 치면 지도에서 위치 확인
  const [geocoding, setGeocoding] = useState(false);
  const [addressPinLabel, setAddressPinLabel] = useState("");
  const locateAddress = async (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    setGeocoding(true);
    try {
      const hit = await geocodeKR(q); // 띄어쓰기 변형("삼성로 100길8" 등)을 알아서 흡수
      if (!hit) { notify(`"${q}" 주소를 찾지 못했어요 — 도로명 주소로 다시 시도해 보세요.`, "error"); return; }
      if (addressFlyBridge) {
        addressFlyBridge(hit.lat, hit.lng, q, hit.label);
        setAddressPinLabel(q);
        setQuery(""); // 검색어를 비워야 업체 리스트가 다시 보인다 (핀은 유지)
      } else notify("지도가 아직 준비되지 않았어요 — 잠시 후 다시 시도해 주세요.", "error");
    } catch (e) {
      notify(`주소 검색 실패: ${(e as Error).message}`, "error");
    } finally {
      setGeocoding(false);
    }
  };
  const [mapQuery, setMapQuery] = useState("");
  const [mapSearchFocused, setMapSearchFocused] = useState(false);
  const [currentPosition, setCurrentPosition] = useState<CurrentPosition | null>(null);
  const [locationTracking, setLocationTracking] = useState(false);
  const locationWatchRef = useRef<number | null>(null);
  const preferenceStorageKey = useMemo(() => `cs_workin_map_preferences_v1_${userKey.trim() || "guest"}`, [userKey]);
  const initialPreferences = useMemo(() => loadMapPreferences(preferenceStorageKey), [preferenceStorageKey]);
  const [labelFilters, setLabelFilters] = useState<string[]>(initialPreferences.labels);
  const [teamFilter, setTeamFilter] = useState<Team>(initialPreferences.team);
  const [quarterFilter, setQuarterFilter] = useState<Quarter>(initialPreferences.quarter);
  const [kindFilter, setKindFilter] = useState<WorkKind | "ALL">(initialPreferences.kind);
  const [renewalOrder, setRenewalOrder] = useState<"default" | "asc" | "desc">("default");
  const [renewalGradeFilter, setRenewalGradeFilter] = useState("ALL");
  const [quarterHasRenewal, setQuarterHasRenewal] = useState(false);
  const [quarterHasMisu, setQuarterHasMisu] = useState(false);
  const [quarterHasOverage, setQuarterHasOverage] = useState(false);
  const [quarterHasBulman, setQuarterHasBulman] = useState(false);
  const [quarterGrades, setQuarterGrades] = useState<string[]>([]);
  const [monthlyOrder, setMonthlyOrder] = useState<"default" | "closing">("default");
  const [inspectionVisits, setInspectionVisits] = useState<VisitRow[]>([]);
  const [archiveVisits, setArchiveVisits] = useState<Array<VisitLike & { idKeys: string[] }>>([]);
  const [misuByVendor, setMisuByVendor] = useState<Map<string, { months: string; balance: string; date: string }>>(new Map());
  // 워킨맵 이름에는 층·백업/합산 같은 꼬리표가 붙어 시트 업체명과 키가 안 맞는 경우가 있다
  // ("31V(주)잡플러스4층백업/합산…" vs "(주)잡플러스"). 키를 앞에서부터 줄여가며 접두 일치로 찾는다.
  const lookupVendor = useCallback(<T,>(map: Map<string, T>, name: string): T | undefined => {
    const key = vendorMatchKey(name);
    const exact = map.get(key);
    if (exact !== undefined) return exact;
    for (let len = key.length - 1; len >= 4; len--) {
      const hit = map.get(key.slice(0, len));
      if (hit !== undefined) return hit;
    }
    return undefined;
  }, []);
  // 초과료: 초과시트(overage) 거래처별 최신 1건 — 점검 동선에 초과조정을 얹을지 판단용
  const [overageByVendor, setOverageByVendor] = useState<Map<string, { total: string; date: string; grade: string }>>(new Map());
  // 불만: 최근 90일 접수분 거래처별 최신 1건 — 방문 전 대응 준비용
  const [bulmanByVendor, setBulmanByVendor] = useState<Map<string, { date: string; content: string }>>(new Map());
  // 뱃지 클릭 → 최근 이력 팝업 (미수·초과·불만)
  const [flagHistory, setFlagHistory] = useState<{ vendor: string; kind: "미수" | "초과" | "불만"; records: Array<Record<string, unknown>>; loading: boolean } | null>(null);
  const [flagDetail, setFlagDetail] = useState<{ record: Record<string, unknown>; kind: "미수" | "초과" | "불만" } | null>(null);
  const openFlagHistory = (vendor: string, kind: "미수" | "초과" | "불만") => {
    setFlagHistory({ vendor, kind, records: [], loading: true });
    const table = kind === "미수" ? "misu" : kind === "초과" ? "overage" : "bulman";
    // 워킨맵 이름의 접두 숫자·등급·법인·꼬리표를 뗀 핵심 토큰 — 짧게 잘라가며 재시도
    const core = vendor
      .replace(/^(?:\d{4}\/)?\d+(?:SS|NN|S|N|V)?[A-Z]?(?=[가-힣㈜(])/i, "")
      .replace(/주식회사|유한회사|재단법인|사단법인|농업회사법인|㈜|\(주\)/g, "").trim()
      .match(/[가-힣a-zA-Z0-9]+/)?.[0] || vendor;
    const key = vendorMatchKey(vendor);
    // 미수·초과는 시트 기준(_출처 시트), 불만은 카톡·시트·웹앱 전부
    const sourceFilter = kind === "미수" ? `&${encodeURIComponent("_출처")}=like.${encodeURIComponent("시트")}*` : "";
    void (async () => {
      let hits: Array<Record<string, unknown>> = [];
      for (const len of [8, 5, 3]) {
        const probe = core.slice(0, len);
        if (probe.length < 2) break;
        const rows = await selectRows<Record<string, unknown>>(table, `select=*&${encodeURIComponent("_업체명")}=ilike.*${encodeURIComponent(probe)}*${sourceFilter}&order=id.desc&limit=40`).catch(() => [] as Array<Record<string, unknown>>);
        hits = rows.filter((r) => {
          const rk = vendorMatchKey(String(r["_업체명"] || ""));
          return rk && (rk === key || key.startsWith(rk) || rk.startsWith(key));
        });
        if (hits.length) break;
      }
      setFlagHistory((cur) => (cur && cur.vendor === vendor && cur.kind === kind ? { ...cur, records: hits.slice(0, 3), loading: false } : cur));
    })();
  };
  const [misuFailed, setMisuFailed] = useState(false);
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const [conditionMenuOpen, setConditionMenuOpen] = useState(false);
  const [progressMenuOpen, setProgressMenuOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysisTeamsOpen, setAnalysisTeamsOpen] = useState<Record<string, boolean>>({});
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [mobileView, setMobileView] = useState<"map" | "list">("map");
  const [mobileDetailId, setMobileDetailId] = useState<number | null>(null);
  const [comparePopupId, setComparePopupId] = useState<number | null>(null); // 최근 점검 비교 팝업
  const [deviceHistoryCache, setDeviceHistoryCache] = useState<Record<number, VisitLike[]>>({});
  const [mapSelectionRevision, setMapSelectionRevision] = useState(0);
  const [desktopLayout, setDesktopLayout] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  const [editMode, setEditMode] = useState(false);
  const [checkedIds, setCheckedIds] = useState<number[]>([]);
  const [draft, setDraft] = useState<MapPlace | null>(null);
  const [pendingImport, setPendingImport] = useState<MapPlace[]>([]);
  const [importTeam, setImportTeam] = useState<Team>("C");
  const [importQuarter, setImportQuarter] = useState<Quarter>(3);
  const [importKind, setImportKind] = useState<WorkKind>("monthly");
  const [importMode, setImportMode] = useState<"append" | "replace">("replace");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectionSourceRef = useRef<"map" | "list" | "reveal" | "other">("other");

  const stopLocationTracking = useCallback(() => {
    if (locationWatchRef.current !== null) navigator.geolocation.clearWatch(locationWatchRef.current);
    locationWatchRef.current = null;
    setLocationTracking(false);
  }, []);

  const toggleLocationTracking = useCallback(() => {
    if (locationTracking) {
      stopLocationTracking();
      return;
    }
    if (!navigator.geolocation) {
      notify("이 기기에서는 현재 위치를 사용할 수 없습니다.", "error");
      return;
    }
    setLocationTracking(true);
    locationWatchRef.current = navigator.geolocation.watchPosition(
      (position) => setCurrentPosition((current) => {
        const now = Date.now();
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        const barelyMoved = current
          && Math.abs(current.latitude - latitude) < 0.00005
          && Math.abs(current.longitude - longitude) < 0.00005
          && now - current.revision < 10_000;
        return barelyMoved ? current : { latitude, longitude, accuracy: position.coords.accuracy, revision: now };
      }),
      (error) => {
        stopLocationTracking();
        const message = error.code === error.PERMISSION_DENIED
          ? "현재 위치 권한을 허용해 주세요."
          : "현재 위치를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
        notify(message, "info");
      },
      { enableHighAccuracy: false, maximumAge: 15_000, timeout: 12_000 },
    );
  }, [locationTracking, stopLocationTracking]);

  useEffect(() => () => {
    if (locationWatchRef.current !== null) navigator.geolocation.clearWatch(locationWatchRef.current);
  }, []);

  const loadSharedPlaces = useCallback(async () => {
    const remote = await selectAllRowsFast<DbMapPlace>("workin_map_places", "select=*&order=id.asc");
    const next = remote.map(fromDbPlace);
    setPlaces((current) => samePlaces(current, next) ? current : next);
    setSyncState("saved");
    return remote;
  }, []);

  const selectMapPlace = useCallback((id: number) => {
    selectionSourceRef.current = "map";
    setSelectedId(id);
    setExpandedId(null);
    setMapSelectionRevision((current) => current + 1);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktopLayout(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (mobileDetailId === null) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileDetailId(null); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileDetailId]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(places));
  }, [places]);

  const loadInspectionVisits = useCallback(() => {
    const startDate = dateDaysAgo(370);
    // 과거 visit_logs에 원문이 없는 기록만 보완한다. 목록 전체를 빠르게
    // 받을 수 있도록 큰 _원문 대신 비교에 필요한 열만 조회한다.
    // _기번목록(전 기기 기번 배열)은 jeomgeom-serial-index.sql 실행 후 생기므로 실패 시 없이 재시도.
    const baseCols = "작성일,_업체명,업체명,모델명,시리얼넘버,자산기번,매수,토너잔량,폐통,여분";
    const archiveDate = encodeURIComponent("작성일");
    const fetchArchive = async () => {
      try {
        return await selectAllRowsFast<InspectionArchiveRow>("jeomgeom", `select=${encodeURIComponent(`${baseCols},_기번목록`)}&${archiveDate}=gte.${startDate}&order=${archiveDate}.desc,id.desc`);
      } catch {
        return selectAllRowsFast<InspectionArchiveRow>("jeomgeom", `select=${encodeURIComponent(baseCols)}&${archiveDate}=gte.${startDate}&order=${archiveDate}.desc,id.desc`);
      }
    };
    void Promise.all([
      getTeamVisits(startDate, kstDate()),
      fetchArchive(),
    ])
      .then(([rows, archiveRows]) => {
        const archiveByDate = new Map<string, InspectionArchiveRow[]>();
        archiveRows.forEach((row) => {
          const date = String(row["작성일"] || "").slice(0, 10);
          const list = archiveByDate.get(date) || [];
          list.push(row);
          archiveByDate.set(date, list);
        });
        const inspections = rows.filter((row) => row.visited && row.workKinds.includes("inspection")).map((visit) => {
          if (visit.sourceText.trim()) return visit;
          const visitKey = vendorMatchKey(visit.vendor);
          const candidates = archiveByDate.get(visit.workDate) || [];
          const archive = candidates.find((row) => {
            const archiveKey = vendorMatchKey(String(row["_업체명"] || row["업체명"] || ""));
            return archiveKey === visitKey || (archiveKey.length >= 5 && visitKey.length >= 5 && (archiveKey.includes(visitKey) || visitKey.includes(archiveKey)));
          });
          return archive ? { ...visit, sourceText: archiveText(archive) } : visit;
        });
        setInspectionVisits(inspections);
        setDeviceHistoryCache({}); // 새 데이터 기준으로 펼침 이력 다시 조회(오늘 점검분이 캐시에 가려지지 않게)
        // 원본(jeomgeom) 행도 매칭 풀로 보관 — 방문기록이 없어도 업체명/기번으로 이력을 찾을 수 있게.
        // _기번목록엔 그 방문 양식의 모든 기기 기번이 들어 있어 이름이 달라도 기기로 매칭된다.
        setArchiveVisits(archiveRows.map((row) => {
          const listed = Array.isArray(row["_기번목록"]) ? (row["_기번목록"] as unknown[]).map((v) => String(v)) : [];
          const idKeys = Array.from(new Set(
            [...listed, String(row["시리얼넘버"] || ""), String(row["자산기번"] || "")]
              .map(normalizeIdKey)
              .filter((key) => key.length >= 4),
          ));
          return {
            workDate: String(row["작성일"] || "").slice(0, 10),
            vendor: String(row["_업체명"] || row["업체명"] || "").trim(),
            sourceText: archiveText(row),
            note: "",
            idKeys,
          };
        }).filter((row) => row.workDate && (row.vendor || row.idKeys.length)));
      })
      .catch((error) => console.error("Workin map visit history load failed", error));
  }, []);

  // 현재 미수: 미수팀 시트(_출처가 "시트:...")만 사용(카톡은 과거 이력이라 제외). 거래처별 최신 1건.
  const loadMisu = useCallback(() => {
    const select = encodeURIComponent("_업체명,미수개월,미수잔액,실제 잔액,실제 개월수,입력일,_출처");
    const sourceCol = encodeURIComponent("_출처");
    void selectAllRows<Record<string, unknown>>("misu", `select=${select}&${sourceCol}=like.${encodeURIComponent("시트")}*&order=id.asc`)
      .then((rows) => {
        const map = new Map<string, { months: string; balance: string; date: string }>();
        for (const row of rows) {
          const key = vendorMatchKey(String(row["_업체명"] || ""));
          if (!key) continue;
          // 팀마다 컬럼이 달라 미수잔액 → '실제 잔액' 순으로 읽는다 (B팀 시트는 실제 잔액만 있음)
          const balanceText = String(row["미수잔액"] || "").trim() || String(row["실제 잔액"] || "").trim();
          const monthsText = String(row["미수개월"] || "").trim() || String(row["실제 개월수"] || "").trim();
          const digits = balanceText.replace(/[^\d]/g, "");
          if (!digits || Number(digits) === 0) continue; // 잔액 0 = 해소된 건, 현재 미수 아님
          const date = normMisuDate(String(row["입력일"] || ""));
          const prev = map.get(key);
          if (!prev || date > prev.date) map.set(key, { months: monthsText, balance: balanceText, date });
        }
        setMisuByVendor(map);
        setMisuFailed(false);
      })
      .catch((error) => { console.error("Misu load failed", error); setMisuFailed(true); }); // 실패를 "미수 없음"으로 오해하지 않게 표시
  }, []);

  // 초과료: 합계가 있는 행만, 거래처별 최신(날짜 기준). 미수와 같은 갱신 주기를 따른다.
  const loadOverage = useCallback(() => {
    const select = encodeURIComponent("_업체명,합계,날짜,등급");
    void selectAllRows<Record<string, unknown>>("overage", `select=${select}&order=id.asc`)
      .then((rows) => {
        const map = new Map<string, { total: string; date: string; grade: string }>();
        for (const row of rows) {
          const key = vendorMatchKey(String(row["_업체명"] || ""));
          if (!key) continue;
          const total = String(row["합계"] || "").trim();
          const digits = total.replace(/[^0-9]/g, "");
          if (!digits || Number(digits) === 0) continue; // 초과 0원은 표시 대상 아님
          const date = String(row["날짜"] || "").trim();
          const prev = map.get(key);
          if (!prev || date > prev.date) map.set(key, { total, date, grade: String(row["등급"] || "").trim() });
        }
        setOverageByVendor(map);
      })
      .catch((error) => console.error("Overage load failed", error));
  }, []);

  const loadBulman = useCallback(() => {
    const cutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const select = encodeURIComponent("_업체명,방문일,날짜,불만내용,불편내용");
    void selectRows<Record<string, unknown>>("bulman", `select=${select}&order=id.desc&limit=600`)
      .then((rows) => {
        const map = new Map<string, { date: string; content: string }>();
        for (const row of rows) {
          const key = vendorMatchKey(String(row["_업체명"] || ""));
          if (!key) continue;
          // 날짜 표기가 제각각("2025.12", "12/9")이라 yyyy-MM-dd로 정규화해 비교·표시한다
          const date = normMisuDate(String(row["방문일"] || row["날짜"] || ""));
          if (!date || date < cutoff) continue;
          const prev = map.get(key);
          if (!prev || date > prev.date) map.set(key, { date, content: String(row["불만내용"] || row["불편내용"] || "").slice(0, 60) });
        }
        setBulmanByVendor(map);
      })
      .catch((error) => console.error("Bulman load failed", error));
  }, []);

  useEffect(() => { loadInspectionVisits(); }, [loadInspectionVisits]);
  useEffect(() => { loadMisu(); }, [loadMisu]);
  useEffect(() => { loadOverage(); }, [loadOverage]);
  useEffect(() => { loadBulman(); }, [loadBulman]);

  // 점검 방문일·미수는 창 포커스/탭 복귀 시 최신으로 다시 불러온다(재계약/색칠처럼).
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== "hidden") { loadInspectionVisits(); loadMisu(); loadOverage(); loadBulman(); } };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [loadInspectionVisits, loadMisu]);

  useEffect(() => {
    let active = true;
    const initializeSharedPlaces = async () => {
      try {
        const remote = await selectAllRowsFast<DbMapPlace>("workin_map_places", "select=*&order=id.asc");
        if (!active) return;
        if (remote.length) {
          setPlaces(remote.map(fromDbPlace));
        } else {
          const local = initialLocalPlacesRef.current;
          if (local?.length) {
            for (let index = 0; index < local.length; index += 250) {
              await upsertRows("workin_map_places", local.slice(index, index + 250).map((place) => toDbPlace(place, userKey)), "id");
            }
          } else {
            setPlaces([]);
          }
        }
        if (active) {
          setSharedReady(true);
          setSyncState("saved");
        }
      } catch (error) {
        console.error("Workin map shared load failed", error);
        if (active) setSyncState("error");
      }
    };
    void initializeSharedPlaces();
    return () => { active = false; };
  }, [userKey]);

  useEffect(() => {
    if (!sharedReady) return;
    let active = true;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void loadSharedPlaces().catch((error) => {
        console.error("Workin map shared refresh failed", error);
        if (active) setSyncState("error");
      });
    };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [sharedReady, loadSharedPlaces]);

  useEffect(() => {
    localStorage.setItem(preferenceStorageKey, JSON.stringify({ team: teamFilter, quarter: quarterFilter, kind: kindFilter, labels: labelFilters } satisfies MapPreferences));
  }, [preferenceStorageKey, teamFilter, quarterFilter, kindFilter, labelFilters]);

  useEffect(() => {
    if (selectedId === null) return;
    const source = selectionSourceRef.current;
    const mobile = window.matchMedia("(max-width: 1023px)").matches;
    if (source === "list" || source === "other" || (mobile && source === "map")) return;
    if (mobile && mobileView !== "list") return;
    window.requestAnimationFrame(() => {
      document.querySelector(`[data-place-id="${selectedId}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [selectedId, mobileView, mapSelectionRevision]);

  const inspectionHistoryByPlace = useMemo(() => {
    // 방문기록(visit_logs) + 점검 원본(jeomgeom)을 한 풀로 합쳐 업체명으로 찾고,
    // 워킨맵 코멘트의 기번(시리얼/자산기번)으로도 찾는다 — 이름이 달라도 기기로 매칭.
    type PoolEntry = { visit: VisitLike; idKeys: string[] };
    const pool: Array<PoolEntry & { key: string }> = [
      ...inspectionVisits.map((visit) => ({ visit, key: vendorMatchKey(visit.vendor), idKeys: [] as string[] })),
      ...archiveVisits.map((visit) => ({ visit, key: vendorMatchKey(visit.vendor), idKeys: visit.idKeys })),
    ].filter((item) => item.key)
      .sort((left, right) => right.visit.workDate.localeCompare(left.visit.workDate));
    const byKey = new Map<string, PoolEntry[]>();
    for (const item of pool) {
      const list = byKey.get(item.key) || [];
      list.push({ visit: item.visit, idKeys: item.idKeys });
      byKey.set(item.key, list);
    }
    const keys = Array.from(byKey.keys());
    const serialIndex = new Map<string, VisitLike[]>();
    for (const row of archiveVisits) {
      for (const id of row.idKeys) {
        const list = serialIndex.get(id) || [];
        list.push(row);
        serialIndex.set(id, list);
      }
    }
    return new Map(places.map((place) => {
      const key = vendorMatchKey(place.name);
      const exact = byKey.get(key) || [];
      const entryPool = exact.length ? exact : key.length >= 5
        ? keys.filter((k) => k.length >= 5 && (k.includes(key) || key.includes(k))).flatMap((k) => byKey.get(k) || [])
        : [];
      const serialKey = normalizeIdKey(deviceSerial(place));
      // 방문일 판단용으로는 업체 매칭 전부 사용(원본은 첫 기기 열만 있어도 방문일은 맞다).
      // 기기별 정확한 표시는 카드 펼침 시 _원문을 즉석 조회해 해결한다(deviceHistoryCache).
      const nameMatches = entryPool.map((entry) => entry.visit);
      const serialMatches = serialKey.length >= 4 ? (serialIndex.get(serialKey) || []) : [];
      const seenDates = new Set<string>();
      const merged: VisitLike[] = [];
      for (const visit of [...serialMatches, ...nameMatches].sort((a, b) => b.workDate.localeCompare(a.workDate))) {
        if (seenDates.has(visit.workDate)) continue;
        seenDates.add(visit.workDate);
        merged.push(visit);
      }
      return [place.id, merged.slice(0, 2)];
    }));
  }, [inspectionVisits, archiveVisits, places]);

  const latestInspectionByPlace = useMemo(() => new Map(places.map((place) => [place.id, inspectionHistoryByPlace.get(place.id)?.[0]?.workDate || ""])), [inspectionHistoryByPlace, places]);

  // 분기점검 간략보기용: 같은 팀 기준 이번/전분기 재계약 워킨맵에 같은 거래처가 있는지와 계약종료월.
  // 재계약은 점검보다 한 달 앞서 진행돼 분기가 겹치므로, 이번 점검분기(예: 3Q=7,8,9월)에 계약이
  // 종료되는 건만 추린다. → 재계약 3Q(8,9,10) 중 8·9월 + 재계약 2Q(5,6,7) 중 7월이 걸린다.
  const renewalMatchByPlaceId = useMemo(() => {
    const prevQuarter = (quarterFilter === 1 ? 4 : quarterFilter - 1) as Quarter;
    const baseYear = new Date().getFullYear();
    const startMonth = (quarterFilter - 1) * 3;
    const inspectionMonths = [startMonth + 1, startMonth + 2, startMonth + 3];
    const byKey = new Map<string, { place: MapPlace; end: ReturnType<typeof contractEnd> }[]>();
    for (const place of places) {
      if (place.kind !== "renewal" || place.team !== teamFilter) continue;
      if (place.quarter !== quarterFilter && place.quarter !== prevQuarter) continue;
      const end = contractEnd(place, baseYear);
      if (end && !inspectionMonths.includes(end.month)) continue; // 종료월이 점검분기 밖이면 제외
      const key = vendorMatchKey(place.name);
      if (!key) continue;
      const list = byKey.get(key);
      if (list) list.push({ place, end }); else byKey.set(key, [{ place, end }]);
    }
    const result = new Map<number, { quarter: Quarter; isPrev: boolean; dueLabel: string; done: boolean }>();
    if (!byKey.size) return result;
    // 종료월은 이번 점검분기(같은 해)로 확정되므로 연도는 올해로 투영해 표시한다.
    // (자동연장 계약이라 데이터의 최초 종료연도(예: 21년)가 아니라 현재 주기 기준이 맞다.)
    const dueYear = String(baseYear).slice(2);
    for (const place of places) {
      if (place.kind !== "quarter" || place.team !== teamFilter) continue;
      const key = vendorMatchKey(place.name);
      const matches = key ? byKey.get(key) : undefined;
      if (!matches || !matches.length) continue;
      const best = [...matches].sort((a, b) => (a.end?.month || 99) - (b.end?.month || 99))[0];
      const isPrev = best.place.quarter === prevQuarter;
      const done = matches.every((match) => match.place.label === "G5");
      result.set(place.id, { quarter: isPrev ? prevQuarter : quarterFilter, isPrev, dueLabel: best.end ? `${dueYear}년 ${best.end.month}월` : "", done });
    }
    return result;
  }, [places, teamFilter, quarterFilter]);

  // 색상 메뉴에 표시할 G1~G12별 개수 — 라벨 필터 자신은 빼고 현재 팀·분기·업무 범위 기준
  const labelCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const place of places) {
      if (place.team !== teamFilter || place.quarter !== quarterFilter) continue;
      if (kindFilter !== "ALL" && place.kind !== kindFilter) continue;
      counts.set(place.label, (counts.get(place.label) || 0) + 1);
    }
    return counts;
  }, [places, teamFilter, quarterFilter, kindFilter]);

  const scopedPlaces = useMemo(() => {
    const rows = places.filter((place) => {
      if (labelFilters.length && !labelFilters.includes(place.label)) return false;
      if (place.team !== teamFilter) return false;
      if (place.quarter !== quarterFilter) return false;
      if (kindFilter !== "ALL" && place.kind !== kindFilter) return false;
      if (kindFilter === "renewal" && renewalGradeFilter !== "ALL" && renewalGrade(place) !== renewalGradeFilter) return false;
      // 분기점검 필터: 재계약 유무 / 미수 유무 / 등급(다중) — 모두 AND 조합.
      if (kindFilter === "quarter") {
        if (quarterHasRenewal && !renewalMatchByPlaceId.has(place.id)) return false;
        if (quarterHasMisu && lookupVendor(misuByVendor, place.name) === undefined) return false;
        if (quarterHasOverage && lookupVendor(overageByVendor, place.name) === undefined) return false;
        if (quarterHasBulman && lookupVendor(bulmanByVendor, place.name) === undefined) return false;
        if (quarterGrades.length && !quarterGrades.includes(renewalGrade(place))) return false;
      }
      return true;
    });
    if (kindFilter === "renewal" && renewalOrder !== "default") {
      const year = new Date().getFullYear();
      return [...rows].sort((left, right) => {
        const leftEnd = projectedContractEnd(left, year, quarterFilter)?.key;
        const rightEnd = projectedContractEnd(right, year, quarterFilter)?.key;
        if (leftEnd === undefined) return rightEnd === undefined ? 0 : 1;
        if (rightEnd === undefined) return -1;
        return renewalOrder === "asc" ? leftEnd - rightEnd : rightEnd - leftEnd;
      });
    }
    // 매월점검 마감일순: 이름 맨 앞 숫자(마감일 1~31) 오름차순. 마감일 없으면 뒤로.
    if (kindFilter === "monthly" && monthlyOrder === "closing") {
      return [...rows].sort((left, right) => {
        const leftDay = monthlyClosingDay(left.name);
        const rightDay = monthlyClosingDay(right.name);
        if (leftDay === null && rightDay === null) return 0;
        if (leftDay === null) return 1;
        if (rightDay === null) return -1;
        return leftDay - rightDay;
      });
    }
    return rows;
  }, [places, labelFilters, teamFilter, quarterFilter, kindFilter, renewalGradeFilter, renewalOrder, quarterHasRenewal, quarterHasMisu, quarterHasOverage, quarterHasBulman, quarterGrades, monthlyOrder, renewalMatchByPlaceId, misuByVendor, overageByVendor, bulmanByVendor, lookupVendor]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return scopedPlaces;
    return scopedPlaces.filter((place) => [place.name, place.comment, place.phone, place.address, place.addressDetail, ...place.memos]
      .some((value) => value.toLowerCase().includes(keyword)));
  }, [query, scopedPlaces]);

  const mapSearchResults = useMemo(() => {
    const keyword = mapQuery.trim().toLowerCase();
    if (!keyword) return [];
    return scopedPlaces.filter((place) => [place.name, place.comment, place.address, place.addressDetail]
      .some((value) => value.toLowerCase().includes(keyword))).slice(0, 8);
  }, [mapQuery, scopedPlaces]);


  const buildCompareData = useCallback((placeId: number | null) => {
    if (placeId === null) return null;
    const place = places.find((item) => item.id === placeId);
    if (!place) return null;
    const onDemand = deviceHistoryCache[place.id];
    const loading = place.kind === "quarter" && onDemand === undefined;
    const entries = onDemand !== undefined ? onDemand : (inspectionHistoryByPlace.get(place.id) || []);
    const snapshots = loading ? [] : entries.map((visit) => visitSnapshot(visit, place));
    const latestVisit = (inspectionHistoryByPlace.get(place.id) || [])[0] || null;
    return {
      place,
      snapshots,
      loading,
      latestVisit,
      vendor: latestVisit?.vendor || place.name,
      advice: place.label === "G7" || loading ? null : usageSpareAdvice(snapshots[0], snapshots[1], `${place.comment} ${place.name}`),
    };
  }, [inspectionHistoryByPlace, places, deviceHistoryCache]);
  const mobileDetail = useMemo(() => buildCompareData(mobileDetailId), [buildCompareData, mobileDetailId]);
  const comparePopup = useMemo(() => buildCompareData(comparePopupId), [buildCompareData, comparePopupId]);

  // 카드 펼침 시 그 업체의 전체 원문(_원문)을 즉석 조회해 "이 기기 블록이 포함된 방문"만 골라 캐시한다.
  // (이력 풀은 용량 때문에 _원문 없이 첫 기기 열만 갖고 있어 다기기 업체에서 타기기가 표시되는 문제 해결)
  useEffect(() => {
    const targetId = expandedId ?? mobileDetailId ?? comparePopupId;
    if (targetId === null || deviceHistoryCache[targetId] !== undefined) return;
    const place = places.find((item) => item.id === targetId);
    if (!place || place.kind !== "quarter") return;
    // 같은 자리라도 시기마다 업체명이 다를 수 있어(법인 변경 등) 매칭된 이름 변형 전부에서 찾는다.
    const vendors = Array.from(new Set((inspectionHistoryByPlace.get(targetId) || []).map((visit) => visit.vendor).filter(Boolean))).slice(0, 3);
    if (!vendors.length) { setDeviceHistoryCache((cache) => ({ ...cache, [targetId]: [] })); return; }
    const serialKey = normalizeIdKey(deviceSerial(place));
    const modelKey = normalizeIdKey(place.comment.split("/")[0] || "");
    let alive = true;
    void (async () => {
      try {
        const groups = await Promise.all(vendors.map((vendorName) => selectRows<Record<string, unknown>>(
          "jeomgeom",
          `select=${encodeURIComponent("작성일,_업체명,_원문")}&${encodeURIComponent("_업체명")}=eq.${encodeURIComponent(vendorName)}&order=${encodeURIComponent("작성일")}.desc&limit=10`,
        ).catch(() => [] as Record<string, unknown>[])));
        const rows = groups.flat().sort((a, b) => String(b["작성일"] || "").localeCompare(String(a["작성일"] || "")));
        // 이 기기의 블록을 찾는다: 기번 일치가 원칙. 기번이 모든 기록에 전혀 없을 때만(코멘트 오타 의심)
        // 모델명 폴백을 쓴다 — 같은 모델 다른 기기(교체 전 기기 등)를 잘못 끌어오지 않도록.
        const collect = (useModelFallback: boolean) => {
          const out: VisitLike[] = [];
          const seen = new Set<string>();
          for (const row of rows) {
            const text = String(row["_원문"] || "").trim();
            const date = String(row["작성일"] || "").slice(0, 10);
            if (!text || !date || seen.has(date)) continue;
            const blocks = splitDeviceBlocks(text);
            let block = serialKey.length >= 4 ? blocks.find((b) => normalizeIdKey(b).includes(serialKey)) : undefined;
            if (!block && useModelFallback && modelKey.length >= 3) block = blocks.find((b) => normalizeIdKey(b).includes(modelKey));
            if (!block && blocks.length === 1 && serialKey.length < 4) block = blocks[0];
            if (!block) continue;
            seen.add(date);
            out.push({ workDate: date, vendor: String(row["_업체명"] || "").trim(), sourceText: block, note: "" });
            if (out.length >= 2) break;
          }
          return out;
        };
        let out = collect(false);
        if (!out.length) out = collect(true);
        if (alive) setDeviceHistoryCache((cache) => ({ ...cache, [targetId]: out }));
      } catch {
        if (alive) setDeviceHistoryCache((cache) => ({ ...cache, [targetId]: [] }));
      }
    })();
    return () => { alive = false; };
  }, [expandedId, mobileDetailId, comparePopupId, places, inspectionHistoryByPlace, deviceHistoryCache]);

  // 자가신청 공용 핸들러: 다기기면 전체 원문(_원문)을 즉석 조회해 업체 전체 양식으로, 아니면 단일기기 양식으로.
  const requestSelfForm = async (place: MapPlace, latestVisit: VisitLike | null | undefined, snapshot: SelfRequestSnapshot | undefined, needsList: SpareNeed[], vendorName: string) => {
    if (!onSelfRequest) return;
    let multi: string | null = null;
    if (latestVisit) {
      let source = latestVisit.sourceText || "";
      if (splitDeviceBlocks(source).length < 2) {
        const full = await fetchFullFormText(latestVisit.vendor, latestVisit.workDate);
        if (full && splitDeviceBlocks(full).length >= 2) source = full;
      }
      multi = buildVendorSelfRequestText(userKey, { ...latestVisit, sourceText: source });
    }
    onSelfRequest(multi ?? buildSelfRequestText(userKey, vendorName, place, snapshot, needsList));
  };

  const mapPlaces = useMemo(() => scopedPlaces.filter((place) => place.visible), [scopedPlaces]);
  const progressQuarter = quarterFilter;
  const progressYear = new Date().getFullYear();
  const todayKst = kstDate();
  const progressDates = quarterDates(progressYear, progressQuarter);
  const progressStart = new Date() > progressDates.start ? new Date() : progressDates.start;
  const daysToQuarterEnd = businessDaysBetween(progressStart, progressDates.end);
  const daysToEarlyEnd = businessDaysBetween(progressStart, progressDates.earlyEnd);
  const conditionTitle = `${teamFilter}팀 · ${quarterFilter}분기 · ${kindFilter === "ALL" ? "전체 워킨맵" : workKinds.find((item) => item.value === kindFilter)?.label}`;
  const teamProgress = useMemo(() => teams.map((team) => {
    const rows = places.filter((place) => place.team === team && place.quarter === progressQuarter);
    const quarterlyInspections = rows.filter((place) => place.kind === "quarter");
    const monthlyInspections = rows.filter((place) => place.kind === "monthly");
    const renewals = rows.filter((place) => place.kind === "renewal");
    const managedRenewals = renewals.filter((place) => renewalGrade(place) !== "V");
    const renewalDates = managedRenewals.filter((place) => place.label !== "G5").map((place) => ({ place, grade: renewalGrade(place), end: projectedContractEnd(place, progressYear, progressQuarter) })).filter((item): item is { place: MapPlace; grade: string; end: NonNullable<ReturnType<typeof projectedContractEnd>> } => Boolean(item.end)).sort((a, b) => a.end.key - b.end.key);
    const renewalMonths = renewalQuarterMonths(progressQuarter).map((month) => [`${month}월`, renewalDates.filter((item) => item.end.month === month).length] as const);
    return {
      team,
      inspectionDone: quarterlyInspections.filter(isCompleted).length + monthlyInspections.reduce((sum, place) => sum + monthlyInspectionUnits(place), 0),
      inspectionTotal: quarterlyInspections.length + monthlyInspections.length * 3,
      renewalDone: managedRenewals.filter((place) => place.label === "G5").length,
      renewalTotal: managedRenewals.length,
      urgentRenewals: (["S", "SS"] as const).map((grade) => ({ grade, renewal: renewalDates.find((item) => item.grade === grade) || null })),
      renewalMonths,
    };
  }), [places, progressQuarter, progressYear]);

  // 팀별 주차 분석: 워킨맵 색칠(G5 완료) 기준. 완료일 메모로 주차별 신규 완료를 집계하고,
  // 완료일이 없는 기존 완료분은 "추적 전 완료" 베이스라인으로 잡아 누적%를 맞춘다.
  const weeklyAnalysis = useMemo(() => {
    const weeks = quarterWeeks(progressYear, progressQuarter);
    const dates = quarterDates(progressYear, progressQuarter);
    const totalBiz = businessDaysBetween(dates.start, dates.end) || 1;
    const now = new Date();
    const elapsedBiz = businessDaysBetween(dates.start, now < dates.end ? now : dates.end);
    const elapsedRatio = Math.min(1, Math.max(0, elapsedBiz / totalBiz));
    const weekIndex = (date: string) => weeks.findIndex((week) => date >= week.start && date <= week.end);
    const teamRows = teams.map((team) => {
      const scoped = places.filter((place) => place.team === team && place.quarter === progressQuarter);
      const quarterly = scoped.filter((place) => place.kind === "quarter");
      const monthly = scoped.filter((place) => place.kind === "monthly");
      const renewals = scoped.filter((place) => place.kind === "renewal" && renewalGrade(place) !== "V");
      // 매월점검은 3개월치라 total은 ×3, 완료는 라벨별 단위(G2×1·G3×2·G5×3)로 센다.
      const inspTotal = quarterly.length + monthly.length * 3;
      const renewTotal = renewals.length;
      const inspDone = quarterly.filter(isCompleted).length + monthly.reduce((sum, place) => sum + monthlyInspectionUnits(place), 0);
      const renewDone = renewals.filter((place) => place.label === "G5").length;
      const inspWeekly = weeks.map(() => 0);
      const renewWeekly = weeks.map(() => 0);
      let inspDated = 0;
      let renewDated = 0;
      for (const place of quarterly) {
        if (!isCompleted(place)) continue;
        const index = weekIndex(completionDate(place));
        if (index >= 0) { inspWeekly[index] += 1; inspDated += 1; }
      }
      for (const place of monthly) {
        const units = monthlyInspectionUnits(place);
        if (!units) continue;
        const index = weekIndex(completionDate(place)); // 완료일 메모는 G5/G12에만 남는다
        if (index >= 0) { inspWeekly[index] += units; inspDated += units; }
      }
      for (const place of renewals) {
        if (place.label !== "G5") continue;
        const index = weekIndex(completionDate(place));
        if (index >= 0) { renewWeekly[index] += 1; renewDated += 1; }
      }
      const doneRatio = inspTotal ? inspDone / inspTotal : 1;
      const gap = doneRatio - elapsedRatio;
      const pace = gap >= 0 ? "순조" : gap >= -0.1 ? "주의" : "스퍼트 필요";
      return { team, inspTotal, inspDone, renewTotal, renewDone, inspWeekly, renewWeekly, inspBaseline: inspDone - inspDated, renewBaseline: renewDone - renewDated, pace };
    });
    return { weeks, elapsedRatio, teams: teamRows, endDate: fmtDate(dates.end), earlyEndDate: fmtDate(dates.earlyEnd) };
  }, [places, progressQuarter, progressYear]);

  const allVisibleChecked = filtered.length > 0 && filtered.every((place) => checkedIds.includes(place.id));

  const saveDraft = () => {
    if (!draft || !draft.name.trim()) return;
    const previous = places.find((place) => place.id === draft.id);
    const savedDraft = withLabelHistory(draft, previous?.label);
    if (sharedReady) {
      setSyncState("loading");
      void upsertRows("workin_map_places", [toDbPlace(savedDraft, userKey)], "id")
        .then(() => setSyncState("saved"))
        .catch((error) => { console.error(error); setSyncState("error"); });
    }
    setPlaces((current) => current.some((place) => place.id === savedDraft.id)
      ? current.map((place) => place.id === savedDraft.id ? savedDraft : place)
      : [...current, savedDraft]);
    setSelectedId(savedDraft.id);
    setExpandedId(savedDraft.id);
    setDraft(null);
  };

  const deleteDraft = () => {
    if (!draft || !places.some((place) => place.id === draft.id)) return setDraft(null);
    if (!window.confirm("이 거래처를 워킨맵에서 삭제할까요?")) return;
    if (sharedReady) void deleteRows("workin_map_places", `id=eq.${draft.id}`).catch((error) => {
      console.error(error);
      setSyncState("error");
    });
    setPlaces((current) => current.filter((place) => place.id !== draft.id));
    setSelectedId(null);
    setExpandedId(null);
    setDraft(null);
  };

  const bulkSetLabel = (label: string) => {
    const changed = places
      .filter((place) => checkedIds.includes(place.id))
      .map((place) => withLabelHistory({ ...place, label }, place.label));
    if (sharedReady && changed.length) {
      setSyncState("loading");
      void upsertRows("workin_map_places", changed.map((place) => toDbPlace(place, userKey)), "id")
        .then(() => setSyncState("saved"))
        .catch((error) => { console.error(error); setSyncState("error"); });
    }
    const changedById = new Map(changed.map((place) => [place.id, place]));
    setPlaces((current) => current.map((place) => changedById.get(place.id) || place));
  };

  const toggleChecked = (id: number) => {
    setCheckedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const handleExcelImport = async (file: File) => {
    try {
      if (!file.name.toLowerCase().endsWith(".xlsx")) {
        notify(".xlsx 형식만 불러올 수 있습니다.", "info");
        return;
      }
      const ExcelJS = (await import("exceljs/dist/exceljs.min.js")).default;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        notify("엑셀 시트를 찾을 수 없습니다.", "error");
        return;
      }
      const headers = worksheet.getRow(1).values as Array<unknown>;
      const headerIndexes = new Map<string, number>();
      headers.forEach((header, index) => {
        const name = String(header || "").trim();
        if (name) headerIndexes.set(name, index);
      });
      const importedMemoCount = Math.max(defaultMemoColumnCount, ...Array.from(headerIndexes.keys()).map((header) => Number(header.match(/^메모(\d+)$/)?.[1] || 0)));
      const importedHeaders = [...excelBaseHeaders, ...memoHeaders(importedMemoCount)];
      const required = ["번호", "라벨", "지도에서", "이름", "위도", "경도"];
      if (required.some((header) => !headerIndexes.has(header))) {
        notify("워킨맵 엑셀 형식이 아닙니다. 번호·라벨·지도에서·이름·위도·경도 헤더를 확인해 주세요.", "error");
        return;
      }
      const rows: Record<string, string | number>[] = [];
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const values: Record<string, string | number> = {};
        importedHeaders.forEach((header) => {
          const cell = row.getCell(headerIndexes.get(header) || 0);
          values[header] = ["번호", "위도", "경도"].includes(header) ? Number(cell.value) || 0 : cell.text || "";
        });
        if (String(values["이름"] || "").trim()) rows.push(values);
      });
      const inferredTeam = file.name.match(/수도권([ABCD])/i)?.[1]?.toUpperCase() as Team | undefined;
      const inferredQuarter = Number(file.name.match(/([1-4])분기/)?.[1]) as Quarter;
      const inferredKind: WorkKind = /매월/.test(file.name) ? "monthly" : /재계약|계약종료/.test(file.name) ? "renewal" : "quarter";
      if (inferredTeam) setImportTeam(inferredTeam);
      if (inferredQuarter) setImportQuarter(inferredQuarter);
      setImportKind(inferredKind);
      const baseId = Date.now();
      setPendingImport(rows.map((row, index) => ({
        id: baseId + index,
        number: Number(row["번호"]) || index + 1,
        team: inferredTeam || "C",
        quarter: inferredQuarter || 3,
        kind: inferredKind,
        label: String(row["라벨"] || "G12").trim(),
        visible: String(row["지도에서"] || "ON").trim().toUpperCase() !== "OFF",
        name: String(row["이름"] || "").trim(),
        comment: String(row["코멘트"] || "").trim(),
        phone: String(row["전화번호"] || "").replaceAll("_x000d_", "\n").trim(),
        address: String(row["주소"] || "").trim(),
        addressDetail: String(row["상세주소"] || "").replaceAll("_x000d_", "\n").trim(),
        latitude: Number(row["위도"]) || 0,
        longitude: Number(row["경도"]) || 0,
        memos: Array.from({ length: importedMemoCount }, (_, memoIndex) => String(row[`메모${memoIndex + 1}`] || "").replaceAll("_x000d_", "\n").trim()).filter(Boolean),
      })).filter((place) => place.name));
    } catch (error) {
      console.error(error);
      const detail = error instanceof Error ? error.message : String(error);
      notify(`엑셀 파일을 읽지 못했습니다.\n${detail}`, "error");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const applyExcelImport = async () => {
    const imported = pendingImport.map((place) => ({ ...place, team: importTeam, quarter: importQuarter, kind: importKind }));
    if (sharedReady && importMode === "replace") {
      try {
        await deleteRows("workin_map_places", `team=eq.${importTeam}&quarter=eq.${importQuarter}&kind=eq.${importKind}`);
      } catch (error) {
        console.error(error);
        setSyncState("error");
        return;
      }
    }
    if (sharedReady && imported.length) {
      try {
        for (let index = 0; index < imported.length; index += 250) {
          await upsertRows("workin_map_places", imported.slice(index, index + 250).map((place) => toDbPlace(place, userKey)), "id");
        }
        await loadSharedPlaces();
        setSyncState("saved");
      } catch (error) {
        console.error(error);
        setSyncState("error");
        return;
      }
    }
    if (!sharedReady) {
      setPlaces((current) => importMode === "replace"
        ? [...current.filter((place) => !(place.team === importTeam && place.quarter === importQuarter && place.kind === importKind)), ...imported]
        : [...current, ...imported]);
      notify("공용 DB에 연결되지 않아 이 기기에만 저장됐습니다. Supabase의 workin_map_places SQL과 네트워크 연결을 확인해 주세요.", "info");
    }
    setTeamFilter(importTeam);
    setQuarterFilter(importQuarter);
    setKindFilter(importKind);
    setPendingImport([]);
  };

  const exportExcel = async () => {
    const ExcelJS = (await import("exceljs/dist/exceljs.min.js")).default;
    const keyword = query.trim().toLowerCase();
    const exportPlaces = places.filter((place) => {
      if (labelFilters.length && !labelFilters.includes(place.label)) return false;
      if (place.team !== teamFilter) return false;
      if (place.quarter !== quarterFilter) return false;
      if (kindFilter !== "ALL" && place.kind !== kindFilter) return false;
      if (!keyword) return true;
      return [place.name, place.comment, place.phone, place.address, place.addressDetail, ...place.memos].some((value) => value.toLowerCase().includes(keyword));
    });
    const exportMemoCount = Math.max(defaultMemoColumnCount, ...exportPlaces.map((place) => place.memos.length));
    const exportHeaders = [...excelBaseHeaders, ...memoHeaders(exportMemoCount)];
    const rows = exportPlaces.map((place) => {
      const values: Record<string, string | number> = {
        "번호": place.number,
        "라벨": place.label,
        "지도에서": place.visible ? "ON" : "OFF",
        "이름": place.name,
        "코멘트": place.comment,
        "전화번호": place.phone,
        "주소": place.address,
        "상세주소": place.addressDetail,
        "위도": place.latitude,
        "경도": place.longitude,
      };
      for (let index = 0; index < exportMemoCount; index += 1) values[`메모${index + 1}`] = place.memos[index] || "";
      return values;
    });
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("워킨맵", { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.addRow(exportHeaders);
    rows.forEach((row) => sheet.addRow(exportHeaders.map((header) => row[header] ?? "")));
    sheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });
    sheet.columns.forEach((column, index) => {
      const header = exportHeaders[index];
      column.width = header?.startsWith("메모") ? 24 : ["이름", "코멘트", "전화번호", "주소", "상세주소"].includes(header) ? 32 : 12;
    });
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: exportHeaders.length } };
    const kindName = kindFilter === "ALL" ? "전체" : workKinds.find((item) => item.value === kindFilter)?.label;
    const filename = `CS워킨맵_${teamFilter}팀_${quarterFilter}분기_${kindName}.xlsx`;
    const buffer = await workbook.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const placeList = (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex items-center justify-between gap-2 bg-[#151A23] px-3 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-[11px] font-bold text-slate-400">{conditionTitle}</div>
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-black text-white">거래처 <span className="tabular-nums">{filtered.length}</span>곳</span>
            <span className={`text-[10px] font-bold ${syncState === "error" ? "text-rose-400" : "text-slate-400"}`}>
              {syncState === "loading" ? "공용 저장 중" : syncState === "error" ? "공용 DB 연결 필요" : "공용 저장됨"}
            </span>
          </div>
        </div>
        <button type="button" onClick={() => { setEditMode((current) => !current); setCheckedIds([]); }} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-black transition ${editMode ? "bg-white text-slate-950" : "bg-white/10 text-slate-300 hover:bg-white/20"}`}>
          {editMode ? "편집 종료" : "목록 편집"}
        </button>
      </div>
      <div className="border-b border-slate-200 p-3">
        <div className="flex gap-2">
          <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && query.trim() && !filtered.length) void locateAddress(query); }} placeholder="거래처·기기·주소 검색" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
          <button type="button" disabled={geocoding || !query.trim()} onClick={() => void locateAddress(query)} title="주소를 좌표로 찾아 지도에 표시"
            className="shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-[11px] font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">{geocoding ? "…" : "📍주소"}</button>
          {addressPinLabel && <button type="button" onClick={() => { addressClearBridge?.(); setAddressPinLabel(""); }} title="지도의 주소 핀 지우기"
            className="flex max-w-[10rem] shrink-0 items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 py-2 text-[11px] font-black text-blue-700 transition hover:bg-blue-100"><span className="truncate">📍{addressPinLabel}</span><span>✕</span></button>}
          {misuFailed && <span className="self-center whitespace-nowrap rounded-full bg-rose-50 px-2.5 py-1 text-[10px] font-black text-rose-600" title="미수 조회 실패 — 미수 표시가 누락될 수 있습니다. 창을 다시 포커스하면 재시도합니다.">미수 조회 실패</span>}
          <button type="button" onClick={() => setDraft(blankPlace(Math.max(0, ...places.map((place) => place.number)) + 1))} className="shrink-0 rounded-full bg-blue-600 shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 px-3 py-2 text-sm font-black text-white">+ 추가</button>
        </div>
        {kindFilter === "renewal" && <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
          <div className="grid grid-cols-3 gap-1">
            {([['default', '기본순'], ['asc', '종료 빠른순'], ['desc', '종료 나중순']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setRenewalOrder(value)} className={`rounded-full px-2 py-2 text-[11px] font-black ${renewalOrder === value ? "bg-slate-900 text-white" : "bg-white text-slate-500"}`}>{label}</button>)}
          </div>
          <div className="flex gap-1 overflow-x-auto pb-0.5">
            {["ALL", "N", "NN", "S", "SS", "V"].map((grade) => <button key={grade} type="button" onClick={() => setRenewalGradeFilter(grade)} className={`min-w-10 shrink-0 rounded-full px-2.5 py-1.5 text-[11px] font-black transition ${renewalGradeFilter === grade ? "bg-blue-600 text-white" : "bg-white text-slate-500 hover:bg-slate-100"}`}>{grade === "ALL" ? "전체 등급" : grade}</button>)}
          </div>
        </div>}
        {kindFilter === "quarter" && <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
          <div className="flex flex-wrap items-center gap-1">
            <button type="button" onClick={() => setQuarterHasRenewal((current) => !current)} className={`rounded-full px-3 py-1.5 text-[11px] font-black transition ${quarterHasRenewal ? "bg-rose-600 text-white" : "bg-white text-slate-500 hover:bg-slate-100"}`}>재계약 있음</button>
            <button type="button" onClick={() => setQuarterHasMisu((current) => !current)} className={`rounded-full px-3 py-1.5 text-[11px] font-black transition ${quarterHasMisu ? "bg-amber-500 text-white" : "bg-white text-slate-500 hover:bg-slate-100"}`}>미수 있음</button>
            <button type="button" onClick={() => setQuarterHasOverage((current) => !current)} className={`rounded-full px-3 py-1.5 text-[11px] font-black transition ${quarterHasOverage ? "bg-purple-600 text-white" : "bg-white text-slate-500 hover:bg-slate-100"}`}>초과 있음</button>
            <button type="button" onClick={() => setQuarterHasBulman((current) => !current)} className={`rounded-full px-3 py-1.5 text-[11px] font-black transition ${quarterHasBulman ? "bg-red-600 text-white" : "bg-white text-slate-500 hover:bg-slate-100"}`}>불만 있음</button>
            {(quarterHasRenewal || quarterHasMisu || quarterHasOverage || quarterHasBulman || quarterGrades.length > 0) && <button type="button" onClick={() => { setQuarterHasRenewal(false); setQuarterHasMisu(false); setQuarterHasOverage(false); setQuarterHasBulman(false); setQuarterGrades([]); }} className="ml-auto rounded-full px-2.5 py-1.5 text-[11px] font-black text-slate-400 transition hover:bg-white hover:text-slate-600">초기화</button>}
          </div>
          <div className="flex gap-1 overflow-x-auto pb-0.5">
            {["N", "NN", "S", "SS", "V"].map((grade) => <button key={grade} type="button" onClick={() => setQuarterGrades((current) => current.includes(grade) ? current.filter((item) => item !== grade) : [...current, grade])} className={`min-w-10 shrink-0 rounded-full px-2.5 py-1.5 text-[11px] font-black transition ${quarterGrades.includes(grade) ? "bg-blue-600 text-white" : "bg-white text-slate-500 hover:bg-slate-100"}`}>{grade}</button>)}
          </div>
        </div>}
        {kindFilter === "monthly" && <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
          <div className="grid grid-cols-2 gap-1">
            {([['default', '기본순'], ['closing', '마감일순 (1→31)']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setMonthlyOrder(value)} className={`rounded-full px-2 py-2 text-[11px] font-black ${monthlyOrder === value ? "bg-slate-900 text-white" : "bg-white text-slate-500"}`}>{label}</button>)}
          </div>
        </div>}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => fileInputRef.current?.click()} className="rounded-full border border-slate-200 bg-white transition hover:bg-slate-50 px-3 py-2 text-xs font-black text-slate-600">엑셀 불러오기</button>
          <button type="button" onClick={exportExcel} className="rounded-full border border-slate-200 bg-white transition hover:bg-slate-50 px-3 py-2 text-xs font-black text-slate-600">현재 목록 내보내기</button>
          <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleExcelImport(file); }} />
        </div>
      </div>

      {editMode && (
        <div className="border-b border-slate-200 bg-slate-50 p-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-black text-slate-600">
            <input type="checkbox" checked={allVisibleChecked} onChange={() => setCheckedIds(allVisibleChecked ? [] : filtered.map((place) => place.id))} className="h-4 w-4 accent-blue-600" />
            전체 선택 <span className="text-blue-600">{checkedIds.length}/{filtered.length}</span>
          </label>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {mapLabels.map((item) => (
              <button key={item.code} type="button" disabled={!checkedIds.length} onClick={() => bulkSetLabel(item.code)} title={`${item.code} ${item.name}`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-white text-[9px] font-black text-white shadow disabled:opacity-30" style={{ backgroundColor: item.color }}>
                {item.code.replace("G", "")}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
        {syncState === "loading" && (
          <div className="bg-blue-50 px-4 py-2 text-center text-[11px] font-black text-blue-600">서버와 동기화 중… 핀·미수·초과 표시가 잠시 뒤 채워집니다</div>
        )}
        {filtered.map((place) => {
          const meta = labelMeta(place.label);
          const checked = checkedIds.includes(place.id);
          const lastInspection = latestInspectionByPlace.get(place.id) || "";
          const inspectionDays = lastInspection ? daysBetween(lastInspection, kstDate()) : null;
          const renewalMatch = renewalMatchByPlaceId.get(place.id);
          const misu = lookupVendor(misuByVendor, place.name);
          const overage = lookupVendor(overageByVendor, place.name);
          const bulman = lookupVendor(bulmanByVendor, place.name);
          const misuMonths = misu ? misu.months.replace(/개월/g, "").trim() : "";
          const misuBal = misu ? misuBalanceLabel(misu.balance) : "";
          const onDemandHistory = deviceHistoryCache[place.id];
          const historyLoading = expandedId === place.id && place.kind === "quarter" && onDemandHistory === undefined;
          const historyEntries = onDemandHistory !== undefined && onDemandHistory.length ? onDemandHistory : (onDemandHistory !== undefined ? [] : (inspectionHistoryByPlace.get(place.id) || []));
          const inspectionSnapshots = historyEntries.map((visit) => visitSnapshot(visit, place));
          const spareAdviceResult = place.label === "G7" || historyLoading ? null : usageSpareAdvice(inspectionSnapshots[0], inspectionSnapshots[1], `${place.comment} ${place.name}`);
          return (
            <div key={place.id} data-place-id={place.id} className={`${!place.visible ? "opacity-55" : ""} ${selectedId === place.id ? "bg-blue-50" : "bg-white hover:bg-slate-50"}`}>
              <div className="group flex items-start gap-3 px-3 py-3">
              <button type="button" onClick={() => {
                if (editMode) return toggleChecked(place.id);
                selectionSourceRef.current = "list";
                if (selectedId !== place.id) {
                  setSelectedId(place.id);
                  setExpandedId(null);
                  return;
                }
                setExpandedId((current) => current === place.id ? null : place.id);
              }} className="flex min-w-0 flex-1 items-start gap-3 text-left">
                {editMode ? (
                  <span className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-sm font-black ${checked ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-slate-300"}`}>✓</span>
                ) : (
                  <span className="mt-1 h-4 w-4 shrink-0 rounded-full border-2 border-white shadow" style={{ backgroundColor: meta.color }} />
                )}
                <span className="min-w-0">
                  <span className="block text-sm font-black leading-5 text-slate-900">{place.name}</span>
                  <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">{place.comment || place.address}</span>
                  {!place.visible && <span className="mt-1 block text-[11px] font-bold text-slate-400">지도 숨김</span>}
                  {place.kind === "quarter" && <span className={`mt-1 block text-[11px] font-black ${inspectionDays === null ? "text-slate-400" : inspectionDays >= 60 ? "text-emerald-600" : "text-amber-600"}`}>{inspectionDays === null ? "최근 점검 이력 없음" : inspectionDays >= 60 ? `방문 가능 · ${lastInspection} 점검 (${inspectionDays}일 경과)` : `방문 대기 · ${lastInspection} 점검 (${60 - inspectionDays}일 후 가능)`}</span>}
                  {((place.kind === "quarter" && renewalMatch) || misu || overage || bulman) && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {place.kind === "quarter" && renewalMatch && (renewalMatch.done
                        ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-400">재계약 완료 · {renewalMatch.quarter}분기 워킨맵</span>
                        : <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-black text-rose-600">재계약 {renewalMatch.quarter}분기 워킨맵{renewalMatch.isPrev ? "(전분기)" : ""} · {renewalMatch.dueLabel ? `종료 ${renewalMatch.dueLabel}` : "종료월 확인필요"}</span>)}
                      {misu && <span onClick={(e) => { e.stopPropagation(); openFlagHistory(place.name, "미수"); }} className="cursor-pointer rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700 hover:bg-amber-100" title="클릭하면 최근 미수 이력">{(misuMonths || misuBal) ? `미수 ${misuMonths ? `${misuMonths}개월` : ""}${misuMonths && misuBal ? " · " : ""}${misuBal}` : "미수 확인필요"}</span>}
                      {overage && <span onClick={(e) => { e.stopPropagation(); openFlagHistory(place.name, "초과"); }} className="cursor-pointer rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-black text-purple-700 hover:bg-purple-100" title="클릭하면 최근 초과 이력">초과 {misuBalanceLabel(overage.total)}{overage.date ? ` (${overage.date.slice(2, 7)})` : ""}</span>}
                      {bulman && <span onClick={(e) => { e.stopPropagation(); openFlagHistory(place.name, "불만"); }} className="cursor-pointer rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-black text-red-700 hover:bg-red-200" title="클릭하면 최근 불만 이력">불만 {bulman.date.slice(2, 4)}년 {Number(bulman.date.slice(5, 7))}월{bulman.content ? ` · ${bulman.content.slice(0, 14)}` : ""}</span>}
                    </span>
                  )}
                </span>
              </button>
              {!editMode && <button type="button" onClick={() => setDraft({ ...place, memos: [...place.memos] })} className="rounded-full border border-slate-200 px-2.5 py-1.5 text-xs font-black text-slate-500 transition hover:bg-slate-50 lg:opacity-0 lg:group-hover:opacity-100">수정</button>}
              </div>
              {expandedId === place.id && !editMode && (
                <div className="border-t border-blue-100 bg-white px-4 py-3 text-xs text-slate-700">
                  <div className="space-y-3">
                    {place.kind === "quarter" && <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-black text-slate-400">최근 점검 비교</span>
                        <button type="button" onClick={() => setComparePopupId(place.id)} className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-black text-blue-700">자세히 보기</button>
                      </div>
                      {historyLoading ? <div className="mt-1 font-semibold text-slate-400">이 기기 점검 기록 확인 중…</div>
                      : inspectionSnapshots.length ? <div className="mt-1 space-y-1">
                        <div className="font-semibold text-slate-600">최근 {inspectionSnapshots[0].date}{inspectionSnapshots[1] ? ` · 이전 ${inspectionSnapshots[1].date}` : ""}</div>
                        {spareAdviceResult && <div className="flex items-start justify-between gap-2 rounded bg-amber-50 px-2 py-1"><span className="text-[11px] font-black text-amber-700">여분 {spareAdviceResult.adviceLine}</span>{onSelfRequest && <button type="button" onClick={() => {
                          const latestVisit = (inspectionHistoryByPlace.get(place.id) || [])[0];
                          void requestSelfForm(place, latestVisit, inspectionSnapshots[0], spareAdviceResult.needsList, latestVisit?.vendor || place.name);
                        }} className="shrink-0 rounded-full bg-amber-600 px-2.5 py-1 text-[10px] font-black text-white">자가신청</button>}</div>}
                      </div> : <div className="mt-1 font-semibold text-slate-400">{onDemandHistory !== undefined && lastInspection ? `이 기기 블록이 든 방문을 찾지 못했습니다 (최근 업체 방문 ${lastInspection})` : "연결된 점검 기록이 없습니다."}</div>}
                    </div>}
                    <div>
                      <div className="flex items-center gap-2"><span className="font-black text-slate-400">주소</span><NavLinks place={place} /></div>
                      <div className="mt-1 whitespace-pre-wrap font-semibold leading-5">{[place.address, place.addressDetail].filter(Boolean).join(" ") || "-"}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="font-black text-slate-400">연락처</div>
                        <div className="mt-1 whitespace-pre-wrap font-semibold leading-5">{place.phone || "-"}</div>
                      </div>
                      <div>
                        <div className="font-black text-slate-400">업무 정보</div>
                        <div className="mt-1 font-semibold leading-5">{place.label} · {place.team}팀 · {place.quarter}분기 · {workKinds.find((item) => item.value === place.kind)?.label}</div>
                      </div>
                    </div>
                    <div>
                      <div className="font-black text-slate-400">기기·코멘트</div>
                      <div className="mt-1 whitespace-pre-wrap font-semibold leading-5">{place.comment || "-"}</div>
                    </div>
                    <details>
                      <summary className="cursor-pointer font-black text-slate-400">메모 {place.memos.length}개</summary>
                      {place.memos.length ? (
                        <div className="mt-1 divide-y divide-slate-100 border-y border-slate-100">
                          {place.memos.map((memo, index) => <div key={`${place.id}-${index}`} className="whitespace-pre-wrap py-2 font-semibold leading-5">{memo}</div>)}
                        </div>
                      ) : <div className="mt-1 font-semibold text-slate-400">기록된 메모가 없습니다.</div>}
                    </details>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {!filtered.length && <div className="p-10 text-center text-sm font-semibold text-slate-400">검색 결과가 없습니다.</div>}
      </div>
    </div>
  );

  const mapPanel = (
    <div className="relative h-full min-h-0 overflow-hidden bg-slate-100 lg:min-h-[540px]">
      {!engineReady
        ? <div className="flex h-full min-h-[500px] w-full items-center justify-center bg-slate-100 text-sm font-black text-slate-500">지도 준비 중…</div>
        : kakaoNs
          ? <MapCanvasKakao kakao={kakaoNs} places={mapPlaces} selectedId={selectedId} team={teamFilter} viewStorageKey={`${preferenceStorageKey}_views`} onSelect={selectMapPlace} currentPosition={currentPosition} />
          : <MapCanvas places={mapPlaces} selectedId={selectedId} team={teamFilter} viewStorageKey={`${preferenceStorageKey}_views`} onSelect={selectMapPlace} currentPosition={currentPosition} />}
      <div className="absolute left-14 top-3 z-[900] w-[145px] sm:w-[240px]">
        <div className="relative">
          <input
            value={mapQuery}
            onChange={(event) => setMapQuery(event.target.value)}
            onFocus={() => setMapSearchFocused(true)}
            onBlur={() => window.setTimeout(() => setMapSearchFocused(false), 120)}
            placeholder="거래처 검색"
            className="w-full rounded-xl border border-slate-200 bg-white/95 px-3 py-2.5 pr-9 text-sm font-semibold shadow-lg outline-none focus:border-blue-500"
          />
          {mapQuery && <button type="button" onClick={() => setMapQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 px-1 text-sm font-black text-slate-400">×</button>}
          {mapSearchFocused && mapQuery.trim() && (
            <div className="absolute left-0 right-0 top-[calc(100%+4px)] max-h-[280px] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white shadow-2xl">
              {mapSearchResults.map((place) => (
                <button
                  key={place.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    selectMapPlace(place.id);
                    setMapQuery(place.name);
                    setMapSearchFocused(false);
                  }}
                  className="block w-full border-b border-slate-100 px-3 py-2.5 text-left last:border-0 hover:bg-blue-50 active:bg-blue-100"
                >
                  <span className="block truncate text-xs font-black text-slate-900">{place.name}</span>
                  <span className="mt-0.5 block truncate text-[10px] font-semibold text-slate-500">{place.comment || [place.address, place.addressDetail].filter(Boolean).join(" ") || `${place.team}팀 · ${place.label}`}</span>
                </button>
              ))}
              {!mapSearchResults.length && <div className="px-3 py-3 text-xs font-bold text-slate-400">현재 조건에 맞는 거래처가 없습니다.</div>}
            </div>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={toggleLocationTracking}
        title={locationTracking ? "내 위치 추적 중지" : "현재 내 위치 추적"}
        aria-pressed={locationTracking}
        className={`absolute left-3 top-[5.75rem] z-[900] flex h-10 w-10 items-center justify-center rounded-lg border text-xl font-black shadow-lg ${locationTracking ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700"}`}
      >
        <LocateFixed size={19} strokeWidth={2.4} />
      </button>
      <div className="absolute right-3 top-3 z-[900]">
        <div className="relative flex gap-1">
          <button type="button" onClick={() => { setConditionMenuOpen((current) => !current); setColorMenuOpen(false); setProgressMenuOpen(false); }} className={`rounded-full border px-2 py-2.5 text-[11px] font-black shadow-lg sm:px-3 sm:text-xs ${conditionMenuOpen || kindFilter !== "ALL" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700"}`}>조건</button>
          <button type="button" onClick={() => { setColorMenuOpen((current) => !current); setConditionMenuOpen(false); setProgressMenuOpen(false); }} className={`rounded-full border px-2 py-2.5 text-[11px] font-black shadow-lg sm:px-3 sm:text-xs ${colorMenuOpen || labelFilters.length ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700"}`}>색상{labelFilters.length ? ` ${labelFilters.length}` : ""}</button>
          <button type="button" onClick={() => { setProgressMenuOpen((current) => !current); setConditionMenuOpen(false); setColorMenuOpen(false); }} className={`rounded-full border px-2 py-2.5 text-[11px] font-black shadow-lg sm:px-3 sm:text-xs ${progressMenuOpen ? "border-blue-700 bg-blue-700 text-white" : "border-slate-200 bg-white text-slate-700"}`}>진행률</button>

          {conditionMenuOpen && (
            <div className="absolute right-0 top-12 z-[1200] w-[280px] rounded-xl border border-slate-200 bg-white p-3 shadow-2xl">
              <div className="text-[11px] font-black text-slate-400">담당 팀</div>
              <div className="mt-1.5 grid grid-cols-4 gap-1">
                {teams.map((item) => <button key={item} type="button" onClick={() => { setTeamFilter(item); setSelectedId(null); setExpandedId(null); }} className={`rounded px-2 py-1.5 text-xs font-black ${teamFilter === item ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>{item}</button>)}
              </div>
              <div className="mt-3 text-[11px] font-black text-slate-400">분기</div>
              <div className="mt-1.5 grid grid-cols-4 gap-1">
                {quarters.map((item) => <button key={item} type="button" onClick={() => { setQuarterFilter(item); setSelectedId(null); setExpandedId(null); }} className={`rounded px-2 py-1.5 text-xs font-black ${quarterFilter === item ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>{item}Q</button>)}
              </div>
              <div className="mt-3 text-[11px] font-black text-slate-400">업무</div>
              <div className="mt-1.5 grid grid-cols-2 gap-1">
                <button type="button" onClick={() => { setKindFilter("ALL"); setSelectedId(null); setExpandedId(null); }} className={`rounded px-2 py-1.5 text-xs font-black ${kindFilter === "ALL" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>전체</button>
                {workKinds.map((item) => <button key={item.value} type="button" onClick={() => { setKindFilter(item.value); setSelectedId(null); setExpandedId(null); }} className={`rounded px-2 py-1.5 text-xs font-black ${kindFilter === item.value ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>{item.label}</button>)}
              </div>
            </div>
          )}

          {colorMenuOpen && (
            <div className="absolute right-0 top-12 z-[1200] w-[250px] rounded-xl border border-slate-200 bg-white p-3 shadow-2xl">
              <button type="button" onClick={() => setLabelFilters([])} className={`mb-2 w-full rounded px-3 py-2 text-left text-xs font-black ${labelFilters.length === 0 ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>전체 색상</button>
              <div className="grid grid-cols-3 gap-2">
                {mapLabels.map((item) => (
                  <button key={item.code} type="button" onClick={() => setLabelFilters((current) => current.includes(item.code) ? current.filter((code) => code !== item.code) : [...current, item.code])} title={item.name} className={`flex items-center gap-2 rounded border px-2 py-2 text-xs font-black ${labelFilters.includes(item.code) ? "border-slate-900 bg-slate-100" : "border-slate-200 bg-white"}`}>
                    <span className="h-4 w-4 rounded-full" style={{ backgroundColor: item.color }} />{item.code}
                    <span className="ml-auto text-[11px] font-black text-slate-400">{labelCounts.get(item.code) || 0}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {progressMenuOpen && (
            <div className="absolute right-0 top-12 z-[1200] max-h-[calc(100dvh-230px)] w-[370px] max-w-[calc(100vw-24px)] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white p-4 pb-6 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-black text-slate-950">{progressQuarter}분기 팀별 진행률</div>
                  <div className="mt-0.5 text-[10px] font-bold text-slate-400">{progressYear}년 · 남은 영업일 {daysToQuarterEnd}일</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => { setAnalysisOpen(true); setProgressMenuOpen(false); }} className="rounded-full bg-blue-600 shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 px-2.5 py-1.5 text-[11px] font-black text-white hover:bg-blue-700">주차분석</button>
                  <button type="button" onClick={() => setProgressMenuOpen(false)} className="h-7 w-7 rounded text-lg font-black text-slate-400 hover:bg-slate-100">×</button>
                </div>
              </div>
              <div className="mt-3 space-y-3">
                {teamProgress.map((item) => {
                  const inspectionRate = item.inspectionTotal ? Math.round((item.inspectionDone / item.inspectionTotal) * 100) : 0;
                  const renewalRate = item.renewalTotal ? Math.round((item.renewalDone / item.renewalTotal) * 100) : 0;
                  const remaining = Math.max(0, item.inspectionTotal - item.inspectionDone);
                  return (
                    <div key={item.team} className="rounded-lg border border-slate-200 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="text-xs font-black text-slate-900">{item.team}팀</div>
                        <div className="text-[10px] font-black text-blue-700">점검 {item.inspectionDone}/{item.inspectionTotal} · {inspectionRate}%</div>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-blue-600" style={{ width: `${inspectionRate}%` }} /></div>
                      <div className="mt-3 grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1 text-[10px]">
                        <span className="font-black text-slate-500">완료 목표</span><span className="font-black text-slate-500">3인</span><span className="font-black text-slate-500">4인</span>
                        <span className="font-bold text-slate-600">분기 말일 · {daysToQuarterEnd}일</span><span className="font-black text-slate-900">{dailyTarget(remaining, daysToQuarterEnd, 3)}</span><span className="font-black text-slate-900">{dailyTarget(remaining, daysToQuarterEnd, 4)}</span>
                        <span className="font-bold text-slate-600">말일 10일 전 · {daysToEarlyEnd}일</span><span className="font-black text-slate-900">{dailyTarget(remaining, daysToEarlyEnd, 3)}</span><span className="font-black text-slate-900">{dailyTarget(remaining, daysToEarlyEnd, 4)}</span>
                      </div>
                      <div className="mt-3 border-t border-slate-100 pt-3">
                        <div className="flex items-center justify-between gap-2"><div className="text-[10px] font-black text-emerald-700">재계약 현황</div><div className="text-[10px] font-black text-emerald-700">완료 {item.renewalDone}/{item.renewalTotal} · {renewalRate}%</div></div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-emerald-50"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${renewalRate}%` }} /></div>
                        <div className="mt-1 space-y-1">
                          {item.urgentRenewals.map(({ grade, renewal }) => renewal
                            ? <div key={grade} className="flex items-start gap-1.5 text-[11px] font-black leading-4 text-slate-800"><span className="shrink-0 rounded-full bg-emerald-100 px-1.5 text-emerald-700">{grade}</span><span className="min-w-0">{renewal.place.name}<span className="ml-1 text-rose-600">{renewal.end.date}</span></span></div>
                            : <div key={grade} className="text-[10px] font-bold text-slate-400">{grade}급 재계약 건이 없습니다.</div>)}
                        </div>
                        {item.renewalMonths.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{item.renewalMonths.map(([month, count]) => <span key={month} className="rounded bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">{month} {count}건</span>)}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
      {mobileView === "map" && selectedId !== null && (() => {
        const place = places.find((item) => item.id === selectedId);
        if (!place) return null;
        const meta = labelMeta(place.label);
        const address = [place.address, place.addressDetail].filter(Boolean).join(" ");
        return <div className="absolute bottom-0 left-0 right-0 z-[950] overflow-hidden rounded-t-md border-x border-t border-slate-300 bg-white/95 shadow-2xl backdrop-blur-sm lg:hidden">
          {address && <div className="truncate bg-slate-800/90 px-3 py-1.5 text-[11px] font-bold text-white">{address}</div>}
          <div className="flex items-stretch">
            <span className="w-1.5 shrink-0" style={{ backgroundColor: meta.color }} />
            <button type="button" onClick={() => setMobileDetailId(place.id)} className="min-w-0 flex-1 px-3 py-2.5 text-left active:bg-slate-50">
              <span className="block truncate text-sm font-black text-slate-950">{place.name}</span>
              <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">{place.comment || "상세 정보 보기"}</span>
            </button>
            <button type="button" onClick={() => { selectionSourceRef.current = "other"; setSelectedId(null); setExpandedId(null); }} aria-label="선택 닫기" className="w-10 shrink-0 border-l border-slate-100 text-lg font-black text-slate-400 active:bg-slate-100">×</button>
          </div>
        </div>;
      })()}
    </div>
  );

  return (
    <div>
      <section className="overflow-hidden bg-white">
        {desktopLayout ? <div className="grid h-[calc(100dvh-48px)] min-h-[520px] grid-cols-[340px_minmax(0,1fr)]">
          {placeList}
          {mapPanel}
        </div> : <div className="flex h-[calc(100dvh-48px)] min-h-[440px] flex-col">
          <div className="relative min-h-0 flex-1 overflow-hidden">{mobileView === "map" ? mapPanel : placeList}</div>
          <div className="grid shrink-0 grid-cols-2 border-t border-slate-200 bg-white shadow-[0_-3px_10px_rgba(15,23,42,0.08)]">
            <button type="button" onClick={() => setMobileView("map")} className={`pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-xs font-black ${mobileView === "map" ? "bg-blue-50 text-blue-700" : "bg-white text-slate-500"}`}>지도</button>
            <button type="button" onClick={() => { selectionSourceRef.current = "other"; setMobileView("list"); }} className={`pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-xs font-black ${mobileView === "list" ? "bg-blue-50 text-blue-700" : "bg-white text-slate-500"}`}>목록</button>
          </div>
        </div>}
      </section>

      {comparePopup && (() => {
        const { place, snapshots, loading, latestVisit, vendor: popupVendor, advice } = comparePopup;
        return <div className="fixed inset-0 z-[2400] flex items-end bg-slate-950/45 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setComparePopupId(null)}>
          <div className="flex max-h-[85vh] w-full flex-col rounded-t-xl bg-white shadow-2xl sm:max-w-lg sm:rounded-xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div className="min-w-0">
                <div className="text-xs font-black text-blue-600">최근 점검 비교</div>
                <div className="truncate text-base font-black text-slate-950">{place.name}</div>
              </div>
              <button type="button" onClick={() => setComparePopupId(null)} className="h-9 w-9 shrink-0 rounded-lg text-xl font-black text-slate-400">×</button>
            </div>
            <div className="min-h-0 space-y-3 overflow-y-auto p-5">
              {loading ? <div className="py-6 text-center text-sm font-semibold text-slate-400">이 기기 점검 기록 확인 중…</div>
              : snapshots.length ? <>
                {snapshots.map((snapshot, index) => <div key={`${place.id}-popup-${snapshot.date}-${index}`} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <div className="text-sm font-black text-slate-800">{index === 0 ? "최근 방문" : "이전 방문"} · {snapshot.date}</div>
                  <div className="mt-1.5 space-y-1 text-xs font-semibold leading-5 text-slate-600">{snapshotDeviceLabel(snapshot) && <div className="text-slate-500">기기: {snapshotDeviceLabel(snapshot)}</div>}<div>매수: {snapshot.counts || "기록 없음"}</div><div>토너잔량: {snapshot.toner || "기록 없음"}</div><div>여분: {snapshot.spare || "기록 없음"}</div>{snapshot.spareLocation && <div>여분 위치: {snapshot.spareLocation}</div>}</div>
                </div>)}
                {advice && <div className="space-y-1.5">
                  {advice.warning && <div className="rounded bg-rose-50 px-2.5 py-1.5 text-xs font-black text-rose-700">주의 {advice.warning}</div>}
                  {advice.usageLine && <div className="rounded bg-blue-50 px-2.5 py-1.5 text-xs font-black text-blue-700">사용량 {advice.usageLine}</div>}
                  <div className="flex items-start justify-between gap-2 rounded bg-amber-50 px-2.5 py-1.5">
                    <span className="text-xs font-black text-amber-700">여분 {advice.adviceLine}</span>
                    {onSelfRequest && <button type="button" onClick={() => {
                      void requestSelfForm(place, latestVisit, snapshots[0], advice.needsList, popupVendor);
                      setComparePopupId(null);
                    }} className="shrink-0 rounded-full bg-amber-600 px-2.5 py-1.5 text-[11px] font-black text-white">자가신청</button>}
                  </div>
                </div>}
              </> : <div className="py-6 text-center text-sm font-semibold text-slate-400">연결된 점검 기록이 없습니다.</div>}
            </div>
          </div>
        </div>;
      })()}

      {mobileDetail && !desktopLayout && (() => {
        const { place, snapshots, loading: historyLoading, latestVisit, vendor: detailVendor, advice } = mobileDetail;
        const meta = labelMeta(place.label);
        const address = [place.address, place.addressDetail].filter(Boolean).join(" ");
        // 연락처가 여러 개(키맨 여러 명)면 번호 앞에서 잘라 "번호+이름" 세그먼트로 나누고,
        // 같은 번호는 한 번만 (한 줄에 번호가 여러 개거나 중복 기재돼도 라벨-버튼이 어긋나지 않게)
        const phoneLines = (() => {
          const seen = new Map<string, { line: string; num: string }>();
          for (const rawLine of place.phone.split(/\r?\n/)) {
            for (const segment of rawLine.split(/(?=0\d{1,2}[- ]?\d{3,4}[- ]?\d{4})/)) {
              const text = segment.trim();
              const num = text.match(/0\d{1,2}[- ]?\d{3,4}[- ]?\d{4}/)?.[0];
              if (!num) continue;
              const key = num.replace(/[^0-9]/g, "");
              if (!seen.has(key)) seen.set(key, { line: text, num });
            }
          }
          return Array.from(seen.values());
        })();
        return <div className="fixed inset-0 z-[2300] flex flex-col bg-slate-50 text-slate-900 lg:hidden">
          <header className="shrink-0 border-b-4 bg-[#087EA4] pt-[env(safe-area-inset-top)] text-white" style={{ borderBottomColor: meta.color }}>
            <div className="flex h-14 items-center gap-2 px-3">
              <button type="button" onClick={() => setMobileDetailId(null)} aria-label="뒤로" className="flex h-10 w-10 items-center justify-center text-3xl font-light">‹</button>
              <div className="min-w-0 flex-1 text-lg font-black">상세보기</div>
              <button type="button" onClick={() => { setDraft({ ...place, memos: [...place.memos] }); setMobileDetailId(null); }} className="px-2 py-2 text-sm font-black">수정</button>
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white pb-[max(1rem,env(safe-area-inset-bottom))]">
            <section className="border-b-8 border-slate-100 px-4 py-4">
              <div className="flex items-start gap-3">
                <span className="mt-1 h-5 w-5 shrink-0 rounded-full border-2 border-white shadow" style={{ backgroundColor: meta.color }} />
                <div className="min-w-0 flex-1"><div className="text-lg font-black leading-7">{place.name}</div><div className="mt-1 whitespace-pre-wrap text-sm font-semibold leading-5 text-slate-500">{place.comment || "기기 정보 없음"}</div></div>
              </div>
            </section>
            {place.kind === "quarter" && <section className="border-b-8 border-slate-100 px-4 py-4">
              <div className="text-xs font-black text-slate-400">최근 점검 비교</div>
              {historyLoading ? <div className="mt-2 text-sm font-semibold text-slate-400">이 기기 점검 기록 확인 중…</div>
              : snapshots.length ? <div className="mt-3 space-y-3">
                {snapshots.map((snapshot, index) => <div key={`${place.id}-mobile-${snapshot.date}-${index}`} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0"><div className="text-sm font-black">{index === 0 ? "최근 방문" : "이전 방문"} · {snapshot.date}</div><div className="mt-1 space-y-1 text-xs font-semibold leading-5 text-slate-600">{snapshotDeviceLabel(snapshot) && <div className="text-slate-500">기기: {snapshotDeviceLabel(snapshot)}</div>}<div>매수: {snapshot.counts || "기록 없음"}</div><div>토너잔량: {snapshot.toner || "기록 없음"}</div><div>여분: {snapshot.spare || "기록 없음"}</div>{snapshot.spareLocation && <div>여분 위치: {snapshot.spareLocation}</div>}</div></div>)}
                {advice && <div className="space-y-2">{advice.warning && <div className="rounded bg-rose-50 px-2 py-1 text-xs font-black text-rose-700">주의 {advice.warning}</div>}{advice.usageLine && <div className="rounded bg-blue-50 px-2 py-1 text-xs font-black text-blue-700">사용량 {advice.usageLine}</div>}<div className="flex items-start justify-between gap-2 rounded bg-amber-50 px-2 py-1"><span className="text-xs font-black text-amber-700">여분 {advice.adviceLine}</span>{onSelfRequest && <button type="button" onClick={() => {
                  void requestSelfForm(place, latestVisit, snapshots[0], advice.needsList, detailVendor);
                  setMobileDetailId(null);
                }} className="shrink-0 rounded-full bg-amber-600 px-2.5 py-1.5 text-[11px] font-black text-white">자가신청</button>}</div></div>}
              </div> : <div className="mt-2 text-sm font-semibold text-slate-400">연결된 점검 기록이 없습니다.</div>}
            </section>}
            <section className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-start gap-3 border-b border-slate-100 px-4 py-4">
              <span className="text-xl text-slate-400">⌖</span>
              <div className="whitespace-pre-wrap text-sm font-bold leading-6">{address || "주소 정보 없음"}</div>
              <NavLinks place={place} large />
            </section>
            <section className="grid grid-cols-[32px_minmax(0,1fr)] items-start gap-3 border-b-8 border-slate-100 px-4 py-4">
              <span className="text-xl text-slate-400">☎</span>
              {phoneLines.length ? (
                <div className="space-y-2">
                  {phoneLines.map(({ line, num }, index) => (
                    <div key={`${num}-${index}`} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-bold leading-6">{line}</span>
                      <a href={`tel:${num.replace(/[^0-9]/g, "")}`} className="shrink-0 rounded-full bg-emerald-600 px-3 py-2 text-xs font-black text-white">📞 {num}</a>
                    </div>
                  ))}
                </div>
              ) : <div className="whitespace-pre-wrap text-sm font-bold leading-6">{place.phone || "연락처 정보 없음"}</div>}
            </section>
            <section className="border-b-8 border-slate-100 px-4 py-4">
              <div className="text-xs font-black text-slate-400">업무 정보</div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs font-black"><span className="rounded-full bg-slate-100 px-2.5 py-1">{place.team}팀</span><span className="rounded-full bg-slate-100 px-2.5 py-1">{place.quarter}분기</span><span className="rounded px-2 py-1 text-white" style={{ backgroundColor: meta.color }}>{place.label}</span><span className="rounded-full bg-slate-100 px-2.5 py-1">{workKinds.find((item) => item.value === place.kind)?.label}</span></div>
            </section>
            <section className="px-4 py-4">
              <div className="text-xs font-black text-slate-400">메모</div>
              {place.memos.length ? <div className="mt-2 divide-y divide-slate-100">{place.memos.map((memo, index) => <div key={`${place.id}-mobile-memo-${index}`} className="whitespace-pre-wrap py-3 text-sm font-semibold leading-6">{memo}</div>)}</div> : <div className="mt-2 text-sm font-semibold text-slate-400">기록된 메모가 없습니다.</div>}
            </section>
          </main>
        </div>;
      })()}

      {pendingImport.length > 0 && (
        <div className="fixed inset-0 z-[2100] flex items-end bg-slate-950/45 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setPendingImport([])}>
          <div className="w-full rounded-t-xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-black text-blue-600">엑셀 불러오기</div>
                <div className="mt-1 text-lg font-black text-slate-950">거래처 {pendingImport.length}곳</div>
              </div>
              <button type="button" onClick={() => setPendingImport([])} className="h-9 w-9 rounded-lg text-xl font-black text-slate-400">×</button>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <label className="text-xs font-black text-slate-500">팀<select value={importTeam} onChange={(event) => setImportTeam(event.target.value as Team)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">{teams.map((item) => <option key={item} value={item}>{item}팀</option>)}</select></label>
              <label className="text-xs font-black text-slate-500">분기<select value={importQuarter} onChange={(event) => setImportQuarter(Number(event.target.value) as Quarter)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">{quarters.map((item) => <option key={item} value={item}>{item}분기</option>)}</select></label>
              <label className="text-xs font-black text-slate-500">업무<select value={importKind} onChange={(event) => setImportKind(event.target.value as WorkKind)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">{workKinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 rounded-full bg-slate-100 p-1">
              <button type="button" onClick={() => setImportMode("replace")} className={`rounded-full px-3 py-1.5 text-xs font-black transition ${importMode === "replace" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>같은 목록 교체</button>
              <button type="button" onClick={() => setImportMode("append")} className={`rounded-full px-3 py-1.5 text-xs font-black transition ${importMode === "append" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>기존 목록에 추가</button>
            </div>
            <button type="button" onClick={() => void applyExcelImport()} className="mt-5 w-full rounded-full bg-blue-600 shadow-[0_3px_10px_rgba(37,99,235,0.3)] hover:bg-blue-700 px-4 py-3 text-sm font-black text-white">불러오기 적용</button>
          </div>
        </div>
      )}

      {draft && (
        <div className="fixed inset-0 z-[2000] flex items-end bg-slate-950/45 p-0 lg:items-center lg:justify-center lg:p-5" onMouseDown={() => setDraft(null)}>
          <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-xl bg-white shadow-2xl lg:max-w-3xl lg:rounded-lg" onMouseDown={(event) => event.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
              <div>
                <div className="text-xs font-black text-blue-600">거래처 정보</div>
                <div className="text-lg font-black text-slate-950">{places.some((place) => place.id === draft.id) ? "수정" : "추가"}</div>
              </div>
              <button type="button" onClick={() => setDraft(null)} className="h-9 w-9 rounded-lg text-xl font-black text-slate-400 hover:bg-slate-100">×</button>
            </div>

            <div className="grid gap-4 p-4 lg:grid-cols-2">
              <label className="text-xs font-black text-slate-500">번호<input type="number" value={draft.number} onChange={(event) => setDraft({ ...draft, number: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" /></label>
              <div className="lg:col-span-2">
                <div className="text-xs font-black text-slate-500">라벨</div>
                <div className="mt-1.5 grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
                  {mapLabels.map((item) => {
                    const active = draft.label === item.code;
                    return <button
                      key={item.code}
                      type="button"
                      onClick={() => setDraft({ ...draft, label: item.code })}
                      className={`min-h-12 rounded-lg border px-2 py-1.5 text-left transition ${active ? "border-slate-950 ring-2 ring-slate-300" : "border-slate-200 hover:border-slate-400"}`}
                      style={{ background: active ? item.color : `${item.color}18` }}
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: item.color }} />
                        <b className={active && ["G4", "G5", "G8", "G11", "G12"].includes(item.code) ? "text-white" : "text-slate-950"}>{item.code}</b>
                      </span>
                      {item.name && <span className={`mt-0.5 block text-[10px] font-bold leading-3 ${active && ["G4", "G5", "G8", "G11", "G12"].includes(item.code) ? "text-white/90" : "text-slate-500"}`}>{item.name}</span>}
                    </button>;
                  })}
                </div>
              </div>
              <label className="text-xs font-black text-slate-500">담당 팀<select value={draft.team || "C"} onChange={(event) => setDraft({ ...draft, team: event.target.value as Team })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">{teams.map((item) => <option key={item} value={item}>{item}팀</option>)}</select></label>
              <label className="text-xs font-black text-slate-500">분기<select value={draft.quarter || 3} onChange={(event) => setDraft({ ...draft, quarter: Number(event.target.value) as Quarter })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">{quarters.map((item) => <option key={item} value={item}>{item}분기</option>)}</select></label>
              <label className="text-xs font-black text-slate-500 lg:col-span-2">업무<select value={draft.kind || "quarter"} onChange={(event) => setDraft({ ...draft, kind: event.target.value as WorkKind })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">{workKinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label className="flex items-center gap-2 text-sm font-black text-slate-600 lg:col-span-2"><input type="checkbox" checked={draft.visible} onChange={(event) => setDraft({ ...draft, visible: event.target.checked })} className="h-4 w-4 accent-blue-600" />지도에서 표시</label>
              <label className="text-xs font-black text-slate-500 lg:col-span-2">이름<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" /></label>
              <label className="text-xs font-black text-slate-500 lg:col-span-2">코멘트<input value={draft.comment} onChange={(event) => setDraft({ ...draft, comment: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" /></label>
              <label className="text-xs font-black text-slate-500">전화번호<input value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" /></label>
              <label className="text-xs font-black text-slate-500">주소<input value={draft.address} onChange={(event) => setDraft({ ...draft, address: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" /></label>
              <label className="text-xs font-black text-slate-500 lg:col-span-2">상세주소<input value={draft.addressDetail} onChange={(event) => setDraft({ ...draft, addressDetail: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" /></label>
              <label className="text-xs font-black text-slate-500">위도<input type="number" step="0.000001" value={draft.latitude} onChange={(event) => setDraft({ ...draft, latitude: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" /></label>
              <label className="text-xs font-black text-slate-500">경도<input type="number" step="0.000001" value={draft.longitude} onChange={(event) => setDraft({ ...draft, longitude: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" /></label>

              <div className="lg:col-span-2">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-black text-slate-500">메모 {draft.memos.length}개</div>
                  <button type="button" onClick={() => setDraft({ ...draft, memos: [...draft.memos, ""] })} className="rounded-full border border-blue-200 px-3 py-1.5 text-xs font-black text-blue-600">+ 메모 추가</button>
                </div>
                <div className="space-y-2">
                  {draft.memos.map((memo, index) => (
                    <div key={index} className="flex gap-2">
                      <input value={memo} onChange={(event) => setDraft({ ...draft, memos: draft.memos.map((item, memoIndex) => memoIndex === index ? event.target.value : item) })} placeholder={`메모${index + 1}`} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                      <button type="button" aria-label={`메모${index + 1} 삭제`} onClick={() => setDraft({ ...draft, memos: draft.memos.filter((_, memoIndex) => memoIndex !== index) })} className="h-10 w-10 rounded-lg border border-slate-200 text-lg font-black text-slate-400">×</button>
                    </div>
                  ))}
                  {!draft.memos.length && <button type="button" onClick={() => setDraft({ ...draft, memos: [""] })} className="w-full rounded-lg border border-dashed border-slate-300 py-4 text-sm font-black text-slate-400">메모 추가</button>}
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 flex gap-2 border-t border-slate-200 bg-white p-4">
              <button type="button" onClick={deleteDraft} className="rounded-full border border-rose-200 px-4 py-2.5 text-sm font-black text-rose-600">삭제</button>
              <button type="button" onClick={saveDraft} disabled={!draft.name.trim()} className="ml-auto rounded-full bg-blue-600 shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 px-5 py-2.5 text-sm font-black text-white disabled:opacity-40">저장</button>
            </div>
          </div>
        </div>
      )}

      {analysisOpen && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-slate-950/50 p-3" onClick={() => setAnalysisOpen(false)}>
          <div className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <div className="text-base font-black text-slate-950">{progressQuarter}분기 팀별 주차 분석</div>
                <div className="mt-0.5 text-[11px] font-bold text-slate-400">{progressYear}년 · 분기 경과 {Math.round(weeklyAnalysis.elapsedRatio * 100)}% · 남은 영업일 {daysToQuarterEnd}일</div>
              </div>
              <button type="button" onClick={() => setAnalysisOpen(false)} className="h-8 w-8 shrink-0 rounded text-xl font-black text-slate-400 hover:bg-slate-100">×</button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              {weeklyAnalysis.teams.map((row) => {
                const inspPct = row.inspTotal ? Math.round((row.inspDone / row.inspTotal) * 100) : 0;
                const renewPct = row.renewTotal ? Math.round((row.renewDone / row.renewTotal) * 100) : 0;
                const elapsedPct = Math.round(weeklyAnalysis.elapsedRatio * 100);
                const paceTone = row.pace === "순조" ? "bg-emerald-100 text-emerald-700" : row.pace === "주의" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700";
                const open = analysisTeamsOpen[row.team] ?? false;
                return (
                  <div key={row.team} className="overflow-hidden rounded-lg border border-slate-200">
                    <button type="button" onClick={() => setAnalysisTeamsOpen((current) => ({ ...current, [row.team]: !open }))} className="flex w-full items-center justify-between gap-2 p-3 text-left hover:bg-slate-50">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black text-slate-900">{row.team}팀</span>
                        <span className="text-[11px] font-bold text-blue-700">점검 {inspPct}%</span>
                        <span className="text-[11px] font-bold text-emerald-700">재계약 {renewPct}%</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`rounded px-2 py-0.5 text-[11px] font-black ${paceTone}`}>{row.pace}</span>
                        <span className="text-[10px] font-black text-slate-400">{open ? "▲" : "▼"}</span>
                      </div>
                    </button>
                    {open && (
                      <div className="border-t border-slate-100 p-3">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <div className="flex items-center justify-between text-[11px] font-black text-blue-700"><span>점검</span><span>{row.inspDone}/{row.inspTotal} · {inspPct}%</span></div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-blue-600" style={{ width: `${inspPct}%` }} /></div>
                          </div>
                          <div>
                            <div className="flex items-center justify-between text-[11px] font-black text-emerald-700"><span>재계약</span><span>{row.renewDone}/{row.renewTotal} · {renewPct}%</span></div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-emerald-50"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${renewPct}%` }} /></div>
                          </div>
                        </div>
                        <div className="mt-2 text-[11px] font-bold text-slate-500">경과 {elapsedPct}% 대비 점검 {inspPct}% → <span className={row.pace === "스퍼트 필요" ? "text-rose-600" : row.pace === "주의" ? "text-amber-600" : "text-emerald-600"}>{row.pace === "스퍼트 필요" ? "스퍼트 올려야 함" : row.pace === "주의" ? "속도 주의" : "순조롭게 진행 중"}</span></div>
                        {(row.inspBaseline > 0 || row.renewBaseline > 0) && <div className="mt-2 text-[10px] font-bold text-slate-400">추적 전 완료(날짜 미기록): 점검 {row.inspBaseline} · 재계약 {row.renewBaseline} — 아래 주차엔 이후 색칠분만 집계</div>}
                        <table className="mt-1.5 w-full border-collapse text-[11px]">
                          <thead>
                            <tr className="border-b border-slate-100 text-slate-400">
                              <th className="py-1 text-left font-black">주차</th>
                              <th className="py-1 text-center font-black">점검</th>
                              <th className="py-1 text-center font-black">재계약</th>
                              <th className="py-1 text-center font-black">점검 달성률</th>
                              <th className="py-1 text-center font-black">재계약 달성률</th>
                            </tr>
                          </thead>
                          <tbody>
                            {weeklyAnalysis.weeks.map((week, index) => {
                              const inspN = row.inspWeekly[index];
                              const renewN = row.renewWeekly[index];
                              const inspWeekPct = row.inspTotal ? (inspN / row.inspTotal) * 100 : 0;
                              const renewWeekPct = row.renewTotal ? (renewN / row.renewTotal) * 100 : 0;
                              const isNow = todayKst >= week.start && todayKst <= week.end;
                              const isFuture = week.start > todayKst;
                              const isEnd = weeklyAnalysis.endDate >= week.start && weeklyAnalysis.endDate <= week.end;
                              const isEarly = weeklyAnalysis.earlyEndDate >= week.start && weeklyAnalysis.earlyEndDate <= week.end;
                              return (
                                <tr key={week.label} className={`border-b border-slate-50 ${isNow ? "bg-blue-50 font-black" : isEnd ? "bg-rose-50" : isEarly ? "bg-amber-50" : isFuture ? "text-slate-300" : ""}`}>
                                  <td className="py-1 text-left text-slate-600">{week.label} <span className="text-slate-300">{week.start.slice(5)}~{week.end.slice(5)}</span>{isEarly && <span className="ml-1 rounded-full bg-amber-200 px-1 text-[9px] font-black text-amber-800">말일-10일</span>}{isEnd && <span className="ml-1 rounded-full bg-rose-200 px-1 text-[9px] font-black text-rose-800">말일</span>}</td>
                                  <td className="py-1 text-center text-blue-700">{inspN ? `+${inspN}` : "·"}</td>
                                  <td className="py-1 text-center text-emerald-700">{renewN ? `+${renewN}` : "·"}</td>
                                  <td className="py-1 text-center font-black text-blue-700">{inspN ? `${inspWeekPct.toFixed(1)}%` : "·"}</td>
                                  <td className="py-1 text-center font-black text-emerald-700">{renewN ? `${renewWeekPct.toFixed(1)}%` : "·"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="text-[10px] font-bold text-slate-400">워킨맵 색칠(G5 완료) 기준 · 매월점검은 G2×1·G3×2·G5×3로 환산. 과거 완료분은 완료일 기록이 없어 주차엔 안 잡히고, 지금부터 색칠하는 건 해당 주차에 자동 집계됩니다.</div>
            </div>
          </div>
        </div>
      )}
      {flagDetail && (
        <SheetDetailModal
          title={flagHistory?.vendor || ""}
          row={flagDetail.record}
          fields={flagDetail.kind === "미수" ? MISU_DETAIL_FIELDS : flagDetail.kind === "초과" ? OVERAGE_DETAIL_FIELDS : Object.keys(flagDetail.record).filter((k) => !k.startsWith("_") && !["id", "created_at"].includes(k))}
          layout={flagDetail.kind === "미수" ? MISU_DETAIL_LAYOUT : flagDetail.kind === "초과" ? OVERAGE_DETAIL_LAYOUT : undefined}
          onClose={() => setFlagDetail(null)}
        />
      )}
      {flagHistory && (
        <div className="fixed inset-0 z-[2400] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setFlagHistory(null)}>
          <div className="flex max-h-[78vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-w-3xl sm:rounded-xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4">
              <div className="min-w-0">
                <div className="text-[11px] font-black text-blue-600">최근 {flagHistory.kind} 이력 · 최신 {flagHistory.records.length || ""}건</div>
                <div className="truncate text-base font-black text-slate-950">{flagHistory.vendor}</div>
              </div>
              <button type="button" onClick={() => setFlagHistory(null)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100">✕</button>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
              {flagHistory.loading && <div className="py-8 text-center text-xs font-bold text-slate-400">불러오는 중…</div>}
              {!flagHistory.loading && !flagHistory.records.length && <div className="py-8 text-center text-xs font-bold text-slate-400">이력을 찾지 못했습니다.</div>}
              {flagHistory.records.map((record, i) => {
                const date = normMisuDate(String(record["입력일"] || record["방문일"] || record["날짜"] || "")) || String(record["입력일"] || record["방문일"] || record["날짜"] || "").slice(0, 10);
                const source = String(record["_출처"] || "").split(":")[0];
                const summary = flagHistory.kind === "미수"
                  ? `${String(record["미수개월"] || record["실제 개월수"] || "").replace(/개월/g, "").trim() || "-"}개월 · ${misuBalanceLabel(String(record["미수잔액"] || record["실제 잔액"] || ""))}`
                  : flagHistory.kind === "초과"
                    ? `합계 ${misuBalanceLabel(String(record["합계"] || "0"))}`
                    : String(record["불만내용"] || record["불편내용"] || "").slice(0, 60) || "내용 확인";
                return (
                  <button key={i} type="button" onClick={() => setFlagDetail({ record, kind: flagHistory.kind })}
                    className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-left transition hover:border-blue-300 hover:bg-blue-50/40">
                    <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-black text-blue-600">{flagHistory.kind}</span>
                    <span className="shrink-0 text-sm font-black text-slate-950">{date || "날짜 미상"}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-slate-600">{summary}</span>
                    {source && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500">{source}</span>}
                    <span className="shrink-0 text-slate-300">›</span>
                  </button>
                );
              })}
              <div className="pt-1 text-center text-[10px] font-bold text-slate-400">건을 누르면 조회탭과 같은 상세가 열립니다</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
