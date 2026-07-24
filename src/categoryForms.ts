/** 카톡 카테고리 입력 양식 스키마 (불만/재계약/초과조정). 사용자 제공 양식 기준.
 *  - key = Supabase 컬럼명(과 일치)  fill = 점검/AS 불러오기 대상
 *  - buildCatText: 폼 → 카톡 전송 텍스트(■ 양식)
 */
import { GRADE_OPTIONS, REGION_OPTIONS } from "./formOptions";

export type FieldType = "text" | "textarea" | "select";
export type FieldFill = "author" | "company" | "region" | "keyman" | "grade";
export type FieldDef = { key: string; label: string; type: FieldType; options?: string[]; fill?: FieldFill };
export type Section = { title: string; fields: FieldDef[] };
export type FormSchema = {
  title: string;        // 카톡 제목 (/불만접수 등)
  category: string;     // 불만 / 재계약 / 초과업체조정
  table: string;        // Supabase 테이블
  roomKey: string;      // room_map 키 (category|*)
  sections: Section[];
};

const T = (key: string, label: string, fill?: FieldFill): FieldDef => ({ key, label, type: "text", fill });
const TA = (key: string, label: string): FieldDef => ({ key, label, type: "textarea" });
const SEL = (key: string, label: string, options: string[]): FieldDef => ({ key, label, type: "select", options });
const REGION = (fill?: FieldFill): FieldDef => ({ ...SEL("지역", "지역", REGION_OPTIONS), fill });
const GRADE = (fill?: FieldFill): FieldDef => ({ ...SEL("등급", "등급", GRADE_OPTIONS), fill });

export const CATEGORY_SCHEMAS: Record<string, FormSchema> = {
  misu: {
    title: "/미수 방문", category: "미수", table: "misu", roomKey: "미수|*",
    sections: [
      { title: "기본정보", fields: [
        T("입력일", "입력일"), T("작성자", "작성자", "author"), REGION("region"),
        T("업체명", "업체명", "company"), T("담당자", "담당자/연락처", "keyman"), GRADE("grade"),
      ] },
      { title: "미수 내용", fields: [
        T("미수금액", "미수 금액"), SEL("보증금미입금", "보증금 미입금", ["미입금", "일부입금", "입금완료", "해당없음"]), SEL("미수개월", "미수개월", ["1개월", "2개월", "3개월", "4개월 이상"]),
        TA("방문내용", "방문/통화 내용"), SEL("고객반응", "고객 반응", ["입금약속", "분할요청", "확인중", "연락두절", "거부", "완료"]),
      ] },
      { title: "처리 계획", fields: [
        T("약속일", "입금/처리 약속일"), T("후속담당자", "후속 담당자"), TA("특이사항", "특이사항"),
      ] },
    ],
  },
  bulman: {
    title: "불만접수", category: "불만", table: "bulman", roomKey: "불만|*",
    sections: [
      { title: "기본정보", fields: [
        T("작성자", "작성자", "author"), REGION("region"), GRADE("grade"),
        T("업체명", "업체명", "company"), T("담당자", "담당자/연락처", "keyman"), T("기종", "기종/위치"),
      ] },
      { title: "불만 분류", fields: [
        SEL("불만유형", "불만 유형", ["AS", "품질", "색감", "스캔", "계약", "요금", "응대", "기타"]),
        SEL("불만정도", "불만 정도", ["상", "중", "하"]),
      ] },
      { title: "내용", fields: [ TA("불편내용", "불편내용"), TA("고객요청사항", "고객 요청사항") ] },
      { title: "현장 조치", fields: [
        T("방문일", "방문일"), T("처리자", "처리자"), TA("조치내용", "조치 및 안내내용"), SEL("현장고객반응", "고객반응", ["만족", "보통", "불만 지속", "재방문 요청", "연락대기"]),
      ] },
      { title: "원인분석", fields: [ TA("외부원인", "외부 원인"), TA("내부원인", "내부 원인") ] },
      { title: "실행전략", fields: [ TA("실행방향", "방향"), TA("제시선택지", "제시한 선택지"), TA("내부협의", "내부 협의 필요사항") ] },
      { title: "다음 액션", fields: [ T("후속담당자", "담당자"), SEL("기한", "기한", ["당일", "익일", "3일 이내", "1주 이내", "협의"]), T("다음확인일", "다음 확인일") ] },
      { title: "마무리", fields: [
        SEL("최종상태", "최종상태", ["접수", "진행중", "보류", "완료", "재발관리"]), TA("재발방지", "재발방지 포인트"),
      ] },
    ],
  },
  recontract: {
    title: "/계약갱신", category: "재계약", table: "recontract", roomKey: "재계약|*",
    sections: [
      { title: "기본정보", fields: [
        T("작성자", "작성자", "author"), REGION("region"), GRADE("grade"),
        T("업체명", "업체명", "company"), T("담당자", "담당자/연락처", "keyman"), T("기종", "기종/위치"), T("계약종료일", "계약 종료일"),
      ] },
      { title: "갱신", fields: [
        SEL("갱신상태", "갱신 상태", ["대상확인", "제안전", "제안완료", "검토중", "갱신완료", "이탈위험", "종료예정"]),
        SEL("갱신위험도", "갱신 위험도", ["상", "중", "하"]),
      ] },
      { title: "고객 상황", fields: [
        SEL("고객반응현황", "현재 고객 반응", ["긍정", "보통", "부정", "검토중", "연락대기"]), TA("불편요구", "불편사항/요구사항"), SEL("업무변화", "업무 변화 여부", ["변화없음", "인원증가", "인원감소", "이전/확장", "축소"]), SEL("타사비교", "타사 비교 여부", ["없음", "비교중", "타사제안받음", "타사이탈위험"]),
      ] },
      { title: "현재 계약 조건", fields: [ T("월렌탈료", "월 렌탈료"), SEL("사용량초과", "사용량/초과 여부", ["정상", "초과", "부족", "확인필요"]), TA("기존혜택", "기존 혜택/특이사항") ] },
      { title: "제안 내용", fields: [
        T("제안일자", "제안일/제안자"), TA("제안조건", "제안 조건"), TA("설명내용", "고객에게 설명한 내용"), TA("제안고객반응", "고객 반응"),
      ] },
      { title: "원인분석", fields: [ TA("외부원인", "외부 원인"), TA("내부원인", "내부 원인") ] },
      { title: "실행전략", fields: [ TA("갱신방향", "갱신 방향"), TA("제시선택지", "제시한 선택지"), TA("내부협의", "내부 협의 필요사항") ] },
      { title: "다음 액션", fields: [ T("후속담당자", "담당자"), SEL("기한", "기한", ["당일", "익일", "3일 이내", "1주 이내", "협의"]), T("다음확인일", "다음 확인일") ] },
      { title: "마무리", fields: [
        SEL("최종상태", "최종상태", ["진행중", "보류", "갱신완료", "조건재협의", "이탈위험", "종료"]), TA("관리포인트", "관리 포인트"),
      ] },
    ],
  },
  "overage-adjust": {
    title: "/1년 누적 초과 업체 조정", category: "초과업체조정", table: "overage_adjust", roomKey: "초과조정|*",
    sections: [
      { title: "기본정보", fields: [
        T("방문일", "방문일"), T("작성자", "작성자", "author"), REGION("region"),
        T("업체명", "업체명", "company"), T("담당자", "담당자", "keyman"), T("기종", "기종"),
      ] },
      { title: "내용", fields: [
        TA("현재조건", "현재기본금액 및 조건"), TA("누적결과", "1년 누적 결과"), TA("제안", "제안"),
        SEL("고객반응", "고객 반응", ["수락", "검토중", "보류", "거부", "재방문"]), SEL("할인조건변경", "초과료 할인 및 조건 변경", ["유지", "할인", "상향", "조건변경", "확인필요"]), SEL("진행상태", "진행상태", ["대상확인", "제안전", "제안완료", "검토중", "조정완료", "보류"]),
      ] },
    ],
  },
};

// 폼 → 카톡 텍스트(■ 양식)
export function buildCatText(schemaKey: string, form: Record<string, string>, author: string): string {
  const s = CATEGORY_SCHEMAS[schemaKey];
  if (!s) return "";
  const lines: string[] = [s.title];
  for (const sec of s.sections) {
    lines.push("", `■ ${sec.title}`);
    for (const f of sec.fields) {
      const v = f.fill === "author" ? author : (form[f.key] || "");
      lines.push(`${f.label}: ${v}`);
    }
  }
  return lines.join("\n");
}

export function emptyCatForm(schemaKey: string): Record<string, string> {
  const s = CATEGORY_SCHEMAS[schemaKey];
  const o: Record<string, string> = {};
  if (s) for (const sec of s.sections) for (const f of sec.fields) o[f.key] = "";
  return o;
}
