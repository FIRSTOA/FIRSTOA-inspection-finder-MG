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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { askConfirm } from "./confirmModal";
import { MessageSquare, RotateCcw, Save, Settings2, Upload, X } from "lucide-react";
import { deleteRows, insertRow, invokeEdgeFunction, selectRows, updateRows, upsertRow } from "./supabase";
import { teamForAuthor } from "./operations";
import { DEFAULT_FORMATS, DEFAULT_REGIONS, DEFAULT_TEMPLATES, MACHINE_GROUPS, mergeFormats, mergeTemplates } from "./counterSmsData";
import { buildMessage, formatPhone, mergeTargets, parseBlocks, parseListHeader, type MergedTarget, type ParsedBlock } from "./counterSmsParser";
import { contactChoices, contactVendorKey, loadContactRules, normalizePhone, pickDefaultPhone, removeContactRule, ruleStamp, rulesForVendor, saveContactRule, type ContactRule } from "./counterSmsContacts";
import { counterRoomEntries, prepareCounterSend, sendCounterPhoto, type SendPlan } from "./counterSmsPhoto";
import { saveActivityEvent } from "./operations";

type SettingsRow = { region: string; machines: Record<string, string>; templates: Record<string, string>; sort_order?: number };

// dropped·kept·mode 는 2026-10-10 "목록 맞추기"부터 — 관리부가 완료분을 빼고 다시 올린 목록에 맞춰 빠진 업체를 자동 완료한 기록
type BatchLogEntry = { at: string; by: string; added: number; skipped: string[]; dropped?: string[]; kept?: number; mode?: "sync" | "merge" | "remove" | "auto"; removed?: string[]; missing?: string[]; inbox_id?: number };
type BatchRow = { id: string; team: string; title: string; raw: string; created_by: string; created_at: string; log?: BatchLogEntry[] | null };
type TargetRow = {
  id: string; batch_id: string; team: string; vendor: string; grade_group: "s_group" | "v_group";
  phones: string[]; labels: Record<string, string>; machines: string[]; vendor_names: string[];
  sent_at: string | null; sent_by: string | null; sent_phone: string | null;
  // 2026-09-24 추가 컬럼(supabase/counter-sms-done.sql) — 표가 아직 옛 모양이면 undefined
  done_at?: string | null; done_by?: string | null; added_at?: string | null; added_by?: string | null;
  // 2026-10-10 추가 컬럼(supabase/counter-sms-list-kind.sql) — "" 일반 마감 / "CMS" CMS 마감(따로 올라오는 목록), cms_day 는 CMS 결제일
  list_kind?: string | null; cms_day?: number | null;
  // 2026-10-10 추가 컬럼(supabase/counter-sms-identity.sql) — 관리부 목록 기기 줄의 임대 코드·기번·자산번호. 이름 표기가 바뀌어도 같은 업체를 잇는다
  lease_code?: string | null; serials?: string[] | null; assets?: string[] | null;
};
type InboxRow = { id: number; room: string; sender: string; text: string; received_at: string; applied_at?: string | null; applied_by?: string | null; note?: string | null };

const TEAMS = ["A", "B", "C", "D", "E"] as const;

const REGION_KEY = "cs_counter_region_v1";

export default function CounterSms({ author }: { author: string }) {
  const [profiles, setProfiles] = useState<SettingsRow[]>([]);
  const [region, setRegion] = useState(() => localStorage.getItem(REGION_KEY) || DEFAULT_REGIONS[0]);
  const [tab, setTab] = useState<"main" | "settings">("main");
  const [gradeTab, setGradeTab] = useState<"s_group" | "v_group">("s_group");
  const [sendTarget, setSendTarget] = useState<{ target: MergedTarget; message: string; row?: TargetRow } | null>(null);
  const [pickedPhone, setPickedPhone] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  // 업체별 연락처 규칙(🚫 보내지 말 것 / ⭐ 새 담당) — 팀 공유. 표가 아직 없으면 빈 목록으로 동작(2026-09-16)
  const [contactRules, setContactRules] = useState<ContactRule[]>([]);
  const reloadRules = useCallback(async () => { setContactRules(await loadContactRules()); }, []);
  useEffect(() => { void reloadRules(); }, [reloadRules]);
  // 연락처 기록 목록 모달 — 지금 마감에 안 올라온 업체의 기록도 찾아볼 수 있게(2026-09-17)
  const [rulesOpen, setRulesOpen] = useState(false);
  const [ruleBusy, setRuleBusy] = useState(false);
  const removeRuleFromBook = async (rule: ContactRule) => {
    const label = rule.kind === "block" ? "🚫 보내지 말 것" : "⭐ 새 담당";
    if (!await askConfirm(`${rule.vendor || "업체명 없음"} · ${formatPhone(rule.phone)}\n${label} 기록을 해제할까요? (${ruleStamp(rule)} 기록)`)) return;
    setRuleBusy(true);
    try { await removeContactRule(rule.id); await reloadRules(); setNotice(`기록을 해제했습니다 — ${rule.vendor || formatPhone(rule.phone)}`); }
    catch (e) { setNotice(`기록 해제 실패: ${(e as Error).message}`); }
    finally { setRuleBusy(false); }
  };
  // 목록 카드의 규칙 표시 — 🚫 차단 번호가 섞여 있거나 ⭐ 새 담당이 기록된 업체
  const ruleBadges = (row: TargetRow) => {
    const rr = rulesForVendor(contactRules, row.vendor, ruleCtx(row));
    if (!rr.length) return null;
    const digits = row.phones.map(normalizePhone);
    const blocked = rr.filter((r) => r.kind === "block" && digits.includes(normalizePhone(r.phone)));
    const prefer = rr.find((r) => r.kind === "prefer");
    const allBlocked = blocked.length > 0 && digits.length > 0 && digits.every((p) => blocked.some((r) => normalizePhone(r.phone) === p)) && !prefer;
    const loose = rr.some((r) => r.how === "이름 유사") && !rr.some((r) => r.how !== "이름 유사");
    return (
      <>
        {prefer && <span title={`⭐ 새 담당 ${prefer.name || formatPhone(prefer.phone)} · ${ruleStamp(prefer)} · ${prefer.how}`} className="shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-black text-amber-800">⭐</span>}
        {blocked.length > 0 && <span title={blocked.map((r) => `🚫 ${formatPhone(r.phone)} ${r.memo || ""} · ${ruleStamp(r)} · ${r.how}`).join("\n")} className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-black ${allBlocked ? "bg-rose-600 text-white" : "bg-rose-100 text-rose-700"}`}>🚫{allBlocked ? " 전부" : ""}</span>}
        {loose && <span title="업체명이 비슷하게만 맞는 기록 — 같은 업체인지 확인" className="shrink-0 rounded bg-slate-200 px-1 py-0.5 text-[9px] font-black text-slate-600">이름 유사</span>}
      </>
    );
  };

  // ── 팀 공유 마감 리스트 ──
  const myTeam = useMemo(() => { const t = teamForAuthor(author); return (TEAMS as readonly string[]).includes(t) ? t : "C"; }, [author]);
  const [team, setTeam] = useState<string>("");           // ""이면 아직 미결정 — author 로드 후 내 팀으로
  useEffect(() => { setTeam((cur) => cur || myTeam); }, [myTeam]);
  const [batch, setBatch] = useState<BatchRow | null>(null);
  const [batchTargets, setBatchTargets] = useState<TargetRow[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  // 문자앱에 갔다 돌아오거나 다른 기기에서 표시한 뒤 이 화면으로 오면 최신 표시를 다시 읽는다
  useEffect(() => {
    const onShow = () => { if (document.visibilityState === "visible" && team) void loadBatch(team); };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [team]); // eslint-disable-line react-hooks/exhaustive-deps -- loadBatch는 팀만 보고 서버를 읽는다
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadRaw, setUploadRaw] = useState("");
  const [uploadBlocks, setUploadBlocks] = useState<ParsedBlock[] | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  // 올리는 방식 — sync(기본, 2026-10-10): 관리부는 완료된 업체를 빼고 목록을 다시 올리므로, 붙여넣은 목록을 "지금 열린 전체"로 보고
  //   없는 업체는 추가·이번 목록에 빠진 열린 업체는 자동 완료·있는 업체는 전송·완료 표시 유지 → 완료를 또 누르거나 지난 건이 쌓이지 않는다.
  //   merge: 없는 업체만 추가(빠진 업체 그대로) · replace: 새 목록(달이 바뀔 때)
  const [uploadMode, setUploadMode] = useState<"sync" | "merge" | "replace">("sync");
  const [showDone, setShowDone] = useState(false); // 완료된 카드는 접어 둔다 — 열린 업체만 보이게
  // 완료·추가 이력 컬럼이 있는지(supabase/counter-sms-done.sql 실행 여부) — 없으면 그 기능만 안내하고 나머지는 예전처럼
  const [extended, setExtended] = useState<boolean | null>(null);
  useEffect(() => {
    selectRows("counter_sms_targets", "select=done_at,added_at&limit=1").then(() => setExtended(true)).catch(() => setExtended(false));
  }, []);
  // 목록 종류 컬럼(list_kind·cms_day)이 있는지 — 없으면 CMS 목록은 "추가만"으로 올리고 안내한다(맞추기를 하면 일반 마감이 다 완료돼 버린다)
  const [kindCol, setKindCol] = useState<boolean | null>(null);
  useEffect(() => {
    selectRows("counter_sms_targets", "select=list_kind,cms_day&limit=1").then(() => setKindCol(true)).catch(() => setKindCol(false));
  }, []);
  const kindOf = (t: { list_kind?: string | null }) => (t.list_kind === "CMS" ? "CMS" : "");
  const kindLabel = (k: string) => (k === "CMS" ? "CMS 마감" : "일반 마감");
  // 식별 칸(lease_code·serials, 규칙의 lease_code)이 있는지 — counter-sms-identity.sql 실행 여부
  const [identCols, setIdentCols] = useState<boolean | null>(null);
  useEffect(() => {
    Promise.all([selectRows("counter_sms_targets", "select=lease_code,serials&limit=1"), selectRows("counter_sms_contact_rules", "select=lease_code&limit=1")])
      .then(() => setIdentCols(true)).catch(() => setIdentCols(false));
  }, []);
  const ruleCtx = (row: TargetRow) => ({ phones: row.phones, leaseCodes: row.lease_code ? [row.lease_code] : [], serials: row.serials || [] });
  // 관리부 목록 도착함 — 봇 폰의 점검AS 스크립트(gas-and-bot/supabase-outbox-poller.js ⑧)가 마감방 글을 넣어 둔다. 표가 없으면 조용히 빈 목록
  // 2026-10-10 "그냥 자동으로 올라가게": 탭을 열 때 엣지 함수 counter-inbox-ingest 를 먼저 불러 대기 중인 글을 넣고(크론도 2분마다 같은 일),
  // 도착함에는 자동으로 못 넣은 글(팀 불명·형식 오류)만 남아 [직접 넣기]로 처리한다. 최근 자동 반영 결과는 따로 보여 준다
  const [inbox, setInbox] = useState<InboxRow[]>([]);
  const [autoDone, setAutoDone] = useState<InboxRow[]>([]);
  const [uploadInboxId, setUploadInboxId] = useState<number | null>(null);
  const runIngest = useCallback(async (): Promise<number> => {
    const out = await invokeEdgeFunction<{ processed?: unknown[] }>("counter-inbox-ingest", {}, 25_000).catch(() => ({ processed: [] as unknown[] }));
    return Array.isArray(out?.processed) ? out.processed.length : 0;
  }, []);
  const loadInbox = useCallback(async (t: string) => {
    setInbox(await selectRows<InboxRow>("counter_sms_inbox", "select=id,room,sender,text,received_at,note&applied_at=is.null&order=received_at.desc&limit=5").catch(() => [] as InboxRow[]));
    setAutoDone(t ? await selectRows<InboxRow>("counter_sms_inbox", `select=id,room,sender,received_at,applied_at,applied_by,note&applied_by=eq.${encodeURIComponent("자동")}&note=like.${encodeURIComponent(`${t}팀*`)}&order=applied_at.desc&limit=4`).catch(() => [] as InboxRow[]) : []);
  }, []);
  // 카운터 사진 한 장으로 마감방 전송 + 완료 — 사진 고르기 외엔 손이 안 간다(2026-10-10)
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoRow, setPhotoRow] = useState<TargetRow | null>(null);
  const [photoBusyId, setPhotoBusyId] = useState("");
  // 마감방은 관리 탭 → 카톡방 매핑(업무 종류 "마감")에서 한 곳으로 관리 — 여기선 어디로 가는지 보여 주기만
  const [counterRooms, setCounterRooms] = useState<Array<{ region: string; room: string }>>([]);
  useEffect(() => { void counterRoomEntries().then(setCounterRooms); }, []);
  const pickCounterPhoto = (row: TargetRow) => { setPhotoRow(row); photoInputRef.current?.click(); };
  // 사진을 고르면 바로 보내지 않는다 — 어느 방에 무슨 글과 함께 가는지 확인창에서 보고 [보내기]를 눌러야 나간다
  const [photoConfirm, setPhotoConfirm] = useState<{ row: TargetRow; file: File; preview: string; plan: SendPlan; caption: string } | null>(null);
  const handleCounterPhoto = async (file: File | null) => {
    const row = photoRow; setPhotoRow(null);
    if (!file || !row) return;
    setPhotoBusyId(row.id);
    try {
      const plan = await prepareCounterSend(row, author);
      setPhotoConfirm({ row, file, preview: URL.createObjectURL(file), plan, caption: plan.caption });
    } catch (e) {
      setNotice(`카운터 전송 준비 실패: ${(e as Error).message}`);
    } finally { setPhotoBusyId(""); }
  };
  const closePhotoConfirm = () => { if (photoConfirm) URL.revokeObjectURL(photoConfirm.preview); setPhotoConfirm(null); };
  const confirmCounterPhoto = async () => {
    if (!photoConfirm) return;
    const { row, file, plan, caption } = photoConfirm;
    setPhotoBusyId(row.id);
    try {
      const res = await sendCounterPhoto(row, file, author, { ...plan, caption: caption.trim() || plan.caption });
      // 통합검색 타임라인에 남긴다 — 마감 카운터 사진을 언제 누가 어느 방으로 보냈나(2026-10-10 "모두 기록에 남아야")
      void saveActivityEvent({
        activityDate: new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10), author: author || "미지정", team: row.team, category: "counter", vendor: row.vendor,
        quantity: 1, machineCount: Math.max(1, (row.machines || []).length),
        sourceText: `${res.caption}\n방: ${res.room} · ${res.channel === "pc" ? "카톡 PC 사진" : "봇 글+링크"}\n사진: ${res.url}`,
        metadata: { kind: "counter_photo", room: res.room, channel: res.channel, url: res.url, target_id: row.id, batch_id: row.batch_id, lease_code: row.lease_code || null },
      }).catch(() => undefined);
      const patch = { done_at: new Date().toISOString(), done_by: `${author || "미지정"} · 카운터 사진` };
      if (extended) { setBatchTargets((cur) => cur.map((t) => (t.id === row.id ? { ...t, ...patch } : t))); void persistPatch(row, patch, "완료"); }
      closePhotoConfirm();
      setNotice(res.channel === "pc" ? `${row.vendor} — 카톡 PC가 "${res.room}"에 글+사진을 올립니다 (노트북 실행기). 카드는 완료로 표시했습니다.` : `${row.vendor} — 봇이 "${res.room}"에 글+사진 링크를 올립니다. 카드는 완료로 표시했습니다.`);
    } catch (e) {
      setNotice(`카운터 사진 전송 실패: ${(e as Error).message}`);
    } finally { setPhotoBusyId(""); }
  };
  const markInbox = async (id: number, batchId: string, note = "") => {
    await updateRows("counter_sms_inbox", `id=eq.${id}`, { applied_at: new Date().toISOString(), applied_by: author || "미지정", batch_id: batchId || null, note }).catch(() => undefined);
    setInbox((cur) => cur.filter((r) => r.id !== id));
  };

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
  useEffect(() => {
    if (!team) return;
    void (async () => { await runIngest(); await loadBatch(team); await loadInbox(team); })();
  }, [team, loadBatch, loadInbox, runIngest]);

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
      // 옛 기본 문구 그대로 저장된 칸은 새 기본값({업체명} 포함)으로 승격 — 안 그러면 새 기본이 영영 안 보인다
      machines: mergeFormats(hit?.machines),
      templates: mergeTemplates(hit?.templates),
    };
  }, [profiles, region]);


  // 팀 목록의 행 → 전송 모달 (문구는 그 팀의 지역 세트로)
  const openSendRow = (row: TargetRow) => {
    const regionName = regionForTeam(row.team);
    const profile = profiles.find((p) => p.region === regionName);
    const machinesSet = mergeFormats(profile?.machines);
    const templatesSet = mergeTemplates(profile?.templates);
    const message = buildMessage(row.machines, machinesSet, templatesSet, row.grade_group, row.vendor);
    setPickedPhone(row.sent_phone || pickDefaultPhone(contactChoices(row.phones, row.labels, rulesForVendor(contactRules, row.vendor, ruleCtx(row)))));
    setSendTarget({
      target: { key: row.id, vendor: row.vendor, gradeGroup: row.grade_group, phones: row.phones, labels: row.labels, machines: row.machines, vendorNames: row.vendor_names, listKind: kindOf(row) as "" | "CMS", cmsDay: row.cms_day ?? null, leaseCodes: row.lease_code ? [row.lease_code] : [], serials: row.serials || [], assets: row.assets || [] },
      message, row,
    });
  };

  // 전송 표시 — sms: 링크는 실제 발송 여부를 알려주지 않으므로 "문자앱을 연 순간"을 전송으로 기록한다.
  // 잘못 눌렀으면 카드의 [전송 취소]로 되돌린다. 기록은 팀 전체에 공유돼 이중 발송을 막는다.
  // 저장은 3번까지 다시 시도하고, 끝내 실패하면 화면의 ✓를 되돌리고 알린다 — 예전엔 실패를 삼켜서 화면엔 ✓, 서버엔 없음이 됐고
  // 다음에 열면 "보낸 게 초기화됐다"로 보였다(2026-09-24 심태현). 문자앱으로 넘어가는 순간 모바일 fetch가 끊기기 쉽다.
  const persistPatch = async (row: TargetRow, patch: Partial<TargetRow>, label: string) => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try { await updateRows("counter_sms_targets", `id=eq.${encodeURIComponent(row.id)}`, patch); return true; }
      catch { if (attempt < 3) await new Promise((r) => setTimeout(r, 1200 * attempt)); }
    }
    const revert = Object.fromEntries(Object.keys(patch).map((k) => [k, row[k as keyof TargetRow]]));
    setBatchTargets((cur) => cur.map((t) => (t.id === row.id ? { ...t, ...revert } : t)));
    setNotice(`${label} 기록 저장 실패 — 전파를 확인하고 ${row.vendor} 카드의 표시를 다시 눌러 주세요 (팀원에게는 아직 반영되지 않았습니다)`);
    return false;
  };
  const markSent = (row: TargetRow, phone: string) => {
    const patch = { sent_at: new Date().toISOString(), sent_by: author || "미지정", sent_phone: phone };
    setBatchTargets((cur) => cur.map((t) => (t.id === row.id ? { ...t, ...patch } : t)));
    void persistPatch(row, patch, "전송");
  };
  const unmarkSent = (row: TargetRow) => {
    setBatchTargets((cur) => cur.map((t) => (t.id === row.id ? { ...t, sent_at: null, sent_by: null, sent_phone: null } : t)));
    void persistPatch(row, { sent_at: null, sent_by: null, sent_phone: null }, "전송 취소");
  };
  // 완료 = 문자를 보낸 뒤 마감(카운터 회신·처리)까지 끝난 상태 — 보냄(✓)과 색이 다르다(2026-09-24 "보냈는지 끝났는지 헷갈린다")
  const markDone = (row: TargetRow) => {
    if (!extended) { setNotice("완료 표시를 쓰려면 Supabase SQL Editor에서 supabase/counter-sms-done.sql을 한 번 실행해 주세요."); return; }
    const patch = { done_at: new Date().toISOString(), done_by: author || "미지정" };
    setBatchTargets((cur) => cur.map((t) => (t.id === row.id ? { ...t, ...patch } : t)));
    void persistPatch(row, patch, "완료");
  };
  const unmarkDone = (row: TargetRow) => {
    const patch = { done_at: null, done_by: null };
    setBatchTargets((cur) => cur.map((t) => (t.id === row.id ? { ...t, ...patch } : t)));
    void persistPatch(row, patch, "완료 취소");
  };
  // 카드 하나만 삭제 — 잘못 올라온 업체·중복을 정리할 때. 예전엔 [목록 삭제]로 통째로 지우는 길뿐이었다(2026-10-10 실수 삭제 뒤 요청).
  // 누가 언제 무엇을 지웠는지 목록 머리 이력에 남긴다.
  const removeTarget = async (row: TargetRow) => {
    if (!batch) return;
    if (!await askConfirm(`${row.vendor} 카드를 목록에서 삭제할까요?${row.sent_at ? "\n(보냄·완료 표시도 함께 지워집니다)" : ""}\n\n나머지 업체는 그대로 둡니다.`, { danger: true, okLabel: "이 업체만 삭제" })) return;
    setBusy(true);
    try {
      await deleteRows("counter_sms_targets", `id=eq.${encodeURIComponent(row.id)}`);
      setBatchTargets((cur) => cur.filter((t) => t.id !== row.id));
      if (extended) {
        const entry: BatchLogEntry = { at: new Date().toISOString(), by: author || "미지정", added: 0, skipped: [], mode: "remove", removed: [row.vendor] };
        const nextLog = [...(batch.log || []), entry];
        await updateRows("counter_sms_batches", `id=eq.${encodeURIComponent(batch.id)}`, { log: nextLog }).catch(() => undefined);
        setBatch((cur) => (cur && cur.id === batch.id ? { ...cur, log: nextLog } : cur));
      }
      setNotice(`${row.vendor} 카드를 삭제했습니다.`);
    } catch (e) {
      setNotice(`삭제 실패: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  // 마감 목록 올리기 — 붙여넣기 → 변환 미리보기(수정 가능) → 팀에 등록
  const uploadConvert = (textOverride?: string) => {
    const text = textOverride ?? uploadRaw;
    if (!text.trim()) { setNotice("마감 목록을 붙여넣어 주세요."); return; }
    // 머리글 【수도권C】·26-10 을 읽어 팀·제목을 맞춘다 — 다른 팀 목록을 내 팀에 올리는 실수 방지(2026-10-10)
    const header = parseListHeader(text);
    const notes: string[] = [];
    let targetTeam = team;
    if (header.team && (TEAMS as readonly string[]).includes(header.team) && header.team !== team) {
      targetTeam = header.team; setTeam(header.team); notes.push(`머리글 【${header.team}】에 맞춰 ${header.team}팀으로 바꿨습니다`);
    }
    if (header.monthLabel && !uploadTitle.trim()) setUploadTitle(header.monthLabel);
    // 달이 바뀐 목록(9월 → 10월)은 새 목록으로 — 지난달 목록은 기록으로 남고, 지난달 미완료가 10월 목록에 또 있으면 새 목록에서 다시 보낸다
    if (header.ym && batch && batch.team === targetTeam && targetTeam === team) {
      const batchMonth = Number(batch.title.match(/(\d{1,2})월/)?.[1] || batch.created_at.slice(5, 7));
      if (batchMonth && Number(header.ym.slice(5)) !== batchMonth) { setUploadMode("replace"); notes.push(`지금 목록(${batchMonth}월)과 다른 달이라 새 목록으로 등록합니다`); }
    }
    const regionName = regionForTeam(targetTeam);
    const profile = profiles.find((p) => p.region === regionName);
    const keys = Object.keys(mergeFormats(profile?.machines));
    const parsed = parseBlocks(text, keys);
    setUploadBlocks(parsed);
    // CMS 마감 목록(블록에 "CMS.15")은 따로 올라온다 — 같은 종류끼리만 맞추므로 이 목록으로 일반 마감이 지워지지 않는다
    const cms = parsed.filter((b) => b.listKind === "CMS").length;
    if (cms) notes.push(`CMS 마감 ${cms}건${cms < parsed.length ? ` + 일반 ${parsed.length - cms}건` : ""} — 같은 종류끼리만 맞춥니다${kindCol === false ? " (구분 컬럼이 없어 CMS는 추가만)" : ""}`);
    setNotice(parsed.length ? `${parsed.length}개 블록을 인식했습니다${notes.length ? ` · ${notes.join(" · ")}` : ""} — 확인 후 아래 버튼을 누르세요.` : "인식된 업체 블록이 없습니다 — 원문 형식을 확인해 주세요.");
  };
  const patchUploadBlock = (index: number, patch: Partial<ParsedBlock>) =>
    setUploadBlocks((cur) => (cur ? cur.map((b) => (b.index === index ? { ...b, ...patch } : b)) : cur));
  const publishBatch = async () => {
    if (!uploadBlocks?.length) return;
    const merged = mergeTargets(uploadBlocks);
    const by = author || "미지정";
    // 기존 목록이 있으면 — sync(기본): 붙여넣은 목록을 "지금 열린 전체"로 보고 맞춘다 / merge: 없는 업체만 추가.
    // 있는 업체는 전송·완료 표시 그대로. 언제 누가 몇 곳을 추가·완료했는지 목록 머리에 남긴다(2026-09-24 추가 이력, 2026-10-10 맞추기)
    if (uploadMode !== "replace" && batch && batch.team === team) {
      // 업체 키는 목록 종류까지 포함 — 일반 마감의 A업체와 CMS 마감의 A업체는 다른 카드.
      // 같은 업체 판정은 임대 코드(기기 줄 맨 앞 번호)가 있으면 코드로, 없으면 이름 키로 — 이름이 조금 달라져도(층·메모·글자) 코드가 같으면 같은 업체(2026-10-10)
      const nameKey = (kind: string, vendor: string) => `${kind}|${contactVendorKey(vendor)}`;
      const codeKey = (kind: string, code?: string | null) => (code ? `${kind}|code:${code}` : "");
      const existingNames = new Set(batchTargets.map((t) => nameKey(kindOf(t), t.vendor)));
      const existingCodes = new Set(batchTargets.map((t) => codeKey(kindOf(t), t.lease_code)).filter(Boolean));
      const isExisting = (t: MergedTarget) => existingNames.has(nameKey(t.listKind, t.vendor)) || (t.leaseCodes[0] ? existingCodes.has(codeKey(t.listKind, t.leaseCodes[0])) : false);
      const incomingNames = new Set(merged.map((t) => nameKey(t.listKind, t.vendor)));
      const incomingCodes = new Set(merged.flatMap((t) => t.leaseCodes.map((c) => codeKey(t.listKind, c))));
      const isIncoming = (t: TargetRow) => incomingNames.has(nameKey(kindOf(t), t.vendor)) || (t.lease_code ? incomingCodes.has(codeKey(kindOf(t), t.lease_code)) : false);
      const fresh = merged.filter((t) => !isExisting(t));
      const dupes = merged.filter((t) => isExisting(t));
      // 관리부는 마감(카운터 회신)이 끝난 업체를 빼고 다시 올린다 → 열린 업체 중 이번 목록에 없는 곳은 완료로.
      // 단, **이번 목록에 든 종류끼리만** 비교한다 — CMS 마감 목록(따로 올라옴)을 붙여넣어도 일반 마감 업체는 손대지 않는다(2026-10-10).
      // 이미 완료된 카드는 건드리지 않는다. 완료 컬럼이 없으면(SQL 미실행) 추가만 한다. 종류 컬럼이 없는데 CMS 목록이면 역시 추가만.
      const kindsInPaste = new Set(merged.map((t) => t.listKind));
      const cmsWithoutCol = !kindCol && kindsInPaste.has("CMS");
      const sync = uploadMode === "sync" && !!extended && !cmsWithoutCol;
      const open = batchTargets.filter((t) => !t.done_at && kindsInPaste.has(kindOf(t) as "" | "CMS"));
      const untouched = batchTargets.filter((t) => !t.done_at && !kindsInPaste.has(kindOf(t) as "" | "CMS")).length;
      const dropped = sync ? open.filter((t) => !isIncoming(t)) : [];
      const droppedUnsent = dropped.filter((t) => !t.sent_at);
      const kept = open.length - dropped.length;
      // 관리부가 일부(한 구역·추가분)만 보낸 목록을 전체로 오해하면 멀쩡한 업체가 완료돼 버린다 — 절반 넘게 빠지면 경고
      const tooMany = dropped.length > 0 && dropped.length * 2 >= open.length && merged.length * 2 < open.length;
      const kindsText = [...kindsInPaste].map(kindLabel).join(" + ");
      const lines = [
        sync ? `${team}팀 ${kindsText} 목록을 이 목록에 맞출까요?` : `${team}팀 기존 목록에 추가할까요?`,
        "",
        `새로 추가 ${fresh.length}곳`,
        `그대로 유지 ${sync ? kept : dupes.length}곳 (전송·완료 표시 유지)`,
        ...(sync ? [`목록에서 빠짐 → 완료 처리 ${dropped.length}곳${dropped.length ? `: ${dropped.slice(0, 8).map((t) => t.vendor).join(", ")}${dropped.length > 8 ? " 외" : ""}` : ""}${droppedUnsent.length ? `\n  (문자를 안 보낸 곳 ${droppedUnsent.length}곳 포함 — 관리부 쪽에서 끝난 것으로 봅니다)` : ""}`] : []),
        ...(sync && untouched ? [`다른 종류(${[...kindsInPaste].includes("CMS") ? "일반 마감" : "CMS 마감"}) ${untouched}곳은 그대로 둡니다`] : []),
        ...(tooMany ? ["", "⚠ 열린 업체의 절반 넘게 빠집니다. 관리부가 일부만 보낸 목록이면 [추가만]으로 올리세요."] : []),
        ...(uploadMode === "sync" && !extended ? ["", "※ 완료 컬럼이 아직 없어(supabase/counter-sms-done.sql 미실행) 빠진 업체 완료 처리는 건너뜁니다."] : []),
        ...(uploadMode === "sync" && cmsWithoutCol ? ["", "※ 목록 종류 컬럼이 아직 없어(supabase/counter-sms-list-kind.sql 미실행) CMS 목록은 추가만 합니다 — 맞추기를 하면 일반 마감이 모두 완료돼 버리기 때문입니다."] : []),
      ];
      if (!await askConfirm(lines.join("\n"), { okLabel: sync ? "목록 맞추기" : "추가" })) return;
      setBusy(true);
      try {
        const stamp = new Date().toISOString();
        for (let i = 0; i < fresh.length; i += 1) {
          const t = fresh[i];
          await insertRow("counter_sms_targets", {
            id: `${batch.id}-a${Date.now().toString(36)}-${String(i).padStart(3, "0")}`, batch_id: batch.id, team,
            vendor: t.vendor, grade_group: t.gradeGroup, phones: t.phones, labels: t.labels, machines: t.machines, vendor_names: t.vendorNames,
            ...(extended ? { added_at: stamp, added_by: by } : {}),
            ...(kindCol ? { list_kind: t.listKind, cms_day: t.cmsDay } : {}),
            ...(identCols ? { lease_code: t.leaseCodes[0] || null, serials: t.serials, assets: t.assets } : {}),
          });
        }
        // 빠진 업체 자동 완료 — done_by 에 사유를 남겨 손으로 누른 완료와 구분한다. 잘못됐으면 카드의 [완료 취소]
        for (let i = 0; i < dropped.length; i += 40) {
          const ids = dropped.slice(i, i + 40).map((t) => encodeURIComponent(t.id)).join(",");
          await updateRows("counter_sms_targets", `id=in.(${ids})`, { done_at: stamp, done_by: `${by} · 목록에서 빠짐` });
        }
        if (extended) {
          const entry: BatchLogEntry = { at: stamp, by, added: fresh.length, skipped: sync ? [] : dupes.map((t) => t.vendor), dropped: dropped.map((t) => t.vendor), kept, mode: sync ? "sync" : "merge" };
          await updateRows("counter_sms_batches", `id=eq.${encodeURIComponent(batch.id)}`, { log: [...(batch.log || []), entry] }).catch(() => undefined);
        }
        if (uploadInboxId) { await markInbox(uploadInboxId, batch.id, sync ? "맞추기" : "추가"); setUploadInboxId(null); }
        setUploadOpen(false); setUploadRaw(""); setUploadBlocks(null); setUploadTitle("");
        setNotice(sync
          ? `${team}팀 ${kindsText} 목록을 맞췄습니다 — 새로 ${fresh.length}곳 · 유지 ${kept}곳 · 목록에서 빠져 완료 ${dropped.length}곳${dropped.length ? `(${dropped.slice(0, 6).map((t) => t.vendor).join(", ")}${dropped.length > 6 ? " 외" : ""})` : ""}${untouched ? ` · 다른 종류 ${untouched}곳 그대로` : ""}`
          : `${team}팀 목록에 ${fresh.length}곳을 추가했습니다${dupes.length ? ` · 이미 있어 건너뜀 ${dupes.length}곳(${dupes.map((t) => t.vendor).join(", ")})` : ""}.`);
        await loadBatch(team);
      } catch (e) {
        setNotice(`${sync ? "맞추기" : "추가"} 실패: ${(e as Error).message}`);
      } finally { setBusy(false); }
      return;
    }
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
          ...(extended ? { added_at: new Date().toISOString(), added_by: author || "미지정" } : {}),
          ...(kindCol ? { list_kind: t.listKind, cms_day: t.cmsDay } : {}),
          ...(identCols ? { lease_code: t.leaseCodes[0] || null, serials: t.serials, assets: t.assets } : {}),
        });
      }
      if (uploadInboxId) { await markInbox(uploadInboxId, id, "새 목록"); setUploadInboxId(null); }
      setUploadOpen(false); setUploadRaw(""); setUploadBlocks(null); setUploadTitle("");
      setNotice(`${team}팀에 ${merged.length}곳을 등록했습니다 — 팀원 모두에게 보입니다.`);
      await loadBatch(team);
    } catch (e) {
      setNotice(`등록 실패: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };
  const removeBatch = async () => {
    if (!batch) return;
    // 통째 삭제는 되돌릴 수 없다(2026-10-10 실수 삭제) — 몇 곳이 지워지는지와 "한 업체만 지우려면 카드의 삭제"를 확인창에 적는다
    if (!await askConfirm(`[${batch.team}팀] ${batch.title} 목록 전체(${batchTargets.length}곳)를 삭제할까요?\n보냄·완료 표시까지 모두 지워지고 되돌릴 수 없습니다.\n\n한 업체만 지우려면 취소하고 그 카드의 [삭제]를 누르세요.`, { danger: true, okLabel: `전체 ${batchTargets.length}곳 삭제` })) return;
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
    <div className="min-w-0 space-y-3 overflow-x-hidden">
      <section className="overflow-hidden rounded-xl bg-[#1E252F] shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <div className="text-[15px] font-black text-white">카운터 문자전송</div>
            <div className="mt-0.5 text-[11px] font-semibold text-slate-400">관리부가 마감방에 올린 목록을 그대로 붙여넣으면 팀 목록이 그 목록에 맞춰집니다(빠진 업체는 자동 완료). 카드를 누르면 내 휴대폰 문자앱으로 보냅니다.</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setRulesOpen(true)} title="🚫 보내지 말 것 · ⭐ 새 담당 기록 전체 보기"
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3.5 py-2 text-[12px] font-black text-amber-800 transition hover:bg-amber-100">
              📒 연락처 기록{contactRules.length ? ` ${contactRules.length}` : ""}</button>
            <button type="button" onClick={() => { setUploadOpen(true); setUploadBlocks(null); setUploadMode("sync"); }}
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
              {t}팀
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
          {/* 관리부 목록 — 봇이 마감방 글을 넣으면 엣지 함수가 자동으로 반영한다(있는 업체 그대로, 없는 업체만 추가). 여기엔 최근 자동 반영 결과와 자동으로 못 넣은 글만 보인다(2026-10-10) */}
          {(autoDone.length > 0 || inbox.length > 0) && (
            <section className={`rounded-xl border p-3 ${inbox.length ? "border-amber-300 bg-amber-50/70" : "border-emerald-300 bg-emerald-50/70"}`}>
              {autoDone.length > 0 && (
                <div>
                  <div className="text-[12px] font-black text-emerald-900">⚡ 관리부 목록 자동 반영 <span className="font-bold text-emerald-700">· 있는 업체는 그대로(완료·문자 보냄 유지), 없는 업체만 추가 · "목록에 없는 열린 곳"은 관리부가 끝낸 것이면 카드에서 [완료]</span></div>
                  <ul className="mt-1 space-y-0.5 text-[11px] font-bold text-slate-700">
                    {autoDone.map((r) => <li key={r.id}>{(r.applied_at || "").slice(5, 16).replace("T", " ")} · {r.sender || r.room} → {r.note}</li>)}
                  </ul>
                </div>
              )}
              {inbox.length > 0 && (
                <div className={autoDone.length ? "mt-2 border-t border-amber-200 pt-2" : ""}>
                  <div className="text-[12px] font-black text-amber-900">📥 자동으로 못 넣은 목록 {inbox.length}건 — 확인하고 [직접 넣기]</div>
                  <div className="mt-2 space-y-1.5">
                    {inbox.map((row) => {
                      const head = parseListHeader(row.text); const first = row.text.trim().split("\n").find((l) => l.trim()) || "";
                      return (
                        <div key={row.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-[12px]">
                          <span className="font-black text-slate-800">{head.team ? `${head.team}팀` : row.room}{head.monthLabel ? ` · ${head.monthLabel}` : ""}</span>
                          <span className="min-w-0 flex-1 truncate font-semibold text-slate-500">{first.slice(0, 40)} · {row.text.length.toLocaleString()}자 · {row.sender} · {row.received_at.slice(5, 16).replace("T", " ")}{row.note ? ` · ${row.note}` : " · 아직 처리 전"}</span>
                          <button type="button" onClick={() => { setUploadOpen(true); setUploadBlocks(null); setUploadMode("merge"); setUploadRaw(row.text); setUploadInboxId(row.id); setUploadTitle(""); window.setTimeout(() => uploadConvert(row.text), 0); }} className="rounded-full bg-amber-600 px-3 py-1.5 text-[11px] font-black text-white hover:bg-amber-700">직접 넣기</button>
                          <button type="button" onClick={() => void markInbox(row.id, "", "무시")} className="rounded-full border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-black text-slate-500 hover:bg-slate-50">무시</button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          )}
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
            const doneCount = batchTargets.filter((t) => t.done_at).length;
            const stage = (t: TargetRow) => (t.done_at ? 2 : t.sent_at ? 1 : 0); // 안 보낸 것 → 보냄 → 완료 순
            const addedTag = (t: TargetRow) => (t.added_at && batch && new Date(t.added_at).getTime() - new Date(batch.created_at).getTime() > 5 * 60_000 ? `＋${Number(t.added_at.slice(5, 7))}/${Number(t.added_at.slice(8, 10))}` : "");
            const groupRows = batchTargets
              .filter((t) => t.grade_group === gradeTab)
              .sort((a, b) => stage(a) - stage(b));
            const doneRows = groupRows.filter((t) => t.done_at);
            // 완료는 접어 둔다 — 관리부 목록에서 빠진 업체가 자동 완료되면 카드가 쌓이는데, 할 일은 열린 업체뿐(2026-10-10)
            const shownRows = showDone ? groupRows : groupRows.filter((t) => !t.done_at);
            return (
              <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="break-words text-[13px] font-black text-slate-900">{batch.title} <span className="font-bold text-slate-400">· {batch.created_by} · {batch.created_at.slice(5, 16).replace("T", " ")}</span></div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <div className="h-1.5 w-32 overflow-hidden rounded-full bg-slate-200 sm:w-40">
                        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${batchTargets.length ? Math.round((sentCount / batchTargets.length) * 100) : 0}%` }} />
                      </div>
                      <span className="text-[11px] font-black tabular-nums text-emerald-600">{sentCount}/{batchTargets.length} 전송</span>
                      <span className="text-[11px] font-black tabular-nums text-indigo-600">· 완료 {doneCount}</span>
                    </div>
                    {(batch.log || []).length > 0 && (
                      <div className="mt-1 space-y-0.5 text-[10px] font-bold text-slate-500">
                        {(batch.log || []).slice(-3).reverse().map((entry, i) => (
                          <div key={`${entry.at}-${i}`}>{entry.mode === "auto" ? "⚡" : entry.mode === "sync" ? "⇄" : entry.mode === "remove" ? "－" : "＋"} {entry.at.slice(5, 16).replace("T", " ")} {entry.by} · {entry.mode === "remove" ? `삭제 ${(entry.removed || []).join(", ")}` : entry.mode === "auto" ? `자동 반영 — 신규 ${entry.added}곳 · 중복 ${entry.skipped.length}곳${entry.missing?.length ? ` · 목록에 없는 열린 곳 ${entry.missing.length}곳(${entry.missing.join(", ")})` : ""}` : `${entry.mode === "sync" ? "목록 맞춤 — " : ""}${entry.added}곳 추가`}{entry.kept !== undefined && entry.mode === "sync" ? ` · 유지 ${entry.kept}곳` : ""}{entry.dropped?.length ? ` · 빠져서 완료 ${entry.dropped.length}곳(${entry.dropped.join(", ")})` : ""}{entry.skipped.length && entry.mode !== "auto" ? ` · 중복 건너뜀 ${entry.skipped.length}곳(${entry.skipped.join(", ")})` : ""}</div>
                        ))}
                      </div>
                    )}
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
                    <div key={row.id} className={`relative min-w-0 overflow-hidden rounded-lg border px-3 py-2.5 transition ${row.done_at ? "border-indigo-300 bg-indigo-50/70" : row.sent_at ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200 bg-white hover:border-blue-300"}`}>
                      <button type="button" onClick={() => openSendRow(row)} className="block w-full text-left">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <span className="min-w-0 flex-1 basis-[60%] truncate text-[13px] font-black text-slate-900">{row.grade_group === "v_group" ? "💎" : "✉️"} {row.vendor}</span>
                          {row.list_kind === "CMS" && <span title="CMS 마감 — 관리부가 따로 올리는 목록. 맞추기는 CMS끼리만" className="shrink-0 rounded bg-cyan-100 px-1 py-0.5 text-[9px] font-black text-cyan-800">CMS{row.cms_day ? ` ${row.cms_day}일` : ""}</span>}
                          {ruleBadges(row)}
                          {addedTag(row) && <span title={`${row.added_at?.slice(0, 16).replace("T", " ")} ${row.added_by || ""} 추가`} className="shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-black text-amber-800">{addedTag(row)}</span>}
                          {row.done_at
                            ? <span className="shrink-0 rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-black text-white">✓✓ 완료</span>
                            : row.sent_at && <span className="shrink-0 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-black text-white">✓ 보냄</span>}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] font-bold text-slate-400">
                          {row.machines.length}대 · {row.phones.length ? row.phones.map(formatPhone).join(", ") : "번호 없음"}
                        </div>
                        {row.done_at
                          ? <div className="mt-0.5 truncate text-[10px] font-black text-indigo-700">완료 {row.done_by} · {row.done_at.slice(5, 16).replace("T", " ")}{row.sent_at ? ` · 보냄 ${row.sent_at.slice(5, 10)}` : ""}</div>
                          : row.sent_at
                          ? <div className="mt-0.5 truncate text-[10px] font-black text-emerald-700">{row.sent_by} · {row.sent_at.slice(5, 16).replace("T", " ")}{row.sent_phone ? ` · ${formatPhone(row.sent_phone)}` : ""}</div>
                          : row.vendor_names.length > 1 && <div className="mt-0.5 truncate text-[10px] font-bold text-blue-500">지점 {row.vendor_names.length}곳 통합</div>}
                      </button>
                      <span className="mt-1.5 flex justify-end gap-1">
                        {row.sent_at && (row.done_at
                          ? <button type="button" onClick={() => unmarkDone(row)} className="rounded border border-indigo-200 bg-white px-1.5 py-0.5 text-[9px] font-black text-indigo-600">완료 취소</button>
                          : <>
                            <button type="button" onClick={() => markDone(row)} title="마감(카운터 회신·처리)까지 끝났으면 완료" className="rounded bg-indigo-600 px-1.5 py-0.5 text-[9px] font-black text-white">완료</button>
                            <button type="button" onClick={() => unmarkSent(row)} className="rounded border border-emerald-200 bg-white px-1.5 py-0.5 text-[9px] font-black text-emerald-600">전송 취소</button>
                          </>)}
                        {/* 카운터 사진 한 장 → 마감방에 업체·기기·주소 글 + 사진 → 완료 */}
                        {!row.done_at && <button type="button" disabled={busy || photoBusyId === row.id} onClick={() => pickCounterPhoto(row)} title="고객이 보낸 카운터 사진을 고르면 마감방에 업체명·기종·시리얼·자산기번·주소와 함께 올리고 이 카드를 완료로 표시합니다" className="rounded bg-slate-900 px-1.5 py-0.5 text-[9px] font-black text-white hover:bg-slate-700 disabled:opacity-40">{photoBusyId === row.id ? "전송 중…" : "📷 카운터 전송"}</button>}
                        {/* 이 업체만 삭제 — 통째 삭제 말고 */}
                        <button type="button" disabled={busy} onClick={() => void removeTarget(row)} title="이 업체 카드만 목록에서 지웁니다 (나머지는 그대로)" className="rounded border border-rose-200 bg-white px-1.5 py-0.5 text-[9px] font-black text-rose-500 hover:bg-rose-50 disabled:opacity-40">삭제</button>
                      </span>
                    </div>
                  ))}
                  {!shownRows.length && <div className="col-span-full py-6 text-center text-xs font-bold text-slate-400">{doneRows.length ? "열린 업체가 없습니다 — 이 등급군은 모두 완료" : "이 등급군에 업체가 없습니다."}</div>}
                  {doneRows.length > 0 && (
                    <button type="button" onClick={() => setShowDone((v) => !v)} className="col-span-full rounded-lg border border-dashed border-indigo-200 bg-indigo-50/40 py-2 text-[11px] font-black text-indigo-600 transition hover:bg-indigo-50">
                      {showDone ? `✓✓ 완료 ${doneRows.length}곳 접기` : `✓✓ 완료 ${doneRows.length}곳 보기 (관리부 목록에서 빠진 업체는 자동 완료)`}
                    </button>
                  )}
                </div>
              </section>
            );
          })()}

        </>
      ) : (
        <>
          <section className={`rounded-xl border p-4 shadow-sm ${counterRooms.length ? "border-emerald-200 bg-emerald-50/50" : "border-amber-300 bg-amber-50"}`}>
            <div className="text-sm font-black text-slate-900">📷 마감 카톡방 <span className="text-[11px] font-bold text-slate-500">· 카드의 [카운터 전송]이 글+사진을 올리고, 봇이 관리부 목록을 읽어 오는 방</span></div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] font-bold text-slate-700">
              {counterRooms.length ? counterRooms.map((r) => (
                <span key={r.region} className="rounded-full border border-emerald-200 bg-white px-2.5 py-1"><span className="mr-1 text-[10px] font-black text-emerald-700">{r.region === "*" ? "공통" : `${r.region}팀`}</span>{r.room}</span>
              )) : <span className="text-amber-800">아직 등록된 방이 없어 카운터 전송이 막혀 있습니다.</span>}
            </div>
            <div className="mt-2 text-[11px] font-bold text-slate-500">방 이름은 다른 카톡방과 같이 <b className="text-slate-800">관리 탭 → 카톡방 매핑 → 업무 종류 "마감"</b>에서 바꿉니다(지역 * 공통이면 모든 팀, 팀을 고르면 그 팀만). 노트북 실행기가 켜져 있으면 카톡 PC가 사진을 직접 올리고, 아니면 봇이 글+링크로 올립니다.</div>
          </section>
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
                {([["single_greeting", "인사말 (단일 기기) — {업체명} 자리에 업체명이 들어갑니다"], ["single_closing", "마무리말 (단일)"], ["multi_greeting", "인사말 (여러 기기) — {total}·{업체명} 사용 가능"], ["multi_closing", "마무리말 (여러 기기)"]] as const).map(([suffix, title]) => {
                  const key = `${grp === "v_group" ? "v" : "s"}_${suffix}`;
                  return (
                    <label key={key} className="text-[11px] font-black text-slate-500">{title}
                      <textarea value={editing.templates[key] || ""} onChange={(e) => setDraftValue("templates", key, e.target.value)} rows={suffix.includes("greeting") ? 5 : 2}
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

      <input ref={photoInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0] || null; e.target.value = ""; void handleCounterPhoto(f); }} />
      {photoConfirm && (
        <div className="fixed inset-0 z-[230] flex items-end bg-black/50 sm:items-center sm:justify-center sm:p-4" onMouseDown={closePhotoConfirm}>
          <div className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-w-2xl sm:rounded-xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 bg-[#1E252F] px-5 py-4">
              <div className="min-w-0">
                <div className="text-[11px] font-black text-slate-400">마감 카운터 전송 확인 — 아직 보내지 않았습니다</div>
                <div className="truncate text-[15px] font-black text-white">{photoConfirm.row.vendor}</div>
              </div>
              <button type="button" onClick={closePhotoConfirm} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white"><X size={17} /></button>
            </div>
            <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-4 sm:grid-cols-[220px_minmax(0,1fr)]">
              <div>
                <img src={photoConfirm.preview} alt="카운터 사진" className="w-full rounded-lg border border-slate-200 object-contain" />
                <div className="mt-1 text-[10px] font-bold text-slate-400">{photoConfirm.file.name} · {(photoConfirm.file.size / 1024).toFixed(0)}KB</div>
              </div>
              <div className="min-w-0 space-y-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] font-bold text-slate-700">
                  보낼 방: <span className="font-black text-slate-900">{photoConfirm.plan.room}</span>
                  <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-black ${photoConfirm.plan.channel === "pc" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{photoConfirm.plan.channel === "pc" ? "카톡 PC가 글+사진 직접 전송" : "봇이 글+사진 링크 전송 (노트북 실행기 꺼짐)"}</span>
                </div>
                <label className="block text-[11px] font-black text-slate-500">함께 보낼 글 <span className="font-bold text-slate-400">· 고쳐도 됩니다</span>
                  <textarea value={photoConfirm.caption} onChange={(e) => setPhotoConfirm((cur) => (cur ? { ...cur, caption: e.target.value } : cur))} rows={8}
                    className="mt-1 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-[13px] font-semibold leading-6 text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                </label>
                <div className="text-[11px] font-bold text-slate-500">보내면 이 카드는 <b className="text-indigo-700">완료 · 카운터 사진</b>으로 표시됩니다. 잘못 보냈으면 카드의 [완료 취소]로 표시만 되돌릴 수 있고, 카톡방 글은 직접 지워야 합니다.</div>
              </div>
            </div>
            <div className="flex shrink-0 gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-3">
              <button type="button" onClick={closePhotoConfirm} disabled={!!photoBusyId} className="rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-600">취소</button>
              <button type="button" onClick={() => void confirmCounterPhoto()} disabled={!!photoBusyId} className="flex-1 rounded-full bg-emerald-600 py-2.5 text-sm font-black text-white transition hover:bg-emerald-700 disabled:opacity-50">{photoBusyId ? "보내는 중…" : `"${photoConfirm.plan.room}"에 보내기`}</button>
            </div>
          </div>
        </div>
      )}
      {rulesOpen && <ContactRulesBook rules={contactRules} onClose={() => setRulesOpen(false)} onRemove={removeRuleFromBook} busy={ruleBusy} />}
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
                  className="w-full min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold outline-none focus:border-blue-500 sm:w-auto sm:min-w-[160px]" />
              </div>
              {uploadInboxId && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-black text-emerald-800">📥 관리부가 마감방에 올린 글을 그대로 가져왔습니다 — 등록하면 도착함에서 처리됨으로 표시됩니다</div>}
              <textarea value={uploadRaw} onChange={(e) => setUploadRaw(e.target.value)} rows={8}
                placeholder="카톡 마감 목록을 그대로 붙여넣으세요"
                className="w-full resize-y rounded-lg border border-slate-300 p-3 font-mono text-[12px] leading-6 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
              {uploadBlocks && (
                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <div className="border-b border-slate-100 bg-slate-50/70 px-3 py-2 text-[11px] font-black text-slate-500">인식 결과 {uploadBlocks.length}건 — 틀린 곳만 고치고 등록하세요</div>
                  <div className="max-h-[36vh] divide-y divide-slate-100 overflow-y-auto">
                    {uploadBlocks.map((b) => (
                      <div key={b.index} className="grid gap-2 px-3 py-2.5 md:grid-cols-[1.4fr_1fr]">
                        <label className="text-[10px] font-black text-slate-400">업체명(등급){b.listKind === "CMS" && <span className="ml-1 rounded bg-cyan-100 px-1 py-0.5 text-[9px] font-black text-cyan-800">CMS{b.cmsDay ? ` ${b.cmsDay}일` : ""}</span>}
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
            {batch && batch.team === team && (
              <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 px-4 py-2 text-[11px] font-bold text-slate-500">
                <span>올리는 방식</span>
                <button type="button" onClick={() => setUploadMode("sync")} title="관리부는 끝난 업체를 빼고 다시 올립니다 — 이 목록에 없는 열린 업체는 자동 완료, 새 업체는 추가, 있는 업체는 전송·완료 표시 유지" className={`rounded-full px-3 py-1 text-[11px] font-black transition ${uploadMode === "sync" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>목록 맞추기 — 빠진 업체 자동 완료 (권장)</button>
                <button type="button" onClick={() => setUploadMode("merge")} title="관리부가 일부(한 구역·추가분)만 보낸 목록일 때" className={`rounded-full px-3 py-1 text-[11px] font-black transition ${uploadMode === "merge" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>추가만 (빠진 업체 그대로)</button>
                <button type="button" onClick={() => setUploadMode("replace")} title="달이 바뀐 목록 — 지금 목록은 기록으로 남고 새 목록이 올라갑니다" className={`rounded-full px-3 py-1 text-[11px] font-black transition ${uploadMode === "replace" ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>새 목록으로 교체</button>
              </div>
            )}
            <div className="flex shrink-0 gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-3">
              <button type="button" onClick={() => uploadConvert()} className="rounded-full border border-blue-300 bg-blue-50 px-4 py-2.5 text-sm font-black text-blue-700">🔍 변환 미리보기</button>
              <button type="button" disabled={busy || !uploadBlocks?.length} onClick={() => void publishBatch()}
                className="flex-1 rounded-full bg-blue-600 py-2.5 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-40">
                {busy ? "등록 중…" : uploadMode !== "replace" && batch && batch.team === team
                  ? (uploadMode === "sync" ? `${team}팀 목록 맞추기 (${uploadBlocks ? mergeTargets(uploadBlocks).length : 0}곳 기준)` : `${team}팀 목록에 추가 (${uploadBlocks ? mergeTargets(uploadBlocks).length : 0}곳 검사)`)
                  : `${team}팀에 등록 (${uploadBlocks ? mergeTargets(uploadBlocks).length : 0}곳)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {sendTarget && (() => {
        const { target, message } = sendTarget;
        const vendorRules = rulesForVendor(contactRules, target.vendor, sendTarget.row ? ruleCtx(sendTarget.row) : { phones: target.phones });
        const pickedChoice = contactChoices(target.phones, target.labels, vendorRules).find((c) => c.phone === pickedPhone);
        const label = pickedChoice?.label || target.labels[pickedPhone] || "";
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
                <ContactRulesPanel vendor={target.vendor} phones={target.phones} labels={target.labels} rules={vendorRules}
                  picked={pickedPhone} onPick={setPickedPhone} author={author} onRulesChanged={reloadRules} onNotice={setNotice}
                  leaseCode={sendTarget.row?.lease_code || ""} serial={(sendTarget.row?.serials || [])[0] || ""} identCols={!!identCols} />
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
                {pickedPhone && !pickedChoice?.blocked && (
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

/**
 * 전송 모달의 수신 연락처 — 파싱된 번호 + 업체 연락처 규칙(🚫 보내지 말 것 / ⭐ 새 담당)을 한 목록으로.
 * 여기서 한 번 표시해 두면 팀 전체가 다음 마감에 그 업체가 다시 올라와도 바로 본다(2026-09-16 요청).
 * 사유·기록자·날짜가 함께 남아 나중에 헷갈리지 않는다.
 */
function ContactRulesPanel({ vendor, phones, labels, rules, picked, onPick, author, onRulesChanged, onNotice, leaseCode = "", serial = "", identCols = false }: {
  vendor: string; phones: string[]; labels: Record<string, string>; rules: ContactRule[];
  picked: string; onPick: (phone: string) => void; author: string; onRulesChanged: () => Promise<void> | void; onNotice: (message: string) => void;
  leaseCode?: string; serial?: string; identCols?: boolean; // 규칙에 임대 코드·기번을 같이 저장 — 다음 마감에 이름이 달라져도 잡힌다
}) {
  const choices = contactChoices(phones, labels, rules);
  const sendable = choices.filter((c) => !c.blocked);
  const [blockDraft, setBlockDraft] = useState<{ phone: string; memo: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [add, setAdd] = useState({ name: "", phone: "", memo: "" });
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<void>, done: string) => {
    setBusy(true);
    try { await work(); await onRulesChanged(); onNotice(done); }
    catch (e) { onNotice(`연락처 규칙 저장 실패: ${(e as Error).message} — DB에 counter_sms_contact_rules 표가 있는지 확인 (supabase/counter-sms-contact-rules.sql)`); }
    finally { setBusy(false); }
  };
  const block = (phone: string, memo: string) => run(async () => {
    await saveContactRule({ vendor, phone, kind: "block", memo, author, leaseCode, serial, identCols });
    if (picked === phone) onPick(sendable.find((c) => c.phone !== phone)?.phone || ""); // 차단한 번호가 선택돼 있었으면 다음 번호로
  }, `🚫 ${formatPhone(phone)} — 이 업체엔 보내지 않기로 기록했습니다 (다음 마감에도 표시됩니다)`);
  const unset = (rule: ContactRule) => run(() => removeContactRule(rule.id), "규칙을 해제했습니다");
  const addPrefer = () => run(async () => {
    const saved = await saveContactRule({ vendor, phone: add.phone, kind: "prefer", name: add.name, memo: add.memo, author, leaseCode, serial, identCols });
    onPick(saved.phone);
    setAdd({ name: "", phone: "", memo: "" });
    setAddOpen(false);
  }, "⭐ 새 담당자 연락처를 기록했습니다 — 다음 마감부터 이 업체는 이 번호가 먼저 나옵니다");
  const smallBtn = "rounded border px-2 py-1 text-[10px] font-black transition";
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black text-slate-400">수신 연락처</span>
        {rules.length > 0 && <span className="text-[10px] font-bold text-slate-400">연락처 기록 {rules.length}건 · 최근 {ruleStamp(rules[0])}</span>}
      </div>
      {!choices.length && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-600">번호가 없습니다 — 인식 결과에서 연락처를 입력하거나 아래에서 새 담당자를 기록해 주세요.</div>}
      {choices.length > 0 && !sendable.length && <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700">🚫 이 업체 번호는 전부 "보내지 말 것"으로 기록돼 있습니다 — 새 담당자 연락처를 확인해 아래에 기록해 주세요.</div>}
      {choices.map((c) => {
        const isPicked = picked === c.phone;
        const rule = c.blocked || c.preferred;
        return (
          <div key={c.phone} className={`rounded-lg border px-3 py-2 transition ${c.blocked ? "border-rose-200 bg-rose-50/60" : isPicked ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50"}`}>
            <label className={`flex flex-wrap items-center gap-2 text-sm font-bold ${c.blocked ? "cursor-not-allowed text-slate-400" : "cursor-pointer text-slate-700"}`}>
              <input type="radio" disabled={!!c.blocked} checked={isPicked} onChange={() => onPick(c.phone)} className="h-4 w-4 accent-blue-600" />
              {c.preferred && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-black text-amber-800">⭐ 새 담당</span>}
              {c.label && <span className={`rounded px-1.5 py-0.5 text-[11px] font-black ${c.blocked ? "bg-slate-100 text-slate-400 line-through" : "bg-emerald-50 text-emerald-700"}`}>👤 {c.label}</span>}
              <span className={`font-mono tabular-nums ${c.blocked ? "line-through" : ""}`}>{formatPhone(c.phone)}</span>
              {c.blocked && <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-black text-white">🚫 보내지 말 것</span>}
              <span className="ml-auto flex shrink-0 gap-1">
                {c.blocked
                  ? <button type="button" disabled={busy} onClick={() => { if (c.blocked) void unset(c.blocked); }} className={`${smallBtn} border-slate-300 bg-white text-slate-600 hover:bg-slate-50`}>해제</button>
                  : <>
                    {c.preferred && <button type="button" disabled={busy} onClick={() => { if (c.preferred) void unset(c.preferred); }} className={`${smallBtn} border-amber-300 bg-white text-amber-700 hover:bg-amber-50`}>담당 해제</button>}
                    <button type="button" disabled={busy} onClick={() => setBlockDraft({ phone: c.phone, memo: "" })} className={`${smallBtn} border-rose-200 bg-white text-rose-600 hover:bg-rose-50`}>🚫 보내지 말 것</button>
                  </>}
              </span>
            </label>
            {rule && <div className="mt-1 pl-6 text-[11px] font-bold text-slate-500">{rule.memo ? `${rule.kind === "block" ? "사유" : "메모"}: ${rule.memo} ` : ""}<span className="text-slate-400">· {ruleStamp(rule)} 기록</span></div>}
            {blockDraft?.phone === c.phone && (
              <div className="mt-2 flex gap-1.5 pl-6">
                <input autoFocus value={blockDraft.memo} onChange={(e) => setBlockDraft({ phone: c.phone, memo: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") { void block(c.phone, blockDraft.memo); setBlockDraft(null); } }}
                  placeholder="사유 (예: 퇴사 · 담당 아님 · 문자 거부)" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold outline-none focus:border-rose-500" />
                <button type="button" disabled={busy} onClick={() => { void block(c.phone, blockDraft.memo); setBlockDraft(null); }} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-black text-white">기록</button>
                <button type="button" onClick={() => setBlockDraft(null)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-black text-slate-500">취소</button>
              </div>
            )}
          </div>
        );
      })}
      {addOpen ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
          <div className="text-[10px] font-black text-amber-700">⭐ 새 마감 담당자 — 다음 마감부터 이 업체는 이 번호가 먼저 나옵니다</div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <input value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} placeholder="이름·직함 (예: 김철수 과장)" className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold outline-none focus:border-amber-500" />
            <input value={add.phone} onChange={(e) => setAdd({ ...add, phone: e.target.value })} placeholder="010-0000-0000" inputMode="tel" className="rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs font-semibold outline-none focus:border-amber-500" />
          </div>
          <input value={add.memo} onChange={(e) => setAdd({ ...add, memo: e.target.value })} placeholder="메모 (예: 전 담당 퇴사 — 9/16 통화로 안내받음)" className="mt-1.5 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold outline-none focus:border-amber-500" />
          <div className="mt-2 flex gap-1.5">
            <button type="button" disabled={busy || normalizePhone(add.phone).length < 10} onClick={() => void addPrefer()} className="flex-1 rounded-lg bg-amber-600 py-1.5 text-xs font-black text-white disabled:opacity-40">기록하고 이 번호로 보내기</button>
            <button type="button" onClick={() => setAddOpen(false)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-black text-slate-500">취소</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAddOpen(true)} className="w-full rounded-lg border border-dashed border-amber-300 bg-white py-2 text-[11px] font-black text-amber-700 transition hover:bg-amber-50">＋ 새 마감 담당자 연락처 기록 (다른 사람에게 보내라고 했을 때)</button>
      )}
    </div>
  );
}

/**
 * 연락처 기록 목록 — 🚫 보내지 말 것 / ⭐ 새 담당 전체를 업체별로 훑어본다.
 * 전송 모달은 지금 올라온 업체만 보여 주니, 다음 마감에 안 올라온 업체도 "그 사람 번호 어떻게 됐지"가 떠오르면
 * 여기서 찾는다(2026-09-17 요청). 검색은 업체·이름·번호·메모·기록자 전부.
 */
function ContactRulesBook({ rules, onClose, onRemove, busy }: {
  rules: ContactRule[]; onClose: () => void; onRemove: (rule: ContactRule) => Promise<void>; busy: boolean;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "block" | "prefer">("all");
  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  const filtered = rules.filter((r) => (kind === "all" || r.kind === kind) && (!q
    || [r.vendor, r.name, r.memo, r.updated_by].some((v) => String(v || "").toLowerCase().includes(q))
    || (digits.length >= 3 && normalizePhone(r.phone).includes(digits))));
  // 업체별 묶음 — 최근 기록이 위
  const groups = new Map<string, ContactRule[]>();
  for (const r of filtered) { const list = groups.get(r.vendor_key) || []; list.push(r); groups.set(r.vendor_key, list); }
  const blockCount = rules.filter((r) => r.kind === "block").length;
  const preferCount = rules.length - blockCount;
  const chip = (active: boolean, tone: string) => `rounded-full px-3 py-1.5 text-[12px] font-black transition ${active ? tone : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`;
  return (
    <div className="fixed inset-0 z-[210] flex items-end bg-black/45 sm:items-center sm:justify-center sm:p-4" onMouseDown={onClose}>
      <div className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-w-3xl sm:rounded-xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 bg-[#1E252F] px-5 py-4">
          <div className="min-w-0">
            <div className="text-[11px] font-black text-slate-400">마감 문자 연락처 기록 — 팀 전체 공유 · 다음 마감에 그 업체가 올라오면 자동으로 표시됩니다</div>
            <div className="text-[15px] font-black text-white">🚫 보내지 말 것 {blockCount}건 · ⭐ 새 담당 {preferCount}건</div>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white"><X size={17} /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3">
          <button type="button" onClick={() => setKind("all")} className={chip(kind === "all", "bg-slate-900 text-white")}>전체 {rules.length}</button>
          <button type="button" onClick={() => setKind("block")} className={chip(kind === "block", "bg-rose-600 text-white")}>🚫 보내지 말 것 {blockCount}</button>
          <button type="button" onClick={() => setKind("prefer")} className={chip(kind === "prefer", "bg-amber-500 text-white")}>⭐ 새 담당 {preferCount}</button>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="업체 · 이름 · 번호 · 사유 · 기록자 검색"
            className="w-full min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold outline-none focus:border-blue-500 sm:w-auto sm:min-w-[180px]" />
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {!rules.length && <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-xs font-bold text-slate-400">아직 기록이 없습니다 — 전송 모달의 수신 연락처에서 🚫 / ⭐ 를 누르면 여기에 쌓입니다.</div>}
          {rules.length > 0 && !groups.size && <div className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-xs font-bold text-slate-400">검색 결과가 없습니다.</div>}
          {[...groups.entries()].map(([key, list]) => (
            <div key={key} className="rounded-xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
                <span className="truncate text-sm font-black text-slate-900">{list[0].vendor || "업체명 없음"}</span>
                <span className="text-[10px] font-bold text-slate-400">기록 {list.length}건 · 최근 {ruleStamp(list[0])}</span>
              </div>
              <div className="divide-y divide-slate-100">
                {list.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                    {r.kind === "block"
                      ? <span className="shrink-0 rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-black text-white">🚫 보내지 말 것</span>
                      : <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-800">⭐ 새 담당</span>}
                    {r.name && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-black text-emerald-700">👤 {r.name}</span>}
                    <span className={`font-mono font-bold tabular-nums ${r.kind === "block" ? "text-slate-400 line-through" : "text-slate-800"}`}>{formatPhone(r.phone)}</span>
                    {r.memo && <span className="min-w-0 flex-1 truncate font-semibold text-slate-600" title={r.memo}>{r.kind === "block" ? "사유" : "메모"}: {r.memo}</span>}
                    <span className="ml-auto shrink-0 text-[10px] font-bold text-slate-400">{ruleStamp(r)} 기록</span>
                    <button type="button" disabled={busy} onClick={() => void onRemove(r)}
                      className="shrink-0 rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">해제</button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
