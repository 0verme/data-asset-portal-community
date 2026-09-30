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
    baseline_path,
    baseline_schema,
)


def _hash_distribution_keys(sql: str) -> dict[str, tuple[str, ...]]:
    """Read every table-level DWS HASH distribution key from the baseline."""
    distributions: dict[str, tuple[str, ...]] = {}
    for match in CREATE_TABLE_RE.finditer(sql):
        closing = _find_matching_parenthesis(sql, match.end() - 1)
        distribution = re.match(
            r"\s*DISTRIBUTE\s+BY\s+HASH\s*\((?P<columns>[^)]*)\)",
            sql[closing + 1 :],
            re.I,
        )
        if distribution:
            distributions[_identifier(match.group("table"))] = _identifier_list(
                distribution.group("columns")
            )
    return distributions


def _hash_constraint_violations(sql: str, schema) -> list[str]:
    violations: list[str] = []
    for table_name, distribution_columns in _hash_distribution_keys(sql).items():
        table = schema.tables.get(table_name)
        if table is None:
            violations.append(f"{table_name}: missing parsed table definition")
            continue
        required = set(distribution_columns)
        if not required:
            violations.append(f"{table_name}: HASH distribution has no columns")
            continue

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
                    f"{table_name} {name} omits HASH column(s): {', '.join(sorted(missing))}"
                )
    return violations


class DwsDistributionContractTests(unittest.TestCase):
    def test_every_hash_distributed_baseline_key_contains_its_distribution_columns(self):
        sql = baseline_path("dws").read_text(encoding="utf-8")
        distributions = _hash_distribution_keys(sql)

        self.assertTrue(distributions, "DWS HASH distribution scan found no tables")
        self.assertEqual([], _hash_constraint_violations(sql, baseline_schema("dws")))

    def test_contract_detects_pk_unique_constraint_and_unique_index_mismatches(self):
        invalid_baseline = """\
CREATE TABLE IF NOT EXISTS dwp.sample (
    id BIGINT NOT NULL,
    tenant_id BIGINT NOT NULL,
    external_code VARCHAR(32) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (external_code)
) DISTRIBUTE BY HASH (tenant_id);
CREATE UNIQUE INDEX uq_sample_external ON dwp.sample (external_code);
"""
        with tempfile.TemporaryDirectory(prefix="dws-distribution-contract-") as directory:
            root = Path(directory)
            (root / "dws.sql").write_text(invalid_baseline, encoding="utf-8")
            sql = baseline_path("dws", root).read_text(encoding="utf-8")
            schema = baseline_schema("dws", root)

        violations = _hash_constraint_violations(sql, schema)
        self.assertEqual(3, len(violations))
        self.assertTrue(any("PRIMARY KEY" in item for item in violations))
        self.assertTrue(any("UNIQUE constraint (external_code)" in item for item in violations))
        self.assertTrue(any("UNIQUE INDEX uq_sample_external" in item for item in violations))


if __name__ == "__main__":
    unittest.main()
