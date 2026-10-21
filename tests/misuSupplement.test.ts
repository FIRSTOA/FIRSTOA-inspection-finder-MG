/** 미수 [보완 기록 쓰기] 넘기기 — 값 저장·10분 만료·이벤트 값 해석·원 기록 복사 */
import { describe, expect, it } from "vitest";
import {
  buildSupplementDraft, buildSupplementPayload, clearSupplementRequest, MISU_SUPPLEMENT_KEY, MISU_SUPPLEMENT_MAX_AGE_MS,
  parseSupplementPayload, readSupplementRequest, supplementSlotMeta, supplementVendorOption, writeSupplementRequest,
} from "../src/misuSupplement";
import { emptyMisuVisitDraft, type MisuVisit } from "../src/misuVisit";

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

const original: MisuVisit = {
  ...emptyMisuVisitDraft({
    id: "orig-1", visit_round: "2차 경고", visited_at: "2026-10-20T05:20:00Z", author: "이민구", author_team: "C",
    vendor: "○○학원", company_code: "2139567243", lease_seq: "3004", site_code: "S1", region: "C",
    misu_months: "5", misu_balance: "2140050", contact_name: "김대표", contact_title: "대표", open_status: "영업중",
    dun_methods: ["구두 안내"], dun_reply: "납부 약속", judgment: "계속 독촉", judgment_reason: "약속",
    photos: [{ slot: "outside", url: "https://x/o.jpg", w: 800, h: 600 }, { slot: "door", url: "pending:door" }],
    album_id: "alb-1", text_body: "옛 문장", room: "미수C",
  }),
  created_at: "2026-10-20T05:21:00Z", _hidden: false, _hidden_by: null, _hidden_at: null,
};

describe("보완 요청 값(localStorage)", () => {
  it("이벤트 값을 만들고 저장하면 10분 안에는 읽힌다", () => {
    const st = memStorage();
    const p = buildSupplementPayload(original);
    expect(p).toEqual({ visitId: "orig-1", vendor: "○○학원", company_code: "2139567243", site_code: "S1", lease_seq: "3004", region: "C", visit_round: "2차 경고" });
    expect(writeSupplementRequest(st, p, 1_000_000)).toBe(true);
    expect(readSupplementRequest(st, 1_000_000 + MISU_SUPPLEMENT_MAX_AGE_MS)).toEqual(p);
  });
  it("10분 지난 값은 무시한다", () => {
    const st = memStorage();
    writeSupplementRequest(st, buildSupplementPayload(original), 1_000_000);
    expect(readSupplementRequest(st, 1_000_000 + MISU_SUPPLEMENT_MAX_AGE_MS + 1)).toBeNull();
  });
  it("깨진 값·id 없는 값은 무시, clear 하면 사라진다", () => {
    const st = memStorage();
    st.setItem(MISU_SUPPLEMENT_KEY, "{not json");
    expect(readSupplementRequest(st)).toBeNull();
    expect(parseSupplementPayload({ vendor: "x" })).toBeNull();
    expect(parseSupplementPayload(null)).toBeNull();
    writeSupplementRequest(st, buildSupplementPayload(original));
    clearSupplementRequest(st);
    expect(readSupplementRequest(st)).toBeNull();
  });
});

describe("보완 초안 = 원 기록 전체본", () => {
  const now = new Date("2026-10-22T01:00:00Z");
  const d = buildSupplementDraft(original, now);
  it("id 는 새로, supplement_of 는 원 id", () => {
    expect(d.id).not.toBe("orig-1");
    expect(d.supplement_of).toBe("orig-1");
    expect(d.visited_at).toBe(now.toISOString());
  });
  it("원 기록 내용을 그대로 복사하고 서버·숨김 열과 앨범·문장·방은 비운다", () => {
    expect(d.vendor).toBe("○○학원");
    expect(d.visit_round).toBe("2차 경고");
    expect(d.contact_name).toBe("김대표");
    expect(d.dun_methods).toEqual(["구두 안내"]);
    expect(d.judgment).toBe("계속 독촉");
    expect(d.photos[0]?.url).toBe("https://x/o.jpg");
    expect(d.album_id).toBe("");
    expect(d.text_body).toBe("");
    expect(d.room).toBe("");
    expect("created_at" in d).toBe(false);
    expect("_hidden" in d).toBe(false);
  });
  it("복사본을 고쳐도 원 기록은 그대로", () => {
    d.dun_methods.push("x");
    expect(original.dun_methods).toEqual(["구두 안내"]);
  });
  it("업체 칸·사진 칸은 원 기록에서 채운다(올라간 주소만)", () => {
    expect(supplementVendorOption(original)).toMatchObject({ name: "○○학원", companyCode: "2139567243", leaseSeq: "3004", team: "C" });
    expect(supplementSlotMeta(original.photos)).toEqual({ outside: { url: "https://x/o.jpg", w: 800, h: 600 } });
  });
});
