/**
 * 고객 메시지 발송 웹훅 (해피콜 문자·홍보물 문자/메일)
 * =====================================================
 * CS 웹앱 → Supabase Edge Function(customer-message-send) → 이 웹훅 → 실제 발송.
 *  - channel "sms"   : 솔라피(Solapi) API로 문자 발송 (90바이트 초과 시 LMS 자동)
 *  - channel "email" : Gmail(MailApp)로 메일 발송
 *
 * ▣ 설치 (1회) — 아무 구글 계정의 새 Apps Script 프로젝트에:
 *  1. script.google.com → 새 프로젝트 → 이 코드 전체 붙여넣기 → 저장
 *  2. ⚙ 프로젝트 설정 → 스크립트 속성에 추가:
 *       WEBHOOK_TOKEN     = 아무 긴 무작위 문자열 (URL 검증용, 직접 만들어서)
 *       SOLAPI_API_KEY    = 솔라피 콘솔 → API Key 관리의 API Key
 *       SOLAPI_API_SECRET = 같은 곳의 API Secret
 *       SOLAPI_SENDER     = 솔라피에 등록된 발신번호 (예: 0269564248, 숫자만)
 *  3. [배포] → [새 배포] → 웹 앱 / 실행: "나" / 액세스: "모든 사용자" → /exec URL 복사
 *  4. Supabase 대시보드 → Edge Functions → customer-message-send → Secrets:
 *       CUSTOMER_MESSAGE_WEBHOOK_URL = <exec URL>?token=<WEBHOOK_TOKEN 값>
 *  5. (예약 발송용) 이 편집기에서 installDispatchTrigger() 1회 실행
 *     → 5분마다 예약된 message_jobs를 자동 발송
 *
 * 테스트: testSms() / testEmail() 함수에 본인 번호·메일 넣고 실행.
 */

var SOLAPI_API = 'https://api.solapi.com/messages/v4/send';
var EDGE_FN_URL = 'https://jwhwicplfwrorrgtqrlw.supabase.co/functions/v1/customer-message-send';
// Supabase anon 키 (공개키 — 웹앱 번들에도 노출되는 값이라 여기 둬도 안전)
var SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3aHdpY3BsZndyb3JyZ3Rxcmx3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3ODg0MTQsImV4cCI6MjA5NzM2NDQxNH0.Dx227ZN2b8w6116mrjimoRiYkElddB3pqk9ys4DL72U';

function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var token = props.getProperty('WEBHOOK_TOKEN') || '';
    if (token && (!e || !e.parameter || e.parameter.token !== token)) {
      return json_({ ok: false, error: 'unauthorized' });
    }
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var channel = body.channel === 'email' ? 'email' : 'sms';
    var to = String(body.to || '').trim();
    var text = String(body.text || '').trim();
    if (!to || !text) return json_({ ok: false, error: '수신처/내용 누락' });

    if (channel === 'email') {
      MailApp.sendEmail({
        to: to,
        subject: String(body.subject || '[퍼스트전산] 안내').trim(),
        body: text
      });
      return json_({ ok: true, channel: 'email' });
    }
    var result = sendSolapi_(to, text);
    return json_({ ok: true, channel: 'sms', detail: result });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function doGet() { return json_({ ok: true, msg: '고객 메시지 발송 웹훅 정상 작동 중' }); }

// ── 솔라피 발송: HMAC-SHA256 인증, 90바이트 초과 시 LMS ──
function sendSolapi_(to, text) {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('SOLAPI_API_KEY');
  var apiSecret = props.getProperty('SOLAPI_API_SECRET');
  var sender = (props.getProperty('SOLAPI_SENDER') || '').replace(/[^0-9]/g, '');
  if (!apiKey || !apiSecret || !sender) throw new Error('스크립트 속성에 SOLAPI_API_KEY / SOLAPI_API_SECRET / SOLAPI_SENDER를 넣어주세요.');

  var date = new Date().toISOString();
  var salt = Utilities.getUuid().replace(/-/g, '');
  var signature = Utilities.computeHmacSha256Signature(date + salt, apiSecret)
    .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');

  // 한글 2바이트 기준 90바이트 초과면 LMS
  var bytes = 0;
  for (var i = 0; i < text.length; i++) bytes += text.charCodeAt(i) > 127 ? 2 : 1;
  var message = { to: to.replace(/[^0-9]/g, ''), from: sender, text: text };
  if (bytes > 90) { message.type = 'LMS'; message.subject = '[퍼스트전산]'; }

  var res = UrlFetchApp.fetch(SOLAPI_API, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'HMAC-SHA256 apiKey=' + apiKey + ', date=' + date + ', salt=' + salt + ', signature=' + signature },
    payload: JSON.stringify({ message: message }),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code >= 300) throw new Error('솔라피 발송 실패(HTTP ' + code + '): ' + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText() || '{}');
}

// ── 예약 발송 처리: 5분마다 Edge Function의 dispatch_due를 호출 ──
function dispatchDueMessages() {
  var res = UrlFetchApp.fetch(EDGE_FN_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON },
    payload: JSON.stringify({ action: 'dispatch_due' }),
    muteHttpExceptions: true
  });
  Logger.log('dispatch_due: HTTP %s %s', res.getResponseCode(), res.getContentText().slice(0, 200));
}

function installDispatchTrigger() {
  removeDispatchTrigger();
  ScriptApp.newTrigger('dispatchDueMessages').timeBased().everyMinutes(5).create();
  Logger.log('트리거 생성: 5분마다 예약 메시지 발송 처리');
}

function removeDispatchTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dispatchDueMessages') ScriptApp.deleteTrigger(t);
  });
}

// ── 테스트 (번호·메일을 본인 것으로 바꿔 실행) ──
function testSms() { Logger.log(sendSolapi_('01000000000', '[퍼스트전산] 발송 테스트입니다.')); }
function testEmail() { MailApp.sendEmail({ to: 'me@example.com', subject: '[퍼스트전산] 테스트', body: '메일 발송 테스트입니다.' }); Logger.log('메일 전송 시도 완료'); }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
