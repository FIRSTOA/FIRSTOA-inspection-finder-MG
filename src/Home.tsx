import { useMemo } from "react";

type Screen = "field" | "daily" | "weekly" | "growth";

const quickLinks: Array<{ key: Screen; title: string; desc: string; badge: string }> = [
  { key: "field", title: "FIELD 작성", desc: "현장 보고와 카톡방 전송", badge: "현장" },
  { key: "daily", title: "일일방문일지", desc: "외근/내근 자동 집계", badge: "집계" },
  { key: "weekly", title: "주간현황판", desc: "목표와 실적 비교", badge: "회고" },
  { key: "growth", title: "성장기록", desc: "분기 회고 자료 정리", badge: "성장" },
];

const flowCards = [
  { title: "입력", label: "FIELD", desc: "현장 내용을 양식으로 작성", icon: "01", tone: "bg-blue-600 text-white" },
  { title: "전송", label: "Kakao", desc: "업무별 카톡방으로 전달", icon: "02", tone: "bg-slate-950 text-white" },
  { title: "집계", label: "Report", desc: "일일·주간 실적으로 정리", icon: "03", tone: "bg-emerald-600 text-white" },
  { title: "정리", label: "Growth", desc: "성장기록과 회고 자료화", icon: "04", tone: "bg-indigo-600 text-white" },
] as const;

export default function Home({ onGoField, onNavigate }: { onGoField: () => void; onNavigate?: (screen: Screen) => void }) {
  const today = useMemo(() => new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(new Date()), []);
  const go = (screen: Screen) => {
    if (screen === "field") onGoField();
    else onNavigate?.(screen);
  };

  return (
    <div className="space-y-5 pb-14">
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="grid min-h-[340px] lg:grid-cols-[0.9fr_1.1fr]">
          <div className="flex flex-col justify-center p-6 lg:p-9">
            <div className="text-xs font-black uppercase tracking-wide text-blue-600">FIRSTOA CS SYSTEM</div>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-950 lg:text-5xl">
              현장 업무를<br className="hidden sm:block" /> 한 화면에서
            </h2>
            <p className="mt-4 max-w-xl text-sm font-semibold leading-6 text-slate-500">
              작성, 전송, 집계, 회고까지 이어지는 CS 업무 흐름을 한 번에 관리합니다.
            </p>
            <div className="mt-7 flex flex-wrap gap-2">
              <button onClick={() => go("field")} className="rounded-md bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700">
                FIELD 바로 작성
              </button>
              <button onClick={() => go("weekly")} className="rounded-md border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50">
                주간현황판
              </button>
            </div>
          </div>

          <div className="relative border-t border-slate-200 bg-[#F4F7FB] p-5 lg:border-l lg:border-t-0 lg:p-8">
            <div className="absolute right-7 top-7 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-500 shadow-sm">
              {today}
            </div>

            <div className="mt-10 rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:mt-8">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <div className="text-xs font-black text-slate-400">CS 업무 흐름</div>
                  <div className="mt-1 text-lg font-extrabold text-slate-950">작성하면 기록까지 이어집니다</div>
                </div>
                <span className="rounded bg-blue-50 px-2 py-1 text-xs font-black text-blue-700">FLOW</span>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-4">
                {flowCards.map((item, index) => (
                  <div key={item.label} className="relative">
                    {index < flowCards.length - 1 && (
                      <div className="absolute left-[calc(100%-0.35rem)] top-10 hidden h-px w-5 bg-slate-300 md:block" />
                    )}
                    <div className="h-full rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-md text-xs font-black ${item.tone}`}>
                        {item.icon}
                      </div>
                      <div className="mt-4 text-xl font-extrabold text-slate-950">{item.title}</div>
                      <div className="mt-1 text-xs font-black uppercase tracking-wide text-blue-600">{item.label}</div>
                      <p className="mt-3 min-h-10 text-xs font-semibold leading-5 text-slate-500">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-lg border border-slate-200 bg-slate-950 p-4 text-white">
                <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
                  <div>
                    <div className="text-xs font-bold text-slate-400">업무 흐름 안내</div>
                    <div className="mt-1 text-lg font-extrabold">작성한 내용이 전송, 집계, 회고 자료로 이어집니다</div>
                  </div>
                  <div className="hidden h-10 w-px bg-white/15 md:block" />
                  <div className="grid grid-cols-2 gap-2 text-xs font-bold">
                    <span className="rounded bg-white/10 px-3 py-2">카톡방 전송</span>
                    <span className="rounded bg-white/10 px-3 py-2">방문기록 저장</span>
                    <span className="rounded bg-white/10 px-3 py-2">업무현황 집계</span>
                    <span className="rounded bg-white/10 px-3 py-2">성장자료 정리</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {quickLinks.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => go(item.key)}
            className="rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-blue-200 hover:shadow-md"
          >
            <span className="rounded bg-blue-50 px-2 py-1 text-[11px] font-black text-blue-700">{item.badge}</span>
            <div className="mt-4 text-lg font-extrabold text-slate-950">{item.title}</div>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">{item.desc}</p>
          </button>
        ))}
      </section>
    </div>
  );
}
