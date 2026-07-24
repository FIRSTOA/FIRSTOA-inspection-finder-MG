import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { LocateFixed } from "lucide-react";
import "leaflet/dist/leaflet.css";
import { deleteRows, selectAllRows, upsertRows } from "./supabase";
import { getTeamVisits, kstDate, type VisitRow } from "./visits";

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

const mapLabels: MapLabel[] = [
  { code: "G1", name: "", color: "#ff8458" },
  { code: "G2", name: "", color: "#ffb51b" },
  { code: "G3", name: "", color: "#ff2f68" },
  { code: "G4", name: "", color: "#b22998" },
  { code: "G5", name: "점검 완료", color: "#087fa2" },
  { code: "G6", name: "", color: "#25b44b" },
  { code: "G7", name: "", color: "#b56ef3" },
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

function vendorMatchKey(value: string) {
  return value
    .replace(/^(?:\d{4}\/)?\d+(?:SS|NN|S|N|V)?[A-Z]?(?=[가-힣㈜(])/i, "")
    .replace(/^(?:\d{4}\/)?\d+(?:SS|NN|S|N|V)?/i, "")
    .replace(/(?:분기|매월|계약종료|재계약|점검|마감).*$/i, "")
    .replace(/[^0-9a-z가-힣]/gi, "")
    .toLowerCase();
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

function deviceVisitText(visit: VisitRow, place: MapPlace) {
  const source = visit.sourceText || visit.note || "";
  const serial = deviceSerial(place);
  if (!serial || !source.toUpperCase().includes(serial.toUpperCase())) return source;
  const blocks = source.split(/\n(?=\d+\.\s*(?:\n|$))/);
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

function counterValue(value: string, label: "흑" | "컬") {
  const match = value.match(new RegExp(`${label}\\s*[-:]?\\s*([\\d,]+)`, "i"));
  return match ? Number(match[1].replaceAll(",", "")) : null;
}

function supplyChanges(current: string, previous: string) {
  return ["K", "C", "M", "Y", "폐"].flatMap((label) => {
    const pattern = new RegExp(`${label}\\s*[-:]?\\s*(\\d+)`, "i");
    const before = previous.match(pattern)?.[1];
    const after = current.match(pattern)?.[1];
    return before !== undefined && after !== undefined ? [`${label} ${before}→${after}`] : [];
  });
}

function visitSnapshot(visit: VisitRow, place: MapPlace) {
  const text = deviceVisitText(visit, place);
  const spare = visitMetric(text, "여분");
  return {
    date: visit.workDate,
    counts: visitMetric(text, "매수"),
    toner: visitMetric(text, "토너잔량"),
    spare,
    spareLocation: visitSpareLocation(spare),
  };
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
  element.style.background = active ? "#0f172a" : "";
  element.style.color = active ? "#ffffff" : "";
  element.style.padding = active ? "5px 7px" : "";
  element.style.margin = active ? "-5px -7px" : "";
  element.style.borderRadius = active ? "4px" : "";
  element.style.boxShadow = active ? "0 4px 12px rgba(15, 23, 42, .28)" : "";
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
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    observer.observe(elementRef.current);
    window.setTimeout(() => map.invalidateSize({ pan: false }), 50);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
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

export default function WalkingMap({ userKey = "guest" }: { userKey?: string }) {
  const initialLocalPlacesRef = useRef<MapPlace[] | null>(loadMigratablePlaces());
  const [places, setPlaces] = useState<MapPlace[]>(() => initialLocalPlacesRef.current || loadPlaces());
  const [sharedReady, setSharedReady] = useState(false);
  const [syncState, setSyncState] = useState<"loading" | "saved" | "error">("loading");
  const [query, setQuery] = useState("");
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
  const [inspectionVisits, setInspectionVisits] = useState<VisitRow[]>([]);
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const [conditionMenuOpen, setConditionMenuOpen] = useState(false);
  const [progressMenuOpen, setProgressMenuOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [mobileView, setMobileView] = useState<"map" | "list">("map");
  const [mobileDetailId, setMobileDetailId] = useState<number | null>(null);
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
      window.alert("이 기기에서는 현재 위치를 사용할 수 없습니다.");
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
        window.alert(message);
      },
      { enableHighAccuracy: false, maximumAge: 15_000, timeout: 12_000 },
    );
  }, [locationTracking, stopLocationTracking]);

  useEffect(() => () => {
    if (locationWatchRef.current !== null) navigator.geolocation.clearWatch(locationWatchRef.current);
  }, []);

  const loadSharedPlaces = useCallback(async () => {
    const remote = await selectAllRows<DbMapPlace>("workin_map_places", "select=*&order=id.asc");
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

  useEffect(() => {
    let active = true;
    const startDate = dateDaysAgo(370);
    // 과거 visit_logs에 원문이 없는 기록만 보완한다. 목록 전체를 빠르게
    // 받을 수 있도록 큰 _원문 대신 비교에 필요한 열만 조회한다.
    const archiveSelect = encodeURIComponent("작성일,_업체명,업체명,모델명,시리얼넘버,자산기번,매수,토너잔량,폐통,여분");
    const archiveDate = encodeURIComponent("작성일");
    void Promise.all([
      getTeamVisits(startDate, kstDate()),
      selectAllRows<InspectionArchiveRow>("jeomgeom", `select=${archiveSelect}&${archiveDate}=gte.${startDate}&order=${archiveDate}.desc`),
    ])
      .then(([rows, archiveRows]) => {
        if (!active) return;
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
      })
      .catch((error) => console.error("Workin map visit history load failed", error));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const initializeSharedPlaces = async () => {
      try {
        const remote = await selectAllRows<DbMapPlace>("workin_map_places", "select=*&order=id.asc");
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

  const scopedPlaces = useMemo(() => {
    const rows = places.filter((place) => {
      if (labelFilters.length && !labelFilters.includes(place.label)) return false;
      if (place.team !== teamFilter) return false;
      if (place.quarter !== quarterFilter) return false;
      if (kindFilter !== "ALL" && place.kind !== kindFilter) return false;
      if (kindFilter === "renewal" && renewalGradeFilter !== "ALL" && renewalGrade(place) !== renewalGradeFilter) return false;
      return true;
    });
    if (kindFilter !== "renewal" || renewalOrder === "default") return rows;
    const year = new Date().getFullYear();
    return [...rows].sort((left, right) => {
      const leftEnd = projectedContractEnd(left, year, quarterFilter)?.key;
      const rightEnd = projectedContractEnd(right, year, quarterFilter)?.key;
      if (leftEnd === undefined) return rightEnd === undefined ? 0 : 1;
      if (rightEnd === undefined) return -1;
      return renewalOrder === "asc" ? leftEnd - rightEnd : rightEnd - leftEnd;
    });
  }, [places, labelFilters, teamFilter, quarterFilter, kindFilter, renewalGradeFilter, renewalOrder]);

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

  const inspectionHistoryByPlace = useMemo(() => {
    const indexed = inspectionVisits
      .map((visit) => ({ visit, key: vendorMatchKey(visit.vendor) }))
      .filter((item) => item.key)
      .sort((left, right) => right.visit.workDate.localeCompare(left.visit.workDate));
    return new Map(places.map((place) => {
      const key = vendorMatchKey(place.name);
      const exact = indexed.filter((item) => item.key === key).map((item) => item.visit);
      const matches = exact.length ? exact : key.length >= 5
        ? indexed.filter((item) => item.key.length >= 5 && (item.key.includes(key) || key.includes(item.key))).map((item) => item.visit)
        : [];
      return [place.id, matches.slice(0, 2)];
    }));
  }, [inspectionVisits, places]);

  const latestInspectionByPlace = useMemo(() => new Map(places.map((place) => [place.id, inspectionHistoryByPlace.get(place.id)?.[0]?.workDate || ""])), [inspectionHistoryByPlace, places]);

  // 분기점검 간략보기용: 같은 팀 기준 이번/전분기 재계약 워킹맵에 같은 거래처가 있는지와 계약종료월.
  // (재계약은 점검보다 한 달 앞서 진행돼 분기가 겹치므로 전분기 재계약까지 확인한다.)
  const renewalMatchByPlaceId = useMemo(() => {
    const prevQuarter = (quarterFilter === 1 ? 4 : quarterFilter - 1) as Quarter;
    const baseYear = new Date().getFullYear();
    const byKey = new Map<string, MapPlace[]>();
    for (const place of places) {
      if (place.kind !== "renewal" || place.team !== teamFilter) continue;
      if (place.quarter !== quarterFilter && place.quarter !== prevQuarter) continue;
      const key = vendorMatchKey(place.name);
      if (!key) continue;
      const list = byKey.get(key);
      if (list) list.push(place); else byKey.set(key, [place]);
    }
    const result = new Map<number, { quarter: Quarter; isPrev: boolean; end: ReturnType<typeof contractEnd> }>();
    if (!byKey.size) return result;
    for (const place of places) {
      if (place.kind !== "quarter" || place.team !== teamFilter) continue;
      const key = vendorMatchKey(place.name);
      const matches = key ? byKey.get(key) : undefined;
      if (!matches || !matches.length) continue;
      const best = matches
        .map((match) => ({ match, end: contractEnd(match, baseYear) }))
        .sort((a, b) => (a.end?.key || Infinity) - (b.end?.key || Infinity))[0];
      const isPrev = best.match.quarter === prevQuarter;
      result.set(place.id, { quarter: isPrev ? prevQuarter : quarterFilter, isPrev, end: best.end });
    }
    return result;
  }, [places, teamFilter, quarterFilter]);

  const mobileDetail = useMemo(() => {
    if (mobileDetailId === null) return null;
    const place = places.find((item) => item.id === mobileDetailId);
    if (!place) return null;
    const snapshots = (inspectionHistoryByPlace.get(place.id) || []).map((visit) => visitSnapshot(visit, place));
    const currentCounts = snapshots[0]?.counts || "";
    const previousCounts = snapshots[1]?.counts || "";
    const currentBlack = counterValue(currentCounts, "흑");
    const previousBlack = counterValue(previousCounts, "흑");
    const currentColor = counterValue(currentCounts, "컬");
    const previousColor = counterValue(previousCounts, "컬");
    return {
      place,
      snapshots,
      blackDiff: currentBlack !== null && previousBlack !== null ? currentBlack - previousBlack : null,
      colorDiff: currentColor !== null && previousColor !== null ? currentColor - previousColor : null,
      tonerChanges: supplyChanges(snapshots[0]?.toner || "", snapshots[1]?.toner || ""),
      spareChanges: supplyChanges(snapshots[0]?.spare || "", snapshots[1]?.spare || ""),
    };
  }, [inspectionHistoryByPlace, mobileDetailId, places]);

  const mapPlaces = useMemo(() => scopedPlaces.filter((place) => place.visible), [scopedPlaces]);
  const progressQuarter = quarterFilter;
  const progressYear = new Date().getFullYear();
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
        window.alert(".xlsx 형식만 불러올 수 있습니다.");
        return;
      }
      const ExcelJS = (await import("exceljs/dist/exceljs.min.js")).default;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        window.alert("엑셀 시트를 찾을 수 없습니다.");
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
        window.alert("워킨맵 엑셀 형식이 아닙니다. 번호·라벨·지도에서·이름·위도·경도 헤더를 확인해 주세요.");
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
      window.alert(`엑셀 파일을 읽지 못했습니다.\n${detail}`);
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
      window.alert("공용 DB에 연결되지 않아 이 기기에만 저장됐습니다. Supabase의 workin_map_places SQL과 네트워크 연결을 확인해 주세요.");
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
    <div className="flex min-h-0 flex-col bg-white">
      <div className="border-b border-slate-200 p-3">
        <div className="mb-2 truncate text-xs font-black text-blue-700">{conditionTitle}</div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-black text-slate-950">거래처 {filtered.length}곳</div>
            <div className={`text-[10px] font-bold ${syncState === "error" ? "text-rose-600" : "text-slate-400"}`}>
              {syncState === "loading" ? "공용 저장 중" : syncState === "error" ? "공용 DB 연결 필요" : "공용 저장됨"}
            </div>
          </div>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => { setEditMode((current) => !current); setCheckedIds([]); }} className={`rounded-md px-3 py-2 text-xs font-black ${editMode ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>
              {editMode ? "편집 종료" : "목록 편집"}
            </button>
          </div>
        </div>
        <div className="mt-2 flex gap-2">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="거래처·기기·주소 검색" className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500" />
          <button type="button" onClick={() => setDraft(blankPlace(Math.max(0, ...places.map((place) => place.number)) + 1))} className="shrink-0 rounded-md bg-blue-600 px-3 py-2 text-sm font-black text-white">+ 추가</button>
        </div>
        {kindFilter === "renewal" && <div className="mt-2 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2">
          <div className="grid grid-cols-3 gap-1">
            {([['default', '기본순'], ['asc', '종료 빠른순'], ['desc', '종료 나중순']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setRenewalOrder(value)} className={`rounded px-2 py-2 text-[11px] font-black ${renewalOrder === value ? "bg-slate-900 text-white" : "bg-white text-slate-500"}`}>{label}</button>)}
          </div>
          <div className="flex gap-1 overflow-x-auto pb-0.5">
            {["ALL", "N", "NN", "S", "SS", "V"].map((grade) => <button key={grade} type="button" onClick={() => setRenewalGradeFilter(grade)} className={`min-w-10 shrink-0 rounded px-2 py-1.5 text-[11px] font-black ${renewalGradeFilter === grade ? "bg-blue-600 text-white" : "bg-white text-slate-500"}`}>{grade === "ALL" ? "전체 등급" : grade}</button>)}
          </div>
        </div>}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => fileInputRef.current?.click()} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600">엑셀 불러오기</button>
          <button type="button" onClick={exportExcel} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600">현재 목록 내보내기</button>
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
        {filtered.map((place) => {
          const meta = labelMeta(place.label);
          const checked = checkedIds.includes(place.id);
          const lastInspection = latestInspectionByPlace.get(place.id) || "";
          const inspectionDays = lastInspection ? daysBetween(lastInspection, kstDate()) : null;
          const renewalMatch = renewalMatchByPlaceId.get(place.id);
          const inspectionSnapshots = (inspectionHistoryByPlace.get(place.id) || []).map((visit) => visitSnapshot(visit, place));
          const currentCounts = inspectionSnapshots[0]?.counts || "";
          const previousCounts = inspectionSnapshots[1]?.counts || "";
          const blackDiff = counterValue(currentCounts, "흑") !== null && counterValue(previousCounts, "흑") !== null ? counterValue(currentCounts, "흑")! - counterValue(previousCounts, "흑")! : null;
          const colorDiff = counterValue(currentCounts, "컬") !== null && counterValue(previousCounts, "컬") !== null ? counterValue(currentCounts, "컬")! - counterValue(previousCounts, "컬")! : null;
          const tonerChanges = supplyChanges(inspectionSnapshots[0]?.toner || "", inspectionSnapshots[1]?.toner || "");
          const spareChanges = supplyChanges(inspectionSnapshots[0]?.spare || "", inspectionSnapshots[1]?.spare || "");
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
                  <span className="mt-1 block text-[11px] font-bold" style={{ color: meta.color }}>{place.label} · {place.team}팀 · {place.quarter}Q · {workKinds.find((item) => item.value === place.kind)?.label}{!place.visible ? " · 지도 숨김" : ""}</span>
                  {place.kind === "quarter" && <span className={`mt-1 block text-[11px] font-black ${inspectionDays === null ? "text-slate-400" : inspectionDays >= 60 ? "text-emerald-600" : "text-amber-600"}`}>{inspectionDays === null ? "최근 점검 이력 없음" : inspectionDays >= 60 ? `방문 가능 · ${lastInspection} 점검 (${inspectionDays}일 경과)` : `방문 대기 · ${lastInspection} 점검 (${60 - inspectionDays}일 후 가능)`}</span>}
                  {place.kind === "quarter" && renewalMatch && <span className="mt-1 block rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-black text-rose-600">🔁 재계약 {renewalMatch.quarter}Q{renewalMatch.isPrev ? "(전분기)" : ""} 워킹맵{renewalMatch.end ? ` · 종료 ${renewalMatch.end.label}` : ""}</span>}
                </span>
              </button>
              {!editMode && <button type="button" onClick={() => setDraft({ ...place, memos: [...place.memos] })} className="rounded-md border border-slate-200 px-2 py-1.5 text-xs font-black text-slate-500 opacity-100 lg:opacity-0 lg:group-hover:opacity-100">수정</button>}
              </div>
              {expandedId === place.id && !editMode && (
                <div className="border-t border-blue-100 bg-white px-4 py-3 text-xs text-slate-700">
                  <div className="space-y-3">
                    <div>
                      <div className="font-black text-slate-400">주소</div>
                      <div className="mt-1 whitespace-pre-wrap font-semibold leading-5">{[place.address, place.addressDetail].filter(Boolean).join(" ") || "-"}</div>
                    </div>
                    <div>
                      <div className="font-black text-slate-400">연락처</div>
                      <div className="mt-1 whitespace-pre-wrap font-semibold leading-5">{place.phone || "-"}</div>
                    </div>
                    <div>
                      <div className="font-black text-slate-400">기기·코멘트</div>
                      <div className="mt-1 whitespace-pre-wrap font-semibold leading-5">{place.comment || "-"}</div>
                    </div>
                    <div>
                      <div className="font-black text-slate-400">업무 정보</div>
                      <div className="mt-1 font-semibold leading-5">{place.label} · {place.team}팀 · {place.quarter}분기 · {workKinds.find((item) => item.value === place.kind)?.label}</div>
                    </div>
                    {place.kind === "quarter" && <div>
                      <div className="font-black text-slate-400">최근 점검 비교</div>
                      {inspectionSnapshots.length ? <div className="mt-1 space-y-2">
                        {inspectionSnapshots.map((snapshot, index) => <div key={`${place.id}-history-${snapshot.date}-${index}`} className="rounded-md border border-slate-100 bg-slate-50 p-2">
                          <div className="font-black text-slate-800">{index === 0 ? "최근 방문" : "이전 방문"} · {snapshot.date}</div>
                          <div className="mt-1 space-y-0.5 text-[11px] font-semibold text-slate-600"><div>매수: {snapshot.counts || "기록 없음"}</div><div>토너잔량: {snapshot.toner || "기록 없음"}</div><div>여분: {snapshot.spare || "기록 없음"}</div>{snapshot.spareLocation && <div>여분 위치: {snapshot.spareLocation}</div>}</div>
                        </div>)}
                        {inspectionSnapshots.length > 1 && <div className="space-y-1"><div className="flex flex-wrap gap-1"><span className="rounded bg-blue-50 px-2 py-1 text-[11px] font-black text-blue-700">흑백 사용 {blackDiff === null ? "계산 불가" : `${blackDiff.toLocaleString()}매`}</span><span className="rounded bg-rose-50 px-2 py-1 text-[11px] font-black text-rose-700">컬러 사용 {colorDiff === null ? "계산 불가" : `${colorDiff.toLocaleString()}매`}</span></div>{tonerChanges.length > 0 && <div className="text-[11px] font-bold text-slate-600">토너 변화: {tonerChanges.join(" · ")}</div>}{spareChanges.length > 0 && <div className="text-[11px] font-bold text-slate-600">여분 변화: {spareChanges.join(" · ")}</div>}</div>}
                      </div> : <div className="mt-1 font-semibold text-slate-400">연결된 점검 기록이 없습니다.</div>}
                    </div>}
                    <div>
                      <div className="font-black text-slate-400">메모</div>
                      {place.memos.length ? (
                        <div className="mt-1 divide-y divide-slate-100 border-y border-slate-100">
                          {place.memos.map((memo, index) => <div key={`${place.id}-${index}`} className="whitespace-pre-wrap py-2 font-semibold leading-5">{memo}</div>)}
                        </div>
                      ) : <div className="mt-1 font-semibold text-slate-400">기록된 메모가 없습니다.</div>}
                    </div>
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
      <MapCanvas places={mapPlaces} selectedId={selectedId} team={teamFilter} viewStorageKey={`${preferenceStorageKey}_views`} onSelect={selectMapPlace} currentPosition={currentPosition} />
      <div className="absolute left-14 top-3 z-[900] w-[145px] sm:w-[240px]">
        <div className="relative">
          <input
            value={mapQuery}
            onChange={(event) => setMapQuery(event.target.value)}
            onFocus={() => setMapSearchFocused(true)}
            onBlur={() => window.setTimeout(() => setMapSearchFocused(false), 120)}
            placeholder="거래처 검색"
            className="w-full rounded-md border border-slate-200 bg-white/95 px-3 py-2.5 pr-9 text-sm font-semibold shadow-lg outline-none focus:border-blue-500"
          />
          {mapQuery && <button type="button" onClick={() => setMapQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 px-1 text-sm font-black text-slate-400">×</button>}
          {mapSearchFocused && mapQuery.trim() && (
            <div className="absolute left-0 right-0 top-[calc(100%+4px)] max-h-[280px] overflow-y-auto overscroll-contain rounded-md border border-slate-200 bg-white shadow-2xl">
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
        className={`absolute left-3 top-[5.75rem] z-[900] flex h-10 w-10 items-center justify-center rounded-md border text-xl font-black shadow-lg ${locationTracking ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700"}`}
      >
        <LocateFixed size={19} strokeWidth={2.4} />
      </button>
      <div className="absolute right-3 top-3 z-[900]">
        <div className="relative flex gap-1">
          <button type="button" onClick={() => { setConditionMenuOpen((current) => !current); setColorMenuOpen(false); setProgressMenuOpen(false); }} className={`rounded-md border px-2 py-2.5 text-[11px] font-black shadow-lg sm:px-3 sm:text-xs ${conditionMenuOpen || kindFilter !== "ALL" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700"}`}>조건</button>
          <button type="button" onClick={() => { setColorMenuOpen((current) => !current); setConditionMenuOpen(false); setProgressMenuOpen(false); }} className={`rounded-md border px-2 py-2.5 text-[11px] font-black shadow-lg sm:px-3 sm:text-xs ${colorMenuOpen || labelFilters.length ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700"}`}>색상{labelFilters.length ? ` ${labelFilters.length}` : ""}</button>
          <button type="button" onClick={() => { setProgressMenuOpen((current) => !current); setConditionMenuOpen(false); setColorMenuOpen(false); }} className={`rounded-md border px-2 py-2.5 text-[11px] font-black shadow-lg sm:px-3 sm:text-xs ${progressMenuOpen ? "border-blue-700 bg-blue-700 text-white" : "border-slate-200 bg-white text-slate-700"}`}>진행률</button>

          {conditionMenuOpen && (
            <div className="absolute right-0 top-12 z-[1200] w-[280px] rounded-md border border-slate-200 bg-white p-3 shadow-2xl">
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
            <div className="absolute right-0 top-12 z-[1200] w-[250px] rounded-md border border-slate-200 bg-white p-3 shadow-2xl">
              <button type="button" onClick={() => setLabelFilters([])} className={`mb-2 w-full rounded px-3 py-2 text-left text-xs font-black ${labelFilters.length === 0 ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>전체 색상</button>
              <div className="grid grid-cols-3 gap-2">
                {mapLabels.map((item) => (
                  <button key={item.code} type="button" onClick={() => setLabelFilters((current) => current.includes(item.code) ? current.filter((code) => code !== item.code) : [...current, item.code])} title={item.name} className={`flex items-center gap-2 rounded border px-2 py-2 text-xs font-black ${labelFilters.includes(item.code) ? "border-slate-900 bg-slate-100" : "border-slate-200 bg-white"}`}>
                    <span className="h-4 w-4 rounded-full" style={{ backgroundColor: item.color }} />{item.code}
                  </button>
                ))}
              </div>
            </div>
          )}

          {progressMenuOpen && (
            <div className="absolute right-0 top-12 z-[1200] max-h-[calc(100dvh-230px)] w-[370px] max-w-[calc(100vw-24px)] overflow-y-auto overscroll-contain rounded-md border border-slate-200 bg-white p-4 pb-6 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-black text-slate-950">{progressQuarter}분기 팀별 진행률</div>
                  <div className="mt-0.5 text-[10px] font-bold text-slate-400">{progressYear}년 · 남은 영업일 {daysToQuarterEnd}일</div>
                </div>
                <button type="button" onClick={() => setProgressMenuOpen(false)} className="h-7 w-7 rounded text-lg font-black text-slate-400 hover:bg-slate-100">×</button>
              </div>
              <div className="mt-3 space-y-3">
                {teamProgress.map((item) => {
                  const inspectionRate = item.inspectionTotal ? Math.round((item.inspectionDone / item.inspectionTotal) * 100) : 0;
                  const renewalRate = item.renewalTotal ? Math.round((item.renewalDone / item.renewalTotal) * 100) : 0;
                  const remaining = Math.max(0, item.inspectionTotal - item.inspectionDone);
                  return (
                    <div key={item.team} className="rounded-md border border-slate-200 p-3">
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
                            ? <div key={grade} className="flex items-start gap-1.5 text-[11px] font-black leading-4 text-slate-800"><span className="shrink-0 rounded bg-emerald-100 px-1.5 text-emerald-700">{grade}</span><span className="min-w-0">{renewal.place.name}<span className="ml-1 text-rose-600">{renewal.end.date}</span></span></div>
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
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm max-lg:rounded-none max-lg:border-0 max-lg:shadow-none">
        {desktopLayout ? <div className="grid h-[calc(100vh-145px)] min-h-[620px] grid-cols-[340px_minmax(0,1fr)]">
          {placeList}
          {mapPanel}
        </div> : <div className="flex h-[calc(100dvh-68px)] min-h-[440px] flex-col">
          <div className="relative min-h-0 flex-1 overflow-hidden">{mobileView === "map" ? mapPanel : placeList}</div>
          <div className="grid shrink-0 grid-cols-2 border-t border-slate-200 bg-white shadow-[0_-3px_10px_rgba(15,23,42,0.08)]">
            <button type="button" onClick={() => setMobileView("map")} className={`pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-xs font-black ${mobileView === "map" ? "bg-blue-50 text-blue-700" : "bg-white text-slate-500"}`}>지도</button>
            <button type="button" onClick={() => { selectionSourceRef.current = "other"; setMobileView("list"); }} className={`pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-xs font-black ${mobileView === "list" ? "bg-blue-50 text-blue-700" : "bg-white text-slate-500"}`}>목록</button>
          </div>
        </div>}
      </section>

      {mobileDetail && !desktopLayout && (() => {
        const { place, snapshots, blackDiff, colorDiff, tonerChanges, spareChanges } = mobileDetail;
        const meta = labelMeta(place.label);
        const address = [place.address, place.addressDetail].filter(Boolean).join(" ");
        const phone = place.phone.match(/0\d{1,2}-?\d{3,4}-?\d{4}/)?.[0] || "";
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
            <section className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-start gap-3 border-b border-slate-100 px-4 py-4">
              <span className="text-xl text-slate-400">⌖</span>
              <div className="whitespace-pre-wrap text-sm font-bold leading-6">{address || "주소 정보 없음"}</div>
              {address && <a href={`https://map.naver.com/p/search/${encodeURIComponent(address)}`} target="_blank" rel="noreferrer" className="rounded-full border border-slate-300 px-3 py-2 text-xs font-black text-slate-600">길찾기</a>}
            </section>
            <section className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-start gap-3 border-b-8 border-slate-100 px-4 py-4">
              <span className="text-xl text-slate-400">☎</span>
              <div className="whitespace-pre-wrap text-sm font-bold leading-6">{place.phone || "연락처 정보 없음"}</div>
              {phone && <a href={`tel:${phone.replace(/[^0-9]/g, "")}`} className="rounded-full border border-slate-300 px-3 py-2 text-xs font-black text-slate-600">전화</a>}
            </section>
            <section className="border-b-8 border-slate-100 px-4 py-4">
              <div className="text-xs font-black text-slate-400">업무 정보</div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs font-black"><span className="rounded bg-slate-100 px-2 py-1">{place.team}팀</span><span className="rounded bg-slate-100 px-2 py-1">{place.quarter}분기</span><span className="rounded px-2 py-1 text-white" style={{ backgroundColor: meta.color }}>{place.label}</span><span className="rounded bg-slate-100 px-2 py-1">{workKinds.find((item) => item.value === place.kind)?.label}</span></div>
            </section>
            {place.kind === "quarter" && <section className="border-b-8 border-slate-100 px-4 py-4">
              <div className="text-xs font-black text-slate-400">최근 점검 비교</div>
              {snapshots.length ? <div className="mt-3 space-y-3">
                {snapshots.map((snapshot, index) => <div key={`${place.id}-mobile-${snapshot.date}-${index}`} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0"><div className="text-sm font-black">{index === 0 ? "최근 방문" : "이전 방문"} · {snapshot.date}</div><div className="mt-1 space-y-1 text-xs font-semibold leading-5 text-slate-600"><div>매수: {snapshot.counts || "기록 없음"}</div><div>토너잔량: {snapshot.toner || "기록 없음"}</div><div>여분: {snapshot.spare || "기록 없음"}</div>{snapshot.spareLocation && <div>여분 위치: {snapshot.spareLocation}</div>}</div></div>)}
                {snapshots.length > 1 && <div className="space-y-2"><div className="flex flex-wrap gap-2"><span className="rounded bg-blue-50 px-2 py-1 text-xs font-black text-blue-700">흑백 {blackDiff === null ? "계산 불가" : `${blackDiff.toLocaleString()}매 사용`}</span><span className="rounded bg-rose-50 px-2 py-1 text-xs font-black text-rose-700">컬러 {colorDiff === null ? "계산 불가" : `${colorDiff.toLocaleString()}매 사용`}</span></div>{tonerChanges.length > 0 && <div className="text-xs font-bold text-slate-600">토너 변화: {tonerChanges.join(" · ")}</div>}{spareChanges.length > 0 && <div className="text-xs font-bold text-slate-600">여분 변화: {spareChanges.join(" · ")}</div>}</div>}
              </div> : <div className="mt-2 text-sm font-semibold text-slate-400">연결된 점검 기록이 없습니다.</div>}
            </section>}
            <section className="px-4 py-4">
              <div className="text-xs font-black text-slate-400">메모</div>
              {place.memos.length ? <div className="mt-2 divide-y divide-slate-100">{place.memos.map((memo, index) => <div key={`${place.id}-mobile-memo-${index}`} className="whitespace-pre-wrap py-3 text-sm font-semibold leading-6">{memo}</div>)}</div> : <div className="mt-2 text-sm font-semibold text-slate-400">기록된 메모가 없습니다.</div>}
            </section>
          </main>
        </div>;
      })()}

      {pendingImport.length > 0 && (
        <div className="fixed inset-0 z-[2100] flex items-end bg-slate-950/45 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setPendingImport([])}>
          <div className="w-full rounded-t-xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-lg" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-black text-blue-600">엑셀 불러오기</div>
                <div className="mt-1 text-lg font-black text-slate-950">거래처 {pendingImport.length}곳</div>
              </div>
              <button type="button" onClick={() => setPendingImport([])} className="h-9 w-9 rounded-md text-xl font-black text-slate-400">×</button>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <label className="text-xs font-black text-slate-500">팀<select value={importTeam} onChange={(event) => setImportTeam(event.target.value as Team)} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2.5 text-sm">{teams.map((item) => <option key={item} value={item}>{item}팀</option>)}</select></label>
              <label className="text-xs font-black text-slate-500">분기<select value={importQuarter} onChange={(event) => setImportQuarter(Number(event.target.value) as Quarter)} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2.5 text-sm">{quarters.map((item) => <option key={item} value={item}>{item}분기</option>)}</select></label>
              <label className="text-xs font-black text-slate-500">업무<select value={importKind} onChange={(event) => setImportKind(event.target.value as WorkKind)} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2.5 text-sm">{workKinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 rounded-md bg-slate-100 p-1">
              <button type="button" onClick={() => setImportMode("replace")} className={`rounded px-3 py-2 text-xs font-black ${importMode === "replace" ? "bg-white text-slate-950 shadow" : "text-slate-500"}`}>같은 목록 교체</button>
              <button type="button" onClick={() => setImportMode("append")} className={`rounded px-3 py-2 text-xs font-black ${importMode === "append" ? "bg-white text-slate-950 shadow" : "text-slate-500"}`}>기존 목록에 추가</button>
            </div>
            <button type="button" onClick={() => void applyExcelImport()} className="mt-5 w-full rounded-md bg-blue-600 px-4 py-3 text-sm font-black text-white">불러오기 적용</button>
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
              <button type="button" onClick={() => setDraft(null)} className="h-9 w-9 rounded-md text-xl font-black text-slate-400 hover:bg-slate-100">×</button>
            </div>

            <div className="grid gap-4 p-4 lg:grid-cols-2">
              <label className="text-xs font-black text-slate-500">번호<input type="number" value={draft.number} onChange={(event) => setDraft({ ...draft, number: Number(event.target.value) })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm text-slate-900" /></label>
              <div className="lg:col-span-2">
                <div className="text-xs font-black text-slate-500">라벨</div>
                <div className="mt-1.5 grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
                  {mapLabels.map((item) => {
                    const active = draft.label === item.code;
                    return <button
                      key={item.code}
                      type="button"
                      onClick={() => setDraft({ ...draft, label: item.code })}
                      className={`min-h-12 rounded-md border px-2 py-1.5 text-left transition ${active ? "border-slate-950 ring-2 ring-slate-300" : "border-slate-200 hover:border-slate-400"}`}
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
              <label className="text-xs font-black text-slate-500">담당 팀<select value={draft.team || "C"} onChange={(event) => setDraft({ ...draft, team: event.target.value as Team })} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900">{teams.map((item) => <option key={item} value={item}>{item}팀</option>)}</select></label>
              <label className="text-xs font-black text-slate-500">분기<select value={draft.quarter || 3} onChange={(event) => setDraft({ ...draft, quarter: Number(event.target.value) as Quarter })} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900">{quarters.map((item) => <option key={item} value={item}>{item}분기</option>)}</select></label>
              <label className="text-xs font-black text-slate-500 lg:col-span-2">업무<select value={draft.kind || "quarter"} onChange={(event) => setDraft({ ...draft, kind: event.target.value as WorkKind })} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900">{workKinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label className="flex items-center gap-2 text-sm font-black text-slate-600 lg:col-span-2"><input type="checkbox" checked={draft.visible} onChange={(event) => setDraft({ ...draft, visible: event.target.checked })} className="h-4 w-4 accent-blue-600" />지도에서 표시</label>
              <label className="text-xs font-black text-slate-500 lg:col-span-2">이름<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm text-slate-900" /></label>
              <label className="text-xs font-black text-slate-500 lg:col-span-2">코멘트<input value={draft.comment} onChange={(event) => setDraft({ ...draft, comment: event.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm text-slate-900" /></label>
              <label className="text-xs font-black text-slate-500">전화번호<input value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm text-slate-900" /></label>
              <label className="text-xs font-black text-slate-500">주소<input value={draft.address} onChange={(event) => setDraft({ ...draft, address: event.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm text-slate-900" /></label>
              <label className="text-xs font-black text-slate-500 lg:col-span-2">상세주소<input value={draft.addressDetail} onChange={(event) => setDraft({ ...draft, addressDetail: event.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm text-slate-900" /></label>
              <label className="text-xs font-black text-slate-500">위도<input type="number" step="0.000001" value={draft.latitude} onChange={(event) => setDraft({ ...draft, latitude: Number(event.target.value) })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm text-slate-900" /></label>
              <label className="text-xs font-black text-slate-500">경도<input type="number" step="0.000001" value={draft.longitude} onChange={(event) => setDraft({ ...draft, longitude: Number(event.target.value) })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm text-slate-900" /></label>

              <div className="lg:col-span-2">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-black text-slate-500">메모 {draft.memos.length}개</div>
                  <button type="button" onClick={() => setDraft({ ...draft, memos: [...draft.memos, ""] })} className="rounded-md border border-blue-200 px-3 py-1.5 text-xs font-black text-blue-600">+ 메모 추가</button>
                </div>
                <div className="space-y-2">
                  {draft.memos.map((memo, index) => (
                    <div key={index} className="flex gap-2">
                      <input value={memo} onChange={(event) => setDraft({ ...draft, memos: draft.memos.map((item, memoIndex) => memoIndex === index ? event.target.value : item) })} placeholder={`메모${index + 1}`} className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2.5 text-sm" />
                      <button type="button" aria-label={`메모${index + 1} 삭제`} onClick={() => setDraft({ ...draft, memos: draft.memos.filter((_, memoIndex) => memoIndex !== index) })} className="h-10 w-10 rounded-md border border-slate-200 text-lg font-black text-slate-400">×</button>
                    </div>
                  ))}
                  {!draft.memos.length && <button type="button" onClick={() => setDraft({ ...draft, memos: [""] })} className="w-full rounded-md border border-dashed border-slate-300 py-4 text-sm font-black text-slate-400">메모 추가</button>}
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 flex gap-2 border-t border-slate-200 bg-white p-4">
              <button type="button" onClick={deleteDraft} className="rounded-md border border-rose-200 px-4 py-2.5 text-sm font-black text-rose-600">삭제</button>
              <button type="button" onClick={saveDraft} disabled={!draft.name.trim()} className="ml-auto rounded-md bg-blue-600 px-5 py-2.5 text-sm font-black text-white disabled:opacity-40">저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
