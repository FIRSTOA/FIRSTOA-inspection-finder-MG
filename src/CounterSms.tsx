/**
 * 카운터 문자전송 — 카톡 마감 목록을 붙여넣으면 업체별 카운터 요청 문자를 만들고
 * 각자 휴대폰 문자앱(sms: 링크)으로 보낸다. 원본(직원 Streamlit 프로젝트) 흐름 유지,
 * 지역별 문구 세트만 파일 대신 DB(counter_sms_settings)에 저장해 전 직원이 공유한다.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageSquare, RotateCcw, Save, Settings2, Trash2, X } from "lucide-react";
import { deleteRows, selectRows, upsertRow } from "./supabase";
import { DEFAULT_FORMATS, DEFAULT_REGIONS, DEFAULT_TEMPLATES, MACHINE_GROUPS } from "./counterSmsData";
import { buildMessage, formatPhone, mergeTargets, parseBlocks, type MergedTarget, type ParsedBlock } from "./counterSmsParser";

type SettingsRow = { region: string; machines: Record<string, string>; templates: Record<string, string>; sort_order?: number };

const REGION_KEY = "cs_counter_region_v1";

export default function CounterSms({ author }: { author: string }) {
  const [profiles, setProfiles] = useState<SettingsRow[]>([]);
  const [region, setRegion] = useState(() => localStorage.getItem(REGION_KEY) || DEFAULT_REGIONS[0]);
  const [tab, setTab] = useState<"main" | "settings">("main");
  const [raw, setRaw] = useState("");
  const [blocks, setBlocks] = useState<ParsedBlock[] | null>(null);
  const [gradeTab, setGradeTab] = useState<"s_group" | "v_group">("s_group");
  const [sendTarget, setSendTarget] = useState<{ target: MergedTarget; message: string } | null>(null);
  const [pickedPhone, setPickedPhone] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const rows = await selectRows<SettingsRow>("counter_sms_settings", "select=*&order=sort_order.asc,region.asc").catch(() => [] as SettingsRow[]);
    if (rows.length) { setProfiles(rows); return; }
    // 첫 사용: 기본 5개 지역 프로필을 DB에 심는다 (원본 A~E 유지)
    const seeded = DEFAULT_REGIONS.map((r, i) => ({ region: r, machines: { ...DEFAULT_FORMATS }, templates: { ...DEFAULT_TEMPLATES }, sort_order: i }));
    for (const row of seeded) await upsertRow("counter_sms_settings", { ...row, updated_by: author }, "region").catch(() => {});
    setProfiles(seeded);
  }, [author]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { localStorage.setItem(REGION_KEY, region); }, [region]);

  const active = useMemo(() => {
    const hit = profiles.find((p) => p.region === region) || profiles[0];
    return {
      region: hit?.region || region,
      machines: { ...DEFAULT_FORMATS, ...(hit?.machines || {}) },
      templates: { ...DEFAULT_TEMPLATES, ...(hit?.templates || {}) },
    };
  }, [profiles, region]);

  const machineKeys = useMemo(() => Object.keys(active.machines), [active.machines]);

  const convert = () => {
    if (!raw.trim()) { setNotice("카톡 내용을 붙여넣어 주세요."); return; }
    const parsed = parseBlocks(raw, machineKeys);
    setBlocks(parsed);
    setNotice(parsed.length ? `${parsed.length}개 블록을 인식했습니다.` : "인식된 업체 블록이 없습니다 — 원문 형식을 확인해 주세요.");
  };
  const resetAll = () => { setRaw(""); setBlocks(null); setNotice(""); };

  const patchBlock = (index: number, patch: Partial<ParsedBlock>) =>
    setBlocks((cur) => (cur ? cur.map((b) => (b.index === index ? { ...b, ...patch } : b)) : cur));

  const targets = useMemo(() => (blocks ? mergeTargets(blocks) : []), [blocks]);
  const shown = targets.filter((t) => t.gradeGroup === gradeTab);

  const openSend = (target: MergedTarget) => {
    const message = buildMessage(target.machines, active.machines, active.templates, target.gradeGroup);
    setPickedPhone(target.phones[0] || "");
    setSendTarget({ target, message });
  };

  // ---- 설정(지역 프로필) ----
  const [draft, setDraft] = useState<{ machines: Record<string, string>; templates: Record<string, string> } | null>(null);
  useEffect(() => { setDraft(null); }, [region, tab]);
  const editing = draft || { machines: active.machines, templates: active.templates };
  const setDraftValue = (kind: "machines" | "templates", key: string, value: string) =>
    setDraft({ ...editing, [kind]: { ...editing[kind], [key]: value } });

  const saveProfile = async () => {
    setBusy(true);
    try {
      await upsertRow("counter_sms_settings", { region: active.region, machines: editing.machines, templates: editing.templates, updated_by: author, updated_at: new Date().toISOString() }, "region");
      setProfiles((cur) => cur.map((p) => (p.region === active.region ? { ...p, ...editing } : p)));
      setDraft(null);
      setNotice(`[${active.region}] 문구를 저장했습니다 — 전 직원에게 반영됩니다.`);
    } catch (e) {
      setNotice(`저장 실패: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };
  const resetProfile = async () => {
    if (!window.confirm(`[${active.region}] 문구를 기본값으로 되돌릴까요?`)) return;
    setBusy(true);
    try {
      await upsertRow("counter_sms_settings", { region: active.region, machines: DEFAULT_FORMATS, templates: DEFAULT_TEMPLATES, updated_by: author, updated_at: new Date().toISOString() }, "region");
      setProfiles((cur) => cur.map((p) => (p.region === active.region ? { ...p, machines: { ...DEFAULT_FORMATS }, templates: { ...DEFAULT_TEMPLATES } } : p)));
      setDraft(null);
      setNotice("기본값으로 되돌렸습니다.");
    } finally { setBusy(false); }
  };
  const [newRegion, setNewRegion] = useState("");
  const addRegion = async () => {
    const name = newRegion.trim();
    if (!name) return;
    if (profiles.some((p) => p.region === name)) { setNotice("이미 있는 지역 이름입니다."); return; }
    await upsertRow("counter_sms_settings", { region: name, machines: DEFAULT_FORMATS, templates: DEFAULT_TEMPLATES, sort_order: profiles.length, updated_by: author }, "region");
    setProfiles((cur) => [...cur, { region: name, machines: { ...DEFAULT_FORMATS }, templates: { ...DEFAULT_TEMPLATES }, sort_order: profiles.length }]);
    setNewRegion("");
    setRegion(name);
  };
  const removeRegion = async () => {
    if (profiles.length <= 1) return;
    if (!window.confirm(`[${active.region}] 프로필을 삭제할까요?`)) return;
    await deleteRows("counter_sms_settings", `region=eq.${encodeURIComponent(active.region)}`);
    const rest = profiles.filter((p) => p.region !== active.region);
    setProfiles(rest);
    setRegion(rest[0]?.region || DEFAULT_REGIONS[0]);
  };

  const field = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10";

  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-xl bg-[#1E252F] shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <div className="text-[15px] font-black text-white">카운터 문자전송</div>
            <div className="mt-0.5 text-[11px] font-semibold text-slate-400">카톡 마감 목록을 붙여넣으면 업체별 요청 문자를 만들어 내 휴대폰 문자앱으로 보냅니다.</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={region} onChange={(e) => setRegion(e.target.value)} className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-black text-white outline-none">
              {profiles.map((p) => <option key={p.region} value={p.region} className="text-slate-900">📍 {p.region}</option>)}
            </select>
            <button type="button" onClick={() => setTab(tab === "main" ? "settings" : "main")}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-2 text-xs font-black text-white transition hover:bg-white/20">
              {tab === "main" ? <><Settings2 size={14} />문구 설정</> : <><MessageSquare size={14} />문자 만들기</>}
            </button>
          </div>
        </div>
        <div className="bg-[#151A23] px-5 py-2 text-[11px] font-bold text-slate-400">
          현재 <span className="text-white">{active.region}</span> 문구 세트로 변환됩니다 · 문구 수정은 전 직원 공용
        </div>
      </section>

      {notice && <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-2.5 text-xs font-black text-blue-700">{notice}</div>}

      {tab === "main" ? (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={8} placeholder="카톡 마감 목록 붙여넣기 (예: 11110, 5N주식회사 무암 … 010-0000-0000 홍길동 과장 …)"
              className="w-full resize-y rounded-lg border border-slate-300 p-3 font-mono text-[12px] leading-6 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={convert} className="rounded-full bg-blue-600 px-5 py-2.5 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700">🔍 마감 문자 변환</button>
              <button type="button" onClick={resetAll} className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-600 transition hover:bg-slate-50"><Trash2 size={14} />초기화</button>
            </div>
          </section>

          {blocks && (
            <>
              <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                  <div className="text-sm font-black text-slate-900">인식 결과 — 잘못된 값은 여기서 고치면 문구에 바로 반영됩니다</div>
                  <div className="mt-0.5 text-[11px] font-semibold text-slate-400">{blocks.length}개 블록 · 같은 번호는 한 통으로 합쳐서 보냅니다</div>
                </div>
                <div className="max-h-[40vh] divide-y divide-slate-100 overflow-y-auto">
                  {blocks.map((b) => (
                    <div key={b.index} className="grid gap-2 px-4 py-3 md:grid-cols-[1.4fr_1fr_1fr]">
                      <label className="text-[10px] font-black text-slate-400">업체명(등급)
                        <input value={b.vendor} onChange={(e) => patchBlock(b.index, { vendor: e.target.value })} className={`mt-1 ${field}`} />
                      </label>
                      <label className="text-[10px] font-black text-slate-400">기종
                        <select value={b.machine} onChange={(e) => patchBlock(b.index, { machine: e.target.value })} className={`mt-1 ${field}`}>
                          {machineKeys.map((k) => <option key={k}>{k}</option>)}
                        </select>
                      </label>
                      <label className="text-[10px] font-black text-slate-400">연락처 (쉼표로 여러 개)
                        <input value={b.contacts.map((c) => c.phone).join(", ")}
                          onChange={(e) => {
                            const phones = e.target.value.split(/[\s,]+/).map((p) => p.replace(/[^0-9]/g, "")).filter(Boolean);
                            const labels = Object.fromEntries(b.contacts.map((c) => [c.phone, c.label]));
                            patchBlock(b.index, { contacts: phones.map((p) => ({ phone: p, label: labels[p] || "" })) });
                          }} className={`mt-1 ${field}`} />
                        {b.contacts.some((c) => c.label) && <span className="mt-1 block truncate text-[10px] font-bold text-emerald-600">👤 {b.contacts.filter((c) => c.label).map((c) => `${c.label}(${formatPhone(c.phone)})`).join(" · ")}</span>}
                      </label>
                    </div>
                  ))}
                </div>
              </section>

              <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex gap-1 border-b border-slate-100 bg-slate-50/70 px-3 pt-2">
                  {([["s_group", `🟢 S·NN·N급 ${targets.filter((t) => t.gradeGroup === "s_group").length}`], ["v_group", `💎 V·SS급 ${targets.filter((t) => t.gradeGroup === "v_group").length}`]] as const).map(([key, label]) => (
                    <button key={key} type="button" onClick={() => setGradeTab(key)}
                      className={`rounded-t-lg px-4 py-2 text-xs font-black transition ${gradeTab === key ? "border-b-2 border-blue-600 bg-white text-blue-700" : "text-slate-400 hover:text-slate-600"}`}>{label}</button>
                  ))}
                </div>
                <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
                  {shown.map((t) => (
                    <button key={t.key} type="button" onClick={() => openSend(t)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left transition hover:border-blue-300 hover:bg-blue-50/40">
                      <div className="truncate text-[13px] font-black text-slate-900">{t.gradeGroup === "v_group" ? "💎" : "✉️"} {t.vendor}</div>
                      <div className="mt-0.5 truncate text-[11px] font-bold text-slate-400">
                        {t.machines.length}대 · {t.phones.length ? t.phones.map(formatPhone).join(", ") : "번호 없음"}
                      </div>
                      {t.vendorNames.length > 1 && <div className="mt-0.5 truncate text-[10px] font-bold text-blue-500">지점 {t.vendorNames.length}곳 통합</div>}
                    </button>
                  ))}
                  {!shown.length && <div className="col-span-full py-8 text-center text-xs font-bold text-slate-400">이 등급군에 인식된 업체가 없습니다.</div>}
                </div>
              </section>
            </>
          )}
        </>
      ) : (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-sm font-black text-slate-900">🌍 지역 프로필</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input value={newRegion} onChange={(e) => setNewRegion(e.target.value)} placeholder="새 지역/담당자 이름" className={`w-48 ${field}`} />
              <button type="button" onClick={() => void addRegion()} className="rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-xs font-black text-blue-700">추가</button>
              <button type="button" onClick={() => void removeRegion()} disabled={profiles.length <= 1} className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-black text-rose-600 disabled:opacity-40">현재 지역 삭제</button>
            </div>
          </section>

          {([["s_group", "🟢 S·NN·N급"], ["v_group", "💎 V·SS급"]] as const).map(([grp, label]) => (
            <details key={grp} open className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <summary className="cursor-pointer bg-slate-50/70 px-4 py-3 text-sm font-black text-slate-900">{label} 문자 양식</summary>
              <div className="grid gap-3 p-4 md:grid-cols-2">
                {([["single_greeting", "인사말 (단일 기기)"], ["single_closing", "마무리말 (단일)"], ["multi_greeting", "인사말 (여러 기기) — {total} 사용 가능"], ["multi_closing", "마무리말 (여러 기기)"]] as const).map(([suffix, title]) => {
                  const key = `${grp === "v_group" ? "v" : "s"}_${suffix}`;
                  return (
                    <label key={key} className="text-[11px] font-black text-slate-500">{title}
                      <textarea value={editing.templates[key] || ""} onChange={(e) => setDraftValue("templates", key, e.target.value)} rows={suffix.includes("greeting") ? 4 : 2}
                        className={`mt-1 resize-y ${field}`} />
                    </label>
                  );
                })}
              </div>
            </details>
          ))}

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="bg-slate-50/70 px-4 py-3 text-sm font-black text-slate-900">🔧 기종별 안내 문구 (방법 설명)</div>
            <div className="divide-y divide-slate-100">
              {MACHINE_GROUPS.map((group) => (
                <details key={group.label} className="px-4 py-2">
                  <summary className="cursor-pointer py-1 text-xs font-black text-slate-600">{group.label}</summary>
                  <div className="grid gap-3 py-2 md:grid-cols-2">
                    {group.models.map((m) => (
                      <label key={m} className="text-[11px] font-black text-slate-500">{m}
                        <textarea value={editing.machines[m] || ""} onChange={(e) => setDraftValue("machines", m, e.target.value)} rows={3} className={`mt-1 resize-y ${field}`} />
                      </label>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </section>

          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || !draft} onClick={() => void saveProfile()} className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 disabled:opacity-40"><Save size={15} />{busy ? "저장 중…" : draft ? "변경사항 저장" : "변경 없음"}</button>
            <button type="button" disabled={busy} onClick={() => void resetProfile()} className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"><RotateCcw size={15} />기본값으로</button>
          </div>
        </>
      )}

      {sendTarget && (() => {
        const { target, message } = sendTarget;
        const label = target.labels[pickedPhone] || "";
        return (
          <div className="fixed inset-0 z-[200] flex items-end bg-black/40 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setSendTarget(null)}>
            <div className="flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-xl" onMouseDown={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3 bg-[#1E252F] px-5 py-4">
                <div className="min-w-0">
                  <div className="text-[11px] font-black text-slate-400">문자 전송 대상 확인</div>
                  <div className="truncate text-[15px] font-black text-white">{target.vendor}</div>
                </div>
                <button type="button" onClick={() => setSendTarget(null)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white"><X size={17} /></button>
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                {target.vendorNames.length > 1 && (
                  <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-3">
                    <div className="text-[10px] font-black text-blue-600">통합된 지점·위치 {target.vendorNames.length}곳</div>
                    <ul className="mt-1 space-y-0.5 text-[11px] font-bold text-slate-600">{target.vendorNames.map((n) => <li key={n}>· {n}</li>)}</ul>
                  </div>
                )}
                {target.phones.length ? (
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-black text-slate-400">수신 연락처</div>
                    {target.phones.map((p) => (
                      <label key={p} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold transition ${pickedPhone === p ? "border-blue-500 bg-blue-50 text-blue-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                        <input type="radio" checked={pickedPhone === p} onChange={() => setPickedPhone(p)} className="h-4 w-4 accent-blue-600" />
                        {target.labels[p] && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-black text-emerald-700">👤 {target.labels[p]}</span>}
                        <span className="font-mono tabular-nums">{formatPhone(p)}</span>
                      </label>
                    ))}
                  </div>
                ) : <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-600">번호가 없습니다 — 인식 결과에서 연락처를 입력해 주세요.</div>}
                <div>
                  <div className="text-[10px] font-black text-slate-400">전송 문구 미리보기</div>
                  <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 font-sans text-xs leading-6 text-slate-700">{message}</pre>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-3">
                <button type="button" onClick={() => { void navigator.clipboard.writeText(message).then(() => setNotice("문구를 복사했습니다.")); }} className="rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-600">복사</button>
                {pickedPhone && (
                  <a href={`sms:${pickedPhone}?body=${encodeURIComponent(message)}`}
                    className="flex-1 rounded-full bg-emerald-600 py-2.5 text-center text-sm font-black text-white transition hover:bg-emerald-700">
                    ✅ {label || formatPhone(pickedPhone)} 에게 문자 보내기
                  </a>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
