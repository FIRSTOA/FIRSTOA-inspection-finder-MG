# -*- coding: utf-8 -*-
"""
FIRSTOA 작업 실행기 — 노트북(사무실 상시 PC)에서 24시간 도는 프로그램 (2026-10-10)

역할 분담: 업무폰(메신저봇R) = 카톡 읽기·쓰기 / Supabase 크론·엣지 함수 = 자동 작업의 심장 /
          이 실행기 = 사무실 기계가 있어야 하는 일 + 밤에 몰아서 하는 처리.

하는 일 (1분에 한 바퀴)
  ① 심박: worker_heartbeat 에 "살아 있음"을 적는다. 15분 끊기면 DB 파수꾼(worker-watchdog 크론)이 담당자에게 웹푸시.
  ② 일감: worker_jobs 에서 queued 를 하나씩 잡아(claim) 처리한다 — ping · backup · relay · poster. (음성·OCR 은 자리만 있다)
  ③ 시계: 매일 02:30 KST 전체 표 백업, 5분마다 카톡 PC 발송 중계(봇이 못 보낸 outbox), 월요일 08시 키맨 포스터.

설치·운영은 README.md. 수동 확인: python worker.py --once (한 바퀴) · python worker.py --job ping · python worker.py --backup
"""
import argparse
import ctypes
import os
import subprocess
import sys
import time
import traceback
from datetime import timedelta

from config import HOST, KAKAO_PC_DIR, LOG_DIR, RestError, kst_now, load_state, log, rest, save_state

VERSION = "2026-10-10a"
WORKER_NAME = os.environ.get("FIRSTOA_WORKER_NAME", f"worker@{HOST}")
LOOP_SECONDS = 60
BACKUP_AT = (2, 30)            # KST 02:30 이후 그날 첫 바퀴에
RELAY_EVERY = 300              # 초 — 봇이 3분 넘게 못 가져간 outbox 를 카톡 PC 가 대신 보낸다(outbox_relay.py 규칙)
POSTER_HOUR = 8                # 월요일 08시대
RELAY_ENABLED = os.environ.get("FIRSTOA_RELAY", "1") != "0"
POSTER_ENABLED = os.environ.get("FIRSTOA_POSTER", "1") != "0"

sys.path.insert(0, KAKAO_PC_DIR)  # poster_send / outbox_relay 재사용


# ── 심박 ───────────────────────────────────────────────────
def heartbeat(note: str = "") -> None:
    rest("/worker_heartbeat?on_conflict=name", "POST",
         {"name": WORKER_NAME, "host": HOST, "version": VERSION, "note": note[:200], "last_seen": kst_now().isoformat()},
         prefer="resolution=merge-duplicates,return=minimal")


# ── 일감 처리기 ─────────────────────────────────────────────
def job_ping(payload: dict) -> str:
    return f"pong from {WORKER_NAME} {kst_now():%Y-%m-%d %H:%M:%S} ({payload.get('note', '')})".strip()


def job_backup(payload: dict) -> str:
    from backup_tables import run_backup
    tables = payload.get("tables")
    m = run_backup(payload.get("out"), tables.split(",") if isinstance(tables, str) else tables)
    return m["summary"]


def job_relay(payload: dict) -> str:
    """봇이 못 보낸 outbox 를 카톡 PC 창에 붙여 넣어 대신 보낸다 (tools/kakao-pc/outbox_relay.py)"""
    try:
        import outbox_relay  # pywin32·pillow 필요 — 없으면 ImportError
    except ImportError as e:
        return f"중계 불가: {e} (pip install pywin32 pillow pyautogui)"
    outbox_relay.main()
    return "중계 점검 완료 (내용은 tools/kakao-pc/poster_log.txt)"


def job_poster(payload: dict) -> str:
    """월요 키맨 포스터 — poster_send.py --weekly 를 그대로 부른다(카톡 PC 방 창에 사진 붙여넣기)"""
    args = [sys.executable, os.path.join(KAKAO_PC_DIR, "poster_send.py"), "--weekly"] + (["--plan"] if payload.get("plan") else [])
    run = subprocess.run(args, cwd=KAKAO_PC_DIR, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1200)
    tail = (run.stdout or "").strip().splitlines()[-6:]
    return f"exit {run.returncode} · " + " / ".join(tail)


def job_todo(payload: dict) -> str:
    raise RuntimeError("아직 만들지 않은 종류 — 2027 계획 P6(음성)·P9(OCR)")


HANDLERS = {"ping": job_ping, "backup": job_backup, "relay": job_relay, "poster": job_poster, "whisper": job_todo, "ocr": job_todo}


def claim_and_run_jobs() -> int:
    """queued 일감을 잡아 처리. 잡기는 status=queued 조건부 PATCH 라 두 실행기가 겹쳐도 한쪽만 가져간다."""
    now = kst_now().isoformat()
    jobs = rest(f"/worker_jobs?select=id,kind,payload&status=eq.queued&run_at=lte.{now}&order=run_at.asc&limit=5") or []
    done = 0
    for job in jobs:
        got = rest(f"/worker_jobs?id=eq.{job['id']}&status=eq.queued", "PATCH",
                   {"status": "running", "claimed_at": now, "claimed_by": WORKER_NAME}, prefer="return=representation")
        if not got:
            continue  # 다른 실행기가 먼저 잡음
        kind = job.get("kind", "")
        handler = HANDLERS.get(kind)
        log(f"일감 #{job['id']} {kind} 시작")
        try:
            if not handler:
                raise RuntimeError(f"모르는 종류: {kind}")
            result = handler(job.get("payload") or {})
            rest(f"/worker_jobs?id=eq.{job['id']}", "PATCH", {"status": "done", "finished_at": kst_now().isoformat(), "result": str(result)[:2000]}, prefer="return=minimal")
            log(f"일감 #{job['id']} {kind} 완료 — {str(result)[:120]}")
        except Exception as e:  # 한 일감의 실패가 실행기를 세우면 안 된다
            rest(f"/worker_jobs?id=eq.{job['id']}", "PATCH", {"status": "failed", "finished_at": kst_now().isoformat(), "error": str(e)[:1000]}, prefer="return=minimal")
            log(f"일감 #{job['id']} {kind} 실패 — {e}")
        done += 1
    return done


# ── 시계(정해진 때 하는 일) ──────────────────────────────────
def scheduled(state: dict) -> list:
    """돌린 일 이름 목록. state 는 호출부가 저장한다."""
    ran = []
    now = kst_now()
    today = now.strftime("%Y-%m-%d")
    if (now.hour, now.minute) >= BACKUP_AT and state.get("backup_date") != today:
        state["backup_date"] = today  # 실패해도 그날은 다시 안 한다(다음 날 새벽에) — 실패는 로그·심박 note 에 남는다
        try:
            state["backup_last"] = job_backup({})
        except Exception as e:
            state["backup_last"] = f"실패: {e}"
            log(f"백업 실패 — {e}")
        ran.append("backup")
    if RELAY_ENABLED and time.time() - state.get("relay_at", 0) >= RELAY_EVERY:
        state["relay_at"] = time.time()
        try:
            job_relay({})
        except Exception as e:
            log(f"중계 오류 — {e}")
        ran.append("relay")
    week = now.strftime("%G-W%V")
    if POSTER_ENABLED and now.weekday() == 0 and now.hour == POSTER_HOUR and state.get("poster_week") != week:
        state["poster_week"] = week
        try:
            state["poster_last"] = job_poster({})
        except Exception as e:
            state["poster_last"] = f"실패: {e}"
            log(f"포스터 실패 — {e}")
        ran.append("poster")
    return ran


def prune_logs(days: int = 30) -> None:
    try:
        for name in os.listdir(LOG_DIR):
            p = os.path.join(LOG_DIR, name)
            if name.endswith(".txt") and time.time() - os.path.getmtime(p) > days * 86400:
                os.remove(p)
    except OSError:
        pass


def single_instance() -> bool:
    """같은 PC 에서 두 개가 돌지 않게 — 이름 있는 뮤텍스"""
    ctypes.windll.kernel32.CreateMutexW(None, False, "Local\\FIRSTOA-Worker")
    return ctypes.windll.kernel32.GetLastError() != 183  # ERROR_ALREADY_EXISTS


def cycle(state: dict) -> None:
    ran = scheduled(state)
    n = 0
    try:
        n = claim_and_run_jobs()
    except RestError as e:
        if e.status in (404, 401, 403):
            log("worker_jobs 표가 없거나 권한이 없음 — supabase/worker-heartbeat.sql 을 실행해야 일감·심박이 동작합니다")
        else:
            raise
    note = f"backup {state.get('backup_date', '-')} · {str(state.get('backup_last', ''))[:80]}"
    try:
        heartbeat(note)
    except RestError as e:
        if e.status not in (404, 401, 403):
            raise
    if ran or n:
        save_state(state)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="한 바퀴만 돌고 끝")
    ap.add_argument("--job", help="일감 하나를 바로 실행(ping·backup·relay·poster)")
    ap.add_argument("--backup", action="store_true", help="지금 전체 백업")
    args = ap.parse_args()
    if args.backup:
        print(job_backup({}))
        return 0
    if args.job:
        print(HANDLERS[args.job]({}))
        return 0
    if not single_instance():
        log("이미 실행 중 — 종료")
        return 0
    log(f"실행기 시작 {WORKER_NAME} v{VERSION} (중계 {'켬' if RELAY_ENABLED else '끔'} · 포스터 {'켬' if POSTER_ENABLED else '끔'})")
    state = load_state()
    while True:
        try:
            cycle(state)
            save_state(state)
        except Exception:
            log("바퀴 오류\n" + traceback.format_exc()[-600:])
        if args.once:
            return 0
        prune_logs()
        time.sleep(LOOP_SECONDS)


if __name__ == "__main__":
    sys.exit(main())
