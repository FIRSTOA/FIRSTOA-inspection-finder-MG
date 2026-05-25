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

  let messages = parseKakaoMessages_(txtContent);
  if (!messages.length) {
    const head = String(txtContent || '').slice(0, 100).replace(/\n/g, '⏎');
    return { ok: false, error: '카톡 메시지 파싱 결과 0건 (수신 ' + String(txtContent || '').length + '자, 시작: "' + head + '")' };
  }
  messages = filterKakaoMessages_(messages);

  const records = src.mode === 'rule'
    ? extractKakaoByRule_(cat, messages)
    : extractKakaoWithAI_(cat, messages, src.aiHint);

  const r = appendKakaoRecords_(cat, roomType, teamLabel, records);
  return {
    ok: true, tab: r.tab, mode: src.mode,
    parsed: messages.length, records: records.length,
    added: r.added, skipped: r.skipped
  };
}

// 사진/이모티콘/시스템 안내 등 추출 가치 없는 메시지 제거 (토큰·시간 절감)
const KAKAO_NOISE = /^(사진( ?\d+장)?|동영상|이모티콘|음성메시지|보이스톡.*|페이스톡.*|삭제된 메시지입니다\.?|채팅방 관리자가.*)$/;
function filterKakaoMessages_(messages) {
  return messages.filter(function (m) {
    const t = String(m.text || '').trim();
    if (t.length < 2) return false;
    if (KAKAO_NOISE.test(t)) return false;
    return true;
  });
}

// 추출된 레코드를 통합 탭에 중복 제거하며 추가. (시트의 현재 dupKey를 매번 다시 읽어 배치 간 중복도 거른다)
function appendKakaoRecords_(cat, roomType, teamLabel, records) {
  const masterSs = SpreadsheetApp.openById(MASTER_SS_ID);
  const tabName = MASTER_TABS[cat] || cat;
  const sheet = ensureMasterTab_(masterSs, cat, tabName);
  const existing = loadDupKeys_(sheet);
  const headerCols = masterHeaders_(cat);
  const srcLabel = '카톡:' + roomType + (teamLabel ? '(' + teamLabel + ')' : '');

  const newRows = [];
  for (const rec of records) {
    const vendor = String(rec.vendor || '').trim();
    if (!vendor) continue;
    const obj = rec.obj || {};
    const key = dupKey_(cat, vendor, obj);
    if (existing[key]) continue;
    existing[key] = true;

    const outRow = CONFIG[cat].displayCols.map(c => (obj[c] == null ? '' : obj[c]));
    outRow.push(vendor, srcLabel, rec.raw || '', new Date(), key);
    newRows.push(outRow);
  }

  if (newRows.length) {
    const start = sheet.getLastRow() + 1;
    sheet.getRange(start, 1, newRows.length, headerCols.length).setValues(newRows);
  }
  return { added: newRows.length, skipped: records.length - newRows.length, tab: tabName };
}

// ── 큰 파일용 청크 업로드 (멈춤/시간초과 방지) ──
const KAKAO_TMP_TAB = '_kakao_tmp';

// 1단계: 파싱·필터 후 임시 시트에 저장, 배치 수 반환
function kakaoUploadStart(roomType, teamLabel, content) {
  try {
    const src = KAKAO_SOURCES[roomType];
    if (!src) return { ok: false, error: '알 수 없는 카톡방 유형: ' + roomType };
    const cat = src.category;
    if (!CONFIG[cat]) return { ok: false, error: '카테고리 미정의: ' + cat };
    if (!content || !String(content).trim()) return { ok: false, error: '파일 내용이 비어있습니다.' };

    let messages = parseKakaoMessages_(String(content));
    if (!messages.length) {
      const head = String(content).slice(0, 100).replace(/\n/g, '⏎');
      return { ok: false, error: '파싱 0건 (수신 ' + String(content).length + '자, 시작: "' + head + '")' };
    }
    messages = filterKakaoMessages_(messages);
    if (!messages.length) return { ok: false, error: '유효 메시지 0건 (사진/이모티콘 등만 있음)' };

    // 이미 처리한 메시지는 제외 → 전체 TXT를 다시 붙여넣어도 "새 메시지"만 AI에 보낸다
    const seen = loadSeenHashes_(roomType);
    const fresh = [];
    for (const m of messages) {
      const h = msgHash_(roomType, m);
      if (seen[h]) continue;
      seen[h] = true; // 같은 파일 내 중복도 방지
      fresh.push([m.date || '', m.author || '', m.text || '', h]);
    }

    const tabName = MASTER_TABS[cat] || cat;
    if (!fresh.length) {
      return { ok: true, total: 0, batches: 0, mode: src.mode, tab: tabName, nothingNew: true, scanned: messages.length };
    }

    const ss = SpreadsheetApp.openById(MASTER_SS_ID);
    let tmp = ss.getSheetByName(KAKAO_TMP_TAB);
    if (!tmp) { tmp = ss.insertSheet(KAKAO_TMP_TAB); tmp.hideSheet(); }
    tmp.clear();
    tmp.getRange(1, 1, 1, 4).setValues([['date', 'author', 'text', 'hash']]);
    const B = 5000;
    for (let i = 0; i < fresh.length; i += B) {
      const slice = fresh.slice(i, i + B);
      tmp.getRange(2 + i, 1, slice.length, 4).setValues(slice);
    }

    const size = src.mode === 'rule' ? 1000 : KAKAO_AI_BATCH * 2;
    const batches = Math.ceil(fresh.length / size);
    const job = {
      roomType: roomType, teamLabel: teamLabel || '', cat: cat, mode: src.mode,
      total: fresh.length, size: size, batches: batches, ts: Date.now()
    };
    PropertiesService.getScriptProperties().setProperty('KAKAO_JOB', JSON.stringify(job));

    return { ok: true, total: fresh.length, batches: batches, mode: src.mode, tab: tabName, scanned: messages.length };
  } catch (err) {
    return { ok: false, error: err.toString() };
  }
}

// 2단계: 배치 단위로 추출·적재 (클라이언트가 0..batches-1 반복 호출)
function kakaoUploadBatch(batchIndex) {
  try {
    const jobStr = PropertiesService.getScriptProperties().getProperty('KAKAO_JOB');
    if (!jobStr) return { ok: false, error: '진행 중인 업로드 작업이 없습니다. 다시 시작하세요.' };
    const job = JSON.parse(jobStr);

    const ss = SpreadsheetApp.openById(MASTER_SS_ID);
    const tmp = ss.getSheetByName(KAKAO_TMP_TAB);
    if (!tmp) return { ok: false, error: '임시 데이터 없음. 다시 시작하세요.' };

    const remaining = job.total - batchIndex * job.size;
    if (remaining <= 0) return { ok: true, done: true, added: 0, skipped: 0, records: 0, tab: MASTER_TABS[job.cat] || job.cat, mode: job.mode };

    const n = Math.min(job.size, remaining);
    const vals = tmp.getRange(2 + batchIndex * job.size, 1, n, 4).getValues();
    const messages = vals.map(r => ({ date: r[0], author: r[1], text: r[2] }));
    const hashes = vals.map(r => r[3]);

    const src = KAKAO_SOURCES[job.roomType];
    const records = job.mode === 'rule'
      ? extractKakaoByRule_(job.cat, messages)
      : extractKakaoWithAI_(job.cat, messages, src && src.aiHint);

    const r = appendKakaoRecords_(job.cat, job.roomType, job.teamLabel, records);
    appendSeenHashes_(job.roomType, hashes); // 이 배치 메시지를 "처리됨"으로 기록

    const done = (batchIndex + 1) >= job.batches;
    if (done) {
      try { tmp.clear(); } catch (e) {}
      PropertiesService.getScriptProperties().deleteProperty('KAKAO_JOB');
    }
    return {
      ok: true, done: done, processed: n, total: job.total,
      records: records.length, added: r.added, skipped: r.skipped,
      tab: r.tab, mode: job.mode
    };
  } catch (err) {
    return { ok: false, error: err.toString() };
  }
}

// ── 메시지 단위 중복 추적 (전체 TXT 재업로드 시 새 메시지만 처리) ──
const KAKAO_SEEN_TAB = '_kakao_seen';

function msgHash_(room, m) {
  const raw = room + '|' + (m.date || '') + '|' + (m.author || '') + '|' + (m.text || '');
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw, Utilities.Charset.UTF_8);
  let hex = '';
  for (let b = 0; b < bytes.length; b++) {
    const v = bytes[b] < 0 ? bytes[b] + 256 : bytes[b];
    hex += (v < 16 ? '0' : '') + v.toString(16);
  }
  return hex;
}

function loadSeenHashes_(room) {
  const set = {};
  const ss = SpreadsheetApp.openById(MASTER_SS_ID);
  const sh = ss.getSheetByName(KAKAO_SEEN_TAB);
  if (!sh) return set;
  const last = sh.getLastRow();
  if (last < 2) return set;
  const data = sh.getRange(2, 1, last - 1, 2).getValues();
  for (const r of data) { if (r[0] === room) set[r[1]] = true; }
  return set;
}

function appendSeenHashes_(room, hashes) {
  if (!hashes || !hashes.length) return;
  const ss = SpreadsheetApp.openById(MASTER_SS_ID);
  let sh = ss.getSheetByName(KAKAO_SEEN_TAB);
  if (!sh) {
    sh = ss.insertSheet(KAKAO_SEEN_TAB);
    sh.hideSheet();
    sh.getRange(1, 1, 1, 2).setValues([['room', 'hash']]);
  }
  const rows = hashes.map(h => [room, h]);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, 2).setValues(rows);
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
