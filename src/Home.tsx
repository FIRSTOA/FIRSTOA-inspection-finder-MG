import { useMemo } from "react";

type Screen = "field" | "daily" | "weekly" | "growth";

const quickLinks: Array<{ key: Screen; title: string; desc: string; badge: string }> = [
  { key: "field", title: "FIELD 작성", desc: "현장 보고와 카톡방 전송", badge: "현장" },
  { key: "daily", title: "일일업무", desc: "외근/내근 자동 집계", badge: "집계" },
  { key: "weekly", title: "주간현황판", desc: "목표와 실적 비교", badge: "회고" },
  { key: "growth", title: "성장기록", desc: "분기 회고 자료 정리", badge: "성장" },
];

const stats = [
  ["FIELD", "입력"],
  ["Kakao", "전송"],
  ["Report", "집계"],
  ["Growth", "정리"],
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
        <div className="grid min-h-[320px] lg:grid-cols-[0.95fr_1.05fr]">
          <div className="flex flex-col justify-center p-6 lg:p-9">
            <div className="text-xs font-black uppercase tracking-wide text-blue-600">FIRSTOA CS ERP</div>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-950 lg:text-5xl">
              현장 업무를<br className="hidden sm:block" /> 한 화면에서
            </h2>
            <p className="mt-4 max-w-xl text-sm font-semibold leading-6 text-slate-500">
              FIELD 작성부터 전송, 집계, 성장기록까지 이어지는 CS 업무 허브입니다.
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
                  <div className="text-xs font-black text-slate-400">CS 업무 보드</div>
                  <div className="mt-1 text-lg font-extrabold text-slate-950">오늘의 처리 흐름</div>
                </div>
                <span className="rounded bg-blue-50 px-2 py-1 text-xs font-black text-blue-700">LIVE</span>
              </div>
              <div className="mt-4 grid grid-cols-4 gap-2">
                {stats.map(([label, value]) => (
                  <div key={label} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <div className="text-[10px] font-black text-slate-400">{label}</div>
                    <div className="mt-2 text-sm font-extrabold text-slate-900">{value}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 space-y-2">
                {[
                  ["점검/AS", "bg-blue-600", "w-[86%]"],
                  ["물류/확장성", "bg-emerald-500", "w-[64%]"],
                  ["성장기록", "bg-slate-900", "w-[48%]"],
                ].map(([label, color, width]) => (
                  <div key={label} className="rounded-md border border-slate-200 bg-white p-3">
                    <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-500">
                      <span>{label}</span>
                      <span>자동 정리</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className={`h-full rounded-full ${color} ${width}`} />
                    </div>
                  </div>
                ))}
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

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-4">
          {["작성", "전송", "집계", "회고"].map((label, index) => (
            <div key={label} className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-4">
              <div className="flex h-8 w-8 items-center justify-center rounded bg-slate-950 text-xs font-black text-white">{index + 1}</div>
              <div>
                <div className="text-sm font-extrabold text-slate-900">{label}</div>
                <div className="text-xs font-semibold text-slate-500">업무 흐름</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
