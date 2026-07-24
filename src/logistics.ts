import type { LogisticsFormState } from "./api";

export const EMPTY_LOGISTICS_FORM: LogisticsFormState = { category: "납품", categoryOther: "", vendor: "", item: "", quantity: "", consumableBilling: "", setup: "", emailCounter: "", hanjo: "", condition: "", spareToner: "", notes: "" };

export function buildLogisticsText(f: LogisticsFormState, author: string): string {
  const category = f.category === "기타" ? f.categoryOther : f.category;
  return [`작성자: ${author}`, `구분: ${category}`, `거래처명(지점/현장명 必) : ${f.vendor}`, `품목: ${f.item}`, `수량: ${f.quantity}`, `소모품(납품/청구여부): ${f.consumableBilling}`, `셋팅여부: ${f.setup}`, `이메일카운터셋팅완료: ${f.emailCounter}`, `한조셋팅완료: ${f.hanjo}`, `상태체크(내부/외부): ${f.condition}`, `여분토너체크(철수 시): ${f.spareToner}`, `특이사항: ${f.notes}`].join("\n");
}
