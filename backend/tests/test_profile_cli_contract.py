from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import yaml

from backend.app.db import facade


class OperationalProfileResolutionTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        root = Path(self.temp_dir.name)
        self.config_path = root / "database.yaml"
        profiles = {
            name: {"type": "sqlite", "database": str(root / f"{name}.sqlite")}
            for name in ("app_test", "explicit_test", "primary", "legacy_test")
        }
        self.config_path.write_text(
            yaml.safe_dump({"profiles": profiles}), encoding="utf-8"
        )
        self.environment = patch.dict(
            os.environ,
            {"ASSET_DB_CONFIG_PATH": str(self.config_path)},
            clear=True,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.warning_state = patch.object(
            facade, "_LEGACY_AUTH_PROFILE_WARNING_EMITTED", False
        )
        self.warning_state.start()
        self.addCleanup(self.warning_state.stop)

    def test_no_explicit_target_requires_valid_asset_profile(self):
        with self.assertRaisesRegex(RuntimeError, "ASSET_DB_PROFILE"):
            facade.resolve_cli_db_profile_name()

    def test_no_primary_fallback_even_when_primary_exists(self):
        os.environ["ASSET_AUTH_DB_PROFILE"] = "legacy_test"
        with self.assertRaisesRegex(RuntimeError, "cannot be used as a replacement"):
            facade.resolve_cli_db_profile_name()

    def test_default_uses_and_validates_asset_profile(self):
        os.environ["ASSET_DB_PROFILE"] = "app_test"
        self.assertEqual("app_test", facade.resolve_cli_db_profile_name())

    def test_explicit_cli_target_is_validated_and_may_override_asset_profile(self):
        os.environ["ASSET_DB_PROFILE"] = "app_test"
        self.assertEqual(
            "explicit_test", facade.resolve_cli_db_profile_name("explicit_test")
        )

    def test_invalid_explicit_target_does_not_fall_back_to_asset_or_primary(self):
        os.environ["ASSET_DB_PROFILE"] = "app_test"
        with self.assertRaisesRegex(KeyError, "profile not found"):
            facade.resolve_cli_db_profile_name("missing_profile")

    def test_blank_explicit_target_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "must not be blank"):
            facade.resolve_cli_db_profile_name("  ")

    def test_explicit_target_does_not_hide_legacy_profile_conflict(self):
        os.environ["ASSET_DB_PROFILE"] = "app_test"
        os.environ["ASSET_AUTH_DB_PROFILE"] = "legacy_test"
        with self.assertRaisesRegex(ValueError, "conflicts"):
            facade.resolve_cli_db_profile_name("explicit_test")

    def test_explicit_target_does_not_hide_auth_only_legacy_configuration(self):
        os.environ["ASSET_AUTH_DB_PROFILE"] = "legacy_test"
        with self.assertRaisesRegex(RuntimeError, "cannot be used as a replacement"):
            facade.resolve_cli_db_profile_name("explicit_test")


if __name__ == "__main__":
    unittest.main()
