/**
 * 분기목표 결과표 ↔ 대시보드 양방향 연동 (Google Apps Script)
 * ============================================================
 * "결과표" 탭의  A:구분  B:목표  K:4월  L:5월  M:6월  을
 * 대시보드로 읽어오고, 대시보드에서 4·5·6월을 수정하면 시트에 바로 기록합니다.
 *
 * ▣ 설치 (해당 스프레드시트에서 1회)
 *   1. 연동할 스프레드시트 열기(결과표 탭이 있는 그 파일)
 *      → [확장 프로그램] → [Apps Script]
 *   2. 이 코드 전체 붙여넣기 → 저장
 *   3. 아래 CONFIG(탭이름/시작행/열 번호)가 실제 시트와 맞는지 확인
 *   4. [배포] → [새 배포] → 유형 [웹 앱]
 *        - 실행 계정:  "나"
 *        - 액세스 권한: "모든 사용자"
 *   5. 배포 → 권한 승인 → 생성된 /exec URL 복사 → 채팅으로 알려주세요
 *      (대시보드 분기목표 화면 [🔗 결과표 연동]에 입력)
 *
 * ※ 테스트: 브라우저에서  <exec주소>?action=goals  를 열면 읽어온 JSON이 보입니다.
 */

// ===================== 골든카드 AI 자동작성 설치 (1회) =====================
//  Apps Script → 프로젝트 설정(⚙️) → '스크립트 속성'에 아래 추가:
//    OPENAI_API_KEY = sk-... (본인 OpenAI 키)
//    OPENAI_MODEL   = gpt-5.5  (선택, 기본 gpt-5.5)
//    OPENAI_REASONING_EFFORT = high  (선택, 기본 high=정확도 우선 / minimal=빠름)
//  ※ 키는 시트/대시보드에 노출되지 않고 GAS 내부에만 보관됩니다.
// ==========================================================================

// ===================== CONFIG =====================
var TAB_NAME = '결과표';     // 탭(시트) 이름
var START_ROW = 1;          // 1부터 읽되 머리글/제목 행은 자동으로 건너뜀
var COL = {
  gubun: 1,   // A열 = 구분
  goal:  2,   // B열 = 목표
  j:    10,   // J열 = 구분 복사본 (A와 같게 자동 채움)
  m4:   11,   // K열 = 4월
  m5:   12,   // L열 = 5월
  m6:   13    // M열 = 6월
};
// ==================================================


// ===================== A1 분기 토글 시트 전환 =====================
// 사용 방식:
// 1) 시트 이름을 "1Q 계획표", "2Q 계획표"처럼 1~4Q + 업무명으로 둡니다.
// 2) Apps Script에서 setupQuarterToggles()를 1회 실행하면 해당 시트들의 A1에 1Q~4Q 드롭다운이 생깁니다.
// 3) 이후 A1에서 분기를 선택하면 같은 업무명의 해당 분기 시트로 이동합니다.
var QUARTER_TOGGLE_CELL = 'A1';
var QUARTER_TOGGLE_VALUES = ['1Q', '2Q', '3Q', '4Q'];
var QUARTER_SHEET_TYPES = ['계획표', '결과표', '미션결과표'];

function normalizeQuarterValue_(value) {
  var s = String(value || '').toUpperCase().replace(/\s+/g, '');
  var m = s.match(/([1-4])(?:Q|분기)?/);
  return m ? (m[1] + 'Q') : '';
}

function parseQuarterSheetName_(sheetName) {
  var name = String(sheetName || '').trim();
  var m = name.match(/^([1-4])\s*Q\s*(.+)$/i) || name.match(/^([1-4])\s*분기\s*(.+)$/);
  if (!m) return null;
  var q = m[1] + 'Q';
  var type = String(m[2] || '').trim();
  for (var i = 0; i < QUARTER_SHEET_TYPES.length; i++) {
    if (type === QUARTER_SHEET_TYPES[i] || type.indexOf(QUARTER_SHEET_TYPES[i]) >= 0) {
      return { quarter: q, type: QUARTER_SHEET_TYPES[i] };
    }
  }
  return null;
}

function findQuarterSheet_(ss, quarter, type) {
  var qNum = String(quarter || '').replace(/[^1-4]/g, '');
  var candidates = [
    qNum + 'Q ' + type,
    qNum + 'Q' + type,
    qNum + '분기 ' + type,
    qNum + '분기' + type,
    type + ' ' + qNum + 'Q',
    type + '_' + qNum + '분기'
  ];
  for (var i = 0; i < candidates.length; i++) {
    var exact = ss.getSheetByName(candidates[i]);
    if (exact) return exact;
  }
  var shs = ss.getSheets();
  for (var s = 0; s < shs.length; s++) {
    var info = parseQuarterSheetName_(shs[s].getName());
    if (info && info.quarter === (qNum + 'Q') && info.type === type) return shs[s];
  }
  return null;
}

function setupQuarterToggles() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(QUARTER_TOGGLE_VALUES, true)
    .setAllowInvalid(false)
    .build();
  var count = 0;
  ss.getSheets().forEach(function (sh) {
    var info = parseQuarterSheetName_(sh.getName());
    if (!info) return;
    var cell = sh.getRange(QUARTER_TOGGLE_CELL);
    cell.setDataValidation(rule);
    cell.setValue(info.quarter);
    cell.setNote('분기를 선택하면 같은 종류의 해당 분기 시트로 이동합니다.');
    count++;
  });
  SpreadsheetApp.getUi().alert('A1 분기 토글 설정 완료: ' + count + '개 시트');
}

function onOpen(e) {
  try {
    SpreadsheetApp.getUi()
      .createMenu('분기 이동')
      .addItem('A1 분기 토글 설치/갱신', 'setupQuarterToggles')
      .addToUi();
  } catch (err) {}
}

function onEdit(e) {
  try {
    if (!e || !e.range) return;
    var range = e.range;
    if (range.getA1Notation() !== QUARTER_TOGGLE_CELL) return;
    var sh = range.getSheet();
    var info = parseQuarterSheetName_(sh.getName());
    if (!info) return;
    var targetQuarter = normalizeQuarterValue_(e.value || range.getValue());
    if (!targetQuarter || targetQuarter === info.quarter) return;
    var ss = sh.getParent();
    var target = findQuarterSheet_(ss, targetQuarter, info.type);
    if (!target) {
      range.setValue(info.quarter);
      SpreadsheetApp.getActive().toast(targetQuarter + ' ' + info.type + ' 시트를 찾지 못했습니다.', '분기 이동', 5);
      return;
    }
    target.getRange(QUARTER_TOGGLE_CELL).setValue(targetQuarter);
    ss.setActiveSheet(target);
    SpreadsheetApp.flush();
  } catch (err) {
    SpreadsheetApp.getActive().toast('분기 이동 오류: ' + err.message, '분기 이동', 5);
  }
}
// ================================================================

function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};
  var action = params.action || 'goals';
  var gid = params.gid || '';
  var member = params.member || '';
  var quarter = params.quarter || '';
  var out;
  if (action === 'goals') out = readGoals_(gid, params.goalCol, params.noMonths, member, quarter);
  else if (action === 'tabs') out = listTabs_();
  else if (action === 'card') out = readCard_(gid, quarter, member);
  else out = { ok: true, msg: '결과표 연동 정상 작동 중' };
  return respond_(out, params.callback);
}

// 모든 탭(시트) 이름·gid 목록 — 계획표 등 탭 자동 인식용
function listTabs_() {
  var shs = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  return { ok: true, tabs: shs.map(function (s) { return { name: s.getName(), gid: String(s.getSheetId()) }; }) };
}

// gid(시트ID)로 기준 탭을 찾고, member가 있으면 팀원별 탭을 자동 생성/선택한다.
// 중요: 사용자가 비워 둔 메인 탭(결과표/미션결과표/계획표/골든미팅카드)을 원본 양식으로 복제한다.
var BASE_TAB_ALIASES = [
  { base: '미션결과표', kw: ['미션결과', '미션 결과'] },
  { base: '골든미팅카드', kw: ['골든미팅카드', '골든', '미팅', '카드'] },
  { base: '계획표', kw: ['계획표', '레벨업계획', '계획'] },
  { base: '결과표', kw: ['결과표'] }
];
function getBaseSheet_(gid) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (gid) {
    var shs = ss.getSheets();
    for (var i = 0; i < shs.length; i++) {
      if (String(shs[i].getSheetId()) === String(gid)) return shs[i];
    }
  }
  return ss.getSheetByName(TAB_NAME);
}
function canonicalBaseName_(name) {
  var n = String(name || '')
    .replace(/^_?템플릿[_\s-]*/, '')
    .replace(/_[1-4]분기$/, '')
    .replace(/^.+?_/, '')
    .trim();
  for (var i = 0; i < BASE_TAB_ALIASES.length; i++) {
    var a = BASE_TAB_ALIASES[i];
    for (var k = 0; k < a.kw.length; k++) {
      if (n.indexOf(a.kw[k]) >= 0) return a.base;
    }
  }
  return n || TAB_NAME;
}
function cleanMember_(member) {
  return String(member || '').trim();
}
function normalizeQuarter_(quarter) {
  var q = String(quarter || '').replace(/[^1-4]/g, '');
  return q || '';
}
function safeSheetName_(name) {
  var s = String(name || '').replace(/[\\\/\?\*\[\]\:]/g, '-').replace(/\s+/g, ' ').trim();
  if (!s) s = '이름없음';
  return s.length > 95 ? s.slice(0, 95) : s;
}
function isQuarterSplitBase_(baseName) {
  return baseName !== '골든미팅카드';
}
function memberTabName_(baseName, member, quarter) {
  var q = normalizeQuarter_(quarter);
  var suffix = (q && isQuarterSplitBase_(baseName)) ? '_' + q + '분기' : '';
  return safeSheetName_(cleanMember_(member) + '_' + baseName + suffix);
}
function findMainSheet_(ss, baseName) {
  var exact = ss.getSheetByName(baseName);
  if (exact) return exact;
  var aliases = [];
  for (var i = 0; i < BASE_TAB_ALIASES.length; i++) {
    if (BASE_TAB_ALIASES[i].base === baseName) aliases = BASE_TAB_ALIASES[i].kw;
  }
  var shs = ss.getSheets();
  for (var s = 0; s < shs.length; s++) {
    var name = shs[s].getName();
    if (name.indexOf('_') >= 0 || name.indexOf('템플릿') >= 0 || name.indexOf('원본') >= 0) continue;
    for (var k = 0; k < aliases.length; k++) {
      if (name.indexOf(aliases[k]) >= 0) return shs[s];
    }
  }
  return null;
}
function findMemberSheet_(ss, baseName, member, quarter) {
  var m = cleanMember_(member);
  var q = normalizeQuarter_(quarter);
  var primary = memberTabName_(baseName, m, q);
  var candidates = [primary];
  if (!q || !isQuarterSplitBase_(baseName)) {
    candidates = candidates.concat([
      safeSheetName_(baseName + '_' + m),
      safeSheetName_(m + ' - ' + baseName),
      safeSheetName_(baseName + ' - ' + m),
      safeSheetName_(baseName + '(' + m + ')')
    ]);
  }
  for (var i = 0; i < candidates.length; i++) {
    var sh = ss.getSheetByName(candidates[i]);
    if (sh) return sh;
  }
  return null;
}
function getSheet_(gid, member, quarter) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var base = getBaseSheet_(gid);
  if (!base) return null;
  var baseName = canonicalBaseName_(base.getName());
  var m = cleanMember_(member);
  if (!m) return base;
  var q = isQuarterSplitBase_(baseName) ? (normalizeQuarter_(quarter) || '1') : '';
  var existing = findMemberSheet_(ss, baseName, m, q);
  if (existing) return existing;
  var main = findMainSheet_(ss, baseName) || base;
  if (!main) {
    throw new Error('메인 양식 탭을 찾을 수 없습니다: ' + baseName + ' 탭을 먼저 만들어 주세요.');
  }
  var targetName = memberTabName_(baseName, m, q);
  var copied = main.copyTo(ss);
  copied.setName(targetName);
  ss.setActiveSheet(copied);
  ss.moveActiveSheet(ss.getNumSheets());
  try { ss.setActiveSheet(main); copied.hideSheet(); } catch (hideErr) {}
  return copied;
}

function readGoals_(gid, goalColParam, noMonths, member, quarter) {
  var sh = getSheet_(gid, member, quarter);
  if (!sh) return { ok: false, error: '탭을 찾을 수 없습니다 (gid: ' + (gid || TAB_NAME) + ')' };
  var goalCol = Number(goalColParam) || COL.goal; // 계획표: C(3)=기본업무, I(9)=미션업무
  var skipMonths = String(noMonths || '') === '1';
  var last = sh.getLastRow();
  if (last < START_ROW) return { ok: true, months: [], rows: [] };
  var n = last - START_ROW + 1;
  var lastCol = Math.max(13, sh.getLastColumn());
  var values = sh.getRange(START_ROW, 1, n, lastCol).getValues();
  var rich = sh.getRange(START_ROW, 1, n, lastCol).getRichTextValues();

  // 1) 월 머리글 행 자동 탐지 ('4월','5월'… 또는 '7월','8월'… 분기 바뀌어도 자동 인식)
  var monthCols = [];
  if (!skipMonths) {
    for (var h = 0; h < n; h++) {
      var found = [];
      for (var c = 0; c < lastCol; c++) {
        var hv = String(values[h][c] || '').trim();
        if (/^\d{1,2}\s*월$/.test(hv)) found.push({ col: c + 1, label: hv.replace(/\s/g, '') });
      }
      if (found.length >= 2) { monthCols = found; break; }
    }
    if (!monthCols.length) monthCols = [{ col: 11, label: '4월' }, { col: 12, label: '5월' }, { col: 13, label: '6월' }];
  }

  // 1.5) 월 컬럼이 가로로 병합된 행 탐지(통합 표시용)
  var mergedRows = {};
  if (monthCols.length >= 2) {
    var firstC = monthCols[0].col, cnt = monthCols.length;
    try {
      sh.getRange(START_ROW, firstC, n, cnt).getMergedRanges().forEach(function (rng) {
        if (rng.getNumColumns() >= cnt) {
          for (var rr = rng.getRow(); rr < rng.getRow() + rng.getNumRows(); rr++) mergedRows[rr] = true;
        }
      });
    } catch (e) {}
  }

  // 2) 데이터 행
  var rows = [];
  var lastGubun = '';
  for (var i = 0; i < n; i++) {
    var gubun = String(values[i][COL.gubun - 1] || '').trim();
    var goal = String(values[i][goalCol - 1] || '').trim();
    var gN = gubun.replace(/\s/g, ''), goN = goal.replace(/\s/g, ''); // '구 분','목 표' 등 띄어쓰기 무시
    if (gN === '구분' || goN === '목표' || goN === '구분' || goN === '목 표') continue;
    if (/^\d{4}\s*년?\s*\d?\s*분기$/.test(goN)) continue;
    var isMonthHeader = monthCols.some(function (mc) { return String(values[i][mc.col - 1] || '').trim() === mc.label; });
    if (isMonthHeader) continue;
    if (gubun) lastGubun = gubun;
    if (goal === '') continue;
    var months = monthCols.map(function (mc) {
      return { col: mc.col, label: mc.label, text: String(values[i][mc.col - 1] || '') }; // 월칸은 그냥 텍스트(검정)
    });
    rows.push({
      row: START_ROW + i,
      gubun: gubun || lastGubun,
      goal: goal,
      goalCol: goalCol,
      goalHtml: cellHtml_(rich[i][goalCol - 1]), // 목표: 줄바꿈+색상 유지
      months: months,
      merged: !!mergedRows[START_ROW + i]         // 월 셀 통합(병합) 여부
    });
  }
  return { ok: true, months: monthCols.map(function (m) { return m.label; }), rows: rows };
}

function doPost(e) {
  try {
    var b = JSON.parse(e.postData.contents || '{}');
    if (b.action === 'aiCard') {
      return json_(aiFillCard_(b));
    }
    var sh = getSheet_(b.gid, b.member, b.quarter);
    if (!sh) return json_({ ok: false, error: '탭 없음 (gid: ' + (b.gid || TAB_NAME) + ')' });

    if (b.action === 'update') {
      // 한 셀(특정 행/열) 수정 — 열 번호로 지정(월 컬럼 자동대응)
      var col = Number(b.col) || ({ m4: COL.m4, m5: COL.m5, m6: COL.m6 })[b.field];
      if (!col || !b.row) return json_({ ok: false, error: 'bad params' });
      sh.getRange(Number(b.row), col).setValue(b.value == null ? '' : b.value);
      return json_({ ok: true });
    }

    if (b.action === 'mergeMonths') {
      // 한 행의 월 칸들을 가로로 통합(병합)
      var mc = Number(b.col), mcnt = Number(b.count);
      if (!b.row || !mc || mcnt < 2) return json_({ ok: false, error: 'bad params' });
      var rng = sh.getRange(Number(b.row), mc, 1, mcnt);
      rng.breakApart();    // 이미 일부 병합돼 있으면 먼저 해제
      rng.mergeAcross();   // 좌측 값 유지하며 가로 병합
      return json_({ ok: true });
    }
    if (b.action === 'unmergeMonths') {
      // 통합 해제 → 다시 월별로
      var uc = Number(b.col), ucnt = Number(b.count);
      if (!b.row || !uc || ucnt < 2) return json_({ ok: false, error: 'bad params' });
      sh.getRange(Number(b.row), uc, 1, ucnt).breakApart();
      return json_({ ok: true });
    }
    if (b.action === 'addRow') {
      // 특정 행 바로 아래에 새 목표 행 삽입(서식 복사) + 구분/목표 세팅
      var after = Number(b.afterRow);
      if (!after) return json_({ ok: false, error: 'bad params' });
      sh.insertRowAfter(after);
      sh.getRange(after + 1, COL.gubun).setValue(b.gubun || '');
      sh.getRange(after + 1, Number(b.goalCol) || COL.goal).setValue(b.goal || '새 목표');
      return json_({ ok: true, row: after + 1 });
    }
    if (b.action === 'deleteRow') {
      var dr = Number(b.row);
      if (!dr) return json_({ ok: false, error: 'bad params' });
      sh.deleteRow(dr);
      return json_({ ok: true });
    }
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// ▶▶ 권한 승인용: 에디터에서 이 함수를 한 번 '실행'하세요.
//    - 외부요청(UrlFetchApp) 권한 동의 창이 뜨면 허용 → AI 자동작성 활성화
//    - OPENAI_API_KEY가 설정돼 있으면 실제로 GPT 호출까지 테스트합니다.
function 권한승인_및_AI테스트() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('OPENAI_API_KEY');
  if (!key) {
    Logger.log('⚠ OPENAI_API_KEY 미설정. 프로젝트 설정 → 스크립트 속성에 추가하세요. (권한 승인은 완료됨)');
    UrlFetchApp.fetch('https://api.openai.com/v1/models', { muteHttpExceptions: true }); // 권한 트리거
    return;
  }
  var r = callOpenAI_(key, '한국어로 {"ok":"테스트 성공"} 형식의 JSON만 출력해.');
  Logger.log(JSON.stringify(r));
}

// ===================== 골든미팅카드 AI 자동작성 (ChatGPT) =====================
// b: { resultGid, missionGid, cardGid, quarter, dryRun }
function aiFillCard_(b) {
  var quarter = String(b.quarter || '').replace(/[^1-4]/g, '');
  if (!quarter) return { ok: false, error: '분기를 알 수 없습니다.' };
  var apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
  if (!apiKey) return { ok: false, error: 'OPENAI_API_KEY가 설정되지 않았습니다. (Apps Script → 프로젝트 설정 → 스크립트 속성)' };

  // 1) 입력 자료 수집: 결과표(구분/목표/월별), 미션표(구분/목표/월별)
  var resultData = readGoals_(b.resultGid, null, null, b.member, quarter);
  var missionData = readGoals_(b.missionGid, null, null, b.member, quarter);
  var resultText = goalsToText_(resultData, '기본업무 결과표');
  var missionText = goalsToText_(missionData, '미션 결과표');

  // 2) 골든카드에서 참고용 예시(작성된 다른 분기) 추출
  var exampleText = cardExampleText_(b.cardGid, quarter, b.member);

  // 3) GPT 호출
  var prompt = buildCardPrompt_(quarter, resultText, missionText, exampleText);
  var aiJson = callOpenAI_(apiKey, prompt);
  if (!aiJson.ok) return aiJson;
  var card = aiJson.data;

  if (b.dryRun) return { ok: true, preview: card, quarter: quarter };

  // 4) 골든카드 해당 분기 24칸에 입력
  var written = writeCard_(b.cardGid, quarter, card, b.member);
  return { ok: true, written: written, quarter: quarter, preview: card };
}

// 결과표 데이터를 텍스트로 직렬화 (GPT 입력용)
function goalsToText_(data, title) {
  if (!data || !data.rows || !data.rows.length) return '[' + title + '] (데이터 없음)';
  var months = (data.months || []).join(' / ');
  var lines = ['[' + title + '] (월: ' + months + ')'];
  data.rows.forEach(function (r) {
    lines.push('■ 구분: ' + r.gubun + ' | 목표: ' + r.goal);
    (r.months || []).forEach(function (m) {
      if (m.text && String(m.text).trim()) lines.push('   - ' + m.label + ': ' + m.text);
    });
  });
  return lines.join('\n');
}

// 골든카드에서 quarter 외 다른 분기의 작성된 내용을 예시로 추출
function cardExampleText_(gid, quarter, member) {
  var ex = '';
  for (var q = 1; q <= 4; q++) {
    var qs = String(q);
    if (qs === quarter) continue;
    var c = readCard_(gid, qs, member);
    if (!c.ok || !c.questions) continue;
    var has = c.questions.some(function (qq) { return (qq.cells || []).some(function (cl) { return cl.text && cl.text.trim(); }); });
    if (!has) continue;
    var lines = ['[참고: ' + qs + '분기 작성 예시]'];
    c.questions.forEach(function (qq) {
      lines.push('● ' + qq.label);
      (qq.cells || []).forEach(function (cl) { if (cl.text && cl.text.trim()) lines.push('   [' + cl.cat + '] ' + cl.text); });
    });
    return lines.join('\n');
  }
  return '(참고 예시 없음)';
}

function buildCardPrompt_(quarter, resultText, missionText, exampleText) {
  var cats = '매출증대·안정, 효율성, 비용절감, 자기개발, 소통, AI';
  return [
    '너는 퍼스트전산 분기 골든미팅카드 작성 담당자야.',
    '아래 결과표/미션표를 분석해서, 기존 골든미팅카드와 같은 형식·문체로 ' + quarter + '분기 골든미팅카드를 작성해줘.',
    '',
    '[출력 구조 — 매우 중요]',
    '질문 4개 × 카테고리 6개 = 총 24칸을 JSON으로만 출력해줘. 설명·코드블록 없이 순수 JSON만.',
    '카테고리 키: "매출", "효율", "비용", "자기", "소통", "AI"',
    '질문 키: q1(지난기간 나의 성과는?), q2(타인의 성과에 내가 기여한 것은?), q3(성장을 위한 학습 & 발견한 지식), q4(다음 도전을 위한 지원 요청)',
    '형식: {"q1":{"매출":"...","효율":"...","비용":"...","자기":"...","소통":"...","AI":"..."}, "q2":{...}, "q3":{...}, "q4":{...}}',
    '해당 카테고리에 근거 자료가 없으면 그 칸은 빈 문자열("")로 둬. 억지로 만들지 마.',
    '',
    '[작성 원칙]',
    '1. 결과표의 수치·건수·달성률·완료여부를 반드시 반영. 근거 없는 성과는 만들지 마. 수치 임의변경 금지.',
    '2. 미달성도 숨기지 말고 "10/12회, 83%"처럼 정확히 쓰고 개선방향을 함께. 초과달성은 "52/12건, 433%"처럼.',
    '3. 문체: "~했습니다/완료했습니다/기여했습니다/깨달았습니다/향상시켰습니다". 성실하고 진정성 있게.',
    '4. q1 성과: 항목 번호 사용. q2 기여: "[○○을 하며 기여한 점]" 대괄호 제목 + 겸손한 "~에 기여했습니다".',
    '5. q3 학습: 각 항목 "✅[○○을 통해 배운점]" 형식 + 성찰형 문장. q4: 짧고 부담없이, 성장·회사기여 관점.',
    '6. AI/자동화는 반복업무 감소·병목제거·표준화·전사확산 관점으로. 소통은 분위기·동기부여·학습분위기 관점으로.',
    '',
    '[분기] ' + quarter + 'Q',
    '',
    '[기본업무/목표/결과표 입력]',
    resultText,
    '',
    '[미션/상세 실행 결과표 입력]',
    missionText,
    '',
    '[참고용 기존 골든미팅카드 결과 예시]',
    exampleText,
    '',
    '다시 강조: 순수 JSON 객체 하나만 출력해. 다른 텍스트 절대 금지.'
  ].join('\n');
}

function callOpenAI_(apiKey, prompt) {
  var props = PropertiesService.getScriptProperties();
  var model = props.getProperty('OPENAI_MODEL') || 'gpt-5.5';
  var effort = props.getProperty('OPENAI_REASONING_EFFORT') || 'high'; // minimal|low|medium|high (정확도 우선=high)
  var payload = {
    model: model,
    messages: [
      { role: 'system', content: '너는 한국어 인사평가 문서 작성 전문가다. 항상 유효한 JSON만 출력한다.' },
      { role: 'user', content: prompt }
    ],
    response_format: { type: 'json_object' }
  };
  // GPT-5/o계열(추론 모델): reasoning_effort로 속도 확보 + max_completion_tokens 사용
  var isReasoning = /^(gpt-5|o\d|o-)/i.test(model);
  if (isReasoning) {
    payload.max_completion_tokens = 16000; // high 추론 시 잘림 방지
    payload.reasoning_effort = effort;
  } else {
    payload.max_tokens = 4000;
    payload.temperature = 0.7;
  }
  var res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code !== 200) return { ok: false, error: 'OpenAI 오류(' + code + '): ' + body.slice(0, 300) };
  var j;
  try { j = JSON.parse(body); } catch (e) { return { ok: false, error: '응답 파싱 실패' }; }
  var choice = j.choices && j.choices[0];
  var content = choice && choice.message && choice.message.content;
  if (!content) {
    var fin = choice && choice.finish_reason;
    if (fin === 'length') return { ok: false, error: '응답이 토큰 한도에서 잘렸습니다. OPENAI_REASONING_EFFORT를 minimal로 낮추거나 모델을 바꿔보세요.' };
    return { ok: false, error: '빈 응답 (finish_reason: ' + fin + ')' };
  }
  var data;
  try { data = JSON.parse(content); } catch (e) { return { ok: false, error: 'AI가 JSON 형식을 지키지 않음: ' + String(content).slice(0, 200) }; }
  return { ok: true, data: data };
}

// 카테고리 키 → readCard_의 catCols 키 매핑
var AI_CAT_KEYS = ['매출', '효율', '비용', '자기', '소통', 'AI'];
function writeCard_(gid, quarter, card, member) {
  var c = readCard_(gid, quarter, member);
  if (!c.ok) throw new Error(c.error || '카드 읽기 실패');
  var sh = getSheet_(gid, member);
  var qKeyMap = { q1: '성과', q2: '기여', q3: '학습', q4: '지원' }; // 라벨 매칭 보조
  var written = 0;
  c.questions.forEach(function (q) {
    var qData = card[q.key];
    if (!qData) return;
    (q.cells || []).forEach(function (cell, idx) {
      var catKey = AI_CAT_KEYS[idx]; // cells는 CARD_CATS 순서(매출,효율,비용,자기,소통,AI)
      var val = qData[catKey];
      if (val == null || String(val).trim() === '') return;
      if (cell.col) { sh.getRange(q.row, cell.col).setValue(String(val)); written++; }
    });
  });
  return written;
}

// 셀의 서식(글자색)을 HTML로 변환 (줄바꿈은 <br>)
function cellHtml_(rt) {
  if (!rt) return '';
  var runs;
  try { runs = rt.getRuns(); } catch (e) { return esc_(String(rt.getText ? rt.getText() : '')).replace(/\n/g, '<br>'); }
  var html = '';
  runs.forEach(function (run) {
    var t = run.getText();
    if (t === '') return;
    var color = null;
    try { color = run.getTextStyle().getForegroundColor(); } catch (e) {}
    var safe = esc_(t).replace(/\n/g, '<br>');
    if (color && color.toLowerCase() !== '#000000') html += '<span style="color:' + color + '">' + safe + '</span>';
    else html += safe;
  });
  return html;
}
function esc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function respond_(o, callback) {
  if (callback) {
    var safe = String(callback).replace(/[^A-Za-z0-9_$\.]/g, '');
    if (safe) {
      return ContentService.createTextOutput(safe + '(' + JSON.stringify(o) + ');')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
  }
  return json_(o);
}

// ===================== 골든미팅카드 (분기 × 질문4 × 카테고리6) =====================
// 주의: 위에서부터 검사하므로, 더 구체적인 q2(기여)를 q1(성과)보다 먼저 둠
// ("타인의 성과에 내가 기여한" 에도 '성과'가 있어 q1으로 잘못 잡히던 문제 방지)
var CARD_QUESTIONS = [
  { key: 'q2', label: '타인의 성과에 내가 기여한 것은?', kw: ['기여'] },
  { key: 'q3', label: '성장을 위한 학습 & 발견한 지식', kw: ['학습', '발견'] },
  { key: 'q4', label: '다음 도전을 위한 지원 요청', kw: ['지원', '도전'] },
  { key: 'q1', label: '지난기간 나의 성과는?', kw: ['지난기간', '나의성과', '나의 성과', '성과'] }
];
// 화면 표시 순서(q1→q4)
var CARD_Q_ORDER = ['q1', 'q2', 'q3', 'q4'];
var CARD_CATS = [
  { key: '매출', label: '매출증대·안정', kw: ['매출'] },
  { key: '효율', label: '효율성', kw: ['효율'] },
  { key: '비용', label: '비용절감', kw: ['비용'] },
  { key: '자기', label: '자기개발', kw: ['자기개발'] },
  { key: '소통', label: '소통', kw: ['소통'] },
  { key: 'AI',  label: 'AI', kw: ['AI'] }
];
function qOf_(text) {
  var t = String(text || '');
  for (var i = 0; i < CARD_QUESTIONS.length; i++) {
    var kw = CARD_QUESTIONS[i].kw;
    for (var k = 0; k < kw.length; k++) if (t.indexOf(kw[k]) >= 0) return CARD_QUESTIONS[i];
  }
  return null;
}
function quarterOf_(text) {
  var t = String(text || '').replace(/\s/g, '');
  var m = t.match(/([1-4])\s*[Qq]/) || t.match(/([1-4])\s*분기/);
  return m ? m[1] : '';
}

function readCard_(gid, quarter, member) {
  var sh = getSheet_(gid, member);
  if (!sh) return { ok: false, error: '탭을 찾을 수 없습니다 (gid: ' + gid + ')' };
  quarter = String(quarter || '').replace(/[^1-4]/g, '') || '2';
  var lastRow = sh.getLastRow(), lastCol = Math.max(10, sh.getLastColumn());
  if (lastRow < 1) return { ok: true, quarter: quarter, questions: [] };
  var vals = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var rich = sh.getRange(1, 1, lastRow, lastCol).getRichTextValues();

  // 1) 카테고리 헤더행/열 자동 탐지 (6개 중 3개 이상이 서로 다른 열에 있는 행)
  var catCols = null;
  for (var r = 0; r < Math.min(lastRow, 40); r++) {
    var found = {}, cnt = 0;
    for (var c = 0; c < lastCol; c++) {
      var cell = String(vals[r][c] || '');
      for (var ci = 0; ci < CARD_CATS.length; ci++) {
        if (found[CARD_CATS[ci].key]) continue;
        var ok = true; var kw = CARD_CATS[ci].kw;
        for (var kk = 0; kk < kw.length; kk++) if (cell.indexOf(kw[kk]) < 0) ok = false;
        // 카테고리 헤더 셀은 짧음(데이터와 구분) — 60자 이하만 헤더로 인정
        if (ok && cell.replace(/\s/g, '').length <= 60) { found[CARD_CATS[ci].key] = c + 1; cnt++; }
      }
    }
    if (cnt >= 3) { catCols = found; break; }
  }
  if (!catCols) { // 못 찾으면 기본값 C~H (3~8)
    catCols = { '매출': 3, '효율': 4, '비용': 5, '자기': 6, '소통': 7, 'AI': 8 };
  }

  // 2) 질문 행 찾기 + 분기 추적(병합셀: A열 비면 위 분기 유지)
  var curQ = '';
  var questions = [];
  var seen = {};
  for (var r2 = 0; r2 < lastRow; r2++) {
    var aCell = '';
    for (var ac = 0; ac < 2; ac++) { var qv = quarterOf_(vals[r2][ac]); if (qv) { aCell = qv; break; } }
    if (aCell) curQ = aCell;
    if (curQ !== quarter) continue;
    var qInfo = qOf_(vals[r2][1]) || qOf_(vals[r2][0]);
    if (!qInfo || seen[qInfo.key]) continue;
    seen[qInfo.key] = true;
    var cells = CARD_CATS.map(function (cat) {
      var col = catCols[cat.key] || 0;
      return {
        cat: cat.label, col: col,
        text: col ? String(vals[r2][col - 1] || '') : '',
        html: col ? cellHtml_(rich[r2][col - 1]) : ''
      };
    });
    questions.push({ key: qInfo.key, label: qInfo.label, row: r2 + 1, cells: cells });
  }
  questions.sort(function (a, b) { return CARD_Q_ORDER.indexOf(a.key) - CARD_Q_ORDER.indexOf(b.key); });
  return { ok: true, quarter: quarter, questions: questions };
}
