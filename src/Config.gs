/**
 * First 통합 DB 앱 - 설정 & 공용 유틸
 *
 * 데이터 흐름 (3층 구조):
 *   [원본]   각 영업 시트 + 카톡 TXT
 *      └─ syncAllToMaster() / ingestKakaoTxt()  ─┐
 *   [통합]   통합시트(MASTER_SS_ID)의 카테고리별 탭   ← 사람이 보는 정규 DB (중복제거 병합)
 *      └─ rebuildIndex()  ─┐
 *   [인덱스] _idx_vendors / _idx_data / _idx_meta   ← 검색·상세조회용 파생 캐시
 *      └─ doGet() search / detail
 */

// === 통합시트 + 인덱스 위치 ===
// 통합 탭(카테고리별 정규 DB)과 검색 인덱스(_idx_*)를 모두 "퍼스트전산 DB 통합시트"에 둔다.
// (기존 GAS통합서칭 시트는 더 이상 사용하지 않음 → 삭제 가능)
const MASTER_SS_ID = '1qA9l4Xu2P8wQyNTJU_jgUq-zbKNb-_-4TtIsHs9rtDI';
const INDEX_SS_ID = MASTER_SS_ID;
const INDEX_VENDORS = '_idx_vendors';
const INDEX_DATA = '_idx_data';
const INDEX_META = '_idx_meta';

const CATEGORIES = ['불만', '미수', '초과', 'PC확장성', '복합기확장성', 'AS', '업체정보', '임대현황표', '재계약', '해지방어', '경영지원'];

const SLOW_CATEGORIES = ['업체정보'];

// 대용량 임대 시트: 매일이 아니라 월요일 새벽에만 원본 재동기화 (검색 인덱스에는 항상 포함)
const LEASE_CATEGORIES = ['업체정보', '임대현황표'];

// 카테고리 → 통합시트 탭 이름
const MASTER_TABS = {
  불만: '불만',
  미수: '미수',
  초과: '초과',
  PC확장성: 'PC확장성',
  복합기확장성: '복합기확장성',
  AS: 'AS',
  업체정보: '임대리스트',
  임대현황표: '임대현황표',
  재계약: '재계약',
  해지방어: '해지방어',
  경영지원: '경영지원'
};

// 통합 탭에서 displayCols 뒤에 붙는 관리용 헬퍼 컬럼
const MASTER_HELPER_COLS = ['_업체명', '_출처', '_원문', '_등록시각', '_dupKey'];

const CACHE_DURATION_SEC = 300;
const FILE_LOOKUP_CACHE_SEC = 600;

const CONFIG = {
  불만: {
    ssNameLatest: '확장성 정보',
    sheets: ['불만-총괄담당자는 홍대경,신정훈'],
    headerRow: 2,
    vendorCol: '업체명',
    metaFields: { date: '날짜' },
    // 카톡(LLM) 적재 시 시트와 겹침 방지용 중복키: 업체명 + 날짜
    dedupKeyFields: ['날짜'],
    displayCols: [
      '날짜', '작성자', '접수/처리', '등급',
      '거래처담당자', '거래처연락처',
      '불만내용', '불만유형', '불만항목', '고객감정상태',
      'AI_불만유형', 'AI_불만항목',
      '사실확인', '대안제시', '재발방지'
    ]
  },

  미수: {
    ssId: '1gc5bcv6GuJ0PV1iXpu0CLBwiAoLJYdBaPqRQCqn4yHU',
    sheets: ['수도권A_김슬기', '수도권B_박수민', '수도권C_이윤아', '수도권D_박지은', '수도권E_박지은'],
    headerRow: 3,
    vendorCol: '거래처명',
    metaFields: { date: '입력일', region: '지역' },
    displayCols: [
      '입력일', '입력자', '거래처코드', '등급',
      '업체담당자', '임대여부', '관리담당자',
      '지역', '주소',
      '미수개월', '미수잔액', '실제 개월수', '실제 잔액',
      '휴대폰번호', '메일주소', '입금약속일',
      '원문'
    ]
  },

  초과: {
    ssId: '1YySH2gK0ZUth4872zCy3pzp1zu8ZM7yAXopvyfTnp-0',
    sheets: ['초과'],
    headerRow: 2,
    vendorCol: '업체명',
    metaFields: { date: '날짜' },
    displayCols: [
      '순번', '날짜', '특이사항', '임대여부', '등급', '접수내용',
      '컬러초과료', '흑백초과료', '합계', '마감방식',
      '자산번호', '모델명',
      '기본금액', '연평균',
      '계약일', '종료일', '남은개월',
      '기본매수', '초과장당금액',
      '미수개월수', '미수금액'
    ]
  },

  PC확장성: {
    ssId: '1Q0u_ok6s3o7_qnSFyDW632zkspV_MqttRnFQ4uurmpg',
    sheets: ['PC 확장성 DB(영업팀장 AI테스트)'],
    headerRow: 1,
    vendorCol: '업체명',
    metaFields: { date: '날짜', region: '지역' },
    displayCols: [
      '날짜', '작성자', '등급',
      '사무/설계/디자인/개발', '세부사양', '지역',
      '업체담당자', '연락처', 'IT담당자',
      '렌탈or구매or유지보수', '지정업체', '지정업체만족도',
      '총 인원', '인원 추가 설명',
      '수량', '금액', '시기', '시기 추가 설명',
      '어필 OR 추가영업', '포인트', '차수'
    ]
  },

  복합기확장성: {
    ssId: '10850TfeSvd0Z1iiI1ycCyGskGRPXicRUd1_Xx996QKQ',
    sheets: ['영업확장성_DB_통합추출_0426_1545'],
    headerRow: 1,
    vendorCol: '상호',
    metaFields: { date: '등록일', region: '미팅지역' },
    displayCols: [
      '순번', '등록일', '년월', '주차', '등록자', '전략영업담당자',
      '상호', '업종', '매출액(억)', '인원수',
      '프로젝트주소', '미팅지역', '도로명주소', '세부주소',
      '키맨성함+직함', '키맨전화번호', '키맨 성향',
      '영업 접근 전략', '의사결정 파급력', '개인 히스토리',
      '프로젝트', '품목(원문)', '연계영업', '관심품목(세분화)',
      '수주 가능성(A/B/C)', '예상 발주금액(만원)',
      '예상 발주시기(YYYY-MM)', '현재 경쟁사/장비',
      '경쟁사 불만(PainPoint)', '계약 종료(예정)일',
      '진행상황(원문)', '최종결과(대기 등)',
      '영업진행상황', '첫등록내용', '특이사항',
      '거래처등급', '영업등급', '체크일',
      '[신규통합] 현재 관리등급',
      '[자동계산] 다음 체크 예정일',
      '[AI 자동완성 개입 여부'
    ]
  },

  AS: {
    ssId: '1-AcARUVMzSY4ln6jRhf751AJ60pTVf-4BAOBhec4hUo',
    sheets: ['AS'],
    headerRow: 1,
    vendorCol: '업체명',
    metaFields: { date: 'AS날짜', region: '지역' },
    displayCols: [
      'AS날짜', '작성자', '지역', '등급',
      '모델명', '시리얼넘버', '자산기번',
      '내용', '처리내용'
    ]
  },

  업체정보: {
    ssId: '1YySH2gK0ZUth4872zCy3pzp1zu8ZM7yAXopvyfTnp-0',
    sheets: ['임대리스트'],
    headerRow: 2,
    vendorCol: '거래처명',
    vendorColFallback: '업체명',
    metaFields: { date: '종료일', region: '시/구' },
    displayCols: [
      '업태',
      '첫계약일', '계약일', '종료일', '남은개월', '계약기간',
      '기본금액', '연평균',
      '등급', '코드', '일반전화',
      '임대여부', '납품/교체일',
      '시리얼번호(기번)', '대수', '기종',
      '주소상세주소', '시/구',
      '추가(컬)', '추가(흑)', '추가조건',
      '누적방식 (월/분/반/년)',
      '미수금액'
    ]
  },

  // 임대현황표(교체) — "공통_납품철수교체현황표"의 gid=0 "전체데이터" 시트.
  // 1행=숫자, 2행="납품 내역" 제목, 3행=실제 헤더 → headerRow=3.
  // 헤더 매칭은 공백/줄바꿈을 무시(normalizeHeader_)하므로 줄바꿈 포함 헤더도 잡힌다.
  임대현황표: {
    ssId: '1Lb1g7yLHbVuXt537abhM1K2ROOoUVjPVVnIChQWSJVg',
    gid: 0,
    headerRow: 3,
    vendorCol: '업체명',
    metaFields: { date: '납품일', region: '지역' },
    displayCols: [
      '순', '구분', '지역', '분류', '년월',
      '납품일', '납품담당', '납품여부', '통합리스트순', '계약서여부',
      '계약기간', '기본료', '품목',
      '유입경로', '유입경로 (자세히)', '매입가', '교체/철수사유 (자세히)',
      '유입담당자 (발굴관리)', '영업담당자', '요청담당자',
      '보증금', '보증금입금확인',
      '교체전기종', '기종', '수량', '담당자', '설치인원', '소요시간', '업종',
      '현황표', '유입발굴 담당팀', '영업 담당팀', '주차',
      '총금액', '금액', '해피콜 내용추가', '매입총액'
    ]
  },

  // ── 카톡 전용 카테고리 (시트 원본 없음, 카톡 TXT로만 적재) ──
  // displayCols는 임시값. 실제 헤더/시트를 받으면 교체하면 AI 추출이 자동으로 맞춰 채운다.
  재계약: {
    kakaoOnly: true,
    sheets: [],
    vendorCol: '업체명',
    metaFields: { date: '날짜' },
    displayCols: ['날짜', '담당팀', '진행상황', '내용', '결과', '원문']
  },

  해지방어: {
    kakaoOnly: true,
    sheets: [],
    vendorCol: '업체명',
    metaFields: { date: '날짜' },
    displayCols: ['날짜', '담당팀', '해지사유', '방어전략', '진행상황', '결과', '내용', '원문']
  },

  경영지원: {
    kakaoOnly: true,
    sheets: [],
    vendorCol: '업체명',
    metaFields: { date: '날짜' },
    displayCols: ['날짜', '담당팀', '요청유형', '내용', '처리결과', '원문']
  }
};

function safeDate(v) {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd');
  }
  return String(v || '').trim();
}

function pad2_(n) {
  n = String(n);
  return n.length < 2 ? '0' + n : n;
}

// 통합 탭 1행 헤더 = displayCols + 헬퍼 컬럼
function masterHeaders_(cat) {
  return CONFIG[cat].displayCols.concat(MASTER_HELPER_COLS);
}

// 헤더 매칭용 정규화: 모든 공백/줄바꿈 제거 (시트 헤더의 줄바꿈·들여쓰기 차이 흡수)
function normalizeHeader_(s) {
  return String(s == null ? '' : s).replace(/\s+/g, '');
}

// 같은 업체 + 같은 표시값이면 동일 레코드로 간주 (시트/카톡 병합 시 중복 제거 키)
// dedupKeyFields가 있으면 그 항목만으로 키를 만든다 (예: 불만 = 업체명+날짜).
function dupKey_(cat, vendor, obj) {
  var parts = [String(vendor || '').trim()];
  var cols = CONFIG[cat].dedupKeyFields || CONFIG[cat].displayCols;
  for (var i = 0; i < cols.length; i++) {
    var v = obj[cols[i]];
    parts.push(v == null ? '' : String(v).trim());
  }
  var raw = parts.join('');
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw, Utilities.Charset.UTF_8);
  var hex = '';
  for (var b = 0; b < bytes.length; b++) {
    var n = bytes[b] < 0 ? bytes[b] + 256 : bytes[b];
    hex += (n < 16 ? '0' : '') + n.toString(16);
  }
  return hex;
}

function resolveSsId(cfg) {
  if (cfg.ssId) return cfg.ssId;
  if (!cfg.ssNameLatest) throw new Error('ssId 또는 ssNameLatest 필요');

  const cache = CacheService.getScriptCache();
  const cacheKey = 'fileid_' + cfg.ssNameLatest;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const files = DriveApp.getFilesByName(cfg.ssNameLatest);
  let latest = null;
  let latestTime = 0;

  while (files.hasNext()) {
    const f = files.next();
    if (f.isTrashed()) continue;
    const t = f.getLastUpdated().getTime();
    if (t > latestTime) {
      latestTime = t;
      latest = f;
    }
  }

  if (!latest) throw new Error('파일 못 찾음: ' + cfg.ssNameLatest);

  const id = latest.getId();
  cache.put(cacheKey, id, FILE_LOOKUP_CACHE_SEC);
  return id;
}

function openSpreadsheet(cfg) {
  return SpreadsheetApp.openById(resolveSsId(cfg));
}
