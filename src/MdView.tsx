/**
 * 노션식 미니 렌더러 — 제목(##/###) · 목록(-, 1.) · 구분선(---) · 토글(::: 제목 ~ :::) · 이미지 · 파일링크.
 * 복합기 가이드(knowledge_docs)와 학습자료 게시판(copier_learning_posts)이 같은 문법을 쓴다.
 */
import type { ReactNode } from "react";

function mdLine(line: string, key: number): ReactNode {
  const trimmed = line.trim();
  const image = trimmed.match(/^!\[[^\]]*\]\(([^)]+)\)$/);
  if (image) return <a key={key} href={image[1]} target="_blank" rel="noreferrer"><img src={image[1]} alt="" loading="lazy" className="max-h-[420px] rounded-lg border border-slate-200" /></a>;
  const file = trimmed.match(/^\[([^\]]+)\]\((https?:[^)]+)\)$/);
  if (file) return <a key={key} href={file[2]} target="_blank" rel="noreferrer" className="inline-block rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-black text-blue-700">📎 {file[1]}</a>;
  if (/^(---|\*\*\*|___)\s*$/.test(trimmed)) return <hr key={key} className="my-3 border-slate-200" />;
  if (/^\d+[.)]\s/.test(trimmed)) return <li key={key} className="ml-5 list-decimal text-sm leading-6 text-slate-800">{trimmed.replace(/^\d+[.)]\s*/, "")}</li>;
  if (/^[-•]\s/.test(trimmed)) return <li key={key} className="ml-5 list-disc text-sm leading-6 text-slate-800">{trimmed.replace(/^[-•]\s*/, "")}</li>;
  if (/^###/.test(trimmed)) return <h4 key={key} className="pt-1.5 text-[15px] font-black text-slate-800">{trimmed.replace(/^###\s*/, "")}</h4>;
  if (/^##/.test(trimmed)) return <h3 key={key} className="border-b border-slate-100 pb-1 pt-2.5 text-lg font-black text-slate-950">{trimmed.replace(/^##\s*/, "")}</h3>;
  if (!trimmed) return null;
  return <p key={key} className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{line}</p>;
}

export default function MdView({ text }: { text: string }) {
  const lines = String(text || "").split("\n");
  const out: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const trimmed = lines[index].trim();
    // ::: 제목 ~ ::: → 접었다 펴는 토글
    if (/^:::\s*\S/.test(trimmed)) {
      const title = trimmed.replace(/^:::\s*/, "");
      const body: string[] = [];
      index += 1;
      while (index < lines.length && lines[index].trim() !== ":::") { body.push(lines[index]); index += 1; }
      index += 1; // 닫는 ::: 건너뛰기
      out.push(
        <details key={`toggle-${out.length}`} className="rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5">
          <summary className="cursor-pointer select-none text-sm font-black text-slate-800">{title}</summary>
          <div className="mt-2"><MdView text={body.join("\n")} /></div>
        </details>,
      );
      continue;
    }
    out.push(mdLine(lines[index], out.length));
    index += 1;
  }
  return <div className="space-y-2">{out}</div>;
}
