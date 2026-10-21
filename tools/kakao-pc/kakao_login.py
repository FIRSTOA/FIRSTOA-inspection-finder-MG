"""카톡 PC 로그인 화면이 떠 있으면 저장된 봇 계정으로 대신 로그인한다 (노트북 D6110 전용, 2026-10-22)

왜: 카톡 PC가 자동 업데이트(26.8→26.9)되면서 자동 로그인이 풀려 20시간 동안 빈 로그인 창으로 서 있었다(10/21).
     재부팅·업데이트·세션 만료로 로그인 화면이 뜨면 사람이 올 때까지 발송이 전부 멈추므로, PC가 스스로 로그인한다.

계정·비밀번호는 저장소·로그·채팅 어디에도 두지 않는다. 윈도우 자격 증명 관리자(암호화, 이 사용자만 읽음)의
  일반 자격 증명 "FIRSTOA_KAKAO" 에서 읽는다. 저장은 tools\\kakao-pc\\save_kakao_cred.ps1 (사람이 직접 입력).

로그인 창(2026-10-22 카톡 26.9 실측): 클래스 EVA_Window 제목 '카카오톡', 487x800
  - 계정 칸  Edit id=1060 (저장된 계정이 미리 채워져 있는 경우가 많다)
  - 비밀번호 Edit id=1061 (비어 있음, 창 뜨면 여기 커서)
  - 로그인 단추: 비밀번호 칸 바로 아래 — Enter 로 대신한다
  - '자동 로그인' 체크는 기본으로 켜져 있다(pref.ini set_auto_login = yes)
글자는 WM_SETTEXT 로 넣지 않는다(카톡 힙 손상 크래시 원인으로 판명, 2026-10-17) — 클릭 + 키 입력만 쓴다.
"""
from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import time

import win32clipboard
import win32con
import win32gui

from open_room import login_window  # 로그인 화면 판정은 한 곳(open_room)에서만 — 두 벌이면 한쪽만 바뀌어 어긋난다(방지훈 2026-10-22)

CRED_TARGET = "FIRSTOA_KAKAO"
ID_EDIT = 1060
PW_EDIT = 1061

_last_try = 0.0
RETRY_SECONDS = 600  # 10분에 한 번만 — 비밀번호가 틀렸을 때 카카오가 계정을 잠그지 않게
MAX_FAILS = 3        # 연속 3번 실패하면 자동 로그인을 멈춘다(사람이 로그인하거나 자격 증명을 다시 저장하면 풀림) — 계정 잠김·인증 요구 방지
_STATE = __import__("pathlib").Path(__file__).with_name("kakao_login_state.json")  # 실패 횟수 — 실행기를 다시 켜도 유지


def _load_fails() -> int:
    try:
        import json

        return int(json.loads(_STATE.read_text(encoding="utf-8")).get("fails", 0))
    except Exception:
        return 0


def _save_fails(n: int) -> None:
    try:
        import json

        _STATE.write_text(json.dumps({"fails": n, "at": time.strftime("%Y-%m-%d %H:%M:%S")}), encoding="utf-8")
    except Exception:
        pass


def log(msg: str) -> None:
    try:
        from poster_send import log as _log

        _log(msg)
    except Exception:
        print(msg)


class _CREDENTIAL(ctypes.Structure):
    _fields_ = [
        ("Flags", wt.DWORD), ("Type", wt.DWORD), ("TargetName", wt.LPWSTR), ("Comment", wt.LPWSTR),
        ("LastWritten", wt.FILETIME), ("CredentialBlobSize", wt.DWORD), ("CredentialBlob", ctypes.POINTER(ctypes.c_byte)),
        ("Persist", wt.DWORD), ("AttributeCount", wt.DWORD), ("Attributes", ctypes.c_void_p),
        ("TargetAlias", wt.LPWSTR), ("UserName", wt.LPWSTR),
    ]


def read_credential(target: str = CRED_TARGET) -> tuple[str, str] | None:
    """윈도우 자격 증명 관리자에서 (계정, 비밀번호) — 없으면 None"""
    adv = ctypes.windll.advapi32
    p = ctypes.POINTER(_CREDENTIAL)()
    if not adv.CredReadW(target, 1, 0, ctypes.byref(p)):
        return None
    try:
        c = p.contents
        pw = ctypes.string_at(c.CredentialBlob, c.CredentialBlobSize).decode("utf-16-le")
        return (c.UserName or ""), pw
    finally:
        adv.CredFree(p)


def _edit(lw: int, ctrl_id: int):
    hit = []

    def cb(h, _):
        if win32gui.GetClassName(h) == "Edit" and win32gui.GetDlgCtrlID(h) == ctrl_id:
            hit.append(h)

    win32gui.EnumChildWindows(lw, cb, None)
    return hit[0] if hit else None


def _text(h: int) -> str:
    n = win32gui.SendMessage(h, win32con.WM_GETTEXTLENGTH, 0, 0)
    buf = ctypes.create_unicode_buffer(n + 1)
    ctypes.windll.user32.SendMessageW(h, win32con.WM_GETTEXT, n + 1, buf)
    return buf.value


def _center(h: int) -> tuple[int, int]:
    l, t, r, b = win32gui.GetWindowRect(h)
    return (l + r) // 2, (t + b) // 2


def _front_is(lw: int) -> bool:
    """맨 앞 창이 로그인 창(또는 그 안의 칸)인가 — 아니면 키를 누르지 않는다(메인 창에서 Ctrl+A = 친구 추가)"""
    fg = win32gui.GetForegroundWindow()
    return bool(fg) and (fg == lw or win32gui.GetAncestor(fg, 2) == lw)  # 2 = GA_ROOT


def _clear_clipboard() -> None:
    try:
        win32clipboard.OpenClipboard()
        try:
            win32clipboard.EmptyClipboard()
        finally:
            win32clipboard.CloseClipboard()
    except Exception:
        pass


def _replace_text(pyautogui, lw: int, edit: int, text: str) -> bool:
    """칸을 비우고 글자를 넣는다 — Ctrl+A 대신 End·Shift+Home·Backspace, 넣기는 클립보드 붙여넣기(한글 입력기 상태와 무관)
    붙여넣은 직후 클립보드를 비운다(비밀번호가 남지 않게). 맨 앞 창이 로그인 창이 아니면 아무 키도 누르지 않고 False."""
    from poster_send import set_clipboard_text

    pyautogui.click(*_center(edit))
    time.sleep(0.3)
    if not _front_is(lw):
        return False
    pyautogui.press("end")
    pyautogui.hotkey("shift", "home")
    pyautogui.press("backspace")
    if not _front_is(lw):
        return False
    try:
        set_clipboard_text(text)
        pyautogui.hotkey("ctrl", "v")
        time.sleep(0.3)
    finally:
        _clear_clipboard()
    return True


def auto_login(force: bool = False) -> bool:
    """로그인 화면이면 저장된 계정으로 로그인 시도. 로그인됐으면 True.
    10분에 한 번만 시도(force 는 무시). 성공 판정: 로그인 창이 사라지고 메인 창(EVA_Window_Dblclk '카카오톡')이 생김."""
    global _last_try
    lw = login_window()
    if not lw:
        return True  # 로그인 화면 아님 — 할 일 없음
    now = time.time()
    if not force and now - _last_try < RETRY_SECONDS:
        return False
    _last_try = now
    fails = _load_fails()
    if not force and fails >= MAX_FAILS:
        log(f"    ✗ 자동 로그인 {fails}번 연속 실패로 멈춤 — 사람이 카톡 PC에 로그인하거나 save_kakao_cred.ps1 로 다시 저장해야 한다")
        return False

    cred = read_credential()
    if not cred or not cred[1]:
        log("    ✗ 로그인 화면인데 저장된 봇 계정이 없음 — tools\\kakao-pc\\save_kakao_cred.ps1 로 저장해야 한다")
        return False
    user, pw = cred

    import pyautogui

    from open_room import bring_front, main_window

    pyautogui.FAILSAFE = False
    log(f"    ⚿ 카톡 로그인 화면 — 저장된 봇 계정({user[:3]}***)으로 로그인 시도 ({fails + 1}/{MAX_FAILS})")
    bring_front(lw)
    time.sleep(0.8)
    if not _front_is(lw):
        log("    ✗ 로그인 창을 맨 앞으로 못 가져옴 — 키를 누르지 않고 다음에 다시")
        return False

    id_edit, pw_edit = _edit(lw, ID_EDIT), _edit(lw, PW_EDIT)
    if not pw_edit:
        log("    ✗ 로그인 창에 비밀번호 칸(Edit id=1061)이 없음 — 카톡 화면이 바뀐 듯, 사람이 확인")
        return False

    # 계정 칸: 비어 있거나 다른 계정이면 다시 쓴다 (저장된 번호가 821020881095 꼴로 국가번호가 붙어 있어도 같은 계정으로 본다)
    if id_edit:
        cur = _text(id_edit).strip()
        cur_core, user_core = cur.lstrip("0"), user.lstrip("0")
        same = bool(cur) and (cur == user or (bool(cur_core) and bool(user_core) and (cur.endswith(user_core) or user.endswith(cur_core))))
        if not same and not _replace_text(pyautogui, lw, id_edit, user):
            log("    ✗ 계정 칸 입력 중 로그인 창이 맨 앞에서 벗어남 — 중단")
            return False
        time.sleep(0.3)

    if not _replace_text(pyautogui, lw, pw_edit, pw):
        log("    ✗ 비밀번호 입력 중 로그인 창이 맨 앞에서 벗어남 — 중단")
        return False
    time.sleep(0.4)
    if not _front_is(lw):
        return False
    pyautogui.press("enter")

    for _ in range(20):  # 최대 40초
        time.sleep(2)
        if not login_window() and main_window():
            log("    ✓ 봇 계정으로 로그인됨")
            _save_fails(0)
            time.sleep(3)  # 친구·방 목록 불러올 틈
            return True
    # 실패 — 창 캡처는 남기지 않는다(비밀번호 노출 위험 없음: 가려지지만 혹시 몰라)
    _save_fails(fails + 1)
    still = login_window()
    log(f"    ✗ 로그인 안 됨(40초) — {'아직 로그인 화면(비밀번호 틀림·인증 요구·네트워크?)' if still else '로그인 창은 사라졌는데 메인 창이 없음'} · 10분 뒤 다시 시도({fails + 1}/{MAX_FAILS})")
    return False


if __name__ == "__main__":
    import sys

    ok = auto_login(force=True)
    print("OK" if ok else "FAIL")
    sys.exit(0 if ok else 1)
