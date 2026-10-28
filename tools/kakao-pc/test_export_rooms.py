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


class ExportWindow(unittest.TestCase):
    def test_title(self):
        self.assertTrue(er.is_export_window_title("대화 내보내기"))
        self.assertFalse(er.is_export_window_title("다른 이름으로 저장 확인"))

    def test_done(self):
        self.assertFalse(er.export_window_done("대화 내보내기", [("Static", "37%", True), ("Button", "취소", True)]))
        self.assertFalse(er.export_window_done("대화 내보내기", []))
        self.assertTrue(er.export_window_done("대화 내보내기", [("Static", "100% 완료되었습니다.", True), ("Button", "확인", True)]))
        self.assertTrue(er.export_window_done("대화 내보내기", [("Button", "폴더열기", True), ("Button", "확인", True)]))
        self.assertFalse(er.export_window_done("대화 내보내기", [("Button", "확인", False)]))

    def test_default_name_file(self):
        ents = [("KakaoTalk_20261028_2315_01.txt", 1000.0, 12345), ("KakaoTalk_old.txt", 10.0, 50), ("빈.txt", 1001.0, 0)]
        self.assertEqual(er.pick_default_name_file(ents, 999.0, "강남C 점검방_20261028.txt"), "KakaoTalk_20261028_2315_01.txt")
        self.assertEqual(er.pick_default_name_file(ents, 2000.0, "강남C 점검방_20261028.txt"), "")

    def test_selftest(self):
        self.assertEqual(er.selftest(), 0)


if __name__ == "__main__":
    unittest.main()
