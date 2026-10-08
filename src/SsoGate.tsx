/**
 * 로그인 문(SSO_REQUIRED=true일 때만) — 그룹웨어 계정으로 들어와야 앱이 열린다. 공개 페이지(앨범·설명서·리포트)는 이 문을 거치지 않는다.
 * 2026-10-08: 카드 하나만 떠 있던 화면을 페이지 전체 디자인으로 — 움직이는 빛무리·격자 배경, FIELD 워드마크, 하는 일 네 가지, 시간대 인사.
 */
import { CalendarDays, Camera, ClipboardCheck, MapPinned, ShieldCheck, Target } from "lucide-react";
import { GROUPWARE_URL, startGroupwareLogin } from "./sso";

const FEATURES = [
  { icon: CalendarDays, title: "일정·내 일정", desc: "오늘 갈 곳을 동선 순서로" },
  { icon: MapPinned, title: "워킨맵", desc: "분기 점검·재계약 대상 한눈에" },
  { icon: ClipboardCheck, title: "점검·AS 보고", desc: "양식 변환부터 카톡 전송까지" },
  { icon: Target, title: "OKR·주간현황판", desc: "목표와 배운 점을 매주 기록" },
];

function greeting(): string {
  const h = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Seoul" }));
  if (h < 5) return "늦은 시간까지 수고 많으십니다";
  if (h < 11) return "좋은 아침입니다";
  if (h < 14) return "점심은 드셨나요";
  if (h < 18) return "오늘도 현장 수고 많으십니다";
  return "오늘 하루 고생 많으셨습니다";
}

export default function SsoGate({ error, notice }: { error?: string; notice?: string }) {
  const today = new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long", timeZone: "Asia/Seoul" });
  return (
    <div className="sso-gate relative min-h-[100dvh] overflow-hidden bg-[#070d1a] text-white">
      <style>{`
        .sso-gate .orb{position:absolute;border-radius:9999px;filter:blur(70px);opacity:.55;will-change:transform}
        .sso-gate .orb-a{width:620px;height:620px;left:-180px;top:-200px;background:radial-gradient(circle at 30% 30%,#2563eb,transparent 62%);animation:sso-float-a 18s ease-in-out infinite}
        .sso-gate .orb-b{width:560px;height:560px;right:-160px;top:10%;background:radial-gradient(circle at 60% 40%,#7c3aed,transparent 62%);animation:sso-float-b 22s ease-in-out infinite}
        .sso-gate .orb-c{width:480px;height:480px;left:30%;bottom:-220px;background:radial-gradient(circle at 50% 50%,#06b6d4,transparent 62%);animation:sso-float-c 26s ease-in-out infinite}
        .sso-gate .bgrid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.055) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.055) 1px,transparent 1px);background-size:44px 44px;mask-image:radial-gradient(ellipse at center,#000 30%,transparent 78%);-webkit-mask-image:radial-gradient(ellipse at center,#000 30%,transparent 78%)}
        .sso-gate .beam{position:absolute;left:50%;top:-40%;width:2px;height:180%;background:linear-gradient(to bottom,transparent,rgba(255,255,255,.35),transparent);transform:rotate(28deg);animation:sso-beam 9s linear infinite;opacity:.5}
        .sso-gate .rise{animation:sso-rise .7s cubic-bezier(.22,.61,.36,1) both}
        .sso-gate .d1{animation-delay:.08s}.sso-gate .d2{animation-delay:.16s}.sso-gate .d3{animation-delay:.24s}.sso-gate .d4{animation-delay:.32s}.sso-gate .d5{animation-delay:.4s}
        .sso-gate .word{background:linear-gradient(100deg,#fff 0%,#bfdbfe 45%,#a78bfa 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
        .sso-gate .shine{position:relative;overflow:hidden}
        .sso-gate .shine::after{content:"";position:absolute;inset:-40%;background:linear-gradient(115deg,transparent 40%,rgba(255,255,255,.35) 50%,transparent 60%);transform:translateX(-120%);animation:sso-shine 3.6s ease-in-out infinite}
        @keyframes sso-float-a{0%,100%{transform:translate(0,0)}50%{transform:translate(70px,50px)}}
        @keyframes sso-float-b{0%,100%{transform:translate(0,0)}50%{transform:translate(-60px,70px)}}
        @keyframes sso-float-c{0%,100%{transform:translate(0,0)}50%{transform:translate(40px,-60px)}}
        @keyframes sso-beam{0%{transform:translateX(-60vw) rotate(28deg)}100%{transform:translateX(60vw) rotate(28deg)}}
        @keyframes sso-rise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
        @keyframes sso-shine{0%,60%{transform:translateX(-120%)}100%{transform:translateX(120%)}}
        @media (prefers-reduced-motion: reduce){.sso-gate .orb,.sso-gate .beam,.sso-gate .shine::after{animation:none}.sso-gate .rise{animation:none}}
      `}</style>
      <div className="orb orb-a" /><div className="orb orb-b" /><div className="orb orb-c" />
      <div className="bgrid" /><div className="beam" />

      <div className="relative mx-auto flex min-h-[100dvh] max-w-6xl flex-col px-5 py-8 sm:px-8">
        <header className="rise flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-[15px] font-black text-[#0b1a3a] shadow-[0_8px_24px_rgba(37,99,235,.45)]">F</span>
            <span className="text-[12px] font-black uppercase tracking-[0.22em] text-slate-300">FIRSTOA · CS팀</span>
          </div>
          <span className="hidden text-[12px] font-bold text-slate-400 sm:block">{today}</span>
        </header>

        <main className="flex flex-1 flex-col items-center justify-center gap-10 py-10 lg:flex-row lg:items-center lg:justify-between lg:gap-16">
          <section className="w-full max-w-xl text-center lg:text-left">
            <p className="rise d1 text-[13px] font-bold text-blue-300">{greeting()}</p>
            <h1 className="rise d2 mt-2 text-[64px] font-black leading-none tracking-[-0.04em] sm:text-[88px]"><span className="word">FIELD</span></h1>
            <p className="rise d3 mt-3 text-[15px] font-semibold leading-relaxed text-slate-300 sm:text-[17px]">퍼스트전산 CS팀 현장 업무 포털.<br className="hidden sm:block" /> 일정부터 점검 보고, 워킨맵, OKR까지 한 곳에서.</p>
            <ul className="rise d4 mt-7 grid grid-cols-2 gap-2.5 text-left">
              {FEATURES.map(({ icon: Icon, title, desc }) => (
                <li key={title} className="flex items-start gap-2.5 rounded-2xl border border-white/10 bg-white/[0.045] px-3.5 py-3 backdrop-blur-sm">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/20 text-blue-200"><Icon size={16} /></span>
                  <span className="min-w-0"><span className="block text-[13px] font-black text-white">{title}</span><span className="block text-[11.5px] font-semibold leading-snug text-slate-400">{desc}</span></span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rise d5 w-full max-w-sm">
            <div className="rounded-[28px] border border-white/12 bg-white/[0.06] p-7 shadow-[0_30px_80px_-30px_rgba(0,0,0,.8)] backdrop-blur-xl">
              <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400"><ShieldCheck size={14} className="text-emerald-300" />사내 전용</div>
              <h2 className="mt-2 text-[22px] font-black tracking-tight">그룹웨어 계정으로 로그인</h2>
              <p className="mt-1.5 text-[13px] font-semibold leading-relaxed text-slate-300">비밀번호는 그룹웨어 화면에서만 입력합니다. 로그인하면 작성자 이름이 자동으로 맞춰집니다.</p>
              {notice && <div className="mt-4 rounded-xl border border-blue-400/40 bg-blue-500/10 px-3 py-2 text-xs font-bold leading-relaxed text-blue-100">{notice}</div>}
              {error && <div className="mt-4 rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-200">{error}</div>}
              <button type="button" onClick={() => startGroupwareLogin("/")} className="shine mt-5 w-full rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 py-3.5 text-[15px] font-black text-white shadow-[0_12px_30px_rgba(37,99,235,.45)] transition hover:from-blue-500 hover:to-indigo-500 active:scale-[.99]">그룹웨어로 로그인 →</button>
              <a href={GROUPWARE_URL} className="mt-3 block text-center text-[11.5px] font-bold text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline">비밀번호가 없거나 잊었다면 그룹웨어에서 먼저 설정</a>
            </div>
            <div className="mt-4 flex items-center justify-center gap-2 text-[11px] font-bold text-slate-500"><Camera size={13} />현장 사진 앨범·점검 리포트 링크는 로그인 없이 열립니다</div>
          </section>
        </main>

        <footer className="rise d5 flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold text-slate-500">
          <span>© {new Date().getFullYear()} (주)퍼스트전산 · CS팀 내부용</span>
          <span>문의: CS팀 이민구</span>
        </footer>
      </div>
    </div>
  );
}
