# pyright: reportMissingImports=false

import os
import unittest
from unittest.mock import patch

from backend.app.core.capabilities import (
    ModuleCapabilityError,
    capabilities_public_payload,
    is_module_enabled,
    is_repository_module,
    resolve_capabilities,
)
from backend.app.core.modules import MODULES, list_module_codes, validate_manifest
from backend.app.core.profiles import apply_runtime_profile


class ModuleManifestTestCase(unittest.TestCase):
    def test_manifest_is_internally_consistent(self):
        validate_manifest()

    def test_repository_module_codes_are_complete(self):
        expected = {
            "portal", "dwm", "upstream", "mapping", "lineage", "root",
            "indicator", "report", "apiAsset", "push", "codeTable", "system",
        }
        self.assertEqual(expected, set(list_module_codes()))

    def test_manifest_has_no_edition_metadata(self):
        self.assertTrue(all("edition" not in meta for meta in MODULES.values()))
        self.assertTrue(all(meta["enabled_by_default"] for meta in MODULES.values()))

    def test_mapping_and_api_asset_are_independent(self):
        self.assertEqual([], MODULES["mapping"]["requires"])
        self.assertEqual([], MODULES["apiAsset"]["requires"])


class ModuleCapabilityResolveTestCase(unittest.TestCase):
    def test_default_capability_opens_every_repository_module(self):
        capabilities = resolve_capabilities()
        self.assertEqual(set(list_module_codes()), set(capabilities["enabled_codes"]))
        self.assertTrue(all(item["enabled"] for item in capabilities["modules"]))
        self.assertTrue(all(item["reason"] is None for item in capabilities["modules"]))
        self.assertNotIn("edition", capabilities)

    def test_public_payload_is_edition_free_and_complete(self):
        payload = capabilities_public_payload(resolve_capabilities())
        self.assertNotIn("edition", payload)
        self.assertEqual(set(list_module_codes()), {item["code"] for item in payload["modules"]})
        self.assertTrue(all(item["enabled"] for item in payload["modules"]))

    def test_public_payload_ignores_injected_enablement_state(self):
        payload = capabilities_public_payload(
            {
                "modules": [{"code": "dwm", "enabled": False, "reason": "disabled"}],
                "enabled_codes": [],
            }
        )
        self.assertEqual(set(list_module_codes()), {item["code"] for item in payload["modules"]})
        self.assertTrue(all(item["enabled"] for item in payload["modules"]))

    def test_module_identity_helper_is_not_a_runtime_enablement_gate(self):
        self.assertTrue(is_repository_module("dwm"))
        self.assertFalse(is_repository_module("not-a-repository-module"))
        self.assertEqual(is_repository_module("dwm"), is_module_enabled("dwm"))

    def test_runtime_profile_does_not_change_repository_module_set(self):
        with patch.dict(os.environ, {"ASSET_RUNTIME_PROFILE": "community"}, clear=False):
            apply_runtime_profile()
            self.assertEqual(
                set(list_module_codes()),
                {item["code"] for item in resolve_capabilities()["modules"]},
            )

    def test_legacy_module_capability_error_contract_is_retained(self):
        error = ModuleCapabilityError("contract error", details=["detail"])
        self.assertEqual("MODULE_CAPABILITY_ERROR", error.to_dict()["code"])
        self.assertEqual(["detail"], error.to_dict()["details"])


if __name__ == "__main__":
    unittest.main()
