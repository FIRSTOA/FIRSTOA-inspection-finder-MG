/**
 * src/kpi/kpiDefs.ts(KPI 정의 — 무엇을 어떤 기준으로 세나) → supabase/functions/_shared/ask/kpi-defs.json
 * 통합검색 data-ask 의 kpi_explain 도구가 "OKR 달성률 어떻게 계산해?" 같은 질문에 이 글을 근거로 답한다(2026-10-29).
 * kpiDefs.ts 를 고치면 `node tools/build-ask-kpi-defs.mjs` 를 다시 돌리고 data-ask 를 배포한다(tests/askKpiDefs.test.ts 가 어긋남을 잡는다).
 * Node 22.18+ 는 .ts 를 바로 import 한다(kpiDefs.ts 는 import 없는 순수 파일).
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const out = "supabase/functions/_shared/ask/kpi-defs.json";
const mod = await import(pathToFileURL(path.resolve("src/kpi/kpiDefs.ts")).href);
const defs = mod.KPI_DEFS.map((d) => ({
  id: d.id, name: d.name, unit: d.unit, group: d.group, period: d.period, periods: d.periods, scopes: d.scopes,
  basis: d.basis, source: d.source, status: d.status, targetBasis: d.targetBasis, target: d.target, better: d.better, teams: d.teams,
  screen: d.screen,
}));
const json = { built: "tools/build-ask-kpi-defs.mjs", defs, pending: mod.KPI_NOT_BUILT, recontractOverdue: mod.RECONTRACT_OVERDUE_DEFINITION };
fs.writeFileSync(out, JSON.stringify(json, null, 1) + "\n", "utf8");
console.log(`→ ${out} (${defs.length}개 지표 + 미정 ${mod.KPI_NOT_BUILT.length}, ${fs.statSync(out).size.toLocaleString()} bytes)`);
