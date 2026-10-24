/**
 * 날짜 글 정규화 → 'YYYY-MM-DD' (2026-10-24, docs/tasks/kakao-collect-expand.md 3-4 날짜 정규화(a)).
 *
 * 왜: 카톡 AI 추출·앱 입력이 같은 칸에 날짜를 제각각 적는다(실측 F7).
 *   불만 날짜 `2024. 7. 12`·`2024-06-26 00:00:00`·ISO Z / 재계약 계약종료일 `26-11-15`·`26,11,30`·`26년10월22일`
 *   / 초과조정 방문일 `26-06-12 금요일`·`6월 19일` / 미수 입력일 `2026. 3. 10.` → 정렬·기간 거르기가 틀어진다.
 *
 * 주의(설계 3절): 반드시 `_dupKey` 를 계산한 **뒤에** 표시용 칸에만 적용한다.
 *   키 계산 전에 바꾸면 옛 적재분과 키가 어긋나 같은 파일을 다시 올릴 때 전부 중복으로 들어간다.
 *
 * 이 파일은 GAS 전역(Utilities 등)을 쓰지 않는다 — tests/gasLogistics.test.ts 가 node 에서 그대로 읽어 검사한다.
 */

var DATE_NORM_MON_ = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// 카테고리별로 정규화할 칸(설계 3-4 a). 여기 없는 칸은 손대지 않는다.
var KAKAO_DATE_COLS_ = {
  '불만': ['날짜', '방문일'],
  '재계약': ['계약종료일', '다음확인일'],
  '초과업체조정': ['방문일'],
  '미수': ['입력일', '입금약속일']
};

function dateNormPad_(n) { return (n < 10 ? '0' : '') + n; }

/** 연·월·일이 실제 있는 날인지 확인한 뒤 'YYYY-MM-DD' (아니면 null) */
function dateNormYmd_(y, m, d) {
  y = Number(y); m = Number(m); d = Number(d);
  if (!(y >= 1990 && y <= 2100) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
  var t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;   // 2월 30일 등
  return y + '-' + dateNormPad_(m) + '-' + dateNormPad_(d);
}

/** Date → 한국 날짜 (아침 9시 전 UTC 날짜 어긋남 방지) */
function dateNormKst_(dt) {
  if (!dt || isNaN(dt.getTime())) return null;
  return new Date(dt.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 기준일(Date 또는 'YYYY-MM-DD…' 글) → {y,m,d} 또는 null */
function dateNormRef_(refDate) {
  if (refDate == null || refDate === '') return null;
  var s = Object.prototype.toString.call(refDate) === '[object Date]' ? dateNormKst_(refDate) : String(refDate);
  var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

/**
 * 날짜 글 하나 → 'YYYY-MM-DD'. 못 읽거나 날짜가 둘 이상(기간 "26.11.15~27.11.14")이면 null.
 * 연도 없는 "6월 19일"은 refDate(글 작성일·_등록시각)가 있을 때만 그 해로(기준보다 반년 넘게 뒤면 전년), 없으면 null.
 */
function normalizeDateText(value, refDate) {
  if (value == null) return null;
  if (Object.prototype.toString.call(value) === '[object Date]') return dateNormKst_(value);
  var s = String(value).replace(/\s+/g, ' ').trim();
  if (!s) return null;

  // ISO 시각(Z·+09:00) — 시트·JSON 에서 온 값. 한국 날짜로 바꾼다(2024-06-25T15:00:00Z → 2024-06-26)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    return dateNormKst_(new Date(s));
  }
  // JS Date 문자열 "Thu Aug 24 2023 00:00:00 GMT+0900 (Korean Standard Time)" — 적힌 날짜 그대로
  var js = s.match(/^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,? +([a-z]{3})[a-z]* +(\d{1,2}),? +(\d{4})\b/i);
  if (js) {
    var mon = DATE_NORM_MON_[js[1].toLowerCase()];
    return mon ? dateNormYmd_(js[3], mon, js[2]) : null;
  }

  var found = {};
  var count = 0;
  var add = function (ymd) { if (ymd && !found[ymd]) { found[ymd] = true; count++; } };
  var mt;
  // 4자리 연도: 2026-03-10 · 2026. 3. 10. · 2026/3/10 · 2026년 3월 10일 · 2026,3,10 (뒤에 시각·요일이 붙어도 됨)
  var re4 = /(^|[^\d])(\d{4})\s*(?:년\s*|[.\-\/,]\s*)(\d{1,2})\s*(?:월\s*|[.\-\/,]\s*)(\d{1,2})(?!\d)/g;
  while ((mt = re4.exec(s))) add(dateNormYmd_(mt[2], mt[3], mt[4]));
  // 2자리 연도: 26-11-15 · 26.12.26 · 26,11,30 · 26년10월22일 → 2026
  var re2 = /(^|[^\d])(\d{2})\s*(?:년\s*|[.\-\/,]\s*)(\d{1,2})\s*(?:월\s*|[.\-\/,]\s*)(\d{1,2})(?!\d)/g;
  while ((mt = re2.exec(s))) add(dateNormYmd_(2000 + Number(mt[2]), mt[3], mt[4]));
  // 붙여 쓴 8자리: 20261115
  var re8 = /(^|[^\d])((?:19|20)\d{2})(\d{2})(\d{2})(?!\d)/g;
  while ((mt = re8.exec(s))) add(dateNormYmd_(mt[2], mt[3], mt[4]));

  if (count === 1) for (var k in found) return k;
  if (count > 1) return null;   // 기간·날짜 여럿 — 어느 것인지 모른다

  // 연도 없는 "6월 19일"
  var md = s.match(/(^|[^\d])(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (md) {
    var ref = dateNormRef_(refDate);
    if (!ref) return null;
    var cand = dateNormYmd_(ref.y, md[2], md[3]);
    if (!cand) return null;
    var diffDays = (Date.UTC(ref.y, Number(md[2]) - 1, Number(md[3])) - Date.UTC(ref.y, ref.m - 1, ref.d)) / 86400000;
    if (diffDays > 183) cand = dateNormYmd_(ref.y - 1, md[2], md[3]);   // 1월에 적은 "12월 30일" = 작년
    return cand;
  }
  return null;
}

/** 부록 B 계약: 'YYYY-MM-DD' 또는 원래 글(못 읽으면 손대지 않음). `_dupKey` 계산 뒤에만 부른다. */
function normYmd_(value, refDate) {
  var n = normalizeDateText(value, refDate);
  if (n) return n;
  return value == null ? '' : value;
}

/**
 * 카톡 적재 한 건의 날짜 칸을 제자리에서 정규화(appendKakaoRecords_ 의 지역 정규화와 같은 자리, `_dupKey` 계산 뒤).
 * 부르는 쪽 한 줄: `normalizeKakaoDates_(cat, obj, rec.date || '');` — 대상 칸이 없는 카테고리(점검·AS 등)는 아무것도 안 한다.
 */
function normalizeKakaoDates_(cat, obj, refDate) {
  var cols = KAKAO_DATE_COLS_[cat];
  if (!cols || !obj) return obj;
  for (var i = 0; i < cols.length; i++) {
    var v = obj[cols[i]];
    if (v == null || String(v).trim() === '') continue;
    obj[cols[i]] = normYmd_(v, refDate);
  }
  return obj;
}
