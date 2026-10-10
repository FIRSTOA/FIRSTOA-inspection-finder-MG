# -*- coding: utf-8 -*-
"""
Supabase 핵심 표 백업 — scripts/backup-tables.mjs(WSL+node)를 파이썬으로 옮긴 것. 노트북 작업 실행기가 매일 새벽 부른다.

왜: 처리이력·가이드·족보·점검·AS·접수·일정은 사람 손으로 쌓은 자산이고 시트에서 다시 만들 수 없다.
    2026-10-10 마감 목록 실수 삭제 때 돌아볼 사본이 없었다 — 기존 주간 백업(데스크톱 WSL)은 8/18 한 번만 성공하고 멈춰 있었다.
    그래서 ① 매일 ② 노트북에서 ③ 마감 목록·담당자 변경·방문기록·사진 색인까지 넓혀서 받는다.

출력: <백업폴더>/<YYYY-MM-DD>/<표>.jsonl.gz + manifest.json. 최근 KEEP 회차만 남긴다.
주의: 고객 정보가 들어 있다 — 저장소(git)에 올리지 말고 회사 기기에만 둔다.

사용: python backup_tables.py [--out 폴더] [--tables a,b,c]
"""
import argparse
import gzip
import json
import os
import shutil
import sys
import urllib.parse
from datetime import datetime

from config import RestError, backup_root, kst_now, log, rest

# 위쪽이 잃으면 복구 불가능한 것. 시트 미러(misu·overage…)는 매일 다시 만들어지지만 "그날 상태"를 남기는 값이 있어 포함.
TABLES = [
    "copier_notes", "knowledge_docs", "copier_playbook", "copier_learning_posts", "vendor_notes",
    "jeomgeom", "as_records", "service_receptions", "as_tickets", "visit_logs", "logistics_records",
    "contact_changes", "counter_sms_batches", "counter_sms_targets", "counter_sms_settings", "counter_sms_contact_rules",
    "vendor_info", "vendor_master", "vendor_match_alias", "lease_ident_code", "workin_map_places", "workin_vendor_code",
    "photo_albums", "photo_assets",
    "misu", "overage", "overage_adjust", "bulman", "recontract", "churn_defense", "mgmt_support", "lease_status",
    "pc_expansion", "mfp_expansion",
    "message_jobs", "message_templates", "happycall_messages", "report_recipients", "report_send_log", "promo_materials",
    "notices", "notice_reads", "dept_requests", "feedback_items", "reading_posts", "praise_posts",
    "okr_cycles", "okr_reports", "golden_cards", "weekly_notes", "quarterly_plans", "self_goals", "plan_memos",
    "team_calendar_events", "food_places", "stock_items", "activity_events", "field_sheet_sync_jobs",
    "cs_members", "app_config", "room_map", "push_subscriptions",
]
PAGE = 1000
KEEP = 14  # 매일 1회 기준 2주
# 비어 있는 게 정상인 표 — 0행이어도 실패로 보지 않는다
MAY_BE_EMPTY = {
    "dept_requests", "churn_defense", "mgmt_support", "notices", "notice_reads", "report_send_log", "report_recipients",
    "push_subscriptions", "copier_learning_posts", "team_calendar_events", "self_goals", "praise_posts", "feedback_items",
    "reading_posts", "promo_materials", "happycall_messages", "message_jobs", "overage_adjust", "logistics_records",
}
# PK 가 id 가 아닌 표 — 정렬 없이 offset 을 쓰면 페이지 사이 순서가 보장되지 않아 행이 빠지거나 겹친다
ORDER = {"push_subscriptions": "endpoint.asc", "app_config": "key.asc", "counter_sms_settings": "region.asc"}


def order_for(table: str, sample: dict | None) -> str:
    if table in ORDER:
        return ORDER[table]
    keys = list(sample.keys()) if sample else []
    for cand in ("id", "created_at", "key", "name"):
        if cand in keys:
            return f"{cand}.asc"
    return f"{keys[0]}.asc" if keys else "id.asc"


def dump_table(table: str, out_dir: str) -> dict:
    """표 하나를 jsonl.gz 로. 돌려주는 값은 manifest 항목."""
    path = os.path.join(out_dir, f"{table}.jsonl.gz")
    rows = 0
    try:
        sample = rest(f"/{table}?select=*&limit=1")
        order = order_for(table, sample[0] if sample else None)
        with gzip.open(path, "wt", encoding="utf-8") as f:
            offset = 0
            while True:
                page = rest(f"/{table}?select=*&order={urllib.parse.quote(order)}&limit={PAGE}&offset={offset}", timeout=120)
                if not isinstance(page, list):
                    raise RuntimeError("응답 형식 오류")
                for row in page:
                    f.write(json.dumps(row, ensure_ascii=False) + "\n")
                rows += len(page)
                if len(page) < PAGE:
                    break
                offset += PAGE
        if rows == 0 and table not in MAY_BE_EMPTY:
            raise RuntimeError("0행 — 권한/RLS 확인 필요")
        return {"rows": rows, "bytes": os.path.getsize(path), "order": order}
    except (RestError, RuntimeError, OSError) as e:
        return {"rows": rows, "error": str(e)[:160]}


def prune(root: str, keep: int) -> list:
    """날짜 폴더(YYYY-MM-DD)만 보고 오래된 회차 삭제. 지운 폴더 이름 목록을 돌려준다."""
    try:
        dirs = sorted(d for d in os.listdir(root) if len(d) == 10 and d[4] == "-" and os.path.isdir(os.path.join(root, d)))
    except OSError:
        return []
    gone = []
    for d in dirs[:-keep] if keep > 0 else []:
        shutil.rmtree(os.path.join(root, d), ignore_errors=True)
        gone.append(d)
    return gone


def run_backup(out_root: str | None = None, tables: list | None = None) -> dict:
    root = out_root or backup_root()
    stamp = kst_now().strftime("%Y-%m-%d")  # 폴더명은 KST — 새벽 작업이 전날 폴더에 들어가지 않게
    out_dir = os.path.join(root, stamp)
    os.makedirs(out_dir, exist_ok=True)
    manifest = {"at": datetime.now().astimezone().isoformat(timespec="seconds"), "host": os.environ.get("COMPUTERNAME", ""), "tables": {},
                "note": "고객정보 포함 — 외부 공유·git 커밋 금지"}
    log(f"백업 시작 → {out_dir}", "backup")
    for table in tables or TABLES:
        item = dump_table(table, out_dir)
        manifest["tables"][table] = item
        if "error" in item:
            log(f"  ✗ {table:<26} 실패: {item['error'][:70]}", "backup")
        else:
            log(f"  ✓ {table:<26} {item['rows']:>7,}행 {item['bytes'] / 1024:>7,.0f}KB", "backup")
    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    gone = prune(root, KEEP)
    total = sum(v.get("rows", 0) for v in manifest["tables"].values())
    failed = [k for k, v in manifest["tables"].items() if "error" in v]
    size = sum(v.get("bytes", 0) for v in manifest["tables"].values())
    summary = f"백업 완료 {stamp} · 표 {len(manifest['tables'])}개 · {total:,}행 · {size / 1024 / 1024:.1f}MB · 실패 {len(failed)}개{(' (' + ', '.join(failed) + ')') if failed else ''}{(' · 정리 ' + ', '.join(gone)) if gone else ''}"
    log(summary, "backup")
    manifest["summary"] = summary
    manifest["failed"] = failed
    manifest["dir"] = out_dir
    return manifest


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", help="백업 폴더(기본: OneDrive 바탕화면\\FIRSTOA-백업)")
    ap.add_argument("--tables", help="쉼표로 나열한 표 이름(기본: 전체)")
    args = ap.parse_args()
    m = run_backup(args.out, args.tables.split(",") if args.tables else None)
    sys.exit(1 if m["failed"] else 0)
