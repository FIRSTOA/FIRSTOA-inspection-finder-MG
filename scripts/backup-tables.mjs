/**
 * Supabase 핵심 테이블 백업 — 재생성 불가능한 자산을 로컬 파일로 뽑는다.
 *
 * 왜: 12,580건 처리이력·450건 가이드·족보·특이사항은 사람 손으로 쌓은 자산이고, 시트에서 다시 만들 수 없다.
 * Supabase 자동 백업은 프로젝트 사고(삭제·권한 사고)까지 막아주지 않으므로 내려받은 사본을 따로 둔다.
 *
 * 사용: node scripts/backup-tables.mjs [출력폴더]
 *   기본 출력: /mnt/c/Users/MYCOM/OneDrive/Desktop/FIRSTOA-백업/<YYYY-MM-DD>/
 *   각 테이블을 JSON Lines(.jsonl)로 저장하고 manifest.json에 행수·바이트를 기록한다.
 *
 * 주의: 고객 정보·출입 비번(vendor_notes)이 포함된다 — 저장소(git)에 커밋하지 말고 회사 PC에만 둘 것.
 *       .gitignore에 백업 폴더가 없더라도 출력 기본값이 repo 밖(바탕화면)이라 커밋될 일은 없다.
 */
import { createWriteStream, mkdirSync, readFileSync, statSync } from "fs";
import path from "path";

// 우선순위 순 — 위쪽이 잃으면 복구 불가능한 것
const TABLES = [
  "copier_notes",        // 복합기 처리이력 12.5k (팀이 직접 쓴 사례)
  "knowledge_docs",      // 가이드 450 (노션 1년반 + 사진 링크)
  "copier_playbook",     // 족보 카드
  "vendor_notes",        // 거래처 특이사항
  "as_records", "jeomgeom", "service_receptions", "as_tickets",
  "notices", "dept_requests", "vendor_info", "workin_map_places",
  "misu", "overage", "bulman", "recontract", "churn_defense", "mgmt_support",
  "cs_members", "app_config", "room_map", "message_templates",
  "report_recipients", "report_send_log", "push_subscriptions",
];
const PAGE = 1000;

const outRoot = process.argv[2] || "/mnt/c/Users/MYCOM/OneDrive/Desktop/FIRSTOA-백업";
// 폴더명은 KST 기준 — UTC로 찍으면 밤 작업이 전날 폴더에 들어간다
const stamp = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const outDir = path.join(outRoot, stamp);
mkdirSync(outDir, { recursive: true });

const supa = readFileSync(new URL("../src/supabase.ts", import.meta.url), "utf8");
const URL_BASE = supa.match(/https:\/\/[a-z]+\.supabase\.co/)[0];
const ANON = supa.slice(supa.indexOf("SUPABASE_ANON")).match(/"([^"]{60,})"/)[1];
const H = { apikey: ANON, Authorization: `Bearer ${ANON}` };

const manifest = { at: new Date().toISOString(), project: URL_BASE, tables: {}, note: "고객정보 포함 — 외부 공유·git 커밋 금지" };
for (const table of TABLES) {
  const file = path.join(outDir, `${table}.jsonl`);
  const stream = createWriteStream(file, { encoding: "utf8" });
  let rows = 0;
  try {
    for (let from = 0; ; from += PAGE) {
      const res = await fetch(`${URL_BASE}/rest/v1/${table}?select=*&limit=${PAGE}&offset=${from}`, { headers: H });
      if (!res.ok) throw new Error(`${res.status}`);
      const page = await res.json();
      if (!Array.isArray(page)) throw new Error("응답 형식 오류");
      for (const row of page) stream.write(`${JSON.stringify(row)}\n`);
      rows += page.length;
      if (page.length < PAGE) break;
    }
    await new Promise((r) => stream.end(r));
    const bytes = statSync(file).size;
    manifest.tables[table] = { rows, bytes };
    console.log(`✓ ${table.padEnd(22)} ${String(rows).padStart(6)}행 ${(bytes / 1024).toFixed(0)}KB`);
  } catch (e) {
    await new Promise((r) => stream.end(r));
    manifest.tables[table] = { rows, error: String(e.message || e).slice(0, 120) };
    console.log(`✗ ${table.padEnd(22)} 실패: ${String(e.message || e).slice(0, 60)}`);
  }
}
const { writeFileSync } = await import("fs");
writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
const total = Object.values(manifest.tables).reduce((s, t) => s + (t.rows || 0), 0);
console.log(`\n백업 완료 → ${outDir}\n총 ${total.toLocaleString()}행 · 테이블 ${Object.keys(manifest.tables).length}개`);
console.log("복구는 manifest.json 확인 후 jsonl을 REST/psql로 되넣는다 (스키마는 supabase/*.sql이 원본)");
