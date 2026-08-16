# Copyright 2025 Jearhe
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import os
import unittest

from backend.app.core.blueprint_registry import validate_blueprint_registry
from backend.app.core.capabilities import (
    ModuleCapabilityError,
    REASON_DISABLED_BY_CONFIGURATION,
    REASON_REQUIRED_PREFIX,
    resolve_capabilities,
)
from backend.app.core.modules import MODULES, list_module_codes, validate_manifest


class ModuleManifestTestCase(unittest.TestCase):
    def test_manifest_is_internally_consistent(self):
        validate_manifest()
        validate_blueprint_registry()

    def test_real_frontend_codes_present(self):
        expected = {
            "portal",
            "dwm",
            "upstream",
            "mapping",
            "lineage",
            "root",
            "indicator",
            "report",
            "apiAsset",
            "push",
            "codeTable",
            "system",
        }
        self.assertEqual(expected, set(list_module_codes()))

    def test_declared_dependencies(self):
        self.assertNotIn("upstream", MODULES["mapping"]["requires"])
        self.assertNotIn("push", MODULES["apiAsset"]["requires"])


class ModuleCapabilityResolveTestCase(unittest.TestCase):
    def test_default_enables_all_modules(self):
        caps = resolve_capabilities(enabled=None, disabled=[], edition="private", strict=False)
        self.assertEqual("private", caps["edition"])
        self.assertEqual(set(list_module_codes()), set(caps["enabled_codes"]))

    def test_disabled_list_force_off(self):
        caps = resolve_capabilities(
            enabled=None,
            disabled=["report", "codeTable"],
            edition="private",
            strict=False,
        )
        by_code = caps["by_code"]
        self.assertFalse(by_code["report"]["enabled"])
        self.assertEqual(REASON_DISABLED_BY_CONFIGURATION, by_code["report"]["reason"])
        self.assertTrue(by_code["dwm"]["enabled"])

    def test_mapping_remains_enabled_when_upstream_off(self):
        caps = resolve_capabilities(
            enabled=None,
            disabled=["upstream"],
            edition="private",
            strict=False,
        )
        by_code = caps["by_code"]
        self.assertFalse(by_code["upstream"]["enabled"])
        self.assertTrue(by_code["mapping"]["enabled"])

    def test_api_asset_remains_enabled_when_push_off(self):
        caps = resolve_capabilities(
            enabled=None,
            disabled=["push"],
            edition="private",
            strict=False,
        )
        by_code = caps["by_code"]
        self.assertFalse(by_code["push"]["enabled"])
        self.assertTrue(by_code["apiAsset"]["enabled"])

    def test_decoupled_modules_are_valid_in_strict_mode(self):
        caps = resolve_capabilities(
            enabled=None,
            disabled=["upstream", "push"],
            edition="private",
            strict=True,
        )
        self.assertTrue(caps["by_code"]["mapping"]["enabled"])
        self.assertTrue(caps["by_code"]["apiAsset"]["enabled"])

    def test_unknown_module_in_strict_mode(self):
        with self.assertRaises(ModuleCapabilityError):
            resolve_capabilities(
                enabled=["dwm", "notARealModule"],
                disabled=[],
                edition="private",
                strict=True,
            )

    def test_enabled_list_restricts_set(self):
        caps = resolve_capabilities(
            enabled=["portal", "dwm", "system"],
            disabled=[],
            edition="community-test",
            strict=False,
        )
        self.assertEqual({"portal", "dwm", "system"}, set(caps["enabled_codes"]))
        self.assertFalse(caps["by_code"]["upstream"]["enabled"])

    def test_environment_defaults_used(self):
        previous = {
            "ASSET_ENABLED_MODULES": os.getenv("ASSET_ENABLED_MODULES"),
            "ASSET_DISABLED_MODULES": os.getenv("ASSET_DISABLED_MODULES"),
            "ASSET_EDITION": os.getenv("ASSET_EDITION"),
            "ASSET_MODULE_STRICT": os.getenv("ASSET_MODULE_STRICT"),
            "FLASK_ENV": os.getenv("FLASK_ENV"),
        }
        try:
            os.environ.pop("ASSET_ENABLED_MODULES", None)
            os.environ["ASSET_DISABLED_MODULES"] = "report"
            os.environ["ASSET_EDITION"] = "private"
            os.environ["ASSET_MODULE_STRICT"] = "0"
            os.environ["FLASK_ENV"] = "production"
            caps = resolve_capabilities()
            self.assertFalse(caps["by_code"]["report"]["enabled"])
            self.assertTrue(caps["by_code"]["dwm"]["enabled"])
        finally:
            for key, value in previous.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value


if __name__ == "__main__":
    unittest.main()
