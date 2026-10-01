"""Explicit logical relationship contract for the DWS baseline.

GaussDB/DWS does not support physical FOREIGN KEY constraints in the target
runtime. Keep these relationships independently enumerated so removing a
physical constraint cannot silently erase the schema contract.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class LogicalRelationship:
    child_table: str
    child_columns: tuple[str, ...]
    parent_table: str
    parent_columns: tuple[str, ...]
    on_delete: str


DWS_LOGICAL_RELATIONSHIPS = (
    LogicalRelationship(
        "p_api_asset", ("system_id",), "p_system", ("system_id",), "RESTRICT"
    ),
    LogicalRelationship(
        "p_field_mapping_table",
        ("data_source_id",),
        "p_data_source",
        ("source_id",),
        "RESTRICT",
    ),
    LogicalRelationship(
        "p_field_mapping_field",
        ("table_pk",),
        "p_field_mapping_table",
        ("table_pk",),
        "CASCADE",
    ),
    LogicalRelationship(
        "p_role_permission", ("role_code",), "p_role", ("role_code",), "CASCADE"
    ),
    LogicalRelationship(
        "p_role_permission",
        ("permission_code",),
        "p_permission",
        ("permission_code",),
        "CASCADE",
    ),
    LogicalRelationship(
        "p_upstream_system",
        ("data_source_id",),
        "p_data_source",
        ("source_id",),
        "RESTRICT",
    ),
    LogicalRelationship(
        "p_field_mapping_table",
        ("upstream_system_id",),
        "p_upstream_system",
        ("system_pk",),
        "RESTRICT",
    ),
    LogicalRelationship(
        "p_upstream_unload_time",
        ("system_pk",),
        "p_upstream_system",
        ("system_pk",),
        "CASCADE",
    ),
    LogicalRelationship(
        "p_push_system", ("master_system_id",), "p_system", ("system_id",), "RESTRICT"
    ),
    LogicalRelationship(
        "p_push_job", ("system_id",), "p_push_system", ("system_id",), "CASCADE"
    ),
    LogicalRelationship(
        "p_push_job_field", ("job_id",), "p_push_job", ("job_id",), "CASCADE"
    ),
    LogicalRelationship(
        "p_lineage_node",
        ("snapshot_id",),
        "p_lineage_snapshot",
        ("snapshot_id",),
        "CASCADE",
    ),
    LogicalRelationship(
        "p_lineage_edge",
        ("snapshot_id",),
        "p_lineage_snapshot",
        ("snapshot_id",),
        "CASCADE",
    ),
)
