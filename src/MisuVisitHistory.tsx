// 조회 › 미수 › [방문 이력] 컨테이너 — 읽기·합치기·필터 상태·복사·숨기기. 그리는 것은 MisuVisitHistory.view.tsx(윤화면).
// 설계: docs/tasks/misu-redesign.md §4-B. 데이터·판정은 misuVisitHistoryData.ts / misuVisit.ts.
// 표(misu_visits) SQL 실행 전이면 404/PGRST205 를 잡아 tableNotReady — 관리부 미수 목록과 이전 기록만 보인다.
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import MisuVisitHistoryView, { type MisuHistoryDetail, type MisuHistoryFilters } from "./MisuVisitHistory.view";
import { buildLegalCopyText, litigationChecklist, type MisuLegacyEntry, type MisuVisit } from "./misuVisit";
import {
  canHideMisuVisit, DEFAULT_MISU_HISTORY_FILTERS, filterSortMisuVendors, hideMisuVisit, isTableMissingError, joinMisuHistory,
  loadLegacyKakao, loadMisuCsChecks, loadMisuSheetVendors, loadMisuVisits, loadVendorVisits, misuPeriodRange, sheetMemosToLegacy,
  sortLegacy, toHistoryVendor, toHistoryVisits, type MisuCsCheck, type MisuJoinedVendor, type MisuSheetVendor, type MisuViewer,
} from "./misuVisitHistoryData";
import { kstDate } from "./visits";
import { getSsoSession, ssoRequiredCached } from "./sso";
import { notify } from "./toast";
import { askConfirm } from "./confirmModal";

const PhotoViewer = lazy(() => import("./PhotoViewer"));

/** 지금 보는 사람: 로그인 필수면 그룹웨어 이름, 아니면 기기 작성자 → 세션 이름 */
function currentViewer(): MisuViewer {
  const session = getSsoSession();
  const sName = String(session?.user?.name || "").trim();
  const sub = String(session?.user?.sub || "").trim();
  if (ssoRequiredCached() && sName) return { name: sName, sub };
  let local = "";
  try { local = localStorage.getItem("author") || ""; } catch { /* 사생활 모드 — 이름 없음으로 */ }
  const name = local.trim() || sName;
  return { name, sub: name && name === sName ? sub : "" };
}

const errText = (e: unknown) => String((e as Error)?.message || e || "").slice(0, 120);

export type MisuVisitHistoryProps = {
  /** [보완 기록 쓰기] — 필드 › 미수 작성기(구현서 B)로 이동. 안 넘기면 단추가 안 보인다. */
  onSupplement?: (visit: MisuVisit) => void;
};

export default function MisuVisitHistory({ onSupplement }: MisuVisitHistoryProps) {
  const [filters, setFilters] = useState<MisuHistoryFilters>(DEFAULT_MISU_HISTORY_FILTERS);
  const [reload, setReload] = useState(0);
  const range = useMemo(() => misuPeriodRange(filters), [filters.period, filters.from, filters.to]); // eslint-disable-line react-hooks/exhaustive-deps -- 기간 세 칸만 보면 됨
  const rangeKey = `${range.from}|${range.to}`;

  // ② 관리부 미수 목록 · ③ CS체크 — 한 번만
  const [sheet, setSheet] = useState<MisuSheetVendor[] | null | undefined>(undefined); // undefined 불러오는 중, null 실패
  const [sheetError, setSheetError] = useState("");
  const [csChecks, setCsChecks] = useState<MisuCsCheck[]>([]);
  useEffect(() => {
    let alive = true;
    loadMisuSheetVendors()
      .then((list) => { if (alive) { setSheet(list); setSheetError(""); } })
      .catch((e) => {
        if (!alive) return;
        setSheet(null); setSheetError(errText(e));
        notify("관리부 미수 목록을 불러오지 못했습니다 — 방문 기록이 있는 업체만 보입니다.", "error");
      });
    loadMisuCsChecks()
      .then((list) => { if (alive) setCsChecks(list); })
      .catch(() => { if (alive) notify("CS체크 목록을 불러오지 못해 CS체크 표시가 빠집니다.", "info"); });
    return () => { alive = false; };
  }, [reload]);

  // ① 방문 기록 — 기간이 바뀌면 다시
  const [visits, setVisits] = useState<MisuVisit[] | undefined>(undefined);
  const [visitsError, setVisitsError] = useState("");
  const [tableNotReady, setTableNotReady] = useState(false);
  useEffect(() => {
    let alive = true;
    setVisits(undefined);
    loadMisuVisits(range)
      .then((rows) => { if (alive) { setVisits(rows); setVisitsError(""); setTableNotReady(false); } })
      .catch((e) => {
        if (!alive) return;
        if (isTableMissingError(e)) { setTableNotReady(true); setVisits([]); setVisitsError(""); return; }
        setVisits([]); setVisitsError(errText(e));
      });
    return () => { alive = false; };
  }, [rangeKey, reload]); // eslint-disable-line react-hooks/exhaustive-deps -- range 는 rangeKey 로 비교

  const loading = sheet === undefined || visits === undefined;
  // 둘 다 비면 오류 화면, 한쪽만 실패면 남은 쪽으로 보여 주고 토스트로 알린다
  const failed = !loading && !!visitsError && !(sheet || []).length;
  const state: "loading" | "error" | "ready" = loading ? "loading" : failed ? "error" : "ready";
  useEffect(() => {
    if (state === "ready" && visitsError) notify(`방문 기록을 불러오지 못했습니다 — 관리부 미수 목록만 보입니다. (${visitsError})`, "error");
  }, [state, visitsError]);

  const joined = useMemo<MisuJoinedVendor[]>(() => (loading ? [] : joinMisuHistory(sheet || [], visits || [], csChecks)), [loading, sheet, visits, csChecks]);
  const shown = useMemo(() => filterSortMisuVendors(joined, filters), [joined, filters]);
  const today = kstDate();
  const vendorsView = useMemo(() => shown.map((v) => toHistoryVendor(v, today)), [shown, today]);
  const authorOptions = useMemo(() => Array.from(new Set((visits || []).map((v) => String(v.author || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko")), [visits]);

  // 펼친 업체
  const [openKey, setOpenKey] = useState<string | null>(null);
  const openVendor = useMemo(() => joined.find((v) => v.key === openKey) || null, [joined, openKey]);
  const [vendorVisits, setVendorVisits] = useState<{ key: string; state: "loading" | "error" | "ready"; error?: string; visits: MisuVisit[] } | null>(null);
  const [legacy, setLegacy] = useState<{ key: string; state: "loading" | "error" | "ready"; error?: string; list: MisuLegacyEntry[] } | null>(null);
  const openRefKey = openVendor ? `${openVendor.key}|${openVendor.company_code}|${openVendor.lease_seq}|${openVendor.name}` : "";

  useEffect(() => {
    if (!openVendor) { setVendorVisits(null); return; }
    const key = openVendor.key;
    // 기간 '전체'면 이미 다 읽었다 → 그대로. 기간이 걸려 있으면 체크리스트가 기간 밖 1차 기록까지 보도록 이 업체 전체를 다시 읽는다.
    if (tableNotReady || (!range.from && !range.to)) { setVendorVisits({ key, state: "ready", visits: openVendor.visits }); return; }
    let alive = true;
    setVendorVisits({ key, state: "loading", visits: [] });
    loadVendorVisits({ company_code: openVendor.company_code, lease_seq: openVendor.lease_seq, vendor: openVendor.name })
      .then((rows) => {
        if (!alive) return;
        // 이름 하나로만 읽은 탓에 놓친 기록이 있으면 기간 안 기록과 합친다(id 기준 중복 제거)
        const byId = new Map<string, MisuVisit>();
        [...rows, ...openVendor.visits].forEach((v) => byId.set(v.id, v));
        setVendorVisits({ key, state: "ready", visits: [...byId.values()] });
      })
      .catch((e) => { if (alive) setVendorVisits({ key, state: "error", error: errText(e), visits: [] }); });
    return () => { alive = false; };
  }, [openRefKey, rangeKey, tableNotReady, visits]); // eslint-disable-line react-hooks/exhaustive-deps -- openVendor 는 openRefKey 로 비교

  useEffect(() => {
    if (!openVendor) { setLegacy(null); return; }
    const key = openVendor.key;
    const memos = openVendor.sheet ? sheetMemosToLegacy(openVendor.sheet.row) : [];
    let alive = true;
    setLegacy({ key, state: "loading", list: [] });
    loadLegacyKakao(openVendor.name)
      .then((kakao) => { if (alive) setLegacy({ key, state: "ready", list: sortLegacy([...memos, ...kakao]) }); })
      .catch((e) => { if (alive) setLegacy({ key, state: memos.length ? "ready" : "error", error: errText(e), list: sortLegacy(memos) }); });
    return () => { alive = false; };
  }, [openRefKey]); // eslint-disable-line react-hooks/exhaustive-deps -- openVendor 는 openRefKey 로 비교

  const viewer = useMemo(() => currentViewer(), [openKey, reload]); // eslint-disable-line react-hooks/exhaustive-deps -- 펼칠 때·다시 읽을 때마다 작성자 선택 변화를 다시 읽는다
  const detail = useMemo<MisuHistoryDetail | null>(() => {
    if (!openVendor || !vendorVisits || vendorVisits.key !== openVendor.key) return openVendor ? { state: "loading", visits: [], checklist: [], legacyState: "loading", legacy: [] } : null;
    const lg = legacy && legacy.key === openVendor.key ? legacy : null;
    return {
      state: vendorVisits.state,
      error: vendorVisits.error,
      visits: toHistoryVisits(vendorVisits.visits, viewer, today),
      checklist: litigationChecklist(vendorVisits.visits).items,
      legacyState: lg ? lg.state : "loading",
      legacyError: lg?.error,
      legacy: lg ? lg.list : [],
    };
  }, [openVendor, vendorVisits, legacy, viewer, today]);

  const onFilters = useCallback((patch: Partial<MisuHistoryFilters>) => setFilters((f) => ({ ...f, ...patch })), []);
  const onToggle = useCallback((key: string) => setOpenKey((k) => (k === key ? null : key)), []);
  const onRetry = useCallback(() => setReload((n) => n + 1), []);

  // 사진 보기
  const [photo, setPhoto] = useState<{ urls: string[]; index: number } | null>(null);
  const onOpenPhoto = useCallback((urls: string[], index: number) => setPhoto({ urls, index }), []);

  // 법무 전달용 복사
  const [copyResult, setCopyResult] = useState<{ key: string; tone: "ok" | "error"; text: string } | null>(null);
  const onCopyLegal = useCallback(async (key: string) => {
    if (!openVendor || openVendor.key !== key || !vendorVisits || vendorVisits.state !== "ready") return;
    const sv = openVendor.sheet;
    const text = buildLegalCopyText(vendorVisits.visits, {
      vendor: openVendor.name, company_code: openVendor.company_code, lease_seq: openVendor.lease_seq,
      misu_months: sv?.monthsNum ? String(sv.monthsNum) : "", misu_balance: sv?.balanceNum ? String(sv.balanceNum) : "",
    });
    try {
      if (!navigator.clipboard?.writeText) throw new Error("이 브라우저는 복사를 지원하지 않습니다");
      await navigator.clipboard.writeText(text);
      setCopyResult({ key, tone: "ok", text: "복사했습니다. 소송방 게시글에 붙여넣으세요." });
    } catch (e) {
      setCopyResult({ key, tone: "error", text: `복사하지 못했습니다 — ${errText(e)}` });
    }
  }, [openVendor, vendorVisits]);

  // 숨기기(작성자 본인·당일 — 앱이 거르고, 표 정책은 한 방향만 허용)
  const onHide = useCallback(async (visitId: string) => {
    const v = vendorVisits?.visits.find((x) => x.id === visitId);
    const me = currentViewer();
    if (!v || !canHideMisuVisit(v, me, kstDate())) { notify("작성자 본인이 작성한 당일에만 숨길 수 있습니다.", "error"); return; }
    const ok = await askConfirm("이 방문 기록을 숨길까요? 숨긴 기록은 다시 되돌릴 수 없습니다(관리자만 복구).", { danger: true, okLabel: "숨기기" });
    if (!ok) return;
    try {
      await hideMisuVisit(visitId, me.name);
      notify("방문 기록을 숨겼습니다.", "success");
      setReload((n) => n + 1);
    } catch (e) {
      notify(`숨기지 못했습니다 — ${errText(e)}`, "error");
    }
  }, [vendorVisits]);

  const onSupplementId = useMemo(() => {
    if (!onSupplement) return undefined;
    return (visitId: string) => {
      const v = vendorVisits?.visits.find((x) => x.id === visitId);
      if (!v) { notify("원 기록을 찾지 못했습니다. 새로고침 후 다시 눌러 주세요.", "error"); return; }
      onSupplement(v);
    };
  }, [onSupplement, vendorVisits]);

  return (
    <>
      <MisuVisitHistoryView
        state={state}
        error={failed ? visitsError || sheetError : undefined}
        onRetry={onRetry}
        tableNotReady={tableNotReady}
        vendors={vendorsView}
        totalCount={joined.length}
        filters={filters}
        onFilters={onFilters}
        authorOptions={authorOptions}
        openKey={openKey}
        onToggle={onToggle}
        detail={detail}
        onOpenPhoto={onOpenPhoto}
        onCopyLegal={(key) => void onCopyLegal(key)}
        copyResult={copyResult}
        onHide={(id) => void onHide(id)}
        onSupplement={onSupplementId}
      />
      {photo && (
        <Suspense fallback={null}>
          <PhotoViewer urls={photo.urls} index={photo.index} onClose={() => setPhoto(null)} />
        </Suspense>
      )}
    </>
  );
}
