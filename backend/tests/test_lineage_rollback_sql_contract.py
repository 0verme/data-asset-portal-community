from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ROLLBACK_SQL = ROOT / "docs" / "dws" / "lineage-snapshot-rollback.sql"
LINEAGE_GUIDE = ROOT / "docs" / "lineage_bulk_import_guide.md"


class DwsLineageRollbackTargetContractTests(unittest.TestCase):
    def test_dap_session_guard_precedes_lock_and_persistent_dml(self):
        sql = ROLLBACK_SQL.read_text(encoding="utf-8")
        guard_insert = sql.index(
            "INSERT INTO tmp_lineage_rollback_schema_guard (validation_passed)"
        )
        first_lock = sql.index("LOCK TABLE dap.p_lineage_snapshot")

        self.assertLess(guard_insert, first_lock)
        self.assertIn("current_schema() = 'dap'", sql[guard_insert:first_lock])
        self.assertRegex(sql, r"validation_passed\s+SMALLINT\s+NOT NULL")
        self.assertNotIn("UPDATE dap.", sql[:first_lock])
        self.assertNotIn("dwp.", sql)

        update_targets = re.findall(r"(?im)^\s*UPDATE\s+([^\s]+)", sql)
        self.assertEqual(
            ["dap.p_lineage_snapshot", "dap.p_lineage_snapshot"], update_targets
        )

    def test_guide_marks_rollback_as_dap_only_and_preserves_external_scheduler_source_boundary(self):
        guide = LINEAGE_GUIDE.read_text(encoding="utf-8")
        self.assertIn("非 `dap` Profile 不得执行此文件", guide)
        self.assertIn("`dwp.p_job` / `p_program` 表示部署方调度源表", guide)
        self.assertIn("其外部 source schema 由部署环境决定", guide)
        self.assertIn("current_schema()", guide)
        self.assertIn("未在真实 DWS 部署实例验证", guide)


if __name__ == "__main__":
    unittest.main()
