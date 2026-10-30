"""#414 lineage storage-mode contract: no live database required."""

import unittest
from unittest.mock import patch

from backend.app.services.lineage_service import (
    LineageConfigurationError,
    lineage_storage_status,
)


class LineageStorageModeContractTests(unittest.TestCase):
    def _status(self, *, mode=None, profile=None, environment="development"):
        values = {"APP_ENV": environment}
        if mode is not None:
            values["LINEAGE_STORAGE_MODE"] = mode
        if profile is not None:
            values["LINEAGE_DB_PROFILE"] = profile
        with patch.dict("os.environ", values, clear=True):
            return lineage_storage_status()

    def test_explicit_poc_in_development(self):
        self.assertEqual("poc", self._status(mode="poc")["mode"])

    def test_legacy_development_auto_still_works(self):
        self.assertEqual("poc", self._status()["mode"])

    def test_poc_rejected_in_production(self):
        with self.assertRaises(LineageConfigurationError):
            self._status(mode="poc", environment="production")

    def test_poc_profile_conflict_rejected(self):
        with self.assertRaises(LineageConfigurationError):
            self._status(mode="poc", profile="primary")

    def test_explicit_persistent_requires_profile(self):
        with self.assertRaises(LineageConfigurationError):
            self._status(mode="persistent")

    def test_unknown_mode_rejected(self):
        with self.assertRaises(LineageConfigurationError):
            self._status(mode="mokc")

    def test_production_auto_requires_profile(self):
        with self.assertRaises(LineageConfigurationError):
            self._status(environment="production")


if __name__ == "__main__":
    unittest.main()
