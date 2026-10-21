/**
 * 필드 › 미수 = CS 방문이력 작성기 컨테이너(상태·초안 보관·사진 올리기·저장). 표시는 MisuVisitForm.view.tsx.
 * 설계: docs/tasks/misu-redesign.md §4-A · 저장 API: misuVisitApi.ts · 판정·문장: misuVisit.ts
 *
 * - 초안 id 는 폼 열 때 한 번 만들고 저장 성공 전까지 그대로(같은 id 재전송 = 1건).
 * - 쓰던 내용은 localStorage(field_misu_visit_draft_v1), 사진 파일은 photoStore("misu-visit") — 끊겨도 이어 쓰기.
 * - 사진은 고르는 즉시 올린다. 보낼 때 덜 올라간 칸만 다시 올리고, 하나라도 실패하면 저장·카톡 둘 다 안 한다.
 * - 보내기 성공 뒤 방문집계(visit_logs)·운영현황(activity_events)을 여기서 직접 남긴다 — App 의 recordVisit 은
 *   본문 '업체명:' 줄에서 업체를 읽는데 이 양식은 '업체:' 줄이라 엉뚱한 업체로 남을 수 있어서다. 테스트 모드면 건너뜀.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MisuVisitFormView, { type MisuPhotoSlotKey, type MisuPhotoSlotState, type MisuVendorOption } from "./MisuVisitForm.view";
import {
  buildMisuKakaoText, emptyMisuVisitDraft, kstParts, misuVisitLines, PHOTO_SLOT_LABEL, PHOTO_SLOTS, suggestNextRound, validateMisuVisit,
  type MisuPhoto, type MisuVisit, type MisuVisitDraft,
} from "./misuVisit";
import {
  isMisuTableMissing, loadMisuSheetVendors, loadMisuVisitById, loadMisuVisitIndex, resolveMisuRoom, saveMisuVisit, searchMisuOtherVendors,
  uploadMisuSlotPhoto, type MisuRoomInfo, type MisuSheetVendor,
} from "./misuVisitApi";
import {
  clearMisuDraft, filterMisuVendors, isMisuDraftTouched, masterVendorToOption, MISU_PHOTO_MODE, misuRoundHint, readMisuDraft,
  sheetVendorToOption, slotsToPhotos, visitsForVendor, writeMisuDraft, type MisuSlotRuntime,
} from "./misuVisitDraft";
import { photoStoreClearMode, photoStoreDelete, photoStoreLoadAll, photoStorePut } from "./photoStore";
import { authorLocked, getSsoSession } from "./sso";
import { useAuthorBook } from "./authors";
import { teamForAuthor, saveActivityEvent } from "./operations";
import { kstDate, saveVisit } from "./visits";
import { askConfirm } from "./confirmModal";
import {
  buildSupplementDraft, clearSupplementRequest, MISU_SUPPLEMENT_EVENT, parseSupplementPayload, readSupplementRequest,
  supplementSlotMeta, supplementVendorOption, type MisuSupplementPayload,
} from "./misuSupplement";

type ToastFn = (message: string, kind?: "success" | "warning" | "error") => void;
type Props = { author: string; setAuthor: (v: string) => void; onToast: ToastFn };
type SlotMap = Record<MisuPhotoSlotKey, MisuPhotoSlotState | null>;
type SlotMeta = Partial<Record<MisuPhotoSlotKey, { url?: string; w?: number; h?: number; lowRes?: boolean }>>;

const EMPTY_SLOTS: SlotMap = { outside: null, door: null, device: null, notice: null };
const storage = () => (typeof window !== "undefined" ? window.localStorage : null);
const teamLetter = (t: string) => (/^[A-E]$/.test(t) ? t : "");
function savedSlots(meta: SlotMeta): Partial<Record<MisuPhotoSlotKey, { url: string; w?: number; h?: number; lowRes?: boolean }>> {
  const out: Partial<Record<MisuPhotoSlotKey, { url: string; w?: number; h?: number; lowRes?: boolean }>> = {};
  for (const slot of PHOTO_SLOTS) { const m = meta[slot]; if (m?.url) out[slot] = { ...m, url: m.url }; }
  return out;
}
const fmtTime = (ms: number) => { const p = kstParts(new Date(ms)); return p ? `${p.date.slice(5)} ${p.hm}` : ""; };

export default function MisuVisitForm({ author, setAuthor, onToast }: Props) {
  const { authors } = useAuthorBook();
  const locked = authorLocked();
  const ssoSub = getSsoSession()?.user?.sub || "";
  const myTeam = teamLetter(teamForAuthor(author));

  // ── 초안(첫 렌더에 한 번 복원) ──
  const [restored] = useState(() => readMisuDraft(storage()));
  const [draft, setDraft] = useState<MisuVisitDraft>(() => restored?.draft || emptyMisuVisitDraft());
  const [vendor, setVendor] = useState<MisuVendorOption | null>(() => restored?.vendor || null);
  const [draftNotice, setDraftNotice] = useState(() => (restored ? `${fmtTime(restored.savedAt)}에 쓰던 내용을 이어 씁니다` : ""));
  const flagsRef = useRef({ kakaoSent: !!restored?.kakaoSent, recorded: !!restored?.recorded });

  // ── 사진 칸: 화면 상태 + 파일(재시도용) + 올라간 주소·크기 ──
  const [slots, setSlots] = useState<SlotMap>(() => {
    const out: SlotMap = { ...EMPTY_SLOTS };
    for (const [k, v] of Object.entries(restored?.slots || {})) if (v?.url) out[k as MisuPhotoSlotKey] = { url: v.url, status: "done", lowRes: v.lowRes };
    return out;
  });
  const [slotMeta, setSlotMeta] = useState<SlotMeta>(() => ({ ...(restored?.slots || {}) }));
  const filesRef = useRef<Partial<Record<MisuPhotoSlotKey, File>>>({});
  const tokenRef = useRef<Partial<Record<MisuPhotoSlotKey, number>>>({});

  // ── 목록·기록·방 ──
  const [sheet, setSheet] = useState<MisuSheetVendor[]>([]);
  const [sheetState, setSheetState] = useState<"loading" | "error" | "ready">("loading");
  const [sheetError, setSheetError] = useState("");
  const [visits, setVisits] = useState<MisuVisit[]>([]);
  const [indexState, setIndexState] = useState<"loading" | "error" | "ready" | "missing">("loading");
  const [tableNotReady, setTableNotReady] = useState(false);
  const [vendorQuery, setVendorQuery] = useState("");
  const [otherQuery, setOtherQuery] = useState("");
  const [otherResults, setOtherResults] = useState<MisuVendorOption[] | null>(null);
  const [otherSearching, setOtherSearching] = useState(false);
  const [otherError, setOtherError] = useState("");
  const [roomInfo, setRoomInfo] = useState<MisuRoomInfo | null>(null);
  const [roomError, setRoomError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [result, setResult] = useState<{ tone?: "ok" | "warn" | "error"; text: string } | null>(null);

  const loadIndex = useCallback(() => {
    setIndexState("loading");
    loadMisuVisitIndex()
      .then((rows) => { setVisits(rows); setIndexState("ready"); setTableNotReady(false); })
      .catch((e) => {
        if (isMisuTableMissing(e)) { setTableNotReady(true); setIndexState("missing"); }
        else { console.warn("misu_visits 조회 실패", e); setIndexState("error"); }
      });
  }, []);

  useEffect(() => {
    let alive = true;
    loadMisuSheetVendors()
      .then((list) => { if (alive) { setSheet(list); setSheetState("ready"); } })
      .catch((e) => { if (alive) { setSheetError((e as Error).message); setSheetState("error"); } });
    loadIndex();
    return () => { alive = false; };
  }, [loadIndex]);

  // 지역 = 업체 팀(미수 목록) → 없으면 작성자 팀. 방은 지역이 바뀔 때마다 다시 정한다.
  const region = teamLetter(vendor?.team || "") || myTeam;
  useEffect(() => {
    let alive = true;
    setRoomError("");
    resolveMisuRoom(region)
      .then((r) => { if (alive) setRoomInfo(r); })
      .catch((e) => { if (alive) { setRoomInfo(null); setRoomError((e as Error).message); } });
    return () => { alive = false; };
  }, [region]);

  // ── 사진 올리기 ──
  const startUpload = useCallback(async (slot: MisuPhotoSlotKey, file: File): Promise<boolean> => {
    const token = (tokenRef.current[slot] || 0) + 1;
    tokenRef.current[slot] = token;
    setSlots((prev) => ({ ...prev, [slot]: { ...(prev[slot] || {}), status: "uploading", error: undefined } }));
    try {
      const up = await uploadMisuSlotPhoto(file);
      if (tokenRef.current[slot] !== token) return false; // 그 사이 빼거나 바꿨다
      setSlotMeta((prev) => ({ ...prev, [slot]: { url: up.url, w: up.w, h: up.h, lowRes: up.lowRes } }));
      setSlots((prev) => ({ ...prev, [slot]: { ...(prev[slot] || {}), url: up.url, status: "done", lowRes: up.lowRes, error: undefined } }));
      return true;
    } catch (e) {
      if (tokenRef.current[slot] !== token) return false;
      setSlots((prev) => ({ ...prev, [slot]: { ...(prev[slot] || {}), status: "error", error: (e as Error).message || "올리지 못했습니다" } }));
      return false;
    }
  }, []);

  // 기기에 보관해 둔 사진 파일 복원(이어 쓰기) — 아직 안 올라간 칸은 다시 올린다
  useEffect(() => {
    const id = draft.id;
    let alive = true;
    void photoStoreLoadAll().then((byMode) => {
      if (!alive || supplementAppliedRef.current) return; // 보완 기록으로 시작했으면 옛 초안 사진은 되살리지 않는다
      for (const item of byMode[MISU_PHOTO_MODE] || []) {
        const [draftId, slot] = item.id.split(":") as [string, MisuPhotoSlotKey];
        if (draftId !== id || !PHOTO_SLOTS.includes(slot)) { void photoStoreDelete(item.id); continue; } // 다른(끝난) 초안의 찌꺼기
        filesRef.current[slot] = item.file;
        const previewUrl = URL.createObjectURL(item.file);
        const uploaded = !!restored?.slots?.[slot]?.url;
        setSlots((prev) => ({ ...prev, [slot]: { ...(prev[slot] || {}), previewUrl, status: uploaded ? "done" : "ready" } }));
        if (!uploaded) void startUpload(slot, item.file);
      }
    });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 처음 한 번만(복원)
  }, []);

  // 미리보기 blob 주소 정리
  const slotsRef = useRef(slots);
  useEffect(() => { slotsRef.current = slots; }, [slots]);
  useEffect(() => () => { for (const st of Object.values(slotsRef.current)) if (st?.previewUrl) URL.revokeObjectURL(st.previewUrl); }, []);

  // ── 작성자·전체 초안 ──
  const fullDraft = useCallback((pendingOk: boolean): MisuVisitDraft => {
    const runtime: Partial<Record<MisuPhotoSlotKey, MisuSlotRuntime>> = {};
    for (const slot of PHOTO_SLOTS) {
      const st = slots[slot];
      if (!st) continue;
      runtime[slot] = { url: slotMeta[slot]?.url || st.url, w: slotMeta[slot]?.w, h: slotMeta[slot]?.h, hasFile: true }; // 칸이 차 있으면 파일을 고른 것
    }
    return {
      ...draft,
      author: author.trim(),
      author_sub: ssoSub,
      author_team: myTeam,
      region,
      photos: slotsToPhotos(runtime, pendingOk),
    };
  }, [draft, slots, slotMeta, author, ssoSub, myTeam, region]);

  const viewDraft = useMemo(() => fullDraft(true), [fullDraft]);
  const validation = useMemo(() => validateMisuVisit(viewDraft), [viewDraft]);
  const previewLines = useMemo(() => misuVisitLines(viewDraft), [viewDraft]);
  const kakaoText = useMemo(() => buildMisuKakaoText({ ...viewDraft, missing: validation.missing }), [viewDraft, validation.missing]);

  // ── 초안 자동 보관 ──
  useEffect(() => {
    const photoCount = Object.values(slots).filter(Boolean).length;
    if (!isMisuDraftTouched(draft, vendor, photoCount)) return;
    const saved = savedSlots(slotMeta);
    writeMisuDraft(storage(), { v: 1, savedAt: Date.now(), draft, vendor, slots: saved, ...flagsRef.current });
  }, [draft, vendor, slots, slotMeta]);

  // ── 보완 기록(조회 › 미수 [방문 이력]에서 넘어옴) — 원 기록 전체를 복사한 새 초안으로 시작 ──
  const supplementBusyRef = useRef(false);
  const supplementAppliedRef = useRef(false);
  const latestRef = useRef({ draft, vendor, slots });
  const applySupplementRef = useRef<(p: MisuSupplementPayload) => Promise<void>>(async () => undefined);
  useEffect(() => {
    latestRef.current = { draft, vendor, slots };
    applySupplementRef.current = async (payload) => {
      if (supplementBusyRef.current) return;
      supplementBusyRef.current = true;
      try {
        let original: MisuVisit | null = null;
        try { original = await loadMisuVisitById(payload.visitId); }
        catch (e) { onToast(`원 기록을 불러오지 못해 보완 기록을 시작하지 못했습니다 — ${(e as Error).message || e}`, "error"); return; }
        if (!original) { onToast("원 기록을 찾지 못했습니다. 조회 화면을 새로고침한 뒤 다시 눌러 주세요.", "error"); return; }
        const cur = latestRef.current;
        if (isMisuDraftTouched(cur.draft, cur.vendor, Object.values(cur.slots).filter(Boolean).length)) {
          if (!(await askConfirm("보완 기록으로 새로 쓸까요? (쓰던 내용은 지워집니다)", { danger: true, okLabel: "보완 기록으로 새로 쓰기" }))) return;
        }
        resetAll();
        supplementAppliedRef.current = true;
        const meta = supplementSlotMeta(original.photos);
        const nextSlots: SlotMap = { ...EMPTY_SLOTS };
        for (const [k, m] of Object.entries(meta)) nextSlots[k as MisuPhotoSlotKey] = { url: m.url, status: "done" };
        setDraft(buildSupplementDraft(original));
        setVendor(supplementVendorOption(original));
        setSlotMeta(meta);
        setSlots(nextSlots);
        const when = original.visited_at ? kstParts(original.visited_at) : null;
        setDraftNotice(`${original.visit_round}${when ? ` (${when.date.slice(5)} ${when.hm})` : ""} 기록을 고쳐 쓰는 보완 기록입니다 — 원 기록 내용을 채워 두었습니다`);
        setResult(null);
      } finally {
        supplementBusyRef.current = false;
      }
    };
  });
  useEffect(() => {
    const take = (p: MisuSupplementPayload) => { clearSupplementRequest(storage()); void applySupplementRef.current(p); };
    const pending = readSupplementRequest(storage());
    if (pending) take(pending); else clearSupplementRequest(storage()); // 10분 지난 값은 지운다
    const onEvent = (e: Event) => { const p = parseSupplementPayload((e as CustomEvent).detail); if (p) take(p); };
    window.addEventListener(MISU_SUPPLEMENT_EVENT, onEvent);
    return () => window.removeEventListener(MISU_SUPPLEMENT_EVENT, onEvent);
  }, []);

  // ── 업체 ──
  const myVisits = useMemo(() => (vendor ? visitsForVendor(visits, { company_code: vendor.companyCode, lease_seq: vendor.leaseSeq, vendor: vendor.name }) : []), [vendor, visits]);
  const suggestion = useMemo(() => (vendor && indexState === "ready" ? suggestNextRound(myVisits) : null), [vendor, indexState, myVisits]);
  const vendorList = useMemo(() => filterMisuVendors(sheet, vendorQuery, myTeam).slice(0, 80).map((v) => sheetVendorToOption(v, visits)), [sheet, vendorQuery, myTeam, visits]);
  const sheetByKey = useMemo(() => new Map(sheet.map((v) => [v.key, v])), [sheet]);

  const pickVendor = (opt: MisuVendorOption) => {
    const row = sheetByKey.get(opt.key);
    const mine = visitsForVendor(visits, { company_code: opt.companyCode, lease_seq: opt.leaseSeq, vendor: opt.name });
    const round = indexState === "ready" ? suggestNextRound(mine).round : draft.visit_round;
    setVendor(opt);
    setDraft((d) => ({
      ...d,
      vendor: opt.name, company_code: opt.companyCode || "", lease_seq: opt.leaseSeq || "", site_code: "",
      misu_months: row?.months || "", misu_balance: row?.balance || "", visit_round: round,
    }));
  };
  const clearVendor = () => {
    setVendor(null);
    setDraft((d) => ({ ...d, vendor: "", company_code: "", lease_seq: "", site_code: "", misu_months: "", misu_balance: "" }));
  };
  const searchOther = async () => {
    const q = otherQuery.trim();
    if (q.length < 2) { setOtherError("두 글자 이상 적어 주세요"); return; }
    setOtherSearching(true);
    setOtherError("");
    try {
      const hits = await searchMisuOtherVendors(q);
      setOtherResults(hits.map((h) => masterVendorToOption(h, visits)));
    } catch (e) {
      setOtherError((e as Error).message || "검색 실패");
      setOtherResults(null);
    } finally {
      setOtherSearching(false);
    }
  };

  // ── 사진 칸 ──
  const onPhotoFile = (slot: MisuPhotoSlotKey, file: File) => {
    const prev = slots[slot];
    if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
    filesRef.current[slot] = file;
    setSlotMeta((m) => ({ ...m, [slot]: undefined }));
    setSlots((p) => ({ ...p, [slot]: { previewUrl: URL.createObjectURL(file), status: "ready" } }));
    setDraft((d) => ({ ...d, photo_skips: { ...d.photo_skips, [slot]: "" } })); // 사진을 넣으면 촬영 불가 사유는 지운다
    void photoStorePut(MISU_PHOTO_MODE, `${draft.id}:${slot}`, file);
    void startUpload(slot, file);
  };
  const onPhotoRemove = (slot: MisuPhotoSlotKey) => {
    const prev = slots[slot];
    if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
    tokenRef.current[slot] = (tokenRef.current[slot] || 0) + 1; // 올리는 중이던 결과는 버린다
    delete filesRef.current[slot];
    setSlotMeta((m) => ({ ...m, [slot]: undefined }));
    setSlots((p) => ({ ...p, [slot]: null }));
    void photoStoreDelete(`${draft.id}:${slot}`);
  };
  const onPhotoRetry = (slot: MisuPhotoSlotKey) => {
    const f = filesRef.current[slot];
    if (f) void startUpload(slot, f);
    else onToast("사진 파일이 기기에 남아 있지 않습니다 — 다시 찍거나 골라 주세요", "error");
  };

  // ── 새로 쓰기 ──
  const resetAll = () => {
    for (const st of Object.values(slots)) if (st?.previewUrl) URL.revokeObjectURL(st.previewUrl);
    for (const slot of PHOTO_SLOTS) tokenRef.current[slot] = (tokenRef.current[slot] || 0) + 1;
    filesRef.current = {};
    flagsRef.current = { kakaoSent: false, recorded: false };
    clearMisuDraft(storage());
    void photoStoreClearMode(MISU_PHOTO_MODE);
    setSlots({ ...EMPTY_SLOTS });
    setSlotMeta({});
    setVendor(null);
    setDraft(emptyMisuVisitDraft());
    setDraftNotice("");
  };
  const discardDraft = async () => {
    if (!(await askConfirm("쓰던 내용을 지우고 새로 쓸까요? (아직 보내지 않은 기록입니다)", { danger: true, okLabel: "새로 쓰기" }))) return;
    resetAll();
    setResult(null);
  };

  // ── 보내기 ──
  const submit = async () => {
    if (submittingRef.current) return;
    if (tableNotReady) { onToast("방문이력 표가 아직 준비 중입니다 — 저장·전송되지 않습니다", "error"); return; }
    const check = validateMisuVisit(fullDraft(true));
    if (!check.ok) { onToast(check.blocks[0]?.message || "필수 항목을 채워 주세요", "error"); return; }
    submittingRef.current = true;
    setSubmitting(true);
    setResult(null);
    try {
      // 1) 덜 올라간 사진 칸 올리기 — 하나라도 실패하면 저장·카톡 둘 다 멈춤
      const failed: string[] = [];
      const meta: SlotMeta = { ...slotMeta };
      for (const slot of PHOTO_SLOTS) {
        const st = slots[slot];
        if (!st || meta[slot]?.url || st.url) continue;
        const f = filesRef.current[slot];
        if (!f) { failed.push(PHOTO_SLOT_LABEL[slot]); continue; }
        try {
          const up = await uploadMisuSlotPhoto(f);
          meta[slot] = { url: up.url, w: up.w, h: up.h };
          setSlotMeta((m) => ({ ...m, [slot]: { url: up.url, w: up.w, h: up.h, lowRes: up.lowRes } }));
          setSlots((p) => ({ ...p, [slot]: { ...(p[slot] || {}), url: up.url, status: "done", lowRes: up.lowRes, error: undefined } }));
        } catch (e) {
          failed.push(PHOTO_SLOT_LABEL[slot]);
          setSlots((p) => ({ ...p, [slot]: { ...(p[slot] || {}), status: "error", error: (e as Error).message || "올리지 못했습니다" } }));
        }
      }
      if (failed.length) {
        const text = `사진 ${failed.join(" · ")} 칸이 올라가지 않아 저장·카톡을 하지 않았습니다. 칸의 [다시]를 누르거나 다시 보내 주세요.`;
        setResult({ tone: "error", text });
        onToast(text, "error");
        return;
      }
      const base = fullDraft(false);
      const photos: MisuPhoto[] = [];
      for (const slot of PHOTO_SLOTS) {
        const m = meta[slot];
        if (slots[slot] && m?.url) photos.push({ slot, url: m.url, ...(m.w ? { w: m.w } : {}), ...(m.h ? { h: m.h } : {}) });
      }
      const toSave: MisuVisitDraft = { ...base, photos };

      // 2) 저장 → 카톡
      const res = await saveMisuVisit(toSave, { kakaoAlreadySent: flagsRef.current.kakaoSent });
      if (res.albumId && res.albumId !== draft.album_id) setDraft((d) => ({ ...d, album_id: res.albumId }));
      if (!res.saved) {
        if (res.tableNotReady) setTableNotReady(true);
        const text = `${res.message}${res.error && !res.tableNotReady ? ` (${res.error})` : ""}`;
        setResult({ tone: "error", text });
        onToast(text, "error");
        return;
      }
      if (res.kakao === "queued" || res.kakao === "pending") flagsRef.current.kakaoSent = true;

      // 3) 방문집계·운영현황(테스트 모드 제외) — 실패는 알리되 저장은 성공
      const notes: string[] = [];
      if (!res.testMode && !flagsRef.current.recorded) {
        const visitedDate = kstParts(toSave.visited_at);
        try {
          await saveVisit({
            visited: true, vendor: toSave.vendor, author: toSave.author, workDate: visitedDate?.date || kstDate(), arrivalTime: visitedDate?.hm || "",
            machineCount: 0, grade: "", contractEnded: false, workKinds: ["misu"], minutes: {}, salesIt: "", salesCopier: "", commute: "", note: "",
          }, res.text);
        } catch (e) { notes.push(`방문집계 실패: ${(e as Error).message}`); }
        try {
          await saveActivityEvent({
            activityDate: kstDate(), author: toSave.author, category: "misu", vendor: toSave.vendor, quantity: 1, machineCount: 0, sourceText: res.text,
            metadata: { formMode: "misu", misuVisitId: toSave.id, round: toSave.visit_round, judgment: toSave.judgment },
          });
        } catch (e) { notes.push(`운영현황 기록 실패: ${(e as Error).message}`); }
        if (!notes.length) flagsRef.current.recorded = true;
      }
      const message = [res.message, ...notes].join(" · ");

      if (res.kakao === "failed") {
        // 기록은 저장됐다. 초안을 남겨 두고 다시 누르면(같은 id → dup) 카톡만 다시 보낸다.
        writeMisuDraft(storage(), { v: 1, savedAt: Date.now(), draft: { ...draft, album_id: res.albumId }, vendor, slots: savedSlots(meta), ...flagsRef.current });
        setResult({ tone: "warn", text: `${message}${res.kakaoError ? ` (${res.kakaoError})` : ""}` });
        onToast(message, "warning");
        return;
      }
      resetAll();
      setResult({ tone: notes.length || res.albumError || res.kakao === "no-room" || res.kakao === "disabled" ? "warn" : "ok", text: `${toSave.vendor} ${toSave.visit_round} — ${message}` });
      onToast(message, notes.length || res.albumError ? "warning" : "success");
      loadIndex();
    } catch (e) {
      // 위에서 다 잡지만, 예상 못 한 오류도 성공처럼 넘기지 않는다
      const text = `보내기 중 오류: ${(e as Error).message || e}`;
      setResult({ tone: "error", text });
      onToast(text, "error");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const roomNotice = tableNotReady ? null
    : roomError ? { tone: "warn" as const, text: `카톡방 설정을 읽지 못했습니다 — 보낼 때 다시 확인합니다 (${roomError})` }
      : roomInfo?.notice || null;

  const authorSlot = locked
    ? <span className="inline-flex min-h-11 items-center rounded-lg bg-slate-50 px-3 text-[13px] font-bold text-slate-800">{author || "작성자 없음"}</span>
    : (
      <select value={author} onChange={(e) => setAuthor(e.target.value)} aria-label="작성자"
        className="h-11 rounded-lg border border-slate-200 bg-white px-2 text-[13px] font-bold text-slate-800 outline-none focus:border-blue-500">
        <option value="">작성자 선택</option>
        {authors.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
    );

  return (
    <MisuVisitFormView
      value={draft}
      onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
      authorSlot={authorSlot}
      draftNotice={draftNotice}
      onDiscardDraft={draftNotice ? () => void discardDraft() : undefined}
      vendorListLabel={vendorQuery.trim() ? "전 팀 미수 목록에서 찾기" : myTeam ? `${myTeam}팀 미수 목록` : "전체 미수 목록"}
      vendorList={vendorList}
      vendorListState={sheetState}
      vendorListError={sheetError}
      vendorQuery={vendorQuery}
      onVendorQuery={setVendorQuery}
      selectedVendor={vendor}
      onPickVendor={pickVendor}
      onClearVendor={clearVendor}
      otherQuery={otherQuery}
      onOtherQuery={setOtherQuery}
      onOtherSearch={() => void searchOther()}
      otherSearching={otherSearching}
      otherError={otherError}
      otherResults={otherResults}
      suggestedRound={suggestion?.round}
      roundHint={vendor ? misuRoundHint(suggestion, indexState) : undefined}
      photos={slots}
      onPhotoFile={onPhotoFile}
      onPhotoRemove={onPhotoRemove}
      onPhotoRetry={onPhotoRetry}
      validation={validation}
      previewLines={previewLines}
      kakaoText={kakaoText}
      roomNotice={roomNotice}
      tableNotReady={tableNotReady}
      onSubmit={() => void submit()}
      submitting={submitting}
      result={result}
    />
  );
}
