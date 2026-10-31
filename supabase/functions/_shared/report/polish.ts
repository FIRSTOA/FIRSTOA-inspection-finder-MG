/**
 * 중간보고 다듬기(AI) — 화면 [📋 중간보고](엣지 report-polish)와 자동 중간보고(엣지 schedule-report)가 같은 프롬프트·같은 모델을 쓴다(2026-10-31 이사).
 * 일정 원문(업체·기종·내용)을 사람이 쓰던 보고 줄로 압축한다. 입력과 같은 순서·개수가 아니면 실패 — 부르는 쪽이 규칙 초안으로 폴백한다.
 * Deno 전용(fetch·Deno.env 는 부르는 쪽이 넘긴다 — 여기선 apiKey 를 인자로 받는다).
 */
import { recordOpenAiUsage } from "../ai-usage-deno.ts";

/** 한 번에 다듬는 최대 줄 수 — 넘으면 개수 불일치로 폴백 */
export const REPORT_POLISH_MAX_LINES = 40;
/** 기본 모델(환경변수 OPENAI_REPORT_MODEL 이 없을 때) */
export const REPORT_POLISH_DEFAULT_MODEL = "gpt-5.5";

export const REPORT_POLISH_INSTRUCTION = `복합기 CS팀의 카톡 중간보고 한 줄 요약기다. 각 일정을 "업체명 기종 핵심내용" 한 줄로 압축한다.

입력 필드: vendor(담당자 이름을 뗀 제목), title(캘린더 원제목), note(접수 메모·양식 원문), model, issue, category(접수 구분), kind.
model·issue가 비어 있으면 title·note의 접수양식 원문에서 업체·기종·내용을 찾는다.
단, note가 접수양식이 아니라 손으로 쓴 협상·개인 메모로 보이면 무시한다(보고에 새면 안 된다).

규칙:
- 업체명: 법인표기((주)·㈜·주식회사), 등급 접두("7N"·"15V"·"30S" 같은 숫자+등급), 층·부서·위치 메모, "전 ○○"·"이전됨 >" 옛 상호, 마감 꼬리표를 전부 버리고 핵심 상호만. 예: "7N김경식세무회계사무소-분기마감" → "김경식세무회계사무소", "주식회사 알스퀘어디자인4층 설계팀(가산빌딩)" → "알스퀘어디자인"
- 기종: 짧은 관용 표기. "SL-X3220NR"→"3220", "HP-9010"→"9010", 괄호 별명이 있으면 별명("헤라클래스"→"헤라"). 기종을 모르면 생략.
- 내용: 증상·작업을 2~6단어로. "용지제거했는데 엄청 큰 갈리는소음이난다고함"→"용지제거 후 소음", "원격확인시 평판으로는 스캔이상없으나 ADF급지에서 스캔시 검정으로 스캔"→"ADF 스캔시 검정".
- 납품·교체(kind=물류): "업체 품목 수량 구분" 형태. 예: "뉴트리원 갤북5 노트북 2대 납품", "디아트치과 9010→8730 교체".
- 접수 제목이 양식 원문("A/S⇥등급⇥모델⇥…")이면 그 안의 실제 업체명을 찾아 쓴다. "종료일·지역·접수일·기번·자산번호·시리얼" 꼬리 필드는 전부 무시한다.
- category(미수방문·여분요청·토너납품·CMS작성 등)가 있으면 방문 목적이므로 내용에 반드시 넣는다. issue가 함께 있으면 구분을 앞에: "미수방문 — 8월 내내 부재중". 지어내지 말고 입력의 category만 쓴다.
- 마감 표기(분기마감·매월마감·단순마감)는 계약 구분일 뿐 방문 내용이 아니다 — 업체명에서 떼고 내용으로도 쓰지 않는다. issue가 있으면 그게 내용이다. 증상·작업이 정말 없으면 구분만 쓴다(A/S→"점검", 기기교체/사양변경→"기기교체").
- 제목이 "이름 - 내용 / 등급 / 업체 / …"꼴이면 업체와 내용을 찾아 "업체 내용"으로. 예: "신정훈 - 전자계약서 작성 확인 / SS / 포바이포 / 김준탁…" → "포바이포 전자계약서 작성 확인"
- 지어내지 않는다: 입력에 없는 부품명·원인을 추가하지 않는다. 확실치 않으면 원문 표현을 짧게 줄이는 데서 멈춘다.
- 한 줄 25자 이내 목표. 머리의 "•"는 붙이지 않는다.

출력은 JSON: {"lines": ["...", ...]} — 입력 배열과 같은 순서·같은 개수.`;

/** 입력 정리 — 길이 자르기·kind 정규화(최대 40줄) */
export function sanitizePolishLines(lines: unknown): Array<{ vendor: string; title: string; note: string; model: string; issue: string; category: string; kind: "물류" | "as" }> {
  return (Array.isArray(lines) ? lines.slice(0, REPORT_POLISH_MAX_LINES) : []).map((line: Record<string, unknown>) => ({
    vendor: String(line?.vendor || "").slice(0, 200),
    title: String(line?.title || "").slice(0, 200),
    note: String(line?.note || "").slice(0, 240),
    model: String(line?.model || "").slice(0, 60),
    issue: String(line?.issue || "").slice(0, 300),
    category: String(line?.category || "").slice(0, 20),
    kind: line?.kind === "물류" ? "물류" : "as",
  }));
}

/** AI 응답 본문 → 줄 배열(머리 "•"·"-" 제거, 60자) */
export function parsePolishOutput(data: { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> }): string[] {
  const outputText = data.output_text
    || data.output?.flatMap((item) => item.content || []).map((item) => item.text || "").join("\n")
    || "";
  const parsed = JSON.parse(outputText || "{}");
  return (Array.isArray(parsed.lines) ? parsed.lines : []).map((line: unknown) => String(line).replace(/^[•\-\s]+/, "").slice(0, 60));
}

export type PolishResult =
  | { ok: true; lines: string[]; model: string }
  | { ok: false; status: number; error: string; model: string };

/**
 * 보고 줄 다듬기. 실패 모양은 report-polish 응답과 같다(OpenAI 오류 502·개수 불일치 502·입력 없음 400).
 * fnTag = 비용 기록 이름(화면 수동 "report-polish", 자동 "schedule-report").
 */
export async function polishReportLines(
  lines: unknown,
  opts: { apiKey: string; model?: string; fnTag: string; signal?: AbortSignal },
): Promise<PolishResult> {
  const model = opts.model || REPORT_POLISH_DEFAULT_MODEL;
  const source = sanitizePolishLines(lines);
  if (!source.length) return { ok: false, status: 400, error: "lines가 필요합니다", model };
  const openaiRes = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      reasoning: { effort: "low" },
      input: [
        { role: "system", content: REPORT_POLISH_INSTRUCTION },
        { role: "user", content: JSON.stringify(source) },
      ],
      text: { format: { type: "json_object" } },
    }),
    signal: opts.signal,
  });
  if (!openaiRes.ok) {
    const detail = await openaiRes.text().catch(() => "");
    return { ok: false, status: 502, error: detail.slice(0, 300), model };
  }
  const data = await openaiRes.json();
  void recordOpenAiUsage(opts.fnTag, model, data);
  const out = parsePolishOutput(data);
  // 개수가 어긋나면 통째로 실패 취급 — 부르는 쪽이 규칙 기반으로 폴백한다
  if (out.length !== source.length) return { ok: false, status: 502, error: "개수 불일치", model };
  return { ok: true, lines: out, model };
}
