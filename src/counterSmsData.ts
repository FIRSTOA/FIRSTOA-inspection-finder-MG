/**
 * 카운터 문자전송 — 기본 문구 데이터 (직원 원본 프로젝트 message_settings 이식)
 * 화면·파서와 분리해 둔다: 기종 문구나 인사말만 고칠 때 다른 파일을 건드리지 않게.
 */

const txtSindo = "기기 메뉴버튼 → 화면 윗쪽 카운터 버튼 → 목록인쇄 → 시작 누르시면 출력물 하나 나옵니다. 인쇄물 캡쳐본 문자로 부탁드립니다.";
const txtEcosys = "기기 화면 좌측 하단 시스템메뉴/카운터 버튼 누르신 후 → 리포트 → 리포트 인쇄 → 스테이터스페이지 인쇄 하시면 출력물이 나옵니다. 캡쳐 후 문자로 부탁드립니다.";
const txt305 = "1. 기계확인/사양설정 → 2. 리포트 → 프린터사용량 ok 누르신 후 리포트 캡쳐본 문자로 부탁드립니다.";
const txt5473 = "사용량확인차 문자남겼습니다 확인방법 - 장치설정 > 보고서 > 시스템 > 인쇄집계결과 > 예 > 확인 누르면 출력물 하나 나옵니다 출력물 사진찍어서 문자발송 부탁드립니다.";
const txtApeos = "기계확인 버튼 → 사용매수 확인 눌러서 일련번호와 현재사용매수 나온 화면 캡쳐 후 문자로 부탁드립니다.";
const txt5700 = "(오른쪽 위) 연장 표시 → 모든 설정 → (밑으로 내리고) 보고서 인쇄 → (밑으로) 프린터 설정 (4장 중에 3 페이지만 문자 보냅니다.)";
const txtL5100 = "+ 누르면 Machine info 누르고 ok → Print settings ok 누른 후 go(시작버튼) 누르셔서 나오는 4장 중 3번째 장만 문자로 부탁드립니다.";
const txtRicoh = "사용자도구 클릭 → 카운터 클릭 → 카운터 목록인쇄클릭 (인쇄물 출력 후 발송 부탁드립니다.)";
const txt5005 = "사양설정 > 리포트 > 기능설정리스트 확인 후 문자로 부탁드립니다.";
const txtSamMx6 = "홈 화면에서 우측으로 넘기시고, 보고서-구성/상태 페이지-사용페이지-프린트모양 인쇄버튼 누르고 사진찍어 보내주시면 됩니다.";
const txtSamKeypad = "복사기 숫자 키패드 위 카운터 클릭 후 화면에서 인쇄 눌러주시고 나온 출력물 사진찍어 보내주시면 됩니다.";
const txtSamXk47 = "설정 → 왼쪽 쭉 내리다보면 리포트 누름 → 오른쪽 사용량 정보 클릭하여 확인 후 문자로 부탁드립니다.";
const txtKyoceraM2101 = "화면 맨 밑 가운데에 점3개(***)를 눌러주세요. 화살표 아래로한번-카운터 확인-기본설정-인쇄페이지 수-화살표 아래로한번 내리신 후 사진찍어 보내주시면 됩니다. (시리얼넘버도 필요하면 그 위에 상태페이지 인쇄 누르기)";
const txtHpCommon = "메인화면 상단 스크롤 내려주시고 톱니바퀴 아이콘 눌러주세요. 목록 하단에 보고서 눌러주시고 상태보고서 찾아서 인쇄하신 후 사진찍어 보내주시면 됩니다.";
const txtLexmark410 = "집모양-스패너모양-보고서-장치통계-장치통계 페이지2번 사진찍어서 보내주시면 됩니다.";
export const TXT_DEFAULT = "기기 화면의 카운터 메뉴에서 사용량 확인 후 사진 한 장만 문자나 카톡으로 발송 부탁드립니다.";

export const DEFAULT_FORMATS: Record<string, string> = {
  N500: txtSindo, N501: txtSindo, N502: txtSindo, N600: txtSindo, N601: txtSindo,
  D320: txtSindo, D400: txtSindo, D410: txtSindo, D420: txtSindo, D450: txtSindo, D460: txtSindo, D470: txtSindo,
  MA2101: txtKyoceraM2101, MA2100: txtEcosys, M5526: txtEcosys, M5521: txtEcosys, ECOSYS: txtEcosys,
  "305": txt305, "5473": txt5473,
  C2263: txtApeos, C2265: txtApeos, C2061: txtApeos, C3067: txtApeos, C2260: txtApeos,
  C2270: txtApeos, C2275: txtApeos, C3375: txtApeos, C4475: txtApeos, C5575: txtApeos,
  C2271: txtApeos, C2273: txtApeos, C3371: txtApeos, C3373: txtApeos, C3070: txtApeos,
  C3570: txtApeos, C4570: txtApeos, C5570: txtApeos, C7070: txtApeos, Apeos: txtApeos,
  "5700": txt5700, L5100: txtL5100,
  "2554": txtRicoh, C3003: txtRicoh, C4504: txtRicoh, "5005": txt5005,
  Mx6: txtSamMx6, X3220NR: txtSamKeypad, K3250: txtSamKeypad, "X-9201": txtSamKeypad,
  "X4-시리즈": txtSamXk47, "K4-시리즈": txtSamXk47, "X7-시리즈": txtSamXk47, "K7-시리즈": txtSamXk47, "SL-": txtSamXk47,
  HP: txtHpCommon, "410": txtLexmark410, Lexmark: txtLexmark410,
  "기본 기종": TXT_DEFAULT,
};

export const DEFAULT_TEMPLATES: Record<string, string> = {
  v_single_greeting: "안녕하세요 퍼스트 전산입니다.\n세금계산서 발행을 위해 사용량 확인을 위한 카운터 사진이 필요하여 연락드렸습니다.\n카운터 한장만 보내주시면 감사하겠습니다.",
  v_single_closing: "매번 번거롭게 해드려 죄송합니다.",
  v_multi_greeting: "안녕하세요 퍼스트 전산입니다.\n세금계산서 발행을 위해 보유하신 총 {total}대 기기의 사용량 확인을 위한 카운터 사진이 필요하여 연락드렸습니다.\n각 기기별 카운터 한장씩 보내주시면 감사하겠습니다.",
  v_multi_closing: "매번 번거롭게 해드려 죄송합니다.",
  s_single_greeting: "안녕하세요 퍼스트 전산입니다.\n세금계산서 발행을 위해 사용량 확인을 위한 카운터 사진이 필요하여 연락드렸습니다.\n카운터 한장만 보내주시면 감사하겠습니다.",
  s_single_closing: "매번 번거롭게 해드려 죄송합니다.",
  s_multi_greeting: "안녕하세요 퍼스트 전산입니다.\n세금계산서 발행을 위해 보유하신 총 {total}대 기기의 사용량 확인을 위한 카운터 사진이 필요하여 연락드렸습니다.\n각 기기별 카운터 한장씩 보내주시면 감사하겠습니다.",
  s_multi_closing: "매번 번거롭게 해드려 죄송합니다.",
};

/** 설정 화면의 기종 묶음 (원본 machine_groups) */
export const MACHINE_GROUPS: Array<{ label: string; models: string[] }> = [
  { label: "📠 신도리코 (N/D 시리즈)", models: ["N500", "N501", "N502", "N600", "N601", "D320", "D400", "D410", "D420", "D450", "D460", "D470"] },
  { label: "📠 교세라 (ECOSYS / MA2101)", models: ["MA2101", "MA2100", "M5526", "M5521", "ECOSYS"] },
  { label: "📠 후지 Apeos (C 시리즈)", models: ["C2263", "C2265", "C2061", "C3067", "C2260", "C2270", "C2275", "C3375", "C4475", "C5575", "C2271", "C2273", "C3371", "C3373", "C3070", "C3570", "C4570", "C5570", "C7070", "Apeos"] },
  { label: "📠 리코", models: ["2554", "C3003", "C4504"] },
  { label: "📠 삼성 복합기", models: ["Mx6", "X3220NR", "K3250", "X-9201", "X4-시리즈", "K4-시리즈", "X7-시리즈", "K7-시리즈", "SL-"] },
  { label: "📠 HP / 렉스마크 / 브라더", models: ["HP", "410", "Lexmark", "5700", "L5100"] },
  { label: "📠 기타 단일 모델", models: ["305", "5473", "5005"] },
  { label: "📠 공통 / 기본값", models: ["기본 기종"] },
];

export const DEFAULT_REGIONS = ["A지역", "B지역", "C지역", "D지역", "E지역"];

/** 기종 자동 매칭에서 제외 — 문자열이 흔해 오탐하는 키 (원본 exclude_machines) */
export const EXCLUDE_FROM_LOOSE_MATCH = new Set([
  "기본 기종", "X3220NR", "K3250", "X-9201", "Mx6", "X4-시리즈", "K4-시리즈", "X7-시리즈", "K7-시리즈", "SL-", "HP", "410", "Lexmark",
]);
