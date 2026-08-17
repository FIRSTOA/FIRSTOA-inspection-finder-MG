/**
 * 고객용 리포트 뷰어 — 문자 링크로 열리는 공개 페이지.
 * 저장소가 HTML을 text/plain으로 강제해 직접 못 올리므로, 이 함수가 흰 배경 페이지로 감싸 내려준다.
 * 인증 없음(--no-verify-jwt): 고객이 헤더 없이 연다. 우리 reports 버킷의 png 경로만 허용.
 *   GET ?f=2026-08/abc-123-p1.png,2026-08/abc-123-p2.png&v=업체명
 */
const BUCKET_BASE = "https://kkdiihazgzesbqxjytqv.supabase.co/storage/v1/object/public/reports/";
const esc = (value: string) => value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] || ch));

Deno.serve((req) => {
  const url = new URL(req.url);
  const files = (url.searchParams.get("f") || "").split(",").map((f) => f.trim())
    .filter((f) => /^\d{4}-\d{2}\/[A-Za-z0-9._-]+\.png$/.test(f)).slice(0, 4);
  if (!files.length) return new Response("리포트를 찾을 수 없습니다.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const vendor = esc((url.searchParams.get("v") || "").slice(0, 40));
  const html = [
    '<!doctype html><html lang="ko"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>퍼스트전산 서비스 리포트${vendor ? ` — ${vendor}` : ""}</title></head>`,
    '<body style="margin:0;background:#f1f3f6;font-family:sans-serif">',
    '<div style="max-width:840px;margin:0 auto;padding:10px 8px 20px">',
    ...files.map((file, index) => `<img src="${BUCKET_BASE}${file}" alt="리포트 ${index + 1}장" style="width:100%;display:block;margin-bottom:10px;box-shadow:0 1px 6px rgba(15,23,42,.12)">`),
    '<div style="padding:6px 4px;text-align:center;font-size:12px;color:#64748b">퍼스트전산 · 문의 1522-1093</div>',
    "</div></body></html>",
  ].join("");
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=86400" } });
});
