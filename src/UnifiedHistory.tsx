import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { getVendorFlagsBatch, resetVendorFlagsCache, type VendorWorkFlags } from "./vendorFlags";
import { normalizeId, parseInspectionBlocks, vendorMatchKey, type InspBlock } from "./ids";
import { deleteRows, insertRow, selectRows, updateRows } from "./supabase";
import { notify } from "./toast";

/**
 * 특이사항 본문 렌더 — 노션에서 이관한 글에는 사진·파일이 마크다운 링크로 들어있다.
 * 그냥 pre-wrap으로 뿌리면 "![image.png](https://…)" 원문이 그대로 보여 읽을 수 없다(사용자 지적).
 * 사진은 이미지로, 파일·링크는 버튼으로, 나머지는 줄바꿈 살린 글로 그린다.
 */
function NoteBody({ text }: { text: string }) {
  const lines = String(text || "").split("\n");
  const out: ReactNode[] = [];
  let buffer: string[] = [];
  const flush = () => {
    if (!buffer.length) return;
    const chunk = buffer.join("\n").trim();
    if (chunk) out.push(<p key={`t-${out.length}`} className="whitespace-pre-wrap text-[13.5px] font-bold leading-6 text-slate-900">{chunk}</p>);
    buffer = [];
  };
  for (const line of lines) {
    const trimmed = line.trim();
    const image = trimmed.match(/^!\[[^\]]*\]\(([^)]+)\)$/);
    const link = trimmed.match(/^\[([^\]]*)\]\((https?:[^)]+)\)$/);
    if (image) {
      flush();
      out.push(
        <a key={`i-${out.length}`} href={image[1]} target="_blank" rel="noreferrer" className="block">
          <img src={image[1]} alt="" loading="lazy" className="max-h-[320px] rounded-xl border border-violet-200" />
        </a>,
      );
    } else if (link) {
      flush();
      out.push(
        <a key={`l-${out.length}`} href={link[2]} target="_blank" rel="noreferrer"
          className="inline-block rounded-full border border-violet-200 bg-white px-3 py-1.5 text-[12px] font-black text-violet-700">
          📎 {link[1] || "첨부"}
        </a>,
      );
    } else {
      buffer.push(line);
    }
  }
  flush();
  return <div className="space-y-2">{out}</div>;
}

type Props = {
  vendor: string;
  accent: string;
  open: boolean;
  onClose: () => void;
  onError: (msg: string) => void;
  author?: string; // 특이사항을 누가 적었는지 남기기 위함
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

// 원문 블록 파싱은 무겁다 — 같은 기록 객체는 한 번만 파싱 (목록 렌더·검색 타이핑마다 재파싱 방지)
const blocksCache = new WeakMap<object, InspBlock[]>();
function cachedBlocks(rec: Record<string, unknown>): InspBlock[] {
  const hit = blocksCache.get(rec);
  if (hit) return hit;
  const parsed = parseInspectionBlocks(String(rec["_원문"] || ""));
  blocksCache.set(rec, parsed);
  return parsed;
}


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

export default function UnifiedHistory({ vendor, accent, open, onClose, onError, author = "" }: Props) {
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
  // 부모가 인라인 함수를 넘겨도 검색이 재발사되지 않게 — 최신 콜백만 ref로 들고 deps에서 뺀다
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

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
      setReceptionType("전체"); // 이전 업체의 접수 유형 필터가 새 업체에 남지 않게
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
        .catch((error) => onErrorRef.current(error.message || "검색 실패"))
        .finally(() => { if (sequence === requestSequence.current) setSearching(false); });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [q, open]);

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
      .catch((error) => onErrorRef.current(error.message || "통합이력 조회 실패"))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, queryVendor]);

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
      // 업체정보는 지금 사용 중(임대중)인 기기만 — 종료·소송 이력은 통합이력에선 소음이다
      if (cat === "업체정보" && String(record["임대여부"] || "") !== "임대중") return false;
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
  // 거래처 특이사항 편집 — null이면 보기 모드
  const [noteEdit, setNoteEdit] = useState<string | null>(null);
  const [noteHours, setNoteHours] = useState({ work: "", lunch: "" }); // 출근·점심 — 같은 틀에서 함께 기재
  const [noteAdd, setNoteAdd] = useState("");   // 항목 추가 — 쓸 때마다 날짜·작성자를 붙여 본문 끝에 쌓는다
  const [noteBusy, setNoteBusy] = useState(false);
  useEffect(() => { setNoteEdit(null); setNoteAdd(""); }, [queryVendor]); // 다른 업체로 옮기면 편집 상태 해제
  /**
   * 특이사항 항목 추가 — 규칙은 시간이 지나며 쌓인다(카드키 → 주차 → 담당자 변경…).
   * 전체 수정은 "최종 수정일" 하나만 남아 언제 생긴 규칙인지 알 수 없었다(사용자 지적) →
   * 추가한 항목마다 날짜·작성자를 앞에 붙여 본문 끝에 이어 붙인다.
   */
  const appendVendorNote = async () => {
    const text = noteAdd.trim();
    if (!text || noteBusy) return;
    const key = vendorMatchKey(queryVendor);
    if (!key) { notify("업체를 먼저 선택하세요.", "error"); return; }
    const kst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    const stamp = `[${Number(kst.slice(5, 7))}/${Number(kst.slice(8, 10))} ${author || "미지정"}]`;
    const prev = (flags?.note?.text || "").trim();
    const merged = prev ? `${prev}\n${stamp} ${text}` : `${stamp} ${text}`;
    const ids = flags?.note?.ids || [];
    setNoteBusy(true);
    try {
      if (ids.length) {
        await updateRows("vendor_notes", `id=eq.${ids[0]}`, { note: merged, author: author || "미지정", updated_at: new Date().toISOString() });
        if (ids.length > 1) await deleteRows("vendor_notes", `id=in.(${ids.slice(1).map((id) => `"${id}"`).join(",")})`);
      } else {
        await insertRow("vendor_notes", { vendor: queryVendor.slice(0, 120), vendor_key: key, note: merged, author: author || "미지정", source: "webapp" });
      }
      const blank: VendorWorkFlags = { inspection: null, misu: null, renewal: null, overage: null, bulman: null, note: null };
      setFlags((cur) => {
        const base = cur || blank;
        return { ...base, note: { text: merged, grade: base.note?.grade || "", count: 1, ids: ids.length ? [ids[0]] : [],
          workStart: base.note?.workStart || "", lunchTime: base.note?.lunchTime || "",
          author: author || "미지정", updatedAt: kst } };
      });
      resetVendorFlagsCache();
      setNoteAdd("");
      notify("특이사항에 추가했습니다 ✓");
    } catch (e) {
      notify(`추가 실패: ${(e as Error).message}`, "error");
    } finally {
      setNoteBusy(false);
    }
  };

  /**
   * 특이사항 저장 — 화면에 보이던 그 행(flags.note.ids)만 고친다.
   * 표시는 별칭·부분일치까지 끌어와 여러 행을 이어 붙여 보여주므로, 새 행을 덧쓰면 같은 내용이
   * 계속 중복 누적되고("리본즈" 2행 사례) 지울 때는 일부만 지워져 메모가 남는다.
   */
  const saveVendorNote = async () => {
    if (noteEdit === null || noteBusy) return;
    const text = noteEdit.trim();
    const key = vendorMatchKey(queryVendor);
    if (!key) { notify("업체를 먼저 선택하세요.", "error"); return; }
    const ids = flags?.note?.ids || [];
    const hours = { work: noteHours.work.trim(), lunch: noteHours.lunch.trim() };
    const hasHours = !!hours.work || !!hours.lunch;
    setNoteBusy(true);
    try {
      if (!text && !hasHours) {
        if (ids.length) await deleteRows("vendor_notes", `id=in.(${ids.map((id) => `"${id}"`).join(",")})`);
        notify(ids.length ? "특이사항을 지웠습니다." : "적을 내용이 없습니다 — 특이사항이나 출근·점심시간을 입력하세요.", ids.length ? "success" : "error");
      } else if (ids.length) {
        // 여러 행이 합쳐져 보이던 경우: 첫 행에 합본을 남기고 나머지 행은 지운다(중복 방지)
        await updateRows("vendor_notes", `id=eq.${ids[0]}`, { note: text, work_start: hours.work, lunch_time: hours.lunch, author: author || "미지정", updated_at: new Date().toISOString() });
        if (ids.length > 1) await deleteRows("vendor_notes", `id=in.(${ids.slice(1).map((id) => `"${id}"`).join(",")})`);
        notify("특이사항을 저장했습니다 ✓");
      } else {
        await insertRow("vendor_notes", { vendor: queryVendor.slice(0, 120), vendor_key: key, note: text, work_start: hours.work, lunch_time: hours.lunch, author: author || "미지정", source: "webapp" });
        notify("특이사항을 등록했습니다 ✓");
      }
      // flags가 null이어도 낙관적 표시가 유지되게 기본 객체로 시작한다 (저장했는데 '없음'으로 돌아가 보이던 문제)
      const blank: VendorWorkFlags = { inspection: null, misu: null, renewal: null, overage: null, bulman: null, note: null };
      setFlags((cur) => {
        const base = cur || blank;
        if (!text && !hasHours) return { ...base, note: null };
        const keepIds = ids.length ? [ids[0]] : [];
        return { ...base, note: { text, grade: base.note?.grade || "", count: 1, ids: keepIds,
          workStart: hours.work, lunchTime: hours.lunch,
          author: author || "미지정", updatedAt: new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10) } };
      });
      resetVendorFlagsCache(); // 다음 화면 진입 때 배지·목록이 새 내용으로 (이미 떠 있는 화면은 재진입 후 반영)
      setNoteEdit(null);
      if (!ids.length && (text || hasHours)) void getVendorFlagsBatch([queryVendor]).catch(() => undefined); // 새로 만든 행의 id를 다음 조회에서 확보
    } catch (e) {
      notify(`저장 실패: ${(e as Error).message}`, "error");
    } finally {
      setNoteBusy(false);
    }
  };
  useEffect(() => {
    if (!open || !detail) { setFlags(null); return; }
    const names = Array.from(new Set([queryVendor, ...includedHits.map((hit) => hit.vendor)].map((n) => n.trim()).filter(Boolean)));
    if (!names.length) { setFlags(null); return; }
    let active = true;
    getVendorFlagsBatch(names).then((map) => {
      if (!active) return;
      const merged: VendorWorkFlags = { inspection: null, misu: null, renewal: null, overage: null, bulman: null, note: null };
      for (const name of names) {
        const f = map.get(name);
        if (!f) continue;
        merged.inspection = merged.inspection || f.inspection;
        merged.misu = merged.misu || f.misu;
        merged.renewal = merged.renewal || f.renewal;
        merged.overage = merged.overage || f.overage;
        merged.bulman = merged.bulman || f.bulman;
        merged.note = merged.note || f.note;
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
      const blocks = cachedBlocks(rec);
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
    })).filter((machine) => machine.date && machine.date >= cutoff && machine.key !== "미기재");
    machines.sort((a, b) => (normRegion(a.region) || "Z").localeCompare(normRegion(b.region) || "Z") || b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
    const activeKeys = new Set(machines.map((machine) => machine.key));
    const retired = occur
      .map((entry) => ({ key: keyOf(entry.block), label: entry.block.asset || entry.block.serial || "", date: entry.date }))
      .find((entry) => entry.key !== "미기재" && !activeKeys.has(entry.key));
    // 시트-현장 대조용: 식별자(기번·시리얼)별 마지막 목격일과 방문일 목록
    const identLastSeen = new Map<string, string>();
    occur.forEach((entry) => {
      for (const ident of [normalizeId(entry.block.asset), normalizeId(entry.block.serial)]) {
        if (ident && (identLastSeen.get(ident) || "") < entry.date) identLastSeen.set(ident, entry.date);
      }
    });
    const visitDates = Array.from(new Set(occur.map((entry) => entry.date))).sort().reverse();
    const latestVisitDate = sorted[0] ? displayDate(recordDateRaw("점검", sorted[0])) : "";
    const regionSet = new Set(machines.map((machine) => normRegion(machine.region)).filter((region) => REGIONS.includes(region)));
    const latestBlocks = sorted[0] ? cachedBlocks(sorted[0]) : [];
    const latestVisit = sorted[0] ? { date: latestVisitDate, region: String(sorted[0]["지역"] || "").trim(), count: latestBlocks.length || 1 } : null;
    const specialRaw = String(sorted[0]?.["특이사항"] || "").trim();
    const special = junkValue(specialRaw) ? "" : specialRaw; // "ㅡㅡㅡ"·"없음" 같은 채움표시 제외
    return { machines, retired, multiRegion: regionSet.size > 1, latestVisit, special, identLastSeen, visitDates };
  }, [detail]);
  // 임대리스트 기기 요약 — 임대중만 세고 복합기/PC/기타 구분, 최근 1년 내 납품/교체 감지
  const [devices, setDevices] = useState<{ mfp: number; pc: number; monitor: number; etc: number; ended: number; recentSwap: string; gu: Record<string, string>; endedIdents: Record<string, true>; mfpActive: Array<{ asset: string; idents: string[] }> } | null>(null);
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
        const summary = { mfp: 0, pc: 0, monitor: 0, etc: 0, ended: 0, recentSwap: "", gu: {} as Record<string, string>, endedIdents: {} as Record<string, true>, mfpActive: [] as Array<{ asset: string; idents: string[] }> };
        const yearAgo = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
        for (const row of rows.values()) {
          // 지역구(시/구)는 임대종료 행에서도 가져온다 — 기기 위치 표시용
          const guName = String(row["gu"] || "").trim();
          if (guName) {
            for (const ident of [normalizeId(String(row["자산번호"] || "")), normalizeId(String(row["기번"] || ""))]) {
              if (ident && !summary.gu[ident]) summary.gu[ident] = guName;
            }
          }
          if (String(row["임대여부"] || "") !== "임대중") {
            summary.ended += 1;
            // 반납·종료된 기기의 기번·자산번호 — 점검 기록엔 남아 있어도 "현역"으로 세면 안 된다
            for (const ident of [normalizeId(String(row["자산번호"] || "")), normalizeId(String(row["기번"] || ""))]) {
              if (ident) summary.endedIdents[ident] = true;
            }
            continue;
          }
          const item = String(row["품목"] || "");
          if (/복합기|프린터|플로터/.test(item)) {
            summary.mfp += 1;
            // 시트-현장 대조 대상: 임대중 복합기의 자산번호·기번 (세단기·PC는 점검 기록에 안 나와 오탐)
            summary.mfpActive.push({ asset: String(row["자산번호"] || "").trim(), idents: [normalizeId(String(row["자산번호"] || "")), normalizeId(String(row["기번"] || ""))].filter(Boolean) });
          }
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
        {/* 거래처 특이사항 — 방문 규칙·출입·유무상 범위 등 "그 업체 고유"의 사항. 그날 기기 메모(방문 메모)와 다른 층이라
            맨 위에 세우고, 누구나 바로 고칠 수 있게 한다(현장에서 알게 된 규칙이 바로 쌓이도록). */}
        {!loading && queryVendor && activeCat === "전체" && (flags?.note || noteEdit !== null) && (
          <section className="mb-3 overflow-hidden rounded-2xl border-2 border-violet-300 bg-violet-50/50 shadow-sm">
            {/* 모바일에서 부제가 제목 밑으로 지저분하게 꺾여 내려왔다(사용자 지적) →
                좁은 화면에서는 부제를 숨기고 제목만, 넓은 화면에서만 부제를 오른쪽에 둔다 */}
            <div className="flex items-center justify-between gap-2 bg-violet-700 px-4 py-2 sm:px-5">
              <h3 className="text-[13.5px] font-black text-white">📌 거래처 특이사항</h3>
              <span className="hidden shrink-0 text-[10px] font-bold text-violet-200 lg:inline">방문 규칙·출입·유무상 범위 — 그날 기기 상태는 아래 방문 메모</span>
            </div>
            {noteEdit === null ? (
              <div className="px-4 py-3.5 sm:px-5">
                {/* 출근·점심은 방문 시각을 정하는 값이라 본문 위에 칩으로 먼저 보여준다 */}
                {(flags?.note?.workStart || flags?.note?.lunchTime) && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {flags?.note?.workStart && <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-violet-700 ring-1 ring-violet-200">🕘 출근 {flags.note.workStart}</span>}
                    {flags?.note?.lunchTime && <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-violet-700 ring-1 ring-violet-200">🍚 점심 {flags.note.lunchTime}</span>}
                  </div>
                )}
                {flags?.note?.text?.trim()
                  ? <NoteBody text={flags.note.text} />
                  : <p className="text-[12.5px] font-bold text-violet-700/70">아직 적힌 방문 규칙이 없습니다 — 아래에서 추가하세요.</p>}
                {/* 항목 추가 — 규칙이 새로 생기면 여기에. 날짜·작성자가 자동으로 붙어 쌓인다 */}
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <input value={noteAdd} onChange={(e) => setNoteAdd(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && noteAdd.trim()) { e.preventDefault(); void appendVendorNote(); } }}
                    placeholder="새로 알게 된 규칙 추가 — 예) 지하주차장 카드키 필요"
                    className="min-w-[200px] flex-1 rounded-lg border border-violet-300 bg-white px-3 py-2 text-[13px] font-semibold outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-500/10" />
                  <button type="button" disabled={noteBusy || !noteAdd.trim()} onClick={() => void appendVendorNote()}
                    className="rounded-lg bg-violet-700 px-3.5 py-2 text-[12px] font-black text-white transition hover:bg-violet-800 disabled:bg-slate-300">+ 추가</button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => { setNoteEdit(flags?.note?.text || ""); setNoteHours({ work: flags?.note?.workStart || "", lunch: flags?.note?.lunchTime || "" }); }}
                    className="rounded-full border border-violet-300 bg-white px-3 py-1.5 text-[11px] font-black text-violet-700 transition hover:bg-violet-50">✎ 수정</button>
                  {/* 누가 언제 적었는지 — 오래된 규칙인지 판단해야 방문 전에 믿을 수 있다 */}
                  {(flags?.note?.author || flags?.note?.updatedAt) && (
                    <span className="text-[11px] font-bold text-slate-400">
                      {flags?.note?.author ? `${flags.note.author} 기재` : "기재"}{flags?.note?.updatedAt ? ` · ${flags.note.updatedAt}` : ""}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="px-4 py-3.5 sm:px-5">
                <div className="mb-2 flex flex-wrap gap-2">
                  <label className="text-[11px] font-black text-violet-700">🕘 출근시간
                    <input value={noteHours.work} onChange={(e) => setNoteHours((h) => ({ ...h, work: e.target.value }))} placeholder="예) 9시 / 9:30~"
                      className="ml-1.5 w-28 rounded-lg border border-violet-300 px-2 py-1 text-[12px] font-bold text-slate-800 outline-none focus:border-violet-500" />
                  </label>
                  <label className="text-[11px] font-black text-violet-700">🍚 점심시간
                    <input value={noteHours.lunch} onChange={(e) => setNoteHours((h) => ({ ...h, lunch: e.target.value }))} placeholder="예) 12~13시"
                      className="ml-1.5 w-28 rounded-lg border border-violet-300 px-2 py-1 text-[12px] font-bold text-slate-800 outline-none focus:border-violet-500" />
                  </label>
                </div>
                <textarea value={noteEdit} onChange={(e) => setNoteEdit(e.target.value)} rows={6}
                  placeholder={"예) 매달 방문, 20일 마감\n- 방문 시 OO 대리님께 연락 후 카드키 수령\n- 3층 소형기는 점검 제외"}
                  className="w-full rounded-xl border border-violet-300 bg-white px-3 py-2.5 text-[13.5px] font-semibold leading-6 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-500/10" />
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={noteBusy} onClick={() => void saveVendorNote()}
                    className="rounded-full bg-violet-700 px-4 py-1.5 text-[11px] font-black text-white transition hover:bg-violet-800">{noteBusy ? "저장 중…" : "저장"}</button>
                  <button type="button" onClick={() => setNoteEdit(null)} className="rounded-full border border-slate-300 bg-white px-4 py-1.5 text-[11px] font-black text-slate-500">취소</button>
                </div>
              </div>
            )}
          </section>
        )}
        {!loading && queryVendor && activeCat === "전체" && !flags?.note && noteEdit === null && (
          <button type="button" onClick={() => { setNoteEdit(""); setNoteHours({ work: "", lunch: "" }); }}
            className="mb-3 w-full rounded-2xl border-2 border-dashed border-violet-200 bg-white px-4 py-3 text-[12px] font-black text-violet-600 transition hover:border-violet-400 hover:bg-violet-50/60">
            📌 이 거래처의 특이사항 적기 — 방문 규칙·출입 방법·점검 제외 기기 등
          </button>
        )}
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
          // 사용량·여분 분석은 자동일정(방문 준비)으로 이관 — 통합이력은 상태 플래그만 (2026-08-17 단순화)
          // 점검 기록엔 있지만 임대리스트에서 반납(종료) 확인된 기기는 현역으로 세지 않는다 (푸드나무 A0079)
          const endedIdents = devices?.endedIdents || {};
          const machines = quarterCheck.machines.filter((machine) => !endedIdents[machine.key] && !endedIdents[normalizeId(machine.asset)]);
          const returnedCount = quarterCheck.machines.length - machines.length;
          // 점검 기록의 특이사항 칸 — 그날 기기 상태 메모다(거래처 고유 사항은 아래 별도 블록)
          if (quarterCheck.special) add("방문 메모", { dot: "bg-rose-400", headline: quarterCheck.special, detail: quarterCheck.latestVisit ? `${quarterCheck.latestVisit.date} 점검 기록` : "", tone: "text-rose-700" });
          if (devices && devices.mfp + devices.pc + devices.monitor + devices.etc > 0) {
            const parts = [devices.mfp && `복합기 ${devices.mfp}`, devices.pc && `PC ${devices.pc}`, devices.monitor && `모니터 ${devices.monitor}`, devices.etc && `기타 ${devices.etc}`].filter(Boolean).join(" · ");
            add("기기", { dot: "bg-slate-400", headline: `임대중 ${parts}`, detail: `${devices.ended ? `종료 ${devices.ended}대 제외 · ` : ""}${machines.length ? `최근 점검에서 ${machines.length}대 확인` : ""}${returnedCount ? ` (반납된 ${returnedCount}대 제외)` : ""}`.replace(/ · $/, ""), tone: "text-slate-700" });
          }
          // 시트-현장 불일치: 임대중 복합기인데 최근 2회 방문 모두에서 안 보인 기기 — 회수 미반영·기번 오기재 신호 (빌엔터 사례)
          if (quarterCheck.visitDates.length >= 2 && devices?.mfpActive?.length) {
            const secondLatest = quarterCheck.visitDates[1];
            const suspects = devices.mfpActive.filter((device) => {
              if (!device.idents.length) return false;
              const seen = device.idents.map((ident) => quarterCheck.identLastSeen.get(ident) || "").sort().at(-1) || "";
              return !seen || seen < secondLatest;
            });
            if (suspects.length) add("기기", {
              dot: "bg-amber-500",
              headline: `시트 확인 필요 ${suspects.length}대`,
              detail: `${suspects.map((device) => device.asset || device.idents[0]).join(", ").slice(0, 48)} — 임대중인데 최근 2회 점검에서 안 보임 (회수·교체·기번 확인)`,
              tone: "text-amber-800",
            });
          }
          // 납품인지 교체인지는 시트가 한 칸에 적어 구분이 없다 — 점검 기기(시리얼) 변화가 있으면 "교체"로 확정해 준다
          // 교체 추정은 "새 기기가 있을 때"만 — 방문이 오래 끊긴 업체는 교체가 아니라 방문 공백이다 (빌엔터 오탐)
          const retiredValid = quarterCheck.retired && quarterCheck.machines.length > 0;
          if (devices?.recentSwap || retiredValid) add("교체", {
            dot: "bg-indigo-500",
            headline: devices?.recentSwap ? `${devices.recentSwap} 납품/교체` : "기기 교체된 것으로 보임",
            detail: retiredValid && quarterCheck.retired
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
              {sections.length ? sections.map((sec) => (
                <CheckSectionRow key={sec.label} sec={sec} tint={TINT} />
              )) : <div className="px-4 py-5 text-xs font-semibold text-slate-400 sm:px-5">이번 분기에 특별히 체크할 항목이 없습니다.</div>}
            </div>
            {quarterCheck.latestVisit && <div className="truncate border-t border-slate-100 bg-slate-50/60 px-4 py-2 text-[11px] font-medium tabular-nums text-slate-400 sm:px-5">최근 점검 {quarterCheck.latestVisit.date}{REGION_LABEL[normRegion(quarterCheck.latestVisit.region)] ? ` · ${REGION_LABEL[normRegion(quarterCheck.latestVisit.region)]}` : ""} · 기기 {quarterCheck.latestVisit.count}대 방문</div>}
          </section>;
        })()}
        {!loading && detail && activeCat === "전체" && (() => {
          // 분류별 "최신 1건" 나열 대신, 모든 분류를 합친 최근 활동 타임라인 — 무슨 일이 있었는지가 한 흐름으로 읽힌다
          const CAT_TONE: Record<string, string> = { 접수: "bg-blue-50 text-blue-700", 점검: "bg-emerald-50 text-emerald-700", AS: "bg-indigo-50 text-indigo-700", 초과: "bg-amber-50 text-amber-800", 미수: "bg-rose-50 text-rose-700", 불만: "bg-red-50 text-red-700", 복합기확장성: "bg-slate-100 text-slate-600", PC확장성: "bg-slate-100 text-slate-600" };
          const CAT_DOT: Record<string, string> = { 접수: "bg-blue-500", 점검: "bg-emerald-500", AS: "bg-indigo-500", 초과: "bg-amber-500", 미수: "bg-rose-500", 불만: "bg-red-500", 복합기확장성: "bg-slate-400", PC확장성: "bg-slate-400" };
          // 내용은 어차피 눌러서 본다 — 한 줄엔 언제·어디(지역·지역구)·누가 만 (2026-08-17 단순화)
          const recent = ACTIVITY_CATS.flatMap((cat) => rowsForCategory(cat).map((record) => {
            const date = displayDate(recordDateRaw(cat, record));
            const letter = recordRegionCode(record, includedHits);
            const ident = normalizeId(String(record["자산기번"] || record["기번"] || record["시리얼넘버"] || ""));
            const gu = (ident && devices?.gu?.[ident]) || "";
            const who = pick(record, WHO_KEYS).val;
            return { cat, date, region: `${REGIONS.includes(letter) ? letter : ""}${gu ? ` ${gu}` : ""}`.trim() || "-", who, vendorName: recordVendor(record) || "" };
          })).filter((item) => item.date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
          return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-2 px-4 py-3 sm:px-5"><h3 className="text-[15px] font-black text-slate-950">최근 활동</h3><span className="text-[10px] font-bold text-slate-400">누르면 그 분류의 전체 기록이 열립니다</span></div>
            <div className="divide-y divide-slate-50 border-t border-slate-100">
              {recent.map((item, index) => (
                <button key={`${item.cat}-${item.date}-${index}`} type="button" onClick={() => setActiveCat(item.cat)} className="group flex w-full items-center gap-2.5 px-4 text-left transition hover:bg-slate-50 sm:px-5">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${CAT_DOT[item.cat] || "bg-slate-400"}`} />
                  <span className="w-[64px] shrink-0 py-2.5 text-[11.5px] font-semibold tabular-nums text-slate-500">{item.date.slice(2)}</span>
                  <span className="w-20 shrink-0 truncate py-2.5 text-[12px] font-bold text-slate-700" title={item.region}>{item.region}</span>
                  <span className="min-w-0 flex-1 truncate py-2.5 text-[13px] font-medium text-slate-800">
                    {item.who || "-"}
                    {showVendorOf(item.vendorName) && <span className="font-normal text-slate-400"> · {item.vendorName}</span>}
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
            const blocks = (activeCat === "점검" || activeCat === "AS") ? cachedBlocks(record) : [];
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
                  // 점검·AS는 FIELD에서 검색할 때와 똑같이 — 직원들이 매일 보는 원문 양식 그대로 (라벨 분해는 더 헷갈린다)
                  const rawText = (activeCat === "점검" || activeCat === "AS") ? String(record["_원문"] || "").trim() : "";
                  if (rawText) return (
                    <div className="bg-white px-4 py-3 sm:px-5">
                      <pre className="whitespace-pre-wrap break-words font-sans text-[13px] font-medium leading-6 text-slate-800">{rawText}</pre>
                    </div>
                  );
                  const clean = fields.filter((field) => !junkValue(field.value));
                  const priority = PRIORITY_FIELDS[activeCat] || [];
                  const mains = priority.map((key) => clean.find((field) => field.key === key)).filter((field): field is SummaryField => !!field);
                  const rest = clean.filter((field) => !priority.includes(field.key));
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
