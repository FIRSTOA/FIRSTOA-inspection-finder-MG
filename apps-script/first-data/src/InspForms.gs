/**
 * 점검검색 완전체앱(inspection-finder-MG) 전용 엔드포인트.
 *
 * action=inspforms&q=<거래처명>
 *   - 점검 마스터 탭에서 구분별(점검 / 점검+AS) "최근 1건"의 _원문(카톡 양식 전문)을 반환.
 *   - AS 마스터 탭에서 "최근 1건"의 요약(모델/시리얼/내용/처리내용)을 반환 (AS탭은 _원문이 비어있는 설계).
 * 통합이력(다른 카테고리 전체)은 기존 search/detail 을 그대로 쓴다 — 여기선 양식 재사용 소스만 담당.
 *
 * 성능: 무거운 _원문 본문은 매번 전체를 읽지 않는다. _원문 앞쪽 컬럼만 스캔해
 *       구분별 최신 행 번호를 찾은 뒤, 당첨된 1~2개 행의 _원문 셀만 단건으로 읽는다.
 */

// 구분 표기 정규화 → '점검' | '점검+AS' | 'AS' | '기타'
// (등급/레이드 누수,  , 공백, 마침표, 대소문자, 점검,AS·점검/as·AS 및 점검 등 변형 흡수)
function classifyGubun_(g) {
  g = String(g == null ? '' : g).split('등급')[0].split('레이드')[0];
  g = g.replace(/ /g, '').replace(/[.\s]/g, '').toLowerCase();
  var hasJ = g.indexOf('점검') !== -1;
  var hasA = g.indexOf('as') !== -1;
  if (hasJ && hasA) return '점검+AS';
  if (hasA) return 'AS';
  if (hasJ) return '점검';
  return '기타';
}

// _원문에서 기기 대수 추정 (모델명 라인 개수). 없으면 1.
function deviceCount_(text) {
  var n = (String(text || '').match(/모델명/g) || []).length;
  return n > 0 ? n : 1;
}

function getInspectionFormsByVendor(vendor) {
  vendor = String(vendor || '').trim();
  if (!vendor) return { vendor: '', forms: [] };

  var cache = CacheService.getScriptCache();
  var cacheKey = 'inspforms_v1_' + vendor.substring(0, 200);
  var cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  var ss = SpreadsheetApp.openById(MASTER_SS_ID);
  var forms = [];

  // ── 점검 탭: 구분별(점검 / 점검+AS) 최근 1건 + _원문 전문 ──
  var insp = ss.getSheetByName(MASTER_TABS['점검']);
  if (insp && insp.getLastRow() > 1) {
    var n = insp.getLastRow() - 1;
    var lastCol = insp.getLastColumn();
    var H = insp.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
    var cDate = H.indexOf('작성일');
    var cGubun = H.indexOf('구분');
    var cModel = H.indexOf('모델명');
    var cAuthor = H.indexOf('작성자');
    var cRegion = H.indexOf('지역');
    var cVendor = H.indexOf('_업체명');
    var cWon = H.indexOf('_원문');

    if (cVendor !== -1 && cGubun !== -1) {
      // _원문 컬럼 직전까지만 읽어 무거운 본문 로딩 회피 (못 찾으면 전체)
      var scanCols = cWon > 0 ? cWon : lastCol;
      var data = insp.getRange(2, 1, n, scanCols).getValues();

      // 점검/점검+AS 를 모두 '점검'으로 모아 최신순 정렬 → 최근 N건 (청정기 등 옛 점검도 고를 수 있게)
      var rows = [];
      for (var i = 0; i < data.length; i++) {
        if (String(data[i][cVendor] || '').trim() !== vendor) continue;
        var cls = classifyGubun_(data[i][cGubun]);
        if (cls !== '점검' && cls !== '점검+AS') continue;
        rows.push({
          rowNum: i + 2,
          date: cDate !== -1 ? safeDate(data[i][cDate]) : '',
          model: cModel !== -1 ? String(data[i][cModel] || '').trim() : '',
          author: cAuthor !== -1 ? String(data[i][cAuthor] || '').trim() : '',
          region: cRegion !== -1 ? String(data[i][cRegion] || '').trim() : ''
        });
      }
      rows.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
      rows.slice(0, 6).forEach(function (r) {
        var won = cWon !== -1 ? String(insp.getRange(r.rowNum, cWon + 1).getValue() || '') : '';
        forms.push({
          gubun: '점검', date: r.date, model: r.model,
          author: r.author, region: r.region, count: deviceCount_(won),
          text: won, source: '점검'
        });
      });
    }
  }

  // ── AS 탭(점검과 동일 풀구조): 최근 1건. 카톡 적재분은 _원문 있어 불러오기 가능, 과거 이관분은 요약만. ──
  var asSheet = ss.getSheetByName(MASTER_TABS['AS']);
  if (asSheet && asSheet.getLastRow() > 1) {
    var an = asSheet.getLastRow() - 1;
    var aLast = asSheet.getLastColumn();
    var AH = asSheet.getRange(1, 1, 1, aLast).getValues()[0].map(function (h) { return String(h).trim(); });
    var aDate = AH.indexOf('작성일');
    if (aDate === -1) aDate = AH.indexOf('AS날짜'); // 이관 전 호환
    var aVendor = AH.indexOf('_업체명');

    if (aVendor !== -1) {
      // 업체명 + 날짜 컬럼만 좁게 읽어 최신순 정렬 → 최근 N건
      var aV = asSheet.getRange(2, aVendor + 1, an, 1).getValues();
      var aD = aDate !== -1 ? asSheet.getRange(2, aDate + 1, an, 1).getValues() : null;
      var arows = [];
      for (var j = 0; j < an; j++) {
        if (String(aV[j][0] || '').trim() !== vendor) continue;
        arows.push({ rowNum: j + 2, date: aD ? safeDate(aD[j][0]) : '' });
      }
      arows.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
      arows.slice(0, 4).forEach(function (r) {
        var rowVals = asSheet.getRange(r.rowNum, 1, 1, aLast).getValues()[0];
        var get = function (name) { var idx = AH.indexOf(name); return idx >= 0 ? String(rowVals[idx] || '').trim() : ''; };
        var asWon = get('_원문');
        forms.push({
          gubun: 'AS', date: r.date, source: 'AS', text: asWon,
          model: get('모델명'), serial: get('시리얼넘버'), asset: get('자산기번'),
          content: get('내용'), handled: get('처리내용'),
          author: get('작성자'), region: get('지역'), count: deviceCount_(asWon)
        });
      });
    }
  }

  var result = { vendor: vendor, forms: forms };
  try { cache.put(cacheKey, JSON.stringify(result), CACHE_DURATION_SEC); } catch (e) {}
  return result;
}
