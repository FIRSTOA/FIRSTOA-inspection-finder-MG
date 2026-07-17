import { useMemo, useState } from "react";
import { AUTHOR_TEAMS, useAuthorBook } from "./authors";

type Team = "A" | "B" | "C" | "D";
type AsStatus = "접수" | "배정" | "처리중" | "완료";

export type AsTicket = {
  id: string;
  team: Team;
  date: string;
  time: string;
  vendor: string;
  contact: string;
  address: string;
  model: string;
  serial: string;
  issue: string;
  assignee: string;
  status: AsStatus;
};

const teams: Team[] = ["A", "B", "C", "D"];
const statuses: AsStatus[] = ["접수", "배정", "처리중", "완료"];
const storageKey = "cs_as_tickets_v1";
const today = new Date();
const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

const defaultTickets: AsTicket[] = [
  { id: "as-1", team: "A", date: ymd, time: "09:30", vendor: "11SO클릭스벤처파트너스", contact: "010-0000-0000", address: "강북 권역", model: "APEOSPORT-C2060", serial: "227683", issue: "출력물 줄감 및 소음", assignee: "", status: "접수" },
  { id: "as-2", team: "B", date: ymd, time: "11:00", vendor: "25법률사무소 남산", contact: "02-000-0000", address: "강서 권역", model: "D420", serial: "792090564870", issue: "용지 걸림 반복", assignee: "이민구", status: "배정" },
  { id: "as-3", team: "C", date: ymd, time: "14:00", vendor: "27NN세무회계컨설팅", contact: "010-1111-2222", address: "강남 권역", model: "SL-X3220NR", serial: "0A6XBJWC000ANJ", issue: "스캔 전송 불가", assignee: "신정훈", status: "처리중" },
  { id: "as-4", team: "D", date: ymd, time: "16:30", vendor: "9SS유니메오", contact: "010-3333-4444", address: "경기 권역", model: "AP C3060", serial: "C3060-0001", issue: "토너 인식 오류", assignee: "박영현", status: "완료" },
];

function loadTickets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || "null");
    return Array.isArray(parsed) && parsed.length ? parsed as AsTicket[] : defaultTickets;
  } catch {
    return defaultTickets;
  }
}

function statusClass(status: AsStatus) {
  if (status === "완료") return "bg-blue-50 text-blue-700 border-blue-200";
  if (status === "처리중") return "bg-amber-50 text-amber-700 border-amber-200";
  if (status === "배정") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  return "bg-slate-50 text-slate-600 border-slate-200";
}

function buildAsRaw(ticket: AsTicket) {
  return [
    `업체명: ${ticket.vendor}`,
    `주소: ${ticket.address}`,
    `연락처: ${ticket.contact}`,
    `기종: ${ticket.model}`,
    `시리얼: ${ticket.serial}`,
    `접수내용: ${ticket.issue}`,
    `방문일정: ${ticket.date} ${ticket.time}`,
    `담당자: ${ticket.assignee || "미배정"}`,
  ].join("\n");
}

export function CsCalendar() {
  return <CsAsWorkspace view="calendar" />;
}

export function AsReception({ onUseField }: { onUseField: (rawText: string) => void }) {
  return <CsAsWorkspace view="as" onUseField={onUseField} />;
}

function CsAsWorkspace({ view, onUseField }: { view: "calendar" | "as"; onUseField?: (rawText: string) => void }) {
  const { book } = useAuthorBook();
  const authors = useMemo(() => AUTHOR_TEAMS.flatMap((team) => book[team]), [book]);
  const [tickets, setTicketsState] = useState<AsTicket[]>(loadTickets);
  const [team, setTeam] = useState<Team | "ALL">("ALL");

  const setTickets = (next: AsTicket[]) => {
    setTicketsState(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const update = (id: string, patch: Partial<AsTicket>) => setTickets(tickets.map((ticket) => ticket.id === id ? { ...ticket, ...patch } : ticket));
  const filtered = tickets.filter((ticket) => team === "ALL" || ticket.team === team);

  const teamSummary = teams.map((item) => {
    const list = tickets.filter((ticket) => ticket.team === item);
    const done = list.filter((ticket) => ticket.status === "완료").length;
    return { team: item, total: list.length, done };
  });

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-black text-blue-600">CS AS</div>
            <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950">{view === "calendar" ? "CS AS 캘린더" : "AS접수"}</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">A/B/C/D 팀별 AS 접수, 담당자 배정, 일정 확인, FIELD AS양식 연동 흐름을 잡은 예시 화면입니다.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setTeam("ALL")} className={`rounded-md px-3 py-2 text-sm font-black ${team === "ALL" ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>전체</button>
            {teams.map((item) => <button key={item} type="button" onClick={() => setTeam(item)} className={`rounded-md px-3 py-2 text-sm font-black ${team === item ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>{item}팀</button>)}
          </div>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-4">
        {teamSummary.map((item) => {
          const pct = item.total ? Math.round((item.done / item.total) * 100) : 0;
          return (
            <div key={item.team} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-lg font-black text-slate-950">{item.team}팀</div>
                <div className="text-xs font-black text-blue-600">{item.done}/{item.total} 완료</div>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${pct}%` }} /></div>
              <div className="mt-2 text-xs font-bold text-slate-400">AS 처리율 {pct}%</div>
            </div>
          );
        })}
      </section>

      {view === "calendar" ? (
        <section className="grid gap-4 xl:grid-cols-4">
          {teams.map((item) => (
            <div key={item} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
                <div className="text-sm font-black text-slate-900">{item}팀 AS 캘린더</div>
                <div className="text-xs font-semibold text-slate-400">{ymd}</div>
              </div>
              <div className="divide-y divide-slate-100">
                {tickets.filter((ticket) => ticket.team === item).map((ticket) => (
                  <div key={ticket.id} className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-black text-slate-900">{ticket.time} {ticket.vendor}</div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">{ticket.issue}</div>
                      </div>
                      <span className={`rounded border px-2 py-0.5 text-[11px] font-black ${statusClass(ticket.status)}`}>{ticket.status}</span>
                    </div>
                    <div className="mt-2 text-xs font-semibold text-slate-400">담당 {ticket.assignee || "미배정"} · {ticket.model}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      ) : (
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="grid border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs font-black text-slate-500 lg:grid-cols-[80px_120px_1fr_150px_160px_160px_130px]">
            <div>팀</div><div>일정</div><div>접수내용</div><div>기기</div><div>담당자</div><div>상태</div><div className="text-right">연동</div>
          </div>
          <div className="divide-y divide-slate-100">
            {filtered.map((ticket) => (
              <div key={ticket.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[80px_120px_1fr_150px_160px_160px_130px] lg:items-center">
                <div className="text-sm font-black text-slate-900">{ticket.team}팀</div>
                <div className="text-sm font-bold text-slate-600">{ticket.time}<div className="text-[11px] text-slate-400">{ticket.date}</div></div>
                <div>
                  <div className="text-sm font-black text-slate-900">{ticket.vendor}</div>
                  <div className="mt-1 text-xs font-semibold text-slate-500">{ticket.issue}</div>
                  <div className="mt-1 text-[11px] text-slate-400">{ticket.address} · {ticket.contact}</div>
                </div>
                <div className="text-sm font-semibold text-slate-600">{ticket.model}<div className="text-[11px] text-slate-400">{ticket.serial}</div></div>
                <select value={ticket.assignee} onChange={(e) => update(ticket.id, { assignee: e.target.value, status: e.target.value && ticket.status === "접수" ? "배정" : ticket.status })} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold">
                  <option value="">미배정</option>
                  {authors.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
                <select value={ticket.status} onChange={(e) => update(ticket.id, { status: e.target.value as AsStatus })} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold">
                  {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => onUseField?.(buildAsRaw(ticket))} className="rounded-md bg-slate-900 px-3 py-2 text-xs font-black text-white">FIELD AS</button>
                  <button type="button" onClick={() => update(ticket.id, { status: "완료" })} className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700">완료</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
