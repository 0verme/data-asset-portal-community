from __future__ import annotations

import re
import tempfile
import unittest
from pathlib import Path

from backend.app.migrations.schema import (
    CREATE_TABLE_RE,
    _find_matching_parenthesis,
    _identifier,
    _identifier_list,
    _split_sql_statements,
    baseline_path,
    baseline_schema,
)
from backend.tests.dws_relationship_contract import DWS_LOGICAL_RELATIONSHIPS


def _dws_distribution_scan(sql: str, schema):
    """Return recognized strategies, scanner errors, and scanned CREATE TABLE count."""
    distributions: dict[str, tuple[str, tuple[str, ...]]] = {}
    violations: list[str] = []
    scanned_tables: list[str] = []
    baseline_create_count = len(list(CREATE_TABLE_RE.finditer(sql)))

    for statement in _split_sql_statements(sql):
        for match in CREATE_TABLE_RE.finditer(statement):
            table_name = _identifier(match.group("table"))
            scanned_tables.append(table_name)
            if table_name not in schema.tables:
                violations.append(f"{table_name}: missing parsed table definition")
                continue

            closing = _find_matching_parenthesis(statement, match.end() - 1)
            suffix = statement[closing + 1 :]
            clauses = list(re.finditer(r"\bDISTRIBUTE\s+BY\b", suffix, re.I))
            if not clauses:
                violations.append(
                    f"{table_name}: missing explicit DWS distribution strategy"
                )
                continue
            if len(clauses) != 1:
                violations.append(
                    f"{table_name}: multiple DWS distribution strategies"
                )
                continue

            distribution = re.fullmatch(
                r"\s*DISTRIBUTE\s+BY\s+(?P<strategy>REPLICATION|HASH)"
                r"(?:\s*\((?P<columns>[^()]*)\))?\s*",
                suffix,
                re.I,
            )
            if distribution is None:
                violations.append(
                    f"{table_name}: unrecognized DWS distribution strategy"
                )
                continue

            strategy = distribution.group("strategy").upper()
            raw_columns = distribution.group("columns")
            if strategy == "REPLICATION":
                if raw_columns is not None:
                    violations.append(
                        f"{table_name}: unrecognized DWS distribution strategy"
                    )
                    continue
                columns: tuple[str, ...] = ()
            else:
                columns = _identifier_list(raw_columns or "")
                if not columns:
                    violations.append(f"{table_name}: HASH distribution has no columns")
                    continue
            distributions[table_name] = (strategy, columns)

    if len(scanned_tables) != baseline_create_count:
        violations.append(
            "DWS distribution scanner CREATE TABLE coverage "
            f"{len(scanned_tables)}/{baseline_create_count}"
        )
    if len(distributions) != baseline_create_count:
        violations.append(
            "DWS distribution strategy coverage "
            f"{len(distributions)}/{baseline_create_count} CREATE TABLE statements"
        )
    for table_name in sorted(set(schema.tables) - set(scanned_tables)):
        violations.append(
            f"{table_name}: baseline parser recognized CREATE TABLE "
            "but distribution scanner did not"
        )
    return distributions, violations, len(scanned_tables)


def _hash_constraint_violations(distributions, schema) -> list[str]:
    violations: list[str] = []
    for table_name, (strategy, distribution_columns) in distributions.items():
        if strategy != "HASH":
            continue
        table = schema.tables.get(table_name)
        if table is None:
            violations.append(f"{table_name}: missing parsed table definition")
            continue

        required = set(distribution_columns)
        constraints: list[tuple[str, tuple[str, ...]]] = []
        if table.primary_key:
            constraints.append(("PRIMARY KEY", table.primary_key))
        constraints.extend(
            (f"UNIQUE constraint ({', '.join(columns)})", columns)
            for columns in sorted(table.unique_constraints)
        )
        constraints.extend(
            (f"UNIQUE INDEX {index.name}", index.columns)
            for index in table.indexes.values()
            if index.unique
        )
        for name, columns in constraints:
            missing = required - set(columns)
            if missing:
                violations.append(
                    f"{table_name} {name} omits HASH column(s): "
                    f"{', '.join(sorted(missing))}"
                )
    return violations


def _logical_relationship_distribution_violations(
    distributions, relationships=DWS_LOGICAL_RELATIONSHIPS
) -> list[str]:
    violations: list[str] = []
    for relationship in relationships:
        child_distribution = distributions.get(relationship.child_table)
        parent_distribution = distributions.get(relationship.parent_table)
        label = (
            f"{relationship.child_table}{relationship.child_columns} -> "
            f"{relationship.parent_table}{relationship.parent_columns}"
        )
        if child_distribution is None or parent_distribution is None:
            violations.append(f"{label}: missing logical relationship table strategy")
            continue

        child_strategy, child_columns = child_distribution
        parent_strategy, parent_columns = parent_distribution
        if child_strategy == "HASH" and not set(child_columns).issubset(
            relationship.child_columns
        ):
            violations.append(
                f"{label}: logical child columns omit HASH column(s) {child_columns}"
            )
        if parent_strategy == "HASH" and not set(parent_columns).issubset(
            relationship.parent_columns
        ):
            violations.append(
                f"{label}: logical parent columns omit HASH column(s) {parent_columns}"
            )
        if child_strategy == parent_strategy == "HASH":
            if len(relationship.child_columns) != len(relationship.parent_columns):
                violations.append(f"{label}: logical relationship column counts differ")
                continue
            mapping = dict(zip(relationship.child_columns, relationship.parent_columns))
            if tuple(mapping.get(column) for column in child_columns) != parent_columns:
                violations.append(
                    f"{label}: logical HASH columns do not map to parent HASH columns"
                )
    return violations


def _fixture_contract(sql: str):
    with tempfile.TemporaryDirectory(prefix="dws-distribution-contract-") as directory:
        root = Path(directory)
        (root / "dws.sql").write_text(sql, encoding="utf-8")
        fixture_sql = baseline_path("dws", root).read_text(encoding="utf-8")
        schema = baseline_schema("dws", root)
    distributions, distribution_errors, scanned_count = _dws_distribution_scan(
        fixture_sql, schema
    )
    return (
        distributions,
        distribution_errors,
        _hash_constraint_violations(distributions, schema),
        scanned_count,
    )


class DwsDistributionContractTests(unittest.TestCase):
    def test_every_baseline_table_has_one_recognized_explicit_strategy(self):
        sql = baseline_path("dws").read_text(encoding="utf-8")
        schema = baseline_schema("dws")
        create_table_count = len(list(CREATE_TABLE_RE.finditer(sql)))
        distributions, violations, scanned_count = _dws_distribution_scan(sql, schema)

        self.assertEqual(create_table_count, len(schema.tables))
        self.assertEqual(create_table_count, scanned_count)
        self.assertEqual(create_table_count, len(distributions))
        self.assertEqual([], violations)
        self.assertEqual([], _hash_constraint_violations(distributions, schema))

    def test_logical_relationships_keep_hash_distribution_compatibility(self):
        sql = baseline_path("dws").read_text(encoding="utf-8")
        schema = baseline_schema("dws")
        distributions, violations, _ = _dws_distribution_scan(sql, schema)

        self.assertEqual(13, len(DWS_LOGICAL_RELATIONSHIPS))
        self.assertEqual([], violations)
        self.assertEqual(
            [], _logical_relationship_distribution_violations(distributions)
        )

    def test_hash_distribution_must_cover_logical_child_columns(self):
        lineage_node = next(
            relation
            for relation in DWS_LOGICAL_RELATIONSHIPS
            if relation.child_table == "p_lineage_node"
        )
        violations = _logical_relationship_distribution_violations(
            {
                "p_lineage_node": ("HASH", ("node_id",)),
                "p_lineage_snapshot": ("REPLICATION", ()),
            },
            (lineage_node,),
        )
        self.assertEqual(1, len(violations), violations)
        self.assertIn("logical child columns omit HASH column(s)", violations[0])

    def test_missing_distribution_is_reported_with_table_name(self):
        _, violations, _, _ = _fixture_contract(
            """CREATE TABLE IF NOT EXISTS dwp.sample (
  id BIGINT PRIMARY KEY
);"""
        )
        self.assertTrue(
            any(
                "sample: missing explicit DWS distribution strategy" in item
                for item in violations
            ),
            violations,
        )

    def test_replication_is_a_valid_explicit_strategy_without_hash_key_checks(self):
        distributions, violations, hash_violations, scanned_count = _fixture_contract(
            """CREATE TABLE IF NOT EXISTS dwp.sample (
  id BIGINT PRIMARY KEY,
  code VARCHAR(64) UNIQUE
) DISTRIBUTE BY REPLICATION;"""
        )
        self.assertEqual(1, scanned_count)
        self.assertEqual({"sample": ("REPLICATION", ())}, distributions)
        self.assertEqual([], violations)
        self.assertEqual([], hash_violations)

    def test_hash_primary_key_must_contain_distribution_key(self):
        distributions, violations, hash_violations, _ = _fixture_contract(
            """CREATE TABLE IF NOT EXISTS dwp.sample (
  id BIGINT,
  tenant_id BIGINT,
  PRIMARY KEY (id)
) DISTRIBUTE BY HASH (tenant_id);"""
        )
        self.assertEqual([], violations)
        self.assertTrue(
            any("sample PRIMARY KEY" in item for item in hash_violations),
            hash_violations,
        )
        self.assertIn("sample", distributions)

    def test_hash_unique_constraint_must_contain_distribution_key(self):
        _, violations, hash_violations, _ = _fixture_contract(
            """CREATE TABLE IF NOT EXISTS dwp.sample (
  tenant_id BIGINT,
  id BIGINT,
  external_code VARCHAR(64),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (external_code)
) DISTRIBUTE BY HASH (tenant_id);"""
        )
        self.assertEqual([], violations)
        self.assertTrue(
            any(
                "UNIQUE constraint (external_code)" in item
                for item in hash_violations
            ),
            hash_violations,
        )

    def test_hash_unique_index_must_contain_distribution_key(self):
        _, violations, hash_violations, _ = _fixture_contract(
            """CREATE TABLE IF NOT EXISTS dwp.sample (
  tenant_id BIGINT,
  id BIGINT,
  external_code VARCHAR(64),
  PRIMARY KEY (tenant_id, id)
) DISTRIBUTE BY HASH (tenant_id);
CREATE UNIQUE INDEX uq_sample_code ON dwp.sample (external_code);"""
        )
        self.assertEqual([], violations)
        self.assertTrue(
            any("UNIQUE INDEX uq_sample_code" in item for item in hash_violations),
            hash_violations,
        )

    def test_valid_hash_table_keeps_pk_unique_and_unique_index_compatible(self):
        _, violations, hash_violations, _ = _fixture_contract(
            """CREATE TABLE IF NOT EXISTS dwp.sample (
  tenant_id BIGINT,
  id BIGINT,
  external_code VARCHAR(64),
  another_code VARCHAR(64),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, external_code)
) DISTRIBUTE BY HASH (tenant_id);
CREATE UNIQUE INDEX uq_sample_code
  ON dwp.sample (tenant_id, another_code);"""
        )
        self.assertEqual([], violations)
        self.assertEqual([], hash_violations)

    def test_multicolumn_hash_requires_every_distribution_column(self):
        _, violations, hash_violations, _ = _fixture_contract(
            """CREATE TABLE IF NOT EXISTS dwp.sample (
  tenant_id BIGINT,
  shard_id BIGINT,
  id BIGINT,
  PRIMARY KEY (tenant_id, id)
) DISTRIBUTE BY HASH (tenant_id, shard_id);"""
        )
        self.assertEqual([], violations)
        self.assertTrue(
            any("omits HASH column(s): shard_id" in item for item in hash_violations),
            hash_violations,
        )

    def test_multiple_or_unrecognized_strategies_fail_with_table_name(self):
        cases = (
            (
                "DISTRIBUTE BY REPLICATION DISTRIBUTE BY HASH (id)",
                "sample: multiple DWS distribution strategies",
            ),
            (
                "DISTRIBUTE BY ROUNDROBIN",
                "sample: unrecognized DWS distribution strategy",
            ),
        )
        for suffix, expected in cases:
            with self.subTest(suffix=suffix):
                _, violations, _, _ = _fixture_contract(
                    "CREATE TABLE IF NOT EXISTS dwp.sample (id BIGINT PRIMARY KEY) "
                    f"{suffix};"
                )
                self.assertTrue(
                    any(expected in item for item in violations), violations
                )


if __name__ == "__main__":
    unittest.main()
