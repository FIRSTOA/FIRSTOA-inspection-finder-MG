/**
 * 완료·연기 처리 양식 — 팀 AS방·네이버 일정 내용·웹앱 메모가 전부 이 한 블록으로 간다.
 *
 * 왜 공유 모듈인가: 일정리스트(완료·연기)와 FIELD(익일 미루기)가 같은 양식을 따로 만들고 있었다.
 * FIELD 쪽만 "원문에서 기종·기번 뽑기"를 고쳐서, 일정리스트에서 완료한 건은 계속
 * "기종: - / 자산기번: - / 시리얼번호: - / 접수내용: -"로 나갔다(사용자 지적).
 *
 * 네이버에서 수입한 일정은 기종·기번이 컬럼에 없고 제목·메모 원문에만 있다. 접수(서비스접수)로
 * 들어온 건만 컬럼이 채워진다 — 그래서 컬럼이 비면 원문에서 찾아야 한다.
 */
import { fieldTicketVendor } from "./ids";
import { extractIssue } from "./reportAssignee";

export type ActionTicketLike = {
  vendor?: unknown;
  calendarTitle?: unknown;
  note?: unknown;
  model?: unknown;
  asset?: unknown;
  serial?: unknown;
  issue?: unknown;
};

const flat = (value: unknown) => String(value ?? "").replace(/_x000d_/g, " ");
/** 잡아낸 값의 꼬리 기호 정리 — 정규식이 "C3375("까지 물고 오는 경우가 있다 */
const trimTail = (value: string) => value.replace(/[\s(),.\-/]+$/, "").trim();

/**
 * 사유가 FIELD 보고양식 전문이면 '처리내용' 줄만 뽑는다.
 *
 * 사람이 완료 사유란에 보고양식을 통째로 붙여넣는 일이 있다. 그대로 보내면 카톡방이 수십 줄로
 * 도배되고(실제 사례: 빈 정기점검 양식까지 두 벌) 정작 무엇을 했는지는 묻혀 버린다.
 * 원문은 일정 '내용'에 따로 쌓이니 방에는 요지만 보낸다.
 */
export function condenseReason(reason: string): string {
  const text = String(reason || "").replace(/_x000d_/g, "\n").trim();
  if (!text) return "";
  const looksLikeForm = /(^|\n)\s*작성자\s*:/.test(text) && /(^|\n)\s*(구분|모델명|매수)\s*:/.test(text);
  if (!looksLikeForm) return text;
  const done = Array.from(text.matchAll(/(^|\n)\s*처리내용\s*:\s*([\s\S]*?)(?=\n\s*(?:매수|토너잔량|폐통|여분|작성자|구분|모델명|시리얼넘버|자산기번|내용|특이사항|한틴이카유무|주차비지원유무|[ㅡ―—-]{5,})\s*[:\n]|$)/g))
    .map((match) => match[2].replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const merged = Array.from(new Set(done)).join(" / ").trim();
  return merged || text.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 3).join(" ");
}

/** 티켓 컬럼이 비면 제목·메모 원문에서 찾아 채운다 */
export function extractDeviceInfo(ticket: ActionTicketLike, extra = "") {
  const raw = `${flat(ticket.vendor)}\n${flat(ticket.calendarTitle)}\n${flat(ticket.note)}\n${flat(extra)}`;
  const pick = (label: RegExp, min = 3) => {
    const value = (raw.match(label)?.[1] || "").trim();
    return value.length >= min ? value : "";
  };
  return {
    // "ApeosPort-V C3375(세이토)"처럼 시리즈와 번호가 공백으로 갈라진 표기가 흔하다
    model: trimTail(String(ticket.model ?? "").trim()
      || pick(/모델명[\t \s]*:?[\t ]*([^\t\n]+)/)
      || pick(/(?:^|[\t\s])((?:ECOSYS|APEOS|ApeosPort|Apeos|DocuCentre|DocuPrint|SL-|CLX|MX|ES|CM|HP|D)[A-Za-z0-9-]*(?:[ ][A-Za-z]{0,2}\d[A-Za-z0-9-]*)?)/)),
    asset: String(ticket.asset ?? "").trim() || pick(/자산기번[\t \s]*:?[\t ]*([A-Za-z0-9-]{3,})/) || pick(/자산번호[\t \s]*:?[\t ]*([A-Za-z0-9-]{3,})/),
    serial: String(ticket.serial ?? "").trim() || pick(/시리얼(?:넘버|번호)[\t \s]*:?[\t ]*([A-Za-z0-9-]{5,})/, 5) || pick(/기번[\t \s]*:?[\t ]*([A-Za-z0-9-]{5,})/, 5),
    // 접수내용: 양식의 "제목/상태/내용/접수내용" 줄(탭·콜론·스페이스 구분 모두)이 원본 — 예전엔 "접수분야 A/S"의
    // 구분 낱말을 먼저 집어 "접수내용: A/S"로 나갔다(실사고). 접수분야는 A/S가 아닌 것(여분요청·미수방문)일 때만 폴백.
    issue: (() => {
      const labeled = extractIssue(String(ticket.issue ?? ""), `${String(ticket.note ?? "")}\n${String(extra ?? "")}`);
      if (labeled) return labeled;
      const category = pick(/접수분야[\t \s]*:?[\t ]*([^\t\n]+)/);
      if (category && !/^a\s*\/?\s*s$/i.test(category)) return category;
      return "";
    })(),
  };
}

/**
 * 완료·연기 공용 블록.
 *
 * - 값이 없는 줄은 "-"로 채우지 않고 아예 뺀다 ("기종: -"가 네 줄 나가면 읽을 게 없다)
 * - 업체명을 깔끔히 뽑은 경우만 "업체명:", 못 뽑으면 라벨을 "캘린더제목:"으로 — 캘린더 제목 원문을
 *   그대로 쓰면서 업체명이라고 적으면 읽는 사람이 오해한다(사용자 지적)
 * - 작성자 = 이 처리를 한 사람. 배정자와 다를 수 있고, 방에 남아야 할 것은 처리한 사람이다
 */
export function buildActionBlock(
  ticket: ActionTicketLike,
  options: { author?: string; reason: string; deferLabel?: string; condense?: boolean },
): string {
  // 카톡방으로 갈 때는 요지만(condense), 일정 '내용'에 쌓을 때는 원문 그대로
  const reason = options.condense === false ? String(options.reason || "").trim() : condenseReason(options.reason);
  if (!reason) return "";
  const { model, asset, serial, issue } = extractDeviceInfo(ticket, options.reason);
  const titleSource = String(ticket.calendarTitle ?? "") || String(ticket.vendor ?? "");
  // 보고양식에 "업체명:"이 적혀 있으면 그게 가장 정확하다 — 캘린더 제목에는 부서·건물·IP까지 붙어 있다
  const formSource = `${flat(ticket.note)}\n${flat(options.reason)}`;
  const formVendor = trimTail((formSource.match(/(?:^|\n)\s*업체명\s*:\s*([^\n]+)/) || [])[1] || "");
  const formDept = trimTail((formSource.match(/(?:^|\n)\s*부서명\s*:\s*([^\n]+)/) || [])[1] || "");
  const cleanVendor = formVendor
    ? `${formVendor}${formDept ? ` (${formDept})` : ""}`
    : fieldTicketVendor(titleSource).vendor.trim();
  const titleLine = titleSource.replace(/_x000d_|\r|\n|\t/g, " ").replace(/\s+/g, " ").trim();
  const author = String(options.author ?? "").trim();
  return [
    cleanVendor ? `업체명: ${cleanVendor}` : `캘린더제목: ${titleLine || "-"}`,
    author && `작성자: ${author}`,
    model && `기종: ${model}`,
    asset && `자산기번: ${asset}`,
    serial && `시리얼번호: ${serial}`,
    issue && `접수내용: ${issue}`,
    `처리내용: ${reason}${options.deferLabel ? ` (${options.deferLabel})` : ""}`,
  ].filter(Boolean).join("\n");
}
