import { useEffect, useMemo, useRef, useState } from "react";
import { getVisits, kstDate, WORK_LABELS, type VisitRow } from "./visits";
import { insertRow, invokeEdgeFunction, selectRows, updateRows, uploadPublicFile, upsertRow } from "./supabase";

type Contact = { id: string; name: string; phone: string; email: string; selected: boolean };
type HappycallStatus = "pending" | "sent" | "failed" | "skip";
type HappycallRecord = { visit_id: string; author: string; recipient: string; keyman: string; message: string; recipients?: Contact[]; status: HappycallStatus; sent_at?: string; error?: string };
type MessageTemplate = { id: string; context: "happycall" | "promotion"; title: string; body: string; active: boolean; created_by: string };
type PromoMaterial = { id: string; title: string; category: string; description: string; file_url: string; file_type: string; created_by: string; created_at: string };

const happycallDays = 7;
const promoCategories = ["IT", "소프트웨어", "퇴사자 보안", "복합기", "기타"];
const happycallDefaults = [
  { id: "default-check", title: "기본 확인형", body: "[퍼스트전산] {고객명}님, {방문일} {업무}을 담당한 {담당자}입니다. 방문 후 기기는 잘 사용하고 계신가요? 불편한 점이 남아 있다면 회사 대표번호로 말씀해 주세요." },
  { id: "default-short", title: "짧은 만족 확인형", body: "[퍼스트전산] {고객명}님, 오늘 {업무} 후 불편 없이 사용 중이신지 확인드립니다. 추가 도움이 필요하시면 대표번호로 연락 부탁드립니다. 담당 {담당자}" },
  { id: "default-care", title: "추가 관리형", body: "[퍼스트전산] {고객명}님, {업체명} 방문 담당 {담당자}입니다. 처리 후 같은 증상이 반복되거나 다른 불편이 생기면 말씀해 주세요. 빠르게 확인하겠습니다." },
];
const promotionDefaults = [
  { id: "default-info", title: "자료 안내형", body: "[퍼스트전산] {고객명}님께 업무에 도움이 될 {자료명} 자료를 보내드립니다.\n{자료설명}\n{자료링크}" },
  { id: "default-consult", title: "상담 연결형", body: "[퍼스트전산] {고객명}님, 방문 중 말씀드린 {자료명} 안내자료입니다. 검토 후 궁금한 점이나 상담이 필요하시면 대표번호로 연락해 주세요.\n{자료링크}" },
];

function dateBefore(days: number) { const date = new Date(); date.setDate(date.getDate() - days); return kstDate(date); }
function cleanPhone(value: string) { return value.replace(/[^\d]/g, ""); }
function newContact(name = "", phone = "", email = ""): Contact { return { id: crypto.randomUUID(), name, phone: cleanPhone(phone), email, selected: true }; }
function validPhone(value: string) { return /^01\d{8,9}$/.test(cleanPhone(value)); }
function validEmail(value: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()); }

function extractVisitContacts(text: string): Contact[] {
  const lines = text.replaceAll("\r", "").split("\n").map((line) => line.trim()).filter(Boolean);
  const names: string[] = [];
  const phones: string[] = [];
  const contacts: Contact[] = [];
  const relevant = /(키맨(?:\/접수자)?|접수자(?:성함|연락처)?|고객명|연락처|전화번호|일반전화)/;
  const internal = /(방문담당자|영업담당자|요청담당자|수리배정|작성자)/;
  for (const line of lines) {
    if (!relevant.test(line) || internal.test(line)) continue;
    const payload = /[:：]/.test(line)
      ? line.replace(/^[^:：]*[:：]\s*/, "")
      : line.replace(/^.*?(?:키맨(?:\/접수자)?|접수자(?:성함|연락처)?|고객명|연락처|전화번호|일반전화)\s*/, "");
    const linePhones = [...line.matchAll(/(?:01[016789]|0\d{1,2})[-.\s]?\d{3,4}[-.\s]?\d{4}/g)].map((match) => cleanPhone(match[0]));
    const rawName = payload
      .replace(/(?:01[016789]|0\d{1,2})[-.\s]?\d{3,4}[-.\s]?\d{4}/g, "")
      .replace(/[/|,]+$/g, "").trim();
    if (/(성함|키맨|접수자|고객명)/.test(line) && rawName && !/^0+$/.test(rawName) && !/(기종|모델|주소|시리얼)/.test(rawName)) names.push(rawName);
    linePhones.forEach((phone) => phones.push(phone));
    payload.split(/\s*[/|,]\s*/).forEach((segment) => {
      const phone = segment.match(/(?:01[016789]|0\d{1,2})[-.\s]?\d{3,4}[-.\s]?\d{4}/)?.[0];
      const name = segment.replace(/(?:01[016789]|0\d{1,2})[-.\s]?\d{3,4}[-.\s]?\d{4}/g, "").trim();
      if (phone && name && !/(기종|모델|주소|시리얼)/.test(name)) contacts.push(newContact(name, phone));
    });
  }
  phones.forEach((phone, index) => {
    if (!contacts.some((contact) => contact.phone === phone)) contacts.push(newContact(names[index] || names[0] || `고객 ${index + 1}`, phone));
  });
  return contacts.filter((contact, index, rows) => rows.findIndex((item) => item.phone === contact.phone) === index).slice(0, 6);
}

function visitType(visit: VisitRow) { if (visit.workKinds.includes("as")) return "AS"; if (visit.workKinds.includes("inspection")) return "점검"; return visit.workKinds.map((kind) => WORK_LABELS[kind]).join("·") || "방문 업무"; }
function applyTokens(body: string, values: Record<string, string>) { return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), body); }
function statusLabel(status: HappycallStatus) { return status === "sent" ? "발송 완료" : status === "failed" ? "발송 실패" : status === "skip" ? "제외" : "발송 대기"; }

function ContactsEditor({ contacts, onChange, email = false }: { contacts: Contact[]; onChange: (contacts: Contact[]) => void; email?: boolean }) {
  const patch = (id: string, values: Partial<Contact>) => onChange(contacts.map((contact) => contact.id === id ? { ...contact, ...values } : contact));
  return <div className="space-y-2">
    {contacts.map((contact, index) => <div key={contact.id} className={`grid items-center gap-2 rounded-md border p-2 ${email ? "grid-cols-[24px_1fr_1fr_1fr_32px]" : "grid-cols-[24px_1fr_1fr_32px]"} ${contact.selected ? "border-blue-200 bg-blue-50/50" : "border-slate-200 bg-slate-50 opacity-60"}`}>
      <input type="checkbox" checked={contact.selected} onChange={(event) => patch(contact.id, { selected: event.target.checked })} className="h-4 w-4 accent-blue-600" aria-label={`${index + 1}번 고객 선택`} />
      <input value={contact.name} onChange={(event) => patch(contact.id, { name: event.target.value })} placeholder="고객명" className="min-w-0 rounded border border-slate-200 bg-white px-2 py-2 text-xs" />
      <input inputMode="tel" value={contact.phone} onChange={(event) => patch(contact.id, { phone: cleanPhone(event.target.value) })} placeholder="휴대전화" className="min-w-0 rounded border border-slate-200 bg-white px-2 py-2 text-xs" />
      {email && <input type="email" value={contact.email} onChange={(event) => patch(contact.id, { email: event.target.value })} placeholder="이메일" className="min-w-0 rounded border border-slate-200 bg-white px-2 py-2 text-xs" />}
      <button type="button" onClick={() => onChange(contacts.filter((item) => item.id !== contact.id))} aria-label="연락처 삭제" className="h-8 w-8 rounded text-lg font-black text-slate-400 hover:bg-white">×</button>
    </div>)}
    <button type="button" onClick={() => onChange([...contacts, newContact()])} className="w-full rounded-md border border-dashed border-slate-300 py-2 text-xs font-black text-slate-500">+ 고객 직접 추가</button>
  </div>;
}

function useMessageTemplates(context: "happycall" | "promotion", author: string) {
  const defaults = context === "happycall" ? happycallDefaults : promotionDefaults;
  const [custom, setCustom] = useState<MessageTemplate[]>([]);
  const reload = () => selectRows<MessageTemplate>("message_templates", `select=*&context=eq.${context}&active=eq.true&order=created_at.asc`).then(setCustom).catch(() => setCustom([]));
  useEffect(() => { void reload(); }, [context]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (body: string) => {
    const title = window.prompt("문구 이름을 입력하세요.");
    if (!title?.trim() || !body.trim()) return;
    await upsertRow("message_templates", { id: crypto.randomUUID(), context, title: title.trim(), body, active: true, created_by: author }, "id");
    await reload();
  };
  const remove = async (id: string) => { await updateRows("message_templates", `id=eq.${encodeURIComponent(id)}`, { active: false }); await reload(); };
  return { templates: [...defaults, ...custom], save, remove, customIds: new Set(custom.map((item) => item.id)) };
}

function TemplateBar({ context, author, body, onApply }: { context: "happycall" | "promotion"; author: string; body: string; onApply: (body: string) => void }) {
  const { templates, save, remove, customIds } = useMessageTemplates(context, author);
  const [selected, setSelected] = useState(templates[0]?.id || "");
  return <div className="flex flex-wrap gap-2">
    <select value={selected} onChange={(event) => { setSelected(event.target.value); const template = templates.find((item) => item.id === event.target.value); if (template) onApply(template.body); }} className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-black">
      {templates.map((template) => <option key={template.id} value={template.id}>{template.title}</option>)}
    </select>
    <button type="button" onClick={() => void save(body)} className="rounded-md border border-blue-200 px-3 py-2 text-xs font-black text-blue-600">현재 문구 저장</button>
    {customIds.has(selected) && <button type="button" onClick={() => void remove(selected)} className="rounded-md border border-rose-200 px-3 py-2 text-xs font-black text-rose-600">문구 삭제</button>}
  </div>;
}

export function HappyCallWorkspace({ author }: { author: string }) {
  const [visits, setVisits] = useState<VisitRow[]>([]); const [records, setRecords] = useState<HappycallRecord[]>([]);
  const [selectedId, setSelectedId] = useState(""); const [contacts, setContacts] = useState<Contact[]>([]); const [message, setMessage] = useState(happycallDefaults[0].body);
  const [filter, setFilter] = useState<"pending" | "sent" | "all">("pending"); const [loading, setLoading] = useState(true); const [sending, setSending] = useState(false); const [notice, setNotice] = useState("");
  useEffect(() => { let active = true; setLoading(true); const history = selectRows<HappycallRecord>("happycall_messages", `select=*&author=eq.${encodeURIComponent(author)}&order=created_at.desc`).catch(() => [] as HappycallRecord[]); Promise.all([getVisits(author, dateBefore(happycallDays - 1), kstDate()), history]).then(([visitRows, recordRows]) => { if (!active) return; setVisits(visitRows.filter((visit) => visit.visited && (visit.workKinds.includes("inspection") || visit.workKinds.includes("as"))).reverse()); setRecords(recordRows); }).catch((error) => active && setNotice((error as Error).message)).finally(() => active && setLoading(false)); return () => { active = false; }; }, [author]);
  const recordMap = useMemo(() => new Map(records.map((record) => [record.visit_id, record])), [records]);
  const rows = visits.filter((visit) => filter === "all" || (recordMap.get(visit.id)?.status || "pending") === filter); const selected = visits.find((visit) => visit.id === selectedId);
  const choose = (visit: VisitRow) => { const record = recordMap.get(visit.id); const found = record?.recipients?.length ? record.recipients.map((item) => ({ ...item, id: item.id || crypto.randomUUID() })) : extractVisitContacts(visit.sourceText || visit.note); setSelectedId(visit.id); setContacts(found.length ? found : [newContact()]); setMessage(record?.message || happycallDefaults[0].body); setNotice(found.length ? `${found.length}명의 고객 정보를 불러왔습니다.` : "원문에서 연락처를 찾지 못했습니다. 직접 입력해 주세요."); };
  const saveRecord = async (status: HappycallStatus, error = "") => { if (!selected) return; const first = contacts[0] || newContact(); const row = { visit_id: selected.id, author, recipient: first.phone, keyman: first.name, message, recipients: contacts, status, sent_at: status === "sent" ? new Date().toISOString() : null, error }; await upsertRow("happycall_messages", row, "visit_id"); setRecords((current) => [row as HappycallRecord, ...current.filter((item) => item.visit_id !== selected.id)]); };
  const send = async () => { if (!selected) return; const targets = contacts.filter((contact) => contact.selected && validPhone(contact.phone)); if (!targets.length) return setNotice("발송할 휴대전화 번호를 선택해 주세요."); setSending(true); try { for (const contact of targets) { const text = applyTokens(message, { 고객명: contact.name || "고객", 업체명: selected.vendor, 담당자: selected.author, 업무: visitType(selected), 방문일: selected.workDate }); await invokeEdgeFunction("customer-message-send", { channel: "sms", type: "happycall", visitId: selected.id, to: contact.phone, text, vendor: selected.vendor, author }); } await saveRecord("sent"); setNotice(`${targets.length}명에게 대표번호로 발송했습니다.`); } catch (error) { const detail = (error as Error).message; try { await saveRecord("failed", detail); } catch { /* preserve send error */ } setNotice(`발송 실패: ${detail}`); } finally { setSending(false); } };
  return <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(430px,.95fr)]">
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 p-5"><div><h2 className="text-xl font-black">해피콜 대기</h2><p className="mt-1 text-sm font-semibold text-slate-500">최근 7일 점검·AS 방문기록</p></div><div className="rounded-md bg-slate-100 p-1">{(["pending", "sent", "all"] as const).map((item) => <button key={item} onClick={() => setFilter(item)} className={`rounded px-3 py-1.5 text-xs font-black ${filter === item ? "bg-white shadow" : "text-slate-500"}`}>{item === "pending" ? "대기" : item === "sent" ? "완료" : "전체"}</button>)}</div></div><div className="max-h-[700px] divide-y overflow-y-auto">{rows.map((visit) => { const status = recordMap.get(visit.id)?.status || "pending"; return <button key={visit.id} onClick={() => choose(visit)} className={`block w-full p-4 text-left hover:bg-slate-50 ${selectedId === visit.id ? "bg-blue-50" : ""}`}><div className="flex justify-between gap-3"><div><div className="text-sm font-black">{visit.vendor}</div><div className="mt-1 text-xs font-semibold text-slate-500">{visit.workDate} · {visitType(visit)} · {visit.author}</div></div><span className="shrink-0 text-[10px] font-black text-blue-600">{statusLabel(status)}</span></div></button>; })}{!loading && !rows.length && <div className="p-12 text-center text-sm text-slate-400">방문기록이 없습니다.</div>}</div></section>
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">{!selected ? <div className="flex min-h-[430px] items-center justify-center text-center text-sm font-semibold text-slate-400">방문 건을 선택하세요.</div> : <div><div className="border-b pb-4"><div className="text-xs font-black text-blue-600">{selected.workDate} · {visitType(selected)}</div><div className="mt-1 text-lg font-black">{selected.vendor}</div></div><div className="mt-4"><div className="mb-2 text-xs font-black text-slate-500">발송 대상</div><ContactsEditor contacts={contacts} onChange={setContacts} /></div><div className="mt-4"><TemplateBar context="happycall" author={author} body={message} onApply={setMessage} /></div><textarea rows={8} value={message} onChange={(event) => setMessage(event.target.value)} className="mt-2 w-full rounded-md border border-slate-300 p-3 text-sm leading-6" /><div className="text-[10px] font-bold text-slate-400">사용 가능: {'{고객명}'} {'{업체명}'} {'{담당자}'} {'{업무}'} {'{방문일}'}</div>{notice && <div className="mt-3 rounded-md bg-slate-100 p-3 text-xs font-bold text-slate-600">{notice}</div>}<div className="mt-4 flex gap-2"><button onClick={() => void saveRecord("skip")} className="rounded-md border px-4 py-2.5 text-sm font-black text-slate-500">대상 제외</button><button disabled={sending} onClick={() => void send()} className="ml-auto rounded-md bg-blue-600 px-5 py-2.5 text-sm font-black text-white disabled:opacity-50">{sending ? "발송 중" : "선택 고객 발송"}</button></div></div>}</section>
  </div>;
}

export function PromoWorkspace({ author }: { author: string }) {
  const [materials, setMaterials] = useState<PromoMaterial[]>([]); const [visits, setVisits] = useState<VisitRow[]>([]); const [selectedId, setSelectedId] = useState(""); const [sourceVisitId, setSourceVisitId] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([newContact()]); const [message, setMessage] = useState(promotionDefaults[0].body); const [category, setCategory] = useState("전체"); const [uploadOpen, setUploadOpen] = useState(false);
  const [title, setTitle] = useState(""); const [uploadCategory, setUploadCategory] = useState(promoCategories[0]); const [description, setDescription] = useState(""); const [file, setFile] = useState<File | null>(null); const [uploading, setUploading] = useState(false); const [notice, setNotice] = useState(""); const fileRef = useRef<HTMLInputElement>(null);
  const reload = () => selectRows<PromoMaterial>("promo_materials", "select=*&active=eq.true&order=created_at.desc").then(setMaterials).catch((error) => setNotice((error as Error).message));
  useEffect(() => { void reload(); void getVisits(author, dateBefore(30), kstDate()).then((rows) => setVisits(rows.filter((visit) => visit.visited).reverse())); }, [author]);
  const visible = materials.filter((item) => category === "전체" || item.category === category); const selected = materials.find((item) => item.id === selectedId); const sourceVisit = visits.find((visit) => visit.id === sourceVisitId);
  const chooseVisit = (id: string) => { setSourceVisitId(id); const visit = visits.find((item) => item.id === id); if (!visit) return; const found = extractVisitContacts(visit.sourceText || visit.note); setContacts(found.length ? found : [newContact()]); setNotice(found.length ? `${visit.vendor} 고객 ${found.length}명을 불러왔습니다.` : "연락처를 찾지 못했습니다. 직접 입력해 주세요."); };
  const upload = async () => { if (!file || !title.trim()) return; if (!/^(image\/|application\/pdf)/.test(file.type)) return setNotice("이미지 또는 PDF만 등록할 수 있습니다."); setUploading(true); try { const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_"); const url = await uploadPublicFile("promo-materials", `${new Date().getFullYear()}/${crypto.randomUUID()}-${safe}`, file, file.type); await insertRow("promo_materials", { title: title.trim(), category: uploadCategory, description: description.trim(), file_url: url, file_type: file.type, active: true, created_by: author, _dupKey: crypto.randomUUID() }); setUploadOpen(false); setTitle(""); setDescription(""); setFile(null); await reload(); } catch (error) { setNotice((error as Error).message); } finally { setUploading(false); } };
  const removeMaterial = async () => { if (!selected || !window.confirm(`${selected.title} 게시물을 삭제할까요?`)) return; await updateRows("promo_materials", `id=eq.${encodeURIComponent(selected.id)}`, { active: false }); setSelectedId(""); await reload(); };
  const send = async (channel: "sms" | "email") => { if (!selected) return; const targets = contacts.filter((contact) => contact.selected && (channel === "sms" ? validPhone(contact.phone) : validEmail(contact.email))); if (!targets.length) return setNotice(channel === "sms" ? "발송할 휴대전화 번호를 확인해 주세요." : "발송할 이메일 주소를 확인해 주세요."); try { for (const contact of targets) { const text = applyTokens(message, { 고객명: contact.name || "고객", 업체명: sourceVisit?.vendor || "", 담당자: author, 자료명: selected.title, 자료설명: selected.description, 자료링크: selected.file_url }); await invokeEdgeFunction("customer-message-send", { channel, type: "promotion", to: channel === "sms" ? contact.phone : contact.email, text, materialId: selected.id, author }); } setNotice(`${targets.length}명에게 ${channel === "sms" ? "문자" : "메일"}를 발송했습니다.`); } catch (error) { setNotice(`발송 실패: ${(error as Error).message}`); } };
  return <div className="space-y-4"><section className="flex flex-col gap-4 rounded-lg border bg-white p-5 shadow-sm sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-xl font-black">홍보물 자료실</h2><p className="mt-1 text-sm font-semibold text-slate-500">FIELD 방문 고객을 불러오거나 직접 입력해 문자·메일·인쇄합니다.</p></div><button onClick={() => setUploadOpen(true)} className="rounded-md bg-blue-600 px-4 py-2.5 text-sm font-black text-white">+ 자료 등록</button></section><div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(470px,.9fr)]"><section className="rounded-lg border bg-white shadow-sm"><div className="flex gap-2 overflow-x-auto border-b p-3">{["전체", ...promoCategories].map((item) => <button key={item} onClick={() => setCategory(item)} className={`shrink-0 rounded-md px-3 py-2 text-xs font-black ${category === item ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>{item}</button>)}</div><div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">{visible.map((item) => <button key={item.id} onClick={() => setSelectedId(item.id)} className={`overflow-hidden rounded-md border text-left ${selectedId === item.id ? "border-blue-500 ring-2 ring-blue-100" : "border-slate-200"}`}><div className="flex aspect-[4/3] items-center justify-center bg-slate-100">{item.file_type.startsWith("image/") ? <img src={item.file_url} alt="" className="h-full w-full object-cover" /> : <span className="text-3xl font-black text-rose-500">PDF</span>}</div><div className="p-3"><span className="text-[10px] font-black text-blue-600">{item.category}</span><div className="mt-1 text-sm font-black">{item.title}</div></div></button>)}</div></section><section className="rounded-lg border bg-white p-5 shadow-sm">{!selected ? <div className="flex min-h-[400px] items-center justify-center text-sm font-semibold text-slate-400">홍보물을 선택하세요.</div> : <div><div className="flex items-start justify-between gap-3"><div><div className="text-xs font-black text-blue-600">{selected.category}</div><div className="mt-1 text-lg font-black">{selected.title}</div></div><button onClick={() => void removeMaterial()} className="rounded-md border border-rose-200 px-3 py-2 text-xs font-black text-rose-600">게시물 삭제</button></div><label className="mt-4 block text-xs font-black text-slate-500">최근 방문 고객<select value={sourceVisitId} onChange={(event) => chooseVisit(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="">직접 입력</option>{visits.map((visit) => <option key={visit.id} value={visit.id}>{visit.workDate} · {visit.vendor} · {visitType(visit)}</option>)}</select></label><div className="mt-3"><ContactsEditor contacts={contacts} onChange={setContacts} email /></div><div className="mt-4"><TemplateBar context="promotion" author={author} body={message} onApply={setMessage} /></div><textarea rows={7} value={message} onChange={(event) => setMessage(event.target.value)} className="mt-2 w-full rounded-md border border-slate-300 p-3 text-sm leading-6" /><div className="mt-4 grid grid-cols-2 gap-2"><button onClick={() => void send("sms")} className="rounded-md bg-blue-600 px-3 py-2.5 text-sm font-black text-white">선택 고객 문자</button><button onClick={() => void send("email")} className="rounded-md border border-blue-200 px-3 py-2.5 text-sm font-black text-blue-700">선택 고객 메일</button><a href={selected.file_url} target="_blank" rel="noreferrer" className="rounded-md border px-3 py-2.5 text-center text-sm font-black">원본 열기</a><button onClick={() => { const popup = window.open(selected.file_url, "_blank"); popup?.addEventListener("load", () => popup.print()); }} className="rounded-md border px-3 py-2.5 text-sm font-black">인쇄</button></div></div>}{notice && <div className="mt-4 rounded-md bg-slate-100 p-3 text-xs font-bold text-slate-600">{notice}</div>}</section></div>
    {uploadOpen && <div className="fixed inset-0 z-[2200] flex items-end bg-slate-950/45 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setUploadOpen(false)}><div className="w-full rounded-t-xl bg-white p-5 sm:max-w-lg sm:rounded-lg" onMouseDown={(event) => event.stopPropagation()}><div className="flex justify-between"><div className="text-lg font-black">홍보물 등록</div><button onClick={() => setUploadOpen(false)} className="text-xl text-slate-400">×</button></div><div className="mt-5 space-y-4"><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="자료 제목" className="w-full rounded-md border p-3 text-sm" /><select value={uploadCategory} onChange={(event) => setUploadCategory(event.target.value)} className="w-full rounded-md border bg-white p-3 text-sm">{promoCategories.map((item) => <option key={item}>{item}</option>)}</select><textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="자료 설명" className="w-full rounded-md border p-3 text-sm" /><button onClick={() => fileRef.current?.click()} className="w-full rounded-md border border-dashed p-5 text-sm font-black">{file ? file.name : "이미지 또는 PDF 선택"}</button><input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={(event) => setFile(event.target.files?.[0] || null)} /><button disabled={uploading || !title.trim() || !file} onClick={() => void upload()} className="w-full rounded-md bg-blue-600 p-3 text-sm font-black text-white disabled:opacity-40">{uploading ? "등록 중" : "자료실에 등록"}</button></div></div></div>}
  </div>;
}
