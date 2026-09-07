# -*- coding: utf-8 -*-
"""
카톡 발송 릴레이 — 봇이 못 보내고 쌓인 메시지를 PC 카톡이 대신 보낸다 (2026-09-02)

왜 필요한가: 메신저봇은 안드로이드 '알림 답장' 통로를 쓰는데, 방에 하루~주말 동안 대화가 없으면
그 방의 알림 세션이 만료돼 봇이 글을 못 올린다. 그래서 아침마다 누군가 "봇테스트"를 쳐 줘야
방이 살아나는 불편이 있었다(실사용 컴플레인).

이 스크립트는 outbox에 3분 넘게 남아 있는(=봇이 못 가져간) 메시지를 찾아,
카톡 PC의 해당 방 창에 직접 붙여넣어 보낸다. 부수 효과가 핵심이다:
**PC가 보낸 메시지가 방에 올라가는 순간 봇 폰에 알림이 떠서 봇 세션도 되살아난다.**
즉 다음 메시지부터는 봇이 다시 알아서 보낸다 — 아침 "봇테스트" 수동 작업을 대체한다.

조건: PC가 켜져 있고 카톡 PC 로그인 + 대상 방이 별도 창으로 열려 있어야 한다.
      (창이 없는 방은 건너뛰고 로그만 남긴다 — outbox에 남아 있으니 유실은 없다)
작업 스케줄러: 5분마다 실행 (register_relay_task.ps1)
"""
import json
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

# 창 찾기·클립보드·붙여넣기는 포스터 전송기와 같은 부품을 쓴다
from poster_send import REST, SUPABASE_ANON, find_room_window, log, paste_and_send, set_clipboard_text

STALE_SECONDS = 180  # 봇 폴링(7초)의 넉넉한 배수 — 이보다 오래 남았으면 봇이 못 보내는 상태다


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


def main() -> int:
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=STALE_SECONDS)).strftime("%Y-%m-%dT%H:%M:%S")
    rows = rest_call(f"/outbox?select=id,room,text,created_at&created_at=lt.{cutoff}&order=created_at.asc&limit=20") or []
    if not rows:
        return 0  # 적체 없음 — 봇이 잘 돌고 있다 (로그도 남기지 않는다: 5분마다 도는 조용한 파수꾼)

    log("=" * 64)
    log(f"outbox 적체 {len(rows)}건 — 봇 대신 PC가 발송 시도")
    sent = 0
    for row in rows:
        room = str(row.get("room") or "").strip()
        text = str(row.get("text") or "")
        if not room or not text:
            continue
        hwnd, title = find_room_window(room)
        if not hwnd:
            log(f"  ✗ [{room}] 창이 안 열려 있음 — 건너뜀 (outbox에 유지)")
            continue
        set_clipboard_text(text)
        if paste_and_send(hwnd, room, 0.9):
            try:
                rest_call(f"/outbox?id=eq.{urllib.parse.quote(str(row['id']))}", method="DELETE")
                sent += 1
                log(f"  ✓ [{title}] 발송 + outbox 정리 — 이 방의 봇 세션도 이 메시지로 되살아난다")
            except Exception as e:
                log(f"  ⚠ [{title}] 발송했으나 outbox 정리 실패: {e} — 봇이 중복 발송할 수 있음")
        else:
            log(f"  ✗ [{title}] 붙여넣기 실패")
    log(f"끝 · 대신 발송 {sent}/{len(rows)}건")
    return 0


if __name__ == "__main__":
    sys.exit(main())
