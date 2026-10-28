// 통합검색 바깥·운영·정의 도구(T12~T15, 2026-10-29)
import { describe, expect, it } from "vitest";
import { KPI_DEFS_DATA, explainKpi, itSheetSearch, itSheetTool, kakaoSearchTool, minutesAgo, opsStatus } from "../supabase/functions/_shared/ask/tools-ext.ts";
import { KPI_DEFS, KPI_NOT_BUILT } from "../src/kpi/kpiDefs";
import { askMask } from "../supabase/functions/_shared/ask/mask.ts";
import type { AskToolCtx } from "../supabase/functions/_shared/ask/tool-util.ts";

const ctx = (over: Partial<AskToolCtx["rest"]> = {}): AskToolCtx => ({
  rest: {
    async get<T>() { return [] as T[]; },
    async getAll<T>() { return { rows: [] as T[], truncated: false }; },
    async count() { return 0; },
    async rpc<T>() { return [] as T; },
    async edge<T>() { return {} as T; },
    ...over,
  },
  mask: askMask, today: "2026-10-29", asker: { name: "이민구", team: "C", dept: "CS", title: "" }, mode: "data",
});

describe("kpi_explain", () => {
  it("kpi-defs.json 이 src/kpi/kpiDefs.ts 와 같다(어긋나면 node tools/build-ask-kpi-defs.mjs)", () => {
    expect(KPI_DEFS_DATA.defs.map((d) => [d.id, d.name, d.basis])).toEqual(KPI_DEFS.map((d) => [d.id, d.name, d.basis]));
    expect(KPI_DEFS_DATA.pending.map((p) => p.id)).toEqual(KPI_NOT_BUILT.map((p) => p.id));
  });
  it("id·이름 낱말로 찾고, 없으면 목록", () => {
    expect(explainKpi(KPI_DEFS_DATA, "K19").defs?.[0].id).toBe("K19");
    expect(explainKpi(KPI_DEFS_DATA, "재계약 진행").defs?.map((d) => d.id)).toContain("K35");
    expect(explainKpi(KPI_DEFS_DATA, "K9").pending.map((p) => p.id)).toEqual(["K9"]);
    expect(explainKpi(KPI_DEFS_DATA, "없는지표xyz").list?.length).toBe(KPI_DEFS.length);
  });
});

describe("it_sheet", () => {
  it("낱말 모두 든 줄만, 빈 칸 버림", () => {
    const r = itSheetSearch([{ 제목: "PC 부팅 안 됨", 조치: "램 재장착", 빈: "" }, { 제목: "프린터", 조치: "" }], "부팅 램", 10);
    expect(r).toEqual({ matched: 1, rows: [{ 제목: "PC 부팅 안 됨", 조치: "램 재장착" }] });
  });
  it("비공개(HTML)·실패는 오류로", async () => {
    const html = await itSheetTool({ tab: "sales", q: "x" }, ctx(), async () => ({ ok: true, status: 200, text: async () => "<html>login</html>" }));
    expect(String(html.error)).toContain("비공개");
    const bad = await itSheetTool({ tab: "links", q: "x" }, ctx(), async () => ({ ok: false, status: 403, text: async () => "" }));
    expect(String(bad.error)).toContain("403");
    expect(String((await itSheetTool({ tab: "nope", q: "x" }, ctx())).error)).toContain("knowledge");
  });
  it("공개 CSV 를 읽어 찾는다", async () => {
    const r = await itSheetTool({ tab: "history", q: "부팅" }, ctx(), async () => ({ ok: true, status: 200, text: async () => "제목,연락처\nPC 부팅,010-1234-5678\n프린터,x\n" }));
    expect(r).toMatchObject({ total: 2, matched: 1 });
    expect(JSON.stringify(r)).not.toContain("1234-5678");
  });
});

describe("kakao_search·ops_status", () => {
  it("스위치 꺼짐은 enabled:false, 검색어 없으면 오류", async () => {
    expect(await kakaoSearchTool({ q: "잡플러스" }, ctx({ async edge<T>() { return { ok: true, enabled: false, rows: [] } as T; } }))).toMatchObject({ enabled: false });
    expect((await kakaoSearchTool({}, ctx())).error).toBeTruthy();
  });
  it("심박 분·스위치는 on/off 만, 읽기 실패는 partial 로", async () => {
    const now = Date.parse("2026-10-29T03:00:00Z");
    expect(minutesAgo("2026-10-29T02:50:00Z", now)).toBe(10);
    const r = await opsStatus({}, ctx({
      async get<T>(path: string) {
        if (path.startsWith("worker_heartbeat")) return [{ name: "laptop", last_seen: "2026-10-29T02:58:00Z", note: "v 2026-10-29a" }] as T[];
        if (path.startsWith("app_config")) return [{ key: "KAKAO_SEARCH_ENABLED", value: "false" }, { key: "FIELD_KAKAO_SEND_ENABLED", value: "true" }] as T[];
        throw new Error("401");
      },
      async count(table: string) { if (table === "outbox") return 3; throw new Error("403 count"); },
    }), now) as unknown as { worker: Array<{ minutesAgo: number }>; outboxWaiting: number; switches: Record<string, boolean | null>; partial: string[]; aiThisMonth: string };
    expect(r.worker[0].minutesAgo).toBe(2);
    expect(r.outboxWaiting).toBe(3);
    expect(r.switches).toMatchObject({ KAKAO_SEARCH_ENABLED: false, FIELD_KAKAO_SEND_ENABLED: true, NAVER_CALENDAR_ENABLED: null });
    expect(r.partial.join(" ")).toContain("방 활동");
    expect(String(r.aiThisMonth)).toContain("읽기 불가");
  });
});
