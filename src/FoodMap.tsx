/**
 * 맛동여지도 — 주차 가능한 맛집을 팀이 함께 쌓는 공유 지도 (팀장 제안, 2026-08-25).
 * 강남처럼 주차가 어려운 곳에서 매번 다시 찾지 않게: 이름·주소(→좌표)·주차 정보·추천 메뉴·별점을 누구나 추가하고,
 * 지도(카카오→실패 시 OSM)와 목록에서 주차 가능만 걸러 보거나 내 위치·검색 기준 가까운 순으로 본다. 워킨맵과 같은 공유 모델.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { deleteRows, insertRow, selectRows, updateRows } from "./supabase";
import { loadKakaoMaps, type KakaoNS } from "./kakaoMap";
import { geocodeKR } from "./geocode";
import { askConfirm } from "./confirmModal";
import { notify } from "./toast";
import { kakaoMapSearchLink, naverMapLink } from "./navApp";

export type FoodPlace = {
  id: string; name: string; address: string; address_detail: string; lat: number | null; lng: number | null; gu: string;
  parking: "가능" | "유료" | "발렛" | "노상" | "불가" | "모름"; parking_memo: string; menu: string; price: string; rating: number;
  tags: string[]; memo: string; author: string; team: string; likes: number; created_at: string;
};
const PARKING: FoodPlace["parking"][] = ["가능", "유료", "발렛", "노상", "불가", "모름"];
const PARKING_TONE: Record<string, string> = { 가능: "bg-emerald-100 text-emerald-800", 유료: "bg-blue-100 text-blue-800", 발렛: "bg-indigo-100 text-indigo-800", 노상: "bg-amber-100 text-amber-800", 불가: "bg-rose-100 text-rose-700", 모름: "bg-slate-100 text-slate-500" };
const PARKING_COLOR: Record<string, string> = { 가능: "#059669", 유료: "#2563eb", 발렛: "#4f46e5", 노상: "#d97706", 불가: "#e11d48", 모름: "#64748b" };
const TAGS = ["혼밥", "단체", "빨리나옴", "조용함", "가성비", "회식", "점심특선", "24시"];
const guOf = (address: string) => (address.match(/([가-힣]+(?:구|시|군))\s/) || [])[1] || "";
const distKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => Math.sqrt(((a.lat - b.lat) * 111) ** 2 + ((a.lng - b.lng) * 88) ** 2);
const stars = (n: number) => "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));
const esc = (v: string) => v.replace(/[<>&]/g, "");

type Form = { id: string; name: string; address: string; address_detail: string; parking: FoodPlace["parking"]; parking_memo: string; menu: string; price: string; rating: number; tags: string[]; memo: string };
const emptyForm = (): Form => ({ id: "", name: "", address: "", address_detail: "", parking: "가능", parking_memo: "", menu: "", price: "", rating: 4, tags: [], memo: "" });

export default function FoodMap({ author, team }: { author: string; team: string }) {
  const [places, setPlaces] = useState<FoodPlace[]>([]);
  const [q, setQ] = useState("");
  const [onlyParking, setOnlyParking] = useState(false);
  const [gu, setGu] = useState("");
  const [origin, setOrigin] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [focusId, setFocusId] = useState("");

  const load = useCallback(async () => {
    try { setPlaces(await selectRows<FoodPlace>("food_places", "select=*&order=created_at.desc&limit=2000")); }
    catch (e) { notify(`맛집 목록을 못 읽었습니다: ${(e as Error).message}`, "error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const gus = useMemo(() => Array.from(new Set(places.map((p) => p.gu).filter(Boolean))).sort(), [places]);
  const shown = useMemo(() => {
    const key = q.trim().toLowerCase();
    const list = places.filter((p) =>
      (!onlyParking || ["가능", "유료", "발렛"].includes(p.parking))
      && (!gu || p.gu === gu)
      && (!key || [p.name, p.menu, p.address, p.memo, p.tags.join(" "), p.author].join(" ").toLowerCase().includes(key)));
    if (origin) {
      return [...list].sort((a, b) => {
        const da = a.lat != null && a.lng != null ? distKm(origin, { lat: a.lat, lng: a.lng }) : 9e9;
        const db = b.lat != null && b.lng != null ? distKm(origin, { lat: b.lat, lng: b.lng }) : 9e9;
        return da - db;
      });
    }
    return [...list].sort((a, b) => b.likes - a.likes || b.rating - a.rating);
  }, [places, q, onlyParking, gu, origin]);

  // 내 위치 기준 가까운 순 (모바일 현장) — 실패하면 검색어 주소로
  const useMyLocation = () => {
    if (!navigator.geolocation) { notify("이 기기는 위치를 지원하지 않습니다", "error"); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: "내 위치" }),
      () => notify("위치 권한이 없어요 — 주소로 기준을 잡아 주세요", "error"), { enableHighAccuracy: true, timeout: 8000 },
    );
  };
  const useAddressOrigin = async () => {
    const found = await geocodeKR(q.trim());
    if (found) setOrigin({ lat: found.lat, lng: found.lng, label: q.trim().slice(0, 14) }); else notify("그 주소의 좌표를 못 찾았어요", "error");
  };

  const save = async () => {
    if (!form || busy) return;
    if (!form.name.trim()) { notify("가게 이름을 적어 주세요", "error"); return; }
    setBusy(true);
    try {
      let lat: number | null = null, lng: number | null = null;
      if (form.address.trim()) {
        const found = await geocodeKR(form.address.trim());
        if (found) { lat = found.lat; lng = found.lng; } else notify("주소 좌표를 못 찾아 목록에만 올립니다 — 주소를 더 정확히 적으면 지도에 뜹니다", "error");
      }
      const row = {
        name: form.name.trim(), address: form.address.trim(), address_detail: form.address_detail.trim(), lat, lng, gu: guOf(form.address),
        parking: form.parking, parking_memo: form.parking_memo.trim(), menu: form.menu.trim(), price: form.price.trim(), rating: form.rating,
        tags: form.tags, memo: form.memo.trim(), updated_at: new Date().toISOString(),
      };
      if (form.id) await updateRows("food_places", `id=eq.${form.id}`, row);
      else await insertRow("food_places", { ...row, author, team });
      setForm(null);
      await load();
      notify(form.id ? "수정했습니다" : "맛동여지도에 올렸습니다 — 모두에게 보입니다", "success");
    } catch (e) { notify(`저장 실패: ${(e as Error).message}`, "error"); }
    finally { setBusy(false); }
  };
  const remove = async (p: FoodPlace) => {
    if (!(await askConfirm(`"${p.name}"을(를) 지도에서 지울까요? 모두에게서 사라집니다.`, { danger: true, okLabel: "지우기" }))) return;
    try { await deleteRows("food_places", `id=eq.${p.id}`); await load(); notify("지웠습니다", "success"); }
    catch (e) { notify(`삭제 실패: ${(e as Error).message}`, "error"); }
  };
  const like = async (p: FoodPlace) => {
    try { await updateRows("food_places", `id=eq.${p.id}`, { likes: p.likes + 1 }); setPlaces((cur) => cur.map((x) => (x.id === p.id ? { ...x, likes: x.likes + 1 } : x))); }
    catch { /* 추천은 부가 기능 */ }
  };
  const edit = (p: FoodPlace) => setForm({ id: p.id, name: p.name, address: p.address, address_detail: p.address_detail, parking: p.parking, parking_memo: p.parking_memo, menu: p.menu, price: p.price, rating: p.rating, tags: p.tags || [], memo: p.memo });

  // ── 지도 (카카오 → OSM 폴백) ──
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
      if (kakao) { kakaoRef.current = { ns: kakao, map: new kakao.maps.Map(elRef.current, { center: new kakao.maps.LatLng(37.5, 127.03), level: 7 }) }; setEngine("kakao"); }
      else {
        const map = L.map(elRef.current).setView([37.5, 127.03], 12);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 19 }).addTo(map);
        leafletRef.current = { map, layer: L.layerGroup().addTo(map) }; setEngine("leaflet");
      }
    });
    return () => { cancelled = true; if (leafletRef.current) { leafletRef.current.map.remove(); leafletRef.current = null; } kakaoRef.current = null; kakaoObjects.current = []; };
  }, []);
  const pinHtml = (p: FoodPlace, focused: boolean) =>
    `<div style="display:flex;align-items:center;gap:3px;background:${PARKING_COLOR[p.parking]};color:#fff;border:2px solid #fff;border-radius:999px;padding:2px 7px 2px 5px;font-size:11px;font-weight:900;box-shadow:0 2px 8px rgba(0,0,0,.3);white-space:nowrap;transform:scale(${focused ? 1.15 : 1})">🍴 ${esc(p.name.slice(0, 10))}</div>`;
  useEffect(() => {
    const pts = shown.filter((p) => p.lat != null && p.lng != null).slice(0, 150);
    if (engine === "leaflet" && leafletRef.current) {
      const { map, layer } = leafletRef.current; layer.clearLayers();
      const bounds: [number, number][] = [];
      if (origin) { L.circleMarker([origin.lat, origin.lng], { radius: 7, color: "#dc2626", fillColor: "#dc2626", fillOpacity: 0.9 }).addTo(layer).bindTooltip(origin.label); bounds.push([origin.lat, origin.lng]); }
      pts.forEach((p) => {
        const icon = L.divIcon({ className: "", html: pinHtml(p, p.id === focusId), iconSize: [0, 0], iconAnchor: [0, 10] });
        L.marker([p.lat as number, p.lng as number], { icon }).addTo(layer).on("click", () => setFocusId(p.id))
          .bindTooltip(`${p.name} · 주차 ${p.parking}${p.menu ? ` · ${p.menu}` : ""}`);
        if (bounds.length < 40) bounds.push([p.lat as number, p.lng as number]);
      });
      if (bounds.length) map.fitBounds(L.latLngBounds(bounds), { padding: [24, 24], maxZoom: 15 });
      return;
    }
    if (engine !== "kakao" || !kakaoRef.current) return;
    const { ns: kakao, map } = kakaoRef.current;
    for (const o of kakaoObjects.current) o.setMap(null); kakaoObjects.current = [];
    const bounds = new kakao.maps.LatLngBounds(); let n = 0;
    if (origin) {
      const pos = new kakao.maps.LatLng(origin.lat, origin.lng);
      const el = document.createElement("div"); el.innerHTML = `<div style="width:14px;height:14px;border-radius:50%;background:#dc2626;border:3px solid #fff;box-shadow:0 0 0 3px rgba(220,38,38,.35)"></div>`; el.title = origin.label;
      const o = new kakao.maps.CustomOverlay({ position: pos, content: el, yAnchor: 0.5, zIndex: 50 }); o.setMap(map); kakaoObjects.current.push(o); bounds.extend(pos); n++;
    }
    pts.forEach((p) => {
      const pos = new kakao.maps.LatLng(p.lat, p.lng);
      const el = document.createElement("div"); el.innerHTML = pinHtml(p, p.id === focusId); el.style.cursor = "pointer"; el.onclick = () => setFocusId(p.id);
      const o = new kakao.maps.CustomOverlay({ position: pos, content: el, yAnchor: 1, zIndex: p.id === focusId ? 40 : 10 }); o.setMap(map); kakaoObjects.current.push(o);
      if (n < 40) { bounds.extend(pos); n++; }
    });
    if (n) map.setBounds(bounds, 28, 28, 28, 28);
  }, [engine, shown, origin, focusId]);

  const focused = places.find((p) => p.id === focusId);

  return (
    <div className="space-y-3">
      <section className="rounded-2xl bg-[#1E252F] p-4 text-white sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-lg font-black">🍴 맛동여지도 <span className="ml-1 text-[12px] font-semibold text-slate-400">주차 되는 맛집, 같이 쌓기</span></div>
            <div className="mt-0.5 text-[11px] font-semibold text-slate-400">누구나 올리고 모두가 봅니다 · 주차 정보가 핵심 · 마커 색 = 주차(초록 가능·파랑 유료·남색 발렛·주황 노상·빨강 불가)</div>
          </div>
          <button type="button" onClick={() => setForm(emptyForm())} className="rounded-full bg-blue-600 px-4 py-2 text-sm font-black text-white shadow hover:bg-blue-500">+ 맛집 올리기</button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="가게·메뉴·주소·올린 사람 검색 (주소를 넣고 [이 주소 기준]도 가능)"
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm font-semibold text-white outline-none placeholder:text-slate-500 focus:border-blue-400" />
          <button type="button" onClick={() => setOnlyParking((v) => !v)} className={`rounded-full px-3 py-1.5 text-[12px] font-black ${onlyParking ? "bg-emerald-500 text-white" : "bg-white/10 text-slate-200"}`}>🅿 주차 가능만</button>
          <button type="button" onClick={useMyLocation} className="rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-black text-slate-200 hover:bg-white/20">📍 내 위치 가까운 순</button>
          <button type="button" onClick={() => void useAddressOrigin()} disabled={!q.trim()} className="rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-black text-slate-200 hover:bg-white/20 disabled:opacity-40">이 주소 기준</button>
          {origin && <button type="button" onClick={() => setOrigin(null)} className="rounded-full bg-rose-500/20 px-3 py-1.5 text-[12px] font-black text-rose-300">기준 해제 ({origin.label})</button>}
        </div>
        {gus.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setGu("")} className={`rounded-full px-2.5 py-1 text-[11px] font-black ${!gu ? "bg-white text-slate-900" : "bg-white/10 text-slate-300"}`}>전체 {places.length}</button>
            {gus.map((g) => <button key={g} type="button" onClick={() => setGu(g === gu ? "" : g)} className={`rounded-full px-2.5 py-1 text-[11px] font-black ${gu === g ? "bg-white text-slate-900" : "bg-white/10 text-slate-300"}`}>{g} {places.filter((p) => p.gu === g).length}</button>)}
          </div>
        )}
      </section>

      <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div ref={elRef} className="h-[320px] w-full bg-slate-100 sm:h-[460px]" />
          {focused && (
            <div className="border-t border-slate-100 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-black text-slate-900">{focused.name}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${PARKING_TONE[focused.parking]}`}>🅿 {focused.parking}</span>
                {focused.rating > 0 && <span className="text-[12px] font-black text-amber-500">{stars(focused.rating)}</span>}
              </div>
              {focused.parking_memo && <div className="mt-1 text-[12px] font-bold text-slate-700">주차: {focused.parking_memo}</div>}
              {focused.menu && <div className="text-[12px] text-slate-600">추천: {focused.menu}{focused.price ? ` · ${focused.price}` : ""}</div>}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <a href={naverMapLink(`${focused.name} ${focused.address}`)} target="_blank" rel="noreferrer" className="rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-black text-white">네이버지도</a>
                <a href={kakaoMapSearchLink(`${focused.name} ${focused.address}`)} target="_blank" rel="noreferrer" className="rounded-full bg-amber-400 px-2.5 py-1 text-[11px] font-black text-slate-900">카카오맵</a>
              </div>
            </div>
          )}
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-2.5 text-[12px] font-black text-slate-500">{shown.length}곳{origin ? ` · ${origin.label} 기준 가까운 순` : " · 추천·별점 순"}</div>
          {!shown.length && <div className="px-4 py-12 text-center text-sm font-semibold text-slate-400">{places.length ? "조건에 맞는 곳이 없어요" : "아직 올라온 맛집이 없어요 — 첫 번째로 올려 보세요"}</div>}
          <ul className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto">
            {shown.map((p) => {
              const d = origin && p.lat != null && p.lng != null ? distKm(origin, { lat: p.lat, lng: p.lng }) : null;
              return (
                <li key={p.id} className={`px-4 py-3 transition ${focusId === p.id ? "bg-blue-50/60" : "hover:bg-slate-50"}`}>
                  <button type="button" onClick={() => setFocusId(p.id)} className="w-full text-left">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {d != null && <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-black tabular-nums text-white">{d < 1 ? `${Math.round(d * 1000)}m` : `${d.toFixed(1)}km`}</span>}
                      <span className="text-[14px] font-black text-slate-900">{p.name}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${PARKING_TONE[p.parking]}`}>🅿 {p.parking}</span>
                      {p.rating > 0 && <span className="text-[11px] font-black text-amber-500">{stars(p.rating)}</span>}
                      {p.gu && <span className="text-[11px] font-semibold text-slate-400">{p.gu}</span>}
                      {p.lat == null && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-400">지도 미표시</span>}
                    </div>
                    {p.parking_memo && <div className="mt-0.5 text-[12px] font-bold text-emerald-800">주차 · {p.parking_memo}</div>}
                    {(p.menu || p.price) && <div className="text-[12px] text-slate-700">{p.menu}{p.price ? ` · ${p.price}` : ""}</div>}
                    {p.memo && <div className="text-[12px] text-slate-500">{p.memo}</div>}
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {(p.tags || []).map((t) => <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">#{t}</span>)}
                      <span className="ml-auto text-[10px] font-semibold text-slate-400">{p.author}{p.team ? ` · ${p.team}팀` : ""} · {p.address.slice(0, 22)}</span>
                    </div>
                  </button>
                  <div className="mt-1.5 flex gap-1.5">
                    <button type="button" onClick={() => void like(p)} className="rounded-full border border-rose-200 px-2.5 py-1 text-[11px] font-black text-rose-600 hover:bg-rose-50">👍 추천 {p.likes}</button>
                    <button type="button" onClick={() => edit(p)} className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-black text-slate-600 hover:bg-slate-50">수정</button>
                    <button type="button" onClick={() => void remove(p)} className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-black text-slate-400 hover:bg-slate-50">삭제</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {form && (
        <div className="fixed inset-0 z-[160] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setForm(null)}>
          <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-lg sm:rounded-2xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="text-lg font-black text-slate-950">{form.id ? "맛집 수정" : "맛집 올리기"}</div>
            <div className="mt-0.5 text-[11px] font-semibold text-slate-400">주소를 넣으면 좌표를 찍어 지도에 올립니다 · 주차 정보를 꼭 적어 주세요</div>
            <div className="mt-4 space-y-2">
              <input value={form.name} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="가게 이름 *" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-bold outline-none focus:border-blue-500" />
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="주소 (예: 서울 강남구 테헤란로 152)" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-semibold outline-none focus:border-blue-500" />
              <input value={form.address_detail} onChange={(e) => setForm({ ...form, address_detail: e.target.value })} placeholder="상세 (건물·층, 선택)" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500" />
              <div>
                <div className="mb-1 text-[11px] font-black text-slate-500">주차</div>
                <div className="flex flex-wrap gap-1.5">
                  {PARKING.map((p) => <button key={p} type="button" onClick={() => setForm({ ...form, parking: p })} className={`rounded-full px-3 py-1.5 text-[12px] font-black ${form.parking === p ? "bg-slate-900 text-white" : PARKING_TONE[p]}`}>{p}</button>)}
                </div>
                <input value={form.parking_memo} onChange={(e) => setForm({ ...form, parking_memo: e.target.value })} placeholder="주차 메모 (예: 건물 지하 1시간 무료, 옆 공영주차장 2천원)" className="mt-1.5 w-full rounded-lg border border-emerald-200 bg-emerald-50/40 px-3 py-2 text-sm font-semibold outline-none focus:border-emerald-500" />
              </div>
              <div className="grid grid-cols-[1fr_7rem] gap-2">
                <input value={form.menu} onChange={(e) => setForm({ ...form, menu: e.target.value })} placeholder="추천 메뉴" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500" />
                <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="1인 가격" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-black text-slate-500">별점</span>
                {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" onClick={() => setForm({ ...form, rating: n })} className={`text-xl ${n <= form.rating ? "text-amber-400" : "text-slate-300"}`}>★</button>)}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {TAGS.map((t) => { const on = form.tags.includes(t); return <button key={t} type="button" onClick={() => setForm({ ...form, tags: on ? form.tags.filter((x) => x !== t) : [...form.tags, t] })} className={`rounded-full px-2.5 py-1 text-[11px] font-black ${on ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"}`}>#{t}</button>; })}
              </div>
              <textarea value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} rows={2} placeholder="한 줄 메모 (선택)" className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500" />
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setForm(null)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-black text-slate-500">취소</button>
              <button type="button" disabled={busy} onClick={() => void save()} className="flex-[2] rounded-xl bg-blue-600 py-2.5 text-sm font-black text-white shadow disabled:opacity-50">{busy ? "저장 중…" : form.id ? "수정 저장" : "올리기"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
