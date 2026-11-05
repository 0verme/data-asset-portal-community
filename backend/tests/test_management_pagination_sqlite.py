from __future__ import annotations

import unittest
from contextlib import nullcontext
from datetime import datetime
from unittest.mock import patch

from sqlalchemy import create_engine, insert

from backend.app.db.metadata import LOGICAL_SCHEMA
from backend.app.db.tables import (
    api_asset,
    api_param,
    api_relation,
    api_response_field,
    manual_code_table,
    root_category,
    root_item,
    system_table,
)
from backend.app.services.api_asset_service import ApiAssetService
from backend.app.services.manual_code_table_service import ManualCodeTableService
from backend.app.services.root_service import RootService


class _SqliteCoreAccess:
    def __init__(self, connection):
        self.connection = connection

    def fetch_rows(self, statement):
        return [dict(row._mapping) for row in self.connection.execute(statement)]


class ManagementPaginationSqliteTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        self.connection = self.engine.connect().execution_options(
            schema_translate_map={LOGICAL_SCHEMA: None}
        )
        for table in (
            api_asset,
            api_param,
            api_relation,
            api_response_field,
            system_table,
            manual_code_table,
            root_category,
            root_item,
        ):
            table.create(self.connection)
        self.core = _SqliteCoreAccess(self.connection)
        self.api = ApiAssetService()
        self.api._db = self.core
        self.manual = ManualCodeTableService()
        self.manual._db = self.core
        self.root = RootService()
        self.root._db = self.core
        self._insert_fixtures()

    def tearDown(self):
        self.connection.close()
        self.engine.dispose()

    def _insert_fixtures(self):
        now = datetime(2026, 11, 4)
        self.connection.execute(insert(system_table), [
            {"system_id": 1, "system_code": "SYS_A", "system_name": "系统 A", "system_abbr": "A", "system_type": "business", "status_code": "enabled", "is_deleted": "N", "created_by": "test", "updated_by": "test"},
            {"system_id": 2, "system_code": "SYS_B", "system_name": "系统 B", "system_abbr": "B", "system_type": "business", "status_code": "enabled", "is_deleted": "N", "created_by": "test", "updated_by": "test"},
        ])
        self.connection.execute(insert(api_asset), [
            {"api_pk": 1, "api_code": "API_B", "api_name": "二号", "method_code": "GET", "path_text": "/b", "system_id": 1, "status_code": "enabled", "owner_dept_name": "测试", "owner_name": "测试", "is_deleted": "N", "created_by": "test", "created_at": now, "updated_by": "test", "updated_at": now},
            {"api_pk": 2, "api_code": "API_A", "api_name": "一号", "method_code": "POST", "path_text": "/a", "system_id": 2, "status_code": "disabled", "owner_dept_name": "测试", "owner_name": "测试", "is_deleted": "N", "created_by": "test", "created_at": now, "updated_by": "test", "updated_at": now},
            {"api_pk": 3, "api_code": "API_C", "api_name": "三号", "method_code": "POST", "path_text": "/c", "system_id": 2, "status_code": "enabled", "owner_dept_name": "测试", "owner_name": "测试", "is_deleted": "N", "created_by": "test", "created_at": now, "updated_by": "test", "updated_at": now},
            {"api_pk": 4, "api_code": "API_DELETED", "api_name": "已删除", "method_code": "GET", "path_text": "/deleted", "system_id": 1, "status_code": "enabled", "owner_dept_name": "测试", "owner_name": "测试", "is_deleted": "Y", "created_by": "test", "created_at": now, "updated_by": "test", "updated_at": now},
        ])
        self.connection.execute(insert(manual_code_table), [
            {"table_id": 1, "table_code": "TABLE_A", "table_name": "表 A", "table_style": "status", "status_code": "enabled", "created_by": "test", "created_at": now, "updated_by": "test", "updated_at": datetime(2026, 11, 1)},
            {"table_id": 2, "table_code": "TABLE_B", "table_name": "表 B", "table_style": "enum", "status_code": "disabled", "created_by": "test", "created_at": now, "updated_by": "test", "updated_at": datetime(2026, 11, 2)},
            {"table_id": 3, "table_code": "TABLE_C", "table_name": "表 C", "table_style": "status", "status_code": "enabled", "created_by": "test", "created_at": now, "updated_by": "test", "updated_at": datetime(2026, 11, 3)},
        ])
        self.connection.execute(insert(root_category), [
            {"category_id": 1, "category_name": "业务对象", "display_order": 1, "is_deleted": "N"},
            {"category_id": 2, "category_name": "技术后缀", "display_order": 2, "is_deleted": "N"},
        ])
        self.connection.execute(insert(root_item), [
            {"root_id": 1, "root_abbr": "customer", "root_en_name": "Customer", "root_cn_name": "客户", "category_name": "业务对象", "is_deleted": "N", "created_by": "test", "updated_by": "test"},
            {"root_id": 2, "root_abbr": "order", "root_en_name": "Order", "root_cn_name": "订单", "category_name": "业务对象", "is_deleted": "N", "created_by": "test", "updated_by": "test"},
            {"root_id": 3, "root_abbr": "di", "root_en_name": "Daily Increment", "root_cn_name": "日增量", "category_name": "技术后缀", "is_deleted": "N", "created_by": "test", "updated_by": "test"},
            {"root_id": 4, "root_abbr": "gone", "root_en_name": "Deleted", "root_cn_name": "已删除", "category_name": "业务对象", "is_deleted": "Y", "created_by": "test", "updated_by": "test"},
        ])

    def test_api_assets_count_and_database_page_match_filters_with_global_facets(self):
        with patch("backend.app.services.api_asset_service.database_transaction", return_value=nullcontext()):
            result = self.api.get_assets_page(status="enabled", page=2, page_size=1)

        self.assertEqual(2, result["total"])
        self.assertEqual((2, 1), (result["page"], result["pageSize"]))
        self.assertEqual(["API_C"], [item["code"] for item in result["items"]])
        self.assertEqual({"enabled": 2, "disabled": 1}, result["facets"]["status"])
        self.assertEqual({"GET": 1, "POST": 2}, result["facets"]["method"])
        self.assertEqual({"1": 1, "2": 2}, result["facets"]["downstreamSystemId"])
        self.assertEqual({"total": 3}, result["stats"])
        with patch("backend.app.services.api_asset_service.database_transaction", return_value=nullcontext()):
            self.assertEqual(3, len(self.api.get_assets()))

    def test_manual_code_tables_page_filters_and_global_stats_are_database_backed(self):
        result = self.manual.get_tables_page(style="status", page=2, page_size=1)

        self.assertEqual(2, result["total"])
        self.assertEqual((2, 1), (result["page"], result["pageSize"]))
        self.assertEqual(["TABLE_A"], [item["tableCode"] for item in result["items"]])
        self.assertEqual({"total": 3, "enabled": 2, "disabled": 1, "styleCount": 2}, result["stats"])
        self.assertEqual({
            "styleTotal": 3,
            "styles": {"enum": 1, "status": 2},
            "statusTotal": 2,
            "statuses": {"enabled": 2, "disabled": 0},
        }, result["facets"])
        self.assertEqual(3, len(self.manual.get_tables()))

    def test_root_page_is_database_backed_and_keeps_full_category_and_candidate_sets(self):
        result = self.root.get_roots_page(cat="业务对象", page=2, page_size=1)

        self.assertEqual(2, result["total"])
        self.assertEqual((2, 1), (result["page"], result["pageSize"]))
        self.assertEqual(["order"], [item["abbr"] for item in result["items"]])
        self.assertEqual({"total": 3}, result["stats"])
        self.assertEqual(["customer", "di", "order"], [item["abbr"] for item in self.root.get_roots()])
        self.assertEqual(["customer", "di", "order"], self.root.get_root_abbreviations())
        self.assertEqual({"业务对象": 2, "技术后缀": 1}, {
            item["name"]: item["count"] for item in self.root.get_root_categories()
        })


if __name__ == "__main__":
    unittest.main()
