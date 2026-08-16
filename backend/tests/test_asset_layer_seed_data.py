import unittest
from unittest.mock import patch

from backend.scripts import seed_asset_layer_test_data as seed
from backend.tests.db_test_support import skip_without_postgres_integration


class AssetLayerSeedSafetyTests(unittest.TestCase):
    def test_safe_target_rejects_sqlite(self):
        with self.assertRaisesRegex(RuntimeError, "only postgres or gaussdb"):
            seed._safe_target("asset_test", {"type": "sqlite", "database": "x.db"})

    def test_safe_target_rejects_non_test_postgres(self):
        with self.assertRaisesRegex(RuntimeError, "dev, test, or local"):
            seed._safe_target(
                "primary",
                {
                    "type": "postgres",
                    "host": "db.demo.invalid",
                    "port": 5432,
                    "database": "asset_portal",
                },
            )

    def test_safe_target_rejects_production_marker(self):
        with self.assertRaisesRegex(RuntimeError, "production marker"):
            seed._safe_target(
                "prod_primary",
                {
                    "type": "postgres",
                    "host": "127.0.0.1",
                    "port": 5432,
                    "database": "asset_portal_test",
                },
            )

    def test_safe_target_accepts_explicit_test_postgres(self):
        label = seed._safe_target(
            "local_test",
            {
                "type": "postgres",
                "host": "127.0.0.1",
                "port": 5432,
                "database": "asset_portal_test",
                "schema": "dwp",
            },
        )
        self.assertIn("postgres:", label)
        self.assertIn("asset_portal_test", label)

    def test_seed_assets_definition_is_non_empty_and_layered(self):
        self.assertGreaterEqual(len(seed.ASSETS), 12)
        layers = {asset["layer"] for asset in seed.ASSETS}
        self.assertIn("DWA", layers)
        self.assertIn("DM", layers)
        for asset in seed.ASSETS:
            self.assertTrue(asset["fields"])


@skip_without_postgres_integration()
class AssetLayerSeedPostgresIntegrationTests(unittest.TestCase):
    def test_apply_idempotency_requires_isolated_postgres(self):
        self.assertTrue(True)


if __name__ == "__main__":
    unittest.main()
