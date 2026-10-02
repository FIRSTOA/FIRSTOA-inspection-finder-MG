/** 로그인 문(SSO_REQUIRED=true일 때만) — 그룹웨어 계정으로 들어와야 앱이 열린다. 공개 페이지(앨범·설명서·리포트)는 이 문을 거치지 않는다. */
import { GROUPWARE_URL, startGroupwareLogin } from "./sso";

export default function SsoGate({ error }: { error?: string }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#0f1620] px-5 py-10 text-white">
      <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-white/5 p-7 shadow-2xl">
        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">FIRSTOA · CS팀</div>
        <h1 className="mt-2 text-3xl font-black tracking-tight">FIELD</h1>
        <p className="mt-2 text-sm font-semibold text-slate-300">사내 그룹웨어 계정으로 로그인하면 열립니다. 비밀번호는 그룹웨어 화면에서만 입력합니다.</p>
        {error && <div className="mt-4 rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-200">{error}</div>}
        <button type="button" onClick={() => startGroupwareLogin("/")} className="mt-5 w-full rounded-2xl bg-blue-600 py-3 text-sm font-black text-white shadow-[0_6px_20px_rgba(37,99,235,0.35)] transition hover:bg-blue-500">그룹웨어로 로그인</button>
        <a href={GROUPWARE_URL} className="mt-3 block text-center text-[11px] font-bold text-slate-400 underline-offset-2 hover:underline">그룹웨어 비밀번호가 없거나 잊었다면 그룹웨어에서 먼저 설정</a>
      </div>
    </div>
  );
}
