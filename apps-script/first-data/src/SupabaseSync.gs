/**
 * 임대리스트 원본 시트 → Supabase vendor_info 주간 불러오기 (시트에는 쓰지 않음)
 */

const SUPABASE_SYNC_URL = 'https://kkdiihazgzesbqxjytqv.supabase.co';
const LEASE_SYNC_BATCH = 400;
const LEASE_SYNC_LAST_PROP = 'LEASE_SUPABASE_SYNC_LAST';

// vendor_info의 승격 컬럼 — 원본 시트의 같은 이름 헤더에서 채운다
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
  const headers = values[0].map(function (h) { return String(h == null ? '' : h).replace(/\s+/g, ' ').trim(); });
  const nowIso = Utilities.formatDate(new Date(), 'Asia/Seoul', "yyyy-MM-dd HH:mm:ss");

  const bySeq = {}; // 시트 내 순번 중복 시 마지막 행이 이긴다
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
      '_dupKey': leaseMd5_('vendor_info|' + seq),
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

// 실행 전 확인용: Supabase에 아무것도 쓰지 않고 건수·샘플만 로그로 보여준다
function previewLeaseSupabaseSync() {
  const built = buildLeaseRecords_();
  const sample = built.records[0] || null;
  Logger.log('업서트 대상: %s건 / 업체명 없음 제외: %s / 순번 없음 제외: %s', built.records.length, built.skippedNoVendor, built.skippedNoSeq);
  Logger.log('시트 헤더(%s개): %s', built.headers.filter(String).length, built.headers.filter(String).join(', '));
  if (sample) Logger.log('샘플 1건: %s', JSON.stringify(sample).slice(0, 1500));
  return { count: built.records.length, skippedNoVendor: built.skippedNoVendor, skippedNoSeq: built.skippedNoSeq };
}

// 본 불러오기: 순번(unique) 기준 업서트. 매주 월 5시 트리거 + 수동 실행 겸용.
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
  const summary = '임대리스트 → Supabase 불러오기 완료: ' + sent + '건 업서트' +
    ' (업체명 없음 ' + built.skippedNoVendor + '건, 순번 없음 ' + built.skippedNoSeq + '건 제외)';
  Logger.log(summary);
  return { ok: true, upserted: sent, skippedNoVendor: built.skippedNoVendor, skippedNoSeq: built.skippedNoSeq, at: built.nowIso };
}

// 선택: 시트에서 사라진 행을 Supabase에서 정리 — 불러오기 성공 직후에만 실행
function cleanupLeaseStaleRows() {
  const key = leaseSyncKey_();
  const last = PropertiesService.getScriptProperties().getProperty(LEASE_SYNC_LAST_PROP);
  if (!last) throw new Error('불러오기 기록이 없습니다. syncLeaseToSupabase()를 먼저 실행하세요.');
  const filter = encodeURIComponent('_등록시각') + '=lt.' + encodeURIComponent(last);
  const base = SUPABASE_SYNC_URL + '/rest/v1/vendor_info?' + filter;

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

// 매주 월요일 새벽 5시 자동 불러오기 (마스터 2시·임대현황표 4시 이후)
function installLeaseSupabaseTrigger() {
  removeLeaseSupabaseTrigger();
  ScriptApp.newTrigger('syncLeaseToSupabase').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(5).create();
  Logger.log('트리거 생성: 매주 월요일 5시 임대리스트 → Supabase 불러오기');
  return { ok: true };
}

function removeLeaseSupabaseTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncLeaseToSupabase') ScriptApp.deleteTrigger(t);
  });
  return { ok: true };
}