# -*- coding: utf-8 -*-
r"""
카톡 PC에서 방 이름으로 방 창 열기 — "창을 미리 열어 두지 않아도" 노트북이 대신 보낼 수 있게 (2026-10-17).

이 카톡 버전(26.8.2.5324)에서 실측한 것(probe_ui.py, 노트북 D6110):
  · 메인 창 '카카오톡'(EVA_Window_Dblclk) 안의 채팅 탭에서 Ctrl+F 를 누르면 새 창 없이 검색칸(EditControl id=100)에 포커스가 간다
  · 채팅 목록은 ChatRoomListCtrl(id=1003) 인데 항목이 프로그램에 안 읽힌다 → 검색칸에 방 이름을 붙여 넣고 ↓ Enter 로 첫 결과를 연다
  · 연 뒤에는 "제목이 그 방 이름인 창"이 새로 생겼는지로만 성공을 판단한다. 엉뚱한 창(비슷한 이름의 친구 대화)이 열렸으면 닫는다 —
    글은 항상 find_room_window 로 제목을 확인한 창에만 붙여 넣으므로, 여기서 실패해도 잘못 보내지는 않는다.

시험:  python tools\kakao-pc\open_room.py --room "테스트 전용방"
"""
import argparse
import sys
import time

import win32con
import win32gui

from poster_send import CHAT_CLASS, find_room_window, log, norm, set_clipboard_text

MAIN_TITLES = ("카카오톡", "kakaotalk")


def main_window():
    """메인 창 핸들 — 트레이로 내려가 숨어 있어도 찾는다(보이지 않는 창 포함)"""
    hit = []

    def cb(h, _):
        if win32gui.GetClassName(h) != CHAT_CLASS:
            return
        if win32gui.GetWindowText(h).strip().lower() in MAIN_TITLES:
            hit.append(h)

    win32gui.EnumWindows(cb, None)
    # 보이는 창 우선
    hit.sort(key=lambda h: 0 if win32gui.IsWindowVisible(h) else 1)
    return hit[0] if hit else None


def bring_front(hwnd: int) -> bool:
    import pyautogui

    try:
        if not win32gui.IsWindowVisible(hwnd):
            win32gui.ShowWindow(hwnd, win32con.SW_SHOW)
        if win32gui.IsIconic(hwnd):
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
        pyautogui.press("alt")  # 포커스 가로채기 제한 풀기(윈도우 규칙)
        win32gui.SetForegroundWindow(hwnd)
        time.sleep(0.4)
        return win32gui.GetForegroundWindow() == hwnd
    except Exception as e:
        log(f"    메인 창 앞으로 가져오기 실패: {e}")
        return False


def room_windows_snapshot() -> set:
    s = set()

    def cb(h, _):
        if win32gui.IsWindowVisible(h) and win32gui.GetClassName(h) == CHAT_CLASS:
            s.add(h)

    win32gui.EnumWindows(cb, None)
    return s


def open_room(room: str, wait: float = 1.2) -> bool:
    """방 이름으로 방 창을 연다. 이미 열려 있으면 True. 끝나면 메인 창 검색칸은 Esc 로 비운다."""
    import pyautogui

    pyautogui.FAILSAFE = False
    if find_room_window(room)[0]:
        return True
    main = main_window()
    if not main:
        log("    카톡 메인 창을 못 찾음 — 카톡 PC가 꺼져 있거나 로그인 전")
        return False
    if not bring_front(main):
        return False
    before = room_windows_snapshot()
    # 채팅 탭 검색칸으로: Ctrl+F (이 버전은 새 창 없이 검색칸 포커스). 이전 검색어가 남아 있을 수 있어 전체 선택 후 덮어쓴다
    pyautogui.hotkey("ctrl", "f")
    time.sleep(0.5)
    set_clipboard_text(room)
    pyautogui.hotkey("ctrl", "a")
    pyautogui.hotkey("ctrl", "v")
    time.sleep(wait)  # 목록이 걸러질 시간
    pyautogui.press("down")
    time.sleep(0.3)
    pyautogui.press("enter")
    time.sleep(1.5)
    hwnd, title = find_room_window(room)
    # 검색칸 비우기(다음 검색·사람 사용에 방해 안 되게)
    try:
        if bring_front(main):
            pyautogui.hotkey("ctrl", "f")
            time.sleep(0.2)
            pyautogui.hotkey("ctrl", "a")
            pyautogui.press("backspace")
            pyautogui.press("esc")
    except Exception:
        pass
    if hwnd:
        log(f"    ✓ 방 창 열림: '{title}'")
        return True
    # 엉뚱한 창이 열렸으면 닫는다 — 글은 제목 확인된 창에만 붙이므로 안전하지만, 창이 쌓이면 다음 판단을 흐린다
    for h in room_windows_snapshot() - before:
        t = win32gui.GetWindowText(h)
        if h != main and norm(t) not in (norm(x) for x in MAIN_TITLES):
            log(f"    ✗ 엉뚱한 창 '{t}' 이 열려 닫습니다 (목표: {room})")
            try:
                win32gui.PostMessage(h, win32con.WM_CLOSE, 0, 0)
            except Exception:
                pass
    log(f"    ✗ 방 창을 못 열었음: {room} — 방 이름이 카톡 방 제목과 다르거나 봇 계정이 그 방에 없음")
    return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--room", required=True)
    args = ap.parse_args()
    ok = open_room(args.room)
    print("OK" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
