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
  · 천천히, 한 번에 한 방(2026-10-27 사용자 실측: 큰 방은 기다려야 대화가 다 불러와지고, 여러 방을 한꺼번에 열면 튕긴다).
    방마다 창을 앞으로 → 불러오기 대기 30초 + 카톡 응답 확인(없으면 5초 간격 최대 60초) → Ctrl+S → 저장 창(최대 15초)
    → 카톡 "대화 내보내기" 완료창(진행 막대 → "100% 완료되었습니다" [폴더열기][확인])이 "완료"가 될 때까지 최대 300초
      (진행 중엔 아무 키도 안 누름 — Esc 는 내보내기를 취소할 수 있다), 완료면 그 창이 맨 앞일 때만 Enter(기본 단추=확인)로 닫는다
    → 그 뒤부터 파일 크기가 15초 동안 안 변할 때까지(최대 300초) → 방 사이 20초 → 다음 방. 전체 상한 60분(새 방을 시작하지 않는 기준).
    완료창이 안 뜨는 옛 카톡은 파일 크기 멈춤만 본다. 기대 이름 파일이 없으면 수신함에서 Ctrl+S 뒤 생긴 .txt(카톡 기본 이름)를 기대 이름으로 바꾼다.
    (2026-10-28 노트북 실측: 완료창이 남아 있었고, 파일은 3분 넘게 걸려 끝에 가서야 생겼다)
    조정: FIRSTOA_KAKAO_EXPORT_LOAD_WAIT · _DIALOG_WAIT · _DONE_WAIT · _GAP · _LIMIT (초). 동시에 두 개 안 돈다(뮤텍스 Local\FIRSTOA-KakaoExport).

사용법 (노트북 D6110 에서만 — 데스크톱에서 돌리지 않는다)
  python tools\kakao-pc\export_rooms.py --probe --room "방이름"     기본. Ctrl+S 뒤 뜨는 창만 기록하고 Esc (저장 안 함)
  python tools\kakao-pc\export_rooms.py --export --rooms "방이름"   그 방 하나만 실제 저장(첫 시험)
  python tools\kakao-pc\export_rooms.py --export                    Supabase kakao_collect_rooms(enabled·export=true) 방 중 창이 열린 방 전부
                                                                     (표가 없거나 비면 room_map 의 점검·AS·물류·미수·불만·재계약 방 — 마감·부품·자가 제외)
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
SETTLE_MAX = 300.0       # 완료창이 닫힌 뒤(없으면 저장 창이 닫힌 뒤) 파일 확정까지 최대 대기(옛 180초)
# 카톡 "대화 내보내기" 완료창(2026-10-28 노트북 실측) — 진행 막대 → "100% 완료되었습니다." + [폴더열기] [확인]. 클래스는 #32770 이 아닐 수 있다
EXPORT_WIN_TITLE = "내보내기"
DONE_WAIT = env_seconds("FIRSTOA_KAKAO_EXPORT_DONE_WAIT", 300.0, 10, 1800)  # 완료창이 "완료"가 되기까지 최대 대기(파일 유무와 무관)
DONE_APPEAR = 15.0       # 저장 창이 닫힌 뒤 완료창이 뜨기를 기다리는 시간 — 안 뜨면 옛 카톡으로 보고 파일 크기만 본다
ROOM_GAP = env_seconds("FIRSTOA_KAKAO_EXPORT_GAP", 20.0, 3, 600)  # 방 사이 텀(옛 3초)
RUN_LIMIT = env_seconds("FIRSTOA_KAKAO_EXPORT_LIMIT", 7200.0, 60, 4 * 3600)  # 전체 상한 120분(2026-10-28 실측 한 방 3분+ → 21방 약 75~100분, 옛 60분·8분) — 실행기가 별도 프로세스로 띄워 심박은 계속 찍힌다(2026-10-27)
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
                     write: float = EXPORT_TYPICAL + SETTLE_STABLE) -> float:
    """대략 걸리는 분 — 방마다 불러오기 + 저장 창(최대치) + 내보내기(완료창)·파일 확정 + 다음 방까지 텀(마지막 방 제외).
    기본값 21방 = 21×(30+15+75)+20×20 = 2,920초 ≈ 48.7분"""
    if n_rooms <= 0:
        return 0.0
    return round((n_rooms * (load + dialog + write) + (n_rooms - 1) * gap) / 60.0, 1)


def is_save_dialog(cls: str, title: str, extra_titles: tuple = ()) -> bool:
    """윈도 표준 저장 창인가 — 클래스 #32770 + 제목에 저장 창 이름이 들어 있어야"""
    if cls != DIALOG_CLASS:
        return False
    t = str(title or "").strip().lower()
    return any(s.lower() in t for s in tuple(SAVE_TITLES) + tuple(extra_titles) if s)


def is_export_window_title(title: str) -> bool:
    """카톡 '대화 내보내기' 진행·완료창인가 — 제목에 '내보내기'(클래스 무관). 저장 창·덮어쓰기 확인창 제목과 겹치지 않는다"""
    return EXPORT_WIN_TITLE in str(title or "")


def _btn_text(s: str) -> str:
    return re.sub(r"[\s&]", "", str(s or ""))


def export_window_done(title: str, children: list) -> bool:
    """완료창 상태 — children = [(클래스, 글자, 활성)]. 글자(또는 제목)에 '완료'(미완료 제외)가 보이거나,
    [확인] 단추가 활성이고 [취소] 단추가 없으면 완료. 진행 중(완료 글자 없음)이면 False → 아무 키도 누르지 않는다"""
    texts = [str(title or "")] + [str(t or "") for _, t, _ in (children or [])]
    if any("완료" in t and "미완료" not in t for t in texts):
        return True
    btns = {_btn_text(t): bool(en) for c, t, en in (children or []) if "button" in str(c or "").lower()}
    if "취소" in btns or "cancel" in {k.lower() for k in btns}:
        return False
    return btns.get("확인", False) or btns.get("OK", False)


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
    assert estimate_minutes(2, 10, 15, 20, 15) == round((2 * 40 + 20) / 60, 1)
    assert estimate_minutes(21, 30, 15, 20, 75) == 48.7
    assert is_export_window_title("대화 내보내기") and not is_export_window_title("다른 이름으로 저장")
    assert not is_export_window_title("저장 확인") and not is_export_window_title("")
    assert not export_window_done("대화 내보내기", [("Static", "45%", True), ("Button", "취소", True)])  # 진행 중
    assert not export_window_done("대화 내보내기", [])  # 글자를 못 읽으면 완료로 보지 않는다
    assert export_window_done("대화 내보내기", [("Static", "100% 완료되었습니다.", True), ("Button", "폴더열기", True), ("Button", "확인", True)])
    assert export_window_done("대화 내보내기", [("Button", "폴더열기", True), ("Button", "확인", True)])  # 완료 글자 없이 확인 활성
    assert not export_window_done("대화 내보내기", [("Button", "확인", False)])  # 확인 비활성
    assert not export_window_done("대화 내보내기", [("Static", "미완료", True)])
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


# ── 완료창("대화 내보내기") ────────────────────────────────────────
def _alive(h: int) -> bool:
    import win32gui

    try:
        return bool(h) and bool(win32gui.IsWindow(h)) and bool(win32gui.IsWindowVisible(h))
    except Exception:
        return False


def _child_states(hwnd: int, limit: int = 40) -> list:
    """자식 컨트롤 [(클래스, 글자, 활성)] — 읽기만(GetWindowText). 창 메시지로 글을 넣지 않는다"""
    import win32gui

    out = []

    def cb(h, _):
        if len(out) < limit:
            try:
                if win32gui.IsWindowVisible(h):
                    out.append((win32gui.GetClassName(h), win32gui.GetWindowText(h), bool(win32gui.IsWindowEnabled(h))))
            except Exception:
                pass

    try:
        win32gui.EnumChildWindows(hwnd, cb, None)
    except Exception:
        pass
    return out


def _looks_like_room_window(h: int) -> bool:
    """방 창(채팅 입력칸이 있는 창)인가 — 방 이름에 '내보내기'가 든 방 창에 Enter 가 들어가지 않게(방지훈 2026-10-28).
    자식에 Edit/RichEdit 계열 입력칸이 있으면 방 창으로 본다. 완료창(진행 막대·글자·단추)에는 입력칸이 없다."""
    return any("edit" in (cls or "").lower() for cls, _, _ in _child_states(h))


def _export_windows(pid: int, exclude: set = frozenset()) -> list:
    """카톡 프로세스(pid)의 보이는 창 중 제목에 '내보내기'가 든 완료창 — 클래스 무관, 방 창(입력칸 있음)은 제외"""
    import win32gui

    out = []
    for h in _visible_windows_of(pid):
        if h in exclude:
            continue
        try:
            if is_export_window_title(win32gui.GetWindowText(h)) and not _looks_like_room_window(h):
                out.append(h)
        except Exception:
            pass
    return out


def _enter_close_export(h: int) -> str:
    """완료 상태인 완료창을 Enter(기본 단추=확인)로 닫는다 — 클릭·좌표 없음.
    그 창이 맨 앞(제목 '내보내기' 재확인)일 때만 누른다. 아니면 SetForegroundWindow 한 번 → 재확인 → 그래도 아니면 안 누름.
    → 'closed' / 'left'(못 눌렀거나 눌러도 안 닫힘)"""
    import pyautogui
    import win32gui

    from poster_send import log

    fh, _, ft = _fg()
    if fh != h:
        try:
            win32gui.SetForegroundWindow(h)
        except Exception:
            pass
        time.sleep(0.4)
        fh, _, ft = _fg()
    if fh != h or not is_export_window_title(ft) or _looks_like_room_window(h):
        log(f"    [내보내기]   완료창이 맨 앞이 아니거나 방 창으로 보임(맨 앞 '{ft}') — Enter 안 누름, 창은 남겨 둠")
        return "left"
    pyautogui.press("enter")
    end = time.time() + 3.0
    while time.time() < end:
        time.sleep(0.25)
        if not _alive(h):
            return "closed"
    log("    [내보내기]   완료창에 Enter 를 눌렀지만 3초 안에 안 닫힘 — 창은 남겨 둠")
    return "left"


def _wait_export_done(pid: int, room_hwnd: int, found: int = 0, appear_wait: float = DONE_APPEAR):
    """저장 창이 닫힌 뒤 — 완료창을 기다려 '완료'가 되면 Enter 로 닫는다. 파일 유무와 무관하게 창 상태만 본다.
    진행 중엔 아무 키도 누르지 않는다(Esc 는 내보내기 취소가 될 수 있다).
    → (상태, 걸린 초) 상태: 'none'(안 뜸=옛 카톡) / 'closed' / 'gone'(스스로 닫힘) / 'left'(완료지만 못 닫음) / 'timeout'(아직 진행 중)"""
    import win32gui

    from poster_send import log

    t0 = time.time()
    h = found
    while not h:
        wins = _export_windows(pid, {room_hwnd})
        if wins:
            h = wins[0]
            break
        if time.time() - t0 >= appear_wait:
            return "none", time.time() - t0
        time.sleep(0.5)
    try:
        log(f"    [내보내기]   완료창: 클래스='{win32gui.GetClassName(h)}' 제목='{win32gui.GetWindowText(h)}' · 자식={', '.join(_child_summary(h)) or '없음'}")
    except Exception:
        pass
    end = time.time() + DONE_WAIT
    while time.time() < end:
        if not _alive(h):
            return "gone", time.time() - t0
        try:
            title = win32gui.GetWindowText(h)
        except Exception:
            title = ""
        if export_window_done(title, _child_states(h)):
            return _enter_close_export(h), time.time() - t0
        time.sleep(1.0)
    states = _child_states(h)
    log(f"    [내보내기]   완료창이 {DONE_WAIT:.0f}초 안에 '완료'가 안 됨 — 키 안 누름 · 글자={[t for _, t, _ in states if t][:8] or '못 읽음'}")
    return "timeout", time.time() - t0


def _close_leftover_export_windows() -> int:
    """시작 때·방 사이 — 남아 있는 완료창을 닫는다. 완료 상태면 Enter, 진행 중이면 '완료'까지 기다린다(최대 DONE_WAIT, 키 안 누름).
    → 닫은 수. 끝까지 진행 중(timeout)이거나 완료인데 못 닫은(left) 창이 남으면 -1 — 내보내기 두 개가 겹치지 않게 호출자가 멈춘다(방지훈 2026-10-28)"""
    from open_room import main_window

    main = main_window()
    if not main:
        return 0
    n = 0
    for h in _export_windows(_pid(main), {main}):
        status, _ = _wait_export_done(_pid(main), main, h)
        if status in ("closed", "gone"):
            n += 1
        elif status in ("timeout", "left"):
            return -1
    return n


def _rename_default_name_file(folder: str, path: str, since: float) -> str:
    """기대 이름 파일이 없을 때 — 수신함에서 Ctrl+S 뒤 생긴 .txt(카톡 기본 이름)를 기대 이름으로. 같은 이름이 있으면 덮지 않고 .alt
    → 로그용 설명('' 이면 못 찾음)"""
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
    if not src:
        return ""
    dst = path if not os.path.exists(path) else path + ".alt"
    try:
        os.replace(os.path.join(folder, src), dst)
    except OSError as e:
        return f"카톡 기본 이름 '{src}' 를 바꾸지 못함({e}) — 수신함 수동 확인"
    return f"카톡 기본 이름 '{src}' → 기대 이름 '{os.path.basename(dst)}'"


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
    # 기다리는 사이 다른 창이 앞으로 왔을 수 있다 — 누르기 직전 다시 맨 앞·제목 확인(이미 열린 창을 앞으로만, 새로 열지 않는다)
    if _fg()[0] != hwnd:
        h2 = _front_room(room)
        if h2 <= 0:
            return -1, time.time() - t0, "불러오기 대기 뒤 맨 앞 창 확인 실패"
        hwnd = h2
    return hwnd, time.time() - t0, ""


def _wait_file_settled(path: str):
    """저장 창이 닫힌 뒤 파일이 생기고 크기가 SETTLE_STABLE 초 동안 안 변할 때까지(최대 SETTLE_MAX) → (확정 여부, 크기, 걸린 초)"""
    t0 = time.time()
    samples = []
    while True:
        try:
            size = os.path.getsize(path)
        except OSError:
            size = -1
        now = time.time()
        samples.append((now, size))
        if size_settled(samples, SETTLE_STABLE):
            return True, size, now - t0
        if now - t0 >= SETTLE_MAX:
            return False, size, now - t0
        time.sleep(1.0)


def export_one(room: str, folder: str, ymd: str) -> str:
    """한 방 저장 → 'ok:진행 요약' / 'skip:이유' / 'fail:이유'.
    한 번에 한 방만 — 창은 절대 새로 열지 않는다(이미 열린 방 창만 앞으로). 여러 방을 한꺼번에 열면 카톡이 튕긴다(2026-10-27 사용자 실측)"""
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
    export_win = 0  # 저장 창 Enter 뒤 뜬 카톡 완료창('대화 내보내기')
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
        # 저장 창이 닫히거나, 확인창(덮어쓰기·오류)이 뜨거나, 카톡 완료창('대화 내보내기')이 뜨거나
        end = time.time() + 5.0
        while time.time() < end:
            time.sleep(0.25)
            if not _alive(dlg):
                break
            # 완료창은 확인창이 아니다 — Esc 하면 내보내기가 취소될 수 있다(2026-10-28 실측). 뜨면 루프를 끝내고 완료창 단계로
            news_exp = _export_windows(pid, {hwnd, dlg})
            if news_exp:
                export_win = news_exp[0]
                break
            fh, fc, ft = _fg()
            pop = fh if (fh != dlg and fc == DIALOG_CLASS and _pid(fh) == pid and not is_export_window_title(ft)) else 0
            if not pop:
                news = [h for h in _visible_windows_of(pid) - before2
                        if win32gui.GetClassName(h) == DIALOG_CLASS and not is_export_window_title(win32gui.GetWindowText(h))]
                pop = news[0] if news else 0
            if pop:
                ptitle = win32gui.GetWindowText(pop)
                log(f"    [내보내기]   확인창 '{ptitle}' — 덮어쓰지 않고 Esc")
                _esc_if_front(pop, "확인창")
                time.sleep(0.3)
                _esc_if_front(dlg, "저장 창 닫기")
                return f"fail:확인창이 뜸('{ptitle}') — 덮어쓰기/경로 문제"
        if _alive(dlg) and not export_win:
            _esc_if_front(dlg, "5초 지나도 저장 창이 안 닫힘")
            return "fail:저장 창이 안 닫힘"
    except Exception as e:
        if _alive(dlg) and not export_win:
            _esc_if_front(dlg, "오류")
        return f"fail:{e}"
    # 완료창 — 카톡이 내보내기를 끝낼 때까지(최대 DONE_WAIT) 창 상태만 본다. "완료" 전에는 실패 처리하지 않고 키도 안 누른다
    status, done_secs = _wait_export_done(pid, hwnd, export_win)
    steps += " → 완료창 없음" if status == "none" else f" → 완료창 {done_secs:.0f}초"
    waits = f"완료창 대기 {done_secs:.0f}초"
    if status == "timeout":
        return f"fail:카톡이 {DONE_WAIT:.0f}초 안에 내보내기를 못 끝냄({waits} / 파일 대기 0초 · 키 안 누름, 다음 방 전에 다시 기다림 · {steps})"
    if status == "left":
        steps += "(완료, 창은 남음)"
    # 기대 이름 파일이 없으면 — 붙여 넣은 이름이 안 먹고 카톡 기본 이름으로 저장됐을 수 있다(2026-10-28 실측 의심)
    renamed = ""
    if not os.path.exists(path):
        renamed = _rename_default_name_file(folder, path, t_s)
        if renamed:
            log(f"    [내보내기]   {renamed}")
            steps += " → 기본 이름 바꿈"
    # 저장 완료 확인 — 완료창이 닫힌 뒤부터 잰다. 크기가 SETTLE_STABLE 초 멈출 때까지 다음 방으로 가지 않는다
    done, size, took = _wait_file_settled(path)
    if not done and size <= 0 and not renamed:  # 옛 카톡(완료창 없음)은 파일이 늦게 생길 수 있다 — 한 번 더 찾아본다
        renamed = _rename_default_name_file(folder, path, t_s)
        if renamed:
            log(f"    [내보내기]   {renamed}")
            steps += " → 기본 이름 바꿈"
            done, size, took2 = _wait_file_settled(path)
            took += took2
    waits += f" / 파일 대기 {took:.0f}초"
    if done:
        return f"ok:{steps} → 파일 {fmt_kb(size)} 확정({took:.0f}초)"
    if size <= 0:
        return f"fail:파일이 안 생김(또는 0바이트) — {waits}({steps})"
    # 완료창이 "완료"였는데(또는 옛 카톡) 파일이 SETTLE_MAX 안에 안 멈춤 — 반쪽 파일이 수신함에 남으면 GAS 가 그대로 적재한다.
    # 이름을 .partial 로 바꿔 적재에서 뺀다(다음 날 같은 날짜 파일명으로 다시 시도됨). 완료 전(timeout)에는 위에서 이미 돌아가 치우지 않는다
    moved = "→ .partial 로 치움"
    try:
        os.replace(path, path + ".partial")
    except OSError:
        moved = "→ 치우지 못함(카톡이 아직 쓰는 중?) 수신함에서 수동 확인"  # 거짓 로그를 남기지 않는다(방지훈 2026-10-27)
    return f"fail:파일 쓰기가 {SETTLE_MAX:.0f}초 안에 안 끝남({fmt_kb(size)}, 일부만 저장됐을 수 있음 {moved} · {waits} · {steps})"


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

    from open_room import close_popup_windows
    from poster_send import log

    pyautogui.FAILSAFE = False
    ymd = kst_today()
    if not _acquire_mutex():
        log("[내보내기] 이미 다른 내보내기가 실행 중 — 이번엔 건너뜀")
        return 0
    t_start = time.time()
    log("=" * 64)
    log(f"[내보내기] 시작 — 대상 {len(rooms)}방 · 폴더 {folder} · 한 번에 한 방(불러오기 {LOAD_WAIT:.0f}초·저장 창 {EXPORT_WAIT:.0f}초·"
        f"완료창 최대 {DONE_WAIT:.0f}초·파일 {SETTLE_STABLE:.0f}초 멈춤 확인(최대 {SETTLE_MAX:.0f}초)·방 사이 {ROOM_GAP:.0f}초·상한 {RUN_LIMIT / 60:.0f}분) · 예상 약 {estimate_minutes(len(rooms))}분")
    if not _kakao_ready():
        return 2
    if close_popup_windows():
        log("    [내보내기] 떠 있던 팝업을 닫았습니다")
    left = _close_leftover_export_windows()  # 전에 남은 완료창 — 완료면 Enter, 진행 중이면 기다림(키 안 누름)
    if left < 0:
        log("    [내보내기] ✗ 앞서 시작된 내보내기가 아직 진행 중(또는 완료창을 못 닫음) — 겹치지 않게 오늘은 시작 안 함")
        return 2
    if left:
        log("    [내보내기] 떠 있던 완료창('대화 내보내기')을 닫았습니다")
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
            # 앞 방 완료창이 남았으면 닫고(진행 중이면 끝날 때까지 기다림) 시작 — 내보내기 두 개가 겹치지 않게
            left = _close_leftover_export_windows()
            if left < 0:
                log("    [내보내기] ✗ 앞 방 내보내기가 아직 진행 중(또는 완료창을 못 닫음) — 겹치지 않게 남은 방은 오늘 건너뜀")
                break
            if left:
                log("    [내보내기] 떠 있던 완료창('대화 내보내기')을 닫았습니다")
            if time.time() > deadline:
                log(f"    [내보내기] {RUN_LIMIT / 60:.0f}분 상한 — 남은 방은 오늘 건너뜀")
                break
        res = export_one(room, folder, ymd)
        kind, _, why = res.partition(":")
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
    took = time.time() - t_start
    log(f"[내보내기] 끝 · 저장 {ok} · 건너뜀 {skip} · 실패 {fails} · 소요 {int(took // 60)}분 {int(took % 60)}초")
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
