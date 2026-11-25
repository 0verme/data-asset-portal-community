"""Tests for Issue #625: Docs-only PR classification, guard validation, and required check gates."""

from __future__ import annotations

import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

from scripts.ci_docs_only import (
    DiffEntry,
    classify_diff_entries,
    classify_pr_changes,
    evaluate_frontend_gate,
    is_allowed_doc_path,
    parse_numstat_z,
    parse_raw_diff_z,
    validate_markdown_file_links_and_format,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
CI_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "ci.yml"


class AllowedDocPathClassificationTests(unittest.TestCase):
    def test_explicitly_allowed_markdown_paths(self) -> None:
        allowed = (
            "README.md",
            "CONTRIBUTING.md",
            "DEPLOYMENT.md",
            "DEVELOPMENT.md",
            "CHANGELOG.md",
            "SECURITY.md",
            "CODE_OF_CONDUCT.md",
            "SUPPORT.md",
            "docs/README.md",
            "docs/architecture.md",
            "docs/adr/001-metadata-ingestion-contract.md",
            "docs/rbac/authenticated-read-model.md",
            "docs/archive/engineering-history/SQLITE_DECISION.md",
            "frontend/DESIGN.md",
            "frontend/README.md",
            "frontend/src/ui/README.md",
            "frontend/src/components/portal/orb/README.md",
            "frontend/packages/lineage-viewer/README.md",
            "frontend/packages/lineage-viewer/README.en.md",
            "frontend/packages/lineage-viewer/docs/public-api.md",
            "backend/README.md",
            "backend/AI_ASK_GAUSSDB_VALIDATION.md",
            "backend/alembic/DWS_MIGRATION_COMPATIBILITY.md",
            "backend/alembic/REAL_DWS_VALIDATION.md",
            "backend/resources/jars/README.md",
            "backend/schema/README.md",
            "deploy/demo/README.md",
            "examples/metadata_ingestion/README.md",
            "website/README.md",
        )
        for path in allowed:
            with self.subTest(path=path):
                self.assertTrue(is_allowed_doc_path(path), f"Expected {path} to be allowed")

    def test_code_config_ci_lockfile_sql_test_and_script_paths_are_rejected(self) -> None:
        disallowed = (
            ".github/workflows/ci.yml",
            ".github/workflows/community-metadata.yml",
            ".github/workflows/README.md",
            ".github/pull_request_template.md",
            ".github/labeler.yml",
            ".github/dependabot.yml",
            "frontend/src/App.tsx",
            "frontend/src/main.tsx",
            "frontend/src/index.css",
            "frontend/src/api/aiAskExecution.ts",
            "frontend/package.json",
            "frontend/package-lock.json",
            "frontend/tsconfig.json",
            "frontend/vite.config.ts",
            "frontend/scripts/dependency-audit.mjs",
            "frontend/e2e/ai-ask.spec.ts",
            "frontend/e2e/README.md",
            "frontend/tests/test_serve_dist_linux.py",
            "frontend/tests/README.md",
            "backend/asgi.py",
            "backend/app/fastapi_app.py",
            "backend/requirements.txt",
            "backend/requirements-mysql.txt",
            "backend/.env.example",
            "backend/configs/database.example.yaml",
            "backend/configs/README.md",
            "backend/scripts/schema_migrate.py",
            "backend/scripts/README.md",
            "backend/alembic/versions/0001_initial.py",
            "backend/alembic/versions/README.md",
            "backend/tests/test_public_docs_consistency.py",
            "backend/tests/README.md",
            "scripts/release_check.py",
            "scripts/ci_docs_only.py",
            "scripts/demo.sh",
            "scripts/README.md",
            "demo/validate_demo_data.py",
            "demo/datasets/assets.json",
            "demo/datasets/README.md",
            "docs/dws/lineage-snapshot-rollback.sql",
            "docs/pg/assets-app-pg-ddl.sql",
            "docs/diagrams/architecture.html",
            "docs/diagrams/architecture.json",
            "docs/images/demo-portal-overview.png",
            "docs/run.sh",
            "/README.md",
            "./README.md",
            "docs/../README.md",
            "docs//README.md",
            r"docs\README.md",
            ".hidden.md",
            "README.MD",
            "README.mdx",
            "README.md.sh",
            "",
        )
        for path in disallowed:
            with self.subTest(path=path):
                self.assertFalse(is_allowed_doc_path(path), f"Expected {path} to be rejected")


class DiffEntryClassificationTests(unittest.TestCase):
    def test_pure_markdown_changes_classify_as_docs_only(self) -> None:
        raw = (
            b":100644 100644 " + b"a" * 40 + b" " + b"b" * 40 + b" M\0frontend/DESIGN.md\0"
            b":100644 100644 " + b"c" * 40 + b" " + b"d" * 40 + b" M\0frontend/src/ui/README.md\0"
        )
        numstat = b"12\t4\tfrontend/DESIGN.md\08\t2\tfrontend/src/ui/README.md\0"
        entries = parse_raw_diff_z(raw)
        stats = parse_numstat_z(numstat)
        result = classify_diff_entries(
            entries,
            stats,
            blob_reader=lambda _sha, _path: b"# Documentation heading\n\n Clean UTF-8 text.\n",
        )
        self.assertTrue(result.docs_only)
        self.assertEqual(("frontend/DESIGN.md", "frontend/src/ui/README.md"), result.changed_files)

    def test_mixed_markdown_and_code_classifies_as_full_ci(self) -> None:
        raw = (
            b":100644 100644 " + b"a" * 40 + b" " + b"b" * 40 + b" M\0README.md\0"
            b":100644 100644 " + b"c" * 40 + b" " + b"d" * 40 + b" M\0frontend/src/App.tsx\0"
        )
        numstat = b"5\t1\tREADME.md\02\t1\tfrontend/src/App.tsx\0"
        result = classify_diff_entries(
            parse_raw_diff_z(raw),
            parse_numstat_z(numstat),
            blob_reader=lambda _sha, _path: b"# Doc\n",
        )
        self.assertFalse(result.docs_only)
        self.assertIn("disallowed_path:frontend/src/App.tsx", result.reason)

    def test_rename_between_allowed_docs_is_docs_only_but_code_rename_is_rejected(self) -> None:
        raw_ok = (
            b":100644 100644 "
            + b"a" * 40
            + b" "
            + b"b" * 40
            + b" R095\0docs/old-guide.md\0docs/new-guide.md\0"
        )
        numstat_ok = b"2\t0\t\0docs/old-guide.md\0docs/new-guide.md\0"
        res_ok = classify_diff_entries(
            parse_raw_diff_z(raw_ok),
            parse_numstat_z(numstat_ok),
            blob_reader=lambda _sha, _path: b"# Guide\n",
        )
        self.assertTrue(res_ok.docs_only)

        raw_bad = (
            b":100644 100644 "
            + b"a" * 40
            + b" "
            + b"b" * 40
            + b" R080\0backend/scripts/tool.py\0docs/tool.md\0"
        )
        numstat_bad = b"1\t1\t\0backend/scripts/tool.py\0docs/tool.md\0"
        res_bad = classify_diff_entries(
            parse_raw_diff_z(raw_bad),
            parse_numstat_z(numstat_bad),
            blob_reader=lambda _sha, _path: b"# Tool\n",
        )
        self.assertFalse(res_bad.docs_only)
        self.assertIn("disallowed_path:backend/scripts/tool.py", res_bad.reason)

    def test_executable_mode_symlink_binary_and_shebang_in_docs_are_rejected(self) -> None:
        # 1. Executable git mode 100755
        exec_entry = [
            DiffEntry(
                old_mode="000000",
                new_mode="100755",
                old_sha="0" * 40,
                new_sha="a" * 40,
                status="A",
                old_path="docs/runnable.md",
            )
        ]
        res_exec = classify_diff_entries(
            exec_entry,
            [("3", "0", "docs/runnable.md")],
            blob_reader=lambda _sha, _path: b"# Doc\n",
        )
        self.assertFalse(res_exec.docs_only)
        self.assertIn("non_regular_or_executable_mode", res_exec.reason)

        # 2. Symlink git mode 120000
        symlink_entry = [
            DiffEntry(
                old_mode="000000",
                new_mode="120000",
                old_sha="0" * 40,
                new_sha="a" * 40,
                status="A",
                old_path="docs/link.md",
            )
        ]
        res_sym = classify_diff_entries(
            symlink_entry,
            [("1", "0", "docs/link.md")],
            blob_reader=lambda _sha, _path: b"README.md",
        )
        self.assertFalse(res_sym.docs_only)
        self.assertIn("non_regular_or_executable_mode", res_sym.reason)

        # 3. Binary numstat (- / -)
        reg_entry = [
            DiffEntry(
                old_mode="100644",
                new_mode="100644",
                old_sha="a" * 40,
                new_sha="b" * 40,
                status="M",
                old_path="docs/architecture.md",
            )
        ]
        res_bin_stat = classify_diff_entries(
            reg_entry,
            [("-", "-", "docs/architecture.md")],
            blob_reader=lambda _sha, _path: b"# Doc\n",
        )
        self.assertFalse(res_bin_stat.docs_only)
        self.assertIn("binary_diff_numstat", res_bin_stat.reason)

        # 4. NUL byte inside blob
        res_nul = classify_diff_entries(
            reg_entry,
            [("1", "1", "docs/architecture.md")],
            blob_reader=lambda _sha, _path: b"# Binary\x00content\n",
        )
        self.assertFalse(res_nul.docs_only)
        self.assertIn("binary_nul_byte", res_nul.reason)

        # 5. Shebang at start of markdown file
        res_shebang = classify_diff_entries(
            reg_entry,
            [("1", "1", "docs/architecture.md")],
            blob_reader=lambda _sha, _path: b"#!/usr/bin/env bash\necho hello\n",
        )
        self.assertFalse(res_shebang.docs_only)
        self.assertIn("executable_shebang_in_doc", res_shebang.reason)

    def test_empty_diff_fails_closed(self) -> None:
        res = classify_diff_entries([], [])
        self.assertFalse(res.docs_only)
        self.assertEqual("empty_diff_fail_closed", res.reason)


class GitRepositoryClassificationIntegrationTests(unittest.TestCase):
    def _git(self, repo: Path, *args: str) -> str:
        proc = subprocess.run(
            ["git", *args],
            cwd=repo,
            capture_output=True,
            text=True,
            check=True,
        )
        return proc.stdout.strip()

    def test_end_to_end_git_classification_across_commit_types(self) -> None:
        with tempfile.TemporaryDirectory(prefix="ci-docs-only-test-") as tmp:
            repo = Path(tmp)
            self._git(repo, "init")
            self._git(repo, "config", "user.name", "CI Test")
            self._git(repo, "config", "user.email", "ci@demo.invalid")

            (repo / "README.md").write_text("# Root README\n", encoding="utf-8")
            (repo / "frontend" / "src" / "ui").mkdir(parents=True)
            (repo / "frontend" / "DESIGN.md").write_text("# Design\n", encoding="utf-8")
            (repo / "frontend" / "src" / "ui" / "README.md").write_text("# UI\n", encoding="utf-8")
            (repo / "frontend" / "src" / "App.tsx").write_text("export const App = () => null;\n", encoding="utf-8")
            (repo / ".github" / "workflows").mkdir(parents=True)
            (repo / ".github" / "workflows" / "ci.yml").write_text("name: CI\n", encoding="utf-8")

            self._git(repo, "add", ".")
            self._git(repo, "commit", "-m", "initial")
            base_sha = self._git(repo, "rev-parse", "HEAD")

            # 1. Docs-only commit (like PR #624)
            (repo / "frontend" / "DESIGN.md").write_text("# Design v2\n", encoding="utf-8")
            (repo / "frontend" / "src" / "ui" / "README.md").write_text(
                "# UI v2\nSee [Design](../../DESIGN.md).\n",
                encoding="utf-8",
            )
            self._git(repo, "add", ".")
            self._git(repo, "commit", "-m", "docs: update design and ui readme")
            docs_sha = self._git(repo, "rev-parse", "HEAD")

            res_docs = classify_pr_changes(
                event_name="pull_request",
                base_sha=base_sha,
                head_sha=docs_sha,
                repo_root=repo,
            )
            self.assertTrue(res_docs.docs_only, res_docs.reason)
            self.assertEqual(
                ("frontend/DESIGN.md", "frontend/src/ui/README.md"),
                res_docs.changed_files,
            )

            # 2. Same docs commit on `push` to `main` must NOT fast-path
            res_push = classify_pr_changes(
                event_name="push",
                base_sha=base_sha,
                head_sha=docs_sha,
                repo_root=repo,
            )
            self.assertFalse(res_push.docs_only)
            self.assertIn("non_pull_request_event:push", res_push.reason)

            # 3. Mixed commit (docs + TS code) must run full CI
            (repo / "frontend" / "src" / "App.tsx").write_text(
                "export const App = () => 'changed';\n",
                encoding="utf-8",
            )
            self._git(repo, "add", ".")
            self._git(repo, "commit", "-m", "feat: touch App.tsx")
            mixed_sha = self._git(repo, "rev-parse", "HEAD")

            res_mixed = classify_pr_changes(
                event_name="pull_request",
                base_sha=base_sha,
                head_sha=mixed_sha,
                repo_root=repo,
            )
            self.assertFalse(res_mixed.docs_only)
            self.assertIn("disallowed_path:frontend/src/App.tsx", res_mixed.reason)

            # 4. CI workflow change must run full CI
            self._git(repo, "checkout", "-b", "ci-change", base_sha)
            (repo / ".github" / "workflows" / "ci.yml").write_text("name: CI Updated\n", encoding="utf-8")
            self._git(repo, "add", ".")
            self._git(repo, "commit", "-m", "ci: update workflow")
            ci_sha = self._git(repo, "rev-parse", "HEAD")

            res_ci = classify_pr_changes(
                event_name="pull_request",
                base_sha=base_sha,
                head_sha=ci_sha,
                repo_root=repo,
            )
            self.assertFalse(res_ci.docs_only)
            self.assertIn("disallowed_path:.github/workflows/ci.yml", res_ci.reason)

            # 5. Missing/unknown commit SHA fails closed to full CI
            res_missing = classify_pr_changes(
                event_name="pull_request",
                base_sha=base_sha,
                head_sha="f" * 40,
                repo_root=repo,
            )
            self.assertFalse(res_missing.docs_only)

            # 6. GitHub Actions synthetic PR merge commit (HEAD^1 = main, HEAD^2 = multi-commit PR head)
            self._git(repo, "checkout", "-b", "pr-multi-docs", base_sha)
            (repo / "frontend" / "DESIGN.md").write_text("# Design step 1\n", encoding="utf-8")
            self._git(repo, "add", ".")
            self._git(repo, "commit", "-m", "docs: step 1")
            (repo / "frontend" / "src" / "ui" / "README.md").write_text("# UI step 2\n", encoding="utf-8")
            self._git(repo, "add", ".")
            self._git(repo, "commit", "-m", "docs: step 2")
            pr_head_sha = self._git(repo, "rev-parse", "HEAD")

            self._git(repo, "checkout", "-b", "main-advanced", base_sha)
            (repo / "README.md").write_text("# Root README advanced on main\n", encoding="utf-8")
            self._git(repo, "add", ".")
            self._git(repo, "commit", "-m", "docs: main advanced")

            # Create the synthetic test merge commit (HEAD^1 = main-advanced, HEAD^2 = pr_head_sha)
            self._git(repo, "merge", "--no-ff", "-m", "Merge PR into main", pr_head_sha)
            res_merge_commit = classify_pr_changes(
                event_name="pull_request",
                base_sha=base_sha,
                head_sha=pr_head_sha,
                repo_root=repo,
            )
            self.assertTrue(res_merge_commit.docs_only, res_merge_commit.reason)
            self.assertEqual(
                ("frontend/DESIGN.md", "frontend/src/ui/README.md"),
                res_merge_commit.changed_files,
            )


class MarkdownValidationTests(unittest.TestCase):
    def test_valid_and_broken_relative_links_and_conflict_markers(self) -> None:
        with tempfile.TemporaryDirectory(prefix="md-link-check-") as tmp:
            root = Path(tmp)
            (root / "docs").mkdir()
            (root / "docs" / "target.md").write_text("# Target\n", encoding="utf-8")

            good_md = root / "docs" / "good.md"
            good_md.write_text(
                "# Good\n\n"
                "Valid link to [target](./target.md#heading) and external [site](https://example.com).\n"
                "```markdown\n"
                "[illustrative broken link inside code fence](./not-a-real-file.md)\n"
                "<<<<<<< illustrative conflict marker inside code fence\n"
                "```\n",
                encoding="utf-8",
            )
            self.assertEqual([], validate_markdown_file_links_and_format(good_md, root))

            broken_md = root / "docs" / "broken.md"
            broken_md.write_text(
                "# Broken\n\nSee [missing](./does-not-exist.md) and [escape](../../outside.md).\n",
                encoding="utf-8",
            )
            errs = validate_markdown_file_links_and_format(broken_md, root)
            self.assertEqual(2, len(errs), errs)
            self.assertTrue(any("broken local link target" in e for e in errs))
            self.assertTrue(any("link escapes repository root" in e for e in errs))

            conflict_md = root / "docs" / "conflict.md"
            conflict_md.write_text(
                "# Conflict\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n",
                encoding="utf-8",
            )
            conflict_errs = validate_markdown_file_links_and_format(conflict_md, root)
            self.assertTrue(
                any("unresolved git merge conflict marker" in e for e in conflict_errs),
                conflict_errs,
            )


class FrontendGateSemanticsTests(unittest.TestCase):
    def _extract_ci_frontend_gate_script(self) -> str:
        text = CI_WORKFLOW.read_text(encoding="utf-8")
        match = re.search(
            r"frontend-gate:[\s\S]*?run:\s*\|\n((?: {10}.*\n)+)",
            text,
        )
        self.assertIsNotNone(match, "Could not locate frontend-gate run script in ci.yml")
        lines = [line[10:] for line in match.group(1).splitlines()]
        return "\n".join(lines)

    def _run_ci_shell_gate(
        self,
        *,
        event_name: str,
        docs_only: str,
        guard_result: str,
        core_result: str,
        browser_result: str,
    ) -> bool:
        script = self._extract_ci_frontend_gate_script()
        env = dict(os.environ)
        env.update(
            {
                "EVENT_NAME": event_name,
                "DOCS_ONLY": docs_only,
                "GUARD_RESULT": guard_result,
                "CORE_RESULT": core_result,
                "BROWSER_RESULT": browser_result,
            }
        )
        proc = subprocess.run(
            ["sh", "-e", "-c", script],
            capture_output=True,
            text=True,
            env=env,
            check=False,
        )
        return proc.returncode == 0

    def test_frontend_gate_truth_table_matches_between_python_and_ci_yaml(self) -> None:
        cases = [
            # Full CI success
            ("pull_request", "false", "success", "success", "success", True),
            ("push", "false", "success", "success", "success", True),
            # Docs-only PR fast path (only passes when guard=success and heavy jobs skipped)
            ("pull_request", "true", "success", "skipped", "skipped", True),
            # Docs-only PR must FAIL if Repository Guard failed/cancelled/skipped
            ("pull_request", "true", "failure", "skipped", "skipped", False),
            ("pull_request", "true", "cancelled", "skipped", "skipped", False),
            ("pull_request", "true", "skipped", "skipped", "skipped", False),
            # Docs-only PR must FAIL if browser or core actually ran and failed/cancelled
            ("pull_request", "true", "success", "failure", "skipped", False),
            ("pull_request", "true", "success", "skipped", "failure", False),
            ("pull_request", "true", "success", "skipped", "cancelled", False),
            ("pull_request", "true", "success", "cancelled", "skipped", False),
            # Non-PR push must NEVER allow skipped frontend or browser jobs
            ("push", "true", "success", "skipped", "skipped", False),
            ("push", "false", "success", "skipped", "skipped", False),
            # Full CI PR must FAIL if browser lane or frontend core fails, cancels, or skips
            ("pull_request", "false", "success", "success", "cancelled", False),
            ("pull_request", "false", "success", "success", "failure", False),
            ("pull_request", "false", "success", "success", "skipped", False),
            ("pull_request", "false", "success", "failure", "success", False),
            ("pull_request", "false", "success", "cancelled", "success", False),
            ("pull_request", "false", "success", "skipped", "success", False),
            ("pull_request", "false", "failure", "success", "success", False),
        ]
        for event_name, docs_only, guard_res, core_res, browser_res, expected in cases:
            with self.subTest(
                event=event_name,
                docs_only=docs_only,
                guard=guard_res,
                core=core_res,
                browser=browser_res,
            ):
                py_ok, msg = evaluate_frontend_gate(
                    event_name=event_name,
                    docs_only=docs_only,
                    guard_result=guard_res,
                    core_result=core_res,
                    browser_result=browser_res,
                )
                sh_ok = self._run_ci_shell_gate(
                    event_name=event_name,
                    docs_only=docs_only,
                    guard_result=guard_res,
                    core_result=core_res,
                    browser_result=browser_res,
                )
                self.assertEqual(expected, py_ok, msg)
                self.assertEqual(expected, sh_ok, f"ci.yml shell gate diverged for {msg}")


class CiWorkflowContractTests(unittest.TestCase):
    def test_ci_workflow_preserves_required_check_contexts_and_security_invariants(self) -> None:
        text = CI_WORKFLOW.read_text(encoding="utf-8")

        # 1. All 7 GitHub Branch Protection required check names must remain present.
        for required_name in (
            "name: Repository Guard",
            "name: Backend / Python ${{ matrix.python }}",
            "name: PostgreSQL Integration",
            "name: ${{ matrix.node == '22' && 'Frontend Core / Node 22' || 'Frontend / Node 24' }}",
            "name: Frontend / Node 22",
            "name: Community Migration (SQLite)",
        ):
            self.assertIn(required_name, text)

        # 2. All heavy jobs must gate on repository-guard docs_only output and run full CI on non-PR push.
        expected_if = (
            "if: github.event_name != 'pull_request' || needs.repository-guard.outputs.docs_only != 'true'"
        )
        self.assertEqual(6, text.count(expected_if))

        # 3. Read-only permissions and full 40-hex commit SHA action pins must remain intact.
        self.assertIn("permissions:\n  contents: read", text)
        for match in re.finditer(r"^\s*-\s*uses:\s*([^\s#]+)", text, flags=re.MULTILINE):
            action_ref = match.group(1)
            self.assertRegex(action_ref, r"^[^@\s]+@[0-9a-f]{40}$")

    def test_importing_ci_docs_only_does_not_pollute_sys_path_with_demo_dir(self) -> None:
        import importlib
        import sys
        import scripts.ci_docs_only as ci_docs_only_mod

        demo_dir = str(REPO_ROOT / "demo")
        cleaned_path = [p for p in sys.path if p != demo_dir]
        orig_path = list(sys.path)
        try:
            sys.path[:] = cleaned_path
            importlib.reload(ci_docs_only_mod)
            self.assertNotIn(
                demo_dir,
                sys.path,
                "scripts.ci_docs_only must not insert demo/ into sys.path (breaks demo.seed_loader patching)",
            )
        finally:
            sys.path[:] = orig_path


if __name__ == "__main__":
    unittest.main()
