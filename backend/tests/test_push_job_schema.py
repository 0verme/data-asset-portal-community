import unittest

from backend.tests.db_test_support import DOCS_DWS, DOCS_PG, assert_table_has_columns, extract_create_table_body, read_sql


class PushJobSchemaTests(unittest.TestCase):
    def test_initial_schema_does_not_define_duplicate_owner_name(self):
        for docs, suffix in ((DOCS_PG, "pg"), (DOCS_DWS, "dws")):
            sql = read_sql(docs / f"push-app-{suffix}-ddl.sql")
            body = extract_create_table_body(sql, "p_push_job")
            self.assertNotIn("owner_name", body.lower())

    def test_push_system_schema_defines_importance_and_latest_output_time(self):
        for docs, suffix in ((DOCS_PG, "pg"), (DOCS_DWS, "dws")):
            sql = read_sql(docs / f"push-app-{suffix}-ddl.sql")
            assert_table_has_columns(
                sql,
                "p_push_system",
                {"importance_level_code", "latest_output_time", "system_code"},
            )
            self.assertIn("DEFAULT 'normal'", sql)


if __name__ == "__main__":
    unittest.main()
