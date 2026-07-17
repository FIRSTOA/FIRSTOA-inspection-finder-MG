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
  x: number;
  y: number;
};

const teams: Team[] = ["A", "B", "C", "D"];
const quarters: Quarter[] = [1, 2, 3, 4];
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

const places: MapPlace[] = [
  { id: 1, team: "A", quarter: 3, kind: "quarter", status: "due", name: "11SO클릭스벤처파트너스", device: "APEOSPORT-C2060 / 227683", address: "강북 권역", x: 23, y: 28 },
  { id: 2, team: "A", quarter: 3, kind: "contract", status: "contract", name: "25법률사무소 남산", device: "D420 / 792090564870", address: "강북 권역", x: 36, y: 44 },
  { id: 3, team: "B", quarter: 3, kind: "quarter", status: "done", name: "3NN아스크스토리디에스", device: "DocuCentre-V C3375", address: "강서 권역", x: 48, y: 32 },
  { id: 4, team: "B", quarter: 3, kind: "monthly", status: "monthly", name: "26S시티온전", device: "SL-X4225RX", address: "강서 권역", x: 58, y: 55 },
  { id: 5, team: "C", quarter: 3, kind: "contract", status: "urgent", name: "27NN세무회계컨설팅", device: "SL-X3220NR", address: "강남 권역", x: 67, y: 25 },
  { id: 6, team: "C", quarter: 3, kind: "quarter", status: "due", name: "21V미래에이비엠", device: "SL-X4220RX", address: "강남 권역", x: 74, y: 48 },
  { id: 7, team: "D", quarter: 3, kind: "monthly", status: "monthly", name: "18S인프라솔루션", device: "C3375", address: "경기 권역", x: 81, y: 68 },
  { id: 8, team: "D", quarter: 3, kind: "quarter", status: "done", name: "9SS유니메오", device: "AP C3060", address: "경기 권역", x: 55, y: 76 },
  { id: 9, team: "C", quarter: 2, kind: "quarter", status: "done", name: "계약종료C 26년2분기", device: "복합기 8대", address: "강남 권역", x: 44, y: 63 },
  { id: 10, team: "D", quarter: 4, kind: "contract", status: "contract", name: "계약종료D 26년4분기", device: "계약만료 예정", address: "경기 권역", x: 70, y: 72 },
];

function pct(done: number, total: number) {
  return total ? Math.round((done / total) * 100) : 0;
}

function ProgressBar({ value, color = "bg-blue-600" }: { value: number; color?: string }) {
  return <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>;
}

export default function WalkingMap() {
  const [team, setTeam] = useState<Team | "ALL">("ALL");
  const [quarter, setQuarter] = useState<Quarter>(3);
  const [kind, setKind] = useState<MapKind | "ALL">("ALL");
  const [selected, setSelected] = useState<MapPlace | null>(places[0]);

  const visible = useMemo(() => places.filter((place) =>
    (team === "ALL" || place.team === team) &&
    place.quarter === quarter &&
    (kind === "ALL" || place.kind === kind)
  ), [team, quarter, kind]);

  const total = visible.length;
  const checked = visible.filter((place) => place.kind !== "contract" && place.status === "done").length;
  const checkTarget = visible.filter((place) => place.kind !== "contract").length;
  const contracts = visible.filter((place) => place.kind === "contract").length;
  const contractDone = visible.filter((place) => place.kind === "contract" && place.status !== "urgent").length;
  const monthly = visible.filter((place) => place.kind === "monthly").length;

  const teamSummaries = teams.map((item) => {
    const list = places.filter((place) => place.team === item && place.quarter === quarter);
    const inspectionTotal = list.filter((place) => place.kind !== "contract").length;
    const inspectionDone = list.filter((place) => place.kind !== "contract" && place.status === "done").length;
    const contractTotal = list.filter((place) => place.kind === "contract").length;
    const contractCurrent = list.filter((place) => place.kind === "contract" && place.status !== "urgent").length;
    return { team: item, inspectionDone, inspectionTotal, contractCurrent, contractTotal };
  });

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-black text-blue-600">WORKIN MAP</div>
            <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950">ABCD팀 워킨맵 관리</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">분기점검, 매월점검, 계약종료 대상을 팀별로 지도에서 확인하는 초안 화면입니다.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:flex">
            <select value={team} onChange={(e) => setTeam(e.target.value as Team | "ALL")} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold">
              <option value="ALL">전체팀</option>
              {teams.map((item) => <option key={item} value={item}>{item}팀</option>)}
            </select>
            <select value={quarter} onChange={(e) => setQuarter(Number(e.target.value) as Quarter)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold">
              {quarters.map((item) => <option key={item} value={item}>{item}분기</option>)}
            </select>
            <select value={kind} onChange={(e) => setKind(e.target.value as MapKind | "ALL")} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold">
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

      <section className="grid gap-5 xl:grid-cols-[320px_1fr]">
        <aside className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-4">
            <div className="text-sm font-black text-slate-900">{team === "ALL" ? "ABCD팀" : `${team}팀`} {quarter}분기 대상</div>
            <div className="mt-1 text-xs font-semibold text-slate-400">총 {total}건 · 점검 {checked}/{checkTarget} · 계약 {contractDone}/{contracts} · 매월 {monthly}</div>
          </div>
          <div className="divide-y divide-slate-100">
            {visible.map((place) => (
              <button key={place.id} type="button" onClick={() => setSelected(place)} className={`w-full px-4 py-3 text-left transition hover:bg-slate-50 ${selected?.id === place.id ? "bg-blue-50" : "bg-white"}`}>
                <div className="flex items-start gap-3">
                  <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: statusMeta[place.status].color }} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-black text-slate-900">{place.name}</span>
                    <span className="mt-0.5 block truncate text-xs font-semibold text-slate-500">{place.device}</span>
                    <span className="mt-1 inline-flex rounded px-2 py-0.5 text-[10px] font-black tracking-tight text-white" style={{ background: statusMeta[place.status].color }}>{kindLabels[place.kind]} · {statusMeta[place.status].label}</span>
                  </span>
                </div>
              </button>
            ))}
            {!visible.length && <div className="p-10 text-center text-sm font-semibold text-slate-400">조건에 맞는 워크가 없습니다.</div>}
          </div>
        </aside>

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-sm font-black text-slate-900">지도 보기</div>
              <div className="text-xs font-semibold text-slate-400">실제 지도 연동 전까지 위치·색상·업무구분 규칙을 잡는 목업입니다.</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(statusMeta).map(([key, meta]) => <span key={key} className={`rounded px-2.5 py-1 text-xs font-black ${meta.bg}`}><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: meta.color }} />{meta.label}</span>)}
            </div>
          </div>

          <div className="relative min-h-[560px] bg-[#EAF2F8]">
            <div className="absolute inset-0 opacity-80" style={{
              backgroundImage: "linear-gradient(90deg, rgba(71,85,105,.16) 1px, transparent 1px), linear-gradient(rgba(71,85,105,.16) 1px, transparent 1px)",
              backgroundSize: "64px 64px",
            }} />
            <div className="absolute left-[8%] top-0 h-full w-5 rotate-12 bg-sky-200/70" />
            <div className="absolute left-[18%] top-[45%] h-3 w-[70%] -rotate-6 rounded-full bg-slate-300/70" />
            <div className="absolute left-[30%] top-[12%] h-3 w-[50%] rotate-[28deg] rounded-full bg-slate-300/70" />
            <div className="absolute bottom-0 right-0 h-44 w-80 rounded-tl-full bg-emerald-100/80" />
            <div className="absolute left-8 top-6 rounded bg-white/90 px-3 py-2 text-xs font-black text-slate-500 shadow-sm">도곡·강남 권역</div>
            <div className="absolute bottom-8 left-10 rounded bg-white/90 px-3 py-2 text-xs font-black text-slate-500 shadow-sm">강서·경기 권역</div>

            {visible.map((place) => (
              <button
                key={place.id}
                type="button"
                onClick={() => setSelected(place)}
                className="absolute -translate-x-1/2 -translate-y-full text-left"
                style={{ left: `${place.x}%`, top: `${place.y}%` }}
              >
                <span className={`block h-5 w-5 rotate-45 rounded-tl-full rounded-tr-full rounded-bl-full border-2 border-white shadow-lg transition ${selected?.id === place.id ? "scale-125" : "hover:scale-110"}`} style={{ background: statusMeta[place.status].color }} />
                <span className="mt-1 block max-w-[180px] truncate rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 shadow-sm">{place.id}{place.team}{place.name}</span>
              </button>
            ))}

            {selected && (
              <div className="absolute bottom-5 left-5 right-5 rounded-lg border border-slate-200 bg-white/95 p-4 shadow-lg lg:left-auto lg:w-[360px]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-black text-blue-600">{selected.team}팀 · {kindLabels[selected.kind]}</div>
                    <div className="mt-1 text-base font-black text-slate-950">{selected.name}</div>
                  </div>
                  <span className={`rounded px-2 py-1 text-xs font-black ${statusMeta[selected.status].bg}`}>{statusMeta[selected.status].label}</span>
                </div>
                <div className="mt-3 grid gap-2 text-sm">
                  <div><b className="text-slate-400">기기</b> <span className="font-semibold text-slate-700">{selected.device}</span></div>
                  <div><b className="text-slate-400">주소</b> <span className="font-semibold text-slate-700">{selected.address}</span></div>
                  <div><b className="text-slate-400">분기</b> <span className="font-semibold text-slate-700">{selected.quarter}분기</span></div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
