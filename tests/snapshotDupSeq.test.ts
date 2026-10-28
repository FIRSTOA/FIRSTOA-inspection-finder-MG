import { describe, expect, it } from "vitest";
import { buildSnapshotRecords, SHEET_LAYOUTS, type ParsedSheetRow } from "../supabase/functions/reception-sheet-open/state";

// 2026-10-29 사용자 "원격팀 중복 알아서 정리": 원격 탭에 같은 순번(1069·1154)이 두 행에 적혀 한 행이 보관 표에서 빠지던 것.
// 남의 시트는 고치지 않고, 두 번째 행을 순번~지문6 키로 따로 보관한다.
const L = SHEET_LAYOUTS.remote;
const row = (over: Partial<ParsedSheetRow>): ParsedSheetRow => ({
  source: "remote", kind: "원격이관", sheetRow: 10, seq: "1069", date: "2026-10-20", author: "지경민", handler: "",
  state: "완료", cls: "done", vendor: "가나상사", field: "", region: "", summary: "", ...over,
});
const values: string[][] = Array.from({ length: 30 }, () => []);

describe("보관 표 — 같은 순번 두 행", () => {
  it("내용이 다르면 두 행 모두 보관(두 번째는 순번~지문6), duplicates 는 정보로만", () => {
    const rows = [row({ sheetRow: 10 }), row({ sheetRow: 11, vendor: "다라전자", author: "신동원" })];
    const out = buildSnapshotRecords(L, values, rows, new Map(), new Map(), "2026-10-29T00:00:00Z");
    expect(out.records.map((r) => r.seq)).toEqual(["1069", expect.stringMatching(/^1069~[0-9a-f]{6}$/)]);
    expect(out.duplicates).toHaveLength(1);
  });

  it("같은 행을 다시 읽어도 같은 키(매시간 중복 적재 없음)", () => {
    const rows = [row({ sheetRow: 10 }), row({ sheetRow: 11, vendor: "다라전자", author: "신동원" })];
    const a = buildSnapshotRecords(L, values, rows, new Map(), new Map(), "t1").records.map((r) => r.seq);
    const b = buildSnapshotRecords(L, values, rows, new Map(), new Map(), "t2").records.map((r) => r.seq);
    expect(b).toEqual(a);
  });

  it("날짜·접수자·상호까지 같은 두 행은 정말 같은 접수 — 한 번만", () => {
    const rows = [row({ sheetRow: 10 }), row({ sheetRow: 11 })];
    const out = buildSnapshotRecords(L, values, rows, new Map(), new Map(), "t");
    expect(out.records).toHaveLength(1);
  });
});
