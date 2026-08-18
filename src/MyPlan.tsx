/**
 * 내 일정 — 내게 배정된 하루 일정을 미니지도(절반) + 순서 리스트(절반)로 본다.
 * 좌표는 워킨맵 핀에서 업체명 매칭으로 가져온다 (워킨맵에 없는 곳은 리스트에만).
 * 순서: [고정]을 누른 순서대로 앞에 서고, 나머지는 마지막 고정 지점에서
 * 가까운 순(최근접 이웃)으로 자동 배치된다 — 동선 체크용.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { selectAllRows } from "./supabase";
import { fieldTicketVendor, vendorMatchKey } from "./ids";
import { kstDate } from "./visits";
import { defaultPlanDate, nextBusinessDay } from "./planDate";
import { kakaoMapRouteLink, kakaoMapSearchLink, isMobileDevice } from "./navApp";
import { getVendorFlagsBatch, type VendorWorkFlags } from "./vendorFlags";
import { getInspForms, getRecentInspections, leaseAddressOf, type InspectionSnapshot, type InspForm } from "./api";
import { selectRows } from "./supabase";
import VendorSearch from "./VendorSearch";
import { notify } from "./toast";
import { spareNeedItems, usageSpareAdvice } from "./spareAdvice";
import { geocodeKR } from "./geocode";
import { loadKakaoMaps, type KakaoNS } from "./kakaoMap";

export type MyPlanTicket = {
  id: string; date: string; time: string; team: string; vendor: string; address: string;
  assignee: string; status: string; scheduleType: string; issue?: string;
  contact?: string; model?: string; serial?: string; asset?: string; grade?: string; keyman?: string; note?: string;
  source?: string; receptionId?: string;
};

// 자동일정 생성 건은 분기점검 워킨맵에서 온 것 — 저장 유형(매월점검) 대신 실제 의미로 표시
function planTypeLabel(t: MyPlanTicket): string {
  if (t.source === "autoplan") return t.scheduleType === "AS" ? "재계약" : "분기점검";
  return t.scheduleType;
}

type Geo = { lat: number; lng: number };

function distKm(a: Geo, b: Geo): number {
  return Math.sqrt(Math.pow((a.lat - b.lat) * 111, 2) + Math.pow((a.lng - b.lng) * 88, 2));
}

export default function MyPlan({ tickets, author, onSelfRequest, onUseField, onLoadForm, onRemove }: { tickets: MyPlanTicket[]; author: string; onSelfRequest?: (text: string) => void; onUseField?: (fieldText: string, ticket?: { id: string; receptionId?: string; vendor?: string }) => void; onLoadForm?: (rawText: string, ticket?: { id: string; receptionId?: string; vendor?: string }) => void; onRemove?: (ticket: MyPlanTicket) => void }) {
  const [date, setDate] = useState(defaultPlanDate()); // 오후 4시 이후엔 다음 영업일이 기본 (내일 일정 짜는 시간)
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
  const [workinMeta, setWorkinMeta] = useState<Map<string, { comment: string; phone: string; memos: string[] }>>(new Map());
  useEffect(() => {
    void selectAllRows<{ name: string; latitude: number | null; longitude: number | null; comment: string | null; phone: string | null; memos: unknown }>(
      "workin_map_places", "select=name,latitude,longitude,comment,phone,memos",
    ).then((rows) => {
      const map = new Map<string, Geo>();
      const meta = new Map<string, { comment: string; phone: string; memos: string[] }>();
      for (const row of rows) {
        const key = vendorMatchKey(row.name || "");
        if (!key) continue;
        if (row.latitude != null && row.longitude != null && !map.has(key)) map.set(key, { lat: row.latitude, lng: row.longitude });
        if (!meta.has(key)) meta.set(key, {
          comment: String(row.comment || ""),
          phone: String(row.phone || ""),
          memos: Array.isArray(row.memos) ? (row.memos as unknown[]).map(String) : [],
        });
      }
      setGeoByKey(map);
      setWorkinMeta(meta);
    }).catch(() => {});
  }, []);

  const lookupMeta = useCallback((vendor: string) => {
    const key = vendorMatchKey(vendor);
    if (!key) return null;
    const exact = workinMeta.get(key);
    if (exact) return exact;
    for (let len = key.length - 1; len >= 4; len--) {
      const hit = workinMeta.get(key.slice(0, len));
      if (hit) return hit;
    }
    for (const [candidate, meta] of workinMeta) {
      if (candidate.length >= 4 && candidate.startsWith(key)) return meta;
    }
    return null;
  }, [workinMeta]);

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

  /**
   * 좌표는 "이 일정의 주소"가 1순위 — 업체명 매칭은 주소가 없을 때만.
   * 같은 업체가 여러 사업장을 쓰는 경우(빅오션이엔엠: 일산·청담·덕양빌딩)에 이름으로 찾으면
   * 엉뚱한 지점 좌표가 붙는다(강남 일정이 일산에 찍히던 사고).
   */
  const getGeo = useCallback((t: MyPlanTicket): Geo | null => {
    const fb = geoFallback.get(t.id);
    if (fb && Number.isFinite(fb.lat)) return fb;
    if (t.address?.trim()) return null;      // 주소가 있으면 그 주소로 잡힐 때까지 기다린다(이름 매칭 금지)
    return lookupGeo(t.vendor);
  }, [lookupGeo, geoFallback]);

  useEffect(() => {
    let stop = false;
    void (async () => {
      for (const t of myTickets) {
        if (stop) return;
        if (geoFallback.has(t.id)) continue;
        if (!t.address?.trim() && lookupGeo(t.vendor)) continue; // 주소 없는 건만 이름 매칭에 맡긴다
        // 주소가 비어 있으면 임대리스트에서 실납품 주소를 끌어온다 — 전엔 그냥 건너뛰어 지도에 안 올랐다
        const address = t.address?.trim() || await leaseAddressOf(t.vendor);
        if (stop) return;
        if (!address) { setGeoFallback((cur) => new Map(cur).set(t.id, { lat: NaN, lng: NaN })); continue; }
        const hit = await geocodeKR(address);
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
  // 카카오 오버레이는 nowrap을 상속해 긴 제목이 지도 밖까지 한 줄로 뻗었다 — 줄바꿈을 명시하고
  // 업체명은 캘린더 제목 원문(구분·모델·마감 꼬리표 포함)이라 회사명만 잘라 쓴다
  const popupName = (vendor: string) => {
    const clean = fieldTicketVendor(vendor).vendor.trim() || String(vendor || "").replace(/_x000d_|\r|\n/g, " ").trim();
    return (clean.length > 26 ? `${clean.slice(0, 26)}…` : clean).replace(/[<>&]/g, "");
  };
  const popupHtml = (i: number, t: MyPlanTicket) =>
    `<div style="white-space:normal;word-break:keep-all;line-height:1.45;max-width:200px">`
    + `<b>${i + 1}. ${popupName(t.vendor)}</b><br/><span style="font-size:11px;color:#475569">${t.time || ""} ${planTypeLabel(t)}`
    + `${t.issue ? `<br/>${String(t.issue).replace(/[<>&]/g, "").slice(0, 50)}` : ""}</span></div>`;

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
        box.style.cssText = "background:#fff;border:1px solid #cbd5e1;border-radius:10px;padding:8px 10px;font-size:12px;box-shadow:0 4px 14px rgba(0,0,0,.18);transform:translateY(-36px);max-width:220px;white-space:normal;word-break:keep-all";
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

  // FIELD 양식 불러오기 — ①시리얼·자산기번 ②업체명(정확→토큰 축소)으로 자동 목록,
  // 그래도 없으면 같은 모달에서 직접 검색(필드탭과 동일)으로 전환
  const [fieldPick, setFieldPick] = useState<{ ticket: MyPlanTicket; forms: InspForm[] | null; mode: "auto" | "search" } | null>(null);
  const openFieldPick = (t: MyPlanTicket) => {
    setFieldPick({ ticket: t, forms: null, mode: "auto" });
    void (async () => {
      try {
        const rawForms: Array<Record<string, unknown> & { __gubun: string }> = [];
        const fetchRaw = async (filter: string) => {
          const [insp, as] = await Promise.all([
            selectRows<Record<string, unknown>>("jeomgeom", `select=${encodeURIComponent("작성일,_업체명,모델명,시리얼넘버,자산기번,내용,처리내용,_원문")}&_hidden=not.is.true&${filter}&order=id.desc&limit=6`).catch(() => []),
            selectRows<Record<string, unknown>>("as_records", `select=${encodeURIComponent("작성일,_업체명,모델명,시리얼넘버,자산기번,내용,처리내용,_원문")}&_hidden=not.is.true&${filter}&order=id.desc&limit=6`).catch(() => []),
          ]);
          rawForms.push(...insp.map((r) => ({ ...r, __gubun: "점검" })), ...as.map((r) => ({ ...r, __gubun: "AS" })));
        };
        // ① 기기 번호 매칭 — 표기가 어떻든 기기는 못 속인다
        const idCond: string[] = [];
        if (t.serial?.trim()) idCond.push(`${encodeURIComponent("시리얼넘버")}.ilike.*${encodeURIComponent(t.serial.trim())}*`);
        if (t.asset?.trim()) idCond.push(`${encodeURIComponent("자산기번")}.ilike.*${encodeURIComponent(t.asset.trim())}*`);
        if (idCond.length) await fetchRaw(`or=(${idCond.join(",")})`);
        // ② 업체명 정확 일치
        if (!rawForms.length) {
          const exact = (await getInspForms(t.vendor)).forms.filter((f) => f.text);
          if (exact.length) { setFieldPick((cur) => (cur && cur.ticket.id === t.id ? { ...cur, forms: exact } : cur)); return; }
        }
        // ③ 핵심 토큰 8→5→3자 축소 검색 (워킨맵 이력 팝업과 같은 방식)
        if (!rawForms.length) {
          const core = t.vendor
            .replace(/㈜|\(주\)/g, "")
            .replace(/주식회사|유한회사|재단법인|사단법인|농업회사법인/g, "").trim()
            .match(/[가-힣a-zA-Z0-9]+/)?.[0] || t.vendor;
          const key = vendorMatchKey(t.vendor);
          for (const len of [8, 5, 3]) {
            const probe = core.slice(0, len);
            if (probe.length < 2) break;
            await fetchRaw(`${encodeURIComponent("_업체명")}=ilike.*${encodeURIComponent(probe)}*`);
            const filtered = rawForms.filter((r) => {
              const rk = vendorMatchKey(String(r["_업체명"] || ""));
              return rk && (rk === key || key.startsWith(rk) || rk.startsWith(key));
            });
            rawForms.length = 0;
            if (filtered.length) { rawForms.push(...filtered as typeof rawForms); break; }
          }
        }
        const forms: InspForm[] = rawForms
          .filter((r) => String(r["_원문"] || "").trim())
          .sort((a, b) => String(b["작성일"] || "").localeCompare(String(a["작성일"] || "")))
          .slice(0, 8)
          .map((r) => ({
            gubun: r.__gubun as InspForm["gubun"],
            date: String(r["작성일"] || "").slice(0, 10),
            model: String(r["모델명"] || ""),
            serial: String(r["시리얼넘버"] || ""),
            asset: String(r["자산기번"] || ""),
            content: String(r["내용"] || ""),
            handled: String(r["처리내용"] || ""),
            text: String(r["_원문"] || ""),
            source: "myplan",
          }));
        // 자동으로 못 찾으면 바로 검색 모드로 (직접 검색)
        setFieldPick((cur) => (cur && cur.ticket.id === t.id ? { ...cur, forms, mode: forms.length ? "auto" : "search" } : cur));
      } catch {
        setFieldPick((cur) => (cur && cur.ticket.id === t.id ? { ...cur, forms: [], mode: "search" } : cur));
      }
    })();
  };

  // 상세 모달 — 워킨맵 정보 + AS 접수내용 + 최근 점검을 한 화면에 (워킨맵 안 봐도 되게)
  const [detail, setDetail] = useState<MyPlanTicket | null>(null);
  const [detailSnaps, setDetailSnaps] = useState<InspectionSnapshot[] | null>(null);
  useEffect(() => {
    if (!detail) { setDetailSnaps(null); return; }
    let stop = false;
    setDetailSnaps(null);
    void getRecentInspections(detail.vendor, detail.serial || "", detail.asset || "")
      .then((res) => { if (!stop) setDetailSnaps(res.snapshots.slice(0, 2)); })
      .catch(() => { if (!stop) setDetailSnaps([]); });
    return () => { stop = true; };
  }, [detail]);

  return (
    <div className="space-y-2 overflow-x-hidden">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setDate(kstDate())} className={`rounded-full px-2.5 py-1.5 text-[11px] font-black transition ${date === kstDate() ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>오늘</button>
        <button type="button" onClick={() => setDate(nextBusinessDay(kstDate()))} className={`rounded-full px-2.5 py-1.5 text-[11px] font-black transition ${date === nextBusinessDay(kstDate()) ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>내일</button>
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
            <div key={t.id} onClick={() => focusTicket(t.id)} className={`relative flex flex-wrap items-center gap-2 px-3 py-2.5 pr-14 transition ${g ? "cursor-pointer hover:bg-blue-50/40" : ""}`}>
              <span className="min-w-0 flex-1 basis-[55%] overflow-hidden">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-black text-white ${isPinned ? "bg-blue-600" : "bg-slate-900"}`}>{i + 1}</span>
                  <span className="min-w-0 truncate text-[13px] font-black text-slate-900">{t.vendor}</span>
                  {t.time && <span className="shrink-0 font-mono text-[11px] font-bold text-slate-400">{t.time}</span>}
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500">{planTypeLabel(t)}</span>
                  {!g && <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-black text-amber-700">지도 좌표 없음</span>}
                </span>
                {t.issue && <span className="mt-0.5 block truncate text-[11px] font-semibold text-slate-500">{t.issue}</span>}
                {(() => {
                  // 티켓에 기종 정보가 없으면 워킨맵 comment("모델 / 시리얼")로 대신 보여준다
                  const eq = t.model || t.serial || t.asset ? "" : (lookupMeta(t.vendor)?.comment || "").replace(/\s+/g, " ").trim();
                  const parts = [t.team && `${t.team}지역`, t.model, t.serial && `S/N ${t.serial}`, t.asset && `자산 ${t.asset}`, eq].filter(Boolean);
                  return parts.length ? <span className="mt-0.5 block truncate text-[11px] font-semibold text-slate-400">{parts.join(" · ")}</span> : null;
                })()}
                <span className="mt-0.5 block truncate text-[11px] font-semibold text-slate-400">{t.address || "주소 없음"}</span>
                {onRemove && (
                  // 잘못 들어온 일정·빼고 싶은 일정을 동선에서 바로 정리 (일정리스트까지 가지 않게)
                  <button type="button" onClick={(event) => { event.stopPropagation(); onRemove(t); }}
                    className="absolute right-2 top-2 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-black text-slate-400 transition hover:border-rose-300 hover:text-rose-600">삭제</button>
                )}
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
              {/* 모바일: 버튼줄이 내용 아래 한 줄로 — 내용 칸이 눌려 업체명이 안 보이던 것 방지 */}
              <span className="flex w-full items-center gap-1.5 sm:w-auto" onClick={(e) => e.stopPropagation()}>
                <button type="button" onClick={() => setDetail(t)} className="flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-center text-[11px] font-black text-slate-600 transition hover:bg-slate-50 sm:flex-none">상세</button>
                {onUseField && <button type="button" onClick={() => openFieldPick(t)} className="flex-1 rounded-lg bg-slate-900 px-2 py-1.5 text-center text-[11px] font-black text-white transition hover:bg-slate-800 sm:flex-none">FIELD</button>}
                <a href={kakao} {...(isMobileDevice ? {} : { target: "_blank", rel: "noreferrer" })} className="flex-1 rounded-lg bg-[#FEE500] px-2 py-1.5 text-center text-[11px] font-black text-slate-900 sm:flex-none">길찾기</a>
                <button type="button" onClick={() => togglePin(t.id)}
                  className={`flex-1 rounded-full px-2.5 py-1.5 text-center text-[11px] font-black transition sm:flex-none ${isPinned ? "bg-blue-600 text-white" : "border border-slate-300 bg-white text-slate-500 hover:bg-slate-50"}`}>
                  {isPinned ? `고정 ${pinned.indexOf(t.id) + 1}` : "고정"}
                </button>
              </span>
            </div>
          );
        })}
        {!ordered.length && <div className="p-10 text-center text-xs font-bold text-slate-400">{date}에 {author}에게 배정된 일정이 없습니다.</div>}
      </div>
      {fieldPick && (() => {
        const t = fieldPick.ticket;
        // 필드탭과 동일한 변환(모드 자동 감지) — 분기점검 원문이 AS로 바뀌던 문제의 수정점
        const load = (text: string) => { setFieldPick(null); (onLoadForm || onUseField)?.(text, { id: t.id, receptionId: t.receptionId, vendor: t.vendor }); };
        return (
          <div className="fixed inset-0 z-[2400] flex items-end bg-black/45 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setFieldPick(null)}>
            <div className="flex h-[88vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:h-[82vh] sm:max-w-2xl sm:rounded-2xl" onMouseDown={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between gap-2 bg-[#1E252F] px-5 py-4">
                <div className="min-w-0">
                  <div className="text-[11px] font-black text-slate-400">{fieldPick.mode === "auto" ? "최근 양식 — 불러오면 FIELD로 변환됩니다" : "거래처·양식 검색 — 자동으로 못 찾아 직접 검색"}</div>
                  <div className="truncate text-[15px] font-black text-white">{t.vendor}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {fieldPick.mode === "auto" && <button type="button" onClick={() => setFieldPick({ ...fieldPick, mode: "search" })} className="rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-black text-white transition hover:bg-white/20">직접 검색</button>}
                  <button type="button" onClick={() => setFieldPick(null)} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white">✕</button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {fieldPick.mode === "search" ? (
                  <VendorSearch accent="#2563eb" onLoadForm={load} onVendor={() => {}} onError={(m) => notify(m, "error")} />
                ) : fieldPick.forms === null ? (
                  <div className="py-10 text-center text-xs font-bold text-slate-400">시리얼·자산기번·업체명으로 최근 양식을 찾는 중…</div>
                ) : (
                  <div className="space-y-2">
                    {fieldPick.forms.map((form, i) => (
                      <div key={i} className="overflow-hidden rounded-xl border border-slate-200">
                        <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-2">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${String(form.gubun).includes("AS") ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-700"}`}>{form.gubun}</span>
                          <span className="text-[12px] font-black text-slate-800">{form.date}</span>
                          {form.model && <span className="truncate text-[11px] font-bold text-slate-400">{form.model}</span>}
                          <button type="button" onClick={() => load(form.text)} className="ml-auto shrink-0 rounded-full bg-blue-600 px-3 py-1.5 text-[11px] font-black text-white transition hover:bg-blue-700">불러오기</button>
                        </div>
                        {(form.serial || form.asset) && <div className="px-3 pt-1.5 text-[10px] font-bold text-slate-400">{[form.serial && `S/N ${form.serial}`, form.asset && `자산 ${form.asset}`].filter(Boolean).join(" · ")}</div>}
                        {(form.content || form.handled) && <div className="px-3 py-2 text-[11px] font-semibold leading-4 text-slate-500">{String(form.content || form.handled).slice(0, 90)}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
      {detail && (() => {
        const f = flags.get(detail.vendor.trim());
        const meta = lookupMeta(detail.vendor);
        const g = getGeo(detail);
        const phone = (detail.contact || meta?.phone || "").match(/0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}/)?.[0] || "";
        const infoRows: Array<[string, string]> = [
          ["유형", `${planTypeLabel(detail)}${detail.time ? ` · ${detail.time}` : ""}`],
          ["접수내용", detail.issue || ""],
          ["기종", [detail.model, detail.serial && `S/N ${detail.serial}`, detail.asset && `자산 ${detail.asset}`].filter(Boolean).join(" · ")],
          ["담당자", [detail.keyman, detail.contact].filter(Boolean).join(" · ")],
          ["주소", detail.address || ""],
          ["메모", detail.note || ""],
        ];
        return (
          <div className="fixed inset-0 z-[2400] flex items-end bg-black/45 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setDetail(null)}>
            <div className="flex max-h-[86vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-w-md sm:rounded-2xl" onMouseDown={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3 bg-[#1E252F] px-5 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[11px] font-black text-slate-400">
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-white">{ordered.findIndex((x) => x.id === detail.id) + 1}번</span>
                    <span>{planTypeLabel(detail)}</span>
                    {detail.grade && <span className="rounded bg-purple-400/20 px-1.5 py-0.5 text-purple-200">{detail.grade}</span>}
                  </div>
                  <div className="mt-1 truncate text-[16px] font-black text-white">{detail.vendor}</div>
                </div>
                <button type="button" onClick={() => setDetail(null)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white">✕</button>
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                <div className="rounded-xl border border-slate-200 p-3">
                  {infoRows.filter(([, v]) => v).map(([k, v]) => (
                    <div key={k} className="flex items-start gap-3 border-b border-slate-50 py-1.5 last:border-0">
                      <span className="w-14 shrink-0 pt-0.5 text-[11px] font-black text-slate-400">{k}</span>
                      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[13px] font-bold leading-5 text-slate-800">{v}</span>
                    </div>
                  ))}
                </div>
                {f && (
                  <div className="rounded-xl border border-slate-200 p-3">
                    <div className="text-[11px] font-black text-slate-400">체크 포인트</div>
                    <div className="mt-1.5 space-y-1 text-[12.5px] font-bold leading-5 text-slate-700">
                      {f.inspection && <div>🔧 점검 {f.inspection.quarter}분기 {f.inspection.done ? "완료" : "대상"}</div>}
                      {f.misu && !f.misu.cleared && <div>💰 미수 {f.misu.months ? `${f.misu.months}개월` : ""} {f.misu.balance}</div>}
                      {f.misu?.cleared && <div className="text-slate-400">💰 미수 완납 ({f.misu.date})</div>}
                      {f.renewal && <div>📋 재계약 {f.renewal.done ? "완료" : `진행 필요${f.renewal.due ? ` · 종료 ${f.renewal.due}` : ""}`}</div>}
                      {f.overage && <div>📈 초과료 {f.overage.total ? `${Number(String(f.overage.total).replace(/[^\d]/g, "") || 0).toLocaleString()}원` : ""} ({f.overage.date?.slice(0, 7)})</div>}
                      {f.bulman && <div>🚨 불만 {f.bulman.date} — {f.bulman.content || "내용 확인 필요"}</div>}
                    </div>
                  </div>
                )}
                {meta && (meta.comment || meta.memos.length > 0) && (
                  <div className="rounded-xl border border-slate-200 p-3">
                    <div className="text-[11px] font-black text-slate-400">워킨맵 메모</div>
                    {meta.comment && <div className="mt-1 text-[12.5px] font-bold leading-5 text-slate-700">{meta.comment}</div>}
                    {meta.memos.length > 0 && <ul className="mt-1 space-y-0.5 text-[12px] font-semibold leading-5 text-slate-500">{meta.memos.slice(0, 6).map((m, i) => <li key={i}>· {m}</li>)}</ul>}
                  </div>
                )}
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="text-[11px] font-black text-slate-400">최근 점검 · 사용량 분석</div>
                  {detailSnaps === null && <div className="py-3 text-center text-[11px] font-bold text-slate-400">불러오는 중…</div>}
                  {detailSnaps?.length === 0 && <div className="py-3 text-center text-[11px] font-bold text-slate-400">점검 기록 없음</div>}
                  {(detailSnaps || []).map((snap, i) => (
                    <div key={i} className="mt-1.5 rounded-lg bg-slate-50 px-2.5 py-2 text-[12px] font-bold leading-5 text-slate-600">
                      <span className="text-slate-900">■ {i === 0 ? "전방문" : "전전방문"} {snap.date}</span>{snap.model ? ` · ${snap.model}` : ""}
                      <br />매수 {snap.counts || "-"} · 토너 {snap.toner || "-"} · 여분 {snap.spare || "-"}{snap.waste ? ` · 폐통 ${snap.waste}` : ""}
                    </div>
                  ))}
                  {(() => {
                    const advice = detailSnaps?.length ? usageSpareAdvice(detailSnaps[0], detailSnaps[1], `${detail.model || detailSnaps[0].model || ""}`) : null;
                    if (!advice) return null;
                    return (
                      <div className="mt-2 space-y-1 text-[12px] font-bold leading-5">
                        {advice.warning && <div className="text-rose-600">■ 주의: {advice.warning}</div>}
                        {advice.usageLine && <div className="text-slate-700">■ 사용량: {advice.usageLine}</div>}
                        {advice.adviceLine && <div className="text-blue-700">■ 여분 분석: {advice.adviceLine}</div>}
                        {advice.needsList.length > 0 && onSelfRequest && (
                          <button type="button" onClick={() => {
                            const snap = detailSnaps?.[0];
                            const text = [
                              `작성자:${author}`, "구분: 점검", "레벨:1", "등급:",
                              `업체명:${detail.vendor}`, "부서명:", `지역:${detail.team || ""}`, "키맨/접수자:",
                              "ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ", "1.",
                              `모델명: ${snap?.model || detail.model || ""}`,
                              `시리얼넘버: ${snap?.serial || detail.serial || ""}`,
                              `자산기번: ${snap?.asset || detail.asset || ""}`,
                              "내용: 여분 자가신청", "처리내용:",
                              `매수: ${snap?.counts || "흑- 컬- 큰컬- 합-"}`,
                              `토너잔량: ${snap?.toner || "K- C- M- Y-"}`,
                              `폐통: ${snap?.waste || ""}`,
                              `여분: ${snap?.spare || ""}`,
                              "한틴이카유무:", "주차비지원유무:", "특이사항:",
                              "ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ",
                              "※자가신청※",
                              `물품: ${spareNeedItems(advice.needsList)}`,
                              "수량:", "출고여부:",
                            ].join("\n");
                            setDetail(null);
                            onSelfRequest(text);
                          }} className="mt-1 w-full rounded-full bg-emerald-600 py-2 text-center text-[12px] font-black text-white transition hover:bg-emerald-700">
                            🧰 자가신청 양식 만들기 ({spareNeedItems(advice.needsList)})
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
              <div className="flex shrink-0 gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-3">
                {phone && <a href={`tel:${phone.replace(/[^0-9]/g, "")}`} className="flex-1 rounded-full border border-slate-300 bg-white py-2.5 text-center text-sm font-black text-slate-700">📞 전화</a>}
                <a href={g ? kakaoMapRouteLink(detail.vendor.slice(0, 30), g.lat, g.lng) : kakaoMapSearchLink(detail.address || detail.vendor)}
                  {...(isMobileDevice ? {} : { target: "_blank", rel: "noreferrer" })}
                  className="flex-[2] rounded-full bg-[#FEE500] py-2.5 text-center text-sm font-black text-slate-900">길찾기</a>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
