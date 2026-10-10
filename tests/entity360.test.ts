import { describe, expect, it } from "vitest";
import { buildExactQuery, buildLooseQuery, buildRawQuery, dateOf, daysSince, deriveState, entityTokensFromQuestion, identKey, inList, isOtherVendor, looksLikeDevice, matchesEntity, modelKey, phonesIn, SOURCES, toEvent, toEvents, withKeys, type Entity, type SourceResult } from "../src/entity360";

const src = (table: string) => SOURCES.find((s) => s.table === table)!;
const entity: Entity = withKeys({ code: "23013", leaseCode: "21462", name: "주식회사 무암", names: ["주식회사 무암", "무암(주)"], serials: ["ZPBLBJST8000GQV", "B1"], assets: ["A5571"], core: "무암", query: "무암", leaseRows: [] });

describe("entity360 — 키·조건 조립", () => {
  it("identKey 는 영숫자 소문자만 (lease_ident_code.ident 규칙)", () => {
    expect(identKey(" ZPB-LBJ st/8000 ")).toBe("zpblbjst8000");
  });
  it("looksLikeDevice: 영숫자+숫자 3자 이상만 기기 번호로 본다", () => {
    expect(looksLikeDevice("B7230")).toBe(true);
    expect(looksLikeDevice("무암")).toBe(false);
    expect(looksLikeDevice("AB")).toBe(false);
  });
  it("inList 는 값을 따옴표로 감싸고 URL 인코딩 — 쉼표·공백·괄호가 있어도 깨지지 않는다", () => {
    expect(inList(["a b", "c,d", 'x"y'])).toBe('in.("a%20b","c%2Cd","xy")');
  });
  it("정확 조건: 코드 칸 eq + 이름 in + 기기 in (원문 ilike 는 따로)", () => {
    const q = buildExactQuery(src("as_tickets"), entity)!;
    expect(q).toContain("vendor_code.eq.23013");
    expect(q).toContain('vendor.in.("%EC%A3%BC%EC%8B%9D%ED%9A%8C%EC%82%AC%20%EB%AC%B4%EC%95%94"');
    expect(q).toContain("serial.in.(");
    expect(q).not.toContain("ilike");
    expect(q).toContain("limit=400");
  });
  it("원문 조건: 7자 넘는 기번 2개까지 ilike, 짧은 번호는 안 쓴다, jeomgeom 은 기번 배열 겹침(ov)", () => {
    const q = buildRawQuery(src("as_tickets"), entity)!;
    expect(q).toContain("issue.ilike.*ZPBLBJST8000GQV*");
    expect(q).not.toContain("*B1*");
    expect(buildRawQuery(src("jeomgeom"), entity)).toContain(encodeURIComponent('"_기번목록"') + '=ov.{"ZPBLBJST8000GQV","B1","A5571"}');
    expect(buildRawQuery(src("as_tickets"), { ...entity, serials: ["B1"] })).toBeNull();
  });
  it("승격 기준: 표기만 다른 같은 업체(이름 키)나 같은 기기 번호면 정확 일치로 본다", () => {
    expect(entity.nameKeys).toContain("무암");
    expect(matchesEntity(src("jeomgeom"), { _업체명: "무암" }, entity)).toBe(true);
    expect(matchesEntity(src("jeomgeom"), { _업체명: "(주)무암 분기마감" }, entity)).toBe(true);
    expect(matchesEntity(src("jeomgeom"), { _업체명: "무암건설" }, entity)).toBe(false);
    expect(matchesEntity(src("jeomgeom"), { _업체명: "다른곳", 자산기번: "a-5571" }, entity)).toBe(true);
    expect(matchesEntity(src("jeomgeom"), { _업체명: "다른곳", _기번목록: ["x", "zpblbjst8000gqv"] }, entity)).toBe(true);
  });
  it("isOtherVendor: 같은 기기를 쓰던 다른 업체 기록을 가려낸다", () => {
    const ev = toEvent(src("jeomgeom"), { id: 1, _업체명: "정상에듀학원", 자산기번: "A5571" }, false);
    expect(isOtherVendor(ev, entity)).toBe(true);
    expect(isOtherVendor(toEvent(src("jeomgeom"), { id: 2, _업체명: "주식회사 무암 (Mooam)" }, false), entity)).toBe(false);
  });
  it("한글·괄호 칸 이름은 따옴표로 감싸 인코딩하고, 임대리스트는 임대 코드(5자리)로 찾는다", () => {
    const q = buildExactQuery(src("vendor_info"), entity)!;
    expect(q).toContain(encodeURIComponent('"시리얼번호(기번)"') + ".in.(");
    expect(q).toContain(encodeURIComponent('"코드"') + ".eq.21462");
    expect(q).not.toContain("eq.23013");
    expect(q).toContain("_hidden=not.is.true");
  });
  it("느슨 조건은 core 로 ilike, core 가 없으면 null", () => {
    expect(buildLooseQuery(src("jeomgeom"), entity)).toContain("ilike.*%EB%AC%B4%EC%95%94*");
    expect(buildLooseQuery(src("jeomgeom"), { ...entity, core: "" })).toBeNull();
    expect(buildLooseQuery(src("counter_sms_targets"), entity)).toContain("vendor.ilike");
  });
  it("이름·기기가 하나도 없으면 정확 조건도 null (빈 or 로 전체를 끌어오지 않게)", () => {
    expect(buildExactQuery(src("jeomgeom"), { ...entity, code: "", names: [], serials: [], assets: [] })).toBeNull();
  });
  it("전화번호 칸(해피콜·예약 문자)은 숫자만 번호로, JSON 경로 칸은 따옴표 없이", () => {
    const e = withKeys({ ...entity, phones: ["01044816440"] });
    expect(buildExactQuery(src("happycall_messages"), e)).toContain('recipient.in.("01044816440")');
    expect(buildExactQuery(src("message_jobs"), e)).toContain("payload->>vendor.in.(");
    expect(buildExactQuery(src("happycall_messages"), withKeys({ ...entity, phones: [] }))).toBeNull();
    expect(phonesIn("010-4481-6440 현해리대표님\n02-123-4567 사무실 / 010.9868.3268")).toEqual(["01044816440", "021234567", "01098683268"]);
  });
  it("질문에서 업체·기번 후보를 뽑는다 — 조사·흔한 말 제외, 기기 번호 우선", () => {
    expect(entityTokensFromQuestion("잡플러스는 AS가 몇 번 터졌어?")).toEqual(["잡플러스"]);
    expect(entityTokensFromQuestion("B6945 언제부터 어디서 썼어?")[0]).toBe("B6945");
    expect(entityTokensFromQuestion("여긴 미수가 얼마나 있어?")).toEqual([]);
  });
  it("modelKey: 기종 표기에서 공통 숫자 핵심", () => {
    expect(modelKey("SL-X3220NR")).toBe("3220");
    expect(modelKey("DOCUCENTRE-V C2263(마블)")).toBe("2263");
    expect(modelKey("MFC-L5700DN")).toBe("5700");
    expect(modelKey("4단트레이")).toBe("");
  });
});

describe("entity360 — 날짜·사건·현재 상태", () => {
  it("dateOf: 표마다 다른 형식을 yyyy-mm-dd 로", () => {
    expect(dateOf({ 작성일: "2026.9.3" }, ["작성일"])).toBe("2026-09-03");
    expect(dateOf({ 날짜: "26-09-03" }, ["날짜"])).toBe("2026-09-03");
    expect(dateOf({ created_at: "2026-09-03T10:00:00+00:00" }, ["없음"])).toBe("2026-09-03");
    expect(dateOf({ 메모: "없음" }, ["메모"])).toBe("");
    expect(daysSince("2026-10-01", new Date("2026-10-10T12:00:00+09:00"))).toBe(9);
  });
  it("toEvent: 제목·요약·기기 칸을 표 설정대로 뽑는다", () => {
    const ev = toEvent(src("jeomgeom"), { id: 7, 작성일: "2026-10-01", 처리내용: "토너 교체", 특이사항: "엘베 없음", 매수: "12345", 작성자: "이민구", 지역: "C", 모델명: "SL-X3220", 시리얼넘버: "ZPB1", 자산기번: "B1" }, false);
    expect(ev).toMatchObject({ key: "jeomgeom:7", date: "2026-10-01", title: "토너 교체", author: "이민구", team: "C", model: "SL-X3220", serial: "ZPB1", asset: "B1", loose: false });
    expect(ev.snippet).toBe("엘베 없음 · 12345");
  });
  it("deriveState: 임대리스트·변경·미수·마지막 점검·열린 접수를 종합한다", () => {
    const lease = [{ id: 1, 모델명: "SL-X3220", 자산번호: "A5571", 기번: "ZPBLBJST8000GQV", 계약일: "2024-01-01", 종료일: "2027-01-01", 기본금액: "55,000", 등급: "N", 임대여부: "임대", 주소상세주소: "서울 강남구 1", 키맨: "김과장", 일반전화: "02-1" }];
    const e: Entity = withKeys({ ...entity, leaseRows: lease });
    const results: SourceResult[] = [
      { source: src("vendor_info"), exact: lease, loose: [], ok: true },
      { source: src("jeomgeom"), exact: [{ id: 2, 작성일: "2026-09-01", 자산기번: "a5571", 처리내용: "점검" }, { id: 3, 작성일: "2026-06-01", 자산기번: "x", 처리내용: "옛 점검" }], loose: [], ok: true },
      { source: src("contact_changes"), exact: [{ id: 4, change_date: "2026-09-20", category: "주소 변경", after_text: "서울 서초구 2" }, { id: 9, change_date: "2026-09-25", category: "결제 담당자 변경", after_text: "박부장 010-1" }], loose: [], ok: true },
      { source: src("misu"), exact: [{ id: 5, 입력일: "2026-10-01", 미수개월: "2", 미수잔액: "110,000" }], loose: [], ok: true },
      { source: src("service_receptions"), exact: [{ id: 6, receipt_date: "2026-10-02", status: "접수" }, { id: 7, receipt_date: "2026-09-02", status: "완료" }], loose: [{ id: 8, receipt_date: "2026-09-03", status: "접수" }], ok: true },
    ];
    const s = deriveState(e, results, new Date("2026-10-10T12:00:00+09:00"));
    expect(s.address).toBe("서울 서초구 2");
    expect(s.addressFrom).toContain("2026-09-20");
    expect(s.keyman).toBe("박부장 010-1");           // 사람 계열 변경이 임대리스트 키맨보다 우선
    expect(s.keymanFrom).toContain("2026-09-25");
    expect(s.changes).toBe(2);
    expect(s.devices[0]).toMatchObject({ model: "SL-X3220", lastInspect: "2026-09-01", end: "2027-01-01" });
    expect(s.misu).toEqual({ months: "2", amount: "110,000", date: "2026-10-01" });
    expect(s.lastInspect).toBe("2026-09-01");
    expect(s.openReceptions).toBe(1);   // 느슨 일치는 세지 않는다
    expect(s.total).toBe(8);
    expect(toEvents(results).filter((ev) => ev.loose)).toHaveLength(1);
  });
});
