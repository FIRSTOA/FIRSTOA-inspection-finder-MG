# -*- coding: utf-8 -*-
"""
주간 키맨 포스터 — 카톡 PC 자동 사진 전송 (2026-08-28)

왜 PC인가: 메신저봇은 안드로이드 '알림 답장' 통로를 쓰기 때문에 규격상 글자만 보낼 수 있다.
사진 자체를 방에 올리려면 카톡을 직접 조작해야 해서, 이 스크립트가 카톡 PC의 방 창에 이미지를 붙여넣는다.

설계 원칙 — 눈먼 UI 조작은 하지 않는다
  카톡 PC의 채팅 목록은 프로그램으로 읽히지 않고(UIA에 이름이 안 나온다), 단축키도 버전마다 다르다
  (이 버전은 Ctrl+F가 '친구 추가'였다 — 실측). 그래서 **이미 열려 있는 방 창**만 제목으로 찾아 붙여넣는다.
  창이 없는 방은 봇이 문구+링크를 보내게 넘긴다 — 조용히 빠지는 방은 없다.
  붙여넣기 직전에 맨 앞 창 제목을 다시 확인해, 엉뚱한 방에 올라가는 사고를 막는다.

준비 (한 번만)
  카톡에서 지역 점검방을 각각 더블클릭해 **별도 창으로 열어 둔다**. 카톡을 끄지 않으면 창은 유지된다.
  창이 닫혀 있으면 그 방만 링크로 대체된다(로그에 남는다).

사용법
  python poster_send.py --check                       열려 있는 방 창·이번 주 대상 확인 (전송 없음)
  python poster_send.py --weekly                      실제 발송 (월요일 8시 작업 스케줄러가 부른다)
  python poster_send.py --weekly --plan               보내지 않고 어디에 보낼 수 있는지만
  python poster_send.py --room "나와의 채팅" --test    그 방으로 테스트 1장
"""
import argparse
import io
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime

import win32clipboard
import win32con
import win32gui
from PIL import Image

SUPABASE_URL = "https://kkdiihazgzesbqxjytqv.supabase.co"
SUPABASE_ANON = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrZGlpaGF6Z3plc2JxeGp5dHF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNjE0NjcsImV4cCI6MjEwMDczNzQ2N30."
    "fjKIbDpj0QhNgc7Qr2z79xBkrYD9LqCxc88hHzpJ0kw"
)
FN = SUPABASE_URL + "/functions/v1/weekly-keyman-poster"
REST = SUPABASE_URL + "/rest/v1"
HERE = os.path.dirname(os.path.abspath(__file__))
LOG_PATH = os.path.join(HERE, "poster_log.txt")
CHAT_CLASS = "EVA_Window_Dblclk"  # 카톡 창(메인·방·메모장이 같은 클래스를 쓴다)
NOT_A_ROOM = ("카카오톡", "메모장", "kakaotalk")  # 방이 아닌 카톡 창

try:  # 작업 스케줄러·WSL 콘솔은 cp949라서 '—' 같은 글자에서 죽는다
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def log(msg: str) -> None:
    line = f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}"
    print(line)
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def post_json(url: str, payload: dict, timeout: int = 300) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + SUPABASE_ANON,
            "apikey": SUPABASE_ANON,
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        body = res.read().decode()
    return json.loads(body) if body.strip().startswith("{") else {}


# ── 창 찾기 ────────────────────────────────────────────────
def norm(name: str) -> str:
    """방 이름 비교용 — 공백·괄호·점 차이를 무시한다"""
    return re.sub(r"[\s()\[\]·.]", "", str(name or "")).lower()


def chat_windows() -> list:
    """카톡 '방' 창 목록 [(hwnd, 제목)]"""
    found = []
    skip = [norm(x) for x in NOT_A_ROOM]

    def cb(h, _):
        if not win32gui.IsWindowVisible(h):
            return
        if win32gui.GetClassName(h) != CHAT_CLASS:
            return
        title = win32gui.GetWindowText(h)
        if title and norm(title) not in skip:
            found.append((h, title))

    win32gui.EnumWindows(cb, None)
    return found


def find_room_window(room: str):
    want = norm(room)
    if not want:
        return None, ""
    for h, title in chat_windows():
        t = norm(title)
        if t == want or (len(want) >= 4 and want in t) or (len(t) >= 4 and t in want):
            return h, title
    return None, ""


def focus(hwnd: int) -> bool:
    try:
        if win32gui.IsIconic(hwnd):
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        win32gui.SetForegroundWindow(hwnd)
        time.sleep(0.7)
        return win32gui.GetForegroundWindow() == hwnd
    except Exception as e:  # 다른 창이 포커스를 붙잡고 있으면 실패할 수 있다
        log(f"    창 활성화 실패: {e}")
        return False


# ── 클립보드 ───────────────────────────────────────────────
def set_clipboard_text(text: str) -> None:
    win32clipboard.OpenClipboard()
    try:
        win32clipboard.EmptyClipboard()
        win32clipboard.SetClipboardData(win32con.CF_UNICODETEXT, text)
    finally:
        win32clipboard.CloseClipboard()


def set_clipboard_image(png_bytes: bytes) -> None:
    """카톡은 CF_DIB 붙여넣기를 받는다 — BMP 헤더 14바이트를 떼고 넣는다"""
    img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    buf = io.BytesIO()
    img.save(buf, "BMP")
    data = buf.getvalue()[14:]
    win32clipboard.OpenClipboard()
    try:
        win32clipboard.EmptyClipboard()
        win32clipboard.SetClipboardData(win32clipboard.CF_DIB, data)
    finally:
        win32clipboard.CloseClipboard()


def paste_and_send(hwnd: int, room: str, wait: float) -> bool:
    """붙여넣고 보낸다 — 직전에 창 제목을 다시 확인해 엉뚱한 방을 막는다"""
    import pyautogui

    if not focus(hwnd):
        return False
    front = win32gui.GetWindowText(win32gui.GetForegroundWindow())
    if norm(room) not in norm(front) and norm(front) not in norm(room):
        log(f"    맨 앞 창이 '{front}' 이라 중단합니다(목표: {room})")
        return False
    pyautogui.hotkey("ctrl", "v")
    time.sleep(wait)
    pyautogui.press("enter")
    time.sleep(1.2)
    return True


# ── 본 작업 ────────────────────────────────────────────────
def send_to_room(room: str, text: str, png: bytes) -> bool:
    hwnd, title = find_room_window(room)
    if not hwnd:
        log(f"    ✗ 방 창이 안 열려 있음: {room}")
        return False
    log(f"    창 확인: '{title}'")
    if text:
        set_clipboard_text(text)
        if not paste_and_send(hwnd, room, 0.8):
            return False
    set_clipboard_image(png)
    return paste_and_send(hwnd, room, 2.0)  # 이미지는 미리보기가 붙는 시간이 필요하다


def queue_text(room: str, text: str) -> None:
    """사진을 못 올린 방은 봇이 문구+링크라도 보내게 한다"""
    try:
        req = urllib.request.Request(
            REST + "/outbox",
            data=json.dumps({"room": room, "text": text}).encode(),
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer " + SUPABASE_ANON,
                "apikey": SUPABASE_ANON,
                "Prefer": "return=minimal",
            },
        )
        urllib.request.urlopen(req, timeout=30)
        log("    → 봇 발송(문구+링크)으로 대체")
    except Exception as e:
        log(f"    ✗ 대체 발송도 실패: {e}")


def weekly(plan: bool) -> int:
    log("=" * 64)
    log(f"주간 키맨 포스터 자동전송 시작{' (계획만)' if plan else ''}")
    if not plan:
        # 서버 안전망이나 이전 실행이 이미 보냈으면 그만둔다 (같은 내용 두 번 가지 않게)
        try:
            st = post_json(FN, {"action": "status"}, timeout=60)
            if st.get("already"):
                log(f"이미 발송된 주입니다({st.get('sent')}) — 아무것도 보내지 않습니다")
                return 0
        except Exception as e:
            log(f"발송 여부 확인 실패(계속 진행): {e}")
    try:
        data = post_json(FN, {"action": "run", "dry": True})
    except Exception as e:
        log(f"✗ 이미지 생성 실패: {e}")
        return 1
    regions = data.get("regions") or []
    if not regions:
        log("지난주 변경 없음 — 보낼 것이 없습니다")
        return 0
    log(f"주 {data.get('week', {}).get('label')} · {len(regions)}개 지역")

    ok, fail = 0, 0
    for r in regions:
        room, letter = r.get("room"), r.get("region")
        log(f"  [{letter}] {room or '(방 매핑 없음)'} · {r.get('counts')}")
        if not room:
            fail += 1
            continue
        text = r.get("text") or ""
        if plan:
            hwnd, title = find_room_window(room)
            log(f"    {'보낼 수 있음 → ' + title if hwnd else '창이 안 열려 있음 → 링크로 대체될 방'}")
            ok, fail = (ok + 1, fail) if hwnd else (ok, fail + 1)
            continue
        try:
            png = urllib.request.urlopen(r["url"], timeout=60).read()
        except Exception as e:
            log(f"    ✗ 이미지 내려받기 실패: {e}")
            queue_text(room, text)
            fail += 1
            continue
        if send_to_room(room, text, png):
            log("    ✓ 사진 전송 완료")
            ok += 1
        else:
            queue_text(room, text)
            fail += 1

    if ok and not plan:
        try:
            post_json(FN, {"action": "mark"})
            log("서버에 '사진으로 발송함' 표시 완료")
        except Exception as e:
            log(f"표시 실패(서버 안전망이 한 번 더 보낼 수 있음): {e}")
    log(f"끝 · 사진 {ok}곳 · 대체/실패 {fail}곳")
    return 0 if fail == 0 else 2


def check() -> int:
    log("열려 있는 카톡 방 창:")
    rooms = chat_windows()
    for _, title in rooms:
        log(f"  · {title}")
    if not rooms:
        log("  (없음 — 카톡에서 방을 더블클릭해 별도 창으로 열어 두세요)")
    try:
        data = post_json(FN, {"action": "run", "dry": True})
        log("이번 주 보낼 방:")
        for r in data.get("regions") or []:
            hwnd, _ = find_room_window(r.get("room") or "")
            log(f"  [{r.get('region')}] {r.get('room')} → {'창 있음 ✓' if hwnd else '창 없음 ✗ (링크로 대체)'}")
    except Exception as e:
        log(f"서버 확인 실패: {e}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weekly", action="store_true", help="지난주 포스터를 지역 점검방에 사진으로 보낸다")
    ap.add_argument("--plan", action="store_true", help="보내지 않고 어디에 보낼 수 있는지만 본다")
    ap.add_argument("--check", action="store_true", help="열려 있는 방 창과 이번 주 대상 확인")
    ap.add_argument("--room", help="테스트로 보낼 방 이름")
    ap.add_argument("--test", action="store_true", help="--room 방으로 포스터 1장 테스트 발송")
    args = ap.parse_args()

    if args.check:
        return check()
    if args.weekly:
        return weekly(args.plan)
    if args.room:
        hwnd, title = find_room_window(args.room)
        if not hwnd:
            log(f"'{args.room}' 창을 찾지 못했습니다 — 카톡에서 그 방을 별도 창으로 열어 주세요")
            return 2
        log(f"창 확인: '{title}'")
        if not args.test:
            return 0
        data = post_json(FN, {"action": "preview", "region": "C"})
        regions = data.get("regions") or []
        if not regions:
            log("만들 이미지가 없습니다")
            return 1
        png = urllib.request.urlopen(regions[0]["url"], timeout=60).read()
        ok = send_to_room(args.room, "테스트 — 주간 키맨 포스터 자동전송 점검입니다", png)
        log("결과: " + ("성공" if ok else "실패"))
        return 0 if ok else 2
    ap.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
