/**
 * 긴 제목을 '글자 그대로' 한 줄에(2026-10-02, 일정리스트 폰 제목 잘림).
 *  1) 기준 크기로 재서 넘치면 글자를 최소 크기까지 줄여 맞춘다.
 *  2) 그래도 넘치면 그 줄 안에서 천천히 좌우로 흘려(멈춤 → 끝까지 → 멈춤 → 되돌림) 끝까지 읽히게 한다.
 *  행 높이는 기준 크기 기준으로 고정이라 목록이 길어지지 않는다. 모션 줄이기 설정이면 흘리지 않고 말줄임.
 */
import { useEffect, useRef, useState } from "react";

export default function FitTitle({ text, className = "", base = 14, min = 11, title }: { text: string; className?: string; base?: number; min?: number; title?: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState(base);
  const [shift, setShift] = useState(0);
  useEffect(() => {
    const box = boxRef.current, el = textRef.current;
    if (!box || !el) return;
    const measure = () => {
      el.style.fontSize = `${base}px`;
      const need = el.scrollWidth, have = box.clientWidth;
      if (!need || !have) return;
      const fit = Math.max(min, Math.min(base, Math.floor((base * have) / need * 10) / 10));
      el.style.fontSize = `${fit}px`;
      const over = el.scrollWidth - have;
      setSize(fit);
      setShift(over > 2 ? over : 0);
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(box);
    return () => ro?.disconnect();
  }, [text, base, min]);
  const dur = Math.max(5, Math.round(shift / 22) + 4); // 넘친 만큼 천천히(초)
  return (
    <div ref={boxRef} className={`min-w-0 overflow-hidden whitespace-nowrap ${className}`} title={title ?? text} style={{ height: `${base + 6}px`, lineHeight: `${base + 6}px` }}>
      <span ref={textRef} className={shift ? "fit-marquee inline-block align-top" : "inline-block max-w-full truncate align-top"}
        style={{ fontSize: size, ["--shift" as string]: `-${shift}px`, ["--dur" as string]: `${dur}s` }}>{text}</span>
    </div>
  );
}
