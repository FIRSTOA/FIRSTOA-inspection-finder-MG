/**
 * 자동일정 후보 미니 지도 — 추가하기 전에 "대충 어디쯤인지" 보이게 (내 일정 지도와 같은 엔진: 카카오 → 실패 시 Leaflet).
 * 마커 숫자 = 후보 목록 순번(가까운 순). 마커를 누르면 그 후보가 선택/해제되고 이름 라벨이 뜬다. 기준 업체는 빨간 핀.
 */
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { loadKakaoMaps, type KakaoNS } from "./kakaoMap";

export type CandidatePoint = { id: number; lat: number; lng: number; name: string; rank: number; picked: boolean; distanceKm?: number | null };

const markerHtml = (rank: number, picked: boolean) =>
  `<div style="width:24px;height:24px;border-radius:50%;background:${picked ? "#2563eb" : "#0f172a"};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:11px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)">${rank}</div>`;
const anchorHtml = `<div style="width:14px;height:14px;border-radius:50%;background:#dc2626;border:3px solid #fff;box-shadow:0 0 0 3px rgba(220,38,38,.35)"></div>`;
const escapeHtml = (value: string) => value.replace(/[<>&]/g, "");
const labelHtml = (p: CandidatePoint) =>
  `<div style="background:#fff;border:1px solid #cbd5e1;border-radius:8px;padding:4px 8px;font-size:11px;font-weight:700;color:#0f172a;box-shadow:0 3px 10px rgba(0,0,0,.15);white-space:nowrap;transform:translateY(-30px)">${p.rank}. ${escapeHtml(p.name.slice(0, 22))}${p.distanceKm != null ? ` · ${p.distanceKm < 1 ? `${Math.round(p.distanceKm * 1000)}m` : `${p.distanceKm}km`}` : ""}</div>`;

export default function CandidateMap({ anchor, points, onToggle, height = 230 }: {
  anchor: { lat: number; lng: number; name: string } | null;
  points: CandidatePoint[];
  onToggle?: (id: number) => void;
  height?: number;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<{ map: L.Map; layer: L.LayerGroup } | null>(null);
  const kakaoRef = useRef<{ ns: KakaoNS; map: KakaoNS } | null>(null);
  const kakaoObjects = useRef<KakaoNS[]>([]);
  const [engine, setEngine] = useState<"" | "kakao" | "leaflet">("");

  useEffect(() => {
    if (!elRef.current || leafletRef.current || kakaoRef.current) return;
    let cancelled = false;
    void loadKakaoMaps().then((kakao) => {
      if (cancelled || !elRef.current) return;
      if (kakao) {
        const map = new kakao.maps.Map(elRef.current, { center: new kakao.maps.LatLng(37.55, 127.0), level: 8 });
        kakaoRef.current = { ns: kakao, map };
        setEngine("kakao");
      } else {
        const map = L.map(elRef.current, { zoomControl: true }).setView([37.55, 127.0], 11);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 19 }).addTo(map);
        leafletRef.current = { map, layer: L.layerGroup().addTo(map) };
        setEngine("leaflet");
      }
    });
    return () => {
      cancelled = true;
      if (leafletRef.current) { leafletRef.current.map.remove(); leafletRef.current = null; }
      kakaoRef.current = null;
      kakaoObjects.current = [];
    };
  }, []);

  useEffect(() => {
    const shown = points.slice(0, 60); // 마커 60개 넘게 그리면 지도가 점으로 덮인다 — 목록 '더 보기'와 같은 감각
    if (engine === "leaflet" && leafletRef.current) {
      const { map, layer } = leafletRef.current;
      layer.clearLayers();
      const bounds: [number, number][] = [];
      if (anchor) {
        L.marker([anchor.lat, anchor.lng], { icon: L.divIcon({ className: "", html: anchorHtml, iconSize: [14, 14], iconAnchor: [7, 7] }), zIndexOffset: 1000 })
          .addTo(layer).bindTooltip(`📍 ${anchor.name.slice(0, 20)}`);
        bounds.push([anchor.lat, anchor.lng]);
      }
      shown.forEach((p) => {
        const icon = L.divIcon({ className: "", html: markerHtml(p.rank, p.picked), iconSize: [24, 24], iconAnchor: [12, 12] });
        L.marker([p.lat, p.lng], { icon }).addTo(layer).bindTooltip(`${p.rank}. ${p.name.slice(0, 22)}`).on("click", () => onToggle?.(p.id));
        if (p.rank <= 30) bounds.push([p.lat, p.lng]);
      });
      if (bounds.length) map.fitBounds(L.latLngBounds(bounds), { padding: [24, 24], maxZoom: 14 });
      return;
    }
    if (engine !== "kakao" || !kakaoRef.current) return;
    const { ns: kakao, map } = kakaoRef.current;
    for (const obj of kakaoObjects.current) obj.setMap(null);
    kakaoObjects.current = [];
    const bounds = new kakao.maps.LatLngBounds();
    let count = 0;
    let label: KakaoNS | null = null;
    if (anchor) {
      const pos = new kakao.maps.LatLng(anchor.lat, anchor.lng);
      const el = document.createElement("div"); el.innerHTML = anchorHtml; el.title = anchor.name;
      const overlay = new kakao.maps.CustomOverlay({ position: pos, content: el, yAnchor: 0.5, zIndex: 50 });
      overlay.setMap(map); kakaoObjects.current.push(overlay);
      bounds.extend(pos); count += 1;
    }
    shown.forEach((p) => {
      const pos = new kakao.maps.LatLng(p.lat, p.lng);
      const el = document.createElement("div");
      el.innerHTML = markerHtml(p.rank, p.picked);
      el.style.cursor = "pointer";
      el.title = `${p.rank}. ${p.name}`;
      el.onclick = () => {
        if (label) { label.setMap(null); label = null; }
        const box = document.createElement("div"); box.innerHTML = labelHtml(p);
        label = new kakao.maps.CustomOverlay({ position: pos, content: box, yAnchor: 1, zIndex: 60 });
        label.setMap(map); kakaoObjects.current.push(label);
        onToggle?.(p.id);
      };
      const overlay = new kakao.maps.CustomOverlay({ position: pos, content: el, yAnchor: 0.5, zIndex: 10 + p.rank });
      overlay.setMap(map); kakaoObjects.current.push(overlay);
      if (p.rank <= 30) { bounds.extend(pos); count += 1; }
    });
    if (count) map.setBounds(bounds, 28, 28, 28, 28);
  }, [engine, anchor, points, onToggle]);

  return (
    <div className="relative">
      <div ref={elRef} style={{ height }} className="w-full bg-slate-100" />
      <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-white/90 px-2 py-1 text-[10px] font-black text-slate-600 shadow">
        숫자 = 후보 순번(가까운 순) · 마커 클릭 = 선택 {anchor ? "· 🔴 기준 업체" : ""}
      </div>
    </div>
  );
}
