/**
 * 통합시트 UI: 메뉴 + 영역별 바로가기 탭 + 진단.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('First 통합DB')
    .addItem('전체 새로고침 (시트→마스터→인덱스)', 'refreshAll')
    .addItem('시트 → 마스터 동기화', 'syncAllToMaster')
    .addItem('인덱스 재생성', 'rebuildIndex')
    .addSeparator()
    .addItem('바로가기 탭 생성/갱신', 'buildShortcutSheet')
    .addItem('접근 권한 점검', 'diagAccess')
    .addToUi();
}

// 영역별 원본 시트 / 통합 탭으로 바로 이동하는 링크 탭 (화이트보드의 "바로가기 버튼")
function buildShortcutSheet() {
  const ss = SpreadsheetApp.openById(MASTER_SS_ID);
  let sheet = ss.getSheetByName('바로가기');
  if (!sheet) sheet = ss.insertSheet('바로가기', 0);
  sheet.clear();

  const meta = getIndexMeta();
  const rows = [['카테고리', '원본 시트', '통합 탭', '건수']];

  for (const cat of CATEGORIES) {
    const cfg = CONFIG[cat];

    let srcUrl = '';
    try { srcUrl = 'https://docs.google.com/spreadsheets/d/' + resolveSsId(cfg) + '/edit'; } catch (e) {}

    const tabName = MASTER_TABS[cat] || cat;
    const tab = ss.getSheetByName(tabName);
    const tabUrl = tab
      ? 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/edit#gid=' + tab.getSheetId()
      : '';

    rows.push([
      cat,
      srcUrl ? '=HYPERLINK("' + srcUrl + '","원본 열기")' : '(원본 미연결)',
      tabUrl ? '=HYPERLINK("' + tabUrl + '","' + tabName + ' 열기")' : '(탭 미생성)',
      meta['count_' + cat] || ''
    ]);
  }

  sheet.getRange(1, 1, rows.length, 4).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
  sheet.autoResizeColumns(1, 4);
  return { ok: true };
}

function clearCache() {
  CacheService.getScriptCache().removeAll([
    'fileid_확장성 정보',
    'fast_search_v6_',
    'fast_detail_v7_'
  ]);
  Logger.log('Cache cleared');
}

function diagAccess() {
  const targets = [];
  targets.push(['인덱스 시트', INDEX_SS_ID]);
  targets.push(['통합(마스터) 시트 ★쓰기대상', MASTER_SS_ID]);

  for (const cat of CATEGORIES) {
    const cfg = CONFIG[cat];
    if (!cfg || cfg.kakaoOnly) continue;
    try {
      targets.push(['원본:' + cat, resolveSsId(cfg)]);
    } catch (e) {
      Logger.log('FAIL 원본:' + cat + ' (ssId 해석 실패): ' + e.message);
    }
  }

  for (const t of targets) {
    const name = t[0], id = t[1];
    try {
      const ss = SpreadsheetApp.openById(id);
      Logger.log('OK ' + name + ': "' + ss.getName() + '" / 시트 ' + ss.getSheets().length + '개');
    } catch (e) {
      Logger.log('FAIL ' + name + ' (' + id + '): ' + e.message);
    }
  }
}
