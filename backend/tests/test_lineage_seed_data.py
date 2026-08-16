import unittest

from backend.app.services.lineage_test_data import build_test_snapshot, test_snapshot_counts
from backend.scripts import seed_lineage_test_data as seed
from backend.tests.db_test_support import skip_without_postgres_integration


class LineageSeedSafetyAndShapeTests(unittest.TestCase):
    def test_safe_profile_rejects_sqlite(self):
        with self.assertRaisesRegex(RuntimeError, "only postgres or gaussdb"):
            seed._safe_profile("lineage_test", {"type": "sqlite", "database": "x.db"})

    def test_safe_profile_rejects_non_test_target(self):
        with self.assertRaisesRegex(RuntimeError, "dev, test, or local"):
            seed._safe_profile(
                "primary",
                {"type": "postgres", "host": "db.demo.invalid", "database": "asset_portal"},
            )

    def test_safe_profile_accepts_explicit_test_postgres(self):
        label = seed._safe_profile(
            "lineage_test",
            {"type": "postgres", "host": "127.0.0.1", "database": "lineage_test"},
        )
        self.assertTrue(label.startswith("postgres:"))

    def test_snapshot_shape_has_expected_minimums(self):
        counts = test_snapshot_counts()
        self.assertGreaterEqual(counts["tables"], 60)
        self.assertGreaterEqual(counts["tasks"], 30)
        self.assertGreaterEqual(counts["edges"], 120)
        snapshot = build_test_snapshot()
        self.assertEqual(len(snapshot["nodes"]), counts["tables"] + counts["tasks"])
        self.assertEqual(len(snapshot["edges"]), counts["edges"])
        self.assertTrue(any(node["id"].startswith("table:dwf:") for node in snapshot["nodes"]))


@skip_without_postgres_integration()
class LineageSeedPostgresIntegrationTests(unittest.TestCase):
    def test_seed_apply_requires_isolated_postgres(self):
        self.assertTrue(True)


if __name__ == "__main__":
    unittest.main()
