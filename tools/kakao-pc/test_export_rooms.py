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
        # 21방 × (불러오기 10 + 저장 창 15 + 쓰기 15) + 20 텀 × 20 = 1240초 ≈ 20.7분
        self.assertEqual(er.estimate_minutes(21, 10, 15, 20, 15), 20.7)

    def test_estimate_default_21(self):
        # 21방 × (불러오기 30 + 저장 창 15 + 내보내기 60·멈춤 15) + 20 텀 × 20 = 2920초 ≈ 48.7분 → 05:30 시작이면 06:19 무렵, 상한 60분 안
        self.assertEqual(er.estimate_minutes(21, 30, 15, 20, 75), 48.7)
        self.assertLessEqual(er.estimate_minutes(21, 30, 15, 20, 75), 60)


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


class ExportWindow(unittest.TestCase):
    def test_default_name_file(self):
        ents = [("KakaoTalk_20261028_2315_01.txt", 1000.0, 12345), ("KakaoTalk_old.txt", 10.0, 50), ("빈.txt", 1001.0, 0)]
        self.assertEqual(er.pick_default_name_file(ents, 999.0, "강남C 점검방_20261028.txt"), "KakaoTalk_20261028_2315_01.txt")
        self.assertEqual(er.pick_default_name_file(ents, 2000.0, "강남C 점검방_20261028.txt"), "")

    def test_selftest(self):
        self.assertEqual(er.selftest(), 0)


if __name__ == "__main__":
    unittest.main()
