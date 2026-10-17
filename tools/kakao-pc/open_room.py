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


def chat_list_view_rect(main: int):
    """채팅 탭 전체 영역(ChatRoomListView, 클래스 EVA_Window) — 머리띠(채팅 제목·돋보기·새 채팅 아이콘)가 이 영역 맨 위 55px 이다"""
    hit = []

    def cb(h, _):
        try:
            if win32gui.IsWindowVisible(h) and win32gui.GetClassName(h) == "EVA_Window" and win32gui.GetWindowText(h).startswith("ChatRoomListView"):
                hit.append(win32gui.GetWindowRect(h))
        except Exception:
            pass

    try:
        win32gui.EnumChildWindows(main, cb, None)
    except Exception:
        pass
    return hit[0] if hit else None


def focused_is_edit() -> bool | None:
    """지금 포커스가 입력칸인지 — uiautomation 이 있으면 확인, 없으면 None(모름)"""
    try:
        import uiautomation as uia
        return uia.GetFocusedControl().ControlTypeName == "EditControl"
    except Exception:
        return None


def find_edit_rect(main: int):
    """메인 창 안에 이미 열린 검색 입력칸(EditControl)이 있으면 그 화면 좌표 — 돋보기는 켜기/끄기 토글이라(2026-10-17 실측) 열려 있을 땐 누르면 닫힌다"""
    try:
        import uiautomation as uia
        root = uia.ControlFromHandle(main)
        found = []

        def walk(c, d=0):
            if found or d > 8:
                return
            if c.ControlTypeName == "EditControl":
                r = c.BoundingRectangle
                if r.width() > 40:
                    found.append((r.left, r.top, r.right, r.bottom))
                    return
            for ch in c.GetChildren():
                walk(ch, d + 1)
        walk(root)
        return found[0] if found else None
    except Exception:
        return None


def _dark_ratio(pyautogui, region) -> float:
    """영역 안에서 어두운 픽셀 비율 — 사이드바 탭 아이콘은 활성이면 검정, 아니면 회색(2026-10-17 화면 실측)"""
    try:
        img = pyautogui.screenshot(region=region).convert("L")
        px = list(img.getdata())
        return sum(1 for v in px if v < 90) / max(1, len(px))
    except Exception:
        return -1.0


def go_chat_tab(main: int, pyautogui, debug: bool = False) -> bool:
    """왼쪽 사이드바의 말풍선(채팅) 아이콘을 클릭해 채팅 탭으로 — Ctrl+E 는 탭을 바꾸지 않았다(친구 탭이면 머리띠 같은 자리가 '친구 추가'라 사고).
    화면 실측(490x1020 창): 친구 아이콘 (40,70) · 채팅 아이콘 (40,140). 활성 아이콘이 더 진하다."""
    l, t, r, b = win32gui.GetWindowRect(main)
    pyautogui.click(l + 40, t + 140)
    time.sleep(0.6)
    chat = _dark_ratio(pyautogui, (l + 26, t + 126, 28, 28))
    friend = _dark_ratio(pyautogui, (l + 26, t + 56, 28, 28))
    ok = chat >= 0 and chat > friend + 0.05
    if debug:
        log(f"    [debug] 채팅 탭 클릭 ({l + 40},{t + 140}) · 진한 비율 채팅={chat:.2f} 친구={friend:.2f} → {'채팅 탭' if ok else '확인 실패'}")
    if not ok:
        log("    채팅 탭으로 간 것을 화면에서 확인하지 못해 중단합니다(창 크기·배율이 다르면 좌표 보정 필요)")
    return ok


def focus_search_box(main: int, pyautogui, debug: bool = False):
    """채팅 탭 머리띠의 돋보기(🔍)를 눌러 검색칸을 연다 — 2026-10-17 화면 실측(490x1020 창): 돋보기 = 채팅 탭 영역 오른쪽 끝에서 137px, 위에서 32px.
    Ctrl+F 는 친구 탭이면 '친구 추가' 창을 열고, 목록 위 50px 띠는 전체/안읽음 필터 버튼이라 둘 다 쓰지 않는다."""
    if not go_chat_tab(main, pyautogui, debug):
        return None, chat_list_rect(main), None
    view = chat_list_view_rect(main)
    list_rect = chat_list_rect(main)
    if not view:
        log("    채팅 탭 영역(ChatRoomListView)을 못 찾음")
        return None, list_rect, None
    edit = find_edit_rect(main)
    if edit:
        x, y = (edit[0] + edit[2]) // 2, (edit[1] + edit[3]) // 2  # 이미 열린 검색칸 — 그 안을 클릭
        pyautogui.click(x, y)
        time.sleep(0.4)
        pyautogui.hotkey("ctrl", "a")  # 입력칸 안이라 안전 — 남은 검색어를 덮어쓴다
        time.sleep(0.1)
    else:
        x, y = view[2] - 137, view[1] + 32  # 돋보기
        pyautogui.click(x, y)
        time.sleep(0.6)
        if focused_is_edit() is False and find_edit_rect(main) is None:
            pyautogui.click(x, y)  # 토글이 꺼진 상태였으면 한 번 더
            time.sleep(0.6)
    if close_friend_add_windows():
        log("    '친구 추가' 창이 떠서 닫았습니다 — 이번 시도는 중단")
        return None, list_rect, (x, y)
    if win32gui.GetForegroundWindow() != main:
        log(f"    맨 앞 창이 '{win32gui.GetWindowText(win32gui.GetForegroundWindow())}' 이라 중단")
        return None, list_rect, (x, y)
    is_edit = focused_is_edit()
    if debug:
        log(f"    [debug] 채팅탭={view} 목록={list_rect} {'열린 검색칸' if edit else '돋보기'} 클릭={(x, y)} 포커스가 입력칸? {is_edit}")
    if is_edit is False:
        log("    돋보기를 눌렀는데 입력칸에 포커스가 없음 — 붙여 넣지 않고 중단")
        return None, list_rect, (x, y)
    return True, list_rect, (x, y)


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
    pyautogui.hotkey("ctrl", "v")
    time.sleep(wait)  # 목록이 걸러질 시간
    if close_friend_add_windows():
        log("    붙여 넣은 뒤 '친구 추가' 창이 떠서 닫았습니다 — 중단")
        return False
    # 걸러진 목록의 첫 항목을 더블클릭(↓+Enter 는 아무 창도 안 열었다 — 2026-10-17 실측)
    list_rect = chat_list_rect(main) or list_rect
    if list_rect:
        pyautogui.doubleClick(list_rect[0] + 140, list_rect[1] + 40)  # 첫 항목(높이 약 80px)의 가운데
        time.sleep(1.5)
    hwnd, title = find_room_window(room)
    if debug:
        new = room_windows_snapshot() - before
        log(f"    [debug] 새 창={[(h, win32gui.GetWindowText(h), win32gui.GetWindowRect(h)) for h in new]}")
    # 검색 모드 닫기(Esc) — 다음 검색·사람 사용에 방해 안 되게. 메인 창이 앞에 있을 때만
    try:
        if win32gui.GetForegroundWindow() == main or bring_front(main):
            pyautogui.press("esc")
            time.sleep(0.3)
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
