// 부서 접수(경영·운영·영업지원) 폼 로직 — 표시 틀 DeptReceptionForm.view 를 감싼다(설계 4-3). 설계안 이름은 DeptReception.tsx 였으나 deptReception.ts 와 대소문자만 달라 Windows에서 충돌해 이 이름으로 둔다.
// 기기/업체 전환 · 순번/업체명 검색(숫자+Enter = 순 정확 일치) · 자동 채움 · 처리자 기본값 · 저장 6단계(deptReceptionFlow.runDeptSave) · 결과 줄.
import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { CalendarDays, X } from "lucide-react";
import DeptReceptionFormView from "./DeptReceptionForm.view";
import PortalSelect from "./PortalSelect";
import { searchLeaseList, type LeaseHit } from "./api";
import {
  DEPT_FIELD_CHIPS, DEPT_ROUTES, DEPT_ROUTE_LABEL, aggregateVendor, defaultHandler, defaultRoute, deptMissing, normalizeRegion,
  pickLease, regionLabelOf, type DeptReceptionInput, type DeptRegion, type DeptRoute, type DeptType,
} from "./deptReception";
import { isCheckConstraintError, searchVendorMaster, vendorInfoByCode, type VendorMasterHit } from "./deptReceptionApi";
import {
  formatPhone, leaseRegionOf, nameOptions, pickVendorAlias, resolveReceiver, runDeptSave, warnTone, type DeptSaveResult,
} from "./deptReceptionFlow";
import { useMembers } from "./authors";
import { getSsoSession, ssoRequiredCached } from "./sso";
import { askConfirm } from "./confirmModal";
import { notify } from "./toast";

const TeamCalendar = lazy(() => import("./TeamCalendar"));

type Props = {
  dept: DeptType;
  /** 로그인 필수가 꺼져 있을 때 접수자 — 서비스접수 머리의 작성자 선택값 */
  fallbackAuthor: string;
  onSaved?: (result: DeptSaveResult) => void;
};

type VendorPick = { hit: VendorMasterHit; vendorName: string; grade: string; region: DeptRegion; deviceCount: number; address: string };
const STORE_KEY = "reception_dept_v1";
const REGION_CHIPS: Array<[DeptRegion, string]> = [["A", "A"], ["B", "B"], ["C", "C"], ["D", "D"], ["E", "E"], ["지방", "지방"], ["", "미정"]];
const seqOf = (h: LeaseHit) => pickLease(h, "순", "순번");

function readStore(): { mode?: "device" | "vendor" } {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") as { mode?: "device" | "vendor" }; } catch { return {}; }
}

export default function DeptReception({ dept, fallbackAuthor, onSaved }: Props) {
  const members = useMembers();
  const receiver = resolveReceiver(ssoRequiredCached(), getSsoSession(), fallbackAuthor);

  const [mode, setModeState] = useState<"device" | "vendor">(() => readStore().mode === "vendor" ? "vendor" : "device");
  const setMode = (m: "device" | "vendor") => {
    setModeState(m);
    setQuery(""); setLeaseHits([]); setMasterHits([]); setSearchError(""); setSearched(false);
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ dept, mode: m })); } catch { /* 무시 */ }
  };
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [leaseHits, setLeaseHits] = useState<LeaseHit[]>([]);
  const [masterHits, setMasterHits] = useState<VendorMasterHit[]>([]);
  const [lease, setLease] = useState<LeaseHit | null>(null);
  const [vendorPick, setVendorPick] = useState<VendorPick | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [newVendor, setNewVendor] = useState("");
  const [newRegion, setNewRegion] = useState<DeptRegion>("");

  const [route, setRoute] = useState<DeptRoute>(() => defaultRoute(dept));
  const [via, setVia] = useState("");
  const [field, setField] = useState("");
  const [fieldCustom, setFieldCustom] = useState("");
  const [receiverName, setReceiverName] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [symptom, setSymptom] = useState("");
  const [notes, setNotes] = useState("");
  const [handler, setHandler] = useState("");
  const [handlerTouched, setHandlerTouched] = useState(false);
  const [outside, setOutside] = useState(false);
  const [contractKind, setContractKind] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const [calOpen, setCalOpen] = useState(false);
  const savingRef = useRef(false);
  const lastSavedRef = useRef<{ sig: string; id: string } | null>(null);

  // 부서가 바뀌면 부서별 기본값만 다시 잡는다(거래처·내용은 유지)
  const [prevDept, setPrevDept] = useState(dept);
  if (prevDept !== dept) {
    setPrevDept(dept);
    setRoute(defaultRoute(dept)); setField(""); setFieldCustom(""); setContractKind(""); setHandlerTouched(false); setResult(null);
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ dept, mode })); } catch { /* 무시 */ }
  }

  // ── 거래처에서 나오는 값 ──
  const region: DeptRegion = mode === "vendor" ? (vendorPick?.region || "") : isNew ? newRegion : (leaseRegionOf(lease) as DeptRegion);
  const vendorName = mode === "vendor" ? (vendorPick?.vendorName || "") : isNew ? newVendor.trim() : pickLease(lease, "거래처명", "_업체명").split(/_x000d_|\r|\n/)[0].trim();
  // 처리자: 사용자가 손대지 않은 동안은 지역 기본값을 따라간다
  const effectiveHandler = handlerTouched ? handler : defaultHandler(dept, region);
  const fieldFinal = field === "직접입력" ? fieldCustom.trim() : field;

  const input: DeptReceptionInput = {
    dept, author: receiver.name, route, via, vendor: vendorName,
    vendorCode: mode === "vendor" ? vendorPick?.hit.code || "" : "",
    leaseNo: mode === "device" && !isNew ? seqOf(lease || {}) : "",
    grade: mode === "vendor" ? vendorPick?.grade || "" : isNew ? "" : pickLease(lease, "등급"),
    region,
    assetNo: mode === "device" && !isNew ? pickLease(lease, "자산번호") : "",
    serial: mode === "device" && !isNew ? pickLease(lease, "시리얼번호(기번)", "기번") : "",
    model: mode === "device" && !isNew ? pickLease(lease, "모델명", "기종") : "",
    address: mode === "vendor" ? vendorPick?.address || "" : isNew ? "" : pickLease(lease, "주소(실납품주소,도로명주소)", "주소"),
    field: fieldFinal, content: symptom, notes, receiverName, receiverPhone,
    handler: effectiveHandler, outside, contractKind: dept === "경영지원" ? contractKind : "", scheduleDate,
  };
  const missing = deptMissing(input);
  const required: Array<[string, boolean]> = [
    ["업체", !missing.includes("업체")],
    ["접수유형", !missing.includes("접수유형") && !missing.includes("사내 요청자")],
    ["접수분야", !missing.includes("접수분야")],
    ["접수내용", !missing.includes("접수내용")],
    ["접수자", !missing.includes("접수자")],
  ];

  // ── 검색 ──
  const chooseLease = (h: LeaseHit) => { setLease(h); setIsNew(false); setLeaseHits([]); setResult(null); };
  const chooseMaster = async (hit: VendorMasterHit) => {
    setSearching(true); setSearchError("");
    try {
      const rows = await vendorInfoByCode("", [hit.name, ...hit.aliases]);
      const agg = aggregateVendor(rows);
      setVendorPick({ hit, vendorName: pickVendorAlias(rows, hit.name), grade: agg.grade, region: agg.region, deviceCount: hit.device_count || agg.deviceCount, address: agg.address });
      setMasterHits([]); setResult(null);
    } catch (e) {
      setSearchError((e as Error).message);
    } finally { setSearching(false); }
  };
  const runSearch = async () => {
    const kw = query.trim();
    if (!kw || searching) return;
    setSearching(true); setSearchError(""); setSearched(false);
    try {
      const numeric = /^\d+$/.test(kw);
      if (mode === "device") {
        const hits = await searchLeaseList(kw);
        const exact = numeric ? hits.filter((h) => seqOf(h) === kw) : [];
        if (exact.length === 1) { chooseLease(exact[0]); }
        else setLeaseHits(numeric && exact.length ? exact : hits);
      } else {
        let q = kw;
        if (numeric) {
          const hits = await searchLeaseList(kw);
          const exact = hits.find((h) => seqOf(h) === kw);
          q = exact ? pickLease(exact, "_업체명", "거래처명") : "";
        }
        const hits = q ? await searchVendorMaster(q) : [];
        if (numeric && hits.length === 1) { setSearching(false); await chooseMaster(hits[0]); return; }
        setMasterHits(hits);
      }
      setSearched(true);
    } catch (e) {
      setSearchError((e as Error).message);
    } finally { setSearching(false); }
  };

  const hitBtn = "flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12px] font-bold text-slate-700 transition hover:bg-blue-50";
  const selectedBox = (title: string, sub: string, onClear: () => void) => (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
      <div className="min-w-0"><div className="truncate text-[13px] font-black text-slate-900">{title}</div><div className="truncate text-[11px] font-bold text-slate-500">{sub}</div></div>
      <button type="button" onClick={onClear} aria-label="다시 고르기" className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full border border-slate-300 bg-white px-2.5 text-[11px] font-black text-slate-500"><X size={12} aria-hidden />다시 고르기</button>
    </div>
  );

  const candidates = (
    <div className="space-y-2">
      {mode === "device" && (
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[12px] font-black text-slate-600 sm:min-h-9">
          <input type="checkbox" checked={isNew} onChange={(e) => { setIsNew(e.target.checked); if (e.target.checked) { setLease(null); setLeaseHits([]); } }} className="h-4 w-4" />
          순번 없음(신규)
        </label>
      )}
      {mode === "device" && isNew && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
          <input value={newVendor} onChange={(e) => setNewVendor(e.target.value)} placeholder="업체명(필수)" aria-label="신규 업체명"
            className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-900 outline-none focus:border-slate-700" />
          <div className="flex flex-wrap gap-1" role="group" aria-label="지역">
            {REGION_CHIPS.map(([r, t]) => (
              <button key={t} type="button" aria-pressed={newRegion === r} onClick={() => setNewRegion(r)}
                className={`min-h-9 rounded-full border px-3 text-[11px] font-black ${newRegion === r ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-500"}`}>{t}</button>
            ))}
          </div>
        </div>
      )}
      {mode === "device" && !isNew && lease && selectedBox(vendorName || "업체 미기재", [seqOf(lease) && `순 ${seqOf(lease)}`, pickLease(lease, "모델명", "기종"), pickLease(lease, "자산번호")].filter(Boolean).join(" · "), () => setLease(null))}
      {mode === "vendor" && vendorPick && selectedBox(vendorPick.hit.name, `${vendorPick.hit.code} · 보유 ${vendorPick.deviceCount}대 · 저장 이름 ${vendorPick.vendorName}`, () => setVendorPick(null))}
      {mode === "device" && !isNew && !lease && leaseHits.length > 0 && (
        <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 bg-white">
          {leaseHits.slice(0, 30).map((h, i) => (
            <button key={`${seqOf(h)}-${i}`} type="button" onClick={() => chooseLease(h)} className={hitBtn}>
              <span className="min-w-0 truncate"><b className="text-slate-900">{pickLease(h, "거래처명", "_업체명").split(/_x000d_|\r|\n/)[0]}</b> · {pickLease(h, "모델명", "기종") || "-"} · {pickLease(h, "자산번호") || "-"}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-slate-400">순 {seqOf(h) || "-"}{leaseRegionOf(h) ? ` · ${leaseRegionOf(h)}` : ""}</span>
            </button>
          ))}
        </div>
      )}
      {mode === "vendor" && !vendorPick && masterHits.length > 0 && (
        <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 bg-white">
          {masterHits.map((h) => (
            <button key={h.code} type="button" onClick={() => void chooseMaster(h)} className={hitBtn}>
              <span className="min-w-0 truncate"><b className="text-slate-900">{h.name}</b>{h.aliases.length ? ` · ${h.aliases.slice(0, 2).join(", ")}` : ""}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-slate-400">{h.device_count || 0}대</span>
            </button>
          ))}
        </div>
      )}
      {searched && !searching && !searchError && ((mode === "device" && !isNew && !lease && !leaseHits.length) || (mode === "vendor" && !vendorPick && !masterHits.length)) && (
        <div className="text-[12px] font-bold text-slate-400">찾는 거래처가 없습니다.{mode === "device" ? " 신규면 '순번 없음(신규)'을 켜 주세요." : " 업체명 일부로 다시 찾아 보세요."}</div>
      )}
    </div>
  );

  const preview: Array<[string, string]> | null = mode === "vendor"
    ? (vendorPick ? [
      ["마스터", vendorPick.hit.name], ["코드", vendorPick.hit.code], ["보유", `${vendorPick.deviceCount}대`],
      ["등급", vendorPick.grade], ["지역", regionLabelOf(vendorPick.region) || "미정"], ["주소", vendorPick.address], ["저장 이름", vendorPick.vendorName],
    ] : null)
    : isNew
      ? (newVendor.trim() ? [["업체명", newVendor.trim()], ["지역", regionLabelOf(newRegion) || "미정"], ["순", "신규(빈 칸)"]] : null)
      : lease ? [
        ["업체명", vendorName], ["등급", pickLease(lease, "등급")], ["지역", regionLabelOf(normalizeRegion(region)) || "미정"],
        ["임대여부", pickLease(lease, "임대여부")], ["자산번호", pickLease(lease, "자산번호")], ["모델명", pickLease(lease, "모델명", "기종")],
        ["계약기간", [pickLease(lease, "계약일", "첫계약일"), pickLease(lease, "종료일")].filter(Boolean).join(" ~ ")],
        ["남은개월", pickLease(lease, "남은개월", "남은개월수")], ["미수개월", pickLease(lease, "미수개월수", "미수개월")],
        ["기본금액", pickLease(lease, "기본금액", "기본임대료")], ["주소", pickLease(lease, "주소(실납품주소,도로명주소)", "주소")],
        ...(dept === "경영지원" ? [
          ["마감담당", pickLease(lease, "담당자(마감담당)", "마감담당", "마감 담당자")], ["일반전화", pickLease(lease, "일반전화")], ["확장성", pickLease(lease, "확장성")],
        ] as Array<[string, string]> : []),
      ] : null;

  const memberOpts = useMemo(() => nameOptions(members), [members]);
  const handlerOptions = useMemo(() => {
    const extras = [effectiveHandler, defaultHandler(dept, region), ...(dept === "경영지원" ? ["최영지", "박지은"] : [])];
    return [{ value: "", label: "미정" }, ...nameOptions(members, extras)];
  }, [members, effectiveHandler, dept, region]);

  const handlerSlot = (
    <PortalSelect value={effectiveHandler} onChange={(v) => { setHandler(v); setHandlerTouched(true); }} options={handlerOptions} placeholder="처리자" width={220} className="min-h-11 w-full"
      hint={!handlerTouched && effectiveHandler ? "지역 기본값" : dept === "경영지원" && region === "C" && !effectiveHandler ? "최영지·박지은 중 선택" : undefined} />
  );
  const viaSlot = route === "사내" ? (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-[11px] font-black text-slate-500">요청자 <span className="text-red-500">*</span></span>
      <PortalSelect value={via} onChange={setVia} options={memberOpts.some((o) => o.value === via) || !via ? memberOpts : [{ value: via, label: via }, ...memberOpts]} placeholder="사내 요청자 고르기" width={220} className="min-h-11 flex-1" />
    </div>
  ) : undefined;

  const resetForm = () => {
    setQuery(""); setLeaseHits([]); setMasterHits([]); setSearched(false); setLease(null); setVendorPick(null); setIsNew(false); setNewVendor(""); setNewRegion("");
    setRoute(defaultRoute(dept)); setVia(""); setField(""); setFieldCustom(""); setReceiverName(""); setReceiverPhone(""); setSymptom(""); setNotes("");
    setHandler(""); setHandlerTouched(false); setOutside(false); setContractKind(""); setScheduleDate("");
  };

  const save = async () => {
    if (savingRef.current) return; // 두 번 누름 — 진행 중이면 무시
    if (missing.length) { setResult({ tone: "error", text: `필수 항목을 채워 주세요: ${missing.join(", ")}` }); return; }
    const sig = JSON.stringify(input);
    if (lastSavedRef.current?.sig === sig) {
      const again = await askConfirm("같은 내용을 방금 저장했습니다. 한 건 더 저장할까요?", { okLabel: "한 건 더 저장" });
      if (!again) return;
    }
    savingRef.current = true;
    setSaving(true); setResult(null);
    try {
      const extra: Record<string, string> = { unit: mode, author_team: receiver.team };
      if (mode === "vendor" && vendorPick) { extra.vendor_master_name = vendorPick.hit.name; extra.device_count = String(vendorPick.deviceCount || 0); }
      const res = await runDeptSave(input, extra);
      lastSavedRef.current = { sig, id: res.id };
      const bad = res.warnings.filter((w) => warnTone(w) === "error");
      res.warnings.forEach((w) => notify(w, warnTone(w)));
      // 저장은 됐지만 시트 미반영·카톡 방 미정이면 warn, 그 밖의 실패(달력·카톡 전송 등)는 error
      const hard = bad.filter((w) => !w.startsWith("시트 미반영"));
      const tone = hard.length ? "error" : bad.length || res.kakao === "no_room" ? "warn" : "ok";
      setResult({ tone, text: bad.length ? `${res.summary} — ${bad.join(" / ")}` : res.summary });
      if (!bad.length) notify(`${dept} 접수를 저장했습니다.`, "success");
      resetForm();
      onSaved?.(res);
    } catch (e) {
      const text = isCheckConstraintError(e)
        ? "저장이 막혔습니다 — 서버에 부서 접수 설정(SQL)이 아직 실행되지 않았습니다. 관리자에게 'reception-dept-types.sql 실행 필요'를 알려 주세요."
        : `저장하지 못했습니다: ${(e as Error).message}`;
      setResult({ tone: "error", text });
      notify(text, "error");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[12px] font-bold text-slate-600">
        <span className="font-black text-slate-400">접수자</span>
        <span className="font-black text-slate-900">{receiver.name || "미지정"}</span>
        {receiver.team && <span>· {receiver.team}</span>}
        {receiver.locked
          ? <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">그룹웨어 로그인</span>
          : <span className="ml-auto text-[10px] font-bold text-slate-400">위 작성자 선택으로 바꿀 수 있습니다</span>}
      </div>

      <DeptReceptionFormView
        dept={dept} mode={mode} onModeChange={setMode}
        query={query} onQueryChange={setQuery} onSearch={() => void runSearch()} searching={searching} searchError={searchError}
        candidates={candidates} preview={preview}
        routeOptions={DEPT_ROUTES.map((r) => DEPT_ROUTE_LABEL[r])} route={DEPT_ROUTE_LABEL[route]}
        onRoute={(label) => { const r = DEPT_ROUTES.find((k) => DEPT_ROUTE_LABEL[k] === label); if (r) setRoute(r); }}
        viaSlot={viaSlot}
        fieldOptions={[...DEPT_FIELD_CHIPS[dept]]} field={field} onField={setField} fieldCustom={fieldCustom} onFieldCustom={setFieldCustom}
        receiverName={receiverName} onReceiverName={setReceiverName} receiverPhone={receiverPhone} onReceiverPhone={(v) => setReceiverPhone(formatPhone(v))}
        symptom={symptom} onSymptom={setSymptom} notes={notes} onNotes={setNotes}
        handlerSlot={handlerSlot} outside={outside} onOutside={setOutside}
        contractKind={dept === "경영지원" && /계약/.test(fieldFinal) ? contractKind : undefined}
        onContractKind={dept === "경영지원" ? setContractKind : undefined}
        scheduledDate={scheduleDate} onScheduledDate={setScheduleDate}
        required={required} onSave={() => void save()} saving={saving} result={result}
      />

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <button type="button" aria-expanded={calOpen} onClick={() => setCalOpen(!calOpen)} className="flex min-h-11 w-full items-center gap-2 px-4 text-left text-[13px] font-black text-slate-700">
          <CalendarDays size={15} aria-hidden />{dept} 달력<span className="ml-auto text-[11px] font-bold text-slate-400">{calOpen ? "접기" : "펼치기"}</span>
        </button>
        {calOpen && (
          <div className="border-t border-slate-100 p-3">
            <Suspense fallback={<div className="p-4 text-center text-xs font-bold text-slate-400">달력 불러오는 중…</div>}>
              <TeamCalendar team={dept} author={receiver.name} />
            </Suspense>
          </div>
        )}
      </section>
    </div>
  );
}
