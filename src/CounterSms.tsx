/**
 * 카운터 문자전송.
 *
 * 예전 흐름: 직원 10여 명이 각자 카톡 마감 목록을 복사→붙여넣기→변환→전송 — 같은 목록을
 * 사람마다 다시 붙여넣고, 누가 어디까지 보냈는지 서로 모른다.
 *
 * 지금 흐름: 관리부(또는 아무나)가 팀 마감 목록을 한 번 올리면(counter_sms_batches/targets),
 * 팀원은 탭을 열자마자 자기 팀 목록을 보고 한 업체씩 보낸다. 보낸 건 ✓(누가·언제)로 전 직원에게
 * 공유돼 이중 발송이 없다. 문구 세트(counter_sms_settings)·직접 변환(개인용)은 그대로 남긴다.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { askConfirm } from "./confirmModal";
import { MessageSquare, RotateCcw, Save, Settings2, Trash2, Upload, X } from "lucide-react";
import { deleteRows, insertRow, selectRows, updateRows, upsertRow } from "./supabase";
import { teamForAuthor } from "./operations";
import { DEFAULT_FORMATS, DEFAULT_REGIONS, DEFAULT_TEMPLATES, MACHINE_GROUPS } from "./counterSmsData";
import { buildMessage, formatPhone, mergeTargets, parseBlocks, type MergedTarget, type ParsedBlock } from "./counterSmsParser";

type SettingsRow = { region: string; machines: Record<string, string>; templates: Record<string, string>; sort_order?: number };

type BatchRow = { id: string; team: string; title: string; raw: string; created_by: string; created_at: string };
type TargetRow = {
  id: string; batch_id: string; team: string; vendor: string; grade_group: "s_group" | "v_group";
  phones: string[]; labels: Record<string, string>; machines: string[]; vendor_names: string[];
  sent_at: string | null; sent_by: string | null; sent_phone: string | null;
};

const TEAMS = ["A", "B", "C", "D", "E"] as const;

const REGION_KEY = "cs_counter_region_v1";

export default function CounterSms({ author }: { author: string }) {
  const [profiles, setProfiles] = useState<SettingsRow[]>([]);
  const [region, setRegion] = useState(() => localStorage.getItem(REGION_KEY) || DEFAULT_REGIONS[0]);
  const [tab, setTab] = useState<"main" | "settings">("main");
  const [raw, setRaw] = useState("");
  const [blocks, setBlocks] = useState<ParsedBlock[] | null>(null);
  const [gradeTab, setGradeTab] = useState<"s_group" | "v_group">("s_group");
  const [sendTarget, setSendTarget] = useState<{ target: MergedTarget; message: string; row?: TargetRow } | null>(null);
  const [pickedPhone, setPickedPhone] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  // ── 팀 공유 마감 리스트 ──
  const myTeam = useMemo(() => { const t = teamForAuthor(author); return (TEAMS as readonly string[]).includes(t) ? t : "C"; }, [author]);
  const [team, setTeam] = useState<string>("");           // ""이면 아직 미결정 — author 로드 후 내 팀으로
  useEffect(() => { setTeam((cur) => cur || myTeam); }, [myTeam]);
  const [batch, setBatch] = useState<BatchRow | null>(null);
  const [batchTargets, setBatchTargets] = useState<TargetRow[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadRaw, setUploadRaw] = useState("");
  const [uploadBlocks, setUploadBlocks] = useState<ParsedBlock[] | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");

  const loadBatch = useCallback(async (t: string) => {
    if (!t) return;
    setBatchLoading(true);
    try {
      const batches = await selectRows<BatchRow>("counter_sms_batches", `select=*&team=eq.${encodeURIComponent(t)}&order=created_at.desc&limit=1`);
      const latest = batches[0] || null;
      setBatch(latest);
      setBatchTargets(latest
        ? await selectRows<TargetRow>("counter_sms_targets", `select=*&batch_id=eq.${encodeURIComponent(latest.id)}&order=id.asc`)
        : []);
    } catch {
      setBatch(null); setBatchTargets([]);
    } finally { setBatchLoading(false); }
  }, []);
  useEffect(() => { void loadBatch(team); }, [team, loadBatch]);

  // 팀 글자 → 문구 세트 지역 ("A" → "A지역"). 없으면 지금 고른 지역 세트
  const regionForTeam = useCallback((t: string) => profiles.find((p) => p.region === `${t}지역`)?.region || region, [profiles, region]);

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

  // 팀 목록의 행 → 전송 모달 (문구는 그 팀의 지역 세트로)
  const openSendRow = (row: TargetRow) => {
    const regionName = regionForTeam(row.team);
    const profile = profiles.find((p) => p.region === regionName);
    const machinesSet = { ...DEFAULT_FORMATS, ...(profile?.machines || {}) };
    const templatesSet = { ...DEFAULT_TEMPLATES, ...(profile?.templates || {}) };
    const message = buildMessage(row.machines, machinesSet, templatesSet, row.grade_group);
    setPickedPhone(row.sent_phone || row.phones[0] || "");
    setSendTarget({
      target: { key: row.id, vendor: row.vendor, gradeGroup: row.grade_group, phones: row.phones, labels: row.labels, machines: row.machines, vendorNames: row.vendor_names },
      message, row,
    });
  };

  // 전송 표시 — sms: 링크는 실제 발송 여부를 알려주지 않으므로 "문자앱을 연 순간"을 전송으로 기록한다.
  // 잘못 눌렀으면 카드의 [전송 취소]로 되돌린다. 기록은 팀 전체에 공유돼 이중 발송을 막는다.
  const markSent = (row: TargetRow, phone: string) => {
    const patch = { sent_at: new Date().toISOString(), sent_by: author || "미지정", sent_phone: phone };
    setBatchTargets((cur) => cur.map((t) => (t.id === row.id ? { ...t, ...patch } : t)));
    void updateRows("counter_sms_targets", `id=eq.${encodeURIComponent(row.id)}`, patch).catch(() => undefined);
  };
  const unmarkSent = (row: TargetRow) => {
    setBatchTargets((cur) => cur.map((t) => (t.id === row.id ? { ...t, sent_at: null, sent_by: null, sent_phone: null } : t)));
    void updateRows("counter_sms_targets", `id=eq.${encodeURIComponent(row.id)}`, { sent_at: null, sent_by: null, sent_phone: null }).catch(() => undefined);
  };

  // 마감 목록 올리기 — 붙여넣기 → 변환 미리보기(수정 가능) → 팀에 등록
  const uploadConvert = () => {
    if (!uploadRaw.trim()) { setNotice("마감 목록을 붙여넣어 주세요."); return; }
    const regionName = regionForTeam(team);
    const profile = profiles.find((p) => p.region === regionName);
    const keys = Object.keys({ ...DEFAULT_FORMATS, ...(profile?.machines || {}) });
    const parsed = parseBlocks(uploadRaw, keys);
    setUploadBlocks(parsed);
    setNotice(parsed.length ? `${parsed.length}개 블록을 인식했습니다 — 확인 후 [${team}팀에 등록]을 누르세요.` : "인식된 업체 블록이 없습니다 — 원문 형식을 확인해 주세요.");
  };
  const patchUploadBlock = (index: number, patch: Partial<ParsedBlock>) =>
    setUploadBlocks((cur) => (cur ? cur.map((b) => (b.index === index ? { ...b, ...patch } : b)) : cur));
  const publishBatch = async () => {
    if (!uploadBlocks?.length) return;
    const merged = mergeTargets(uploadBlocks);
    if (!await askConfirm(`${team}팀에 마감 목록을 등록할까요?

업체 ${merged.length}곳 (기존 목록을 대체하는 게 아니라 최신 목록으로 올라갑니다)
팀원 모두가 이 목록을 보고 바로 전송할 수 있습니다.`)) return;
    setBusy(true);
    try {
      const id = `csb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await insertRow("counter_sms_batches", {
        id, team, title: uploadTitle.trim() || `${new Date().getMonth() + 1}월 마감`, raw: uploadRaw, created_by: author || "미지정",
      });
      for (let i = 0; i < merged.length; i += 1) {
        const t = merged[i];
        await insertRow("counter_sms_targets", {
          id: `${id}-${String(i).padStart(3, "0")}`, batch_id: id, team,
          vendor: t.vendor, grade_group: t.gradeGroup, phones: t.phones, labels: t.labels,
          machines: t.machines, vendor_names: t.vendorNames,
        });
      }
      setUploadOpen(false); setUploadRaw(""); setUploadBlocks(null); setUploadTitle("");
      setNotice(`${team}팀에 ${merged.length}곳을 등록했습니다 — 팀원 모두에게 보입니다.`);
      await loadBatch(team);
    } catch (e) {
      setNotice(`등록 실패: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };
  const removeBatch = async () => {
    if (!batch) return;
    if (!await askConfirm(`[${batch.team}팀] ${batch.title} 목록을 삭제할까요?
전송 기록도 함께 지워집니다.`)) return;
    await deleteRows("counter_sms_targets", `batch_id=eq.${encodeURIComponent(batch.id)}`).catch(() => undefined);
    await deleteRows("counter_sms_batches", `id=eq.${encodeURIComponent(batch.id)}`).catch(() => undefined);
    await loadBatch(team);
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
    if (!await askConfirm(`[${active.region}] 문구를 기본값으로 되돌릴까요?`)) return;
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
    if (!await askConfirm(`[${active.region}] 프로필을 삭제할까요?`)) return;
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
            <button type="button" onClick={() => { setUploadOpen(true); setUploadBlocks(null); }}
              className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-3.5 py-2 text-xs font-black text-white transition hover:bg-blue-700">
              <Upload size={14} />마감 목록 올리기
            </button>
            <button type="button" onClick={() => setTab(tab === "main" ? "settings" : "main")}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-2 text-xs font-black text-white transition hover:bg-white/20">
              {tab === "main" ? <><Settings2 size={14} />문구 설정</> : <><MessageSquare size={14} />돌아가기</>}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 bg-[#151A23] px-5 py-2.5">
          {TEAMS.map((t) => (
            <button key={t} type="button" onClick={() => setTeam(t)}
              className={`rounded-full px-3 py-1.5 text-[12px] font-black transition ${team === t ? "bg-white text-slate-950" : "bg-white/10 text-slate-300 hover:bg-white/20"}`}>
              {t}팀{t === myTeam ? " ★" : ""}
            </button>
          ))}
          {tab === "settings" && (
            <select value={region} onChange={(e) => setRegion(e.target.value)} className="ml-auto rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-black text-white outline-none">
              {profiles.map((p) => <option key={p.region} value={p.region} className="text-slate-900">📍 {p.region}</option>)}
            </select>
          )}
        </div>
      </section>

      {notice && <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-2.5 text-xs font-black text-blue-700">{notice}</div>}

      {tab === "main" ? (
        <>
          {/* 팀 공유 마감 목록 — 관리부가 한 번 올리면 팀원 모두 여기서 바로 보낸다 */}
          {batchLoading && <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-xs font-bold text-slate-400">{team}팀 목록을 불러오는 중…</div>}
          {!batchLoading && !batch && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
              <div className="text-sm font-black text-slate-500">{team}팀에 올라온 마감 목록이 없습니다</div>
              <div className="mt-1 text-[11px] font-bold text-slate-400">관리부(또는 팀원)가 [마감 목록 올리기]로 등록하면 팀원 모두 여기서 바로 전송합니다.</div>
            </div>
          )}
          {!batchLoading && batch && (() => {
            const sentCount = batchTargets.filter((t) => t.sent_at).length;
            const shownRows = batchTargets
              .filter((t) => t.grade_group === gradeTab)
              .sort((a, b) => Number(!!a.sent_at) - Number(!!b.sent_at));   // 안 보낸 것 먼저
            return (
              <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-black text-slate-900">{batch.title} <span className="font-bold text-slate-400">· {batch.created_by} · {batch.created_at.slice(5, 16).replace("T", " ")}</span></div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1.5 w-40 overflow-hidden rounded-full bg-slate-200">
                        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${batchTargets.length ? Math.round((sentCount / batchTargets.length) * 100) : 0}%` }} />
                      </div>
                      <span className="text-[11px] font-black tabular-nums text-emerald-600">{sentCount}/{batchTargets.length} 전송</span>
                    </div>
                  </div>
                  <button type="button" onClick={() => void loadBatch(team)} className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-black text-slate-500">새로고침</button>
                  <button type="button" onClick={() => void removeBatch()} className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] font-black text-rose-600">목록 삭제</button>
                </div>
                <div className="flex gap-1 border-b border-slate-100 bg-slate-50/40 px-3 pt-2">
                  {([["s_group", `🟢 S·NN·N급 ${batchTargets.filter((t) => t.grade_group === "s_group").length}`], ["v_group", `💎 V·SS급 ${batchTargets.filter((t) => t.grade_group === "v_group").length}`]] as const).map(([key, label]) => (
                    <button key={key} type="button" onClick={() => setGradeTab(key)}
                      className={`rounded-t-lg px-4 py-2 text-xs font-black transition ${gradeTab === key ? "border-b-2 border-blue-600 bg-white text-blue-700" : "text-slate-400 hover:text-slate-600"}`}>{label}</button>
                  ))}
                </div>
                <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
                  {shownRows.map((row) => (
                    <div key={row.id} className={`relative rounded-lg border px-3 py-2.5 transition ${row.sent_at ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200 bg-white hover:border-blue-300"}`}>
                      <button type="button" onClick={() => openSendRow(row)} className="block w-full text-left">
                        <div className="flex items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate text-[13px] font-black text-slate-900">{row.grade_group === "v_group" ? "💎" : "✉️"} {row.vendor}</span>
                          {row.sent_at && <span className="shrink-0 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-black text-white">✓</span>}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] font-bold text-slate-400">
                          {row.machines.length}대 · {row.phones.length ? row.phones.map(formatPhone).join(", ") : "번호 없음"}
                        </div>
                        {row.sent_at
                          ? <div className="mt-0.5 truncate text-[10px] font-black text-emerald-700">{row.sent_by} · {row.sent_at.slice(5, 16).replace("T", " ")}{row.sent_phone ? ` · ${formatPhone(row.sent_phone)}` : ""}</div>
                          : row.vendor_names.length > 1 && <div className="mt-0.5 truncate text-[10px] font-bold text-blue-500">지점 {row.vendor_names.length}곳 통합</div>}
                      </button>
                      {row.sent_at && (
                        <button type="button" onClick={() => unmarkSent(row)}
                          className="absolute right-2 top-2 rounded border border-emerald-200 bg-white px-1.5 py-0.5 text-[9px] font-black text-emerald-600">전송 취소</button>
                      )}
                    </div>
                  ))}
                  {!shownRows.length && <div className="col-span-full py-6 text-center text-xs font-bold text-slate-400">이 등급군에 업체가 없습니다.</div>}
                </div>
              </section>
            );
          })()}

          {/* 개인용 직접 변환 — 공유 목록에 없는 걸 급히 보낼 때만 */}
          <details className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <summary className="cursor-pointer px-4 py-3 text-[12px] font-black text-slate-500">✂️ 직접 붙여넣어 변환 (개인용) — 공유 목록에 없는 건을 급히 보낼 때</summary>
            <div className="border-t border-slate-100 p-4">
            <div className="mb-2 text-[11px] font-bold text-slate-400">현재 <b className="text-slate-600">{active.region}</b> 문구 세트로 변환됩니다</div>
            <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={8} placeholder="카톡 마감 목록 붙여넣기 (예: 11110, 5N주식회사 무암 … 010-0000-0000 홍길동 과장 …)"
              className="w-full resize-y rounded-lg border border-slate-300 p-3 font-mono text-[12px] leading-6 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
            <div className="mt-2 flex flex-wrap gap-2">
              <select value={region} onChange={(e) => setRegion(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 outline-none">
                {profiles.map((p) => <option key={p.region} value={p.region}>📍 {p.region}</option>)}
              </select>
              <button type="button" onClick={convert} className="rounded-full bg-blue-600 px-5 py-2.5 text-sm font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700">🔍 마감 문자 변환</button>
              <button type="button" onClick={resetAll} className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-600 transition hover:bg-slate-50"><Trash2 size={14} />초기화</button>
            </div>
            </div>
          </details>

          {blocks && (
            <>
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
              <details className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <summary className="cursor-pointer border-b border-slate-100 bg-slate-50/70 px-4 py-2.5 text-[11px] font-black text-slate-500">
                  🔧 인식 결과 수정 ({blocks.length}건) — 업체명·기종·번호가 틀렸을 때만 열면 됩니다
                </summary>
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
              </details>

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

      {uploadOpen && (
        <div className="fixed inset-0 z-[210] flex items-end bg-black/45 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setUploadOpen(false)}>
          <div className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-w-3xl sm:rounded-xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 bg-[#1E252F] px-5 py-4">
              <div className="min-w-0">
                <div className="text-[11px] font-black text-slate-400">마감 목록 올리기 — 한 번 올리면 팀원 모두가 바로 전송</div>
                <div className="text-[15px] font-black text-white">{team}팀 카운터 마감</div>
              </div>
              <button type="button" onClick={() => setUploadOpen(false)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white"><X size={17} /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              <div className="flex flex-wrap items-center gap-2">
                {TEAMS.map((t) => (
                  <button key={t} type="button" onClick={() => { setTeam(t); setUploadBlocks(null); }}
                    className={`rounded-full px-3 py-1.5 text-[12px] font-black transition ${team === t ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>{t}팀</button>
                ))}
                <input value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} placeholder={`제목 (비우면 "${new Date().getMonth() + 1}월 마감")`}
                  className="min-w-[160px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold outline-none focus:border-blue-500" />
              </div>
              <textarea value={uploadRaw} onChange={(e) => setUploadRaw(e.target.value)} rows={8}
                placeholder="카톡 마감 목록을 그대로 붙여넣으세요"
                className="w-full resize-y rounded-lg border border-slate-300 p-3 font-mono text-[12px] leading-6 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
              {uploadBlocks && (
                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <div className="border-b border-slate-100 bg-slate-50/70 px-3 py-2 text-[11px] font-black text-slate-500">인식 결과 {uploadBlocks.length}건 — 틀린 곳만 고치고 등록하세요</div>
                  <div className="max-h-[36vh] divide-y divide-slate-100 overflow-y-auto">
                    {uploadBlocks.map((b) => (
                      <div key={b.index} className="grid gap-2 px-3 py-2.5 md:grid-cols-[1.4fr_1fr]">
                        <label className="text-[10px] font-black text-slate-400">업체명(등급)
                          <input value={b.vendor} onChange={(e) => patchUploadBlock(b.index, { vendor: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold outline-none focus:border-blue-500" />
                        </label>
                        <label className="text-[10px] font-black text-slate-400">연락처 (쉼표로 여러 개)
                          <input value={b.contacts.map((c) => c.phone).join(", ")}
                            onChange={(e) => {
                              const phones = e.target.value.split(/[\s,]+/).map((v) => v.replace(/[^0-9]/g, "")).filter(Boolean);
                              const labels = Object.fromEntries(b.contacts.map((c) => [c.phone, c.label]));
                              patchUploadBlock(b.index, { contacts: phones.map((v) => ({ phone: v, label: labels[v] || "" })) });
                            }}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold outline-none focus:border-blue-500" />
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex shrink-0 gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-3">
              <button type="button" onClick={uploadConvert} className="rounded-full border border-blue-300 bg-blue-50 px-4 py-2.5 text-sm font-black text-blue-700">🔍 변환 미리보기</button>
              <button type="button" disabled={busy || !uploadBlocks?.length} onClick={() => void publishBatch()}
                className="flex-1 rounded-full bg-blue-600 py-2.5 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-40">
                {busy ? "등록 중…" : `${team}팀에 등록 (${uploadBlocks ? mergeTargets(uploadBlocks).length : 0}곳)`}
              </button>
            </div>
          </div>
        </div>
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
                {sendTarget.row && (
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-[11px] font-bold text-emerald-800">
                    [문자 보내기]를 누르면 팀 목록에 <b>전송 완료 ✓</b>로 표시됩니다 (누가·언제 보냈는지 팀원 모두에게 보입니다). 실제로 안 보냈으면 카드의 [전송 취소]로 되돌리세요.
                  </div>
                )}
                <div>
                  <div className="text-[10px] font-black text-slate-400">전송 문구 미리보기</div>
                  <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 font-sans text-xs leading-6 text-slate-700">{message}</pre>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-3">
                <button type="button" onClick={() => { void navigator.clipboard.writeText(message).then(() => setNotice("문구를 복사했습니다.")); }} className="rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-600">복사</button>
                {pickedPhone && (
                  <a href={`sms:${pickedPhone}?body=${encodeURIComponent(message)}`}
                    onClick={() => { if (sendTarget.row) { markSent(sendTarget.row, pickedPhone); setSendTarget(null); } }}
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
