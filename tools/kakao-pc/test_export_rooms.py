# -*- coding: utf-8 -*-
"""export_rooms.py 순수 함수 시험 — 카톡·윈도 API 안 건드림(데스크톱에서도 돌려도 됨)
  python -m unittest tools/kakao-pc/test_export_rooms.py      (저장소 맨 위에서)
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import export_rooms as er  # noqa: E402


class SizeSettled(unittest.TestCase):
    def test_no_file_or_empty(self):
        self.assertFalse(er.size_settled([]))
        self.assertFalse(er.size_settled([(0, -1), (30, -1)], 10))
        self.assertFalse(er.size_settled([(0, 0), (30, 0)], 10))

    def test_still_growing(self):
        self.assertFalse(er.size_settled([(0, 10), (5, 500), (10, 900)], 10))

    def test_settled_after_10s(self):
        s = [(0, -1), (2, 100), (4, 400), (6, 400), (10, 400), (14, 400)]
        self.assertTrue(er.size_settled(s, 10))
        self.assertFalse(er.size_settled(s[:-1], 10))  # 6초만 멈춤


class Settings(unittest.TestCase):
    def test_defaults(self):
        # 환경 변수 없을 때 기본값(2026-10-27 사용자 실측 규칙)
        # 2026-10-28 사용자: 방 내용 기다리기 30초, 저장 1분 정도 → 불러오기 30·멈춤 15·확정 최대 300·완료창 최대 300
        for k in ("FIRSTOA_KAKAO_EXPORT_LOAD_WAIT", "FIRSTOA_KAKAO_EXPORT_GAP", "FIRSTOA_KAKAO_EXPORT_DIALOG_WAIT", "FIRSTOA_KAKAO_EXPORT_LIMIT",
                  "FIRSTOA_KAKAO_EXPORT_DONE_WAIT"):
            if os.environ.get(k):
                self.skipTest(f"{k} 가 설정돼 있음")
        self.assertEqual(er.LOAD_WAIT, 30.0)
        self.assertEqual(er.EXPORT_WAIT, 15.0)
        self.assertEqual(er.ROOM_GAP, 20.0)
        self.assertEqual(er.RUN_LIMIT, 7200.0)  # 120분(2026-10-28 실측 한 방 3분+)
        self.assertEqual(er.SETTLE_STABLE, 15.0)
        self.assertEqual(er.SETTLE_MAX, 300.0)
        self.assertEqual(er.DONE_WAIT, 300.0)

    def test_env_seconds(self):
        k = "FIRSTOA_KAKAO_TEST_SECONDS"
        try:
            os.environ[k] = "x"
            self.assertEqual(er.env_seconds(k, 5.0), 5.0)
            os.environ[k] = "-3"
            self.assertEqual(er.env_seconds(k, 5.0, 0, 60), 0.0)
            os.environ[k] = "30"
            self.assertEqual(er.env_seconds(k, 5.0, 0, 60), 30.0)
        finally:
            os.environ.pop(k, None)

    def test_estimate(self):
        # 창이 다 열려 있을 때: 21방 × (불러오기 10 + 저장 창 15 + 쓰기 15) + 20 텀 × 20 = 1240초 ≈ 20.7분
        self.assertEqual(er.estimate_minutes(21, 10, 15, 20, 15, n_open=0), 20.7)

    def test_estimate_default_21(self):
        # 창이 다 열려 있을 때: 21방 × (불러오기 30 + 저장 창 15 + 내보내기 60·멈춤 15) + 20 텀 × 20 = 2920초 ≈ 48.7분
        self.assertEqual(er.estimate_minutes(21, 30, 15, 20, 75, n_open=0), 48.7)

    def test_estimate_open_all_21(self):
        # 2026-10-29 스스로 열기: 21방 모두 열기 5초 + 닫기 전 8초 → 2920 + 21×13 = 3193초 ≈ 53.2분 → 04:30 시작이면 05:24 무렵, 상한 120분 안
        if os.environ.get("FIRSTOA_KAKAO_EXPORT_CLOSE_WAIT"):
            self.skipTest("FIRSTOA_KAKAO_EXPORT_CLOSE_WAIT 가 설정돼 있음")
        self.assertEqual(er.CLOSE_WAIT, 8.0)
        self.assertEqual(er.estimate_minutes(21, 30, 15, 20, 75), 53.2)  # n_open 기본 = 전부
        self.assertEqual(er.estimate_minutes(21, 30, 15, 20, 75, n_open=21, open_close=er.OPEN_TYPICAL + er.CLOSE_WAIT), 53.2)
        self.assertLessEqual(er.estimate_minutes(21, 30, 15, 20, 75), er.RUN_LIMIT / 60)
        # 실측 한 방 3분+(내보내기 약 135초) 기준이어도 21×(30+15+135+15+13)+20×20 = 4768초 ≈ 79.5분 — 상한 안
        self.assertLessEqual(er.estimate_minutes(21, 30, 15, 20, 150), 120)

    def test_close_env_floor(self):
        # 닫기 전 대기는 8초 밑으로 못 내린다(2026-10-19 닫은 직후 크래시 규칙)
        k = "FIRSTOA_KAKAO_TEST_CLOSE"
        try:
            os.environ[k] = "2"
            self.assertEqual(er.env_seconds(k, 8.0, 8, 120), 8.0)
        finally:
            os.environ.pop(k, None)


class CloseDecision(unittest.TestCase):
    """2026-10-29 방 스스로 열기 — 이번에 연 창만, 팝업·진행 중이 없을 때만 닫는다"""

    def test_close_only_ours_when_clean(self):
        self.assertEqual(er.close_decision(True, True, False, 0), "close")

    def test_never_close_user_window(self):
        self.assertTrue(er.close_decision(False, True, False, 0).startswith("keep:"))
        self.assertTrue(er.close_decision(False, False, False, 0).startswith("keep:"))

    def test_keep_when_busy(self):
        self.assertTrue(er.close_decision(True, True, True, 0).startswith("keep:"))  # 파일이 안 멈춤
        self.assertTrue(er.close_decision(True, True, False, 1).startswith("keep:"))  # 완료창·저장 창 남음

    def test_gone(self):
        self.assertEqual(er.close_decision(True, False, False, 0), "gone")


class DonePopup(unittest.TestCase):
    """2026-10-28 23:50 노트북 실측(probe_windows.py) 4줄 — 완료창만 True"""
    ROOM, MAIN = 0x1006B6, 0x202EA

    def test_measured_windows(self):
        r, m = self.ROOM, self.MAIN
        self.assertTrue(er.is_done_popup("EVA_Window_Dblclk", r, r, "", 0, 300, 225))  # 0xd06d8 완료창
        self.assertFalse(er.is_done_popup("EVA_Window_Dblclk", 0, r, "강남C 점검방", 4, 380, 640))  # 방 창
        self.assertFalse(er.is_done_popup("EVA_Window_Dblclk", m, r, "", 10, 390, 100))  # 광고 창(메인 창 소유)
        self.assertFalse(er.is_done_popup("EVA_Window_Dblclk", 0, r, "카카오톡", 30, 490, 1020))  # 메인 창

    def test_edges(self):
        r, m = self.ROOM, self.MAIN
        self.assertFalse(er.is_done_popup("EVA_Window_Dblclk", m, r, "", 0, 300, 225))  # 메인 창 소유면 모양이 같아도 아님
        self.assertFalse(er.is_done_popup("#32770", r, r, "", 0, 300, 225))
        self.assertFalse(er.is_done_popup("EVA_Window_Dblclk", 0, 0, "", 0, 300, 225))
        self.assertFalse(er.is_done_popup("EVA_Window_Dblclk", r, r, "대화 내보내기", 0, 300, 225))
        self.assertFalse(er.is_done_popup("EVA_Window_Dblclk", r, r, "", 2, 300, 225))
        self.assertFalse(er.is_done_popup("EVA_Window_Dblclk", r, r, "", 0, 150, 225))
        self.assertFalse(er.is_done_popup("EVA_Window_Dblclk", r, r, "", 0, 300, 100))
        self.assertTrue(er.is_done_popup("EVA_Window_Dblclk", r, r, "", 0, 500, 400))  # 경계 포함

    def test_file_unchanged_before_enter(self):
        # 방지훈 ②A — Enter 직전 크기·mtime 이 확정 값과 같아야만 누른다
        self.assertTrue(er.file_unchanged((15127552, 1730127000.0), (15127552, 1730127000.0)))
        self.assertFalse(er.file_unchanged((15127552, 1730127000.0), (15200000, 1730127020.0)))
        self.assertFalse(er.file_unchanged((15127552, 1730127000.0), (15127552, 1730127020.0)))
        self.assertFalse(er.file_unchanged((15127552, 1730127000.0), (None, None)))

    def test_rooms_with_partial(self):
        # 방지훈 ②B — 오늘 날짜 .partial 이 있는 방은 시작 때 잔여 정리에서 건너뛴다
        names = ["강남C 점검방_20261028.txt.partial", "AS C방_20261028.txt", "PC_IT_20261027.txt.partial"]
        got = er.rooms_with_partial(["강남C 점검방", "AS C방", "PC/IT"], names, "20261028")
        self.assertEqual(got, {"강남C 점검방"})
        self.assertEqual(er.rooms_with_partial(["PC/IT"], names, "20261027"), {"PC/IT"})


class RetryRules(unittest.TestCase):
    """2026-10-29b — 첫 실전(저장 15·실패 3, 누적 3번으로 중단) 뒤: 연속 실패만 세고, 실패한 방은 끝에서 한 번 더"""

    def run_streak(self, kinds):
        st = 0
        for k in kinds:
            st = er.next_fail_streak(st, k)
        return st

    def test_success_resets(self):
        self.assertEqual(self.run_streak(["fail", "fail", "ok"]), 0)
        self.assertEqual(self.run_streak(["fail", "ok", "fail", "ok", "fail"]), 1)  # 실측처럼 띄엄띄엄 3번 → 중단 아님

    def test_three_in_a_row_stops(self):
        self.assertGreaterEqual(self.run_streak(["ok", "fail", "fail", "fail"]), er.MAX_FAILS)
        self.assertEqual(er.MAX_FAILS, 3)

    def test_skip_keeps_streak(self):
        self.assertEqual(self.run_streak(["fail", "skip", "fail"]), 2)
        self.assertEqual(self.run_streak(["fail", "fail", "stop"]), 3)

    def test_end_retry_measured(self):
        # 2026-10-29 04:30~04:56 노트북 로그의 실패 3줄 — 셋 다 끝에서 다시 시도 대상
        failed = [("강북A 점검방", "방 열기 9초 → Ctrl+S 뒤 15초 안에 창이 안 뜸(불러오기 대기 30초 → Ctrl+S) → 8초 쉬고 저장 뒤 닫음"),
                  ("경기D/초과사용 계약종료체크", "방 열기 8초 → 맨 앞 창 확인 실패"),
                  ("신)CD불만고객방", "Ctrl+S 뒤 15초 안에 창이 안 뜸(불러오기 대기 30초 → Ctrl+S)")]
        self.assertEqual(er.end_retry_rooms(failed), ["강북A 점검방", "경기D/초과사용 계약종료체크", "신)CD불만고객방"])

    def test_end_retry_excludes_maybe_written(self):
        # 파일이 생겼을 수 있는 실패는 다시 Ctrl+S 하지 않는다
        failed = [("A", "파일 쓰기가 300초 안에 안 끝남(1,000 KB … → .partial 로 치움)"),
                  ("B", "확인창이 뜸('다른 이름으로 저장 확인') — 덮어쓰기/경로 문제"),
                  ("C", "저장 창이 안 닫힘"),
                  ("D", "파일 이름 칸 글이 기대와 다름('x') — 저장 안 함"),
                  ("E", "방 열기 실패(hung, 6초)"),
                  ("E", "방 열기 실패(hung, 6초)")]
        self.assertEqual(er.end_retry_rooms(failed), ["E"])
        self.assertEqual(er.end_retry_rooms([]), [])
        self.assertEqual(er.end_retry_rooms(None), [])


class ExportWindow(unittest.TestCase):
    def test_default_name_file(self):
        ents = [("KakaoTalk_20261028_2315_01.txt", 1000.0, 12345), ("KakaoTalk_old.txt", 10.0, 50), ("빈.txt", 1001.0, 0)]
        self.assertEqual(er.pick_default_name_file(ents, 999.0, "강남C 점검방_20261028.txt"), "KakaoTalk_20261028_2315_01.txt")
        self.assertEqual(er.pick_default_name_file(ents, 2000.0, "강남C 점검방_20261028.txt"), "")

    def test_selftest(self):
        self.assertEqual(er.selftest(), 0)


if __name__ == "__main__":
    unittest.main()
