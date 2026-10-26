# -*- coding: utf-8 -*-
"""
카톡 발송 릴레이 — 봇이 못 보내고 쌓인 메시지를 PC 카톡이 대신 보낸다 (2026-09-02)

왜 필요한가: 메신저봇은 안드로이드 '알림 답장' 통로를 쓰는데, 방에 하루~주말 동안 대화가 없으면
그 방의 알림 세션이 만료돼 봇이 글을 못 올린다. 그래서 아침마다 누군가 "봇테스트"를 쳐 줘야
방이 살아나는 불편이 있었다(실사용 컴플레인).

이 스크립트는 outbox에 2분 넘게 남아 있는(=봇이 못 가져간) 메시지를 찾아,
카톡 PC의 해당 방 창에 직접 붙여넣어 보낸다. 부수 효과가 핵심이다:
**PC가 보낸 메시지가 방에 올라가는 순간 봇 폰에 알림이 떠서 봇 세션도 되살아난다.**
즉 다음 메시지부터는 봇이 다시 알아서 보낸다 — 아침 "봇테스트" 수동 작업을 대체한다.

조건: PC가 켜져 있고 카톡 PC 로그인 + 대상 방이 별도 창으로 열려 있어야 한다.
      (창이 없는 방은 건너뛰고 로그만 남긴다 — outbox에 남아 있으니 유실은 없다)
작업 스케줄러: 1분마다 실행 (register_relay_task.ps1) — 노트북 실행기(worker.py)가 돌면 그쪽이 1분마다 대신 부른다
"""
import json
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

# 창 찾기·클립보드·붙여넣기는 포스터 전송기와 같은 부품을 쓴다
from poster_send import REST, SUPABASE_ANON, find_room_window, log, paste_and_send, set_clipboard_text
from open_room import login_window, open_room, restart_kakao  # 창이 없으면 방 이름으로 검색해 연다(2026-10-17, 카톡 26.8 실측)

STALE_SECONDS = 120  # 봇 폴링(7초)의 넉넉한 배수 — 이보다 오래 남았으면 봇이 못 보내는 상태다 (2026-10-17: 180→120, 실행기 1분 주기와 함께 조용한 방도 3분 안에)


def rest_call(path: str, method: str = "GET", body: dict | None = None):
    req = urllib.request.Request(
        REST + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + SUPABASE_ANON,
            "apikey": SUPABASE_ANON,
            "Prefer": "return=minimal",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        raw = res.read().decode()
    return json.loads(raw) if raw.strip().startswith(("[", "{")) else None


_open_tried: dict[str, float] = {}  # 방별 마지막 "검색해서 열기" 시도 — 10분에 한 번만(못 여는 방을 1분마다 두드리지 않게)
_open_fail_streak = 0  # 연속 열기 실패 횟수(어느 방이든) — 3번(≈30분)이면 카톡이 렉 걸린 것으로 보고 재시작(2026-10-18 아침 ERP방 8번 연속 실패 → 1시간 22분 지연)
_kakao_restarted_at = 0.0  # 재시작은 1시간에 한 번만
RESTART_AFTER_FAILS = 3

# 야간 발송 금지 — 22:00~08:00(KST, PC 시간)엔 보내지 않고 들고 있다가 08:00 이후 첫 1분에 보낸다(2026-10-22 00:06 영업확장성미션방 심야 발송 뒤 요청)
QUIET_START_HOUR = 22
QUIET_END_HOUR = 8
_quiet_logged_at = 0.0
_login_logged_at = 0.0


KST = timezone(timedelta(hours=9))
MAX_ROOMS_PER_RUN = 3  # 한 번(1분)에 보내는 방 수 상한 — 08:00 직후 밤새 밀린 글이 한꺼번에 몰려 창이 쌓이면 카톡이 죽는다(10/19 08:02 사례, 방지훈 검토 2026-10-22)


TEST_ROOM = "테스트 전용방"  # 앱 TEST_MODE 가 보내는 방(src/api.ts, app_config TEST_ROOM 기본값) — 야간에도 보내는 유일한 방


def is_test_room(room: str) -> bool:
    return "".join(room.split()) == "".join(TEST_ROOM.split())  # 봇 roomKey(\s+ 제거)와 같은 기준


def in_quiet_hours(now: datetime | None = None) -> bool:
    h = (now or datetime.now(KST)).hour  # PC 시간대 설정과 상관없이 KST(폰 봇과 같은 기준)
    return h >= QUIET_START_HOUR or h < QUIET_END_HOUR
_quiet_until: dict[str, float] = {}  # 방별 "창 없음" 로그를 30분에 한 번만 — 1분 주기로 돌면서 같은 줄이 쌓이던 것(2026-10-17 노트북 첫 가동)


def _should_log_missing(room: str) -> bool:
    import time
    now = time.time()
    if _quiet_until.get(room, 0) > now:
        return False
    _quiet_until[room] = now + 30 * 60
    return True


def report_pc_send(room: str) -> None:
    """방별 마지막 활동(room_activity)에 'pc_send' 로 기록 — FIELD 관리 탭 '카톡 발송 현황'이 누가 보냈는지 보여 준다. 실패해도 무시"""
    try:
        req = urllib.request.Request(
            REST + "/room_activity", method="POST",
            data=json.dumps({"room": room, "last_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "source": "pc_send"}).encode(),
            headers={"Content-Type": "application/json", "Authorization": "Bearer " + SUPABASE_ANON, "apikey": SUPABASE_ANON, "Prefer": "resolution=merge-duplicates,return=minimal"},
        )
        urllib.request.urlopen(req, timeout=15).read()
    except Exception as e:
        log(f"  (room_activity 기록 실패: {e})")


def main() -> int:
    global _open_fail_streak, _kakao_restarted_at
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=STALE_SECONDS)).strftime("%Y-%m-%dT%H:%M:%S")
    # 야간엔 테스트 전용방 글만 조회(실제 방 글이 20건 넘게 쌓이면 테스트방 글이 limit 밖으로 밀리던 것 — 방지훈 2026-10-27)
    from urllib.parse import quote as _q
    room_filter = f"&room=eq.{_q(TEST_ROOM)}" if in_quiet_hours() else ""
    rows = rest_call(f"/outbox?select=id,room,text,created_at&created_at=lt.{cutoff}{room_filter}&order=created_at.asc&limit=20") or []
    if not rows:
        return 0  # 적체 없음 — 봇이 잘 돌고 있다 (로그도 남기지 않는다: 1분마다 도는 조용한 파수꾼)

    import time as _t

    global _quiet_logged_at, _login_logged_at
    if in_quiet_hours():
        # 테스트 전용방으로 가는 글만 밤에도 보낸다(2026-10-27 사용자 "22~08시 해두니 테스트하기 어렵다") — 실제 방은 그대로 08:00 이후
        held = [r for r in rows if not is_test_room(str(r.get("room") or ""))]
        rows = [r for r in rows if is_test_room(str(r.get("room") or ""))]
        if held and _t.time() - _quiet_logged_at > 3600:
            _quiet_logged_at = _t.time()
            log(f"  🌙 야간({QUIET_START_HOUR:02d}:00~{QUIET_END_HOUR:02d}:00) — 밀린 글 {len(held)}건은 {QUIET_END_HOUR:02d}:00 이후에 보낸다 (이 줄은 1시간에 한 번)")
        if not rows:
            return 0
    if login_window():
        try:
            from kakao_login import auto_login  # 저장된 봇 계정으로 대신 로그인(10분에 한 번)

            auto_login()
        except Exception as e:
            log(f"  자동 로그인 오류: {e}")
    if login_window():
        if _t.time() - _login_logged_at > 1800:
            _login_logged_at = _t.time()
            log(f"  ✗ 카톡이 로그인 화면 — 봇 계정으로 로그인해야 밀린 글 {len(rows)}건을 보낼 수 있다 (재시작해도 소용없어 기다린다 · 이 줄은 30분에 한 번)")
        return 0

    # 창이 열려 있는 방만 추린다 — 창 없는 방은 30분에 한 번만 로그(조용한 파수꾼)
    todo = []
    opened_here: list[int] = []  # 이번에 검색으로 연 창 — 보내고 나면 닫는다(창이 쌓이면 카톡이 대화 내용 불러오다 죽는다 — 2026-10-17 노트북 실측)
    for row in rows:
        room = str(row.get("room") or "").strip()
        text = str(row.get("text") or "")
        if not room or not text:
            continue
        hwnd, title = find_room_window(room)
        if not hwnd:
            if _open_tried.get(room, 0) < _t.time() - 10 * 60:
                _open_tried[room] = _t.time()
                log(f"  [{room}] 창이 없어 방 이름으로 검색해 열어 봅니다")
                try:
                    if open_room(room):
                        hwnd, title = find_room_window(room)
                        if hwnd:
                            opened_here.append(hwnd)
                except Exception as e:
                    log(f"    열기 실패: {e}")
                if hwnd:
                    _open_fail_streak = 0
                else:
                    _open_fail_streak += 1
                    fail = getattr(open_room, "last_fail", "")
                    hung = fail == "hung"
                    if fail in ("login", "nokakao"):
                        _open_fail_streak = 0  # 로그인 화면·카톡 꺼짐은 재시작으로 못 고친다 — 사람이 로그인할 때까지 기다린다
                    elif (hung or _open_fail_streak >= RESTART_AFTER_FAILS) and _t.time() - _kakao_restarted_at > 3600:
                        _kakao_restarted_at = _t.time()
                        if restart_kakao("응답 없음" if hung else f"방 열기 {_open_fail_streak}번 연속 실패"):
                            _open_fail_streak = 0
                            _open_tried[room] = 0  # 다음 분에 바로 다시 시도
        if not hwnd:
            if _should_log_missing(room):
                log(f"  ✗ [{room}] 창이 안 열려 있음 — 카톡 PC에서 그 방을 더블클릭해 창으로 열어 두면 다음 1분 안에 보냅니다 (이 줄은 30분에 한 번만 적습니다)")
            continue
        todo.append((row, room, text, hwnd, title))
        if len(todo) >= MAX_ROOMS_PER_RUN:
            break  # 나머지는 다음 1분에
    if not todo:
        return 0
    log("=" * 64)
    log(f"outbox 적체 {len(rows)}건 중 창이 열린 {len(todo)}건 — 봇 대신 PC가 발송 시도")
    sent = 0
    for i, (row, room, text, hwnd, title) in enumerate(todo):
        if i:
            import time as _t2
            _t2.sleep(2.0)  # 방 사이 텀 — 연달아 보내면 카톡이 죽는다(2026-10-19)
        set_clipboard_text(text)
        if paste_and_send(hwnd, room, 0.9):
            try:
                rest_call(f"/outbox?id=eq.{urllib.parse.quote(str(row['id']))}", method="DELETE")
                sent += 1
                report_pc_send(room)
                log(f"  ✓ [{title}] 발송 + outbox 정리 — 이 방의 봇 세션도 이 메시지로 되살아난다")
            except Exception as e:
                log(f"  ⚠ [{title}] 발송했으나 outbox 정리 실패: {e} — 봇이 중복 발송할 수 있음")
        else:
            log(f"  ✗ [{title}] 붙여넣기 실패")
    # 검색으로 열었던 창은 닫는다 — 사람이 미리 열어 둔 창은 그대로. 전송이 서버에 닿을 시간을 잠깐 준다
    if opened_here:
        import time as _t
        import win32con
        import win32gui
        _t.sleep(8.0)  # 보낸 직후 닫으면 카톡이 죽는다(2026-10-19 08:05 닫은 8초 뒤 크래시) — 전송이 완전히 끝날 시간을 넉넉히 준다
        closed = 0
        for h in opened_here:
            try:
                if win32gui.IsWindow(h):
                    win32gui.PostMessage(h, win32con.WM_CLOSE, 0, 0)
                    closed += 1
            except Exception:
                pass
        log(f"  검색으로 열었던 방 창 {closed}개 닫음(창을 쌓아 두지 않는다)")
    log(f"끝 · 대신 발송 {sent}/{len(todo)}건")
    return 0


if __name__ == "__main__":
    sys.exit(main())
