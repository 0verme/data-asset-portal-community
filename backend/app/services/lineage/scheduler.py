# Copyright 2025 Jearhe
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Scheduler source adapter for lineage collection.

Community core does not depend on any specific scheduler platform schema. The
collector reads job / program metadata from tables whose names are injected via
configuration (``LINEAGE_JOB_TABLE`` / ``LINEAGE_PROGRAM_TABLE`` or explicit
arguments). Table names are validated as SQL identifiers before any statement
is built — user-controlled names are never concatenated into SQL.

Default Community table names are ``p_job`` / ``p_program``. A deployment with
a scheduler-specific schema (for example ``p_job_hjj`` / ``p_program_hjj``)
keeps working by configuring the same variables; no physical table is renamed.
"""

from __future__ import annotations

import os
import re
from typing import NamedTuple

JOB_TABLE_ENV = "LINEAGE_JOB_TABLE"
PROGRAM_TABLE_ENV = "LINEAGE_PROGRAM_TABLE"

DEFAULT_JOB_TABLE = "p_job"
DEFAULT_PROGRAM_TABLE = "p_program"

SCHEMA = "dwp"

# Strict identifier rule: schema-qualified names are not accepted here; callers
# that need a different schema must extend the adapter, not bypass validation.
IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class SchedulerTables(NamedTuple):
    job_table: str
    program_table: str


def validate_identifier(name: str, label: str) -> str:
    """Validate a table identifier; raises ValueError when unsafe."""
    value = str(name or "").strip()
    if not IDENTIFIER_RE.fullmatch(value):
        raise ValueError(
            f"{label} must match ^[A-Za-z_][A-Za-z0-9_]*$ (got {value!r}); "
            "table names are not parameterized as values"
        )
    return value


def resolve_scheduler_tables(
    job_table: str | None = None,
    program_table: str | None = None,
) -> SchedulerTables:
    """Resolve scheduler table names: explicit args, then env, then defaults."""
    job = job_table or os.getenv(JOB_TABLE_ENV, "").strip() or DEFAULT_JOB_TABLE
    program = (
        program_table
        or os.getenv(PROGRAM_TABLE_ENV, "").strip()
        or DEFAULT_PROGRAM_TABLE
    )
    return SchedulerTables(
        validate_identifier(job, JOB_TABLE_ENV),
        validate_identifier(program, PROGRAM_TABLE_ENV),
    )


def job_sql(job_table: str) -> str:
    """Statement selecting job rows: (plan, job name, dependency text)."""
    return f"""
SELECT a, c, ab
FROM {SCHEMA}.{job_table}
WHERE c IS NOT NULL
"""


def program_sql(job_table: str, program_table: str) -> str:
    """Statement selecting job-to-result-table rows."""
    return f"""
SELECT DISTINCT substr(program.k, 5) AS table_name, job.c
FROM {SCHEMA}.{job_table} job
JOIN {SCHEMA}.{program_table} program ON job.e = program.b
WHERE substr(program.k, 5) LIKE '%.%'
"""
