from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, insert
from sqlalchemy.dialects import mysql, postgresql, sqlite
from sqlalchemy.pool import StaticPool

from backend.app.core.capabilities import resolve_capabilities
from backend.app.db.tables import (
    asset_field,
    asset_table,
    indicator_item,
    indicator_path_config,
)
from backend.app.fastapi_app import create_fastapi_app
from backend.app.services.indicator_service import (
    IndicatorDataSourceError,
    IndicatorService,
)

# pyright: reportMissingImports=false

# Read-only audit snapshot from the intranet GaussDB instance: 2301 indicators,
# 2300 enabled + 1 disabled, spread over seven real business dimension codes.
BANK_DIMENSION_DISTRIBUTION = {
    "CUS": 1230,
    "EMP": 365,
    "ORD": 331,
    "FUL": 181,
    "DUE": 108,
    "CON": 84,
    "ORG": 2,
}
BANK_DIMENSION_ORDER = ["cus", "emp", "ord", "ful", "due", "con", "org"]

DEMO_DIMENSION_DISTRIBUTION = {
    "PRD": 4,
    "MEM": 5,
    "ORD": 5,
    "STR": 4,
    "INV": 5,
    "MKT": 4,
    "FUL": 4,
    "SVC": 5,
}
DEMO_DIMENSION_LABELS = {
    "prd": "商品维度",
    "mem": "会员维度",
    "ord": "交易维度",
    "str": "门店维度",
    "inv": "库存维度",
    "mkt": "营销维度",
    "ful": "履约维度",
    "svc": "售后维度",
}


def indicator_row(
    index: int,
    dimension_code: str,
    *,
    status: str = "enabled",
    is_deleted: str = "N",
):
    return {
        "indicator_pk": index,
        "indicator_id": f"IND{index:06d}",
        "indicator_name": f"指标{index}",
        "semantic_state": "candidate",
        "dimension_code": dimension_code,
        "status_code": status,
        "registrar_name": "tester",
        "registered_date": "2026-07-01",
        "is_deleted": is_deleted,
        "created_by": "tester",
        "updated_by": "tester",
    }


def path_row(
    row_id: int,
    path_code: str,
    path_name: str,
    dimension_code: str,
    sort_order: int,
    *,
    path_level: int = 1,
):
    return {
        "id": row_id,
        "parent_id": None,
        "path_code": path_code,
        "path_name": path_name,
        "dimension_code": dimension_code,
        "path_level": path_level,
        "full_path": path_code,
        "sort_order": sort_order,
        "status": "enabled",
        "remark": None,
    }


class IndicatorDimensionCatalogSqliteTests(unittest.TestCase):
    """Dimension catalogue behaviour against a real SQL aggregation."""

    def build_service(self, indicator_rows, path_rows=()):
        engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        ).execution_options(schema_translate_map={"__app__": None})
        self.addCleanup(engine.dispose)
        for table in (indicator_item, indicator_path_config, asset_table, asset_field):
            table.create(engine)
        with engine.begin() as connection:
            if indicator_rows:
                connection.execute(insert(indicator_item), list(indicator_rows))
            if path_rows:
                connection.execute(insert(indicator_path_config), list(path_rows))

        service = IndicatorService()

        def fetch_rows(statement):
            with engine.connect() as connection:
                return [dict(row._mapping) for row in connection.execute(statement)]

        service._fetch_rows = fetch_rows
        # The parameter dictionary is an optional override; keep it empty so the
        # default resolution chain is what gets exercised.
        service._dimension_code_items = MagicMock(return_value=[])
        return service

    def bank_rows(self):
        rows = []
        index = 0
        for code, total in BANK_DIMENSION_DISTRIBUTION.items():
            for _ in range(total):
                index += 1
                rows.append(indicator_row(index, code))
        # The single disabled indicator and one soft-deleted row must not change
        # the dimension footing in different ways per dimension.
        rows[0] = indicator_row(1, "CUS", status="disabled")
        index += 1
        rows.append(indicator_row(index, "CUS", is_deleted="Y"))
        return rows

    def test_bank_data_exposes_seven_real_dimensions_with_matching_totals(self):
        service = self.build_service(self.bank_rows())

        catalog = service.get_dimension_catalog()
        listing = service.get_indicators()

        self.assertEqual(
            BANK_DIMENSION_ORDER, [item["code"] for item in catalog]
        )
        self.assertEqual(
            {code.lower(): total for code, total in BANK_DIMENSION_DISTRIBUTION.items()},
            {item["code"]: item["count"] for item in catalog},
        )
        # The catalogue must share the list API soft-delete footing.
        self.assertEqual(2301, len(listing))
        self.assertEqual(len(listing), sum(item["count"] for item in catalog))

    def test_bank_dimension_codes_survive_row_projection(self):
        service = self.build_service(self.bank_rows())

        items = service.get_indicators()
        dimensions = {item["dimension"] for item in items}

        self.assertEqual(set(BANK_DIMENSION_ORDER), dimensions)
        self.assertNotIn("", dimensions)

    def test_demo_data_keeps_the_eight_retail_dimensions_and_labels(self):
        rows = []
        index = 0
        for code, total in DEMO_DIMENSION_DISTRIBUTION.items():
            for _ in range(total):
                index += 1
                rows.append(indicator_row(index, code.lower()))
        path_rows = [
            path_row(position, code, DEMO_DIMENSION_LABELS[code.lower()], code.lower(), position)
            for position, code in enumerate(DEMO_DIMENSION_DISTRIBUTION, start=1)
        ]
        service = self.build_service(rows, path_rows)

        catalog = service.get_dimension_catalog()

        self.assertEqual(len(DEMO_DIMENSION_DISTRIBUTION), len(catalog))
        self.assertEqual(
            DEMO_DIMENSION_LABELS,
            {item["code"]: item["label"] for item in catalog},
        )
        self.assertAlmostEqual(
            len(service.get_indicators()), sum(item["count"] for item in catalog)
        )

    def test_unknown_dimension_code_is_not_silently_dropped(self):
        service = self.build_service(
            [indicator_row(1, "cus"), indicator_row(2, "channel")]
        )

        catalog = service.get_dimension_catalog()

        self.assertIn("channel", [item["code"] for item in catalog])
        self.assertEqual(1, {item["code"]: item["count"] for item in catalog}["channel"])
        # No configured label yet: the badge falls back to the raw code.
        self.assertEqual(
            "CHANNEL", {item["code"]: item["label"] for item in catalog}["channel"]
        )
        self.assertEqual(
            "channel",
            next(
                item["dimension"]
                for item in service.get_indicators()
                if item["id"] == "IND000002"
            ),
        )

    def test_new_dimension_is_discovered_without_code_change(self):
        service = self.build_service(
            [indicator_row(1, "cus"), indicator_row(2, "cus"), indicator_row(3, "rio")]
        )

        self.assertEqual(
            [("cus", 2), ("rio", 1)],
            [(item["code"], item["count"]) for item in service.get_dimension_catalog()],
        )

        # A newly imported (not seeded, not redeployed) dimension shows up too.
        service = self.build_service(
            [indicator_row(1, "cus"), indicator_row(2, "rio"), indicator_row(3, "rio")]
        )

        self.assertEqual(
            [("rio", 2), ("cus", 1)],
            [(item["code"], item["count"]) for item in service.get_dimension_catalog()],
        )

    def test_empty_dimension_is_counted_instead_of_disappearing(self):
        service = self.build_service(
            [indicator_row(1, "cus"), indicator_row(2, ""), indicator_row(3, "")]
        )

        catalog = service.get_dimension_catalog()

        self.assertEqual(
            [("", 2), ("cus", 1)],
            [(item["code"], item["count"]) for item in catalog],
        )
        self.assertEqual("", catalog[0]["label"])
        self.assertEqual(
            len(service.get_indicators()), sum(item["count"] for item in catalog)
        )

    def test_status_filter_and_soft_delete_share_one_footing(self):
        service = self.build_service(
            [
                indicator_row(1, "cus"),
                indicator_row(2, "cus", status="disabled"),
                indicator_row(3, "cus", is_deleted="Y"),
            ]
        )

        self.assertEqual(
            [("cus", 2)], [(item["code"], item["count"]) for item in service.get_dimension_catalog()]
        )

    def test_label_resolution_prefers_dictionary_then_path_config_then_code(self):
        service = self.build_service(
            [indicator_row(1, "cus"), indicator_row(2, "emp"), indicator_row(3, "channel")],
            [
                path_row(1, "CUS", "客户基础维度", "cus", 1),
                path_row(2, "EMP", "员工维度", "emp", 2),
            ],
        )
        service._dimension_code_items = MagicMock(
            return_value=[{"code": "EMP", "name": "员工主数据维度"}]
        )

        labels = {
            item["code"]: item["label"] for item in service.get_dimension_catalog()
        }

        self.assertEqual("客户基础维度", labels["cus"])
        self.assertEqual("员工主数据维度", labels["emp"])
        self.assertEqual("CHANNEL", labels["channel"])

    def test_configured_path_roots_extend_the_writable_dimension_set(self):
        service = self.build_service(
            [], [path_row(1, "RETL", "零售维度", "retl", 1)]
        )

        self.assertTrue(service._is_allowed_dimension("cus"))
        self.assertTrue(service._is_allowed_dimension("retl"))
        self.assertFalse(service._is_allowed_dimension("bogus"))
        self.assertFalse(service._is_allowed_dimension(""))

    def test_dimension_aggregate_is_portable_across_supported_dialects(self):
        service = self.build_service(self.bank_rows())
        service._fetch_rows = MagicMock(return_value=[])
        service.get_dimension_catalog()

        statement = service._fetch_rows.call_args_list[0].args[0]
        for dialect in (sqlite.dialect(), postgresql.dialect(), mysql.dialect()):
            with self.subTest(dialect=dialect.name):
                compiled = str(statement.compile(dialect=dialect))
                self.assertIn("lower(", compiled)
                self.assertIn("GROUP BY lower(", compiled)
                self.assertIn("count(*)", compiled)
                self.assertIn("p_indicator_item.is_deleted = ", compiled)


class IndicatorDimensionApiTests(unittest.TestCase):
    def setUp(self):
        self.indicators = MagicMock()
        self.environment = patch.dict(
            os.environ,
            {
                "APP_ENV": "development",
                "APP_SECRET_KEY": "indicator-dimension-contract-test",
                "PUBLIC_CATALOG_PROFILE": "internal",
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def client(self):
        app = create_fastapi_app(
            capabilities=resolve_capabilities(),
            identity_resolver=lambda _request: None,
            indicator_service_instance=self.indicators,
            openapi_enabled=True,
        )
        return TestClient(app)

    def test_dimension_directory_is_served_before_the_detail_route(self):
        self.indicators.get_dimension_catalog.return_value = [
            {"code": "cus", "label": "客户维度", "count": 1230},
            {"code": "org", "label": "机构维度", "count": 2},
        ]
        self.indicators.get_indicator_detail.return_value = {"id": "dimensions"}

        response = self.client().get("/api/indicators/dimensions")

        self.assertEqual(200, response.status_code)
        self.assertEqual(
            [
                {"code": "cus", "label": "客户维度", "count": 1230},
                {"code": "org", "label": "机构维度", "count": 2},
            ],
            response.json()["items"],
        )
        self.indicators.get_indicator_detail.assert_not_called()

    def test_dimension_directory_is_documented_in_openapi(self):
        self.indicators.get_dimension_catalog.return_value = []
        schema = self.client().get("/openapi.json").json()

        operation = schema["paths"]["/api/indicators/dimensions"]["get"]
        self.assertEqual("查询指标维度目录", operation["summary"])
        self.assertEqual(
            [],
            [parameter["name"] for parameter in operation.get("parameters", [])],
        )

    def test_data_source_failure_keeps_the_standard_error_envelope(self):
        self.indicators.get_dimension_catalog.side_effect = IndicatorDataSourceError(
            "数据库服务暂不可用，请稍后重试"
        )

        response = self.client().get("/api/indicators/dimensions")

        self.assertEqual(500, response.status_code)
        self.assertEqual(
            {
                "error": {
                    "code": "INDICATOR_DATA_SOURCE_ERROR",
                    "message": "数据库服务暂不可用，请稍后重试",
                }
            },
            response.json(),
        )

    def test_public_catalog_disabled_blocks_anonymous_directory_access(self):
        with patch.dict(os.environ, {"PUBLIC_CATALOG_PROFILE": "disabled"}):
            response = self.client().get("/api/indicators/dimensions")

        self.assertEqual(401, response.status_code)
        self.assertEqual("UNAUTHORIZED", response.json()["error"]["code"])


if __name__ == "__main__":
    unittest.main()
