import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { deleteRows, insertRow, selectRows, updateRows } from "./supabase";
import PortalSelect from "./PortalSelect";

/**
 * 문자 문구·홍보물 관리.
 *
 * 문구는 해피콜/홍보 화면에서 window.prompt로만 추가·수정할 수 있어 목록을 한눈에
 * 보거나 오타를 고치기 어려웠다. 여기서 표로 관리한다.
 */
type Template = { id: string; context: string; title: string; body: string; active: boolean; created_by?: string; created_at?: string };
type Promo = { id: string; title: string; category?: string; description?: string; file_url?: string; file_type?: string; active: boolean; created_by?: string };

const CONTEXTS = [["happycall", "해피콜"], ["promotion", "홍보"]] as const;

export default function ContentAdmin({ author, view }: { author: string; view: "template" | "promo" }) {
  const tab = view;
  const [templates, setTemplates] = useState<Template[]>([]);
  const [promos, setPromos] = useState<Promo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [tplDraft, setTplDraft] = useState({ context: "happycall", title: "", body: "" });
  const [promoDraft, setPromoDraft] = useState({ title: "", category: "", description: "", file_url: "" });

  const load = async () => {
    setLoading(true);
    try {
      const [tpl, promo] = await Promise.all([
        selectRows<Template>("message_templates", "select=*&order=context.asc,created_at.asc"),
        selectRows<Promo>("promo_materials", "select=*&order=created_at.desc"),
      ]);
      setTemplates(tpl);
      setPromos(promo);
      setError("");
    } catch (e) {
      setError((e as Error).message || "불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const addTemplate = async () => {
    if (!tplDraft.title.trim() || !tplDraft.body.trim()) return;
    setBusy("tpl-add");
    try {
      await insertRow("message_templates", { id: crypto.randomUUID(), context: tplDraft.context, title: tplDraft.title.trim(), body: tplDraft.body.trim(), active: true, created_by: author });
      setTplDraft({ ...tplDraft, title: "", body: "" });
      await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  };

  const patchTemplate = async (row: Template, patch: Partial<Template>) => {
    setBusy(row.id);
    try {
      await updateRows("message_templates", `id=eq.${encodeURIComponent(row.id)}`, patch);
      setTemplates((current) => current.map((item) => (item.id === row.id ? { ...item, ...patch } : item)));
    } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  };

  const removeTemplate = async (row: Template) => {
    if (!window.confirm(`"${row.title}" 문구를 완전히 삭제할까요?\n\n숨기기만 하려면 사용 스위치를 끄세요.`)) return;
    setBusy(row.id);
    try {
      await deleteRows("message_templates", `id=eq.${encodeURIComponent(row.id)}`);
      setTemplates((current) => current.filter((item) => item.id !== row.id));
    } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  };

  const addPromo = async () => {
    if (!promoDraft.title.trim()) return;
    setBusy("promo-add");
    try {
      await insertRow("promo_materials", { id: crypto.randomUUID(), ...promoDraft, title: promoDraft.title.trim(), active: true, created_by: author });
      setPromoDraft({ title: "", category: "", description: "", file_url: "" });
      await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  };

  const patchPromo = async (row: Promo, patch: Partial<Promo>) => {
    setBusy(row.id);
    try {
      await updateRows("promo_materials", `id=eq.${encodeURIComponent(row.id)}`, patch);
      setPromos((current) => current.map((item) => (item.id === row.id ? { ...item, ...patch } : item)));
    } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  };

  const removePromo = async (row: Promo) => {
    if (!window.confirm(`"${row.title}" 홍보물을 삭제할까요?`)) return;
    setBusy(row.id);
    try {
      await deleteRows("promo_materials", `id=eq.${encodeURIComponent(row.id)}`);
      setPromos((current) => current.filter((item) => item.id !== row.id));
    } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  };

  const Toggle = ({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) => (
    <button type="button" disabled={disabled} onClick={onClick} aria-pressed={on}
      className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-40 ${on ? "bg-blue-600" : "bg-slate-200"}`}>
      <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-6" : "left-1"}`} />
    </button>
  );

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-700">{error}</div>}

      {tab === "template" && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-4">
            <h3 className="text-base font-black text-slate-950 lg:text-lg">문자 문구</h3>
            <p className="mt-0.5 text-[11px] font-semibold text-slate-400">해피콜·홍보 화면에서 고르는 공용 문구입니다. 사용 스위치를 끄면 목록에서만 숨습니다.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-4">
            <label className="text-[11px] font-black text-slate-500">쓰이는 곳
              <span className="mt-1 block"><PortalSelect width={130} value={tplDraft.context} onChange={(next) => setTplDraft({ ...tplDraft, context: next })}
                options={CONTEXTS.map(([value, label]) => ({ value, label }))} /></span>
            </label>
            <label className="text-[11px] font-black text-slate-500">문구 이름
              <input value={tplDraft.title} onChange={(e) => setTplDraft({ ...tplDraft, title: e.target.value })} placeholder="예: 점검 후 해피콜"
                className="mt-1 block w-44 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
            </label>
            <label className="min-w-0 flex-1 text-[11px] font-black text-slate-500">내용
              <input value={tplDraft.body} onChange={(e) => setTplDraft({ ...tplDraft, body: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") void addTemplate(); }}
                placeholder="고객에게 보낼 문구" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
            </label>
            <button type="button" onClick={() => void addTemplate()} disabled={!tplDraft.title.trim() || !tplDraft.body.trim() || busy === "tpl-add"}
              className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-2.5 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 disabled:opacity-40"><Plus size={15} />추가</button>
          </div>
          <div className="divide-y divide-slate-100">
            {CONTEXTS.map(([context, label]) => {
              const list = templates.filter((row) => row.context === context);
              return (
                <div key={context}>
                  <div className="flex items-center justify-between bg-slate-50/60 px-4 py-2">
                    <span className="text-xs font-black text-slate-600">{label}</span>
                    <span className="text-[11px] font-bold tabular-nums text-slate-400">{list.length}개</span>
                  </div>
                  {list.map((row) => (
                    <div key={row.id} className="flex flex-wrap items-start gap-2 px-4 py-3">
                      <input defaultValue={row.title} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== row.title) void patchTemplate(row, { title: e.target.value.trim() }); }}
                        className="w-40 shrink-0 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] font-black text-slate-900 outline-none transition focus:border-blue-500" />
                      <textarea defaultValue={row.body} rows={2} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== row.body) void patchTemplate(row, { body: e.target.value.trim() }); }}
                        className="min-w-0 flex-1 resize-y rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] font-semibold text-slate-700 outline-none transition focus:border-blue-500" />
                      <div className="flex shrink-0 items-center gap-2 pt-1">
                        <Toggle on={row.active} disabled={busy === row.id} onClick={() => void patchTemplate(row, { active: !row.active })} />
                        <button type="button" disabled={busy === row.id} onClick={() => void removeTemplate(row)}
                          className="rounded-full p-1.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500 disabled:opacity-40"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  ))}
                  {!list.length && <div className="px-4 py-6 text-center text-[11px] font-bold text-slate-300">{loading ? "불러오는 중…" : "등록된 문구가 없습니다 (기본 문구가 쓰입니다)"}</div>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {tab === "promo" && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-4">
            <h3 className="text-base font-black text-slate-950 lg:text-lg">홍보물</h3>
            <p className="mt-0.5 text-[11px] font-semibold text-slate-400">홍보물 발송·인쇄 화면에서 고르는 목록입니다.</p>
          </div>
          <div className="grid gap-2 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-4">
            {([["title", "제목"], ["category", "분류"], ["description", "설명"], ["file_url", "파일 주소"]] as const).map(([key, label]) => (
              <label key={key} className="text-[11px] font-black text-slate-500">{label}
                <input value={promoDraft[key]} onChange={(e) => setPromoDraft({ ...promoDraft, [key]: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
              </label>
            ))}
            <div className="sm:col-span-2 lg:col-span-4">
              <button type="button" onClick={() => void addPromo()} disabled={!promoDraft.title.trim() || busy === "promo-add"}
                className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-2.5 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 disabled:opacity-40"><Plus size={15} />홍보물 추가</button>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {promos.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-black text-slate-900">{row.title}</span>
                  <span className="block truncate text-[11px] font-semibold text-slate-500">{[row.category, row.description].filter(Boolean).join(" · ") || "-"}</span>
                  {row.file_url && <a href={row.file_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="mt-0.5 block truncate font-mono text-[10px] font-bold text-blue-600 hover:underline">{row.file_url}</a>}
                </span>
                <Toggle on={row.active} disabled={busy === row.id} onClick={() => void patchPromo(row, { active: !row.active })} />
                <button type="button" disabled={busy === row.id} onClick={() => void removePromo(row)}
                  className="rounded-full p-1.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500 disabled:opacity-40"><Trash2 size={14} /></button>
              </div>
            ))}
            {!promos.length && <div className="p-8 text-center text-sm font-bold text-slate-400">{loading ? "불러오는 중…" : "등록된 홍보물이 없습니다."}</div>}
          </div>
        </section>
      )}
    </div>
  );
}
