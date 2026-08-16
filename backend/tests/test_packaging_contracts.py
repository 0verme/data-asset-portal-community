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

"""Clean-install packaging contracts for the public repository.

Guards against the historical risks that broke a fresh clone:

  - npm dependencies pointing at the machine-local lineage-viewer directory
    (or any file:/link:/absolute path);
  - workspace packages declared but missing from the tree;
  - lockfile entries referencing private registries or localhost;
  - README references to images / scripts / config files that do not exist;
  - lineage packages that were once vendored from a machine-local build.

These tests are read-only and runnable in a clean clone (no node_modules,
no venv). They complement demo/validate_demo_data.py's secret/IP scanning.
"""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND = REPO_ROOT / "frontend"
PKG_JSON = FRONTEND / "package.json"
PKG_LOCK = FRONTEND / "package-lock.json"

LINEAGE_PACKAGES = (
    "lineage-viewer",
    "@lineage-viewer/react",
    "@lineage-viewer/domain-adapter",
)
WORKSPACE_DIRS = (
    "packages/lineage-viewer",
    "packages/lineage-viewer-react",
    "packages/lineage-viewer-domain-adapter",
)

# Dependency specifiers that cannot be reproduced from a clean clone.
FORBIDDEN_SPEC_PREFIXES = ("file:", "link:", "git+file:")
ABSOLUTE_PATH_RE = re.compile(r"^[A-Za-z]:[\\/]|^/|^\\\\")

# README files whose referenced local assets must exist.
DOC_README = REPO_ROOT / "README.md"


def _load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


class DependencyContractTests(unittest.TestCase):
    """Test 1: package.json dependencies are installable from a clean clone."""

    def test_no_forbidden_dependency_specifiers(self):
        pkg = _load_json(PKG_JSON)
        all_deps = {}
        for section in ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies"):
            all_deps.update(pkg.get(section, {}))
        self.assertTrue(all_deps, "package.json declares no dependencies at all")
        for name, spec in all_deps.items():
            self.assertFalse(
                spec.startswith(FORBIDDEN_SPEC_PREFIXES),
                f"{name} uses non-reproducible specifier: {spec}",
            )
            self.assertFalse(
                ABSOLUTE_PATH_RE.match(spec),
                f"{name} uses an absolute path specifier: {spec}",
            )

    def test_lineage_packages_are_fixed_versions(self):
        pkg = _load_json(PKG_JSON)
        for name in LINEAGE_PACKAGES:
            self.assertEqual(
                pkg.get("dependencies", {}).get(name),
                "1.1.0",
                f"{name} must be pinned to 1.1.0",
            )


class WorkspaceContractTests(unittest.TestCase):
    """Test 2: every declared workspace package exists on disk."""

    def test_workspaces_declared(self):
        pkg = _load_json(PKG_JSON)
        self.assertTrue(pkg.get("workspaces"), "package.json must declare npm workspaces")

    def test_all_workspace_packages_exist(self):
        pkg = _load_json(PKG_JSON)
        workspaces = pkg.get("workspaces", [])
        for pattern in workspaces:
            matches = list(FRONTEND.glob(pattern))
            self.assertTrue(matches, f"workspace pattern {pattern} matches nothing")
            for match in matches:
                manifest = match / "package.json"
                self.assertTrue(manifest.is_file(), f"workspace {match} lacks package.json")
                meta = _load_json(manifest)
                self.assertTrue(meta.get("name"), f"workspace {match} has no name")
                self.assertTrue(meta.get("version"), f"workspace {match} has no version")

    def test_lineage_workspaces_exist(self):
        for rel in WORKSPACE_DIRS:
            manifest = FRONTEND / rel / "package.json"
            self.assertTrue(manifest.is_file(), f"missing workspace package {rel}")

    def test_each_lineage_package_keeps_license_and_notice(self):
        for rel in WORKSPACE_DIRS:
            for name in ("LICENSE", "NOTICE"):
                self.assertTrue(
                    (FRONTEND / rel / name).is_file(),
                    f"{rel} must keep its {name}",
                )

    def test_workspace_packages_have_source_and_dist(self):
        # Runtime needs dist (npm ci does not build workspace packages);
        # source must be present so the dist is auditable / reproducible.
        for rel in WORKSPACE_DIRS:
            self.assertTrue((FRONTEND / rel / "src").is_dir(), f"{rel} lacks src/")
            self.assertTrue((FRONTEND / rel / "dist").is_dir(), f"{rel} lacks dist/")


class LockfileContractTests(unittest.TestCase):
    """Test 3: the npm lockfile contains no private registry / localhost / path refs."""

    FORBIDDEN_URL_FRAGMENTS = (
        "localhost",
        "127.0.0.1",
        "192.168.",
        "10.",
        "172.16.",
        "registry.cn-",
        "nexus",
        "artifactory",
        "verdaccio",
    )

    def setUp(self):
        self.lock = _load_json(PKG_LOCK)

    def test_lockfile_version_supported(self):
        self.assertGreaterEqual(self.lock.get("lockfileVersion", 0), 3)

    def test_no_forbidden_registry_urls(self):
        packages = self.lock.get("packages", {})
        resolved_urls = [
            entry.get("resolved", "")
            for entry in packages.values()
            if isinstance(entry, dict) and entry.get("resolved")
        ]
        for url in resolved_urls:
            for fragment in self.FORBIDDEN_URL_FRAGMENTS:
                self.assertNotIn(fragment, url, f"resolved URL {url} references {fragment}")

    def test_lineage_packages_resolve_to_local_workspaces(self):
        packages = self.lock.get("packages", {})
        for name, rel in (
            ("lineage-viewer", "packages/lineage-viewer"),
            ("@lineage-viewer/react", "packages/lineage-viewer-react"),
            ("@lineage-viewer/domain-adapter", "packages/lineage-viewer-domain-adapter"),
        ):
            key = f"node_modules/{name}"
            entry = packages.get(key, {})
            self.assertEqual(
                entry.get("resolved"),
                rel,
                f"{name} must resolve to local workspace {rel} (got {entry.get('resolved')})",
            )
            self.assertTrue(entry.get("link"), f"{name} must be a workspace link")


class ReadmeAssetContractTests(unittest.TestCase):
    """Test 4 + 5: README-referenced images / scripts / configs exist."""

    LOCAL_REF_RE = re.compile(r"\]\((?!https?://|#)([^)#\s]+)\)")

    def _local_refs(self, text: str) -> list[str]:
        refs = []
        for match in self.LOCAL_REF_RE.finditer(text):
            target = match.group(1)
            if target.startswith(("<repo-url>", "mailto:")):
                continue
            refs.append(target)
        return refs

    def test_readme_local_asset_refs_exist(self):
        text = DOC_README.read_text(encoding="utf-8")
        missing = []
        for ref in self._local_refs(text):
            candidate = REPO_ROOT / ref
            if not candidate.exists():
                missing.append(ref)
        self.assertEqual([], missing, f"README references missing files: {missing}")

    def test_vendored_lineage_readmes_have_no_broken_local_refs(self):
        # Vendored lineage-viewer READMEs link into their own docs/ and root
        # files; every local target must exist inside the package so the
        # bundled docs stay self-contained and auditable.
        pkg = FRONTEND / "packages" / "lineage-viewer"
        missing = []
        for readme in ("README.md", "README.en.md", "README.zh-CN.md"):
            path = pkg / readme
            if not path.exists():
                continue
            for ref in self._local_refs(path.read_text(encoding="utf-8")):
                if ref.startswith("./"):
                    ref = ref[2:]
                if ref in {"README.md", "README.en.md", "README.zh-CN.md", "LICENSE", "NOTICE"}:
                    continue
                candidate = (pkg / ref).resolve()
                if not candidate.exists():
                    missing.append(f"{readme}:{ref}")
        self.assertEqual([], missing, f"vendored lineage README broken refs: {missing}")

    def test_no_stale_screenshot_references(self):
        text = DOC_README.read_text(encoding="utf-8")
        self.assertNotIn("screenshots/", text)
        self.assertFalse((REPO_ROOT / "screenshots").exists(), "screenshots/ dir must be gone")


if __name__ == "__main__":
    unittest.main()
