/**
 * 도움말 — 화면별 사용설명서 모음. 설명서는 /guide/*.html 정적 페이지(계정 없이 열림)이고,
 * 여기서는 목록 + 앱 안에서 바로 펼쳐 읽기(iframe) + 새 탭·링크 복사만 담당한다.
 * 새 설명서는 GUIDES에 한 줄 추가하고 public/guide/에 파일을 두면 된다.
 */
import { useState } from "react";
import { BookOpen, Copy, ExternalLink } from "lucide-react";
import { notify } from "./toast";

type Guide = { key: string; title: string; desc: string; url?: string; updated?: string; group: string };
// 사이드바 순서 그대로. url이 없는 항목은 "준비 중"으로 보인다. 새 설명서 = public/guide/에 파일 + 여기 한 줄.
const GUIDES: Guide[] = [
  { group: "기본", key: "home", title: "홈", desc: "오늘 요약·바로가기·공지 카드", url: "/guide/home.html", updated: "2026-08-26" },
  { group: "기본", key: "reception", title: "서비스접수", desc: "접수 양식 작성, 임대리스트 자동 채움, 카톡 전송, 일정 자동 등록", url: "/guide/reception.html", updated: "2026-08-26" },
  { group: "기본", key: "schedule", title: "일정리스트", desc: "FIELD·배정·완료·익일·삭제, 제목 수정과 네이버 연동, 금일·익일·예정·내 일정, 중간보고", url: "/guide/schedule.html", updated: "2026-08-26" },
  { group: "기본", key: "calendar", title: "캘린더", desc: "월 보기, 네이버 직접 일정, 드래그 이동, 팀 전용 캘린더", url: "/guide/calendar.html", updated: "2026-08-26" },
  { group: "현장·동선", key: "workin", title: "워킨맵", desc: "분기 점검 대상 지도, 라벨, 엑셀 가져오기, 점검 후 자동 반영", url: "/guide/workin.html", updated: "2026-08-26" },
  { group: "현장·동선", key: "recontract", title: "재계약 준비", desc: "이카운트 대장 붙여넣기 분석, 기기별 활용률, 추천 플랜" },
  { group: "현장·동선", key: "autoplan", title: "자동 일정", desc: "가까운 점검 후보 추천, 기준 업체, 미니 지도, 일정 등록", url: "/guide/autoplan.html", updated: "2026-08-26" },
  { group: "현장·동선", key: "foodmap", title: "맛동여지도", desc: "주차 되는 맛집 공유 지도, 네이버 저장목록 붙여넣기", url: "/guide/foodmap.html", updated: "2026-08-26" },
  { group: "현장·동선", key: "field", title: "FIELD", desc: "모든 보고양식(점검·AS·물류·확장성·불만·미수·칭찬…), 사진, 카톡방 전송, 일정 정리", url: "/guide/field.html", updated: "2026-08-26" },
  { group: "소식·학습", key: "inbox", title: "공지·요청", desc: "공지 읽기, 요청 보내기·처리 상태", url: "/guide/inbox.html", updated: "2026-08-26" },
  { group: "소식·학습", key: "copier-notes", title: "복합기 학습·처리이력", desc: "기록 → 족보 → 가이드, 검색, 데일리 퀴즈", url: "/guide/copier-notes.html", updated: "2026-08-26" },
  { group: "소식·학습", key: "it-history", title: "IT 학습·처리이력", desc: "IT 처리 기록 검색·학습" },
  { group: "소식·학습", key: "selfdev", title: "자기개발/지식공유", desc: "독서·지식 공유 기록" },
  { group: "기록·성과", key: "weekly", title: "주간현황판 · 일일방문일지", desc: "방문 기록 자동 생성, 주간 목표·회고, 사무 기록", url: "/guide/weekly.html", updated: "2026-08-26" },
  { group: "기록·성과", key: "growth", title: "성장기록", desc: "개인 성과·성장 카드", url: "/guide/growth.html", updated: "2026-08-26" },
  { group: "고객·홍보", key: "customer-report", title: "고객 리포트", desc: "월간 리포트 대상·수신자·링크 문자 발송·로그", url: "/guide/customer-report.html", updated: "2026-08-26" },
  { group: "고객·홍보", key: "happycall", title: "해피콜", desc: "해피콜 메시지 생성·예약·발송 상태", url: "/guide/happycall.html", updated: "2026-08-26" },
  { group: "고객·홍보", key: "promo", title: "홍보물 발송·인쇄", desc: "홍보물 만들기·발송·인쇄", url: "/guide/promo.html", updated: "2026-08-26" },
  { group: "고객·홍보", key: "counter-sms", title: "카운터 문자전송", desc: "마감 목록 업로드 → 팀 전송, 이중 발송 방지", url: "/guide/counter-sms.html", updated: "2026-08-26" },
  { group: "조회·관리", key: "lookup", title: "조회", desc: "통합이력 검색, 기기정보 수정, 필드로 불러오기" },
  { group: "조회·관리", key: "admin", title: "관리", desc: "인원, 네이버 캘린더 설정, 카톡방 매핑, 동기화 현황, 거래처 코드" },
];
const GROUPS = Array.from(new Set(GUIDES.map((g) => g.group)));

export default function HelpCenter() {
  const [picked, setPicked] = useState<Guide>(GUIDES.find((g) => g.key === "schedule") || GUIDES[0]);
  const fullUrl = picked.url ? `${window.location.origin}${picked.url}` : "";
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(fullUrl); notify("링크를 복사했습니다 — 카톡방에 붙여넣으면 누구나 열 수 있어요", "success"); }
    catch { notify("복사 실패 — 주소창의 링크를 직접 복사해 주세요", "error"); }
  };
  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-[#1E252F] px-5 py-4 text-white">
        <div className="flex items-center gap-2 text-lg font-black"><BookOpen size={18} /> 사용설명서</div>
        <p className="mt-0.5 text-[12px] font-semibold text-slate-400">웹앱 전체 사용설명서 — 화면별로 버튼 하나하나, 처음 쓰는 분 기준 · 링크는 로그인 없이 열립니다</p>
      </section>
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-3">
          {GROUPS.map((group) => (<div key={group} className="space-y-1.5">
          <div className="px-1 text-[11px] font-black uppercase tracking-wider text-slate-400">{group}</div>
          {GUIDES.filter((g) => g.group === group).map((g) => (
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
          </div>))}
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
