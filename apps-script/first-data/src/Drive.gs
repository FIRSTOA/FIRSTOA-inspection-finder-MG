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
        return { text: text.slice(Math.max(0, anchorEnd - 3000)), isTail: true };
      }
    }
  } catch (e) {}
  return { text: text, isTail: false };
}
function saveAnchor_(key, fullText) {
  try { setUploadCursor(key, fullText.slice(Math.max(0, fullText.length - 300))); } catch (e) {}
}

// 메인: 수신함의 .txt를 전부 처리. 트리거(시간) 또는 화면 "지금 적재" 버튼이 호출.
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
      const key = route.category + '|' + route.team + '|' + mode;
      const sl = sliceIncremental_(key, text);

      let res;
      if (sl.nothingNew) {
        res = { ok: true, added: 0, nothingNew: true, parsed: 0, skipped: 0 };
      } else if (mode === 'asform') {
        res = ingestASFormsUpload(sl.text, route.team);
      } else if (mode === 'inspectform') {
        res = ingestInspectFormsUpload(sl.text, route.team);
      } else {
        res = kakaoEnqueue(route.category, route.team, sl.text);
      }

      if (!res || !res.ok) throw new Error(res && res.error ? res.error : '적재 실패');
      saveAnchor_(key, text);

      let status;
      if (sl.nothingNew) status = '새 내용 없음';
      else if (mode === 'ai') { status = res.batches ? '대기열 등록(드라이브)' : '새 메시지 없음'; if (res.batches) queuedAny = true; }
      else { added += (res.added || 0); status = '완료(드라이브)'; }
      done++;

      logUpload({ category: route.category, team: route.team, roomName: room, parsed: res.parsed || 0, added: res.added || 0, skipped: res.skipped || 0, status: status });
      file.moveTo(f.done);
    } catch (err) {
      failed++;
      logUpload({ category: '오류', team: '', roomName: file.getName(), parsed: 0, added: 0, skipped: 0, status: '실패(드라이브): ' + String(err).slice(0, 60) });
      try { file.moveTo(f.hold); } catch (e) {}
    }
  }

  if (queuedAny) { try { kakaoStartWorker(); } catch (e) {} }
  Logger.log('드라이브 자동적재: 파일 ' + files.length + ' / 처리 ' + done + ' / 신규 ' + added + ' / 확인필요 ' + held + ' / 실패 ' + failed);
  return { ok: true, files: files.length, done: done, added: added, held: held, failed: failed };
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
