import { useEffect, useMemo, useRef, useState } from "react";
import { getVisits, kstDate, WORK_LABELS, type VisitRow } from "./visits";
import { insertRow, invokeEdgeFunction, selectRows, uploadPublicFile, upsertRow } from "./supabase";

type HappycallStatus = "pending" | "sent" | "failed" | "skip";
type HappycallRecord = {
  visit_id: string;
  author: string;
  recipient: string;
  keyman: string;
  message: string;
  status: HappycallStatus;
  sent_at?: string;
  error?: string;
};

type PromoMaterial = {
  id: string;
  title: string;
  category: string;
  description: string;
  file_url: string;
  file_type: string;
  created_by: string;
  created_at: string;
};

const happycallDays = 45;
const promoCategories = ["IT", "소프트웨어", "퇴사자 보안", "복합기", "기타"];

function dateBefore(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return kstDate(date);
}

function phoneFrom(text: string) {
  const match = text.match(/(?:01[016789]|0\d{1,2})[-.\s]?\d{3,4}[-.\s]?\d{4}/);
  return match?.[0]?.replace(/[^\d]/g, "") || "";
}

function keymanFrom(text: string) {
  const patterns = [
    /(?:키맨|접수자|성함)\s*[:：]?\s*([^\n\r/]+)/,
    /(?:담당자|고객명)\s*[:：]?\s*([^\n\r/]+)/,
  ];
  for (const pattern of patterns) {
    const value = text.match(pattern)?.[1]?.replace(/\d{2,4}[-.\s]\d{3,4}[-.\s]\d{4}.*/, "").trim();
    if (value) return value;
  }
  return "고객";
}

function visitType(visit: VisitRow) {
  if (visit.workKinds.includes("as")) return "AS";
  if (visit.workKinds.includes("inspection")) return "점검";
  return visit.workKinds.map((kind) => WORK_LABELS[kind]).join("·") || "방문 업무";
}

function defaultHappycallMessage(visit: VisitRow, keyman: string) {
  const feedbackBase = String(import.meta.env.VITE_HAPPYCALL_FEEDBACK_URL || "").trim();
  const feedback = feedbackBase ? `\n만족도 남기기: ${feedbackBase}?visit=${encodeURIComponent(visit.id)}` : "";
  return `[퍼스트전산] ${keyman || "고객"}님, ${visit.workDate} ${visitType(visit)}을 담당한 ${visit.author}입니다. 방문 후 기기는 잘 사용하고 계신가요? 불편한 점이 남아 있다면 회사 대표번호로 말씀해 주세요.${feedback}`;
}

function statusLabel(status: HappycallStatus) {
  if (status === "sent") return "발송 완료";
  if (status === "failed") return "발송 실패";
  if (status === "skip") return "제외";
  return "발송 대기";
}

export function HappyCallWorkspace({ author }: { author: string }) {
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [records, setRecords] = useState<HappycallRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [keyman, setKeyman] = useState("");
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState<"pending" | "sent" | "all">("pending");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    const recordRequest = selectRows<HappycallRecord>("happycall_messages", `select=*&author=eq.${encodeURIComponent(author)}&order=created_at.desc`)
      .catch((error) => {
        if (active) setNotice(`해피콜 이력 저장을 사용하려면 최신 SQL을 실행해 주세요: ${(error as Error).message}`);
        return [] as HappycallRecord[];
      });
    Promise.all([getVisits(author, dateBefore(happycallDays), kstDate()), recordRequest]).then(([visitRows, recordRows]) => {
      if (!active) return;
      setVisits(visitRows.filter((visit) => visit.visited && (visit.workKinds.includes("inspection") || visit.workKinds.includes("as"))).reverse());
      setRecords(recordRows);
    }).catch((error) => {
      if (active) setNotice(`방문기록을 불러오지 못했습니다: ${(error as Error).message}`);
    }).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [author]);

  const recordMap = useMemo(() => new Map(records.map((record) => [record.visit_id, record])), [records]);
  const rows = useMemo(() => visits.filter((visit) => {
    const status = recordMap.get(visit.id)?.status || "pending";
    return filter === "all" || status === filter;
  }), [visits, recordMap, filter]);
  const selected = visits.find((visit) => visit.id === selectedId);

  const selectVisit = (visit: VisitRow) => {
    const previous = recordMap.get(visit.id);
    const source = visit.sourceText || visit.note;
    const nextKeyman = previous?.keyman || keymanFrom(source);
    setSelectedId(visit.id);
    setRecipient(previous?.recipient || phoneFrom(source));
    setKeyman(nextKeyman);
    setMessage(previous?.message || defaultHappycallMessage(visit, nextKeyman));
    setNotice("");
  };

  const saveRecord = async (status: HappycallStatus, error = "") => {
    if (!selected) return;
    const row: HappycallRecord = {
      visit_id: selected.id, author, recipient, keyman, message, status,
      sent_at: status === "sent" ? new Date().toISOString() : undefined,
      error,
    };
    await upsertRow("happycall_messages", row, "visit_id");
    setRecords((current) => [row, ...current.filter((item) => item.visit_id !== selected.id)]);
  };

  const send = async () => {
    if (!selected || !/^01\d{8,9}$/.test(recipient)) {
      setNotice("수신 휴대전화 번호를 확인해 주세요.");
      return;
    }
    if (!message.trim()) return;
    setSending(true);
    setNotice("");
    try {
      await invokeEdgeFunction("customer-message-send", {
        type: "happycall", visitId: selected.id, to: recipient, text: message,
        vendor: selected.vendor, author, workKinds: selected.workKinds,
      });
      await saveRecord("sent");
      setNotice("대표번호로 해피콜 문자를 발송했습니다.");
    } catch (error) {
      const detail = (error as Error).message;
      try { await saveRecord("failed", detail); } catch { /* Show the original send error. */ }
      setNotice(`발송하지 못했습니다: ${detail}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(380px,.85fr)]">
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 p-5">
          <div><h2 className="text-xl font-black text-slate-950">해피콜 대기</h2><p className="mt-1 text-sm font-semibold text-slate-500">최근 {happycallDays}일 점검·AS 방문기록에서 가져옵니다.</p></div>
          <div className="rounded-md bg-slate-100 p-1">{(["pending", "sent", "all"] as const).map((item) => <button key={item} type="button" onClick={() => setFilter(item)} className={`rounded px-3 py-1.5 text-xs font-black ${filter === item ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{item === "pending" ? "대기" : item === "sent" ? "완료" : "전체"}</button>)}</div>
        </div>
        <div className="max-h-[680px] divide-y divide-slate-100 overflow-y-auto">
          {rows.map((visit) => {
            const status = recordMap.get(visit.id)?.status || "pending";
            return <button key={visit.id} type="button" onClick={() => selectVisit(visit)} className={`block w-full px-5 py-4 text-left transition hover:bg-slate-50 ${selectedId === visit.id ? "bg-blue-50" : ""}`}>
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-sm font-black text-slate-900">{visit.vendor}</div><div className="mt-1 text-xs font-semibold text-slate-500">{visit.workDate} · {visitType(visit)} · {visit.author}</div></div><span className={`shrink-0 rounded border px-2 py-1 text-[10px] font-black ${status === "sent" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : status === "failed" ? "border-rose-200 bg-rose-50 text-rose-600" : "border-amber-200 bg-amber-50 text-amber-700"}`}>{statusLabel(status)}</span></div>
            </button>;
          })}
          {!loading && !rows.length && <div className="p-12 text-center text-sm font-semibold text-slate-400">해당하는 방문기록이 없습니다.</div>}
          {loading && <div className="p-12 text-center text-sm font-semibold text-slate-400">방문기록을 불러오는 중입니다.</div>}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        {!selected ? <div className="flex min-h-[420px] items-center justify-center text-center text-sm font-semibold text-slate-400">왼쪽에서 방문 건을 선택하세요.<br />FIELD 원본에서 키맨과 연락처를 자동으로 찾습니다.</div> : <div>
          <div className="border-b border-slate-200 pb-4"><div className="text-xs font-black text-blue-600">{visitType(selected)} · {selected.workDate}</div><div className="mt-1 text-lg font-black text-slate-950">{selected.vendor}</div></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <label className="text-xs font-black text-slate-500">고객명<input value={keyman} onChange={(event) => setKeyman(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm" /></label>
            <label className="text-xs font-black text-slate-500">수신번호<input inputMode="tel" value={recipient} onChange={(event) => setRecipient(event.target.value.replace(/[^\d]/g, ""))} placeholder="01012345678" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm" /></label>
          </div>
          <label className="mt-4 block text-xs font-black text-slate-500">발송 문구<textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={9} className="mt-1 w-full resize-y rounded-md border border-slate-300 px-3 py-3 text-sm leading-6" /></label>
          {!!notice && <div className="mt-3 rounded-md bg-slate-100 px-3 py-2.5 text-xs font-bold text-slate-600">{notice}</div>}
          <div className="mt-4 flex gap-2"><button type="button" onClick={() => void saveRecord("skip")} className="rounded-md border border-slate-200 px-4 py-2.5 text-sm font-black text-slate-500">대상 제외</button><button type="button" disabled={sending} onClick={() => void send()} className="ml-auto rounded-md bg-blue-600 px-5 py-2.5 text-sm font-black text-white disabled:opacity-50">{sending ? "발송 중" : "대표번호로 발송"}</button></div>
        </div>}
      </section>
    </div>
  );
}

export function PromoWorkspace({ author }: { author: string }) {
  const [materials, setMaterials] = useState<PromoMaterial[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [category, setCategory] = useState("전체");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [uploadCategory, setUploadCategory] = useState(promoCategories[0]);
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [customer, setCustomer] = useState("");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = () => selectRows<PromoMaterial>("promo_materials", "select=*&active=eq.true&order=created_at.desc").then(setMaterials).catch((error) => setNotice(`자료실을 확인해 주세요: ${(error as Error).message}`));
  useEffect(() => { void reload(); }, []);
  const visible = materials.filter((item) => category === "전체" || item.category === category);
  const selected = materials.find((item) => item.id === selectedId);

  const choose = (item: PromoMaterial) => {
    setSelectedId(item.id);
    setMessage(`[퍼스트전산] ${customer || "고객"}님께 도움이 될 ${item.title} 자료를 보내드립니다.\n${item.description ? `${item.description}\n` : ""}${item.file_url}`);
  };

  const upload = async () => {
    if (!file || !title.trim()) return;
    if (!/^(image\/|application\/pdf)/.test(file.type)) { setNotice("이미지 또는 PDF 파일만 등록할 수 있습니다."); return; }
    setUploading(true);
    setNotice("");
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const url = await uploadPublicFile("promo-materials", `${new Date().getFullYear()}/${crypto.randomUUID()}-${safeName}`, file, file.type);
      await insertRow("promo_materials", { title: title.trim(), category: uploadCategory, description: description.trim(), file_url: url, file_type: file.type, active: true, created_by: author, _dupKey: crypto.randomUUID() });
      setUploadOpen(false); setTitle(""); setDescription(""); setFile(null); await reload();
      setNotice("홍보물을 자료실에 등록했습니다.");
    } catch (error) { setNotice((error as Error).message); } finally { setUploading(false); }
  };

  const sendSms = async () => {
    if (!selected || !/^01\d{8,9}$/.test(recipient)) { setNotice("홍보물과 수신번호를 확인해 주세요."); return; }
    try {
      await invokeEdgeFunction("customer-message-send", { type: "promotion", to: recipient, text: message, materialId: selected.id, author });
      setNotice("대표번호로 홍보물 링크를 발송했습니다.");
    } catch (error) { setNotice(`발송하지 못했습니다: ${(error as Error).message}`); }
  };

  const openEmail = () => {
    if (!selected) return;
    window.location.href = `mailto:?subject=${encodeURIComponent(`[퍼스트전산] ${selected.title}`)}&body=${encodeURIComponent(message)}`;
  };

  return <div className="space-y-4">
    <section className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-xl font-black text-slate-950">홍보물 자료실</h2><p className="mt-1 text-sm font-semibold text-slate-500">회사 공용 자료를 문자·메일로 보내거나 현장에서 바로 인쇄합니다.</p></div><button type="button" onClick={() => setUploadOpen(true)} className="rounded-md bg-blue-600 px-4 py-2.5 text-sm font-black text-white">+ 자료 등록</button></section>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(380px,.8fr)]">
      <section className="rounded-lg border border-slate-200 bg-white shadow-sm"><div className="flex gap-2 overflow-x-auto border-b border-slate-200 p-3">{["전체", ...promoCategories].map((item) => <button key={item} type="button" onClick={() => setCategory(item)} className={`shrink-0 rounded-md px-3 py-2 text-xs font-black ${category === item ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>{item}</button>)}</div><div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">{visible.map((item) => <button key={item.id} type="button" onClick={() => choose(item)} className={`overflow-hidden rounded-md border text-left transition hover:border-blue-300 ${selectedId === item.id ? "border-blue-500 ring-2 ring-blue-100" : "border-slate-200"}`}><div className="flex aspect-[4/3] items-center justify-center bg-slate-100">{item.file_type.startsWith("image/") ? <img src={item.file_url} alt="" className="h-full w-full object-cover" /> : <span className="text-3xl font-black text-rose-500">PDF</span>}</div><div className="p-3"><span className="text-[10px] font-black text-blue-600">{item.category}</span><div className="mt-1 line-clamp-2 text-sm font-black text-slate-900">{item.title}</div></div></button>)}{!visible.length && <div className="col-span-full p-12 text-center text-sm font-semibold text-slate-400">등록된 홍보물이 없습니다.</div>}</div></section>
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">{!selected ? <div className="flex min-h-[360px] items-center justify-center text-center text-sm font-semibold text-slate-400">홍보물을 선택하면<br />발송·메일·인쇄 도구가 열립니다.</div> : <div><div className="text-xs font-black text-blue-600">{selected.category}</div><div className="mt-1 text-lg font-black text-slate-950">{selected.title}</div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2"><label className="text-xs font-black text-slate-500">고객명<input value={customer} onChange={(event) => setCustomer(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm" /></label><label className="text-xs font-black text-slate-500">휴대전화<input inputMode="tel" value={recipient} onChange={(event) => setRecipient(event.target.value.replace(/[^\d]/g, ""))} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm" /></label></div><label className="mt-4 block text-xs font-black text-slate-500">안내 문구<textarea rows={7} value={message} onChange={(event) => setMessage(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-3 text-sm leading-6" /></label><div className="mt-4 grid grid-cols-2 gap-2"><button type="button" onClick={() => void sendSms()} className="rounded-md bg-blue-600 px-3 py-2.5 text-sm font-black text-white">문자 발송</button><button type="button" onClick={openEmail} className="rounded-md border border-slate-200 px-3 py-2.5 text-sm font-black text-slate-700">메일 작성</button><a href={selected.file_url} target="_blank" rel="noreferrer" className="rounded-md border border-slate-200 px-3 py-2.5 text-center text-sm font-black text-slate-700">원본 열기</a><button type="button" onClick={() => { const popup = window.open(selected.file_url, "_blank"); popup?.addEventListener("load", () => popup.print()); }} className="rounded-md border border-slate-200 px-3 py-2.5 text-sm font-black text-slate-700">인쇄</button></div></div>}{!!notice && <div className="mt-4 rounded-md bg-slate-100 px-3 py-2.5 text-xs font-bold text-slate-600">{notice}</div>}</section>
    </div>
    {uploadOpen && <div className="fixed inset-0 z-[2200] flex items-end bg-slate-950/45 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setUploadOpen(false)}><div className="w-full rounded-t-xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-lg" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><div className="text-lg font-black">홍보물 등록</div><button type="button" onClick={() => setUploadOpen(false)} className="h-9 w-9 text-xl text-slate-400">×</button></div><div className="mt-5 space-y-4"><label className="block text-xs font-black text-slate-500">제목<input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm" /></label><label className="block text-xs font-black text-slate-500">분류<select value={uploadCategory} onChange={(event) => setUploadCategory(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm">{promoCategories.map((item) => <option key={item}>{item}</option>)}</select></label><label className="block text-xs font-black text-slate-500">설명<textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm" /></label><button type="button" onClick={() => fileRef.current?.click()} className="w-full rounded-md border border-dashed border-slate-300 p-5 text-sm font-black text-slate-600">{file ? file.name : "이미지 또는 PDF 선택"}</button><input ref={fileRef} type="file" accept="image/*,.pdf,application/pdf" className="hidden" onChange={(event) => setFile(event.target.files?.[0] || null)} /><button type="button" disabled={uploading || !title.trim() || !file} onClick={() => void upload()} className="w-full rounded-md bg-blue-600 px-4 py-3 text-sm font-black text-white disabled:opacity-40">{uploading ? "등록 중" : "자료실에 등록"}</button></div></div></div>}
  </div>;
}
