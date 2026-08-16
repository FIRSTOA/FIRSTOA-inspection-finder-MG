/**
 * 패치노트 자동 생성 — 빌드(prebuild)마다 git 커밋 기록을 src/patchNotes.ts로 굽는다.
 * 홈 탭의 패치노트 섹션이 이 파일을 읽는다. 별도 관리 없이 "배포 = 패치노트 갱신".
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
