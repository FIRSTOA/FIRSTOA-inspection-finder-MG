/**
 * 거래처 검색 인덱스 캐시 워밍업.
 *
 * 인덱스 캐시(vidx_*)는 VINDEX_CACHE_SEC(6시간) TTL이라, 그 시간 넘게 아무도
 * 검색을 안 하면 만료되어 다음 첫 검색이 시트를 통째로 다시 읽어 느려진다.
 * 이 함수를 시간 트리거(예: 4시간마다)로 돌려 만료 전에 캐시를 강제로 재적재하면,
 * 업무 시간 첫 검색도 항상 캐시 히트로 빠르게 응답한다.
 *
 * 설치: installWarmupTrigger() 를 1회 실행하면 4시간 간격 트리거가 등록된다.
 */

// 캐시를 비우고 즉시 재적재 → TTL 6시간이 새로 시작된다.
function warmVendorIndexCache() {
  try {
    const c = CacheService.getScriptCache();
    const n = Number(c.get('vidx_n_v1') || 0);
    const keys = ['vidx_n_v1'];
    for (let i = 0; i < n; i++) keys.push('vidx_v1_' + i);
    c.removeAll(keys);
  } catch (e) {}
  // 캐시 미스 → 시트 읽어 VINDEX_CACHE_SEC 동안 재적재
  loadVendorIndexRows_();
  Logger.log('warmVendorIndexCache 완료');
}

// 4시간 간격 트리거 등록(중복 방지). GAS 편집기 또는 clasp run 으로 1회 실행.
function installWarmupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'warmVendorIndexCache') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('warmVendorIndexCache').timeBased().everyHours(4).create();
  Logger.log('워밍업 트리거 등록 완료 (4시간 간격)');
}
