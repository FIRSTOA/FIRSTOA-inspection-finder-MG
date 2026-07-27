/**
 * 임대리스트 원본 시트 → Supabase vendor_info 주간 동기화
 *
 * CS 웹앱(FIRSTOA-inspection-finder-MG)의 서비스접수 임대리스트 검색이 Supabase
 * vendor_info를 읽는다. 2026-07-20에 1회 수동 적재된 뒤 갱신이 없어, 시트 변경분이
 * 웹앱에 반영되도록 매주 월요일 새벽 5시(마스터 동기화 2시 이후)에 업서트한다.
 *
 * 준비 (1회):
 *  1) Supabase SQL: 순번 유니크 인덱스 생성 — 웹앱 저장소 supabase/vendor-sync.sql 참고
 *  2) Apps Script 편집기 → 프로젝트 설정 → 스크립트 속성에
 *     SUPABASE_SERVICE_KEY = (Supabase 대시보드 → Settings → API → service_role secret)
 *  3) previewLeaseSupabaseSync() 실행으로 건수·샘플 확인
 *  4) syncLeaseToSupabase() 1회 실행 → 메뉴의 트리거 설치 실행
 *
 * 동작:
 *  - 원본 임대리스트 시트(80컬럼)를 그대로 _raw로 만들고, 웹앱이 쓰는 승격 컬럼
 *    (등급·종료일 등 23개)도 같은 값으로 채워 순번 기준 업서트한다.
 *  - 순번(순)이 없는 행은 업서트 키가 없어 건너뛴다(로그에 개수 표시).
 *  - 시트에서 삭제된 행은 남는다 → 동기화 직후 cleanupLeaseStaleRows()로 수동 정리 가능.
 *
 * 주의: 웹앱의 "워킨맵·임대리스트 반영"으로 고친 주소는 다음 동기화 때 시트 값으로
 *       돌아간다. 시트 원본을 반드시 함께 수정하는 운영 전제.
 */

const SUPABASE_SYNC_URL = 'https://kkdiihazgzesbqxjytqv.supabase.co';
const LEASE_SYNC_BATCH = 400;
const LEASE_SYNC_LAST_PROP = 'LEASE_SUPABASE_SYNC_LAST';

// vendor_info의 승격 컬럼 — 원본 시트의 같은 이름 헤더에서 채운다 (CONFIG.업체정보.displayCols와 동일)
const VENDOR_INFO_PROMOTED = [
  '업태', '첫계약일', '계약일', '종료일', '남은개월', '계약기간',
  '기본금액', '연평균', '등급', '코드', '일반전화',
  '임대여부', '납품/교체일', '시리얼번호(기번)', '대수', '기종',
  '주소상세주소', '시/구', '추가(컬)', '추가(흑)', '추가조건',
  '누적방식 (월/분/반/년)', '미수금액'
];

function leaseSyncKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_KEY');
  if (!key) throw new Error('스크립트 속성에 SUPABASE_SERVICE_KEY(service_role)를 먼저 넣어주세요.');
  return key;
}

function leaseCell_(value) {
  if (value == null) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, 'Asia/Seoul', 'yyyy-MM-dd');
  }
  return String(value);
}

function leaseMd5_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); })
    .join('');
}

// 원본 임대리스트 시트를 읽어 vendor_info 업서트 레코드 배열을 만든다.
function buildLeaseRecords_() {
  const cfg = CONFIG['업체정보'];
  const src = openSpreadsheet(cfg);
  const sh = src.getSheetByName(cfg.sheets[0]);
  if (!sh) throw new Error('임대리스트 시트를 찾지 못했습니다: ' + cfg.sheets[0]);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow <= cfg.headerRow) throw new Error('임대리스트 시트에 데이터가 없습니다.');
  const values = sh.getRange(cfg.headerRow, 1, lastRow - cfg.headerRow + 1, lastCol).getValues();
  // 헤더의 줄바꿈·연속 공백은 공백 하나로 — 최초 적재(7/20)와 같은 키 규칙 (예: '거래처 코드')
  const headers = values[0].map(function (h) { return String(h == null ? '' : h).replace(/\s+/g, ' ').trim(); });
  const nowIso = Utilities.formatDate(new Date(), 'Asia/Seoul', "yyyy-MM-dd HH:mm:ss");

  const bySeq = {}; // 시트 내 순번 중복 시 마지막 행이 이긴다 (같은 배치에서 두 번 업서트하면 오류)
  let skippedNoVendor = 0;
  let skippedNoSeq = 0;
  for (let i = 1; i < values.length; i++) {
    const raw = {};
    for (let c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      raw[headers[c]] = leaseCell_(values[i][c]);
    }
    const vendor = String(raw[cfg.vendorCol] || raw[cfg.vendorColFallback] || '').trim();
    if (!vendor) { skippedNoVendor++; continue; }
    const seq = String(raw['순'] || '').trim();
    if (!/^\d+$/.test(seq)) { skippedNoSeq++; continue; }

    const rec = {
      '_업체명': vendor,
      '_출처': '시트:임대리스트',
      '_원문': '',
      '_등록시각': nowIso,
      '_dupKey': leaseMd5_('vendor_info|' + seq), // 순번 기반 고정 키 (재실행해도 동일)
      '_raw': raw
    };
    for (let p = 0; p < VENDOR_INFO_PROMOTED.length; p++) {
      const col = VENDOR_INFO_PROMOTED[p];
      rec[col] = raw[col] == null ? '' : raw[col];
    }
    bySeq[seq] = rec;
  }

  const records = Object.keys(bySeq).map(function (k) { return bySeq[k]; });
  return { records: records, nowIso: nowIso, headers: headers, skippedNoVendor: skippedNoVendor, skippedNoSeq: skippedNoSeq };
}

// 실행 전 확인용: 건수·건너뛴 행·샘플 1건을 로그로 보여준다 (Supabase에 아무것도 쓰지 않음)
function previewLeaseSupabaseSync() {
  const built = buildLeaseRecords_();
  const sample = built.records[0] || null;
  Logger.log('업서트 대상: %s건 / 업체명 없음 제외: %s / 순번 없음 제외: %s', built.records.length, built.skippedNoVendor, built.skippedNoSeq);
  Logger.log('시트 헤더(%s개): %s', built.headers.filter(String).length, built.headers.filter(String).join(', '));
  if (sample) Logger.log('샘플 1건: %s', JSON.stringify(sample).slice(0, 1500));
  return { count: built.records.length, skippedNoVendor: built.skippedNoVendor, skippedNoSeq: built.skippedNoSeq };
}

// 본 동기화: 순번(unique) 기준 업서트. 매주 월 5시 트리거 + 수동 실행 겸용.
function syncLeaseToSupabase() {
  const key = leaseSyncKey_();
  const built = buildLeaseRecords_();
  const url = SUPABASE_SYNC_URL + '/rest/v1/vendor_info?on_conflict=' + encodeURIComponent('순번');

  let sent = 0;
  for (let i = 0; i < built.records.length; i += LEASE_SYNC_BATCH) {
    const batch = built.records.slice(i, i + LEASE_SYNC_BATCH);
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      payload: JSON.stringify(batch),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code >= 300) {
      throw new Error('vendor_info 업서트 실패(배치 ' + (i / LEASE_SYNC_BATCH + 1) + ', HTTP ' + code + '): ' + res.getContentText().slice(0, 400));
    }
    sent += batch.length;
  }

  PropertiesService.getScriptProperties().setProperty(LEASE_SYNC_LAST_PROP, built.nowIso);
  const summary = '임대리스트 → Supabase 동기화 완료: ' + sent + '건 업서트' +
    ' (업체명 없음 ' + built.skippedNoVendor + '건, 순번 없음 ' + built.skippedNoSeq + '건 제외)';
  Logger.log(summary);
  return { ok: true, upserted: sent, skippedNoVendor: built.skippedNoVendor, skippedNoSeq: built.skippedNoSeq, at: built.nowIso };
}

// 선택: 시트에서 사라진 행 정리 — 마지막 동기화보다 오래된 _등록시각 행을 삭제한다.
// 반드시 syncLeaseToSupabase() 성공 직후에만 실행할 것 (그 외 시점엔 정상 행까지 지울 수 있음).
function cleanupLeaseStaleRows() {
  const key = leaseSyncKey_();
  const last = PropertiesService.getScriptProperties().getProperty(LEASE_SYNC_LAST_PROP);
  if (!last) throw new Error('동기화 기록이 없습니다. syncLeaseToSupabase()를 먼저 실행하세요.');
  const filter = encodeURIComponent('_등록시각') + '=lt.' + encodeURIComponent(last);
  const base = SUPABASE_SYNC_URL + '/rest/v1/vendor_info?' + filter;

  // 삭제 전 대상 건수 확인
  const head = UrlFetchApp.fetch(base + '&select=id&limit=1', {
    method: 'get',
    headers: { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'count=exact' },
    muteHttpExceptions: true
  });
  const range = String(head.getAllHeaders()['content-range'] || head.getAllHeaders()['Content-Range'] || '');
  const total = Number((range.split('/')[1] || '0').trim()) || 0;
  if (!total) { Logger.log('정리할 행이 없습니다.'); return { ok: true, deleted: 0 }; }

  const res = UrlFetchApp.fetch(base, {
    method: 'delete',
    headers: { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'return=minimal' },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) {
    throw new Error('정리 실패(HTTP ' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 300));
  }
  Logger.log('시트에 없는 행 %s건 삭제 (기준: %s 이전 등록분)', total, last);
  return { ok: true, deleted: total };
}

// 매주 월요일 새벽 5시 자동 동기화 (마스터 2시·임대현황표 4시 이후)
function installLeaseSupabaseTrigger() {
  removeLeaseSupabaseTrigger();
  ScriptApp.newTrigger('syncLeaseToSupabase').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(5).create();
  Logger.log('트리거 생성: 매주 월요일 5시 임대리스트 → Supabase 동기화');
  return { ok: true };
}

function removeLeaseSupabaseTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncLeaseToSupabase') ScriptApp.deleteTrigger(t);
  });
  return { ok: true };
}

/* ============================================================
 * 미수현황 CS체크 → Supabase misu_cs_checks 동기화
 * ------------------------------------------------------------
 * 관리부가 미수 시트 CS체크 열(체크박스)을 켜면 CS팀이 방문/전화할 대상.
 * 웹앱 미수현황 탭의 "CS체크 목록"이 이 테이블을 읽는다.
 *  1) previewMisuCsSync() 로 값 확인
 *  2) syncMisuCsToSupabase() 1회 실행
 *  3) installMisuCsTrigger() 로 1시간마다 자동 동기화
 * ============================================================ */
var MISU_CS_SS_ID = '1gc5bcv6GuJ0PV1iXpu0CLBwiAoLJYdBaPqRQCqn4yHU';

// 팀별 CS체크 열 지정 — 시트 레이아웃이 팀별로 다르면 열 글자만 바꾸면 된다 (2026-07 전 팀 AB열 확인)
var MISU_CS_COL = { A: 'AB', B: 'AB', C: 'AB', D: 'AB', E: 'AB' };

function misuColIndex_(letter) {
  var idx = 0;
  letter = String(letter || '').toUpperCase().replace(/[^A-Z]/g, '');
  for (var i = 0; i < letter.length; i++) idx = idx * 26 + (letter.charCodeAt(i) - 64);
  return idx - 1;
}

function buildMisuCsRecords_() {
  var ss = SpreadsheetApp.openById(MISU_CS_SS_ID);
  var now = new Date().toISOString();
  var byKey = {};
  ss.getSheets().forEach(function (sheet) {
    var teamMatch = sheet.getName().match(/^수도권([A-E])/);
    if (!teamMatch) return;
    var team = teamMatch[1];
    var checkCol = misuColIndex_(MISU_CS_COL[team]);
    var values = sheet.getDataRange().getDisplayValues();
    var headerRowIdx = -1, headers = [];
    for (var h = 0; h < Math.min(10, values.length); h++) {
      var row = values[h].map(function (x) { return String(x == null ? '' : x).replace(/\s+/g, ''); });
      if (row.indexOf('거래처명') >= 0) { headerRowIdx = h; headers = row; break; }
    }
    if (headerRowIdx < 0) { Logger.log('%s: 거래처명 헤더 없음 — 건너뜀', sheet.getName()); return; }
    var vendorCol = headers.indexOf('거래처명');
    var managerCol = headers.indexOf('CS담당'), c1 = headers.indexOf('CS-1회'), c2 = headers.indexOf('CS-2회');
    var checkedCount = 0;
    for (var r = headerRowIdx + 1; r < values.length; r++) {
      var vendor = String(values[r][vendorCol] || '').trim();
      if (!vendor) continue;
      var raw = String(values[r][checkCol] == null ? '' : values[r][checkCol]).trim().toUpperCase();
      var checked = raw === 'TRUE' || raw === '\u2713' || raw === 'V' || raw === 'O';
      // 숨김·필터로 가려진 행은 처리됐거나 보류한 것 — 체크로 치지 않는다
      if (checked && (sheet.isRowHiddenByUser(r + 1) || sheet.isRowHiddenByFilter(r + 1))) checked = false;
      if (checked) checkedCount++;
      var key = sheet.getName() + '|' + vendor;
      if (byKey[key] && byKey[key].checked) checked = true;
      byKey[key] = {
        key: key, team: team, vendor: vendor, checked: checked,
        cs_manager: managerCol >= 0 ? String(values[r][managerCol] || '').trim() : '',
        cs1: c1 >= 0 ? String(values[r][c1] || '').trim() : '',
        cs2: c2 >= 0 ? String(values[r][c2] || '').trim() : '',
        synced_at: now,
      };
    }
    Logger.log('%s: %s열 기준 체크 %s개 (숨긴 행 제외)', sheet.getName(), MISU_CS_COL[team], checkedCount);
  });
  return Object.keys(byKey).map(function (k) { return byKey[k]; });
}

function previewMisuCsSync() {
  var records = buildMisuCsRecords_();
  var checked = records.filter(function (r) { return r.checked; });
  Logger.log('전체 %s행 / CS체크 %s행', records.length, checked.length);
  Logger.log(JSON.stringify(checked.slice(0, 10), null, 2));
}

function syncMisuCsToSupabase() {
  var key = leaseSyncKey_();
  var runStart = new Date().toISOString();   // 반드시 레코드 생성 전에 기록 — 뒤에 찍으면 방금 넣은 행까지 정리 대상이 된다
  var records = buildMisuCsRecords_();
  if (!records.length) throw new Error('미수 시트에서 읽은 행이 없습니다 — 시트명/헤더를 확인하세요.');
  var headers = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' };
  var url = SUPABASE_SYNC_URL + '/rest/v1/misu_cs_checks?on_conflict=key';
  for (var i = 0; i < records.length; i += 400) {
    var res = UrlFetchApp.fetch(url, { method: 'post', headers: headers, payload: JSON.stringify(records.slice(i, i + 400)), muteHttpExceptions: true });
    if (res.getResponseCode() >= 300) throw new Error('업서트 실패(' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 300));
  }
  // 시트에서 사라진 행 정리 (이번 실행에 갱신되지 않은 행)
  var delRes = UrlFetchApp.fetch(SUPABASE_SYNC_URL + '/rest/v1/misu_cs_checks?synced_at=lt.' + encodeURIComponent(runStart), {
    method: 'delete', headers: { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'return=minimal' }, muteHttpExceptions: true,
  });
  Logger.log('동기화 완료: %s행 (체크 %s행), 정리 응답 %s', records.length, records.filter(function (r) { return r.checked; }).length, delRes.getResponseCode());
}

function installMisuCsTrigger() {
  removeMisuCsTrigger();
  ScriptApp.newTrigger('syncMisuCsToSupabase').timeBased().everyHours(1).create();
  Logger.log('트리거 생성: 1시간마다 미수 CS체크 동기화');
}

function removeMisuCsTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncMisuCsToSupabase') ScriptApp.deleteTrigger(t);
  });
}
