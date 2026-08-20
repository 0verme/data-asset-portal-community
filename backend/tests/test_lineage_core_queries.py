from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from sqlalchemy.dialects import mysql, postgresql, sqlite

from backend.app.services import lineage_service


class LineageCoreQueryTests(unittest.TestCase):
    def test_database_snapshot_reads_use_bound_core_queries(self):
        db = MagicMock()
        db.fetch_rows.side_effect = [
            [{
                "snapshot_id": "S1",
                "generated_at": "2026-08-20 00:00:00",
                "generator_name": "collector",
                "generator_version": "2.0",
            }],
            [{
                "node_id": "table:dwf:A",
                "kind_code": "table",
                "node_name": "DWF.A",
                "display_name": "A",
                "namespace_name": "dwf",
                "attributes_json": "{}",
            }],
            [{
                "edge_id": "E1",
                "source_node_id": "table:dwf:A",
                "target_node_id": "table:dwf:B",
                "kind_code": "table_lineage",
                "evidence_type": "mapping",
                "source_record_id": "m:1",
                "evidence_description": "mapping",
                "confidence_code": "high",
                "generated_at": "2026-08-20 00:00:00",
                "diagnostics_json": "[]",
            }],
        ]
        with patch("backend.app.services.lineage_service.CoreAccess", return_value=db):
            with patch("backend.app.services.lineage_service.database_transaction") as tx:
                tx.return_value.__enter__.return_value = None
                tx.return_value.__exit__.return_value = None
                snapshot = lineage_service._database_snapshot("lineage_test")

        for call in db.fetch_rows.call_args_list:
            for dialect in (sqlite.dialect(), postgresql.dialect(), mysql.dialect()):
                compiled = call.args[0].compile(dialect=dialect)
                self.assertIn("p_lineage_", str(compiled))
                self.assertIn("__app__", str(compiled))
                self.assertNotIn("dwp.", str(compiled))
        self.assertEqual(snapshot["snapshotId"], "S1")
        self.assertEqual(snapshot["nodes"][0]["id"], "table:dwf:A")


if __name__ == "__main__":
    unittest.main()
