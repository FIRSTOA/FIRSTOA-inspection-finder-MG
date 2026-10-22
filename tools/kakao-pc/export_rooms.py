# -*- coding: utf-8 -*-
r"""
카톡 PC "대화 내용 저장"을 매일 자동으로 — 구글 드라이브 "카톡 자동적재 수신함"에 TXT 를 떨군다 (2026-10-23)

뒤는 이미 있다: apps-script/first-data/src/Drive.gs ingestFromDriveFolder 가 수신함의 TXT 를
방 이름(파일 첫 줄 "○○ 님과 카카오톡 대화")으로 분류해 증분 적재하고 "처리됨"/"확인필요"로 옮긴다.
빠진 것은 매일 저장 버튼을 누르는 손 — 이 스크립트가 그 손이다.

안전 원칙 (.claude/agents/kakao-pc-rules.md, docs/tasks/tab-search-kakao-history.md 5-1)
  · 메뉴 클릭·좌표 클릭은 한 번도 하지 않는다. 채팅방 메뉴에는 "채팅방 나가기"가 있어 한 칸만 어긋나도
    봇이 업무방에서 나간다. 그래서 **단축키 하나(Ctrl+S)** 와 윈도 표준 저장 창만 쓴다.
  · Ctrl+S 가 정말 "대화 내용 저장"인지는 추정이다 → 먼저 --probe 로 노트북에서 확인하고, 그 뒤에만
    실행기 스위치(FIRSTOA_KAKAO_EXPORT=1)를 켠다.
  · 창은 이미 열려 있는 방만. 검색으로 열지 않는다(1단계).
  · 키를 누르기 전마다 맨 앞 창을 확인한다. 아니면 그 자리에서 중단(키 안 누름).
  · Esc 는 "맨 앞 창이 카톡이 띄운 새 창(저장 창·확인창)"일 때만 누른다 — 방 창에 Esc 가 가면 방 창이 닫힐 수 있다.
  · 파일 이름 칸에는 클립보드 붙여넣기만(창 메시지로 글 넣기 금지 — 규칙 6). 붙여 넣은 뒤 클립보드를 비운다.
  · 같은 이름 파일이 있으면 덮어쓰지 않는다(미리 건너뛰고, 그래도 덮어쓰기 확인창이 뜨면 Esc).
  · Ctrl+A/F/E 를 쓰지 않는다. 파일 이름 칸 전체 선택은 End → Shift+Home 으로 한다(표준 Edit 칸에서만).

사용법 (노트북 D6110 에서만 — 데스크톱에서 돌리지 않는다)
  python tools\kakao-pc\export_rooms.py --probe --room "방이름"     기본. Ctrl+S 뒤 뜨는 창만 기록하고 Esc (저장 안 함)
  python tools\kakao-pc\export_rooms.py --export --rooms "방이름"   그 방 하나만 실제 저장(첫 시험)
  python tools\kakao-pc\export_rooms.py --export                    room_map 의 방 중 창이 열린 방 전부
  python tools\kakao-pc\export_rooms.py --list                      대상 방과 창 열림 여부만(키 안 누름)
  python tools\kakao-pc\export_rooms.py --selftest                  순수 함수 점검(카톡 안 건드림)
  옵션: --dir "<수신함 폴더>" (기본: 환경 변수 FIRSTOA_KAKAO_EXPORT_DIR > 구글 드라이브\카톡 자동적재 수신함)
로그: tools\kakao-pc\poster_log.txt ("[내보내기]" 줄), probe 스크린샷 tools\kakao-pc\logs\export_probe.png
"""
import argparse
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
INBOX_NAME = "카톡 자동적재 수신함"  # Drive.gs DRIVE_INBOX_NAME 과 같은 이름
DIALOG_CLASS = "#32770"  # 윈도 표준 대화 상자(다른 이름으로 저장·확인창)
# 저장 창 제목 — 노트북 probe 로 확인 전엔 추정값. 다르면 환경 변수 FIRSTOA_KAKAO_SAVE_TITLE 에 실제 제목(일부)을 넣는다
SAVE_TITLES = ("다른 이름으로 저장", "save as", "대화 내용 저장", "대화내용 저장")
PROBE_WAIT = 1.5   # 초 — Ctrl+S 뒤 창을 기다리는 시간(probe)
EXPORT_WAIT = 3.0  # 초 — 실제 저장 때는 조금 넉넉히
ROOM_GAP = 3.0     # 방 사이 텀
MAX_FAILS = 3      # 실패 3번이면 그날은 중단
HERE = os.path.dirname(os.path.abspath(__file__))

try:  # 작업 스케줄러 콘솔은 cp949
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


# ── 순수 함수(카톡·윈도 API 없음 — --selftest 로 점검) ─────────────────
_BAD_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def kst_today(now: datetime | None = None) -> str:
    return (now or datetime.now(KST)).astimezone(KST).strftime("%Y%m%d")


def export_file_name(room: str, ymd: str) -> str:
    """'방이름_YYYYMMDD.txt' — 윈도 파일 이름에 못 쓰는 글자(/ : * ? 등)는 '_' 로, 끝의 점·공백은 뗀다, 너무 길면 자른다"""
    base = _BAD_CHARS.sub("_", str(room or "").strip())
    base = re.sub(r"\s+", " ", base).strip(" .")
    base = base[:80].rstrip(" .") or "방"
    return f"{base}_{ymd}.txt"


def pick_rooms(rows: list, categories: list | None = None) -> list:
    """room_map 행들 → 방 이름 목록(앞뒤 공백 제거, 빈 이름 제외, 중복 제거, 처음 나온 순서 유지).
    categories 를 주면 그 업무 종류의 방만"""
    want = {c.strip() for c in (categories or []) if c and c.strip()}
    seen, out = set(), []
    for r in rows or []:
        room = str((r or {}).get("room") or "").strip()
        if not room or room in seen:
            continue
        if want and str(r.get("category") or "").strip() not in want:
            continue
        seen.add(room)
        out.append(room)
    return out


def is_save_dialog(cls: str, title: str, extra_titles: tuple = ()) -> bool:
    """윈도 표준 저장 창인가 — 클래스 #32770 + 제목에 저장 창 이름이 들어 있어야"""
    if cls != DIALOG_CLASS:
        return False
    t = str(title or "").strip().lower()
    return any(s.lower() in t for s in tuple(SAVE_TITLES) + tuple(extra_titles) if s)


def selftest() -> int:
    assert export_file_name("완료방(납품,철수,교체)", "20261023") == "완료방(납품,철수,교체)_20261023.txt"
    assert export_file_name("PC/IT/피씨/확장성고객등록및영업", "20261023") == "PC_IT_피씨_확장성고객등록및영업_20261023.txt"
    assert export_file_name("영업확장성미션 : 복합기", "20261023") == "영업확장성미션 _ 복합기_20261023.txt"
    assert export_file_name("  방.  ", "20261023") == "방_20261023.txt"
    assert export_file_name("", "20261023") == "방_20261023.txt"
    assert len(export_file_name("가" * 300, "20261023")) == 80 + len("_20261023.txt")
    assert kst_today(datetime(2026, 10, 22, 22, 0, tzinfo=timezone.utc)) == "20261023"  # UTC 22시 = KST 다음 날 07시
    rows = [{"category": "점검", "room": " 점검C방 "}, {"category": "AS", "room": "AS C방"}, {"category": "점검", "room": "점검C방"},
            {"category": "마감", "room": ""}, {"category": "초과조정", "room": "강북A/초과"}, {"category": "재계약", "room": "강북A/초과"}]
    assert pick_rooms(rows) == ["점검C방", "AS C방", "강북A/초과"]
    assert pick_rooms(rows, ["점검"]) == ["점검C방"]
    assert pick_rooms(rows, ["재계약"]) == ["강북A/초과"]
    assert pick_rooms(None) == []
    assert is_save_dialog("#32770", "다른 이름으로 저장")
    assert is_save_dialog("#32770", "Save As")
    assert not is_save_dialog("EVA_Window_Dblclk", "다른 이름으로 저장")
    assert not is_save_dialog("#32770", "채팅방 나가기")
    assert is_save_dialog("#32770", "내보내기", ("내보내기",))
    print("selftest OK")
    return 0


# ── 설정 ─────────────────────────────────────────────────────────
def extra_save_titles() -> tuple:
    v = os.environ.get("FIRSTOA_KAKAO_SAVE_TITLE", "").strip()
    return (v,) if v else ()


def inbox_dir(arg: str | None) -> str:
    """수신함 폴더 — --dir > FIRSTOA_KAKAO_EXPORT_DIR > 구글 드라이브\\카톡 자동적재 수신함. 없으면 빈 문자열(만들지 않는다:
    로컬에서 같은 이름 폴더를 새로 만들면 Drive.gs 가 보는 폴더(ID 고정)와 다른 폴더가 생긴다)"""
    cand = arg or os.environ.get("FIRSTOA_KAKAO_EXPORT_DIR", "")
    if not cand:
        sys.path.insert(0, os.path.join(os.path.dirname(HERE), "worker"))
        try:
            from config import google_drive_dir

            gd = google_drive_dir()
        except Exception:
            gd = ""
        cand = os.path.join(gd, INBOX_NAME) if gd else ""
    return cand if cand and os.path.isdir(cand) else ""


def load_rooms(categories: list | None) -> list:
    from outbox_relay import rest_call  # 같은 anon REST 도우미

    rows = rest_call("/room_map?select=category,region,room&order=category.asc,region.asc") or []
    return pick_rooms(rows, categories)


# ── 윈도 도우미 ──────────────────────────────────────────────────
def _pid(hwnd: int) -> int:
    import win32process

    try:
        return win32process.GetWindowThreadProcessId(hwnd)[1]
    except Exception:
        return 0


def _fg():
    import win32gui

    h = win32gui.GetForegroundWindow()
    try:
        return h, win32gui.GetClassName(h), win32gui.GetWindowText(h)
    except Exception:
        return h, "", ""


def _visible_windows_of(pid: int) -> set:
    import win32gui

    s = set()

    def cb(h, _):
        try:
            if win32gui.IsWindowVisible(h) and _pid(h) == pid:
                s.add(h)
        except Exception:
            pass

    win32gui.EnumWindows(cb, None)
    return s


def _focused_control(hwnd: int):
    """그 창 스레드에서 키보드 포커스를 가진 컨트롤(핸들, 클래스) — GetGUIThreadInfo"""
    import ctypes
    import ctypes.wintypes as wt

    import win32gui
    import win32process

    class GUITHREADINFO(ctypes.Structure):
        _fields_ = [("cbSize", wt.DWORD), ("flags", wt.DWORD), ("hwndActive", wt.HWND), ("hwndFocus", wt.HWND),
                    ("hwndCapture", wt.HWND), ("hwndMenuOwner", wt.HWND), ("hwndMoveSize", wt.HWND),
                    ("hwndCaret", wt.HWND), ("rcCaret", wt.RECT)]

    try:
        tid = win32process.GetWindowThreadProcessId(hwnd)[0]
        info = GUITHREADINFO()
        info.cbSize = ctypes.sizeof(GUITHREADINFO)
        if not ctypes.windll.user32.GetGUIThreadInfo(tid, ctypes.byref(info)) or not info.hwndFocus:
            return 0, ""
        h = int(info.hwndFocus)
        return h, win32gui.GetClassName(h)
    except Exception:
        return 0, ""


def _is_descendant(child: int, parent: int) -> bool:
    import win32gui

    try:
        return bool(child) and (child == parent or win32gui.IsChild(parent, child))
    except Exception:
        return False


def _child_summary(hwnd: int, limit: int = 30) -> list:
    import win32gui

    out = []

    def cb(h, _):
        if len(out) < limit:
            try:
                out.append(f"{win32gui.GetClassName(h)}#{win32gui.GetDlgCtrlID(h)}")
            except Exception:
                pass

    try:
        win32gui.EnumChildWindows(hwnd, cb, None)
    except Exception:
        pass
    return out


def _clear_clipboard() -> None:
    import win32clipboard

    try:
        win32clipboard.OpenClipboard()
        try:
            win32clipboard.EmptyClipboard()
        finally:
            win32clipboard.CloseClipboard()
    except Exception as e:
        from poster_send import log

        log(f"    [내보내기] 클립보드 비우기 실패: {e}")


def _wait_new_window(pid: int, before: set, room_hwnd: int, wait: float):
    """Ctrl+S 뒤 카톡 프로세스가 새로 띄운 창(맨 앞 우선)을 기다린다 → (hwnd, cls, title) 또는 (0,'','')"""
    import win32gui

    end = time.time() + wait
    while time.time() < end:
        time.sleep(0.15)
        fh, fc, ft = _fg()
        # 원래 있던 창(메인·다른 방 창)이 앞으로 온 것은 "새 창"이 아니다 — 거기에 Esc 를 누르면 안 된다
        if fh and fh != room_hwnd and fh not in before and _pid(fh) == pid:
            return fh, fc, ft
        new = _visible_windows_of(pid) - before
        dialogs = [h for h in new if win32gui.GetClassName(h) == DIALOG_CLASS]
        if dialogs:
            h = dialogs[0]
            return h, DIALOG_CLASS, win32gui.GetWindowText(h)
    return 0, "", ""


def _esc_if_front(hwnd: int, why: str) -> bool:
    """맨 앞 창이 바로 그 창(카톡이 띄운 저장 창·확인창·팝업)일 때만 Esc. 아니면 누르지 않는다"""
    import pyautogui

    from poster_send import log

    if _fg()[0] != hwnd:
        log(f"    [내보내기] Esc 안 누름 — 맨 앞이 '{_fg()[2]}' ({why})")
        return False
    pyautogui.press("esc")
    time.sleep(0.5)
    return True


def _front_room(room: str):
    """방 창을 찾아 맨 앞으로 + 제목 확인 → hwnd 또는 0"""
    from open_room import bring_front
    from poster_send import find_room_window, log, norm

    hwnd, title = find_room_window(room)
    if not hwnd:
        return 0
    if not bring_front(hwnd):
        log(f"    [내보내기] ✗ [{room}] 창을 맨 앞으로 못 가져옴")
        return -1
    fh, _, ft = _fg()
    if fh != hwnd or not (norm(room) in norm(ft) or norm(ft) in norm(room)) or not norm(ft):
        log(f"    [내보내기] ✗ 맨 앞 창이 '{ft}' — 목표 '{room}' 아님, 키 안 누름")
        return -1
    return hwnd


def _kakao_ready() -> bool:
    from open_room import kakao_responding, login_window, main_window
    from poster_send import log

    main = main_window()
    if not main:
        log("    [내보내기] 카톡 메인 창 없음 — 카톡이 꺼져 있거나 로그인 전")
        return False
    if login_window():
        log("    [내보내기] 카톡이 로그인 화면 — 중단")
        return False
    if not kakao_responding(main):
        log("    [내보내기] 카톡 응답 없음 — 중단")
        return False
    return True


# ── probe ────────────────────────────────────────────────────────
def probe(room: str) -> int:
    """Ctrl+S 가 저장 창을 여는지만 본다. 저장하지 않는다. 메뉴·좌표 클릭 없음"""
    import pyautogui
    import win32gui

    from open_room import close_popup_windows, main_window
    from poster_send import log

    pyautogui.FAILSAFE = False
    log("=" * 64)
    log(f"[내보내기] probe 시작 — 방 '{room}' (Ctrl+S → 뜨는 창 기록 → Esc, 저장 안 함)")
    if not _kakao_ready():
        return 2
    hwnd = _front_room(room)
    if hwnd == 0:
        log(f"    [내보내기] ✗ '{room}' 창이 안 열려 있음 — 카톡에서 그 방을 더블클릭해 창으로 열어 두고 다시")
        return 2
    if hwnd < 0:
        return 2
    pid = _pid(hwnd)
    before = _visible_windows_of(pid)
    fh, fc, ft = _fg()
    log(f"    [내보내기] 누르기 직전 맨 앞: '{ft}' ({fc}) · 포커스 컨트롤 {_focused_control(hwnd)[1] or '-'}")
    pyautogui.hotkey("ctrl", "s")
    h, cls, title = _wait_new_window(pid, before, hwnd, PROBE_WAIT)
    if not h:
        log(f"    [내보내기] ✗ Ctrl+S 뒤 {PROBE_WAIT}초 안에 새 창이 안 뜸 — 단축키 불가 · 수동 확인 필요 (Esc 안 누름: 방 창이 닫힐 수 있어)")
        return 3
    try:
        rect = win32gui.GetWindowRect(h)
        owner = win32gui.GetWindow(h, 4)  # GW_OWNER
    except Exception:
        rect, owner = None, 0
    focus_h, focus_cls = _focused_control(h)
    log(f"    [내보내기] 새 창: 클래스='{cls}' 제목='{title}' 크기={rect} 소유={'방 창' if owner == hwnd else ('메인 창' if owner == main_window() else owner)}")
    log(f"    [내보내기]   포커스 컨트롤={focus_cls or '-'} (창 안={_is_descendant(focus_h, h)}) · 자식={', '.join(_child_summary(h))}")
    try:  # 눈으로 확인용 — 로컬에만(logs 는 git 제외)
        if rect:
            os.makedirs(os.path.join(HERE, "logs"), exist_ok=True)
            shot = os.path.join(HERE, "logs", "export_probe.png")
            pyautogui.screenshot(region=(rect[0], rect[1], max(1, rect[2] - rect[0]), max(1, rect[3] - rect[1]))).save(shot)
            log(f"    [내보내기]   스크린샷: {shot}")
    except Exception as e:
        log(f"    [내보내기]   스크린샷 실패: {e}")
    ok = is_save_dialog(cls, title, extra_save_titles())
    _esc_if_front(h, "probe 닫기")
    if ok:
        still = win32gui.IsWindow(h) and win32gui.IsWindowVisible(h)
        log(f"    [내보내기] ✓ 저장 창이 맞음 — Esc 로 닫음{' (아직 떠 있음! 손으로 닫아 주세요)' if still else ''}. 파일은 저장하지 않았습니다")
        log("    [내보내기]   다음: --export --rooms \"이 방\" 으로 한 방만 실제 저장해 보고, 파일 첫 줄이 '○○ 님과 카카오톡 대화' 인지 확인")
        return 0 if not still else 4
    if cls == DIALOG_CLASS:
        log(f"    [내보내기] ? 표준 대화 상자지만 제목 '{title}' 이 저장 창 목록에 없음 — 저장 창이 맞다면 FIRSTOA_KAKAO_SAVE_TITLE=\"{title}\" 로 지정")
    else:
        log("    [내보내기] ✗ 저장 창이 아님 — 단축키 불가 · 수동 확인 필요")
    if close_popup_windows():
        log("    [내보내기]   남은 팝업을 닫았습니다")
    return 3


# ── export ───────────────────────────────────────────────────────
def export_one(room: str, folder: str, ymd: str) -> str:
    """한 방 저장 → 'ok' / 'skip:이유' / 'fail:이유'"""
    import pyautogui
    import win32gui

    from poster_send import log, set_clipboard_text

    path = os.path.join(folder, export_file_name(room, ymd))
    if os.path.exists(path):
        return "skip:오늘 파일 이미 있음"
    hwnd = _front_room(room)
    if hwnd == 0:
        return "skip:창 안 열림"
    if hwnd < 0:
        return "fail:맨 앞 창 확인 실패"
    pid = _pid(hwnd)
    before = _visible_windows_of(pid)
    pyautogui.hotkey("ctrl", "s")
    dlg, cls, title = _wait_new_window(pid, before, hwnd, EXPORT_WAIT)
    if not dlg:
        return "fail:Ctrl+S 뒤 창이 안 뜸"
    if not is_save_dialog(cls, title, extra_save_titles()):
        _esc_if_front(dlg, "저장 창 아님")
        return f"fail:저장 창 아님('{title}' {cls})"
    try:
        # 파일 이름 칸에 포커스가 있어야만 쓴다
        fh = _fg()[0]
        focus_h, focus_cls = _focused_control(dlg)
        if fh != dlg or focus_cls != "Edit" or not _is_descendant(focus_h, dlg):
            _esc_if_front(dlg, "파일 이름 칸 포커스 아님")
            return f"fail:파일 이름 칸 포커스 아님(맨 앞 일치={fh == dlg}, 포커스={focus_cls or '-'})"
        set_clipboard_text(path)
        try:
            if _fg()[0] != dlg:
                return "fail:붙여넣기 직전 맨 앞 창이 바뀜"
            pyautogui.press("end")
            pyautogui.hotkey("shift", "home")  # 칸 안 글 전체 선택(Ctrl+A 금지 규칙 — 표준 Edit 에서 같은 효과)
            pyautogui.hotkey("ctrl", "v")
            time.sleep(0.4)
        finally:
            _clear_clipboard()
        if _fg()[0] != dlg:
            return "fail:Enter 직전 맨 앞 창이 바뀜"
        before2 = _visible_windows_of(pid)
        pyautogui.press("enter")
        # 저장 창이 닫히거나, 확인창(덮어쓰기·오류)이 뜨거나
        end = time.time() + 5.0
        while time.time() < end:
            time.sleep(0.25)
            if not (win32gui.IsWindow(dlg) and win32gui.IsWindowVisible(dlg)):
                break
            fh, fc, ft = _fg()
            pop = fh if (fh != dlg and fc == DIALOG_CLASS and _pid(fh) == pid) else 0
            if not pop:
                news = [h for h in _visible_windows_of(pid) - before2 if win32gui.GetClassName(h) == DIALOG_CLASS]
                pop = news[0] if news else 0
            if pop:
                ptitle = win32gui.GetWindowText(pop)
                log(f"    [내보내기]   확인창 '{ptitle}' — 덮어쓰지 않고 Esc")
                _esc_if_front(pop, "확인창")
                time.sleep(0.3)
                _esc_if_front(dlg, "저장 창 닫기")
                return f"fail:확인창이 뜸('{ptitle}') — 덮어쓰기/경로 문제"
        if win32gui.IsWindow(dlg) and win32gui.IsWindowVisible(dlg):
            _esc_if_front(dlg, "5초 지나도 저장 창이 안 닫힘")
            return "fail:저장 창이 안 닫힘"
    except Exception as e:
        if win32gui.IsWindow(dlg) and win32gui.IsWindowVisible(dlg):
            _esc_if_front(dlg, "오류")
        return f"fail:{e}"
    # 파일 생성 확인 — 큰 방은 쓰는 데 시간이 걸린다
    for _ in range(40):  # 최대 20초
        try:
            if os.path.getsize(path) > 0:
                time.sleep(1.0)
                return "ok"
        except OSError:
            pass
        time.sleep(0.5)
    return "fail:파일이 안 생김(또는 0바이트)"


def export(rooms: list, folder: str) -> int:
    import pyautogui

    from open_room import close_popup_windows
    from poster_send import log

    pyautogui.FAILSAFE = False
    ymd = kst_today()
    log("=" * 64)
    log(f"[내보내기] 시작 — 대상 {len(rooms)}방 · 폴더 {folder}")
    if not _kakao_ready():
        return 2
    if close_popup_windows():
        log("    [내보내기] 떠 있던 팝업을 닫았습니다")
    ok = skip = fails = 0
    pressed = False
    deadline = time.time() + 480  # 실행기 한 바퀴가 너무 오래 멈추면 심박 파수꾼(15분)이 "실행기 멈춤"을 보낸다 — 8분 넘으면 그날은 그만(방지훈 검토 2026-10-23)
    for room in rooms:
        if fails >= MAX_FAILS:
            log(f"    [내보내기] 실패 {fails}번 — 남은 방은 오늘 건너뜀")
            break
        if time.time() > deadline:
            log("    [내보내기] 8분 상한 — 남은 방은 오늘 건너뜀")
            break
        if pressed:
            time.sleep(ROOM_GAP)
        res = export_one(room, folder, ymd)
        kind, _, why = res.partition(":")
        if kind == "ok":
            ok += 1
            pressed = True
            log(f"    [내보내기] ✓ [{room}] 저장 → {export_file_name(room, ymd)}")
        elif kind == "skip":
            skip += 1
            log(f"    [내보내기] - [{room}] 건너뜀: {why}")
        else:
            fails += 1
            pressed = True
            log(f"    [내보내기] ✗ [{room}] {why}")
    log(f"[내보내기] 끝 · 저장 {ok} · 건너뜀 {skip} · 실패 {fails}")
    return 0 if fails == 0 else 2


def list_rooms(rooms: list, folder: str) -> int:
    from poster_send import find_room_window, log

    log(f"[내보내기] 수신함 폴더: {folder or '(못 찾음)'}")
    for r in rooms:
        h, t = find_room_window(r)
        log(f"  {'창 있음 ✓ ' + t if h else '창 없음 —'} · {r}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="카톡 PC 대화 내용 저장(수신함으로) — 기본은 --probe")
    ap.add_argument("--probe", action="store_true", help="(기본) Ctrl+S 뒤 뜨는 창만 기록하고 Esc — 저장 안 함")
    ap.add_argument("--export", action="store_true", help="열린 방 창마다 실제 저장")
    ap.add_argument("--list", action="store_true", help="대상 방·창 열림 여부만")
    ap.add_argument("--selftest", action="store_true", help="순수 함수 점검(카톡 안 건드림)")
    ap.add_argument("--room", help="probe 할 방 이름")
    ap.add_argument("--rooms", help="저장할 방 이름들(쉼표·줄바꿈 구분) — 없으면 room_map 전체")
    ap.add_argument("--category", help="room_map 업무 종류만(쉼표 구분, 예: 점검,AS)")
    ap.add_argument("--dir", help="수신함 폴더(기본: FIRSTOA_KAKAO_EXPORT_DIR > 구글 드라이브\\카톡 자동적재 수신함)")
    args = ap.parse_args()

    if args.selftest:
        return selftest()
    sys.path.insert(0, HERE)
    if not (args.export or args.list):
        if not args.room:
            print("probe 에는 --room \"방이름\" 이 필요합니다 (창으로 열려 있는 방)")
            return 2
        return probe(args.room)

    from poster_send import log

    if args.rooms:
        rooms = pick_rooms([{"room": x} for x in re.split(r"[,\n]", args.rooms)])
    else:
        try:
            rooms = load_rooms(args.category.split(",") if args.category else None)
        except Exception as e:
            log(f"[내보내기] ✗ room_map 읽기 실패: {e}")
            return 2
    folder = inbox_dir(args.dir)
    if args.list:
        return list_rooms(rooms, folder)
    if not folder:
        log(f"[내보내기] ✗ 수신함 폴더를 못 찾음 — 구글 드라이브 데스크톱에 '{INBOX_NAME}' 이 동기화돼 있는지, 또는 --dir / FIRSTOA_KAKAO_EXPORT_DIR 지정 (폴더를 새로 만들지 않습니다)")
        return 2
    if not rooms:
        log("[내보내기] 대상 방이 없음")
        return 0
    return export(rooms, folder)


if __name__ == "__main__":
    sys.exit(main())
