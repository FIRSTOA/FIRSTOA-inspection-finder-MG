# -*- coding: utf-8 -*-
r"""
카톡 PC "대화 내용 저장"을 매일 자동으로 — 구글 드라이브 "카톡 자동적재 수신함"에 TXT 를 떨군다 (2026-10-23)

뒤는 이미 있다: apps-script/first-data/src/Drive.gs ingestFromDriveFolder 가 수신함의 TXT 를
방 이름(파일 첫 줄 "○○ 님과 카카오톡 대화")으로 분류해 증분 적재하고 "처리됨"/"확인필요"로 옮긴다.
빠진 것은 매일 저장 버튼을 누르는 손 — 이 스크립트가 그 손이다.

안전 원칙 (.claude/agents/kakao-pc-rules.md, docs/tasks/tab-search-kakao-history.md 5-1)
  · 방 창 안에서는 메뉴 클릭·좌표 클릭을 한 번도 하지 않는다. 채팅방 메뉴에는 "채팅방 나가기"가 있어 한 칸만 어긋나도
    봇이 업무방에서 나간다. 그래서 **단축키 하나(Ctrl+S)** 와 윈도 표준 저장 창만 쓴다.
    (클릭은 방을 열 때 open_room.py 가 메인 창에서 하는 실측 확정 순서뿐 — 사이드바·돋보기·검색칸·목록 더블클릭)
  · Ctrl+S 가 정말 "대화 내용 저장"인지는 추정이다 → 먼저 --probe 로 노트북에서 확인하고, 그 뒤에만
    실행기 스위치(FIRSTOA_KAKAO_EXPORT=1)를 켠다.
  · 창이 안 열린 방은 스스로 연다(2026-10-29 사용자 "21개 방 열어 놓고 가야 해? 지가 열어야지") — open_room.py 의
    검색칸+Ctrl+V·더블클릭 방식. 이번에 연 창만 저장이 끝난 뒤(완료창 닫힘·파일 확정 뒤 최소 8초) WM_CLOSE 로 닫는다.
    사람이 원래 열어 둔 창은 닫지 않는다. 우리가 연 창은 동시에 최대 1개 — 못 닫으면 그 뒤로 새 방은 열지 않는다.
    방 열기 실패가 로그인 화면·카톡 꺼짐이면 전체 중단, 그 밖은 그 방 실패(실패 3번이면 중단).
  · 키를 누르기 전마다 맨 앞 창을 확인한다. 아니면 그 자리에서 중단(키 안 누름).
  · Esc 는 "맨 앞 창이 카톡이 띄운 새 창(저장 창·확인창)"일 때만 누른다 — 방 창에 Esc 가 가면 방 창이 닫힐 수 있다.
  · 파일 이름 칸에는 클립보드 붙여넣기만(창 메시지로 글 넣기 금지 — 규칙 6). 붙여 넣은 뒤 클립보드를 비운다.
  · 같은 이름 파일이 있으면 덮어쓰지 않는다(미리 건너뛰고, 그래도 덮어쓰기 확인창이 뜨면 Esc).
  · Ctrl+A/F/E 를 쓰지 않는다. 파일 이름 칸 전체 선택은 EM_SETSEL(선택만, 표준 Edit 칸에서만) 뒤 WM_GETTEXT 로 읽어 확인한다.
  · 천천히, 한 번에 한 방(2026-10-27 사용자 실측: 큰 방은 기다려야 대화가 다 불러와지고, 여러 방을 한꺼번에 열면 튕긴다).
    방마다 (창 없으면 열기 약 5초) → 창을 앞으로 → 불러오기 대기 30초 + 카톡 응답 확인(없으면 5초 간격 최대 60초) → Ctrl+S → 저장 창(최대 15초)
    → 파일 크기가 15초 동안 안 변할 때까지(최대 300초, 파일이 늦게 생겨도) = "내보내기 완료" 신호
      (이때까지 완료창에는 아무 키도 안 누름 — 진행 중 Enter/Esc 는 내보내기를 취소할 수 있다)
    → 완료창(제목 없는 EVA_Window_Dblclk·방 창 소유·자식 0개·약 300×225, 2026-10-28 23:50 실측 — 제목·글자로는 못 찾는다)을
      찾아(최대 10초) 그 창이 맨 앞일 때만 Enter(기본 단추=확인)로 닫는다 → (이번에 연 창이면) 8초 뒤 WM_CLOSE·닫힘 확인
    → 방 사이 20초 → 다음 방. 전체 상한 120분(새 방을 시작하지 않는 기준).
    기대 이름 파일이 없으면 Ctrl+S 뒤 생긴 .txt(카톡 기본 이름)의 크기를 재고, 멈추면 기대 이름으로 바꾼다.
    조정: FIRSTOA_KAKAO_EXPORT_LOAD_WAIT · _DIALOG_WAIT · _DONE_WAIT · _GAP · _LIMIT · _CLOSE_WAIT(최소 8) (초). 동시에 두 개 안 돈다(뮤텍스 Local\FIRSTOA-KakaoExport).

사용법 (노트북 D6110 에서만 — 데스크톱에서 돌리지 않는다)
  python tools\kakao-pc\export_rooms.py --probe --room "방이름"     기본. Ctrl+S 뒤 뜨는 창만 기록하고 Esc (저장 안 함)
  python tools\kakao-pc\export_rooms.py --export --rooms "방이름"   그 방 하나만 실제 저장(첫 시험)
  python tools\kakao-pc\export_rooms.py --export                    Supabase kakao_collect_rooms(enabled·export=true) 방 전부(창 없으면 열어서)
                                                                     (표가 없거나 비면 room_map 의 점검·AS·물류·미수·불만·재계약 방 — 마감·부품·자가 제외)
  python tools\kakao-pc\export_rooms.py --list                      대상 방과 창 열림/안 열림(→ 열어서 저장 예정)만(키 안 누름)
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
MAX_FAILS = 3      # 실패 3번이면 그날은 중단


def env_seconds(name: str, default: float, lo: float = 0.0, hi: float = 3600.0) -> float:
    """환경 변수의 초 값 — 비었거나 숫자가 아니면 기본값, 범위 밖이면 lo~hi 로 자른다"""
    try:
        v = float(str(os.environ.get(name, "")).strip())
    except ValueError:
        return default
    if v != v:  # NaN
        return default
    return max(lo, min(hi, v))


# 2026-10-27 사용자 실측: "방마다 데이터가 커서 버벅이고, 조금 기다려야 전체 대화가 불러와진다. 한 번에 여러 방을 열면 분명히 튕긴다.
# 한 방을 천천히 끝내고 다음 방." → 불러오기 대기·저장 완료(파일 크기 멈춤) 확인·방 사이 텀을 넉넉히, 한 번에 한 방만.
# 2026-10-28 사용자: "방 들어가면 읽는 시간이 더 필요하고 저장도 파일이 커서 오래 걸린다. 방 내용 기다리기 30초, 저장 1분 정도로."
LOAD_WAIT = env_seconds("FIRSTOA_KAKAO_EXPORT_LOAD_WAIT", 30.0, 0, 300)  # 창을 앞으로 가져온 뒤 Ctrl+S 전 대기(대화 불러오기, 옛 10초)
RESPOND_MAX = 60.0       # 카톡 응답 없음이면 최대 이만큼 더 기다린다
RESPOND_EVERY = 5.0      # 그 사이 재확인 간격
EXPORT_WAIT = env_seconds("FIRSTOA_KAKAO_EXPORT_DIALOG_WAIT", 15.0, 3, 120)  # Ctrl+S 뒤 저장 창이 뜨기를 기다리는 시간(옛 3초)
SETTLE_STABLE = 15.0     # 저장 뒤 파일 크기가 이만큼 안 변해야 "쓰기 끝"(옛 10초)
SETTLE_MAX = 300.0       # 옛 이름 — 지금은 파일 확정 최대 대기에 DONE_WAIT 를 쓴다(값 같음)
# 카톡 "대화 내보내기" 완료창(2026-10-28 23:50 노트북 실측) — "100% 완료되었습니다." + [폴더열기] [확인].
#   클래스 EVA_Window_Dblclk(#32770 아님) · 제목 '' · 방 창 소유 · 자식 0개 — 제목·글자로 못 찾고, 완료 여부는 파일 크기 멈춤으로 본다
DONE_WAIT = env_seconds("FIRSTOA_KAKAO_EXPORT_DONE_WAIT", 300.0, 10, 1800)  # 저장 창이 닫힌 뒤 파일 크기가 멈추기까지 최대 대기(파일이 늦게 생기는 경우 포함)
# 완료창("100% 완료되었습니다 [폴더열기][확인]") — 2026-10-28 23:50 노트북 실측(probe_windows.py):
#   클래스 EVA_Window_Dblclk · 제목 '' · 300×225 · 소유 = 방 창 · 자식 0개(글자를 못 읽는다).
#   같은 클래스·제목 '' 의 광고 창(390×100, 자식 10개)은 메인 창 소유라 소유로 가른다 — 광고 창은 절대 건드리지 않는다.
DONE_POPUP_CLASS = "EVA_Window_Dblclk"
DONE_POPUP_W = (200, 500)
DONE_POPUP_H = (120, 400)
DONE_FIND_WAIT = 10.0    # 파일 확정 뒤 완료창을 다시 찾는 최대 시간
DONE_FIND_EVERY = 0.5
ROOM_GAP = env_seconds("FIRSTOA_KAKAO_EXPORT_GAP", 20.0, 3, 600)  # 방 사이 텀(옛 3초)
RUN_LIMIT = env_seconds("FIRSTOA_KAKAO_EXPORT_LIMIT", 7200.0, 60, 4 * 3600)  # 전체 상한 120분(2026-10-28 실측 한 방 3분+ → 21방 약 75~100분, 옛 60분·8분) — 실행기가 별도 프로세스로 띄워 심박은 계속 찍힌다(2026-10-27)
# 2026-10-29 방 스스로 열기 — 연 창은 저장이 끝나고 이만큼 쉰 뒤 닫는다(규칙: 보낸 직후 닫으면 카톡이 죽는다,
# outbox_relay 8초 — 2026-10-19 08:05 닫은 8초 뒤 크래시). 8초 밑으로는 못 내린다
CLOSE_WAIT = env_seconds("FIRSTOA_KAKAO_EXPORT_CLOSE_WAIT", 8.0, 8, 120)
CLOSE_CONFIRM = 5.0      # WM_CLOSE 뒤 창이 사라지기를 기다리는 최대 시간
OPEN_TYPICAL = 5.0       # 추정용 — open_room 한 번(검색·더블클릭·검색 닫기 2.5초 포함) 보통 시간
EXPORT_MUTEX = "Local\\FIRSTOA-KakaoExport"  # 한 번에 하나만 — worker.py 도 이 이름으로 "내보내기 중"을 안다
# 수집 표가 없을 때(404)·비었을 때 room_map 폴백으로 거르는 업무 종류 — 마감·부품·자가(토너)·칭찬 등은 수집 대상이 아니다(2026-10-24 설계)
DEFAULT_CATEGORIES = ("점검", "AS", "물류", "미수", "불만", "재계약")
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


def pick_collect_rooms(rows: list, categories: list | None = None) -> list:
    """kakao_collect_rooms 행들 → 방 이름 목록. enabled·export 가 둘 다 true 인 방만(null 이면 안 함),
    categories 를 주면 kinds(배열)와 하나라도 겹치는 방만. 중복 제거·표 순서 유지"""
    want = {c.strip() for c in (categories or []) if c and c.strip()}
    seen, out = set(), []
    for r in rows or []:
        r = r or {}
        room = str(r.get("room") or "").strip()
        if not room or room in seen or r.get("enabled") is not True or r.get("export") is not True:
            continue
        kinds = r.get("kinds") or []
        if isinstance(kinds, str):  # 혹시 '{점검,AS}' 문자열로 오면
            kinds = [k.strip() for k in kinds.strip("{}").split(",")]
        if want and not (want & {str(k).strip() for k in kinds}):
            continue
        seen.add(room)
        out.append(room)
    return out


def size_settled(samples: list, stable_secs: float = SETTLE_STABLE) -> bool:
    """[(시각, 크기)] — 크기가 0보다 크고 마지막 stable_secs 초 동안 그대로면 True. 파일이 없을 때 크기는 -1"""
    if not samples:
        return False
    last_t, last_size = samples[-1]
    if last_size <= 0:
        return False
    run_start = last_t
    for t, size in reversed(samples):
        if size != last_size:
            break
        run_start = t
    return last_t - run_start >= stable_secs


def fmt_kb(size: int) -> str:
    return f"{max(0, size) / 1024:,.0f} KB" if size >= 1024 else f"{max(0, size)} B"


EXPORT_TYPICAL = 60.0  # 추정용 — 카톡이 방 하나를 내보내는 데 걸리는 보통 시간(2026-10-28 사용자 "저장 1분 정도")


def estimate_minutes(n_rooms: int, load: float = LOAD_WAIT, dialog: float = EXPORT_WAIT, gap: float = ROOM_GAP,
                     write: float = EXPORT_TYPICAL + SETTLE_STABLE, n_open: int | None = None,
                     open_close: float = OPEN_TYPICAL + CLOSE_WAIT) -> float:
    """대략 걸리는 분 — 방마다 불러오기 + 저장 창(최대치) + 내보내기(완료창)·파일 확정 + 다음 방까지 텀(마지막 방 제외)
    + 스스로 연 방(n_open, 기본 = 전부)마다 열기·닫기 전 대기(open_close).
    기본값 21방 모두 열기 = 21×(30+15+75)+21×(5+8)+20×20 = 3,193초 ≈ 53.2분"""
    if n_rooms <= 0:
        return 0.0
    n_open = n_rooms if n_open is None else max(0, min(n_rooms, n_open))
    return round((n_rooms * (load + dialog + write) + n_open * open_close + (n_rooms - 1) * gap) / 60.0, 1)


def close_decision(opened_here: bool, exists: bool, unsettled: bool, n_owned: int) -> str:
    """저장 뒤 방 창을 닫을지 — 'close' / 'gone'(이미 없음) / 'keep:이유'.
    사람이 열어 둔 창은 절대 안 닫고, 아직 내보내는 중일 수 있는 창·소유 창(완료창·저장 창)이 남은 창도 안 닫는다
    (소유 창이 떠 있는데 방 창을 닫으면 내보내기 취소·카톡 비정상 종료 위험)"""
    if not opened_here:
        return "keep:원래 열려 있던 창"
    if not exists:
        return "gone"
    if unsettled:
        return "keep:파일이 안 멈춰 아직 내보내는 중일 수 있음"
    if n_owned > 0:
        return f"keep:완료창·저장 창 등 이 방 창의 팝업 {n_owned}개가 남음"
    return "close"


def is_save_dialog(cls: str, title: str, extra_titles: tuple = ()) -> bool:
    """윈도 표준 저장 창인가 — 클래스 #32770 + 제목에 저장 창 이름이 들어 있어야"""
    if cls != DIALOG_CLASS:
        return False
    t = str(title or "").strip().lower()
    return any(s.lower() in t for s in tuple(SAVE_TITLES) + tuple(extra_titles) if s)


def is_done_popup(cls: str, owner: int, room_hwnd: int, title: str, n_children: int, width: int, height: int) -> bool:
    """카톡 '대화 내보내기' 완료창인가 — 클래스 EVA_Window_Dblclk + 방 창 소유(메인 창 소유 광고 창 제외) + 제목 '' + 자식 0개 + 너비 200~500·높이 120~400.
    글자를 못 읽으므로 '완료' 여부는 이 창이 아니라 파일 크기 멈춤으로 판정한다(호출자)"""
    return (cls == DONE_POPUP_CLASS and bool(room_hwnd) and owner == room_hwnd and str(title or "") == ""
            and n_children == 0 and DONE_POPUP_W[0] <= width <= DONE_POPUP_W[1] and DONE_POPUP_H[0] <= height <= DONE_POPUP_H[1])


def file_unchanged(settled: tuple, now: tuple) -> bool:
    """Enter 직전 재확인 — settled=(크기, mtime) 은 _wait_file_settled 가 확정한 값, now 는 지금 잰 값.
    둘 다 있고 크기·mtime 이 같아야 True(파일이 사라졌거나 다시 커지면 카톡이 아직 쓰는 중일 수 있다 → 키 안 누름)"""
    if not settled or not now or settled[0] is None or now[0] is None:
        return False
    return settled[0] == now[0] and settled[0] > 0 and settled[1] == now[1]


def rooms_with_partial(rooms: list, names, ymd: str) -> set:
    """수신함 파일 이름들(names) 중 오늘 날짜 '<방>_YYYYMMDD.txt.partial' 이 있는 방 — 아직 내보내는 중일 수 있어 잔여 완료창을 건드리지 않는다"""
    have = set(names or ())
    return {r for r in (rooms or []) if export_file_name(r, ymd) + ".partial" in have}


def pick_default_name_file(entries: list, since: float, expected: str) -> str:
    """카톡 기본 이름으로 저장된 파일 찾기 — entries = [(이름, 수정 시각, 크기)].
    since(Ctrl+S 시각, 2초 여유) 이후 바뀐 .txt, 0바이트 아님, 기대 이름 아님 중 가장 최근 1개 → 이름(없으면 '')"""
    cand = [(m, n) for n, m, s in (entries or [])
            if str(n).lower().endswith(".txt") and n != expected and s and s > 0 and m >= since - 2.0]
    return max(cand)[1] if cand else ""


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
    assert pick_rooms(rows, list(DEFAULT_CATEGORIES)) == ["점검C방", "AS C방", "강북A/초과"]  # 마감 행은 빈 이름이라 어차피 빠짐
    assert pick_rooms([{"category": "마감", "room": "마감방"}, {"category": "부품", "room": "부품방"}, {"category": "점검", "room": "점검방"}],
                      list(DEFAULT_CATEGORIES)) == ["점검방"]
    crow = [{"room": "A 점검방", "kinds": ["점검"], "enabled": True, "export": True},
            {"room": "E 겸용방", "kinds": ["점검", "AS"], "enabled": True, "export": True},
            {"room": "완료방(납품,철수,교체)", "kinds": ["물류"], "enabled": True, "export": True},
            {"room": "꺼진방", "kinds": ["AS"], "enabled": False, "export": True},
            {"room": "매크로제외방", "kinds": ["AS"], "enabled": True, "export": False},
            {"room": "A 점검방", "kinds": ["점검"], "enabled": True, "export": True},
            {"room": "", "kinds": ["AS"], "enabled": True, "export": True},
            {"room": "null방", "kinds": ["AS"], "enabled": None, "export": True}]
    assert pick_collect_rooms(crow) == ["A 점검방", "E 겸용방", "완료방(납품,철수,교체)"]
    assert pick_collect_rooms(crow, ["AS"]) == ["E 겸용방"]
    assert pick_collect_rooms(crow, ["물류"]) == ["완료방(납품,철수,교체)"]
    assert pick_collect_rooms(crow, ["재계약"]) == []
    assert pick_collect_rooms(None) == []
    assert is_save_dialog("#32770", "다른 이름으로 저장")
    assert is_save_dialog("#32770", "Save As")
    assert not is_save_dialog("EVA_Window_Dblclk", "다른 이름으로 저장")
    assert not is_save_dialog("#32770", "채팅방 나가기")
    assert is_save_dialog("#32770", "내보내기", ("내보내기",))
    assert not size_settled([])
    assert not size_settled([(0, -1), (5, -1), (20, -1)])  # 파일 없음
    assert not size_settled([(0, 0), (20, 0)])  # 0바이트는 확정 아님
    assert size_settled([(0, 100), (5, 200), (10, 200), (15, 200)], 10)
    assert not size_settled([(0, 100), (5, 200), (10, 200), (14, 200)], 10)  # 9초만 멈춤
    assert not size_settled([(0, 200), (5, 300), (10, 300)], 10)  # 아직 크는 중
    assert size_settled([(0, -1), (3, 50), (13, 50)], 10)
    assert fmt_kb(2048) == "2 KB" and fmt_kb(10) == "10 B"
    assert estimate_minutes(0) == 0.0
    assert estimate_minutes(2, 10, 15, 20, 15, n_open=0) == round((2 * 40 + 20) / 60, 1)
    assert estimate_minutes(21, 30, 15, 20, 75, n_open=0) == 48.7  # 21방 창이 다 열려 있을 때
    assert estimate_minutes(21, 30, 15, 20, 75, n_open=21, open_close=13) == 53.2  # 21방 모두 스스로 열기(5초)·닫기 전 8초
    assert estimate_minutes(2, 10, 15, 20, 15, n_open=9, open_close=10) == round((2 * 40 + 2 * 10 + 20) / 60, 1)  # 방 수보다 많이 못 엶
    assert close_decision(True, True, False, 0) == "close"
    assert close_decision(False, True, False, 0).startswith("keep:")  # 사람이 열어 둔 창
    assert close_decision(True, False, False, 0) == "gone"
    assert close_decision(True, True, True, 0).startswith("keep:")  # 아직 내보내는 중
    assert close_decision(True, True, False, 1).startswith("keep:")  # 완료창 남음
    # 2026-10-28 23:50 노트북 실측 4줄(probe_windows.py) — 방 창 0x1006b6, 메인 창 0x202ea
    room, main = 0x1006B6, 0x202EA
    assert is_done_popup("EVA_Window_Dblclk", room, room, "", 0, 300, 225)  # 0xd06d8 완료창
    assert not is_done_popup("EVA_Window_Dblclk", 0, room, "강남C 점검방", 4, 380, 640)  # 방 창
    assert not is_done_popup("EVA_Window_Dblclk", main, room, "", 10, 390, 100)  # 광고 창(메인 창 소유)
    assert not is_done_popup("EVA_Window_Dblclk", 0, room, "카카오톡", 30, 490, 1020)  # 메인 창
    assert not is_done_popup("EVA_Window_Dblclk", main, room, "", 0, 300, 225)  # 크기·자식이 같아도 메인 창 소유면 아님
    assert not is_done_popup("#32770", room, room, "", 0, 300, 225)  # 표준 대화 상자(확인창)는 아님
    assert not is_done_popup("EVA_Window_Dblclk", 0, 0, "", 0, 300, 225)  # 방 창 핸들 없음
    assert not is_done_popup("EVA_Window_Dblclk", room, room, "", 1, 300, 225)  # 자식 있음
    assert not is_done_popup("EVA_Window_Dblclk", room, room, "", 0, 300, 450)  # 너무 큼
    assert file_unchanged((14773 * 1024, 100.5), (14773 * 1024, 100.5))
    assert not file_unchanged((100, 100.5), (120, 101.0))  # 다시 커짐
    assert not file_unchanged((100, 100.5), (100, 101.0))  # 크기 같아도 mtime 바뀜
    assert not file_unchanged((100, 100.5), (None, None))  # 사라짐
    assert not file_unchanged((0, 1.0), (0, 1.0))  # 0바이트
    assert rooms_with_partial(["강남C 점검방", "AS C방"], ["강남C 점검방_20261028.txt.partial", "AS C방_20261028.txt"], "20261028") == {"강남C 점검방"}
    assert rooms_with_partial(["강남C 점검방"], ["강남C 점검방_20261027.txt.partial"], "20261028") == set()  # 어제 것은 아님
    ents = [("강남C 점검방_20261028.txt", 50.0, 0), ("KakaoTalk_20261028_2315.txt", 200.0, 5000),
            ("옛파일.txt", 10.0, 900), ("KakaoTalk_빈.txt", 210.0, 0), ("사진.png", 220.0, 10), ("다른.txt", 150.0, 30)]
    assert pick_default_name_file(ents, 100.0, "강남C 점검방_20261028.txt") == "KakaoTalk_20261028_2315.txt"
    assert pick_default_name_file(ents, 300.0, "x.txt") == ""
    assert pick_default_name_file([("기대.txt", 200.0, 10)], 100.0, "기대.txt") == ""
    os.environ["FIRSTOA_KAKAO_TEST_SEC"] = "abc"
    assert env_seconds("FIRSTOA_KAKAO_TEST_SEC", 7.0) == 7.0
    os.environ["FIRSTOA_KAKAO_TEST_SEC"] = "9999"
    assert env_seconds("FIRSTOA_KAKAO_TEST_SEC", 7.0, 0, 300) == 300
    os.environ["FIRSTOA_KAKAO_TEST_SEC"] = " 25 "
    assert env_seconds("FIRSTOA_KAKAO_TEST_SEC", 7.0) == 25.0
    del os.environ["FIRSTOA_KAKAO_TEST_SEC"]
    assert env_seconds("FIRSTOA_KAKAO_TEST_SEC", 7.0) == 7.0
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


FALLBACK_NOTE = ""  # room_map 폴백이 일어났으면 그 이유 — 실행 마지막 줄에 한 번 더 적는다(worker 상태 tail 4줄에 실리게)


def load_rooms(categories: list | None, from_room_map: bool = False) -> list:
    """대상 방 — 기본은 kakao_collect_rooms(export=true 방). 표가 없거나(404) 비면 room_map 폴백(점검·AS·물류·미수·불만·재계약만).
    표에 행이 있는데 export=true 가 하나도 없으면 폴백하지 않는다(관리 탭에서 일부러 다 끈 것)"""
    import urllib.error

    global FALLBACK_NOTE
    from outbox_relay import rest_call  # 같은 anon REST 도우미
    from poster_send import log

    if not from_room_map:
        try:
            rows = rest_call("/kakao_collect_rooms?select=room,kinds,enabled,export&order=room.asc") or []
            if rows:
                picked = pick_collect_rooms(rows, categories)
                if not picked:
                    n_exp = sum(1 for r in rows if (r or {}).get("enabled") is True and (r or {}).get("export") is True)
                    log(f"    [내보내기] 표에 행 {len(rows)}개, export=true {n_exp}개{' (--category 적용 뒤 0)' if categories else ''} — 저장 안 함")
                return picked
            FALLBACK_NOTE = "표가 비었거나 권한 없음(RLS) — room_map 으로 대신"  # 200+빈 배열은 빈 표와 RLS 차단을 구분할 수 없다(count 도 보이는 행만 셈)
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
            FALLBACK_NOTE = "표가 없음(404) — room_map 으로 대신"
        if from_room_map is False:
            log(f"    [내보내기] kakao_collect_rooms {FALLBACK_NOTE}")
        FALLBACK_NOTE = FALLBACK_NOTE and "[내보내기] 폴백: kakao_collect_rooms " + FALLBACK_NOTE
    rows = rest_call("/room_map?select=category,region,room&order=category.asc,region.asc") or []
    return pick_rooms(rows, categories or list(DEFAULT_CATEGORIES))


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


def _edit_text(h: int) -> str:
    """표준 Edit 칸의 글을 읽기만 한다(WM_GETTEXT — 읽기 전용. WM_SETTEXT 는 쓰지 않는다)"""
    import ctypes

    try:
        n = ctypes.windll.user32.SendMessageW(h, 0x000E, 0, 0)  # WM_GETTEXTLENGTH
        buf = ctypes.create_unicode_buffer(int(n) + 2)
        ctypes.windll.user32.SendMessageW(h, 0x000D, int(n) + 1, buf)  # WM_GETTEXT
        return buf.value
    except Exception:
        return ""


def _select_all_in_edit(h: int) -> None:
    """윈도 표준 저장 창(comdlg32)의 파일 이름 Edit 칸 글 전체 선택 — EM_SETSEL(0, -1).
    2026-10-28 노트북 실측: End → Shift+Home 키가 먹지 않아 붙여넣기가 카톡 기본 이름 앞에 끼어
    '방이름_날짜.txtKakaoTalk_…_group.txt' 로 저장됐다. 키 대신 선택 메시지를 쓴다(글을 바꾸는 WM_SETTEXT 아님 — 선택만).
    카톡이 그린 창이 아니라 윈도 표준 대화 상자의 Edit 이라 카톡 힙과 무관."""
    import ctypes

    try:
        ctypes.windll.user32.SendMessageW(h, 0x00B1, 0, -1)  # EM_SETSEL
    except Exception:
        pass


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


# ── 완료창(제목 없는 EVA 팝업, 방 창 소유) ───────────────────────
def _alive(h: int) -> bool:
    import win32gui

    try:
        return bool(h) and bool(win32gui.IsWindow(h)) and bool(win32gui.IsWindowVisible(h))
    except Exception:
        return False


def _child_count(hwnd: int, limit: int = 50) -> int:
    """자식 창 수(보이지 않는 것 포함 — probe_windows.py 와 같은 기준). 읽기만"""
    import win32gui

    out = [0]

    def cb(h, _):
        out[0] += 1
        return out[0] < limit

    try:
        win32gui.EnumChildWindows(hwnd, cb, None)
    except Exception:
        pass
    return out[0]


def _popup_matches(h: int, room_hwnd: int) -> bool:
    """실제 창 h 가 room_hwnd 소유의 완료창 조건(is_done_popup)에 맞는가 — 읽기만"""
    import win32gui

    try:
        left, top, right, bottom = win32gui.GetWindowRect(h)
        return is_done_popup(win32gui.GetClassName(h), win32gui.GetWindow(h, 4), room_hwnd,  # 4 = GW_OWNER
                             win32gui.GetWindowText(h), _child_count(h), right - left, bottom - top)
    except Exception:
        return False


def _done_popups(room_hwnd: int, pid: int, before=frozenset()) -> list:
    """같은 pid 의 보이는 최상위 창 중 before 에 없던, room_hwnd 소유 완료창들(EnumWindows 순서)"""
    import win32gui

    out = []

    def cb(h, _):
        try:
            if h not in before and win32gui.IsWindowVisible(h) and _pid(h) == pid and _popup_matches(h, room_hwnd):
                out.append(h)
        except Exception:
            pass
        return True

    try:
        win32gui.EnumWindows(cb, None)
    except Exception:
        pass
    return out


def _find_done_popup(room_hwnd: int, pid: int, before) -> int:
    """Ctrl+S 직전 스냅샷(before)에 없던 완료창 1개(여러 개면 목록 마지막) → hwnd 또는 0"""
    wins = _done_popups(room_hwnd, pid, before)
    return wins[-1] if wins else 0


def _enter_close_done_popup(h: int, room_hwnd: int, file_check=None) -> str:
    """완료창을 Enter(기본 단추=확인)로 닫는다 — 클릭·좌표 없음. **파일 크기가 멈춘 뒤에만 부른다**(진행 중 Enter/Esc 는 취소 위험).
    맨 앞이 그 창(조건 재확인)일 때만 누른다. 아니면 SetForegroundWindow 1회 → 재확인 → 그래도 아니면 안 누름.
    file_check=(경로, 크기, mtime) 이면 Enter 직전 그 파일을 다시 재서 다르면 안 누른다(방지훈 2026-10-28 ②A).
    → 'closed' / 'notfront'(안 누름) / 'changed'(파일이 아직 변함, 안 누름) / 'stuck'(눌렀는데 3초 안에 안 닫힘)"""
    import pyautogui
    import win32gui

    if _fg()[0] != h:
        try:
            win32gui.SetForegroundWindow(h)
        except Exception:
            pass
        time.sleep(0.4)
    if _fg()[0] != h or not _popup_matches(h, room_hwnd):
        return "notfront"
    if file_check and not file_unchanged((file_check[1], file_check[2]), _file_stamp(file_check[0])):
        return "changed"
    pyautogui.press("enter")
    end = time.time() + 3.0
    while time.time() < end:
        time.sleep(0.25)
        if not _alive(h):
            return "closed"
    return "stuck"


def _close_done_popup_after_settle(room_hwnd: int, pid: int, before, file_check: tuple) -> str:
    """파일 확정 뒤 — 완료창을 찾아(최대 DONE_FIND_WAIT, 0.5초 간격) 닫는다. file_check=(경로, 크기, mtime) 은 Enter 직전 재확인용 → 로그 조각"""
    from poster_send import log

    end = time.time() + DONE_FIND_WAIT
    h = _find_done_popup(room_hwnd, pid, before)
    while not h and time.time() < end:
        time.sleep(DONE_FIND_EVERY)
        h = _find_done_popup(room_hwnd, pid, before)
    if not h:
        return "완료창 없음"
    status = _enter_close_done_popup(h, room_hwnd, file_check)
    if status == "closed":
        return "완료창 Enter 닫음"
    if status == "changed":
        _UNSETTLED_ROOMS.add(room_hwnd)  # 아직 쓰는 중일 수 있다 — 방 사이 잔여 정리에서도 건드리지 않는다
        log("    [내보내기]   Enter 직전 파일 크기·수정 시각이 확정 값과 다름 — Enter 안 누름, 창은 남겨 둠")
        return "완료창 남김(파일이 아직 변함)"
    if status == "notfront":
        log(f"    [내보내기]   완료창이 맨 앞이 아님(맨 앞 '{_fg()[2]}') — Enter 안 누름, 창은 남겨 둠")
        return "완료창 남김(맨 앞 아님)"
    log("    [내보내기]   완료창에 Enter 를 눌렀지만 3초 안에 안 닫힘 — 창은 남겨 둠")
    return "완료창 남김(Enter 뒤 안 닫힘)"


# 이번 실행에서 파일이 끝까지 안 멈춘 방 창 — 카톡이 아직 내보내는 중일 수 있어 그 방 완료창에는 키를 누르지 않는다
_UNSETTLED_ROOMS: set = set()


def _close_leftover_done_popups(rooms: list, folder: str, ymd: str) -> int:
    """시작 때·방 사이 — 열려 있는 대상 방 창 소유의 완료창이 남아 있으면 닫는다(맨 앞일 때만 Enter, 앞으로 가져오기 1회).
    뮤텍스로 우리 내보내기는 지금 돌고 있지 않으므로 완료된 잔여로 본다. 단 이번 실행에서 파일이 안 멈춘 방은 건드리지 않는다.
    수신함에 오늘 날짜 '<방>_YYYYMMDD.txt.partial' 이 있는 방도 건너뛴다(아직 내보내는 중일 수 있음, 방지훈 2026-10-28 ②B).
    못 닫으면 로그만 — 그 방도 진행한다(소유 방이 달라 겹치지 않는다). → 닫은 수"""
    from poster_send import find_room_window, log

    try:
        partial = rooms_with_partial(rooms, os.listdir(folder), ymd)
    except OSError:
        partial = set()
    n = 0
    seen = set()
    for room in rooms:
        rh, _ = find_room_window(room)
        if not rh or rh in seen:
            continue
        seen.add(rh)
        wins = _done_popups(rh, _pid(rh))
        if not wins:
            continue
        if rh in _UNSETTLED_ROOMS or room in partial:
            log(f"    [내보내기]   [{room}] 완료창이 남았지만 파일이 아직 안 멈췄던 방(.partial) — 키 안 누름")
            continue
        for h in wins:
            status = _enter_close_done_popup(h, rh)
            if status == "closed":
                n += 1
            else:
                log(f"    [내보내기]   [{room}] 남은 완료창 못 닫음({'맨 앞 아님' if status == 'notfront' else 'Enter 뒤 안 닫힘'}) — 로그만, 진행")
    return n


def _default_name_candidate(folder: str, path: str, since: float) -> str:
    """수신함에서 Ctrl+S 뒤 생긴 .txt(카톡 기본 이름, 기대 이름 아님) 전체 경로 — 없으면 ''"""
    try:
        names = os.listdir(folder)
    except OSError:
        return ""
    ents = []
    for n in names:
        try:
            st = os.stat(os.path.join(folder, n))
            ents.append((n, st.st_mtime, st.st_size))
        except OSError:
            pass
    src = pick_default_name_file(ents, since, os.path.basename(path))
    return os.path.join(folder, src) if src else ""


def _rename_to_expected(src: str, path: str):
    """확정된 기본 이름 파일 → 기대 이름. 같은 이름이 있으면 덮지 않고 .alt → (지금 파일 경로, 로그용 설명)"""
    dst = path if not os.path.exists(path) else path + ".alt"
    try:
        os.replace(src, dst)
    except OSError as e:
        return src, f"카톡 기본 이름 '{os.path.basename(src)}' 를 바꾸지 못함({e}) — 수신함 수동 확인"
    return dst, f"카톡 기본 이름 '{os.path.basename(src)}' → 기대 이름 '{os.path.basename(dst)}'"


def _file_stamp(path: str) -> tuple:
    """(크기, mtime) — 없으면 (None, None)"""
    try:
        st = os.stat(path)
        return st.st_size, st.st_mtime
    except OSError:
        return None, None


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
def _wait_loaded(room: str, hwnd: int):
    """방 창을 앞으로 가져온 뒤 대화가 다 불러와지기를 기다린다(LOAD_WAIT) → 카톡 응답 확인(없으면 5초 간격 최대 60초).
    → (hwnd 또는 0/음수, 실제 기다린 초, 실패 이유)"""
    from open_room import kakao_responding

    t0 = time.time()
    time.sleep(LOAD_WAIT)
    end = time.time() + RESPOND_MAX
    while not kakao_responding(hwnd):
        if time.time() >= end:
            return -1, time.time() - t0, "카톡 응답 없음"
        time.sleep(RESPOND_EVERY)
    # 기다리는 사이 다른 창이 앞으로 왔을 수 있다 — 누르기 직전 다시 맨 앞·제목 확인(이미 열린 창을 앞으로만, 여기서는 새로 열지 않는다)
    if _fg()[0] != hwnd:
        h2 = _front_room(room)
        if h2 <= 0:
            return -1, time.time() - t0, "불러오기 대기 뒤 맨 앞 창 확인 실패"
        hwnd = h2
    return hwnd, time.time() - t0, ""


def _wait_file_settled(path: str, folder: str, since: float, max_secs: float = DONE_WAIT):
    """저장 창이 닫힌 뒤 파일이 생기고 크기가 SETTLE_STABLE 초 동안 안 변할 때까지(최대 max_secs) — 이것이 "내보내기 완료" 신호.
    기대 이름 파일이 없으면 카톡 기본 이름 파일(Ctrl+S 뒤 생긴 .txt)을 대신 잰다(파일이 늦게 생기는 경우 포함).
    → (확정 여부, 크기, 걸린 초, 실제로 잰 파일 경로)"""
    t0 = time.time()
    samples = []
    target = path
    while True:
        cur = path if os.path.exists(path) else (_default_name_candidate(folder, path, since) or path)
        if cur != target:
            target, samples = cur, []  # 재는 파일이 바뀌면 처음부터
        try:
            size = os.path.getsize(target)
        except OSError:
            size = -1
        now = time.time()
        samples.append((now, size))
        if size_settled(samples, SETTLE_STABLE):
            return True, size, now - t0, target
        if now - t0 >= max_secs:
            return False, size, now - t0, target
        time.sleep(1.0)


# 이번 실행에서 우리가 연 방 창 중 아직 못 닫은 것 {hwnd: 방} — 남아 있으면 새 방을 열지 않는다(우리 창 동시에 최대 1개)
_KEEP_OPEN: dict = {}


def _owned_visible(hwnd: int, pid: int) -> list:
    """그 방 창이 소유한 보이는 최상위 창(완료창·저장 창·확인창 등) — 읽기만"""
    import win32gui

    out = []

    def cb(h, _):
        try:
            if win32gui.IsWindowVisible(h) and _pid(h) == pid and win32gui.GetWindow(h, 4) == hwnd:  # 4 = GW_OWNER
                out.append(h)
        except Exception:
            pass
        return True

    try:
        win32gui.EnumWindows(cb, None)
    except Exception:
        pass
    return out


def _close_opened(room: str, hwnd: int) -> str:
    """이번에 연 방 창을 닫는다 — 소유 팝업이 없고 파일이 확정된 창만, CLOSE_WAIT 초 쉰 뒤 WM_CLOSE(outbox_relay·poster_send 와 같은 방식)
    → 닫힘 확인(최대 CLOSE_CONFIRM 초). 못 닫으면 _KEEP_OPEN 에 남겨 새 방 열기를 멈춘다 → 로그 조각"""
    import win32con
    import win32gui

    def exists() -> bool:
        try:
            return bool(win32gui.IsWindow(hwnd))
        except Exception:
            return False

    pid = _pid(hwnd)
    dec = close_decision(True, exists(), hwnd in _UNSETTLED_ROOMS, len(_owned_visible(hwnd, pid)) if exists() else 0)
    if dec == "gone":
        _KEEP_OPEN.pop(hwnd, None)
        return "연 창 이미 닫혀 있음"
    if dec != "close":
        _KEEP_OPEN[hwnd] = room
        return f"연 창 안 닫음({dec[5:]}) — 새 방 열기 멈춤"
    time.sleep(CLOSE_WAIT)  # 저장 직후 닫으면 카톡이 죽는다(2026-10-19 실측) — 완료창 닫힘·파일 확정 뒤 최소 8초
    # 쉬는 사이 팝업이 새로 떴을 수 있다 — 다시 확인
    dec = close_decision(True, exists(), hwnd in _UNSETTLED_ROOMS, len(_owned_visible(hwnd, pid)) if exists() else 0)
    if dec == "gone":
        _KEEP_OPEN.pop(hwnd, None)
        return "연 창 이미 닫혀 있음"
    if dec != "close":
        _KEEP_OPEN[hwnd] = room
        return f"연 창 안 닫음({dec[5:]}) — 새 방 열기 멈춤"
    try:
        win32gui.PostMessage(hwnd, win32con.WM_CLOSE, 0, 0)
    except Exception:
        pass
    end = time.time() + CLOSE_CONFIRM
    while time.time() < end:
        time.sleep(0.25)
        if not _alive(hwnd):
            _KEEP_OPEN.pop(hwnd, None)
            return f"{CLOSE_WAIT:.0f}초 쉬고 저장 뒤 닫음"
    _KEEP_OPEN[hwnd] = room
    return f"닫기 요청 뒤 {CLOSE_CONFIRM:.0f}초 안에 안 닫힘 — 창 남김, 새 방 열기 멈춤"


def _retry_close_kept() -> None:
    """방 사이 — 앞서 못 닫은 우리 창을 다시 닫아 본다(완료창이 정리됐으면 닫힌다)"""
    from poster_send import log

    for h, room in list(_KEEP_OPEN.items()):
        log(f"    [내보내기]   [{room}] 앞서 연 창 다시 닫기: {_close_opened(room, h)}")


def _open_for_export(room: str, user_windows) -> tuple:
    """창이 없으면 open_room 으로 연다 → (hwnd 또는 0, 이번에 연 창이면 그 hwnd 아니면 0, 걸린 초, 실패 종류)
    실패 종류: '' 성공 / 'login'·'nokakao'(전체 중단) / 'hung'·'noopen'·'error' 등(그 방 실패)"""
    from open_room import open_room
    from poster_send import find_room_window, log

    t0 = time.time()
    h, _ = find_room_window(room)
    if h:
        return h, 0, 0.0, ""
    log(f"    [내보내기]   [{room}] 창이 안 열려 있음 — 방 이름으로 검색해 엽니다")
    open_room.last_fail = ""  # 성공하면 갱신되지 않는 값이라 앞 실패가 남지 않게 비운다
    try:
        ok = open_room(room)
    except Exception as e:
        log(f"    [내보내기]   방 열기 오류: {e}")
        return 0, 0, time.time() - t0, "error"
    h = find_room_window(room)[0] if ok else None
    if not h:
        return 0, 0, time.time() - t0, getattr(open_room, "last_fail", "") or "noopen"
    return h, (0 if h in user_windows else h), time.time() - t0, ""


def export_one(room: str, folder: str, ymd: str, user_windows=frozenset()) -> str:
    """한 방 저장 → 'ok:진행 요약' / 'skip:이유' / 'fail:이유' / 'stop:이유'(로그인 화면·카톡 꺼짐 — 전체 중단).
    한 번에 한 방만. 창이 없으면 스스로 열고(2026-10-29), 이번에 연 창은 저장이 끝나면 닫는다 — 우리가 연 창은 동시에 최대 1개.
    user_windows = 실행 시작 때 이미 열려 있던 방 창(사람이 연 창, 절대 안 닫음). 여러 방을 한꺼번에 열면 카톡이 튕긴다(2026-10-27 사용자 실측)"""
    path = os.path.join(folder, export_file_name(room, ymd))
    if os.path.exists(path):
        return "skip:오늘 파일 이미 있음"
    from poster_send import find_room_window

    if not find_room_window(room)[0] and _KEEP_OPEN:
        return f"skip:앞서 연 방 창({', '.join(_KEEP_OPEN.values())})을 못 닫아 새 방을 열지 않음(우리가 연 창은 동시에 최대 1개)"
    hwnd, opened, secs, fail = _open_for_export(room, user_windows)
    if not hwnd:
        why = f"방 열기 실패({fail}, {secs:.0f}초)"
        if fail in ("login", "nokakao"):
            return f"stop:{why} — {'카톡이 로그인 화면' if fail == 'login' else '카톡 메인 창 없음(꺼짐)'}, 남은 방도 못 연다"
        return f"fail:{why}"
    res = _export_window(room, folder, path)
    kind, _, why = res.partition(":")
    if opened:
        why = f"방 열기 {secs:.0f}초 → {why} → {_close_opened(room, opened)}"
    return f"{kind}:{why}"


def _export_window(room: str, folder: str, path: str) -> str:
    """열려 있는 방 창 하나 저장(옛 export_one 본문) → 'ok:' / 'skip:' / 'fail:'"""
    import pyautogui
    import win32gui

    from poster_send import log, set_clipboard_text

    hwnd = _front_room(room)
    if hwnd == 0:
        return "skip:창 안 열림"
    if hwnd < 0:
        return "fail:맨 앞 창 확인 실패"
    hwnd, waited, why = _wait_loaded(room, hwnd)
    steps = f"불러오기 대기 {waited:.0f}초"
    if hwnd <= 0:
        return f"fail:{why}({steps})"
    pid = _pid(hwnd)
    before = _visible_windows_of(pid)
    pyautogui.hotkey("ctrl", "s")
    t_s = time.time()
    dlg, cls, title = _wait_new_window(pid, before, hwnd, EXPORT_WAIT)
    steps += " → Ctrl+S"
    if not dlg:
        return f"fail:Ctrl+S 뒤 {EXPORT_WAIT:.0f}초 안에 창이 안 뜸({steps})"
    if not is_save_dialog(cls, title, extra_save_titles()):
        _esc_if_front(dlg, "저장 창 아님")
        return f"fail:저장 창 아님('{title}' {cls})"
    steps += f" → 저장 창 {time.time() - t_s:.1f}초"
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
            time.sleep(0.5)  # 저장 창이 막 뜬 직후엔 키가 씹힌다(실측 0.2초 만에 누름) — 조금 쉬고
            if _fg()[0] != dlg:
                return "fail:이름 칸 선택 직전 맨 앞 창이 바뀜"
            _select_all_in_edit(focus_h)  # 기본 이름 전체 선택(Ctrl+A·End/Shift+Home 대신, 위 함수 주석)
            time.sleep(0.2)
            pyautogui.hotkey("ctrl", "v")  # 선택된 기본 이름을 우리 경로로 바꿈
            time.sleep(0.4)
        finally:
            _clear_clipboard()
        if _fg()[0] != dlg:
            return "fail:Enter 직전 맨 앞 창이 바뀜"
        # Enter 전에 칸 글이 정확히 우리 경로인지 읽어서 확인 — 다르면 저장하지 않고 닫는다(이름 꼬인 파일을 만들지 않게)
        typed = _edit_text(focus_h)
        if typed.strip() != path:
            _esc_if_front(dlg, "파일 이름이 기대와 다름")
            return f"fail:파일 이름 칸 글이 기대와 다름('{typed[-60:]}') — 저장 안 함"
        before2 = _visible_windows_of(pid)
        pyautogui.press("enter")
        # 저장 창이 닫히거나, 확인창(덮어쓰기·오류)이 뜨거나 — Esc 대상은 표준 대화 상자(#32770)만.
        # 카톡 완료창(EVA_Window_Dblclk)은 대상이 아니다 — 진행 중 Esc 는 내보내기 취소가 될 수 있다(2026-10-28 실측)
        end = time.time() + 5.0
        while time.time() < end:
            time.sleep(0.25)
            if not _alive(dlg):
                break
            fh, fc, _ = _fg()
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
        if _alive(dlg):
            _esc_if_front(dlg, "5초 지나도 저장 창이 안 닫힘")
            return "fail:저장 창이 안 닫힘"
    except Exception as e:
        if _alive(dlg):
            _esc_if_front(dlg, "오류")
        return f"fail:{e}"
    # 완료 신호 = 파일 크기 멈춤(SETTLE_STABLE 초, 최대 DONE_WAIT). 완료창은 글자를 못 읽어 상태를 알 수 없다(자식 0개 실측) —
    # 파일이 멈추기 전에는 완료창에 어떤 키도 누르지 않는다(진행 중 Enter/Esc 는 내보내기 취소 위험)
    done, size, took, actual = _wait_file_settled(path, folder, t_s, DONE_WAIT)
    if done and actual != path:  # 붙여 넣은 이름이 안 먹고 카톡 기본 이름으로 저장됨(2026-10-28 실측 의심) — 다 쓴 뒤 이름 바꿈
        actual, renamed = _rename_to_expected(actual, path)
        log(f"    [내보내기]   {renamed}")
        steps += " → 기본 이름 바꿈"
    if not done:
        _UNSETTLED_ROOMS.add(hwnd)  # 아직 내보내는 중일 수 있다 — 이 방 완료창은 이번 실행에서 건드리지 않는다
        if size <= 0:
            return f"fail:파일이 안 생김(또는 0바이트) — 파일 대기 {took:.0f}초 · 완료창 키 안 누름({steps})"
        # 파일이 DONE_WAIT 안에 안 멈춤 — 반쪽 파일이 수신함에 남으면 GAS 가 그대로 적재한다. 이름을 .partial 로 바꿔 적재에서 뺀다
        moved = "→ .partial 로 치움"
        try:
            os.replace(actual, path + ".partial")
        except OSError:
            moved = "→ 치우지 못함(카톡이 아직 쓰는 중?) 수신함에서 수동 확인"  # 거짓 로그를 남기지 않는다(방지훈 2026-10-27)
        return (f"fail:파일 쓰기가 {DONE_WAIT:.0f}초 안에 안 끝남({fmt_kb(size)}, 일부만 저장됐을 수 있음 {moved} · "
                f"완료창 키 안 누름 · {steps})")
    steps += f" → 파일 {fmt_kb(size)} 확정({took:.0f}초)"
    stamp = _file_stamp(actual)  # 확정 직후(이름 바꿈은 mtime 을 안 바꾼다) — Enter 직전에 이것과 다시 비교
    steps += " → " + _close_done_popup_after_settle(hwnd, pid, before, (actual, size, stamp[1]))
    return f"ok:{steps}"


def _acquire_mutex():
    """한 번에 하나만 — 이미 다른 내보내기가 돌고 있으면 0. 프로세스가 끝나면 윈도가 알아서 푼다"""
    import ctypes

    k32 = ctypes.windll.kernel32
    h = k32.CreateMutexW(None, False, EXPORT_MUTEX)
    if k32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
        k32.CloseHandle(h)
        return 0
    return h


def export(rooms: list, folder: str) -> int:
    import pyautogui

    from open_room import close_popup_windows, room_windows_snapshot
    from poster_send import find_room_window, log

    pyautogui.FAILSAFE = False
    ymd = kst_today()
    if not _acquire_mutex():
        log("[내보내기] 이미 다른 내보내기가 실행 중 — 이번엔 건너뜀")
        return 0
    t_start = time.time()
    n_open = sum(1 for r in rooms if not find_room_window(r)[0])
    log("=" * 64)
    log(f"[내보내기] 시작 — 대상 {len(rooms)}방(창 없음 {n_open}방은 열어서 저장 뒤 닫음) · 폴더 {folder} · 한 번에 한 방(방 열기 약 {OPEN_TYPICAL:.0f}초·"
        f"불러오기 {LOAD_WAIT:.0f}초·저장 창 {EXPORT_WAIT:.0f}초·파일 {SETTLE_STABLE:.0f}초 멈춤 확인(최대 {DONE_WAIT:.0f}초) 뒤 완료창 Enter·"
        f"연 창은 {CLOSE_WAIT:.0f}초 뒤 닫음·방 사이 {ROOM_GAP:.0f}초·상한 {RUN_LIMIT / 60:.0f}분) · 예상 약 {estimate_minutes(len(rooms), n_open=n_open)}분")
    if not _kakao_ready():
        return 2
    _KEEP_OPEN.clear()
    user_windows = frozenset(room_windows_snapshot())  # 시작 때 열려 있던 창 = 사람이 연 창 — 절대 닫지 않는다
    if close_popup_windows():
        log("    [내보내기] 떠 있던 팝업을 닫았습니다")
    _UNSETTLED_ROOMS.clear()
    left = _close_leftover_done_popups(rooms, folder, ymd)  # 전에 남은 완료창(방 창 소유) — 뮤텍스상 완료된 잔여, 맨 앞일 때만 Enter
    if left:
        log(f"    [내보내기] 떠 있던 완료창 {left}개를 닫았습니다")
    ok = skip = fails = 0
    pressed = False
    # 상한: 실행기(worker.py)가 이 스크립트를 별도 프로세스로 띄우고 심박은 계속 찍으므로 8분 → 60분(2026-10-27) → 120분(04:30 시작, 2026-10-28 실측 한 방 3분+).
    # 상한은 "새 방을 시작하지 않는" 기준 — 진행 중인 방은 끝까지(최대 약 5분 더)
    deadline = t_start + RUN_LIMIT
    for room in rooms:  # 차례대로 한 방씩 — 동시에 여러 방을 다루지 않는다
        if fails >= MAX_FAILS:
            log(f"    [내보내기] 실패 {fails}번 — 남은 방은 오늘 건너뜀")
            break
        if time.time() > deadline:
            log(f"    [내보내기] {RUN_LIMIT / 60:.0f}분 상한 — 남은 방은 오늘 건너뜀")
            break
        if pressed:
            time.sleep(ROOM_GAP)  # 앞 방 저장이 끝나고 카톡이 숨 돌릴 텀
            # 앞 방 완료창이 남았으면 닫고 시작(파일이 안 멈춘 방 창은 건드리지 않음). 못 닫으면 로그만 — 소유 방이 달라 겹치지 않는다
            left = _close_leftover_done_popups(rooms, folder, ymd)
            if left:
                log(f"    [내보내기] 떠 있던 완료창 {left}개를 닫았습니다")
            _retry_close_kept()  # 앞서 못 닫은 우리 창 — 닫혀야 다음 방을 연다
            if time.time() > deadline:
                log(f"    [내보내기] {RUN_LIMIT / 60:.0f}분 상한 — 남은 방은 오늘 건너뜀")
                break
        res = export_one(room, folder, ymd, user_windows)
        kind, _, why = res.partition(":")
        if kind == "stop":
            fails += 1
            log(f"    [내보내기] ✗ [{room}] {why} — 남은 방은 오늘 건너뜀")
            break
        if kind == "ok":
            ok += 1
            pressed = True
            log(f"    [내보내기] ✓ [{room}] {why} → {export_file_name(room, ymd)}")
        elif kind == "skip":
            skip += 1
            log(f"    [내보내기] - [{room}] 건너뜀: {why}")
        else:
            fails += 1
            pressed = True
            log(f"    [내보내기] ✗ [{room}] {why}")
    if _KEEP_OPEN:
        _retry_close_kept()
    if _KEEP_OPEN:
        log(f"    [내보내기] ⚠ 이번에 열었지만 못 닫은 방 창: {', '.join(_KEEP_OPEN.values())} — 카톡 PC 에서 확인 후 손으로 닫아 주세요")
    took = time.time() - t_start
    log(f"[내보내기] 끝 · 저장 {ok} · 건너뜀 {skip} · 실패 {fails} · 소요 {int(took // 60)}분 {int(took % 60)}초")
    return 0 if fails == 0 else 2


def list_rooms(rooms: list, folder: str) -> int:
    from poster_send import find_room_window, log

    log(f"[내보내기] 수신함 폴더: {folder or '(못 찾음)'}")
    n_open = 0
    for r in rooms:
        h, t = find_room_window(r)
        if not h:
            n_open += 1
        log(f"  {'창 열림 ✓ ' + t + ' → 바로 저장' if h else '창 안 열림 → 열어서 저장 예정(저장 뒤 닫음)'} · {r}")
    log(f"[내보내기] {len(rooms)}방 중 창 열림 {len(rooms) - n_open} · 안 열림 {n_open} · 예상 약 {estimate_minutes(len(rooms), n_open=n_open)}분"
        f"(상한 {RUN_LIMIT / 60:.0f}분)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="카톡 PC 대화 내용 저장(수신함으로) — 기본은 --probe")
    ap.add_argument("--probe", action="store_true", help="(기본) Ctrl+S 뒤 뜨는 창만 기록하고 Esc — 저장 안 함")
    ap.add_argument("--export", action="store_true", help="대상 방마다 실제 저장(창이 없으면 열어서, 저장 뒤 그 창은 닫음)")
    ap.add_argument("--list", action="store_true", help="대상 방·창 열림/안 열림(열어서 저장 예정)만")
    ap.add_argument("--selftest", action="store_true", help="순수 함수 점검(카톡 안 건드림)")
    ap.add_argument("--room", help="probe 할 방 이름")
    ap.add_argument("--rooms", help="저장할 방 이름들(쉼표·줄바꿈 구분) — 없으면 kakao_collect_rooms(export=true) 전체")
    ap.add_argument("--category", help="업무 종류만(쉼표 구분, 예: 점검,AS) — kakao_collect_rooms 는 kinds 와 겹치는 방, room_map 은 category 일치")
    ap.add_argument("--from-room-map", action="store_true", help="비상용: 수집 표를 건너뛰고 옛 방식(room_map)으로 방 목록")
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
            rooms = load_rooms(args.category.split(",") if args.category else None, args.from_room_map)
        except Exception as e:
            log(f"[내보내기] ✗ 방 목록 읽기 실패: {e}")
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
    code = export(rooms, folder)
    if FALLBACK_NOTE:
        log(FALLBACK_NOTE)  # 마지막 줄 — worker 가 stdout 끝 4줄을 상태에 적는다
    return code


if __name__ == "__main__":
    sys.exit(main())
