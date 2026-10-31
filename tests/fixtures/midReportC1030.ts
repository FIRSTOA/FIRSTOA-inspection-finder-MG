/**
 * 중간보고 골든 픽스처 재료 — C팀 2026-10-30(금) 꼴 일정·명단(실측 10/26~10/30 as_tickets 모양을 본뜬 가짜 데이터).
 * 담고 있는 경우: 2명 배정·제목 머리 이름·미배정·이름 없는 물류(제외)·이름 있는 물류·완료(제외)·휴가/연차(제외)·
 * autoplan/매월점검(제외)·CSS 지원·다른 팀 CS 지원·명단 밖 사람(제외)·겸직(B·C)·익일(금→월)·연기 꼬리·다른 팀.
 */
export type FixtureTicket = {
  id: string; team: string; date: string; status: string; scheduleType: string; source?: string;
  vendor: string; calendarTitle?: string; note?: string; issue: string; model: string; assignee: string;
  contact?: string; address?: string;
};

export const MEMBERS_1030 = [
  { name: "신정훈", team: "팀장", dept: "CS팀", active: true },
  { name: "이홍진", team: "C", dept: "CS팀", active: true },
  { name: "이민구", team: "C", dept: "CS팀", active: true },
  { name: "박영현", team: "C", dept: "CS팀", active: true },
  { name: "한왕주", team: "C", dept: "CS팀", active: true },
  { name: "조윤", team: "B·C", dept: "CS팀", active: true },
  { name: "이권선", team: "A", dept: "CS팀", active: true },
  { name: "김정민", team: "A", dept: "CS팀", active: true },
  { name: "윤기준", team: "B", dept: "CS팀", active: true },
  { name: "김종희", team: "D", dept: "CS팀", active: true },
  { name: "지경민", team: "CSS", dept: "CSS·운영지원", active: true },
  { name: "김광태", team: "", dept: "IT파트", active: true },
  { name: "퇴사자", team: "C", dept: "CS팀", active: false },
];

const T = (id: string, p: Partial<FixtureTicket>): FixtureTicket => ({
  id, team: "C", date: "2026-10-30", status: "배정", scheduleType: "AS", source: "manual",
  vendor: "", calendarTitle: "", note: "", issue: "", model: "", assignee: "", ...p,
});

export const TICKETS_1030: FixtureTicket[] = [
  T("t01", { assignee: "이홍진", vendor: "30S주식회사 알스퀘어디자인4층 설계팀(가산빌딩)", model: "SL-X3220NR", issue: "용지제거했는데 엄청 큰 갈리는소음이난다고함" }),
  T("t02", { assignee: "이민구,박영현", vendor: "7N김경식세무회계사무소-분기마감", model: "ApeosPort-V C3375", note: "접수내용\t ADF급지에서 스캔시 검정으로 스캔\n기타\t-" }),
  T("t03", { status: "접수", vendor: "한왕주 - 미수방문 쇼군웨이크스노우보드", calendarTitle: "한왕주 - 미수방문 쇼군웨이크스노우보드", issue: "8월 내내 부재중" }),
  T("t04", { status: "접수", vendor: "디아트치과", model: "DocuCentre-V 3065(헤라클래스)", issue: "토너 교체 요청" }),
  T("t05", { status: "접수", scheduleType: "납품철수교체휴가교육", vendor: "뉴트리원", calendarTitle: "뉴트리원 갤북5 노트북(사무용) 2대 납품" }),
  T("t06", { assignee: "박영현", scheduleType: "납품철수교체휴가교육", vendor: "포바이포", calendarTitle: "박영현-포바이포 9010→8730 교체" }),
  T("t07", { status: "완료", assignee: "이홍진", vendor: "한불엠앤에스㈜1층", model: "SL-X4300LX", issue: "드럼 교체" }),
  T("t08", { scheduleType: "납품철수교체휴가교육", assignee: "이민구", vendor: "이민구 연차" }),
  T("t09", { scheduleType: "매월점검", source: "autoplan", assignee: "한왕주", vendor: "분기점검 제이드자산운용" }),
  T("t10", { assignee: "지경민", vendor: "코리아에셋 본사", model: "SL-X7400LX", issue: "스캔 폴더 설정" }),
  T("t11", { assignee: "김정민", vendor: "여분요청 N SL-X3220NR 14N주식회사 퍼뮤니티 역삼", model: "SL-X3220NR", issue: "" }),
  T("t12", { assignee: "물류김", vendor: "삼성빌딩 철수", scheduleType: "납품철수교체휴가교육", calendarTitle: "물류김-삼성빌딩 3220 철수" }),
  T("t13", { assignee: "조윤", vendor: "효성산업 A/S 요청/2차체크", model: "DocuPrint-CP 505d", issue: "급지 불량" }),
  T("t14", { date: "2026-11-02", status: "익일", vendor: "법무법인 수헌", model: "SL-X3280NR", issue: "팩스 수신 안됨", contact: "김담당 010-1234-5678", address: "서울 강남구 테헤란로 1" }),
  T("t15", { date: "2026-11-02", status: "익일", scheduleType: "납품철수교체휴가교육", vendor: "디아트치과", calendarTitle: "디아트치과 9010→8730 교체" }),
  T("t16", { date: "2026-11-02", status: "익일", scheduleType: "납품철수교체휴가교육", assignee: "이민구", vendor: "블루닷", calendarTitle: "이민구-블루닷 노트북 3대 납품" }),
  T("t17", { date: "2026-11-04", status: "익일", assignee: "박영현", vendor: "21SS주식회사 공간코리아굿모닝시티분기마감", model: "SL-X3220NR", issue: "소음", note: "(10/30 오전)\n(11/4로 연기)" }),
  T("t18", { date: "2026-11-05", status: "익일", vendor: "카페24", issue: "점검" }),
  T("t19", { team: "A", assignee: "이권선", vendor: "A팀 업체", issue: "점검" }),
  T("t20", { date: "2026-11-02", status: "완료", vendor: "완료된 내일 건", issue: "x" }),
];

/** 공휴일 전날 — 2026-10-08(목) → 다음 영업일 2026-10-12(월, 10/9 한글날·주말 건너뜀) */
export const TICKETS_1008: FixtureTicket[] = [
  T("h01", { date: "2026-10-08", assignee: "이홍진", vendor: "넥스트라이프본사", model: "SL-X4220RX", issue: "카운터 확인" }),
  T("h02", { date: "2026-10-12", status: "익일", vendor: "블루닷 주식회사(bluedot Inc.)", issue: "토너" }),
  T("h03", { date: "2026-10-09", status: "익일", vendor: "휴일 건", issue: "x" }),
];

/** 익일스케줄(day=next) 상세 줄 — 화면의 reportDetailOf 대신 쓰는 고정 콜백 */
export const detailStub = (t: FixtureTicket): string[] => (t.contact ? [`  접수자: ${t.contact}`] : []).concat(t.address ? [`  📍 ${t.address}`] : []);
