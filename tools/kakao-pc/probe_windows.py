"""카톡 PC 가 띄운 창 목록 — 읽기 전용 진단(키·클릭·메시지 쓰기 없음). 2026-10-28

왜: 대화 내보내기 "완료창"을 export_rooms.py 가 제목 '내보내기'로 못 찾았다(로그 "완료창 없음").
그 창의 실제 클래스·제목·크기·자식 글자를 보고 판정 규칙을 고친다.

사용(노트북, 완료창이 떠 있는 상태에서):
  python tools\\kakao-pc\\probe_windows.py
출력: 창마다 핸들 · 클래스 · 제목 · 위치/크기 · 소유 창 · 자식(클래스:글자) 앞 12개
"""
import sys


def main() -> int:
    try:
        import psutil
        import win32gui
        import win32process
    except ImportError as e:
        print(f"모듈 없음: {e} — pip install psutil pywin32")
        return 1

    def kids(h):
        out = []

        def cb(c, _):
            try:
                out.append(f"{win32gui.GetClassName(c)}:{win32gui.GetWindowText(c)[:30]!r}")
            except Exception:
                pass
            return True

        try:
            win32gui.EnumChildWindows(h, cb, None)
        except Exception:
            pass
        return out

    rows = []

    def f(h, _):
        if not win32gui.IsWindowVisible(h):
            return True
        try:
            pid = win32process.GetWindowThreadProcessId(h)[1]
            name = psutil.Process(pid).name()
        except Exception:
            return True
        if "kakao" not in name.lower():
            return True
        l, t, r, b = win32gui.GetWindowRect(h)
        owner = win32gui.GetWindow(h, 4)  # GW_OWNER
        rows.append((h, win32gui.GetClassName(h), win32gui.GetWindowText(h), (l, t, r - l, b - t), owner, kids(h)))
        return True

    win32gui.EnumWindows(f, None)
    if not rows:
        print("카톡 창이 하나도 안 보임 — 카톡 PC 가 켜져 있는지 확인")
        return 1
    for h, cls, title, rect, owner, ch in rows:
        print(f"{hex(h)} 클래스={cls!r} 제목={title!r} 위치·크기={rect} 소유={hex(owner) if owner else '-'}")
        print(f"    자식 {len(ch)}개: {', '.join(ch[:12]) or '없음'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
