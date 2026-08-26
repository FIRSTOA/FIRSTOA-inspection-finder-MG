/**
 * 맛동여지도 — 주차 가능한 맛집을 팀이 함께 쌓는 공유 지도 (팀장 제안, 2026-08-25).
 * 강남처럼 주차가 어려운 곳에서 매번 다시 찾지 않게: 이름·주소(→좌표)·주차 정보·추천 메뉴·별점을 누구나 추가하고,
 * 지도(카카오→실패 시 OSM)와 목록에서 주차 가능만 걸러 보거나 내 위치·검색 기준 가까운 순으로 본다. 워킨맵과 같은 공유 모델.
 *
 * 2026-08-27 개편: 네이버지도처럼 "지도 + 목록(대표사진 썸네일) + 하단 상세(사진·메뉴판)" 3단 구성.
 * 사진은 직접 올리고(폰 사진 축소 후 저장), 메뉴는 네이버지도 메뉴 탭을 긁어 붙이면 그대로 읽는다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { deleteRows, insertRow, selectRows, updateRows, uploadPhoto } from "./supabase";
import { loadKakaoMaps, type KakaoNS } from "./kakaoMap";
import { geocodeKR } from "./geocode";
import { askConfirm } from "./confirmModal";
import { notify } from "./toast";
import { kakaoMapSearchLink, naverMapLink } from "./navApp";
import { prepareImageForUpload } from "./imageUpload";
import { menusFromPhoto, searchPlaces, type PlaceCandidate } from "./placeSearch";
import { looksLikeMenuBlock, looksLikeNaverSavedList, parseMenuBlock, parseNaverSavedList, type ImportedPlace, type MenuItem } from "./foodImport";

export type FoodPlace = {
  id: string; name: string; address: string; address_detail: string; lat: number | null; lng: number | null; gu: string;
  parking: "가능" | "유료" | "발렛" | "노상" | "불가" | "모름"; parking_memo: string; menu: string; price: string; rating: number;
  tags: string[]; memo: string; author: string; team: string; likes: number; created_at: string;
  category: string; hours: string; tel: string; photos: string[]; menus: MenuItem[];
};
const PARKING: FoodPlace["parking"][] = ["가능", "유료", "발렛", "노상", "불가", "모름"];
const PARKING_TONE: Record<string, string> = { 가능: "bg-emerald-100 text-emerald-800", 유료: "bg-blue-100 text-blue-800", 발렛: "bg-indigo-100 text-indigo-800", 노상: "bg-amber-100 text-amber-800", 불가: "bg-rose-100 text-rose-700", 모름: "bg-slate-100 text-slate-500" };
const PARKING_COLOR: Record<string, string> = { 가능: "#059669", 유료: "#2563eb", 발렛: "#4f46e5", 노상: "#d97706", 불가: "#e11d48", 모름: "#64748b" };
const TAGS = ["혼밥", "단체", "빨리나옴", "조용함", "가성비", "회식", "점심특선", "24시"];
const MAX_PHOTOS = 8;
const guOf = (address: string) => (address.match(/([가-힣]+(?:구|시|군))\s/) || [])[1] || "";
const distKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => Math.sqrt(((a.lat - b.lat) * 111) ** 2 + ((a.lng - b.lng) * 88) ** 2);
const stars = (n: number) => "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));
const esc = (v: string) => v.replace(/[<>&]/g, "");
const distLabel = (d: number) => (d < 1 ? `${Math.round(d * 1000)}m` : `${d.toFixed(1)}km`);
/** 목록·상세에서 쓰는 대표 메뉴 (대표 표시된 것 먼저) */
const topMenus = (p: FoodPlace, n: number): MenuItem[] => {
  const list = Array.isArray(p.menus) ? p.menus : [];
  return [...list].sort((a, b) => Number(Boolean(b.signature)) - Number(Boolean(a.signature))).slice(0, n);
};

type Form = {
  id: string; name: string; category: string; address: string; address_detail: string; parking: FoodPlace["parking"]; parking_memo: string;
  menu: string; price: string; rating: number; tags: string[]; memo: string; tel: string; hours: string; photos: string[]; menus: MenuItem[];
  lat: number | null; lng: number | null; // 검색으로 고른 가게의 좌표 — 있으면 주소를 다시 찾지 않는다
};
const emptyForm = (): Form => ({ id: "", name: "", category: "", address: "", address_detail: "", parking: "가능", parking_memo: "", menu: "", price: "", rating: 4, tags: [], memo: "", tel: "", hours: "", photos: [], menus: [], lat: null, lng: null });

export default function FoodMap({ author, team }: { author: string; team: string }) {
  const [places, setPlaces] = useState<FoodPlace[]>([]);
  const [q, setQ] = useState("");
  const [onlyParking, setOnlyParking] = useState(false);
  const [gu, setGu] = useState("");
  // 팀별로 나눠 본다(팀장 요청) — 기본은 자기 팀, "전체"로 다른 팀 것도. 올릴 때는 작성자 팀으로 저장된다
  const [teamFilter, setTeamFilter] = useState<string>(/^[A-E]$/.test(team) ? team : "");
  const [bulk, setBulk] = useState<string | null>(null); // 여러 개 한 번에 붙여넣기 (네이버 저장 목록 옮겨 적기)
  const [bulkLog, setBulkLog] = useState<string[]>([]);
  const [preview, setPreview] = useState<ImportedPlace[] | null>(null); // 붙여넣기 해석 결과 — 확인·삭제 후 올린다
  const [origin, setOrigin] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [focusId, setFocusId] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [menuPaste, setMenuPaste] = useState<string | null>(null); // 메뉴 붙여넣기 입력창 (열려 있으면 문자열)
  const [viewer, setViewer] = useState<{ urls: string[]; at: number } | null>(null); // 사진 크게 보기
  const [lookup, setLookup] = useState(""); // 폼 안 "이름으로 찾기" 검색어
  const [cands, setCands] = useState<PlaceCandidate[] | null>(null); // 검색 후보
  const [lookupBusy, setLookupBusy] = useState(false);
  const [menuBusy, setMenuBusy] = useState(false); // 메뉴 사진 읽는 중
  const detailRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try { setPlaces(await selectRows<FoodPlace>("food_places", "select=*&order=created_at.desc&limit=2000")); }
    catch (e) { notify(`맛집 목록을 못 읽었습니다: ${(e as Error).message}`, "error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const gus = useMemo(() => Array.from(new Set(places.map((p) => p.gu).filter(Boolean))).sort(), [places]);
  const shown = useMemo(() => {
    const key = q.trim().toLowerCase();
    const list = places.filter((p) =>
      (!teamFilter || p.team === teamFilter)
      && (!onlyParking || ["가능", "유료", "발렛"].includes(p.parking))
      && (!gu || p.gu === gu)
      && (!key || [p.name, p.category, p.menu, p.address, p.memo, (p.tags || []).join(" "), p.author, (p.menus || []).map((m) => m.name).join(" ")].join(" ").toLowerCase().includes(key)));
    if (origin) {
      return [...list].sort((a, b) => {
        const da = a.lat != null && a.lng != null ? distKm(origin, { lat: a.lat, lng: a.lng }) : 9e9;
        const db = b.lat != null && b.lng != null ? distKm(origin, { lat: b.lat, lng: b.lng }) : 9e9;
        return da - db;
      });
    }
    return [...list].sort((a, b) => b.likes - a.likes || b.rating - a.rating);
  }, [places, q, onlyParking, gu, origin, teamFilter]);

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

  // ── 사진: 폰 사진은 그대로 올리면 수 MB — 1400px로 줄여 저장한다 (접수·필드탭과 같은 방식) ──
  const addPhotos = async (files: FileList | null) => {
    if (!files || !form || photoBusy) return;
    const room = Math.max(0, MAX_PHOTOS - form.photos.length);
    if (!room) { notify(`사진은 ${MAX_PHOTOS}장까지예요`, "error"); return; }
    setPhotoBusy(true);
    try {
      const urls: string[] = [];
      for (const file of Array.from(files).slice(0, room)) {
        const prepared = await prepareImageForUpload(file, 1400);
        urls.push(await uploadPhoto(`food/${crypto.randomUUID()}.${prepared.ext}`, prepared.blob, prepared.contentType));
      }
      setForm((cur) => (cur ? { ...cur, photos: [...cur.photos, ...urls] } : cur));
    } catch (e) { notify(`사진 업로드 실패: ${(e as Error).message}`, "error"); }
    finally { setPhotoBusy(false); }
  };

  // 가게 이름 → 카카오·네이버 검색으로 업종·주소·전화·좌표를 한 번에 (직접 타이핑 없애기)
  const runLookup = async (keyword?: string) => {
    const q = (keyword ?? lookup).trim();
    if (q.length < 2 || lookupBusy) return;
    setLookupBusy(true);
    try {
      const found = await searchPlaces(q);
      setCands(found);
      if (!found.length) notify("검색 결과가 없어요 — 이름을 조금 다르게 넣어 보세요", "error");
    } catch (e) { notify(`검색 실패: ${(e as Error).message}`, "error"); }
    finally { setLookupBusy(false); }
  };
  const pickCandidate = (c: PlaceCandidate) => {
    setForm((cur) => (cur ? {
      ...cur,
      name: c.name || cur.name,
      category: c.category || cur.category,
      address: c.roadAddress || c.address || cur.address,
      tel: c.tel || cur.tel,
      lat: c.lat, lng: c.lng,
    } : cur));
    setCands(null); setLookup("");
    notify(`${c.name} 정보를 채웠습니다 — 주차·사진·메뉴만 더하면 끝`, "success");
  };
  // 메뉴판·네이버 메뉴 화면 사진 → AI가 이름·가격·대표까지 읽어 담는다
  const readMenuPhoto = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || !form || menuBusy) return;
    setMenuBusy(true);
    try {
      const prepared = await prepareImageForUpload(file, 1600);
      const url = await uploadPhoto(`food/menu/${crypto.randomUUID()}.${prepared.ext}`, prepared.blob, prepared.contentType);
      const read = await menusFromPhoto(url);
      if (!read.length) { notify("사진에서 메뉴를 못 찾았어요 — 메뉴가 크게 보이는 사진으로 다시 시도해 주세요", "error"); return; }
      setForm((cur) => {
        if (!cur) return cur;
        const merged = [...cur.menus.filter((m) => m.name.trim()), ...read.filter((r) => !cur.menus.some((m) => m.name.trim() === r.name))];
        return { ...cur, menus: merged };
      });
      notify(`메뉴 ${read.length}개를 읽었습니다`, "success");
    } catch (e) { notify(`메뉴 읽기 실패: ${(e as Error).message}`, "error"); }
    finally { setMenuBusy(false); }
  };

  const save = async () => {
    if (!form || busy) return;
    if (!form.name.trim()) { notify("가게 이름을 적어 주세요", "error"); return; }
    setBusy(true);
    try {
      let lat: number | null = form.lat, lng: number | null = form.lng;
      if (lat == null && form.address.trim()) {
        const found = await geocodeKR(form.address.trim());
        if (found) { lat = found.lat; lng = found.lng; } else notify("주소 좌표를 못 찾아 목록에만 올립니다 — 주소를 더 정확히 적으면 지도에 뜹니다", "error");
      }
      const row = {
        name: form.name.trim(), category: form.category.trim(), address: form.address.trim(), address_detail: form.address_detail.trim(), lat, lng, gu: guOf(form.address),
        parking: form.parking, parking_memo: form.parking_memo.trim(), menu: form.menu.trim(), price: form.price.trim(), rating: form.rating,
        tags: form.tags, memo: form.memo.trim(), tel: form.tel.trim(), hours: form.hours.trim(),
        photos: form.photos, menus: form.menus.filter((m) => m.name.trim()).map((m) => ({ name: m.name.trim(), price: m.price.trim(), ...(m.signature ? { signature: true } : {}) })),
        updated_at: new Date().toISOString(),
      };
      if (form.id) await updateRows("food_places", `id=eq.${form.id}`, row);
      else await insertRow("food_places", { ...row, author, team });
      setForm(null); setMenuPaste(null);
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
  // 1단계: 붙여넣은 텍스트 해석 — 네이버 저장목록 복사본(빈 줄 구분·주소 줄)이면 그 파서, 아니면 "이름 | 주소 | 주차메모" 한 줄 형식
  const buildPreview = () => {
    const text = bulk || "";
    let rows: ImportedPlace[];
    if (looksLikeNaverSavedList(text)) rows = parseNaverSavedList(text);
    else {
      rows = text.split(/\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
        const [name = "", address = "", parkingMemo = ""] = line.split(/\s*[|｜\t]\s*/);
        return { name: name.trim(), address: address.trim(), parking: parkingMemo.trim() ? "가능" as const : "모름" as const, parkingMemo: parkingMemo.trim(), memo: "" };
      }).filter((r) => r.name);
    }
    if (!rows.length) { notify("읽어낸 항목이 없어요 — 형식을 확인해 주세요", "error"); return; }
    setPreview(rows);
  };
  // 2단계: 좌표 잡아 올리기 (이미 있는 이름은 건너뜀)
  const runBulk = async () => {
    if (!preview || busy) return;
    setBusy(true);
    const log: string[] = [];
    try {
      for (const r of preview.slice(0, 120)) {
        if (places.some((p) => p.name === r.name)) { log.push(`↷ ${r.name} — 이미 있음`); setBulkLog([...log]); continue; }
        const found = await geocodeKR(r.address || r.name);
        await insertRow("food_places", {
          name: r.name, address: r.address || (found?.label || ""), address_detail: "", lat: found?.lat ?? null, lng: found?.lng ?? null,
          gu: guOf(r.address || found?.label || ""), parking: r.parking, parking_memo: r.parkingMemo,
          menu: "", price: "", rating: 0, tags: [], memo: r.memo, author, team, likes: 0, updated_at: new Date().toISOString(),
        });
        log.push(`${found ? "✓" : "⚠ 좌표 없음(목록만)"} ${r.name}`);
        setBulkLog([...log]);
      }
      await load();
      notify(`${log.filter((l) => l.startsWith("✓")).length}곳 지도에 올렸습니다`, "success");
      setPreview(null); setBulk(null);
    } catch (e) { notify(`일괄 등록 중단: ${(e as Error).message}`, "error"); }
    finally { setBusy(false); }
  };
  const edit = (p: FoodPlace) => {
    setMenuPaste(null);
    setForm({
      id: p.id, name: p.name, category: p.category || "", address: p.address, address_detail: p.address_detail, parking: p.parking, parking_memo: p.parking_memo,
      menu: p.menu, price: p.price, rating: p.rating, tags: p.tags || [], memo: p.memo, tel: p.tel || "", hours: p.hours || "",
      photos: Array.isArray(p.photos) ? [...p.photos] : [], menus: Array.isArray(p.menus) ? p.menus.map((m) => ({ ...m })) : [],
      lat: p.lat, lng: p.lng,
    });
    setCands(null); setLookup("");
  };

  // ── 지도 (카카오 → OSM 폴백) ──
  const elRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<{ map: L.Map; layer: L.LayerGroup } | null>(null);
  const kakaoRef = useRef<{ ns: KakaoNS; map: KakaoNS } | null>(null);
  const kakaoObjects = useRef<KakaoNS[]>([]);
  const [engine, setEngine] = useState<"" | "kakao" | "leaflet">("");
  const fitSigRef = useRef(""); // 이 핀 조합으로 이미 화면을 맞췄나 (같으면 배율을 건드리지 않는다)
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
    // 확대해 놓고 다른 가게를 누르면 배율이 초기화되던 문제(2026-08-27) — 핀 조합이 바뀔 때만 화면을 맞춘다.
    const fitSig = `${engine}|${origin ? `${origin.lat.toFixed(4)},${origin.lng.toFixed(4)}` : ""}|${pts.map((p) => p.id).join(",")}`;
    const shouldFit = fitSig !== fitSigRef.current;
    if (shouldFit) fitSigRef.current = fitSig;
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
      if (shouldFit && bounds.length) map.fitBounds(L.latLngBounds(bounds), { padding: [24, 24], maxZoom: 15 });
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
    if (shouldFit && n) map.setBounds(bounds, 28, 28, 28, 28);
  }, [engine, shown, origin, focusId]);

  // 가게를 고르면 그 자리로만 부드럽게 이동한다 (확대 배율은 사용자가 맞춘 그대로 유지)
  useEffect(() => {
    const p = places.find((x) => x.id === focusId);
    if (!p || p.lat == null || p.lng == null) return;
    if (kakaoRef.current) {
      const { ns, map } = kakaoRef.current;
      map.panTo(new ns.maps.LatLng(p.lat, p.lng));
    } else if (leafletRef.current) {
      leafletRef.current.map.panTo([p.lat, p.lng]);
    }
  }, [focusId, places]);

  const focused = places.find((p) => p.id === focusId);
  // 휴대폰에서는 상세가 목록 아래에 있어 안 보인다 — 고르면 그 자리로 부드럽게 내려준다
  useEffect(() => {
    if (!focusId || typeof window === "undefined" || window.innerWidth >= 1024) return;
    detailRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusId]);

  const distOf = (p: FoodPlace) => (origin && p.lat != null && p.lng != null ? distKm(origin, { lat: p.lat, lng: p.lng }) : null);

  return (
    <div className="space-y-4">
      {/* ── 헤더: 미식 가이드북 느낌의 한 판 (짙은 잉크 + 은은한 온기) ── */}
      <section className="relative overflow-hidden rounded-3xl bg-[#171B22] p-5 text-white shadow-[0_20px_50px_-30px_rgba(15,23,42,0.6)] sm:p-6">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-orange-500/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="relative">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-2xl bg-orange-500/15 text-lg ring-1 ring-inset ring-orange-400/30">🍴</span>
                <div>
                  <h2 className="text-[22px] font-black leading-tight tracking-tight">맛동여지도</h2>
                  <p className="text-[11px] font-semibold tracking-wide text-slate-400">주차 되는 맛집, 팀이 같이 쌓는 지도</p>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setBulk(""); setBulkLog([]); }}
                className="rounded-full bg-white/10 px-3.5 py-2 text-[13px] font-black text-slate-200 ring-1 ring-inset ring-white/10 transition hover:bg-white/20">여러 개 붙여넣기</button>
              <button type="button" onClick={() => { setMenuPaste(null); setCands(null); setLookup(""); setForm(emptyForm()); }}
                className="rounded-full bg-orange-500 px-4 py-2 text-[13px] font-black text-white shadow-lg shadow-orange-900/30 transition hover:bg-orange-400">＋ 맛집 올리기</button>
            </div>
          </div>

          {/* 현황 — 숫자가 먼저 보이게 */}
          <div className="mt-4 grid grid-cols-3 gap-2 sm:max-w-md">
            {[
              { n: places.length, label: "등록된 곳" },
              { n: places.filter((x) => ["가능", "유료", "발렛"].includes(x.parking)).length, label: "주차 가능" },
              { n: places.filter((x) => (x.photos || []).length > 0).length, label: "사진 있음" },
            ].map((s2) => (
              <div key={s2.label} className="rounded-2xl bg-white/[0.06] px-3 py-2 ring-1 ring-inset ring-white/10">
                <div className="text-[19px] font-black tabular-nums leading-none">{s2.n}</div>
                <div className="mt-1 text-[10px] font-bold tracking-wide text-slate-400">{s2.label}</div>
              </div>
            ))}
          </div>

          {/* 검색 */}
          <div className="mt-4 flex items-center gap-2 rounded-2xl bg-white/[0.07] px-3 py-2 ring-1 ring-inset ring-white/10 focus-within:ring-orange-400/50">
            <span aria-hidden className="text-slate-400">🔍</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="가게 · 메뉴 · 주소 · 올린 사람"
              className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-white outline-none placeholder:text-slate-500" />
            {q && <button type="button" onClick={() => setQ("")} className="rounded-full px-2 text-slate-400 hover:text-white">✕</button>}
            <button type="button" onClick={() => void useAddressOrigin()} disabled={!q.trim()}
              className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-black text-slate-200 transition hover:bg-white/20 disabled:opacity-30">이 주소 기준</button>
          </div>

          {/* 필터 — 한 줄에서 옆으로 스크롤 (줄바꿈으로 헤더가 커지지 않게) */}
          <div className="mt-3 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button type="button" onClick={() => setOnlyParking((v) => !v)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-black transition ${onlyParking ? "bg-emerald-500 text-white shadow shadow-emerald-900/30" : "bg-white/10 text-slate-300 ring-1 ring-inset ring-white/10 hover:bg-white/20"}`}>🅿 주차 가능만</button>
            <button type="button" onClick={useMyLocation}
              className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-black text-slate-300 ring-1 ring-inset ring-white/10 transition hover:bg-white/20">📍 내 위치 가까운 순</button>
            {origin && (
              <button type="button" onClick={() => setOrigin(null)}
                className="shrink-0 rounded-full bg-rose-500/20 px-3 py-1.5 text-[12px] font-black text-rose-200 ring-1 ring-inset ring-rose-400/30">기준 해제 · {origin.label}</button>
            )}
            <span aria-hidden className="mx-1 shrink-0 self-center text-white/15">|</span>
            {["", "A", "B", "C", "D", "E"].map((t) => (
              <button key={t || "all"} type="button" onClick={() => setTeamFilter(t)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-black transition ${teamFilter === t ? "bg-white text-slate-900" : "bg-white/10 text-slate-300 ring-1 ring-inset ring-white/10 hover:bg-white/20"}`}>
                {t ? `${t}팀` : "전체"}<span className="ml-1 opacity-50 tabular-nums">{places.filter((x) => !t || x.team === t).length}</span>
              </button>
            ))}
          </div>
          {gus.length > 0 && (
            <div className="mt-1.5 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <button type="button" onClick={() => setGu("")}
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black transition ${!gu ? "bg-orange-500/90 text-white" : "bg-white/[0.06] text-slate-400 hover:bg-white/15"}`}>전체 지역</button>
              {gus.map((g) => (
                <button key={g} type="button" onClick={() => setGu(g === gu ? "" : g)}
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black transition ${gu === g ? "bg-orange-500/90 text-white" : "bg-white/[0.06] text-slate-400 hover:bg-white/15"}`}>
                  {g}<span className="ml-1 opacity-50 tabular-nums">{places.filter((x) => x.gu === g).length}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr] lg:items-start">
        {/* ── 지도 ── */}
        <section className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_40px_-28px_rgba(15,23,42,0.25)] lg:sticky lg:top-4">
          <div ref={elRef} className="h-[340px] w-full bg-slate-100 sm:h-[480px]" />
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-1 rounded-2xl bg-white/85 px-2.5 py-1.5 shadow-sm ring-1 ring-slate-200/70 backdrop-blur">
            {(["가능", "유료", "발렛", "노상", "불가"] as const).map((k) => (
              <span key={k} className="flex items-center gap-1 px-1 text-[10px] font-black text-slate-600">
                <span className="h-2 w-2 rounded-full" style={{ background: PARKING_COLOR[k] }} />{k}
              </span>
            ))}
          </div>
        </section>

        {/* ── 목록 ── */}
        <section className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_40px_-28px_rgba(15,23,42,0.25)]">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div className="text-[13px] font-black text-slate-900">{shown.length}<span className="ml-0.5 text-slate-400">곳</span></div>
            <div className="text-[11px] font-bold tracking-wide text-slate-400">{origin ? `${origin.label} 기준 가까운 순` : "추천 많은 순"}</div>
          </div>
          {!shown.length && (
            <div className="px-6 py-14 text-center">
              <div className="text-4xl">{places.length ? "🔍" : "🍽️"}</div>
              <div className="mt-3 text-[14px] font-black text-slate-700">{places.length ? "조건에 맞는 곳이 없어요" : "첫 맛집을 올려 주세요"}</div>
              <div className="mt-1 text-[12px] font-semibold text-slate-400">{places.length ? "필터를 풀거나 다른 이름으로 찾아보세요" : "이름만 넣으면 주소·전화·위치는 알아서 채워집니다"}</div>
              {!places.length && (
                <button type="button" onClick={() => { setMenuPaste(null); setForm(emptyForm()); }}
                  className="mt-4 rounded-full bg-orange-500 px-4 py-2 text-[13px] font-black text-white shadow-lg shadow-orange-900/20 hover:bg-orange-400">＋ 맛집 올리기</button>
              )}
            </div>
          )}
          <ul className="max-h-[560px] divide-y divide-slate-100 overflow-y-auto">
            {shown.map((p) => {
              const d = distOf(p);
              const thumb = (p.photos || [])[0] || "";
              const menus = topMenus(p, 2);
              const on = focusId === p.id;
              return (
                <li key={p.id} className={`border-l-[3px] transition ${on ? "border-orange-500 bg-orange-50/50" : "border-transparent hover:bg-slate-50/80"}`}>
                  <button type="button" onClick={() => setFocusId(p.id)} className="flex w-full gap-3 px-4 py-3.5 text-left">
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[15px] font-black leading-tight tracking-tight text-slate-900">{p.name}</span>
                        {p.category && <span className="text-[11px] font-bold tracking-wide text-slate-400">{p.category}</span>}
                        {p.rating > 0 && <span className="text-[11px] font-black tracking-tight text-amber-500">{stars(p.rating)}</span>}
                        {d != null && <span className="ml-auto shrink-0 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-black tabular-nums text-white">{distLabel(d)}</span>}
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black ${PARKING_TONE[p.parking]}`}>
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: PARKING_COLOR[p.parking] }} />주차 {p.parking}
                        </span>
                        {p.parking_memo && <span className="min-w-0 truncate text-[11px] font-bold text-emerald-700">{p.parking_memo}</span>}
                        {p.lat == null && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-400">지도 미표시</span>}
                      </span>
                      {menus.length > 0
                        ? <span className="mt-1 block truncate text-[12px] font-semibold text-slate-600">{menus.map((m) => `${m.signature ? "⭐ " : ""}${m.name}${m.price ? ` ${m.price}` : ""}`).join("   ")}</span>
                        : (p.menu || p.price) && <span className="mt-1 block truncate text-[12px] font-semibold text-slate-600">{p.menu}{p.price ? ` · ${p.price}` : ""}</span>}
                      <span className="mt-1.5 flex flex-wrap items-center gap-1">
                        {(p.tags || []).slice(0, 3).map((t) => <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">#{t}</span>)}
                        <span className="ml-auto truncate text-[10px] font-semibold tracking-wide text-slate-400">{p.gu || p.address.slice(0, 12)} · {p.author}{p.team ? ` ${p.team}팀` : ""}</span>
                      </span>
                    </span>
                    {thumb
                      ? <img src={thumb} alt="" loading="lazy" className="h-[84px] w-[84px] shrink-0 rounded-2xl object-cover ring-1 ring-slate-200/60" />
                      : <span className="grid h-[84px] w-[84px] shrink-0 place-items-center rounded-2xl bg-slate-50 text-xl text-slate-300 ring-1 ring-slate-200/60">🍴</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {/* ── 하단 상세 — 사진 위에 이름을 얹는 가이드북 카드 ── */}
      <section ref={detailRef} className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_40px_-28px_rgba(15,23,42,0.25)]">
        {!focused ? (
          <div className="px-6 py-12 text-center">
            <div className="text-3xl">👆</div>
            <div className="mt-2 text-[13px] font-bold text-slate-500">지도의 핀이나 목록에서 가게를 고르면</div>
            <div className="text-[13px] font-bold text-slate-500">사진 · 메뉴판 · 주차 정보가 여기 펼쳐집니다</div>
          </div>
        ) : (
          <>
            <div className="relative">
              {(focused.photos || []).length > 0 ? (
                <>
                  <button type="button" onClick={() => setViewer({ urls: focused.photos, at: 0 })} className="block w-full">
                    <img src={focused.photos[0]} alt="" className="h-52 w-full object-cover sm:h-64" />
                  </button>
                  {focused.photos.length > 1 && (
                    <div className="absolute bottom-3 right-3 flex gap-1.5">
                      {focused.photos.slice(1, 5).map((url, i) => (
                        <button key={url} type="button" onClick={() => setViewer({ urls: focused.photos, at: i + 1 })}>
                          <img src={url} alt="" loading="lazy" className="h-14 w-14 rounded-xl object-cover ring-2 ring-white/70 transition hover:ring-white" />
                        </button>
                      ))}
                      {focused.photos.length > 5 && (
                        <button type="button" onClick={() => setViewer({ urls: focused.photos, at: 5 })}
                          className="grid h-14 w-14 place-items-center rounded-xl bg-black/55 text-[12px] font-black text-white ring-2 ring-white/70 backdrop-blur">+{focused.photos.length - 5}</button>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="grid h-32 w-full place-items-center bg-gradient-to-br from-slate-100 to-orange-50 sm:h-40">
                  <div className="text-center">
                    <div className="text-3xl opacity-40">📷</div>
                    <div className="mt-1 text-[11px] font-bold text-slate-400">사진이 없어요 — [수정]에서 올려 주세요</div>
                  </div>
                </div>
              )}
              <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-4">
                <div className="flex flex-wrap items-end gap-x-2 gap-y-1">
                  <h3 className="text-[21px] font-black leading-tight tracking-tight text-white drop-shadow">{focused.name}</h3>
                  {focused.category && <span className="pb-0.5 text-[12px] font-bold text-white/70">{focused.category}</span>}
                  {focused.rating > 0 && <span className="pb-0.5 text-[13px] font-black text-amber-300 drop-shadow">{stars(focused.rating)}</span>}
                  <span className="ml-auto pb-0.5 text-[11px] font-bold text-white/70">{focused.author}{focused.team ? ` · ${focused.team}팀` : ""}</span>
                </div>
              </div>
            </div>

            <div className="p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black ${PARKING_TONE[focused.parking]}`}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: PARKING_COLOR[focused.parking] }} />주차 {focused.parking}
                </span>
                {distOf(focused) != null && <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-black tabular-nums text-white">{distLabel(distOf(focused) as number)}</span>}
                {focused.hours && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">🕒 {focused.hours}</span>}
                {(focused.tags || []).map((t) => <span key={t} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500">#{t}</span>)}
              </div>
              <div className="mt-2 text-[12px] font-semibold leading-5 text-slate-500">
                {focused.address}{focused.address_detail ? ` · ${focused.address_detail}` : ""}
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_1.1fr]">
                <div className="space-y-2">
                  {focused.parking_memo && (
                    <div className="rounded-2xl bg-emerald-50 p-3 ring-1 ring-inset ring-emerald-100">
                      <div className="text-[10px] font-black tracking-wide text-emerald-600">주차 안내</div>
                      <div className="mt-0.5 text-[13px] font-bold leading-5 text-emerald-900">{focused.parking_memo}</div>
                    </div>
                  )}
                  {focused.memo && (
                    <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-100">
                      <div className="text-[10px] font-black tracking-wide text-slate-400">한마디</div>
                      <div className="mt-0.5 text-[13px] font-semibold leading-5 text-slate-700">{focused.memo}</div>
                    </div>
                  )}
                  {!focused.parking_memo && !focused.memo && (
                    <div className="rounded-2xl border border-dashed border-slate-200 p-3 text-[12px] font-semibold text-slate-400">주차 메모를 남겨 주면 다음 사람이 헤매지 않습니다</div>
                  )}
                </div>

                <div>
                  <div className="flex items-baseline justify-between">
                    <div className="text-[10px] font-black tracking-wide text-slate-400">메뉴</div>
                    {(focused.menus || []).length > 0 && <div className="text-[10px] font-bold text-slate-300">{focused.menus.length}개</div>}
                  </div>
                  {(focused.menus || []).length > 0 ? (
                    <ul className="mt-1.5 space-y-1.5">
                      {focused.menus.map((m) => (
                        <li key={m.name} className="flex items-baseline gap-2">
                          {m.signature && <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-black text-amber-700">대표</span>}
                          <span className="shrink-0 text-[13px] font-bold text-slate-800">{m.name}</span>
                          <span aria-hidden className="mx-0.5 min-w-4 flex-1 translate-y-[-3px] border-b border-dotted border-slate-300" />
                          <span className="shrink-0 text-[13px] font-black tabular-nums text-slate-900">{m.price || "—"}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="mt-1.5 rounded-2xl border border-dashed border-slate-200 p-3 text-[12px] font-semibold leading-5 text-slate-400">
                      {focused.menu ? <span className="text-slate-600">{focused.menu}{focused.price ? ` · ${focused.price}` : ""}</span> : "아직 메뉴가 없어요"}
                      <br />[수정]에서 <b className="text-slate-500">메뉴판 사진</b>을 넣으면 AI가 이름·가격을 읽어 채웁니다
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3.5">
                <a href={naverMapLink(`${focused.name} ${focused.address}`)} target="_blank" rel="noreferrer"
                  className="rounded-full bg-emerald-600 px-3.5 py-2 text-[12px] font-black text-white shadow-sm transition hover:bg-emerald-500">네이버 길찾기</a>
                <a href={kakaoMapSearchLink(`${focused.name} ${focused.address}`)} target="_blank" rel="noreferrer"
                  className="rounded-full bg-amber-400 px-3.5 py-2 text-[12px] font-black text-slate-900 shadow-sm transition hover:bg-amber-300">카카오맵</a>
                {focused.tel && <a href={`tel:${focused.tel.replace(/[^0-9+]/g, "")}`} className="rounded-full bg-slate-900 px-3.5 py-2 text-[12px] font-black text-white transition hover:bg-slate-800">📞 {focused.tel}</a>}
                <button type="button" onClick={() => void like(focused)}
                  className="rounded-full border border-rose-200 bg-rose-50/50 px-3.5 py-2 text-[12px] font-black text-rose-600 transition hover:bg-rose-50">👍 추천 {focused.likes}</button>
                <button type="button" onClick={() => edit(focused)}
                  className="ml-auto rounded-full border border-slate-200 px-3.5 py-2 text-[12px] font-black text-slate-600 transition hover:bg-slate-50">사진·메뉴 채우기</button>
                <button type="button" onClick={() => void remove(focused)}
                  className="rounded-full border border-slate-200 px-3 py-2 text-[12px] font-black text-slate-400 transition hover:bg-slate-50">삭제</button>
              </div>
            </div>
          </>
        )}
      </section>

      {viewer && (
        <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/80 p-3" onMouseDown={() => setViewer(null)}>
          <img src={viewer.urls[viewer.at]} alt="" className="max-h-[86vh] max-w-full rounded-xl object-contain" onMouseDown={(e) => e.stopPropagation()} />
          {viewer.urls.length > 1 && (
            <div className="absolute bottom-5 flex gap-2" onMouseDown={(e) => e.stopPropagation()}>
              {viewer.urls.map((u, i) => (
                <button key={u} type="button" onClick={() => setViewer({ ...viewer, at: i })} className={`h-2.5 w-2.5 rounded-full ${i === viewer.at ? "bg-white" : "bg-white/40"}`} aria-label={`${i + 1}번째 사진`} />
              ))}
            </div>
          )}
          <button type="button" onClick={() => setViewer(null)} className="absolute right-4 top-4 rounded-full bg-white/15 px-3 py-1.5 text-sm font-black text-white">닫기 ✕</button>
        </div>
      )}

      {bulk != null && (
        <div className="fixed inset-0 z-[160] flex items-end bg-slate-950/50 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4" onMouseDown={() => { if (!busy) setBulk(null); }}>
          <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-3xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="text-[20px] font-black tracking-tight text-slate-950">여러 개 한 번에 올리기{preview ? ` — ${preview.length}곳 확인` : ""}</div>
            {!preview ? (
              <>
                <div className="mt-1 text-[12px] font-semibold leading-5 text-slate-500">
                  <b>네이버지도 "저장" 목록을 쭉 긁어 붙여넣으면</b> 그대로 읽습니다(가게명·주소·내 메모의 주차 문구까지). 한 줄 형식 <code className="rounded bg-slate-100 px-1">이름 | 주소 | 주차메모</code>도 됩니다.
                  주소가 없으면 가게명으로 좌표를 찾습니다.
                </div>
                <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={10} autoFocus placeholder={"네이버지도 저장목록 복사본을 여기에…\n\n또는\n삼겹살집 | 서울 강남구 테헤란로 1 | 건물 지하 2시간 무료"}
                  className="mt-3 w-full resize-y rounded-xl border border-slate-300 px-3 py-2.5 font-mono text-[12px] leading-5 outline-none focus:border-blue-500" />
                <div className="mt-4 flex gap-2">
                  <button type="button" onClick={() => setBulk(null)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-black text-slate-500">닫기</button>
                  <button type="button" disabled={!bulk.trim()} onClick={buildPreview} className="flex-[2] rounded-xl bg-slate-900 py-2.5 text-sm font-black text-white shadow disabled:opacity-50">해석해서 확인하기</button>
                </div>
              </>
            ) : (
              <>
                <div className="mt-1 text-[12px] font-semibold text-slate-500">잘못 읽힌 건 ✕로 빼고 올리세요. 업종·메뉴·사진·별점은 올린 뒤 [수정]으로 채울 수 있습니다.</div>
                <ul className="mt-3 max-h-[46vh] divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                  {preview.map((r, i) => (
                    <li key={`${r.name}-${i}`} className="flex items-start gap-2 px-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[13px] font-black text-slate-900">{r.name}</span>
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${PARKING_TONE[r.parking]}`}>🅿 {r.parking}</span>
                          {places.some((p) => p.name === r.name) && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-400">이미 있음 → 건너뜀</span>}
                        </span>
                        <span className="block truncate text-[11px] text-slate-500">{r.address || "(주소 없음 — 이름으로 검색)"}</span>
                        {(r.parkingMemo || r.memo) && <span className="block text-[11px] text-emerald-800">{[r.parkingMemo, r.memo].filter(Boolean).join(" · ")}</span>}
                      </span>
                      <button type="button" onClick={() => setPreview(preview.filter((_, j) => j !== i))} className="shrink-0 rounded-full px-2 py-0.5 text-[12px] font-black text-slate-400 hover:bg-rose-50 hover:text-rose-500">✕</button>
                    </li>
                  ))}
                </ul>
                {bulkLog.length > 0 && <div className="mt-2 max-h-28 overflow-y-auto rounded-lg bg-slate-50 px-3 py-2 text-[11px] font-semibold leading-5 text-slate-600">{bulkLog.map((l, i) => <div key={i}>{l}</div>)}</div>}
                <div className="mt-4 flex gap-2">
                  <button type="button" disabled={busy} onClick={() => setPreview(null)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-black text-slate-500">← 다시 붙여넣기</button>
                  <button type="button" disabled={busy || !preview.length} onClick={() => void runBulk()} className="flex-[2] rounded-xl bg-orange-500 py-3 text-sm font-black text-white shadow-lg shadow-orange-900/20 transition hover:bg-orange-400 disabled:opacity-50">{busy ? "올리는 중…" : `${preview.length}곳 올리기`}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {form && (
        <div className="fixed inset-0 z-[160] flex items-end bg-slate-950/50 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4" onMouseDown={() => { if (!busy && !photoBusy) setForm(null); }}>
          <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-3xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="text-[20px] font-black tracking-tight text-slate-950">{form.id ? "맛집 수정" : "맛집 올리기"}</div>
            <div className="mt-0.5 text-[11px] font-semibold text-slate-400">주소를 넣으면 좌표를 찍어 지도에 올립니다 · 주차 정보를 꼭 적어 주세요</div>
            {/* 이름만 치면 업종·주소·전화·좌표가 알아서 들어온다 (카카오·네이버 검색) */}
            <div className="mt-3 rounded-2xl bg-orange-50/70 p-3 ring-1 ring-inset ring-orange-200/70">
              <div className="text-[11px] font-black tracking-wide text-orange-700">가게 이름으로 찾기 — 업종·주소·전화·위치를 알아서 채웁니다</div>
              <div className="mt-1.5 flex gap-1.5">
                <input value={lookup} onChange={(e) => setLookup(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void runLookup(); } }}
                  placeholder="예: 야키토리히타 / 강남 삼겹살" className="min-w-0 flex-1 rounded-xl border border-orange-200 bg-white px-3 py-2.5 text-sm font-semibold outline-none transition focus:border-orange-400" />
                <button type="button" disabled={lookupBusy || lookup.trim().length < 2} onClick={() => void runLookup()}
                  className="shrink-0 rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-orange-400 disabled:opacity-40">{lookupBusy ? "찾는 중…" : "검색"}</button>
                {form.name.trim().length >= 2 && !cands && (
                  <button type="button" disabled={lookupBusy} onClick={() => void runLookup(form.name)} className="shrink-0 rounded-xl border border-orange-200 bg-white px-3 py-2.5 text-[12px] font-black text-orange-700 transition hover:bg-orange-50 disabled:opacity-40">이 이름으로</button>
                )}
              </div>
              {cands && (
                cands.length ? (
                  <ul className="mt-2 max-h-56 divide-y divide-orange-100 overflow-y-auto rounded-xl border border-orange-200 bg-white">
                    {cands.map((c, i) => (
                      <li key={`${c.name}-${i}`}>
                        <button type="button" onClick={() => pickCandidate(c)} className="w-full px-3 py-2.5 text-left transition hover:bg-orange-50">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[13px] font-black text-slate-900">{c.name}</span>
                            {c.category && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{c.category}</span>}
                            <span className="ml-auto text-[10px] font-bold text-slate-400">{c.source}</span>
                          </span>
                          <span className="block truncate text-[11px] font-semibold text-slate-500">{c.roadAddress || c.address}{c.tel ? ` · ${c.tel}` : ""}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : <div className="mt-2 text-[11px] font-bold text-slate-500">결과가 없어요 — 이름을 조금 다르게 넣어 보세요</div>
              )}
              <div className="mt-1.5 text-[10px] font-semibold leading-4 text-orange-700/70">사진·메뉴는 지도 회사가 API로 주지 않습니다 — 아래 사진 올리기와 메뉴 자동 읽기를 쓰세요</div>
            </div>
            <div className="mt-3 space-y-2">
              <div className="grid grid-cols-[1fr_8rem] gap-2">
                <input value={form.name} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="가게 이름 *" className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm font-semibold outline-none transition focus:border-orange-400 focus:bg-white" />
                <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="업종(이자카야)" className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm font-semibold outline-none transition focus:border-orange-400 focus:bg-white" />
              </div>
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value, lat: null, lng: null })} placeholder="주소 (예: 서울 강남구 테헤란로 152)" className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm font-semibold outline-none transition focus:border-orange-400 focus:bg-white" />
              <input value={form.address_detail} onChange={(e) => setForm({ ...form, address_detail: e.target.value })} placeholder="상세 (건물·층, 선택)" className="w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm font-semibold outline-none transition focus:border-orange-400 focus:bg-white" />
              <div className="grid grid-cols-2 gap-2">
                <input value={form.tel} onChange={(e) => setForm({ ...form, tel: e.target.value })} placeholder="전화 (선택)" className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm font-semibold outline-none transition focus:border-orange-400 focus:bg-white" />
                <input value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} placeholder="영업시간 (예: 17:00~24시)" className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm font-semibold outline-none transition focus:border-orange-400 focus:bg-white" />
              </div>

              {/* 사진 — 폰 사진은 자동으로 줄여 올린다 */}
              <div className="rounded-2xl bg-slate-50/70 p-3 ring-1 ring-inset ring-slate-200/70">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-black text-slate-500">사진 {form.photos.length}/{MAX_PHOTOS}</div>
                  <label className={`cursor-pointer rounded-full px-3 py-1 text-[11px] font-black ${photoBusy ? "bg-slate-200 text-slate-400" : "bg-slate-900 text-white"}`}>
                    {photoBusy ? "올리는 중…" : "＋ 사진 고르기"}
                    <input type="file" accept="image/*" multiple disabled={photoBusy} className="hidden" onChange={(e) => { void addPhotos(e.target.files); e.currentTarget.value = ""; }} />
                  </label>
                </div>
                {form.photos.length > 0 && (
                  <div className="mt-2 flex gap-1.5 overflow-x-auto">
                    {form.photos.map((url, i) => (
                      <div key={url} className="relative shrink-0">
                        <img src={url} alt="" className="h-20 w-20 rounded-lg object-cover" />
                        {i === 0 && <span className="absolute left-1 top-1 rounded bg-blue-600 px-1 py-0.5 text-[9px] font-black text-white">대표</span>}
                        <button type="button" onClick={() => setForm({ ...form, photos: form.photos.filter((_, j) => j !== i) })} className="absolute -right-1 -top-1 h-5 w-5 rounded-full bg-slate-900 text-[11px] font-black text-white">✕</button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-1 text-[10px] font-semibold text-slate-400">첫 장이 목록 썸네일로 쓰입니다</div>
              </div>

              {/* 메뉴 — 네이버지도 메뉴 탭을 긁어 붙이면 이름·가격·대표까지 한 번에 */}
              <div className="rounded-2xl bg-slate-50/70 p-3 ring-1 ring-inset ring-slate-200/70">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-black text-slate-500">메뉴 {form.menus.length}개</div>
                  <div className="flex flex-wrap gap-1.5">
                    <label className={`cursor-pointer rounded-full px-3 py-1 text-[11px] font-black ${menuBusy ? "bg-slate-200 text-slate-400" : "bg-orange-500 text-white shadow-sm"}`}>
                      {menuBusy ? "읽는 중…" : "📷 메뉴 사진에서 자동"}
                      <input type="file" accept="image/*" disabled={menuBusy} className="hidden" onChange={(e) => { void readMenuPhoto(e.target.files); e.currentTarget.value = ""; }} />
                    </label>
                    <button type="button" onClick={() => setMenuPaste(menuPaste == null ? "" : null)} className="rounded-full bg-emerald-600 px-3 py-1 text-[11px] font-black text-white">글자 붙여넣기</button>
                    <button type="button" onClick={() => setForm({ ...form, menus: [...form.menus, { name: "", price: "" }] })} className="rounded-full border border-slate-300 px-3 py-1 text-[11px] font-black text-slate-600">＋ 한 줄</button>
                  </div>
                </div>
                {menuPaste != null && (
                  <div className="mt-2 rounded-lg bg-slate-50 p-2">
                    <textarea value={menuPaste} onChange={(e) => setMenuPaste(e.target.value)} rows={5} placeholder={"네이버지도 메뉴 화면을 쭉 긁어 붙여넣기\n\n대표\n네기마(다리살+대파)\n3,900원\n히타하이볼\n9,000원"}
                      className="w-full resize-y rounded-lg border border-slate-300 px-2.5 py-2 font-mono text-[12px] leading-5 outline-none focus:border-emerald-500" />
                    <div className="mt-1.5 flex items-center gap-2">
                      <button type="button" disabled={!menuPaste.trim()}
                        onClick={() => {
                          const parsed = parseMenuBlock(menuPaste);
                          if (!parsed.length) { notify("메뉴를 못 읽었어요 — 이름과 가격 줄이 있는지 봐 주세요", "error"); return; }
                          const merged = [...form.menus.filter((m) => m.name.trim()), ...parsed.filter((p) => !form.menus.some((m) => m.name.trim() === p.name))];
                          setForm({ ...form, menus: merged });
                          setMenuPaste(null);
                          notify(`메뉴 ${parsed.length}개를 읽었습니다`, "success");
                        }}
                        className="rounded-full bg-emerald-600 px-3 py-1.5 text-[11px] font-black text-white disabled:opacity-40">읽어서 넣기</button>
                      <button type="button" onClick={() => setMenuPaste(null)} className="rounded-full border border-slate-300 px-3 py-1.5 text-[11px] font-black text-slate-500">취소</button>
                      {menuPaste.trim() && !looksLikeMenuBlock(menuPaste) && <span className="text-[10px] font-bold text-amber-600">가격 줄이 안 보여요 — 그래도 이름은 들어갑니다</span>}
                    </div>
                  </div>
                )}
                {form.menus.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {form.menus.map((m, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <button type="button" title="대표 메뉴" onClick={() => setForm({ ...form, menus: form.menus.map((x, j) => (j === i ? { ...x, signature: !x.signature } : x)) })}
                          className={`shrink-0 rounded px-1.5 py-1 text-[11px] font-black ${m.signature ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-400"}`}>대표</button>
                        <input value={m.name} onChange={(e) => setForm({ ...form, menus: form.menus.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} placeholder="메뉴 이름"
                          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-[13px] font-semibold outline-none focus:border-blue-500" />
                        <input value={m.price} onChange={(e) => setForm({ ...form, menus: form.menus.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)) })} placeholder="가격"
                          className="w-24 shrink-0 rounded-lg border border-slate-300 px-2.5 py-1.5 text-right text-[13px] font-semibold tabular-nums outline-none focus:border-blue-500" />
                        <button type="button" onClick={() => setForm({ ...form, menus: form.menus.filter((_, j) => j !== i) })} className="shrink-0 rounded-full px-2 py-1 text-[12px] font-black text-slate-400 hover:bg-rose-50 hover:text-rose-500">✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-1 text-[11px] font-black text-slate-500">주차</div>
                <div className="flex flex-wrap gap-1.5">
                  {PARKING.map((p) => <button key={p} type="button" onClick={() => setForm({ ...form, parking: p })} className={`rounded-full px-3 py-1.5 text-[12px] font-black transition ${form.parking === p ? "bg-slate-900 text-white shadow-sm" : "bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"}`}>{p}</button>)}
                </div>
                <input value={form.parking_memo} onChange={(e) => setForm({ ...form, parking_memo: e.target.value })} placeholder="주차 메모 (예: 건물 지하 1시간 무료, 옆 공영주차장)" className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm font-semibold outline-none transition focus:border-orange-400 focus:bg-white" />
              </div>
              <div className="grid grid-cols-[1fr_7rem] gap-2">
                <input value={form.menu} onChange={(e) => setForm({ ...form, menu: e.target.value })} placeholder="한 줄 추천 (메뉴판과 별개, 선택)" className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm font-semibold outline-none transition focus:border-orange-400 focus:bg-white" />
                <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="1인 가격" className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm font-semibold outline-none transition focus:border-orange-400 focus:bg-white" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-black text-slate-500">별점</span>
                {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" onClick={() => setForm({ ...form, rating: n })} className={`text-xl ${n <= form.rating ? "text-amber-400" : "text-slate-300"}`}>★</button>)}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {TAGS.map((t) => { const on = form.tags.includes(t); return <button key={t} type="button" onClick={() => setForm({ ...form, tags: on ? form.tags.filter((x) => x !== t) : [...form.tags, t] })} className={`rounded-full px-2.5 py-1.5 text-[11px] font-black transition ${on ? "bg-orange-500 text-white shadow-sm" : "bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"}`}>#{t}</button>; })}
              </div>
              <textarea value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} rows={2} placeholder="한 줄 메모 (선택)" className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm font-semibold outline-none transition focus:border-orange-400 focus:bg-white" />
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => { setForm(null); setMenuPaste(null); }} className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-black text-slate-500 transition hover:bg-slate-50">취소</button>
              <button type="button" disabled={busy || photoBusy} onClick={() => void save()} className="flex-[2] rounded-xl bg-orange-500 py-3 text-sm font-black text-white shadow-lg shadow-orange-900/20 transition hover:bg-orange-400 disabled:opacity-50">{busy ? "저장 중…" : photoBusy ? "사진 올리는 중…" : "저장"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
