/**
 * 사용자 동작의 저장·발송 실패를 삼키지 않기(2026-10-31 디버깅 점검).
 * 각 경로가 다시 `.catch(() => undefined)` 로 돌아가면 실패가 화면에 안 보여
 * 메모·OKR 글이 사라지거나, 문자는 나갔는데 기록이 없어 같은 고객에게 재발송될 수 있다.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(resolve(__dirname, "../src", f), "utf8").replace(/\r\n/g, "\n");
const block = (src: string, start: string, end: string) => {
  const s = src.indexOf(start);
  expect(s, start).toBeGreaterThan(-1);
  const e = src.indexOf(end, s + start.length);
  expect(e, end).toBeGreaterThan(s);
  return src.slice(s, e);
};

describe("저장·발송 실패를 알린다", () => {
  it("MyPlan — 일정 메모·지도 숨김 저장 실패를 notify 로 알린다", () => {
    const src = read("MyPlan.tsx");
    const memo = block(src, "const saveMemo = (ticketId: string, memo: string) => {", "\n  };");
    expect(memo).not.toMatch(/catch\(\(\) => undefined\)/);
    expect(memo).toMatch(/\.catch\(\(e\) => notify\(`메모를 저장하지 못했습니다/);
    const noMap = block(src, "const saveNoMap = (next: string[]) => {", "\n  };");
    expect(noMap).not.toMatch(/catch\(\(\) => undefined\)/);
    expect(noMap).toMatch(/notify\("지도 숨김을 서버에 저장하지 못했습니다/);
  });

  it("OkrHub — 달 이동·나가기 때 밀린 저장(flushPending) 실패를 건수와 함께 알린다", () => {
    const body = block(read("OkrHub.tsx"), "const flushPending = async () => {", "\n  };");
    expect(body).not.toMatch(/catch\(\(\) => undefined\)/);
    expect(body).toMatch(/saveOkrCycle\(c, author\)\.catch\(fail\)/);
    expect(body).toMatch(/saveOkrReport\(r, author\)\.catch\(fail\)/);
    expect(body).toMatch(/if \(failed\) notify\(/);
  });

  it("InspectionReport — 문자 발송 뒤 message_jobs 기록 실패를 '다시 보내지 마세요'로 알린다", () => {
    const body = block(read("InspectionReport.tsx"), "const send = async () => {", "\n  };");
    const rec = body.slice(body.indexOf("insertRow(\"message_jobs\""));
    expect(rec.slice(0, 600)).not.toMatch(/\.catch\(\(\) => undefined\)/);
    expect(rec).toMatch(/발송 기록 저장 실패 — 다시 보내지 마세요/);
  });

  it("CustomerReport — 발송 성공 뒤 기록 실패를 '발송 실패'로 세지 않는다(재발송 방지)", () => {
    const src = read("CustomerReport.tsx");
    const loop = block(src, "for (const r of sendTargets) {", "setSendOpen(false);");
    // 발송 try 안에 sent 기록이 같이 있으면 기록 실패가 fails 로 잡힌다
    const tryPart = block(loop, "try {", "} catch (e) {");
    expect(tryPart).toMatch(/customer-message-send/);
    expect(tryPart).not.toMatch(/status: "sent"/);
    expect(loop).toMatch(/continue;/);
    expect(loop).toMatch(/status: "sent"[\s\S]*\.catch\(\(\) => \{ logFails\.push/);
    expect(src).toMatch(/if \(logFails\.length\) notify\(/);
  });

  it("AutoSchedule — 일정 등록 때 메모 저장 실패 건수를 완료 문구에 붙인다", () => {
    const body = block(read("AutoSchedule.tsx"), "const register = async () => {", "\n  };");
    expect(body).toMatch(/\.catch\(\(\) => \{ memoFails \+= 1; \}\)/);
    expect(body).toMatch(/memoFails \? ` · ⚠ 메모 \$\{memoFails\}건 저장 실패/);
    expect(body).not.toMatch(/plan_memos[^\n]*\.catch\(\(\) => undefined\)/);
  });

  it("SystemAdmin — 시트 동기화 [다시 실행] 실패를 알린다", () => {
    const src = read("SystemAdmin.tsx");
    const line = src.split("\n").find((l) => l.includes("invokeEdgeFunction(\"field-sheet-sync\", { jobId: job.id })")) || "";
    expect(line).not.toBe("");
    expect(line).not.toMatch(/catch \{ \/\*/);
    expect(line).toMatch(/catch \(e\) \{ notify\(`다시 실행 실패/);
  });
});
