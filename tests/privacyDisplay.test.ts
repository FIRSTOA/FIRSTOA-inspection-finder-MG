/**
 * 주민번호 가림 — 표시 경로별(2026-10-22). 원본 행은 그대로 두고 화면·CSV·카톡 글·AI 로 나가는 글만 가린다.
 * 규칙 자체는 tests/privacy.test.ts.
 */
import { describe, expect, it } from "vitest";
import { lookupCsv, lookupText } from "../src/lookupCells";
import { deriveState, SOURCES, toEvent, withKeys, type Entity, type SourceResult } from "../src/entity360";
import { toLines } from "../src/tabSearch";
import { kakaoRowToLegacy, sheetMemosToLegacy } from "../src/misuVisitHistoryData";
import { buildMisuKakaoText, emptyMisuVisitDraft } from "../src/misuVisit";

const RRN = "900101-1234567";
const RRN13 = "9001012234567";
const SERIAL = "8001104123456";   // 실제 기기 시리얼 모양(13자리) — 가리면 안 된다
const src = (table: string) => SOURCES.find((s) => s.table === table)!;
const entity: Entity = withKeys({ code: RRN13, leaseCode: "21462", name: "개인고객", names: ["개인고객"], serials: [SERIAL], assets: ["A1"], core: "개인고객", query: "개인고객", leaseRows: [] });

describe("조회 탭(DataLookup) — 표 칸·CSV", () => {
  const row = { id: 1, _업체명: "개인고객", 거래처코드: RRN13, 시리얼넘버: SERIAL, 특이사항: `대표 ${RRN}`, _raw: { "거래처 코드": RRN13 } };
  it("칸 글자", () => {
    expect(lookupText(row, "거래처코드")).toBe("900101-2******");
    expect(lookupText(row, "특이사항")).toBe("대표 900101-1******");
    expect(lookupText(row, "시리얼넘버")).toBe(SERIAL);
    expect(lookupText(row, "_raw")).toBe('{"거래처 코드":"900101-2******"}');
    expect(lookupText({ v: "#N/A" }, "v")).toBe("");
  });
  it("CSV 내보내기에도 원본이 안 나간다", () => {
    const csv = lookupCsv([{ key: "_업체명", label: "업체" }, { key: "거래처코드", label: "코드" }, { key: "특이사항", label: "특이" }, { key: "시리얼넘버", label: "S/N" }], [row]);
    expect(csv).toBe(["업체,코드,특이,S/N", `개인고객,900101-2******,대표 900101-1******,${SERIAL}`].join("\n"));
    expect(csv).not.toContain("1234567");
    expect(csv).not.toContain(RRN13);
  });
});

describe("통합 검색 360 — 사건·상태 카드", () => {
  it("toEvent 제목·요약은 가리고 원본 row·시리얼은 그대로", () => {
    const r = { id: 1, 작성일: "2026-10-01", 처리내용: `계약자 ${RRN}`, 특이사항: `주민번호 ${RRN13}`, 시리얼넘버: SERIAL };
    const ev = toEvent(src("jeomgeom"), r, false);
    expect(ev.title).toBe("계약자 900101-1******");
    expect(ev.snippet).toContain("주민번호 900101-2******");
    expect(ev.serial).toBe(SERIAL);
    expect(ev.row.처리내용).toBe(`계약자 ${RRN}`);
  });
  it("deriveState — 워킨맵 메모·임대 조건·키맨의 주민번호를 가린다", () => {
    const lease = [{ id: 1, 모델명: "D450", 기번: SERIAL, 키맨: `홍길동 ${RRN}`, 추가조건: `명의 ${RRN}`, 등급: "N" }];
    const results: SourceResult[] = [
      { source: src("vendor_info"), exact: lease, loose: [], ok: true },
      { source: src("workin_map_places"), exact: [{ id: 2, team: "C", quarter: 4, kind: "quarter", label: "G1", memos: ["원주희(개인)", "790327-2123456"] }], loose: [], ok: true },
    ];
    const s = deriveState(withKeys({ ...entity, leaseRows: lease }), results, new Date("2026-10-22T12:00:00+09:00"));
    expect(s.keyman).toBe("홍길동 900101-1******");
    expect(JSON.stringify(s)).not.toMatch(/\d{6}-\d{7}/);
    expect(s.notes.map((n) => n.text)).toContain("790327-2******");
    expect(s.devices[0].serial).toBe(SERIAL);
  });
});

describe("필드 탭 검색", () => {
  it("기기 줄의 13자리 시리얼은 그대로(예전엔 900101-… 꼴로 잘못 가려졌다), 원문 주민번호는 가림", () => {
    const lines = toLines("inspection", [{ source: src("jeomgeom"), exact: [{ id: 1, 작성일: "2026-10-01", 처리내용: "점검", 시리얼넘버: SERIAL, _원문: `고객 ${RRN}` }], loose: [], ok: true }], entity);
    expect(lines[0].device).toContain(`S/N ${SERIAL}`);
    expect(lines[0].raw).toBe("고객 900101-1******");
  });
});

describe("미수 — 이전 기록·카톡 글", () => {
  it("카톡 행·시트 메모", () => {
    expect(kakaoRowToLegacy({ 입력자: "이민구", 원문: `이민구: 계약자 ${RRN} 방문`, 입력일: "2026-06-01" })!.text).toBe("계약자 900101-1****** 방문");
    expect(sheetMemosToLegacy({ 입력일: "2026-06-01", CS체크: `주민 ${RRN}` })[0].text).toBe("주민 900101-1******");
  });
  it("카톡방에 나가는 업체 줄의 거래처코드(개인=주민번호)는 가리고, 사업자번호는 그대로", () => {
    const base = { id: "v1", visit_round: "1차 방문", visited_at: "2026-10-22T05:20:00Z", author: "이민구", author_team: "C", vendor: "개인고객", lease_seq: "3004" } as const;
    const personal = buildMisuKakaoText(emptyMisuVisitDraft({ ...base, company_code: RRN13 }));
    expect(personal).toContain("업체: 개인고객 (거래처코드 900101-2****** · 임순 3004)");
    expect(personal).not.toContain(RRN13);
    expect(buildMisuKakaoText(emptyMisuVisitDraft({ ...base, company_code: "2139567243" }))).toContain("거래처코드 2139567243");
  });
});

describe("미수 — 법무 이관 복사본", () => {
  it("거래처코드(주민번호) 가림", async () => {
    const { buildLegalCopyText } = await import("../src/misuVisit");
    const text = buildLegalCopyText([], { vendor: "개인고객", company_code: RRN13, lease_seq: "3004" });
    expect(text).toContain("거래처코드 900101-2******");
    expect(text).not.toContain(RRN13);
  });
});

describe("조회 탭 기록 수정 — 원본 초기값·주민번호 칸 잠금", () => {
  it("일반 칸은 원본 값으로 시작, 주민번호 든 칸은 잠금(가린 글자 표시, 원본 보존)", async () => {
    const { editFieldState } = await import("../src/lookupCells");
    const row = { 특이사항: `대표 ${RRN}`, 시리얼넘버: SERIAL, 처리내용: "토너 교체", 매수: 1234, 내용: null };
    expect(editFieldState(row, "처리내용")).toEqual({ initial: "토너 교체", locked: false, shown: "토너 교체" });
    expect(editFieldState(row, "시리얼넘버")).toEqual({ initial: SERIAL, locked: false, shown: SERIAL });
    expect(editFieldState(row, "매수").initial).toBe("1234");
    expect(editFieldState(row, "내용").initial).toBe("");
    const locked = editFieldState(row, "특이사항");
    expect(locked.locked).toBe(true);
    expect(locked.shown).toBe("대표 900101-1******");
    expect(row.특이사항).toBe(`대표 ${RRN}`);
  });
});

describe("워킨맵 엑셀 가져오기 — 가린 값이 원본을 덮지 않는다", () => {
  it("기존 장소는 기존 값 유지, 새 장소는 비움", async () => {
    const { hasMaskMark, restoreMaskedImport } = await import("../src/workinPrivacy");
    const { maskRrn } = await import("../src/privacy");
    const existing = [{ number: 1, name: "개인고객", comment: `D450 / ${SERIAL} / ${RRN}`, memos: ["원주희(개인)", "790327-2123456", "방문주기 1개월"] }];
    // 내보낸 파일 그대로(가림 적용) + 새 장소 하나
    const imported = [
      { number: 1, name: "개인고객", comment: maskRrn(existing[0].comment), memos: existing[0].memos.map(maskRrn) },
      { number: 2, name: "새고객", comment: "880101-1******", memos: ["엘베 없음", "880101-2******"] },
    ];
    expect(hasMaskMark(imported[0].comment)).toBe(true);
    expect(hasMaskMark(`S/N ${SERIAL}`)).toBe(false);
    const r = restoreMaskedImport(imported, existing);
    expect(r.places[0].comment).toBe(existing[0].comment);
    expect(r.places[0].memos).toEqual(existing[0].memos);
    expect(r.places[1].comment).toBe("");
    expect(r.places[1].memos).toEqual(["엘베 없음"]);
    expect(r.kept).toBe(2);
    expect(r.cleared).toBe(2);
    expect(JSON.stringify(r.places)).not.toContain("******");
  });
});
