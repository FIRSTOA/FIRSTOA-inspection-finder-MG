import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { selectRows } from "./supabase";
import MemberAdmin from "./MemberAdmin";
import ContactChangeHistory from "./ContactChangeHistory";
import SyncStatus from "./SyncStatus";
import SystemAdmin from "./SystemAdmin";

/**
 * 관리 허브 — 값을 바꾸는 화면들을 한 지붕 아래 모은다.
 *
 * 상단 다크 상태줄은 각 탭에 들어가지 않아도 "지금 상태가 정상인지"를 보여준다.
 * 특히 테스트 모드·전송 꺼짐은 회사 전체 전송이 멈추는 상태라 어느 탭에 있든 보여야 한다.
 * (문자 문구·홍보물 편집은 해피콜·홍보 화면에, 재고는 자재·요청 메뉴에 있다)
 */
type Tab = "members" | "changes" | "sync" | "system";

const TABS: Array<[Tab, string]> = [
  ["members", "인원"],
  ["changes", "담당자·주소 변경"],
  ["sync", "동기화 현황"],
  ["system", "전송·카톡방"],
];

type Summary = { members: number; kakaoOn: boolean; sheetOn: boolean; testMode: boolean };

export default function AdminHub({ author }: { author: string }) {
  void author;
  const [tab, setTab] = useState<Tab>(() => {
    const saved = window.localStorage.getItem("cs_admin_tab_v1") as Tab;
    return TABS.some(([key]) => key === saved) ? saved : "members";
  });
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => { window.localStorage.setItem("cs_admin_tab_v1", tab); }, [tab]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [members, config] = await Promise.all([
          selectRows<{ id: string }>("cs_members", "select=id&active=eq.true"),
          selectRows<{ key: string; value: string }>("app_config", "select=key,value"),
        ]);
        if (!alive) return;
        const on = (key: string) => /^(true|1|on|y)$/i.test(config.find((row) => row.key === key)?.value || "");
        setSummary({
          members: members.length,
          kakaoOn: on("FIELD_KAKAO_SEND_ENABLED"),
          sheetOn: on("FIELD_SHEET_SYNC_ENABLED"),
          testMode: on("TEST_MODE") || on("FIELD_SHEET_TEST_MODE"),
        });
      } catch { /* 요약은 실패해도 화면은 동작해야 한다 */ }
    })();
    return () => { alive = false; };
  }, [tab]); // 탭에서 값을 바꾸고 돌아오면 요약도 갱신

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {/* 다크 상태줄 */}
        <div className="flex flex-wrap items-center gap-2 bg-[#151A23] px-4 py-2.5">
          {summary ? (
            <>
              <button type="button" onClick={() => setTab("members")}
                className="flex items-center gap-1.5 rounded-full bg-white/[0.07] px-2.5 py-1 text-[11px] font-bold text-slate-400 transition hover:bg-white/[0.14] hover:text-slate-200">
                재직 <b className="tabular-nums text-white">{summary.members}명</b>
              </button>
              <span className="ml-auto flex items-center gap-2">
                {summary.testMode && (
                  <button type="button" onClick={() => setTab("system")}
                    className="flex items-center gap-1 rounded-full bg-amber-400/20 px-2.5 py-1 text-[11px] font-black text-amber-300 transition hover:bg-amber-400/30">
                    <AlertTriangle size={12} />테스트 모드
                  </button>
                )}
                <button type="button" onClick={() => setTab("system")}
                  className="flex items-center gap-1.5 rounded-full bg-white/[0.07] px-2.5 py-1 text-[11px] font-bold text-slate-400 transition hover:bg-white/[0.14]">
                  <span className={`h-1.5 w-1.5 rounded-full ${summary.kakaoOn ? "bg-emerald-400" : "bg-rose-400"}`} />카톡
                  <span className={`h-1.5 w-1.5 rounded-full ${summary.sheetOn ? "bg-emerald-400" : "bg-rose-400"}`} />시트
                </button>
              </span>
            </>
          ) : (
            <span className="py-0.5 text-[11px] font-semibold text-slate-500">현황을 불러오는 중…</span>
          )}
        </div>
        <div className="flex overflow-x-auto">
          {TABS.map(([key, label]) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`relative shrink-0 whitespace-nowrap px-5 py-3.5 text-sm font-black transition ${tab === key ? "text-slate-950 after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:bg-blue-600" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"}`}>{label}</button>
          ))}
        </div>
      </section>

      {tab === "members" && <MemberAdmin />}
      {tab === "changes" && <ContactChangeHistory />}
      {tab === "sync" && <SyncStatus />}
      {tab === "system" && <SystemAdmin />}
    </div>
  );
}
