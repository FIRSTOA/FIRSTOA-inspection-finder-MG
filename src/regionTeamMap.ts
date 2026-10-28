/**
 * 자유 입력 지역 글자 → 담당 팀(A~E). 못 읽으면 "" (업체명 오입력·'서울'·'동구' 같은 모호한 값).
 *
 * 왜 따로 있나(2026-10-28): misu 등 표의 '지역' 칸은 'A'·'수도권B'만이 아니라 '강남구'·'고양시'·'세종'·'제주도 출장' 같은
 * 지명이 섞인 자유 입력이다. workCount.regionTeam(글자만)·region.regionLetter(손으로 적은 구 목록, GAS 와 짝)는 지명을 못 읽거나
 * 임대리스트 실제 배정과 다르다(마포·은평·서대문=A, 관악·동작=B, 성동·광진=C, 고양·파주·남양주=A, 부천·김포·시흥·안산·인천=B).
 *
 * 구/시 → 팀 표 근거: vendor_info(임대리스트) '시/구' × _raw '관리 담당자' 집계(2026-10-28 MCP 실측, 숨김 제외).
 *   한 이름이 여러 팀에 걸리면 다수(중구 A 802 / B 96 / 지방 58 → A, 서구 B 278 / 지방 50 → B, 강서구 B 511 / 부산 29 → B).
 *   지방 쪽이 다수거나 반반인 '동구'·'남구'·'북구'는 모호 → "" (앞에 '부산'·'대구' 등이 붙으면 그 말로 E).
 *   경기 시 안의 구(분당·영통·일산동 …)는 그 시의 팀.
 * 주의: 미수 시트처럼 '팀별 시트'가 원본인 행은 시트 이름이 팀이다(관리부 배정이 지명과 다르다 — C 시트에 고양시·용인시가 있음).
 *       이 함수는 그런 원본 팀이 없을 때만 쓴다.
 */
import { regionTeam } from "./workCount";

export type RegionTeam = "A" | "B" | "C" | "D" | "E" | "";

const LIST: Record<Exclude<RegionTeam, "">, string[]> = {
  A: [
    "강북", "노원", "도봉", "동대문", "마포", "서대문", "성북", "용산", "은평", "종로", "중구", "중랑",
    "고양", "일산", "덕양구", "일산동구", "일산서구", "구리", "남양주", "동두천", "양주", "의정부", "파주", "포천", "가평", "연천",
  ],
  B: [
    "강서", "관악", "구로", "금천", "동작", "양천", "영등포",
    "광명", "김포", "부천", "원미구", "소사구", "오정구", "시흥", "안산", "상록구", "단원구",
    "계양", "남동", "미추홀", "부평", "연수", "서구", "강화", "옹진", "검단", "영종", "제물포", "서해구", "송도", "청라",
  ],
  C: ["강남", "강동", "광진", "서초", "성동", "송파"],
  D: [
    "과천", "광주시", "군포", "성남", "분당", "수정구", "중원구", "판교", "수원", "영통", "권선구", "팔달구", "장안구",
    "안성", "안양", "만안구", "동안구", "양평", "여주", "오산", "용인", "수지구", "기흥구", "처인구", "의왕", "이천",
    "평택", "포승", "하남", "화성", "동탄", "음성", "진천",
  ],
  E: [
    "지방", "부산", "부산진", "대구", "대전", "울산", "세종", "조치원", "제주", "서귀포",
    "강원", "충청", "충남", "충북", "경상", "경남", "경북", "전라", "전남", "전북",
    "강릉", "강진", "거제", "거창", "경산", "경주", "계룡", "고성", "고흥", "곡성", "공주", "광산구", "광양", "괴산", "구례", "구미",
    "군산", "금산", "금정구", "기장", "김제", "김천", "김해", "나주", "남원", "남해", "논산", "단양", "달서구", "달성", "담양", "당진",
    "대덕구", "덕진구", "동래구", "동해", "목포", "무안", "문경", "밀양", "보령", "봉화", "부여", "사상구", "사천", "사하구", "삼척", "상주",
    "서산", "서천", "속초", "수성구", "수영구", "순천", "아산", "양산", "양양", "여수", "연제구", "영광", "영도구", "영암", "영월", "영주",
    "영천", "예산", "예천", "옥천", "완도", "완주", "울주", "울진", "원주", "유성구", "의령", "익산", "인제", "장성", "전주", "정선",
    "정읍", "제천", "증평", "진구", "진주", "창녕", "창원", "천안", "철원", "청양", "청주", "춘천", "충주", "칠곡", "태안", "통영",
    "평창", "포항", "함안", "함평", "해운대", "홍성", "홍천", "화순", "화천", "횡성",
  ],
};

/** 지명(접미 시·군·구·도 뗀 이름, 또는 '중구'·'서구'·'광주시'처럼 떼면 모호한 이름) → 팀 */
export const REGION_TEAM_MAP: Readonly<Record<string, Exclude<RegionTeam, "">>> = Object.freeze(
  Object.fromEntries((Object.keys(LIST) as Array<keyof typeof LIST>).flatMap((team) => LIST[team].map((name) => [name, team]))),
);
/** 다른 말이 없을 때만 쓰는 넓은 이름 — '경기 고양시'는 고양(A)이 이긴다 */
const WEAK: Record<string, Exclude<RegionTeam, "">> = { 경기: "D", 인천: "B" };
const PREFIX = /^(서울특별시|서울시|서울|경기도|경기|인천광역시|인천시|인천)(.+)$/;
const SUFFIX = /(특별자치시|특별자치도|특별시|광역시|시|군|구|도|읍|면)$/;
const LETTER = /^\s*(?:강서|강남|강북|강동|서울)?\s*(?:수도권)?\s*([A-Ea-e])\s*(?:지역|팀)?\s*$/;

function lookup(token: string): Exclude<RegionTeam, ""> | undefined {
  if (REGION_TEAM_MAP[token]) return REGION_TEAM_MAP[token];
  const base = token.replace(SUFFIX, "");
  return base.length >= 2 ? REGION_TEAM_MAP[base] : undefined;
}

export function teamOfRegionText(value: unknown): RegionTeam {
  const raw = String(value ?? "").normalize("NFKC").trim();
  if (!raw) return "";
  const letter = regionTeam(raw) || raw.match(LETTER)?.[1]?.toUpperCase() || "";
  if (letter) return letter as RegionTeam;
  const tokens: string[] = [];
  for (const t of raw.split(/[\s,·/()[\]~\-–]+/).filter(Boolean)) {
    tokens.push(t);
    const rest = t.match(PREFIX)?.[2];
    if (rest) tokens.push(rest); // '서울구로구'·'경기광주시' 처럼 붙여 쓴 것
  }
  for (const t of tokens) { const hit = lookup(t); if (hit) return hit; }
  for (const t of tokens) { const w = WEAK[t.replace(SUFFIX, "")] || WEAK[t]; if (w) return w; }
  // 표에 없는 '…시'·'…군'은 수도권이 아니다(경기·인천 시군은 전부 표에 있음) → 지방
  if (tokens.some((t) => /^[가-힣]{1,4}(시|군)$/.test(t) && !/^(서울|경기|인천)/.test(t))) return "E";
  return "";
}
