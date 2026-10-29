/**
 * 카톡 원문 보관 — 내보내기 TXT 를 엣지 kakao-ingest 로 보낸다 (2026-10-24, 원문 보존)
 * 설계: docs/tasks/kakao-collect-expand.md 3-5 ⑤(증분 전송) · 부록 B(kakaoRawForward_ 계약)
 *
 * 부르는 곳: Drive.gs ingestFromDriveFolder (plan.raw 일 때) → kakaoRawForward_(room, text, route)
 *            수동 시험: pushRawMessages_('강남C 점검방', 파일글, '파일이름.txt')
 *
 * 인증: 스크립트 속성 FIELD_INGEST_TOKEN(엣지 시크릿 FIELD_INGEST_TOKEN 과 같은 값)을 헤더 x-ingest-token 으로.
 *       Authorization 은 공개 anon 키(엣지 기본 JWT 검사 통과용). 서비스 키는 쓰지 않는다.
 *
 * 증분: 엣지에 그 방의 마지막 적재 시각(kakao_import_log 의 성공 조각 max(to_at))을 묻고,
 *       그 날짜 "하루 전" 날짜 띠부터만 보낸다(첫 회는 전체). 겹치는 하루는 엣지가 hash 로 건너뛴다.
 * 조각: 날짜 띠 경계로 450KB 이하(엣지 한도 500KB). 하루치가 450KB 를 넘으면 글 머리 줄 경계에서 자르고
 *       뒤 조각 맨 앞에 그날 날짜 띠를 다시 붙인다(대괄호형은 날짜 띠가 있어야 날짜를 안다).
 * 시간: GAS 6분 한도 — 4분이 지나면 멈추고 { ok:false, error:'시간 부족…' }. 다음 실행이 마지막 적재 시각부터 잇는다.
 * 실패해도 throw 하지 않는다(구조 적재를 막지 않음) — 돌려준 error 를 Drive.gs 가 업로드 로그에 남긴다.
 */

var KAKAO_RAW_CHUNK_BYTES = 450 * 1024;
var KAKAO_RAW_TIME_MS = 4 * 60 * 1000;
// 조각 하나가 DB 문장 시간 초과(57014, PostgREST 8초)·게이트웨이 시간 초과로 실패하면 잠깐 쉬고 같은 조각을 다시 보낸다.
// 2026-10-29·30 "강남C as" 첫 적재(50조각)가 매번 1~2조각째 500행 넣기에서 57014 로 끊겼다 — 같은 행이 다음 날엔 들어가는
// 일시 실패인데, 여기서 바로 멈추면 파일이 처리됨으로 옮겨져 다음 날 새 파일까지 원문이 하루 1~2조각씩만 늘었다.
// 다시 보내도 안전하다: 엣지가 on_conflict=hash 로 이미 들어간 글은 건너뛴다.
var KAKAO_RAW_RETRY = 2;
var KAKAO_RAW_RETRY_WAIT_MS = 5000;
function kakaoRawRetryable_(err) {
  return /57014|statement timeout|\((?:502|503|504|546)\)|timed out|시간 초과/i.test(String(err || ''));
}

// 날짜 띠·글 머리 (supabase/functions/_shared/kakao-parse.ts 와 같은 형식)
var KR_DATE_BAR_ = /^[-=\s]*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일(?:\s*[월화수목금토일]요일)?(?:\s*(?:오전|오후)?\s*\d{1,2}:\d{2})?[-=\s]*$/;
var KR_DOT_BAR_ = /^[-=\s]*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?(?:\s*[월화수목금토일]요일)?[-=\s]*$/;
var KR_DOT_MSG_ = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*(?:오전|오후)?\s*\d{1,2}:\d{2},/;
var KR_YMD_MSG_ = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*(?:오전|오후)?\s*\d{1,2}:\d{2},/;
var KR_BRACKET_MSG_ = /^\[[^\]]+\]\s*\[(?:오전|오후)?\s*\d{1,2}:\d{2}\]/;

/** 부록 B 계약: (room, text, route?) → { ok, sent, chunks, error }. 세 번째 인자가 글이면 파일 이름으로 쓴다 */
function kakaoRawForward_(room, text, routeOrFile) {
  var file = typeof routeOrFile === 'string' ? routeOrFile : (routeOrFile && routeOrFile.fileName) || '';
  return pushRawMessages_(room, text, file);
}

/**
 * 원문 보내기. 돌려주는 값 { ok, sent(새로 들어간 글), skipped(이미 있던 글), chunks(보낸 조각), total(보낼 조각), from, error }
 */
function pushRawMessages_(roomName, fileText, sourceFile) {
  var out = { ok: false, sent: 0, skipped: 0, chunks: 0, total: 0, from: '', error: '' };
  var started = Date.now();
  try {
    var room = String(roomName || '').trim();
    var text = String(fileText || '');
    if (!room) { out.error = '방 이름 없음'; return out; }
    if (!text.trim()) { out.ok = true; return out; }
    var token = PropertiesService.getScriptProperties().getProperty('FIELD_INGEST_TOKEN') || '';
    if (!token) { out.error = '스크립트 속성 FIELD_INGEST_TOKEN 없음'; return out; }

    var last = kakaoRawCall_({ mode: 'last', room: room }, token);
    if (!last.ok) { out.error = '마지막 적재 시각 조회 실패: ' + last.error; return out; }
    var since = last.last_to_at ? kakaoRawDayBefore_(last.last_to_at) : '';
    out.from = since || '처음부터';

    var segs = kakaoRawSegments_(text).filter(function (s) { return s.date && (!since || s.date >= since); });
    if (!segs.length) { out.ok = true; return out; }
    var chunks = kakaoRawChunks_(segs, KAKAO_RAW_CHUNK_BYTES);
    out.total = chunks.length;
    var fileName = String(sourceFile || '').split(/[\\/]/).pop();

    for (var i = 0; i < chunks.length; i++) {
      if (Date.now() - started > KAKAO_RAW_TIME_MS) {
        out.error = '시간 부족 — ' + i + '/' + chunks.length + '조각까지 보냄, 다음 실행에서 이어감';
        return out;
      }
      var r = null;
      for (var attempt = 0; attempt <= KAKAO_RAW_RETRY; attempt++) {
        if (attempt) Utilities.sleep(KAKAO_RAW_RETRY_WAIT_MS * attempt);
        r = kakaoRawCall_({
          room: room, text: chunks[i], file_name: fileName, chunk_index: i, chunk_count: chunks.length, source: 'gas-drive'
        }, token);
        if (r.ok || !kakaoRawRetryable_(r.error) || Date.now() - started > KAKAO_RAW_TIME_MS) break;
      }
      if (!r.ok) { out.error = (i + 1) + '/' + chunks.length + '조각 실패: ' + r.error; return out; }
      out.chunks++;
      out.sent += Number(r.inserted || 0);
      out.skipped += Number(r.skipped || 0);
    }
    out.ok = true;
    return out;
  } catch (e) {
    out.error = String(e && e.message || e).slice(0, 200);
    return out;
  }
}

/** 엣지 호출 한 번 → 응답 JSON(+ok). 네트워크·HTTP 실패도 { ok:false, error } 로 */
function kakaoRawCall_(payload, token) {
  try {
    var res = UrlFetchApp.fetch(SUPABASE_URL + '/functions/v1/kakao-ingest', {
      method: 'post',
      contentType: 'application/json',
      headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON, 'x-ingest-token': token },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    var body = {};
    try { body = JSON.parse(res.getContentText() || '{}'); } catch (pe) { body = { error: String(res.getContentText()).slice(0, 120) }; }
    if (code >= 300 || body.ok === false) return { ok: false, error: '(' + code + ') ' + String(body.error || '응답 오류').slice(0, 150) };
    body.ok = true;
    return body;
  } catch (e) {
    return { ok: false, error: String(e && e.message || e).slice(0, 150) };
  }
}

/** ISO 시각 → KST 날짜의 하루 전 'YYYY-MM-DD' */
function kakaoRawDayBefore_(iso) {
  var t = Date.parse(String(iso));
  if (isNaN(t)) return '';
  var kstDay = new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);
  return new Date(Date.parse(kstDay + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
}

function kr2_(n) { n = String(n); return n.length < 2 ? '0' + n : n; }

/** TXT → 날짜 띠 묶음 [{ date:'YYYY-MM-DD', lines:[…], bar:'그날 날짜 띠 줄' 또는 '' }]. 첫 날짜 앞의 파일 머리는 date '' 묶음 */
function kakaoRawSegments_(text) {
  var lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  var segs = [];
  var cur = { date: '', lines: [], bar: '' };
  segs.push(cur);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var m = line.match(KR_DATE_BAR_) || line.match(KR_DOT_BAR_);
    if (m) {
      var d = m[1] + '-' + kr2_(m[2]) + '-' + kr2_(m[3]);
      if (d !== cur.date || cur.bar) { cur = { date: d, lines: [], bar: line }; segs.push(cur); }
      else if (!cur.bar) cur.bar = line;
      cur.lines.push(line);
      continue;
    }
    var mm = line.match(KR_DOT_MSG_) || line.match(KR_YMD_MSG_);
    if (mm) {
      var md = mm[1] + '-' + kr2_(mm[2]) + '-' + kr2_(mm[3]);
      if (md !== cur.date) { cur = { date: md, lines: [], bar: '' }; segs.push(cur); }
    }
    cur.lines.push(line);
  }
  return segs.filter(function (s) { return s.lines.length; });
}

/** UTF-8 바이트 수(줄 하나) — Utilities.newBlob 을 줄마다 부르지 않으려고 직접 센다 */
function kakaoRawBytes_(s) {
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

/** 날짜 묶음 → 조각 글 목록(각 max 바이트 이하, 날짜 띠 경계. 큰 하루는 글 머리 줄에서 자르고 날짜 띠를 다시 붙임) */
function kakaoRawChunks_(segs, max) {
  var chunks = [];
  var buf = [];
  var size = 0;
  function flush() { if (buf.length) { chunks.push(buf.join('\n')); buf = []; size = 0; } }
  for (var s = 0; s < segs.length; s++) {
    var seg = segs[s];
    var segBytes = 0;
    for (var k = 0; k < seg.lines.length; k++) segBytes += kakaoRawBytes_(seg.lines[k]) + 1;
    if (segBytes <= max) {
      if (size + segBytes > max) flush();
      buf = buf.concat(seg.lines);
      size += segBytes;
      continue;
    }
    // 하루치가 한도보다 크다 — 글 머리 줄에서 자른다
    flush();
    var barBytes = seg.bar ? kakaoRawBytes_(seg.bar) + 1 : 0;
    for (var j = 0; j < seg.lines.length; j++) {
      var line = seg.lines[j];
      var b = kakaoRawBytes_(line) + 1;
      var isHead = KR_BRACKET_MSG_.test(line) || KR_DOT_MSG_.test(line) || KR_YMD_MSG_.test(line);
      if (size + b > max && isHead && buf.length) {
        flush();
        if (seg.bar) { buf.push(seg.bar); size = barBytes; }
      }
      if (b > max) line = line.slice(0, Math.floor(max / 3) - 100); // 한 줄이 한도보다 크면(사실상 없음) 잘라서라도 보낸다
      buf.push(line);
      size += Math.min(b, max);
    }
    flush();
  }
  flush();
  return chunks;
}

/** 수동 시험(편집기에서 실행) — 드라이브 파일 ID 와 방 이름을 넣고 돌린다. 실제로 보낸다 */
function testPushRawMessages() {
  var fileId = '';   // ← 시험할 TXT 파일 ID
  var room = '';     // ← kakao_collect_rooms 에 있는 방 이름
  if (!fileId || !room) { Logger.log('fileId·room 을 넣고 실행하세요'); return; }
  var f = DriveApp.getFileById(fileId);
  Logger.log(JSON.stringify(pushRawMessages_(room, f.getBlob().getDataAsString('UTF-8'), f.getName())));
}
