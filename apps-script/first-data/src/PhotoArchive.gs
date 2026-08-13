/**
 * 사진 드라이브 아카이브 — Supabase Storage(photos)의 오래된 사진을 이 계정(firstoa95)의
 * 드라이브로 옮기고 스토리지에서 지운다.
 *
 * 왜 GAS인가: 구글이 서비스 계정의 드라이브 저장 용량을 없애서(엣지에서 직접 업로드 불가,
 * "Service Accounts do not have storage quota"), 사용자 계정으로 실행되는 GAS가 저장을 맡는다.
 * 파일 소유자 = firstoa95 → 용량도 이 계정 것을 쓴다.
 *
 * 호출: 웹앱 ?action=photoarchive&limit=40&days=90  (수동은 CS웹앱/엣지에서, 정기는 pg_cron→엣지 경유)
 * 순서: 다운로드 → 드라이브 저장 → photo_assets 매핑 기록 → 스토리지 삭제.
 *       매핑 기록이 성공하기 전에는 절대 지우지 않는다.
 * 앨범(?album=) 링크는 get_photo_album이 드라이브 썸네일로 폴백하므로 계속 열린다.
 */

var PHOTO_ARCHIVE_FOLDER_PROP = 'PHOTO_ARCHIVE_FOLDER_ID';

function photoArchiveFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PHOTO_ARCHIVE_FOLDER_PROP);
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* 삭제됐으면 아래에서 재생성 */ }
  }
  var folder = DriveApp.createFolder('CS웹앱 사진보관');
  // 팀원이 앨범 썸네일을 보려면 링크-뷰어가 필요하다 (하위 파일에 상속)
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  props.setProperty(PHOTO_ARCHIVE_FOLDER_PROP, folder.getId());
  return folder;
}

function photoMonthFolder_(root, ym) {
  var it = root.getFoldersByName(ym);
  return it.hasNext() ? it.next() : root.createFolder(ym);
}

function photoArchiveRun_(limitParam, daysParam) {
  var key = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_KEY') || '';
  if (!key) return { error: 'SUPABASE_SERVICE_KEY 미설정' };
  var headers = { apikey: key, Authorization: 'Bearer ' + key };
  var limit = Math.min(Math.max(Number(limitParam) || 40, 1), 200);
  var days = Math.min(Math.max(Number(daysParam) || 90, 7), 3650);
  var cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString();

  var listUrl = SUPABASE_URL + '/rest/v1/photo_assets?drive_file_id=is.null&created_at=lt.' + encodeURIComponent(cutoff) +
    '&select=id,album_id,storage_path,public_url,file_name,mime_type,created_at,photo_albums(vendor,source_type)' +
    '&order=created_at.asc&limit=' + limit;
  var assets = JSON.parse(UrlFetchApp.fetch(listUrl, { headers: headers, muteHttpExceptions: true }).getContentText() || '[]');
  if (!assets.length) return { ok: true, processed: 0, archived: 0, failed: 0, remainingHint: false };

  var root = photoArchiveFolder_();
  var started = Date.now();
  var archived = 0, failed = 0, errors = [];

  for (var i = 0; i < assets.length; i++) {
    if (Date.now() - started > 270 * 1000) break; // GAS 6분 한도 전에 멈춤 — 남은 건 다음 호출
    var a = assets[i];
    try {
      var dl = UrlFetchApp.fetch(SUPABASE_URL + '/storage/v1/object/photos/' + a.storage_path, { headers: headers, muteHttpExceptions: true });
      if (dl.getResponseCode() === 404) {
        UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/photo_assets?id=eq.' + a.id, {
          method: 'patch', headers: headers, contentType: 'application/json',
          payload: JSON.stringify({ archive_error: 'storage 404 — 원본 없음' }), muteHttpExceptions: true,
        });
        failed++; errors.push({ id: a.id, error: 'storage 404' });
        continue;
      }
      if (dl.getResponseCode() !== 200) throw new Error('다운로드 실패(' + dl.getResponseCode() + ')');

      var album = a.photo_albums || {};
      if (Object.prototype.toString.call(album) === '[object Array]') album = album[0] || {};
      var base = a.file_name || String(a.storage_path).split('/').pop() || 'photo.jpg';
      var name = [String(album.vendor || '').replace(/[\\/:*?"<>|#]+/g, ' ').trim().slice(0, 60),
                  String(album.source_type || '').trim(), base].filter(function (x) { return x; }).join('_');
      var blob = dl.getBlob().setName(name);
      if (a.mime_type) blob.setContentType(a.mime_type);
      var ym = String(a.created_at || '').slice(0, 7) || 'unknown';
      var file = photoMonthFolder_(root, ym).createFile(blob);

      // 매핑 기록이 성공한 뒤에만 스토리지에서 지운다
      var patch = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/photo_assets?id=eq.' + a.id, {
        method: 'patch', headers: headers, contentType: 'application/json',
        payload: JSON.stringify({ drive_file_id: file.getId(), archived_at: new Date().toISOString(), archive_error: null }),
        muteHttpExceptions: true,
      });
      if (patch.getResponseCode() >= 300) throw new Error('매핑 기록 실패(' + patch.getResponseCode() + ') — 스토리지 삭제 보류');
      UrlFetchApp.fetch(SUPABASE_URL + '/storage/v1/object/photos/' + a.storage_path, { method: 'delete', headers: headers, muteHttpExceptions: true });
      archived++;
    } catch (err) {
      failed++;
      var msg = String(err && err.message || err).slice(0, 200);
      errors.push({ id: a.id, error: msg });
      UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/photo_assets?id=eq.' + a.id, {
        method: 'patch', headers: headers, contentType: 'application/json',
        payload: JSON.stringify({ archive_error: msg }), muteHttpExceptions: true,
      });
    }
  }
  return { ok: true, processed: assets.length, archived: archived, failed: failed,
           remainingHint: assets.length === limit, folderId: root.getId(), errors: errors.slice(0, 5) };
}
