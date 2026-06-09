/**
 * 사진(거래처 상세카드/점검지 캡처) → 점검·청정기 양식 텍스트 변환 (OpenAI 비전).
 * 프론트(inspection-finder)가 doPost(action=vision)로 base64 이미지를 보내면,
 * 정해진 틀에 맞춰 채운 양식 텍스트를 돌려준다. 결과는 기존 변환기 입력으로 들어간다.
 * API 키는 스크립트 속성 OPENAI_API_KEY 사용(코드/저장소에 저장 금지).
 */

var INSP_DIVIDER_ = 'ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ';

// 점검(복합기) 양식 템플릿 — 사용자가 지정한 그대로
function inspectionFormTemplate_() {
  return [
    '작성자:',
    '구분:점검',
    '레벨:1',
    '등급:',
    '업체명:',
    '부서명:',
    '지역:C',
    '키맨/접수자:',
    INSP_DIVIDER_,
    '1.',
    '모델명:',
    '시리얼넘버:',
    '자산기번: ',
    '내용: 정기점검',
    '처리내용: 정기점검',
    '매수:흑- 컬- 큰컬- 합-',
    '토너잔량:K- C- M- Y-',
    '폐통:  %',
    '여분: K- C- M- Y- 폐-',
    '한틴이카유무:',
    '주차비지원유무:',
    '특이사항:',
    INSP_DIVIDER_,
    '※부품신청※',
    '보증기간 내 여부 :',
    '교체 전 카운터 누적 사용매수 :',
    '사용 부품 예상 사용매수 :',
    '▶ 신청 부품',
    '물품명:',
    '수량:',
    '출고여부:',
    INSP_DIVIDER_,
    '※자가신청※',
    '물품:',
    '수량:',
    '출고여부:',
    INSP_DIVIDER_,
    '도착 시간:',
    '소요 시간:'
  ].join('\n');
}

// 청정기 양식 템플릿 — 점검과 같되 기기 블록 중간(매수~주차비)이 필터리셋/필터교체로 대체
function airFormTemplate_() {
  return [
    '작성자:',
    '구분: 점검',
    '레벨: 1',
    '등급: ',
    '업체명: ',
    '부서명: ',
    '지역: C',
    '키맨/접수자:',
    INSP_DIVIDER_,
    '1.',
    '모델명: ',
    '시리얼넘버: ',
    '자산기번: ',
    '내용: 정기점검',
    '처리내용: 정기점검',
    '필터리셋:',
    '필터교체:',
    '특이사항:',
    INSP_DIVIDER_,
    '※부품신청※',
    '보증기간 내 여부 : ',
    '교체 전 카운터 누적 사용매수 : ',
    '사용 부품 예상 사용매수 : ',
    '▶ 신청 부품',
    '물품명:',
    '수량:',
    '출고여부: ',
    INSP_DIVIDER_,
    '※자가신청※',
    '물품:',
    '수량:',
    '출고여부:',
    INSP_DIVIDER_,
    '도착 시간:',
    '소요 시간:'
  ].join('\n');
}

function visionSystemPrompt_(kind) {
  var template = (kind === 'air') ? airFormTemplate_() : inspectionFormTemplate_();
  return [
    '당신은 거래처 상세카드(휴대폰 연락처/CRM 캡처)나 점검지 사진을 읽어 "점검 보고 양식"으로 변환하는 도우미다.',
    '아래 템플릿을 그대로 출력하되, 이미지에서 확실히 읽히는 값만 각 항목 뒤에 채운다. 안 보이거나 모르는 값은 비워 둔다(추측 금지).',
    '',
    '[매핑 규칙]',
    '- 상호/이름 필드 맨 앞에 등급코드(예: "5SS", "3A", "SS")가 붙어있으면, 영문 등급(SS/S/A/B/C/N 등)은 "등급:"에 넣고, 앞 숫자는 무시한다. 나머지 상호 전체(괄호·특이문구 포함)는 "업체명:"에 넣는다.',
    '- 주소가 있으면 "업체명:" 값 바로 다음 줄에 건물명·호수와 (지번) 형태로 그대로 덧붙인다.',
    '- "D470/809150709646"처럼 슬래시로 묶인 값은 슬래시 기준으로 앞=모델명, 뒤=시리얼넘버로 나눈다.',
    '- 담당자/전화 정보는 "키맨/접수자:"에 "이름 번호" 형태로 넣는다(원본에 두 번 나오면 두 줄로 그대로).',
    '- 구분:점검, 레벨:1, 지역:C, 내용/처리내용:정기점검 은 기본값으로 둔다(이미지에 다른 값이 명확하면 그걸 우선).',
    '- 매수/토너/폐통/여분/부품신청/시간 등 점검 당시 입력하는 항목은 비워 둔다.',
    '',
    '[출력 규칙]',
    '- 아래 템플릿 텍스트만 출력한다. 설명·머리말·코드블록(```)·따옴표로 감싸지 말 것.',
    '- 구분선(ㅡ)과 항목 순서는 템플릿 그대로 유지한다.',
    '',
    '[템플릿]',
    template
  ].join('\n');
}

// 프론트(doPost)에서 호출: dataUrl = "data:image/...;base64,..." , kind = 'inspection' | 'air'
function visionExtractForm(dataUrl, kind) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
  if (!apiKey) return { ok: false, error: 'OPENAI_API_KEY 미설정' };
  if (!dataUrl || String(dataUrl).indexOf('data:image') !== 0) return { ok: false, error: '이미지 데이터가 없습니다.' };

  var payload = {
    model: KAKAO_AI_MODEL,
    messages: [
      { role: 'system', content: visionSystemPrompt_(kind) },
      { role: 'user', content: [
        { type: 'text', text: '이 이미지를 점검 양식으로 변환해줘.' },
        { type: 'image_url', image_url: { url: dataUrl } }
      ] }
    ]
  };
  if (/^(gpt-5|o\d)/.test(KAKAO_AI_MODEL)) {
    payload.max_completion_tokens = KAKAO_AI_MAX_TOKENS;
  } else {
    payload.max_tokens = KAKAO_AI_MAX_TOKENS;
    payload.temperature = 0;
  }

  var res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code !== 200) return { ok: false, error: 'OpenAI ' + code + ': ' + body.slice(0, 300) };

  var data;
  try { data = JSON.parse(body); } catch (e) { return { ok: false, error: '응답 파싱 실패' }; }
  var msg = data.choices && data.choices[0] && data.choices[0].message;
  var text = msg && msg.content ? String(msg.content).trim() : '';
  text = text.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim(); // 혹시 코드블록으로 감싸면 제거
  if (!text) return { ok: false, error: '이미지에서 양식을 추출하지 못했습니다.' };
  return { ok: true, text: text };
}
