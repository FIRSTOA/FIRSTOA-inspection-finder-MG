/**
 * 복합기 구동원리 — 다른 직원이 만든 교육가이드(HTML)를 이 화면 안에 그대로 그린다(2026-10-09 사용자: "새 창 말고 여기 화면처럼").
 *  public/learn/copier-principle.inline.json = { css(.prin 아래로 가둔 스타일), body(본문), script(애니메이션) } — 생성 스크립트가 원본 HTML에서 뽑는다.
 *  스타일은 .prin 로 시작하는 선택자뿐이라 앱 전체로 새지 않고, 스크립트는 본문을 붙인 뒤 한 번 돌린다(id 로 그림을 찾는 구조라 그대로 동작).
 */
import { useEffect, useRef, useState } from "react";

type Bundle = { css: string; body: string; script: string };
let cache: Promise<Bundle> | null = null;
const load = () => (cache ||= fetch("/learn/copier-principle.inline.json", { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<Bundle>; }).catch((e) => { cache = null; throw e; }));

export default function CopierPrinciple() {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let alive = true;
    const styleId = "prin-css";
    load().then((b) => {
      if (!alive || !ref.current) return;
      if (!document.getElementById(styleId)) { const st = document.createElement("style"); st.id = styleId; st.textContent = b.css; document.head.appendChild(st); }
      ref.current.innerHTML = b.body;
      setState("ready");
      // 그림·단계 애니메이션 — 원본 스크립트 그대로. 화면을 떠났다 오면 본문이 새로 그려지므로 다시 돌린다
      try { new Function(b.script)(); } catch (e) { console.warn("구동원리 스크립트 오류", e); }
    }).catch(() => { if (alive) setState("error"); });
    return () => { alive = false; document.getElementById(styleId)?.remove(); };
  }, []);
  return (
    <section className="space-y-2">
      {state === "loading" && <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-400">구동원리 자료 불러오는 중…</div>}
      {state === "error" && <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-sm font-bold text-rose-700">자료를 불러오지 못했습니다 — 새로고침해 주세요</div>}
      <div ref={ref} className="prin" />
    </section>
  );
}
