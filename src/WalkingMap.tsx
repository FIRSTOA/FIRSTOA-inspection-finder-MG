import { useMemo, useState } from "react";

type Team = "A" | "B" | "C" | "D";
type Quarter = 1 | 2 | 3 | 4;
type MapKind = "quarter" | "monthly" | "contract";
type MapStatus = "done" | "due" | "urgent" | "monthly" | "contract";

type MapPlace = {
  id: number;
  team: Team;
  quarter: Quarter;
  kind: MapKind;
  status: MapStatus;
  name: string;
  device: string;
  address: string;
  phone: string;
  memo: string[];
  x: number;
  y: number;
  color: string;
};

const teams: Team[] = ["A", "B", "C", "D"];
const quarters: Quarter[] = [1, 2, 3, 4];
const mapColors = ["#ff7f50", "#ffb11b", "#ff2f6d", "#a72caf", "#0082a6", "#27b34a", "#a968ff", "#8a6548", "#c3a17a", "#1aa7ec", "#1f7a49", "#333333"];

const kindLabels: Record<MapKind, string> = {
  quarter: "분기점검",
  monthly: "매월점검",
  contract: "계약종료",
};

const statusMeta: Record<MapStatus, { label: string; color: string; bg: string }> = {
  done: { label: "완료", color: "#0284C7", bg: "bg-sky-50 text-sky-700" },
  due: { label: "예정", color: "#22C55E", bg: "bg-emerald-50 text-emerald-700" },
  urgent: { label: "지연/긴급", color: "#F43F5E", bg: "bg-rose-50 text-rose-700" },
  monthly: { label: "매월", color: "#F59E0B", bg: "bg-amber-50 text-amber-700" },
  contract: { label: "계약종료", color: "#9333EA", bg: "bg-purple-50 text-purple-700" },
};

const initialPlaces: MapPlace[] = [
  { id: 1, team: "A", quarter: 3, kind: "quarter", status: "due", name: "11SO클릭스벤처파트너스(유)", device: "APEOSPORT-C2060 / 227683", address: "서울 강남구 강남대로 320", phone: "010-5422-5078", memo: ["방문주기 3개월", "계약종료년월 2606", "강남", "S"], x: 23, y: 28, color: mapColors[4] },
  { id: 2, team: "A", quarter: 3, kind: "contract", status: "contract", name: "25법률사무소 남산", device: "D420 / 792090564870", address: "강북 권역", phone: "02-000-0000", memo: ["계약종료월", "임대중", "3480"], x: 36, y: 44, color: mapColors[6] },
  { id: 3, team: "B", quarter: 3, kind: "quarter", status: "done", name: "3NN아스크스토리디에스", device: "DocuCentre-V C3375", address: "강서 권역", phone: "010-0000-1111", memo: ["방문완료", "일반"], x: 48, y: 32, color: mapColors[10] },
  { id: 4, team: "B", quarter: 3, kind: "monthly", status: "monthly", name: "26S시티온전", device: "SL-X4225RX", address: "강서 권역", phone: "010-0000-2222", memo: ["매월점검", "기본임대"], x: 58, y: 55, color: mapColors[1] },
  { id: 5, team: "C", quarter: 3, kind: "contract", status: "urgent", name: "27NN유어세무회계컨설팅", device: "SL-X3220NR", address: "강남 권역", phone: "010-1111-2222", memo: ["계약종료", "확인필요"], x: 67, y: 25, color: mapColors[2] },
  { id: 6, team: "C", quarter: 3, kind: "quarter", status: "due", name: "21V미래아이비엠", device: "SL-X4220RX", address: "강남 권역", phone: "010-2222-3333", memo: ["분기점검", "서울/강남구"], x: 74, y: 48, color: mapColors[4] },
  { id: 7, team: "D", quarter: 3, kind: "monthly", status: "monthly", name: "18S인프라솔루션", device: "C3375", address: "경기 권역", phone: "010-3333-4444", memo: ["매월점검"], x: 81, y: 68, color: mapColors[0] },
  { id: 8, team: "D", quarter: 3, kind: "quarter", status: "done", name: "9SS유니메오", device: "AP C3060", address: "경기 권역", phone: "010-4444-5555", memo: ["분기점검 완료"], x: 55, y: 76, color: mapColors[8] },
  { id: 9, team: "C", quarter: 2, kind: "quarter", status: "done", name: "계약종료C 26년2분기", device: "복합기 8대", address: "강남 권역", phone: "-", memo: ["과거분기 샘플"], x: 44, y: 63, color: mapColors[9] },
  { id: 10, team: "D", quarter: 4, kind: "contract", status: "contract", name: "계약종료D 26년4분기", device: "계약만료 예정", address: "경기 권역", phone: "-", memo: ["4분기 예정"], x: 70, y: 72, color: mapColors[11] },
];

function pct(done: number, total: number) {
  return total ? Math.round((done / total) * 100) : 0;
}

function ProgressBar({ value, color = "bg-blue-600" }: { value: number; color?: string }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export default function WalkingMap() {
  const [mapPlaces, setMapPlaces] = useState<MapPlace[]>(initialPlaces);
  const [team, setTeam] = useState<Team | "ALL">("ALL");
  const [quarter, setQuarter] = useState<Quarter>(3);
  const [kind, setKind] = useState<MapKind | "ALL">("ALL");
  const [selectedId, setSelectedId] = useState(initialPlaces[0].id);
  const [mapOpen, setMapOpen] = useState(false);

  const selected = mapPlaces.find((place) => place.id === selectedId) || mapPlaces[0];
  const setPlaceStatus = (id: number, status: MapStatus) => {
    setMapPlaces((prev) => prev.map((place) => (place.id === id ? { ...place, status } : place)));
  };
  const setPlaceColor = (id: number, color: string) => {
    setMapPlaces((prev) => prev.map((place) => (place.id === id ? { ...place, color } : place)));
  };

  const visible = useMemo(() => mapPlaces.filter((place) =>
    (team === "ALL" || place.team === team) &&
    place.quarter === quarter &&
    (kind === "ALL" || place.kind === kind)
  ), [mapPlaces, team, quarter, kind]);

  const total = visible.length;
  const checked = visible.filter((place) => place.kind !== "contract" && place.status === "done").length;
  const checkTarget = visible.filter((place) => place.kind !== "contract").length;
  const contracts = visible.filter((place) => place.kind === "contract").length;
  const contractDone = visible.filter((place) => place.kind === "contract" && place.status !== "urgent").length;
  const monthly = visible.filter((place) => place.kind === "monthly").length;

  const teamSummaries = teams.map((item) => {
    const rows = mapPlaces.filter((place) => place.team === item && place.quarter === quarter);
    const inspectionTotal = rows.filter((place) => place.kind !== "contract").length;
    const inspectionDone = rows.filter((place) => place.kind !== "contract" && place.status === "done").length;
    const contractTotal = rows.filter((place) => place.kind === "contract").length;
    const contractCurrent = rows.filter((place) => place.kind === "contract" && place.status !== "urgent").length;
    return { team: item, inspectionDone, inspectionTotal, contractCurrent, contractTotal };
  });

  const placeList = (
    <aside className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-4">
        <div className="text-sm font-black text-slate-900">{team === "ALL" ? "CS 전체" : `${team}팀`} {quarter}분기 대상</div>
        <div className="mt-1 text-xs font-semibold text-slate-400">총 {total}건 · 점검 {checked}/{checkTarget} · 계약 {contractDone}/{contracts} · 매월 {monthly}</div>
      </div>
      <div className="max-h-[420px] divide-y divide-slate-100 overflow-auto lg:max-h-[640px]">
        {visible.map((place) => (
          <button key={place.id} type="button" onClick={() => setSelectedId(place.id)} className={`w-full px-4 py-3 text-left transition hover:bg-slate-50 ${selected?.id === place.id ? "bg-blue-50" : "bg-white"}`}>
            <div className="flex items-start gap-3">
              <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: place.color }} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-black text-slate-900">{place.name}</span>
                <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">{place.device}</span>
                <span className="mt-1 inline-flex rounded px-2 py-0.5 text-[10px] font-black tracking-tight text-white" style={{ background: place.color }}>{kindLabels[place.kind]} · {statusMeta[place.status].label}</span>
              </span>
            </div>
          </button>
        ))}
        {!visible.length && <div className="p-10 text-center text-sm font-semibold text-slate-400">조건에 맞는 워크가 없습니다.</div>}
      </div>
    </aside>
  );

  const mapCanvas = (large = false) => (
    <div className={`relative overflow-hidden border border-slate-200 bg-[#EAF2F8] shadow-sm ${large ? "h-full min-h-0 rounded-none" : "min-h-[680px] rounded-lg lg:min-h-[calc(100vh-280px)]"}`}>
      <div className="absolute inset-0 opacity-80" style={{
        backgroundImage: "linear-gradient(90deg, rgba(71,85,105,.16) 1px, transparent 1px), linear-gradient(rgba(71,85,105,.16) 1px, transparent 1px)",
        backgroundSize: "64px 64px",
      }} />
      <div className="absolute left-[8%] top-0 h-full w-5 rotate-12 bg-sky-200/70" />
      <div className="absolute left-[18%] top-[45%] h-3 w-[70%] -rotate-6 rounded-full bg-slate-300/70" />
      <div className="absolute left-[30%] top-[12%] h-3 w-[50%] rotate-[28deg] rounded-full bg-slate-300/70" />
      <div className="absolute bottom-0 right-0 h-44 w-80 rounded-tl-full bg-emerald-100/80" />
      <div className="absolute left-8 top-6 rounded bg-white/90 px-3 py-2 text-xs font-black text-slate-500 shadow-sm">압구정 · 강남 권역</div>
      <div className="absolute bottom-8 left-10 rounded bg-white/90 px-3 py-2 text-xs font-black text-slate-500 shadow-sm">강서 · 경기 권역</div>

      {visible.map((place) => (
        <button key={place.id} type="button" onClick={() => setSelectedId(place.id)} className="absolute -translate-x-1/2 -translate-y-full text-left" style={{ left: `${place.x}%`, top: `${place.y}%` }}>
          <span className={`block h-5 w-5 rotate-45 rounded-tl-full rounded-tr-full rounded-bl-full border-2 border-white shadow-lg transition ${selected?.id === place.id ? "scale-125" : "hover:scale-110"}`} style={{ background: place.color }} />
          <span className="mt-1 block max-w-[180px] truncate rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 shadow-sm">{place.id}{place.team}{place.name}</span>
        </button>
      ))}

      {selected && (
        <div className="absolute bottom-5 left-5 right-5 max-h-[70%] overflow-auto rounded-lg border border-slate-200 bg-white/95 p-4 shadow-lg lg:left-auto lg:w-[380px]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-black text-blue-600">{selected.team}팀 · {kindLabels[selected.kind]}</div>
              <div className="mt-1 text-base font-black text-slate-950">{selected.name}</div>
            </div>
            <span className={`rounded px-2 py-1 text-xs font-black ${statusMeta[selected.status].bg}`}>{statusMeta[selected.status].label}</span>
          </div>
          <div className="mt-3 grid gap-2 text-sm">
            <div><b className="text-slate-400">주소</b> <span className="font-semibold text-slate-700">{selected.address}</span></div>
            <div><b className="text-slate-400">연락처</b> <span className="font-semibold text-slate-700">{selected.phone}</span></div>
            <div><b className="text-slate-400">기기</b> <span className="font-semibold text-slate-700">{selected.device}</span></div>
          </div>
          <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
            {selected.memo.map((memo, index) => (
              <div key={`${memo}-${index}`} className="rounded border border-slate-100 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">{memo}</div>
            ))}
          </div>
          <div className="mt-4">
            <div className="mb-2 text-xs font-black text-slate-400">12색 팔레트</div>
            <div className="flex flex-wrap gap-2">
              {mapColors.map((color) => (
                <button key={color} type="button" onClick={() => setPlaceColor(selected.id, color)} className={`h-7 w-7 rounded-full border-2 ${selected.color === color ? "border-slate-900" : "border-white"} shadow-sm`} style={{ background: color }} aria-label={`색상 ${color}`} />
              ))}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {(Object.keys(statusMeta) as MapStatus[]).map((status) => (
              <button key={status} type="button" onClick={() => setPlaceStatus(selected.id, status)} className={`rounded border px-2.5 py-1.5 text-xs font-black ${selected.status === status ? statusMeta[status].bg : "border-slate-200 bg-white text-slate-500"}`}>
                {statusMeta[status].label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-black text-blue-600">WORKIN MAP</div>
            <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950">CS 워킨맵</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">분기점검, 매월점검, 계약종료 대상을 지도와 목록으로 함께 관리합니다. 엑셀 업로드 구조는 워킨맵 양식 기준으로 맞춰갈 수 있습니다.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:flex">
            <select value={team} onChange={(event) => setTeam(event.target.value as Team | "ALL")} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold">
              <option value="ALL">전체팀</option>
              {teams.map((item) => <option key={item} value={item}>{item}팀</option>)}
            </select>
            <select value={quarter} onChange={(event) => setQuarter(Number(event.target.value) as Quarter)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold">
              {quarters.map((item) => <option key={item} value={item}>{item}분기</option>)}
            </select>
            <select value={kind} onChange={(event) => setKind(event.target.value as MapKind | "ALL")} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold">
              <option value="ALL">전체업무</option>
              {Object.entries(kindLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </div>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-4">
        {teamSummaries.map((item) => {
          const inspectionPct = pct(item.inspectionDone, item.inspectionTotal);
          const contractPct = pct(item.contractCurrent, item.contractTotal);
          return (
            <button key={item.team} type="button" onClick={() => setTeam(item.team)} className={`rounded-lg border p-4 text-left shadow-sm transition hover:-translate-y-0.5 ${team === item.team ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white"}`}>
              <div className="flex items-center justify-between">
                <div className="text-lg font-black text-slate-950">{item.team}팀</div>
                <div className="rounded bg-slate-900 px-2 py-1 text-xs font-black text-white">{quarter}Q</div>
              </div>
              <div className="mt-4 space-y-3">
                <div>
                  <div className="mb-1 flex justify-between text-xs font-bold text-slate-500"><span>점검률</span><span>{item.inspectionDone}/{item.inspectionTotal} · {inspectionPct}%</span></div>
                  <ProgressBar value={inspectionPct} />
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-xs font-bold text-slate-500"><span>계약률</span><span>{item.contractCurrent}/{item.contractTotal} · {contractPct}%</span></div>
                  <ProgressBar value={contractPct} color="bg-purple-600" />
                </div>
              </div>
            </button>
          );
        })}
      </section>

      <section className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        {placeList}
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-black text-slate-900">지도 보기</div>
              <div className="text-xs font-semibold text-slate-400">현재는 샘플 지도입니다. 추후 엑셀 위도/경도 업로드와 자동 완료 색칠을 연결하면 됩니다.</div>
            </div>
            <button type="button" onClick={() => setMapOpen(true)} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-black text-white">큰 지도 열기</button>
          </div>
          <div className="hidden lg:block">{mapCanvas(false)}</div>
        </div>
      </section>

      {mapOpen && (
        <div className="fixed inset-0 z-[120] bg-white" onMouseDown={() => setMapOpen(false)}>
          <div className="flex h-screen w-screen flex-col overflow-hidden bg-white" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <div className="text-lg font-black text-slate-950">CS 워킨맵 크게 보기</div>
                <div className="text-xs font-semibold text-slate-400">목록에서 거래처를 고르고 지도에서 색상과 상태를 바로 바꿀 수 있습니다.</div>
              </div>
              <button type="button" onClick={() => setMapOpen(false)} className="rounded-md border border-slate-200 px-3 py-2 text-sm font-black text-slate-600">닫기</button>
            </div>
            <div className="grid min-h-0 flex-1 bg-slate-50 lg:grid-cols-[320px_minmax(0,1fr)]">
              <div className="hidden min-h-0 lg:block">{placeList}</div>
              {mapCanvas(true)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
