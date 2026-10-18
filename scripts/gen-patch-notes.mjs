/**
 * 패치노트 자동 생성 — 빌드(prebuild)마다 git 커밋 기록을 src/patchNotes.ts로 굽는다.
 * 홈 탭의 패치노트 섹션이 이 파일을 읽는다. 별도 관리 없이 "배포 = 패치노트 갱신".
 *
 * 같은 git 기록에서 직원별 "한 일"(src/agentWorkLog.ts)도 함께 굽는다: 커밋 제목·본문에 역할 이름이나 key가 있으면 그 직원의 항목.
 *
 * 얕은 클론(CI)에서 git 기록이 짧게 나와도 기존 파일과 해시 기준으로 합치므로 목록이 줄지 않는다.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../src/patchNotes.ts", import.meta.url);
// 내부 수리·되돌림 등 팀원에게 의미 없는 항목은 패치노트에서 제외
const SKIP = /^(빌드 수리|Merge|Revert|\[upgrade\])/;

function parseExisting() {
  if (!existsSync(FILE)) return [];
  try {
    const src = readFileSync(FILE, "utf8");
    const match = src.match(/=\s*(\[[\s\S]*\]);/);
    return match ? JSON.parse(match[1]) : [];
  } catch {
    return [];
  }
}

let fresh = [];
try {
  const out = execSync('git log -300 --pretty=format:"%H%x09%ad%x09%s" --date=format:%Y-%m-%d', { encoding: "utf8" });
  fresh = out.split("\n").filter(Boolean).map((line) => {
    const [hash, date, ...rest] = line.split("\t");
    return { hash: String(hash).slice(0, 10), date, note: rest.join("\t").trim() };
  });
} catch {
  // git이 없거나 기록이 없으면 기존 파일 유지
}

const seen = new Map();
for (const entry of [...fresh, ...parseExisting()]) {
  if (entry && entry.hash && entry.date && !seen.has(entry.hash)) seen.set(entry.hash, entry);
}
const merged = [...seen.values()]
  .filter((entry) => entry.note && !SKIP.test(entry.note))
  .sort((a, b) => b.date.localeCompare(a.date))
  .slice(0, 250);

writeFileSync(FILE, `// 자동 생성 파일 — scripts/gen-patch-notes.mjs가 빌드 때 git 기록에서 갱신한다. 직접 수정 금지.
export type PatchNote = { hash: string; date: string; note: string };
export const PATCH_NOTES: PatchNote[] = ${JSON.stringify(merged, null, 2)};
`);
console.log(`patch notes: ${merged.length}건`);

// ── 직원별 한 일 → src/agentWorkLog.ts ─────────────────────────────────────────
// src/agentTeam.ts 는 .ts 라 import 못 하므로 표를 여기에도 둔다(역할이 바뀌면 같이 고칠 것).
const AGENTS = [
  ["feature-planner", "한설계"], ["ui-designer", "윤화면"], ["db-schema", "표다빈"], ["developer", "구현서"],
  ["debugger", "오류진"], ["qa-checker", "검수아"], ["field-deploy-check", "배포준"], ["sql-review", "권한나"],
  ["kakao-pc-rules", "방지훈"], ["ops-monitor", "감시연"],
];
// 명단을 나열만 한 커밋(10명 전원이 오탐으로 잡힘) — 생성·병합 양쪽에서 제외
const EXCLUDE_HASHES = ["02b95328ed", "bf540382d8"];
const WORK_FILE = new URL("../src/agentWorkLog.ts", import.meta.url);

function parseExistingWork() {
  if (!existsSync(WORK_FILE)) return [];
  try {
    const m = readFileSync(WORK_FILE, "utf8").match(/AGENT_WORK_LOG:[^=]*=\s*(\[[\s\S]*\]);/);
    return m ? JSON.parse(m[1]) : [];
  } catch {
    return [];
  }
}

let freshWork = [];
try {
  const out = execSync('git log -300 --pretty=format:"%H%x09%ad%x09%s%x09%b%x1e" --date=format:%Y-%m-%d', { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  for (const rec of out.split("\x1e")) {
    const [hash, date, subject = "", ...bodyParts] = rec.replace(/^\s+/, "").split("\t");
    if (!hash || !date) continue;
    const summary = subject.trim();
    if (!summary || SKIP.test(summary)) continue;
    if (EXCLUDE_HASHES.includes(hash.slice(0, 10))) continue;
    const lines = bodyParts.join("\t").split("\n").filter((l) => !/^co-authored-by:/i.test(l.trim()));
    // "투입: 이름, 이름" 줄이 있으면 그 줄만 본다. 없으면 제목+본문 전체(과거 커밋 호환)
    const crew = lines.filter((l) => /^\s*투입\s*[:：]/.test(l));
    const text = crew.length ? crew.join("\n") : `${summary}\n${lines.join("\n")}`;
    for (const [agent, name] of AGENTS) {
      if (text.includes(agent) || text.includes(name)) freshWork.push({ date, hash: hash.slice(0, 10), agent, summary });
    }
  }
} catch {
  // git이 없으면 기존 파일 유지
}

const workSeen = new Map();
for (const e of [...freshWork, ...parseExistingWork()]) {
  if (e && e.hash && e.date && e.agent && !EXCLUDE_HASHES.includes(e.hash) && !workSeen.has(`${e.hash}:${e.agent}`)) workSeen.set(`${e.hash}:${e.agent}`, e);
}
const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
const work = [...workSeen.values()]
  .filter((e) => e.date >= cutoff)
  .sort((a, b) => b.date.localeCompare(a.date))
  .slice(0, 400);

writeFileSync(WORK_FILE, `// 자동 생성 파일 — scripts/gen-patch-notes.mjs 가 빌드 때 git 기록에서 갱신한다. 직접 수정 금지.
// 커밋 제목·본문에 역할 이름(한설계·구현서…)이나 역할 key(feature-planner…)가 적혀 있으면 그 직원의 "한 일"로 잡는다.
export type AgentWorkItem = { date: string; hash: string; agent: string; summary: string };
export const AGENT_WORK_LOG: AgentWorkItem[] = ${JSON.stringify(work, null, 2)};
`);
console.log(`agent work log: ${work.length}건`);
