# -*- coding: utf-8 -*-
r"""
카톡 PC 채팅 탭 진단 2 — 검색칸이 정확히 어디인지 보려고 (2026-10-17).
  ① 메인 창을 앞으로 → Ctrl+E(채팅 탭) → 창 전체를 PNG로 찍어 Supabase 저장소(photos/debug/)에 올리고 주소를 찍는다
  ② 그 상태의 UIA 요소 트리(채팅 목록 위쪽 띠의 버튼·입력칸 이름)
  ③ 채팅 목록 위쪽 띠(목록과 같은 폭, 목록 바로 위)의 좌표와, 그 띠 안을 20px 간격으로 훑으며 마우스를 올렸을 때 포커스/커서 변화는 건드리지 않는다(클릭 없음)
아무것도 클릭하거나 입력하지 않는다. 결과: tools\worker\logs\kakao_chat_tab_probe.txt
"""
import io
import os
import sys
import time
import urllib.request

import win32con
import win32gui

from open_room import chat_list_rect, main_window, bring_front, close_friend_add_windows
from poster_send import CHAT_CLASS, SUPABASE_ANON, SUPABASE_URL

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "worker", "logs", "kakao_chat_tab_probe.txt")
LINES: list[str] = []


def say(s: str = "") -> None:
    LINES.append(s)
    try:
        print(s)
    except UnicodeEncodeError:
        print(s.encode("utf-8", "replace").decode())


def upload_png(png: bytes, name: str) -> str:
    path = f"debug/{name}"
    req = urllib.request.Request(
        f"{SUPABASE_URL}/storage/v1/object/photos/{path}", method="POST", data=png,
        headers={"apikey": SUPABASE_ANON, "Authorization": "Bearer " + SUPABASE_ANON, "Content-Type": "image/png", "x-upsert": "true"},
    )
    urllib.request.urlopen(req, timeout=60).read()
    return f"{SUPABASE_URL}/storage/v1/object/public/photos/{path}"


def main() -> int:
    import pyautogui
    pyautogui.FAILSAFE = False
    say(f"채팅 탭 진단 · {time.strftime('%Y-%m-%d %H:%M:%S')}")
    close_friend_add_windows()
    main = main_window()
    if not main:
        say("메인 창 없음 — 카톡 PC 로그인 뒤 다시")
        return 1
    if not bring_front(main):
        say("메인 창을 앞으로 못 가져옴 — 카톡 메인 창을 한 번 클릭한 뒤 다시")
    pyautogui.hotkey("ctrl", "e")
    time.sleep(0.8)
    say(f"Ctrl+E 뒤 맨 앞 창: {win32gui.GetWindowText(win32gui.GetForegroundWindow())!r} · 친구 추가 창 닫음 {close_friend_add_windows()}개")

    # ① 스크린샷
    l, t, r, b = win32gui.GetWindowRect(main)
    img = pyautogui.screenshot(region=(l, t, r - l, b - t))
    buf = io.BytesIO(); img.save(buf, "PNG")
    try:
        url = upload_png(buf.getvalue(), f"kakao_main_{time.strftime('%Y%m%d_%H%M%S')}.png")
        say(f"① 메인 창 화면: {url}")
    except Exception as e:
        local = os.path.join(os.path.dirname(OUT), "kakao_main.png"); img.save(local)
        say(f"① 업로드 실패({e}) — 로컬 저장 {local}")
    say(f"   메인 창 좌표 {(l, t, r - l, b - t)}")

    # ② UIA 트리
    try:
        import uiautomation as uia
        root = uia.ControlFromHandle(main)
        n = 0

        def walk(c, d=0):
            nonlocal n
            if n > 200 or d > 8:
                return
            try:
                rr = c.BoundingRectangle; rect = f"({rr.left},{rr.top} {rr.width()}x{rr.height()})"
            except Exception:
                rect = "(?)"
            say(f"   {'  ' * d}{c.ControlTypeName:<14} name={(c.Name or '')[:36]!r:<40} id={getattr(c, 'AutomationId', '')!r:<8} cls={getattr(c, 'ClassName', '')!r:<26} {rect}")
            n += 1
            for ch in c.GetChildren():
                walk(ch, d + 1)
        say("② UIA 트리(채팅 탭 상태)")
        walk(root)
        fe = uia.GetFocusedControl()
        say(f"   포커스: {fe.ControlTypeName} name={(fe.Name or '')!r} id={getattr(fe, 'AutomationId', '')!r}")
    except Exception as e:
        say(f"② UIA 실패: {e}")

    # ③ 목록 위 띠
    lr = chat_list_rect(main)
    say(f"③ 채팅 목록 좌표 {lr}")
    kids = []

    def cb(h, _):
        try:
            if win32gui.IsWindowVisible(h):
                kids.append((win32gui.GetClassName(h), win32gui.GetWindowText(h), win32gui.GetWindowRect(h)))
        except Exception:
            pass
    win32gui.EnumChildWindows(main, cb, None)
    for cls, title, rect in sorted(kids, key=lambda k: (k[2][1], k[2][0])):
        say(f"   child {cls:<28} title={title!r:<30} rect={rect} size={rect[2]-rect[0]}x{rect[3]-rect[1]}")
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(LINES))
    say(f"저장: {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
