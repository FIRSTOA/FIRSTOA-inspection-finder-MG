// 모델명 → 브랜드 추정: 기종 카탈로그(modelCatalog) 우선, 없으면 휴리스틱.
// (copier-backfill.sql의 CASE와 같은 규칙 — 휴리스틱을 바꿀 때 함께 수정)
import { brandOfModel } from "./modelCatalog";

export function inferBrand(model: string): string {
  const catalog = brandOfModel(model);
  if (catalog) return catalog;
  const m = String(model || "");
  if (/BROTHER|브라더|MFC|HL-|5700|8900/i.test(m)) return "브라더";
  if (/OKI|오키|5473/i.test(m)) return "오키";
  if (/TASKALFA|ECOSYS|KYOCERA|교세라|2100|2101|5521|5526/i.test(m)) return "교세라";
  if (/XEROX|APEOS|DOCU|제록스|SC-? ?\d|C\d{4}|(^|\D)305(\D|$)|5005/i.test(m)) return "제록스";
  if (/BIZHUB|신도|SINDOH|^\s*N ?-?\d|^\s*D ?\d{3}/i.test(m)) return "신도";
  if (/SL|MX ?-?\d|CLX|CLP|삼성|K ?-?7\d{3}/i.test(m)) return "삼성";
  return "기타";
}
