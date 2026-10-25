// 필드 헤더 🔍 시트(2026-10-25) — 모든 탭의 업체 이력 검색 입구 하나. 옛 App 거래처검색 팝업 + 맨 위 검색칸(TabSearchBar)을 합쳤다.
// 설계: docs/tasks/tab-search-icon-merge-2026-10-25.md 5절. 폰은 아래서 올라오는 시트, PC 는 가운데 팝업(틀은 옛 거래처검색과 같음).
//  - 점검·AS(빈 리포트·삼성노트 포함): VendorSearch 그대로 + 업체를 고르면 아래 "더 지난 이력"(카드와 같은 원문 제외, 카톡은 접힌 묶음 — 팀장 결정 Q1).
//  - 청정기: AirSearch 그대로 + 아래 청정기 이력.
//  - 그 밖의 탭: 검색칸 → 업체 후보 → 한 목록(FIELD + 표에 없는 카톡).
//  - 상태는 이 컴포넌트(useTabSearch)가 들고 있어 같은 탭에서 닫았다 열면 남는다. 탭을 바꾸면 비운다.
import { useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import VendorSearch from "../VendorSearch";
import AirSearch from "../AirSearch";
import { getInspForms } from "../api";
import { tabKeyOf, type TabKey } from "../tabSearch";
import { sheetHeading } from "../tabSearchLine";
import { useTabSearch, type TabSearchState } from "../useTabSearch";
import { TabSearchCandidates, TabSearchResults } from "../TabSearch.view";

type Props = {
  open: boolean;
  onClose: () => void;
  mode: string;
  pcSubTab?: string;
  seed?: string;                 // 워킨맵 F — 이 업체 이름으로 VendorSearch 시작
  accent: string;
  onLoadForm: (text: string, opts?: { silent?: boolean }) => void; // App handleLoadForm(시트를 닫는다)
  onVendor: (vendor: string) => void;
  hasDraft?: boolean;
  onError: (msg: string) => void;
};

function Results({ s, heading, foldKakao }: { s: TabSearchState; heading?: string; foldKakao?: boolean }) {
  if (!s.spec || !s.picked) return null;
  return (
    <TabSearchResults
      spec={s.spec} title={s.picked.name} heading={heading} foldKakao={foldKakao}
      runState={s.runState} error={s.error} onRun={s.rerun}
      lines={s.lines} all={s.all} hidden={s.hidden}
      chip={s.chip} onChip={s.setChip} summary={s.summary} coverage={s.coverage} resultKey={s.resultKey}
      kakao={s.kakaoStatus} onKakaoRetry={s.retryKakao}
      onLoad={s.spec.key === "inspection" ? (line) => { void s.loadLine(line); } : undefined}
    />
  );
}

/** 그 밖의 탭 — 검색칸(시트 안 흰 바탕) + 후보 + 한 목록 */
function SpecSearch({ s }: { s: TabSearchState }) {
  if (!s.spec) return null;
  return (
    <div>
      <div className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 focus-within:bg-white">
        <Search size={15} className="shrink-0 text-slate-400" aria-hidden="true" />
        <input
          type="search" autoComplete="off" autoFocus value={s.query} onChange={(ev) => s.onQuery(ev.target.value)}
          placeholder={s.spec.question} aria-label={`${s.spec.label} 이력 검색`}
          className="min-w-0 flex-1 bg-transparent text-[14px] font-bold text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:outline-none"
        />
        {(s.candState === "loading" || s.runState === "loading") && <Loader2 size={14} className="shrink-0 animate-spin text-slate-400" aria-label="찾는 중" />}
        {(s.query || s.picked) && (
          <button type="button" onClick={s.clearAll} aria-label="검색 지우기" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={15} /></button>
        )}
      </div>
      <TabSearchCandidates state={s.candState} candidates={s.candidates} query={s.query} onPick={s.pick} />
      <Results s={s} />
    </div>
  );
}

/** 탭이 바뀌면 key 로 새로 그려 상태를 비운다(같은 탭에서 닫았다 열면 남는다) */
export default function FieldSearchSheet(p: Props) {
  const tab = tabKeyOf(p.mode, p.pcSubTab);
  return <SheetBody key={tab || "none"} tab={tab} {...p} />;
}

function SheetBody({ tab, open, onClose, seed = "", accent, onLoadForm, onVendor, hasDraft, onError }: Props & { tab: TabKey | null }) {
  // 점검·AS 카드(최근 점검 6·AS 4)에 이미 보이는 양식 원문 — 이력 목록에서 뺀다
  const [shown, setShown] = useState<{ vendor: string; texts: string[] }>({ vendor: "", texts: [] });
  const s = useTabSearch(tab, { onLoadForm: (t) => onLoadForm(t, { silent: true }), hasDraft, shownTexts: shown.texts });
  if (!open || !tab || !s.spec) return null;

  const pickVendor = (v: string) => {
    onVendor(v);
    void s.pickName(v);
    if (tab === "inspection" && v !== shown.vendor) {
      setShown({ vendor: v, texts: [] });
      // 카드와 같은 조회(작은 2건). 실패하면 빼지 못할 뿐 — 같은 실패를 VendorSearch 가 이미 안내한다
      getInspForms(v).then(
        (r) => setShown((cur) => (cur.vendor === v ? { vendor: v, texts: r.forms.map((f) => f.text).filter(Boolean) } : cur)),
        (err) => onError(`이력 중복 거르기 실패 — ${((err as Error)?.message || String(err)).slice(0, 60)}`),
      );
    }
  };
  const head = sheetHeading(tab);

  return (
    <div className="fixed inset-0 z-[70] flex items-end bg-slate-900/40 backdrop-blur-sm sm:items-center sm:justify-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={head.title}
        className="flex h-[90vh] w-full flex-col rounded-t-3xl bg-white sm:h-[82vh] sm:max-w-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 rounded-t-3xl px-5 py-4 text-white" style={{ background: accent }}>
          <div className="min-w-0">
            <div className="truncate text-base font-bold">{head.title}</div>
            <div className="mt-0.5 truncate text-[11px] font-semibold text-white/70">{head.sub}</div>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-xl bg-white/20 px-3 py-1.5 text-sm font-semibold">닫기</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {tab === "inspection" ? (
            <>
              <VendorSearch key={seed} initialQuery={seed} accent={accent} onLoadForm={(t) => onLoadForm(t)} onVendor={pickVendor} onError={onError} />
              <Results s={s} heading="더 지난 이력" foldKakao />
            </>
          ) : tab === "air" ? (
            <>
              <AirSearch accent={accent} onLoadForm={(t) => onLoadForm(t)} onVendor={pickVendor} onError={onError} />
              <Results s={s} heading="청정기 이력" />
            </>
          ) : (
            <SpecSearch s={s} />
          )}
        </div>
      </div>
    </div>
  );
}
