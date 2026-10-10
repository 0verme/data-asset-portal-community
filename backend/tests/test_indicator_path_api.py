from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, insert
from sqlalchemy.pool import StaticPool

from backend.app.core.capabilities import resolve_capabilities
from backend.app.db.tables import indicator_path_config
from backend.app.fastapi_app import create_fastapi_app
from backend.app.services.indicator_path_service import (
    IndicatorPathDataSourceError,
    IndicatorPathService,
)


def path_row(
    row_id: int,
    parent_id: int | None,
    path_code: str,
    path_name: str,
    dimension_code: str,
    path_level: int,
    sort_order: int,
    *,
    status: str = "enabled",
):
    return {
        "id": row_id,
        "parent_id": parent_id,
        "path_code": path_code,
        "path_name": path_name,
        "dimension_code": dimension_code,
        "path_level": path_level,
        "full_path": path_code,
        "sort_order": sort_order,
        "status": status,
        "remark": None,
    }


class StubIndicatorPathService:
    def __init__(self, items=None, error=None):
        self.items = items or []
        self.error = error
        self.calls = []

    def get_path_tree(self, dimension_code=None):
        self.calls.append(dimension_code)
        if self.error is not None:
            raise self.error
        return self.items


class IndicatorPathApiContractTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(
            os.environ,
            {
                "APP_ENV": "development",
                "APP_SECRET_KEY": "indicator-path-contract-test",
                "PUBLIC_CATALOG_PROFILE": "internal",
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.capabilities = resolve_capabilities()

    def client(self, service):
        app = create_fastapi_app(
            capabilities=self.capabilities,
            identity_resolver=lambda _request: None,
            indicator_path_service_instance=service,
            openapi_enabled=True,
        )
        return TestClient(app)

    def test_route_is_documented_with_legacy_query_and_direct_array_contract(self):
        service = StubIndicatorPathService(
            [
                {
                    "label": "RETL 零售经营分析",
                    "value": "RETL",
                    "pathLabel": "RETL",
                    "pathCode": "RETL",
                    "pathName": "零售经营分析",
                    "dimensionCode": "retail",
                    "pathLevel": 1,
                    "fullPath": "RETL",
                    "remark": "password=must-not-be-public",
                    "children": [
                        {
                            "label": "销售分析",
                            "value": "销售分析",
                            "pathLabel": "销售分析",
                            "pathCode": "RETL_SALES",
                            "pathName": "销售分析",
                            "dimensionCode": "sales",
                            "pathLevel": 2,
                            "fullPath": "RETL/RETL_SALES",
                        }
                    ],
                }
            ]
        )
        client = self.client(service)
        schema = client.get("/openapi.json").json()
        operation = schema["paths"]["/api/indicator-path/tree"]["get"]
        self.assertEqual(
            ["dimensionCode"],
            [parameter["name"] for parameter in operation["parameters"]],
        )
        self.assertEqual(
            "array",
            operation["responses"]["200"]["content"]["application/json"]["schema"]["type"],
        )

        response = client.get("/api/indicator-path/tree?dimensionCode=ReTaIl")
        self.assertEqual(200, response.status_code)
        self.assertIsInstance(response.json(), list)
        self.assertEqual("RETL", response.json()[0]["value"])
        self.assertEqual("[已隐藏]", response.json()[0]["remark"])
        self.assertNotIn("must-not-be-public", response.text)
        self.assertEqual(["ReTaIl"], service.calls)

    def test_data_source_failure_keeps_the_standard_error_envelope(self):
        service = StubIndicatorPathService(
            error=IndicatorPathDataSourceError("数据库服务暂不可用，请稍后重试")
        )
        response = self.client(service).get("/api/indicator-path/tree")
        self.assertEqual(500, response.status_code)
        self.assertEqual(
            {
                "error": {
                    "code": "INDICATOR_PATH_DATA_SOURCE_ERROR",
                    "message": "数据库服务暂不可用，请稍后重试",
                }
            },
            response.json(),
        )

    def test_public_catalog_disabled_still_blocks_anonymous_tree_access(self):
        service = StubIndicatorPathService()
        with patch.dict(os.environ, {"PUBLIC_CATALOG_PROFILE": "disabled"}):
            response = self.client(service).get("/api/indicator-path/tree")
        self.assertEqual(401, response.status_code)
        self.assertEqual("UNAUTHORIZED", response.json()["error"]["code"])
        self.assertEqual([], service.calls)


class IndicatorPathServiceSqliteTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        ).execution_options(schema_translate_map={"__app__": None})
        indicator_path_config.create(self.engine)
        with self.engine.begin() as connection:
            connection.execute(
                insert(indicator_path_config),
                [
                    path_row(1, None, "RETL", "零售经营分析", "RETAIL", 1, 1),
                    path_row(2, 1, "RETL_PRODUCT", "商品分析", "PrOdUcT", 2, 1),
                    path_row(3, 2, "RETL_PRODUCT_SALES", "商品销售", "product_sales", 3, 1),
                    path_row(4, 1, "RETL_SALES", "销售分析", "sales", 2, 2),
                    path_row(5, 4, "RETL_SALES_DAILY", "日销售", "sales_daily", 3, 1),
                    path_row(6, None, "MEM", "会员分析", "member", 1, 2),
                    path_row(7, 6, "MEM_VALUE", "会员价值", "member_value", 2, 1),
                    path_row(8, 2, "RETL_DISABLED", "停用节点", "disabled", 3, 2, status="disabled"),
                ],
            )
        self.service = IndicatorPathService()

        def fetch_rows(statement):
            with self.engine.connect() as connection:
                return [dict(row._mapping) for row in connection.execute(statement)]

        self.service._fetch_rows = fetch_rows
        self.addCleanup(self.engine.dispose)

    def test_dimension_filter_is_case_insensitive_and_keeps_navigable_branches(self):
        filtered = self.service.get_path_tree("  PRODUCT  ")
        self.assertEqual(["RETL"], [node["value"] for node in filtered])
        self.assertEqual(["商品分析"], [node["value"] for node in filtered[0]["children"]])
        self.assertEqual(
            ["商品销售"],
            [node["value"] for node in filtered[0]["children"][0]["children"]],
        )

        upper_case_filter = self.service.get_path_tree("PRODUCT")
        self.assertEqual(filtered, upper_case_filter)

        leaf_filter = self.service.get_path_tree("PRODUCT_SALES")
        product = leaf_filter[0]["children"][0]
        self.assertEqual("商品分析", product["value"])
        self.assertEqual("商品销售", product["children"][0]["value"])
        self.assertNotIn("children", product["children"][0])

        root_filter = self.service.get_path_tree("retail")
        self.assertEqual(2, len(root_filter[0]["children"]))
        self.assertEqual([], self.service.get_path_tree("unknown"))

    def test_blank_filter_returns_full_enabled_tree_and_excludes_disabled_nodes(self):
        tree = self.service.get_path_tree("   ")
        self.assertEqual(["RETL", "MEM"], [node["value"] for node in tree])
        product_children = tree[0]["children"][0]["children"]
        self.assertEqual(["商品销售"], [node["value"] for node in product_children])

    def test_fastapi_endpoint_reads_the_same_sqlite_backed_service_contract(self):
        with patch.dict(
            os.environ,
            {
                "APP_ENV": "development",
                "APP_SECRET_KEY": "indicator-path-integration-test",
                "PUBLIC_CATALOG_PROFILE": "internal",
            },
            clear=False,
        ):
            app = create_fastapi_app(
                capabilities=resolve_capabilities(),
                identity_resolver=lambda _request: None,
                indicator_path_service_instance=self.service,
                openapi_enabled=True,
            )
            response = TestClient(app).get(
                "/api/indicator-path/tree?dimensionCode=PRODUCT"
            )

        self.assertEqual(200, response.status_code)
        payload = response.json()
        self.assertEqual(["RETL"], [node["value"] for node in payload])
        self.assertEqual("商品分析", payload[0]["children"][0]["value"])
        self.assertEqual(
            "商品销售",
            payload[0]["children"][0]["children"][0]["value"],
        )


if __name__ == "__main__":
    unittest.main()
