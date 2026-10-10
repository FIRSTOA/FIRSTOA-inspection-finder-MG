# -*- coding: utf-8 -*-
"""
노트북 작업 실행기 공통 설정 — Supabase 주소·anon 키·REST 도우미·로그.

anon 키는 웹앱 번들에 그대로 들어 있는 공개 키라 여기 둬도 된다(poster_send.py 와 같은 방식).
service_role 키는 절대 이 폴더에 두지 않는다 — 필요해지면 윈도우 자격 증명 관리자에 넣고 환경 변수로만 읽는다.
"""
import json
import os
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

SUPABASE_URL = os.environ.get("FIRSTOA_SUPABASE_URL", "https://kkdiihazgzesbqxjytqv.supabase.co")
SUPABASE_ANON = os.environ.get(
    "FIRSTOA_SUPABASE_ANON",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrZGlpaGF6Z3plc2JxeGp5dHF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNjE0NjcsImV4cCI6MjEwMDczNzQ2N30."
    "fjKIbDpj0QhNgc7Qr2z79xBkrYD9LqCxc88hHzpJ0kw",
)
REST = SUPABASE_URL + "/rest/v1"
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))          # inspection-finder-MG
KAKAO_PC_DIR = os.path.join(REPO, "tools", "kakao-pc")   # poster_send.py · outbox_relay.py
LOG_DIR = os.path.join(HERE, "logs")
STATE_PATH = os.path.join(HERE, "state.json")
HOST = socket.gethostname()
KST = timezone(timedelta(hours=9))

try:  # 작업 스케줄러 콘솔은 cp949 — 한글·기호에서 죽지 않게
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def kst_now() -> datetime:
    return datetime.now(KST)


def log(msg: str, name: str = "worker") -> None:
    """콘솔 + logs/<name>-YYYY-MM-DD.txt (날짜별 파일 — 오래된 건 worker 가 30일 뒤 지운다)"""
    line = f"{kst_now():%Y-%m-%d %H:%M:%S} {msg}"
    print(line)
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        with open(os.path.join(LOG_DIR, f"{name}-{kst_now():%Y-%m-%d}.txt"), "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def rest(path: str, method: str = "GET", body=None, prefer: str = "", timeout: int = 60):
    """PostgREST 호출. 응답이 JSON 이면 파싱해 돌려주고, 비어 있으면 None. HTTP 오류는 RestError."""
    headers = {"apikey": SUPABASE_ANON, "Authorization": "Bearer " + SUPABASE_ANON, "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(REST + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read().decode()
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:200]
        raise RestError(e.code, f"{method} {path.split('?')[0]} → {e.code}: {detail}") from None
    return json.loads(raw) if raw.strip().startswith(("[", "{")) else None


class RestError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def google_drive_dir() -> str:
    """구글 드라이브 데스크톱 폴더 — 스트리밍(X:\\내 드라이브)·미러(사용자 폴더\\내 드라이브) 둘 다. 없으면 빈 문자열"""
    home = os.path.expanduser("~")
    cands = [os.path.join(home, n) for n in ("내 드라이브", "My Drive", "Google Drive")]
    for letter in "DEFGHIJKLMNOPQRSTUVWXYZ":
        cands += [f"{letter}:\\내 드라이브", f"{letter}:\\My Drive"]
    for c in cands:
        if os.path.isdir(c):
            return c
    return ""


def backup_root() -> str:
    """백업 폴더 — 환경 변수 FIRSTOA_BACKUP_ROOT > 구글 드라이브\\FIRSTOA-백업(회사는 구글 계정, 2026-10-10)
    > OneDrive 바탕화면\\FIRSTOA-백업(데스크톱의 옛 위치) > 사용자 폴더\\FIRSTOA-백업(클라우드 없음 — 로그에 경고)"""
    env = os.environ.get("FIRSTOA_BACKUP_ROOT")
    if env:
        return env
    gd = google_drive_dir()
    if gd:
        return os.path.join(gd, "FIRSTOA-백업")
    one = os.path.join(os.path.expanduser("~"), "OneDrive", "Desktop")
    if os.path.isdir(one):
        return os.path.join(one, "FIRSTOA-백업")
    return os.path.join(os.path.expanduser("~"), "FIRSTOA-백업")


def load_state() -> dict:
    try:
        with open(STATE_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_state(state: dict) -> None:
    tmp = STATE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=1)
    os.replace(tmp, STATE_PATH)
