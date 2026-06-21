/** 홈 — 처음 쓰는 사람도 이해할 수 있는 소개 + 퍼스트전산 브랜딩. */

export default function Home({ onGoField }: { onGoField: () => void }) {
  return (
    <div className="space-y-4 pb-8">
      {/* 브랜딩 */}
      <div className="rounded-3xl bg-white p-6 shadow-sm">
        <div className="inline-block rounded-full bg-[#EFF6FF] px-3 py-1 text-[11px] font-bold text-[#3182F6]">퍼스트전산 CS팀</div>
        <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">현장의 모든 보고를<br />한 곳에서, 한 번에</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          점검·AS·확장성·불만·재계약까지 — 현장에서 작성하면 <b className="text-slate-700">카톡방으로 전송</b>되고
          <b className="text-slate-700"> 데이터로 쌓여 검색</b>까지 되는 통합 업무 앱이에요.
        </p>
        <button onClick={onGoField}
          className="mt-4 w-full rounded-xl bg-[#3182F6] py-3 text-sm font-bold text-white transition active:scale-[0.98]">
          FIELD 시작하기 →
        </button>
      </div>

      {/* 무엇을 하나 */}
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="text-sm font-bold text-slate-900">무엇을 할 수 있나요?</div>
        <div className="mt-3 space-y-2.5 text-sm text-slate-600">
          <div className="flex gap-2.5"><span>📝</span><span><b className="text-slate-800">현장 양식 작성</b> — 점검/AS/확장성/불만/초과조정/재계약을 폼으로 빠르게</span></div>
          <div className="flex gap-2.5"><span>💬</span><span><b className="text-slate-800">카톡 자동 전송</b> — 작성 후 보내면 담당 카톡방으로 바로</span></div>
          <div className="flex gap-2.5"><span>📷</span><span><b className="text-slate-800">사진 첨부</b> — 현장 사진을 링크 한 개로 모아 전송</span></div>
          <div className="flex gap-2.5"><span>🔍</span><span><b className="text-slate-800">거래처 검색·통합이력</b> — 지난 점검/AS/전체 이력을 한눈에</span></div>
          <div className="flex gap-2.5"><span>🔗</span><span><b className="text-slate-800">불러오기 연동</b> — 점검 갔다 확장성/불만 작성 시 업체명·지역·키맨 자동 채움</span></div>
        </div>
      </div>

      {/* 사용 순서 */}
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="text-sm font-bold text-slate-900">⭐ 사용 순서</div>
        <div className="mt-3 space-y-2.5">
          {[
            ["탭 고르기", "점검 / AS / 확장성 … (더보기에 불만·재계약 등)"],
            ["내용 작성", "🔍 거래처검색으로 지난 양식 불러오기 / 📝 원본 붙여넣기 / 직접 입력"],
            ["보내기", "맨 아래 보내기 → 카톡방 게시 + 데이터 저장"],
          ].map(([t, d], i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#3182F6] text-xs font-bold text-white">{i + 1}</span>
              <div><div className="text-sm font-semibold text-slate-800">{t}</div><div className="text-[12px] text-slate-500">{d}</div></div>
            </div>
          ))}
        </div>
      </div>

      <div className="px-2 text-center text-[11px] text-slate-400">퍼스트전산 CS팀 · FIELD</div>
    </div>
  );
}
