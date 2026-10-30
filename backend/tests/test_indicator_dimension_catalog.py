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
    IndicatorValidationError,
)

# pyright: reportMissingImports=false

# Cross-industry fixtures: dimensions are user data, so the contract is not
# allowed to depend on which industry a code comes from.
MIXED_DIMENSION_DISTRIBUTION = {
    "CUS": 3,  # finance / corporate
    "PRD": 2,  # retail demo vocabulary
    "MFG": 2,  # manufacturing
    "PLNT": 1,  # manufacturing, multi-letter code
    "REGION_APAC": 1,  # custom organisation code with an underscore
    "ZZ9": 1,  # never referenced anywhere in the code base
}
MIXED_DIMENSION_ORDER = [
    "cus",
    "mfg",
    "prd",
    "plnt",
    "region_apac",
    "zz9",
]

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

    def mixed_rows(self):
        rows = []
        index = 0
        for code, total in MIXED_DIMENSION_DISTRIBUTION.items():
            for _ in range(total):
                index += 1
                rows.append(indicator_row(index, code))
        # The single disabled indicator and one soft-deleted row must not change
        # the dimension footing in different ways per dimension.
        rows[0] = indicator_row(1, "CUS", status="disabled")
        index += 1
        rows.append(indicator_row(index, "CUS", is_deleted="Y"))
        return rows

    def test_mixed_industry_data_exposes_matching_totals(self):
        service = self.build_service(self.mixed_rows())

        catalog = service.get_dimension_catalog()
        listing = service.get_indicators()

        self.assertEqual(MIXED_DIMENSION_ORDER, [item["code"] for item in catalog])
        self.assertEqual(
            {
                code.lower(): total
                for code, total in MIXED_DIMENSION_DISTRIBUTION.items()
            },
            {item["code"]: item["count"] for item in catalog},
        )
        # The catalogue must share the list API soft-delete footing.
        self.assertEqual(10, len(listing))
        self.assertEqual(len(listing), sum(item["count"] for item in catalog))

    def test_mixed_dimension_codes_survive_row_projection(self):
        service = self.build_service(self.mixed_rows())

        items = service.get_indicators()
        dimensions = {item["dimension"] for item in items}

        self.assertEqual(set(MIXED_DIMENSION_ORDER), dimensions)
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

    def test_a_brand_new_code_needs_no_configuration_at_all(self):
        service = self.build_service(
            [indicator_row(1, "zz9"), indicator_row(2, "zz9")]
        )

        catalog = service.get_dimension_catalog()

        self.assertEqual([("zz9", 2)], [(item["code"], item["count"]) for item in catalog])
        # No configured name: the code itself is the display name.
        self.assertEqual("ZZ9", catalog[0]["label"])
        self.assertEqual(2, len(service.get_indicators(dimension="ZZ9")))
        self.assertEqual(2, len(service.get_indicators(dimension="zz9")))

    def test_malformed_dimension_filter_matches_nothing(self):
        service = self.build_service([indicator_row(1, "cus"), indicator_row(2, "")])

        # A malformed filter must not collapse onto the "unassigned" bucket.
        self.assertEqual([], service.get_indicators(dimension="bad code!"))
        self.assertEqual([], service.get_indicators(dimension="--"))
        self.assertEqual(1, len(service.get_indicators(dimension="cus")))

    def test_dimension_aggregate_is_portable_across_supported_dialects(self):
        service = self.build_service(self.mixed_rows())
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


class IndicatorDimensionWriteBoundaryTests(unittest.TestCase):
    """The write boundary validates the code format, never a business list."""

    def setUp(self):
        self.service = IndicatorService()
        self.service._allowed_status_values = MagicMock(
            return_value={"enabled", "disabled"}
        )
        self.service._resolve_semantic_asset = MagicMock(return_value=None)
        self.service._resolve_semantic_field = MagicMock(return_value=None)

    def payload(self, **overrides):
        base = {
            "id": "IND_NEW",
            "name": "跨行业新指标",
            "dimension": "zz9",
            "path": "ZZ9 > 根节点 > 叶子",
            "status": "enabled",
            "registrar": "tester",
            "registeredAt": "2026-07-01",
        }
        base.update(overrides)
        return base

    def test_any_well_formed_code_is_accepted_without_configuration(self):
        for code in ("zz9", "MFG", "region_apac", "A1", "x" * 16):
            with self.subTest(code=code):
                item = self.service._normalize_payload(self.payload(dimension=code))
                self.assertEqual(code.lower(), item["dimension"])

    def test_only_generic_format_and_length_are_enforced(self):
        for code in ("-bad", "bad code", "1abc", "a" * 17, "维"):
            with self.subTest(code=code):
                with self.assertRaises(IndicatorValidationError) as ctx:
                    self.service._normalize_payload(self.payload(dimension=code))
                self.assertIn(
                    "dimension", {item["field"] for item in ctx.exception.details}
                )

    def test_chinese_dimension_label_is_not_translated_into_a_code(self):
        # The service owns no industry wording: a label is not a dimension code.
        with self.assertRaises(IndicatorValidationError) as ctx:
            self.service._normalize_payload(self.payload(dimension="客户维度"))
        self.assertIn(
            "dimension", {item["field"] for item in ctx.exception.details}
        )

    def test_dimension_is_required_when_the_path_has_no_code_root(self):
        for payload in (
            self.payload(dimension="", path="客户基础 > 叶子"),
            self.payload(dimension="", path=""),
        ):
            with self.assertRaises(IndicatorValidationError) as ctx:
                self.service._normalize_payload(payload)
            self.assertIn(
                "dimension", {item["field"] for item in ctx.exception.details}
            )

    def test_dimension_can_be_derived_from_the_path_root(self):
        item = self.service._normalize_payload(
            self.payload(dimension="", path="PLNT > 产线 > 产量")
        )
        self.assertEqual("plnt", item["dimension"])

    def test_create_keeps_a_brand_new_code_verbatim(self):
        self.service._db.fetch_rows = MagicMock(return_value=[])
        self.service._db.next_pk = MagicMock(side_effect=[1, 2])
        self.service._db.execute_statements = MagicMock()

        created = self.service._create_indicator(self.payload(dimension="zz9"))

        self.assertEqual("zz9", created["dimension"])
        statements = self.service._db.execute_statements.call_args.args[0]
        self.assertEqual(2, len(statements))
        self.assertEqual("zz9", statements[0].compile().params["dimension_code"])

    def test_update_keeps_a_brand_new_code(self):
        self.service._db.fetch_rows = MagicMock(
            side_effect=[
                [{"indicator_pk": 1}],
                [
                    {
                        "indicator_pk": 1,
                        "indicator_id": "IND_NEW",
                        "indicator_name": "跨行业新指标",
                        "meaning_desc": "",
                        "result_table_name": "",
                        "result_field_name": "",
                        "dimension_code": "zz9",
                        "caliber_desc": "",
                        "path_desc": "ZZ9 > 根节点 > 叶子",
                        "status_code": "enabled",
                        "registrar_name": "tester",
                        "registered_date": "2026-07-01",
                    }
                ],
            ]
        )
        self.service._db.next_pk = MagicMock(return_value=2)
        self.service._db.execute_statements = MagicMock()

        _, updated = self.service._update_indicator(
            "IND_NEW", self.payload(dimension="zz9", name="改名后的指标")
        )

        self.assertEqual("改名后的指标", updated["name"])
        self.assertEqual("zz9", updated["dimension"])
        statements = self.service._db.execute_statements.call_args.args[0]
        self.assertEqual("zz9", statements[0].compile().params["dimension_code"])


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
            {"code": "cus", "label": "客户维度", "count": 61},
            {"code": "org", "label": "机构维度", "count": 2},
        ]
        self.indicators.get_indicator_detail.return_value = {"id": "dimensions"}

        response = self.client().get("/api/indicators/dimensions")

        self.assertEqual(200, response.status_code)
        self.assertEqual(
            [
                {"code": "cus", "label": "客户维度", "count": 61},
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
