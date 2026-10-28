# -*- coding: utf-8 -*-
"""
FIRSTOA 작업 실행기 — 노트북(사무실 상시 PC)에서 24시간 도는 프로그램 (2026-10-10)

역할 분담: 업무폰(메신저봇R) = 카톡 읽기·쓰기 / Supabase 크론·엣지 함수 = 자동 작업의 심장 /
          이 실행기 = 사무실 기계가 있어야 하는 일 + 밤에 몰아서 하는 처리.

하는 일 (1분에 한 바퀴)
  ① 심박: worker_heartbeat 에 "살아 있음"을 적는다. 15분 끊기면 DB 파수꾼(worker-watchdog 크론)이 담당자에게 웹푸시.
  ② 일감: worker_jobs 에서 queued 를 하나씩 잡아(claim) 처리한다 — ping · backup · relay · poster. (음성·OCR 은 자리만 있다)
  ③ 시계: 매일 02:30 KST 전체 표 백업, 5분마다 카톡 PC 발송 중계(봇이 못 보낸 outbox), 월요일 10시 키맨 포스터,
          (스위치 FIRSTOA_KAKAO_EXPORT=1 일 때만) 매일 04:30~06:50 카톡 PC 대화 내용 저장 → 드라이브 수신함.
          카톡 저장은 별도 프로세스(비차단, 최대 약 120분)라 그동안도 심박은 1분마다 찍히고, 중계·포스터·카톡 사진 일감은 끝날 때까지 쉰다.

설치·운영은 README.md. 수동 확인: python worker.py --once (한 바퀴) · python worker.py --job ping · python worker.py --backup
"""
import argparse
import ctypes
import os
import subprocess
import sys
import time
import traceback
import urllib.parse
from datetime import timedelta

from config import HOST, KAKAO_PC_DIR, LOG_DIR, RestError, kst_now, load_state, log, rest, save_state

VERSION = "2026-10-27a"
WORKER_NAME = os.environ.get("FIRSTOA_WORKER_NAME", f"worker@{HOST}")
LOOP_SECONDS = 60
BACKUP_AT = (2, 30)            # KST 02:30 이후 그날 첫 바퀴에
RELAY_EVERY = 60               # 초 — 봇이 2분 넘게 못 가져간 outbox 를 카톡 PC 가 대신 보낸다(outbox_relay.py 규칙 · 2026-10-17 300→60)
POSTER_HOUR = 10               # 월요일 10시대 (2026-10-21 사용자: 8시 → 10시, 출근 전 카톡 금지 규칙)
RELAY_ENABLED = os.environ.get("FIRSTOA_RELAY", "1") != "0"
POSTER_ENABLED = os.environ.get("FIRSTOA_POSTER", "1") != "0"
KAKAO_EXPORT_AT = (4, 30)      # KST 04:30~06:50 사이 하루 1회(2026-10-28 실측 한 방 3분+ → 21방 최대 120분이라 04:30 시작, 옛 05:30) — GAS 수집 트리거(07시 이후·1시간마다)보다 먼저 파일이 도착해야 하루 늦게 적재되지 않는다(2026-10-24, 옛 06:30~08:00)
KAKAO_EXPORT_UNTIL = (6, 50)   # 06:50 이 넘으면 그날은 건너뜀(실행기가 늦게 켜져도 근무 중엔 누르지 않는다). 방 목록은 export_rooms.py 가 kakao_collect_rooms(export=true)에서 읽음
KAKAO_EXPORT_ENABLED = os.environ.get("FIRSTOA_KAKAO_EXPORT", "0") == "1"  # 기본 꺼짐 — export_rooms.py --probe 로 Ctrl+S 확인 뒤에만 켠다(2026-10-23)

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
    out = (payload.get("out") or "").strip() or None
    if out and not os.path.isabs(out):
        # 폴더 이름만 적으면(예: archive-20261024) 평소 백업 루트(구글 드라이브\FIRSTOA-백업) 아래 그 이름 — SQL 쪽에서 노트북 경로를 몰라도 된다
        from config import backup_root
        out = os.path.join(backup_root(), out)
    m = run_backup(out, tables.split(",") if isinstance(tables, str) else tables)
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


# 카톡 저장은 방마다 불러오기·저장 확인을 천천히 하느라 수십 분 걸린다(2026-10-27 사용자 실측 반영) — 실행기 루프를 막으면 심박 파수꾼(15분)이
# "실행기 멈춤"을 보내므로 별도 프로세스로 띄우고(비차단) 바퀴마다 끝났는지만 본다. export_rooms.py 자체 상한 60분 + 진행 중 방 마무리.
KAKAO_EXPORT_KILL_AFTER = 135 * 60  # 초 — 이만큼 넘게 안 끝나면 멈춘 것으로 보고 종료(export_rooms RUN_LIMIT 120분 + 진행 중 방 마무리)
KAKAO_EXPORT_MUTEX = "Local\\FIRSTOA-KakaoExport"  # export_rooms.py EXPORT_MUTEX 와 같은 이름(실행기 재시작·손으로 돌린 것도 감지)
_kakao_export = {"proc": None, "started": 0.0, "log": ""}


def kakao_export_running() -> bool:
    """카톡 저장이 돌고 있나 — 이 실행기가 띄운 프로세스 또는 (재시작 전에 띄웠거나 손으로 돌린) 같은 이름 뮤텍스"""
    p = _kakao_export["proc"]
    if p is not None and p.poll() is None:
        return True
    try:
        h = ctypes.windll.kernel32.OpenMutexW(0x00100000, False, KAKAO_EXPORT_MUTEX)  # SYNCHRONIZE
        if h:
            ctypes.windll.kernel32.CloseHandle(h)
            return True
    except Exception:
        pass
    return False


def job_kakao_export(payload: dict) -> str:
    """카톡 PC 대화 내용 저장 → 구글 드라이브 '카톡 자동적재 수신함' (tools/kakao-pc/export_rooms.py --export). 창이 열린 방만.
    시작만 하고 바로 돌아온다 — 결과는 poll_kakao_export 가 state['kakao_export_last'] 에 적는다"""
    if kakao_export_running():
        return "건너뜀: 이미 실행 중"
    os.makedirs(LOG_DIR, exist_ok=True)
    out_path = os.path.join(LOG_DIR, f"kakao-export-{kst_now():%Y-%m-%d}.txt")
    args = [sys.executable, os.path.join(KAKAO_PC_DIR, "export_rooms.py"), "--export"]  # --category 없음: 대상은 표(export=true)가 정한다
    with open(out_path, "a", encoding="utf-8") as out:  # 파이프 대신 파일 — 읽는 쪽이 없어도 버퍼가 차서 멈추지 않는다
        proc = subprocess.Popen(args, cwd=KAKAO_PC_DIR, stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT)
    _kakao_export.update(proc=proc, started=time.time(), log=out_path)
    log(f"카톡 저장 시작 (pid {proc.pid}, 출력 {out_path})")
    return f"실행 중 (pid {proc.pid}, {kst_now():%H:%M} 시작)"


def poll_kakao_export(state: dict) -> None:
    """바퀴마다 — 끝났으면 출력 끝 4줄을 state 에 적고, 너무 오래면 종료"""
    p = _kakao_export["proc"]
    if p is None:
        return
    rc = p.poll()
    took = time.time() - _kakao_export["started"]
    if rc is None:
        if took < KAKAO_EXPORT_KILL_AFTER:
            return
        p.terminate()
        try:
            rc = p.wait(30)
        except subprocess.TimeoutExpired:
            p.kill()
            rc = -1
        log(f"카톡 저장 {KAKAO_EXPORT_KILL_AFTER // 60}분 넘어 종료")
    try:
        with open(_kakao_export["log"], encoding="utf-8", errors="replace") as f:
            tail = f.read().strip().splitlines()[-4:]
    except OSError:
        tail = []
    state["kakao_export_last"] = f"exit {rc} · {int(took // 60)}분 · " + " / ".join(tail)
    log(f"카톡 저장 끝 — {state['kakao_export_last'][:160]}")
    _kakao_export["proc"] = None


def job_kakao_photo(payload: dict) -> str:
    """마감 카운터 사진 — 카톡 PC의 그 방 창에 글(업체·기기·주소)+사진을 붙여 보낸다. 창이 없으면 봇이 글+링크로(유실 없음)."""
    import urllib.request
    room = str(payload.get("room") or "").strip(); url = str(payload.get("image_url") or ""); caption = str(payload.get("caption") or "")
    if not room or not url:
        raise RuntimeError("room·image_url 이 필요합니다")
    try:
        import poster_send  # pywin32·pillow·pyautogui
    except ImportError as e:
        raise RuntimeError(f"카톡 PC 모듈 없음: {e} (pip install pywin32 pillow pyautogui)")
    data = urllib.request.urlopen(url, timeout=60).read()
    if poster_send.send_to_room(room, caption, data):
        return f"카톡 PC로 글+사진 전송 → {room}"
    rest("/outbox", "POST", {"room": room, "text": caption + "\n사진: " + url}, prefer="return=minimal")
    return f"카톡 PC 창 없음 → 봇으로 글+링크 전송 ({room})"


def job_todo(payload: dict) -> str:
    raise RuntimeError("아직 만들지 않은 종류 — 2027 계획 P6(음성)·P9(OCR)")


HANDLERS = {"ping": job_ping, "backup": job_backup, "relay": job_relay, "poster": job_poster, "kakao_photo": job_kakao_photo, "whisper": job_todo, "ocr": job_todo}


def claim_and_run_jobs() -> int:
    """queued 일감을 잡아 처리. 잡기는 status=queued 조건부 PATCH 라 두 실행기가 겹쳐도 한쪽만 가져간다."""
    now_dt = kst_now()
    now = now_dt.isoformat()
    q = lambda v: urllib.parse.quote(v, safe="")  # "+09:00" 의 + 가 쿼리스트링에서 공백이 돼 400 이 나던 것(2026-10-10 점검) — 반드시 인코딩
    # 10분 넘게 running 인 일감 = 이전 실행이 정전·재시작으로 죽은 것. 한 번은 다시 줄 세우고, 또 멈추면 failed 로 끝낸다
    stale = q((now_dt - timedelta(minutes=10)).isoformat())
    try:
        rest(f"/worker_jobs?status=eq.running&claimed_at=lt.{stale}&error=is.null", "PATCH",
             {"status": "queued", "claimed_at": None, "claimed_by": None, "error": "재시도: 이전 실행이 중단됨"}, prefer="return=minimal")
        rest(f"/worker_jobs?status=eq.running&claimed_at=lt.{stale}&error=not.is.null", "PATCH",
             {"status": "failed", "finished_at": now, "error": "두 번 중단됨 — 실행기 로그 확인"}, prefer="return=minimal")
    except RestError as e:
        log(f"멈춘 일감 정리 실패 — {e}")
    jobs = rest(f"/worker_jobs?select=id,kind,payload&status=eq.queued&run_at=lte.{q(now)}&order=run_at.asc&limit=5") or []
    done = 0
    for job in jobs:
        if job.get("kind") in ("relay", "poster", "kakao_photo") and kakao_export_running():
            continue  # 카톡 저장 중 — 카톡 PC 일감은 줄에 둔 채 다음 바퀴로(저장 중인 방 창을 뺏지 않게)
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
            if kind == "kakao_photo":  # 앱은 이미 카드를 완료로 표시했다 — 사진이 안 가면 안 되니 봇 글+링크로 폴백(유실 없음)
                p = job.get("payload") or {}
                try:
                    rest("/outbox", "POST", {"room": str(p.get("room") or ""), "text": f"{p.get('caption') or ''}\n사진: {p.get('image_url') or ''}"}, prefer="return=minimal")
                    log(f"일감 #{job['id']} 봇 글+링크로 폴백")
                except Exception as e2:
                    log(f"일감 #{job['id']} 폴백도 실패 — {e2}")
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
    poll_kakao_export(state)
    exporting = kakao_export_running()  # 카톡 저장 중엔 다른 카톡 PC 작업(중계·포스터)이 창을 앞으로 끌어오지 않게 쉰다 — 한 번에 한 방
    if RELAY_ENABLED and not exporting and time.time() - state.get("relay_at", 0) >= RELAY_EVERY:
        state["relay_at"] = time.time()
        try:
            job_relay({})
        except Exception as e:
            log(f"중계 오류 — {e}")
        ran.append("relay")
    week = now.strftime("%G-W%V")
    if POSTER_ENABLED and not exporting and now.weekday() == 0 and now.hour == POSTER_HOUR and state.get("poster_week") != week:
        state["poster_week"] = week
        try:
            state["poster_last"] = job_poster({})
        except Exception as e:
            state["poster_last"] = f"실패: {e}"
            log(f"포스터 실패 — {e}")
        ran.append("poster")
    if (KAKAO_EXPORT_ENABLED and (now.hour, now.minute) >= KAKAO_EXPORT_AT and (now.hour, now.minute) < KAKAO_EXPORT_UNTIL
            and state.get("kakao_export_date") != today):
        state["kakao_export_date"] = today  # 실패해도 그날은 다시 안 한다
        try:
            state["kakao_export_last"] = job_kakao_export({})
        except Exception as e:
            state["kakao_export_last"] = f"실패: {e}"
            log(f"카톡 저장 실패 — {e}")
        ran.append("kakao_export")
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
            log(f"일감 조회 실패 — {e}")  # 심박은 그래도 찍는다 — 일감 오류가 "실행기 죽음" 알림으로 번지지 않게
    except Exception as e:
        log(f"일감 처리 오류 — {e}")
    note = f"backup {state.get('backup_date', '-')} · {str(state.get('backup_last', ''))[:80]}"
    if kakao_export_running():
        note = "카톡 저장 중 · " + note
    try:
        heartbeat(note)
    except RestError as e:
        if e.status not in (404, 401, 403):
            log(f"심박 실패 — {e}")
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
    log(f"실행기 시작 {WORKER_NAME} v{VERSION} (중계 {'켬' if RELAY_ENABLED else '끔'} · 포스터 {'켬' if POSTER_ENABLED else '끔'} · 카톡 저장 {'켬' if KAKAO_EXPORT_ENABLED else '끔'})")
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
