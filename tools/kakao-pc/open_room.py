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


def chat_list_rect(main: int):
    """메인 창 안의 채팅 목록(ChatRoomListCtrl, 클래스 EVA_VH_ListControl_Dblclk) 화면 좌표 — 검색으로 걸러진 첫 항목을 더블클릭하려고"""
    hit = []

    def cb(h, _):
        try:
            if win32gui.IsWindowVisible(h) and win32gui.GetClassName(h) == "EVA_VH_ListControl_Dblclk":
                hit.append(win32gui.GetWindowRect(h))
        except Exception:
            pass

    try:
        win32gui.EnumChildWindows(main, cb, None)
    except Exception:
        pass
    # 가장 큰 목록이 채팅 목록
    return max(hit, key=lambda r: (r[2] - r[0]) * (r[3] - r[1])) if hit else None


def room_windows_snapshot() -> set:
    s = set()

    def cb(h, _):
        if win32gui.IsWindowVisible(h) and win32gui.GetClassName(h) == CHAT_CLASS:
            s.add(h)

    win32gui.EnumWindows(cb, None)
    return s


def close_friend_add_windows() -> int:
    """'친구 추가' 창이 떠 있으면 닫는다 — 거기에 글을 붙여 넣으면 ID로 친구를 찾는 꼴이라 반드시 막는다"""
    hit = []

    def cb(h, _):
        try:
            if win32gui.IsWindowVisible(h) and "친구 추가" in win32gui.GetWindowText(h):
                hit.append(h)
        except Exception:
            pass

    win32gui.EnumWindows(cb, None)
    for h in hit:
        try:
            win32gui.PostMessage(h, win32con.WM_CLOSE, 0, 0)
        except Exception:
            pass
    if hit:
        time.sleep(0.4)
    return len(hit)


def search_box_rect(main: int, list_rect):
    """채팅 목록 바로 위의 검색칸(진단: id=1020, 407x50, 목록과 같은 폭·목록 바로 위)"""
    if not list_rect:
        return None
    hit = []

    def cb(h, _):
        try:
            if not win32gui.IsWindowVisible(h) or win32gui.GetClassName(h) != CHAT_CLASS:
                return
            r = win32gui.GetWindowRect(h)
            if abs(r[0] - list_rect[0]) <= 3 and abs(r[3] - list_rect[1]) <= 3 and 20 <= (r[3] - r[1]) <= 80:
                hit.append(r)
        except Exception:
            pass

    try:
        win32gui.EnumChildWindows(main, cb, None)
    except Exception:
        pass
    return hit[0] if hit else None


def focus_search_box(main: int, pyautogui, debug: bool = False):
    """채팅 탭으로 간 뒤 검색칸을 직접 클릭해 포커스 — Ctrl+F 는 친구 탭에 있으면 '친구 추가' 창을 연다(2026-10-17 실측)"""
    pyautogui.hotkey("ctrl", "e")  # 진단: 채팅 목록(ChatRoomListCtrl)로 포커스 = 채팅 탭
    time.sleep(0.5)
    list_rect = chat_list_rect(main)
    box = search_box_rect(main, list_rect)
    if box:
        pyautogui.click(box[0] + 120, (box[1] + box[3]) // 2)
    else:
        pyautogui.hotkey("ctrl", "f")
    time.sleep(0.5)
    if close_friend_add_windows():
        log("    '친구 추가' 창이 떠서 닫았습니다 — 이번 시도는 중단")
        return None, list_rect, box
    if win32gui.GetForegroundWindow() != main:
        log(f"    맨 앞 창이 '{win32gui.GetWindowText(win32gui.GetForegroundWindow())}' 이라 중단")
        return None, list_rect, box
    if debug:
        log(f"    [debug] 목록={list_rect} 검색칸={box} ({'클릭' if box else 'Ctrl+F'})")
    return True, list_rect, box


def open_room(room: str, wait: float = 1.2, debug: bool = False) -> bool:
    """방 이름으로 방 창을 연다. 이미 열려 있으면 True. 끝나면 메인 창 검색칸은 비운다."""
    import pyautogui

    pyautogui.FAILSAFE = False
    if find_room_window(room)[0]:
        return True
    main = main_window()
    if not main:
        log("    카톡 메인 창을 못 찾음 — 카톡 PC가 꺼져 있거나 로그인 전")
        return False
    close_friend_add_windows()
    if not bring_front(main):
        return False
    before = room_windows_snapshot()
    ok, list_rect, box = focus_search_box(main, pyautogui, debug)
    if not ok:
        return False
    set_clipboard_text(room)
    pyautogui.hotkey("ctrl", "a")
    pyautogui.hotkey("ctrl", "v")
    time.sleep(wait)  # 목록이 걸러질 시간
    if close_friend_add_windows():
        log("    붙여 넣은 뒤 '친구 추가' 창이 떠서 닫았습니다 — 중단")
        return False
    # 걸러진 목록의 첫 항목을 더블클릭(↓+Enter 는 아무 창도 안 열었다 — 2026-10-17 실측)
    list_rect = chat_list_rect(main) or list_rect
    if list_rect:
        pyautogui.doubleClick(list_rect[0] + 140, list_rect[1] + 32)
        time.sleep(1.5)
    hwnd, title = find_room_window(room)
    if debug:
        new = room_windows_snapshot() - before
        log(f"    [debug] 새 창={[(h, win32gui.GetWindowText(h), win32gui.GetWindowRect(h)) for h in new]}")
    # 검색칸 비우기(다음 검색·사람 사용에 방해 안 되게)
    try:
        if bring_front(main):
            ok2, _, _ = focus_search_box(main, pyautogui)
            if ok2:
                pyautogui.hotkey("ctrl", "a")
                pyautogui.press("backspace")
                pyautogui.press("esc")
    except Exception:
        pass
    close_friend_add_windows()
    if hwnd:
        log(f"    ✓ 방 창 열림: '{title}'")
        return True
    for h in room_windows_snapshot() - before:
        t = win32gui.GetWindowText(h)
        if not t.strip():
            continue  # 제목 없는 창은 카톡 내부 팝업 — 건드리지 않는다
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
    ap.add_argument("--debug", action="store_true", help="새로 생긴 창·목록 좌표를 로그에 남긴다")
    args = ap.parse_args()
    if find_room_window(args.room)[0]:
        log(f"    이미 열려 있음: {args.room} — 시험하려면 그 창을 닫고 다시")
    ok = open_room(args.room, debug=args.debug)
    print("OK" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
