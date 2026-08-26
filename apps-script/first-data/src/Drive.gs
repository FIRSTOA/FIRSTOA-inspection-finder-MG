/**
 * 드라이브 폴더 자동 적재.
 * 카톡 내보내기(.txt)를 "수신함" 폴더에 저장하면(구글드라이브 데스크톱 동기화),
 * 시간 트리거가 그 폴더의 새 파일을 읽어 방 이름으로 분류·적재한다.
 *  - 처리 성공 → "처리됨" 하위 폴더로 이동
 *  - 방 이름 매칭 실패 → "확인필요" 하위 폴더로 이동 (쌓지 않음)
 * 사람은 "카톡 내보내기 → 수신함 저장"까지만. 나머지는 자동.
 */

const DRIVE_INBOX_PROP = 'kakao_inbox_folder_id';
const DRIVE_INBOX_NAME = '카톡 자동적재 수신함';
const DRIVE_INTERVAL_PROP = 'kakao_inbox_interval';   // 화면 표시용 주기 라벨

// 자동적재 트리거 1개만 남기고 지정 주기로 재생성. (Apps Script는 기존 주기를 못 읽어오므로
// 주기는 항상 여기서 설정·기록한다 → 화면 표시와 항상 일치)
function setDriveIngestInterval(unit) {
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === 'ingestFromDriveFolder') ScriptApp.deleteTrigger(t);
    });
    const b = ScriptApp.newTrigger('ingestFromDriveFolder').timeBased();
    let label;
    if (unit === 'day') { b.everyDays(1).atHour(7); label = '하루마다 (새벽 7시)'; }
    else if (unit === '6hour') { b.everyHours(6); label = '6시간마다'; }
    else if (unit === '2hour') { b.everyHours(2); label = '2시간마다'; }
    else { b.everyHours(1); label = '1시간마다'; }
    b.create();
    PropertiesService.getScriptProperties().setProperty(DRIVE_INTERVAL_PROP, label);
    return { ok: true, interval: label };
  } catch (err) { return { ok: false, error: err.toString() }; }
}

function getOrCreateSub_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

// 수신함(+처리됨/확인필요 하위) 폴더 확보. ID는 스크립트 속성에 저장.
function ensureInboxFolder_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty(DRIVE_INBOX_PROP);
  let folder = null;
  if (id) { try { folder = DriveApp.getFolderById(id); } catch (e) { folder = null; } }
  if (!folder) {
    folder = DriveApp.createFolder(DRIVE_INBOX_NAME);
    props.setProperty(DRIVE_INBOX_PROP, folder.getId());
  }
  return { folder: folder, done: getOrCreateSub_(folder, '처리됨'), hold: getOrCreateSub_(folder, '확인필요') };
}

// 카톡 내보내기 인코딩 자동 판별(PC=UTF-16, 모바일=UTF-8). BOM 기준. (Apps Script byte는 부호 있음)
function readDriveFileText_(file) {
  const bytes = file.getBlob().getBytes();
  let charset = 'UTF-8';
  if (bytes.length >= 2 && bytes[0] === -1 && bytes[1] === -2) charset = 'UTF-16LE';      // FF FE
  else if (bytes.length >= 2 && bytes[0] === -2 && bytes[1] === -1) charset = 'UTF-16BE'; // FE FF
  let s;
  try { s = Utilities.newBlob(bytes).getDataAsString(charset); }
  catch (e) { s = Utilities.newBlob(bytes).getDataAsString('UTF-8'); }
  if (s && s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  return s || '';
}

// 첫 줄 "OOO 님과 카카오톡 대화"에서 방 이름 추출
function extractRoomNameServer_(text) {
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < Math.min(lines.length, 12); i++) {
    const m = lines[i].match(/^﻿?\s*(.+?)\s*님과(?:의)?\s*카카오톡\s*대화/);
    if (m) return m[1].trim();
  }
  return '';
}

function modeForCategory_(cat) {
  if (cat === 'AS') return 'asform';
  if (cat === '점검') return 'inspectform';
  return 'ai';
}

// 증분: 직전 처리 끝부분(앵커)을 새 파일에서 찾아 그 뒤만 넘긴다. (클라이언트 일괄 업로드와 동일 키 공유)
function sliceIncremental_(key, text) {
  try {
    const cur = getUploadCursor(key);
    if (cur && cur.ok && cur.anchor && cur.anchor.length >= 20) {
      const pos = text.lastIndexOf(cur.anchor);
      if (pos >= 0) {
        const anchorEnd = pos + cur.anchor.length;
        if (anchorEnd >= text.length) return { text: '', nothingNew: true };
        // 앵커 앞부분은 "이미 처리했다"고 보고 건너뛴다. 첫 업로드가 부분 내보내기였다면 그 기간은 영구 누락되므로
        // 얼마나 건너뛰었는지 남긴다(관리탭 수집 로그에서 보인다). 되살리려면 앵커 초기화 후 재업로드.
        return { text: text.slice(Math.max(0, anchorEnd - 3000)), isTail: true, skippedChars: Math.max(0, anchorEnd - 3000) };
      }
    }
  } catch (e) {}
  return { text: text, isTail: false };
}
function saveAnchor_(key, fullText) {
  try { setUploadCursor(key, fullText.slice(Math.max(0, fullText.length - 300))); } catch (e) {}
}

// 메인: 수신함의 .txt를 전부 처리. 트리거(시간) 또는 화면 "지금 적재" 버튼이 호출.
/** 확인필요 폴더의 TXT를 수집함으로 되돌린다(실패 원인을 고친 뒤 재시도용). */
function retryHeldFiles() {
  try {
    const f = ensureInboxFolder_();
    const moved = [];
    const it = f.hold.getFiles();
    while (it.hasNext()) {
      const file = it.next();
      if (!/\.txt$/i.test(file.getName())) continue;
      file.moveTo(f.folder);
      moved.push(file.getName());
    }
    return { ok: true, moved: moved.length, files: moved };
  } catch (err) { return { ok: false, error: err.toString() }; }
}

function ingestFromDriveFolder() {
  const f = ensureInboxFolder_();
  const mapRes = getRoomMap();
  const map = {};
  if (mapRes && mapRes.ok) mapRes.rows.forEach(function (r) { map[r.roomName] = r; });

  const files = [];
  const it = f.folder.getFiles();
  while (it.hasNext()) {
    const file = it.next();
    if (/\.txt$/i.test(file.getName())) files.push(file);
  }

  let added = 0, done = 0, held = 0, failed = 0, queuedAny = false;
  // 처리할 파일이 있으면 "이어달리기" 트리거를 미리 걸어 둔다 — 실행이 6분 한도로 강제 종료돼도 스스로 다시 시작한다.
  // (예전엔 강제 종료되면 아무도 이어받지 않아 수집이 조용히 멈췄다)
  const deadline = Date.now() + 3 * 60 * 1000; // GAS 6분 한도 — 3분까지만 새 배치를 시작한다(배치 한 번이 오래 걸려도 여유가 남게)
  if (files.length) scheduleDriveContinue_(4 * 60 * 1000);
  for (const file of files) {
    try {
      const text = readDriveFileText_(file);
      const room = extractRoomNameServer_(text);
      const route = room ? map[room] : null;

      if (!route) {
        held++;
        logUpload({ category: '확인필요', team: '', roomName: room || file.getName(), parsed: 0, added: 0, skipped: 0, status: '확인필요(드라이브·미등록)' });
        file.moveTo(f.hold);
        continue;
      }

      const mode = modeForCategory_(route.category);

      // 재계약방: "초과업체조정" 폼 별도 캡처(전체 text 스캔, dupKey 중복방어로 재스캔 안전).
      // nothingNew/mode 와 무관하게 항상 실행 → 과거분·재업로드도 누락 없이 잡힘. 결과는 별도 로그.
      if (route.category === '재계약') {
        try {
          const oa = captureOverageAdjust_(text, route.team);
          if (oa && oa.added) logUpload({ category: '초과업체조정', team: route.team, roomName: room, parsed: (oa.added + (oa.skipped || 0)), added: oa.added, skipped: oa.skipped || 0, status: '완료(드라이브·분리캡처)' });
        } catch (e) {}
      }

      // 파일은 항상 처음부터 끝까지 읽는다 — 중복은 _dupKey(점검·AS)와 메시지 해시(AI 방)가 걸러준다.
      // 예전에는 "직전 업로드의 마지막 300자"를 앵커로 삼아 그 앞을 버렸는데, 첫 업로드가 부분 내보내기였으면
      // 그 앞 기간이 전체 파일을 다시 올려도 영구히 안 들어왔다 (2026-08-26 D 점검방 3,846건 실사고).
      let res;
      if (mode === 'asform' || mode === 'inspectform') {
        res = ingestFormsResumable_(mode, route, text, file.getId(), deadline);
      } else {
        res = kakaoEnqueue(route.category, route.team, text);
      }

      if (!res || !res.ok) throw new Error(res && res.error ? res.error : '적재 실패');

      let status;
      if (mode === 'ai') { status = res.batches ? '대기열 등록(드라이브)' : '새 메시지 없음'; if (res.batches) queuedAny = true; }
      else {
        added += (res.added || 0);
        status = res.pending ? ('이어서 처리 (' + res.at + '/' + res.parsed + '번째 메시지까지)')
          : (res.fresh === 0 ? '새 메시지 없음' : '완료(드라이브)');
      }
      done++;

      logUpload({ category: route.category, team: route.team, roomName: room, parsed: res.parsed || 0, added: res.added || 0, skipped: res.skipped || 0, status: status });
      // 시간이 모자라 중간에서 멈췄으면 파일을 그대로 두고 1분 뒤 이어서 처리한다
      if (res.pending) { scheduleDriveContinue_(); break; }
      file.moveTo(f.done);
    } catch (err) {
      failed++;
      logUpload({ category: '오류', team: '', roomName: file.getName(), parsed: 0, added: 0, skipped: 0, status: '실패(드라이브): ' + String(err).slice(0, 60) });
      try { file.moveTo(f.hold); } catch (e) {}
    }
  }

  if (queuedAny) { try { kakaoStartWorker(); } catch (e) {} }
  // 남은 파일이 없으면 이어달리기 트리거를 지운다(무한 반복 방지)
  try {
    let left = 0; const it2 = f.folder.getFiles();
    while (it2.hasNext()) { if (/\.txt$/i.test(it2.next().getName())) left++; }
    if (!left) ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === 'driveIngestContinue') ScriptApp.deleteTrigger(t);
    });
  } catch (e) {}
  Logger.log('드라이브 자동적재: 파일 ' + files.length + ' / 처리 ' + done + ' / 신규 ' + added + ' / 확인필요 ' + held + ' / 실패 ' + failed);
  return { ok: true, files: files.length, done: done, added: added, held: held, failed: failed };
}

/**
 * 점검·AS 양식 파일을 처음부터 끝까지 적재한다. 큰 파일(수 MB·수천 건)은 GAS 6분 한도에 걸리므로
 * 메시지 4,000개씩 나눠 처리하고, 시간이 모자라면 "몇 번째 메시지까지 했는지"를 저장해 다음 실행에서 이어간다.
 * 중복은 appendKakaoRecords_ 의 _dupKey 판정이 걸러주므로 같은 파일을 다시 올려도 안전하다.
 */
const FORM_BATCH_MSGS = 1500; // 한 배치가 커지면 6분 한도에 강제 종료돼 진행이 멈춘다(2026-08-27)
function ingestFormsResumable_(mode, route, text, fileId, deadline) {
  const messages = parseKakaoMessages_(String(text));
  if (!messages.length) {
    return { ok: false, error: '카톡 메시지 파싱 0건 (수신 ' + String(text || '').length + '자)' };
  }
  const key = 'progress|' + route.category + '|' + route.team + '|' + fileId;
  const cur = getUploadCursor(key);
  let at = parseInt(String((cur && cur.anchor) || '0'), 10) || 0;
  // 이미 처리한 메시지는 지문(해시)으로 건너뛴다 — 매번 전체 파일을 다시 뜯지 않게(AI 방과 같은 방식).
  // 위치가 아니라 메시지 단위라, 파일 앞부분에 처음 보는 옛 메시지가 있으면 그건 정상적으로 들어온다.
  const seenRoom = route.category + '|' + route.team;
  const seen = loadSeenHashes_(seenRoom);
  let added = 0, skipped = 0, records = 0, fresh = 0;
  while (at < messages.length) {
    const slice = messages.slice(at, at + FORM_BATCH_MSGS);
    const newMsgs = [], newHashes = [];
    for (let i = 0; i < slice.length; i++) {
      const hh = msgHash_(seenRoom, slice[i]);
      if (seen[hh]) continue;
      seen[hh] = true;
      newMsgs.push(slice[i]); newHashes.push(hh);
    }
    fresh += newMsgs.length;
    const recs = newMsgs.length
      ? (mode === 'asform' ? extractASFormsFull_(newMsgs, route.team) : extractInspectForms_(newMsgs, route.team))
      : [];
    records += recs.length;
    if (recs.length) {
      const r = appendKakaoRecords_(route.category, route.category, route.team, recs);
      added += r.added; skipped += r.skipped;
    }
    if (newHashes.length) appendSeenHashes_(seenRoom, newHashes);
    at += slice.length;
    setUploadCursor(key, String(at)); // 배치마다 저장 — 6분 한도로 강제 종료돼도 여기서 이어간다
    if (at < messages.length && Date.now() > deadline) {
      return { ok: true, pending: true, at: at, parsed: messages.length, fresh: fresh, records: records, added: added, skipped: skipped };
    }
  }
  resetUploadCursor(key); // 다 끝났으니 진행 표시 삭제
  return { ok: true, at: at, parsed: messages.length, fresh: fresh, records: records, added: added, skipped: skipped };
}

/** 중간에서 멈춘 파일을 1분 뒤 이어서 처리 (정기 트리거와 별도 핸들러라 서로 지우지 않는다) */
function driveIngestContinue() { ingestFromDriveFolder(); }
function scheduleDriveContinue_(afterMs) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'driveIngestContinue') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('driveIngestContinue').timeBased().after(afterMs || 60 * 1000).create();
}

// 폴더 URL/ID에서 폴더 ID 추출
function parseFolderId_(input) {
  input = String(input || '').trim();
  const m = input.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{12,}$/.test(input)) return input;   // 원시 ID
  return '';
}

// 적재 폴더를 지정한 폴더(공유 드라이브 등)로 변경. 해당 폴더에 처리됨/확인필요 하위폴더를 만든다.
// 주의: 스크립트 계정(first@firstoa-ai.com)이 그 공유 드라이브의 멤버(콘텐츠 관리자/편집)여야 한다.
function setDriveInboxFolder(input) {
  try {
    const id = parseFolderId_(input);
    if (!id) return { ok: false, error: '폴더 URL/ID를 인식하지 못했습니다. (예: https://drive.google.com/drive/folders/XXXX)' };
    let folder;
    try { folder = DriveApp.getFolderById(id); } catch (e) { return { ok: false, error: '폴더를 열 수 없습니다 — 공유 드라이브 접근 권한을 확인하세요. (' + String(e).slice(0, 100) + ')' }; }
    // 하위 폴더 생성 가능 여부까지 확인(권한 검증)
    let done, hold;
    try { done = getOrCreateSub_(folder, '처리됨'); hold = getOrCreateSub_(folder, '확인필요'); }
    catch (e) { return { ok: false, error: '이 폴더에 하위폴더를 만들 권한이 없습니다 — 공유 드라이브에서 first@firstoa-ai.com을 콘텐츠 관리자/편집자로 추가하세요. (' + String(e).slice(0, 80) + ')' }; }
    PropertiesService.getScriptProperties().setProperty(DRIVE_INBOX_PROP, id);
    // 트리거 없으면 같이 켜준다
    const exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'ingestFromDriveFolder'; });
    if (!exists) {
      ScriptApp.newTrigger('ingestFromDriveFolder').timeBased().everyHours(1).create();
      PropertiesService.getScriptProperties().setProperty(DRIVE_INTERVAL_PROP, '1시간마다');
    }
    return { ok: true, folderUrl: folder.getUrl(), name: folder.getName(), triggerCreated: !exists };
  } catch (err) { return { ok: false, error: err.toString() }; }
}

// 자동 적재 켜기: 수신함 폴더 생성 + 1시간 트리거 등록 (메뉴/화면에서 1회 실행)
function setupDriveIngest() {
  const f = ensureInboxFolder_();
  const exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'ingestFromDriveFolder'; });
  if (!exists) {
    ScriptApp.newTrigger('ingestFromDriveFolder').timeBased().everyHours(1).create();
    PropertiesService.getScriptProperties().setProperty(DRIVE_INTERVAL_PROP, '1시간마다');
  }
  return { ok: true, folderUrl: f.folder.getUrl(), folderId: f.folder.getId(), triggerCreated: !exists };
}

function disableDriveIngest() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'ingestFromDriveFolder') { ScriptApp.deleteTrigger(t); n++; }
  });
  return { ok: true, removed: n };
}

// 화면용 상태: 자동적재 켜졌는지 / 폴더 링크 / 대기 중 파일 수
function getDriveInboxInfo() {
  try {
    const props = PropertiesService.getScriptProperties();
    const id = props.getProperty(DRIVE_INBOX_PROP);
    const hasTrigger = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'ingestFromDriveFolder'; });
    if (!id) return { ok: true, enabled: false, hasTrigger: hasTrigger };
    let folder;
    try { folder = DriveApp.getFolderById(id); } catch (e) { return { ok: true, enabled: false, hasTrigger: hasTrigger }; }
    let pending = 0;
    const it = folder.getFiles();
    while (it.hasNext()) { if (/\.txt$/i.test(it.next().getName())) pending++; }
    const interval = props.getProperty(DRIVE_INTERVAL_PROP) || '';
    return { ok: true, enabled: true, hasTrigger: hasTrigger, folderUrl: folder.getUrl(), pending: pending, interval: interval };
  } catch (err) { return { ok: false, error: err.toString() }; }
}
