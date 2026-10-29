/**
 * GAS 카톡 물류 파서·날짜 정규화(apps-script/first-data/src/Logistics.gs·DateNorm.gs) — node 에서 .gs 를 그대로 읽어 검사한다.
 * 핵심: 카톡에서 다시 읽은 FIELD 물류 글의 _dupKey 가 앱 sendLogisticsForm(src/api.ts)과 같아야 on_conflict 로 중복이 막힌다.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLogisticsText, EMPTY_LOGISTICS_FORM } from "../src/logistics";
import { md5 } from "../src/md5";
import { vendorMatchKey } from "../src/ids";
import type { LogisticsFormState } from "../src/api";

const GAS_DIR = resolve(__dirname, "../apps-script/first-data/src");
const read = (name: string) => readFileSync(resolve(GAS_DIR, name), "utf8");

/** 파일에서 함수 하나만 잘라 온다(Kakao.gs 는 다른 사람이 고치는 중이라 통째로 싣지 않는다) */
function sliceFunction(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} 없음`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`${name} 끝을 못 찾음`);
}

// GAS Utilities.computeDigest 흉내 — 실제 GAS 처럼 부호 있는 바이트(-128~127) 배열을 돌려준다
const Utilities = {
  DigestAlgorithm: { MD5: "MD5" }, Charset: { UTF_8: "UTF-8" },
  computeDigest: (_alg: string, text: string) => Array.from(createHash("md5").update(text, "utf8").digest()).map((b) => (b > 127 ? b - 256 : b)),
};

type Row = Record<string, string>;
type Msg = { date: string; author: string; text: string };
type Gas = {
  normalizeDateText: (v: unknown, ref?: unknown) => string | null;
  normYmd_: (v: unknown, ref?: unknown) => unknown;
  normalizeKakaoDates_: (cat: string, obj: Record<string, unknown>, ref?: unknown) => Record<string, unknown>;
  isLogisticsForm_: (t: string) => boolean;
  parseLogisticsForm_: (t: string) => Row;
  logisticsMd5_: (t: string) => string;
  logisticsVendorKey_: (v: string) => string;
  buildLogisticsRows_: (m: Msg[], o?: { team?: string; isBot?: (a: string) => boolean }) => { rows: Row[]; forms: number; freeText: number; bot: number; noVendor: number };
  filterLogisticsAgainstExisting_: (rows: Row[], existing: Row[]) => { rows: Row[]; dupKey: number; near: number };
  parseKakaoMessages_: (t: string) => Msg[];
  logisticsDupKeyQueries_: (keys: string[], prefixLen: number) => string[];
};

const gas: Gas = new Function("Utilities", [
  read("DateNorm.gs"), read("Logistics.gs"),
  "function pad2_(n) { return (n < 10 ? '0' : '') + Number(n); }",
  sliceFunction(read("Kakao.gs"), "parseKakaoMessages_"),
  "return { normalizeDateText, normYmd_, normalizeKakaoDates_, isLogisticsForm_, parseLogisticsForm_, logisticsMd5_, logisticsVendorKey_, buildLogisticsRows_, filterLogisticsAgainstExisting_, parseKakaoMessages_, logisticsDupKeyQueries_ };",
].join("\n"))(Utilities);

// FIELD 물류 양식 실제 샘플 3개 — 앱과 같은 함수(buildLogisticsText)로 만든다
const SAMPLES: { form: LogisticsFormState; author: string }[] = [
  { author: "이민구", form: { ...EMPTY_LOGISTICS_FORM, category: "납품", vendor: "(주)블루닷 강남지점", item: "ApeosPort C3375", quantity: "1", consumableBilling: "납품", setup: "완료", emailCounter: "O", hanjo: "O", condition: "양호", notes: "3층 총무팀 앞 설치" } },
  { author: "박수민", form: { ...EMPTY_LOGISTICS_FORM, category: "철수", vendor: "티나고 본사", item: "SL-X7400", quantity: "2", spareToner: "K 2개 회수", notes: "" } },
  { author: "김슬기", form: { ...EMPTY_LOGISTICS_FORM, category: "기타", categoryOther: "교체(임시)", vendor: "푸드나무/성수 현장", item: "D330", quantity: "1대", notes: "기존기 불량\n다음 주 회수 예정" } },
];
const appKey = (s: (typeof SAMPLES)[number], date: string) => {
  const category = s.form.category === "기타" ? s.form.categoryOther.trim() : s.form.category;
  return md5([date, s.author, category, s.form.vendor.trim(), s.form.item, s.form.quantity, s.form.notes].join("|"));
};
/** 카톡 PC 저장 파일 모양: 첫 줄에 날짜·시각·작성자, 이어지는 줄은 그대로, 뒤에 앱이 붙이는 사진 앨범 꼬리 */
const pcExport = (date: string, who: string, text: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return `${y}. ${m}. ${d}. 오후 3:24, ${who} : ${text}\n\n📷 현장사진 모아보기\nhttps://field.example/?album=abc-123`;
};

describe("MD5 — GAS 식(부호 바이트 보정) = 앱 src/md5.ts = node crypto", () => {
  it("한글·기호·줄바꿈 섞인 키에서 세 값이 같다", () => {
    for (const s of ["", "2026-10-24|이민구|납품|(주)블루닷|C3375|1|3층", "푸드나무/성수 현장|1대|기존기 불량\n다음 주", "㈜ 必 📷"]) {
      const node = createHash("md5").update(s, "utf8").digest("hex");
      expect(md5(s)).toBe(node);
      expect(gas.logisticsMd5_(s)).toBe(node);
    }
  });
});

describe("카톡 물류 양식 → logistics_records 행", () => {
  it("앱이 보낸 글을 카톡 저장 파일에서 다시 읽으면 칸과 _dupKey 가 앱 저장분과 같다", () => {
    const date = "2026-10-24";
    const file = SAMPLES.map((s) => pcExport(date, "Ai법인폰", buildLogisticsText(s.form, s.author))).join("\n");
    const messages = gas.parseKakaoMessages_(file);
    const out = gas.buildLogisticsRows_(messages, { team: "*" });
    expect(out.rows).toHaveLength(3);
    out.rows.forEach((row, i) => {
      const s = SAMPLES[i];
      expect(row._dupKey).toBe(appKey(s, date));
      expect(row["작성자"]).toBe(s.author);
      expect(row["거래처명"]).toBe(s.form.vendor);
      expect(row["_업체명"]).toBe(s.form.vendor);
      expect(row["특이사항"]).toBe(s.form.notes);   // 앨범 꼬리는 특이사항에 붙지 않는다
      expect(row["_출처"]).toBe("카톡:물류");
      expect(row["작성일"]).toBe(date);
    });
    expect(out.rows[1]["여분토너체크(철수 시)"]).toBe("K 2개 회수");
    expect(out.rows[2]["구분"]).toBe("교체(임시)");
  });

  it("팀 표시 · 봇 글 건너뛰기 · 자유 글은 수만 · 거래처명 없으면 제외 · 같은 글 두 번은 1행", () => {
    const form = buildLogisticsText(SAMPLES[0].form, SAMPLES[0].author);
    const msgs: Msg[] = [
      { date: "2026-10-24", author: "홍길동", text: form },
      { date: "2026-10-24", author: "홍길동", text: form },
      { date: "2026-10-24", author: "Ai법인폰", text: form },
      { date: "2026-10-24", author: "홍길동", text: "블루닷 내일 오전 납품 갑니다" },
      { date: "2026-10-24", author: "홍길동", text: "사진 3장" },
      { date: "2026-10-24", author: "홍길동", text: buildLogisticsText({ ...SAMPLES[0].form, vendor: "" }, "홍길동") },
    ];
    const out = gas.buildLogisticsRows_(msgs, { team: "E", isBot: (a) => a === "Ai법인폰" });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]["_출처"]).toBe("카톡:물류(E)");
    expect(out.bot).toBe(1);
    expect(out.freeText).toBe(1);
    expect(out.noVendor).toBe(1);
    expect(gas.isLogisticsForm_("업체명: 블루닷\n구분: AS")).toBe(false);   // 점검·AS 양식은 물류가 아니다
  });

  it("이중 방어: 같은 _dupKey 또는 (구분·업체 키 같고 ±1일)이면 빼고, 다른 구분·2일 차이는 넣는다", () => {
    const row = gas.buildLogisticsRows_([{ date: "2026-10-24", author: "x", text: buildLogisticsText(SAMPLES[0].form, "이민구") }]).rows[0];
    const base = { "구분": "납품", "거래처명": "블루닷 강남지점", "_업체명": "블루닷 강남지점", "_출처": "웹앱:물류", "_dupKey": "other" };
    expect(gas.filterLogisticsAgainstExisting_([row], [{ ...base, "작성일": "2026-10-20", "_dupKey": row._dupKey }]).dupKey).toBe(1);
    expect(gas.filterLogisticsAgainstExisting_([row], [{ ...base, "작성일": "2026-10-23" }]).near).toBe(1);   // 밤에 쓰고 아침 발송
    expect(gas.filterLogisticsAgainstExisting_([row], [{ ...base, "작성일": "2026-10-22" }]).rows).toHaveLength(1);
    expect(gas.filterLogisticsAgainstExisting_([row], [{ ...base, "작성일": "2026-10-24", "구분": "철수" }]).rows).toHaveLength(1);
  });

  it("유사 중복은 웹앱 출처 행만 건너뛴다", () => {
    const row = gas.buildLogisticsRows_([{ date: "2026-10-24", author: "x", text: buildLogisticsText(SAMPLES[0].form, "이민구") }]).rows[0];
    const web = { "작성일": "2026-10-24", "구분": "납품", "거래처명": "블루닷 강남지점", "_업체명": "블루닷 강남지점", "_출처": "웹앱:물류", "_dupKey": "other" };
    const f = gas.filterLogisticsAgainstExisting_([row], [web]);
    expect(f.near).toBe(1);
    expect(f.rows).toHaveLength(0);
  });

  it("카톡 출처 유사 행은 막지 않는다(이틀 연속 같은 업체·같은 구분 양식은 실제 작업) — _dupKey 일치는 출처 무관하게 막는다", () => {
    const row = gas.buildLogisticsRows_([{ date: "2026-10-24", author: "x", text: buildLogisticsText(SAMPLES[0].form, "이민구") }]).rows[0];
    const kakao = { "작성일": "2026-10-23", "구분": "납품", "거래처명": "블루닷 강남지점", "_업체명": "블루닷 강남지점", "_출처": "카톡:물류", "_dupKey": "other" };
    const f = gas.filterLogisticsAgainstExisting_([row], [kakao]);
    expect(f.near).toBe(0);
    expect(f.rows).toHaveLength(1);
    expect(gas.filterLogisticsAgainstExisting_([row], [{ ...kakao, "_dupKey": row._dupKey }]).dupKey).toBe(1);
  });

  it("업체 키는 앱 vendorMatchKey 와 같은 규칙", () => {
    for (const v of ["(주)블루닷 강남지점", "25#V보림토건(주) 3분기", "블루닷 주식회사", "㈜티나고(bluedot Inc.)", "2609/17#V카페24"]) {
      expect(gas.logisticsVendorKey_(v)).toBe(vendorMatchKey(v));
    }
  });
});

describe("날짜 정규화 normalizeDateText / normYmd_", () => {
  it.each([
    ["26-11-15", "2026-11-15"], ["26.12.26", "2026-12-26"], ["26,11,30", "2026-11-30"], ["26년10월22일", "2026-10-22"],
    ["2024. 5. 23", "2024-05-23"], ["2026. 3. 10.", "2026-03-10"], ["2025.12.10", "2025-12-10"], ["2026년 6월 10일", "2026-06-10"],
    ["26-06-12 금요일", "2026-06-12"], ["2024-06-26 00:00:00", "2024-06-26"], ["2025-04-02", "2025-04-02"],
    ["2024-06-25T15:00:00.000Z", "2024-06-26"], ["Thu Aug 24 2023 00:00:00 GMT+0900 (Korean Standard Time)", "2023-08-24"], ["20261115", "2026-11-15"],
  ])("%s → %s", (input, want) => {
    expect(gas.normalizeDateText(input)).toBe(want);
  });

  it("못 읽는 것은 null, normYmd_ 는 원래 글을 돌려준다", () => {
    expect(gas.normalizeDateText("6월 19일")).toBeNull();   // 연도 없음
    expect(gas.normalizeDateText("26.11.15~27.11.14")).toBeNull();   // 기간
    expect(gas.normalizeDateText("26-02-30")).toBeNull();   // 없는 날
    expect(gas.normalizeDateText("미정")).toBeNull();
    expect(gas.normYmd_("미정")).toBe("미정");
  });

  it("연도 없는 날은 기준일의 해로, 반년 넘게 뒤면 전년", () => {
    expect(gas.normalizeDateText("6월 19일", "2026-06-25")).toBe("2026-06-19");
    expect(gas.normalizeDateText("12월 30일", "2026-01-05")).toBe("2025-12-30");
  });

  it("normalizeKakaoDates_ 는 카테고리 대상 칸만 바꾼다", () => {
    const obj = { "계약종료일": "26,11,30", "다음확인일": "미정", "기한": "26-11-01" };
    gas.normalizeKakaoDates_("재계약", obj);
    expect(obj).toEqual({ "계약종료일": "2026-11-30", "다음확인일": "미정", "기한": "26-11-01" });
    const ins = { "작성일": "26-11-01" };
    gas.normalizeKakaoDates_("점검", ins);
    expect(ins["작성일"]).toBe("26-11-01");
  });
});

describe("적재 확인 조회 URL 길이 — GAS UrlFetch 2KB 한도", () => {
  // 2026-10-29·30 완료방: 키 100개씩 묶어 URL 약 3.4KB → "길이 초과: URLFetch URL 길이" throw → 파일이 확인필요로 감
  const prefix = "https://kkdiihazgzesbqxjytqv.supabase.co/rest/v1/logistics_records?";
  const keys = Array.from({ length: 250 }, (_, i) => createHash("md5").update(String(i)).digest("hex"));
  it("모든 조회 URL 이 2,000자 이하이고, 키를 빠짐없이 한 번씩 담는다", () => {
    const qs = gas.logisticsDupKeyQueries_(keys, prefix.length);
    expect(qs.length).toBeGreaterThan(2);
    for (const q of qs) expect((prefix + q).length).toBeLessThanOrEqual(2000);
    const back = qs.flatMap((q) => q.slice(q.indexOf("in.(") + 4, -1).split(","));
    expect(back).toEqual(keys);
  });
  it("키가 없으면 조회도 없다", () => {
    expect(gas.logisticsDupKeyQueries_([], prefix.length)).toEqual([]);
  });
});
