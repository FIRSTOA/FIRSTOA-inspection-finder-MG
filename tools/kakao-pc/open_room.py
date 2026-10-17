# -*- coding: utf-8 -*-
r"""
카톡 PC에서 방 이름으로 방 창 열기 — "창을 미리 열어 두지 않아도" 노트북이 대신 보낼 수 있게 (2026-10-17).

노트북 D6110 · 카톡 26.8.2 에서 화면을 직접 보며 확정한 순서(2026-10-17 14:10, Aside):
  1) 왼쪽 사이드바 말풍선(채팅) 아이콘 클릭 → 아이콘 색으로 채팅 탭인지 확인
  2) 채팅 탭의 검색 입력칸은 진짜 Win32 Edit 컨트롤(클래스 'Edit', id=100). 열려 있으면 X로 닫고, 머리띠 돋보기(토글)를 눌러 새로 연다
  3) 검색칸 안을 클릭해 포커스 확인 후 Ctrl+V 로 방 이름을 붙여 넣는다 → 목록이 그 방만 남는다
     (WM_SETTEXT 로 직접 넣고 비우는 방식은 카톡이 힙 손상으로 죽었다 — 사람이 하는 동작만 쓴다)
  4) 걸러진 목록(ChatRoomListCtrl)의 항목을 위에서부터 더블클릭(최대 3개) → "제목이 그 방 이름인 창"이 생겼는지로 성공 판단
  5) 검색은 X 클릭으로 닫고, 필터는 '전체'로 되돌린다

절대 쓰지 않는 것(전부 실측 사고):
  · Ctrl+A = '친구 추가' 창 열기 (검색칸 안에서 눌러도!). 그 창은 제목이 빈 팝업이라 제목으로는 못 찾는다
  · Ctrl+F = 친구 탭이면 '친구 추가', Ctrl+E = 탭을 안 바꿈
  · 목록 위 50px 띠 클릭 = '전체/안읽음' 필터 버튼
  · ↓ + Enter = 아무 방도 안 연다
글은 항상 find_room_window 로 제목을 확인한 창에만 붙여 넣으므로, 여기서 실패해도 잘못 보내지는 않는다.

시험:  python tools\kakao-pc\open_room.py --room "테스트 전용방" --debug
"""
import argparse
import sys
import time

import win32con
import win32gui

from poster_send import CHAT_CLASS, find_room_window, log, norm

MAIN_TITLES = ("카카오톡", "kakaotalk")
SEARCH_EDIT_ID = 100  # 채팅 탭 검색 입력칸 (클래스 'Edit')


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


def _children(main: int, pred):
    hit = []

    def cb(h, _):
        try:
            if win32gui.IsWindowVisible(h) and pred(h):
                hit.append(h)
        except Exception:
            pass

    try:
        win32gui.EnumChildWindows(main, cb, None)
    except Exception:
        pass
    return hit


def chat_list_rect(main: int):
    """메인 창 안의 채팅 목록(ChatRoomListCtrl, 클래스 EVA_VH_ListControl_Dblclk) 화면 좌표 — 검색으로 걸러진 첫 항목을 더블클릭하려고"""
    hs = _children(main, lambda h: win32gui.GetClassName(h) == "EVA_VH_ListControl_Dblclk")
    rects = [win32gui.GetWindowRect(h) for h in hs]
    # 가장 큰 목록이 채팅 목록
    return max(rects, key=lambda r: (r[2] - r[0]) * (r[3] - r[1])) if rects else None


def chat_list_view_rect(main: int):
    """채팅 탭 전체 영역(ChatRoomListView, 클래스 EVA_Window) — 머리띠(채팅 제목·돋보기·새 채팅 아이콘)가 이 영역 맨 위 55px 이다"""
    hs = _children(main, lambda h: win32gui.GetClassName(h) == "EVA_Window" and win32gui.GetWindowText(h).startswith("ChatRoomListView"))
    return win32gui.GetWindowRect(hs[0]) if hs else None


def search_edit(main: int):
    """채팅 탭 검색 입력칸 핸들(클래스 'Edit', id=100). 검색이 닫혀 있으면 None — 닫혀 있어도 크기 0짜리 Edit 이 남아 있어(실측) 폭이 있는 것만 인정"""

    def ok(h):
        if win32gui.GetClassName(h) != "Edit" or win32gui.GetDlgCtrlID(h) != SEARCH_EDIT_ID:
            return False
        r = win32gui.GetWindowRect(h)
        return (r[2] - r[0]) > 40 and (r[3] - r[1]) > 10

    hs = _children(main, ok)
    return hs[0] if hs else None


def room_windows_snapshot() -> set:
    s = set()

    def cb(h, _):
        if win32gui.IsWindowVisible(h) and win32gui.GetClassName(h) == CHAT_CLASS:
            s.add(h)

    win32gui.EnumWindows(cb, None)
    return s


def close_popup_windows(main: int | None = None) -> int:
    """'친구 추가' 같은 팝업을 닫는다. 그 창은 제목이 비어 있고(실측) 메인 창이 소유한 키 300px 넘는 EVA 창이다.
    (제목에 '친구 추가'가 들어간 창도 함께 닫는다.) 광고 띠(높이 113px)는 건드리지 않는다"""
    main = main or main_window()
    hit = []

    def cb(h, _):
        try:
            if h == main or not win32gui.IsWindowVisible(h) or win32gui.GetClassName(h) != CHAT_CLASS:
                return
            t = win32gui.GetWindowText(h)
            r = win32gui.GetWindowRect(h)
            if "친구 추가" in t:
                hit.append(h)
            elif not t.strip() and (r[3] - r[1]) > 300 and main and win32gui.GetWindow(h, win32con.GW_OWNER) == main:
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
        time.sleep(0.5)
    return len(hit)


# 예전 이름 호환(probe_chat_tab.py 가 쓴다)
close_friend_add_windows = close_popup_windows


def _dark_ratio(pyautogui, region) -> float:
    """영역 안에서 어두운 픽셀 비율 — 사이드바 탭 아이콘은 활성이면 검정, 아니면 회색(2026-10-17 화면 실측: 채팅 0.51 / 친구 0.00)"""
    try:
        img = pyautogui.screenshot(region=region).convert("L")
        px = list(img.getdata())
        return sum(1 for v in px if v < 90) / max(1, len(px))
    except Exception:
        return -1.0


def go_chat_tab(main: int, pyautogui, debug: bool = False) -> bool:
    """왼쪽 사이드바의 말풍선(채팅) 아이콘을 클릭해 채팅 탭으로. 화면 실측(490x1020 창): 친구 아이콘 (40,70) · 채팅 아이콘 (40,140)"""
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


def focused_is_edit() -> bool | None:
    """지금 포커스가 입력칸인지 — uiautomation 이 있으면 확인, 없으면 None(모름)"""
    try:
        import uiautomation as uia
        return uia.GetFocusedControl().ControlTypeName == "EditControl"
    except Exception:
        return None


def close_search(main: int, pyautogui) -> bool:
    """열려 있는 검색칸을 오른쪽 X 로 닫는다(글도 같이 비워진다). 실측: X = 채팅 탭 영역 오른쪽 끝에서 35px, 검색칸 세로 가운데"""
    edit = search_edit(main)
    view = chat_list_view_rect(main)
    if not edit or not view:
        return not edit
    r = win32gui.GetWindowRect(edit)
    pyautogui.click(view[2] - 35, (r[1] + r[3]) // 2)
    time.sleep(0.5)
    return search_edit(main) is None


def enter_search_text(main: int, text: str, pyautogui, debug: bool = False) -> bool:
    """채팅 탭 검색칸에 방 이름을 붙여 넣는다 — 사람이 하듯 클릭과 Ctrl+V 만 쓴다.
    (WM_SETTEXT 로 글을 넣고 비우던 방식은 카톡이 힙 손상(0xc0000374)으로 세 번 죽었다 — 2026-10-17 14:28/14:30/14:31)
    순서: 이미 열린 검색칸은 X 로 닫아 비운다 → 돋보기로 연다 → 검색칸 안을 클릭 → 포커스가 입력칸인지 확인 → Ctrl+V"""
    from poster_send import set_clipboard_text

    view = chat_list_view_rect(main)
    if not view:
        log("    채팅 탭 영역(ChatRoomListView)을 못 찾음")
        return False
    if search_edit(main) and not close_search(main, pyautogui):
        log("    열려 있던 검색칸을 못 닫음 — 중단")
        return False
    x, y = view[2] - 137, view[1] + 32  # 머리띠 돋보기(실측)
    pyautogui.click(x, y)
    time.sleep(0.6)
    edit = search_edit(main)
    if debug:
        log(f"    [debug] 돋보기 클릭 {(x, y)} → 검색칸 {edit}")
    if not edit:
        log("    돋보기를 눌렀는데 검색 입력칸(Edit id=100)이 안 생김 — 중단")
        return False
    r = win32gui.GetWindowRect(edit)
    pyautogui.click((r[0] + r[2]) // 2, (r[1] + r[3]) // 2)
    time.sleep(0.3)
    if close_popup_windows(main) or win32gui.GetForegroundWindow() != main or focused_is_edit() is False:
        log(f"    검색칸에 포커스가 없음(맨 앞: '{win32gui.GetWindowText(win32gui.GetForegroundWindow())}') — 붙여 넣지 않고 중단")
        return False
    set_clipboard_text(text)
    pyautogui.hotkey("ctrl", "v")
    return True


def reset_filter_all(main: int, pyautogui) -> bool:
    """채팅 목록 위의 '전체 / 안읽음 / …' 필터 띠(id=1020, 407x50)에서 '전체'를 누른다 — 예전 버전이 '안읽음'을 잘못 눌러 둔 걸 되돌리고, 사람이 볼 때 헷갈리지 않게.
    검색어가 비어 있을 때만 띠가 보인다(실측). '전체' 버튼 = 띠 왼쪽 끝에서 58px"""
    hs = _children(main, lambda h: win32gui.GetClassName(h) == CHAT_CLASS and win32gui.GetDlgCtrlID(h) == 1020)
    if not hs:
        return False
    r = win32gui.GetWindowRect(hs[0])
    if not (380 <= r[2] - r[0] <= 440 and 40 <= r[3] - r[1] <= 60):
        return False  # 크기가 다르면 다른 컴포넌트 — 안 누른다
    pyautogui.click(r[0] + 58, (r[1] + r[3]) // 2)
    time.sleep(0.3)
    return True


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
    if close_popup_windows(main):
        log("    떠 있던 팝업(친구 추가 등)을 닫았습니다")
    if not bring_front(main):
        return False
    before = room_windows_snapshot()
    if not go_chat_tab(main, pyautogui, debug):
        return False
    if close_popup_windows(main) or win32gui.GetForegroundWindow() != main:
        log(f"    맨 앞 창이 '{win32gui.GetWindowText(win32gui.GetForegroundWindow())}' 이라 중단")
        return False
    if not enter_search_text(main, room, pyautogui, debug):
        return False
    time.sleep(wait)  # 목록이 걸러질 시간
    if close_popup_windows(main):
        log("    검색어를 넣은 뒤 팝업이 떠서 닫았습니다 — 중단")
        return False
    # 걸러진 목록의 항목(높이 약 87px)을 위에서부터 더블클릭 — '테스트'처럼 다른 방 이름에 포함되는 이름은 첫 항목이 엉뚱한 방일 수 있어 3번째까지 본다
    list_rect = chat_list_rect(main)
    if not list_rect:
        log("    채팅 목록(ChatRoomListCtrl)을 못 찾음")
        return False
    hwnd, title = None, ""
    for i in range(3):
        x, y = list_rect[0] + 140, list_rect[1] + 40 + i * 87
        if y > list_rect[3] - 20:
            break
        pyautogui.doubleClick(x, y)
        hwnd, title = None, ""
        for _ in range(8):  # 창이 뜨기까지 최대 4초(카톡이 느릴 때 1.5초로는 못 잡았다 — 2026-10-17 부품요청)
            time.sleep(0.5)
            hwnd, title = find_room_window(room)
            if hwnd:
                break
        new = room_windows_snapshot() - before
        if debug:
            log(f"    [debug] 목록={list_rect} {i + 1}번째 더블클릭={(x, y)} 새 창={[(h, win32gui.GetWindowText(h), win32gui.GetWindowRect(h)) for h in new]}")
        if hwnd:
            break
        # 엉뚱한 방이 앞으로 왔나? (이미 열려 있던 창이면 새 창이 아니라 포커스만 옮겨진다)
        fg = win32gui.GetForegroundWindow()
        fgt = win32gui.GetWindowText(fg)
        if fg == main or not fgt.strip() or norm(fgt) in (norm(t) for t in MAIN_TITLES):
            break  # 아무 방도 안 열렸다 = 그 줄에 항목이 없다(검색 결과 끝)
        log(f"    ✗ {i + 1}번째 항목은 '{fgt}' — 다음 항목으로 (목표: {room})")
        if fg in new:
            try:
                win32gui.PostMessage(fg, win32con.WM_CLOSE, 0, 0)  # 이번에 새로 연 창만 닫는다
            except Exception:
                pass
            time.sleep(0.6)
        if not bring_front(main):
            break
    # 검색 닫기(다음 검색·사람 사용에 방해 안 되게) — 방 창이 내용을 다 불러오도록 잠깐 기다린 뒤, X 클릭만 한다
    try:
        time.sleep(1.0)
        if win32gui.GetForegroundWindow() == main or bring_front(main):
            close_search(main, pyautogui)
            reset_filter_all(main, pyautogui)
    except Exception:
        pass
    close_popup_windows(main)
    if hwnd:
        log(f"    ✓ 방 창 열림: '{title}'")
        return True
    for h in room_windows_snapshot() - before:
        t = win32gui.GetWindowText(h)
        if not t.strip():
            continue  # 제목 없는 창은 카톡 내부 팝업 — 위에서 처리
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
