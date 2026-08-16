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

"""Guard tests for the Repository Public Data Guard scanner."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND.parent
if str(REPO_ROOT / "demo") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "demo"))

from safety_scan import classify, scan_file  # noqa: E402


def severities(findings):
    return [f["severity"] for f in findings]


class ClassifyNetworkTests(unittest.TestCase):
    def test_private_ipv4_is_blocker(self):
        findings = classify("host: 10.20.1.11", "sample")
        self.assertIn("BLOCKER", severities(findings))

    def test_192_168_and_172_16_31_are_blockers(self):
        for ip in ("192.168.0.1", "172.16.0.1", "172.31.255.255"):
            findings = classify(f"host={ip}", "sample")
            self.assertIn("BLOCKER", severities(findings), ip)

    def test_documentation_ip_is_safe(self):
        for ip in ("192.0.2.11", "198.51.100.10", "203.0.113.5"):
            findings = classify(f"host: {ip}", "sample")
            self.assertNotIn("BLOCKER", severities(findings), ip)

    def test_internal_domain_suffix_is_suspicious(self):
        findings = classify("sftp.cbs.intra", "sample")
        self.assertIn("SUSPICIOUS", severities(findings))

    def test_example_placeholder_domain_is_safe(self):
        # RFC 2606-style placeholder hosts inside vendored third-party docs
        # (e.g. `registry.example.internal`) are documentation, not real hosts.
        findings = classify("@lineage-viewer:registry=https://registry.example.internal/", "sample")
        self.assertNotIn("SUSPICIOUS", severities(findings))

    def test_plain_word_internal_is_not_a_domain(self):
        findings = classify("Internal Shadow DOM classes", "sample")
        self.assertNotIn("SUSPICIOUS", severities(findings))

    def test_http_status_phrase_is_safe(self):
        findings = classify("500 Internal Server Error", "sample")
        self.assertNotIn("SUSPICIOUS", severities(findings))


class ClassifySecretTests(unittest.TestCase):
    def test_placeholder_secret_is_expected(self):
        findings = classify("password: change_me", "sample")
        self.assertIn("EXPECTED", severities(findings))
        self.assertNotIn("SUSPICIOUS", severities(findings))

    def test_env_var_reference_is_expected(self):
        findings = classify("export ASSET_DB_PASSWORD=<store-in-secret-manager>", "sample")
        self.assertIn("EXPECTED", severities(findings))
        self.assertNotIn("SUSPICIOUS", severities(findings))

    def test_example_connection_string_is_expected(self):
        findings = classify("示例：$env:SYNC_PG_DSN='postgresql://user:pass@host:5432/db'", "sample")
        self.assertNotIn("SUSPICIOUS", severities(findings))


class ClassifyPathTests(unittest.TestCase):
    def test_windows_user_path_is_blocker(self):
        findings = classify(r'path = "C:\Users\someone\repo"', "sample")
        self.assertIn("BLOCKER", severities(findings))

    def test_generic_unix_path_is_not_flagged(self):
        findings = classify("/opt/data-asset-portal/scripts", "sample")
        self.assertNotIn("BLOCKER", severities(findings))

    def test_npm_workspace_term_is_not_internal_marker(self):
        findings = classify("npm workspaces: frontend/packages/*", "sample")
        self.assertNotIn("SUSPICIOUS", severities(findings))

    def test_internal_svn_markers_are_still_suspicious(self):
        for marker in ("svn://internal/some/path", "DIDP_PROJECT/x", "hcyttrunk/trunk"):
            findings = classify(marker, "sample")
            self.assertIn("SUSPICIOUS", severities(findings), marker)


class ClassifyBusinessTests(unittest.TestCase):
    def test_naming_reference_row_is_safe(self):
        text = "loan|loan|贷款|业务对象|用于 loan_no、loan_bal"
        findings = classify(text, "sample")
        self.assertNotIn("SUSPICIOUS", severities(findings))

    def test_bare_bank_term_is_suspicious(self):
        findings = classify("核心银行系统提供账户服务", "sample")
        self.assertIn("SUSPICIOUS", severities(findings))


class ScanFileTests(unittest.TestCase):
    def test_scan_file_classifies_text_file(self):
        tmp = BACKEND / "tests" / "tmp_guard_probe.txt"
        tmp.write_text("host: 10.1.1.1\npassword: change_me\n", encoding="utf-8")
        try:
            findings = scan_file(tmp, REPO_ROOT)
            self.assertIn("BLOCKER", severities(findings))
        finally:
            tmp.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
