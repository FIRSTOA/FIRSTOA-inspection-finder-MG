/** 홈 "AI 에이전트 팀" 카드 데이터 ↔ .claude/agents/*.md 일치 검사. 역할을 늘리고 카드에 안 넣으면 여기서 막힌다. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_DEPTS } from "../src/agentTeam";

const dir = join(process.cwd(), ".claude", "agents");
const roles = AGENT_DEPTS.flatMap((d) => d.roles.map((r) => ({ ...r, dept: d.name })));

describe("agentTeam", () => {
  it("부서 7개, 부서 이름·역할 key 중복 없음", () => {
    expect(AGENT_DEPTS).toHaveLength(7);
    expect(new Set(AGENT_DEPTS.map((d) => d.name)).size).toBe(7);
    expect(new Set(roles.map((r) => r.key)).size).toBe(roles.length);
  });
  it("name/emoji/desc/trigger 가 비지 않음", () => {
    for (const r of roles) for (const v of [r.name, r.emoji, r.desc, r.trigger]) expect(v.trim(), r.key).not.toBe("");
  });
  it("역할 key ↔ .claude/agents/<key>.md 양방향 일치", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")).sort();
    expect(roles.map((r) => r.key).sort()).toEqual(files);
  });
  it("각 역할 파일에 `이름 · 부서 · 캐릭터` 줄이 카드와 같음", () => {
    for (const r of roles) {
      const text = readFileSync(join(dir, `${r.key}.md`), "utf8");
      expect(text, r.key).toContain(`이름 ${r.name} · 부서 ${r.dept} · 캐릭터 ${r.emoji}`);
    }
  });
});
