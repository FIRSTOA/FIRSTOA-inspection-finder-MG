/**
 * 알림 설정 (관리 탭) — 이 기기의 웹푸시를 켜고 끄고, 종류별로 고른다.
 *
 * 알림은 기기·브라우저 단위 설정이다: 켠 기기로만 오고, PC와 폰은 각각 켜야 한다.
 * 종류별 선택은 구독 행(prefs)에 저장돼 발송 서버(push-send)가 걸러준다.
 * 알림음은 웹 표준 제약으로 OS 기본음 — 받는 사람이 폰 설정에서 바꾸는 것만 가능.
 */
import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { askConfirm } from "./confirmModal";
import { notify } from "./toast";
import { invokeEdgeFunction } from "./supabase";
import { PUSH_CATEGORIES, disablePush, enablePush, getPushPrefs, isPushOn, pushPermission, pushSupport, setPushPref, type PushCategory } from "./push";

export default function PushSettings({ author }: { author: string }) {
  const [state, setState] = useState<"loading" | "on" | "off" | "blocked" | "ios" | "unsupported">("loading");
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [prefBusy, setPrefBusy] = useState<string>("");
  const [testBusy, setTestBusy] = useState(false);

  const refresh = async () => {
    const support = pushSupport();
    if (support === "ios-need-install") { setState("ios"); return; }
    if (support === "unsupported") { setState("unsupported"); return; }
    if (pushPermission() === "denied") { setState("blocked"); return; }
    if (await isPushOn()) {
      setState("on");
      setPrefs((await getPushPrefs().catch(() => null)) || {});
    } else {
      setState("off");
    }
  };
  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleMaster = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (state === "on") {
        if (!await askConfirm("이 기기의 알림을 끌까요?")) return;
        await disablePush();
        setState("off");
        notify("알림을 껐습니다", "success");
      } else {
        if (!author) { notify("우측 상단에서 작성자(본인)를 먼저 선택하세요 — 알림 대상 매칭 기준입니다.", "error"); return; }
        await enablePush(author);
        await refresh();
        notify("이 기기로 알림이 옵니다 ✓", "success");
      }
    } catch (e) {
      notify((e as Error).message, "error");
      if (pushPermission() === "denied") setState("blocked");
    } finally {
      setBusy(false);
    }
  };

  const toggleCategory = async (key: PushCategory) => {
    if (prefBusy) return;
    const next = prefs[key] === false; // false→켜기, 그 외(기본 켜짐)→끄기
    setPrefBusy(key);
    try {
      await setPushPref(key, next);
      setPrefs((cur) => ({ ...cur, [key]: next }));
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setPrefBusy("");
    }
  };

  const statusLine =
    state === "on" ? { text: "이 기기로 알림이 오는 중", tone: "text-emerald-600" }
    : state === "off" ? { text: "꺼짐 — 아래 버튼으로 켜세요", tone: "text-slate-500" }
    : state === "blocked" ? { text: "브라우저에서 차단됨 — 주소창 자물쇠 → 알림 → 허용 후 다시", tone: "text-rose-600" }
    : state === "ios" ? { text: "아이폰은 사파리 공유 → \"홈 화면에 추가\" 후, 그 앱에서 켤 수 있어요", tone: "text-amber-600" }
    : state === "unsupported" ? { text: "이 브라우저는 알림을 지원하지 않습니다", tone: "text-slate-400" }
    : { text: "확인 중…", tone: "text-slate-400" };

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><BellRing size={18} /></span>
        <div className="min-w-0">
          <h3 className="text-[15px] font-black text-slate-900">푸시 알림</h3>
          <p className={`text-xs font-bold ${statusLine.tone}`}>{statusLine.text}</p>
        </div>
        {(state === "on" || state === "off") && (
          <button type="button" onClick={() => void toggleMaster()} disabled={busy}
            className={`ml-auto shrink-0 rounded-xl px-4 py-2.5 text-sm font-black text-white shadow-md transition ${state === "on" ? "bg-slate-500 hover:bg-slate-600" : "bg-blue-600 hover:bg-blue-700"}`}>
            {busy ? "처리 중…" : state === "on" ? "알림 끄기" : "🔔 이 기기 알림 켜기"}
          </button>
        )}
      </div>

      <div className="space-y-2 px-5 py-4">
        {PUSH_CATEGORIES.map(({ key, label, hint }) => {
          const on = prefs[key] !== false;
          const disabled = state !== "on" || prefBusy === key;
          return (
            <button key={key} type="button" onClick={() => void toggleCategory(key)} disabled={disabled}
              className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${state !== "on" ? "cursor-not-allowed border-slate-100 opacity-45" : on ? "border-blue-200 bg-blue-50/60 hover:bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[11px] font-black ${on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-transparent"}`}>✓</span>
              <span className="min-w-0">
                <span className="block text-sm font-black text-slate-900">{label}</span>
                <span className="block text-xs font-semibold text-slate-500">{hint}</span>
              </span>
              {prefBusy === key && <span className="ml-auto text-xs font-bold text-slate-400">저장 중…</span>}
            </button>
          );
        })}
      </div>

      {state === "on" && (
        <div className="border-t border-slate-100 px-5 py-3.5">
          <button type="button" disabled={testBusy}
            onClick={() => {
              if (!author) { notify("작성자(본인)를 먼저 선택하세요.", "error"); return; }
              setTestBusy(true);
              void invokeEdgeFunction<{ sent?: number }>("push-send", {
                title: "테스트 알림 🔔", body: "알림이 정상 작동합니다 — 이 기기(와 내 다른 기기)로 왔어요.", targets: [author], tag: "push-test",
              }).then((r) => notify(r.sent ? `테스트 발송 완료 ✓ — 내 이름 구독 ${r.sent}개 기기로 보냈어요` : "발송했지만 내 이름으로 켜진 기기가 없어요 — 위에서 알림을 먼저 켜주세요", r.sent ? "success" : "error"))
                .catch((e) => notify(`테스트 발송 실패: ${(e as Error).message}`, "error"))
                .finally(() => setTestBusy(false));
            }}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:text-slate-300">
            {testBusy ? "발송 중…" : "📨 내 기기로 테스트 알림 보내기"}
          </button>
          <span className="ml-3 text-xs font-semibold text-slate-400">1~2초 안에 알림창에 떠야 정상입니다</span>
        </div>
      )}

      <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-3 text-xs font-semibold leading-relaxed text-slate-500">
        알림은 <b className="text-slate-700">기기·브라우저 단위</b>예요 — PC와 폰 각각 켜야 하고, 켠 기기로만 옵니다.
        <b className="text-slate-700"> 내가 등록·처리한 건 나에게 오지 않아요</b> (혼자 테스트할 땐 작성자를 다른 이름으로 바꿔 등록하거나 위 테스트 버튼 사용).
        알림음은 기기 기본음이며 폰 설정(사이트별 알림)에서 바꿀 수 있습니다.
      </div>
    </section>
  );
}
