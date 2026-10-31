import { describe, expect, it } from "vitest";
import {
  applyRules, classifyWork, colorOf, decodeHtml, diffPlace, isAuthorized, labelOf, matchPlaces, mergeMemos, newPlaceGuard,
  chunkPatchRows, nextScheduledRun, normalizeRemoteWork, parseRequest, parseWorkName, planPull, SYNC_ACTOR, workGuard,
  addressHeadKey, exactNameKey, looseNameKey, normText, tailNameKey,
  memoCompareKey, memoSlotOf, planMemoDateBackfill, stripMemoTail,
  type LocalPlace, type RemotePlace,
} from "../supabase/functions/workinmap-sync/plan.ts";
import { getIdToken, readAccounts, scrub, type TokenRow, type TokenStore } from "../supabase/functions/workinmap-sync/auth.ts";
import { parseWorkList } from "../supabase/functions/workinmap-sync/api.ts";
import { runAction, type SyncDeps } from "../supabase/functions/workinmap-sync/sync.ts";

// ── parseWorkName ────────────────────────────────────────────────
describe("parseWorkName — 실측 워크 이름(설계 v2-A3)", () => {
  const cases: Array<[string, string, number, number, string]> = [
    ["수도권C_26년4분기점검(26.10.26)", "C", 2026, 4, "quarter"],
    ["계약종료C_26년4분기(10월,11월,01월)(260927)", "C", 2026, 4, "renewal"],
    ["수도권D_26년4분기점검(26.10.26)", "D", 2026, 4, "quarter"],
    ["수도권C_26년4분기매월점검(26.09.29)", "C", 2026, 4, "monthly"],
    ["계약종료D_26년4분기(10월,11월,01월)(260927)", "D", 2026, 4, "renewal"],
    ["수도권A_26년4분기점검(26.10.26)", "A", 2026, 4, "quarter"],
    ["수도권B_26년4분기점검(26.10.26)", "B", 2026, 4, "quarter"],
    ["계약종료B_26년4분기(10월,11월,01월)(260927)", "B", 2026, 4, "renewal"],
    ["계약종료A_26년4분기(10월,11월,01월)(260927)", "A", 2026, 4, "renewal"],
    ["수도권B_26년3분기점검(26.08.31)", "B", 2026, 3, "quarter"],
    ["수도권A_26년3분기점검(26.08.31)", "A", 2026, 3, "quarter"],
    ["계약종료A_26년2분기(5월,6월,7월)(260527)", "A", 2026, 2, "renewal"],
    ["계약종료A_26년3분기(8월,9월,10월)_260527", "A", 2026, 3, "renewal"],
    ["계약종료B_26년3분기(8월,9월,10월)(260527)", "B", 2026, 3, "renewal"],
    ["계약종료B_26년2분기(5월,6월,7월)(260527)", "B", 2026, 2, "renewal"],
    // C·D 2·3분기는 정확한 이름 미수령 — 같은 형식 가정(설계 v2-G Q1)
    ["계약종료C_26년3분기(8월,9월,10월)(260527)", "C", 2026, 3, "renewal"],
    ["계약종료D_26년2분기(5월,6월,7월)(260527)", "D", 2026, 2, "renewal"],
    ["수도권C_26년3분기점검(26.08.31)", "C", 2026, 3, "quarter"],
    ["수도권D_26년3분기점검(26.08.31)", "D", 2026, 3, "quarter"],
    ["수도권C_26년3분기매월점검(26.06.30)", "C", 2026, 3, "monthly"],
  ];
  it.each(cases)("%s", (name, team, year, quarter, kind) => {
    expect(parseWorkName(name)).toEqual({ team, year, quarter, kind });
  });

  it("제외·해석 불가", () => {
    expect(parseWorkName("영업확장성리스트_박P_워킨맵표현")).toBeNull();
    expect(classifyWork({ id: "a".repeat(24), name: "영업확장성리스트_박P_워킨맵표현" }).status).toBe("excluded");
    expect(classifyWork({ id: "b".repeat(24), name: "아무 워크" }).status).toBe("unparsed");
    expect(parseWorkName("수도권C_4분기점검")).toBeNull();          // 연도 없음
    expect(parseWorkName("수도권CD_26년4분기점검")).toBeNull();      // 팀 글자 경계
    expect(parseWorkName("수도권C_26년4분기(26.10.26)")).toBeNull(); // 업무 글자 없음
    expect(classifyWork({ id: "c".repeat(24), name: "수도권C_26년4분기점검(26.10.26)" }, { exclude: ["c".repeat(24)] }).status).toBe("excluded");
  });

  it("테스트 워크 = 팀 T(이름 또는 id 로 지정)", () => {
    expect(parseWorkName("26.10.31 동기화 테스트")).toBeNull();
    expect(parseWorkName("26.10.31 동기화 테스트", { testWork: "26.10.31 동기화 테스트" })).toEqual({ team: "T", year: 2026, quarter: 4, kind: "quarter", test: true });
    const byId = classifyWork({ id: "d".repeat(24), name: "26.10.31 동기화 테스트" }, { testWork: "d".repeat(24) });
    expect(byId.status).toBe("target");
    expect(byId.parse?.team).toBe("T");
  });
});

// ── 색 ───────────────────────────────────────────────────────────
describe("labelOf / colorOf", () => {
  it("0~11 ↔ G1~G12 왕복", () => {
    for (let n = 0; n < 12; n += 1) {
      expect(labelOf(n)).toBe(`G${n + 1}`);
      expect(colorOf(labelOf(n))).toBe(n);
    }
    expect(labelOf("4")).toBe("G5");
    expect(labelOf(12)).toBeNull();
    expect(labelOf(-1)).toBeNull();
    expect(labelOf(null)).toBeNull();
    expect(colorOf("G13")).toBeNull();
    expect(colorOf("x")).toBeNull();
  });
});

// ── 공용 재료 ─────────────────────────────────────────────────────
const WORK = "6aaa410a66d17921d76c9c65";
const WORK2 = "7bbb410a66d17921d76c9c66";
const rp = (o: Partial<RemotePlace> & { extId: string; name: string }): RemotePlace => ({
  seq: 1, comment: "", phone: "", address: "", addressDetail: "", latitude: null, longitude: null, label: "G1", visible: true,
  memos: [], lastUpdate: "2026-10-31T03:00:00.000Z", labelColor: 0, ...o,
});
const lp = (o: Partial<LocalPlace> & { id: number; name: string }): LocalPlace => ({
  number: 1, team: "C", quarter: 4, kind: "quarter", label: "G1", visible: true, comment: "", phone: "", address: "", address_detail: "",
  latitude: 0, longitude: 0, memos: [], ext_id: null, ...o,
});

// ── 짝짓기 ───────────────────────────────────────────────────────
describe("matchPlaces — ext_id → 번호+이름 → 이름+주소", () => {
  it("3단계 순서와 새 장소", () => {
    const remote = [
      rp({ extId: "e1", name: "가나상사", seq: 1 }),
      rp({ extId: "e2", name: "(주)다라물산", seq: 2 }),
      rp({ extId: "e3", name: "마바산업", seq: 9, address: "서울 강남구 테헤란로 1" }),
      rp({ extId: "e4", name: "새로운곳", seq: 4 }),
    ];
    const local = [
      lp({ id: 10, name: "가나상사", ext_id: "e1", number: 7 }),
      lp({ id: 11, name: "다라물산", number: 2 }),
      lp({ id: 12, name: "마바산업㈜", number: 3, address: "서울 강남구 테헤란로 1" }),
    ];
    const m = matchPlaces(remote, local);
    expect(m.pairs.map((p) => [p.remote.extId, p.local.id, p.by])).toEqual([
      ["e1", 10, "ext_id"], ["e2", 11, "number_name"], ["e3", 12, "name_address"],
    ]);
    expect(m.fresh.map((r) => r.extId)).toEqual(["e4"]);
    expect(m.ambiguous).toEqual([]);
  });

  it("같은 건물 2지점(후보 2개+)은 짝짓지 않고 ambiguous", () => {
    const remote = [rp({ extId: "x1", name: "한빛", seq: 50, address: "서울 중구 1" })];
    const local = [lp({ id: 1, name: "한빛", number: 3, address: "서울 중구 1" }), lp({ id: 2, name: "한빛", number: 4, address: "서울 중구 1" })];
    const m = matchPlaces(remote, local);
    expect(m.pairs).toEqual([]);
    expect(m.ambiguous).toEqual([{ remote: remote[0], candidates: [1, 2], reason: "multiple_candidates" }]);
  });

  it("워킨맵 쪽에 같은 이름+주소가 둘이면 앱 행이 하나여도 둘 다 ambiguous", () => {
    const remote = [rp({ extId: "y1", name: "한빛", seq: 50, address: "A동" }), rp({ extId: "y2", name: "한빛", seq: 51, address: "A동" })];
    const m = matchPlaces(remote, [lp({ id: 1, name: "한빛", number: 3, address: "A동" })]);
    expect(m.pairs).toEqual([]);
    expect(m.ambiguous.map((a) => a.remote.extId)).toEqual(["y1", "y2"]);
  });

  it("이 워크에 붙었던 행이 응답에 없으면 missing", () => {
    const m = matchPlaces([rp({ extId: "e1", name: "가" })], [lp({ id: 1, name: "가", ext_id: "e1", ext_work_id: WORK }), lp({ id: 2, name: "나", ext_id: "gone", ext_work_id: WORK })], { workId: WORK });
    expect(m.missing.map((l) => l.id)).toEqual([2]);
  });
});

// ── 2026-10-31 첫 dry 실측 뒤 보강 ─────────────────────────────────
describe("첫 dry 실측 보강 — 줄바꿈 정규화 · ③ 짝짓기 강화 · 표본", () => {
  it("normText: CRLF/LF·빈 줄·앞뒤 공백·_x000d_ 차이는 같은 값(LF)", () => {
    expect(normText("A\r\nB")).toBe("A\nB");
    expect(normText("A\n\nB")).toBe("A\nB");
    expect(normText("  A \r\n\r\n\r\n B  \n")).toBe("A\n B");
    expect(normText("A_x000d_\nB")).toBe("A\nB");
    expect(normText(null)).toBe("");
  });

  it("diffPlace: 앱 \"A\\n\\nB\" vs 워킨맵 \"A\\r\\nB\" 는 변경 아님, 진짜 다르면 저장 값은 LF", () => {
    const l = lp({ id: 1, name: "가", phone: "010-1\n\n02-2", comment: "키맨\n", address: "서울 중구 1", address_detail: "" });
    expect(diffPlace(rp({ extId: "e", name: "가", label: "G1", phone: "010-1\r\n02-2", comment: "키맨", address: " 서울 중구 1\r\n", addressDetail: "" }), l)).toEqual([]);
    const d = diffPlace(rp({ extId: "e", name: "가", phone: "010-9\r\n02-2" }), l);
    expect(d.find((c) => c.field === "phone")?.after).toBe("010-9\n02-2");
  });

  it("normalizeRemoteWork 가 텍스트 칸·메모를 LF 로 정리", () => {
    const n = normalizeRemoteWork({ _id: WORK, name: "w", places: [{ _id: "p1", name: "가\r\n", number: "010\r\n\r\n02", memo2: [{ content: "줄1\r\n줄2" }] }] });
    if (!n.ok) throw new Error(n.error);
    expect(n.work.places[0]).toMatchObject({ name: "가", phone: "010\n02", memos: ["줄1\n줄2"] });
  });

  it("③ 이름 느슨한 키 + 주소 앞부분(시·도 표기·층·괄호 무시)으로 짝", () => {
    expect(addressHeadKey("서울특별시 강남구 테헤란로 1, 3층")).toBe(addressHeadKey("서울 강남구 테헤란로 1 (역삼동)"));
    expect(addressHeadKey("서울 강남구 테헤란로 1")).not.toBe(addressHeadKey("서울 강남구 테헤란로 12"));
    expect(looseNameKey("주식회사 마바산업")).toBe(looseNameKey("마바산업㈜"));
    const remote = [rp({ extId: "r1", name: "주식회사 마바산업", seq: 40, address: "서울특별시 강남구 테헤란로 1, 3층" })];
    const m = matchPlaces(remote, [lp({ id: 7, name: "마바산업㈜", number: 3, address: "서울 강남구 테헤란로 1 (역삼동)" })]);
    expect(m.pairs.map((p) => [p.remote.extId, p.local.id, p.by])).toEqual([["r1", 7, "name_address"]]);
    expect(m.unmatchedLocal).toEqual([]);
  });

  it("③ 강화 뒤에도 후보 2개+ 면 ambiguous, 번지 다르면 새 장소", () => {
    const remote = [rp({ extId: "r1", name: "마바산업", seq: 40, address: "서울 강남구 테헤란로 1" }), rp({ extId: "r2", name: "마바산업", seq: 41, address: "서울 강남구 테헤란로 99" })];
    const local = [lp({ id: 1, name: "(주)마바산업", number: 3, address: "서울특별시 강남구 테헤란로 1, 2층" }), lp({ id: 2, name: "마바산업 주식회사", number: 4, address: "서울 강남구 테헤란로 1 5층" })];
    const m = matchPlaces(remote, local);
    expect(m.pairs).toEqual([]);
    expect(m.ambiguous).toEqual([{ remote: remote[0], candidates: [1, 2], reason: "multiple_candidates" }]);
    expect(m.fresh.map((r) => r.extId)).toEqual(["r2"]);
    expect(m.unmatchedLocal.map((l) => l.id)).toEqual([1, 2]);
  });

  it("2차 실측: 같은 업체·같은 주소 기기 여러 대는 정규화한 전체 이름 완전 일치로 1:1 짝(앱 _x000d_\n vs 워킨맵 CRLF)", () => {
    const floors = ["K2 7층 오른쪽", "K2 7층 왼쪽", "K2 8층"];
    const remote = floors.map((f, i) => rp({ extId: `k${i}`, name: `19V엔티에스케이투\r\n${f} 매월마감`, seq: 60 + i, address: "서울 금천구 가산디지털1로 1" }));
    const local = floors.map((f, i) => lp({ id: 50 + i, name: `19V엔티에스케이투_x000d_\n${f} 매월마감`, number: 90 + i, address: "서울 금천구 가산디지털1로 1" }));
    const m = matchPlaces(remote, [...local].reverse());
    expect(m.pairs.map((p) => [p.remote.extId, p.local.id, p.by])).toEqual([["k0", 50, "exact_name"], ["k1", 51, "exact_name"], ["k2", 52, "exact_name"]]);
    expect(m.ambiguous).toEqual([]);
    expect(exactNameKey("19V엔티에스케이투_x000d_\nK2  8층")).toBe(exactNameKey("19V엔티에스케이투\r\nK2 8층"));
  });

  it("완전 일치가 양쪽 개수가 다르면(N:M) 그 단계에선 짝짓지 않고 다음 단계(번호+이름)로", () => {
    const remote = [rp({ extId: "a", name: "휴스틸", seq: 1, address: "서울 중구 세종대로 1" }), rp({ extId: "b", name: "휴스틸", seq: 2, address: "서울 중구 세종대로 1" }), rp({ extId: "c", name: "휴스틸", seq: 3, address: "서울 중구 세종대로 1" })];
    const local = [lp({ id: 1, name: "휴스틸", number: 1, address: "서울 중구 세종대로 1" }), lp({ id: 2, name: "휴스틸", number: 2, address: "서울 중구 세종대로 1" })];
    const m = matchPlaces(remote, local);
    expect(m.pairs.map((p) => [p.remote.extId, p.local.id, p.by])).toEqual([["a", 1, "number_name"], ["b", 2, "number_name"]]);
    expect(m.fresh.map((r) => r.extId)).toEqual(["c"]);
  });

  it("3차 실측: 앱에 범위 행이 0(처음 들여오는 워크)이면 50곳 상한·첫 회차 보류 없이 전부 insert + stats.firstImport", () => {
    const parse = { team: "A" as const, year: 2026, quarter: 4 as const, kind: "renewal" as const };
    const remote = Array.from({ length: 79 }, (_, i) => rp({ extId: `r${i}`, name: `계약종료${i}`, seq: i + 1, label: "G1" }));
    const common = { workId: WORK, accountNo: 1, parse, remote, local: [], firstPull: true, previousCount: null, nowIso: "2026-10-31T05:00:00.000Z", idBase: 1_000, scopeMaxNumber: 0 };
    const p = planPull({ ...common, scopeEmpty: true });
    expect(p.stop).toBeNull();
    expect(p.stats).toMatchObject({ fresh: 79, inserted: 79, firstImport: true });
    expect(p.inserts.map((x) => x.row.number)).toEqual(Array.from({ length: 79 }, (_, i) => i + 1));
    expect(p.reviews).toEqual([]);
    // 범위에 행이 있으면(scopeEmpty 아님) 기존 가드 그대로
    const guarded = planPull({ ...common, scopeEmpty: false });
    expect(guarded.stop?.reason).toBe("too_many_new");
    expect(guarded.stats.firstImport).toBe(false);
  });

  it("처음 들여오는 워크라도 응답 0곳이면 중단(empty)", () => {
    const parse = { team: "B" as const, year: 2026, quarter: 4 as const, kind: "renewal" as const };
    const p = planPull({ workId: WORK, accountNo: 1, parse, remote: [], local: [], firstPull: true, previousCount: null, nowIso: "2026-10-31T05:00:00.000Z", idBase: 1_000, scopeMaxNumber: 0, scopeEmpty: true });
    expect(p.stop?.reason).toBe("empty");
    expect(p.inserts).toEqual([]);
  });

  it("3차 실측: 꼬리(매월마감·'>' 뒤 메모) 뗀 이름 + 같은 주소 1:1 이면 tail_name 으로 짝, 같은 꼬리 키가 둘이면 짝 안 함", () => {
    expect(tailNameKey("25V(주)미래에이비엠(본사)3603호 안쪽매월마감")).toBe(tailNameKey("25V(주)미래에이비엠(본사)3603호 안쪽"));
    expect(tailNameKey("가나상사 2층 > 키맨 홍길동")).toBe("가나상사 2층");
    const addr = "서울 강남구 테헤란로 7";
    const remote = [rp({ extId: "t1", name: "25V(주)미래에이비엠(본사)3603호 안쪽", seq: 80, address: addr }), rp({ extId: "t2", name: "25V(주)미래에이비엠(본사)3603호 바깥", seq: 81, address: addr })];
    const local = [
      lp({ id: 1, name: "25V(주)미래에이비엠(본사)3603호 안쪽매월마감", number: 5, address: addr }),
      lp({ id: 2, name: "25V(주)미래에이비엠(본사)3603호 바깥매월마감", number: 6, address: addr }),
    ];
    const m = matchPlaces(remote, local);
    expect(m.pairs.map((p) => [p.remote.extId, p.local.id, p.by])).toEqual([["t1", 1, "tail_name"], ["t2", 2, "tail_name"]]);
    // 주소가 다르면 이 단계로는 짝짓지 않음
    const m2 = matchPlaces([rp({ extId: "t1", name: "미래 3603호", seq: 80, address: addr })], [lp({ id: 1, name: "미래 3603호 매월마감", number: 5, address: "부산 해운대구 해운대로 1" })]);
    expect(m2.pairs.filter((p) => p.by === "tail_name")).toEqual([]);
  });

  it("samples.ambiguous: 워킨맵 이름·주소·labelColor + 후보 앱 행", () => {
    const parse = { team: "C" as const, year: 2026, quarter: 4 as const, kind: "quarter" as const };
    const addr = "서울 중구 세종대로 1";
    const remote = [rp({ extId: "h1", name: "휴스틸 본사", seq: 9, address: addr, labelColor: 2, label: "G3" })];
    const local = [lp({ id: 1, name: "휴스틸 14층", number: 1, address: addr }), lp({ id: 2, name: "휴스틸 15층", number: 2, address: addr })];
    const p = planPull({ workId: WORK, accountNo: 1, parse, remote, local, firstPull: false, previousCount: null, nowIso: "2026-10-31T05:00:00.000Z", idBase: 1_000, scopeMaxNumber: 2 });
    expect(p.stats.ambiguous).toBe(1);
    expect(p.samples.ambiguous).toEqual([{ extId: "h1", seq: 9, name: "휴스틸 본사", address: addr, labelColor: 2, candidates: [
      { id: 1, number: 1, name: "휴스틸 14층", address: addr }, { id: 2, number: 2, name: "휴스틸 15층", address: addr },
    ] }]);
  });

  it("첫 가져오기 완료 보존(keepAppDone): 앱 G5 가 워킨맵보다 늦으면 앱 색 유지 + conflict + 로그 keep_done, 꺼지면 워킨맵 값", () => {
    const parse = { team: "C" as const, year: 2026, quarter: 4 as const, kind: "quarter" as const };
    const remote = [rp({ extId: "d1", name: "완료곳", seq: 1, label: "G2", lastUpdate: "2026-10-20T00:00:00.000Z", phone: "010" })];
    const local = [lp({ id: 1, name: "완료곳", number: 1, label: "G5", phone: "02", updated_at: "2026-10-25T00:00:00.000Z" })];
    const common = { workId: WORK, accountNo: 1, parse, remote, local, firstPull: false, previousCount: null, nowIso: "2026-10-31T05:00:00.000Z", idBase: 1_000, scopeMaxNumber: 1 };
    const on = planPull({ ...common, keepAppDone: true });
    const patch = on.patches[0];
    expect(patch.set.label).toBeUndefined();
    expect(patch.set.phone).toBe("010"); // 다른 칸은 반영
    expect(patch.logs.find((l) => l.note === "keep_done")).toEqual({ field: "label", before_value: "G5", after_value: "G5", note: "keep_done" });
    expect(on.stats).toMatchObject({ keptAppDone: 1, keptLocalNewer: 1, downgrades: 0 });
    expect(on.reviews.map((r) => [r.kind, r.field, r.detail])).toEqual([["conflict", "label", expect.objectContaining({ keep: "app", from: "G5", to: "G2" })]]);
    // 워킨맵이 더 늦으면 보존하지 않음(워킨맵 값 + 알림 downgrade)
    const later = planPull({ ...common, remote: [{ ...remote[0], lastUpdate: "2026-10-30T00:00:00.000Z" }], keepAppDone: true });
    expect(later.patches[0].set.label).toBe("G2");
    expect(later.reviews.map((r) => r.kind)).toEqual(["downgrade"]);
    // 이미 ext_id 가 붙은 행은 대상 아님
    const linked = planPull({ ...common, local: [{ ...local[0], ext_id: "d1", ext_work_id: WORK }], keepAppDone: true });
    expect(linked.patches[0].set.label).toBe("G2");
    // 스위치 끔 → 워킨맵 값
    const off = planPull({ ...common, keepAppDone: false });
    expect(off.patches[0].set.label).toBe("G2");
    expect(off.stats.keptAppDone).toBe(0);
  });

  it("dry detail:true — 그 워크 전체 목록(애매·새 장소·앱만 남은 행·하강·색 변경·메모 추가), 이름은 한 줄", () => {
    expect(parseRequest({ action: "pull", scope: WORK, dryRun: true, detail: true })).toEqual({ action: "pull", scope: { workId: WORK }, dryRun: true, manual: false, detail: true });
    const parse = { team: "C" as const, year: 2026, quarter: 4 as const, kind: "monthly" as const };
    const addr = "서울 중구 세종대로 1";
    const remote = [
      rp({ extId: "a1", name: "휴스틸 본사", seq: 50, address: addr, labelColor: 2, label: "G3" }),
      ...Array.from({ length: 25 }, (_, i) => rp({ extId: `n${i}`, name: `새곳${i}
2층`, seq: 100 + i, labelColor: 0 })),
      rp({ extId: "d1", name: "단계곳", seq: 1, label: "G1", labelColor: 0 }),
      rp({ extId: "d2", name: "완료곳", seq: 2, label: "G2", labelColor: 1, memos: ["새 메모"] }),
      rp({ extId: "u1", name: "올림곳", seq: 3, label: "G3", labelColor: 2 }),
    ];
    const local = [
      lp({ id: 1, name: "휴스틸 14층", number: 40, address: addr }), lp({ id: 2, name: "휴스틸 15층", number: 41, address: addr, label: "G4" }),
      lp({ id: 3, name: "단계곳", number: 1, label: "G2" }),
      lp({ id: 4, name: "완료곳", number: 2, label: "G5", memos: ["옛 메모"] }),
      lp({ id: 5, name: "올림곳", number: 3, label: "G2" }),
    ];
    const common = { workId: WORK, accountNo: 1, parse, remote, local, firstPull: false, previousCount: null, nowIso: "2026-10-31T05:00:00.000Z", idBase: 1_000, scopeMaxNumber: 41 };
    expect(planPull(common).detail).toBeUndefined();
    const d = planPull({ ...common, withDetail: true }).detail!;
    expect(d.ambiguous).toEqual([{ extId: "a1", name: "휴스틸 본사", address: addr, labelColor: 2, reason: "multiple_candidates", candidates: [
      { id: 1, name: "휴스틸 14층", address: addr, label: "G1" }, { id: 2, name: "휴스틸 15층", address: addr, label: "G4" },
    ] }]);
    expect(d.fresh).toHaveLength(25); // 표본(20)과 달리 상한 없음
    expect(d.fresh[0]).toEqual({ extId: "n0", seq: 100, name: "새곳0 2층", address: "", labelColor: 0, similarLocal: null });
    expect(d.unmatchedLocal.map((x) => [x.id, x.label, x.duplicateOfMatched])).toEqual([[1, "G1", false], [2, "G4", false]]);
    expect(d.downgrades).toEqual([
      { id: 3, name: "단계곳", appLabel: "G2", workinmapLabel: "G1", reason: "progress_down" },
      { id: 4, name: "완료곳", appLabel: "G5", workinmapLabel: "G2", reason: "completion_down" },
    ]);
    expect(d.labelChanges).toEqual([{ id: 3, name: "단계곳", from: "G2", to: "G1" }, { id: 4, name: "완료곳", from: "G5", to: "G2" }, { id: 5, name: "올림곳", from: "G2", to: "G3" }]);
    expect(d.memoAdds).toEqual([{ id: 4, name: "완료곳", added: ["새 메모 (워킨맵 2026-10-31)"] }]);
  });

  it("4차 실측: 같은 이름·같은 주소 N:N(N≥2)은 순서로 1:1(exact_name_order), N:M 이면 ambiguous, 앱 쪽 남는 중복은 duplicateOfMatched", () => {
    const nm = "9V주식회사 지평주조송파구사무실매월마감", addr = "서울 송파구 올림픽로 1";
    const remote = [rp({ extId: "j3", name: nm, seq: 30, address: addr }), rp({ extId: "j1", name: nm, seq: 10, address: addr }), rp({ extId: "j2", name: nm, seq: 20, address: addr })];
    const local = [lp({ id: 571, name: nm, number: 8, address: addr }), lp({ id: 405, name: nm, number: 2, address: addr }), lp({ id: 900, name: nm, number: 15, address: addr })];
    const m = matchPlaces(remote, local);
    expect(m.pairs.map((p) => [p.remote.extId, p.local.id, p.by])).toEqual([["j1", 405, "exact_name_order"], ["j2", 571, "exact_name_order"], ["j3", 900, "exact_name_order"]]);
    expect(m.ambiguous).toEqual([]);
    // 주소가 다른 행이 섞이면 순서 짝 안 함
    const m2 = matchPlaces(remote, [...local.slice(0, 2), lp({ id: 900, name: nm, number: 15, address: "부산 해운대구 해운대로 9" })]);
    expect(m2.pairs.filter((p) => p.by === "exact_name_order")).toEqual([]);
    // N:M(워킨맵 2 · 앱 3) → ambiguous, 그리고 detail 에서 짝 안 된 앱 중복 표시
    const parse = { team: "C" as const, year: 2026, quarter: 4 as const, kind: "monthly" as const };
    const p = planPull({ workId: WORK, accountNo: 1, parse, remote: remote.slice(0, 2), local, firstPull: false, previousCount: null, nowIso: "2026-10-31T05:00:00.000Z", idBase: 1_000, scopeMaxNumber: 15, withDetail: true });
    expect(p.stats.byExactNameOrder).toBe(0);
    expect(p.detail!.ambiguous.map((a) => a.reason)).toEqual(["multiple_candidates", "multiple_candidates"]);
    // 2:2 + 앱 쪽 중복 1(다른 주소 표기 없음) — 순서 짝 뒤 남은 앱 행은 duplicateOfMatched
    const p2 = planPull({ workId: WORK, accountNo: 1, parse, remote: remote.slice(0, 2), local: local.slice(0, 2), firstPull: false, previousCount: null, nowIso: "2026-10-31T05:00:00.000Z", idBase: 1_000, scopeMaxNumber: 15, withDetail: true });
    expect(p2.stats.byExactNameOrder).toBe(2);
    const dupLocal = [...local.slice(0, 2), lp({ id: 1, name: "다른곳", number: 1 })];
    const p3 = planPull({ workId: WORK, accountNo: 1, parse, remote: [remote[1]], local: [lp({ id: 405, name: nm, number: 2, address: addr }), ...dupLocal.slice(2)], firstPull: false, previousCount: null, nowIso: "2026-10-31T05:00:00.000Z", idBase: 1_000, scopeMaxNumber: 15, withDetail: true });
    expect(p3.detail!.unmatchedLocal.map((x) => [x.id, x.duplicateOfMatched])).toEqual([[1, false]]);
    const p4 = planPull({ workId: WORK, accountNo: 1, parse, remote: [remote[1], remote[2]], local: [...local, lp({ id: 901, name: nm, number: 16, address: addr })].slice(0, 2).concat([lp({ id: 950, name: nm, number: 99, address: addr }), lp({ id: 951, name: nm, number: 98, address: addr })]), firstPull: false, previousCount: null, nowIso: "2026-10-31T05:00:00.000Z", idBase: 1_000, scopeMaxNumber: 99, withDetail: true });
    // 워킨맵 2 · 앱 4 → N:M 이라 짝 없음 → 중복 표시 대상 아님
    expect(p4.detail!.unmatchedLocal.every((x) => x.duplicateOfMatched === false)).toBe(true);
  });

  it("꼬리 반복 떼기(단순마감마감) + 그래도 안 맞으면 fresh 에 similarLocal(같은 주소 짝 안 된 앱 행) 표시", () => {
    expect(tailNameKey("19SS㈜기산리더스5층단순마감마감")).toBe("19SS㈜기산리더스5층");
    expect(tailNameKey("19SS㈜기산리더스5층단순마감마감")).toBe(tailNameKey("19SS㈜기산리더스5층매월마감"));
    const addr = "서울 금천구 벚꽃로 1";
    const m = matchPlaces([rp({ extId: "g1", name: "19SS㈜기산리더스5층단순마감마감", seq: 70, address: addr })], [lp({ id: 3, name: "19SS㈜기산리더스5층매월마감", number: 2, address: addr })]);
    expect(m.pairs.map((p) => [p.remote.extId, p.local.id, p.by])).toEqual([["g1", 3, "tail_name"]]);
    // 이름이 달라 짝이 안 되면 fresh 로 두고 같은 주소 앱 행을 힌트로
    const parse = { team: "C" as const, year: 2026, quarter: 4 as const, kind: "monthly" as const };
    const p = planPull({ workId: WORK, accountNo: 1, parse, remote: [rp({ extId: "g2", name: "기산 5층 복합기", seq: 71, address: "서울특별시 금천구 벚꽃로 1, 5층" })],
      // 같은 주소에 짝 안 된 앱 행이 2개라 상호 변경 잇기(address_rename)는 안 되고 fresh + 힌트(번호 순 첫 행)
      local: [lp({ id: 9, name: "엉뚱한곳", number: 1, address: "부산 중구 중앙대로 1" }), lp({ id: 3, name: "19SS㈜기산리더스5층매월마감", number: 2, address: addr }), lp({ id: 4, name: "다른회사 6층", number: 3, address: addr })],
      firstPull: false, previousCount: null, nowIso: "2026-10-31T05:00:00.000Z", idBase: 1_000, scopeMaxNumber: 2, withDetail: true });
    expect(p.stats.fresh).toBe(1);
    expect(p.detail!.fresh[0].similarLocal).toEqual({ id: 3, name: "19SS㈜기산리더스5층매월마감" });
  });

  it("5차 실측: 상호 변경 — 같은 주소의 유일한 짝 안 된 앱 행이면 address_rename 으로 이음(로그 _link note rename · field_diff name 참고)", () => {
    const parse = { team: "C" as const, year: 2026, quarter: 4 as const, kind: "monthly" as const };
    const addr = "경기 군포시 산본로 1";
    const remote = [rp({ extId: "s1", name: "산본글로벌어학원", seq: 10, address: addr })];
    const local = [lp({ id: 7, name: "산본이지어학원", number: 3, address: addr }), lp({ id: 8, name: "딴곳", number: 4, address: "서울 중구 세종대로 9" })];
    const p = planPull({ workId: WORK, accountNo: 1, parse, remote, local, firstPull: false, previousCount: null, nowIso: "2026-10-31T05:00:00.000Z", idBase: 1_000, scopeMaxNumber: 4 });
    expect(p.stats).toMatchObject({ byAddressRename: 1, fresh: 0 });
    const patch = p.patches.find((x) => x.id === 7)!;
    expect(patch.by).toBe("address_rename");
    expect(patch.set.name).toBe("산본글로벌어학원");
    expect(patch.logs.find((l) => l.field === "_link")?.note).toBe("rename");
    expect(p.reviews.map((r) => [r.kind, r.field, r.detail])).toEqual([["field_diff", "name", expect.objectContaining({ from: "산본이지어학원", to: "산본글로벌어학원" })]]);
  });

  it("상호 변경 잇기 안 함: 같은 주소에 짝 안 된 앱 행 2개+ · 그 앱 행이 이미 짝된 행의 중복 · 워킨맵 둘이 같은 앱 행을 노림", () => {
    const addr = "서울 강남구 테헤란로 5";
    const two = matchPlaces([rp({ extId: "a", name: "새이름", seq: 1, address: addr })], [lp({ id: 1, name: "옛1", number: 1, address: addr }), lp({ id: 2, name: "옛2", number: 2, address: addr })]);
    expect(two.pairs).toEqual([]);
    expect(two.fresh.map((r) => r.extId)).toEqual(["a"]);
    const dup = matchPlaces(
      [rp({ extId: "m", name: "같은곳", seq: 1, address: addr }), rp({ extId: "n", name: "새이름", seq: 2, address: addr })],
      [lp({ id: 1, name: "같은곳", number: 1, address: addr, ext_id: "m" }), lp({ id: 2, name: "같은곳", number: 2, address: addr })],
    );
    expect(dup.pairs.map((p) => p.by)).toEqual(["ext_id"]);
    expect(dup.fresh.map((r) => r.extId)).toEqual(["n"]);
    const race = matchPlaces([rp({ extId: "x", name: "새1", seq: 1, address: addr }), rp({ extId: "y", name: "새2", seq: 2, address: addr })], [lp({ id: 1, name: "옛", number: 1, address: addr })]);
    expect(race.pairs).toEqual([]);
    expect(race.fresh.map((r) => r.extId)).toEqual(["x", "y"]);
  });

  it("duplicateOfMatched: 같은 이름·주소의 다른 앱 행이 이미 짝되면 true", () => {
    const nm = "19SS주식회사 뉴냅스-매월마감", addr = "서울 마포구 양화로 1";
    const parse = { team: "C" as const, year: 2026, quarter: 4 as const, kind: "monthly" as const };
    // 한 곳은 ext_id 로 이미 붙어 있고, 같은 이름·주소 앱 행 하나가 더 있음
    const remote = [rp({ extId: "x1", name: nm, seq: 5, address: addr })];
    const local = [lp({ id: 10, name: nm, number: 5, address: addr, ext_id: "x1", ext_work_id: WORK }), lp({ id: 11, name: nm, number: 6, address: addr })];
    const p = planPull({ workId: WORK, accountNo: 1, parse, remote, local, firstPull: false, previousCount: null, nowIso: "2026-10-31T05:00:00.000Z", idBase: 1_000, scopeMaxNumber: 6, withDetail: true });
    expect(p.detail!.unmatchedLocal).toEqual([{ id: 11, number: 6, name: nm, address: addr, label: "G1", duplicateOfMatched: true }]);
  });

  it("planPull 표본: 새 장소(최대 20)·짝 안 된 앱 행(최대 20)·처음 짝 색 다름(최대 10)", () => {
    const parse = { team: "C" as const, year: 2026, quarter: 4 as const, kind: "monthly" as const };
    const remote = [
      ...Array.from({ length: 12 }, (_, i) => rp({ extId: `m${i}`, name: `업체${i}`, seq: i + 1, label: "G5", labelColor: 4 })),
      ...Array.from({ length: 25 }, (_, i) => rp({ extId: `n${i}`, name: `새곳${i}`, seq: 100 + i, address: `주소${i}`, labelColor: 1, label: "G2" })),
    ];
    const local = [
      ...Array.from({ length: 12 }, (_, i) => lp({ id: i + 1, name: `업체${i}`, number: i + 1, label: "G2" })),
      ...Array.from({ length: 22 }, (_, i) => lp({ id: 100 + i, name: `앱만${i}`, number: 200 + i, address: `앱주소${i}` })),
    ];
    const p = planPull({ workId: WORK, accountNo: 1, parse, remote, local, firstPull: true, previousCount: null, nowIso: "2026-10-31T05:00:00.000Z", idBase: 1_000, scopeMaxNumber: 30 });
    expect(p.stats).toMatchObject({ matched: 12, fresh: 25 });
    expect(p.samples.fresh).toHaveLength(20);
    expect(p.samples.fresh[0]).toEqual({ extId: "n0", seq: 100, name: "새곳0", address: "주소0", labelColor: 1 });
    expect(p.samples.unmatchedLocal).toHaveLength(20);
    expect(p.samples.unmatchedLocalTotal).toBe(22);
    expect(p.samples.unmatchedLocal[0]).toEqual({ id: 100, number: 200, name: "앱만0", address: "앱주소0" });
    expect(p.colorCheck.firstMatchDiff).toBe(12);
    expect(p.samples.colorDiff).toHaveLength(10);
    expect(p.samples.colorDiff[0]).toEqual({ id: 1, name: "업체0", appLabel: "G2", workinmapColor: 4, workinmapLabel: "G5" });
  });
});

// ── 메모 ─────────────────────────────────────────────────────────
describe("mergeMemos — 합집합(상대에 없는 것만 덧붙임)", () => {
  it("1,2,3 + 1,2,3,4 → 4만 추가", () => {
    expect(mergeMemos(["1", "2", "3", "4"], ["1", "2", "3"])).toEqual({ merged: ["1", "2", "3", "4"], added: ["4"], replaced: [] });
  });
  it("앱 순서 유지 + 워킨맵 순서대로 뒤에, 지우지 않음", () => {
    expect(mergeMemos(["b", "x", "a", "y"], ["a", "b", "[G5 완료] 2026-10-01"])).toEqual({ merged: ["a", "b", "[G5 완료] 2026-10-01", "x", "y"], added: ["x", "y"], replaced: [] });
    expect(mergeMemos([], ["a"]).merged).toEqual(["a"]);
  });
  it("빈 줄·공백 차이·워킨맵 안 중복·가린 주민번호는 붙이지 않음", () => {
    const r = mergeMemos(["", "  ", "키맨  홍길동", "새 줄", "새 줄", "900101-1******"], ["키맨 홍길동"]);
    expect(r.added).toEqual(["새 줄"]);
    expect(r.merged).toEqual(["키맨 홍길동", "새 줄"]);
  });
});

describe("메모 날짜 꼬리 · 줄 단위 · 정형 줄 교체(2026-10-31)", () => {
  it("stripMemoTail: 끝의 (이름 YYYY-MM-DD) 꼬리를 전부 뗀다, 날짜 없는 (워킨맵)·꼬리뿐인 메모는 그대로", () => {
    expect(stripMemoTail("키맨 홍길동 (워킨맵 2026-10-20)")).toBe("키맨 홍길동");
    expect(stripMemoTail("키맨 (앱 2026-10-21)")).toBe("키맨");
    expect(stripMemoTail("키맨(홍길동 2026-10-22)")).toBe("키맨");
    expect(stripMemoTail("a (워킨맵 2026-10-20) (앱 2026-10-21)  ")).toBe("a");
    expect(stripMemoTail("[G5 완료] 2026-10-20 (워킨맵)")).toBe("[G5 완료] 2026-10-20 (워킨맵)");
    expect(stripMemoTail(" (워킨맵 2026-10-20)")).toBe("(워킨맵 2026-10-20)");
    expect(stripMemoTail("방문 (2026-11-01)")).toBe("방문 (2026-11-01)"); // 이름 없는 날짜 괄호는 꼬리 아님
    expect(memoCompareKey("키맨  홍길동 (워킨맵 2026-10-20)")).toBe(memoCompareKey("키맨 홍길동"));
  });

  it("같은 본문 + 다른 꼬리 = 같은 항목(다시 안 붙음), 새 줄은 항목 last_update 의 KST 날짜, 없으면 회차 날짜", () => {
    const r = mergeMemos(["키맨 홍길동", "a (앱 2026-10-01)", "새 줄", "또 새 줄"], ["키맨 홍길동 (워킨맵 2026-10-20)", "a (워킨맵 2026-10-02)"],
      { dates: [null, null, "2026-10-19T16:30:00.000Z", null], fallbackYmd: "2026-10-31" });
    expect(r.added).toEqual(["새 줄 (워킨맵 2026-10-20)", "또 새 줄 (워킨맵 2026-10-31)"]);
    expect(r.replaced).toEqual([]);
    // 꼬리 붙은 결과로 한 번 더 돌려도 붙는 것 없음
    expect(mergeMemos(["키맨 홍길동", "새 줄", "또 새 줄"], r.merged, { fallbackYmd: "2026-11-01" }).added).toEqual([]);
  });

  it("워킨맵 한 항목 안 줄바꿈은 줄마다 비교 — 있는 줄은 안 붙고, 정형 줄은 같은 머리글 앱 줄을 교체(엔티에스 성수 실측)", () => {
    const app = ["키맨 김", "기본임대료7700000/연평균임대료7450272.72727273/컬러기본 A4 88000", "A3 6000/흑백기본62000"];
    const remote = ["기본임대료7700000/연평균임대료8109000/컬러기본 A4 88000\nA3 6000/흑백기본62000"];
    const r = mergeMemos(remote, app, { dates: ["2026-10-20T01:00:00.000Z"], fallbackYmd: "2026-10-31" });
    expect(r.added).toEqual([]);
    expect(r.merged).toEqual(["키맨 김", "기본임대료7700000/연평균임대료8109000/컬러기본 A4 88000 (워킨맵 2026-10-20)", "A3 6000/흑백기본62000"]);
    expect(r.replaced).toEqual([{ before: app[1], after: [r.merged[1]] }]);
    // 다음 회차: 바뀐 것 없음
    const again = mergeMemos(remote, r.merged, { fallbackYmd: "2026-11-01" });
    expect([again.added, again.replaced]).toEqual([[], []]);
  });

  it("정형 머리글: 긴 것 먼저, 뒤가 한글이면 아님, 워킨맵 안 같은 머리글은 마지막 줄만, 앱에 없으면 덧붙임", () => {
    expect(memoSlotOf("연평균임대료 8109000")).toBe("연평균임대료");
    expect(memoSlotOf("연평균 300")).toBe("연평균");
    expect(memoSlotOf("한조님 방문")).toBeNull();
    expect(memoSlotOf("한조 2명 (워킨맵 2026-10-20)")).toBe("한조");
    expect(memoSlotOf("키맨 기본임대료 100")).toBeNull();
    const r = mergeMemos(["미수금 100", "미수금 200", "방문주기 2개월"], ["미수금 50"]);
    expect(r.merged).toEqual(["미수금 200", "방문주기 2개월"]);
    expect(r.replaced).toEqual([{ before: "미수금 50", after: ["미수금 200"] }]);
    // 여러 줄 앱 항목이면 줄로 쪼개 교체, 나머지 줄은 따로 항목(이미 있는 줄은 생략)
    const m = mergeMemos(["미수금 9"], ["키맨\n\n미수금 1\n방문", "방문"]);
    expect(m.merged).toEqual(["키맨", "미수금 9", "방문"]);
    expect(m.replaced).toEqual([{ before: "키맨\n\n미수금 1\n방문", after: ["키맨", "미수금 9"] }]);
  });

  it("엔티에스 성수 실측 그대로: 한 항목 안 줄바꿈 2개(빈 줄) 옛 앱 항목 + 워킨맵 새 줄 → 쪼개서 정형 줄 교체", () => {
    const old = "기본임대료7700000/연평균임대료7450272.72727273/컬러기본 A4 88000\n\nA3 6000/흑백기본62000";
    const r = mergeMemos(["기본임대료7700000/연평균임대료8109000/컬러기본 A4 88000\nA3 6000/흑백기본62000"], ["키맨", old], { fallbackYmd: "2026-10-31" });
    expect(r.merged).toEqual(["키맨", "기본임대료7700000/연평균임대료8109000/컬러기본 A4 88000 (워킨맵 2026-10-31)", "A3 6000/흑백기본62000"]);
    expect(r.added).toEqual([]);
    expect(r.replaced).toEqual([{ before: old, after: r.merged.slice(1) }]);
  });

  it("planPull: 정형 줄 교체 로그(before 옛 줄 · note replace_slot) + 추가 로그, stats.memoReplaces", () => {
    const parse = { team: "C" as const, year: 2026, quarter: 4 as const, kind: "quarter" as const };
    const p = planPull({
      workId: WORK, accountNo: 1, parse, nowIso: "2026-10-31T05:00:00.000Z", idBase: 1_000, scopeMaxNumber: 1, firstPull: false, previousCount: null,
      remote: [rp({ extId: "e1", name: "가", memos: ["미수금 200\n새 줄"], memoDates: ["2026-10-29T00:00:00.000Z"] })],
      local: [lp({ id: 1, name: "가", memos: ["미수금 50"], ext_id: "e1", ext_work_id: WORK, ext_account_no: 1, ext_year: 2026 })],
    });
    const x = p.patches[0];
    expect(x.set.memos).toEqual(["미수금 200 (워킨맵 2026-10-29)", "새 줄 (워킨맵 2026-10-29)"]);
    expect(x.logs.filter((l) => l.field === "memo")).toEqual([
      { field: "memo", before_value: "미수금 50", after_value: "미수금 200 (워킨맵 2026-10-29)", note: "replace_slot" },
      { field: "memo", before_value: null, after_value: "새 줄 (워킨맵 2026-10-29)" },
    ]);
    expect(p.stats).toMatchObject({ memoAdds: 1, memoReplaces: 1 });
  });

  it("normalizeRemoteWork: memo2 항목별 last_update → memoDates", () => {
    const n = normalizeRemoteWork({ _id: WORK, places: [{ _id: "p1", name: "가", memo2: [{ content: "a", last_update: "2026-10-20T00:00:00.000Z" }, { content: "b" }] }] }, WORK);
    if (!n.ok) throw new Error(n.error);
    expect(n.work.places[0]).toMatchObject({ memos: ["a", "b"], memoDates: ["2026-10-20T00:00:00.000Z", null] });
  });
});

describe("planMemoDateBackfill — 이미 붙은 메모 보정", () => {
  const T1 = "2026-10-30T23:30:00.000Z"; // KST 10-31
  it("꼬리 없는 본문 → 로그 날짜 꼬리, 이미 꼬리·[G5 완료]·없는 본문·없는 장소는 건너뜀, 여러 줄은 나누고 있는 줄은 버림", () => {
    const plan = planMemoDateBackfill([
      { id: 1, place_id: 1, created_at: T1, after_value: "키맨 홍" },
      { id: 2, place_id: 1, created_at: T1, after_value: "[G5 완료] 2026-10-31 (워킨맵)" },
      { id: 3, place_id: 1, created_at: T1, after_value: "이미 (워킨맵 2026-10-20)" },
      { id: 4, place_id: 1, created_at: T1, after_value: "지워진 메모" },
      { id: 5, place_id: 9, created_at: T1, after_value: "x" },
      { id: 6, place_id: 2, created_at: "2026-10-20T01:00:00.000Z", after_value: "기본임대료7700000/연평균임대료8109000\nA3 6000/흑백기본62000" },
      { id: 7, place_id: 1, created_at: T1, after_value: "키맨 홍", note: "backfill_tail" },
    ], [
      { id: 1, memos: ["앱 글", "키맨 홍", "[G5 완료] 2026-10-31 (워킨맵)", "이미 (워킨맵 2026-10-20)"] },
      { id: 2, memos: ["기본임대료7700000/연평균임대료7450272.7", "A3 6000/흑백기본62000", "기본임대료7700000/연평균임대료8109000\nA3 6000/흑백기본62000"] },
    ]);
    expect(plan.rows).toEqual([
      { id: 1, memos: ["앱 글", "키맨 홍 (워킨맵 2026-10-31)", "[G5 완료] 2026-10-31 (워킨맵)", "이미 (워킨맵 2026-10-20)"], updated_by: SYNC_ACTOR },
      // 2번: 여러 줄 → 줄 나눔(있는 줄 버림) → 같은 머리글(기본임대료) 중 로그에서 온 줄만 남김
      { id: 2, memos: ["A3 6000/흑백기본62000", "기본임대료7700000/연평균임대료8109000 (워킨맵 2026-10-20)"], updated_by: SYNC_ACTOR },
    ]);
    expect(plan.stats).toMatchObject({ logs: 7, tailed: 1, split: 1, deduped: 1, places: 2 });
    expect(plan.stats.skipped).toMatchObject({ completion: 1, alreadyTailed: 1, notFound: 1, noPlace: 1, backfillLog: 1 });
    expect(plan.changes.find((c) => c.kind === "dedupe")).toEqual({ place_id: 2, kind: "dedupe", before: "기본임대료7700000/연평균임대료7450272.7", after: null });
  });

  it("엔티에스 성수 실측(보정 1회 뒤 상태) 그대로: 옛 여러 줄 앱 항목을 쪼개 같은 머리글 옛 줄 제거, A3 줄은 따로 보존, 두 번째는 변경 0", () => {
    const old = "기본임대료7700000/연평균임대료7450272.72727273/컬러기본 A4 88000\n\nA3 6000/흑백기본62000";
    const fresh = "기본임대료7700000/연평균임대료8109000/컬러기본 A4 88000 (워킨맵 2026-10-31)";
    const logs = [
      { id: 10, place_id: 1790041332076, created_at: "2026-10-31T07:00:00.000Z", after_value: "기본임대료7700000/연평균임대료8109000/컬러기본 A4 88000\nA3 6000/흑백기본62000" },
      { id: 11, place_id: 1790041332076, created_at: "2026-10-31T08:00:00.000Z", after_value: "기본임대료7700000/연평균임대료8109000/컬러기본 A4 88000\nA3 6000/흑백기본62000", before_value: "x", note: "backfill_tail" },
    ];
    const plan = planMemoDateBackfill(logs, [{ id: 1790041332076, memos: ["키맨 김", old, fresh] }]);
    expect(plan.rows).toEqual([{ id: 1790041332076, memos: ["키맨 김", "A3 6000/흑백기본62000", fresh], updated_by: SYNC_ACTOR }]);
    expect(plan.changes).toEqual([{ place_id: 1790041332076, kind: "dedupe", before: old, after: ["A3 6000/흑백기본62000"] }]);
    expect(plan.stats).toMatchObject({ tailed: 0, split: 0, deduped: 1, places: 1 });
    expect(planMemoDateBackfill(logs, [{ id: 1790041332076, memos: plan.rows[0].memos }]).rows).toEqual([]);
  });

  it("두 번 돌려도 바뀌는 것 없음 · 로그에서 온 줄이 없는 중복은 손대지 않음(dupNoLog)", () => {
    const logs = [{ id: 1, place_id: 1, created_at: T1, after_value: "미수금 200" }];
    const first = planMemoDateBackfill(logs, [{ id: 1, memos: ["미수금 50", "미수금 200"] }]);
    expect(first.rows[0].memos).toEqual(["미수금 200 (워킨맵 2026-10-31)"]);
    expect(planMemoDateBackfill(logs, [{ id: 1, memos: first.rows[0].memos }]).rows).toEqual([]);
    const noLog = planMemoDateBackfill([], [{ id: 1, memos: ["미수금 50", "미수금 70"] }]);
    expect(noLog.rows).toEqual([]);
    expect(noLog.stats.skipped.dupNoLog).toBe(1);
  });
});

// ── 차이·규칙 ─────────────────────────────────────────────────────
describe("diffPlace · applyRules", () => {
  it("싹 다 가져온다: 색·숨김·이름·주소·전화·좌표·코멘트·메모", () => {
    const r = rp({ extId: "e", name: "새이름", label: "G3", visible: false, comment: "c2", phone: "010", address: "주소2", addressDetail: "2층", latitude: 37.5, longitude: 127, memos: ["m1", "m2"] });
    const l = lp({ id: 1, name: "옛이름", label: "G1", memos: ["m1"] });
    const fields = diffPlace(r, l).map((c) => c.field);
    expect(fields).toEqual(["label", "visible", "name", "comment", "phone", "address", "address_detail", "coords", "memos"]);
    const res = applyRules(diffPlace(r, l), {});
    expect(res.apply.map((c) => c.field)).toEqual(fields);
    expect(res.review).toEqual([]);
  });

  it("응답에 없는 칸(null)·(0,0) 좌표·가린 코멘트는 건드리지 않음", () => {
    const r = rp({ extId: "e", name: "가", comment: "900101-1******", phone: null, address: null, addressDetail: null, latitude: 0, longitude: 0 });
    expect(diffPlace(r, lp({ id: 1, name: "가", comment: "원본", phone: "02", address: "서울" }))).toEqual([]);
  });

  it("완료 G5 가 G2 로 내려가도 워킨맵 값 반영 + 알림용 review(completion_down)", () => {
    const d = diffPlace(rp({ extId: "e", name: "가", label: "G2", phone: "010" }), lp({ id: 1, name: "가", label: "G5", phone: "02" }));
    const res = applyRules(d, {});
    expect(res.review.map((c) => [c.field, c.before, c.after, c.reason])).toEqual([["label", "G5", "G2", "completion_down"]]);
    expect(res.apply.map((c) => c.field)).toEqual(["label", "phone"]);
  });

  it("매월점검 G2→G1 단계 하강: 반영 + review(progress_down), 분기점검은 review 없음, 올라가면 review 없음", () => {
    const d = diffPlace(rp({ extId: "e", name: "가", label: "G1" }), lp({ id: 1, name: "가", label: "G2" }));
    const monthly = applyRules(d, { kind: "monthly" });
    expect(monthly.apply.map((c) => c.after)).toEqual(["G1"]);
    expect(monthly.review.map((c) => [c.before, c.after, c.reason])).toEqual([["G2", "G1", "progress_down"]]);
    const quarter = applyRules(d, { kind: "quarter" });
    expect(quarter.apply.map((c) => c.after)).toEqual(["G1"]);
    expect(quarter.review).toEqual([]);
    const up = applyRules(diffPlace(rp({ extId: "e", name: "가", label: "G3" }), lp({ id: 1, name: "가", label: "G2" })), { kind: "monthly" });
    expect(up.review).toEqual([]);
    const fromOther = applyRules(diffPlace(rp({ extId: "e", name: "가", label: "G2" }), lp({ id: 1, name: "가", label: "G7" })), { kind: "monthly" });
    expect(fromOther.review).toEqual([]);
  });

  it("색은 워킨맵 우선(G5 로 올라가는 것·G12 끼리 아닌 것)", () => {
    const res = applyRules(diffPlace(rp({ extId: "e", name: "가", label: "G5" }), lp({ id: 1, name: "가", label: "G3" })), {
      localUpdatedAt: "2026-10-31T01:00:00Z", localUpdatedBy: SYNC_ACTOR, extSyncedAt: "2026-10-30T00:00:00Z", extLastUpdate: "2026-10-30T00:00:00Z", remoteLastUpdate: "2026-10-31T00:30:00Z",
    });
    expect(res.apply.map((c) => c.after)).toEqual(["G5"]);
  });

  it("워킨맵이 지난 동기화 뒤로 안 바뀌었으면 손대지 않음 · 둘 다 바뀌면 늦은 쪽", () => {
    const d = diffPlace(rp({ extId: "e", name: "가", label: "G1" }), lp({ id: 1, name: "가", label: "G3" }));
    expect(applyRules(d, { extLastUpdate: "2026-10-31T00:00:00Z", remoteLastUpdate: "2026-10-31T00:00:00Z" }).kept[0].reason).toBe("remote_unchanged");
    const both = { localUpdatedBy: "김기사", extSyncedAt: "2026-10-30T00:00:00Z", extLastUpdate: "2026-10-30T00:00:00Z" };
    expect(applyRules(d, { ...both, localUpdatedAt: "2026-10-31T02:00:00Z", remoteLastUpdate: "2026-10-31T01:00:00Z" }).kept[0].reason).toBe("local_newer");
    expect(applyRules(d, { ...both, localUpdatedAt: "2026-10-31T01:00:00Z", remoteLastUpdate: "2026-10-31T02:00:00Z" }).apply[0].after).toBe("G1");
  });

  it("가드: 0곳·절반 미만·새 장소 첫 회차·50곳 초과", () => {
    expect(workGuard(0, 100)).toBe("empty");
    expect(workGuard(49, 100)).toBe("shrunk");
    expect(workGuard(50, 100)).toBeNull();
    expect(workGuard(3, null)).toBeNull();
    expect(newPlaceGuard(3, true)).toBe("first_pull");
    expect(newPlaceGuard(0, true)).toBe("ok");
    expect(newPlaceGuard(51, false)).toBe("too_many");
    expect(newPlaceGuard(50, false)).toBe("ok");
  });
});

// ── planPull ─────────────────────────────────────────────────────
describe("planPull", () => {
  const parse = { team: "C" as const, year: 2026, quarter: 4 as const, kind: "quarter" as const };
  const base = { workId: WORK, accountNo: 1, parse, nowIso: "2026-10-31T05:00:00.000Z", idBase: 1_000, scopeMaxNumber: 30 };

  it("0곳 응답이면 아무것도 쓰지 않고 중단", () => {
    const p = planPull({ ...base, remote: [], local: [lp({ id: 1, name: "가", ext_id: "e", ext_work_id: WORK })], firstPull: false, previousCount: 5 });
    expect(p.stop?.reason).toBe("empty");
    expect(p.patches).toEqual([]);
  });

  it("완료 이력 메모·칸별 로그·짝 연결·확인 큐", () => {
    const remote = [
      rp({ extId: "e1", name: "가나", seq: 1, label: "G5", lastUpdate: "2026-10-30T16:00:00.000Z" }), // KST 10-31
      rp({ extId: "e2", name: "다라", seq: 2, label: "G1" }),
      rp({ extId: "e3", name: "신규", seq: 3 }),
    ];
    const local = [lp({ id: 1, name: "가나", number: 1, label: "G1", memos: ["키맨"] }), lp({ id: 2, name: "다라", number: 2, label: "G5" })];
    const p = planPull({ ...base, remote, local, firstPull: true, previousCount: null });
    const p1 = p.patches.find((x) => x.id === 1)!;
    expect(p1.set.label).toBe("G5");
    expect(p1.set.memos).toEqual(["키맨", "[G5 완료] 2026-10-31 (워킨맵)"]);
    expect(p1.set).toMatchObject({ ext_id: "e1", ext_work_id: WORK, ext_account_no: 1, ext_year: 2026, updated_by: SYNC_ACTOR });
    expect(p1.logs.map((l) => l.field)).toEqual(["label", "memo", "_link"]);
    expect(p1.logs[0]).toEqual({ field: "label", before_value: "G1", after_value: "G5" });
    // 2번: 완료 내려감 → 워킨맵 값(G1) 반영 + 알림용 downgrade 큐(detail.applied)
    const p2 = p.patches.find((x) => x.id === 2)!;
    expect(p2.set.label).toBe("G1");
    expect(p.reviews.map((r) => [r.kind, r.field, r.ext_id])).toEqual([["downgrade", "label", "e2"], ["new", "", "e3"]]);
    expect(p.reviews[0].detail).toMatchObject({ applied: true, from: "G5", to: "G1", reason: "completion_down" });
    // 첫 회차: 새 장소는 넣지 않음
    expect(p.inserts).toEqual([]);
    expect(p.colorCheck).toMatchObject({ firstMatchSame: 0, firstMatchDiff: 2 });
  });

  it("두 번째 회차: 새 장소 insert 는 엑셀 불러오기 행 모양 + ext_*, 이미 열린 확인 큐는 다시 안 넣음", () => {
    const remote = [rp({ extId: "e1", name: "가", label: "G2" }), rp({ extId: "n1", name: "새곳", seq: 2, label: "G5", memos: ["메모"], latitude: 37.1, longitude: 127.1 })];
    const local = [lp({ id: 5, name: "가", label: "G5", ext_id: "e1", ext_work_id: WORK, ext_account_no: 1, ext_year: 2026 })];
    const open = new Set(["downgrade|label|" + WORK + "|e1|5"]);
    const p = planPull({ ...base, remote, local, firstPull: false, previousCount: 2, openReviewKeys: open, takenIds: new Set([1000]) });
    expect(p.reviews).toEqual([]);
    expect(p.inserts).toHaveLength(1);
    expect(p.inserts[0].row).toEqual({
      id: 1001, number: 31, team: "C", quarter: 4, kind: "quarter", label: "G5", visible: true, name: "새곳", comment: "", phone: "",
      address: "", address_detail: "", latitude: 37.1, longitude: 127.1, memos: ["메모 (워킨맵 2026-10-31)", "[G5 완료] 2026-10-31 (워킨맵)"],
      ext_id: "n1", ext_work_id: WORK, ext_account_no: 1, ext_year: 2026, ext_last_update: "2026-10-31T03:00:00.000Z", ext_synced_at: base.nowIso, updated_by: SYNC_ACTOR,
    });
    expect(p.inserts[0].log.field).toBe("_insert");
  });
});

// ── 응답 정리 ─────────────────────────────────────────────────────
describe("normalizeRemoteWork", () => {
  it("work2.js 모양 → RemotePlace, escapeHTML 풀기", () => {
    const r = normalizeRemoteWork({
      _id: WORK, name: "수도권C", places: [{
        _id: "p1", name: "A&amp;B", comment: "x", number: "010-1", address: { address: "서울", detail_addr: "1층" }, position: { latitude: 37.5, longitude: 127 },
        label_color: 4, hide: true, memo2: [{ _id: "m", content: "&lt;b&gt; 메모", last_update: "2026-10-31" }], last_update: 1761880000000,
      }],
    }, WORK);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.work.places[0]).toMatchObject({ extId: "p1", name: "A&B", phone: "010-1", address: "서울", addressDetail: "1층", latitude: 37.5, longitude: 127, label: "G5", visible: false, memos: ["<b> 메모"] });
  });
  it("토큰 오류·형식 변경은 ok:false", () => {
    expect(normalizeRemoteWork({ error_code: 109, message: "토큰 인증에 실패했습니다.", status: 401 })).toMatchObject({ ok: false, code: 109 });
    expect(normalizeRemoteWork({ _id: WORK, places: "x" }).ok).toBe(false);
    expect(normalizeRemoteWork({ _id: WORK, places: [{ name: "id 없음" }] }).ok).toBe(false);
    expect(decodeHtml("&#x2F;&#39;")).toBe("/'");
  });
  it("workList4 → 목록", () => {
    expect(parseWorkList({ works: [{ _id: WORK, name: "수도권C", places: [1, 2] }, { name: "id 없음" }] })).toEqual([{ id: WORK, name: "수도권C", placeCount: 2, modified: null }]);
    expect(parseWorkList({ nope: 1 })).toBeNull();
  });
});

// ── 요청·인증 ─────────────────────────────────────────────────────
describe("parseRequest · isAuthorized", () => {
  it("액션", () => {
    expect(parseRequest({ action: "pull" })).toEqual({ action: "pull", scope: "current", dryRun: false, manual: false });
    expect(parseRequest({ action: "pull", scope: WORK, dryRun: true })).toEqual({ action: "pull", scope: { workId: WORK }, dryRun: true, manual: false });
    expect(parseRequest({ action: "pull", manual: true })).toMatchObject({ manual: true });   // 관리 탭 수동 호출 — 실패여도 200(ok:false)
    expect(parseRequest({ action: "pull", scope: "x" })).toHaveProperty("error");
    expect(parseRequest({ action: "login_test", account: 2 })).toEqual({ action: "login_test", account: 2 });
    expect(parseRequest({ action: "delete" })).toHaveProperty("error");
  });
  it("JWT ref·role", () => {
    const jwt = (p: object) => `x.${btoa(JSON.stringify(p))}.y`;
    expect(isAuthorized(`Bearer ${jwt({ role: "anon", ref: "abc" })}`, { projectRef: "abc", nowMs: 0 })).toBe(true);
    expect(isAuthorized(`Bearer ${jwt({ role: "anon", ref: "zzz" })}`, { projectRef: "abc", nowMs: 0 })).toBe(false);
    expect(isAuthorized(null, { projectRef: "abc", nowMs: 0 })).toBe(false);
  });
});

// ── 로그인(fetch 주입) ────────────────────────────────────────────
const memStore = (init: TokenRow | null = null): TokenStore & { row: TokenRow | null } => {
  const s = {
    row: init,
    async load() { return s.row; },
    async save(no: number, patch: Partial<TokenRow>) { s.row = { ...(s.row ?? { account_no: no }), ...patch } as TokenRow; },
  };
  return s;
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const ACC = { no: 1, email: "secret-user@example.com", password: "pw-secret-123" };

describe("auth", () => {
  it("계정은 번호가 빌 때까지", () => {
    const env: Record<string, string> = { WORKINMAP_1_EMAIL: "a", WORKINMAP_1_PASSWORD: "b", WORKINMAP_3_EMAIL: "c", WORKINMAP_3_PASSWORD: "d" };
    expect(readAccounts((k) => env[k]).map((a) => a.no)).toEqual([1]);
  });

  it("캐시 → refresh → 비밀번호 순서", async () => {
    const calls: string[] = [];
    const fetchFn = async (url: string) => {
      calls.push(url.split("?")[0]);
      if (url.includes("securetoken")) return json({ error: { message: "TOKEN_EXPIRED" } }, 400);
      return json({ idToken: "ID-NEW", refreshToken: "RT-NEW", expiresIn: "3600" });
    };
    const store = memStore({ account_no: 1, id_token: "OLD", refresh_token: "RT-OLD", expires_at: new Date(1000).toISOString() });
    const r = await getIdToken({ fetchFn, apiKey: "k", account: ACC, store, nowMs: () => 10_000 });
    expect(r).toEqual({ ok: true, idToken: "ID-NEW", via: "password" });
    expect(calls).toEqual(["https://securetoken.googleapis.com/v1/token", "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword"]);
    expect(store.row).toMatchObject({ refresh_token: "RT-NEW", fail_count: 0, paused: false, last_error: "" });
    const cached = await getIdToken({ fetchFn, apiKey: "k", account: ACC, store, nowMs: () => 10_000 });
    expect(cached.ok && cached.via).toBe("cache");
  });

  it("비밀번호 3회 실패면 멈춤, 오류 문구에 이메일·비밀번호 없음", async () => {
    const fetchFn = async () => json({ error: { message: `INVALID_PASSWORD ${ACC.email} ${ACC.password}` } }, 400);
    const store = memStore();
    let last;
    for (let i = 0; i < 3; i += 1) last = await getIdToken({ fetchFn, apiKey: "k", account: ACC, store, nowMs: () => 0 });
    expect(last).toMatchObject({ ok: false, paused: true });
    expect(store.row?.paused).toBe(true);
    const text = JSON.stringify([last, store.row]);
    expect(text).not.toContain(ACC.email);
    expect(text).not.toContain(ACC.password);
    expect((await getIdToken({ fetchFn, apiKey: "k", account: ACC, store, nowMs: () => 0 })).ok).toBe(false);
    expect(scrub("eyJabc.def.ghi 토큰", [])).toBe("*** 토큰");
  });
});

// ── 실행부(가짜 서버) ─────────────────────────────────────────────
type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };
function fakeServer(opts: { enabled: boolean; logFails?: boolean; firstPulled?: boolean; token109Once?: boolean; twoWorks?: boolean; tickPerWork?: number; storedWorks?: Array<Record<string, unknown>> }) {
  const calls: Call[] = [];
  let fail109 = Boolean(opts.token109Once);
  let accountRow: Record<string, unknown> | null = null;
  const clock = { now: Date.parse("2026-10-31T05:00:00Z"), tickPerWork: opts.tickPerWork ?? 0 };
  const workPayload = {
    _id: WORK, name: "수도권C_26년4분기점검(26.10.26)",
    places: [
      { _id: "p1", name: "가나상사", label_color: 4, hide: false, memo2: [{ content: "새 메모" }], last_update: "2026-10-31T01:00:00Z", address: { address: "서울", detail_addr: "" } },
      { _id: "p2", name: "다라물산", label_color: 0, hide: false, memo2: [], last_update: "2026-10-31T01:00:00Z", address: { address: "부산", detail_addr: "" } },
    ],
  };
  const local = [
    { ...lp({ id: 101, name: "가나상사", number: 1, label: "G1", address: "서울" }) },
    { ...lp({ id: 102, name: "다라물산", number: 2, label: "G1", address: "부산" }) },
  ];
  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method || "GET";
    const headers = (init?.headers || {}) as Record<string, string>;
    const body = init?.body && typeof init.body === "string" ? (() => { try { return JSON.parse(init.body as string); } catch { return init.body; } })() : undefined;
    calls.push({ method, url, headers, body });
    if (url.includes("identitytoolkit")) return json({ idToken: "IDTOKEN-SECRET", refreshToken: "RT-SECRET", expiresIn: "3600" });
    if (url.includes("api.solgit.co/api/v2/users/info")) return json({ works: [{ _id: WORK, name: workPayload.name, places: [1, 2] }, { _id: "f".repeat(24), name: "영업확장성리스트_박P_워킨맵표현" }, ...(opts.twoWorks ? [{ _id: WORK2, name: "수도권D_26년4분기점검(26.10.26)", places: [1] }] : [])] });
    if (url.includes("api.solgit.co/api/v2/works/")) clock.now += clock.tickPerWork;
    if (url.includes("api.solgit.co/api/v2/works/" + WORK2)) return json({ ...workPayload, _id: WORK2, places: [] });
    if (url.includes(`api.solgit.co/api/v2/works/${WORK}`)) {
      if (fail109) { fail109 = false; return json({ error_code: 109, message: "토큰 인증에 실패했습니다.", status: 401 }); }
      return json(workPayload);
    }
    if (url.includes("/rest/v1/app_config")) return json([{ key: "WORKINMAP_SYNC_ENABLED", value: opts.enabled ? "true" : "false" }, { key: "WORKINMAP_API_KEY", value: "" }]);
    if (url.includes("/rest/v1/rpc/workin_sync_take_lease")) return json(true);
    if (url.includes("/rest/v1/rpc/workin_sync_release_lease")) return new Response("", { status: 200 });
    if (url.includes("/rest/v1/rpc/workin_sync_update_places")) {
      const rows = (body as { p_rows: Array<{ id: number }> }).p_rows;
      return json(rows.filter((r) => r.id !== 102).length); // 102 = 읽은 뒤 앱에서 지워진 행
    }
    if (url.includes("/rest/v1/workin_sync_accounts")) {
      if (method === "GET") return json(accountRow ? [accountRow] : []);
      accountRow = { ...(accountRow ?? {}), ...(body as Array<Record<string, unknown>>)[0] };
      return new Response(null, { status: 201 });
    }
    if (url.includes("/rest/v1/workin_sync_works")) {
      if (method === "GET" && opts.storedWorks) return json(opts.storedWorks);
      if (method === "GET") return json(opts.firstPulled ? [{ account_no: 1, work_id: WORK, place_count: 2, override_skip: false, first_pulled_at: "2026-10-30T00:00:00Z", last_pulled_at: "2026-10-30T00:00:00Z" }] : []);
      return new Response(null, { status: method === "PATCH" ? 204 : 201 });
    }
    if (url.includes("/rest/v1/workin_sync_review")) return method === "GET" ? json([]) : new Response(null, { status: 201 });
    if (url.includes("/rest/v1/workin_sync_log")) return opts.logFails ? new Response("boom", { status: 500 }) : new Response(null, { status: 201 });
    if (url.includes("/rest/v1/workin_map_places")) {
      if (method !== "GET") return new Response(null, { status: method === "PATCH" ? 204 : 201 });
      if (url.includes("select=number")) return json([{ number: 40 }]);
      if (url.includes("ext_id=in.")) return json([]);
      return json(local);
    }
    return new Response("not found", { status: 404 });
  };
  const deps: SyncDeps = {
    fetchFn, supabaseUrl: "https://abc.supabase.co", serviceKey: "SERVICE-KEY",
    getEnv: (k) => ({ WORKINMAP_1_EMAIL: ACC.email, WORKINMAP_1_PASSWORD: ACC.password } as Record<string, string>)[k],
    now: () => clock.now, holder: "run-1",
  };
  return { calls, deps, clock };
}
const writesTo = (calls: Call[], part: string) => calls.filter((c) => c.method !== "GET" && c.url.includes(part));

describe("runAction(fetch 주입)", () => {
  it("스위치 꺼짐 → pull 은 dry: 장소·로그·확인 큐 쓰기 0, 응답에 disabled", async () => {
    const { calls, deps } = fakeServer({ enabled: false });
    const out = await runAction({ action: "pull", scope: "current", dryRun: false }, deps);
    expect(out.body).toMatchObject({ dryRun: true, disabled: true });
    for (const t of ["workin_map_places", "workin_sync_log", "workin_sync_review", "workin_sync_works", "rpc/workin_sync_take_lease"]) expect(writesTo(calls, t)).toEqual([]);
    const results = out.body.results as Array<{ result: string; stats: { matched: number; labelChanges: number } }>;
    expect(results[0]).toMatchObject({ result: "dry", stats: { matched: 2, labelChanges: 1 } });
    // dry 응답에 판단용 표본(새 장소·짝 안 된 앱 행·색 다름)
    const samples = (results[0] as unknown as { samples: { fresh: unknown[]; unmatchedLocal: unknown[]; unmatchedLocalTotal: number; colorDiff: unknown[] } }).samples;
    expect(samples).toBeDefined();
    expect(Array.isArray(samples.fresh) && Array.isArray(samples.unmatchedLocal) && Array.isArray(samples.colorDiff)).toBe(true);
    expect(samples.colorDiff.length).toBeGreaterThan(0);
    // 응답에 비밀값 없음
    const text = JSON.stringify(out.body);
    for (const s of [ACC.email, ACC.password, "IDTOKEN-SECRET", "RT-SECRET", "SERVICE-KEY"]) expect(text).not.toContain(s);
  });

  it("켜짐 → 임대 → 로그 먼저 → rpc 묶음 쓰기(x-workin-sync 헤더) → 해제, 109 한 번은 재로그인 후 재시도", async () => {
    const { calls, deps } = fakeServer({ enabled: true, firstPulled: true, token109Once: true });
    const out = await runAction({ action: "pull", scope: "current", dryRun: false }, deps);
    expect(out.status).toBe(200);
    const rest = calls.filter((c) => c.url.includes("/rest/v1/"));
    for (const c of rest) expect(c.headers["x-workin-sync"]).toBe("1");
    const idx = (pred: (c: Call) => boolean) => calls.findIndex(pred);
    const logAt = idx((c) => c.method === "POST" && c.url.includes("workin_sync_log"));
    const patchAt = idx((c) => c.url.includes("rpc/workin_sync_update_places"));
    expect(logAt).toBeGreaterThan(-1);
    expect(patchAt).toBeGreaterThan(logAt);
    expect(idx((c) => c.url.includes("take_lease"))).toBeLessThan(logAt);
    expect(idx((c) => c.url.includes("release_lease"))).toBeGreaterThan(patchAt);
    const rpcs = writesTo(calls, "rpc/workin_sync_update_places");
    const rows = rpcs.flatMap((c) => (c.body as { p_rows: Array<Record<string, unknown>> }).p_rows);
    expect(rows.find((r) => r.id === 101)).toMatchObject({ label: "G5", ext_id: "p1", ext_account_no: 1, updated_by: SYNC_ACTOR });
    expect(rows.find((r) => r.id === 101)).not.toHaveProperty("team");
    expect(rows.find((r) => r.id === 102)).toMatchObject({ ext_id: "p2" });
    // 기존 행은 upsert·PATCH 로 쓰지 않는다(지운 행 되살아남 방지)
    expect(writesTo(calls, "workin_map_places")).toEqual([]);
    // 가짜 rpc 는 102 를 "이미 지워짐"으로 건너뜀 → skippedDeleted 1
    expect(out.body.skippedDeleted).toBe(1);
    expect((out.body.results as Array<{ writes: { patched: number; skippedDeleted: number } }>)[0].writes).toMatchObject({ patched: 1, skippedDeleted: 1 });
    expect(calls.filter((c) => c.url.includes("identitytoolkit")).length).toBe(2); // 109 → 강제 재로그인
    expect(JSON.stringify(out.body)).not.toContain("IDTOKEN-SECRET");
  });

  it("로그 insert 가 실패하면 그 묶음은 쓰지 않는다", async () => {
    const { calls, deps } = fakeServer({ enabled: true, firstPulled: true, logFails: true });
    const out = await runAction({ action: "pull", scope: "current", dryRun: false }, deps);
    expect(writesTo(calls, "workin_map_places")).toEqual([]);
    expect(writesTo(calls, "rpc/workin_sync_update_places")).toEqual([]);
    expect(out.status).toBe(500);
    expect((out.body.results as Array<{ writes: { patchFailed: number } }>)[0].writes.patchFailed).toBe(2);
  });

  it("works: 해석표 + 제외, push 는 건너뜀, login_test 응답에 토큰 없음", async () => {
    const { deps } = fakeServer({ enabled: false });
    const w = await runAction({ action: "works" }, deps);
    expect((w.body.works as Array<{ status: string; team: string | null }>).map((x) => [x.status, x.team])).toEqual([["target", "C"], ["excluded", null]]);
    expect(await runAction({ action: "push" }, deps)).toEqual({ status: 200, body: { ok: true, skipped: "push_disabled" } });
    const lt = await runAction({ action: "login_test", account: 1 }, deps);
    expect(lt.body).toEqual({ ok: true, account: 1, via: "password" });
  });

  it("120초를 넘기면 남은 워크는 다음 회차(deferred + 미완료 표시), 오래 안 받은 워크부터", async () => {
    const stored = [
      { account_no: 1, work_id: WORK, name: "C", place_count: 2, override_skip: false, first_pulled_at: "2026-10-30T00:00:00Z", last_pulled_at: "2026-10-31T00:00:00Z" },
      { account_no: 1, work_id: WORK2, name: "D", place_count: 0, override_skip: false, first_pulled_at: null, last_pulled_at: null },
    ];
    const { calls, deps } = fakeServer({ enabled: true, twoWorks: true, tickPerWork: 130_000, storedWorks: stored });
    const out = await runAction({ action: "pull", scope: "current", dryRun: false }, deps);
    // WORK2(안 받은 적 있음)가 먼저 → 130초 경과 → WORK 는 미뤄짐
    expect((out.body.results as Array<{ workId: string }>).map((r) => r.workId)).toEqual([WORK2]);
    expect(out.body.deferred).toEqual([{ account: 1, workId: WORK, name: "수도권C_26년4분기점검(26.10.26)" }]);
    const mark = calls.find((c) => c.method === "PATCH" && c.url.includes(`work_id=eq.${WORK}`));
    expect(String((mark?.body as Record<string, unknown>).last_error)).toMatch(/^미완료:/);
  });

  it("status: 마지막 실행·다음 예정(09/12/15/18)·미완료 워크, 토큰 칸 없음", async () => {
    const stored = [
      { account_no: 1, work_id: WORK, name: "C", last_pulled_at: "2026-10-31T03:00:00Z", last_error: "미완료: 시간 초과(120초)로 다음 회차" },
      { account_no: 2, work_id: WORK2, name: "D", last_pulled_at: "2026-10-31T03:10:00Z", last_error: "" },
    ];
    const { calls, deps } = fakeServer({ enabled: true, storedWorks: stored });
    const out = await runAction({ action: "status" }, deps);
    expect(out.body).toMatchObject({
      lastRunAt: "2026-10-31T03:10:00.000Z", nextRunAt: "2026-10-31T06:00:00.000Z", scheduleKst: ["09:00", "12:00", "15:00", "18:00"],
      incompleteWorks: [{ account: 1, workId: WORK, name: "C", lastPulledAt: "2026-10-31T03:00:00Z" }],
    });
    const accGet = calls.find((c) => c.url.includes("workin_sync_accounts"))!;
    expect(accGet.url).not.toContain("token");
  });
});

describe("묶음 쓰기 · 일정", () => {
  it("chunkPatchRows: size 행씩, 행 = id + 바뀐 칸 + updated_by(team 등 안 붙임)", () => {
    const mk = (id: number, set: Record<string, unknown>) => ({ id, ext_id: "e" + id, set, fields: [], by: "ext_id" as const, logs: [] });
    const g = chunkPatchRows([mk(1, { label: "G5", ext_id: "e1" }), mk(2, { ext_id: "e2" }), mk(3, { visible: false })], 2);
    const u = { updated_by: SYNC_ACTOR };
    expect(g.map((b) => b.rows)).toEqual([[{ id: 1, label: "G5", ext_id: "e1", ...u }, { id: 2, ext_id: "e2", ...u }], [{ id: 3, visible: false, ...u }]]);
    // rpc 허용 칸만 — 실제 계획이 만든 키도 검사
    const allowed = new Set(["id", "name", "comment", "phone", "address", "address_detail", "latitude", "longitude", "label", "visible", "memos",
      "ext_id", "ext_work_id", "ext_account_no", "ext_year", "ext_last_update", "ext_synced_at", "ext_missing_at", "updated_by", "updated_at"]);
    const plan = planPull({
      workId: WORK, accountNo: 1, parse: { team: "C", year: 2026, quarter: 4, kind: "quarter" }, nowIso: "2026-10-31T05:00:00.000Z", idBase: 1, scopeMaxNumber: 0,
      remote: [rp({ extId: "e1", name: "새", label: "G5", comment: "c", phone: "p", address: "a", addressDetail: "d", latitude: 37, longitude: 127, memos: ["m"], visible: false })],
      local: [lp({ id: 1, name: "새", ext_id: "e1", ext_work_id: WORK }), lp({ id: 2, name: "없음", ext_id: "gone", ext_work_id: WORK })],
      firstPull: false, previousCount: 1,
    });
    for (const row of chunkPatchRows(plan.patches).flatMap((b) => b.rows)) {
      for (const k of Object.keys(row)) expect(allowed.has(k)).toBe(true);
      expect(row.updated_by).toBe(SYNC_ACTOR);
    }
  });
  it("nextScheduledRun: KST 09·12·15·18, 18시 뒤는 다음 날 09시", () => {
    expect(nextScheduledRun(Date.parse("2026-10-31T05:00:00+09:00"))).toBe("2026-10-31T00:00:00.000Z");
    expect(nextScheduledRun(Date.parse("2026-10-31T09:00:00+09:00"))).toBe("2026-10-31T03:00:00.000Z");
    expect(nextScheduledRun(Date.parse("2026-10-31T16:30:00+09:00"))).toBe("2026-10-31T09:00:00.000Z");
    expect(nextScheduledRun(Date.parse("2026-10-31T19:00:00+09:00"))).toBe("2026-11-01T00:00:00.000Z");
  });
});

describe("runAction memo_date_backfill(fetch 주입)", () => {
  const setup = () => {
    const calls: Call[] = [];
    const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
      const method = init?.method || "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, url, headers: (init?.headers || {}) as Record<string, string>, body });
      if (url.includes("/rest/v1/app_config")) return json([]);
      if (url.includes("/rest/v1/workin_sync_log") && method === "GET") return json([{ id: 1, place_id: 7, created_at: "2026-10-30T23:30:00.000Z", after_value: "키맨 홍", note: "" }]);
      if (url.includes("/rest/v1/workin_sync_log")) return new Response(null, { status: 201 });
      if (url.includes("/rest/v1/workin_map_places")) return json([{ id: 7, memos: ["키맨 홍"] }]);
      if (url.includes("rpc/workin_sync_take_lease")) return json(true);
      if (url.includes("rpc/workin_sync_release_lease")) return new Response("", { status: 200 });
      if (url.includes("rpc/workin_sync_update_places")) return json(1);
      return new Response("not found", { status: 404 });
    };
    const deps: SyncDeps = { fetchFn, supabaseUrl: "https://abc.supabase.co", serviceKey: "SERVICE-KEY", getEnv: () => undefined, now: () => Date.parse("2026-10-31T05:00:00Z"), holder: "run-1" };
    return { calls, deps };
  };
  it("dryRun: 건수만, 쓰기·임대 0", async () => {
    const { calls, deps } = setup();
    const out = await runAction({ action: "memo_date_backfill", dryRun: true }, deps);
    expect(out.body).toMatchObject({ ok: true, dryRun: true, stats: { tailed: 1, places: 1 } });
    expect(calls.filter((c) => c.method !== "GET" && !c.url.includes("app_config"))).toEqual([]);
  });
  it("쓰기: 임대 → 로그(note backfill_tail) → rpc(updated_by·x-workin-sync) → 해제", async () => {
    const { calls, deps } = setup();
    const out = await runAction({ action: "memo_date_backfill", dryRun: false }, deps);
    expect(out.body).toMatchObject({ ok: true, writes: { patched: 1, logs: 1 } });
    const order = calls.filter((c) => c.method !== "GET").map((c) => c.url.split("/rest/v1/")[1].split("?")[0]);
    expect(order).toEqual(["rpc/workin_sync_take_lease", "workin_sync_log", "rpc/workin_sync_update_places", "rpc/workin_sync_release_lease"]);
    const rpc = calls.find((c) => c.url.includes("workin_sync_update_places"))!;
    expect(rpc.headers["x-workin-sync"]).toBe("1");
    expect((rpc.body as { p_rows: unknown[] }).p_rows).toEqual([{ id: 7, memos: ["키맨 홍 (워킨맵 2026-10-31)"], updated_by: SYNC_ACTOR }]);
    const log = calls.find((c) => c.method === "POST" && c.url.includes("workin_sync_log"))!;
    expect((log.body as Array<Record<string, unknown>>)[0]).toMatchObject({ place_id: 7, field: "memo", direction: "pull", before_value: "키맨 홍", note: "backfill_tail" });
  });
  it("parseRequest 가 액션을 읽는다", () => {
    expect(parseRequest({ action: "memo_date_backfill", dryRun: true })).toEqual({ action: "memo_date_backfill", dryRun: true });
    expect(parseRequest({ action: "memo_date_backfill" })).toEqual({ action: "memo_date_backfill", dryRun: false });
  });
});
