/**
 * GAS 카톡 수집 판정 규칙(apps-script/first-data/src/CollectRules.gs) 검사.
 * GAS 파일을 그대로 읽어 new Function 으로 올린다 — 로직을 복제하지 않는다.
 * 설계: docs/tasks/kakao-collect-expand.md 3-1·3-2·3-6·3-7
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type Route = {
  roomName: string; kinds: string[]; labels?: string[]; team: string; category: string;
  enabled: boolean; export: boolean; structured: boolean; keepRaw: boolean; source: string;
};
type Plan = { held: boolean; reason: string; steps: Array<{ kind: string; mode: string }>; raw: boolean };
type Rules = {
  collectParseKinds_: (v: unknown) => string[];
  collectRouteFromTableRow_: (row: unknown) => Route | null;
  collectRouteFromSheetRow_: (room: string, cat: string, team: string) => Route | null;
  collectPlan_: (route: Route | null | undefined) => Plan;
  parseBotNicks_: (v: unknown) => string[];
  isBotAuthorIn_: (author: unknown, nicks: string[]) => boolean;
  splitBotMessages_: (msgs: Array<{ author: string; text: string }>, nicks: string[]) => { messages: unknown[]; botSkipped: number };
  actionNeedsToken_: (a: string) => boolean;
  checkAdminToken_: (expected: unknown, given: unknown) => boolean;
  summarizeCollectStatus_: (rooms: Route[], logs: Array<{ ts: number; cat: string; room: string; status: string }>, held: string[], last: unknown) => {
    rooms: Array<{ room: string; kinds: string[]; last_import_at: number | null; last_raw_at: number | null; held: number }>;
    held_total: number; held_names: string[]; unregistered: string[]; last_run: unknown;
  };
};

const src = readFileSync(join(process.cwd(), "apps-script", "first-data", "src", "CollectRules.gs"), "utf8");
const names = [
  "collectParseKinds_", "collectRouteFromTableRow_", "collectRouteFromSheetRow_", "collectPlan_",
  "parseBotNicks_", "isBotAuthorIn_", "splitBotMessages_", "actionNeedsToken_", "checkAdminToken_", "summarizeCollectStatus_",
];
const R = new Function(`${src}\nreturn { ${names.join(", ")} };`)() as Rules;

describe("방 kinds 해석", () => {
  it("배열·Postgres 배열 글·쉼표 글·A/S 표기 모두 표준 순서로", () => {
    expect(R.collectParseKinds_(["AS", "점검"])).toEqual(["점검", "AS"]);
    expect(R.collectParseKinds_("{점검,AS}")).toEqual(["점검", "AS"]);
    expect(R.collectParseKinds_("as, 점검")).toEqual(["점검", "AS"]);
    expect(R.collectParseKinds_("A/S")).toEqual(["AS"]);
    expect(R.collectParseKinds_(["A/S"])).toEqual(["AS"]);
    expect(R.collectParseKinds_("모르는값")).toEqual([]);
  });
  it("초과조정은 처리 종류에서 빠지고 표시용 labels 에만 남는다", () => {
    const r = R.collectRouteFromTableRow_({ room: "강북A/초과사용 계약종료체크", kinds: ["재계약", "초과조정"], region: "A" })!;
    expect(r.kinds).toEqual(["재계약"]);
    expect(r.labels).toEqual(["재계약", "초과조정"]);
    expect(R.collectPlan_(r).steps).toEqual([{ kind: "재계약", mode: "ai" }]);
  });
  it("E 겸용 방은 점검 → AS 두 패스", () => {
    const r = R.collectRouteFromTableRow_({ room: "충청외E 극지방 as", kinds: "{점검,AS}", region: "E", enabled: true, structured: true, keep_raw: true })!;
    const p = R.collectPlan_(r);
    expect(p.held).toBe(false);
    expect(p.steps).toEqual([{ kind: "점검", mode: "inspectform" }, { kind: "AS", mode: "asform" }]);
    expect(p.raw).toBe(true);
  });
  it("물류는 라벨 파서, 불만·미수는 AI", () => {
    const r = R.collectRouteFromTableRow_({ room: "완료방", kinds: ["물류", "불만", "미수"] })!;
    expect(R.collectPlan_(r).steps.map((s) => s.mode)).toEqual(["logisticsform", "ai", "ai"]);
  });
  it("미등록·꺼짐·처리 없음은 확인필요, structured=false 면 원문만", () => {
    expect(R.collectPlan_(null).held).toBe(true);
    expect(R.collectPlan_(R.collectRouteFromTableRow_({ room: "x", kinds: ["점검"], enabled: false })).reason).toBe("꺼짐");
    expect(R.collectPlan_(R.collectRouteFromTableRow_({ room: "x", kinds: [], keep_raw: false })).held).toBe(true);
    const rawOnly = R.collectPlan_(R.collectRouteFromTableRow_({ room: "x", kinds: ["점검"], structured: "false", keep_raw: "true" }));
    expect(rawOnly).toMatchObject({ held: false, steps: [], raw: true });
  });
  it("시트 대체 경로는 원문 보관을 켜지 않는다", () => {
    const r = R.collectRouteFromSheetRow_("강북A as", "AS", "A")!;
    expect(r).toMatchObject({ kinds: ["AS"], category: "AS", team: "A", keepRaw: false, source: "sheet" });
  });
});

describe("봇 대화명 제외", () => {
  it("기본값 Ai법인폰, 쉼표 목록", () => {
    expect(R.parseBotNicks_("")).toEqual(["Ai법인폰"]);
    expect(R.parseBotNicks_(null)).toEqual(["Ai법인폰"]);
    expect(R.parseBotNicks_("Ai법인폰, 봇2 ,")).toEqual(["Ai법인폰", "봇2"]);
  });
  it("정확히 같은 이름만(공백·님·대소문자 무시), 부분 일치는 사람으로", () => {
    const nicks = ["Ai법인폰"];
    expect(R.isBotAuthorIn_("Ai법인폰", nicks)).toBe(true);
    expect(R.isBotAuthorIn_(" ai 법인폰님", nicks)).toBe(true);
    expect(R.isBotAuthorIn_("Ai법인폰2", nicks)).toBe(false);
    expect(R.isBotAuthorIn_("", nicks)).toBe(false);
  });
  it("메시지 묶음에서 봇 글만 빠진다", () => {
    const r = R.splitBotMessages_([{ author: "Ai법인폰", text: "a" }, { author: "홍길동", text: "b" }], ["Ai법인폰"]);
    expect(r.botSkipped).toBe(1);
    expect(r.messages).toHaveLength(1);
  });
});

describe("관리 토큰", () => {
  it("쓰기 13개 + contactpeek 은 토큰 필요, 읽기는 아님", () => {
    for (const a of ["ingestnow", "retryheld", "kakaoclear", "celltrim", "dedupe", "seenreset", "cursorreset",
      "roommapset", "roommapdel", "rebuildindex", "indexfinalize", "indexonly", "photoarchive", "contactpeek", "IngestNow"]) {
      expect(R.actionNeedsToken_(a), a).toBe(true);
    }
    for (const a of ["ping", "search", "adminstatus", "roommap", "uploadlog", "collectstatus", "pull", "ack"]) {
      expect(R.actionNeedsToken_(a), a).toBe(false);
    }
  });
  it("속성 없으면 거부, 같을 때만 통과", () => {
    expect(R.checkAdminToken_("", "")).toBe(false);
    expect(R.checkAdminToken_(null, "abc")).toBe(false);
    expect(R.checkAdminToken_("secret-1", undefined)).toBe(false);
    expect(R.checkAdminToken_("secret-1", "secret-2")).toBe(false);
    expect(R.checkAdminToken_("secret-1", "secret-1x")).toBe(false);
    expect(R.checkAdminToken_("secret-1", "secret-1")).toBe(true);
  });
});

describe("수집 요약", () => {
  it("방별 마지막 적재·원문·확인필요, 미등록 방", () => {
    const rooms = [
      R.collectRouteFromTableRow_({ room: "강북A 점검방", kinds: ["점검"], region: "A" })!,
      R.collectRouteFromTableRow_({ room: "충청외E 극지방 as", kinds: ["점검", "AS"], region: "E" })!,
    ];
    const logs = [
      { ts: 100, cat: "점검", room: "강북A 점검방", status: "완료(드라이브)" },
      { ts: 200, cat: "원문", room: "강북A 점검방", status: "원문 전송(2조각)" },
      { ts: 300, cat: "점검", room: "충청외E 극지방 as", status: "새 메시지 없음" },
      { ts: 400, cat: "AS", room: "충청외E 극지방 as", status: "실패(드라이브): x" },
      { ts: 500, cat: "원문", room: "충청외E 극지방 as", status: "원문 실패: 500" },
      { ts: 600, cat: "확인필요", room: "새 물류방", status: "확인필요(드라이브·미등록)" },
      { ts: 700, cat: "오류", room: "abc.txt", status: "실패(드라이브): y" },
    ];
    const s = R.summarizeCollectStatus_(rooms, logs, ["a.txt", "b.txt"], { at: "x" });
    expect(s.rooms[0]).toMatchObject({ room: "강북A 점검방", last_import_at: 100, last_raw_at: 200, held: 0 });
    expect(s.rooms[1]).toMatchObject({ kinds: ["점검", "AS"], last_import_at: 300, last_raw_at: null, held: 1 });
    expect(s.held_total).toBe(2);
    expect(s.held_names).toEqual(["a.txt", "b.txt"]);
    expect(s.unregistered).toEqual(["새 물류방"]);
    expect(s.last_run).toEqual({ at: "x" });
  });
  it("적재 성공이 오면 그 방 확인필요 수는 0으로", () => {
    const rooms = [R.collectRouteFromTableRow_({ room: "r", kinds: ["불만"] })!];
    const s = R.summarizeCollectStatus_(rooms, [
      { ts: 2, cat: "불만", room: "r", status: "대기열 등록(드라이브)" },
      { ts: 1, cat: "불만", room: "r", status: "실패(드라이브): z" },
    ], [], null);
    expect(s.rooms[0].held).toBe(0);
    expect(s.last_run).toBeNull();
  });
});
