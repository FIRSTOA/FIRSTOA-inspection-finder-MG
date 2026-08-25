/**
 * 도움말 — 화면별 사용설명서 모음. 설명서는 /guide/*.html 정적 페이지(계정 없이 열림)이고,
 * 여기서는 목록 + 앱 안에서 바로 펼쳐 읽기(iframe) + 새 탭·링크 복사만 담당한다.
 * 새 설명서는 GUIDES에 한 줄 추가하고 public/guide/에 파일을 두면 된다.
 */
import { useState } from "react";
import { BookOpen, Copy, ExternalLink } from "lucide-react";
import { notify } from "./toast";

type Guide = { key: string; title: string; desc: string; url?: string; updated?: string };
const GUIDES: Guide[] = [
  { key: "schedule", title: "일정리스트 길잡이", desc: "FIELD·배정·완료·익일·삭제 버튼, 제목 수정과 네이버 캘린더 연동, 금일·익일·예정·내 일정 탭, 중간보고", url: "/guide/schedule.html", updated: "2026-08-25" },
  { key: "field", title: "FIELD 보고양식", desc: "점검·AS 양식 작성, 사진, 카톡방 전송, 자가·부품 신청" },
  { key: "autoplan", title: "자동일정 · 내 일정", desc: "가까운 점검 후보 추천, 기준 업체, 일정 등록" },
  { key: "workin", title: "워킹맵", desc: "분기 점검 대상, 라벨, 엑셀 가져오기" },
  { key: "recontract", title: "재계약 준비", desc: "이카운트 대장 붙여넣기, 기기별 활용률, 추천 플랜" },
];

export default function HelpCenter() {
  const [picked, setPicked] = useState<Guide>(GUIDES[0]);
  const fullUrl = picked.url ? `${window.location.origin}${picked.url}` : "";
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(fullUrl); notify("링크를 복사했습니다 — 카톡방에 붙여넣으면 누구나 열 수 있어요", "success"); }
    catch { notify("복사 실패 — 주소창의 링크를 직접 복사해 주세요", "error"); }
  };
  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-[#1E252F] px-5 py-4 text-white">
        <div className="flex items-center gap-2 text-lg font-black"><BookOpen size={18} /> 도움말</div>
        <p className="mt-0.5 text-[12px] font-semibold text-slate-400">화면별 사용설명서. 처음 쓰는 분 기준으로 버튼 하나하나 설명합니다 · 링크는 로그인 없이 열립니다</p>
      </section>
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-2">
          {GUIDES.map((g) => (
            <button key={g.key} type="button" onClick={() => setPicked(g)} disabled={!g.url}
              className={`w-full rounded-2xl border px-4 py-3 text-left transition ${picked.key === g.key ? "border-blue-500 bg-blue-50 shadow-sm" : "border-slate-200 bg-white hover:bg-slate-50"} disabled:cursor-not-allowed disabled:opacity-60`}>
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-black text-slate-900">{g.title}</span>
                {!g.url && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">준비 중</span>}
              </div>
              <div className="mt-0.5 text-[12px] leading-5 text-slate-500">{g.desc}</div>
              {g.updated && <div className="mt-1 text-[10px] font-bold text-slate-400">{g.updated} 갱신</div>}
            </button>
          ))}
        </aside>
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
            <div className="text-[13px] font-black text-slate-900">{picked.title}</div>
            {picked.url && (
              <div className="flex gap-1.5">
                <button type="button" onClick={() => void copyLink()} className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-black text-slate-600 hover:bg-slate-50"><Copy size={12} /> 링크 복사</button>
                <a href={picked.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-3 py-1 text-[11px] font-black text-white hover:bg-slate-800"><ExternalLink size={12} /> 새 탭으로</a>
              </div>
            )}
          </div>
          {picked.url
            ? <iframe title={picked.title} src={picked.url} className="h-[78vh] w-full bg-white" />
            : <div className="px-6 py-16 text-center text-sm font-semibold text-slate-400">이 설명서는 준비 중입니다</div>}
        </section>
      </div>
    </div>
  );
}
