import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getTeamVisits, kstDate, WORK_LABELS, type VisitRow } from "./visits";
import { insertRow, invokeEdgeFunction, selectRows, updateRows, uploadPublicFile, upsertRow } from "./supabase";
import FormModal from "./FormModal";

type Contact = { id: string; name: string; phone: string; email: string; selected: boolean };
type HappycallStatus = "pending" | "scheduled" | "sent" | "failed" | "skip" | "cancelled";
type HappycallRecord = { visit_id: string; author: string; recipient: string; keyman: string; message: string; recipients?: Contact[]; job_ids?: string[]; scheduled_at?: string; status: HappycallStatus; sent_at?: string; error?: string };
type MessageTemplate = { id: string; context: "happycall" | "promotion" | "quarter_notice"; title: string; body: string; active: boolean; created_by: string };
type PromoMaterial = { id: string; title: string; category: string; description: string; file_url: string; file_type: string; created_by: string; created_at: string };

const happycallDays = 7;
const promoCategories = ["IT", "소프트웨어", "퇴사자 보안", "복합기", "기타"];
const happycallDefaults = [
  { id: "00000000-0000-0000-0000-000000000101", context: "happycall" as const, title: "방문 기본 확인형", body: "[퍼스트전산] 고객님, {방문일} 방문한 {담당자}입니다. 방문 후 기기는 잘 사용하고 계신가요? 불편한 점이 있다면 대표번호로 말씀해 주세요.", active: true, created_by: "SYSTEM" },
  { id: "00000000-0000-0000-0000-000000000102", context: "happycall" as const, title: "AS 기본 확인형", body: "[퍼스트전산] 고객님, {방문일} 방문한 {담당자}입니다. 처리해 드린 증상은 다시 발생하지 않고 잘 사용 중이신가요? 같은 증상이 반복되면 대표번호로 말씀해 주세요.", active: true, created_by: "SYSTEM" },
  { id: "00000000-0000-0000-0000-000000000103", context: "happycall" as const, title: "짧은 만족 확인형", body: "[퍼스트전산] 고객님, 오늘 방문한 {담당자}입니다. 불편 없이 잘 사용 중이신지 확인차 연락드립니다. 추가 도움이 필요하시면 대표번호로 연락 부탁드립니다.", active: true, created_by: "SYSTEM" },
];
const quarterNoticeDefaults = [
  { id: "00000000-0000-0000-0000-000000000301", context: "quarter_notice" as const, title: "분기점검 기본 안내형", body: "안녕하세요, {업체명} 담당자님. 사무기기 관리업체 퍼스트전산입니다.\n이번 분기 정기 점검을 위해 기간 내 방문드려 인사드리겠습니다.\n방문 전 연락드리며, 불편하신 점이 있으시면 언제든 말씀 부탁드립니다.\n항상 저희 퍼스트전산을 이용해 주셔서 감사합니다.", active: true, created_by: "SYSTEM" },
];
const promotionDefaults = [
  { id: "00000000-0000-0000-0000-000000000201", context: "promotion" as const, title: "자료 안내형", body: "[퍼스트전산] 고객님께 업무에 도움이 될 {자료명} 자료를 보내드립니다.\n{자료설명}\n{자료링크}", active: true, created_by: "SYSTEM" },
  { id: "00000000-0000-0000-0000-000000000202", context: "promotion" as const, title: "상담 연결형", body: "[퍼스트전산] 고객님, 방문 중 말씀드린 {자료명} 안내자료입니다. 검토 후 궁금한 점이나 상담이 필요하시면 대표번호로 연락해 주세요.\n{자료링크}", active: true, created_by: "SYSTEM" },
];

function dateBefore(days: number) { const date = new Date(); date.setDate(date.getDate() - days); return kstDate(date); }
function defaultScheduleTime() { const date = new Date(); date.setDate(date.getDate() + 1); date.setHours(10, 0, 0, 0); const offset = date.getTimezoneOffset() * 60000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); }
function cleanPhone(value: string) { return value.replace(/[^\d]/g, ""); }
function newContact(name = "", phone = "", email = ""): Contact { return { id: crypto.randomUUID(), name, phone: cleanPhone(phone), email, selected: true }; }
function validPhone(value: string) { return /^01\d{8,9}$/.test(cleanPhone(value)); }
function validEmail(value: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()); }
function downloadUrl(url: string, title: string) { return `${url}?download=${encodeURIComponent(`${title}.pdf`)}`; }

function extractVisitContacts(text: string): Contact[] {
  const lines = text.replaceAll("\r", "").split("\n").map((line) => line.trim()).filter(Boolean);
  const contacts: Contact[] = [];
  const relevant = /(키맨(?:\/접수자)?|접수자(?:성함|연락처)?|고객명|연락처|전화번호|일반전화)/;
  const internal = /(방문담당자|영업담당자|요청담당자|수리배정|작성자)/;
  const fieldLine = /^(?:작성자|구분|레벨|등급|업체명|부서명|지역|모델명|시리얼넘버|자산기번|내용|처리내용|매수|토너잔량|폐통|여분|특이사항|도착 시간|소요 시간)\s*[:：]/;
  let inContactBlock = false;
  let pendingName = "";
  const phonePattern = /(?:01[016789]|0\d{1,2})[-.\s]?\d{3,4}[-.\s]?\d{4}/g;
  const cleanName = (value: string) => value.replace(/^[\s/|,;:：-]+|[\s/|,;:：-]+$/g, "").trim();
  const addContact = (name: string, phone: string) => {
    const normalizedPhone = cleanPhone(phone);
    const existing = contacts.find((contact) => contact.phone === normalizedPhone);
    if (existing) {
      if (!existing.name && name) existing.name = name;
      return;
    }
    contacts.push(newContact(name, normalizedPhone));
  };
  for (const line of lines) {
    if (/^[_=ㅡ─-]{3,}$/.test(line) || fieldLine.test(line)) { inContactBlock = false; pendingName = ""; }
    const startsContact = relevant.test(line) && !internal.test(line);
    if (startsContact) inContactBlock = true;
    if ((!startsContact && !inContactBlock) || internal.test(line)) continue;
    const payload = startsContact && /[:：]/.test(line)
      ? line.replace(/^[^:：]*[:：]\s*/, "")
      : startsContact
        ? line.replace(/^.*?(?:키맨(?:\/접수자)?|접수자(?:성함|연락처)?|고객명|연락처|전화번호|일반전화)\s*/, "")
        : line;
    const matches = [...payload.matchAll(phonePattern)];
    const rawName = payload
      .replace(phonePattern, "")
      .replace(/[/|,]+$/g, "").trim();
    if (!matches.length) {
      if (rawName && !/^0+$/.test(rawName) && !/(기종|모델|주소|시리얼)/.test(rawName)) pendingName = cleanName(rawName);
      continue;
    }
    matches.forEach((match, index) => {
      const start = match.index || 0;
      const end = start + match[0].length;
      const previousEnd = index ? (matches[index - 1].index || 0) + matches[index - 1][0].length : 0;
      const nextStart = index + 1 < matches.length ? (matches[index + 1].index || payload.length) : payload.length;
      const before = cleanName(payload.slice(previousEnd, start));
      const after = cleanName(payload.slice(end, nextStart));
      const sameLineName = after || before;
      const name = sameLineName && !/(기종|모델|주소|시리얼)/.test(sameLineName) ? sameLineName : pendingName;
      addContact(name, match[0]);
      if (pendingName && name === pendingName) pendingName = "";
    });
  }
  return contacts.slice(0, 6);
}

function prettyDate(iso: string) { return /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일` : iso; }
function visitType(visit: VisitRow) { if (visit.workKinds.includes("as")) return "AS"; if (visit.workKinds.includes("inspection")) return "점검"; return visit.workKinds.map((kind) => WORK_LABELS[kind]).join("·") || "방문 업무"; }
function applyTokens(body: string, values: Record<string, string>) { return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), body); }
const STATUS_CHIP: Record<HappycallStatus, string> = {
  pending: "bg-rose-50 text-rose-600", scheduled: "bg-amber-50 text-amber-700", sent: "bg-emerald-50 text-emerald-700",
  failed: "bg-rose-100 text-rose-700", skip: "bg-slate-100 text-slate-400", cancelled: "bg-slate-100 text-slate-500",
};
function statusLabel(status: HappycallStatus) { return status === "scheduled" ? "예약" : status === "cancelled" ? "예약 취소" : status === "sent" ? "발송 완료" : status === "failed" ? "발송 실패" : status === "skip" ? "제외" : "발송 대기"; }

function ContactsEditor({ contacts, onChange, email = false }: { contacts: Contact[]; onChange: (contacts: Contact[]) => void; email?: boolean }) {
  const patch = (id: string, values: Partial<Contact>) => onChange(contacts.map((contact) => contact.id === id ? { ...contact, ...values } : contact));
  return <div className="space-y-2">
    {contacts.map((contact, index) => <div key={contact.id} className={`grid grid-cols-[24px_minmax(0,1fr)_32px] items-start gap-2 rounded-lg border p-2 ${contact.selected ? "border-blue-200 bg-blue-50/50" : "border-slate-200 bg-slate-50 opacity-60"}`}>
      <input type="checkbox" checked={contact.selected} onChange={(event) => patch(contact.id, { selected: event.target.checked })} className="h-4 w-4 accent-blue-600" aria-label={`${index + 1}번 고객 선택`} />
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
        <input value={contact.name} onChange={(event) => patch(contact.id, { name: event.target.value })} placeholder="고객명" className="min-w-0 rounded border border-slate-200 bg-white px-2 py-2 text-xs outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
        <input inputMode="tel" value={contact.phone} onChange={(event) => patch(contact.id, { phone: cleanPhone(event.target.value) })} placeholder="휴대전화" className="min-w-0 rounded border border-slate-200 bg-white px-2 py-2 text-xs outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
        {email && <input type="email" value={contact.email} onChange={(event) => patch(contact.id, { email: event.target.value })} placeholder="이메일" className="min-w-0 rounded border border-slate-200 bg-white px-2 py-2 text-xs sm:col-span-2 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />}
      </div>
      <button type="button" onClick={() => onChange(contacts.filter((item) => item.id !== contact.id))} aria-label="연락처 삭제" className="h-8 w-8 rounded text-lg font-black text-slate-400 hover:bg-white">×</button>
    </div>)}
    <button type="button" onClick={() => onChange([...contacts, newContact()])} className="w-full rounded-lg border border-dashed border-slate-300 py-2.5 text-xs font-black text-slate-500">+ 고객 직접 추가</button>
  </div>;
}

function useMessageTemplates(context: "happycall" | "promotion" | "quarter_notice", author: string) {
  const defaults = context === "happycall" ? happycallDefaults : context === "quarter_notice" ? quarterNoticeDefaults : promotionDefaults;
  // 마지막으로 본 공용 문구를 로컬에 캐시 — 서버 응답 전에 옛 기본문구가 번쩍이지 않고 즉시 최신으로 뜬다
  const cacheKey = `msg_templates_${context}_v1`;
  const readCache = (): MessageTemplate[] => { try { const parsed = JSON.parse(localStorage.getItem(cacheKey) || "[]"); return Array.isArray(parsed) ? parsed : []; } catch { return []; } };
  const [custom, setCustom] = useState<MessageTemplate[]>(readCache);
  const [loaded, setLoaded] = useState(() => readCache().length > 0);
  const reload = useCallback(() => selectRows<MessageTemplate>("message_templates", `select=*&context=eq.${context}&active=eq.true&order=created_at.asc`)
    .then((rows) => { setCustom(rows); setLoaded(true); try { localStorage.setItem(cacheKey, JSON.stringify(rows)); } catch { /* 캐시 실패 무시 */ } })
    .catch(() => setLoaded(true)), [cacheKey, context]);
  useEffect(() => {
    void reload();
    const refresh = () => { if (document.visibilityState === "visible") void reload(); };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [reload]);
  // 브라우저 prompt/confirm을 쓰지 않는다 — "추가 대화상자 차단"에 걸리면 소리 없이 실패해 "저장이 안 돼"가 된다.
  const save = async (title: string, body: string) => {
    await upsertRow("message_templates", { id: crypto.randomUUID(), context, title: title.trim(), body, active: true, created_by: author }, "id");
    await reload();
  };
  const update = async (id: string, title: string, body: string) => {
    if (!custom.find((item) => item.id === id)) return save(title, body); // 기본 문구는 수정 대신 새 공용으로 저장
    await updateRows("message_templates", `id=eq.${encodeURIComponent(id)}`, { title: title.trim(), body });
    await reload();
  };
  const remove = async (id: string) => {
    await updateRows("message_templates", `id=eq.${encodeURIComponent(id)}`, { active: false });
    await reload();
  };
  return { templates: custom.length ? custom : defaults, loaded, save, update, remove, editableIds: new Set(custom.map((item) => item.id)) };
}

export function TemplateBar({ context, author, body, onApply, preferredTitle = "", applyRevision = "" }: { context: "happycall" | "promotion" | "quarter_notice"; author: string; body: string; onApply: (body: string) => void; preferredTitle?: string; applyRevision?: string }) {
  const { templates, loaded, save, update, remove, editableIds } = useMessageTemplates(context, author);
  const [selected, setSelected] = useState(templates[0]?.id || "");
  const [dialog, setDialog] = useState<null | { mode: "add" | "edit" | "remove"; title: string; error?: string; busy?: boolean }>(null);
  const appliedRevision = useRef("");
  const selectedId = templates.some((item) => item.id === selected) ? selected : templates[0]?.id || "";
  useEffect(() => {
    // 서버(또는 캐시) 문구가 준비되기 전엔 자동 적용하지 않는다 — 옛 기본문구가 먼저 채워지던 원인
    if (!loaded || !applyRevision || appliedRevision.current === applyRevision || !templates.length) return;
    const preferred = templates.find((item) => item.title === preferredTitle) || templates[0];
    appliedRevision.current = applyRevision;
    setSelected(preferred.id);
    onApply(preferred.body);
  }, [applyRevision, onApply, preferredTitle, templates]);
  return <div className="grid grid-cols-3 gap-2 rounded-lg border border-blue-100 bg-blue-50/50 p-2">
    <div className="col-span-3 flex items-center justify-between gap-2 px-1"><span className="text-[11px] font-black text-blue-700">회사 공용 문구{!loaded && <span className="ml-1.5 text-[10px] font-bold text-amber-500">불러오는 중…</span>}</span><span className="text-[10px] font-bold text-slate-400">추가·수정 시 전 직원에게 반영</span></div>
    <select value={selectedId} onChange={(event) => { setSelected(event.target.value); const template = templates.find((item) => item.id === event.target.value); if (template) onApply(template.body); }} className="col-span-3 min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-xs font-black sm:col-span-1 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10">
      {templates.map((template) => <option key={template.id} value={template.id}>{template.title}</option>)}
    </select>
    <button type="button" onClick={() => setDialog({ mode: "add", title: "" })} className="rounded-full border border-blue-200 bg-white px-3 py-1.5 text-xs font-black text-blue-600 transition hover:bg-blue-50">공용 추가</button>
    <button type="button" onClick={() => setDialog({ mode: editableIds.has(selectedId) ? "edit" : "add", title: templates.find((t) => t.id === selectedId)?.title || "" })} className="rounded-full border border-slate-300 bg-white transition hover:bg-slate-50 px-3 py-2 text-xs font-black text-slate-700">공용 수정</button>
    <button type="button" disabled={!editableIds.has(selectedId)} onClick={() => setDialog({ mode: "remove", title: templates.find((t) => t.id === selectedId)?.title || "" })} className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-black text-rose-600 transition hover:bg-rose-50 disabled:opacity-40">공용 삭제</button>
    {dialog && (
      <div className="fixed inset-0 z-[2500] flex items-center justify-center bg-black/45 p-5" onMouseDown={() => !dialog.busy && setDialog(null)}>
        <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
          <div className="bg-[#1E252F] px-5 py-4">
            <div className="text-[11px] font-black text-slate-400">회사 공용 문구 · 전 직원에게 반영됩니다</div>
            <div className="mt-0.5 text-[15px] font-black text-white">{dialog.mode === "add" ? "공용 문구로 저장" : dialog.mode === "edit" ? "공용 문구 수정" : "공용 문구 삭제"}</div>
          </div>
          <div className="space-y-2.5 px-5 py-4">
            {dialog.mode !== "remove" ? (<>
              <label className="block text-[11px] font-black text-slate-500">문구 이름
                <input value={dialog.title} onChange={(e) => setDialog({ ...dialog, title: e.target.value })} autoFocus placeholder="예: 분기점검 기본 안내형"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-bold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
              </label>
              <div className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-[12px] font-semibold leading-5 text-slate-600">{body}</div>
            </>) : (
              <div className="text-sm font-bold text-slate-700">'{dialog.title}' 문구를 삭제할까요? 모든 직원의 목록에서 사라집니다.</div>
            )}
            {dialog.error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-bold text-rose-600">{dialog.error}</div>}
          </div>
          <div className="flex gap-2 px-4 pb-4">
            <button type="button" disabled={dialog.busy} onClick={() => setDialog(null)} className="flex-1 rounded-full border border-slate-300 bg-white py-2.5 text-sm font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">취소</button>
            <button type="button" disabled={dialog.busy || (dialog.mode !== "remove" && (!dialog.title.trim() || !body.trim()))}
              onClick={() => { void (async () => {
                setDialog({ ...dialog, busy: true, error: "" });
                try {
                  if (dialog.mode === "add") await save(dialog.title, body);
                  else if (dialog.mode === "edit") await update(selectedId, dialog.title, body);
                  else await remove(selectedId);
                  setDialog(null);
                } catch (error) {
                  setDialog({ ...dialog, busy: false, error: `실패: ${(error as Error).message}` });
                }
              })(); }}
              className={`flex-[2] rounded-full py-2.5 text-sm font-black text-white shadow transition disabled:opacity-40 ${dialog.mode === "remove" ? "bg-rose-600 hover:bg-rose-700" : "bg-blue-600 hover:bg-blue-700"}`}>
              {dialog.busy ? "처리 중…" : dialog.mode === "remove" ? "삭제" : "저장"}
            </button>
          </div>
        </div>
      </div>
    )}
  </div>;
}

export function HappyCallWorkspace({ author, switcher }: { author: string; switcher?: import("react").ReactNode }) {
  const [visits, setVisits] = useState<VisitRow[]>([]); const [records, setRecords] = useState<HappycallRecord[]>([]);
  const [selectedId, setSelectedId] = useState(""); const [contacts, setContacts] = useState<Contact[]>([]); const [message, setMessage] = useState("");
  const [filter, setFilter] = useState<"pending" | "scheduled" | "cancelled" | "sent" | "all">("pending"); const [kindFilter, setKindFilter] = useState<"inspection" | "as">("inspection"); const [scheduleAt, setScheduleAt] = useState(defaultScheduleTime); const [loading, setLoading] = useState(true); const [sending, setSending] = useState(false); const [notice, setNotice] = useState("");
  useEffect(() => { let active = true; setLoading(true); const history = selectRows<HappycallRecord>("happycall_messages", "select=*&order=created_at.desc").catch(() => [] as HappycallRecord[]); Promise.all([getTeamVisits(dateBefore(happycallDays - 1), kstDate()), history]).then(([visitRows, recordRows]) => { if (!active) return; setVisits(visitRows.filter((visit) => visit.visited && (visit.workKinds.includes("inspection") || visit.workKinds.includes("as"))).reverse()); setRecords(recordRows); }).catch((error) => active && setNotice((error as Error).message)).finally(() => active && setLoading(false)); return () => { active = false; }; }, []);
  const recordMap = useMemo(() => new Map(records.map((record) => [record.visit_id, record])), [records]);
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { pending: 0, scheduled: 0, cancelled: 0, sent: 0 };
    visits.filter((visit) => visit.workKinds.includes(kindFilter)).forEach((visit) => {
      const status = recordMap.get(visit.id)?.status || "pending";
      if (counts[status] !== undefined) counts[status] += 1;
    });
    return counts;
  }, [visits, kindFilter, recordMap]);
  const rows = visits.filter((visit) => visit.workKinds.includes(kindFilter) && (filter === "all" || (recordMap.get(visit.id)?.status || "pending") === filter)); const selected = visits.find((visit) => visit.id === selectedId); const selectedRecord = selected ? recordMap.get(selected.id) : undefined;
  const choose = (visit: VisitRow) => { const record = recordMap.get(visit.id); const found = record?.recipients?.length ? record.recipients.map((item) => ({ ...item, id: item.id || crypto.randomUUID() })) : extractVisitContacts(visit.sourceText || visit.note); setSelectedId(visit.id); setContacts(found.length ? found : [newContact()]); setMessage(record?.message || ""); setScheduleAt(record?.scheduled_at ? new Date(new Date(record.scheduled_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : defaultScheduleTime()); setNotice(found.length ? `${found.length}명의 고객 정보를 불러왔습니다.` : "원문에서 연락처를 찾지 못했습니다. 직접 입력해 주세요."); };
  const saveRecord = async (status: HappycallStatus, error = "", extras: Partial<HappycallRecord> = {}) => { if (!selected) return; const first = contacts[0] || newContact(); const row = { visit_id: selected.id, author, recipient: first.phone, keyman: first.name, message, recipients: contacts, status, sent_at: status === "sent" ? new Date().toISOString() : null, error, ...extras }; await upsertRow("happycall_messages", row, "visit_id"); setRecords((current) => [row as HappycallRecord, ...current.filter((item) => item.visit_id !== selected.id)]); };
  const tokenValues = (_contact: Contact) => ({ 고객명: "고객", 업체명: selected?.vendor || "", 담당자: selected?.author || "", 업무: selected ? visitType(selected) : "", 방문일: selected ? prettyDate(selected.workDate) : "" });
  const send = async () => { if (!selected) return; const targets = contacts.filter((contact) => contact.selected && validPhone(contact.phone)); if (!targets.length) return setNotice("발송할 휴대전화 번호를 선택해 주세요."); setSending(true); try { for (const contact of targets) { const text = applyTokens(message, tokenValues(contact)); await invokeEdgeFunction("customer-message-send", { channel: "sms", type: "happycall", visitId: selected.id, to: contact.phone, text, vendor: selected.vendor, author }); } await saveRecord("sent"); setNotice(`${targets.length}명에게 대표번호로 발송했습니다.`); } catch (error) { const detail = (error as Error).message; try { await saveRecord("failed", detail); } catch { /* preserve send error */ } setNotice(`발송 실패: ${detail}`); } finally { setSending(false); } };
  const schedule = async () => { if (!selected) return; const targets = contacts.filter((contact) => contact.selected && validPhone(contact.phone)); const scheduledDate = new Date(scheduleAt); if (!targets.length) return setNotice("예약할 휴대전화 번호를 선택해 주세요."); if (!scheduleAt || scheduledDate.getTime() <= Date.now()) return setNotice("현재보다 이후 시간을 선택해 주세요."); setSending(true); try { const jobIds: string[] = []; for (const contact of targets) { const id = crypto.randomUUID(); const text = applyTokens(message, tokenValues(contact)); await upsertRow("message_jobs", { id, source_type: "happycall", source_id: selected.id, channel: "sms", recipient: contact.phone, message: text, payload: { type: "happycall", visitId: selected.id, vendor: selected.vendor, author }, scheduled_at: scheduledDate.toISOString(), status: "scheduled", created_by: author }, "id"); jobIds.push(id); } await saveRecord("scheduled", "", { scheduled_at: scheduledDate.toISOString(), job_ids: jobIds }); setNotice(`${targets.length}명 발송을 ${scheduledDate.toLocaleString("ko-KR")}로 예약했습니다.`); } catch (error) { setNotice(`예약 실패: ${(error as Error).message}`); } finally { setSending(false); } };
  const cancelSchedule = async () => { if (!selectedRecord?.job_ids?.length) return; if (!window.confirm("예약발송을 취소할까요?")) return; for (const id of selectedRecord.job_ids) await updateRows("message_jobs", `id=eq.${encodeURIComponent(id)}&status=eq.scheduled`, { status: "cancelled", updated_at: new Date().toISOString() }); await saveRecord("cancelled", "", { scheduled_at: selectedRecord.scheduled_at, job_ids: selectedRecord.job_ids }); setNotice("예약발송을 취소했습니다."); };
  const detail = selected ? <div className="flex min-h-0 flex-col">
    <div className="border-b border-slate-100 pb-3"><div className="flex items-center gap-1.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${visitType(selected) === "AS" ? "bg-rose-50 text-rose-600" : "bg-blue-50 text-blue-700"}`}>{visitType(selected)}</span><span className="text-[11px] font-bold tabular-nums text-slate-400">{selected.workDate}</span></div><div className="mt-1.5 text-lg font-black text-slate-950">{selected.vendor}</div></div>
    <div className="mt-4"><div className="mb-2 text-[11px] font-black tracking-wide text-slate-500">발송 대상</div><ContactsEditor contacts={contacts} onChange={setContacts} /></div>
    <div className="mt-4"><TemplateBar context="happycall" author={author} body={message} onApply={setMessage} preferredTitle={selected.workKinds.includes("as") ? "AS 기본 확인형" : "방문 기본 확인형"} applyRevision={selectedRecord?.message ? "" : selected.id} /></div>
    <textarea rows={6} value={message} onChange={(event) => setMessage(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 p-3 text-sm leading-6 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
    <div className="text-[10px] font-bold text-slate-400">사용 가능: {'{담당자}'} {'{방문일}'} {'{업체명}'} — 호칭은 항상 "고객님"으로 나갑니다</div>
    {(() => { const first = contacts.find((contact) => contact.selected); if (!first || !message.trim()) return null; return <div className="mt-2 rounded-xl border border-blue-100 bg-blue-50/40 px-3.5 py-2.5"><div className="text-[10px] font-black tracking-wide text-blue-600">발송 미리보기 · {first.name || "고객"}{contacts.filter((contact) => contact.selected).length > 1 ? ` 외 ${contacts.filter((contact) => contact.selected).length - 1}명` : ""}</div><p className="mt-1 whitespace-pre-wrap break-all text-[13px] font-semibold leading-6 text-slate-700">{applyTokens(message, tokenValues(first))}</p></div>; })()}
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3"><label className="text-xs font-black text-slate-500">예약 발송 시간<input type="datetime-local" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" /></label></div>
    {notice && <div className="mt-3 rounded-lg bg-slate-100 p-3 text-xs font-bold text-slate-600">{notice}</div>}
    <div className="sticky bottom-0 -mx-4 mt-4 grid grid-cols-2 gap-2 border-t bg-white/95 p-3 backdrop-blur sm:flex sm:flex-wrap xl:static xl:mx-0 xl:p-0 xl:pt-4">
      <button onClick={() => void saveRecord("skip")} className="rounded-full border px-3 py-2.5 text-sm font-black text-slate-500">대상 제외</button>
      {selectedRecord?.status === "scheduled" && <button onClick={() => void cancelSchedule()} className="rounded-full border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-black text-rose-600">예약 취소</button>}
      <button disabled={sending} onClick={() => void schedule()} className="rounded-full border border-blue-200 px-4 py-2.5 text-sm font-black text-blue-700 disabled:opacity-50 sm:ml-auto">예약 발송</button>
      <button disabled={sending} onClick={() => void send()} className="rounded-full bg-blue-600 shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">{sending ? "처리 중" : "지금 발송"}</button>
    </div>
  </div> : <div className="flex min-h-[430px] items-center justify-center text-center text-sm font-semibold text-slate-400">방문 건을 선택하세요.</div>;
  return <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(430px,.95fr)]">
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-start justify-between gap-3 bg-[#1E252F] px-5 py-4">
        <div>
          <h2 className="text-base font-black text-white lg:text-lg">해피콜</h2>
          <p className="mt-0.5 text-[11px] font-semibold text-slate-400">최근 7일 점검·AS 방문 고객에게 만족 확인 문자를 보냅니다.</p>
        </div>
        {switcher}
      </div>
      <div className="flex flex-wrap items-center gap-2 bg-[#151A23] px-4 py-2.5">
        <div className="flex rounded-full bg-white/[0.07] p-1">
          {([["inspection", "점검"], ["as", "AS"]] as const).map(([key, label]) => (
            <button key={key} onClick={() => { setKindFilter(key); setSelectedId(""); }}
              className={`rounded-full px-4 py-1.5 text-xs font-black transition ${kindFilter === key ? "bg-white text-slate-950" : "text-slate-400 hover:text-slate-200"}`}>{label}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {(["pending", "scheduled", "cancelled", "sent", "all"] as const).map((item) => (
            <button key={item} onClick={() => setFilter(item)}
              className={`rounded-full px-3 py-1.5 text-[11px] font-black transition ${filter === item ? "bg-white text-slate-950" : "bg-white/[0.07] text-slate-400 hover:bg-white/[0.14] hover:text-slate-200"}`}>
              {item === "pending" ? "대기" : item === "scheduled" ? "예약" : item === "cancelled" ? "예약취소" : item === "sent" ? "완료" : "전체"}
              {item !== "all" && item !== "cancelled" && <span className={`ml-1 tabular-nums ${filter === item ? "text-slate-400" : "text-slate-500"}`}>{statusCounts[item] || 0}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-[calc(100dvh-290px)] divide-y overflow-y-auto xl:max-h-[700px]">{rows.map((visit) => { const status = recordMap.get(visit.id)?.status || "pending"; return <button key={visit.id} onClick={() => choose(visit)} className={`block w-full border-l-2 px-4 py-3 text-left transition hover:bg-slate-50 ${selectedId === visit.id ? "border-l-blue-600 bg-blue-50/70" : "border-l-transparent"}`}><div className="flex items-center justify-between gap-3"><div className="min-w-0"><div className="truncate text-sm font-black text-slate-900">{visit.vendor}</div><div className="mt-0.5 text-[11px] font-bold text-slate-400">{visit.workDate} · {visitType(visit)} · {visit.author}</div></div><span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${STATUS_CHIP[status]}`}>{statusLabel(status)}</span></div></button>; })}{!loading && !rows.length && <div className="p-12 text-center text-sm font-bold text-slate-400">방문기록이 없습니다.</div>}</div>
    </section>
    <section className="hidden rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:block">{detail}</section>
    {selected && <div className="fixed inset-0 z-[2100] flex items-end bg-slate-950/45 xl:hidden" onMouseDown={() => setSelectedId("")}><section className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 pb-0 pt-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><button type="button" onClick={() => setSelectedId("")} className="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-slate-900/80 text-xl text-white shadow-lg" aria-label="닫기">×</button>{detail}</section></div>}
  </div>;
}

// PDF 첫 장을 pdfjs로 직접 그린다 — 브라우저 내장 뷰어(툴바가 썸네일을 덮음)나
// 구글 드라이브 뷰어(이제 iframe 삽입 차단)에 기대지 않아 어떤 브라우저에서도 미리보기가 나온다.
function PdfCanvas({ url, fit = "cover" }: { url: string; fit?: "cover" | "contain" }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default as string;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const doc = await pdfjs.getDocument({ url }).promise;
        const first = await doc.getPage(1);
        const canvas = canvasRef.current;
        if (!canvas || !alive) return;
        const containerWidth = canvas.parentElement?.clientWidth || 420;
        const base = first.getViewport({ scale: 1 });
        const viewport = first.getViewport({ scale: (containerWidth * 2) / base.width }); // 2배 렌더 = 선명한 축소 표시
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await first.render({ canvas, canvasContext: canvas.getContext("2d") as CanvasRenderingContext2D, viewport }).promise;
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
  }, [url]);
  if (failed) return <div className="flex h-full w-full items-center justify-center bg-slate-100 py-10 text-xs font-black text-slate-400">PDF — [미리보기]로 확인</div>;
  // 카드(cover)는 상자를 채우고, 상세(contain)는 폭에 맞춰 크게 — 세로 문서는 래퍼가 스크롤한다
  return fit === "cover"
    ? <canvas ref={canvasRef} className="h-full w-full bg-white" style={{ objectFit: "cover", objectPosition: "top" }} />
    : <canvas ref={canvasRef} className="block h-auto w-full bg-white" />;
}

function MaterialPreview({ material, compact = false }: { material: PromoMaterial; compact?: boolean }) {
  if (material.file_type.startsWith("image/")) return <img src={material.file_url} alt={material.title} loading="lazy" className={compact ? "h-full w-full object-cover" : "block h-auto w-full"} />;
  return <div className="relative h-full w-full overflow-hidden bg-white">
    <PdfCanvas url={material.file_url} fit={compact ? "cover" : "contain"} />
    
  </div>;
}

export function PromoWorkspace({ author }: { author: string }) {
  const [materials, setMaterials] = useState<PromoMaterial[]>([]); const [visits, setVisits] = useState<VisitRow[]>([]); const [selectedId, setSelectedId] = useState(""); const [sourceVisitId, setSourceVisitId] = useState(""); const [visitPickerOpen, setVisitPickerOpen] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([newContact()]); const [message, setMessage] = useState(""); const [category, setCategory] = useState("전체"); const [materialQuery, setMaterialQuery] = useState(""); const [uploadOpen, setUploadOpen] = useState(false);
  const [title, setTitle] = useState(""); const [uploadCategory, setUploadCategory] = useState(promoCategories[0]); const [description, setDescription] = useState(""); const [file, setFile] = useState<File | null>(null); const [uploading, setUploading] = useState(false); const [notice, setNotice] = useState(""); const fileRef = useRef<HTMLInputElement>(null);
  const reload = () => selectRows<PromoMaterial>("promo_materials", "select=*&active=eq.true&order=created_at.desc").then(setMaterials).catch((error) => setNotice((error as Error).message));
  useEffect(() => { void reload(); void getTeamVisits(dateBefore(30), kstDate()).then((rows) => setVisits(rows.filter((visit) => visit.visited).reverse())); }, []);
  const visible = materials.filter((item) => (category === "전체" || item.category === category) && (!materialQuery.trim() || item.title.includes(materialQuery.trim()) || item.description.includes(materialQuery.trim()))); const selected = materials.find((item) => item.id === selectedId); const sourceVisit = visits.find((visit) => visit.id === sourceVisitId);
  const chooseVisit = (id: string) => { setSourceVisitId(id); setVisitPickerOpen(false); const visit = visits.find((item) => item.id === id); if (!visit) { setContacts([newContact()]); return; } const found = extractVisitContacts(visit.sourceText || visit.note); setContacts(found.length ? found : [newContact()]); setNotice(found.length ? `${visit.vendor} 고객 ${found.length}명을 불러왔습니다.` : "연락처를 찾지 못했습니다. 직접 입력해 주세요."); };
  const upload = async () => { if (!file || !title.trim()) return; if (!/^(image\/|application\/pdf)/.test(file.type)) return setNotice("이미지 또는 PDF만 등록할 수 있습니다."); setUploading(true); try { const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_"); const url = await uploadPublicFile("promo-materials", `${new Date().getFullYear()}/${crypto.randomUUID()}-${safe}`, file, file.type); await insertRow("promo_materials", { title: title.trim(), category: uploadCategory, description: description.trim(), file_url: url, file_type: file.type, active: true, created_by: author, _dupKey: crypto.randomUUID() }); setUploadOpen(false); setTitle(""); setDescription(""); setFile(null); await reload(); } catch (error) { setNotice((error as Error).message); } finally { setUploading(false); } };
  const removeMaterial = async () => { if (!selected || !window.confirm(`${selected.title} 게시물을 삭제할까요?`)) return; await updateRows("promo_materials", `id=eq.${encodeURIComponent(selected.id)}`, { active: false }); setSelectedId(""); await reload(); };
  const promoTokens = (_contact: Contact) => ({ 고객명: "고객", 업체명: sourceVisit?.vendor || "", 담당자: author, 자료명: selected?.title || "", 자료설명: selected?.description || "", 자료링크: selected?.file_url || "" });
  const send = async (channel: "sms" | "email") => { if (!selected) return; const targets = contacts.filter((contact) => contact.selected && (channel === "sms" ? validPhone(contact.phone) : validEmail(contact.email))); if (!targets.length) return setNotice(channel === "sms" ? "발송할 휴대전화 번호를 확인해 주세요." : "발송할 이메일 주소를 확인해 주세요."); try { for (const contact of targets) { const text = applyTokens(message, promoTokens(contact)); await invokeEdgeFunction("customer-message-send", { channel, type: "promotion", to: channel === "sms" ? contact.phone : contact.email, text, materialId: selected.id, author }); } setNotice(`${targets.length}명에게 ${channel === "sms" ? "문자" : "메일"}를 발송했습니다.`); } catch (error) { setNotice(`발송 실패: ${(error as Error).message}`); } };
  const detail = selected ? <div className="flex min-h-0 flex-col">
    <div className="flex items-start justify-between gap-3"><div><div className="text-xs font-black text-blue-600">{selected.category}</div><div className="mt-1 text-lg font-black">{selected.title}</div></div><button onClick={() => void removeMaterial()} className="rounded-full border border-rose-200 px-3 py-2 text-xs font-black text-rose-600">삭제</button></div>
    <div className="mt-3 max-h-[480px] overflow-y-auto rounded-lg border bg-slate-100"><MaterialPreview material={selected} /></div>
    <div className="mt-4 text-xs font-black text-slate-500">
      최근 방문 업체
      <button type="button" onClick={() => setVisitPickerOpen((current) => !current)} className="mt-1 flex w-full items-center justify-between gap-3 rounded-full border border-slate-300 bg-white transition hover:bg-slate-50 px-3 py-2.5 text-left text-sm font-bold text-slate-800">
        <span className="min-w-0 truncate">{sourceVisit ? `${sourceVisit.workDate} · ${sourceVisit.vendor} · ${visitType(sourceVisit)}` : "직접 입력"}</span>
        <span className="shrink-0 text-slate-400">{visitPickerOpen ? "▲" : "▼"}</span>
      </button>
      {visitPickerOpen && <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        <button type="button" onClick={() => chooseVisit("")} className={`block w-full rounded px-3 py-2.5 text-left text-sm font-bold ${!sourceVisitId ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"}`}>직접 입력</button>
        {visits.map((visit) => <button type="button" key={visit.id} onClick={() => chooseVisit(visit.id)} className={`block w-full rounded px-3 py-2.5 text-left ${sourceVisitId === visit.id ? "bg-blue-50" : "hover:bg-slate-50"}`}><span className="block truncate text-sm font-black text-slate-900">{visit.vendor}</span><span className="mt-0.5 block text-[11px] font-bold text-slate-500">{visit.workDate} · {visitType(visit)}</span></button>)}
      </div>}
    </div>
    <div className="mt-3"><ContactsEditor contacts={contacts} onChange={setContacts} email /></div>
    <div className="mt-4"><TemplateBar context="promotion" author={author} body={message} onApply={setMessage} preferredTitle="자료 안내형" applyRevision={selected.id} /></div>
    <textarea rows={6} value={message} onChange={(event) => setMessage(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 p-3 text-sm leading-6 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
    <div className="mt-1 text-[10px] font-bold text-slate-400">이 칸만 고치면 현재 발송에만 적용됩니다. 전체 문구를 바꾸려면 공용 수정 버튼을 누르세요.</div>
    {(() => { const first = contacts.find((contact) => contact.selected); if (!first || !message.trim()) return null; return <div className="mt-2 rounded-xl border border-blue-100 bg-blue-50/40 px-3.5 py-2.5"><div className="text-[10px] font-black tracking-wide text-blue-600">발송 미리보기 · {first.name || "고객"}</div><p className="mt-1 whitespace-pre-wrap break-all text-[13px] font-semibold leading-6 text-slate-700">{applyTokens(message, promoTokens(first))}</p></div>; })()}
    {notice && <div className="mt-3 rounded-lg bg-slate-100 p-3 text-xs font-bold text-slate-600">{notice}</div>}
    <div className="sticky bottom-0 -mx-4 mt-4 grid grid-cols-2 gap-2 border-t bg-white/95 p-3 backdrop-blur xl:static xl:mx-0 xl:p-0 xl:pt-4"><button onClick={() => void send("sms")} className="rounded-full bg-blue-600 shadow-[0_3px_10px_rgba(37,99,235,0.3)] hover:bg-blue-700 px-3 py-2.5 text-sm font-black text-white">문자 발송</button><button onClick={() => void send("email")} className="rounded-full border border-blue-200 bg-white px-3 py-2.5 text-sm font-black text-blue-700 transition hover:bg-blue-50">메일 발송</button><button type="button" onClick={() => window.open(selected.file_url, "_blank", "noopener,noreferrer")} className="rounded-full border border-slate-300 bg-white px-3 py-2.5 text-center text-sm font-black text-slate-600 transition hover:bg-slate-50">미리보기</button><a href={downloadUrl(selected.file_url, selected.title)} className="rounded-full border border-slate-300 bg-white px-3 py-2.5 text-center text-sm font-black text-slate-600 transition hover:bg-slate-50">파일 저장</a></div>
  </div> : <div className="flex min-h-[400px] items-center justify-center text-sm font-semibold text-slate-400">홍보물을 선택하세요.</div>;
  return <div className="space-y-4"><section className="flex items-center justify-between gap-3 overflow-hidden rounded-xl bg-[#1E252F] px-5 py-4 shadow-sm"><div><h2 className="text-base font-black text-white lg:text-lg">홍보물 센터</h2><p className="mt-0.5 hidden text-[11px] font-semibold text-slate-400 sm:block">방문 업체를 불러오거나 직접 입력해 문자·메일·인쇄합니다.</p></div><button onClick={() => setUploadOpen(true)} className="shrink-0 rounded-full bg-blue-600 shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 px-4 py-2.5 text-sm font-black text-white">+ 자료 등록</button></section><div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(470px,.9fr)]"><section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-center gap-1.5 bg-[#151A23] px-4 py-2.5">
      <label className="mr-0.5 flex items-center gap-1.5 rounded-full bg-white/[0.08] px-3 py-1.5 transition focus-within:bg-white/[0.14]"><span className="text-xs text-slate-500">🔍</span><input value={materialQuery} onChange={(event) => setMaterialQuery(event.target.value)} placeholder="자료 검색" className="w-16 bg-transparent text-xs font-bold text-white outline-none placeholder:text-slate-500 sm:w-24" /></label>
      {["전체", ...promoCategories].map((item) => <button key={item} onClick={() => setCategory(item)} className={`rounded-full px-3 py-1.5 text-[11px] font-black transition ${category === item ? "bg-white text-slate-950" : "bg-white/[0.07] text-slate-400 hover:bg-white/[0.14] hover:text-slate-200"}`}>{item}</button>)}</div><div className="grid grid-cols-2 gap-3 p-3 sm:p-4 lg:grid-cols-3">{visible.map((item) => <button key={item.id} onClick={() => setSelectedId(item.id)} className={`overflow-hidden rounded-xl border text-left shadow-sm transition hover:shadow ${selectedId === item.id ? "border-blue-500 ring-2 ring-blue-100" : "border-slate-200 hover:border-slate-300"}`}><div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-slate-100"><MaterialPreview material={item} compact /></div><div className="p-3"><span className="text-[10px] font-black text-blue-600">{item.category}</span><div className="mt-1 line-clamp-2 text-sm font-black leading-snug text-slate-900">{item.title}</div></div></button>)}</div></section><section className="hidden rounded-lg border bg-white p-5 shadow-sm xl:block">{detail}</section></div>
    {selected && <div className="fixed inset-0 z-[2100] flex items-end bg-slate-950/45 xl:hidden" onMouseDown={() => setSelectedId("")}><section className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 pb-0 pt-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><button type="button" onClick={() => setSelectedId("")} className="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-slate-900/80 text-xl text-white shadow-lg" aria-label="닫기">×</button>{detail}</section></div>}
    {uploadOpen && <FormModal title="홍보물 등록" subtitle="등록하면 전 직원 홍보물 센터에 바로 보입니다" icon={<span className="text-base">📎</span>} onClose={() => setUploadOpen(false)}
      footer={<>
        <button type="button" onClick={() => setUploadOpen(false)} className="rounded-full px-4 py-2.5 text-sm font-bold text-slate-500 transition hover:bg-slate-100">취소</button>
        <button disabled={uploading || !title.trim() || !file} onClick={() => void upload()} className="rounded-full bg-blue-600 px-6 py-2.5 text-sm font-black text-white shadow-[0_4px_14px_rgba(37,99,235,0.35)] transition hover:bg-blue-700 disabled:opacity-40 disabled:shadow-none">{uploading ? "등록 중…" : "등록"}</button>
      </>}>
      <div className="space-y-4">
        <label className="block text-xs font-bold text-slate-500">자료 제목 <b className="text-rose-500">*</b>
          <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
        </label>
        <div className="text-xs font-bold text-slate-500">분류
          <div className="mt-1 flex flex-wrap gap-1">{promoCategories.map((item) => <button key={item} type="button" onClick={() => setUploadCategory(item)} className={`rounded-full px-3 py-2 text-xs font-black transition ${uploadCategory === item ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>{item}</button>)}</div>
        </div>
        <label className="block text-xs font-bold text-slate-500">자료 설명
          <textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="문자·메일 문구의 {자료설명} 자리에 들어갑니다" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold leading-6 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
        </label>
        <button onClick={() => fileRef.current?.click()} className={`w-full rounded-xl border border-dashed p-5 text-sm font-black transition ${file ? "border-blue-300 bg-blue-50/50 text-blue-700" : "border-slate-300 text-slate-500 hover:bg-slate-50"}`}>{file ? `📎 ${file.name}` : "이미지 또는 PDF 선택"}</button>
        <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={(event) => setFile(event.target.files?.[0] || null)} />
      </div>
    </FormModal>}
  </div>;
}
