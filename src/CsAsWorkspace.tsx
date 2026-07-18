import { useMemo, useState } from "react";

type Team = "A" | "B" | "C" | "D";
type AsStatus = "접수" | "배정" | "완료" | "미루기";
type CalendarKey = `${Team} AS` | `${Team} 익일AS` | "물류";
type ViewMode = "list" | "calendar";
type DayFilter = "today" | "tomorrow";

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
const calendarKeys: CalendarKey[] = ["A AS", "B AS", "C AS", "D AS", "A 익일AS", "B 익일AS", "C 익일AS", "D 익일AS", "물류"];
const teamAssignees: Record<Team, string[]> = {
  A: ["김정민", "심태현", "정웅만", "신정훈"],
  B: ["권태혁", "조윤", "윤기준", "신정훈"],
  C: ["이홍진", "박영현", "이민구", "한왕주", "신정훈"],
  D: ["양승원", "김종희", "이호준", "신정훈"],
};

const storageKey = "cs_as_tickets_v4";
const todayYmd = formatDate(new Date());
const tomorrowYmd = addDays(todayYmd, 1);

const defaultTickets: AsTicket[] = [
  {
    id: "as-1",
    team: "A",
    date: todayYmd,
    time: "09:30",
    vendor: "11SO클릭스벤처파트너스(유)",
    contact: "010-5422-5078 정무열님",
    address: "서울 강남구 강남대로 320",
    department: "본사",
    model: "APEOSPORT-C2060",
    serial: "227683",
    issue: "출력물 줄감 및 소음",
    assignee: "",
    status: "접수",
  },
  {
    id: "as-2",
    team: "B",
    date: todayYmd,
    time: "11:00",
    vendor: "25법률사무소 남산",
    contact: "02-000-0000",
    address: "강서 권역",
    department: "사무실",
    model: "D420",
    serial: "792090564870",
    issue: "용지 걸림 반복",
    assignee: "권태혁",
    status: "배정",
  },
  {
    id: "as-3",
    team: "C",
    date: tomorrowYmd,
    time: "14:00",
    vendor: "27NN유어세무회계컨설팅",
    contact: "010-1111-2222",
    address: "강남 권역",
    department: "회계팀",
    model: "SL-X3220NR",
    serial: "0A6XBJWC000ANJ",
    issue: "스캔 전송 불가",
    assignee: "이민구",
    status: "미루기",
  },
  {
    id: "as-4",
    team: "D",
    date: todayYmd,
    time: "16:30",
    vendor: "9SS유니메오",
    contact: "010-3333-4444",
    address: "경기 권역",
    department: "관리사무소",
    model: "AP C3060",
    serial: "C3060-0001",
    issue: "토너 인식 오류",
    assignee: "양승원",
    status: "완료",
  },
];

function formatDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00+09:00`);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

function addMonths(date: string, months: number) {
  const d = new Date(`${date}T12:00:00+09:00`);
  d.setMonth(d.getMonth() + months);
  return formatDate(d);
}

function loadTickets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || "null");
    return Array.isArray(parsed) && parsed.length ? (parsed as AsTicket[]) : defaultTickets;
  } catch {
    return defaultTickets;
  }
}

function statusClass(status: AsStatus) {
  if (status === "완료") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "미루기") return "border-purple-200 bg-purple-50 text-purple-700";
  if (status === "배정") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
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
  const [calendarKey, setCalendarKey] = useState<CalendarKey>("A AS");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [dayFilter, setDayFilter] = useState<DayFilter>("today");
  const [editId, setEditId] = useState("");
  const [deferId, setDeferId] = useState("");
  const [customDate, setCustomDate] = useState(tomorrowYmd);

  const editTicket = tickets.find((ticket) => ticket.id === editId);
  const deferTicket = tickets.find((ticket) => ticket.id === deferId);

  const setTickets = (next: AsTicket[]) => {
    setTicketsState(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // localStorage가 막힌 환경에서는 현재 화면 상태만 유지합니다.
    }
  };

  const update = (id: string, patch: Partial<AsTicket>) => {
    setTickets(tickets.map((ticket) => (ticket.id === id ? { ...ticket, ...patch } : ticket)));
  };

  const toggleDone = (ticket: AsTicket) => {
    update(ticket.id, { status: ticket.status === "완료" ? (ticket.assignee ? "배정" : "접수") : "완료" });
  };

  const openDefer = (ticket: AsTicket) => {
    setDeferId(ticket.id);
    setCustomDate(tomorrowYmd);
  };

  const applyDefer = (date: string) => {
    if (!deferTicket || !date) return;
    update(deferTicket.id, { date, status: "미루기" });
    setDeferId("");
  };

  const teamSummary = teams.map((item) => {
    const rows = tickets.filter((ticket) => ticket.team === item);
    const done = rows.filter((ticket) => ticket.status === "완료").length;
    return { team: item, total: rows.length, done };
  });

  const targetDate = dayFilter === "today" ? todayYmd : tomorrowYmd;
  const asRows = tickets.filter((ticket) => (team === "ALL" || ticket.team === team) && ticket.date === targetDate);

  const calendarRows = useMemo(() => {
    if (calendarKey === "물류") return [];
    const [teamKey, kind] = calendarKey.split(" ") as [Team, "AS" | "익일AS"];
    const date = kind === "익일AS" ? tomorrowYmd : todayYmd;
    return tickets.filter((ticket) => ticket.team === teamKey && ticket.date === date);
  }, [calendarKey, tickets]);

  const calendarDays = Array.from({ length: 7 }, (_, index) => addDays(todayYmd, index));

  const renderTicketCard = (ticket: AsTicket) => (
    <button key={ticket.id} type="button" onClick={() => setEditId(ticket.id)} className="block w-full rounded-md border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-blue-300 hover:bg-blue-50/40">
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
            <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950">{view === "calendar" ? "CS 캘린더" : "AS접수"}</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">팀별 AS 접수, 일정 수정, 완료/미루기, FIELD AS 양식 연동을 한 화면에서 처리합니다.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setTeam("ALL")} className={`rounded-md px-3 py-2 text-sm font-black ${team === "ALL" ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>전체</button>
            {teams.map((item) => (
              <button key={item} type="button" onClick={() => setTeam(item)} className={`rounded-md px-3 py-2 text-sm font-black ${team === item ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>{item}팀</button>
            ))}
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
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-blue-600" style={{ width: `${rate}%` }} />
              </div>
            </button>
          );
        })}
      </section>

      {view === "calendar" ? (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-1.5">
              {calendarKeys.map((key) => (
                <button key={key} type="button" onClick={() => setCalendarKey(key)} className={`rounded-md px-3 py-2 text-xs font-black ${calendarKey === key ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>{key}</button>
              ))}
            </div>
            <div className="rounded-md bg-slate-100 p-1">
              {(["list", "calendar"] as ViewMode[]).map((mode) => (
                <button key={mode} type="button" onClick={() => setViewMode(mode)} className={`rounded px-3 py-1.5 text-xs font-black ${viewMode === mode ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{mode === "list" ? "목록" : "달력"}</button>
              ))}
            </div>
          </div>

          {calendarKey === "물류" ? (
            <div className="mt-6 rounded-md border border-dashed border-slate-200 p-10 text-center text-sm font-semibold text-slate-400">물류 캘린더는 다음 단계에서 납품/철수/교체 데이터와 연결합니다.</div>
          ) : viewMode === "list" ? (
            <div className="mt-5 grid gap-3">
              {calendarRows.map(renderTicketCard)}
              {!calendarRows.length && <div className="p-8 text-center text-sm font-semibold text-slate-400">일정이 없습니다.</div>}
            </div>
          ) : (
            <div className="mt-5 grid gap-2 md:grid-cols-7">
              {calendarDays.map((date) => {
                const rows = tickets.filter((ticket) => ticket.date === date && calendarKey.startsWith(ticket.team));
                return (
                  <div key={date} className="min-h-40 rounded-md border border-slate-200 bg-slate-50 p-2">
                    <div className="mb-2 text-xs font-black text-slate-500">{date.slice(5)}</div>
                    <div className="space-y-2">{rows.map(renderTicketCard)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="rounded-md bg-slate-100 p-1">
              {([["today", "금일 AS"], ["tomorrow", "익일 AS"]] as [DayFilter, string][]).map(([key, label]) => (
                <button key={key} type="button" onClick={() => setDayFilter(key)} className={`rounded px-4 py-2 text-sm font-black ${dayFilter === key ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{label}</button>
              ))}
            </div>
            <div className="text-xs font-bold text-slate-400">{targetDate} · {asRows.length}건</div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-black text-slate-500">
                  <th className="px-3 py-3">팀</th>
                  <th className="px-3 py-3">일정</th>
                  <th className="px-3 py-3">접수내용</th>
                  <th className="px-3 py-3">기기</th>
                  <th className="px-3 py-3">담당자</th>
                  <th className="px-3 py-3 text-right">처리</th>
                </tr>
              </thead>
              <tbody>
                {asRows.map((ticket) => (
                  <tr key={ticket.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-4 text-sm font-black">{ticket.team}팀</td>
                    <td className="px-3 py-4 text-sm font-bold">{ticket.time}<div className="text-[11px] text-slate-400">{ticket.date}</div></td>
                    <td className="px-3 py-4">
                      <button type="button" onClick={() => setEditId(ticket.id)} className="text-left">
                        <div className="text-sm font-black text-slate-900">{ticket.vendor}</div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">{ticket.issue}</div>
                      </button>
                    </td>
                    <td className="px-3 py-4 text-sm font-semibold text-slate-600">{ticket.model}<div className="text-[11px] text-slate-400">{ticket.serial}</div></td>
                    <td className="px-3 py-4">
                      <select value={ticket.assignee} onChange={(event) => update(ticket.id, { assignee: event.target.value, status: event.target.value && ticket.status === "접수" ? "배정" : ticket.status })} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold">
                        <option value="">미배정</option>
                        {teamAssignees[ticket.team].map((name) => <option key={name}>{name}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex justify-end gap-1.5">
                        <button type="button" onClick={() => onUseField?.(buildFieldAsText(ticket, author))} className="rounded-md bg-slate-900 px-3 py-2 text-xs font-black text-white">FIELD AS</button>
                        <button type="button" onClick={() => toggleDone(ticket)} className={`rounded-md border px-3 py-2 text-xs font-black ${ticket.status === "완료" ? "border-slate-200 bg-white text-slate-500" : "border-blue-200 bg-blue-50 text-blue-700"}`}>{ticket.status === "완료" ? "완료취소" : "완료"}</button>
                        <button type="button" onClick={() => openDefer(ticket)} className="rounded-md border border-purple-200 bg-purple-50 px-3 py-2 text-xs font-black text-purple-700">미루기</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!asRows.length && (
                  <tr><td colSpan={6} className="px-3 py-10 text-center text-sm font-semibold text-slate-400">접수된 AS가 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {editTicket && <TicketEditModal ticket={editTicket} onClose={() => setEditId("")} onSave={(patch) => { update(editTicket.id, patch); setEditId(""); }} />}
      {deferTicket && <DeferModal ticket={deferTicket} customDate={customDate} onCustomDate={setCustomDate} onClose={() => setDeferId("")} onApply={applyDefer} />}
    </div>
  );
}

function TicketEditModal({ ticket, onClose, onSave }: { ticket: AsTicket; onClose: () => void; onSave: (patch: Partial<AsTicket>) => void }) {
  const [draft, setDraft] = useState(ticket);
  const set = <K extends keyof AsTicket>(key: K, value: AsTicket[K]) => setDraft((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <b>AS 일정 수정</b>
          <button type="button" onClick={onClose} className="text-xs font-bold text-slate-400">닫기</button>
        </div>
        <div className="grid gap-3 p-5 md:grid-cols-2">
          <Field label="업체명" value={draft.vendor} onChange={(value) => set("vendor", value)} />
          <Field label="부서명" value={draft.department} onChange={(value) => set("department", value)} />
          <Field label="날짜" value={draft.date} type="date" onChange={(value) => set("date", value)} />
          <Field label="시간" value={draft.time} type="time" onChange={(value) => set("time", value)} />
          <Field label="연락처" value={draft.contact} onChange={(value) => set("contact", value)} />
          <Field label="주소" value={draft.address} onChange={(value) => set("address", value)} />
          <Field label="기종" value={draft.model} onChange={(value) => set("model", value)} />
          <Field label="시리얼" value={draft.serial} onChange={(value) => set("serial", value)} />
          <label className="text-xs font-bold text-slate-500 md:col-span-2">
            접수내용
            <textarea value={draft.issue} onChange={(event) => set("issue", event.target.value)} rows={5} className="mt-1 w-full rounded-md border border-slate-300 p-3 text-sm font-normal" />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-200 px-4 py-2 text-sm font-bold text-slate-500">취소</button>
          <button type="button" onClick={() => onSave(draft)} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-black text-white">저장</button>
        </div>
      </div>
    </div>
  );
}

function DeferModal({ ticket, customDate, onCustomDate, onClose, onApply }: { ticket: AsTicket; customDate: string; onCustomDate: (date: string) => void; onClose: () => void; onApply: (date: string) => void }) {
  const options = [
    ["익일", tomorrowYmd],
    ["1주", addDays(todayYmd, 7)],
    ["1달", addMonths(todayYmd, 1)],
    ["3달", addMonths(todayYmd, 3)],
  ] as const;

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="text-lg font-black text-slate-950">미루기</div>
        <div className="mt-1 text-sm font-semibold text-slate-500">{ticket.vendor}</div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          {options.map(([label, date]) => (
            <button key={label} type="button" onClick={() => onApply(date)} className="rounded-md border border-slate-200 px-4 py-3 text-sm font-black text-slate-700 hover:bg-slate-50">
              {label}
              <div className="mt-1 text-xs text-slate-400">{date}</div>
            </button>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <input type="date" value={customDate} onChange={(event) => onCustomDate(event.target.value)} className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-bold" />
          <button type="button" onClick={() => onApply(customDate)} className="rounded-md bg-purple-600 px-4 py-2 text-sm font-black text-white">직접선택</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, type = "text", onChange }: { label: string; value: string; type?: string; onChange: (value: string) => void }) {
  return (
    <label className="text-xs font-bold text-slate-500">
      {label}
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" />
    </label>
  );
}
