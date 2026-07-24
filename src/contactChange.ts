export type ContactChangeFormState = {
  company: string;
  region: string;
  category: string;
  reason: string;
  grade: string;
  before: string;
  after: string;
  notes: string;
};

export const EMPTY_CONTACT_CHANGE_FORM: ContactChangeFormState = {
  company: "",
  region: "",
  category: "",
  reason: "",
  grade: "",
  before: "",
  after: "",
  notes: "",
};

export function buildContactChangeText(form: ContactChangeFormState, author: string): string {
  return [
    "변경후담당자 명함 이미지있으면 첨부",
    `업체명(본사/지점 등) : ${form.company}`,
    `퍼스트전산직원 : ${author}`,
    `수도권지역 : ${form.region}`,
    `구분 : ${form.category}`,
    `사유 : ${form.reason}`,
    `등급 : ${form.grade}`,
    `변경전: ${form.before}`,
    `변경후: ${form.after}`,
    `특이사항: ${form.notes}`,
  ].join("\n");
}
