// 엑셀처럼 쓰는 셀 (2026-09-24, OKR 요청)
//  - 한 번 누르면 선택(파란 테두리) → Delete/Backspace로 내용 삭제, Enter·F2·더블클릭 또는 글자 입력으로 편집 시작, Esc로 편집 끝.
//    모바일(터치)은 한 번 눌러 바로 편집.
//  - 글자색 검정·빨강·파랑: 편집 중엔 드래그한 부분만, 선택 상태에선 칸 전체.
//  - 평문(text)은 항상 같이 내보내서 AI·합치기·검색이 그대로 평문을 쓰고, 색이 들어간 경우에만 html을 함께 저장한다. 변환 규칙은 richText.ts.
//  - readOnly면 그냥 글로 보여준다(팀원 칸의 목표·달성기준).
//  - 키보드로 칸 옮기기: 선택 상태에서 화살표·Tab, 편집 중엔 Tab(오른쪽)·Shift+Tab(왼쪽)·Ctrl+Enter(아래). Enter는 줄바꿈(여러 줄 적는 칸이라 엑셀의 Alt+Enter 대신).
import { useEffect, useRef, useState } from "react";
import { isMobileDevice } from "./navApp";
import { dirFromKey, moveCellFocus, type CellDir } from "./cellNav";
import { RICH_COLORS, richToText, sanitizeRich, textToHtml, type RichColorKey } from "./richText";

type Mode = "idle" | "selected" | "editing";

function placeCaretEnd(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

export default function RichCell({ text, html, onChange, placeholder = "", className = "", minRows = 2, readOnly = false }: {
  text: string; html?: string; onChange?: (text: string, html: string | undefined) => void; placeholder?: string; className?: string; minRows?: number; readOnly?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const lastRef = useRef<string | null>(null); // 마지막으로 내보낸 html — 바깥에서 같은 값이 돌아오면 다시 그리지 않는다(커서 유지)
  const [mode, setMode] = useState<Mode>("idle");
  const wanted = html || textToHtml(text);
  useEffect(() => {
    const el = ref.current;
    if (!el || wanted === lastRef.current) return;
    el.innerHTML = wanted;
    lastRef.current = wanted;
  }, [wanted]);
  const minHeight = `${minRows * 1.25 + 0.75}rem`;

  if (readOnly) {
    return <div className={`h-full min-h-full whitespace-pre-wrap break-words px-2 py-1.5 text-[12px] leading-snug text-slate-800 ${className}`} style={{ minHeight }} dangerouslySetInnerHTML={{ __html: wanted || `<span class="text-slate-300">${placeholder}</span>` }} />;
  }

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const clean = sanitizeRich(el);
    if (!clean && el.innerHTML) el.innerHTML = ""; // 다 지웠을 때 남는 <br> 제거 → 자리표시 글이 다시 보이게
    lastRef.current = clean;
    onChange?.(richToText(clean), /<span/.test(clean) ? clean : undefined);
  };
  // 편집 시작 — 렌더가 contentEditable을 켠 뒤 포커스. replace면 내용을 비우고 firstKey부터 적는다(엑셀: 선택 상태에서 타이핑)
  const startEdit = (replace = false, firstKey = "") => {
    setMode("editing");
    window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      if (replace) el.innerHTML = "";
      el.focus();
      placeCaretEnd(el);
      if (firstKey) { try { document.execCommand("insertText", false, firstKey); } catch { el.textContent = firstKey; placeCaretEnd(el); } }
      if (replace || firstKey) emit();
    }, 0);
  };
  const clearAll = () => { const el = ref.current; if (el) el.innerHTML = ""; lastRef.current = ""; onChange?.("", undefined); };
  const paint = (key: RichColorKey) => {
    const el = ref.current;
    if (!el) return;
    if (mode === "editing") {
      el.focus();
      try { document.execCommand("styleWithCSS", false, "true"); document.execCommand("foreColor", false, RICH_COLORS[key]); } catch { /* 지원 안 하는 브라우저 */ }
      emit();
      return;
    }
    // 선택 상태: 칸 전체 색
    const plain = richToText(sanitizeRich(el));
    const next = key === "black" || !plain ? textToHtml(plain) : `<span style="color:${RICH_COLORS[key]}">${textToHtml(plain)}</span>`;
    el.innerHTML = next;
    lastRef.current = next;
    onChange?.(plain, key === "black" || !plain ? undefined : next);
  };
  const move = (dir: CellDir) => { const w = wrapRef.current; if (w) moveCellFocus(w, dir); };
  // 편집을 끝내고 옆 칸으로 — Tab / Shift+Tab / Ctrl+Enter
  const finishAndMove = (dir: CellDir) => { emit(); ref.current?.blur(); setMode("idle"); window.setTimeout(() => { const w = wrapRef.current; if (w && !moveCellFocus(w, dir)) { w.focus(); setMode("selected"); } }, 0); };
  const onWrapKeyDown = (e: React.KeyboardEvent) => {
    if (mode !== "selected") return;
    const dir = dirFromKey(e.key);
    if (dir) { e.preventDefault(); move(dir); return; }
    if (e.key === "Tab") { e.preventDefault(); move(e.shiftKey ? "left" : "right"); return; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); clearAll(); return; }
    if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); startEdit(); return; }
    if (e.key === "Escape") { e.preventDefault(); setMode("idle"); wrapRef.current?.blur(); return; }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); startEdit(true, e.key); }
  };
  return <div ref={wrapRef} tabIndex={0} role="gridcell" data-cell
    onFocus={(e) => { if (e.target === wrapRef.current && mode === "idle") setMode("selected"); }}
    onClick={() => { if (mode !== "idle") return; if (isMobileDevice) startEdit(); else { setMode("selected"); wrapRef.current?.focus(); } }}
    onDoubleClick={() => { if (mode !== "editing") startEdit(); }}
    onKeyDown={onWrapKeyDown}
    onBlur={(e) => { if (mode === "selected" && !wrapRef.current?.contains(e.relatedTarget as Node | null)) setMode("idle"); }}
    className={`relative h-full min-h-full cursor-cell outline-none ${mode === "selected" ? "ring-2 ring-inset ring-blue-500" : ""}`} style={{ minHeight }}>
    {mode !== "idle" && <div className="absolute right-1 top-1 z-10 flex gap-1 rounded-full border border-slate-200 bg-white p-0.5 shadow-sm">
      {(Object.keys(RICH_COLORS) as RichColorKey[]).map((k) => <button key={k} type="button" tabIndex={-1} title={k === "black" ? "검정" : k === "red" ? "빨강" : "파랑"} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); paint(k); }} className="h-4 w-4 rounded-full border border-white ring-1 ring-slate-200" style={{ background: RICH_COLORS[k] }} />)}
    </div>}
    <div ref={ref} contentEditable={mode === "editing"} suppressContentEditableWarning spellCheck={false} data-placeholder={placeholder}
      onInput={emit}
      onBlur={() => { emit(); setMode("idle"); }}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); ref.current?.blur(); setMode("selected"); wrapRef.current?.focus(); return; }
        if (e.key === "Tab") { e.preventDefault(); finishAndMove(e.shiftKey ? "left" : "right"); return; }
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finishAndMove("down"); }
      }}
      onPaste={(e) => { e.preventDefault(); const t = e.clipboardData.getData("text/plain"); document.execCommand("insertText", false, t); }}
      style={{ minHeight }}
      className={`block h-full w-full whitespace-pre-wrap break-words px-2 py-1.5 text-[12px] leading-snug text-slate-800 outline-none empty:before:text-slate-300 empty:before:content-[attr(data-placeholder)] ${mode === "editing" ? "cursor-text" : "cursor-cell select-none"} ${mode !== "idle" ? "pr-16" : ""} ${className}`} />
  </div>;
}
