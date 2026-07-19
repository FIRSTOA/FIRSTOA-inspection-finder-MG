import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

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

const storageKey = "cs_workin_map_places_v2";
const excelHeaders = ["번호", "라벨", "지도에서", "이름", "코멘트", "전화번호", "주소", "상세주소", "위도", "경도", ...Array.from({ length: 15 }, (_, index) => `메모${index + 1}`)];
const teams: Team[] = ["A", "B", "C", "D"];
const quarters: Quarter[] = [1, 2, 3, 4];
const workKinds: { value: WorkKind; label: string }[] = [
  { value: "quarter", label: "분기점검" },
  { value: "monthly", label: "매월점검" },
  { value: "renewal", label: "재계약" },
];

const mapLabels: MapLabel[] = [
  { code: "G1", name: "신규·초기 방문", color: "#ff8458" },
  { code: "G2", name: "매월 점검", color: "#ffb51b" },
  { code: "G3", name: "분기 점검", color: "#ff2f68" },
  { code: "G4", name: "계약 종료 임박", color: "#b22998" },
  { code: "G5", name: "점검 완료", color: "#087fa2" },
  { code: "G6", name: "확장성 관리", color: "#25b44b" },
  { code: "G7", name: "미수·확인 필요", color: "#b56ef3" },
  { code: "G8", name: "교체·철수 예정", color: "#896347" },
  { code: "G9", name: "장기 관리", color: "#c6a273" },
  { code: "G10", name: "AS 집중 관리", color: "#139fe4" },
  { code: "G11", name: "휴면·보류", color: "#1f744a" },
  { code: "G12", name: "기타", color: "#343434" },
];

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

function loadPlaces() {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
    const source = Array.isArray(stored) && stored.length ? stored as MapPlace[] : initialPlaces;
    return source.map((place, index) => ({
      ...place,
      team: place.team || teams[index % teams.length],
      quarter: place.quarter || ((index % 4) + 1) as Quarter,
      kind: place.kind || workKinds[index % workKinds.length].value,
    }));
  } catch {
    return initialPlaces;
  }
}

function blankPlace(number: number): MapPlace {
  return {
    id: Date.now(), number, team: "C", quarter: 3, kind: "quarter", label: "G1", visible: true, name: "", comment: "", phone: "",
    address: "", addressDetail: "", latitude: 37.5665, longitude: 126.978, memos: [],
  };
}

function MapCanvas({ places, selectedId, onSelect }: { places: MapPlace[]; selectedId: number | null; onSelect: (id: number) => void }) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const [tilesReady, setTilesReady] = useState(false);

  useEffect(() => {
    if (!elementRef.current || mapRef.current) return;
    const map = L.map(elementRef.current, {
      zoomControl: true,
      minZoom: 6,
      maxBounds: [[32.5, 123.5], [39.5, 132]],
      maxBoundsViscosity: 0.8,
    }).setView([36.15, 127.85], 7);
    const tiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    });
    tiles.on("loading", () => setTilesReady(false));
    tiles.on("load", () => setTilesReady(true));
    tiles.addTo(map);
    markerLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    observer.observe(elementRef.current);
    window.setTimeout(() => map.invalidateSize({ pan: false }), 50);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      markerLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = markerLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    places.forEach((place) => {
      if (!Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) return;
      const meta = labelMeta(place.label);
      const icon = L.divIcon({
        className: "workin-map-marker",
        html: `<span style="display:block;width:${selectedId === place.id ? 25 : 21}px;height:${selectedId === place.id ? 25 : 21}px;background:${meta.color};border:3px solid white;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 8px rgba(15,23,42,.35)"></span>`,
        iconSize: [28, 28],
        iconAnchor: [14, 27],
      });
      const marker = L.marker([place.latitude, place.longitude], { icon }).addTo(layer);
      const tooltip = document.createElement("div");
      tooltip.className = "text-xs font-bold";
      tooltip.textContent = place.name;
      marker.bindTooltip(tooltip, { direction: "top", offset: [0, -22] });
      marker.on("click", () => onSelect(place.id));
    });
  }, [places, selectedId, onSelect]);

  return (
    <div className="relative h-full min-h-[500px] w-full bg-[#dce8ef]">
      <div ref={elementRef} className="h-full w-full" aria-label="전국 거래처 지도" />
      {!tilesReady && <div className="pointer-events-none absolute inset-0 z-[800] flex items-center justify-center bg-slate-100/75 text-sm font-black text-slate-500">지도 불러오는 중</div>}
    </div>
  );
}

export default function WalkingMap() {
  const [places, setPlaces] = useState<MapPlace[]>(loadPlaces);
  const [query, setQuery] = useState("");
  const [labelFilters, setLabelFilters] = useState<string[]>([]);
  const [teamFilter, setTeamFilter] = useState<Team>("C");
  const [quarterFilter, setQuarterFilter] = useState<Quarter>(() => (Math.floor(new Date().getMonth() / 3) + 1) as Quarter);
  const [kindFilter, setKindFilter] = useState<WorkKind | "ALL">("ALL");
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const [conditionMenuOpen, setConditionMenuOpen] = useState(false);
  const [progressMenuOpen, setProgressMenuOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(places[0]?.id || null);
  const [mobileView, setMobileView] = useState<"map" | "list">("map");
  const [editMode, setEditMode] = useState(false);
  const [checkedIds, setCheckedIds] = useState<number[]>([]);
  const [draft, setDraft] = useState<MapPlace | null>(null);
  const [pendingImport, setPendingImport] = useState<MapPlace[]>([]);
  const [importTeam, setImportTeam] = useState<Team>("C");
  const [importQuarter, setImportQuarter] = useState<Quarter>(3);
  const [importKind, setImportKind] = useState<WorkKind>("monthly");
  const [importMode, setImportMode] = useState<"append" | "replace">("replace");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(places));
  }, [places]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return places.filter((place) => {
      if (labelFilters.length && !labelFilters.includes(place.label)) return false;
      if (place.team !== teamFilter) return false;
      if (place.quarter !== quarterFilter) return false;
      if (kindFilter !== "ALL" && place.kind !== kindFilter) return false;
      if (!keyword) return true;
      return [place.name, place.comment, place.phone, place.address, place.addressDetail, ...place.memos]
        .some((value) => value.toLowerCase().includes(keyword));
    });
  }, [places, query, labelFilters, teamFilter, quarterFilter, kindFilter]);

  const mapPlaces = useMemo(() => filtered.filter((place) => place.visible), [filtered]);
  const progressQuarter = quarterFilter;
  const conditionTitle = `${teamFilter}팀 · ${quarterFilter}분기 · ${kindFilter === "ALL" ? "전체 워킨맵" : workKinds.find((item) => item.value === kindFilter)?.label}`;
  const teamProgress = useMemo(() => teams.map((team) => {
    const rows = places.filter((place) => place.team === team && place.quarter === progressQuarter);
    const inspections = rows.filter((place) => place.kind === "quarter" || place.kind === "monthly");
    const renewals = rows.filter((place) => place.kind === "renewal");
    return {
      team,
      inspectionDone: inspections.filter(isCompleted).length,
      inspectionTotal: inspections.length,
      renewalDone: renewals.filter(isCompleted).length,
      renewalTotal: renewals.length,
    };
  }), [places, progressQuarter]);

  const allVisibleChecked = filtered.length > 0 && filtered.every((place) => checkedIds.includes(place.id));

  const saveDraft = () => {
    if (!draft || !draft.name.trim()) return;
    setPlaces((current) => current.some((place) => place.id === draft.id)
      ? current.map((place) => place.id === draft.id ? draft : place)
      : [...current, draft]);
    setSelectedId(draft.id);
    setDraft(null);
  };

  const deleteDraft = () => {
    if (!draft || !places.some((place) => place.id === draft.id)) return setDraft(null);
    if (!window.confirm("이 거래처를 워킨맵에서 삭제할까요?")) return;
    setPlaces((current) => current.filter((place) => place.id !== draft.id));
    setSelectedId(null);
    setDraft(null);
  };

  const bulkSetLabel = (label: string) => {
    setPlaces((current) => current.map((place) => checkedIds.includes(place.id) ? { ...place, label } : place));
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
      const headerIndexes = new Map(headers.map((header, index) => [String(header || "").trim(), index]));
      const required = ["번호", "라벨", "지도에서", "이름", "위도", "경도"];
      if (required.some((header) => !headerIndexes.has(header))) {
        window.alert("워킨맵 엑셀 형식이 아닙니다. 번호·라벨·지도에서·이름·위도·경도 헤더를 확인해 주세요.");
        return;
      }
      const rows: Record<string, string | number>[] = [];
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const values: Record<string, string | number> = {};
        excelHeaders.forEach((header) => {
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
        memos: Array.from({ length: 15 }, (_, memoIndex) => String(row[`메모${memoIndex + 1}`] || "").replaceAll("_x000d_", "\n").trim()).filter(Boolean),
      })).filter((place) => place.name));
    } catch (error) {
      console.error(error);
      const detail = error instanceof Error ? error.message : String(error);
      window.alert(`엑셀 파일을 읽지 못했습니다.\n${detail}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const applyExcelImport = () => {
    const imported = pendingImport.map((place) => ({ ...place, team: importTeam, quarter: importQuarter, kind: importKind }));
    setPlaces((current) => importMode === "replace"
      ? [...current.filter((place) => !(place.team === importTeam && place.quarter === importQuarter && place.kind === importKind)), ...imported]
      : [...current, ...imported]);
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
      for (let index = 0; index < 15; index += 1) values[`메모${index + 1}`] = place.memos[index] || "";
      return values;
    });
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("워킨맵", { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.addRow(excelHeaders);
    rows.forEach((row) => sheet.addRow(excelHeaders.map((header) => row[header] ?? "")));
    sheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });
    sheet.columns.forEach((column, index) => {
      const header = excelHeaders[index];
      column.width = header?.startsWith("메모") ? 24 : ["이름", "코멘트", "전화번호", "주소", "상세주소"].includes(header) ? 32 : 12;
    });
    sheet.autoFilter = { from: "A1", to: "Y1" };
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
          <div className="text-sm font-black text-slate-950">거래처 {filtered.length}곳</div>
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
          return (
            <div key={place.id} className={`group flex items-start gap-3 px-3 py-3 ${!place.visible ? "opacity-55" : ""} ${selectedId === place.id ? "bg-blue-50" : "bg-white hover:bg-slate-50"}`}>
              <button type="button" onClick={() => editMode ? toggleChecked(place.id) : setSelectedId(place.id)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
                {editMode ? (
                  <span className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-sm font-black ${checked ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-slate-300"}`}>✓</span>
                ) : (
                  <span className="mt-1 h-4 w-4 shrink-0 rounded-full border-2 border-white shadow" style={{ backgroundColor: meta.color }} />
                )}
                <span className="min-w-0">
                  <span className="block text-sm font-black leading-5 text-slate-900">{place.name}</span>
                  <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">{place.comment || place.address}</span>
                  <span className="mt-1 block text-[11px] font-bold" style={{ color: meta.color }}>{place.label} · {place.team}팀 · {place.quarter}Q · {workKinds.find((item) => item.value === place.kind)?.label}{!place.visible ? " · 지도 숨김" : ""}</span>
                </span>
              </button>
              {!editMode && <button type="button" onClick={() => setDraft({ ...place, memos: [...place.memos] })} className="rounded-md border border-slate-200 px-2 py-1.5 text-xs font-black text-slate-500 opacity-100 lg:opacity-0 lg:group-hover:opacity-100">수정</button>}
            </div>
          );
        })}
        {!filtered.length && <div className="p-10 text-center text-sm font-semibold text-slate-400">검색 결과가 없습니다.</div>}
      </div>
    </div>
  );

  const mapPanel = (
    <div className="relative h-full min-h-[540px] overflow-hidden bg-slate-100">
      <MapCanvas places={mapPlaces} selectedId={selectedId} onSelect={setSelectedId} />
      <div className="absolute left-14 top-3 z-[900] w-[145px] sm:w-[240px]">
        <div className="relative">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="거래처 검색" className="w-full rounded-md border border-slate-200 bg-white/95 px-3 py-2.5 pr-9 text-sm font-semibold shadow-lg outline-none focus:border-blue-500" />
          {query && <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 px-1 text-sm font-black text-slate-400">×</button>}
        </div>
      </div>
      <div className="absolute right-3 top-3 z-[900]">
        <div className="relative flex gap-1">
          <button type="button" onClick={() => { setConditionMenuOpen((current) => !current); setColorMenuOpen(false); setProgressMenuOpen(false); }} className={`rounded-md border px-2 py-2.5 text-[11px] font-black shadow-lg sm:px-3 sm:text-xs ${conditionMenuOpen || kindFilter !== "ALL" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700"}`}>조건</button>
          <button type="button" onClick={() => { setColorMenuOpen((current) => !current); setConditionMenuOpen(false); setProgressMenuOpen(false); }} className={`rounded-md border px-2 py-2.5 text-[11px] font-black shadow-lg sm:px-3 sm:text-xs ${colorMenuOpen || labelFilters.length ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700"}`}>색상{labelFilters.length ? ` ${labelFilters.length}` : ""}</button>
          <button type="button" onClick={() => { setProgressMenuOpen((current) => !current); setConditionMenuOpen(false); setColorMenuOpen(false); }} className={`rounded-md border px-2 py-2.5 text-[11px] font-black shadow-lg sm:px-3 sm:text-xs ${progressMenuOpen ? "border-blue-700 bg-blue-700 text-white" : "border-slate-200 bg-white text-slate-700"}`}>진행률</button>

          {conditionMenuOpen && (
            <div className="absolute right-0 top-12 w-[280px] rounded-md border border-slate-200 bg-white p-3 shadow-2xl">
              <div className="text-[11px] font-black text-slate-400">담당 팀</div>
              <div className="mt-1.5 grid grid-cols-4 gap-1">
                {teams.map((item) => <button key={item} type="button" onClick={() => setTeamFilter(item)} className={`rounded px-2 py-1.5 text-xs font-black ${teamFilter === item ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>{item}</button>)}
              </div>
              <div className="mt-3 text-[11px] font-black text-slate-400">분기</div>
              <div className="mt-1.5 grid grid-cols-4 gap-1">
                {quarters.map((item) => <button key={item} type="button" onClick={() => setQuarterFilter(item)} className={`rounded px-2 py-1.5 text-xs font-black ${quarterFilter === item ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>{item}Q</button>)}
              </div>
              <div className="mt-3 text-[11px] font-black text-slate-400">업무</div>
              <div className="mt-1.5 grid grid-cols-2 gap-1">
                <button type="button" onClick={() => setKindFilter("ALL")} className={`rounded px-2 py-1.5 text-xs font-black ${kindFilter === "ALL" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>전체</button>
                {workKinds.map((item) => <button key={item.value} type="button" onClick={() => setKindFilter(item.value)} className={`rounded px-2 py-1.5 text-xs font-black ${kindFilter === item.value ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>{item.label}</button>)}
              </div>
            </div>
          )}

          {colorMenuOpen && (
            <div className="absolute right-0 top-12 w-[250px] rounded-md border border-slate-200 bg-white p-3 shadow-2xl">
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
            <div className="absolute right-0 top-12 w-[310px] max-w-[calc(100vw-24px)] rounded-md border border-slate-200 bg-white p-4 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-black text-slate-950">{progressQuarter}분기 팀별 진행률</div>
                  <div className="mt-0.5 text-[10px] font-bold text-slate-400">G5 완료 + G12 다음 분기 이관 기준</div>
                </div>
                <button type="button" onClick={() => setProgressMenuOpen(false)} className="h-7 w-7 rounded text-lg font-black text-slate-400 hover:bg-slate-100">×</button>
              </div>
              <div className="mt-3 space-y-3">
                {teamProgress.map((item) => {
                  const inspectionRate = item.inspectionTotal ? Math.round((item.inspectionDone / item.inspectionTotal) * 100) : 0;
                  const renewalRate = item.renewalTotal ? Math.round((item.renewalDone / item.renewalTotal) * 100) : 0;
                  return (
                    <div key={item.team} className="rounded-md border border-slate-200 p-3">
                      <div className="mb-2 text-xs font-black text-slate-900">{item.team}팀</div>
                      <div className="grid grid-cols-[54px_1fr_72px] items-center gap-2 text-[11px]">
                        <span className="font-black text-slate-600">점검</span>
                        <span className="h-1.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-blue-600" style={{ width: `${inspectionRate}%` }} /></span>
                        <span className="text-right font-black text-slate-700">{item.inspectionDone}/{item.inspectionTotal} · {inspectionRate}%</span>
                        <span className="font-black text-slate-600">재계약</span>
                        <span className="h-1.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${renewalRate}%` }} /></span>
                        <span className="text-right font-black text-slate-700">{item.renewalDone}/{item.renewalTotal} · {renewalRate}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="hidden h-[calc(100vh-145px)] min-h-[620px] grid-cols-[340px_minmax(0,1fr)] lg:grid">
          {placeList}
          {mapPanel}
        </div>

        <div className="lg:hidden">
          <div className="h-[calc(100dvh-150px)] min-h-[520px]">{mobileView === "map" ? mapPanel : placeList}</div>
          <div className="grid grid-cols-2 border-t border-slate-200 bg-white">
            <button type="button" onClick={() => setMobileView("map")} className={`py-3 text-sm font-black ${mobileView === "map" ? "bg-blue-50 text-blue-700" : "text-slate-500"}`}>지도</button>
            <button type="button" onClick={() => setMobileView("list")} className={`py-3 text-sm font-black ${mobileView === "list" ? "bg-blue-50 text-blue-700" : "text-slate-500"}`}>목록</button>
          </div>
        </div>
      </section>

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
            <button type="button" onClick={applyExcelImport} className="mt-5 w-full rounded-md bg-blue-600 px-4 py-3 text-sm font-black text-white">불러오기 적용</button>
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
              <label className="text-xs font-black text-slate-500">라벨<select value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900">{mapLabels.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}</select></label>
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
                  <div className="text-xs font-black text-slate-500">메모 {draft.memos.length}/15</div>
                  <button type="button" disabled={draft.memos.length >= 15} onClick={() => setDraft({ ...draft, memos: [...draft.memos, ""] })} className="rounded-md border border-blue-200 px-3 py-1.5 text-xs font-black text-blue-600 disabled:opacity-40">+ 메모 추가</button>
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
