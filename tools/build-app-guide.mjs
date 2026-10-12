/**
 * public/guide/*.html(사용설명서 21편) → supabase/functions/_shared/app-guide.json
 * 통합검색의 "전체 데이터·지식에 질문"(data-ask)이 앱 사용법·업무 절차 질문에 이 글을 근거로 답한다(2026-10-12).
 * 설명서를 고치면 `node tools/build-app-guide.mjs` 를 다시 돌리고 data-ask 를 배포한다.
 */
import fs from "node:fs";
import path from "node:path";

const dir = "public/guide";
const out = "supabase/functions/_shared/app-guide.json";
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".html")).sort();
const pages = [];
for (const f of files) {
  let html = fs.readFileSync(path.join(dir, f), "utf8");
  html = html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<svg[\s\S]*?<\/svg>/gi, "").replace(/<nav[\s\S]*?<\/nav>/gi, "");
  const title = html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() || f;
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] || html.replace(/<head[\s\S]*?<\/head>/i, "");
  const text = main
    .replace(/<h1[^>]*>/gi, "\n# ").replace(/<h2[^>]*>/gi, "\n## ").replace(/<h3[^>]*>/gi, "\n### ").replace(/<h4[^>]*>/gi, "\n#### ")
    .replace(/<\/(h1|h2|h3|h4|p|li|tr|div|section|article|dt|dd|blockquote|figcaption)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&middot;/g, "·")
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  pages.push({ key: f.replace(/\.html$/, ""), title, text });
}
fs.writeFileSync(out, JSON.stringify(pages), "utf8");
console.log(pages.map((p) => `${p.key.padEnd(16)} ${String(p.text.length).padStart(6)}자  ${p.title}`).join("\n"));
console.log(`→ ${out} (${pages.length}편, ${fs.statSync(out).size.toLocaleString()} bytes)`);
