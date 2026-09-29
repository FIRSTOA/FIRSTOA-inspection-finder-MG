/**
 * 점검 리포트(2026-09-30) — 점검·AS 양식 한 장을 고객용 리포트 이미지로 만들어 키맨에게 문자(MMS)로 보낸다.
 * 해피콜 탭의 세 번째 모드(해피콜 / 분기점검 안내 / 점검 리포트). 왼쪽은 최근 점검·AS 목록(내 것 기본), 오른쪽은 리포트 카드와 [발송].
 *  - 재료: jeomgeom(점검)·as_records(AS)의 _원문(FIELD 양식) → reportForm.ts 파서. 점검은 같은 업체의 직전 점검과 짝지어 사용량 증가분을 낸다.
 *  - 고객용 문구: 양식의 처리내용은 CS끼리 쓰는 메모라 그대로 못 보낸다 → 카드 위 칸에 미리 채워 두고 보내기 전에 고친다(오늘 조치 / AS는 접수·처리 내용).
 *    정기점검만 적힌 건은 "정기점검 완료 · 이상 없음"이 기본. 현장 사진 줄은 넣지 않는다(사진을 보내 달라 할 수 있어서).
 *  - 이미지: 카드 DOM을 html2canvas-pro로 굽고 JPG ≤200KB·긴 변 1440 안으로 줄여 customer-message-send(솔라피 MMS)로 보낸다.
 *    원본 크기 PNG는 storage(reports)에 올려 문자에 "크게 보기" 링크로 — 기기가 여러 대면 MMS 그림이 작아지므로.
 *  - 기기 2대 이상도 1대와 같은 구성을 세로로 쌓는다(두 열 압축 배치는 어색해 뺌, 2026-09-30). 문자 그림이 작아지는 건 원본 크기 링크로 보완.
 *  - 업체명·키맨 이름·조치 문구는 양식에서 채워 두고 보내기 전에 고칠 수 있다.
 *  - 기록: message_jobs(source_type=inspection_report, status=sent) — 목록에 '발송됨' 표시, 같은 건 재발송은 확인창. AS는 source_id를 "as:<id>"로.
 *  - 테스트 발송: 직원 번호로 같은 이미지를 보내 본다([테스트]) — 기록하지 않고, 업무시간 확인도 건너뛴다.
 *  - 기준(CS팀): 토너 잔량 25% 이하 교체, 폐토너통 여유 25% 이하 교체 예정. 보내기 전 확인창, 10~19시 밖이면 한 번 더 확인.
 *  - 하단은 회사 대표번호만(담당자 이름·번호 없음), 다음 점검은 달을 못 박지 않는다(등급마다 주기가 다르고 방문 전 연락이 관행).
 *  - 내부용 항목(레벨·등급·한틴이카·주차비·부품/자가신청)과 키맨 칸의 위치 메모는 리포트에 넣지 않는다. 키맨 이름은 보내기 전에 고칠 수 있다.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FlaskConical, Image as ImageIcon, RefreshCw, Send } from "lucide-react";
import { getConfig, insertRow, invokeEdgeFunction, selectRows, uploadPublicFile } from "./supabase";
import { askConfirm } from "./confirmModal";
import { notify } from "./toast";
import { kstDate } from "./visits";
import { delta, fmt, matchPrevious, parseInspectionForm, tonerLow, wasteLow, type ReportData, type ReportDevice, type TonerKey } from "./reportForm";

type Kind = "inspection" | "as";
type FormRow = { id: number; 작성일: string; 작성자: string; 구분: string; 업체명: string; _업체명: string; 모델명: string; 자산기번: string; _원문: string; created_at: string };
type Texts = Record<number, string>; // 기기 번호 → 고객용 문구
const enc = encodeURIComponent;
const COLS = "id,작성일,작성자,구분,업체명,_업체명,모델명,자산기번,_원문,created_at";
const COMPANY_PHONE = "1522-1093"; // 퍼스트전산 대표번호 — 리포트 하단·문자 끝
const KAKAO_CHANNEL_URL = "http://pf.kakao.com/_yCBAj"; // 카카오톡 플러스친구 — 관리 설정(app_config) KAKAO_CHANNEL_URL이 있으면 그것을 우선
const TEST_PHONE_KEY = "report_test_phone";
const TONER: Array<[TonerKey, string, string]> = [["K", "검정", "#2a2a2e"], ["C", "파랑", "#0e9ad0"], ["M", "빨강", "#d8368a"], ["Y", "노랑", "#efb400"]];
const SIMPLE_NOTE: Record<Kind, string> = { inspection: "정기점검 완료 · 이상 없음\n카운터 확인 및 여분 재고 점검", as: "점검 후 처리 완료" };
const kstHour = () => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", hour12: false }).format(new Date()));
const shortDate = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const koreanDate = (d: string) => { const dt = new Date(`${d}T12:00:00+09:00`); const day = ["일", "월", "화", "수", "목", "금", "토"][dt.getUTCDay()]; return `${d.slice(0, 4)}. ${Number(d.slice(5, 7))}. ${Number(d.slice(8, 10))} (${day})`; };
const sourceIdOf = (kind: Kind, id: number) => (kind === "as" ? `as:${id}` : String(id));
const validMobile = (v: string) => /^01\d{8,9}$/.test(v);
const dashPhone = (v: string) => v.replace(/(\d{3})(\d{3,4})(\d{4})/, "$1-$2-$3");
const workLinesOf = (d: ReportDevice) => String(d.work || "").split(/\n|\s\/\s/).map((l) => l.replace(/^\d+[.)]\s*/, "").trim()).filter(Boolean);
const linesOf = (text: string) => String(text || "").split(/\n/).map((l) => l.trim()).filter(Boolean);
// 양식의 처리내용 → 고객용 기본 문구. 정기점검만 적혔으면 표준 문구, 아니면 원문을 넣어 두고 사람이 고친다
const defaultNote = (kind: Kind, d: ReportDevice) => {
  const lines = workLinesOf(d);
  if (kind === "as") return lines.length ? lines.join("\n") : SIMPLE_NOTE.as;
  if (!lines.length || /^정기점검$/.test(lines.join(""))) return SIMPLE_NOTE.inspection;
  return `${lines.join("\n")}\n카운터 확인 및 여분 재고 점검`;
};

// 카드 DOM → MMS용 JPG(data URL, ≤200KB·긴 변 1440) + 원본 크기 PNG(링크용)
async function renderCard(node: HTMLElement): Promise<{ mms: string; full: Blob } | null> {
  const { default: html2canvas } = await import("html2canvas-pro");
  const source = await html2canvas(node, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
  const full = await new Promise<Blob | null>((resolve) => source.toBlob(resolve, "image/png"));
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx || !full) return null;
  const width = source.width, height = source.height;
  let ratio = Math.min(1, 1500 / width, 1440 / height); // 솔라피 MMS 최대 1500×1440 — 상자 안에서 가장 크게
  for (let round = 0; round < 6; round++) {
    const w = Math.max(1, Math.round(width * ratio)), h = Math.max(1, Math.round(height * ratio));
    for (const q of [0.92, 0.86, 0.8, 0.72, 0.64, 0.56]) {
      canvas.width = w; canvas.height = h; ctx.imageSmoothingQuality = "high"; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.drawImage(source, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", q));
      if (blob && blob.size <= 200 * 1024) {
        const mms = await new Promise<string>((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.onerror = () => reject(fr.error); fr.readAsDataURL(blob); });
        return { mms, full };
      }
    }
    ratio *= 0.85;
  }
  return null;
}

// ── 리포트 카드(고객이 받는 그림 그대로). 색은 이미지라 고정값 ──
function ReportCard({ kind, data, prev, prevDate, date, author, notes, contents, cardRef }: { kind: Kind; data: ReportData; prev: ReportData | null; prevDate: string; date: string; author: string; notes: Texts; contents: Texts; cardRef: React.RefObject<HTMLDivElement | null> }) {
  const month = Number(date.slice(5, 7));
  const multi = data.devices.length >= 2; // 여러 대도 1대와 같은 구성으로 세로로 쌓는다(사용자 선택). 문자 그림이 작아지는 건 원본 크기 링크로 보완
  const ink = "#1c2230", ink2 = "#4a5567", ink3 = "#8a93a3", line = "#e3e7ee", panel = "#f4f6f9", accent = "#1f9d8a", accentSoft = "#e2f4f0", warn = "#d98a1a", warnSoft = "#fbf0dc";
  const H = ({ children, tag, warnTag }: { children: ReactNode; tag?: string; warnTag?: boolean }) => <div className="flex items-baseline justify-between gap-3"><div style={{ color: ink3 }} className="text-[12px] font-black uppercase tracking-[.12em]">{children}</div>{tag && <span style={{ background: warnTag ? warnSoft : accentSoft, color: warnTag ? warn : accent }} className="rounded-full px-2.5 py-1 text-[12px] font-bold">{tag}</span>}</div>;
  const Check = ({ children, warnMark }: { children: ReactNode; warnMark?: boolean }) => <li className="grid grid-cols-[22px_1fr] gap-2.5 text-[14px] leading-relaxed"><span style={{ background: warnMark ? warnSoft : accentSoft, color: warnMark ? warn : accent, width: 20, height: 20, marginTop: 2 }} className="grid place-items-center rounded-full text-[12px] font-black">{warnMark ? "!" : "✓"}</span><span>{children}</span></li>;
  const Dot = ({ color, size = 12 }: { color: string; size?: number }) => <i style={{ background: color, width: size, height: size, borderRadius: Math.round(size / 3), display: "inline-block" }} />;
  const footer = <div className="grid gap-3 pt-1">
    <div style={{ background: accentSoft }} className="grid grid-cols-[6px_1fr] gap-3.5 rounded-[14px] px-4 py-3.5">
      <div style={{ background: accent, borderRadius: 999 }} />
      {kind === "as"
        ? <div><div style={{ color: accent }} className="text-[11px] font-black uppercase tracking-[.12em]">처리 후 확인</div><div style={{ color: ink }} className="mt-1 text-[14px] font-bold leading-relaxed">처리 후 같은 증상이 다시 나타나면 바로 말씀해 주세요. 우선으로 다시 살펴보겠습니다.</div></div>
        : <div><div style={{ color: accent }} className="text-[11px] font-black uppercase tracking-[.12em]">다음 정기점검</div><div style={{ color: ink }} className="mt-1 text-[14px] font-bold leading-relaxed">방문 전에 미리 연락드리고 찾아뵙겠습니다. 토너·여분은 그때 다시 확인해 채워 드립니다.</div></div>}
    </div>
    <div style={{ background: "#1e252f", color: "#fff" }} className="grid grid-cols-[1fr_auto] items-center gap-5 rounded-[14px] px-5 py-4">
      <div><div style={{ color: "#aeb8c8" }} className="text-[11px] font-black uppercase tracking-[.12em]">언제든 연락 주세요</div><div className="mt-1 text-[14px] font-bold leading-relaxed">기기가 불편하거나 토너·소모품이 필요하실 때<br />전화 한 통이면 담당자가 바로 찾아뵙겠습니다.</div></div>
      <div className="text-right"><div style={{ color: "#8fd8cb" }} className="text-[11px] font-black tracking-wide">퍼스트전산 대표번호</div><div className="text-[28px] font-black leading-tight tracking-tight">{COMPANY_PHONE}</div></div>
    </div>
  </div>;
  return <div ref={cardRef} style={{ width: 720, background: "#fff", color: ink, fontVariantNumeric: "tabular-nums" }} className="overflow-hidden rounded-[22px] shadow-[0_18px_50px_rgba(20,28,40,.18)]">
    <div style={{ background: "#1e252f", color: "#fff" }} className="relative px-7 pb-6 pt-7">
      <div style={{ position: "absolute", right: -40, top: -60, width: 220, height: 220, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(31,157,138,.35), rgba(31,157,138,0))" }} />
      <div className="relative flex items-center justify-between gap-3">
        <div className="text-[15px] font-black tracking-wide">FIRST<span style={{ color: "#8fd8cb" }}>OA</span> 퍼스트전산</div>
        <div style={{ color: "#aeb8c8" }} className="text-[11px] font-medium uppercase tracking-[.14em]">{kind === "as" ? "Service Report" : "Monthly Service Report"}</div>
      </div>
      <div className="relative mt-4 text-[26px] font-black leading-tight tracking-tight">{data.vendor}<br />{kind === "as" ? "AS 처리 리포트" : `${month}월 정기점검 리포트`}</div>
      <div style={{ color: "#c9d1dd" }} className="relative mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        <span>방문 <b className="text-white">{koreanDate(date)}{data.arrival ? ` ${data.arrival}` : ""}</b></span>
        <span>담당 <b className="text-white">{author}</b></span>
        {data.keymanName && <span>키맨 <b className="text-white">{data.keymanName}님</b></span>}
        {multi && <span>기기 <b className="text-white">{data.devices.length}대</b></span>}
      </div>
    </div>
    <div className="grid gap-5 px-7 pb-7 pt-1">
      {data.devices.map((d) => {
        const p = kind === "inspection" ? matchPrevious(d, prev) : null;
        const dm = p ? delta(d.mono, p.mono) : null, dc = p ? delta(d.color, p.color) : null;
        const lows = TONER.filter(([k]) => tonerLow(d.toner[k])).map(([, name]) => name);
        const hasToner = TONER.some(([k]) => d.toner[k] != null);
        const acts = [...linesOf(notes[d.index] ?? defaultNote(kind, d)), ...(lows.length ? [`${lows.join("·")} 토너 교체 필요 — 여분으로 교체해 드립니다`] : [])];
        const content = kind === "as" ? (contents[d.index] ?? d.content) : "";
        const verdict = lows.length ? "토너 교체 필요" : wasteLow(d.waste) ? "폐토너통 교체 예정" : kind === "as" ? "처리 완료" : "이상 없음";
        const alert = lows.length > 0 || wasteLow(d.waste);
        return <div key={d.index} className="grid gap-5">
          <div style={{ borderBottom: `1px solid ${line}` }} className="grid grid-cols-[1fr_auto] items-center gap-3 pb-4 pt-4">
            <div>
              <div className="text-[22px] font-bold tracking-tight">{multi && <span style={{ background: accentSoft, color: accent }} className="mr-2 rounded-full px-2.5 py-0.5 align-middle text-[12px] font-black">{d.index}호기</span>}{d.model || "복합기"}</div>
              <div style={{ color: ink2 }} className="mt-1 flex flex-wrap gap-x-3.5 text-[13px]">{d.asset && <span>관리번호 {d.asset}</span>}{d.serial && <span>S/N {d.serial}</span>}</div>
            </div>
            <div style={{ color: ink3 }} className="text-right text-[12px]">{kind === "as" ? "처리 결과" : "점검 결과"}<b style={{ color: alert ? warn : ink }} className="block text-[18px] font-bold">{verdict}</b></div>
          </div>
          {kind === "as" && content && <div className="grid gap-2.5">
            <H>접수 내용</H>
            <div style={{ background: panel, color: ink }} className="whitespace-pre-wrap rounded-[14px] px-4 py-3.5 text-[14px] leading-relaxed">{content}</div>
          </div>}
          {kind === "as" && <div className="grid gap-2.5">
            <H tag="완료">처리 내용</H>
            <ul className="m-0 grid list-none gap-2 p-0">{acts.map((a, i) => <Check key={i}>{a}</Check>)}{d.note && <Check warnMark>확인 사항: {d.note}</Check>}</ul>
          </div>}
          {(d.mono != null || d.color != null) && <div className="grid gap-2.5">
            <H tag="누적 카운터 기준">사용량</H>
            <div className="grid grid-cols-2 gap-2.5">
              {[["흑백", d.mono, dm], ["컬러", d.color, dc]].map(([k, v, dv]) => <div key={String(k)} style={{ background: panel }} className="rounded-[14px] px-4 py-3.5">
                <div style={{ color: ink2 }} className="text-[12px] font-medium">{k as string}</div>
                <div className="mt-1 text-[28px] font-bold tracking-tight">{fmt(v as number | null)}<small style={{ color: ink3 }} className="ml-0.5 text-[13px] font-medium">매</small></div>
                {dv != null && <div style={{ color: ink2 }} className="mt-1.5 text-[12px]">지난 점검({shortDate(prevDate)}) 대비 <b style={{ color: accent }}>+{fmt(dv as number)}매</b></div>}
              </div>)}
            </div>
          </div>}
          {hasToner && <div className="grid gap-2.5">
            <H tag={lows.length ? `${lows.join("·")} 교체 필요` : "교체 필요 없음"} warnTag={lows.length > 0}>토너 잔량</H>
            <div className="grid gap-2">
              {TONER.map(([k, name, color]) => { const v = d.toner[k]; return <div key={k} className="grid grid-cols-[52px_1fr_44px] items-center gap-3">
                <div className="flex items-center gap-1.5 text-[13px] font-bold"><Dot color={color} />{name}</div>
                <div style={{ background: panel, height: 12, borderRadius: 999, position: "relative", overflow: "hidden" }}><b style={{ display: "block", height: "100%", borderRadius: 999, width: `${v ?? 0}%`, background: color }} /><i style={{ position: "absolute", left: "25%", top: 0, bottom: 0, width: 1, background: "rgba(0,0,0,.18)" }} /></div>
                <div style={{ color: tonerLow(v) ? warn : ink }} className="text-right text-[14px] font-bold">{v == null ? "-" : `${v}%`}</div>
              </div>; })}
            </div>
            <div style={{ color: ink3 }} className="text-[11px]">세로선(25%)에 닿기 전에 여분으로 교체해 드립니다.</div>
            {d.waste != null && <div style={{ background: wasteLow(d.waste) ? warnSoft : panel }} className="grid grid-cols-[1fr_auto] items-center gap-3.5 rounded-[14px] px-4 py-3">
              <div style={{ color: wasteLow(d.waste) ? "#7a4d06" : ink }} className="text-[13px] font-bold">폐토너통 남은 여유<small style={{ color: wasteLow(d.waste) ? "#9a6a1f" : ink3 }} className="mt-0.5 block text-[12px] font-medium">{wasteLow(d.waste) ? "다음 방문 때 새것으로 교체 예정" : "아직 여유 있음"}</small></div>
              <div style={{ color: wasteLow(d.waste) ? warn : ink }} className="text-[22px] font-bold">{d.waste}%</div>
            </div>}
          </div>}
          {Object.values(d.spare).some((v) => v != null) && <div className="grid gap-2.5">
            <H>사무실 보관 여분</H>
            <div className="flex flex-wrap gap-2">
              {TONER.map(([k, name, color]) => d.spare[k] != null && <span key={k} style={{ border: `1px solid ${line}` }} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-bold"><Dot color={color} size={10} />{name} {d.spare[k]}</span>)}
              {d.spare.W != null && <span style={{ border: `1px solid ${line}` }} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-bold"><Dot color="#9aa3b2" size={10} />폐토너통 {d.spare.W}</span>}
            </div>
            {d.spareNote && <div style={{ color: ink2 }} className="text-[12px]">보관 위치 · {d.spareNote}</div>}
          </div>}
          {kind === "inspection" && <div className="grid gap-2.5">
            <H>오늘 조치</H>
            <ul className="m-0 grid list-none gap-2 p-0">{acts.map((a, i) => <Check key={i}>{a}</Check>)}{d.note && <Check warnMark>확인 사항: {d.note}</Check>}</ul>
          </div>}
        </div>;
      })}
      {footer}
    </div>
  </div>;
}

export default function InspectionReportBoard({ author, switcher }: { author: string; switcher?: ReactNode }) {
  const [kind, setKind] = useState<Kind>("inspection");
  const [rows, setRows] = useState<FormRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [mine, setMine] = useState(true);
  const [days, setDays] = useState<30 | 90>(30);
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sent, setSent] = useState<Map<string, string>>(new Map());
  const [prev, setPrev] = useState<{ data: ReportData; date: string } | null>(null);
  const [phone, setPhone] = useState("");
  const [keymanName, setKeymanName] = useState(""); // 리포트에 찍히는 키맨 이름 — 양식이 이상하면 여기서 고쳐 보낸다
  const [vendorName, setVendorName] = useState(""); // 리포트에 찍히는 업체명 — 양식엔 별칭·지점이 붙어 오기도 한다
  const [notes, setNotes] = useState<Texts>({});       // 기기별 고객용 조치(처리) 문구
  const [contents, setContents] = useState<Texts>({}); // AS 접수 내용(고객용)
  const [kakaoUrl, setKakaoUrl] = useState(KAKAO_CHANNEL_URL);
  useEffect(() => { getConfig().then((cfg) => { if (cfg.KAKAO_CHANNEL_URL) setKakaoUrl(cfg.KAKAO_CHANNEL_URL.trim()); }).catch(() => undefined); }, []);
  const [testPhone, setTestPhone] = useState(() => { try { return localStorage.getItem(TEST_PHONE_KEY) || ""; } catch { return ""; } });
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState<{ src: string; kb: number } | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const table = kind === "as" ? "as_records" : "jeomgeom";

  const load = async () => {
    setLoading(true);
    try {
      const since = kstDate(new Date(Date.now() - days * 86400_000));
      const who = mine && author ? `&${enc("작성자")}=eq.${enc(author)}` : "";
      const gubun = kind === "as" ? "*AS*" : "*점검*";
      const [list, jobs] = await Promise.all([
        selectRows<FormRow>(table, `select=${enc(COLS)}&_hidden=is.false&${enc("작성일")}=gte.${since}&${enc("구분")}=ilike.${enc(gubun)}${who}&order=${enc("작성일")}.desc,created_at.desc&limit=300`),
        selectRows<{ source_id: string; sent_at: string | null }>("message_jobs", "select=source_id,sent_at&source_type=eq.inspection_report&status=eq.sent&limit=2000").catch(() => []),
      ]);
      setRows(list);
      setSent(new Map(jobs.map((j) => [String(j.source_id), String(j.sent_at || "")])));
    } catch (e) { notify((e as Error).message, "error"); }
    finally { setLoading(false); }
  };
  useEffect(() => { setSelectedId(null); void load(); }, [kind, mine, days, author]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => { const k = q.trim().toLowerCase(); return k ? rows.filter((r) => `${r.업체명} ${r.모델명} ${r.작성자}`.toLowerCase().includes(k)) : rows; }, [rows, q]);
  const selected = useMemo(() => rows.find((r) => r.id === selectedId) || null, [rows, selectedId]);
  const parsed = useMemo(() => (selected ? parseInspectionForm(selected._원문) : null), [selected]);
  const data = useMemo(() => (parsed ? { ...parsed, keymanName: keymanName.trim(), vendor: vendorName.trim() || parsed.vendor } : null), [parsed, keymanName, vendorName]);
  const sentAt = selected ? sent.get(sourceIdOf(kind, selected.id)) : undefined;

  // 선택한 건이 바뀌면: 받는 번호·키맨 이름·고객용 문구를 양식에서 채우고, 직전 점검(같은 업체·이전 날짜 — 점검만)을 찾는다
  useEffect(() => {
    if (!selected || !parsed) { setPrev(null); return; }
    setPhone(parsed.keymanPhone);
    setKeymanName(parsed.keymanName);
    setVendorName(parsed.vendor);
    setNotes(Object.fromEntries(parsed.devices.map((d) => [d.index, defaultNote(kind, d)])));
    setContents(Object.fromEntries(parsed.devices.map((d) => [d.index, d.content])));
    if (kind !== "inspection") { setPrev(null); return; }
    let live = true;
    const vendor = selected._업체명 || selected.업체명;
    selectRows<FormRow>("jeomgeom", `select=${enc(COLS)}&_hidden=is.false&${enc("_업체명")}=eq.${enc(vendor)}&${enc("작성일")}=lt.${selected.작성일}&${enc("구분")}=ilike.${enc("*점검*")}&order=${enc("작성일")}.desc,created_at.desc&limit=1`)
      .then((r) => { if (live) setPrev(r[0] ? { data: parseInspectionForm(r[0]._원문), date: r[0].작성일 } : null); })
      .catch(() => { if (live) setPrev(null); });
    return () => { live = false; };
  }, [selected, parsed, kind]);

  const makeImage = async (): Promise<{ mms: string; full: Blob } | null> => {
    const node = cardRef.current; if (!node) return null;
    setBusy("이미지 만드는 중…");
    try { return await renderCard(node); }
    catch (e) { notify(`이미지 생성 실패: ${(e as Error).message}`, "error"); return null; }
    finally { setBusy(""); }
  };
  const showPreview = async () => {
    const img = await makeImage();
    if (!img) { notify("이미지를 만들지 못했습니다", "error"); return; }
    setPreview({ src: img.mms, kb: Math.round((img.mms.length * 3) / 4 / 1024) });
  };
  // 원본 크기 PNG를 올려 링크로 — 실패하면 링크 없이 보낸다
  const uploadFull = async (full: Blob): Promise<string> => {
    if (!selected) return "";
    try { return await uploadPublicFile("reports", `inspection/${kind}-${selected.id}-${Date.now()}.png`, full, "image/png"); }
    catch { return ""; }
  };
  const smsText = (test: boolean, fullUrl: string) => {
    if (!selected || !data) return "";
    const month = Number(selected.작성일.slice(5, 7));
    const head = kind === "as" ? `${data.vendor} AS 처리 리포트를 보내드립니다.\n접수하신 내용과 처리 결과를 사진으로 정리했습니다.` : `${data.vendor} ${month}월 정기점검 리포트를 보내드립니다.\n오늘 확인한 사용량·토너 잔량·여분과 다음 안내를 사진으로 정리했습니다.`;
    // 끝맺음(2026-09-30 확정): 담당 이름 · 대표번호 · 카카오톡 플러스친구
    const tail = [`퍼스트전산 CS팀 ${selected.작성자 || author}`, `📞 대표번호: ${COMPANY_PHONE}`, kakaoUrl ? `💬 카카오톡 플러스친구: ${kakaoUrl}` : ""].filter(Boolean).join("\n");
    return `${test ? "[테스트] " : ""}[퍼스트전산] ${head}${fullUrl ? `\n🔍 리포트 크게 보기: ${fullUrl}` : ""}\n\n${tail}`;
  };
  const deliver = async (to: string, test: boolean): Promise<string | null> => {
    if (!selected || !data) return null;
    const img = await makeImage();
    if (!img) { notify("이미지를 만들지 못해 보내지 않았습니다", "error"); return null; }
    setBusy(test ? "테스트 보내는 중…" : "보내는 중…");
    try {
      const fullUrl = await uploadFull(img.full);
      const text = smsText(test, fullUrl);
      const month = Number(selected.작성일.slice(5, 7));
      await invokeEdgeFunction("customer-message-send", { channel: "sms", type: "inspection_report", to, text, imageBase64: img.mms.replace(/^data:image\/\w+;base64,/, ""), subject: kind === "as" ? "AS 처리 리포트" : `${month}월 정기점검 리포트` });
      return text;
    } catch (e) { notify(`발송 실패: ${(e as Error).message}`, "error"); return null; }
    finally { setBusy(""); }
  };
  // 고객 발송 — 확인창 → 이미지 → MMS → 기록
  const send = async () => {
    if (!selected || !data) return;
    const to = phone.replace(/[^\d]/g, "");
    if (!validMobile(to)) { notify("받는 휴대폰 번호를 확인해 주세요 (양식의 키맨 번호가 없으면 직접 입력)", "error"); return; }
    if (sentAt && !(await askConfirm(`이 리포트는 ${sentAt.slice(0, 16).replace("T", " ")}에 이미 보냈습니다. 다시 보낼까요?`, { okLabel: "다시 보내기" }))) return;
    const h = kstHour();
    if ((h < 10 || h >= 19) && !(await askConfirm(`지금은 ${h}시입니다. 업무시간(10~19시) 밖인데 그래도 보낼까요?`, { danger: true, okLabel: "지금 보내기" }))) return;
    if (!(await askConfirm(`${data.vendor}\n${data.keymanName || "키맨"} ${dashPhone(to)}\n\n${kind === "as" ? "AS 처리" : `${Number(selected.작성일.slice(5, 7))}월 정기점검`} 리포트 이미지를 문자(MMS)로 보낼까요?\n카드 위 '고객에게 보이는 문구'를 확인했는지 한 번 더 보세요.`, { okLabel: "보내기" }))) return;
    const text = await deliver(to, false);
    if (text == null) return;
    const now = new Date().toISOString();
    const sid = sourceIdOf(kind, selected.id);
    await insertRow("message_jobs", { id: crypto.randomUUID(), source_type: "inspection_report", source_id: sid, channel: "sms", recipient: to, message: text, payload: { type: "inspection_report", kind, vendor: data.vendor, author, date: selected.작성일, keyman: data.keymanName }, status: "sent", scheduled_at: now, sent_at: now, created_by: author }).catch(() => undefined);
    setSent((cur) => new Map(cur).set(sid, now));
    notify(`${data.vendor}에 리포트를 보냈습니다`, "success");
  };
  // 테스트 발송 — 직원 번호로 같은 이미지. 기록하지 않고 업무시간도 묻지 않는다
  const sendTest = async () => {
    if (!selected || !data) return;
    const to = testPhone.replace(/[^\d]/g, "");
    if (!validMobile(to)) { notify("테스트 받을 휴대폰 번호(직원)를 넣어 주세요", "error"); return; }
    try { localStorage.setItem(TEST_PHONE_KEY, to); } catch { /* 무시 */ }
    if (!(await askConfirm(`${dashPhone(to)} (직원 번호)로 테스트 문자를 보낼까요?\n문자 앞에 [테스트]가 붙고 발송 기록엔 남지 않습니다.`, { okLabel: "테스트 보내기" }))) return;
    if ((await deliver(to, true)) != null) notify(`테스트 문자를 ${dashPhone(to)}로 보냈습니다`, "success");
  };

  const PILL = (on: boolean) => `rounded-full px-3 py-1.5 text-[12px] font-black transition ${on ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-500 hover:text-slate-900"}`;
  const TA = "w-full resize-y rounded-lg border border-slate-200 bg-[#FFFBEB] px-3 py-2 text-[12px] font-semibold leading-5 text-slate-800 outline-none focus:border-slate-400 focus:bg-white";
  const kindLabel = kind === "as" ? "AS" : "점검";
  return <div className="space-y-4">
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-start justify-between gap-3 bg-[#1E252F] px-5 py-4">
        <div className="min-w-0"><div className="text-[11px] font-black text-slate-400">방문 후 · 고객 전달</div><div className="text-lg font-black text-white">점검 리포트</div><div className="mt-0.5 text-[12px] font-semibold text-slate-400">점검·AS 양식이 그대로 고객용 리포트 이미지가 됩니다. 간 곳을 고르고, 고객에게 보이는 문구를 확인한 뒤 [리포트 발송]</div></div>
        {switcher}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <button type="button" onClick={() => setKind("inspection")} className={PILL(kind === "inspection")}>점검</button>
        <button type="button" onClick={() => setKind("as")} className={PILL(kind === "as")}>AS</button>
        <span className="mx-1 h-4 w-px bg-slate-200" />
        <button type="button" onClick={() => setMine(true)} className={PILL(mine)}>내 것</button>
        <button type="button" onClick={() => setMine(false)} className={PILL(!mine)}>전체</button>
        <span className="mx-1 h-4 w-px bg-slate-200" />
        <button type="button" onClick={() => setDays(30)} className={PILL(days === 30)}>최근 30일</button>
        <button type="button" onClick={() => setDays(90)} className={PILL(days === 90)}>90일</button>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="업체·기종 검색" className="ml-auto w-full rounded-full border border-slate-200 px-3 py-1.5 text-[12px] font-semibold outline-none focus:border-slate-400 sm:w-48" />
        <button type="button" onClick={() => void load()} title="다시 읽기" className="rounded-full border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50"><RefreshCw size={14} /></button>
      </div>
    </section>

    <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-2.5 text-[11px] font-black text-slate-400">{kindLabel} {filtered.length}건{loading ? " · 불러오는 중…" : ""}</div>
        <div className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
          {!loading && !filtered.length && <div className="px-4 py-10 text-center text-[12px] font-semibold text-slate-400">기간 안에 {kindLabel} 기록이 없습니다</div>}
          {filtered.map((r) => { const on = r.id === selectedId; const s = sent.get(sourceIdOf(kind, r.id)); return <button key={r.id} type="button" onClick={() => setSelectedId(r.id)} className={`block w-full px-4 py-2.5 text-left transition ${on ? "bg-slate-900 text-white" : "hover:bg-slate-50"}`}>
            <div className="flex items-center justify-between gap-2"><span className={`text-[11px] font-bold tabular-nums ${on ? "text-slate-300" : "text-slate-400"}`}>{r.작성일}{!mine && r.작성자 ? ` · ${r.작성자}` : ""}</span>{s && <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${on ? "bg-white/20 text-white" : "bg-emerald-50 text-emerald-700"}`}>발송됨 {shortDate(s.slice(0, 10))}</span>}</div>
            <div className="mt-0.5 truncate text-[13px] font-black">{r.업체명}</div>
            <div className={`truncate text-[11px] font-semibold ${on ? "text-slate-300" : "text-slate-500"}`}>{r.모델명 || "기종 미기재"}{r.자산기번 ? ` · ${r.자산기번}` : ""}</div>
          </button>; })}
        </div>
      </section>

      <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {!selected || !data ? <div className="px-4 py-16 text-center text-[13px] font-semibold text-slate-400">왼쪽에서 간 곳을 고르면 리포트가 여기 만들어집니다</div> : <>
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
            <label className="flex items-center gap-2 text-[12px] font-bold text-slate-600">받는 번호<input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="키맨 휴대폰" className="w-40 rounded-full border border-slate-200 px-3 py-1.5 text-[12px] font-semibold tabular-nums outline-none focus:border-slate-400" /></label>
            <label className="flex items-center gap-2 text-[12px] font-bold text-slate-600">업체명<input value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="리포트에 찍히는 업체명" className="w-52 rounded-full border border-slate-200 px-3 py-1.5 text-[12px] font-semibold outline-none focus:border-slate-400" /></label>
            <label className="flex items-center gap-2 text-[12px] font-bold text-slate-600">키맨 이름<input value={keymanName} onChange={(e) => setKeymanName(e.target.value)} placeholder="예: 위지혜 팀장" className="w-36 rounded-full border border-slate-200 px-3 py-1.5 text-[12px] font-semibold outline-none focus:border-slate-400" /></label>
            {!data.keymanPhone && <span className="text-[11px] font-bold text-rose-600">양식에 휴대폰 번호가 없어 직접 넣어야 합니다</span>}
            <div className="ml-auto flex flex-wrap gap-2">
              <button type="button" disabled={!!busy} onClick={() => void showPreview()} className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3.5 py-2 text-[12px] font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"><ImageIcon size={14} />이미지 미리보기</button>
              <button type="button" disabled={!!busy} onClick={() => void send()} className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-2 text-[12px] font-black text-white shadow-[0_3px_10px_rgba(37,99,235,0.3)] transition hover:bg-blue-700 disabled:opacity-50"><Send size={14} />{busy || "리포트 발송"}</button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-amber-50/60 px-4 py-2">
            <FlaskConical size={13} className="text-amber-700" />
            <label className="flex items-center gap-2 text-[11px] font-bold text-amber-800">테스트 번호(직원)<input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="010-0000-0000" className="w-36 rounded-full border border-amber-200 bg-white px-3 py-1 text-[12px] font-semibold tabular-nums outline-none focus:border-amber-400" /></label>
            <button type="button" disabled={!!busy} onClick={() => void sendTest()} className="rounded-full border border-amber-300 bg-white px-3 py-1 text-[11px] font-black text-amber-800 transition hover:bg-amber-100 disabled:opacity-50">이 번호로 테스트 발송</button>
            <span className="text-[11px] font-semibold text-amber-700">고객에게 가지 않고, 기록에도 남지 않습니다. 문자 앞에 [테스트]가 붙습니다.</span>
          </div>
          {/* 고객용 문구 — 양식의 처리내용은 CS끼리 쓰는 메모라 그대로 못 보낸다. 미리 채워 두고 여기서 고친다 */}
          <div className="grid gap-2 border-b border-slate-100 px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2"><div className="text-[12px] font-black text-slate-700">고객에게 보이는 문구</div><div className="text-[11px] font-semibold text-slate-400">양식의 {kind === "as" ? "접수·처리 내용" : "처리내용"}을 그대로 넣어 두었습니다. 내부 메모는 지우거나 고객 말로 고친 뒤 보내세요.</div></div>
            {data.devices.map((d) => <div key={d.index} className="grid gap-1.5 rounded-lg border border-slate-200 p-2.5">
              <div className="flex items-center justify-between gap-2"><span className="text-[12px] font-black text-slate-800">{d.model || "복합기"}{data.devices.length > 1 ? ` · ${d.index}호기` : ""}</span><button type="button" onClick={() => setNotes((cur) => ({ ...cur, [d.index]: SIMPLE_NOTE[kind] }))} className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-500 hover:bg-slate-50 hover:text-slate-900">{kind === "as" ? "처리 완료로만" : "정기점검 완료로만"}</button></div>
              {kind === "as" && <label className="grid gap-1 text-[11px] font-bold text-slate-500">접수 내용<textarea rows={2} value={contents[d.index] ?? d.content} onChange={(e) => setContents((cur) => ({ ...cur, [d.index]: e.target.value }))} className={TA} /></label>}
              <label className="grid gap-1 text-[11px] font-bold text-slate-500">{kind === "as" ? "처리 내용 (한 줄에 하나)" : "오늘 조치 (한 줄에 하나)"}<textarea rows={3} value={notes[d.index] ?? defaultNote(kind, d)} onChange={(e) => setNotes((cur) => ({ ...cur, [d.index]: e.target.value }))} className={TA} /></label>
            </div>)}
          </div>
          {prev && <div className="border-b border-slate-100 bg-slate-50 px-4 py-1.5 text-[11px] font-semibold text-slate-500">직전 점검 {prev.date} 기록과 비교해 사용량 증가분을 넣었습니다{data.devices.length > 1 ? " · 기기가 여러 대라 문자 그림은 작게 보입니다(원본 크기 링크가 함께 갑니다)" : ""}</div>}
          <div className="overflow-x-auto bg-slate-100 p-4"><ReportCard kind={kind} data={data} prev={prev?.data || null} prevDate={prev?.date || ""} date={selected.작성일} author={selected.작성자 || author} notes={notes} contents={contents} cardRef={cardRef} /></div>
        </>}
      </section>
    </div>

    {preview && <div className="fixed inset-0 z-[2400] flex items-center justify-center bg-black/60 p-4" onMouseDown={() => setPreview(null)}>
      <div className="max-h-[92vh] w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-[#1E252F] px-4 py-3 text-white"><div className="text-[13px] font-black">문자로 가는 이미지 그대로 · {preview.kb}KB</div><button type="button" onClick={() => setPreview(null)} className="rounded-full px-2 py-1 text-[12px] font-bold text-slate-300 hover:text-white">닫기</button></div>
        <div className="max-h-[80vh] overflow-y-auto bg-slate-200 p-3"><img src={preview.src} alt="리포트 미리보기" className="mx-auto block w-full rounded-lg" /></div>
      </div>
    </div>}
  </div>;
}
