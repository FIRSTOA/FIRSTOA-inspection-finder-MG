/**
 * 카톡 TXT → 통합 탭. 카톡방은 "주제 + 팀(A/B/C/D)"별이며, 한 방에 여러 거래처가 섞여 있다.
 * 그래서 업체명은 인자로 받지 않고 메시지 내용에서 추출한다.
 *
 *  - AS: 정해진 양식 → 규칙 파싱 (라벨: 값)
 *  - 불만/미수/재계약/해지방어/경영지원: 자유 대화체 → Claude로 업체·항목 추출
 *  업체명을 못 잡은 메시지는 건너뛴다(누락 허용 — 운영 합의됨).
 *
 *  사용: ingestKakaoTxt('불만', txtContent, 'A')   // roomType, 내용, 팀(선택)
 */

// 카톡방 유형 → 대상 통합 카테고리 + 추출 방식
const KAKAO_SOURCES = {
  '불만':     { category: '불만',     mode: 'ai' },
  'AS':       { category: 'AS',       mode: 'rule' },
  '미수':     { category: '미수',     mode: 'ai' },
  '재계약':   { category: '재계약',   mode: 'ai' },
  '해지방어': { category: '해지방어', mode: 'ai' },
  '경영지원': { category: '경영지원', mode: 'ai' }
};

// 비용 절감이 필요하면 'claude-haiku-4-5' 등으로 교체 가능 (정확도 트레이드오프).
const KAKAO_AI_MODEL = 'claude-opus-4-7';
const KAKAO_AI_EFFORT = 'medium';
const KAKAO_AI_MAX_TOKENS = 8000;
const KAKAO_AI_BATCH = 60; // 한 번에 보내는 메시지 수

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
    : extractKakaoWithAI_(cat, messages);

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
  const vendorLabels = [cfg.vendorCol, cfg.vendorColFallback, '업체명', '거래처명', '상호'].filter(Boolean);

  const out = [];
  for (const m of messages) {
    const lines = (m.text || '').split('\n');
    const obj = {};
    let vendor = '';

    for (const line of lines) {
      const mm = line.match(/^\s*([^:：]{1,30})\s*[:：]\s*(.+)$/);
      if (!mm) continue;
      const label = mm[1].trim();
      const val = mm[2].trim();
      if (vendorLabels.indexOf(label) !== -1) {
        if (!vendor) vendor = val;
      } else if (cfg.displayCols.indexOf(label) !== -1) {
        obj[label] = val;
      }
    }

    if (dateField && !obj[dateField] && m.date && cfg.displayCols.indexOf(dateField) !== -1) {
      obj[dateField] = m.date;
    }
    if (vendor) out.push({ vendor: vendor, obj: obj, raw: m.text });
  }
  return out;
}

// AI 기반 (자유 대화체): Claude Messages API로 거래처별 레코드를 구조화 추출.
function extractKakaoWithAI_(cat, messages) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY 스크립트 속성 미설정 (프로젝트 설정 > 스크립트 속성)');

  const out = [];
  for (let i = 0; i < messages.length; i += KAKAO_AI_BATCH) {
    const chunk = messages.slice(i, i + KAKAO_AI_BATCH);
    const recs = callClaudeExtract_(apiKey, cat, chunk);
    for (const r of recs) out.push(r);
  }
  return out;
}

function callClaudeExtract_(apiKey, cat, messages) {
  const cfg = CONFIG[cat];
  const cols = cfg.displayCols;

  // 레코드 스키마: 업체명(필수) + 표시컬럼(선택, 문자열)
  const props = { '업체명': { type: 'string' } };
  for (const c of cols) props[c] = { type: 'string' };
  const schema = {
    type: 'object',
    properties: {
      records: {
        type: 'array',
        items: { type: 'object', properties: props, required: ['업체명'], additionalProperties: false }
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
    max_tokens: KAKAO_AI_MAX_TOKENS,
    // 정적 시스템 프롬프트 + 스키마 설명은 카테고리별로 고정 → 프롬프트 캐시
    system: [{
      type: 'text',
      text: buildExtractSystemPrompt_(cat, cols),
      cache_control: { type: 'ephemeral' }
    }],
    output_config: {
      effort: KAKAO_AI_EFFORT,
      format: { type: 'json_schema', schema: schema }
    },
    messages: [{ role: 'user', content: userText }]
  };

  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code !== 200) throw new Error('Claude API ' + code + ': ' + body);

  const data = JSON.parse(body);
  let text = '';
  for (const block of (data.content || [])) {
    if (block.type === 'text') { text = block.text; break; }
  }

  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { return []; }

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

function buildExtractSystemPrompt_(cat, cols) {
  return [
    '너는 카카오톡 단체방 대화에서 거래처별 "' + cat + '" 정보를 추출하는 도우미다.',
    '하나의 방(팀별 방)에 여러 거래처 이야기가 섞여 있다. 각 거래처(업체) 건별로 레코드를 분리해라.',
    '각 레코드는 반드시 "업체명"을 포함해야 한다. 업체명을 알 수 없는 메시지는 건너뛴다(누락 허용).',
    '다음 항목을 대화에서 찾을 수 있으면 채우고, 없으면 비워라: ' + cols.join(', ') + '.',
    '대화에 실제로 있는 내용만 사용하고 추측해서 지어내지 마라.',
    '결과는 records 배열로만 반환한다.'
  ].join('\n');
}

// 카톡 내보내기 TXT 파싱 (PC/모바일 공통 포맷 대응). 실제 샘플 확보 후 정교화.
function parseKakaoMessages_(txt) {
  if (!txt) return [];
  const lines = String(txt).split(/\r?\n/);

  const dateBar = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/;
  const mobile = /^\[([^\]]+)\]\s*\[(?:오전|오후)?\s*\d{1,2}:\d{2}\]\s*(.*)$/;
  const pc = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(?:오전|오후)?\s*\d{1,2}:\d{2},\s*([^:]+?)\s*:\s*([\s\S]*)$/;

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

    if (last) last.text += '\n' + line.trim();
  }

  return out;
}
