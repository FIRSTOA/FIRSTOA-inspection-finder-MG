/**
 * 헤더 🔍 시트(2026-10-25, docs/tasks/tab-search-icon-merge-2026-10-25.md) — 탭별 팝업 구성·아이콘 모든 탭·390px 넘침·카톡 줄 표시.
 * 서버 렌더(renderToString)라 효과(useEffect)는 돌지 않는다 = 조회 없이 첫 화면만 본다.
 */
vi.hoisted(() => {
  const mem = new Map<string, string>();
  const ls = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); }, removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear(), key: () => null, length: 0 };
  (globalThis as Record<string, unknown>).localStorage = ls;
  (globalThis as Record<string, unknown>).window = { localStorage: ls, innerWidth: 390, matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }), addEventListener: () => {}, removeEventListener: () => {}, setTimeout, clearTimeout, setInterval, clearInterval, location: { href: "", search: "", hash: "" } };
});
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import FieldSearchSheet from "../src/field/FieldSearchSheet";
import { kakaoNote, sheetHeading } from "../src/tabSearchLine";
import { HEADER_ICON_GAP_PX, HEADER_ICON_PX, headerIconCount, searchIconLabel } from "../src/fieldSearchIcon";
import { TAB_SPECS, tabKeyOf, type TabLine } from "../src/tabSearch";
import { TabSearchResults } from "../src/TabSearch.view";
import { candidateForName, excludeShownForms, kakaoNameOf } from "../src/useTabSearch";

const render = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, "");
const noop = () => {};
const sheet = (mode: string, pcSubTab?: string, open = true) => render(createElement(FieldSearchSheet, {
  open, onClose: noop, mode, pcSubTab, seed: "", accent: "#123456", onLoadForm: noop, onVendor: noop, onError: noop,
}));

const MODES = ["inspection", "blank-report", "air-purifier", "samsung-note", "pc", "logistics", "replacement", "contact-change", "bulman", "misu", "overage-adjust", "recontract", "praise"];
const SUBS: Array<string | undefined> = [undefined, "it", "copier", "bo"];

describe("🔍 시트 탭별 구성", () => {
  it("점검·AS = VendorSearch(업체·주소·자산기번 검색칸), TabSpec 검색칸은 없음", () => {
    const html = sheet("inspection");
    expect(html).toContain("점검·AS 이력 검색");
    expect(html).toContain("업체명·주소·자산기번·시리얼 검색");
    expect(html).not.toContain(TAB_SPECS.inspection.question);
  });
  it("청정기 = AirSearch", () => {
    const html = sheet("air-purifier");
    expect(html).toContain("청정기 거래처명 입력");
    expect(html).toContain("청정기 이력 검색");
  });
  it("물류 = TabSpec 검색칸(질문 문구), VendorSearch 없음", () => {
    const html = sheet("logistics");
    expect(html).toContain(`placeholder="${TAB_SPECS.logistics.question}"`);
    expect(html).toContain("물류 이력 검색");
    expect(html).not.toContain("업체명·주소·자산기번·시리얼 검색");
  });
  it("닫힘·검색 탭 없음(확장성 bo)은 아무것도 안 그린다", () => {
    expect(sheet("inspection", undefined, false)).toBe("");
    expect(sheet("pc", "bo")).toBe("");
  });
  it("시트 제목 = {탭 이름} 이력 검색", () => {
    expect(sheetHeading("misu").title).toBe("미수 이력 검색");
    expect(sheetHeading("bulman").sub).toBe(TAB_SPECS.bulman.question);
  });
});

describe("헤더 🔍 아이콘", () => {
  it("모든 탭에서 tabKeyOf 와 같이 보이고, 이름은 탭 이름", () => {
    for (const m of MODES) for (const sub of SUBS) {
      const tab = tabKeyOf(m, sub);
      const label = searchIconLabel(m, sub);
      expect(!!label, `${m}/${sub}`).toBe(!!tab);
      if (tab && tab !== "inspection") expect(label).toBe(`${TAB_SPECS[tab].label} 이력 검색`);
      if (tab) expect(sheet(m, sub).length).toBeGreaterThan(50);
    }
    expect(searchIconLabel("inspection")).toBe("거래처검색");
    expect(searchIconLabel("pc", "bo")).toBeNull();
  });
  it("390px 에서 아이콘 줄이 넘치지 않는다(최대 4칸 · 제목 자리 남김)", () => {
    const max = Math.max(...MODES.flatMap((m) => SUBS.map((s) => headerIconCount(m, s))));
    expect(max).toBeLessThanOrEqual(4);
    const width = max * HEADER_ICON_PX + (max - 1) * HEADER_ICON_GAP_PX;
    expect(390 - 32 - width).toBeGreaterThanOrEqual(150); // 좌우 여백 16px·제목 최소 150px
  });
  it("App 은 🔍 조건을 searchIconLabel 로, 옛 맨 위 검색칸은 없다", () => {
    const app = readFileSync(resolve(__dirname, "../src/App.tsx"), "utf8");
    expect(app).toContain("{searchIconLabel(mode, pcSubTab) && (");
    expect(app).toContain("<FieldSearchSheet ");
    expect(app).not.toContain("TabSearchBar");
    // 헤더 아이콘 줄(통합이력 단추가 있는 블록)의 📷·📝 조건이 fieldSearchIcon.headerIconCount 와 같은지, 단추는 4칸
    const i = app.indexOf('aria-label="통합이력"');
    const block = app.slice(app.lastIndexOf('<div className="flex items-center gap-1">', i), app.indexOf("</header>", i));
    expect(block.match(/\{\(mode === "inspection" \|\| mode === "air-purifier" \|\| mode === "blank-report"\) && \(/g)?.length).toBe(2);
    expect(block.match(/h-10 w-10/g)?.length).toBe(4);
  });
});

describe("한 목록 표시·보조 함수", () => {
  const base: TabLine = { key: "1", table: "as_records", kind: "AS", tone: "x", date: "2026-10-20", title: "용지걸림", detail: "", author: "홍길동", team: "A", device: "", raw: "", loose: false, otherVendor: "", vendor: "가나", logiKind: "" };
  const kakao: TabLine = { ...base, key: "kakao:9", table: "kakao_messages", kind: "카톡", source: "kakao", detail: "A 점검방", title: "내일 방문", kindGuess: "form:AS" };
  it("카톡 줄 배지·양식 글 배지·숨김 [보기]·꺼짐 안내", () => {
    const html = render(createElement(TabSearchResults, {
      spec: TAB_SPECS.logistics, title: "가나", runState: "done", error: "", onRun: noop, lines: [base, kakao], all: [base, kakao],
      hidden: [{ ...kakao, key: "kakao:10" }], chip: "all", onChip: noop, summary: "", coverage: null, resultKey: "k", kakao: "disabled", onKakaoRetry: noop,
    }));
    expect(html).toContain("카톡");
    expect(html).toContain("표에 안 들어간 양식 글");
    expect(html).toContain("표에 이미 있는 카톡 글 1건 숨김");
    expect(html).toContain("카톡 원문 검색은 꺼져 있습니다(관리자가 켬)");
    expect(kakaoNote(kakao)).toBe("표에 없는 대화 · A 점검방");
  });
  it("점검·AS 는 카톡을 접힌 묶음으로", () => {
    const html = render(createElement(TabSearchResults, {
      spec: TAB_SPECS.inspection, title: "가나", heading: "더 지난 이력", foldKakao: true, runState: "done", error: "", onRun: noop, lines: [base, kakao], all: [base, kakao],
      hidden: [], chip: "all", onChip: noop, summary: "", coverage: null, resultKey: "k", kakao: "error", onKakaoRetry: noop,
    }));
    expect(html).toContain("카톡 대화 1건(표에 없는 글)");
    expect(html).not.toContain("내일 방문");
    expect(html).toContain("카톡 대화를 못 불러왔습니다");
  });
  it("카드와 같은 원문은 이력에서 뺀다(공백만 정리, 숫자 다르면 남김)", () => {
    const a = { ...base, key: "a", formText: "업체명: 가나\n매수 100" };
    const b = { ...base, key: "b", formText: "업체명: 가나\n매수 200" };
    expect(excludeShownForms([a, b], ["업체명: 가나  매수 100 "]).map((l) => l.key)).toEqual(["b"]);
    expect(excludeShownForms([a, b], [])).toHaveLength(2);
  });
  it("거래처검색 이름 → 첫 후보가 같은 업체일 때만", () => {
    const c = { code: "1", leaseCode: "", name: "(주)가나상사", deviceCount: 1, how: "이름" };
    expect(candidateForName("가나상사", [c])).toBe(c);
    expect(candidateForName("다라마바", [c])).toBeNull();
    expect(candidateForName("가나상사", [])).toBeNull();
  });
  it("카톡 검색어는 core 우선", () => {
    expect(kakaoNameOf({ core: "건영", name: "세무법인 건영 논현지점" })).toBe("건영");
    expect(kakaoNameOf({ core: "", name: "가나" })).toBe("가나");
  });
});
