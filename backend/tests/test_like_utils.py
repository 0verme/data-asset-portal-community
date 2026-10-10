from __future__ import annotations

import unittest
from contextlib import nullcontext
from unittest.mock import Mock, patch

from sqlalchemy import Column, MetaData, String, Table, create_engine, func, select
from sqlalchemy.dialects import mysql, postgresql, sqlite

from backend.app.services.api_asset_service import ApiAssetService
from backend.app.services.field_mapping_service import FieldMappingService
from backend.app.services.indicator_service import IndicatorService
from backend.app.services.manual_code_table_service import ManualCodeTableService
from backend.app.services.operation_log_service import OperationLogService
from backend.app.services.report_service import ReportService
from backend.app.services.root_service import RootService
from backend.app.utils.like_utils import LIKE_ESCAPE_CHAR, escape_like_keyword


class LikeUtilsTests(unittest.TestCase):
    def test_escape_character_is_escaped_before_like_wildcards(self):
        self.assertEqual("~~~%~_", escape_like_keyword("~%_"))
        self.assertEqual("customer", escape_like_keyword("customer"))

    def test_literal_like_matching_for_wildcards_escape_and_combinations(self):
        metadata = MetaData()
        records = Table(
            "records",
            metadata,
            Column("value", String, nullable=True),
        )
        engine = create_engine("sqlite:///:memory:")
        metadata.create_all(engine)
        values = (
            "客户订单",
            "percent%value",
            "under_score",
            "tilde~value",
            "mix%_~",
            "plain text",
        )
        with engine.begin() as connection:
            connection.execute(records.insert(), [{"value": value} for value in values])

        expected_matches = {
            "客户": {"客户订单"},
            "%": {"percent%value", "mix%_~"},
            "_": {"under_score", "mix%_~"},
            "~": {"tilde~value", "mix%_~"},
            "%_~": {"mix%_~"},
        }
        with engine.connect() as connection:
            for keyword, expected in expected_matches.items():
                pattern = f"%{escape_like_keyword(keyword.lower())}%"
                statement = (
                    select(records.c.value)
                    .where(
                        func.lower(records.c.value).like(
                            pattern, escape=LIKE_ESCAPE_CHAR
                        )
                    )
                    .order_by(records.c.value)
                )
                with self.subTest(keyword=keyword):
                    actual = set(connection.execute(statement).scalars())
                    self.assertEqual(expected, actual)
        engine.dispose()

    @staticmethod
    def _service_filter_statements(keyword):
        statements = []

        field_mapping = FieldMappingService()
        statements.append(select(1).where(*field_mapping._build_where({"keyword": keyword})))

        api_assets = ApiAssetService()
        api_assets._rows = Mock(return_value=[])
        with patch(
            "backend.app.services.api_asset_service.database_transaction",
            side_effect=lambda: nullcontext(),
        ):
            api_assets.get_assets(keyword=keyword)
        statements.append(api_assets._rows.call_args.args[0])
        api_assets.get_downstream_systems(keyword=keyword)
        statements.append(api_assets._rows.call_args.args[0])

        indicator = IndicatorService()
        statements.append(
            select(1).where(*indicator._build_indicator_filters(keyword=keyword))
        )
        statements.append(
            select(1).where(*ManualCodeTableService._build_filters(keyword=keyword))
        )
        operation_log = OperationLogService()
        statements.append(
            select(1).where(*operation_log._build_where({"keyword": keyword}))
        )
        report = ReportService()
        statements.append(
            select(1).where(*report._build_report_filters(keyword=keyword))
        )
        statements.append(
            select(1).where(*RootService._build_item_filters(keyword=keyword))
        )
        return statements

    def test_all_affected_service_filters_compile_portably_with_bound_patterns(self):
        dialects = (
            sqlite.dialect(),
            postgresql.dialect(),
            mysql.dialect(),
            # GaussDB JDBC Core compiles PostgreSQL SQL with qmark binds.
            postgresql.dialect(paramstyle="qmark"),
        )
        keywords = ("客户", "%", "_", "~", "mix%_~", "bound-input-98' OR 1=1 --%")
        for keyword in keywords:
            expected_pattern = f"%{escape_like_keyword(keyword.strip().lower())}%"
            statements = self._service_filter_statements(keyword)
            self.assertEqual(8, len(statements))
            for statement in statements:
                for dialect in dialects:
                    compiled = statement.compile(dialect=dialect)
                    sql = str(compiled)
                    with self.subTest(keyword=keyword, dialect=dialect.name, sql=sql[:120]):
                        self.assertIn("ESCAPE '~'", sql)
                        self.assertIn(expected_pattern, compiled.params.values())
                        self.assertNotIn("bound-input-98", sql)


if __name__ == "__main__":
    unittest.main()
