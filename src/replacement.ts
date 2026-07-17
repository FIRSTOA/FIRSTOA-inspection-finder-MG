export type ReplacementFormState = {
  calendarMemo: string;
  dateLine: string;
  source: string;
  salesOwner: string;
  repairOwner: string;
  reason: string;
  company: string;
  name: string;
  phone: string;
  address: string;
  owner: string;
  items: string;
};

export const EMPTY_REPLACEMENT_FORM: ReplacementFormState = {
  calendarMemo: "",
  dateLine: "",
  source: "",
  salesOwner: "",
  repairOwner: "",
  reason: "",
  company: "",
  name: "",
  phone: "",
  address: "",
  owner: "퍼스트",
  items: "",
};

export function buildReplacementText(f: ReplacementFormState): string {
  return [
    "교체양식",
    `1. 캘린더 글머리에 중요내용 넣어줘야할사항: ${f.calendarMemo}`,
    `2. 날짜(랜선/팩스선 유무) : ${f.dateLine}`,
    `3. 유입경로: ${f.source}`,
    `4. 영업(요청)담당자 : ${f.salesOwner}`,
    `5. 수리배정 담당자`,
    `(고장교체시에는 CS인원 필수입력(대표님지시사항) : ${f.repairOwner}`,
    `6. 교체/철수사유 : ${f.reason}`,
    `7. 상호(사업자등록증 유/무) : ${f.company}`,
    `8. 성함 : ${f.name}`,
    `9. 연락처 : ${f.phone}`,
    `10. 주소(엘리베이터 유무) : ${f.address}`,
    `11. 장비소유주(위탁/퍼스트) : ${f.owner}`,
    `12. 물품 : ${f.items}`,
  ].join("\n");
}
