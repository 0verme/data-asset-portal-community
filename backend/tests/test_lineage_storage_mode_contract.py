"""Lineage must use the sole DAP metadata DB profile, never an implicit POC."""

import os
import unittest
from unittest.mock import patch

from backend.app.services import lineage_service


class LineageStorageModeContractTests(unittest.TestCase):
    def _status(self, environment, *, extra=None, config=None):
        values = {"APP_ENV": environment, "ASSET_DB_PROFILE": "dap_test"}
        values.update(extra or {})
        selected_config = config or {"type": "postgres", "schema": "custom_metadata"}
        with (
            patch.dict(os.environ, values, clear=True),
            patch.object(
                lineage_service, "get_db_profile", return_value=selected_config
            ) as get_profile,
            patch.object(lineage_service, "get_provider") as get_provider,
        ):
            get_provider.return_value.physical_schema.return_value = selected_config.get("schema")
            result = lineage_service.lineage_storage_status()

        get_profile.assert_called_once_with("dap_test")
        get_provider.assert_called_once_with(selected_config["type"])
        return result

    def test_development_and_production_both_use_dap_profile(self):
        for environment in ("development", "dev", "test", "production"):
            with self.subTest(environment=environment):
                status = self._status(environment)
                self.assertEqual(
                    {
                        "mode": "persistent",
                        "profile": "dap_test",
                        "schema": "custom_metadata",
                    },
                    status,
                )

    def test_deprecated_lineage_variables_never_switch_to_poc_or_another_db(self):
        status = self._status(
            "development",
            extra={
                "LINEAGE_DB_PROFILE": "unrelated_db",
                "LINEAGE_STORAGE_MODE": "poc",
            },
        )
        self.assertEqual("persistent", status["mode"])
        self.assertEqual("dap_test", status["profile"])

    def test_missing_asset_profile_fails_closed(self):
        with patch.dict(os.environ, {"APP_ENV": "development"}, clear=True):
            with self.assertRaises(lineage_service.LineageConfigurationError) as raised:
                lineage_service.lineage_storage_status()
        self.assertIn("ASSET_DB_PROFILE", str(raised.exception))

    def test_invalid_dap_profile_fails_closed_without_demo_fallback(self):
        with (
            patch.dict(os.environ, {"ASSET_DB_PROFILE": "missing"}, clear=True),
            patch.object(
                lineage_service, "get_db_profile", side_effect=KeyError("missing")
            ),
        ):
            with self.assertRaises(lineage_service.LineageConfigurationError) as raised:
                lineage_service.lineage_storage_status()
        self.assertEqual("LINEAGE_CONFIGURATION_ERROR", raised.exception.to_dict()["code"])
        self.assertNotIn("poc", str(raised.exception).lower())

    def test_schema_defaults_to_database_name_when_provider_has_no_schema(self):
        status = self._status(
            "production",
            config={"type": "mysql", "database": "asset_metadata"},
        )
        self.assertEqual("asset_metadata", status["schema"])


if __name__ == "__main__":
    unittest.main()
