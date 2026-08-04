/**
 * Supabase 적재 (점검/AS 배치 → Supabase 단일화).
 *   - appendKakaoRecords_('점검'|'AS', ...) 에서 시트 적재와 함께 호출되어
 *     같은 레코드를 Supabase jeomgeom/as_records 에 insert 한다.
 *   - dupKey 는 시트와 동일(웹앱과도 동일: 작성일 yyyy-MM-dd) → on_conflict 로 중복 자동무시.
 *   - 실패해도 절대 throw 하지 않음(배치 신뢰성 보호) — 로그만 남김.
 *
 *  ※ anon key 는 공개키(프론트와 동일). 전체 유니크 인덱스(_dupKey) 필요:
 *      create unique index jeomgeom_dupkey_uniq  on public.jeomgeom  ("_dupKey");
 *      create unique index as_records_dupkey_uniq on public.as_records ("_dupKey");
 */

var SUPABASE_URL  = 'https://kkdiihazgzesbqxjytqv.supabase.co';
var SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrZGlpaGF6Z3plc2JxeGp5dHF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNjE0NjcsImV4cCI6MjEwMDczNzQ2N30.fjKIbDpj0QhNgc7Qr2z79xBkrYD9LqCxc88hHzpJ0kw';

// 카테고리 → Supabase 테이블 (카톡 증분 적재: on_conflict 중복무시)
var SUPABASE_TABLE = {
  '점검': 'jeomgeom', 'AS': 'as_records', '재계약': 'recontract',
  '초과업체조정': 'overage_adjust',
  '해지방어': 'churn_defense', '경영지원': 'mgmt_support',
  '불만': 'bulman'   // 신양식 /불만접수 전환: 카톡 증분 적재(미러 제거). 시트 불만은 현재 미사용.
};

// 카테고리 → Supabase 테이블 (시트소스 전체교체 미러: delete-all + insert)
// 혼합(시트+카톡) 카테고리도 여기 둠 → syncCategoryToMaster 가 마스터 탭 전체(시트행+카톡행)를 미러.
var SUPABASE_SHEET_TABLE = {
  'PC확장성': 'pc_expansion',
  '초과': 'overage',
  '복합기확장성': 'mfp_expansion',
  // 업체정보(vendor_info)는 여기서 빼둔다 — syncLeaseToSupabase가 증분 upsert로 따로 관리하고,
  // 여기서 replace-all(전체삭제+2.2만행 재삽입)까지 하면 30분 타임아웃 + 죽으면 테이블 반쪽 위험.
  '임대현황표': 'lease_status',
  '미수': 'misu'
  // '불만'은 카톡 증분(SUPABASE_TABLE)으로 이동 — 미러 delete-all 로 301행 날아가는 것 방지.
};

// 시트 outRow 와 동일 데이터 → Supabase 행(JSON). 컬럼명은 displayCols + 헬퍼.
// rawObj(선택): 원본 한 줄 전체(모든 열) → _raw(jsonb) 에 저장. (시트소스 미러 테이블만 _raw 컬럼 보유)
function buildSupaRow_(cat, obj, vendor, srcLabel, raw, key, rawObj) {
  var row = {};
  var cols = CONFIG[cat].displayCols;
  for (var i = 0; i < cols.length; i++) {
    var c = cols[i];
    row[c] = (obj[c] == null ? '' : String(obj[c]));
  }
  row['_업체명'] = vendor;
  row['_출처'] = srcLabel;
  row['_원문'] = raw || '';
  row['_등록시각'] = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
  row['_dupKey'] = key;
  if (rawObj) row['_raw'] = rawObj;   // 전체 원문 행(jsonb)
  return row;
}

// [실행용] 에디터에서 카테고리별 동기화 1회 (원본시트 → 통합시트 + Supabase 미러).
function _syncPC()          { return syncCategoryToMaster('PC확장성'); }
function _syncOverage()     { return syncCategoryToMaster('초과'); }
function _syncMFP()         { return syncCategoryToMaster('복합기확장성'); }
function _syncVendorInfo()  { return syncCategoryToMaster('업체정보'); }
function _syncLeaseStatus() { return syncCategoryToMaster('임대현황표'); }
function _syncBulman()      { return syncCategoryToMaster('불만'); }
function _syncMisu()        { return syncCategoryToMaster('미수'); }

// [1회 이관] 카톡전용 카테고리 마스터 탭 전체 → Supabase (on_conflict 중복무시).
// 이후 신규분은 appendKakaoRecords_ 가 자동 적재함.
function _migrateKakaoCat_(cat) {
  var table = SUPABASE_TABLE[cat];
  if (!table) return cat + ': SUPABASE_TABLE 미등록';
  var ss = SpreadsheetApp.openById(MASTER_SS_ID);
  var sh = ss.getSheetByName(MASTER_TABS[cat] || cat);
  if (!sh) return cat + ' 탭 없음';
  var last = sh.getLastRow();
  if (last < 2) return cat + ' 데이터 없음';
  var lastCol = masterHeaders_(cat).length;
  var data = sh.getRange(2, 1, last - 1, lastCol).getValues();
  var rows = [];
  for (var i = 0; i < data.length; i++) rows.push(buildSupaRowFromArray_(cat, data[i]));
  var CHUNK = 500;
  for (var j = 0; j < rows.length; j += CHUNK) supabaseInsertIgnore_(table, rows.slice(j, j + CHUNK));
  Logger.log(cat + ' 이관 시도: ' + rows.length + '행');
  return cat + ' 이관 시도: ' + rows.length + '행';
}
function _migrateRecontract()   { return _migrateKakaoCat_('재계약'); }
function _migrateChurnDefense() { return _migrateKakaoCat_('해지방어'); }
function _migrateMgmtSupport()  { return _migrateKakaoCat_('경영지원'); }
function _migrateOverageAdjust(){ return _migrateKakaoCat_('초과업체조정'); }

// 마스터 탭 행(배열: displayCols + 헬퍼) → Supabase 행(JSON). 혼합 카테고리의 카톡 보존행 변환용.
// (시트행은 buildSupaRow_ 로 _raw 포함해서 따로 만듦. 카톡행은 원본시트가 없어 _raw 없음.)
function buildSupaRowFromArray_(cat, arr) {
  var cols = masterHeaders_(cat);   // displayCols + ['_업체명','_출처','_원문','_등록시각','_dupKey']
  var row = {};
  for (var i = 0; i < cols.length; i++) {
    var v = arr[i];
    if (v instanceof Date) v = Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
    row[cols[i]] = (v == null ? '' : String(v));
  }
  row['_raw'] = null;   // 카톡행은 원본시트 없음 → null (단, 키는 있어야 bulk insert 키 일치)
  return row;
}

// 시트소스 전체교체 미러: 테이블 전체 삭제 후 현재 행 전부 insert(청크). 절대 throw 안 함.
// 원본시트가 진실 → 수정·삭제까지 반영. (삭제 후 insert 중 실패 시 다음 동기화에서 자가복구)
function supabaseReplaceAll_(table, rows) {
  var H = {
    apikey: SUPABASE_ANON,
    Authorization: 'Bearer ' + SUPABASE_ANON,
    Prefer: 'return=minimal'
  };
  // 1) 전체 삭제 (id>=0 = 전 행)
  try {
    var dres = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/' + table + '?id=gte.0', {
      method: 'delete', headers: H, muteHttpExceptions: true
    });
    if (dres.getResponseCode() >= 300) {
      Logger.log('[Supabase] ' + table + ' delete ' + dres.getResponseCode() + ': ' + dres.getContentText().slice(0, 150));
      return; // 삭제 실패하면 insert 안 함(중복방지)
    }
  } catch (e) { Logger.log('[Supabase] ' + table + ' delete 예외: ' + e); return; }

  // 2) 청크 insert
  var CHUNK = 500;
  for (var i = 0; i < rows.length; i += CHUNK) {
    var slice = rows.slice(i, i + CHUNK);
    try {
      var res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/' + table, {
        method: 'post', contentType: 'application/json',
        headers: H, payload: JSON.stringify(slice), muteHttpExceptions: true
      });
      if (res.getResponseCode() >= 300) Logger.log('[Supabase] ' + table + ' insert ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 150));
    } catch (e) { Logger.log('[Supabase] ' + table + ' insert 예외: ' + e); }
  }
}

// 배열 bulk insert + 중복(_dupKey) 무시. 절대 throw 안 함.
function supabaseInsertIgnore_(table, rows) {
  if (!rows || !rows.length) return;
  var url = SUPABASE_URL + '/rest/v1/' + table + '?on_conflict=_dupKey';
  try {
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: 'Bearer ' + SUPABASE_ANON,
        Prefer: 'resolution=ignore-duplicates,return=minimal'
      },
      payload: JSON.stringify(rows),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code >= 300) Logger.log('[Supabase] ' + table + ' insert ' + code + ': ' + res.getContentText().slice(0, 200));
  } catch (e) {
    Logger.log('[Supabase] ' + table + ' 예외: ' + e);
  }
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
var MISU_CS_SHEETS = ['수도권A_김슬기', '수도권B_박수민', '수도권C_이윤아', '수도권D_박지은', '수도권E_박지은'];
var MISU_CS_HEADER_ROW = 3;

// 팀별 CS체크 열 지정 — E 시트만 레이아웃이 다르면 E의 'AB'를 실제 열 글자로 바꾸면 됨
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
      var checked = raw === 'TRUE' || raw === '✓' || raw === 'V' || raw === 'O';
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
  var runStart = new Date().toISOString();   // 반드시 레코드 생성 전에 기록 (정리 기준)
  var records = buildMisuCsRecords_();
  if (!records.length) throw new Error('미수 시트에서 읽은 행이 없습니다 — 시트명/헤더를 확인하세요.');
  var headers = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' };
  var url = SUPABASE_SYNC_URL + '/rest/v1/misu_cs_checks?on_conflict=key';
  for (var i = 0; i < records.length; i += 400) {
    var res = UrlFetchApp.fetch(url, { method: 'post', headers: headers, payload: JSON.stringify(records.slice(i, i + 400)), muteHttpExceptions: true });
    if (res.getResponseCode() >= 300) throw new Error('업서트 실패(' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 300));
  }
  // 시트에서 사라진 행 정리 (이번 실행에 갱신되지 않은 행만)
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

function checkSupabaseKeyRole() {
  var key = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_KEY') || '';
  if (!key) { Logger.log('키가 비어있음'); return; }
  if (key.indexOf('sb_secret_') === 0) { Logger.log('새 형식 secret 키 — 정상'); return; }
  var parts = key.split('.');
  if (parts.length < 2) { Logger.log('JWT 형식 아님 — 키를 다시 확인'); return; }
  var payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[1])).getDataAsString());
  Logger.log('현재 키 role = ' + payload.role + '  (service_role 이어야 함)');
}

function debugMisuCheckedRows() {
  var ss = SpreadsheetApp.openById(MISU_CS_SS_ID);
  ss.getSheets().forEach(function (sheet) {
    var m = sheet.getName().match(/^수도권([A-E])/);
    if (!m) return;
    var checkCol = misuColIndex_(MISU_CS_COL[m[1]]);
    var values = sheet.getDataRange().getDisplayValues();
    var headerRowIdx = -1, headers = [];
    for (var h = 0; h < Math.min(10, values.length); h++) {
      var row = values[h].map(function (x) { return String(x == null ? '' : x).replace(/\s+/g, ''); });
      if (row.indexOf('거래처명') >= 0) { headerRowIdx = h; headers = row; break; }
    }
    if (headerRowIdx < 0) return;
    var vendorCol = headers.indexOf('거래처명');
    for (var r = headerRowIdx + 1; r < values.length; r++) {
      var raw = String(values[r][checkCol] == null ? '' : values[r][checkCol]).trim().toUpperCase();
      if (raw === 'TRUE' || raw === '✓' || raw === 'V' || raw === 'O') {
        Logger.log('%s %s행: %s', sheet.getName(), r + 1, String(values[r][vendorCol] || '(업체명 없음)'));
      }
    }
  });
}