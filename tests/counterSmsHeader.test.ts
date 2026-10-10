import { describe, expect, it } from "vitest";
import { detectDevices, detectListKind, mergeTargets, parseBlocks, parseListHeader, splitBlocks } from "../src/counterSmsParser";
import { rulesForVendor, type ContactRule } from "../src/counterSmsContacts";

// 관리부가 따로 올리는 CMS 마감 목록 — 머리글이 [수도권C](대괄호), 블록 끝에 "CMS.15"(결제일)
const CMS_SAMPLE = `[수도권C]
1, 1N엑솔라코리아 유한회사-매월마감
현수용 010-2596-9264
MFC-8900CDW / E76881E5F508444 / B7468
서울 강남구 테헤란로 4길 5, 해암빌딩 9층
CMS.15
`;

// 관리부가 마감방에 올리는 실제 목록 머리글 — 【수도권C】 + "26-10" (2026-10-10 사용자 예시)
const SAMPLE = `【수도권C】
26-10

[강남구]
30, 30S주식회사 더디자이너스디자인관광호텔신축공사 현장매월마감
010-2401-5104 성지은 과장(결제/계약) 010-7589-4000 강병규 기사(현장)
23013 / DOCUCENTRE-V C2263(마블) / 705790 / B6945
서울 강남구 역삼동 718-26 2층 현장사무실(엘베 없음, 계단)

5, 5N현대회계법인-매월마감
010-9373-1309 최미자
17473 / CLX-9201NA / Z8D9B1AF200014N / 미부착
서울 강남구 역삼로542 5층(대치동, 신사에스앤지빌딩)


[광진구]
31, 31V(주)잡플러스4층백업/합산분기마감
장경우 010-8618-8101(총괄)
21638 / SL-X7400LXR / ZPBLBJST8000GQV / A5571
서울 광진구 천호대로 537, 15층
~
미수 2개월, 2,096,700원
`;

describe("parseListHeader — 관리부 마감 목록 머리글", () => {
  it("【수도권C】·26-10 → C팀, 2026-10, '10월 마감'", () => {
    expect(parseListHeader(SAMPLE)).toEqual({ team: "C", ym: "2026-10", monthLabel: "10월 마감" });
  });
  it("【CSS】·【지방】은 E팀, 네 자리 연도도 받는다", () => {
    expect(parseListHeader("【CSS】\n2026-11\n\n1, 1N어딘가").team).toBe("E");
    expect(parseListHeader("【지방】\n2026.1\n").ym).toBe("2026-01");
  });
  it("머리글이 없으면 둘 다 undefined — 기기 줄(23013 / …)이나 전화번호를 달로 오인하지 않는다", () => {
    const noHead = SAMPLE.split("\n").slice(3).join("\n");
    expect(parseListHeader(noHead)).toEqual({ team: undefined, ym: undefined, monthLabel: undefined });
  });
  it("머리글·[구역] 줄이 있어도 업체 블록 수는 그대로", () => {
    expect(splitBlocks(SAMPLE)).toHaveLength(3);
  });
});

describe("기기 줄 → 임대 코드·기번·자산번호, 연락처 규칙 매칭", () => {
  it("detectDevices: '23013 / 모델 / 705790 / B6945' → 코드 23013·기번 705790·자산 B6945, '10013#' 꼴도, 코드 없는 줄도", () => {
    expect(detectDevices("23013 / DOCUCENTRE-V C2263(마블) / 705790 / B6945")).toEqual({ leaseCode: "23013", serials: [], assets: ["B6945"] });
    expect(detectDevices("10013# / SL-X4220RX / 28S3BJLK40000NX / X7258")).toEqual({ leaseCode: "10013", serials: ["28S3BJLK40000NX"], assets: ["X7258"] });
    expect(detectDevices("MFC-8900CDW / E76881E5F508444 / B7468")).toEqual({ leaseCode: "", serials: ["E76881E5F508444"], assets: ["B7468"] });
    expect(detectDevices("17473 / CLX-9201NA / Z8D9B1AF200014N / 미부착").assets).toEqual([]);
    const blocks = parseBlocks(SAMPLE, []);
    expect(blocks[0]).toMatchObject({ leaseCode: "23013", assets: ["B6945"] });
    expect(mergeTargets(blocks)[0].leaseCodes).toEqual(["23013"]);
  });
  it("rulesForVendor: 코드 → 기번 → 번호 → 이름 일치 → 이름 유사 순으로 잇고, 주소·층 차이는 상관없다", () => {
    const base = { kind: "block" as const, name: "", memo: "", updated_by: "김종희", updated_at: "2026-10-07T00:00:00Z" };
    const rules: ContactRule[] = [
      { ...base, id: "1", vendor_key: "청산", vendor: "N (주)청산-", phone: "01025072776", lease_code: "21111", serial: "" },
      { ...base, id: "2", vendor_key: "영모터스추가", vendor: "NN 영모터스추가", phone: "01026664594", lease_code: "", serial: "" },
      { ...base, id: "3", vendor_key: "우주건설", vendor: "N 김하담(개인)우주건설", phone: "01083661885", lease_code: "", serial: "zpb1" },
    ];
    // 이름이 "(주)청산 2층 경리부"로 달라졌지만 임대 코드가 같다
    expect(rulesForVendor(rules, "N (주)청산 2층 경리부", { leaseCodes: ["21111"] }).map((r) => [r.id, r.how])).toEqual([["1", "코드 일치"]]);
    // 이름은 전혀 다른데 🚫 번호가 이번 블록에 그대로 있다
    expect(rulesForVendor(rules, "S 다른회사", { phones: ["010-2666-4594"] }).map((r) => [r.id, r.how])).toEqual([["2", "번호 일치"]]);
    // 기번 일치
    expect(rulesForVendor(rules, "S 또다른회사", { serials: ["ZPB1"] })[0]).toMatchObject({ id: "3", how: "기번 일치" });
    // 이름 키만 같음(주소·층 무관) / 이름 앞부분만 같음(확인 필요)
    expect(rulesForVendor(rules, "N 영모터스추가 (서울 강남구 2층)")[0]).toMatchObject({ id: "2", how: "이름 일치" });
    expect(rulesForVendor(rules, "N 영모터스")[0]).toMatchObject({ id: "2", how: "이름 유사" });
    expect(rulesForVendor(rules, "N 무관한곳")).toEqual([]);
  });
});

describe("CMS 마감 목록 — 종류 구분 (같은 종류끼리만 맞추기)", () => {
  it("[수도권C] 대괄호 머리글도 C팀으로 읽고, 달은 없다", () => {
    expect(parseListHeader(CMS_SAMPLE)).toEqual({ team: "C", ym: undefined, monthLabel: undefined });
  });
  it("블록의 CMS.15 → CMS 마감·결제일 15, 일반 목록 블록은 ''", () => {
    expect(detectListKind(CMS_SAMPLE)).toEqual({ listKind: "CMS", cmsDay: 15 });
    expect(detectListKind("CMS 마감\n")).toEqual({ listKind: "CMS", cmsDay: null });
    const blocks = parseBlocks(SAMPLE, []);
    expect(blocks.every((b) => b.listKind === "")).toBe(true);
    const cms = parseBlocks(CMS_SAMPLE, []);
    expect(cms).toHaveLength(1);
    expect(cms[0]).toMatchObject({ listKind: "CMS", cmsDay: 15 });
    expect(cms[0].vendor).toMatch(/^N 엑솔라코리아/);
  });
  it("같은 번호라도 일반 마감과 CMS 마감은 한 통으로 합치지 않는다", () => {
    const general = `1, 1N무암-매월마감\n김담당 010-1111-2222\nSL-X3220NR / A / B\n`;
    const cms = `2, 2N무암 CMS-매월마감\n김담당 010-1111-2222\nSL-X3220NR / A / B\nCMS.20\n`;
    const merged = mergeTargets(parseBlocks(`${general}\n${cms}`, []));
    expect(merged).toHaveLength(2);
    expect(merged.map((t) => t.listKind).sort()).toEqual(["", "CMS"]);
    expect(merged.find((t) => t.listKind === "CMS")?.cmsDay).toBe(20);
  });
});
