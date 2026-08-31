import unittest
from unittest.mock import MagicMock, patch

from backend.scripts.imp_dws_comments import (
    FieldMappingRow,
    FieldMappingTableLayout,
    TableMappingRow,
    execute_import,
    load_upstream_system_map,
)


def _table_row(name: str) -> TableMappingRow:
    return TableMappingRow(
        upstream_system_id=1,
        file_path=f"{name}.py",
        source_table=f"SRC_{name.upper()}",
        source_table_name=f"SRC_{name.upper()}",
        source_table_cn=name,
        target_table_name=f"DWF_{name.upper()}",
        load_mode="full",
        field_total_count=1,
        mapped_field_count=1,
        table_desc=name,
        latest_mapping_time="2026-07-27 00:00:00",
        fields=[FieldMappingRow("source", "target", 1, "direct")],
        source_columns={"source": {"type": "VARCHAR", "comment": ""}},
    )


class DwsCommentImportTransactionTests(unittest.TestCase):
    def test_upstream_map_never_uses_ambiguous_display_names(self):
        columns = ["system_pk", "system_abbr", "system_id"]
        rows = [(1, "MEM", "up_member"), (2, "MEM", "up_member_test")]
        with patch(
            "backend.scripts.imp_dws_comments.fetch_all",
            return_value=(columns, rows),
        ):
            mapping = load_upstream_system_map("gauss_primary")
        self.assertNotIn("MEM", mapping)
        self.assertEqual(1, mapping["UP_MEMBER"])
        self.assertEqual(2, mapping["UP_MEMBER_TEST"])

    def test_import_commits_cleanup_and_each_successful_table(self):
        conn = MagicMock()
        cursor = conn.cursor.return_value
        rows = [_table_row("good_one"), _table_row("bad"), _table_row("good_two")]

        def execute(sql):
            if sql == "TABLE bad.py":
                raise RuntimeError("invalid mapping")

        cursor.execute.side_effect = execute
        with patch("backend.scripts.imp_dws_comments.connect_with_profile", return_value=conn), \
                patch(
                    "backend.scripts.imp_dws_comments.build_table_insert_statement",
                    side_effect=lambda row, *_args: f"TABLE {row.file_path}",
                ), \
                patch(
                    "backend.scripts.imp_dws_comments.build_field_insert_statement",
                    return_value="FIELD",
                ):
            execute_import(
                "gauss_primary",
                rows,
                FieldMappingTableLayout(has_upstream_system_id=True, has_system_pk=False),
            )

        self.assertEqual(conn.commit.call_count, 3)
        conn.rollback.assert_called_once_with()
        executed_sql = [call.args[0] for call in cursor.execute.call_args_list]
        self.assertEqual(
            executed_sql,
            [
                "TRUNCATE TABLE dwp.p_field_mapping_field",
                "TRUNCATE TABLE dwp.p_field_mapping_table",
                "TABLE good_one.py",
                "FIELD",
                "TABLE bad.py",
                "TABLE good_two.py",
                "FIELD",
            ],
        )
        self.assertFalse(any(sql.startswith("DELETE FROM") for sql in executed_sql))
        cursor.close.assert_called_once_with()
        conn.close.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
