// 부서 접수(경영·운영·영업팀) 폼 로직 — 표시 틀 DeptReceptionForm.view 를 감싼다(설계 4-3). 설계안 이름은 DeptReception.tsx 였으나 deptReception.ts 와 대소문자만 달라 Windows에서 충돌해 이 이름으로 둔다.
// 기존(임대리스트 검색: 숫자+Enter = 순 정확 일치) / 신규(업체명·지역 직접) · 자동 채움 · 처리자 기본값 · 저장 6단계(deptReceptionFlow.runDeptSave) · 결과 줄.
// 2026-10-19: "업체로 접수"(vendor_master 검색) 모드와 폼 안 부서 달력을 뺐다 — 복합기 AS 처럼 기존/신규만, 달력은 캘린더 탭에서.
import { useMemo, useRef, useState } from "react";
import DeptReceptionFormView, { DeptCandidateList, DeptCandidateRow } from "./DeptReceptionForm.view";
import PortalSelect from "./PortalSelect";
import { searchLeaseList, type LeaseHit } from "./api";
import { leaseDeptOf, MATCHED_BY_KEY } from "./leaseDept";
import {
  DEPT_FIELD_CHIPS, DEPT_ROUTES, DEPT_ROUTE_LABEL, defaultHandler, defaultRoute, deptMissing, normalizeRegion,
  pickLease, regionLabelOf, type DeptReceptionInput, type DeptRegion, type DeptRoute, type DeptType,
} from "./deptReception";
import { isCheckConstraintError } from "./deptReceptionApi";
import {
  formatPhone, leaseRegionOf, nameOptions, resolveReceiver, runDeptSave, warnTone, type DeptSaveResult,
} from "./deptReceptionFlow";
import { useMembers } from "./authors";
import { getSsoSession, ssoRequiredCached } from "./sso";
import { askConfirm } from "./confirmModal";
import { notify } from "./toast";

type Props = {
  dept: DeptType;
  /** 로그인 필수가 꺼져 있을 때 접수자 — 서비스접수 머리의 작성자 선택값 */
  fallbackAuthor: string;
  onSaved?: (result: DeptSaveResult) => void;
};

const seqOf = (h: LeaseHit) => pickLease(h, "순", "순번");
const firstLine = (v: string) => v.split(/_x000d_|\r|\n/)[0].trim();
const vendorKey = (h: LeaseHit) => firstLine(pickLease(h, "_업체명", "거래처명"));

export default function DeptReception({ dept, fallbackAuthor, onSaved }: Props) {
  const members = useMembers();
  const receiver = resolveReceiver(ssoRequiredCached(), getSsoSession(), fallbackAuthor);

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [leaseHits, setLeaseHits] = useState<LeaseHit[]>([]);
  const [lease, setLease] = useState<LeaseHit | null>(null);
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
  const savingRef = useRef(false);
  const lastSavedRef = useRef<{ sig: string; id: string } | null>(null);

  // 부서가 바뀌면 부서별 기본값만 다시 잡는다(거래처·내용은 유지)
  const [prevDept, setPrevDept] = useState(dept);
  if (prevDept !== dept) {
    setPrevDept(dept);
    setRoute(defaultRoute(dept)); setField(""); setFieldCustom(""); setContractKind(""); setHandlerTouched(false); setResult(null);
  }

  // ── 거래처에서 나오는 값 ──
  const region: DeptRegion = isNew ? newRegion : (leaseRegionOf(lease) as DeptRegion);
  const vendorName = isNew ? newVendor.trim() : pickLease(lease, "거래처명", "_업체명").split(/_x000d_|\r|\n/)[0].trim();
  // 처리자: 사용자가 손대지 않은 동안은 지역 기본값을 따라간다
  const effectiveHandler = handlerTouched ? handler : defaultHandler(dept, region);
  const fieldFinal = field === "직접입력" ? fieldCustom.trim() : field;

  const input: DeptReceptionInput = {
    dept, author: receiver.name, route, via, vendor: vendorName,
    vendorCode: "",
    leaseNo: !isNew ? seqOf(lease || {}) : "",
    grade: isNew ? "" : pickLease(lease, "등급"),
    region,
    assetNo: !isNew ? pickLease(lease, "자산번호") : "",
    serial: !isNew ? pickLease(lease, "시리얼번호(기번)", "기번") : "",
    model: !isNew ? pickLease(lease, "모델명", "기종") : "",
    address: isNew ? "" : pickLease(lease, "주소(실납품주소,도로명주소)", "주소"),
    field: fieldFinal, content: symptom, notes, receiverName, receiverPhone,
    handler: effectiveHandler, outside, contractKind: dept === "경영지원" ? contractKind : "", scheduleDate,
    lease: isNew ? null : lease, // 카톡 카드의 임대리스트 칸(2026-10-27)
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
  // 고를 때 후보 목록은 남겨 둔다 — 요약의 × (onClearVendor)로 비우면 같은 검색 결과가 다시 보인다(복합기 AS 처럼 다시 검색)
  const chooseLease = (h: LeaseHit) => { setLease(h); setIsNew(false); setResult(null); };
  const clearVendor = () => { setLease(null); setResult(null); }; // 거래처 구분(기존)·검색어·후보는 유지
  const changeCustKind = (k: "기존" | "신규") => {
    // 복합기 AS(ServiceReception setCustKind)와 같이 선택·검색어·결과·신규 입력을 비운다
    setIsNew(k === "신규"); setLease(null); setQuery(""); setLeaseHits([]); setSearched(false); setSearchError(""); setNewVendor(""); setNewRegion(""); setResult(null);
  };
  const runSearch = async () => {
    const kw = query.trim();
    if (!kw || searching) return;
    setSearching(true); setSearchError(""); setSearched(false);
    try {
      const numeric = /^\d+$/.test(kw);
      const hits = await searchLeaseList(kw);
      const exact = numeric ? hits.filter((h) => seqOf(h) === kw) : [];
      setLease(null);
      setLeaseHits(numeric && exact.length ? exact : hits);
      if (exact.length === 1) chooseLease(exact[0]);
      setSearched(true);
    } catch (e) {
      setSearchError((e as Error).message);
    } finally { setSearching(false); }
  };

  // 같은 업체 기기 수(검색 결과 기준) — 후보 행의 "기기 N대" 칩과 선택 요약의 임대중 경고
  const vendorCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of leaseHits) m.set(vendorKey(h), (m.get(vendorKey(h)) || 0) + 1);
    return m;
  }, [leaseHits]);
  const endedOf = (h: LeaseHit) => { const st = pickLease(h, "임대여부"); return st && st !== "임대중" ? st : ""; };

  const candidates = isNew || lease ? null : leaseHits.length > 0 ? (
    <DeptCandidateList>
      {leaseHits.slice(0, 30).map((h, i) => (
        <DeptCandidateRow key={`${seqOf(h)}-${i}`} name={firstLine(pickLease(h, "거래처명", "_업체명"))} dept={leaseDeptOf(h)} deptMatched={h[MATCHED_BY_KEY] === "부서"} ended={endedOf(h) || undefined}
          sameVendor={vendorCounts.get(vendorKey(h)) || 0} no={seqOf(h) || "-"} model={pickLease(h, "모델명", "기종")} asset={pickLease(h, "자산번호")}
          serial={pickLease(h, "시리얼번호(기번)", "기번")} region={regionLabelOf(leaseRegionOf(h) as DeptRegion)} onPick={() => chooseLease(h)} />
      ))}
    </DeptCandidateList>
  ) : searched && !searching && !searchError ? <div className="mt-2 text-xs font-bold text-slate-400">검색 결과가 없습니다.</div> : null;

  // 선택된 거래처 한 줄 요약 — 복합기 AS 요약과 같은 순서(순·모델·자산번호·기번·등급·지역·종료일·미수), 경영지원은 마감담당·일반전화·확장성을 뒤에 붙인다
  const activeSame = lease ? leaseHits.filter((h) => vendorKey(h) === vendorKey(lease) && pickLease(h, "임대여부") === "임대중").length : 0;
  const selectedSummary = !isNew && lease ? {
    name: vendorName || "업체 미기재",
    badge: endedOf(lease) ? `${endedOf(lease)} 기기` : undefined,
    fields: [
      ["순", seqOf(lease) || "-", "num"], ["부서", leaseDeptOf(lease) || "-", ""], ["모델", pickLease(lease, "모델명", "기종") || "-", ""],
      ["자산번호", pickLease(lease, "자산번호") || "-", "mono"], ["기번", pickLease(lease, "시리얼번호(기번)", "기번") || "-", "mono"],
      ["등급", pickLease(lease, "등급") || "-", ""], ["지역", regionLabelOf(normalizeRegion(region)) || "-", ""],
      ["종료일", pickLease(lease, "종료일") || "-", "num"], ["미수", `${pickLease(lease, "미수개월수", "미수개월") || "0"}개월`, "num"],
      ...(dept === "경영지원" ? ([
        ["마감담당", pickLease(lease, "담당자(마감담당)", "마감담당", "마감 담당자"), ""], ["일반전화", pickLease(lease, "일반전화"), "num"], ["확장성", pickLease(lease, "확장성"), ""],
      ] as Array<[string, string, ("num" | "mono" | "")?]>).filter(([, v]) => v) : []),
    ] as Array<[string, string, ("num" | "mono" | "")?]>,
    warn: activeSame > 1 ? `임대중 ${activeSame}대(검색 결과 기준) — 접수할 기기의 자산·기번이 맞는지 확인하세요` : undefined,
  } : null;

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
    setQuery(""); setLeaseHits([]); setSearched(false); setLease(null); setIsNew(false); setNewVendor(""); setNewRegion("");
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
      const extra: Record<string, string> = { unit: "device", author_team: receiver.team };
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
      {!receiver.locked && <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[12px] font-bold text-slate-600">
        <span className="font-black text-slate-400">접수자</span>
        <span className="font-black text-slate-900">{receiver.name || "미지정"}</span>
        {receiver.team && <span>· {receiver.team}</span>}
        {receiver.locked
          ? <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">그룹웨어 로그인</span>
          : <span className="ml-auto text-[10px] font-bold text-slate-400">위 작성자 선택으로 바꿀 수 있습니다</span>}
      </div>}

      <DeptReceptionFormView receiverLabel={receiver.locked ? `접수자 ${receiver.name}${receiver.team ? ` · ${receiver.team}` : ""}` : undefined}
        dept={dept} mode="device" onModeChange={() => undefined /* 업체로 접수 제거(2026-10-19) — View 의 토글은 윤화면이 뺀다 */}
        query={query} onQueryChange={setQuery} onSearch={() => void runSearch()} searching={searching} searchError={searchError}
        candidates={candidates}
        custKind={isNew ? "신규" : "기존"} onCustKind={changeCustKind}
        newVendorName={newVendor} onNewVendorName={setNewVendor}
        newRegion={regionLabelOf(newRegion)} onNewRegion={(v) => setNewRegion(normalizeRegion(v))}
        selectedSummary={selectedSummary} onClearVendor={clearVendor}
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
    </div>
  );
}
