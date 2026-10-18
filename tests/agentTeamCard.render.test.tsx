// 홈 "AI 에이전트 팀" 카드가 실제로 렌더되는지(서버 렌더) — 브라우저 없이 깨짐을 잡는 최소 회귀 테스트
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import AgentTeamCard from "../src/AgentTeamCard";
import { AGENT_DEPTS, AGENT_LEADER } from "../src/agentTeam";

describe("AgentTeamCard render", () => {
  const html = renderToString(createElement(AgentTeamCard));

  it("팀장과 부서 7개 이름이 모두 나온다", () => {
    expect(html).toContain(AGENT_LEADER.emoji);
    for (const d of AGENT_DEPTS) expect(html).toContain(d.name);
  });

  it("기본으로 첫 부서(기획실) 역할이 펼쳐져 있다", () => {
    for (const r of AGENT_DEPTS[0].roles) {
      expect(html).toContain(r.name);
      expect(html).toContain(r.key);
    }
  });

  it("부서 단추는 button 이고 aria-expanded 를 가진다", () => {
    const buttons = html.match(/<button[^>]*aria-expanded=/g) || [];
    expect(buttons.length).toBeGreaterThanOrEqual(AGENT_DEPTS.length);
    expect(html).not.toMatch(/<button(?![^>]*type="button")/);
  });
});
