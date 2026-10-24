/**
 * 카톡 물류 양식 → Supabase logistics_records (2026-10-24, docs/tasks/kakao-collect-expand.md 3-3).
 *
 * 무엇: 물류 방 카톡 글 중 FIELD 물류 양식(라벨형, src/logistics.ts buildLogisticsText)만 규칙으로 읽어 적재한다.
 *   - 마스터 시트 탭은 만들지 않는다(2026-08-27 셀 한도 사고) — Supabase 에만.
 *   - `_dupKey` = md5(작성일|작성자|구분|거래처명|품목|수량|특이사항) — 앱 sendLogisticsForm(src/api.ts)과 같은 식.
 *     같은 글이면 on_conflict 로 무시된다.
 *   - 이중 방어: 넣기 전에 그 날짜 ±1일 logistics_records 를 읽어 앱 저장분(_출처 '웹앱*')과
 *     (구분 같음 + 업체 키 같음 + 날짜 차 1일 이하)면 건너뛴다. 카톡 출처 행과는 _dupKey 일치만 본다.
 *     ±1일 = 밤에 쓴 양식이 다음 날 아침에 방에 올라가는 경우(봇 발송 시간 규칙).
 *   - 자유 글(라벨 없는 글)은 적재하지 않고 "비양식 물류 글" 수만 로그로 남긴다(AI 여부는 1주 뒤, 설계 Q8).
 *
 * 부르는 곳: Drive.gs 라우팅(구현서 A). 실패해도 throw 하지 않고 {ok:false, error} 를 돌려준다.
 * 날짜 칸 정규화는 하지 않는다 — 작성일은 카톡 날짜 띠에서 이미 'YYYY-MM-DD' 로 온다.
 */

// 앱 양식의 라벨 순서 그대로(src/logistics.ts). key = logistics_records 컬럼명.
var LOGI_LABELS_ = [
  { key: '작성자', re: /^작성자\s*[:：]/ },
  { key: '구분', re: /^구분\s*[:：]/ },
  { key: '거래처명', re: /^거래처명[^:：\n]*[:：]/ },          // "거래처명(지점/현장명 必) :"
  { key: '품목', re: /^품목\s*[:：]/ },
  { key: '수량', re: /^수량\s*[:：]/ },
  { key: '소모품(납품/청구여부)', re: /^소모품[^:：\n]*[:：]/ },
  { key: '셋팅여부', re: /^셋팅\s*여부\s*[:：]/ },
  { key: '이메일카운터셋팅완료', re: /^이메일\s*카운터[^:：\n]*[:：]/ },
  { key: '한조셋팅완료', re: /^한조[^:：\n]*[:：]/ },
  { key: '상태체크(내부/외부)', re: /^상태\s*체크[^:：\n]*[:：]/ },
  { key: '여분토너체크(철수 시)', re: /^여분\s*토너[^:：\n]*[:：]/ },
  { key: '특이사항', re: /^특이사항\s*[:：]/ }
];
// 앱이 전송본 뒤에 붙이는 사진 앨범 꼬리("📷 현장사진 모아보기" + ?album= 링크) — 양식 내용이 아니다
var LOGI_TAIL_RE_ = /^(?:📷|현장사진|\S*\?album=)/;
// 내용 없는 카톡 알림 줄(사진·이모티콘 등) — 비양식 글 수에서 뺀다
var LOGI_NOISE_RE_ = /^(사진( ?\d+장)?|동영상|이모티콘|음성메시지|파일:.*|보이스톡.*|페이스톡.*|삭제된 메시지입니다\.?|채팅방 관리자가.*)$/;

/** 물류 양식 판정: `구분:` 줄과 `거래처명…:` 줄이 둘 다 있다(점검·AS 양식은 `업체명`이라 겹치지 않음) */
function isLogisticsForm_(content) {
  var c = String(content || '');
  return /(^|\n)\s*구분\s*[:：]/.test(c) && /(^|\n)\s*거래처명[^:：\n]*[:：]/.test(c);
}

/** 라벨형 글 → {컬럼: 값}. 라벨 없는 줄은 앞 칸(주로 특이사항)에 이어 붙인다. 앨범 꼬리에서 멈춘다. */
function parseLogisticsForm_(content) {
  var lines = String(content || '').replace(/\r/g, '').split('\n');
  var f = {};
  for (var i = 0; i < LOGI_LABELS_.length; i++) f[LOGI_LABELS_[i].key] = '';
  var cur = null;
  for (var j = 0; j < lines.length; j++) {
    var line = lines[j].trim();
    if (!line) continue;
    if (LOGI_TAIL_RE_.test(line)) break;
    var hit = null;
    for (var k = 0; k < LOGI_LABELS_.length; k++) {
      var m = line.match(LOGI_LABELS_[k].re);
      if (m) { hit = { key: LOGI_LABELS_[k].key, val: line.slice(m[0].length).trim() }; break; }
    }
    if (hit) { cur = hit.key; f[cur] = hit.val; continue; }
    if (cur) f[cur] = f[cur] ? f[cur] + '\n' + line : line;
  }
  return f;
}

/** 앱 src/md5.ts 와 같은 hex(UTF-8 MD5). GAS computeDigest 는 부호 있는 바이트라 +256 보정. */
function logisticsMd5_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(text), Utilities.Charset.UTF_8);
  var hex = '';
  for (var b = 0; b < bytes.length; b++) {
    var v = bytes[b] < 0 ? bytes[b] + 256 : bytes[b];
    hex += (v < 16 ? '0' : '') + v.toString(16);
  }
  return hex;
}

/** 앱 sendLogisticsForm 의 _dupKey 와 같은 식 */
function logisticsDupKey_(date, author, category, vendor, item, quantity, notes) {
  return logisticsMd5_([date, author, category, vendor, item, quantity, notes].join('|'));
}

/** 업체 비교키 — supabase/functions/_shared/counter-sms/vendorKey.ts vendorMatchKey 와 같은 규칙(GAS 옮김) */
function logisticsVendorKey_(value) {
  return String(value || '')
    .replace(/㈜|\(주\)|\(유\)/g, '')
    .replace(/\([^)]*\)?/g, ' ')
    .replace(/^(?:\d{4}\/)?\d+[#/\-\s]*(?:SS|NN|S|N|V)?[A-Z]?(?=[가-힣㈜(])/i, '')
    .replace(/^(?:\d{4}\/)?\d+[#/\-\s]*(?:SS|NN|S|N|V)?/i, '')
    .replace(/(?:분기|매월|계약종료|재계약|점검|마감).*$/i, '')
    .replace(/[^0-9a-z가-힣]/gi, '')
    .toLowerCase()
    .replace(/(주식회사|유한회사|유한책임회사|재단법인|사단법인|농업회사법인|의료법인|학교법인)/g, '');
}

function logisticsDayNum_(ymd) {
  var m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000 : null;
}
function logisticsShiftYmd_(ymd, days) {
  var n = logisticsDayNum_(ymd);
  return n == null ? '' : new Date((n + days) * 86400000).toISOString().slice(0, 10);
}

/**
 * 카톡 메시지 배열 → 적재할 행 + 집계. (순수 함수 — 네트워크 없음, 테스트 대상)
 * messages: parseKakaoMessages_ 결과 [{date:'YYYY-MM-DD', author, text}]
 * opts: {team, isBot(author)→bool}
 */
function buildLogisticsRows_(messages, opts) {
  opts = opts || {};
  var team = String(opts.team || '').trim();
  var srcLabel = '카톡:물류' + (team && team !== '*' ? '(' + team + ')' : '');
  var out = { rows: [], parsed: (messages || []).length, forms: 0, freeText: 0, bot: 0, noVendor: 0, noDate: 0 };
  var seen = {};
  for (var i = 0; i < (messages || []).length; i++) {
    var m = messages[i] || {};
    var text = String(m.text || '');
    if (!text.trim() || LOGI_NOISE_RE_.test(text.trim())) continue;
    if (opts.isBot && opts.isBot(m.author)) { out.bot++; continue; }
    if (!isLogisticsForm_(text)) { out.freeText++; continue; }
    out.forms++;
    var f = parseLogisticsForm_(text);
    var vendor = f['거래처명'];
    if (!vendor) { out.noVendor++; continue; }
    var date = String(m.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { out.noDate++; continue; }   // 날짜 띠 앞 글 — 키를 만들 수 없다
    var author = f['작성자'] || String(m.author || '').replace(/님$/, '').trim();
    var key = logisticsDupKey_(date, author, f['구분'], vendor, f['품목'], f['수량'], f['특이사항']);
    if (seen[key]) continue;
    seen[key] = true;
    var row = { '작성일': date, '작성자': author };
    for (var k = 1; k < LOGI_LABELS_.length; k++) row[LOGI_LABELS_[k].key] = f[LOGI_LABELS_[k].key];
    row['_업체명'] = vendor;
    row['_원문'] = text;
    row['_출처'] = srcLabel;
    row['_dupKey'] = key;
    out.rows.push(row);
  }
  return out;
}

/**
 * 이중 방어 두 번째 겹: 이미 표에 있는 행과 (같은 _dupKey — 출처 무관) 또는
 * (출처 '웹앱*' 행과 구분 같음 + 업체 키 같음 + 날짜 차 ≤1일) 이면 뺀다.
 * existing: logistics_records 행 [{작성일, 구분, 거래처명, _업체명, _출처, _dupKey}]. (순수 함수)
 */
function filterLogisticsAgainstExisting_(rows, existing) {
  var keep = [], dupKey = 0, near = 0;
  var byKey = {};
  for (var e = 0; e < existing.length; e++) if (existing[e]._dupKey) byKey[existing[e]._dupKey] = true;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (byKey[r._dupKey]) { dupKey++; continue; }
    var rCat = String(r['구분'] || '').trim();
    var rVk = logisticsVendorKey_(r['_업체명'] || r['거래처명']);
    var rRaw = String(r['_업체명'] || r['거래처명'] || '').trim();
    var rDay = logisticsDayNum_(r['작성일']);
    var hit = false;
    for (var j = 0; j < existing.length && !hit; j++) {
      var x = existing[j];
      // 유사 중복은 앱 저장분(웹앱:*)과만 비교한다 — 막을 것은 "앱 저장 → 봇 공유 글" 2중 적재뿐이고,
      // 사람이 이틀 연속 같은 업체·같은 구분 양식을 올리는 건 실제 작업이다(2026-10-24 팀장 결정)
      if (String(x['_출처'] || '').indexOf('웹앱') !== 0) continue;
      if (String(x['구분'] || '').trim() !== rCat) continue;
      var xDay = logisticsDayNum_(x['작성일']);
      if (rDay == null || xDay == null || Math.abs(rDay - xDay) > 1) continue;
      var xName = x['_업체명'] || x['거래처명'];
      var xVk = logisticsVendorKey_(xName);
      // 업체 키가 비면(기호뿐인 이름) 원래 이름이 똑같을 때만 같은 업체로 본다
      hit = rVk ? rVk === xVk : rRaw !== '' && rRaw === String(xName || '').trim();
    }
    if (hit) { near++; continue; }
    keep.push(r);
  }
  return { rows: keep, dupKey: dupKey, near: near };
}

/** logistics_records 읽기(anon). 실패면 throw — 부르는 쪽이 적재를 멈춘다(방어 없이 넣지 않음). */
function logisticsSelect_(query) {
  var res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/' + (SUPABASE_TABLE['물류'] || 'logistics_records') + '?' + query, {
    method: 'get',
    headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code >= 300) throw new Error('logistics_records 읽기 ' + code + ': ' + res.getContentText().slice(0, 150));
  return JSON.parse(res.getContentText() || '[]');
}

/**
 * 부록 B 계약: ingestLogisticsForms_(route, text) → {ok, parsed, records, added, skipped, ...}
 *   route = {roomName, kinds, team}, text = 카톡 저장 파일 전체.
 *   (메시지 배열을 이미 갖고 있으면 ingestLogisticsForms_(messages, regionLabel) 로도 부를 수 있다)
 * 봇이 올린 글(isBotAuthor_, 구현서 A Kakao.gs)은 구조 적재에서 뺀다 — 앱이 이미 저장한 글이다(설계 F6).
 */
function ingestLogisticsForms_(routeOrMessages, textOrTeam) {
  var res = { ok: false, parsed: 0, records: 0, added: 0, skipped: 0, freeText: 0, bot: 0 };
  try {
    var messages, team;
    if (Array.isArray(routeOrMessages)) {
      messages = routeOrMessages;
      team = String(textOrTeam || '');
    } else {
      var route = routeOrMessages || {};
      team = String(route.team || '');
      messages = parseKakaoMessages_(String(textOrTeam || ''));
    }
    var isBot = typeof isBotAuthor_ === 'function' ? isBotAuthor_ : null;
    var built = buildLogisticsRows_(messages, { team: team, isBot: isBot });
    res.parsed = built.parsed; res.records = built.rows.length;
    res.freeText = built.freeText; res.bot = built.bot;
    res.noVendor = built.noVendor; res.noDate = built.noDate;
    // 자유 글은 적재하지 않는다 — 수만 남겨 1주 뒤 AI 여부를 정한다(설계 Q8)
    Logger.log('[물류] 글 ' + built.parsed + ' / 양식 ' + built.forms + ' / 비양식 물류 글 ' + built.freeText +
      ' / 봇 ' + built.bot + ' / 거래처명 없음 ' + built.noVendor + ' / 날짜 없음 ' + built.noDate);
    if (!built.rows.length) { res.ok = true; return res; }

    // 넣을 날짜 범위 ±1일의 기존 행(표가 작다 — 2026-10 기준 79행)
    var minD = built.rows[0]['작성일'], maxD = minD;
    for (var i = 1; i < built.rows.length; i++) {
      var d = built.rows[i]['작성일'];
      if (d < minD) minD = d;
      if (d > maxD) maxD = d;
    }
    var DATE = encodeURIComponent('"작성일"');
    var existing = logisticsSelect_(
      'select=' + encodeURIComponent('"작성일","구분","거래처명","_업체명","_출처","_dupKey"') +
      '&' + DATE + '=gte.' + logisticsShiftYmd_(minD, -1) +
      '&' + DATE + '=lte.' + logisticsShiftYmd_(maxD, 1) + '&limit=20000');
    var f = filterLogisticsAgainstExisting_(built.rows, existing);
    res.skipped = f.dupKey + f.near;
    res.skippedNear = f.near;
    if (!f.rows.length) { res.ok = true; return res; }

    supabaseInsertIgnore_(SUPABASE_TABLE['물류'] || 'logistics_records', f.rows);   // 실패는 로그만 남기는 함수

    // 들어갔는지 다시 확인한다 — supabaseInsertIgnore_ 는 실패를 돌려주지 않는다(_dupKey unique 가 없으면 400 으로 전부 빠짐)
    var keys = f.rows.map(function (r) { return r._dupKey; });
    var present = 0;
    for (var c = 0; c < keys.length; c += 100) {
      var got = logisticsSelect_('select=' + encodeURIComponent('"_dupKey"') + '&' +
        encodeURIComponent('"_dupKey"') + '=in.(' + keys.slice(c, c + 100).join(',') + ')');
      present += got.length;
    }
    res.added = present;
    if (present < keys.length) {
      res.error = '물류 적재 확인 실패: ' + keys.length + '건 중 ' + present + '건만 표에 있음(Apps Script 로그 [Supabase] 줄 확인)';
      Logger.log('[물류] ' + res.error);
      return res;
    }
    res.ok = true;
    return res;
  } catch (err) {
    res.error = String(err);
    Logger.log('[물류] 적재 중단: ' + err);
    return res;
  }
}
