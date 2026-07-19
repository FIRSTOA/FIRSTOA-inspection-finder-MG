import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

type MapLabel = {
  code: string;
  name: string;
  color: string;
};

type MapPlace = {
  id: number;
  number: number;
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

function loadPlaces() {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
    return Array.isArray(stored) && stored.length ? stored as MapPlace[] : initialPlaces;
  } catch {
    return initialPlaces;
  }
}

function blankPlace(number: number): MapPlace {
  return {
    id: Date.now(), number, label: "G1", visible: true, name: "", comment: "", phone: "",
    address: "", addressDetail: "", latitude: 37.5665, longitude: 126.978, memos: [],
  };
}

function MapCanvas({ places, selectedId, onSelect }: { places: MapPlace[]; selectedId: number | null; onSelect: (id: number) => void }) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!elementRef.current || mapRef.current) return;
    const map = L.map(elementRef.current, { zoomControl: true, minZoom: 6 }).setView([36.2, 127.8], 7);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    markerLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    window.setTimeout(() => map.invalidateSize(), 50);
    return () => {
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
    const bounds: L.LatLngExpression[] = [];
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
      bounds.push([place.latitude, place.longitude]);
    });
    if (!bounds.length) map.setView([36.2, 127.8], 7);
    else if (bounds.length === 1) map.setView(bounds[0], 13);
    else map.fitBounds(L.latLngBounds(bounds), { padding: [42, 42], maxZoom: 13 });
  }, [places, selectedId, onSelect]);

  return <div ref={elementRef} className="h-full min-h-[520px] w-full bg-slate-100" aria-label="전국 거래처 지도" />;
}

export default function WalkingMap() {
  const [places, setPlaces] = useState<MapPlace[]>(loadPlaces);
  const [query, setQuery] = useState("");
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(places[0]?.id || null);
  const [mobileView, setMobileView] = useState<"map" | "list">("map");
  const [editMode, setEditMode] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [checkedIds, setCheckedIds] = useState<number[]>([]);
  const [draft, setDraft] = useState<MapPlace | null>(null);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(places));
  }, [places]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return places.filter((place) => {
      if (!place.visible && !showHidden) return false;
      if (labelFilter && place.label !== labelFilter) return false;
      if (!keyword) return true;
      return [place.name, place.comment, place.phone, place.address, place.addressDetail, ...place.memos]
        .some((value) => value.toLowerCase().includes(keyword));
    });
  }, [places, query, labelFilter, showHidden]);

  const mapPlaces = useMemo(() => filtered.filter((place) => place.visible), [filtered]);

  const selected = places.find((place) => place.id === selectedId) || null;
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

  const placeList = (
    <div className="flex min-h-0 flex-col bg-white">
      <div className="border-b border-slate-200 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-black text-slate-950">거래처 {filtered.length}곳</div>
            <div className="text-xs font-semibold text-slate-400">이름·기기·주소·전화번호 검색</div>
          </div>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => setShowHidden((current) => !current)} className={`rounded-md px-2.5 py-2 text-xs font-black ${showHidden ? "bg-slate-200 text-slate-800" : "border border-slate-200 bg-white text-slate-500"}`}>숨김 포함</button>
            <button type="button" onClick={() => { setEditMode((current) => !current); setCheckedIds([]); }} className={`rounded-md px-3 py-2 text-xs font-black ${editMode ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>
              {editMode ? "편집 종료" : "목록 편집"}
            </button>
          </div>
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
                  <span className="mt-1 block text-[11px] font-bold" style={{ color: meta.color }}>{place.label} · {meta.name}{!place.visible ? " · 지도 숨김" : ""}</span>
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
    <div className="relative h-full min-h-[620px] overflow-hidden bg-slate-100">
      <MapCanvas places={mapPlaces} selectedId={selectedId} onSelect={setSelectedId} />
      {selected && mapPlaces.some((place) => place.id === selected.id) && (
        <div className="absolute bottom-3 left-3 right-3 z-[500] rounded-lg border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur sm:left-auto sm:w-[360px]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-black" style={{ color: labelMeta(selected.label).color }}>{selected.label} · {labelMeta(selected.label).name}</div>
              <div className="mt-1 truncate text-sm font-black text-slate-950">{selected.name}</div>
              <div className="mt-1 text-xs font-semibold text-slate-500">{selected.address} {selected.addressDetail}</div>
            </div>
            <button type="button" onClick={() => setDraft({ ...selected, memos: [...selected.memos] })} className="shrink-0 rounded-md bg-slate-900 px-3 py-2 text-xs font-black text-white">수정</button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {selected.memos.slice(0, 4).map((memo, index) => <span key={`${memo}-${index}`} className="rounded bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600">{memo}</span>)}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-3 lg:p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="text-xs font-black text-blue-600">WORKIN MAP</div>
              <h2 className="mt-0.5 text-xl font-black text-slate-950 lg:text-2xl">CS 워킨맵</h2>
            </div>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1 xl:w-[360px]">
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="거래처, 기기, 주소, 전화번호 검색" className="w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 pr-9 text-sm font-semibold outline-none focus:border-blue-500" />
                {query && <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 px-1 text-sm font-black text-slate-400">×</button>}
              </div>
              <button type="button" onClick={() => setDraft(blankPlace(Math.max(0, ...places.map((place) => place.number)) + 1))} className="shrink-0 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-black text-white">+ 추가</button>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1">
            <button type="button" onClick={() => setLabelFilter(null)} className={`shrink-0 rounded-md px-3 py-2 text-xs font-black ${labelFilter === null ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>전체 {places.filter((place) => place.visible).length}</button>
            {mapLabels.map((item) => {
              const count = places.filter((place) => place.visible && place.label === item.code).length;
              return (
                <button key={item.code} type="button" onClick={() => setLabelFilter(labelFilter === item.code ? null : item.code)} title={item.name} className={`flex shrink-0 items-center gap-2 rounded-md border px-2.5 py-2 text-xs font-black ${labelFilter === item.code ? "border-slate-900 bg-slate-50 text-slate-950" : "border-slate-200 bg-white text-slate-600"}`}>
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />{item.code} <span className="text-slate-400">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="hidden h-[calc(100vh-230px)] min-h-[680px] grid-cols-[340px_minmax(0,1fr)] lg:grid">
          {placeList}
          {mapPanel}
        </div>

        <div className="lg:hidden">
          <div className="h-[calc(100dvh-250px)] min-h-[560px]">{mobileView === "map" ? mapPanel : placeList}</div>
          <div className="grid grid-cols-2 border-t border-slate-200 bg-white">
            <button type="button" onClick={() => setMobileView("map")} className={`py-3 text-sm font-black ${mobileView === "map" ? "bg-blue-50 text-blue-700" : "text-slate-500"}`}>지도</button>
            <button type="button" onClick={() => setMobileView("list")} className={`py-3 text-sm font-black ${mobileView === "list" ? "bg-blue-50 text-blue-700" : "text-slate-500"}`}>목록</button>
          </div>
        </div>
      </section>

      {draft && (
        <div className="fixed inset-0 z-[130] flex items-end bg-slate-950/45 p-0 lg:items-center lg:justify-center lg:p-5" onMouseDown={() => setDraft(null)}>
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
