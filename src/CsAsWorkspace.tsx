import { useState } from "react";

type Team = "A" | "B" | "C" | "D";
type AsStatus = "접수" | "배정" | "처리중" | "완료" | "미루기";

export type AsTicket = {
  id: string;
  team: Team;
  date: string;
  time: string;
  vendor: string;
  contact: string;
  address: string;
  department: string;
  model: string;
  serial: string;
  issue: string;
  assignee: string;
  status: AsStatus;
};

const teams: Team[] = ["A", "B", "C", "D"];
const statuses: AsStatus[] = ["접수", "배정", "처리중", "완료", "미루기"];
const teamAssignees: Record<Team, string[]> = {
  A: ["김정민", "심태현", "정웅만", "신정훈"],
  B: ["권태혁", "조윤", "윤기준", "신정훈"],
  C: ["이홍진", "박영현", "이민구", "한왕주", "신정훈"],
  D: ["양승원", "김종희", "이호준", "신정훈"],
};
const storageKey = "cs_as_tickets_v2";
const today = new Date();
const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

const defaultTickets: AsTicket[] = [
  { id: "as-1", team: "A", date: ymd, time: "09:30", vendor: "11SO클릭스벤처파트너스", contact: "010-0000-0000", address: "강북 권역", department: "본사", model: "APEOSPORT-C2060", serial: "227683", issue: "출력물 줄감 및 소음", assignee: "", status: "접수" },
  { id: "as-2", team: "B", date: ymd, time: "11:00", vendor: "25법률사무소 남산", contact: "02-000-0000", address: "강서 권역", department: "사무실", model: "D420", serial: "792090564870", issue: "용지 걸림 반복", assignee: "권태혁", status: "배정" },
  { id: "as-3", team: "C", date: ymd, time: "14:00", vendor: "27NN세무회계컨설팅", contact: "010-1111-2222", address: "강남 권역", department: "회계팀", model: "SL-X3220NR", serial: "0A6XBJWC000ANJ", issue: "스캔 전송 불가", assignee: "이민구", status: "처리중" },
  { id: "as-4", team: "D", date: ymd, time: "16:30", vendor: "9SS유니메오", contact: "010-3333-4444", address: "경기 권역", department: "관리사무소", model: "AP C3060", serial: "C3060-0001", issue: "토너 인식 오류", assignee: "양승원", status: "완료" },
];

function loadTickets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || "null");
    return Array.isArray(parsed) && parsed.length ? parsed as AsTicket[] : defaultTickets;
  } catch {
    return defaultTickets;
  }
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00+09:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addMonths(date: string, months: number) {
  const d = new Date(`${date}T12:00:00+09:00`);
  d.setMonth(d.getMonth() + months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function statusClass(status: AsStatus) {
  if (status === "완료") return "bg-blue-50 text-blue-700 border-blue-200";
  if (status === "미루기") return "bg-purple-50 text-purple-700 border-purple-200";
  if (status === "처리중") return "bg-amber-50 text-amber-700 border-amber-200";
  if (status === "배정") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  return "bg-slate-50 text-slate-600 border-slate-200";
}

function buildFieldAsText(ticket: AsTicket, author: string) {
  return [
    `작성자:${author || ticket.assignee || ""}`,
    "구분: AS",
    "레벨:1",
    "등급:",
    `업체명:${ticket.vendor}`,
    `부서명:${ticket.department}`,
    `지역:${ticket.team}`,
    `키맨/접수자:${ticket.contact}`,
    "ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ",
    "1.",
    `모델명: ${ticket.model}`,
    `시리얼넘버: ${ticket.serial}`,
    "자산기번:",
    `내용: ${ticket.issue}`,
    "처리내용:",
    "매수:흑- 컬- 큰컬- 합-",
    "토너잔량:K- C- M- Y-",
    "폐통:  %",
    "여분: K- C- M- Y- 폐-",
    "한틴이카유무:",
    "주차비지원유무:",
    `특이사항: 방문일정 ${ticket.date} ${ticket.time} / 주소 ${ticket.address} / 담당 ${ticket.assignee || "미배정"}`,
    "ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ",
    "※부품신청※",
    "보증기간 내 여부 :",
    "교체 전 카운터 누적 사용매수 :",
    "사용 부품 예상 사용매수 :",
    "▶ 신청 부품",
    "물품명:",
    "수량:",
    "출고여부:",
    "ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ",
    "※자가신청※",
    "물품:",
    "수량:",
    "출고여부:",
    "ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ",
    `도착 시간: ${ticket.time}`,
    "소요 시간:",
  ].join("\n");
}

export function CsCalendar() {
  return <CsAsWorkspace view="calendar" />;
}

export function AsReception({ author, onUseField }: { author: string; onUseField: (fieldText: string) => void }) {
  return <CsAsWorkspace view="as" author={author} onUseField={onUseField} />;
}

function CsAsWorkspace({ view, author = "", onUseField }: { view: "calendar" | "as"; author?: string; onUseField?: (fieldText: string) => void }) {
  const [tickets, setTicketsState] = useState<AsTicket[]>(loadTickets);
  const [team, setTeam] = useState<Team | "ALL">("ALL");
  const [selectedId, setSelectedId] = useState<string>("as-1");
  const selected = tickets.find((ticket) => ticket.id === selectedId) || tickets[0];

  const setTickets = (next: AsTicket[]) => {
    setTicketsState(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const update = (id: string, patch: Partial<AsTicket>) => setTickets(tickets.map((ticket) => ticket.id === id ? { ...ticket, ...patch } : ticket));
  const filtered = tickets.filter((ticket) => team === "ALL" || ticket.team === team);
  const shownTeams = team === "ALL" ? teams : [team];

  const teamSummary = teams.map((item) => {
    const list = tickets.filter((ticket) => ticket.team === item);
    const done = list.filter((ticket) => ticket.status === "완료").length;
    return { team: item, total: list.length, done };
  });

  const deferTicket = (ticket: AsTicket, date: string) => update(ticket.id, { date, status: "미루기" });

  const ticketCard = (ticket: AsTicket) => (
    <button key={ticket.id} type="button" onClick={() => setSelectedId(ticket.id)} className={`block w-full p-4 text-left transition hover:bg-slate-50 ${selectedId === ticket.id ? "bg-blue-50" : "bg-white"}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-black text-slate-900">{ticket.time} {ticket.vendor}</div>
          <div className="mt-1 text-xs font-semibold text-slate-500">{ticket.issue}</div>
        </div>
        <span className={`rounded border px-2 py-0.5 text-[11px] font-black ${statusClass(ticket.status)}`}>{ticket.status}</span>
      </div>
      <div className="mt-2 text-xs font-semibold text-slate-400">담당 {ticket.assignee || "미배정"} · {ticket.model}</div>
    </button>
  );

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-black text-blue-600">CS AS</div>
            <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950">{view === "calendar" ? "CS AS 캘린더" : "AS접수"}</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">팀별 AS 접수, 담당자 배정, 일정 확인, FIELD AS양식 연동을 한 화면 흐름으로 잡았습니다.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setTeam("ALL")} className={`rounded-md px-3 py-2 text-sm font-black ${team === "ALL" ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>전체</button>
            {teams.map((item) => <button key={item} type="button" onClick={() => setTeam(item)} className={`rounded-md px-3 py-2 text-sm font-black ${team === item ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>{item}팀</button>)}
          </div>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-4">
        {teamSummary.map((item) => {
          const rate = item.total ? Math.round((item.done / item.total) * 100) : 0;
          return (
            <button key={item.team} type="button" onClick={() => setTeam(item.team)} className={`rounded-lg border p-4 text-left shadow-sm ${team === item.team ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white"}`}>
              <div className="flex items-center justify-between">
                <div className="text-lg font-black text-slate-950">{item.team}팀</div>
                <div className="text-xs font-black text-blue-600">{item.done}/{item.total} 완료</div>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${rate}%` }} /></div>
              <div className="mt-2 text-xs font-bold text-slate-400">AS 처리율 {rate}%</div>
            </button>
          );
        })}
      </section>

      {view === "calendar" ? (
        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className={`grid gap-4 ${shownTeams.length === 1 ? "xl:grid-cols-1" : "xl:grid-cols-4"}`}>
            {shownTeams.map((item) => (
              <div key={item} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
                  <div className="text-sm font-black text-slate-900">{item}팀 AS 캘린더</div>
                  <div className="text-xs font-semibold text-slate-400">{ymd}</div>
                </div>
                <div className="divide-y divide-slate-100">
                  {tickets.filter((ticket) => ticket.team === item).map(ticketCard)}
                </div>
              </div>
            ))}
          </div>
          {selected && (
            <aside className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-xs font-black text-blue-600">{selected.team}팀 · {selected.date} {selected.time}</div>
              <h3 className="mt-1 text-lg font-black text-slate-950">{selected.vendor}</h3>
              <p className="mt-2 text-sm font-semibold text-slate-600">{selected.issue}</p>
              <div className="mt-4 grid gap-2 text-sm text-slate-600">
                <div><b className="text-slate-400">담당</b> {selected.assignee || "미배정"}</div>
                <div><b className="text-slate-400">기기</b> {selected.model} / {selected.serial}</div>
                <div><b className="text-slate-400">주소</b> {selected.address}</div>
              </div>
              <div className="mt-4 flex gap-2">
                <button type="button" onClick={() => update(selected.id, { status: "완료" })} className="rounded-md bg-blue-600 px-3 py-2 text-xs font-black text-white">완료</button>
                <button type="button" onClick={() => deferTicket(selected, addDays(selected.date, 1))} className="rounded-md border border-slate-200 px-3 py-2 text-xs font-black text-slate-600">익일</button>
              </div>
            </aside>
          )}
        </section>
      ) : (
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="grid border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs font-black text-slate-500 lg:grid-cols-[70px_110px_1fr_150px_150px_180px_250px]">
            <div>팀</div><div>일정</div><div>접수내용</div><div>기기</div><div>담당자</div><div>상태</div><div className="text-right">처리</div>
          </div>
          <div className="divide-y divide-slate-100">
            {filtered.map((ticket) => {
              const assignees = teamAssignees[ticket.team];
              return (
                <div key={ticket.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[70px_110px_1fr_150px_150px_180px_250px] lg:items-center">
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
                    {assignees.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <select value={ticket.status} onChange={(e) => update(ticket.id, { status: e.target.value as AsStatus })} className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold">
                      {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                    <input type="date" value={ticket.date} onChange={(e) => update(ticket.id, { date: e.target.value, status: "미루기" })} className="w-36 rounded-md border border-slate-300 bg-white px-2 text-xs font-bold" />
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <button type="button" onClick={() => onUseField?.(buildFieldAsText(ticket, author))} className="rounded-md bg-slate-900 px-3 py-2 text-xs font-black text-white">FIELD AS</button>
                    <button type="button" onClick={() => update(ticket.id, { status: "완료" })} className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700">완료</button>
                    <button type="button" onClick={() => deferTicket(ticket, addDays(ticket.date, 1))} className="rounded-md border border-slate-200 px-2 py-2 text-xs font-black text-slate-600">익일</button>
                    <button type="button" onClick={() => deferTicket(ticket, addDays(ticket.date, 7))} className="rounded-md border border-slate-200 px-2 py-2 text-xs font-black text-slate-600">1주</button>
                    <button type="button" onClick={() => deferTicket(ticket, addMonths(ticket.date, 1))} className="rounded-md border border-slate-200 px-2 py-2 text-xs font-black text-slate-600">1달</button>
                    <button type="button" onClick={() => deferTicket(ticket, addMonths(ticket.date, 3))} className="rounded-md border border-slate-200 px-2 py-2 text-xs font-black text-slate-600">3달</button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
