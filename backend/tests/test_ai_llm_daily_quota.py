from __future__ import annotations

import multiprocessing
import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from threading import Barrier
from unittest.mock import patch

from backend.app.db.sqlite_adapter import connect
from backend.app.migrations.schema import initialize
from backend.app.services.ai_llm_daily_quota import (
    DailyLLMQuotaExceeded,
    DailyLLMQuotaService,
    DailyLLMQuotaUnavailable,
    current_business_date,
)


def _reserve_quota_in_process(business_date, barrier, results):
    service = DailyLLMQuotaService(
        profile_getter=lambda: "quota_test",
        clock=lambda: datetime.fromisoformat(f"{business_date}T12:00:00+08:00"),
    )
    barrier.wait(timeout=30)
    try:
        service.reserve()
        results.put("reserved")
    except DailyLLMQuotaExceeded:
        results.put("exceeded")
    except Exception as error:
        results.put(f"unexpected:{type(error).__name__}")


class DailyLLMQuotaServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="ai-llm-daily-quota-")
        self.addCleanup(self.temp_dir.cleanup)
        root = Path(self.temp_dir.name)
        self.database = root / "quota.sqlite"
        self.config_path = root / "database.yaml"
        self.config_path.write_text(
            "profiles:\n"
            "  quota_test:\n"
            "    type: sqlite\n"
            f"    database: '{self.database.as_posix()}'\n",
            encoding="utf-8",
        )
        self.environment = patch.dict(os.environ, {
            "ASSET_DB_CONFIG_PATH": str(self.config_path),
            "ASSET_DB_PROFILE": "quota_test",
        }, clear=False)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        config = {"type": "sqlite", "database": str(self.database)}
        self.connection = connect(config)
        self.addCleanup(self.connection.close)
        self.assertTrue(initialize(self.connection, config, "sqlite"))
        self._seed(limit=3, used=0, business_date="2026-11-07")
        self.now = [datetime(2026, 11, 7, 12, 0, tzinfo=UTC)]
        self.services = [
            DailyLLMQuotaService(
                profile_getter=lambda: "quota_test",
                clock=lambda: self.now[0],
            )
            for _ in range(12)
        ]

    def _seed(self, *, limit: int, used: int, business_date: str):
        self.connection.execute(
            "INSERT INTO dwp.p_code_category "
            "(category_id, category_code, category_name, category_desc, display_order, "
            "is_active, created_by, updated_by) VALUES (1, ?, ?, ?, 1, 'N', 'test', 'test')",
            ("AI_LLM_QUOTA_CONFIG", "AI 问答配置", "Synthetic quota test"),
        )
        self.connection.execute(
            "INSERT INTO dwp.p_code_item "
            "(item_id, category_code, item_code, item_name, item_value, item_desc, "
            "display_order, is_active, created_by, updated_by) "
            "VALUES (1, ?, ?, ?, ?, ?, 1, 'N', 'test', 'test')",
            (
                "AI_LLM_QUOTA_CONFIG",
                "AI_LLM_DAILY_LIMIT",
                "每日 LLM 调用上限",
                str(limit),
                "Synthetic test setting",
            ),
        )
        self.connection.execute(
            "INSERT INTO dwp.p_ai_llm_daily_usage "
            "(scope_key, business_date, used_count) VALUES ('GLOBAL', ?, ?)",
            (business_date, used),
        )
        self.connection.commit()

    def test_reservations_are_database_atomic_across_service_instances(self):
        self.connection.execute(
            "UPDATE dwp.p_code_item SET item_value = '13' "
            "WHERE category_code = 'AI_LLM_QUOTA_CONFIG' AND item_code = 'AI_LLM_DAILY_LIMIT'"
        )
        self.connection.commit()
        barrier = Barrier(12)

        def reserve(index: int):
            barrier.wait(timeout=10)
            try:
                return self.services[index].reserve().business_date
            except DailyLLMQuotaExceeded:
                return "exceeded"

        with ThreadPoolExecutor(max_workers=12) as pool:
            results = list(pool.map(reserve, range(12)))

        self.assertEqual(12, results.count("2026-11-07"))
        self.assertEqual(0, results.count("exceeded"))
        # A second wave races past the remaining one slot.
        with ThreadPoolExecutor(max_workers=12) as pool:
            second = list(pool.map(reserve, range(12)))
        self.assertEqual(1, second.count("2026-11-07"))
        self.assertEqual(11, second.count("exceeded"))
        self.assertEqual(13, self.services[0].snapshot().used)
        self.assertEqual(0, self.services[0].snapshot().remaining)

    def test_cross_process_race_allows_only_one_last_slot(self):
        process_count = 6
        today = current_business_date().isoformat()
        self.connection.execute(
            "UPDATE dwp.p_code_item SET item_value = '1' WHERE item_code = 'AI_LLM_DAILY_LIMIT'"
        )
        self.connection.execute(
            "UPDATE dwp.p_ai_llm_daily_usage SET business_date = ?, used_count = 0 "
            "WHERE scope_key = 'GLOBAL'",
            (today,),
        )
        self.connection.commit()

        context = multiprocessing.get_context("spawn")
        barrier = context.Barrier(process_count)
        results = context.Queue()
        processes = [
            context.Process(target=_reserve_quota_in_process, args=(today, barrier, results))
            for _ in range(process_count)
        ]
        try:
            for process in processes:
                process.start()
            outcomes = [results.get(timeout=45) for _ in processes]
            for process in processes:
                process.join(timeout=45)
            self.assertTrue(all(process.exitcode == 0 for process in processes))
            self.assertEqual(1, outcomes.count("reserved"), outcomes)
            self.assertEqual(process_count - 1, outcomes.count("exceeded"), outcomes)
            self.assertEqual(1, self.services[0].snapshot().used)
        finally:
            for process in processes:
                if process.is_alive():
                    process.terminate()
                process.join(timeout=5)
            results.close()

    def test_missing_setting_uses_default_but_missing_counter_fails_closed(self):
        self.connection.execute("DELETE FROM dwp.p_code_item WHERE item_code = 'AI_LLM_DAILY_LIMIT'")
        self.connection.commit()
        self.assertEqual(50, self.services[0].get_daily_limit())
        self.services[0].reserve()
        self.assertEqual(1, self.services[0].snapshot().used)

        self.connection.execute("DELETE FROM dwp.p_ai_llm_daily_usage")
        self.connection.commit()
        with self.assertRaises(DailyLLMQuotaUnavailable):
            self.services[0].reserve()
        with self.assertRaises(DailyLLMQuotaUnavailable):
            self.services[0].snapshot()

    def test_invalid_setting_and_business_date_fail_closed(self):
        self.connection.execute(
            "UPDATE dwp.p_code_item SET item_value = '0' WHERE item_code = 'AI_LLM_DAILY_LIMIT'"
        )
        self.connection.commit()
        with self.assertRaises(DailyLLMQuotaUnavailable):
            self.services[0].reserve()
        self.connection.execute(
            "UPDATE dwp.p_code_item SET item_value = '3' WHERE item_code = 'AI_LLM_DAILY_LIMIT'"
        )
        self.connection.execute(
            "UPDATE dwp.p_ai_llm_daily_usage SET business_date = 'not-a-date' WHERE scope_key = 'GLOBAL'"
        )
        self.connection.commit()
        with self.assertRaises(DailyLLMQuotaUnavailable):
            self.services[0].snapshot()

    def test_business_day_rollover_is_lazy_and_old_refund_cannot_decrement_new_day(self):
        old_reservation = self.services[0].reserve()
        self.assertEqual(1, self.services[0].snapshot().used)
        self.now[0] = datetime(2026, 11, 7, 16, 0, tzinfo=UTC)  # 2026-11-08 00:00 Beijing
        self.assertEqual("2026-11-08", self.services[0].snapshot().business_date)
        self.assertEqual(0, self.services[0].snapshot().used)
        new_reservation = self.services[0].reserve()
        self.assertEqual("2026-11-08", new_reservation.business_date)
        self.assertEqual(1, self.services[0].snapshot().used)
        self.assertFalse(self.services[0].refund(old_reservation))
        self.assertEqual(1, self.services[0].snapshot().used)
        self.assertTrue(self.services[0].refund(new_reservation))
        self.assertEqual(0, self.services[0].snapshot().used)


if __name__ == "__main__":
    unittest.main()
