/**
 * 카톡 TXT → 통합 탭: 시트에서 누락된 내용을 카톡 대화로 보완.
 *
 * 기본(KAKAO_USE_AI=false): 메시지를 날짜/작성자/본문으로 파싱해 통합 탭에 적재한다.
 *   - 본문은 카테고리 대표 텍스트 컬럼(KAKAO_TEXT_COL)과 _원문 컬럼에 항상 보존 → 누락 방지.
 *   - 시트 행과 동일 dupKey면 자동 제외 → 중복 방지.
 * KAKAO_USE_AI=true: extractKakaoWithAI_()에서 LLM으로 헤더 항목까지 구조화 추출(연동 필요).
 *
 * 카톡방은 보통 거래처별이므로 vendorName을 인자로 받는다.
 */

const KAKAO_USE_AI = false;

const KAKAO_TEXT_COL = {
  불만: '불만내용',
  초과: '접수내용',
  PC확장성: '세부사양',
  복합기확장성: '특이사항',
  AS: '내용'
};

function ingestKakaoTxt(cat, vendorName, txtContent) {
  if (!CONFIG[cat]) return { ok: false, error: '알 수 없는 카테고리: ' + cat };
  vendorName = String(vendorName || '').trim();
  if (!vendorName) return { ok: false, error: '업체명(vendorName) 필요' };

  const messages = parseKakaoMessages_(txtContent);
  if (!messages.length) return { ok: false, error: '카톡 메시지 파싱 결과 0건' };

  const items = KAKAO_USE_AI
    ? extractKakaoWithAI_(cat, vendorName, messages)
    : kakaoMessagesToRows_(cat, vendorName, messages);

  const masterSs = SpreadsheetApp.openById(MASTER_SS_ID);
  const tabName = MASTER_TABS[cat] || cat;
  const sheet = ensureMasterTab_(masterSs, cat, tabName);
  const existing = loadDupKeys_(sheet);
  const headerCols = masterHeaders_(cat);

  const newRows = [];
  for (const item of items) {
    const obj = item.obj;
    const key = dupKey_(cat, vendorName, obj);
    if (existing[key]) continue;
    existing[key] = true;

    const outRow = CONFIG[cat].displayCols.map(c => (obj[c] == null ? '' : obj[c]));
    outRow.push(vendorName, '카톡', item.raw || '', new Date(), key);
    newRows.push(outRow);
  }

  if (newRows.length) {
    const start = sheet.getLastRow() + 1;
    sheet.getRange(start, 1, newRows.length, headerCols.length).setValues(newRows);
  }

  return {
    ok: true,
    tab: tabName,
    parsed: messages.length,
    added: newRows.length,
    skipped: items.length - newRows.length
  };
}

// 기본 규칙 기반: 메시지 1건 = 통합 탭 1행 (대표 텍스트 컬럼 + 날짜/작성자 채움)
function kakaoMessagesToRows_(cat, vendorName, messages) {
  const cfg = CONFIG[cat];
  const dateField = (cfg.metaFields && cfg.metaFields.date) || '';
  const textCol = KAKAO_TEXT_COL[cat] || '';
  const authorCol = ['작성자', '등록자', '입력자'].filter(c => cfg.displayCols.indexOf(c) !== -1)[0] || '';

  const out = [];
  for (const m of messages) {
    if (!m.text) continue;
    const obj = {};
    if (dateField && cfg.displayCols.indexOf(dateField) !== -1) obj[dateField] = m.date || '';
    if (authorCol) obj[authorCol] = m.author || '';
    if (textCol) obj[textCol] = m.text;
    const raw = (m.date ? '[' + m.date + '] ' : '') + (m.author ? m.author + ': ' : '') + m.text;
    out.push({ obj: obj, raw: raw });
  }
  return out;
}

// AI 기반 추출 (KAKAO_USE_AI=true 일 때). LLM 연동 후 [{obj, raw}] 형태로 반환하도록 구현.
function extractKakaoWithAI_(cat, vendorName, messages) {
  throw new Error('AI 추출 미구현: KAKAO_USE_AI=true 사용 시 extractKakaoWithAI_()에 LLM 연동 필요');
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

    // 날짜 구분선 (메시지 아님): "--------------- 2024년 5월 25일 일요일 ---------------"
    const db = line.match(dateBar);
    if (db && line.indexOf(':') === -1) {
      curDate = db[1] + '-' + pad2_(db[2]) + '-' + pad2_(db[3]);
      continue;
    }

    // 직전 메시지의 멀티라인 본문
    if (last) last.text += '\n' + line.trim();
  }

  return out;
}
