/**
 * 카톡 TXT → 통합 탭. 카톡방은 "주제 + 팀(A/B/C/D)"별이며, 한 방에 여러 거래처가 섞여 있다.
 * 그래서 업체명은 인자로 받지 않고 메시지 내용에서 추출한다.
 *
 *  - AS: 정해진 양식 → 규칙 파싱 (라벨: 값)
 *  - 불만/미수/재계약/해지방어/경영지원: 자유 대화체 → OpenAI(ChatGPT) API로 업체·항목 추출
 *  - 재계약(초과방): 초과료 내용과 재계약 내용이 섞여 있음 → 재계약 건만 추출(초과료는 제외)
 *  업체명을 못 잡은 메시지는 건너뛴다(누락 허용 — 운영 합의됨).
 *
 *  API 키는 스크립트 속성 OPENAI_API_KEY 에서 읽는다(코드/저장소에 저장 금지).
 *  사용: ingestKakaoTxt('불만', txtContent, 'A')   // roomType, 내용, 팀(선택)
 */

// 카톡방 유형 → 대상 통합 카테고리 + 추출 방식 (+ AI 힌트)
const KAKAO_SOURCES = {
  '불만':     { category: '불만',     mode: 'ai' },
  'AS':       { category: 'AS',       mode: 'rule' },
  '미수':     { category: '미수',     mode: 'ai' },
  '재계약':   {
    category: '재계약', mode: 'ai',
    aiHint: '이 방에는 초과료 청구·사용량 안내 내용과 재계약 관련 내용이 섞여 있다. ' +
            '재계약/재약정/계약연장/무상서비스 협의 등 재계약 관련 건만 추출하고, ' +
            '단순 초과료 청구·안내 건은 제외하라(초과 데이터는 별도 시트에서 관리됨).'
  },
  '해지방어': { category: '해지방어', mode: 'ai' },
  '경영지원': { category: '경영지원', mode: 'ai' }
};

// 비용 절감용 OpenAI 모델. 정확도가 필요하면 'gpt-4o' 등으로 교체 가능.
const KAKAO_AI_MODEL = 'gpt-4o-mini';
const KAKAO_AI_MAX_TOKENS = 8000;
const KAKAO_AI_BATCH = 40; // 한 번에 보내는 메시지 수

function ingestKakaoTxt(roomType, txtContent, teamLabel) {
  const src = KAKAO_SOURCES[roomType];
  if (!src) {
    return { ok: false, error: '알 수 없는 카톡방 유형: ' + roomType + ' (지원: ' + Object.keys(KAKAO_SOURCES).join(', ') + ')' };
  }
  const cat = src.category;
  if (!CONFIG[cat]) return { ok: false, error: '카테고리 미정의: ' + cat };

  const messages = parseKakaoMessages_(txtContent);
  if (!messages.length) return { ok: false, error: '카톡 메시지 파싱 결과 0건' };

  const records = src.mode === 'rule'
    ? extractKakaoByRule_(cat, messages)
    : extractKakaoWithAI_(cat, messages, src.aiHint);

  const masterSs = SpreadsheetApp.openById(MASTER_SS_ID);
  const tabName = MASTER_TABS[cat] || cat;
  const sheet = ensureMasterTab_(masterSs, cat, tabName);
  const existing = loadDupKeys_(sheet);
  const headerCols = masterHeaders_(cat);

  const newRows = [];
  for (const rec of records) {
    const vendor = String(rec.vendor || '').trim();
    if (!vendor) continue;
    const obj = rec.obj || {};
    const key = dupKey_(cat, vendor, obj);
    if (existing[key]) continue;
    existing[key] = true;

    const outRow = CONFIG[cat].displayCols.map(c => (obj[c] == null ? '' : obj[c]));
    const srcLabel = '카톡:' + roomType + (teamLabel ? '(' + teamLabel + ')' : '');
    outRow.push(vendor, srcLabel, rec.raw || '', new Date(), key);
    newRows.push(outRow);
  }

  if (newRows.length) {
    const start = sheet.getLastRow() + 1;
    sheet.getRange(start, 1, newRows.length, headerCols.length).setValues(newRows);
  }

  return {
    ok: true,
    tab: tabName,
    mode: src.mode,
    parsed: messages.length,
    records: records.length,
    added: newRows.length,
    skipped: records.length - newRows.length
  };
}

// 규칙 기반 (AS 등 양식 메시지): "라벨: 값" 줄에서 업체명 + 표시컬럼을 뽑는다.
function extractKakaoByRule_(cat, messages) {
  const cfg = CONFIG[cat];
  const dateField = (cfg.metaFields && cfg.metaFields.date) || '';

  const out = [];
  for (const m of messages) {
    const lines = (m.text || '').split('\n');
    const obj = {};
    let vendor = '';

    for (const line of lines) {
      const mm = line.match(/^\s*([^:：]{1,40})\s*[:：]\s*(.+)$/);
      if (!mm) continue;
      const label = mm[1].trim();
      const val = mm[2].trim();
      if (!val) continue;

      // 업체명: 라벨에 "업체명/거래처명/상호"가 포함되면 업체로 (예: "등급 / 업체명")
      if (!vendor && /업체명|거래처명|상호/.test(label)) {
        vendor = val;
        continue;
      }
      if (cfg.displayCols.indexOf(label) !== -1) obj[label] = val;
    }

    // 메타: 날짜/작성자는 메시지 헤더에서 보충
    if (dateField && !obj[dateField] && m.date && cfg.displayCols.indexOf(dateField) !== -1) {
      obj[dateField] = m.date;
    }
    if (cfg.displayCols.indexOf('작성자') !== -1 && !obj['작성자'] && m.author) {
      obj['작성자'] = m.author;
    }

    if (vendor) out.push({ vendor: vendor, obj: obj, raw: m.text });
  }
  return out;
}

// AI 기반 (자유 대화체): OpenAI Chat Completions로 거래처별 레코드를 구조화 추출.
function extractKakaoWithAI_(cat, messages, hint) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
  if (!apiKey) throw new Error('OPENAI_API_KEY 스크립트 속성 미설정 (프로젝트 설정 > 스크립트 속성)');

  const out = [];
  for (let i = 0; i < messages.length; i += KAKAO_AI_BATCH) {
    const chunk = messages.slice(i, i + KAKAO_AI_BATCH);
    const recs = callOpenAIExtract_(apiKey, cat, chunk, hint);
    for (const r of recs) out.push(r);
  }
  return out;
}

function callOpenAIExtract_(apiKey, cat, messages, hint) {
  const cfg = CONFIG[cat];
  const cols = cfg.displayCols;

  // 레코드 스키마: 업체명(필수) + 표시컬럼(선택은 nullable). strict 모드는 모든 키를 required에 둬야 함.
  const props = { '업체명': { type: 'string' } };
  for (const c of cols) props[c] = { type: ['string', 'null'] };
  const schema = {
    type: 'object',
    properties: {
      records: {
        type: 'array',
        items: {
          type: 'object',
          properties: props,
          required: ['업체명'].concat(cols),
          additionalProperties: false
        }
      }
    },
    required: ['records'],
    additionalProperties: false
  };

  const userText = messages.map(m =>
    (m.date ? '[' + m.date + '] ' : '') + (m.author ? m.author + ': ' : '') + m.text
  ).join('\n');

  const payload = {
    model: KAKAO_AI_MODEL,
    temperature: 0,
    max_tokens: KAKAO_AI_MAX_TOKENS,
    messages: [
      { role: 'system', content: buildExtractSystemPrompt_(cat, cols, hint) },
      { role: 'user', content: userText }
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'kakao_records', strict: true, schema: schema }
    }
  };

  const res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code !== 200) throw new Error('OpenAI API ' + code + ': ' + body);

  const data = JSON.parse(body);
  const msg = data.choices && data.choices[0] && data.choices[0].message;
  if (!msg || msg.refusal || !msg.content) return [];

  let parsed;
  try { parsed = JSON.parse(msg.content); } catch (e) { return []; }

  const recs = (parsed && parsed.records) || [];
  const out = [];
  for (const r of recs) {
    const vendor = String(r['업체명'] || '').trim();
    if (!vendor) continue;
    const obj = {};
    for (const c of cols) if (r[c] != null) obj[c] = r[c];
    out.push({ vendor: vendor, obj: obj, raw: '' });
  }
  return out;
}

function buildExtractSystemPrompt_(cat, cols, hint) {
  const lines = [
    '너는 카카오톡 단체방 대화에서 거래처별 "' + cat + '" 정보를 추출하는 도우미다.',
    '하나의 방(팀별 방)에 여러 거래처 이야기가 섞여 있다. 각 거래처(업체) 건별로 레코드를 분리해라.',
    '각 레코드는 반드시 "업체명"을 포함해야 한다. 업체명을 알 수 없는 메시지는 건너뛴다(누락 허용).',
    '다음 항목을 대화에서 찾을 수 있으면 채우고, 없으면 null로 둬라: ' + cols.join(', ') + '.',
    '대화에 실제로 있는 내용만 사용하고 추측해서 지어내지 마라.'
  ];
  if (hint) lines.push(hint);
  lines.push('결과는 records 배열로만 반환한다.');
  return lines.join('\n');
}

// 카톡 내보내기 TXT 파싱 (PC/모바일 공통 포맷). 샘플 검증 완료(2026-05).
// 예) "[현지] [오후 2:57] 내용", 날짜줄 "--------------- 2025년 3월 4일 화요일 ---------------"
function parseKakaoMessages_(txt) {
  if (!txt) return [];
  const lines = String(txt).split(/\r?\n/);

  const dateBar = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/;
  const mobile = /^\[([^\]]+)\]\s*\[(?:오전|오후)?\s*\d{1,2}:\d{2}\]\s*([\s\S]*)$/;
  const pc = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(?:오전|오후)?\s*\d{1,2}:\d{2},\s*([^:]+?)\s*:\s*([\s\S]*)$/;
  // 2024년 1월 5일 오후 3:24, 홍길동 : 내용  (iOS 등 "년월일 + 이름:내용" 한 줄 형식)
  const ymd = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*(?:오전|오후)?\s*\d{1,2}:\d{2},\s*([^:]+?)\s*:\s*([\s\S]*)$/;

  const out = [];
  let curDate = '';
  let last = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()) continue;

    const pcm = line.match(pc);
    if (pcm) {
      last = { date: pcm[1] + '-' + pad2_(pcm[2]) + '-' + pad2_(pcm[3]), author: pcm[4].trim(), text: pcm[5].trim() };
      out.push(last);
      continue;
    }

    const ym = line.match(ymd);
    if (ym) {
      last = { date: ym[1] + '-' + pad2_(ym[2]) + '-' + pad2_(ym[3]), author: ym[4].trim(), text: ym[5].trim() };
      out.push(last);
      continue;
    }

    const mm = line.match(mobile);
    if (mm) {
      last = { date: curDate, author: mm[1].trim(), text: (mm[2] || '').trim() };
      out.push(last);
      continue;
    }

    const db = line.match(dateBar);
    if (db && line.indexOf(':') === -1) {
      curDate = db[1] + '-' + pad2_(db[2]) + '-' + pad2_(db[3]);
      continue;
    }

    // 시스템 안내문(초대/내보내기 등)은 메시지 본문이 아니므로 누적 텍스트에 붙이지 않는다.
    if (last && !/님이 .*(초대했습니다|입장했습니다|나갔습니다|내보냈습니다|되었습니다|시작했어요)/.test(line)) {
      last.text += '\n' + line.trim();
    }
  }

  return out;
}
