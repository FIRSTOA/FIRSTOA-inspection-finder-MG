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
  '미수':     { category: '미수',     mode: 'ai' },
  '재계약':   {
    category: '재계약', mode: 'ai',
    aiHint: '★중요: 이 방에는 "초과료 청구/사용량 안내" 메시지와 "재계약" 메시지가 섞여 있다. ' +
            '재계약/재약정/계약연장/계약만료/무상서비스 협의 등 "계약"에 관한 건만 레코드로 만들어라. ' +
            '아래에 해당하면 재계약과 무관하므로 레코드를 만들지 말고 반드시 건너뛴다(누락 허용):\n' +
            '  · 초과료 금액 발생/청구, 평균/당월 초과료 안내\n' +
            '  · 사용량·매수 안내, 명세서/세금계산서 SMS·이메일 발송 완료 안내\n' +
            '제외 예시(이런 메시지는 레코드 0개): "3개월 누적업체로 평균 초과료 256,000원인 업체인데 ' +
            '당월 초과료 318,000원 발생. 명세서 SMS와 이메일 발송 완료." ' +
            '→ 초과료 안내일 뿐 재계약 내용이 없으므로 건너뛴다. ' +
            '메시지에 계약(재계약/연장/만료/약정) 의사가 명시적으로 없으면 만들지 마라.'
  },
  '해지방어': { category: '해지방어', mode: 'ai' },
  '경영지원': { category: '경영지원', mode: 'ai' }
};
// 주: AS는 AI 경로가 아니라 전용 양식 파서(ingestASFormsUpload)로 AS 원문시트에 직접 적재한다.

// 카톡 AI 추출 모델. GPT-5 계열은 호출부(callOpenAIExtract_)가 자동으로 파라미터를 맞춘다.
const KAKAO_AI_MODEL = 'gpt-5.4-mini';
const KAKAO_AI_MAX_TOKENS = 16000;
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
  messages = preFilterForCategory_(cat, messages);

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

// 카테고리별 사전 필터. 재계약방은 초과료/분기마감 보고서를 AI 전에 제거(재계약 신호 있으면 유지).
const RECON_KEEP = /재계약|재약정|재\s?약정|계약\s*연장|연장\s*계약|계약\s*갱신|약정\s*연장|계약\s*갱신|갱신\s*계약|재\s*약정/;
const RECON_OVERAGE = /분기\s*마감|초과료|초과\s*발생|발생.*초과|첫\s*청구|청구\s*안내|명세서|세금계산서|발행\s*완료/;
function preFilterForCategory_(cat, messages) {
  if (cat !== '재계약') return messages;
  return messages.filter(function (m) {
    const t = String(m.text || '');
    if (RECON_KEEP.test(t)) return true;     // 재계약 신호 → 유지
    if (RECON_OVERAGE.test(t)) return false; // 초과료/분기마감 보고 → 제외
    return true;                             // 애매하면 유지(AI 판단)
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
    messages = preFilterForCategory_(cat, messages);
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

// ── 백그라운드 큐: 창을 닫아도 구글 서버가 트리거로 끝까지 처리 ──
const KAKAO_QUEUE_PROP = 'KAKAO_QUEUE';

// AI 영역 1개 파일을 대기열에 등록(파싱·필터·중복제외 후 임시시트에 적재). AS는 별도(즉시) 처리.
function kakaoEnqueue(roomType, teamLabel, content) {
  try {
    const src = KAKAO_SOURCES[roomType];
    if (!src) return { ok: false, error: '알 수 없는 카톡방 유형: ' + roomType };
    const cat = src.category;
    if (!CONFIG[cat]) return { ok: false, error: '카테고리 미정의: ' + cat };
    if (!content || !String(content).trim()) return { ok: false, error: '파일 내용이 비어있습니다.' };

    let messages = parseKakaoMessages_(String(content));
    if (!messages.length) return { ok: false, error: '파싱 0건' };
    messages = filterKakaoMessages_(messages);
    messages = preFilterForCategory_(cat, messages);

    const seen = loadSeenHashes_(roomType);
    const fresh = [];
    for (const m of messages) {
      const h = msgHash_(roomType, m);
      if (seen[h]) continue;
      seen[h] = true;
      fresh.push([m.date || '', m.author || '', m.text || '', h]);
    }
    if (!fresh.length) return { ok: true, total: 0, batches: 0, scanned: messages.length };

    const props = PropertiesService.getScriptProperties();
    const ss = SpreadsheetApp.openById(MASTER_SS_ID);
    let tmp = ss.getSheetByName(KAKAO_TMP_TAB);
    if (!tmp) { tmp = ss.insertSheet(KAKAO_TMP_TAB); tmp.hideSheet(); }

    let queue = JSON.parse(props.getProperty(KAKAO_QUEUE_PROP) || '[]');
    const anyPending = queue.some(j => j.status !== 'done' && j.status !== 'error');
    if (!anyPending) { queue = []; tmp.clear(); tmp.getRange(1, 1, 1, 4).setValues([['date', 'author', 'text', 'hash']]); }
    if (tmp.getLastRow() < 1) tmp.getRange(1, 1, 1, 4).setValues([['date', 'author', 'text', 'hash']]);

    const startRow = tmp.getLastRow() + 1;
    const B = 5000;
    for (let i = 0; i < fresh.length; i += B) {
      const s = fresh.slice(i, i + B);
      tmp.getRange(startRow + i, 1, s.length, 4).setValues(s);
    }

    const size = KAKAO_AI_BATCH * 2;
    const batches = Math.ceil(fresh.length / size);
    const jobId = 'J' + Date.now() + Math.floor(Math.random() * 1000);
    queue.push({
      jobId: jobId, roomType: roomType, teamLabel: teamLabel || '', cat: cat,
      total: fresh.length, size: size, batches: batches, startRow: startRow,
      done: 0, added: 0, skipped: 0, attempts: 0, status: 'pending'
    });
    props.setProperty(KAKAO_QUEUE_PROP, JSON.stringify(queue));
    return { ok: true, jobId: jobId, total: fresh.length, batches: batches, scanned: messages.length };
  } catch (err) {
    return { ok: false, error: err.toString() };
  }
}

function kakaoStartWorker() {
  scheduleWorker_(5 * 1000);
  return { ok: true };
}

function scheduleWorker_(afterMs) {
  deleteWorkerTriggers_();
  ScriptApp.newTrigger('kakaoWorker').timeBased().after(afterMs || 1000).create();
}

function deleteWorkerTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'kakaoWorker') ScriptApp.deleteTrigger(t);
  });
}

// 트리거로 실행: 대기열을 시간 예산 안에서 처리하고, 남으면 다음 트리거 예약
function kakaoWorker() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // 이미 다른 워커 실행 중
  try {
    const startTime = Date.now();
    const BUDGET_MS = 5 * 60 * 1000; // 5분 (실행 한도 대비 여유)
    const props = PropertiesService.getScriptProperties();
    const ss = SpreadsheetApp.openById(MASTER_SS_ID);
    const tmp = ss.getSheetByName(KAKAO_TMP_TAB);

    while (Date.now() - startTime < BUDGET_MS) {
      // 중지 요청 확인 (kakaoStopAll이 플래그를 세움)
      if (props.getProperty('KAKAO_STOP')) {
        props.deleteProperty('KAKAO_STOP');
        props.deleteProperty(KAKAO_QUEUE_PROP);
        deleteWorkerTriggers_();
        if (tmp) tmp.clear();
        Logger.log('kakaoWorker: 중지 요청으로 종료');
        return;
      }
      let queue = JSON.parse(props.getProperty(KAKAO_QUEUE_PROP) || '[]');
      let job = null;
      for (let i = 0; i < queue.length; i++) {
        if (queue[i].status !== 'done' && queue[i].status !== 'error') { job = queue[i]; break; }
      }
      if (!job) { deleteWorkerTriggers_(); if (tmp) tmp.clear(); return; } // 전부 완료
      if (!tmp) { return; }

      try {
        job.status = 'running';
        const remaining = job.total - job.done * job.size;
        const n = Math.min(job.size, remaining);
        const rowStart = job.startRow + job.done * job.size;
        const vals = tmp.getRange(rowStart, 1, n, 4).getValues();
        const messages = vals.map(function (r) { return { date: r[0], author: r[1], text: r[2] }; });
        const hashes = vals.map(function (r) { return r[3]; });

        const src = KAKAO_SOURCES[job.roomType];
        const records = extractKakaoWithAI_(job.cat, messages, src && src.aiHint);
        const r = appendKakaoRecords_(job.cat, job.roomType, job.teamLabel, records);
        appendSeenHashes_(job.roomType, hashes);

        job.done += 1;
        job.added += r.added;
        job.skipped += r.skipped;
        if (job.done >= job.batches) job.status = 'done';
        props.setProperty(KAKAO_QUEUE_PROP, JSON.stringify(queue));
      } catch (be) {
        job.attempts = (job.attempts || 0) + 1;
        job.lastError = String(be);
        if (job.attempts >= 3) job.status = 'error';
        props.setProperty(KAKAO_QUEUE_PROP, JSON.stringify(queue));
        scheduleWorker_(30 * 1000);
        return;
      }
    }
    scheduleWorker_(20 * 1000); // 예산 초과 → 이어서
  } catch (e) {
    Logger.log('kakaoWorker 오류: ' + e);
    scheduleWorker_(60 * 1000);
  } finally {
    lock.releaseLock();
  }
}

function kakaoQueueStatus() {
  const props = PropertiesService.getScriptProperties();
  const queue = JSON.parse(props.getProperty(KAKAO_QUEUE_PROP) || '[]');
  const jobs = queue.map(function (j) {
    return {
      jobId: j.jobId, roomType: j.roomType, teamLabel: j.teamLabel,
      batches: j.batches, done: j.done, added: j.added, skipped: j.skipped,
      status: j.status, lastError: j.lastError || ''
    };
  });
  const active = jobs.some(function (j) { return j.status !== 'done' && j.status !== 'error'; });
  const allDone = jobs.length > 0 && !active;
  return { ok: true, jobs: jobs, active: active, allDone: allDone };
}

// 진행 중인 백그라운드 업로드를 즉시 중지 (워커가 다음 배치에서 종료)
function kakaoStopAll() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('KAKAO_STOP', '1');
  props.deleteProperty(KAKAO_QUEUE_PROP);
  deleteWorkerTriggers_();
  try {
    const ss = SpreadsheetApp.openById(MASTER_SS_ID);
    const tmp = ss.getSheetByName(KAKAO_TMP_TAB);
    if (tmp) tmp.clear();
  } catch (e) {}
  return { ok: true, stopped: true };
}

// 잘못 올린 영역 되돌리기: 해당 방(roomType)으로 들어온 카톡 행 삭제 + 처리기록 초기화
// (AI 영역 전용. AS는 원문시트라 별도)
function resetKakaoRoom(roomType) {
  try {
    const src = KAKAO_SOURCES[roomType];
    if (!src) return { ok: false, error: '알 수 없는 방: ' + roomType };
    const cat = src.category;
    const ss = SpreadsheetApp.openById(MASTER_SS_ID);
    const sheet = ss.getSheetByName(MASTER_TABS[cat] || cat);
    let deleted = 0;

    if (sheet && sheet.getLastRow() >= 2) {
      const lastCol = sheet.getLastColumn();
      const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
      const sIdx = headers.indexOf('_출처');
      if (sIdx !== -1) {
        const prefix = '카톡:' + roomType;
        const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
        const keep = data.filter(r => String(r[sIdx] || '').indexOf(prefix) !== 0);
        deleted = data.length - keep.length;
        sheet.getRange(2, 1, data.length, lastCol).clearContent();
        if (keep.length) sheet.getRange(2, 1, keep.length, lastCol).setValues(keep);
      }
    }

    // 처리기록(_kakao_seen)에서 해당 방 제거
    const seenSh = ss.getSheetByName(KAKAO_SEEN_TAB);
    let seenRemoved = 0;
    if (seenSh && seenSh.getLastRow() >= 2) {
      const sdata = seenSh.getRange(2, 1, seenSh.getLastRow() - 1, 2).getValues();
      const keep = sdata.filter(r => String(r[0]) !== roomType);
      seenRemoved = sdata.length - keep.length;
      seenSh.getRange(2, 1, sdata.length, 2).clearContent();
      if (keep.length) seenSh.getRange(2, 1, keep.length, 2).setValues(keep);
    }

    return { ok: true, room: roomType, cat: cat, deletedRows: deleted, seenRemoved: seenRemoved };
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

// ── AS 전용: 카톡 "구분:AS" 양식을 규칙 파싱해 AS 원문시트에 직접 적재 (AI 미사용) ──
// 흐름: 카톡 TXT → 양식 추출 → AS 원문시트 입력 → (동기화 시) 통합 AS 탭으로 미러
function ingestASFormsUpload(content, regionFallback) {
  try {
    if (!content || !String(content).trim()) return { ok: false, error: '파일 내용이 비어있습니다.' };
    const messages = parseKakaoMessages_(String(content));
    if (!messages.length) {
      const head = String(content).slice(0, 100).replace(/\n/g, '⏎');
      return { ok: false, error: '파싱 0건 (수신 ' + String(content).length + '자, 시작: "' + head + '")' };
    }
    const records = extractASForms_(messages, regionFallback || '');
    if (!records.length) return { ok: false, error: 'AS 양식(구분:AS) 메시지를 찾지 못했습니다.', parsed: messages.length };
    const r = appendASToSheet_(records);
    return { ok: true, tab: 'AS 원문시트', parsed: messages.length, records: records.length, added: r.added, skipped: r.skipped };
  } catch (err) {
    return { ok: false, error: err.toString() };
  }
}

// "구분" 값에 AS가 포함되면 AS 양식으로 본다.
// 예: 구분:AS / 구분: AS,점검 / 구분 :AS/점검 / 점검 구분: A/S … 모두 인식
function isASForm_(content) {
  const m = String(content).match(/구분\s*[:：]\s*([^\n\r]{0,40})/);
  if (!m) return false;
  return /A\s*\/?\s*S/i.test(m[1]);
}

function extractASForms_(messages, regionFallback) {
  const out = [];
  for (const m of messages) {
    const content = m.text || '';
    if (!isASForm_(content)) continue;

    const f = extractASFields_(content);
    const vendor = f['업체명'];
    if (!vendor || vendor.length < 2 || vendor === '부서명 :' || vendor === '부서명:') continue;

    out.push({
      'AS날짜': m.date || '',
      '작성자': String(m.author || '').replace(/님$/, ''),
      '업체명': vendor,
      '지역': f['지역'] || regionFallback || '',
      '등급': f['등급'] || '',
      '모델명': f['모델명'] || '',
      '시리얼넘버': f['시리얼넘버'] || '',
      '자산기번': f['자산기번'] || '',
      '내용': f['내용'] || '',
      '처리내용': f['처리내용'] || ''
    });
  }
  return out;
}

function extractASFields_(content) {
  const f = {};
  f['업체명'] = extractASField_(content, '업체명', false);
  f['지역'] = extractASField_(content, '지역', false);
  f['모델명'] = extractASField_(content, '모델명', false);
  f['시리얼넘버'] = extractASField_(content, '시리얼넘버', false);
  f['자산기번'] = extractASField_(content, '자산기번', false);
  f['내용'] = extractASField_(content, '내용', true);
  f['처리내용'] = extractASField_(content, '처리내용', true);

  const gm = content.match(/등급\s*:?\s*\(?\s*([^),\n\r]+?)\s*[,)\r\n]/);
  if (gm) {
    const v = gm[1].trim();
    if (v && v !== '1 , 2 , 3' && v !== '1,2,3' && !/^\d?\s*,\s*\d/.test(v)) f['등급'] = v;
  }
  return f;
}

function extractASField_(content, label, multiline) {
  const escLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    '(?:^|[\\r\\n])' + escLabel + '\\s*:?\\s*([\\s\\S]*?)(?=[\\r\\n](?:[^\\r\\n]*?:|-{5,}|※|\\d+\\.\\s*[가-힣]+:))',
    ''
  );
  const match = content.match(pattern);
  if (!match) return '';
  const val = match[1].trim();
  if (!val) return '';
  if (/^(부서명|지역|모델명|시리얼넘버|자산기번|내용|처리내용|매수|토너잔량|폐통|특이사항)\s*:?\s*$/.test(val)) return '';
  return multiline ? val : val.split('\n')[0].trim();
}

function appendASToSheet_(records) {
  const cfg = CONFIG['AS'];
  const ss = SpreadsheetApp.openById(cfg.ssId);
  const sheet = ss.getSheetByName(cfg.sheets[0]);
  if (!sheet) return { added: 0, skipped: records.length, error: 'AS 시트 없음' };

  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const keyCols = ['AS날짜', '업체명', '시리얼넘버', '모델명', '작성자'];
  const norm = v => (v instanceof Date) ? Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd') : String(v || '').trim();
  const keyOf = o => keyCols.map(k => norm(o[k])).join('|');

  const existing = {};
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const idx = {};
    keyCols.forEach(k => { idx[k] = headers.indexOf(k); });
    const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    for (const row of data) {
      const o = {};
      keyCols.forEach(k => { o[k] = idx[k] >= 0 ? row[idx[k]] : ''; });
      existing[keyOf(o)] = true;
    }
  }

  const newRows = [];
  for (const rec of records) {
    const k = keyOf(rec);
    if (existing[k]) continue;
    existing[k] = true;
    newRows.push(headers.map(h => (rec[h] != null ? rec[h] : '')));
  }

  if (newRows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, lastCol).setValues(newRows);
  }
  return { added: newRows.length, skipped: records.length - newRows.length };
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
    messages: [
      { role: 'system', content: buildExtractSystemPrompt_(cat, cols, hint) },
      { role: 'user', content: userText }
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'kakao_records', strict: true, schema: schema }
    }
  };
  // GPT-5/o 계열은 max_completion_tokens 사용 + temperature 고정(기본값만 허용)
  if (/^(gpt-5|o\d)/.test(KAKAO_AI_MODEL)) {
    payload.max_completion_tokens = KAKAO_AI_MAX_TOKENS;
  } else {
    payload.max_tokens = KAKAO_AI_MAX_TOKENS;
    payload.temperature = 0;
  }

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
    for (const c of cols) if (!isBlankVal_(r[c])) obj[c] = r[c];
    out.push({ vendor: vendor, obj: obj, raw: obj['원문'] || '' });
  }
  return out;
}

// 내 OpenAI 계정에서 사용 가능한 모델 ID 목록 출력 (실행 후 로그 확인)
// → 여기 나온 gpt-... ID 중 원하는 걸 KAKAO_AI_MODEL 에 넣으면 된다.
function listOpenAIModels() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
  if (!apiKey) { Logger.log('OPENAI_API_KEY 미설정'); return; }
  const res = UrlFetchApp.fetch('https://api.openai.com/v1/models', {
    method: 'get',
    headers: { 'Authorization': 'Bearer ' + apiKey },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) { Logger.log('오류 ' + res.getResponseCode() + ': ' + res.getContentText()); return; }
  const data = JSON.parse(res.getContentText());
  const ids = (data.data || []).map(m => m.id).filter(id => /^(gpt|o\d|chatgpt)/.test(id)).sort();
  Logger.log('사용 가능한 모델 ' + ids.length + '개:\n' + ids.join('\n'));
}

// AI가 빈 값으로 채우는 표현들("null", "없음" 등)을 빈칸으로 정규화
function isBlankVal_(v) {
  if (v == null) return true;
  const s = String(v).trim().toLowerCase();
  return s === '' || s === 'null' || s === 'n/a' || s === 'na' || s === '-' || s === '.' ||
         s === '없음' || s === '미상' || s === '해당없음' || s === '불명' || s === '확인불가';
}

function buildExtractSystemPrompt_(cat, cols, hint) {
  const lines = [
    '너는 카카오톡 단체방 대화에서 거래처별 "' + cat + '" 정보를 추출·정리하는 전문가다.',
    '하나의 방에 여러 거래처 이야기가 섞여 있다. 각 거래처(업체) 건별로 레코드를 분리해라.',
    '각 레코드는 반드시 "업체명"을 포함한다. 업체명을 알 수 없는 잡담·인사·시스템 메시지는 건너뛴다.',
    '채울 항목: ' + cols.join(', ') + '.',
    '항목 작성 규칙:',
    '- 사실 정보(연락처·날짜·금액·담당자·기종·코드 등): 대화에 실제로 있는 값만 쓰고 없으면 null. 지어내지 마라.',
    '- 분류·유형·항목·감정·요약·분석 성격의 항목(예: 불만유형, 불만항목, 고객감정상태, AI_*, 사실확인, 대안제시, 재발방지 등): 대화 내용을 근거로 네가 적극적으로 판단해 채워라. 명시돼 있지 않아도 맥락으로 추론 가능하면 채운다. 근거가 전혀 없을 때만 null.',
    '- 빈 값은 반드시 JSON null 로 두고 "null","없음" 같은 글자를 값으로 쓰지 마라.',
    '- 항목에 "원문"이 있으면, 그 레코드의 근거가 된 카톡 원문 메시지를 요약하지 말고 그대로(가능하면 작성자 포함) 넣어라. 사람이 "무슨 내용에서 뽑았는지" 확인하는 용도이므로 절대 null로 두지 마라.'
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
