/**
 * 고객 리포트 뷰어 — 문자 링크로 열리는 공개 HTML 페이지.
 * Supabase 스토리지(text/plain 강제)와 엣지 함수(게이트웨이가 HTML 차단) 모두 HTML을 못 내려서
 * GAS HtmlService가 담당한다. 우리 reports 버킷의 png 경로만 허용.
 *   ?action=reportview&f=2026-08/abc-1-p1.png,2026-08/abc-1-p2.png&v=업체명
 */
var REPORT_BUCKET_BASE = 'https://kkdiihazgzesbqxjytqv.supabase.co/storage/v1/object/public/reports/';

function reportViewHtml_(filesParam, vendorParam) {
  var files = String(filesParam || '').split(',').map(function (f) { return f.trim(); })
    .filter(function (f) { return /^\d{4}-\d{2}\/[A-Za-z0-9._-]+\.png$/.test(f); }).slice(0, 4);
  var vendor = String(vendorParam || '').slice(0, 40)
    .replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; });
  if (!files.length) {
    return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px">리포트를 찾을 수 없습니다.</p>').setTitle('퍼스트전산');
  }
  var imgs = files.map(function (f, i) {
    return '<img src="' + REPORT_BUCKET_BASE + f + '" alt="리포트 ' + (i + 1) + '장" style="width:100%;display:block;margin-bottom:10px;box-shadow:0 1px 6px rgba(15,23,42,.12)">';
  }).join('');
  var html = '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1"></head>'
    + '<body style="margin:0;background:#f1f3f6;font-family:sans-serif">'
    + '<div style="max-width:840px;margin:0 auto;padding:10px 8px 20px">' + imgs
    + '<div style="padding:6px 4px;text-align:center;font-size:12px;color:#64748b">퍼스트전산 · 문의 1522-1093</div>'
    + '</div></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle('퍼스트전산 서비스 리포트' + (vendor ? ' — ' + vendor : ''))
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
