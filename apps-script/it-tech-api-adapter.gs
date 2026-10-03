/**
 * FIRSTOA CS SYSTEM의 "IT 학습·처리이력" 탭 연결용 어댑터입니다.
 *
 * 적용 방법
 * 1. 퍼스트전산_PC_DB Apps Script의 기존 doGet(e)를 아래 doGet(e)로 교체합니다.
 * 2. itTechApiOutput_와 normalizeItRecord_ 함수도 같은 Code.gs에 추가합니다.
 * 3. 웹 앱을 새 버전으로 배포한 뒤 /exec 주소를 IT 학습·처리이력 탭에 입력합니다.
 *
 * 기존 시트 조회/등록 함수는 수정하지 않습니다.
 */
function doGet(e) {
  var params = (e && e.parameter) || {};
  var action = String(params.action || '').trim();

  // action이 없으면 기존 단독 PC 기술력 화면을 그대로 엽니다.
  if (!action) {
    return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('PC 기술력')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  try {
    var data;
    switch (action) {
      case 'ping':
        data = { connected: true, service: 'FIRSTOA IT Tech DB' };
        break;
      case 'knowledge':
        data = searchITData(params.query || '');
        break;
      case 'history':
        data = searchHistoryByQuery(params.query || '');
        break;
      case 'inventory':
        data = searchInventory(params.query || '');
        break;
      case 'quiz':
        data = getQuizQuestions(Math.max(1, Math.min(100, Number(params.count) || 50)));
        break;
      case 'addRecord':
        var payload = JSON.parse(params.payload || '{}');
        data = addASRecord(normalizeItRecord_(payload));
        break;
      default:
        throw new Error('지원하지 않는 요청입니다: ' + action);
    }
    return itTechApiOutput_({ ok: true, data: data }, params.callback);
  } catch (error) {
    return itTechApiOutput_({
      ok: false,
      error: error && error.message ? error.message : String(error)
    }, params.callback);
  }
}

function normalizeItRecord_(input) {
  var source = input || {};
  var assetNumber = String(source['자산기번'] || source['자산번호'] || source['시리얼번호'] || '').trim();
  var serialNumber = String(source['시리얼번호'] || '').trim();
  var company = String(source['업체명'] || '').trim();
  var symptom = String(source['증상'] || '').trim();

  return {
    작성자: source['작성자'] || source['등록자'] || '',
    업체명: company,
    자산번호: assetNumber,
    레벨: source['레벨'] || '',
    분류: source['구분'] || source['분류'] || 'AS',
    제조사: source['제조사'] || '',
    모델명: source['모델명'] || '',
    부품: source['부품'] || '',
    제목: source['제목'] || [company, symptom].filter(Boolean).join(' - '),
    증상: symptom,
    중지코드: source['중지코드'] || '',
    점검순서: source['점검순서'] || '',
    원인: source['원인'] || '',
    조치: source['처리내용'] || source['조치'] || '',
    결과: source['결과'] || '',
    설정경로: source['설정경로'] || '',
    고객응대: source['접수자'] || source['고객응대'] || '',
    히스토리: source['특이사항'] || source['히스토리'] || '',
    키워드: [
      source['지역'],
      source['부서명'],
      serialNumber ? '시리얼 ' + serialNumber : '',
      source['등급'],
      source['도착시간'] ? '도착 ' + source['도착시간'] : '',
      source['소요시간'] ? '소요 ' + source['소요시간'] : ''
    ].filter(Boolean).join(' / '),
    원본링크: source['원본링크'] || ''
  };
}

function itTechApiOutput_(payload, callback) {
  var json = JSON.stringify(payload);
  var safeCallback = String(callback || '').replace(/[^a-zA-Z0-9_.$]/g, '');
  if (safeCallback) {
    return ContentService
      .createTextOutput(safeCallback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
