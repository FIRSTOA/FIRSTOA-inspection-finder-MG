// 짧은 수기 입력 인식 — "오버홀 테스트업체" / "오버홀\n주식회사 테스트" / "테스트업체 A/S"
// 양식을 붙여넣지 않고 구분 단어와 업체명만 적어도 구분·업체명이 채워진 빈 양식이 나오게(2026-09-28).
// 예전엔 점검 탭은 라벨 없는 줄을 버려 업체명이 비었고, AS 탭은 등급 접두어(12N…)가 없으면 "업체명 추출 실패"가 떠서
// 부품신청만 보내려 해도 "업체명을 읽지 못했습니다"에 막혔다.
export const QUICK_KIND_WORDS = ["점검", "AS", "오버홀", "여분", "마감", "세팅", "납품", "철수", "교체", "샘플전달"] as const;

function normKind(token: string): string {
  const t = token.trim();
  if (/^a\s*\/?\s*s$/i.test(t)) return "AS";
  if (t === "셋팅") return "세팅";
  if (t === "정기점검") return "점검";
  return t;
}

export function parseQuickVendorInput(input: string): { kind: string; vendor: string } | null {
  const lines = String(input || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length || lines.length > 2) return null;
  const joined = lines.join(" ");
  if (joined.length > 60) return null;
  if (/[:：]/.test(joined)) return null; // 라벨이 있으면 양식 — 정식 변환기가 맡는다
  if (/\d{3,}/.test(joined)) return null; // 전화번호·시리얼·번지수가 있으면 짧은 입력이 아니다
  if (/^\d+(?:NN|SS|S|N|V)/.test(lines[0])) return null; // "12N주식회사 …" 컴팩트 양식(등급 접두어)
  const tokens = joined.split(/\s+/);
  const kindIdx = tokens.findIndex((t) => (QUICK_KIND_WORDS as readonly string[]).includes(normKind(t)));
  if (kindIdx < 0) return null;
  const kind = normKind(tokens[kindIdx]);
  const vendor = tokens.filter((_, i) => i !== kindIdx).join(" ").trim();
  if (vendor.length < 2 || vendor.length > 40) return null;
  return { kind, vendor };
}
