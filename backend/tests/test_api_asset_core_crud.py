from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from sqlalchemy.dialects import mysql, postgresql, sqlite

from backend.app.services.api_asset_service import ApiAssetService


class ApiAssetCoreCrudTests(unittest.TestCase):
    def setUp(self):
        self.service = ApiAssetService()
        self.row = {
            "api_pk": 7,
            "api_code": "CUSTOMER_API",
            "api_name": "Customer API",
            "method_code": "GET",
            "path_text": "/customers",
            "version_text": "v1",
            "system_id": 3,
            "downstream_system_id": None,
            "api_type": "query",
            "status_code": "enabled",
            "owner_dept_name": "platform",
            "owner_name": "tester",
            "maintainer_name": "tester",
            "description_text": "customer endpoint",
            "remark_desc": "remark",
            "updated_by": "tester",
            "updated_at": "2026-08-20 00:00:00",
            "system_code": "CRM",
            "system_name": "CRM",
            "system_abbr": "crm",
            "system_type": "business",
        }
        self.item = {
            "code": "CUSTOMER_API",
            "name": "Customer API",
            "method": "GET",
            "path": "/customers",
            "version": "v1",
            "systemId": 3,
            "type": "query",
            "status": "enabled",
            "ownerDept": "platform",
            "ownerName": "tester",
            "maintainerName": "tester",
            "description": "customer endpoint",
            "remark": "remark",
        }

    def _assert_portable(self, statement):
        for dialect in (sqlite.dialect(), postgresql.dialect(), mysql.dialect()):
            with self.subTest(dialect=dialect.name):
                compiled = statement.compile(dialect=dialect)
                self.assertIn("p_api_", str(compiled))
                self.assertIn("__app__", str(compiled))
                self.assertNotIn("dwp.", str(compiled))

    def test_list_and_child_relations_use_core_selects(self):
        self.service._db.fetch_rows = MagicMock(side_effect=[[self.row], [], [], []])

        items = self.service.get_assets(keyword="customer' OR 1=1", status="enabled")

        for call in self.service._db.fetch_rows.call_args_list:
            self._assert_portable(call.args[0])
        self.assertNotIn("customer' OR 1=1", str(self.service._db.fetch_rows.call_args_list[0].args[0].compile(dialect=sqlite.dialect())))
        self.assertEqual(items[0]["code"], "CUSTOMER_API")

    @patch("backend.app.services.api_asset_service.ApiAssetService.get_asset")
    def test_create_update_and_replace_use_core_mutations(self, get_asset):
        get_asset.return_value = {"code": "CUSTOMER_API"}
        self.service._db.next_pk = MagicMock(side_effect=[7, 8, 9])
        self.service._db.execute_statements = MagicMock()
        self.service._exists = MagicMock(return_value=False)
        self.service._validate_asset = MagicMock(return_value=self.item)

        self.service.create(self.item)
        self._assert_portable(self.service._db.execute_statements.call_args.args[0][0])

        self.service.update("CUSTOMER_API", self.item)
        self._assert_portable(self.service._db.execute_statements.call_args.args[0][0])

        self.service.replace_rows(
            "CUSTOMER_API",
            [{"name": "limit", "in": "query", "dataType": "integer"}],
            "params",
        )
        for statement in self.service._db.execute_statements.call_args.args[0]:
            self._assert_portable(statement)


if __name__ == "__main__":
    unittest.main()
