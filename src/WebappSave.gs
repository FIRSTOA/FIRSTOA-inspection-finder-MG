/**
 * 웹앱(inspection-finder) [📤 보내기] 수신 → 통합시트 "점검" 탭 직접 적재 + 카톡 게시 큐.
 *
 *  흐름:
 *    웹앱 POST { action:'save', text, vendor, mode, author, ts }
 *      → webappSaveInspection_()
 *          ① 합성 메시지 1건 구성 → extractInspectForms_() → appendKakaoRecords_('점검', …)
 *             (카톡 업로드와 동일 파서·동일 _dupKey 중복방어. 26칸 그대로 채워짐)
 *          ② 새로 저장된 경우에만 _kakao_outbox 에 적재
 *      → 메신저봇이 doGet?action=pull 로 가져가 점검방에 양식 게시
 *
 *  ※ doPost/doGet 라우팅은 WebApp.gs 에 한 줄씩 추가되어 있어야 한다(아래 참고).
 *      doPost: else if (action === 'save') result = webappSaveInspection_(data);
 *      doGet : if (action0 === 'pull') return webappPullKakao_(e);
 */

// 메신저봇 polling 인증값 — 봇 스크립트(messengerbot-poller.js)의 BOT_TOKEN 과 동일하게.
var WEBAPP_BOT_TOKEN = 'firstoa2026';
var WEBAPP_OUTBOX_TAB = '_kakao_outbox';

// 웹앱 보내기 1건을 "점검" 탭에 적재.
function webappSaveInspection_(data) {
  try {
    var text = String((data && data.text) || '');
    if (!text.trim()) return { ok: false, error: '내용이 비어있습니다.' };

    // 현재는 점검 양식만 시트 저장 지원 (구분:점검). 그 외 모드는 안내만.
    if (!isInspectForm_(text)) {
      return { ok: false, error: '점검 양식(구분:점검)만 시트 저장됩니다. 현재 양식: ' + (data.mode || '?') };
    }

    // 작성일: 클라이언트 ts(ISO) → yyyy-MM-dd. 양식 본문에 작성일이 있으면 파서가 우선 사용.
    var dateStr = '';
    if (data.ts) {
      var d = new Date(data.ts);
      if (!isNaN(d.getTime())) dateStr = Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd');
    }

    var msg = { date: dateStr, author: String(data.author || ''), text: text };
    var region = String(data.region || data.team || '');
    var records = extractInspectForms_([msg], region);
    if (!records.length) {
      return { ok: false, error: '점검 양식에서 업체명을 찾지 못했습니다.' };
    }

    // 카톡 업로드와 동일 경로로 적재 (_dupKey 중복방어 포함). 출처는 '카톡:웹앱'으로 남는다.
    var r = appendKakaoRecords_('점검', '웹앱', '', records);

    // 새로 저장된 건만 카톡방에 게시 (중복 재전송 방지)
    var posted = 0;
    if (r.added > 0) { webappEnqueueKakao_(text); posted = 1; }

    return {
      ok: true,
      message: r.added > 0 ? '시트 저장 완료 — 카톡 게시 대기중' : '이미 저장된 내용입니다(중복).',
      added: r.added, skipped: r.skipped, posted: posted, tab: r.tab
    };
  } catch (err) {
    return { ok: false, error: err.toString() };
  }
}

// 카톡 게시 큐 적재
function webappEnqueueKakao_(text) {
  var ss = SpreadsheetApp.openById(MASTER_SS_ID);
  var sh = ss.getSheetByName(WEBAPP_OUTBOX_TAB);
  if (!sh) {
    sh = ss.insertSheet(WEBAPP_OUTBOX_TAB); sh.hideSheet();
    sh.getRange(1, 1, 1, 3).setValues([['시각', '메시지', '전송여부']]);
  }
  sh.appendRow([new Date(), String(text), 'N']);
}

// 메신저봇 polling: GET ?action=pull&token=... → 미전송 메시지 반환(+전송됨 표시)
function webappPullKakao_(e) {
  if (!e || !e.parameter || e.parameter.token !== WEBAPP_BOT_TOKEN) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'unauthorized' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.openById(MASTER_SS_ID);
    var sh = ss.getSheetByName(WEBAPP_OUTBOX_TAB);
    var messages = [];
    if (sh && sh.getLastRow() >= 2) {
      var values = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
      for (var i = 0; i < values.length; i++) {
        if (values[i][2] === 'N') {
          messages.push(values[i][1]);
          sh.getRange(i + 2, 3).setValue('Y');
        }
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ ok: true, messages: messages }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
