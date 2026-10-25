/**
 * 필드 탭 양식 패널 렌더 스모크(2026-10-24, docs/tasks/field-form-tidy.md S4~S6).
 * App.tsx 에서 src/field/ 로 옮긴 청정기·점검·AS 패널이 대표 props 로 예외 없이 그려지고 칸 라벨이 나오는지만 본다.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AirPurifierFormPanel } from "../src/field/AirPurifierFormPanel";
import { ProcessingFormPanel, type ProcessingFormPanelProps } from "../src/field/ProcessingFormPanel";
import { FieldActionBar, type FieldActionBarProps } from "../src/field/FieldActionBar.view";
import { FieldGuideNote } from "../src/field/FieldGuideNote.view";
import { fieldSendLabel, type AirPurifierForm, type PerItemForm, type SharedForm } from "../src/field/fieldFormModel";

const EMPTY_AIR_FORM_FOR_TEST: AirPurifierForm = { filterReset: "", filterChange: "", notes: "", arrivalHour: "", arrivalMinute: "", duration: "" };

const item = (model: string, serial: string): PerItemForm => ({
  location: "", model, serial, asset: "", content: "정기점검", processContent: "", mailBlack: "", mailColor: "", mailLargeColor: "", mailTotal: "",
  tonerK: "", tonerC: "", tonerM: "", tonerY: "", waste: "", spareRaw: "K1 C1", hantin: "", parking: "", notes: "",
});
const SHARED: SharedForm = { level: "", region: "", warranty: "", cumCount: "", expectedCount: "", partName: "", partQty: "", partShipped: "", selfItem: "", selfQty: "", selfShipped: "", arrivalHour: "", arrivalMinute: "", duration: "" };
const noop = () => {};
function processingProps(over: Partial<ProcessingFormPanelProps>): ProcessingFormPanelProps {
  const forms = [item("C3060", "ABC123")];
  return {
    itemForm: forms[0], setItemF: noop, shared: SHARED, setSharedF: noop, itemCount: forms.length, itemLabels: ["1. C3060"], selectedItem: 0, setSelectedItem: noop,
    accent: "#2563EB", bgSoft: "#EFF6FF", author: "홍길동", setAuthor: noop, reportTypes: ["점검"], reportTypeOther: "", setReportTypes: noop, setReportTypeOther: noop,
    canManageDevices: false, allItemForms: forms, onAddDevice: noop, onUpdateDevice: noop, onMoveDevice: noop, onReorderDevice: noop, onRemoveDevice: noop,
    showLevel: false, showHantinParking: false, regionValue: "B", ...over,
  };
}

const render = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, "");

describe("필드 양식 패널 렌더", () => {
  beforeAll(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    const mem = new Map<string, string>();
    const ls = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); }, removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear(), key: () => null, length: 0 };
    vi.stubGlobal("localStorage", ls);
    vi.stubGlobal("window", { localStorage: ls, innerWidth: 390, matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }), addEventListener: () => {}, removeEventListener: () => {}, setTimeout, clearTimeout, setInterval, clearInterval, location: { href: "", search: "", hash: "" } });
  });
  afterAll(() => { vi.unstubAllGlobals(); });

  it("청정기: 작성자·필터리셋·필터교체 라벨", () => {
    const html = render(createElement(AirPurifierFormPanel, { form: EMPTY_AIR_FORM_FOR_TEST, setAirF: () => {}, accent: "#2563EB", author: "홍길동", setAuthor: () => {} }));
    expect(html).toContain("작성자");
    expect(html).toContain("필터리셋");
    expect(html).toContain("필터교체");
    expect(html).toContain("홍길동");
  });

  it("점검: 레벨·한틴이카·주차비 칸과 기기 고르기", () => {
    const html = render(createElement(ProcessingFormPanel, processingProps({ showLevel: true, showHantinParking: true, canManageDevices: true })));
    for (const label of ["작성자", "지역", "구분", "레벨", "처리내용", "매수", "여분"]) expect(html).toContain(label);
    expect(html).toContain("한틴이카");
    expect(html).toContain("주차비");
    expect(html).toContain("기기 선택");
  });

  it("등급 칸(2026-10-25): 지역→등급→구분→레벨 순, 목록 밖 값은 직접 입력 칸에, 원본 전엔 잠금, 넘기지 않으면 칸 없음", () => {
    const html = render(createElement(ProcessingFormPanel, processingProps({ showLevel: true, grade: "유지보수", onGrade: noop })));
    const order = ["지역", "등급", "구분", "레벨"].map((l) => html.indexOf(`>${l}<`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('aria-label="등급 직접 입력"');
    expect(html).toContain('value="유지보수"');
    const known = render(createElement(ProcessingFormPanel, processingProps({ showLevel: true, grade: "SS", onGrade: noop })));
    expect(known).not.toContain('aria-label="등급 직접 입력"');
    expect(render(createElement(ProcessingFormPanel, processingProps({ grade: null, onGrade: noop })))).toContain("원본을 넣으면 고를 수 있습니다");
    expect(render(createElement(ProcessingFormPanel, processingProps({})))).not.toContain(">등급<");
    const setters = { text: noop, list: noop, blocks: noop };
    expect(render(createElement(ProcessingFormPanel, processingProps({ gradeText: "구분: AS\n등급: 유지보수\n업체명: A", gradeSetters: setters })))).toContain('value="유지보수"');
    expect(render(createElement(ProcessingFormPanel, processingProps({ gradeText: "업체명: A", gradeSetters: setters })))).toContain("원본을 넣으면 고를 수 있습니다");
  });

  it("S6 한 장의 종이: 섹션 제목·카드 1장, 알약 라벨·3중 상자 없음", () => {
    const html = render(createElement(ProcessingFormPanel, processingProps({ showLevel: true, showHantinParking: true })));
    expect(html).toContain("추가 정보");
    expect(html).toContain("부품·자가·시간");
    expect(html).toContain('aria-label="점검·AS 양식"');
    expect(html).not.toContain("rounded-2xl");
    expect(html).not.toContain("shadow-sm");
    expect(html).not.toMatch(/rounded-full bg-slate-200 px-3 py-0\.5 text-\[13px\]/);
    const air = render(createElement(AirPurifierFormPanel, { form: EMPTY_AIR_FORM_FOR_TEST, setAirF: () => {}, accent: "#2563EB", author: "홍길동", setAuthor: () => {} }));
    expect(air).not.toContain("rounded-2xl");
    expect(air).toContain('aria-label="청정기 양식"');
  });

  it("AS: 기기 2대면 기기 목록이 나오고, 레벨·한틴이카는 숨는다", () => {
    const forms = [item("C3060", "ABC123"), item("IM C3000", "XYZ789")];
    const html = render(createElement(ProcessingFormPanel, processingProps({ canManageDevices: true, allItemForms: forms, itemCount: 2, itemLabels: ["1. C3060", "2. IM C3000"] })));
    expect(html).toContain("기기 선택");
    expect(html).toContain("2대 중 1번 편집 중");
    expect(html).toContain("처리내용");
    expect(html).not.toContain("레벨");
    expect(html).not.toContain("한틴이카");
  });
});

describe("S7 단추 줄·안내", () => {
  const bar = (over: Partial<FieldActionBarProps>) => render(createElement(FieldActionBar, {
    variant: "bottom", mode: "logistics", hasOutput: true, sending: false, photoCount: 0, onReset: noop, onCopy: noop, onPhotoSelect: noop,
    issue: "", onFillRegion: noop, onOpenSendPicker: noop, onSend: noop, praiseReady: false, onPraiseSubmit: noop, sheetUrl: "", ...over,
  }));
  it("보내기 글자: 물류는 물류방 보내기, 보내는 중", () => {
    expect(fieldSendLabel("logistics", false)).toBe("물류방 보내기");
    expect(fieldSendLabel("bulman", false)).toBe("보내기");
    expect(fieldSendLabel("logistics", true)).toBe("보내는 중…");
    expect(bar({})).toContain("물류방 보내기");
  });
  it("점검은 카톡방 전송, 교체는 전송 불가, 시트 링크는 PC에서 시트 열기", () => {
    expect(bar({ mode: "inspection" })).toContain("카톡방 전송");
    expect(bar({ mode: "replacement" })).toContain("전송 불가 · 복사 전용");
    expect(bar({ mode: "bulman", variant: "side", sheetUrl: "https://example.com" })).toContain("시트 열기");
  });
  it("칭찬은 praiseReady 가 꺼져 있으면 보내기 비활성", () => {
    expect(bar({ mode: "praise", praiseReady: false })).toMatch(/<button[^>]*disabled=""[^>]*>보내기<\/button>/);
    expect(bar({ mode: "praise", praiseReady: true })).not.toMatch(/<button[^>]*disabled=""[^>]*>보내기<\/button>/);
  });
  it("지역 없음 경고: PC 만 A~E 바로 고르기", () => {
    expect(bar({ variant: "side", issue: "region" })).toContain(">E</button>");
    expect(bar({ variant: "bottom", issue: "region" })).not.toContain(">E</button>");
  });
  it("안내 한 줄", () => {
    const html = render(createElement(FieldGuideNote, { icon: "🧾", title: "점검 원문 정리", description: "붙여넣으면 양식이 채워집니다" }));
    expect(html).toContain("점검 원문 정리");
    expect(html).toContain("자세히");
  });
});
