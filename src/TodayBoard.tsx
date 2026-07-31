/**
 * 금일 현황판 — 오늘 일정을 지도·구별 집계·담당자 추천으로 한눈에 본다.
 *
 * 일정(as_tickets)에는 좌표가 없고 주소도 대부분 비어 있어, 업체명으로 워킨맵
 * (workin_map_places, 좌표 99%·주소 82% 보유)을 매칭해 위치와 구를 얻는다.
 * 추천은 "그 구에 오늘 이미 가는 담당자"를 뽑는 것 — 동선이 겹치는 사람에게 붙인다.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { selectAllRows } from "./supabase";

type BoardTicket = {
  id: string; vendor: string; team: string; time: string; status: string;
  scheduleType: string; assignee: string; issue: string; address: string;
};
type Place = { name: string; latitude: number | null; longitude: number | null; address: string | null };

const norm = (value: string) => String(value || "").toUpperCase().replace(/[^가-힣A-Z0-9]/g, "");
const districtOf = (address: string) => (String(address || "").match(/([가-힣]+[구군])/) || [])[1] || "";

// 상태별 마커 색 — 미배정을 가장 눈에 띄게 (지금 사람을 붙여야 하는 건)
const MARKER_COLOR: Record<string, string> = { 미배정: "#e11d48", 배정: "#2563eb", 완료: "#94a3b8", 익일: "#7c3aed" };
const stateOf = (ticket: BoardTicket) =>
  ticket.status === "완료" ? "완료" : ticket.status === "익일" ? "익일" : ticket.assignee ? "배정" : "미배정";

export default function TodayBoard({ tickets, onOpenTicket, onAssign, assigneesOf }: {
  tickets: BoardTicket[];
  onOpenTicket: (id: string) => void;
  onAssign: (ticket: BoardTicket, name: string) => void;
  assigneesOf: (team: string) => string[];
}) {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem("today_board_open_v1") !== "0"; } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem("today_board_open_v1", open ? "1" : "0"); } catch { /* 무시 */ } }, [open]);

  const [places, setPlaces] = useState<Place[] | null>(null);
  useEffect(() => {
    if (!open || places) return;
    void selectAllRows<Place>("workin_map_places", "select=name,latitude,longitude,address")
      .then(setPlaces)
      .catch(() => setPlaces([]));
  }, [open, places]);

  // 업체명 → 워킨맵 장소 (정확 일치 우선, 없으면 포함 관계에서 가장 긴 이름)
  const placeIndex = useMemo(() => {
    const exact = new Map<string, Place>();
    const list: Array<{ key: string; place: Place }> = [];
    for (const place of places || []) {
      if (!place.latitude || !place.longitude) continue;
      const key = norm(place.name);
      if (!key) continue;
      if (!exact.has(key)) exact.set(key, place);
      list.push({ key, place });
    }
    list.sort((a, b) => b.key.length - a.key.length);
    return { exact, list };
  }, [places]);

  const located = useMemo(() => tickets.map((ticket) => {
    const key = norm(ticket.vendor);
    let place = key ? placeIndex.exact.get(key) : undefined;
    if (!place && key.length >= 3) place = placeIndex.list.find((item) => item.key.includes(key) || key.includes(item.key))?.place;
    return { ticket, place, district: districtOf(ticket.address || place?.address || "") };
  }), [tickets, placeIndex]);

  const [district, setDistrict] = useState("전체");
  const districts = useMemo(() => {
    const counts = new Map<string, number>();
    located.forEach((item) => { if (item.district) counts.set(item.district, (counts.get(item.district) || 0) + 1); });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [located]);
  const visible = useMemo(() => (district === "전체" ? located : located.filter((item) => item.district === district)), [located, district]);

  const summary = useMemo(() => {
    const count = (state: string) => located.filter((item) => stateOf(item.ticket) === state).length;
    return { total: located.length, 미배정: count("미배정"), 배정: count("배정"), 완료: count("완료"), 지도: located.filter((item) => item.place).length };
  }, [located]);

  // 미배정 건 추천: 같은 구에 오늘 일정이 있는 담당자를 건수 순으로
  const suggestions = useMemo(() => {
    const byDistrict = new Map<string, Map<string, number>>();
    located.forEach(({ ticket, district: key }) => {
      if (!key || !ticket.assignee) return;
      const inner = byDistrict.get(key) || new Map<string, number>();
      inner.set(ticket.assignee, (inner.get(ticket.assignee) || 0) + 1);
      byDistrict.set(key, inner);
    });
    return visible
      .filter((item) => stateOf(item.ticket) === "미배정")
      .map((item) => ({
        ...item,
        candidates: Array.from(byDistrict.get(item.district)?.entries() || []).sort((a, b) => b[1] - a[1]).slice(0, 3),
      }));
  }, [located, visible]);

  // ── 지도 ──
  const elementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    if (!open || !elementRef.current || mapRef.current) return;
    const map = L.map(elementRef.current, { zoomControl: true, attributionControl: false, minZoom: 6 });
    map.setView([37.5045, 127.045], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, updateWhenIdle: true, attribution: "" }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    // 접기/펼치기로 컨테이너 크기가 바뀌면 타일이 깨져 보이므로 한 번 갱신
    window.setTimeout(() => map.invalidateSize(), 60);
    return () => { map.remove(); mapRef.current = null; layerRef.current = null; };
  }, [open]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    // 같은 좌표(같은 업체)에 여러 건이면 하나로 묶어 개수를 표시
    const groups = new Map<string, typeof visible>();
    visible.forEach((item) => {
      if (!item.place?.latitude || !item.place?.longitude) return;
      const key = `${item.place.latitude.toFixed(5)},${item.place.longitude.toFixed(5)}`;
      groups.set(key, [...(groups.get(key) || []), item]);
    });
    const points: L.LatLngExpression[] = [];
    groups.forEach((group) => {
      const first = group[0];
      const position: L.LatLngExpression = [first.place!.latitude!, first.place!.longitude!];
      points.push(position);
      const worst = group.some((item) => stateOf(item.ticket) === "미배정") ? "미배정"
        : group.some((item) => stateOf(item.ticket) === "배정") ? "배정" : stateOf(first.ticket);
      const icon = L.divIcon({
        className: "today-board-marker",
        html: `<span style="position:relative;display:block;width:20px;height:20px;background:${MARKER_COLOR[worst]};border:3px solid white;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 8px rgba(15,23,42,.35)">${group.length > 1 ? `<b style="position:absolute;right:-11px;top:-11px;display:flex;width:17px;height:17px;align-items:center;justify-content:center;border-radius:9px;background:#0f172a;color:#fff;font:700 10px sans-serif;transform:rotate(45deg)">${group.length}</b>` : ""}</span>`,
        iconSize: [26, 26], iconAnchor: [13, 25],
      });
      L.marker(position, { icon, title: group.map((item) => `${item.ticket.time} ${item.ticket.vendor}`).join("\n") })
        .addTo(layer)
        .on("click", () => onOpenTicket(first.ticket.id));
    });
    if (points.length) map.fitBounds(L.latLngBounds(points).pad(0.25), { maxZoom: 14 });
  }, [visible, onOpenTicket]);

  const chip = "rounded-md px-2.5 py-1 text-[11px] font-black";
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <button type="button" onClick={() => setOpen((current) => !current)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-black text-slate-950">금일 현황판</span>
          <span className={`${chip} bg-slate-100 text-slate-600`}>총 {summary.total}</span>
          {summary.미배정 > 0 && <span className={`${chip} bg-rose-50 text-rose-600`}>미배정 {summary.미배정}</span>}
          <span className={`${chip} bg-blue-50 text-blue-700`}>배정 {summary.배정}</span>
          <span className={`${chip} bg-emerald-50 text-emerald-700`}>완료 {summary.완료}</span>
        </span>
        <span className="shrink-0 text-[11px] font-black text-slate-400">{open ? "접기" : "펼치기"}</span>
      </button>

      {open && <div className="border-t border-slate-100 p-4">
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] font-black text-slate-400">지역구</span>
          <button type="button" onClick={() => setDistrict("전체")} className={`${chip} ${district === "전체" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>전체 {located.length}</button>
          {districts.map(([name, count]) => (
            <button key={name} type="button" onClick={() => setDistrict(name)} className={`${chip} ${district === name ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>{name} {count}</button>
          ))}
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
          <div>
            <div ref={elementRef} className="h-[300px] w-full overflow-hidden rounded-md border border-slate-200 bg-slate-100 lg:h-[360px]" />
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] font-bold text-slate-400">
              {(["미배정", "배정", "완료", "익일"] as const).map((state) => (
                <span key={state} className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: MARKER_COLOR[state] }} />{state}
                </span>
              ))}
              <span className="ml-auto">지도 표시 {summary.지도}/{summary.total} · 좌표는 워킨맵 기준</span>
            </div>
          </div>

          <div className="min-w-0">
            <div className="text-[11px] font-black text-slate-500">미배정 {suggestions.length}건 — 같은 구에 가는 담당자 추천</div>
            <div className="mt-1.5 max-h-[330px] space-y-1.5 overflow-y-auto pr-0.5">
              {suggestions.map(({ ticket, district: key, candidates }) => (
                <div key={ticket.id} className="rounded-md border border-slate-200 p-2">
                  <button type="button" onClick={() => onOpenTicket(ticket.id)} className="block w-full text-left">
                    <div className="flex items-center gap-1.5">
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-600">{ticket.team}팀</span>
                      <span className="truncate text-xs font-black text-slate-900">{ticket.vendor || "업체 미기재"}</span>
                      <span className="shrink-0 text-[10px] font-bold text-slate-400">{key || "구 미확인"}</span>
                    </div>
                    {ticket.issue && <div className="mt-0.5 truncate text-[10px] font-semibold text-slate-500">{ticket.issue}</div>}
                  </button>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {candidates.length > 0
                      ? candidates.map(([name, count]) => (
                        <button key={name} type="button" onClick={() => onAssign(ticket, name)} className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-black text-blue-700 hover:bg-blue-100">{name} <span className="text-blue-400">{key} {count}건</span></button>
                      ))
                      : <span className="text-[10px] font-bold text-slate-400">같은 구 일정 없음 —</span>}
                    {candidates.length === 0 && assigneesOf(ticket.team).slice(0, 3).map((name) => (
                      <button key={name} type="button" onClick={() => onAssign(ticket, name)} className="rounded-md border border-slate-200 px-2 py-1 text-[10px] font-black text-slate-600 hover:bg-slate-50">{name}</button>
                    ))}
                  </div>
                </div>
              ))}
              {!suggestions.length && <div className="rounded-md border border-dashed border-slate-200 p-6 text-center text-[11px] font-bold text-slate-400">{district === "전체" ? "미배정 일정이 없습니다." : `${district}에 미배정 일정이 없습니다.`}</div>}
            </div>
          </div>
        </div>
      </div>}
    </section>
  );
}
