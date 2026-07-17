import { useMemo } from "react";

type Screen = "field" | "daily" | "weekly" | "growth";

const quickLinks: Array<{ key: Screen; title: string; desc: string; badge: string }> = [
  { key: "field", title: "FIELD 작성", desc: "점검, AS, 물류, 확장성, 미수, 불만을 카톡방 전송까지 처리", badge: "현장" },
  { key: "daily", title: "일일업무", desc: "외근/내근 수치와 방문 상세를 날짜별로 확인", badge: "집계" },
  { key: "weekly", title: "주간현황판", desc: "주간 실적, 목표, 성장노트, 배운 점을 한 화면에서 정리", badge: "회고" },
  { key: "growth", title: "성장기록", desc: "주간 기록을 월별/분기별로 모아 골든미팅카드 준비", badge: "성장" },
];

const flow = [
  ["1", "현장에서 FIELD 작성", "거래처 검색 또는 원본 변환으로 내용을 최대한 적게 입력합니다."],
  ["2", "카톡방 전송", "점검, AS, 물류, 확장성 등 선택한 업무 방으로 바로 보냅니다."],
  ["3", "일일/주간 확인", "저장된 방문 기록이 업무 현황과 실적 비교로 자동 집계됩니다."],
  ["4", "성장기록 정리", "성장노트와 배운 점을 모아 분기 회고 자료로 전환합니다."],
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
        <div className="grid gap-0 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="p-6 lg:p-8">
            <div className="text-xs font-black uppercase tracking-wide text-blue-600">FIRSTOA ERP</div>
            <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-950 lg:text-4xl">오늘 업무를 한 곳에서 시작하세요</h2>
            <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-slate-500">
              현장 작성, 카톡방 전송, 업무 집계, 성장기록까지 이어지는 외근직용 업무 허브입니다.
              자주 쓰는 FIELD는 바로 열고, 나머지는 좌측 메뉴나 아래 바로가기에서 이동하면 됩니다.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <button onClick={() => go("field")} className="rounded-md bg-slate-950 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800">
                FIELD 바로 작성
              </button>
              <button onClick={() => go("weekly")} className="rounded-md border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50">
                주간현황판 보기
              </button>
            </div>
          </div>
          <div className="border-t border-slate-200 bg-slate-50 p-5 lg:border-l lg:border-t-0">
            <div className="rounded-md border border-slate-200 bg-white p-4">
              <div className="text-xs font-bold text-slate-400">오늘</div>
              <div className="mt-1 text-2xl font-black text-slate-950">{today}</div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {["FIELD 작성", "전송 확인", "일일업무", "성장 메모"].map((item) => (
                  <div key={item} className="rounded-md border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-700">
                    {item}
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
            className="rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
          >
            <span className="rounded bg-blue-50 px-2 py-1 text-[11px] font-black text-blue-700">{item.badge}</span>
            <div className="mt-4 text-lg font-black text-slate-950">{item.title}</div>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">{item.desc}</p>
          </button>
        ))}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-black text-slate-950">추천 업무 흐름</h3>
            <p className="mt-1 text-xs font-semibold text-slate-500">입력은 줄이고, 기록은 자동으로 남기는 흐름입니다.</p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-4">
          {flow.map(([no, title, desc]) => (
            <div key={no} className="rounded-md border border-slate-200 bg-slate-50 p-4">
              <div className="flex h-7 w-7 items-center justify-center rounded bg-slate-950 text-xs font-black text-white">{no}</div>
              <div className="mt-3 text-sm font-black text-slate-900">{title}</div>
              <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">{desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
