// 엑셀처럼 글자색(검정·빨강·파랑)을 바꿔 적을 수 있는 셀 (2026-09-24, OKR 요청)
// contentEditable 한 칸. 평문(text)은 항상 같이 내보내서 AI·합치기·검색이 그대로 평문을 쓰고,
// 색이 들어간 경우에만 html을 함께 저장한다. 변환 규칙은 richText.ts.
import { useEffect, useRef, useState } from "react";
import { RICH_COLORS, richToText, sanitizeRich, textToHtml, type RichColorKey } from "./richText";

export default function RichCell({ text, html, onChange, placeholder = "", className = "", minRows = 2 }: {
  text: string; html?: string; onChange: (text: string, html: string | undefined) => void; placeholder?: string; className?: string; minRows?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const lastRef = useRef<string | null>(null); // 마지막으로 내보낸 html — 바깥에서 같은 값이 돌아오면 다시 그리지 않는다(커서 유지)
  const [focused, setFocused] = useState(false);
  const wanted = html || textToHtml(text);
  useEffect(() => {
    const el = ref.current;
    if (!el || wanted === lastRef.current) return;
    el.innerHTML = wanted;
    lastRef.current = wanted;
  }, [wanted]);
  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const clean = sanitizeRich(el);
    if (!clean && el.innerHTML) el.innerHTML = ""; // 다 지웠을 때 남는 <br> 제거 → 자리표시 글이 다시 보이게
    const plain = richToText(clean);
    lastRef.current = clean;
    onChange(plain, /<span/.test(clean) ? clean : undefined);
  };
  const paint = (key: RichColorKey) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    try { document.execCommand("styleWithCSS", false, "true"); document.execCommand("foreColor", false, RICH_COLORS[key]); } catch { /* 지원 안 하는 브라우저 */ }
    emit();
  };
  return <div className="relative">
    {focused && <div className="absolute right-1 top-1 z-10 flex gap-1 rounded-full border border-slate-200 bg-white p-0.5 shadow-sm">
      {(Object.keys(RICH_COLORS) as RichColorKey[]).map((k) => <button key={k} type="button" title={k === "black" ? "검정" : k === "red" ? "빨강" : "파랑"} onMouseDown={(e) => { e.preventDefault(); paint(k); }} className="h-4 w-4 rounded-full border border-white ring-1 ring-slate-200" style={{ background: RICH_COLORS[k] }} />)}
    </div>}
    <div ref={ref} contentEditable suppressContentEditableWarning spellCheck={false} data-placeholder={placeholder}
      onInput={emit} onBlur={() => { setFocused(false); emit(); }} onFocus={() => setFocused(true)}
      onPaste={(e) => { e.preventDefault(); const t = e.clipboardData.getData("text/plain"); document.execCommand("insertText", false, t); }}
      style={{ minHeight: `${minRows * 1.25 + 0.75}rem` }}
      className={`block w-full whitespace-pre-wrap break-words px-2 py-1.5 text-[12px] leading-snug text-slate-800 outline-none empty:before:text-slate-300 empty:before:content-[attr(data-placeholder)] ${focused ? "pr-16" : ""} ${className}`} />
  </div>;
}
