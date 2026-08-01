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
    .addItem('매일 자동 새로고침 켜기', 'installDailyTrigger')
    .addItem('매일 자동 새로고침 끄기', 'removeDailyTriggers')
    .addSeparator()
    .addItem('드라이브 자동적재 켜기 (수신함 폴더+트리거)', 'setupDriveIngest')
    .addItem('드라이브 수신함 지금 적재', 'ingestFromDriveFolder')
    .addItem('드라이브 자동적재 끄기', 'disableDriveIngest')
    .addSeparator()
    .addItem('임대리스트 → Supabase 동기화 미리보기', 'previewLeaseSupabaseSync')
    .addItem('임대리스트 → Supabase 지금 동기화', 'syncLeaseToSupabase')
    .addItem('임대리스트 Supabase 주간 트리거 켜기 (월 5시)', 'installLeaseSupabaseTrigger')
    .addItem('임대리스트 Supabase 주간 트리거 끄기', 'removeLeaseSupabaseTrigger')
    .addSeparator()
    .addItem('바로가기 탭 생성/갱신', 'buildShortcutSheet')
    .addItem('접근 권한 점검', 'diagAccess')
    .addToUi();
}

// 자동 새로고침 트리거 (작업을 쪼개 30분 한도 회피):
//  - 매일 0시: syncNonLeaseOnly  (임대 제외 전체 동기화, 가벼움)
//  - 매일 6시: refreshIndexOnly  (검색 인덱스만 단독 재생성)
//  - 월 2시:  syncBizInfoOnly    (업체정보 21k 단독)
//  - 월 4시:  syncLeaseStatusOnly(임대현황표 27k 단독)
//  시간대(0/2/4/6시)는 1시간 창이 겹치지 않게 띄워 동시 실행을 막는다.
function installDailyTrigger() {
  removeDailyTriggers();
  ScriptApp.newTrigger('syncNonLeaseOnly').timeBased().everyDays(1).atHour(0).create();
  ScriptApp.newTrigger('refreshIndexOnly').timeBased().everyDays(1).atHour(6).create();
  ScriptApp.newTrigger('syncBizInfoOnly').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(2).create();
  ScriptApp.newTrigger('syncLeaseStatusOnly').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(4).create();
  Logger.log('트리거 생성: 매일 0시 비임대동기화 / 6시 인덱스 / 월 2시 업체정보 / 월 4시 임대현황표');
  return { ok: true };
}

function removeDailyTriggers() {
  const handlers = ['refreshAll', 'refreshDaily', 'refreshLease',
    'syncNonLeaseOnly', 'refreshIndexOnly', 'syncBizInfoOnly', 'syncLeaseStatusOnly'];
  const triggers = ScriptApp.getProjectTriggers();
  let n = 0;
  for (const t of triggers) {
    if (handlers.indexOf(t.getHandlerFunction()) !== -1) { ScriptApp.deleteTrigger(t); n++; }
  }
  Logger.log('자동 새로고침 트리거 ' + n + '개 제거됨');
  return { ok: true, removed: n };
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

// 임대현황표 원본 헤더 진단: 시트 목록 + gid 시트 상위 3행 덤프
function diagLeaseSheet() {
  const cfg = CONFIG['임대현황표'];
  const ss = SpreadsheetApp.openById(cfg.ssId);
  ss.getSheets().forEach(function (s) {
    Logger.log('시트: "' + s.getName() + '" gid=' + s.getSheetId() + ' rows=' + s.getLastRow() + ' cols=' + s.getLastColumn());
  });
  const matches = ss.getSheets().filter(function (s) { return s.getSheetId() === cfg.gid; });
  const target = matches[0] || ss.getSheets()[0];
  Logger.log('--- gid=' + cfg.gid + ' 대상 시트 "' + target.getName() + '" 상위 3행 ---');
  const n = Math.min(3, target.getLastRow());
  const cols = Math.min(target.getLastColumn(), 60);
  if (n < 1) { Logger.log('(빈 시트)'); return; }
  const vals = target.getRange(1, 1, n, cols).getValues();
  for (let r = 0; r < vals.length; r++) {
    Logger.log('행' + (r + 1) + ': ' + JSON.stringify(vals[r]));
  }
}

// 카테고리별 행수 내역: 원본행 / 업체명 없어 제외 / 완전중복 병합 / 최종 고유건
function diagSyncCounts() {
  for (const cat of CATEGORIES) {
    const cfg = CONFIG[cat];
    if (!cfg || cfg.kakaoOnly) continue;

    let src;
    try { src = openSpreadsheet(cfg); } catch (e) { Logger.log(cat + ': 원본 열기 실패 ' + e); continue; }

    const sheets = [];
    if (cfg.sheets && cfg.sheets.length) {
      cfg.sheets.forEach(function (n) { sheets.push(src.getSheetByName(n)); });
    } else if (cfg.gid != null) {
      src.getSheets().forEach(function (s) { if (s.getSheetId() === cfg.gid) sheets.push(s); });
    }

    let total = 0, blank = 0, kept = 0;
    const keys = {};

    for (const sh of sheets) {
      if (!sh) continue;
      const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
      if (lastRow <= cfg.headerRow) continue;

      const rawH = sh.getRange(cfg.headerRow, 1, 1, lastCol).getValues()[0];
      const hmap = {};
      for (let c = 0; c < rawH.length; c++) {
        const k = normalizeHeader_(rawH[c]);
        if (k && hmap[k] === undefined) hmap[k] = c;
      }
      const ci = function (name) { const i = hmap[normalizeHeader_(name)]; return i === undefined ? -1 : i; };

      const vI = ci(cfg.vendorCol);
      const fI = cfg.vendorColFallback ? ci(cfg.vendorColFallback) : -1;
      const data = sh.getRange(cfg.headerRow + 1, 1, lastRow - cfg.headerRow, lastCol).getValues();

      for (const row of data) {
        total++;
        let v = vI !== -1 ? String(row[vI] || '').trim() : '';
        if (!v && fI !== -1) v = String(row[fI] || '').trim();
        if (!v) { blank++; continue; }
        kept++;
        const obj = {};
        for (const colName of cfg.displayCols) {
          const idx = ci(colName);
          let val = idx === -1 ? '' : row[idx];
          if (val instanceof Date) val = Utilities.formatDate(val, 'Asia/Seoul', 'yyyy-MM-dd');
          obj[colName] = val;
        }
        keys[dupKey_(cat, v, obj)] = true;
      }
    }

    const unique = Object.keys(keys).length;
    Logger.log(cat + ': 원본행=' + total + ' / 업체명없어제외=' + blank + ' / 완전중복병합=' + (kept - unique) + ' / 최종=' + unique);
  }
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
