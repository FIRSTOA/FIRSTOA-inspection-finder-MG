import { useEffect, useMemo, useState } from "react";
import { askConfirm } from "./confirmModal";
import { AlertTriangle, ChevronDown, ChevronRight, Plus, RefreshCw, Trash2 } from "lucide-react";
import { deleteRows, insertRow, invokeEdgeFunction, selectRows, updateRows } from "./supabase";
import { notify } from "./toast";
import PortalSelect from "./PortalSelect";
import VendorCodeAdmin from "./VendorCodeAdmin";
import RoomDeliveryBoard from "./RoomDeliveryBoard";
import KpiTargetsEditor from "./kpi/KpiTargetsEditor";
import { parseKpiTargets } from "./kpi/kpiDefs";
import { OVERHAUL_SHEET_DEFAULT_TAB, OVERHAUL_SHEET_TAB_KEY } from "./overhaulSheet";
import { UI } from "./ui/card";
import StateBox from "./ui/StateBox";
import KakaoCollectAdmin from "./KakaoCollectAdmin";

// 카드 머리(제목+설명이 세로로 쌓이는 형태) — UI.head 는 가로 flex 라 여기만 로컬. card.ts 에 올릴 후보(headBlock)
const HEAD_BLOCK = "border-b border-slate-100 bg-slate-50 px-4 py-3 lg:px-5";

/**
 * 카톡방·전송 설정 관리.
 *
 * 지금까지 이 값들은 Supabase 콘솔을 직접 열어야 바꿀 수 있었다.
 * (전송 on/off, 테스트 모드, 카테고리·지역별 방 이름)
 */
type ConfigRow = { key: string; value: string };
type RoomRow = { category: string; region: string; room: string };
type SheetJob = { id: string; category?: string; sheet_status?: string; created_at?: string; last_error?: string; attempts?: number; sheet_row?: number | null };

// 방문 판단 안내글 기준일(기타 설정) — 비우면 괄호 안 기본값(src/visitAdviceData.ts runVisitAdviceFor 와 같은 값)
const VISIT_ADVICE_DAY_FIELDS = [
  { key: "VISIT_ADVICE_MIN_DAYS", label: "방문 판단 점검 경과 기준일", fallback: "60", desc: "분기점검 지점은 마지막 점검에서 이 날수 이상 지나면 \"점검 필요\"로 봅니다. 비우면 60일." },
  { key: "VISIT_ADVICE_MONTHLY_DAYS", label: "방문 판단 매월점검 기준일", fallback: "25", desc: "워킨맵 매월점검 지점의 기준 날수입니다. 비우면 25일." },
] as const;

const SWITCHES: Array<{ key: string; label: string; desc: string; danger?: boolean }> = [
  { key: "FIELD_KAKAO_SEND_ENABLED", label: "카톡 전송", desc: "끄면 FIELD 전송이 큐에만 쌓이고 방으로 나가지 않습니다." },
  { key: "FIELD_SHEET_SYNC_ENABLED", label: "시트 동기화", desc: "끄면 FIELD 기록이 구글시트에 기입되지 않습니다." },
  { key: "TEST_MODE", label: "테스트 모드", desc: "켜면 모든 카카오톡 전송이 실제 방 대신 아래 테스트 카톡방으로만 갑니다.", danger: true },
  { key: "FIELD_SHEET_TEST_MODE", label: "시트 테스트 모드", desc: "켜면 시트 기입이 테스트 탭으로만 갑니다.", danger: true },
  { key: "FIELD_OCR", label: "매수·잔량 사진 분석(시험)", desc: "켜면 FIELD 점검 양식의 매수·잔량 칸 옆에 [📷 매수 분석]·[📷 잔량 분석]이 보입니다. 사진 한 장당 AI 비용이 듭니다." },
  { key: "NAVER_CALENDAR_ENABLED", label: "네이버 캘린더 미러", desc: "켜면 일정 등록 시 네이버 캘린더에도 자동 등록됩니다 (원본은 웹앱 일정리스트)." },
  { key: "DEPT_RECEPTION_ENABLED", label: "서비스접수 지원 3종(경영·운영·영업)", desc: "켜면 서비스접수 종류 선택기에 경영지원·운영지원·전략영업 줄과 부서 접수 폼이 보입니다. supabase/reception-dept-types.sql 과 reception-dept-types-rename.sql 을 먼저 실행해야 저장이 됩니다." },
  { key: "RECEPTION_SHEET_OPEN_ENABLED", label: "서비스접수 미처리 = 시트 상태 기준", desc: "켜면 미처리 현황판·홈 미처리 칸의 영업·경영·원격·IT 숫자를 접수 시트 상태 열(처리완료·취소·이관이 아니면 미처리, 최근 90일)로 셉니다. 시트에서 끝난 앱 접수는 자동으로 완료 처리됩니다. 끄면 앱 접수(DB) 기준. 엣지 함수 reception-sheet-open 을 먼저 배포해야 합니다." },
  { key: "KAKAO_SEARCH_ENABLED", label: "카톡 원문 검색", desc: "켜면 검색·필드 🔍·통합검색에서 수집한 카톡방 대화 원문(kakao_messages)까지 찾아 보여 줍니다. 직원들의 카톡 대화가 검색되므로 전 직원에게 먼저 알린 뒤 켜세요. 전화·주민·계좌 번호는 가린 채로 보입니다.", danger: true },
  { key: "VISIT_ADVICE_ENABLED", label: "AS 접수 방문 판단 안내글", desc: "켜면 복합기 AS 접수(와 IT→CS 방문이관) 글 뒤에 같은 방으로 마지막 점검·AS·워킨맵·추가일정과 점검여부 판단 글을 한 번 더 보냅니다. 할 일이 있을 때만(점검 필요·판단필요·추가일정 있음·못 찾음), 10~20시에만(밖이면 다음 영업일 10시). supabase/visit-advice-20261031.sql 을 먼저 실행한 뒤 켜세요." },
  { key: "SSO_REQUIRED", label: "그룹웨어 로그인 필수", desc: "켜면 그룹웨어 계정으로 로그인한 기기만 FIELD가 열립니다(앨범·설명서 같은 공개 페이지는 예외). 그룹웨어 담당자가 우리 주소를 허용목록에 올려 로그인이 되는 걸 확인한 뒤 켜세요.", danger: true },
];

const ROOM_CATEGORIES = ["점검", "AS", "미수", "재계약", "불만", "초과조정", "자가", "부품", "물류", "PC", "복합기", "IT접수", "마감", "반납", "불량토너", "불량부품", "경영접수", "운영접수", "영업접수"]; // 부서 접수 → 카톡방(2026-10-26, 지역은 * 공통) // // 반납·불량토너·불량부품 = 조회 탭 자가·부품신청의 [반납]·[불량] 글이 가는 방(2026-10-11) // IT접수|* = 서비스접수 IT 건이 가는 방(2026-09-17) · 마감|*(또는 팀) = 카운터 사진이 올라가고 봇이 관리부 목록을 읽는 마감방(2026-10-10, 한 곳에서 관리)
const ROOM_REGIONS = ["*", "A", "B", "C", "D", "E", "CD"];

import { SYSTEM_VIEWS, type SystemView } from "./adminViews";
export { SYSTEM_VIEWS, type SystemView };

export default function SystemAdmin({ view = "switches" }: { view?: SystemView }) {
  const [kpiOpen, setKpiOpen] = useState(false);
  const [config, setConfig] = useState<ConfigRow[]>([]);
  // 네이버 계정에 보이는 캘린더 목록(CalDAV PROPFIND) — 팀 완료 캘린더 ID를 공유 URL 없이도 고를 수 있게
  const [naverCalList, setNaverCalList] = useState<Array<{ id: string; name: string; owner: string }> | null>(null);
  const [naverCalLoading, setNaverCalLoading] = useState(false);
  const loadNaverCalList = async () => {
    setNaverCalLoading(true);
    try {
      const r = await invokeEdgeFunction<{ calendars?: Array<{ id: string; name: string; owner: string }> }>("naver-calendar-sync", { action: "list_calendars" });
      setNaverCalList((r.calendars || []).filter((c) => !/내 캘린더|내 할 일|네이버 예약/.test(c.name)));
    } catch (e) { notify(`캘린더 목록 조회 실패: ${(e as Error).message}`, "error"); }
    finally { setNaverCalLoading(false); }
  };
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [jobs, setJobs] = useState<SheetJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<RoomRow>({ category: "점검", region: "A", room: "" });
  // 시트 진단 (2026-09-02 접수 증식 사고 후) — 시트를 직접 열지 않고도 행을 찾고, 잡의 지문을 확인한다
  const [peekCat, setPeekCat] = useState("reception_remote");
  const [peekWord, setPeekWord] = useState("");
  const [diagOut, setDiagOut] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [cfg, roomRows, jobRows] = await Promise.all([
        selectRows<ConfigRow>("app_config", "select=key,value&order=key.asc"),
        selectRows<RoomRow>("room_map", "select=category,region,room&order=category.asc,region.asc"),
        selectRows<SheetJob>("field_sheet_sync_jobs", "select=*&order=created_at.desc&limit=20").catch(() => []),
      ]);
      setConfig(cfg);
      setRooms(roomRows);
      setJobs(jobRows);
      setError("");
    } catch (e) {
      setError((e as Error).message || "설정을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);
  const valueOf = (key: string) => config.find((row) => row.key === key)?.value || "";
  const isOn = (key: string) => /^(true|1|on|y)$/i.test(valueOf(key));

  const saveConfig = async (key: string, value: string) => {
    setBusy(key);
    setNotice("");
    try {
      if (config.some((row) => row.key === key)) await updateRows("app_config", `key=eq.${encodeURIComponent(key)}`, { value });
      else await insertRow("app_config", { key, value });
      setConfig((current) => (current.some((row) => row.key === key) ? current.map((row) => (row.key === key ? { ...row, value } : row)) : [...current, { key, value }]));
      setNotice(`${key} 저장됨`);
    } catch (e) {
      setError((e as Error).message || "저장하지 못했습니다.");
    } finally {
      setBusy("");
    }
  };

  const addRoom = async () => {
    if (!draft.room.trim()) return;
    setBusy("room-add");
    try {
      const exists = rooms.some((row) => row.category === draft.category && row.region === draft.region);
      if (exists) await updateRows("room_map", `category=eq.${encodeURIComponent(draft.category)}&region=eq.${encodeURIComponent(draft.region)}`, { room: draft.room.trim() });
      else await insertRow("room_map", { category: draft.category, region: draft.region, room: draft.room.trim() });
      setDraft({ ...draft, room: "" });
      await load();
      setNotice("방 매핑 저장됨");
    } catch (e) {
      setError((e as Error).message || "저장하지 못했습니다.");
    } finally {
      setBusy("");
    }
  };

  const removeRoom = async (row: RoomRow) => {
    if (!await askConfirm(`${row.category} · ${row.region} 방 매핑을 삭제할까요?\n\n"${row.room}"`)) return;
    setBusy(`${row.category}|${row.region}`);
    try {
      await deleteRows("room_map", `category=eq.${encodeURIComponent(row.category)}&region=eq.${encodeURIComponent(row.region)}`);
      await load();
    } catch (e) {
      setError((e as Error).message || "삭제하지 못했습니다.");
    } finally {
      setBusy("");
    }
  };

  const grouped = useMemo(() => {
    const map = new Map<string, RoomRow[]>();
    rooms.forEach((row) => {
      const list = map.get(row.category) || [];
      list.push(row);
      map.set(row.category, list);
    });
    return Array.from(map.entries());
  }, [rooms]);

  const testMode = isOn("TEST_MODE") || isOn("FIELD_SHEET_TEST_MODE");
  const kpiSettings = useMemo(() => parseKpiTargets(valueOf("KPI_TARGETS")), [config]); // eslint-disable-line react-hooks/exhaustive-deps
  const kpiMainCount = Object.values(kpiSettings.targets).filter((t) => t.main).length;
  const viewInfo = SYSTEM_VIEWS.find(([key]) => key === view);

  return (
    <div className="space-y-4">
      {viewInfo && <p className="px-1 text-[13px] font-semibold leading-5 text-slate-500">{viewInfo[2]}</p>}
      {testMode && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-black text-amber-800">
          <AlertTriangle size={17} className="shrink-0" />
          테스트 모드가 켜져 있습니다 — 전송·기입이 실제 방/탭으로 가지 않습니다.
        </div>
      )}

      {/* 저장 결과·오류 — 어느 칩에서 저장해도 보이도록 카드 밖에 둔다 */}
      {error && <div role="alert" className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-2.5 text-xs font-bold text-rose-700">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-700">{notice}</div>}

      {/* 전송 스위치 */}
      {view === "switches" && (
      <section className={UI.card}>
        <div className={UI.head}>
          <div>
            <h3 className={UI.title}>전송·연동 스위치</h3>
            <p className={UI.desc}>지금까지 Supabase 콘솔에서만 바꿀 수 있던 값입니다.</p>
          </div>
          <button type="button" onClick={() => void load()} className={UI.btnGhost}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />새로고침
          </button>
        </div>
        {loading && !config.length && <StateBox inside kind="loading" message="설정을 불러오는 중입니다…" />}
        <div className="divide-y divide-slate-100">
          {SWITCHES.map((item) => {
            const on = isOn(item.key);
            return (
              <div key={item.key} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-slate-900">{item.label}</span>
                    <span className="break-all font-mono text-[11px] font-bold text-slate-400">{item.key}</span>
                  </div>
                  <p className={UI.desc}>{item.desc}</p>
                </div>
                <button type="button" disabled={busy === item.key} onClick={() => void saveConfig(item.key, on ? "false" : "true")}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition before:absolute before:-inset-2 disabled:opacity-40 ${on ? (item.danger ? "bg-amber-500" : "bg-blue-600") : "bg-slate-200"}`}
                  aria-pressed={on} aria-label={`${item.label} ${on ? "켜짐" : "꺼짐"}`}>
                  <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-6" : "left-1"}`} />
                </button>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div>
              <div className="text-sm font-black text-slate-900">테스트 카톡방 이름</div>
              <p className={UI.desc}>카카오톡 방 이름입니다. 테스트 모드가 켜지면 모든 전송이 실제 방 대신 이 카톡방으로만 갑니다.</p>
            </div>
            <input defaultValue={valueOf("TEST_ROOM")} onBlur={(e) => { if (e.target.value !== valueOf("TEST_ROOM")) void saveConfig("TEST_ROOM", e.target.value); }}
              className="h-11 w-full rounded-lg border border-slate-300 px-3 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 sm:w-56 lg:h-10" />
          </div>
        </div>
      </section>
      )}

      {/* 기타 설정값 (캘린더·오버홀 시트 탭) */}
      {view === "misc" && (
      <section className={UI.card}>
        <div className={UI.head}>
          <div>
            <h3 className={UI.title}>기타 설정값</h3>
            <p className={UI.desc}>칸을 고친 뒤 다른 곳을 누르면 자동 저장됩니다.</p>
          </div>
          <button type="button" onClick={() => void load()} className={UI.btnGhost}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />새로고침
          </button>
        </div>
        {loading && !config.length && <StateBox inside kind="loading" message="설정을 불러오는 중입니다…" />}
        <div className="divide-y divide-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div>
              <div className="text-sm font-black text-slate-900">네이버 캘린더 ID</div>
              <p className={UI.desc}>비워두면 연동 계정의 기본 캘린더. 특정 캘린더로 보내려면 그 캘린더의 공유 URL(naver.me/…)을 그대로 붙여넣으세요 — 자동으로 ID로 바뀝니다. (캘린더 설정 → 공개 설정 → URL 복사)</p>
            </div>
            <input defaultValue={valueOf("NAVER_CALENDAR_ID")} placeholder="defaultCalendarId" onBlur={(e) => { if (e.target.value !== valueOf("NAVER_CALENDAR_ID")) void saveConfig("NAVER_CALENDAR_ID", e.target.value.trim()); }}
              className="h-11 w-full rounded-lg border border-slate-300 px-3 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 sm:w-56 lg:h-10" />
          </div>
          {/* 오버홀 기록 시트 탭(2026-10-24) — 홈 KPI 달성표 K33 오버홀 원본. 비우면 기본 "리스트(26년)" */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div>
              <div className="text-sm font-black text-slate-900">오버홀 시트 탭 이름 (OVERHAUL_SHEET_TAB)</div>
              <p className={UI.desc}>홈 KPI 달성표의 오버홀 점수를 읽는 오버홀 기록 시트의 탭 이름입니다. 비워두면 기본 "{OVERHAUL_SHEET_DEFAULT_TAB}". 해가 바뀌어 새 탭을 만들면 그 탭을 연 주소(…#gid=숫자)나 gid 숫자를 적으세요(앱이 아는 탭 이름은 이름만 적어도 됩니다).</p>
            </div>
            <input defaultValue={valueOf(OVERHAUL_SHEET_TAB_KEY)} placeholder={OVERHAUL_SHEET_DEFAULT_TAB} onBlur={(e) => { if (e.target.value.trim() !== valueOf(OVERHAUL_SHEET_TAB_KEY)) void saveConfig(OVERHAUL_SHEET_TAB_KEY, e.target.value.trim()); }}
              className="h-11 w-full rounded-lg border border-slate-300 px-3 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 sm:w-56 lg:h-10" />
          </div>
          {/* 방문 판단 안내글 기준일(2026-10-31) — 비우면 60·25. 양의 정수만 저장 */}
          {VISIT_ADVICE_DAY_FIELDS.map((f) => (
            <div key={f.key} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
              <div>
                <div className="text-sm font-black text-slate-900">{f.label} ({f.key})</div>
                <p className={UI.desc}>{f.desc}</p>
              </div>
              <input key={`${f.key}:${valueOf(f.key)}`} type="number" inputMode="numeric" min={1} step={1} defaultValue={valueOf(f.key)} placeholder={f.fallback}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v === valueOf(f.key)) return;
                  if (v && !(Number.isInteger(Number(v)) && Number(v) > 0)) { setError(`${f.label}: 1 이상의 정수(일)를 넣으세요`); e.target.value = valueOf(f.key); return; }
                  void saveConfig(f.key, v);
                }}
                className="h-11 w-full rounded-lg border border-slate-300 px-3 text-sm font-semibold tabular-nums outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 sm:w-28 lg:h-10" />
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div>
              <div className="text-sm font-black text-slate-900">네이버 재연동 (토큰 갱신)</div>
              <p className={UI.desc}>네이버 캘린더에 등록이 안 되기 시작하면(토큰 만료·비밀번호 변경) 연동 계정으로 로그인 한 번이면 됩니다. "연동 완료 ✓" 알림까지 확인하세요.</p>
            </div>
            <a href="https://nid.naver.com/oauth2.0/authorize?response_type=code&client_id=V_m8cXZT2YjdGqAJyssK&redirect_uri=https%3A%2F%2Ffirstoa-inspection-finder-mg.vercel.app%2F&state=firstoa"
              className="inline-flex min-h-11 items-center rounded-full border border-emerald-300 bg-emerald-50 px-4 text-sm font-black text-emerald-700 transition hover:bg-emerald-100 lg:min-h-9">재연동 열기</a>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div>
              <div className="text-sm font-black text-slate-900">팀별 완료 캘린더 ID</div>
              <p className={UI.desc}>일정 완료 시 익일통합as에서 이 캘린더로 이동합니다. 비운 팀은 제자리 완료 체크만. A·B는 "강북서AB as" 하나를 같이 씁니다(같은 ID).</p>
              <button type="button" onClick={() => void loadNaverCalList()} disabled={naverCalLoading}
                className={`${UI.btnGhost} mt-2 text-xs!`}>
                {naverCalLoading ? "불러오는 중…" : "네이버 캘린더 목록 불러오기"}
              </button>
              {naverCalList && (
                <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto text-[11px] font-semibold text-slate-600">
                  {naverCalList.length === 0 && <li className="text-slate-400">캘린더가 없습니다</li>}
                  {naverCalList.map((c) => (
                    <li key={c.id} className="flex items-center gap-2">
                      <span className="w-40 truncate font-black text-slate-800">{c.name || "(이름 없음)"}</span>
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">{c.id}</code>
                      <button type="button" onClick={() => { void navigator.clipboard.writeText(c.id).then(() => notify(`${c.name} ID 복사 ✓`, "success")).catch(() => notify("복사 실패", "error")); }}
                        className="inline-flex min-h-11 items-center rounded-full border border-slate-200 px-3 text-[11px] font-black text-slate-500 hover:bg-slate-50 lg:min-h-9">복사</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {(["A", "B", "C", "D", "E", "IT"] as const).map((t) => (
                <label key={t} className="flex items-center gap-1 text-xs font-black text-slate-500">{t === "IT" ? "IT(접수 캘린더)" : t}
                  <input defaultValue={valueOf(`NAVER_TEAM_CALENDAR_${t}`)} onBlur={(e) => { if (e.target.value !== valueOf(`NAVER_TEAM_CALENDAR_${t}`)) void saveConfig(`NAVER_TEAM_CALENDAR_${t}`, e.target.value.trim()); }}
                    className="w-32 rounded-lg border border-slate-300 px-2 py-2 text-xs font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>
      )}

      {/* 홈 KPI 목표 — 기본 접힘. 편집기 내부는 그대로(KpiTargetsEditor) */}
      {view === "kpi" && (
      <section className={UI.card}>
        <button type="button" onClick={() => setKpiOpen((open) => !open)} aria-expanded={kpiOpen}
          className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50 lg:px-5">
          {kpiOpen ? <ChevronDown size={18} className="shrink-0 text-slate-400" /> : <ChevronRight size={18} className="shrink-0 text-slate-400" />}
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-black text-slate-900">홈 KPI 목표</span>
            <span className="block text-[11px] font-semibold text-slate-500">
              {loading ? "불러오는 중입니다…" : `주요 목표 ${kpiMainCount}개 · ${valueOf("KPI_TARGETS").trim() ? "저장된 목표 사용 중" : "기본 목표 사용 중(저장 안 함)"}${kpiSettings.error ? " · 저장값에 오류가 있어 기본값을 씁니다" : ""}`}
            </span>
          </span>
          <span className={`${UI.btnGhost} pointer-events-none shrink-0`}>{kpiOpen ? "접기" : "펼치기"}</span>
        </button>
        {kpiOpen && !loading && (
          <div className="border-t border-slate-100">
            <KpiTargetsEditor key={valueOf("KPI_TARGETS")} value={valueOf("KPI_TARGETS")} busy={busy === "KPI_TARGETS"} onSave={saveConfig} />
          </div>
        )}
        {kpiOpen && loading && <StateBox inside kind="loading" message="목표를 불러오는 중입니다…" />}
      </section>
      )}

      {/* 카톡방 매핑 */}
      {view === "rooms" && (
      <>
      <section className={UI.card}>
        <div className={HEAD_BLOCK}>
          <h3 className={UI.title}>카톡방 매핑</h3>
          <p className={UI.desc}>업무 종류 · 지역별로 어느 방에 보낼지 정합니다. 지역 <b>*</b> 는 전 지역 공통입니다.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-4">
          <label className="text-[11px] font-black text-slate-500">업무 종류
            <span className="mt-1 block"><PortalSelect width={130} value={draft.category} onChange={(next) => setDraft({ ...draft, category: next })}
              options={ROOM_CATEGORIES.map((value) => ({ value, label: value === "영업접수" ? "영업접수(전략영업)" : value }))} /></span>
          </label>
          <label className="text-[11px] font-black text-slate-500">지역
            <span className="mt-1 block"><PortalSelect width={110} value={draft.region} onChange={(next) => setDraft({ ...draft, region: next })}
              options={ROOM_REGIONS.map((value) => ({ value, label: value === "*" ? "* 공통" : `${value}팀` }))} /></span>
          </label>
          <label className="min-w-0 flex-1 text-[11px] font-black text-slate-500">카톡방 이름
            <input value={draft.room} onChange={(e) => setDraft({ ...draft, room: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") void addRoom(); }}
              placeholder="카톡방 정확한 이름" className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm lg:h-10 font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
          </label>
          <button type="button" onClick={() => void addRoom()} disabled={!draft.room.trim() || busy === "room-add"}
            className={UI.btn}>
            <Plus size={15} />저장
          </button>
        </div>
        <div className="grid gap-px bg-slate-100 sm:grid-cols-2 xl:grid-cols-3">
          {grouped.map(([groupName, list]) => (
            <div key={groupName} className="bg-white">
              <div className="border-b border-slate-100 px-4 py-2.5 text-xs font-black text-slate-700">{groupName}</div>
              <div className="divide-y divide-slate-50">
                {list.map((row) => (
                  <div key={`${row.category}|${row.region}`} className="flex items-center gap-2 px-4 py-2.5">
                    <span className="w-12 shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-center text-[11px] font-black text-slate-500">{row.region === "*" ? "공통" : row.region}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-slate-800" title={row.room}>{row.room}</span>
                    <button type="button" aria-label={`${row.category} ${row.region} 방 매핑 삭제`} disabled={busy === `${row.category}|${row.region}`} onClick={() => void removeRoom(row)}
                      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-500 disabled:opacity-40 lg:min-h-9 lg:min-w-9"><Trash2 size={15} /></button>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {!grouped.length && !loading && <div className="bg-white sm:col-span-2 xl:col-span-3"><StateBox inside kind="empty" message="등록된 방 매핑이 없습니다." /></div>}
        </div>
      </section>

      {/* 카톡 발송 현황 — 방별 마지막 배달(폰 봇/노트북 PC)·밀린 글 */}
      <RoomDeliveryBoard />
      </>
      )}

      {/* 카톡 수집 — 방별 상태·확인필요·지금 수집(gas-admin 엣지 경유). 2026-10-24 KakaoCollectAdmin 으로 이전 */}
      {view === "collect" && <KakaoCollectAdmin />}

      {/* 시트 동기화 최근 상태 */}
      {view === "sheet" && (
      <section className={UI.card}>
        <div className={HEAD_BLOCK}>
          <h3 className={UI.title}>시트 기입 최근 작업</h3>
          <p className={UI.desc}>FIELD·접수에서 구글시트로 보낸 요청의 결과입니다. 실패가 쌓이면 Apps Script 배포를 확인하세요.</p>
        </div>
        {/* 시트 진단 — 키워드로 실제 시트 행을 찾아본다 (읽기 전용) */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
          <PortalSelect direction="down" className="py-1.5 text-xs font-bold" width={170} value={peekCat} onChange={(v) => setPeekCat(v)}
            options={[
              { value: "reception_remote", label: "접수시트 · 원격" },
              { value: "reception_copier", label: "접수시트 · 복합기" },
              { value: "praise", label: "칭찬" },
              { value: "complaint", label: "불만" },
              { value: "contact_change", label: "키맨체크" },
              { value: "expansion_it", label: "확장성 IT" },
              { value: "expansion_copier", label: "확장성 복합기" },
            ]} />
          <input value={peekWord} onChange={(e) => setPeekWord(e.target.value)} placeholder="업체명·키워드"
            onKeyDown={(e) => { if (e.key === "Enter" && peekWord.trim()) (e.target as HTMLInputElement).blur(); }}
            className="h-11 w-40 rounded-lg border border-slate-300 px-3 text-[13px] font-bold outline-none focus:border-blue-500 lg:h-10" />
          <button type="button" disabled={busy === "peek" || !peekWord.trim()}
            onClick={() => { void (async () => {
              setBusy("peek"); setDiagOut("시트를 읽는 중…");
              try {
                const r = await invokeEdgeFunction<{ sheet?: string; hits?: Array<Record<string, string>> }>("field-sheet-sync", { action: "peek", category: peekCat, keyword: peekWord.trim() });
                const hits = r.hits || [];
                setDiagOut(hits.length
                  ? `[${r.sheet}] ${hits.length}행 발견\n` + hits.map((h) => `행 ${h._row} · ` + Object.entries(h).filter(([k, v]) => k !== "_row" && v).slice(0, 6).map(([k, v]) => `${k}=${v}`).join(" · ")).join("\n")
                  : `[${r.sheet}] "${peekWord.trim()}" 행 없음`);
              } catch (e) { setDiagOut(`실패: ${(e as Error).message}`); }
              finally { setBusy(""); }
            })(); }}
            className={UI.btnGhost}>
            {busy === "peek" ? "읽는 중…" : "시트에서 찾기"}</button>
          {diagOut && <pre className="w-full whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-[11px] font-semibold leading-5 text-slate-600">{diagOut}</pre>}
        </div>
        <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
          {jobs.map((job) => {
            const state = job.sheet_status === "synced" ? "완료" : job.sheet_status === "failed" ? "실패" : "대기";
            const tone = state === "완료" ? UI.tone.ok : state === "실패" ? UI.tone.bad : UI.tone.warn;
            return (
              <div key={job.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black ${tone}`}>{state}{job.attempts ? ` ${job.attempts}회` : ""}</span>
                <span className="w-24 shrink-0 truncate text-xs font-bold text-slate-600 sm:w-32">{job.category || "-"}</span>
                <span className="min-w-0 flex-1 basis-32 truncate text-[11px] font-semibold text-slate-500" title={job.last_error || ""}>{job.last_error || (state === "완료" ? `행 ${job.sheet_row ?? "-"}` : "-")}</span>
                {state !== "완료" && (
                  <button type="button" disabled={busy === `probe-${job.id}`}
                    onClick={() => { void (async () => {
                      setBusy(`probe-${job.id}`);
                      try {
                        const r = await invokeEdgeFunction<{ matched?: boolean; row?: number; sheet?: string; detail?: string }>("field-sheet-sync", { action: "probe", jobId: job.id });
                        setDiagOut(r.matched ? `이 접수는 [${r.sheet}] 행 ${r.row}에 이미 있습니다 — [다시 실행]을 누르면 그 행으로 완료 처리됩니다` : `시트에 아직 없습니다 · ${r.detail || ""}`);
                      } catch (e) { setDiagOut(`지문 확인 실패: ${(e as Error).message}`); }
                      finally { setBusy(""); }
                    })(); }}
                    className={`${UI.btnGhost} shrink-0 text-xs!`}
                    title="시트에 이미 기입됐는지 확인만 합니다 (아무것도 쓰지 않음)">
                    {busy === `probe-${job.id}` ? "확인 중…" : "지문"}
                  </button>
                )}
                {state !== "완료" && (
                  <button type="button" disabled={busy === `retry-${job.id}`}
                    onClick={() => { void (async () => { setBusy(`retry-${job.id}`); try { await invokeEdgeFunction("field-sheet-sync", { jobId: job.id }); await load(); } catch { /* 결과는 목록 갱신으로 확인 */ } finally { setBusy(""); } })(); }}
                    className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-blue-200 bg-blue-50 px-4 text-xs font-black text-blue-700 transition hover:bg-blue-100 disabled:opacity-40 lg:min-h-9">
                    {busy === `retry-${job.id}` ? "실행 중…" : "다시 실행"}
                  </button>
                )}
                <span className="shrink-0 font-mono text-[11px] font-bold tabular-nums text-slate-400">{String(job.created_at || "").slice(5, 16).replace("T", " ")}</span>
              </div>
            );
          })}
          {!jobs.length && <StateBox inside kind={loading ? "loading" : "empty"} message={loading ? "불러오는 중입니다…" : "최근 작업 기록이 없습니다."} />}
        </div>
      </section>
      )}

      {/* 거래처 코드 미매칭 확정 — 워킨맵 지점 ↔ 임대리스트 거래처 수동 연결 */}
      {view === "misc" && <VendorCodeAdmin />}
    </div>
  );
}
