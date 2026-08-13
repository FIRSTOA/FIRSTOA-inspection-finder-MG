/**
 * 내 일정 — 내게 배정된 하루 일정을 미니지도(절반) + 순서 리스트(절반)로 본다.
 * 좌표는 워킨맵 핀에서 업체명 매칭으로 가져온다 (워킨맵에 없는 곳은 리스트에만).
 * 순서: [고정]을 누른 순서대로 앞에 서고, 나머지는 마지막 고정 지점에서
 * 가까운 순(최근접 이웃)으로 자동 배치된다 — 동선 체크용.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { selectAllRows } from "./supabase";
import { vendorMatchKey } from "./ids";
import { kstDate } from "./visits";
import { kakaoMapRouteLink, kakaoMapSearchLink, isMobileDevice } from "./navApp";
import { getVendorFlagsBatch, type VendorWorkFlags } from "./vendorFlags";
import { geocodeKR } from "./geocode";
import { loadKakaoMaps, type KakaoNS } from "./kakaoMap";

export type MyPlanTicket = {
  id: string; date: string; time: string; team: string; vendor: string; address: string;
  assignee: string; status: string; scheduleType: string; issue?: string;
};

type Geo = { lat: number; lng: number };

function distKm(a: Geo, b: Geo): number {
  return Math.sqrt(Math.pow((a.lat - b.lat) * 111, 2) + Math.pow((a.lng - b.lng) * 88, 2));
}

export default function MyPlan({ tickets, author }: { tickets: MyPlanTicket[]; author: string }) {
  const [date, setDate] = useState(kstDate());
  const [geoByKey, setGeoByKey] = useState<Map<string, Geo>>(new Map());
  const [includeUnassigned, setIncludeUnassigned] = useState(false);
  const [flags, setFlags] = useState<Map<string, VendorWorkFlags>>(new Map());
  const storageKey = `cs_myplan_order_${date}_${author}`;
  const [pinned, setPinned] = useState<string[]>([]);
  useEffect(() => {
    try { setPinned(JSON.parse(localStorage.getItem(storageKey) || "[]")); } catch { setPinned([]); }
  }, [storageKey]);
  const savePinned = (next: string[]) => {
    setPinned(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* 무시 */ }
  };

  // 워킨맵 좌표 사전 — 업체명 정규화 키로 매칭 (팀 무관 전체, 한 번만)
  useEffect(() => {
    void selectAllRows<{ name: string; latitude: number | null; longitude: number | null }>(
      "workin_map_places", "select=name,latitude,longitude",
    ).then((rows) => {
      const map = new Map<string, Geo>();
      for (const row of rows) {
        if (row.latitude == null || row.longitude == null) continue;
        const key = vendorMatchKey(row.name || "");
        if (key && !map.has(key)) map.set(key, { lat: row.latitude, lng: row.longitude });
      }
      setGeoByKey(map);
    }).catch(() => {});
  }, []);

  // 워킨맵에 없는 업체(AS 일정 등)는 일정의 주소를 지오코딩해 좌표를 채운다 (카카오)
  const [geoFallback, setGeoFallback] = useState<Map<string, Geo>>(new Map());
  const lookupGeo = useCallback((vendor: string): Geo | null => {
    const key = vendorMatchKey(vendor);
    if (!key) return null;
    const exact = geoByKey.get(key);
    if (exact) return exact;
    for (let len = key.length - 1; len >= 4; len--) {
      const hit = geoByKey.get(key.slice(0, len));
      if (hit) return hit;
    }
    // 워킨맵 이름이 더 긴 경우(꼬리표) — 앞부분 일치 탐색
    for (const [candidate, geo] of geoByKey) {
      if (candidate.length >= 4 && candidate.startsWith(key)) return geo;
    }
    return null;
  }, [geoByKey]);

  useEffect(() => {
    const vendors = [...new Set(tickets.map((t) => t.vendor).filter(Boolean))];
    if (!vendors.length) return;
    void getVendorFlagsBatch(vendors).then(setFlags).catch(() => {});
  }, [tickets]);

  const myTickets = useMemo(() => tickets.filter((t) =>
    t.date === date && t.status !== "완료"
    && (t.assignee === author || (includeUnassigned && !t.assignee))
  ), [tickets, date, author, includeUnassigned]);

  const getGeo = useCallback((t: MyPlanTicket): Geo | null => {
    const fromMap = lookupGeo(t.vendor);
    if (fromMap) return fromMap;
    const fb = geoFallback.get(t.id);
    return fb && Number.isFinite(fb.lat) ? fb : null;
  }, [lookupGeo, geoFallback]);

  useEffect(() => {
    let stop = false;
    void (async () => {
      for (const t of myTickets) {
        if (stop) return;
        if (lookupGeo(t.vendor) || geoFallback.has(t.id) || !t.address?.trim()) continue;
        const hit = await geocodeKR(t.address);
        if (stop) return;
        if (hit) setGeoFallback((cur) => new Map(cur).set(t.id, { lat: hit.lat, lng: hit.lng }));
        else setGeoFallback((cur) => new Map(cur).set(t.id, { lat: NaN, lng: NaN })); // 재시도 방지 표식
      }
    })();
    return () => { stop = true; };
    // geoFallback을 deps에 넣으면 무한 루프 — has() 체크로 중복 호출을 막는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTickets, lookupGeo]);

  // 순서: 고정(클릭 순) 먼저 → 나머지는 마지막 고정 지점 기준 최근접 이웃
  const ordered = useMemo(() => {
    const byId = new Map(myTickets.map((t) => [t.id, t]));
    const head = pinned.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
    const rest = myTickets.filter((t) => !pinned.includes(t.id));
    const withGeo = rest.filter((t) => getGeo(t));
    const noGeo = rest.filter((t) => !getGeo(t));
    const route: MyPlanTicket[] = [...head];
    let cursor: Geo | null = null;
    for (let i = head.length - 1; i >= 0; i--) {
      const g = getGeo(head[i]);
      if (g) { cursor = g; break; }
    }
    const pool = [...withGeo];
    while (pool.length) {
      let bestIdx = 0;
      if (cursor) {
        let best = Infinity;
        pool.forEach((t, i) => {
          const d = distKm(cursor!, getGeo(t)!);
          if (d < best) { best = d; bestIdx = i; }
        });
      }
      const next = pool.splice(bestIdx, 1)[0];
      route.push(next);
      cursor = getGeo(next);
    }
    return [...route, ...noGeo];
  }, [myTickets, pinned, getGeo]);

  // ── 지도: 카카오맵 우선, SDK 로드 실패(도메인 미등록 미리보기 등) 시 Leaflet 폴백 ──
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const kakaoRef = useRef<{ ns: KakaoNS; map: KakaoNS } | null>(null);
  const kakaoObjectsRef = useRef<KakaoNS[]>([]);
  const [engine, setEngine] = useState<"" | "kakao" | "leaflet">("");
  useEffect(() => {
    if (!mapElRef.current || mapRef.current || kakaoRef.current) return;
    let cancelled = false;
    void loadKakaoMaps().then((kakao) => {
      if (cancelled || !mapElRef.current) return;
      if (kakao) {
        const map = new kakao.maps.Map(mapElRef.current, { center: new kakao.maps.LatLng(37.55, 127.0), level: 9 });
        kakaoRef.current = { ns: kakao, map };
        setEngine("kakao");
      } else {
        const map = L.map(mapElRef.current, { zoomControl: true }).setView([37.55, 127.0], 11);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 19 }).addTo(map);
        layerRef.current = L.layerGroup().addTo(map);
        mapRef.current = map;
        setEngine("leaflet");
      }
    });
    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; layerRef.current = null; }
      kakaoRef.current = null;
      kakaoObjectsRef.current = [];
    };
  }, []);
  // 같은 건물(같은 좌표) 일정이 겹치면 안 보인다 — 작은 원형으로 흩어서 전부 보이게
  const markerRef = useRef<Map<string, L.Marker>>(new Map());
  const displayGeo = useMemo(() => {
    const byCoord = new Map<string, MyPlanTicket[]>();
    for (const t of ordered) {
      const g = getGeo(t);
      if (!g) continue;
      const key = `${g.lat.toFixed(5)},${g.lng.toFixed(5)}`;
      byCoord.set(key, [...(byCoord.get(key) || []), t]);
    }
    const out = new Map<string, Geo>();
    for (const group of byCoord.values()) {
      group.forEach((t, i) => {
        const g = getGeo(t)!;
        if (group.length === 1 || i === 0) { out.set(t.id, g); return; }
        const angle = (2 * Math.PI * i) / group.length;
        out.set(t.id, { lat: g.lat + 0.00022 * Math.sin(angle), lng: g.lng + 0.00028 * Math.cos(angle) });
      });
    }
    return out;
  }, [ordered, getGeo]);

  const markerHtml = (i: number, isPinned: boolean) =>
    `<div style="width:26px;height:26px;border-radius:50%;background:${isPinned ? "#2563eb" : "#0f172a"};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;border:2px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.4)">${i + 1}</div>`;
  const popupHtml = (i: number, t: MyPlanTicket) =>
    `<b>${i + 1}. ${t.vendor}</b><br/><span style="font-size:11px">${t.time || ""} ${t.scheduleType}${t.issue ? `<br/>${String(t.issue).slice(0, 60)}` : ""}</span>`;

  useEffect(() => {
    if (engine === "leaflet") {
      const map = mapRef.current, layer = layerRef.current;
      if (!map || !layer) return;
      layer.clearLayers();
      markerRef.current.clear();
      const points: [number, number][] = [];
      ordered.forEach((t, i) => {
        const g = displayGeo.get(t.id);
        if (!g) return;
        points.push([g.lat, g.lng]);
        const icon = L.divIcon({ className: "", html: markerHtml(i, pinned.includes(t.id)), iconSize: [26, 26], iconAnchor: [13, 13] });
        const marker = L.marker([g.lat, g.lng], { icon }).addTo(layer).bindPopup(popupHtml(i, t));
        markerRef.current.set(t.id, marker);
      });
      if (points.length >= 2) L.polyline(points, { color: "#2563eb", weight: 3, opacity: 0.65, dashArray: "6 6" }).addTo(layer);
      if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 14 });
      return;
    }
    if (engine !== "kakao" || !kakaoRef.current) return;
    const { ns: kakao, map } = kakaoRef.current;
    for (const obj of kakaoObjectsRef.current) obj.setMap(null);
    kakaoObjectsRef.current = [];
    kakaoMarkerRef.current.clear();
    const path: KakaoNS[] = [];
    const bounds = new kakao.maps.LatLngBounds();
    let infoOverlay: KakaoNS | null = null;
    ordered.forEach((t, i) => {
      const g = displayGeo.get(t.id);
      if (!g) return;
      const pos = new kakao.maps.LatLng(g.lat, g.lng);
      path.push(pos);
      bounds.extend(pos);
      const el = document.createElement("div");
      el.innerHTML = markerHtml(i, pinned.includes(t.id));
      el.style.cursor = "pointer";
      el.onclick = () => {
        if (infoOverlay) { infoOverlay.setMap(null); infoOverlay = null; }
        const box = document.createElement("div");
        box.style.cssText = "background:#fff;border:1px solid #cbd5e1;border-radius:10px;padding:8px 10px;font-size:12px;box-shadow:0 4px 14px rgba(0,0,0,.18);transform:translateY(-36px);max-width:220px";
        box.innerHTML = popupHtml(i, t);
        infoOverlay = new kakao.maps.CustomOverlay({ position: pos, content: box, yAnchor: 1, zIndex: 30 });
        infoOverlay.setMap(map);
        kakaoObjectsRef.current.push(infoOverlay);
      };
      const overlay = new kakao.maps.CustomOverlay({ position: pos, content: el, yAnchor: 0.5, zIndex: 10 + i });
      overlay.setMap(map);
      kakaoObjectsRef.current.push(overlay);
      kakaoMarkerRef.current.set(t.id, { pos, open: el.onclick as () => void });
    });
    if (path.length >= 2) {
      const line = new kakao.maps.Polyline({ path, strokeWeight: 3, strokeColor: "#2563eb", strokeOpacity: 0.65, strokeStyle: "shortdash" });
      line.setMap(map);
      kakaoObjectsRef.current.push(line);
    }
    if (path.length) map.setBounds(bounds, 40, 40, 40, 40);
  }, [engine, ordered, pinned, displayGeo]);

  const kakaoMarkerRef = useRef<Map<string, { pos: KakaoNS; open: () => void }>>(new Map());
  const focusTicket = (id: string) => {
    if (engine === "kakao" && kakaoRef.current) {
      const hit = kakaoMarkerRef.current.get(id);
      if (!hit) return;
      const { ns: kakao, map } = kakaoRef.current;
      if (map.getLevel() > 4) map.setLevel(4);
      map.panTo(new kakao.maps.LatLng(hit.pos.getLat(), hit.pos.getLng()));
      hit.open();
      return;
    }
    const map = mapRef.current;
    const marker = markerRef.current.get(id);
    if (!map || !marker) return;
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), 15), { animate: true });
    marker.openPopup();
  };

  const togglePin = (id: string) => {
    savePinned(pinned.includes(id) ? pinned.filter((p) => p !== id) : [...pinned, id]);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-black text-slate-700 outline-none" />
        <span className="text-xs font-black text-slate-500">{author}의 일정 {myTickets.length}건</span>
        <label className="flex items-center gap-1 text-[11px] font-bold text-slate-500">
          <input type="checkbox" checked={includeUnassigned} onChange={(e) => setIncludeUnassigned(e.target.checked)} className="h-3.5 w-3.5 accent-blue-600" />미배정 포함
        </label>
        {pinned.length > 0 && <button type="button" onClick={() => savePinned([])} className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[10px] font-black text-slate-500">순서 초기화</button>}
        <span className="ml-auto text-[10px] font-bold text-slate-400">[고정]을 누른 순서가 먼저, 나머지는 가까운 순 자동</span>
      </div>

      <div ref={mapElRef} className="h-[42vh] w-full overflow-hidden rounded-xl border border-slate-200" />

      <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {ordered.map((t, i) => {
          const g = getGeo(t);
          const isPinned = pinned.includes(t.id);
          const kakao = g ? kakaoMapRouteLink(t.vendor.slice(0, 30), g.lat, g.lng) : kakaoMapSearchLink(t.address || t.vendor);
          const f = flags.get(t.vendor.trim());
          return (
            <div key={t.id} onClick={() => focusTicket(t.id)} className={`flex items-center gap-2.5 px-3 py-2.5 transition ${g ? "cursor-pointer hover:bg-blue-50/40" : ""}`}>
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-black text-white ${isPinned ? "bg-blue-600" : "bg-slate-900"}`}>{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-black text-slate-900">{t.vendor}</span>
                  {t.time && <span className="shrink-0 font-mono text-[11px] font-bold text-slate-400">{t.time}</span>}
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500">{t.scheduleType}</span>
                  {!g && <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-black text-amber-700">지도 좌표 없음</span>}
                </span>
                {t.issue && <span className="mt-0.5 block truncate text-[11px] font-semibold text-slate-500">{t.issue}</span>}
                <span className="mt-0.5 block truncate text-[11px] font-semibold text-slate-400">{t.address || "주소 없음"}</span>
                {f && (
                  <span className="mt-1 flex flex-wrap gap-1">
                    {f.inspection && !f.inspection.done && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-black text-amber-700">점검 {f.inspection.quarter}분기</span>}
                    {f.inspection?.done && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-black text-slate-400">점검완료</span>}
                    {f.misu && !f.misu.cleared && <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[9px] font-black text-rose-600">미수{f.misu.months ? ` ${f.misu.months}개월` : ""}</span>}
                    {f.renewal && !f.renewal.done && <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[9px] font-black text-rose-600">재계약{f.renewal.due ? ` ${f.renewal.due}` : ""}</span>}
                    {f.overage && <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[9px] font-black text-purple-700">초과</span>}
                    {f.bulman && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-black text-red-700">불만 {f.bulman.date.slice(2, 4)}년 {Number(f.bulman.date.slice(5, 7))}월</span>}
                  </span>
                )}
              </span>
              <a href={kakao} onClick={(e) => e.stopPropagation()} {...(isMobileDevice ? {} : { target: "_blank", rel: "noreferrer" })} className="shrink-0 rounded-lg bg-[#FEE500] px-2 py-1.5 text-[11px] font-black text-slate-900">길찾기</a>
              <button type="button" onClick={(e) => { e.stopPropagation(); togglePin(t.id); }}
                className={`shrink-0 rounded-full px-2.5 py-1.5 text-[11px] font-black transition ${isPinned ? "bg-blue-600 text-white" : "border border-slate-300 bg-white text-slate-500 hover:bg-slate-50"}`}>
                {isPinned ? `고정 ${pinned.indexOf(t.id) + 1}` : "고정"}
              </button>
            </div>
          );
        })}
        {!ordered.length && <div className="p-10 text-center text-xs font-bold text-slate-400">{date}에 {author}에게 배정된 일정이 없습니다.</div>}
      </div>
    </div>
  );
}
