import { useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Layers3,
  MapPin,
  Search,
  UserRound,
  X,
} from "lucide-react";
import { getVendorHistoryDetail, searchVendorHistoryCandidates, type DetailResp, type VendorHit } from "./api";
import { normRegion, primaryRegion, REGIONS, REGION_LABEL, vendorRegion } from "./region";
import { getVendorFlagsBatch, type VendorWorkFlags } from "./vendorFlags";
import { normalizeId, parseInspectionBlocks, type InspBlock } from "./ids";
import { usageSpareAdvice } from "./spareAdvice";
import { selectRows } from "./supabase";

type Props = {
  vendor: string;
  accent: string;
  open: boolean;
  onClose: () => void;
  onError: (msg: string) => void;
};

const CAT_ORDER = ["접수", "점검", "AS", "초과", "미수", "불만", "복합기확장성", "PC확장성", "재계약", "업체정보"];
const ACTIVITY_CATS = ["접수", "점검", "AS", "초과", "미수", "불만", "복합기확장성", "PC확장성"];
const CAT_SHORT: Record<string, string> = {
  접수: "접수", 점검: "점검", AS: "AS", 초과: "초과", 미수: "미수", 불만: "불만",
  복합기확장성: "복합기", PC확장성: "PC·IT", 재계약: "재계약", 업체정보: "업체정보",
};
const DATE_FIELD: Record<string, string> = {
  접수: "receipt_date", AS: "작성일", 점검: "작성일", 초과: "방문일", 불만: "방문일", 미수: "입력일",
  PC확장성: "날짜", 복합기확장성: "등록일", 업체정보: "종료일", 재계약: "계약종료일",
};
const WHO_KEYS = ["담당팀", "작성팀", "작성자", "입력자", "등록자", "관리담당자", "전략영업담당자", "author"];
const REGION_KEYS = ["지역", "미팅지역", "시/구", "region"];
const ALBUM_RX = /https?:\/\/\S*[?&]album=[\w-]+/;

// 상세 펼침에서 위에 크게 보여줄 분류별 중요 필드 — 나머지는 "그 외 정보"로 접는다
const PRIORITY_FIELDS: Record<string, string[]> = {
  // 기종을 교체해도 자산기번을 그대로 이어 쓰는 경우가 있어 시리얼넘버를 함께 크게 보여준다
  점검: ["처리내용", "내용", "매수", "토너잔량", "여분", "폐통", "모델명", "시리얼넘버", "자산기번", "특이사항"],
  AS: ["내용", "처리내용", "모델명", "시리얼넘버", "자산기번", "매수", "특이사항"],
  접수: ["type", "symptom", "status", "model", "serial", "asset_no", "address", "author"],
  초과: ["합계", "컬러초과료", "흑백초과료", "접수내용", "제안", "고객반응", "진행상태", "특이사항"],
  미수: ["미수잔액", "미수개월", "실제 잔액", "실제 개월수", "입금약속일", "방문내용", "고객반응"],
  불만: ["불만내용", "불편내용", "조치내용", "고객요청사항", "현장고객반응", "최종상태"],
  재계약: ["진행상황", "내용", "결과", "제안조건", "갱신상태", "계약종료일"],
  복합기확장성: ["프로젝트", "관심품목(세분화)", "진행상황(원문)", "첫등록내용", "특이사항"],
  PC확장성: ["세부사양", "어필 OR 추가영업", "렌탈or구매or유지보수", "총 인원", "수량", "금액", "시기", "포인트"],
  업체정보: ["품목", "제조사", "모델명", "기종", "자산번호", "순번", "계약일", "종료일", "임대여부"],
};
const FIELD_LABELS: Record<string, string> = {
  type: "구분", symptom: "증상", status: "상태", model: "모델", serial: "시리얼", asset_no: "자산번호",
  address: "주소", author: "접수자", receipt_date: "접수일", paid: "유상", lease_no: "순번",
  completed_at: "완료시각", completed_by: "처리자", region: "지역", title: "제목", notes: "메모", route: "경로",
  시리얼넘버: "시리얼", "어필 OR 추가영업": "영업메모", "렌탈or구매or유지보수": "이용형태", "총 인원": "총인원",
  "관심품목(세분화)": "관심품목", "진행상황(원문)": "진행상황", "수주가능성(A/B/C)": "수주가능성",
};
const fieldLabel = (key: string) => FIELD_LABELS[key] || key;
const junkValue = (value: string) => /^[ㅡ_\-\s.]*$/.test(value) || value === "0" || value === "false" || /^(없음|없슴|무|x|X)\.?$/.test(value.trim());
// 미리보기·카드 제목용 대표 문장 — 분류별 중요 필드에서 첫 유효값. 순수 숫자(수량·금액)는 문장형이 있으면 넘긴다
function priorityPreview(cat: string, rec: Record<string, unknown>) {
  const candidates = (PRIORITY_FIELDS[cat] || []).map((key) => String(rec[key] ?? "").trim()).filter((value) => value && !junkValue(value));
  return (candidates.find((value) => !/^[\d,.\s]+$/.test(value)) || candidates[0] || "").replace(/\s+/g, " ");
}
// "주식회사 무암"과 "무암"은 같은 회사 — 법인 표기만 다른 이름을 매 줄 반복하지 않기 위한 비교용
const coreName = (name: string) => name.replace(/주식회사|유한회사|㈜|\(주\)|\s+/g, "");


// 분기 체크 카드의 한 섹션(라벨 1개 + 항목 여러 개) — 기기 패널과 나란히 그리려고 컴포넌트로 분리
type CheckItem = { dot: string; headline: string; detail?: string; tone?: string; strong?: boolean; tag?: string };
type CheckSection = { label: string; items: CheckItem[] };
function CheckSectionRow({ sec, tint }: { sec: CheckSection; tint: Record<string, string> }) {
  return <div className="flex gap-3 px-4 py-2.5 sm:px-5">
    <span className="w-12 shrink-0 pt-1 text-[11px] font-black text-slate-400">{sec.label}</span>
    <div className="min-w-0 flex-1 space-y-2">
      {sec.items.map((item, itemIndex) => (
        <div key={`${item.headline}-${itemIndex}`} className={`flex gap-2.5 ${item.strong ? `-mx-2 rounded-lg px-2 py-1 ${tint[item.dot] || ""}` : ""}`}>
          <span className={`mt-1 h-4 w-1 shrink-0 rounded-full ${item.dot}`} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              {item.tag && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{item.tag}</span>}
              <span className={`min-w-0 truncate text-[13.5px] ${item.strong ? "font-black" : "font-bold"} ${item.tone || "text-slate-800"}`} title={item.headline}>{item.headline}</span>
            </div>
            {item.detail && <div className="mt-0.5 truncate text-[11.5px] font-medium text-slate-400" title={item.detail}>{item.detail}</div>}
          </div>
        </div>
      ))}
    </div>
  </div>;
}

type SummaryField = { key: string; value: string };

function pick(rec: Record<string, unknown>, keys: string[]): { key: string; val: string } {
  for (const key of keys) {
    const value = String(rec[key] ?? "").trim();
    if (value) return { key, val: value };
  }
  return { key: "", val: "" };
}

function recordVendor(rec: Record<string, unknown>) {
  return String(rec._업체명 || rec.업체명 || rec.상호명 || rec.vendor || "").trim();
}

function displayDate(value: unknown) {
  const raw = String(value ?? "").trim();
  const isoDate = raw.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (isoDate) return isoDate;
  const localDate = raw.match(/(\d{4})[./](\d{1,2})[./](\d{1,2})/);
  if (localDate) return `${localDate[1]}-${localDate[2].padStart(2, "0")}-${localDate[3].padStart(2, "0")}`;
  return raw;
}

// 분류 기본 날짜 칸이 비어 있으면(재계약 계약종료일, 초과료 원장 등) 흔한 날짜 칸으로 폴백
function recordDateRaw(cat: string, rec: Record<string, unknown>) {
  const primary = String(rec[DATE_FIELD[cat]] ?? "").trim();
  if (primary) return primary;
  for (const key of ["날짜", "작성일", "입력일", "등록일", "방문일"]) {
    const value = String(rec[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function recordSummary(cat: string, rec: Record<string, unknown>, exclude: string[]) {
  const dateKey = DATE_FIELD[cat];
  const date = displayDate(recordDateRaw(cat, rec));
  const skip = new Set([dateKey, ...exclude]);
  const fields: SummaryField[] = [];
  let album = "";
  for (const [key, value] of Object.entries(rec)) {
    const text = String(value ?? "").trim();
    if (!album) album = text.match(ALBUM_RX)?.[0] || "";
    if (skip.has(key) || key.startsWith("_") || !text) continue;
    fields.push({ key, value: text });
  }
  return { date, fields, album };
}

function recordRegionCode(rec: Record<string, unknown>, hits: VendorHit[]) {
  const direct = pick(rec, REGION_KEYS).val;
  const normalized = normRegion(direct);
  if (REGIONS.includes(normalized)) return normalized;
  const vendor = recordVendor(rec);
  const hit = hits.find((candidate) => candidate.vendor === vendor);
  const fallback = hit ? primaryRegion(hit) : "";
  if (REGIONS.includes(fallback)) return fallback;
  const groupRegions = Array.from(new Set(hits.map(primaryRegion).filter((region) => REGIONS.includes(region))));
  return groupRegions.length === 1 ? groupRegions[0] : "기타";
}

function SearchResult({ hit, onSelect }: { hit: VendorHit; onSelect: (vendor: string) => void }) {
  const normalizedRegion = normRegion(primaryRegion(hit));
  const region = REGIONS.includes(normalizedRegion) ? normalizedRegion : "";
  const categories = CAT_ORDER.filter((cat) => Number(hit.counts?.[cat] || 0) > 0).map((cat) => `${CAT_SHORT[cat]} ${hit.counts[cat]}`);
  let recentDate = "";
  let recentRegion = "";
  Object.values(hit.meta || {}).forEach((entry) => {
    if (entry?.d && entry.d > recentDate) {
      recentDate = entry.d;
      recentRegion = entry.r;
    }
  });
  return <button type="button" onClick={() => onSelect(hit.vendor)} className="block w-full border-b border-slate-100 px-3 py-2.5 text-left last:border-0 hover:bg-slate-50">
    <div className="flex items-center gap-2">
      {region && <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-black text-white">{region}</span>}
      <span className="min-w-0 flex-1 truncate text-sm font-black text-slate-800">{hit.vendor}</span>
      {hit.matchedBy && <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-700">{hit.matchedBy}</span>}
    </div>
    {recentDate && <div className="mt-1 text-[11px] font-semibold text-slate-500">최근 {recentDate}{recentRegion ? ` · ${recentRegion}` : ""}</div>}
    {categories.length > 0 && <div className="mt-0.5 truncate text-[11px] font-semibold text-slate-400">{categories.join(" · ")}</div>}
  </button>;
}

export default function UnifiedHistory({ vendor, accent, open, onClose, onError }: Props) {
  const [queryVendor, setQueryVendor] = useState("");
  const [detail, setDetail] = useState<DetailResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeCat, setActiveCat] = useState("전체");
  const [includedHits, setIncludedHits] = useState<VendorHit[]>([]);
  const [historyRegion, setHistoryRegion] = useState("전체");
  const [historyVendor, setHistoryVendor] = useState("전체");
  const [scopeOpen, setScopeOpen] = useState(false); // 조회 범위는 기본 접힘 — 처음 화면을 단순하게

  const [q, setQ] = useState("");
  const [hits, setHits] = useState<VendorHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [showHits, setShowHits] = useState(false);
  const [searchRegion, setSearchRegion] = useState("전체");
  const requestSequence = useRef(0);
  const loadedFor = useRef("");

  const searchBase = useMemo(() => hits.filter((hit) => CAT_ORDER.some((cat) => Number(hit.counts?.[cat] || 0) > 0)), [hits]);
  const searchRegionTabs = useMemo(() => {
    const hasEtc = searchBase.some((hit) => vendorRegion(hit) === "기타");
    return ["전체", ...REGIONS, ...(hasEtc ? ["기타"] : [])];
  }, [searchBase]);
  const visibleSearchHits = searchRegion === "전체" ? searchBase : searchBase.filter((hit) => vendorRegion(hit) === searchRegion);

  useEffect(() => {
    let active = true;
    if (open) queueMicrotask(() => {
      if (!active) return;
      const initialVendor = vendor.trim();
      loadedFor.current = "";
      setQueryVendor(initialVendor);
      setDetail(null);
      setHits([]);
      setQ(initialVendor);
      setActiveCat("전체");
      setIncludedHits([]);
      setHistoryRegion("전체");
      setHistoryVendor("전체");
      setScopeOpen(false);
      setShowHits(false);
    });
    return () => { active = false; };
  }, [open, vendor]);

  useEffect(() => {
    const query = q.trim();
    if (!open || query.length < 2) return;
    const sequence = ++requestSequence.current;
    const timer = window.setTimeout(() => {
      setSearching(true);
      searchVendorHistoryCandidates(query)
        .then((response) => {
          if (sequence !== requestSequence.current) return;
          setHits(response.results || []);
          setSearchRegion("전체");
        })
        .catch((error) => onError(error.message || "검색 실패"))
        .finally(() => { if (sequence === requestSequence.current) setSearching(false); });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [q, open, onError]);

  useEffect(() => {
    if (!open || !queryVendor || loadedFor.current === queryVendor) return;
    let active = true;
    Promise.resolve()
      .then(() => {
        if (!active) return null;
        setLoading(true);
        setDetail(null);
        return getVendorHistoryDetail(queryVendor);
      })
      .then((result) => {
        if (!active || !result) return;
        setDetail(result.detail);
        setIncludedHits(result.candidates);
        setHistoryRegion("전체");
        setHistoryVendor("전체");
        setActiveCat("전체");
        loadedFor.current = queryVendor;
      })
      .catch((error) => onError(error.message || "통합이력 조회 실패"))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, queryVendor, onError]);

  const allRows = useMemo(() => CAT_ORDER.flatMap((cat) => {
    const rows = Array.isArray(detail?.[cat]) ? detail[cat] as Array<Record<string, unknown>> : [];
    return rows.map((record) => ({ cat, record }));
  }), [detail]);

  const regionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    allRows.forEach(({ record }) => {
      const region = recordRegionCode(record, includedHits);
      counts[region] = (counts[region] || 0) + 1;
    });
    return counts;
  }, [allRows, includedHits]);

  const historyRegionTabs = useMemo(() => ["전체", ...REGIONS.filter((region) => regionCounts[region]), ...(regionCounts.기타 ? ["기타"] : [])], [regionCounts]);

  const rowsForCategory = (cat: string) => {
    const rows = Array.isArray(detail?.[cat]) ? detail[cat] as Array<Record<string, unknown>> : [];
    return rows.filter((record) => {
      if (historyRegion !== "전체" && recordRegionCode(record, includedHits) !== historyRegion) return false;
      if (historyVendor !== "전체" && recordVendor(record) !== historyVendor) return false;
      return true;
    });
  };

  const visibleAliases = useMemo(() => includedHits.filter((hit) => {
    if (historyRegion === "전체") return true;
    return allRows.some(({ record }) => recordVendor(record) === hit.vendor && recordRegionCode(record, includedHits) === historyRegion)
      || vendorRegion(hit) === historyRegion;
  }), [includedHits, historyRegion, allRows]);

  const totalCount = CAT_ORDER.reduce((sum, cat) => sum + rowsForCategory(cat).length, 0);
  const latestDate = displayDate(ACTIVITY_CATS.flatMap((cat) => rowsForCategory(cat).map((record) => recordDateRaw(cat, record))).filter(Boolean).sort().at(-1)) || "없음";
  const records = activeCat === "전체" ? [] : rowsForCategory(activeCat).slice().sort((left, right) => recordDateRaw(activeCat, right).localeCompare(recordDateRaw(activeCat, left)));
  // 접수 탭은 복합기 AS·원격이관·IT를 나눠 볼 수 있다
  const [receptionType, setReceptionType] = useState("전체");
  const visibleRecords = activeCat === "접수" && receptionType !== "전체" ? records.filter((r) => String(r["type"] || "") === receptionType) : records;

  // ── 이번 분기 체크 — 워킨맵·미수·초과·불만(일정리스트 배지와 같은 기준) + 최근 2회 점검으로 사용량·여분 계산
  const [flags, setFlags] = useState<VendorWorkFlags | null>(null);
  useEffect(() => {
    if (!open || !detail) { setFlags(null); return; }
    const names = Array.from(new Set([queryVendor, ...includedHits.map((hit) => hit.vendor)].map((n) => n.trim()).filter(Boolean)));
    if (!names.length) { setFlags(null); return; }
    let active = true;
    getVendorFlagsBatch(names).then((map) => {
      if (!active) return;
      const merged: VendorWorkFlags = { inspection: null, misu: null, renewal: null, overage: null, bulman: null };
      for (const name of names) {
        const f = map.get(name);
        if (!f) continue;
        merged.inspection = merged.inspection || f.inspection;
        merged.misu = merged.misu || f.misu;
        merged.renewal = merged.renewal || f.renewal;
        merged.overage = merged.overage || f.overage;
        merged.bulman = merged.bulman || f.bulman;
      }
      setFlags(merged);
    }).catch(() => { if (active) setFlags(null); });
    return () => { active = false; };
  }, [open, detail, queryVendor, includedHits]);
  const quarterCheck = useMemo(() => {
    const rows = Array.isArray(detail?.["점검"]) ? detail["점검"] as Array<Record<string, unknown>> : [];
    const sorted = [...rows].sort((a, b) => recordDateRaw("점검", b).localeCompare(recordDateRaw("점검", a)));
    // 방문(기록)마다 원문을 기기 블록으로 나눈다 — 원문이 없으면(색인 잔존분) 구조화 컬럼을 1기기로
    type Occur = { date: string; region: string; block: InspBlock };
    const occur: Occur[] = [];
    sorted.forEach((rec) => {
      const date = displayDate(recordDateRaw("점검", rec));
      if (!date) return;
      const region = String(rec["지역"] || "").trim();
      const blocks = parseInspectionBlocks(String(rec["_원문"] || ""));
      const list = blocks.length ? blocks : [{
        loc: "", model: String(rec["모델명"] || "").trim(), serial: String(rec["시리얼넘버"] || "").trim(),
        asset: String(rec["자산기번"] || "").trim(), content: "", handled: "",
        counts: String(rec["매수"] || ""), toner: String(rec["토너잔량"] || ""), waste: String(rec["폐통"] || ""),
        spare: String(rec["여분"] || ""), special: String(rec["특이사항"] || ""),
      }];
      list.forEach((block) => occur.push({ date, region, block }));
    });
    // 기기 정체성은 시리얼이 진짜다 — 기번은 재부여되거나(226951→B8187) 옛 기록에 비어 있다
    const keyOf = (block: InspBlock) => normalizeId(block.serial) || normalizeId(block.asset) || "미기재";
    const byMachine = new Map<string, Occur[]>();
    occur.forEach((entry) => {
      const key = keyOf(entry.block);
      const list = byMachine.get(key) || [];
      list.push(entry);
      byMachine.set(key, list);
    });
    const snapOf = (entry?: Occur) => entry ? {
      date: entry.date, counts: entry.block.counts, toner: entry.block.toner,
      spare: entry.block.spare, waste: entry.block.waste, serial: entry.block.asset,
    } : undefined;
    // 최근 15개월 내 점검된 기기만 현역으로 본다 — 그 전에 끊긴 기번은 교체·반납된 기기
    const cutoff = new Date(Date.now() - 456 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const machines = Array.from(byMachine.entries()).map(([key, occs]) => ({
      key,
      asset: occs[0].block.asset || occs.find((entry) => entry.block.asset)?.block.asset || "",
      serialNo: occs[0].block.serial || occs.find((entry) => entry.block.serial)?.block.serial || "",
      model: occs[0].block.model || occs.find((entry) => entry.block.model)?.block.model || "",
      region: occs[0].region,
      loc: occs[0].block.loc,
      date: occs[0].date,
      visits: occs.length,
      snap: snapOf(occs[0]),
      advice: usageSpareAdvice(snapOf(occs[0]), snapOf(occs[1]), occs[0].block.model),
    })).filter((machine) => machine.date && machine.date >= cutoff && machine.key !== "미기재");
    machines.sort((a, b) => (normRegion(a.region) || "Z").localeCompare(normRegion(b.region) || "Z") || b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
    const activeKeys = new Set(machines.map((machine) => machine.key));
    const retired = occur
      .map((entry) => ({ key: keyOf(entry.block), label: entry.block.asset || entry.block.serial || "", date: entry.date }))
      .find((entry) => entry.key !== "미기재" && !activeKeys.has(entry.key));
    // 여분을 한 기기 칸에 몰아 적는 관행("4층 창고 통합보관") — 같은 방문(날짜)의 다른 기기 칸에서 찾아
    // "기록 없음" 대신 통합보관으로 설명한다. 방문 날짜별로 통합 문구를 모아둔다.
    const latestVisitDate = sorted[0] ? displayDate(recordDateRaw("점검", sorted[0])) : "";
    const communalByDate = new Map<string, string>();
    occur.forEach((entry) => {
      if (/통합/.test(entry.block.spare) && !communalByDate.has(entry.date)) communalByDate.set(entry.date, entry.block.spare);
    });
    const regionSet = new Set(machines.map((machine) => normRegion(machine.region)).filter((region) => REGIONS.includes(region)));
    const latestBlocks = sorted[0] ? parseInspectionBlocks(String(sorted[0]["_원문"] || "")) : [];
    const latestVisit = sorted[0] ? { date: latestVisitDate, region: String(sorted[0]["지역"] || "").trim(), count: latestBlocks.length || 1 } : null;
    const specialRaw = String(sorted[0]?.["특이사항"] || "").trim();
    const special = junkValue(specialRaw) ? "" : specialRaw; // "ㅡㅡㅡ"·"없음" 같은 채움표시 제외
    return { machines, retired, communalByDate, multiRegion: regionSet.size > 1, latestVisit, special };
  }, [detail]);
  // 임대리스트 기기 요약 — 임대중만 세고 복합기/PC/기타 구분, 최근 1년 내 납품/교체 감지
  const [devices, setDevices] = useState<{ mfp: number; pc: number; monitor: number; etc: number; ended: number; recentSwap: string; gu: Record<string, string> } | null>(null);
  useEffect(() => {
    if (!open || !detail) { setDevices(null); return; }
    const names = Array.from(new Set([queryVendor, ...includedHits.map((hit) => hit.vendor)].map((n) => n.trim()).filter((n) => n.length >= 2))).slice(0, 6);
    if (!names.length) { setDevices(null); return; }
    let active = true;
    // "납품/교체일"의 슬래시는 PostgREST select가 못 읽어서 따옴표 별칭(swap:"납품/교체일")으로 우회
    const cols = `${encodeURIComponent("id,품목,임대여부,자산번호,기번")},gu:${encodeURIComponent("\"시/구\"")},swap:${encodeURIComponent("\"납품/교체일\"")}`;
    Promise.all(names.map((name) => selectRows<Record<string, unknown>>("vendor_info",
      `select=${cols}&${encodeURIComponent("_업체명")}=ilike.*${encodeURIComponent(name.slice(0, 24))}*&_hidden=not.is.true&limit=400`).catch(() => [])))
      .then((groups) => {
        if (!active) return;
        const rows = new Map<string, Record<string, unknown>>();
        groups.flat().forEach((row) => rows.set(String(row.id), row));
        const summary = { mfp: 0, pc: 0, monitor: 0, etc: 0, ended: 0, recentSwap: "", gu: {} as Record<string, string> };
        const yearAgo = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
        for (const row of rows.values()) {
          // 지역구(시/구)는 임대종료 행에서도 가져온다 — 기기 위치 표시용
          const guName = String(row["gu"] || "").trim();
          if (guName) {
            for (const ident of [normalizeId(String(row["자산번호"] || "")), normalizeId(String(row["기번"] || ""))]) {
              if (ident && !summary.gu[ident]) summary.gu[ident] = guName;
            }
          }
          if (String(row["임대여부"] || "") !== "임대중") { summary.ended += 1; continue; }
          const item = String(row["품목"] || "");
          if (/복합기|프린터|플로터/.test(item)) summary.mfp += 1;
          else if (/모니터/i.test(item)) summary.monitor += 1; // "PC모니터"가 PC로 합산되면 대수가 부풀어 보인다 — 분리
          else if (/pc|데스크|노트북|태블릿|소프트웨어/i.test(item)) summary.pc += 1;
          else summary.etc += 1;
          // 납품/교체일: "2025-04-03" 또는 엑셀 일련번호("46140") 혼재
          const raw = String(row["swap"] || "").trim();
          const swap = /^\d{5}$/.test(raw)
            ? new Date(Date.UTC(1899, 11, 30) + Number(raw) * 86400000).toISOString().slice(0, 10)
            : (raw.match(/\d{4}-\d{2}-\d{2}/)?.[0] || "");
          if (swap && swap >= yearAgo && swap > summary.recentSwap && swap <= new Date().toISOString().slice(0, 10)) summary.recentSwap = swap;
        }
        setDevices(summary);
      })
      .catch(() => { if (active) setDevices(null); });
    return () => { active = false; };
  }, [open, detail, queryVendor, includedHits]);

  // 개명 업체(이원후 법률사무소→더블유글로리): 이름 검색으론 옛 기록이 안 잡혀 "이전 방문 없음"이 된다.
  // 같은 시리얼의 다른 이름 기록을 찾아 **사용량 비교에만** 쓴다 — 기기가 남의 회사에서 온 것일 수도 있어
  // 자동 병합은 하지 않고, 어떤 이름의 기록과 비교했는지 라벨로 밝힌다. 여분(창고)은 회사 귀속이라 제외.
  const [crossPrev, setCrossPrev] = useState<Record<string, { date: string; counts: string; toner: string; waste: string; name: string }>>({});
  useEffect(() => {
    setCrossPrev({});
    if (!open || !detail) return;
    const targets = quarterCheck.machines.filter((machine) => machine.visits < 2 && normalizeId(machine.serialNo).length >= 6).slice(0, 3);
    if (!targets.length) return;
    let alive = true;
    const included = new Set([queryVendor, ...includedHits.map((hit) => hit.vendor)].map((name) => coreName(name)));
    Promise.all(targets.map(async (machine) => {
      const rows = await selectRows<Record<string, unknown>>("jeomgeom",
        `select=${encodeURIComponent("작성일,매수,토너잔량,폐통,시리얼넘버,_업체명")}&${encodeURIComponent("시리얼넘버")}=ilike.*${encodeURIComponent(machine.serialNo.trim())}*&_hidden=not.is.true&order=${encodeURIComponent("작성일")}.desc&limit=8`).catch(() => [] as Array<Record<string, unknown>>);
      const prev = rows.find((row) => normalizeId(String(row["시리얼넘버"] || "")) === normalizeId(machine.serialNo)
        && displayDate(String(row["작성일"] || "")) < machine.date
        && !included.has(coreName(String(row["_업체명"] || ""))));
      if (!prev) return null;
      return [machine.key, {
        date: displayDate(String(prev["작성일"] || "")), counts: String(prev["매수"] || ""),
        toner: String(prev["토너잔량"] || ""), waste: String(prev["폐통"] || ""), name: String(prev["_업체명"] || "").trim(),
      }] as const;
    })).then((entries) => {
      if (!alive) return;
      const found = entries.filter((entry): entry is NonNullable<typeof entry> => !!entry);
      if (found.length) setCrossPrev(Object.fromEntries(found));
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [open, detail, quarterCheck, queryVendor, includedHits]);

  const selectNewVendor = (nextVendor: string) => {
    setQueryVendor(nextVendor);
    setQ(nextVendor);
    setShowHits(false);
    loadedFor.current = "";
  };

  // 표기만 다른 같은 회사 이름(주식회사 무암=무암)은 매 줄 반복하지 않는다 — 실제 다른 법인명일 때만 표시
  const showVendorOf = (name: string) => includedHits.length > 1 && !!name && coreName(name) !== coreName(queryVendor);

  // 같은 건물·같은 그룹에 법인이 여러 개인 경우(청연 등) — 업종 접두를 뗀 짧은 이름으로 넓혀 검색하는 지름길.
  // 자동으로 합치지는 않는다: 법인이 다르면 미수·초과도 다른 회사 것이라 섞으면 사고다.
  const broaderQuery = useMemo(() => {
    const q = queryVendor.trim();
    const stripped = q
      .replace(/^(세무그룹|세무법인|법무법인|회계법인|법률사무소|특허법인|노무법인|의료법인|주식회사|유한회사|㈜|\(주\))+\s*/, "")
      .replace(/(본사|지사|지점|사옥|타워|빌딩)$/, "")
      .trim();
    return stripped && stripped !== q && stripped.length >= 2 ? stripped : "";
  }, [queryVendor]);

  if (!open) return null;

  return <div className="fixed inset-0 z-[2600] flex items-end bg-slate-950/45 sm:items-center sm:justify-center" onClick={onClose}>
    <div className="flex h-[94vh] w-full flex-col overflow-hidden rounded-t-lg bg-slate-100 shadow-2xl sm:h-[88vh] sm:max-w-4xl sm:rounded-xl" onClick={(event) => event.stopPropagation()}>
      <header className="bg-slate-950 px-4 pb-3.5 pt-4 text-white sm:px-6">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500"><Layers3 size={13} /> 통합이력</div>
            <h2 className="mt-1 truncate text-lg font-black leading-tight sm:text-xl">{queryVendor || "거래처를 검색하세요"}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white"><X size={19} /></button>
        </div>
        {!loading && detail && <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-slate-300">기록 <b className="font-black text-white">{totalCount}</b>건</span>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-slate-300">최근 <b className="font-black text-white">{latestDate}</b></span>
          {includedHits.length > 1 && <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-slate-300">통합 이름 <b className="font-black text-white">{includedHits.length}</b>개</span>}
          {broaderQuery && <button type="button" onClick={() => selectNewVendor(broaderQuery)} className="rounded-full border border-sky-400/40 bg-sky-500/15 px-2.5 py-1 text-[11px] font-black text-sky-300 transition hover:bg-sky-500/25" title="같은 이름을 쓰는 다른 법인·지점까지 함께 검색">"{broaderQuery}" 넓게 보기</button>}
          {(includedHits.length > 1 || historyRegionTabs.length > 2) && (
            <button type="button" onClick={() => setScopeOpen(!scopeOpen)} className="ml-auto flex shrink-0 items-center gap-1 rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-black text-slate-300 transition hover:bg-white/10">
              범위 · {historyRegion === "전체" ? "전체" : historyRegion}{historyVendor !== "전체" ? " · 이름 1개" : ""}
              <ChevronDown size={13} className={`transition ${scopeOpen ? "rotate-180" : ""}`} />
            </button>
          )}
        </div>}
      </header>

      {!loading && detail && scopeOpen && <section className="space-y-3 border-b border-white/10 bg-slate-900 px-3 py-3 sm:px-6">
        <div><div className="mb-1.5 text-[10px] font-black text-slate-500">지역</div><div className="flex gap-1.5 overflow-x-auto pb-0.5">{historyRegionTabs.map((region) => <button key={region} type="button" onClick={() => { setHistoryRegion(region); setHistoryVendor("전체"); setActiveCat("전체"); }} className={`shrink-0 rounded-full px-2.5 py-1.5 text-[11px] font-black transition ${historyRegion === region ? "text-white" : "bg-white/10 text-slate-300 hover:bg-white/15"}`} style={historyRegion === region ? { background: accent } : undefined}>{REGION_LABEL[region] ? `${region} ${REGION_LABEL[region]}` : region}<span className="ml-1 opacity-70">{region === "전체" ? allRows.length : regionCounts[region] || 0}</span></button>)}</div></div>
        <div><div className="mb-1.5 text-[10px] font-black text-slate-500">포함된 거래처 이름</div><div className="flex gap-1.5 overflow-x-auto pb-0.5"><button type="button" onClick={() => { setHistoryVendor("전체"); setActiveCat("전체"); }} className={`shrink-0 rounded-full px-2.5 py-1.5 text-[11px] font-black transition ${historyVendor === "전체" ? "bg-white text-slate-950" : "bg-white/10 text-slate-300 hover:bg-white/15"}`}>전체 이름</button>{visibleAliases.map((hit) => {
          const normalizedAliasRegion = normRegion(primaryRegion(hit));
          const aliasRegion = REGIONS.includes(normalizedAliasRegion) ? normalizedAliasRegion : "-";
          return <button key={hit.vendor} type="button" onClick={() => { setHistoryVendor(hit.vendor); setActiveCat("전체"); }} className={`flex max-w-[260px] shrink-0 items-center rounded-full px-2.5 py-1.5 text-[11px] font-black transition ${historyVendor === hit.vendor ? "bg-white text-slate-950" : "bg-white/10 text-slate-300 hover:bg-white/15"}`}><span className="mr-1 shrink-0 text-[9px] opacity-60">{aliasRegion}</span><span className="truncate">{hit.vendor}</span></button>;
        })}</div></div>
      </section>}

      <div className="relative bg-slate-950 px-3 py-2.5 sm:px-6">
        <Search size={16} className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500 sm:left-9" />
        <input value={q} onChange={(event) => { const value = event.target.value; setQ(value); setHits([]); setShowHits(value.trim().length >= 2); }} onFocus={() => hits.length && setShowHits(true)} placeholder="거래처 이름 검색" className="h-10 w-full rounded-full border border-white/10 bg-white/10 pl-10 pr-4 text-sm font-semibold text-white placeholder:text-slate-500 outline-none transition focus:border-sky-400/50 focus:bg-white/15" />
        {showHits && <div className="absolute left-3 right-3 top-[54px] z-30 max-h-[55vh] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl sm:left-6 sm:right-6">
          {searching && <div className="px-3 py-3 text-xs font-semibold text-slate-400">검색 중...</div>}
          {!searching && searchBase.length > 0 && <div className="flex gap-1 overflow-x-auto border-b border-slate-100 bg-slate-50 px-2 py-2">{searchRegionTabs.map((region) => <button key={region} type="button" onClick={() => setSearchRegion(region)} className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-black ${searchRegion === region ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>{REGION_LABEL[region] ? `${region} ${REGION_LABEL[region]}` : region}</button>)}</div>}
          {!searching && visibleSearchHits.map((hit) => <SearchResult key={hit.vendor} hit={hit} onSelect={selectNewVendor} />)}
          {!searching && visibleSearchHits.length === 0 && <div className="px-3 py-3 text-xs font-semibold text-slate-400">이력이 있는 거래처가 없습니다.</div>}
        </div>}
      </div>

      <nav className="flex gap-1.5 overflow-x-auto bg-slate-950 px-3 pb-3 pt-0.5 sm:px-6">
        <button type="button" onClick={() => setActiveCat("전체")} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-black transition ${activeCat === "전체" ? "bg-white text-slate-950" : "bg-white/10 text-slate-300 hover:bg-white/15"}`}>요약 {totalCount || ""}</button>
        {CAT_ORDER.filter((cat) => rowsForCategory(cat).length > 0).map((cat) => {
          const count = rowsForCategory(cat).length;
          return <button key={cat} type="button" onClick={() => setActiveCat(cat)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-black transition ${activeCat === cat ? "text-white" : "bg-white/10 text-slate-300 hover:bg-white/15"}`} style={activeCat === cat ? { background: accent } : undefined}>{CAT_SHORT[cat]} {count}</button>;
        })}
      </nav>

      <main className="flex-1 overflow-y-auto p-3 sm:p-5">
        {loading && <div className="space-y-3 py-2">
          <div className="h-32 animate-pulse rounded-2xl bg-slate-200/80" />
          <div className="h-60 animate-pulse rounded-2xl bg-slate-200/50" />
          <p className="pt-2 text-center text-xs font-semibold text-slate-400">전체 이력을 모으는 중...</p>
        </div>}
        {!loading && !queryVendor && <div className="py-16 text-center text-sm font-semibold text-slate-400">거래처를 검색해 주세요.</div>}
        {!loading && detail && activeCat === "전체" && (() => {
          // 같은 라벨(여분·사용량)은 한 섹션으로 묶는다 — "점검/여분/사용량/기기/교체"가 딱 나뉘어 읽히도록
          const sections: CheckSection[] = [];
          const add = (label: string, item: CheckItem) => {
            const last = sections[sections.length - 1];
            if (last && last.label === label) last.items.push(item);
            else sections.push({ label, items: [item] });
          };
          const f = flags;
          if (f?.misu) add("미수", f.misu.cleared
            ? { dot: "bg-slate-300", headline: "완납", detail: `${f.misu.date}${f.misu.count > 1 ? ` · 그동안 ${f.misu.count}회 발생` : ""}`, tone: "text-slate-600" }
            : { dot: "bg-rose-500", headline: `잔액 ${f.misu.balance}${f.misu.months ? ` · ${f.misu.months}개월` : ""}`, detail: f.misu.count > 1 ? `누적 ${f.misu.count}회 발생` : "", tone: "text-rose-700", strong: true });
          if (f?.bulman) add("불만", { dot: "bg-rose-500", headline: f.bulman.content, detail: `${f.bulman.date}${f.bulman.count90 > 1 ? ` · 최근 90일 ${f.bulman.count90}건` : ""}`, tone: "text-rose-700", strong: true });
          if (f?.overage) add("초과", { dot: "bg-amber-500", headline: f.overage.total, detail: `${f.overage.date}${f.overage.count12 > 1 ? ` · 12개월 새 ${f.overage.count12}회` : ""}`, tone: "text-amber-800" });
          if (f?.inspection) add("점검", f.inspection.done
            ? { dot: "bg-slate-300", headline: "완료", detail: `${f.inspection.quarter}분기`, tone: "text-slate-600" }
            : f.inspection.carried
              ? { dot: "bg-slate-300", headline: "다음 분기로 이관", tone: "text-slate-600" }
              : { dot: "bg-blue-500", headline: `${f.inspection.quarter}분기 방문 대상`, tone: "text-blue-700" });
          if (f?.renewal) add("재계약", f.renewal.done
            ? { dot: "bg-slate-300", headline: "완료", tone: "text-slate-600" }
            : { dot: "bg-blue-500", headline: `도래${f.renewal.due ? ` · ${f.renewal.due} 종료` : ""}`, tone: "text-blue-700" });
          // 사용량·여분·주의는 원문 블록으로 되살린 기기 단위 — 같은 기번의 직전 방문과 비교
          // ── 사용량/여분: 기기 리스트로 통합 — 지역(A~E)·지역구·층·기종·기번·시리얼, 누르면 분석 펼침 ──
          const machines = quarterCheck.machines;
          const guOf = (machine: typeof machines[number]) => devices?.gu?.[machine.key] || devices?.gu?.[normalizeId(machine.asset)] || "";
          const regionChip = (machine: typeof machines[number]) => {
            const letter = normRegion(machine.region);
            const gu = guOf(machine);
            return [REGIONS.includes(letter) ? letter : "", gu].filter(Boolean).join(" ") || "-";
          };
          const machineTag = (machine: typeof machines[number]) => [regionChip(machine) !== "-" ? regionChip(machine) : "", machine.loc, machine.asset || machine.serialNo].filter(Boolean).join(" · ");
          const usageInfo = (machine: typeof machines[number]) => {
            const usage = machine.advice?.usageLine || "";
            if (usage && !usage.includes("약 0매")) {
              const parsed = usage.match(/^(.*?)\s*\((월평균 약 [\d,]+매)\)\s*$/);
              return parsed ? { head: parsed[2], sub: `${parsed[1]} · 같은 기기 직전 방문 대비`, muted: false } : { head: usage, sub: "", muted: false };
            }
            // 개명 등으로 이름이 달라진 같은 시리얼의 이전 기록 — 비교하되 출처를 밝힌다
            const cross = crossPrev[machine.key];
            if (cross && machine.snap) {
              const crossAdvice = usageSpareAdvice(machine.snap, { date: cross.date, counts: cross.counts, toner: cross.toner, waste: cross.waste, spare: "", serial: machine.snap.serial }, machine.model);
              const crossUsage = crossAdvice?.usageLine || "";
              if (crossUsage && !crossUsage.includes("약 0매")) {
                const parsed = crossUsage.match(/^(.*?)\s*\((월평균 약 [\d,]+매)\)\s*$/);
                const source = `이전 이름 '${cross.name}' ${cross.date} 기록 대비 — 개명·기기이동 여부 확인`;
                return parsed ? { head: parsed[2], sub: `${parsed[1]} · ${source}`, muted: false } : { head: crossUsage, sub: source, muted: false };
              }
              return { head: `같은 기기의 이전 기록이 '${cross.name}' 이름으로 있음`, sub: "개명이면 그 이름으로 검색하면 전체 이력이 보입니다", muted: true };
            }
            return { head: machine.visits < 2 ? "이전 방문 기록 없음 — 비교 불가" : "매수 미기재로 계산 불가", sub: "", muted: true };
          };
          const spareInfo = (machine: typeof machines[number]) => {
            const advice = machine.advice?.adviceLine || "";
            if (!advice) return { head: "여분 분석 대상 아님", sub: "", muted: true };
            const communal = quarterCheck.communalByDate.get(machine.date) || "";
            if (/^여분 기록 없음/.test(advice) && communal) return { head: "통합보관 참조", sub: communal.replace(/\s+/g, " ").slice(0, 70), muted: true };
            const arrow = advice.match(/^현재\s*(.+?)\s*→\s*(.+?)(?:\s*\((.+)\))?\s*$/);
            const dash = advice.match(/^(.+?)\s*—\s*(.+)$/);
            if (arrow) return { head: arrow[2], sub: `현재 ${arrow[1]}${arrow[3] ? ` · ${arrow[3]}` : ""}`, muted: false };
            if (dash) return { head: dash[1], sub: dash[2], muted: false };
            return { head: advice, sub: "", muted: false };
          };
          const regionCountLabel = (() => {
            const counts = new Map<string, number>();
            machines.forEach((machine) => {
              const letter = normRegion(machine.region);
              const key = REGIONS.includes(letter) ? letter : "기타";
              counts.set(key, (counts.get(key) || 0) + 1);
            });
            return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([letter, count]) => `${letter} ${count}대`).join(" · ");
          })();
          machines.forEach((machine) => {
            if (machine.advice?.warning) add("주의", { dot: "bg-amber-500", headline: machine.advice.warning, tone: "text-amber-800", tag: machineTag(machine) });
          });
          if (quarterCheck.special) add("특이", { dot: "bg-rose-400", headline: quarterCheck.special, detail: quarterCheck.latestVisit ? `${quarterCheck.latestVisit.date} 점검 기록` : "", tone: "text-rose-700" });
          if (devices && devices.mfp + devices.pc + devices.monitor + devices.etc > 0) {
            const parts = [devices.mfp && `복합기 ${devices.mfp}`, devices.pc && `PC ${devices.pc}`, devices.monitor && `모니터 ${devices.monitor}`, devices.etc && `기타 ${devices.etc}`].filter(Boolean).join(" · ");
            add("기기", { dot: "bg-slate-400", headline: `임대중 ${parts}`, detail: `${devices.ended ? `종료 ${devices.ended}대 제외 · ` : ""}${machines.length ? `최근 점검에서 ${machines.length}대 확인` : ""}`.replace(/ · $/, ""), tone: "text-slate-700" });
          }
          // 납품인지 교체인지는 시트가 한 칸에 적어 구분이 없다 — 점검 기기(시리얼) 변화가 있으면 "교체"로 확정해 준다
          if (devices?.recentSwap || quarterCheck.retired) add("교체", {
            dot: "bg-indigo-500",
            headline: devices?.recentSwap ? `${devices.recentSwap} 납품/교체` : "기기 교체된 것으로 보임",
            detail: quarterCheck.retired
              ? `점검 기기 ${quarterCheck.retired.label} → ${quarterCheck.machines[0]?.asset || quarterCheck.machines[0]?.serialNo || "?"} 변경 (이전 기기 마지막 점검 ${quarterCheck.retired.date})`
              : "최근 1년 내 · 임대리스트 납품/교체일 기준",
            tone: "text-indigo-700",
          });
          const TINT: Record<string, string> = { "bg-rose-500": "bg-rose-50/70", "bg-amber-500": "bg-amber-50/60" };
          return <section className="mb-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-2 bg-slate-900 px-4 py-2.5 sm:px-5">
              <h3 className="text-[14px] font-black text-white">이번 분기 체크</h3>
              <span className="text-[10px] font-bold text-slate-500">워킨맵 · 미수 · 초과 · 불만 · 기기별 최근 점검 기준</span>
            </div>
            <div className="divide-y divide-slate-100">
              {(sections.length || machines.length) ? <>
                {sections.filter((sec) => ["미수", "불만", "초과", "점검", "재계약"].includes(sec.label)).map((sec) => (
                  <CheckSectionRow key={sec.label} sec={sec} tint={TINT} />
                ))}
                {machines.length > 0 && <div className="flex gap-3 px-4 py-2.5 sm:px-5">
                  <span className="w-12 shrink-0 pt-1 text-[11px] font-black leading-4 text-slate-400">사용량<br />여분</span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 text-[11px] font-bold text-slate-400">기기 {machines.length}대{regionCountLabel ? ` — ${regionCountLabel}` : ""} · 누르면 기기별 사용량·여분 분석</div>
                    <div className="space-y-1.5">
                      {machines.map((machine) => {
                        const usage = usageInfo(machine);
                        const spare = spareInfo(machine);
                        return <details key={machine.key} className="group/machine overflow-hidden rounded-lg border border-slate-200">
                          <summary className="flex cursor-pointer list-none items-center gap-2 bg-slate-50/80 px-2.5 py-2 transition hover:bg-slate-100 [&::-webkit-details-marker]:hidden">
                            <span className="shrink-0 rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-black text-white">{regionChip(machine)}</span>
                            {machine.loc && <span className="shrink-0 rounded bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{machine.loc}</span>}
                            <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-slate-800" title={`${machine.model} ${machine.asset} ${machine.serialNo}`}>
                              {machine.model || "기종 미상"}{machine.asset ? ` · ${machine.asset}` : ""}{machine.serialNo ? <span className="font-medium text-slate-400"> · {machine.serialNo}</span> : null}
                            </span>
                            <ChevronDown size={14} className="shrink-0 text-slate-400 transition group-open/machine:rotate-180" />
                          </summary>
                          <div className="space-y-2 border-t border-slate-100 bg-white px-3 py-2.5">
                            <div className="flex gap-2.5">
                              <span className="w-10 shrink-0 pt-0.5 text-[10.5px] font-black text-slate-400">사용량</span>
                              <div className="min-w-0 flex-1">
                                <div className={`text-[13px] font-bold ${usage.muted ? "text-slate-400" : "text-slate-800"}`}>{usage.head}</div>
                                {usage.sub && <div className="mt-0.5 text-[11.5px] font-medium text-slate-400">{usage.sub}</div>}
                              </div>
                            </div>
                            <div className="flex gap-2.5">
                              <span className="w-10 shrink-0 pt-0.5 text-[10.5px] font-black text-slate-400">여분</span>
                              <div className="min-w-0 flex-1">
                                <div className={`text-[13px] font-bold ${spare.muted ? "text-slate-500" : "text-emerald-700"}`}>{spare.head}</div>
                                {spare.sub && <div className="mt-0.5 text-[11.5px] font-medium text-slate-400">{spare.sub}</div>}
                              </div>
                            </div>
                            <div className="text-[10.5px] font-medium text-slate-400">최근 점검 {machine.date} · 방문 기록 {machine.visits}회</div>
                          </div>
                        </details>;
                      })}
                    </div>
                  </div>
                </div>}
                {sections.filter((sec) => !["미수", "불만", "초과", "점검", "재계약"].includes(sec.label)).map((sec) => (
                  <CheckSectionRow key={sec.label} sec={sec} tint={TINT} />
                ))}
              </> : <div className="px-4 py-5 text-xs font-semibold text-slate-400 sm:px-5">이번 분기에 특별히 체크할 항목이 없습니다.</div>}
            </div>
            {quarterCheck.latestVisit && <div className="truncate border-t border-slate-100 bg-slate-50/60 px-4 py-2 text-[11px] font-medium tabular-nums text-slate-400 sm:px-5">최근 점검 {quarterCheck.latestVisit.date}{REGION_LABEL[normRegion(quarterCheck.latestVisit.region)] ? ` · ${REGION_LABEL[normRegion(quarterCheck.latestVisit.region)]}` : ""} · 기기 {quarterCheck.latestVisit.count}대 방문</div>}
          </section>;
        })()}
        {!loading && detail && activeCat === "전체" && (() => {
          // 분류별 "최신 1건" 나열 대신, 모든 분류를 합친 최근 활동 타임라인 — 무슨 일이 있었는지가 한 흐름으로 읽힌다
          const CAT_TONE: Record<string, string> = { 접수: "bg-blue-50 text-blue-700", 점검: "bg-emerald-50 text-emerald-700", AS: "bg-indigo-50 text-indigo-700", 초과: "bg-amber-50 text-amber-800", 미수: "bg-rose-50 text-rose-700", 불만: "bg-red-50 text-red-700", 복합기확장성: "bg-slate-100 text-slate-600", PC확장성: "bg-slate-100 text-slate-600" };
          const CAT_DOT: Record<string, string> = { 접수: "bg-blue-500", 점검: "bg-emerald-500", AS: "bg-indigo-500", 초과: "bg-amber-500", 미수: "bg-rose-500", 불만: "bg-red-500", 복합기확장성: "bg-slate-400", PC확장성: "bg-slate-400" };
          const recent = ACTIVITY_CATS.flatMap((cat) => rowsForCategory(cat).map((record) => {
            const date = displayDate(recordDateRaw(cat, record));
            const summary = recordSummary(cat, record, [...REGION_KEYS]);
            const preview = (priorityPreview(cat, record) || summary.fields.slice(0, 2).map((field) => field.value).join(" · ")).replace(/\s+/g, " ").slice(0, 80);
            return { cat, date, preview, vendorName: recordVendor(record) || "" };
          })).filter((item) => item.date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
          return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-2 px-4 py-3 sm:px-5"><h3 className="text-[15px] font-black text-slate-950">최근 활동</h3><span className="text-[10px] font-bold text-slate-400">누르면 그 분류의 전체 기록이 열립니다</span></div>
            <div className="divide-y divide-slate-50 border-t border-slate-100">
              {recent.map((item, index) => (
                <button key={`${item.cat}-${item.date}-${index}`} type="button" onClick={() => setActiveCat(item.cat)} className="group flex w-full items-center gap-2.5 px-4 text-left transition hover:bg-slate-50 sm:px-5">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${CAT_DOT[item.cat] || "bg-slate-400"}`} />
                  <span className="w-[64px] shrink-0 py-2.5 text-[11.5px] font-semibold tabular-nums text-slate-500">{item.date.slice(2)}</span>
                  <span className="min-w-0 flex-1 truncate py-2.5 text-[13px] font-medium text-slate-800" title={item.preview}>
                    {showVendorOf(item.vendorName) && <span className="font-normal text-slate-400">{item.vendorName} · </span>}
                    {item.preview || "-"}
                  </span>
                  <span className={`w-12 shrink-0 rounded-md px-1.5 py-0.5 text-center text-[10px] font-black ${CAT_TONE[item.cat] || "bg-slate-100 text-slate-600"}`}>{CAT_SHORT[item.cat]}</span>
                  <ChevronRight size={14} className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" />
                </button>
              ))}
              {!recent.length && <div className="px-4 py-10 text-center text-sm font-semibold text-slate-400">기록이 없습니다 — 검색어를 줄이거나 "넓게 보기"를 눌러 보세요.</div>}
            </div>
          </section>;
        })()}

        {!loading && detail && activeCat !== "전체" && <section className="space-y-2">
          <div className="flex items-end justify-between px-1 pb-1"><div><h3 className="text-[15px] font-black text-slate-950">{CAT_SHORT[activeCat]} 이력</h3><p className="mt-0.5 text-[11px] font-semibold text-slate-500">최신순 · 항목을 누르면 전체 내용이 열립니다.</p></div><span className="text-xs font-black text-slate-500">{visibleRecords.length}건</span></div>
          {activeCat === "접수" && <div className="flex flex-wrap gap-1.5 px-1 pb-2">
            {["전체", "복합기 AS", "원격이관", "IT"].map((t) => {
              const count = t === "전체" ? records.length : records.filter((r) => String(r["type"] || "") === t).length;
              return <button key={t} type="button" onClick={() => setReceptionType(t)} className={`rounded-full px-3 py-1.5 text-xs font-black transition ${receptionType === t ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>{t} <span className="opacity-60">{count}</span></button>;
            })}
          </div>}
          {visibleRecords.map((record, index) => {
            const who = pick(record, WHO_KEYS);
            const directRegion = pick(record, REGION_KEYS);
            const region = recordRegionCode(record, includedHits);
            const vendorName = recordVendor(record) || queryVendor;
            const { date, fields, album } = recordSummary(activeCat, record, [who.key, directRegion.key]);
            // 같은 업체 기록 목록에서 업체명을 제목으로 반복하면 내용이 안 보인다 — 대표 문장이 제목
            const title = priorityPreview(activeCat, record) || vendorName;
            // 한 방문에 기기 여러 대(원문 블록) — 첫 기기(구조화 컬럼)만 보여주면 나머지 기기가 사라진다
            const blocks = (activeCat === "점검" || activeCat === "AS") ? parseInspectionBlocks(String(record["_원문"] || "")) : [];
            return <details key={`${vendorName}-${date}-${index}`} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:border-slate-300">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-3 [&::-webkit-details-marker]:hidden sm:px-4">
                <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50">
                  <span className="text-[9px] font-black leading-none text-rose-500">{date ? `${Number(date.slice(5, 7))}월` : "-"}</span>
                  <span className="mt-0.5 text-[15px] font-black leading-none tabular-nums text-slate-900">{date ? date.slice(8, 10) : "--"}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-black text-slate-900" title={title}>{title}</span>
                  <span className="mt-1 flex items-center gap-2 text-[10.5px] font-medium text-slate-500">
                    {date && <span className="shrink-0 tabular-nums">{date}</span>}
                    {activeCat === "접수" && !!record["type"] && <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 font-black text-blue-700">{String(record["type"])}</span>}
                    <span className="flex shrink-0 items-center gap-0.5"><MapPin size={11} />{region}</span>
                    {blocks.length > 1 && <span className="shrink-0 rounded-full bg-slate-900 px-2 py-0.5 font-black text-white">기기 {blocks.length}대</span>}
                    {who.val && <span className="flex min-w-0 items-center gap-0.5 truncate"><UserRound size={11} />{who.val}</span>}
                    {showVendorOf(vendorName) && <span className="min-w-0 truncate text-slate-400">{vendorName}</span>}
                  </span>
                </span>
                <ChevronDown size={17} className="shrink-0 text-slate-400 transition group-open:rotate-180" />
              </summary>
              <div className="border-t border-slate-200 bg-slate-50">
                {(() => {
                  const clean = fields.filter((field) => !junkValue(field.value));
                  const priority = PRIORITY_FIELDS[activeCat] || [];
                  const mains = priority.map((key) => clean.find((field) => field.key === key)).filter((field): field is SummaryField => !!field);
                  // 기기 여러 대 방문: 구조화 컬럼(첫 기기) 대신 원문 블록을 기기별로 보여준다
                  const machineKeys = new Set(["모델명", "시리얼넘버", "자산기번", "내용", "처리내용", "매수", "토너잔량", "폐통", "여분", "특이사항"]);
                  const rest = clean.filter((field) => !priority.includes(field.key) && !(blocks.length > 1 && machineKeys.has(field.key)));
                  if (blocks.length > 1) return <>
                    <div className="bg-white px-4 pt-2.5 text-[11px] font-black text-slate-500 sm:px-5">이 방문에서 점검한 기기 {blocks.length}대</div>
                    <div className="divide-y divide-slate-100 bg-white px-4 sm:px-5">
                      {blocks.map((block, blockIndex) => (
                        <div key={`${block.asset}-${blockIndex}`} className="py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded-md bg-slate-900 px-2 py-0.5 text-[11px] font-black text-white">{block.asset || block.serial || `기기 ${blockIndex + 1}`}</span>
                            {block.model && <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{block.model}</span>}
                            {block.loc && <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{block.loc}</span>}
                            {block.serial && block.asset && <span className="text-[10px] font-semibold text-slate-400">{block.serial}</span>}
                          </div>
                          {([["처리내용", block.handled || block.content], ["매수", block.counts], ["토너잔량", block.toner], ["폐통", block.waste], ["여분", block.spare], ["특이사항", block.special]] as const)
                            .filter(([, value]) => value && !junkValue(value)).map(([label, value]) => (
                            <div key={label} className="mt-1.5 flex gap-3">
                              <span className="w-16 shrink-0 pt-0.5 text-[11px] font-bold text-slate-400">{label}</span>
                              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[13px] font-medium leading-5 text-slate-800">{value}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                    {rest.length > 0 && (
                      <details className="border-t border-slate-100 bg-slate-50/60 px-4 py-2">
                        <summary className="cursor-pointer text-[11px] font-black text-slate-400 hover:text-slate-600">그 외 정보 {rest.length}개 보기</summary>
                        <div className="grid gap-x-6 gap-y-2 py-2 sm:grid-cols-2">
                          {rest.map((field, fieldIndex) => (
                            <div key={`${field.key}-${fieldIndex}`} className="min-w-0">
                              <div className="text-[10px] font-bold text-slate-400">{fieldLabel(field.key)}</div>
                              <div className="whitespace-pre-wrap break-words text-[12px] font-normal leading-5 text-slate-600">{field.value}</div>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </>;
                  return <>
                    <div className="divide-y divide-slate-100 bg-white px-4">
                      {mains.map((field) => (
                        <div key={field.key} className="flex gap-3 py-2.5">
                          <span className="w-16 shrink-0 pt-0.5 text-[11px] font-bold text-slate-400">{fieldLabel(field.key)}</span>
                          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[13.5px] font-medium leading-6 text-slate-800">{field.value}</span>
                        </div>
                      ))}
                      {!mains.length && !rest.length && <div className="py-5 text-center text-xs font-semibold text-slate-400">표시할 상세 내용이 없습니다.</div>}
                    </div>
                    {rest.length > 0 && (
                      <details className="border-t border-slate-100 bg-slate-50/60 px-4 py-2">
                        <summary className="cursor-pointer text-[11px] font-black text-slate-400 hover:text-slate-600">그 외 정보 {rest.length}개 보기</summary>
                        <div className="grid gap-x-6 gap-y-2 py-2 sm:grid-cols-2">
                          {rest.map((field, fieldIndex) => (
                            <div key={`${field.key}-${fieldIndex}`} className="min-w-0">
                              <div className="text-[10px] font-bold text-slate-400">{fieldLabel(field.key)}</div>
                              <div className="whitespace-pre-wrap break-words text-[12px] font-normal leading-5 text-slate-600">{field.value}</div>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </>;
                })()}
                <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-[10px] font-bold text-slate-500"><Clock3 size={13} />{date || "날짜 없음"}<span>·</span><Building2 size={13} />{vendorName}{album && <a href={album} target="_blank" rel="noreferrer" className="ml-auto rounded-full bg-slate-900 transition hover:bg-slate-800 px-3 py-1.5 text-white">사진·영상 보기</a>}</div>
              </div>
            </details>;
          })}
          {!records.length && <div className="rounded-xl border border-slate-200 bg-white py-12 text-center text-sm font-semibold text-slate-400">선택한 범위에 이력이 없습니다.</div>}
        </section>}
      </main>
    </div>
  </div>;
}
