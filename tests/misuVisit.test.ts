/**
 * 미수 방문이력(CS 방문이력 작성기) 순수 로직.
 * 법무팀 "이렇게 오면 반려(X → O)" 예시 문장을 버튼 값만으로 그대로 만들어 내는지 고정한다(docs/tasks/misu-visit-standard.md).
 */
import { describe, expect, it } from "vitest";
import {
  buildLegalCopyText, buildMisuKakaoText, contactSentence, dunSentence, effectiveMisuVisits, emptyMisuVisitDraft,
  formatMisuAmount, groupMisuVisitsByVendor, isOffHours, judgmentSentence, litigationChecklist, looseSortKey,
  matchMisuVendor, mergeMisuTimeline, misuVendorStatus, openSentence, photoSentence, returnSentence, suggestNextRound,
  validateMisuVisit, type MisuVisit, type MisuVisitDraft,
} from "../src/misuVisit";

const ALL_PHOTOS = (["outside", "door", "device", "notice"] as const).map((slot) => ({ slot, url: `https://x/${slot}.jpg` }));

/** 법무 O 예시를 채운 2차 경고 초안(14:20 KST) */
function goodSecond(over: Partial<MisuVisitDraft> = {}): MisuVisitDraft {
  return emptyMisuVisitDraft({
    id: "v2", visit_round: "2차 경고", visited_at: "2026-10-22T05:20:00Z",
    author: "이민구", author_team: "C", vendor: "○○학원", company_code: "2139567243", lease_seq: "3004",
    misu_months: "5", misu_balance: "2140050",
    contact_name: "김○○", contact_title: "점장", contact_is_rep: false, rep_phone_status: "확보", rep_phone: "010-0000-0000",
    open_status: "영업중",
    dun_methods: ["구두 안내", "안내문 봉함 전달"], dun_reply: "대표에게 전달하겠다",
    return_requested: true, return_to: "점장", return_reply: "대표 확인 후 회신", return_method: "반송 주소 안내",
    photos: ALL_PHOTOS, judgment: "소송이관", judgment_reason: "2차 경고 후 무응답",
    rules_ack: { sealed: true, thirdPartyNoDebt: true },
    ...over,
  });
}
const asRow = (d: MisuVisitDraft, created_at: string): MisuVisit => ({ ...d, created_at });

describe("법무 X→O 예시 문장 고정", () => {
  it("응대자", () => {
    expect(contactSentence(goodSecond())).toBe("김○○ / 점장 / 대표자 아님 · 대표자 연락처 확보(010-0000-0000)");
  });
  it("운영 여부", () => {
    const d = goodSecond({ open_status: "문 잠김", evid_mail: "3주", evid_sign: "유지", evid_neighbor: "2개월째 안 열었다", closed_estimate: "폐업 추정" });
    expect(openSentence(d)).toBe('문 잠김 / 우편물 3주치 적치, 간판 유지, 옆 가게 "2개월째 안 열었다" → 폐업 추정');
  });
  it("미수 독촉", () => {
    expect(dunSentence(goodSecond())).toBe('점장에게 구두 안내, 안내문 봉함 후 전달. "대표에게 전달하겠다", 납부 약속 없음');
  });
  it("기기 반환", () => {
    expect(returnSentence(goodSecond())).toBe('점장에게 반환 요구 고지, 반송 주소 안내. "대표 확인 후 회신"');
  });
  it("사진", () => {
    expect(photoSentence(goodSecond())).toBe("외부 · 출입문 · 기기+S/N · 안내문 4장");
  });
  it("현장 판단·사진 불가 칸", () => {
    expect(judgmentSentence(goodSecond())).toBe("소송이관 — 2차 경고 후 무응답");
    const d = goodSecond({ photos: ALL_PHOTOS.filter((p) => p.slot !== "device"), photo_skips: { device: "문 잠김" } });
    expect(photoSentence(d)).toBe("외부 · 출입문 · 안내문 3장, 기기+S/N 촬영 불가(문 잠김)");
  });
  it("납부 약속 날짜·거부는 따옴표 없이", () => {
    expect(dunSentence(goodSecond({ dun_reply: "납부 약속", promise_date: "2026-10-30" }))).toBe("점장에게 구두 안내, 안내문 봉함 후 전달. 납부 약속 2026-10-30");
    expect(dunSentence(goodSecond({ dun_reply: "거부" }))).toBe("점장에게 구두 안내, 안내문 봉함 후 전달. 납부 거부, 납부 약속 없음");
  });
});

describe("검증(차수별)", () => {
  it("O 예시 2차는 통과", () => {
    const v = validateMisuVisit(goodSecond());
    expect(v.blocks).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.missing).toEqual([]);
  });
  it("응대자 '직원'만이면 반려", () => {
    const v = validateMisuVisit(goodSecond({ contact_name: "", contact_title: "직원" }));
    expect(v.ok).toBe(false);
    expect(v.blocks.find((b) => b.key === "contact")?.message).toContain("직원");
  });
  it("대표 아님인데 연락처 상태 없음 / 확보인데 번호 없음 → 막음", () => {
    expect(validateMisuVisit(goodSecond({ rep_phone_status: "" })).ok).toBe(false);
    expect(validateMisuVisit(goodSecond({ rep_phone: "" })).ok).toBe(false);
    expect(validateMisuVisit(goodSecond({ rep_phone_status: "거부", rep_phone: "" })).ok).toBe(true);
  });
  it("문 잠김이면 근거 1개 이상, '진술 없음'은 근거 아님", () => {
    expect(validateMisuVisit(goodSecond({ open_status: "문 잠김" })).blocks.map((b) => b.key)).toContain("locked");
    expect(validateMisuVisit(goodSecond({ open_status: "문 잠김", evid_neighbor: "진술 없음" })).ok).toBe(false);
    expect(validateMisuVisit(goodSecond({ open_status: "문 잠김", evid_sign: "철거" })).ok).toBe(true);
  });
  it("아무도 없음이면 ①은 충족, ② 근거 필수", () => {
    const base = { no_contact: true, contact_name: "", contact_title: "", contact_is_rep: null, open_status: "" as const, dun_methods: ["안내문 봉함 투입"] };
    const v = validateMisuVisit(goodSecond({ ...base }));
    expect(v.blocks.map((b) => b.key)).toEqual(["locked"]);
    expect(validateMisuVisit(goodSecond({ ...base, evid_mail: "2주" })).ok).toBe(true);
    expect(contactSentence(goodSecond(base))).toBe("응대자 없음(문 잠김)");
  });
  it("2차는 반환 요구 3요소 필수, 1차는 선택", () => {
    const noReturn = { return_requested: false, return_to: "", return_reply: "", return_method: "" };
    expect(validateMisuVisit(goodSecond(noReturn)).blocks.map((b) => b.key)).toContain("return");
    expect(validateMisuVisit(goodSecond({ return_method: "안내 못함" })).ok).toBe(false);
    expect(validateMisuVisit(goodSecond({ ...noReturn, visit_round: "1차 안내" })).ok).toBe(true);
  });
  it("사진: 2차는 막음(칸별 불가 사유면 통과), 1차는 경고 + missing", () => {
    const three = ALL_PHOTOS.slice(0, 3);
    expect(validateMisuVisit(goodSecond({ photos: three })).blocks.map((b) => b.key)).toContain("photos");
    expect(validateMisuVisit(goodSecond({ photos: three, photo_skips: { notice: "거부" } })).ok).toBe(true);
    const first = validateMisuVisit(goodSecond({ visit_round: "1차 안내", photos: three }));
    expect(first.ok).toBe(true);
    expect(first.warns.map((w) => w.key)).toContain("photos");
    expect(first.missing).toEqual(["④ 사진 4장"]);
  });
  it("현장 판단 + 사유 필수", () => {
    expect(validateMisuVisit(goodSecond({ judgment_reason: "" })).ok).toBe(false);
    expect(validateMisuVisit(goodSecond({ judgment: "" })).ok).toBe(false);
  });
  it("안내문 전달인데 봉함 확인 없으면 막음", () => {
    expect(validateMisuVisit(goodSecond({ rules_ack: {} })).blocks.map((b) => b.key)).toContain("sealed");
  });
  it("08~21시 밖: 사유 없으면 막음, 있으면 경고", () => {
    expect(isOffHours("2026-10-22T12:00:00Z")).toBe(false); // 21:00 KST 허용
    expect(isOffHours("2026-10-22T12:01:00Z")).toBe(true); // 21:01
    expect(isOffHours("2026-10-21T22:59:00Z")).toBe(true); // 07:59
    expect(isOffHours("2026-10-21T23:00:00Z")).toBe(false); // 08:00
    const late = "2026-10-22T13:30:00Z";
    expect(validateMisuVisit(goodSecond({ visited_at: late })).blocks.map((b) => b.key)).toContain("offHours");
    const ok = validateMisuVisit(goodSecond({ visited_at: late, rules_ack: { sealed: true, offHoursReason: "고객 요청 시간" } }));
    expect(ok.ok).toBe(true);
    expect(ok.warns.map((w) => w.key)).toContain("offHours");
  });
  it("금지 표현은 경고", () => {
    const v = validateMisuVisit(goodSecond({ dun_reply: "신용불량 된다고 안내" }));
    expect(v.ok).toBe(true);
    expect(v.warns.map((w) => w.key)).toContain("forbidden");
  });
});

describe("카톡 본문", () => {
  it("설계안 출력 형식", () => {
    const text = buildMisuKakaoText(goodSecond(), { albumUrl: "https://a/?album=1" });
    expect(text).toBe([
      "/미수 방문 2차(경고)",
      "업체: ○○학원 (거래처코드 2139567243 · 임순 3004)",
      "미수: 5개월 · 2,140,050원",
      "방문: 2026-10-22(목) 14:20 · 작성 이민구(C)",
      "",
      "① 응대자: 김○○ / 점장 / 대표자 아님 · 대표자 연락처 확보(010-0000-0000)",
      "② 운영 여부: 영업중",
      '③ 미수 독촉: 점장에게 구두 안내, 안내문 봉함 후 전달. "대표에게 전달하겠다", 납부 약속 없음',
      '④ 기기 반환: 점장에게 반환 요구 고지, 반송 주소 안내. "대표 확인 후 회신"',
      "⑤ 사진: 외부 · 출입문 · 기기+S/N · 안내문 4장",
      "⑥ 현장 판단: 소송이관 — 2차 경고 후 무응답",
      "",
      "📷 사진 4장 모아보기:",
      "https://a/?album=1",
    ].join("\n"));
  });
  it("금액 표기", () => {
    expect(formatMisuAmount("", "1,000")).toBe("1,000원");
    expect(formatMisuAmount("3개월", "")).toBe("3개월");
  });
});

describe("차수 제안·상태·체크리스트", () => {
  const first = asRow(goodSecond({
    id: "v1", visit_round: "1차 안내", visited_at: "2026-10-01T03:00:00Z",
    return_requested: false, return_to: "", return_reply: "", return_method: "", judgment: "계속 독촉", judgment_reason: "납부 의사 있음",
  }), "2026-10-01T03:10:00Z");
  const second = asRow(goodSecond(), "2026-10-22T05:35:00Z");

  it("다음 차수 제안", () => {
    expect(suggestNextRound([]).round).toBe("1차 안내");
    expect(suggestNextRound([first]).round).toBe("2차 경고");
    expect(suggestNextRound([first, second])).toMatchObject({ round: "추가", count: 2, lastRound: "2차 경고", lastAuthor: "이민구" });
    expect(suggestNextRound([{ ...first, _hidden: true }]).round).toBe("1차 안내");
  });
  it("상태 칩 우선순위", () => {
    expect(misuVendorStatus([])).toBe("방문 기록 없음");
    expect(misuVendorStatus([first])).toBe("1차만");
    expect(misuVendorStatus([first, second])).toBe("소송이관 준비 완료");
    expect(misuVendorStatus([first, { ...second, judgment: "계속 독촉" }])).toBe("반환요구 기록 있음");
    expect(misuVendorStatus([{ ...first, missing: ["④ 사진 4장"] }, { ...second, judgment: "계속 독촉" }])).toBe("보완 필요");
    expect(misuVendorStatus([first, { ...second, judgment: "계속 독촉", return_requested: false }])).toBe("2차 완료");
  });
  it("체크리스트 ⓐ~ⓖ", () => {
    const cl = litigationChecklist([second]);
    expect(cl.ready).toBe(false);
    expect(cl.items.filter((i) => !i.ok).map((i) => i.key)).toEqual(["a"]);
    const late = asRow(goodSecond({ id: "v3", visit_round: "추가", visited_at: "2026-10-23T13:00:00Z", rules_ack: { sealed: true, offHoursReason: "x" } }), "2026-10-23T13:05:00Z");
    expect(litigationChecklist([first, second, late]).items.find((i) => i.key === "g")?.ok).toBe(false);
  });
  it("보완 기록이 원 기록을 대신한다", () => {
    const bad = { ...first, missing: ["④ 사진 4장"] };
    const fix = asRow({ ...first, id: "v1s", supplement_of: "v1", missing: [] }, "2026-10-02T00:00:00Z");
    expect(effectiveMisuVisits([bad, fix]).map((v) => v.id)).toEqual(["v1s"]);
    expect(misuVendorStatus([bad, fix])).toBe("1차만");
  });
  it("법무 전달용 복사 본문", () => {
    const t = buildLegalCopyText([second, first]);
    expect(t.split("\n")[0]).toBe("[소송이관 CS 방문이력] ○○학원");
    expect(t).toContain("준비 체크: ⓐ✓ ⓑ✓ ⓒ✓ ⓓ✓ ⓔ✓ ⓕ✓ ⓖ✓ (완료)");
    expect(t.indexOf("1차 안내 · 2026-10-01(목) 12:00 방문")).toBeLessThan(t.indexOf("2차 경고 · 2026-10-22(목) 14:20 방문"));
  });
});

describe("업체 묶기·타임라인", () => {
  it("코드 > 임순 > 이름 순으로 같은 업체", () => {
    expect(matchMisuVendor({ company_code: "1", vendor: "가" }, { company_code: "2", vendor: "가" })).toBeNull();
    expect(matchMisuVendor({ lease_seq: "3004" }, { lease_seq: "3004", vendor: "다른" })).toBe("lease");
    expect(matchMisuVendor({ vendor: "㈜ 행복 학원" }, { vendor: "주식회사행복학원" })).toBe("name");
  });
  it("코드 없는 기록이 이름으로 붙는다", () => {
    const a = asRow(goodSecond({ id: "a" }), "2026-10-22T06:00:00Z");
    const b = asRow(goodSecond({ id: "b", company_code: "", lease_seq: "", vendor: "(주)○○학원", visited_at: "2026-10-01T03:00:00Z" }), "2026-10-01T03:00:00Z");
    const c = asRow(goodSecond({ id: "c", company_code: "999", vendor: "딴곳" }), "2026-10-02T00:00:00Z");
    const groups = groupMisuVisitsByVendor([b, c, a]);
    expect(groups).toHaveLength(2);
    const g = groups.find((x) => x.company_code === "2139567243")!;
    expect(g.visits.map((v) => v.id)).toEqual(["a", "b"]);
    expect(g.linkedBy).toBe("name");
  });
  it("옛 카톡 기록과 섞어 최신 위, 보완은 원 기록 아래", () => {
    const v1 = asRow(goodSecond({ id: "v1", visited_at: "2026-10-01T03:00:00Z" }), "2026-10-01T03:00:00Z");
    const s1 = asRow(goodSecond({ id: "s1", supplement_of: "v1", visited_at: "2026-10-01T03:00:00Z" }), "2026-10-05T00:00:00Z");
    const v2 = asRow(goodSecond({ id: "v2", visited_at: "2026-10-22T05:20:00Z" }), "2026-10-22T05:30:00Z");
    const tl = mergeMisuTimeline([s1, v1, v2], [
      { at: "2026. 6. 23", source: "카톡", text: "옛 기록" },
      { at: "2026-10-01 12:00", source: "카톡", text: "같은 시각" },
      { at: "모름", source: "관리부메모", text: "날짜 없음" },
      { at: "2026-10-10", source: "관리부메모", text: "중간" },
    ]);
    expect(tl.map((e) => (e.kind === "visit" ? `${e.visit.id}${e.supplement ? "↳" : ""}` : e.entry.text))).toEqual([
      "v2", "중간", "v1", "s1↳", "같은 시각", "옛 기록", "날짜 없음",
    ]);
  });
  it("느슨한 날짜 정렬 키", () => {
    expect(looseSortKey("24.03.05")).toBe("2024-03-05 00:00");
    expect(looseSortKey("2024/3/5 9:07")).toBe("2024-03-05 09:07");
    expect(looseSortKey("2026-10-21T15:30:00Z")).toBe("2026-10-22 00:30");
    expect(looseSortKey("")).toBe("");
  });
});
