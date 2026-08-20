from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from sqlalchemy.dialects import mysql, postgresql, sqlite

from backend.app.services import lineage_service


class LineageCoreQueryTests(unittest.TestCase):
    def test_persistent_snapshot_reads_use_bound_core_queries(self):
        db = MagicMock()
        db.fetch_rows.side_effect = [
            [{
                "snapshot_id": "snapshot-1",
                "generated_at": "2026-08-20 00:00:00",
                "generator_name": "collector",
                "generator_version": "2.0",
            }],
            [{
                "node_id": "table:dwf:DWF_MEMBER",
                "kind_code": "table",
                "node_name": "DWF_MEMBER",
                "display_name": "会员",
                "namespace_name": "dwf",
                "attributes_json": "{}",
            }],
            [{
                "edge_id": "edge-1",
                "source_node_id": "table:dwf:DWF_MEMBER",
                "target_node_id": "table:dwf:DWF_MEMBER_2",
                "kind_code": "table_lineage",
                "evidence_type": "controlled_poc",
                "source_record_id": "record-1",
                "evidence_description": "sample",
                "confidence_code": "high",
                "generated_at": "2026-08-20 00:00:00",
                "diagnostics_json": "[]",
            }],
        ]
        with patch.object(lineage_service, "CoreAccess", return_value=db), patch.object(
            lineage_service, "database_transaction"
        ) as transaction:
            transaction.return_value.__enter__.return_value = None
            transaction.return_value.__exit__.return_value = None
            snapshot = lineage_service._database_snapshot("lineage_test")

        self.assertEqual("snapshot-1", snapshot["snapshotId"])
        statements = [call.args[0] for call in db.fetch_rows.call_args_list]
        self.assertEqual(3, len(statements))
        for statement in statements:
            for dialect in (sqlite.dialect(), postgresql.dialect(), mysql.dialect()):
                with self.subTest(dialect=dialect.name):
                    compiled = statement.compile(dialect=dialect)
                    self.assertIn("p_lineage_", str(compiled))
                    self.assertIn("__app__", str(compiled))
                    self.assertNotIn("dwp.", str(compiled))


if __name__ == "__main__":
    unittest.main()
