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
        for k in ("FIRSTOA_KAKAO_EXPORT_LOAD_WAIT", "FIRSTOA_KAKAO_EXPORT_GAP", "FIRSTOA_KAKAO_EXPORT_DIALOG_WAIT", "FIRSTOA_KAKAO_EXPORT_LIMIT"):
            if os.environ.get(k):
                self.skipTest(f"{k} 가 설정돼 있음")
        self.assertEqual(er.LOAD_WAIT, 10.0)
        self.assertEqual(er.EXPORT_WAIT, 15.0)
        self.assertEqual(er.ROOM_GAP, 20.0)
        self.assertEqual(er.RUN_LIMIT, 3600.0)
        self.assertEqual(er.SETTLE_STABLE, 10.0)
        self.assertEqual(er.SETTLE_MAX, 180.0)

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

    def test_selftest(self):
        self.assertEqual(er.selftest(), 0)


if __name__ == "__main__":
    unittest.main()
