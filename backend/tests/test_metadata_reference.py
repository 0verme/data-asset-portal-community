from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch


MODULE_PATH = Path(__file__).resolve().parents[2] / "examples" / "metadata_ingestion" / "postgresql_collector.py"
SPEC = importlib.util.spec_from_file_location("postgresql_reference_collector", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise ImportError(f"Unable to load reference collector: {MODULE_PATH}")
COLLECTOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COLLECTOR)


class MetadataReferenceCollectorTests(unittest.TestCase):
    def test_catalog_fixture_maps_to_public_contract_without_internal_schema_names(self):
        payload = COLLECTOR.build_contract(
            [{"schema_name": "public", "table_name": "orders", "description": "Orders"}],
            [
                {
                    "schema_name": "public",
                    "table_name": "orders",
                    "field_name": "id",
                    "data_type": "integer",
                    "nullable": False,
                    "ordinal_position": 1,
                    "primary_key": True,
                    "description": "Order id",
                }
            ],
            source_name="warehouse",
            source_namespace="finance",
            database_name="analytics",
        )
        self.assertEqual("1.0", payload["contractVersion"])
        self.assertEqual("public.orders", payload["assets"][0]["externalId"])
        self.assertTrue(payload["assets"][0]["fields"][0]["primaryKey"])
        serialized = json.dumps(payload)
        self.assertNotIn("p_asset_table", serialized)
        self.assertNotIn("p_lineage_snapshot", serialized)

    def test_publisher_posts_json_over_http_only(self):
        response = MagicMock()
        response.status = 201
        response.read.return_value = b'{"status":"completed"}'
        response.__enter__.return_value = response
        response.__exit__.return_value = False
        payload = {"contractVersion": "1.0", "assets": []}
        with patch.object(COLLECTOR, "urlopen", return_value=response) as urlopen:
            status, body = COLLECTOR.publish("http://dap.example/api/metadata/assets/ingestions", payload)
        self.assertEqual(201, status)
        self.assertIn("completed", body)
        request = urlopen.call_args.args[0]
        self.assertEqual("POST", request.method)
        self.assertIn(b'"contractVersion": "1.0"', request.data)
        self.assertNotIn(b"p_asset", request.data)


if __name__ == "__main__":
    unittest.main()
