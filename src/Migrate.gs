/**
 * 1회용 마이그레이션: 기존 AS 탭(외부시트 축소구조)을 점검과 동일한 풀 구조로 이관.
 *
 * 옛 AS 탭 컬럼: AS날짜·작성자·지역·등급·모델명·시리얼넘버·자산기번·내용·처리내용 (+ _업체명/_출처/_원문/_등록시각/_dupKey)
 * 새 AS 탭 컬럼: 점검과 동일 (작성일·작성자·구분·…·_원문 …)
 *
 * 핵심: AS날짜 → 작성일 매핑(이름이 달라 자동 재정렬로는 유실되므로 명시 이관), 구분="AS" 채움.
 * 나머지 풀구조 컬럼(레벨·부서명·키맨·매수·토너 등)과 _원문은 빈칸(과거 외부데이터엔 원래 없음).
 *
 * 실행 순서(중요): clasp push 후 ▶이 함수를 먼저 1회 실행◀ → 그 다음 rebuildIndex().
 * (AS방 업로드를 먼저 하면 헤더 자동재정렬로 AS날짜가 유실될 수 있으니 이관을 가장 먼저 한다.)
 * 이미 이관된 탭(헤더에 '작성일' 있고 'AS날짜' 없음)에서는 아무 것도 하지 않는다(중복 실행 안전).
 */
function migrateASTabToFull_() {
  const ss = SpreadsheetApp.openById(MASTER_SS_ID);
  const sheet = ss.getSheetByName(MASTER_TABS['AS'] || 'AS');
  if (!sheet) return { ok: false, error: 'AS 탭 없음' };

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());

  const hasOld = headers.indexOf('AS날짜') !== -1;
  const hasNew = headers.indexOf('작성일') !== -1;
  if (hasNew && !hasOld) return { ok: true, skipped: '이미 이관됨 (작성일 구조)' };

  const newHeaders = masterHeaders_('AS'); // 새 풀 헤더 (CONFIG.AS.displayCols + 헬퍼)
  if (lastRow < 2) {
    sheet.clear();
    sheet.getRange(1, 1, 1, newHeaders.length).setValues([newHeaders]);
    sheet.setFrozenRows(1);
    return { ok: true, migrated: 0, note: '데이터 없음 — 헤더만 새 구조로' };
  }

  const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const get = (row, name) => { const i = headers.indexOf(name); return i >= 0 ? row[i] : ''; };

  const newRows = data.map(row => {
    const vendor = String(get(row, '_업체명') || get(row, '업체명') || '').trim();
    const obj = {
      '작성일': get(row, 'AS날짜'),   // 핵심 매핑
      '작성자': get(row, '작성자'),
      '구분': 'AS',
      '등급': get(row, '등급'),
      '업체명': vendor,
      '지역': get(row, '지역'),
      '모델명': get(row, '모델명'),
      '시리얼넘버': get(row, '시리얼넘버'),
      '자산기번': get(row, '자산기번'),
      '내용': get(row, '내용'),
      '처리내용': get(row, '처리내용')
      // 레벨/부서명/키맨/매수/토너잔량/폐통/여분/한틴이카유무/주차비지원유무/특이사항 = 빈칸
    };
    const outRow = CONFIG['AS'].displayCols.map(c => (obj[c] == null ? '' : obj[c]));
    outRow.push(
      vendor,
      get(row, '_출처') || '시트:AS(이관)',
      get(row, '_원문') || '',
      get(row, '_등록시각') || new Date(),
      get(row, '_dupKey') || dupKey_('AS', vendor, obj)
    );
    return outRow;
  });

  sheet.clear();
  sheet.getRange(1, 1, 1, newHeaders.length).setValues([newHeaders]);
  sheet.setFrozenRows(1);
  sheet.getRange(2, newHeaders.length, sheet.getMaxRows() - 1, 1).setNumberFormat('@'); // _dupKey 텍스트
  const BATCH = 10000;
  for (let i = 0; i < newRows.length; i += BATCH) {
    const slice = newRows.slice(i, i + BATCH);
    sheet.getRange(2 + i, 1, slice.length, newHeaders.length).setValues(slice);
  }

  return { ok: true, migrated: newRows.length };
}

// 한 번에: AS 이관 + 인덱스 재생성 (수동 실행 편의용)
function migrateASAndReindex() {
  const mig = migrateASTabToFull_();
  const idx = rebuildIndex();
  return { migrate: mig, index: idx };
}
