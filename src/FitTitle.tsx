/**
 * 긴 제목을 '글자 그대로' 한 줄에(2026-10-02, 일정리스트 폰 제목 잘림).
 *  - 글자 크기는 그대로 두고(사용자: 줄이지 말 것), 넘치는 제목만 그 줄 안에서 천천히 좌우로 흘려(멈춤 → 끝까지 → 멈춤 → 되돌림) 끝까지 읽히게 한다.
 *  - 행 높이는 기준 크기 기준으로 고정이라 목록이 길어지지 않는다.
 *  - 화면에 보이는 줄만 움직인다(IntersectionObserver) — 긴 목록에서 배터리·버벅임을 아낀다. 모션 줄이기 설정이면 흘리지 않고 말줄임.
 *  - min을 base보다 작게 주면 흘리기 전에 그 크기까지 글자를 줄여 본다(기본은 줄이지 않음).
 */
import { useEffect, useRef, useState } from "react";

export default function FitTitle({ text, className = "", base = 14, min = base, title }: { text: string; className?: string; base?: number; min?: number; title?: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState(base);
  const [shift, setShift] = useState(0);
  const [seen, setSeen] = useState(true);
  useEffect(() => {
    const box = boxRef.current, el = textRef.current;
    if (!box || !el) return;
    const measure = () => {
      el.style.fontSize = `${base}px`;
      const need = el.scrollWidth, have = box.clientWidth;
      if (!need || !have) return;
      const fit = min < base ? Math.max(min, Math.min(base, Math.floor((base * have) / need * 10) / 10)) : base;
      el.style.fontSize = `${fit}px`;
      const over = el.scrollWidth - have;
      setSize(fit);
      setShift(over > 2 ? over : 0);
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(box);
    const io = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver((entries) => setSeen(entries.some((e) => e.isIntersecting))) : null;
    io?.observe(box);
    return () => { ro?.disconnect(); io?.disconnect(); };
  }, [text, base, min]);
  const dur = Math.max(2, Math.round((shift / 55) * 10) / 10); // 초속 약 55px — 멈춤 없이 바로 움직이되 읽히는 속도(짧은 넘침은 최소 2초)
  const moving = shift > 0 && seen;
  return (
    <div ref={boxRef} className={`min-w-0 overflow-hidden whitespace-nowrap ${className}`} title={title ?? text} style={{ height: `${base + 6}px`, lineHeight: `${base + 6}px` }}>
      <span ref={textRef} className={moving ? "fit-marquee inline-block align-top" : shift > 0 ? "inline-block align-top" : "inline-block max-w-full truncate align-top"}
        style={{ fontSize: size, ["--shift" as string]: `-${shift}px`, ["--dur" as string]: `${dur}s` }}>{text}</span>
    </div>
  );
}
