# -*- coding: utf-8 -*-
r"""
카톡 PC 화면 진단 — "창을 안 열어 둬도 방을 찾아 여는" 기능을 이 카톡 버전에 맞게 짜기 위한 재료 수집 (2026-10-17).

무엇을 뽑나
  ① 카톡 실행 파일 버전
  ② 카톡 창 목록(클래스·제목·크기) — 메인 창과 방 창 구분
  ③ 메인 창의 UI 자동화(UIA) 요소 트리 — 검색창·채팅 목록·버튼 이름/종류/위치
  ④ 메인 창을 앞으로 가져온 뒤 흔한 단축키(Ctrl+F, Ctrl+E, Ctrl+K)를 눌렀을 때 뜨는 창 제목(실측)
결과는 tools\worker\logs\kakao_ui_probe.txt 에 저장한다. 글만 쓰지 않고 어떤 방에도 메시지를 보내지 않는다.

실행:  python tools\kakao-pc\probe_ui.py
"""
import ctypes
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "worker", "logs", "kakao_ui_probe.txt")
os.makedirs(os.path.dirname(OUT), exist_ok=True)
LINES: list[str] = []


def say(s: str = "") -> None:
    LINES.append(s)
    try:
        print(s)
    except UnicodeEncodeError:
        print(s.encode("utf-8", "replace").decode("utf-8", "replace"))


def ensure(pkg: str, mod: str | None = None):
    try:
        return __import__(mod or pkg)
    except ImportError:
        say(f"(pip로 {pkg} 설치 중…)")
        subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "--disable-pip-version-check", pkg], check=False)
        return __import__(mod or pkg)


win32gui = ensure("pywin32", "win32gui")
win32process = __import__("win32process")
win32api = __import__("win32api")
win32con = __import__("win32con")

say("=" * 72)
say(f"카톡 PC 진단 · {time.strftime('%Y-%m-%d %H:%M:%S')} · python {sys.version.split()[0]}")

# ① 실행 파일 버전
exe_path = ""
try:
    import psutil  # type: ignore
except ImportError:
    psutil = ensure("psutil")
for p in psutil.process_iter(["name", "exe"]):
    if (p.info["name"] or "").lower() == "kakaotalk.exe":
        exe_path = p.info["exe"] or ""
        break
if exe_path:
    try:
        info = win32api.GetFileVersionInfo(exe_path, "\\")
        ms, ls = info["FileVersionMS"], info["FileVersionLS"]
        say(f"① KakaoTalk.exe: {exe_path}  버전 {ms >> 16}.{ms & 0xFFFF}.{ls >> 16}.{ls & 0xFFFF}")
    except Exception as e:
        say(f"① KakaoTalk.exe: {exe_path}  (버전 조회 실패: {e})")
else:
    say("① 카톡이 실행 중이 아닙니다 — 카톡 PC를 켜고 로그인한 뒤 다시 실행하세요")
    io = open(OUT, "w", encoding="utf-8"); io.write("\n".join(LINES)); io.close()
    sys.exit(1)

# ② 창 목록
say()
say("② 카톡 창 목록 (보이는 창만)")
wins = []


def _enum(h, _):
    if not win32gui.IsWindowVisible(h):
        return
    try:
        _, pid = win32process.GetWindowThreadProcessId(h)
        if psutil.Process(pid).name().lower() != "kakaotalk.exe":
            return
    except Exception:
        return
    cls = win32gui.GetClassName(h)
    title = win32gui.GetWindowText(h)
    l, t, r, b = win32gui.GetWindowRect(h)
    wins.append((h, cls, title, (l, t, r - l, b - t)))


win32gui.EnumWindows(_enum, None)
for h, cls, title, rect in wins:
    say(f"   hwnd={h:>8}  class={cls:<22} size={rect[2]}x{rect[3]}  title={title!r}")

# 메인 창 추정: 제목이 '카카오톡'이거나 가장 큰 EVA_Window_Dblclk 중 방 창이 아닌 것
main = None
for h, cls, title, rect in wins:
    if title.strip() in ("카카오톡", "KakaoTalk") and cls == "EVA_Window_Dblclk":
        main = h
        break
if main is None:
    cands = [w for w in wins if w[1] == "EVA_Window_Dblclk"]
    if cands:
        main = max(cands, key=lambda w: w[3][2] * w[3][3])[0]
say(f"   → 메인 창으로 추정: hwnd={main}  title={win32gui.GetWindowText(main)!r}" if main else "   → 메인 창을 못 찾음")

# ③ UIA 트리
say()
say("③ 메인 창 UIA 요소 트리 (깊이 7, 최대 350줄)")
try:
    uia = ensure("uiautomation")
    count = 0

    def walk(ctrl, depth=0):
        global count
        if count >= 350 or depth > 7:
            return
        try:
            r = ctrl.BoundingRectangle
            rect = f"({r.left},{r.top} {r.width()}x{r.height()})"
        except Exception:
            rect = "(?)"
        name = (ctrl.Name or "").replace("\n", " ")[:40]
        aid = getattr(ctrl, "AutomationId", "") or ""
        cls = getattr(ctrl, "ClassName", "") or ""
        say(f"   {'  ' * depth}{ctrl.ControlTypeName:<16} name={name!r:<44} id={aid!r:<18} cls={cls!r:<22} {rect}")
        count += 1
        for ch in ctrl.GetChildren():
            walk(ch, depth + 1)

    if main:
        root = uia.ControlFromHandle(main)
        walk(root)
    else:
        say("   메인 창이 없어 건너뜀")
except Exception as e:
    say(f"   UIA 조회 실패: {e}")

# ④ 단축키 실측 — 메인 창을 앞으로, 키를 누르고 새로 생긴 창 제목을 기록, Esc로 닫는다
say()
say("④ 단축키 실측 (메인 창에서 Ctrl+F · Ctrl+E · Ctrl+K · Ctrl+Tab 순서, 각각 Esc로 닫음)")
try:
    pyautogui = ensure("pyautogui")
    pyautogui.FAILSAFE = False
    if main:
        try:
            win32gui.ShowWindow(main, win32con.SW_RESTORE)
            win32gui.SetForegroundWindow(main)
        except Exception as e:
            say(f"   메인 창 앞으로 가져오기 실패: {e} — 마우스로 카톡 메인 창을 한 번 클릭한 뒤 다시 실행")
        time.sleep(0.8)
        before = {w[0] for w in wins}
        for combo in (("ctrl", "f"), ("ctrl", "e"), ("ctrl", "k"), ("ctrl", "tab")):
            pyautogui.hotkey(*combo)
            time.sleep(0.9)
            fg = win32gui.GetForegroundWindow()
            now = []
            win32gui.EnumWindows(lambda h, _: now.append(h) if win32gui.IsWindowVisible(h) else None, None)
            new = [h for h in now if h not in before]
            new_titles = [f"{win32gui.GetClassName(h)}:{win32gui.GetWindowText(h)!r}" for h in new if win32gui.GetWindowText(h)]
            say(f"   {'+'.join(combo):<9} → 앞창 {win32gui.GetWindowText(fg)!r} ({win32gui.GetClassName(fg)})  새 창: {new_titles or '없음'}")
            # 포커스 요소 이름(검색창이 떴으면 여기 보인다)
            try:
                fe = uia.GetFocusedControl()
                say(f"             포커스: {fe.ControlTypeName} name={(fe.Name or '')[:40]!r} id={getattr(fe, 'AutomationId', '')!r}")
            except Exception:
                pass
            pyautogui.press("esc")
            time.sleep(0.5)
except Exception as e:
    say(f"   단축키 실측 실패: {e}")

say()
say(f"저장: {OUT}")
with open(OUT, "w", encoding="utf-8") as f:
    f.write("\n".join(LINES))
