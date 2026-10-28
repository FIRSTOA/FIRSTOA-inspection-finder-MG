import { describe, expect, it } from "vitest";
import {
  CATALOG, DESC_EXTRA_WORDS, FORBIDDEN_COL, FORBIDDEN_TABLES, isForbiddenTable, scopeAllows, shapeRow, stripHiddenKeys, type Asker,
} from "../supabase/functions/_shared/ask/catalog";
import { buildFilterParts, isRestBlocked, makeRest } from "../supabase/functions/_shared/ask/rest";

// 통합검색 "무엇이든 묻기" 표 목록 — 설계 docs/tasks/search-ask-everything-2026-10-29.md 3-4·4장 3
describe("ask catalog", () => {
  const tables = Object.keys(CATALOG);

  it("3-4 금지 표·백업 사본이 없다", () => {
    for (const t of FORBIDDEN_TABLES) expect(tables).not.toContain(t);
    for (const t of tables) expect(isForbiddenTable(t)).toBe(false);
    expect(isForbiddenTable("_backup_jeomgeom")).toBe(true);
    expect(isForbiddenTable("okr_reports_bak_20261020")).toBe(true);
  });

  it("html·urls·raw·phone·tel·전화·token·key 칸이 없다", () => {
    for (const [t, c] of Object.entries(CATALOG)) {
      for (const col of c.cols) expect(FORBIDDEN_COL.test(col), `${t}.${col}`).toBe(false);
      expect(c.cols.some((x) => /html|phone|token|휴대폰|전화/i.test(x)), t).toBe(false);
    }
  });

  it("3-1·3-2 주요 표가 들어 있다", () => {
    for (const t of ["jeomgeom", "as_tickets", "okr_cycles", "okr_reports", "reception_sheet_rows", "team_calendar_events", "misu_visits", "activity_events", "photo_albums", "plan_memos", "weekly_notes", "stock_items", "room_map", "kakao_delivery_log"]) expect(tables).toContain(t);
    expect(CATALOG.as_tickets.cols).toEqual(expect.arrayContaining(["note", "calendarTitle"]));
    expect(CATALOG.as_tickets.cols).not.toContain("vendor_code");
    expect(CATALOG.misu.cols).not.toContain("휴대폰번호");
  });

  it("date·team·grade·vendor·author·pk 칸이 cols 에 있다", () => {
    for (const [t, c] of Object.entries(CATALOG)) {
      for (const k of [c.date, c.team, c.grade, c.author, c.pk, c.vendor].filter(Boolean) as string[]) expect(c.cols, `${t} ${k}`).toContain(k);
    }
  });

  it("desc 에 쓴 snake_case 칸 이름이 그 표 cols 에 있다(다른 표·도구 이름은 예외)", () => {
    for (const [t, c] of Object.entries(CATALOG)) {
      const words = c.desc.match(/\b_?[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) || [];
      for (const w of words) {
        const ok = c.cols.includes(w) || tables.includes(w) || DESC_EXTRA_WORDS.includes(w) || (c.countCols || []).some((x) => `${x}_count` === w);
        expect(ok, `${t} desc: ${w}`).toBe(true);
      }
    }
  });

  it("shapeRow — 목록 밖·금지 칸 버림, JSON 안 html 키 제거, 사진 urls 는 개수만", () => {
    const okr = shapeRow(CATALOG.okr_reports, { cycle_id: "2026-10-W4", team: "C", member: "이민구", rows: [{ no: 1, actual: "3건", html: { actual: "<b>3건</b>" } }], secret: "x" });
    expect(okr.rows).toContain("3건");
    expect(String(okr.rows)).not.toContain("<b>");
    expect(okr).not.toHaveProperty("secret");
    const photo = shapeRow(CATALOG.photo_albums, { id: "a1", vendor: "무암", urls: ["u1", "u2", "u3"] });
    expect(photo.urls_count).toBe(3);
    expect(photo).not.toHaveProperty("urls");
    expect(stripHiddenKeys({ a: { memoHtml: "x", memo: "y" } })).toEqual({ a: { memo: "y" } });
  });

  it("Q1 범위 — 회고는 같은 팀만, 부서 달력은 같은 부서만, 팀장은 전체", () => {
    const team: Record<string, string> = { 이민구: "C", 박영현: "C", 지경민: "B" };
    const groupOf = (n: string) => team[n] || "";
    const me: Asker = { name: "이민구", team: "C", dept: "CS팀", title: "" };
    const wn = CATALOG.weekly_notes;
    expect(scopeAllows(wn, { author: "이민구" }, me, groupOf)).toBe(true);
    expect(scopeAllows(wn, { author: "박영현" }, me, groupOf)).toBe(true);
    expect(scopeAllows(wn, { author: "지경민" }, me, groupOf)).toBe(false);
    const lead: Asker = { name: "팀장님", team: "팀장", dept: "CS팀", title: "팀장" };
    expect(scopeAllows(wn, { author: "지경민" }, lead, groupOf)).toBe(true);
    const stranger: Asker = { name: "", team: "", dept: "", title: "" };
    expect(scopeAllows(wn, { author: "지경민" }, stranger, groupOf)).toBe(false);
    const cal = CATALOG.team_calendar_events;
    const mgmt: Asker = { name: "손영근", team: "", dept: "경영지원파트", title: "파트장" };
    expect(scopeAllows(cal, { team: "경영지원" }, mgmt, groupOf)).toBe(true);
    expect(scopeAllows(cal, { team: "영업팀" }, mgmt, groupOf)).toBe(false);
    const ops: Asker = { name: "x", team: "운영지원", dept: "CSS/운영지원파트", title: "" };
    expect(scopeAllows(cal, { team: "운영지원" }, ops, groupOf)).toBe(true);
    // 범위 없는 표는 누구나
    expect(scopeAllows(CATALOG.jeomgeom, { 작성자: "지경민" }, me, groupOf)).toBe(true);
  });
});

describe("ask rest", () => {
  it("조건 — 한글 칸 큰따옴표·인코딩, 칸 밖·모르는 연산은 거절", () => {
    const r = buildFilterParts("jeomgeom", CATALOG.jeomgeom, [{ col: "작성일", op: "gte", value: "2026-10-01" }, { col: "_업체명", op: "ilike", value: "무암" }]);
    expect("parts" in r && r.parts).toEqual([`${encodeURIComponent('"작성일"')}=gte.2026-10-01`, `${encodeURIComponent('"_업체명"')}=ilike.${encodeURIComponent("*무암*")}`]);
    expect("error" in buildFilterParts("jeomgeom", CATALOG.jeomgeom, [{ col: "password", op: "eq", value: "1" }])).toBe(true);
    expect("error" in buildFilterParts("jeomgeom", CATALOG.jeomgeom, [{ col: "작성자", op: "delete", value: "1" }])).toBe(true);
  });

  it("막힌 표·RPC·엣지는 부르지 않고, getAll 은 1,000행씩 넘긴다", async () => {
    expect(isRestBlocked("push_subscriptions")).toBe(true);
    expect(isRestBlocked("ops.edge_calls")).toBe(true);
    const urls: string[] = [];
    const fake = async (u: string) => {
      urls.push(u);
      const offset = Number(new URL(u).searchParams.get("offset") || 0);
      const n = offset < 2000 ? 1000 : 5;
      return new Response(JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: offset + i }))), { status: 200 });
    };
    const rest = makeRest("https://x.supabase.co", "anon", { fetchImpl: fake });
    await expect(rest.get("naver_oauth?select=*")).rejects.toThrow();
    await expect(rest.rpc("delete_everything", {})).rejects.toThrow();
    await expect(rest.edge("push-send", {})).rejects.toThrow();
    const all = await rest.getAll("jeomgeom", "select=id&limit=5");
    expect(all.rows.length).toBe(2005);
    expect(all.truncated).toBe(false);
    expect(urls[0]).toContain("order=id.asc");
    expect(urls[0]).not.toContain("limit=5&");
    const capped = await rest.getAll("jeomgeom", "select=id", { max: 2000 });
    expect(capped.truncated).toBe(true);
  });
});
