/**
 * 회사 전체 조직 명단 (2026-08-01 사용자 제공).
 * 부서 요청의 "요청 부서/이름" 선택용 — CS팀 작성자 명단(cs_members)과는 별개다.
 * (CS팀 명단은 관리 > 인원에서 관리하는 재직 데이터, 이건 요청자 표기용 정적 명단)
 */
export type CompanyMember = {
  name: string;
  dept: "임원" | "CS팀" | "영업팀" | "CSS·운영지원";
  team?: string;    // CS: A~D / 영업: 전략영업·IT / CSS·운영지원: 운영지원·CSS·경영지원·지원(비정규)
  title?: string;   // 팀장 · 파트장 · 부파트장 등
};

export const COMPANY_MEMBERS: CompanyMember[] = [
  // 임원
  { name: "김희권", dept: "임원" },
  { name: "이효영", dept: "임원" },

  // CS팀 — 팀장 신정훈, 박옥주 A·B파트장, 이홍진·양승원·김정민 각 팀 부파트장
  { name: "신정훈", dept: "CS팀", title: "팀장" },
  { name: "박옥주", dept: "CS팀", team: "A·B", title: "파트장" },
  { name: "김정민", dept: "CS팀", team: "A", title: "부파트장" },
  { name: "심태현", dept: "CS팀", team: "A" },
  { name: "정웅", dept: "CS팀", team: "A" },
  { name: "윤기준", dept: "CS팀", team: "B" },
  { name: "권태혁", dept: "CS팀", team: "B" },
  { name: "조윤", dept: "CS팀", team: "B" },
  { name: "이홍진", dept: "CS팀", team: "C", title: "부파트장" },
  { name: "박영현", dept: "CS팀", team: "C" },
  { name: "이민구", dept: "CS팀", team: "C" },
  { name: "한왕주", dept: "CS팀", team: "C" },
  { name: "양승원", dept: "CS팀", team: "D", title: "부파트장" },
  { name: "김종희", dept: "CS팀", team: "D" },
  { name: "이호준", dept: "CS팀", team: "D" },

  // 영업팀 — 팀장 홍대경
  { name: "홍대경", dept: "영업팀", title: "팀장" },
  { name: "박진영", dept: "영업팀", team: "전략영업", title: "파트장" },
  { name: "이찬우", dept: "영업팀", team: "전략영업" },
  { name: "김수인", dept: "영업팀", team: "전략영업" },
  { name: "박민", dept: "영업팀", team: "전략영업" },
  { name: "이정현", dept: "영업팀", team: "전략영업" },
  { name: "유성용", dept: "영업팀", team: "전략영업" },
  { name: "손영근", dept: "영업팀", team: "IT", title: "파트장" },
  { name: "김정식", dept: "영업팀", team: "IT", title: "부파트장" },
  { name: "문종주", dept: "영업팀", team: "IT" },
  { name: "김광태", dept: "영업팀", team: "IT" },
  { name: "김담우", dept: "영업팀", team: "IT" },
  { name: "지경민", dept: "영업팀", team: "IT" },
  { name: "신동원", dept: "영업팀", team: "IT" },

  // CSS/운영지원파트 — 파트장 이의수
  { name: "이의수", dept: "CSS·운영지원", title: "파트장" },
  { name: "현호진", dept: "CSS·운영지원", team: "운영지원", title: "부파트장" },
  { name: "김정원", dept: "CSS·운영지원", team: "운영지원" },
  { name: "허영재", dept: "CSS·운영지원", team: "운영지원" },
  { name: "윤태학", dept: "CSS·운영지원", team: "운영지원" },
  { name: "김현군", dept: "CSS·운영지원", team: "운영지원" },
  { name: "백진성", dept: "CSS·운영지원", team: "운영지원" },
  { name: "안수복", dept: "CSS·운영지원", team: "CSS", title: "부파트장" },
  { name: "정지훈", dept: "CSS·운영지원", team: "CSS" },
  { name: "이혁주", dept: "CSS·운영지원", team: "CSS" },
  { name: "김숙영", dept: "CSS·운영지원", team: "경영지원", title: "파트장" },
  { name: "이윤아", dept: "CSS·운영지원", team: "경영지원" },
  { name: "박지은", dept: "CSS·운영지원", team: "경영지원" },
  { name: "박수민", dept: "CSS·운영지원", team: "경영지원" },
  { name: "김슬기", dept: "CSS·운영지원", team: "경영지원" },
  { name: "안경미", dept: "CSS·운영지원", team: "경영지원" },
  { name: "이보배", dept: "CSS·운영지원", team: "경영지원" },
  { name: "이제일나", dept: "CSS·운영지원", team: "지원(비정규)" },
  { name: "성하영", dept: "CSS·운영지원", team: "지원(비정규)" },
  { name: "조소은", dept: "CSS·운영지원", team: "지원(비정규)" },
  { name: "최영지", dept: "CSS·운영지원", team: "지원(비정규)" },
];

/** 선택 목록의 그룹 라벨: "영업팀 · IT" / "CS팀 · A" / "임원" */
export function memberGroup(member: CompanyMember): string {
  return member.team ? `${member.dept} · ${member.team}` : member.dept;
}

/** 요청자 저장 표기: "영업팀 손영근 파트장" — 카드에서 부서·직책까지 바로 읽히게 */
export function memberValue(member: CompanyMember): string {
  return [member.dept, member.name, member.title].filter(Boolean).join(" ");
}
