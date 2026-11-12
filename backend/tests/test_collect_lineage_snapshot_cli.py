from __future__ import annotations

import unittest
from contextlib import redirect_stdout
from io import StringIO
from unittest.mock import patch

from backend.scripts import collect_lineage_snapshot


class CollectLineageSnapshotCliProfileTests(unittest.TestCase):
    def test_explicit_profile_is_validated_and_dry_run_is_forwarded(self):
        snapshot = {
            "snapshotId": "synthetic-test-snapshot",
            "nodes": [{"id": "node:test"}],
            "edges": [],
            "diagnostics": [],
        }
        with patch.object(
            collect_lineage_snapshot, "resolve_collection_profile", return_value="asset_test"
        ) as validate, patch.object(
            collect_lineage_snapshot, "collect_and_publish", return_value=snapshot
        ) as collect, redirect_stdout(StringIO()) as output:
            self.assertEqual(
                0,
                collect_lineage_snapshot.main(
                    ["--profile", "asset_test", "--dry-run"]
                ),
            )
        validate.assert_called_once_with("asset_test")
        collect.assert_called_once_with("asset_test", dry_run=True)
        self.assertIn('"action": "dry-run"', output.getvalue())
        self.assertIn('"snapshotId": "synthetic-test-snapshot"', output.getvalue())

    def test_profile_mismatch_fails_before_collector_is_invoked(self):
        with patch.object(
            collect_lineage_snapshot,
            "resolve_collection_profile",
            side_effect=ValueError("--profile must match ASSET_DB_PROFILE"),
        ), patch.object(collect_lineage_snapshot, "collect_and_publish") as collect:
            with self.assertRaises(SystemExit) as raised:
                collect_lineage_snapshot.main(["--profile", "other_db"])
        self.assertEqual(2, raised.exception.code)
        collect.assert_not_called()

    def test_cli_keeps_explicit_profile_requirement(self):
        with patch.object(collect_lineage_snapshot, "collect_and_publish") as collect:
            with self.assertRaises(SystemExit):
                collect_lineage_snapshot.main([])
        collect.assert_not_called()


if __name__ == "__main__":
    unittest.main()
